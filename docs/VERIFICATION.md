# 验证记录 · dsh-xiangqi-mate

本文件是**实测记录**，不是设计文档。每一项都要有可复现的命令与原始输出，写"已测试"不算通过。

- 记录格式：`日期 · DSH 版本 · 结论 · 证据（命令 + 输出尾部 / 截图文件名）`
- 环境基线：macOS arm64 · Node `>=20.11` · DSH `0.2.0-rc.2`（`hostProtocolVersion: 4`）· desktop profile
- 对应验收项见 [DESIGN.md](DESIGN.md) §9（测试与验收）与 §12.4（手工 UI 用例表）

---

## 0. 环境快照

| 项 | 值 | 采集方式 |
| --- | --- | --- |
| 日期 | _待填_ | — |
| DSH 版本 | _待填_ | `dsh --version` 或 `app.asar` 的 `dsh/package.json` |
| Node 版本 | _待填_ | `node --version` |
| profile | _待填_ | `echo $DSH_PROFILE` |
| 安装方式 | `plugin_manager install_bundle` | §12.6-A |

---

## 1. 静态门禁与仓库自测（不需要 DSH）

| # | 检查 | 命令 | 期望 | 实测 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1.1 | 静态边界门禁 | `node scripts/check-boundaries.mjs` | 全部通过 | _待填_ | ⬜ |
| 1.2 | 单元测试 | `node --test` | 全绿 | _待填_ | ⬜ |
| 1.3 | 覆盖率 | `node --test --experimental-test-coverage` | 引擎行 ≥90% / 分支 ≥85% | _待填_ | ⬜ |
| 1.4 | 客户端产物一致性 | `node scripts/build-client.mjs --check` | 无差异 | _待填_ | ⬜ |
| 1.5 | 客户端语法 | `node --check lib/client.js` | 无输出 | _待填_ | ⬜ |
| 1.6 | 引擎基准 perft | `node scripts/perft.mjs --depth 4` | 44 / 1920 / 79666 / 3290240 | **✅ 完全一致**（见 1.6.1） | ✅ |
| 1.7 | 引擎规则独立复核 | 见 1.6.2 | 20/20 | **✅ 20/20**（见 1.6.2） | ✅ |
| 1.8 | 引擎自战冒烟 | `node scripts/xiangqi-cli.mjs play --moves 60` | 退出码 0，全程无非法着法，中文记谱可读 | _待填_（等 `searchBestMove`/`describePosition` 落地） | ⬜ |
| 1.9 | 打包体积 | `npm pack --dry-run` | tarball ≤ 300 KB（NFR8） | _待填_ | ⬜ |
| 1.10 | 宿主半契约（假 ctx 驱动 `lib/index.js`） | 见 1.6.4 | 22/23（唯一失败是预期的引擎未就绪） | **✅ 22/23** | ✅ |
| 1.11 | 客户端纯逻辑（栅栏/派生/意图/轮询） | 见 1.6.5 | 40/40 | **✅ 40/40** | ✅ |
| 1.12 | **免构建客户端产物的端到端契约** | 见 1.6.6 | 30/30 | **✅ 30/30** | ✅ |
| 1.13 | 人类走子路径（`connection.rpc` → 对局服务） | 见 1.6.7 | 待 M2 修复接缝后复跑 | **⚠️ 18/24（1 个真问题 + 5 连锁）** | ⚠️ |
| 1.14 | 宿主投影 → 客户端模型（跨流契约，含索引一致性） | 见 1.6.9 | 26/27 | **⚠️ 26/27（1 个真 bug）** | ⚠️ |

### 1.6.6 免构建客户端产物：模拟浏览器运行时端到端验证

**这是风险 R2（客户端产物契约变化导致浏览器半不执行）唯一的端到端检验。** 单元测试与 `node --check` 都发现不了"产物形状不对 → 页面白屏"这类问题。

方法：用 `node:vm` 造最小浏览器环境（`window` / `document` / `__ModuleLoader__`），以 **classic script** 方式执行 `lib/client.js`，再用 React stub 走完 `factory(require)` → `apply(ctx)`，捕获全部注册。**30/30 通过**：

| 检查组 | 断言 | 结果 |
| --- | --- | --- |
| 产物形态 | 不含 ESM `import`/`export`；能以 classic script 执行（无语法/顶层错误） | ✅ |
| 登记契约 | 恰好登记一个 bundle；`id === 'dsh-xiangqi-mate'`；提供 `factory` | ✅ |
| 模块解析 | 只 `require` 了基线表内的 `react` / `react/jsx-runtime`；其余一律不 require | ✅ |
| 插件形态 | `factory` 返回的对象有 `apply`、**无 `__esModule`**、**无 `default` 包装**（否则 Loader 会折叠并丢 `inject`） | ✅ |
| 承载注册 | 右栏 tab 类型（`kind='xiangqi'`、唯一 `id`、`title()`、**`guide` 入口**）；`sidebar.right.pane.tab` 正文且**经 `slots.inject` 等待父声明**；主面板 `main`；左栏 `sidebar.panellist` | ✅ |
| 国际化 | 注册 locale 字典且 **`zh` 与 `en` 键集完全一致** | ✅ |
| 主题 | 使用 `overrideTokens`，且**每个值都是 `{light,dark}` 对**（否则宿主会抛教学错误）、自定义 token 带 `--xiangqi-` 前缀 | ✅ |
| 红线 | 无 `host.call`；无 `styles.insert`；无 `require('@deepseek-ai/…')`；无 `session.append` | ✅ |

