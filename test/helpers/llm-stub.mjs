/**
 * `ctx.llm` 的可编程替身，用于验证 §4.4.4 的失败矩阵与重试计数。
 *
 * 每个 reply 描述**一次** `stream()` 的行为；调用次数超出列表时复用最后一个。
 * 同时记录每次 `resolveCallConfig` 的入参，便于断言「降 effort 重试」真的改了 config。
 */

export function createLlmStub(replies = []) {
  const calls = [];
  const resolvedConfigs = [];
  const list = replies.length > 0 ? replies : [{ type: 'empty' }];

  function replyFor(index) {
    return list[Math.min(index, list.length - 1)];
  }

  return {
    calls,
    resolvedConfigs,
    /** 供 `effortLadder` 读取的档次目录。 */
    async resolveModelInfo() {
      return {
        provider: 'stub',
        id: 'stub-model',
        name: 'stub-model',
        reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }] },
      };
    },
    async resolveCallConfig(config) {
      resolvedConfigs.push({ ...config });
      return { ...config };
    },
    stream(options) {
      const index = calls.length;
      calls.push(options);
      const reply = replyFor(index);
      return generate(reply, options);
    },
  };
}

async function* generate(reply, options) {
  const signal = options?.signal;
  switch (reply.type) {
    case 'tool-call': {
      const args = JSON.stringify(reply.args ?? {});
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id: 'tc-1', name: 'xiangqi_move', argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'tc-1', name: 'xiangqi_move', arguments: args } };
      yield { type: 'usage', usage: reply.usage ?? { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    case 'text': {
      yield { type: 'text-delta', index: 0, text: reply.text ?? '' };
      yield { type: 'usage', usage: reply.usage ?? { inputTokens: 50, outputTokens: 10, totalTokens: 60 } };
      yield { type: 'finish', reason: { kind: reply.kind ?? 'stop' } };
      return;
    }
    case 'max-tokens': {
      yield { type: 'text-delta', index: 0, text: reply.text ?? '' };
      yield { type: 'finish', reason: { kind: 'max-tokens' } };
      return;
    }
    case 'empty': {
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    case 'error': {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: reply.code ?? 'UNKNOWN', message: reply.message ?? 'boom' } } };
      return;
    }
    case 'aborted': {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'aborted' } } };
      return;
    }
    case 'throw': {
      const error = new Error(reply.message ?? 'thrown');
      error.code = reply.code ?? 'UNKNOWN';
      throw error;
    }
    case 'hang': {
      await new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
          return;
        }
        signal?.addEventListener?.('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORTED' })), { once: true });
      });
      return;
    }
    default: {
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
}
