/**
 * 棋谱层（§5.2 MoveRecord / §6.3 紧凑持久化 / FR12 复盘 / FR16 导出）。
 *
 * 职责边界：只做「着法记录」与「棋谱文本」的组装，不认识工具、不认识对局状态机。
 * 引擎一律以参数传入（`engine`），因此本模块可用 stub 独立测试。
 */

/** 把「局面 + 着法」组装成一条 §5.2 的 MoveRecord（同时写入中文记谱）。 */
export function makeRecord(engine, position, move, ms = 0, meta = {}) {
  const piece = position.board[move.from] ?? '';
  const captured = position.board[move.to] ?? '';
  const next = engine.applyMove(position, move);
  let iccs = '';
  let zh = '';
  try {
    iccs = engine.moveToIccs(move);
  } catch {
    iccs = '';
  }
  try {
    zh = engine.formatChinese(position, move);
  } catch {
    zh = '';
  }
  let check = false;
  try {
    check = engine.isInCheck(next, next.turn) === true;
  } catch {
    check = false;
  }
  return {
    move: { from: move.from, to: move.to },
    piece,
    captured,
    iccs,
    zh,
    fenBefore: safeFen(engine, position),
    fenAfter: safeFen(engine, next),
    check,
    mate: meta.mate === true,
    ms: Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0,
    side: position.turn,
  };
}

function safeFen(engine, position) {
  try {
    return engine.positionToFen(position);
  } catch {
    return '';
  }
}

/** §6.3 的紧凑形式：只存着法本身，局面由引擎重放得出。 */
export function toCompact(history) {
  return history.map((record) => ({
    i: record.iccs,
    f: record.move.from,
    t: record.move.to,
    c: record.captured,
    m: record.ms,
    s: record.side,
  }));
}

/**
 * 由紧凑形式重放出局面与完整记录。
 * @param {object} engine 引擎模块。
 * @param {string} initialFen 初始局面 FEN。
 * @param {Array<object>} compact 紧凑着法列表。
 * @returns {{ position: object, history: object[] }} 重放结果。
 */
export function fromCompact(engine, initialFen, compact) {
  const start = typeof initialFen === 'string' && initialFen !== '' ? initialFen : safeFen(engine, engine.initialPosition());
  let position = engine.positionFromFen(start);
  const history = [];
  for (const entry of Array.isArray(compact) ? compact : []) {
    if (entry === null || typeof entry !== 'object') continue;
    const move = { from: Number(entry.f), to: Number(entry.t) };
    if (!Number.isInteger(move.from) || !Number.isInteger(move.to)) continue;
    if (!engine.isLegalMove(position, move)) break;
    const record = makeRecord(engine, position, move, Number(entry.m) || 0);
    history.push(record);
    position = engine.applyMove(position, move);
  }
  return { position, history, initialFen: start };
}

/** 中文记谱序列：按回合成对排列，形如 `1. 炮二平五 马8进7`。 */
export function historyZh(history) {
  const lines = [];
  for (let index = 0; index < history.length; index += 2) {
    const first = history[index]?.zh ?? history[index]?.iccs ?? '';
    const second = history[index + 1]?.zh ?? history[index + 1]?.iccs ?? '';
    lines.push(`${Math.floor(index / 2) + 1}. ${first}${second === '' ? '' : ` ${second}`}`.trimEnd());
  }
  return lines;
}

/** 棋谱导出文本：中文记谱逐行 + 初始 FEN + 当前 FEN（§6.3「导出」）。 */
export function exportText(state) {
  return [
    '# 象棋对局（休闲规则）',
    `初始 FEN: ${state.initialFen}`,
    `当前 FEN: ${state.history.length > 0 ? state.history[state.history.length - 1].fenAfter : state.initialFen}`,
    `着法数: ${state.history.length}`,
    '',
    ...historyZh(state.history),
  ].join('\n');
}

const TURNING_THRESHOLD = 200;

/**
 * 复盘数据（FR12）：逐手评估曲线 + 转折点。
 * @param {object} state 对局状态。
 * @param {object} engine 引擎模块。
 * @param {'turning'|'all'} highlight 标记范围。
 * @returns {{ historyZh: string[], turningPoints: object[], evalCurve: object[], finalFen: string }}
 */
export function reviewData(state, engine, highlight = 'turning') {
  const evalCurve = [];
  const turningPoints = [];
  let before = opponentScore(engine, state.initialFen);
  for (let index = 0; index < state.history.length; index += 1) {
    const record = state.history[index];
    const after = opponentScore(engine, record.fenAfter);
    const delta = after - before;
    evalCurve.push({ ply: index + 1, score: after, delta });
    if (highlight === 'all' || Math.abs(delta) >= TURNING_THRESHOLD) {
      turningPoints.push({
        ply: index + 1,
        zh: record.zh,
        iccs: record.iccs,
        scoreBefore: before,
        scoreAfter: after,
        delta,
        captured: record.captured,
      });
    }
    before = after;
  }
  return {
    historyZh: historyZh(state.history),
    turningPoints,
    evalCurve,
    finalFen: state.history.length > 0 ? state.history[state.history.length - 1].fenAfter : state.initialFen,
  };
}

/** 以「红方视角」的子力差评估一个 FEN；引擎缺失时退化为 0。 */
function opponentScore(engine, fen) {
  if (typeof fen !== 'string' || fen === '') return 0;
  try {
    return engine.evaluate(engine.positionFromFen(fen)).score;
  } catch {
    return 0;
  }
}

/** 棋子字符 → 中文名（棋盘文本用；与 §5.1 的规范化字符一一对应）。 */
const PIECE_ZH = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
};

