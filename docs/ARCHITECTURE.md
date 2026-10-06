# 实现架构 · dsh-xiangqi-mate

> 本文件回答「代码在哪、为什么这样分」。**契约**（工具/命令/通道/配置）见 [TOOLS.md](TOOLS.md)，**引擎 API** 见 [ENGINE.md](ENGINE.md)，**设计与取证**见 [DESIGN.md](DESIGN.md)，**实测记录**见 [VERIFICATION.md](VERIFICATION.md)。

---

## 1. 一张图

```
┌─ 浏览器（DSH Web GUI）───────────────────────────────────────────────┐
│  lib/ui/plugin.js      注册：tab 类型 + 4 个座位 + locale + 主题令牌  │
│  lib/ui/panel.js       承载层：RPC / 轮询 / 生命周期 / 交互编排       │
│  lib/ui/board.js       BoardView（纯展示）+ BoardInteraction（只产意图）│
│  lib/ui/model.js       纯函数核心：投影→渲染数据、revision 栅栏、退避  │
│  lib/ui/{rpc,poller,styles,i18n,icons,engine-bridge}.js               │
│  ── 以上 → scripts/build-client.mjs 内联 → lib/client.js（提交进仓库）│
└──────────────────────────┬───────────────────────────────────────────┘
                           │ ctx.connection.rpc.call('/xiangqi-mate', …)
                           │ （宿主 → 客户端**没有**推送通道，AI 应招靠按需轮询）
┌─ 宿主（DSH Node 进程）───┴───────────────────────────────────────────┐
│  lib/index.js          name / inject / Config / apply（唯一入口）     │
│  lib/game/api.js       命令 + RPC 表面层：入参归一化、投影回填        │
│  lib/game/service.js   对局服务（唯一业务实现）：落子/悔棋/提示/复盘…  │
│  lib/game/state.js     纯状态机 + 投影 project()（唯一投影构造点）     │
│  lib/game/{store,records,clock,engine,util}.js                       │
│  lib/tools/{index,handlers,render}.js  6 个原生 ToolDefinition        │
│  lib/opponent/{route,prompt,llm,parse,fallback}.js  模型对手 + 降级   │
│  lib/skill.js + SKILL.md                                              │
│  ── 依赖方向严格向下 ──────────────────────────────────────────────  │
│  tools / opponent ──▶ game ──▶ engine（纯函数，零依赖）               │
└──────────────────────────────────────────────────────────────────────┘
```

**分层铁律**：`tools` 与 `opponent` 都只调 `game`；`game` 不认识工具；`engine` 不认识对局、不认识 DSH。因此引擎可被单独拿走，也能被内联进浏览器（`lib/ui/engine-bridge.js` 用的就是同一份源码）。

---

## 2. 宿主半

| 文件 | 行 | 职责 | 关键设计 |
| --- | --- | --- | --- |
| [lib/index.js](../lib/index.js) | 298 | 装配：注册工具/命令/RPC/技能，托管后台任务与 disposer | **只命名导出**（`export default` 会让 Loader 的 `unwrapExports` 丢掉 `inject`）；`inject` 只有 `['tools']`，其余服务一律 `ctx.get()` 判空 |
| [lib/game/service.js](../lib/game/service.js) | 400 | 唯一业务实现 | 所有后台应招经 `track()` 登记到插件级 Promise Set，disposer 里 await 结束——**游离异步的未捕获 rejection 会让整个 DSH 退出** |
| [lib/game/state.js](../lib/game/state.js) | 306 | 纯状态机 + `project()` | 投影只有**一个**构造点，客户端契约因此有唯一真相 |
| [lib/game/api.js](../lib/game/api.js) | 211 | 命令与 RPC 的表面层 | `moveInputOf` / `resolveInput` 把「ICCS 串 / 中文 / 索引对象 / 字符串坐标对象 / `iccs` 字段」五种形状归一化——**这条接缝曾经两边各写一半而对不上** |
| [lib/game/store.js](../lib/game/store.js) | 226 | 按会话持久化 | 只存 `initialFen` + 紧凑棋谱；原子写（tmp + rename）；`sessionId` 白名单清洗防路径穿越；`storageDomain` 可用则升级，失败清晰降级 |
| [lib/game/records.js](../lib/game/records.js) | 284 | 棋谱与正文 | `boardText` **委托** `describePosition`，只在引擎异常时才用本地兜底渲染（避免两个棋盘渲染器两套真相） |
| [lib/game/clock.js](../lib/game/clock.js) | 50 | 计时 | 纯函数，便于单测 |
| [lib/game/engine.js](../lib/game/engine.js) | 102 | 引擎装载 | **动态 import + API 自检**：引擎缺 API 时插件照常装载、工具照常注册，只在真正调用时抛精确中文错误 |
| [lib/tools/index.js](../lib/tools/index.js) | 290 | 6 个工具定义 | 原生 `ToolDefinition` 字面量（不 import 官方包）；只有 `xiangqi_board` 声明并发安全 |
| [lib/tools/render.js](../lib/tools/render.js) | 138 | 卡片正文 + 无损 JSON 清洗 | **模型只看得到 `output.render` 的输出**；因此正文必须自带 FEN + 合法着法目录 + 评估 + 候选——缺了模型就只能猜坐标 |
| [lib/tools/handlers.js](../lib/tools/handlers.js) | 230 | handler | 入参自己校验（宿主**不**校验 `parameters`） |
| [lib/opponent/route.js](../lib/opponent/route.js) | 147 | 模型路由七级链 | `agentDefaultModel` 只是**部署默认值**，必须排最后；真正的当前会话模型来自 `sessionProjections.pending` / `session.requestHeader()` |
| [lib/opponent/llm.js](../lib/opponent/llm.js) | 235 | 模型请求 | 用 `resolveCallConfig` + `stream`（`prepareCall` 后改 config 会抛 `INVALID_PREPARED_CALL`）；**直连 stream 没有自动重试**，重试自建 |
| [lib/opponent/parse.js](../lib/opponent/parse.js) | 226 | 容错解析 | 优先 tool-call 参数，回退文本 ICCS/中文；协议错误回灌「错误 + 合法着法目录」重试 ≤2 |
| [lib/opponent/fallback.js](../lib/opponent/fallback.js) | 180 | 本地兜底 | 按稳定错误码路由；`aborted` 不重试；预算超限直接切本地 |
| [lib/opponent/prompt.js](../lib/opponent/prompt.js) | 76 | 提示词唯一真相 | 只走一步、必须调 `xiangqi_move`、不得替红方走子 |

