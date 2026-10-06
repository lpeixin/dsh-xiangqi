/**
 * 对局状态机（§6.3）：纯数据 + 纯转移函数。
 *
 * 本模块不认识工具、不认识持久化、不认识模型；引擎以参数传入。
 * 所有转移函数都返回**新对象**，并让 `revision` 单调递增，供 UI 判新旧（§7.5.4）。
 */

import { addMs, createClock } from './clock.js';
import { fromCompact, makeRecord } from './records.js';

/** pending 状态机的三个取值（§6.3）。 */
export const PENDING = Object.freeze({ IDLE: null, THINKING: 'ai-thinking', FAILED: 'ai-failed' });

const PLAYING_STATUS = Object.freeze({
  state: 'playing',
  winner: null,
  reason: 'playing',
  reasonZh: '对局进行中',
});

/** 归一化引擎返回的 GameStatus，保证形状稳定。 */
export function normalizeStatus(status) {
  if (status === null || typeof status !== 'object') return { ...PLAYING_STATUS };
  const state = typeof status.state === 'string' ? status.state : 'playing';
  const winner = status.winner === 'r' || status.winner === 'b' ? status.winner : null;
  return {
    state,
    winner,
    reason: typeof status.reason === 'string' ? status.reason : state,
    reasonZh: typeof status.reasonZh === 'string' ? status.reasonZh : PLAYING_STATUS.reasonZh,
  };
}

/** 终局状态集合。 */
export const TERMINAL_STATES = Object.freeze([
  'checkmate',
  'stalemate',
  'draw-repetition',
  'draw-fifty',
  'draw-perpetual-check',
  'resigned',
  'max-plies',
]);

/** 依据局面与历史算出对局状态，并叠加本插件的规则配置。 */
export function computeStatus(engine, position, fens, config, history) {
  let status;
  try {
    status = normalizeStatus(engine.gameStatus(position, fens));
  } catch {
    status = { ...PLAYING_STATUS };
  }
  const maxPlies = numberOr(config?.rules?.maxPlies, 400);
  if (!TERMINAL_STATES.includes(status.state) && Array.isArray(history) && history.length >= maxPlies) {
    return { state: 'max-plies', winner: null, reason: 'max-plies', reasonZh: `已达 ${maxPlies} 手上限，判和` };
  }
  // 自然限着：以**配置为准**，而不是以引擎的固定常量为准。
  // 引擎内部用 FIFTY_MOVE_HALFMOVES = 120 判定，若配置把它**放宽**（例如 200），
  // 引擎会先返回 draw-fifty——此时必须撤销引擎的判定继续下棋，否则"调宽"这个配置是死的。
  const fifty = numberOr(config?.rules?.fiftyMovePlies, 120);
  const halfmove = position?.halfmove ?? 0;
  if (halfmove >= fifty) {
    return { state: 'draw-fifty', winner: null, reason: 'fifty-move', reasonZh: `连续 ${fifty} 个半回合无吃子，判和` };
  }
  if (status.state === 'draw-fifty') return { ...PLAYING_STATUS };
  if (status.state === 'draw-perpetual-check' && config?.rules?.perpetualCheckLoses === false) {
    return { state: 'draw-repetition', winner: null, reason: 'repetition', reasonZh: '三次重复局面，判和' };
  }
  return status;
}

/** 新建一个 idle 对局（不落盘、不排 AI）。 */
export function createState(engine, options = {}) {
  const position = engine.initialPosition();
  const initialFen = engine.positionToFen(position);
  const maxPlies = numberOr(options.maxPlies, numberOr(options.config?.rules?.maxPlies, 400));
  const hero = options.hero === 'b' ? 'b' : 'r';
  const configured = options.config?.opponent?.mode === 'local' ? 'local' : 'model';
  const opponent = options.opponent === 'local' || options.opponent === 'model' ? options.opponent : configured;
  return {
    gameId: options.gameId ?? `g${(options.now ?? Date.now()).toString(36)}`,
    position,
    initialFen,
    fens: [initialFen],
    history: [],
    hero,
    opponent,
    phase: 'idle',
    pending: PENDING.IDLE,
    status: { ...PLAYING_STATUS },
    // revision 必须**跨对局单调递增**：客户端用它丢弃过期投影（§7.5.4）。
    // 若新对局从 1 重新开始，新对局的投影会被栅栏判成 stale 而不被采用——
    // 表现为「点了新对局，棋盘与棋谱还是上一局」。所以允许调用方给定种子。
    revision: numberOr(options.revision, 1),
    clockMs: createClock(),
    maxPlies,
    message: null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 },
    resigned: null,
    opponentLabel: options.opponentLabel ?? (opponent === 'local' ? '本地引擎' : null),
    opponentProvider: options.opponentProvider ?? null,
    opponentModel: options.opponentModel ?? null,
  };
}

