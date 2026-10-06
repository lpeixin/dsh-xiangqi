/**
 * 面板的**集成**测试：用一套极小的 hook 运行时（不是 React，也没有 DOM）把产物里
 * 真正的 `XiangqiPanel` 跑起来，走通「进入面板 → state → 落子 → AI 轮询 → 降级」这条链。
 *
 * 为什么值得写：`lib/client.js` 是门面，而这些失败（RPC payload 形状不对、revision 栅栏
 * 写反、轮询在待命时还在跑、点了合法目标却只高亮不动）在纯函数单测里看不出来，只有把
 * 组件真的驱动一遍才会暴露。浏览器验证做不到时，这是最接近真实行为的一层。
 *
 * 关于这套运行时的边界（必须诚实）：
 *  - hook 状态按「组件函数 + 树中的路径」保存，所以子组件在树里换位置会重置它自己的
 *    局部状态；根组件（XiangqiPanel）的路径恒定，本文件关心的一切都在它里面；
 *  - 没有并发、没有批次：每次 setState 后重新渲染整棵树，直到没有新状态为止；
 *  - 事件用 props 上真实存在的回调触发（`onPointerDown` / `onClick`），不走 DOM 事件系统。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { zh } from '../../lib/ui/i18n.js';
import {
  applyMove,
  formatChinese,
  generateMoves,
  iccsToMove,
  initialPosition,
  positionToFen,
} from '../../lib/engine/index.js';
import { OUTPUT } from '../../scripts/build-client.mjs';

/** 把 `{name}` 按参数替换掉（与 locale 服务一致）。 */
function interpolate(template, params) {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

const t = (key, params) => interpolate(zh[key] ?? key, params);

/** 走完当前微任务队列（组件里的 await 都在这一层被排空）。 */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

/** 两组依赖是否相同（与 React 的浅比较一致）。 */
function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * 建立一套极小的 hook 运行时。
 * @returns 供测试驱动的 `{ element, render, settle, unmount, react }`。
 */
function createRuntime() {
  /** path → hook 槽数组。 */
  const store = new Map();
  let cursor = 0;
  let path = '';
  let dirty = false;
  const pendingEffects = [];

  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
    useRef(value) {
      const slot = slotAt();
      if (slot.value === undefined) slot.value = { current: value };
      return slot.value;
    },
    useState(initial) {
      const slot = slotAt();
      if (!slot.init) {
        slot.init = true;
        slot.value = typeof initial === 'function' ? initial() : initial;
      }
      return [
        slot.value,
        (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next;
          if (Object.is(value, slot.value)) return;
          slot.value = value;
          dirty = true;
        },
      ];
    },
    useMemo(factory, deps) {
      const slot = slotAt();
      if (!slot.init || !sameDeps(slot.deps, deps)) {
        slot.init = true;
        slot.deps = deps;
        slot.value = factory();
      }
      return slot.value;
    },
    useCallback(factory, deps) {
      const slot = slotAt();
      if (!slot.init || !sameDeps(slot.deps, deps)) {
        slot.init = true;
        slot.deps = deps;
        slot.value = factory;
      }
      return slot.value;
    },
    useEffect(effect, deps) {
      const slot = slotAt();
      if (!slot.init || !sameDeps(slot.deps, deps)) {
        slot.init = true;
        slot.deps = deps;
        slot.effect = effect;
        pendingEffects.push(slot);
      }
    },
    useLayoutEffect(effect, deps) {
      react.useEffect(effect, deps);
    },
    useId() {
      return `xq-${cursor}`;
    },
    Fragment: Symbol.for('react.fragment'),
  };

  function slotAt() {
    const list = store.get(path) ?? [];
    store.set(path, list);
    const slot = list[cursor] ?? {};
    list[cursor] = slot;
    cursor += 1;
    return slot;
  }

  /** 递归渲染：函数组件被调用，字符串标签展开 children。 */
  function render(node, nodePath) {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (Array.isArray(node)) return node.map((child, index) => render(child, `${nodePath}.${index}`));
    if (typeof node !== 'object') return node;
    const { type, props, children } = node;
    if (typeof type === 'function') {
      const child = children.length === 0 ? undefined : children.length === 1 ? children[0] : children;
      const previous = path;
      path = `${nodePath}|${type.name || 'anon'}`;
      cursor = 0;
      const produced = type({ ...props, children: props.children ?? child });
      path = previous;
      return { type, props, children: [render(produced, `${nodePath}|${type.name || 'anon'}>`)] };
    }
    return { type, props, children: children.map((child, index) => render(child, `${nodePath}.${index}`)) };
  }

  /** 把树摊平成元素数组（含函数组件的**返回值**，便于断言真正画出来的东西）。 */
  function flatten(node, out = []) {
    if (node === null || node === undefined || typeof node === 'boolean') return out;
    if (Array.isArray(node)) {
      for (const child of node) flatten(child, out);
      return out;
    }
    if (typeof node !== 'object') {
      out.push({ type: '#text', props: {}, children: [], text: String(node) });
      return out;
    }
    if (typeof node.type !== 'function') out.push(node);
    flatten(node.children, out);
    return out;
  }

  return {
    react,
    /** 渲染一次（含所有 effect），返回摊平后的元素数组。 */
    async render(element) {
      let tree = element;
      let nodes = [];
      for (let pass = 0; pass < 40; pass += 1) {
        cursor = 0;
        path = 'root';
        dirty = false;
        pendingEffects.length = 0;
        tree = render(element, 'root');
        nodes = flatten(tree);
        // 与 React 一致：deps 变化的 effect 先跑上一轮的清理，再跑新的本体。
        for (const slot of pendingEffects) {
          if (typeof slot.cleanup === 'function') slot.cleanup();
          slot.cleanup = undefined;
        }
        for (const slot of pendingEffects) {
          const cleanup = slot.effect();
          slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
        }
        await flushMicrotasks();
        if (!dirty) break;
        // 触发了一次 setState：重渲染（effect 的 deps 未变，不会重复执行）
      }
      return { nodes, tree };
    },
    /** 再等几轮微任务，让异步 RPC 的结果落地并重渲染。 */
    async settle(element) {
      let result = null;
      for (let i = 0; i < 6; i += 1) {
        await flushMicrotasks();
        result = await this.render(element);
      }
      return result;
    },
    cleanupAll() {
      for (const list of store.values()) {
        for (const slot of list) if (typeof slot.cleanup === 'function') slot.cleanup();
      }
    },
  };
}

