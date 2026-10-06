/**
 * 模型输出 → 着法（§6.4「响应解析」的两级容错）。
 *
 *   1. tool-call 参数（`tool-call-delta` 累积 / `block-end` 的完整 block）；
 *   2. 文本块里的 ICCS 或中文记谱，用 `parseAnyMove` 在**合法着法集合**里做唯一匹配；
 *   3. 都拿不到 → 协议错误（调用方据此回灌「错误 + 合法着法目录」重试）。
 *
 * 本模块只做解析与校验，不发起请求、不修改对局。
 */

export const PARSE_CODES = Object.freeze({
  NO_OUTPUT: 'ai.protocol.empty',
  BAD_JSON: 'ai.protocol.bad-json',
  UNKNOWN_CANDIDATE: 'ai.protocol.candidate',
  ILLEGAL_MOVE: 'ai.protocol.illegal',
  AMBIGUOUS: 'ai.protocol.ambiguous',
  WRONG_SIDE: 'ai.protocol.wrong-side',
});

const ICCS_TOKEN = /\b[a-i][0-9][a-i][0-9]\b/gi;

function fail(code, reasonZh, detail) {
  return detail === undefined ? { ok: false, code, reasonZh } : { ok: false, code, reasonZh, detail };
}

/** 从流式分片里累积 tool-call 与文本。 */
export function createChunkCollector() {
  const toolCalls = new Map();
  const text = [];
  let reason = null;
  let usage = null;
  const stats = {};
  return {
    /** 各类型分片的计数（诊断用：能区分"模型没吐工具调用"与"吐了但我们没认"）。 */
    get stats() {
      return { ...stats };
    },
    get text() {
      return text.join('');
    },
    get toolCalls() {
      return [...toolCalls.values()];
    },
    get reason() {
      return reason;
    },
    get usage() {
      return usage;
    },
    push(chunk) {
      if (chunk === null || typeof chunk !== 'object') return;
      stats[chunk.type] = (stats[chunk.type] ?? 0) + 1;
      switch (chunk.type) {
        case 'text-delta':
          if (typeof chunk.text === 'string') text.push(chunk.text);
          break;
        case 'tool-call-delta': {
          const key = typeof chunk.id === 'string' ? chunk.id : `#${chunk.index ?? 0}`;
          const entry = toolCalls.get(key) ?? { id: key, name: undefined, arguments: '' };
          if (typeof chunk.name === 'string' && chunk.name !== '') entry.name = chunk.name;
          if (typeof chunk.argumentsDelta === 'string') entry.arguments += chunk.argumentsDelta;
          toolCalls.set(key, entry);
          break;
        }
        case 'block-end': {
          const block = chunk.block;
          if (block !== null && typeof block === 'object' && block.type === 'tool-call') {
            const key = typeof block.id === 'string' ? block.id : `#${chunk.index ?? 0}`;
            toolCalls.set(key, {
              id: key,
              name: typeof block.name === 'string' ? block.name : toolCalls.get(key)?.name,
              arguments: typeof block.arguments === 'string' ? block.arguments : (toolCalls.get(key)?.arguments ?? ''),
            });
          }
          break;
        }
        case 'usage':
          usage = chunk.usage ?? usage;
          break;
        case 'finish':
          reason = chunk.reason ?? null;
          break;
        default:
          break;
      }
    },
  };
}

/** 容错 JSON 解析：允许模型包一层 ```json 代码围栏或前后夹带解释。 */
export function parseToolArguments(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const text = raw.trim();
  const candidates = [text];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced !== null) candidates.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      /* 试下一个候选 */
    }
  }
  return null;
}

function candidateFor(candidates, iccs) {
  return candidates.find((entry) => entry.iccs.toLowerCase() === String(iccs).toLowerCase());
}

