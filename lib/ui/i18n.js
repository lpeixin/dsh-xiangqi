/**
 * 浏览器半的文案字典（命名空间 `xiangqi`，§7.6）。
 *
 * 三条纪律：
 *  1. key 是**扁平字符串**（点分只是惯例）；`{name}` 做插值；
 *  2. `zh` 是键集真相，`en` 必须与它逐键对齐——`test/client/i18n.test.js` 断言两者
 *     `Object.keys().sort()` 相等，漏键在这里就会红；
 *  3. 不翻译的东西（盘上汉字、楚河汉界、中文记谱）**不进字典**——它们是棋本身，
 *     不是 UI 文案；英文界面下用 `board.piece.*` 给出英文棋子名供 tooltip 与读屏使用。
 *
 * **凡是需要「红方/黑方」这类侧名的句子，都拆成 `.red` / `.black` 两个键**，而不是在
 * 模板里插 `{side}`：纯函数层（`model.js`）拿不到 `t`，拼接本地化词会立刻退化成
 * 「red被将军」。拆键让纯函数只需选后缀。
 *
 * 字典在 `apply(ctx)` 里用 `ctx.effect(() => ctx.locale.register(NS, { zh, en }))` 注册；
 * 组件只有在该槽的 register options 里声明 `locale: 'xiangqi'` 才会拿到 `t`。
 */

/** locale 命名空间。注册与 `locale: NS` 必须用同一个常量。 */
export const LOCALE_NS = 'xiangqi';

/** 棋子字符顺序（与引擎 FEN 字符一致）。 */
const PIECE_CHARS = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];

const PIECE_ZH_RED = ['帅', '仕', '相', '马', '车', '炮', '兵'];
const PIECE_ZH_BLACK = ['将', '士', '象', '马', '车', '炮', '卒'];
const PIECE_EN = ['General', 'Advisor', 'Elephant', 'Horse', 'Chariot', 'Cannon', 'Soldier'];

/** 己方视角的纵线名（下标 = 从己方底线起的层数）。 */
const RANK_ZH = ['底线', '次底线', '宫顶线', '兵行线', '河沿', '河沿', '卒林线', '宫顶线', '次底线', '底线'];
const RANK_EN = [
  'own baseline',
  'second rank',
  'palace top',
  'pawn rank',
  'river bank',
  'river bank',
  'enemy pawn rank',
  'palace top',
  'second rank',
  'own baseline',
];

const FILE_DIGIT_ZH = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 生成棋子名、文件号、纵线名三组键。
 *
 * 用生成器而不是把 100 多行手写进字典：键集对称由构造保证，人不会漏写英文。
 * @returns {{ zh: Record<string,string>, en: Record<string,string> }}
 */
function generatedLabels() {
  const zhLabels = {};
  const enLabels = {};
  for (let i = 0; i < PIECE_CHARS.length; i += 1) {
    const ch = PIECE_CHARS[i];
    zhLabels[`board.piece.r.${ch}`] = PIECE_ZH_RED[i];
    zhLabels[`board.piece.b.${ch}`] = PIECE_ZH_BLACK[i];
    enLabels[`board.piece.r.${ch}`] = PIECE_EN[i];
    enLabels[`board.piece.b.${ch}`] = PIECE_EN[i];
  }
  for (let n = 1; n <= 9; n += 1) {
    zhLabels[`board.file.${n}`] = FILE_DIGIT_ZH[n - 1];
    enLabels[`board.file.${n}`] = String(n);
  }
  for (let r = 0; r < 10; r += 1) {
    zhLabels[`board.rank.${r}`] = RANK_ZH[r];
    enLabels[`board.rank.${r}`] = RANK_EN[r];
  }
  return { zh: zhLabels, en: enLabels };
}

const GENERATED = generatedLabels();

