/**
 * 三条入口共用的「表面层」：会话命令（`/xiangqi`）与跨半 RPC（`/xiangqi-mate`）。
 *
 * §7.5.2「一个操作，两个调用方」：这里只做**入参解析与结果装配**，真正的业务
 * 全部落在 `lib/game/service.js`（同一个 `dispatch` 同时服务两条入口）。
 */

import { toCompact } from './records.js';

const ACTIONS = new Set(['new', 'state', 'move', 'undo', 'hint', 'resign', 'review', 'board', 'export', 'fallback']);

/** 可用动作清单（命令 help 与 RPC 报错共用）。 */
export const ACTION_LIST = Object.freeze([...ACTIONS]);

/**
 * 建立表面层。
 * @param {object} options 选项。
 * @param {object} options.service 对局服务。
 * @param {object} options.config 归一化配置。
 * @returns {{ handleCommand: Function, handleRpc: Function }}
 */
export function createSurface({ service, config }) {
  /** `/xiangqi <action> …`（FR19：客户端到达宿主半的官方通道）。 */
  async function handleCommand(rawInput, agent) {
    const session = service.sessionOf(agent);
    const [action, ...rest] = String(rawInput ?? '').trim().split(/\s+/).filter((part) => part !== '');
    const verb = action === undefined || action === '' ? 'state' : action.toLowerCase();
    if (!ACTIONS.has(verb)) return { ok: false, reasonZh: `未知子命令「${action}」，可用：${ACTION_LIST.join(' / ')}` };
    const outcome = await dispatch(verb, session, { input: rest.join(' ') });
    if (outcome.ok !== true) return outcome;
    return { ok: true, snapshot: outcome.data, exportText: outcome.exportText };
  }

  /** 跨半 RPC（§7.5.3 通道①）：**只对 payload.sessionId 对应的会话操作**。 */
  async function handleRpc(endpoint, payload) {
    const sessionId = payload?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      return { ok: false, error: { code: 'BAD_SESSION', message: 'sessionId 必须是非空字符串', details: {} } };
    }
    const verb = String(endpoint ?? '').toLowerCase();
    if (!ACTIONS.has(verb)) {
      return { ok: false, error: { code: 'UNKNOWN_ENDPOINT', message: `未知 endpoint「${endpoint}」`, details: { endpoints: ACTION_LIST } } };
    }
    const session = service.sessionFor(sessionId, payload?.cwd);
    const outcome = await dispatch(verb, session, { ...payload, input: moveInputOf(payload) });
    if (outcome.ok !== true) {
      return {
        ok: false,
        error: {
          code: outcome.error ?? 'ERROR',
          message: outcome.errorZh ?? '操作失败',
          details: outcome.legalMoves === undefined ? {} : { legalMoves: outcome.legalMoves },
        },
      };
    }
    return { ok: true, value: outcome.data };
  }

  /** 唯一的动作派发：工具走的也是同一批服务方法。 */
  async function dispatch(verb, session, args) {
    const { id, cwd, agent } = session;
    // 投影给客户端用，不含着法目录（客户端只消费 legalTargets），保持体积紧凑。
    const snap = () => service.snapshot(id, cwd, { boardText: true, agent, includeMoves: false });
    switch (verb) {
      case 'new':
        await service.newGame({ id, cwd, agent, side: args.side, opponent: args.opponent, maxPlies: args.maxPlies });
        return { ok: true, data: (await snap()).data };
      case 'state':
      case 'board':
        return { ok: true, data: (await snap()).data };
      case 'move': {
        const outcome = await service.playMove({
          id,
          cwd,
          agent,
          actor: args.actor === 'opponent' ? 'opponent' : 'hero',
          input: args.input,
          reason: args.reason,
          ms: args.ms,
        });
        if (outcome.ok !== true) return outcome;
        return { ok: true, data: (await snap()).data, state: outcome.state };
      }
      case 'undo': {
        const outcome = await service.undo({ id, cwd, plies: numberOr(args.plies, 2) });
        if (outcome.ok !== true) return outcome;
        return { ok: true, data: (await snap()).data };
      }
      case 'hint': {
        const outcome = await service.hint({ id, cwd, count: numberOr(args.count, 3), depth: args.depth });
        if (outcome.ok !== true) return outcome;
        const { data } = await snap();
        return { ok: true, data: { ...data, candidates: outcome.candidates, evalSummaryZh: outcome.evalSummaryZh, hintDepth: outcome.depth } };
      }
      case 'review': {
        const outcome = await service.review({ id, cwd, highlight: args.highlight });
        if (outcome.ok !== true) return outcome;
        const { data } = await snap();
        // 客户端只消费 turningPoints 的 ply 整数数组（画竖线标记），
        // 富数据整体放在 review 里，互不干扰。
        return {
          ok: true,
          data: {
            ...data,
            turningPoints: outcome.data.turningPoints.map((point) => point.ply),
            review: outcome.data,
          },
        };
      }
      case 'fallback': {
        // Q7 的「立即由本地引擎代走」。
        const outcome = await service.forceLocal({ id, cwd, agent });
        if (outcome.ok !== true) return outcome;
        return { ok: true, data: (await snap()).data };
      }
      case 'resign': {
        const outcome = await service.resign({ id, cwd, actor: args.actor ?? 'hero' });
        if (outcome.ok !== true) return outcome;
        return { ok: true, data: (await snap()).data };
      }
      case 'export': {
        const payload = await service.exportGame({ id, cwd });
        return { ok: true, data: payload.data, exportText: payload.exportText };
      }
      default:
        return { ok: false, error: 'UNKNOWN_ENDPOINT', errorZh: `未知动作「${verb}」` };
    }
  }

  return { handleCommand, handleRpc, actionList: () => [...ACTIONS], config };
}

