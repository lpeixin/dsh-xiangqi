/**
 * 提示词契约（§6.4）——本文件是提示词的**唯一真相**，便于测试与迭代。
 *
 * 系统提示要求模型：只走一步、必须调用 `xiangqi_move`、不得解释规则、不得给出多个
 * 候选、不得替人类方走子。用户消息是局面数据包（§5.6 的 describePosition + 冻结候选）。
 */

export const MOVE_TOOL_NAME = 'xiangqi_move';

export const MOVE_TOOL_DESCRIPTION =
  '提交本回合唯一的一步象棋着法。必须且只能调用一次。' +
  'move 可写 ICCS 坐标（如 h2e2）或中文记谱（如 炮二平五）；也可以只回 candidateId。';

export const MOVE_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    move: { type: 'string', description: '着法，ICCS（h2e2）或中文记谱（炮二平五）' },
    candidateId: { type: 'string', description: '合法着法目录中的 ICCS，与 move 二选一' },
    reason: { type: 'string', description: '一句话理由（可选，仅用于展示）' },
  },
  additionalProperties: false,
};

export const SYSTEM_PROMPT = [
  '你是中国象棋的执黑（或执红）对局引擎。你的唯一任务是走**一步**棋。',
  '规则：',
  '1. 必须调用工具 `xiangqi_move`，且只调用一次；',
  '2. 只走一步，不要连续走多步；',
  '3. 不要解释规则、不要复述局面、不要给出多个候选；',
  '4. 不得替人类一方走子（局面里的“轮到你”说明当前走子方就是你）；',
  '5. 只从提供的合法着法目录中选择；如果目录为空说明对局已结束。',
  '6. reason 保持一句话以内。',
].join('\n');

/** 生成用户侧局面数据包。`compact` 为真时只给最少信息（CONTEXT_WINDOW_EXCEEDED）。 */
export function buildPacket({ engine, position, side, lastMove, history, candidates, compact = false, maxMoves = 40 }) {
  const sideZh = side === 'r' ? '红方' : '黑方';
  if (compact === true) {
    const fen = safe(() => engine.positionToFen(position), '');
    const last = lastMove === null || lastMove === undefined ? '（开局）' : `${lastMove.zh ?? ''} ${lastMove.iccs ?? ''}`.trim();
    return [`轮到${sideZh}走子。`, `FEN: ${fen}`, `上一手: ${last}`, '请调用 xiangqi_move 走一步。'].join('\n');
  }
  const described = safe(() => engine.describePosition(position, { includeMoves: false, includeEval: true, ascii: true }), '');
  const lines = [];
  lines.push(`请你以${sideZh}身份走一步。`);
  if (described !== '') lines.push(described);
  else lines.push(`FEN: ${safe(() => engine.positionToFen(position), '')}`);
  if (lastMove !== null && lastMove !== undefined) {
    lines.push(`上一手：${lastMove.zh ?? ''}（${lastMove.iccs ?? ''}）`);
  }
  if (Array.isArray(history) && history.length > 0) lines.push(`已走 ${history.length} 手。`);
  lines.push(`合法着法目录（${candidates.length} 个，请只从中选择；回 candidateId 或 move 均可）：`);
  lines.push(candidates.slice(0, maxMoves).map((entry) => `${entry.iccs} ${entry.zh}`).join(' | '));
  lines.push('现在调用 xiangqi_move 走一步。');
  return lines.join('\n');
}

/** 协议错误后的补正消息：错误原因 + 当前合法着法目录（§4.4.4）。 */
export function buildRetryMessage(reasonZh, candidates, maxMoves = 40) {
  const catalog = candidates.slice(0, maxMoves).map((entry) => `${entry.iccs} ${entry.zh}`).join(' | ');
  return [`你上一次的输出无法接受：${reasonZh}`, `合法着法目录：${catalog}`, '请严格从目录中选择一步，并调用 xiangqi_move。'].join('\n');
}

/** 组装一条 user 消息（`GenerateOptions.messages` 的形状）。 */
export function userMessage(text) {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function safe(read, fallback) {
  try {
    const value = read();
    return typeof value === 'string' ? value : fallback;
  } catch {
    return fallback;
  }
}
