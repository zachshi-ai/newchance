/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。机构档案、能力附表、设备一机一档、人员名册、变更台账、
 * 不符合项闭环、质量记录、报告台账 100% 存于浏览器 localStorage；出证物走本地生成的
 * 单文件 HTML / 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。
 * emptyState 必须载入全量默认参数（仓库教训：双头定义会让冷启动 settings 为空对象，
 * 参数化键全 undefined → NaN 炸渲染）；loadState/importBundle 对 settings 做显式并集。
 */
import {
  STATE_VERSION, DEFAULT_RENEW_WARN_DAYS, CALIB_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
} from './core.js';

const KEY = 'certledger.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    station: {
      name: '', certNo: '', issuer: '', certExpiryISO: '', field: '',
      address: '', manager: '', techLeader: '', qualityLeader: '', phone: '', note: '',
    },
    capabilities: [],  // { id, name, standard, status: active|suspended, suspendedReason, remark }
    equipments: [],    // { id, name, code, capIds, calibType, cycleMonths, lastCalibISO, calibDueISO, outOfServiceISO, backISO, note }
    staff: [],         // { id, name, role, title, idNo, certValidISO, onboardISO, active, note }
    changes: [],       // { id, dateISO, kind, detail, filedISO, status }
    ncs: [],           // { id, dateISO, source, desc, capabilityId, capName, action, actionISO, verifyISO, verifiedBy, status }
    quality: [],       // { id, kind, dateISO, year, title, result, capabilityId, note }
    reports: [],       // { id, reportNo, dateISO, client, paramIds, paramNames, signerId, signerName, signerTitle, cmaMarked, subcontract, note, keepUntil, snapshot, disposedISO, disposedHow }
    duties: [],        // { id, kind, lastDoneISO, note }
    settings: {
      renewWarnDays: DEFAULT_RENEW_WARN_DAYS,  // 证书临期提醒（默认 90=法定届满 3 个月延续窗口）
      calibWarnDays: CALIB_WARN_DAYS,          // 设备溯源临期提醒（默认 45 天）
      dutyWarnDays: DEFAULT_DUTY_WARN_DAYS,    // 年度义务临期提醒（默认 30 天）
    },
    capSeq: 0,
    equipSeq: 0,
    staffSeq: 0,
    changeSeq: 0,
    ncSeq: 0,
    qualitySeq: 0,
    reportSeq: 0,
    traces: [],        // HDD 埋点（本地事件流，用于验证闭环，可导出；与业务台账字段严格分离）
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    // 与 emptyState 做字段并集，向前兼容新增字段；settings 深一层并集，防旧备份缺参数键
    const merged = { ...emptyState(), ...s };
    merged.settings = { ...emptyState().settings, ...(s.settings ?? {}) };
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
  if (!Array.isArray(state.traces)) state.traces = [];
  state.traces.push({ type, at: new Date().toISOString(), ...payload });
  if (state.traces.length > 1000) state.traces = state.traces.slice(-1000);
  return state;
}
