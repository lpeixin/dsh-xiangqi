/**
 * 按会话持久化（§6.3、FR16）。
 *
 * 三条后端，按优先级探测：
 *  1. `ctx.storageDomain`（可选升级）——存在且能 `open` 成功时使用；
 *  2. 按会话落盘到 `<会话 cwd>/<Config.saveDir>/<sessionId>.json`（**原子写 tmp + rename**）；
 *  3. 进程内 `Map`——两者都不可用时使用，此时 UI 需显示「本局不会被保存」。
 *
 * 只存 `MoveRecord[]` 的紧凑形式 + 初始 FEN（局面由引擎重放得出），一局 200 手 ≈ 6 KB。
 * sessionId 一律做白名单清洗（`[^A-Za-z0-9_-]` → `_`）防路径穿越。
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UNSAFE_ID = /[^A-Za-z0-9_-]/g;
const DEFAULT_DIR = '.dsh-xiangqi';
const DOMAIN_NAME = 'xiangqi-mate';
const MAX_ID_LENGTH = 120;

/** 清洗会话 id：白名单外字符替换为 `_`，空值回落到 `default`。 */
export function sanitizeSessionId(id) {
  const raw = typeof id === 'string' ? id : '';
  const cleaned = raw.replace(UNSAFE_ID, '_').slice(0, MAX_ID_LENGTH);
  return cleaned === '' ? 'default' : cleaned;
}

/** 手写的值 schema（storageDomain 只要求 `{ parse, safeParse }`，不必引入 zod）。 */
function recordSchema() {
  const check = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('xiangqi: 存档必须是对象');
    }
    if (!Array.isArray(value.moves)) throw new Error('xiangqi: 存档缺少 moves 数组');
    return value;
  };
  return {
    parse: (value) => check(value),
    safeParse: (value) => {
      try {
        return { success: true, data: check(value) };
      } catch (error) {
        return { success: false, error };
      }
    },
  };
}

/**
 * 建立持久化后端。
 * @param {object} options 选项。
 * @param {object} options.config 已归一化的插件配置。
 * @param {object} options.ctx 插件上下文（只用 `get` 与可选 `logger`）。
 * @returns {object} store 句柄。
 */
export function createStore({ config, ctx } = {}) {
  const logger = ctx?.logger ?? ctx?.get?.('logger');
  const saveDir = normalizeDir(config?.saveDir);
  const memory = new Map();
  const state = { mode: 'memory', detail: '进程内内存（重启后丢失）', persistent: false };
  let domain = null;
  let domainProbed = false;
  let tmpCounter = 0;
  let fileBroken = false;

  function warn(message, error) {
    try {
      if (typeof logger?.warn === 'function') logger.warn(`[xiangqi] ${message}`, error);
    } catch {
      /* 日志失败绝不影响对局 */
    }
  }

  function dirFor(cwd) {
    if (path.isAbsolute(saveDir)) return saveDir;
    const base = typeof cwd === 'string' && cwd.trim() !== '' ? cwd : process.cwd();
    return path.join(base, saveDir);
  }

  function fileFor(key, cwd) {
    return path.join(dirFor(cwd), `${sanitizeSessionId(key)}.json`);
  }

  async function ensureDomain() {
    if (domainProbed) return domain;
    domainProbed = true;
    const service = typeof ctx?.get === 'function' ? ctx.get('storageDomain') : undefined;
    if (service === null || service === undefined || typeof service.open !== 'function') return null;
    try {
      domain = await service.open({ name: DOMAIN_NAME, version: 1, tables: { games: { valueSchema: recordSchema() } } });
      state.mode = 'domain';
      state.detail = `storageDomain(${DOMAIN_NAME})`;
      state.persistent = true;
      return domain;
    } catch (error) {
      domain = null;
      warn('storageDomain 不可用，降级到按会话落盘', error);
      return null;
    }
  }

  function useFileBackend() {
    if (fileBroken) return false;
    if (state.mode !== 'file') {
      state.mode = 'file';
      state.detail = `${saveDir}/<sessionId>.json`;
      state.persistent = true;
    }
    return true;
  }

  return {
    /** 当前后端模式：`domain` | `file` | `memory`。 */
    get mode() {
      return state.mode;
    },
    /** 是否跨进程重启保留。 */
    get persistent() {
      return state.persistent;
    },
    /** 供 UI/工具展示的存储说明。 */
    info() {
      return { mode: state.mode, persistent: state.persistent, detail: state.detail, dir: saveDir };
    },
    /** 读取一份存档（找不到返回 undefined）。 */
    async load(key, cwd) {
      const id = sanitizeSessionId(key);
      if (memory.has(id)) return memory.get(id);
      const active = await ensureDomain();
      if (active !== null) {
        try {
          const value = active.table('games').get(id);
          if (value !== undefined) memory.set(id, value);
          return value;
        } catch (error) {
          warn(`读取 storageDomain 存档 ${id} 失败`, error);
          return undefined;
        }
      }
      if (!useFileBackend()) return undefined;
      try {
        const text = await readFile(fileFor(id, cwd), 'utf8');
        const parsed = JSON.parse(text);
        memory.set(id, parsed);
        return parsed;
      } catch (error) {
        if (error?.code !== 'ENOENT') warn(`读取存档 ${id} 失败`, error);
        return undefined;
      }
    },
    /** 写入一份存档（原子写；失败只降级，不抛给调用方）。 */
    async save(key, cwd, record) {
      const id = sanitizeSessionId(key);
      memory.set(id, record);
      const active = await ensureDomain();
      if (active !== null) {
        try {
          await active.table('games').put(id, record);
          return true;
        } catch (error) {
          warn(`写入 storageDomain 存档 ${id} 失败`, error);
          return false;
        }
      }
      if (!useFileBackend()) return false;
      const target = fileFor(id, cwd);
      const tmp = `${target}.${process.pid}.${(tmpCounter += 1)}.tmp`;
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(tmp, JSON.stringify(record), 'utf8');
        await rename(tmp, target);
        return true;
      } catch (error) {
        warn(`写入存档 ${id} 失败，本局降级为进程内保存`, error);
        fileBroken = true;
        state.mode = 'memory';
        state.persistent = false;
        state.detail = '进程内内存（磁盘写入失败）';
        try {
          await rm(tmp, { force: true });
        } catch {
          /* 清理失败无所谓 */
        }
        return false;
      }
    },
    /** 删除存档（重开一局时用）。 */
    async remove(key, cwd) {
      const id = sanitizeSessionId(key);
      memory.delete(id);
      const active = await ensureDomain();
      if (active !== null) {
        try {
          await active.table('games').delete(id);
        } catch (error) {
          warn(`删除 storageDomain 存档 ${id} 失败`, error);
        }
        return;
      }
      if (fileBroken) return;
      try {
        await rm(fileFor(id, cwd), { force: true });
      } catch (error) {
        warn(`删除存档 ${id} 失败`, error);
      }
    },
    /** 释放 storageDomain 句柄（调用方拥有其生命周期）。 */
    async close() {
      const active = domain;
      domain = null;
      if (active === null || active === undefined) return;
      try {
        await active.close();
      } catch (error) {
        warn('关闭 storageDomain 失败', error);
      }
    },
  };
}

function normalizeDir(value) {
  if (typeof value !== 'string') return DEFAULT_DIR;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.includes('\0')) return DEFAULT_DIR;
  return trimmed;
}
