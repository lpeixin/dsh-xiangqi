/**
 * 对局服务 —— **唯一**的业务实现（§7.5.2「一个操作，两个调用方」）。
 *
 * 工具、会话命令（`/xiangqi`）、跨半 RPC（`/xiangqi-mate`）都只做「校验入参 → 调本服务
 * → 组装返回」，绝不允许各写一份业务逻辑。本模块负责状态缓存、按会话持久化、revision
 * 栅栏、后台应招的托管与取消；后台任务一律经 `track()` 登记，绝无游离异步。
 */

import { loadEngine } from './engine.js';
import { resolveInput, toRecord } from './api.js';
import { clockLine } from './clock.js';
import { boardText, exportText, reviewData } from './records.js';
import { createStore, sanitizeSessionId } from './store.js';
import { createLiveAgentLookup, describedLocal, failure, firstString, missingOpponentPort, numberOr, safe } from './util.js';
import { PENDING, addUsage, advance, createState, finish, legalTargets, project, restoreState, revise, setPending, truncate } from './state.js';

/**
 * 建立对局服务。
 * @param {object} options 选项。
 * @param {object} options.ctx 插件上下文。
 * @param {object} options.config 归一化配置。
 * @param {(task: Promise<unknown>) => unknown} options.track 后台任务托管器。
 * @param {object} options.opponent 对手端口（由入口注入，保证分层方向 opponent → game）。
 *   形如 `{ resolve, describe, decide, local, message }`。
 * @returns {object} 对局服务。
 */
