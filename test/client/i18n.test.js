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