**`apply` 的装配顺序与释放**：注册工具 → 命令 → RPC 通道 → 技能；每个注册点各自 `try/catch` 收集失败后统一 `warn`（一个工具注册失败不该拖垮整棵插件）；disposer **逆序**执行且幂等。

---

## 3. 浏览器半

### 3.1 三层解耦（§7.2 的落地）

```
panel.js（承载层：取状态、订阅、错误边界、交互编排）
 ├─ board.js 的 BoardView        ← 渲染层：纯展示，只吃「可渲染的派生数据」，不含规则判断
 ├─ board.js 的 BoardInteraction ← 交互层：命中测试/拖拽/键盘，只产出「意图」
 └─ model.js                     ← 纯函数：投影 → 渲染数据、意图归约、栅栏、退避
```

`model.js` 不认识 `ctx`、不认识 React，因此可以在 Node 里直接单测（`test/client/model.test.js`）。`panel.js` 是**唯一**碰 `ctx` 的地方。

### 3.2 五条硬约束（违反即浏览器白屏或功能静默失效）

1. **单文件、自包含、classic script**：`window.__ModuleLoader__.load({ id: "dsh-xiangqi-mate", factory })`，产物里**不得**残留 `import`/`export`；
2. **只 `require('react')`**：其余基线模块都没有引入（官方规范劝阻依赖官方客户端 UI 包）；
3. **不用 `host.call` / `styles.insert`**：那是「动态 Cordis 包」的能力；样式用 `<style data-plugin-css>` 或组件内 `<style>`；
4. **只用主题令牌**，不写 `@media (prefers-color-scheme: dark)`（那会忽略用户的 DSH 主题偏好）；
5. **`ctx.slots.inject` 是必须的**：父槽从未声明时裸 `register` 会抛错。

### 3.3 承载与入口

注册了**四处**座位：`sidebarRightTabs`（类型 + `guide` 入口卡片）、`sidebar.right.pane.tab`（右栏正文）、`main`（主面板）、`sidebar.panellist`（左栏图标，`id` 必须等于 `main` 的 `key`）。

> **面板必须由用户自己打开一次**：静态插件没有宿主→客户端推送通道，也无法感知「工具卡片刚出现」而不引起历史回放抢焦点。这是设计上的接受项，已写进 README。

### 3.4 生成物与自检

`lib/client.js`（≈5150 行 / 208 KiB）**是生成物但必须提交**——宿主要求产物在包内。`scripts/build-client.mjs` 做：

- **生成前**自检：多行 `import`/`export`、**跨文件顶层标识符重名**、引擎裸说明符/缺 `.js` 后缀。前两条来自一次真实事故：内联进同一作用域时 `RED_CODE` 重名会直接白屏，而 `node --check` 抓不到；
- **产物**自检：残留 `import`、loader 调用次数、`new Function(src)` 可解析（比 `node --check` 更贴近浏览器，因为产物是 classic script 而非 ESM）；
- `--check`：与已提交产物逐字节比较，CI 用。

---

## 4. 关键数据流