/** 浅层克隆并做一次修订（每次可见变更都必须走这里）。 */
export function revise(state, patch) {
  return { ...state, ...patch, revision: state.revision + 1 };
}

/** 设置 pending（不动 revision 之外的任何东西）。 */
export function setPending(state, pending, message) {
  return revise(state, { pending, message: message === undefined ? state.message : message });
}

/** 设置状态条消息（`{ code, tone }` 或 null）。 */
export function setMessage(state, message) {
  return revise(state, { message: message ?? null });
}

/** 落子：生成记录、推进局面、更新计时与状态。 */
export function advance(state, engine, move, options = {}) {
  const ms = numberOr(options.ms, 0);
  const record = makeRecord(engine, state.position, move, ms, {});
  const position = engine.applyMove(state.position, move);
  const fenAfter = record.fenAfter === '' ? safeFen(engine, position) : record.fenAfter;
  const history = state.history.concat([record]);
  const fens = state.fens.concat([fenAfter]);
  const status = computeStatus(engine, position, fens, options.config, history);
  if (status.state === 'checkmate') record.mate = true;
  const finished = TERMINAL_STATES.includes(status.state);
  const side = state.position.turn;
  return {
    ...state,
    position,
    history,
    fens,
    status,
    phase: finished ? 'finished' : 'playing',
    pending: PENDING.IDLE,
    message: options.message === undefined ? null : options.message,
    clockMs: addMs(state.clockMs, side, ms),
    revision: state.revision + 1,
  };
}

/** 标记终局（认输 / 外部判定）。 */
export function finish(state, status, extra = {}) {
  return revise(state, {
    phase: 'finished',
    pending: PENDING.IDLE,
    status: normalizeStatus(status),
    message: extra.message === undefined ? state.message : extra.message,
    resigned: extra.resigned === undefined ? state.resigned : extra.resigned,
  });
}

/** 悔棋：丢掉最后 `plies` 手并用引擎重放，返回新状态。 */
export function truncate(state, engine, plies, config) {
  const drop = Math.max(0, Math.floor(numberOr(plies, 0)));
  const keep = Math.max(0, state.history.length - drop);
  let position = engine.positionFromFen(state.initialFen);
  const history = [];
  const fens = [state.initialFen];
  for (let index = 0; index < keep; index += 1) {
    const source = state.history[index];
    if (source === null || typeof source !== 'object') break;
    const move = { from: source.move.from, to: source.move.to };
    if (!engine.isLegalMove(position, move)) break;
    const record = makeRecord(engine, position, move, source.ms);
    history.push(record);
    position = engine.applyMove(position, move);
    fens.push(record.fenAfter);
  }
  const status = computeStatus(engine, position, fens, config, history);
  return {
    ...state,
    position,
    history,
    fens,
    status,
    phase: 'playing',
    pending: PENDING.IDLE,
    message: null,
    resigned: null,
    revision: state.revision + 1,
  };
}

/** 应用对手模型用量（FR23）。 */
export function addUsage(state, usage) {
  const current = state.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 };
  const input = numberOr(usage?.inputTokens, 0);
  const output = numberOr(usage?.outputTokens, 0);
  const total = numberOr(usage?.totalTokens, input + output);
  return {
    ...state,
    usage: {
      inputTokens: current.inputTokens + input,
      outputTokens: current.outputTokens + output,
      totalTokens: current.totalTokens + total,
      calls: current.calls + 1,
    },
  };
}

/**
 * §7.5.4 的投影：客户端 `JSON.parse` 后整体替换本地状态。
 * @returns {object} 无损 JSON 形状的投影。
 */
