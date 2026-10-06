#!/usr/bin/env node
/**
 * 生成 `lib/client.js`（浏览器半的免构建单文件产物，§4.5）。
 *
 * 这个脚本**只做文本拼接，不做语法转换**：
 *
 *  1. 按固定顺序读入 `lib/engine/{coords,fen,moves,rules,notation-zh,eval,describe,search}.js`
 *     （`index.js` 只是重导出，不参与内联）；
 *  2. 逐行剥掉行首的 `import …` / `export ` 语句——引擎与 UI 源文件都是「无跨行 import
 *     的纯 ESM 函数文件」，剥掉之后它们在同一个 IIFE 作用域里互相可见；
 *  3. 接上 `lib/ui/*.js`（顺序由本文件声明）；
 *  4. 包进 `window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => … })`。
 *
 * 产物**必须提交进仓库**，CI 用 `--check` 校验「重新生成的产物 == 已提交产物」，
 * 防止有人手改产物（§9.3）。
 *
 * 为什么把自检放在这里：合并成单一作用域之后，**多行 import** 与 **顶层重名** 这两类
 * 问题都会以「浏览器白屏」表现，而 `node --check` 在 ESM 模式下抓不到（语法各自合法）。
 * 所以生成前先把它们变成构建失败，并明确指出文件与行号。生成后还会自检产物本身
 * （无残留 import/export、恰好一次 loader 登记、能被 `new Function` 当 classic script 解析）。
 *
 * 用法：
 *   node scripts/build-client.mjs            # 生成（覆盖 lib/client.js）
 *   node scripts/build-client.mjs --check    # 只校验，不一致则非零退出
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = join(ROOT, 'lib', 'client.js');

/**
 * 内联顺序即执行顺序。引擎按 M1 定稿的依赖序（coords 最先、describe 依赖 eval 与
 * rules）；UI 里任何一步的顶层 `const` 都只依赖它**前面**的文件，`plugin.js` 必须最后，
 * 因为包装层要取它的 `inject` 与 `apply`。
 */
export const ENGINE_FILES = [
  'coords.js',
  'fen.js',
  'moves.js',
  'rules.js',
  'notation-zh.js',
  'eval.js',
  'describe.js',
  'search.js',
];

export const UI_FILES = [
  'i18n.js',
  'model.js',
  'styles.js',
  'icons.js',
  'rpc.js',
  'poller.js',
  'engine-bridge.js',
  'board.js',
  'panel.js',
  'plugin.js',
];

const HEADER = '/* 自动生成，请勿手改；改源码后跑 npm run build:client */';

/** 顶层声明的名字（用于检测「两个文件撞名」——合并成一个作用域后那是语法错误）。 */
const DECLARATION = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
/** `export function/const/…`：单行、剥掉 `export ` 即可。 */
const SINGLE_LINE_EXPORT = /^\s*export\s+(?:async\s+)?(?:function|const|let|var|class)\b/;
/** 任何模块语句（import / export ... from / export {...}）。 */
const MODULE_STATEMENT = /^\s*(?:import|export)\b/;

/** 括号净增量（粗略即可：这些源码里的字符串不含裸括号）。 */
function braceDelta(line) {
  let depth = 0;
  for (const ch of line) {
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
  }
  return depth;
}

/** 一行模块语句是否在本行内结束。 */
function statementTerminates(line) {
  if (/;\s*$/.test(line)) return true;
  if (/from\s*['"][^'"]*['"]\s*$/.test(line)) return true;
  if (/^\s*import\s*['"][^'"]*['"]\s*$/.test(line)) return true;
  if (/^\s*export\s*\{\s*\}\s*$/.test(line)) return true;
  return false;
}

/**
 * 生成前自检 1：模块语句必须单行。
 *
 * 多行 `import {` 在「逐行剥行首 import」的规则下会把 `} from './x.js';` 留在产物里，
 * 而那一行在 classic script 里是纯语法错误——只会在浏览器里表现为白屏。
 * @param file - 相对路径（报错用）。
 * @param source - 源文件全文。
 */
