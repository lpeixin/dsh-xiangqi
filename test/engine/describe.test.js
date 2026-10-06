/**
 * 局面描述单测（§5.6）。
 *
 * `describePosition` 的输出去喂模型，所以断言盯的是**结构**：六段是否齐全、
 * 图例是否在、截断规则是否生效、选项是否能真正关掉某段。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initialPosition, positionFromFen, applyMove, parseAnyMove, describePosition, legalMoveCatalog,
  renderAsciiBoard, BOARD_LEGEND, moveToIccs, formatChinese, generateMoves,
} from '../../lib/engine/index.js';

const initial = initialPosition();
const afterCannon = applyMove(initial, parseAnyMove(initial, '炮二平五').move);

test('默认输出包含 §5.6 的全部六段', () => {
  const text = describePosition(afterCannon);
  const lines = text.split('\n');
  assert.match(lines[0], /^局面（第 1 回合，黑方走子）$/);
  assert.ok(text.includes('九 八 七 六 五 四 三 二 一'), '含中文文件号表头');
  assert.ok(text.includes('—— 楚 河     汉 界 ——'), '含楚河汉界');
  assert.ok(text.includes(BOARD_LEGEND), '含棋盘图例（大小写约定）');
  assert.ok(text.includes(`FEN: ${'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1'}`));
  assert.ok(text.includes('上一手：（未提供）'), '缺数据时给占位符而不是省略整行');
  assert.match(text, /^状态：对局进行中$/m);
  assert.match(text, /^评估：/m);
  assert.match(text, /^合法着法（45 个，ICCS \/ 中文）：$/m);
  const initialText = describePosition(initial);
  assert.ok(initialText.includes('a0a1 车九进一'), '目录里 ICCS 与中文双写');
});

test('图例紧跟棋盘且与 FEN 同源', () => {
  const lines = describePosition(initial).split('\n');
  const legendIndex = lines.indexOf(BOARD_LEGEND);
  const fenIndex = lines.findIndex((line) => line.startsWith('FEN: '));
  assert.ok(legendIndex > 0 && legendIndex < fenIndex, '图例应在棋盘之后、FEN 之前');
  assert.match(BOARD_LEGEND, /大写=红方，小写=黑方/);
});

test('ASCII 棋盘：10 行 + 行号 + 楚河汉界', () => {
  const rows = renderAsciiBoard(initial.board);
  // 表头 + 10 行 + 河界
  assert.equal(rows.length, 12);
  assert.equal(rows[1].slice(3), 'r  n  b  a  k  a  b  n  r');
  assert.equal(rows[2].slice(3), '.  .  .  .  .  .  .  .  .');
  assert.equal(rows[11].slice(3), 'R  N  B  A  K  A  B  N  R');
  assert.equal(rows[6], '  —— 楚 河     汉 界 ——');
});

test('选项可关闭各段', () => {
  const noAscii = describePosition(initial, { ascii: false });
  assert.ok(!noAscii.includes('楚 河'));
  assert.ok(!noAscii.includes(BOARD_LEGEND));
  const noMoves = describePosition(initial, { includeMoves: false });
  assert.ok(!noMoves.includes('合法着法'));
  const noEval = describePosition(initial, { includeEval: false });
  assert.ok(!noEval.includes('评估：'));
  const minimal = describePosition(initial, { ascii: false, includeMoves: false, includeEval: false });
  assert.deepEqual(minimal.split('\n').map((line) => line.split(/[:：]/)[0]), ['局面（第 1 回合，红方走子）', 'FEN', '上一手', '状态']);
});

test('非法局面返回可读提示而不是抛异常', () => {
  assert.equal(describePosition(null), '局面数据非法，无法描述');
  assert.equal(describePosition({ board: [], turn: 'r', halfmove: 0, fullmove: 1 }), '局面数据非法，无法描述');
});

test('着法目录超过上限时按「吃子 > 将军 > 其它」截断并注明', () => {
  const text = describePosition(initial, { maxMoves: 5, ascii: false, includeEval: false });
  assert.match(text, /合法着法（44 个，ICCS \/ 中文）：/);
  assert.match(text, /共 44 个，已按「吃子 > 将军 > 其它」截断到 5 个/);
  const entries = text.split('\n').filter((line) => /^ {2}[a-i]\d[a-i]\d /.test(line)).join('|').split('|').map((item) => item.trim()).filter(Boolean);
  assert.equal(entries.length, 5);
  const catalog = legalMoveCatalog(initial);
  const captures = catalog.filter((item) => item.capture !== '');
  assert.equal(captures.length, 2);
  for (const capture of captures) {
    assert.ok(entries.some((entry) => entry.startsWith(capture.iccs)), `吃子着法 ${capture.iccs} 必须被保留`);
  }
});

test('着法目录不超过上限时不截断', () => {
  const text = describePosition(initial, { maxMoves: 80 });
  assert.ok(!text.includes('已按'));
  assert.equal(text.split('\n').filter((line) => /^ {2}[a-i]\d[a-i]\d /.test(line)).length, 8, '44 个按每行 6 个折行');
});

test('legalMoveCatalog 形状符合 §5.3', () => {
  const catalog = legalMoveCatalog(initial);
  assert.equal(catalog.length, 44);
  for (const item of catalog) {
    assert.deepEqual(Object.keys(item).sort(), ['capture', 'iccs', 'zh']);
    assert.equal(typeof item.iccs, 'string');
    assert.equal(typeof item.zh, 'string');
    assert.equal(item.iccs.length, 4);
    assert.ok(item.zh.length >= 3);
  }
  assert.deepEqual(legalMoveCatalog(null), []);
  const capture = catalog.find((item) => item.capture !== '');
  assert.ok(capture, '初始局面应当有吃子着法（炮打中卒）');
});

test('目录内容与 generateMoves 一一对应', () => {
  const catalog = legalMoveCatalog(afterCannon);
  const moves = generateMoves(afterCannon).map((move) => moveToIccs(move));
  assert.deepEqual(catalog.map((item) => item.iccs), moves);
  assert.deepEqual(catalog.map((item) => item.zh), generateMoves(afterCannon).map((move) => formatChinese(afterCannon, move)));
});

test('上一手支持 MoveRecord / Move / 字符串三种输入', () => {
  const record = { iccs: 'h2e2', zh: '炮二平五', piece: 'C', check: false };
  assert.match(describePosition(afterCannon, { includeMoves: false, lastMove: record }), /上一手：红方 炮二平五（h2e2），未将军/);
  assert.match(describePosition(afterCannon, { includeMoves: false, lastMove: { ...record, check: true } }), /，将军/);
  assert.match(describePosition(afterCannon, { includeMoves: false, lastMove: { ...record, mate: true } }), /，将死/);
  assert.match(describePosition(afterCannon, { includeMoves: false, lastMove: { iccs: 'h2e2' } }), /上一手：h2e2/);
  assert.match(describePosition(afterCannon, { includeMoves: false, lastMove: { from: 70, to: 67 } }), /上一手：h2e2/);
  assert.match(describePosition(afterCannon, { includeMoves: false, lastMove: '自由文本' }), /上一手：自由文本/);
  assert.match(describePosition(afterCannon, { includeMoves: false, lastMove: '' }), /上一手：（未提供）/);
  assert.match(describePosition(afterCannon, { includeMoves: false, lastMove: 42 }), /上一手：（未提供）/);
  assert.match(describePosition(afterCannon, { includeMoves: false, lastMove: { color: 'b', zh: '马8进7', iccs: 'h9g7' } }), /上一手：黑方 马8进7（h9g7）/);
});

test('状态行给出将军与应将着法数', () => {
  const check = positionFromFen('4k4/9/9/9/9/9/9/9/4r4/4K4 w - - 0 1');
  const text = describePosition(check, { includeMoves: false, includeEval: false, ascii: false });
  assert.match(text, /^状态：红方被将军（应将着法 \d+ 个）$/m);
});

test('状态行覆盖将死 / 困毙 / 判和三种终局', () => {
  const mate = positionFromFen('R3k4/9/4R4/9/9/9/9/9/9/4K4 b - - 0 1');
  assert.match(describePosition(mate, { ascii: false, includeMoves: false, includeEval: false }), /^状态：黑方被将死，红方胜（checkmate）$/m);
  const stale = positionFromFen('4k4/9/2N1N4/9/9/9/9/9/9/3K5 b - - 0 1');
  assert.match(describePosition(stale, { ascii: false, includeMoves: false, includeEval: false }), /^状态：黑方无子可动（困毙），按中国象棋规则判负，红方胜（stalemate）$/m);
  const fifty = positionFromFen('4k4/9/9/9/9/9/9/9/9/4R3K w - - 120 61');
  assert.match(describePosition(fifty, { ascii: false, includeMoves: false, includeEval: false }), /^状态：.*判和（draw-fifty）$/m);
  assert.equal(describePosition(null, { includeMoves: false }), '局面数据非法，无法描述');
});

test('描述是确定性的：同输入同输出', () => {
  assert.equal(describePosition(afterCannon), describePosition(afterCannon));
});
