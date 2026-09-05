/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。用户底档、瓶账、安检台账 100% 存于浏览器
 * localStorage；告知单与台账走本地生成的单文件 HTML / 纯文本微信转发；跨设备
 * 迁移与网点交接走「导出 JSON → 导入」。用户底档与瓶账不出设备。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'bottlesafe.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    station: { name: '', licenseNo: '', phone: '' },  // 燃气经营许可证号印在告知单与台账上
    users: [],      // { id, name, phone, addr, specs:['15kg',...], note }
    cylinders: [],  // { id, code, spec, checkDueISO, note }
    workers: [],    // { id, name, role, certExpiryISO }
    deliveries: [], // { id, dateISO, userId, lines:[{spec, full, empty}], amountCents, note }
    checks: [],     // { id, dateISO, userId, items:{hose,valve,cylinder,stove,vent}, riskItems, verdict:'ok'|'risk', checker, note, measure:{action,detail}|null, recheckOf|null }
    settings: {},   // 周期参数（空 = core 默认口径）
    events: [],     // HDD 埋点（本地事件流，用于验证闭环，可导出）
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
