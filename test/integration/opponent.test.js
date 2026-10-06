/**
 * 对手层集成测试（§4.4）：模型选择七级链、调用姿势、失败矩阵、revision 栅栏、用量上限。
 *
 * 全部通过假 `ctx.llm` 驱动，不需要真实模型。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeConfig } from '../../lib/index.js';
import { createGameService } from '../../lib/game/service.js';
import { createState } from '../../lib/game/state.js';
import { decideOpponentMove, freezeCandidates, localDecision } from '../../lib/opponent/fallback.js';
import { lowerEffort, resolveRoute } from '../../lib/opponent/route.js';
import { createFakeCtx, makeAgent } from '../helpers/fake-ctx.mjs';
import { testEngine } from '../helpers/engine.mjs';
import { createLlmStub } from '../helpers/llm-stub.mjs';
import { bootstrap, tempCwd, testConfig } from '../helpers/bootstrap.mjs';

const MODEL_CONFIG = normalizeConfig({ opponent: { mode: 'model', timeoutMs: 5000, maxRetries: 2 }, saveDir: '.xiangqi-test' }).value;

/** 造一个「轮到对手」的 playing 状态。 */
async function opponentTurnState(hero = 'b') {
  const engine = await testEngine();
  return { engine, state: { ...createState(engine, { config: MODEL_CONFIG }), hero, phase: 'playing' } };
}

function ctxWith(services) {
  return createFakeCtx({ services });
}

// ---------------------------------------------------------------- 七级链

test('模型选择：七级链的每一级单独可用（服务缺失时逐级降级）', async () => {
  const agent = makeAgent({ id: 's1' });

  // 1) Config 显式覆盖
  assert.deepEqual(
    resolveRoute(ctxWith({}), { opponent: { provider: 'cfg', model: 'cfg-m' } }, agent),
    { provider: 'cfg', model: 'cfg-m', source: 'config' },
  );
  // 2) sessionProjections.pending
  const projections = { stateOf: () => ({ pending: { provider: 'proj', model: 'proj-m', reasoningEffort: 'high' }, lastUsed: null }) };
  assert.deepEqual(
    resolveRoute(ctxWith({ sessionProjections: projections }), MODEL_CONFIG, agent),
    { provider: 'proj', model: 'proj-m', reasoningEffort: 'high', source: 'sessionProjections.pending' },
  );
  // 3) requestHeader().config
  const headerAgent = makeAgent({ requestHeader: () => ({ config: { provider: 'hdr', model: 'hdr-m', reasoningEffort: 'low' } }) });
  assert.deepEqual(
    resolveRoute(ctxWith({}), MODEL_CONFIG, headerAgent),
    { provider: 'hdr', model: 'hdr-m', reasoningEffort: 'low', source: 'requestHeader' },
  );
  // 3b) adapterDefaults.reasoningEffort === true 时必须抹掉 effort
  const adapterDefaultAgent = makeAgent({
    requestHeader: () => ({ config: { provider: 'hdr', model: 'hdr-m', reasoningEffort: 'high' }, adapterDefaults: { reasoningEffort: true } }),
  });
  assert.deepEqual(resolveRoute(ctxWith({}), MODEL_CONFIG, adapterDefaultAgent), { provider: 'hdr', model: 'hdr-m', source: 'requestHeader' });
  // 4) requestContext()
  const contextAgent = makeAgent({ requestContext: () => ({ provider: 'ctx', model: 'ctx-m', contextWindow: 1000 }) });
  assert.deepEqual(resolveRoute(ctxWith({}), MODEL_CONFIG, contextAgent), { provider: 'ctx', model: 'ctx-m', source: 'requestContext' });
  // 5) agent.options
  assert.deepEqual(resolveRoute(ctxWith({}), MODEL_CONFIG, makeAgent({ options: { provider: 'opt', model: 'opt-m' } })), { provider: 'opt', model: 'opt-m', source: 'agent.options' });
  // 6) agentDefaultModel.currentSelection()
  const defaultModel = { currentSelection: () => ({ provider: 'def', model: 'def-m' }) };
  assert.deepEqual(resolveRoute(ctxWith({ agentDefaultModel: defaultModel }), MODEL_CONFIG, agent), { provider: 'def', model: 'def-m', source: 'agentDefaultModel' });
  // 7) 都拿不到 → undefined（调用方降级到本地引擎）
  assert.equal(resolveRoute(ctxWith({}), MODEL_CONFIG, agent), undefined);
});

