/**
 * store.js — 岗卫账 PostGuard 本地持久化（localStorage，本地优先）
 * 键名带版本号；save 全量覆盖；导出/导入走 core.exportBundle/importBundle。
 */
import { STATE_VERSION, exportBundle, importBundle } from './core.js';

const KEY = `postguard.v${STATE_VERSION}`;

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return importBundle(JSON.parse(raw));
  } catch (err) {
    console.warn('[postguard] 本地数据损坏，已忽略：', err);
    return null;
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(exportBundle(state)));
}

export function clearState() {
  localStorage.removeItem(KEY);
}
