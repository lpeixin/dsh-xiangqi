/**
 * 浏览器半的纯函数核心：投影 → 渲染数据、revision 栅栏、轮询退避、命中意图。
 *
 * 这一层是「渲染层 / 交互层解耦」（§7.2）的落点，也是**唯一**能脱离 React 单测的
 * 部分（`test/client/*.test.js` 没有 DOM）：所有函数都是纯函数，不碰 ctx、不碰
 * document、不订阅任何东西。组件只做两件事——调这些函数、把结果画出来。
 *
 * 座标换算沿用引擎 `lib/engine/coords.js`（§5.1 的唯一真相），因此这里不重复实现
 * ICCS / 文件号 / 行列互换。
 */

import { BLACK_SIDE, RED_SIDE, colToFileNumber, iccsToSquare, idxToCol, idxToRow, isOnBoard } from '../engine/coords.js';

/** 轮询退避：800 ms 起、×1.35、2 s 封顶（§7.5.3）。 */
export const POLL_BASE_MS = 800;
export const POLL_FACTOR = 1.35;
export const POLL_MAX_MS = 2000;
/** 轮询最长 30 s，超过就停下并提示用户可点「由本地引擎代走」。 */
export const POLL_TIMEOUT_MS = 30000;
/** 低于此宽度隐藏着法列表（§7.3）。 */
export const MIN_USABLE_WIDTH = 260;
/** 棋盘几何：8u×9u 网格 + 每边 0.65u 外边距。 */
export const BOARD_SPAN_X = 8 + 1.3;
export const BOARD_SPAN_Y = 9 + 1.3;
/** 还没量到容器尺寸时用的默认单位（能画出一张可读的盘，也不是 0）。 */
const DEFAULT_UNIT = 30;
/** 上限：宽屏主面板里棋盘不该无限放大。 */
const MAX_UNIT = 62;
/** 绝对下限：容器被压到极小也不能算出 0 或负数（否则 viewBox 退化）。 */
const MIN_UNIT = 4;

/** 投影是否是我们认识的那一段 JSON（有数字 revision 与 90 格 board）。 */
export function isProjection(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isFinite(value.revision) &&
    Array.isArray(value.board) &&
    value.board.length === 90
  );
}

/**
 * 从 RPC 返回值里取出投影。
 *
 * 宿主可能直接返回投影，也可能包一层（`{ snapshot }` / `{ projection }` / `{ state }`）。
 * 这里三种都认，认不出来就返回 null，由调用方走降级分支——**不猜**。
 * @param value - RPC 的 `value` 字段。
 * @returns 投影，或 null。
 */
export function unwrapProjection(value) {
  if (isProjection(value)) return value;
  if (typeof value !== 'object' || value === null) return null;
  for (const key of ['snapshot', 'projection', 'state']) {
    if (isProjection(value[key])) return value[key];
  }
  return null;
}

/**
 * revision 栅栏：只接受更大的 revision，整体替换（§7.5.4 第 3 条）。
 *
 * 相同 revision 一律丢弃——重复响应不该让组件重渲染，否则打不开的竞态会表现成闪烁。
 * @param current - 当前已接受的最小栅栏 `{ revision }`，或 null。
 * @param incoming - 新到的投影。
 * @returns `{ accepted, reason, projection }`。
 */
export function acceptProjection(current, incoming) {
  const fence = current === null || current === undefined ? null : current.revision;
  if (!isProjection(incoming)) {
    return { accepted: false, reason: 'malformed', projection: null };
  }
  if (fence === null || !Number.isFinite(fence)) {
    return { accepted: true, reason: 'first', projection: incoming };
  }
  if (incoming.revision > fence) return { accepted: true, reason: 'newer', projection: incoming };
  return {
    accepted: false,
    reason: incoming.revision === fence ? 'duplicate' : 'stale',
    projection: null,
  };
}