function resolveMove(engine, position, input) {
  try {
    return engine.parseAnyMove(position, input);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function accept(engine, position, candidates, move, source, reason) {
  let iccs = '';
  let zh = '';
  try {
    iccs = engine.moveToIccs(move);
    zh = engine.formatChinese(position, move);
  } catch {
    iccs = '';
    zh = '';
  }
  const known = iccs !== '' ? candidateFor(candidates, iccs) : undefined;
  return {
    ok: true,
    move: { from: move.from, to: move.to },
    iccs: iccs !== '' ? iccs : known?.iccs ?? '',
    zh: zh !== '' ? zh : known?.zh ?? '',
    capture: position.board[move.to] ?? '',
    candidateId: known?.iccs ?? null,
    source,
    reason: typeof reason === 'string' && reason.trim() !== '' ? reason.trim().slice(0, 200) : null,
  };
}

/**
 * 把一次模型输出解析成一步合法着法。
 * @param {object} options 解析选项。
 * @returns {object} `{ ok:true, move, iccs, zh, source }` 或 `{ ok:false, code, reasonZh }`。
 */
export function decideFromOutput({ engine, position, candidates, toolCalls, text, hero }) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (hero !== undefined && hero !== null && position.turn === hero) {
    // 「不得替人类方走子」：这是硬约束，宁可降级也不接受。
    return fail(PARSE_CODES.WRONG_SIDE, '当前是人类的回合，模型不得替人类走子');
  }
  const calls = (Array.isArray(toolCalls) ? toolCalls : []).filter(
    (call) => call !== null && typeof call === 'object' && (call.name === undefined || call.name === '' || call.name === 'xiangqi_move'),
  );
  let feedback = null;

  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    const args = parseToolArguments(call.arguments);
    if (args === null) {
      feedback = fail(PARSE_CODES.BAD_JSON, '工具调用参数不是合法 JSON');
      continue;
    }
    if (typeof args.candidateId === 'string' && args.candidateId.trim() !== '') {
      const hit = candidateFor(list, args.candidateId.trim());
      if (hit === undefined) {
        feedback = fail(PARSE_CODES.UNKNOWN_CANDIDATE, `candidateId「${args.candidateId}」不在本回合的合法着法目录内`);
        continue;
      }
      const resolved = resolveMove(engine, position, hit.iccs);
      if (resolved.move === undefined) {
        feedback = fail(PARSE_CODES.ILLEGAL_MOVE, `候选着法「${hit.iccs}」已不合法`);
        continue;
      }
      return accept(engine, position, list, resolved.move, 'tool-call', args.reason);
    }
    const requested = moveRequestOf(args);
    if (requested !== undefined) {
      const resolved = resolveMove(engine, position, requested);
      if (resolved.move === undefined) {
        feedback = fail(PARSE_CODES.ILLEGAL_MOVE, `着法「${requested}」无法解析：${resolved.error ?? '格式不正确'}`);
        continue;
      }
      if (!engine.isLegalMove(position, resolved.move)) {
        feedback = fail(PARSE_CODES.ILLEGAL_MOVE, `着法「${requested}」在当前局面不合法`);
        continue;
      }
      return accept(engine, position, list, resolved.move, 'tool-call', args.reason);
    }
    feedback = fail(PARSE_CODES.NO_OUTPUT, '工具调用里既没有 move 也没有 candidateId（move 写 ICCS 如 b5b6，或中文记谱如 车八进一）');
  }

  const fromText = fromPlainText(engine, position, list, text);
  if (fromText !== null) return fromText;
  if (feedback !== null) return feedback;
  return fail(PARSE_CODES.NO_OUTPUT, '模型没有给出任何可识别的着法');
}

/**
 * 从工具参数里取出「要走的着法」，尽量宽容地接受模型可能给出的形状。
 *
 * 我们发给模型的 schema 是 `move: string`，但实测模型会给出各种等价写法。**只认字符串**
 * 会把「模型其实答对了」判成「没给着法」→ 重试 → 降级，用户看到的是"模型不给力"，
 * 而真相是我们自己不认。这里把常见形状都折成一个可解析的字符串：
 *
 *   `{ move: 'h2e2' }` / `{ move: '炮二平五' }` / `{ iccs: 'h2e2' }`
 *   `{ move: { from: 'h2', to: 'e2' } }` / `{ from: 'h2', to: 'e2' }`
 *   `{ from: 70, to: 67 }`（索引）→ 由 resolveMove 侧的 parseAnyMove 处理不了索引，
 *   因此这里只在两侧都是坐标串时拼接。
 *
 * @param {object} args 工具参数。
 * @returns {string|undefined} 可交给 `resolveMove` 的着法字符串。
 */
function moveRequestOf(args) {
  if (args === null || typeof args !== 'object') return undefined;
  if (typeof args.move === 'string' && args.move.trim() !== '') return args.move.trim();
  if (typeof args.iccs === 'string' && args.iccs.trim() !== '') return args.iccs.trim();
  const nested = args.move !== null && typeof args.move === 'object' ? args.move : {};
  const from = typeof args.from === 'string' ? args.from : typeof nested.from === 'string' ? nested.from : undefined;
  const to = typeof args.to === 'string' ? args.to : typeof nested.to === 'string' ? nested.to : undefined;
  if (from !== undefined && to !== undefined && from.trim() !== '' && to.trim() !== '') {
    return `${from.trim()}${to.trim()}`;
  }
  return undefined;
}

function fromPlainText(engine, position, candidates, text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const tokens = [...new Set((text.match(ICCS_TOKEN) ?? []).map((token) => token.toLowerCase()))];
  const usable = tokens.filter((token) => {
    const resolved = resolveMove(engine, position, token);
    return resolved.move !== undefined && engine.isLegalMove(position, resolved.move);
  });
  if (usable.length === 1) {
    const resolved = resolveMove(engine, position, usable[0]);
    return accept(engine, position, candidates, resolved.move, 'text-iccs');
  }
  if (usable.length > 1) return fail(PARSE_CODES.AMBIGUOUS, `文本里出现多个合法着法：${usable.join(', ')}`);
  const hits = candidateHits(engine, position, candidates, text);
  if (hits.length === 1) {
    const resolved = resolveMove(engine, position, hits[0].iccs);
    if (resolved.move !== undefined) return accept(engine, position, candidates, resolved.move, 'text-zh');
  }
  if (hits.length > 1) return fail(PARSE_CODES.AMBIGUOUS, `文本里出现多个合法着法：${hits.map((hit) => hit.zh).join(', ')}`);
  return null;
}

function candidateHits(engine, position, candidates, text) {
  const compact = text.replace(/\s+/g, '');
  return candidates.filter((entry) => {
    if (typeof entry.zh !== 'string' || entry.zh === '') return false;
    if (!compact.includes(entry.zh)) return false;
    const resolved = resolveMove(engine, position, entry.iccs);
    return resolved.move !== undefined && engine.isLegalMove(position, resolved.move);
  });
}
