/**
 * 免构建产物（`lib/client.js`）的门禁：生成前自检、产物自检、以及在假运行时里的
 * **真实执行**。
 *
 * 这一组测试存在的理由：`lib/client.js` 的失败模式都只会在真实浏览器里以白屏表现
 * （多行 import 残留、顶层重名、loader 登记错、require 了非基线模块），而
 * `node --check` 把它们当 ESM 单独看都是合法的。所以这里：
 *
 *  1. 校验「重新生成 == 已提交」（防手改产物，§9.3）；
 *  2. 校验产物的运行时契约（loader id / 唯一 require / 无 import / 无 host.call）；
 *  3. 在假 `window.__ModuleLoader__` + 假 `require('react')` + 假 `ctx` 里真的执行它，
 *     断言注册出来的东西正是设计要求的那些（tab 类型、四个座位、locale、主题令牌），
 *     并把组件树走一遍（渲染层真的能产出 90 个 gridcell + 状态条 + 文本按钮）。
 *
 * 引擎缺失时（M1 未就绪）「生成一致性」一项会 skip，其余仍然执行。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { zh } from '../../lib/ui/i18n.js';
import { CSS } from '../../lib/ui/styles.js';
import {
  ENGINE_FILES,
  OUTPUT,
  ROOT,
  UI_FILES,
  assertArtifact,
  assertEngineImportsRelative,
  assertSingleLineModuleStatements,
  assertUniqueTopLevelNames,
  build,
  stripModuleSyntax,
} from '../../scripts/build-client.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

/** 引擎是否齐备（不齐时只能跳过生成一致性检查）。 */
const engineReady = ENGINE_FILES.every((file) => existsSync(join(ROOT, 'lib', 'engine', file)));

/** 把 `{name}` 按参数替换掉（与 locale 服务的插值语义一致）。 */
function interpolate(template, params) {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/**
 * 假 React：只实现到「纯 JavaScript 渲染一遍」所需的最小面。
 *
 * 这不是 DOM 测试：`createElement` 返回可遍历的普通对象，`useEffect` 是空操作
 * （所以不会有任何异步副作用），`useState` 永远返回初值（一次静态渲染）。
 */
function createReactStub() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
    Fragment: Symbol.for('react.fragment'),
    useRef(value) {
      return { current: value };
    },
    useState(value) {
      return [value, () => {}];
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(factory) {
      return factory;
    },
    useEffect() {},
    useLayoutEffect() {},
    useId() {
      return 'xq-test-id';
    },
  };
}

/**
 * 在假沙箱里执行产物。
 * @param text - `lib/client.js` 全文。
 * @returns `{ module, plugin, requires, react }`。
 */
function executeBundle(text) {
  const loaded = [];
  const requires = [];
  const react = createReactStub();
  const requireStub = (specifier) => {
    requires.push(specifier);
    if (specifier === 'react') return react;
    throw new Error(`产物 require 了基线表之外的模块：${specifier}`);
  };
  const sandbox = { __ModuleLoader__: { load: (mod) => loaded.push(mod) } };
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', text)(sandbox, requireStub);
  assert.equal(loaded.length, 1, '产物必须恰好登记一个模块');
  const module = loaded[0];
  const plugin = module.factory(requireStub);
  return { module, plugin, requires, react };
}

