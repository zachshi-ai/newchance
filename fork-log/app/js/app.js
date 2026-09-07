/**
 * app.js — 路由、状态变更、事件委托、弹窗、示例数据与启动
 * 约定：本文件内的事件处理函数一律以 submit/show/toggle/delete/file 前缀命名，
 * 避免与 core.js 导入同名而整模块白屏（仓库历史教训）。
 */
import {
  loadState, saveState, track, emptyState,
} from './store.js';
import {
  todayISO, monthKey,
  addVehicle, recordInspection, markModified, scrapVehicle,
  addDriver, setDriverActive, activeDrivers,
  addPatrol, removePatrol, patrolToday,
  addWeekly, addMonthly,
  addHazard, fixHazard, closeHazard,
  addWorkOrder, removeWorkOrder, dispatchGate,
  setDutyDone,
  monthlySummary, inspectHtml, dispatchHtml,
  exportBundle, importBundle,
  DEFAULT_APPLY_ADVANCE_DAYS, DEFAULT_REEXAM_WARN_DAYS, DEFAULT_PATROL_GAP_DAYS,
} from './core.js';
import {
  viewBoard, viewStation, viewLedger, viewReports, viewSettings, ICONS,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const $modalHost = document.getElementById('modal-host');

let state = loadState();
let repMonth = null;   // 月度小结用户选择的月份（跨渲染保留）
let repCache = null;   // 最近一次小结文本

const NAV = [
  ['#/board', '今日', 'board'], ['#/station', '建档', 'station'], ['#/ledger', '台账', 'ledger'], ['#/reports', '报表', 'reports'], ['#/settings', '设置', 'settings'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'station': html = viewStation(state); break;
    case 'ledger': html = viewLedger(state); break;
    case 'reports': html = viewReports(state, repMonth, repCache); break;
    case 'settings': html = viewSettings(state); break;
    default: html = viewBoard(state);
  }
  $view.innerHTML = html;
  $nav.innerHTML = NAV.map(([hash, label, ic]) =>
    `<a href="${hash}" class="${hash === `#/${path}` ? 'active' : ''}">${ICONS[ic] ?? ''}<span>${label}</span></a>`).join('');
  window.scrollTo(0, 0);
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { $toast.hidden = true; }, 4200);
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

function checked(id) {
  return document.getElementById(id)?.value === 'yes';
}

// ---------------------------------------------------------------------------
// 弹窗（定检合格 / 改造 / 报废 / 隐患整改 / 复查销案）
// ---------------------------------------------------------------------------

function openModal(title, bodyHtml) {
  $modalHost.innerHTML = `
  <div class="modal-mask" data-action="close-modal">
    <div class="modal" data-stop="1">
      <h3>${title}</h3>
      ${bodyHtml}
      <div class="row"><button class="btn" data-action="__confirm__">确认</button>
      <button class="btn ghost" data-action="close-modal">取消</button></div>
    </div>
  </div>`;
  $modalHost.querySelector('.modal-mask')?.addEventListener('click', (ev) => {
    if (ev.target.dataset?.action === 'close-modal') closeModal();
  });
}

function closeModal() {
  $modalHost.innerHTML = '';
}

function modalVal(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// 建档（单位 / 车辆 / 司机 / 义务）
// ---------------------------------------------------------------------------

function submitStation() {
  const name = val('st-name');
  if (!name) { toast('请填写单位名称'); return; }
  state.station = {
    ...state.station,
    name,
    manager: val('st-manager'),
    phone: val('st-phone'),
    address: val('st-address'),
    directorName: val('st-director'),
    directorPhone: val('st-director-phone'),
    officerName: val('st-officer'),
    officerPhone: val('st-officer-phone'),
    note: val('st-note'),
  };
  commit('save-station');
  toast('单位信息已保存——两员配备是 74 号令第一道硬要求');
}

function submitVehicle() {
  try {
    addVehicle(state, {
      plateNo: val('vh-plate'),
      kind: document.getElementById('vh-kind')?.value || 'forklift',
      brand: val('vh-brand'),
      regNo: val('vh-regno'),
      firstUseISO: val('vh-firstuse'),
      lastInspectISO: val('vh-lastinspect'),
      keeperName: val('vh-keeper'),
      monitor: checked('vh-monitor'),
      ownerType: document.getElementById('vh-owner')?.value || 'own',
      note: val('vh-note'),
    });
    commit('add-vehicle', {});
    toast('已建档——定检钟按叉车 2 年/观光车 1 年自动推导');
  } catch (e) { fail(e); }
}

function deleteVehicle(id) {
  try {
    const rec = (state.vehicles ?? []).find((v) => v.id === id);
    state.vehicles = state.vehicles.filter((v) => v.id !== id);
    commit('del-vehicle');
    toast(`已删除 ${rec?.plateNo ?? id} 的档案`);
  } catch (e) { fail(e); }
}

function showInspectPass(id) {
  const v = (state.vehicles ?? []).find((x) => x.id === id);
  if (!v) return;
  openModal(`定检合格 · ${v.plateNo}`, `
    <p class="fine" style="margin-top:0">录入本次检验合格日期，定检钟自动滚动（叉车 +24 个月 / 观光车 +12 个月，精确到月）。</p>
    <div class="form-grid">
      <label>本次检验合格日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">备注<input id="m-note" placeholder="检验报告编号/检验机构（可空）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      recordInspection(state, id, modalVal('m-date') || todayISO(), modalVal('m-note'));
      closeModal();
      commit('inspect-pass', {});
      toast('定检已录——下次到期日已按周期推导');
    } catch (e) { fail(e); }
  };
}

function showModify(id) {
  const v = (state.vehicles ?? []).find((x) => x.id === id);
  if (!v) return;
  openModal(`改造/重大修理 · ${v.plateNo}`, `
    <p class="fine" style="margin-top:0">特设法第 47 条：改造、修理按规定需要变更使用登记的，应当办理变更登记，方可继续使用——办妥前派工闸不放行。</p>
    <div class="form-grid">
      <label>改造/修理日期 *<input id="m-date" type="date" value="${todayISO()}" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      markModified(state, id, modalVal('m-date') || todayISO());
      closeModal();
      commit('mark-modified', {});
      toast('已登记改造——变更登记办妥前该车不得派工');
    } catch (e) { fail(e); }
  };
}

function showScrap(id) {
  const v = (state.vehicles ?? []).find((x) => x.id === id);
  if (!v) return;
  openModal(`报废登记 · ${v.plateNo}`, `
    <p class="fine" style="margin-top:0">特设法第 48 条：履行报废义务、采取必要措施消除使用功能，并向原登记部门办理使用登记证书注销——应报废未报废未注销罚 3 万~30 万（第 84 条(三)）。</p>
    <div class="form-grid">
      <label>报废日期 *<input id="m-date" type="date" value="${todayISO()}" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      scrapVehicle(state, id, modalVal('m-date') || todayISO());
      closeModal();
      commit('scrap-vehicle', {});
      toast('已登记报废——记得向原登记部门办注销并在台账补录日期');
    } catch (e) { fail(e); }
  };
}

function submitDriver() {
  try {
    addDriver(state, {
      name: val('dr-name'),
      certNo: val('dr-certno'),
      expiryISO: val('dr-expiry'),
      phone: val('dr-phone'),
      note: val('dr-note'),
    });
    commit('add-driver', {});
    toast('已入册——派工闸从名册取人');
  } catch (e) { fail(e); }
}

function toggleDriver(id) {
  try {
    const rec = (state.drivers ?? []).find((d) => d.id === id);
    setDriverActive(state, id, !(rec?.active));
    commit('toggle-driver', {});
    toast(rec?.active ? '已停用——历史派工单仍可回溯到人' : '已恢复在册');
  } catch (e) { fail(e); }
}

function submitDuty() {
  const kind = document.getElementById('du-kind')?.value;
  const doneISO = val('du-done') || todayISO();
  try {
    setDutyDone(state, kind, doneISO, val('du-note'));
    commit('duty-done', { kind });
    toast('已登记，周期自动滚动');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 日管控 / 周排查 / 月调度 / 派工闸 / 隐患
// ---------------------------------------------------------------------------

function submitPatrol() {
  try {
    const rec = addPatrol(state, {
      dateISO: val('pt-date') || todayISO(),
      vehicleId: document.getElementById('pt-vehicle')?.value || '',
      checkerName: val('pt-checker'),
      result: document.getElementById('pt-result')?.value || 'ok',
      findings: val('pt-findings'),
      action: val('pt-action'),
    });
    commit('add-patrol', { result: rec.result });
    toast(rec.result === 'found' ? '已打卡并挂出隐患——先处置，闭环前派工被拒' : '打卡成功——零风险报告已留痕');
  } catch (e) { fail(e); }
}

function deletePatrol(id) {
  try {
    removePatrol(state, id);
    commit('del-patrol');
    toast('已删除该巡检卡');
  } catch (e) { fail(e); }
}

function submitWeekly() {
  try {
    addWeekly(state, {
      dateISO: val('wk-date') || todayISO(),
      hostName: val('wk-host'),
      content: val('wk-content'),
      issues: val('wk-issues'),
    });
    commit('add-weekly', {});
    toast('周排查已登记——《每周场车安全排查治理报告》在账');
  } catch (e) { fail(e); }
}

function submitMonthly() {
  try {
    addMonthly(state, {
      dateISO: val('mo-date') || todayISO(),
      hostName: val('mo-host'),
      content: val('mo-content'),
    });
    commit('add-monthly', {});
    toast('月调度已登记——《每月场车安全调度会议纪要》在账');
  } catch (e) { fail(e); }
}

function submitWorkOrder() {
  const payload = {
    dateISO: val('wo-date') || todayISO(),
    vehicleId: document.getElementById('wo-vehicle')?.value || '',
    driverId: document.getElementById('wo-driver')?.value || '',
    task: val('wo-task'),
    shift: document.getElementById('wo-shift')?.value || 'am',
    note: val('wo-note'),
  };
  const gate = dispatchGate(state, payload);
  if (!gate.ok) {
    track(state, 'dispatch-gate-blocked', { reasons: gate.reasons });
    saveState(state);
    toast(`⛔ 派工被闸机拒绝：${gate.reasons[0]}${gate.reasons.length > 1 ? `（另有 ${gate.reasons.length - 1} 项，见体检明细）` : ''}`);
    return;
  }
  try {
    addWorkOrder(state, payload);
    commit('add-workorder', {});
    toast('派工已落账——五道闸全部通过，核对快照已存档');
  } catch (e) { fail(e); }
}

function deleteWorkOrder(id) {
  try {
    removeWorkOrder(state, id);
    commit('del-workorder');
    toast('已删除该派工单');
  } catch (e) { fail(e); }
}

function submitHazard() {
  try {
    addHazard(state, {
      dateISO: val('hz-date') || todayISO(),
      vehicleId: document.getElementById('hz-vehicle')?.value || '',
      source: document.getElementById('hz-source')?.value || 'manual',
      severity: document.getElementById('hz-severity')?.value || 'general',
      desc: val('hz-desc'),
    });
    commit('add-hazard', {});
    toast('隐患已登记——整改、复查销案后闭环');
  } catch (e) { fail(e); }
}

function showFixHazard(id) {
  const h = (state.hazards ?? []).find((x) => x.id === id);
  if (!h) return;
  openModal(`隐患整改 · ${h.plateNo || '公共区域'}`, `
    <p class="fine" style="margin-top:0">${h.desc}——整改必须写明措施与完成日，只打勾不留痕不算整改。</p>
    <div class="form-grid">
      <label>整改完成日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">整改措施 *<input id="m-action" placeholder="如：更换制动管路并试车合格" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      fixHazard(state, id, { actionISO: modalVal('m-date') || todayISO(), action: modalVal('m-action') });
      closeModal();
      commit('fix-hazard', {});
      toast('整改已登记——复查销案后闭环');
    } catch (e) { fail(e); }
  };
}

function showCloseHazard(id) {
  const h = (state.hazards ?? []).find((x) => x.id === id);
  if (!h) return;
  openModal(`复查销案 · ${h.plateNo || '公共区域'}`, `
    <p class="fine" style="margin-top:0">整改措施：${h.action || '—'}（${h.actionISO || '—'}）。复查建议由场车安全总监执行（74 号令第 136 条：总监组织研判处置）。</p>
    <div class="form-grid">
      <label>复查日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>复查人 *<input id="m-verifier" value="${state.station?.directorName || ''}" placeholder="建议场车安全总监" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeHazard(state, id, { verifyISO: modalVal('m-date') || todayISO(), verifiedBy: modalVal('m-verifier') });
      closeModal();
      commit('close-hazard', {});
      toast('已复查销案——闭环台账完整在档');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 派工单）
// ---------------------------------------------------------------------------

function repApply() {
  repMonth = document.getElementById('rep-month')?.value || monthKey(todayISO());
  try {
    repCache = monthlySummary(state, repMonth).text;
    commit('rep-apply', { month: repMonth });
  } catch (e) { fail(e); }
}

function repCopy() {
  const month = document.getElementById('rep-month')?.value || repMonth || monthKey(todayISO());
  try {
    const text = monthlySummary(state, month).text;
    copyText(text);
    track(state, 'rep-copy', { month });
    saveState(state);
  } catch (e) { fail(e); }
}

function inspectAction(action) {
  const html = inspectHtml(state, todayISO(), state.settings ?? {});
  track(state, 'inspect', { action });
  if (action === 'download') {
    downloadFile(`场车使用安全迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function dispatchDownload() {
  const orderId = document.getElementById('case-order')?.value;
  if (!orderId) { toast('请先在台账派工'); return; }
  try {
    const html = dispatchHtml(state, orderId, todayISO());
    track(state, 'dispatch-print', { orderId });
    downloadFile(`场车派工单_${todayISO()}.html`, html, 'text/html');
    toast('派工单已下载——现场留档或检查备查');
    saveState(state);
  } catch (e) { fail(e); }
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
    toast('已复制——去微信粘贴存档或报主要负责人');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴存档或报主要负责人');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function submitSettings() {
  const apply = Number(document.getElementById('set-apply')?.value);
  const reexam = Number(document.getElementById('set-reexam')?.value);
  const patrolGap = Number(document.getElementById('set-patrolgap')?.value);
  state.settings = {
    applyAdvanceDays: Number.isInteger(apply) && apply >= 7 && apply <= 120 ? apply : DEFAULT_APPLY_ADVANCE_DAYS,
    reexamWarnDays: Number.isInteger(reexam) && reexam >= 15 && reexam <= 180 ? reexam : DEFAULT_REEXAM_WARN_DAYS,
    patrolGapDays: Number.isInteger(patrolGap) && patrolGap >= 1 && patrolGap <= 7 ? patrolGap : DEFAULT_PATROL_GAP_DAYS,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`叉车账备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`叉车账使用记录_${todayISO()}.json`, JSON.stringify(state.traces ?? [], null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      state.settings = { ...emptyState().settings, ...(res.state.settings ?? {}) };
      repMonth = null;
      repCache = null;
      commit('import');
      toast('导入成功');
    };
    reader.readAsText(file);
  }
}

// ---------------------------------------------------------------------------
// 示例数据（30 秒体验完整流程；「今天」的记录用真实时钟，无未来时间戳）
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  state.station = {
    name: '城东云仓物流园（示例）', manager: '刘建国', phone: '13800006688',
    address: 'XX市城东区振兴路 128 号物流园', directorName: '周敏', directorPhone: '13900007799',
    officerName: '王铁柱', officerPhone: '13700008866', note: '已建立场车安全管理制度与操作规程',
  };
  state.vehicles = [];
  state.vehicleSeq = 0;
  state.drivers = [];
  state.driverSeq = 0;
  state.patrols = [];
  state.patrolSeq = 0;
  state.weeklies = [];
  state.weeklySeq = 0;
  state.monthlies = [];
  state.monthlySeq = 0;
  state.hazards = [];
  state.hazardSeq = 0;
  state.workOrders = [];
  state.workOrderSeq = 0;
  state.duties = [];

  // 车辆一车一档：1 台正常、1 台定检临期（约 15 天）、1 台定检已过期（停用点名）、1 台观光车（严重隐患停用中）
  const v1 = addVehicle(state, { plateNo: '叉车 01', kind: 'forklift', brand: '合力 K30 3t', regNo: '特设登记 场2023-0087', firstUseISO: isoAgo(today, 900), lastInspectISO: isoAgo(today, 200), keeperName: '王铁柱', monitor: true, ownerType: 'own', note: '锂电池' });
  const v2 = addVehicle(state, { plateNo: '叉车 02', kind: 'forklift', brand: '杭叉 XF25 2.5t', regNo: '特设登记 场2023-0088', firstUseISO: isoAgo(today, 880), lastInspectISO: isoAgo(today, 715), keeperName: '王铁柱', monitor: true, ownerType: 'own' });
  const v3 = addVehicle(state, { plateNo: '叉车 03', kind: 'forklift', brand: '比亚迪 3t', regNo: '特设登记 场2024-0112', firstUseISO: isoAgo(today, 500), lastInspectISO: isoAgo(today, 810), keeperName: '张广发', monitor: false, ownerType: 'own', note: '2021 年出厂，未装监控装置' });
  const v4 = addVehicle(state, { plateNo: '观光车 01', kind: 'sightseeing', brand: '益高 EG6023', regNo: '特设登记 场2024-0190', firstUseISO: isoAgo(today, 420), lastInspectISO: isoAgo(today, 300), keeperName: '李有才', monitor: false, ownerType: 'own', note: '园区接驳' });

  // 司机名册：1 人在期、1 人已失效（红）、1 人进入复审窗口（黄）
  const d1 = addDriver(state, { name: '王铁柱', certNo: 'N1 证 TS2610xxxx01', expiryISO: isoAgo(today, -800), phone: '13700008866' });
  addDriver(state, { name: '李有才', certNo: 'N1 证 TS2210xxxx07', expiryISO: isoAgo(today, 30), phone: '13600009977', note: '复审窗口错过，须重新考试' });
  addDriver(state, { name: '张广发', certNo: 'N1 证 TS2211xxxx12', expiryISO: isoAgo(today, -25), phone: '13500001122' });

  // 日管控：今天叉车 01 已打卡（零风险）；昨天两台打卡；观光车昨天发现异常已处置
  addPatrol(state, { dateISO: today, vehicleId: v1.id, checkerName: '王铁柱', result: 'ok' });
  addPatrol(state, { dateISO: isoAgo(today, 1), vehicleId: v1.id, checkerName: '王铁柱', result: 'ok' });
  addPatrol(state, { dateISO: isoAgo(today, 1), vehicleId: v4.id, checkerName: '李有才', result: 'found', findings: '观光车制动偏软、乘客区两根安全带磨损', action: '立即停用并挂警示牌，报安全总监周敏' });
  addPatrol(state, { dateISO: isoAgo(today, 2), vehicleId: v2.id, checkerName: '王铁柱', result: 'ok' });

  // 派工：今天叉车 01 × 王铁柱（五道闸全过）；昨天观光车 × 王铁柱（异常发现前的合规单）
  addWorkOrder(state, { dateISO: today, vehicleId: v1.id, driverId: d1.id, task: '3 号库月台卸货', shift: 'am' });
  addWorkOrder(state, { dateISO: isoAgo(today, 2), vehicleId: v2.id, driverId: d1.id, task: '成品转运至暂存区', shift: 'am' });

  // 隐患：日管控自动挂出的观光车严重隐患（停用闸，未闭环）+ 一条已闭环 + 一条区域类周排查隐患
  state.hazardSeq += 1;
  state.hazards.push({ id: `hz-${state.hazardSeq}`, dateISO: isoAgo(today, 1), vehicleId: v4.id, plateNo: v4.plateNo, source: 'daily', severity: 'serious', desc: '制动偏软、乘客区两根安全带磨损', action: '', actionISO: '', verifyISO: '', verifiedBy: '', status: 'open' });
  state.hazardSeq += 1;
  state.hazards.push({ id: `hz-${state.hazardSeq}`, dateISO: isoAgo(today, 12), vehicleId: v1.id, plateNo: v1.plateNo, source: 'daily', severity: 'general', desc: '货叉链条润滑不足、异响', action: '全部链条润滑并试车确认', actionISO: isoAgo(today, 12), verifyISO: isoAgo(today, 11), verifiedBy: '周敏', status: 'closed' });
  state.hazardSeq += 1;
  state.hazards.push({ id: `hz-${state.hazardSeq}`, dateISO: isoAgo(today, 3), vehicleId: '', plateNo: '', source: 'weekly', severity: 'general', desc: '充电区 2 具灭火器压力表指针在红区', action: '', actionISO: '', verifyISO: '', verifiedBy: '', status: 'open' });

  // 周排查（本周一，保证落在当前 ISO 周）与月调度（本月 1 号，保证落在本月）
  const d0 = new Date(`${today}T00:00:00Z`);
  const monday = new Date(d0);
  monday.setUTCDate(d0.getUTCDate() - ((d0.getUTCDay() + 6) % 7));
  addWeekly(state, { dateISO: monday.toISOString().slice(0, 10), hostName: '周敏', content: '全园叉车通道、限速标志、充电区专项排查，复核本周巡检异常处置', issues: '充电区灭火器压力异常（已挂隐患）' });
  addMonthly(state, { dateISO: `${today.slice(0, 7)}-01`, hostName: '刘建国', content: '听取本月场车安全汇报；下月重点：叉车 02 定检申报、叉车 03 停用评估、观光车隐患整改' });

  // 周期义务：培训 200 天前（在期）、预案演练 400 天前（逾期红灯）、清单评审 100 天前（在期）
  setDutyDone(state, 'training', isoAgo(today, 200), '全员叉车安全操作与持证复审培训');
  setDutyDone(state, 'drill', isoAgo(today, 400), '场车碰撞事故应急演练');
  setDutyDone(state, 'risklist', isoAgo(today, 100), '场车安全风险管控清单半年评审');

  repCache = null;
  repMonth = null;
  commit('seed-demo');
}

function isoAgo(today, days) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 事件委托与启动
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, idx } = el.dataset;
  switch (action) {
    case 'save-station': submitStation(); break;
    case 'add-vehicle': submitVehicle(); break;
    case 'del-vehicle': deleteVehicle(idx); break;
    case 'show-inspect-pass': showInspectPass(idx); break;
    case 'show-modify': showModify(idx); break;
    case 'show-scrap': showScrap(idx); break;
    case 'add-driver': submitDriver(); break;
    case 'toggle-driver': toggleDriver(idx); break;
    case 'set-duty': submitDuty(); break;
    case 'add-patrol': submitPatrol(); break;
    case 'del-patrol': deletePatrol(idx); break;
    case 'add-weekly': submitWeekly(); break;
    case 'add-monthly': submitMonthly(); break;
    case 'add-workorder': submitWorkOrder(); break;
    case 'del-workorder': deleteWorkOrder(idx); break;
    case 'add-hazard': submitHazard(); break;
    case 'show-fix-hazard': showFixHazard(idx); break;
    case 'show-close-hazard': showCloseHazard(idx); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'dispatch-download': dispatchDownload(); break;
    case 'save-settings': submitSettings(); break;
    case 'export-json': dataAction('export-json'); break;
    case 'export-events': dataAction('export-events'); break;
    case 'seed-demo': seedDemo(); break;
    case 'close-modal': closeModal(); break;
    case '__confirm__': openModal._confirm?.(); break;
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
