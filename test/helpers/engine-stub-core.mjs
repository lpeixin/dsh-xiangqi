/**
 * 引擎 stub 的**核心**（仅测试用；**不得**放进 lib/）：局面构造/序列化、
 * 着法生成与合法性、局面状态、ICCS 记谱。
 *
 * 用途与边界见 `engine-stub.mjs` 的文件头。拆成两个文件是为了守住 §11-R8 的单文件行数上限。
 */

export const PIECE_NAMES_ZH = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
};
const FEN_TO_CHAR = { h: 'n', e: 'b' };

export class PositionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PositionError';
  }
}

const isRed = (piece) => piece !== '' && piece === piece.toUpperCase();
const sideOf = (piece) => (piece === '' ? null : isRed(piece) ? 'r' : 'b');
const rowOf = (index) => Math.floor(index / 9);
const colOf = (index) => index % 9;
const inside = (row, col) => row >= 0 && row < 10 && col >= 0 && col < 9;
const inPalace = (row, col, side) => col >= 3 && col <= 5 && (side === 'r' ? row >= 7 && row <= 9 : row >= 0 && row <= 2);
const ownSide = (row, side) => (side === 'r' ? row >= 5 : row <= 4);

function emptyBoard() {
  return new Array(90).fill('');
}

const INITIAL_ROWS = [
  'rnbakabnr',
  '.........',
  '.c.....c.',
  'p.p.p.p.p',
  '.........',
  '.........',
  'P.P.P.P.P',
  '.C.....C.',
  '.........',
  'RNBAKABNR',
];

export function initialPosition() {
  const board = emptyBoard();
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const ch = INITIAL_ROWS[row][col];
      if (ch !== '.') board[row * 9 + col] = ch;
    }
  }
  return { board, turn: 'r', halfmove: 0, fullmove: 1 };
}

export function clonePosition(pos) {
  return { board: pos.board.slice(), turn: pos.turn, halfmove: pos.halfmove, fullmove: pos.fullmove };
}

export function positionFromFen(fen) {
  if (typeof fen !== 'string') throw new PositionError('FEN 必须是字符串');
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 3) throw new PositionError('FEN 缺少字段');
  const [placement, turn, , , fullmove] = parts;
  const ranks = placement.split('/');
  if (ranks.length !== 10) throw new PositionError('FEN 行数不是 10');
  const board = emptyBoard();
  for (let row = 0; row < 10; row += 1) {
    let col = 0;
    for (const raw of ranks[row]) {
      const ch = FEN_TO_CHAR[raw] ?? raw;
      if (ch >= '1' && ch <= '9') {
        col += Number(ch);
      } else if (PIECE_NAMES_ZH[ch] !== undefined) {
        if (col > 8) throw new PositionError('FEN 行超出 9 列');
        board[row * 9 + col] = ch;
        col += 1;
      } else {
        throw new PositionError(`FEN 含非法字符 "${raw}"`);
      }
    }
    if (col !== 9) throw new PositionError('FEN 行宽不是 9');
  }
  if (turn !== 'w' && turn !== 'b' && turn !== 'r') throw new PositionError('FEN 走子方非法');
  const parsedFullmove = fullmove === undefined ? 1 : Number(fullmove);
  return {
    board,
    turn: turn === 'b' ? 'b' : 'r',
    halfmove: parts[4] === undefined ? 0 : Number(parts[4]),
    fullmove: Number.isFinite(parsedFullmove) && parsedFullmove > 0 ? parsedFullmove : 1,
  };
}

export function positionToFen(pos) {
  const ranks = [];
  for (let row = 0; row < 10; row += 1) {
    let text = '';
    let gap = 0;
    for (let col = 0; col < 9; col += 1) {
      const piece = pos.board[row * 9 + col];
      if (piece === '') gap += 1;
      else {
        if (gap > 0) text += String(gap);
        gap = 0;
        text += piece;
      }
    }
    if (gap > 0) text += String(gap);
    ranks.push(text);
  }
  return `${ranks.join('/')} ${pos.turn === 'r' ? 'w' : 'b'} - - ${pos.halfmove} ${pos.fullmove}`;
}