/** 记录注册动作的假客户端 ctx。 */
function createFakeCtx() {
  const record = {
    locales: [],
    tokens: [],
    tabTypes: [],
    registrations: [],
    injects: [],
    effects: [],
  };
  const ctx = {
    effect(callback, label) {
      record.effects.push(label);
      const disposer = callback();
      return typeof disposer === 'function' ? disposer : () => {};
    },
    get(name) {
      if (name === 'connection') {
        return {
          rpc: {
            call: async () => ({ ok: true, value: null }),
          },
        };
      }
      if (name === 'timer') {
        return {
          timeout: (callback) => {
            const handle = setTimeout(callback, 0);
            return () => clearTimeout(handle);
          },
        };
      }
      if (name === 'sidebarRight') {
        return runtimeSidebar;
      }
      return undefined;
    },
    locale: {
      register(namespace, dictionaries) {
        record.locales.push({ namespace, dictionaries });
        return () => {};
      },
      bind(namespace) {
        return (key, params) => {
          const dict = namespace === 'xiangqi' ? zh : {};
          return interpolate(dict[key] ?? key, params);
        };
      },
    },
    theme: {
      overrideTokens(source, tokens) {
        record.tokens.push({ source, tokens });
        return () => {};
      },
    },
    slots: {
      inject(key, callback) {
        record.injects.push({ key, callback });
      },
      register(options, component) {
        record.registrations.push({ options, component });
        return () => {};
      },
    },
    sidebarRightTabs: {
      register(definition) {
        record.tabTypes.push(definition);
        return () => {};
      },
    },
  };
  const openCalls = [];
  const runtimeSidebar = {
    openTab(kind) {
      openCalls.push(kind);
    },
  };
  return { ctx, record, openCalls };
}

/**
 * 遍历元素树并按需调用函数组件（这一步才真正执行渲染层代码）。
 * @returns 收集到的所有元素。
 */
function renderTree(element) {
  const seen = [];
  const walk = (node) => {
    if (node === null || node === undefined || node === false || node === true) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== 'object') {
      seen.push({ type: '#text', props: {}, children: [], text: String(node) });
      return;
    }
    seen.push(node);
    const { type, props, children } = node;
    if (typeof type === 'function') {
      const child = children.length === 0 ? undefined : children.length === 1 ? children[0] : children;
      walk(type({ ...props, children: props.children ?? child }));
      return;
    }
    walk(children);
  };
  walk(element);
  return seen;
}

/** 把注册结果取成方便断言的形状。 */
function registered(record, name) {
  return record.registrations.filter((entry) => entry.options.name === name);
}

/** 供 `ctx.get('sidebarRight')` 用的桩（见 createFakeCtx）。 */
let runtimeSidebar = { openTab() {} };

test('生成前自检：多行 import/export 会让构建直接失败（避免浏览器白屏）', () => {
  const multiline = ["import {", '  a,', '  b,', "} from './x.js';", 'const c = 1;'].join('\n');
  assert.throws(
    () => assertSingleLineModuleStatements('lib/engine/bad.js', multiline),
    /跨行/,
  );
  // 单行形态必须放行
  assert.doesNotThrow(() =>
    assertSingleLineModuleStatements('lib/engine/ok.js', "import { a, b } from './coords.js';\nexport function f() {}\n"),
  );
  assert.doesNotThrow(() =>
    assertSingleLineModuleStatements('lib/ui/ok.js', "import { a } from './x.js';\nexport const K = 1;\n"),
  );
  // 行首 import 但语句在本行结束（反引号里的文字不算）
  assert.doesNotThrow(() => assertSingleLineModuleStatements('lib/ui/ok.js', "export { a, b };\n"));
});

test('生成前自检：顶层声明跨文件重名会失败并报出所有涉事文件', () => {
  const loaded = [
    { file: 'lib/engine/a.js', declarations: [{ name: 'RED_CODE', line: 3 }, { name: 'only', line: 9 }] },
    { file: 'lib/engine/b.js', declarations: [{ name: 'RED_CODE', line: 12 }] },
  ];
  assert.throws(() => assertUniqueTopLevelNames(loaded), /RED_CODE/);
  assert.throws(() => assertUniqueTopLevelNames(loaded), /lib\/engine\/a\.js/);
  assert.doesNotThrow(() =>
    assertUniqueTopLevelNames([
      { file: 'x.js', declarations: [{ name: 'a', line: 1 }] },
      { file: 'y.js', declarations: [{ name: 'b', line: 1 }] },
    ]),
  );
});

