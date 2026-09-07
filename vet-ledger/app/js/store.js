/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。机构档案、人员名册、诊疗台账、兽药批次、冷链、
 * 医废、事件 100% 存于浏览器 localStorage；出证物走本地生成的单文件 HTML / 打印 / 文本；
 * 跨设备迁移走「导出 JSON → 导入」。宠主信息只存本机（建议最小披露：姓氏或尾号）。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'vetledger.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    station: {
      name: '', certNo: '', scope: '', org: '', issuedISO: '',
      manager: '', phone: '', address: '',
      posted: false,            // 办法 2022-5 号第 17 条：悬挂许可证+公示从业人员
      nameChangedISO: '',       // 市场主体变更登记日（第 14 条变更钟起点）
      changeFiledISO: '',       // 向原发证机关办妥变更手续的日期
    },
    staffs: [],       // { id, name, type: vet|assistant|rural, certNo, sinceISO, active, note }
    visits: [],       // { id, dateISO, owner, animal, pet?, complaint, diagnosis, doctorId, doctorName, doctorType, rxRequired, rxItems, rxNo, note }
    drugs: [],        // { id, dateISO, kind: drug|vaccine, name, manufacturer, batchNo, expiryISO, qty, isRx, supplier, frozen, frozenNote, note }
    coldchains: [],   // { id, dateISO, slot: am|pm, tempC, minC, maxC, excursion, note }
    rabiesLog: [],    // { id, dateISO, pet, species, owner, vaccineBatchId, vaccineName, batchNo, certNo, doctorId, doctorName, note }
    wastes: [],       // { id, dateISO, kind, qty, way, receiver, ticketNo, movedISO, note }
    events: [],       // { id, dateISO, kind: adverse|epidemic, subject, severity, reportedISO, late, note }
    duties: [],       // { id, kind, lastDoneISO, note }
    annualReports: [],// { year, filedISO, no }
    settings: {
      coldMinC: 2, coldMaxC: 8,
      wasteMoveDays: 2, gapDays: 7,
    },
    staffSeq: 0,
    visitSeq: 0,
    drugSeq: 0,
    coldchainSeq: 0,
    rabiesSeq: 0,
    wasteSeq: 0,
    eventSeq: 0,
    traces: [],       // HDD 埋点（本地事件流，用于验证闭环，可导出；注意与业务侧 state.events 事件台账区分）
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
  if (!Array.isArray(state.traces)) state.traces = [];
  state.traces.push({ type, at: new Date().toISOString(), ...payload });
  if (state.traces.length > 1000) state.traces = state.traces.slice(-1000);
  return state;
}

export function uid() {
  return (crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}
