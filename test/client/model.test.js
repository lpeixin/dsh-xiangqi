/**
 * 纯函数核心的单测（§7.2「渲染层 / 交互层解耦」的可测面）。
 *
 * 这一层不依赖 DOM、不依赖 React、也不依赖宿主：投影进来，渲染数据出去。每条断言都
 * 对应一个会真实出错的场景——旧响应覆盖新局面、非法目标被放行、窄面板出现横向滚动……
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLL_BASE_MS,
  POLL_MAX_MS,
  POLL_TIMEOUT_MS,
  acceptProjection,
  cellDescriptor,
  cellLabelKeys,
  checkSideOf,
  computeGeometry,
  deriveModel,
  errorKeyOf,
  formatClock,
  formatScore,
  gameOutcome,
  hasHostTargets,
  iccsSquares,
  isProjection,
  kingIndex,
  legalTargetsFor,
  legalTargetsOf,
  messageKeyOf,
  moveRows,
  nextPollDelay,
  normalizeBoard,
  normalizeHints,
  normalizeLastMove,
  pieceSide,
  pollExpired,
  recordText,
  resolveIntent,
  sameBoard,
  shouldPoll,
  statusLine,
  stepCursor,
  unwrapProjection,
} from '../../lib/ui/model.js';

const emptyBoard = () => new Array(90).fill('');

/** 一个形状完整的投影夹具（§7.5.4）。 */
function fixture(overrides) {
  const board = emptyBoard();
  board[0] = 'r';
  board[2] = 'n';
  board[81] = 'R'; // row 9 col 0：红车（红方底线，九路）
  board[85] = 'K'; // row 9 col 4：红帅
  board[4] = 'k'; // row 0 col 4：黑将
  board[13] = 'p'; // row 1 col 4：黑卒（供「可吃子空心环」用）
  board[67] = 'C'; // row 7 col 4（e2）：红炮（h2e2 之后的位置）
  return {
    ok: true,
    revision: 3,
    fen: '3k5/9/9/9/9/9/4C4/9/9/R3K4 w - - 0 1',
    turn: 'r',
    hero: 'r',
    phase: 'playing',
    pending: null,
    status: { state: 'playing', winner: null, reasonZh: '' },
    board,
    lastMove: { from: 70, to: 67, iccs: 'h2e2', zh: '炮二平五' },
    legalTargets: { 67: [58, 49, 40, 13], 81: [72, 80] },
    history: [{ zh: '炮二平五', iccs: 'h2e2', captured: '' }],
    clock: { red: 452000, black: 388000 },
    message: null,
    error: null,
    ...overrides,
  };
}

test('isProjection 只认「90 格 + 数字 revision」的形状', () => {
  assert.equal(isProjection(fixture()), true);
  assert.equal(isProjection({ revision: 1, board: new Array(89).fill('') }), false);
  assert.equal(isProjection({ revision: '1', board: emptyBoard() }), false);
  assert.equal(isProjection(null), false);
  assert.equal(isProjection({ revision: 1, board: emptyBoard() }), true);
});

test('unwrapProjection 认识裸投影与三种包装，认不出返回 null', () => {
  const projection = fixture();
  assert.equal(unwrapProjection(projection), projection);
  assert.equal(unwrapProjection({ snapshot: projection }), projection);
  assert.equal(unwrapProjection({ projection }), projection);
  assert.equal(unwrapProjection({ state: projection }), projection);
  assert.equal(unwrapProjection({ candidates: [] }), null);
  assert.equal(unwrapProjection(undefined), null);
  assert.equal(unwrapProjection({ snapshot: { nope: true } }), null);
});

test('revision 栅栏：只接受更大的 revision，整体替换', () => {
  const first = acceptProjection(null, fixture({ revision: 0 }));
  assert.equal(first.accepted, true);
  assert.equal(first.reason, 'first');

  const older = acceptProjection({ revision: 7 }, fixture({ revision: 5 }));
  assert.equal(older.accepted, false);
  assert.equal(older.reason, 'stale');
  assert.equal(older.projection, null);

  const same = acceptProjection({ revision: 7 }, fixture({ revision: 7 }));
  assert.equal(same.accepted, false);
  assert.equal(same.reason, 'duplicate');

  const newer = acceptProjection({ revision: 7 }, fixture({ revision: 8 }));
  assert.equal(newer.accepted, true);
  assert.equal(newer.reason, 'newer');
  assert.equal(newer.projection.revision, 8);

  const malformed = acceptProjection({ revision: 7 }, { revision: 9 });
  assert.equal(malformed.accepted, false);
  assert.equal(malformed.reason, 'malformed');
});