### 1.6.7 人类走子路径（RPC）复核 — 发现一个跨流接缝 bug

用假 ctx 捕获宿主侧注册的 `connection.rpc` handler，直接以浏览器半的形状调用。**18/24 通过，6 条失败全部指向同一个根因**：

| 断言 | 结果 |
| --- | --- |
| 频道名 `/xiangqi-mate`；缺 `sessionId` → `BAD_SESSION` | ✅ |
| `state` 返回投影，含 `revision` / 90 格 `board` / `legalTargets` / `hero`+`turn`+`pending` | ✅ |
| `move { move: 'h2e2' }`（ICCS 字符串） | ✅ 落子成功 |
| **`move { from: 70, to: 67, iccs: 'h2e2' }`（客户端实际发送的形状）** | ❌ **`ILLEGAL_MOVE / 缺少着法`** |
| 其后的 `turn === 'b'` / `pending === 'ai-thinking'` / 中文记谱 / `lastMove.from,to` | ❌ 连锁失败（上一步未成功） |
| 连走两手 → `NOT_YOUR_TURN` 且附合法着法目录 | ❌ 连锁失败 |
| `hint` / `review` / `fallback` / `resign` / 未知端点结构化错误 | ✅ |
| 工具不许替人类方走子（`NOT_YOUR_TURN`，§4.4.4 协议错误） | ✅ |
| 棋谱落盘（`initialFen` + 紧凑 `moves`，不含每步整盘） | ✅ |

**根因（跨 agent 接缝）**：M3 的 `lib/ui/rpc.js` 发送 `{ from, to, iccs }`，而 M2 的 `lib/game/api.js` 只读 `payload.input ?? payload.move`——两边的字段名对不上，`iccs` 也未被读取。**设计 §7.5.3 写的本来就是 `move { from, to }`**（投影是索引制的）。已要求 M2 让 RPC 的 `move` 接受 `move` → `iccs` → `{from,to}` 三种形状，并让工具与 RPC 共用同一套输入解析。

> **教训**：这是本次唯一由「两个 agent 各写一半」产生的真实缺陷。**接口在文档里冻结过、但落成代码时两边各自选了"看起来合理"的字段名**。这里的教训是：跨流边界的**具体载荷形状**（字段名，而不只是语义）必须逐字写进契约并在集成前用真实调用打通一次——单元测试各自全绿也拦不住它。

### 1.6.8 另一个由 M2 自己的测试抓到的真 bug（Config）

`test/contracts/config.test.js` 的「可选字符串键」用例失败，根因是实现问题：

```js
for (const [key, value] of Object.entries(provided)) {
  if (!(key in out[group])) continue;   // provider/model/reasoningEffort 不在 DEFAULTS，全被跳过
}
```

`DEFAULTS.opponent` 未包含 `provider` / `model` / `reasoningEffort`，导致**这三个键永远无法通过配置设置**，直接废掉 FR24（对手模型可配）与 §4.4.2 的第一优先级（Config 显式覆盖）。**我的 RPC 冒烟没覆盖到这条，M2 自己的测试抓到了**——这正是"实现者自测 + 独立复核"两层都要有的理由。

### 1.6.5 客户端纯逻辑独立复核

一次性脚本（`/tmp`，不进仓库），**40/40 通过**。这些是浏览器半里最容易出错、又最难靠肉眼发现的部分：

| 分组 | 断言 | 结果 |
| --- | --- | --- |
| **revision 栅栏**（§7.5.4-3） | 更大 → `accepted/newer`；**相同 → `duplicate` 丢弃**；更小 → `stale` 丢弃；首个 → `first`；结构非法 → `malformed` 且 `projection === null` | ✅ |
| **派生模型**（§7.2） | 棋盘归一为 90 格；未选中时可走点为空；选中后取**宿主下发**的 `legalTargets`；`hostTargets` 正确标识；`interactive` 在「轮到对方 / AI 思考中 / 复盘 / 终局」四种情形下都为 false；`checkSideOf` 只在 `status.state === 'check'` 时给出被将军方 | ✅ |
| **意图归约**（§7.4） | `select` / `deselect` / `move` / `reject(move.invalid)` / `reject(move.not-your-turn)` / `reject(game.review)` / `reject(game.finished)` / `noop` / `inspect` 九种分支全部命中 | ✅ |
| **键盘光标**（§7.4） | 红方视角「屏幕上 = row−1」；**黑方视角反向映射**（翻盘后方向键不颠倒）；移出棋盘返回 null | ✅ |
| **轮询退避**（§7.5.3） | 序列 800 ms 起、×1.35、**2000 ms 封顶**；`pollExpired` 严格按 30 s；**超时只回调一次 `onExpired` 并自行停止**；`start()` 幂等（不叠加计时器）；`dispose()` 后不可重启 | ✅ |

