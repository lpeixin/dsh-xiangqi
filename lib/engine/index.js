/**
 * 棋规引擎公开 API（§5.3 的冻结契约）。
 *
 * 这个文件只做再导出，不含实现：浏览器半的构建脚本会把同目录下的实现文件按序
 * 内联进一个 IIFE，而本文件不参与内联，所以这里的 `export ... from` 与重命名都
 * 不会影响内联结果。宿主要求「按签名调用」——改签名前请先改设计文档。
 *
 * 除 §5.3 之外，这里还导出少量底层原语（`collectLegalMoves`、`isSquareAttacked`、
 * `moveRejectCode` 等）：测试夹具与搜索需要它们，且它们不会与冻结契约冲突。
 */

// ---- 坐标与棋盘常量 ----
export {
  BOARD_ROWS, BOARD_COLS, BOARD_SIZE, RED_SIDE, BLACK_SIDE, PIECE_BASE_VALUE,
  idxToRow, idxToCol, rcToIdx, isOnBoard, colorOfPiece, oppositeSide, sideNameZh, pieceNameZh,
  squareToIccs, iccsToSquare, colToFileNumber, fileNumberToCol, fileNumberText, countText,
  zhDigitValue, hasCrossedRiver, isInPalace, horseLegIndex, encodeMoveCode, decodeMoveFrom, decodeMoveTo,
} from './coords.js';

// ---- 局面构造与序列化 ----
export {
  PositionError, START_FEN, initialPosition, positionFromFen, positionToFen,
  clonePosition, isValidPosition, isPieceChar, normalizeFenDialect, positionKeyOf, fenKeyOf,
} from './fen.js';

// ---- 着法生成 ----
export {
  pseudoLegalMoves, generateMoves, applyMove,
  isSquareAttacked, isSquareAttackedBy, findKingIndex, pieceSideCode,
  collectLegalMoves, collectPseudoMoves, toMoveObjects,
  makeMoveOnBoard, unmakeMoveOnBoard,
} from './moves.js';

// ---- 局面状态与合法性（含拒绝原因与人话原因）----
export {
  isInCheck, isBoardInCheck, gameStatus, kingsFaceOnBoard,
  countRepetition, findPerpetualChecker, FIFTY_MOVE_HALFMOVES,
  moveRejectCode, moveRejectReason, isLegalMove, MOVE_REJECT_ZH,
} from './rules.js';

// ---- 记谱 ----
export {
  moveToIccs, iccsToMove, formatChinese, parseChinese, parseAnyMove, zhMoveParts, parseZhDigit,
} from './notation-zh.js';

// ---- 局面描述与评估（对 AI 友好）----
export { describePosition, legalMoveCatalog, renderAsciiBoard, BOARD_LEGEND } from './describe.js';
export { evaluate, evalPieceValue, materialDiffZh, evalSideNameZh } from './eval.js';

// ---- 本地搜索引擎（提示与降级对手）----
export { searchBestMove, SEARCH_LIMITS, searchScoreTextZh } from './search.js';
