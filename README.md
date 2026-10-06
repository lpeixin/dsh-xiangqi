# dsh-xiangqi-mate · Xiangqi Mate

> A human-vs-AI Chinese Chess (Xiangqi) plugin for [DeepSeek Harness](https://harness.deepseek.com).
> Open the panel and a beautifully minimal board appears — **you play Red, the AI model configured in your DSH session plays Black.**

English | [中文](README.zh-CN.md)

---

## What it is

Not a collection of chess utilities — **a game you can actually finish**.

| | |
| --- | --- |
| **Board in the right panel** | A session-scoped tab beside your conversation, so playing never interrupts what you were doing |
| **The opponent is your model** | By default the model configured for the current session plays Black. The plugin issues the requests itself, so **your chat history is not filled with chess** |
| **A local engine covers failures** | Timeout, rate limit, or an illegal move from the model → the built-in alpha-beta engine plays instead, and the panel tells you exactly what happened |
| **Notation works both ways** | The board shows `炮二平五`; you can also just say "炮二平五" — no coordinates required |
| **Zero dependencies, no build** | The host half uses only Node built-ins; the browser half is a hand-written single-file bundle. Installing runs no scripts |
| **The engine stands alone** | `lib/engine/**` is pure functions that know nothing about DSH — reuse it in any project |

### How it differs from the community plugins

Three Xiangqi plugins for DSH already exist, covering three architectures:

| Plugin | How the opponent moves |
| --- | --- |
| `9527ccccccc/dsh-xiangqi` | Wakes the current session and lets the model move via tools |
| `TryDing-T/dsh-Plugin--ChineseChess` | Calls `ctx.llm` directly (same route as this plugin) but stalls when the model fails |
| `ovdoesw/dsh-xiangqi` | Local engine only; the model just comments (does not use the session model) |

This plugin takes **direct model calls + local-engine fallback**: less context than the first (a move never leaves a whole turn in your conversation), a real opponent unlike the third, and a game that keeps going when the model times out, unlike the second.

---

## Install

### Let Harness install it

```
plugin_manager { action: "install_bundle", target: "github:lpeixin/dsh-xiangqi-mate" }
```

Or clone the repository and install by absolute path:

```
plugin_manager { action: "install_bundle", target: "/path/to/dsh-xiangqi-mate" }
```

> Only `application: "applied"` counts as live. If you get `restart-required`, restart DSH.

### Manual

This repository is an installable bundle (`dsh.bundle.patch` points at `cordis.patch.yml`). Add it to your profile's `dsh.profile.bundles` and `dependencies`, then install.

### Disable without uninstalling

```yaml
- id: xiangqi
  disabled: true
```

---

## Using it

**Open the board** — any of three ways:

1. **Right panel "+" → Start page → "Xiangqi"** — this is also the only way to open it, since a static plugin has no host→client push channel to pop the panel open for you;
2. **Just say it in the conversation** ("let's play chess") — the model calls `xiangqi_new` and the board appears;
3. **The Xiangqi icon in the left sidebar** — opens the large board in the main area.

**Playing**

| Action | How |
| --- | --- |
| Move | Click a piece → legal targets highlight → click the target. Dragging works too |
| Review | The move list on the right is in Chinese notation; click any move to jump to that position |
| Undo | Toolbar **Undo** — returns to before your last move |
| Hint | Toolbar **Hint** — three candidates from the local engine, **no model tokens spent** |
| Resign / New game | Toolbar buttons, both confirm first |
| Keyboard | Tab into the board → arrow keys move the cursor → Enter selects/drops → Esc cancels |

**When the model misbehaves**, the status strip says so plainly: `AI is thinking…`, `Model timed out — the local engine played instead`, `The model returned an illegal move; retried twice, then the local engine played`, `Model budget for this game is exhausted; the local engine now plays`.

---

## Tools and commands

| Tool | Purpose |
| --- | --- |
| `xiangqi_new` | Start or restart a game |
| `xiangqi_board` | Current position: ASCII board, side to move, status, notation, legal moves |
| `xiangqi_move` | Play a move. `move` accepts ICCS (`h2e2`), Chinese notation (`炮二平五`), or `{from,to}` |
| `xiangqi_undo` | Take back moves |
| `xiangqi_hint` | Engine candidates and evaluation summary (no model cost) |
| `xiangqi_review` | Review: move list, turning points, evaluation curve |

Session command:

```
/xiangqi new | state | move 炮二平五 | undo | hint | resign | review
```

> Actions that need *your* authority — resigning — are user-only. The model cannot do them for you.

---

## Configuration

Edit your profile's `cordis.patch.yml`. **A patch replaces the whole `config`, it does not merge** — restate every key you want to keep.

```yaml
- id: xiangqi
  config:
    opponent:
      mode: model          # model | local
      timeoutMs: 20000
      maxRetries: 2
      maxTokensPerMove: 256
      maxTokensPerGame: 20000
    local:
      depth: 4
      timeMs: 300
    rules:
      fiftyMovePlies: 120
      perpetualCheckLoses: true
    ui:
      showCoordinates: true
      showEval: false
      animation: true
      clock: off           # off | perMove | total
```

`opponent.mode: local` produces no model requests at all. Leaving `opponent.provider` / `model` unset follows the current session's model route.

> **Note on config discovery.** The plugin declares its config with a hand-written, dependency-free StandardSchemaV1, so the values are validated and defaulted when the row activates, but the schema is **not** projected into DSH's config tooling (it reports `unsupported` rather than showing the fields). Write the keys above by hand in your patch file; this table is the reference. (The two sibling third-party plugins declare no config at all.)

---

## The engine, standalone

`lib/engine/**` is a **pure, dependency-free** Xiangqi rules engine. It imports nothing but its own sibling files — no DSH packages, no third-party code, no Node built-ins — so it runs in Node *and* can be inlined straight into a browser.

```js
import {
  initialPosition, generateMoves, applyMove, isLegalMove,
  positionFromFen, positionToFen, formatChinese, parseAnyMove,
  describePosition, evaluate, searchBestMove, gameStatus,
} from 'dsh-xiangqi-mate/lib/engine/index.js'
```

Implemented: full movement and legality for chariot, horse (blocked-leg), cannon (screen), elephant (blocked-eye, no river crossing), advisor, general (palace, flying-general), and soldier (sideways after the river); checkmate, **stalemate-as-a-loss**, threefold repetition, and the natural move limit; ICCS ⇄ Chinese notation with `前/后/中` disambiguation; position description and an explainable evaluation; iterative-deepening alpha-beta search.

Correctness is pinned to the published perft numbers ([docs/DESIGN.md](docs/DESIGN.md) §5.8):

```bash
node scripts/perft.mjs --depth 4
```

---

## Development

```bash
node --test                                   # unit tests
node --test --experimental-test-coverage      # coverage
node scripts/check-boundaries.mjs             # static boundary gate
node scripts/build-client.mjs --check         # lib/client.js is up to date
node scripts/perft.mjs --depth 3              # engine benchmark
node scripts/xiangqi-cli.mjs play --moves 60  # engine vs itself, prints Chinese notation
```

Engineering constraints (read [docs/DESIGN.md](docs/DESIGN.md) §9.3 first):

1. **Zero external dependencies** — the host half may only use `node:*` built-ins;
2. **`lib/client.js` is generated** — after editing `lib/engine/**` or `lib/ui/**`, run `npm run build:client` and commit the artifact;
3. **No `export default`** — it makes the Loader drop `inject`;
4. **Never append custom session events** — it makes the session unreadable after a restart;
5. **Never leave detached async work** — an unhandled rejection exits the whole DSH.

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/DESIGN.md](docs/DESIGN.md) | The full design: requirements, technical choices, engine spec, host/client design, layout, verification, milestones, risks, and **21 evidence entries for the DSH APIs used** |
| [docs/research/ai-move-paths.md](docs/research/ai-move-paths.md) | Research on how the AI should move (including the three community plugins) |
| [CHANGELOG.md](CHANGELOG.md) | Change history |

---

## Privacy and security

- **Your games stay local.** Records are written per session to `.xiangqi-mate/<sessionId>.json` under the session working directory (can be disabled), and are uploaded nowhere.
- **Only your configured model is called.** The plugin follows the session's model route; it never obtains credentials or adds external services.
- **Cost is visible.** The panel shows the cumulative token usage for the game, and `maxTokensPerGame` is a hard ceiling.
- **The RPC channel is scoped.** The browser↔host channel only reads and writes the chess state of the calling session, and only from your local browser.
- Vulnerability reports: see [SECURITY.md](SECURITY.md).

---

## License

MIT © 2026 Peixin
