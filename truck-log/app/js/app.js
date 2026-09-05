/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, addDays, addMonths, monthKey,
  certBoard, CERT_KINDS, suggestExpiry,
  addRecord, removeRecord, addAlert, handleAlert, openAlerts,
  monthlyDynSummary, inspectHtml, archiveHtml,
  exportBundle, importBundle,
} from './core.js';
import {
  viewBoard, viewVehicles, viewLedger, viewReports, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let dynMonth = null;   // 动态监控小结用户选择的月份（跨渲染保留）
let dynCache = null;   // 最近一次小结文本

const NAV = [
  ['#/board', '今日'], ['#/vehicles', '车辆'], ['#/ledger', '台账'], ['#/reports', '报表'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'vehicles': html = viewVehicles(state); break;
    case 'ledger': html = viewLedger(state); break;
    case 'reports': html = viewReports(state, dynMonth, dynCache); break;
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
// 车队与车辆
// ---------------------------------------------------------------------------

function saveFleet() {
  state.fleet = { name: val('fleet-name'), phone: val('fleet-phone') };
  commit('save-fleet');
  toast('已保存');
}

function addVehicle() {
  const plate = val('veh-plate');
  const regDateISO = val('veh-reg');
  if (!plate) { toast('请填写车牌号'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(regDateISO)) { toast('请选择注册登记日期'); return; }
  state.vehicles.push({
    id: `v-${uid().slice(0, 8)}`,
    plate,
    model: val('veh-model'),
    regDateISO,
    transportCertNo: val('veh-cert-no'),
    note: val('veh-note'),
  });
  commit('add-vehicle', {});
  toast('车辆已上档——先把四只证照钟补齐');
}

function delVehicle(idx) {
  const v = state.vehicles[idx];
  if (!v) return;
  const hasCerts = (state.certs ?? []).some((c) => c.vehicleId === v.id);
  const hasRecords = (state.records ?? []).some((r) => r.vehicleId === v.id);
  const hasAlerts = (state.alerts ?? []).some((a) => a.vehicleId === v.id);
  if (hasCerts || hasRecords || hasAlerts) {
    toast('该车名下有证照钟或档案记录，不可删除（一车一档账实一致）；先处理其数据');
    return;
  }
  state.vehicles.splice(idx, 1);
  commit('del-vehicle');
}

// ---------------------------------------------------------------------------
// 证照钟与驾驶员
// ---------------------------------------------------------------------------

function addCert() {
  const vehicleId = document.getElementById('cert-vehicle')?.value;
  const kind = document.getElementById('cert-kind')?.value;
  const expiryISO = val('cert-expiry');
  if (!vehicleId || !kind) { toast('请先建车辆'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryISO)) { toast('请选择到期日'); return; }
  const dup = (state.certs ?? []).some((c) => c.vehicleId === vehicleId && c.kind === kind);
  if (dup) { toast('该车已有这只证照钟——请在下方用「办结续期」更新到期日'); return; }
  state.certs.push({ id: `c-${uid().slice(0, 8)}`, vehicleId, kind, expiryISO, note: val('cert-note') });
  commit('add-cert', { kind });
  toast(`${CERT_KINDS[kind]?.label ?? kind}已上钟`);
}

function renewCert(idx) {
  const cert = state.certs[idx];
  if (!cert) return;
  const next = document.querySelector(`.renew-date[data-renew="${cert.id}"]`)?.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next ?? '')) { toast('请填写新到期日'); return; }
  if (next <= cert.expiryISO) { toast('新到期日应晚于当前到期日'); return; }
  cert.expiryISO = next;
  commit('renew-cert', { kind: cert.kind });
  toast('续期已办结，证照钟重新起摆');
}

function addDriver() {
  const name = val('drv-name');
  if (!name) { toast('请填写驾驶员姓名'); return; }
  state.drivers.push({
    id: `d-${uid().slice(0, 8)}`,
    name,
    phone: val('drv-phone'),
    certExpiryISO: val('drv-cert') || null,
    assessISO: val('drv-assess') || null,
    note: '',
  });
  commit('add-driver', {});
  toast('驾驶员已建档');
}

function delDriver(idx) {
  const d = state.drivers[idx];
  if (!d) return;
  if ((state.alerts ?? []).some((a) => a.driverId === d.id)) {
    toast('该驾驶员名下有报警记录，不可删除（台账账实一致）');
    return;
  }
  state.drivers.splice(idx, 1);
  commit('del-driver');
}

// ---------------------------------------------------------------------------
// 技术档案与动态监控
// ---------------------------------------------------------------------------

function saveRecord() {
  const vehicleId = document.getElementById('rec-vehicle')?.value;
  const dateISO = val('rec-date') || todayISO();
  const type = document.getElementById('rec-type')?.value || 'maintain';
  const odoRaw = document.getElementById('rec-odo')?.value;
  const costYuan = Number(document.getElementById('rec-cost')?.value);
  try {
    const rec = addRecord(state, {
      vehicleId,
      dateISO,
      type,
      odometer: odoRaw === '' ? null : Number(odoRaw),
      title: val('rec-title'),
      costCents: Number.isFinite(costYuan) ? Math.round(costYuan * 100) : 0,
      vendor: val('rec-vendor'),
      note: val('rec-note'),
    });
    commit('record', { type: rec.type });
    toast('已记入技术档案');
  } catch (e) {
    fail(e);
  }
}

function saveAlert() {
  const vehicleId = document.getElementById('alr-vehicle')?.value;
  const driverId = document.getElementById('alr-driver')?.value || null;
  const dateISO = val('alr-date') || todayISO();
  const type = document.getElementById('alr-type')?.value || 'other';
  try {
    addAlert(state, { vehicleId, driverId, dateISO, type, detail: val('alr-detail') });
    commit('alert', { type });
    toast('报警已登记——处理完成后记得闭环');
  } catch (e) {
    fail(e);
  }
}

function closeAlert() {
  const alertId = document.getElementById('hd-alert')?.value;
  try {
    handleAlert(state, alertId, {
      handledISO: val('hd-date') || todayISO(),
      action: val('hd-action'),
      handler: val('hd-handler'),
    });
    commit('handle-alert', {});
    toast('已闭环归档——这一条按办法要求至少保存 3 年');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 报表（动态监控小结 / 迎检一页纸 / 一车一档打印）
// ---------------------------------------------------------------------------

function dynApply() {
  dynMonth = document.getElementById('dyn-month')?.value || monthKey(todayISO());
  try {
    dynCache = monthlyDynSummary(state, dynMonth).text;
    commit('dyn-summary', { month: dynMonth });
  } catch (e) {
    fail(e);
  }
}

function dynCopy() {
  const month = document.getElementById('dyn-month')?.value || dynMonth || monthKey(todayISO());
  try {
    const text = monthlyDynSummary(state, month).text;
    copyText(text);
    track(state, 'dyn-copy', { month });
    saveState(state);
  } catch (e) {
    fail(e);
  }
}

function inspectAction(action) {
  const html = inspectHtml(state, todayISO(), state.settings?.warnDays ?? 60);
  track(state, 'inspect', { action });
  if (action === 'download') {
    downloadFile(`车辆合规迎检一页纸_${todayISO()}.html`, html, 'text/html');
    toast('已下载，可打印或转发给安全员');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function archPrint() {
  const vehicleId = document.getElementById('arch-vehicle')?.value;
  if (!vehicleId) { toast('请先建车辆'); return; }
  const v = state.vehicles.find((x) => x.id === vehicleId);
  const html = archiveHtml(state, vehicleId, todayISO());
  track(state, 'archive-print', { vehicleId });
  downloadFile(`车辆技术档案_${v?.plate ?? vehicleId}_${todayISO()}.html`, html, 'text/html');
  toast('一车一档已下载，可直接打印随车');
  saveState(state);
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
    toast('已复制——去微信粘贴给安全员或存档');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴给安全员或存档');
  }
}

// ---------------------------------------------------------------------------
// 设置动作
// ---------------------------------------------------------------------------

function saveSettings() {
  const warn = Number(document.getElementById('set-warn')?.value);
  const alr = Number(document.getElementById('set-alert')?.value);
  state.settings = {
    warnDays: Number.isInteger(warn) && warn >= 7 && warn <= 180 ? warn : 60,
    alertDays: Number.isInteger(alr) && alr >= 1 && alr <= 90 ? alr : 7,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`车轮账备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`车轮账使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      dynMonth = null;
      dynCache = null;
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
  state.fleet = { name: '小满货运部', phone: '13800001234' };
  const v1 = `v-${uid().slice(0, 8)}`; // 冀A·12345 仓栅货车（车龄 80 个月 → 检验周期 12 个月）
  const v2 = `v-${uid().slice(0, 8)}`; // 冀A·67890 牵引车（车龄 150 个月 → 检验周期 6 个月）
  state.vehicles = [
    {
      id: v1, plate: '冀A·12345', model: '仓栅式货车', regDateISO: addMonths(today, -80),
      transportCertNo: '冀交运货13010201', note: '跑京津线建材',
    },
    {
      id: v2, plate: '冀A·67890', model: '半挂牵引车', regDateISO: addMonths(today, -150),
      transportCertNo: '冀交运货13010202', note: '专线：石家庄—济南',
    },
  ];
  const d1 = `d-${uid().slice(0, 8)}`;
  state.drivers = [
    {
      id: d1, name: '张建国', phone: '13911112222',
      certExpiryISO: addDays(today, 45),
      assessISO: addDays(addMonths(today, -12), 40),
      note: '主驾 v1',
    },
  ];
  state.certs = [
    { id: `c-${uid().slice(0, 8)}`, vehicleId: v1, kind: 'review', expiryISO: addDays(today, 15), note: '检测站已预约' },
    { id: `c-${uid().slice(0, 8)}`, vehicleId: v1, kind: 'compulsory', expiryISO: addDays(today, -10), note: '' },
    { id: `c-${uid().slice(0, 8)}`, vehicleId: v1, kind: 'inspection', expiryISO: addDays(today, 200), note: '' },
    { id: `c-${uid().slice(0, 8)}`, vehicleId: v2, kind: 'inspection', expiryISO: addDays(today, 25), note: '' },
    { id: `c-${uid().slice(0, 8)}`, vehicleId: v2, kind: 'review', expiryISO: addDays(today, 300), note: '' },
    { id: `c-${uid().slice(0, 8)}`, vehicleId: v2, kind: 'compulsory', expiryISO: addDays(today, 120), note: '' },
  ];
  // 技术档案：由近到远几笔典型流水
  const R = (vehicleId, daysAgo, type, title, costCents, odometer, vendor = '') => {
    state.recordSeq += 1;
    state.records.push({
      id: `r-${state.recordSeq}`, vehicleId, dateISO: addDays(today, -daysAgo),
      odometer, type, title, costCents, vendor, note: '',
    });
  };
  R(v1, 5, 'repair', '换离合器压盘', 186000, 235600, '宏发修理厂');
  R(v1, 30, 'maintain', '二级维护', 128000, 233200, '宏发修理厂');
  R(v1, 75, 'part', '两只驱动轮轮胎', 320000, 230100, '顺发轮胎');
  R(v1, 150, 'inspect', '综检+技术等级评定', 38000, 226000, '市第一综检站');
  R(v2, 20, 'maintain', '牵引车一级维护', 88000, 512000, '重汽服务站');
  R(v2, 60, 'accident', '倒车剐蹭护栏，私了赔偿', 80000, null, '');
  // 动态监控报警：两条未处理（一条挂账超线）、一条已闭环
  state.alertSeq += 1;
  state.alerts.push({
    id: `a-${state.alertSeq}`, vehicleId: v1, driverId: d1, dateISO: addDays(today, -3),
    type: 'fatigue', detail: '平台提示连续驾驶超 4 小时', handledISO: null, action: '', handler: '',
  });
  state.alertSeq += 1;
  state.alerts.push({
    id: `a-${state.alertSeq}`, vehicleId: v2, driverId: null, dateISO: addDays(today, -10),
    type: 'offline', detail: '终端离线 6 小时', handledISO: null, action: '', handler: '',
  });
  state.alertSeq += 1;
  state.alerts.push({
    id: `a-${state.alertSeq}`, vehicleId: v1, driverId: d1, dateISO: addDays(today, -25),
    type: 'speed', detail: 'G4 京港澳超速 10% 以下', handledISO: addDays(today, -24),
    action: '电话提醒，驾驶员确认减速', handler: '王安全员',
  });
  dynCache = null;
  dynMonth = null;
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
    case 'save-fleet': saveFleet(); break;
    case 'add-vehicle': addVehicle(); break;
    case 'del-vehicle': delVehicle(Number(idx)); break;
    case 'add-cert': addCert(); break;
    case 'renew-cert': renewCert(Number(idx)); break;
    case 'del-cert': state.certs.splice(Number(idx), 1); commit('del-cert'); break;
    case 'add-driver': addDriver(); break;
    case 'del-driver': delDriver(Number(idx)); break;
    case 'add-record': saveRecord(); break;
    case 'del-record': {
      try {
        removeRecord(state, idx);
        commit('del-record');
        toast('已删除该条档案记录');
      } catch (e) { fail(e); }
      break;
    }
    case 'add-alert': saveAlert(); break;
    case 'handle-alert': closeAlert(); break;
    case 'dyn-apply': dynApply(); break;
    case 'dyn-copy': dynCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'arch-print': archPrint(); break;
    case 'save-settings': saveSettings(); break;
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
