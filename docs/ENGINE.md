# 棋规引擎 API 手册 · dsh-xiangqi-mate

> `lib/engine/**` 是**纯函数、零依赖**的中国象棋规则引擎。它 import 的东西只有同目录的兄弟文件——没有 DSH 包、没有第三方包、没有 `node:*`。因此它既能作为普通 ESM 在 Node 里用，也能被原样内联进浏览器（`lib/client.js` 就是这么生成的）。

对应设计文档：[DESIGN.md](DESIGN.md) §5。验证记录：[VERIFICATION.md](VERIFICATION.md) §1.6。

```js
import {
  initialPosition, generateMoves, applyMove, isLegalMove, gameStatus,
  positionFromFen, positionToFen, formatChinese, parseAnyMove,
  describePosition, evaluate, searchBestMove,
} from 'dsh-xiangqi-mate/lib/engine/index.js'
```

---

## 1. 坐标与记号（先读这一节）

**内部索引**：`index = row * 9 + col`，共 90 格。

| 轴 | 取值 | 方向 |
| --- | --- | --- |
| `row` | `0` → `9` | **`0` = 黑方底线（屏幕上方）**，`9` = 红方底线（下方）。红方「前进」= `row` 减小 |
| `col` | `0` → `8` | `0` = 屏幕最左列 |

**ICCS**（对外坐标）：列 = `'a' + col`（`a`–`i`，红方视角从左到右），行 = `9 - row`（红方底线为 `0`）。例：红方右炮初始位 = `h2`（内部 `row 7, col 7` = 索引 `70`）。

**FEN 方言**——中国象棋 FEN 有两套字母，本项目**两套都读、只写一套**：

| 方言 | 马 | 象 | 说明 |
| --- | --- | --- | --- |
| `n/b` | `n` | `b` | 本项目的**导出**方言（XQBase 等通行） |
| `h/e` | `h` | `e` | Chess Programming Wiki 的 perft 用例采用 |

`positionFromFen` 导入时自动把 `h→n`、`e→b` 归一化；`positionToFen` 只输出 `n/b`。**混用会导致静默错盘**，所以不要在调用方自己做这件事。

**中文记谱**：红方用中文数字、**从红方右手边数起**（`col 8 → 一` … `col 0 → 九`）；黑方用阿拉伯数字、从黑方右手边数起（`col 0 → 1` … `col 8 → 9`）。直行子（车/炮/兵/将）的「进/退」报**步数**，斜行子（马/相/仕）报**目标文件号**。

**将帅照面是「被将军」的一种**：两将同列且中间无子时局面非法。**任何**移动只要走成照面就会被拒——构造测试局面时务必先检查 e 线有没有挡住，否则会误判成引擎 bug（我们自己在验收里踩过两次）。

---

## 2. 数据结构

```js
/** 棋子字符；'' 表示空格。红方大写、黑方小写。 */
/** @typedef {'K'|'A'|'B'|'N'|'R'|'C'|'P'|'k'|'a'|'b'|'n'|'r'|'c'|'p'|''} Piece */

/** @typedef {object} Position
 *  @property {Piece[]} board   长度 90（row*9+col）
 *  @property {'r'|'b'} turn    当前走子方
 *  @property {number} halfmove 距上次吃子的半回合数（自然限着用）
 *  @property {number} fullmove 回合数，从 1 起
 */

/** @typedef {object} Move
 *  @property {number} from 0..89
 *  @property {number} to   0..89
 */
```

`Position` 是**纯数据、可 JSON 序列化**；`applyMove` 返回**新对象**，绝不修改入参（已用测试钉住）。

---

## 3. API

### 3.1 局面

| 函数 | 返回 | 说明 |
| --- | --- | --- |
| `initialPosition()` | `Position` | 标准开局（每次返回新对象） |
| `positionFromFen(fen)` | `Position` | **非法时抛 `PositionError`**（唯一允许抛的入口） |
| `positionToFen(pos)` | `string` | 只输出 `n/b` 方言 |
| `clonePosition(pos)` | `Position` | 深拷贝 board |
| `isValidPosition(pos)` | `boolean` | 结构校验，不抛 |
| `positionKeyOf(pos)` / `fenKeyOf(fen)` | `string` / `string\|null` | 同型键（棋盘 + 走子方），重复局面判定用 |
| `START_FEN` | `string` | 标准开局 FEN |

### 3.2 着法生成与合法性

