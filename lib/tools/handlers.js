/**
 * 六个工具的 handler（§6.2）。
 *
 * 薄层纪律：**不做业务判断**——只做「校验入参 → 调 `lib/game/service.js` → 组装返回」。
 * 可预期的用户/模型错误用 `throw new Error('<中文说明>')`（框架归一化成 `Error: …`，
 * 不中断回合）；需要机器码的着法错误返回 `{ ok:false, error, errorZh, legalMoves }`。
 */

/** 组装六个 handler。 */
export function createHandlers({ service, config }) {
  function sessionOf(exec) {
    return service.sessionOf(exec?.agent);
  }

  async function snapshot(session, options = {}) {
    const { state, engine, data } = await service.snapshot(session.id, session.cwd, {
      boardText: true,
      agent: session.agent,
      includeMoves: options.includeMoves !== false,
      includeEval: options.includeEval === true,
      ascii: options.ascii !== false,
    });
    return { state, engine, data };
  }

  const tools = {
    /** 开局 / 重开。 */
    async new(args, exec) {
      const input = objectArgs(args);
      const side = optionalEnum(input.side, 'side', ['r', 'b']);
      const opponent = optionalEnum(input.opponent, 'opponent', ['model', 'local']);
      const maxPlies = optionalInt(input.maxPlies, 'maxPlies', 10, 2000);
      const session = sessionOf(exec);
      await service.newGame({ id: session.id, cwd: session.cwd, agent: session.agent, side, opponent, maxPlies });
      const { state, data } = await snapshot(session);
      return {
        ok: true,
        fen: data.fen,
        turn: data.turn,
        hero: data.hero,
        opponent: data.opponent,
        phase: data.phase,
        pending: data.pending,
        status: data.status,
        revision: data.revision,
        legalCount: countLegal(data.legalTargets),
        clock: data.clock,
        boardText: data.boardText,
      };
    },

    /** 读取局面（并发安全）。 */
    async board(args, exec) {
      const input = objectArgs(args);
      const includeMoves = optionalBool(input.includeMoves, 'includeMoves');
      const includeEval = optionalBool(input.includeEval, 'includeEval');
      const ascii = optionalBool(input.ascii, 'ascii');
      const session = sessionOf(exec);
      const { state, engine, data } = await snapshot(session, { includeMoves, includeEval, ascii });
      const catalog = safe(() => engine.legalMoveCatalog(state.position), []);
      const moveCatalog = (Array.isArray(catalog) ? catalog : []).map((entry) => ({ iccs: String(entry?.iccs ?? ''), zh: String(entry?.zh ?? '') }));
      const last = state.history.length > 0 ? state.history[state.history.length - 1] : null;
      const out = {
        ok: true,
        fen: data.fen,
        turn: data.turn,
        hero: data.hero,
        opponent: data.opponent,
        phase: data.phase,
        pending: data.pending,
        status: data.status,
        revision: data.revision,
        legalCount: moveCatalog.length,
        historyZh: data.history.map((entry) => entry.zh),
        lastMove: last === null ? null : { iccs: last.iccs, zh: last.zh },
        clock: data.clock,
        boardText: ascii === false ? `局面速览（ascii: false）\nFEN: ${data.fen}` : data.boardText,
      };
      if (includeMoves !== false) out.legalMoves = moveCatalog;
      if (includeEval === true) out.evalSummaryZh = safe(() => engine.evaluate(state.position).summaryZh, '');
      return out;
    },

    /** 落子（模型/工具路径 = 只能替对手走子）。 */
    async move(args, exec) {
      const input = objectArgs(args);
      if (input.move === undefined || input.move === null || input.move === '') throw new Error('缺少参数 move（ICCS 座标、中文记谱或 { from, to }）');
      if (typeof input.move !== 'string' && typeof input.move !== 'object') throw new Error('move 必须是字符串或 { from, to } 对象');
      const reason = optionalString(input.reason, 'reason');
      const session = sessionOf(exec);
      const outcome = await service.playMove({ id: session.id, cwd: session.cwd, agent: session.agent, actor: 'opponent', input: input.move, reason });
      if (outcome.ok !== true) {
        return {
          ok: false,
          error: outcome.error,
          errorZh: outcome.errorZh,
          legalMoves: (outcome.legalMoves ?? []).slice(0, 120),
        };
      }
      const { state, data } = await snapshot(session);
      return {
        ok: true,
        played: { iccs: outcome.move.iccs, zh: outcome.move.zh },
        captured: state.history.length > 0 ? state.history[state.history.length - 1].captured : '',
        fen: data.fen,
        turn: data.turn,
        status: data.status,
        pending: data.pending,
        aiTurn: state.phase === 'playing' && state.position.turn !== state.hero,
        revision: data.revision,
        clock: data.clock,
        boardText: data.boardText,
      };
    },

    /** 悔棋。 */
    async undo(args, exec) {
      const input = objectArgs(args);
      const plies = optionalInt(input.plies, 'plies', 1, 200) ?? 2;
      const session = sessionOf(exec);
      const outcome = await service.undo({ id: session.id, cwd: session.cwd, plies });
      if (outcome.ok !== true) return { ok: false, error: outcome.error, errorZh: outcome.errorZh };
      const { state, data } = await snapshot(session);
      return {
        ok: true,
        fen: data.fen,
        turn: data.turn,
        plies: outcome.plies,
        historyZh: state.history.map((record) => record.zh),
        pending: data.pending,
        revision: data.revision,
        clock: data.clock,
        boardText: data.boardText,
      };
    },

    /** 提示（本地引擎，不消耗模型额度）。 */
    async hint(args, exec) {
      const input = objectArgs(args);
      const count = optionalInt(input.count, 'count', 1, 5) ?? 3;
      const depth = optionalInt(input.depth, 'depth', 1, 8);
      const session = sessionOf(exec);
      const outcome = await service.hint({ id: session.id, cwd: session.cwd, count, depth });
      const { data } = await snapshot(session);
      return {
        ok: true,
        fen: data.fen,
        turn: data.turn,
        depth: outcome.depth,
        candidates: outcome.candidates.map((entry) => ({
          iccs: entry.iccs,
          zh: entry.zh,
          score: entry.score,
          pv: Array.isArray(entry.pv) && entry.pv.length > 0 ? entry.pv : [entry.iccs],
          capture: entry.capture,
        })),
        evalSummaryZh: outcome.evalSummaryZh,
        boardText: data.boardText,
      };
    },

    /** 复盘（FR12）。 */
    async review(args, exec) {
      const input = objectArgs(args);
      const highlight = optionalEnum(input.highlight, 'highlight', ['turning', 'all']) ?? 'turning';
      const session = sessionOf(exec);
      const outcome = await service.review({ id: session.id, cwd: session.cwd, highlight });
      const { data } = await snapshot(session);
      return {
        ok: true,
        fen: data.fen,
        revision: data.revision,
        historyZh: outcome.data.historyZh,
        turningPoints: outcome.data.turningPoints,
        evalCurve: outcome.data.evalCurve,
        finalFen: outcome.data.finalFen,
        boardText: data.boardText,
      };
    },
  };

  return { ...tools };
}

function countLegal(legalTargets) {
  if (legalTargets === null || typeof legalTargets !== 'object') return 0;
  let total = 0;
  for (const value of Object.values(legalTargets)) if (Array.isArray(value)) total += value.length;
  return total;
}

function objectArgs(args) {
  if (args === null || args === undefined) return {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new Error('参数必须是一个对象');
  return args;
}

function optionalBool(value, name) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${name} 必须是布尔值`);
  return value;
}

function optionalInt(value, name, min, max) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${name} 必须是整数`);
  if (value < min || value > max) throw new Error(`${name} 必须在 ${min}–${max} 之间`);
  return value;
}

function optionalEnum(value, name, allowed) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${name} 只能是 ${allowed.join(' / ')}`);
  return value;
}

function optionalString(value, name) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`);
  return value.slice(0, 500);
}

function safe(read, fallback) {
  try {
    const value = read();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}
