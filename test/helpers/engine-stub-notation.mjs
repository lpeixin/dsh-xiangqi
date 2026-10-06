/**
 * 引擎 stub 的**记谱 / 描述 / 评估 / 搜索**部分（仅测试用；**不得**放进 lib/）。
 * 依赖 `engine-stub-core.mjs` 的局面与着法生成。
 */

import {
  PIECE_NAMES_ZH,
  applyMove,
  gameStatus,
  generateMoves,
  iccsToMove,
  moveToIccs,
  positionToFen,
} from './engine-stub-core.mjs';

const RED_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const VALUES = { R: 900, r: 900, C: 450, c: 450, N: 400, n: 400, B: 200, b: 200, A: 200, a: 200, P: 100, p: 100, K: 0, k: 0 };
const STRAIGHT = new Set(['R', 'C', 'P', 'K', 'r', 'c', 'p', 'k']);
const rowOf = (index) => Math.floor(index / 9);
const colOf = (index) => index % 9;
const sideOf = (piece) => (piece === '' ? null : piece === piece.toUpperCase() ? 'r' : 'b');

function fileNumber(col, side) {
  if (side === 'r') return RED_DIGITS[8 - col];
  return String(col + 1);
}

function numeral(value, side) {
  if (side === 'r') return RED_DIGITS[value - 1];
  return String(value);
}

export function formatChinese(pos, move) {
  const piece = pos.board[move.from];
  const side = sideOf(piece);
  const name = PIECE_NAMES_ZH[piece];
  const fromRow = rowOf(move.from);
  const toRow = rowOf(move.to);
  const fromCol = colOf(move.from);
  const toCol = colOf(move.to);
  const sameType = [];
  for (let i = 0; i < 90; i += 1) if (pos.board[i] === piece) sameType.push(i);
  const sameFile = sameType.filter((i) => colOf(i) === fromCol).sort((a, b) => (side === 'r' ? rowOf(a) - rowOf(b) : rowOf(b) - rowOf(a)));
  let prefix;
  if (sameType.length > 1 && sameFile.length > 1) {
    const rank = sameFile.indexOf(move.from);
    if (sameFile.length === 2) prefix = rank === 0 ? '前' : '后';
    else if (sameFile.length === 3) prefix = ['前', '中', '后'][rank];
    else prefix = numeral(rank + 1, 'r');
    prefix += name;
  } else {
    prefix = name + fileNumber(fromCol, side);
  }
  let action;
  let target;
  if (fromRow === toRow) {
    action = '平';
    target = fileNumber(toCol, side);
  } else {
    const forward = side === 'r' ? toRow < fromRow : toRow > fromRow;
    action = forward ? '进' : '退';
    target = STRAIGHT.has(piece) ? numeral(Math.abs(toRow - fromRow), side) : fileNumber(toCol, side);
  }
  return `${prefix}${action}${target}`;
}

function normalize(text) {
  return String(text).replace(/\s+/g, '').replace(/[炮砲]/g, '炮');
}

export function parseChinese(pos, text) {
  const wanted = normalize(text);
  if (wanted === '') return { error: '着法为空' };
  const hits = generateMoves(pos).filter((move) => normalize(formatChinese(pos, move)) === wanted);
  if (hits.length === 1) return { move: hits[0] };
  if (hits.length === 0) return { error: `无法解析着法「${text}」` };
  return { error: `着法「${text}」有歧义` };
}

export function parseAnyMove(pos, text) {
  const raw = String(text ?? '').trim();
  const iccs = /^[a-i]\d[a-i]\d$/i.exec(raw);
  if (iccs !== null) {
    const move = iccsToMove(pos, raw);
    if (move === null) return { error: `无法解析 ICCS 着法「${raw}」` };
    return { move };
  }
  return parseChinese(pos, raw);
}

export function legalMoveCatalog(pos) {
  return generateMoves(pos).map((move) => ({
    iccs: moveToIccs(move),
    zh: formatChinese(pos, move),
    capture: pos.board[move.to],
  }));
}

export function evaluate(pos) {
  let score = 0;
  const breakdown = [];
  for (const piece of pos.board) {
    if (piece === '') continue;
    const value = VALUES[piece] ?? 0;
    score += sideOf(piece) === 'r' ? value : -value;
  }
  breakdown.push({ term: 'material', score });
  const summaryZh = score === 0 ? '双方子力相当' : score > 0 ? `红方净多 ${score}` : `黑方净多 ${-score}`;
  return { score, breakdown, summaryZh };
}

export function describePosition(pos, opts = {}) {
  const { includeMoves = true, includeEval = false, ascii = true, maxMoves = 80, lastMove, history } = opts;
  const lines = [];
  lines.push(`局面（第 ${pos.fullmove} 回合，${pos.turn === 'r' ? '红方' : '黑方'}走子）`);
  if (ascii) {
    lines.push('  九 八 七 六 五 四 三 二 一');
    for (let row = 0; row < 10; row += 1) {
      const cells = [];
      for (let col = 0; col < 9; col += 1) {
        const piece = pos.board[row * 9 + col];
        cells.push(piece === '' ? '.' : piece);
      }
      lines.push(`${row + 1 < 10 ? ' ' : ''}${9 - row} ${cells.join('  ')}`);
      if (row === 4) lines.push('  —— 楚 河     汉 界 ——');
    }
  }
  lines.push(`FEN: ${positionToFen(pos)}`);
  if (lastMove && typeof lastMove === 'object') lines.push(`上一手：${lastMove.zh ?? ''}（${lastMove.iccs ?? ''}）`);
  if (Array.isArray(history) && history.length > 0) lines.push(`着法数：${history.length}`);
  lines.push(`状态：${gameStatus(pos).reasonZh}`);
  if (includeEval) lines.push(`评估：${evaluate(pos).summaryZh}`);
  if (includeMoves) {
    const catalog = legalMoveCatalog(pos);
    lines.push(`合法着法（${catalog.length} 个，ICCS / 中文）：`);
    lines.push(catalog.slice(0, maxMoves).map((entry) => `${entry.iccs} ${entry.zh}`).join(' | '));
  }
  return lines.join('\n');
}

export function searchBestMove(pos, opts = {}) {
  const { seed = 1 } = opts;
  const moves = generateMoves(pos);
  if (moves.length === 0) throw new Error('没有合法着法可选');
  const scored = moves.map((move) => ({ move, score: VALUES[pos.board[move.to]] ?? 0 }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  const top = scored.filter((entry) => entry.score === best);
  const index = Math.abs(Math.trunc(seed)) % top.length;
  const chosen = top[index];
  return { move: chosen.move, score: chosen.score, depth: 1, nodes: moves.length, pv: [moveToIccs(chosen.move)] };
}
