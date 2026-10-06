/**
 * 测试脚手架：把「假 ctx + apply() + 真实/替代引擎」这套组合固定下来。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { apply } from '../../lib/index.js';
import { createFakeCtx, makeAgent, makeExec, settle } from './fake-ctx.mjs';
import { testEngine } from './engine.mjs';

/** 测试用配置：默认本地引擎对手（不触发模型调用），存档写入临时目录。 */
export function testConfig(overrides = {}) {
  return {
    opponent: { mode: 'local', timeoutMs: 1500, ...(overrides.opponent ?? {}) },
    local: { depth: 3, timeMs: 200, randomize: false, ...(overrides.local ?? {}) },
    rules: { ...(overrides.rules ?? {}) },
    ui: { ...(overrides.ui ?? {}) },
    saveDir: overrides.saveDir ?? '.xiangqi-test',
  };
}

/** 建立一个临时会话工作目录。 */
export async function tempCwd() {
  return mkdtemp(path.join(tmpdir(), 'xiangqi-mate-'));
}

/**
 * 启动插件。
 * @param {object} options `{ config, services, cwd, agentOptions }`
 */
export async function bootstrap(options = {}) {
  const engine = await testEngine();
  const cwd = options.cwd ?? (await tempCwd());
  // saveDir 用**绝对路径**指向本次的临时目录：跨半 RPC 的 payload 不带 cwd 时，
  // 存储会回落到 process.cwd()，绝对路径能保证测试永远不会污染仓库目录。
  const base = options.config ?? testConfig();
  const config = { ...base, saveDir: base.saveDir ?? path.join(cwd, '.xiangqi-test') };
  if (path.isAbsolute(config.saveDir) === false) config.saveDir = path.join(cwd, config.saveDir);
  const services = { ...(options.services ?? {}) };
  const ctx = createFakeCtx({ services });
  const agent = makeAgent({
    id: options.sessionId ?? 'session-test',
    cwd,
    options: options.agentOptions ?? {},
  });
  const dispose = apply(ctx, config);
  return {
    engine,
    ctx,
    cwd,
    agent,
    dispose,
    tools: ctx.registrations.tools,
    tool: (name) => {
      const definition = ctx.registrations.tools.get(name);
      if (definition === undefined) throw new Error(`工具未注册：${name}`);
      return definition;
    },
    exec: (target = agent, extra = {}) => makeExec(target, extra),
    settle,
    cleanup: async () => {
      await dispose();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