| 函数 | 返回 | 说明 |
| --- | --- | --- |
| `generateMoves(pos)` | `Move[]` | **合法**着法（已过滤送将/照面/挡将） |
| `pseudoLegalMoves(pos)` | `Move[]` | 只按棋子走法生成，不过滤送将 |
| `isLegalMove(pos, move)` | `boolean` | |
| `moveRejectReason(pos, move)` | `string \| null` | **中文人话**原因；合法返回 `null` |
| `moveRejectCode(pos, move)` | `string \| null` | 机器码（如 `blocked-path`、`cannon-screen-missing`） |
| `applyMove(pos, move)` | `Position` | **不校验合法性**；调用前请自行 `isLegalMove` |
| `collectLegalMoves(board, side, out)` / `collectPseudoMoves(...)` | 整数编码着法 | 低层入口，给搜索/热路径用（避免对象分配） |
| `encodeMoveCode(from,to)` / `decodeMoveFrom(code)` / `decodeMoveTo(code)` | 整数 / 索引 | 着法编码（`from \| to << 7`） |

### 3.3 局面状态

```js
gameStatus(pos, history?) → {
  state: 'playing'|'check'|'checkmate'|'stalemate'|'draw-repetition'|'draw-fifty'|'draw-perpetual-check',
  winner: 'r'|'b'|null,
  reason: string,      // 机器码
  reasonZh: string,    // 中文
}
```

- `isInCheck(pos, side?)` → `boolean`（省略 `side` 表示当前走子方）
- `countRepetition(pos, history)` / `findPerpetualChecker(pos, history)`
- `FIFTY_MOVE_HALFMOVES` 默认阈值（120 半回合 = 60 回合无吃子）

> **两条容易被忽略的中国象棋规则**：**困毙判负**（无合法着法且未被将军 → **该方负**，不是和棋）；**长将判负**（连续将军构成重复局面时，长将方负）。

### 3.4 记谱

| 函数 | 返回 | 说明 |
| --- | --- | --- |
| `moveToIccs(move)` | `string` | 索引 → `'h2e2'` |
| `iccsToMove(pos, iccs)` | `Move \| null` | **按合法性校验**：只在 `generateMoves(pos)` 里找唯一匹配；几何合法但会送将/照面、或格式越界 → `null` |
| `formatChinese(pos, move)` | `string` | 生成中文记谱，含 `前/后/中` **与多兵序号**消歧 |
| `parseChinese(pos, text)` | `{move}` 或 `{error, candidates?}` | 只在合法着法集合里匹配；0 个 → `error`，多于 1 个 → `error` + `candidates`（**绝不静默任选**） |
| `parseAnyMove(pos, text)` | `{move}` 或 `{error}` | 自动识别 ICCS / 中文；容错空格、全角数字与常见标点 |
| `zhMoveParts(pos, move)` | 结构体 | 记谱分解（棋子、动作、目标、消歧序号…），解析器与测试用 |

### 3.5 局面描述与评估

```js
describePosition(pos, {
  includeMoves = true,   // 合法着法目录（ICCS + 中文）
  includeEval  = false,  // 评估摘要
  ascii        = true,   // ASCII 棋盘
  maxMoves     = 80,     // 目录上限，超出按「吃子 > 将军 > 其它」截断并注明
}?) → string
```

输出是**单个字符串**（模型与人都直接读），固定六段：局面头 → ASCII 棋盘（含中文文件号双标与**图例**）→ FEN → 上一手 → 状态 → 评估 → 合法着法目录。这是**工具返回给模型的唯一渲染源**，也是 `xiangqi_board` 的正文。

```js
evaluate(pos) → {
  score: number,            // 正值 = 对当前走子方有利（厘兵）
  breakdown: [{ id, nameZh, score, detailZh }],   // 逐项可解释
  summaryZh: string,        // 一句中文结论
}
legalMoveCatalog(pos) → [{ iccs, zh, capture }]
materialDiffZh(board)   → string          // 子力对比（人话）
renderAsciiBoard(board) → string
```

### 3.6 本地搜索

```js
searchBestMove(pos, {
  depth   = 4,     // 迭代加深的深度上限
  timeMs  = 300,   // 时间上限；与 depth 双限，取先到者
  seed    = 1,     // 同 seed + 同深度 → 同结果（同分着法按 seed 决定的顺序挑选）
}?) → { move: Move|null, score: number, depth: number, nodes: number, pv: string[] }
```

- **`move` 一定落在 `generateMoves(pos)` 内**（这是 `xiangqi_hint` 与本地兜底的正确性底线）；
- 无合法着法 → `{ move: null, depth: 0 }`，**不抛异常**；
- 时限截断时返回**上一轮完整迭代**的结果，绝不返回半轮；
- `score` 为**走子方视角**。

### 3.7 坐标与棋子工具

