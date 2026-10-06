/**
 * 评估函数（§5.7）：分值单位「厘兵」（兵 = 100），分值一律以**红方视角**给出
 * （正 = 红优），这样 `searchBestMove` 的极大极小不需要反复换符号。
 *
 * 可解释性是硬要求（§5.6 的摘要、模型解释「为什么这步好」）：每个可加项都单独
 * 产出一条 `EvalTerm`，`summaryZh` 只由这些项拼出来——不允许出现「分数变了但
 * 说不出是谁贡献的」这种情况，否则摘要是编的，模型会跟着编。
 */

import { BOARD_SIZE, RED_SIDE, RED_CODE, BLACK_CODE, PIECE_BASE_VALUE, colorOfPiece, idxToRow, idxToCol, hasCrossedRiver, pieceNameZh, sideNameZh } from './coords.js';

import { isValidPosition } from './fen.js';
import { generateMoves, isSquareAttackedBy, findKingIndex } from './moves.js';


/** 机动性权重：每多一个合法着法折算的厘兵（§5.7 的 ±2/着）。 */
const MOBILITY_WEIGHT = 2;

/** 过河兵每推进一行的加成，以及「兵临城下」的一次性加成。 */
const PAWN_ADVANCE_WEIGHT = 15;
const PAWN_AT_GATE_BONUS = 40;

/** 缺一个士/象的惩罚基数（对方有车或炮时才生效）。 */
const GUARD_WEAKNESS_WEIGHT = 25;

/** 无根子与牵制的惩罚上限，避免残局里个别子把总分拉爆。 */
const HANGING_CAP = 120;
const PIN_PENALTY = 20;

const ZH_COUNTERS = ['', '一', '二', '三', '四', '五'];
const MATERIAL_ORDER = ['R', 'C', 'N', 'B', 'A', 'P'];

/** 棋子在某格的分值：兵/卒过河翻倍（§5.7 的 100 → 200）。 */
export function evalPieceValue(piece, index) {
  const base = PIECE_BASE_VALUE[piece] ?? 0;
  if (piece === 'P' || piece === 'p') {
    const row = idxToRow(index);
    return hasCrossedRiver(row, piece === 'P' ? RED_SIDE : 'b') ? 200 : base;
  }
  return base;
}

/** 子力项：红方总子力 − 黑方总子力。 */
function evalMaterial(board) {
  let score = 0;
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const piece = board[i];
    if (piece === '') continue;
    const value = evalPieceValue(piece, i);
    score += colorOfPiece(piece) === RED_SIDE ? value : -value;
  }
  return score;
}

/** 机动性项：红方合法着法数 − 黑方合法着法数，乘权重。 */
function evalMobility(pos) {
  const red = generateMoves({ ...pos, turn: RED_SIDE }).length;
  const black = generateMoves({ ...pos, turn: 'b' }).length;
  return { score: (red - black) * MOBILITY_WEIGHT, red, black };
}

/** 过河兵项：推进越深越值钱，逼近九宫再给一次性加成。 */
function evalPawnAdvance(board) {
  let score = 0;
  const notes = { r: 0, b: 0 };
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const piece = board[i];
    if (piece !== 'P' && piece !== 'p') continue;
    const side = piece === 'P' ? RED_SIDE : 'b';
    const row = idxToRow(i);
    if (!hasCrossedRiver(row, side)) continue;
    const advance = side === RED_SIDE ? 5 - row : row - 4;
    const atGate = side === RED_SIDE ? row <= 1 : row >= 8;
    const gain = advance * PAWN_ADVANCE_WEIGHT + (atGate ? PAWN_AT_GATE_BONUS : 0);
    score += side === RED_SIDE ? gain : -gain;
    if (side === RED_SIDE) notes.r += 1;
    else notes.b += 1;
  }
  return { score, notes };
}

/** 计数某方的士/象数量。 */
function countGuards(board, side) {
  let guards = 0;
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const piece = board[i];
    if (piece === '') continue;
    if (colorOfPiece(piece) !== side) continue;
    if (piece === 'A' || piece === 'B' || piece === 'a' || piece === 'b') guards += 1;
  }
  return guards;
}

/** 九宫防守项：缺士缺象，且对方还留有车/炮时才扣分。 */
function evalKingSafety(board) {
  const heavy = { r: false, b: false };
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const piece = board[i];
    if (piece === 'R' || piece === 'C') heavy.r = true;
    else if (piece === 'r' || piece === 'c') heavy.b = true;
  }
  const redGuards = countGuards(board, RED_SIDE);
  const blackGuards = countGuards(board, 'b');
  const redWeak = heavy.b ? Math.max(0, 4 - redGuards) * GUARD_WEAKNESS_WEIGHT : 0;
  const blackWeak = heavy.r ? Math.max(0, 4 - blackGuards) * GUARD_WEAKNESS_WEIGHT : 0;
  return { score: blackWeak - redWeak, redGuards, blackGuards };
}