test('模型选择：优先级严格按七级顺序', async () => {
  const agent = makeAgent({
    options: { provider: 'opt', model: 'opt-m' },
    requestHeader: () => ({ config: { provider: 'hdr', model: 'hdr-m' } }),
    requestContext: () => ({ provider: 'ctx', model: 'ctx-m' }),
  });
  const services = {
    sessionProjections: { stateOf: () => ({ pending: { provider: 'proj', model: 'proj-m' } }) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'def', model: 'def-m' }) },
  };
  assert.equal(resolveRoute(ctxWith(services), { opponent: { provider: 'cfg', model: 'cfg-m' } }, agent).source, 'config');
  assert.equal(resolveRoute(ctxWith(services), MODEL_CONFIG, agent).source, 'sessionProjections.pending');
  const noPending = { sessionProjections: { stateOf: () => ({ pending: null, lastUsed: { provider: 'x', model: 'y' } }) } };
  assert.equal(resolveRoute(ctxWith({ ...services, ...noPending }), MODEL_CONFIG, agent).source, 'requestHeader');
  assert.equal(resolveRoute(ctxWith({ agentDefaultModel: services.agentDefaultModel }), MODEL_CONFIG, agent).source, 'requestHeader');
});

test('模型选择：某一级抛错或返回垃圾时静默降级，不冒泡', () => {
  const agent = makeAgent({ options: { provider: 'opt', model: 'opt-m' } });
  const services = {
    sessionProjections: { stateOf: () => { throw new Error('projection boom'); } },
    agentDefaultModel: { currentSelection: () => { throw new Error('default boom'); } },
  };
  const route = resolveRoute(ctxWith(services), MODEL_CONFIG, { ...agent, session: null });
  assert.deepEqual(route, { provider: 'opt', model: 'opt-m', source: 'agent.options' });
  assert.equal(resolveRoute(ctxWith(services), MODEL_CONFIG, makeAgent({})), undefined);
});

test('effort 降档：只降一档，最低档与未设置时返回 undefined', () => {
  const ladder = ['minimal', 'low', 'medium', 'high', 'max'];
  assert.equal(lowerEffort(ladder, 'high'), 'medium');
  assert.equal(lowerEffort(ladder, 'minimal'), undefined);
  assert.equal(lowerEffort(ladder, undefined), undefined);
});

// ---------------------------------------------------------------- 调用姿势与成功路径

test('调用姿势：只用 resolveCallConfig + stream，绝不 prepareCall', async () => {
  const { engine, state } = await opponentTurnState();
  const llm = createLlmStub([{ type: 'tool-call', args: { move: 'h2e2', reason: '中炮' } }]);
  llm.prepareCall = () => {
    throw new Error('绝不能调用 prepareCall');
  };
  const candidates = freezeCandidates(engine, state.position);
  const result = await decideOpponentMove({ ctx: ctxWith({ llm }), config: MODEL_CONFIG, agent: makeAgent({ options: { provider: 'stub', model: 'm' } }), engine, state, candidates, signal: new AbortController().signal });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'model');
  assert.equal(result.decision.iccs, 'h2e2');
  assert.equal(result.decision.provider, 'stub');
  assert.equal(llm.calls.length, 1);
  const request = llm.calls[0];
  assert.equal(request.provider, 'stub');
  assert.equal(request.model, 'm');
  assert.equal(request.maxTokens, 256);
  assert.equal(request.tools[0].name, 'xiangqi_move');
  assert.equal(typeof request.system, 'string');
  assert.match(request.system, /只走一步/);
  assert.match(request.messages[0].content[0].text, /h2e2 炮二平五/);
  assert.equal(request.signal instanceof AbortSignal, true);
});

