/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。车辆、证照、技术档案、动态监控台账 100% 存于
 * 浏览器 localStorage；迎检材料走本地生成的单文件 HTML / 打印；跨设备迁移走
 * 「导出 JSON → 导入」。车牌、驾驶员、费用数据不出设备。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'trucklog.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    fleet: { name: '', phone: '' },
    vehicles: [],   // { id, plate, model, regDateISO, transportCertNo, note }
    drivers: [],    // { id, name, phone, certExpiryISO, assessISO, note }
    certs: [],      // { id, vehicleId, kind: 'review'|'inspection'|'compulsory'|'commercial', expiryISO, note }
    records: [],    // { id, vehicleId, dateISO, odometer, type, title, costCents, vendor, note }
    alerts: [],     // { id, vehicleId, driverId, dateISO, type, detail, handledISO, action, handler }
    settings: { warnDays: 60, alertDays: 7 }, // 预警参数（法定周期的本地覆盖）
    recordSeq: 0,
    alertSeq: 0,
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