/**
 * 沙箱里的假 `window` 计时器。
 *
 * 产物里的 React 局部计时器走 `window.setTimeout` / `window.setInterval`（浏览器全局），
 * 所以沙箱必须提供它们——顺便让测试能断言「计时器被清掉了」。
 */
function createWindowTimers() {
  let seq = 0;
  const active = new Map();
  const window = {
    setTimeout(callback, delay) {
      seq += 1;
      const id = seq;
      active.set(id, { callback, delay, repeat: false });
      return id;
    },
    clearTimeout(id) {
      active.delete(id);
    },
    setInterval(callback, delay) {
      seq += 1;
      const id = seq;
      active.set(id, { callback, delay, repeat: true });
      return id;
    },
    // 说明：真实实现里 ctx.timer.timeout 的回调本身会 dispose 自己；假计时器做不到
    // 这一点，所以由 fireTimer() 显式标记「已触发」，避免把历史条目当成待触发的。
    
    clearInterval(id) {
      active.delete(id);
    },
  };
  return { window, active, ids: () => [...active.keys()] };
}

/** 取出仍待触发的计时器（未取消、未触发）。 */
function pendingTimers(entries) {
  return entries.filter((entry) => !entry.cancelled && !entry.fired);
}

/** 触发一个计时器（并标记它已经烧掉）。 */
function fireTimer(entry) {
  entry.fired = true;
  entry.callback();
}

/** 在沙箱里执行产物，返回 `apply` 用的插件、假 React 与假计时器。 */
async function loadPlugin() {
  const text = await readFile(OUTPUT, 'utf8');
  const loaded = [];
  const requires = [];
  let react = null;
  const timers = createWindowTimers();
  const requireStub = (specifier) => {
    requires.push(specifier);
    if (specifier === 'react') return react;
    throw new Error(`基线表之外的 require：${specifier}`);
  };
  const sandbox = { __ModuleLoader__: { load: (mod) => loaded.push(mod) }, ...timers.window };
  // 先执行产物（此时 factory 还不 require react），再用同一份 require 取插件
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', text)(sandbox, requireStub);
  return { module: loaded[0], requireStub, requires, timers, setReact: (value) => (react = value) };
}

/** 一个可控的宿主桩：记录调用、按脚本回放响应。 */
function createHost(script) {
  const calls = [];
  const host = {
    calls,
    /** 按 endpoint 取调用记录。 */
    endpoints: () => calls.map((call) => call.endpoint),
    payloads: (endpoint) => calls.filter((call) => call.endpoint === endpoint).map((call) => call.payload),
    async call(channel, endpoint, payload, signal) {
      calls.push({ channel, endpoint, payload, signal });
      const handler = script[endpoint];
      if (handler === undefined) return { ok: true, value: null };
      return handler(payload, calls.length);
    },
  };
  return host;
}

/**
 * 用**引擎**从标准初始局面造一个投影：board / fen / lastMove / legalTargets / history
 * 互相一致，形状与宿主 `projectionOf` 逐字段对齐（§7.5.4）。
 * @param moves - ICCS 着法序列，如 `['h2e2']`。
 * @param overrides - 覆盖字段。
 * @returns 投影。
 */
function projectionFrom(moves, overrides) {
  let position = initialPosition();
  const history = [];
  let lastMove = null;
  for (const iccs of moves) {
    const move = iccsToMove(position, iccs);
    if (move === null) throw new Error(`夹具着法不合法：${iccs}`);
    const captured = position.board[move.to] ?? '';
    history.push({ zh: formatChinese(position, move), iccs, captured });
    lastMove = { from: move.from, to: move.to, iccs, zh: history[history.length - 1].zh };
    position = applyMove(position, move);
  }
  // 宿主下发的 legalTargets 就是引擎的合法着法目录按起点分组
  const legalTargets = {};
  for (const move of generateMoves(position)) {
    if (legalTargets[move.from] === undefined) legalTargets[move.from] = [];
    legalTargets[move.from].push(move.to);
  }
  for (const key of Object.keys(legalTargets)) legalTargets[key].sort((a, b) => a - b);
  return {
    revision: 3,
    fen: positionToFen(position),
    turn: position.turn,
    hero: 'r',
    opponent: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4', label: 'deepseek-v4' },
    phase: 'playing',
    pending: null,
    status: { state: 'playing', winner: null, reasonZh: '' },
    board: position.board.slice(),
    lastMove,
    legalTargets,
    history,
    clock: { red: 452000, black: 388000 },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, calls: 1 },
    message: null,
    error: null,
    saved: true,
    ...overrides,
  };
}

// 两手（红先黑应）之后轮到红方——这样「点己方子 → 点目标」才是可交互状态
const projection = (overrides) => projectionFrom(['h2e2', 'b9c7'], overrides);

/**
 * 装配一个可驱动面板的环境。
 * @param options - `{ script, tabOverrides }`。
 * @returns `{ runtime, host, drive, scheduled, ctx }`。
 */
