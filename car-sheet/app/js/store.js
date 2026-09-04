/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。车档、披露、整备流水 100% 存于浏览器
 * localStorage；披露单走本地生成的单文件 HTML / 纯文本微信转发；跨设备迁移走
 * 「导出 JSON → 导入」。买家姓名、收车价、毛利不出设备。
 */
import { STATE_VERSION, newDisclosure } from './core.js';

const KEY = 'carsheet.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    dealer: { name: '', phone: '' },
    cars: [],      // { id, plate, vinTail, brand, regYear, displayKm, source, buyCents, buyISO, note, status:'stock'|'sold', disclosure:{9项}, soldISO?, sellCents?, buyer?, sellNote?, createdAt }
    costs: [],     // { id, carId, dateISO, kind, note, cents }（整备流水；毛利永远由流水推导）
    settings: { warnDays: 45, issueDays: 75 }, // 库存黄线/红线（行业先验的本地覆盖）
    events: [],    // HDD 埋点（本地事件流，用于验证闭环，可导出）
  };
}

export { newDisclosure };

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