/** 棋子颜色（'r' | 'b' | null）。 */
export function pieceSide(piece) {
  if (typeof piece !== 'string' || piece.length === 0) return null;
  return piece === piece.toUpperCase() ? RED_SIDE : BLACK_SIDE;
}

/**
 * 该局面里哪一方的将/帅被将军。
 *
 * `state === 'check'` 的含义是「**轮到走子的一方**被将军」，因此被将军方就是 `turn`；
 * 宿主若显式给了 `status.side` 则以它为准。
 * @param projection - 投影。
 * @returns 'r' | 'b' | null。
 */
export function checkSideOf(projection) {
  if (projection === null || typeof projection !== 'object') return null;
  const status = projection.status;
  if (status === null || typeof status !== 'object') return null;
  if (status.side === RED_SIDE || status.side === BLACK_SIDE) return status.side;
  if (status.state !== 'check') return null;
  return projection.turn === BLACK_SIDE ? BLACK_SIDE : RED_SIDE;
}

/**
 * 宿主是否下发了可用的 `legalTargets` 表。
 *
 * 系统里只有一份规则真相（宿主），客户端副本只做乐观预校验。因此「表存在」就意味着
 * **宿主说了算**；表整个缺失时才退回本地引擎兜底（双份规则的分歧风险只在降级路径上）。
 * @param projection - 投影。
 * @returns 布尔值。
 */
export function hasHostTargets(projection) {
  if (projection === null || typeof projection !== 'object') return false;
  const table = projection.legalTargets;
  if (table === null || typeof table !== 'object' || Array.isArray(table)) return false;
  for (const key of Object.keys(table)) {
    if (Array.isArray(table[key])) return true;
  }
  return false;
}

/**
 * 某一格的可走点。
 *
 * 优先用宿主下发的 `legalTargets`；整表缺失时用 `fallbackTargets`（本地引擎算的），
 * 两者都没有就返回空数组。
 * @param projection - 投影。
 * @param from - 起点格号。
 * @param fallbackTargets - 本地引擎的兜底结果。
 * @returns 排序后的目标格号数组。
 */
export function legalTargetsOf(projection, from, fallbackTargets) {
  if (hasHostTargets(projection)) {
    const host = legalTargetsFor(projection, from);
    if (host.length > 0) return host;
    // 宿主有表但这格没有条目：可能是「这枚子无着法」，也可能是投影刚被裁过。
    // 只有当宿主对**整个** from 都没给过条目时才接受空结果。
    const table = projection.legalTargets;
    if (Object.prototype.hasOwnProperty.call(table, String(from))) return [];
  }
  if (!Array.isArray(fallbackTargets)) return [];
  return fallbackTargets.filter((n) => Number.isInteger(n) && n >= 0 && n < 90).sort((a, b) => a - b);
}

/**
 * 某一格的可走点（宿主下发的 `legalTargets`，§7.5.4 第 1 条）。
 * @param projection - 投影。
 * @param from - 起点格号。
 * @returns 排序后的目标格号数组。
 */
export function legalTargetsFor(projection, from) {
  if (projection === null || typeof projection !== 'object') return [];
  if (from === null || from === undefined || from < 0) return [];
  const table = projection.legalTargets;
  if (table === null || typeof table !== 'object') return [];
  const raw = table[String(from)];
  if (!Array.isArray(raw)) return [];
  const unique = new Set();
  for (const value of raw) {
    if (Number.isInteger(value) && value >= 0 && value < 90) unique.add(value);
  }
  return [...unique].sort((a, b) => a - b);
}

/**
 * 一格的读屏描述（§7.7：「红方 车，九路，底线」）。
 *
 * 只产出**结构化**描述，不做翻译：`{ side, piece, fileNumber, rankIndex }`。
 * 组件再按 `board.cellAria` 与 `board.piece.*` / `board.rank.*` 组装成本地化文本。
 *
 * 空格没有「自己一方」，但读屏仍要能报出位置，因此**空格以红方视角**（也就是默认
 * 画法）给出文件号与纵线名：`board.file.*` / `board.rank.*` 的下标都是按这个口径
 * 生成的，不能出现 `board.file.0` 这种字典里没有的键。
 * @param index - 格号 0..89。
 * @param piece - 该格棋子字符（空串表示空）。
 * @returns 描述对象；格号非法时返回 null。
 */
