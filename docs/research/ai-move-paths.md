# AI 走棋的技术路径调研（DSH 宿主 API + 社区先例）

> 调研日期：2026-10（本机 DSH `0.2.0-rc.2`，`/tmp/dsh-asar/out/@deepseek-ai/` 解包源码）
> 读者：`dsh-xiangqi-mate` 实现方与设计评审
> 本文是对 `docs/DESIGN.md` §4.4 的**证据复核**，其中两处结论需要修正（见 §1.4、§4.1）。

---

## 1. 模型调用路径：DSH 里「让模型生成一次决策」的插件可用入口

### 1.1 路径 A —— 直接调用 `ctx.llm`（LlmRuntime）

服务键 `llm`，服务描述「an adapter registry plus a streaming model-call API, interceptable via the `llm/stream` waterfall」。

| API | 签名 | 证据 |
| --- | --- | --- |
| `ctx.llm.stream` | `stream(options: GenerateOptions): AsyncIterable<StreamChunk>` | `/tmp/dsh-asar/out/@deepseek-ai/dsh-llm/lib/types/index.js:927` |
| `ctx.llm.resolveCallConfig` | `async resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>` | 同上 `:686` |
| `ctx.llm.prepareCall` | `async prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>` | 同上 `:730` |
| `ctx.llm.resolveModelInfo` | `async resolveModelInfo(provider, model, signal?): Promise<LlmResolvedModelInfo>` | 同上 `:~660` |
| `ctx.llm.listProviders` / `listModels` | `() => LlmProviderInfo[]` / `(provider) => Promise<LlmModelInfo[]>` | 同上 `:359` |
| `llm/stream` 事件 | `'llm/stream'(this: LlmRuntime, options: GenerateOptions, next): AsyncIterable<StreamChunk>`（waterfall） | Cordis Inspect `host/Event.listEvents` |

**请求类型**（逐字，来自生成清单 `/tmp/dsh-asar/out/@deepseek-ai/dsh-llm/lib/typert.host.js`）：

```ts
export interface GenerateOptions {          // typert.host.js:313
  provider: string;
  model: string;
  reasoningEffort?: ReasoningEffortId;
  messages: RequestMessage[];
  system?: string;
  tools?: ToolSchema[];
  toolHistory?: ToolHistory;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  signal?: AbortSignal;
  sessionId?: Branded<'SessionId'>;
  purpose?: 'compaction' | 'session-title';
}
export interface LlmCallConfig {            // typert.host.js:341
  provider: string; model: string;
  reasoningEffort?: ReasoningEffortId;
  temperature?: number; maxTokens?: number; stop?: string[];
}
export interface ToolSchema {               // typert.host.js
  deferLoading?: true; name: string; description: string;
  parameters: Record<string, unknown>;
}
export type StreamChunk =                   // typert.host.js
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: ToolCallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope };
export interface FinishReasonMap {          // typert.host.js
  stop: { kind: 'stop' };
  'tool-calls': { kind: 'tool-calls' };
  'max-tokens': { kind: 'max-tokens' };
  aborted: { kind: 'aborted'; failure: LlmFailure };
  error: { kind: 'error'; failure: LlmFailure };
}
```

**关键约束（源码级）**：

1. **`stream()` 不会写会话历史。** README 的「Model-visible ⟺ logged」不变式约束的是 *loop-built* 请求；`dsh-llm` 的 README 明说「hand-built callers own input immutability」，且官方直接用 `ctx.llm.stream()` 的消费者（`dsh-session-title-llm`）要**自己追加一条 log-only 事件**（`session/title-llm-request`）来满足该契约 —— 见 `/tmp/dsh-asar/out/@deepseek-ai/dsh-session-title-llm/lib/index.js:196-226`。第三方插件**无法**新增 known 事件类型（见 §1.5），所以第三方直连调用必然是「未记录的」。
2. **不是 agent-loop 请求。** `markAgentLoopRequest` / `isAgentLoopRequest` 用进程内 `WeakSet` 标记 loop 组装的请求（`/tmp/dsh-asar/out/@deepseek-ai/dsh-llm/lib/types/call-config.js:33,42`）。插件自建的 `GenerateOptions` 不会被标记。
3. **因此没有自动重试。** `@deepseek-ai/dsh-llm-retry` 只挂钩 `agent/request-error`（`/tmp/dsh-asar/out/@deepseek-ai/dsh-llm-retry/lib/index.js:175`），其 README 逐字写着：「**direct `ctx.llm.stream()` calls remain single-attempt**」。重试、超时、协议校验全归调用方。
4. **`purpose` 是封闭联合**（`'compaction' | 'session-title'`），插件无法声明自己的 purpose，也就拿不到适配器对该 purpose 的特殊处理。
5. **`prepareCall` + `stream` 组合有坑**（→ 修正 DESIGN.md §4.4.3）：
   - `prepareCall` 内部调 `resolveCallWithInfo`，会**把适配器默认值物化进 config**：`const defaulted = config.maxTokens === undefined && info.defaultMaxTokens !== undefined ? { ...config, maxTokens: info.defaultMaxTokens } : config`（`index.js:694-698`）；
   - 随后 `stream(options)` 会做 `if (!callConfigEquals(options, resolvedConfig)) throw new LlmError(..., 'INVALID_PREPARED_CALL')`（`index.js:762`）；
   - `callConfigEquals` 逐字段比较 `provider/model/reasoningEffort/temperature/maxTokens/stop`（`lib/types/call-config.js:13-27`）。
   - **实测影响**：`dsh-llm-deepseek/lib/index.js:514` 设 `defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens`，`dsh-llm-pi-ai` 默认 `32768`（`dsh-llm-pi-ai/lib/index.js:1026,1119`）。所以只要适配器声明了默认值，`prepareCall(config)` 之后 `stream({...同一 config, maxTokens: 256})` **必然抛 `INVALID_PREPARED_CALL`**；连省略 `maxTokens` 也会抛（`undefined !== 默认值`）。
   - **正确姿势**（官方与社区一致）：`const resolved = await ctx.llm.resolveCallConfig({provider, model, reasoningEffort?, maxTokens}, signal)` → `ctx.llm.stream({ ...resolved, messages, system, tools, signal })`。
   - 证据：`dsh-session-title-llm/lib/index.js:206-226`（先组 options 再 `ctx.llm.stream(options)`，不经过 `prepareCall`）；社区 `TryDing-T/dsh-Plugin--ChineseChess` 的 `streamDecision` 同样是 `this.ctx.llm.resolveCallConfig(requested, signal)` → `deepFreeze({...resolved, messages, system, maxTokens, signal})` → `for await (const chunk of this.ctx.llm.stream(options))`。