async function setup(options) {
  const opts = options ?? {};
  const loader = await loadPlugin();
  const runtime = createRuntime();
  loader.setReact(runtime.react);
  const plugin = loader.module.factory(loader.requireStub);

  const host = createHost(opts.script ?? { state: () => ({ ok: true, value: projection() }) });
  const scheduled = [];
  const record = { registrations: [], injects: [], locales: [], tokens: [] };
  const ctx = {
    effect: (callback) => {
      const disposer = callback();
      return typeof disposer === 'function' ? disposer : () => {};
    },
    get(name) {
      if (name === 'connection') return { rpc: { call: host.call } };
      if (name === 'timer') {
        return {
          timeout: (callback, delay) => {
            const entry = { callback, delay, cancelled: false };
            scheduled.push(entry);
            return () => {
              entry.cancelled = true;
            };
          },
        };
      }
      return undefined;
    },
    locale: {
      register: (namespace, dictionaries) => {
        record.locales.push({ namespace, dictionaries });
        return () => {};
      },
      bind: (namespace) => (key, params) => (namespace === 'xiangqi' ? t(key, params) : key),
    },
    theme: { overrideTokens: (source, tokens) => (record.tokens.push({ source, tokens }), () => {}) },
    slots: {
      inject: (key, callback) => record.injects.push({ key, callback }),
      register: (options, component) => (record.registrations.push({ options, component }), () => {}),
    },
    sidebarRightTabs: { register: (definition) => (record.tabTypes ??= [], record.tabTypes.push(definition), () => {}) },
  };
  plugin.apply(ctx);
  for (const entry of record.injects) entry.callback();

  const tabEntry = record.registrations.find((entry) => entry.options.name === 'sidebar.right.pane.tab');
  const injected = tabEntry.options.inject('session-1');
  const tabInfo = {
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1' },
    tab: {
      id: 'tab-1',
      kind: 'xiangqi',
      visible: true,
      signal: undefined,
      actions: {},
      navigation: { address: 'page:xiangqi', revision: 1 },
      ...(opts.tabOverrides ?? {}),
    },
  };
  const element = tabEntry.component({
    useTabInfo: () => tabInfo,
    useSessions: (selector) => selector({ byId: { 'session-1': { id: 'session-1', cwd: '/tmp/ws' } } }),
    t,
    sessionId: 'session-1',
    xq: injected.xq,
  });

  return {
    runtime,
    host,
    scheduled,
    ctx,
    record,
    element,
    timers: loader.timers,
    /** 渲染并排空异步。 */
    drive: () => runtime.settle(element),
  };
}

/** 取状态条的可见文本。 */
function statusText(nodes) {
  const node = nodes.find((entry) => typeof entry.props['data-xq-status'] === 'string');
  return node === undefined ? '' : node.children.join('');
}

/** 取棋盘上的棋子数。 */
function pieceCount(nodes) {
  return nodes.filter((node) => node.props.className === 'xq-pieceFace' && node.type === 'circle').length;
}

/**
 * 从渲染结果里反解出「格号 → 棋子汉字」。
 *
 * 渲染层把每枚棋子画成 `<g transform="translate(x y)">`，坐标由几何公式算出，所以
 * 反解回格号是可靠的（残影元素带 `--xq-dx`，跳过）。
 * @param nodes - 摊平后的元素数组。
 * @param u - 单位。
 * @returns Map<格号, 棋子汉字>。
 */
function pieceMap(nodes, u) {
  const map = new Map();
  const pad = 0.65 * u;
  for (const node of nodes) {
    if (node.type !== 'g') continue;
    const transform = node.props?.transform;
    if (typeof transform !== 'string' || !transform.startsWith('translate(')) continue;
    const inner = node.children.find((child) => child !== null && typeof child === 'object' && child.type === 'g');
    if (inner === undefined) continue;
    const innerClass = typeof inner.props?.className === 'string' ? inner.props.className : '';
    if (innerClass.includes('Ghost')) continue; // 吃子/悔棋残影不算盘上的子
    const text = inner.children.find((child) => child !== null && typeof child === 'object' && child.type === 'text');
    if (text === undefined) continue;
    const match = /^translate\(([-0-9.]+) ([-0-9.]+)\)$/.exec(transform);
    if (match === null) continue;
    const col = Math.round((Number(match[1]) - pad) / u);
    const row = Math.round((Number(match[2]) - pad) / u);
    if (row < 0 || row > 9 || col < 0 || col > 8) continue;
    map.set(row * 9 + col, String(text.children.join('')));
  }
  return map;
}

/** 按文本找一个按钮。 */
function buttonByLabel(nodes, label) {
  const button = nodes.find(
    (node) => node.type === 'button' && node.children.filter((child) => typeof child === 'string').join('') === label,
  );
  assert.ok(button, `找不到按钮「${label}」`);
  return button;
}

/** 按 ply 找棋谱里的那一手按钮。 */
function moveButton(nodes, ply) {
  const button = nodes.find((node) => node.type === 'button' && node.props['data-xq-ply'] === ply);
  assert.ok(button, `找不到第 ${ply} 手的棋谱按钮`);
  return button;
}

/** 当前的单位 u（从 svg 宽度反推）。 */
function unitOf(nodes) {
  const svg = nodes.find((node) => node.type === 'svg' && node.props.role === 'grid');
  return Number(svg.props.width) / 9.3;
}

/** 找到某一格的命中矩形（父级 g 上的指针回调就是交互层）。 */
function hitCell(nodes, index) {
  const cell = nodes.find((node) => node.props.role === 'gridcell' && node.props.id.endsWith(`-cell-${index}`));
  assert.ok(cell, `找不到格 ${index} 的命中矩形`);
  return cell;
}

/** 找到承载指针事件的父级 g（交互层）。 */
function hitGroup(nodes) {
  const cell = nodes.find((node) => node.props.role === 'gridcell');
  return { cells: cell, onPointerDown: undefined };
}

/** 用坐标触发一次真实的落子手势（pointerdown → pointerup 到目标格）。 */
function pointerEvent(svgWidth, u, index, orientation = 'r') {
  const col = index % 9;
  const row = Math.floor(index / 9);
  const visualCol = orientation === 'b' ? 8 - col : col;
  const visualRow = orientation === 'b' ? 9 - row : row;
  const pad = 0.65 * u;
  const scale = svgWidth / (9.3 * u);
  return {
    clientX: (pad + visualCol * u) * scale,
    clientY: (pad + visualRow * u) * scale,
    button: 0,
    pointerId: 1,
    currentTarget: {
      ownerSVGElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: svgWidth, height: 10.3 * u * scale }) },
      setPointerCapture() {},
    },
  };
}

