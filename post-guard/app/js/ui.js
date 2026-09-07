/**
 * ui.js — 岗卫账 PostGuard 渲染辅助（纯字符串组件，无副作用）
 */
import { escapeHtml, FACTORS, fmtYuan, daysUntil, addDays } from './core.js';

export const esc = escapeHtml;

/** 钟况徽章：level ∈ green/amber/red/none/ok */
export function badge(level, text) {
  return `<span class="badge ${esc(level)}">${esc(text)}</span>`;
}

export function clockBadge(state, texts = {}) {
  const map = {
    green: texts.green || '🟢 正常',
    amber: texts.amber || '🟡 临期',
    red: texts.red || '🔴 逾期',
    none: texts.none || '⚪ 无需',
    ok: texts.ok || '✅ 已闭环',
    pending: texts.pending || '⏳ 未到窗',
    blocked: texts.blocked || '⛔ 红线',
  };
  return `<span class="badge ${esc(state)}">${esc(map[state] || state)}</span>`;
}

/** 剩余天数 → 用户可见文案（负数一律转「已逾期 N 天」，绝不出现「-N 天」） */
export function daysText(daysLeft) {
  if (daysLeft == null) return '—';
  if (daysLeft < 0) return `已逾期 ${-daysLeft} 天`;
  if (daysLeft === 0) return '今日到期';
  return `剩 ${daysLeft} 天`;
}

/** 因素标签组 */
export function factorTags(factorIds) {
  if (!factorIds || factorIds.length === 0) return '<span class="muted">未登记</span>';
  return factorIds.map((f) => `<span class="kbd">${esc(FACTORS[f]?.label || f)}</span>`).join(' ');
}

/** 金额（分）展示 */
export function yuan(cents) {
  return Number.isInteger(cents) ? esc(fmtYuan(cents)) : '—';
}

/** 表单字段（field 容器） */
export function field(label, inputHtml, wide = false) {
  return `<div class="field${wide ? ' field-wide' : ''}"><label>${esc(label)}</label>${inputHtml}</div>`;
}

/** 距离今天 N 天的提示（用于合规页头） */
export function relativeHint(iso, todayISOStr) {
  if (!iso) return '';
  const d = daysUntil(iso, todayISOStr);
  return d < 0 ? `已逾期 ${-d} 天` : d === 0 ? '今天' : `剩 ${d} 天`;
}

export { addDays };
