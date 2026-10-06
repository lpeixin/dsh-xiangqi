/**
 * 配置契约单测（§6.5）：手写 StandardSchemaV1 的默认值、覆盖合并与非法输入分支。
 * 重点：`validate` 必须是**同步、永不抛**（Cordis 的 `resolveConfig` 直接调用它）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Config, normalizeConfig } from '../../lib/index.js';

test('Config 是手写 StandardSchemaV1，不是 schemastery', () => {
  assert.equal(Config['~standard'].version, 1);
  assert.equal(typeof Config['~standard'].vendor, 'string');
  assert.notEqual(Config['~standard'].vendor, 'schemastery');
  assert.equal(typeof Config['~standard'].validate, 'function');
  assert.equal(Config['~standard'].validate({}) instanceof Promise, false, 'validate 必须同步');
});

test('未提供配置时每个键都有默认值', () => {
  const result = Config['~standard'].validate(undefined);
  assert.equal(result.issues, undefined);
  assert.deepEqual(result.value, {
    opponent: { mode: 'model', timeoutMs: 20000, maxRetries: 2, maxTokensPerMove: 256, maxTokensPerGame: 20000, candidateLimit: 40 },
    local: { depth: 4, timeMs: 300, randomize: true },
    rules: { fiftyMovePlies: 120, perpetualCheckLoses: true, maxPlies: 400 },
    ui: { showCoordinates: true, showEval: false, animation: true, clock: 'off' },
    saveDir: '.xiangqi-mate',
  });
});

test('部分覆盖按组合并，未提及的键回落到默认值', () => {
  const result = Config['~standard'].validate({ opponent: { mode: 'local', timeoutMs: 5000 }, ui: { clock: 'total' } });
  assert.equal(result.issues, undefined);
  assert.equal(result.value.opponent.mode, 'local');
  assert.equal(result.value.opponent.timeoutMs, 5000);
  assert.equal(result.value.opponent.maxRetries, 2, '同组未提及的键必须有默认值');
  assert.equal(result.value.ui.clock, 'total');
  assert.equal(result.value.ui.animation, true);
  assert.equal(result.value.local.depth, 4);
});

test('可选字符串键：空串视为未设置', () => {
  const result = Config['~standard'].validate({ opponent: { provider: '  ', model: 'deepseek-chat', reasoningEffort: 'max' } });
  assert.equal(result.issues, undefined);
  assert.equal(result.value.opponent.provider, undefined);
  assert.equal(result.value.opponent.model, 'deepseek-chat');
  assert.equal(result.value.opponent.reasoningEffort, 'max');
});

test('非法输入返回 issues 而不是抛异常', () => {
  const cases = [
    [{ opponent: 'model' }, /opponent 必须是一个对象/],
    [{ opponent: { mode: 'auto' } }, /mode 只能是/],
    [{ opponent: { timeoutMs: 'soon' } }, /timeoutMs 必须是有限数字/],
    [{ opponent: { timeoutMs: 10 } }, /timeoutMs 必须在 1000–600000 之间/],
    [{ opponent: { maxRetries: 99 } }, /maxRetries 必须在 0–5 之间/],
    [{ local: { depth: 0 } }, /depth 必须在 1–8 之间/],
    [{ local: { randomize: 'yes' } }, /randomize 必须是布尔值/],
    [{ rules: { maxPlies: 1 } }, /maxPlies 必须在 10–2000 之间/],
    [{ ui: { clock: 'sometimes' } }, /clock 只能是/],
    [{ saveDir: '' }, /saveDir 必须是非空字符串/],
    ['nope', /配置必须是一个对象/],
  ];
  for (const [input, expected] of cases) {
    const result = Config['~standard'].validate(input);
    assert.ok(Array.isArray(result.issues), `${JSON.stringify(input)} 应该产生 issues`);
    assert.equal(result.value, undefined);
    assert.ok(result.issues.some((issue) => expected.test(issue.message)), `${JSON.stringify(input)} 的 issues 不含 ${expected}: ${JSON.stringify(result.issues)}`);
  }
});

test('未知键被忽略，不产生 issues', () => {
  const result = Config['~standard'].validate({ opponent: { unknownKey: 1 }, somethingElse: true });
  assert.equal(result.issues, undefined);
  assert.equal(result.value.opponent.unknownKey, undefined);
  assert.equal(result.value.somethingElse, undefined);
});

test('normalizeConfig 与 validate 结果一致，且对非法输入仍给可用兜底', () => {
  const input = { opponent: { mode: 'local' } };
  assert.deepEqual(normalizeConfig(input).value, Config['~standard'].validate(input).value);
  const broken = normalizeConfig({ opponent: { timeoutMs: 'x' } });
  assert.ok(broken.issues.length > 0);
  assert.equal(broken.value.opponent.timeoutMs, 20000, '非法值必须回落到默认值，绝不能把坏值带进运行时');
});