**过程中两次失败都是我自己的测试写错了**，实现是对的，且这两处恰好说明了它的设计用意：

1. 轮询的调度器是**注入式** `schedule(callback, delayMs) → cancel`（与 `ctx.timer.timeout` 同形，随 fiber 释放），不是 `setTimeout/clearTimeout`——可测性正是为此设计的；
2. 我第一次用「同步回调」的假调度器，触发了 `cancel` 赋值被外层帧覆盖的假象。**真实 `ctx.timer.timeout` 是异步回调**，把假调度器改成「入队 + 排空」后全部通过。这条记在这里：写客户端计时器测试时不要用同步回调的假调度器。

### 1.6.4 宿主半入口契约独立复核（M2 里程碑门）

一次性脚本（`/tmp`，不进仓库）**不依赖 M2 自己的测试**，直接用假 ctx 调用 `lib/index.js`，**22/23 通过**：

| 检查组 | 断言 | 结果 |
| --- | --- | --- |
| 导出形态 | `name === 'xiangqi'`、`inject === ['tools']`、**无 default 导出**、`Config` 是 StandardSchemaV1 | ✅ |
| Config 四分支 | `validate({})` → 默认值；非法 `mode` → `issues`；越界 `depth: 99` → `issues`；非对象输入 → `issues`（**不抛异常**） | ✅ |
| 工具注册 | 恰好 6 个、名字集合正确、每个都有 `parameters` + `output.schema` + `output.render` + `execute` | ✅ |
| 并发标注 | **只有** `xiangqi_board` 声明 `isConcurrencySafe`（改状态的工具必须串行） | ✅ |
| 命令 | `/xiangqi` 注册成功且 handler 存在 | ✅ |
| 释放 | `dispose()` 注销全部工具与命令，且**幂等**（连调两次不抛） | ✅ |
| 一局流程 | `new → move(ICCS) → board → move(中文记谱) → undo → hint` | ⏳ **唯一失败** |

唯一失败的**原因**本身是个好信号：M2 的引擎适配器检测到引擎 API 未齐时，抛出的是清晰的中文错误而不是崩溃——

```
象棋引擎不可用：象棋引擎尚未就位（引擎缺少 API: moveToIccs, iccsToMove,
formatChinese, parseChinese, parseAnyMove, describePosition, legalMoveCatalog,
evaluate, searchBestMove）
```

这说明「插件在引擎半成品时仍能装载、工具仍注册、只在真正需要时才报错」这一设计（`lib/game/engine.js` 用动态 import 而非顶层 import）确实生效了。待 M1 补齐 `index.js` 的再导出与 `search.js` 后复跑，应转为 23/23。

### 1.6.1 perft 基准实测（M1 关键验收）

命令：`node scripts/perft.mjs --depth 4`（初始局面，CPW 基准见 DESIGN.md §5.8.1）

```
depth      nodes    checks  captures     mates        耗时
    1          44        0         2         0       0.7 ms
    2       1,920        6        72         0       2.9 ms
    3      79,666      384      3159         0      17.0 ms
    4   3,290,240    19380    115365         0     572.8 ms

校验：与 CPW 基准完全一致 ✅
```

**结论**：不只是节点数一致——`checks`（将军数）与 `captures`（吃子数）两列也逐一吻合，说明走法生成与将军判定同时正确，而不是"数量凑巧相同"。走法生成层可以信任。

### 1.6.2 规则层独立复核（不依赖 M1 自己的测试）

脚本一次性写在 `/tmp`（不进仓库），直接用公开 API 断言 20 项，覆盖面正是「不看就会写错」的那些点：

| 覆盖点 | 用例 | 结果 |
| --- | --- | --- |
| 开局合法性 | 44 个合法着法；`h2e2`（炮二平五）、`b0c2`（马二进三）合法 | ✅ |
| 蹩马腿 | `b0d1` 被拒（马腿被 c0 的相蹩住），原因正确 | ✅ |
| 塞象眼 | 象眼空时 `c0e2` 合法；在 d1 塞子后被拒 | ✅ |
| 炮 | **0 架吃子被拒**；**恰好 1 架吃子合法**；**2 架吃子被拒** | ✅ |
| 送将 | 移开挡线的车被拒 | ✅ |
| 将帅照面 | 帅移入与将同列被拒 | ✅ |
| 兵/卒 | 未过河不能横走；过河后可横走 | ✅ |
| **困毙判负** | 黑方未被将军且无着法 → `state=stalemate, winner=红`（**不是和棋**，§5.4 的关键差异点） | ✅ |
| 将死 | 被将军且无着法 → `state=checkmate, winner=红` | ✅ |
| FEN | `h/e` 方言可解析；导出恒为 `n/b`；往返恒等 | ✅ |
| 纯函数 | `applyMove` 不修改入参 | ✅ |
| 随机对局不变量 | 200 手内每手都合法，且双方将帅恒为各 1 | ✅ |

**过程中发现的三处失败全部是我自己的测试用例写错了**，引擎是对的，已逐一证实并修正：