test('进入面板立刻拉一次 state，并把投影渲染成棋盘（含 real 落子与读屏标签）', async () => {
  const app = await setup();
  const { nodes } = await app.drive();

  assert.deepEqual(app.host.endpoints(), ['state'], '进入面板只该发一次 state');
  assert.equal(app.host.payloads('state')[0].sessionId, 'session-1');
  assert.equal(app.host.payloads('state')[0].cwd, '/tmp/ws', '工作区要一起发出去，落盘位置才与命令/工具一致');

  assert.equal(pieceCount(nodes), 32, '标准局面起手一手，盘上应有 32 枚棋子');
  const pieces = pieceMap(nodes, unitOf(nodes));
  assert.equal(pieces.size, 32);
  assert.equal(pieces.get(67), '炮', '红炮已从 h2 平到 e2');
  assert.equal(pieces.get(70), undefined, 'h2 已经空了');
  assert.equal(nodes.filter((node) => node.props.role === 'gridcell').length, 90);
  assert.equal(statusText(nodes), zh['status.ready']);
  assert.ok(nodes.some((node) => node.children.join('').includes('炮二平五')), '着法列表要显示中文记谱');
  assert.ok(
    nodes.some((node) => typeof node.props['aria-label'] === 'string' && node.props['aria-label'] === '红方 车，九路，底线'),
    '红方底线的车必须报成「红方 车，九路，底线」',
  );

  // 对手模型名与 token 用量（FR23/UI-31）
  const text = nodes
    .filter((node) => node.type === 'span')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
    .join('|');
  assert.match(text, /deepseek-v4/);
  assert.match(text, /15 tokens/);
  app.runtime.cleanupAll();
});

test('非法目标：抖动 + 状态条给出原因，且不发 RPC', async () => {
  const app = await setup();
  const { nodes } = await app.drive();
  const u = Number(nodes.find((node) => node.type === 'svg' && node.props.role === 'grid').props.width) / 9.3;
  const svgWidth = Number(nodes.find((node) => node.type === 'svg' && node.props.role === 'grid').props.width);
  const group = nodes.find((node) => node.props.onPointerDown !== undefined && node.children.length === 90);

  // 先点红炮（67 = 已选中的起点）
  group.props.onPointerDown(pointerEvent(svgWidth, u, 67));
  let pass = await app.drive();
  const groupAfter = pass.nodes.find((node) => node.props.onPointerDown !== undefined && node.children.length === 90);
  // 再点一个不在 legalTargets 里的空点（30）
  groupAfter.props.onPointerDown(pointerEvent(svgWidth, u, 30));
  const after = await app.drive();

  assert.deepEqual(app.host.endpoints(), ['state'], '本地能判非法就不该打扰宿主');
  const reason = statusText(after.nodes);
  assert.notEqual(reason, zh['status.ready']);
  assert.equal(
    after.nodes.filter((n) => typeof n.props.className === 'string' && n.props.className.includes('xq-shake')).length,
    1,
    '非法着法时棋子要抖动（120 ms）',
  );
  assert.match(reason, /非法|不能|不可|没有|无法|挡|蹩|塞|空/, `状态条要给出人话原因，实际「${reason}」`);
  app.runtime.cleanupAll();
});

test('点合法目标：把 { from, to, iccs } 发给宿主（M3 的既定形状）', async () => {
  const app = await setup({
    script: {
      state: () => ({ ok: true, value: projection() }),
      // 人之手：炮五进四（e2e6）吃掉 row3col4 的黑卒，随后轮到 AI
      move: () => ({
        ok: true,
        value: projectionFrom(['h2e2', 'b9c7', 'e2e6'], { revision: 4, pending: 'ai-thinking' }),
      }),
    },
  });
  const first = await app.drive();
  const svg = first.nodes.find((node) => node.type === 'svg' && node.props.role === 'grid');
  const u = Number(svg.props.width) / 9.3;
  const svgWidth = Number(svg.props.width);
  const group = first.nodes.find((node) => node.props.onPointerDown !== undefined && node.children.length === 90);
  group.props.onPointerDown(pointerEvent(svgWidth, u, 67));
  const selected = await app.drive();
  const group2 = selected.nodes.find((node) => node.props.onPointerDown !== undefined && node.children.length === 90);
  group2.props.onPointerDown(pointerEvent(svgWidth, u, 31));
  const after = await app.drive();

  assert.deepEqual(app.host.endpoints(), ['state', 'move']);
  const payload = app.host.payloads('move')[0];
  assert.deepEqual({ from: payload.from, to: payload.to, iccs: payload.iccs }, { from: 67, to: 31, iccs: 'e2e6' });
  assert.equal(payload.sessionId, 'session-1');
  // 落子成功后应进入 AI 思考态，并开始轮询
  assert.equal(statusText(after.nodes), zh['status.aiThinking'].replace('{seconds}', '0'));
  assert.ok(
    after.nodes.some((n) => n.props['aria-busy'] === 'true'),
    'AI 思考中要给状态条 aria-busy',
  );
  assert.ok(buttonByLabel(after.nodes, zh['action.fallback']), 'AI 思考中必须提供「由本地引擎代走」（Q7）');
  assert.equal(pendingTimers(app.scheduled).length, 1, 'ai-thinking 时应恰好排一个轮询计时器');
  assert.equal(pendingTimers(app.scheduled)[0].delay, 800);
  app.runtime.cleanupAll();
});

