/**
 * 工具定义汇总（§6.2 的六张表）。
 *
 * 一律使用**原生 `ToolDefinition` 字面量**，不 import 任何官方包（零依赖）。
 * `parameters` 宿主**不做运行时校验**，所以每个 handler 自己校验；
 * `output.schema` 会被严格校验，因此所有返回值都过一遍 `clean()` 且与 schema 一一对应。
 *
 * 并发性：只有 `xiangqi_board` 声明 `isConcurrencySafe: () => true`；
 * `xiangqi_new` / `xiangqi_move` / `xiangqi_undo` **不声明**（必须串行）。
 */

import { createHandlers } from './handlers.js';
import { boardMeta, clean, renderBoard, renderFailure } from './render.js';

const str = { type: 'string' };
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const nullable = (node) => ({ oneOf: [node, { type: 'null' }] });

const STATUS = {
  type: 'object',
  properties: { state: str, winner: nullable(str), reasonZh: str },
  required: ['state'],
};
const CLOCK = { type: 'object', properties: { red: num, black: num } };
const PLAYED = { type: 'object', properties: { iccs: str, zh: str }, required: ['iccs'] };
const OPPONENT = {
  type: 'object',
  properties: { kind: str, provider: nullable(str), model: nullable(str), label: str },
  required: ['kind', 'label'],
};
const CATALOG = { type: 'array', items: { type: 'object', properties: { iccs: str, zh: str }, required: ['iccs'] } };
const FAILURE = {
  type: 'object',
  properties: { ok: { type: 'boolean', const: false }, error: str, errorZh: str, legalMoves: CATALOG },
  required: ['ok', 'error', 'errorZh'],
};

/** 六个工具的共同尾部字段。 */
const COMMON = {
  fen: str,
  turn: str,
  revision: int,
  clock: CLOCK,
  boardText: str,
};

