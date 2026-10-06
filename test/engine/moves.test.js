/**
 * 着法生成与合法性单测（§5.4）。
 *
 * 规则反例集集中在 `test/fixtures/rules/*.json`：每条用例声明「局面 + 着法 +
 * 期望拒绝原因码」。用**码**而不是文案做断言，是因为文案会随 UI 调整，
 * 而码是给程序与测试用的稳定契约。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  initialPosition, positionFromFen, applyMove, generateMoves, pseudoLegalMoves,
  isLegalMove, moveRejectCode, moveRejectReason, MOVE_REJECT_ZH, isValidPosition,
  isSquareAttacked, isSquareAttackedBy, findKingIndex, pieceSideCode, toMoveObjects,
  collectLegalMoves, collectPseudoMoves, iccsToSquare, moveToIccs, oppositeSide, positionToFen,
} from '../../lib/engine/index.js';

const RULES_DIR = new URL('../fixtures/rules/', import.meta.url);
const ruleFiles = readdirSync(RULES_DIR).filter((name) => name.endsWith('.json'));
const ruleCases = ruleFiles.flatMap((name) => {
  const data = JSON.parse(readFileSync(new URL(name, RULES_DIR), 'utf8'));
  return data.cases.map((item) => ({ ...item, file: name }));
});

/** 夹具里的着法：ICCS 字符串或 {from,to}；raw=true 表示故意传非对象。 */
function fixtureMove(item) {
  if (item.raw) return item.move;
  if (typeof item.move === 'string') {
    return { from: iccsToSquare(item.move.slice(0, 2)), to: iccsToSquare(item.move.slice(2)) };
  }
  return item.move;
}

test('规则反例集夹具覆盖 §5.4 全部规则', () => {
  const rules = new Set(ruleCases.map((item) => item.rule));
  for (const required of ['车', '马', '炮', '相', '象', '仕', '帅', '兵', '卒', '将帅照面', '应将', '送将', '非法输入']) {
    assert.ok(rules.has(required), `缺少「${required}」的用例`);
  }
  assert.ok(ruleCases.length >= 40, `用例总量偏少：${ruleCases.length}`);
});

for (const item of ruleCases) {
  test(`[${item.file}] ${item.rule}：${item.name}`, () => {
    const pos = positionFromFen(item.fen);
    const move = fixtureMove(item);
    assert.equal(moveRejectCode(pos, move), item.expectCode, item.note);
    assert.equal(isLegalMove(pos, move), item.expectCode === null);
    const reason = moveRejectReason(pos, move);
    if (item.expectCode === null) assert.equal(reason, null);
    else assert.match(reason, /^非法着法：/);
  });
}

test('初始局面 44 个合法着法，且合法 ⊆ 伪合法', () => {
  const pos = initialPosition();
  const legal = generateMoves(pos);
  const pseudo = pseudoLegalMoves(pos);
  assert.equal(legal.length, 44);
  assert.ok(pseudo.length >= legal.length);
  const keys = new Set(pseudo.map((m) => `${m.from}-${m.to}`));
  for (const move of legal) assert.ok(keys.has(`${move.from}-${move.to}`));
  assert.equal(new Set(legal.map((m) => moveToIccs(m))).size, 44, '不应有重复着法');
});

test('非法局面返回空着法而不是抛异常', () => {
  assert.deepEqual(generateMoves(null), []);
  assert.deepEqual(pseudoLegalMoves({ board: [], turn: 'r', halfmove: 0, fullmove: 1 }), []);
});

test('applyMove 是纯函数且维护半回合/回合', () => {
  const pos = initialPosition();
  const snapshot = positionToFen(pos);
  const next = applyMove(pos, { from: iccsToSquare('h2'), to: iccsToSquare('e2') });
  assert.equal(positionToFen(pos), snapshot, '入参不能被修改');
  assert.equal(next.turn, 'b');
  assert.equal(next.halfmove, 1);
  assert.equal(next.fullmove, 1, '红方走子不加回合数');
  const back = applyMove(next, { from: iccsToSquare('h9'), to: iccsToSquare('g7') });
  assert.equal(back.fullmove, 2);
  assert.equal(back.halfmove, 2);
});

