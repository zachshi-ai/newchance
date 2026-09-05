/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。老人档案、九防评估、值班巡查、事件闭环、
 * 周期义务 100% 存于浏览器 localStorage；自证包走本地生成的单文件 HTML / 纯文本
 * 微信转发；跨设备迁移走「导出 JSON → 导入」。老人健康与家属信息不出设备——
 * 本地优先在这里不只是架构，更是 66 号令第三十二条个人信息保护义务的实现方式。
 */
import { STATE_VERSION, newRiskBook } from './core.js';

const KEY = 'careledger.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    home: { name: '', phone: '', beds: null }, // 机构信息（印在自证包抬头）
    residents: [],  // { id, name, bed, careLevel, admitISO, familyName, familyPhone, note, status:'in'|'out', outISO?, riskBook:{9项}, assessedISO?, createdAt }
    rounds: [],     // { id, dateISO, shift, staff, majors, todos, status:'ok'|'abnormal', abnormalNote?, nightTimes?, shortNote?, createdAt }（每班一条，打卡即交接）
    incidents: [],  // { id, residentId, residentName, type, dateISO, desc, firstAid, sentToHospital, status:'open'|'closed', familyNotifiedAt?, familyWay?, familyBy?, reviewNote?, closedISO?, createdAt }
    cycles: [],     // { id, kind, owner, dueISO, note, doneISO? }（周期义务账：评估复评/应急演练/员工体检）
    settings: {
      enabledShifts: ['day', 'night'],     // 启用哪些班次（三班制机构加 mid）
      nightMinTimes: 2,                    // 夜班夜间巡查下限（属地口径永远赢）
      soonDays: 30,                        // 周期义务「临期」天数
      cyclePeriods: { assess: 180, drill: 180, health: 365, other: 0 }, // 周期天数（0=一次性）
    },
    events: [],     // HDD 埋点（本地事件流，用于验证闭环，可导出）
  };
}

export { newRiskBook };

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    // 与 emptyState 做字段并集，向前兼容新增字段（settings 深合并一层）
    const merged = { ...emptyState(), ...s };
    merged.settings = { ...emptyState().settings, ...(s.settings ?? {}) };
    merged.settings.cyclePeriods = { ...emptyState().settings.cyclePeriods, ...(s.settings?.cyclePeriods ?? {}) };
    return merged;
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
