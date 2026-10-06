/**
 * 计时器（FR13）：累计双方用时 + 每手用时。
 *
 * 纯数据 + 纯函数；每手用时落在 `MoveRecord.ms`（§5.2），累计值落在
 * `GameState.clockMs`（§6.3）。配置 `ui.clock === 'off'` 时仍记账，只是面板不显示。
 */

/** @returns {{red: number, black: number}} 全零计时。 */
export function createClock() {
  return { red: 0, black: 0 };
}

/**
 * 累加一方的用时（返回新对象，不修改入参）。
 * @param {{red:number,black:number}} clock 当前计时。
 * @param {'r'|'b'|'red'|'black'} side 走子方。
 * @param {number} ms 本手耗时。
 * @returns {{red: number, black: number}} 新计时。
 */
export function addMs(clock, side, ms) {
  const key = sideKey(side);
  const delta = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
  return { red: clock?.red ?? 0, black: clock?.black ?? 0, [key]: (clock?.[key] ?? 0) + delta };
}

/** 把 'r'/'b' 归一成 clockMs 的键。 */
export function sideKey(side) {
  return side === 'b' || side === 'black' ? 'black' : 'red';
}

/** 双方总用时（毫秒）。 */
export function totalMs(clock) {
  return (clock?.red ?? 0) + (clock?.black ?? 0);
}

/** 把毫秒格式化成 `mm:ss`（超过 1 小时用 `h:mm:ss`）。 */
export function formatDuration(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** 计时器的一位可读摘要（供工具 render 的状态行使用）。 */
export function clockLine(clock) {
  return `计时 红 ${formatDuration(clock?.red)} / 黑 ${formatDuration(clock?.black)}`;
}
