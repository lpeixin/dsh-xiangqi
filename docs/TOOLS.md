# 工具、命令与跨半通道 · dsh-xiangqi-mate

> 本文件是**对外契约**：模型能调什么、人能用什么命令、浏览器半怎么到达宿主半。
> 对应设计文档：[DESIGN.md](DESIGN.md) §6.2 / §6.6 / §7.5。实现：[lib/tools/](../lib/tools) / [lib/game/api.js](../lib/game/api.js) / [lib/ui/rpc.js](../lib/ui/rpc.js)。

---

## 1. 一个操作，两个调用方

宿主侧只有**一份**业务实现（[lib/game/service.js](../lib/game/service.js)），两条入口都只是薄包装：

```
模型 ──▶ xiangqi_* 工具 ─┐
                          ├──▶ lib/game/service.js（唯一实现）──▶ lib/engine（唯一规则真相）
人/面板 ──▶ RPC / 会话命令 ─┘
```

**不允许**在任何一条路径里另写一份业务逻辑。判断依据很简单：`lib/tools/handlers.js` 与 `lib/game/api.js` 都只做「校验入参 → 调 service → 组装返回」。

`actor` 决定「谁在走」：

| 入口 | actor | 守卫 |
| --- | --- | --- |
| 工具 | `opponent`（AI/模型） | 人类回合时返回 `NOT_YOUR_TURN`——**模型不得替人类走子** |
| RPC / 命令 | `hero`（人） | 对手回合时返回 `NOT_YOUR_TURN` |

---

## 2. 工具（模型可见）

六个工具，全部**只命名导出**、返回值走统一的「无损 JSON 清洗」，且卡片正文只用一个 `{type:'text'}` 块（平台偏好单块）。

| 工具 | 入参 | 返回要点 | 并发 |
| --- | --- | --- | --- |
| `xiangqi_new` | `{ side?: 'r'\|'b', opponent?: 'model'\|'local', maxPlies?: number }` | 新局面的完整投影 | 串行 |
| `xiangqi_board` | `{ includeMoves?: boolean=true, includeEval?: boolean=false, ascii?: boolean=true }` | **含 FEN、ASCII 棋盘、合法着法目录（ICCS+中文）、评估、棋谱** | **并发安全** |
| `xiangqi_move` | `{ move: string \| {from,to}, reason?: string }`，`move` 接受 ICCS（`h2e2`）、中文记谱（`炮二平五`）或坐标对象 | 落子后的投影 + `played`（中文记谱）+ `captured` | 串行 |
| `xiangqi_undo` | `{ plies?: number=2 }` | 回退后的投影 + `undone[]` | 串行 |
| `xiangqi_hint` | `{ count?: number=3, depth?: number }` | `candidates[]`（ICCS/中文/评分/PV）+ 评估摘要；**不消耗模型额度** | 串行 |
| `xiangqi_review` | `{ highlight?: 'turning'\|'all' }` | 棋谱、转折点、逐手评估曲线 | 串行 |

**只有 `xiangqi_board` 声明 `isConcurrencySafe`**：其余工具都会改对局状态，必须串行，否则同一回合的并发调用会互相踩踏。

### 2.1 错误契约

可预期错误**不抛异常**，而是返回结构化结果：

```jsonc
{ "ok": false, "error": "NOT_YOUR_TURN", "errorZh": "现在不是对手的回合，不得替人类方走子",
  "legalMoves": [{ "iccs": "a3a4", "zh": "兵九进一" }, …] }   // 44 条
```

卡片正文（`renderFailure`）**会把 `legalMoves` 渲染出来**——模型据此自纠，通常一次重试就能走对。这是"非法着法"这一路径的完整闭环。

### 2.2 返回值形状

所有工具返回值的公共字段（`output.schema` 逐字段声明，缺一个就是 `INVALID_TOOL_OUTPUT`）：

```jsonc
{
  "ok": true, "revision": 7, "fen": "…", "turn": "r", "hero": "r",
  "phase": "playing", "pending": null,          // null | 'ai-thinking' | 'ai-failed'
  "status": { "state": "playing", "winner": null, "reasonZh": "对局进行中" },
  "board": ["…90 个棋子字符…"], "legalTargets": { "70": [49, 58, 67] },
  "lastMove": { "from": 70, "to": 67, "iccs": "h2e2", "zh": "炮二平五" },
  "history": [{ "zh": "炮二平五", "iccs": "h2e2", "captured": "" }],
  "opponent": { "kind": "model", "provider": "…", "model": "…", "label": "当前会话模型" },
  "usage": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "calls": 0 },
  "clock": { "red": 0, "black": 291 },
  "message": { "code": "ai.fallback.local", "tone": "warn" }
}
```

- `revision` **单调递增**，客户端据此丢弃过期响应；
- `legalTargets` 以 from 索引为键、to 索引数组为值——**客户端不重算规则**；
- `message.code` 是降级/提示的机器码，由客户端本地化（`ai.fallback.local`、`ai.timeout`、`ai.budget` 等）。

---

## 3. 会话命令（人可见）

```
/xiangqi new | state | move <着法> | undo | hint | resign | review | export
```

