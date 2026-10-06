/**
 * 契约断言工具：**逐个键**核对 `output.schema` + 无损 JSON（§6.2 第 1 条、R13）。
 *
 * 复刻宿主 `dsh-tools` 的校验子集语义（type/oneOf/properties/required/
 * additionalProperties/items/enum/const），并额外做两件宿主会做的事：
 *  1. 无损 JSON 检查（`undefined` / `NaN` / `-0` / `Date` / `Map` / 循环引用都会被拒）；
 *  2. **测试侧更严**：禁止 schema 未声明的键（宿主只在 `additionalProperties:false`
 *     时才拒，这里主动收紧，用来发现「返回值悄悄多了一个字段」）。
 */

import assert from 'node:assert/strict';

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function scalarMatches(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

/** 断言值满足 schema 子集；`strict` 为真时禁止未声明的对象键。 */
export function assertSchema(value, schema, path = 'value', strict = true) {
  assert.ok(isPlainRecord(schema), `${path}: schema 必须是普通对象`);
  if (schema.oneOf !== undefined) {
    assert.ok(Array.isArray(schema.oneOf) && schema.oneOf.length >= 2, `${path}: oneOf 至少两个分支`);
    let matches = 0;
    const failures = [];
    for (const branch of schema.oneOf) {
      try {
        assertSchema(value, branch, path, strict);
        matches += 1;
      } catch (error) {
        failures.push(error.message);
      }
    }
    assert.equal(matches, 1, `${path}: 必须恰好命中一个 oneOf 分支（命中 ${matches}）\n${failures.join('\n')}`);
    return;
  }
  const type = schema.type;
  if (type === undefined) {
    assertLossless(value, path);
    return;
  }
  assert.ok(TYPES.has(type), `${path}: 非法 type ${type}`);
  if (type === 'object') {
    assert.ok(isPlainRecord(value), `${path}: 必须是对象，实际 ${describe(value)}`);
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      assert.ok(Object.hasOwn(value, key) && value[key] !== undefined, `${path}.${key}: 缺少 required 属性`);
    }
    if (strict && schema.additionalProperties !== true) {
      for (const key of Object.keys(value)) {
        assert.ok(Object.hasOwn(properties, key), `${path}.${key}: schema 未声明的键（返回值多了一个字段）`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) continue;
      assertSchema(value[key], child, `${path}.${key}`, strict);
    }
    return;
  }
  if (type === 'array') {
    assert.ok(Array.isArray(value), `${path}: 必须是数组，实际 ${describe(value)}`);
    if (schema.items !== undefined) value.forEach((item, index) => assertSchema(item, schema.items, `${path}[${index}]`, strict));
    return;
  }
  assert.ok(scalarMatches(type, value), `${path}: 必须是 ${type}，实际 ${describe(value)}`);
  if (schema.enum !== undefined) assert.ok(schema.enum.includes(value), `${path}: 必须是 enum 之一，实际 ${JSON.stringify(value)}`);
  if (schema.const !== undefined) assert.equal(value, schema.const, `${path}: 必须是 const ${JSON.stringify(schema.const)}`);
}

/** 断言值是无损 JSON（宿主 `INVALID_TOOL_OUTPUT` 的判据）。 */
export function assertLossless(value, path = 'value', seen = new WeakSet()) {
  const type = typeof value;
  if (value === null) return;
  if (type === 'string' || type === 'boolean') return;
  if (type === 'number') {
    assert.ok(Number.isFinite(value), `${path}: 数字必须是有限值，实际 ${value}`);
    assert.ok(!Object.is(value, -0), `${path}: 不允许 -0（JSON 往返会变成 0）`);
    return;
  }
  assert.ok(type !== 'undefined', `${path}: 不允许 undefined（要省略的键就整个不写）`);
  assert.ok(type === 'object', `${path}: 不支持的类型 ${type}`);
  assert.ok(!(value instanceof Date), `${path}: 不允许 Date，请转成 ISO 字符串`);
  assert.ok(!(value instanceof Map) && !(value instanceof Set), `${path}: 不允许 Map/Set`);
  assert.ok(!seen.has(value), `${path}: 循环引用`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLossless(item, `${path}[${index}]`, seen));
  } else {
    assert.ok(isPlainRecord(value), `${path}: 必须是普通对象（原型为 Object.prototype 或 null）`);
    for (const [key, item] of Object.entries(value)) assertLossless(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

/** 一次跑完 schema + 无损 JSON 两个断言。 */
export function assertToolOutput(definition, value, args = {}) {
  assertLossless(value, `${definition.name} 返回值`);
  assertSchema(value, definition.output.schema, `${definition.name} 返回值`);
  const blocks = definition.output.render(args, value);
  assert.ok(Array.isArray(blocks) && blocks.length === 1, `${definition.name}: render 必须返回单个内容块`);
  assert.equal(blocks[0].type, 'text', `${definition.name}: render 的内容块必须是 text`);
  assert.equal(typeof blocks[0].text, 'string', `${definition.name}: text 必须是字符串`);
  assert.ok(blocks[0].text.length > 0, `${definition.name}: text 不能为空`);
  if (typeof definition.output.presentationMeta === 'function') {
    const meta = definition.output.presentationMeta(args, value);
    assertLossless(meta, `${definition.name} presentationMeta`);
  }
  return blocks[0].text;
}

/** 断言 schema 使用了宿主支持的子集（与 `assertSupportedJsonSchema` 对齐）。 */
export function assertSupportedSchema(schema, path = 'schema') {
  const annotations = new Set(['description', 'title', 'default', 'examples']);
  const constraints = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']);
  const oneOfSiblings = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const'];
  assert.ok(isPlainRecord(schema), `${path}: schema 必须是普通对象`);
  for (const key of Object.keys(schema)) {
    assert.ok(constraints.has(key) || annotations.has(key), `${path}.${key}: 宿主不支持的 schema 关键字`);
  }
  const hasType = Object.hasOwn(schema, 'type');
  const hasOneOf = Object.hasOwn(schema, 'oneOf');
  assert.ok(hasType || hasOneOf, `${path}: 必须声明 type 或 oneOf`);
  assert.ok(!(hasType && hasOneOf), `${path}: 不能同时声明 type 与 oneOf`);
  if (hasOneOf) {
    for (const key of oneOfSiblings) assert.ok(!Object.hasOwn(schema, key), `${path}.${key}: 不能与 oneOf 并列`);
    assert.ok(Array.isArray(schema.oneOf) && schema.oneOf.length >= 2, `${path}.oneOf: 至少两个分支`);
    schema.oneOf.forEach((branch, index) => assertSupportedSchema(branch, `${path}.oneOf[${index}]`));
    return;
  }
  assert.ok(TYPES.has(schema.type), `${path}.type: 非法类型 ${schema.type}`);
  if (schema.type === 'object') {
    if (schema.required !== undefined) {
      assert.ok(Array.isArray(schema.required), `${path}.required: 必须是字符串数组`);
      for (const key of schema.required) assert.ok(Object.hasOwn(schema.properties ?? {}, key), `${path}.required: "${key}" 不在 properties 里`);
    }
    if (schema.additionalProperties !== undefined) assert.equal(typeof schema.additionalProperties, 'boolean', `${path}.additionalProperties: 必须是布尔`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) assertSupportedSchema(child, `${path}.properties.${key}`);
    return;
  }
  if (schema.type === 'array') {
    if (schema.items !== undefined) assertSupportedSchema(schema.items, `${path}.items`);
    return;
  }
  if (schema.enum !== undefined) {
    assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0, `${path}.enum: 必须是非空数组`);
  }
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
