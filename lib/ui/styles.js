/**
 * 面板样式（§7.3）。
 *
 * 三条硬约束：
 *  1. **配色全部走主题令牌**，不写 `@media (prefers-color-scheme: dark)`——那会忽略用户
 *     的 DSH 主题偏好。木色棋盘面走 `ctx.theme.overrideTokens` 注册的
 *     `--xiangqi-*` 令牌，并**回落到 alias 令牌**（令牌被改名时只是观感退化）；
 *  2. 类名手工加 `xq-` 前缀（不与宿主页面撞车）；
 *  3. 动效全部 ≤200 ms，并且只在 `prefers-reduced-motion: no-preference` 下启用；
 *     reduce 时改为静态标记（不位移、不脉冲）。
 *
 * 注入方式用 §4.5 推荐的「组件内渲染 `<style>`」：随组件卸载自动移除，不会残留。
 *
 * **布局不变量（别改回去）**：棋盘的尺寸是按 `.xq-boardArea` 的**实测高度**算出来的
 * （`computeGeometry`），所以任何会随内容长高的兄弟节点都会把棋盘挤小。
 * 因此：`.xq-boardArea` 有 `min-height` 下限，`.xq-moves` 有 42% 上限且可收缩，
 * `.xq-movesList` 只负责在父容器内滚动（**不写死 max-height**）。
 * 曾经的写法是给 `.xq-movesList` 写 `max-height:168px`——棋谱一长，长高的是着法块、
 * 缩小的却是棋盘。
 */

/** 稳定 id：同一份 CSS 只应有一个标签，便于排查重复注入。 */
export const STYLE_ID = 'xq-panel';

