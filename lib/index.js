/**
 * dsh-xiangqi-mate —— 宿主半入口（§6.1 / §6.5 / §6.6 / §7.5.3）。
 *
 * 硬性约束（违反即不可接受）：
 *  1. **只允许命名导出** `name` / `inject` / `Config` / `apply`。绝不 `export default`
 *     ——DSH Loader 的 `unwrapExports` 会折叠模块并丢掉 `inject`。
 *  2. 零外部依赖：只用 `node:*` 内置模块。
 *  3. `name` 必须是 `'xiangqi'`（与 `cordis.patch.yml` 的行 id 一致）。
 *  4. `inject` 只声明唯一硬依赖 `['tools']`；其它服务一律 `ctx.get()` 判空后降级。
 *  5. 绝不 `session.append(...)` 写自定义事件类型。
 *  6. 绝不产生游离异步：所有后台任务登记到插件级 Promise Set，disposer 里 await。
 *  7. 工具返回值必须满足 `output.schema` 且是无损 JSON。
 *  8. `Config` 是手写 StandardSchemaV1，不引入 schemastery。
 */

import { createSurface } from './game/api.js';
import { note } from './game/diagnostics.js';
import { createGameService } from './game/service.js';
import { createOpponentPort } from './opponent/fallback.js';
import { registerSkill } from './skill.js';
import { createToolDefinitions, TOOL_NAMES } from './tools/index.js';

export const name = 'xiangqi';
export const inject = ['tools'];

/** RPC 频道（§7.5.3 通道①；不能是 `/api`）。 */
export const RPC_CHANNEL = '/xiangqi-mate';
/** 备用通道：主通道名被占（重复路由）时使用；客户端按顺序尝试。 */
export const FALLBACK_RPC_CHANNEL = '/xiangqi-mate-b';

const DEFAULTS = Object.freeze({
  opponent: Object.freeze({
    mode: 'model',
    timeoutMs: 20000,
    maxRetries: 2,
    maxTokensPerMove: 256,
    maxTokensPerGame: 20000,
    candidateLimit: 40,
  }),
  local: Object.freeze({ depth: 4, timeMs: 300, randomize: true }),
  rules: Object.freeze({ fiftyMovePlies: 120, perpetualCheckLoses: true, maxPlies: 400 }),
  ui: Object.freeze({ showCoordinates: true, showEval: false, animation: true, clock: 'off' }),
  saveDir: '.xiangqi-mate',
});

const OPTIONAL_STRINGS = Object.freeze(['provider', 'model', 'reasoningEffort']);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 归一化配置：每个键都有默认值兜底（patch 覆盖 `config` 是**整段替换**，不能假设 schema 一定被应用）。
 * @param {unknown} raw 原始配置。
 * @returns {{ value: object, issues: object[] }} 归一化结果。
 */
export function normalizeConfig(raw) {
  const issues = [];
  if (raw !== undefined && raw !== null && !plainObject(raw)) {
    return { value: configValue(DEFAULTS), issues: [{ message: '配置必须是一个对象', path: [] }] };
  }
  const source = plainObject(raw) ? raw : {};
  const out = configValue(DEFAULTS);

  for (const group of ['opponent', 'local', 'rules', 'ui']) {
    const provided = source[group];
    if (provided === undefined || provided === null) continue;
    if (!plainObject(provided)) {
      issues.push({ message: `${group} 必须是一个对象`, path: [group] });
      continue;
    }
    for (const [key, value] of Object.entries(provided)) {
      const optionalString = group === 'opponent' && OPTIONAL_STRINGS.includes(key);
      if (optionalString === false && !(key in out[group])) continue;
      const check = coerce(group, key, value, out[group][key]);
      if (check.error !== undefined) issues.push({ message: check.error, path: [group, key] });
      else if (check.value !== undefined) out[group][key] = check.value;
    }
  }

  if (source.saveDir !== undefined && source.saveDir !== null) {
    if (typeof source.saveDir !== 'string' || source.saveDir.trim() === '') {
      issues.push({ message: 'saveDir 必须是非空字符串', path: ['saveDir'] });
    } else {
      out.saveDir = source.saveDir.trim();
    }
  }
  return { value: out, issues };
}