export function cellDescriptor(index, piece) {
  const row = idxToRow(index);
  const col = idxToCol(index);
  if (row < 0 || col < 0) return null;
  const side = pieceSide(piece);
  const view = side === BLACK_SIDE ? BLACK_SIDE : RED_SIDE;
  // 纵线名以「该子自己一方」为参照：红方底线是 row 9，黑方底线是 row 0。
  const rankIndex = view === BLACK_SIDE ? row : 9 - row;
  return {
    index,
    row,
    col,
    piece: typeof piece === 'string' ? piece : '',
    side,
    fileNumber: colToFileNumber(col, view),
    rankIndex,
  };
}

/**
 * 读屏标签的**键组合**（不含翻译）。
 *
 * 纯函数层不认识 locale，也不该拼中文；它只回答「用哪个模板、每个占位符取哪个键」，
 * 由组件用 `t` 逐项解析。这样 `aria-label` 的两套语言与字典键集天然对齐。
 * @param index - 格号。
 * @param piece - 该格棋子字符。
 * @returns `{ template, params }` 或 null（格号非法）。
 */
export function cellLabelKeys(index, piece) {
  const described = cellDescriptor(index, piece);
  if (described === null) return null;
  const file = `board.file.${described.fileNumber}`;
  const rank = `board.rank.${described.rankIndex}`;
  if (described.piece === '') {
    return { template: 'board.emptyCell', params: { file, rank } };
  }
  return {
    template: 'board.cellAria',
    params: {
      side: `board.side.${described.side}`,
      piece: `board.piece.${described.side}.${described.piece}`,
      file,
      rank,
    },
  };
}

/**
 * 两个棋盘是否逐格相同（复盘可信度自检用）。
 *
 * 复盘靠客户端内联的引擎**重放**投影里的 ICCS 历史；投影不带每一手的 FEN，也不带
 * `initialFen`，所以起点按标准初始局面假定。标准初始局面重放出来的最后一手必须与
 * 宿主下发的棋盘完全一致——不一致说明这局不是从标准局面开始的，此时宁可关掉复盘，
 * 也不能给用户看一个错的局面。
 * @param a - 棋盘数组。
 * @param b - 棋盘数组。
 * @returns 布尔值。
 */
export function sameBoard(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== 90 || b.length !== 90) return false;
  for (let i = 0; i < 90; i += 1) {
    const left = typeof a[i] === 'string' ? a[i] : '';
    const right = typeof b[i] === 'string' ? b[i] : '';
    if (left !== right) return false;
  }
  return true;
}

/**
 * 某一块棋盘上某方的将/帅格号（画将军脉冲环用）。
 * @param board - 棋盘数组。
 * @param side - 'r' | 'b' | null。
 * @returns 格号，找不到返回 null。
 */
export function kingIndex(board, side) {
  if (!Array.isArray(board) || (side !== RED_SIDE && side !== BLACK_SIDE)) return null;
  const index = board.indexOf(side === RED_SIDE ? 'K' : 'k');
  return index < 0 ? null : index;
}

const EMPTY_BOARD = Object.freeze(new Array(90).fill(''));/** 把任意长度的 board 补齐/截断成 90 格（宿主的投影理论上是 90，防御性处理）。 */
export function normalizeBoard(board) {
  if (!Array.isArray(board)) return EMPTY_BOARD.slice();
  const out = new Array(90);
  for (let i = 0; i < 90; i += 1) {
    const cell = board[i];
    out[i] = typeof cell === 'string' ? cell : '';
  }
  return out;
}

