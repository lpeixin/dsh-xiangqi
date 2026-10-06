/**
 * 规则判定（§5.4）与着法拒绝原因。
 *
 * 本文件是 §5.4 规则表的「对照面」，因此把两件事放在一起：
 * **走子形状的合法性**（为什么这手不合法）与**局面状态**（将死/困毙/长将/自然限着）。
 * 着法生成与攻击判定在 moves.js——那里是热路径，这里只在边界（工具入参、UI、
 * 模型输出）上跑，可以将每条规则写得直白。
 *
 * **中国象棋特有**：无子可动（困毙）不是和棋，而是判负。这条与国际象棋相反，
 * 是引擎里最容易被「照抄国象逻辑」写错的地方，因此配专门用例。
 *
 * 重复局面只能靠调用方传进来的 `history`（FEN 数组，按时间顺序、不含当前局面）
 * 判定——引擎不持有对局历史（§5.2）。长将的判据由历史反推：若重复循环里某方
 * 每一步都在将军，就该方判负（§9 长将判负 + 三次重复判和）。
 */

import { RED_SIDE, BLACK_SIDE, BOARD_COLS, BOARD_SIZE, colorOfPiece, oppositeSide, sideNameZh, idxToRow, idxToCol, isInPalace, hasCrossedRiver, horseLegIndex, pieceNameZh, squareToIccs } from './coords.js';

import { isValidPosition, positionFromFen, positionKeyOf, fenKeyOf } from './fen.js';

import { generateMoves, findKingIndex, isSquareAttacked, makeMoveOnBoard, unmakeMoveOnBoard } from './moves.js';

/** 自然限着阈值：连续 120 个半回合无吃子判和（§5.4 的 60 回合）。 */
export const FIFTY_MOVE_HALFMOVES = 120;

/** 某方是否被将军（棋盘级，供搜索与描述复用）；side 用 'r'/'b'。 */
export function isBoardInCheck(board, side) {
  return isSquareAttacked(board, findKingIndex(board, side), oppositeSide(side));
}

/** 某方是否被将军；side 省略时取当前走子方。 */
export function isInCheck(pos, side) {
  if (!isValidPosition(pos)) return false;
  return isBoardInCheck(pos.board, side === 'r' || side === 'b' ? side : pos.turn);
}

/** 两将同列且中间无子（照面）。局面本身非法，等价于「走成照面」的着法非法。 */
export function kingsFaceOnBoard(board) {
  const redKing = findKingIndex(board, RED_SIDE);
  const blackKing = findKingIndex(board, BLACK_SIDE);
  if (redKing < 0 || blackKing < 0) return false;
  const col = idxToCol(redKing);
  if (col !== idxToCol(blackKing)) return false;
  const lo = Math.min(idxToRow(redKing), idxToRow(blackKing));
  const hi = Math.max(idxToRow(redKing), idxToRow(blackKing));
  for (let row = lo + 1; row < hi; row += 1) {
    if (board[row * BOARD_COLS + col] !== '') return false;
  }
  return true;
}

/** 归一化 history：容忍调用方把当前局面也放进数组末尾。 */
function normalizeHistory(history, pos) {
  const list = Array.isArray(history) ? history.slice() : [];
  while (list.length > 0) {
    const last = list[list.length - 1];
    if (typeof last !== 'string' || fenKeyOf(last) !== positionKeyOf(pos)) break;
    list.pop();
  }
  return list;
}

/** 当前局面（含走子方）在 `history + 自身` 中出现的次数。 */
export function countRepetition(pos, history) {
  const key = positionKeyOf(pos);
  let count = 1;
  for (const fen of normalizeHistory(history, pos)) if (fenKeyOf(fen) === key) count += 1;
  return count;
}

/**
 * 推断「长将方」：只看最近一个重复循环内每一手的结果。
 * 双方都长将或都无长将时返回 null（按普通三次重复判和）。
 */
