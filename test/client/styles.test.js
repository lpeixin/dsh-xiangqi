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

test('布局不变量：着法块的尺寸必须**与内容无关**，棋盘才不会随棋谱变长而缩小', () => {
  // 棋盘按 .xq-boardArea 的实测高度缩放，所以着法块一旦随内容长高，棋盘就会被挤小。
  // 踩过两次：① 列表写死 max-height:168px；② 着法块只设 42% 上限——
  // 后者只限制了最大占比，棋谱从 1 手长到 42% 的过程中棋盘仍在缩小。
  // 正确形态是**固定高度 + 内部滚动**，所以这里断言"高度是常量"，而不是"有上限"。
  const moves = /\.xq-moves\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(moves, /height:\s*var\(--xq-moves-h\)/, '着法块高度必须是常量变量，不能随内容变化');
  assert.match(moves, /flex:\s*0\s+1\s+auto/, '窄屏时允许收缩以免溢出，但基大小是常量');
  assert.doesNotMatch(moves, /max-height:\s*\d+%/, '不要用百分比上限——过程中仍会挤压棋盘');

  const root = /\.xq-root\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(root, /--xq-moves-h:\s*\d+px/, '变量要有具体值');

  const area = /\.xq-boardArea\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(area, /min-height:\s*\d+px/, '棋盘区还要有高度下限，防止极窄面板下被压没');

  const list = /\.xq-movesList\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(list, /overflow-y:\s*auto/, '棋谱要能在自己的区域内滚动查看');
  assert.match(list, /flex:\s*1\s+1\s+auto/, '列表高度由父容器（常量）决定');
  assert.doesNotMatch(list, /max-height:\s*\d+px/, '不要再写死列表高度');
});

test('CSS 结构自检：括号平衡，且面板根节点保留完整的 flex 纵向布局', () => {
  // 为什么需要这条：曾经在一次"插入自定义属性"的改动里手滑多写了一个 `}`，
  // 把 .xq-root 的**整段声明**变成了无效声明——`display:flex` 静默失效，
  // 于是棋盘不再按 flex 分配空间、而是被内容牵着走（用户看到"棋盘还是一直缩小"）。
  // 子串匹配式的样式测试完全拦不住这种语法级破坏，所以这里做结构检查。
  const open = (CSS.match(/\{/g) ?? []).length;
  const close = (CSS.match(/\}/g) ?? []).length;
  assert.equal(open, close, `CSS 花括号不平衡：{ ${open} 个，} ${close} 个`);

  const root = /\.xq-root\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.match(root, /display:\s*flex/, '.xq-root 必须仍然是 flex 容器（否则纵向分配全部失效）');
  assert.match(root, /flex-direction:\s*column/, '.xq-root 必须是纵向 flex');
  assert.match(root, /height:\s*100%/, '.xq-root 必须撑满面板高度');
  assert.match(root, /--xq-moves-h:\s*\d+px/, '棋谱区高度变量必须声明在 .xq-root 规则内');

  // 变量只能在根节点声明一次，避免出现"变量自成一个空规则"的写法。
  const declarations = CSS.match(/--xq-moves-h:\s*\d+px/g) ?? [];
  assert.equal(declarations.length, 1, `--xq-moves-h 只应声明一次，实际 ${declarations.length} 次`);
});