`squareToIccs` / `iccsToSquare` / `rcToIdx` / `idxToRow` / `idxToCol` / `isOnBoard` / `colToFileNumber` / `fileNumberToCol` / `fileNumberText` / `countText` / `zhDigitValue` / `hasCrossedRiver` / `isInPalace` / `oppositeSide` / `colorOfPiece` / `pieceNameZh` / `sideNameZh` / `isPieceChar` / `normalizeFenDialect` / `kingsFaceOnBoard` / `isSquareAttacked` / `isSquareAttackedBy` / `findKingIndex` / `horseLegIndex` / `makeMoveOnBoard` / `unmakeMoveOnBoard` / `toMoveObjects`

常量：`BOARD_SIZE`(90) / `BOARD_ROWS`(10) / `BOARD_COLS`(9) / `RED_SIDE` / `BLACK_SIDE` / `PIECE_BASE_VALUE` / `MOVE_REJECT_ZH` / `SEARCH_LIMITS` / `BOARD_LEGEND`。

---

## 4. 用法示例

```js
import { initialPosition, generateMoves, applyMove, formatChinese, parseAnyMove, gameStatus, searchBestMove } from 'dsh-xiangqi-mate/lib/engine/index.js'

let pos = initialPosition()
console.log(generateMoves(pos).length)          // 44
console.log(formatChinese(pos, { from: 70, to: 67 }))   // 炮二平五

// 用中文记谱走子（模型可以直接这么说）
const parsed = parseAnyMove(pos, '炮二平五')
if (parsed.move) pos = applyMove(pos, parsed.move)

// 换黑方走
const best = searchBestMove(pos, { depth: 4, timeMs: 300, seed: 7 })
if (best.move) pos = applyMove(pos, best.move)

console.log(gameStatus(pos).reasonZh)
```

**注意**：`applyMove` 不校验合法性。要接受外部输入（模型、用户、棋谱文件）时，一律先走 `parseAnyMove` / `isLegalMove`。

---

## 5. 验证

| 项目 | 命令 | 基准 |
| --- | --- | --- |
| perft（初始局面） | `node scripts/perft.mjs --depth 4` | 44 / 1,920 / 79,666 / **3,290,240**，且 checks（0/6/384/19380）与 captures（2/72/3159/115365）逐列吻合 |
| 中残局 perft | `node scripts/perft.mjs --positions` | CPW Position 2/5/8 的 depth 1–4 逐项相等 |
| 规则反例集 | `node --test test/engine/*.test.js` | 蹩马腿/塞象眼/炮 0-1-2 架/送将/照面/兵过河/**困毙判负**/将死 |
| 记谱往返 | `node --test test/engine/*.test.js` | 红黑各半的 ≥40 手真实棋谱，`formatChinese → parseChinese` 逐手恒等 |
| 端到端冒烟 | `node scripts/xiangqi-cli.mjs play --moves 60` | 引擎自战 60 手，全程无非法着法，输出中文棋谱 |

> **关于 CPW 的 Checkmates 列**：本实现在 Position 2/5/8 上得到的 `mates` 恰好等于 CPW 表中**下一层**的值，而同一次运行的 nodes/checks/captures 与 CPW 当前层完全相等（三个局面都成立，误差 0）。因此 `scripts/perft.mjs` 的 mates 基准按 `mates(d) = cpwMates(d+1)` 对齐。**这是基于证据的实现观察，不是对 CPW 表格的断言**；初始局面的 mates 在 depth 1–4 恒为 0，不受影响。

---

## 6. 与设计文档的偏离

| 偏离 | 原因 |
| --- | --- |
| `perft` **不在** `lib/engine` 导出，移到 `scripts/perft.mjs` | §11-R8 的单文件 ≤300 行门禁下 `moves.js` 放不下（现 289 行） |
| `moveRejectCode` / `moveRejectReason` / `isLegalMove` / `kingsFaceOnBoard` 落在 `rules.js` 而非 `moves.js` | 同上：行数门禁；语义面不变，`index.js` 照常导出 |
| 公开面从 §5.3 的 24 个扩到 **79 个导出** | 宿主半与浏览器半需要底层工具（编码、棋盘变换、常量）；§5.3 是**最小契约**，不是上限 |
| 引擎内部**允许同目录相对 import** | 浏览器内联时由构建脚本剥掉；ESM 下 Node 才能正常加载（§9.3 只禁裸模块说明符） |

## 7. 若要内联进浏览器

`scripts/build-client.mjs` 按固定顺序读取这 8 个文件并剥掉行首的 `import`/`export`：

```
coords → fen → moves → rules → notation-zh → eval → describe → search
```

（`index.js` **不参与**内联。）因此新增引擎文件时必须同时满足：**import/export 写在行首单行**、**顶层标识符全局唯一**。构建脚本已把这两条做成生成前的自检——违反会直接失败，而不是留到浏览器里白屏。
