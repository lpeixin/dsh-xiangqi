/**
 * 本地搜索（§5.7）：迭代加深 alpha-beta + 置换表 + 着法排序（MVV-LVA + 历史启发）。
 *
 * 用途：`xiangqi_hint` 与「模型不可用时降级对手」（FR11、FR17）。
 *
 * 几个必须明确的语义：
 *
 * - **`score` 是走子方视角**（正 = 对当前走子方有利），不是红方视角——提示场景里
 *   调用方只关心「这步对我多好」。`evaluate` 才是红方视角，两者在叶子处换号。
 * - **无着法一律返回负的将杀分**：中国象棋里困毙（无子可动）同样判负（§5.4），
 *   所以叶子处的「无着法」不需要区分是否被将军——这与国际象棋相反。
 * - **确定性**：`seed` 只在整轮迭代结束后用于「同分着法挑一个」，因此同 seed、
 *   同完成深度必得同结果。时间限制本身依赖墙钟，所以「同 seed 必得同结果」的
 *   前提是搜索在时限内跑完（§5.7 的双限）。
 */

import { RED_SIDE, oppositeSide, squareToIccs, PIECE_BASE_VALUE, decodeMoveFrom, decodeMoveTo } from './coords.js';

import { isValidPosition } from './fen.js';

import { collectLegalMoves, makeMoveOnBoard, unmakeMoveOnBoard } from './moves.js';

import { evaluate } from './eval.js';

/** 将杀分。任何正常评估都不可能接近它，因此「分值 ≥ MATE_SCORE - ply」即找到杀。 */
const SEARCH_MATE_SCORE = 100000;
const SEARCH_INFINITY = 1 << 20;
const SEARCH_MAX_PLY = 48;
const SEARCH_DEFAULT_DEPTH = 4;
const SEARCH_DEFAULT_TIME_MS = 300;

