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
- **文档**：完整设计文档与 21 条 DSH API 证据索引、AI 走棋路径调研报告。
- **测试**：引擎规则反例集与 perft 基准（depth 1–4 对齐公开数据）、工具契约测试、假 ctx 集成测试、客户端纯逻辑测试、静态边界门禁。

[Unreleased]: https://github.com/lpeixin/dsh-xiangqi-mate/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lpeixin/dsh-xiangqi-mate/releases/tag/v0.1.0
