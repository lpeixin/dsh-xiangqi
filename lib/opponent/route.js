/**
 * 模型路由解析（§4.4.2 的**七级链**，一级都不许省）。
 *
 * 关键事实：`ctx.agentDefaultModel.currentSelection()` 只是「新会话的部署默认值」，
 * 不是当前会话正在用的模型，所以它必须排在最后。真正的当前会话模型来自
 * `sessionProjections` 的 `pending` 选择或会话已记录的 `request/header`。
 *
 * 每一级都先 `ctx.get()` 判空 / 属性探测，任何一级抛错都静默降级到下一级——
 * 这些服务在极简组合里都可能缺席，绝不能因此让插件失活。
 */

/** effort 兜底阶梯（真实档次优先从 `resolveModelInfo` 读取）。 */
const FALLBACK_EFFORTS = Object.freeze(['minimal', 'low', 'medium', 'high', 'max']);

/** 归一化一条路由；provider/model 必须都是非空字符串。 */
function normalize(candidate, source) {
  if (candidate === null || candidate === undefined) return undefined;
  const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : '';
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
  if (provider === '' || model === '') return undefined;
  const effort = typeof candidate.reasoningEffort === 'string' && candidate.reasoningEffort !== '' ? candidate.reasoningEffort : undefined;
  return effort === undefined ? { provider, model, source } : { provider, model, reasoningEffort: effort, source };
}

function attempt(read) {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * 按 §4.4.2 的七级顺序解析对手模型路由。
 * @param {object} ctx 插件上下文。
 * @param {object} config 归一化配置。
 * @param {object|undefined} agent 会话 Agent（可能缺失）。
 * @returns {{provider:string,model:string,reasoningEffort?:string,source:string}|undefined}
 */
export function resolveRoute(ctx, config, agent) {
  const override = config?.opponent ?? {};
  const levels = [];

  // 1) 插件 Config 显式覆盖（最高优先级）。
  levels.push(() => normalize({ provider: override.provider, model: override.model, reasoningEffort: override.reasoningEffort }, 'config'));

  const session = attempt(() => agent?.session);

  // 2) 待生效的会话模型选择（用户刚切换、尚未发消息时也能读到）。
  levels.push(() => {
    const projections = typeof ctx?.get === 'function' ? ctx.get('sessionProjections') : undefined;
    if (projections === undefined || projections === null || typeof projections.stateOf !== 'function') return undefined;
    if (session === undefined || session === null) return undefined;
    const state = projections.stateOf(session, 'modelSelection');
    return normalize(state?.pending ?? undefined, 'sessionProjections.pending');
  });

  // 3) 最近一次已记录请求的实际路由（适配器默认 effort 必须抹掉）。
  levels.push(() => {
    const header = session?.requestHeader?.();
    if (header === null || header === undefined) return undefined;
    const logged = header.config;
    if (logged === null || logged === undefined) return undefined;
    const effort = header.adapterDefaults?.reasoningEffort === true ? undefined : logged.reasoningEffort;
    return normalize({ provider: logged.provider, model: logged.model, reasoningEffort: effort }, 'requestHeader');
  });

  // 4) 最新已解析的路由元数据。
  levels.push(() => {
    const context = session?.requestContext?.();
    return normalize(context ?? undefined, 'requestContext');
  });

  // 5) 会话创建时带上的选择。
  levels.push(() => normalize(attempt(() => agent?.options), 'agent.options'));

  // 6) 进程级部署默认值（只是兜底，不等于当前会话模型）。
  levels.push(() => {
    const service = typeof ctx?.get === 'function' ? ctx.get('agentDefaultModel') : undefined;
    if (service === undefined || service === null || typeof service.currentSelection !== 'function') return undefined;
    return normalize(service.currentSelection(), 'agentDefaultModel');
  });

  for (const level of levels) {
    const route = attempt(level);
    if (route !== undefined) return route;
  }
  return undefined; // 第 7 级：本地引擎
}

/** 路由的人类可读标签（面板「对手」栏与工具返回使用，FR23/FR24）。 */
export function routeLabel(route) {
  if (route === undefined || route === null) return undefined;
  return `${route.model}（${route.provider}）`;
}

/**
 * 对手的**唯一**描述来源（客户端投影与工具返回共用，避免两套字段两个真相）。
 *
 * `label` 永远是非空字符串：本地引擎、已解析到具体模型、或「当前会话模型」。
 * @param {'model'|'local'} kind 对手类型。
 * @param {object|undefined} route 已解析的路由（可能拿不到，例如无 agent 的 RPC 调用）。
 * @returns {{kind: string, provider: string|null, model: string|null, label: string}}
 */
export function opponentDescriptor(kind, route) {
  if (kind === 'local') return { kind: 'local', provider: null, model: null, label: '本地引擎' };
  const label = routeLabel(route);
  return {
    kind: 'model',
    provider: typeof route?.provider === 'string' ? route.provider : null,
    model: typeof route?.model === 'string' ? route.model : null,
    label: label ?? '当前会话模型',
  };
}

/**
 * 解析模型实际支持的 effort 档次（用于「降一档 effort 重试」）。
 * @returns {Promise<string[]>} 由低到高的档次 id；拿不到时返回兜底阶梯。
 */
export async function effortLadder(ctx, route) {
  const llm = typeof ctx?.get === 'function' ? ctx.get('llm') : undefined;
  if (llm !== undefined && llm !== null && typeof llm.resolveModelInfo === 'function' && route !== undefined) {
    const info = await attemptAsync(() => llm.resolveModelInfo(route.provider, route.model));
    const efforts = info?.reasoning?.efforts;
    if (Array.isArray(efforts) && efforts.length > 0) {
      const ids = efforts.map((entry) => (typeof entry === 'string' ? entry : entry?.id)).filter((id) => typeof id === 'string' && id !== '');
      if (ids.length > 0) return ids;
    }
  }
  return [...FALLBACK_EFFORTS];
}

/** 取比当前低一档的 effort；已在最低档或当前无 effort 时返回 undefined。 */
export function lowerEffort(ladder, current) {
  if (typeof current !== 'string' || current === '') return undefined;
  const index = ladder.indexOf(current);
  if (index <= 0) return undefined;
  return ladder[index - 1];
}

async function attemptAsync(read) {
  try {
    return await read();
  } catch {
    return undefined;
  }
}
