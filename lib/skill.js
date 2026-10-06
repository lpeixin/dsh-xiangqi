/**
 * 技能注册（FR18，§6.6）。
 *
 * 铁律：**技能注册失败绝不允许拖垮工具注册**。`skills` 是可选服务；服务缺失、
 * `SKILL.md` 读不到、或 `register` 抛错，都只是静默跳过（并在 debug 日志里留痕）。
 * 技能名用 kebab-case（`xiangqi-mate-playbook`），正文来自 `lib/SKILL.md`
 * ——用户安装后可直接编辑正文，不需要改代码。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILL_NAME = 'xiangqi-mate-playbook';
const SKILL_PATH = new URL('./SKILL.md', import.meta.url);
const FALLBACK_DESCRIPTION = '如何在 DSH 会话里与象棋棋盘协作：工具用法、记谱约定与对局礼仪。';
const FALLBACK_BODY = '与象棋棋盘协作：默认人类执红先行；xiangqi_move 只接受对手方着法；局面描述里已含合法着法目录。';

/**
 * 读取技能正文；缺失时返回 undefined（静默降级）。
 * 刻意使用**同步**读取：技能必须在 `apply()` 返回时就已注册完毕，
 * 否则会出现「插件已激活但技能还没出现」的窗口，也会给 dispose 引入竞态。
 */
export function readSkillBody() {
  try {
    const text = readFileSync(fileURLToPath(SKILL_PATH), 'utf8');
    return text.trim() !== '' ? text : undefined;
  } catch {
    return undefined;
  }
}

/** 从正文首行 `#` 标题或首个非空行摘出描述。 */
export function describeBody(body) {
  if (typeof body !== 'string') return FALLBACK_DESCRIPTION;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    return trimmed.slice(0, 160);
  }
  return FALLBACK_DESCRIPTION;
}

/**
 * 注册技能。
 * @param {object} ctx 插件上下文。
 * @returns {(() => void)|undefined} 注册 disposer，或未注册时的 undefined。
 */
export function registerSkill(ctx) {
  const skills = typeof ctx?.get === 'function' ? ctx.get('skills') : undefined;
  if (skills === undefined || skills === null || typeof skills.register !== 'function') return undefined;
  const body = readSkillBody() ?? FALLBACK_BODY;
  try {
    const disposer = skills.register({
      name: SKILL_NAME,
      description: describeBody(body),
      whenToUse: '用户想下中国象棋、打开棋盘面板、或调用了 xiangqi_* 工具时。',
      source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
      content: body,
    });
    return typeof disposer === 'function' ? disposer : undefined;
  } catch (error) {
    try {
      ctx?.logger?.debug?.(`[xiangqi] 技能注册失败：${error instanceof Error ? error.message : String(error)}`);
    } catch {
      /* 忽略 */
    }
    return undefined;
  }
}

export { SKILL_NAME };
