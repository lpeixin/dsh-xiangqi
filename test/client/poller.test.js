/**
 * 轮询循环的单测（§7.5.3）。
 *
 * 用**假调度器 + 假时钟**（不碰真实计时器）：这样退避序列、超时收工、以及
 * 「stop 之后不再有回调」都能被逐条钉住——宿主→客户端没有推送通道，轮询一旦失控
 * 就是永久的后台开销。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPollLoop } from '../../lib/ui/poller.js';

/**
 * 假调度器：把回调排进队列，`runNext()` 按**约定的延迟**推进假时钟并执行它。
 * @returns `{ schedule, runNext, pending, advanceClock }`。
 */
function fakeScheduler() {
  const queue = [];
  let clock = 0;
  const schedule = (callback, delayMs) => {
    const entry = { callback, delayMs, cancelled: false };
    queue.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return {
    schedule,
    now: () => clock,
    get pending() {
      return queue.filter((entry) => !entry.cancelled);
    },
    get delays() {
      return queue.map((entry) => entry.delayMs);
    },
    /** 执行下一个未取消的回调，并把假时钟推进它自己的延迟。 */
    runNext() {
      const index = queue.findIndex((entry) => !entry.cancelled);
      if (index < 0) return false;
      const [entry] = queue.splice(index, 1);
      clock += entry.delayMs;
      entry.callback();
      return true;
    },
  };
}

test('退避序列：800 → 1080 → 1458 → 1968 → 2000（封顶）', () => {
  const scheduler = fakeScheduler();
  const loop = createPollLoop({ schedule: scheduler.schedule, now: scheduler.now, onTick: () => {} });
  loop.start();
  const delays = [];
  for (let i = 0; i < 6; i += 1) {
    assert.equal(scheduler.pending.length, 1, '任意时刻只应有一个待触发计时器');
    delays.push(scheduler.pending[0].delayMs);
    scheduler.runNext();
  }
  assert.deepEqual(delays, [800, 1080, 1458, 1968, 2000, 2000]);
  loop.dispose();
});

test('每轮都恰好回调一次 onTick', () => {
  const scheduler = fakeScheduler();
  let ticks = 0;
  const loop = createPollLoop({ schedule: scheduler.schedule, now: scheduler.now, onTick: () => (ticks += 1) });
  loop.start();
  for (let i = 0; i < 4; i += 1) scheduler.runNext();
  assert.equal(ticks, 4);
  assert.equal(loop.attempts(), 4);
  loop.dispose();
});

test('30 s 到点收工：调用一次 onExpired，且不再排下一轮', () => {
  const scheduler = fakeScheduler();
  let ticks = 0;
  let expired = 0;
  const loop = createPollLoop({
    schedule: scheduler.schedule,
    now: scheduler.now,
    onTick: () => (ticks += 1),
    onExpired: () => (expired += 1),
  });
  loop.start();
  let guard = 0;
  while (scheduler.runNext() && guard < 100) guard += 1;
  assert.equal(expired, 1, 'onExpired 只该触发一次');
  assert.equal(loop.isRunning(), false);
  assert.equal(scheduler.pending.length, 0, '超时后不该再排计时器');
  assert.ok(scheduler.now() >= 30000, `假时钟应已越过 30 s，实际 ${scheduler.now()}`);
  assert.ok(ticks >= 1);
  // 再推一次也什么都不会发生（dispose 前也不该复活）
  assert.equal(scheduler.runNext(), false);
  loop.dispose();
});

test('stop() 清掉待触发计时器，之后再没有回调', () => {
  const scheduler = fakeScheduler();
  let ticks = 0;
  const loop = createPollLoop({ schedule: scheduler.schedule, now: scheduler.now, onTick: () => (ticks += 1) });
  loop.start();
  assert.equal(scheduler.pending.length, 1);
  loop.stop();
  assert.equal(loop.isRunning(), false);
  assert.equal(scheduler.pending.length, 0);
  assert.equal(scheduler.runNext(), false);
  assert.equal(ticks, 0);
  loop.dispose();
});

test('start() 幂等：重复调用不会叠加计时器', () => {
  const scheduler = fakeScheduler();
  const loop = createPollLoop({ schedule: scheduler.schedule, now: scheduler.now, onTick: () => {} });
  loop.start();
  loop.start();
  loop.start();
  assert.equal(scheduler.pending.length, 1);
  loop.dispose();
});

test('stop 之后可以再 start（重新可见时立刻恢复轮询）', () => {
  const scheduler = fakeScheduler();
  let ticks = 0;
  const loop = createPollLoop({ schedule: scheduler.schedule, now: scheduler.now, onTick: () => (ticks += 1) });
  loop.start();
  scheduler.runNext();
  loop.stop();
  loop.start();
  assert.equal(scheduler.pending[0].delayMs, 800, '重新开始应回到 800 ms 起步');
  scheduler.runNext();
  assert.equal(ticks, 2);
  loop.dispose();
});

test('dispose() 是永久停用：不能再 start', () => {
  const scheduler = fakeScheduler();
  const loop = createPollLoop({ schedule: scheduler.schedule, now: scheduler.now, onTick: () => {} });
  loop.start();
  loop.dispose();
  loop.start();
  assert.equal(loop.isRunning(), false);
  assert.equal(scheduler.pending.length, 0);
});

test('没有 scheduler（timer 服务缺失）时 start 是安全的空操作', () => {
  const loop = createPollLoop({ schedule: undefined, onTick: () => assert.fail('不该回调') });
  loop.start();
  assert.equal(loop.isRunning(), false);
  loop.dispose();
});

test('onTick 抛异常：不冒泡、不卡死，交给 onError 后照常排下一轮', () => {
  const scheduler = fakeScheduler();
  let ticks = 0;
  const errors = [];
  const loop = createPollLoop({
    schedule: scheduler.schedule,
    now: scheduler.now,
    onError: (error) => errors.push(error.message),
    onTick: () => {
      ticks += 1;
      if (ticks === 1) throw new Error('boom');
    },
  });
  loop.start();
  scheduler.runNext();
  assert.deepEqual(errors, ['boom'], '异常必须被接住（游离 rejection 会 dispose 整个 DSH）');
  assert.equal(loop.isRunning(), true, '循环不该被一次失败卡死');
  assert.equal(scheduler.pending.length, 1);
  scheduler.runNext();
  assert.equal(ticks, 2);
  loop.dispose();
});

test('自定义预算（base/factor/max/timeout）全部生效', () => {
  const scheduler = fakeScheduler();
  const loop = createPollLoop({
    schedule: scheduler.schedule,
    now: scheduler.now,
    baseMs: 100,
    factor: 2,
    maxMs: 300,
    timeoutMs: 1000,
    onTick: () => {},
  });
  loop.start();
  const delays = [];
  for (let i = 0; i < 3; i += 1) {
    delays.push(scheduler.pending[0].delayMs);
    scheduler.runNext();
  }
  assert.deepEqual(delays, [100, 200, 300]);
  loop.dispose();
});
