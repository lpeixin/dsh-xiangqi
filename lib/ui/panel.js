/**
 * 承载层：取状态、发 RPC、轮询、错误边界（§7.1/§7.2 的最外层）。
 *
 * 这一层是**唯一**碰 `ctx`、RPC、计时器的地方；它把结果折成 `deriveModel` 要的
 * 「本地 UI 状态」，再把可渲染数据交给 `BoardView`。三层解耦因此是真实的：
 *
 * ```
 * XiangqiPanel（本文件）  状态 + 传输 + 生命周期
 *   XiangqiBoard          渲染层（纯）+ 交互层（只产意图）
 * ```
 *
 * 与宿主的所有交互都走通道①`ctx.connection.rpc.call('/xiangqi-mate', …)`（§7.5.3），
 * 客户端**从不**调用 `host.call`。连接不可用时整块面板降级为只读，并在状态条说明。
 */

import { XiangqiBoard } from './board.js';
import { iccsOf, initialBoard, initialFen, localTargets, precheckMove, replayToPly } from './engine-bridge.js';
import { BoardGlyph, StyleTag, el } from './icons.js';
import { acceptProjection, cellLabelKeys, computeGeometry, deriveModel, errorKeyOf, formatClock, formatScore, hasHostTargets, kingIndex, moveRows, normalizeHints, recordText, resolveIntent, sameBoard, shouldPoll, statusLine, stepCursor } from './model.js';
import { createPollLoop } from './poller.js';

const ORIENTATION = 'r';
/** 本地即时消息的存活时间（毫秒）：够看清一行字，又不至于长期占着状态条。 */
const NOTICE_MS = 3200;
/** 提示着法展示 5 s（§7.4）。 */
const HINT_MS = 5000;
/** 吃子/悔棋残影的动画时长（§7.3）。 */
const GHOST_MS = 200;
/** 抖动 120 ms（§7.4）。 */
const SHAKE_MS = 140;

/** 主面板查找当前会话（root 作用域的组件拿不到 sessionId，§4.3）。 */
function selectMainSessionId(state) {
  const byId = state !== null && typeof state === 'object' ? state.byId : null;
  if (byId === null || typeof byId !== 'object') return undefined;
  for (const session of Object.values(byId)) {
    if (session !== null && typeof session === 'object' && (session.retainedBy?.mainView ?? 0) > 0) {
      return session.id;
    }
  }
  return undefined;
}

/** 一个可复用的「等宽计时」文本。 */

/**
 * 面板头部：对手标签、回合、计时、用量。
 * @param props - `{ t, model, projection }`。
 * @returns header 元素。
 */
function PanelHeader(props) {
  const { t, model } = props;
  const projection = props.projection ?? {};
  const opponent = model.opponent ?? {};
  const opponentLabel =
    opponent.kind === 'local' || opponent.mode === 'local'
      ? t('header.opponentLocal')
      : t('header.opponentModel', { model: opponent.model ?? opponent.provider ?? '—' });
  const usage = model.usage !== null && Number.isFinite(model.usage.totalTokens) ? model.usage.totalTokens : null;
  const clock = model.clock;
  const meta = [];
  meta.push(el('span', { key: 'you' }, t(`header.you.${model.hero === 'b' ? 'black' : 'red'}`)));
  meta.push(el('span', { key: 'opp' }, opponentLabel));
  if (model.phase !== 'finished') {
    meta.push(el('span', { key: 'turn' }, t(`header.turn.${model.turn === 'b' ? 'black' : 'red'}`)));
  }
  if (usage !== null) meta.push(el('span', { key: 'usage' }, t('header.usage', { tokens: usage })));
  if (clock !== null) {
    const red = Number.isFinite(clock.red) ? clock.red : null;
    const black = Number.isFinite(clock.black) ? clock.black : null;
    if (red !== null) meta.push(el('span', { key: 'cr' }, t('header.clock.red', { time: formatClock(red) })));
    if (black !== null) meta.push(el('span', { key: 'cb' }, t('header.clock.black', { time: formatClock(black) })));
  }
  if (model.history.length > 0) {
    meta.push(el('span', { key: 'ply' }, t('header.ply', { n: model.history.length })));
  }
  const saveNote = typeof projection.saved === 'boolean' && projection.saved === false;
  return el(
    'header',
    { className: 'xq-header' },
    el(
      'div',
      { className: 'xq-headerRow' },
      el(BoardGlyph, { size: 16 }),
      el('span', { className: 'xq-title' }, t('panel.title')),
      el('span', { className: 'xq-headerSpacer' }),
    ),
    el('div', { className: 'xq-meta' }, ...meta),
    saveNote ? el('div', { className: 'xq-notice' }, t('status.syncLost')) : null,
  );
}