1. 塞子放到了 `row 7`（ICCS `d2`）而不是 `row 8`（`d1`）——FEN 行序数错了一行；
2. 我以为初始局面里 `h2→h9` 是「0 架吃子」，实际上 `row2 = 1c5c1` 的**第二个黑炮正好在 col 7**，它是唯一炮架，所以该着法本来就合法；我后来另加的"炮架"其实是第二架；
3. 「兵过河横走」的用例没有挡住将帅照面（e 线空），所以该移动本身因照面而非法。

**教训（写给实现者）**：构造 FEN 用例时务必按「第 1 行 = row 0」逐行核对，并且别忘了将帅照面会让**任何**移动都变非法——这两点会伪装成引擎 bug。`lib/engine/coords.js` 里 `ICCS rank = 9 - row` 的换算方向是对的。

### 1.6.3 中文记谱独立复核

命令：一次性脚本（`/tmp`，不进仓库），26 项断言，**26/26 通过**。

| 覆盖点 | 结果 |
| --- | --- |
| 红方基本记谱：`炮二平五`、`马八进七`(b0c2)、`马二进三`(h0g2)、`车九进一`、`兵七进一`、`炮八平五` | ✅ |
| 黑方：阿拉伯数字 + 方向相反（`马2进3`、`炮2平5`） | ✅ |
| **前/后 消歧双向**：同列两车 → 生成 `前车进一` / `后车进一`，且都能解析回**原着法** | ✅ |
| **中 消歧**：同列三兵 → 最前用「前兵」、中间用「中兵」（含横走 `中兵平六`） | ✅ |
| `parseChinese` 错误语义：无法匹配 / 格式错误都返回 `{ error }`，不抛异常 | ✅ |
| `parseAnyMove`：ICCS、中文、含空格三种输入都能识别；非法输入返回 `error` | ✅ |
| `iccsToMove(pos, iccs)` 三态：合法 → `Move`；越界/格式错 → `null`；**几何合法但会造成将帅照面 → `null`** | ✅ |
| **整局往返**：随机走 60 手，每手 `formatChinese → parseChinese` 都必须回到**同一手** | ✅ |

**再次踩到同一个坑（已记入上方教训）**：构造「同列两车」用例时我把 e 线留空，于是将帅照面使除"挡线那一手"外的所有着法都被正确过滤掉，`generateMoves` 只返回 1 个着法——看起来像记谱 bug，实际是我的局面非法。**这是本项目最容易误报 bug 的单一原因**，实现者写 fixtures 时必须先检查 e 线。


---

### 1.6.9 跨流投影契约：宿主真的投影，客户端认不认

这是**最深的一条接缝**：`lib/game` 生成投影、`lib/ui/model.js` 消费投影，两边由不同 agent 写成。若客户端把宿主输出判为 malformed，面板就是一片空白，而两边各自的单测都会全绿。

方法：用假 ctx 启动宿主半并捕获真实 RPC handler，取**真实投影**喂给客户端的 `unwrapProjection` / `isProjection` / `deriveModel` / `legalTargetsFor` / `resolveIntent` / `acceptProjection`。**26/27 通过**。

| 断言 | 结果 |
| --- | --- |
| 客户端 `unwrapProjection` 能从宿主 RPC 响应里取出投影 | ✅ |
| 客户端 `isProjection` 认可宿主投影（**否则面板空白**） | ✅ |
| `deriveModel` 产出 90 格棋盘、认出我方/对手、判定可交互、认出宿主的 `hostTargets` | ✅ |
| 初始局面棋盘上有 32 个棋子 | ✅ |
| 投影含 §7.5.4 文档化的全部字段 | ✅ |
| `lastMove` 带 `from`/`to`/`iccs`/`zh` 四件套；`history` 每条带 `zh`+`iccs` | ✅ |
| **索引一致性**：`legalTargets` 的键与值都是 0..89 的整数 | ✅ |
| 客户端能取出某格走点，并把「选中格 → 合法目标」判成 `move` | ✅ |
| revision 栅栏：相同 revision 的重复投影被丢弃（不重渲染） | ✅ |
| FR17：无模型服务时 `message.code === 'ai.fallback.local'`（`tone: warn`） | ✅ |
| `clock`（双方用时）与 `usage`（本局用量）字段存在 | ✅ |
| **对手描述反映实际对手** | ❌ 见下 |

**发现的两个真 bug（已报 M2）**：

1. **首次打开面板的「惰性默认棋局」忽略 `Config.opponent.mode`**（用户可见）：

   | 路径 | `mode` | `opponent.kind` | `opponent.label` |
   | --- | --- | --- | --- |
   | `state`（面板首开的惰性棋局） | `model` | `model` | `当前会话模型` ✅ |
   | `state`（面板首开的惰性棋局） | **`local`** | **`model`** ❌ | **`当前会话模型`** ❌ |
   | `new`（显式开新局） | `local` | `local` ✅ | `本地引擎` ✅ |

   配置成 `mode: local` 的用户一打开面板会**被告知对手是「当前会话模型」**，而实际应招的是本地引擎——直接破坏 FR23 的诚实性要求。根因是惰性合成默认棋局这条路径没有复用 `newGame` 的对手解析。

