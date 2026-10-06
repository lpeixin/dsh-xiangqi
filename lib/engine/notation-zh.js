/**
 * 中文记谱的生成与解析（§5.5）。
 *
 * 三条贯穿本文件的取舍：
 *
 * 1. **生成与解析共用同一套「结构化分解」**（`zhMoveParts`）。若两边各写一遍
 *    方向/文件号/消歧逻辑，就一定会出现「生成出来解析不回去」的漂移。
 * 2. **解析只在 `generateMoves(pos)` 的合法着法集合里匹配唯一解**（§5.5）。
 *    0 个或多于 1 个都返回 error，歧义附带候选——绝不静默任选，
 *    否则「记谱解析」会变成一条绕过规则的暗路。
 * 3. 解析对**写法**宽容（红黑数字体系、前/中/后 与 一二三四五 互认），
 *    但对**位置**严格：前缀只在同列同名子 ≥2 时才有意义。
 */

import { RED_SIDE, colorOfPiece, idxToRow, idxToCol, colToFileNumber, fileNumberText, countText, zhDigitValue, pieceNameZh, squareToIccs, iccsToSquare } from './coords.js';

import { isValidPosition } from './fen.js';
import { generateMoves } from './moves.js';
import { moveRejectCode, moveRejectReason } from './rules.js';

/** 中文棋子字 → 大写规范字符。马/车/炮 的最终大小写由走子方决定。 */
const ZH_CHAR_TO_UPPER = { 帅: 'K', 仕: 'A', 相: 'B', 马: 'N', 车: 'R', 炮: 'C', 兵: 'P', 将: 'K', 士: 'A', 象: 'B', 卒: 'P' };

/** 只能属于红方的中文字（写出「将」却轮到红方走，是记谱错误而非歧义）。 */
const ZH_RED_ONLY = new Set(['帅', '仕', '相', '兵']);
const ZH_BLACK_ONLY = new Set(['将', '士', '象', '卒']);
const ZH_PIECE_CHARS = '帅仕相马车炮兵将士象马车炮卒KABNRCPkabnrcp';

/** 序号前缀：一/二/三/四/五（红）与 1–5（黑），双方解析时都接受。 */
const NUMBERED_PREFIXES = ['一', '二', '三', '四', '五'];

/** 着法 → ICCS（纯坐标换算，不需要局面）。 */
export function moveToIccs(move) {
  if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to)) return '';
  const from = squareToIccs(move.from);
  const to = squareToIccs(move.to);
  return from && to ? `${from}${to}` : '';
}

/**
 * ICCS → 着法。**按合法性校验**：只有当这串坐标正好是 `pos` 的一个合法着法时
 * 才返回它，否则返回 null。理由：签名里带 `pos`，且 Move|null 若只做纯坐标
 * 解析，非法着法会一路漏到 `applyMove`（它按契约不做校验）。
 * 需要「为什么非法」时用 `parseAnyMove` / `moveRejectReason`。
 */
export function iccsToMove(pos, iccs) {
  if (!isValidPosition(pos)) return null;
  const text = typeof iccs === 'string' ? normalizeIccsText(iccs) : '';
  if (text.length !== 4) return null;
  const from = iccsToSquare(text.slice(0, 2));
  const to = iccsToSquare(text.slice(2));
  if (from < 0 || to < 0) return null;
  const move = { from, to };
  return moveRejectCode(pos, move) === null ? move : null;
}

/** 同列同名子的「从前到后」序号：0 = 最靠近对方底线。 */
function zhSameColumnGroup(board, piece, col, side) {
  const group = [];
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] === piece && idxToCol(i) === col) group.push(i);
  }
  group.sort((a, b) => (side === RED_SIDE ? idxToRow(a) - idxToRow(b) : idxToRow(b) - idxToRow(a)));
  return group;
}

/** 消歧前缀：两个用前/后，三个兵用前/中/后，其余按序号。 */
function zhDisambigLabel(upper, count, index, side) {
  if (count === 2) return index === 0 ? '前' : '后';
  if (count === 3 && upper === 'P') return ['前', '中', '后'][index];
  const numeral = side === RED_SIDE ? NUMBERED_PREFIXES[index] : String(index + 1);
  return numeral ?? String(index + 1);
}