function configValue(defaults) {
  return {
    opponent: { ...defaults.opponent },
    local: { ...defaults.local },
    rules: { ...defaults.rules },
    ui: { ...defaults.ui },
    saveDir: defaults.saveDir,
  };
}

function coerce(group, key, value, fallback) {
  if (value === undefined || value === null) return {};
  if (OPTIONAL_STRINGS.includes(key) && group === 'opponent') {
    if (typeof value !== 'string') return { error: `${key} 必须是字符串` };
    return { value: value.trim() === '' ? undefined : value.trim() };
  }
  if (typeof fallback === 'boolean') {
    return typeof value === 'boolean' ? { value } : { error: `${key} 必须是布尔值` };
  }
  if (typeof fallback === 'string') {
    if (typeof value !== 'string') return { error: `${key} 必须是字符串` };
    if (key === 'mode' && !['model', 'local'].includes(value)) return { error: 'mode 只能是 model / local' };
    if (key === 'clock' && !['off', 'perMove', 'total'].includes(value)) return { error: 'clock 只能是 off / perMove / total' };
    return { value };
  }
  // 数值键
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `${key} 必须是有限数字` };
  const bounds = {
    timeoutMs: [1000, 600000],
    maxRetries: [0, 5],
    maxTokensPerMove: [16, 32768],
    maxTokensPerGame: [0, 10000000],
    candidateLimit: [1, 200],
    depth: [1, 8],
    timeMs: [0, 60000],
    fiftyMovePlies: [10, 1000],
    maxPlies: [10, 2000],
  }[key];
  if (bounds !== undefined && (value < bounds[0] || value > bounds[1])) {
    return { error: `${key} 必须在 ${bounds[0]}–${bounds[1]} 之间` };
  }
  return { value };
}

/**
 * 手写 StandardSchemaV1（§6.5；**不引入 schemastery/zod**）。
 * Cordis 的 `resolveConfig` 会同步调用 `validate`，因此这里必须同步且不抛。
 */
export const Config = Object.freeze({
  '~standard': Object.freeze({
    version: 1,
    vendor: 'dsh-xiangqi-mate',
    validate(value) {
      const result = normalizeConfig(value);
      if (result.issues.length > 0) return { issues: result.issues };
      return { value: result.value };
    },
  }),
});