test('applyMove 吃到子时半回合归零', () => {
  const pos = positionFromFen('4k4/9/9/9/9/9/9/4r4/9/3KR4 w - - 17 40');
  const capture = { from: iccsToSquare('e0'), to: iccsToSquare('e2') };
  assert.equal(moveRejectCode(pos, capture), null);
  assert.equal(applyMove(pos, capture).halfmove, 0);
});

test('applyMove 对着法形状非法时原样返回克隆', () => {
  const pos = initialPosition();
  const next = applyMove(pos, { from: 'x', to: 3 });
  assert.equal(positionToFen(next), positionToFen(pos));
  assert.notEqual(next, pos);
  assert.equal(applyMove(null, { from: 0, to: 1 }), null);
});

test('拒绝原因是中文人话且可读', () => {
  const pos = initialPosition();
  const reason = moveRejectReason(pos, { from: iccsToSquare('e3'), to: iccsToSquare('d3') });
  assert.match(reason, /兵\/卒过河后才能横走/);
  assert.ok(MOVE_REJECT_ZH['self-check'].includes('将军'));
  assert.match(moveRejectReason(pos, null), /着法格式非法/);
  assert.match(moveRejectReason(pos, { from: 54, to: 54 }), /起点与终点相同/);
});

test('攻击判定与棋子颜色码', () => {
  const pos = positionFromFen('3k5/9/9/9/9/9/9/9/4r4/4K4 w - - 0 1');
  assert.equal(pieceSideCode('R'), 1);
  assert.equal(pieceSideCode('r'), 2);
  assert.equal(pieceSideCode(''), 0);
  assert.equal(findKingIndex(pos.board, 'r'), iccsToSquare('e0'));
  assert.equal(findKingIndex(pos.board, 'b'), iccsToSquare('d9'));
  assert.equal(isSquareAttacked(pos.board, iccsToSquare('e0'), 'b'), true, '黑车在 e 线上攻击红帅');
  assert.equal(isSquareAttackedBy(pos.board, iccsToSquare('e0'), 2), true);
  assert.equal(isSquareAttackedBy(pos.board, iccsToSquare('e0'), 1), false);
  assert.equal(isSquareAttackedBy(pos.board, -1, 1), false);
  assert.equal(isSquareAttacked(pos.board, iccsToSquare('e0'), 'b') !== isSquareAttacked(pos.board, iccsToSquare('e0'), 'r'), true);
});

test('collectLegalMoves / collectPseudoMoves / toMoveObjects 与公开 API 一致', () => {
  const pos = initialPosition();
  const codes = collectLegalMoves(pos.board, pos.turn, []);
  assert.equal(codes.length, generateMoves(pos).length);
  assert.equal(collectPseudoMoves(pos.board, pos.turn, []).length >= codes.length, true);
  const objects = toMoveObjects(codes);
  assert.deepEqual(objects, generateMoves(pos));
  assert.equal(oppositeSide(pos.turn), 'b');
  assert.equal(isValidPosition(pos), true);
});

test('兵斜走与走两格都不合法', () => {
  const pos = positionFromFen('4k4/9/9/9/9/9/6P2/9/9/3K5 w - - 0 1');
  assert.equal(moveRejectCode(pos, { from: iccsToSquare('g3'), to: iccsToSquare('f4') }), 'not-a-pawn-move');
  assert.equal(moveRejectCode(pos, { from: iccsToSquare('g3'), to: iccsToSquare('g5') }), 'not-a-pawn-move');
});

test('将帅照面：走开后两将同列即非法', () => {
  const pos = positionFromFen('4k4/9/9/9/4P4/9/9/9/9/4K4 w - - 0 1');
  assert.equal(moveRejectCode(pos, { from: iccsToSquare('e5'), to: iccsToSquare('d5') }), 'king-facing');
});
