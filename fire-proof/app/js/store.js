/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。场所档案、灭火器台账、巡查、防火检查、隐患、培训演练
 * 100% 存于浏览器 localStorage；出证物走本地生成的单文件 HTML / 打印 / 文本；跨设备迁移走
 * 「导出 JSON → 导入」。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'fireproof.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    place: {
      name: '', type: 'other', manager: '', phone: '', address: '', area: '', floors: '',
      openedISO: '', publicPlace: false, mixedWithHome: false, homeSeparated: false, hasSystems: false,
      precheck: { status: 'unset', appliedISO: '', licenseNo: '', licensedISO: '' },
    },
    extinguishers: [],  // { id, no, type, madeISO, location, lastServiceISO, note }
    extChecks: [],      // { id, extId, dateISO, pressure, seal, body, location, note }
    patrols: [],        // { id, dateISO, slot, items:{fire,exit,equip,post}, abnormal, note }
    monthChecks: [],    // { id, dateISO, items:{exit,ext,elec,gas,tri,door,charge,evac}, abnormal, note }
    hazards: [],        // { id, dateISO, source, docNo, location, desc, dueISO, owner, note, closedISO, verifyNote }
    trainings: [],      // { id, dateISO, kind, count, note }
    settings: { gapDays: 2, checkDays: 30, extCheckDays: 0 }, // 0 = 按场所类型自动（人员密集 15 / 其他 30）
    extSeq: 0,
    extCheckSeq: 0,
    patrolSeq: 0,
    monthCheckSeq: 0,
    hazardSeq: 0,
    trainingSeq: 0,
    events: [],         // HDD 埋点（本地事件流，用于验证闭环，可导出）
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    // 与 emptyState 做字段并集，向前兼容新增字段
    const merged = { ...emptyState(), ...s };
    if (!merged.place?.precheck) merged.place = { ...emptyState().place, ...merged.place };
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