/** 简体中文字典（键集真相）。 */
export const zh = {
  'tab.title': '象棋',
  'guide.title': '象棋对弈',
  'guide.description': '与当前会话的模型下一盘中国象棋',
  'panel.title': '象棋',

  'header.you.red': '你执红方',
  'header.you.black': '你执黑方',
  'header.opponentModel': '对手：{model}',
  'header.opponentLocal': '对手：本地引擎',
  'header.turn.red': '红方走子',
  'header.turn.black': '黑方走子',
  'header.clock.red': '红方用时 {time}',
  'header.clock.black': '黑方用时 {time}',
  'header.usage': '本局 {tokens} tokens',
  'header.ply': '第 {n} 手',

  'status.connecting': '正在连接宿主…',
  'status.ready': '可以走子了',
  'status.aiThinking': 'AI 思考中…（{seconds}s）',
  'status.aiFallback': '模型超时，已由本地引擎代走（可在配置里调大 opponent.timeoutMs，或调低 opponent.reasoningEffort）',
  'status.aiFailed': '模型这一步没走出来',
  'status.aiInvalid': '模型给了一步不合法的棋，已重试',
  'status.check.red': '红方被将军',
  'status.check.black': '黑方被将军',
  'status.result.checkmate.red': '红方被将死，黑方胜',
  'status.result.checkmate.black': '黑方被将死，红方胜',
  'status.result.stalemate.red': '红方无着法，判负',
  'status.result.stalemate.black': '黑方无着法，判负',
  'status.result.resign.red': '红方认输',
  'status.result.resign.black': '黑方认输',
  'status.result.win.red': '红方胜',
  'status.result.win.black': '黑方胜',
  'status.result.draw': '和棋（{reason}）',
  'status.result.finished': '本局已结束',
  'status.rpcUnavailable': '无法连接宿主，棋盘暂为只读',
  'status.rpcError': '与宿主通信失败：{message}',
  'status.rpcChannelMissing': '与宿主通信失败：宿主半的 RPC 通道未注册（HTTP 405）。'
    + '插件更新后需要重启一次 DSH，宿主代码才会重新加载。',
  'status.syncLost': '局面已刷新',
  'status.pollTimeout': 'AI 仍未应招，可点「由本地引擎代走」',
  'status.fallbackStarted': '正在由本地引擎代走…',
  'status.hintShown': '已给出 {count} 条提示',
  'status.copied': '棋谱已复制到剪贴板',
  'status.copyFailed': '复制失败，请手动选择棋谱文本',
  'status.newGame': '新对局已开始，你执红先行',
  'status.moved.red': '红方 {zh}{suffix}',
  'status.moved.black': '黑方 {zh}{suffix}',
  'status.suffix.none': '',
  'status.suffix.check': '，将军',
  'status.suffix.checkmate': '，将死',
  'status.invalid': '{reason}',
  'status.readonly': '复盘状态下不能落子，点「回到当前」继续',
  'status.notYourTurn': '现在不是你的回合',
  'status.reviewing': '复盘：第 {n} 手',
  'status.live': '已回到当前局面',
  'status.unknownError': '出错了：{message}',

  'action.new': '新对局',
  'action.undo': '悔棋',
  'action.hint': '提示',
  'action.resign': '认输',
  'action.copy': '复制棋谱',
  'action.fallback': '由本地引擎代走',
  'action.review': '复盘',
  'action.live': '回到当前',
  'action.openSidebar': '在右栏打开',
  'action.openMain': '在主面板打开',
  'action.retry': '重试',

  'confirm.new': '当前对局尚未结束，确定要开始新对局吗？',
  'confirm.resign': '确定要认输吗？',
  'confirm.ok': '确定',
  'confirm.cancel': '取消',

  'moves.title': '着法',
  'moves.empty': '还没有着法',
  'moves.aria': '着法列表',
  'moves.ply': '第 {n} 手',

  'board.label': '中国象棋棋盘',
  'board.cellAria': '{side} {piece}，{file}路，{rank}',
  'board.empty': '空',
  'board.emptyCell': '{file}路，{rank}',
  'board.cursorHint': '方向键移动光标，回车选中或落子，Esc 取消',
  'board.side.r': '红方',
  'board.side.b': '黑方',
  'board.hint': '提示着法',
  'board.hintAria': '提示：{zh}',
  'board.selected': '已选中 {piece}',
  'board.cursor': '光标：{cell}',
  'board.pieceTitle': '{name}',

  'error.moveInvalid': '这一步走不了',
  'error.notYourTurn': '现在不是你的回合',
  'error.selfCheck': '这一步会送将',
  'error.faceToFace': '将帅不能照面',
  'error.outOfRules': '这一步不符合走子规则',
  'error.finished': '本局已经结束',
  'error.noGame': '还没有开始对局',
  'error.busy': 'AI 正在思考，稍等一下',
  'error.undoUnavailable': '现在不能悔棋',
  'error.unknown': '未能完成这个操作',

  ...GENERATED.zh,
};