/** 无根子与牵制项：被攻击且无己方保护扣分；一动就露帅的子另计。 */
function evalHangingAndPins(board) {
  const redKing = findKingIndex(board, RED_SIDE);
  const blackKing = findKingIndex(board, 'b');
  let score = 0;
  let redHanging = 0;
  let blackHanging = 0;
  let redPinned = 0;
  let blackPinned = 0;
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const piece = board[i];
    if (piece === '' || piece === 'K' || piece === 'k') continue;
    const side = colorOfPiece(piece);
    const ownCode = side === RED_SIDE ? RED_CODE : BLACK_CODE;
    const oppCode = ownCode === RED_CODE ? BLACK_CODE : RED_CODE;
    if (isSquareAttackedBy(board, i, oppCode) && !isSquareAttackedBy(board, i, ownCode)) {
      const penalty = Math.min(Math.round(evalPieceValue(piece, i) / 10), 60);
      score += side === RED_SIDE ? -penalty : penalty;
      if (side === RED_SIDE) redHanging += 1;
      else blackHanging += 1;
    }
    // 牵制：把这颗子拿掉后帅才被攻击，说明它被绝对牵制（移走即露帅）。
    const kingAt = side === RED_SIDE ? redKing : blackKing;
    if (kingAt >= 0) {
      const before = isSquareAttackedBy(board, kingAt, oppCode);
      const saved = board[i];
      board[i] = '';
      const after = isSquareAttackedBy(board, kingAt, oppCode);
      board[i] = saved;
      if (!before && after) {
        score += side === RED_SIDE ? -PIN_PENALTY : PIN_PENALTY;
        if (side === RED_SIDE) redPinned += 1;
        else blackPinned += 1;
      }
    }
  }
  return { score: Math.max(-HANGING_CAP, Math.min(HANGING_CAP, score)), redHanging, blackHanging, redPinned, blackPinned };
}

/** 子力差的中文短语，如「净多一车一兵」。 */
export function materialDiffZh(board) {
  const counts = {};
  for (const type of MATERIAL_ORDER) counts[type] = 0;
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const piece = board[i];
    if (piece === '') continue;
    const type = piece.toUpperCase();
    if (type === 'K') continue;
    counts[type] += colorOfPiece(piece) === RED_SIDE ? 1 : -1;
  }
  const describe = (sign) => MATERIAL_ORDER
    .filter((type) => (sign > 0 ? counts[type] > 0 : counts[type] < 0))
    .map((type) => `${ZH_COUNTERS[Math.min(5, Math.abs(counts[type]))] ?? ''}${pieceNameZh(sign > 0 ? type : type.toLowerCase())}`)
    .join('');
  const red = describe(1);
  const black = describe(-1);
  if (red && !black) return `红方净多${red}`;
  if (black && !red) return `黑方净多${black}`;
  if (red && black) return `红方多${red}、黑方多${black}`;
  return '双方子力相当';
}

/** 评估局面。返回 `{ score, breakdown, summaryZh }`，score 为红方视角。 */
export function evaluate(pos) {
  if (!isValidPosition(pos)) {
    return { score: 0, breakdown: [], summaryZh: '局面数据非法，无法评估' };
  }
  const board = pos.board;
  const material = evalMaterial(board);
  const mobility = evalMobility(pos);
  const pawns = evalPawnAdvance(board);
  const safety = evalKingSafety(board);
  const hanging = evalHangingAndPins(board);
  const breakdown = [
    { id: 'material', nameZh: '子力', score: material, detailZh: materialDiffZh(board) },
    { id: 'mobility', nameZh: '机动性', score: mobility.score, detailZh: `红方 ${mobility.red} 着，黑方 ${mobility.black} 着` },
    { id: 'pawn-advance', nameZh: '过河兵推进', score: pawns.score, detailZh: `红方过河兵 ${pawns.notes.r} 个，黑方过河卒 ${pawns.notes.b} 个` },
    { id: 'king-safety', nameZh: '九宫防守', score: safety.score, detailZh: `红方士象 ${safety.redGuards} 个，黑方士象 ${safety.blackGuards} 个` },
    { id: 'hanging-pin', nameZh: '无根子与牵制', score: hanging.score, detailZh: `红方无根 ${hanging.redHanging} 子、被牵制 ${hanging.redPinned} 子；黑方无根 ${hanging.blackHanging} 子、被牵制 ${hanging.blackPinned} 子` },
  ];
  const score = breakdown.reduce((sum, term) => sum + term.score, 0);
  return { score, breakdown, summaryZh: summarizeEval(score, breakdown) };
}

/** 由逐项结论拼中文摘要；每一项都必须能追到 breakdown 里的某个数值。 */
function summarizeEval(score, breakdown) {
  const term = (id) => breakdown.find((item) => item.id === id);
  const material = term('material');
  const mobility = term('mobility');
  const pawns = term('pawn-advance');
  const safety = term('king-safety');
  const hanging = term('hanging-pin');
  const clauses = [`${material.detailZh}（总分 ${score >= 0 ? '+' : ''}${score}）`];
  if (Math.abs(mobility.score) >= 4) {
    clauses.push(mobility.score > 0 ? '红方着法更活' : '黑方着法更活');
  }
  if (pawns.score !== 0) clauses.push(pawns.score > 0 ? '红方过河兵压境' : '黑方过河卒压境');
  if (safety.score > 0) clauses.push('黑方九宫缺士象');
  else if (safety.score < 0) clauses.push('红方九宫缺士象');
  if (hanging.score <= -PIN_PENALTY) clauses.push('红方有子无根或被牵制');
  else if (hanging.score >= PIN_PENALTY) clauses.push('黑方有子无根或被牵制');
  return clauses.join('；');
}

/** 供 describe 使用的中文方名（避免各处重复实现）。 */
export function evalSideNameZh(side) {
  return sideNameZh(side);
}