test('revision 栅栏：乱序到达的旧响应被丢弃，棋盘不倒回上一步', async () => {
  let served = 0;
  // 只有一枚棋子：一旦被接受，棋盘上就只剩 1 枚，很容易看出来
  const stale = projection({
    revision: 4,
    board: (() => {
      const board = new Array(90).fill('');
      board[85] = 'K';
      return board;
    })(),
    pending: 'ai-thinking',
    history: [],
  });
  const app = await setup({
    script: {
      state: () => {
        served += 1;
        if (served === 1) {
          return { ok: true, value: projectionFrom(['h2e2', 'b9c7'], { revision: 9, pending: 'ai-thinking' }) };
        }
        return { ok: true, value: stale };
      },
    },
  });
  const first = await app.drive();
  assert.equal(pieceCount(first.nodes), 32, '第一份投影（revision 9）先落地');
  // 触发一次轮询：宿主回的是 revision 4，必须被栅栏丢掉
  const active = pendingTimers(app.scheduled);
  assert.equal(active.length, 1);
  fireTimer(active[0]);
  const after = await app.drive();
  assert.equal(pieceCount(after.nodes), 32, '旧 revision 不该覆盖新局面');
  assert.deepEqual(app.host.endpoints(), ['state', 'state']);
  app.runtime.cleanupAll();
});

test('AI 回合：轮询退避到 2 s，pending 清零后立刻停止', async () => {
  let polled = 0;
  const app = await setup({
    script: {
      state: () => {
        polled += 1;
        const thinking = (revision) =>
          projectionFrom(['h2e2', 'b9c7', 'e2e6'], { revision, pending: 'ai-thinking' });
        const idle = (revision) => projectionFrom(['h2e2', 'b9c7', 'e2e6', 'h7g7'], { revision, pending: null });
        if (polled === 1) return { ok: true, value: thinking(3) };
        if (polled === 2) return { ok: true, value: thinking(4) };
        return { ok: true, value: idle(5) };
      },
    },
  });
  await app.drive();
  const active = pendingTimers(app.scheduled);
  assert.equal(active.length, 1, 'pending=ai-thinking 时必须开始轮询');
  assert.equal(active[0].delay, 800);
  fireTimer(active[0]);
  await app.drive();
  const second = pendingTimers(app.scheduled);
  assert.equal(second.length, 1);
  assert.equal(second[0].delay, 1080, '第二轮按 ×1.35 退避');
  fireTimer(second[0]);
  const settled = await app.drive();
  assert.equal(statusText(settled.nodes), zh['status.ready'], 'pending 清零后状态条回到就绪');
  assert.equal(pendingTimers(app.scheduled).length, 0, '空闲时零轮询');
  app.runtime.cleanupAll();
});

test('AI 超时提示：30 s 到点后停止轮询并在状态条说明', async () => {
  const app = await setup({
    script: {
      state: () => ({
        ok: true,
        value: projectionFrom(['h2e2', 'b9c7', 'e2e6'], { revision: 4, pending: 'ai-thinking' }),
      }),
    },
  });
  // 轮询循环用 Date.now() 算「已经等了多久」，所以这里换一个可控时钟。
  const realNow = Date.now;
  let clock = 1_700_000_000_000;
  Date.now = () => clock;
  try {
    await app.drive();
    let guard = 0;
    let elapsed = 0;
    while (guard < 200) {
      const active = pendingTimers(app.scheduled);
      if (active.length === 0) break;
      clock += active[0].delay;
      elapsed += active[0].delay;
      fireTimer(active[0]);
      // 轮询回调里的 await 需要一次微任务才能落地
      await app.drive();
      guard += 1;
    }
    assert.ok(guard < 200, '轮询必须在 75 s 内收工，而不是无限轮下去');
    assert.equal(pendingTimers(app.scheduled).length, 0);
    assert.ok(elapsed >= 75000, `收工时间应越过 75 s，实际 ${elapsed} ms`);
    assert.ok(elapsed < 80000, `收工不该拖太久，实际 ${elapsed} ms`);
    const nodes = (await app.drive()).nodes;
    assert.match(statusText(nodes), /本地引擎/, '超时后要提示可以点「由本地引擎代走」');
  } finally {
    Date.now = realNow;
  }
  app.runtime.cleanupAll();
});

test('tab.visible === false：零轮询、零 state 请求', async () => {
  const app = await setup({ tabOverrides: { visible: false } });
  const { nodes } = await app.drive();
  assert.deepEqual(app.host.endpoints(), [], '不可见时一个请求都不该发（§7.5.3）');
  assert.equal(pendingTimers(app.scheduled).length, 0);
  assert.equal(pieceCount(nodes), 0, '不可见时画的是空盘（但结构仍在，切回来即可填）');
  app.runtime.cleanupAll();
});

test('RPC 不可用（没有 connection 服务）：只读降级 + 状态条说明', async () => {
  const loader = await loadPlugin();
  const runtime = createRuntime();
  loader.setReact(runtime.react);
  const plugin = loader.module.factory(loader.requireStub);
  const record = { registrations: [], injects: [] };
  const ctx = {
    effect: (callback) => {
      const disposer = callback();
      return typeof disposer === 'function' ? disposer : () => {};
    },
    get: () => undefined,
    locale: {
      register: () => () => {},
      bind: () => (key, params) => t(key, params),
    },
    theme: { overrideTokens: () => () => {} },
    slots: {
      inject: (key, callback) => record.injects.push({ key, callback }),
      register: (options, component) => (record.registrations.push({ options, component }), () => {}),
    },
    sidebarRightTabs: { register: () => () => {} },
  };
  plugin.apply(ctx);
  for (const entry of record.injects) entry.callback();
  const tabEntry = record.registrations.find((entry) => entry.options.name === 'sidebar.right.pane.tab');
  const element = tabEntry.component({
    useTabInfo: () => ({ sidebar: {}, panel: {}, tab: { id: 't', visible: true, signal: undefined, actions: {}, navigation: {} } }),
    useSessions: (selector) => selector({ byId: {} }),
    t,
    sessionId: 'session-1',
    xq: tabEntry.options.inject('session-1').xq,
  });
  const { nodes } = await runtime.settle(element);
  assert.equal(nodes.filter((node) => node.props.role === 'gridcell').length, 90, '连不上也要画出棋盘');
  assert.match(statusText(nodes), /无法连接宿主/);
  // 所有动作按钮都该禁用（不能对着假棋盘走子）
  const buttons = nodes.filter((node) => node.type === 'button');
  assert.ok(buttons.length > 0);
  assert.equal(buttons.every((node) => node.props.disabled === true), true, '降级时按钮应全部禁用');
  runtime.cleanupAll();
});

