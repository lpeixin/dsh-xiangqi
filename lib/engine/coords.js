/**
 * 坐标与记号换算。引擎里所有「索引」都是 `row * 9 + col`（§5.1）。
 *
 * 为什么把换算集中在一个文件：棋盘有四种等价表示（内部索引、行列、ICCS、
 * 中文文件号），任何一处自己手写 `9 - row` 都会在下一次改动时漏改。
 * 这里只做纯换算，不含任何规则判断，便于单测逐条钉住。
 *
 * 注意：中文文件号的方向由**走子方**决定（红方右起、黑方左起），
 * 所以所有涉及文件号的函数都必须显式传 side，不能靠调用方自觉。
 */

export const BOARD_ROWS = 10;
export const BOARD_COLS = 9;
export const BOARD_SIZE = 90;

export const RED_SIDE = 'r';
export const BLACK_SIDE = 'b';

/** 颜色码：热路径里用数字代替字符串比较（1 = 红、2 = 黑、0 = 空/非法）。 */
export const RED_CODE = 1;
export const BLACK_CODE = 2;

/** 中文数字，下标 0 对应「一」。 */
const ZH_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 棋子 → 中文名（帅仕相马车炮兵 / 将士象马车炮卒）。 */
const ZH_PIECE_NAMES = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
};

/** 棋子 → 子力价值（厘兵，§5.7）。过河兵加成由调用方叠加。 */
export const PIECE_BASE_VALUE = { K: 0, A: 200, B: 200, N: 400, R: 900, C: 450, P: 100, k: 0, a: 200, b: 200, n: 400, r: 900, c: 450, p: 100 };

/** 行号。索引越界时返回 -1 而不是 NaN，便于 `=== -1` 判定。 */
export function idxToRow(index) {
  return index >= 0 && index < BOARD_SIZE ? Math.floor(index / BOARD_COLS) : -1;
}

/** 列号。索引越界时返回 -1。 */
export function idxToCol(index) {
  return index >= 0 && index < BOARD_SIZE ? index % BOARD_COLS : -1;
}

/** 行列 → 索引；不在盘上时返回 -1。 */
export function rcToIdx(row, col) {
  return isOnBoard(row, col) ? row * BOARD_COLS + col : -1;
}

/** 行列是否在 10x9 盘面内。 */
export function isOnBoard(row, col) {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
}

/** 棋子颜色；空格返回 null。大小写即颜色，这是 FEN 的约定。 */
export function colorOfPiece(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? RED_SIDE : BLACK_SIDE;
}

/** 对方。只对 'r'/'b' 有意义，其它输入原样返回。 */
export function oppositeSide(side) {
  return side === RED_SIDE ? BLACK_SIDE : RED_SIDE;
}

/** 中文侧名，用于人话消息。 */
export function sideNameZh(side) {
  return side === RED_SIDE ? '红方' : '黑方';
}

/** 棋子中文名；空格返回「空」。 */
export function pieceNameZh(piece) {
  return ZH_PIECE_NAMES[piece] ?? '空';
}

/** 内部索引 → ICCS，如 0 → 'a9'。越界返回 ''。 */
export function squareToIccs(index) {
  const row = idxToRow(index);
  const col = idxToCol(index);
  if (row < 0 || col < 0) return '';
  return String.fromCharCode(97 + col) + String(9 - row);
}

/** ICCS → 内部索引；非法或越界返回 -1。 */
export function iccsToSquare(text) {
  if (typeof text !== 'string' || text.length !== 2) return -1;
  const col = text.charCodeAt(0);
  const rank = text.charCodeAt(1);
  const c = col >= 97 && col <= 105 ? col - 97 : col >= 65 && col <= 73 ? col - 65 : -1;
  if (c < 0 || rank < 48 || rank > 57) return -1;
  return rcToIdx(9 - (rank - 48), c);
}

/** 列 → 该方视角的文件号（红右起、黑左起）。 */
export function colToFileNumber(col, side) {
  return side === RED_SIDE ? 9 - col : col + 1;
}

/** 该方视角的文件号 → 列；越界返回 -1。 */
export function fileNumberToCol(fileNumber, side) {
  const col = side === RED_SIDE ? 9 - fileNumber : fileNumber - 1;
  return col >= 0 && col < BOARD_COLS ? col : -1;
}

/** 该方视角的文件号 → 记谱用数字文本（红中文、黑阿拉伯）。 */
export function fileNumberText(fileNumber, side) {
  return side === RED_SIDE ? ZH_DIGITS[fileNumber - 1] ?? '' : String(fileNumber);
}

/** 数字 → 记谱文本（红中文、黑阿拉伯）；用于「进/退几步」。 */
export function countText(count, side) {
  return side === RED_SIDE ? ZH_DIGITS[count - 1] ?? '' : String(count);
}

/** 单个中文数字字符 → 数字；非中文数字返回 0。 */
export function zhDigitValue(ch) {
  const index = ZH_DIGITS.indexOf(ch);
  return index < 0 ? 0 : index + 1;
}

/** 该方是否已过河（红方 row ≤ 4，黑方 row ≥ 5）。 */
export function hasCrossedRiver(row, side) {
  return side === RED_SIDE ? row <= 4 : row >= 5;
}

/** 行列是否落在该方九宫内（黑 row 0–2，红 row 7–9，col 3–5）。 */
export function isInPalace(row, col, side) {
  if (col < 3 || col > 5) return false;
  return side === RED_SIDE ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}

/**
 * 着法整数编码（低 7 位起点、其余位终点）。放在坐标模块是因为它与 idxToRow 一样
 * 属于「索引 ↔ 表示」的换算，且着法生成、合法性、搜索三处都要用，集中一处可避免
 * 各自复制移位常量。
 */
const MOVE_TO_SHIFT = 7;
const MOVE_FROM_MASK = 127;

export function encodeMoveCode(from, to) {
  return from | (to << MOVE_TO_SHIFT);
}

export function decodeMoveFrom(code) {
  return code & MOVE_FROM_MASK;
}

export function decodeMoveTo(code) {
  return (code >>> MOVE_TO_SHIFT) & MOVE_FROM_MASK;
}

/**
 * 行棋方向表。放在坐标模块而不是着法模块，是因为「马腿」「象眼」这类几何
 * 需要同时被着法生成、攻击判定、拒绝原因三处使用——各自写一份数组迟早会不同步。
 */
export const ORTHO_DR = [-1, 1, 0, 0];
export const ORTHO_DC = [0, 0, -1, 1];
export const DIAG_DR = [-1, -1, 1, 1];
export const DIAG_DC = [-1, 1, -1, 1];
export const HORSE_DR = [-2, -2, -1, -1, 1, 1, 2, 2];
export const HORSE_DC = [-1, 1, -2, 2, -2, 2, -1, 1];

/** 马从 from 走到 to 时的「马腿」索引；不是马步或越界时返回 -1。 */
export function horseLegIndex(from, to) {
  const dr = idxToRow(to) - idxToRow(from);
  const dc = idxToCol(to) - idxToCol(from);
  const index = HORSE_DR.findIndex((hr, i) => hr === dr && HORSE_DC[i] === dc);
  if (index < 0) return -1;
  const legRow = Math.abs(dr) === 2 ? idxToRow(from) + dr / 2 : idxToRow(from);
  const legCol = Math.abs(dc) === 2 ? idxToCol(from) + dc / 2 : idxToCol(from);
  return rcToIdx(legRow, legCol);
}
