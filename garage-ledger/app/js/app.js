/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js?v=2';
import {
  todayISO, addDays, kgToMinor, addRecord, fmtYuan, inspectionText, inspectionHtml,
  exportBundle, importBundle, demoState, AUTO_REPAIR_ITEM_TEMPLATES,
} from './core.js?v=2';
import {
  viewBoard, viewCompliance, viewRevenue, viewInspection, viewSettings,
} from './ui.js?v=2';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let inspCache = null; // 最近一次迎检包文本（跨渲染保留）

const NAV = [
  ['#/board', '台账'], ['#/compliance', '自查'], ['#/revenue', '收益'], ['#/inspection', '迎检包'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  const today = todayISO();
  const year = new URLSearchParams((location.hash.split('?')[1] ?? '')).get('year') ?? today.slice(0, 4);
  let html = '';
  switch (path) {
    case 'compliance': html = viewCompliance(state, today); break;
    case 'revenue': html = viewRevenue(state, year); break;
    case 'inspection': html = viewInspection(state, today, inspCache); break;
    case 'settings': html = viewSettings(state); break;
    default: html = viewBoard(state, today);
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
  toast._t = setTimeout(() => { $toast.hidden = true; }, 3200);
}

function commit(trackType, payload) {
  if (trackType) track(state, trackType, payload);
  saveState(state);
  render();
}

function fail(err) {
  toast(`❌ ${err?.message ?? err}`);
}

function val(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// 记账（入库 / 出库 / 冲销 / 补联单）
// ---------------------------------------------------------------------------

function saveRecord() {
  try {
    const type = val('rec-type');
    const itemId = val('rec-item');
    if (!itemId) return fail(new Error('先在「设置 · 危废品目」添加品目'));
    const dateISO = val('rec-date') || todayISO();
    const item = state.items.find((x) => x.id === itemId);
    const q = item?.unit === 'unit'
      ? (() => { const n = Number(val('rec-qty')); if (!Number.isInteger(n) || n <= 0) throw new Error('件数必须为正整数'); return n; })()
      : kgToMinor(val('rec-qty'));
    const rec = { id: uid(), type, itemId, dateISO, qtyMinor: q, note: val('rec-note') };
    if (type === 'out') {
      rec.vendorId = val('rec-vendor');
      if (!rec.vendorId) return fail(new Error('出库必须选择接收方（固废法第 80 条：禁止交给无证单位）'));
      rec.manifestNo = val('rec-manifest');
      const yuan = Number(val('rec-amount'));
      rec.amountFen = Number.isFinite(yuan) && yuan > 0 ? Math.round(yuan * 100) : 0;
    }
    addRecord(state, rec);
    commit('record', { type });
    toast(type === 'in' ? '✓ 入库已落账' : '✓ 出库已落账' + (rec.amountFen ? `，${fmtYuan(rec.amountFen)} 记入收益账` : ''));
  } catch (err) { fail(err); }
}

function revokeRecord(id) {
  try {
    addRecord(state, { id: uid(), type: 'rev', refId: id, todayISOStr: todayISO() });
    commit('revoke', { id });
    toast('✓ 已红字冲销（原记录保留留痕）');
  } catch (err) { fail(err); }
}

function fillManifest(id) {
  const no = document.getElementById(`mf-${id}`)?.value?.trim() ?? '';
  if (!no) return fail(new Error('请先填写联单号（向接收方索取）'));
  const rec = state.records.find((r) => r.id === id);
  if (!rec) return;
  rec.manifestNo = no;
  commit('fill-manifest', { id });
  toast('✓ 联单号已补录');
}

// ---------------------------------------------------------------------------
// 自查（打卡 / 接收方）
// ---------------------------------------------------------------------------

function savePlan() {
  const dateISO = val('plan-date') || todayISO();
  state.checkins.push({ id: uid(), dateISO, kind: 'plan', forYear: dateISO.slice(0, 4), note: '' });
  commit('plan-filed', { year: dateISO.slice(0, 4) });
  toast('✓ 已登记年度管理计划备案');
}

function storageCheck() {
  state.checkins.push({ id: uid(), dateISO: todayISO(), kind: 'storage', note: '' });
  commit('storage-check');
  toast('✓ 已记录今日贮存区巡查');
}

function addVendor() {
  const name = val('v-name');
  if (!name) return fail(new Error('请填写接收方名称'));
  state.vendors.push({
    id: uid(), name, licenseNo: val('v-license'),
    licenseExpiryISO: val('v-expiry') || null, phone: val('v-phone'),
  });
  commit('vendor-add');
  toast('✓ 接收方已登记');
}

function delVendor(id) {
  if ((state.records ?? []).some((r) => r.vendorId === id)) {
    return fail(new Error('该接收方已有出库记录，为保证台账完整不可删除'));
  }
  state.vendors = state.vendors.filter((v) => v.id !== id);
  commit('vendor-del');
}

// ---------------------------------------------------------------------------
// 收益 / 迎检包
// ---------------------------------------------------------------------------

function genText() {
  inspCache = { text: inspectionText({ state }) };
  track(state, 'inspection-text');
  saveState(state);
  render();
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function downloadHtml() {
  const html = inspectionHtml({ state });
  track(state, 'inspection-html');
  saveState(state);
  download(`危废台账-迎检包-${todayISO()}.html`, html, 'text/html;charset=utf-8');
  toast('✓ 打印版已下载（单文件、离线可用）');
}

function printHtml() {
  track(state, 'inspection-print');
  saveState(state);
  const w = window.open('', '_blank');
  if (!w) return fail(new Error('浏览器拦截了弹窗——请允许弹窗后重试，或用「下载打印版」'));
  w.document.write(inspectionHtml({ state }));
  w.document.close();
  setTimeout(() => w.print(), 300);
}

async function copyText() {
  const text = document.getElementById('insp-out')?.value ?? '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast('✓ 已复制，去微信粘贴发送');
  } catch {
    document.getElementById('insp-out').select();
    toast('已全选，请手动复制');
  }
}

// ---------------------------------------------------------------------------
// 设置（档案 / 品目 / 参数 / 数据）
// ---------------------------------------------------------------------------

function saveOrg() {
  state.org = { name: val('org-name'), phone: val('org-phone'), address: val('org-address') };
  commit('save-org');
  toast('已保存');
}

function addTemplates() {
  const existing = new Set((state.items ?? []).map((x) => x.code));
  let added = 0;
  for (const t of AUTO_REPAIR_ITEM_TEMPLATES) {
    if (existing.has(t.code)) continue;
    state.items.push({ id: uid(), ...t });
    added += 1;
  }
  commit('items-template');
  toast(added ? `✓ 已添加 ${added} 个汽修常见品目（代码可编辑）` : '模板品目均已存在');
}

function addItem() {
  const name = val('it-name');
  const code = val('it-code');
  if (!name || !code) return fail(new Error('品目名称与废物代码必填'));
  const unit = val('it-unit') || 'kg';
  const capRaw = Number(val('it-cap'));
  state.items.push({
    id: uid(), name, code, unit,
    capacityMinor: Number.isFinite(capRaw) && capRaw > 0 ? (unit === 'kg' ? Math.round(capRaw * 10) : Math.round(capRaw)) : 0,
    note: '',
  });
  commit('item-add');
  toast('✓ 品目已添加');
}

function delItem(id) {
  state.items = state.items.filter((x) => x.id !== id);
  commit('item-del');
}

function saveSettings() {
  const num = (id, fallback) => {
    const n = Number(val(id));
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  state.settings = {
    storageLimitDays: num('set-limit', 365),
    storageWarnDays: num('set-warn', 30),
    licenseWarnDays: num('set-lic', 30),
    staleDays: num('set-stale', 60),
  };
  commit('save-settings');
  toast('已保存（属地口径覆盖生效）');
}

function exportData() {
  download(`危废账-备份-${todayISO()}.json`, exportBundle(state), 'application/json');
  toast('✓ 已导出 JSON 归档');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const res = importBundle(String(reader.result ?? ''));
    if (!res.ok) return fail(new Error(res.error));
    state = { ...emptyState(), ...res.state };
    commit('data-import');
    toast('✓ 导入成功');
  };
  reader.readAsText(file);
}

function loadDemo() {
  if (state.records.length > 0 && !confirm('载入示例数据会覆盖当前数据，确定继续？')) return;
  state = { ...emptyState(), ...demoState(todayISO()) };
  commit('demo-load');
  toast('✓ 示例数据已载入（含临期/待补联单等演示场景）');
}

function clearAll() {
  if (!confirm('确定清空全部数据？此操作不可恢复（建议先导出 JSON 归档）。')) return;
  state = emptyState();
  commit('data-clear');
  toast('已清空');
}

// ---------------------------------------------------------------------------
// 事件委托与启动
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  const map = {
    'rec-save': saveRecord,
    'plan-save': savePlan,
    'storage-check': storageCheck,
    'v-add': addVendor,
    'insp-text': genText,
    'insp-html': downloadHtml,
    'insp-print': printHtml,
    'insp-copy': copyText,
    'org-save': saveOrg,
    'tpl-add': addTemplates,
    'it-add': addItem,
    'set-save': saveSettings,
    'data-export': exportData,
    'demo-load': loadDemo,
    'data-clear': clearAll,
  };
  if (btn.id && map[btn.id]) return map[btn.id]();
  if (btn.dataset?.act === 'revoke') return revokeRecord(btn.dataset.id);
  if (btn.dataset?.act === 'fill-manifest') return fillManifest(btn.dataset.id);
  if (btn.dataset?.act === 'del-vendor') return delVendor(btn.dataset.id);
  if (btn.dataset?.act === 'del-item') return delItem(btn.dataset.id);
});

document.addEventListener('change', (ev) => {
  const id = ev.target?.id ?? '';
  if (id === 'rec-type') {
    const isOut = ev.target.value === 'out';
    for (const wid of ['rec-vendor-wrap', 'rec-manifest-wrap', 'rec-amount-wrap']) {
      document.getElementById(wid).hidden = !isOut;
    }
  }
  if (id === 'data-import' && ev.target.files?.[0]) importData(ev.target.files[0]);
  if (id === 'rev-year') {
    location.hash = `#/revenue?year=${ev.target.value}`;
  }
  if (id === 'rec-item') {
    const item = state.items.find((x) => x.id === ev.target.value);
    const qty = document.getElementById('rec-qty');
    if (item) qty.placeholder = item.unit === 'kg' ? 'kg（如 12.5）' : '件数';
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ['rec-qty', 'rec-note'].includes(ev.target?.id)) saveRecord();
});

window.addEventListener('hashchange', render);
render();
