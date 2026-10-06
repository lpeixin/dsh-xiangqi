/**
 * 自带的小图形与「不依赖任何官方 UI 包」的标记工厂。
 *
 * 为什么不用 `@deepseek-ai/dsh-client-ui-primitives`（§4.5、T18）：官方规范明确劝阻——
 * 该包随版本变化、纯 JS 插件没有类型检查，而且组件抛错会把整个插槽条目打白
 * （控制台 `slot entry crashed in '<slot>'`）。所以按钮、tooltip、状态点、图标都在
 * 本插件里自绘，只保留 `--dsw-alias-*` / `--dsw-*` 令牌引用。
 *
 * `el()` 的存在还有一个工程理由：源文件是**免构建的 ESM**，不能写 JSX；同时 UI 源
 * 文件要能被 Node 直接 import（单测），所以不能在模块顶层碰 `React`——`React` 只在
 * 组件函数体里被求值时才存在（在产物里它是 factory 作用域的常量）。
 */

import { CSS, STYLE_ID } from './styles.js';

/** 极简 createElement（无 JSX、无构建期转译）。 */
export function el(type, props, ...children) {
  return React.createElement(type, props, ...children);
}

/**
 * 面板样式标签。
 *
 * 用「组件内渲染 `<style>`」而不是往 `document.head` 插标签：卸载即移除，不会残留
 * （§4.5 第 5 条给出的两种做法里更可靠的一种）。
 * @returns style 元素。
 */
export function StyleTag() {
  return el('style', { 'data-plugin': 'dsh-xiangqi-mate', 'data-plugin-css': STYLE_ID }, CSS);
}

/**
 * 象棋棋盘图形：外框 + 三条横线 + 河界留白。
 * @param props - `{ size, className, title }`。
 * @returns svg 元素。
 */
export function BoardGlyph(props) {
  const size = Number.isFinite(props.size) ? props.size : 16;
  const stroke = 'currentColor';
  const lines = [];
  for (let i = 0; i <= 3; i += 1) {
    lines.push(el('line', { key: `h${i}`, x1: 3, y1: 3 + i * 4, x2: 21, y2: 3 + i * 4 }));
  }
  lines.push(el('line', { key: 'v0', x1: 3, y1: 3, x2: 3, y2: 19 }));
  lines.push(el('line', { key: 'v1', x1: 21, y1: 3, x2: 21, y2: 19 }));
  lines.push(el('line', { key: 'v2', x1: 12, y1: 3, x2: 12, y2: 7 }));
  lines.push(el('line', { key: 'v3', x1: 12, y1: 15, x2: 12, y2: 19 }));
  return el(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke,
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      className: props.className,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    props.title === undefined ? null : el('title', null, props.title),
    ...lines,
  );
}