test('normalizeBoard 会把非字符串/长度不符的棋盘折成 90 格', () => {
  const board = normalizeBoard(['K', 3, null, undefined, 'r']);
  assert.equal(board.length, 90);
  assert.equal(board[0], 'K');
  assert.equal(board[1], '');
  assert.equal(board[4], 'r');
  assert.equal(normalizeBoard('nope').length, 90);
});

test('pieceSide 大小写即颜色；空格是 null', () => {
  assert.equal(pieceSide('K'), 'r');
  assert.equal(pieceSide('k'), 'b');
  assert.equal(pieceSide(''), null);
  assert.equal(pieceSide(undefined), null);
});

test('checkSideOf：state=check 时被将军的是**轮到走子**的一方', () => {
  assert.equal(checkSideOf(fixture({ status: { state: 'check' }, turn: 'b' })), 'b');
  assert.equal(checkSideOf(fixture({ status: { state: 'check' }, turn: 'r' })), 'r');
  assert.equal(checkSideOf(fixture({ status: { state: 'check', side: 'r' }, turn: 'b' })), 'r');
  assert.equal(checkSideOf(fixture({ status: { state: 'playing' } })), null);
  assert.equal(checkSideOf(null), null);
});

test('legalTargetsFor 过滤越界/非整数并排序', () => {
  const projection = fixture({ legalTargets: { 67: [58, -1, 300, 49, 49, '1', 40] } });
  assert.deepEqual(legalTargetsFor(projection, 67), [40, 49, 58], '重复目标要去重');
  assert.deepEqual(legalTargetsFor(projection, 999), []);
  assert.deepEqual(legalTargetsFor(fixture(), 3), []);
  assert.deepEqual(legalTargetsFor(null, 3), []);
});

test('hasHostTargets / legalTargetsOf：宿主说了算，缺表才用本地兜底', () => {
  const host = fixture();
  assert.equal(hasHostTargets(host), true);
  assert.deepEqual(legalTargetsOf(host, 67, [1, 2, 3]), [13, 40, 49, 58]);

  const noTable = fixture({ legalTargets: undefined });
  assert.equal(hasHostTargets(noTable), false);
  assert.deepEqual(legalTargetsOf(noTable, 67, [5, 4, 6]), [4, 5, 6]);

  const emptyForSquare = fixture({ legalTargets: { 67: [], 81: [72] } });
  assert.equal(hasHostTargets(emptyForSquare), true);
  assert.deepEqual(legalTargetsOf(emptyForSquare, 67, [9]), [], '宿主明确说这枚子没着法，不该被兜底覆盖');
  assert.deepEqual(legalTargetsOf(emptyForSquare, 5, [9]), [9], '宿主整表都没有这格，才允许兜底');
});

test('deriveModel：投影 + 本地 UI 状态 → 渲染数据', () => {
  const projection = fixture();
  const model = deriveModel(projection, { selected: 67, cursor: 4, orientation: 'r' });
  assert.equal(model.revision, 3);
  assert.equal(model.turn, 'r');
  assert.equal(model.hero, 'r');
  assert.equal(model.phase, 'playing');
  assert.equal(model.pending, null);
  assert.equal(model.reviewing, false);
  assert.equal(model.selected, 67);
  assert.deepEqual(model.legalTargets, [13, 40, 49, 58]);
  assert.deepEqual(model.captureTargets, [13]);
  assert.deepEqual(model.lastMove, { from: 70, to: 67 });
  assert.equal(model.interactive, true);
  assert.equal(model.checkSide, null);
  assert.equal(model.board.length, 90);
  assert.equal(model.hostTargets, true);
});

test('deriveModel：非我方回合不给可走点、不可交互（只读高亮由 inspect 负责）', () => {
  const model = deriveModel(fixture({ turn: 'b' }), { selected: 67 });
  assert.deepEqual(model.legalTargets, []);
  assert.equal(model.interactive, false);
});