**可用性评估**

| 维度 | 结论 |
| --- | --- |
| 额外 inject | 需要 `llm`（类插件 `static inject = ['agents','llm','sessionProjections']`；或函数式 `export const inject = [...]`）。**防御式写法**：`ctx.get('llm')` 不触发 Cordis inject 守卫，服务缺失时返回 `undefined` 而不抛（`dsh-project-compass/lib/llm.js` 就是这么写的；`ovdoesw/dsh-xiangqi` 的 `src/plugin.ts` 注释也解释了为什么不能用 `ctx.llm`）。 |
| 用户审批 | **不需要**。审批发生在工具派发（`tools/pre-execute`）与 `plugin_manager`/沙箱写操作上；`ctx.llm.stream()` 不经这些门。 |
| 阻塞 UI | **不阻塞**。`stream()` 是异步可迭代；但**若在 `defineTool.execute` 里 `await` 它，会阻塞该工具调用（进而阻塞整个 agent 回合）**。放在自建 HTTP 路由 / 后台任务里则不阻塞任何东西 —— 这正是 `TryDing-T` 的做法（`requestAiMove` 由面板经 Typert Remote 触发）。 |
| 失败模式 | 终止分片 `finish.reason.kind ∈ {error, aborted}`，携带稳定 `failure.code`：`NO_ADAPTER`、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`AUTH`、`RATE_LIMIT`、`QUOTA`、`ACCOUNT_QUOTA`、`CONTEXT_WINDOW_EXCEEDED`、`IMAGE_OFFLOAD_REQUIRED`、`UNSUPPORTED_REASONING_EFFORT`（`dsh-llm/README.md`「Failures and recovery」+ `resolveCallWithInfo`）。**按 code 路由，不要解析 message 文本。** |
| 思考模型陷阱 | 推理模型的隐藏思考会吃掉 `maxTokens`，`blocks()` 里只剩空文本 → 表现为「模型没回应」。`TryDing-T` 为此专门有 `EMPTY_RESPONSE` 分支，并建议「调低思考程度后重试」。 |

### 1.2 路径 B —— 唤醒当前会话，让会话用工具走棋

**这是受支持的一等 API，DESIGN.md §4.4.1 的「未找到受支持的入口」结论需要修正。**

```ts
export interface Agent {                        // dsh-agent-preset-registry/lib/typert.host.js:235
  readonly id: SessionId;
  readonly options: AgentOptions;               // :247 → { provider?, model?, reasoningEffort?, maxTokens?, subagentDepth? }
  readonly session: Session;
  readonly inbox: Inbox;
  readonly status: AgentStatus;
  readonly ctx: Context;
  cancel(cause: AgentCancelCause, options?: CancelOptions): void;
  whenIdle(): Promise<void>;
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void;
  followup(message: UserMessage): void;
  steer(message: UserMessage): void;
  inject(message: UserMessage): void;
}
```

实现（**同步、无返回值、不抛**，只做 inbox splice）：

- `/tmp/dsh-asar/out/@deepseek-ai/dsh-agent-loop/lib/index.js:806-814`
  ```js
  followup(input) { this.send(input, 'next-turn', true) }   // 排队一个完整新回合并唤醒
  steer(input)    { this.send(input, 'next-step', true) }   // 下一个 step 边界消费；idle 则起一回合
  inject(input)   { this.send(input, 'next-step', false) }  // 只入上下文，不唤醒
  ```
- 取句柄：`ctx.agents.get(sessionId): Agent | undefined`；工具内可直接用 `exec.agent`（证据：`dsh-tool-todo/lib/index.js:172`）。另有 `ctx.agents.currentInitiator(): Agent | undefined`（`dsh-agent/lib/index.js:368`），工具执行链天然处于 initiator 边界内。
- 构造消息：`createUserMessage({ content: [{type:'text', text}], source })`（`dsh-llm/lib/types/message.js:53`）。
- `source` 校验极宽：`user/message` 只要求 `source` 是非空字符串 `kind` 的对象（`dsh-session/lib/types/index.js:266-269`），`{ kind:'plugin', plugin:'xiangqi', form:'notice', summary }` 即可。
- 官方先例：`dsh-schedule` 用 `runMaintenance()` + `followup()` 唤醒运行中的根会话；`dsh-webhook` 用 `handle.agent.followup(...)`（但只开新会话）。
- **社区实证**：`9527ccccccc/dsh-xiangqi` 的人走子 → `wakeAgent()` → `ctx.get('agents').get(sessionId).followup(createUserMessage({...}))`；悔棋/重开走 `inject`。

**注意**：没有任何「emit 一个事件让 loop 自然起一轮」的机制。全量事件目录里 `agent/*` 只有 `agent/created`(serial)、`agent/pre-step`(waterfall)、`agent/request`(waterfall)、`agent/request-error`(waterfall)、`agent/turn-stopping`(serial)、`agent/status|error|assistant-stream|inbox/*`(emit) 与 `agent/disposed`——**没有可供插件 emit 的「注入用户消息」事件**。`agent/inbox/*` 是纯通知。`session.append('user/message', ...)` 会落一条持久消息但**不唤醒驱动**，会话忙碌时不会被执行。

**可用性评估**

| 维度 | 结论 |
| --- | --- |
| 额外 inject | `agents`（或 `ctx.get('agents')`）。不需要 `llm`。 |
| 审批 | 不需要。 |
| 阻塞 | 不阻塞调用方（同步入队即返回）。但它**会真的跑一个 agent 回合**：占用会话、消耗完整系统提示+历史+工具的 token、在 UI 里可见。会话正忙时会排队（`next-turn`）或在下个 step 插入（`steer`）。 |
| 失败模式 | 几乎不失败：找不到活 agent（会话未加载）→ 入不了队；abort 中的 agent → `send` 会把 `next-turn` 降级处理（`dsh-agent-loop/lib/index.js:800-805`）。真正的失败在下游：模型报错、模型只回一段闲聊而不调工具、工具参数非法。 |
| 会话历史 | 留下 `user/message`（source `plugin`）**以及模型自己的所有回复与工具调用**。一步棋 = 一整个回合的可见历史。 |