/**
 * 状态条：本面板**唯一**的消息出口（§7.4），同时也是读屏播报口（§7.7）。
 * @param props - `{ t, line, announcement }`。
 * @returns div 元素。
 */
function StatusStrip(props) {
  const line = props.line;
  const text = props.t(line.key, line.params);
  const thinking = line.key === 'status.aiThinking';
  return el(
    'div',
    { className: `xq-status xq-status-${line.tone}`, 'aria-busy': thinking ? 'true' : undefined },
    el('span', {
      className: `xq-dot xq-dot-${line.tone}${thinking ? ' xq-dot-thinking' : ''}`,
      'aria-hidden': 'true',
    }),
    el(
      'span',
      {
        className: 'xq-statusText',
        role: line.assertive ? 'alert' : 'status',
        'aria-live': line.assertive ? 'assertive' : 'polite',
        'data-xq-status': line.key,
      },
      text,
    ),
    el('span', { className: 'xq-sr', 'aria-live': 'polite', 'data-xq-announce': '' }, props.announcement ?? ''),
  );
}

/**
 * 着法列表（复盘入口）。
 * @param props - `{ t, rows, activeIndex, disabled, turning, onJump }`。
 * @returns section 元素。
 */
function MoveList(props) {
  const rows = props.rows;
  const cells = [];
  for (const row of rows) {
    const side = (ply) => {
      if (ply === null) return null;
      const active = props.activeIndex === ply.index + 1;
      const isTurning = Array.isArray(props.turning) && props.turning.indexOf(ply.ply) >= 0;
      return el(
        'button',
        {
          key: `p${ply.ply}`,
          type: 'button',
          className: active ? 'xq-moveCell xq-moveActive' : 'xq-moveCell',
          disabled: props.disabled,
          onClick: () => props.onJump(ply.index + 1),
          title: isTurning ? props.t('moves.turning') : ply.iccs,
          'aria-label': props.t('moves.ply', { n: ply.ply }),
          'data-xq-ply': ply.ply,
        },
        ply.zh === '' ? props.t('moves.empty') : ply.zh,
      );
    };
    cells.push(
      el(
        'li',
        { className: 'xq-moveRow', key: row.no },
        el('span', { className: 'xq-moveNo' }, String(row.no)),
        side(row.red) ?? el('span', { className: 'xq-moveCell xq-moveEmpty', key: `e${row.no}` }, '…'),
        side(row.black) ?? el('span', { className: 'xq-moveCell xq-moveEmpty', key: `b${row.no}` }, '…'),
      ),
    );
  }
  return el(
    'section',
    { className: 'xq-moves', 'aria-label': props.t('moves.aria') },
    el('div', { className: 'xq-movesHead' }, props.t('moves.title')),
    rows.length === 0
      ? el('div', { className: 'xq-moveRow xq-moveEmpty' }, props.t('moves.empty'))
      : el('ul', { className: 'xq-movesList' }, ...cells),
  );
}

/**
 * 工具条。所有按钮都有文本标签（§7.7：不只有图标）。
 * @param props - `{ t, model, busy, offline, reviewing, hasSidebar, hasMain, handlers }`。
 * @returns div 元素。
 */
