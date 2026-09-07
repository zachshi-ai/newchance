/**
 * app.js — 路由、状态变更、事件委托、弹窗、示例数据与启动
 */
import {
  loadState, saveState, track,
} from './store.js';
import {
  todayISO,
  addUas, retireUas, addPilot,
  startFlight, preflight, takeoff, closeFlight, cancelFlight, reportIncident,
  createPermit, submitApplication, decidePermit, recordPreDeparture,
  openIssue, closeIssue, setDutyDone,
  classifyUas, CATEGORY_META, obligations, PREFLIGHT_ITEMS,
  flightCardHtml, inspectHtml, monthlyText, seedState,
  exportBundle, importBundle,
} from './core.js';
import {
  viewBoard, viewFleet, viewCrew, viewFlights, viewPermits, viewIssues, viewDuties,
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
  ['#/board', '今日', 'board'], ['#/flights', '飞行', 'flight'], ['#/fleet', '机队', 'fleet'],
  ['#/crew', '人员', 'people'], ['#/permits', '申请', 'permit'], ['#/issues', '检修', 'hazard'],
  ['#/duties', '义务', 'clock'], ['#/reports', '出证', 'reports'], ['#/settings', '设置', 'settings'],
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
    case 'flights': html = viewFlights(state, today); break;
    case 'fleet': html = viewFleet(state, today); break;
    case 'crew': html = viewCrew(state, today); break;
    case 'permits': html = viewPermits(state, today); break;
    case 'issues': html = viewIssues(state, today); break;
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
// 弹窗（提交申请 / 批复 / 起飞前报告 / 销案 / 报告登记 / 义务登记）
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
// 设置：主体信息与口径参数
// ---------------------------------------------------------------------------

function saveOrg() {
  const name = val('org-name');
  if (!name) { fail('名称必填'); return; }
  state.org = {
    ...state.org,
    name, orgMode: val('org-mode') || 'personal', kind: val('org-kind'), district: val('org-district'),
    manager: val('org-manager'), phone: val('org-phone'),
    opCertNumber: val('org-opcert'), opCertIssueISO: val('org-opcertdate'),
  };
  commit('org_saved');
  ok('主体信息已保存');
}

function saveSettings() {
  const keys = ['certWarnDays', 'certRedDays', 'licenseYears', 'profCheckMonths', 'profCheckLargeMonths',
    'agriCertMonths', 'annualReportDays', 'uasInfoUpdateDays', 'batteryCheckDays', 'firmwareDays'];
  for (const k of keys) {
    const n = numVal(`set-${k}`);
    if (Number.isInteger(n) && n > 0) state.settings[k] = n;
  }
  commit('settings_saved');
  ok('口径参数已保存（属地要求永远赢）');
}

// ---------------------------------------------------------------------------
// 机队与人员
// ---------------------------------------------------------------------------

function addUasAction() {
  try {
    const { cls } = addUas(state, {
      nickname: val('uas-name'), model: val('uas-model'),
      emptyKg: numVal('uas-empty'), mtowKg: numVal('uas-mtow'),
      agri: checked('uas-agri'), commercialUse: checked('uas-commercial'), legacyNoRemoteId: checked('uas-legacy'),
      regNo: val('uas-regno'), registeredISO: val('uas-regdate'), markAffixed: checked('uas-mark'),
      insuranceExpiryISO: val('uas-insurance'), note: val('uas-note'),
    });
    commit('uas_added');
    ok(`已建档：${CATEGORY_META[cls.category].label}${cls.agriOk ? '（农用作业）' : ''}——证照钟开走`);
  } catch (e) { fail(e); }
}

/** 判档预览：输入重量即时算出分类与义务清单（不落库） */
function previewClass() {
  const box = document.getElementById('uas-cls-preview');
  if (!box) return;
  try {
    const cls = classifyUas({
      emptyKg: numVal('uas-empty'), mtowKg: numVal('uas-mtow'),
      agri: checked('uas-agri'),
    });
    const orgMode = (state.org?.orgMode) || 'personal';
    const obls = obligations({ category: cls.category, agriOps: cls.agriOk, orgMode, purpose: checked('uas-commercial') ? 'commercial' : 'personal' });
    box.innerHTML = `→ 判档：<b>${CATEGORY_META[cls.category].label}</b>（${esc(cls.basis)}，${esc(cls.clause)}）${cls.agriOk ? ' · 常规农用作业（豁免运营合格证）' : ''}<br>该机该飞必备：${obls.filter((o) => o.required).map((o) => esc(o.label)).join('；')}`;
  } catch (e) {
    box.textContent = `→ ${e?.message ?? e}`;
  }
}

function retireUasAction(uasId) {
  if (!confirm('确认停用该机？停用后不再计时与点名。')) return;
  try {
    retireUas(state, uasId);
    commit('uas_retired', { uasId });
    ok('已停用');
  } catch (e) { fail(e); }
}

function addPilotAction() {
  try {
    addPilot(state, {
      name: val('pl-name'), phone: val('pl-phone'),
      licenseIssueISO: val('pl-license'), lastProfCheckISO: val('pl-profcheck'),
      ifrLarge: checked('pl-ifrlarge'), agriCertISO: val('pl-agricert'),
    });
    commit('pilot_added');
    ok('操控员已登记');
  } catch (e) { fail(e); }
}

function retirePeople(kind, id) {
  const list = kind === 'pilot' ? state.pilots : null;
  const p = list?.find((x) => x.id === id);
  if (!p) return;
  p.status = 'retired';
  commit(`${kind}_retired`, { id });
  ok('已停用');
}

// ---------------------------------------------------------------------------
// 飞行架次
// ---------------------------------------------------------------------------

function newFlight() {
  const flags = {};
  for (const el of document.querySelectorAll('.fl-flag:checked')) flags[el.value] = true;
  try {
    startFlight(state, {
      uasId: val('fl-uas'), pilotId: val('fl-pilot'), dateISO: val('fl-date') || todayISO(),
      purpose: val('fl-purpose'), airspaceKind: val('fl-airspace'), missionFlags: flags,
      permitId: val('fl-permit'), location: val('fl-location'),
    });
    commit('flight_started');
    ok('架次已建——先做航前检查');
  } catch (e) { fail(e); }
}

function submitPreflight(flightId) {
  const items = {};
  let abnormal = false;
  const flight = state.flights.find((f) => f.id === flightId);
  const uas = flight && state.uas.find((u) => u.id === flight.uasId);
  let isMicro = false;
  try { isMicro = uas ? classifyUas(uas).category === 'micro' : false; } catch { isMicro = false; }
  for (const it of PREFLIGHT_ITEMS) {
    if (isMicro && it.microNa) { items[it.key] = true; continue; }
    items[it.key] = checked(`pf-${flightId}-${it.key}`);
    if (!items[it.key]) abnormal = true;
  }
  try {
    if (abnormal) {
      const measure = val(`pf-measure-${flightId}`);
      if (!measure) { fail('检查有异常项：必须先登记处置措施（条例第32条(二)）'); return; }
      const labels = PREFLIGHT_ITEMS.filter((it) => items[it.key] === false).map((it) => it.label).join('、');
      openIssue(state, {
        uasId: flight.uasId, flightId, dateISO: todayISO(),
        item: `航前检查：${labels}`, measure, deadlineISO: val(`pf-deadline-${flightId}`),
      });
    }
    preflight(state, flightId, { items, note: val(`pf-memo-${flightId}`), dateISO: todayISO() });
    commit('preflight_done', { flightId, abnormal });
    ok(abnormal ? '检查已记录（含异常，检修在册——闭环前起飞会被拒绝）' : '航前检查通过，已放行');
  } catch (e) { fail(e); }
}

function takeoffFlight(flightId) {
  try {
    takeoff(state, flightId, { dateISO: todayISO() });
    commit('flight_takeoff', { flightId });
    ok('已起飞——降落后记得闭环；安全问题 24 小时钟会自动开始');
  } catch (e) {
    fail(e);
  }
}

function closeFlightAction(flightId) {
  try {
    closeFlight(state, flightId, {
      landingISO: val(`cl-landing-${flightId}`) || todayISO(),
      durationMin: numVal(`cl-duration-${flightId}`),
      income: numVal(`cl-income-${flightId}`),
      safetyIssue: checked(`cl-issue-${flightId}`),
      incidentNote: val(`cl-incnote-${flightId}`),
      note: val(`cl-note-${flightId}`),
    });
    commit('flight_closed', { flightId });
    ok('架次闭环：飞后动作链走完');
  } catch (e) { fail(e); }
}

function cancelFlightAction(flightId) {
  if (!confirm('确认取消该架次？取消会留痕（不删除）。')) return;
  try {
    cancelFlight(state, flightId, { note: `取消于 ${todayISO()}` });
    commit('flight_cancelled', { flightId });
    ok('已取消（留痕）');
  } catch (e) { fail(e); }
}

function showReportIncident(flightId) {
  openModal('登记安全问题报告（条例第40条：降落后 24 小时内向空管报告）',
    `<label>报告日期<input id="m-inc-date" type="date" value="${todayISO()}" /></label>
     <p class="basis">截止日之后才报告会一直亮红灯——报告记录要能对上空管受理痕迹。</p>`, 'confirm-report-incident');
  $modalHost.querySelector('.modal').dataset.flightId = flightId;
}

function confirmReportIncident() {
  const flightId = $modalHost.querySelector('.modal')?.dataset.flightId;
  try {
    reportIncident(state, flightId, { reportedISO: modalVal('m-inc-date') });
    closeModal();
    commit('incident_reported', { flightId });
    ok('报告已登记');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 申请台账
// ---------------------------------------------------------------------------

function createPermitAction() {
  try {
    createPermit(state, {
      uasId: val('pm-uas'), pilotId: val('pm-pilot'), flyingDateISO: val('pm-date'),
      reason: val('pm-reason'), location: val('pm-location'),
    });
    commit('permit_created');
    ok('申请已建——盯住「前 1 日 12 时」提交线');
  } catch (e) { fail(e); }
}

function showSubmitApplication(permitId) {
  const m = state.permits.find((x) => x.id === permitId);
  if (!m) return;
  openModal('登记申请提交（条例第26条：拟飞行前 1 日 12 时前）',
    `<label>提交日期<input id="m-apply-date" type="date" value="${todayISO()}" /></label>
     <p class="basis">截止 ${m.flyingDateISO} 前 1 日 12:00——逾期的提交会被硬性拒绝，请改期飞行。</p>`, 'confirm-submit-application');
  $modalHost.querySelector('.modal').dataset.permitId = permitId;
}

function confirmSubmitApplication() {
  const permitId = $modalHost.querySelector('.modal')?.dataset.permitId;
  try {
    submitApplication(state, permitId, { submittedISO: modalVal('m-apply-date') });
    closeModal();
    commit('permit_submitted', { permitId });
    ok('申请已登记提交，等批复');
  } catch (e) { fail(e); }
}

function showDecidePermit(permitId) {
  openModal('登记空管批复（条例第26条：飞行前 1 日 21 时前作出决定）',
    `<div class="formgrid">
      <label class="chk"><input type="checkbox" id="m-approve" checked /> 获得批准</label>
      <label>批复日期<input id="m-decide-date" type="date" value="${todayISO()}" /></label>
      <label class="wide">批复文号<input id="m-permit-no" placeholder="例：空管批〔示〕2026-018" /></label>
    </div>`, 'confirm-decide-permit');
  $modalHost.querySelector('.modal').dataset.permitId = permitId;
}

function confirmDecidePermit() {
  const permitId = $modalHost.querySelector('.modal')?.dataset.permitId;
  try {
    decidePermit(state, permitId, {
      approved: checked('m-approve'), decidedISO: modalVal('m-decide-date'), permitNo: modalVal('m-permit-no'),
    });
    closeModal();
    commit('permit_decided', { permitId });
    ok('批复已登记');
  } catch (e) { fail(e); }
}

function showPreDep(permitId) {
  openModal('登记起飞前报告（条例第30条：计划起飞 1 小时前报告并经确认）',
    `<label>报告日期<input id="m-predep-date" type="date" value="${todayISO()}" /></label>
     <p class="basis">未登记本记录，关联架次的「起飞」会被硬性拒绝。</p>`, 'confirm-predep');
  $modalHost.querySelector('.modal').dataset.permitId = permitId;
}

function confirmPreDep() {
  const permitId = $modalHost.querySelector('.modal')?.dataset.permitId;
  try {
    recordPreDeparture(state, permitId, { preDepISO: modalVal('m-predep-date') });
    closeModal();
    commit('predep_recorded', { permitId });
    ok('起飞前报告已登记');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 检修与义务
// ---------------------------------------------------------------------------

function showCloseIssue(issueId) {
  openModal('检修销案（复查合格才算闭环）',
    `<label>闭环日期<input id="m-issue-date" type="date" value="${todayISO()}" /></label>
     <label>复查说明<input id="m-issue-note" placeholder="例：换电后复查电压正常" /></label>
     <p class="basis">销案前，该机带病——「起飞」会被拒绝（第32条(二)）。</p>`, 'confirm-close-issue');
  $modalHost.querySelector('.modal').dataset.issueId = issueId;
}

function confirmCloseIssue() {
  const issueId = $modalHost.querySelector('.modal')?.dataset.issueId;
  try {
    closeIssue(state, issueId, { closedISO: modalVal('m-issue-date'), closeNote: modalVal('m-issue-note') });
    closeModal();
    commit('issue_closed', { issueId });
    ok('检修已闭环');
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
  downloadFile(`无人机队合规月度小结-${repMonth}.txt`, repCache ?? monthlyText(state, repMonth ?? todayISO().slice(0, 7)));
}

function inspectDownload() {
  const html = inspectHtml(state, todayISO());
  track(state, 'inspect_generated');
  saveState(state);
  downloadFile(`无人机队迎检自证包-${todayISO()}.html`, html, 'text/html;charset=utf-8');
  ok('自证包已生成');
}

function inspectPrint() {
  printHtml(inspectHtml(state, todayISO()));
}

function printFlightCard(flightId) {
  printHtml(flightCardHtml(state, flightId));
}

// ---------------------------------------------------------------------------
// 数据导入导出与示例
// ---------------------------------------------------------------------------

function dataExport() {
  downloadFile(`适飞单备份-${todayISO()}.json`, JSON.stringify(exportBundle(state), null, 2), 'application/json');
  ok('备份已导出（请妥善保管）');
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
    case 'add-uas': addUasAction(); break;
    case 'retire-uas': retireUasAction(idx); break;
    case 'add-pilot': addPilotAction(); break;
    case 'retire-pilot': retirePeople('pilot', idx); break;
    case 'new-flight': newFlight(); break;
    case 'submit-preflight': submitPreflight(idx); break;
    case 'takeoff-flight': takeoffFlight(idx); break;
    case 'close-flight': closeFlightAction(idx); break;
    case 'cancel-flight': cancelFlightAction(idx); break;
    case 'show-report-incident': showReportIncident(idx); break;
    case 'confirm-report-incident': confirmReportIncident(); break;
    case 'create-permit': createPermitAction(); break;
    case 'show-submit-application': showSubmitApplication(idx); break;
    case 'confirm-submit-application': confirmSubmitApplication(); break;
    case 'show-decide-permit': showDecidePermit(idx); break;
    case 'confirm-decide-permit': confirmDecidePermit(); break;
    case 'show-predep': showPreDep(idx); break;
    case 'confirm-predep': confirmPreDep(); break;
    case 'show-close-issue': showCloseIssue(idx); break;
    case 'confirm-close-issue': confirmCloseIssue(); break;
    case 'show-set-duty': showSetDuty(idx); break;
    case 'confirm-set-duty': confirmSetDuty(); break;
    case 'rep-gen': repGen(); break;
    case 'rep-copy': if (!repCache) repGen(); copyText(repCache); break;
    case 'rep-download': repDownload(); break;
    case 'inspect-download': inspectDownload(); break;
    case 'inspect-print': inspectPrint(); break;
    case 'print-flight-card': printFlightCard(idx); break;
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
  // 航前检查：有异常项时展开「处置措施」区
  if (el.type === 'checkbox' && el.id?.startsWith('pf-')) {
    const flightId = el.id.split('-')[1];
    const flight = state.flights.find((f) => f.id === flightId);
    const uas = flight && state.uas.find((u) => u.id === flight.uasId);
    let isMicro = false;
    try { isMicro = uas ? classifyUas(uas).category === 'micro' : false; } catch { isMicro = false; }
    const anyAbnormal = PREFLIGHT_ITEMS.some((it) => !(isMicro && it.microNa) && !document.getElementById(`pf-${flightId}-${it.key}`)?.checked);
    const note = document.getElementById(`pf-note-${flightId}`);
    if (note) note.classList.toggle('visible', anyAbnormal);
    return;
  }
  if (el.id === 'rep-month') {
    repMonth = el.value;
  }
  if (el.id === 'uas-agri') previewClass();
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (['uas-empty', 'uas-mtow'].includes(el.id)) previewClass();
});

window.addEventListener('hashchange', render);
render();

// 离线可用（PWA）：注册失败静默降级为在线应用
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