export function assertSingleLineModuleStatements(file, source) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!MODULE_STATEMENT.test(line)) continue;
    if (SINGLE_LINE_EXPORT.test(line)) continue;
    if (statementTerminates(line)) continue;
    throw new Error(
      `${file}:${i + 1} 的模块语句跨行：${line.trim()}\n` +
        '        引擎与 UI 会被内联进同一个作用域，跨行的 import/export 无法逐行剥离，' +
        '产物会直接语法错误（浏览器白屏）。请折成单行。',
    );
  }
}

/**
 * 生成前自检 2：引擎不得出现裸模块说明符 / `node:`（重复 check-boundaries 的一条，
 * 但**更早失败**：它会让内联根本没法做）。
 * @param file - 相对路径。
 * @param source - 源文件全文。
 */
export function assertEngineImportsRelative(file, source) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*(?:import|export)\b[^\n]*?from\s*['"]([^'"]+)['"]/.exec(lines[i]);
    const bare = /^\s*import\s*['"]([^'"]+)['"]/.exec(lines[i]);
    const spec = match?.[1] ?? bare?.[1];
    if (spec === undefined) continue;
    if (!spec.startsWith('./') && !spec.startsWith('../')) {
      throw new Error(
        `${file}:${i + 1} 引用了裸模块说明符 "${spec}"：引擎必须能被内联进浏览器产物，` +
          '只能使用同目录相对 import（FR20）。',
      );
    }
    if (!spec.endsWith('.js')) {
      throw new Error(`${file}:${i + 1} 的相对 import "${spec}" 缺少 .js 后缀（ESM 下 Node 解析失败）。`);
    }
  }
}

/**
 * 剥掉一个源文件里的模块语法。
 *
 * @param source - 源文件全文。
 * @param file - 相对路径（报错用）。
 * @returns `{ code, declarations }`。
 */
export function stripModuleSyntax(source, file) {
  const output = [];
  const declarations = [];
  const lines = source.split('\n');
  let skipping = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (skipping > 0) {
      skipping += braceDelta(line);
      if (skipping <= 0) skipping = 0;
      continue;
    }
    if (/^\s*import\b/.test(line)) {
      const delta = braceDelta(line);
      if (delta > 0) skipping = delta;
      continue;
    }
    if (/^\s*export\s+default\b/.test(line)) {
      throw new Error(`${file}:${i + 1} 出现 export default；产物必须导出 { inject, apply } 两个名字`);
    }
    if (/^\s*export\s*\{/.test(line)) {
      const delta = braceDelta(line);
      if (delta > 0) skipping = delta;
      continue;
    }
    const rewrite = /^(\s*)export\s+(\S.*)$/.exec(line);
    if (rewrite !== null) {
      const body = `${rewrite[1]}${rewrite[2]}`;
      output.push(body);
      const declared = DECLARATION.exec(body.trim());
      if (declared !== null) declarations.push({ name: declared[1], line: i + 1 });
      continue;
    }
    output.push(line);
    const declared = DECLARATION.exec(line);
    if (declared !== null) declarations.push({ name: declared[1], line: i + 1 });
  }

  const code = output.join('\n');
  const residual = code.split('\n').findIndex((line) => MODULE_STATEMENT.test(line));
  if (residual >= 0) {
    throw new Error(`${file}:${residual + 1} 剥离后仍残留 import/export，请把它们写成行首的单行语句`);
  }
  return { code, declarations };
}

/** 读入并自检一个源文件。 */
async function load(relativePath) {
  const absolute = join(ROOT, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`缺少源文件 ${relativePath}（引擎由 M1 产出；就绪后重跑本脚本）`);
  }
  const source = await readFile(absolute, 'utf8');
  assertSingleLineModuleStatements(relativePath, source);
  if (relativePath.startsWith('lib/engine/')) assertEngineImportsRelative(relativePath, source);
  return stripModuleSyntax(source, relativePath);
}

/** 读取全部源文件（顺序即内联顺序）。 */
async function loadAll() {
  const loaded = [];
  for (const file of ENGINE_FILES) loaded.push({ file: `lib/engine/${file}`, ...(await load(`lib/engine/${file}`)) });
  for (const file of UI_FILES) loaded.push({ file: `lib/ui/${file}`, ...(await load(`lib/ui/${file}`)) });
  return loaded;
}

