/**
 * 棋盘：**渲染层与交互层解耦**（§7.2，FR 差异点 1）。
 *
 * ```
 * XiangqiBoard          ← 只做 <svg> 外壳、几何与 role="grid"
 *   BoardView           ← 纯展示：网格、河界、九宫、炮兵位、棋子、标记、箭头、动画壳
 *   BoardInteraction    ← 交互：命中测试、拖拽、键盘光标；只产出「意图」
 * ```
 *
 * `BoardView` 不接收任何回调、不 import 引擎的规则函数，同样的 props 必然渲染同样的
 * 画面（便于截图比对与主题切换）；`BoardInteraction` 不认识规则，只把
 * `onIntent(from, to)` 报上去，合法性一律由宿主判定（本地引擎副本只补一句人话原因）。
 */

import { idxToCol, idxToRow, pieceNameZh } from '../engine/coords.js';
import { el } from './icons.js';

/** 兵/炮位的「十」字标记（行, 列）。 */
const STAR_POINTS = Object.freeze([
  [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
  [6, 0], [6, 2], [6, 4], [6, 6], [6, 8],
  [2, 1], [2, 7],
  [7, 1], [7, 7],
]);

/** 每块棋盘自己的 marker id（同页面可能同时有两块棋盘：右栏 tab + 主面板）。 */
let boardSeq = 0;

/** 单位 `u` 下的棋盘几何。 */
function geometry(u, orientation) {
  const pad = 0.65 * u;
  const flip = orientation === 'b';
  const xOf = (col) => pad + (flip ? 8 - col : col) * u;
  const yOf = (row) => pad + (flip ? 9 - row : row) * u;
  const point = (index) => ({ x: xOf(idxToCol(index)), y: yOf(idxToRow(index)) });
  return {
    u,
    pad,
    xOf,
    yOf,
    point,
    viewW: u * 9.3,
    viewH: u * 10.3,
  };
}

/** 网格线 + 九宫斜线（河界处断开两条内线）。 */
function gridPath(g) {
  const segs = [];
  for (let row = 0; row < 10; row += 1) {
    segs.push(`M${g.xOf(0)} ${g.yOf(row)}H${g.xOf(8)}`);
  }
  for (let col = 0; col < 9; col += 1) {
    if (col === 0 || col === 8) {
      segs.push(`M${g.xOf(col)} ${g.yOf(0)}V${g.yOf(9)}`);
    } else {
      segs.push(`M${g.xOf(col)} ${g.yOf(0)}V${g.yOf(4)}`);
      segs.push(`M${g.xOf(col)} ${g.yOf(5)}V${g.yOf(9)}`);
    }
  }
  segs.push(`M${g.xOf(3)} ${g.yOf(0)}L${g.xOf(5)} ${g.yOf(2)}`);
  segs.push(`M${g.xOf(5)} ${g.yOf(0)}L${g.xOf(3)} ${g.yOf(2)}`);
  segs.push(`M${g.xOf(3)} ${g.yOf(7)}L${g.xOf(5)} ${g.yOf(9)}`);
  segs.push(`M${g.xOf(5)} ${g.yOf(7)}L${g.xOf(3)} ${g.yOf(9)}`);
  return segs.join(' ');
}

/** 兵/炮位的「十」字（中心留空隙；贴边的列只画靠盘内的一侧）。 */
function starPath(g) {
  const gap = 0.085 * g.u;
  const arm = 0.17 * g.u;
  const segs = [];
  for (const [row, col] of STAR_POINTS) {
    const x = g.xOf(col);
    const y = g.yOf(row);
    if (col > 0) segs.push(`M${x - gap - arm} ${y}H${x - gap}`);
    if (col < 8) segs.push(`M${x + gap} ${y}H${x + gap + arm}`);
    segs.push(`M${x} ${y - gap - arm}V${y - gap}`);
    segs.push(`M${x} ${y + gap}V${y + gap + arm}`);
  }
  return segs.join(' ');
}

/**
 * 一枚棋子（外层 `<g>` 用 transform 属性定位，内层 `<g>` 承担 CSS 动画）。
 *
 * 为什么分两层：CSS `transform` 属性会**覆盖** SVG 的 `transform` 呈现属性，动画写在
 * 外层会把棋子飞回原点。内层承接动画，位移就是相对外层坐标系的，才正确。
 * @param props - `{ index, piece, g, state, label, animClass, dx, dy }`。
 * @returns g 元素。
 */
function Piece(props) {
  const { index, piece, g, state, label } = props;
  const { x, y } = g.point(index);
  const red = piece === piece.toUpperCase();
  const inkClass = red ? 'xq-pieceRed' : 'xq-pieceBlack';
  const style = {};
  if (props.dx !== 0 || props.dy !== 0) {
    style['--xq-dx'] = `${props.dx}px`;
    style['--xq-dy'] = `${props.dy}px`;
  }
  const inner = [];
  inner.push(
    el('circle', { key: 'face', className: 'xq-pieceFace', r: 0.43 * g.u, strokeWidth: 0.022 * g.u }),
  );
  inner.push(
    el('circle', {
      key: 'ring',
      className: `xq-pieceRing ${inkClass}`,
      r: 0.365 * g.u,
      strokeWidth: 0.03 * g.u,
    }),
  );
  inner.push(
    el(
      'text',
      {
        key: 'ink',
        className: `xq-pieceInk ${inkClass}`,
        x: 0,
        y: 0,
        fontSize: 0.52 * g.u,
      },
      pieceNameZh(piece),
    ),
  );
  if (state.selected) {
    inner.push(
      el('circle', { key: 'sel', className: 'xq-selectRing', r: 0.475 * g.u, strokeWidth: 0.055 * g.u }),
    );
  }
  if (state.checked) {
    inner.push(
      el('circle', { key: 'chk', className: 'xq-checkRing', r: 0.5 * g.u, strokeWidth: 0.06 * g.u }),
    );
  }
  const innerClass = [props.animClass, props.shaking ? 'xq-shake' : ''].filter(Boolean).join(' ');
  return el(
    'g',
    { transform: `translate(${x} ${y})`, style, key: props.reactKey },
    el('g', { className: innerClass === '' ? undefined : innerClass }, el('title', null, label), ...inner),
  );
}

/**
 * 纯展示层。
 *
 * @param props - 见 `XiangqiBoard` 的说明；这一层**不接收任何回调**。
 * @returns svg 子元素数组。
 */
export function BoardView(props) {
  const g = geometry(props.u, props.orientation);
  const { board } = props;
  const selected = props.selected;
  const legal = Array.isArray(props.legalTargets) ? props.legalTargets : [];
  const lastMove = props.lastMove;
  const hints = Array.isArray(props.hints) ? props.hints : [];
  const hidden = props.hiddenIndex;
  const hover = props.hoverIndex;
  const cursor = props.cursor;

  const nodes = [];
  nodes.push(
    el('rect', {
      key: 'face',
      className: 'xq-boardFace',
      x: 0,
      y: 0,
      width: g.viewW,
      height: g.viewH,
      rx: 0.45 * g.u,
      strokeWidth: 0.04 * g.u,
    }),
  );
  nodes.push(
    el('rect', {
      key: 'river',
      className: 'xq-riverBand',
      x: g.xOf(0),
      y: g.yOf(4),
      width: 8 * g.u,
      height: g.u,
    }),
  );
  nodes.push(
    el('path', {
      key: 'grid',
      className: 'xq-grid',
      d: gridPath(g),
      strokeWidth: 0.022 * g.u,
      fill: 'none',
    }),
  );
  nodes.push(
    el('path', {
      key: 'border',
      className: 'xq-border',
      d: `M${g.xOf(0)} ${g.yOf(0)}H${g.xOf(8)}V${g.yOf(9)}H${g.xOf(0)}Z`,
      strokeWidth: 0.05 * g.u,
    }),
  );
  nodes.push(
    el('path', {
      key: 'stars',
      className: 'xq-grid',
      d: starPath(g),
      strokeWidth: 0.022 * g.u,
      fill: 'none',
    }),
  );
  const riverY = (g.yOf(4) + g.yOf(5)) / 2;
  nodes.push(
    el(
      'text',
      {
        key: 'riverText',
        className: 'xq-riverText',
        x: g.xOf(2),
        y: riverY,
        fontSize: 0.5 * g.u,
        textAnchor: 'middle',
        dominantBaseline: 'central',
      },
      '楚河',
    ),
  );
  nodes.push(
    el(
      'text',
      {
        key: 'riverText2',
        className: 'xq-riverText',
        x: g.xOf(6),
        y: riverY,
        fontSize: 0.5 * g.u,
        textAnchor: 'middle',
        dominantBaseline: 'central',
      },
      '汉界',
    ),
  );

  // 上一步痕迹（起止两点 + 连线）：垫在棋子下面，并且 2 s 后淡到 0.45 常驻。
  if (lastMove !== null && lastMove !== undefined) {
    const a = g.point(lastMove.from);
    const b = g.point(lastMove.to);
    nodes.push(
      el(
        'g',
        { key: 'last', className: 'xq-lastMarker' },
        el('line', { className: 'xq-lastLine', x1: a.x, y1: a.y, x2: b.x, y2: b.y, strokeWidth: 0.14 * g.u }),
        el('circle', { className: 'xq-lastDot', cx: a.x, cy: a.y, r: 0.44 * g.u, opacity: 0.45 }),
        el('circle', { className: 'xq-lastDot', cx: b.x, cy: b.y, r: 0.44 * g.u, opacity: 0.45 }),
      ),
    );
  }

  // 可走点：空点画实心小圆，可吃子画空心环（环画在棋子之上）。
  const dots = [];
  const rings = [];
  for (const index of legal) {
    const { x, y } = g.point(index);
    if (board[index] === '') {
      dots.push(el('circle', { key: `d${index}`, className: 'xq-targetDot', cx: x, cy: y, r: 0.13 * g.u }));
    } else {
      rings.push(
        el('circle', {
          key: `r${index}`,
          className: 'xq-targetRing',
          cx: x,
          cy: y,
          r: 0.47 * g.u,
          strokeWidth: 0.055 * g.u,
        }),
      );
    }
  }
  nodes.push(el('g', { key: 'dots' }, ...dots));

  // 拖拽悬停格：一层浅浅的底色，不抢棋子的可读性。
  if (hover !== null && hover !== undefined && hover !== selected) {
    const { x, y } = g.point(hover);
    nodes.push(
      el('rect', {
        key: 'hover',
        className: 'xq-hoverCell',
        x: x - 0.5 * g.u,
        y: y - 0.5 * g.u,
        width: g.u,
        height: g.u,
        rx: 0.12 * g.u,
      }),
    );
  }

  // 棋子（含落子/悔棋动画与抖动）。
  const checkedKing = props.checkedKingIndex;
  for (let index = 0; index < 90; index += 1) {
    const piece = board[index];
    if (piece === '' || piece === undefined || piece === null) continue;
    if (hidden === index) continue;
    const isDropTo = lastMove !== null && lastMove !== undefined && lastMove.to === index && props.animateDrop === true;
    const from = isDropTo ? g.point(lastMove.from) : null;
    const to = g.point(index);
    nodes.push(
      el(Piece, {
        key: isDropTo ? `p${index}:drop:${props.revision}` : `p${index}`,
        index,
        piece,
        g,
        label: props.cellLabel(index, piece),
        state: { selected: selected === index, checked: checkedKing === index },
        animClass: isDropTo ? 'xq-drop' : undefined,
        shaking: props.shakeIndex === index,
        dx: from === null ? 0 : from.x - to.x,
        dy: from === null ? 0 : from.y - to.y,
      }),
    );
  }

  nodes.push(el('g', { key: 'rings' }, ...rings));

  // 吃子残影：被吃的子 120 ms 缩小淡出。
  const ghosts = Array.isArray(props.ghosts) ? props.ghosts : [];
  for (let i = 0; i < ghosts.length; i += 1) {
    const ghost = ghosts[i];
    const { x, y } = g.point(ghost.index);
    nodes.push(
      el(
        'g',
        { key: `ghost${i}`, transform: `translate(${x} ${y})`, pointerEvents: 'none' },
        el(
          'g',
          { className: 'xq-captureGhost' },
          el('circle', { className: 'xq-pieceFace', r: 0.43 * g.u, strokeWidth: 0.022 * g.u }),
          el('text', {
            className: `xq-pieceInk ${ghost.piece === ghost.piece.toUpperCase() ? 'xq-pieceRed' : 'xq-pieceBlack'}`,
            x: 0,
            y: 0,
            fontSize: 0.52 * g.u,
            children: pieceNameZh(ghost.piece),
          }),
        ),
      ),
    );
  }

  // 悔棋残影：从落点反向飞回起点 160 ms。
  if (props.undoGhost !== null && props.undoGhost !== undefined) {
    const ghost = props.undoGhost;
    const a = g.point(ghost.from);
    const b = g.point(ghost.to);
    nodes.push(
      el(
        'g',
        {
          key: 'undoGhost',
          transform: `translate(${a.x} ${a.y})`,
          style: { '--xq-dx': `${b.x - a.x}px`, '--xq-dy': `${b.y - a.y}px` },
          pointerEvents: 'none',
        },
        el(
          'g',
          { className: 'xq-undoGhost' },
          el('circle', { className: 'xq-pieceFace', r: 0.43 * g.u, strokeWidth: 0.022 * g.u }),
          el('text', {
            className: `xq-pieceInk ${ghost.piece === ghost.piece.toUpperCase() ? 'xq-pieceRed' : 'xq-pieceBlack'}`,
            x: 0,
            y: 0,
            fontSize: 0.52 * g.u,
            children: pieceNameZh(ghost.piece),
          }),
        ),
      ),
    );
  }

  // 提示着法箭头：3 条不同透明度。
  const hintNodes = [];
  const arrowId = props.arrowId;
  for (const hint of hints) {
    const a = g.point(hint.from);
    const b = g.point(hint.to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const trim = 0.52 * g.u;
    const sx = a.x + (dx / len) * trim;
    const sy = a.y + (dy / len) * trim;
    const ex = b.x - (dx / len) * trim;
    const ey = b.y - (dy / len) * trim;
    hintNodes.push(
      el('line', {
        key: `h${hint.rank}`,
        className: 'xq-hintLine',
        x1: sx,
        y1: sy,
        x2: ex,
        y2: ey,
        strokeWidth: 0.11 * g.u,
        opacity: [0.9, 0.62, 0.38][hint.rank] ?? 0.4,
        markerEnd: `url(#${arrowId})`,
      }),
    );
  }
  if (hintNodes.length > 0) nodes.push(el('g', { key: 'hints' }, ...hintNodes));

  // 键盘光标。
  if (cursor !== null && cursor !== undefined) {
    const { x, y } = g.point(cursor);
    nodes.push(
      el('rect', {
        key: 'cursor',
        className: 'xq-cursorBox',
        x: x - 0.4 * g.u,
        y: y - 0.4 * g.u,
        width: 0.8 * g.u,
        height: 0.8 * g.u,
        rx: 0.1 * g.u,
        strokeWidth: 0.05 * g.u,
      }),
    );
  }

  return nodes;
}

/**
 * 交互层：90 个透明命中格 + 指针手势 + 键盘。
 *
 * 只产出意图：`onIntent(from, to)` 与 `onCursor(index)`；不认识规则，也不改任何状态。
 * @param props - `{ g, board, selected, label, cellLabel, interactive, keyMode, onIntent, onCursor, onReview, onHover }`。
 * @returns g 元素。
 */
export function BoardInteraction(props) {
  const g = props.g;
  const cells = [];
  for (let index = 0; index < 90; index += 1) {
    const { x, y } = g.point(index);
    cells.push(
      el('rect', {
        key: index,
        id: `${props.idPrefix}-cell-${index}`,
        className: 'xq-hit',
        role: 'gridcell',
        'aria-label': props.cellLabel(index, props.board[index]),
        'aria-selected': props.selected === index ? 'true' : undefined,
        x: x - 0.5 * g.u,
        y: y - 0.5 * g.u,
        width: g.u,
        height: g.u,
      }),
    );
  }
  return el(
    'g',
    {
      onPointerDown: props.onPointerDown,
      onPointerMove: props.onPointerMove,
      onPointerUp: props.onPointerUp,
      onPointerCancel: props.onPointerUp,
      style: { touchAction: 'none', cursor: props.interactive ? 'pointer' : 'default' },
    },
    ...cells,
  );
}

/**
 * 棋盘的对外组件：外壳 + 语义 + 两层组装。
 *
 * 键盘走子（§7.4）：Tab 进入棋盘 → 方向键移动光标 → Enter 选中/落子 → Esc 取消。
 * 复盘模式下方向键改为前后翻手（左右键），由 `keyMode` 切换。
 *
 * @param props - `model`/`board`/`lastMove`/`u`/`orientation`/`label`/`cellLabel`/
 *   `ghosts`/`undoGhost`/`hiddenIndex`/`shakeIndex`/`revision`/`animateDrop`/
 *   `selected`/`legalTargets`/`hints`/`cursor`/`checkedKingIndex`/`interactive`/
 *   `keyMode`/`onIntent`/`onCursor`/`onReview`。
 * @returns svg 元素。
 */
export function XiangqiBoard(props) {
  const g = geometry(props.u, props.orientation);
  const instanceRef = React.useRef(null);
  if (instanceRef.current === null) {
    boardSeq += 1;
    instanceRef.current = {
      arrowId: `xq-arrow-${boardSeq}`,
      idPrefix: `xq-board-${boardSeq}`,
    };
  }
  const { arrowId, idPrefix } = instanceRef.current;
  const gesture = React.useRef(null);
  const [hover, setHover] = React.useState(null);

  const pointToIndex = React.useCallback(
    (event) => {
      const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const scaleX = g.viewW / rect.width;
      const scaleY = g.viewH / rect.height;
      const vx = (event.clientX - rect.left) * scaleX;
      const vy = (event.clientY - rect.top) * scaleY;
      const flip = props.orientation === 'b';
      const rawCol = Math.round((vx - g.pad) / g.u);
      const rawRow = Math.round((vy - g.pad) / g.u);
      const col = flip ? 8 - rawCol : rawCol;
      const row = flip ? 9 - rawRow : rawRow;
      if (row < 0 || row > 9 || col < 0 || col > 8) return null;
      // 只接受落在格子半径内的点，避免把棋盘外的空白当成最近格。
      const cx = g.xOf(rawCol);
      const cy = g.yOf(rawRow);
      if (Math.abs(vx - cx) > 0.5 * g.u || Math.abs(vy - cy) > 0.5 * g.u) return null;
      return row * 9 + col;
    },
    [g, props.orientation],
  );

  const onPointerDown = React.useCallback(
    (event) => {
      // 注意：这里**不**按 interactive 提前返回。§7.4 要求「非我方回合：棋盘进入只读，
      // 点击仅高亮该子可走点（教学性提示）」——所以点击必须照常产出意图，由承载层决定
      // 是落子还是只高亮；interactive 只约束**拖拽**这种真正的走子手势。
      if (event.button !== undefined && event.button !== 0) return;
      const index = pointToIndex(event);
      if (index === null) return;
      gesture.current = { down: index, moved: false, x: event.clientX, y: event.clientY };
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 某些嵌入环境不支持捕获：退化为普通点击，不影响走子 */
        }
      }
      props.onIntent(props.selected, index);
    },
    [pointToIndex, props],
  );

  const onPointerMove = React.useCallback(
    (event) => {
      const active = gesture.current;
      if (active === null || props.interactive !== true) return;
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (!active.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      active.moved = true;
      const index = pointToIndex(event);
      if (index !== hover) setHover(index);
    },
    [hover, pointToIndex, props.interactive],
  );

  const onPointerUp = React.useCallback(
    (event) => {
      const active = gesture.current;
      gesture.current = null;
      setHover(null);
      if (active === null) return;
      // 拖拽落子只在可交互时生效；只读时松手什么都不做（点击已在 pointerdown 里处理过）。
      if (props.interactive !== true) return;
      const index = pointToIndex(event);
      if (active.moved && index !== null && index !== active.down) {
        props.onIntent(active.down, index);
      }
    },
    [pointToIndex, props],
  );

  const onKeyDown = React.useCallback(
    (event) => {
      const key = event.key;
      if (props.keyMode === 'review') {
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          // 复盘时左右键翻手：在这里消化掉，别再冒泡给面板根节点重复翻一次。
          event.preventDefault();
          event.stopPropagation();
          props.onReview(key === 'ArrowLeft' ? -1 : 1);
        }
        return;
      }
      const arrows = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      if (Object.prototype.hasOwnProperty.call(arrows, key)) {
        event.preventDefault();
        const delta = arrows[key];
        props.onArrow(delta[0], delta[1]);
        return;
      }
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        if (props.cursor !== null && props.cursor !== undefined) {
          props.onIntent(props.selected, props.cursor);
        }
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        props.onEscape();
      }
    },
    [props],
  );

  return el(
    'svg',
    {
      className: 'xq-board',
      width: g.viewW,
      height: g.viewH,
      viewBox: `0 0 ${g.viewW} ${g.viewH}`,
      role: 'grid',
      'aria-label': props.label,
      'aria-activedescendant':
        props.cursor === null || props.cursor === undefined ? undefined : `${idPrefix}-cell-${props.cursor}`,
      'aria-describedby': props.hintId,
      tabIndex: 0,
      onKeyDown,
    },
    el(
      'defs',
      null,
      el(
        'marker',
        {
          id: arrowId,
          viewBox: '0 0 10 10',
          refX: 8,
          refY: 5,
          markerWidth: 5,
          markerHeight: 5,
          orient: 'auto-start-reverse',
        },
        el('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'var(--dsw-alias-state-business-primary)' }),
      ),
    ),
    el(BoardView, { ...props, u: props.u, hoverIndex: hover, arrowId }),
    el(BoardInteraction, {
      g,
      board: props.board,
      selected: props.selected,
      interactive: props.interactive,
      cellLabel: props.cellLabel,
      idPrefix,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    }),
  );
}
