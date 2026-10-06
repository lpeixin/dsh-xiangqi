/**
 * 样式契约（§7.3）：**只用主题令牌**、动效一律可被 `prefers-reduced-motion` 关掉、
 * 类名自带 `xq-` 前缀。
 *
 * 这三条都是「评审看截图看不出来、上线后才发现」的问题：硬编码色值在暗色主题里会
 * 瞎眼；动画没包在媒体查询里会让开了「减少动效」的用户照样看到位移；类名不加前缀
 * 会与宿主页面互相污染。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CSS, STYLE_ID } from '../../lib/ui/styles.js';

/** 按大括号配平剔掉所有 `@media (prefers-reduced-motion:no-preference){…}` 块。 */
function stripNoPreferenceBlocks(css) {
  const marker = '@media (prefers-reduced-motion:no-preference){';
  let output = css;
  let index = output.indexOf(marker);
  let guard = 0;
  while (index >= 0 && guard < 10) {
    let depth = 0;
    let end = -1;
    for (let i = index + marker.length - 1; i < output.length; i += 1) {
      if (output[i] === '{') depth += 1;
      else if (output[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    assert.ok(end > index, 'no-preference 块没有正常收尾');
    output = output.slice(0, index) + output.slice(end + 1);
    index = output.indexOf(marker);
    guard += 1;
  }
  return output;
}

test('所有动效都只在 prefers-reduced-motion: no-preference 下启用', () => {
  const total = (CSS.match(/\banimation:/g) ?? []).length;
  assert.ok(total > 0, '一个动画都没有？棋盘至少要有落子动画');
  const outside = (stripNoPreferenceBlocks(CSS).match(/\banimation:/g) ?? []).length;
  assert.equal(outside, 0, `${outside} 处 animation 跑到了媒体查询外面`);
  assert.ok(
    CSS.includes('@media (prefers-reduced-motion:no-preference){'),
    '缺少 no-preference 媒体查询',
  );

  // reduce 时必须给出静态替代（不是什么都不画）
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)\{/);
  const reduceBlock = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion:reduce){'));
  assert.match(reduceBlock, /\.xq-lastMarker/, '减少动效时上一步痕迹要有静态标记');
  assert.match(reduceBlock, /\.xq-checkRing/, '减少动效时将军要有静态标记（虚线环）');
});

/** 去掉 CSS 注释（注释里出现十六进制色值是刻意的说明，不是声明）。 */
function declarationsOnly(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

test('配色只用主题令牌，不写死色值与暗色媒体查询', () => {
  const declarations = declarationsOnly(CSS);
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(declarations), false, 'CSS 里出现了硬编码色值');
  assert.equal(/\brgba?\(/.test(declarations), false, 'CSS 里出现了 rgb()/rgba()');
  assert.equal(/\bhsl(a)?\(/.test(declarations), false, 'CSS 里出现了 hsl()');
  assert.equal(
    /prefers-color-scheme/.test(CSS),
    false,
    '不能写 prefers-color-scheme：那会忽略用户的 DSH 主题偏好（§7.3）',
  );
  // 每个颜色属性都应当落在 --dsw-* / --xiangqi-* 令牌（或其 color-mix 组合）上
  const colorDeclarations = declarations.match(/(?:^|;|\{)\s*(?:color|background|stroke|fill|border-color)\s*:\s*([^;}]+)/g) ?? [];
  assert.ok(colorDeclarations.length > 10, '颜色声明太少了，八成是解析错了');
  for (const declaration of colorDeclarations) {
    const value = declaration.split(':').slice(1).join(':').trim();
    const allowed =
      /^var\(--(?:dsw|xiangqi|ds)-/.test(value) ||
      (value.startsWith('color-mix(') && /var\(--(?:dsw|xiangqi|ds)-/.test(value)) ||
      value === 'transparent' ||
      value === 'currentColor' ||
      value === 'none' ||
      value === 'inherit';
    assert.ok(allowed, `颜色声明没有走令牌：${declaration.trim()}`);
  }
});

test('类名全部带 xq- 前缀，样式标签可被按 data-plugin 清理', () => {
  const classNames = new Set();
  for (const match of CSS.matchAll(/\.([A-Za-z_][\w-]*)/g)) classNames.add(match[1]);
  assert.ok(classNames.size > 20);
  const offenders = [...classNames].filter((name) => !name.startsWith('xq-'));
  assert.deepEqual(offenders, [], '类名必须带 xq- 前缀（避免与宿主页面撞车）');
  assert.equal(STYLE_ID, 'xq-panel');
});

test('动画时长 ≤200 ms（§7.3 的表格），只有将军脉冲是 600 ms', () => {
  const durations = [...CSS.matchAll(/animation:\s*([\w-]+)\s+(\d+)ms/g)].map((match) => ({
    name: match[1],
    ms: Number(match[2]),
  }));
  assert.ok(durations.length >= 4, `动画数量偏少：${JSON.stringify(durations)}`);
  for (const { name, ms } of durations) {
    if (name === 'xq-pulse') continue; // 状态条上的不确定进度指示，不是棋盘动画
    if (name === 'xq-check') {
      assert.equal(ms, 600, '将军脉冲是 600 ms 两下（§7.3）');
      continue;
    }
    assert.ok(ms <= 200, `${name} 时长 ${ms} ms 超过了 200 ms`);
  }
  // 落子 180 ms / 吃子 120 ms / 悔棋 160 ms 逐一钉住
  assert.match(CSS, /\.xq-drop\{animation:xq-drop 180ms/);
  assert.match(CSS, /\.xq-captureGhost\{animation:xq-capture 120ms/);
  assert.match(CSS, /\.xq-undoGhost\{animation:xq-undo 160ms/);
  assert.match(CSS, /\.xq-shake\{animation:xq-shake 120ms/);
});

test('棋盘面允许木色令牌，但必须回落到 alias 令牌', () => {
  assert.match(CSS, /--xiangqi-board-face,\s*var\(--dsw-alias-bg-layer-1\)/);
  assert.match(CSS, /--xiangqi-grid,\s*var\(--dsw-alias-border-l3\)/);
});

test('主面板头部让位走 --dsh-frame-* 变量（T15）', () => {
  assert.match(CSS, /\.xq-inMain\{padding-top:var\(--dsh-frame-top-clearance,0px\)\}/);
  assert.match(CSS, /html\[data-platform=darwin\] \.xq-inMain\{padding-left:var\(--dsh-frame-leading-clearance,0px\)\}/);
});

test('状态条、着法列表与焦点环都有显式样式（§7.4/§7.7）', () => {
  assert.match(CSS, /\.xq-status\{/);
  assert.match(CSS, /\.xq-status-error\{/);
  assert.match(CSS, /\.xq-status-success\{/);
  assert.match(CSS, /\.xq-status-warn\{/);
  assert.match(CSS, /\.xq-movesList\{/);
  assert.match(CSS, /\.xq-moveActive\{/);
  assert.match(CSS, /focus-visible\{[^}]*--dsw-focus-ring-color/);
  // 允许为了去掉鼠标点击的默认外框而写 outline:none，但同一个选择器必须补上主题焦点环。
  const muted = [...CSS.matchAll(/([^{}]+)\{[^}]*outline:\s*none/g)]
    .map((match) => match[1].trim())
    .flatMap((selector) => selector.split(',').map((part) => part.trim()))
    .filter((selector) => selector.startsWith('.'));
  assert.ok(muted.length > 0);
  for (const selector of muted) {
    const ring = new RegExp(
      `${selector.replace(/[.[\]]/g, '\\$&')}:focus-visible\\{[^}]*--dsw-focus-ring-color`,
    );
    assert.match(CSS, ring, `${selector} 去掉了默认外框却没补主题焦点环`);
  }
});
