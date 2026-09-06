/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。门店档案、剧本库、开本台账、周期义务、隐患闭环
 * 100% 存于浏览器 localStorage；出证物走本地生成的单文件 HTML / 打印 / 文本；跨设备迁移
 * 走「导出 JSON → 导入」。玩家信息不采集姓名身份证（只记人数与是否未成年＋核验标记，
 * 本地优先即《个人信息保护法》最小披露的实现方式）。
 */
import { STATE_VERSION, DEFAULT_LIMITS, HOLIDAYS_2026 } from './core.js';

const KEY = 'scenelog.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    venue: {
      name: '', manager: '', phone: '', address: '', area: '',
      jubensha: true, escape: false,
      openedISO: '',                 // 营业日（场所首报 30 日钟锚点）
      filedISO: '', filingNo: '',    // 场所备案日与回执号
      scopeAdjusted: false,          // 经营范围含「剧本娱乐活动」
      fireCheck: '',                 // 消防手续留痕（合格意见书/告知承诺编号）
      setup: {},                     // 选址与设施自查（SETUP_ITEMS id → true）
    },
    scripts: [],      // { id, name, kind, author, ageRange, restrictedScene, useStartISO, filedISO, filingNo, selfReviewedISO, changedAtISO, note }
    sessions: [],     // { id, dateISO, start, scriptId, players, minors, ageChecked, patrol, note }
    checks: [],       // { id, dateISO, findings, fixed, note } 月度全面防火检查
    drills: [],       // { id, dateISO, phase:'day'|'night', note } 半年演练（白天+夜间各一）
    trainings: [],    // { id, dateISO, topic, coverage, note } 年度消防培训
    extinguishers: [],// { id, location, count, nextCheckISO } 灭火器台账
    issues: [],       // { id, dateISO, desc, sev, note, status, closedISO, fix }
    settings: { sampleLoaded: false },
    limits: { ...DEFAULT_LIMITS },
    calendar: {
      year: 2026,
      holidays: [...HOLIDAYS_2026.holidays],
      workdays: [...HOLIDAYS_2026.workdays],
      vacWinter: ['2026-01-15', '2026-02-28'],
      vacSummer: ['2026-07-01', '2026-08-31'],
    },
    scriptSeq: 0,
    sessionSeq: 0,
    checkSeq: 0,
    drillSeq: 0,
    trainSeq: 0,
    extSeq: 0,
    issueSeq: 0,
    events: [],      // HDD 埋点（本地事件流，用于验证闭环，可导出）
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    const base = emptyState();
    const merged = { ...base, ...s };
    merged.limits = { ...base.limits, ...(s.limits || {}) };
    merged.calendar = { ...base.calendar, ...(s.calendar || {}) };
    merged.venue = { ...base.venue, ...(s.venue || {}) };
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
