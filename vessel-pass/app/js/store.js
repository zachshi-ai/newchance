/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。船舶档案、四证钟、船员名册、自查卡、开航单、
 * 缺陷闭环、变更台账、周期义务 100% 存于浏览器 localStorage；出证物走本地生成的
 * 单文件 HTML / 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。
 * emptyState 必须载入全量默认参数（仓库教训：双头定义会让冷启动 settings 为空对象，
 * 参数化键全 undefined → NaN 炸渲染）；loadState/importBundle 对 settings 做显式并集。
 */
import {
  STATE_VERSION, DEFAULT_SURVEY_WARN_DAYS, DEFAULT_INSURANCE_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
} from './core.js';

const KEY = 'vesselpass.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    ship: {
      name: '', nationalNo: '', surveyNo: '', kind: '', gt: '',   // 船名/登记号/船检登记号/种类/总吨
      minCrew: 0,                                                  // 配员证书核定最低人数
      captain: '', port: '', route: '', phone: '', note: '',
      docs: { survey: '', national: '', manning: '', insurance: '' },  // 四证有效期（照证书录入）
    },
    crew: [],        // { id, name, role, certNo, certValidISO, birthISO, healthValidISO, active, note }
    selfchecks: [],  // { id, dateISO, items: [{key,label,ok,note}], status, note }
    voyages: [],     // { id, dateISO, crewIds, crewNames, note, snapshot }
    defects: [],     // { id, dateISO, source, desc, action, actionISO, verifyISO, verifiedBy, status }
    changes: [],     // { id, dateISO, kind, detail, filedISO, status }
    duties: [],      // { id, kind, lastDoneISO, note }
    settings: {
      surveyWarnDays: DEFAULT_SURVEY_WARN_DAYS,      // 检验证书临期提醒（默认 60 天）
      insuranceWarnDays: DEFAULT_INSURANCE_WARN_DAYS, // 保险文书临期提醒（默认 30 天）
      dutyWarnDays: DEFAULT_DUTY_WARN_DAYS,           // 周期义务临期提醒（默认 30 天）
    },
    crewSeq: 0,
    selfcheckSeq: 0,
    voyageSeq: 0,
    defectSeq: 0,
    changeSeq: 0,
    traces: [],      // HDD 埋点（本地事件流，用于验证闭环，可导出；与业务台账字段严格分离）
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
