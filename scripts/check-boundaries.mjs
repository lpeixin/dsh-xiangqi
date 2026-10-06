#!/usr/bin/env node
/**
 * 静态边界门禁（CI 硬门，对应 docs/DESIGN.md §9.3）。
 *
 * 这些约束每一条都对应一个真实的失败模式，而不是风格偏好：
 *
 *  1. lib/engine 出现裸模块说明符 → 引擎无法在浏览器半内联复用（FR20 破裂）；
 *  2. package.json 有 dependencies → 安装时需要解析依赖，破坏「零依赖、安装即用」；
 *  3. lib/index.js 有 export default → DSH Loader 的 unwrapExports 会折叠模块并丢掉 inject；
 *  4. 相对 import 缺 .js 后缀 → ESM 下 Node 解析失败；
 *  5. lib/client.js 调用 host.call → 那是动态包的能力，静态包会 undefined is not a function；
 *  6. lib/client.js require 官方客户端 UI 包 → 官方规范明确劝阻（随版本变化 + 抛错会打白插槽）；
 *  7. lib/client.js 出现 import → 免构建产物必须是自包含单文件（浏览器不解析相对 import）；
 *  8. lib/client.js 未登记正确的包名 → 宿主按包名派发，id 不对则该 bundle 永不生效；
 *  9. package.json files 漏掉必需文件 → npm 包里缺 cordis.patch.yml / locale / icon，安装后不显示或装不上。
 *
 * 用法：node scripts/check-boundaries.mjs [--json]
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const FAILURES = []
const CHECKS = []

/** 记录一条检查结果。 */
function check(name, ok, detail) {
  CHECKS.push({ name, ok, detail })
  if (!ok) FAILURES.push({ name, detail })
}