test('解析：文本回退也能命中中文记谱，且歧义时判协议错误', async () => {
  const { engine, state } = await opponentTurnState();
  const candidates = freezeCandidates(engine, state.position);
  const viaText = createLlmStub([{ type: 'text', text: '我走 炮二平五，形成中炮。' }]);
  const ok = await decideOpponentMove({ ctx: ctxWith({ llm: viaText }), config: MODEL_CONFIG, agent: makeAgent({ options: { provider: 'stub', model: 'm' } }), engine, state, candidates, signal: new AbortController().signal });
  assert.equal(ok.ok, true);
  assert.equal(ok.decision.source, 'text-zh');
  assert.equal(ok.decision.iccs, 'h2e2');

  const ambiguous = createLlmStub([{ type: 'text', text: '可选 h2e2 或 b2b3，随便一步。' }, { type: 'text', text: '可选 h2e2 或 b2b3，随便一步。' }, { type: 'text', text: '可选 h2e2 或 b2b3，随便一步。' }]);
  const bad = await decideOpponentMove({ ctx: ctxWith({ llm: ambiguous }), config: MODEL_CONFIG, agent: makeAgent({ options: { provider: 'stub', model: 'm' } }), engine, state, candidates, signal: new AbortController().signal });
  assert.equal(bad.ok, true);
  assert.equal(bad.source, 'local', '歧义重试用尽后应由本地引擎代走');
  assert.equal(bad.calls, 3, '协议错误重试上限 = maxRetries(2) + 首次');
});

// ---------------------------------------------------------------- 失败矩阵

async function runWithReplies(replies, options = {}) {
  const { engine, state } = await opponentTurnState();
  const llm = createLlmStub(replies);
  const candidates = freezeCandidates(engine, state.position);
  const result = await decideOpponentMove({
    ctx: ctxWith({ llm }),
    config: options.config ?? MODEL_CONFIG,
    agent: makeAgent({ options: { provider: 'stub', model: 'm' } }),
    engine,
    state,
    candidates,
    signal: new AbortController().signal,
  });
  return { result, llm, engine, state };
}

test('失败矩阵：不可重试的错误码直接降级（各 1 次调用）', async () => {
  for (const code of ['NO_ADAPTER', 'MISSING_CREDENTIAL', 'AUTH', 'RATE_LIMIT', 'QUOTA']) {
    const { result, llm } = await runWithReplies([{ type: 'error', code }]);
    assert.equal(llm.calls.length, 1, `${code} 不应重试`);
    assert.equal(result.source, 'local', `${code} 应降级到本地引擎`);
    assert.ok(['ai.unavailable', 'ai.quota', 'ai.fallback.local'].includes(result.message.code), `${code} → ${result.message.code}`);
  }
});

test('失败矩阵：CONTEXT_WINDOW_EXCEEDED 缩短描述后重试一次', async () => {
  const { result, llm } = await runWithReplies([{ type: 'error', code: 'CONTEXT_WINDOW_EXCEEDED' }, { type: 'tool-call', args: { move: 'h2e2' } }]);
  assert.equal(llm.calls.length, 2);
  assert.match(llm.calls[0].messages.at(-1).content[0].text, /合法着法目录/);
  assert.ok(!llm.calls[1].messages.at(-1).content[0].text.includes('合法着法目录'), '第二次必须是精简包');
  assert.match(llm.calls[1].messages.at(-1).content[0].text, /FEN:/);
  assert.equal(result.source, 'model');
});

test('失败矩阵：UNSUPPORTED_REASONING_EFFORT 丢掉 effort 重试一次', async () => {
  const config = normalizeConfig({ opponent: { mode: 'model', provider: 'cfg', model: 'cfg-m', reasoningEffort: 'high', maxRetries: 0 } }).value;
  const { result, llm } = await runWithReplies([{ type: 'error', code: 'UNSUPPORTED_REASONING_EFFORT' }, { type: 'tool-call', args: { move: 'h2e2' } }], { config });
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.resolvedConfigs[0].reasoningEffort, 'high');
  assert.equal(llm.resolvedConfigs[1].reasoningEffort, undefined);
  assert.equal(result.source, 'model');
});

test('失败矩阵：max-tokens / 空文本降一档 effort 重试一次', async () => {
  const config = normalizeConfig({ opponent: { mode: 'model', provider: 'cfg', model: 'cfg-m', reasoningEffort: 'high', maxTokensPerMove: 128 } }).value;
  const truncated = await runWithReplies([{ type: 'max-tokens' }, { type: 'tool-call', args: { move: 'h2e2' } }], { config });
  assert.equal(truncated.llm.calls.length, 2);
  assert.equal(truncated.llm.resolvedConfigs[0].reasoningEffort, 'high');
  assert.equal(truncated.llm.resolvedConfigs[1].reasoningEffort, 'medium', '应付一档 effort');
  assert.equal(truncated.result.source, 'model');

  const empty = await runWithReplies([{ type: 'empty' }, { type: 'empty' }], { config });
  assert.equal(empty.llm.calls.length, 2, '空文本只降档重试一次');
  assert.equal(empty.result.source, 'local');
  assert.equal(empty.result.message.code, 'ai.fallback.local');
});

