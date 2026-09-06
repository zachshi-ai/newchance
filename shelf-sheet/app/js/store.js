/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。药店档案、药品目录、批次效期、温湿度记录、
 * 拒售登记、隔离与出库、养护、义务 100% 存于浏览器 localStorage；出证物走本地生成的
 * 单文件 HTML / 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。患者与顾客信息只存本机
 * （建议最小披露：姓氏或尾号），处方信息不扫描不留存（处方纸质原件按 84 号令第 42 条保存 5 年）。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'shelfsheet.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    pharmacy: {
      name: '', licenseNo: '', licenseExpiryISO: '', manager: '', phone: '', address: '',
      pharmacistName: '', pharmacistRegNo: '', pharmacistRegExpiryISO: '',
    },
    drugs: [],       // { id, name, spec, storage: 'normal'|'cool'|'cold', approvalNo, manufacturer, note }
    batches: [],     // { id, drugId, batchNo, expiryISO, qty, location, addedISO }
    outs: [],        // { id, batchId, dateISO, qty, way: 'sold'|'quarantine'|'return'|'destroy'|'recall', note }
    quarantines: [], // { id, outId, batchId, drugName, spec, batchNo, expiryISO, qty, dateISO, closedISO, action, note }
    readings: [],    // { id, dateISO, slot: 'am'|'pm', tempC, rhPct, coolTempC, coldTempC, note, flags, exceeded, handled, handledISO, measure }
    refusals: [],    // { id, dateISO, customer, drugName, reason, note }
    cares: [],       // { id, dateISO, found, measure, note }
    duties: [],      // { id, kind, lastDoneISO, note }
    settings: {
      warnDays: 180, redDays: 90, careDays: 30, gapDays: 3,
      rhMin: 35, rhMax: 75, normalMin: 10, normalMax: 30, coolMax: 20, coldMin: 2, coldMax: 8,
    }, // 近效期两道线/养护周期/温湿度限值全部本地可覆盖
    drugSeq: 0,
    batchSeq: 0,
    outSeq: 0,
    quarSeq: 0,
    readingSeq: 0,
    refusalSeq: 0,
    careSeq: 0,
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
