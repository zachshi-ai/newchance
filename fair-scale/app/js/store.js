/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。一秤一档、公平秤日检、巡查、红黄牌、
 * 投诉先行赔偿追偿、周期义务 100% 存于浏览器 localStorage；出证物走本地生成的
 * 单文件 HTML / 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。
 *
 * 数据最小披露：不存消费者身份信息（投诉只存摊位与商品）；经营者只存摊位号与
 * 姓名或称呼——全部只存本机。
 */
import { STATE_VERSION } from './core.js';

const KEY = 'fairscale.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    org: { name: '', district: '', manager: '', phone: '', note: '' },
    scales: [],
    changes: [],
    fairLogs: [],
    patrols: [],
    cards: [],
    complaints: [],
    duties: [],
    settings: {},
    seq: { scale: 0, change: 0, fair: 0, patrol: 0, card: 0, complaint: 0, duty: 0 },
    events: [],
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
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