/** 递归收集目录下的文件（相对 ROOT，POSIX 分隔符）。 */
async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(join(ROOT, dir), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await walk(rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

async function exists(rel) {
  try {
    await stat(join(ROOT, rel))
    return true
  } catch {
    return false
  }
}

const read = (rel) => readFile(join(ROOT, rel), 'utf8')

/** 把一行里的模块说明符取出来（import/export ... from 'x' 与 import 'x'）。 */
function specifiersOf(source) {
  const specs = []
  const re = /(?:^|\n)\s*(?:import|export)\b[^\n]*?from\s*['"]([^'"]+)['"]/g
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
  for (const m of source.matchAll(re)) specs.push(m[1])
  for (const m of source.matchAll(bare)) specs.push(m[1])
  return specs
}

/**
 * 去掉注释后再做模式匹配。
 *
 * 必须这么做：本文件里的多条规则是「禁止出现 X」的形式，而源码里解释
 * 「为什么不要用 X」的注释本身就会命中这些模式——那是误报，不是违规。
 * 注意保留换行，避免把两行粘成一行后产生新的匹配。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (_, prefix) => prefix)
}

const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../')

/**
 * 相对导入必须带**显式**文件扩展名（ESM 下 Node 不做扩展名补全）。
 *
 * 判定的是「有没有扩展名」而不是「必须叫 .js」——测试辅助文件用 .mjs，那是合规的。
 * 写成 endsWith('.js') 会把它们误报成违规，而**会误报的门禁比没有门禁更糟**：
 * 它会训练人忽略红灯。
 */
const hasExplicitJsExtension = (spec) => /\.(js|mjs)$/.test(spec)

// ── 1. 引擎：只允许同目录相对 import，且必须带 .js 后缀 ──────────────────────
const engineFiles = await walk('lib/engine')
if (engineFiles.length === 0) {
  check('engine.present', false, 'lib/engine/ 不存在或为空')
} else {
  const offenders = []
  const badExt = []
  for (const file of engineFiles.filter((f) => f.endsWith('.js'))) {
    const source = stripComments(await read(file))
    for (const spec of specifiersOf(source)) {
      if (!isRelative(spec)) offenders.push(`${file} → ${spec}`)
      else if (!hasExplicitJsExtension(spec)) badExt.push(`${file} → ${spec}`)
    }
  }
  check('engine.no-bare-specifier', offenders.length === 0, offenders.join('; '))
  check('engine.relative-has-js-extension', badExt.length === 0, badExt.join('; '))

  // 引擎里不允许出现 Node/宿主能力：它必须能在浏览器里跑
  const hostish = []
  for (const file of engineFiles.filter((f) => f.endsWith('.js'))) {
    const source = stripComments(await read(file))
    for (const pattern of [/\brequire\s*\(/, /\bprocess\s*\./, /\bBuffer\b/, /\b__dirname\b/, /\bimport\s*\(/]) {
      if (pattern.test(source)) hostish.push(`${file} 命中 ${pattern}`)
    }
  }
  check('engine.no-host-capability', hostish.length === 0, hostish.join('; '))
}

// ── 2. package.json：零依赖 + 必需文件齐全 ──────────────────────────────────
const pkg = JSON.parse(await read('package.json'))
const deps = Object.keys(pkg.dependencies ?? {})
const optional = Object.keys(pkg.optionalDependencies ?? {})
check('package.zero-dependencies', deps.length === 0 && optional.length === 0,
  `dependencies=${JSON.stringify(deps)} optional=${JSON.stringify(optional)}`)

const dshPeers = Object.keys(pkg.peerDependencies ?? {}).filter((n) => n === '@deepseek-ai/dsh' || n.startsWith('@deepseek-ai/dsh-'))
check('package.no-dsh-peer-dependencies', dshPeers.length === 0,
  `声明了 @deepseek-ai/dsh* 的 peerDependencies（会被 preflight 按精确版本检查，升级后可能被禁用）：${dshPeers.join(', ')}`)

check('package.dsh-bundle-patch', pkg.dsh?.bundle?.patch === './cordis.patch.yml',
  `dsh.bundle.patch = ${JSON.stringify(pkg.dsh?.bundle?.patch)}（没有它插件无法通过插件管理器安装）`)
check('package.dsh-client-platform', pkg.dsh?.client?.platform === 'web',
  `dsh.client.platform = ${JSON.stringify(pkg.dsh?.client?.platform)}`)
check('package.exports-client', Boolean(pkg.exports?.['./client']),
  'package.json 缺少 exports["./client"]：声明了 dsh.client 却不导出客户端 bundle 会被宿主直接抛错')
check('package.exports-package-json', Boolean(pkg.exports?.['./package.json']),
  '缺少 exports["./package.json"]：插件列表会丢掉图标与本地化标题')
check('package.exports-locale', Boolean(pkg.exports?.['./locale/*.json']),
  '缺少 exports["./locale/*.json"]：插件列表读不到 locale/en.json 的显示名')
check('package.icon-present', Boolean(pkg.icon) && (await exists(pkg.icon ?? '')),
  `icon = ${JSON.stringify(pkg.icon)}`)

const requiredFiles = ['lib', 'assets', 'locale', 'docs', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE']
const files = pkg.files ?? []
const missingFiles = requiredFiles.filter((req) => !files.includes(req))
check('package.files-covers-required', missingFiles.length === 0, `files 缺少：${missingFiles.join(', ')}`)

// ── 3. 宿主半入口：不得有 default export ────────────────────────────────────
const hostEntry = pkg.main ?? './lib/index.js'
if (await exists(hostEntry)) {
  const source = stripComments(await read(hostEntry))
  const hasDefault = /(?:^|\n)\s*export\s+default\b/.test(source)
  check('host.no-default-export', !hasDefault,
    `${hostEntry} 含 export default：Loader 的 unwrapExports 会折叠模块并丢掉 inject`)
  const hasName = /(?:^|\n)\s*export\s+const\s+name\b/.test(source)
  check('host.named-name-export', hasName, `${hostEntry} 缺少 export const name`)
} else {
  check('host.entry-present', false, `入口 ${hostEntry} 不存在`)
}

// ── 4. 所有相对 import 必须带 .js 后缀（整仓，跳过生成物与 docs） ────────────
{
  const filesAll = [...(await walk('lib')), ...(await walk('scripts')), ...(await walk('test'))]
  const bad = []
  for (const file of filesAll.filter((f) => /\.(js|mjs)$/.test(f) && f !== 'lib/client.js')) {
    const source = stripComments(await read(file))
    for (const spec of specifiersOf(source)) {
      if (isRelative(spec) && !hasExplicitJsExtension(spec)) bad.push(`${file} → ${spec}`)
    }
  }
  check('esm.relative-has-js-extension', bad.length === 0, bad.join('; '))
}

// ── 5. 浏览器半：免构建产物的九条约束 ──────────────────────────────────────
const clientPath = 'lib/client.js'
if (!(await exists(clientPath))) {
  check('client.present', false, `${clientPath} 不存在（应运行 node scripts/build-client.mjs 生成并提交）`)
} else {
  const rawSource = await read(clientPath)
  const source = stripComments(rawSource)
  const pkgName = pkg.name

  check('client.registers-loader',
    source.includes('window.__ModuleLoader__.load(') && source.includes(`"${pkgName}"`),
    `${clientPath} 未以 window.__ModuleLoader__.load({ id: "${pkgName}", ... }) 登记（宿主按包名派发，id 不对则永不生效）`)

  check('client.no-host-call', !/\bhost\s*\.\s*call\s*\(/.test(source),
    '客户端半调用了 host.call：那是动态 Cordis 包的能力，静态包会 undefined is not a function')

  check('client.no-official-ui-packages',
    !/require\(\s*['"]@deepseek-ai\/dsh-client-ui-primitives['"]\s*\)/.test(source),
    '客户端半 require 了官方 UI 包：官方规范明确劝阻（随版本变化 + 组件抛错会打白插槽条目）')

  check('client.no-import-statements', !/(?:^|\n)\s*import\b/.test(source),
    '免构建产物里出现 import 语句：浏览器不解析相对 import，必须是自包含单文件')

  check('client.no-styles-insert', !/\bstyles\s*\.\s*insert\s*\(/.test(source),
    '客户端半用了 styles.insert：那只存在于动态包闭包，静态包拿不到（应用 <style data-plugin-css> 或组件内 <style>）')

  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
  const allowed = new Set(['react', 'react/jsx-runtime'])
  const unexpected = [...new Set(requires)].filter((spec) => !allowed.has(spec))
  check('client.only-baseline-requires', unexpected.length === 0,
    `客户端半 require 了基线表之外的模块（需写进 dsh.client.external 并确认供给方）：${unexpected.join(', ')}`)

  check('client.no-custom-session-events', !/session\s*\.\s*append\s*\(/.test(source),
    '客户端半出现了 session.append：写自定义事件类型会让整个会话无法重新打开（docs/DESIGN.md §6.3 红线）')
}

// ── 6. 宿主半不得写自定义会话事件（同样是红线） ────────────────────────────
{
  const hostFiles = [...(await walk('lib/game')), ...(await walk('lib/tools')), ...(await walk('lib/opponent'))]
  if (await exists(hostEntry)) hostFiles.push(hostEntry)
  const offenders = []
  for (const file of hostFiles.filter((f) => f.endsWith('.js'))) {
    const source = stripComments(await read(file))
    if (/\.append\(\s*['"][^'"]*['"]/.test(source) && /session/.test(source)) {
      offenders.push(file)
    }
  }
  check('host.no-custom-session-events', offenders.length === 0,
    `疑似调用 session.append 写自定义事件（会导致会话不可恢复）：${offenders.join(', ')}`)
}

// ── 输出 ───────────────────────────────────────────────────────────────────
const asJson = process.argv.includes('--json')
if (asJson) {
  process.stdout.write(`${JSON.stringify({ root: ROOT, checks: CHECKS, failures: FAILURES }, null, 2)}\n`)
} else {
  const width = Math.max(...CHECKS.map((c) => c.name.length))
  for (const { name, ok, detail } of CHECKS) {
    process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(width)}${ok || !detail ? '' : `  ← ${detail}`}\n`)
  }
  const passed = CHECKS.filter((c) => c.ok).length
  process.stdout.write(`\n${passed}/${CHECKS.length} 项通过`)
  process.stdout.write(FAILURES.length === 0 ? '；静态边界门禁通过。\n' : `；${FAILURES.length} 项失败。\n`)
}

process.exit(FAILURES.length === 0 ? 0 : 1)
