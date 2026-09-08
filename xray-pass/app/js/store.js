/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。机构档案、双证、设备一机一档、人员名册、拍片台账、
 * 事件闭环、变更台账、周期义务 100% 存于浏览器 localStorage；出证物走本地生成的
 * 单文件 HTML / 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。
 * emptyState 必须载入全量默认参数（仓库教训：双头定义会让冷启动 settings 为空对象，
 * 参数化键全 undefined → NaN 炸渲染）；loadState/importBundle 对 settings 做显式并集。
 */
import {
  STATE_VERSION, DEFAULT_RENEW_WARN_DAYS, DEFAULT_DOSE_WARN_DAYS, DEFAULT_CHECK_WARN_DAYS,
} from './core.js';

const KEY = 'xraypass.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    org: {
      name: '', kind: 'dental',
      radSafeNo: '', radSafeExpiryISO: '',
      radLicenseNo: '', radLicenseExpiryISO: '',
      issuer: '', address: '', manager: '', phone: '', note: '',
    },
    devices: [],   // { id, name, code, deviceClass, roomNo, acceptanceISO, statusCheckISO, statusDueISO, siteCheckISO, siteDueISO, outISO, backISO, note }
    workers: [],   // { id, name, certNo, trainingISO, trainingDueISO, doseISO, doseDueISO, lastDoseMsv, active, note }
    shots: [],     // { id, dateISO, deviceId, deviceName, workerId, workerName, patientType, pregnancy, special, bodyPart, note, snapshot }
    incidents: [], // { id, dateISO, source, sourceLabel, desc, action, actionISO, verifyISO, verifiedBy, status }
    changes: [],   // { id, dateISO, kind, detail, filedISO, status }
    duties: [],    // { id, kind, lastDoneISO, note }
    settings: {
      renewWarnDays: DEFAULT_RENEW_WARN_DAYS,  // 证件临期提醒（默认 30=法定届满 30 日延续窗口）
      doseWarnDays: DEFAULT_DOSE_WARN_DAYS,    // 个人剂量临期提醒（默认 15，贴近 30 天一般周期）
      checkWarnDays: DEFAULT_CHECK_WARN_DAYS,  // 设备检测临期提醒（默认 30 天）
    },
    deviceSeq: 0,
    workerSeq: 0,
    shotSeq: 0,
    incidentSeq: 0,
    changeSeq: 0,
    traces: [],    // HDD 埋点（本地事件流，用于验证闭环，可导出；与业务台账字段严格分离）
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
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
