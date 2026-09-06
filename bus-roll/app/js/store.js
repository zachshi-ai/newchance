/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。单位档案、一车一档、驾驶人/照管员、趟次点名、
 * 隐患闭环、周期义务 100% 存于浏览器 localStorage；出证物走本地生成的单文件 HTML /
 * 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。
 *
 * 未成年人信息最小披露：趟次只记人数，不记学生姓名与名单；驾驶人/照管员只存姓名与
 * 尾号级联系信息，全部只存本机——这与条例第39条「清点/核实人数」的义务颗粒度一致，
 * 没有任何法定义务要求留存学生个人信息。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'busroll.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    org: {
      name: '', kind: '', district: '', manager: '', phone: '', address: '',
      safetyOfficer: '', bookFileDateISO: '', note: '',
    },
    buses: [],     // { id, plate, model, seats, plateNo, plateExpiryISO, usePermitDateISO, inspectionLastISO, insuranceCvtExpiryISO, insuranceCarrierExpiryISO, status, note }
    drivers: [],   // { id, name, licenseClass, birthdayISO, qualificationDateISO, auditLastISO, phone, status, note }
    escorts: [],   // { id, name, phone, status, note }
    trips: [],     // 趟次点名（见 core.startTrip）
    hazards: [],   // { id, busId, tripId, dateISO, item, measure, deadlineISO, closedISO, closeNote, status, note }
    duties: [],    // { id, kind, lastDoneISO, note }
    settings: {},  // 与 core.DEFAULT_SETTINGS 并集（本地可覆盖）
    seq: { bus: 0, driver: 0, escort: 0, trip: 0, hazard: 0, duty: 0 },
    events: [],    // HDD 埋点（本地事件流，用于验证闭环，可导出）
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
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
