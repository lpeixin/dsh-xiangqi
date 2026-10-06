/**
 * 中文记谱单测（§5.5）。
 *
 * 三条不可退让的语义：
 * 1. 生成与解析对**同一局面**必须互相还原；
 * 2. 同列同名子的消歧（前/后/中、一二三四五）双向都要对；
 * 3. `parseChinese` 只在合法着法集合里匹配唯一解——0 个或多于 1 个都报错，
 *    歧义必须带上候选，绝不静默任选。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  initialPosition, positionFromFen, applyMove, generateMoves, formatChinese, parseChinese,
  parseAnyMove, moveToIccs, iccsToMove, zhMoveParts, parseZhDigit, iccsToSquare, isLegalMove,
  oppositeSide,
} from '../../lib/engine/index.js';

const NOTATION = JSON.parse(readFileSync(new URL('../fixtures/notation-zh.json', import.meta.url), 'utf8'));
const GAMES = ['selfplay.json', 'opening.json'].map((name) => JSON.parse(
  readFileSync(new URL(`../fixtures/games/${name}`, import.meta.url), 'utf8'),
));

test('中文记谱按方选数字体系', () => {
  const pos = initialPosition();
  assert.equal(formatChinese(pos, { from: iccsToSquare('h2'), to: iccsToSquare('e2') }), '炮二平五');
  assert.equal(formatChinese(pos, { from: iccsToSquare('h9'), to: iccsToSquare('g7') }), '马8进7');
  assert.equal(formatChinese(pos, { from: iccsToSquare('b0'), to: iccsToSquare('c2') }), '马八进七');
  assert.equal(formatChinese(pos, { from: iccsToSquare('a3'), to: iccsToSquare('a4') }), '兵九进一');
  assert.equal(formatChinese(pos, { from: iccsToSquare('a0'), to: iccsToSquare('a1') }), '车九进一');
  assert.equal(formatChinese(pos, { from: iccsToSquare('b2'), to: iccsToSquare('b7') }), '炮八进五');
});

test('无法分解的着法返回空串而不是抛异常', () => {
  const pos = initialPosition();
  assert.equal(formatChinese(pos, null), '');
  assert.equal(formatChinese(pos, { from: 50, to: 40 }), '');
  assert.equal(formatChinese(pos, { from: 'a', to: 'b' }), '');
  assert.equal(formatChinese(null, { from: 0, to: 1 }), '');
  assert.equal(formatChinese(pos, { from: 999, to: 1 }), '');
});

for (const item of NOTATION.generation) {
  test(`生成：${item.name} → ${item.zh}`, () => {
    const pos = positionFromFen(item.fen);
    const move = { from: iccsToSquare(item.iccs.slice(0, 2)), to: iccsToSquare(item.iccs.slice(2)) };
    assert.equal(formatChinese(pos, move), item.zh);
  });
}

for (const item of NOTATION.parse) {
  test(`解析：${item.name}`, () => {
    const pos = positionFromFen(item.fen);
    const result = parseAnyMove(pos, item.input);
    if (item.iccs) {
      assert.ok(result.move, result.error);
      assert.equal(moveToIccs(result.move), item.iccs);
      assert.equal(isLegalMove(pos, result.move), true);
    } else {
      assert.ok(result.error, `应当报错，却得到 ${JSON.stringify(result)}`);
    }
  });
}

test('同列同名子的消歧是双向的（前/后/中）', () => {
  const pawns = positionFromFen(NOTATION.generation.find((g) => g.zh === '中兵进一').fen);
  for (const [zh, iccs] of [['前兵进一', 'e7e8'], ['中兵进一', 'e5e6'], ['后兵进一', 'e3e4']]) {
    const move = { from: iccsToSquare(iccs.slice(0, 2)), to: iccsToSquare(iccs.slice(2)) };
    assert.equal(formatChinese(pawns, move), zh);
    const parsed = parseChinese(pawns, zh);
    assert.ok(parsed.move, parsed.error);
    assert.equal(moveToIccs(parsed.move), iccs);
  }
});

test('五个同列兵用一二三四五', () => {
  const item = NOTATION.generation.find((g) => g.zh === '三兵进一');
  assert.ok(item, '夹具里必须有五兵用例');
  const pos = positionFromFen(item.fen);
  const labels = new Set();
  for (let row = 1; row <= 5; row += 1) {
    const from = row * 9 + 7;
    const text = formatChinese(pos, { from, to: (row - 1) * 9 + 7 });
    labels.add(text);
  }
  for (const label of ['一兵进一', '二兵进一', '三兵进一', '四兵进一', '五兵进一']) {
    assert.ok(labels.has(label), `缺少 ${label}`);
  }
});

test('解析中不允许静默任选：歧义要带候选', () => {
  const item = NOTATION.generation.find((g) => g.zh === '前车进三');
  const pos = positionFromFen(item.fen);
  const result = parseChinese(pos, '车九进一');
  assert.ok(result.error, '同列两车只写文件号应判歧义');
  assert.match(result.error, /歧义/);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((text) => /\s/.test(text)), '候选应含 ICCS 与中文两段');
});

test('解析错误的三类语义', () => {
  const pos = initialPosition();
  assert.match(parseChinese(pos, '飞龙在天').error, /无法识别/);
  assert.match(parseChinese(pos, '车九进五').error, /没有匹配的合法着法/);
  assert.match(parseChinese(pos, '将5进1').error, /不是红方的棋子/);
  assert.match(parseChinese(pos, '').error, /没有给出着法/);
  assert.match(parseChinese(null, '炮二平五').error, /局面数据非法/);
  assert.match(parseChinese(pos, '炮二平九').error, /无法识别的数字|没有匹配/);
});

test('解析接受全角与分隔符容错', () => {
  const pos = initialPosition();
  assert.ok(parseAnyMove(pos, '炮二平五').move);
  assert.ok(parseAnyMove(pos, ' 炮二平五 ').move);
  assert.ok(parseAnyMove(pos, '炮二平五！').move);
  assert.ok(parseAnyMove(pos, 'ｈ２ｅ２').move, '全角 ICCS 也要能解析');
  assert.equal(moveToIccs(parseAnyMove(pos, '炮二平５').move), 'h2e2', '全角数字的中文记谱也要能解析');
  assert.ok(parseAnyMove(pos, 'h2-e2').move);
  assert.match(parseAnyMove(pos, 'z9z9').error, /ICCS 坐标越界|无法识别/);
  assert.match(parseAnyMove(pos, '').error, /没有给出着法/);
  assert.match(parseAnyMove(pos, 42).error, /没有给出着法/);
});

test('iccsToMove 三态：合法 → Move、几何合法但送将 → null、越界/格式错 → null', () => {
  const pos = initialPosition();
  assert.equal(moveToIccs(iccsToMove(pos, 'h2e2')), 'h2e2');
  assert.equal(moveToIccs(iccsToMove(pos, 'H2E2')), 'h2e2', '大小写不敏感');
  assert.equal(iccsToMove(pos, 'a0a5'), null, '车前方有己方兵挡路 → 非法');
  assert.equal(iccsToMove(pos, 'e3d3'), null, '兵未过河横走 → 非法');
  assert.equal(iccsToMove(pos, 'z0z1'), null, '坐标越界');
  assert.equal(iccsToMove(pos, 'h2'), null, '格式错');
  assert.equal(iccsToMove(null, 'h2e2'), null, '局面非法');
  // 黑车在 e2、红马在 e1 挡着——马一走开就露帅，属「几何合法但会送将」。
  const pinned = positionFromFen('2k6/9/9/9/9/9/9/4r4/4N4/4K4 w - - 0 1');
  assert.equal(iccsToMove(pinned, 'e1c2'), null, '被牵制的马移动 → null');
  assert.equal(moveToIccs(iccsToMove(pinned, 'e0d0')), 'e0d0');
});

test('ICCS 与中文互转对全部合法着法成立', () => {
  const positions = [
    initialPosition(),
    positionFromFen(NOTATION.generation.find((g) => g.zh === '前车进三').fen),
    positionFromFen('r1ea1a3/4kh3/2h1e4/pHp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2EAKAE2 w - - 0 1'),
  ];
  for (const pos of positions) {
    for (const move of generateMoves(pos)) {
      const zh = formatChinese(pos, move);
      assert.ok(zh.length > 0, `${moveToIccs(move)} 应能生成中文记谱`);
      const parsed = parseChinese(pos, zh);
      assert.ok(parsed.move, `${zh} 应能解析回来：${parsed.error}`);
      assert.equal(moveToIccs(parsed.move), moveToIccs(move), `${zh} 往返不一致`);
    }
  }
});

test('真实棋谱 ≥40 手往返恒等（红黑各半）', () => {
  let plies = 0;
  const colors = new Set();
  for (const game of GAMES) {
    // 每份棋谱都从初始局面独立回放（opening 是 selfplay 的前缀，不能接在它后面）。
    let pos = initialPosition();
    for (const step of game.moves) {
      const move = iccsToMove(pos, step.iccs);
      assert.ok(move, `棋谱着法非法：${step.iccs}`);
      const zh = formatChinese(pos, move);
      assert.equal(zh, step.zh, `第 ${plies + 1} 手记谱不一致`);
      const parsed = parseChinese(pos, zh);
      assert.ok(parsed.move, `${zh} 解析失败：${parsed.error}`);
      assert.equal(moveToIccs(parsed.move), step.iccs);
      colors.add(pos.turn);
      pos = applyMove(pos, move);
      plies += 1;
    }
  }
  assert.ok(plies >= 40, `棋谱至少 40 手，实际 ${plies}`);
  assert.deepEqual([...colors].sort(), ['b', 'r'], '红黑双方都要覆盖');
});

test('zhMoveParts 暴露结构化字段供 UI 复用', () => {
  const pos = initialPosition();
  const parts = zhMoveParts(pos, { from: iccsToSquare('h2'), to: iccsToSquare('e2') });
  assert.equal(parts.piece, 'C');
  assert.equal(parts.action, '平');
  assert.equal(parts.fromFileNumber, 2);
  assert.equal(parts.disambigCount, 1);
  assert.equal(parts.text, '炮二平五');
  assert.equal(parseZhDigit('八'), 8);
  assert.equal(parseZhDigit('8'), 8);
  assert.equal(parseZhDigit('呀'), 0);
  assert.equal(zhMoveParts(pos, { from: 50, to: 40 }), null);
});

test('走子方轮换后记谱方向反转', () => {
  const pos = initialPosition();
  const after = { ...pos, turn: oppositeSide(pos.turn) };
  assert.equal(formatChinese(after, { from: iccsToSquare('h9'), to: iccsToSquare('g7') }), '马8进7');
});
