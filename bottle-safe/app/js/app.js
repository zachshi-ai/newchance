/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, addDays, fmtYuan,
  addUser, removeUser, addCylinder, removeCylinder, addWorker, removeWorker,
  recordDelivery, removeDelivery, recordCheck, removeCheck, openRisks,
  slipText, slipHtml, checkLedgerText, deliveryLedgerText, inspectionHtml,
  exportBundle, importBundle,
} from './core.js';
import {
  viewBoard, viewUsers, viewDelivery, viewCheck, viewLedger, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let recheckTarget = null; // 复访模式：指向未闭环隐患单 id
let slipCache = null;     // 最近一次告知单 { checkId, userName, dateISO, verdict, text }

const NAV = [
  ['#/board', '今日'], ['#/delivery', '配送'], ['#/check', '安检'],
  ['#/users', '档案'], ['#/ledger', '台账'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'delivery': html = viewDelivery(state); break;
    case 'check': html = viewCheck(state, recheckTarget); break;
    case 'users': html = viewUsers(state); break;
    case 'ledger': html = viewLedger(state, slipCache); break;
    case 'settings': html = viewSettings(state); break;
    default: html = viewBoard(state);
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
  toast._t = setTimeout(() => { $toast.hidden = true; }, 3600);
}

function commit(trackType, payload) {
  if (trackType) track(state, trackType, payload ?? {});
  saveState(state);
  render();
}

function fail(err) {
  toast(`❌ ${err?.message ?? err}`);
}

function val(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

function intVal(id) {
  const raw = val(id);
  if (raw === '') return NaN;
  return Number(raw);
}

// ---------------------------------------------------------------------------
// 档案动作（站点 / 用户 / 钢瓶 / 员工）
// ---------------------------------------------------------------------------

function saveStation() {
  state.station = { name: val('station-name'), licenseNo: val('station-license'), phone: val('station-phone') };
  commit('save-station');
  toast('已保存');
}

function saveParams() {
  const num = (id, min, max, dflt) => {
    const n = intVal(id);
    return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
  };
  state.settings = {
    annualCheckDays: num('set-annual', 30, 730, 365),
    nearAnnualDays: num('set-nearannual', 7, 180, 30),
    cylinderCycleMonths: num('set-cylcycle', 12, 96, 48),
    cylinderWarnDays: num('set-cylwarn', 15, 365, 90),
    certWarnDays: num('set-cert', 7, 180, 30),
    checkWindowDays: num('set-window', 7, 120, 30),
  };
  commit('save-params');
  toast('参数已保存');
}

function submitUser() {
  const name = val('user-name');
  if (!name) { toast('请填写用户名称'); return; }
  const specs = val('user-specs').split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
  try {
    addUser(state, {
      id: `u-${uid().slice(0, 8)}`,
      name,
      phone: val('user-phone'),
      addr: val('user-addr'),
      specs: specs.length ? specs : ['15kg'],
      note: val('user-note'),
    });
    commit('add-user');
    toast('用户已建档——实名底档配送安检共用');
  } catch (e) {
    fail(e);
  }
}

function delUser(idx) {
  const u = state.users[idx];
  if (!u) return;
  try {
    removeUser(state, u.id);
    commit('del-user');
  } catch (e) {
    fail(e);
  }
}

function submitCylinder() {
  const code = val('cyl-code');
  if (!code) { toast('请填写瓶号（照瓶身钢印抄）'); return; }
  const due = val('cyl-due');
  if (!due) { toast('请填写检验到期日'); return; }
  try {
    addCylinder(state, {
      id: `cyl-${uid().slice(0, 8)}`,
      code,
      spec: document.getElementById('cyl-spec')?.value ?? '15kg',
      checkDueISO: due,
      note: '',
    });
    commit('add-cylinder');
    toast('钢瓶已登记——临期 90 天自动点名');
  } catch (e) {
    fail(e);
  }
}

function submitWorker() {
  const name = val('worker-name');
  if (!name) { toast('请填写员工姓名'); return; }
  const cert = val('worker-cert');
  if (!cert) { toast('请填写证件到期日'); return; }
  try {
    addWorker(state, {
      id: `w-${uid().slice(0, 8)}`,
      name,
      role: val('worker-role'),
      certExpiryISO: cert,
    });
    commit('add-worker');
    toast('员工已建档——到期前 30 天自动点名');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 配送与安检
// ---------------------------------------------------------------------------

function addDelivery() {
  const lines = [];
  // 逐瓶型读取（0 视为未动）
  const readSpec = (spec) => ({
    spec,
    full: Math.trunc(Number(document.querySelector(`.d-full[data-spec="${spec}"]`)?.value ?? 0)) || 0,
    empty: Math.trunc(Number(document.querySelector(`.d-empty[data-spec="${spec}"]`)?.value ?? 0)) || 0,
  });
  for (const spec of ['5kg', '15kg', '50kg']) {
    const ln = readSpec(spec);
    if (ln.full < 0 || ln.empty < 0 || Number.isNaN(ln.full) || Number.isNaN(ln.empty)) {
      toast('瓶数应为非负整数'); return;
    }
    if (ln.full + ln.empty > 0) lines.push(ln);
  }
  const amountYuan = Number(val('d-amount'));
  try {
    const d = recordDelivery(state, {
      id: `d-${uid().slice(0, 8)}`,
      dateISO: val('d-date') || todayISO(),
      userId: document.getElementById('d-user')?.value,
      lines,
      amountCents: Number.isFinite(amountYuan) && amountYuan > 0 ? Math.round(amountYuan * 100) : null,
      note: val('d-note'),
    });
    commit('delivery', { lines: d.lines.length });
    toast('配送已落账——在户瓶数守恒更新');
  } catch (e) {
    fail(e);
  }
}

function undoDelivery(deliveryId) {
  try {
    removeDelivery(state, deliveryId);
    commit('undo-delivery', { deliveryId });
    toast('已撤销，在户瓶数自动回滚');
  } catch (e) {
    fail(e);
  }
}

function addCheck() {
  const items = {};
  for (const select of document.querySelectorAll('.c-item')) {
    items[select.dataset.item] = select.value;
  }
  const dateISO = val('c-date') || todayISO();
  try {
    const c = recordCheck(state, {
      id: `c-${uid().slice(0, 8)}`,
      dateISO,
      userId: document.getElementById('c-user')?.value,
      checker: val('c-checker'),
      items,
      measure: { action: val('c-action'), detail: val('c-detail') },
      recheckOf: recheckTarget,
      note: val('c-note'),
    });
    const wasRecheck = Boolean(recheckTarget);
    recheckTarget = null;
    commit(wasRecheck ? 'recheck' : 'check', { verdict: c.verdict, recheck: wasRecheck });
    toast(c.verdict === 'ok'
      ? (wasRecheck ? '复访合格——原隐患单已销案 ✅' : '安检已落账——台账连上了')
      : '隐患已落账（含整改）——记得复访销案，告知单去「台账」出');
  } catch (e) {
    fail(e);
  }
}

function gotoRecheck(checkId) {
  recheckTarget = checkId;
  location.hash = '#/check';
  render();
}

function undoCheck(checkId) {
  try {
    removeCheck(state, checkId);
    if (recheckTarget === checkId) recheckTarget = null;
    commit('undo-check', { checkId });
    toast('已撤销');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 台账出证（告知单 / 台账文本 / 迎检打印包）
// ---------------------------------------------------------------------------

function generateSlip() {
  const checkId = document.getElementById('slip-check')?.value;
  if (!checkId) { toast('请先选择安检单'); return; }
  const check = state.checks.find((c) => c.id === checkId);
  if (!check) { toast('安检单不存在'); return; }
  const user = state.users.find((u) => u.id === check.userId);
  const text = slipText({ state, checkId, todayISOStr: todayISO() });
  slipCache = { checkId, userName: user?.name ?? '?', dateISO: check.dateISO, verdict: check.verdict, text };
  track(state, 'slip', { verdict: check.verdict });
  commit(null);
  toast(check.verdict === 'risk' ? '隐患告知单已出——打印让用户签字，微信同步发一份' : '安检回执已出');
}

function slipAction(action) {
  if (!slipCache) return;
  track(state, 'slip-export', { action });
  if (action === 'copy') {
    copyText(slipCache.text);
    saveState(state);
    return;
  }
  const html = slipHtml({ state, checkId: slipCache.checkId, todayISOStr: todayISO() });
  if (action === 'download') {
    downloadFile(`安检告知单_${slipCache.userName}_${slipCache.dateISO}.html`, html, 'text/html');
    toast('告知单已下载——打印让用户签字');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function ledgerAction(action) {
  const today = todayISO();
  track(state, 'ledger', { action });
  if (action === 'copy-delivery') {
    copyText(deliveryLedgerText({ state, todayISOStr: today }));
    saveState(state);
  } else if (action === 'copy-check') {
    copyText(checkLedgerText({ state, todayISOStr: today }));
    saveState(state);
  } else {
    const html = inspectionHtml({ state, todayISOStr: today });
    if (action === 'download') {
      downloadFile(`配送安检台账迎检包_${state.station?.name ?? '供应站'}_${today}.html`, html, 'text/html');
      toast('已下载，可打印或微信传给家里电脑打印');
    } else {
      printHtml(html);
    }
    saveState(state);
  }
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
    toast('已复制——去微信粘贴即可');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴即可');
  }
}

// ---------------------------------------------------------------------------
// 数据动作
// ---------------------------------------------------------------------------

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`瓶安单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`瓶安单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      recheckTarget = null;
      slipCache = null;
      commit('import');
      toast('导入成功——接手即盘点');
    };
    reader.readAsText(file);
  }
}

// ---------------------------------------------------------------------------
// 示例数据（30 秒体验完整流程；经 core 函数逐笔落账，守恒与闭环按构造成立）
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  const day = (n) => addDays(today, n);
  state.station = { name: '红旗液化气供应站', licenseNo: '燃（2026）第0101号', phone: '13800006666' };

  state.users = [];
  state.cylinders = [];
  state.workers = [];
  state.deliveries = [];
  state.checks = [];
  state.settings = {};

  const U1 = addUser(state, { id: 'u-wang', name: '王建国', phone: '13700001111', addr: '幸福路 12 号', specs: ['15kg'], note: '家用户' });
  const U2 = addUser(state, { id: 'u-li', name: '李大姐餐馆', phone: '13700002222', addr: '乡政府街 8 号', specs: ['50kg'], note: '以瓶抵款月底结' });
  const U3 = addUser(state, { id: 'u-zhao', name: '赵有福茶馆', phone: '13700003333', addr: '老街 3 号', specs: ['15kg'] });

  addWorker(state, { id: 'w-1', name: '张送气', role: '送气工', certExpiryISO: day(200) });
  addWorker(state, { id: 'w-2', name: '刘安检', role: '安检员', certExpiryISO: day(-5) });

  addCylinder(state, { id: 'cyl-1', code: 'YSP-0088', spec: '15kg', checkDueISO: day(-20), note: '王建国户在用' });
  addCylinder(state, { id: 'cyl-2', code: 'YSP-0102', spec: '50kg', checkDueISO: day(60), note: '李大姐餐馆在用' });

  // 配送流水（守恒：王建国 15kg 在户 1，李大姐 50kg 在户 2，赵茶馆 15kg 在户 1）
  recordDelivery(state, { id: 'd-1', dateISO: day(-2), userId: U1.id, lines: [{ spec: '15kg', full: 2, empty: 2 }], amountCents: 24000 });
  recordDelivery(state, { id: 'd-2', dateISO: day(-2), userId: U2.id, lines: [{ spec: '50kg', full: 2, empty: 0 }], amountCents: 0, note: '以瓶抵款，月底结' });
  recordDelivery(state, { id: 'd-3', dateISO: today, userId: U2.id, lines: [{ spec: '50kg', full: 4, empty: 4 }], amountCents: 88000 });
  recordDelivery(state, { id: 'd-4', dateISO: today, userId: U1.id, lines: [{ spec: '15kg', full: 1, empty: 0 }], amountCents: 12000 });
  recordDelivery(state, { id: 'd-5', dateISO: day(-40), userId: U3.id, lines: [{ spec: '15kg', full: 1, empty: 0 }], amountCents: 12000 });

  // 安检：40 天前王建国软管隐患 → 当日整改复访销案（闭环链演示）
  recordCheck(state, {
    id: 'c-1', dateISO: day(-40), userId: U1.id, checker: '刘安检',
    items: { hose: 'risk', valve: 'ok', cylinder: 'ok', stove: 'ok', vent: 'ok' },
    measure: { action: '限期更换软管', detail: '已发告知单，用户当日自换金属波纹管' },
  });
  recordCheck(state, {
    id: 'c-2', dateISO: day(-40), userId: U1.id, checker: '刘安检',
    items: { hose: 'ok', valve: 'ok', cylinder: 'ok', stove: 'ok', vent: 'ok' },
    recheckOf: 'c-1', note: '整改复访合格',
  });
  // 100 天前李大姐正常（年度期内）；370 天前赵茶馆 → 年度逾期演示
  recordCheck(state, { id: 'c-3', dateISO: day(-100), userId: U2.id, checker: '刘安检', items: { hose: 'ok', valve: 'ok', cylinder: 'ok', stove: 'ok', vent: 'ok' } });
  recordCheck(state, { id: 'c-4', dateISO: day(-370), userId: U3.id, checker: '张送气', items: { hose: 'ok', valve: 'ok', cylinder: 'ok', stove: 'ok', vent: 'ok' } });
  // 今天：李大姐减压阀隐患未闭环（红灯演示）
  recordCheck(state, {
    id: 'c-5', dateISO: today, userId: U2.id, checker: '刘安检',
    items: { hose: 'ok', valve: 'risk', cylinder: 'ok', stove: 'ok', vent: 'ok' },
    measure: { action: '更换减压阀', detail: '已发告知单并签字，约定三日内更换复访' },
  });

  recheckTarget = null;
  slipCache = null;
  commit('seed-demo');
}

// ---------------------------------------------------------------------------
// 事件委托与启动
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, idx } = el.dataset;
  switch (action) {
    case 'save-station': saveStation(); break;
    case 'save-params': saveParams(); break;
    case 'add-user': submitUser(); break;
    case 'del-user': delUser(Number(idx)); break;
    case 'add-cylinder': submitCylinder(); break;
    case 'del-cylinder': removeCylinder(state, state.cylinders[Number(idx)]?.id); commit('del-cylinder'); break;
    case 'add-worker': submitWorker(); break;
    case 'del-worker': removeWorker(state, state.workers[Number(idx)]?.id); commit('del-worker'); break;
    case 'add-delivery': addDelivery(); break;
    case 'undo-delivery': undoDelivery(idx); break;
    case 'add-check': addCheck(); break;
    case 'goto-recheck': gotoRecheck(idx); break;
    case 'undo-check': undoCheck(idx); break;
    case 'slip-generate': generateSlip(); break;
    case 'slip-copy': slipAction('copy'); break;
    case 'slip-download': slipAction('download'); break;
    case 'slip-print': slipAction('print'); break;
    case 'ledger-copy-delivery': ledgerAction('copy-delivery'); break;
    case 'ledger-copy-check': ledgerAction('copy-check'); break;
    case 'inspection-download': ledgerAction('download'); break;
    case 'inspection-print': ledgerAction('print'); break;
    case 'export-json': dataAction('export-json'); break;
    case 'export-events': dataAction('export-events'); break;
    case 'seed-demo': seedDemo(); break;
    default: break;
  }
});

document.addEventListener('change', (ev) => {
  if (ev.target?.id === 'import-file') dataAction('import-json', ev.target.files?.[0]);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 离线增强失败不影响功能 */ });
}

window.addEventListener('hashchange', render);

render();
