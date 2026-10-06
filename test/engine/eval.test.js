/**
 * 评估函数单测（§5.7）。
 *
 * `breakdown` 的每一项都必须能解释分差（§5.6 的摘要直接引用它），
 * 所以断言既查符号也查「项与总分的自洽」——总分必须等于各项之和，
 * 否则摘要就是在编。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initialPosition, positionFromFen, evaluate, evalPieceValue, materialDiffZh, evalSideNameZh,
  iccsToSquare, applyMove, parseAnyMove,
} from '../../lib/engine/index.js';

test('初始局面完全对称：总分 0，五项齐全', () => {
  const result = evaluate(initialPosition());
  assert.equal(result.score, 0);
  assert.deepEqual(result.breakdown.map((term) => term.id), ['material', 'mobility', 'pawn-advance', 'king-safety', 'hanging-pin']);
  for (const term of result.breakdown) {
    assert.equal(typeof term.nameZh, 'string');
    assert.equal(typeof term.detailZh, 'string');
    assert.equal(term.score, 0);
  }
  assert.match(result.summaryZh, /双方子力相当（总分 \+0）/);
});

test('总分等于各项之和', () => {
  const pos = positionFromFen('r1ea1a3/4kh3/2h1e4/pHp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2EAKAE2 w - - 0 1');
  const result = evaluate(pos);
  const sum = result.breakdown.reduce((total, term) => total + term.score, 0);
  assert.equal(result.score, sum);
  assert.ok(result.score < 0, '该局面黑方多子，红方视角应为负');
  assert.match(result.summaryZh, /黑方净多/);
  assert.match(result.summaryZh, new RegExp(`总分 ${result.score >= 0 ? '\\+' : ''}${result.score}`));
});

test('子力项：吃子后分数向吃子方倾斜', () => {
  const base = positionFromFen('3k5/9/9/9/9/9/9/9/4r4/4K4 w - - 0 1');
  const before = evaluate(base).score;
  const captured = applyMove(base, { from: iccsToSquare('e0'), to: iccsToSquare('e1') });
  assert.ok(evaluate(captured).score > before, '红方吃车后分差应上升');
});

test('过河兵价值翻倍（100 → 200）', () => {
  assert.equal(evalPieceValue('P', iccsToSquare('e3')), 100);
  assert.equal(evalPieceValue('P', iccsToSquare('e6')), 200);
  assert.equal(evalPieceValue('p', iccsToSquare('e6')), 100);
  assert.equal(evalPieceValue('p', iccsToSquare('e3')), 200);
  assert.equal(evalPieceValue('R', iccsToSquare('a0')), 900);
  assert.equal(evalPieceValue('K', iccsToSquare('e0')), 0);
  assert.equal(evalPieceValue('', 0), 0);
});

test('过河兵推进项独立可解释', () => {
  const pos = positionFromFen('3k5/9/4P4/9/9/9/9/9/9/4K4 w - - 0 1');
  const term = evaluate(pos).breakdown.find((item) => item.id === 'pawn-advance');
  assert.ok(term.score > 0);
  assert.match(term.detailZh, /红方过河兵 1 个，黑方过河卒 0 个/);
});

test('九宫防守项：缺士象且对方有车炮时扣分', () => {
  const weak = positionFromFen('3k5/9/9/9/9/9/9/9/9/3K1R3 w - - 0 1');
  const term = evaluate(weak).breakdown.find((item) => item.id === 'king-safety');
  assert.ok(term.score > 0, '黑方缺士象且红方有车 → 黑方弱点，红方视角为正');
  const guarded = positionFromFen('2ak5/9/9/9/9/9/9/9/4A4/3K1R3 w - - 0 1');
  assert.ok(evaluate(guarded).breakdown.find((item) => item.id === 'king-safety').score <= term.score);
});

test('无根子与牵制项可解释', () => {
  const pinned = positionFromFen('3k5/9/9/9/9/9/9/9/4r4/4K4 b - - 0 1');
  const term = evaluate(pinned).breakdown.find((item) => item.id === 'hanging-pin');
  assert.equal(typeof term.score, 'number');
  assert.match(term.detailZh, /无根 \d+ 子、被牵制 \d+ 子/);
});

test('机动性项随可走空间变化', () => {
  const pos = initialPosition();
  const term = evaluate(pos).breakdown.find((item) => item.id === 'mobility');
  assert.equal(term.score, 0);
  assert.match(term.detailZh, /红方 44 着，黑方 44 着/);
});

test('非法局面返回可解释的空结果', () => {
  const result = evaluate(null);
  assert.equal(result.score, 0);
  assert.deepEqual(result.breakdown, []);
  assert.match(result.summaryZh, /无法评估/);
});

test('materialDiffZh 覆盖多子、单方领先与均势', () => {
  assert.equal(materialDiffZh(initialPosition().board), '双方子力相当');
  const redUp = positionFromFen('3k5/9/9/9/9/9/9/9/9/4K1R2 w - - 0 1');
  assert.equal(materialDiffZh(redUp.board), '红方净多一车');
  const blackUp = positionFromFen('3k5/9/9/9/9/9/9/4p4/9/3K5 b - - 0 1');
  assert.equal(materialDiffZh(blackUp.board), '黑方净多一卒');
  // 「净多」是按子种求差：各有一车时互相抵消，仍算均势。
  const bothRooks = positionFromFen('3k4r/9/9/9/9/9/9/9/9/3K1R3 w - - 0 1');
  assert.equal(materialDiffZh(bothRooks.board), '双方子力相当');
  // 一方多车、另一方多炮时才同时出现两个方向的差额。
  const mixed = positionFromFen('3k3c1/9/9/9/9/9/9/9/9/3K1R3 w - - 0 1');
  assert.match(materialDiffZh(mixed.board), /红方多一车、黑方多一炮/);
});

test('摘要与逐项结论一致（不得出现无出处的判断）', () => {
  const pos = positionFromFen('3k5/9/4P4/9/9/9/9/9/9/4K3R w - - 0 1');
  const result = evaluate(pos);
  assert.match(result.summaryZh, /红方过河兵压境/);
  assert.ok(result.breakdown.find((term) => term.id === 'pawn-advance').score > 0);
  assert.equal(evalSideNameZh('r'), '红方');
  assert.equal(evalSideNameZh('b'), '黑方');
  const afterCannon = applyMove(initialPosition(), parseAnyMove(initialPosition(), '炮二平五').move);
  assert.match(evaluate(afterCannon).summaryZh, /总分/);
});