/** 面板 CSS。 */
export const CSS = `
.xq-root{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family);font-size:13px;line-height:20px}
.xq-inMain{padding-top:var(--dsh-frame-top-clearance,0px)}
html[data-platform=darwin] .xq-inMain{padding-left:var(--dsh-frame-leading-clearance,0px)}
.xq-header{display:flex;flex-direction:column;gap:6px;padding:10px 12px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.xq-headerRow{display:flex;align-items:center;gap:8px;min-width:0}
.xq-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap}
.xq-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.xq-meta b{font-weight:500;color:var(--dsw-alias-label-secondary)}
.xq-clock{font-family:var(--ds-font-family-code);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.xq-headerSpacer{flex:1;min-width:0}
.xq-boardArea{position:relative;flex:1 1 auto;min-height:220px;display:flex;align-items:center;justify-content:center;padding:8px 10px;overflow:hidden}
.xq-board{display:block;touch-action:none;border-radius:var(--dsw-radius-lg);outline:none}
.xq-board:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.xq-boardFace{fill:var(--xiangqi-board-face,var(--dsw-alias-bg-layer-1));stroke:var(--dsw-alias-border-l4)}
.xq-riverBand{fill:var(--xiangqi-river,var(--dsw-alias-bg-layer-2))}
.xq-grid{stroke:var(--xiangqi-grid,var(--dsw-alias-border-l3));stroke-linecap:square}
.xq-border{stroke:var(--xiangqi-grid,var(--dsw-alias-border-l4));fill:none}
.xq-riverText{fill:var(--xiangqi-grid,var(--dsw-alias-label-caption));letter-spacing:.28em;opacity:.75;user-select:none}
.xq-pieceFace{fill:var(--xiangqi-piece-face,var(--dsw-alias-bg-layer-1));stroke:var(--dsw-alias-border-l4)}
.xq-pieceInk{font-family:var(--dsw-font-family);font-weight:600;text-anchor:middle;dominant-baseline:central;user-select:none}
/* 红方字色：92% 的 state-error-primary 掺 8% 的 label-primary。
   为什么要掺：亮色下红-600(#ec1313) 画在白底盘上只有 4.50:1，正好卡在 WCAG 的 4.5 门槛
   下沿；掺一点该主题的「对立极」（亮色=近黑、暗色=近白）后两个方案都在 5:1 以上，
   而且两个输入都是主题令牌，仍然随主题自适应（不是自持常量）。 */
.xq-pieceRed{fill:color-mix(in srgb, var(--dsw-alias-state-error-primary) 92%, var(--dsw-alias-label-primary))}
.xq-pieceBlack{fill:var(--dsw-alias-label-primary)}
.xq-pieceRing{fill:none;opacity:.5}
.xq-selectRing{fill:none;stroke:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.xq-cursorBox{fill:none;stroke:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));stroke-dasharray:3 2}
.xq-lastLine{stroke:var(--dsw-alias-interactive-bg-hover-accent);stroke-linecap:round}
.xq-lastDot{fill:var(--dsw-alias-interactive-bg-hover-accent)}
.xq-targetDot{fill:var(--dsw-alias-state-business-tertiary);stroke:var(--dsw-alias-state-business-primary);stroke-width:.6;opacity:.9}
.xq-targetRing{fill:none;stroke:var(--dsw-alias-state-business-primary);opacity:.85}
.xq-checkRing{fill:none;stroke:var(--dsw-alias-state-error-secondary)}
.xq-hintLine{stroke:var(--dsw-alias-state-business-primary);fill:none;stroke-linecap:round}
.xq-hit{fill:transparent}
.xq-hoverCell{fill:var(--dsw-alias-interactive-bg-hover);pointer-events:none}
.xq-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.xq-status{display:flex;align-items:center;gap:6px;min-height:30px;margin:0 10px 8px;padding:5px 9px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.xq-statusText{min-width:0;flex:1;overflow-wrap:anywhere}
.xq-status-info{border-color:var(--dsw-alias-border-l2)}
.xq-status-warn{color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-secondary)}
.xq-status-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary)}
.xq-status-success{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-secondary)}
.xq-dot{flex:none;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-label-caption)}
.xq-dot-info{background:var(--dsw-alias-state-business-primary)}
.xq-dot-warn{background:var(--dsw-alias-state-warn-primary)}
.xq-dot-error{background:var(--dsw-alias-state-error-primary)}
.xq-dot-success{background:var(--dsw-alias-state-success-primary)}
.xq-dot-thinking{width:7px;height:7px}
.xq-hints{display:flex;flex-wrap:wrap;gap:4px 10px;padding:0 10px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.xq-hintItem{display:inline-flex;align-items:baseline;gap:4px;min-width:0;padding:2px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}
.xq-hintRank{font-family:var(--ds-font-family-code);font-variant-numeric:tabular-nums;opacity:.75}
.xq-hintScore{font-family:var(--ds-font-family-code);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.xq-toolbar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:0 10px 10px}
.xq-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:1;cursor:pointer}
.xq-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.xq-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.xq-btn:disabled{opacity:.45;cursor:default}
.xq-btnPrimary{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.xq-btnDanger{border-color:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}
.xq-moves{display:flex;flex-direction:column;flex:0 1 auto;min-height:0;max-height:42%;border-top:.5px solid var(--dsw-alias-border-l2);padding:6px 6px 10px}
.xq-movesHead{display:flex;align-items:center;gap:6px;padding:2px 6px 6px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.xq-movesList{margin:0;padding:0;list-style:none;overflow-y:auto;min-height:0;flex:1 1 auto;max-height:none}
.xq-moveRow{display:flex;align-items:center;gap:4px;padding:1px 0}
.xq-moveNo{width:26px;flex:none;text-align:right;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
.xq-moveCell{flex:1;min-width:0;text-align:left;padding:2px 6px;border-radius:var(--dsw-radius-xs);border:.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xq-moveCell:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.xq-moveCell:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.xq-moveCell:disabled{cursor:default;opacity:.5}
.xq-moveActive{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.xq-moveEmpty{color:var(--dsw-alias-label-caption)}
.xq-confirm{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 10px 8px;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-state-warn-secondary);color:var(--dsw-alias-label-secondary);font-size:12px}
.xq-confirmText{flex:1;min-width:120px}
.xq-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;flex:1;min-height:0;padding:24px;color:var(--dsw-alias-label-tertiary);text-align:center;font-size:12px}
.xq-notice{margin:0 10px 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
@media (prefers-reduced-motion:no-preference){
.xq-dot-thinking{animation:xq-pulse 1s ease-in-out infinite}
.xq-drop{animation:xq-drop 180ms cubic-bezier(.2,.8,.3,1)}
.xq-captureGhost{animation:xq-capture 120ms ease-in forwards}
.xq-undoGhost{animation:xq-undo 160ms ease-out forwards}
.xq-checkRing{animation:xq-check 600ms ease-out 2}
.xq-lastMarker{animation:xq-lastFade 2s ease-out forwards}
.xq-shake{animation:xq-shake 120ms ease-in-out}
}
@media (prefers-reduced-motion:reduce){
.xq-lastMarker{opacity:.45}
.xq-checkRing{stroke-dasharray:2 2}
}
@keyframes xq-drop{from{transform:translate(var(--xq-dx,0px),var(--xq-dy,0px))}to{transform:translate(0,0)}}
@keyframes xq-capture{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(.55)}}
@keyframes xq-undo{from{transform:translate(var(--xq-dx,0px),var(--xq-dy,0px))}to{transform:translate(0,0)}}
@keyframes xq-check{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
@keyframes xq-lastFade{from{opacity:.9}to{opacity:.45}}
@keyframes xq-pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes xq-shake{0%,100%{transform:translate(0,0)}25%{transform:translate(-2px,0)}75%{transform:translate(2px,0)}}
`;