/**
 * 把 ICCS 着法串（如 `h2e2`）折成 `{ from, to }`。
 * @param iccs - 4 字符串。
 * @returns `{ from, to }`，非法时返回 null。
 */
export function iccsSquares(iccs) {
  if (typeof iccs !== 'string' || iccs.length !== 4) return null;
  const from = iccsToSquare(iccs.slice(0, 2));
  const to = iccsToSquare(iccs.slice(2, 4));
  if (from < 0 || to < 0) return null;
  return { from, to };
}

/** 把 lastMove（可能是 `{ from, to }`、ICCS 串或 null）折成 `{ from, to }`。 */
export function normalizeLastMove(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return iccsSquares(raw);
  if (typeof raw !== 'object') return null;
  if (Number.isInteger(raw.from) && Number.isInteger(raw.to)) {
    return { from: raw.from, to: raw.to };
  }
  return iccsSquares(raw.iccs);
}

/**
 * 归一化宿主下发的提示着法。
 *
 * 接受 `{ candidates: [...] }`、数组、或 `{ hints: [...] }`；每条至少要有 ICCS 或
 * 显式的 from/to。折不出坐标的条目直接丢弃——画不出箭头的东西不该进渲染层。
 * @param value - RPC 返回值或投影里的 hints。
 * @returns `[{ from, to, zh, score, rank }]`，最多 3 条（§7.4 提示显示 3 条）。
 */
export function normalizeHints(value) {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value && value.candidates)
      ? value.candidates
      : Array.isArray(value && value.hints)
        ? value.hints
        : [];
  const out = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const squares =
      Number.isInteger(item.from) && Number.isInteger(item.to)
        ? { from: item.from, to: item.to }
        : iccsSquares(item.iccs);
    if (squares === null) continue;
    out.push({
      from: squares.from,
      to: squares.to,
      zh: typeof item.zh === 'string' ? item.zh : '',
      score: Number.isFinite(item.score) ? item.score : null,
      iccs: typeof item.iccs === 'string' ? item.iccs : '',
      rank: out.length,
    });
    if (out.length === 3) break;
  }
  return out;
}

/**
 * 投影 + 本地 UI 状态 → 渲染层直接消费的数据（§7.2：只有可渲染的派生数据）。
 * @param projection - 宿主投影。
 * @param ui - 本地 UI 状态：`{ selected, cursor, hints, reviewPly, orientation }`。
 * @returns 渲染模型。
 */
export function deriveModel(projection, ui) {
  const state = ui === undefined || ui === null ? {} : ui;
  const p = projection === null || typeof projection !== 'object' ? {} : projection;
  const board = normalizeBoard(p.board);
  const turn = p.turn === BLACK_SIDE ? BLACK_SIDE : RED_SIDE;
  const hero = p.hero === BLACK_SIDE ? BLACK_SIDE : RED_SIDE;
  const phase = p.phase === 'playing' || p.phase === 'finished' ? p.phase : 'idle';
  const pending = p.pending === 'ai-thinking' || p.pending === 'ai-failed' ? p.pending : null;
  const finished = phase === 'finished';
  const reviewPly = Number.isInteger(state.reviewPly) && state.reviewPly >= 0 ? state.reviewPly : null;
  const reviewing = reviewPly !== null;
  const selected = Number.isInteger(state.selected) && state.selected >= 0 && state.selected < 90 ? state.selected : null;
  const canSelect = !reviewing && !finished && turn === hero;
  const legalTargets = canSelect && selected !== null ? legalTargetsOf(p, selected, state.fallbackTargets) : [];
  return {
    revision: Number.isFinite(p.revision) ? p.revision : 0,
    board,
    turn,
    hero,
    phase,
    pending,
    finished,
    reviewPly,
    reviewing,
    selected,
    legalTargets,
    hostTargets: hasHostTargets(p),
    captureTargets: legalTargets.filter((index) => board[index] !== ''),
    cursor: Number.isInteger(state.cursor) && state.cursor >= 0 && state.cursor < 90 ? state.cursor : null,
    orientation: state.orientation === BLACK_SIDE ? BLACK_SIDE : RED_SIDE,
    lastMove: normalizeLastMove(p.lastMove),
    hints: reviewing ? [] : normalizeHints(state.hints),
    checkSide: checkSideOf(p),
    interactive: canSelect && pending !== 'ai-thinking',
    fen: typeof p.fen === 'string' ? p.fen : '',
    history: Array.isArray(p.history) ? p.history : [],
    clock: p.clock !== null && typeof p.clock === 'object' ? p.clock : null,
    usage: p.usage !== null && typeof p.usage === 'object' ? p.usage : null,
    opponent: p.opponent !== null && typeof p.opponent === 'object' ? p.opponent : null,
  };
}