test('非我方回合：点击只高亮该子（教学提示）+ 说明原因，绝不落子', async () => {
  // 只走了一手（红方走完），轮到黑方 → 对红方是只读
  const app = await setup({ script: { state: () => ({ ok: true, value: projectionFrom(['h2e2']) }) } });
  const first = await app.drive();
  const u = unitOf(first.nodes);
  const svgWidth = Number(first.nodes.find((n) => n.type === 'svg' && n.props.role === 'grid').props.width);
  const group = first.nodes.find((n) => n.props.onPointerDown !== undefined && n.children.length === 90);

  // 点自己的红炮：应当被选中（高亮），并在状态条说明现在不是你的回合
  group.props.onPointerDown(pointerEvent(svgWidth, u, 67));
  const picked = await app.drive();
  assert.equal(
    picked.nodes.filter((n) => n.props.className === 'xq-selectRing').length,
    1,
    '只读时也要给出教学性高亮',
  );
  assert.equal(statusText(picked.nodes), zh['status.notYourTurn']);
  // 只读时不该画可走点（无法落子，画出来是误导）
  assert.equal(picked.nodes.filter((n) => n.props.className === 'xq-targetDot').length, 0);

  // 再点一个目标：不落子，只再说明一次
  const group2 = picked.nodes.find((n) => n.props.onPointerDown !== undefined && n.children.length === 90);
  group2.props.onPointerDown(pointerEvent(svgWidth, u, 31));
  const after = await app.drive();
  assert.deepEqual(app.host.endpoints(), ['state'], '只读时一个 RPC 都不该发');
  assert.equal(statusText(after.nodes), zh['status.notYourTurn']);
  app.runtime.cleanupAll();
});

test('悔棋：发 { plies: 2 }，棋谱随之回退', async () => {
  const app = await setup({
    script: {
      state: () => ({ ok: true, value: projection() }),
      undo: () => ({ ok: true, value: projectionFrom([], { revision: 8 }) }),
    },
  });
  const first = await app.drive();
  assert.ok(first.nodes.some((n) => n.children.join('').includes('炮二平五')));
  buttonByLabel(first.nodes, zh['action.undo']).props.onClick();
  const after = await app.drive();
  assert.deepEqual(app.host.endpoints(), ['state', 'undo']);
  assert.deepEqual(app.host.payloads('undo')[0], { sessionId: 'session-1', cwd: '/tmp/ws', plies: 2 });
  assert.ok(after.nodes.some((n) => n.children.join('').includes(zh['moves.empty'])), '棋谱回到空');
  app.runtime.cleanupAll();
});

test('提示：发 { count: 3 }，画出箭头并标出条数，不碰模型', async () => {
  const app = await setup({
    script: {
      state: () => ({ ok: true, value: projection() }),
      hint: () => ({
        ok: true,
        value: {
          candidates: [
            { iccs: 'e2e6', zh: '炮五进四', score: 12 },
            { iccs: 'h0g2', zh: '马二进三', score: 3 },
          ],
        },
      }),
    },
  });
  const first = await app.drive();
  buttonByLabel(first.nodes, zh['action.hint']).props.onClick();
  const after = await app.drive();
  assert.deepEqual(app.host.endpoints(), ['state', 'hint']);
  assert.deepEqual(app.host.payloads('hint')[0], { sessionId: 'session-1', cwd: '/tmp/ws', count: 3 });
  assert.equal(after.nodes.filter((n) => n.props.className === 'xq-hintLine').length, 2, '两条候选 → 两条箭头');
  assert.match(statusText(after.nodes), /已给出 2 条提示/);
  // 提示行必须同时给出记谱与评分（§7.4），只画箭头是不够的
  const hintItems = after.nodes.filter((n) => n.props.className === 'xq-hintItem');
  assert.equal(hintItems.length, 2);
  const hintText = after.nodes
    .filter((n) => typeof n.props.className === 'string' && n.props.className.startsWith('xq-hint'))
    .flatMap((n) => n.children.filter((c) => typeof c === 'string'))
    .join('|');
  assert.match(hintText, /炮五进四/);
  assert.match(hintText, /\+0\.1/, '评分要带符号地显示成兵值（12 厘兵 = +0.1）');
  // 5 s 后自动消失（§7.4）；计时器登记在假 window 上，可以手动触发
  const hintTimer = [...app.timers.active.values()].find((entry) => entry.delay === 5000);
  assert.ok(hintTimer, '提示必须挂一个 5 s 的清理计时器');
  hintTimer.callback();
  const cleared = await app.drive();
  assert.equal(cleared.nodes.filter((n) => n.props.className === 'xq-hintLine').length, 0);
  app.runtime.cleanupAll();
});

