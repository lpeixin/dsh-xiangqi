/**
 * 模型调用与**自建重试**（§4.4.3 / §4.4.4）。
 *
 * 两条硬约束（都在这里集中处理，避免各处重复犯错）：
 *  1. 用 `ctx.get('llm')`——`llm` 是可选依赖，硬依赖形式在缺失时会拖垮整棵插件树；
 *  2. 用 `resolveCallConfig` + `stream`，**不要** `prepareCall` + `stream`
 *     （`prepareCall` 会把适配器默认值物化进 config，`stream` 逐字段比对后抛
 *     `INVALID_PREPARED_CALL`，连省略 maxTokens 也会抛）；
 *  3. 直连 `ctx.llm.stream` **没有自动重试**（官方 `dsh-llm-retry` 只挂 `agent/request-error`），
 *     因此退避/降档/回灌全部由下面的循环实现。
 */

import { effortLadder, lowerEffort } from './route.js';
import { buildPacket, buildRetryMessage, MOVE_TOOL_DESCRIPTION, MOVE_TOOL_NAME, MOVE_TOOL_PARAMETERS, SYSTEM_PROMPT, userMessage } from './prompt.js';
import { createChunkCollector, decideFromOutput } from './parse.js';

/** 不可重试、直接降级的错误码。 */
const HARD_FAILURES = new Set(['NO_ADAPTER', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'AUTH', 'ACCOUNT_QUOTA']);
/** 「额度/限流」——按契约**不退避**，直接降级。 */
const QUOTA_FAILURES = new Set(['RATE_LIMIT', 'QUOTA']);
/** 循环上限：即使状态机出错也保证终止。 */
const MAX_ROUNDS = 12;

function errorCode(error) {
  if (error === null || error === undefined) return 'UNKNOWN';
  const direct = typeof error.code === 'string' ? error.code : undefined;
  if (direct !== undefined) return direct;
  const failure = error.failure;
  if (failure !== null && typeof failure === 'object' && typeof failure.code === 'string') return failure.code;
  return 'UNKNOWN';
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '模型调用失败';
}

/** 取该轮请求的 maxTokens（`Config.opponent.maxTokensPerMove`，默认给足）。 */
function moveBudget(config) {
  const value = config?.opponent?.maxTokensPerMove;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 256;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const handle = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(handle);
      resolve();
    }, { once: true });
  });
}

/** 组装一次请求所需的全部可变状态。 */
function createRequestState(options) {
  const { engine, position, candidates, hero, lastMove, history } = options;
  return {
    engine,
    position,
    candidates,
    hero,
    packet: () => buildPacket({ engine, position, side: position.turn, lastMove, history, candidates, compact: false }),
    compactPacket: () => buildPacket({ engine, position, side: position.turn, lastMove, history, candidates, compact: true }),
  };
}

/**
 * 请求一次对手应招（含 §4.4.4 的完整失败矩阵）。
 * @param {object} options 请求选项。
 * @returns {Promise<object>} `{ ok:true, decision, calls }` 或 `{ ok:false, code, reasonZh, calls }`。
 */
export async function requestOpponentMove(options) {
  const { ctx, config, route, signal, logger, onUsage } = options;
  const llm = typeof ctx?.get === 'function' ? ctx.get('llm') : undefined;
  if (llm === undefined || llm === null || typeof llm.stream !== 'function' || typeof llm.resolveCallConfig !== 'function') {
    return { ok: false, code: 'ai.fallback.local', reasonZh: '当前组合没有可用的模型服务（llm 缺失）', calls: 0 };
  }
  const request = createRequestState(options);
  const ladder = await effortLadder(ctx, route);
  const timeoutMs = numberOr(config?.opponent?.timeoutMs, 20000);
  const maxProtocolRetries = Math.max(0, Math.min(5, numberOr(config?.opponent?.maxRetries, 2)));

  let effort = route.reasoningEffort;
  let messages = [userMessage(request.packet())];
  let protocolRetries = 0;
  let transportRetries = 0;
  let effortRetries = 0;
  let contextRetries = 0;
  let calls = 0;
  let last = { code: 'ai.fallback.local', reasonZh: '模型未给出可用着法' };
  const maxTokens = moveBudget(config);

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (signal?.aborted === true) {
      return { ok: false, code: 'ai.timeout', reasonZh: '模型请求已取消', calls };
    }
    const outcome = await streamOnce({
      llm, ctx, route, effort, messages, signal, timeoutMs, maxTokens, request, onUsage, logger,
    });
    calls += 1;
    if (outcome.kind === 'ok') return { ok: true, decision: outcome.decision, calls };

    last = { code: outcome.code, reasonZh: outcome.reasonZh };
    if (outcome.kind === 'protocol') {
      if (protocolRetries >= maxProtocolRetries) return { ok: false, code: 'ai.fallback.local', reasonZh: `模型连续 ${protocolRetries + 1} 次给出非法着法（${outcome.reasonZh}）`, calls };
      protocolRetries += 1;
      messages = messages.concat([userMessage(buildRetryMessage(outcome.reasonZh, request.candidates))]);
      continue;
    }

    const code = outcome.code;
    if (HARD_FAILURES.has(code)) return { ok: false, code: 'ai.unavailable', reasonZh: `模型不可用（${code}）`, calls };
    if (QUOTA_FAILURES.has(code)) return { ok: false, code: 'ai.quota', reasonZh: `模型限流或额度用尽（${code}）`, calls };
    if (code === 'CONTEXT_WINDOW_EXCEEDED') {
      if (contextRetries >= 1) return { ok: false, code: 'ai.fallback.local', reasonZh: '局面描述超出上下文上限，已缩短仍失败', calls };
      contextRetries += 1;
      messages = [userMessage(request.compactPacket())];
      continue;
    }
    if (code === 'UNSUPPORTED_REASONING_EFFORT') {
      if (effortRetries >= 1) return { ok: false, code: 'ai.fallback.local', reasonZh: '模型不支持所请求的推理档位', calls };
      effortRetries += 1;
      effort = undefined;
      continue;
    }
    if (outcome.timedOut === true || code === 'ABORTED' || code === 'TIMEOUT') {
      // 超时/取消一律**不重试**，直接由本地引擎代走。
      return { ok: false, code: 'ai.timeout', reasonZh: `模型超时（>${Math.round(timeoutMs / 1000)} 秒）`, calls };
    }
    if (code === 'MAX_TOKENS' || code === 'EMPTY') {
      const next = lowerEffort(ladder, effort);
      if (effortRetries >= 1 || next === undefined) {
        return { ok: false, code: 'ai.fallback.local', reasonZh: code === 'MAX_TOKENS' ? '模型输出被 maxTokens 截断' : '模型返回空内容', calls };
      }
      effortRetries += 1;
      effort = next;
      continue;
    }
    if (transportRetries >= 1) return { ok: false, code: 'ai.fallback.local', reasonZh: `模型请求失败（${code}）`, calls };
    transportRetries += 1;
    await sleep(400, signal);
  }
  return { ok: false, code: last.code, reasonZh: last.reasonZh, calls };
}

