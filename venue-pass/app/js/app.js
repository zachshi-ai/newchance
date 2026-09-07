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
  renewLicense,
  addStaff, setStaffActive,
  addGear, recordGearCheck, setGearService,
  addChange, fileChange,
  addHazard, fixHazard, closeHazard,
  recordDaycheck, daycheckItemsFor,
  addOpening, removeOpening,
  setDutyDone,
  monthlySummary, inspectHtml, openPassHtml,
  exportBundle, importBundle,
  DEFAULT_RENEW_WARN_DAYS, DEFAULT_GEAR_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
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
  ['#/board', '今日', 'board'], ['#/station', '建档', 'station'], ['#/ledger', '开馆', 'ledger'], ['#/reports', '报表', 'reports'], ['#/settings', '设置', 'settings'],
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

function multiVal(id) {
  const el = document.getElementById(id);
  return el ? [...el.selectedOptions].map((o) => o.value).filter(Boolean) : [];
}

// ---------------------------------------------------------------------------
// 弹窗（续期办结 / 检验完成 / 变更办结 / 隐患整改 / 复查销案）
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
// 建档（场馆 / 人员 / 器材 / 变更 / 义务）
// ---------------------------------------------------------------------------

function submitVenue() {
  const name = val('vs-name');
  if (!name) { toast('请填写场馆名称'); return; }
  const projects = ['ski', 'dive', 'climb'].filter((k) => document.getElementById(`proj-${k}`)?.checked);
  if (!projects.length) { toast('请至少勾选一个经营项目——日检卡与检查口径按项目生成'); return; }
  const minStaff = Number(val('vs-minstaff'));
  state.venue = {
    ...state.venue,
    name,
    licenseNo: val('vs-licno'),
    issuer: val('vs-issuer'),
    licenseExpiryISO: val('vs-licexpiry'),
    projects,
    minStaffPerDay: Number.isInteger(minStaff) && minStaff > 0 ? minStaff : 0,
    address: val('vs-address'),
    manager: val('vs-manager'),
    phone: val('vs-phone'),
    note: val('vs-note'),
  };
  commit('save-venue');
  toast('场馆信息已保存——许可证钟已按有效期起算');
}

function showRenew() {
  const v = state.venue;
  if (!v?.licenseExpiryISO) return;
  openModal(`续期办结 · ${v.name}`, `
    <p class="fine" style="margin-top:0">录入新证载明的有效期，许可证钟自动滚动。续期应在旧证届满 30 日前申请（17 号令第 14 条）。</p>
    <div class="form-grid">
      <label>新证有效期至 *<input id="m-date" type="date" value="" /></label>
      <label class="span2">新证编号<input id="m-no" value="${v.licenseNo}" placeholder="换证后编号（可空=不变）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      const newExpiry = modalVal('m-date');
      if (!newExpiry) { toast('请填写新证有效期'); return; }
      renewLicense(v, newExpiry);
      const no = modalVal('m-no');
      if (no) v.licenseNo = no;
      closeModal();
      commit('license-renew', {});
      toast('续期已办结——许可证钟滚动至新有效期');
    } catch (e) { fail(e); }
  };
}

function submitStaff() {
  try {
    addStaff(state, {
      name: val('ppl-name'),
      role: document.getElementById('ppl-role')?.value || 'instructor',
      certName: val('ppl-certname'),
      certNo: val('ppl-certno'),
      certValidISO: val('ppl-certvalid'),
      note: val('ppl-note'),
    });
    commit('add-staff', {});
    toast('已入册——开馆点名与证书钟以此为准');
  } catch (e) { fail(e); }
}

function toggleStaff(id) {
  try {
    const rec = (state.staff ?? []).find((s) => s.id === id);
    setStaffActive(state, id, !(rec?.active));
    commit('toggle-staff', {});
    toast(rec?.active ? '已停用——历史开馆单仍可回溯到当日名册' : '已恢复在册');
  } catch (e) { fail(e); }
}

function submitGear() {
  try {
    addGear(state, {
      name: val('gr-name'),
      code: val('gr-code'),
      cycleMonths: Number(document.getElementById('gr-cycle')?.value) || undefined,
      lastCheckISO: val('gr-last'),
      note: val('gr-note'),
    });
    commit('add-gear', {});
    toast('器材已建档——检验钟按周期自动推导');
  } catch (e) { fail(e); }
}

function showGearCheck(id) {
  const g = (state.gear ?? []).find((x) => x.id === id);
  if (!g) return;
  openModal(`检验完成 · ${g.name}（${g.code}）`, `
    <p class="fine" style="margin-top:0">录入本次检查/检验完成日期，到期钟按 ${g.cycleMonths} 个月周期自动滚动。</p>
    <div class="form-grid">
      <label>完成日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">备注<input id="m-note" placeholder="报告编号/机构（可空）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      recordGearCheck(state, id, modalVal('m-date') || todayISO(), modalVal('m-note'));
      closeModal();
      commit('gear-check', {});
      toast('检验已录——到期钟已滚动');
    } catch (e) { fail(e); }
  };
}

