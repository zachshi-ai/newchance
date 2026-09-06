/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。网点档案、日落账、拦截、投诉、罚款、销毁、义务
 * 100% 存于浏览器 localStorage；出证物走本地生成的单文件 HTML / 打印 / 文本；跨设备迁移走
 * 「导出 JSON → 导入」。相关人员信息只存本机（建议最小披露：姓氏或尾号）。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'parcelproof.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    station: { name: '', brand: '', manager: '', phone: '', address: '', openedISO: '', filed: false, fileNo: '', filedISO: '' },
    routines: [],    // { id, dateISO, inbound, verifyOk, realnameOk, security: 'done'|'none', note }
    intercepts: [],  // { id, dateISO, person, item, reason, action, note, closedISO, result }
    complaints: [],  // { id, dateISO, customer, channel, matter, note, replyDueISO, replyISO, replyWay, result, late }
    fines: [],       // { id, dateISO, no, amountCents, basis, complaintId, note, appealISO, appealNote, outcome, recoveredCents }
    destroys: [],    // { id, dateISO, way, count, operator, witness, note }
    duties: [],      // { id, kind, lastDoneISO, note }
    settings: { replyDays: 7, destroyDays: 90, gapDays: 7 }, // 法定时限与通识周期的本地覆盖
    routineSeq: 0,
    interceptSeq: 0,
    complaintSeq: 0,
    fineSeq: 0,
    destroySeq: 0,
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