test('复盘：点棋谱任一手切到该局面（只读），「回到当前」可返回', async () => {
  const app = await setup({
    script: {
      state: () => ({ ok: true, value: projection() }),
      review: () => ({ ok: true, value: { turningPoints: [1], review: { evalCurve: [] } } }),
    },
  });
  const live = await app.drive();
  const u = unitOf(live.nodes);
  const livePieces = pieceMap(live.nodes, u);
  assert.equal(livePieces.has(20), true, '走到第 2 手时黑马已在 c7（索引 20）');

  moveButton(live.nodes, 1).props.onClick();
  const reviewed = await app.drive();
  const reviewedPieces = pieceMap(reviewed.nodes, u);
  assert.equal(reviewedPieces.has(1), true, '第 1 手之后黑马还在 b9（索引 1）');
  assert.equal(reviewedPieces.has(20), false);
  assert.ok(buttonByLabel(reviewed.nodes, zh['action.live']), '复盘态必须给出「回到当前」');
  assert.deepEqual(
    reviewed.nodes.filter((n) => n.props.role === 'gridcell').length,
    90,
    '复盘时棋盘结构不变',
  );

  buttonByLabel(reviewed.nodes, zh['action.live']).props.onClick();
  const back = await app.drive();
  assert.equal(pieceMap(back.nodes, u).has(20), true, '回到当前局面');
  app.runtime.cleanupAll();
});

test('新对局：进行中的对局要二次确认，确认后才发 new', async () => {
  const app = await setup({
    script: {
      state: () => ({ ok: true, value: projection() }),
      new: () => ({ ok: true, value: projectionFrom([], { revision: 9 }) }),
    },
  });
  const first = await app.drive();
  buttonByLabel(first.nodes, zh['action.new']).props.onClick();
  const asked = await app.drive();
  assert.ok(asked.nodes.some((n) => n.children.includes(zh['confirm.new'])), '必须先问一句');
  assert.deepEqual(app.host.endpoints(), ['state'], '确认之前不该发 new');

  buttonByLabel(asked.nodes, zh['confirm.ok']).props.onClick();
  const done = await app.drive();
  assert.deepEqual(app.host.endpoints(), ['state', 'new']);
  assert.equal(statusText(done.nodes), zh['status.newGame']);
  assert.ok(done.nodes.some((n) => n.children.join('').includes(zh['moves.empty'])));
  app.runtime.cleanupAll();
});

test('新对局二次确认可以取消（此时不发 new）', async () => {
  const app = await setup({ script: { state: () => ({ ok: true, value: projection() }) } });
  const first = await app.drive();
  buttonByLabel(first.nodes, zh['action.new']).props.onClick();
  const asked = await app.drive();
  buttonByLabel(asked.nodes, zh['confirm.cancel']).props.onClick();
  const cancelled = await app.drive();
  assert.deepEqual(app.host.endpoints(), ['state']);
  assert.equal(cancelled.nodes.some((n) => n.children.includes(zh['confirm.new'])), false);
  app.runtime.cleanupAll();
});

test('认输：二次确认后发 resign，结算由宿主下发的结果呈现', async () => {
  const app = await setup({
    script: {
      state: () => ({ ok: true, value: projection() }),
      resign: () => ({
        ok: true,
        value: projectionFrom(['h2e2', 'b9c7'], {
          revision: 12,
          phase: 'finished',
          status: { state: 'resign', winner: 'b', reasonZh: '红方认输' },
        }),
      }),
    },
  });
  const first = await app.drive();
  buttonByLabel(first.nodes, zh['action.resign']).props.onClick();
  const asked = await app.drive();
  assert.ok(asked.nodes.some((n) => n.children.includes(zh['confirm.resign'])));
  buttonByLabel(asked.nodes, zh['confirm.ok']).props.onClick();
  const done = await app.drive();
  assert.deepEqual(app.host.endpoints(), ['state', 'resign']);
  assert.equal(statusText(done.nodes), zh['status.result.resign.red']);
  // 结局用 assertive 播报
  const alert = done.nodes.find((n) => n.props.role === 'alert');
  assert.ok(alert, '结局必须走 assertive 播报');
  // 结算后：走子类按钮全部禁用，但「新对局」与「复制棋谱」必须仍然可用
  for (const label of [zh['action.undo'], zh['action.resign'], zh['action.hint']]) {
    assert.equal(buttonByLabel(done.nodes, label).props.disabled, true, `${label} 应禁用`);
  }
  assert.notEqual(buttonByLabel(done.nodes, zh['action.new']).props.disabled, true, '结算后必须能开新局');
  assert.notEqual(buttonByLabel(done.nodes, zh['action.copy']).props.disabled, true, '结算后必须能复制棋谱');
  app.runtime.cleanupAll();
});

test('复制棋谱：可用时写剪贴板并提示成功，不可用时提示手动复制', async () => {
  const app = await setup({ script: { state: () => ({ ok: true, value: projection() }) } });
  const first = await app.drive();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const written = [];
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: async (text) => written.push(text) } },
      configurable: true,
    });
    buttonByLabel(first.nodes, zh['action.copy']).props.onClick();
    const after = await app.drive();
    assert.equal(written.length, 1);
    assert.match(written[0], /炮二平五/);
    assert.match(written[0], /当前局面/);
    assert.equal(statusText(after.nodes), zh['status.copied']);
  } finally {
    if (descriptor === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', descriptor);
  }
  app.runtime.cleanupAll();
});

