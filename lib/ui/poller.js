/**
 * 按需轮询（§7.5.3）。
 *
 * 宿主 → 客户端**没有推送通道**（客户端事件只有 4 个，第三方加不进白名单），所以
 * AI 的应招只能靠轮询到达。三条硬规则：
 *
 *  1. 只在 `pending === 'ai-thinking'` 且面板可见时轮（空闲、不可见 = 零轮询）；
 *  2. 800 ms 起、×1.35 退避、2 s 上限；
 *  3. 最长 30 s，超时停下并回调 `onExpired`（面板提示可点「由本地引擎代走」），
 *     而不是无限轮下去。
 *
 * 为了可测，这里不直接用 `window.setTimeout`：调度器由外部注入（插件里给
 * `ctx.timer.timeout`，测试里给一个假调度器 + 假时钟）。所有计时器都记在
 * `cancel` 上，`stop()`/`dispose()` 一定清干净。
 */

import { POLL_BASE_MS, POLL_FACTOR, POLL_MAX_MS, POLL_TIMEOUT_MS, nextPollDelay, pollExpired } from './model.js';

/**
 * 建立一个轮询循环。
 *
 * @param options - `{ schedule, onTick, onExpired, now, baseMs, factor, maxMs, timeoutMs }`。
 *   `schedule(callback, delayMs)` 必须返回一个「取消」函数（`ctx.timer.timeout` 正好如此）；
 *   `onTick()` 每轮调用一次（内部自己 await 请求，**不要**抛出）；
 *   `onExpired()` 只在超时那一刻调用一次；
 *   `now()` 返回毫秒时间戳（注入以便测试）。
 * @returns `{ start, stop, dispose, isRunning }`。
 */
export function createPollLoop(options) {
  const opts = options === undefined || options === null ? {} : options;
  const schedule = typeof opts.schedule === 'function' ? opts.schedule : null;
  const onTick = typeof opts.onTick === 'function' ? opts.onTick : () => {};
  const onExpired = typeof opts.onExpired === 'function' ? opts.onExpired : () => {};
  const onError = typeof opts.onError === 'function' ? opts.onError : () => {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const budget = {
    baseMs: Number.isFinite(opts.baseMs) ? opts.baseMs : POLL_BASE_MS,
    factor: Number.isFinite(opts.factor) ? opts.factor : POLL_FACTOR,
    maxMs: Number.isFinite(opts.maxMs) ? opts.maxMs : POLL_MAX_MS,
  };
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : POLL_TIMEOUT_MS;

  let running = false;
  let disposed = false;
  let cancel = null;
  let attempt = 0;
  let startedAt = 0;

  function arm() {
    if (disposed || !running || schedule === null) return;
    const delay = nextPollDelay(attempt, budget);
    cancel = schedule(() => {
      cancel = null;
      if (disposed || !running) return;
      if (pollExpired(now() - startedAt, timeoutMs)) {
        running = false;
        onExpired();
        return;
      }
      // 回调里的异常**绝不能**逃逸成游离 rejection（那会 dispose 整个 DSH，T21），
      // 也不能把循环卡死：吞掉并交给 onError，然后照常排下一轮。
      try {
        onTick();
      } catch (error) {
        onError(error);
      }
      attempt += 1;
      arm();
    }, delay);
  }

  return {
    /** 开始轮询；重复调用是幂等的（不会叠加计时器）。 */
    start() {
      if (disposed || running || schedule === null) return;
      running = true;
      attempt = 0;
      startedAt = now();
      arm();
    },
    /** 停止轮询并清掉待触发的计时器（面板不可见、AI 已应招、超时都要调它）。 */
    stop() {
      running = false;
      if (cancel !== null) {
        const drop = cancel;
        cancel = null;
        drop();
      }
    },
    /** 永久停用（组件卸载）。 */
    dispose() {
      disposed = true;
      this.stop();
    },
    isRunning() {
      return running;
    },
    /** 已经轮询了多少次（面板用它算「已用时」）。 */
    attempts() {
      return attempt;
    },
    /** 本轮开始的时间戳（算 AI 已用时）。 */
    startedAt() {
      return startedAt;
    },
  };
}