### 1.3 路径 C —— 子代理 / team（跑一个只负责走棋的子代理）

```ts
export interface SubagentStartRequest {      // dsh-subagent/lib/typert.host.js:779
  readonly label?: string;
  readonly prompt: ContentBlock[];
  readonly parent: Agent;
  readonly signal: AbortSignal;
  readonly agentOptions?: AgentOptions;      // provider/model/reasoningEffort/maxTokens 覆盖
  readonly outputSchema?: ObjectJsonSchema;  // 强制结构化输出
  readonly maxDepth?: number;
  readonly toolFilter?: ToolRestriction;
  readonly persona?: string;
}
export interface SubagentRun { readonly id: SessionId; readonly localAgent: Agent | undefined;
  readonly result: Promise<SubagentResult>; dispose(): Promise<void>; }   // :767
export interface SubagentResult { readonly output: readonly ContentBlock[]; readonly structured?: unknown;
  readonly diagnostic?: string; readonly stopReason: SubagentStopReason; }
// SubagentStopReasonMap = { completed, aborted, error, 'max-tokens', refusal }  （typert.host.js）
```

- `ctx.subagents.start(name, request): Promise<SubagentRun>` —— `/tmp/dsh-asar/out/@deepseek-ai/dsh-subagent/lib/index.js:3115`
- `ctx.subagents.startContinuable(spec)`、`sendMessage(sender,targetId,content,options)`、`interrupt(targetSessionId, authority)`、`listChildren/listDescendants`
- `ctx.agentTeams.spawnTeammate(caller, request)` / `sendMessage` / `createTask` / `waitForChange`（Cordis Inspect `host/Service` 实证；`dsh-experimental-agent-team` 要求持久化存储）
- 模型面工具：`subagent`（`dsh-tool-subagent`）、`spawn_teammate`（`dsh-experimental-tool-agent-team`）、`send_message`/`interrupt_agent`/`list_agents`（`dsh-tool-subagent-control`）
- 子代理的路由：不传 `agentOptions` 时继承父会话**最近一条已记录请求**的 provider/model（`dsh-tool-subagent/README.md`「Selecting a child LLM」）。

**可用性评估**

| 维度 | 结论 |
| --- | --- |
| 依赖 | 必须已挂载 `dsh-subagent` + 一个 provider（如 `dsh-subagent-spawn-in-process`）。**本机 profile 已挂载**（Cordis Inspect 服务目录里有 `subagents`，且本会话暴露 `subagent` 工具）。但第三方插件不能假设任何 profile 都挂了 —— 必须 `ctx.get('subagents')` 判空降级。 |
| 深度限制 | 默认 `maxDepth = 1`（host `subagent.maxDepth` 设置）。我实测在子代理里再起子代理被拒：`subagent depth 2 exceeds maxDepth 1`。 |
| 审批 | 取决于父会话的 permission preset：in-process provider 会**快照父会话的权限策略**，Auto 模式会逐个审查子调用（`dsh-subagent/README.md`「Parent, child, and delegation」）。可能弹审批。 |
| 阻塞 | `await run.result` 会等整个子回合（前台模式）；后台模式返回 jobId。 |
| 失败模式 | `stopReason ∈ {completed, aborted, error, max-tokens, refusal}`，另有 `diagnostic`；必须有 `run.dispose()` 释放句柄（`settleRun`, `dsh-subagent/lib/index.js:2731`）。 |
| 成本 | 每个子代理 = **一个新会话** + 完整系统提示 + 工具集。对「走一步棋」而言极重，且 `spawn_teammate` 的固定策略是「只有用户显式要一个团队时才创建」。 |

**结论：不适合**「每一步棋起一个子代理」。适合的只有：把整盘棋托管给一个长期存在的子代理（但那样每步仍要么靠工具、要么靠直连 LLM）。

### 1.4 路径 D —— 会话 Remote（`sessionController.prompt`）

- 客户端半边用 `ctx.sessions.binding(id).session.prompt(content, 'queue')`（社区 `DamonKoy/dsh-web-ui` 的 `packages/dsh-task-board/src/core/execution.ts` 就这么驱动真实会话），宿主侧是 `@Remote('prompt') prompt(request, signal)`（Cordis Inspect `host/Service.sessionController`）。
- 该路径**强制 `source.kind = 'user'`**，插件身份会丢，且能冷启动（resume）一个未加载的会话。可从浏览器半调，不能从宿主半直接调（它是 Remote）。
- **对宿主半插件不可用**，不推荐。

### 1.5 路径 E（反面）—— 自建会话事件

`session.append(type, data, ...opts)` 只接收 `surfaceOp` / `sourceEventSeqs`（`dsh-session/lib/index.js:1441`、`lib/types/index.js:566-572`），**无法设置信封上的 `ignorable`**。而 `KNOWN_SESSION_EVENT_TYPES` 的注释逐字写着：

> 「Downstream (out-of-repo) plugin events are outside this list by construction. The persisted `SessionEvent.ignorable` marker is the compatibility mechanism; **event-name registration was rejected**」
> —— `/tmp/dsh-asar/out/@deepseek-ai/dsh-session/lib/types/known-event-types.js:13-18`

持久化读路径会拒绝未知且未标 `ignorable` 的事件类型，直接让**整个会话不可读**：

> `if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) throw unsupported('session "..." contains event type "..." unknown to this harness and not marked ignorable; refusing to interpret the log')`
> —— `/tmp/dsh-asar/out/@deepseek-ai/dsh-session-persistence/lib/index.js:184`

`TryDing-T/dsh-Plugin--ChineseChess` 的 README 正是踩了这个坑：「旧版本（≤0.1.16）的历史会话若包含未标记 `ignorable: true` 的 `xiangqi/change`，当前 DSH 可能拒绝读取」——新版本因此**不再产生任何自定义会话事件**。

**推论：第三方插件不要写自定义会话事件。** 这也意味着「用 log-only 事件记录每次 AI 请求以维持 Model-visible⟺logged」这条官方路线对第三方不可用。

---

## 2. 「模型主动调用工具走棋」vs「插件直接调用 LLM」

