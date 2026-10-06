/**
 * 内联引擎的薄封装。
 *
 * 客户端**持有一份引擎源码**（`scripts/build-client.mjs` 把 `lib/engine/**` 内联进
 * `lib/client.js`），但它只用于两件事（§7.2 第 2 条、§7.5.4 第 2 条）：
 *
 *  1. **乐观预校验**：`legalTargets` 已经由宿主下发，这里只补一句人话原因，并在宿主
 *     没有下发 `legalTargets` 时兜底判断——判定分歧一律以宿主为准；
 *  2. **本地复盘重放**：投影只带中文记谱与 ICCS，不带每一手的 FEN；复盘要把棋盘切到
 *     第 n 手，就在客户端用同一份引擎重放，零 RPC、零延迟。
 *
 * 这份 import 只服务于「源码可读性」：真正的 `lib/client.js` 由生成脚本把引擎与 UI
 * 拼进同一个 IIFE，import 会被逐行剥掉，名字在同一个作用域里直接可见。
 *
 * 所有函数都不抛：引擎对畸形输入会 `throw PositionError`，而 UI 不该因为一条坏数据
 * 整块打白，所以这里统一 try/catch 后降级。
 */

import { applyMove, generateMoves, iccsToMove, initialPosition, isLegalMove, moveRejectReason, positionFromFen, positionToFen, squareToIccs } from '../engine/index.js';

import { normalizeBoard } from './model.js';

/** `from`/`to` 内部索引 → ICCS 着法串（如 `h2e2`）；任一端非法返回 ''。 */
export function iccsOf(from, to) {
  const a = squareToIccs(from);
  const b = squareToIccs(to);
  return a === '' || b === '' ? '' : `${a}${b}`;
}

/** 标准初始局面的棋盘（宿主连不上时仍要画出一张空盘/初始盘，而不是白屏）。 */
export function initialBoard() {
  try {
    return normalizeBoard(initialPosition().board);
  } catch {
    return normalizeBoard(null);
  }
}

/** 标准初始局面 FEN；失败返回 ''。 */
export function initialFen() {
  try {
    return positionToFen(initialPosition());
  } catch {
    return '';
  }
}

/**
 * 本地兜底的可走点（只在宿主没有下发 `legalTargets` 时使用）。
 * @param fen - 局面 FEN。
 * @param from - 起点格号。
 * @returns 目标格号数组；没有局面时返回 []。
 */
export function localTargets(fen, from) {
  const pos = positionOf(fen);
  if (pos === null) return [];
  try {
    const moves = generateMoves(pos);
    const out = [];
    for (const move of moves) {
      if (move.from === from) out.push(move.to);
    }
    return out.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * 从一个 FEN 建局面；失败返回 null。
 * @param fen - FEN 文本。
 * @returns Position 或 null。
 */
export function positionOf(fen) {
  try {
    if (typeof fen === 'string' && fen !== '') return positionFromFen(fen);
  } catch {
    /* 畸形 FEN：降级到「没有本地局面」 */
  }
  return null;
}

/**
 * 乐观预校验一步棋。
 *
 * @param fen - 当前局面 FEN（来自投影）。
 * @param from - 起点索引。
 * @param to - 终点索引。
 * @returns `{ legal, reason }`；没有本地局面时 `legal: null`（= 不知道，交给宿主）。
 */
export function precheckMove(fen, from, to) {
  const pos = positionOf(fen);
  if (pos === null) return { legal: null, reason: null };
  const move = { from, to };
  try {
    if (isLegalMove(pos, move)) return { legal: true, reason: null };
    const reason = moveRejectReason(pos, move);
    return { legal: false, reason: typeof reason === 'string' && reason !== '' ? reason : null };
  } catch {
    return { legal: null, reason: null };
  }
}

/**
 * 复盘重放：把棋盘切到「下完前 `ply` 手」的局面。
 *
 * @param initialFen - 初始局面 FEN；缺失或非法时用标准初始局面。
 * @param history - 投影的 history（每手至少要有 `iccs`）。
 * @param ply - 要走到第几手（0 = 初始局面，1 = 走完第一手）。
 * @returns `{ board, fen, lastMove }`；重放失败返回 null（调用方保持当前画面）。
 */
export function replayToPly(initialFen, history, ply) {
  const list = Array.isArray(history) ? history : [];
  const target = Number.isInteger(ply) && ply > 0 ? Math.min(ply, list.length) : 0;
  let pos = positionOf(initialFen);
  if (pos === null) {
    try {
      pos = initialPosition();
    } catch {
      return null;
    }
  }
  let lastMove = null;
  for (let i = 0; i < target; i += 1) {
    const item = list[i] !== null && typeof list[i] === 'object' ? list[i] : {};
    try {
      const move = typeof item.iccs === 'string' && item.iccs !== '' ? iccsToMove(pos, item.iccs) : null;
      if (move === null) return null;
      lastMove = { from: move.from, to: move.to };
      pos = applyMove(pos, move);
    } catch {
      return null;
    }
  }
  const board = normalizeBoard(pos.board);
  let fen = '';
  try {
    fen = positionToFen(pos);
  } catch {
    fen = '';
  }
  return { board, fen, lastMove, position: pos };
}