test('键盘走子：Tab 进入 → 方向键移光标 → Enter 选中/落子 → Esc 取消（UI-26）', async () => {
  const app = await setup({
    script: {
      state: () => ({ ok: true, value: projection() }),
      move: () => ({
        ok: true,
        value: projectionFrom(['h2e2', 'b9c7', 'e2e6'], { revision: 4, pending: 'ai-thinking' }),
      }),
    },
  });
  const first = await app.drive();
  const svg = first.nodes.find((n) => n.type === 'svg' && n.props.role === 'grid');
  assert.equal(svg.props.tabIndex, 0, '棋盘必须是可 Tab 到达的一个焦点位');
  const key = (name) => ({ key: name, preventDefault() {}, stopPropagation() {} });

  // 光标从红帅(85)起步：上两格到 e2 的红炮(67)
  svg.props.onKeyDown(key('ArrowUp'));
  let pass = await app.drive();
  assert.equal(pass.nodes.filter((n) => n.props.className === 'xq-cursorBox').length, 1, '光标必须可见');
  const svg2 = pass.nodes.find((n) => n.type === 'svg' && n.props.role === 'grid');
  svg2.props.onKeyDown(key('ArrowUp'));
  pass = await app.drive();

  // Enter 选中
  pass.nodes.find((n) => n.type === 'svg' && n.props.role === 'grid').props.onKeyDown(key('Enter'));
  pass = await app.drive();
  assert.equal(pass.nodes.filter((n) => n.props.className === 'xq-selectRing').length, 1, 'Enter 应选中棋子');
  assert.equal(pass.nodes.filter((n) => n.props.className === 'xq-targetDot').length > 0, true, '选中后应显示可走点');

  // Esc 取消
  pass.nodes.find((n) => n.type === 'svg' && n.props.role === 'grid').props.onKeyDown(key('Escape'));
  pass = await app.drive();
  assert.equal(pass.nodes.filter((n) => n.props.className === 'xq-selectRing').length, 0, 'Esc 应取消选中');

  // 重新选中并走到合法目标（31 = e6 的黑卒）：Enter 落子
  let nodes = pass.nodes;
  nodes.find((n) => n.type === 'svg' && n.props.role === 'grid').props.onKeyDown(key('Enter'));
  nodes = (await app.drive()).nodes;
  for (let i = 0; i < 4; i += 1) {
    nodes.find((n) => n.type === 'svg' && n.props.role === 'grid').props.onKeyDown(key('ArrowUp'));
    nodes = (await app.drive()).nodes;
  }
  nodes.find((n) => n.type === 'svg' && n.props.role === 'grid').props.onKeyDown(key('Enter'));
  const after = await app.drive();
  assert.deepEqual(app.host.endpoints(), ['state', 'move'], '纯键盘也必须能完成一手');
  assert.deepEqual(
    { from: app.host.payloads('move')[0].from, to: app.host.payloads('move')[0].to },
    { from: 67, to: 31 },
  );
  assert.equal(statusText(after.nodes), zh['status.aiThinking'].replace('{seconds}', '0'));
  app.runtime.cleanupAll();
});

test('复盘时左右方向键前后翻手（不再移动光标）', async () => {
  const app = await setup({
    script: {
      state: () => ({ ok: true, value: projection() }),
      review: () => ({ ok: true, value: { turningPoints: [] } }),
    },
  });
  const live = await app.drive();
  moveButton(live.nodes, 1).props.onClick();
  const reviewed = await app.drive();
  const key = (name) => ({ key: name, preventDefault() {}, stopPropagation() {} });
  // 复盘态棋盘给的是 review 键位：右翻一手 → 回到第 2 手
  reviewed.nodes
    .find((n) => n.type === 'svg' && n.props.role === 'grid')
    .props.onKeyDown(key('ArrowRight'));
  const after = await app.drive();
  assert.equal(pieceMap(after.nodes, unitOf(after.nodes)).has(20), true, '右翻应回到第 2 手的局面');
  assert.ok(buttonByLabel(after.nodes, zh['action.live']), '仍在复盘态（第 2 手 = 最后一手）');
  app.runtime.cleanupAll();
});

test('拖拽走子：按下己方子 → 拖到目标格松手即落子；松手在非法格则什么都不发生', async () => {
  const app = await setup({
    script: {
      state: () => ({ ok: true, value: projection() }),
      move: () => ({
        ok: true,
        value: projectionFrom(['h2e2', 'b9c7', 'e2e6'], { revision: 4, pending: 'ai-thinking' }),
      }),
    },
  });
  const first = await app.drive();
  const u = unitOf(first.nodes);
  const svgWidth = Number(first.nodes.find((n) => n.type === 'svg' && n.props.role === 'grid').props.width);
  const group = first.nodes.find((n) => n.props.onPointerDown !== undefined && n.children.length === 90);
  const from = pointerEvent(svgWidth, u, 67);
  const to = pointerEvent(svgWidth, u, 31);
  const drag = (event) => ({ ...event, clientX: event.clientX, clientY: event.clientY });

  const pressed = { ...from };
  group.props.onPointerDown(pressed);
  let pass = await app.drive();
  const group2 = pass.nodes.find((n) => n.props.onPointerDown !== undefined && n.children.length === 90);
  // 拖过阈值（>6px）后停在目标格
  group2.props.onPointerMove({ ...to, clientX: to.clientX + 40, clientY: to.clientY + 40 });
  group2.props.onPointerMove(to);
  group2.props.onPointerUp(to);
  const after = await app.drive();
  assert.deepEqual(app.host.endpoints(), ['state', 'move'], '拖拽松手应当落子');
  assert.deepEqual(
    { from: app.host.payloads('move')[0].from, to: app.host.payloads('move')[0].to },
    { from: 67, to: 31 },
  );
  app.runtime.cleanupAll();
});

test('拖拽松手在非法格：不落子，只在状态条说明', async () => {
  const app = await setup({ script: { state: () => ({ ok: true, value: projection() }) } });
  const first = await app.drive();
  const u = unitOf(first.nodes);
  const svgWidth = Number(first.nodes.find((n) => n.type === 'svg' && n.props.role === 'grid').props.width);
  const group = first.nodes.find((n) => n.props.onPointerDown !== undefined && n.children.length === 90);
  group.props.onPointerDown(pointerEvent(svgWidth, u, 67));
  const pass = await app.drive();
  const group2 = pass.nodes.find((n) => n.props.onPointerDown !== undefined && n.children.length === 90);
  const bad = pointerEvent(svgWidth, u, 30);
  group2.props.onPointerMove({ ...bad, clientX: bad.clientX + 40, clientY: bad.clientY + 40 });
  group2.props.onPointerUp(bad);
  const after = await app.drive();
  assert.deepEqual(app.host.endpoints(), ['state'], '非法目标不能发 RPC');
  assert.match(statusText(after.nodes), /非法|不能|不可|没有|无法|挡|蹩|塞|空/);
  app.runtime.cleanupAll();
});
