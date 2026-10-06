/**
 * 通道①：通用 RPC（§7.5.3）。
 *
 * 静态双半插件**没有** `host.call`（那是动态 Cordis 包的能力），客户端到达宿主半只有
 * `ctx.connection.rpc.call(channel, endpoint, payload, signal)` 这一条受支持的通道。
 * 这一层把「传输」与「投影」分开：
 *
 *  - 传输失败（服务缺失、抛异常、HTTP 非 2xx）→ `{ ok: false, error: { code, message } }`；
 *  - 传回来的 `value` 用 `unwrapProjection` 折成投影（认不出就是 `projection: null`）。
 *
 * **绝不抛异常**：调用方不必为每个 await 写 try/catch，也就不会产生游离的 rejection
 * （游离 rejection 会 dispose 整个 DSH，§12.3-T21）。
 */

import { unwrapProjection } from './model.js';

/** 通道名必须匹配 `/^\/[A-Za-z0-9._~-]+$/` 且不能是保留的 `/api`（§7.5.3 约束 2）。 */
export const RPC_CHANNEL = '/xiangqi-mate';

/** 本插件的端点清单；客户端只用这些，写错在这里就能看出来。 */
export const RPC_ENDPOINTS = Object.freeze([
  'state',
  'move',
  'undo',
  'hint',
  'new',
  'review',
  'resign',
  'fallback',
]);

const UNAVAILABLE = Object.freeze({
  code: 'rpc/unavailable',
  message: 'the connection service is not available in this composition',
});

/** 把任意抛出物折成 `{ code, message }`。 */
function transportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  // 405/404 的含义是「请求到达了服务端，但那条 RPC 路由不存在」——即宿主半的通道没注册。
  // 最常见的原因是插件更新后尚未重启 DSH（宿主代码是模块代，重启才重新加载）。
  // 把它单独标出来，让界面能给出「请重启一次」这种可直接照做的提示，
  // 而不是把裸 HTTP 状态码丢给用户。
  const status = /HTTP (\d{3})/.exec(message);
  if (status !== null && (status[1] === '405' || status[1] === '404')) {
    return { code: 'rpc/channel-missing', message };
  }
  return { code: 'rpc/transport', message };
}

/** 归一化宿主返回的 `error` 字段。 */
function normalizeError(error) {
  if (error !== null && typeof error === 'object') {
    return {
      code: typeof error.code === 'string' ? error.code : 'rpc/failed',
      message: typeof error.message === 'string' ? error.message : '',
    };
  }
  return { code: 'rpc/failed', message: '' };
}

/**
 * 建立某个会话的游戏 RPC 客户端。
 *
 * @param options - `{ call, sessionId, cwd, channel }`。
 *   `call` 就是 `ctx.connection.rpc.call`（缺失时传 undefined，全部端点降级为不可用）；
 *   `sessionId` 会随每个 payload 一起发出去——宿主必须用它校验归属（§7.5.3 约束 4）；
 *   `cwd` 是会话工作区（从 `useSessions` 取的 `byId[sessionId].cwd`），宿主用它决定
 *   对局落盘位置，从而与「会话命令 / 工具」两条路径写到同一个地方（§7.5.2）。
 * @returns 每个端点一个方法，统一返回 `{ ok, ... }`，永不抛。
 */
export function createGameRpc(options) {
  const opts = options === undefined || options === null ? {} : options;
  const call = typeof opts.call === 'function' ? opts.call : null;
  const channel = typeof opts.channel === 'string' ? opts.channel : RPC_CHANNEL;
  const cwd = typeof opts.cwd === 'string' && opts.cwd !== '' ? opts.cwd : null;

  /** 一次端点调用：返回原始 value 或错误。 */
  async function invoke(endpoint, payload, signal) {
    if (call === null) return { ok: false, error: UNAVAILABLE };
    let result;
    try {
      result = await call(channel, endpoint, payload, signal);
    } catch (error) {
      return { ok: false, error: transportError(error) };
    }
    if (result === null || typeof result !== 'object') {
      return { ok: false, error: { code: 'rpc/malformed', message: 'invalid response envelope' } };
    }
    if (result.ok !== true) return { ok: false, error: normalizeError(result.error) };
    return { ok: true, value: result.value };
  }

  function scoped(payload) {
    if (typeof opts.sessionId !== 'string' || opts.sessionId === '') {
      return { error: { code: 'session/missing', message: 'no session is selected' } };
    }
    return {
      error: null,
      payload: { sessionId: opts.sessionId, ...(cwd === null ? {} : { cwd }), ...payload },
    };
  }

  /** 需要投影回填的端点（state/move/undo/new/review/resign/fallback）。 */
  async function projectionCall(endpoint, payload, signal) {
    const scope = scoped(payload);
    if (scope.error !== null) return { ok: false, error: scope.error };
    const answer = await invoke(endpoint, scope.payload, signal);
    if (answer.ok !== true) return answer;
    return { ok: true, projection: unwrapProjection(answer.value), value: answer.value };
  }

  return {
    /** 通道是否可用（`connection` 服务缺失时为 false，面板据此显示只读）。 */
    available: call !== null,
    sessionId: typeof opts.sessionId === 'string' ? opts.sessionId : null,
    /** 进入面板、会话切换、轮询都走它。 */
    state: (signal) => projectionCall('state', {}, signal),
    /** 人落子。`from`/`to` 是内部索引；`iccs` 只是给宿主做日志与兜底。 */
    move: (from, to, iccs, signal) => projectionCall('move', { from, to, iccs }, signal),
    /** 悔棋，默认 2 手（回到上一次轮到自己）。 */
    undo: (plies, signal) => projectionCall('undo', { plies: plies === undefined ? 2 : plies }, signal),
    /** 新对局。 */
    newGame: (signal) => projectionCall('new', {}, signal),
    /** 认输。 */
    resign: (signal) => projectionCall('resign', {}, signal),
    /** 立即由本地引擎代走（Q7 的救命按钮）。 */
    fallback: (signal) => projectionCall('fallback', {}, signal),
    /** 复盘数据（可选端点：拿不到就退回本地重放，不报错）。 */
    async review(signal) {
      const scope = scoped({});
      if (scope.error !== null) return { ok: false, error: scope.error };
      const answer = await invoke('review', scope.payload, signal);
      if (answer.ok !== true) return answer;
      return { ok: true, projection: unwrapProjection(answer.value), value: answer.value };
    },
    /** 提示：返回值是候选着法列表，不是局面，所以不走投影分支。 */
    async hint(count, signal) {
      const scope = scoped({ count: count === undefined ? 3 : count });
      if (scope.error !== null) return { ok: false, error: scope.error };
      const answer = await invoke('hint', scope.payload, signal);
      if (answer.ok !== true) return answer;
      return { ok: true, value: answer.value };
    },
  };
}
