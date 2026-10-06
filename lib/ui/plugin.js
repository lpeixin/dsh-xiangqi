/**
 * 浏览器半的装配层：`inject` + `apply(ctx)`。
 *
 * 免构建产物的运行时契约（§4.5、T3）在这里落地：
 *
 *  - 生成脚本把「引擎 + 本目录的 UI 源码」拼进一个 IIFE，`factory` 只做 `require('react')`
 *    与 `return { inject, apply }`；
 *  - `factory` 体内**零副作用**（bundle 会被 HMR 重新执行），所有注册都在 `apply(ctx)`
 *    里用 `ctx.effect` / `ctx.slots.inject` 完成，disposer 由 Cordis 持有；
 *  - `require` 只用于基线表的 `react`（官方规范明确劝阻 require 官方客户端 UI 包，T18）；
 *  - 客户端到达宿主半只有 `ctx.connection.rpc.call('/xiangqi-mate', …)`（§7.5.3），
 *    **没有** `host.call`（那是动态 Cordis 包的能力）。
 *
 * 三处承载（§4.3）：
 *  ① 右栏 tab 类型（两阶段注册：类型声明 + 正文/标题座位）——主路径；
 *  ② 主区域面板 `main` key `xiangqi` + 左栏 `sidebar.panellist` 同 id 图标——备选；
 *  ③ 上述两者都会在默认页（「+ → 开始」）留下一个「象棋」入口卡片。
 */

import { LOCALE_NS, dicts } from './i18n.js';
import { XiangqiMainPanel, XiangqiPanelIcon, XiangqiTabBody, XiangqiTabTitle } from './panel.js';
import { createGameRpc } from './rpc.js';

/** tab 类型在 tab 系统中的唯一身份；它**同时**是正文/标题座位的 key。 */
export const TAB_ID = 'dsh-xiangqi-mate/xiangqi';
/** 主面板的 key；`sidebar.panellist` 的 id 必须与它相同（T15）。 */
export const PANEL_KEY = 'xiangqi';

/** Cordis 服务依赖：插槽与文案是硬依赖；`connection` / `sidebarRight` / `layout` 一律 ctx.get 判空。 */
export const inject = ['slots', 'locale', 'theme', 'timer', 'sidebarRightTabs'];

/**
 * 客户端插件主体。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, dicts), 'xiangqi: dictionaries');
  const t = ctx.locale.bind(LOCALE_NS);

  // 木色棋盘面走官方 overrideTokens；每个值必须是 { light, dark } 对（T8）。
  // 组件里一律写成 var(--xiangqi-*, var(--dsw-alias-*))，令牌缺失时回落而不是崩。
  //
  // 取值不是随手挑的，`test/client/bundle.test.js` 里按 WCAG 相对亮度逐条校验：
  //  - **棋子底盘必须够亮/够暗**，因为棋子字色来自主题（红方 = state-error-primary：
  //    亮=red-600 #ec1313、暗=red-400 #f25a5a；黑方 = label-primary：亮≈#0f1115、暗≈#f9fafb）。
  //    实测：白底盘 #ffffff 对 #ec1313 = 4.5:1（刚好达标），所以亮色下**不能用木色象牙白**
  //    （#fdf7ea 只有 4.2:1），只能用纯白；暗色下 #2f261c 对 #f25a5a = 4.6:1。
  //  - **网格线对棋盘面 ≥3:1**（非文本图形的下限），故亮色用 #8a6a44 而非更浅的木色。
  ctx.effect(
    () =>
      ctx.theme.overrideTokens('dsh-xiangqi-mate', {
        '--xiangqi-board-face': { light: '#f7e8ca', dark: '#241d16' },
        '--xiangqi-river': { light: '#efdfc0', dark: '#2b231a' },
        '--xiangqi-grid': { light: '#8a6a44', dark: '#7b6853' },
        '--xiangqi-piece-face': { light: '#ffffff', dark: '#2f261c' },
      }),
    'xiangqi: board tokens',
  );

  // ── 通道①的客户端半边 ────────────────────────────────────────────────────
  const connection = ctx.get('connection');
  const rpcFace = connection !== undefined && connection !== null ? connection.rpc : undefined;
  const call =
    rpcFace !== undefined && typeof rpcFace.call === 'function'
      ? (channel, endpoint, payload, signal) => rpcFace.call(channel, endpoint, payload, signal)
      : null;

  const runtime = {
    /**
     * 每个会话一个 RPC 客户端（宿主用 payload.sessionId 校验归属，§7.5.3 约束 4）。
     * @param sessionId - 会话 id。
     * @param cwd - 会话工作区，宿主据此决定落盘位置（与命令/工具路径一致）。
     */
    game: (sessionId, cwd) => createGameRpc({ call, sessionId, cwd }),
    /** 轮询计时器走 ctx.timer（随 fiber 自动释放，§7.5.3）。 */
    schedule: (callback, delayMs) => {
      const timer = ctx.get('timer');
      if (timer !== undefined && timer !== null && typeof timer.timeout === 'function') {
        return timer.timeout(callback, delayMs);
      }
      const handle = globalThis.setTimeout(callback, delayMs);
      return () => globalThis.clearTimeout(handle);
    },
    hasSidebar: ctx.get('sidebarRight') !== undefined,
    hasMain: ctx.get('layout') !== undefined,
    /** 从主面板跳回右栏 tab（左栏图标做不到这件事，T15）。 */
    openSidebar: () => {
      const sidebar = ctx.get('sidebarRight');
      if (sidebar === undefined || sidebar === null) return;
      try {
        sidebar.openTab('xiangqi');
      } catch {
        /* 没有选中会话时 openTab 会抛：这是用户态，不该冒泡成插件错误 */
      }
    },
    /** 从右栏 tab 切到主面板。 */
    openMain: () => {
      const layout = ctx.get('layout');
      if (layout === undefined || layout === null) return;
      try {
        layout.selectPanel(PANEL_KEY);
      } catch {
        /* key 未注册（例如主面板座位被别的插件顶掉）时静默 */
      }
    },
  };

  /**
   * 槽注入面。
   *
   * session 作用域会收到 `(sessionId, actions)`，root 作用域只收到 `(actions | undefined)`；
   * 用「第一个参数是不是字符串」区分，避免给两种作用域各写一份。
   */
  const injectRuntime = (keyOrActions) => ({
    xq: runtime,
    sessionKey: typeof keyOrActions === 'string' ? keyOrActions : undefined,
  });

  // ── ① 右栏 tab 类型：类型声明（无运行时钩子）+ 引导页入口 ────────────────────
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: 'xiangqi',
        priority: 'extension',
        title: () => t('tab.title'),
        guide: [
          {
            id: 'xiangqi',
            order: 100,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
          },
        ],
      }),
    'xiangqi: sidebar tab type',
  );

  // ② 正文与标题座位：key 必须等于上面的类型 id；声明 locale 才会拿到 t。
  //    注意不要重复包 ctx.effect —— ctx.slots.register 内部已经包了（T9）。
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: LOCALE_NS, inject: injectRuntime },
      XiangqiTabBody,
    ),
  );
  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register(
      { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: LOCALE_NS },
      XiangqiTabTitle,
    ),
  );

  // ── 备选承载：主区域面板 + 左栏图标（id 与 main 的 key 必须一致） ─────────────
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: PANEL_KEY, locale: LOCALE_NS, inject: injectRuntime },
      XiangqiMainPanel,
    ),
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_KEY,
        order: 100,
        locale: LOCALE_NS,
        label: () => t('panel.title'),
      },
      XiangqiPanelIcon,
    ),
  );
}