test('失败矩阵：aborted 不重试；其它错误码按自建退避重试 1 次', async () => {
  const aborted = await runWithReplies([{ type: 'aborted' }]);
  assert.equal(aborted.llm.calls.length, 1, 'aborted 绝不重试');
  assert.equal(aborted.result.source, 'local');
  assert.equal(aborted.result.message.code, 'ai.timeout');

  const other = await runWithReplies([{ type: 'error', code: 'SERVER_ERROR' }, { type: 'tool-call', args: { move: 'h2e2' } }]);
  assert.equal(other.llm.calls.length, 2, '其它错误码退避重试 1 次');
  assert.equal(other.result.source, 'model');

  const twice = await runWithReplies([{ type: 'error', code: 'SERVER_ERROR' }]);
  assert.equal(twice.llm.calls.length, 2, '退避重试只做一次');
  assert.equal(twice.result.source, 'local');
});

test('失败矩阵：resolveCallConfig 抛错也按错误码路由（不产生未捕获异常）', async () => {
  const { engine, state } = await opponentTurnState();
  const llm = {
    async resolveCallConfig() {
      const error = new Error('no adapter');
      error.code = 'NO_ADAPTER';
      throw error;
    },
    stream() {
      throw new Error('不应到达 stream');
    },
  };
  const result = await decideOpponentMove({ ctx: ctxWith({ llm }), config: MODEL_CONFIG, agent: makeAgent({ options: { provider: 'stub', model: 'm' } }), engine, state, signal: new AbortController().signal });
  assert.equal(result.source, 'local');
  assert.equal(result.message.code, 'ai.unavailable');
});

test('失败矩阵：模型输出非法着法 → 回灌「错误 + 合法着法目录」重试', async () => {
  const { result, llm } = await runWithReplies([
    { type: 'tool-call', args: { move: 'a0a9' } },
    { type: 'tool-call', args: { move: 'a0a9' } },
    { type: 'tool-call', args: { move: 'h2e2' } },
  ]);
  assert.equal(llm.calls.length, 3);
  const retryText = llm.calls[1].messages.at(-1).content[0].text;
  assert.match(retryText, /你上一次的输出无法接受/);
  assert.match(retryText, /合法着法目录/);
  assert.equal(result.source, 'model');
  assert.equal(result.decision.iccs, 'h2e2');
});

test('失败矩阵：替人类方走子（hero 回合）视为协议错误', async () => {
  const { engine, state } = await opponentTurnState('r');
  const llm = createLlmStub([{ type: 'tool-call', args: { move: 'h2e2' } }, { type: 'tool-call', args: { move: 'h2e2' } }, { type: 'tool-call', args: { move: 'h2e2' } }]);
  const result = await decideOpponentMove({ ctx: ctxWith({ llm }), config: MODEL_CONFIG, agent: makeAgent({ options: { provider: 'stub', model: 'm' } }), engine, state, signal: new AbortController().signal });
  assert.equal(llm.calls.length, 3);
  assert.equal(result.source, 'local', '人类回合时绝不接受模型着法');
});

test('失败矩阵：candidateId 不在冻结候选内 → 协议错误', async () => {
  const { result, llm } = await runWithReplies([
    { type: 'tool-call', args: { candidateId: 'z9z9' } },
    { type: 'tool-call', args: { candidateId: 'h2e2' } },
  ]);
  assert.equal(llm.calls.length, 2);
  assert.equal(result.source, 'model');
  assert.equal(result.decision.iccs, 'h2e2');
});

test('超时：20s（此处 60ms）到点即 abort，不重试并降级本地引擎', async () => {
  const config = normalizeConfig({ opponent: { mode: 'model', timeoutMs: 1000 } }).value;
  const { engine, state } = await opponentTurnState();
  const llm = createLlmStub([{ type: 'hang' }]);
  const ctx = ctxWith({ llm });
  ctx.timer.timeout = (callback, delay) => {
    const handle = setTimeout(callback, Math.min(delay, 60));
    return () => clearTimeout(handle);
  };
  const result = await decideOpponentMove({ ctx, config, agent: makeAgent({ options: { provider: 'stub', model: 'm' } }), engine, state, signal: new AbortController().signal });
  assert.equal(llm.calls.length, 1);
  assert.equal(result.source, 'local');
  assert.equal(result.message.code, 'ai.timeout');
});