2. **对手描述有两套字段，其中一套可能是 `null`**：`project()` 同时输出 `opponent: {kind,provider,model,label}`（客户端实际读的）与扁平的 `opponentKind`/`opponentLabel`/`opponentProvider`/`opponentModel`。实测 `state` 路径下 `opponentLabel === null` 而 `opponent.label` 有值——**同一件事两个真相，其中一个可能是 null**，任何读扁平字段的消费方都会显示空白。

**排除的误判（记下来避免下次再查）**：

- 落子后 `pending` 常常已是 `null`、`turn` 已绕回人类方 —— 这不是「阻塞等待模型」，而是**本地兜底只要几毫秒**。`beginDecision` 确实是「置 `pending` → `track(task)` → 立即返回」，与 §7.5.3 一致。**基于「落子后应立刻处于 thinking」的断言是竞态假设，不可靠**；要验证非阻塞必须注入慢速 LLM stub。
- 复用同一 `sessionId` 时会**正确恢复上一局**（我一度把它当成「非法着法」bug，实际是持久化在正常工作）。

## 2. 安装与激活

| # | 检查 | 做法 | 期望 | 实测 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 2.1 | 安装 | `plugin_manager { action: "install_bundle", target: "<仓库绝对路径>" }` | `application: "applied"` | **`{"stage":"enable","enabled":true,"changed":true,"application":"applied","warnings":[]}`**；pnpm 输出 `+ dsh-xiangqi-mate link:…`（零依赖、无构建脚本） | ✅ |
| 2.2 | 宿主半挂载 | `cordis_inspect_query { host, Tool, listTools }`（无需审批） | 恰好 6 个 `xiangqi_*` 工具 | ✅ 在 52 个工具中检出恰好 6 个：`xiangqi_board` / `xiangqi_hint` / `xiangqi_move` / `xiangqi_new` / `xiangqi_review` / `xiangqi_undo`，各 1 次 | ✅ |
| 2.3 | 客户端 bundle 被服务 | 见 §1.6.6（`node:vm` 模拟浏览器） | 产物可加载并注册 | **30/30**（含 `id` 正确、只 require `react`、四处承载注册） | ✅ |
| 2.4 | 右栏 tab 类型已注册 | 同上（捕获 `sidebarRightTabs.register`） | 类型 + guide 入口 | 注册了 `kind='xiangqi'`、`id='dsh-xiangqi-mate/xiangqi'`、带 `guide` 条目 | ✅ |
| 2.5 | 插件列表显示名与图标 | 见 §1.6.6 + 门禁 | 标题/图标可读 | `locale/{en,zh}.json` 的 `meta.title/description` 与 `icon.svg` 齐备；门禁 `package.icon-present` 通过 | ✅ |
| 2.6 | 临时禁用/恢复 | profile `cordis.patch.yml` 写 `- id: xiangqi` + `disabled: true` | 工具消失；撤销后恢复 | 待手工执行（改动用户 profile 状态，需用户确认） | ⬜ |
| 2.7 | 卸载干净 | `remove_bundle` | 工具与 tab 类型消失，无残留报错 | 待用户确认后执行 | ⬜ |

### 2.8 Loader 行可寻址性与 Config 投影（只读 Inspect）

`cordis_inspect_query { platform: host, provider: Config, method: listConfigs, input: { name: … } }`（**无需审批、不改状态**）：

| 包 | 结果 |
| --- | --- |
| `dsh-xiangqi-mate` | `{ id: "include:xiangqi", patchId: "xiangqi", name: "dsh-xiangqi-mate", status: "unsupported" }` |
| `dsh-project-compass` | `{ id: "include:project-compass", patchId: "project-compass", status: "absent" }` |
| `dsh-qualityforge` | `{ id: "include:qualityforge", patchId: "qualityforge", status: "absent" }` |

**两条结论**：

1. **Loader 行可寻址** ✅ —— `patchId` 就是 `xiangqi`，所以用户可以在自己的 `cordis.patch.yml` 里按 id 覆盖 config 或 `disabled: true`（§2.6 的前置条件因此成立，不需要真的去改 profile 来验证）。
2. **Config schema 未被投影**（`status: "unsupported"`），这是**手写 StandardSchemaV1 的已知代价**，属有意取舍，不是缺陷：

   | 方案 | 校验与默认值 | 在 DSH 工具链里可发现（`--dump-config-schema` / 设置界面） | 依赖 |
   | --- | --- | --- | --- |
   | **手写 `{'~standard': {…}}`（本项目选定）** | ✅ 激活期照常校验 | ❌ `unsupported` | 零依赖 ✅ |
   | `import z from '@deepseek-ai/schemastery'` | ✅ | ✅（原生 schema） | 引入一个非 `node:` 的宿主包 ⚠️（R1 的版本耦合风险） |
   | 不声明 Config（两个同类插件即是如此） | ❌ 无校验 | `absent` | 零依赖 |

   也就是说：**我们比两个同类第三方插件多了一层激活期校验，代价是 schema 不可被工具链发现**。用户需要按 README 里列出的键在 profile 补丁里手写配置。若将来要把配置搬进设置界面，唯一正路是改用 `@deepseek-ai/schemastery`——那是一次**有意的 v0.2 决策**（要重新评估 R1），不该靠伪造 `Symbol.for('schemastery')` 标记去骗过投影器。