/**
 * 一次点击产出什么「意图」（§7.4 的十二条都归约到这里）。
 *
 * 交互层只上报意图，合法性判定仍以宿主为准（§7.2 第 2 条）。返回的 `code` 是
 * **机器码**，由组件查字典成本地化文案，这一层不认识 locale。
 * @param model - `deriveModel` 的结果。
 * @param from - 当前选中的格号（无选中为 null）。
 * @param to - 被点的格号。
 * @returns `{ kind, index?, from?, to?, code? }`。
 */
export function resolveIntent(model, from, to) {
  if (model === null || model === undefined) return { kind: 'noop' };
  if (!Number.isInteger(to) || to < 0 || to >= 90) return { kind: 'noop' };
  const piece = model.board[to];
  const own = piece !== '' && pieceSide(piece) === model.turn;
  const selectable = !model.reviewing && !model.finished && model.turn === model.hero && own;

  if (from === null || from === undefined || !Number.isInteger(from)) {
    if (selectable) return { kind: 'select', index: to };
    if (piece !== '') return { kind: 'inspect', index: to };
    return { kind: 'noop' };
  }
  if (to === from) return { kind: 'deselect' };
  if (selectable) return { kind: 'select', index: to };
  if (model.reviewing) return { kind: 'reject', from, to, code: 'game.review' };
  if (model.finished) return { kind: 'reject', from, to, code: 'game.finished' };
  if (model.turn !== model.hero) return { kind: 'reject', from, to, code: 'move.not-your-turn' };
  if (model.legalTargets.indexOf(to) >= 0) return { kind: 'move', from, to };
  return { kind: 'reject', from, to, code: 'move.invalid' };
}

/**
 * 键盘光标的移动（§7.4 键盘走子）。
 *
 * 参数是**屏幕方向**的位移（ArrowUp 就是屏幕向上），翻盘（`orientation === 'b'`）时
 * 反向映射回内部行列——否则黑方视角下方向键会上下颠倒。
 * @param index - 当前光标格号。
 * @param dVisualRow - 屏幕行位移（上为负）。
 * @param dVisualCol - 屏幕列位移（左为负）。
 * @param orientation - 'r'（红方在下，默认）或 'b'。
 * @returns 新格号；移出棋盘返回 null。
 */
export function stepCursor(index, dVisualRow, dVisualCol, orientation) {
  const row = idxToRow(index);
  const col = idxToCol(index);
  if (row < 0 || col < 0) return null;
  const flip = orientation === BLACK_SIDE;
  const nextRow = row + (flip ? -dVisualRow : dVisualRow);
  const nextCol = col + (flip ? -dVisualCol : dVisualCol);
  if (!isOnBoard(nextRow, nextCol)) return null;
  return nextRow * 9 + nextCol;
}

/**
 * 棋盘几何（§7.3）：`u = min((W - 2·pad)/8, (H - 2·pad)/9)`，等价于
 * `u = min(W / 9.3, H / 10.3)`（pad = 0.65u 已折进分母）。
 * @param width - 容器宽度（px）。
 * @param height - 容器高度（px）；未知时传 0。
 * @returns `{ u, viewW, viewH, showMoveList, showToolbarLabels }`。
 */