| 维度 | 会话代理（路径 B：followup + `xiangqi_move` 工具） | 直连 `ctx.llm`（路径 A） |
| --- | --- | --- |
| **触发时机** | 人落子 → 宿主半 `followup()` 入队 → agent loop 在**当前或下一个回合**自然组装请求（含系统提示、AGENTS.md、历史、全部工具） | 人落子 → 宿主半立刻自行组装请求（只有你写的那几条 message） |
| **模型路由** | 无需解析。`installModelSelection` 把会话选中的 provider/model/effort 通过 `agent/request` waterfall 绑进请求（`dsh-agent/lib/types/model-selection.js:66-80`），`pending` 选择在下一个已准入请求上生效 | 必须自己解析，四级优先 `pending → requestHeader().config → requestContext() → agent.options`（再加 `agentDefaultModel.currentSelection()`），并在 dispatch 前重校验 revision |
| **会话历史留下什么** | `user/message`（source `plugin`）+ 模型的 assistant 消息 + `xiangqi_move` 的 tool/result。**一步棋 = 一段可见对话**，且永久留在日志里 | **什么都不留**（`ctx.llm.stream` 不写 log；想留也留不了，见 §1.5） |
| **token 成本** | 每步 = 完整系统提示 + 全部历史 + 全部工具 schema ≈ 数千~上万 input token（且随对局步数增长） | 每步 = 你的提示词（局面 + 候选目录，几百 token）+ 输出。可 `maxTokens` 硬限 |
| **可观测 / 可打断** | 用户看得见模型在「思考」，能按停止按钮、能 steer、能读到 reasoning | 用户看不见；面板只能自己画「AI 计算中…」。但**可精确超时**（20s 到点即 abort 并兜底） |
| **失败兜底** | 白拿 `dsh-llm-retry`（`agent/request-error`）的自动重试；但「模型回了一堆分析不落子」只能靠 `agent/turn-stopping` 再 steer（复杂） | 全自建：超时、重试、协议校验、非法着法回灌。可控性最强 |
| **非法着法** | 天然优雅：工具返回 `ok:false` + 「这枚子能走到哪」，模型在**同一回合**自我纠正，插件侧零重试逻辑 | 必须自己设计重试协议（把错误+合法着法目录追加进 messages 再调一次） |
| **与用户真实工作的关系** | 会**打断/占用**用户的编码会话；用户在写代码时对手在思考，两者抢同一个 agent | 完全旁路。用户继续写代码，棋盘自己在旁边走 |
| **实现量** | 极小。社区参考实现 `wakeAgent()` ≈ 40 行（含提示词） | 较大。路由解析 ~60 行 + 候选冻结 + 协议校验 + 重试 + 卸载闸门 |
| **思考模型** | 由 agent loop 与 UI 正常处理 reasoning 流 | 隐藏思考可能吃光 `maxTokens` → 空文本，需要专门分支 |

**推荐（对 `dsh-xiangqi-mate`）：以路径 A（直连 `ctx.llm`）为主线，理由基于源码能提供的保证：**

1. **产品定位是「棋友 / 陪练」，不是「任务」。** 把象棋塞进用户的编码会话（路径 B）会让一步棋占用一整个 agent 回合、污染会话日志、并让「我正在写代码」和「对手在思考」互相干扰。这与 DESIGN.md 的产品描述（启动即现棋盘、与当前配置的模型对弈）不符。
2. **路径 B 的唯一硬优势（路由零成本）可以被路径 A 精确复制**：`dsh-api-session-controller/lib/index.js:281-305` 的 `selectionFor` 就是权威的四级解析顺序，照抄即可，包括 `header.adapterDefaults?.reasoningEffort === true ? undefined : headerConfig.reasoningEffort` 这个容易漏的细节。
3. **失败处理无论如何都要自己写。** 即便走路径 B，「模型只回闲聊不落子」「模型超时」「用户不想等」这些场景仍需要插件兜底；而插件兜底协议一旦写好，直连调用的额外实现成本很低。
4. **`usage` 可直接用于 FR23 的 token 展示**（`chunk.type === 'usage'`），路径 B 拿不到「这一手棋花了多少 token」的归属。
5. **路径 A 不会触发任何审批**，也不会因为会话正忙而排队。

**但要保留路径 B 作为可选形态**：如果用户明确想要「看模型认真思考这盘棋、并能插话指导」，路径 B 的体验更好（reasoning 可见、可 steer）。建议做成 `Config.opponent.mode: 'direct' | 'session'`，v0.1.0 只实现 `direct`。

**若走路径 A，务必修掉 DESIGN.md §4.4.3 的两个问题**：
- 用 `resolveCallConfig` + `stream`，**不要** `prepareCall` + `stream`（§1.1 第 5 条，会抛 `INVALID_PREPARED_CALL`）。
- 路由解析补上 `requestContext()` 与 `agent.options` 两级，并把 `agentDefaultModel.currentSelection()` 放在最后（它只是**新会话的部署默认值**，不保证等于当前会话的模型 —— `dsh-agent-default-model/README.md`「One process-wide default — per-session model selection remains the entry point's responsibility」）。

---

## 3. 社区同类插件调研（联网）

社区**已有三个**中国象棋 DSH 插件，恰好覆盖了全部三种 AI 对手架构。

### 3.1 `9527ccccccc/dsh-xiangqi` —— 唤醒会话 + 工具走棋

- 仓库：<https://github.com/9527ccccccc/dsh-xiangqi>（MIT；README 中文）
- `package.json`：`name: "dsh-xiangqi"`、`type: module`、`main: lib/index.js`、
  `exports: { ".": "./lib/index.js", "./client": "./lib/client.js" }`、
  `dsh: { client: { platform: "web" } }` —— **没有 `dsh.bundle`**，也没有任何 `build`/`prepare` 脚本（`scripts` 里只有 `test`）