test('本地兜底：searchBestMove 返回合法着法，且随机化可由配置关闭', async () => {
  const { engine, state } = await opponentTurnState();
  const decision = localDecision(engine, state.position, MODEL_CONFIG, 7);
  assert.equal(engine.isLegalMove(state.position, decision.move), true);
  assert.equal(decision.source, 'local');
  assert.match(decision.iccs, /^[a-i][0-9][a-i][0-9]$/);
  assert.equal(typeof decision.zh, 'string');
});

// ---------------------------------------------------------------- 全链路：用量、栅栏、上限

test('全链路：模型成功时累加 usage（FR23），并在本局上限后自动降级', async (t) => {
  const llm = createLlmStub([{ type: 'tool-call', args: { move: 'b9c7' }, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }]);
  const app = await bootstrap({
    config: testConfig({ opponent: { mode: 'model', maxTokensPerGame: 100 } }),
    services: { llm },
    agentOptions: { provider: 'stub', model: 'stub-model' },
  });
  t.after(app.cleanup);
  const command = app.ctx.registrations.commands.get('xiangqi');
  await command.handler({ commandId: 'c1', agent: app.agent, rawInput: 'move a3a4', attachments: [], signal: new AbortController().signal });
  await app.settle();
  const afterFirst = await app.tool('xiangqi_board').execute({ includeMoves: false }, app.exec());
  assert.equal(afterFirst.ok, true);
  assert.equal(afterFirst.turn, 'r');
  assert.equal(afterFirst.historyZh.length, 2, '人一手 + 模型一手');

  const snapshot = await command.handler({ commandId: 'c2', agent: app.agent, rawInput: 'state', attachments: [], signal: new AbortController().signal });
  const usage = JSON.parse(snapshot.text).usage;
  assert.equal(usage.totalTokens, 120);
  assert.equal(usage.calls, 1);

  // 再走一手：本局用量已超上限 → 不再请求模型，直接本地代走并给出 ai.budget。
  await command.handler({ commandId: 'c3', agent: app.agent, rawInput: 'move a0a1', attachments: [], signal: new AbortController().signal });
  await app.settle();
  const budgetSnapshot = JSON.parse((await command.handler({ commandId: 'c4', agent: app.agent, rawInput: 'state', attachments: [], signal: new AbortController().signal })).text);
  assert.equal(budgetSnapshot.opponent.kind, 'local');
  assert.equal(budgetSnapshot.opponent.label, '本地引擎');
  assert.equal(llm.calls.length, 1, '超限后不得再请求模型');
});

test('全链路：revision 栅栏 —— 模型结果晚到时不落子，也不留残留 pending', async (t) => {
  const engine = await testEngine();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const llm = {
    async resolveCallConfig(config) {
      return { ...config };
    },
    stream() {
      return (async function* pending() {
        await gate;
        const args = JSON.stringify({ move: 'h2e2' });
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'tc', name: 'xiangqi_move', arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      })();
    },
  };
  const app = await bootstrap({
    config: testConfig({ opponent: { mode: 'model', timeoutMs: 60000 } }),
    services: { llm },
    agentOptions: { provider: 'stub', model: 'stub-model' },
  });
  t.after(async () => {
    release();
    await app.cleanup();
  });
  await app.tool('xiangqi_new').execute({ side: 'b' }, app.exec());
  await app.settle();
  const thinking = await app.tool('xiangqi_board').execute({ includeMoves: false }, app.exec());
  assert.equal(thinking.pending, 'ai-thinking');

  // 人类执黑 → 红方是对手；用工具替对手落子，随后放行迟到的模型结果。
  const played = await app.tool('xiangqi_move').execute({ move: 'g3g4' }, app.exec());
  assert.equal(played.ok, true);
  release();
  await app.settle();
  const final = await app.tool('xiangqi_board').execute({ includeMoves: false }, app.exec());
  assert.equal(final.historyZh.length, 1, '迟到的模型结果必须被 revision 栅栏丢弃');
  assert.equal(final.pending, null);
  assert.equal(engine.positionToFen(engine.positionFromFen(final.fen)) === final.fen, true);
});
