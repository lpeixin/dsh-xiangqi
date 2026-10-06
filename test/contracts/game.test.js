/**
 * 对局层契约单测（§6.3）：状态机的纯转移、计时、棋谱紧凑化、按会话持久化，
 * 以及 sessionId 的白名单清洗（防路径穿越）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { normalizeConfig } from '../../lib/index.js';
import { addMs, createClock, formatDuration, totalMs } from '../../lib/game/clock.js';
import { asciiBoard, boardText, fromCompact, historyZh, toCompact } from '../../lib/game/records.js';
import { createGameService } from '../../lib/game/service.js';
import { createOpponentPort } from '../../lib/opponent/fallback.js';
import { advance, computeStatus, createState, legalTargets, project, restoreState, truncate } from '../../lib/game/state.js';
import { createStore, sanitizeSessionId } from '../../lib/game/store.js';
import { createFakeCtx } from '../helpers/fake-ctx.mjs';
import { testEngine } from '../helpers/engine.mjs';
import { tempCwd } from '../helpers/bootstrap.mjs';

const CONFIG = normalizeConfig({ opponent: { mode: 'local' }, saveDir: '.xiangqi-test' }).value;

test('sanitizeSessionId：白名单清洗，阻止路径穿越', () => {
  assert.equal(sanitizeSessionId('../../etc/passwd'), '______etc_passwd');
  assert.equal(sanitizeSessionId('a/b\\c:d*e'), 'a_b_c_d_e');
  assert.equal(sanitizeSessionId('session-1_ok'), 'session-1_ok');
  assert.equal(sanitizeSessionId(''), 'default');
  assert.equal(sanitizeSessionId(undefined), 'default');
  assert.equal(sanitizeSessionId('x'.repeat(500)).length, 120);
  assert.ok(!sanitizeSessionId('..%2f..%2f').includes('/'));
});

test('store：文件后端原子写、可读回，且不残留 .tmp', async () => {
  const cwd = await tempCwd();
  const ctx = createFakeCtx({ services: {} });
  const store = createStore({ config: CONFIG, ctx });
  const record = { v: 1, moves: [{ i: 'h2e2', f: 70, t: 67, c: '', m: 12, s: 'r' }] };
  assert.equal(await store.save('session-a', cwd, record), true);
  assert.equal(store.mode, 'file');
  assert.equal(store.persistent, true);
  const files = await readdir(path.join(cwd, '.xiangqi-test'));
  assert.deepEqual(files, ['session-a.json']);
  assert.deepEqual(await store.load('session-a', cwd), record);
  assert.equal(await store.load('nobody', cwd), undefined);
  await store.remove('session-a', cwd);
  assert.deepEqual(await readdir(path.join(cwd, '.xiangqi-test')), []);
});

test('store：磁盘不可写时降级到进程内 Map，并如实报告「不会被保存」', async () => {
  const ctx = createFakeCtx({ services: {} });
  const config = normalizeConfig({ saveDir: '/dev/null/xiangqi' }).value;
  const store = createStore({ config, ctx });
  const record = { v: 1, moves: [] };
  assert.equal(await store.save('session-a', '/dev/null', record), false);
  assert.equal(store.mode, 'memory');
  assert.equal(store.persistent, false);
  assert.deepEqual(await store.load('session-a', '/dev/null'), record, '内存后端仍要能读回本进程内的局面');
  assert.match(store.info().detail, /磁盘写入失败/);
});

test('store：ctx.storageDomain 存在但不可用时清晰降级到文件后端', async () => {
  const cwd = await tempCwd();
  const failing = { open: async () => { throw new Error('backend-not-found'); } };
  const ctx = createFakeCtx({ services: { storageDomain: failing } });
  const store = createStore({ config: CONFIG, ctx });
  assert.equal(await store.save('session-a', cwd, { v: 1, moves: [] }), true);
  assert.equal(store.mode, 'file');
});

test('state：revision 单调递增，pending 状态机与终局都成立', async () => {
  const engine = await testEngine();
  let state = createState(engine, { config: CONFIG });
  assert.equal(state.phase, 'idle');
  assert.equal(state.pending, null);
  assert.equal(state.revision, 1);
  const move = engine.iccsToMove(state.position, 'h2e2');
  state = advance(state, engine, move, { ms: 1500, config: CONFIG });
  assert.equal(state.revision, 2);
  assert.equal(state.phase, 'playing');
  assert.equal(state.pending, null);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].iccs, 'h2e2');
  assert.equal(state.history[0].zh, '炮二平五');
  assert.equal(state.history[0].ms, 1500);
  assert.equal(state.position.turn, 'b');
  assert.equal(state.clockMs.red, 1500);
  assert.equal(state.clockMs.black, 0);
  assert.equal(state.fens.length, 2);

  const back = truncate(state, engine, 1, CONFIG);
  assert.equal(back.revision, state.revision + 1);
  assert.equal(back.history.length, 0);
  assert.equal(back.position.turn, 'r');
  assert.equal(back.clockMs.red, 1500, '悔棋不退还计时（与 §7.4 口径一致）');
});

test('state：紧凑持久化 + 重放可完整还原局面', async () => {
  const engine = await testEngine();
  let state = createState(engine, { config: CONFIG });
  for (const iccs of ['h2e2', 'b7e7', 'h0g2']) {
    const move = engine.iccsToMove(state.position, iccs);
    assert.ok(move !== null, `着法应当合法：${iccs}`);
    state = advance(state, engine, move, { ms: 100, config: CONFIG });
  }
  const compact = toCompact(state.history);
  assert.ok(compact.every((entry) => typeof entry.f === 'number' && typeof entry.t === 'number' && typeof entry.c === 'string'));
  assert.ok(compact.every((entry) => !('fenBefore' in entry) && !('fenAfter' in entry)), '紧凑形式不得存整盘 FEN');

  const replayed = fromCompact(engine, state.initialFen, compact);
  assert.equal(engine.positionToFen(replayed.position), engine.positionToFen(state.position));
  assert.deepEqual(replayed.history.map((entry) => entry.zh), state.history.map((entry) => entry.zh));

  const restored = restoreState(engine, { gameId: state.gameId, initialFen: state.initialFen, hero: 'r', opponent: 'local', moves: compact, clockMs: state.clockMs }, CONFIG);
  assert.equal(restored.position.turn, state.position.turn);
  assert.equal(restored.history.length, 3);
  assert.equal(restored.clockMs.red, 200);
  assert.equal(restored.clockMs.black, 100);
});

test('clock：累加、总计与格式化', () => {
  let clock = createClock();
  clock = addMs(clock, 'r', 1000);
  clock = addMs(clock, 'black', 2000);
  clock = addMs(clock, 'r', -5);
  assert.deepEqual(clock, { red: 1000, black: 2000 });
  assert.equal(totalMs(clock), 3000);
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(61_000), '01:01');
  assert.equal(formatDuration(3_661_000), '1:01:01');
});

test('projection：§7.5.4 投影的形状与 legalTargets', async () => {
  const engine = await testEngine();
  const state = createState(engine, { config: CONFIG });
  const targets = legalTargets(engine, state.position);
  const data = project(state, engine, targets);
  assert.equal(data.ok, true);
  assert.equal(data.revision, 1);
  assert.equal(data.turn, 'r');
  assert.equal(data.hero, 'r');
  assert.equal(data.phase, 'idle');
  assert.equal(data.pending, null);
  assert.equal(data.board.length, 90);
  assert.equal(data.lastMove, null);
  assert.deepEqual(data.history, []);
  assert.equal(data.error, null);
  assert.equal(data.message, null);
  const moves = Object.values(targets).reduce((sum, list) => sum + list.length, 0);
  assert.equal(moves, 44);
});

test('boardText：状态行 + ASCII 棋盘 + 中文记谱', async () => {
  const engine = await testEngine();
  let state = createState(engine, { config: CONFIG });
  const move = engine.iccsToMove(state.position, 'h2e2');
  state = advance(state, engine, move, { ms: 0, config: CONFIG });
  const text = boardText(state);
  assert.match(text, /第 2 手/);
  assert.match(text, /你执红方/);
  assert.match(text, /楚 河/);
  assert.match(text, /炮二平五/);
  assert.match(asciiBoard(state.position), /R {2}N {2}B {2}A {2}K/);
  assert.deepEqual(historyZh(state.history), ['1. 炮二平五']);
});

test('持久化按会话隔离：重开服务后仍能读回同一局', async () => {
  const cwd = await tempCwd();
  const engine = await testEngine();
  const make = () => {
    const ctx = createFakeCtx({ services: {} });
    const service = createGameService({ ctx, config: CONFIG, track: () => {}, opponent: createOpponentPort(ctx, CONFIG) });
    return { ctx, service };
  };
  const first = make();
  const state = await first.service.newGame({ id: 'session-a', cwd, agent: undefined });
  const move = engine.iccsToMove(state.position, 'h2e2');
  await first.service.playMove({ id: 'session-a', cwd, agent: undefined, actor: 'hero', input: engine.moveToIccs(move), ms: 10 });
  await first.service.dispose();

  const second = make();
  const reloaded = await second.service.load('session-a', cwd);
  assert.equal(reloaded.history.length >= 1, true);
  assert.equal(reloaded.history[0].iccs, 'h2e2');
  const other = await second.service.load('session-b', cwd);
  assert.equal(other.history.length, 0, '另一个会话必须是全新对局');
  await second.service.dispose();
});

test('自然限着以**配置**为准：调严与调宽都必须生效（回归 §6.5 的 rules.fiftyMovePlies）', async () => {
  const engine = await testEngine();
  const at = (halfmove) => engine.positionFromFen(`3k5/9/9/9/9/9/9/9/9/4K4 w - - ${halfmove} 61`);
  const statusAt = (halfmove, fiftyMovePlies) =>
    // computeStatus(engine, position, fens, config, history)
    computeStatus(engine, at(halfmove), [], { rules: { fiftyMovePlies } }, []).state;

  // 调宽：引擎内部常量是 120，配置放宽到 200 时，120 半回合处必须仍在进行。
  // （这里曾有一个真 bug：引擎先返回 draw-fifty，state 层因 TERMINAL_STATES 短路而撤销不了，
  //   于是"调宽"这个配置完全是死的。）
  assert.equal(statusAt(120, 200), 'playing', '放宽到 200 后，120 半回合处不应判和');
  assert.equal(statusAt(210, 200), 'draw-fifty', '超过放宽后的阈值仍要判和');

  // 调严：低于引擎常量的阈值也必须生效。
  assert.equal(statusAt(80, 60), 'draw-fifty', '收紧到 60 后，80 半回合处应判和');

  // 默认值（与引擎常量一致）不回归。
  assert.equal(statusAt(120, 120), 'draw-fifty');
  assert.equal(statusAt(80, 120), 'playing');
});
