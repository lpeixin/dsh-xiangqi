#!/usr/bin/env node
/**
 * 命令行冒烟工具：让本地引擎自己跟自己下一局，用来验证引擎在完整对局里不崩、
 * 不产生非法着法、并且能把每一手写成正确的中文记谱。
 *
 * 用法：
 *   node scripts/xiangqi-cli.mjs play --moves 60            # 引擎自战 60 手
 *   node scripts/xiangqi-cli.mjs play --moves 120 --depth 4 # 更深、更长
 *   node scripts/xiangqi-cli.mjs play --moves 40 --seed 7   # 换一个随机种子
 *   node scripts/xiangqi-cli.mjs board --fen '<FEN>'        # 打印某个局面的描述
 *
 * 退出码：0 = 正常（允许自然结束），1 = 出现非法着法或异常。
 */

import process from 'node:process'

import {
  applyMove,
  describePosition,
  formatChinese,
  gameStatus,
  generateMoves,
  initialPosition,
  isLegalMove,
  moveToIccs,
  positionFromFen,
  positionToFen,
  searchBestMove,
} from '../lib/engine/index.js'

/** 极简参数解析：--k v 与 --flag。 */
function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      i += 1
    }
  }
  return { positional, flags }
}

const num = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function boardCommand(flags) {
  const fen = typeof flags.fen === 'string' ? flags.fen : undefined
  if (fen === undefined) {
    process.stderr.write('board 需要 --fen <FEN>\n')
    return 1
  }
  const pos = positionFromFen(fen)
  process.stdout.write(`${describePosition(pos, { includeMoves: true, includeEval: true })}\n`)
  return 0
}

function playCommand(flags) {
  const maxPlies = num(flags.moves, 60)
  const depth = num(flags.depth, 3)
  const timeMs = num(flags['time-ms'], 200)
  const seed = num(flags.seed, 1)

  let pos = initialPosition()
  process.stdout.write(`开局：${positionToFen(pos)}\n`)
  process.stdout.write(`局面：${describePosition(pos, { includeMoves: false, includeEval: true })}\n\n`)

  // 两个数组刻意分开，别混：
  //  - fens：给 gameStatus(pos, history) 用，它要的是**历史局面 FEN**（不含当前），三次重复/长将靠它；
  //  - zhMoves：给人看的中文记谱。
  // 早先这里把 ICCS 着法串当 history 传，并且把 ICCS 打印成了「中文棋谱」——两处都是错的。
  const fens = []
  const zhMoves = []
  let plies = 0

  while (plies < maxPlies) {
    const status = gameStatus(pos, fens)
    if (status.state !== 'playing' && status.state !== 'check') {
      process.stdout.write(`\n对局结束（第 ${plies} 手）：${status.reasonZh}\n`)
      break
    }

    const legal = generateMoves(pos)
    if (legal.length === 0) {
      process.stdout.write(`\n第 ${plies} 手：无合法着法，${status.reasonZh}\n`)
      break
    }

    // searchBestMove 的随机性由 seed + 手数决定，保证同参数可复现
    const best = searchBestMove(pos, { depth, timeMs, seed: seed + plies })
    if (best === undefined || best.move === undefined) {
      process.stderr.write(`第 ${plies} 手：搜索未返回着法\n`)
      return 1
    }
    if (!isLegalMove(pos, best.move)) {
      process.stderr.write(`第 ${plies} 手：搜索返回了非法着法 ${moveToIccs(best.move)}\n`)
      return 1
    }

    const zh = formatChinese(pos, best.move)
    const iccs = moveToIccs(best.move)
    const ply = plies + 1
    const side = pos.turn === 'r' ? '红' : '黑'
    if (ply % 2 === 1) process.stdout.write(`${String(Math.ceil(ply / 2)).padStart(3)}. `)
    process.stdout.write(`${side} ${zh}(${iccs})${ply % 2 === 0 ? '\n' : '   '}`)

    fens.push(positionToFen(pos))
    zhMoves.push(zh)
    pos = applyMove(pos, best.move)
    plies += 1
  }
  if (plies % 2 === 1) process.stdout.write('\n')

  const final = gameStatus(pos, fens)
  process.stdout.write(`\n共 ${plies} 手。最终状态：${final.state} — ${final.reasonZh}\n`)
  process.stdout.write(`最终 FEN：${positionToFen(pos)}\n`)
  process.stdout.write(`中文棋谱：${zhMoves.length === 0 ? '（无）' : zhMoves.join(' ')}\n`)
  return 0
}

const { positional, flags } = parseArgs(process.argv.slice(2))
const command = positional[0]

if (command === 'play' || command === undefined) {
  process.exit(playCommand(flags))
} else if (command === 'board') {
  process.exit(boardCommand(flags))
} else {
  process.stderr.write(`未知子命令：${command}\n可用：play | board\n`)
  process.exit(1)
}