export function computeGeometry(width, height) {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const byWidth = w > 0 ? w / BOARD_SPAN_X : Number.POSITIVE_INFINITY;
  const byHeight = h > 0 ? h / BOARD_SPAN_Y : Number.POSITIVE_INFINITY;
  let u = Math.min(byWidth, byHeight);
  // 一个尺寸都没量到时给默认值；量到了就必须严格按可用空间缩放（不出现横向滚动）。
  if (!Number.isFinite(u) || u <= 0) u = DEFAULT_UNIT;
  u = Math.max(MIN_UNIT, Math.min(MAX_UNIT, u));
  return {
    u,
    viewW: u * BOARD_SPAN_X,
    viewH: u * BOARD_SPAN_Y,
    showMoveList: w === 0 || w >= MIN_USABLE_WIDTH,
    showToolbarLabels: w === 0 || w >= 320,
  };
}

/**
 * 下一次轮询的间隔（指数退避，2 s 封顶）。
 * @param attempt - 已经轮询过的次数，从 0 起。
 * @param opts - `{ baseMs, factor, maxMs }` 覆盖默认值（测试用）。
 * @returns 毫秒数。
 */
export function nextPollDelay(attempt, opts) {
  const o = opts === undefined || opts === null ? {} : opts;
  const base = Number.isFinite(o.baseMs) ? o.baseMs : POLL_BASE_MS;
  const factor = Number.isFinite(o.factor) ? o.factor : POLL_FACTOR;
  const max = Number.isFinite(o.maxMs) ? o.maxMs : POLL_MAX_MS;
  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  return Math.min(max, Math.round(base * Math.pow(factor, n)));
}

/**
 * 是否需要轮询：只有 `pending === 'ai-thinking'` 且面板可见时才轮（§7.5.3）。
 * @param projection - 投影。
 * @param visible - `tab.visible`（主面板恒为 true）。
 * @returns 布尔值。
 */
export function shouldPoll(projection, visible) {
  if (visible !== true) return false;
  return projection !== null && typeof projection === 'object' && projection.pending === 'ai-thinking';
}

/** 轮询是否已经超时（超过就要停下并提示，而不是无限轮）。 */
export function pollExpired(elapsedMs, timeoutMs) {
  const limit = Number.isFinite(timeoutMs) ? timeoutMs : POLL_TIMEOUT_MS;
  return Number.isFinite(elapsedMs) && elapsedMs >= limit;
}

const MESSAGE_KEYS = {
  'ai.fallback.local': 'status.aiFallback',
  'ai.fallback': 'status.aiFallback',
  'ai.timeout': 'status.aiFallback',
  'ai.failed': 'status.aiFailed',
  'ai.invalid': 'status.aiInvalid',
  'ai.illegal': 'status.aiInvalid',
  'rpc.unavailable': 'status.rpcUnavailable',
  'connection.lost': 'status.syncLost',
};

const ERROR_KEYS = {
  'move.invalid': 'error.moveInvalid',
  'move.illegal': 'error.moveInvalid',
  'move.not-your-turn': 'error.notYourTurn',
  'move.self-check': 'error.selfCheck',
  'move.leaves-king-in-check': 'error.selfCheck',
  'move.face-to-face': 'error.faceToFace',
  'move.out-of-rules': 'error.outOfRules',
  'game.finished': 'error.finished',
  'game.not-started': 'error.noGame',
  'game.busy': 'error.busy',
  'game.review': 'status.readonly',
  'undo.unavailable': 'error.undoUnavailable',
};

/** 机器码 → i18n 键；未登记的码返回 null（**不显示原始码**）。 */
export function messageKeyOf(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(MESSAGE_KEYS, code)
    ? MESSAGE_KEYS[code]
    : null;
}

