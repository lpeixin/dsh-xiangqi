/**
 * 假 ctx 集成测试（§9.1）：驱动 `apply(ctx, config)`，校验注册、disposer、降级与跨半 RPC。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Config, apply, inject, name, TOOL_NAMES } from '../../lib/index.js';
import { stripComments } from '../helpers/source.mjs';
import { bootstrap, tempCwd, testConfig } from '../helpers/bootstrap.mjs';
import { createFakeCtx, makeAgent, makeRouteCaller as callRoute } from '../helpers/fake-ctx.mjs';
import { testEngine } from '../helpers/engine.mjs';

const LIB_DIR = fileURLToPath(new URL('../../lib/', import.meta.url));

test('入口导出形态：命名导出 name/inject/Config/apply，且没有 export default', async () => {
  assert.equal(name, 'xiangqi');
  assert.deepEqual(inject, ['tools'], 'inject 只能声明唯一硬依赖 tools');
  assert.equal(typeof apply, 'function');
  assert.equal(typeof Config['~standard'].validate, 'function');
  const source = stripComments(await readFile(path.join(LIB_DIR, 'index.js'), 'utf8'));
  assert.ok(!/export\s+default/.test(source), 'lib/index.js 绝不能有 export default');
  assert.deepEqual(
    [...source.matchAll(/^export\s+(?:const|function|\{)/gm)].length > 0,
    true,
    '必须存在命名导出',
  );
});

test('宿主半自有文件不得 import 非内置模块，也不得写自定义会话事件', async () => {
  for (const relative of await listOwnSources()) {
    const source = stripComments(await readFile(path.join(LIB_DIR, relative), 'utf8'));
    const specifiers = [
      ...source.matchAll(/^\s*import\s[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/gm),
      ...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/^\s*export\s[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/gm),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      const ok = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('node:');
      assert.ok(ok, `${relative} 引入了非内置模块：${specifier}`);
    }
    assert.ok(!/session\.append\s*\(/.test(source), `${relative} 不得写自定义会话事件（§12.3-T20）`);
  }
});

test('apply：六个工具 + 命令 + RPC + 技能都注册成功', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  assert.equal(app.ctx.registrations.tools.size, 6);
  assert.deepEqual([...app.ctx.registrations.tools.keys()].sort(), [...TOOL_NAMES].sort());
  assert.equal(app.ctx.registrations.commands.has('xiangqi'), true);
  assert.equal(app.ctx.registrations.rpc.has('/xiangqi-mate'), true);
  assert.equal(app.ctx.registrations.skills.has('xiangqi-mate-playbook'), true);
  assert.match(app.ctx.registrations.skills.get('xiangqi-mate-playbook').name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('apply：只有 tools 时仍能激活（其余服务一律判空降级）', async (t) => {
  const engine = await testEngine();
  const ctx = createFakeCtx({ services: { commands: null, skills: null, connection: null, llm: null } });
  const dispose = apply(ctx, testConfig());
  t.after(dispose);
  assert.equal(ctx.registrations.tools.size, 6);
  assert.equal(ctx.registrations.commands.size, 0);
  assert.equal(ctx.registrations.rpc.size, 0);
  assert.equal(ctx.registrations.skills.size, 0);
  const value = await ctx.registrations.tools.get('xiangqi_board').execute({}, { agent: { id: 's', session: { header: { id: 's', cwd: await tempCwd() } } }, signal: new AbortController().signal });
  assert.equal(value.ok, true);
  assert.equal(engine.positionToFen(engine.initialPosition()), value.fen);
});

test('apply：技能注册抛错不拖垮工具注册', async (t) => {
  const ctx = createFakeCtx({ services: { skills: { register() { throw new Error('skills 炸了'); } } } });
  const dispose = apply(ctx, testConfig());
  t.after(dispose);
  assert.equal(ctx.registrations.tools.size, 6, '技能失败后工具必须仍然全部注册');
});

test('disposer：逆序释放、幂等、且第二次调用不再有效果', async (t) => {
  const app = await bootstrap();
  const { ctx } = app;
  await app.dispose();
  const order = ctx.disposalOrder;
  assert.equal(order.length, 10, `应有 6 工具 + 1 命令 + 1 RPC（effect + 显式收集两条记账）+ 1 技能，实际 ${JSON.stringify(order)}`);
  assert.deepEqual(order, [
    'skill:xiangqi-mate-playbook',
    'effect:xiangqi-mate: /xiangqi-mate route',
    'rpc:/xiangqi-mate',
    'command:xiangqi',
    'tool:xiangqi_review',
    'tool:xiangqi_hint',
    'tool:xiangqi_undo',
    'tool:xiangqi_move',
    'tool:xiangqi_board',
    'tool:xiangqi_new',
  ]);
  assert.equal(ctx.registrations.tools.size, 0);
  assert.equal(ctx.registrations.rpc.size, 0);
  await app.dispose();
  assert.equal(ctx.disposalOrder.length, 10, '重复 dispose 必须是 no-op');
  await app.cleanup();
});

test('命令：/xiangqi state 返回 §7.5.4 的 JSON 投影；未知子命令返回 error', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const handler = app.ctx.registrations.commands.get('xiangqi').handler;
  const invocation = (rawInput) => ({ commandId: 'c1', agent: app.agent, rawInput, attachments: [], signal: new AbortController().signal });

  const ok = await handler(invocation('state'));
  assert.equal(ok.kind, 'success');
  const snapshot = JSON.parse(ok.text);
  for (const key of ['ok', 'revision', 'fen', 'turn', 'hero', 'phase', 'pending', 'status', 'board', 'lastMove', 'legalTargets', 'history', 'clock', 'message', 'error']) {
    assert.ok(key in snapshot, `投影缺少字段 ${key}`);
  }
  assert.equal(snapshot.board.length, 90);
  assert.equal(snapshot.storage.mode, 'file');

  const empty = await handler(invocation(''));
  assert.equal(empty.kind, 'success', '空输入等价于 state');

  const bad = await handler(invocation('teleport'));
  assert.equal(bad.kind, 'error');
  assert.match(bad.text, /未知子命令/);

  const move = await handler(invocation('move h2e2'));
  assert.equal(move.kind, 'success', move.text);
  const afterMove = JSON.parse(move.text);
  assert.equal(afterMove.history.length >= 1, true);
  assert.equal(afterMove.history[0].zh, '炮二平五');
  assert.equal(afterMove.revision > snapshot.revision, true);

  const illegal = await handler(invocation('move a0a5'));
  assert.equal(illegal.kind, 'error');
});

test('RPC：七个 endpoint 都可用，且校验 sessionId', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const rpc = app.ctx.registrations.rpc.get('/xiangqi-mate');
  const payload = { sessionId: 'session-rpc', cwd: app.cwd };

  for (const endpoint of ['state', 'new', 'move', 'undo', 'hint', 'review', 'resign']) {
    assert.equal(typeof rpc, 'function');
  }
  const state = await rpc('state', payload);
  assert.equal(state.ok, true);
  assert.equal(state.value.revision, 1);

  const created = await rpc('new', { ...payload, side: 'r' });
  assert.equal(created.ok, true);
  assert.equal(created.value.fen.startsWith('rnbakabnr/'), true);

  const moved = await rpc('move', { ...payload, move: 'h2e2' });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(moved.value.history[0].zh, '炮二平五');
  // 本地引擎代走是同步的微任务，pending 可能已经结束；两种收敛态都算通过。
  assert.ok(moved.value.pending === 'ai-thinking' || moved.value.history.length === 2, `unexpected pending=${moved.value.pending}`);

  const hinted = await rpc('hint', payload);
  assert.equal(hinted.ok, true);
  assert.ok(Array.isArray(hinted.value.candidates));

  const undone = await rpc('undo', { ...payload, plies: 1 });
  assert.equal(undone.ok, true);

  const reviewed = await rpc('review', payload);
  assert.equal(reviewed.ok, true);
  assert.ok(Array.isArray(reviewed.value.review.historyZh));

  const resigned = await rpc('resign', payload);
  assert.equal(resigned.ok, true);
  assert.equal(resigned.value.status.state, 'resigned');
  assert.equal(resigned.value.phase, 'finished');

  const missing = await rpc('state', {});
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'BAD_SESSION');
  assert.equal(typeof missing.error.message, 'string');

  const blank = await rpc('state', { sessionId: '   ' });
  assert.equal(blank.ok, false);
  assert.equal(blank.error.code, 'BAD_SESSION');

  const unknown = await rpc('dance', payload);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'UNKNOWN_ENDPOINT');
  assert.ok(Array.isArray(unknown.error.details.endpoints));
});

test('RPC：move 同时接受 {from,to} 索引（M3 客户端的真实形状）、iccs 与 move 字符串', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const rpc = app.ctx.registrations.rpc.get('/xiangqi-mate');
  const base = { sessionId: 'shapes', cwd: app.cwd };

  // M3 的 lib/ui/rpc.js 发的是 { from, to, iccs }，from/to 是内部索引。
  const byIndex = await rpc('move', { ...base, from: 70, to: 67, iccs: 'h2e2' });
  assert.equal(byIndex.ok, true, JSON.stringify(byIndex));
  assert.equal(byIndex.value.history[0].zh, '炮二平五');
  assert.equal(byIndex.value.history[0].iccs, 'h2e2');
  await app.settle();

  const byIccs = await rpc('move', { ...base, iccs: 'h0g2' });
  assert.equal(byIccs.ok, true, JSON.stringify(byIccs));
  await app.settle();

  const byString = await rpc('move', { ...base, move: 'a3a4' });
  assert.equal(byString.ok, true, JSON.stringify(byString));
  assert.equal(byString.value.history.length >= 3, true);

  const bad = await rpc('move', { ...base });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'ILLEGAL_MOVE');
});

test('RPC：projection 的客户端契约（opponent 对象 + saved 布尔）', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const rpc = app.ctx.registrations.rpc.get('/xiangqi-mate');
  const state = await rpc('state', { sessionId: 'proj-shape', cwd: app.cwd });
  assert.equal(state.ok, true);
  const value = state.value;
  // 客户端 isProjection 的判据
  assert.equal(Number.isFinite(value.revision), true);
  assert.equal(Array.isArray(value.board), true);
  assert.equal(value.board.length, 90);
  // PanelHeader 读 p.opponent.kind / .model / .provider
  assert.equal(typeof value.opponent, 'object');
  assert.equal(value.opponent.kind, 'local');
  assert.equal(value.opponent.label, '本地引擎');
  // PanelHeader 读 projection.saved === false → 显示「本局不会被保存」
  assert.equal(value.saved, true);
  assert.equal(value.storage.mode, 'file');
  // 复盘端点的 turningPoints 必须是 ply 整数数组（客户端据此画标记）
  const reviewed = await rpc('review', { sessionId: 'proj-shape', cwd: app.cwd });
  assert.equal(reviewed.ok, true);
  assert.deepEqual(reviewed.value.turningPoints, []);
  assert.equal(Array.isArray(reviewed.value.review.evalCurve), true);
});

test('RPC：fallback 端点把对手切换成本地引擎并立即代走', async (t) => {
  // 用一个挂起的模型请求制造 pending='ai-thinking'，此时 fallback 才是有效操作。
  const { createLlmStub } = await import('../helpers/llm-stub.mjs');
  const app = await bootstrap({
    config: testConfig({ opponent: { mode: 'model', timeoutMs: 60000 } }),
    services: { llm: createLlmStub([{ type: 'hang' }]) },
    agentOptions: { provider: 'stub', model: 'stub-model' },
  });
  t.after(app.cleanup);
  const rpc = app.ctx.registrations.rpc.get('/xiangqi-mate');
  const base = { sessionId: app.agent.id, cwd: app.cwd };
  // 走**工具**路径（带 agent）才能解析出模型路由，从而制造 pending='ai-thinking'。
  await app.tool('xiangqi_new').execute({ side: 'b' }, app.exec());
  await app.settle();
  const thinking = await rpc('state', base);
  assert.equal(thinking.value.pending, 'ai-thinking');

  const fallback = await rpc('fallback', base);
  assert.equal(fallback.ok, true, JSON.stringify(fallback));
  assert.equal(fallback.value.opponent.kind, 'local');
  await app.settle();
  const after = await rpc('state', base);
  assert.equal(after.value.history.length, 1, '本地引擎应当立刻代走一手');
  assert.equal(after.value.pending, null);
});

test('RPC：只操作 payload.sessionId 对应的会话（会话隔离）', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const rpc = app.ctx.registrations.rpc.get('/xiangqi-mate');
  await rpc('new', { sessionId: 'a', cwd: app.cwd });
  await rpc('move', { sessionId: 'a', cwd: app.cwd, move: 'h2e2' });
  const other = await rpc('state', { sessionId: 'b', cwd: app.cwd });
  assert.equal(other.value.history.length, 0, '会话 b 不得看到会话 a 的棋谱');
  const first = await rpc('state', { sessionId: 'a', cwd: app.cwd });
  assert.equal(first.value.history.length >= 1, true);
});

test('RPC 的会话归属校验：agents 服务在场且会话不在本进程时拒绝', async (t) => {
  const app = await bootstrap({ services: { agents: { get: () => undefined, list: () => [{}] } } });
  t.after(app.cleanup);
  const rpc = app.ctx.registrations.rpc.get('/xiangqi-mate');
  const denied = await rpc('state', { sessionId: 'ghost', cwd: app.cwd });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'UNKNOWN_SESSION');
});

test('生命周期：在飞决策不会产生未捕获 rejection，dispose 会 abort 并等待', async (t) => {
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.removeListener('unhandledRejection', onUnhandled));

  const { createLlmStub } = await import('../helpers/llm-stub.mjs');
  const app = await bootstrap({
    config: testConfig({ opponent: { mode: 'model', timeoutMs: 60000 } }),
    services: { llm: createLlmStub([{ type: 'hang' }]) },
    agentOptions: { provider: 'stub', model: 'stub-model' },
  });
  const state = await app.tool('xiangqi_new').execute({ side: 'b' }, app.exec());
  assert.equal(state.turn, 'r');
  await app.settle();
  const withPending = await app.tool('xiangqi_board').execute({}, app.exec());
  assert.equal(withPending.pending, 'ai-thinking');
  await app.dispose();
  await app.settle();
  assert.deepEqual(unhandled, []);
  await app.cleanup();
});

test('工具调用后落盘：同一会话重新 apply 后局面仍在（FR4/FR16）', async (t) => {
  const cwd = await tempCwd();
  const first = await bootstrap({ cwd, sessionId: 'persist-1' });
  await first.tool('xiangqi_new').execute({}, first.exec());
  const command = first.ctx.registrations.commands.get('xiangqi');
  await command.handler({ commandId: 'c1', agent: first.agent, rawInput: 'move h2e2', attachments: [], signal: new AbortController().signal });
  await first.settle();
  const before = await first.tool('xiangqi_board').execute({ includeMoves: false }, first.exec());
  await first.dispose();

  const second = await bootstrap({ cwd, sessionId: 'persist-1' });
  t.after(second.cleanup);
  const after = await second.tool('xiangqi_board').execute({ includeMoves: false }, second.exec());
  assert.equal(after.fen, before.fen);
  assert.deepEqual(after.historyZh, before.historyZh);
  assert.ok(after.historyZh.length >= 2);
});

/** 只扫描 M2 自有的文件（lib/engine、lib/ui、lib/client.js 属于其他 agent）。 */
async function listOwnSources() {
  const out = ['index.js', 'skill.js'];
  for (const directory of ['game', 'tools', 'opponent']) {
    for (const entry of await readdir(path.join(LIB_DIR, directory), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) out.push(path.join(directory, entry.name));
    }
  }
  return out;
}

