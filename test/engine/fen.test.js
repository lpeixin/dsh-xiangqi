/**
 * FEN 解析与导出单测（§5.1、§5.8.3）。
 *
 * 重点是两件事：`h/e` 方言必须归一化（否则 CPW 的 perft 夹具会静默错位），
 * 以及非法输入**只**在 positionFromFen 抛 PositionError。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PositionError, initialPosition, positionFromFen, positionToFen, clonePosition,
  isValidPosition, isPieceChar, normalizeFenDialect, positionKeyOf, fenKeyOf, START_FEN,
  BOARD_SIZE,
} from '../../lib/engine/index.js';

const FIXTURES = JSON.parse(readFileSync(new URL('../fixtures/positions.json', import.meta.url), 'utf8'));

test('初始局面与 §5.1 的 FEN 一致', () => {
  assert.equal(positionToFen(initialPosition()), START_FEN);
  assert.equal(initialPosition().board.length, BOARD_SIZE);
  assert.equal(initialPosition().turn, 'r');
  assert.equal(initialPosition().fullmove, 1);
});

test('每次 initialPosition 都是新对象', () => {
  const a = initialPosition();
  const b = initialPosition();
  assert.notEqual(a, b);
  assert.notEqual(a.board, b.board);
});

test('接受 n/b 与 h/e 两套方言并归一化', () => {
  assert.equal(normalizeFenDialect('rheakaehr'), 'rnbakabnr');
  assert.equal(normalizeFenDialect('RHEAKAEHR'), 'RNBAKABNR');
  for (const item of FIXTURES.dialect) {
    const pos = positionFromFen(item.input);
    assert.equal(positionToFen(pos), item.expected, `${item.input} 归一化后应等于 ${item.expected}`);
  }
});

test('往返恒等（≥30 个中残局局面）', () => {
  assert.ok(FIXTURES.roundTrip.length >= 30, `夹具至少 30 个，实际 ${FIXTURES.roundTrip.length}`);
  for (const fen of FIXTURES.roundTrip) {
    assert.equal(positionToFen(positionFromFen(fen)), fen);
  }
});

test('走子方与回合字段解析', () => {
  assert.equal(positionFromFen(START_FEN).turn, 'r');
  assert.equal(positionFromFen(START_FEN.replace(' w ', ' b ')).turn, 'b');
  const short = positionFromFen('4k4/9/9/9/9/9/9/9/9/4K4 b - -');
  assert.equal(short.halfmove, 0, '省略半回合字段时补默认值');
  assert.equal(short.fullmove, 1);
  assert.equal(positionFromFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 7 12').halfmove, 7);
});

test('畸形 FEN 抛 PositionError', () => {
  const bad = [
    ['', '空字符串'],
    ['   ', '只有空白'],
    [42, '不是字符串'],
    ['4k4/9/9/9/9/9/9/9/9/4K4', '缺走子方字段'],
    ['4k4/9/9/9/9/9/9/9/4K4 w - - 0 1', '只有 9 行'],
    ['4k4/9/9/9/9/9/9/9/9/9 w - - 0 1', '没有帅'],
    ['4k4/9/9/9/9/9/9/9/9/4KK3 w - - 0 1', '两个帅'],
    ['4k4/9/9/9/9/9/9/9/9/4K4 x - - 0 1', '走子方非法'],
    ['4k4/9/9/9/9/9/9/9/9/4Z4 w - - 0 1', '非法棋子字符'],
    ['4k44/9/9/9/9/9/9/9/9/4K4 w - - 0 1', '某行超过 9 格'],
    ['4k4/9/9/9/9/9/9/9/9/3K4 w - - 0 1', '某行不足 9 格'],
  ];
  for (const [fen, why] of bad) {
    assert.throws(() => positionFromFen(fen), PositionError, `${why} 应抛 PositionError`);
  }
});

test('半回合/回合字段非法时回退默认值', () => {
  assert.equal(positionFromFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - -3 x').halfmove, 0);
  assert.equal(positionFromFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 5 0').fullmove, 1);
});

test('positionToFen 对结构非法的 Position 抛 PositionError', () => {
  assert.throws(() => positionToFen(null), PositionError);
  assert.throws(() => positionToFen({ board: [], turn: 'r', halfmove: 0, fullmove: 1 }), PositionError);
});

test('isValidPosition 逐条拒绝结构错误', () => {
  const ok = initialPosition();
  assert.equal(isValidPosition(ok), true);
  assert.equal(isValidPosition(null), false);
  assert.equal(isValidPosition({ ...ok, board: ok.board.slice(0, 89) }), false);
  assert.equal(isValidPosition({ ...ok, turn: 'x' }), false);
  assert.equal(isValidPosition({ ...ok, halfmove: -1 }), false);
  assert.equal(isValidPosition({ ...ok, fullmove: 0 }), false);
  assert.equal(isValidPosition({ ...ok, board: ok.board.map((p, i) => (i === 0 ? 'Z' : p)) }), false);
});

test('clonePosition 深度隔离 board', () => {
  const pos = initialPosition();
  const copy = clonePosition(pos);
  copy.board[0] = 'R';
  copy.turn = 'b';
  assert.notEqual(pos.board[0], 'R');
  assert.equal(pos.turn, 'r');
});

test('局面键只含棋盘与走子方', () => {
  const a = initialPosition();
  const b = { ...initialPosition(), halfmove: 9, fullmove: 42 };
  assert.equal(positionKeyOf(a), positionKeyOf(b));
  assert.equal(positionKeyOf({ ...a, turn: 'b' }) === positionKeyOf(a), false);
  assert.equal(fenKeyOf(START_FEN), positionKeyOf(a));
  assert.equal(fenKeyOf('不是 FEN'), null);
});

test('棋子字符判定', () => {
  assert.equal(isPieceChar('K'), true);
  assert.equal(isPieceChar('p'), true);
  assert.equal(isPieceChar('X'), false);
  assert.equal(isPieceChar(''), false);
  assert.equal(isPieceChar('KK'), false);
});