## 3. 工具契约（模型视角）

| # | 检查 | 做法 | 期望 | 实测 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 3.1 | 开局 | `xiangqi_new` | 标准初始局面 | 返回标准开局：ASCII 棋盘（九…一 双标）+「第 1 手 / 你执红方 / 轮到红方」+ 空棋谱 | ✅ |
| 3.2 | 选边与对手 | `xiangqi_new { side: 'b', opponent: 'local' }` | 人类执黑、AI 执红先行 | 返回「你执黑方 | 轮到黑方」，且**红方已由本地引擎自动走了一手**「炮八进七」（炮八借 b7 黑炮为架吃 b9 黑马），棋盘与棋谱同步 | ✅ |
| 3.3 | 查看局面 | `xiangqi_board` | 含 FEN、状态、棋谱、**合法着法目录** | ✅ **已修复**：render 现在含棋盘（1..10 行号）+ 图例 + FEN + 上一手 + 状态 + 评估 + **44 条合法着法目录** + 棋谱，单块 1049 字符 | ✅ |
| 3.4 | 工具不许替人类走子 | `xiangqi_move { move: 'h2e2' }`（红方回合） | `NOT_YOUR_TURN` | **`无法完成：现在不是对手的回合，不得替人类方走子（NOT_YOUR_TURN）`**，并附**全部 44 条合法着法（ICCS + 中文双写）** | ✅ |
| 3.5 | 非法着法重试 | 同上失败返回 | 可读原因 + 着法目录供自纠 | 失败渲染**确实带了 44 条目录**（`renderFailure` 正确），模型可据此自纠 | ✅ |
| 3.6 | 引擎拒绝原因 | 见 §1.6.2 的 20 项 | 蹩马腿/塞象眼/炮架/送将/照面 | 全部正确（含炮的 0/1/2 架三种情形） | ✅ |
| 3.7 | 悔棋 | `xiangqi_undo` | 退回同一方走子 | 待补测（本轮未走满回合） | ⬜ |
| 3.8 | 提示 | `xiangqi_hint { count: 3 }` | 3 条候选 + 评估摘要 | ✅ **已修复**：render 末尾出现 `候选着法（本地引擎）：b2b9 炮八进七（+405） | h2h9 炮二进七（+405） | b2b5 炮八进三（+14）` | ✅ |
| 3.9 | 复盘 | `xiangqi_review` | 棋谱 + 转折点 + 评估曲线 | 待补测 | ⬜ |
| 3.10 | 工具卡片正文 | 观察模型收到的内容 | 单个 text 块含棋盘与记谱 | ✅ 仍是单个 text 块（平台偏好），内容已完整 | ✅ |
| 3.11 | 并发语义 | 见 §1.6.4 | 只有 `xiangqi_board` 并发安全 | 断言通过；改状态的工具默认串行 | ✅ |
| 3.12 | **成功路径的 render 完整性** | 直接调 `def.execute()` 对比 value 与 `output.render` | 模型应看到 FEN + 合法着法目录 + 评估 | ✅ **已修复**（复验通过）：`xiangqi_board` 1049 字符、`xiangqi_hint` 1112 字符，均含棋盘+FEN+目录+评估+候选。遗留：schema 声明的 `evalSummaryZh` 仍为 `undefined`（评估内容已在 render 里，故仅属字段冗余，不影响模型） | ✅ |
| 3.13 | 两个棋盘渲染器不一致 | 对比 `xiangqi_board` 与 `describePosition` | 同一局面同一呈现 | ✅ **已修复**：工具 render 已统一到 `describePosition`（1..10 行号 + 图例 + FEN + 着法目录） | ✅ |

> **3.12 与 3.13 是当前对 M4（模型能否把棋下对）影响最大的两处**，且是**我用真实工具调用观察到的**（上面 `xiangqi_board` 与 `xiangqi_hint` 的实际返回即证据）——不是推断。已报 M2：让 `renderBoard` 输出「状态行 → 棋盘 → FEN → 合法着法目录 → 评估 → 棋谱」的单个 text 块，并统一到 `describePosition` 这一个渲染源。

## 4. AI 对局闭环（FR5 / FR17 / FR23）

### 4.1 FR5 在产品路径上的端到端复核（本轮最重要的一条）

**背景**：M2 自查出一个致命缺陷——跨半 RPC 的 handler 拿不到 `agent`，于是 `resolveRoute(ctx, config, undefined)` **永远解析不出模型路由**，面板走的每一次应招都**静默降级成本地引擎**。表现是「棋照下、功能看起来正常，但主打卖点（和当前会话的模型对弈）完全失效」——最难发现的一类缺陷。

方法：假 `agents.get(sessionId)`（其 `session.requestHeader()` 给出 provider/model）+ 假 `llm`（`stream` 以 150 ms 延迟吐出一个合法的 `tool-call`）+ 捕获真实 RPC handler。**15/15 通过**：