test('生成前自检：引擎的裸模块说明符 / 缺 .js 后缀会被拦下', () => {
  assert.throws(() => assertEngineImportsRelative('lib/engine/x.js', "import { z } from 'zod';\n"), /裸模块说明符/);
  assert.throws(() => assertEngineImportsRelative('lib/engine/x.js', "import { z } from 'node:fs';\n"), /裸模块说明符/);
  assert.throws(() => assertEngineImportsRelative('lib/engine/x.js', "import { z } from './y';\n"), /\.js 后缀/);
  assert.doesNotThrow(() => assertEngineImportsRelative('lib/engine/x.js', "import { z } from './y.js';\n"));
});

test('剥模块语法：单行 import/export 被剥掉，声明被记录', () => {
  const source = [
    "import { a } from './a.js';",
    "export { b } from './b.js';",
    'export const K = 1;',
    'export function f() {}',
    'const hidden = 2;',
  ].join('\n');
  const result = stripModuleSyntax(source, 'x.js');
  assert.equal(result.code.includes('import'), false);
  assert.equal(result.code.includes('export'), false);
  assert.match(result.code, /const K = 1;/);
  assert.match(result.code, /function f\(\) \{\}/);
  assert.deepEqual(
    result.declarations.map((d) => d.name),
    ['K', 'f', 'hidden'],
  );
  assert.throws(() => stripModuleSyntax(`${source}\nexport default 3;`, 'x.js'), /export default/);
});

test('产物自检：残留 import / loader 出现多次 / 无法解析都要失败', () => {
  assert.throws(() => assertArtifact('window.__ModuleLoader__.load({ id: "x" });\nimport { a } from "./a.js";'), /残留/);
  assert.throws(
    () => assertArtifact('window.__ModuleLoader__.load(1);\nwindow.__ModuleLoader__.load(2);'),
    /恰好一次/,
  );
  assert.throws(() => assertArtifact('window.__ModuleLoader__.load(;'), /classic script/);
  assert.doesNotThrow(() => assertArtifact('window.__ModuleLoader__.load({ id: "x", factory: () => 1 });'));
});