export function findPerpetualChecker(pos, history) {
  const list = normalizeHistory(history, pos);
  if (list.length === 0) return null;
  const positions = [];
  for (const fen of list) {
    try {
      positions.push(positionFromFen(fen));
    } catch {
      return null;
    }
  }
  const last = positions.length;
  positions.push(pos);
  let start = -1;
  for (let i = last - 1; i >= 0; i -= 1) {
    if (positionKeyOf(positions[i]) === positionKeyOf(pos)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const tally = { r: { made: 0, checks: 0 }, b: { made: 0, checks: 0 } };
  for (let i = start + 1; i <= last; i += 1) {
    const mover = positions[i - 1].turn;
    tally[mover].made += 1;
    if (isInCheck(positions[i], oppositeSide(mover))) tally[mover].checks += 1;
  }
  const redPerpetual = tally.r.made > 0 && tally.r.checks === tally.r.made;
  const blackPerpetual = tally.b.made > 0 && tally.b.checks === tally.b.made;
  if (redPerpetual && !blackPerpetual) return RED_SIDE;
  if (blackPerpetual && !redPerpetual) return BLACK_SIDE;
  return null;
}

/** 把状态压成 §5.3 的 GameStatus。 */
function status(state, winner, reason, reasonZh) {
  return { state, winner, reason, reasonZh };
}

/**
 * 局面状态。判定优先级：无着法（将死/困毙）> 三次重复 > 自然限着 > 将军 > 进行中。
 * 无着法优先级最高，否则「刚被将死但同时构成重复」会误判为和棋。
 */
export function gameStatus(pos, history) {
  if (!isValidPosition(pos)) return status('playing', null, 'invalid-position', '局面数据非法');
  const side = pos.turn;
  const inCheck = isInCheck(pos, side);
  const moves = generateMoves(pos);
  if (moves.length === 0) {
    const winner = oppositeSide(side);
    if (inCheck) {
      return status('checkmate', winner, 'checkmate', `${sideNameZh(side)}被将死，${sideNameZh(winner)}胜`);
    }
    return status('stalemate', winner, 'stalemate', `${sideNameZh(side)}无子可动（困毙），按中国象棋规则判负，${sideNameZh(winner)}胜`);
  }
  if (countRepetition(pos, history) >= 3) {
    const checker = findPerpetualChecker(pos, history);
    if (checker) {
      const winner = oppositeSide(checker);
      return status('draw-perpetual-check', winner, 'perpetual-check', `${sideNameZh(checker)}长将，判负；${sideNameZh(winner)}胜`);
    }
    return status('draw-repetition', null, 'repetition', '同一局面出现三次，判和');
  }
  if (pos.halfmove >= FIFTY_MOVE_HALFMOVES) {
    return status('draw-fifty', null, 'fifty-move', `连续 ${pos.halfmove} 个半回合无吃子，达到自然限着，判和`);
  }
  if (inCheck) return status('check', null, 'check', `${sideNameZh(side)}被将军（应将着法 ${moves.length} 个）`);
  return status('playing', null, 'playing', '对局进行中');
}

/** 拒绝原因码 → 人话。码稳定、文案可变，测试夹具钉码（§5.4）。 */
export const MOVE_REJECT_ZH = {
  'invalid-position': '局面数据非法',
  'malformed-move': '着法格式非法（需要 0–89 的 from/to 整数）',
  'off-board': '坐标越界（应在 0–89）',
  'empty-from': '起点没有棋子',
  'not-your-piece': '那不是当前走子方的棋子',
  'no-movement': '起点与终点相同',
  'own-piece-target': '终点被己方棋子占据',
  'not-a-rook-move': '车只能沿直线走',
  'blocked-path': '路径上有棋子挡住',
  'not-a-cannon-move': '炮只能沿直线走',
  'cannon-screen-missing': '炮吃子必须恰好隔一个炮架（现在没有炮架）',
  'cannon-screen-too-many': '炮吃子必须恰好隔一个炮架（现在隔了多个）',
  'not-a-horse-move': '马走「日」字',
  'horse-leg-blocked': '蹩马腿：马腿位置有棋子',
  'not-an-elephant-move': '相/象走「田」字',
  'elephant-eye-blocked': '塞象眼：田字中心有棋子',
  'elephant-crosses-river': '相/象不能过河',
  'not-an-advisor-move': '仕/士只能在九宫内斜走一格',
  'advisor-out-of-palace': '仕/士不能走出九宫',
  'not-a-king-move': '帅/将只能在九宫内直走一格',
  'king-out-of-palace': '帅/将不能走出九宫',
  'not-a-pawn-move': '兵/卒不能这样走',
  'pawn-backward': '兵/卒永不后退',
  'pawn-sideways-before-river': '兵/卒过河后才能横走',
  'king-facing': '走成将帅照面（两将同列且中间无子）',
  'self-check': '走子后自己被将军（送将）',
  'unknown-piece': '无法识别的棋子',
};

/** 走子形状是否违反该子的行棋方式；违反则返回原因码，合法返回 null。 */
function piecePatternRejectCode(board, from, to, piece) {
  const row = idxToRow(from);
  const col = idxToCol(from);
  const toRow = idxToRow(to);
  const toCol = idxToCol(to);
  const dr = toRow - row;
  const dc = toCol - col;
  const side = colorOfPiece(piece);
  const upper = piece.toUpperCase();
  const target = board[to];
  if (upper === 'R' || upper === 'C') {
    if (dr !== 0 && dc !== 0) return upper === 'R' ? 'not-a-rook-move' : 'not-a-cannon-move';
    const stepRow = Math.sign(dr);
    const stepCol = Math.sign(dc);
    let r = row + stepRow;
    let c = col + stepCol;
    let screens = 0;
    while (r !== toRow || c !== toCol) {
      if (board[r * BOARD_COLS + c] !== '') screens += 1;
      r += stepRow;
      c += stepCol;
    }
    if (upper === 'R') return screens === 0 ? null : 'blocked-path';
    if (target === '') return screens === 0 ? null : 'blocked-path';
    if (screens === 0) return 'cannon-screen-missing';
    return screens === 1 ? null : 'cannon-screen-too-many';
  }
  if (upper === 'N') {
    const leg = horseLegIndex(from, to);
    if (leg < 0) return 'not-a-horse-move';
    return board[leg] === '' ? null : 'horse-leg-blocked';
  }
  if (upper === 'B') {
    if (Math.abs(dr) !== 2 || Math.abs(dc) !== 2) return 'not-an-elephant-move';
    if (side === RED_SIDE ? toRow < 5 : toRow > 4) return 'elephant-crosses-river';
    return board[(row + dr / 2) * BOARD_COLS + (col + dc / 2)] === '' ? null : 'elephant-eye-blocked';
  }
  if (upper === 'A') {
    if (Math.abs(dr) !== 1 || Math.abs(dc) !== 1) return 'not-an-advisor-move';
    return isInPalace(toRow, toCol, side) ? null : 'advisor-out-of-palace';
  }
  if (upper === 'K') {
    if (Math.abs(dr) + Math.abs(dc) !== 1) return 'not-a-king-move';
    return isInPalace(toRow, toCol, side) ? null : 'king-out-of-palace';
  }
  if (upper === 'P') {
    const forward = side === RED_SIDE ? -1 : 1;
    if (dc === 0 && dr === forward) return null;
    if (dc === 0 && dr === -forward) return 'pawn-backward';
    if (dr === 0 && Math.abs(dc) === 1) return hasCrossedRiver(row, side) ? null : 'pawn-sideways-before-river';
    return 'not-a-pawn-move';
  }
  return 'unknown-piece';
}

/**
 * 判定着法并给出机器可读的拒绝原因码；合法返回 null。
 * 供测试夹具（§5.4 规则反例集）与 UI 分层使用：码稳定，文案可变。
 */
export function moveRejectCode(pos, move) {
  if (!isValidPosition(pos)) return 'invalid-position';
  if (!move || typeof move !== 'object') return 'malformed-move';
  const { from, to } = move;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return 'malformed-move';
  if (from < 0 || from >= BOARD_SIZE || to < 0 || to >= BOARD_SIZE) return 'off-board';
  const piece = pos.board[from];
  if (piece === '') return 'empty-from';
  if (colorOfPiece(piece) !== pos.turn) return 'not-your-piece';
  if (from === to) return 'no-movement';
  const target = pos.board[to];
  if (target !== '' && colorOfPiece(target) === pos.turn) return 'own-piece-target';
  const pattern = piecePatternRejectCode(pos.board, from, to, piece);
  if (pattern !== null) return pattern;

  const board = pos.board;
  const oppSide = oppositeSide(pos.turn);
  const ownKing = findKingIndex(board, pos.turn);
  const captured = makeMoveOnBoard(board, from, to);
  const attacked = ownKing >= 0 && isSquareAttacked(board, from === ownKing ? to : ownKing, oppSide);
  const facing = attacked && kingsFaceOnBoard(board);
  unmakeMoveOnBoard(board, from, to, captured);
  if (facing) return 'king-facing';
  if (attacked) return 'self-check';
  return null;
}

/** 是否合法着法。 */
export function isLegalMove(pos, move) {
  return moveRejectCode(pos, move) === null;
}

/** 人话拒绝原因；合法返回 null。 */
export function moveRejectReason(pos, move) {
  const code = moveRejectCode(pos, move);
  if (code === null) return null;
  const tip = MOVE_REJECT_ZH[code] ?? code;
  const from = squareToIccs(move?.from);
  const to = squareToIccs(move?.to);
  const who = isValidPosition(pos) ? pieceNameZh(pos.board[move?.from] ?? '') : '';
  return `非法着法：${tip}（${from}${to}，${who}）`;
}
