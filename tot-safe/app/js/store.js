/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。机构档案、证照钟、人员名册、婴幼儿名册、晨午检卡、
 * 健康事件、安全隐患、送托单、变更台账、周期义务 100% 存于浏览器 localStorage；
 * 出证物走本地生成的单文件 HTML / 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。
 * 幼儿姓名与健康事件属敏感个人信息：不出云、不进埋点（traces 只记动作类型与日期）。
 * emptyState 必须载入全量默认参数（仓库教训：双头定义会让冷启动 settings 为空对象，
 * 参数化键全 undefined → NaN 炸渲染）；loadState/importBundle 对 settings 做显式并集。
 */
import {
  STATE_VERSION, DEFAULT_DOC_WARN_DAYS, DEFAULT_HEALTH_WARN_DAYS,
  DEFAULT_DUTY_WARN_DAYS, DEFAULT_LEASE_WARN_DAYS,
} from './core.js';

const KEY = 'totsafe.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    org: {
      name: '', filedISO: '', uscc: '', nature: '',       // 备案回执日 / 统一社会信用代码 / 机构性质
      meals: false,                                        // 是否自办食堂/供餐（驱动食品证钟与日检条目）
      docs: { fire: '', food: '', lease: '' },             // 三证有效期（消防年度/食品证/租约）
      principal: '', address: '', phone: '', note: '',
    },
    staff: [],         // { id, name, role, qualName, qualValidISO, healthValidISO, criminalDateISO, active, note }
    kids: [],          // { id, name, className, classKind, vaccineOK, entryExamISO, inCare, outISO, backISO, note }
    daychecks: [],     // { id, dateISO, segment: 'morning'|'noon', items: [{key,label,ok,note}], status, note }
    daypasses: [],     // { id, dateISO, carerIds, carerNames, staffNames, note, snapshot }
    healthEvents: [],  // { id, dateISO, source, kidName, symptom, notifyISO, action, returnISO, returnProof, reportable, reportISO, status }
    hazards: [],       // { id, dateISO, source, desc, action, actionISO, verifyISO, verifiedBy, status }
    changes: [],       // { id, dateISO, kind, detail, filedISO, status }
    duties: [],        // { id, kind, lastDoneISO, note }
    settings: {
      docWarnDays: DEFAULT_DOC_WARN_DAYS,          // 机构证照/租约临期提醒（默认 30 天；租约 60）
      healthWarnDays: DEFAULT_HEALTH_WARN_DAYS,    // 健康证临期提醒（默认 45 天，留足年检周期）
      dutyWarnDays: DEFAULT_DUTY_WARN_DAYS,        // 周期义务临期提醒（默认 30 天）
      leaseWarnDays: DEFAULT_LEASE_WARN_DAYS,      // 租约到期提醒（默认 60 天）
    },
    staffSeq: 0,
    kidSeq: 0,
    daycheckSeq: 0,
    daypassSeq: 0,
    healthSeq: 0,
    hazardSeq: 0,
    changeSeq: 0,
    traces: [],      // HDD 埋点（本地事件流，不含幼儿与人员个人信息，用于验证闭环，可导出）
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