test('deriveModel：复盘态只读、不出提示', () => {
  const model = deriveModel(fixture(), { selected: 67, reviewPly: 1, hints: [{ iccs: 'h2e2' }] });
  assert.equal(model.reviewing, true);
  assert.deepEqual(model.legalTargets, []);
  assert.deepEqual(model.hints, []);
  assert.equal(model.interactive, false);
});

test('resolveIntent：点选 / 取消 / 改选 / 落子 / 拒绝 全矩阵', () => {
  const model = deriveModel(fixture(), { selected: null });
  // 点己方子 → 选中
  assert.deepEqual(resolveIntent(model, null, 81), { kind: 'select', index: 81 });
  // 点对方子（无选中）→ 只高亮
  assert.deepEqual(resolveIntent(model, null, 0), { kind: 'inspect', index: 0 });
  // 点空格（无选中）→ 什么也不做
  assert.deepEqual(resolveIntent(model, null, 50), { kind: 'noop' });

  const picked = deriveModel(fixture(), { selected: 67 });
  // 点同一子 → 取消
  assert.deepEqual(resolveIntent(picked, 67, 67), { kind: 'deselect' });
  // 点另一己方子 → 改选
  assert.deepEqual(resolveIntent(picked, 67, 81), { kind: 'select', index: 81 });
  // 点合法目标 → 落子
  assert.equal(resolveIntent(picked, 67, 40).kind, 'move');
  // 点非法目标（己方子也不行：81 会被当成改选）→ 空格非法目标才是 reject
  assert.deepEqual(resolveIntent(picked, 67, 30), { kind: 'reject', from: 67, to: 30, code: 'move.invalid' });
  // 越界点 → noop
  assert.deepEqual(resolveIntent(picked, 67, 200), { kind: 'noop' });
});

test('resolveIntent：非我方回合、结束、复盘三种只读各有机器码', () => {
  const notMine = deriveModel(fixture({ turn: 'b' }), { selected: null });
  assert.deepEqual(resolveIntent(notMine, null, 67), { kind: 'inspect', index: 67 });
  assert.equal(resolveIntent(notMine, 67, 40).code, 'move.not-your-turn');

  const finished = deriveModel(
    fixture({ phase: 'finished', status: { state: 'checkmate', winner: 'r' } }),
    { selected: null },
  );
  assert.equal(resolveIntent(finished, 67, 40).code, 'game.finished');

  const reviewing = deriveModel(fixture(), { selected: null, reviewPly: 1 });
  assert.equal(resolveIntent(reviewing, 67, 40).code, 'game.review');
});

test('stepCursor：屏幕方向与翻盘', () => {
  const index = 4 * 9 + 4; // 第 5 行第 5 列
  const up = stepCursor(index, -1, 0, 'r');
  assert.equal(up, 3 * 9 + 4);
  const left = stepCursor(index, 0, -1, 'r');
  assert.equal(left, 4 * 9 + 3);
  assert.equal(stepCursor(0, -1, 0, 'r'), null, '移出棋盘返回 null');
  assert.equal(stepCursor(0, 0, -1, 'r'), null);
  // 翻盘后「屏幕向上」= 内部 row 增加
  assert.equal(stepCursor(index, -1, 0, 'b'), 5 * 9 + 4);
  assert.equal(stepCursor(index, 0, -1, 'b'), 4 * 9 + 5);
  assert.equal(stepCursor(-1, 0, 1, 'r'), null);
});

test('computeGeometry：u 自适应，260 px 以下隐藏着法列表', () => {
  const wide = computeGeometry(400, 600);
  assert.equal(wide.showMoveList, true);
  assert.equal(wide.showToolbarLabels, true);
  assert.ok(Math.abs(wide.viewW / wide.viewH - 9.3 / 10.3) < 1e-9);
  assert.ok(wide.u <= 400 / 9.3 + 1e-9);

  const narrow = computeGeometry(250, 600);
  assert.equal(narrow.showMoveList, false);
  assert.equal(narrow.showToolbarLabels, false);
  // 纵向受限时以高度为准：量到尺寸就必须放得下，不能因为「最小值」把棋盘撑出容器
  const short = computeGeometry(1000, 103);
  assert.ok(short.u <= 10 + 1e-9, `u=${short.u} 会撑破 103 px 高的容器`);
  assert.ok(Math.abs(short.u - 10) < 1e-6);

  const unmeasured = computeGeometry(0, 0);
  assert.ok(unmeasured.u > 0, '还没量到尺寸时也要给出一个可用单位，不能是 0');
  assert.equal(unmeasured.showMoveList, true);
});

