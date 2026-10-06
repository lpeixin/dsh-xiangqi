/**
 * 着法生成与合法性判定（§5.2、§5.4）——引擎的热路径。
 *
 * 三个决定：整数编码着法（见 coords.js），因为 perft 深度 4 要判定三百万次着法，
 * 对象会让 GC 成为瓶颈；「将帅照面」并进 `isSquareAttackedBy`，同列无遮挡的对方
 * 将帅本身就是攻击，三种照面情形被同一条判据覆盖；make/unmake 就地做并立刻还原。
 * 拒绝原因在 rules.js（§5.4 的对照面），本文件只剩「怎么走」。
 */

import { BOARD_COLS, BOARD_ROWS, BOARD_SIZE, RED_SIDE, BLACK_SIDE, RED_CODE, BLACK_CODE, oppositeSide, idxToRow, idxToCol, isOnBoard, isInPalace, hasCrossedRiver, ORTHO_DR, ORTHO_DC, DIAG_DR, DIAG_DC, HORSE_DR, HORSE_DC, encodeMoveCode, decodeMoveFrom, decodeMoveTo } from './coords.js';

import { clonePosition, isValidPosition } from './fen.js';


/** 棋子字符码 → 颜色码（1 红 / 2 黑 / 0 空）。查表是为了避开热路径里的 toUpperCase。 */
const PIECE_SIDE_BY_CODE = new Uint8Array(128);
for (const ch of 'KABNRCP') PIECE_SIDE_BY_CODE[ch.charCodeAt(0)] = RED_CODE;
for (const ch of 'kabnrcp') PIECE_SIDE_BY_CODE[ch.charCodeAt(0)] = BLACK_CODE;

/** 棋子 → 颜色码（0 = 空/非法）。 */
export function pieceSideCode(piece) {
  if (!piece) return 0;
  const code = piece.charCodeAt(0);
  return code < 128 ? PIECE_SIDE_BY_CODE[code] : 0;
}

/** 找到某方帅/将的位置；不存在返回 -1。 */
export function findKingIndex(board, side) {
  const king = side === RED_SIDE ? 'K' : 'k';
  for (let i = 0; i < BOARD_SIZE; i += 1) if (board[i] === king) return i;
  return -1;
}

/** 就地落子，返回被吃子（供 unmake）。 */
export function makeMoveOnBoard(board, from, to) {
  const captured = board[to];
  board[to] = board[from];
  board[from] = '';
  return captured;
}

/** 就地撤销落子。 */
export function unmakeMoveOnBoard(board, from, to, captured) {
  board[from] = board[to];
  board[to] = captured;
}

/**
 * `index` 是否被 byCode 方攻击：含兵/卒的直进与过河横走、蹩马腿、炮架、
 * 以及「同列无遮挡的对方将帅」。index 传帅/将所在格时，本函数即「被将军」。
 */
export function isSquareAttackedBy(board, index, byCode) {
  if (index < 0) return false;
  const row = idxToRow(index);
  const col = idxToCol(index);
  const red = byCode === RED_CODE;
  const pawn = red ? 'P' : 'p';
  const horse = red ? 'N' : 'n';
  const rook = red ? 'R' : 'r';
  const cannon = red ? 'C' : 'c';
  const king = red ? 'K' : 'k';

  // 兵/卒：直前一格永远可攻；过河后还能横攻。
  const pawnRow = red ? row + 1 : row - 1;
  if (pawnRow >= 0 && pawnRow < BOARD_ROWS && board[pawnRow * BOARD_COLS + col] === pawn) return true;
  if (red ? row <= 4 : row >= 5) {
    if (col > 0 && board[row * BOARD_COLS + col - 1] === pawn) return true;
    if (col < BOARD_COLS - 1 && board[row * BOARD_COLS + col + 1] === pawn) return true;
  }

  // 马：反推马的位置再验马腿。马腿紧贴**马**那一侧（2 步轴的中点），不是紧贴被
  // 攻击点——按后者算会在「马在近处、腿在远处」的几何上放过本该被蹩住的马。
  for (let i = 0; i < 8; i += 1) {
    const r = row + HORSE_DR[i];
    const c = col + HORSE_DC[i];
    if (!isOnBoard(r, c) || board[r * BOARD_COLS + c] !== horse) continue;
    const legRow = Math.abs(HORSE_DR[i]) === 2 ? r - HORSE_DR[i] / 2 : r;
    const legCol = Math.abs(HORSE_DC[i]) === 2 ? c - HORSE_DC[i] / 2 : c;
    if (board[legRow * BOARD_COLS + legCol] === '') return true;
  }

  // 直线：第一个子可能是车或将帅（飞将），第二个子可能是炮。
  for (let d = 0; d < 4; d += 1) {
    let r = row + ORTHO_DR[d];
    let c = col + ORTHO_DC[d];
    let screen = false;
    while (isOnBoard(r, c)) {
      const piece = board[r * BOARD_COLS + c];
      if (piece !== '') {
        if (!screen) {
          if (piece === rook) return true;
          if (piece === king && ORTHO_DC[d] === 0) return true;
          screen = true;
        } else {
          if (piece === cannon) return true;
          break;
        }
      }
      r += ORTHO_DR[d];
      c += ORTHO_DC[d];
    }
  }
  return false;
}

