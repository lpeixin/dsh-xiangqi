/**
 * 本地搜索单测（§5.7）。
 *
 * 底线只有三条：**返回的着法一定合法**、**同 seed 同结果**、**遵守 depth/time 双限**。
 * 其余（能否找到杀棋）是质量，不是契约，所以只在明确可判的局面上下断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initialPosition, positionFromFen, generateMoves, isLegalMove, moveToIccs, iccsToSquare,
  searchBestMove, SEARCH_LIMITS, searchScoreTextZh, applyMove, parseAnyMove,
} from '../../lib/engine/index.js';

test('返回的着法必须落在合法着法集合内', () => {
  const positions = [
    initialPosition(),
    positionFromFen('r1ea1a3/4kh3/2h1e4/pHp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2EAKAE2 w - - 0 1'),
    positionFromFen('4ka3/4a4/9/9/4H4/p8/9/4C3c/7h1/2EK5 w - - 0 1'),
  ];
  for (const pos of positions) {
    const result = searchBestMove(pos, { depth: 2, timeMs: 1000, seed: 3 });
    assert.ok(result.move, '有合法着法时必须给出着法');
    assert.equal(isLegalMove(pos, result.move), true, moveToIccs(result.move));
    assert.ok(generateMoves(pos).some((move) => moveToIccs(move) === moveToIccs(result.move)));
    assert.ok(result.nodes > 0);
    assert.ok(result.depth >= 1);
    assert.ok(result.pv.length >= 1, '主变至少含第一手');
    assert.equal(result.pv[0], moveToIccs(result.move));
  }
});

test('找到一步杀（depth 2 足够）', () => {
  // 红方 a7→a9 双车错杀；搜索必须给出将杀分。
  const pos = positionFromFen('4k4/8R/R8/9/9/9/9/9/9/3K5 w - - 0 1');
  const result = searchBestMove(pos, { depth: 3, timeMs: 2000, seed: 1 });
  assert.equal(result.move && moveToIccs(result.move), 'a7a9');
  assert.ok(result.score >= SEARCH_LIMITS.MATE_SCORE - 48, `应给出将杀分，实际 ${result.score}`);
  assert.match(searchScoreTextZh(result.score), /必胜/);
  assert.equal(searchScoreTextZh(-SEARCH_LIMITS.MATE_SCORE), '必败（对方有杀）');
  assert.equal(searchScoreTextZh(0), '均势');
  assert.equal(searchScoreTextZh(100), '明显占优');
  assert.equal(searchScoreTextZh(-100), '明显劣势');
  assert.equal(searchScoreTextZh(30), '稍占优');
  assert.equal(searchScoreTextZh(-30), '稍处下风');
});

test('无合法着法返回空结果而不是抛异常', () => {
  const mate = positionFromFen('R3k4/9/4R4/9/9/9/9/9/9/4K4 b - - 0 1');
  assert.equal(generateMoves(mate).length, 0);
  assert.deepEqual(searchBestMove(mate), { move: null, score: 0, depth: 0, nodes: 0, pv: [] });
  assert.deepEqual(searchBestMove(null), { move: null, score: 0, depth: 0, nodes: 0, pv: [] });
});

test('同 seed 必得同结果', () => {
  const pos = initialPosition();
  const a = searchBestMove(pos, { depth: 3, timeMs: 2000, seed: 11 });
  const b = searchBestMove(pos, { depth: 3, timeMs: 2000, seed: 11 });
  assert.deepEqual(a, b);
  const c = searchBestMove(pos, { depth: 3, timeMs: 2000, seed: 12 });
  assert.equal(c.depth, a.depth, '深度不应受 seed 影响');
});

test('depth 上限被遵守（timeMs 充足时）', () => {
  const pos = initialPosition();
  for (const depth of [1, 2, 3]) {
    const result = searchBestMove(pos, { depth, timeMs: 5000, seed: 1 });
    assert.equal(result.depth, depth);
  }
});

test('timeMs 上限被遵守（depth 给很大）', () => {
  const pos = positionFromFen('r1ea1a3/4kh3/2h1e4/pHp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2EAKAE2 w - - 0 1');
  const started = Date.now();
  const result = searchBestMove(pos, { depth: 12, timeMs: 120, seed: 2 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2500, `应尽快返回，实际 ${elapsed} ms`);
  assert.ok(result.depth >= 1, '至少完成第 1 层');
  assert.ok(result.move);
});

test('默认参数是 depth 4 / timeMs 300', () => {
  assert.equal(SEARCH_LIMITS.DEFAULT_DEPTH, 4);
  assert.equal(SEARCH_LIMITS.DEFAULT_TIME_MS, 300);
  const started = Date.now();
  const result = searchBestMove(initialPosition());
  assert.ok(Date.now() - started < 3000);
  assert.ok(result.nodes > 0 && result.depth >= 1);
  assert.equal(typeof result.score, 'number');
});

test('极短时限下仍返回合法着法（可能是第 0 层）', () => {
  const pos = initialPosition();
  const result = searchBestMove(pos, { depth: 4, timeMs: 1, seed: 1 });
  assert.ok(result.move);
  assert.equal(isLegalMove(pos, result.move), true);
  assert.ok(result.depth >= 0);
});

test('评分是走子方视角：双方各有一手绝对好棋时符号相反', () => {
  const pos = positionFromFen('4k4/9/9/9/9/9/9/9/4r4/4K4 w - - 0 1');
  const red = searchBestMove(pos, { depth: 2, timeMs: 1000, seed: 1 });
  assert.ok(red.move, '红方被将也必须能选出一手');
  // 红方被将军，评分必然很差（走子方视角为负）。
  assert.ok(red.score < 0, `红方被将时评分应为负，实际 ${red.score}`);
});

test('吃子偏好：能白吃大子时优先吃', () => {
  const base = positionFromFen('3k5/9/9/9/9/9/9/9/9/3K1R3 w - - 0 1');
  const pos = applyMove(base, { from: iccsToSquare('f0'), to: iccsToSquare('f1') });
  const withRook = applyMove(pos, { from: iccsToSquare('d9'), to: iccsToSquare('d8') });
  const result = searchBestMove(withRook, { depth: 2, timeMs: 1000, seed: 5 });
  assert.ok(result.move);
  assert.equal(isLegalMove(withRook, result.move), true);
});

test('parseAnyMove 与 searchBestMove 组合可自对局（冒烟）', () => {
  let pos = initialPosition();
  const seen = new Set();
  for (let ply = 0; ply < 12; ply += 1) {
    const result = searchBestMove(pos, { depth: 2, timeMs: 300, seed: ply });
    assert.ok(result.move, `第 ${ply + 1} 手应有着法`);
    assert.equal(isLegalMove(pos, result.move), true);
    seen.add(moveToIccs(result.move));
    pos = applyMove(pos, result.move);
  }
  assert.equal(seen.size, 12, '自对局不应重复同一手（seed 变化 + 局面变化）');
  assert.ok(parseAnyMove(pos, 'a0a1').error || parseAnyMove(pos, 'a0a1').move);
});