export function createGameService({ ctx, config, track, opponent, now = () => Date.now() }) {
  const port = opponent ?? missingOpponentPort();
  const liveAgent = createLiveAgentLookup(ctx);
  const store = createStore({ config, ctx });
  const logger = ctx?.logger;
  const cache = new Map();
  const decisions = new Map();
  const controllers = new Set();
  let sequence = 0;
  let disposed = false;

  function warn(message, error) {
    try {
      if (typeof logger?.warn === 'function') logger.warn(`[xiangqi] ${message}`, error);
    } catch {
      /* 日志失败绝不影响对局 */
    }
  }

  async function persist(state, id, cwd) {
    try {
      await store.save(id, cwd, toRecord(state));
    } catch (error) {
      warn(`持久化 ${id} 失败`, error);
    }
  }

  /** 读取（或首次建立）某会话的对局状态。 */
  async function load(id, cwd, agent) {
    const key = sanitizeSessionId(id);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const engine = await loadEngine();
    const effectiveAgent = agent ?? liveAgent(key);
    let state;
    try {
      const record = await store.load(key, cwd);
      state = record !== undefined && record !== null ? restoreState(engine, record, config) : createState(engine, { config });
    } catch (error) {
      warn(`读取存档 ${key} 失败，改为新对局`, error);
      state = createState(engine, { config });
    }
    if (state.phase === 'idle' && state.history.length > 0) state = { ...state, phase: 'playing' };
    if (state.opponentLabel === null || state.opponentLabel === undefined) {
      // 惰性合成的默认棋局也必须与 newGame 走同一段对手解析（FR23 的诚实性）。
      state = applyOpponent(state, state.opponent === 'local' ? 'local' : config.opponent.mode === 'local' ? 'local' : 'model', effectiveAgent);
    }
    cache.set(key, state);
    return state;
  }

  /** **唯一**的对手解析：状态、标签、provider/model 都从这里来。 */
  function applyOpponent(state, kind, agent, knownRoute) {

    const route = knownRoute ?? (kind === 'model' ? port.resolve(agent) : undefined);
    const described = port.describe(kind, route);
    return {
      ...state,
      opponent: described.kind,
      opponentLabel: described.label,
      opponentProvider: described.provider,
      opponentModel: described.model,
    };
  }

  /** 无 agent 的调用方（跨半 RPC）：用 sessionId 反查活体 Agent，取回同一份会话 cwd 与模型路由。 */
  function sessionFor(sessionId, cwd) {
    const id = sanitizeSessionId(sessionId);
    const agent = liveAgent(id);
    return {
      id,
      cwd: firstString(cwd, agent?.session?.header?.cwd) ?? process.cwd(),
      agent,
    };
  }

  /** 会话身份：id 取 `agent.id`（回退 `session.header.id`），cwd 取 `session.header.cwd`。 */
  function sessionOf(agent) {
    const id = firstString(agent?.id, agent?.session?.header?.id) ?? 'default';
    const cwd = firstString(agent?.session?.header?.cwd) ?? process.cwd();
    return { id: sanitizeSessionId(id), cwd, agent };
  }

  /** 开新局（或重开）。 */
  async function newGame({ id, cwd, agent, side, opponent: kind, maxPlies }) {
    const engine = await loadEngine();
    const resolvedOpponent = kind === 'local' || kind === 'model' ? kind : config.opponent.mode === 'local' ? 'local' : 'model';
    // 新对局的 revision 必须**大于**上一局，否则客户端栅栏会把这份投影判成 stale 丢掉，
    // 用户就会看到「点了新对局，棋盘与棋谱还是上一局」。
    const previous = cache.get(id) ?? (await load(id, cwd));
    let state = createState(engine, {
      config,
      hero: side === 'b' ? 'b' : 'r',
      opponent: resolvedOpponent,
      maxPlies,
      revision: numberOr(previous?.revision, 0) + 1,
    });
    state = { ...applyOpponent(state, resolvedOpponent, agent), phase: 'playing' };
    cache.set(id, state);
    decisions.delete(id);
    await persist(state, id, cwd);
    await beginDecision(id, cwd, agent);
    return cache.get(id) ?? state;
  }

  /** 落子。`actor` 决定「谁在走」——工具只能替对手走，命令/RPC 只能替人走。 */
  async function playMove({ id, cwd, agent, actor, input, reason, ms }) {
    const engine = await loadEngine();
    const state = await load(id, cwd);
    const legal = () => catalog(engine, state.position);
    if (state.phase === 'finished') return failure('GAME_OVER', '对局已结束，请先开新局（xiangqi_new）', legal());
    if (state.pending === PENDING.THINKING && actor === 'hero') return failure('AI_THINKING', 'AI 正在思考，请稍候或先用本地引擎代走', legal());
    const turn = state.position.turn;
    if (actor === 'hero' && turn !== state.hero) return failure('NOT_YOUR_TURN', '现在不是你的回合', legal());
    if (actor === 'opponent' && turn === state.hero) return failure('NOT_YOUR_TURN', '现在不是对手的回合，不得替人类方走子', legal());

    const resolved = resolveInput(engine, state.position, input);
    if (resolved.error !== undefined) return failure('ILLEGAL_MOVE', resolved.error, legal());
    const rejected = safe(() => engine.moveRejectReason(state.position, resolved.move), null);
    if (rejected !== null && rejected !== undefined) return failure('ILLEGAL_MOVE', String(rejected), legal());

    const next = advance(state, engine, resolved.move, { ms: numberOr(ms, 0), config, message: null });
    cache.set(id, next);
    await persist(next, id, cwd);
    await beginDecision(id, cwd, agent);
    return {
      ok: true,
      state: cache.get(id) ?? next,
      move: {
        ...resolved.move,
        iccs: safe(() => engine.moveToIccs(resolved.move), ''),
        zh: safe(() => engine.formatChinese(state.position, resolved.move), ''),
        reason: reason ?? null,
      },
    };
  }

  /** 悔棋（默认 2 手：回到自己上一次走子之前）。 */
  async function undo({ id, cwd, agent, plies }) {
    const engine = await loadEngine();
    const state = await load(id, cwd);
    if (state.history.length === 0) return failure('NO_HISTORY', '还没有走过任何着法，无法悔棋');
    const count = Math.max(1, Math.floor(numberOr(plies, 2)));
    const applied = Math.min(count, state.history.length);
    const next = truncate(state, engine, applied, config);
    cache.set(id, next);
    decisions.delete(id);
    await persist(next, id, cwd);
    if (next.position.turn !== next.hero) await beginDecision(id, cwd, agent);
    return { ok: true, state: cache.get(id) ?? next, plies: applied };
  }

  /** 提示：本地引擎候选 + 评估摘要，不消耗模型额度（FR11）。 */
  async function hint({ id, cwd, count, depth }) {
    const engine = await loadEngine();
    const state = await load(id, cwd);
    const wanted = Math.max(1, Math.min(5, Math.floor(numberOr(count, 3))));
    const position = state.position;
    const moves = safe(() => engine.generateMoves(position), []);
    const scored = moves.map((move) => {
      const next = safe(() => engine.applyMove(position, move), position);
      const raw = safe(() => engine.evaluate(next).score, 0);
      const score = position.turn === 'r' ? raw : -raw;
      return {
        iccs: safe(() => engine.moveToIccs(move), ''),
        zh: safe(() => engine.formatChinese(position, move), ''),
        score,
        capture: position.board[move.to] ?? '',
      };
    }).filter((entry) => entry.iccs !== '');
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, wanted);
    return {
      ok: true,
      state,
      depth: Math.max(1, Math.floor(numberOr(depth, config?.local?.depth ?? 4))),
      candidates: top.map((entry) => ({ iccs: entry.iccs, zh: entry.zh, score: entry.score, pv: [entry.iccs], capture: entry.capture })),
      evalSummaryZh: safe(() => engine.evaluate(position).summaryZh, ''),
    };
  }

  /** 复盘数据（FR12）。 */
  async function review({ id, cwd, highlight }) {
    const engine = await loadEngine();
    const state = await load(id, cwd);
    return { ok: true, state, data: reviewData(state, engine, highlight === 'all' ? 'all' : 'turning') };
  }

  /** 认输（授权类操作：只由人触发；工具路径把它当作「人认输」）。 */
  async function resign({ id, cwd, actor }) {
    const state = await load(id, cwd);
    if (state.phase === 'finished') return failure('GAME_OVER', '对局已结束');
    const loser = actor === 'opponent' ? (state.hero === 'r' ? 'b' : 'r') : state.hero;
    const winner = loser === 'r' ? 'b' : 'r';
    const label = (side) => (side === 'r' ? '红方' : '黑方');
    const next = finish(state, { state: 'resigned', winner, reason: 'resigned', reasonZh: `${label(loser)}认输，${label(winner)}胜` }, { resigned: loser });
    cache.set(id, next);
    decisions.delete(id);
    await persist(next, id, cwd);
    return { ok: true, state: next };
  }

  /** 放弃模型、立刻由本地引擎代走（Q7 按钮 / RPC 的 fallback 端点）。 */
  async function forceLocal({ id, cwd, agent }) {
    const state = await load(id, cwd);
    if (state.phase !== 'playing' || state.position.turn === state.hero) return failure('NOT_AI_TURN', '现在不是 AI 的回合');
    const next = revise({ ...state, opponent: 'local', opponentLabel: '本地引擎' }, { pending: PENDING.IDLE, message: port.message('ai.fallback.local', '已切换为本地引擎') });
    cache.set(id, next);
    decisions.delete(id);
    await persist(next, id, cwd);
    await beginDecision(id, cwd, agent);
    return { ok: true, state: cache.get(id) ?? next };
  }

  /** 导出棋谱（中文记谱 + FEN）。 */
  async function exportGame({ id, cwd }) {
    const state = await load(id, cwd);
    const { data } = await snapshot(id, cwd, { boardText: true });
    return { data, exportText: exportText(state) };
  }

  /** §7.5.4 的投影（命令返回值 = JSON.stringify 这段）。 */
  async function snapshot(id, cwd, options = {}) {
    const engine = await loadEngine();
    const state = await load(id, cwd, options?.agent);
    const data = project(state, engine, legalTargets(engine, state.position));
    data.storage = store.info();
    // 客户端按 projection.saved === false 显示「本局不会被保存」（§6.3 内存降级）。
    data.saved = store.persistent;
    data.clockText = clockLine(state.clockMs);
    if (options.boardText === true) {
      const describe = { includeMoves: options.includeMoves !== false, includeEval: options.includeEval === true, ascii: options.ascii !== false };
      data.boardText = boardText(state, engine, describe);
    }
    return { state, engine, data };
  }

  /** 开启一次对手决策（后台任务；由 `track()` 托管）。 */
  async function beginDecision(id, cwd, agent) {
    if (disposed === true) return undefined;
    let state = cache.get(id);
    if (state === undefined) return undefined;
    if (state.phase !== 'playing' || state.position.turn === state.hero || state.pending === PENDING.THINKING) return undefined;
    const engine = await loadEngine();
    const effectiveAgent = agent ?? liveAgent(id);
    const budget = numberOr(config?.opponent?.maxTokensPerGame, 0);
    const exceeded = budget > 0 && numberOr(state.usage?.totalTokens, 0) >= budget;
    if (exceeded) state = { ...state, ...describedLocal() }; // 超限停用模型并降级（§4.4.4）
    const decisionId = (sequence += 1);
    decisions.set(id, decisionId);
    const started = now();
    const thinking = setPending(state, PENDING.THINKING, port.message(exceeded ? 'ai.budget' : 'ai.thinking'));
    cache.set(id, thinking);
    await persist(thinking, id, cwd);

    const controller = new AbortController();
    controllers.add(controller);
    const usages = [];
    const task = (async () => {
      try {
        const outcome = await port.decide({
          ctx,
          config,
          agent: effectiveAgent ?? null,
          engine,
          state: thinking,
          signal: controller.signal,
          seed: started,
          logger,
          onUsage: (usage) => usages.push(usage),
        });
        await settle(id, cwd, engine, decisionId, thinking, outcome, usages, started, controller);
      } catch (error) {
        warn(`后台应招失败 ${id}`, error);
        const current = cache.get(id);
        if (current !== undefined && current.pending === PENDING.THINKING) {
          cache.set(id, setPending(current, PENDING.FAILED, port.message('ai.fallback.local', '内部错误')));
        }
        decisions.delete(id);
        controllers.delete(controller);
      }
    })();
    track(task);
    return thinking;
  }

  /** 决策落地：revision 栅栏 → 落子或降级。整体 try/catch，绝不产生未捕获 rejection。 */
  async function settle(id, cwd, engine, decisionId, thinking, outcome, usages, started, controller) {
    try {
      if (disposed === true || decisions.get(id) !== decisionId) return;
      const current = cache.get(id);
      if (current === undefined) return;
      const next = applyUsages(current, usages);
      if (next.revision !== thinking.revision) {
        // **revision 栅栏**：思考期间局面已被改动。
        // 若 pending 已被其它路径消费（例如人类/工具抢先落子），静默丢弃即可；
        // 否则按 §4.4.4 丢弃不落子，并在 message 里带「需重新请求」。
        if (next.pending !== PENDING.THINKING) return;
        const dropped = revise(next, { pending: PENDING.IDLE, message: port.message('ai.stale', '局面已变化，需重新请求') });
        cache.set(id, dropped);
        await persist(dropped, id, cwd);
        return;
      }
      if (next.pending !== PENDING.THINKING) return;
      if (outcome.ok !== true) {
        const failed = setPending(next, PENDING.FAILED, outcome.message ?? port.message('ai.fallback.local'));
        cache.set(id, failed);
        await persist(failed, id, cwd);
        return;
      }
      let committed = next;
      let decision = outcome.decision;
      let message = outcome.message ?? null;
      if (decision === undefined || decision.move === undefined || !engine.isLegalMove(next.position, decision.move) || next.position.turn === next.hero) {
        decision = port.local(engine, next.position, config, started);
        message = port.message('ai.fallback.local', '局面已变化');
      }
      committed = advance(next, engine, decision.move, { ms: Math.max(0, now() - started), config, message });
      committed = applyOpponent(committed, committed.opponent, undefined, outcome.route);
      cache.set(id, committed);
      await persist(committed, id, cwd);
    } catch (error) {
      warn(`应招落地失败 ${id}`, error);
      const current = cache.get(id);
      if (current !== undefined) cache.set(id, setPending(current, PENDING.FAILED, port.message('ai.fallback.local', '内部错误')));
    } finally {
      decisions.delete(id);
      controllers.delete(controller);
    }
  }

  function applyUsages(state, usages) {
    let next = state;
    for (const usage of usages) next = addUsage(next, usage);
    return next;
  }

  function catalog(engine, position) {
    const entries = safe(() => engine.legalMoveCatalog(position), []);
    return Array.isArray(entries) ? entries.map((entry) => ({ iccs: String(entry?.iccs ?? ''), zh: String(entry?.zh ?? '') })) : [];
  }

  return {
    store,
    sessionOf,
    sessionFor,
    load,
    newGame,
    playMove,
    undo,
    hint,
    review,
    resign,
    forceLocal,
    exportGame,
    snapshot,
    beginDecision,
    /** 只读诊断（测试与面板用）。 */
    diagnostics() {
      return { sessions: cache.size, decisions: decisions.size, inflight: controllers.size, storage: store.info() };
    },
    /** 释放：abort 所有在飞请求、关闭存储；入口会在自己的 disposer 里 await 托管任务。 */
    async dispose() {
      disposed = true;
      for (const controller of controllers) {
        try {
          controller.abort();
        } catch {
          /* 忽略 */
        }
      }
      controllers.clear();
      decisions.clear();
      cache.clear();
      await store.close();
    },
  };
}