/** 对外版本：side 用 'r'/'b'。 */
export function isSquareAttacked(board, index, bySide) {
  return isSquareAttackedBy(board, index, bySide === RED_SIDE ? RED_CODE : BLACK_CODE);
}

/** 追加某方全部伪合法着法（不校验送将/照面）。 */
export function collectPseudoMoves(board, side, out) {
  const sideCode = side === RED_SIDE ? RED_CODE : BLACK_CODE;
  for (let from = 0; from < BOARD_SIZE; from += 1) {
    const piece = board[from];
    if (piece === '' || pieceSideCode(piece) !== sideCode) continue;
    const upper = piece.toUpperCase();
    if (upper === 'R' || upper === 'C') pushLineMoves(board, from, sideCode, upper === 'C', out);
    else if (upper === 'N') pushHorseMoves(board, from, sideCode, out);
    else if (upper === 'B') pushElephantMoves(board, from, sideCode, out);
    else if (upper === 'A') pushAdvisorMoves(board, from, sideCode, out);
    else if (upper === 'K') pushKingMoves(board, from, sideCode, out);
    else if (upper === 'P') pushPawnMoves(board, from, sideCode, out);
  }
  return out;
}

/** 追加某方全部合法着法（已过滤送将、照面、挡将）。 */
export function collectLegalMoves(board, side, out) {
  const sideCode = side === RED_SIDE ? RED_CODE : BLACK_CODE;
  const oppCode = sideCode === RED_CODE ? BLACK_CODE : RED_CODE;
  const ownKing = findKingIndex(board, side);
  for (const code of collectPseudoMoves(board, side, [])) {
    const from = decodeMoveFrom(code);
    const to = decodeMoveTo(code);
    const captured = makeMoveOnBoard(board, from, to);
    const ok = ownKing < 0 || !isSquareAttackedBy(board, from === ownKing ? to : ownKing, oppCode);
    unmakeMoveOnBoard(board, from, to, captured);
    if (ok) out.push(code);
  }
  return out;
}

/** 落点非己方子就追加（调用方已保证 to 在盘上）。 */
function pushIfReachable(board, from, to, sideCode, out) {
  const target = board[to];
  if (target !== '' && pieceSideCode(target) === sideCode) return;
  out.push(encodeMoveCode(from, to));
}

/** 车（isCannon=false）与炮（isCannon=true）的直线着法。 */
function pushLineMoves(board, from, sideCode, isCannon, out) {
  const row = idxToRow(from);
  const col = idxToCol(from);
  for (let d = 0; d < 4; d += 1) {
    let r = row + ORTHO_DR[d];
    let c = col + ORTHO_DC[d];
    let screen = false;
    while (isOnBoard(r, c)) {
      const to = r * BOARD_COLS + c;
      const target = board[to];
      if (target === '') {
        if (!screen) out.push(encodeMoveCode(from, to));
      } else if (!screen) {
        // 车撞上第一个子只能吃；炮把第一个子当炮架，继续找第二个子。
        if (!isCannon && pieceSideCode(target) !== sideCode) out.push(encodeMoveCode(from, to));
        if (!isCannon) break;
        screen = true;
      } else {
        if (isCannon && pieceSideCode(target) !== sideCode) out.push(encodeMoveCode(from, to));
        break;
      }
      r += ORTHO_DR[d];
      c += ORTHO_DC[d];
    }
  }
  return out;
}

/** 马：先看马腿（紧邻马的那一格），再看落点。 */
function pushHorseMoves(board, from, sideCode, out) {
  const row = idxToRow(from);
  const col = idxToCol(from);
  for (let i = 0; i < 8; i += 1) {
    const r = row + HORSE_DR[i];
    const c = col + HORSE_DC[i];
    if (!isOnBoard(r, c)) continue;
    const legRow = Math.abs(HORSE_DR[i]) === 2 ? row + HORSE_DR[i] / 2 : row;
    const legCol = Math.abs(HORSE_DC[i]) === 2 ? col + HORSE_DC[i] / 2 : col;
    if (board[legRow * BOARD_COLS + legCol] !== '') continue;
    pushIfReachable(board, from, r * BOARD_COLS + c, sideCode, out);
  }
  return out;
}