- **工具集**：`xiangqi_board` / `xiangqi_move` / `xiangqi_undo` / `xiangqi_hint`（`lib/index.js` 的 `TOOL_NAMES`），用 `defineTool` + `ctx.tools.register`，包在 `ctx.effect` 里
- **棋盘承载槽位**：`ctx.sidebarRightTabs.register({id, kind, title, guide})` 注册 tab **类型**，再用该 `id` 作 key 注册 `ctx.slots.register({ name: 'sidebar.right.pane.tab', key }, Body)` 的**正文**（两阶段，`lib/client.js`）
- **宿主半 inject**：`['tools', 'connection', 'webServer']`；面板↔宿主走**自建 HTTP 前缀路由** `ctx.webServer.register({kind:'prefix', path:'/xiangqi', handler})` + `ctx.connection.requestRejection(req)` 做认证（作者实测 `ctx.connection.rpc.handle()` 报 `cannot get property "webServer" without inject` 走不通），客户端 800 ms 轮询
- **AI 走棋机制**（= 路径 B）：人落子 → `wakeAgent()` → `ctx.get('agents').get(sessionId).followup(createUserMessage({ content:[{type:'text', text: 提示词 + 局面}], source:{kind:'plugin', plugin:'xiangqi', form:'notice', summary} }))`；悔棋/重开用 `inject`（只通知不唤醒）；**会话自己用 `xiangqi_move` 落子时绝不唤醒**（否则自走循环）
- **免构建实证**：`lib/client.js` 是**手写**的单文件，以 `window.__ModuleLoader__.load({ id: 'dsh-xiangqi', factory: (require) => { ... exports.apply = apply; exports.inject = inject; return module.exports } })` 形态直接交给 ModuleLoader，只 `require('react')` / `require('react/jsx-runtime')`
- **安装**：不走 `dsh plugin add`（因为无 `dsh.bundle`），改为「profile `node_modules` 目录联接 + 仓库内反向 `node_modules` 联接 + 手工 patch 行」；`docs/install.md` 有完整步骤与踩坑表
- **已实现**：完整棋规（perft 验过 1/2/3/4 = 44/1920/79666/3290240）、中文记谱双向转换、悔棋、支招、回合制对局、落盘（`state/games.json`）
- **未实现 / 已知边界**：长将长捉不自动判定（走三次重复判和）；只在 Windows 实跑过；宿主 API 对齐 DSH `0.1.5-rc.2`；无 npm 发布
- 作者还留了一份极有价值的 API 侦察笔记（写于 0.1.5-rc.2）：
  `docs/research/dsh-plugin-api.md`、`docs/research/dsh-client-ui.md`

### 3.2 `ovdoesw/dsh-xiangqi` —— 本地引擎 + LLM 只做点评

- 仓库：<https://github.com/ovdoesw/dsh-xiangqi>；收录页 <https://awesome-dsh-plugin.com/>（awesome 列表第 4503 行）
- `package.json`：`name:"dsh-xiangqi"`、`dsh.bundle.patch: "./cordis.patch.yml"`、`dsh.client.inject: []`、`platform:"web"`、`peerDependencies: { "@deepseek-ai/cordis": ">=0.1.0", "react": ">=17" }`
- **构建**：`npm run build` = `node scripts/build.mjs`（esbuild，`external: ['react','react/jsx-runtime','react-dom']`，banner/footer 手工拼出 `window.__ModuleLoader__.load({id, factory})` 外壳）
- **承载槽位**：`ctx.slots.register({ name: 'shell.overlay', id: 'xiangqi-mascot', store, inject }, XiangqiOverlay)` —— 悬浮宠物 + 小面板 + 全屏棋盘；`inject = ['slots']`
- **AI 走棋机制**：**内置本地引擎**（negamax + α-β + 迭代加深，异步分片不阻塞主线程），难度分档 easy/medium/hard。**LLM 只用于「局势点评」**，且：
  - **刻意不 inject `llm`**。源码注释逐字：「`llm` is deliberately NOT in this list: the `llm` service (LlmRuntime) is provided by the DSH host process, never by the web-boot context where this client plugin runs. Declaring it here would make the web boot sweep report `pending (waiting for service: llm)` and fail activation — cordis inject waiting has no timeout.」
  - 用 `ctx.get('llm')` 取，取不到就让点评静默降级为 `null`
  - provider 取 `ctx.llm.listProviders()[0].id`，model **硬编码回退到 `'deepseek-v4-pro'`**（作者注明这是本部署的 opencode-go 路由）
  - 支持 `settings.llmOverride = { base, key, model }` 直连 OpenAI 兼容 `/chat/completions`
- **已实现**：悬浮宠物、可拖拽 + 位置持久化、小面板/全屏棋盘、难度切换、悔棋、新局、开局定式名、三国杀风格台词、LLM 点评（pro/fun 两风格）、状态持久化（浏览器本地）
- **未实现**：联网对战、外部 UCI 引擎、开局库、音频播报；长将长捉为简化规则
- **值得注意的两个瑕疵**：`INTEGRATION.md` 里的 `cordis.patch.yml` 形状（`plugins: - plugin: ...`）与实际 patch 文件（`- insert: - id/name`）不一致，且包名 `dsh-xiangqi` 与 npm 上的保留名冲突

### 3.3 `TryDing-T/dsh-Plugin--ChineseChess` —— 直连 `ctx.llm`

- 仓库：<https://github.com/TryDing-T/dsh-Plugin--ChineseChess>；收录页 <https://awesome-dsh-plugin.com/p/TryDing-T/dsh-Plugin--ChineseChess/>（Just for Fun，★9，2026-09-01 收录）
- 包名：`@deepseek-ai/dsh-plugin-xiangqi` v0.1.19 —— **不在 npm 上**，从 GitHub Release 的 `.tgz` 安装
- `package.json`：`dsh.bundle.patch: "./cordis.patch.yml"` + `dsh.client.inject: [dsh-api-remotes, dsh-client-store, dsh-client-ui-layout, dsh-client-ui-sidebar, dsh-client-ui-slots]` + `platform:"web"`；`peerDependencies` 锁定 `0.1.5-alpha.1` 一线
- **构建**：`tsc -b`（host → 官方 Typert 生成器 → tsdown host）→ `tsc -b` + `tsdown`（client）。重量级、需要 Typert 生成器
- **AI 走棋机制 = 路径 A，且做法非常接近本设计的选型**：
  - `XiangqiService.static inject = ['agents','llm','sessionProjections']`
  - 路由解析 `resolveDecisionRoute(agent, request)`：`ctx.sessionProjections.stateOf(agent.session, 'modelSelection').pending` → `agent.session.requestHeader()`（并用 `header.adapterDefaults?.reasoningEffort === true` 抹掉继承的 effort）→ `agent.session.requestContext()` → `agent.options`；显式覆盖优先；缺失即抛 `INVALID_DECISION`，**绝不静默猜模型**
  - 冻结决策包：本地 α-β 搜索压出**最多 5 个候选**，连同 `gameId + revision + positionId` 冻结成一个不可变 packet
  - `streamDecision`：`this.ctx.llm.resolveCallConfig({provider, model, maxTokens, reasoningEffort?}, signal)` → `deepFreeze({...resolved, messages:[createUserMessage({...})], system: DECISION_SYSTEM_PROMPT, maxTokens, signal})` → `new BlockAssembler()` 逐 chunk `push` → 校验
  - 协议校验码：`INVALID_JSON | INVALID_SHAPE | UNKNOWN_FIELD | POSITION_MISMATCH | OBSERVATION_MISMATCH | UNKNOWN_CANDIDATE | ILLEGAL_CANDIDATE | NOT_BLACK_TURN`
  - 协议错误**重试**（`obtainDecision` 的 `for attempt <= retryCount`，把上一次的错误原因回灌）；`tool-calls` finish 视为 `INVALID_SHAPE`；空文本报 `EMPTY_RESPONSE` 并提示「调低思考程度」
  - 提交前重校验 revision / 局面事实 / 候选合法性；**卸载闸门**（`XiangqiDecisionGate`）保证 destroy 后旧结果永不提交
  - **明确不做本地引擎兜底**：失败时 revision 不变，棋盘停在黑方回合，面板给「重新请求 DSH 落子」按钮
  - 棋局是**进程内全局**（跨聊天共享），**不落盘**，**不写会话历史**（这是它 README 的首条卖点）