test('服务晚于本插件就绪时，RPC 路由仍会被注册（回归：面板 HTTP 405）', async () => {
  // 真实的 Cordis 组合里 `connection` / `webServer` 都由别的插件行提供，可能在本插件激活
  // **之后**才就绪。早先的实现是在 apply 时 `ctx.get('connection')` 取一次：那一刻拿到
  // undefined，于是 RPC 通道被**永久静默跳过**——工具照常注册（"插件看起来是好的"），
  // 但浏览器半连不上，面板显示 `transport failure for /xiangqi-mate/state: HTTP 405`。
  const cwd = await tempCwd();
  const ctx = createFakeCtx({ connection: false, webServer: false }); // ← apply 时刻意两个都没有
  const dispose = apply(ctx, testConfig({ saveDir: path.join(cwd, '.xiangqi-test') }));

  assert.equal(ctx.registrations.routes.has('/xiangqi-mate'), false, 'apply 时服务尚未就绪，此刻不应有路由');

  // 服务随后上线（Cordis 会触发等待中的 inject 回调 / 广播 internal/service）
  ctx.provide('connection', { admit: () => ({ peer: {} }), requestRejection: () => undefined });
  ctx.provide('webServer', {
    register(route) {
      ctx.registrations.routes.set(route.path, route);
      return async () => ctx.registrations.routes.delete(route.path);
    },
  });
  ctx.emit('internal/service', 'connection', ctx.get('connection'));

  assert.equal(
    ctx.registrations.routes.has('/xiangqi-mate'),
    true,
    '服务就绪后必须补上 RPC 路由，否则面板永远 405',
  );

  // 路由确实可用：打一个端点，应当得到结构化的（而非抛出的）应答。
  const route = ctx.registrations.routes.get('/xiangqi-mate');
  const reply = await callRoute(route)('state', { sessionId: 'session-late' });
  assert.equal(reply.ok, true, `路由应可用，实际：${JSON.stringify(reply).slice(0, 120)}`);

  await dispose();
  await rm(cwd, { recursive: true, force: true });
});

