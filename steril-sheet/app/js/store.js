/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。锅次、监测、效期、患者标识 100% 存于浏览器
 * localStorage；追溯单与迎检包走本地生成的单文件 HTML / 纯文本；跨设备迁移走
 * 「导出 JSON → 导入」。患者标识只存姓名缩写或病历号（最小披露），不出设备。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'sterilsheet.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    clinic: { name: '', phone: '' },
    machines: [],   // { id, name, code, kind, note }
    packs: [],      // { id, name, items, wrap, shelfDays, active }
    batches: [],    // { id, no, machineId, dateISO, operator, loads:[{packId,qty}], chem, chemNote?, bd, bio, bioISO?, recall?, note, createdAt }
    usages: [],     // { id, packId, qty, patientRef, operator, dateISO, note, alloc:[{batchId,no,qty,expireISO}] }
    treatments: [], // { id, batchId, packId, qty, action:'discard'|'reprocess', note, dateISO }
    staff: [],      // { id, name, certValidUntil }
    wastes: [],     // { id, dateISO, handler, weightKg?, note }
    consumables: [],// { id, name, validUntil }
    settings: {     // 周期参数（以 WS 506 原文 / 属地要求 / 设备说明书为准的本地覆盖）
      bioIntervalDays: 7,
      bioGraceDays: 3,
      wasteIntervalDays: 2,
      expWarnDays: 7,
    },
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
