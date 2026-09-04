/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, addDays, weekDatesOf, rangeDates, itemsFor,
  exportBundle, importBundle, ledgerText, ledgerHtml,
  weekReport, monthReport,
} from './core.js';
import {
  viewDashboard, viewLedger, viewReports, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let ledgerRange = null; // 台账页用户选择的区间（跨渲染保留）

const NAV = [
  ['#/dashboard', '今日'], ['#/ledger', '台账'], ['#/reports', '报告'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [path, param] = h.split('/');
  return { path: path || 'dashboard', param };
}

export function render() {
  const { path, param } = parseHash();
  let html = '';
  switch (path) {
    case 'ledger': html = viewLedger(state, ledgerRange ?? undefined); break;
    case 'reports': html = viewReports(state, { tab: param }); break;
    case 'settings': html = viewSettings(state); break;
    default: html = viewDashboard(state);
  }
  $view.innerHTML = html;
  $nav.innerHTML = NAV.map(([hash, label]) =>
    `<a href="${hash}" class="${hash === `#/${path}` ? 'active' : ''}">${label}</a>`).join('');
  window.scrollTo(0, 0);
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { $toast.hidden = true; }, 2400);
}

function commit(trackType, payload) {
  if (trackType) track(state, trackType, payload);
  saveState(state);
  render();
}

// ---------------------------------------------------------------------------
// 打卡动作
// ---------------------------------------------------------------------------

function markItem(itemId, status) {
  const today = todayISO();
  state.checks[today] = state.checks[today] ?? {};
  if (status === 'issue') {
    // 预置 issue 记录并展开说明输入，保存后写入台账
    state.checks[today][itemId] = {
      status: 'issue',
      note: state.checks[today][itemId]?.note ?? '',
      at: new Date().toISOString(),
    };
  } else {
    state.checks[today][itemId] = { status: 'ok', at: new Date().toISOString() };
  }
  commit('check', { itemId, status });
}

function saveIssue(itemId) {
  const today = todayISO();
  const note = document.getElementById(`note-${itemId}`)?.value?.trim() ?? '';
  state.checks[today] = state.checks[today] ?? {};
  const prev = state.checks[today][itemId] ?? { at: new Date().toISOString() };
  state.checks[today][itemId] = { ...prev, status: 'issue', note };
  commit('issue-note', { itemId });
}

// ---------------------------------------------------------------------------
// 文件与剪贴板工具
// ---------------------------------------------------------------------------

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function printHtml(html) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:100%;bottom:100%;width:0;height:0;border:0;';
  iframe.srcdoc = html;
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  };
  document.body.appendChild(iframe);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制到剪贴板');
  }
}

function htmlEscape(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------------------------------------------------------------------------
// 台账 / 报告动作
// ---------------------------------------------------------------------------

function readLedgerInputs() {
  const start = document.getElementById('ledger-start')?.value;
  const end = document.getElementById('ledger-end')?.value;
  if (start && end && end >= start) return { start, end };
  return null;
}

function ledgerAction(action) {
  const range = ledgerRange ?? { start: addDays(todayISO(), -6), end: todayISO() };
  const items = itemsFor(state.store.type, state.customItems);
  const html = ledgerHtml({ store: state.store, items, checks: state.checks, startISO: range.start, endISO: range.end });
  if (action === 'download') {
    downloadFile(`食品安全台账_${state.store.name || '门店'}_${range.start}_${range.end}.html`, html, 'text/html');
    toast('已下载，可直接打印或微信发送');
  } else if (action === 'print') {
    printHtml(html);
  }
  track(state, 'ledger', { action, days: rangeDates(range.start, range.end).length });
  saveState(state);
}

function ledgerCopy() {
  const range = ledgerRange ?? { start: addDays(todayISO(), -6), end: todayISO() };
  const items = itemsFor(state.store.type, state.customItems);
  const text = ledgerText({ store: state.store, items, checks: state.checks, startISO: range.start, endISO: range.end });
  copyText(text);
}

function reportAction(action, tab) {
  const today = todayISO();
  const items = itemsFor(state.store.type, state.customItems);
  const [y, m] = today.split('-').map(Number);
  const common = { store: state.store, items, checks: state.checks, todayISOStr: today };
  const report = tab === 'month'
    ? monthReport({ ...common, year: y, month: m })
    : tab === 'month-prev'
      ? monthReport({ ...common, year: m === 1 ? y - 1 : y, month: m === 1 ? 12 : m - 1 })
      : weekReport({ ...common, weekOfISO: tab === 'week-prev' ? addDays(weekDatesOf(today)[0], -1) : today });

  if (action === 'copy') {
    copyText(report.text);
  } else {
    printHtml(`<pre style="font:13px/1.7 'PingFang SC','Microsoft YaHei',monospace; white-space:pre-wrap; padding:24px;">${htmlEscape(report.text)}</pre>`);
  }
  track(state, 'report', { action, tab });
  saveState(state);
}

// ---------------------------------------------------------------------------
// 设置动作
// ---------------------------------------------------------------------------

function saveStore() {
  const val = (id) => document.getElementById(id)?.value?.trim() ?? '';
  state.store = {
    ...state.store,
    name: val('set-name'),
    type: document.getElementById('set-type')?.value || state.store.type,
    safetyOfficer: val('set-officer'),
    phone: val('set-phone'),
    address: val('set-address'),
  };
  commit('save-store');
  toast('门店档案已保存');
}

function addStaff() {
  const name = document.getElementById('staff-name')?.value?.trim();
  const expiry = document.getElementById('staff-expiry')?.value;
  if (!name || !expiry) { toast('请填写姓名与健康证到期日'); return; }
  state.staff.push({ name, certExpiry: expiry });
  commit('add-staff', { name });
}

function addCustom() {
  const name = document.getElementById('custom-name')?.value?.trim();
  if (!name) { toast('请填写检查项名称'); return; }
  const id = `custom-${uid().slice(0, 8)}`;
  state.customItems.push({ id, name });
  commit('add-custom', { name });
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`食安哨备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`食安哨使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      ledgerRange = null;
      commit('import');
      toast('导入成功');
    };
    reader.readAsText(file);
  }
}

