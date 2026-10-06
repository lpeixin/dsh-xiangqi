/* 自动生成，请勿手改；改源码后跑 npm run build:client */
window.__ModuleLoader__.load({ id: "dsh-xiangqi-mate", factory: (require) => {
	"use strict";
	/* 平台基线表里本项目唯一允许的 require（§4.5、T7/T18）。 */
	const React = require("react");
	return (function () {
		"use strict";
	/* ==================== lib/engine/coords.js ==================== */
		/**
		 * 坐标与记号换算。引擎里所有「索引」都是 `row * 9 + col`（§5.1）。
		 *
		 * 为什么把换算集中在一个文件：棋盘有四种等价表示（内部索引、行列、ICCS、
		 * 中文文件号），任何一处自己手写 `9 - row` 都会在下一次改动时漏改。
		 * 这里只做纯换算，不含任何规则判断，便于单测逐条钉住。
		 *
		 * 注意：中文文件号的方向由**走子方**决定（红方右起、黑方左起），
		 * 所以所有涉及文件号的函数都必须显式传 side，不能靠调用方自觉。
		 */
		
		const BOARD_ROWS = 10;
		const BOARD_COLS = 9;
		const BOARD_SIZE = 90;
		
		const RED_SIDE = 'r';
		const BLACK_SIDE = 'b';
		
		/** 颜色码：热路径里用数字代替字符串比较（1 = 红、2 = 黑、0 = 空/非法）。 */
		const RED_CODE = 1;
		const BLACK_CODE = 2;
		
		/** 中文数字，下标 0 对应「一」。 */
		const ZH_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
		
		/** 棋子 → 中文名（帅仕相马车炮兵 / 将士象马车炮卒）。 */
		const ZH_PIECE_NAMES = {
		  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
		  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
		};
		
		/** 棋子 → 子力价值（厘兵，§5.7）。过河兵加成由调用方叠加。 */
		const PIECE_BASE_VALUE = { K: 0, A: 200, B: 200, N: 400, R: 900, C: 450, P: 100, k: 0, a: 200, b: 200, n: 400, r: 900, c: 450, p: 100 };
		
		/** 行号。索引越界时返回 -1 而不是 NaN，便于 `=== -1` 判定。 */
		function idxToRow(index) {
		  return index >= 0 && index < BOARD_SIZE ? Math.floor(index / BOARD_COLS) : -1;
		}
		
		/** 列号。索引越界时返回 -1。 */
		function idxToCol(index) {
		  return index >= 0 && index < BOARD_SIZE ? index % BOARD_COLS : -1;
		}
		
		/** 行列 → 索引；不在盘上时返回 -1。 */
		function rcToIdx(row, col) {
		  return isOnBoard(row, col) ? row * BOARD_COLS + col : -1;
		}
		
		/** 行列是否在 10x9 盘面内。 */
		function isOnBoard(row, col) {
		  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
		}
		
		/** 棋子颜色；空格返回 null。大小写即颜色，这是 FEN 的约定。 */
		function colorOfPiece(piece) {
		  if (!piece) return null;
		  return piece === piece.toUpperCase() ? RED_SIDE : BLACK_SIDE;
		}
		
		/** 对方。只对 'r'/'b' 有意义，其它输入原样返回。 */
		function oppositeSide(side) {
		  return side === RED_SIDE ? BLACK_SIDE : RED_SIDE;
		}
		
		/** 中文侧名，用于人话消息。 */
		function sideNameZh(side) {
		  return side === RED_SIDE ? '红方' : '黑方';
		}
		
		/** 棋子中文名；空格返回「空」。 */
		function pieceNameZh(piece) {
		  return ZH_PIECE_NAMES[piece] ?? '空';
		}
		
		/** 内部索引 → ICCS，如 0 → 'a9'。越界返回 ''。 */
		function squareToIccs(index) {
		  const row = idxToRow(index);
		  const col = idxToCol(index);
		  if (row < 0 || col < 0) return '';
		  return String.fromCharCode(97 + col) + String(9 - row);
		}
		
		/** ICCS → 内部索引；非法或越界返回 -1。 */
		function iccsToSquare(text) {
		  if (typeof text !== 'string' || text.length !== 2) return -1;
		  const col = text.charCodeAt(0);
		  const rank = text.charCodeAt(1);
		  const c = col >= 97 && col <= 105 ? col - 97 : col >= 65 && col <= 73 ? col - 65 : -1;
		  if (c < 0 || rank < 48 || rank > 57) return -1;
		  return rcToIdx(9 - (rank - 48), c);
		}
		
		/** 列 → 该方视角的文件号（红右起、黑左起）。 */
		function colToFileNumber(col, side) {
		  return side === RED_SIDE ? 9 - col : col + 1;
		}
		
		/** 该方视角的文件号 → 列；越界返回 -1。 */
		function fileNumberToCol(fileNumber, side) {
		  const col = side === RED_SIDE ? 9 - fileNumber : fileNumber - 1;
		  return col >= 0 && col < BOARD_COLS ? col : -1;
		}
		
		/** 该方视角的文件号 → 记谱用数字文本（红中文、黑阿拉伯）。 */
		function fileNumberText(fileNumber, side) {
		  return side === RED_SIDE ? ZH_DIGITS[fileNumber - 1] ?? '' : String(fileNumber);
		}
		
		/** 数字 → 记谱文本（红中文、黑阿拉伯）；用于「进/退几步」。 */
		function countText(count, side) {
		  return side === RED_SIDE ? ZH_DIGITS[count - 1] ?? '' : String(count);
		}
		
		/** 单个中文数字字符 → 数字；非中文数字返回 0。 */
		function zhDigitValue(ch) {
		  const index = ZH_DIGITS.indexOf(ch);
		  return index < 0 ? 0 : index + 1;
		}
		
		/** 该方是否已过河（红方 row ≤ 4，黑方 row ≥ 5）。 */
		function hasCrossedRiver(row, side) {
		  return side === RED_SIDE ? row <= 4 : row >= 5;
		}
		
		/** 行列是否落在该方九宫内（黑 row 0–2，红 row 7–9，col 3–5）。 */
		function isInPalace(row, col, side) {
		  if (col < 3 || col > 5) return false;
		  return side === RED_SIDE ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
		}
		
		/**
		 * 着法整数编码（低 7 位起点、其余位终点）。放在坐标模块是因为它与 idxToRow 一样
		 * 属于「索引 ↔ 表示」的换算，且着法生成、合法性、搜索三处都要用，集中一处可避免
		 * 各自复制移位常量。
		 */
		const MOVE_TO_SHIFT = 7;
		const MOVE_FROM_MASK = 127;
		
		function encodeMoveCode(from, to) {
		  return from | (to << MOVE_TO_SHIFT);
		}
		
		function decodeMoveFrom(code) {
		  return code & MOVE_FROM_MASK;
		}
		
		function decodeMoveTo(code) {
		  return (code >>> MOVE_TO_SHIFT) & MOVE_FROM_MASK;
		}
		
		/**
		 * 行棋方向表。放在坐标模块而不是着法模块，是因为「马腿」「象眼」这类几何
		 * 需要同时被着法生成、攻击判定、拒绝原因三处使用——各自写一份数组迟早会不同步。
		 */
		const ORTHO_DR = [-1, 1, 0, 0];
		const ORTHO_DC = [0, 0, -1, 1];
		const DIAG_DR = [-1, -1, 1, 1];
		const DIAG_DC = [-1, 1, -1, 1];
		const HORSE_DR = [-2, -2, -1, -1, 1, 1, 2, 2];
		const HORSE_DC = [-1, 1, -2, 2, -2, 2, -1, 1];
		
		/** 马从 from 走到 to 时的「马腿」索引；不是马步或越界时返回 -1。 */
		function horseLegIndex(from, to) {
		  const dr = idxToRow(to) - idxToRow(from);
		  const dc = idxToCol(to) - idxToCol(from);
		  const index = HORSE_DR.findIndex((hr, i) => hr === dr && HORSE_DC[i] === dc);
		  if (index < 0) return -1;
		  const legRow = Math.abs(dr) === 2 ? idxToRow(from) + dr / 2 : idxToRow(from);
		  const legCol = Math.abs(dc) === 2 ? idxToCol(from) + dc / 2 : idxToCol(from);
		  return rcToIdx(legRow, legCol);
		}
		
			/* ==================== lib/engine/fen.js ==================== */
		/**
		 * FEN 解析与导出（§5.1、§5.8.3）。
		 *
		 * 关键坑：中国象棋 FEN 有两套字母方言——马/象写作 `n/b`（本项目导出方言）
		 * 或写作 `h/e`（Chess Programming Wiki 的 perft 用例）。导入时先归一化，
		 * 否则 `h`/`e` 会被当成非法字符，或者更糟：被静默当成空格导致整盘错位。
		 */
		
		
		/** 局面非法（只由 positionFromFen / positionToFen 抛出，见 §5.3）。 */
		class PositionError extends Error {
		  constructor(message) {
		    super(message);
		    this.name = 'PositionError';
		  }
		}
		
		/** 初始局面（§5.1 的通行 FEN）。 */
		const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
		
		const LEGAL_PIECES = 'KABNRCPkabnrcp';
		
		/** 合法棋子字符。空格用 '' 表示，这里自然为 false。 */
		function isPieceChar(ch) {
		  return typeof ch === 'string' && ch.length === 1 && LEGAL_PIECES.includes(ch);
		}
		
		/**
		 * 把 h/e 方言归一化成 n/b。
		 * 只替换字母，不碰数字与 '/'，因此可以整段套在棋盘字段上。
		 */
		function normalizeFenDialect(text) {
		  return String(text)
		    .replace(/h/g, 'n')
		    .replace(/H/g, 'N')
		    .replace(/e/g, 'b')
		    .replace(/E/g, 'B');
		}
		
		/** 初始局面。每次返回新对象，调用方随便改。 */
		function initialPosition() {
		  return positionFromFen(START_FEN);
		}
		
		/** 浅拷贝（board 也复制），applyMove 的纯函数语义靠它。 */
		function clonePosition(pos) {
		  return {
		    board: pos.board.slice(),
		    turn: pos.turn,
		    halfmove: pos.halfmove,
		    fullmove: pos.fullmove,
		  };
		}
		
		/** 结构合法的局面对象判定。用于「非法输入不抛异常」的边界分支。 */
		function isValidPosition(pos) {
		  if (!pos || typeof pos !== 'object') return false;
		  if (!Array.isArray(pos.board) || pos.board.length !== BOARD_SIZE) return false;
		  if (pos.turn !== 'r' && pos.turn !== 'b') return false;
		  if (!Number.isInteger(pos.halfmove) || pos.halfmove < 0) return false;
		  if (!Number.isInteger(pos.fullmove) || pos.fullmove < 1) return false;
		  for (let i = 0; i < BOARD_SIZE; i += 1) {
		    const piece = pos.board[i];
		    if (piece !== '' && !isPieceChar(piece)) return false;
		  }
		  return true;
		}
		
		/** 解析棋盘字段（10 行 / 9 列）。失败返回 null，由调用方决定错误文案。 */
		function parseFenBoard(field) {
		  const rows = field.split('/');
		  if (rows.length !== BOARD_ROWS) return null;
		  const board = new Array(BOARD_SIZE).fill('');
		  for (let row = 0; row < BOARD_ROWS; row += 1) {
		    const text = rows[row];
		    let col = 0;
		    for (let i = 0; i < text.length; i += 1) {
		      const ch = text[i];
		      if (ch >= '1' && ch <= '9') {
		        col += Number(ch);
		      } else if (isPieceChar(ch)) {
		        if (col >= BOARD_COLS) return null;
		        board[row * BOARD_COLS + col] = ch;
		        col += 1;
		      } else {
		        return null;
		      }
		    }
		    if (col !== BOARD_COLS) return null;
		  }
		  return board;
		}
		
		/** 归一的走子方字段。接受 w/r/red 与 b/black 两套写法。 */
		function parseFenTurn(field) {
		  const text = String(field ?? '').toLowerCase();
		  if (text === 'w' || text === 'r' || text === 'red') return 'r';
		  if (text === 'b' || text === 'black') return 'b';
		  return null;
		}
		
		/**
		 * FEN → 局面。非法时抛 PositionError（§5.3 唯一允许抛异常的入口）。
		 * `h/e` 与 `n/b` 两套方言都接受，内部统一成 `n/b`。
		 */
		function positionFromFen(fen) {
		  if (typeof fen !== 'string' || fen.trim() === '') {
		    throw new PositionError('FEN 必须是字符串且不能为空');
		  }
		  const fields = fen.trim().split(/\s+/);
		  if (fields.length < 2) {
		    throw new PositionError(`FEN 字段不足（至少需要棋盘与走子方）：${fen}`);
		  }
		  const boardField = normalizeFenDialect(fields[0]);
		  const turn = parseFenTurn(fields[1]);
		  if (turn === null) {
		    throw new PositionError(`FEN 走子方非法（应为 w/b）：${fields[1]}`);
		  }
		  const board = parseFenBoard(boardField);
		  if (board === null) {
		    throw new PositionError(`FEN 棋盘字段非法（应为 10 行、每行合计 9 格）：${fields[0]}`);
		  }
		  let redKings = 0;
		  let blackKings = 0;
		  for (let i = 0; i < BOARD_SIZE; i += 1) {
		    if (board[i] === 'K') redKings += 1;
		    else if (board[i] === 'k') blackKings += 1;
		  }
		  if (redKings !== 1 || blackKings !== 1) {
		    throw new PositionError(`FEN 必须恰好各有一个帅与将（实际 K=${redKings} k=${blackKings}）`);
		  }
		  // 半回合/回合字段在部分实现里被省略，缺失时按「新开局」补默认值。
		  const halfmove = fields.length >= 5 ? Number(fields[4]) : 0;
		  const fullmove = fields.length >= 6 ? Number(fields[5]) : 1;
		  return {
		    board,
		    turn,
		    halfmove: Number.isInteger(halfmove) && halfmove >= 0 ? halfmove : 0,
		    fullmove: Number.isInteger(fullmove) && fullmove >= 1 ? fullmove : 1,
		  };
		}
		
		/**
		 * 局面 → FEN（只导出 `n/b` 方言，§5.1）。
		 * 与 positionFromFen 不对称：这里收到的是自己的数据结构，结构坏了说明上游有 bug，
		 * 直接抛 PositionError 比默默导出一串错 FEN 更容易定位。
		 */
		function positionToFen(pos) {
		  if (!isValidPosition(pos)) {
		    throw new PositionError('positionToFen 收到结构非法的 Position');
		  }
		  const rows = [];
		  for (let row = 0; row < BOARD_ROWS; row += 1) {
		    let text = '';
		    let gap = 0;
		    for (let col = 0; col < BOARD_COLS; col += 1) {
		      const piece = pos.board[row * BOARD_COLS + col];
		      if (piece === '') {
		        gap += 1;
		        continue;
		      }
		      if (gap > 0) {
		        text += String(gap);
		        gap = 0;
		      }
		      text += piece;
		    }
		    if (gap > 0) text += String(gap);
		    rows.push(text);
		  }
		  const side = pos.turn === 'r' ? 'w' : 'b';
		  return `${rows.join('/')} ${side} - - ${pos.halfmove} ${pos.fullmove}`;
		}
		
		/** 局面的「同型」键（只含棋盘与走子方），三次重复判定用。 */
		function positionKeyOf(pos) {
		  return `${pos.board.join('')}${pos.turn}`;
		}
		
		/** FEN 字符串的同型键；解析失败返回 null。 */
		function fenKeyOf(fen) {
		  try {
		    const pos = positionFromFen(fen);
		    return positionKeyOf(pos);
		  } catch {
		    return null;
		  }
		}
		
			/* ==================== lib/engine/moves.js ==================== */
		/**
		 * 着法生成与合法性判定（§5.2、§5.4）——引擎的热路径。
		 *
		 * 三个决定：整数编码着法（见 coords.js），因为 perft 深度 4 要判定三百万次着法，
		 * 对象会让 GC 成为瓶颈；「将帅照面」并进 `isSquareAttackedBy`，同列无遮挡的对方
		 * 将帅本身就是攻击，三种照面情形被同一条判据覆盖；make/unmake 就地做并立刻还原。
		 * 拒绝原因在 rules.js（§5.4 的对照面），本文件只剩「怎么走」。
		 */
		
		
		
		
		/** 棋子字符码 → 颜色码（1 红 / 2 黑 / 0 空）。查表是为了避开热路径里的 toUpperCase。 */
		const PIECE_SIDE_BY_CODE = new Uint8Array(128);
		for (const ch of 'KABNRCP') PIECE_SIDE_BY_CODE[ch.charCodeAt(0)] = RED_CODE;
		for (const ch of 'kabnrcp') PIECE_SIDE_BY_CODE[ch.charCodeAt(0)] = BLACK_CODE;
		
		/** 棋子 → 颜色码（0 = 空/非法）。 */
		function pieceSideCode(piece) {
		  if (!piece) return 0;
		  const code = piece.charCodeAt(0);
		  return code < 128 ? PIECE_SIDE_BY_CODE[code] : 0;
		}
		
		/** 找到某方帅/将的位置；不存在返回 -1。 */
		function findKingIndex(board, side) {
		  const king = side === RED_SIDE ? 'K' : 'k';
		  for (let i = 0; i < BOARD_SIZE; i += 1) if (board[i] === king) return i;
		  return -1;
		}
		
		/** 就地落子，返回被吃子（供 unmake）。 */
		function makeMoveOnBoard(board, from, to) {
		  const captured = board[to];
		  board[to] = board[from];
		  board[from] = '';
		  return captured;
		}
		
		/** 就地撤销落子。 */
		function unmakeMoveOnBoard(board, from, to, captured) {
		  board[from] = board[to];
		  board[to] = captured;
		}
		
		/**
		 * `index` 是否被 byCode 方攻击：含兵/卒的直进与过河横走、蹩马腿、炮架、
		 * 以及「同列无遮挡的对方将帅」。index 传帅/将所在格时，本函数即「被将军」。
		 */
		function isSquareAttackedBy(board, index, byCode) {
		  if (index < 0) return false;
		  const row = idxToRow(index);
		  const col = idxToCol(index);
		  const red = byCode === RED_CODE;
		  const pawn = red ? 'P' : 'p';
		  const horse = red ? 'N' : 'n';
		  const rook = red ? 'R' : 'r';
		  const cannon = red ? 'C' : 'c';
		  const king = red ? 'K' : 'k';
		
		  // 兵/卒：直前一格永远可攻；过河后还能横攻。
		  const pawnRow = red ? row + 1 : row - 1;
		  if (pawnRow >= 0 && pawnRow < BOARD_ROWS && board[pawnRow * BOARD_COLS + col] === pawn) return true;
		  if (red ? row <= 4 : row >= 5) {
		    if (col > 0 && board[row * BOARD_COLS + col - 1] === pawn) return true;
		    if (col < BOARD_COLS - 1 && board[row * BOARD_COLS + col + 1] === pawn) return true;
		  }
		
		  // 马：反推马的位置再验马腿。马腿紧贴**马**那一侧（2 步轴的中点），不是紧贴被
		  // 攻击点——按后者算会在「马在近处、腿在远处」的几何上放过本该被蹩住的马。
		  for (let i = 0; i < 8; i += 1) {
		    const r = row + HORSE_DR[i];
		    const c = col + HORSE_DC[i];
		    if (!isOnBoard(r, c) || board[r * BOARD_COLS + c] !== horse) continue;
		    const legRow = Math.abs(HORSE_DR[i]) === 2 ? r - HORSE_DR[i] / 2 : r;
		    const legCol = Math.abs(HORSE_DC[i]) === 2 ? c - HORSE_DC[i] / 2 : c;
		    if (board[legRow * BOARD_COLS + legCol] === '') return true;
		  }
		
		  // 直线：第一个子可能是车或将帅（飞将），第二个子可能是炮。
		  for (let d = 0; d < 4; d += 1) {
		    let r = row + ORTHO_DR[d];
		    let c = col + ORTHO_DC[d];
		    let screen = false;
		    while (isOnBoard(r, c)) {
		      const piece = board[r * BOARD_COLS + c];
		      if (piece !== '') {
		        if (!screen) {
		          if (piece === rook) return true;
		          if (piece === king && ORTHO_DC[d] === 0) return true;
		          screen = true;
		        } else {
		          if (piece === cannon) return true;
		          break;
		        }
		      }
		      r += ORTHO_DR[d];
		      c += ORTHO_DC[d];
		    }
		  }
		  return false;
		}
		
		/** 对外版本：side 用 'r'/'b'。 */
		function isSquareAttacked(board, index, bySide) {
		  return isSquareAttackedBy(board, index, bySide === RED_SIDE ? RED_CODE : BLACK_CODE);
		}
		
		/** 追加某方全部伪合法着法（不校验送将/照面）。 */
		function collectPseudoMoves(board, side, out) {
		  const sideCode = side === RED_SIDE ? RED_CODE : BLACK_CODE;
		  for (let from = 0; from < BOARD_SIZE; from += 1) {
		    const piece = board[from];
		    if (piece === '' || pieceSideCode(piece) !== sideCode) continue;
		    const upper = piece.toUpperCase();
		    if (upper === 'R' || upper === 'C') pushLineMoves(board, from, sideCode, upper === 'C', out);
		    else if (upper === 'N') pushHorseMoves(board, from, sideCode, out);
		    else if (upper === 'B') pushElephantMoves(board, from, sideCode, out);
		    else if (upper === 'A') pushAdvisorMoves(board, from, sideCode, out);
		    else if (upper === 'K') pushKingMoves(board, from, sideCode, out);
		    else if (upper === 'P') pushPawnMoves(board, from, sideCode, out);
		  }
		  return out;
		}
		
		/** 追加某方全部合法着法（已过滤送将、照面、挡将）。 */
		function collectLegalMoves(board, side, out) {
		  const sideCode = side === RED_SIDE ? RED_CODE : BLACK_CODE;
		  const oppCode = sideCode === RED_CODE ? BLACK_CODE : RED_CODE;
		  const ownKing = findKingIndex(board, side);
		  for (const code of collectPseudoMoves(board, side, [])) {
		    const from = decodeMoveFrom(code);
		    const to = decodeMoveTo(code);
		    const captured = makeMoveOnBoard(board, from, to);
		    const ok = ownKing < 0 || !isSquareAttackedBy(board, from === ownKing ? to : ownKing, oppCode);
		    unmakeMoveOnBoard(board, from, to, captured);
		    if (ok) out.push(code);
		  }
		  return out;
		}
		
		/** 落点非己方子就追加（调用方已保证 to 在盘上）。 */
		function pushIfReachable(board, from, to, sideCode, out) {
		  const target = board[to];
		  if (target !== '' && pieceSideCode(target) === sideCode) return;
		  out.push(encodeMoveCode(from, to));
		}
		
		/** 车（isCannon=false）与炮（isCannon=true）的直线着法。 */
		function pushLineMoves(board, from, sideCode, isCannon, out) {
		  const row = idxToRow(from);
		  const col = idxToCol(from);
		  for (let d = 0; d < 4; d += 1) {
		    let r = row + ORTHO_DR[d];
		    let c = col + ORTHO_DC[d];
		    let screen = false;
		    while (isOnBoard(r, c)) {
		      const to = r * BOARD_COLS + c;
		      const target = board[to];
		      if (target === '') {
		        if (!screen) out.push(encodeMoveCode(from, to));
		      } else if (!screen) {
		        // 车撞上第一个子只能吃；炮把第一个子当炮架，继续找第二个子。
		        if (!isCannon && pieceSideCode(target) !== sideCode) out.push(encodeMoveCode(from, to));
		        if (!isCannon) break;
		        screen = true;
		      } else {
		        if (isCannon && pieceSideCode(target) !== sideCode) out.push(encodeMoveCode(from, to));
		        break;
		      }
		      r += ORTHO_DR[d];
		      c += ORTHO_DC[d];
		    }
		  }
		  return out;
		}
		
		/** 马：先看马腿（紧邻马的那一格），再看落点。 */
		function pushHorseMoves(board, from, sideCode, out) {
		  const row = idxToRow(from);
		  const col = idxToCol(from);
		  for (let i = 0; i < 8; i += 1) {
		    const r = row + HORSE_DR[i];
		    const c = col + HORSE_DC[i];
		    if (!isOnBoard(r, c)) continue;
		    const legRow = Math.abs(HORSE_DR[i]) === 2 ? row + HORSE_DR[i] / 2 : row;
		    const legCol = Math.abs(HORSE_DC[i]) === 2 ? col + HORSE_DC[i] / 2 : col;
		    if (board[legRow * BOARD_COLS + legCol] !== '') continue;
		    pushIfReachable(board, from, r * BOARD_COLS + c, sideCode, out);
		  }
		  return out;
		}
		
		/** 相/象：塞象眼 + 不过河。 */
		function pushElephantMoves(board, from, sideCode, out) {
		  const row = idxToRow(from);
		  const col = idxToCol(from);
		  for (let i = 0; i < 4; i += 1) {
		    const r = row + DIAG_DR[i] * 2;
		    const c = col + DIAG_DC[i] * 2;
		    if (!isOnBoard(r, c)) continue;
		    if (sideCode === RED_CODE ? r < 5 : r > 4) continue;
		    if (board[(row + DIAG_DR[i]) * BOARD_COLS + (col + DIAG_DC[i])] !== '') continue;
		    pushIfReachable(board, from, r * BOARD_COLS + c, sideCode, out);
		  }
		  return out;
		}
		
		/** 仕/士：九宫内斜走一格。 */
		function pushAdvisorMoves(board, from, sideCode, out) {
		  const row = idxToRow(from);
		  const col = idxToCol(from);
		  const side = sideCode === RED_CODE ? RED_SIDE : BLACK_SIDE;
		  for (let i = 0; i < 4; i += 1) {
		    const r = row + DIAG_DR[i];
		    const c = col + DIAG_DC[i];
		    if (isInPalace(r, c, side)) pushIfReachable(board, from, r * BOARD_COLS + c, sideCode, out);
		  }
		  return out;
		}
		
		/** 帅/将：九宫内直走一格。 */
		function pushKingMoves(board, from, sideCode, out) {
		  const row = idxToRow(from);
		  const col = idxToCol(from);
		  const side = sideCode === RED_CODE ? RED_SIDE : BLACK_SIDE;
		  for (let d = 0; d < 4; d += 1) {
		    const r = row + ORTHO_DR[d];
		    const c = col + ORTHO_DC[d];
		    if (isInPalace(r, c, side)) pushIfReachable(board, from, r * BOARD_COLS + c, sideCode, out);
		  }
		  return out;
		}
		
		/** 兵/卒：向前永远可走，过河后加横走，永不后退。 */
		function pushPawnMoves(board, from, sideCode, out) {
		  const row = idxToRow(from);
		  const col = idxToCol(from);
		  const red = sideCode === RED_CODE;
		  const r = row + (red ? -1 : 1);
		  if (r >= 0 && r < BOARD_ROWS) pushIfReachable(board, from, r * BOARD_COLS + col, sideCode, out);
		  if (hasCrossedRiver(row, red ? RED_SIDE : BLACK_SIDE)) {
		    if (col > 0) pushIfReachable(board, from, row * BOARD_COLS + col - 1, sideCode, out);
		    if (col < BOARD_COLS - 1) pushIfReachable(board, from, row * BOARD_COLS + col + 1, sideCode, out);
		  }
		  return out;
		}
		
		/** 整数编码着法批量转成 §5.2 的 Move 对象。 */
		function toMoveObjects(codes) {
		  const out = new Array(codes.length);
		  for (let i = 0; i < codes.length; i += 1) {
		    out[i] = { from: decodeMoveFrom(codes[i]), to: decodeMoveTo(codes[i]) };
		  }
		  return out;
		}
		
		/** 全部伪合法着法（不校验送将/照面）。 */
		function pseudoLegalMoves(pos) {
		  if (!isValidPosition(pos)) return [];
		  return toMoveObjects(collectPseudoMoves(pos.board, pos.turn, []));
		}
		
		/** 全部合法着法。 */
		function generateMoves(pos) {
		  if (!isValidPosition(pos)) return [];
		  return toMoveObjects(collectLegalMoves(pos.board, pos.turn, []));
		}
		
		/**
		 * 落子（不校验合法性，§5.3）。返回新对象，入参不变。
		 * 着法形状非法时原样返回克隆——让调用方的 bug 以「局面没变」的形式暴露，
		 * 而不是抛异常把上层对局状态机打断。
		 */
		function applyMove(pos, move) {
		  if (!isValidPosition(pos)) return pos;
		  const next = clonePosition(pos);
		  if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to)) return next;
		  if (move.from < 0 || move.from >= BOARD_SIZE || move.to < 0 || move.to >= BOARD_SIZE) return next;
		  const captured = next.board[move.to];
		  next.board[move.to] = next.board[move.from];
		  next.board[move.from] = '';
		  next.halfmove = captured === '' ? pos.halfmove + 1 : 0;
		  next.fullmove = pos.turn === BLACK_SIDE ? pos.fullmove + 1 : pos.fullmove;
		  next.turn = oppositeSide(pos.turn);
		  return next;
		}
		
			/* ==================== lib/engine/rules.js ==================== */
		/**
		 * 规则判定（§5.4）与着法拒绝原因。
		 *
		 * 本文件是 §5.4 规则表的「对照面」，因此把两件事放在一起：
		 * **走子形状的合法性**（为什么这手不合法）与**局面状态**（将死/困毙/长将/自然限着）。
		 * 着法生成与攻击判定在 moves.js——那里是热路径，这里只在边界（工具入参、UI、
		 * 模型输出）上跑，可以将每条规则写得直白。
		 *
		 * **中国象棋特有**：无子可动（困毙）不是和棋，而是判负。这条与国际象棋相反，
		 * 是引擎里最容易被「照抄国象逻辑」写错的地方，因此配专门用例。
		 *
		 * 重复局面只能靠调用方传进来的 `history`（FEN 数组，按时间顺序、不含当前局面）
		 * 判定——引擎不持有对局历史（§5.2）。长将的判据由历史反推：若重复循环里某方
		 * 每一步都在将军，就该方判负（§9 长将判负 + 三次重复判和）。
		 */
		
		
		
		
		/** 自然限着阈值：连续 120 个半回合无吃子判和（§5.4 的 60 回合）。 */
		const FIFTY_MOVE_HALFMOVES = 120;
		
		/** 某方是否被将军（棋盘级，供搜索与描述复用）；side 用 'r'/'b'。 */
		function isBoardInCheck(board, side) {
		  return isSquareAttacked(board, findKingIndex(board, side), oppositeSide(side));
		}
		
		/** 某方是否被将军；side 省略时取当前走子方。 */
		function isInCheck(pos, side) {
		  if (!isValidPosition(pos)) return false;
		  return isBoardInCheck(pos.board, side === 'r' || side === 'b' ? side : pos.turn);
		}
		
		/** 两将同列且中间无子（照面）。局面本身非法，等价于「走成照面」的着法非法。 */
		function kingsFaceOnBoard(board) {
		  const redKing = findKingIndex(board, RED_SIDE);
		  const blackKing = findKingIndex(board, BLACK_SIDE);
		  if (redKing < 0 || blackKing < 0) return false;
		  const col = idxToCol(redKing);
		  if (col !== idxToCol(blackKing)) return false;
		  const lo = Math.min(idxToRow(redKing), idxToRow(blackKing));
		  const hi = Math.max(idxToRow(redKing), idxToRow(blackKing));
		  for (let row = lo + 1; row < hi; row += 1) {
		    if (board[row * BOARD_COLS + col] !== '') return false;
		  }
		  return true;
		}
		
		/** 归一化 history：容忍调用方把当前局面也放进数组末尾。 */
		function normalizeHistory(history, pos) {
		  const list = Array.isArray(history) ? history.slice() : [];
		  while (list.length > 0) {
		    const last = list[list.length - 1];
		    if (typeof last !== 'string' || fenKeyOf(last) !== positionKeyOf(pos)) break;
		    list.pop();
		  }
		  return list;
		}
		
		/** 当前局面（含走子方）在 `history + 自身` 中出现的次数。 */
		function countRepetition(pos, history) {
		  const key = positionKeyOf(pos);
		  let count = 1;
		  for (const fen of normalizeHistory(history, pos)) if (fenKeyOf(fen) === key) count += 1;
		  return count;
		}
		
		/**
		 * 推断「长将方」：只看最近一个重复循环内每一手的结果。
		 * 双方都长将或都无长将时返回 null（按普通三次重复判和）。
		 */
		function findPerpetualChecker(pos, history) {
		  const list = normalizeHistory(history, pos);
		  if (list.length === 0) return null;
		  const positions = [];
		  for (const fen of list) {
		    try {
		      positions.push(positionFromFen(fen));
		    } catch {
		      return null;
		    }
		  }
		  const last = positions.length;
		  positions.push(pos);
		  let start = -1;
		  for (let i = last - 1; i >= 0; i -= 1) {
		    if (positionKeyOf(positions[i]) === positionKeyOf(pos)) {
		      start = i;
		      break;
		    }
		  }
		  if (start < 0) return null;
		  const tally = { r: { made: 0, checks: 0 }, b: { made: 0, checks: 0 } };
		  for (let i = start + 1; i <= last; i += 1) {
		    const mover = positions[i - 1].turn;
		    tally[mover].made += 1;
		    if (isInCheck(positions[i], oppositeSide(mover))) tally[mover].checks += 1;
		  }
		  const redPerpetual = tally.r.made > 0 && tally.r.checks === tally.r.made;
		  const blackPerpetual = tally.b.made > 0 && tally.b.checks === tally.b.made;
		  if (redPerpetual && !blackPerpetual) return RED_SIDE;
		  if (blackPerpetual && !redPerpetual) return BLACK_SIDE;
		  return null;
		}
		
		/** 把状态压成 §5.3 的 GameStatus。 */
		function status(state, winner, reason, reasonZh) {
		  return { state, winner, reason, reasonZh };
		}
		
		/**
		 * 局面状态。判定优先级：无着法（将死/困毙）> 三次重复 > 自然限着 > 将军 > 进行中。
		 * 无着法优先级最高，否则「刚被将死但同时构成重复」会误判为和棋。
		 */
		function gameStatus(pos, history) {
		  if (!isValidPosition(pos)) return status('playing', null, 'invalid-position', '局面数据非法');
		  const side = pos.turn;
		  const inCheck = isInCheck(pos, side);
		  const moves = generateMoves(pos);
		  if (moves.length === 0) {
		    const winner = oppositeSide(side);
		    if (inCheck) {
		      return status('checkmate', winner, 'checkmate', `${sideNameZh(side)}被将死，${sideNameZh(winner)}胜`);
		    }
		    return status('stalemate', winner, 'stalemate', `${sideNameZh(side)}无子可动（困毙），按中国象棋规则判负，${sideNameZh(winner)}胜`);
		  }
		  if (countRepetition(pos, history) >= 3) {
		    const checker = findPerpetualChecker(pos, history);
		    if (checker) {
		      const winner = oppositeSide(checker);
		      return status('draw-perpetual-check', winner, 'perpetual-check', `${sideNameZh(checker)}长将，判负；${sideNameZh(winner)}胜`);
		    }
		    return status('draw-repetition', null, 'repetition', '同一局面出现三次，判和');
		  }
		  if (pos.halfmove >= FIFTY_MOVE_HALFMOVES) {
		    return status('draw-fifty', null, 'fifty-move', `连续 ${pos.halfmove} 个半回合无吃子，达到自然限着，判和`);
		  }
		  if (inCheck) return status('check', null, 'check', `${sideNameZh(side)}被将军（应将着法 ${moves.length} 个）`);
		  return status('playing', null, 'playing', '对局进行中');
		}
		
		/** 拒绝原因码 → 人话。码稳定、文案可变，测试夹具钉码（§5.4）。 */
		const MOVE_REJECT_ZH = {
		  'invalid-position': '局面数据非法',
		  'malformed-move': '着法格式非法（需要 0–89 的 from/to 整数）',
		  'off-board': '坐标越界（应在 0–89）',
		  'empty-from': '起点没有棋子',
		  'not-your-piece': '那不是当前走子方的棋子',
		  'no-movement': '起点与终点相同',
		  'own-piece-target': '终点被己方棋子占据',
		  'not-a-rook-move': '车只能沿直线走',
		  'blocked-path': '路径上有棋子挡住',
		  'not-a-cannon-move': '炮只能沿直线走',
		  'cannon-screen-missing': '炮吃子必须恰好隔一个炮架（现在没有炮架）',
		  'cannon-screen-too-many': '炮吃子必须恰好隔一个炮架（现在隔了多个）',
		  'not-a-horse-move': '马走「日」字',
		  'horse-leg-blocked': '蹩马腿：马腿位置有棋子',
		  'not-an-elephant-move': '相/象走「田」字',
		  'elephant-eye-blocked': '塞象眼：田字中心有棋子',
		  'elephant-crosses-river': '相/象不能过河',
		  'not-an-advisor-move': '仕/士只能在九宫内斜走一格',
		  'advisor-out-of-palace': '仕/士不能走出九宫',
		  'not-a-king-move': '帅/将只能在九宫内直走一格',
		  'king-out-of-palace': '帅/将不能走出九宫',
		  'not-a-pawn-move': '兵/卒不能这样走',
		  'pawn-backward': '兵/卒永不后退',
		  'pawn-sideways-before-river': '兵/卒过河后才能横走',
		  'king-facing': '走成将帅照面（两将同列且中间无子）',
		  'self-check': '走子后自己被将军（送将）',
		  'unknown-piece': '无法识别的棋子',
		};
		
		/** 走子形状是否违反该子的行棋方式；违反则返回原因码，合法返回 null。 */
		function piecePatternRejectCode(board, from, to, piece) {
		  const row = idxToRow(from);
		  const col = idxToCol(from);
		  const toRow = idxToRow(to);
		  const toCol = idxToCol(to);
		  const dr = toRow - row;
		  const dc = toCol - col;
		  const side = colorOfPiece(piece);
		  const upper = piece.toUpperCase();
		  const target = board[to];
		  if (upper === 'R' || upper === 'C') {
		    if (dr !== 0 && dc !== 0) return upper === 'R' ? 'not-a-rook-move' : 'not-a-cannon-move';
		    const stepRow = Math.sign(dr);
		    const stepCol = Math.sign(dc);
		    let r = row + stepRow;
		    let c = col + stepCol;
		    let screens = 0;
		    while (r !== toRow || c !== toCol) {
		      if (board[r * BOARD_COLS + c] !== '') screens += 1;
		      r += stepRow;
		      c += stepCol;
		    }
		    if (upper === 'R') return screens === 0 ? null : 'blocked-path';
		    if (target === '') return screens === 0 ? null : 'blocked-path';
		    if (screens === 0) return 'cannon-screen-missing';
		    return screens === 1 ? null : 'cannon-screen-too-many';
		  }
		  if (upper === 'N') {
		    const leg = horseLegIndex(from, to);
		    if (leg < 0) return 'not-a-horse-move';
		    return board[leg] === '' ? null : 'horse-leg-blocked';
		  }
		  if (upper === 'B') {
		    if (Math.abs(dr) !== 2 || Math.abs(dc) !== 2) return 'not-an-elephant-move';
		    if (side === RED_SIDE ? toRow < 5 : toRow > 4) return 'elephant-crosses-river';
		    return board[(row + dr / 2) * BOARD_COLS + (col + dc / 2)] === '' ? null : 'elephant-eye-blocked';
		  }
		  if (upper === 'A') {
		    if (Math.abs(dr) !== 1 || Math.abs(dc) !== 1) return 'not-an-advisor-move';
		    return isInPalace(toRow, toCol, side) ? null : 'advisor-out-of-palace';
		  }
		  if (upper === 'K') {
		    if (Math.abs(dr) + Math.abs(dc) !== 1) return 'not-a-king-move';
		    return isInPalace(toRow, toCol, side) ? null : 'king-out-of-palace';
		  }
		  if (upper === 'P') {
		    const forward = side === RED_SIDE ? -1 : 1;
		    if (dc === 0 && dr === forward) return null;
		    if (dc === 0 && dr === -forward) return 'pawn-backward';
		    if (dr === 0 && Math.abs(dc) === 1) return hasCrossedRiver(row, side) ? null : 'pawn-sideways-before-river';
		    return 'not-a-pawn-move';
		  }
		  return 'unknown-piece';
		}
		
		/**
		 * 判定着法并给出机器可读的拒绝原因码；合法返回 null。
		 * 供测试夹具（§5.4 规则反例集）与 UI 分层使用：码稳定，文案可变。
		 */
		function moveRejectCode(pos, move) {
		  if (!isValidPosition(pos)) return 'invalid-position';
		  if (!move || typeof move !== 'object') return 'malformed-move';
		  const { from, to } = move;
		  if (!Number.isInteger(from) || !Number.isInteger(to)) return 'malformed-move';
		  if (from < 0 || from >= BOARD_SIZE || to < 0 || to >= BOARD_SIZE) return 'off-board';
		  const piece = pos.board[from];
		  if (piece === '') return 'empty-from';
		  if (colorOfPiece(piece) !== pos.turn) return 'not-your-piece';
		  if (from === to) return 'no-movement';
		  const target = pos.board[to];
		  if (target !== '' && colorOfPiece(target) === pos.turn) return 'own-piece-target';
		  const pattern = piecePatternRejectCode(pos.board, from, to, piece);
		  if (pattern !== null) return pattern;
		
		  const board = pos.board;
		  const oppSide = oppositeSide(pos.turn);
		  const ownKing = findKingIndex(board, pos.turn);
		  const captured = makeMoveOnBoard(board, from, to);
		  const attacked = ownKing >= 0 && isSquareAttacked(board, from === ownKing ? to : ownKing, oppSide);
		  const facing = attacked && kingsFaceOnBoard(board);
		  unmakeMoveOnBoard(board, from, to, captured);
		  if (facing) return 'king-facing';
		  if (attacked) return 'self-check';
		  return null;
		}
		
		/** 是否合法着法。 */
		function isLegalMove(pos, move) {
		  return moveRejectCode(pos, move) === null;
		}
		
		/** 人话拒绝原因；合法返回 null。 */
		function moveRejectReason(pos, move) {
		  const code = moveRejectCode(pos, move);
		  if (code === null) return null;
		  const tip = MOVE_REJECT_ZH[code] ?? code;
		  const from = squareToIccs(move?.from);
		  const to = squareToIccs(move?.to);
		  const who = isValidPosition(pos) ? pieceNameZh(pos.board[move?.from] ?? '') : '';
		  return `非法着法：${tip}（${from}${to}，${who}）`;
		}
		
			/* ==================== lib/engine/notation-zh.js ==================== */
		/**
		 * 中文记谱的生成与解析（§5.5）。
		 *
		 * 三条贯穿本文件的取舍：
		 *
		 * 1. **生成与解析共用同一套「结构化分解」**（`zhMoveParts`）。若两边各写一遍
		 *    方向/文件号/消歧逻辑，就一定会出现「生成出来解析不回去」的漂移。
		 * 2. **解析只在 `generateMoves(pos)` 的合法着法集合里匹配唯一解**（§5.5）。
		 *    0 个或多于 1 个都返回 error，歧义附带候选——绝不静默任选，
		 *    否则「记谱解析」会变成一条绕过规则的暗路。
		 * 3. 解析对**写法**宽容（红黑数字体系、前/中/后 与 一二三四五 互认），
		 *    但对**位置**严格：前缀只在同列同名子 ≥2 时才有意义。
		 */
		
		
		
		/** 中文棋子字 → 大写规范字符。马/车/炮 的最终大小写由走子方决定。 */
		const ZH_CHAR_TO_UPPER = { 帅: 'K', 仕: 'A', 相: 'B', 马: 'N', 车: 'R', 炮: 'C', 兵: 'P', 将: 'K', 士: 'A', 象: 'B', 卒: 'P' };
		
		/** 只能属于红方的中文字（写出「将」却轮到红方走，是记谱错误而非歧义）。 */
		const ZH_RED_ONLY = new Set(['帅', '仕', '相', '兵']);
		const ZH_BLACK_ONLY = new Set(['将', '士', '象', '卒']);
		const ZH_PIECE_CHARS = '帅仕相马车炮兵将士象马车炮卒KABNRCPkabnrcp';
		
		/** 序号前缀：一/二/三/四/五（红）与 1–5（黑），双方解析时都接受。 */
		const NUMBERED_PREFIXES = ['一', '二', '三', '四', '五'];
		
		/** 着法 → ICCS（纯坐标换算，不需要局面）。 */
		function moveToIccs(move) {
		  if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to)) return '';
		  const from = squareToIccs(move.from);
		  const to = squareToIccs(move.to);
		  return from && to ? `${from}${to}` : '';
		}
		
		/**
		 * ICCS → 着法。**按合法性校验**：只有当这串坐标正好是 `pos` 的一个合法着法时
		 * 才返回它，否则返回 null。理由：签名里带 `pos`，且 Move|null 若只做纯坐标
		 * 解析，非法着法会一路漏到 `applyMove`（它按契约不做校验）。
		 * 需要「为什么非法」时用 `parseAnyMove` / `moveRejectReason`。
		 */
		function iccsToMove(pos, iccs) {
		  if (!isValidPosition(pos)) return null;
		  const text = typeof iccs === 'string' ? normalizeIccsText(iccs) : '';
		  if (text.length !== 4) return null;
		  const from = iccsToSquare(text.slice(0, 2));
		  const to = iccsToSquare(text.slice(2));
		  if (from < 0 || to < 0) return null;
		  const move = { from, to };
		  return moveRejectCode(pos, move) === null ? move : null;
		}
		
		/** 同列同名子的「从前到后」序号：0 = 最靠近对方底线。 */
		function zhSameColumnGroup(board, piece, col, side) {
		  const group = [];
		  for (let i = 0; i < board.length; i += 1) {
		    if (board[i] === piece && idxToCol(i) === col) group.push(i);
		  }
		  group.sort((a, b) => (side === RED_SIDE ? idxToRow(a) - idxToRow(b) : idxToRow(b) - idxToRow(a)));
		  return group;
		}
		
		/** 消歧前缀：两个用前/后，三个兵用前/中/后，其余按序号。 */
		function zhDisambigLabel(upper, count, index, side) {
		  if (count === 2) return index === 0 ? '前' : '后';
		  if (count === 3 && upper === 'P') return ['前', '中', '后'][index];
		  const numeral = side === RED_SIDE ? NUMBERED_PREFIXES[index] : String(index + 1);
		  return numeral ?? String(index + 1);
		}
		
		/**
		 * 把一手棋分解成记谱字段。生成与解析共用；无法分解（起点无子/坐标非法）返回 null。
		 * `fromFileNumber` 即使在需要消歧时也照常给出，解析才能按文件号匹配。
		 */
		function zhMoveParts(pos, move) {
		  if (!isValidPosition(pos) || !move) return null;
		  const { from, to } = move;
		  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
		  if (from < 0 || from > 89 || to < 0 || to > 89) return null;
		  const piece = pos.board[from];
		  if (piece === '') return null;
		  const side = colorOfPiece(piece);
		  const upper = piece.toUpperCase();
		  const fromRow = idxToRow(from);
		  const fromCol = idxToCol(from);
		  const toRow = idxToRow(to);
		  const toCol = idxToCol(to);
		
		  let action;
		  let targetText;
		  if (toRow === fromRow) {
		    action = '平';
		    targetText = fileNumberText(colToFileNumber(toCol, side), side);
		  } else {
		    const forward = side === RED_SIDE ? -1 : 1;
		    action = (toRow - fromRow) * forward > 0 ? '进' : '退';
		    // 斜行子（马/相/仕）的进退取目标文件号；直行子取步数。
		    const diagonal = upper === 'N' || upper === 'B' || upper === 'A';
		    targetText = diagonal
		      ? fileNumberText(colToFileNumber(toCol, side), side)
		      : countText(Math.abs(toRow - fromRow), side);
		  }
		
		  const group = zhSameColumnGroup(pos.board, piece, fromCol, side);
		  const disambigCount = group.length;
		  const disambigIndex = group.indexOf(from);
		  let prefix = '';
		  let fileText = '';
		  if (disambigCount >= 2) {
		    prefix = zhDisambigLabel(upper, disambigCount, disambigIndex, side);
		  } else {
		    fileText = fileNumberText(colToFileNumber(fromCol, side), side);
		  }
		  return {
		    piece,
		    upper,
		    side,
		    pieceName: pieceNameZh(piece),
		    pieceChar: upper,
		    action,
		    targetText,
		    prefix,
		    fileText,
		    fromFileNumber: colToFileNumber(fromCol, side),
		    disambigCount,
		    disambigIndex,
		    text: `${prefix}${pieceNameZh(piece)}${fileText}${action}${targetText}`,
		  };
		}
		
		/** 生成中文记谱。起点无子或坐标非法时返回 ''（不抛异常）。 */
		function formatChinese(pos, move) {
		  const parts = zhMoveParts(pos, move);
		  return parts ? parts.text : '';
		}
		
		/** 记谱文本 → 数字：中文数字与阿拉伯数字都接受；无法识别返回 0。 */
		function parseZhDigit(text) {
		  if (!text) return 0;
		  if (text >= '1' && text <= '9') return Number(text);
		  return zhDigitValue(text);
		}
		
		/** 全角字母/数字 → 半角（模型与手输都常带全角）。 */
		function toHalfWidth(text) {
		  return text.replace(/[ａ-ｚＡ-Ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
		}
		
		/** 归一化 ICCS：去空白与分隔符、全角转半角、转小写。 */
		function normalizeIccsText(text) {
		  return toHalfWidth(String(text)).replace(/[\s　]/g, '').replace(/[-–—>→()（）「」]/g, '').toLowerCase();
		}
		
		/** 归一化输入：去空白与标点、去将军标记、全角转半角。 */
		function normalizeZhInput(text) {
		  return toHalfWidth(String(text))
		    .replace(/[\s　]/g, '')
		    .replace(/[，,。；;！!？?、（）()「」【】]/g, '')
		    .replace(/[＋+＃#＊*]/g, '');
		}
		
		const ZH_PARSE_RE = new RegExp(
		  `^(前|后|中|[一二三四五1-5])?([${ZH_PIECE_CHARS}])([一二三四五六七八九1-9])?(进|退|平)([一二三四五六七八九1-9])$`,
		);
		
		/** 前缀是否指向该候选着法的消歧序号。 */
		function zhPrefixMatches(prefix, parts) {
		  if (parts.disambigCount < 2) return false;
		  if (prefix === '前') return parts.disambigIndex === 0;
		  if (prefix === '后') return parts.disambigIndex === parts.disambigCount - 1;
		  if (prefix === '中') return parts.disambigCount === 3 && parts.disambigIndex === 1;
		  const index = parseZhDigit(prefix);
		  return index >= 1 && index <= parts.disambigCount && parts.disambigIndex === index - 1;
		}
		
		/** 中文棋子字 → 规范棋子字符；与走子方矛盾时返回 null。 */
		function zhCharToPiece(ch, turn) {
		  const isRedTurn = turn === RED_SIDE;
		  if (ch >= 'A' && ch <= 'Z') return isRedTurn ? ch : null;
		  if (ch >= 'a' && ch <= 'z') return isRedTurn ? null : ch;
		  const upper = ZH_CHAR_TO_UPPER[ch];
		  if (!upper) return null;
		  if (ZH_RED_ONLY.has(ch)) return isRedTurn ? upper : null;
		  if (ZH_BLACK_ONLY.has(ch)) return isRedTurn ? null : upper.toLowerCase();
		  return isRedTurn ? upper : upper.toLowerCase();
		}
		
		/**
		 * 中文记谱 → 着法。只在合法着法集合里匹配唯一解：
		 * 0 个返回 `{ error }`，多于 1 个返回 `{ error, candidates }`。
		 */
		function parseChinese(pos, text) {
		  if (!isValidPosition(pos)) return { error: '局面数据非法' };
		  const cleaned = normalizeZhInput(text);
		  if (cleaned === '') return { error: '没有给出着法' };
		  const matched = ZH_PARSE_RE.exec(cleaned);
		  if (!matched) {
		    return { error: `无法识别的中文记谱：「${text}」（形如 炮二平五 / 马8进7 / 前车进三）` };
		  }
		  const [, prefix, pieceChar, fileText, action, targetText] = matched;
		  const piece = zhCharToPiece(pieceChar, pos.turn);
		  if (!piece) {
		    return { error: `「${pieceChar}」不是${pos.turn === RED_SIDE ? '红方' : '黑方'}的棋子（现在轮到${pos.turn === RED_SIDE ? '红方' : '黑方'}走子）` };
		  }
		  const fileNumber = fileText ? parseZhDigit(fileText) : 0;
		  const targetValue = parseZhDigit(targetText);
		  if (targetValue === 0) return { error: `无法识别的数字：「${targetText}」` };
		  if (fileText && fileNumber === 0) return { error: `无法识别的文件号：「${fileText}」` };
		
		  const candidates = [];
		  for (const move of generateMoves(pos)) {
		    const parts = zhMoveParts(pos, move);
		    if (!parts || parts.piece !== piece) continue;
		    if (parts.action !== action) continue;
		    if (parseZhDigit(parts.targetText) !== targetValue) continue;
		    if (prefix) {
		      if (!zhPrefixMatches(prefix, parts)) continue;
		    } else if (fileText) {
		      if (parts.fromFileNumber !== fileNumber) continue;
		    }
		    candidates.push({ move, text: parts.text });
		  }
		
		  if (candidates.length === 1) return { move: candidates[0].move };
		  if (candidates.length === 0) {
		    return { error: `没有匹配的合法着法：「${cleaned}」（该写法在本局面下不合法，或与合法着法集合不符）` };
		  }
		  return {
		    error: `中文记谱有歧义：「${cleaned}」可对应 ${candidates.length} 个合法着法，请写出消歧前缀或改用 ICCS`,
		    candidates: candidates.map((c) => `${moveToIccs(c.move)} ${c.text}`),
		  };
		}
		
		/**
		 * 自动识别 ICCS 或中文记谱（§5.3）。容错处理分隔符与全角字符，
		 * 非法时返回结构化的 `{ error }`，绝不抛异常。
		 */
		function parseAnyMove(pos, text) {
		  if (!isValidPosition(pos)) return { error: '局面数据非法' };
		  if (typeof text !== 'string' || text.trim() === '') return { error: '没有给出着法' };
		  const raw = text.trim();
		  const iccs = normalizeIccsText(raw);
		  if (/^[a-i][0-9][a-i][0-9]$/.test(iccs)) {
		    const move = iccsToMove(pos, iccs);
		    if (move) return { move };
		    // 上面的正则已经保证列 a–i、行 0–9，映射出来的索引必然在盘上。
		    const from = iccsToSquare(iccs.slice(0, 2));
		    const to = iccsToSquare(iccs.slice(2));
		    return { error: moveRejectReason(pos, { from, to }) ?? `着法不在合法着法集合里：「${raw}」` };
		  }
		  return parseChinese(pos, raw);
		}
		
			/* ==================== lib/engine/eval.js ==================== */
		/**
		 * 评估函数（§5.7）：分值单位「厘兵」（兵 = 100），分值一律以**红方视角**给出
		 * （正 = 红优），这样 `searchBestMove` 的极大极小不需要反复换符号。
		 *
		 * 可解释性是硬要求（§5.6 的摘要、模型解释「为什么这步好」）：每个可加项都单独
		 * 产出一条 `EvalTerm`，`summaryZh` 只由这些项拼出来——不允许出现「分数变了但
		 * 说不出是谁贡献的」这种情况，否则摘要是编的，模型会跟着编。
		 */
		
		
		
		
		/** 机动性权重：每多一个合法着法折算的厘兵（§5.7 的 ±2/着）。 */
		const MOBILITY_WEIGHT = 2;
		
		/** 过河兵每推进一行的加成，以及「兵临城下」的一次性加成。 */
		const PAWN_ADVANCE_WEIGHT = 15;
		const PAWN_AT_GATE_BONUS = 40;
		
		/** 缺一个士/象的惩罚基数（对方有车或炮时才生效）。 */
		const GUARD_WEAKNESS_WEIGHT = 25;
		
		/** 无根子与牵制的惩罚上限，避免残局里个别子把总分拉爆。 */
		const HANGING_CAP = 120;
		const PIN_PENALTY = 20;
		
		const ZH_COUNTERS = ['', '一', '二', '三', '四', '五'];
		const MATERIAL_ORDER = ['R', 'C', 'N', 'B', 'A', 'P'];
		
		/** 棋子在某格的分值：兵/卒过河翻倍（§5.7 的 100 → 200）。 */
		function evalPieceValue(piece, index) {
		  const base = PIECE_BASE_VALUE[piece] ?? 0;
		  if (piece === 'P' || piece === 'p') {
		    const row = idxToRow(index);
		    return hasCrossedRiver(row, piece === 'P' ? RED_SIDE : 'b') ? 200 : base;
		  }
		  return base;
		}
		
		/** 子力项：红方总子力 − 黑方总子力。 */
		function evalMaterial(board) {
		  let score = 0;
		  for (let i = 0; i < BOARD_SIZE; i += 1) {
		    const piece = board[i];
		    if (piece === '') continue;
		    const value = evalPieceValue(piece, i);
		    score += colorOfPiece(piece) === RED_SIDE ? value : -value;
		  }
		  return score;
		}
		
		/** 机动性项：红方合法着法数 − 黑方合法着法数，乘权重。 */
		function evalMobility(pos) {
		  const red = generateMoves({ ...pos, turn: RED_SIDE }).length;
		  const black = generateMoves({ ...pos, turn: 'b' }).length;
		  return { score: (red - black) * MOBILITY_WEIGHT, red, black };
		}
		
		/** 过河兵项：推进越深越值钱，逼近九宫再给一次性加成。 */
		function evalPawnAdvance(board) {
		  let score = 0;
		  const notes = { r: 0, b: 0 };
		  for (let i = 0; i < BOARD_SIZE; i += 1) {
		    const piece = board[i];
		    if (piece !== 'P' && piece !== 'p') continue;
		    const side = piece === 'P' ? RED_SIDE : 'b';
		    const row = idxToRow(i);
		    if (!hasCrossedRiver(row, side)) continue;
		    const advance = side === RED_SIDE ? 5 - row : row - 4;
		    const atGate = side === RED_SIDE ? row <= 1 : row >= 8;
		    const gain = advance * PAWN_ADVANCE_WEIGHT + (atGate ? PAWN_AT_GATE_BONUS : 0);
		    score += side === RED_SIDE ? gain : -gain;
		    if (side === RED_SIDE) notes.r += 1;
		    else notes.b += 1;
		  }
		  return { score, notes };
		}
		
		/** 计数某方的士/象数量。 */
		function countGuards(board, side) {
		  let guards = 0;
		  for (let i = 0; i < BOARD_SIZE; i += 1) {
		    const piece = board[i];
		    if (piece === '') continue;
		    if (colorOfPiece(piece) !== side) continue;
		    if (piece === 'A' || piece === 'B' || piece === 'a' || piece === 'b') guards += 1;
		  }
		  return guards;
		}
		
		/** 九宫防守项：缺士缺象，且对方还留有车/炮时才扣分。 */
		function evalKingSafety(board) {
		  const heavy = { r: false, b: false };
		  for (let i = 0; i < BOARD_SIZE; i += 1) {
		    const piece = board[i];
		    if (piece === 'R' || piece === 'C') heavy.r = true;
		    else if (piece === 'r' || piece === 'c') heavy.b = true;
		  }
		  const redGuards = countGuards(board, RED_SIDE);
		  const blackGuards = countGuards(board, 'b');
		  const redWeak = heavy.b ? Math.max(0, 4 - redGuards) * GUARD_WEAKNESS_WEIGHT : 0;
		  const blackWeak = heavy.r ? Math.max(0, 4 - blackGuards) * GUARD_WEAKNESS_WEIGHT : 0;
		  return { score: blackWeak - redWeak, redGuards, blackGuards };
		}
		
		/** 无根子与牵制项：被攻击且无己方保护扣分；一动就露帅的子另计。 */
		function evalHangingAndPins(board) {
		  const redKing = findKingIndex(board, RED_SIDE);
		  const blackKing = findKingIndex(board, 'b');
		  let score = 0;
		  let redHanging = 0;
		  let blackHanging = 0;
		  let redPinned = 0;
		  let blackPinned = 0;
		  for (let i = 0; i < BOARD_SIZE; i += 1) {
		    const piece = board[i];
		    if (piece === '' || piece === 'K' || piece === 'k') continue;
		    const side = colorOfPiece(piece);
		    const ownCode = side === RED_SIDE ? RED_CODE : BLACK_CODE;
		    const oppCode = ownCode === RED_CODE ? BLACK_CODE : RED_CODE;
		    if (isSquareAttackedBy(board, i, oppCode) && !isSquareAttackedBy(board, i, ownCode)) {
		      const penalty = Math.min(Math.round(evalPieceValue(piece, i) / 10), 60);
		      score += side === RED_SIDE ? -penalty : penalty;
		      if (side === RED_SIDE) redHanging += 1;
		      else blackHanging += 1;
		    }
		    // 牵制：把这颗子拿掉后帅才被攻击，说明它被绝对牵制（移走即露帅）。
		    const kingAt = side === RED_SIDE ? redKing : blackKing;
		    if (kingAt >= 0) {
		      const before = isSquareAttackedBy(board, kingAt, oppCode);
		      const saved = board[i];
		      board[i] = '';
		      const after = isSquareAttackedBy(board, kingAt, oppCode);
		      board[i] = saved;
		      if (!before && after) {
		        score += side === RED_SIDE ? -PIN_PENALTY : PIN_PENALTY;
		        if (side === RED_SIDE) redPinned += 1;
		        else blackPinned += 1;
		      }
		    }
		  }
		  return { score: Math.max(-HANGING_CAP, Math.min(HANGING_CAP, score)), redHanging, blackHanging, redPinned, blackPinned };
		}
		
		/** 子力差的中文短语，如「净多一车一兵」。 */
		function materialDiffZh(board) {
		  const counts = {};
		  for (const type of MATERIAL_ORDER) counts[type] = 0;
		  for (let i = 0; i < BOARD_SIZE; i += 1) {
		    const piece = board[i];
		    if (piece === '') continue;
		    const type = piece.toUpperCase();
		    if (type === 'K') continue;
		    counts[type] += colorOfPiece(piece) === RED_SIDE ? 1 : -1;
		  }
		  const describe = (sign) => MATERIAL_ORDER
		    .filter((type) => (sign > 0 ? counts[type] > 0 : counts[type] < 0))
		    .map((type) => `${ZH_COUNTERS[Math.min(5, Math.abs(counts[type]))] ?? ''}${pieceNameZh(sign > 0 ? type : type.toLowerCase())}`)
		    .join('');
		  const red = describe(1);
		  const black = describe(-1);
		  if (red && !black) return `红方净多${red}`;
		  if (black && !red) return `黑方净多${black}`;
		  if (red && black) return `红方多${red}、黑方多${black}`;
		  return '双方子力相当';
		}
		
		/** 评估局面。返回 `{ score, breakdown, summaryZh }`，score 为红方视角。 */
		function evaluate(pos) {
		  if (!isValidPosition(pos)) {
		    return { score: 0, breakdown: [], summaryZh: '局面数据非法，无法评估' };
		  }
		  const board = pos.board;
		  const material = evalMaterial(board);
		  const mobility = evalMobility(pos);
		  const pawns = evalPawnAdvance(board);
		  const safety = evalKingSafety(board);
		  const hanging = evalHangingAndPins(board);
		  const breakdown = [
		    { id: 'material', nameZh: '子力', score: material, detailZh: materialDiffZh(board) },
		    { id: 'mobility', nameZh: '机动性', score: mobility.score, detailZh: `红方 ${mobility.red} 着，黑方 ${mobility.black} 着` },
		    { id: 'pawn-advance', nameZh: '过河兵推进', score: pawns.score, detailZh: `红方过河兵 ${pawns.notes.r} 个，黑方过河卒 ${pawns.notes.b} 个` },
		    { id: 'king-safety', nameZh: '九宫防守', score: safety.score, detailZh: `红方士象 ${safety.redGuards} 个，黑方士象 ${safety.blackGuards} 个` },
		    { id: 'hanging-pin', nameZh: '无根子与牵制', score: hanging.score, detailZh: `红方无根 ${hanging.redHanging} 子、被牵制 ${hanging.redPinned} 子；黑方无根 ${hanging.blackHanging} 子、被牵制 ${hanging.blackPinned} 子` },
		  ];
		  const score = breakdown.reduce((sum, term) => sum + term.score, 0);
		  return { score, breakdown, summaryZh: summarizeEval(score, breakdown) };
		}
		
		/** 由逐项结论拼中文摘要；每一项都必须能追到 breakdown 里的某个数值。 */
		function summarizeEval(score, breakdown) {
		  const term = (id) => breakdown.find((item) => item.id === id);
		  const material = term('material');
		  const mobility = term('mobility');
		  const pawns = term('pawn-advance');
		  const safety = term('king-safety');
		  const hanging = term('hanging-pin');
		  const clauses = [`${material.detailZh}（总分 ${score >= 0 ? '+' : ''}${score}）`];
		  if (Math.abs(mobility.score) >= 4) {
		    clauses.push(mobility.score > 0 ? '红方着法更活' : '黑方着法更活');
		  }
		  if (pawns.score !== 0) clauses.push(pawns.score > 0 ? '红方过河兵压境' : '黑方过河卒压境');
		  if (safety.score > 0) clauses.push('黑方九宫缺士象');
		  else if (safety.score < 0) clauses.push('红方九宫缺士象');
		  if (hanging.score <= -PIN_PENALTY) clauses.push('红方有子无根或被牵制');
		  else if (hanging.score >= PIN_PENALTY) clauses.push('黑方有子无根或被牵制');
		  return clauses.join('；');
		}
		
		/** 供 describe 使用的中文方名（避免各处重复实现）。 */
		function evalSideNameZh(side) {
		  return sideNameZh(side);
		}
		
			/* ==================== lib/engine/describe.js ==================== */
		/**
		 * 对 AI 友好的局面描述（§5.6，FR 差异点 3）。
		 *
		 * 格式必须**逐字符稳定**：模型靠它对齐「棋盘图 / FEN / 上一手 / 状态 / 评估 /
		 * 合法着法目录」六段，任何一段忽有忽无都会让模型开始猜。因此：
		 *
		 * 1. 六段**永远都在**（由 `DescribeOptions` 显式关掉的除外），缺数据时打印占位符
		 *    而不是省略整行；
		 * 2. 合法着法目录默认包含，超过 `maxMoves` 时按「吃子 > 将军 > 其它」截断并注明，
		 *    避免把上下文塞爆（§5.6）；
		 * 3. 上一手必须由调用方传入（引擎不持有历史，§5.2）。传 `MoveRecord` 最完整；
		 *    只传 `Move` 时只能给出 ICCS——中文记谱需要**走子前**的局面才能消歧（§5.2），
		 *    事后无法可靠重建，所以这里不猜。
		 */
		
		
		const RIVER_LINE = '  —— 楚 河     汉 界 ——';
		
		/**
		 * ASCII 棋盘（含中文文件号表头与楚河汉界）。行号从黑方底线起 1..10。
		 * 棋子字符与 FEN 同源：`P`/`p`、`N`/`n` 只差大小写，因此调用方必须同时给出
		 * 图例行（见 `BOARD_LEGEND`），否则模型很容易把红兵看成黑卒。
		 */
		function renderAsciiBoard(board) {
		  const lines = [`  ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((col) => fileNumberText(colToFileNumber(col, 'r'), 'r')).join(' ')}`];
		  for (let row = 0; row < BOARD_ROWS; row += 1) {
		    const cells = [];
		    for (let col = 0; col < BOARD_COLS; col += 1) {
		      const piece = board[row * BOARD_COLS + col];
		      cells.push(piece === '' ? '.' : piece);
		    }
		    lines.push(`${String(row + 1).padStart(2, ' ')} ${cells.join('  ')}`);
		    if (row === 4) lines.push(RIVER_LINE);
		  }
		  return lines;
		}
		
		/** 棋盘图例。与 FEN 同源的字母约定必须显式说明，否则大小写极易看反。 */
		const BOARD_LEGEND = '图例：大写=红方，小写=黑方，. 为空；字母约定与下方 FEN 一致';
		
		/** 上一手：接受 MoveRecord 形状、Move 或字符串；缺数据时给占位符。 */
		function renderLastMove(lastMove) {
		  if (lastMove === undefined || lastMove === null) return '（未提供）';
		  if (typeof lastMove === 'string') return lastMove === '' ? '（未提供）' : lastMove;
		  if (typeof lastMove !== 'object') return '（未提供）';
		  const iccs = typeof lastMove.iccs === 'string' && lastMove.iccs !== '' ? lastMove.iccs : moveToIccs(lastMove);
		  const color = lastMove.color === 'r' || lastMove.color === 'b'
		    ? lastMove.color
		    : colorOfPiece(lastMove.piece ?? '');
		  const head = color ? `${sideNameZh(color)} ` : '';
		  const zh = typeof lastMove.zh === 'string' && lastMove.zh !== '' ? lastMove.zh : '';
		  const notation = zh && iccs ? `${zh}（${iccs}）` : zh || iccs;
		  if (!notation) return '（未提供）';
		  let tail = '';
		  if (lastMove.mate === true) tail = '，将死';
		  else if (lastMove.check === true) tail = '，将军';
		  else if (lastMove.check === false) tail = '，未将军';
		  return `${head}${notation}${tail}`;
		}
		
		/** 状态行：理由直接取 gameStatus（它已经带上了应将着法数等细节）。 */
		function renderStatusLine(pos, history) {
		  const status = gameStatus(pos, history);
		  if (status.state === 'playing' || status.state === 'check') {
		    return status.reasonZh;
		  }
		  return `${status.reasonZh}（${status.state}）`;
		}
		
		/** 着法目录条目（含 describe 内部排序需要的将军标记）。 */
		function describeCatalogEntries(pos) {
		  const entries = [];
		  for (const move of generateMoves(pos)) {
		    const next = applyMove(pos, move);
		    entries.push({
		      move,
		      iccs: moveToIccs(move),
		      zh: formatChinese(pos, move),
		      capture: pos.board[move.to],
		      check: isInCheck(next, next.turn),
		    });
		  }
		  return entries;
		}
		
		/** 合法着法目录（§5.3 的精确形状：只含 iccs / zh / capture）。 */
		function legalMoveCatalog(pos) {
		  if (!isValidPosition(pos)) return [];
		  return describeCatalogEntries(pos).map((entry) => ({ iccs: entry.iccs, zh: entry.zh, capture: entry.capture }));
		}
		
		/** 截断优先级：吃子 > 将军 > 其它（同类内保持生成顺序，结果稳定）。 */
		function describePriority(entry) {
		  if (entry.capture !== '') return 0;
		  if (entry.check) return 1;
		  return 2;
		}
		
		/** 目录正文：按优先级截断，并按每行 6 个折行（模型与人都好读）。 */
		function renderCatalog(entries, maxMoves) {
		  let selected = entries;
		  let note = '';
		  if (entries.length > maxMoves) {
		    selected = entries
		      .map((entry, index) => ({ entry, index }))
		      .sort((a, b) => describePriority(a.entry) - describePriority(b.entry) || a.index - b.index)
		      .slice(0, maxMoves)
		      .map((item) => item.entry);
		    note = `（共 ${entries.length} 个，已按「吃子 > 将军 > 其它」截断到 ${maxMoves} 个）`;
		  }
		  const lines = [];
		  for (let i = 0; i < selected.length; i += 6) {
		    const chunk = selected.slice(i, i + 6).map((entry) => `${entry.iccs} ${entry.zh}`);
		    lines.push(`  ${chunk.join(' | ')}`);
		  }
		  if (lines.length === 0) lines.push('  （无合法着法）');
		  if (note) lines.push(`  ${note}`);
		  return lines;
		}
		
		/**
		 * 局面描述（§5.6）。`DescribeOptions` 控制详略：
		 * `{ includeMoves?, includeEval?, ascii?, maxMoves?, lastMove?, history? }`。
		 * `lastMove` 与 `history` 是 §5.6 示例里「上一手」一行的必要输入（引擎不持有历史）。
		 */
		function describePosition(pos, opts = {}) {
		  if (!isValidPosition(pos)) return '局面数据非法，无法描述';
		  const includeMoves = opts.includeMoves !== false;
		  const includeEval = opts.includeEval !== false;
		  const withAscii = opts.ascii !== false;
		  const maxMoves = Number.isInteger(opts.maxMoves) && opts.maxMoves > 0 ? opts.maxMoves : 80;
		
		  const lines = [`局面（第 ${pos.fullmove} 回合，${sideNameZh(pos.turn)}走子）`];
		  if (withAscii) lines.push(...renderAsciiBoard(pos.board), BOARD_LEGEND);
		  lines.push(`FEN: ${positionToFen(pos)}`);
		  lines.push(`上一手：${renderLastMove(opts.lastMove)}`);
		  lines.push(`状态：${renderStatusLine(pos, opts.history)}`);
		  if (includeEval) lines.push(`评估：${evaluate(pos).summaryZh}`);
		  if (includeMoves) {
		    const entries = describeCatalogEntries(pos);
		    lines.push(`合法着法（${entries.length} 个，ICCS / 中文）：`);
		    lines.push(...renderCatalog(entries, maxMoves));
		  }
		  return lines.join('\n');
		}
		
			/* ==================== lib/engine/search.js ==================== */
		/**
		 * 本地搜索（§5.7）：迭代加深 alpha-beta + 置换表 + 着法排序（MVV-LVA + 历史启发）。
		 *
		 * 用途：`xiangqi_hint` 与「模型不可用时降级对手」（FR11、FR17）。
		 *
		 * 几个必须明确的语义：
		 *
		 * - **`score` 是走子方视角**（正 = 对当前走子方有利），不是红方视角——提示场景里
		 *   调用方只关心「这步对我多好」。`evaluate` 才是红方视角，两者在叶子处换号。
		 * - **无着法一律返回负的将杀分**：中国象棋里困毙（无子可动）同样判负（§5.4），
		 *   所以叶子处的「无着法」不需要区分是否被将军——这与国际象棋相反。
		 * - **确定性**：`seed` 只在整轮迭代结束后用于「同分着法挑一个」，因此同 seed、
		 *   同完成深度必得同结果。时间限制本身依赖墙钟，所以「同 seed 必得同结果」的
		 *   前提是搜索在时限内跑完（§5.7 的双限）。
		 */
		
		
		
		
		
		/** 将杀分。任何正常评估都不可能接近它，因此「分值 ≥ MATE_SCORE - ply」即找到杀。 */
		const SEARCH_MATE_SCORE = 100000;
		const SEARCH_INFINITY = 1 << 20;
		const SEARCH_MAX_PLY = 48;
		const SEARCH_DEFAULT_DEPTH = 4;
		const SEARCH_DEFAULT_TIME_MS = 300;
		
		/** mulberry32：小而确定的 PRNG，避免为了同分随机去引入依赖。 */
		function searchPrng(seed) {
		  let state = (seed >>> 0) || 0x9e3779b9;
		  return () => {
		    state = (state + 0x6d2b79f5) >>> 0;
		    let t = state;
		    t = Math.imul(t ^ (t >>> 15), t | 1);
		    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		  };
		}
		
		/** 局面哈希（含走子方）。O(90) 但实现简单，且不依赖任何增量维护的正确性。 */
		function searchHash(board, side) {
		  let h = side === RED_SIDE ? 0x9e3779b1 : 0x85ebca6b;
		  for (let i = 0; i < 90; i += 1) {
		    const piece = board[i];
		    if (piece === '') continue;
		    h = Math.imul(h ^ (piece.charCodeAt(0) * 31 + i), 0x01000193) >>> 0;
		  }
		  return h;
		}
		
		/** 走子方视角的静态评估。 */
		function searchEvaluate(state, side) {
		  state.view.turn = side;
		  const score = evaluate(state.view).score;
		  return side === RED_SIDE ? score : -score;
		}
		
		/** 着法排序分值：置换表着法 > 吃子（MVV-LVA）> 杀手着法 > 历史启发。 */
		function searchMoveScore(state, code, ttMove, ply) {
		  if (code === ttMove) return SEARCH_INFINITY;
		  const from = decodeMoveFrom(code);
		  const to = decodeMoveTo(code);
		  const victim = state.board[to];
		  if (victim !== '') {
		    const attacker = state.board[from];
		    return 1e6 + (PIECE_BASE_VALUE[victim] ?? 0) * 8 - (PIECE_BASE_VALUE[attacker] ?? 0);
		  }
		  if (state.killers[ply * 2] === code) return 9e5;
		  if (state.killers[ply * 2 + 1] === code) return 8e5;
		  return state.history[from * 90 + to];
		}
		
		/** 就地按分值降序排。着法数 ≤ 60，插入排序足够且无额外分配。 */
		function searchOrderMoves(state, moves, ttMove, ply) {
		  const scored = moves.map((code) => ({ code, score: searchMoveScore(state, code, ttMove, ply) }));
		  scored.sort((a, b) => b.score - a.score);
		  for (let i = 0; i < moves.length; i += 1) moves[i] = scored[i].code;
		}
		
		/** alpha-beta 主体。返回走子方视角分值。 */
		function searchAlphaBeta(state, depth, alpha, beta, ply) {
		  state.nodes += 1;
		  if ((state.nodes & 1023) === 0 && Date.now() >= state.deadline) {
		    state.stopped = true;
		    return 0;
		  }
		  const side = state.side;
		  const moves = collectLegalMoves(state.board, side, []);
		  // 将死与困毙在中国象棋里都是判负，因此无需区分是否被将军。
		  if (moves.length === 0) return -SEARCH_MATE_SCORE + ply;
		  if (depth <= 0) return searchEvaluate(state, side);
		
		  const key = searchHash(state.board, side);
		  const ttMove = state.tt.get(key)?.move;
		  searchOrderMoves(state, moves, ttMove, ply);
		  let bestScore = -SEARCH_INFINITY;
		  let bestMove = moves[0];
		  let localAlpha = alpha;
		  for (const code of moves) {
		    const from = decodeMoveFrom(code);
		    const to = decodeMoveTo(code);
		    const captured = makeMoveOnBoard(state.board, from, to);
		    state.side = oppositeSide(side);
		    const score = -searchAlphaBeta(state, depth - 1, -beta, -localAlpha, ply + 1);
		    state.side = side;
		    unmakeMoveOnBoard(state.board, from, to, captured);
		    if (state.stopped) return bestScore > -SEARCH_INFINITY ? bestScore : 0;
		    if (score > bestScore) {
		      bestScore = score;
		      bestMove = code;
		    }
		    if (score > localAlpha) localAlpha = score;
		    if (localAlpha >= beta) {
		      if (captured === '') {
		        state.killers[ply * 2 + 1] = state.killers[ply * 2];
		        state.killers[ply * 2] = code;
		        state.history[from * 90 + to] += depth * depth;
		      }
		      break;
		    }
		  }
		  state.tt.set(key, { depth, score: bestScore, move: bestMove });
		  return bestScore;
		}
		
		/** 从置换表回溯出一条主变（最多 16 手）。 */
		function searchBuildPv(state, firstMove) {
		  const pv = [];
		  const board = state.board.slice();
		  let side = state.rootTurn;
		  let code = firstMove;
		  while (code !== undefined && pv.length < 16) {
		    const from = decodeMoveFrom(code);
		    const to = decodeMoveTo(code);
		    pv.push(squareToIccs(from) + squareToIccs(to));
		    makeMoveOnBoard(board, from, to);
		    side = oppositeSide(side);
		    code = state.tt.get(searchHash(board, side))?.move;
		  }
		  return pv;
		}
		
		/**
		 * 搜索最佳着法。`{ depth, timeMs }` 双限取先到者（§5.7）。
		 * 返回 `{ move, score, depth, nodes, pv }`；无合法着法时 `move` 为 null、`depth` 为 0。
		 */
		function searchBestMove(pos, opts = {}) {
		  const empty = { move: null, score: 0, depth: 0, nodes: 0, pv: [] };
		  if (!isValidPosition(pos)) return empty;
		  const maxDepth = Number.isInteger(opts.depth) && opts.depth > 0 ? opts.depth : SEARCH_DEFAULT_DEPTH;
		  const timeMs = Number.isFinite(opts.timeMs) && opts.timeMs > 0 ? opts.timeMs : SEARCH_DEFAULT_TIME_MS;
		  const seed = Number.isInteger(opts.seed) ? opts.seed : 1;
		  const roots = collectLegalMoves(pos.board, pos.turn, []);
		  if (roots.length === 0) return empty;
		
		  const state = {
		    board: pos.board.slice(),
		    view: { board: null, turn: pos.turn, halfmove: pos.halfmove, fullmove: pos.fullmove },
		    rootTurn: pos.turn,
		    side: pos.turn,
		    nodes: 0,
		    stopped: false,
		    deadline: Date.now() + timeMs,
		    tt: new Map(),
		    history: new Int32Array(90 * 90),
		    killers: new Int32Array(SEARCH_MAX_PLY * 2).fill(-1),
		  };
		  state.view.board = state.board;
		  const random = searchPrng(seed);
		
		  let bestMove = roots[0];
		  let bestScore = 0;
		  let bestPv = [];
		  let completed = 0;
		  for (let depth = 1; depth <= maxDepth; depth += 1) {
		    const ttMove = state.tt.get(searchHash(state.board, pos.turn))?.move;
		    searchOrderMoves(state, roots, ttMove, 0);
		    const scored = [];
		    let alpha = -SEARCH_INFINITY;
		    let aborted = false;
		    for (const code of roots) {
		      const from = decodeMoveFrom(code);
		      const to = decodeMoveTo(code);
		      const captured = makeMoveOnBoard(state.board, from, to);
		      state.side = oppositeSide(pos.turn);
		      const score = -searchAlphaBeta(state, depth - 1, -SEARCH_INFINITY, -alpha, 1);
		      state.side = pos.turn;
		      unmakeMoveOnBoard(state.board, from, to, captured);
		      if (state.stopped) {
		        aborted = true;
		        break;
		      }
		      scored.push({ code, score });
		      if (score > alpha) alpha = score;
		    }
		    if (aborted || scored.length === 0) break;
		    // 只在本轮**完整**结束时才更新结果，保证「时限截断」不会返回半轮着法。
		    const top = Math.max(...scored.map((item) => item.score));
		    const tied = scored.filter((item) => item.score === top);
		    const picked = tied.length > 1 ? tied[Math.floor(random() * tied.length)] : tied[0];
		    bestMove = picked.code;
		    bestScore = picked.score;
		    completed = depth;
		    state.tt.set(searchHash(state.board, pos.turn), { depth, score: top, move: bestMove });
		    bestPv = searchBuildPv(state, bestMove);
		    if (top >= SEARCH_MATE_SCORE - SEARCH_MAX_PLY) break;
		    if (Date.now() >= state.deadline) break;
		  }
		
		  return {
		    move: { from: decodeMoveFrom(bestMove), to: decodeMoveTo(bestMove) },
		    score: bestScore,
		    depth: completed,
		    nodes: state.nodes,
		    pv: bestPv,
		  };
		}
		
		/** 供 UI 复用：走子方视角分值的文字解释。 */
		function searchScoreTextZh(score) {
		  if (score >= SEARCH_MATE_SCORE - SEARCH_MAX_PLY) return '必胜（找到杀棋）';
		  if (score <= -SEARCH_MATE_SCORE + SEARCH_MAX_PLY) return '必败（对方有杀）';
		  if (score > 60) return '明显占优';
		  if (score > 20) return '稍占优';
		  if (score < -60) return '明显劣势';
		  if (score < -20) return '稍处下风';
		  return '均势';
		}
		
		/** 导出常量供测试钉基准（避免测试里出现魔法数字）。 */
		const SEARCH_LIMITS = { MATE_SCORE: SEARCH_MATE_SCORE, DEFAULT_DEPTH: SEARCH_DEFAULT_DEPTH, DEFAULT_TIME_MS: SEARCH_DEFAULT_TIME_MS };
		
			/* ==================== lib/ui/i18n.js ==================== */
		/**
		 * 浏览器半的文案字典（命名空间 `xiangqi`，§7.6）。
		 *
		 * 三条纪律：
		 *  1. key 是**扁平字符串**（点分只是惯例）；`{name}` 做插值；
		 *  2. `zh` 是键集真相，`en` 必须与它逐键对齐——`test/client/i18n.test.js` 断言两者
		 *     `Object.keys().sort()` 相等，漏键在这里就会红；
		 *  3. 不翻译的东西（盘上汉字、楚河汉界、中文记谱）**不进字典**——它们是棋本身，
		 *     不是 UI 文案；英文界面下用 `board.piece.*` 给出英文棋子名供 tooltip 与读屏使用。
		 *
		 * **凡是需要「红方/黑方」这类侧名的句子，都拆成 `.red` / `.black` 两个键**，而不是在
		 * 模板里插 `{side}`：纯函数层（`model.js`）拿不到 `t`，拼接本地化词会立刻退化成
		 * 「red被将军」。拆键让纯函数只需选后缀。
		 *
		 * 字典在 `apply(ctx)` 里用 `ctx.effect(() => ctx.locale.register(NS, { zh, en }))` 注册；
		 * 组件只有在该槽的 register options 里声明 `locale: 'xiangqi'` 才会拿到 `t`。
		 */
		
		/** locale 命名空间。注册与 `locale: NS` 必须用同一个常量。 */
		const LOCALE_NS = 'xiangqi';
		
		/** 棋子字符顺序（与引擎 FEN 字符一致）。 */
		const PIECE_CHARS = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
		
		const PIECE_ZH_RED = ['帅', '仕', '相', '马', '车', '炮', '兵'];
		const PIECE_ZH_BLACK = ['将', '士', '象', '马', '车', '炮', '卒'];
		const PIECE_EN = ['General', 'Advisor', 'Elephant', 'Horse', 'Chariot', 'Cannon', 'Soldier'];
		
		/** 己方视角的纵线名（下标 = 从己方底线起的层数）。 */
		const RANK_ZH = ['底线', '次底线', '宫顶线', '兵行线', '河沿', '河沿', '卒林线', '宫顶线', '次底线', '底线'];
		const RANK_EN = [
		  'own baseline',
		  'second rank',
		  'palace top',
		  'pawn rank',
		  'river bank',
		  'river bank',
		  'enemy pawn rank',
		  'palace top',
		  'second rank',
		  'own baseline',
		];
		
		const FILE_DIGIT_ZH = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
		
		/**
		 * 生成棋子名、文件号、纵线名三组键。
		 *
		 * 用生成器而不是把 100 多行手写进字典：键集对称由构造保证，人不会漏写英文。
		 * @returns {{ zh: Record<string,string>, en: Record<string,string> }}
		 */
		function generatedLabels() {
		  const zhLabels = {};
		  const enLabels = {};
		  for (let i = 0; i < PIECE_CHARS.length; i += 1) {
		    const ch = PIECE_CHARS[i];
		    zhLabels[`board.piece.r.${ch}`] = PIECE_ZH_RED[i];
		    zhLabels[`board.piece.b.${ch}`] = PIECE_ZH_BLACK[i];
		    enLabels[`board.piece.r.${ch}`] = PIECE_EN[i];
		    enLabels[`board.piece.b.${ch}`] = PIECE_EN[i];
		  }
		  for (let n = 1; n <= 9; n += 1) {
		    zhLabels[`board.file.${n}`] = FILE_DIGIT_ZH[n - 1];
		    enLabels[`board.file.${n}`] = String(n);
		  }
		  for (let r = 0; r < 10; r += 1) {
		    zhLabels[`board.rank.${r}`] = RANK_ZH[r];
		    enLabels[`board.rank.${r}`] = RANK_EN[r];
		  }
		  return { zh: zhLabels, en: enLabels };
		}
		
		const GENERATED = generatedLabels();
		
		/** 简体中文字典（键集真相）。 */
		const zh = {
		  'tab.title': '象棋',
		  'guide.title': '象棋对弈',
		  'guide.description': '与当前会话的模型下一盘中国象棋',
		  'panel.title': '象棋',
		
		  'header.you.red': '你执红方',
		  'header.you.black': '你执黑方',
		  'header.opponentModel': '对手：{model}',
		  'header.opponentLocal': '对手：本地引擎',
		  'header.turn.red': '红方走子',
		  'header.turn.black': '黑方走子',
		  'header.clock.red': '红方用时 {time}',
		  'header.clock.black': '黑方用时 {time}',
		  'header.usage': '本局 {tokens} tokens',
		  'header.ply': '第 {n} 手',
		
		  'status.connecting': '正在连接宿主…',
		  'status.ready': '可以走子了',
		  'status.aiThinking': 'AI 思考中…（{seconds}s）',
		  'status.aiFallback': '模型超时，已由本地引擎代走',
		  'status.aiFailed': '模型这一步没走出来',
		  'status.aiInvalid': '模型给了一步不合法的棋，已重试',
		  'status.check.red': '红方被将军',
		  'status.check.black': '黑方被将军',
		  'status.result.checkmate.red': '红方被将死，黑方胜',
		  'status.result.checkmate.black': '黑方被将死，红方胜',
		  'status.result.stalemate.red': '红方无着法，判负',
		  'status.result.stalemate.black': '黑方无着法，判负',
		  'status.result.resign.red': '红方认输',
		  'status.result.resign.black': '黑方认输',
		  'status.result.win.red': '红方胜',
		  'status.result.win.black': '黑方胜',
		  'status.result.draw': '和棋（{reason}）',
		  'status.result.finished': '本局已结束',
		  'status.rpcUnavailable': '无法连接宿主，棋盘暂为只读',
		  'status.rpcError': '与宿主通信失败：{message}',
		  'status.syncLost': '局面已刷新',
		  'status.pollTimeout': 'AI 仍未应招，可点「由本地引擎代走」',
		  'status.fallbackStarted': '正在由本地引擎代走…',
		  'status.hintShown': '已给出 {count} 条提示',
		  'status.copied': '棋谱已复制到剪贴板',
		  'status.copyFailed': '复制失败，请手动选择棋谱文本',
		  'status.newGame': '新对局已开始，你执红先行',
		  'status.moved.red': '红方 {zh}{suffix}',
		  'status.moved.black': '黑方 {zh}{suffix}',
		  'status.suffix.none': '',
		  'status.suffix.check': '，将军',
		  'status.suffix.checkmate': '，将死',
		  'status.invalid': '{reason}',
		  'status.readonly': '复盘状态下不能落子，点「回到当前」继续',
		  'status.notYourTurn': '现在不是你的回合',
		  'status.reviewing': '复盘：第 {n} 手',
		  'status.live': '已回到当前局面',
		  'status.unknownError': '出错了：{message}',
		
		  'action.new': '新对局',
		  'action.undo': '悔棋',
		  'action.hint': '提示',
		  'action.resign': '认输',
		  'action.copy': '复制棋谱',
		  'action.fallback': '由本地引擎代走',
		  'action.review': '复盘',
		  'action.live': '回到当前',
		  'action.openSidebar': '在右栏打开',
		  'action.openMain': '在主面板打开',
		  'action.retry': '重试',
		
		  'confirm.new': '当前对局尚未结束，确定要开始新对局吗？',
		  'confirm.resign': '确定要认输吗？',
		  'confirm.ok': '确定',
		  'confirm.cancel': '取消',
		
		  'moves.title': '着法',
		  'moves.empty': '还没有着法',
		  'moves.aria': '着法列表',
		  'moves.ply': '第 {n} 手',
		
		  'board.label': '中国象棋棋盘',
		  'board.cellAria': '{side} {piece}，{file}路，{rank}',
		  'board.empty': '空',
		  'board.emptyCell': '{file}路，{rank}',
		  'board.cursorHint': '方向键移动光标，回车选中或落子，Esc 取消',
		  'board.side.r': '红方',
		  'board.side.b': '黑方',
		  'board.hint': '提示着法',
		  'board.hintAria': '提示：{zh}',
		  'board.selected': '已选中 {piece}',
		  'board.cursor': '光标：{cell}',
		  'board.pieceTitle': '{name}',
		
		  'error.moveInvalid': '这一步走不了',
		  'error.notYourTurn': '现在不是你的回合',
		  'error.selfCheck': '这一步会送将',
		  'error.faceToFace': '将帅不能照面',
		  'error.outOfRules': '这一步不符合走子规则',
		  'error.finished': '本局已经结束',
		  'error.noGame': '还没有开始对局',
		  'error.busy': 'AI 正在思考，稍等一下',
		  'error.undoUnavailable': '现在不能悔棋',
		  'error.unknown': '未能完成这个操作',
		
		  ...GENERATED.zh,
		};
		
		/** 英文字典；键集必须与 `zh` 完全一致。 */
		const en = {
		  'tab.title': 'Chinese Chess',
		  'guide.title': 'Play Chinese Chess',
		  'guide.description': 'Play a game against this session\u2019s model',
		  'panel.title': 'Chinese Chess',
		
		  'header.you.red': 'You play Red',
		  'header.you.black': 'You play Black',
		  'header.opponentModel': 'Opponent: {model}',
		  'header.opponentLocal': 'Opponent: local engine',
		  'header.turn.red': 'Red to move',
		  'header.turn.black': 'Black to move',
		  'header.clock.red': 'Red {time}',
		  'header.clock.black': 'Black {time}',
		  'header.usage': '{tokens} tokens this game',
		  'header.ply': 'Move {n}',
		
		  'status.connecting': 'Connecting to the host\u2026',
		  'status.ready': 'Your move',
		  'status.aiThinking': 'AI is thinking\u2026 ({seconds}s)',
		  'status.aiFallback': 'The model timed out; the local engine moved instead',
		  'status.aiFailed': 'The model did not produce a move',
		  'status.aiInvalid': 'The model returned an illegal move; retrying',
		  'status.check.red': 'Red is in check',
		  'status.check.black': 'Black is in check',
		  'status.result.checkmate.red': 'Checkmate: Red is mated, Black wins',
		  'status.result.checkmate.black': 'Checkmate: Black is mated, Red wins',
		  'status.result.stalemate.red': 'Red has no legal move and loses',
		  'status.result.stalemate.black': 'Black has no legal move and loses',
		  'status.result.resign.red': 'Red resigned',
		  'status.result.resign.black': 'Black resigned',
		  'status.result.win.red': 'Red wins',
		  'status.result.win.black': 'Black wins',
		  'status.result.draw': 'Draw ({reason})',
		  'status.result.finished': 'This game has ended',
		  'status.rpcUnavailable': 'Cannot reach the host; the board is read-only',
		  'status.rpcError': 'Host call failed: {message}',
		  'status.syncLost': 'Position refreshed',
		  'status.pollTimeout': 'The AI still has not moved; you can use the local engine',
		  'status.fallbackStarted': 'Letting the local engine move\u2026',
		  'status.hintShown': '{count} hints shown',
		  'status.copied': 'Game record copied to the clipboard',
		  'status.copyFailed': 'Copy failed; select the record text manually',
		  'status.newGame': 'New game started \u2014 you play Red and move first',
		  'status.moved.red': 'Red {zh}{suffix}',
		  'status.moved.black': 'Black {zh}{suffix}',
		  'status.suffix.none': '',
		  'status.suffix.check': ', check',
		  'status.suffix.checkmate': ', checkmate',
		  'status.invalid': '{reason}',
		  'status.readonly': 'Reviewing \u2014 play is disabled; choose \u201cBack to live\u201d to continue',
		  'status.notYourTurn': 'It is not your turn',
		  'status.reviewing': 'Review: move {n}',
		  'status.live': 'Back to the live position',
		  'status.unknownError': 'Something went wrong: {message}',
		
		  'action.new': 'New game',
		  'action.undo': 'Undo',
		  'action.hint': 'Hint',
		  'action.resign': 'Resign',
		  'action.copy': 'Copy record',
		  'action.fallback': 'Move with local engine',
		  'action.review': 'Review',
		  'action.live': 'Back to live',
		  'action.openSidebar': 'Open in right panel',
		  'action.openMain': 'Open in main panel',
		  'action.retry': 'Retry',
		
		  'confirm.new': 'This game is still running. Start a new one?',
		  'confirm.resign': 'Resign this game?',
		  'confirm.ok': 'Confirm',
		  'confirm.cancel': 'Cancel',
		
		  'moves.title': 'Moves',
		  'moves.empty': 'No moves yet',
		  'moves.aria': 'Move list',
		  'moves.ply': 'Move {n}',
		
		  'board.label': 'Xiangqi board',
		  'board.cellAria': '{side} {piece}, file {file}, {rank}',
		  'board.empty': 'empty',
		  'board.emptyCell': 'file {file}, {rank}',
		  'board.cursorHint': 'Arrow keys move the cursor; Enter selects or plays; Esc cancels',
		  'board.side.r': 'Red',
		  'board.side.b': 'Black',
		  'board.hint': 'Suggested moves',
		  'board.hintAria': 'Hint: {zh}',
		  'board.selected': '{piece} selected',
		  'board.cursor': 'Cursor: {cell}',
		  'board.pieceTitle': '{name}',
		
		  'error.moveInvalid': 'That move is not allowed',
		  'error.notYourTurn': 'It is not your turn',
		  'error.selfCheck': 'That move would expose your general',
		  'error.faceToFace': 'The two generals may not face each other',
		  'error.outOfRules': 'That move breaks the rules for this piece',
		  'error.finished': 'This game is already over',
		  'error.noGame': 'No game has started yet',
		  'error.busy': 'The AI is thinking; please wait',
		  'error.undoUnavailable': 'Undo is unavailable right now',
		  'error.unknown': 'That action could not be completed',
		
		  ...GENERATED.en,
		};
		
		/** 两套字典，交给 `ctx.locale.register(NS, dicts)`。 */
		const dicts = { zh, en };
		
			/* ==================== lib/ui/model.js ==================== */
		/**
		 * 浏览器半的纯函数核心：投影 → 渲染数据、revision 栅栏、轮询退避、命中意图。
		 *
		 * 这一层是「渲染层 / 交互层解耦」（§7.2）的落点，也是**唯一**能脱离 React 单测的
		 * 部分（`test/client/*.test.js` 没有 DOM）：所有函数都是纯函数，不碰 ctx、不碰
		 * document、不订阅任何东西。组件只做两件事——调这些函数、把结果画出来。
		 *
		 * 座标换算沿用引擎 `lib/engine/coords.js`（§5.1 的唯一真相），因此这里不重复实现
		 * ICCS / 文件号 / 行列互换。
		 */
		
		
		/** 轮询退避：800 ms 起、×1.35、2 s 封顶（§7.5.3）。 */
		const POLL_BASE_MS = 800;
		const POLL_FACTOR = 1.35;
		const POLL_MAX_MS = 2000;
		/** 轮询最长 30 s，超过就停下并提示用户可点「由本地引擎代走」。 */
		const POLL_TIMEOUT_MS = 30000;
		/** 低于此宽度隐藏着法列表（§7.3）。 */
		const MIN_USABLE_WIDTH = 260;
		/** 棋盘几何：8u×9u 网格 + 每边 0.65u 外边距。 */
		const BOARD_SPAN_X = 8 + 1.3;
		const BOARD_SPAN_Y = 9 + 1.3;
		/** 还没量到容器尺寸时用的默认单位（能画出一张可读的盘，也不是 0）。 */
		const DEFAULT_UNIT = 30;
		/** 上限：宽屏主面板里棋盘不该无限放大。 */
		const MAX_UNIT = 62;
		/** 绝对下限：容器被压到极小也不能算出 0 或负数（否则 viewBox 退化）。 */
		const MIN_UNIT = 4;
		
		/** 投影是否是我们认识的那一段 JSON（有数字 revision 与 90 格 board）。 */
		function isProjection(value) {
		  return (
		    typeof value === 'object' &&
		    value !== null &&
		    Number.isFinite(value.revision) &&
		    Array.isArray(value.board) &&
		    value.board.length === 90
		  );
		}
		
		/**
		 * 从 RPC 返回值里取出投影。
		 *
		 * 宿主可能直接返回投影，也可能包一层（`{ snapshot }` / `{ projection }` / `{ state }`）。
		 * 这里三种都认，认不出来就返回 null，由调用方走降级分支——**不猜**。
		 * @param value - RPC 的 `value` 字段。
		 * @returns 投影，或 null。
		 */
		function unwrapProjection(value) {
		  if (isProjection(value)) return value;
		  if (typeof value !== 'object' || value === null) return null;
		  for (const key of ['snapshot', 'projection', 'state']) {
		    if (isProjection(value[key])) return value[key];
		  }
		  return null;
		}
		
		/**
		 * revision 栅栏：只接受更大的 revision，整体替换（§7.5.4 第 3 条）。
		 *
		 * 相同 revision 一律丢弃——重复响应不该让组件重渲染，否则打不开的竞态会表现成闪烁。
		 * @param current - 当前已接受的最小栅栏 `{ revision }`，或 null。
		 * @param incoming - 新到的投影。
		 * @returns `{ accepted, reason, projection }`。
		 */
		function acceptProjection(current, incoming) {
		  const fence = current === null || current === undefined ? null : current.revision;
		  if (!isProjection(incoming)) {
		    return { accepted: false, reason: 'malformed', projection: null };
		  }
		  if (fence === null || !Number.isFinite(fence)) {
		    return { accepted: true, reason: 'first', projection: incoming };
		  }
		  if (incoming.revision > fence) return { accepted: true, reason: 'newer', projection: incoming };
		  return {
		    accepted: false,
		    reason: incoming.revision === fence ? 'duplicate' : 'stale',
		    projection: null,
		  };
		}
		
		/** 棋子颜色（'r' | 'b' | null）。 */
		function pieceSide(piece) {
		  if (typeof piece !== 'string' || piece.length === 0) return null;
		  return piece === piece.toUpperCase() ? RED_SIDE : BLACK_SIDE;
		}
		
		/**
		 * 该局面里哪一方的将/帅被将军。
		 *
		 * `state === 'check'` 的含义是「**轮到走子的一方**被将军」，因此被将军方就是 `turn`；
		 * 宿主若显式给了 `status.side` 则以它为准。
		 * @param projection - 投影。
		 * @returns 'r' | 'b' | null。
		 */
		function checkSideOf(projection) {
		  if (projection === null || typeof projection !== 'object') return null;
		  const status = projection.status;
		  if (status === null || typeof status !== 'object') return null;
		  if (status.side === RED_SIDE || status.side === BLACK_SIDE) return status.side;
		  if (status.state !== 'check') return null;
		  return projection.turn === BLACK_SIDE ? BLACK_SIDE : RED_SIDE;
		}
		
		/**
		 * 宿主是否下发了可用的 `legalTargets` 表。
		 *
		 * 系统里只有一份规则真相（宿主），客户端副本只做乐观预校验。因此「表存在」就意味着
		 * **宿主说了算**；表整个缺失时才退回本地引擎兜底（双份规则的分歧风险只在降级路径上）。
		 * @param projection - 投影。
		 * @returns 布尔值。
		 */
		function hasHostTargets(projection) {
		  if (projection === null || typeof projection !== 'object') return false;
		  const table = projection.legalTargets;
		  if (table === null || typeof table !== 'object' || Array.isArray(table)) return false;
		  for (const key of Object.keys(table)) {
		    if (Array.isArray(table[key])) return true;
		  }
		  return false;
		}
		
		/**
		 * 某一格的可走点。
		 *
		 * 优先用宿主下发的 `legalTargets`；整表缺失时用 `fallbackTargets`（本地引擎算的），
		 * 两者都没有就返回空数组。
		 * @param projection - 投影。
		 * @param from - 起点格号。
		 * @param fallbackTargets - 本地引擎的兜底结果。
		 * @returns 排序后的目标格号数组。
		 */
		function legalTargetsOf(projection, from, fallbackTargets) {
		  if (hasHostTargets(projection)) {
		    const host = legalTargetsFor(projection, from);
		    if (host.length > 0) return host;
		    // 宿主有表但这格没有条目：可能是「这枚子无着法」，也可能是投影刚被裁过。
		    // 只有当宿主对**整个** from 都没给过条目时才接受空结果。
		    const table = projection.legalTargets;
		    if (Object.prototype.hasOwnProperty.call(table, String(from))) return [];
		  }
		  if (!Array.isArray(fallbackTargets)) return [];
		  return fallbackTargets.filter((n) => Number.isInteger(n) && n >= 0 && n < 90).sort((a, b) => a - b);
		}
		
		/**
		 * 某一格的可走点（宿主下发的 `legalTargets`，§7.5.4 第 1 条）。
		 * @param projection - 投影。
		 * @param from - 起点格号。
		 * @returns 排序后的目标格号数组。
		 */
		function legalTargetsFor(projection, from) {
		  if (projection === null || typeof projection !== 'object') return [];
		  if (from === null || from === undefined || from < 0) return [];
		  const table = projection.legalTargets;
		  if (table === null || typeof table !== 'object') return [];
		  const raw = table[String(from)];
		  if (!Array.isArray(raw)) return [];
		  const unique = new Set();
		  for (const value of raw) {
		    if (Number.isInteger(value) && value >= 0 && value < 90) unique.add(value);
		  }
		  return [...unique].sort((a, b) => a - b);
		}
		
		/**
		 * 一格的读屏描述（§7.7：「红方 车，九路，底线」）。
		 *
		 * 只产出**结构化**描述，不做翻译：`{ side, piece, fileNumber, rankIndex }`。
		 * 组件再按 `board.cellAria` 与 `board.piece.*` / `board.rank.*` 组装成本地化文本。
		 *
		 * 空格没有「自己一方」，但读屏仍要能报出位置，因此**空格以红方视角**（也就是默认
		 * 画法）给出文件号与纵线名：`board.file.*` / `board.rank.*` 的下标都是按这个口径
		 * 生成的，不能出现 `board.file.0` 这种字典里没有的键。
		 * @param index - 格号 0..89。
		 * @param piece - 该格棋子字符（空串表示空）。
		 * @returns 描述对象；格号非法时返回 null。
		 */
		function cellDescriptor(index, piece) {
		  const row = idxToRow(index);
		  const col = idxToCol(index);
		  if (row < 0 || col < 0) return null;
		  const side = pieceSide(piece);
		  const view = side === BLACK_SIDE ? BLACK_SIDE : RED_SIDE;
		  // 纵线名以「该子自己一方」为参照：红方底线是 row 9，黑方底线是 row 0。
		  const rankIndex = view === BLACK_SIDE ? row : 9 - row;
		  return {
		    index,
		    row,
		    col,
		    piece: typeof piece === 'string' ? piece : '',
		    side,
		    fileNumber: colToFileNumber(col, view),
		    rankIndex,
		  };
		}
		
		/**
		 * 读屏标签的**键组合**（不含翻译）。
		 *
		 * 纯函数层不认识 locale，也不该拼中文；它只回答「用哪个模板、每个占位符取哪个键」，
		 * 由组件用 `t` 逐项解析。这样 `aria-label` 的两套语言与字典键集天然对齐。
		 * @param index - 格号。
		 * @param piece - 该格棋子字符。
		 * @returns `{ template, params }` 或 null（格号非法）。
		 */
		function cellLabelKeys(index, piece) {
		  const described = cellDescriptor(index, piece);
		  if (described === null) return null;
		  const file = `board.file.${described.fileNumber}`;
		  const rank = `board.rank.${described.rankIndex}`;
		  if (described.piece === '') {
		    return { template: 'board.emptyCell', params: { file, rank } };
		  }
		  return {
		    template: 'board.cellAria',
		    params: {
		      side: `board.side.${described.side}`,
		      piece: `board.piece.${described.side}.${described.piece}`,
		      file,
		      rank,
		    },
		  };
		}
		
		/**
		 * 两个棋盘是否逐格相同（复盘可信度自检用）。
		 *
		 * 复盘靠客户端内联的引擎**重放**投影里的 ICCS 历史；投影不带每一手的 FEN，也不带
		 * `initialFen`，所以起点按标准初始局面假定。标准初始局面重放出来的最后一手必须与
		 * 宿主下发的棋盘完全一致——不一致说明这局不是从标准局面开始的，此时宁可关掉复盘，
		 * 也不能给用户看一个错的局面。
		 * @param a - 棋盘数组。
		 * @param b - 棋盘数组。
		 * @returns 布尔值。
		 */
		function sameBoard(a, b) {
		  if (!Array.isArray(a) || !Array.isArray(b)) return false;
		  if (a.length !== 90 || b.length !== 90) return false;
		  for (let i = 0; i < 90; i += 1) {
		    const left = typeof a[i] === 'string' ? a[i] : '';
		    const right = typeof b[i] === 'string' ? b[i] : '';
		    if (left !== right) return false;
		  }
		  return true;
		}
		
		/**
		 * 某一块棋盘上某方的将/帅格号（画将军脉冲环用）。
		 * @param board - 棋盘数组。
		 * @param side - 'r' | 'b' | null。
		 * @returns 格号，找不到返回 null。
		 */
		function kingIndex(board, side) {
		  if (!Array.isArray(board) || (side !== RED_SIDE && side !== BLACK_SIDE)) return null;
		  const index = board.indexOf(side === RED_SIDE ? 'K' : 'k');
		  return index < 0 ? null : index;
		}
		
		const EMPTY_BOARD = Object.freeze(new Array(90).fill(''));/** 把任意长度的 board 补齐/截断成 90 格（宿主的投影理论上是 90，防御性处理）。 */
		function normalizeBoard(board) {
		  if (!Array.isArray(board)) return EMPTY_BOARD.slice();
		  const out = new Array(90);
		  for (let i = 0; i < 90; i += 1) {
		    const cell = board[i];
		    out[i] = typeof cell === 'string' ? cell : '';
		  }
		  return out;
		}
		
		/**
		 * 把 ICCS 着法串（如 `h2e2`）折成 `{ from, to }`。
		 * @param iccs - 4 字符串。
		 * @returns `{ from, to }`，非法时返回 null。
		 */
		function iccsSquares(iccs) {
		  if (typeof iccs !== 'string' || iccs.length !== 4) return null;
		  const from = iccsToSquare(iccs.slice(0, 2));
		  const to = iccsToSquare(iccs.slice(2, 4));
		  if (from < 0 || to < 0) return null;
		  return { from, to };
		}
		
		/** 把 lastMove（可能是 `{ from, to }`、ICCS 串或 null）折成 `{ from, to }`。 */
		function normalizeLastMove(raw) {
		  if (raw === null || raw === undefined) return null;
		  if (typeof raw === 'string') return iccsSquares(raw);
		  if (typeof raw !== 'object') return null;
		  if (Number.isInteger(raw.from) && Number.isInteger(raw.to)) {
		    return { from: raw.from, to: raw.to };
		  }
		  return iccsSquares(raw.iccs);
		}
		
		/**
		 * 归一化宿主下发的提示着法。
		 *
		 * 接受 `{ candidates: [...] }`、数组、或 `{ hints: [...] }`；每条至少要有 ICCS 或
		 * 显式的 from/to。折不出坐标的条目直接丢弃——画不出箭头的东西不该进渲染层。
		 * @param value - RPC 返回值或投影里的 hints。
		 * @returns `[{ from, to, zh, score, rank }]`，最多 3 条（§7.4 提示显示 3 条）。
		 */
		function normalizeHints(value) {
		  const list = Array.isArray(value)
		    ? value
		    : Array.isArray(value && value.candidates)
		      ? value.candidates
		      : Array.isArray(value && value.hints)
		        ? value.hints
		        : [];
		  const out = [];
		  for (const item of list) {
		    if (item === null || typeof item !== 'object') continue;
		    const squares =
		      Number.isInteger(item.from) && Number.isInteger(item.to)
		        ? { from: item.from, to: item.to }
		        : iccsSquares(item.iccs);
		    if (squares === null) continue;
		    out.push({
		      from: squares.from,
		      to: squares.to,
		      zh: typeof item.zh === 'string' ? item.zh : '',
		      score: Number.isFinite(item.score) ? item.score : null,
		      iccs: typeof item.iccs === 'string' ? item.iccs : '',
		      rank: out.length,
		    });
		    if (out.length === 3) break;
		  }
		  return out;
		}
		
		/**
		 * 投影 + 本地 UI 状态 → 渲染层直接消费的数据（§7.2：只有可渲染的派生数据）。
		 * @param projection - 宿主投影。
		 * @param ui - 本地 UI 状态：`{ selected, cursor, hints, reviewPly, orientation }`。
		 * @returns 渲染模型。
		 */
		function deriveModel(projection, ui) {
		  const state = ui === undefined || ui === null ? {} : ui;
		  const p = projection === null || typeof projection !== 'object' ? {} : projection;
		  const board = normalizeBoard(p.board);
		  const turn = p.turn === BLACK_SIDE ? BLACK_SIDE : RED_SIDE;
		  const hero = p.hero === BLACK_SIDE ? BLACK_SIDE : RED_SIDE;
		  const phase = p.phase === 'playing' || p.phase === 'finished' ? p.phase : 'idle';
		  const pending = p.pending === 'ai-thinking' || p.pending === 'ai-failed' ? p.pending : null;
		  const finished = phase === 'finished';
		  const reviewPly = Number.isInteger(state.reviewPly) && state.reviewPly >= 0 ? state.reviewPly : null;
		  const reviewing = reviewPly !== null;
		  const selected = Number.isInteger(state.selected) && state.selected >= 0 && state.selected < 90 ? state.selected : null;
		  const canSelect = !reviewing && !finished && turn === hero;
		  const legalTargets = canSelect && selected !== null ? legalTargetsOf(p, selected, state.fallbackTargets) : [];
		  return {
		    revision: Number.isFinite(p.revision) ? p.revision : 0,
		    board,
		    turn,
		    hero,
		    phase,
		    pending,
		    finished,
		    reviewPly,
		    reviewing,
		    selected,
		    legalTargets,
		    hostTargets: hasHostTargets(p),
		    captureTargets: legalTargets.filter((index) => board[index] !== ''),
		    cursor: Number.isInteger(state.cursor) && state.cursor >= 0 && state.cursor < 90 ? state.cursor : null,
		    orientation: state.orientation === BLACK_SIDE ? BLACK_SIDE : RED_SIDE,
		    lastMove: normalizeLastMove(p.lastMove),
		    hints: reviewing ? [] : normalizeHints(state.hints),
		    checkSide: checkSideOf(p),
		    interactive: canSelect && pending !== 'ai-thinking',
		    fen: typeof p.fen === 'string' ? p.fen : '',
		    history: Array.isArray(p.history) ? p.history : [],
		    clock: p.clock !== null && typeof p.clock === 'object' ? p.clock : null,
		    usage: p.usage !== null && typeof p.usage === 'object' ? p.usage : null,
		    opponent: p.opponent !== null && typeof p.opponent === 'object' ? p.opponent : null,
		  };
		}
		
		/**
		 * 一次点击产出什么「意图」（§7.4 的十二条都归约到这里）。
		 *
		 * 交互层只上报意图，合法性判定仍以宿主为准（§7.2 第 2 条）。返回的 `code` 是
		 * **机器码**，由组件查字典成本地化文案，这一层不认识 locale。
		 * @param model - `deriveModel` 的结果。
		 * @param from - 当前选中的格号（无选中为 null）。
		 * @param to - 被点的格号。
		 * @returns `{ kind, index?, from?, to?, code? }`。
		 */
		function resolveIntent(model, from, to) {
		  if (model === null || model === undefined) return { kind: 'noop' };
		  if (!Number.isInteger(to) || to < 0 || to >= 90) return { kind: 'noop' };
		  const piece = model.board[to];
		  const own = piece !== '' && pieceSide(piece) === model.turn;
		  const selectable = !model.reviewing && !model.finished && model.turn === model.hero && own;
		
		  if (from === null || from === undefined || !Number.isInteger(from)) {
		    if (selectable) return { kind: 'select', index: to };
		    if (piece !== '') return { kind: 'inspect', index: to };
		    return { kind: 'noop' };
		  }
		  if (to === from) return { kind: 'deselect' };
		  if (selectable) return { kind: 'select', index: to };
		  if (model.reviewing) return { kind: 'reject', from, to, code: 'game.review' };
		  if (model.finished) return { kind: 'reject', from, to, code: 'game.finished' };
		  if (model.turn !== model.hero) return { kind: 'reject', from, to, code: 'move.not-your-turn' };
		  if (model.legalTargets.indexOf(to) >= 0) return { kind: 'move', from, to };
		  return { kind: 'reject', from, to, code: 'move.invalid' };
		}
		
		/**
		 * 键盘光标的移动（§7.4 键盘走子）。
		 *
		 * 参数是**屏幕方向**的位移（ArrowUp 就是屏幕向上），翻盘（`orientation === 'b'`）时
		 * 反向映射回内部行列——否则黑方视角下方向键会上下颠倒。
		 * @param index - 当前光标格号。
		 * @param dVisualRow - 屏幕行位移（上为负）。
		 * @param dVisualCol - 屏幕列位移（左为负）。
		 * @param orientation - 'r'（红方在下，默认）或 'b'。
		 * @returns 新格号；移出棋盘返回 null。
		 */
		function stepCursor(index, dVisualRow, dVisualCol, orientation) {
		  const row = idxToRow(index);
		  const col = idxToCol(index);
		  if (row < 0 || col < 0) return null;
		  const flip = orientation === BLACK_SIDE;
		  const nextRow = row + (flip ? -dVisualRow : dVisualRow);
		  const nextCol = col + (flip ? -dVisualCol : dVisualCol);
		  if (!isOnBoard(nextRow, nextCol)) return null;
		  return nextRow * 9 + nextCol;
		}
		
		/**
		 * 棋盘几何（§7.3）：`u = min((W - 2·pad)/8, (H - 2·pad)/9)`，等价于
		 * `u = min(W / 9.3, H / 10.3)`（pad = 0.65u 已折进分母）。
		 * @param width - 容器宽度（px）。
		 * @param height - 容器高度（px）；未知时传 0。
		 * @returns `{ u, viewW, viewH, showMoveList, showToolbarLabels }`。
		 */
		function computeGeometry(width, height) {
		  const w = Number.isFinite(width) && width > 0 ? width : 0;
		  const h = Number.isFinite(height) && height > 0 ? height : 0;
		  const byWidth = w > 0 ? w / BOARD_SPAN_X : Number.POSITIVE_INFINITY;
		  const byHeight = h > 0 ? h / BOARD_SPAN_Y : Number.POSITIVE_INFINITY;
		  let u = Math.min(byWidth, byHeight);
		  // 一个尺寸都没量到时给默认值；量到了就必须严格按可用空间缩放（不出现横向滚动）。
		  if (!Number.isFinite(u) || u <= 0) u = DEFAULT_UNIT;
		  u = Math.max(MIN_UNIT, Math.min(MAX_UNIT, u));
		  return {
		    u,
		    viewW: u * BOARD_SPAN_X,
		    viewH: u * BOARD_SPAN_Y,
		    showMoveList: w === 0 || w >= MIN_USABLE_WIDTH,
		    showToolbarLabels: w === 0 || w >= 320,
		  };
		}
		
		/**
		 * 下一次轮询的间隔（指数退避，2 s 封顶）。
		 * @param attempt - 已经轮询过的次数，从 0 起。
		 * @param opts - `{ baseMs, factor, maxMs }` 覆盖默认值（测试用）。
		 * @returns 毫秒数。
		 */
		function nextPollDelay(attempt, opts) {
		  const o = opts === undefined || opts === null ? {} : opts;
		  const base = Number.isFinite(o.baseMs) ? o.baseMs : POLL_BASE_MS;
		  const factor = Number.isFinite(o.factor) ? o.factor : POLL_FACTOR;
		  const max = Number.isFinite(o.maxMs) ? o.maxMs : POLL_MAX_MS;
		  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
		  return Math.min(max, Math.round(base * Math.pow(factor, n)));
		}
		
		/**
		 * 是否需要轮询：只有 `pending === 'ai-thinking'` 且面板可见时才轮（§7.5.3）。
		 * @param projection - 投影。
		 * @param visible - `tab.visible`（主面板恒为 true）。
		 * @returns 布尔值。
		 */
		function shouldPoll(projection, visible) {
		  if (visible !== true) return false;
		  return projection !== null && typeof projection === 'object' && projection.pending === 'ai-thinking';
		}
		
		/** 轮询是否已经超时（超过就要停下并提示，而不是无限轮）。 */
		function pollExpired(elapsedMs, timeoutMs) {
		  const limit = Number.isFinite(timeoutMs) ? timeoutMs : POLL_TIMEOUT_MS;
		  return Number.isFinite(elapsedMs) && elapsedMs >= limit;
		}
		
		const MESSAGE_KEYS = {
		  'ai.fallback.local': 'status.aiFallback',
		  'ai.fallback': 'status.aiFallback',
		  'ai.timeout': 'status.aiFallback',
		  'ai.failed': 'status.aiFailed',
		  'ai.invalid': 'status.aiInvalid',
		  'ai.illegal': 'status.aiInvalid',
		  'rpc.unavailable': 'status.rpcUnavailable',
		  'connection.lost': 'status.syncLost',
		};
		
		const ERROR_KEYS = {
		  'move.invalid': 'error.moveInvalid',
		  'move.illegal': 'error.moveInvalid',
		  'move.not-your-turn': 'error.notYourTurn',
		  'move.self-check': 'error.selfCheck',
		  'move.leaves-king-in-check': 'error.selfCheck',
		  'move.face-to-face': 'error.faceToFace',
		  'move.out-of-rules': 'error.outOfRules',
		  'game.finished': 'error.finished',
		  'game.not-started': 'error.noGame',
		  'game.busy': 'error.busy',
		  'game.review': 'status.readonly',
		  'undo.unavailable': 'error.undoUnavailable',
		};
		
		/** 机器码 → i18n 键；未登记的码返回 null（**不显示原始码**）。 */
		function messageKeyOf(code) {
		  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(MESSAGE_KEYS, code)
		    ? MESSAGE_KEYS[code]
		    : null;
		}
		
		/** 错误码 → i18n 键；未登记的码返回 null。 */
		function errorKeyOf(code) {
		  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_KEYS, code)) {
		    return ERROR_KEYS[code];
		  }
		  return null;
		}
		
		/** 侧名后缀：字典里凡涉及侧名的句子都拆成 `.red` / `.black`。 */
		function sideSuffix(side) {
		  return side === BLACK_SIDE ? 'black' : 'red';
		}
		
		/**
		 * 本局的结局（用于状态条与读屏播报）。
		 *
		 * 结局句子的侧名**不插值**，而是选键：`status.result.checkmate.red` 读作
		 * 「红方被将死，黑方胜」。纯函数层拿不到 `t`，插值会拼出「red被将死」。
		 * @param projection - 投影。
		 * @returns `{ key, params, tone, assertive }` 或 null。
		 */
		function gameOutcome(projection) {
		  if (projection === null || typeof projection !== 'object') return null;
		  if (projection.phase !== 'finished') return null;
		  const status = projection.status !== null && typeof projection.status === 'object' ? projection.status : {};
		  const winner = status.winner === RED_SIDE || status.winner === BLACK_SIDE ? status.winner : null;
		  const loser = winner === null ? null : winner === RED_SIDE ? BLACK_SIDE : RED_SIDE;
		  if (status.state === 'checkmate') {
		    return { key: `status.result.checkmate.${sideSuffix(loser)}`, params: {}, tone: 'success', assertive: true };
		  }
		  if (status.state === 'stalemate') {
		    const side = loser === null ? projection.turn : loser;
		    return { key: `status.result.stalemate.${sideSuffix(side)}`, params: {}, tone: 'success', assertive: true };
		  }
		  if (typeof status.state === 'string' && status.state.startsWith('draw')) {
		    return {
		      key: 'status.result.draw',
		      params: { reason: typeof status.reasonZh === 'string' ? status.reasonZh : status.state },
		      tone: 'info',
		      assertive: true,
		    };
		  }
		  if (status.state === 'resign') {
		    return { key: `status.result.resign.${sideSuffix(loser)}`, params: {}, tone: 'success', assertive: true };
		  }
		  if (winner !== null) {
		    return { key: `status.result.win.${sideSuffix(winner)}`, params: {}, tone: 'success', assertive: true };
		  }
		  return { key: 'status.result.finished', params: {}, tone: 'info', assertive: true };
		}
		
		/**
		 * 状态条内容（本面板唯一的消息出口，§7.4）。
		 *
		 * 优先级：离线 → 错误 → 宿主 message → 结局 → 将军 → AI 思考 → 就绪。
		 * 返回的 `key` 由组件用 `t` 渲染；`params` 已按字典里的 `{name}` 命名好。
		 * @param projection - 投影。
		 * @param ui - `{ offline, elapsedMs, notice }`；`notice` 是本地即时消息（如非法原因）。
		 * @returns `{ key, params, tone, assertive }`。
		 */
		function statusLine(projection, ui) {
		  const state = ui === undefined || ui === null ? {} : ui;
		  if (state.notice && typeof state.notice.key === 'string') {
		    return {
		      key: state.notice.key,
		      params: state.notice.params === undefined ? {} : state.notice.params,
		      tone: state.notice.tone === undefined ? 'warn' : state.notice.tone,
		      assertive: false,
		    };
		  }
		  if (state.offline === true) {
		    return { key: 'status.rpcUnavailable', params: {}, tone: 'error', assertive: false };
		  }
		  const p = projection === null || typeof projection !== 'object' ? null : projection;
		  if (p === null) return { key: 'status.connecting', params: {}, tone: 'info', assertive: false };
		  if (p.error !== null && typeof p.error === 'object') {
		    const key = errorKeyOf(p.error.code);
		    if (key !== null) {
		      return { key, params: {}, tone: 'error', assertive: false };
		    }
		    if (typeof p.error.reasonZh === 'string' && p.error.reasonZh !== '') {
		      return { key: 'status.invalid', params: { reason: p.error.reasonZh }, tone: 'error', assertive: false };
		    }
		  }
		  if (p.message !== null && typeof p.message === 'object') {
		    const key = messageKeyOf(p.message.code);
		    if (key !== null) {
		      return {
		        key,
		        params: {},
		        tone: p.message.tone === 'error' ? 'error' : 'warn',
		        assertive: false,
		      };
		    }
		  }
		  const outcome = gameOutcome(p);
		  if (outcome !== null) return outcome;
		  const checkSide = checkSideOf(p);
		  if (checkSide !== null) {
		    return { key: `status.check.${sideSuffix(checkSide)}`, params: {}, tone: 'warn', assertive: false };
		  }
		  if (p.pending === 'ai-thinking') {
		    return {
		      key: 'status.aiThinking',
		      params: { seconds: Math.max(0, Math.round((Number.isFinite(state.elapsedMs) ? state.elapsedMs : 0) / 1000)) },
		      tone: 'info',
		      assertive: false,
		    };
		  }
		  if (p.pending === 'ai-failed') {
		    return { key: 'status.aiFailed', params: {}, tone: 'warn', assertive: false };
		  }
		  return { key: 'status.ready', params: {}, tone: 'info', assertive: false };
		}
		
		/**
		 * 着法列表的行模型：每行两手（红、黑）。
		 * @param history - 投影的 history（`[{ zh, iccs, captured }]`）。
		 * @returns `[{ no, red, black }]`，其中每手是 `{ ply, index, zh, iccs }` 或 null。
		 */
		function moveRows(history) {
		  const list = Array.isArray(history) ? history : [];
		  const rows = [];
		  for (let i = 0; i < list.length; i += 1) {
		    const item = list[i] !== null && typeof list[i] === 'object' ? list[i] : {};
		    const ply = {
		      ply: i + 1,
		      index: i,
		      zh: typeof item.zh === 'string' ? item.zh : '',
		      iccs: typeof item.iccs === 'string' ? item.iccs : '',
		      captured: typeof item.captured === 'string' ? item.captured : '',
		    };
		    const rowIndex = Math.floor(i / 2);
		    if (rows[rowIndex] === undefined) rows[rowIndex] = { no: rowIndex + 1, red: null, black: null };
		    if (i % 2 === 0) rows[rowIndex].red = ply;
		    else rows[rowIndex].black = ply;
		  }
		  return rows;
		}
		
		/**
		 * 毫秒 → `m:ss`（计时节拍用等宽字体 + tabular-nums，§7.3）。
		 * @param ms - 毫秒。
		 * @returns 文本；非法输入返回 `--:--`。
		 */
		function formatClock(ms) {
		  if (!Number.isFinite(ms) || ms < 0) return '--:--';
		  const total = Math.floor(ms / 1000);
		  const minutes = Math.floor(total / 60);
		  const seconds = total % 60;
		  return `${minutes}:${String(seconds).padStart(2, '0')}`;
		}
		
		/**
		 * 引擎评分 → 一行可读文本（§7.4 提示要显示「记谱 + 评分」）。
		 *
		 * 引擎的分数单位是「厘兵」（100 = 一个兵），所以除以 100 显示成兵值，并显式带符号：
		 * 没有符号的 `1.2` 会被读成「红方好 1.2」还是「黑方好 1.2」全凭猜。
		 * @param score - 引擎分数（厘兵）。
		 * @returns 形如 `+1.2` / `-0.5` / `0.0`；非法输入返回空串。
		 */
		function formatScore(score) {
		  if (!Number.isFinite(score)) return '';
		  const pawns = score / 100;
		  const text = Math.abs(pawns).toFixed(1);
		  if (pawns > 0.049) return `+${text}`;
		  if (pawns < -0.049) return `-${text}`;
		  return '0.0';
		}
		
		/**
		 * 复制棋谱用的文本（FR22：中文记谱逐行 + FEN）。
		 * @param projection - 投影。
		 * @returns 文本。
		 */
		function recordText(projection) {
		  const p = projection === null || typeof projection !== 'object' ? {} : projection;
		  const rows = moveRows(p.history);
		  const lines = [];
		  const startFen = typeof p.initialFen === 'string' ? p.initialFen : '';
		  if (startFen !== '') lines.push(`# 初始局面 ${startFen}`);
		  for (const row of rows) {
		    const red = row.red === null ? '' : row.red.zh;
		    const black = row.black === null ? '' : row.black.zh;
		    lines.push(`${row.no}. ${red}${black === '' ? '' : `  ${black}`}`);
		  }
		  if (typeof p.fen === 'string' && p.fen !== '') lines.push(`# 当前局面 ${p.fen}`);
		  return lines.join('\n');
		}
		
			/* ==================== lib/ui/styles.js ==================== */
		/**
		 * 面板样式（§7.3）。
		 *
		 * 三条硬约束：
		 *  1. **配色全部走主题令牌**，不写 `@media (prefers-color-scheme: dark)`——那会忽略用户
		 *     的 DSH 主题偏好。木色棋盘面走 `ctx.theme.overrideTokens` 注册的
		 *     `--xiangqi-*` 令牌，并**回落到 alias 令牌**（令牌被改名时只是观感退化）；
		 *  2. 类名手工加 `xq-` 前缀（不与宿主页面撞车）；
		 *  3. 动效全部 ≤200 ms，并且只在 `prefers-reduced-motion: no-preference` 下启用；
		 *     reduce 时改为静态标记（不位移、不脉冲）。
		 *
		 * 注入方式用 §4.5 推荐的「组件内渲染 `<style>`」：随组件卸载自动移除，不会残留。
		 */
		
		/** 稳定 id：同一份 CSS 只应有一个标签，便于排查重复注入。 */
		const STYLE_ID = 'xq-panel';
		
		/** 面板 CSS。 */
		const CSS = `
		.xq-root{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family);font-size:13px;line-height:20px}
		.xq-inMain{padding-top:var(--dsh-frame-top-clearance,0px)}
		html[data-platform=darwin] .xq-inMain{padding-left:var(--dsh-frame-leading-clearance,0px)}
		.xq-header{display:flex;flex-direction:column;gap:6px;padding:10px 12px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
		.xq-headerRow{display:flex;align-items:center;gap:8px;min-width:0}
		.xq-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap}
		.xq-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
		.xq-meta b{font-weight:500;color:var(--dsw-alias-label-secondary)}
		.xq-clock{font-family:var(--ds-font-family-code);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
		.xq-headerSpacer{flex:1;min-width:0}
		.xq-boardArea{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:8px 10px;overflow:hidden}
		.xq-board{display:block;touch-action:none;border-radius:var(--dsw-radius-lg);outline:none}
		.xq-board:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
		.xq-boardFace{fill:var(--xiangqi-board-face,var(--dsw-alias-bg-layer-1));stroke:var(--dsw-alias-border-l4)}
		.xq-riverBand{fill:var(--xiangqi-river,var(--dsw-alias-bg-layer-2))}
		.xq-grid{stroke:var(--xiangqi-grid,var(--dsw-alias-border-l3));stroke-linecap:square}
		.xq-border{stroke:var(--xiangqi-grid,var(--dsw-alias-border-l4));fill:none}
		.xq-riverText{fill:var(--xiangqi-grid,var(--dsw-alias-label-caption));letter-spacing:.28em;opacity:.75;user-select:none}
		.xq-pieceFace{fill:var(--xiangqi-piece-face,var(--dsw-alias-bg-layer-1));stroke:var(--dsw-alias-border-l4)}
		.xq-pieceInk{font-family:var(--dsw-font-family);font-weight:600;text-anchor:middle;dominant-baseline:central;user-select:none}
		/* 红方字色：92% 的 state-error-primary 掺 8% 的 label-primary。
		   为什么要掺：亮色下红-600(#ec1313) 画在白底盘上只有 4.50:1，正好卡在 WCAG 的 4.5 门槛
		   下沿；掺一点该主题的「对立极」（亮色=近黑、暗色=近白）后两个方案都在 5:1 以上，
		   而且两个输入都是主题令牌，仍然随主题自适应（不是自持常量）。 */
		.xq-pieceRed{fill:color-mix(in srgb, var(--dsw-alias-state-error-primary) 92%, var(--dsw-alias-label-primary))}
		.xq-pieceBlack{fill:var(--dsw-alias-label-primary)}
		.xq-pieceRing{fill:none;opacity:.5}
		.xq-selectRing{fill:none;stroke:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
		.xq-cursorBox{fill:none;stroke:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));stroke-dasharray:3 2}
		.xq-lastLine{stroke:var(--dsw-alias-interactive-bg-hover-accent);stroke-linecap:round}
		.xq-lastDot{fill:var(--dsw-alias-interactive-bg-hover-accent)}
		.xq-targetDot{fill:var(--dsw-alias-state-business-tertiary);stroke:var(--dsw-alias-state-business-primary);stroke-width:.6;opacity:.9}
		.xq-targetRing{fill:none;stroke:var(--dsw-alias-state-business-primary);opacity:.85}
		.xq-checkRing{fill:none;stroke:var(--dsw-alias-state-error-secondary)}
		.xq-hintLine{stroke:var(--dsw-alias-state-business-primary);fill:none;stroke-linecap:round}
		.xq-hit{fill:transparent}
		.xq-hoverCell{fill:var(--dsw-alias-interactive-bg-hover);pointer-events:none}
		.xq-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
		.xq-status{display:flex;align-items:center;gap:6px;min-height:30px;margin:0 10px 8px;padding:5px 9px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
		.xq-statusText{min-width:0;flex:1;overflow-wrap:anywhere}
		.xq-status-info{border-color:var(--dsw-alias-border-l2)}
		.xq-status-warn{color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-secondary)}
		.xq-status-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary)}
		.xq-status-success{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-secondary)}
		.xq-dot{flex:none;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-label-caption)}
		.xq-dot-info{background:var(--dsw-alias-state-business-primary)}
		.xq-dot-warn{background:var(--dsw-alias-state-warn-primary)}
		.xq-dot-error{background:var(--dsw-alias-state-error-primary)}
		.xq-dot-success{background:var(--dsw-alias-state-success-primary)}
		.xq-dot-thinking{width:7px;height:7px}
		.xq-hints{display:flex;flex-wrap:wrap;gap:4px 10px;padding:0 10px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
		.xq-hintItem{display:inline-flex;align-items:baseline;gap:4px;min-width:0;padding:2px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}
		.xq-hintRank{font-family:var(--ds-font-family-code);font-variant-numeric:tabular-nums;opacity:.75}
		.xq-hintScore{font-family:var(--ds-font-family-code);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
		.xq-toolbar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:0 10px 10px}
		.xq-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:1;cursor:pointer}
		.xq-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
		.xq-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
		.xq-btn:disabled{opacity:.45;cursor:default}
		.xq-btnPrimary{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
		.xq-btnDanger{border-color:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}
		.xq-moves{display:flex;flex-direction:column;min-height:0;border-top:.5px solid var(--dsw-alias-border-l2);padding:6px 6px 10px}
		.xq-movesHead{display:flex;align-items:center;gap:6px;padding:2px 6px 6px;color:var(--dsw-alias-label-tertiary);font-size:11px}
		.xq-movesList{margin:0;padding:0;list-style:none;overflow-y:auto;min-height:0;max-height:168px}
		.xq-moveRow{display:flex;align-items:center;gap:4px;padding:1px 0}
		.xq-moveNo{width:26px;flex:none;text-align:right;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
		.xq-moveCell{flex:1;min-width:0;text-align:left;padding:2px 6px;border-radius:var(--dsw-radius-xs);border:.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
		.xq-moveCell:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
		.xq-moveCell:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
		.xq-moveCell:disabled{cursor:default;opacity:.5}
		.xq-moveActive{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
		.xq-moveEmpty{color:var(--dsw-alias-label-caption)}
		.xq-confirm{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 10px 8px;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-state-warn-secondary);color:var(--dsw-alias-label-secondary);font-size:12px}
		.xq-confirmText{flex:1;min-width:120px}
		.xq-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;flex:1;min-height:0;padding:24px;color:var(--dsw-alias-label-tertiary);text-align:center;font-size:12px}
		.xq-notice{margin:0 10px 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
		@media (prefers-reduced-motion:no-preference){
		.xq-dot-thinking{animation:xq-pulse 1s ease-in-out infinite}
		.xq-drop{animation:xq-drop 180ms cubic-bezier(.2,.8,.3,1)}
		.xq-captureGhost{animation:xq-capture 120ms ease-in forwards}
		.xq-undoGhost{animation:xq-undo 160ms ease-out forwards}
		.xq-checkRing{animation:xq-check 600ms ease-out 2}
		.xq-lastMarker{animation:xq-lastFade 2s ease-out forwards}
		.xq-shake{animation:xq-shake 120ms ease-in-out}
		}
		@media (prefers-reduced-motion:reduce){
		.xq-lastMarker{opacity:.45}
		.xq-checkRing{stroke-dasharray:2 2}
		}
		@keyframes xq-drop{from{transform:translate(var(--xq-dx,0px),var(--xq-dy,0px))}to{transform:translate(0,0)}}
		@keyframes xq-capture{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(.55)}}
		@keyframes xq-undo{from{transform:translate(var(--xq-dx,0px),var(--xq-dy,0px))}to{transform:translate(0,0)}}
		@keyframes xq-check{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
		@keyframes xq-lastFade{from{opacity:.9}to{opacity:.45}}
		@keyframes xq-pulse{0%,100%{opacity:1}50%{opacity:.3}}
		@keyframes xq-shake{0%,100%{transform:translate(0,0)}25%{transform:translate(-2px,0)}75%{transform:translate(2px,0)}}
		`;
		
			/* ==================== lib/ui/icons.js ==================== */
		/**
		 * 自带的小图形与「不依赖任何官方 UI 包」的标记工厂。
		 *
		 * 为什么不用 `@deepseek-ai/dsh-client-ui-primitives`（§4.5、T18）：官方规范明确劝阻——
		 * 该包随版本变化、纯 JS 插件没有类型检查，而且组件抛错会把整个插槽条目打白
		 * （控制台 `slot entry crashed in '<slot>'`）。所以按钮、tooltip、状态点、图标都在
		 * 本插件里自绘，只保留 `--dsw-alias-*` / `--dsw-*` 令牌引用。
		 *
		 * `el()` 的存在还有一个工程理由：源文件是**免构建的 ESM**，不能写 JSX；同时 UI 源
		 * 文件要能被 Node 直接 import（单测），所以不能在模块顶层碰 `React`——`React` 只在
		 * 组件函数体里被求值时才存在（在产物里它是 factory 作用域的常量）。
		 */
		
		
		/** 极简 createElement（无 JSX、无构建期转译）。 */
		function el(type, props, ...children) {
		  return React.createElement(type, props, ...children);
		}
		
		/**
		 * 面板样式标签。
		 *
		 * 用「组件内渲染 `<style>`」而不是往 `document.head` 插标签：卸载即移除，不会残留
		 * （§4.5 第 5 条给出的两种做法里更可靠的一种）。
		 * @returns style 元素。
		 */
		function StyleTag() {
		  return el('style', { 'data-plugin': 'dsh-xiangqi-mate', 'data-plugin-css': STYLE_ID }, CSS);
		}
		
		/**
		 * 象棋棋盘图形：外框 + 三条横线 + 河界留白。
		 * @param props - `{ size, className, title }`。
		 * @returns svg 元素。
		 */
		function BoardGlyph(props) {
		  const size = Number.isFinite(props.size) ? props.size : 16;
		  const stroke = 'currentColor';
		  const lines = [];
		  for (let i = 0; i <= 3; i += 1) {
		    lines.push(el('line', { key: `h${i}`, x1: 3, y1: 3 + i * 4, x2: 21, y2: 3 + i * 4 }));
		  }
		  lines.push(el('line', { key: 'v0', x1: 3, y1: 3, x2: 3, y2: 19 }));
		  lines.push(el('line', { key: 'v1', x1: 21, y1: 3, x2: 21, y2: 19 }));
		  lines.push(el('line', { key: 'v2', x1: 12, y1: 3, x2: 12, y2: 7 }));
		  lines.push(el('line', { key: 'v3', x1: 12, y1: 15, x2: 12, y2: 19 }));
		  return el(
		    'svg',
		    {
		      width: size,
		      height: size,
		      viewBox: '0 0 24 24',
		      fill: 'none',
		      stroke,
		      strokeWidth: 1.6,
		      strokeLinecap: 'round',
		      className: props.className,
		      'aria-hidden': 'true',
		      focusable: 'false',
		    },
		    props.title === undefined ? null : el('title', null, props.title),
		    ...lines,
		  );
		}
		
			/* ==================== lib/ui/rpc.js ==================== */
		/**
		 * 通道①：通用 RPC（§7.5.3）。
		 *
		 * 静态双半插件**没有** `host.call`（那是动态 Cordis 包的能力），客户端到达宿主半只有
		 * `ctx.connection.rpc.call(channel, endpoint, payload, signal)` 这一条受支持的通道。
		 * 这一层把「传输」与「投影」分开：
		 *
		 *  - 传输失败（服务缺失、抛异常、HTTP 非 2xx）→ `{ ok: false, error: { code, message } }`；
		 *  - 传回来的 `value` 用 `unwrapProjection` 折成投影（认不出就是 `projection: null`）。
		 *
		 * **绝不抛异常**：调用方不必为每个 await 写 try/catch，也就不会产生游离的 rejection
		 * （游离 rejection 会 dispose 整个 DSH，§12.3-T21）。
		 */
		
		
		/** 通道名必须匹配 `/^\/[A-Za-z0-9._~-]+$/` 且不能是保留的 `/api`（§7.5.3 约束 2）。 */
		const RPC_CHANNEL = '/xiangqi-mate';
		
		/** 本插件的端点清单；客户端只用这些，写错在这里就能看出来。 */
		const RPC_ENDPOINTS = Object.freeze([
		  'state',
		  'move',
		  'undo',
		  'hint',
		  'new',
		  'review',
		  'resign',
		  'fallback',
		]);
		
		const UNAVAILABLE = Object.freeze({
		  code: 'rpc/unavailable',
		  message: 'the connection service is not available in this composition',
		});
		
		/** 把任意抛出物折成 `{ code, message }`。 */
		function transportError(error) {
		  return {
		    code: 'rpc/transport',
		    message: error instanceof Error ? error.message : String(error),
		  };
		}
		
		/** 归一化宿主返回的 `error` 字段。 */
		function normalizeError(error) {
		  if (error !== null && typeof error === 'object') {
		    return {
		      code: typeof error.code === 'string' ? error.code : 'rpc/failed',
		      message: typeof error.message === 'string' ? error.message : '',
		    };
		  }
		  return { code: 'rpc/failed', message: '' };
		}
		
		/**
		 * 建立某个会话的游戏 RPC 客户端。
		 *
		 * @param options - `{ call, sessionId, cwd, channel }`。
		 *   `call` 就是 `ctx.connection.rpc.call`（缺失时传 undefined，全部端点降级为不可用）；
		 *   `sessionId` 会随每个 payload 一起发出去——宿主必须用它校验归属（§7.5.3 约束 4）；
		 *   `cwd` 是会话工作区（从 `useSessions` 取的 `byId[sessionId].cwd`），宿主用它决定
		 *   对局落盘位置，从而与「会话命令 / 工具」两条路径写到同一个地方（§7.5.2）。
		 * @returns 每个端点一个方法，统一返回 `{ ok, ... }`，永不抛。
		 */
		function createGameRpc(options) {
		  const opts = options === undefined || options === null ? {} : options;
		  const call = typeof opts.call === 'function' ? opts.call : null;
		  const channel = typeof opts.channel === 'string' ? opts.channel : RPC_CHANNEL;
		  const cwd = typeof opts.cwd === 'string' && opts.cwd !== '' ? opts.cwd : null;
		
		  /** 一次端点调用：返回原始 value 或错误。 */
		  async function invoke(endpoint, payload, signal) {
		    if (call === null) return { ok: false, error: UNAVAILABLE };
		    let result;
		    try {
		      result = await call(channel, endpoint, payload, signal);
		    } catch (error) {
		      return { ok: false, error: transportError(error) };
		    }
		    if (result === null || typeof result !== 'object') {
		      return { ok: false, error: { code: 'rpc/malformed', message: 'invalid response envelope' } };
		    }
		    if (result.ok !== true) return { ok: false, error: normalizeError(result.error) };
		    return { ok: true, value: result.value };
		  }
		
		  function scoped(payload) {
		    if (typeof opts.sessionId !== 'string' || opts.sessionId === '') {
		      return { error: { code: 'session/missing', message: 'no session is selected' } };
		    }
		    return {
		      error: null,
		      payload: { sessionId: opts.sessionId, ...(cwd === null ? {} : { cwd }), ...payload },
		    };
		  }
		
		  /** 需要投影回填的端点（state/move/undo/new/review/resign/fallback）。 */
		  async function projectionCall(endpoint, payload, signal) {
		    const scope = scoped(payload);
		    if (scope.error !== null) return { ok: false, error: scope.error };
		    const answer = await invoke(endpoint, scope.payload, signal);
		    if (answer.ok !== true) return answer;
		    return { ok: true, projection: unwrapProjection(answer.value), value: answer.value };
		  }
		
		  return {
		    /** 通道是否可用（`connection` 服务缺失时为 false，面板据此显示只读）。 */
		    available: call !== null,
		    sessionId: typeof opts.sessionId === 'string' ? opts.sessionId : null,
		    /** 进入面板、会话切换、轮询都走它。 */
		    state: (signal) => projectionCall('state', {}, signal),
		    /** 人落子。`from`/`to` 是内部索引；`iccs` 只是给宿主做日志与兜底。 */
		    move: (from, to, iccs, signal) => projectionCall('move', { from, to, iccs }, signal),
		    /** 悔棋，默认 2 手（回到上一次轮到自己）。 */
		    undo: (plies, signal) => projectionCall('undo', { plies: plies === undefined ? 2 : plies }, signal),
		    /** 新对局。 */
		    newGame: (signal) => projectionCall('new', {}, signal),
		    /** 认输。 */
		    resign: (signal) => projectionCall('resign', {}, signal),
		    /** 立即由本地引擎代走（Q7 的救命按钮）。 */
		    fallback: (signal) => projectionCall('fallback', {}, signal),
		    /** 复盘数据（可选端点：拿不到就退回本地重放，不报错）。 */
		    async review(signal) {
		      const scope = scoped({});
		      if (scope.error !== null) return { ok: false, error: scope.error };
		      const answer = await invoke('review', scope.payload, signal);
		      if (answer.ok !== true) return answer;
		      return { ok: true, projection: unwrapProjection(answer.value), value: answer.value };
		    },
		    /** 提示：返回值是候选着法列表，不是局面，所以不走投影分支。 */
		    async hint(count, signal) {
		      const scope = scoped({ count: count === undefined ? 3 : count });
		      if (scope.error !== null) return { ok: false, error: scope.error };
		      const answer = await invoke('hint', scope.payload, signal);
		      if (answer.ok !== true) return answer;
		      return { ok: true, value: answer.value };
		    },
		  };
		}
		
			/* ==================== lib/ui/poller.js ==================== */
		/**
		 * 按需轮询（§7.5.3）。
		 *
		 * 宿主 → 客户端**没有推送通道**（客户端事件只有 4 个，第三方加不进白名单），所以
		 * AI 的应招只能靠轮询到达。三条硬规则：
		 *
		 *  1. 只在 `pending === 'ai-thinking'` 且面板可见时轮（空闲、不可见 = 零轮询）；
		 *  2. 800 ms 起、×1.35 退避、2 s 上限；
		 *  3. 最长 30 s，超时停下并回调 `onExpired`（面板提示可点「由本地引擎代走」），
		 *     而不是无限轮下去。
		 *
		 * 为了可测，这里不直接用 `window.setTimeout`：调度器由外部注入（插件里给
		 * `ctx.timer.timeout`，测试里给一个假调度器 + 假时钟）。所有计时器都记在
		 * `cancel` 上，`stop()`/`dispose()` 一定清干净。
		 */
		
		
		/**
		 * 建立一个轮询循环。
		 *
		 * @param options - `{ schedule, onTick, onExpired, now, baseMs, factor, maxMs, timeoutMs }`。
		 *   `schedule(callback, delayMs)` 必须返回一个「取消」函数（`ctx.timer.timeout` 正好如此）；
		 *   `onTick()` 每轮调用一次（内部自己 await 请求，**不要**抛出）；
		 *   `onExpired()` 只在超时那一刻调用一次；
		 *   `now()` 返回毫秒时间戳（注入以便测试）。
		 * @returns `{ start, stop, dispose, isRunning }`。
		 */
		function createPollLoop(options) {
		  const opts = options === undefined || options === null ? {} : options;
		  const schedule = typeof opts.schedule === 'function' ? opts.schedule : null;
		  const onTick = typeof opts.onTick === 'function' ? opts.onTick : () => {};
		  const onExpired = typeof opts.onExpired === 'function' ? opts.onExpired : () => {};
		  const onError = typeof opts.onError === 'function' ? opts.onError : () => {};
		  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
		  const budget = {
		    baseMs: Number.isFinite(opts.baseMs) ? opts.baseMs : POLL_BASE_MS,
		    factor: Number.isFinite(opts.factor) ? opts.factor : POLL_FACTOR,
		    maxMs: Number.isFinite(opts.maxMs) ? opts.maxMs : POLL_MAX_MS,
		  };
		  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : POLL_TIMEOUT_MS;
		
		  let running = false;
		  let disposed = false;
		  let cancel = null;
		  let attempt = 0;
		  let startedAt = 0;
		
		  function arm() {
		    if (disposed || !running || schedule === null) return;
		    const delay = nextPollDelay(attempt, budget);
		    cancel = schedule(() => {
		      cancel = null;
		      if (disposed || !running) return;
		      if (pollExpired(now() - startedAt, timeoutMs)) {
		        running = false;
		        onExpired();
		        return;
		      }
		      // 回调里的异常**绝不能**逃逸成游离 rejection（那会 dispose 整个 DSH，T21），
		      // 也不能把循环卡死：吞掉并交给 onError，然后照常排下一轮。
		      try {
		        onTick();
		      } catch (error) {
		        onError(error);
		      }
		      attempt += 1;
		      arm();
		    }, delay);
		  }
		
		  return {
		    /** 开始轮询；重复调用是幂等的（不会叠加计时器）。 */
		    start() {
		      if (disposed || running || schedule === null) return;
		      running = true;
		      attempt = 0;
		      startedAt = now();
		      arm();
		    },
		    /** 停止轮询并清掉待触发的计时器（面板不可见、AI 已应招、超时都要调它）。 */
		    stop() {
		      running = false;
		      if (cancel !== null) {
		        const drop = cancel;
		        cancel = null;
		        drop();
		      }
		    },
		    /** 永久停用（组件卸载）。 */
		    dispose() {
		      disposed = true;
		      this.stop();
		    },
		    isRunning() {
		      return running;
		    },
		    /** 已经轮询了多少次（面板用它算「已用时」）。 */
		    attempts() {
		      return attempt;
		    },
		    /** 本轮开始的时间戳（算 AI 已用时）。 */
		    startedAt() {
		      return startedAt;
		    },
		  };
		}
		
			/* ==================== lib/ui/engine-bridge.js ==================== */
		/**
		 * 内联引擎的薄封装。
		 *
		 * 客户端**持有一份引擎源码**（`scripts/build-client.mjs` 把 `lib/engine/**` 内联进
		 * `lib/client.js`），但它只用于两件事（§7.2 第 2 条、§7.5.4 第 2 条）：
		 *
		 *  1. **乐观预校验**：`legalTargets` 已经由宿主下发，这里只补一句人话原因，并在宿主
		 *     没有下发 `legalTargets` 时兜底判断——判定分歧一律以宿主为准；
		 *  2. **本地复盘重放**：投影只带中文记谱与 ICCS，不带每一手的 FEN；复盘要把棋盘切到
		 *     第 n 手，就在客户端用同一份引擎重放，零 RPC、零延迟。
		 *
		 * 这份 import 只服务于「源码可读性」：真正的 `lib/client.js` 由生成脚本把引擎与 UI
		 * 拼进同一个 IIFE，import 会被逐行剥掉，名字在同一个作用域里直接可见。
		 *
		 * 所有函数都不抛：引擎对畸形输入会 `throw PositionError`，而 UI 不该因为一条坏数据
		 * 整块打白，所以这里统一 try/catch 后降级。
		 */
		
		
		
		/** `from`/`to` 内部索引 → ICCS 着法串（如 `h2e2`）；任一端非法返回 ''。 */
		function iccsOf(from, to) {
		  const a = squareToIccs(from);
		  const b = squareToIccs(to);
		  return a === '' || b === '' ? '' : `${a}${b}`;
		}
		
		/** 标准初始局面的棋盘（宿主连不上时仍要画出一张空盘/初始盘，而不是白屏）。 */
		function initialBoard() {
		  try {
		    return normalizeBoard(initialPosition().board);
		  } catch {
		    return normalizeBoard(null);
		  }
		}
		
		/** 标准初始局面 FEN；失败返回 ''。 */
		function initialFen() {
		  try {
		    return positionToFen(initialPosition());
		  } catch {
		    return '';
		  }
		}
		
		/**
		 * 本地兜底的可走点（只在宿主没有下发 `legalTargets` 时使用）。
		 * @param fen - 局面 FEN。
		 * @param from - 起点格号。
		 * @returns 目标格号数组；没有局面时返回 []。
		 */
		function localTargets(fen, from) {
		  const pos = positionOf(fen);
		  if (pos === null) return [];
		  try {
		    const moves = generateMoves(pos);
		    const out = [];
		    for (const move of moves) {
		      if (move.from === from) out.push(move.to);
		    }
		    return out.sort((a, b) => a - b);
		  } catch {
		    return [];
		  }
		}
		
		/**
		 * 从一个 FEN 建局面；失败返回 null。
		 * @param fen - FEN 文本。
		 * @returns Position 或 null。
		 */
		function positionOf(fen) {
		  try {
		    if (typeof fen === 'string' && fen !== '') return positionFromFen(fen);
		  } catch {
		    /* 畸形 FEN：降级到「没有本地局面」 */
		  }
		  return null;
		}
		
		/**
		 * 乐观预校验一步棋。
		 *
		 * @param fen - 当前局面 FEN（来自投影）。
		 * @param from - 起点索引。
		 * @param to - 终点索引。
		 * @returns `{ legal, reason }`；没有本地局面时 `legal: null`（= 不知道，交给宿主）。
		 */
		function precheckMove(fen, from, to) {
		  const pos = positionOf(fen);
		  if (pos === null) return { legal: null, reason: null };
		  const move = { from, to };
		  try {
		    if (isLegalMove(pos, move)) return { legal: true, reason: null };
		    const reason = moveRejectReason(pos, move);
		    return { legal: false, reason: typeof reason === 'string' && reason !== '' ? reason : null };
		  } catch {
		    return { legal: null, reason: null };
		  }
		}
		
		/**
		 * 复盘重放：把棋盘切到「下完前 `ply` 手」的局面。
		 *
		 * @param initialFen - 初始局面 FEN；缺失或非法时用标准初始局面。
		 * @param history - 投影的 history（每手至少要有 `iccs`）。
		 * @param ply - 要走到第几手（0 = 初始局面，1 = 走完第一手）。
		 * @returns `{ board, fen, lastMove }`；重放失败返回 null（调用方保持当前画面）。
		 */
		function replayToPly(initialFen, history, ply) {
		  const list = Array.isArray(history) ? history : [];
		  const target = Number.isInteger(ply) && ply > 0 ? Math.min(ply, list.length) : 0;
		  let pos = positionOf(initialFen);
		  if (pos === null) {
		    try {
		      pos = initialPosition();
		    } catch {
		      return null;
		    }
		  }
		  let lastMove = null;
		  for (let i = 0; i < target; i += 1) {
		    const item = list[i] !== null && typeof list[i] === 'object' ? list[i] : {};
		    try {
		      const move = typeof item.iccs === 'string' && item.iccs !== '' ? iccsToMove(pos, item.iccs) : null;
		      if (move === null) return null;
		      lastMove = { from: move.from, to: move.to };
		      pos = applyMove(pos, move);
		    } catch {
		      return null;
		    }
		  }
		  const board = normalizeBoard(pos.board);
		  let fen = '';
		  try {
		    fen = positionToFen(pos);
		  } catch {
		    fen = '';
		  }
		  return { board, fen, lastMove, position: pos };
		}
		
			/* ==================== lib/ui/board.js ==================== */
		/**
		 * 棋盘：**渲染层与交互层解耦**（§7.2，FR 差异点 1）。
		 *
		 * ```
		 * XiangqiBoard          ← 只做 <svg> 外壳、几何与 role="grid"
		 *   BoardView           ← 纯展示：网格、河界、九宫、炮兵位、棋子、标记、箭头、动画壳
		 *   BoardInteraction    ← 交互：命中测试、拖拽、键盘光标；只产出「意图」
		 * ```
		 *
		 * `BoardView` 不接收任何回调、不 import 引擎的规则函数，同样的 props 必然渲染同样的
		 * 画面（便于截图比对与主题切换）；`BoardInteraction` 不认识规则，只把
		 * `onIntent(from, to)` 报上去，合法性一律由宿主判定（本地引擎副本只补一句人话原因）。
		 */
		
		
		/** 兵/炮位的「十」字标记（行, 列）。 */
		const STAR_POINTS = Object.freeze([
		  [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
		  [6, 0], [6, 2], [6, 4], [6, 6], [6, 8],
		  [2, 1], [2, 7],
		  [7, 1], [7, 7],
		]);
		
		/** 每块棋盘自己的 marker id（同页面可能同时有两块棋盘：右栏 tab + 主面板）。 */
		let boardSeq = 0;
		
		/** 单位 `u` 下的棋盘几何。 */
		function geometry(u, orientation) {
		  const pad = 0.65 * u;
		  const flip = orientation === 'b';
		  const xOf = (col) => pad + (flip ? 8 - col : col) * u;
		  const yOf = (row) => pad + (flip ? 9 - row : row) * u;
		  const point = (index) => ({ x: xOf(idxToCol(index)), y: yOf(idxToRow(index)) });
		  return {
		    u,
		    pad,
		    xOf,
		    yOf,
		    point,
		    viewW: u * 9.3,
		    viewH: u * 10.3,
		  };
		}
		
		/** 网格线 + 九宫斜线（河界处断开两条内线）。 */
		function gridPath(g) {
		  const segs = [];
		  for (let row = 0; row < 10; row += 1) {
		    segs.push(`M${g.xOf(0)} ${g.yOf(row)}H${g.xOf(8)}`);
		  }
		  for (let col = 0; col < 9; col += 1) {
		    if (col === 0 || col === 8) {
		      segs.push(`M${g.xOf(col)} ${g.yOf(0)}V${g.yOf(9)}`);
		    } else {
		      segs.push(`M${g.xOf(col)} ${g.yOf(0)}V${g.yOf(4)}`);
		      segs.push(`M${g.xOf(col)} ${g.yOf(5)}V${g.yOf(9)}`);
		    }
		  }
		  segs.push(`M${g.xOf(3)} ${g.yOf(0)}L${g.xOf(5)} ${g.yOf(2)}`);
		  segs.push(`M${g.xOf(5)} ${g.yOf(0)}L${g.xOf(3)} ${g.yOf(2)}`);
		  segs.push(`M${g.xOf(3)} ${g.yOf(7)}L${g.xOf(5)} ${g.yOf(9)}`);
		  segs.push(`M${g.xOf(5)} ${g.yOf(7)}L${g.xOf(3)} ${g.yOf(9)}`);
		  return segs.join(' ');
		}
		
		/** 兵/炮位的「十」字（中心留空隙；贴边的列只画靠盘内的一侧）。 */
		function starPath(g) {
		  const gap = 0.085 * g.u;
		  const arm = 0.17 * g.u;
		  const segs = [];
		  for (const [row, col] of STAR_POINTS) {
		    const x = g.xOf(col);
		    const y = g.yOf(row);
		    if (col > 0) segs.push(`M${x - gap - arm} ${y}H${x - gap}`);
		    if (col < 8) segs.push(`M${x + gap} ${y}H${x + gap + arm}`);
		    segs.push(`M${x} ${y - gap - arm}V${y - gap}`);
		    segs.push(`M${x} ${y + gap}V${y + gap + arm}`);
		  }
		  return segs.join(' ');
		}
		
		/**
		 * 一枚棋子（外层 `<g>` 用 transform 属性定位，内层 `<g>` 承担 CSS 动画）。
		 *
		 * 为什么分两层：CSS `transform` 属性会**覆盖** SVG 的 `transform` 呈现属性，动画写在
		 * 外层会把棋子飞回原点。内层承接动画，位移就是相对外层坐标系的，才正确。
		 * @param props - `{ index, piece, g, state, label, animClass, dx, dy }`。
		 * @returns g 元素。
		 */
		function Piece(props) {
		  const { index, piece, g, state, label } = props;
		  const { x, y } = g.point(index);
		  const red = piece === piece.toUpperCase();
		  const inkClass = red ? 'xq-pieceRed' : 'xq-pieceBlack';
		  const style = {};
		  if (props.dx !== 0 || props.dy !== 0) {
		    style['--xq-dx'] = `${props.dx}px`;
		    style['--xq-dy'] = `${props.dy}px`;
		  }
		  const inner = [];
		  inner.push(
		    el('circle', { key: 'face', className: 'xq-pieceFace', r: 0.43 * g.u, strokeWidth: 0.022 * g.u }),
		  );
		  inner.push(
		    el('circle', {
		      key: 'ring',
		      className: `xq-pieceRing ${inkClass}`,
		      r: 0.365 * g.u,
		      strokeWidth: 0.03 * g.u,
		    }),
		  );
		  inner.push(
		    el(
		      'text',
		      {
		        key: 'ink',
		        className: `xq-pieceInk ${inkClass}`,
		        x: 0,
		        y: 0,
		        fontSize: 0.52 * g.u,
		      },
		      pieceNameZh(piece),
		    ),
		  );
		  if (state.selected) {
		    inner.push(
		      el('circle', { key: 'sel', className: 'xq-selectRing', r: 0.475 * g.u, strokeWidth: 0.055 * g.u }),
		    );
		  }
		  if (state.checked) {
		    inner.push(
		      el('circle', { key: 'chk', className: 'xq-checkRing', r: 0.5 * g.u, strokeWidth: 0.06 * g.u }),
		    );
		  }
		  const innerClass = [props.animClass, props.shaking ? 'xq-shake' : ''].filter(Boolean).join(' ');
		  return el(
		    'g',
		    { transform: `translate(${x} ${y})`, style, key: props.reactKey },
		    el('g', { className: innerClass === '' ? undefined : innerClass }, el('title', null, label), ...inner),
		  );
		}
		
		/**
		 * 纯展示层。
		 *
		 * @param props - 见 `XiangqiBoard` 的说明；这一层**不接收任何回调**。
		 * @returns svg 子元素数组。
		 */
		function BoardView(props) {
		  const g = geometry(props.u, props.orientation);
		  const { board } = props;
		  const selected = props.selected;
		  const legal = Array.isArray(props.legalTargets) ? props.legalTargets : [];
		  const lastMove = props.lastMove;
		  const hints = Array.isArray(props.hints) ? props.hints : [];
		  const hidden = props.hiddenIndex;
		  const hover = props.hoverIndex;
		  const cursor = props.cursor;
		
		  const nodes = [];
		  nodes.push(
		    el('rect', {
		      key: 'face',
		      className: 'xq-boardFace',
		      x: 0,
		      y: 0,
		      width: g.viewW,
		      height: g.viewH,
		      rx: 0.45 * g.u,
		      strokeWidth: 0.04 * g.u,
		    }),
		  );
		  nodes.push(
		    el('rect', {
		      key: 'river',
		      className: 'xq-riverBand',
		      x: g.xOf(0),
		      y: g.yOf(4),
		      width: 8 * g.u,
		      height: g.u,
		    }),
		  );
		  nodes.push(
		    el('path', {
		      key: 'grid',
		      className: 'xq-grid',
		      d: gridPath(g),
		      strokeWidth: 0.022 * g.u,
		      fill: 'none',
		    }),
		  );
		  nodes.push(
		    el('path', {
		      key: 'border',
		      className: 'xq-border',
		      d: `M${g.xOf(0)} ${g.yOf(0)}H${g.xOf(8)}V${g.yOf(9)}H${g.xOf(0)}Z`,
		      strokeWidth: 0.05 * g.u,
		    }),
		  );
		  nodes.push(
		    el('path', {
		      key: 'stars',
		      className: 'xq-grid',
		      d: starPath(g),
		      strokeWidth: 0.022 * g.u,
		      fill: 'none',
		    }),
		  );
		  const riverY = (g.yOf(4) + g.yOf(5)) / 2;
		  nodes.push(
		    el(
		      'text',
		      {
		        key: 'riverText',
		        className: 'xq-riverText',
		        x: g.xOf(2),
		        y: riverY,
		        fontSize: 0.5 * g.u,
		        textAnchor: 'middle',
		        dominantBaseline: 'central',
		      },
		      '楚河',
		    ),
		  );
		  nodes.push(
		    el(
		      'text',
		      {
		        key: 'riverText2',
		        className: 'xq-riverText',
		        x: g.xOf(6),
		        y: riverY,
		        fontSize: 0.5 * g.u,
		        textAnchor: 'middle',
		        dominantBaseline: 'central',
		      },
		      '汉界',
		    ),
		  );
		
		  // 上一步痕迹（起止两点 + 连线）：垫在棋子下面，并且 2 s 后淡到 0.45 常驻。
		  if (lastMove !== null && lastMove !== undefined) {
		    const a = g.point(lastMove.from);
		    const b = g.point(lastMove.to);
		    nodes.push(
		      el(
		        'g',
		        { key: 'last', className: 'xq-lastMarker' },
		        el('line', { className: 'xq-lastLine', x1: a.x, y1: a.y, x2: b.x, y2: b.y, strokeWidth: 0.14 * g.u }),
		        el('circle', { className: 'xq-lastDot', cx: a.x, cy: a.y, r: 0.44 * g.u, opacity: 0.45 }),
		        el('circle', { className: 'xq-lastDot', cx: b.x, cy: b.y, r: 0.44 * g.u, opacity: 0.45 }),
		      ),
		    );
		  }
		
		  // 可走点：空点画实心小圆，可吃子画空心环（环画在棋子之上）。
		  const dots = [];
		  const rings = [];
		  for (const index of legal) {
		    const { x, y } = g.point(index);
		    if (board[index] === '') {
		      dots.push(el('circle', { key: `d${index}`, className: 'xq-targetDot', cx: x, cy: y, r: 0.13 * g.u }));
		    } else {
		      rings.push(
		        el('circle', {
		          key: `r${index}`,
		          className: 'xq-targetRing',
		          cx: x,
		          cy: y,
		          r: 0.47 * g.u,
		          strokeWidth: 0.055 * g.u,
		        }),
		      );
		    }
		  }
		  nodes.push(el('g', { key: 'dots' }, ...dots));
		
		  // 拖拽悬停格：一层浅浅的底色，不抢棋子的可读性。
		  if (hover !== null && hover !== undefined && hover !== selected) {
		    const { x, y } = g.point(hover);
		    nodes.push(
		      el('rect', {
		        key: 'hover',
		        className: 'xq-hoverCell',
		        x: x - 0.5 * g.u,
		        y: y - 0.5 * g.u,
		        width: g.u,
		        height: g.u,
		        rx: 0.12 * g.u,
		      }),
		    );
		  }
		
		  // 棋子（含落子/悔棋动画与抖动）。
		  const checkedKing = props.checkedKingIndex;
		  for (let index = 0; index < 90; index += 1) {
		    const piece = board[index];
		    if (piece === '' || piece === undefined || piece === null) continue;
		    if (hidden === index) continue;
		    const isDropTo = lastMove !== null && lastMove !== undefined && lastMove.to === index && props.animateDrop === true;
		    const from = isDropTo ? g.point(lastMove.from) : null;
		    const to = g.point(index);
		    nodes.push(
		      el(Piece, {
		        key: isDropTo ? `p${index}:drop:${props.revision}` : `p${index}`,
		        index,
		        piece,
		        g,
		        label: props.cellLabel(index, piece),
		        state: { selected: selected === index, checked: checkedKing === index },
		        animClass: isDropTo ? 'xq-drop' : undefined,
		        shaking: props.shakeIndex === index,
		        dx: from === null ? 0 : from.x - to.x,
		        dy: from === null ? 0 : from.y - to.y,
		      }),
		    );
		  }
		
		  nodes.push(el('g', { key: 'rings' }, ...rings));
		
		  // 吃子残影：被吃的子 120 ms 缩小淡出。
		  const ghosts = Array.isArray(props.ghosts) ? props.ghosts : [];
		  for (let i = 0; i < ghosts.length; i += 1) {
		    const ghost = ghosts[i];
		    const { x, y } = g.point(ghost.index);
		    nodes.push(
		      el(
		        'g',
		        { key: `ghost${i}`, transform: `translate(${x} ${y})`, pointerEvents: 'none' },
		        el(
		          'g',
		          { className: 'xq-captureGhost' },
		          el('circle', { className: 'xq-pieceFace', r: 0.43 * g.u, strokeWidth: 0.022 * g.u }),
		          el('text', {
		            className: `xq-pieceInk ${ghost.piece === ghost.piece.toUpperCase() ? 'xq-pieceRed' : 'xq-pieceBlack'}`,
		            x: 0,
		            y: 0,
		            fontSize: 0.52 * g.u,
		            children: pieceNameZh(ghost.piece),
		          }),
		        ),
		      ),
		    );
		  }
		
		  // 悔棋残影：从落点反向飞回起点 160 ms。
		  if (props.undoGhost !== null && props.undoGhost !== undefined) {
		    const ghost = props.undoGhost;
		    const a = g.point(ghost.from);
		    const b = g.point(ghost.to);
		    nodes.push(
		      el(
		        'g',
		        {
		          key: 'undoGhost',
		          transform: `translate(${a.x} ${a.y})`,
		          style: { '--xq-dx': `${b.x - a.x}px`, '--xq-dy': `${b.y - a.y}px` },
		          pointerEvents: 'none',
		        },
		        el(
		          'g',
		          { className: 'xq-undoGhost' },
		          el('circle', { className: 'xq-pieceFace', r: 0.43 * g.u, strokeWidth: 0.022 * g.u }),
		          el('text', {
		            className: `xq-pieceInk ${ghost.piece === ghost.piece.toUpperCase() ? 'xq-pieceRed' : 'xq-pieceBlack'}`,
		            x: 0,
		            y: 0,
		            fontSize: 0.52 * g.u,
		            children: pieceNameZh(ghost.piece),
		          }),
		        ),
		      ),
		    );
		  }
		
		  // 提示着法箭头：3 条不同透明度。
		  const hintNodes = [];
		  const arrowId = props.arrowId;
		  for (const hint of hints) {
		    const a = g.point(hint.from);
		    const b = g.point(hint.to);
		    const dx = b.x - a.x;
		    const dy = b.y - a.y;
		    const len = Math.sqrt(dx * dx + dy * dy) || 1;
		    const trim = 0.52 * g.u;
		    const sx = a.x + (dx / len) * trim;
		    const sy = a.y + (dy / len) * trim;
		    const ex = b.x - (dx / len) * trim;
		    const ey = b.y - (dy / len) * trim;
		    hintNodes.push(
		      el('line', {
		        key: `h${hint.rank}`,
		        className: 'xq-hintLine',
		        x1: sx,
		        y1: sy,
		        x2: ex,
		        y2: ey,
		        strokeWidth: 0.11 * g.u,
		        opacity: [0.9, 0.62, 0.38][hint.rank] ?? 0.4,
		        markerEnd: `url(#${arrowId})`,
		      }),
		    );
		  }
		  if (hintNodes.length > 0) nodes.push(el('g', { key: 'hints' }, ...hintNodes));
		
		  // 键盘光标。
		  if (cursor !== null && cursor !== undefined) {
		    const { x, y } = g.point(cursor);
		    nodes.push(
		      el('rect', {
		        key: 'cursor',
		        className: 'xq-cursorBox',
		        x: x - 0.4 * g.u,
		        y: y - 0.4 * g.u,
		        width: 0.8 * g.u,
		        height: 0.8 * g.u,
		        rx: 0.1 * g.u,
		        strokeWidth: 0.05 * g.u,
		      }),
		    );
		  }
		
		  return nodes;
		}
		
		/**
		 * 交互层：90 个透明命中格 + 指针手势 + 键盘。
		 *
		 * 只产出意图：`onIntent(from, to)` 与 `onCursor(index)`；不认识规则，也不改任何状态。
		 * @param props - `{ g, board, selected, label, cellLabel, interactive, keyMode, onIntent, onCursor, onReview, onHover }`。
		 * @returns g 元素。
		 */
		function BoardInteraction(props) {
		  const g = props.g;
		  const cells = [];
		  for (let index = 0; index < 90; index += 1) {
		    const { x, y } = g.point(index);
		    cells.push(
		      el('rect', {
		        key: index,
		        id: `${props.idPrefix}-cell-${index}`,
		        className: 'xq-hit',
		        role: 'gridcell',
		        'aria-label': props.cellLabel(index, props.board[index]),
		        'aria-selected': props.selected === index ? 'true' : undefined,
		        x: x - 0.5 * g.u,
		        y: y - 0.5 * g.u,
		        width: g.u,
		        height: g.u,
		      }),
		    );
		  }
		  return el(
		    'g',
		    {
		      onPointerDown: props.onPointerDown,
		      onPointerMove: props.onPointerMove,
		      onPointerUp: props.onPointerUp,
		      onPointerCancel: props.onPointerUp,
		      style: { touchAction: 'none', cursor: props.interactive ? 'pointer' : 'default' },
		    },
		    ...cells,
		  );
		}
		
		/**
		 * 棋盘的对外组件：外壳 + 语义 + 两层组装。
		 *
		 * 键盘走子（§7.4）：Tab 进入棋盘 → 方向键移动光标 → Enter 选中/落子 → Esc 取消。
		 * 复盘模式下方向键改为前后翻手（左右键），由 `keyMode` 切换。
		 *
		 * @param props - `model`/`board`/`lastMove`/`u`/`orientation`/`label`/`cellLabel`/
		 *   `ghosts`/`undoGhost`/`hiddenIndex`/`shakeIndex`/`revision`/`animateDrop`/
		 *   `selected`/`legalTargets`/`hints`/`cursor`/`checkedKingIndex`/`interactive`/
		 *   `keyMode`/`onIntent`/`onCursor`/`onReview`。
		 * @returns svg 元素。
		 */
		function XiangqiBoard(props) {
		  const g = geometry(props.u, props.orientation);
		  const instanceRef = React.useRef(null);
		  if (instanceRef.current === null) {
		    boardSeq += 1;
		    instanceRef.current = {
		      arrowId: `xq-arrow-${boardSeq}`,
		      idPrefix: `xq-board-${boardSeq}`,
		    };
		  }
		  const { arrowId, idPrefix } = instanceRef.current;
		  const gesture = React.useRef(null);
		  const [hover, setHover] = React.useState(null);
		
		  const pointToIndex = React.useCallback(
		    (event) => {
		      const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget;
		      const rect = svg.getBoundingClientRect();
		      if (rect.width <= 0 || rect.height <= 0) return null;
		      const scaleX = g.viewW / rect.width;
		      const scaleY = g.viewH / rect.height;
		      const vx = (event.clientX - rect.left) * scaleX;
		      const vy = (event.clientY - rect.top) * scaleY;
		      const flip = props.orientation === 'b';
		      const rawCol = Math.round((vx - g.pad) / g.u);
		      const rawRow = Math.round((vy - g.pad) / g.u);
		      const col = flip ? 8 - rawCol : rawCol;
		      const row = flip ? 9 - rawRow : rawRow;
		      if (row < 0 || row > 9 || col < 0 || col > 8) return null;
		      // 只接受落在格子半径内的点，避免把棋盘外的空白当成最近格。
		      const cx = g.xOf(rawCol);
		      const cy = g.yOf(rawRow);
		      if (Math.abs(vx - cx) > 0.5 * g.u || Math.abs(vy - cy) > 0.5 * g.u) return null;
		      return row * 9 + col;
		    },
		    [g, props.orientation],
		  );
		
		  const onPointerDown = React.useCallback(
		    (event) => {
		      // 注意：这里**不**按 interactive 提前返回。§7.4 要求「非我方回合：棋盘进入只读，
		      // 点击仅高亮该子可走点（教学性提示）」——所以点击必须照常产出意图，由承载层决定
		      // 是落子还是只高亮；interactive 只约束**拖拽**这种真正的走子手势。
		      if (event.button !== undefined && event.button !== 0) return;
		      const index = pointToIndex(event);
		      if (index === null) return;
		      gesture.current = { down: index, moved: false, x: event.clientX, y: event.clientY };
		      if (typeof event.currentTarget.setPointerCapture === 'function') {
		        try {
		          event.currentTarget.setPointerCapture(event.pointerId);
		        } catch {
		          /* 某些嵌入环境不支持捕获：退化为普通点击，不影响走子 */
		        }
		      }
		      props.onIntent(props.selected, index);
		    },
		    [pointToIndex, props],
		  );
		
		  const onPointerMove = React.useCallback(
		    (event) => {
		      const active = gesture.current;
		      if (active === null || props.interactive !== true) return;
		      const dx = event.clientX - active.x;
		      const dy = event.clientY - active.y;
		      if (!active.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
		      active.moved = true;
		      const index = pointToIndex(event);
		      if (index !== hover) setHover(index);
		    },
		    [hover, pointToIndex, props.interactive],
		  );
		
		  const onPointerUp = React.useCallback(
		    (event) => {
		      const active = gesture.current;
		      gesture.current = null;
		      setHover(null);
		      if (active === null) return;
		      // 拖拽落子只在可交互时生效；只读时松手什么都不做（点击已在 pointerdown 里处理过）。
		      if (props.interactive !== true) return;
		      const index = pointToIndex(event);
		      if (active.moved && index !== null && index !== active.down) {
		        props.onIntent(active.down, index);
		      }
		    },
		    [pointToIndex, props],
		  );
		
		  const onKeyDown = React.useCallback(
		    (event) => {
		      const key = event.key;
		      if (props.keyMode === 'review') {
		        if (key === 'ArrowLeft' || key === 'ArrowRight') {
		          // 复盘时左右键翻手：在这里消化掉，别再冒泡给面板根节点重复翻一次。
		          event.preventDefault();
		          event.stopPropagation();
		          props.onReview(key === 'ArrowLeft' ? -1 : 1);
		        }
		        return;
		      }
		      const arrows = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
		      if (Object.prototype.hasOwnProperty.call(arrows, key)) {
		        event.preventDefault();
		        const delta = arrows[key];
		        props.onArrow(delta[0], delta[1]);
		        return;
		      }
		      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
		        event.preventDefault();
		        if (props.cursor !== null && props.cursor !== undefined) {
		          props.onIntent(props.selected, props.cursor);
		        }
		        return;
		      }
		      if (key === 'Escape') {
		        event.preventDefault();
		        props.onEscape();
		      }
		    },
		    [props],
		  );
		
		  return el(
		    'svg',
		    {
		      className: 'xq-board',
		      width: g.viewW,
		      height: g.viewH,
		      viewBox: `0 0 ${g.viewW} ${g.viewH}`,
		      role: 'grid',
		      'aria-label': props.label,
		      'aria-activedescendant':
		        props.cursor === null || props.cursor === undefined ? undefined : `${idPrefix}-cell-${props.cursor}`,
		      'aria-describedby': props.hintId,
		      tabIndex: 0,
		      onKeyDown,
		    },
		    el(
		      'defs',
		      null,
		      el(
		        'marker',
		        {
		          id: arrowId,
		          viewBox: '0 0 10 10',
		          refX: 8,
		          refY: 5,
		          markerWidth: 5,
		          markerHeight: 5,
		          orient: 'auto-start-reverse',
		        },
		        el('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'var(--dsw-alias-state-business-primary)' }),
		      ),
		    ),
		    el(BoardView, { ...props, u: props.u, hoverIndex: hover, arrowId }),
		    el(BoardInteraction, {
		      g,
		      board: props.board,
		      selected: props.selected,
		      interactive: props.interactive,
		      cellLabel: props.cellLabel,
		      idPrefix,
		      onPointerDown,
		      onPointerMove,
		      onPointerUp,
		    }),
		  );
		}
		
			/* ==================== lib/ui/panel.js ==================== */
		/**
		 * 承载层：取状态、发 RPC、轮询、错误边界（§7.1/§7.2 的最外层）。
		 *
		 * 这一层是**唯一**碰 `ctx`、RPC、计时器的地方；它把结果折成 `deriveModel` 要的
		 * 「本地 UI 状态」，再把可渲染数据交给 `BoardView`。三层解耦因此是真实的：
		 *
		 * ```
		 * XiangqiPanel（本文件）  状态 + 传输 + 生命周期
		 *   XiangqiBoard          渲染层（纯）+ 交互层（只产意图）
		 * ```
		 *
		 * 与宿主的所有交互都走通道①`ctx.connection.rpc.call('/xiangqi-mate', …)`（§7.5.3），
		 * 客户端**从不**调用 `host.call`。连接不可用时整块面板降级为只读，并在状态条说明。
		 */
		
		
		const ORIENTATION = 'r';
		/** 本地即时消息的存活时间（毫秒）：够看清一行字，又不至于长期占着状态条。 */
		const NOTICE_MS = 3200;
		/** 提示着法展示 5 s（§7.4）。 */
		const HINT_MS = 5000;
		/** 吃子/悔棋残影的动画时长（§7.3）。 */
		const GHOST_MS = 200;
		/** 抖动 120 ms（§7.4）。 */
		const SHAKE_MS = 140;
		
		/** 主面板查找当前会话（root 作用域的组件拿不到 sessionId，§4.3）。 */
		function selectMainSessionId(state) {
		  const byId = state !== null && typeof state === 'object' ? state.byId : null;
		  if (byId === null || typeof byId !== 'object') return undefined;
		  for (const session of Object.values(byId)) {
		    if (session !== null && typeof session === 'object' && (session.retainedBy?.mainView ?? 0) > 0) {
		      return session.id;
		    }
		  }
		  return undefined;
		}
		
		/** 一个可复用的「等宽计时」文本。 */
		
		/**
		 * 面板头部：对手标签、回合、计时、用量。
		 * @param props - `{ t, model, projection }`。
		 * @returns header 元素。
		 */
		function PanelHeader(props) {
		  const { t, model } = props;
		  const projection = props.projection ?? {};
		  const opponent = model.opponent ?? {};
		  const opponentLabel =
		    opponent.kind === 'local' || opponent.mode === 'local'
		      ? t('header.opponentLocal')
		      : t('header.opponentModel', { model: opponent.model ?? opponent.provider ?? '—' });
		  const usage = model.usage !== null && Number.isFinite(model.usage.totalTokens) ? model.usage.totalTokens : null;
		  const clock = model.clock;
		  const meta = [];
		  meta.push(el('span', { key: 'you' }, t(`header.you.${model.hero === 'b' ? 'black' : 'red'}`)));
		  meta.push(el('span', { key: 'opp' }, opponentLabel));
		  if (model.phase !== 'finished') {
		    meta.push(el('span', { key: 'turn' }, t(`header.turn.${model.turn === 'b' ? 'black' : 'red'}`)));
		  }
		  if (usage !== null) meta.push(el('span', { key: 'usage' }, t('header.usage', { tokens: usage })));
		  if (clock !== null) {
		    const red = Number.isFinite(clock.red) ? clock.red : null;
		    const black = Number.isFinite(clock.black) ? clock.black : null;
		    if (red !== null) meta.push(el('span', { key: 'cr' }, t('header.clock.red', { time: formatClock(red) })));
		    if (black !== null) meta.push(el('span', { key: 'cb' }, t('header.clock.black', { time: formatClock(black) })));
		  }
		  if (model.history.length > 0) {
		    meta.push(el('span', { key: 'ply' }, t('header.ply', { n: model.history.length })));
		  }
		  const saveNote = typeof projection.saved === 'boolean' && projection.saved === false;
		  return el(
		    'header',
		    { className: 'xq-header' },
		    el(
		      'div',
		      { className: 'xq-headerRow' },
		      el(BoardGlyph, { size: 16 }),
		      el('span', { className: 'xq-title' }, t('panel.title')),
		      el('span', { className: 'xq-headerSpacer' }),
		    ),
		    el('div', { className: 'xq-meta' }, ...meta),
		    saveNote ? el('div', { className: 'xq-notice' }, t('status.syncLost')) : null,
		  );
		}
		
		/**
		 * 状态条：本面板**唯一**的消息出口（§7.4），同时也是读屏播报口（§7.7）。
		 * @param props - `{ t, line, announcement }`。
		 * @returns div 元素。
		 */
		function StatusStrip(props) {
		  const line = props.line;
		  const text = props.t(line.key, line.params);
		  const thinking = line.key === 'status.aiThinking';
		  return el(
		    'div',
		    { className: `xq-status xq-status-${line.tone}`, 'aria-busy': thinking ? 'true' : undefined },
		    el('span', {
		      className: `xq-dot xq-dot-${line.tone}${thinking ? ' xq-dot-thinking' : ''}`,
		      'aria-hidden': 'true',
		    }),
		    el(
		      'span',
		      {
		        className: 'xq-statusText',
		        role: line.assertive ? 'alert' : 'status',
		        'aria-live': line.assertive ? 'assertive' : 'polite',
		        'data-xq-status': line.key,
		      },
		      text,
		    ),
		    el('span', { className: 'xq-sr', 'aria-live': 'polite', 'data-xq-announce': '' }, props.announcement ?? ''),
		  );
		}
		
		/**
		 * 着法列表（复盘入口）。
		 * @param props - `{ t, rows, activeIndex, disabled, turning, onJump }`。
		 * @returns section 元素。
		 */
		function MoveList(props) {
		  const rows = props.rows;
		  const cells = [];
		  for (const row of rows) {
		    const side = (ply) => {
		      if (ply === null) return null;
		      const active = props.activeIndex === ply.index + 1;
		      const isTurning = Array.isArray(props.turning) && props.turning.indexOf(ply.ply) >= 0;
		      return el(
		        'button',
		        {
		          key: `p${ply.ply}`,
		          type: 'button',
		          className: active ? 'xq-moveCell xq-moveActive' : 'xq-moveCell',
		          disabled: props.disabled,
		          onClick: () => props.onJump(ply.index + 1),
		          title: isTurning ? props.t('moves.turning') : ply.iccs,
		          'aria-label': props.t('moves.ply', { n: ply.ply }),
		          'data-xq-ply': ply.ply,
		        },
		        ply.zh === '' ? props.t('moves.empty') : ply.zh,
		      );
		    };
		    cells.push(
		      el(
		        'li',
		        { className: 'xq-moveRow', key: row.no },
		        el('span', { className: 'xq-moveNo' }, String(row.no)),
		        side(row.red) ?? el('span', { className: 'xq-moveCell xq-moveEmpty', key: `e${row.no}` }, '…'),
		        side(row.black) ?? el('span', { className: 'xq-moveCell xq-moveEmpty', key: `b${row.no}` }, '…'),
		      ),
		    );
		  }
		  return el(
		    'section',
		    { className: 'xq-moves', 'aria-label': props.t('moves.aria') },
		    el('div', { className: 'xq-movesHead' }, props.t('moves.title')),
		    rows.length === 0
		      ? el('div', { className: 'xq-moveRow xq-moveEmpty' }, props.t('moves.empty'))
		      : el('ul', { className: 'xq-movesList' }, ...cells),
		  );
		}
		
		/**
		 * 工具条。所有按钮都有文本标签（§7.7：不只有图标）。
		 * @param props - `{ t, model, busy, offline, reviewing, hasSidebar, hasMain, handlers }`。
		 * @returns div 元素。
		 */
		function Toolbar(props) {
		  const { t, model } = props;
		  const busy = props.busy === true;
		  const offline = props.offline === true;
		  const buttons = [];
		  const push = (key, label, handler, opts) => {
		    const options = opts ?? {};
		    buttons.push(
		      el(
		        'button',
		        {
		          key,
		          type: 'button',
		          className: options.danger ? 'xq-btn xq-btnDanger' : options.primary ? 'xq-btn xq-btnPrimary' : 'xq-btn',
		          onClick: handler,
		          disabled: options.disabled === true,
		          title: options.title ?? undefined,
		        },
		        label,
		      ),
		    );
		  };
		
		  push('new', t('action.new'), props.onNew, { disabled: offline });
		  push('undo', t('action.undo'), props.onUndo, {
		    disabled: offline || busy || model.history.length < 1 || model.finished,
		    title: t('action.undo'),
		  });
		  push('hint', t('action.hint'), props.onHint, { disabled: offline || busy || model.finished });
		  if (model.pending === 'ai-thinking') {
		    push('fallback', t('action.fallback'), props.onFallback, { primary: true, disabled: offline });
		  }
		  if (model.reviewing) {
		    push('live', t('action.live'), props.onLive);
		  } else {
		    push('review', t('action.review'), props.onReview, {
		      disabled: model.history.length < 1 || props.reviewable !== true,
		    });
		  }
		  push('copy', t('action.copy'), props.onCopy, { disabled: model.history.length < 1 });
		  push('resign', t('action.resign'), props.onResign, {
		    danger: true,
		    disabled: offline || busy || model.finished,
		  });
		  if (props.hasSidebar === true) {
		    push('sidebar', t('action.openSidebar'), props.onOpenSidebar);
		  }
		  if (props.hasMain === true) {
		    push('main', t('action.openMain'), props.onOpenMain);
		  }
		  return el('div', { className: 'xq-toolbar' }, ...buttons);
		}
		
		/**
		 * 提示行：箭头之外还要给出「记谱 + 评分」（§7.4）。
		 * @param props - `{ t, hints }`。
		 * @returns div 元素或 null。
		 */
		function HintRow(props) {
		  const hints = props.hints;
		  if (!Array.isArray(hints) || hints.length === 0) return null;
		  return el(
		    'div',
		    { className: 'xq-hints', 'aria-label': props.t('board.hint') },
		    ...hints.map((hint) =>
		      el(
		        'span',
		        { className: 'xq-hintItem', key: hint.rank, title: hint.iccs },
		        el('span', { className: 'xq-hintRank' }, String(hint.rank + 1)),
		        el('span', { className: 'xq-hintZh' }, hint.zh === '' ? hint.iccs : hint.zh),
		        hint.score === null
		          ? null
		          : el('span', { className: 'xq-hintScore' }, formatScore(hint.score)),
		      ),
		    ),
		  );
		}
		
		/** 二次确认条（新对局 / 认输）。 */
		function ConfirmBar(props) {
		  return el(
		    'div',
		    { className: 'xq-confirm', role: 'group' },
		    el('span', { className: 'xq-confirmText' }, props.t(props.questionKey)),
		    el('button', { type: 'button', className: 'xq-btn xq-btnPrimary', onClick: props.onConfirm }, props.t('confirm.ok')),
		    el('button', { type: 'button', className: 'xq-btn', onClick: props.onCancel }, props.t('confirm.cancel')),
		  );
		}
		
		/**
		 * 面板主体。
		 *
		 * @param props - 槽注入的 `{ t, sessionId, xq }`，加上承载层补充的
		 *   `{ visible, signal, mode }`。主面板没有 `sessionId`，由外层用 `useSessions` 解析。
		 * @returns 面板元素。
		 */
		function XiangqiPanel(props) {
		  const t = props.t;
		  const xq = props.xq;
		  const sessionId = typeof props.sessionId === 'string' ? props.sessionId : null;
		  const cwd = typeof props.cwd === 'string' ? props.cwd : undefined;
		  const visible = props.visible !== false;
		  const mode = props.mode === 'main' ? 'main' : 'tab';
		
		  const rpc = React.useMemo(() => xq.game(sessionId, cwd), [xq, sessionId, cwd]);
		  const [projection, setProjection] = React.useState(null);
		  const [offline, setOffline] = React.useState(false);
		  const [notice, setNotice] = React.useState(null);
		  const [selected, setSelected] = React.useState(null);
		  const [cursor, setCursor] = React.useState(null);
		  const [hints, setHints] = React.useState(null);
		  const [reviewPly, setReviewPly] = React.useState(null);
		  const [confirmKind, setConfirmKind] = React.useState(null);
		  const [busy, setBusy] = React.useState(false);
		  const [ghosts, setGhosts] = React.useState([]);
		  const [undoGhost, setUndoGhost] = React.useState(null);
		  const [hiddenIndex, setHiddenIndex] = React.useState(null);
		  const [shake, setShake] = React.useState(null);
		  const [elapsed, setElapsed] = React.useState(0);
		  const [box, setBox] = React.useState({ width: 0, height: 0 });
		  const [turning, setTurning] = React.useState(null);
		  const fence = React.useRef(null);
		  const areaRef = React.useRef(null);
		  const alive = React.useRef(true);
		  const inFlight = React.useRef(null);
		
		  // ── 传输：所有结果都过 revision 栅栏，整体替换投影（§7.5.4 第 3 条） ──────────
		  const apply = React.useCallback((result) => {
		    if (!alive.current) return false;
		    if (result === null || typeof result !== 'object' || result.ok !== true) {
		      const error = result !== null && typeof result === 'object' && result.error ? result.error : {};
		      if (error.code === 'rpc/unavailable' || error.code === 'session/missing') {
		        setOffline(true);
		        return false;
		      }
		      const key = errorKeyOf(error.code);
		      setNotice({
		        key: key ?? 'status.rpcError',
		        params: key === null ? { message: error.message || error.code || 'unknown' } : {},
		        tone: 'error',
		      });
		      return false;
		    }
		    setOffline(false);
		    const decision = acceptProjection({ revision: fence.current }, result.projection);
		    if (!decision.accepted) return false;
		    fence.current = result.projection.revision;
		    setProjection(result.projection);
		    setSelected(null);
		    return true;
		  }, []);
		
		  const fetchState = React.useCallback(
		    async (signal) => {
		      if (sessionId === null) return;
		      const result = await rpc.state(signal);
		      if (signal !== undefined && signal.aborted) return;
		      apply(result);
		    },
		    [apply, rpc, sessionId],
		  );
		
		  // 进入面板 / 会话切换 / 重新可见 → 立即拉一次；不可见时零请求。
		  React.useEffect(() => {
		    if (sessionId === null || !visible) return undefined;
		    const controller = new AbortController();
		    inFlight.current = controller;
		    void fetchState(controller.signal);
		    return () => controller.abort();
		  }, [fetchState, sessionId, visible]);
		
		  // tab.signal 的 abort = 该 tab 的 occurrence 已销毁（关闭/折叠/卸载，§7.5.3）。
		  React.useEffect(() => {
		    const signal = props.signal;
		    if (signal === null || signal === undefined || typeof signal.addEventListener !== 'function') {
		      return undefined;
		    }
		    const onAbort = () => {
		      if (inFlight.current !== null) inFlight.current.abort();
		    };
		    signal.addEventListener('abort', onAbort);
		    return () => signal.removeEventListener('abort', onAbort);
		  }, [props.signal]);
		
		  React.useEffect(
		    () => () => {
		      alive.current = false;
		      if (inFlight.current !== null) inFlight.current.abort();
		    },
		    [],
		  );
		
		  const model = React.useMemo(() => {
		    const hostTargets = hasHostTargets(projection);
		    const fen = projection !== null && typeof projection.fen === 'string' ? projection.fen : '';
		    const fallback =
		      !hostTargets && selected !== null && fen !== '' && projection !== null
		        ? localTargets(fen, selected)
		        : undefined;
		    return deriveModel(projection, {
		      selected,
		      cursor,
		      hints,
		      reviewPly,
		      orientation: ORIENTATION,
		      fallbackTargets: fallback,
		    });
		  }, [projection, selected, cursor, hints, reviewPly]);
		
		  const polling = shouldPoll(projection, visible);
		
		  // 只在 pending === 'ai-thinking' 且可见时轮询：800 ms 起、×1.35、2 s 封顶、30 s 收工。
		  React.useEffect(() => {
		    if (!polling || sessionId === null) return undefined;
		    const loop = createPollLoop({
		      schedule: xq.schedule,
		      now: () => Date.now(),
		      onTick: () => {
		        void fetchState();
		      },
		      onExpired: () => {
		        setNotice({ key: 'status.pollTimeout', params: {}, tone: 'warn' });
		      },
		    });
		    loop.start();
		    return () => loop.dispose();
		  }, [polling, fetchState, sessionId, xq]);
		
		  // AI 已用时（1 s 一跳，只在可见且思考中）。
		  React.useEffect(() => {
		    if (!polling) {
		      setElapsed(0);
		      return undefined;
		    }
		    const started = Date.now();
		    const handle = window.setInterval(() => setElapsed(Date.now() - started), 1000);
		    return () => window.clearInterval(handle);
		  }, [polling]);
		
		  // 面板尺寸 → 几何（窄到 260 px 以下隐藏着法列表，§7.3）。
		  React.useEffect(() => {
		    const node = areaRef.current;
		    if (node === null || node === undefined) return undefined;
		    // 用**内容盒**而不是 clientWidth：棋盘区有内边距，按 clientWidth 算会让棋盘比可用
		    // 空间宽出两个 padding，右边被裁掉一点点（不出现滚动条，但也不叫「整体缩放」）。
		    const measure = (box) => {
		      const width = box === undefined ? node.clientWidth : box.width;
		      const height = box === undefined ? node.clientHeight : box.height;
		      setBox({ width: width ?? 0, height: height ?? 0 });
		    };
		    if (typeof ResizeObserver === 'undefined') {
		      measure();
		      return undefined;
		    }
		    const observer = new ResizeObserver((entries) => {
		      measure(entries.length > 0 ? entries[0].contentRect : undefined);
		    });
		    observer.observe(node);
		    measure();
		    return () => observer.disconnect();
		  }, []);
		
		  // 本地即时消息自动消失。
		  React.useEffect(() => {
		    if (notice === null) return undefined;
		    const handle = window.setTimeout(() => setNotice(null), NOTICE_MS);
		    return () => window.clearTimeout(handle);
		  }, [notice]);
		
		  // 提示着法 5 s 后消失（落子后也立刻消失）。
		  React.useEffect(() => {
		    if (hints === null) return undefined;
		    const handle = window.setTimeout(() => setHints(null), HINT_MS);
		    return () => window.clearTimeout(handle);
		  }, [hints]);
		
		  // 动画残影与抖动都是短命状态，到点就清。
		  React.useEffect(() => {
		    if (!visible) {
		      setGhosts([]);
		      setUndoGhost(null);
		      setHiddenIndex(null);
		      setShake(null);
		      return undefined;
		    }
		    if (ghosts.length === 0 && undoGhost === null && hiddenIndex === null) return undefined;
		    const handle = window.setTimeout(() => {
		      setGhosts([]);
		      setUndoGhost(null);
		      setHiddenIndex(null);
		    }, GHOST_MS);
		    return () => window.clearTimeout(handle);
		  }, [ghosts, undoGhost, hiddenIndex]);
		
		  React.useEffect(() => {
		    if (shake === null) return undefined;
		    const handle = window.setTimeout(() => setShake(null), SHAKE_MS);
		    return () => window.clearTimeout(handle);
		  }, [shake]);
		
		  // 投影增量 → 吃子/悔棋残影（纯表现，不影响任何判定）。
		  const previous = React.useRef(null);
		  React.useEffect(() => {
		    const now = {
		      revision: model.revision,
		      length: model.history.length,
		      board: model.board,
		      last: model.lastMove,
		    };
		    const before = previous.current;
		    previous.current = now;
		    if (before === null || before.revision === now.revision) return;
		    if (now.length > before.length && now.last !== null) {
		      const captured = before.board[now.last.to];
		      if (captured !== '' && captured !== undefined) {
		        setGhosts([{ index: now.last.to, piece: captured }]);
		      }
		      setHints(null);
		      return;
		    }
		    if (now.length < before.length && before.last !== null) {
		      const piece = before.board[before.last.to];
		      if (piece !== '' && piece !== undefined) {
		        setUndoGhost({ from: before.last.from, to: before.last.to, piece });
		        setHiddenIndex(before.last.from);
		      }
		    }
		  }, [model.revision, model.history.length, model.board, model.lastMove]);
		
		  // ── 交互意图 ─────────────────────────────────────────────────────────────
		  const reject = React.useCallback(
		    (code, from, to) => {
		      if (Number.isInteger(from)) setShake({ index: from, nonce: Date.now() });
		      const key = errorKeyOf(code);
		      // 引擎的人话原因只用在「这一步不合走子规则」上（「马腿被蹩」这类信息 UI 侧没有）。
		      // 而「不是你的回合」「本局已结束」「复盘只读」是**局面状态**，不是着法问题：
		      // 那几句必须走本地化文案，否则英文界面下会蹦出中文。
		      if (code === 'move.invalid' && Number.isInteger(from) && Number.isInteger(to)) {
		        const pre = precheckMove(model.fen, from, to);
		        if (pre !== null && pre.legal === false && typeof pre.reason === 'string' && pre.reason !== '') {
		          setNotice({ key: 'status.invalid', params: { reason: pre.reason }, tone: 'warn' });
		          return;
		        }
		      }
		      if (key !== null) setNotice({ key, params: {}, tone: 'warn' });
		      else setNotice({ key: 'error.unknown', params: {}, tone: 'warn' });
		    },
		    [model.fen],
		  );
		
		  const submitMove = React.useCallback(
		    (from, to) => {
		      if (sessionId === null) return;
		      setSelected(null);
		      setHints(null);
		      setBusy(true);
		      const controller = new AbortController();
		      inFlight.current = controller;
		      void rpc.move(from, to, iccsOf(from, to), controller.signal).then((result) => {
		        if (!alive.current) return;
		        apply(result);
		        setBusy(false);
		      });
		    },
		    [apply, rpc, sessionId],
		  );
		
		  const onIntent = React.useCallback(
		    (from, to) => {
		      if (Number.isInteger(to)) setCursor(to);
		      const decision = resolveIntent(model, from, to);
		      switch (decision.kind) {
		        case 'select':
		          setSelected(decision.index);
		          setNotice(null);
		          break;
		        case 'deselect':
		          setSelected(null);
		          break;
		        case 'inspect':
		          setSelected(decision.index);
		          setNotice({ key: 'status.notYourTurn', params: {}, tone: 'warn' });
		          break;
		        case 'reject':
		          reject(decision.code, decision.from, decision.to);
		          break;
		        case 'move':
		          submitMove(decision.from, decision.to);
		          break;
		        default:
		          break;
		      }
		    },
		    [model, reject, submitMove],
		  );
		
		  const onArrow = React.useCallback(
		    (dRow, dCol) => {
		      setCursor((current) => {
		        const base =
		          current !== null && current !== undefined
		            ? current
		            : model.hero === 'b'
		              ? model.board.lastIndexOf('k')
		              : model.board.indexOf('K');
		        const from = base < 0 ? 76 : base;
		        const next = stepCursor(from, dRow, dCol, ORIENTATION);
		        return next === null ? from : next;
		      });
		    },
		    [model.board, model.hero],
		  );
		
		  // ── 工具条动作 ───────────────────────────────────────────────────────────
		  const call = React.useCallback(
		    (method, onOk, onFail) => {
		      if (sessionId === null) return;
		      setBusy(true);
		      const controller = new AbortController();
		      inFlight.current = controller;
		      void method(controller.signal).then((result) => {
		        if (!alive.current) return;
		        const accepted = apply(result);
		        setBusy(false);
		        if (accepted) {
		          if (typeof onOk === 'function') onOk();
		        } else if (typeof onFail === 'function') {
		          onFail();
		        }
		      });
		    },
		    [apply, sessionId],
		  );
		
		  const doNew = React.useCallback(() => {
		    call(
		      (signal) => rpc.newGame(signal),
		      () => {
		        setHints(null);
		        setReviewPly(null);
		        setTurning(null);
		        setNotice({ key: 'status.newGame', params: {}, tone: 'info' });
		      },
		    );
		  }, [call, rpc]);
		
		  const doResign = React.useCallback(() => {
		    call((signal) => rpc.resign(signal));
		  }, [call, rpc]);
		
		  const doUndo = React.useCallback(() => {
		    call((signal) => rpc.undo(2, signal));
		  }, [call, rpc]);
		
		  const doFallback = React.useCallback(() => {
		    setNotice({ key: 'status.fallbackStarted', params: {}, tone: 'info' });
		    call((signal) => rpc.fallback(signal));
		  }, [call, rpc]);
		
		  const doHint = React.useCallback(() => {
		    if (sessionId === null) return;
		    setBusy(true);
		    const controller = new AbortController();
		    inFlight.current = controller;
		    void rpc.hint(3, controller.signal).then((result) => {
		      if (!alive.current) return;
		      setBusy(false);
		      if (result.ok !== true) {
		        const key = errorKeyOf(result.error?.code);
		        setNotice({
		          key: key ?? 'status.rpcError',
		          params: key === null ? { message: result.error?.message ?? '' } : {},
		          tone: 'error',
		        });
		        return;
		      }
		      const list = normalizeHints(result.value);
		      setHints(list);
		      setNotice({ key: 'status.hintShown', params: { count: list.length }, tone: 'info' });
		    });
		  }, [rpc, sessionId]);
		
		  const doCopy = React.useCallback(() => {
		    const text = recordText(
		      projection === null ? {} : { ...projection, initialFen: projection.initialFen ?? initialFen() },
		    );
		    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
		    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
		      setNotice({ key: 'status.copyFailed', params: {}, tone: 'error' });
		      return;
		    }
		    void clipboard.writeText(text).then(
		      () => setNotice({ key: 'status.copied', params: {}, tone: 'success' }),
		      () => setNotice({ key: 'status.copyFailed', params: {}, tone: 'error' }),
		    );
		  }, [projection]);
		
		  const enterReview = React.useCallback(
		    (ply) => {
		      setReviewPly(ply);
		      setSelected(null);
		      setHints(null);
		      if (sessionId === null) return;
		      // `review` 是可选端点：拿不到就只有本地重放，不报错。
		      void rpc.review().then((result) => {
		        if (!alive.current || result.ok !== true) return;
		        const value = result.value;
		        if (value !== null && typeof value === 'object' && Array.isArray(value.turningPoints)) {
		          setTurning(value.turningPoints.filter((n) => Number.isInteger(n)));
		        }
		      });
		    },
		    [rpc, sessionId],
		  );
		
		  const onKeyDown = React.useCallback(
		    (event) => {
		      if (reviewPly === null) return;
		      const total = model.history.length;
		      if (event.key === 'ArrowLeft') {
		        event.preventDefault();
		        setReviewPly(Math.max(0, reviewPly - 1));
		      } else if (event.key === 'ArrowRight') {
		        event.preventDefault();
		        if (reviewPly >= total) return;
		        const next = reviewPly + 1;
		        if (next >= total) {
		          setReviewPly(null);
		          setNotice({ key: 'status.live', params: {}, tone: 'info' });
		        } else {
		          setReviewPly(next);
		        }
		      }
		    },
		    [model.history.length, reviewPly],
		  );
		
		  // ── 渲染数据 ─────────────────────────────────────────────────────────────
		  const geometry = React.useMemo(() => computeGeometry(box.width, box.height), [box.width, box.height]);
		  // 复盘靠客户端重放：投影不带 initialFen（宿主只从标准局面开局），所以先完整重放一遍，
		  // 用它和宿主下发的棋盘对齐——不一致就说明起点不是标准局面，此时关掉复盘而不是显示错局面。
		  const history = model.history;
		  const fullReplay = React.useMemo(
		    () => (history.length === 0 ? null : replayToPly(initialFen(), history, history.length)),
		    [history],
		  );
		  const replayTrusted =
		    history.length === 0
		      ? true
		      : fullReplay !== null && sameBoard(fullReplay.board, model.board);
		  const replay =
		    reviewPly !== null && replayTrusted
		      ? reviewPly === history.length
		        ? fullReplay
		        : replayToPly(initialFen(), history, reviewPly)
		      : null;
		  const viewBoard = replay !== null ? replay.board : model.board;
		  const viewLast = replay !== null ? replay.lastMove : model.lastMove;
		  const emptyBoard = projection === null && offline ? initialBoard() : null;
		  const boardToRender = emptyBoard !== null ? emptyBoard : viewBoard;
		  const checkedKing =
		    model.checkSide === null || replay !== null ? null : kingIndex(boardToRender, model.checkSide);
		
		  const cellLabel = React.useCallback(
		    (index, piece) => {
		      const parts = cellLabelKeys(index, piece);
		      if (parts === null) return '';
		      const params = {};
		      for (const [name, key] of Object.entries(parts.params)) params[name] = t(key);
		      return t(parts.template, params);
		    },
		    [t],
		  );
		
		  const announcement = React.useMemo(() => {
		    if (model.history.length === 0) return '';
		    const last = model.history[model.history.length - 1];
		    const side = model.history.length % 2 === 1 ? 'red' : 'black';
		    const record = last !== null && typeof last === 'object' ? last : {};
		    let suffix = 'status.suffix.none';
		    if (record.mate === true) suffix = 'status.suffix.checkmate';
		    else if (record.check === true) suffix = 'status.suffix.check';
		    else if (model.checkSide !== null) {
		      suffix = model.phase === 'finished' ? 'status.suffix.checkmate' : 'status.suffix.check';
		    }
		    return t(`status.moved.${side}`, { zh: record.zh ?? '', suffix: t(suffix) });
		  }, [model.history, model.checkSide, model.phase, t]);
		
		  const line = statusLine(projection, {
		    offline,
		    elapsedMs: elapsed,
		    notice,
		  });
		
		  const rows = React.useMemo(() => moveRows(model.history), [model.history]);
		  const hintId = 'xq-cursor-hint';
		
		  if (sessionId === null) {
		    return el(
		      'div',
		      { className: mode === 'main' ? 'xq-root xq-inMain' : 'xq-root' },
		      el(StyleTag, null),
		      el(
		        'div',
		        { className: 'xq-empty' },
		        el(BoardGlyph, { size: 28 }),
		        el('span', null, t('status.rpcUnavailable')),
		      ),
		    );
		  }
		
		  return el(
		    'div',
		    { className: mode === 'main' ? 'xq-root xq-inMain' : 'xq-root', onKeyDown },
		    el(StyleTag, null),
		    el(PanelHeader, { t, model, projection }),
		    el('div', { className: 'xq-boardArea', ref: areaRef }, [
		      el(XiangqiBoard, {
		        key: 'board',
		        u: geometry.u,
		        orientation: ORIENTATION,
		        board: boardToRender,
		        selected: model.selected,
		        legalTargets: model.legalTargets,
		        lastMove: viewLast,
		        hints: model.hints,
		        checkSide: model.checkSide,
		        checkedKingIndex: checkedKing,
		        cursor: model.cursor,
		        ghosts,
		        undoGhost,
		        hiddenIndex,
		        shakeIndex: shake === null ? null : shake.index,
		        revision: model.revision,
		        animateDrop: visible && replay === null && undoGhost === null,
		        interactive: model.interactive && replay === null,
		        keyMode: replay === null ? 'cursor' : 'review',
		        label: t('board.label'),
		        hintId,
		        cellLabel,
		        onIntent,
		        onArrow,
		        onReview: (delta) => {
		          const total = model.history.length;
		          const next = Math.max(0, Math.min(total, (reviewPly ?? total) + delta));
		          setReviewPly(next);
		        },
		        onEscape: () => setSelected(null),
		      }),
		      el('p', { className: 'xq-sr', id: hintId, key: 'hint' }, t('board.cursorHint')),
		    ]),
		    el(StatusStrip, { t, line, announcement }),
		    el(HintRow, { t, hints: model.hints }),
		    confirmKind === null
		      ? null
		      : el(ConfirmBar, {
		          t,
		          questionKey: confirmKind === 'new' ? 'confirm.new' : 'confirm.resign',
		          onConfirm: () => {
		            const kind = confirmKind;
		            setConfirmKind(null);
		            if (kind === 'new') doNew();
		            else doResign();
		          },
		          onCancel: () => setConfirmKind(null),
		        }),
		    el(Toolbar, {
		      t,
		      model,
		      busy,
		      offline,
		      // 左栏图标只能选主面板、不能开右栏 tab（T15），所以两组入口各自只在对面出现。
		      hasSidebar: mode === 'main' && xq.hasSidebar === true,
		      hasMain: mode === 'tab' && xq.hasMain === true,
		      reviewable: replayTrusted,
		      onNew: () => {
		        if (model.phase === 'playing' && model.history.length > 0) setConfirmKind('new');
		        else doNew();
		      },
		      onUndo: doUndo,
		      onHint: doHint,
		      onFallback: doFallback,
		      onResign: () => setConfirmKind('resign'),
		      onCopy: doCopy,
		      onReview: () => {
		        enterReview(model.history.length);
		        setNotice({ key: 'status.reviewing', params: { n: model.history.length }, tone: 'info' });
		      },
		      onLive: () => {
		        setReviewPly(null);
		        setNotice({ key: 'status.live', params: {}, tone: 'info' });
		      },
		      onOpenSidebar: () => xq.openSidebar(),
		      onOpenMain: () => xq.openMain(),
		    }),
		    geometry.showMoveList
		      ? el(MoveList, {
		          t,
		          rows,
		          activeIndex: reviewPly,
		          turning,
		          disabled: rows.length === 0,
		          onJump: (ply) => {
		            enterReview(ply);
		            setNotice({ key: 'status.reviewing', params: { n: ply }, tone: 'info' });
		          },
		        })
		      : null,
		  );
		}
		
		/**
		 * 右栏 tab 的正文组件：槽级注入的 `useTabInfo()` 给 `{ sidebar, panel, tab }`，
		 * `sessionId` 由框架平铺注入（§7.1 的 props 契约）。
		 * @param props - 框架注入的 hook 集合 + `xq`。
		 * @returns 面板元素。
		 */
		function XiangqiTabBody(props) {
		  const info = props.useTabInfo();
		  // 会话工作区：宿主用它决定对局落盘位置，从而与命令/工具两条路径写到同一处。
		  const cwd = props.useSessions((state) => {
		    const session = state !== null && typeof state === 'object' ? state.byId[props.sessionId] : undefined;
		    return session === undefined || session === null ? undefined : session.cwd;
		  });
		  return el(XiangqiPanel, {
		    t: props.t,
		    xq: props.xq,
		    sessionId: props.sessionId,
		    cwd,
		    visible: info.tab.visible,
		    signal: info.tab.signal,
		    mode: 'tab',
		  });
		}
		
		/**
		 * tab 标题座位：只在标题里有意义，正文另注册（§7.1）。
		 * @param props - `{ t }`。
		 * @returns span 元素。
		 */
		function XiangqiTabTitle(props) {
		  return el('span', { className: 'xq-headerRow' }, el(BoardGlyph, { size: 14 }), el('span', null, props.t('tab.title')));
		}
		
		/**
		 * 主面板（root 作用域，拿不到 `sessionId`）。
		 *
		 * 按 §4.3 的做法用 `useSessions` 反查当前会话；查不到就显示只读空盘 + 提示，
		 * 而不是崩掉。头部让位由 `.xq-inMain` 负责（T15）。
		 * @param props - `{ t, xq }`。
		 * @returns 面板元素。
		 */
		function XiangqiMainPanel(props) {
		  const sessionId = props.useSessions(selectMainSessionId);
		  const cwd = props.useSessions((state) => {
		    if (typeof sessionId !== 'string') return undefined;
		    const session = state !== null && typeof state === 'object' ? state.byId[sessionId] : undefined;
		    return session === undefined || session === null ? undefined : session.cwd;
		  });
		  return el(XiangqiPanel, {
		    t: props.t,
		    xq: props.xq,
		    sessionId: typeof sessionId === 'string' ? sessionId : null,
		    cwd,
		    visible: true,
		    signal: undefined,
		    mode: 'main',
		  });
		}
		
		/**
		 * 左栏图标座位（与 `main` 的 key 配对使用）。
		 * @param props - owner props `{ size, active }`（窄栏 18、宽栏 16）。
		 * @returns span 元素。
		 */
		function XiangqiPanelIcon(props) {
		  const size = Number.isFinite(props.size) ? props.size : 16;
		  return el(
		    'span',
		    {
		      className: 'xq-panelIcon',
		      style: {
		        display: 'inline-flex',
		        color: props.active === true ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
		      },
		    },
		    el(BoardGlyph, { size }),
		  );
		}
		
			/* ==================== lib/ui/plugin.js ==================== */
		/**
		 * 浏览器半的装配层：`inject` + `apply(ctx)`。
		 *
		 * 免构建产物的运行时契约（§4.5、T3）在这里落地：
		 *
		 *  - 生成脚本把「引擎 + 本目录的 UI 源码」拼进一个 IIFE，`factory` 只做 `require('react')`
		 *    与 `return { inject, apply }`；
		 *  - `factory` 体内**零副作用**（bundle 会被 HMR 重新执行），所有注册都在 `apply(ctx)`
		 *    里用 `ctx.effect` / `ctx.slots.inject` 完成，disposer 由 Cordis 持有；
		 *  - `require` 只用于基线表的 `react`（官方规范明确劝阻 require 官方客户端 UI 包，T18）；
		 *  - 客户端到达宿主半只有 `ctx.connection.rpc.call('/xiangqi-mate', …)`（§7.5.3），
		 *    **没有** `host.call`（那是动态 Cordis 包的能力）。
		 *
		 * 三处承载（§4.3）：
		 *  ① 右栏 tab 类型（两阶段注册：类型声明 + 正文/标题座位）——主路径；
		 *  ② 主区域面板 `main` key `xiangqi` + 左栏 `sidebar.panellist` 同 id 图标——备选；
		 *  ③ 上述两者都会在默认页（「+ → 开始」）留下一个「象棋」入口卡片。
		 */
		
		
		/** tab 类型在 tab 系统中的唯一身份；它**同时**是正文/标题座位的 key。 */
		const TAB_ID = 'dsh-xiangqi-mate/xiangqi';
		/** 主面板的 key；`sidebar.panellist` 的 id 必须与它相同（T15）。 */
		const PANEL_KEY = 'xiangqi';
		
		/** Cordis 服务依赖：插槽与文案是硬依赖；`connection` / `sidebarRight` / `layout` 一律 ctx.get 判空。 */
		const inject = ['slots', 'locale', 'theme', 'timer', 'sidebarRightTabs'];
		
		/**
		 * 客户端插件主体。
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
		  ctx.effect(() => ctx.locale.register(LOCALE_NS, dicts), 'xiangqi: dictionaries');
		  const t = ctx.locale.bind(LOCALE_NS);
		
		  // 木色棋盘面走官方 overrideTokens；每个值必须是 { light, dark } 对（T8）。
		  // 组件里一律写成 var(--xiangqi-*, var(--dsw-alias-*))，令牌缺失时回落而不是崩。
		  //
		  // 取值不是随手挑的，`test/client/bundle.test.js` 里按 WCAG 相对亮度逐条校验：
		  //  - **棋子底盘必须够亮/够暗**，因为棋子字色来自主题（红方 = state-error-primary：
		  //    亮=red-600 #ec1313、暗=red-400 #f25a5a；黑方 = label-primary：亮≈#0f1115、暗≈#f9fafb）。
		  //    实测：白底盘 #ffffff 对 #ec1313 = 4.5:1（刚好达标），所以亮色下**不能用木色象牙白**
		  //    （#fdf7ea 只有 4.2:1），只能用纯白；暗色下 #2f261c 对 #f25a5a = 4.6:1。
		  //  - **网格线对棋盘面 ≥3:1**（非文本图形的下限），故亮色用 #8a6a44 而非更浅的木色。
		  ctx.effect(
		    () =>
		      ctx.theme.overrideTokens('dsh-xiangqi-mate', {
		        '--xiangqi-board-face': { light: '#f7e8ca', dark: '#241d16' },
		        '--xiangqi-river': { light: '#efdfc0', dark: '#2b231a' },
		        '--xiangqi-grid': { light: '#8a6a44', dark: '#7b6853' },
		        '--xiangqi-piece-face': { light: '#ffffff', dark: '#2f261c' },
		      }),
		    'xiangqi: board tokens',
		  );
		
		  // ── 通道①的客户端半边 ────────────────────────────────────────────────────
		  const connection = ctx.get('connection');
		  const rpcFace = connection !== undefined && connection !== null ? connection.rpc : undefined;
		  const call =
		    rpcFace !== undefined && typeof rpcFace.call === 'function'
		      ? (channel, endpoint, payload, signal) => rpcFace.call(channel, endpoint, payload, signal)
		      : null;
		
		  const runtime = {
		    /**
		     * 每个会话一个 RPC 客户端（宿主用 payload.sessionId 校验归属，§7.5.3 约束 4）。
		     * @param sessionId - 会话 id。
		     * @param cwd - 会话工作区，宿主据此决定落盘位置（与命令/工具路径一致）。
		     */
		    game: (sessionId, cwd) => createGameRpc({ call, sessionId, cwd }),
		    /** 轮询计时器走 ctx.timer（随 fiber 自动释放，§7.5.3）。 */
		    schedule: (callback, delayMs) => {
		      const timer = ctx.get('timer');
		      if (timer !== undefined && timer !== null && typeof timer.timeout === 'function') {
		        return timer.timeout(callback, delayMs);
		      }
		      const handle = globalThis.setTimeout(callback, delayMs);
		      return () => globalThis.clearTimeout(handle);
		    },
		    hasSidebar: ctx.get('sidebarRight') !== undefined,
		    hasMain: ctx.get('layout') !== undefined,
		    /** 从主面板跳回右栏 tab（左栏图标做不到这件事，T15）。 */
		    openSidebar: () => {
		      const sidebar = ctx.get('sidebarRight');
		      if (sidebar === undefined || sidebar === null) return;
		      try {
		        sidebar.openTab('xiangqi');
		      } catch {
		        /* 没有选中会话时 openTab 会抛：这是用户态，不该冒泡成插件错误 */
		      }
		    },
		    /** 从右栏 tab 切到主面板。 */
		    openMain: () => {
		      const layout = ctx.get('layout');
		      if (layout === undefined || layout === null) return;
		      try {
		        layout.selectPanel(PANEL_KEY);
		      } catch {
		        /* key 未注册（例如主面板座位被别的插件顶掉）时静默 */
		      }
		    },
		  };
		
		  /**
		   * 槽注入面。
		   *
		   * session 作用域会收到 `(sessionId, actions)`，root 作用域只收到 `(actions | undefined)`；
		   * 用「第一个参数是不是字符串」区分，避免给两种作用域各写一份。
		   */
		  const injectRuntime = (keyOrActions) => ({
		    xq: runtime,
		    sessionKey: typeof keyOrActions === 'string' ? keyOrActions : undefined,
		  });
		
		  // ── ① 右栏 tab 类型：类型声明（无运行时钩子）+ 引导页入口 ────────────────────
		  ctx.effect(
		    () =>
		      ctx.sidebarRightTabs.register({
		        id: TAB_ID,
		        kind: 'xiangqi',
		        priority: 'extension',
		        title: () => t('tab.title'),
		        guide: [
		          {
		            id: 'xiangqi',
		            order: 100,
		            title: () => t('guide.title'),
		            description: () => t('guide.description'),
		          },
		        ],
		      }),
		    'xiangqi: sidebar tab type',
		  );
		
		  // ② 正文与标题座位：key 必须等于上面的类型 id；声明 locale 才会拿到 t。
		  //    注意不要重复包 ctx.effect —— ctx.slots.register 内部已经包了（T9）。
		  ctx.slots.inject('sidebar.right.pane.tab', () =>
		    ctx.slots.register(
		      { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: LOCALE_NS, inject: injectRuntime },
		      XiangqiTabBody,
		    ),
		  );
		  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
		    ctx.slots.register(
		      { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: LOCALE_NS },
		      XiangqiTabTitle,
		    ),
		  );
		
		  // ── 备选承载：主区域面板 + 左栏图标（id 与 main 的 key 必须一致） ─────────────
		  ctx.slots.inject('main', () =>
		    ctx.slots.register(
		      { name: 'main', key: PANEL_KEY, locale: LOCALE_NS, inject: injectRuntime },
		      XiangqiMainPanel,
		    ),
		  );
		  ctx.slots.inject('sidebar.panellist', () =>
		    ctx.slots.register(
		      {
		        name: 'sidebar.panellist',
		        id: PANEL_KEY,
		        order: 100,
		        locale: LOCALE_NS,
		        label: () => t('panel.title'),
		      },
		      XiangqiPanelIcon,
		    ),
		  );
		}

		/* 只登记：所有资源注册都在 apply(ctx) 里用 ctx.effect / ctx.slots.inject 完成。 */
		return { inject, apply };
	})();
}});
