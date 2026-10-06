/**
 * FEN 解析与导出（§5.1、§5.8.3）。
 *
 * 关键坑：中国象棋 FEN 有两套字母方言——马/象写作 `n/b`（本项目导出方言）
 * 或写作 `h/e`（Chess Programming Wiki 的 perft 用例）。导入时先归一化，
 * 否则 `h`/`e` 会被当成非法字符，或者更糟：被静默当成空格导致整盘错位。
 */

import { BOARD_COLS, BOARD_ROWS, BOARD_SIZE } from './coords.js';

/** 局面非法（只由 positionFromFen / positionToFen 抛出，见 §5.3）。 */
export class PositionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PositionError';
  }
}

/** 初始局面（§5.1 的通行 FEN）。 */
export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

const LEGAL_PIECES = 'KABNRCPkabnrcp';

/** 合法棋子字符。空格用 '' 表示，这里自然为 false。 */
export function isPieceChar(ch) {
  return typeof ch === 'string' && ch.length === 1 && LEGAL_PIECES.includes(ch);
}

/**
 * 把 h/e 方言归一化成 n/b。
 * 只替换字母，不碰数字与 '/'，因此可以整段套在棋盘字段上。
 */
export function normalizeFenDialect(text) {
  return String(text)
    .replace(/h/g, 'n')
    .replace(/H/g, 'N')
    .replace(/e/g, 'b')
    .replace(/E/g, 'B');
}

/** 初始局面。每次返回新对象，调用方随便改。 */
export function initialPosition() {
  return positionFromFen(START_FEN);
}

/** 浅拷贝（board 也复制），applyMove 的纯函数语义靠它。 */
export function clonePosition(pos) {
  return {
    board: pos.board.slice(),
    turn: pos.turn,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
  };
}

/** 结构合法的局面对象判定。用于「非法输入不抛异常」的边界分支。 */
export function isValidPosition(pos) {
  if (!pos || typeof pos !== 'object') return false;
  if (!Array.isArray(pos.board) || pos.board.length !== BOARD_SIZE) return false;
  if (pos.turn !== 'r' && pos.turn !== 'b') return false;
  if (!Number.isInteger(pos.halfmove) || pos.halfmove < 0) return false;
  if (!Number.isInteger(pos.fullmove) || pos.fullmove < 1) return false;
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const piece = pos.board[i];
    if (piece !== '' && !isPieceChar(piece)) return false;
  }
  return true;
}

/** 解析棋盘字段（10 行 / 9 列）。失败返回 null，由调用方决定错误文案。 */
function parseFenBoard(field) {
  const rows = field.split('/');
  if (rows.length !== BOARD_ROWS) return null;
  const board = new Array(BOARD_SIZE).fill('');
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    const text = rows[row];
    let col = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch >= '1' && ch <= '9') {
        col += Number(ch);
      } else if (isPieceChar(ch)) {
        if (col >= BOARD_COLS) return null;
        board[row * BOARD_COLS + col] = ch;
        col += 1;
      } else {
        return null;
      }
    }
    if (col !== BOARD_COLS) return null;
  }
  return board;
}

/** 归一的走子方字段。接受 w/r/red 与 b/black 两套写法。 */
function parseFenTurn(field) {
  const text = String(field ?? '').toLowerCase();
  if (text === 'w' || text === 'r' || text === 'red') return 'r';
  if (text === 'b' || text === 'black') return 'b';
  return null;
}

/**
 * FEN → 局面。非法时抛 PositionError（§5.3 唯一允许抛异常的入口）。
 * `h/e` 与 `n/b` 两套方言都接受，内部统一成 `n/b`。
 */
export function positionFromFen(fen) {
  if (typeof fen !== 'string' || fen.trim() === '') {
    throw new PositionError('FEN 必须是字符串且不能为空');
  }
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 2) {
    throw new PositionError(`FEN 字段不足（至少需要棋盘与走子方）：${fen}`);
  }
  const boardField = normalizeFenDialect(fields[0]);
  const turn = parseFenTurn(fields[1]);
  if (turn === null) {
    throw new PositionError(`FEN 走子方非法（应为 w/b）：${fields[1]}`);
  }
  const board = parseFenBoard(boardField);
  if (board === null) {
    throw new PositionError(`FEN 棋盘字段非法（应为 10 行、每行合计 9 格）：${fields[0]}`);
  }
  let redKings = 0;
  let blackKings = 0;
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    if (board[i] === 'K') redKings += 1;
    else if (board[i] === 'k') blackKings += 1;
  }
  if (redKings !== 1 || blackKings !== 1) {
    throw new PositionError(`FEN 必须恰好各有一个帅与将（实际 K=${redKings} k=${blackKings}）`);
  }
  // 半回合/回合字段在部分实现里被省略，缺失时按「新开局」补默认值。
  const halfmove = fields.length >= 5 ? Number(fields[4]) : 0;
  const fullmove = fields.length >= 6 ? Number(fields[5]) : 1;
  return {
    board,
    turn,
    halfmove: Number.isInteger(halfmove) && halfmove >= 0 ? halfmove : 0,
    fullmove: Number.isInteger(fullmove) && fullmove >= 1 ? fullmove : 1,
  };
}

/**
 * 局面 → FEN（只导出 `n/b` 方言，§5.1）。
 * 与 positionFromFen 不对称：这里收到的是自己的数据结构，结构坏了说明上游有 bug，
 * 直接抛 PositionError 比默默导出一串错 FEN 更容易定位。
 */
export function positionToFen(pos) {
  if (!isValidPosition(pos)) {
    throw new PositionError('positionToFen 收到结构非法的 Position');
  }
  const rows = [];
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    let text = '';
    let gap = 0;
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const piece = pos.board[row * BOARD_COLS + col];
      if (piece === '') {
        gap += 1;
        continue;
      }
      if (gap > 0) {
        text += String(gap);
        gap = 0;
      }
      text += piece;
    }
    if (gap > 0) text += String(gap);
    rows.push(text);
  }
  const side = pos.turn === 'r' ? 'w' : 'b';
  return `${rows.join('/')} ${side} - - ${pos.halfmove} ${pos.fullmove}`;
}

/** 局面的「同型」键（只含棋盘与走子方），三次重复判定用。 */
export function positionKeyOf(pos) {
  return `${pos.board.join('')}${pos.turn}`;
}

/** FEN 字符串的同型键；解析失败返回 null。 */
export function fenKeyOf(fen) {
  try {
    const pos = positionFromFen(fen);
    return positionKeyOf(pos);
  } catch {
    return null;
  }
}