function toggleGear(id) {
  try {
    const g = (state.gear ?? []).find((x) => x.id === id);
    setGearService(state, id, !!g?.outISO, todayISO());
    commit('toggle-gear', {});
    toast(g?.outISO ? '器材已复用在用' : '器材已停用——送检/待换期间不参与接待');
  } catch (e) { fail(e); }
}

function deleteGear(id) {
  try {
    const rec = (state.gear ?? []).find((x) => x.id === id);
    state.gear = state.gear.filter((x) => x.id !== id);
    commit('del-gear');
    toast(`已删除 ${rec?.name ?? id} 的档案`);
  } catch (e) { fail(e); }
}

function submitChange() {
  try {
    addChange(state, {
      dateISO: val('cg-date') || todayISO(),
      kind: document.getElementById('cg-kind')?.value || 'other',
      detail: val('cg-detail'),
    });
    commit('add-change', {});
    toast('变更已登记——向体育部门办理后点「办结」');
  } catch (e) { fail(e); }
}

function showFileChange(id) {
  const c = (state.changes ?? []).find((x) => x.id === id);
  if (!c) return;
  openModal(`变更办结 · ${c.detail}`, `
    <p class="fine" style="margin-top:0">向体育部门办理变更手续完成（17 号令第 14 条），录入办理回执日期。</p>
    <div class="form-grid">
      <label>办理日期 *<input id="m-date" type="date" value="${todayISO()}" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      fileChange(state, id, modalVal('m-date') || todayISO());
      closeModal();
      commit('file-change', {});
      toast('变更已办结');
    } catch (e) { fail(e); }
  };
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
// 开馆五道闸 / 日检 / 隐患
// ---------------------------------------------------------------------------

function submitOpening() {
  const payload = {
    dateISO: val('op-date') || todayISO(),
    staffIds: multiVal('op-staff'),
    note: val('op-note'),
  };
  try {
    addOpening(state, payload);
    commit('add-opening', {});
    toast('✅ 开馆单已落——五道闸全过，当日快照已存');
  } catch (e) {
    // 闸机拦截：埋点留痕——每次拦截都是没被罚的证据
    track(state, 'open-gate-blocked', { reasons: String(e?.message ?? e).slice(0, 500), dateISO: payload.dateISO });
    saveState(state);
    toast(`⛔ ${String(e?.message ?? e).slice(0, 160)}`);
  }
}

function deleteOpening(id) {
  try {
    removeOpening(state, id);
    commit('del-opening');
    toast('已删除该开馆单');
  } catch (e) { fail(e); }
}

function submitDaycheck() {
  const dateISO = todayISO();
  const results = {};
  for (const it of daycheckItemsFor(state)) {
    results[it.key] = {
      ok: !!document.getElementById(`dc-${it.key}`)?.checked,
      note: document.getElementById(`dcnote-${it.key}`)?.value?.trim() ?? '',
    };
  }
  try {
    const rec = recordDaycheck(state, { dateISO, results, note: '' });
    commit('add-daycheck', {});
    toast(rec.status === 'issue'
      ? '检查卡已落——异常已自动转隐患，闭环前开馆闸不放行'
      : '检查卡已落，全项正常——可以去过闸开馆');
  } catch (e) { fail(e); }
}

function submitHazard() {
  try {
    addHazard(state, {
      dateISO: val('hz-date') || todayISO(),
      source: document.getElementById('hz-source')?.value || 'selfcheck',
      desc: val('hz-desc'),
    });
    commit('add-hazard', {});
    toast('隐患已登记——整改、复查销案后闭环');
  } catch (e) { fail(e); }
}

function showFixHazard(id) {
  const h = (state.hazards ?? []).find((x) => x.id === id);
  if (!h) return;
  openModal(`隐患整改 · ${h.desc}`, `
    <p class="fine" style="margin-top:0">整改必须写明措施与完成日，只打勾不留痕不算整改。</p>
    <div class="form-grid">
      <label>整改完成日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">整改措施 *<input id="m-action" placeholder="如：垫块复位并加固，全场坠落区复巡一遍" /></label>
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
  openModal(`复查销案 · ${h.desc}`, `
    <p class="fine" style="margin-top:0">整改措施：${h.action || '—'}（${h.actionISO || '—'}）。销案建议由场馆负责人执行；闭环后开馆闸恢复放行。</p>
    <div class="form-grid">
      <label>复查日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>复查人 *<input id="m-verifier" value="${state.venue?.manager || ''}" placeholder="建议场馆负责人" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeHazard(state, id, { verifyISO: modalVal('m-date') || todayISO(), verifiedBy: modalVal('m-verifier') });
      closeModal();
      commit('close-hazard', {});
      toast('已复查销案——隐患闭环，开馆闸放行');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 开馆单打印版）
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
    downloadFile(`高危体育场馆合规迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function openingDownload() {
  const openingId = document.getElementById('case-opening')?.value;
  if (!openingId) { toast('请先过闸开出开馆单'); return; }
  try {
    const html = openPassHtml(state, openingId, todayISO());
    track(state, 'opening-print', { openingId });
    downloadFile(`当日开馆单_${todayISO()}.html`, html, 'text/html');
    toast('开馆单已下载——打印贴前台，检查进门 10 秒出示');
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
    toast('已复制——去微信粘贴存档或报合伙人');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴存档或报合伙人');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function submitSettings() {
  const renew = Number(document.getElementById('set-renew')?.value);
  const gear = Number(document.getElementById('set-gear')?.value);
  const duty = Number(document.getElementById('set-duty')?.value);
  state.settings = {
    renewWarnDays: Number.isInteger(renew) && renew >= 15 && renew <= 365 ? renew : DEFAULT_RENEW_WARN_DAYS,
    gearWarnDays: Number.isInteger(gear) && gear >= 7 && gear <= 120 ? gear : DEFAULT_GEAR_WARN_DAYS,
    dutyWarnDays: Number.isInteger(duty) && duty >= 7 && duty <= 120 ? duty : DEFAULT_DUTY_WARN_DAYS,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`开馆单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`开馆单使用记录_${todayISO()}.json`, JSON.stringify(state.traces ?? [], null, 2), 'application/json');
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
  state.venue = {
    name: '岩语攀岩馆（示例）', licenseNo: '高体证字〔2024〕第 0102 号', issuer: 'XX市体育局',
    licenseExpiryISO: isoAgo(today, -25), projects: ['climb'], minStaffPerDay: 2,
    address: 'XX市高新区活力大道 12 号 L3', manager: '沈磐石', phone: '0571-88662300',
    note: '2024-05-20 首次取得许可，2026-10-03 届满；14 条攀石/难度 lanes',
  };
  state.staff = [];
  state.staffSeq = 0;
  state.gear = [];
  state.gearSeq = 0;
  state.daychecks = [];
  state.daycheckSeq = 0;
  state.openings = [];
  state.openingSeq = 0;
  state.hazards = [];
  state.hazardSeq = 0;
  state.changes = [];
  state.changeSeq = 0;
  state.duties = [];

  // 人员：2 名指导员 + 2 名救助员（1 名证书过期 15 天=红灯，1 名临期 20 天=黄）
  const lin = addStaff(state, { name: '林晚秋', role: 'instructor', certName: '社会体育指导员（攀岩）', certNo: 'ZY2023-3301**88', certValidISO: isoAgo(today, -800), note: '馆长，中级' });
  const chen = addStaff(state, { name: '陈之涣', role: 'instructor', certName: '社会体育指导员（攀岩）', certNo: 'ZY2024-3301**12', certValidISO: isoAgo(today, -20), note: '全职' });
  addStaff(state, { name: '韩江雪', role: 'rescuer', certName: '救助人员国家职业资格证', certNo: 'JZ2022-3301**56', certValidISO: isoAgo(today, 15), note: '证书过期待复审——开馆点名不可用' });
  addStaff(state, { name: '苏千帆', role: 'rescuer', certName: '救助人员国家职业资格证', certNo: 'JZ2024-3301**34', certValidISO: isoAgo(today, -300), note: '兼职周末班' });

  // 器材：动力绳在期 / 安全带临期 25 天（黄）/ 头盔超期 35 天（红灯）
  addGear(state, { name: '动力绳 60m', code: 'ROPE-01', cycleMonths: 12, lastCheckISO: isoAgo(today, 120), note: 'BEAL，出厂 2025-03' });
  addGear(state, { name: '安全带（馆用）×20', code: 'HAR-03', cycleMonths: 12, lastCheckISO: isoAgo(today, 340), note: 'Petzl 抽检' });
  addGear(state, { name: '头盔（馆用）×20', code: 'HEM-05', cycleMonths: 12, lastCheckISO: isoAgo(today, 400), note: '待整体更换' });
  addGear(state, { name: '坠落区缓冲垫 B 区', code: 'MAT-B', cycleMonths: 6, lastCheckISO: isoAgo(today, 60), note: '季度翻检' });

  // 昨天：全项正常日检 + 已开馆（闸机全过）
  const yesterday = isoAgo(today, 1);
  const itemsY = daycheckItemsFor(state);
  recordDaycheck(state, {
    dateISO: yesterday,
    results: Object.fromEntries(itemsY.map((it) => [it.key, { ok: true, note: '' }])),
  });
  addOpening(state, { dateISO: yesterday, staffIds: [lin.id, chen.id], note: '常规营业' });

  // 今天：日检 1 项异常 → 自动转隐患（未闭环=开馆闸第 5 道拦截）
  const itemsT = daycheckItemsFor(state);
  recordDaycheck(state, {
    dateISO: today,
    results: Object.fromEntries(itemsT.map((it) => it.key === 'climb:landing'
      ? [it.key, { ok: false, note: 'B 区两块垫块移位，已拉警戒线，待复位加固' }]
      : [it.key, { ok: true, note: '' }])),
  });

  // 变更：1 项未办结（经营者变更中——黄灯示例）
  addChange(state, { dateISO: isoAgo(today, 35), kind: 'person', detail: '经营者由个体变更为公司（岩语体育发展有限公司，已报材料待回执）' });

  // 周期义务：演练逾期 20 天（红）/ 培训在期 / 设施检测逾期 5 天（红）/ 保险在期
  setDutyDone(state, 'drill', isoAgo(today, 200), '坠落救援演练（全员）');
  setDutyDone(state, 'training', isoAgo(today, 60), '新国标 GB 19079.4 宣贯与保护技术复训');
  setDutyDone(state, 'facility', isoAgo(today, 370), '设施符合国标说明性材料（首次申证版）');
  setDutyDone(state, 'insurance', isoAgo(today, 30), '公众责任险（保单 PL2026-0331）');

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
    case 'save-venue': submitVenue(); break;
    case 'show-renew': showRenew(); break;
    case 'add-staff': submitStaff(); break;
    case 'toggle-staff': toggleStaff(idx); break;
    case 'add-gear': submitGear(); break;
    case 'show-gear-check': showGearCheck(idx); break;
    case 'toggle-gear': toggleGear(idx); break;
    case 'del-gear': deleteGear(idx); break;
    case 'add-change': submitChange(); break;
    case 'show-file-change': showFileChange(idx); break;
    case 'set-duty': submitDuty(); break;
    case 'add-opening': submitOpening(); break;
    case 'del-opening': deleteOpening(idx); break;
    case 'add-daycheck': submitDaycheck(); break;
    case 'add-hazard': submitHazard(); break;
    case 'show-fix-hazard': showFixHazard(idx); break;
    case 'show-close-hazard': showCloseHazard(idx); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'opening-download': openingDownload(); break;
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
