/**
 * 局面状态单测（§5.4）：将死 / 困毙 / 三次重复 / 长将 / 自然限着。
 *
 * **困毙判负**是中国象棋与国际象棋最大的规则差异，因此单独强调：无子可动
 * 且未被将军时，`winner` 必须是对手而不是 `null`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  initialPosition, positionFromFen, positionToFen, applyMove, parseAnyMove, gameStatus,
  isInCheck, isBoardInCheck, kingsFaceOnBoard, countRepetition, findPerpetualChecker,
  FIFTY_MOVE_HALFMOVES,
} from '../../lib/engine/index.js';

const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/status.json', import.meta.url), 'utf8'));

for (const item of FIXTURE.cases) {
  test(`[${item.rule}] ${item.name}`, () => {
    const pos = positionFromFen(item.fen);
    const status = gameStatus(pos, item.history);
    assert.equal(status.state, item.expect.state, item.note);
    assert.equal(status.winner, item.expect.winner, item.note);
    assert.equal(status.reason, item.expect.reason);
    assert.ok(status.reasonZh.length > 0, '必须给出中文理由');
  });
}

test('困毙必须有专门用例且判负（不是和棋）', () => {
  const stalemates = FIXTURE.cases.filter((item) => item.expect.state === 'stalemate');
  assert.ok(stalemates.length >= 2, `困毙用例至少 2 条，实际 ${stalemates.length}`);
  for (const item of stalemates) {
    const status = gameStatus(positionFromFen(item.fen));
    assert.equal(status.winner, 'r');
    assert.equal(isInCheck(positionFromFen(item.fen)), false, '困毙时不该被将军');
    assert.match(status.reasonZh, /判负/);
  }
});

test('将死必须有专门用例且给出胜方', () => {
  const mates = FIXTURE.cases.filter((item) => item.expect.state === 'checkmate');
  assert.ok(mates.length >= 2);
  for (const item of mates) {
    const pos = positionFromFen(item.fen);
    assert.equal(isInCheck(pos), true);
    assert.equal(gameStatus(pos).winner, 'r');
    assert.match(gameStatus(pos).reasonZh, /将死/);
  }
});

test('初始局面是进行中', () => {
  const status = gameStatus(initialPosition());
  assert.equal(status.state, 'playing');
  assert.equal(status.winner, null);
  assert.equal(status.reasonZh, '对局进行中');
});

test('将军状态带应将着法数', () => {
  const pos = positionFromFen('4k4/9/9/9/9/9/9/9/4r4/4K4 w - - 0 1');
  assert.equal(isInCheck(pos), true);
  assert.equal(isInCheck(pos, 'b'), false);
  assert.equal(isBoardInCheck(pos.board, 'r'), true);
  const status = gameStatus(pos);
  assert.equal(status.state, 'check');
  assert.match(status.reasonZh, /应将着法 \d+ 个/);
});

test('非法局面给出可解释状态而不是抛异常', () => {
  assert.equal(gameStatus(null).reason, 'invalid-position');
  assert.equal(isInCheck(null), false);
  assert.equal(isBoardInCheck([], 'r'), false);
});

test('无 history 时不判重复', () => {
  const pos = initialPosition();
  assert.equal(countRepetition(pos, undefined), 1);
  assert.equal(countRepetition(pos, ['不是 FEN']), 1);
  assert.equal(findPerpetualChecker(pos, undefined), null);
  assert.equal(findPerpetualChecker(pos, ['不是 FEN']), null);
  assert.equal(gameStatus(pos, ['不是 FEN']).state, 'playing');
});

test('history 允许把当前局面也放进末尾（故意宽容调用方）', () => {
  const pos = initialPosition();
  const fen = positionToFen(pos);
  assert.equal(countRepetition(pos, [fen, fen, fen]), 1, '末尾连续重复的当前局面应被丢弃');
  assert.equal(countRepetition(pos, [fen, '别的', fen]), 2, '末尾那次被当作当前局面丢弃，中间那次照常计入');
});

test('长将：只有一方的每步都在将军时才判该方负', () => {
  const item = FIXTURE.cases.find((entry) => entry.rule === '长将');
  const pos = positionFromFen(item.fen);
  assert.equal(findPerpetualChecker(pos, item.history), 'r', '红方是长将方');
  assert.equal(gameStatus(pos, item.history).winner, 'b', '长将方判负');
});

test('自然限着阈值可按常量核对', () => {
  assert.equal(FIFTY_MOVE_HALFMOVES, 120);
  const at = positionFromFen(`4k4/9/9/9/9/9/9/9/9/4R3K w - - ${FIFTY_MOVE_HALFMOVES} 61`);
  assert.equal(gameStatus(at).state, 'draw-fifty');
  assert.equal(gameStatus(positionFromFen('4k4/9/9/9/9/9/9/9/9/4R3K w - - 119 61')).state, 'playing');
});

test('照面判定与将死/困毙的优先级：无着法优先于重复', () => {
  const mate = FIXTURE.cases.find((item) => item.name.includes('双车错'));
  const pos = positionFromFen(mate.fen);
  const fen = positionToFen(pos);
  const status = gameStatus(pos, [fen, fen]);
  assert.equal(status.state, 'checkmate', '将死不能被三次重复覆盖');
});

test('kingsFaceOnBoard 只在同列无挡子时为真', () => {
  assert.equal(kingsFaceOnBoard(positionFromFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1').board), true);
  assert.equal(kingsFaceOnBoard(positionFromFen('4k4/9/9/9/4P4/9/9/9/9/4K4 w - - 0 1').board), false);
  assert.equal(kingsFaceOnBoard(positionFromFen('4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1').board), false);
  assert.equal(kingsFaceOnBoard(initialPosition().board), false);
  assert.equal(kingsFaceOnBoard(new Array(90).fill('')), false, '没有将帅时返回 false');
});

test('连续将军但未构成重复时不判长将', () => {
  let pos = positionFromFen('4k4/9/9/9/9/R8/9/9/9/4K4 w - - 0 1');
  const history = [positionToFen(pos)];
  for (const iccs of ['a4e4', 'e9d9']) {
    const parsed = parseAnyMove(pos, iccs);
    assert.ok(parsed.move, parsed.error);
    pos = applyMove(pos, parsed.move);
    history.push(positionToFen(pos));
  }
  assert.ok(countRepetition(pos, history) < 3);
  assert.equal(gameStatus(pos, history).state, 'playing', '只是将军，不是判罚');
});
