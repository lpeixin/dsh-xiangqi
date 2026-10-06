/**
 * perft 基准单测（§5.8.1 / §5.8.2）。
 *
 * depth 1–3 是 CI 必过项（毫秒级），depth 4 只对初始局面跑一次（约 0.6 s）——
 * 它是最强的回归网：nodes/checks/captures 三列同时相等，说明的是生成、攻击判定、
 * 将军识别三件事都对，而不是数量凑巧相同。
 *
 * `perft` 住在 `scripts/perft.mjs`（验证工具，不属于 §5.3 公开面），
 * 这里用动态 import 取它，避免静态相对 import 带上 `.mjs`（§9.3 只允许 `.js`）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { positionFromFen, positionToFen } from '../../lib/engine/index.js';

const { perft } = await import('../../scripts/perft.mjs');
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/perft.json', import.meta.url), 'utf8'));

const initial = FIXTURE.positions.find((item) => item.id === 'initial');
const midgames = FIXTURE.positions.filter((item) => item.id !== 'initial');

test('夹具来源与 mates 列口径被显式记录', () => {
  assert.match(FIXTURE.source, /chessprogramming\.org/);
  assert.match(FIXTURE.note, /mates/);
  assert.equal(initial.levels.find((level) => level.depth === 1).nodes, 44);
});

test('初始局面：depth 1–3 完全相等', () => {
  const pos = positionFromFen(initial.fen);
  for (const level of initial.levels.filter((item) => item.depth <= 3)) {
    const result = perft(pos, level.depth, { stats: true });
    assert.equal(result.nodes, level.nodes, `depth ${level.depth} 节点数`);
    assert.equal(result.checks, level.checks, `depth ${level.depth} 将军数`);
    assert.equal(result.captures, level.captures, `depth ${level.depth} 吃子数`);
    assert.equal(result.mates, level.mates, `depth ${level.depth} 将死数`);
  }
});

test('初始局面：depth 4 也完全相等（慢速回归）', () => {
  const level = initial.levels.find((item) => item.depth === 4);
  const result = perft(positionFromFen(initial.fen), 4, { stats: true });
  assert.equal(result.nodes, level.nodes);
  assert.equal(result.checks, level.checks);
  assert.equal(result.captures, level.captures);
  assert.equal(result.mates, level.mates);
});

test('depth 4 只数节点时更快且节点数一致', () => {
  const level = initial.levels.find((item) => item.depth === 4);
  const result = perft(positionFromFen(initial.fen), 4, { stats: false });
  assert.equal(result.nodes, level.nodes);
  assert.equal(result.checks, 0, 'stats=false 时不统计');
});

for (const item of midgames) {
  test(`${item.name}：depth 1–3 完全相等`, () => {
    const pos = positionFromFen(item.fen);
    for (const level of item.levels.filter((entry) => entry.depth <= 3)) {
      const result = perft(pos, level.depth, { stats: true });
      assert.equal(result.nodes, level.nodes, `depth ${level.depth} 节点数`);
      assert.equal(result.checks, level.checks, `depth ${level.depth} 将军数`);
      assert.equal(result.captures, level.captures, `depth ${level.depth} 吃子数`);
      assert.equal(result.mates, level.mates, `depth ${level.depth} 将死数`);
    }
  });
}

test('perft 的边界：depth 0 计 1 个节点，负深度不抛异常', () => {
  const pos = positionFromFen(initial.fen);
  assert.equal(perft(pos, 0).nodes, 1);
  assert.equal(perft(pos, -1).nodes, 0);
});

test('perft 提供进度回调（depth ≥4 的进度输出依赖它）', () => {
  const calls = [];
  perft(positionFromFen(initial.fen), 2, { onProgress: (done, total, nodes) => calls.push([done, total, nodes]) });
  assert.equal(calls.length, 44, '每个根着法回调一次');
  assert.deepEqual(calls[0][0], 1);
  assert.equal(calls[calls.length - 1][1], 44);
  assert.ok(calls[calls.length - 1][2] > 0);
  assert.equal(calls[calls.length - 1][2], 1920);
});

test('h/e 方言 FEN 归一化后再跑 perft（防止方言回归）', () => {
  const pos = positionFromFen(initial.fen);
  assert.equal(positionToFen(pos), 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
  assert.equal(perft(pos, 1).nodes, 44);
});
