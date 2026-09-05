/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。厂档、证照、隐患、动火单、培训演练 100% 存于
 * 浏览器 localStorage；迎检包走本地生成的单文件 HTML / 纯文本微信转发；跨设备迁移走
 * 「导出 JSON → 导入」。员工名单、证件号、隐患记录不出设备。
 */
import { STATE_VERSION, DEFAULT_SETTINGS } from './core.js';

const KEY = 'safepatrol.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    org: { name: '', person: '', phone: '', industry: 'other', address: '' },
    staff: [],      // ['张三', ...]（员工名单，培训学时与动火闸机的人名基础）
    licenses: [],   // { id, kind, holderName, certNo, expiryISO, note }（证照档案，证面「有效期至」永远赢）
    hotworks: [],   // { id, dateISO, kind, worker, workerLicenseId, guardian, location, content, measures, status, closedISO?, closedNote?, openedAt }
    hazards: [],    // { id, foundISO, desc, level, area, owner, dueISO, status, source, fixNote?, fixedISO?, recheckNote?, closedISO? }
    checks: [],     // { id, dateISO, items: {key:'ok'|'issue'}, note, createdAt }
    trainings: [],  // { id, dateISO, topic, hours, attendees: [name] }
    drills: [],     // { id, dateISO, type, topic, count }
    settings: { ...DEFAULT_SETTINGS }, // 通识口径默认值，企业可覆盖；属地规则永远赢
    events: [],     // HDD 埋点（本地事件流，用于验证闭环，可导出）
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    // 与 emptyState 做字段并集，向前兼容新增字段；默认参数做浅合并（老备份缺新参数时补默认）
    const merged = { ...emptyState(), ...s, settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) } };
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
