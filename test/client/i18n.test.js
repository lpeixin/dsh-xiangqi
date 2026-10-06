/**
 * 字典守卫（§7.6）。
 *
 * 两条纪律各对应一个真实故障：
 *  - 键集不一致 → 英文界面下会**原样显示键名**（查表顺序是当前语言 → common → 键本身）；
 *  - 插值占位符不一致 → 英文句子里的 `{model}` 永远渲染不出来。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCALE_NS, dicts, en, zh } from '../../lib/ui/i18n.js';

/** 取一个字符串里出现的 `{name}` 占位符，排序后返回。 */
function placeholders(value) {
  const out = [];
  for (const match of String(value).matchAll(/\{(\w+)\}/g)) out.push(match[1]);
  return out.sort();
}

test('命名空间是 xiangqi，且注册的正是 zh/en 两套字典', () => {
  assert.equal(LOCALE_NS, 'xiangqi');
  assert.deepEqual(Object.keys(dicts).sort(), ['en', 'zh']);
  assert.equal(dicts.zh, zh);
  assert.equal(dicts.en, en);
});

test('zh 与 en 的键集完全一致（zh 为键集真相）', () => {
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, zhKeys);
  assert.ok(zhKeys.length > 100, `字典太小（${zhKeys.length} 键），八成是漏了一整块`);
  const missing = zhKeys.filter((key) => !(key in en));
  assert.deepEqual(missing, []);
});

test('键是扁平字符串，值是字符串', () => {
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof key, 'string');
    assert.ok(key.length > 0);
    assert.equal(typeof value, 'string', `zh.${key} 不是字符串`);
    assert.ok(!key.startsWith('.') && !key.endsWith('.'));
  }
  for (const [key, value] of Object.entries(en)) {
    assert.equal(typeof value, 'string', `en.${key} 不是字符串`);
  }
});

test('除刻意留空的键外，两种语言都没有空文案', () => {
  const allowEmpty = new Set(['status.suffix.none']);
  for (const key of Object.keys(zh)) {
    if (allowEmpty.has(key)) continue;
    assert.notEqual(zh[key], '', `zh.${key} 是空串`);
    assert.notEqual(en[key], '', `en.${key} 是空串`);
  }
  assert.equal(zh['status.suffix.none'], '');
  assert.equal(en['status.suffix.none'], '');
});

test('同一键的插值占位符在两种语言里一致', () => {
  const mismatched = [];
  for (const key of Object.keys(zh)) {
    const a = placeholders(zh[key]).join(',');
    const b = placeholders(en[key]).join(',');
    if (a !== b) mismatched.push(`${key}: zh{${a}} vs en{${b}}`);
  }
  assert.deepEqual(mismatched, []);
});

test('棋子 / 文件号 / 纵线的生成键两侧齐全', () => {
  const pieces = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
  for (const piece of pieces) {
    for (const side of ['r', 'b']) {
      const key = `board.piece.${side}.${piece}`;
      assert.ok(key in zh, `缺 ${key}`);
      assert.ok(key in en, `缺 ${key}`);
      assert.notEqual(zh[key], en[key], `${key} 的中英文一样，八成忘了翻译`);
    }
  }
  for (let n = 1; n <= 9; n += 1) {
    assert.ok(`board.file.${n}` in zh);
    assert.ok(`board.file.${n}` in en);
  }
  for (let r = 0; r < 10; r += 1) {
    assert.ok(`board.rank.${r}` in zh);
    assert.ok(`board.rank.${r}` in en);
  }
  // 棋子汉字不翻译（设计明文：棋盘上的汉字是棋本身，不是 UI 文案）。
  assert.equal(zh['board.piece.r.N'], '马');
  assert.equal(zh['board.piece.b.N'], '马');
  assert.equal(en['board.piece.r.N'], 'Horse');
});

test('英文侧不携带中文标点或汉字（棋子汉字除外）', () => {
  const allowed = /^(board\.piece\.|board\.rank\.)/;
  const offenders = [];
  for (const [key, value] of Object.entries(en)) {
    if (allowed.test(key)) continue;
    if (/[\u4e00-\u9fff，。？！：；、「」（）]/.test(value)) offenders.push(`${key}=${value}`);
  }
  assert.deepEqual(offenders, []);
});

test('i18n 完整性：UI 组件里不得硬编码中文（棋盘固有字样除外）', async () => {
  // 界面文案一律走 `props.t(...)` / 字典。组件里一旦硬编码中文，切到英文就不会被翻译，
  // 而这种缺口在中文环境下**永远看不出来**——所以用静态检查守住。
  const { readFile, readdir } = await import('node:fs/promises');
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  const CJK = /[\u4e00-\u9fff]/;
  // 允许清单：棋盘上印的「楚河 / 汉界」是棋具固有字样，英文棋具同样印中文，不该翻译。
  const ALLOWED = new Set(['楚河', '汉界']);

  const dir = new URL('../../lib/ui/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.js') && name !== 'i18n.js');
  const offenders = [];
  for (const name of files) {
    const source = strip(await readFile(new URL(name, dir), 'utf8'));
    const literals = [...source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g)].map(
      (match) => match[1] ?? match[2] ?? match[3] ?? '',
    );
    for (const literal of literals) {
      if (!CJK.test(literal)) continue;
      if (ALLOWED.has(literal)) continue;
      offenders.push(`${name}: ${JSON.stringify(literal.slice(0, 60))}`);
    }
  }
  assert.deepEqual(offenders, [], `组件里出现了硬编码中文，切语言时不会被翻译：\n${offenders.join('\n')}`);
});

test('i18n 完整性：代码里用到的每个文案键都必须在 zh 与 en 里都存在', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const dir = new URL('../../lib/ui/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.js') && name !== 'i18n.js');
  const keys = new Set();
  for (const name of files) {
    const source = await readFile(new URL(name, dir), 'utf8');
    // 匹配 t('key') / props.t('key')；带插值的键名（如 `status.check.${side}`）由测试另行覆盖。
    for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) keys.add(match[1]);
  }
  assert.ok(keys.size > 20, `应当扫到足量文案键，实际 ${keys.size}`);
  const missing = [...keys].filter((key) => !(key in zh) || !(key in en)).sort();
  assert.deepEqual(missing, [], `这些键在字典里缺失（或只翻译了一种语言）：\n${missing.join('\n')}`);
});