/** 相/象：塞象眼 + 不过河。 */
function pushElephantMoves(board, from, sideCode, out) {
  const row = idxToRow(from);
  const col = idxToCol(from);
  for (let i = 0; i < 4; i += 1) {
    const r = row + DIAG_DR[i] * 2;
    const c = col + DIAG_DC[i] * 2;
    if (!isOnBoard(r, c)) continue;
    if (sideCode === RED_CODE ? r < 5 : r > 4) continue;
    if (board[(row + DIAG_DR[i]) * BOARD_COLS + (col + DIAG_DC[i])] !== '') continue;
    pushIfReachable(board, from, r * BOARD_COLS + c, sideCode, out);
  }
  return out;
}

/** 仕/士：九宫内斜走一格。 */
function pushAdvisorMoves(board, from, sideCode, out) {
  const row = idxToRow(from);
  const col = idxToCol(from);
  const side = sideCode === RED_CODE ? RED_SIDE : BLACK_SIDE;
  for (let i = 0; i < 4; i += 1) {
    const r = row + DIAG_DR[i];
    const c = col + DIAG_DC[i];
    if (isInPalace(r, c, side)) pushIfReachable(board, from, r * BOARD_COLS + c, sideCode, out);
  }
  return out;
}

/** 帅/将：九宫内直走一格。 */
function pushKingMoves(board, from, sideCode, out) {
  const row = idxToRow(from);
  const col = idxToCol(from);
  const side = sideCode === RED_CODE ? RED_SIDE : BLACK_SIDE;
  for (let d = 0; d < 4; d += 1) {
    const r = row + ORTHO_DR[d];
    const c = col + ORTHO_DC[d];
    if (isInPalace(r, c, side)) pushIfReachable(board, from, r * BOARD_COLS + c, sideCode, out);
  }
  return out;
}

/** 兵/卒：向前永远可走，过河后加横走，永不后退。 */
function pushPawnMoves(board, from, sideCode, out) {
  const row = idxToRow(from);
  const col = idxToCol(from);
  const red = sideCode === RED_CODE;
  const r = row + (red ? -1 : 1);
  if (r >= 0 && r < BOARD_ROWS) pushIfReachable(board, from, r * BOARD_COLS + col, sideCode, out);
  if (hasCrossedRiver(row, red ? RED_SIDE : BLACK_SIDE)) {
    if (col > 0) pushIfReachable(board, from, row * BOARD_COLS + col - 1, sideCode, out);
    if (col < BOARD_COLS - 1) pushIfReachable(board, from, row * BOARD_COLS + col + 1, sideCode, out);
  }
  return out;
}

/** 整数编码着法批量转成 §5.2 的 Move 对象。 */
export function toMoveObjects(codes) {
  const out = new Array(codes.length);
  for (let i = 0; i < codes.length; i += 1) {
    out[i] = { from: decodeMoveFrom(codes[i]), to: decodeMoveTo(codes[i]) };
  }
  return out;
}

/** 全部伪合法着法（不校验送将/照面）。 */
export function pseudoLegalMoves(pos) {
  if (!isValidPosition(pos)) return [];
  return toMoveObjects(collectPseudoMoves(pos.board, pos.turn, []));
}

/** 全部合法着法。 */
export function generateMoves(pos) {
  if (!isValidPosition(pos)) return [];
  return toMoveObjects(collectLegalMoves(pos.board, pos.turn, []));
}

/**
 * 落子（不校验合法性，§5.3）。返回新对象，入参不变。
 * 着法形状非法时原样返回克隆——让调用方的 bug 以「局面没变」的形式暴露，
 * 而不是抛异常把上层对局状态机打断。
 */
export function applyMove(pos, move) {
  if (!isValidPosition(pos)) return pos;
  const next = clonePosition(pos);
  if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to)) return next;
  if (move.from < 0 || move.from >= BOARD_SIZE || move.to < 0 || move.to >= BOARD_SIZE) return next;
  const captured = next.board[move.to];
  next.board[move.to] = next.board[move.from];
  next.board[move.from] = '';
  next.halfmove = captured === '' ? pos.halfmove + 1 : 0;
  next.fullmove = pos.turn === BLACK_SIDE ? pos.fullmove + 1 : pos.fullmove;
  next.turn = oppositeSide(pos.turn);
  return next;
}
