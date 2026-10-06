# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- 长将 / 长捉的完整亚洲规则裁决表（当前为简化规则：长将判负 + 三次重复判和）
- 人类执黑（AI 先行）——`GameState.hero` 已预留字段
- 自定义工具调用卡片中的图形棋盘（`tool.call.toolview`，P1）

## [0.1.0] - 待发布

首个版本。设计与实现范围见 [docs/DESIGN.md](docs/DESIGN.md)。

### 新增

- **棋规引擎**（`lib/engine/**`）：纯函数、零依赖的中国象棋规则实现——车/马（蹩马腿）/炮（炮架）/相象（塞象眼、不过河）/仕士/帅将（九宫、将帅照面）/兵卒（过河横走）；将死、困毙判负、三次重复、自然限着；ICCS 与中文记谱双向转换（含 `前/后/中` 消歧）；局面描述、可解释评估与迭代加深 alpha-beta 搜索。
- **宿主半**：六个工具（`xiangqi_new` / `xiangqi_board` / `xiangqi_move` / `xiangqi_undo` / `xiangqi_hint` / `xiangqi_review`）、`/xiangqi` 会话命令、按会话的对局状态与棋谱落盘、`xiangqi-mate-playbook` 技能。
- **AI 对手**：读当前会话的模型路由，直连 `ctx.llm` 并以工具调用形态取得着法；超时、限流、输出非法着法时按稳定错误码降级到本地引擎，并在面板如实说明。
- **浏览器半**：会话右栏的象棋 tab（两阶段 tab 类型注册 + 引导页入口）、主区域大棋盘与左栏图标、SVG 棋盘与棋子、中文记谱面板、悔棋/提示/复盘/认输/复制棋谱、计时器、键盘走子与读屏播报、亮暗主题自适应。
- **零依赖免构建**：宿主半只用 Node 内置模块；浏览器半由 `scripts/build-client.mjs` 生成自包含单文件 `lib/client.js`（引擎源码内联），安装不执行任何脚本。
- **文档**：完整设计文档与 21 条 DSH API 证据索引、AI 走棋路径调研报告，以及面向使用者的 `docs/ENGINE.md`（引擎作为独立库）、`docs/TOOLS.md`（工具与跨半契约）、`docs/ARCHITECTURE.md`（实现地图）、`docs/VERIFICATION.md`（逐项验证记录）。README **中英双语**（默认英语，顶部可点击切换），含科技感 banner 与真实使用截图。
- **测试**：引擎规则反例集与 perft 基准（depth 1–4 对齐公开数据）、工具契约测试、假 ctx 集成测试、客户端纯逻辑测试、静态边界门禁。

### 修复（开发期发现，均带回归测试）

- **跨半 RPC 通道**：`connection.rpc.handle()` 在当前 DSH 构建里对**任何**调用方都抛
  `cannot get property "webServer" without inject`（它内部用的是 connection 插件自己的上下文，
  那个上下文没有 `inject: ['webServer']`），而 `/api` 的共享拦截器席位已被 `dsh-api-gateway` 占据。
  改为自建前缀路由（在注入 `webServer` 的 fiber 里注册）并用文档化的 `connection.admit` 做鉴权，
  **说同一套信封**，因此客户端无需改动。此前表现为面板一直报 `HTTP 405`。
- **`revision` 跨对局单调递增**：新对局曾把 revision 重置为 1，客户端栅栏据此把新投影判成
  stale 丢弃——表现为「点了新对局，棋盘与棋谱还是上一局」。现在跨对局续增并持久化，
  旧存档用时间戳作种。
- **棋谱区固定高度**：先前着法一多就把棋盘挤小（棋盘按容器实测高度缩放）。现在棋谱区高度恒定、
  在内部滚动，棋盘尺寸不随棋谱变化。
- **模型应招超时**：默认 20 s → **60 s**（高推理档的模型 20 s 内回不来，于是每手都降级），
  客户端轮询上限提高到 75 s（必须**大于**宿主预算，宿主才是"该等多久"的真相来源）；
  `opponent.reasoningEffort` 现在可以**单独**覆盖档位（此前只填档位会整级跳过、完全无效）。
- **UI i18n 补漏**：`moves.turning` 缺键（中文界面会原样显示键名）；「复制棋谱」的导出改为
  **语言中立**并附 ICCS，非中文读者与引擎也能用。
- **代理端解析宽容度**：模型给出 `{from,to}` 等等价形状不再被判成"没给着法"；被拒时会记录
  **模型原始输出**到自检出口，便于定位（此前所有拒绝都被面板显示成笼统的"模型超时"）。

[Unreleased]: https://github.com/lpeixin/dsh-xiangqi-mate/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lpeixin/dsh-xiangqi-mate/releases/tag/v0.1.0