/** 英文字典；键集必须与 `zh` 完全一致。 */
export const en = {
  'tab.title': 'Chinese Chess',
  'guide.title': 'Play Chinese Chess',
  'guide.description': 'Play a game against this session\u2019s model',
  'panel.title': 'Chinese Chess',

  'header.you.red': 'You play Red',
  'header.you.black': 'You play Black',
  'header.opponentModel': 'Opponent: {model}',
  'header.opponentLocal': 'Opponent: local engine',
  'header.turn.red': 'Red to move',
  'header.turn.black': 'Black to move',
  'header.clock.red': 'Red {time}',
  'header.clock.black': 'Black {time}',
  'header.usage': '{tokens} tokens this game',
  'header.ply': 'Move {n}',

  'status.connecting': 'Connecting to the host\u2026',
  'status.ready': 'Your move',
  'status.aiThinking': 'AI is thinking\u2026 ({seconds}s)',
  'status.aiFallback': 'The model timed out; the local engine moved instead (raise opponent.timeoutMs or lower opponent.reasoningEffort)',
  'status.aiFailed': 'The model did not produce a move',
  'status.aiInvalid': 'The model returned an illegal move; retrying',
  'status.check.red': 'Red is in check',
  'status.check.black': 'Black is in check',
  'status.result.checkmate.red': 'Checkmate: Red is mated, Black wins',
  'status.result.checkmate.black': 'Checkmate: Black is mated, Red wins',
  'status.result.stalemate.red': 'Red has no legal move and loses',
  'status.result.stalemate.black': 'Black has no legal move and loses',
  'status.result.resign.red': 'Red resigned',
  'status.result.resign.black': 'Black resigned',
  'status.result.win.red': 'Red wins',
  'status.result.win.black': 'Black wins',
  'status.result.draw': 'Draw ({reason})',
  'status.result.finished': 'This game has ended',
  'status.rpcUnavailable': 'Cannot reach the host; the board is read-only',
  'status.rpcError': 'Host call failed: {message}',
  'status.rpcChannelMissing': 'Host call failed: the host-side RPC channel is not registered (HTTP 405). '
    + 'Restart DSH so the updated host code is loaded.',
  'status.syncLost': 'Position refreshed',
  'status.pollTimeout': 'The AI still has not moved; you can use the local engine',
  'status.fallbackStarted': 'Letting the local engine move\u2026',
  'status.hintShown': '{count} hints shown',
  'status.copied': 'Game record copied to the clipboard',
  'status.copyFailed': 'Copy failed; select the record text manually',
  'status.newGame': 'New game started \u2014 you play Red and move first',
  'status.moved.red': 'Red {zh}{suffix}',
  'status.moved.black': 'Black {zh}{suffix}',
  'status.suffix.none': '',
  'status.suffix.check': ', check',
  'status.suffix.checkmate': ', checkmate',
  'status.invalid': '{reason}',
  'status.readonly': 'Reviewing \u2014 play is disabled; choose \u201cBack to live\u201d to continue',
  'status.notYourTurn': 'It is not your turn',
  'status.reviewing': 'Review: move {n}',
  'status.live': 'Back to the live position',
  'status.unknownError': 'Something went wrong: {message}',

  'action.new': 'New game',
  'action.undo': 'Undo',
  'action.hint': 'Hint',
  'action.resign': 'Resign',
  'action.copy': 'Copy record',
  'action.fallback': 'Move with local engine',
  'action.review': 'Review',
  'action.live': 'Back to live',
  'action.openSidebar': 'Open in right panel',
  'action.openMain': 'Open in main panel',
  'action.retry': 'Retry',

  'confirm.new': 'This game is still running. Start a new one?',
  'confirm.resign': 'Resign this game?',
  'confirm.ok': 'Confirm',
  'confirm.cancel': 'Cancel',

  'moves.title': 'Moves',
  'moves.empty': 'No moves yet',
  'moves.aria': 'Move list',
  'moves.ply': 'Move {n}',

  'board.label': 'Xiangqi board',
  'board.cellAria': '{side} {piece}, file {file}, {rank}',
  'board.empty': 'empty',
  'board.emptyCell': 'file {file}, {rank}',
  'board.cursorHint': 'Arrow keys move the cursor; Enter selects or plays; Esc cancels',
  'board.side.r': 'Red',
  'board.side.b': 'Black',
  'board.hint': 'Suggested moves',
  'board.hintAria': 'Hint: {zh}',
  'board.selected': '{piece} selected',
  'board.cursor': 'Cursor: {cell}',
  'board.pieceTitle': '{name}',

  'error.moveInvalid': 'That move is not allowed',
  'error.notYourTurn': 'It is not your turn',
  'error.selfCheck': 'That move would expose your general',
  'error.faceToFace': 'The two generals may not face each other',
  'error.outOfRules': 'That move breaks the rules for this piece',
  'error.finished': 'This game is already over',
  'error.noGame': 'No game has started yet',
  'error.busy': 'The AI is thinking; please wait',
  'error.undoUnavailable': 'Undo is unavailable right now',
  'error.unknown': 'That action could not be completed',

  ...GENERATED.en,
};

/** 两套字典，交给 `ctx.locale.register(NS, dicts)`。 */
export const dicts = { zh, en };