/**
 * 把一手棋分解成记谱字段。生成与解析共用；无法分解（起点无子/坐标非法）返回 null。
 * `fromFileNumber` 即使在需要消歧时也照常给出，解析才能按文件号匹配。
 */
export function zhMoveParts(pos, move) {
  if (!isValidPosition(pos) || !move) return null;
  const { from, to } = move;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || from > 89 || to < 0 || to > 89) return null;
  const piece = pos.board[from];
  if (piece === '') return null;
  const side = colorOfPiece(piece);
  const upper = piece.toUpperCase();
  const fromRow = idxToRow(from);
  const fromCol = idxToCol(from);
  const toRow = idxToRow(to);
  const toCol = idxToCol(to);

  let action;
  let targetText;
  if (toRow === fromRow) {
    action = '平';
    targetText = fileNumberText(colToFileNumber(toCol, side), side);
  } else {
    const forward = side === RED_SIDE ? -1 : 1;
    action = (toRow - fromRow) * forward > 0 ? '进' : '退';
    // 斜行子（马/相/仕）的进退取目标文件号；直行子取步数。
    const diagonal = upper === 'N' || upper === 'B' || upper === 'A';
    targetText = diagonal
      ? fileNumberText(colToFileNumber(toCol, side), side)
      : countText(Math.abs(toRow - fromRow), side);
  }

  const group = zhSameColumnGroup(pos.board, piece, fromCol, side);
  const disambigCount = group.length;
  const disambigIndex = group.indexOf(from);
  let prefix = '';
  let fileText = '';
  if (disambigCount >= 2) {
    prefix = zhDisambigLabel(upper, disambigCount, disambigIndex, side);
  } else {
    fileText = fileNumberText(colToFileNumber(fromCol, side), side);
  }
  return {
    piece,
    upper,
    side,
    pieceName: pieceNameZh(piece),
    pieceChar: upper,
    action,
    targetText,
    prefix,
    fileText,
    fromFileNumber: colToFileNumber(fromCol, side),
    disambigCount,
    disambigIndex,
    text: `${prefix}${pieceNameZh(piece)}${fileText}${action}${targetText}`,
  };
}

/** 生成中文记谱。起点无子或坐标非法时返回 ''（不抛异常）。 */
export function formatChinese(pos, move) {
  const parts = zhMoveParts(pos, move);
  return parts ? parts.text : '';
}

/** 记谱文本 → 数字：中文数字与阿拉伯数字都接受；无法识别返回 0。 */
export function parseZhDigit(text) {
  if (!text) return 0;
  if (text >= '1' && text <= '9') return Number(text);
  return zhDigitValue(text);
}