/** mulberry32：小而确定的 PRNG，避免为了同分随机去引入依赖。 */
function searchPrng(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 局面哈希（含走子方）。O(90) 但实现简单，且不依赖任何增量维护的正确性。 */
function searchHash(board, side) {
  let h = side === RED_SIDE ? 0x9e3779b1 : 0x85ebca6b;
  for (let i = 0; i < 90; i += 1) {
    const piece = board[i];
    if (piece === '') continue;
    h = Math.imul(h ^ (piece.charCodeAt(0) * 31 + i), 0x01000193) >>> 0;
  }
  return h;
}

/** 走子方视角的静态评估。 */
function searchEvaluate(state, side) {
  state.view.turn = side;
  const score = evaluate(state.view).score;
  return side === RED_SIDE ? score : -score;
}

/** 着法排序分值：置换表着法 > 吃子（MVV-LVA）> 杀手着法 > 历史启发。 */
function searchMoveScore(state, code, ttMove, ply) {
  if (code === ttMove) return SEARCH_INFINITY;
  const from = decodeMoveFrom(code);
  const to = decodeMoveTo(code);
  const victim = state.board[to];
  if (victim !== '') {
    const attacker = state.board[from];
    return 1e6 + (PIECE_BASE_VALUE[victim] ?? 0) * 8 - (PIECE_BASE_VALUE[attacker] ?? 0);
  }
  if (state.killers[ply * 2] === code) return 9e5;
  if (state.killers[ply * 2 + 1] === code) return 8e5;
  return state.history[from * 90 + to];
}

/** 就地按分值降序排。着法数 ≤ 60，插入排序足够且无额外分配。 */
function searchOrderMoves(state, moves, ttMove, ply) {
  const scored = moves.map((code) => ({ code, score: searchMoveScore(state, code, ttMove, ply) }));
  scored.sort((a, b) => b.score - a.score);
  for (let i = 0; i < moves.length; i += 1) moves[i] = scored[i].code;
}

/** alpha-beta 主体。返回走子方视角分值。 */
function searchAlphaBeta(state, depth, alpha, beta, ply) {
  state.nodes += 1;
  if ((state.nodes & 1023) === 0 && Date.now() >= state.deadline) {
    state.stopped = true;
    return 0;
  }
  const side = state.side;
  const moves = collectLegalMoves(state.board, side, []);
  // 将死与困毙在中国象棋里都是判负，因此无需区分是否被将军。
  if (moves.length === 0) return -SEARCH_MATE_SCORE + ply;
  if (depth <= 0) return searchEvaluate(state, side);

  const key = searchHash(state.board, side);
  const ttMove = state.tt.get(key)?.move;
  searchOrderMoves(state, moves, ttMove, ply);
  let bestScore = -SEARCH_INFINITY;
  let bestMove = moves[0];
  let localAlpha = alpha;
  for (const code of moves) {
    const from = decodeMoveFrom(code);
    const to = decodeMoveTo(code);
    const captured = makeMoveOnBoard(state.board, from, to);
    state.side = oppositeSide(side);
    const score = -searchAlphaBeta(state, depth - 1, -beta, -localAlpha, ply + 1);
    state.side = side;
    unmakeMoveOnBoard(state.board, from, to, captured);
    if (state.stopped) return bestScore > -SEARCH_INFINITY ? bestScore : 0;
    if (score > bestScore) {
      bestScore = score;
      bestMove = code;
    }
    if (score > localAlpha) localAlpha = score;
    if (localAlpha >= beta) {
      if (captured === '') {
        state.killers[ply * 2 + 1] = state.killers[ply * 2];
        state.killers[ply * 2] = code;
        state.history[from * 90 + to] += depth * depth;
      }
      break;
    }
  }
  state.tt.set(key, { depth, score: bestScore, move: bestMove });
  return bestScore;
}

/** 从置换表回溯出一条主变（最多 16 手）。 */
function searchBuildPv(state, firstMove) {
  const pv = [];
  const board = state.board.slice();
  let side = state.rootTurn;
  let code = firstMove;
  while (code !== undefined && pv.length < 16) {
    const from = decodeMoveFrom(code);
    const to = decodeMoveTo(code);
    pv.push(squareToIccs(from) + squareToIccs(to));
    makeMoveOnBoard(board, from, to);
    side = oppositeSide(side);
    code = state.tt.get(searchHash(board, side))?.move;
  }
  return pv;
}

/**
 * 搜索最佳着法。`{ depth, timeMs }` 双限取先到者（§5.7）。
 * 返回 `{ move, score, depth, nodes, pv }`；无合法着法时 `move` 为 null、`depth` 为 0。
 */
export function searchBestMove(pos, opts = {}) {
  const empty = { move: null, score: 0, depth: 0, nodes: 0, pv: [] };
  if (!isValidPosition(pos)) return empty;
  const maxDepth = Number.isInteger(opts.depth) && opts.depth > 0 ? opts.depth : SEARCH_DEFAULT_DEPTH;
  const timeMs = Number.isFinite(opts.timeMs) && opts.timeMs > 0 ? opts.timeMs : SEARCH_DEFAULT_TIME_MS;
  const seed = Number.isInteger(opts.seed) ? opts.seed : 1;
  const roots = collectLegalMoves(pos.board, pos.turn, []);
  if (roots.length === 0) return empty;

  const state = {
    board: pos.board.slice(),
    view: { board: null, turn: pos.turn, halfmove: pos.halfmove, fullmove: pos.fullmove },
    rootTurn: pos.turn,
    side: pos.turn,
    nodes: 0,
    stopped: false,
    deadline: Date.now() + timeMs,
    tt: new Map(),
    history: new Int32Array(90 * 90),
    killers: new Int32Array(SEARCH_MAX_PLY * 2).fill(-1),
  };
  state.view.board = state.board;
  const random = searchPrng(seed);

  let bestMove = roots[0];
  let bestScore = 0;
  let bestPv = [];
  let completed = 0;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const ttMove = state.tt.get(searchHash(state.board, pos.turn))?.move;
    searchOrderMoves(state, roots, ttMove, 0);
    const scored = [];
    let alpha = -SEARCH_INFINITY;
    let aborted = false;
    for (const code of roots) {
      const from = decodeMoveFrom(code);
      const to = decodeMoveTo(code);
      const captured = makeMoveOnBoard(state.board, from, to);
      state.side = oppositeSide(pos.turn);
      const score = -searchAlphaBeta(state, depth - 1, -SEARCH_INFINITY, -alpha, 1);
      state.side = pos.turn;
      unmakeMoveOnBoard(state.board, from, to, captured);
      if (state.stopped) {
        aborted = true;
        break;
      }
      scored.push({ code, score });
      if (score > alpha) alpha = score;
    }
    if (aborted || scored.length === 0) break;
    // 只在本轮**完整**结束时才更新结果，保证「时限截断」不会返回半轮着法。
    const top = Math.max(...scored.map((item) => item.score));
    const tied = scored.filter((item) => item.score === top);
    const picked = tied.length > 1 ? tied[Math.floor(random() * tied.length)] : tied[0];
    bestMove = picked.code;
    bestScore = picked.score;
    completed = depth;
    state.tt.set(searchHash(state.board, pos.turn), { depth, score: top, move: bestMove });
    bestPv = searchBuildPv(state, bestMove);
    if (top >= SEARCH_MATE_SCORE - SEARCH_MAX_PLY) break;
    if (Date.now() >= state.deadline) break;
  }

  return {
    move: { from: decodeMoveFrom(bestMove), to: decodeMoveTo(bestMove) },
    score: bestScore,
    depth: completed,
    nodes: state.nodes,
    pv: bestPv,
  };
}

/** 供 UI 复用：走子方视角分值的文字解释。 */
export function searchScoreTextZh(score) {
  if (score >= SEARCH_MATE_SCORE - SEARCH_MAX_PLY) return '必胜（找到杀棋）';
  if (score <= -SEARCH_MATE_SCORE + SEARCH_MAX_PLY) return '必败（对方有杀）';
  if (score > 60) return '明显占优';
  if (score > 20) return '稍占优';
  if (score < -60) return '明显劣势';
  if (score < -20) return '稍处下风';
  return '均势';
}

/** 导出常量供测试钉基准（避免测试里出现魔法数字）。 */
export const SEARCH_LIMITS = { MATE_SCORE: SEARCH_MATE_SCORE, DEFAULT_DEPTH: SEARCH_DEFAULT_DEPTH, DEFAULT_TIME_MS: SEARCH_DEFAULT_TIME_MS };
