/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。单位档案、一机一档、操控员、航前放行、
 * 飞行日志、申请批复、检修单、周期义务 100% 存于浏览器 localStorage；出证物走
 * 本地生成的单文件 HTML / 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。
 *
 * 数据最小披露：飞行日志只存任务地点与人数/收入，不存客户身份信息；
 * 操控员只存姓名与尾号级联系方式——全部只存本机。
 */
import { STATE_VERSION, DEFAULT_SETTINGS } from './core.js';

const KEY = 'wingsheet.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    org: {
      name: '', orgMode: 'personal', kind: '', district: '', manager: '', phone: '',
      opCertNumber: '', opCertIssueISO: '', note: '',
    },
    uas: [],      // { id, nickname, model, sn, emptyKg, mtowKg, agri, agriTrueHeightM, agriSpeedKmh, agriRadiusM, legacyNoRemoteId, regNo, registeredISO, markAffixed, insuranceExpiryISO, status, note }
    pilots: [],   // { id, name, phone, licenseIssueISO, lastProfCheckISO, ifrLarge, agriCertISO, status, note }
    flights: [],  // 飞行架次（见 core.startFlight）
    permits: [],  // { id, uasId, pilotId, flyingDateISO, reason, location, note, submittedISO, decidedISO, approved, permitNo, preDepISO, status }
    issues: [],   // { id, uasId, flightId, dateISO, item, measure, deadlineISO, closedISO, closeNote, status, note }
    duties: [],   // { id, kind, lastDoneISO, note }
    settings: { ...DEFAULT_SETTINGS }, // 全量默认参数；loadState/importBundle 再做局部覆盖合并
    seq: { uas: 0, pilot: 0, flight: 0, permit: 0, issue: 0, duty: 0 },
    events: [],   // HDD 埋点（本地事件流，用于验证闭环，可导出）
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    const merged = { ...emptyState(), ...s };
    merged.settings = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
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