- `move` 同样接受 ICCS 与中文记谱（`/xiangqi move 炮二平五`）；
- handler 与工具调用**同一份** `lib/game` 实现，返回 `{ kind:'success', text }`（text 是投影 JSON）或 `{ kind:'error', text }`（中文原因）；
- **「认输」这类需要本人确认的动作只能由人触发**，工具不提供该能力。

---

## 4. 跨半通道（浏览器半 → 宿主半）

静态插件**没有** `host.call`（那属于「动态 Cordis 包」运行时）。本插件用两条**受支持**的通道：

| 通道 | 宿主侧 | 客户端侧 | 用途 |
| --- | --- | --- | --- |
| **RPC（状态同步主通道）** | `ctx.connection.rpc.handle('/xiangqi-mate', handler)` | `ctx.connection.rpc.call('/xiangqi-mate', endpoint, payload, signal)` | 面板的全部读写 |
| 会话命令 | `ctx.commands.register({ name:'xiangqi', … })` | `ctx.remote.commands.execute(sessionId, '/xiangqi …', [])` | 会话内的用户动作 |

### 4.1 RPC 端点

| endpoint | payload | 返回 |
| --- | --- | --- |
| `state` | `{ sessionId, cwd? }` | 完整投影 |
| `move` | `{ sessionId, move? \| iccs? \| from+to }` | 落子后的投影 |
| `undo` | `{ plies? }` | 回退后的投影 |
| `hint` | `{ count?, depth? }` | `{ candidates[] }` |
| `new` | `{ side?, opponent?, maxPlies? }` | 新局面的投影 |
| `review` | `{ highlight? }` | 棋谱 + 转折点 + 评估曲线 |
| `resign` | — | 结算后的投影 |
| `fallback` | — | 放弃模型、立刻由本地引擎代走（面板的「由本地引擎代走」按钮） |

统一响应：`{ ok: true, value }` 或 `{ ok: false, error: { code, message, details } }`。

**`move` 三种形状都接受**（优先级 `move` → `iccs` → `from`+`to`）——这是刻意做的容错：客户端发的是 `{from,to,iccs}`（索引制，与投影一致），而人与模型习惯写记谱。**这个接缝曾经两边各写一半而对不上**，所以现在三条路都收，并有专门的回归测试钉住。

### 4.2 四条实现约束（都会踩）

1. **只在 Web 组合里存在**：`connection` 是可选服务，必须 `ctx.get('connection')` 判空后再注册；缺失时面板显示不可用，而不是崩溃。
2. **channel 命名**：匹配 `/^\/[A-Za-z0-9._~-]+$/` 且**不能用 `/api`**（保留）。本插件用 `/xiangqi-mate`。
3. **disposer 归属陷阱**：`connection.rpc.handle` 返回的 effect 挂在 **connection 服务自己的 fiber** 上，**不会**随本插件卸载释放——必须自己收集 disposer，否则插件重载会留下重复 handler。
4. **会话归属校验**：handler 拿不到 agent，只能从 `payload.sessionId` 取会话，因此 [lib/index.js](../lib/index.js) 的 `admitSession` 会校验该 id 是否真实存在，避免变成「读任意会话棋谱」的口子。

### 4.3 客户端→宿主的单向性

**宿主 → 客户端没有推送通道**（客户端可监听事件只有 4 个，第三方加不进 `remote.$on` 白名单）。因此 AI 应招靠**按需轮询**到达：只在 `pending === 'ai-thinking'` 且面板可见时轮询，800 ms 起、×1.35 退避、**2 s 封顶、30 s 停止**（停止后面板提示可点「由本地引擎代走」）。

> 本地兜底只要几毫秒，所以**落子响应里的 `pending` 常常已经是 `null`、`turn` 已绕回人类方**——这不是阻塞，是速度快。写测试时**不要**断言"落子后必然处于 thinking"，那是竞态假设。

---

## 5. 技能（模型按需加载）

`lib/SKILL.md` 是技能正文，`lib/skill.js` 通过 `ctx.skills.register` 注册为 `xiangqi-mate-playbook`（kebab-case）。

- **技能 = 怎么下**（记谱规范、开局原则、子力价值、何时用 `xiangqi_hint`），按需加载、不占常驻 token；
- **工具 = 能做什么**（上面六张表），schema 常驻；
- 技能注册失败**静默降级**，绝不拖垮工具注册；`ctx.get('skills')` 拿不到就直接不注册。

---

## 6. 配置

`Config` 是**手写、零依赖的 StandardSchemaV1**（不引入 schemastery）。键与默认值见 [README.md](../README.md#configuration) / [README.zh-CN.md](../README.zh-CN.md#配置)。

**已知取舍**：手写 schema 会在 Loader 行激活时**照常校验并补默认值**，但**不会被投影进 DSH 的配置工具链**（宿主对 `Config.listConfigs` 报告 `status: "unsupported"`，不会列出字段）。用户需照 README 的表在 profile 补丁里手写键。对照：同类第三方插件（`dsh-project-compass`、`dsh-qualityforge`）是 `absent`（完全不声明）。要让配置进设置界面，唯一正路是改用 `@deepseek-ai/schemastery`——那是一次有意的版本决策，见 [VERIFICATION.md](VERIFICATION.md) §2.8。