/** 全角字母/数字 → 半角（模型与手输都常带全角）。 */
function toHalfWidth(text) {
  return text.replace(/[ａ-ｚＡ-Ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 归一化 ICCS：去空白与分隔符、全角转半角、转小写。 */
function normalizeIccsText(text) {
  return toHalfWidth(String(text)).replace(/[\s　]/g, '').replace(/[-–—>→()（）「」]/g, '').toLowerCase();
}

/** 归一化输入：去空白与标点、去将军标记、全角转半角。 */
function normalizeZhInput(text) {
  return toHalfWidth(String(text))
    .replace(/[\s　]/g, '')
    .replace(/[，,。；;！!？?、（）()「」【】]/g, '')
    .replace(/[＋+＃#＊*]/g, '');
}

const ZH_PARSE_RE = new RegExp(
  `^(前|后|中|[一二三四五1-5])?([${ZH_PIECE_CHARS}])([一二三四五六七八九1-9])?(进|退|平)([一二三四五六七八九1-9])$`,
);

/** 前缀是否指向该候选着法的消歧序号。 */
function zhPrefixMatches(prefix, parts) {
  if (parts.disambigCount < 2) return false;
  if (prefix === '前') return parts.disambigIndex === 0;
  if (prefix === '后') return parts.disambigIndex === parts.disambigCount - 1;
  if (prefix === '中') return parts.disambigCount === 3 && parts.disambigIndex === 1;
  const index = parseZhDigit(prefix);
  return index >= 1 && index <= parts.disambigCount && parts.disambigIndex === index - 1;
}

/** 中文棋子字 → 规范棋子字符；与走子方矛盾时返回 null。 */
function zhCharToPiece(ch, turn) {
  const isRedTurn = turn === RED_SIDE;
  if (ch >= 'A' && ch <= 'Z') return isRedTurn ? ch : null;
  if (ch >= 'a' && ch <= 'z') return isRedTurn ? null : ch;
  const upper = ZH_CHAR_TO_UPPER[ch];
  if (!upper) return null;
  if (ZH_RED_ONLY.has(ch)) return isRedTurn ? upper : null;
  if (ZH_BLACK_ONLY.has(ch)) return isRedTurn ? null : upper.toLowerCase();
  return isRedTurn ? upper : upper.toLowerCase();
}

/**
 * 中文记谱 → 着法。只在合法着法集合里匹配唯一解：
 * 0 个返回 `{ error }`，多于 1 个返回 `{ error, candidates }`。
 */
export function parseChinese(pos, text) {
  if (!isValidPosition(pos)) return { error: '局面数据非法' };
  const cleaned = normalizeZhInput(text);
  if (cleaned === '') return { error: '没有给出着法' };
  const matched = ZH_PARSE_RE.exec(cleaned);
  if (!matched) {
    return { error: `无法识别的中文记谱：「${text}」（形如 炮二平五 / 马8进7 / 前车进三）` };
  }
  const [, prefix, pieceChar, fileText, action, targetText] = matched;
  const piece = zhCharToPiece(pieceChar, pos.turn);
  if (!piece) {
    return { error: `「${pieceChar}」不是${pos.turn === RED_SIDE ? '红方' : '黑方'}的棋子（现在轮到${pos.turn === RED_SIDE ? '红方' : '黑方'}走子）` };
  }
  const fileNumber = fileText ? parseZhDigit(fileText) : 0;
  const targetValue = parseZhDigit(targetText);
  if (targetValue === 0) return { error: `无法识别的数字：「${targetText}」` };
  if (fileText && fileNumber === 0) return { error: `无法识别的文件号：「${fileText}」` };

  const candidates = [];
  for (const move of generateMoves(pos)) {
    const parts = zhMoveParts(pos, move);
    if (!parts || parts.piece !== piece) continue;
    if (parts.action !== action) continue;
    if (parseZhDigit(parts.targetText) !== targetValue) continue;
    if (prefix) {
      if (!zhPrefixMatches(prefix, parts)) continue;
    } else if (fileText) {
      if (parts.fromFileNumber !== fileNumber) continue;
    }
    candidates.push({ move, text: parts.text });
  }

  if (candidates.length === 1) return { move: candidates[0].move };
  if (candidates.length === 0) {
    return { error: `没有匹配的合法着法：「${cleaned}」（该写法在本局面下不合法，或与合法着法集合不符）` };
  }
  return {
    error: `中文记谱有歧义：「${cleaned}」可对应 ${candidates.length} 个合法着法，请写出消歧前缀或改用 ICCS`,
    candidates: candidates.map((c) => `${moveToIccs(c.move)} ${c.text}`),
  };
}

/**
 * 自动识别 ICCS 或中文记谱（§5.3）。容错处理分隔符与全角字符，
 * 非法时返回结构化的 `{ error }`，绝不抛异常。
 */
export function parseAnyMove(pos, text) {
  if (!isValidPosition(pos)) return { error: '局面数据非法' };
  if (typeof text !== 'string' || text.trim() === '') return { error: '没有给出着法' };
  const raw = text.trim();
  const iccs = normalizeIccsText(raw);
  if (/^[a-i][0-9][a-i][0-9]$/.test(iccs)) {
    const move = iccsToMove(pos, iccs);
    if (move) return { move };
    // 上面的正则已经保证列 a–i、行 0–9，映射出来的索引必然在盘上。
    const from = iccsToSquare(iccs.slice(0, 2));
    const to = iccsToSquare(iccs.slice(2));
    return { error: moveRejectReason(pos, { from, to }) ?? `着法不在合法着法集合里：「${raw}」` };
  }
  return parseChinese(pos, raw);
}
