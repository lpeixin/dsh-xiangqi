/**
 * 宿主半自检记录（临时诊断通道）。
 *
 * 为什么需要它：RPC 通道注册失败时，插件只能 `logger.warn` —— 而宿主没有可读的日志文件，
 * 外部又只能看到「POST /xiangqi-mate/state → 405」这一个事实。于是所有可能的根因
 * （服务晚到 / handle 抛错 / 路由被顶掉）都无法区分。
 *
 * 这里把注册过程的关键步骤记在内存里，并由 `lib/tools/render.js` 渲染进工具正文——
 * 工具是模型唯一能读到的宿主侧出口，因此这是**不需要日志文件也能拿到真相**的最短路径。
 * 定位完成后应当整块删除（连同 render.js 里的那一行）。
 */

const entries = [];
const MAX = 30;

/**
 * 记一条自检信息。
 * @param {string} stage 阶段标识。
 * @param {unknown} [detail] 附加细节（会被折成短字符串）。
 */
export function note(stage, detail) {
  try {
    const text = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : safe(detail)}`;
    entries.push(`[${new Date().toISOString().slice(11, 23)}] ${stage}${text}`);
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  } catch {
    /* 自检绝不影响功能 */
  }
}

function safe(value) {
  try {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 取当前自检记录（副本）。 */
export function report() {
  return entries.slice();
}

/** 清空自检记录（测试用）。 */
export function reset() {
  entries.length = 0;
}
