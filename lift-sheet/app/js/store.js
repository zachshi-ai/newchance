/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。电梯档案、维保流水、签字确认、应急记录 100% 存于
 * 浏览器 localStorage；确认单与迎检包走本地生成的单文件 HTML / 纯文本；跨设备迁移走
 * 「导出 JSON → 导入」。使用单位与人员信息不出设备。
 */
import { STATE_VERSION, emptyStateFields } from './core.js';

const KEY = 'liftsheet.v1';

export function emptyState() {
  return emptyStateFields();
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    // 与空状态做字段并集，向前兼容新增字段
    const merged = { ...emptyState(), ...s };
    merged.settings = { ...emptyState().settings, ...(s.settings || {}) };
    merged.settings.cycles = { ...emptyState().settings.cycles, ...(s.settings?.cycles || {}) };
    if (merged.version !== STATE_VERSION) merged.version = STATE_VERSION;
    return merged;
  } catch {
    return emptyState();
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function clearState() {
  localStorage.removeItem(KEY);
}