- **已实现**：侧栏棋盘、多标签页状态同步、最小化悬浮条、悔棋/新局/认输/棋谱复制、决策追踪（`getDecisionTrace`，可见 provider/model/effort/耗时/输出字数）、取消同一次决策、卸载时等待所有模型流结束
- **未实现**：长将长捉不自动判定；无本地引擎；无磁盘持久化

### 3.4 npm 上的 `dsh-xiangqi` 是**占位包**

```json
{ "name": "dsh-xiangqi", "version": "0.0.1",
  "description": "Xiangqi partner for dsh agents - name reserved; first release in development.",
  "author": { "name": "dushaobindoudou" },
  "repository": { "url": "git+https://github.com/dushaobindoudou/dsh-plugin.git", "directory": "packages/dsh-xiangqi" } }
```
`main` / `exports` / `dsh` 全为 `null` —— **只占名，无代码**。来源：<https://registry.npmjs.org/dsh-xiangqi>（发布 2026-09-10）。
→ **`dsh-xiangqi` 这个名字在 npm 上已被占用**，`dsh-xiangqi-mate` 不受影响，但也说明「dsh-xiangqi」不能作为本项目的包名。

### 3.5 `dsh-task-board` / `dsh-aionui-panel`

两者都不是独立 npm 包（`https://registry.npmjs.org/dsh-task-board` 与 `/dsh-aionui-panel` 均返回 `{"error":"Not found"}`），而是 **`DamonKoy/dsh-web-ui`（即 `@linxin666` 全家桶）** 里的子包，通过聚合包 `@linxin666/dsh-web-ui-all` 发布：

| 包 | 仓库路径 | 版本 | UI 承载 | 干啥 |
| --- | --- | --- | --- | --- |
| `@linxin666/dsh-client-ui-task-board` | `packages/dsh-task-board` | 0.1.16 | 侧栏入口 + 多列 kanban | 任务看板，**通过 `session.prompt` 真的驱动 DSH 会话执行任务** |
| `@linxin666/dsh-client-ui-aionui-panel` | `packages/dsh-aionui-panel` | 0.1.16 | 右栏 Explorer + Preview | 文件树 / 搜索 / git changes / 多标签预览 |

- 仓库：<https://github.com/DamonKoy/dsh-web-ui>（作者署名 `zhu1090093659`）
- 两者 `package.json` 都同时声明 `dsh.bundle.patch` **和** `dsh.client.inject`，构建脚本都是 **`tsc -b && tsdown`**（`tsdown@0.22.2`）
- `cordis.patch.yml` 形状：
  ```yaml
  - insert:
      - id: ui-dsh-aionui-panel
        name: '@linxin666/dsh-client-ui-aionui-panel'
  ```
- `dsh-task-board` 的 `src/core/execution.ts` 用 `sessions.binding(id).session.prompt(content, 'queue')` + `getSnapshot()` 观察回合，说明**客户端半**确实能驱动会话（= §1.4 路径 D）

### 3.6 社区插件产出 client half 的通行做法

| 做法 | 实例 | 是否必须构建器 |
| --- | --- | --- |
| `tsdown`（+ tsc）产出 `lib/client.js` | `@linxin666/dsh-*` 全家桶（task-board / aionui-panel / pet / git-graph …）、`TryDing-T/dsh-Plugin--ChineseChess` | 是 |
| `esbuild` 手工拼 ModuleLoader 外壳 | `ovdoesw/dsh-xiangqi`（`scripts/build.mjs`） | 是 |
| **手写 `lib/client.js`，零构建** | **`9527ccccccc/dsh-xiangqi`**（`package.json` 无任何 build 脚本，`files` 里直接就是 `lib/`） | **否** |

**通行契约（无论哪种做法，产物形态一致）**：

1. `package.json` 声明 `dsh.client = { platform: 'web', inject?: string[], external?: string[], immediately?: boolean }`，并用 `exports["./client"]` 指向那个 bundle 文件。声明校验器逐字在 `/tmp/dsh-asar/out/@deepseek-ai/dsh-client-modules/lib/index.js:57-73`（`platform` 必填且必须是字符串；`inject`/`external` 是可选字符串数组；`immediately` 可选布尔）。
2. bundle 执行时必须调用 `window.__ModuleLoader__.load({ id: <包名>, factory: (require) => exports })`；`<包名>/client` 会被归一化成包名（`stripClientSuffix`，同文件 `:96-98`）。
3. `factory` 返回的必须是合法 Cordis 客户端插件（`apply(ctx)` / `inject`）。
4. `require` 能解析的只有**冻结的平台基座表** + 已登记工厂；其余必须在 `dsh.client.external` 里声明。
5. 宿主**不校验产物来源或构建痕迹**——README 只说「The host serves built client bundles, so `pnpm run build` must have produced each `lib/client.js` before launch; a missing bundle fails activation loudly」，即**只要求文件存在**，不要求它是打包器产物。这正是手写免构建可行的根因，`9527ccccccc/dsh-xiangqi` 是活证据。