const MOVE_PARAMETERS = {
  type: 'object',
  properties: {
    move: {
      oneOf: [
        { type: 'string' },
        { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      ],
    },
    reason: str,
  },
  required: ['move'],
};

const BOARD_DESCRIPTION =
  '读取当前象棋局面：状态、ASCII 棋盘、中文棋谱、合法着法目录与评估摘要。' +
  '只读、不改状态。局面描述里已含合法着法目录，**不必**为了走子先调它。';

/**
 * 构造六个工具定义。
 * @param {object} options 选项。
 * @param {object} options.service 对局服务（`createGameService` 的结果）。
 * @param {object} options.config 归一化配置。
 * @returns {object[]} ToolDefinition 数组。
 */
export function createToolDefinitions({ service, config }) {
  const handlers = createHandlers({ service, config });
  return [
    {
      name: 'xiangqi_new',
      description:
        '开始或重开一局中国象棋。默认人类执红先行、对手为当前会话模型。' +
        '调用后棋盘从标准初始局面开始；此前的棋谱被清空（如需保留请先调 xiangqi_review）。',
      parameters: {
        type: 'object',
        properties: {
          side: { type: 'string', enum: ['r', 'b'], description: '人类执子方，默认 r（红）' },
          opponent: { type: 'string', enum: ['model', 'local'], description: '对手，默认 model（当前会话模型）' },
          maxPlies: { type: 'integer', description: '本局着法上限，默认 400' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', const: true },
            ...COMMON,
            hero: str,
            opponent: OPPONENT,
            phase: str,
            pending: nullable(str),
            status: STATUS,
            legalCount: int,
          },
          required: ['ok', 'fen', 'turn', 'boardText'],
        },
        render: (args, value) => renderBoard(value),
        presentationMeta: (args, value) => boardMeta(value),
      },
      execute: async (args, exec) => clean(await handlers.new(args, exec)),
    },
    {
      name: 'xiangqi_board',
      description: BOARD_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          includeMoves: { type: 'boolean', description: '是否返回合法着法目录，默认 true' },
          includeEval: { type: 'boolean', description: '是否返回评估摘要，默认 false' },
          ascii: { type: 'boolean', description: '是否返回完整 ASCII 棋盘，默认 true' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', const: true },
            ...COMMON,
            hero: str,
            opponent: OPPONENT,
            phase: str,
            pending: nullable(str),
            status: STATUS,
            legalCount: int,
            historyZh: { type: 'array', items: str },
            lastMove: nullable({ type: 'object', properties: { iccs: str, zh: str } }),
            legalMoves: CATALOG,
            evalSummaryZh: str,
          },
          required: ['ok', 'fen', 'turn', 'boardText'],
        },
        render: (args, value) => renderBoard(value),
        presentationMeta: (args, value) => boardMeta(value),
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => clean(await handlers.board(args, exec)),
    },
    {
      name: 'xiangqi_move',
      description:
        '提交一步象棋着法（模型执子方）。move 接受 ICCS 座标（h2e2）、中文记谱（炮二平五）' +
        '或 { from, to } 对象。只能替对手方走子；非法着法会返回合法着法目录供你重试。',
      parameters: MOVE_PARAMETERS,
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              properties: {
                ok: { type: 'boolean', const: true },
                ...COMMON,
                played: PLAYED,
                captured: str,
                status: STATUS,
                pending: nullable(str),
                aiTurn: bool,
              },
              required: ['ok', 'fen', 'played'],
            },
            FAILURE,
          ],
        },
        render: (args, value) => (value?.ok === true ? renderBoard(value) : renderFailure(value)),
        presentationMeta: (args, value) => boardMeta(value),
      },
      execute: async (args, exec) => clean(await handlers.move(args, exec)),
    },
    {
      name: 'xiangqi_undo',
      description: '悔棋：撤掉最近若干手（默认 2 手，回到同一方走子）。AI 思考中不可用。',
      parameters: {
        type: 'object',
        properties: { plies: { type: 'integer', description: '要撤销的手数，默认 2' } },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              properties: {
                ok: { type: 'boolean', const: true },
                ...COMMON,
                plies: int,
                historyZh: { type: 'array', items: str },
                pending: nullable(str),
              },
              required: ['ok', 'fen'],
            },
            FAILURE,
          ],
        },
        render: (args, value) => (value?.ok === true ? renderBoard(value) : renderFailure(value)),
        presentationMeta: (args, value) => boardMeta(value),
      },
      execute: async (args, exec) => clean(await handlers.undo(args, exec)),
    },
    {
      name: 'xiangqi_hint',
      description: '用内置本地引擎给出若干候选着法与子力评估摘要；不消耗模型额度。',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'integer', description: '候选数，1–5，默认 3' },
          depth: { type: 'integer', description: '搜索深度参考值，1–8，默认取配置' },
        },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              properties: {
                ok: { type: 'boolean', const: true },
                fen: str,
                turn: str,
                boardText: str,
                depth: int,
                evalSummaryZh: str,
                candidates: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { iccs: str, zh: str, score: num, pv: { type: 'array', items: str }, capture: str },
                    required: ['iccs'],
                  },
                },
              },
              required: ['ok', 'candidates'],
            },
            FAILURE,
          ],
        },
        render: (args, value) => (value?.ok === true ? renderBoard(value) : renderFailure(value)),
      },
      execute: async (args, exec) => clean(await handlers.hint(args, exec)),
    },
    {
      name: 'xiangqi_review',
      description: '复盘当前对局：中文棋谱、转折点与逐手评估曲线（FR12/FR16）。',
      parameters: {
        type: 'object',
        properties: { highlight: { type: 'string', enum: ['turning', 'all'], description: '标记范围，默认 turning' } },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              properties: {
                ok: { type: 'boolean', const: true },
                fen: str,
                revision: int,
                finalFen: str,
                boardText: str,
                historyZh: { type: 'array', items: str },
                turningPoints: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { ply: int, zh: str, iccs: str, scoreBefore: num, scoreAfter: num, delta: num, captured: str },
                    required: ['ply'],
                  },
                },
                evalCurve: {
                  type: 'array',
                  items: { type: 'object', properties: { ply: int, score: num, delta: num }, required: ['ply'] },
                },
              },
              required: ['ok', 'historyZh'],
            },
            FAILURE,
          ],
        },
        render: (args, value) => (value?.ok === true ? renderBoard(value) : renderFailure(value)),
      },
      execute: async (args, exec) => clean(await handlers.review(args, exec)),
    },
  ];
}

/** 工具名清单（入口注册与测试共用）。 */
export const TOOL_NAMES = Object.freeze(['xiangqi_new', 'xiangqi_board', 'xiangqi_move', 'xiangqi_undo', 'xiangqi_hint', 'xiangqi_review']);
