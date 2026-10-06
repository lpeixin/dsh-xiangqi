/**
 * 模型输出的**形状容忍度**（§6.4 响应解析）。
 *
 * 为什么单独测这一层：真机上出现过「每手棋 2 次 API 调用、token 涨到 2 万、却全部降级成本地
 * 引擎」的现象，而面板把它显示成"模型超时"。真实原因是**模型的应答被我们自己拒了**。
 * 我们发给模型的 schema 是 `move: string`，但模型会给出各种等价写法；只认字符串就会把
 * 「模型其实答对了」判成「没给着法」→ 重试 → 降级。用户看到的是"模型不给力"，
 * 而真相是我们自己不认——所以把常见形状逐条钉住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decideFromOutput } from '../../lib/opponent/parse.js';
import { testEngine } from '../helpers/engine.mjs';

/**
 * 初始局面的解析上下文：红方走子、**人类执黑**（于是模型执红、轮它走）。
 *
 * 刻意不用 `hero: 'r'`——那样 `position.turn === hero` 会先命中原生硬约束
 * 「当前是人类的回合，模型不得替人类走子」，把要测的解析分支挡住。
 */
async function setup() {
  const engine = await testEngine();
  const position = engine.initialPosition();
  return { engine, position, candidates: engine.legalMoveCatalog(position), hero: 'b' };
}

test('工具参数的多种等价形状都能被接受（ICCS / 中文 / 对象 / from+to / iccs / candidateId）', async () => {
  const ctx = await setup();
  const shapes = [
    ['ICCS 字符串', { move: 'h2e2' }],
    ['中文记谱', { move: '炮二平五' }],
    ['嵌套对象 {from,to}', { move: { from: 'h2', to: 'e2' } }],
    ['顶层 from+to', { from: 'h2', to: 'e2' }],
    ['iccs 字段', { iccs: 'h2e2' }],
    ['candidateId', { candidateId: 'h2e2' }],
  ];
  for (const [label, args] of shapes) {
    const decision = decideFromOutput({
      engine: ctx.engine,
      position: ctx.position,
      candidates: ctx.candidates,
      toolCalls: [{ name: 'xiangqi_move', arguments: JSON.stringify(args) }],
      text: '',
      hero: ctx.hero,
    });
    assert.equal(decision.ok, true, `${label} 应当被接受，实际：${JSON.stringify(decision)}`);
    assert.equal(decision.iccs, 'h2e2', `${label} 应当落到 h2e2`);
  }
});

test('非法/不可识别的输出仍然被拒，且给出可读原因（不能为了宽容而放进非法着法）', async () => {
  const ctx = await setup();
  const cases = [
    ['目录外的 candidateId', { candidateId: 'a0a9' }],
    ['不存在的着法', { move: 'h2e9' }],
    ['几何合法但需自行判断的胡写', { move: '这不是着法' }],
    ['空参数', {}],
  ];
  for (const [label, args] of cases) {
    const decision = decideFromOutput({
      engine: ctx.engine,
      position: ctx.position,
      candidates: ctx.candidates,
      toolCalls: [{ name: 'xiangqi_move', arguments: JSON.stringify(args) }],
      text: '',
      hero: ctx.hero,
    });
    assert.equal(decision.ok, false, `${label} 必须被拒`);
    assert.equal(typeof decision.reasonZh, 'string');
    assert.ok(decision.reasonZh.length > 0, `${label} 要有可读原因`);
  }
});

test('拒绝时会指向"合法着法"，便于回灌后模型自纠', async () => {
  const ctx = await setup();
  const decision = decideFromOutput({
    engine: ctx.engine,
    position: ctx.position,
    candidates: ctx.candidates,
    toolCalls: [{ name: 'xiangqi_move', arguments: JSON.stringify({}) }],
    text: '',
    hero: ctx.hero,
  });
  assert.equal(decision.ok, false);
  assert.match(decision.reasonZh, /ICCS|中文记谱/, '提示要说明 move 该写什么形状');
});

test('不得替人类方走子：人类回合时一律拒绝（硬约束不能被宽容度破坏）', async () => {
  const ctx = await setup();
  const decision = decideFromOutput({
    engine: ctx.engine,
    position: ctx.position,
    candidates: ctx.candidates,
    toolCalls: [{ name: 'xiangqi_move', arguments: JSON.stringify({ move: 'h2e2' }) }],
    text: '',
    hero: 'r', // 红方是人类，而当前正是红方走子
  });
  assert.equal(decision.ok, false);
  assert.match(decision.reasonZh, /人类/);
});

test('没有工具调用时回退到文本里的 ICCS', async () => {
  const ctx = await setup();
  const decision = decideFromOutput({
    engine: ctx.engine,
    position: ctx.position,
    candidates: ctx.candidates,
    toolCalls: [],
    text: '我选择 h2e2 这一步。',
    hero: ctx.hero,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.iccs, 'h2e2');
  assert.equal(decision.source, 'text-iccs', '来源要标出是文本回退命中的 ICCS');
});