**平台基座表（PLATFORM_MODULES）**：本机解包产物里**没有**这张表——它由 web shell（`apps/web`，不在 `@deepseek-ai/*` 包内）通过 `createClientModuleSystem({ staticModules })` 注入（`/tmp/dsh-asar/out/@deepseek-ai/dsh-client-modules/lib/client.js:548,853`）。社区反向记录了一份（`DamonKoy/dsh-web-ui` 的 `shared/web-platform.ts`，URL：<https://raw.githubusercontent.com/DamonKoy/dsh-web-ui/HEAD/shared/web-platform.ts>）：

```ts
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-schema-form',
] as const
```
→ **社区来源，非本地可验证**。间接佐证：`9527ccccccc/dsh-xiangqi` 的 `dsh.client` 里 `inject`/`external` 都没写，却直接 `require('react')`、`require('react/jsx-runtime')` 并能跑。

### 3.7 未查证 / 死胡同

- **未查证**：`dsh.deepseek404.com/detail.php?id=ovdoesw/dsh-xiangqi`（搜索结果里出现过，未抓取内容）。
- **未查证**：是否存在官方 DSH「插件开发文档」站点。`https://github.com/deepseek-ai/deepseek-harness` 返回 200，但 `raw.githubusercontent.com/.../main/packages/AGENTS.md` 是 404，README 引用的 `docs/**` 与 `.agents/notes/**` 都不在已安装的 npm 包里（`dsh` 包 `files` 只有 `lib/*.js`）。awesome 列表也没有指向官方 authoring 文档的链接。
- **不存在**：独立 npm 包 `dsh-task-board`、`dsh-aionui-panel`（registry 直接 404）。
- 本地 client 侧 Cordis Inspect（`client/Service`、`client/Slots`）两次查询都超时 —— `Client inspect query ... timed out after 10000ms. Open or reconnect the Harness page`，说明本会话里没有已连接的页面。**因此「客户端服务目录里是否存在 `llm`」未能实测**；`ovdoesw/dsh-xiangqi` 的源码注释（该服务「never provided by the web-boot context」）是唯一的（间接）证据。

---

## 4. 对 `dsh-xiangqi-mate` 的推荐方案

### 4.1 先修正 DESIGN.md 的两处结论

| 位置 | 原文 | 应改为 |
| --- | --- | --- |
| §4.4.1 方案 A 的「评价」列 | 「❌ **未找到受支持的"向会话发起一轮"入口**」 | **错。** `Agent.followup/steer/inject` 是一等 API（`dsh-agent-preset-registry/lib/typert.host.js:235`；实现 `dsh-agent-loop/lib/index.js:806-814`），官方先例 `dsh-schedule`，社区实证 `9527ccccccc/dsh-xiangqi`。方案 A 的**真正**缺点是「污染会话历史 + 占用用户回合 + 无法精确超时 + 成本高」，而不是「入口不存在」。 |
| §4.4.2 模型选择表 | 第 2 行 `ctx.agentDefaultModel.currentSelection()` 作为「DSH 当前配置的 AI 模型」；脚注说「若能找到读取当前会话所选模型…」 | 要读取**当前会话**的模型，用它：`ctx.sessionProjections.stateOf(agent.session, 'modelSelection')`，与 `agent.session.requestHeader()` / `requestContext()` / `agent.options` 组成四级链。`agentDefaultModel.currentSelection()` **只是新会话的部署默认值**（`dsh-agent-default-model/lib/index.js:38`，README「One process-wide default — per-session model selection remains the entry point's responsibility」），作为最后一档兜底。权威实现见 `dsh-api-session-controller/lib/index.js:281-305`。 |
| §4.4.3 步骤 2-3 | `ctx.llm.prepareCall({...})` → `stream({...})` | **会抛 `INVALID_PREPARED_CALL`。** 改为 `ctx.llm.resolveCallConfig(config, signal)` → `ctx.llm.stream({ ...resolved, messages, system, tools, signal })`。 |

### 4.2 推荐方案：宿主半直连 `ctx.llm`，工具调用形态，本地引擎兜底

保留 DESIGN.md §4.4 的主结论（方案 B），按下面补齐：

**（1）路由解析**（照抄 `dsh-api-session-controller/lib/index.js:281-305` 的顺序）

```
1. Config.opponent.provider / .model              用户显式覆盖
2. modelSelection.pending                         会话里已选但尚未生效的模型（切模型后无需先发消息）
3. agent.session.requestHeader()?.config          会话最新一条已记录请求（注意 adapterDefaults.reasoningEffort === true 时要抹掉 effort）
4. agent.session.requestContext()                 最新已解析路由元数据
5. agent.options                                  Agent 创建时的路由
6. ctx.agentDefaultModel.currentSelection()       部署默认（新会话用）
7. 全部失败 → 以本地引擎开局，面板标注「本地引擎」
```

服务缺失一律 `ctx.get(...)` 判空，不 `ctx.xxx`（避免 Cordis inject 守卫抛错把整个插件树拖垮）。

**（2）决策协议**（照抄 `TryDing-T` 的「冻结候选」思路）

- 本地 α-β 搜索 → 取 **top-5 合法着法**，分配稳定的 `candidateId`
- 冻结 `{ decisionId, gameId, revision, positionId, fen, sideToMove, lastMove, candidates[] }` 为不可变 packet
- `system`：只走一步、必须调用 `xiangqi_move`、不得解释规则、不得给多个候选
- `user`：packet 的 JSON
- `tools: [xiangqi_move 的 ToolSchema]`（`{ name:'xiangqi_move', description, parameters }`）
- `maxTokens` **必须显式给足**（推理模型的隐藏思考会吃预算）；`temperature` 低

**（3）失败兜底矩阵**