function Toolbar(props) {
  const { t, model } = props;
  const busy = props.busy === true;
  const offline = props.offline === true;
  const buttons = [];
  const push = (key, label, handler, opts) => {
    const options = opts ?? {};
    buttons.push(
      el(
        'button',
        {
          key,
          type: 'button',
          className: options.danger ? 'xq-btn xq-btnDanger' : options.primary ? 'xq-btn xq-btnPrimary' : 'xq-btn',
          onClick: handler,
          disabled: options.disabled === true,
          title: options.title ?? undefined,
        },
        label,
      ),
    );
  };

  push('new', t('action.new'), props.onNew, { disabled: offline });
  push('undo', t('action.undo'), props.onUndo, {
    disabled: offline || busy || model.history.length < 1 || model.finished,
    title: t('action.undo'),
  });
  push('hint', t('action.hint'), props.onHint, { disabled: offline || busy || model.finished });
  if (model.pending === 'ai-thinking') {
    push('fallback', t('action.fallback'), props.onFallback, { primary: true, disabled: offline });
  }
  if (model.reviewing) {
    push('live', t('action.live'), props.onLive);
  } else {
    push('review', t('action.review'), props.onReview, {
      disabled: model.history.length < 1 || props.reviewable !== true,
    });
  }
  push('copy', t('action.copy'), props.onCopy, { disabled: model.history.length < 1 });
  push('resign', t('action.resign'), props.onResign, {
    danger: true,
    disabled: offline || busy || model.finished,
  });
  if (props.hasSidebar === true) {
    push('sidebar', t('action.openSidebar'), props.onOpenSidebar);
  }
  if (props.hasMain === true) {
    push('main', t('action.openMain'), props.onOpenMain);
  }
  return el('div', { className: 'xq-toolbar' }, ...buttons);
}

/**
 * 提示行：箭头之外还要给出「记谱 + 评分」（§7.4）。
 * @param props - `{ t, hints }`。
 * @returns div 元素或 null。
 */
function HintRow(props) {
  const hints = props.hints;
  if (!Array.isArray(hints) || hints.length === 0) return null;
  return el(
    'div',
    { className: 'xq-hints', 'aria-label': props.t('board.hint') },
    ...hints.map((hint) =>
      el(
        'span',
        { className: 'xq-hintItem', key: hint.rank, title: hint.iccs },
        el('span', { className: 'xq-hintRank' }, String(hint.rank + 1)),
        el('span', { className: 'xq-hintZh' }, hint.zh === '' ? hint.iccs : hint.zh),
        hint.score === null
          ? null
          : el('span', { className: 'xq-hintScore' }, formatScore(hint.score)),
      ),
    ),
  );
}

/** 二次确认条（新对局 / 认输）。 */
function ConfirmBar(props) {
  return el(
    'div',
    { className: 'xq-confirm', role: 'group' },
    el('span', { className: 'xq-confirmText' }, props.t(props.questionKey)),
    el('button', { type: 'button', className: 'xq-btn xq-btnPrimary', onClick: props.onConfirm }, props.t('confirm.ok')),
    el('button', { type: 'button', className: 'xq-btn', onClick: props.onCancel }, props.t('confirm.cancel')),
  );
}

/**
 * 面板主体。
 *
 * @param props - 槽注入的 `{ t, sessionId, xq }`，加上承载层补充的
 *   `{ visible, signal, mode }`。主面板没有 `sessionId`，由外层用 `useSessions` 解析。
 * @returns 面板元素。
 */