### 4.1 人走一手（产品主路径）

```
点棋盘 → BoardInteraction 产意图 → model.resolveIntent（乐观预校验）
      → rpc.move(from, to, iccs) → connection.rpc.call('/xiangqi-mate','move',…)
      → api.js moveInputOf/resolveInput 归一化 → service.playMove(actor:'hero')
      → state.advance → store.save（原子写）
      → 投影回填 → 客户端 revision 栅栏 → 重渲染
      → beginDecision 后台发起对手应招（track 托管）
```

### 4.2 对手应招与降级

```
beginDecision → state.pending='ai-thinking' → 立即返回（客户端开始轮询）
             ↓ 后台任务
   route.resolveRoute（七级链）→ llm.resolveCallConfig → llm.stream(tools:[xiangqi_move])
   ├─ 拿到 tool-call → parse → 校验候选/revision 栅栏 → 落子 → usage 累加
   └─ 失败/超时/超限 → fallback（本地引擎代走）→ message.code='ai.fallback.local'
```

**两个曾经真实发生的缺陷，值得记在这里**：

1. **FR5 在产品路径上曾静默失效**：RPC handler 拿不到 `agent`，于是 `resolveRoute(ctx, config, undefined)` 永远解析不出模型路由，**面板的每一次应招都默默降级成本地引擎**——棋照下，但主打卖点没了。修法是 `ctx.agents.get(sessionId)` 取活体 Agent。它的表现是「功能看起来正常」，属于最难发现的一类；现在有端到端验证钉住（见 [VERIFICATION.md](VERIFICATION.md) §4.1）。
2. **模型看不到合法着法**：`output.render` 只输出棋盘文本，`legalMoves`/`fen` 留在 value 里到不了模型，与工具自己的描述直接矛盾。修法是让 `render` 输出「棋盘 + FEN + 着法目录 + 评估 + 候选」的单个 text 块。

---

## 5. 测试布局

| 目录 | 内容 | 命令 |
| --- | --- | --- |
| `test/engine/` | 规则反例集、perft 基准、记谱往返、性质测试 | `node --test "test/engine/*.test.js"` |
| `test/contracts/` | 工具 schema 与返回形状、Config 分支、对局层契约 | `node --test "test/contracts/*.test.js"` |
| `test/integration/` | 假 ctx 驱动 `apply`、对手层（含 llm stub）、**跨半**（用 M3 真实 RPC 客户端）、引擎缺失降级 | `node --test "test/integration/*.test.js"` |
| `test/client/` | 纯函数、**在假浏览器里真跑产物**、用极小 hook 运行时驱动真组件 | `node --test "test/client/*.test.js"` |
| 静态门禁 | 零依赖/免构建/无 default export/红线 | `node scripts/check-boundaries.mjs` |

> **在 Node ≥21 上不要用裸目录参数**：`node --test test/engine` 会把目录当模块 require 并失败（`Cannot find module`）。用 glob（如上）或裸 `node --test`（自动递归发现）。
>
> **测试里不要裸写 `process.stdout`**：stdout 是 `node:test` 的 IPC 通道，并发跑整仓时会表现为 `Unable to deserialize cloned data` 的 uncaughtException。要输出诊断请用 `t.diagnostic()`（或写 stderr）。

---

## 6. 扩展点（如果你想改这个插件）

| 想做的事 | 改哪里 | 注意 |
| --- | --- | --- |
| 加一条规则 / 改判定 | `lib/engine/rules.js`（或 `moves.js`） | 改完必须重跑 `node scripts/perft.mjs --depth 4` 与 `test/engine`；perft 是唯一的客观护栏 |
| 加一个工具 | `lib/tools/index.js` + `handlers.js` | 必须补 `output.schema`（逐键声明）、单 text 块 `render`；改状态的**不要**声明并发安全；并让 RPC/命令共用同一实现 |
| 加一个 RPC 端点 | `lib/game/api.js` 的 `ACTIONS` + `dispatch`，客户端 `lib/ui/rpc.js` 的 `RPC_ENDPOINTS` | 两端都要列，否则客户端会写出一个不存在的端点（`RPC_ENDPOINTS` 的作用就是让这种错误在代码里可见） |
| 改棋盘外观 | `lib/ui/styles.js` + `lib/ui/board.js` | 只用主题令牌；改完跑 `node scripts/build-client.mjs` 并提交产物 |
| 加配置项 | `lib/index.js` 的 `DEFAULTS` + `coerce` + README 表 | `coerce` 里对「不在 DEFAULTS 的键」有额外分支的坑（可选字符串键曾经因此永远设不进去） |
| 改投影字段 | `lib/game/state.js` 的 `project()` | 同时改 `lib/ui/model.js` 的 `isProjection` 与 `deriveModel`；**投影形状是跨半契约**，两边必须同时改并有测试 |
