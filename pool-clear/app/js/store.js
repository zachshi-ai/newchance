/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。场馆档案、水池、检测流水、证照台账
 * 100% 存于浏览器 localStorage；出证走本地生成的单文件 HTML / 纯文本微信转发；
 * 跨设备迁移走「导出 JSON → 导入」。泳客名单、检测读数不出设备。
 */
import { STATE_VERSION, validateLimits, DEFAULT_LIMITS } from './core.js';

const KEY = 'poolclear.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    venue: { name: '', licenseNo: '', licenseExpiry: '', address: '', phone: '' },
    pools: [],     // { id, name, kind, disinfect, note, since(投用日 ISO，用于应检口径), active, createdAt }
    records: [],   // { id, poolId, dateISO, slot, residual, ph?, turbidity?, waterTemp?, opNote, anomaly?{action, closedBy?, closedAt?}, recheckOf?, createdAt }
    certs: [],     // { id, name, role, expiry, note } 从业人员健康合格证明（每年一检）
    reports: [],   // { id, org, reportISO, nextDue, note } 第三方全项检测报告
    settings: {
      limits: DEFAULT_LIMITS, // 国标口径的本地覆盖（属地口径永远赢）
      dailyRequired: 2,       // 每日应检频次（开放前首检 + 开放中抽检，1~4 可调）
      warnDays: 30,           // 证照临期提醒提前天数
    },
    events: [],    // HDD 埋点（本地事件流，用于验证闭环，可导出）
  };
}

export { validateLimits };

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
