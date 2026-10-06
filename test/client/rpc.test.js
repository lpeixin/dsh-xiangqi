/**
 * 通道①（通用 RPC）的单测（§7.5.3）。
 *
 * 这一层最要紧的性质是**永不抛**：`apply` 里任何逃逸的 rejection 都会 dispose 整个
 * DSH（§12.3-T21），所以「传输失败 / 服务缺失 / 信封畸形」都必须折成
 * `{ ok: false, error }`，而不是异常。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RPC_CHANNEL, RPC_ENDPOINTS, createGameRpc } from '../../lib/ui/rpc.js';
import { errorKeyOf } from '../../lib/ui/model.js';

const board = new Array(90).fill('');
board[85] = 'K';

/** 一个最小但形状合法的投影。 */
const projection = { revision: 5, board, turn: 'r', hero: 'r', phase: 'playing', pending: null };

/** 记录调用的假传输层。 */
function recorder(handler) {
  const calls = [];
  const call = async (channel, endpoint, payload, signal) => {
    calls.push({ channel, endpoint, payload, signal });
    return handler(endpoint, payload, calls.length);
  };
  return { calls, call };
}

test('端点清单与通道名符合契约（不能用保留的 /api）', () => {
  assert.equal(RPC_CHANNEL, '/xiangqi-mate');
  assert.match(RPC_CHANNEL, /^\/[A-Za-z0-9._~-]+$/);
  assert.notEqual(RPC_CHANNEL, '/api');
  assert.deepEqual(
    [...RPC_ENDPOINTS].sort(),
    ['fallback', 'hint', 'move', 'new', 'resign', 'review', 'state', 'undo'],
  );
});

test('每个端点都把 sessionId 一起发出去（宿主据此校验归属）', async () => {
  const { calls, call } = recorder(() => ({ ok: true, value: projection }));
  const rpc = createGameRpc({ call, sessionId: 's-42' });
  await rpc.state();
  await rpc.move(70, 67, 'h2e2');
  await rpc.undo(2);
  await rpc.newGame();
  await rpc.resign();
  await rpc.fallback();
  await rpc.review();
  await rpc.hint(3);
  assert.deepEqual(calls.map((c) => c.endpoint), [
    'state',
    'move',
    'undo',
    'new',
    'resign',
    'fallback',
    'review',
    'hint',
  ]);
  for (const entry of calls) {
    assert.equal(entry.channel, '/xiangqi-mate');
    assert.equal(entry.payload.sessionId, 's-42');
  }
  assert.deepEqual(calls[1].payload, { sessionId: 's-42', from: 70, to: 67, iccs: 'h2e2' });
  assert.deepEqual(calls[2].payload, { sessionId: 's-42', plies: 2 });
  assert.deepEqual(calls[7].payload, { sessionId: 's-42', count: 3 });
});

test('move 的 iccs 必须是 h2e2 形状（一方先修好也能通）', async () => {
  const { calls, call } = recorder(() => ({ ok: true, value: projection }));
  const rpc = createGameRpc({ call, sessionId: 's' });
  await rpc.move(70, 67, 'h2e2');
  assert.match(calls[0].payload.iccs, /^[a-i][0-9][a-i][0-9]$/);
});

test('投影既接受裸投影，也接受 snapshot/projection/state 包装', async () => {
  for (const value of [projection, { snapshot: projection }, { projection }, { state: projection }]) {
    const rpc = createGameRpc({ call: async () => ({ ok: true, value }), sessionId: 's' });
    const result = await rpc.state();
    assert.equal(result.ok, true);
    assert.equal(result.projection.revision, 5);
  }
});

test('认不出的返回值 → projection: null，但仍然 ok（不是错误）', async () => {
  const rpc = createGameRpc({ call: async () => ({ ok: true, value: { candidates: [] } }), sessionId: 's' });
  const result = await rpc.state();
  assert.equal(result.ok, true);
  assert.equal(result.projection, null);
  assert.deepEqual(result.value, { candidates: [] });
});

test('hint 走非投影分支：返回值原样交回调用方', async () => {
  const candidates = { candidates: [{ iccs: 'h2e2', zh: '炮二平五' }] };
  const rpc = createGameRpc({ call: async () => ({ ok: true, value: candidates }), sessionId: 's' });
  const result = await rpc.hint();
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, candidates);
  assert.equal(result.projection, undefined);
});