/**
 * 生成前自检 3：顶层声明跨文件唯一。
 *
 * @param loaded - `loadAll()` 的结果。
 */
export function assertUniqueTopLevelNames(loaded) {
  const owners = new Map();
  for (const entry of loaded) {
    for (const { name } of entry.declarations) {
      const list = owners.get(name);
      if (list === undefined) owners.set(name, [entry.file]);
      else list.push(entry.file);
    }
  }
  const clashes = [...owners.entries()].filter(([, files]) => files.length > 1);
  if (clashes.length > 0) {
    const detail = clashes.map(([name, files]) => `${name} → ${files.join(', ')}`).join('\n        ');
    throw new Error(
      `顶层声明撞名（内联进同一作用域会 Identifier has already been declared）：\n        ${detail}\n` +
        '        请把共享常量提到 lib/engine/coords.js，或给其中一个改名。',
    );
  }
}

/** 生成后自检：产物本身必须满足运行时契约。 */
export function assertArtifact(text) {
  const residual = text.split('\n').findIndex((line) => MODULE_STATEMENT.test(line));
  if (residual >= 0) throw new Error(`产物第 ${residual + 1} 行残留 import/export`);
  const loaders = text.split('window.__ModuleLoader__.load(').length - 1;
  if (loaders !== 1) {
    throw new Error(`产物里出现 ${loaders} 次 window.__ModuleLoader__.load(，必须恰好一次`);
  }
  try {
    // 产物是 classic script（浏览器里由 <script> 执行），用 new Function 解析最接近真实行为；
    // 只编译不执行，因此不会碰 window。
    // eslint-disable-next-line no-new-func
    new Function(text);
  } catch (error) {
    throw new Error(`产物无法作为 classic script 解析：${error.message}`);
  }
}

/** 生成完整产物文本。 */
export async function build() {
  const loaded = await loadAll();
  assertUniqueTopLevelNames(loaded);

  const parts = [];
  for (const entry of loaded) {
    parts.push(`\t/* ==================== ${entry.file} ==================== */`);
    parts.push(entry.code.replace(/\s+$/, ''));
    parts.push('');
  }

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const id = pkg.name;
  const text = [
    HEADER,
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    '\t"use strict";',
    '\t/* 平台基线表里本项目唯一允许的 require（§4.5、T7/T18）。 */',
    '\tconst React = require("react");',
    '\treturn (function () {',
    '\t\t"use strict";',
    parts.join('\n').replace(/\n/g, '\n\t\t').replace(/\s+$/, ''),
    '',
    '\t\t/* 只登记：所有资源注册都在 apply(ctx) 里用 ctx.effect / ctx.slots.inject 完成。 */',
    '\t\treturn { inject, apply };',
    '\t})();',
    '}});',
    '',
  ].join('\n');

  assertArtifact(text);
  return text;
}

/** CLI 入口。 */
async function main() {
  const check = process.argv.includes('--check');
  let generated;
  try {
    generated = await build();
  } catch (error) {
    process.stderr.write(`build-client: ${error.message}\n`);
    process.exit(1);
    return;
  }

  if (check) {
    if (!existsSync(OUTPUT)) {
      process.stderr.write(`build-client --check: ${relative(ROOT, OUTPUT)} 不存在，请运行 npm run build:client\n`);
      process.exit(1);
      return;
    }
    const committed = await readFile(OUTPUT, 'utf8');
    if (committed !== generated) {
      process.stderr.write(
        `build-client --check: ${relative(ROOT, OUTPUT)} 与源码不一致` +
          `（已提交 ${committed.split('\n').length} 行，重新生成 ${generated.split('\n').length} 行）；` +
          '请运行 npm run build:client\n',
      );
      process.exit(1);
      return;
    }
    process.stdout.write(`build-client --check: 产物与源码一致（${generated.split('\n').length} 行）\n`);
    return;
  }

  await writeFile(OUTPUT, generated, 'utf8');
  process.stdout.write(
    `build-client: 已写出 ${relative(ROOT, OUTPUT)}` +
      `（${generated.split('\n').length} 行，${Buffer.byteLength(generated, 'utf8')} 字节）\n`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  await main();
}
