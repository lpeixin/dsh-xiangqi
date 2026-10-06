/**
 * 工具返回值的渲染与「无损 JSON」清洗（§6.2 七条实现注意的第 1、2 条）。
 *
 * 1. `ctx.tools.register` 只校验 `output.schema`，且返回值必须是**无损 JSON**——
 *    `undefined` / `NaN` / `-0` / `Date` / `Map` / 循环引用都会导致 `INVALID_TOOL_OUTPUT`。
 *    因此所有工具出口统一走 `clean()`；**要省略的键就整个不写**。
 * 2. 卡片正文只能来自 `output.render`，且内置客户端偏好**单个** text 块，
 *    所以棋盘与记谱都塞进一个 `{ type: 'text', text }` 块里。
 */

const MAX_TEXT = 8000;

/**
 * 深度清洗成无损 JSON 值。
 * @param {unknown} value 任意值。
 * @returns {unknown} 只含 null/boolean/有限数字/字符串/数组/纯对象的副本。
 */
export function clean(value) {
  return sanitize(value, 0, new WeakSet());
}

function sanitize(value, depth, seen) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  if (type === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : 0;
  if (type === 'boolean') return value;
  if (type === 'bigint') return Number(value);
  if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined;
  if (depth > 12) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) {
        const cleaned = sanitize(item, depth + 1, seen);
        out.push(cleaned === undefined ? null : cleaned);
      }
      return out;
    }
    if (value instanceof Date) return value.toISOString();
    const out = {};
    for (const key of Object.keys(value)) {
      const cleaned = sanitize(value[key], depth + 1, seen);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** 单个 text 内容块。 */
export function textBlock(text) {
  return [{ type: 'text', text: typeof text === 'string' ? text : String(text ?? '') }];
}

/**
 * 卡片正文（§6.2 第 2 条：只返回**一个** text 块）。
 *
 * 正文以 `value.boardText` 为骨架（由引擎的 `describePosition` 生成，已含状态行、
 * 双标棋盘、FEN、上一手、合法着法目录与评估），再**兜底补齐**结构化字段：
 * 即使某个渲染器漏掉了目录/评估，模型也一定能看到它们——`render` 是模型唯一的窗口。
 */
export function renderBoard(value) {
  const sections = [boardOf(value)];
  const text = sections[0];
  const appendix = [];
  if (typeof value?.evalSummaryZh === 'string' && value.evalSummaryZh !== '' && !text.includes(value.evalSummaryZh)) {
    appendix.push(`评估：${value.evalSummaryZh}`);
  }
  if (Array.isArray(value?.legalMoves) && value.legalMoves.length > 0 && !/合法着法/.test(text)) {
    appendix.push(`合法着法（${value.legalMoves.length} 个）：${catalogLine(value.legalMoves)}`);
  }
  if (Array.isArray(value?.candidates) && value.candidates.length > 0) {
    appendix.push(`候选着法（本地引擎）：${value.candidates.map(candidateLine).join(' | ')}`);
  }
  if (Array.isArray(value?.turningPoints) && value.turningPoints.length > 0) {
    appendix.push(`转折点：${value.turningPoints.map((point) => (typeof point === 'number' ? `第 ${point} 手` : `第 ${point.ply} 手 ${point.zh ?? ''}`)).join('、')}`);
  }
  if (appendix.length > 0) sections.push('', ...appendix);
  return textBlock(sections.join('\n'));
}

function boardOf(value) {
  if (value !== null && typeof value === 'object' && typeof value.boardText === 'string' && value.boardText !== '') return value.boardText;
  const fen = value !== null && typeof value === 'object' && typeof value.fen === 'string' ? value.fen : '(无局面)';
  return `象棋局面\nFEN: ${fen}`;
}

/** 目录单行化：超过 80 条按 §5.6 截断并注明。 */
function catalogLine(moves) {
  const shown = moves.slice(0, 80).map((entry) => `${entry.iccs} ${entry.zh}`.trim());
  const suffix = moves.length > 80 ? ` …（共 ${moves.length} 条，已截断）` : '';
  return `${shown.join(' | ')}${suffix}`;
}

function candidateLine(candidate) {
  if (candidate === null || typeof candidate !== 'object') return '';
  const score = Number.isFinite(candidate.score) ? `（${candidate.score >= 0 ? '+' : ''}${candidate.score}）` : '';
  return `${candidate.iccs} ${candidate.zh}${score}`.trim();
}

/** 失败返回的卡片正文。 */
export function renderFailure(value) {
  const reason = value !== null && typeof value === 'object' && typeof value.errorZh === 'string' ? value.errorZh : '操作失败';
  const code = value !== null && typeof value === 'object' && typeof value.error === 'string' ? value.error : 'ERROR';
  const lines = [`无法完成：${reason}（${code}）`];
  const legal = value !== null && typeof value === 'object' ? value.legalMoves : undefined;
  if (Array.isArray(legal) && legal.length > 0) {
    lines.push('合法着法：');
    lines.push(legal.map((entry) => `${entry.iccs} ${entry.zh}`).join(' | '));
  }
  return textBlock(lines.join('\n'));
}

/** `presentationMeta`：为 P1 的自定义棋盘卡片预留结构化数据（§6.2 第 3 条）。 */
export function boardMeta(value) {
  if (value === null || typeof value !== 'object') return { fen: '', ply: 0 };
  const status = value.status !== null && typeof value.status === 'object' ? value.status.state : undefined;
  const last = value.lastMove;
  const meta = {
    fen: typeof value.fen === 'string' ? value.fen : '',
    side: typeof value.turn === 'string' ? value.turn : '',
    ply: typeof value.revision === 'number' ? value.revision : 0,
    status: typeof status === 'string' ? status : '',
    notation: typeof value.played === 'object' && value.played !== null && typeof value.played.zh === 'string' ? value.played.zh : '',
  };
  if (last !== null && typeof last === 'object') {
    if (typeof last.from === 'number') meta.from = last.from;
    if (typeof last.to === 'number') meta.to = last.to;
    if (typeof last.iccs === 'string') meta.iccs = last.iccs;
    if (typeof last.zh === 'string' && meta.notation === '') meta.notation = last.zh;
  }
  if (typeof value.captured === 'string' && value.captured !== '') meta.captured = value.captured;
  return clean(meta);
}
