/**
 * 跨半集成（§7.5.3 通道①）：用**浏览器半真实的 RPC 客户端**（`lib/ui/rpc.js`）驱动
 * 宿主半注册的 handler，验证「用户点棋盘就能走子」这条端到端路径。
 *
 * 这一层的价值在于形状对得上：客户端发 `{ from, to, iccs }`（内部索引），
 * 宿主必须接受；返回值必须是客户端 `unwrapProjection` 认得的投影。
 * 若 `lib/ui/rpc.js`（M3 交付）缺失，本文件整体跳过，不影响 M2 自身的绿灯。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { bootstrap, testConfig } from '../helpers/bootstrap.mjs';
import { createLlmStub } from '../helpers/llm-stub.mjs';

let createGameRpc = null;
try {
  ({ createGameRpc } = await import('../../lib/ui/rpc.js'));
} catch {
  createGameRpc = null;
}

const skip = createGameRpc === null ? 'lib/ui/rpc.js（M3）当前不可用' : false;

/** 把宿主的 rpc handler 接成客户端的 `call`。 */
function bridge(app) {
  const handler = app.ctx.registrations.rpc.get('/xiangqi-mate');
  return createGameRpc({
    call: (channel, endpoint, payload, signal) => handler(endpoint, payload, signal, undefined),
    sessionId: app.agent.id,
  });
}

test('跨半：state → move(from,to,iccs) → state，用户点棋盘即可走子', { skip }, async (t) => {
  const app = await bootstrap({ sessionId: 'session-xh' });
  t.after(app.cleanup);
  const rpc = bridge(app);
  assert.equal(rpc.available, true);

  const first = await rpc.state();
  assert.equal(first.ok, true, JSON.stringify(first.error));
  assert.ok(first.projection !== null, '宿主投影必须能被客户端 unwrapProjection 认出');
  assert.equal(first.projection.board.length, 90);
  assert.equal(typeof first.projection.opponent, 'object');
  assert.equal(typeof first.projection.saved, 'boolean');

  // 客户端就是这样发的：from/to 是内部索引，iccs 只是兜底。
  const moved = await rpc.move(70, 67, 'h2e2');
  assert.equal(moved.ok, true, JSON.stringify(moved.error));
  assert.equal(moved.projection.history[0].zh, '炮二平五');
  assert.equal(moved.projection.history[0].iccs, 'h2e2');

  // 非法着法：客户端只拿到机器码，用于本地化文案。
  const illegal = await rpc.move(81, 40, 'a0a5');
  assert.equal(illegal.ok, false);
  assert.equal(illegal.error.code, 'ILLEGAL_MOVE');
  assert.ok(illegal.error.message.length > 0);

  await app.settle();
  const polled = await rpc.state();
  assert.equal(polled.ok, true);
  assert.ok(polled.projection.revision > first.projection.revision);
});

test('跨半：hint / review / undo / fallback / newGame / resign 都能被客户端消费', { skip }, async (t) => {
  const app = await bootstrap({
    config: testConfig({ opponent: { mode: 'model', timeoutMs: 60000 } }),
    services: { llm: createLlmStub([{ type: 'hang' }]) },
    agentOptions: { provider: 'stub', model: 'stub-model' },
    sessionId: 'session-xh2',
  });
  t.after(app.cleanup);
  // 生产里 `ctx.agents.get(sessionId)` 是活的；RPC 侧靠它拿回会话模型路由与 cwd。
  app.ctx.set('agents', { get: (id) => (id === app.agent.id ? app.agent : undefined), list: () => [app.agent] });
  const rpc = bridge(app);

  const created = await rpc.newGame();
  assert.equal(created.ok, true);

  // 人落子 → 模型开始思考（请求被挂起）→ 此时 fallback 才是有效操作。
  const moved = await rpc.move(70, 67, 'h2e2');
  assert.equal(moved.ok, true, JSON.stringify(moved.error));
  assert.equal(moved.projection.pending, 'ai-thinking');

  const hinted = await rpc.hint(3);
  assert.equal(hinted.ok, true, JSON.stringify(hinted.error));
  assert.ok(Array.isArray(hinted.value.candidates));

  const reviewed = await rpc.review();
  assert.equal(reviewed.ok, true);
  assert.ok(Array.isArray(reviewed.value.turningPoints));

  const fallback = await rpc.fallback();
  assert.equal(fallback.ok, true, JSON.stringify(fallback.error));
  assert.equal(fallback.projection.opponent.kind, 'local');

  await app.settle();
  const undone = await rpc.undo(1);
  assert.equal(undone.ok, true, JSON.stringify(undone.error));

  const resigned = await rpc.resign();
  assert.equal(resigned.ok, true);
  assert.equal(resigned.projection.status.state, 'resigned');
  assert.equal(resigned.projection.phase, 'finished');
});