/**
 * 插件装配。
 * @param {object} ctx Cordis 上下文（只有 `tools` 是硬依赖）。
 * @param {object} rawConfig Loader 校验后的配置。
 * @returns {() => Promise<void>} 幂等的逆序 disposer。
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig).value;
  const disposers = [];
  const inflight = new Set();
  let disposed = false;

  const logger = ctx?.logger;

  /** 登记后台任务：绝不让 rejection 逃逸（游离 rejection 会 dispose 整个 DSH）。 */
  function track(promise) {
    const guarded = Promise.resolve(promise).catch((error) => {
      try {
        logger?.warn?.('[xiangqi] 后台任务失败', error);
      } catch {
        /* 忽略 */
      }
    });
    inflight.add(guarded);
    guarded.then(() => inflight.delete(guarded), () => inflight.delete(guarded));
    return guarded;
  }

  function push(label, dispose) {
    if (typeof dispose !== 'function') return;
    disposers.push({ label, dispose });
  }

  // 对手端口：游戏层不认识 opponent 层，由入口注入（§6.1 的分层方向）。
  const service = createGameService({ ctx, config, track, opponent: createOpponentPort(ctx, config) });
  const surface = createSurface({ service, config });

  // ---- 工具（§6.2）----
  const tools = ctx?.tools ?? ctx?.get?.('tools');
  if (tools !== undefined && tools !== null && typeof tools.register === 'function') {
    for (const definition of createToolDefinitions({ service, config })) {
      try {
        // 执行前先做一次 RPC 补偿注册（见 ensureRpc）。工具是唯一"必然到达宿主"的入口，
        // 因此它是自愈的最佳时机；包一层不影响工具契约本身。
        const wrapped = { ...definition, execute: (args, exec) => { ensureRpc(); return definition.execute(args, exec); } };
        push(`tool:${definition.name}`, tools.register(wrapped));
      } catch (error) {
        logger?.warn?.(`[xiangqi] 注册工具 ${definition.name} 失败`, error);
      }
    }
  }

  // ---- 会话命令（§6.6 / §7.5.2）----
  //
  // 与 RPC 同理：用 `ctx.inject` 等 `commands` 就绪（见下面 whenService 的注释）。
  whenService(ctx, 'commands', (scoped) => {
    const commands = scoped?.get?.('commands');
    if (commands === undefined || commands === null || typeof commands.register !== 'function') return undefined;
    try {
      push('command:xiangqi', commands.register({
        name: 'xiangqi',
        description: '中国象棋：新对局 / 查看局面 / 落子 / 悔棋 / 提示 / 认输 / 复盘',
        input: { hint: 'new | state | move <着法> | undo | hint | resign | review | export' },
        handler: async (invocation) => {
          try {
            const result = await surface.handleCommand(invocation?.rawInput, invocation?.agent);
            if (result.ok !== true) return { kind: 'error', text: result.reasonZh ?? '象棋操作失败' };
            return { kind: 'success', text: JSON.stringify(result.snapshot) };
          } catch (error) {
            return { kind: 'error', text: `象棋操作失败：${error instanceof Error ? error.message : String(error)}` };
          }
        },
      }));
    } catch (error) {
      logger?.warn?.('[xiangqi] 注册命令失败', error);
    }
    return undefined;
  });

  // ---- 跨半 RPC（§7.5.3 通道①）----
  const handler = async (endpoint, payload) => {
    try {
      const denial = admitSession(ctx, payload);
      if (denial !== undefined) return { ok: false, error: denial };
      return await surface.handleRpc(endpoint, payload);
    } catch (error) {
      return {
        ok: false,
        error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error), details: {} },
      };
    }
  };
  let rpcAttached = false;
  /** 把 RPC 通道挂到（当时可见的）connection 服务上；已挂上则跳过。 */
  const attachRpc = (scoped) => {
    if (rpcAttached === true) return undefined;
    const connection = typeof scoped?.get === 'function' ? scoped.get('connection') : undefined;
    if (connection === undefined || connection === null || connection.rpc === undefined || typeof connection.rpc.handle !== 'function') {
      note('attachRpc: connection 不可见或 rpc.handle 缺失');
      return undefined;
    }
    note(`attachRpc: connection 可见，handle=${typeof connection.rpc.handle}`);
    // 备用通道：webServer.register 只在**重复 (kind, path)** 时抛错，若主通道名被占，
    // 换一个名字仍能挂上（客户端会按顺序尝试）。
    for (const channel of [RPC_CHANNEL, FALLBACK_RPC_CHANNEL]) {
      try {
        // connection.rpc.handle 的 effect 挂在 connection 服务自己的 fiber 上，
        // **不会**随本插件卸载释放，所以必须自己收集 disposer。
        const dispose = connection.rpc.handle(channel, handler);
        push('rpc', dispose);
        rpcAttached = true;
        note(`handle ${channel} 成功`);
        return dispose;
      } catch (error) {
        note(`handle ${channel} 抛错：`, error);
      }
    }
    logger?.warn?.('[xiangqi] 注册跨半 RPC 失败：所有候选通道都不可用');
    return undefined;
  };

  // 路径 1：等 connection 就绪（apply 时可能还没提供——它是 web 组合里的另一行，且自己要等 webRuntime）。
  whenService(ctx, 'connection', attachRpc);

  // 路径 2：服务提供事件。`ctx.inject` 是规范做法，但真机上观察到了"inject 回调始终不触发"，
  // 而 Cordis 在服务 provide 时会广播 `internal/service`——多一条不依赖 inject 的启动期路径，
  // 就是为了让「面板永久 405」不再依赖单一机制。
  try {
    ctx.on?.('internal/service', (name) => {
      if (name === 'connection') {
        note('internal/service 事件触发 connection');
        attachRpc(ctx);
      }
    });
  } catch (error) {
    note('internal/service 监听失败：', error);
  }

  /**
   * 惰性补偿：**工具调用一定能到达宿主**，所以那一刻 `connection` 必然已经在位。
   * 如果主路径因为任何原因（服务晚到、inject 未触发、启动期竞态）没挂上通道，
   * 这里再补一次——把「面板永久 405」这种不可恢复的失败，降级成「第一次调用工具后自愈」。
   */
  const ensureRpc = () => {
    if (rpcAttached === true) return;
    note('ensureRpc: 主路径未挂上，补偿注册');
    attachRpc(ctx);
  };

  // ---- 技能（FR18；失败静默，绝不拖垮工具注册）----
  whenService(ctx, 'skills', (scoped) => {
    try {
      push('skill', registerSkill(scoped));
    } catch (error) {
      logger?.warn?.('[xiangqi] 注册技能失败', error);
    }
    return undefined;
  });

  return async function dispose() {
    if (disposed === true) return;
    disposed = true;
    // 顺序很重要：
    //  1) 先 abort 在飞请求并关闭存储；
    //  2) 再 await 全部托管任务结束（技能注册也在其中，它可能还没 push disposer）；
    //  3) 最后**逆序**释放注册（工具 → 命令 → RPC → 技能）。
    try {
      await service.dispose();
    } catch (error) {
      logger?.warn?.('[xiangqi] 释放对局服务失败', error);
    }
    await Promise.allSettled([...inflight]);
    inflight.clear();
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      const entry = disposers[index];
      try {
        await entry.dispose();
      } catch (error) {
        try {
          logger?.warn?.(`[xiangqi] 释放 ${entry.label} 失败`, error);
        } catch {
          /* 忽略 */
        }
      }
    }
    disposers.length = 0;
  };
}