| 断言 | 结果 |
| --- | --- |
| 开局轮到人类、`pending === null`、对手描述为 `model` | ✅ |
| 人落子后响应进入 **`ai-thinking`**（证明真的去问模型，而不是同步本地代走） | ✅ |
| 模型（stub）**确实被调用**，且带上解析出的 `provider`/`model` | ✅ |
| 请求里带上了 `xiangqi_move` 的 `ToolSchema` | ✅ |
| 模型给出的那一手（`b7e7` 炮2平5）**落进了棋谱** | ✅ |
| 轮次交还人类 | ✅ |
| 本局 `usage.totalTokens` 累加了模型用量（FR23） | ✅ |
| **未**被标记为本地兜底（`message.code !== 'ai.fallback.local'`） | ✅ |
| **对照组**：不提供 `llm` 服务时仍能落子，且 `message.code === 'ai.fallback.local'`（FR17 降级不阻塞产品） | ✅ |

> 这条验证的价值在于它覆盖了「单测全绿但产品路径无效」的盲区：把 DSH 的**真实** `connection.rpc` handler 抓出来、用**真实**的 RPC 形状驱动，而不是各自测各自的模块。

### 4.2 其余条目

| # | 检查 | 结果 |
| --- | --- | --- |
| 4.2 | 模型路由正确（读**当前会话**模型而非部署默认值） | ✅ 七级链实现完整；`route.js` 把 `agentDefaultModel` 排最后并注明它只是部署默认值 |
| 4.3 | 超时降级 | ✅ 单测覆盖（`aborted` 不重试、直接本地代走）；`timeoutMs` 可配置 |
| 4.4 | 非法着法重试 | ✅ 协议错误回灌「错误 + 合法着法目录」重试 ≤2；失败渲染确实带目录 |
| 4.5 | `mode: local` 零模型请求 | ✅ 决策侧走本地引擎且不留降级消息；对手描述正确报 `kind=local / 本地引擎` |
| 4.6 | 花费可见 | ✅ `usage` 字段随投影下发并在模型调用后累加（4.1 实测 133 tokens） |
| 4.7 | 花费封顶 | ✅ `maxTokensPerGame` 超限即切本地并给出 `ai.budget` 消息 |
| 4.8 | 不污染会话 | ✅ 插件直连 `ctx.llm`，不向会话写消息、**不写自定义会话事件**（红线，门禁静态检查） |
| 4.9 | 完整一局 | ⏳ 待你在面板里下完一局（我在会话里无法代替人落子——工具被 `actor` 守卫正确拒绝） |

## 5. 持久化与隔离（FR4 / FR16）

| # | 检查 | 做法 | 期望 | 实测 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 5.1 | 刷新不丢 | 走 4 手后刷新页面 | 局面、棋谱、计时全部恢复 | _待填_ | ⬜ |
| 5.2 | 重启不丢 | 重启 DSH 后再打开面板 | 局面恢复（说明落盘生效） | _待填_ | ⬜ |
| 5.3 | 会话隔离 | 另开会话打开面板 | 显示新对局，不串局 | _待填_ | ⬜ |
| 5.4 | 落盘位置 | 检查 `<会话 cwd>/.xiangqi-mate/<sessionId>.json` | 文件存在、内容为紧凑棋谱、无半截写入痕迹 | _待填_ | ⬜ |
| 5.5 | 路径穿越防护 | 构造含 `/`、`..` 的 sessionId（或检查清洗代码 + 单测） | 文件名被清洗，不会写到目标目录之外 | _待填_ | ⬜ |
| 5.6 | 关闭落盘 | 配置 `persist: false` | 不写文件；面板提示「本局不会被保存」 | _待填_ | ⬜ |
| 5.7 | 会话可恢复 | 写入棋谱后重启并**重新打开该会话** | 会话能正常打开（验证没有写自定义会话事件） | _待填_ | ⬜ |

---

## 6. 跨半通道（§7.5.3）

| # | 检查 | 做法 | 期望 | 实测 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 6.1 | RPC 可用 | 面板加载后走一手 | `connection.rpc.call('/xiangqi-mate', …)` 成功 | _待填_ | ⬜ |
| 6.2 | 轮询行为 | 观察 AI 思考期间的请求 | 只在 `pending === 'ai-thinking'` 期间轮询，800 ms 起退避到 2 s，30 s 上限 | _待填_ | ⬜ |
| 6.3 | 不可见即停 | 折叠右栏 / 切到别的 tab | 轮询停止（Network 面板无新请求） | _待填_ | ⬜ |
| 6.4 | 无推送依赖 | 代码审查 + 行为 | 不依赖任何宿主→客户端推送事件 | _待填_ | ⬜ |
| 6.5 | 命令通道 | 会话里执行 `/xiangqi state` | 返回与面板一致的投影 JSON | _待填_ | ⬜ |
| 6.6 | 服务缺失降级 | 在无 `connection` 的极简组合里加载 | 插件仍激活，面板显示不可用而不是崩溃 | _待填_ | ⬜ |

---

## 7. 手工 UI 用例（§12.4 全表）

> 逐条执行 UI-01 ~ UI-33，把结论与截图文件名填在这里。涉及 AI 的用例需要一次真实模型对局。