test('computeGeometry：u 有绝对下限与上限，永远不会是 0 或负', () => {
  for (const [w, h] of [[1000, 1000], [100, 100], [4000, 3000], [10, 10], [-5, -5]]) {
    const g = computeGeometry(w, h);
    assert.ok(g.u >= 4 && g.u <= 62, `${w}x${h} → u=${g.u}`);
    assert.ok(g.viewW > 0 && g.viewH > 0);
  }
});

test('轮询退避序列：800 → ×1.35 → 2 s 封顶', () => {
  const seq = [0, 1, 2, 3, 4, 5, 10].map((n) => nextPollDelay(n));
  assert.deepEqual(seq.slice(0, 4), [800, 1080, 1458, 1968]);
  assert.equal(seq[4], POLL_MAX_MS);
  assert.equal(POLL_BASE_MS, 800);
  assert.equal(POLL_MAX_MS, 2000);
  assert.equal(seq[6], POLL_MAX_MS);
  assert.equal(nextPollDelay(-3), 800);
  assert.equal(nextPollDelay(1.5), 800, '非整数 attempt 按 0 处理');
  assert.deepEqual(
    [0, 1, 2].map((n) => nextPollDelay(n, { baseMs: 100, factor: 2, maxMs: 500 })),
    [100, 200, 400],
  );
});

test('shouldPoll / pollExpired：只在该轮询时轮询，30 s 收工', () => {
  assert.equal(shouldPoll(fixture({ pending: 'ai-thinking' }), true), true);
  assert.equal(shouldPoll(fixture({ pending: 'ai-thinking' }), false), false, '不可见 = 零轮询');
  assert.equal(shouldPoll(fixture({ pending: null }), true), false);
  assert.equal(shouldPoll(fixture({ pending: 'ai-failed' }), true), false);
  assert.equal(shouldPoll(null, true), false);

  assert.equal(POLL_TIMEOUT_MS, 75000, '必须大于宿主默认的 60 s 应招超时');
  assert.equal(pollExpired(29999), false);
  assert.equal(pollExpired(75000), true);
  assert.equal(pollExpired(60000, 1000), true);
  assert.equal(pollExpired(undefined), false);
});

test('statusLine 的优先级：本地消息 > 离线 > 错误 > 宿主消息 > 结局 > 将军 > 思考中', () => {
  const thinking = fixture({ pending: 'ai-thinking' });
  assert.equal(statusLine(thinking, { elapsedMs: 2400 }).key, 'status.aiThinking');
  assert.deepEqual(statusLine(thinking, { elapsedMs: 2400 }).params, { seconds: 2 });

  assert.equal(statusLine(thinking, { offline: true }).key, 'status.rpcUnavailable');
  assert.equal(
    statusLine(thinking, { offline: true, notice: { key: 'status.copied', tone: 'success' } }).key,
    'status.copied',
  );
  assert.equal(
    statusLine(fixture({ error: { code: 'move.self-check', reasonZh: '送将' } }), {}).key,
    'error.selfCheck',
  );
  assert.equal(
    statusLine(fixture({ error: { code: 'weird.code', reasonZh: '引擎说不行' } }), {}).params.reason,
    '引擎说不行',
  );
  assert.equal(
    statusLine(fixture({ message: { code: 'ai.fallback.local', tone: 'warn' } }), {}).key,
    'status.aiFallback',
  );
  assert.equal(
    statusLine(fixture({ message: { code: 'unknown.code' } }), {}).key,
    'status.ready',
    '未登记的 message 码不该把原始码显示给用户',
  );
  assert.equal(statusLine(fixture({ status: { state: 'check' } }), {}).key, 'status.check.red');
  assert.equal(
    statusLine(fixture({ phase: 'finished', status: { state: 'checkmate', winner: 'b' } }), {}).key,
    'status.result.checkmate.red',
  );
  assert.equal(statusLine(null, {}).key, 'status.connecting');
  assert.equal(statusLine(fixture(), {}).key, 'status.ready');
});