| 失败 | 处理 |
| --- | --- |
| `ctx.get('llm') === undefined` / 无 provider-model | 开局即本地引擎；面板显示「本地引擎」；记录一次 `ai.fallback.no-llm` |
| `resolveCallConfig` 抛 `NO_ADAPTER` / `UNSUPPORTED_REASONING_EFFORT` | 丢掉 effort 重试一次 → 仍失败则本地引擎 |
| `finish.reason.kind === 'aborted'`（含自建 20 s 超时 abort） | **不重试**，直接本地引擎代走；面板明说「模型超时，已由本地引擎代走」 |
| `finish.reason.kind === 'error'` | 按 `failure.code` 分流：`RATE_LIMIT`/`QUOTA`/`ACCOUNT_QUOTA` → 不退避重试，直接降级并提示；其余 → 指数退避重试 1 次，再降级 |
| `finish.reason.kind === 'max-tokens'` 或文本为空 | 判定为「隐藏思考吃光预算」：**把 `reasoningEffort` 降一档重试一次**，仍空 → 降级 |
| `finish.reason.kind === 'tool-calls'` 但参数解析失败 / `candidateId` 不在候选里 / 走了红方 | 视为协议错误：把「错误原因 + 合法着法目录」追加进 messages，**重试 ≤2 次** |
| 纯文本回退（模型没调工具，只在文本里写了中文记谱/ICCS） | `parseAnyMove(text)` → 命中候选则接受；否则同上按协议错误重试 |
| 提交前 `revision` 已变 / 候选已不合法 | **丢弃结果，不落子**（revision 栅栏）；面板给「重新请求」按钮 |
| 用户不想等 | 面板提供「立即由本地引擎代走」按钮 |
| token 失控 | `Config.opponent.maxTokensPerMove` + `maxTokensPerGame` 双限；超限停用模型并降级，状态条说明原因 |

**（4）卸载 / HMR 闸门**（照抄 `XiangqiDecisionGate`）

- `destroyed` 标志；`apply()` 的 disposer 里先置位再 `controller.abort()`
- 所有「提交落子」路径提交前检查 `destroyed` 与 `decisionId === activeDecisionId`
- disposer **必须 await 所有在飞的 `ctx.llm.stream()` 迭代结束**再返回（Cordis 支持异步 disposer；`TryDing-T` 明确这么做）
- 唯一在跑决策的 id 由闸门持有，保证「同时只有一个 AI 在思考」

**（5）要写进 DESIGN.md 的负面清单**

- **绝不** `session.append('<plugin>/...', ...)` —— 第三方无法设 `ignorable`，会让整个会话在冷读时不可解析（§1.5）。
- **绝不**把 `await ctx.llm.stream()` 放进 `defineTool.execute` —— 会阻塞整个 agent 回合。放在自建 HTTP 路由或后台任务里。
- **绝不**用 `ctx.llm` 属性访问未 inject 的服务 —— 用 `ctx.get('llm')`。

### 4.3 双半与构建

- 沿用 DESIGN.md §4.5 的**零依赖、免构建、手写 bundle** 结论 —— 已被 `9527ccccccc/dsh-xiangqi` 完整验证（其 `package.json` 无任何 build 脚本、`lib/client.js` 手写 ModuleLoader 形态并实际运行）。
- 但**必须补上 `dsh.bundle.patch`**（`9527ccccccc` 没写，导致 `dsh plugin add` 装不上、要手工做目录联接）。正确形态：
  ```json
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  }
  ```
  `cordis.patch.yml`：
  ```yaml
  - insert:
      - id: xiangqi
        name: 'dsh-xiangqi-mate'
  ```
  （社区全家桶与 `ovdoesw` 都是这一形态；`TryDing-T` 的 patch 也是。）
- 包名 `dsh-xiangqi-mate` 与 npm 上被占用的 `dsh-xiangqi` 不冲突。

---

## 5. 引用的关键证据清单（本机）

```
dsh-llm/lib/types/index.js:686,694-698,730,752-770,927      llm 服务的调用面与 prepareCall 陷阱
dsh-llm/lib/typert.host.js:313,341,452                      GenerateOptions / LlmCallConfig / ReasoningEffortId
dsh-llm/lib/types/call-config.js:13-27,33,42                callConfigEquals / agent-loop 请求标记
dsh-llm/lib/types/message.js:53                             createUserMessage
dsh-llm/lib/types/assembler.js:54,99-100                    tool-call 块的装配
dsh-llm-retry/lib/index.js:175                              重试只挂 agent/request-error
dsh-llm-retry/README.md                                     "direct ctx.llm.stream() calls remain single-attempt"
dsh-llm-deepseek/lib/index.js:514                           defaultMaxTokens 物化来源
dsh-llm-pi-ai/lib/index.js:1026,1119                        defaultMaxTokens = 32768
dsh-agent-preset-registry/lib/typert.host.js:235,247        Agent / AgentOptions 接口
dsh-agent/lib/index.js:368                                  ctx.agents.currentInitiator()
dsh-agent/lib/types/model-selection.js:44-92                installModelSelection（路由如何绑进请求）
dsh-agent-default-model/lib/index.js:38                     currentSelection()（部署默认）
dsh-agent-loop/lib/index.js:806-814                         followup / steer / inject 实现
dsh-session/lib/types/index.js:266-269,566-572,628,647      user/message source 校验 / append 签名 / requestHeader / requestContext
dsh-session/lib/index.js:1441                               append 只接 surfaceOp/sourceEventSeqs
dsh-session/lib/types/known-event-types.js:13-18            第三方事件在 known 集合之外（契约性）
dsh-session-persistence/lib/index.js:184                    未知非 ignorable 事件 → 拒绝解释日志
dsh-session-projection/lib/index.js:127                     stateOf(session, key)
dsh-session-projection/README.md                            宿主读投影需 inject sessionProjections
dsh-api-session-controller/lib/index.js:281-305             权威路由解析顺序
dsh-api-session-controller/lib/index.js:2089-2103           modelSelection 投影（pending/lastUsed）
dsh-subagent/lib/index.js:3115                              ctx.subagents.start(name, request)
dsh-subagent/lib/typert.host.js:767,779                     SubagentRun / SubagentStartRequest
dsh-tool-subagent/README.md                                 agentOptions 继承父会话最新已记录路由；maxDepth 默认 1
dsh-tool-todo/lib/index.js:172                              exec.agent 的实证用法
dsh-session-title-llm/lib/index.js:196-226                  官方「插件直连 ctx.llm」的样板
dsh-client-modules/lib/index.js:20-32,57-73,96-98           client bundle 契约 / dsh.client 校验 / id 归一化
dsh-client-modules/lib/client.js:548,853                    平台基座表由 shell 注入
dsh-client-modules/README.md                                "host serves built client bundles"（只要求文件存在）
dsh-app-boot/lib/index.js:4049,4082                         "plugin tree failed to load" 失败模式
dsh-experimental-agent-team/README.md                       teammate 机制与限额
```

外部 URL：见 §3 各条。
