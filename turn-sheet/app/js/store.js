/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。房期、布草账、翻房记录 100% 存于浏览器
 * localStorage；翻房单走本地生成的单文件 HTML / 纯文本微信转发；跨设备迁移走
 * 「导出 JSON → 导入」。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'turnsheet.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    host: { name: '', phone: '' },
    properties: [],   // { id, name, beds, towels, cleanMinutes, lockNote }
    stays: [],        // { id, propId, guest, phone, platform, checkin, checkinTime, checkout, checkoutTime, note }
    linenSets: [],    // { id, type, label, status, inProp, sentAt, washes, priceCents, boughtISO, retiredAt }
    linenEvents: [],  // { type, setIds, dateISO, note }（周转账事件流，SLA/报废预算由它推算）
    supplies: [],     // { id, name, stock, minStock }
    turnoverLogs: {}, // key -> { tasks: { taskId: true }, found, doneAt }
    settings: { washSlaDays: 3, ratedWashes: {} }, // 洗涤 SLA 与额定洗涤次数（行业先验的本地覆盖）
    events: [],       // HDD 埋点（本地事件流，用于验证闭环，可导出）
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