test('gameOutcome 覆盖将死 / 困毙 / 和棋 / 认输 / 只有 winner', () => {
  assert.deepEqual(gameOutcome(fixture()), null);
  assert.equal(
    gameOutcome(fixture({ phase: 'finished', status: { state: 'checkmate', winner: 'r' } })).key,
    'status.result.checkmate.black',
  );
  assert.equal(
    gameOutcome(fixture({ phase: 'finished', turn: 'b', status: { state: 'stalemate' } })).key,
    'status.result.stalemate.black',
  );
  const draw = gameOutcome(
    fixture({ phase: 'finished', status: { state: 'draw-fifty', reasonZh: '自然限着' } }),
  );
  assert.equal(draw.key, 'status.result.draw');
  assert.deepEqual(draw.params, { reason: '自然限着' });
  assert.equal(
    gameOutcome(fixture({ phase: 'finished', status: { state: 'resign', winner: 'r' } })).key,
    'status.result.resign.black',
  );
  assert.equal(
    gameOutcome(fixture({ phase: 'finished', status: { winner: 'b' } })).key,
    'status.result.win.black',
  );
  assert.equal(gameOutcome(fixture({ phase: 'finished', status: {} })).key, 'status.result.finished');
  for (const state of ['checkmate', 'stalemate', 'resign']) {
    const outcome = gameOutcome(fixture({ phase: 'finished', status: { state, winner: 'r' } }));
    assert.equal(outcome.assertive, true, '结局必须用 assertive 播报');
  }
});

test('机器码映射：未登记的码返回 null（不显示原始码）', () => {
  assert.equal(messageKeyOf('ai.fallback.local'), 'status.aiFallback');
  assert.equal(messageKeyOf('nope'), null);
  assert.equal(messageKeyOf(undefined), null);
  assert.equal(errorKeyOf('move.face-to-face'), 'error.faceToFace');
  assert.equal(errorKeyOf('move.self-check'), 'error.selfCheck');
  assert.equal(errorKeyOf('nope'), null);
  assert.equal(errorKeyOf(42), null);
});

test('normalizeLastMove 接受 {from,to}、ICCS 串与 null', () => {
  assert.deepEqual(normalizeLastMove({ from: 1, to: 2 }), { from: 1, to: 2 });
  assert.deepEqual(normalizeLastMove({ iccs: 'h2e2' }), { from: 70, to: 67 });
  assert.deepEqual(normalizeLastMove('h2e2'), { from: 70, to: 67 });
  assert.equal(normalizeLastMove(null), null);
  assert.equal(normalizeLastMove('zz99'), null);
  assert.deepEqual(iccsSquares('a0a1'), { from: 81, to: 72 });
  assert.equal(iccsSquares('a0'), null);
});

test('normalizeHints 至多 3 条，折不出坐标的条目被丢弃', () => {
  const hints = normalizeHints({
    candidates: [
      { iccs: 'h2e2', zh: '炮二平五', score: 12 },
      { iccs: 'b7b4', zh: '炮8平5', score: 3 },
      { from: 0, to: 9, zh: '车1进1', score: 1 },
      { iccs: 'bad', zh: '坏数据' },
      { iccs: 'a0a1', zh: '车九进一', score: -2 },
    ],
  });
  assert.equal(hints.length, 3);
  assert.deepEqual(hints.map((h) => [h.rank, h.from, h.to]), [[0, 70, 67], [1, 19, 46], [2, 0, 9]]);
  assert.deepEqual(normalizeHints(undefined), []);
  assert.deepEqual(normalizeHints({ hints: [{ iccs: 'a0a1' }] }).length, 1);
});

