/**
 * 对手决策编排 + 本地引擎兜底（FR17 / §4.4.4）。
 *
 * 一次应招的流程（§4.4.3）：
 *   冻结候选 → 解析路由 → 请求模型（含自建重试）→ 解析着法
 *   → 失败/超时 → 本地 alpha-beta 代走 → 交给调用方做 revision 栅栏与落子。
 *
 * 本模块**不落子**、不写状态；提交由 `lib/game/service.js` 在同一处完成（revision 栅栏）。
 */

import { requestOpponentMove } from './llm.js';
import { opponentDescriptor, resolveRoute } from './route.js';

/**
 * 建立注入给对局层的**对手端口**（§6.1：分层方向是 opponent → game，游戏层不 import 对手层）。
 * @param {object} ctx 插件上下文。
 * @param {object} config 归一化配置。
 * @returns {{resolve: Function, describe: Function, decide: Function, local: Function, message: Function}}
 */
export function createOpponentPort(ctx, config) {
  return {
    resolve: (agent) => resolveRoute(ctx, config, agent),
    describe: (kind, route) => opponentDescriptor(kind, route),
    decide: (options) => decideOpponentMove(options),
    local: (engine, position, cfg, seed) => localDecision(engine, position, cfg, seed),
    message: (code, detail) => messageOf(code, detail),
  };
}

/** 状态条消息字典（`message.code` 由客户端本地化；这里给中文兜底）。 */
export const MESSAGES = Object.freeze({
  'ai.thinking': { tone: 'info', zh: 'AI 思考中…' },
  'ai.moved': { tone: 'info', zh: '对手已走子' },
  'ai.fallback.local': { tone: 'warn', zh: '模型不可用，已由本地引擎代走' },
  'ai.timeout': { tone: 'warn', zh: '模型超时，已由本地引擎代走' },
  'ai.unavailable': { tone: 'error', zh: '模型不可用（未配置或凭据缺失），已由本地引擎代走' },
  'ai.quota': { tone: 'warn', zh: '模型限流或额度用尽，已由本地引擎代走' },
  'ai.protocol': { tone: 'warn', zh: '模型给出的着法不合法，已由本地引擎代走' },
  'ai.budget': { tone: 'warn', zh: '本局模型 token 用量已达上限，后续由本地引擎接手' },
  'ai.engine-missing': { tone: 'error', zh: '象棋引擎不可用，无法走子' },
  'game.finished': { tone: 'info', zh: '对局已结束' },
});

/** 生成一条状态条消息。 */
export function messageOf(code, detail) {
  const entry = MESSAGES[code] ?? { tone: 'warn', zh: code };
  return detail === undefined || detail === '' ? { code, tone: entry.tone } : { code, tone: entry.tone, textZh: `${entry.zh}：${detail}` };
}

/** 状态条消息的中文文本（工具/命令返回用）。 */
export function messageText(message) {
  if (message === null || message === undefined) return '';
  const entry = MESSAGES[message.code];
  const base = entry?.zh ?? message.code;
  return message.textZh === undefined ? base : message.textZh;
}

/** 冻结本回合的合法着法目录（模型只能从中选择）。 */
export function freezeCandidates(engine, position, limit = 40) {
  let catalog = [];
  try {
    catalog = engine.legalMoveCatalog(position);
  } catch {
    catalog = [];
  }
  if (!Array.isArray(catalog)) return [];
  return catalog.slice(0, Math.max(1, limit)).map((entry) => ({
    iccs: String(entry?.iccs ?? ''),
    zh: String(entry?.zh ?? ''),
    capture: typeof entry?.capture === 'string' ? entry.capture : '',
  })).filter((entry) => entry.iccs !== '');
}

/**
 * 本地引擎代走（提示与兜底共用）。
 * @returns {{ move: object, iccs: string, zh: string, source: 'local', score: number, depth: number, nodes: number }}
 */
export function localDecision(engine, position, config, seed) {
  const depth = numberOr(config?.local?.depth, 4);
  const timeMs = numberOr(config?.local?.timeMs, 300);
  const randomize = config?.local?.randomize !== false;
  const result = engine.searchBestMove(position, {
    depth,
    timeMs,
    seed: randomize ? (Number.isFinite(seed) ? seed : Math.floor(Math.random() * 1e9)) : 0,
  });
  const move = result?.move ?? { from: -1, to: -1 };
  return {
    move,
    iccs: safeText(() => engine.moveToIccs(move), ''),
    zh: safeText(() => engine.formatChinese(position, move), ''),
    source: 'local',
    score: numberOr(result?.score, 0),
    depth: numberOr(result?.depth, depth),
    nodes: numberOr(result?.nodes, 0),
  };
}

/**
 * 决定一步对手着法。
 * @param {object} options 决策选项。
 * @returns {Promise<object>} `{ ok, decision?, candidates, message, reasonZh, source }`。
 */
export async function decideOpponentMove(options) {
  const { ctx, config, agent, engine, state, signal, onUsage, logger } = options;
  const position = state.position;
  const candidates = freezeCandidates(engine, position, numberOr(config?.opponent?.candidateLimit, 40));
  if (candidates.length === 0) {
    return { ok: false, candidates, source: 'none', message: messageOf('game.finished'), reasonZh: '当前局面没有合法着法' };
  }
  const useLocal = state.opponent === 'local' || config?.opponent?.mode === 'local';
  if (useLocal) {
    return { ok: true, candidates, source: 'local', decision: localDecision(engine, position, config, options.seed) };
  }

  const route = resolveRoute(ctx, config, agent);
  if (route === undefined) {
    return {
      ok: true,
      candidates,
      source: 'local',
      decision: localDecision(engine, position, config, options.seed),
      message: messageOf('ai.fallback.local', '未找到可用的会话模型'),
    };
  }

  const result = await requestOpponentMove({
    ctx,
    config,
    route,
    engine,
    position,
    candidates,
    hero: state.hero,
    lastMove: state.history.length > 0 ? state.history[state.history.length - 1] : null,
    history: state.history,
    signal,
    logger,
    onUsage,
  });

  if (result.ok === true) {
    return {
      ok: true,
      candidates,
      source: 'model',
      route,
      calls: result.calls,
      decision: { ...result.decision, provider: route.provider, model: route.model },
      message: messageOf('ai.moved'),
    };
  }

  if (result.code === 'ai.engine-missing') {
    return { ok: false, candidates, source: 'none', message: messageOf('ai.engine-missing'), reasonZh: result.reasonZh };
  }
  const code = typeof result.code === 'string' && MESSAGES[result.code] !== undefined ? result.code : 'ai.fallback.local';
  return {
    ok: true,
    candidates,
    source: 'local',
    calls: result.calls,
    route,
    decision: localDecision(engine, position, config, options.seed),
    message: messageOf(code, result.reasonZh),
  };
}

function safeText(read, fallback) {
  try {
    const value = read();
    return typeof value === 'string' ? value : fallback;
  } catch {
    return fallback;
  }
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
