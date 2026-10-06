import { EventEmitter } from 'node:events';

/**
 * 假 ctx：驱动 `apply(ctx, config)` 所需的最小 Cordis 上下文（§9.1「集成测试（无需 DSH）」）。
 *
 * 提供：`get` / `effect` / `on` / `logger` / `timer`，以及可选的 `tools` / `commands` /
 * `skills` / `connection` 服务。每个注册都会记录 disposer，并记录**释放顺序**，
 * 用于断言「逆序释放且幂等」。
 */

/**
 * 伪请求：`readBody` 会同步注册 `data`/`end`，所以这里在微任务里派发，行为与 Node 一致。
 */
class FakeRequest extends EventEmitter {
  constructor(url, method, headers, body) {
    super();
    this.url = url;
    this.method = method;
    this.headers = headers;
    const payload = body === undefined || body === null ? '' : String(body);
    queueMicrotask(() => {
      if (payload !== '') this.emit('data', Buffer.from(payload, 'utf8'));
      this.emit('end');
    });
  }

  destroy() {}
}

/** 伪响应：只记 status/headers/body。 */
class FakeResponse {
  constructor() {
    this.status = 200;
    this.headers = {};
    this.body = '';
  }

  writeHead(status, headers) {
    this.status = status;
    if (headers !== undefined) this.headers = headers;
  }

  end(body) {
    this.body = body === undefined || body === null ? '' : String(body);
  }
}

/**
 * 把一条前缀路由折成 `(endpoint, payload) → 业务结果` 的可调用对象。
 *
 * 关键在于它**真的走一遍 HTTP 处理代码**（`connection.admit` 鉴权、content-type 校验、
 * 端点解析、JSON 编解码），而不是绕过去直接调业务函数——否则传输层的缺陷在测试里看不见。
 */
export function makeRouteCaller(route) {
  return async (endpoint, payload) => {
    // 发**真实**的信封（与 lib/client.js 里 connection 的客户端一致），
    // 这样测试覆盖到信封的解析与归一化，而不只是业务函数。
    const body = JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method: endpoint, payload });
    const req = new FakeRequest(`${route.path}/${endpoint}`, 'POST', { 'content-type': 'application/json' }, body);
    const res = new FakeResponse();
    await route.handler(req, res);
    if (res.status !== 200) return { ok: false, error: { code: `rpc/http-${res.status}`, message: res.body, details: {} } };
    let envelope;
    try {
      envelope = JSON.parse(res.body);
    } catch {
      return { ok: false, error: { code: 'rpc/malformed', message: 'invalid JSON response', details: {} } };
    }
    if (envelope === null || typeof envelope !== 'object' || envelope.type !== 'server-response') {
      return { ok: false, error: { code: 'rpc/malformed', message: 'invalid server-response envelope', details: {} } };
    }
    return envelope.result;
  };
}

/** 建立一个可观测的伪服务注册表。 */
export function createFakeCtx(options = {}) {
  const services = { ...(options.services ?? {}) };
  const disposalOrder = [];
  const registrations = { tools: new Map(), commands: new Map(), skills: new Map(), rpc: new Map(), routes: new Map(), effects: [] };
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
    // 只模拟**真实可用**的那部分：`admit`（Host/Origin + 浏览器鉴权）。
    // 刻意**不提供** `rpc.handle`——它在真实 DSH 里对任何调用方都抛
    // `cannot get property "webServer" without inject`，因此假 ctx 也不该给它留位置：
    // 如果将来有人把实现改回 `handle`，这里会立刻报错，而不是让测试假绿。
    services.connection = {
      admit: () => ({ peer: {} }),
      requestRejection: () => undefined,
    };
  }
  if (services.webServer === undefined && options.webServer !== false) {
    services.webServer = {
      register(route) {
        if (registrations.routes.has(route.path)) {
          throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
        }
        registrations.routes.set(route.path, route);
        // 把前缀路由折成一个「(endpoint, payload) → 结果」的可调用对象，
        // 这样测试用的是**真实的 HTTP 处理代码**（鉴权、信封、端点解析都跑到），
        // 而不是绕过它直接调业务函数。
        registrations.rpc.set(route.path, makeRouteCaller(route));
        return async () => {
          registrations.routes.delete(route.path);
          registrations.rpc.delete(route.path);
          disposalOrder.push(`rpc:${route.path}`);
        };
      },
    };
  }

  /** 等待依赖就绪的 `inject` 回调（见下面 `inject` 的注释）。 */
  const waiters = [];
  /** 事件监听表（`on` / `emit`）。 */
  const listeners = new Map();

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
    /**
     * 记录事件监听并返回退订函数；`emit()` 用来在测试里模拟 Cordis 广播
     * （例如服务 provide 时的 `internal/service`）。
     */
    on(name, listener) {
      const list = listeners.get(name) ?? [];
      list.push(listener);
      listeners.set(name, list);
      return () => {
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      };
    },
    emit(name, ...args) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(...args);
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