export function XiangqiPanel(props) {
  const t = props.t;
  const xq = props.xq;
  const sessionId = typeof props.sessionId === 'string' ? props.sessionId : null;
  const cwd = typeof props.cwd === 'string' ? props.cwd : undefined;
  const visible = props.visible !== false;
  const mode = props.mode === 'main' ? 'main' : 'tab';

  const rpc = React.useMemo(() => xq.game(sessionId, cwd), [xq, sessionId, cwd]);
  const [projection, setProjection] = React.useState(null);
  const [offline, setOffline] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [cursor, setCursor] = React.useState(null);
  const [hints, setHints] = React.useState(null);
  const [reviewPly, setReviewPly] = React.useState(null);
  const [confirmKind, setConfirmKind] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [ghosts, setGhosts] = React.useState([]);
  const [undoGhost, setUndoGhost] = React.useState(null);
  const [hiddenIndex, setHiddenIndex] = React.useState(null);
  const [shake, setShake] = React.useState(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [box, setBox] = React.useState({ width: 0, height: 0 });
  const [turning, setTurning] = React.useState(null);
  const fence = React.useRef(null);
  const areaRef = React.useRef(null);
  const alive = React.useRef(true);
  const inFlight = React.useRef(null);

  // ── 传输：所有结果都过 revision 栅栏，整体替换投影（§7.5.4 第 3 条） ──────────
  const apply = React.useCallback((result) => {
    if (!alive.current) return false;
    if (result === null || typeof result !== 'object' || result.ok !== true) {
      const error = result !== null && typeof result === 'object' && result.error ? result.error : {};
      if (error.code === 'rpc/unavailable' || error.code === 'session/missing') {
        setOffline(true);
        return false;
      }
      const key = errorKeyOf(error.code);
      setNotice({
        key: key ?? 'status.rpcError',
        params: key === null ? { message: error.message || error.code || 'unknown' } : {},
        tone: 'error',
      });
      return false;
    }
    setOffline(false);
    const decision = acceptProjection({ revision: fence.current }, result.projection);
    if (!decision.accepted) return false;
    fence.current = result.projection.revision;
    setProjection(result.projection);
    setSelected(null);
    return true;
  }, []);

  const fetchState = React.useCallback(
    async (signal) => {
      if (sessionId === null) return;
      const result = await rpc.state(signal);
      if (signal !== undefined && signal.aborted) return;
      apply(result);
    },
    [apply, rpc, sessionId],
  );

  // 进入面板 / 会话切换 / 重新可见 → 立即拉一次；不可见时零请求。
  React.useEffect(() => {
    if (sessionId === null || !visible) return undefined;
    const controller = new AbortController();
    inFlight.current = controller;
    void fetchState(controller.signal);
    return () => controller.abort();
  }, [fetchState, sessionId, visible]);

  // tab.signal 的 abort = 该 tab 的 occurrence 已销毁（关闭/折叠/卸载，§7.5.3）。
  React.useEffect(() => {
    const signal = props.signal;
    if (signal === null || signal === undefined || typeof signal.addEventListener !== 'function') {
      return undefined;
    }
    const onAbort = () => {
      if (inFlight.current !== null) inFlight.current.abort();
    };
    signal.addEventListener('abort', onAbort);
    return () => signal.removeEventListener('abort', onAbort);
  }, [props.signal]);

  React.useEffect(
    () => () => {
      alive.current = false;
      if (inFlight.current !== null) inFlight.current.abort();
    },
    [],
  );

  const model = React.useMemo(() => {
    const hostTargets = hasHostTargets(projection);
    const fen = projection !== null && typeof projection.fen === 'string' ? projection.fen : '';
    const fallback =
      !hostTargets && selected !== null && fen !== '' && projection !== null
        ? localTargets(fen, selected)
        : undefined;
    return deriveModel(projection, {
      selected,
      cursor,
      hints,
      reviewPly,
      orientation: ORIENTATION,
      fallbackTargets: fallback,
    });
  }, [projection, selected, cursor, hints, reviewPly]);

  const polling = shouldPoll(projection, visible);

  // 只在 pending === 'ai-thinking' 且可见时轮询：800 ms 起、×1.35、2 s 封顶、30 s 收工。
  React.useEffect(() => {
    if (!polling || sessionId === null) return undefined;
    const loop = createPollLoop({
      schedule: xq.schedule,
      now: () => Date.now(),
      onTick: () => {
        void fetchState();
      },
      onExpired: () => {
        setNotice({ key: 'status.pollTimeout', params: {}, tone: 'warn' });
      },
    });
    loop.start();
    return () => loop.dispose();
  }, [polling, fetchState, sessionId, xq]);

  // AI 已用时（1 s 一跳，只在可见且思考中）。
  React.useEffect(() => {
    if (!polling) {
      setElapsed(0);
      return undefined;
    }
    const started = Date.now();
    const handle = window.setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => window.clearInterval(handle);
  }, [polling]);

  // 面板尺寸 → 几何（窄到 260 px 以下隐藏着法列表，§7.3）。
  React.useEffect(() => {
    const node = areaRef.current;
    if (node === null || node === undefined) return undefined;
    // 用**内容盒**而不是 clientWidth：棋盘区有内边距，按 clientWidth 算会让棋盘比可用
    // 空间宽出两个 padding，右边被裁掉一点点（不出现滚动条，但也不叫「整体缩放」）。
    const measure = (box) => {
      const width = box === undefined ? node.clientWidth : box.width;
      const height = box === undefined ? node.clientHeight : box.height;
      setBox({ width: width ?? 0, height: height ?? 0 });
    };
    if (typeof ResizeObserver === 'undefined') {
      measure();
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      measure(entries.length > 0 ? entries[0].contentRect : undefined);
    });
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);

  // 本地即时消息自动消失。
  React.useEffect(() => {
    if (notice === null) return undefined;
    const handle = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(handle);
  }, [notice]);

  // 提示着法 5 s 后消失（落子后也立刻消失）。
  React.useEffect(() => {
    if (hints === null) return undefined;
    const handle = window.setTimeout(() => setHints(null), HINT_MS);
    return () => window.clearTimeout(handle);
  }, [hints]);

  // 动画残影与抖动都是短命状态，到点就清。
  React.useEffect(() => {
    if (!visible) {
      setGhosts([]);
      setUndoGhost(null);
      setHiddenIndex(null);
      setShake(null);
      return undefined;
    }
    if (ghosts.length === 0 && undoGhost === null && hiddenIndex === null) return undefined;
    const handle = window.setTimeout(() => {
      setGhosts([]);
      setUndoGhost(null);
      setHiddenIndex(null);
    }, GHOST_MS);
    return () => window.clearTimeout(handle);
  }, [ghosts, undoGhost, hiddenIndex]);

  React.useEffect(() => {
    if (shake === null) return undefined;
    const handle = window.setTimeout(() => setShake(null), SHAKE_MS);
    return () => window.clearTimeout(handle);
  }, [shake]);

  // 投影增量 → 吃子/悔棋残影（纯表现，不影响任何判定）。
  const previous = React.useRef(null);
  React.useEffect(() => {
    const now = {
      revision: model.revision,
      length: model.history.length,
      board: model.board,
      last: model.lastMove,
    };
    const before = previous.current;
    previous.current = now;
    if (before === null || before.revision === now.revision) return;
    if (now.length > before.length && now.last !== null) {
      const captured = before.board[now.last.to];
      if (captured !== '' && captured !== undefined) {
        setGhosts([{ index: now.last.to, piece: captured }]);
      }
      setHints(null);
      return;
    }
    if (now.length < before.length && before.last !== null) {
      const piece = before.board[before.last.to];
      if (piece !== '' && piece !== undefined) {
        setUndoGhost({ from: before.last.from, to: before.last.to, piece });
        setHiddenIndex(before.last.from);
      }
    }
  }, [model.revision, model.history.length, model.board, model.lastMove]);

  // ── 交互意图 ─────────────────────────────────────────────────────────────
  const reject = React.useCallback(
    (code, from, to) => {
      if (Number.isInteger(from)) setShake({ index: from, nonce: Date.now() });
      const key = errorKeyOf(code);
      // 引擎的人话原因只用在「这一步不合走子规则」上（「马腿被蹩」这类信息 UI 侧没有）。
      // 而「不是你的回合」「本局已结束」「复盘只读」是**局面状态**，不是着法问题：
      // 那几句必须走本地化文案，否则英文界面下会蹦出中文。
      if (code === 'move.invalid' && Number.isInteger(from) && Number.isInteger(to)) {
        const pre = precheckMove(model.fen, from, to);
        if (pre !== null && pre.legal === false && typeof pre.reason === 'string' && pre.reason !== '') {
          setNotice({ key: 'status.invalid', params: { reason: pre.reason }, tone: 'warn' });
          return;
        }
      }
      if (key !== null) setNotice({ key, params: {}, tone: 'warn' });
      else setNotice({ key: 'error.unknown', params: {}, tone: 'warn' });
    },
    [model.fen],
  );

  const submitMove = React.useCallback(
    (from, to) => {
      if (sessionId === null) return;
      setSelected(null);
      setHints(null);
      setBusy(true);
      const controller = new AbortController();
      inFlight.current = controller;
      void rpc.move(from, to, iccsOf(from, to), controller.signal).then((result) => {
        if (!alive.current) return;
        apply(result);
        setBusy(false);
      });
    },
    [apply, rpc, sessionId],
  );

  const onIntent = React.useCallback(
    (from, to) => {
      if (Number.isInteger(to)) setCursor(to);
      const decision = resolveIntent(model, from, to);
      switch (decision.kind) {
        case 'select':
          setSelected(decision.index);
          setNotice(null);
          break;
        case 'deselect':
          setSelected(null);
          break;
        case 'inspect':
          setSelected(decision.index);
          setNotice({ key: 'status.notYourTurn', params: {}, tone: 'warn' });
          break;
        case 'reject':
          reject(decision.code, decision.from, decision.to);
          break;
        case 'move':
          submitMove(decision.from, decision.to);
          break;
        default:
          break;
      }
    },
    [model, reject, submitMove],
  );

  const onArrow = React.useCallback(
    (dRow, dCol) => {
      setCursor((current) => {
        const base =
          current !== null && current !== undefined
            ? current
            : model.hero === 'b'
              ? model.board.lastIndexOf('k')
              : model.board.indexOf('K');
        const from = base < 0 ? 76 : base;
        const next = stepCursor(from, dRow, dCol, ORIENTATION);
        return next === null ? from : next;
      });
    },
    [model.board, model.hero],
  );

  // ── 工具条动作 ───────────────────────────────────────────────────────────
  const call = React.useCallback(
    (method, onOk, onFail) => {
      if (sessionId === null) return;
      setBusy(true);
      const controller = new AbortController();
      inFlight.current = controller;
      void method(controller.signal).then((result) => {
        if (!alive.current) return;
        const accepted = apply(result);
        setBusy(false);
        if (accepted) {
          if (typeof onOk === 'function') onOk();
        } else if (typeof onFail === 'function') {
          onFail();
        }
      });
    },
    [apply, sessionId],
  );

  const doNew = React.useCallback(() => {
    call(
      (signal) => rpc.newGame(signal),
      () => {
        setHints(null);
        setReviewPly(null);
        setTurning(null);
        setNotice({ key: 'status.newGame', params: {}, tone: 'info' });
      },
    );
  }, [call, rpc]);

  const doResign = React.useCallback(() => {
    call((signal) => rpc.resign(signal));
  }, [call, rpc]);

  const doUndo = React.useCallback(() => {
    call((signal) => rpc.undo(2, signal));
  }, [call, rpc]);

  const doFallback = React.useCallback(() => {
    setNotice({ key: 'status.fallbackStarted', params: {}, tone: 'info' });
    call((signal) => rpc.fallback(signal));
  }, [call, rpc]);

  const doHint = React.useCallback(() => {
    if (sessionId === null) return;
    setBusy(true);
    const controller = new AbortController();
    inFlight.current = controller;
    void rpc.hint(3, controller.signal).then((result) => {
      if (!alive.current) return;
      setBusy(false);
      if (result.ok !== true) {
        const key = errorKeyOf(result.error?.code);
        setNotice({
          key: key ?? 'status.rpcError',
          params: key === null ? { message: result.error?.message ?? '' } : {},
          tone: 'error',
        });
        return;
      }
      const list = normalizeHints(result.value);
      setHints(list);
      setNotice({ key: 'status.hintShown', params: { count: list.length }, tone: 'info' });
    });
  }, [rpc, sessionId]);

  const doCopy = React.useCallback(() => {
    const text = recordText(
      projection === null ? {} : { ...projection, initialFen: projection.initialFen ?? initialFen() },
    );
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      setNotice({ key: 'status.copyFailed', params: {}, tone: 'error' });
      return;
    }
    void clipboard.writeText(text).then(
      () => setNotice({ key: 'status.copied', params: {}, tone: 'success' }),
      () => setNotice({ key: 'status.copyFailed', params: {}, tone: 'error' }),
    );
  }, [projection]);

  const enterReview = React.useCallback(
    (ply) => {
      setReviewPly(ply);
      setSelected(null);
      setHints(null);
      if (sessionId === null) return;
      // `review` 是可选端点：拿不到就只有本地重放，不报错。
      void rpc.review().then((result) => {
        if (!alive.current || result.ok !== true) return;
        const value = result.value;
        if (value !== null && typeof value === 'object' && Array.isArray(value.turningPoints)) {
          setTurning(value.turningPoints.filter((n) => Number.isInteger(n)));
        }
      });
    },
    [rpc, sessionId],
  );

  const onKeyDown = React.useCallback(
    (event) => {
      if (reviewPly === null) return;
      const total = model.history.length;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setReviewPly(Math.max(0, reviewPly - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (reviewPly >= total) return;
        const next = reviewPly + 1;
        if (next >= total) {
          setReviewPly(null);
          setNotice({ key: 'status.live', params: {}, tone: 'info' });
        } else {
          setReviewPly(next);
        }
      }
    },
    [model.history.length, reviewPly],
  );

  // ── 渲染数据 ─────────────────────────────────────────────────────────────
  const geometry = React.useMemo(() => computeGeometry(box.width, box.height), [box.width, box.height]);
  // 复盘靠客户端重放：投影不带 initialFen（宿主只从标准局面开局），所以先完整重放一遍，
  // 用它和宿主下发的棋盘对齐——不一致就说明起点不是标准局面，此时关掉复盘而不是显示错局面。
  const history = model.history;
  const fullReplay = React.useMemo(
    () => (history.length === 0 ? null : replayToPly(initialFen(), history, history.length)),
    [history],
  );
  const replayTrusted =
    history.length === 0
      ? true
      : fullReplay !== null && sameBoard(fullReplay.board, model.board);
  const replay =
    reviewPly !== null && replayTrusted
      ? reviewPly === history.length
        ? fullReplay
        : replayToPly(initialFen(), history, reviewPly)
      : null;
  const viewBoard = replay !== null ? replay.board : model.board;
  const viewLast = replay !== null ? replay.lastMove : model.lastMove;
  const emptyBoard = projection === null && offline ? initialBoard() : null;
  const boardToRender = emptyBoard !== null ? emptyBoard : viewBoard;
  const checkedKing =
    model.checkSide === null || replay !== null ? null : kingIndex(boardToRender, model.checkSide);

  const cellLabel = React.useCallback(
    (index, piece) => {
      const parts = cellLabelKeys(index, piece);
      if (parts === null) return '';
      const params = {};
      for (const [name, key] of Object.entries(parts.params)) params[name] = t(key);
      return t(parts.template, params);
    },
    [t],
  );

  const announcement = React.useMemo(() => {
    if (model.history.length === 0) return '';
    const last = model.history[model.history.length - 1];
    const side = model.history.length % 2 === 1 ? 'red' : 'black';
    const record = last !== null && typeof last === 'object' ? last : {};
    let suffix = 'status.suffix.none';
    if (record.mate === true) suffix = 'status.suffix.checkmate';
    else if (record.check === true) suffix = 'status.suffix.check';
    else if (model.checkSide !== null) {
      suffix = model.phase === 'finished' ? 'status.suffix.checkmate' : 'status.suffix.check';
    }
    return t(`status.moved.${side}`, { zh: record.zh ?? '', suffix: t(suffix) });
  }, [model.history, model.checkSide, model.phase, t]);

  const line = statusLine(projection, {
    offline,
    elapsedMs: elapsed,
    notice,
  });

  const rows = React.useMemo(() => moveRows(model.history), [model.history]);
  const hintId = 'xq-cursor-hint';

  if (sessionId === null) {
    return el(
      'div',
      { className: mode === 'main' ? 'xq-root xq-inMain' : 'xq-root' },
      el(StyleTag, null),
      el(
        'div',
        { className: 'xq-empty' },
        el(BoardGlyph, { size: 28 }),
        el('span', null, t('status.rpcUnavailable')),
      ),
    );
  }

  return el(
    'div',
    { className: mode === 'main' ? 'xq-root xq-inMain' : 'xq-root', onKeyDown },
    el(StyleTag, null),
    el(PanelHeader, { t, model, projection }),
    el('div', { className: 'xq-boardArea', ref: areaRef }, [
      el(XiangqiBoard, {
        key: 'board',
        u: geometry.u,
        orientation: ORIENTATION,
        board: boardToRender,
        selected: model.selected,
        legalTargets: model.legalTargets,
        lastMove: viewLast,
        hints: model.hints,
        checkSide: model.checkSide,
        checkedKingIndex: checkedKing,
        cursor: model.cursor,
        ghosts,
        undoGhost,
        hiddenIndex,
        shakeIndex: shake === null ? null : shake.index,
        revision: model.revision,
        animateDrop: visible && replay === null && undoGhost === null,
        interactive: model.interactive && replay === null,
        keyMode: replay === null ? 'cursor' : 'review',
        label: t('board.label'),
        hintId,
        cellLabel,
        onIntent,
        onArrow,
        onReview: (delta) => {
          const total = model.history.length;
          const next = Math.max(0, Math.min(total, (reviewPly ?? total) + delta));
          setReviewPly(next);
        },
        onEscape: () => setSelected(null),
      }),
      el('p', { className: 'xq-sr', id: hintId, key: 'hint' }, t('board.cursorHint')),
    ]),
    el(StatusStrip, { t, line, announcement }),
    el(HintRow, { t, hints: model.hints }),
    confirmKind === null
      ? null
      : el(ConfirmBar, {
          t,
          questionKey: confirmKind === 'new' ? 'confirm.new' : 'confirm.resign',
          onConfirm: () => {
            const kind = confirmKind;
            setConfirmKind(null);
            if (kind === 'new') doNew();
            else doResign();
          },
          onCancel: () => setConfirmKind(null),
        }),
    el(Toolbar, {
      t,
      model,
      busy,
      offline,
      // 左栏图标只能选主面板、不能开右栏 tab（T15），所以两组入口各自只在对面出现。
      hasSidebar: mode === 'main' && xq.hasSidebar === true,
      hasMain: mode === 'tab' && xq.hasMain === true,
      reviewable: replayTrusted,
      onNew: () => {
        if (model.phase === 'playing' && model.history.length > 0) setConfirmKind('new');
        else doNew();
      },
      onUndo: doUndo,
      onHint: doHint,
      onFallback: doFallback,
      onResign: () => setConfirmKind('resign'),
      onCopy: doCopy,
      onReview: () => {
        enterReview(model.history.length);
        setNotice({ key: 'status.reviewing', params: { n: model.history.length }, tone: 'info' });
      },
      onLive: () => {
        setReviewPly(null);
        setNotice({ key: 'status.live', params: {}, tone: 'info' });
      },
      onOpenSidebar: () => xq.openSidebar(),
      onOpenMain: () => xq.openMain(),
    }),
    geometry.showMoveList
      ? el(MoveList, {
          t,
          rows,
          activeIndex: reviewPly,
          turning,
          disabled: rows.length === 0,
          onJump: (ply) => {
            enterReview(ply);
            setNotice({ key: 'status.reviewing', params: { n: ply }, tone: 'info' });
          },
        })
      : null,
  );
}

/**
 * 右栏 tab 的正文组件：槽级注入的 `useTabInfo()` 给 `{ sidebar, panel, tab }`，
 * `sessionId` 由框架平铺注入（§7.1 的 props 契约）。
 * @param props - 框架注入的 hook 集合 + `xq`。
 * @returns 面板元素。
 */
export function XiangqiTabBody(props) {
  const info = props.useTabInfo();
  // 会话工作区：宿主用它决定对局落盘位置，从而与命令/工具两条路径写到同一处。
  const cwd = props.useSessions((state) => {
    const session = state !== null && typeof state === 'object' ? state.byId[props.sessionId] : undefined;
    return session === undefined || session === null ? undefined : session.cwd;
  });
  return el(XiangqiPanel, {
    t: props.t,
    xq: props.xq,
    sessionId: props.sessionId,
    cwd,
    visible: info.tab.visible,
    signal: info.tab.signal,
    mode: 'tab',
  });
}

/**
 * tab 标题座位：只在标题里有意义，正文另注册（§7.1）。
 * @param props - `{ t }`。
 * @returns span 元素。
 */
export function XiangqiTabTitle(props) {
  return el('span', { className: 'xq-headerRow' }, el(BoardGlyph, { size: 14 }), el('span', null, props.t('tab.title')));
}

/**
 * 主面板（root 作用域，拿不到 `sessionId`）。
 *
 * 按 §4.3 的做法用 `useSessions` 反查当前会话；查不到就显示只读空盘 + 提示，
 * 而不是崩掉。头部让位由 `.xq-inMain` 负责（T15）。
 * @param props - `{ t, xq }`。
 * @returns 面板元素。
 */
export function XiangqiMainPanel(props) {
  const sessionId = props.useSessions(selectMainSessionId);
  const cwd = props.useSessions((state) => {
    if (typeof sessionId !== 'string') return undefined;
    const session = state !== null && typeof state === 'object' ? state.byId[sessionId] : undefined;
    return session === undefined || session === null ? undefined : session.cwd;
  });
  return el(XiangqiPanel, {
    t: props.t,
    xq: props.xq,
    sessionId: typeof sessionId === 'string' ? sessionId : null,
    cwd,
    visible: true,
    signal: undefined,
    mode: 'main',
  });
}

/**
 * 左栏图标座位（与 `main` 的 key 配对使用）。
 * @param props - owner props `{ size, active }`（窄栏 18、宽栏 16）。
 * @returns span 元素。
 */
export function XiangqiPanelIcon(props) {
  const size = Number.isFinite(props.size) ? props.size : 16;
  return el(
    'span',
    {
      className: 'xq-panelIcon',
      style: {
        display: 'inline-flex',
        color: props.active === true ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
      },
    },
    el(BoardGlyph, { size }),
  );
}
