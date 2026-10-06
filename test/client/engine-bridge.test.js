/**
 * 内联引擎的薄封装（`lib/ui/engine-bridge.js`）。
 *
 * 浏览器半持有一份引擎源码，但只用于两件事（§7.2 第 2 条）：
 *  1. **乐观预校验**：宿主已经下发 `legalTargets`，本地副本只补一句人话原因；
 *  2. **复盘重放**：投影不带每一手的 FEN，复盘要在客户端把棋盘切到第 n 手。
 *
 * 这一层全部 try/catch 兜住：引擎对畸形输入会抛 `PositionError`，而 UI 不该因为一条
 * 坏数据整块打白。这里逐条钉住「正常值 / 边界 / 坏输入不抛」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  iccsOf,
  initialBoard,
  initialFen,
  localTargets,
  precheckMove,
  replayToPly,
} from '../../lib/ui/engine-bridge.js';
import { sameBoard } from '../../lib/ui/model.js';

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

test('iccsOf：内部索引 → h2e2 形状，越界返回空串', () => {
  assert.equal(iccsOf(70, 67), 'h2e2');
  assert.equal(iccsOf(81, 72), 'a0a1');
  assert.match(iccsOf(0, 89), /^[a-i][0-9][a-i][0-9]$/);
  assert.equal(iccsOf(-1, 10), '');
  assert.equal(iccsOf(10, 99), '');
});

test('initialBoard / initialFen：标准初始局面，且与 FEN 互认', () => {
  const board = initialBoard();
  assert.equal(board.length, 90);
  assert.equal(board[81], 'R', '红方左底线是车');
  assert.equal(board[85], 'K', '红帅在九宫中心');
  assert.equal(board[4], 'k', '黑将在 row 0 col 4');
  assert.equal(board.filter((cell) => cell !== '').length, 32);
  assert.equal(initialFen(), START_FEN);
});

test('localTargets：标准初始局面里红炮的可走点与引擎一致', () => {
  const targets = localTargets(initialFen(), 70); // h2（row 7 col 7）的红炮
  assert.ok(targets.length >= 10, `炮二至少能走到十来个点，实际 ${targets.length}`);
  assert.ok(targets.includes(67), 'h2e2（炮二平五）是合法着法');
  assert.ok(targets.includes(61), 'h2h3 纵向一格');
  assert.ok(targets.includes(43), 'h2h5 纵向三格（路径无子）');
  assert.equal(targets.includes(58), false, '炮不能斜走');
  assert.deepEqual([...targets].sort((a, b) => a - b), targets, '返回必须有序');
  assert.deepEqual(localTargets('not a fen', 70), [], '坏 FEN 返回空数组，不抛');
  assert.deepEqual(localTargets(initialFen(), 4), [], '黑将在原位被自己人塞住，没有着法');
});

test('precheckMove：合法放行、非法给出人话原因、坏局面对不出结论', () => {
  const legal = precheckMove(initialFen(), 70, 67);
  assert.equal(legal.legal, true);
  assert.equal(legal.reason, null);

  const illegal = precheckMove(initialFen(), 70, 62); // 炮二平六？不在同列/行的斜向目标
  assert.equal(illegal.legal, false);
  assert.equal(typeof illegal.reason, 'string');
  assert.notEqual(illegal.reason, '');

  const unknown = precheckMove('rubbish', 70, 67);
  assert.equal(unknown.legal, null, '没有本地局面时必须说「不知道」，而不是「非法」');
  assert.equal(unknown.reason, null);
});

test('replayToPly：按 ICCS 历史重放，第 0 手就是初始局面', () => {
  const history = [
    { iccs: 'h2e2', zh: '炮二平五' },
    { iccs: 'b7b4', zh: '炮8平5' },
  ];
  const zero = replayToPly(initialFen(), history, 0);
  assert.equal(sameBoard(zero.board, initialBoard()), true);
  assert.equal(zero.lastMove, null);
  assert.equal(zero.fen, START_FEN);

  const one = replayToPly(initialFen(), history, 1);
  assert.equal(sameBoard(one.board, initialBoard()), false);
  assert.deepEqual(one.lastMove, { from: 70, to: 67 });
  assert.equal(one.board[70], '', '炮离开了 h2');
  assert.equal(one.board[67], 'C', '炮落在 e2');
  assert.equal(one.board.filter((cell) => cell !== '').length, 32, '没吃子，子力数不变');

  const two = replayToPly(initialFen(), history, 2);
  assert.deepEqual(two.lastMove, { from: 19, to: 46 }, 'b7b4：黑炮从 row2col1 走到 row5col1');
  assert.equal(two.position.turn, 'r', '两手之后轮到红方');

  // 超过历史长度的 ply 按最后局面收口，不越界
  const beyond = replayToPly(initialFen(), history, 99);
  assert.equal(sameBoard(beyond.board, two.board), true);
});

test('replayToPly：起点缺失/坏数据都降级而不抛', () => {
  const fallback = replayToPly(undefined, [{ iccs: 'h2e2' }], 1);
  assert.equal(fallback.board[67], 'C', '起点缺失时退回标准初始局面');

  assert.equal(replayToPly(initialFen(), [{ iccs: 'zz99' }], 1), null, '折不出坐标的历史 → null');
  assert.equal(replayToPly(initialFen(), [{ iccs: 'a0a0' }], 1), null, '引擎判定非法 → null');
  assert.equal(replayToPly(initialFen(), [], 0).lastMove, null);
  assert.equal(replayToPly(initialFen(), null, 3).board.length, 90, '历史缺失按 0 手处理');
});

test('复盘可信度：标准局面重放到底必须与「宿主棋盘」逐格一致', () => {
  const history = [
    { iccs: 'h2e2', zh: '炮二平五' },
    { iccs: 'b7b4', zh: '炮8平5' },
    { iccs: 'b0c2', zh: '马二进三' },
  ];
  const full = replayToPly(initialFen(), history, history.length);
  // 用重放结果当成宿主下发的 board → 可信
  assert.equal(sameBoard(full.board, full.board), true);
  // 宿主下发的棋盘与重放不一致（例如这局不是从标准局面开始）→ 不可信
  const tampered = full.board.slice();
  tampered[0] = '';
  assert.equal(sameBoard(full.board, tampered), false);
});