/** 单次请求：resolveCallConfig → stream → 解析。 */
async function streamOnce(context) {
  const { llm, ctx, route, effort, messages, signal, timeoutMs, maxTokens, request, onUsage, logger } = context;
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  if (signal?.aborted === true) return { kind: 'transport', code: 'ABORTED', timedOut: false, reasonZh: '请求已取消' };
  signal?.addEventListener?.('abort', onExternalAbort, { once: true });
  const clearTimer = startTimeout(ctx, timeoutMs, () => {
    timedOut = true;
    controller.abort();
  });
  const collector = createChunkCollector();
  try {
    const callConfig = { provider: route.provider, model: route.model, maxTokens };
    if (effort !== undefined) callConfig.reasoningEffort = effort;
    const resolved = await llm.resolveCallConfig(callConfig, controller.signal);
    const stream = llm.stream({
      ...resolved,
      messages,
      system: SYSTEM_PROMPT,
      tools: [{ name: MOVE_TOOL_NAME, description: MOVE_TOOL_DESCRIPTION, parameters: MOVE_TOOL_PARAMETERS }],
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      collector.push(chunk);
      if (chunk?.type === 'usage' && chunk.usage !== undefined && typeof onUsage === 'function') onUsage(chunk.usage);
    }
  } catch (error) {
    logWarn(logger, '模型调用抛错', error);
    return { kind: 'transport', code: timedOut ? 'TIMEOUT' : errorCode(error), timedOut, reasonZh: errorMessage(error) };
  } finally {
    clearTimer();
    signal?.removeEventListener?.('abort', onExternalAbort);
  }

  const finish = collector.reason;
  const kind = finish?.kind;
  if (kind === 'error') {
    const failure = finish.failure ?? {};
    return { kind: 'transport', code: typeof failure.code === 'string' ? failure.code : 'UNKNOWN', timedOut: false, reasonZh: typeof failure.message === 'string' ? failure.message : '模型返回错误' };
  }
  if (kind === 'aborted') {
    return { kind: 'transport', code: timedOut ? 'TIMEOUT' : 'ABORTED', timedOut, reasonZh: timedOut ? '模型超时' : '模型请求被取消' };
  }

  const decision = decideFromOutput({
    engine: request.engine,
    position: request.position,
    candidates: request.candidates,
    toolCalls: collector.toolCalls,
    text: collector.text,
    hero: request.hero,
  });
  if (decision.ok === true) return { kind: 'ok', decision };
  if (kind === 'max-tokens') return { kind: 'transport', code: 'MAX_TOKENS', timedOut: false, reasonZh: '输出被 maxTokens 截断' };
  if (collector.text.trim() === '' && collector.toolCalls.length === 0) {
    return { kind: 'transport', code: 'EMPTY', timedOut: false, reasonZh: '模型返回空内容' };
  }
  return { kind: 'protocol', code: decision.code, timedOut: false, reasonZh: decision.reasonZh };
}

function startTimeout(ctx, timeoutMs, onTimeout) {
  const timer = typeof ctx?.get === 'function' ? ctx.get('timer') : undefined;
  if (timer !== undefined && timer !== null && typeof timer.timeout === 'function') {
    try {
      return timer.timeout(onTimeout, timeoutMs) ?? (() => {});
    } catch {
      /* 落到裸 setTimeout */
    }
  }
  const handle = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(handle);
}

function logWarn(logger, message, error) {
  try {
    if (typeof logger?.warn === 'function') logger.warn(`[xiangqi] ${message}`, error);
  } catch {
    /* 日志失败不影响对局 */
  }
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
