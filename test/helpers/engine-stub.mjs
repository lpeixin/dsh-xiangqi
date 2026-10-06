/**
 * 临时引擎 stub（仅测试用；**不得**放进 lib/）。
 *
 * 目的：M2（宿主半）依赖 §5.3 冻结的引擎签名，而 M1（`lib/engine/**`）由另一个
 * agent 并行实现。本 stub 提供一份**最小但真实**的实现，让 M2 的契约测试与集成
 * 测试在没有真实引擎时也能跑、且断言具备实际意义。
 *
 * **它不再是默认底座**：`test/helpers/engine.mjs` 默认要求真实引擎齐备（缺失即红灯），
 * 只有显式设置 `XIANGQI_ENGINE=stub` 才会用它。引擎缺失时插件的降级行为另有专门测试。
 *
 * 与真实引擎的差异（见交付报告）：
 *  - 只做「休闲规则」：长将/自然限着/三次重复为简化实现；
 *  - 评估函数只有子力项，无位置项；
 *  - 搜索是「吃子优先 + 确定性挑选」，不是 alpha-beta；
 *  - `describePosition` 的输出格式是自定的，真实引擎输出会更丰富。
 */

export * from './engine-stub-core.mjs';
export * from './engine-stub-notation.mjs';