function isAttackedBy(pos, target, side) {
  const board = pos.board;
  const tRow = rowOf(target);
  const tCol = colOf(target);
  // 兵/卒
  const forward = side === 'r' ? -1 : 1;
  if (inside(tRow - forward, tCol) && board[(tRow - forward) * 9 + tCol] === (side === 'r' ? 'P' : 'p')) return true;
  for (const dc of [-1, 1]) {
    if (!inside(tRow, tCol + dc)) continue;
    const piece = board[tRow * 9 + tCol + dc];
    if (piece !== (side === 'r' ? 'P' : 'p')) continue;
    const crossed = side === 'r' ? rowOf(tRow * 9 + tCol + dc) <= 4 : rowOf(tRow * 9 + tCol + dc) >= 5;
    if (crossed) return true;
  }
  // 马
  for (const [dr, dc, lr, lc] of [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]]) {
    const r = tRow + dr;
    const c = tCol + dc;
    if (!inside(r, c)) continue;
    if (board[r * 9 + c] !== (side === 'r' ? 'N' : 'n')) continue;
    const legRow = r + lr;
    const legCol = c + lc;
    if (!inside(legRow, legCol)) continue;
    if (board[legRow * 9 + legCol] === '') return true;
  }
  // 车 / 炮 / 帅（飞将）
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    let r = tRow + dr;
    let c = tCol + dc;
    let screens = 0;
    while (inside(r, c)) {
      const piece = board[r * 9 + c];
      if (piece !== '') {
        const pieceSide = sideOf(piece);
        const type = piece.toUpperCase();
        if (screens === 0) {
          if (pieceSide === side && (type === 'R' || (type === 'K' && Math.abs(r - tRow) + Math.abs(c - tCol) === 1))) return true;
          if (pieceSide === side && type === 'K' && (dr === 0) && tCol === c) return true;
        } else if (screens === 1 && pieceSide === side && type === 'C') {
          return true;
        }
        screens += 1;
        if (screens > 1) break;
      }
      r += dr;
      c += dc;
    }
  }
  return false;
}

function kingIndex(pos, side) {
  const king = side === 'r' ? 'K' : 'k';
  for (let i = 0; i < 90; i += 1) if (pos.board[i] === king) return i;
  return -1;
}

export function isInCheck(pos, side = pos.turn) {
  const king = kingIndex(pos, side);
  if (king < 0) return false;
  return isAttackedBy(pos, king, side === 'r' ? 'b' : 'r');
}

function kingsFacing(pos) {
  const red = kingIndex(pos, 'r');
  const black = kingIndex(pos, 'b');
  if (red < 0 || black < 0) return false;
  if (colOf(red) !== colOf(black)) return false;
  const col = colOf(red);
  const from = Math.min(rowOf(red), rowOf(black)) + 1;
  const to = Math.max(rowOf(red), rowOf(black));
  for (let row = from; row < to; row += 1) if (pos.board[row * 9 + col] !== '') return false;
  return true;
}

function pushIfEmpty(out, row, col) {
  if (inside(row, col)) out.push({ row, col });
}

function pseudoFor(pos, from) {
  const board = pos.board;
  const piece = board[from];
  const type = piece.toUpperCase();
  const side = sideOf(piece);
  const row = rowOf(from);
  const col = colOf(from);
  const out = [];
  const add = (r, c) => {
    if (!inside(r, c)) return false;
    const target = board[r * 9 + c];
    if (target !== '' && sideOf(target) === side) return false;
    out.push({ from, to: r * 9 + c });
    return target === '';
  };
  if (type === 'R' || type === 'C') {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let r = row + dr;
      let c = col + dc;
      let jumped = false;
      while (inside(r, c)) {
        const target = board[r * 9 + c];
        if (type === 'R') {
          if (target !== '' && sideOf(target) === side) break;
          out.push({ from, to: r * 9 + c });
          if (target !== '') break;
        } else if (!jumped) {
          if (target === '') out.push({ from, to: r * 9 + c });
          else jumped = true;
        } else if (target !== '') {
          if (sideOf(target) !== side) out.push({ from, to: r * 9 + c });
          break;
        }
        r += dr;
        c += dc;
      }
    }
    return out;
  }
  if (type === 'N') {
    for (const [dr, dc, lr, lc] of [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]]) {
      if (!inside(row + lr, col + lc) || board[(row + lr) * 9 + col + lc] !== '') continue;
      add(row + dr, col + dc);
    }
    return out;
  }
  if (type === 'B') {
    for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
      const r = row + dr;
      const c = col + dc;
      if (!inside(r, c) || !ownSide(r, side)) continue;
      if (board[(row + dr / 2) * 9 + col + dc / 2] !== '') continue;
      add(r, c);
    }
    return out;
  }
  if (type === 'A') {
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const r = row + dr;
      const c = col + dc;
      if (!inside(r, c) || !inPalace(r, c, side)) continue;
      add(r, c);
    }
    return out;
  }
  if (type === 'K') {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const r = row + dr;
      const c = col + dc;
      if (!inside(r, c) || !inPalace(r, c, side)) continue;
      add(r, c);
    }
    return out;
  }
  if (type === 'P') {
    const forward = side === 'r' ? -1 : 1;
    add(row + forward, col);
    const crossed = side === 'r' ? row <= 4 : row >= 5;
    if (crossed) {
      add(row, col - 1);
      add(row, col + 1);
    }
    return out;
  }
  return out;
}