test('服务本来就绪时也必须注册（inject 的即时回调路径）', async () => {
  const app = await bootstrap();
  try {
    assert.equal(app.ctx.registrations.rpc.has('/xiangqi-mate'), true, 'connection 同步可用时应当立即注册');
  } finally {
    await app.cleanup();
  }
});

test('首次调用工具时惰性补偿：把「面板永久 405」降级成「调用一次即自愈」', async () => {
  // 工具调用**一定能到达宿主**，那一刻 connection/webServer 必然都已就绪。
  // 因此即使 apply 期与事件期都没挂上路由，这里也要补上。
  const cwd = await tempCwd();
  const ctx = createFakeCtx({ connection: false, webServer: false });
  const dispose = apply(ctx, testConfig({ saveDir: path.join(cwd, '.xiangqi-test') }));
  assert.equal(ctx.registrations.routes.has('/xiangqi-mate'), false);

  // 宿主完全起来了（但**不发** internal/service 事件，模拟事件路径也没生效的极端情况）
  ctx.provide('connection', { admit: () => ({ peer: {} }), requestRejection: () => undefined });
  ctx.provide('webServer', {
    register(route) {
      ctx.registrations.routes.set(route.path, route);
      return async () => ctx.registrations.routes.delete(route.path);
    },
  });

  const board = ctx.registrations.tools.get('xiangqi_board');
  assert.equal(typeof board?.execute, 'function');
  await board.execute({}, { agent: makeAgent({ id: 'session-self-heal', cwd }), signal: new AbortController().signal });
  assert.equal(
    ctx.registrations.routes.has('/xiangqi-mate'),
    true,
    '第一次调用工具后必须自愈',
  );

  await dispose();
  await rm(cwd, { recursive: true, force: true });
});
