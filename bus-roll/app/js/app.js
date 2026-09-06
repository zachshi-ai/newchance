/**
 * app.js — 路由、状态变更、事件委托、弹窗、示例数据与启动
 */
import {
  loadState, saveState, track,
} from './store.js';
import {
  todayISO,
  addBus, retireBus, updateBusInspection,
  addDriver, addEscort,
  startTrip, preCheck, board, alight, cancelTrip,
  openHazard, closeHazard, setDutyDone,
  PRECHECK_ITEMS, monthlyText, seedState,
  exportBundle, importBundle,
} from './core.js';
import {
  viewBoard, viewBuses, viewTrips, viewPeople, viewHazards, viewDuties,
  viewReports, viewSettings, ICONS,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const $modalHost = document.getElementById('modal-host');

let state = loadState();
let repMonth = null;   // 月度小结用户选择的月份（跨渲染保留）
let repCache = null;   // 最近一次小结文本

const NAV = [
  ['#/board', '今日', 'board'], ['#/trips', '趟次', 'roll'], ['#/buses', '车辆', 'bus'],
  ['#/people', '人员', 'people'], ['#/hazards', '隐患', 'hazard'], ['#/duties', '义务', 'clock'],
  ['#/reports', '出证', 'reports'], ['#/settings', '设置', 'settings'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

function render() {
  const today = todayISO();
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'trips': html = viewTrips(state, today); break;
    case 'buses': html = viewBuses(state, today); break;
    case 'people': html = viewPeople(state, today); break;
    case 'hazards': html = viewHazards(state, today); break;
    case 'duties': html = viewDuties(state, today); break;
    case 'reports': html = viewReports(state, repMonth, repCache, today); break;
    case 'settings': html = viewSettings(state); break;
    default: html = viewBoard(state, today);
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

function ok(msg) {
  toast(`✅ ${msg}`);
}

function val(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

function numVal(id) {
  const v = document.getElementById(id)?.value;
  return v === '' || v === undefined || v === null ? NaN : Number(v);
}

function checked(id) {
  return document.getElementById(id)?.checked === true;
}

// ---------------------------------------------------------------------------
// 弹窗（登记检验日期 / 隐患销案 / 义务登记）
// ---------------------------------------------------------------------------

function openModal(title, bodyHtml, confirmAction) {
  $modalHost.innerHTML = `
  <div class="modal-mask" data-action="close-modal">
    <div class="modal" data-stop="1">
      <h3>${title}</h3>
      ${bodyHtml}
      <div class="row"><button class="btn" data-action="${confirmAction}">确认</button>
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
// 下载 / 打印 / 剪贴板
// ---------------------------------------------------------------------------

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime ?? 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function printHtml(html) {
  const w = window.open('', '_blank');
  if (!w) { toast('浏览器拦截了打印窗口，请允许弹窗后重试'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    ok('已复制到剪贴板');
  } catch {
    fail('复制失败——请手动选择文本复制');
  }
}

// ---------------------------------------------------------------------------
// 设置：单位信息与口径参数
// ---------------------------------------------------------------------------

function saveOrg() {
  const name = val('org-name');
  if (!name) { fail('单位名称必填'); return; }
  state.org = {
    ...state.org,
    name, kind: val('org-kind'), district: val('org-district'), manager: val('org-manager'),
    phone: val('org-phone'), address: val('org-address'), safetyOfficer: val('org-officer'),
    bookFileDateISO: val('org-bookfile'),
  };
  commit('org_saved');
  ok('单位信息已保存');
}

function saveSettings() {
  const keys = ['certWarnDays', 'certRedDays', 'inspectionMonths', 'auditMonths', 'driverMaxAge',
    'drillCycleDays', 'eduCycleDays', 'driverEduCycleDays', 'escortCycleDays', 'deviceCycleDays', 'bookFileCycleDays'];
  for (const k of keys) {
    const n = numVal(`set-${k}`);
    if (Number.isInteger(n) && n > 0) state.settings[k] = n;
  }
  commit('settings_saved');
  ok('口径参数已保存（属地要求永远赢）');
}

// ---------------------------------------------------------------------------
// 车辆与人员
// ---------------------------------------------------------------------------

function addBusAction() {
  try {
    addBus(state, {
      plate: val('bus-plate'), model: val('bus-model'), seats: numVal('bus-seats'),
      plateNo: val('bus-plateno'), plateExpiryISO: val('bus-plateexp'),
      inspectionLastISO: val('bus-inspection'), insuranceCvtExpiryISO: val('bus-cvt'),
      insuranceCarrierExpiryISO: val('bus-carrier'), note: val('bus-note'),
    });
    commit('bus_added');
    ok('车辆已建档——四只钟开走');
  } catch (e) { fail(e); }
}

function showInspectDate(busId) {
  openModal('登记最近安全技术检验（第20条：每半年一次）',
    `<label>最近检验日期<input id="m-inspect-date" type="date" value="${todayISO()}" /></label>
     <p class="basis">下一次检验日 = 该日期 + 6 个月（月末自动钳制）。</p>`, 'confirm-inspect-date');
  $modalHost.querySelector('.modal').dataset.busId = busId;
}

function confirmInspectDate() {
  const busId = $modalHost.querySelector('.modal')?.dataset.busId;
  try {
    updateBusInspection(state, busId, modalVal('m-inspect-date'));
    closeModal();
    commit('inspection_updated', { busId });
    ok('检验钟已重置');
  } catch (e) { fail(e); }
}

function retireBusAction(busId) {
  if (!confirm('确认停用该车？停用后不再点名与计时。')) return;
  try {
    retireBus(state, busId);
    commit('bus_retired', { busId });
    ok('已停用');
  } catch (e) { fail(e); }
}

function addDriverAction() {
  try {
    addDriver(state, {
      name: val('dv-name'), licenseClass: val('dv-class'), birthdayISO: val('dv-birth'),
      qualificationDateISO: val('dv-qual'), auditLastISO: val('dv-audit'), phone: val('dv-phone'),
    });
    commit('driver_added');
    ok('驾驶人已登记');
  } catch (e) { fail(e); }
}

function addEscortAction() {
  try {
    addEscort(state, { name: val('es-name'), phone: val('es-phone') });
    commit('escort_added');
    ok('照管员已登记（第38条：全程照管）');
  } catch (e) { fail(e); }
}

function retirePeople(kind, id) {
  const list = kind === 'driver' ? state.drivers : state.escorts;
  const p = list.find((x) => x.id === id);
  if (!p) return;
  p.status = 'retired';
  commit(`${kind}_retired`, { id });
  ok('已停用');
}

// ---------------------------------------------------------------------------
// 趟次点名
// ---------------------------------------------------------------------------

function newTrip() {
  const escortIds = [...document.querySelectorAll('.tp-escort:checked')].map((el) => el.value);
  try {
    startTrip(state, {
      busId: val('tp-bus'), driverId: val('tp-driver'), escortIds,
      dateISO: val('tp-date') || todayISO(), slot: val('tp-slot'), route: val('tp-route'),
    });
    commit('trip_started');
    ok('趟次已建——先做出车前七项检查');
  } catch (e) { fail(e); }
}

function submitPrecheck(tripId) {
  const items = {};
  let abnormal = false;
  for (const it of PRECHECK_ITEMS) {
    items[it.key] = checked(`pc-${tripId}-${it.key}`);
    if (!items[it.key]) abnormal = true;
  }
  try {
    if (abnormal) {
      const measure = val(`pc-measure-${tripId}`);
      if (!measure) { fail('检查有异常项：必须先登记整改措施（条例第22条：停运维修、消除隐患）'); return; }
      const labels = PRECHECK_ITEMS.filter((it) => !items[it.key]).map((it) => it.label).join('、');
      openHazard(state, {
        busId: state.trips.find((t) => t.id === tripId).busId, tripId, dateISO: todayISO(),
        item: `出车前检查：${labels}`, measure, deadlineISO: val(`pc-deadline-${tripId}`),
      });
    }
    preCheck(state, tripId, { items, note: val(`pc-memo-${tripId}`), dateISO: todayISO() });
    commit('precheck_done', { tripId, abnormal });
    ok(abnormal ? '检查已记录（含异常，隐患在册——闭环前发车会被拒绝）' : '七项检查通过');
  } catch (e) { fail(e); }
}

function boardTrip(tripId) {
  try {
    board(state, tripId, { onCount: numVal(`bd-count-${tripId}`), onConfirmed: checked(`bd-confirm-${tripId}`), dateISO: todayISO() });
    commit('boarded', { tripId });
    ok('已发车——回程/到站后做下车清点');
  } catch (e) {
    if (String(e?.message ?? '').includes('超员')) track(state, 'overload_blocked', { tripId });
    fail(e);
  }
}

function alightTrip(tripId) {
  const recheck = {};
  for (const it of ['seats', 'aisle', 'space']) recheck[it] = checked(`rc-${tripId}-${it}`);
  try {
    alight(state, tripId, {
      offCount: numVal(`al-count-${tripId}`), midOffCount: numVal(`al-mid-${tripId}`) || 0,
      midNote: val(`al-midnote-${tripId}`), recheck, dateISO: todayISO(),
    });
    commit('trip_closed', { tripId });
    ok('趟次闭环：全数离车，三查确认');
  } catch (e) { fail(e); }
}

function cancelTripAction(tripId) {
  if (!confirm('确认取消该趟次？取消会留痕（不删除）。')) return;
  try {
    cancelTrip(state, tripId, { note: `取消于 ${todayISO()}` });
    commit('trip_cancelled', { tripId });
    ok('已取消（留痕）');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 隐患与义务
// ---------------------------------------------------------------------------

function showCloseHazard(hazardId) {
  openModal('隐患销案（复查合格才算闭环）',
    `<label>闭环日期<input id="m-hz-date" type="date" value="${todayISO()}" /></label>
     <label>复查说明<input id="m-hz-note" placeholder="例：换胎后复查胎压正常" /></label>
     <p class="basis">销案前，该车带病——「发车」会被拒绝（第41条）。</p>`, 'confirm-close-hazard');
  $modalHost.querySelector('.modal').dataset.hzId = hazardId;
}

function confirmCloseHazard() {
  const hzId = $modalHost.querySelector('.modal')?.dataset.hzId;
  try {
    closeHazard(state, hzId, { closedISO: modalVal('m-hz-date'), closeNote: modalVal('m-hz-note') });
    closeModal();
    commit('hazard_closed', { hzId });
    ok('隐患已闭环');
  } catch (e) { fail(e); }
}

function showSetDuty(kind) {
  openModal('登记义务完成',
    `<label>完成日期<input id="m-duty-date" type="date" value="${todayISO()}" /></label>
     <p class="basis">下一次到期 = 该日期 + 周期（周期在「设置」可按属地覆盖）。</p>`, 'confirm-set-duty');
  $modalHost.querySelector('.modal').dataset.dutyKind = kind;
}

function confirmSetDuty() {
  const kind = $modalHost.querySelector('.modal')?.dataset.dutyKind;
  try {
    setDutyDone(state, kind, modalVal('m-duty-date'));
    closeModal();
    commit('duty_done', { kind });
    ok('义务已登记');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 出证
// ---------------------------------------------------------------------------

function repGen() {
  repMonth = val('rep-month') || todayISO().slice(0, 7);
  repCache = monthlyText(state, repMonth);
  commit('monthly_report');
  ok(`已汇总 ${repMonth}`);
}

function repDownload() {
  if (!repCache) repGen();
  downloadFile(`校车安全月度小结-${repMonth}.txt`, repCache ?? monthlyText(state, repMonth ?? todayISO().slice(0, 7)));
}

function inspectDownload() {
  const html = inspectHtml(state, todayISO());
  track(state, 'inspect_generated');
  saveState(state);
  downloadFile(`校车安全迎检自证包-${todayISO()}.html`, html, 'text/html;charset=utf-8');
  ok('自证包已生成');
}

function inspectPrint() {
  printHtml(inspectHtml(state, todayISO()));
}

function printTripCard(tripId) {
  printHtml(tripCardHtml(state, tripId));
}

// ---------------------------------------------------------------------------
// 数据导入导出与示例
// ---------------------------------------------------------------------------

function dataExport() {
  downloadFile(`护学账备份-${todayISO()}.json`, JSON.stringify(exportBundle(state), null, 2), 'application/json');
  ok('备份已导出（含人员联系方式，请妥善保管）');
}

function dataImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = importBundle(String(reader.result));
      commit('data_imported');
      ok('备份已导入');
    } catch (e) { fail(e); }
  };
  reader.readAsText(file);
}

function seedDemo() {
  state = seedState(todayISO());
  commit('seed_loaded');
  ok('示例数据已载入——看板上的红灯都是演示钩子');
}

// ---------------------------------------------------------------------------
// 事件委托
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const idx = el.dataset.idx;
  switch (action) {
    case 'save-org': saveOrg(); break;
    case 'save-settings': saveSettings(); break;
    case 'add-bus': addBusAction(); break;
    case 'show-inspect-date': showInspectDate(idx); break;
    case 'confirm-inspect-date': confirmInspectDate(); break;
    case 'retire-bus': retireBusAction(idx); break;
    case 'add-driver': addDriverAction(); break;
    case 'add-escort': addEscortAction(); break;
    case 'retire-driver': retirePeople('driver', idx); break;
    case 'retire-escort': retirePeople('escort', idx); break;
    case 'new-trip': newTrip(); break;
    case 'submit-precheck': submitPrecheck(idx); break;
    case 'board-trip': boardTrip(idx); break;
    case 'alight-trip': alightTrip(idx); break;
    case 'cancel-trip': cancelTripAction(idx); break;
    case 'show-close-hazard': showCloseHazard(idx); break;
    case 'confirm-close-hazard': confirmCloseHazard(); break;
    case 'show-set-duty': showSetDuty(idx); break;
    case 'confirm-set-duty': confirmSetDuty(); break;
    case 'rep-gen': repGen(); break;
    case 'rep-copy': if (!repCache) repGen(); copyText(repCache); break;
    case 'rep-download': repDownload(); break;
    case 'inspect-download': inspectDownload(); break;
    case 'inspect-print': inspectPrint(); break;
    case 'print-trip-card': printTripCard(idx); break;
    case 'data-export': dataExport(); break;
    case 'seed-demo': seedDemo(); break;
    case 'close-modal': closeModal(); break;
    default: break;
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.id === 'data-import') {
    if (el.files?.[0]) dataImport(el.files[0]);
    el.value = '';
    return;
  }
  // 出车前检查：有异常项时展开「整改措施」区
  if (el.type === 'checkbox' && el.id?.startsWith('pc-')) {
    const tripId = el.id.split('-')[1];
    const anyAbnormal = PRECHECK_ITEMS.some((it) => !document.getElementById(`pc-${tripId}-${it.key}`)?.checked);
    const note = document.getElementById(`pc-note-${tripId}`);
    if (note) note.classList.toggle('visible', anyAbnormal);
    return;
  }
  if (el.id === 'rep-month') {
    repMonth = el.value;
  }
});

window.addEventListener('hashchange', render);
render();