test('宿主返回 ok:false → 折成机器码，不抛', async () => {
  const rpc = createGameRpc({
    call: async () => ({ ok: false, error: { code: 'move.illegal', message: '马腿被蹩', details: {} } }),
    sessionId: 's',
  });
  const result = await rpc.move(70, 67, 'h2e2');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'move.illegal');
  assert.equal(result.error.message, '马腿被蹩');
});

test('传输层抛异常 → rpc/transport，不冒泡', async () => {
  const rpc = createGameRpc({
    call: async () => {
      throw new Error('HTTP 500');
    },
    sessionId: 's',
  });
  const result = await rpc.state();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'rpc/transport');
  assert.match(result.error.message, /HTTP 500/);
});

test('connection 服务缺失 → rpc/unavailable，面板据此转只读', async () => {
  const rpc = createGameRpc({ call: undefined, sessionId: 's' });
  assert.equal(rpc.available, false);
  const result = await rpc.state();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'rpc/unavailable');
});

test('没有会话 → session/missing，且**不会**发出请求', async () => {
  const { calls, call } = recorder(() => ({ ok: true, value: projection }));
  const rpc = createGameRpc({ call, sessionId: undefined });
  assert.equal(rpc.sessionId, null);
  for (const result of [await rpc.state(), await rpc.hint(), await rpc.review()]) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'session/missing');
  }
  assert.deepEqual(calls, []);
});

test('信封畸形 → rpc/malformed', async () => {
  const rpc = createGameRpc({ call: async () => null, sessionId: 's' });
  const result = await rpc.state();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'rpc/malformed');
});

test('AbortSignal 原样透传给传输层（tab 销毁时能取消在途请求）', async () => {
  const { calls, call } = recorder(() => ({ ok: true, value: projection }));
  const controller = new AbortController();
  const rpc = createGameRpc({ call, sessionId: 's' });
  await rpc.state(controller.signal);
  assert.equal(calls[0].signal, controller.signal);
});

test('会话工作区（cwd）随 payload 一起发出，让面板与命令/工具写到同一处', async () => {
  const { calls, call } = recorder(() => ({ ok: true, value: projection }));
  const withCwd = createGameRpc({ call, sessionId: 's', cwd: '/w/session' });
  await withCwd.state();
  await withCwd.move(70, 67, 'h2e2');
  assert.equal(calls[0].payload.cwd, '/w/session');
  assert.equal(calls[1].payload.cwd, '/w/session');

  const withoutCwd = createGameRpc({ call, sessionId: 's' });
  await withoutCwd.state();
  assert.equal('cwd' in calls[2].payload, false, '不知道工作区时不要凭空造一个');

  const blank = createGameRpc({ call, sessionId: 's', cwd: '' });
  await blank.state();
  assert.equal('cwd' in calls[3].payload, false);
});

test('自定义通道名也接受（便于复用与测试）', async () => {
  const { calls, call } = recorder(() => ({ ok: true, value: projection }));
  const rpc = createGameRpc({ call, sessionId: 's', channel: '/other-channel' });
  await rpc.state();
  assert.equal(calls[0].channel, '/other-channel');
});

test('HTTP 405/404 被单独标成 rpc/channel-missing，并映射到「请重启 DSH」的可照做提示', async () => {
  // 真机上踩到过：宿主半用 `ctx.get('connection')` 在 apply 时取一次服务，
  // `connection` 晚于本插件就绪就永久漏掉 RPC 注册 —— 工具照常可用，只有面板连不上，
  // 界面原先只显示裸的 `HTTP 405`，看不出该做什么。
  const rpc = createGameRpc({
    sessionId: 's',
    call: async () => {
      throw new Error('transport failure for /xiangqi-mate/state: HTTP 405');
    },
  });
  const result = await rpc.state();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'rpc/channel-missing', '405 必须被认成「通道未注册」而不是普通传输失败');
  assert.equal(errorKeyOf(result.error.code), 'status.rpcChannelMissing', '必须映射到可照做的文案键');

  // 对照：普通网络故障不能被误判成通道缺失，否则提示会误导。
  const offline = createGameRpc({
    sessionId: 's',
    call: async () => {
      throw new Error('fetch failed: ECONNREFUSED');
    },
  });
  assert.equal((await offline.state()).error.code, 'rpc/transport');
});