/**
 * 归一化 RPC 的落子入参。
 *
 * 客户端（M3）发的是 `{ from, to, iccs }`（from/to 是内部索引），命令与工具发的是
 * 字符串。三种形状都必须接受，优先级：`move`/`input` → `iccs` → `from` + `to`。
 */
export function moveInputOf(payload) {
  const direct = payload?.move ?? payload?.input;
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim();
  if (direct !== null && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  const iccs = payload?.iccs;
  if (typeof iccs === 'string' && iccs.trim() !== '') return iccs.trim();
  const from = payload?.from;
  const to = payload?.to;
  const fromOk = Number.isInteger(from) || (typeof from === 'string' && from.trim() !== '');
  const toOk = Number.isInteger(to) || (typeof to === 'string' && to.trim() !== '');
  if (fromOk && toOk) return { from, to };
  return direct;
}

/** 把 `move` 入参（ICCS / 中文 / 坐标对象）解析成引擎的 `Move`。 */
export function resolveInput(engine, position, input) {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    if (typeof input.iccs === 'string' && input.iccs !== '') return resolveInput(engine, position, input.iccs);
    const from = parseSquare(input.from);
    const to = parseSquare(input.to);
    if (from !== undefined && to !== undefined) return { move: { from, to } };
    return { error: '坐标对象需要 { from, to }（形如 a0 / h2）' };
  }
  if (typeof input !== 'string' || input.trim() === '') return { error: '缺少着法（ICCS 或中文记谱）' };
  const parsed = safe(() => engine.parseAnyMove(position, input.trim()), undefined);
  if (parsed !== undefined && parsed !== null && parsed.move !== undefined) {
    return { move: { from: parsed.move.from, to: parsed.move.to } };
  }
  return { error: typeof parsed?.error === 'string' ? parsed.error : `无法解析着法「${input}」` };
}

/** ICCS 单格（如 `h2`）或 0..89 索引 → 内部索引。 */
export function parseSquare(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 89) return value;
  if (typeof value !== 'string') return undefined;
  const match = /^([a-i])([0-9])$/.exec(value.trim().toLowerCase());
  if (match === null) return undefined;
  return (9 - Number(match[2])) * 9 + (match[1].charCodeAt(0) - 97);
}

/** GameState → 持久化记录（§6.3 的紧凑形式）。 */
export function toRecord(state) {
  return {
    v: 1,
    gameId: state.gameId,
    initialFen: state.initialFen,
    hero: state.hero,
    opponent: state.opponent,
    maxPlies: state.maxPlies,
    phase: state.phase,
    moves: toCompact(state.history),
    clockMs: { red: state.clockMs.red, black: state.clockMs.black },
    opponentProvider: state.opponentProvider ?? null,
    opponentModel: state.opponentModel ?? null,
    usage: { ...(state.usage ?? {}) },
    resigned: state.resigned ?? null,
    opponentLabel: state.opponentLabel ?? null,
    savedAt: Date.now(),
  };
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safe(read, fallback) {
  try {
    const value = read();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}