test('已提交的 lib/client.js 满足运行时契约（不依赖引擎是否就绪）', async () => {
  assert.ok(existsSync(OUTPUT), 'lib/client.js 必须提交进仓库');
  const text = await readFile(OUTPUT, 'utf8');

  assert.match(text, /^\/\* 自动生成，请勿手改；改源码后跑 npm run build:client \*\//);
  const loaderLines = text.split('\n').filter((line) => line.includes('window.__ModuleLoader__.load('));
  assert.equal(loaderLines.length, 1);
  assert.ok(
    loaderLines[0].includes(`id: ${JSON.stringify(pkg.name)}`),
    `loader 的 id 必须等于 package.json 的 name：${loaderLines[0]}`,
  );

  const requires = [...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(requires)], ['react'], '本项目只允许 require("react")（§4.5）');

  assert.equal(/^\s*(?:import|export)\b/m.test(text), false, '产物里不得出现 import/export');
  assert.equal(/\bhost\s*\.\s*call\s*\(/.test(text), false, '静态包没有 host.call');
  assert.equal(/\bstyles\s*\.\s*insert\s*\(/.test(text), false, '静态包没有 styles.insert');
  // 注释里**提到**这个包名是刻意的（说明为什么不用它）；被禁止的是 require 它。
  assert.equal(
    /require\(\s*['"]@deepseek-ai\/dsh-client-ui-primitives['"]\s*\)/.test(text),
    false,
    '不得 require 官方客户端 UI 包（T18）',
  );
  assert.equal(/session\s*\.\s*append\s*\(/.test(text), false, '不得写自定义会话事件');
  assert.equal(/\b__esModule\b/.test(text), false, '不要设 __esModule');
});

test(
  '生成的产物与已提交的 lib/client.js 逐字节一致',
  { skip: engineReady ? false : 'lib/engine/** 未就绪（M1 未完成），待引擎齐备后重跑' },
  async () => {
    const generated = await build();
    const committed = await readFile(OUTPUT, 'utf8');
    assert.equal(committed, generated, '产物与源码不一致：请运行 npm run build:client');
  },
);

test('产物登记的就是本包，且 factory 返回合法的 Cordis 客户端插件', async () => {
  const text = await readFile(OUTPUT, 'utf8');
  const { module, plugin } = executeBundle(text);
  assert.equal(module.id, pkg.name);
  assert.equal(module.id, 'dsh-xiangqi-mate');
  assert.equal(typeof module.factory, 'function');
  assert.equal(typeof plugin, 'object');
  assert.equal(typeof plugin.apply, 'function');
  assert.ok(Array.isArray(plugin.inject));
  assert.equal(plugin.default, undefined, '不要包 { default }（unwrapExports 会去取它）');
  assert.equal(plugin.__esModule, undefined);
});

test('inject 只声明真正需要的 Cordis 服务（可选服务走 ctx.get）', async () => {
  const { plugin } = executeBundle(await readFile(OUTPUT, 'utf8'));
  assert.deepEqual(
    [...plugin.inject].sort(),
    ['locale', 'sidebarRightTabs', 'slots', 'theme', 'timer'],
  );
  assert.equal(plugin.inject.includes('connection'), false, 'connection 只在 Web 组合里存在，必须 ctx.get 判空');
});

test('apply 的注册集合：locale + 主题令牌 + tab 类型 + 四个座位', async () => {
  const text = await readFile(OUTPUT, 'utf8');
  const { plugin } = executeBundle(text);
  const { ctx, record } = createFakeCtx();
  plugin.apply(ctx);

  // ① locale：必须包在 effect 里（locale.register 不会自己挂到 fiber 上）
  assert.equal(record.locales.length, 1);
  assert.equal(record.locales[0].namespace, 'xiangqi');
  assert.deepEqual(Object.keys(record.locales[0].dictionaries).sort(), ['en', 'zh']);

  // ② 主题令牌：成对 light/dark + 必须带 --xiangqi- 前缀（避免撞车）
  assert.equal(record.tokens.length, 1);
  assert.equal(record.tokens[0].source, 'dsh-xiangqi-mate');
  const tokens = record.tokens[0].tokens;
  assert.ok(Object.keys(tokens).length > 0);
  for (const [name, value] of Object.entries(tokens)) {
    assert.match(name, /^--xiangqi-/, `${name} 必须以 --xiangqi- 开头`);
    assert.equal(typeof value, 'object', `${name} 必须是 { light, dark } 对`);
    assert.equal(typeof value.light, 'string');
    assert.equal(typeof value.dark, 'string');
    assert.notEqual(value.light, '', `${name}.light 不能为空`);
    assert.notEqual(value.dark, '', `${name}.dark 不能为空`);
  }

  // ③ tab 类型：两阶段注册的第一阶段
  assert.equal(record.tabTypes.length, 1);
  const tabType = record.tabTypes[0];
  assert.equal(tabType.kind, 'xiangqi');
  assert.equal(tabType.priority, 'extension');
  assert.equal(typeof tabType.id, 'string');
  assert.equal(typeof tabType.title, 'function');
  assert.equal(tabType.title(), '象棋');
  assert.equal(tabType.guide.length, 1, '右栏「+ → 开始」页的入口卡片是唯一零代码入口，必须提供');
  assert.equal(typeof tabType.guide[0].title, 'function');
  assert.equal(typeof tabType.guide[0].description, 'function');
  assert.equal(typeof tabType.guide[0].order, 'number');

  // ④ slots.inject 声明的四个座位
  assert.deepEqual(
    record.injects.map((entry) => entry.key),
    ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title', 'main', 'sidebar.panellist'],
  );

  // 触发四个注册（模拟父槽声明）
  for (const entry of record.injects) entry.callback();
  assert.deepEqual(
    record.registrations.map((entry) => entry.options.name),
    ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title', 'main', 'sidebar.panellist'],
  );

  // ⑤ 正文/标题的 key 必须等于 tab 类型的 id
  assert.equal(registered(record, 'sidebar.right.pane.tab')[0].options.key, tabType.id);
  assert.equal(registered(record, 'sidebar.right.pane.tab.title')[0].options.key, tabType.id);
  // ⑥ T15：main 的 key 与 sidebar.panellist 的 id 必须相同，否则左栏图标选不中面板
  const mainKey = registered(record, 'main')[0].options.key;
  const panelId = registered(record, 'sidebar.panellist')[0].options.id;
  assert.equal(mainKey, 'xiangqi');
  assert.equal(panelId, mainKey);
  const label = registered(record, 'sidebar.panellist')[0].options.label;
  assert.equal(typeof label, 'function');
  assert.equal(label(), zh['panel.title']);
  // ⑦ 需要 t 的座位都声明了 locale
  for (const name of ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title', 'main', 'sidebar.panellist']) {
    assert.equal(registered(record, name)[0].options.locale, 'xiangqi', `${name} 缺 locale: 'xiangqi'`);
  }
  // ⑧ 正文/主面板都用 inject 面拿到运行时（不是把 ctx 关进模块作用域）
  assert.equal(typeof registered(record, 'sidebar.right.pane.tab')[0].options.inject, 'function');
  assert.equal(typeof registered(record, 'main')[0].options.inject, 'function');
});

/**
 * 解析 `color-mix(in srgb, A p%, B)` 得到实际颜色。
 * @param a - 十六进制色 A。
 * @param b - 十六进制色 B。
 * @param percent - A 的占比。
 * @returns 混合后的十六进制色。
 */
function mixHex(a, b, percent) {
  const ratio = percent / 100;
  const read = (hex) => [0, 2, 4].map((offset) => parseInt(hex.replace('#', '').slice(offset, offset + 2), 16));
  const [ar, ag, ab] = read(a);
  const [br, bg, bb] = read(b);
  const channel = (left, right) => Math.round(left * ratio + right * (1 - ratio));
  return `#${[channel(ar, br), channel(ag, bg), channel(ab, bb)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** WCAG 相对亮度。 */
function luminance(hex) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两个颜色的对比度（1..21）。 */
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (high + 0.05) / (low + 0.05);
}

test('对比度达标（§7.7）：棋子字 ≥4.5:1、网格线对棋盘面 ≥3:1', async () => {
  const text = await readFile(OUTPUT, 'utf8');
  const { plugin } = executeBundle(text);
  const { ctx, record } = createFakeCtx();
  plugin.apply(ctx);
  const tokens = record.tokens[0].tokens;

  // 主题里这几个 alias 的实际取值（见 dsh-client-ui-theme 的 design-platform CSS）
  const THEME = {
    light: { red: '#ec1313', black: '#0f1115' },
    dark: { red: '#f25a5a', black: '#f9fafb' },
  };

  // 红方字色在 CSS 里是 color-mix(92% error-primary, label-primary)：按声明逐字校验，
  // 而不是按我脑子里的近似值。
  const mixed = /\.xq-pieceRed\{fill:color-mix\(in srgb, var\(--dsw-alias-state-error-primary\) (\d+)%, var\(--dsw-alias-label-primary\)\)\}/.exec(CSS);
  assert.ok(mixed, 'CSS 里找不到红方字色声明');
  const redPercent = Number(mixed[1]);

  for (const scheme of ['light', 'dark']) {
    const face = tokens['--xiangqi-piece-face'][scheme];
    const red = mixHex(THEME[scheme].red, THEME[scheme].black, redPercent);
    const redRatio = contrast(face, red);
    assert.ok(
      redRatio >= 4.5,
      `${scheme} 主题：红方 ${red} 在底盘 ${face} 上只有 ${redRatio.toFixed(2)}:1`,
    );
    const blackRatio = contrast(face, THEME[scheme].black);
    assert.ok(
      blackRatio >= 4.5,
      `${scheme} 主题：黑方 ${THEME[scheme].black} 在底盘 ${face} 上只有 ${blackRatio.toFixed(2)}:1`,
    );
    const gridRatio = contrast(tokens['--xiangqi-board-face'][scheme], tokens['--xiangqi-grid'][scheme]);
    assert.ok(gridRatio >= 3, `${scheme} 主题：网格线对棋盘面只有 ${gridRatio.toFixed(2)}:1`);
  }
});

test('setup：组件树能真的渲染出棋盘、状态条与文本按钮（假 React 静态渲染一遍）', async () => {
  const text = await readFile(OUTPUT, 'utf8');
  const { plugin } = executeBundle(text);
  const { ctx, record, openCalls } = createFakeCtx();
  runtimeSidebar = { openTab: (kind) => openCalls.push(kind) };
  plugin.apply(ctx);
  for (const entry of record.injects) entry.callback();

  const tabEntry = registered(record, 'sidebar.right.pane.tab')[0];
  // inject 的返回值会被摊平成组件 props：{ xq, sessionKey } → props.xq = runtime
  const injected = tabEntry.options.inject('session-1');
  assert.equal(injected.sessionKey, 'session-1', 'session 作用域的 inject 要能拿到 sessionId');
  assert.equal(typeof injected.xq.game, 'function');
  const xq = injected.xq;
  const rootInjected = registered(record, 'main')[0].options.inject(undefined);
  assert.equal(rootInjected.sessionKey, undefined, 'root 作用域没有 sessionId');

  const tabInfo = {
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1' },
    tab: {
      id: 'tab-1',
      kind: 'xiangqi',
      visible: true,
      signal: undefined,
      actions: {},
      navigation: { address: 'page:xiangqi', params: undefined, revision: 1 },
    },
  };
  const tree = tabEntry.component({
    useTabInfo: () => tabInfo,
    useSessions: (selector) => selector({ byId: { 'session-1': { id: 'session-1', cwd: '/tmp/ws' } } }),
    t: (key, params) => interpolate(zh[key] ?? key, params),
    sessionId: 'session-1',
    xq,
  });
  const nodes = renderTree(tree);

  const svg = nodes.find((node) => node.type === 'svg' && node.props.role === 'grid');
  assert.ok(svg, '面板必须画出 SVG 棋盘（role="grid" 的那一块，而不是页头的小图标）');
  assert.equal(svg.props['aria-label'], zh['board.label']);
  assert.equal(svg.props.tabIndex, 0, '键盘必须能 Tab 进棋盘');
  assert.equal(typeof svg.props.onKeyDown, 'function');
  assert.equal(nodes.filter((node) => node.props.role === 'gridcell').length, 90, '必须有 90 个 gridcell');

  // 网格几何：viewBox 与 8u×9u 网格 + 0.65u 外边距一致
  const viewBox = svg.props.viewBox.split(' ').map(Number);
  assert.equal(viewBox.length, 4);
  const u = Number(svg.props.width) / 9.3;
  assert.ok(Math.abs(viewBox[2] - Number(svg.props.width)) < 1e-6);
  assert.ok(Math.abs(viewBox[3] - 10.3 * u) < 1e-6);
  assert.ok(Number(svg.props.width) > 0 && Number(svg.props.height) > 0);

  // 样式：组件内渲染 <style>，带 data-plugin / data-plugin-css（卸载即移除，§4.5）
  const style = nodes.find((node) => node.type === 'style');
  assert.ok(style, '面板必须自带 <style>（静态包没有 styles.insert）');
  assert.equal(style.props['data-plugin'], 'dsh-xiangqi-mate');
  assert.equal(style.props['data-plugin-css'], 'xq-panel');
  assert.ok(String(style.children.join('')).includes('--dsw-alias-bg-base'));

  const liveRegions = nodes.filter((node) => typeof node.props['aria-live'] === 'string');
  assert.ok(liveRegions.length >= 2, '状态条与落子播报都要有 aria-live');
  assert.ok(liveRegions.some((node) => node.props['aria-live'] === 'polite'));
  const statusNode = nodes.find((node) => typeof node.props['data-xq-status'] === 'string');
  assert.ok(statusNode, '状态条必须带 stable 的 data 标记');
  // 静态渲染只走一次（useEffect 是空操作），所以投影还没到，状态条应报「正在连接宿主…」
  assert.equal(statusNode.children.join(''), zh['status.connecting']);

  const buttons = nodes.filter((node) => node.type === 'button');
  const labels = buttons.map((node) => node.children.filter((child) => typeof child === 'string').join(''));
  assert.ok(labels.includes(zh['action.new']), `工具条缺「新对局」：${labels.join(' | ')}`);
  assert.ok(labels.includes(zh['action.undo']));
  assert.ok(labels.includes(zh['action.hint']));
  assert.ok(labels.includes(zh['action.resign']));
  assert.ok(labels.includes(zh['action.copy']));
  assert.ok(labels.includes(zh['action.review']));
  assert.equal(
    labels.every((label) => label.length > 0),
    true,
    '所有按钮都必须有文本标签（§7.7：不只有图标）',
  );

  // 空格的读屏标签走 board.emptyCell，且文件号/纵线名有真实取值（不能出现 board.file.0）
  const emptyLabel = nodes.filter((node) => node.props.role === 'gridcell')[0].props['aria-label'];
  assert.match(emptyLabel, /^(一|二|三|四|五|六|七|八|九)路，/);
  assert.equal(/board\./.test(emptyLabel), false, `读屏标签里不该出现字典键名：${emptyLabel}`);
});

test('主面板座位：从 useSessions 反查当前会话，查不到就显示只读空盘而不是崩', async () => {
  const text = await readFile(OUTPUT, 'utf8');
  const { plugin } = executeBundle(text);
  const { ctx, record } = createFakeCtx();
  plugin.apply(ctx);
  for (const entry of record.injects) entry.callback();

  const mainEntry = registered(record, 'main')[0];
  const t = (key, params) => interpolate(zh[key] ?? key, params);

  const selectors = [];
  const withSession = mainEntry.component({
    useSessions: (selector) => {
      selectors.push(selector);
      return selector({ byId: { a: { id: 'a', retainedBy: {} }, b: { id: 'b', retainedBy: { mainView: 1 } } } });
    },
    t,
    xq: mainEntry.options.inject(undefined).xq,
  });
  const nodes = renderTree(withSession);
  assert.ok(
    nodes.find((node) => node.type === 'svg' && node.props.role === 'grid'),
    '解析到会话时必须画出棋盘',
  );
  assert.equal(nodes.filter((node) => node.props.role === 'gridcell').length, 90);

  const withoutSession = mainEntry.component({
    useSessions: () => undefined,
    t,
    xq: mainEntry.options.inject(undefined).xq,
  });
  const emptyNodes = renderTree(withoutSession);
  assert.equal(
    emptyNodes.find((node) => node.type === 'svg' && node.props.role === 'grid'),
    undefined,
    '没有会话时不画可交互的棋盘',
  );
  assert.equal(emptyNodes.filter((node) => node.props.role === 'gridcell').length, 0);
  assert.ok(
    emptyNodes.some((node) => node.children.includes(zh['status.rpcUnavailable'])),
    '没有会话时必须给出可读的说明',
  );
});

test('标题座位与左栏图标：图标接受 { size, active }', async () => {
  const text = await readFile(OUTPUT, 'utf8');
  const { plugin } = executeBundle(text);
  const { ctx, record } = createFakeCtx();
  plugin.apply(ctx);
  for (const entry of record.injects) entry.callback();

  const title = registered(record, 'sidebar.right.pane.tab.title')[0];
  const titleNodes = renderTree(title.component({ t: (key) => zh[key] ?? key }));
  assert.ok(titleNodes.some((node) => typeof node.type === 'string' && node.children.includes(zh['tab.title'])));

  const icon = registered(record, 'sidebar.panellist')[0];
  for (const active of [true, false]) {
    const iconNodes = renderTree(icon.component({ size: 18, active }));
    const svg = iconNodes.find((node) => node.type === 'svg');
    assert.ok(svg, '左栏图标必须是 SVG（ownerProps 只给 size/active，不能依赖 DOM 尺寸）');
    assert.equal(Number(svg.props.width), 18);
    assert.equal(svg.props['aria-hidden'], 'true', '按钮自己带 label，图标要对读屏隐藏');
  }
});

test('运行时 xq：openSidebar 只在服务存在时真的调用，缺失时静默', async () => {
  const text = await readFile(OUTPUT, 'utf8');
  const { plugin } = executeBundle(text);
  const { ctx, record, openCalls } = createFakeCtx();
  runtimeSidebar = { openTab: (kind) => openCalls.push(kind) };
  plugin.apply(ctx);
  for (const entry of record.injects) entry.callback();
  const xq = registered(record, 'main')[0].options.inject(undefined).xq;
  assert.equal(xq.hasSidebar, true);
  xq.openSidebar();
  assert.deepEqual(openCalls, ['xiangqi']);
  // 服务缺失的 profile：ctx.get 返回 undefined，不能抛
  const bare = createFakeCtx();
  const bareCtx = { ...bare.ctx, get: () => undefined };
  plugin.apply(bareCtx);
  for (const entry of bare.record.injects) entry.callback();
  const bareXq = registered(bare.record, 'main')[0].options.inject(undefined).xq;
  assert.equal(bareXq.hasSidebar, false);
  assert.doesNotThrow(() => bareXq.openSidebar());
  assert.doesNotThrow(() => bareXq.openMain());
});

test('RPC 不可用时：面板渲染成只读而不是崩（降级分支）', async () => {
  const text = await readFile(OUTPUT, 'utf8');
  const { plugin } = executeBundle(text);
  const { ctx, record } = createFakeCtx();
  // 没有 connection 服务的组合
  const offlineCtx = { ...ctx, get: (name) => (name === 'connection' || name === 'timer' ? undefined : ctx.get(name)) };
  plugin.apply(offlineCtx);
  for (const entry of record.injects) entry.callback();

  const tabEntry = registered(record, 'sidebar.right.pane.tab')[0];
  const injected = tabEntry.options.inject('session-1');
  const xq = injected.xq;
  const client = xq.game('session-1');
  assert.equal(client.available, false);
  const result = await client.state();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'rpc/unavailable');

  const tree = tabEntry.component({
    useTabInfo: () => ({ sidebar: {}, panel: {}, tab: { id: 't', visible: true, signal: undefined, actions: {}, navigation: {} } }),
    useSessions: (selector) => selector({ byId: {} }),
    t: (key, params) => interpolate(zh[key] ?? key, params),
    sessionId: 'session-1',
    xq,
  });
  const nodes = renderTree(tree);
  assert.ok(
    nodes.find((node) => node.type === 'svg' && node.props.role === 'grid'),
    '即使连不上宿主也要画出棋盘',
  );
  assert.equal(nodes.filter((node) => node.props.role === 'gridcell').length, 90);
});

test('内联顺序：引擎 8 个文件按依赖序、UI 10 个文件且 plugin 最后', () => {
  assert.deepEqual(ENGINE_FILES, [
    'coords.js',
    'fen.js',
    'moves.js',
    'rules.js',
    'notation-zh.js',
    'eval.js',
    'describe.js',
    'search.js',
  ]);
  assert.equal(ENGINE_FILES.includes('index.js'), false, 'index.js 只是重导出，不参与内联');
  assert.equal(UI_FILES[UI_FILES.length - 1], 'plugin.js', '包装层最后要取 plugin 的 inject/apply');
  assert.deepEqual([...UI_FILES].sort(), [...new Set(UI_FILES)].sort());
});