/** 错误码 → i18n 键；未登记的码返回 null。 */
export function errorKeyOf(code) {
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_KEYS, code)) {
    return ERROR_KEYS[code];
  }
  return null;
}

/** 侧名后缀：字典里凡涉及侧名的句子都拆成 `.red` / `.black`。 */
export function sideSuffix(side) {
  return side === BLACK_SIDE ? 'black' : 'red';
}

/**
 * 本局的结局（用于状态条与读屏播报）。
 *
 * 结局句子的侧名**不插值**，而是选键：`status.result.checkmate.red` 读作
 * 「红方被将死，黑方胜」。纯函数层拿不到 `t`，插值会拼出「red被将死」。
 * @param projection - 投影。
 * @returns `{ key, params, tone, assertive }` 或 null。
 */
export function gameOutcome(projection) {
  if (projection === null || typeof projection !== 'object') return null;
  if (projection.phase !== 'finished') return null;
  const status = projection.status !== null && typeof projection.status === 'object' ? projection.status : {};
  const winner = status.winner === RED_SIDE || status.winner === BLACK_SIDE ? status.winner : null;
  const loser = winner === null ? null : winner === RED_SIDE ? BLACK_SIDE : RED_SIDE;
  if (status.state === 'checkmate') {
    return { key: `status.result.checkmate.${sideSuffix(loser)}`, params: {}, tone: 'success', assertive: true };
  }
  if (status.state === 'stalemate') {
    const side = loser === null ? projection.turn : loser;
    return { key: `status.result.stalemate.${sideSuffix(side)}`, params: {}, tone: 'success', assertive: true };
  }
  if (typeof status.state === 'string' && status.state.startsWith('draw')) {
    return {
      key: 'status.result.draw',
      params: { reason: typeof status.reasonZh === 'string' ? status.reasonZh : status.state },
      tone: 'info',
      assertive: true,
    };
  }
  if (status.state === 'resign') {
    return { key: `status.result.resign.${sideSuffix(loser)}`, params: {}, tone: 'success', assertive: true };
  }
  if (winner !== null) {
    return { key: `status.result.win.${sideSuffix(winner)}`, params: {}, tone: 'success', assertive: true };
  }
  return { key: 'status.result.finished', params: {}, tone: 'info', assertive: true };
}

/**
 * 状态条内容（本面板唯一的消息出口，§7.4）。
 *
 * 优先级：离线 → 错误 → 宿主 message → 结局 → 将军 → AI 思考 → 就绪。
 * 返回的 `key` 由组件用 `t` 渲染；`params` 已按字典里的 `{name}` 命名好。
 * @param projection - 投影。
 * @param ui - `{ offline, elapsedMs, notice }`；`notice` 是本地即时消息（如非法原因）。
 * @returns `{ key, params, tone, assertive }`。
 */
export function statusLine(projection, ui) {
  const state = ui === undefined || ui === null ? {} : ui;
  if (state.notice && typeof state.notice.key === 'string') {
    return {
      key: state.notice.key,
      params: state.notice.params === undefined ? {} : state.notice.params,
      tone: state.notice.tone === undefined ? 'warn' : state.notice.tone,
      assertive: false,
    };
  }
  if (state.offline === true) {
    return { key: 'status.rpcUnavailable', params: {}, tone: 'error', assertive: false };
  }
  const p = projection === null || typeof projection !== 'object' ? null : projection;
  if (p === null) return { key: 'status.connecting', params: {}, tone: 'info', assertive: false };
  if (p.error !== null && typeof p.error === 'object') {
    const key = errorKeyOf(p.error.code);
    if (key !== null) {
      return { key, params: {}, tone: 'error', assertive: false };
    }
    if (typeof p.error.reasonZh === 'string' && p.error.reasonZh !== '') {
      return { key: 'status.invalid', params: { reason: p.error.reasonZh }, tone: 'error', assertive: false };
    }
  }
  if (p.message !== null && typeof p.message === 'object') {
    const key = messageKeyOf(p.message.code);
    if (key !== null) {
      return {
        key,
        params: {},
        tone: p.message.tone === 'error' ? 'error' : 'warn',
        assertive: false,
      };
    }
  }
  const outcome = gameOutcome(p);
  if (outcome !== null) return outcome;
  const checkSide = checkSideOf(p);
  if (checkSide !== null) {
    return { key: `status.check.${sideSuffix(checkSide)}`, params: {}, tone: 'warn', assertive: false };
  }
  if (p.pending === 'ai-thinking') {
    return {
      key: 'status.aiThinking',
      params: { seconds: Math.max(0, Math.round((Number.isFinite(state.elapsedMs) ? state.elapsedMs : 0) / 1000)) },
      tone: 'info',
      assertive: false,
    };
  }
  if (p.pending === 'ai-failed') {
    return { key: 'status.aiFailed', params: {}, tone: 'warn', assertive: false };
  }
  return { key: 'status.ready', params: {}, tone: 'info', assertive: false };
}