/** 棋子字符 → 中文名字；空位返回 `·`。 */
export function pieceName(piece) {
  return PIECE_ZH[piece] ?? '·';
}

/**
 * ASCII 棋盘（§5.6 的形状，自带红方文件号与楚河汉界）。
 * 由本插件自绘而不是复用 `describePosition`，这样工具的卡片正文在任何引擎实现下都稳定。
 */
export function asciiBoard(position, options = {}) {
  const coordinates = options.coordinates !== false;
  const lines = [];
  if (coordinates) lines.push('   九 八 七 六 五 四 三 二 一');
  for (let row = 0; row < 10; row += 1) {
    const cells = [];
    for (let col = 0; col < 9; col += 1) cells.push(position.board[row * 9 + col] === '' ? '.' : position.board[row * 9 + col]);
    const rank = String(9 - row).padStart(2, ' ');
    lines.push(coordinates ? `${rank} ${cells.join('  ')}` : cells.join(' '));
    if (row === 4) lines.push('   —— 楚 河     汉 界 ——');
  }
  if (coordinates) lines.push('   九 八 七 六 五 四 三 二 一');
  return lines.join('\n');
}

/** 一行状态摘要：阶段 / 轮次 / 将军 / 终局（仅在引擎不可用时作为兜底渲染）。 */
export function statusLine(state) {
  const sideZh = state.position.turn === 'r' ? '红方' : '黑方';
  const heroZh = state.hero === 'r' ? '红方' : '黑方';
  const phase = state.phase === 'finished' ? '已结束' : state.phase === 'idle' ? '新对局' : '进行中';
  const pending = state.pending === 'ai-thinking' ? '（AI 思考中…）' : state.pending === 'ai-failed' ? '（AI 上次失败）' : '';
  const status = state.status?.state === 'playing' ? `${sideZh}行棋` : state.status?.reasonZh ?? '';
  return `第 ${state.history.length + 1} 手 | 你执${heroZh} | ${phase} | 轮到${sideZh}${pending} | ${status}`;
}

/** 合法着法目录的截断上限（§5.6：超过 80 条时截断并注明）。 */
export const CATALOG_LIMIT = 80;

/**
 * 工具卡片正文与 AI 数据包的**唯一**棋盘渲染入口。
 *
 * §5.6 要求的全部要素都由引擎的 `describePosition` 提供（局面标题、双标棋盘、
 * FEN、上一手、状态、评估、合法着法目录）——**不再自绘第二套棋盘**，避免同一局面
 * 在不同入口长得不一样。只有引擎不可用时才退回本地兜底渲染。
 *
 * @param {object} state 对局状态。
 * @param {object} engine 引擎模块（可为 undefined，此时走兜底）。
 * @param {object} options `{ includeMoves?, includeEval?, ascii? }`。
 * @returns {string} 单个字符串（含换行），供 `output.render` 塞进一个 text 块。
 */
export function boardText(state, engine, options = {}) {
  const includeMoves = options.includeMoves !== false;
  const includeEval = options.includeEval === true;
  const last = state.history.length > 0 ? state.history[state.history.length - 1] : null;
  const described = tryDescribe(engine, state, { includeMoves, includeEval, last });
  const lines = [];
  if (described !== null) lines.push(described);
  else lines.push(...fallbackSections(state, engine, { includeMoves, includeEval }));
  const notation = historyZh(state.history);
  lines.push('');
  lines.push(notation.length === 0 ? '棋谱：（空）' : `棋谱：\n${notation.map((line) => `  ${line}`).join('\n')}`);
  if (state.status?.state !== 'playing' && typeof state.status?.reasonZh === 'string') lines.push(`结果：${state.status.reasonZh}`);
  if (state.message?.code !== undefined) lines.push(`提示：${state.message.code}`);
  return lines.join('\n');
}

/** 调引擎的 `describePosition`；任何异常都降级为兜底渲染。 */
function tryDescribe(engine, state, { includeMoves, includeEval, last }) {
  if (engine === null || engine === undefined || typeof engine.describePosition !== 'function') return null;
  try {
    const text = engine.describePosition(state.position, {
      includeMoves,
      includeEval,
      ascii: true,
      maxMoves: CATALOG_LIMIT,
      lastMove: last === null ? undefined : { from: last.move.from, to: last.move.to, iccs: last.iccs, zh: last.zh },
      history: state.history.map((record) => record.iccs),
    });
    return typeof text === 'string' && text.trim() !== '' ? text : null;
  } catch {
    return null;
  }
}

/** 引擎不可用时的兜底：状态行 + 自绘棋盘 + FEN + 目录 + 评估。 */
function fallbackSections(state, engine, { includeMoves, includeEval }) {
  const lines = [statusLine(state), '', asciiBoard(state.position)];
  const fen = safeText(() => engine.positionToFen(state.position));
  if (fen !== null) lines.push('', `FEN: ${fen}`);
  if (includeEval) {
    const summary = safeText(() => engine.evaluate(state.position).summaryZh);
    if (summary !== null) lines.push(`评估：${summary}`);
  }
  if (includeMoves) {
    const catalog = safeList(() => engine.legalMoveCatalog(state.position));
    lines.push('', `合法着法（${catalog.length} 个，ICCS / 中文）：`);
    lines.push(catalog.slice(0, CATALOG_LIMIT).map((entry) => `${entry.iccs} ${entry.zh}`).join(' | '));
    if (catalog.length > CATALOG_LIMIT) lines.push(`（已截断，仅列前 ${CATALOG_LIMIT} 条）`);
  }
  return lines;
}

function safeText(read) {
  try {
    const value = read();
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  }
}

function safeList(read) {
  try {
    const value = read();
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