test('moveRows 每行两手，奇数手时黑方为 null', () => {
  const rows = moveRows([
    { zh: '炮二平五', iccs: 'h2e2' },
    { zh: '马8进7', iccs: 'b7c5' },
    { zh: '马二进三', iccs: 'h0g2' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].no, 1);
  assert.deepEqual(rows[0].red, { ply: 1, index: 0, zh: '炮二平五', iccs: 'h2e2', captured: '' });
  assert.equal(rows[1].black, null);
  assert.equal(rows[1].red.ply, 3);
  assert.deepEqual(moveRows(undefined), []);
  assert.deepEqual(moveRows([null, 'x'])[0].red.zh, '');
});

test('cellDescriptor：以「该子一方」为参照的读屏描述', () => {
  // row 9 col 0 的红车 = 九路、红方底线
  const red = cellDescriptor(81, 'R');
  assert.deepEqual(
    { side: red.side, fileNumber: red.fileNumber, rankIndex: red.rankIndex, piece: red.piece },
    { side: 'r', fileNumber: 9, rankIndex: 0, piece: 'R' },
  );
  // row 0 col 0 的黑车 = 1 路、黑方底线
  const black = cellDescriptor(0, 'r');
  assert.deepEqual(
    { side: black.side, fileNumber: black.fileNumber, rankIndex: black.rankIndex },
    { side: 'b', fileNumber: 1, rankIndex: 0 },
  );
  // 红方兵行线：row 6 → rankIndex 3
  assert.equal(cellDescriptor(6 * 9 + 0, 'P').rankIndex, 3);
  assert.equal(cellDescriptor(81, '').side, null);
  assert.equal(cellDescriptor(-1, 'R'), null);
  assert.equal(cellDescriptor(90, 'R'), null);
});

test('cellLabelKeys 只产出键，翻译留给组件（纯函数不认识 locale）', () => {
  const red = cellLabelKeys(81, 'R');
  assert.equal(red.template, 'board.cellAria');
  assert.deepEqual(red.params, {
    side: 'board.side.r',
    piece: 'board.piece.r.R',
    file: 'board.file.9',
    rank: 'board.rank.0',
  });
  const empty = cellLabelKeys(50, '');
  assert.equal(empty.template, 'board.emptyCell');
  assert.deepEqual(empty.params, { file: 'board.file.4', rank: 'board.rank.4' });
  assert.equal(cellLabelKeys(999, 'R'), null);
});

test('sameBoard / kingIndex：复盘可信度自检与将军环定位', () => {
  const a = ['K', '', 'k', ...new Array(87).fill('')];
  assert.equal(sameBoard(a, a.slice()), true);
  const b = a.slice();
  b[5] = 'R';
  assert.equal(sameBoard(a, b), false);
  assert.equal(sameBoard(a, a.slice(0, 89)), false, '长度不符一律不一致');
  assert.equal(sameBoard(null, a), false);
  assert.equal(kingIndex(a, 'r'), 0);
  assert.equal(kingIndex(a, 'b'), 2);
  assert.equal(kingIndex(new Array(90).fill(''), 'r'), null, '找不到将/帅返回 null');
  assert.equal(kingIndex(a, null), null);
});

test('formatClock 是 m:ss，非法输入不崩', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(452000), '7:32');
  assert.equal(formatClock(59999), '0:59');
  assert.equal(formatClock(-1), '--:--');
  assert.equal(formatClock(Number.NaN), '--:--');
  assert.equal(formatClock(undefined), '--:--');
});

test('formatScore：厘兵 → 带符号的兵值', () => {
  assert.equal(formatScore(12), '+0.1');
  assert.equal(formatScore(100), '+1.0');
  assert.equal(formatScore(-250), '-2.5');
  assert.equal(formatScore(0), '0.0');
  assert.equal(formatScore(3), '0.0', '4 厘兵以内视为均势');
  assert.equal(formatScore(-4), '0.0');
  assert.equal(formatScore(Number.NaN), '');
  assert.equal(formatScore(undefined), '');
});

test('recordText 给出「逐行棋谱 + FEN」，且**语言中立**、带 ICCS，可粘贴进任何象棋软件', () => {
  const projection = fixture({ initialFen: 'START-FEN' });
  const text = recordText(projection);
  // 标签刻意不跟随界面语言：这是数据格式，同一个棋谱不该因界面语言而变样。
  assert.match(text, /# initial FEN START-FEN/);
  assert.match(text, /# current FEN /);
  // 每一手同时给中文记谱与 ICCS，非中文读者/引擎也能用。
  assert.match(text, /1\. 炮二平五 \([a-i][0-9][a-i][0-9]\)/);
  assert.equal(recordText(null), '');
});
