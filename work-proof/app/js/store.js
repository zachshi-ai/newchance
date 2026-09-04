/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。员工与合规数据 100% 存于浏览器 localStorage
 * （用工数据高度敏感，本地优先是隐私卖点而不是妥协），打印单据走本地生成的单文件 HTML；
 * 跨设备迁移走「导出 JSON → 导入」。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'workproof.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    company: { name: '', creditCode: '', owner: '', city: '' },
    employees: [],   // 员工档案（见 docs/13 数据结构）
    license: { name: '', key: '', activatedAt: null }, // 离线授权（免费档 3 人）
    events: [],      // HDD 埋点（本地事件流，用于验证闭环，可导出）
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    // 与 emptyState 做字段并集，向前兼容新增字段
    return { ...emptyState(), ...s };
  } catch {
    return emptyState();
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

/** 本地埋点：HDD/OHELM 验证闭环的数据入口（随状态持久化，可在设置页导出） */
export function track(state, type, payload = {}) {
  state.events.push({ type, at: new Date().toISOString(), ...payload });
  if (state.events.length > 1000) state.events = state.events.slice(-1000);
  return state;
}

export function uid() {
  return (crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}