// ---------------------------------------------------------------------------
// 示例数据（30 秒体验完整流程）
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  state.store = {
    name: '示例 · 老王家常菜', type: 'restaurant',
    safetyOfficer: '王建国', phone: '13800001234', address: '示例市示例区幸福路 12 号',
  };
  state.staff = [
    { name: '王建国', certExpiry: addDays(today, 18) },
    { name: '李翠花', certExpiry: addDays(today, 210) },
    { name: '张小厨', certExpiry: addDays(today, -6) },
  ];
  for (const d of rangeDates(addDays(today, -9), today)) {
    state.checks[d] = {};
    for (const it of itemsFor('restaurant', [])) {
      state.checks[d][it.id] = { status: 'ok', at: `${d}T09:30:00.000Z` };
    }
  }
  // 造一点真实感：前天一次异常并已整改；昨天漏检进货查验；今天只打了晨检
  const d2 = addDays(today, -2);
  state.checks[d2].env = { status: 'issue', note: '后厨下水道返味，已加装密封地漏', at: `${d2}T10:00:00.000Z` };
  delete state.checks[addDays(today, -1)].purchase;
  state.checks[today] = { morning: { status: 'ok', at: `${today}T01:20:00.000Z` } };
  ledgerRange = null;
  commit('seed-demo');
}

// ---------------------------------------------------------------------------
// 事件委托与启动
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, item, status, idx } = el.dataset;
  switch (action) {
    case 'mark': markItem(item, status); break;
    case 'save-issue': saveIssue(item); break;
    case 'ledger-apply': {
      const r = readLedgerInputs();
      if (r) ledgerRange = r;
      render();
      break;
    }
    case 'ledger-download': ledgerAction('download'); break;
    case 'ledger-print': ledgerAction('print'); break;
    case 'ledger-copy': ledgerCopy(); break;
    case 'report-copy': reportAction('copy', parseHash().param || 'week'); break;
    case 'report-print': reportAction('print', parseHash().param || 'week'); break;
    case 'save-store': saveStore(); break;
    case 'add-staff': addStaff(); break;
    case 'del-staff': state.staff.splice(Number(idx), 1); commit('del-staff'); break;
    case 'add-custom': addCustom(); break;
    case 'del-custom': state.customItems.splice(Number(idx), 1); commit('del-custom'); break;
    case 'export-json': dataAction('export-json'); break;
    case 'export-events': dataAction('export-events'); break;
    case 'seed-demo': seedDemo(); break;
    default: break;
  }
});

document.addEventListener('change', (ev) => {
  if (ev.target?.id === 'import-file') dataAction('import-json', ev.target.files?.[0]);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target?.id?.startsWith('ledger-')) {
    const r = readLedgerInputs();
    if (r) { ledgerRange = r; render(); }
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 离线增强失败不影响功能 */ });
}

window.addEventListener('hashchange', render);

render();