/**
 * 着法列表的行模型：每行两手（红、黑）。
 * @param history - 投影的 history（`[{ zh, iccs, captured }]`）。
 * @returns `[{ no, red, black }]`，其中每手是 `{ ply, index, zh, iccs }` 或 null。
 */
export function moveRows(history) {
  const list = Array.isArray(history) ? history : [];
  const rows = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] !== null && typeof list[i] === 'object' ? list[i] : {};
    const ply = {
      ply: i + 1,
      index: i,
      zh: typeof item.zh === 'string' ? item.zh : '',
      iccs: typeof item.iccs === 'string' ? item.iccs : '',
      captured: typeof item.captured === 'string' ? item.captured : '',
    };
    const rowIndex = Math.floor(i / 2);
    if (rows[rowIndex] === undefined) rows[rowIndex] = { no: rowIndex + 1, red: null, black: null };
    if (i % 2 === 0) rows[rowIndex].red = ply;
    else rows[rowIndex].black = ply;
  }
  return rows;
}

/**
 * 毫秒 → `m:ss`（计时节拍用等宽字体 + tabular-nums，§7.3）。
 * @param ms - 毫秒。
 * @returns 文本；非法输入返回 `--:--`。
 */
export function formatClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 引擎评分 → 一行可读文本（§7.4 提示要显示「记谱 + 评分」）。
 *
 * 引擎的分数单位是「厘兵」（100 = 一个兵），所以除以 100 显示成兵值，并显式带符号：
 * 没有符号的 `1.2` 会被读成「红方好 1.2」还是「黑方好 1.2」全凭猜。
 * @param score - 引擎分数（厘兵）。
 * @returns 形如 `+1.2` / `-0.5` / `0.0`；非法输入返回空串。
 */
export function formatScore(score) {
  if (!Number.isFinite(score)) return '';
  const pawns = score / 100;
  const text = Math.abs(pawns).toFixed(1);
  if (pawns > 0.049) return `+${text}`;
  if (pawns < -0.049) return `-${text}`;
  return '0.0';
}

/**
 * 复制棋谱用的文本（FR22：中文记谱逐行 + FEN）。
 * @param projection - 投影。
 * @returns 文本。
 */
export function recordText(projection) {
  const p = projection === null || typeof projection !== 'object' ? {} : projection;
  const rows = moveRows(p.history);
  const lines = [];
  const startFen = typeof p.initialFen === 'string' ? p.initialFen : '';
  if (startFen !== '') lines.push(`# 初始局面 ${startFen}`);
  for (const row of rows) {
    const red = row.red === null ? '' : row.red.zh;
    const black = row.black === null ? '' : row.black.zh;
    lines.push(`${row.no}. ${red}${black === '' ? '' : `  ${black}`}`);
  }
  if (typeof p.fen === 'string' && p.fen !== '') lines.push(`# 当前局面 ${p.fen}`);
  return lines.join('\n');
}
