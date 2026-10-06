/**
 * 引擎模块加载器 —— M2 与 M1 之间唯一的耦合点。
 *
 * 引擎（`lib/engine/**`，§5.3 冻结签名）由 M1 独立交付。这里用**动态 import** 而不是
 * 顶层静态 import，原因有两条：
 *
 * 1. 引擎缺失或半成品时，插件仍应能被 Loader 装载、工具仍应注册成功，并在真正需要
 *    引擎时给出清晰的中文错误，而不是让整个插件树在 import 阶段就失败；
 * 2. 引擎尚未就位时，测试可以注入等价 stub（`test/helpers/engine-stub.mjs`）跑通 M2
 *    的全部契约，待 M1 落地后无需改一行实现代码即可切到真实引擎。
 *
 * 真实引擎一旦存在，`loadEngine()` 会优先使用它；`bindEngine()` 只被测试调用。
 */

/** §5.3 冻结的公开 API（用于「引擎是否齐备」自检）。 */
export const REQUIRED_ENGINE_API = Object.freeze([
  'initialPosition',
  'positionFromFen',
  'positionToFen',
  'clonePosition',
  'pseudoLegalMoves',
  'generateMoves',
  'isLegalMove',
  'moveRejectReason',
  'applyMove',
  'isInCheck',
  'gameStatus',
  'moveToIccs',
  'iccsToMove',
  'formatChinese',
  'parseChinese',
  'parseAnyMove',
  'describePosition',
  'legalMoveCatalog',
  'evaluate',
  'searchBestMove',
]);

let bound = null;
let failure = null;

/** 测试用注入点：把一份引擎实现（stub 或真实模块）绑定为当前引擎。 */
export function bindEngine(module) {
  bound = module;
  failure = null;
  return bound;
}

/** 当前已绑定的引擎模块，未加载时为 null。 */
export function boundEngine() {
  return bound;
}

/** 上一次加载失败的原因（供面板/日志说明「引擎不可用」）。 */
export function engineFailure() {
  return failure;
}

/**
 * 列出模块相对 §5.3 缺失的 API 名字。
 * @param {object|undefined|null} module 候选引擎模块。
 * @returns {string[]} 缺失的导出名。
 */
export function missingEngineApi(module) {
  if (module === null || module === undefined) return [...REQUIRED_ENGINE_API];
  return REQUIRED_ENGINE_API.filter((name) => typeof module[name] !== 'function');
}

/**
 * 取得引擎模块（首次调用时加载并缓存），并**每次**复核 §5.3 的 API 齐备性。
 * @returns {Promise<object>} 引擎模块命名空间。
 * @throws {Error} 引擎缺失或 API 不齐时抛出带中文说明（含缺失清单）的错误。
 */
export async function loadEngine() {
  if (bound === null) {
    try {
      bound = await import('../engine/index.js');
    } catch (error) {
      failure = `模块加载失败：${error instanceof Error ? error.message : String(error)}`;
      throw new Error(`象棋引擎不可用：${failure}`);
    }
  }
  const missing = missingEngineApi(bound);
  if (missing.length > 0) {
    failure = `引擎缺少 API: ${missing.join(', ')}`;
    throw new Error(`象棋引擎尚不可用：${failure}`);
  }
  failure = null;
  return bound;
}

/**
 * 非抛出版加载：失败时返回 undefined，并把原因留在 `engineFailure()`。
 * @returns {Promise<object|undefined>} 引擎模块或 undefined。
 */
export async function tryLoadEngine() {
  try {
    return await loadEngine();
  } catch {
    return undefined;
  }
}
