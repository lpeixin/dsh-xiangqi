/**
 * 对 AI 友好的局面描述（§5.6，FR 差异点 3）。
 *
 * 格式必须**逐字符稳定**：模型靠它对齐「棋盘图 / FEN / 上一手 / 状态 / 评估 /
 * 合法着法目录」六段，任何一段忽有忽无都会让模型开始猜。因此：
 *
 * 1. 六段**永远都在**（由 `DescribeOptions` 显式关掉的除外），缺数据时打印占位符
 *    而不是省略整行；
 * 2. 合法着法目录默认包含，超过 `maxMoves` 时按「吃子 > 将军 > 其它」截断并注明，
 *    避免把上下文塞爆（§5.6）；
 * 3. 上一手必须由调用方传入（引擎不持有历史，§5.2）。传 `MoveRecord` 最完整；
 *    只传 `Move` 时只能给出 ICCS——中文记谱需要**走子前**的局面才能消歧（§5.2），
 *    事后无法可靠重建，所以这里不猜。
 */

import { BOARD_ROWS, BOARD_COLS, colorOfPiece, sideNameZh, colToFileNumber, fileNumberText } from './coords.js';
import { isValidPosition, positionToFen } from './fen.js';
import { generateMoves, applyMove } from './moves.js';
import { gameStatus, isInCheck } from './rules.js';
import { formatChinese, moveToIccs } from './notation-zh.js';
import { evaluate } from './eval.js';

const RIVER_LINE = '  —— 楚 河     汉 界 ——';

/**
 * ASCII 棋盘（含中文文件号表头与楚河汉界）。行号从黑方底线起 1..10。
 * 棋子字符与 FEN 同源：`P`/`p`、`N`/`n` 只差大小写，因此调用方必须同时给出
 * 图例行（见 `BOARD_LEGEND`），否则模型很容易把红兵看成黑卒。
 */
export function renderAsciiBoard(board) {
  const lines = [`  ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((col) => fileNumberText(colToFileNumber(col, 'r'), 'r')).join(' ')}`];
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    const cells = [];
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const piece = board[row * BOARD_COLS + col];
      cells.push(piece === '' ? '.' : piece);
    }
    lines.push(`${String(row + 1).padStart(2, ' ')} ${cells.join('  ')}`);
    if (row === 4) lines.push(RIVER_LINE);
  }
  return lines;
}

/** 棋盘图例。与 FEN 同源的字母约定必须显式说明，否则大小写极易看反。 */
export const BOARD_LEGEND = '图例：大写=红方，小写=黑方，. 为空；字母约定与下方 FEN 一致';

/** 上一手：接受 MoveRecord 形状、Move 或字符串；缺数据时给占位符。 */
function renderLastMove(lastMove) {
  if (lastMove === undefined || lastMove === null) return '（未提供）';
  if (typeof lastMove === 'string') return lastMove === '' ? '（未提供）' : lastMove;
  if (typeof lastMove !== 'object') return '（未提供）';
  const iccs = typeof lastMove.iccs === 'string' && lastMove.iccs !== '' ? lastMove.iccs : moveToIccs(lastMove);
  const color = lastMove.color === 'r' || lastMove.color === 'b'
    ? lastMove.color
    : colorOfPiece(lastMove.piece ?? '');
  const head = color ? `${sideNameZh(color)} ` : '';
  const zh = typeof lastMove.zh === 'string' && lastMove.zh !== '' ? lastMove.zh : '';
  const notation = zh && iccs ? `${zh}（${iccs}）` : zh || iccs;
  if (!notation) return '（未提供）';
  let tail = '';
  if (lastMove.mate === true) tail = '，将死';
  else if (lastMove.check === true) tail = '，将军';
  else if (lastMove.check === false) tail = '，未将军';
  return `${head}${notation}${tail}`;
}

/** 状态行：理由直接取 gameStatus（它已经带上了应将着法数等细节）。 */
function renderStatusLine(pos, history) {
  const status = gameStatus(pos, history);
  if (status.state === 'playing' || status.state === 'check') {
    return status.reasonZh;
  }
  return `${status.reasonZh}（${status.state}）`;
}

/** 着法目录条目（含 describe 内部排序需要的将军标记）。 */
function describeCatalogEntries(pos) {
  const entries = [];
  for (const move of generateMoves(pos)) {
    const next = applyMove(pos, move);
    entries.push({
      move,
      iccs: moveToIccs(move),
      zh: formatChinese(pos, move),
      capture: pos.board[move.to],
      check: isInCheck(next, next.turn),
    });
  }
  return entries;
}

/** 合法着法目录（§5.3 的精确形状：只含 iccs / zh / capture）。 */
export function legalMoveCatalog(pos) {
  if (!isValidPosition(pos)) return [];
  return describeCatalogEntries(pos).map((entry) => ({ iccs: entry.iccs, zh: entry.zh, capture: entry.capture }));
}

/** 截断优先级：吃子 > 将军 > 其它（同类内保持生成顺序，结果稳定）。 */
function describePriority(entry) {
  if (entry.capture !== '') return 0;
  if (entry.check) return 1;
  return 2;
}

/** 目录正文：按优先级截断，并按每行 6 个折行（模型与人都好读）。 */
function renderCatalog(entries, maxMoves) {
  let selected = entries;
  let note = '';
  if (entries.length > maxMoves) {
    selected = entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => describePriority(a.entry) - describePriority(b.entry) || a.index - b.index)
      .slice(0, maxMoves)
      .map((item) => item.entry);
    note = `（共 ${entries.length} 个，已按「吃子 > 将军 > 其它」截断到 ${maxMoves} 个）`;
  }
  const lines = [];
  for (let i = 0; i < selected.length; i += 6) {
    const chunk = selected.slice(i, i + 6).map((entry) => `${entry.iccs} ${entry.zh}`);
    lines.push(`  ${chunk.join(' | ')}`);
  }
  if (lines.length === 0) lines.push('  （无合法着法）');
  if (note) lines.push(`  ${note}`);
  return lines;
}

/**
 * 局面描述（§5.6）。`DescribeOptions` 控制详略：
 * `{ includeMoves?, includeEval?, ascii?, maxMoves?, lastMove?, history? }`。
 * `lastMove` 与 `history` 是 §5.6 示例里「上一手」一行的必要输入（引擎不持有历史）。
 */
export function describePosition(pos, opts = {}) {
  if (!isValidPosition(pos)) return '局面数据非法，无法描述';
  const includeMoves = opts.includeMoves !== false;
  const includeEval = opts.includeEval !== false;
  const withAscii = opts.ascii !== false;
  const maxMoves = Number.isInteger(opts.maxMoves) && opts.maxMoves > 0 ? opts.maxMoves : 80;

  const lines = [`局面（第 ${pos.fullmove} 回合，${sideNameZh(pos.turn)}走子）`];
  if (withAscii) lines.push(...renderAsciiBoard(pos.board), BOARD_LEGEND);
  lines.push(`FEN: ${positionToFen(pos)}`);
  lines.push(`上一手：${renderLastMove(opts.lastMove)}`);
  lines.push(`状态：${renderStatusLine(pos, opts.history)}`);
  if (includeEval) lines.push(`评估：${evaluate(pos).summaryZh}`);
  if (includeMoves) {
    const entries = describeCatalogEntries(pos);
    lines.push(`合法着法（${entries.length} 个，ICCS / 中文）：`);
    lines.push(...renderCatalog(entries, maxMoves));
  }
  return lines.join('\n');
}
