/**
 * 跨半 RPC 的宿主侧传输（§7.5.3 通道①）。
 *
 * ⚠️ **改动前请先读完这段，它是整轮真机排障的结论：**
 *
 * 1) **不能用 `connection.rpc.handle(channel, handler)`。**
 *    它内部是
 *      `register(owner, channel, handler) { return owner.effect(() => owner.webServer.register(route), …) }`
 *    而 `owner = this.ctx` 是 **connection 插件自己的上下文**，那个上下文并没有
 *    `inject: ['webServer']`。Cordis 的服务属性访问受 `inject` 约束，于是它对**任何**调用方都抛：
 *      `Error: cannot get property "webServer" without inject`
 *    ——也就是说这个 API 在当前 DSH 构建里对第三方插件**完全不可用**。
 *    （对照：connection 自己注册 `/api` 路由时用的是
 *     `ctx.inject(['webServer'], (webCtx) => webCtx.effect(() => webCtx.webServer.register(route)))`，
 *     那条路才成立。）
 *
 * 2) **也不能用 `connection.rpc.intercept('/api', …)`。** `/api` 的拦截器席位是**单一**的，
 *    已被 `@deepseek-ai/dsh-api-gateway` 占据，再注册会抛 `already has an interceptor`。
 *
 * 3) 因此走平台里**确实能工作**的那条：照 connection 自己的写法，在一个
 *    `inject: ['webServer']` 的 fiber 里注册自己的前缀路由，并用文档化的
 *    `connection.admit(request)` 承担 Host/Origin 围栏与浏览器鉴权
 *    （契约原文：*Apply Connection's Host/Origin checks and browser authentication to another Web route.*）。
 *
 * 协议刻意保持极小，便于两端自持：
 *   请求  `POST <channel>/<endpoint>`，`content-type: application/json`，**请求体就是 payload**
 *   响应  `{ ok: true, value }` / `{ ok: false, error }`
 */

/** 通道名必须匹配 `/^\/[A-Za-z0-9._~-]+$/` 且不能是保留的 `/api`。 */
export const RPC_CHANNEL = '/xiangqi-mate';

/** 备用通道：`webServer.register` 只在**重复 (kind, path)** 时抛错，主名被占时换它。 */
export const FALLBACK_RPC_CHANNEL = '/xiangqi-mate-b';

/** 端点名允许的字符（与 connection 的 `ENDPOINT_SEGMENT_PATTERN` 一致）。 */
const ENDPOINT_PATTERN = /^[A-Za-z0-9_$.-]+$/;

/** 请求体上限：本插件的 payload 都是小对象。 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * 读请求体并解析 JSON。
 * @param {object} req Node 请求对象。
 * @returns {Promise<unknown>} 解析后的 JSON。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('rpc body too large');
        error.code = 'TOO_LARGE';
        reject(error);
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

/**
 * 处理一条 RPC 请求。
 * @param {object} connection connection 服务（必须提供 `admit`）。
 * @param {string} channel 本路由挂载的前缀。
 * @param {object} req 请求。
 * @param {object} res 响应。
 * @param {(endpoint: string, payload: unknown) => Promise<object>} dispatch 业务分发（内部还会校验会话归属）。
 */