export function pseudoLegalMoves(pos) {
  const out = [];
  for (let i = 0; i < 90; i += 1) {
    const piece = pos.board[i];
    if (piece === '' || sideOf(piece) !== pos.turn) continue;
    out.push(...pseudoFor(pos, i));
  }
  return out;
}

export function applyMove(pos, move) {
  const next = clonePosition(pos);
  const piece = next.board[move.from];
  const captured = next.board[move.to];
  next.board[move.from] = '';
  next.board[move.to] = piece;
  next.turn = pos.turn === 'r' ? 'b' : 'r';
  next.halfmove = captured === '' ? pos.halfmove + 1 : 0;
  next.fullmove = pos.turn === 'b' ? pos.fullmove + 1 : pos.fullmove;
  return next;
}

function leavesOwnKingSafe(pos, move) {
  const next = applyMove(pos, move);
  if (kingsFacing(next)) return false;
  return !isInCheck(next, pos.turn);
}

export function generateMoves(pos) {
  return pseudoLegalMoves(pos).filter((move) => leavesOwnKingSafe(pos, move));
}

export function isLegalMove(pos, move) {
  if (!move || typeof move.from !== 'number' || typeof move.to !== 'number') return false;
  if (move.from < 0 || move.from > 89 || move.to < 0 || move.to > 89 || move.from === move.to) return false;
  return generateMoves(pos).some((m) => m.from === move.from && m.to === move.to);
}

export function moveRejectReason(pos, move) {
  if (!move || typeof move.from !== 'number' || typeof move.to !== 'number') return '着法格式不正确';
  if (move.from < 0 || move.from > 89 || move.to < 0 || move.to > 89) return '坐标越界';
  if (move.from === move.to) return '起止点相同';
  const piece = pos.board[move.from];
  if (piece === '') return '起点没有棋子';
  if (sideOf(piece) !== pos.turn) return '不能移动对方的棋子';
  if (pos.board[move.to] !== '' && sideOf(pos.board[move.to]) === pos.turn) return '目标点有己方棋子';
  if (!pseudoLegalMoves(pos).some((m) => m.from === move.from && m.to === move.to)) return '该棋子不能这样走';
  const next = applyMove(pos, move);
  if (kingsFacing(next)) return '将帅不可照面';
  if (isInCheck(next, pos.turn)) return '走后自己被将军';
  return null;
}

function repeatCount(history, fen) {
  let count = 0;
  for (const entry of history) if (entry === fen) count += 1;
  return count;
}

export function gameStatus(pos, history = []) {
  const moves = generateMoves(pos);
  const check = isInCheck(pos, pos.turn);
  const winner = pos.turn === 'r' ? 'b' : 'r';
  if (moves.length === 0) {
    return check
      ? { state: 'checkmate', winner, reason: 'checkmate', reasonZh: `${pos.turn === 'r' ? '红方' : '黑方'}被将死` }
      : { state: 'stalemate', winner, reason: 'stalemate', reasonZh: `${pos.turn === 'r' ? '红方' : '黑方'}无着法，判负` };
  }
  const fen = positionToFen(pos);
  if (repeatCount(history, fen) >= 3) {
    return { state: 'draw-repetition', winner: null, reason: 'repetition', reasonZh: '三次重复局面，和棋' };
  }
  if (pos.halfmove >= 120) {
    return { state: 'draw-fifty', winner: null, reason: 'fifty-move', reasonZh: '自然限着，和棋' };
  }
  if (check) {
    return { state: 'check', winner: null, reason: 'check', reasonZh: `${pos.turn === 'r' ? '红方' : '黑方'}被将军` };
  }
  return { state: 'playing', winner: null, reason: 'playing', reasonZh: '对局进行中' };
}

export function moveToIccs(move) {
  const file = String.fromCharCode(97 + colOf(move.from));
  const rank = 9 - rowOf(move.from);
  const file2 = String.fromCharCode(97 + colOf(move.to));
  const rank2 = 9 - rowOf(move.to);
  return `${file}${rank}${file2}${rank2}`;
}

export function iccsToMove(pos, iccs) {
  if (typeof iccs !== 'string') return null;
  const match = /^([a-i])(\d)([a-i])(\d)$/.exec(iccs.trim().toLowerCase());
  if (match === null) return null;
  const from = (9 - Number(match[2])) * 9 + (match[1].charCodeAt(0) - 97);
  const to = (9 - Number(match[4])) * 9 + (match[3].charCodeAt(0) - 97);
  if (from < 0 || from > 89 || to < 0 || to > 89) return null;
  if (pos.board[from] === '' || sideOf(pos.board[from]) !== pos.turn) return null;
  return { from, to };
}