| 范围 | 用例 | 结论 | 证据（截图/备注） |
| --- | --- | --- | --- |
| 面板与渲染 | UI-01 打开面板、UI-02 初始局面、UI-24 窄面板 | _待填_ | _待填_ |
| 走子 | UI-03 点击走子、UI-04 非法反馈、UI-05–09 规则反例 | _待填_ | _待填_ |
| 胜负 | UI-10 将军、UI-11 将死、UI-12 困毙判负、UI-27 长将 | _待填_ | _待填_ |
| AI | UI-13 应招、UI-14 超时降级、UI-15 非法着法重试、UI-31 开销可见、UI-32 模型可配 | _待填_ | _待填_ |
| 工具条 | UI-16 悔棋、UI-17 提示、UI-28 复制棋谱、UI-29 新对局、UI-30 认输 | _待填_ | _待填_ |
| 复盘与计时 | UI-18 复盘跳转、UI-19 计时器 | _待填_ | _待填_ |
| 主题与语言 | UI-22 亮/暗主题、UI-23 中英切换、UI-25 减少动效 | _待填_ | _待填_ |
| 无障碍 | UI-26 键盘走子 | _待填_ | _待填_ |
| 设计一致性 | UI-33 与同类宿主页面并排（亮/暗各一次）；控制台无 `slot entry crashed` | _待填_ | _待填_ |

---

## 8. 已知限制与未通过项

| 项 | 说明 | 处置 |
| --- | --- | --- |
| **面板需用户手动打开一次** | 静态插件没有宿主→客户端推送通道，`sidebarRightTabs.register` 也无运行时钩子；唯一能感知「工具卡片刚出现」的 `tool.call.toolview` 会在历史回放时反复抢右栏焦点 | **接受**。已实现 `guide` 入口卡片（右栏「+ → 开始 → 象棋」）与面板内互开；中英 README 均已明确写出 |
| **`orientation` 无 UI 入口** | 翻盘逻辑（几何/光标/`stepCursor`）已实现并有单测，但只支持「黑上红下」 | **接受**（P2） |
| **复盘由客户端重放** | 投影不含每手 FEN；起点按标准初始局面假定（宿主只能从标准局面开局）。重放到底后与宿主 `board` 逐格比对，**不一致就禁用复盘**而不是显示错局面 | **接受**，且有可信度自检兜底 |
| **工具卡片里的小棋盘未做** | 需要客户端向 `tool.call.toolview` 注册视图 | P1，设计里本就列为增强 |
| **`Config` 不被配置工具链投影** | 手写 StandardSchemaV1 → 宿主报 `status: "unsupported"` | **有意的取舍**，见 §2.8；要进设置界面需改用 `@deepseek-ai/schemastery` |
| **`mode: 'session'`（唤醒会话让模型走棋）未实现** | 设计 §4.4.1 保留的开关，v0.1.0 只做 `direct` | 按 Q2 的结论，P2 |
| **`storageDomain` 成功路径无法自测** | 本机组合没有 domain backend，`open()` 必然失败 | 降级分支有测试；成功路径待有 domain 的组合再验 |
| **`lib/ui/panel.js` 964 行** | 超出 §11-R8 的 400 行/文件；浏览器半源码有意放宽 | 已写进 DESIGN.md §11-R8 的偏离说明与理由 |
| **红方字色偏离 §7.3 的逐字映射** | 用了 `color-mix(92% state-error-primary, 8% label-primary)`：亮色下 red-600 在白底盘只有 4.4976:1，卡在 WCAG AA 的 4.5 下沿 | **保留**（可访问性优先）；两个输入仍是主题令牌，WCAG 测试从 CSS 声明反解后逐条钉住 |
| **`node --test <目录>` 不可用** | Node ≥21 的位置参数是 glob 而非目录，目录会被当模块 require | 已把全部文档里的命令改成 glob 形式或裸 `node --test` |

### 8.1 本轮（收尾轮）修掉的三个问题

| 问题 | 根因 | 修法 |
| --- | --- | --- |
| **整仓测试 1 条红的、且是 `Unable to deserialize cloned data` 的 uncaughtException** | 测试里裸写 `process.stdout.write`，与 `node:test` 的 IPC 抢同一个通道（单文件跑没事，并发跑整仓才炸） | 改用 `t.diagnostic()`；helper 的告警改写 stderr。**412→413 全绿** |
| **自然限着「调宽」失效** | 引擎用固定常量 120 先返回 `draw-fifty`，`lib/game/state.js` 因 `TERMINAL_STATES` 短路而撤销不了，于是把 `rules.fiftyMovePlies` 调到 200 毫无作用 | 以配置为准：`halfmove >= fifty` 即判和，否则撤销引擎的 `draw-fifty`。补了双向回归测试（调严 60 / 调宽 200 / 默认 120） |
| **`node --test test/<dir>` 在我的文档里是错的** | 我按旧版 Node 语义写的命令 | 全部改成 `node --test "test/<dir>/*.test.js"` 或裸 `node --test`（M1 与 M2 各自独立报告了同一件事） |

---

## 9. 结论

_待填：一句话结论 + 是否达到 v0.1.0 的交付口径（§9 全绿 + §12.4 全过 + 装进真实 DSH 可下完一局）。_
