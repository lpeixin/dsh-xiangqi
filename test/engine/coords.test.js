/**
 * 坐标与记号的换算单测（§5.1）。
 *
 * 这里每个断言都对应一个「写反了就全体出错」的约定：ICCS 行号 `9 - row`、
 * 红方文件号右起、黑方文件号左起、九宫与河界。它们在各处被复用，
 * 单独的用例比在规则用例里间接暴露更容易定位。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_SIZE, idxToRow, idxToCol, rcToIdx, isOnBoard, colorOfPiece, oppositeSide, sideNameZh,
  pieceNameZh, squareToIccs, iccsToSquare, colToFileNumber, fileNumberToCol, fileNumberText,
  countText, zhDigitValue, hasCrossedRiver, isInPalace, horseLegIndex,
  encodeMoveCode, decodeMoveFrom, decodeMoveTo,
} from '../../lib/engine/index.js';

test('行列与索引互转', () => {
  assert.equal(rcToIdx(0, 0), 0);
  assert.equal(rcToIdx(9, 8), BOARD_SIZE - 1);
  assert.equal(idxToRow(9 * 9 + 3), 9);
  assert.equal(idxToCol(9 * 9 + 3), 3);
  assert.equal(rcToIdx(-1, 0), -1);
  assert.equal(rcToIdx(10, 0), -1);
  assert.equal(rcToIdx(0, 9), -1);
  assert.equal(idxToRow(-1), -1);
  assert.equal(idxToCol(90), -1);
  assert.equal(isOnBoard(0, 0), true);
  assert.equal(isOnBoard(9, 8), true);
  assert.equal(isOnBoard(10, 8), false);
});

test('ICCS 坐标：a0 是红方左底线，h2 是红方右炮，b7 是黑方左炮', () => {
  assert.equal(squareToIccs(rcToIdx(9, 0)), 'a0');
  assert.equal(squareToIccs(rcToIdx(7, 7)), 'h2');
  assert.equal(squareToIccs(rcToIdx(2, 1)), 'b7');
  assert.equal(squareToIccs(rcToIdx(0, 8)), 'i9');
  assert.equal(iccsToSquare('a0'), rcToIdx(9, 0));
  assert.equal(iccsToSquare('h2'), rcToIdx(7, 7));
  assert.equal(iccsToSquare('I9'), rcToIdx(0, 8), '大写列字母也接受');
  assert.equal(iccsToSquare('a'), -1);
  assert.equal(iccsToSquare('j0'), -1);
  assert.equal(iccsToSquare('a:'), -1);
  assert.equal(iccsToSquare(42), -1);
  assert.equal(squareToIccs(999), '');
});

test('文件号：红方右起、黑方左起', () => {
  assert.equal(colToFileNumber(8, 'r'), 1);
  assert.equal(colToFileNumber(0, 'r'), 9);
  assert.equal(colToFileNumber(0, 'b'), 1);
  assert.equal(colToFileNumber(8, 'b'), 9);
  assert.equal(fileNumberToCol(1, 'r'), 8);
  assert.equal(fileNumberToCol(9, 'r'), 0);
  assert.equal(fileNumberToCol(1, 'b'), 0);
  assert.equal(fileNumberToCol(10, 'r'), -1);
  assert.equal(fileNumberToCol(0, 'b'), -1);
  assert.equal(fileNumberText(1, 'r'), '一');
  assert.equal(fileNumberText(5, 'b'), '5');
  assert.equal(countText(3, 'r'), '三');
  assert.equal(countText(3, 'b'), '3');
  assert.equal(fileNumberText(9, 'r'), '九');
});

test('中文数字与颜色码', () => {
  assert.equal(zhDigitValue('一'), 1);
  assert.equal(zhDigitValue('九'), 9);
  assert.equal(zhDigitValue('十'), 0);
  assert.equal(colorOfPiece('K'), 'r');
  assert.equal(colorOfPiece('k'), 'b');
  assert.equal(colorOfPiece(''), null);
  assert.equal(oppositeSide('r'), 'b');
  assert.equal(oppositeSide('b'), 'r');
  assert.equal(sideNameZh('r'), '红方');
  assert.equal(sideNameZh('b'), '黑方');
  assert.equal(pieceNameZh('P'), '兵');
  assert.equal(pieceNameZh('p'), '卒');
  assert.equal(pieceNameZh(''), '空');
});

test('河界与九宫', () => {
  assert.equal(hasCrossedRiver(4, 'r'), true);
  assert.equal(hasCrossedRiver(5, 'r'), false);
  assert.equal(hasCrossedRiver(5, 'b'), true);
  assert.equal(hasCrossedRiver(4, 'b'), false);
  assert.equal(isInPalace(9, 4, 'r'), true);
  assert.equal(isInPalace(7, 3, 'r'), true);
  assert.equal(isInPalace(6, 4, 'r'), false);
  assert.equal(isInPalace(0, 4, 'b'), true);
  assert.equal(isInPalace(2, 5, 'b'), true);
  assert.equal(isInPalace(3, 4, 'b'), false);
  assert.equal(isInPalace(9, 2, 'r'), false);
});

test('马腿索引：紧贴马那一侧', () => {
  // 马在 (5,4)，走到 (3,3)：马腿是 (4,4)
  assert.equal(horseLegIndex(rcToIdx(5, 4), rcToIdx(3, 3)), rcToIdx(4, 4));
  // 马在 (5,4)，走到 (4,2)：马腿是 (5,3)
  assert.equal(horseLegIndex(rcToIdx(5, 4), rcToIdx(4, 2)), rcToIdx(5, 3));
  // 马在 (2,1)，走到 (0,2)：马腿是 (1,1)
  assert.equal(horseLegIndex(rcToIdx(2, 1), rcToIdx(0, 2)), rcToIdx(1, 1));
  assert.equal(horseLegIndex(rcToIdx(5, 4), rcToIdx(5, 5)), -1);
});

test('着法整数编码可逆', () => {
  for (const [from, to] of [[0, 89], [89, 0], [45, 45], [12, 77]]) {
    const code = encodeMoveCode(from, to);
    assert.equal(decodeMoveFrom(code), from);
    assert.equal(decodeMoveTo(code), to);
  }
});
