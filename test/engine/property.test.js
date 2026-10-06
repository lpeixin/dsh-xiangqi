/**
 * 不变量（property）单测（§5.8.3 第 4 条）。
 *
 * 随机对局不超过 200 手，任意时刻校验：
 *   1. 双方将帅各恰好一个；
 *   2. 合法着法集合 ⊆ 伪合法着法集合；
 *   3. 被将军且无着法 ⇒ 将死；
 *   4. 未被将军且无着法 ⇒ 困毙（判负）。
 *
 * 随机必须可复现：用固定 seed 的 PRNG 挑合法着法，不用 Math.random。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initialPosition, applyMove, generateMoves, pseudoLegalMoves, isInCheck, gameStatus,
  positionToFen, positionFromFen, moveToIccs, countRepetition, isValidPosition, BOARD_SIZE,
} from '../../lib/engine/index.js';

/** mulberry32：测试自带，避免依赖引擎内部实现。 */
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seeds = [1, 7, 42, 2024, 65535];

for (const seed of seeds) {
  test(`随机对局不变量（seed=${seed}，≤200 手）`, () => {
    const random = prng(seed);
    let pos = initialPosition();
    const history = [positionToFen(pos)];
    let plies = 0;
    while (plies < 200) {
      assert.equal(isValidPosition(pos), true, '局面结构必须始终合法');
      const kings = pos.board.filter((piece) => piece === 'K').length;
      const blackKings = pos.board.filter((piece) => piece === 'k').length;
      assert.equal(kings, 1, `第 ${plies} 手红帅数量异常`);
      assert.equal(blackKings, 1, `第 ${plies} 手黑将数量异常`);
      assert.equal(pos.board.length, BOARD_SIZE);

      const legal = generateMoves(pos);
      const pseudoKeys = new Set(pseudoLegalMoves(pos).map((move) => moveToIccs(move)));
      for (const move of legal) {
        assert.ok(pseudoKeys.has(moveToIccs(move)), '合法着法必须也是伪合法着法');
      }

      const status = gameStatus(pos, history);
      if (legal.length === 0) {
        assert.ok(status.state === 'checkmate' || status.state === 'stalemate');
        if (isInCheck(pos)) {
          assert.equal(status.state, 'checkmate');
          assert.equal(status.winner, pos.turn === 'r' ? 'b' : 'r');
        } else {
          assert.equal(status.state, 'stalemate');
          assert.equal(status.winner, pos.turn === 'r' ? 'b' : 'r', '困毙判负，不是和棋');
        }
        break;
      }
      assert.ok(status.state !== 'checkmate' && status.state !== 'stalemate');

      const move = legal[Math.floor(random() * legal.length)];
      const before = positionToFen(pos);
      const next = applyMove(pos, move);
      assert.equal(positionToFen(pos), before, 'applyMove 不得修改入参');
      assert.notEqual(next.turn, pos.turn, '走子方必须交换');
      pos = next;
      history.push(positionToFen(pos));
      plies += 1;

      if (status.state === 'draw-repetition' || status.state === 'draw-fifty' || status.state === 'draw-perpetual-check') {
        break;
      }
      assert.ok(countRepetition(pos, history) <= 3);
    }
    assert.ok(plies <= 200);
    assert.equal(isValidPosition(pos), true);
  });
}

test('随机局面也能完成 FEN 往返', () => {
  const random = prng(99);
  let pos = initialPosition();
  for (let ply = 0; ply < 60; ply += 1) {
    const legal = generateMoves(pos);
    if (legal.length === 0) break;
    pos = applyMove(pos, legal[Math.floor(random() * legal.length)]);
    assert.equal(positionToFen(positionFromFen(positionToFen(pos))), positionToFen(pos));
  }
});

test('固定 seed 的随机对局完全可复现', () => {
  const play = (seed) => {
    const random = prng(seed);
    let pos = initialPosition();
    const moves = [];
    for (let ply = 0; ply < 40; ply += 1) {
      const legal = generateMoves(pos);
      if (legal.length === 0) break;
      const move = legal[Math.floor(random() * legal.length)];
      moves.push(moveToIccs(move));
      pos = applyMove(pos, move);
    }
    return moves.join(' ');
  };
  assert.equal(play(2024), play(2024));
  assert.notEqual(play(2024), play(2025));
});
