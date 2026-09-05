/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。出售人实名信息、收购流水、拒收登记、
 * 出货台账 100% 存于浏览器 localStorage——身份证号是站点最敏感的数据，
 * 上云等于把把柄递给别人；登记册、自证单、对账单走本地生成的单文件 HTML /
 * 纯文本微信转发；跨设备迁移走「导出 JSON → 导入」。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'sourcelog.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    station: { name: '', phone: '', lic: '', filedNo: '' }, // 站点：名称/电话/执照号/商务·公安备案号（选填）
    sellers: [], // { id, name, idNo, phone, note, createdAt }——实名底档，最小采集只存本机
    buys: [],    // { id, dateISO, sellerId, cat, desc, weightKg|null, priceCents, proofNote, lowNote, createdAt }
    refuses: [], // { id, dateISO, sellerId|'', sellerName, cat, desc, reason, note, createdAt }
    outs: [],    // { id, dateISO, buyer, cat, weightKg|null, priceCents, createdAt }
    settings: { lowRatio: 50, refPrices: {} }, // 低价阈值与品类参考价（元/kg），行情属地随时波动
    events: [],  // HDD 埋点（本地事件流，用于验证闭环，可导出）
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