export async function serveRpc(connection, channel, req, res, dispatch) {
  // 第一道：Host/Origin 围栏 + 浏览器鉴权。必须走 connection，不要自己判断。
  const admission = connection.admit(req);
  if (admission !== null && typeof admission === 'object' && admission.rejection !== undefined) {
    res.writeHead(admission.rejection);
    res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden');
    return;
  }
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const endpoint = pathname.startsWith(`${channel}/`) ? pathname.slice(channel.length + 1) : '';
  if (req.method !== 'POST' || endpoint === '' || !ENDPOINT_PATTERN.test(endpoint)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  if (String(req.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    res.writeHead(415);
    res.end('content type must be application/json');
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    res.writeHead(error?.code === 'TOO_LARGE' ? 413 : 400);
    res.end('body is not JSON');
    return;
  }
  // 信封与 connection 完全一致，这样客户端可以用既有的 `ctx.connection.rpc.call`，
  // 完全不必知道宿主换了注册方式：
  //   请求  `{ type: 'client-request', rpcId, method, payload }`
  //   响应  `{ type: 'server-response', rpcId, result: { ok, value } | { ok, error } }`
  // 同时容忍裸 payload（便于用手写请求或脚本直接打）。
  const envelope = body !== null && typeof body === 'object' && body.type === 'client-request' ? body : null;
  if (envelope !== null) {
    if (envelope.method !== endpoint) {
      res.writeHead(400);
      res.end('method does not match endpoint');
      return;
    }
  }
  const payload = envelope !== null ? envelope.payload : body;
  const result = normalizeResult(await dispatch(endpoint, payload));
  const reply = envelope === null
    ? result
    : { type: 'server-response', rpcId: typeof envelope.rpcId === 'string' ? envelope.rpcId : 'unknown', result };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(reply));
}

/**
 * 归一化业务结果，保证符合 `serverResponseSchema`：
 * `{ ok: true, value }` 或 `{ ok: false, error: { code, message, details } }`
 * （`details` 必须是对象，否则客户端解析会抛 invalid server-response failure）。
 *
 * @param {unknown} result 业务返回。
 * @returns {object} 归一化后的结果。
 */
function normalizeResult(result) {
  if (result !== null && typeof result === 'object' && result.ok === true) {
    return { ok: true, value: result.value === undefined ? null : result.value };
  }
  const error = result !== null && typeof result === 'object' && result.error !== null && typeof result.error === 'object' ? result.error : {};
  return {
    ok: false,
    error: {
      code: typeof error.code === 'string' ? error.code : 'INTERNAL',
      message: typeof error.message === 'string' ? error.message : 'xiangqi: unknown failure',
      details: error.details !== null && typeof error.details === 'object' ? error.details : {},
    },
  };
}

/**
 * 建立「把 RPC 路由挂上」的能力，带多条独立触发路径。
 *
 * @param {object} options
 * @param {object} options.ctx 插件上下文。
 * @param {(label: string, dispose: unknown) => void} [options.push] 收集 disposer（保证确定性释放）。
 * @param {(stage: string, detail?: unknown) => void} options.note 自检记录。
 * @param {(endpoint: string, payload: unknown) => Promise<object>} options.dispatch 业务分发。
 * @param {object} [options.logger]
 * @returns {{ arm: () => void, ensure: () => void, attached: () => boolean }}
 */
export function createRpcAttacher({ ctx, push, note, dispatch, logger }) {
  let attached = false;
  let arming = false;

  const attach = (scoped) => {
    if (attached === true) return undefined;
    const connection = typeof scoped?.get === 'function' ? scoped.get('connection') : undefined;
    const webServer = typeof scoped?.get === 'function' ? scoped.get('webServer') : undefined;
    if (connection === undefined || connection === null || typeof connection.admit !== 'function') {
      note('attach: connection 不可见或缺少 admit');
      return undefined;
    }
    if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
      note('attach: webServer 不可见或缺少 register');
      return undefined;
    }
    for (const channel of [RPC_CHANNEL, FALLBACK_RPC_CHANNEL]) {
      const route = { kind: 'prefix', path: channel, handler: (req, res) => serveRpc(connection, channel, req, res, dispatch) };
      try {
        // 用 `scoped.effect` 注册：它的 disposer 挂在**我们这个子 fiber** 上，
        // 会随插件卸载一起释放，所以不需要再手动收集一份（重复释放虽幂等，但会让
        // 释放顺序的断言变得难以阅读）。
        const dispose = scoped.effect(() => webServer.register(route), `xiangqi-mate: ${channel} route`);
        // 除了交给 fiber 拥有，还**显式收集**一份：这样插件 dispose() 时会确定性地摘掉路由，
        // 不必依赖 Cordis 释放子 fiber 的时机（重复释放是幂等的）。
        if (typeof push === 'function') push(`rpc:${channel}`, dispose);
        attached = true;
        note(`自建路由注册成功 ${channel}`);
        return dispose;
      } catch (error) {
        note(`自建路由 ${channel} 抛错：`, error);
      }
    }
    logger?.warn?.('[xiangqi] 注册跨半 RPC 失败：候选通道都不可用');
    return undefined;
  };

  /** 在 `inject: ['connection', 'webServer']` 的 fiber 里注册——缺任一个都会等它就绪。 */
  const arm = () => {
    if (attached === true || arming === true) return;
    if (typeof ctx?.inject !== 'function') {
      note('arm: ctx 没有 inject，直接尝试');
      attach(ctx);
      return;
    }
    arming = true;
    note('arm: 以 inject:[connection, webServer] 等待');
    ctx.inject(['connection', 'webServer'], (scoped) => {
      arming = false;
      note('inject 回调触发 connection+webServer');
      return attach(scoped);
    });
  };

  return {
    arm,
    /** 惰性补偿：工具调用一定能到达宿主，那时服务必然都已就绪。 */
    ensure: () => {
      if (attached === true) return;
      note('ensure: 主路径未挂上，补偿注册');
      arm();
    },
    attached: () => attached,
  };
}
