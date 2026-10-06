/**
 * 工具契约单测（§9.1「契约单测」）。
 *
 * 覆盖：每个工具的入参校验、返回形状**逐个键**核对 `output.schema` + 无损 JSON、
 * 错误分支、`describePosition` 输出稳定性。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_NAMES } from '../../lib/index.js';
import { assertSupportedSchema, assertToolOutput } from '../helpers/schema-check.mjs';
import { bootstrap, testConfig } from '../helpers/bootstrap.mjs';
import { createLlmStub } from '../helpers/llm-stub.mjs';
import { engineChoice, stubForced } from '../helpers/engine.mjs';

test('引擎来源自检：默认必须使用真实引擎（缺失即红灯，禁止假绿）', { skip: stubForced() ? 'XIANGQI_ENGINE=stub 已显式启用替身' : false }, async (t) => {
  const app = await bootstrap();
  try {
    const choice = engineChoice();
    // 用 node:test 的 diagnostic 而不是裸写 stdout：后者会与测试运行器的 IPC 抢同一个通道，
    // 在整仓并发跑时表现为 `Unable to deserialize cloned data` 的 uncaughtException。
    t.diagnostic(`引擎来源: ${choice.source}`);
    assert.equal(choice.source, 'real', `必须使用 lib/engine/** 的真实引擎，实际 ${choice.source}（缺失：${choice.missing.join(', ')}）`);
    assert.equal(choice.missing.length, 0);
    assert.equal(typeof app.engine.initialPosition, 'function');
    assert.equal(app.engine.generateMoves(app.engine.initialPosition()).length, 44);
  } finally {
    await app.cleanup();
  }
});

test('六个工具都注册成功，且 schema 使用宿主支持的子集', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  assert.deepEqual([...app.tools.keys()].sort(), [...TOOL_NAMES].sort());
  for (const name of TOOL_NAMES) {
    const definition = app.tool(name);
    assert.equal(definition.name, name);
    assert.equal(typeof definition.description, 'string');
    assert.ok(definition.description.length > 10, `${name}: description 太短`);
    assert.equal(typeof definition.execute, 'function');
    assert.ok(definition.output !== undefined, `${name}: output 必填`);
    assertSupportedSchema(definition.output.schema, `${name}.output.schema`);
    assert.equal(typeof definition.output.render, 'function');
    assert.ok(Object.hasOwn(definition.parameters ?? {}, 'type'), `${name}: parameters 必须是 JSON Schema`);
  }
  // 并发性声明：只有 board 是并发安全的。
  assert.equal(typeof app.tool('xiangqi_board').isConcurrencySafe, 'function');
  assert.equal(app.tool('xiangqi_board').isConcurrencySafe(), true);
  for (const name of ['xiangqi_new', 'xiangqi_move', 'xiangqi_undo']) {
    assert.equal(app.tool(name).isConcurrencySafe, undefined, `${name} 必须串行`);
  }
});

test('xiangqi_new：默认红方先行，返回标准初始局面与 44 个合法着法', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const definition = app.tool('xiangqi_new');
  const value = await definition.execute({}, app.exec());
  assertToolOutput(definition, value, {});
  assert.equal(value.ok, true);
  assert.equal(value.turn, 'r');
  assert.equal(value.hero, 'r');
  assert.equal(value.opponent.kind, 'local');
  assert.equal(value.opponent.label, '本地引擎');
  assert.equal(value.opponent.provider, null);
  assert.equal(value.phase, 'playing');
  assert.equal(value.fen, 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
  assert.equal(value.legalCount, 44);
  assert.match(value.boardText, /楚 河/);
  assert.match(value.boardText, /R {2}N {2}B {2}A {2}K {2}A {2}B {2}N {2}R/);
  assert.match(value.boardText, /棋谱：（空）/);
});

test('卡片正文必须把模型需要的结构化信息带全（模型唯一能看到的就是 render）', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const definition = app.tool('xiangqi_board');
  const value = await definition.execute({ includeMoves: true, includeEval: true, ascii: true }, app.exec());
  assertToolOutput(definition, value, {});
  const text = definition.output.render({ includeMoves: true, includeEval: true, ascii: true }, value).map((block) => block.text).join('\n');
  assert.match(text, /FEN: /, '正文必须含 FEN');
  assert.match(text, /合法着法/, '正文必须含合法着法目录（否则模型只能猜坐标）');
  assert.match(value.legalMoves[0].iccs, /^[a-i][0-9][a-i][0-9]$/);
  assert.ok(text.includes(value.legalMoves[0].iccs), '目录里的 ICCS 必须真的出现在正文里');
  assert.match(text, /评估：/, 'includeEval: true 时正文必须含评估');
  assert.equal(typeof value.evalSummaryZh, 'string');

  // 三个「会落子/开局/悔棋」的工具同样要带着法目录，模型才不用多跑一轮。
  const command = app.ctx.registrations.commands.get('xiangqi');
  await command.handler({ commandId: 'c1', agent: app.agent, rawInput: 'move h2e2', attachments: [], signal: new AbortController().signal });
  await app.settle();
  for (const name of ['xiangqi_new', 'xiangqi_board', 'xiangqi_move', 'xiangqi_undo', 'xiangqi_hint']) {
    const tool = app.tool(name);
    const args = name === 'xiangqi_move' ? { move: 'a0a1' } : { plies: 1 };
    const result = await tool.execute(args, app.exec());
    assertToolOutput(tool, result, args);
    const rendered = tool.output.render(args, result).map((block) => block.text).join('\n');
    assert.ok(rendered.length > 10, `${name}: 正文太短`);
    if (result.ok === true) {
      assert.match(rendered, /FEN: /, `${name}: 正文必须含 FEN`);
      assert.match(rendered, /合法着法/, `${name}: 正文必须含合法着法目录`);
    } else {
      assert.match(rendered, /无法完成/, `${name}: 失败正文必须给出原因`);
    }
  }
});

test('xiangqi_board：默认带合法着法目录；includeEval/includeMoves/ascii 生效', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const definition = app.tool('xiangqi_board');
  const full = await definition.execute({}, app.exec());
  assertToolOutput(definition, full, {});
  assert.equal(full.legalMoves.length, 44);
  assert.equal(full.legalCount, 44);
  assert.deepEqual(full.historyZh, []);
  assert.equal(full.lastMove, null);
  assert.equal(full.evalSummaryZh, undefined);
  assert.ok(full.legalMoves.some((entry) => entry.iccs === 'h2e2' && entry.zh === '炮二平五'));

  const lean = await definition.execute({ includeMoves: false, includeEval: true, ascii: false }, app.exec());
  assertToolOutput(definition, lean, {});
  assert.equal(lean.legalMoves, undefined);
  assert.equal(typeof lean.evalSummaryZh, 'string');
  assert.ok(!lean.boardText.includes('楚 河'));

  await assert.rejects(() => definition.execute({ includeMoves: 'yes' }, app.exec()), /includeMoves 必须是布尔值/);
  await assert.rejects(() => definition.execute('nope', app.exec()), /参数必须是一个对象/);
});

test('xiangqi_move：替人类方走子被拒，并返回合法着法目录', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const definition = app.tool('xiangqi_move');
  const value = await definition.execute({ move: 'h2e2' }, app.exec());
  assertToolOutput(definition, value, {});
  assert.equal(value.ok, false);
  assert.equal(value.error, 'NOT_YOUR_TURN');
  assert.match(value.errorZh, /不是对手的回合/);
  assert.equal(value.legalMoves.length, 44);
});

test('xiangqi_move：非法着法返回结构化错误 + 合法着法目录；缺参数抛中文错误', async (t) => {
  const app = await bootstrap({ config: testConfig({ opponent: { mode: 'model', timeoutMs: 30000 } }), services: { llm: createLlmStub([{ type: 'hang' }]) }, agentOptions: { provider: 'stub', model: 'stub-model' } });
  t.after(app.cleanup);
  const definition = app.tool('xiangqi_move');
  await assert.rejects(() => definition.execute({}, app.exec()), /缺少参数 move/);
  await assert.rejects(() => definition.execute({ move: 42 }, app.exec()), /move 必须是字符串/);
  await assert.rejects(() => definition.execute({ move: 'h2e2', reason: 7 }, app.exec()), /reason 必须是字符串/);

  // 让局面轮到对手（人类执黑），此时非法着法应返回 ILLEGAL_MOVE + 目录。
  await app.tool('xiangqi_new').execute({ side: 'b', opponent: 'model' }, app.exec());
  await app.settle();
  const bad = await definition.execute({ move: 'e0e3' }, app.exec());
  assertToolOutput(definition, bad, {});
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'ILLEGAL_MOVE');
  assert.ok(bad.legalMoves.length > 0);
  const outside = await definition.execute({ move: 'zz99' }, app.exec());
  assert.equal(outside.ok, false);
  assert.equal(outside.error, 'ILLEGAL_MOVE');
});

test('xiangqi_move：对手回合时模型可以落子（并在 revision 栅栏下胜出）', async (t) => {
  // 人类执黑 → 开局轮到红方（对手）。让模型请求挂起，制造 pending='ai-thinking'，
  // 此时工具仍应接受对手着法，并由 revision 栅栏丢弃后台结果。
  const llm = createLlmStub([{ type: 'hang' }]);
  const app = await bootstrap({
    config: testConfig({ opponent: { mode: 'model', timeoutMs: 30000 } }),
    services: { llm },
    agentOptions: { provider: 'stub', model: 'stub-model' },
  });
  t.after(app.cleanup);
  const create = app.tool('xiangqi_new');
  const created = await create.execute({ side: 'b', opponent: 'model' }, app.exec());
  assertToolOutput(create, created, {});
  await app.settle();
  assert.equal(created.turn, 'r');

  const definition = app.tool('xiangqi_move');
  const value = await definition.execute({ move: 'h2e2', reason: '架中炮' }, app.exec());
  assertToolOutput(definition, value, {});
  assert.equal(value.ok, true);
  assert.equal(value.played.iccs, 'h2e2');
  assert.equal(value.played.zh, '炮二平五');
  assert.equal(value.turn, 'b');
  assert.equal(value.aiTurn, false);
  assert.notEqual(value.fen, created.fen);
});

test('xiangqi_undo：默认撤 2 手；无棋谱时返回结构化错误', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const definition = app.tool('xiangqi_undo');
  const empty = await definition.execute({}, app.exec());
  assertToolOutput(definition, empty, {});
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'NO_HISTORY');

  // 用命令走一手（人类），本地引擎会自动应招；随后悔棋 2 手回到初始局面。
  const ctx = app.ctx;
  const command = ctx.registrations.commands.get('xiangqi');
  const played = await command.handler({ commandId: 'c1', agent: app.agent, rawInput: 'move h2e2', attachments: [], signal: new AbortController().signal });
  assert.equal(played.kind, 'success');
  await app.settle();

  const undone = await definition.execute({ plies: 2 }, app.exec());
  assertToolOutput(definition, undone, {});
  assert.equal(undone.ok, true);
  assert.equal(undone.plies, 2);
  assert.equal(undone.fen, 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
  assert.deepEqual(undone.historyZh, []);

  await assert.rejects(() => definition.execute({ plies: 0 }, app.exec()), /plies 必须在 1–200 之间/);
  await assert.rejects(() => definition.execute({ plies: 1.5 }, app.exec()), /plies 必须是整数/);
});

test('xiangqi_hint：给出候选与评估摘要，且不消耗模型额度', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const definition = app.tool('xiangqi_hint');
  const value = await definition.execute({ count: 3 }, app.exec());
  assertToolOutput(definition, value, {});
  assert.equal(value.ok, true);
  assert.equal(value.candidates.length, 3);
  for (const candidate of value.candidates) {
    assert.equal(typeof candidate.iccs, 'string');
    assert.match(candidate.iccs, /^[a-i][0-9][a-i][0-9]$/);
    assert.ok(Array.isArray(candidate.pv) && candidate.pv.length >= 1);
    assert.equal(typeof candidate.score, 'number');
  }
  assert.equal(typeof value.evalSummaryZh, 'string');
  assert.ok(value.depth >= 1);
  await assert.rejects(() => definition.execute({ count: 9 }, app.exec()), /count 必须在 1–5 之间/);
});

test('xiangqi_review：返回棋谱、转折点与评估曲线', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const command = app.ctx.registrations.commands.get('xiangqi');
  await command.handler({ commandId: 'c1', agent: app.agent, rawInput: 'move h2e2', attachments: [], signal: new AbortController().signal });
  await app.settle();
  const definition = app.tool('xiangqi_review');
  const value = await definition.execute({ highlight: 'all' }, app.exec());
  assertToolOutput(definition, value, {});
  assert.equal(value.ok, true);
  assert.ok(value.historyZh.length >= 1);
  assert.ok(value.evalCurve.length >= 2, '双方各走一手后应有两手评估');
  assert.ok(value.turningPoints.length >= 1);
  assert.match(value.finalFen, / w | b /);
  await assert.rejects(() => definition.execute({ highlight: 'x' }, app.exec()), /highlight 只能是/);
});

test('describePosition 输出稳定（同局面两次调用完全一致，且含 FEN）', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const engine = app.engine;
  const position = engine.initialPosition();
  const first = engine.describePosition(position, { includeMoves: true, includeEval: true });
  const second = engine.describePosition(position, { includeMoves: true, includeEval: true });
  assert.equal(typeof first, 'string');
  assert.equal(first, second);
  assert.ok(first.includes(engine.positionToFen(position)));
});

test('工具返回值全部是无损 JSON（对所有工具跑一遍 schema + 深检查）', async (t) => {
  const app = await bootstrap();
  t.after(app.cleanup);
  const exec = app.exec();
  const cases = [
    ['xiangqi_new', {}],
    ['xiangqi_board', {}],
    ['xiangqi_move', { move: 'h2e2' }],
    ['xiangqi_undo', { plies: 2 }],
    ['xiangqi_hint', { count: 2 }],
    ['xiangqi_review', {}],
  ];
  for (const [name, args] of cases) {
    const definition = app.tool(name);
    const value = await definition.execute(args, exec);
    const text = assertToolOutput(definition, value, args);
    assert.ok(text.length > 0, `${name}: render 文本为空`);
  }
});