/**
 * 等一个可选服务就绪后再执行 `attach`，而不是在 `apply()` 时 `ctx.get()` 取一次。
 *
 * **这是本插件踩过的一个真实坑**：`connection` / `commands` / `skills` 都由别的插件行提供，
 * 可能在本插件激活**之后**才就绪。Cordis 的 `ctx.get()` 不等待，那一刻拿到 `undefined`，
 * 注册就被**永久静默跳过**：工具照常注册（于是"插件看起来是好的"），但浏览器半连不上——
 * 面板显示 `与宿主通信失败：transport failure for /xiangqi-mate/state: HTTP 405`。
 *
 * 假 ctx 测试之所以发现不了它，是因为它们**同步**提供了这些服务；因此测试脚手架也必须
 * 忠实模拟 `ctx.inject` 的等待语义（见 `test/helpers/fake-ctx.mjs`）。
 *
 * @param {object} ctx 插件上下文。
 * @param {string} serviceName 服务名。
 * @param {(scoped: object) => unknown} attach 服务就绪时的注册逻辑，可返回 disposer。
 */
function whenService(ctx, serviceName, attach) {
  note(`whenService ${serviceName}: inject=${typeof ctx?.inject === 'function'}`);
  if (typeof ctx?.inject === 'function') {
    // 服务就绪时回调；服务消失后收起、再出现时重新回调（回调可能被多次调用，
    // 每次都 push 一个新的幂等 disposer，旧的成为 no-op）。
    ctx.inject([serviceName], (scoped) => {
      note(`inject 回调触发 ${serviceName}`);
      return attach(scoped);
    });
    return;
  }
  // 极简 ctx（部分测试替身）没有 inject：退化成直接尝试一次，行为与旧实现一致。
  note(`whenService ${serviceName}: 无 inject，直接尝试一次`);
  attach(ctx);
}

/** RPC 的会话归属校验：`connection.rpc` 面向任何已鉴权页面，必须只服务真实会话。 */
function admitSession(ctx, payload) {
  const sessionId = payload?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return { code: 'BAD_SESSION', message: 'sessionId 必须是非空字符串', details: {} };
  }
  const agents = ctx?.get?.('agents');
  if (agents === undefined || agents === null || typeof agents.get !== 'function') return undefined;
  try {
    if (agents.get(sessionId) !== undefined) return undefined;
    if (typeof agents.list === 'function' && agents.list().length === 0) return undefined;
  } catch {
    return undefined;
  }
  return { code: 'UNKNOWN_SESSION', message: '该会话当前不在本进程中，无法读写棋局', details: { sessionId } };
}

export { TOOL_NAMES };
