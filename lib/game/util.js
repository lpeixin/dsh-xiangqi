/**
 * 对局层的通用小工具（放在单独文件里是为了守住 §11-R8 的单文件行数上限）。
 */

/**
 * 建一个「按 sessionId 找活体 Agent」的查询器。
 *
 * 跨半 RPC 的 handler **拿不到 agent**（§7.5.3 约束 4），但模型路由必须知道当前会话用的是
 * 哪个模型。`ctx.agents.get(sessionId)` 是宿主公开的一等 API，正好补上这一环；
 * 服务不可用或会话不在本进程时返回 undefined，路由继续降级。
 * @param {object} ctx 插件上下文。
 * @returns {(id: string) => object|undefined} 查询函数。
 */
export function createLiveAgentLookup(ctx) {
  return (id) => {
    const agents = typeof ctx?.get === 'function' ? ctx.get('agents') : undefined;
    if (agents === undefined || agents === null || typeof agents.get !== 'function') return undefined;
    try {
      return agents.get(id) ?? undefined;
    } catch {
      return undefined;
    }
  };
}

/** 取第一个非空字符串。 */
export function firstString(...values) {
  for (const value of values) if (typeof value === 'string' && value.trim() !== '') return value;
  return undefined;
}

/** 数字兜底。 */
export function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 安全求值：抛错或返回 undefined 时给兜底值。 */
export function safe(read, fallback) {
  try {
    const value = read();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/** 结构化失败结果（可预期错误；不抛异常）。 */
export function failure(error, errorZh, legalMoves) {
  return legalMoves === undefined ? { ok: false, error, errorZh } : { ok: false, error, errorZh, legalMoves };
}

/** 未注入对手端口时立刻报错（宁可在装配期炸，也不要在用户走子时才炸）。 */
export function missingOpponentPort() {
  const fail = () => {
    throw new Error('xiangqi: 对局服务缺少 opponent 端口（应由入口注入 resolve/describe/decide/local/message）');
  };
  return { resolve: fail, describe: fail, decide: fail, local: fail, message: fail };
}

/** 把状态切成本地引擎（预算超限 / 用户点击「本地代走」）。 */
export function describedLocal() {
  return { opponent: 'local', opponentLabel: '本地引擎', opponentProvider: null, opponentModel: null };
}