export function project(state, engine, legalTargets) {
  const last = state.history.length > 0 ? state.history[state.history.length - 1] : null;
  return {
    ok: true,
    gameId: state.gameId,
    revision: state.revision,
    fen: safeFen(engine, state.position),
    turn: state.position.turn,
    hero: state.hero,
    // 对手只有**这一个**真相（客户端 deriveModel/PanelHeader 读 p.opponent.kind/.model/.provider）。
    opponent: {
      kind: state.opponent,
      provider: state.opponentProvider ?? null,
      model: state.opponentModel ?? null,
      label: state.opponentLabel ?? (state.opponent === 'local' ? '本地引擎' : '当前会话模型'),
    },
    phase: state.phase,
    pending: state.pending,
    status: { state: state.status.state, winner: state.status.winner, reasonZh: state.status.reasonZh },
    board: state.position.board.slice(),
    lastMove: last === null ? null : { from: last.move.from, to: last.move.to, iccs: last.iccs, zh: last.zh },
    legalTargets: legalTargets ?? {},
    history: state.history.map((record) => ({ zh: record.zh, iccs: record.iccs, captured: record.captured === '' ? '' : record.captured })),
    clock: { red: state.clockMs.red, black: state.clockMs.black },
    usage: { ...(state.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 }) },
    // 除机器码外还要带上**具体原因**：`messageOf(code, detail)` 早就生成了 textZh，
    // 但投影曾把它丢掉，于是面板只能把每种降级都显示成同一句泛化文案
    // （实测把「模型连续给出非法着法」显示成了「模型超时」——比不显示更糟）。
    message: state.message === null
      ? null
      : {
        code: state.message.code,
        tone: state.message.tone,
        textZh: typeof state.message.textZh === 'string' && state.message.textZh !== '' ? state.message.textZh : null,
      },
    error: null,
  };
}

/** 计算交互层要用的 legalTargets：`{ "<fromIndex>": [toIndex, …] }`。 */export function legalTargets(engine, position) {
  const out = {};
  let moves = [];
  try {
    moves = engine.generateMoves(position);
  } catch {
    moves = [];
  }
  for (const move of moves) {
    const key = String(move.from);
    if (out[key] === undefined) out[key] = [];
    out[key].push(move.to);
  }
  return out;
}

function safeFen(engine, position) {
  try {
    return engine.positionToFen(position);
  } catch {
    return '';
  }
}

/**
 * 由持久化记录重放出一个完整对局状态（§6.3：只存紧凑 MoveRecord[] + 初始 FEN）。
 * @param {object} engine 引擎模块。
 * @param {object} record 存档记录。
 * @param {object} config 归一化配置（只读 `rules`）。
 * @returns {object} GameState。
 */
export function restoreState(engine, record, config) {
  const base = createState(engine, {
    hero: record?.hero,
    opponent: record?.opponent,
    maxPlies: record?.maxPlies,
    gameId: record?.gameId,
    // 宿主重载（例如 profile 的 patchReload）时页面可能还开着、栅栏还在，
    // 因此 revision 必须从记录里续上，而不是回到 1。
    // 旧存档（本字段引入之前写的）没有 revision：用时间戳做种子，保证它**大于**
    // 页面上可能已经持有的任何计数，否则首帧就会被客户端栅栏丢掉、面板像"卡住"。
    revision: numberOr(record?.revision, Date.now()),
  });
  const replay = fromCompact(engine, record?.initialFen ?? base.initialFen, record?.moves);
  const history = replay.history;
  const fens = [replay.initialFen].concat(history.map((entry) => entry.fenAfter));
  const status = computeStatus(engine, replay.position, fens, config, history);
  const terminal = TERMINAL_STATES.includes(status.state);
  return {
    ...base,
    position: replay.position,
    initialFen: replay.initialFen,
    fens,
    history,
    status,
    phase: terminal ? 'finished' : record?.phase === 'playing' || history.length > 0 ? 'playing' : base.phase,
    pending: PENDING.IDLE,
    clockMs: { red: numberOr(record?.clockMs?.red, 0), black: numberOr(record?.clockMs?.black, 0) },
    usage: {
      inputTokens: numberOr(record?.usage?.inputTokens, 0),
      outputTokens: numberOr(record?.usage?.outputTokens, 0),
      totalTokens: numberOr(record?.usage?.totalTokens, 0),
      calls: numberOr(record?.usage?.calls, 0),
    },
    resigned: typeof record?.resigned === 'string' ? record.resigned : null,
    opponentLabel: typeof record?.opponentLabel === 'string' ? record.opponentLabel : null,
    opponentProvider: typeof record?.opponentProvider === 'string' ? record.opponentProvider : null,
    opponentModel: typeof record?.opponentModel === 'string' ? record.opponentModel : null,
  };
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
