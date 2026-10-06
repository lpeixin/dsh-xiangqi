/**
 * 测试用引擎解析器。
 *
 * **默认必须使用真实引擎（`lib/engine/**`，M1 交付）**：引擎缺失或 §5.3 的 API 不齐时，
 * `testEngine()` 直接抛错，让整套契约测试**红灯**——否则会出现「真实引擎一行都跑不了，
 * 而契约测试全绿」这种比红灯更危险的假绿。
 *
 * 只有在显式设置 `XIANGQI_ENGINE=stub` 时才回落到 `engine-stub.mjs`（并打印醒目告警）。
 * 引擎缺失时插件的降级行为另有专门测试：`test/integration/engine-missing.test.js`。
 */

import * as stub from './engine-stub.mjs';
import { REQUIRED_ENGINE_API, bindEngine, engineFailure, loadEngine, missingEngineApi } from '../../lib/game/engine.js';

const choice = { source: 'unset', module: null, missing: [], error: null };

/** 是否通过环境变量强制使用替身引擎。 */
export function stubForced() {
  return process.env.XIANGQI_ENGINE === 'stub';
}

/** 取得（并在首次调用时绑定）本轮使用的引擎实现；真实引擎不可用时抛错。 */
export async function testEngine() {
  if (choice.module !== null) return choice.module;
  if (stubForced()) {
    choice.source = 'stub';
    choice.module = bindEngine(stub);
    choice.missing = missingEngineApi(stub);
    // 走 stderr：stdout 是测试运行器 IPC 的通道，写入会破坏整仓并发跑。
    process.stderr.write('[xiangqi] ⚠️ XIANGQI_ENGINE=stub：本轮使用测试替身引擎，结论不代表真实引擎，禁止作为交付依据\n');
    return choice.module;
  }
  let real;
  try {
    real = await import('../../lib/engine/index.js');
  } catch (error) {
    real = undefined;
    choice.error = error instanceof Error ? error.message : String(error);
  }
  const missing = real === undefined ? [...REQUIRED_ENGINE_API] : missingEngineApi(real);
  if (real === undefined || missing.length > 0) {
    choice.source = 'missing';
    choice.missing = missing;
    throw new Error(
      `真实引擎不可用${choice.error === null ? '' : `（${choice.error}）`}；缺失 API：${missing.join(', ') || '(整个模块缺失)'}。` +
        '如需临时用替身跑通请显式设置 XIANGQI_ENGINE=stub。',
    );
  }
  choice.source = 'real';
  choice.missing = [];
  choice.module = bindEngine(real);
  return choice.module;
}

/** 本轮实际使用的引擎来源与缺失 API（报告用）。 */
export function engineChoice() {
  return { source: choice.source, missing: [...choice.missing], error: choice.error };
}

/** 模拟「引擎半成品」：绑定一个缺 API 的模块，供降级路径测试使用。 */
export function bindPartialEngine(module) {
  choice.source = 'partial';
  choice.module = null;
  return bindEngine(module);
}

export { stub, engineFailure, loadEngine, missingEngineApi, REQUIRED_ENGINE_API };
