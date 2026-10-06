/**
 * 假 ctx：驱动 `apply(ctx, config)` 所需的最小 Cordis 上下文（§9.1「集成测试（无需 DSH）」）。
 *
 * 提供：`get` / `effect` / `on` / `logger` / `timer`，以及可选的 `tools` / `commands` /
 * `skills` / `connection` 服务。每个注册都会记录 disposer，并记录**释放顺序**，
 * 用于断言「逆序释放且幂等」。
 */

/** 建立一个可观测的伪服务注册表。 */
export function createFakeCtx(options = {}) {
  const services = { ...(options.services ?? {}) };
  const disposalOrder = [];
  const registrations = { tools: new Map(), commands: new Map(), skills: new Map(), rpc: new Map(), effects: [] };
  const logs = [];
  const activeDisposers = [];

  const logger = {
    debug: (...args) => logs.push(['debug', args]),
    info: (...args) => logs.push(['info', args]),
    warn: (...args) => logs.push(['warn', args]),
    error: (...args) => logs.push(['error', args]),
  };

  if (services.tools === undefined && options.tools !== false) {
    services.tools = {
      register(definition) {
        registrations.tools.set(definition.name, definition);
        return () => {
          registrations.tools.delete(definition.name);
          disposalOrder.push(`tool:${definition.name}`);
        };
      },
      get: (name) => registrations.tools.get(name),
      schemas: () => [...registrations.tools.values()].map(({ name, description, parameters }) => ({ name, description, parameters })),
    };
  }
  if (services.commands === undefined && options.commands !== false) {
    services.commands = {
      register(definition) {
        registrations.commands.set(definition.name, definition);
        return () => {
          registrations.commands.delete(definition.name);
          disposalOrder.push(`command:${definition.name}`);
        };
      },
    };
  }
  if (services.skills === undefined && options.skills !== false) {
    services.skills = {
      register(definition) {
        registrations.skills.set(definition.name, definition);
        return () => {
          registrations.skills.delete(definition.name);
          disposalOrder.push(`skill:${definition.name}`);
        };
      },
    };
  }
  if (services.connection === undefined && options.connection !== false) {
    services.connection = {
      rpc: {
        handle(channel, handler) {
          registrations.rpc.set(channel, handler);
          return async () => {
            registrations.rpc.delete(channel);
            disposalOrder.push(`rpc:${channel}`);
          };
        },
      },
    };
  }

  /** 等待依赖就绪的 `inject` 回调（见下面 `inject` 的注释）。 */
  const waiters = [];

  /** 让一个服务「上线」，并触发依赖已满足的等待者（模拟 Cordis 的服务 provide）。 */
  const provide = (key, value) => {
    services[key] = value;
    for (const entry of [...waiters]) {
      if (entry.list.every((name) => services[name] !== undefined)) {
        waiters.splice(waiters.indexOf(entry), 1);
        entry.callback(ctx);
      }
    }
  };

  const ctx = {
    services,
    registrations,
    logs,
    disposalOrder,
    provide,
    get(key) {
      return services[key];
    },
    set(key, value) {
      provide(key, value);
    },
    /**
     * 忠实模拟 Cordis 的 `ctx.inject(keys, callback)`：
     *  - 依赖**已满足** → 立即同步回调；
     *  - 未满足 → 记下来，等 `set()` / `provide()` 让服务就绪时再回调。
     *
     * 这条语义必须模拟对，否则测试**结构上**发现不了一类真实故障：在 `apply()` 时用
     * `ctx.get()` 取一次服务，服务晚到就永久漏掉注册——真机表现为浏览器半连不上
     * （`transport failure … HTTP 405`），而所有假 ctx 测试仍然全绿。
     */
    inject(keys, callback) {
      const list = Array.isArray(keys) ? keys : [keys];
      const entry = { list, callback };
      waiters.push(entry);
      if (list.every((name) => services[name] !== undefined)) {
        waiters.splice(waiters.indexOf(entry), 1);
        callback(ctx);
      }
      return () => {
        const index = waiters.indexOf(entry);
        if (index >= 0) waiters.splice(index, 1);
      };
    },
    on() {
      return () => {};
    },
    effect(callback, label) {
      const returned = callback();
      const dispose = typeof returned === 'function' ? returned : () => {};
      const entry = { label, dispose, done: false };
      activeDisposers.push(entry);
      const disposer = () => {
        if (entry.done) return;
        entry.done = true;
        disposalOrder.push(`effect:${label ?? 'anonymous'}`);
        return dispose();
      };
      return disposer;
    },
    logger,
    timer: {
      timeout(callback, delay) {
        const handle = setTimeout(callback, delay);
        return () => clearTimeout(handle);
      },
      interval(callback, delay) {
        const handle = setInterval(callback, delay);
        return () => clearInterval(handle);
      },
    },
  };
  ctx.ctx = ctx;
  return ctx;
}

/** 造一个够用的 Agent 桩（`id` / `session.header` / 可选路由来源）。 */
export function makeAgent({ id = 'session-1', cwd = '/tmp/xiangqi-work', ...rest } = {}) {
  const session = {
    header: { id, cwd },
    requestHeader: typeof rest.requestHeader === 'function' ? rest.requestHeader : () => rest.header,
    requestContext: typeof rest.requestContext === 'function' ? rest.requestContext : () => rest.context,
  };
  return { id, session, options: rest.options ?? {} };
}

/** 工具执行上下文（`ToolRunContext` 的最小子集）。 */
export function makeExec(agent, extra = {}) {
  return { callId: 'call-1', name: 'test', arguments: {}, agent, signal: new AbortController().signal, ...extra };
}

/** 等待所有已被 `track()` 托管的后台任务收敛（轮询微任务 + 定时器）。 */
export async function settle(times = 12) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
