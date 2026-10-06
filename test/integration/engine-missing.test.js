/**
 * 引擎降级路径（§5.3 的另一半）：引擎半成品/缺失时，
 * 插件**仍能装载**、工具**仍全部注册**，只在真正调用时给出清晰的中文错误。
 *
 * 这是 `lib/game/engine.js` 用动态 import + API 自检换来的性质，必须固化成测试，
 * 而不是让 stub 充当默认底座把问题掩盖过去。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply, TOOL_NAMES } from '../../lib/index.js';
import { bindEngine, engineFailure, REQUIRED_ENGINE_API } from '../../lib/game/engine.js';
import { createFakeCtx, makeAgent, makeExec } from '../helpers/fake-ctx.mjs';
import { testEngine } from '../helpers/engine.mjs';
import { testConfig } from '../helpers/bootstrap.mjs';

test('引擎 API 不齐时：插件照常装载、工具照常注册、调用时给出精准中文错误', async (t) => {
  const real = await testEngine(); // 先确认真实引擎可用，再故意把它换成半成品
  t.after(() => bindEngine(real));

  // 半成品：只有 initialPosition，其余 19 个 API 缺失。
  bindEngine({ initialPosition: real.initialPosition });

  const ctx = createFakeCtx({ services: {} });
  const agent = makeAgent({ id: 'session-broken', cwd: '/tmp' });
  const dispose = apply(ctx, testConfig());
  t.after(dispose);

  assert.equal(ctx.registrations.tools.size, TOOL_NAMES.length, '引擎不可用不得影响工具注册');
  assert.equal(ctx.registrations.commands.has('xiangqi'), true);

  const board = ctx.registrations.tools.get('xiangqi_board');
  await assert.rejects(() => board.execute({}, makeExec(agent)), /象棋引擎尚不可用：引擎缺少 API: /);

  const create = ctx.registrations.tools.get('xiangqi_new');
  await assert.rejects(() => create.execute({}, makeExec(agent)), /象棋引擎尚不可用/);

  const missing = REQUIRED_ENGINE_API.filter((name) => name !== 'initialPosition');
  assert.equal(engineFailure(), `引擎缺少 API: ${missing.join(', ')}`, '失败原因必须列为缺失清单');

  // 命令路径同样给出清晰错误，而不是崩溃。
  const handler = ctx.registrations.commands.get('xiangqi').handler;
  const result = await handler({ commandId: 'c1', agent, rawInput: 'state', attachments: [], signal: new AbortController().signal });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /象棋引擎/);
});

test('引擎模块整体缺失时：错误信息里带「不可用」而不是 TypeError', async (t) => {
  const real = await testEngine();
  t.after(() => bindEngine(real));
  // 用一个连 initialPosition 都没有的空模块模拟「模块加载失败」后的最坏情形。
  bindEngine({});
  const ctx = createFakeCtx({ services: {} });
  const dispose = apply(ctx, testConfig());
  t.after(dispose);
  const board = ctx.registrations.tools.get('xiangqi_board');
  await assert.rejects(() => board.execute({}, makeExec(makeAgent({ id: 's', cwd: '/tmp' }))), /象棋引擎尚不可用：引擎缺少 API/);
});
