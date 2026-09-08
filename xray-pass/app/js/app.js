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
  addDevice, recordDeviceCheck, setDeviceService,
  addWorker, setWorkerActive, recordTraining, recordDose,
  addChange, fileChange,
  addIncident, fixIncident, closeIncident,
  addShot, removeShot,
  setDutyDone,
  monthlySummary, inspectHtml, shotHtml,
  exportBundle, importBundle,
  DEFAULT_RENEW_WARN_DAYS, DEFAULT_DOSE_WARN_DAYS, DEFAULT_CHECK_WARN_DAYS,
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
  ['#/board', '今日', 'board'], ['#/station', '建档', 'station'], ['#/ledger', '拍片', 'ledger'], ['#/reports', '报表', 'reports'], ['#/settings', '设置', 'settings'],
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

// ---------------------------------------------------------------------------
// 弹窗（续证办结 / 检测完成 / 变更办结 / 事件整改 / 验证关闭 / 快捷登记培训剂量）
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
// 建档（机构 / 设备 / 人员 / 变更 / 义务）
// ---------------------------------------------------------------------------

function submitOrg() {
  const name = val('og-name');
  if (!name) { toast('请填写机构名称'); return; }
  const kind = document.getElementById('og-kind')?.value || 'dental';
  state.org = {
    ...state.org,
    name,
    kind,
    radSafeNo: val('og-radsafeno'),
    radSafeExpiryISO: val('og-radsafeexpiry'),
    radLicenseNo: kind === 'vet' ? '' : val('og-radlicno'),
    radLicenseExpiryISO: kind === 'vet' ? '' : val('og-radlicexpiry'),
    issuer: val('og-issuer'),
    manager: val('og-manager'),
    address: val('og-address'),
    phone: val('og-phone'),
    note: val('og-note'),
  };
  commit('save-org');
  toast('机构信息已保存——双证钟已按有效期起算');
}

function showRenew(key, title, tip) {
  const o = state.org;
  if (!o?.[key]) return;
  openModal(`${title} · ${o.name}`, `
    <p class="fine" style="margin-top:0">${tip}</p>
    <div class="form-grid">
      <label>新证有效期至 *<input id="m-date" type="date" value="" /></label>
      <label class="span2">新证编号<input id="m-no" value="${key === 'radSafeExpiryISO' ? o.radSafeNo : o.radLicenseNo}" placeholder="换证后编号（可空=不变）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      const newExpiry = modalVal('m-date');
      if (!newExpiry) { toast('请填写新证有效期'); return; }
      renewLicense(o, key, newExpiry);
      const no = modalVal('m-no');
      if (no) {
        if (key === 'radSafeExpiryISO') o.radSafeNo = no; else o.radLicenseNo = no;
      }
      closeModal();
      commit('license-renew', { key });
      toast('已办结——证件钟滚动至新有效期');
    } catch (e) { fail(e); }
  };
}

function showRenewRadsafe() {
  showRenew('radSafeExpiryISO', '辐射安全许可证延续办结', '录入新证载明的有效期，证件钟自动滚动 5 年。延续应在届满 30 日前申请（449 号令第 13 条）。');
}

function showRenewRadlicense() {
  showRenew('radLicenseExpiryISO', '放射诊疗许可证校验办结', '录入本次校验后的有效期，校验钟自动滚动。《放射诊疗许可证》与《医疗机构执业许可证》同时校验（46 号令第 17 条）。');
}

function submitDevice() {
  try {
    addDevice(state, {
      name: val('dv-name'),
      code: val('dv-code'),
      deviceClass: document.getElementById('dv-class')?.value || 'Ⅲ类',
      roomNo: val('dv-room'),
      statusCheckISO: val('dv-status'),
      siteCheckISO: val('dv-site'),
      note: val('dv-note'),
    });
    commit('add-device', {});
    toast('设备已建档——状态检测与场所防护双钟按周期自动推导');
  } catch (e) { fail(e); }
}

function showDevCheck(id) {
  const dv = (state.devices ?? []).find((x) => x.id === id);
  if (!dv) return;
  openModal(`检测完成 · ${dv.name}（${dv.code}）`, `
    <p class="fine" style="margin-top:0">录入本次检测完成日期，对应检测钟按周期自动滚动。</p>
    <div class="form-grid">
      <label>检测类型
        <select id="m-kind"><option value="status">状态检测（每年至少一次 · 第 20 条）</option><option value="site">场所防护检测（第 21 条）</option><option value="acceptance">验收检测（新装/维修/换件后 · 第 20 条(一)）</option></select>
      </label>
      <label>完成日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">备注<input id="m-note" placeholder="报告编号/检测机构（可空）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      recordDeviceCheck(state, id, modalVal('m-kind') || 'status', modalVal('m-date') || todayISO(), modalVal('m-note'));
      closeModal();
      commit('device-check', {});
      toast('检测已录——检测钟已滚动');
    } catch (e) { fail(e); }
  };
}

function toggleDevice(id) {
  try {
    const dv = (state.devices ?? []).find((x) => x.id === id);
    setDeviceService(state, id, !!dv?.outISO, todayISO());
    commit('toggle-device', {});
    toast(dv?.outISO ? '设备已复用在用' : '设备已停用——拍片闸不可选停用设备');
  } catch (e) { fail(e); }
}

function deleteDevice(id) {
  try {
    const rec = (state.devices ?? []).find((x) => x.id === id);
    state.devices = state.devices.filter((x) => x.id !== id);
    commit('del-device');
    toast(`已删除 ${rec?.name ?? id} 的档案`);
  } catch (e) { fail(e); }
}

function submitWorker() {
  try {
    addWorker(state, {
      name: val('wk-name'),
      certNo: val('wk-certno'),
      trainingISO: val('wk-training'),
      doseISO: val('wk-dose'),
      note: val('wk-note'),
    });
    commit('add-worker', {});
    toast('已入册——培训钟与剂量钟按周期自动推导');
  } catch (e) { fail(e); }
}

function toggleWorker(id) {
  try {
    const rec = (state.workers ?? []).find((w) => w.id === id);
    setWorkerActive(state, id, !(rec?.active));
    commit('toggle-worker', {});
    toast(rec?.active ? '已停用——历史拍片单仍可回溯到当日操作者' : '已恢复在册');
  } catch (e) { fail(e); }
}

/** 快捷登记：某名人员的培训考核完成 + 剂量报告读取（拍片页直达） */
function showQuickFix(id) {
  const w = (state.workers ?? []).find((x) => x.id === id);
  if (!w) return;
  openModal(`登记培训/剂量 · ${w.name}`, `
    <p class="fine" style="margin-top:0">登记后对应钟自动滚动：培训 +2 年（惯例）、剂量 +90 天上限（55 号令第十一条）。至少填一项。</p>
    <div class="form-grid">
      <label>培训考核完成日<input id="m-training" type="date" value="" /></label>
      <label>剂量报告日<input id="m-dose" type="date" value="" /></label>
      <label>剂量读数（mSv）<input id="m-msv" placeholder="可空" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      const trISO = modalVal('m-training');
      const doISO = modalVal('m-dose');
      if (!trISO && !doISO) { toast('至少填写一项日期'); return; }
      if (trISO) recordTraining(state, id, trISO);
      if (doISO) recordDose(state, id, doISO, modalVal('m-msv'));
      closeModal();
      commit('worker-quickfix', {});
      toast('已登记——人员钟已滚动');
    } catch (e) { fail(e); }
  };
}

function submitChange() {
  try {
    addChange(state, {
      dateISO: val('cg-date') || todayISO(),
      kind: document.getElementById('cg-kind')?.value || 'other',
      detail: val('cg-detail'),
    });
    commit('add-change', {});
    toast('变更已登记——向发证机关办理后点「办结」');
  } catch (e) { fail(e); }
}

function showFileChange(id) {
  const c = (state.changes ?? []).find((x) => x.id === id);
  if (!c) return;
  openModal(`变更办结 · ${c.detail}`, `
    <p class="fine" style="margin-top:0">向发证机关办理变更/重新申领手续完成（449 号令第 11/12 条），录入办理回执日期。</p>
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
// 拍片六道闸 / 事件闭环
// ---------------------------------------------------------------------------

function submitShot() {
  const payload = {
    dateISO: val('sh-date') || todayISO(),
    deviceId: document.getElementById('sh-device')?.value || '',
    workerId: document.getElementById('sh-worker')?.value || '',
    patientType: document.getElementById('sh-ptype')?.value || 'adult',
    pregnancy: document.getElementById('sh-preg')?.value || '',
    special: document.getElementById('sh-special')?.value === 'yes',
    bodyPart: val('sh-bodypart'),
    note: val('sh-note'),
  };
  try {
    addShot(state, payload);
    commit('add-shot', {});
    toast('✅ 拍片已落账——六道闸全过，合规快照已存');
  } catch (e) {
    // 闸机拦截：埋点留痕——每次拦截都是没被罚的证据
    track(state, 'shot-gate-blocked', { reasons: String(e?.message ?? e).slice(0, 500), dateISO: payload.dateISO });
    saveState(state);
    toast(`⛔ ${String(e?.message ?? e).slice(0, 160)}`);
  }
}

function deleteShot(id) {
  try {
    removeShot(state, id);
    commit('del-shot');
    toast('已删除该拍片记录');
  } catch (e) { fail(e); }
}

function submitIncident() {
  try {
    addIncident(state, {
      dateISO: val('in-date') || todayISO(),
      source: document.getElementById('in-source')?.value || 'selfcheck',
      desc: val('in-desc'),
    });
    commit('add-incident', {});
    toast('事件/隐患已登记——整改、验证关闭后闭环');
  } catch (e) { fail(e); }
}

function showFixIncident(id) {
  const n = (state.incidents ?? []).find((x) => x.id === id);
  if (!n) return;
  openModal(`整改 · ${n.desc}`, `
    <p class="fine" style="margin-top:0">整改必须写明措施与完成日，只打勾不留痕不算整改。</p>
    <div class="form-grid">
      <label>整改完成日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">整改措施 *<input id="m-action" placeholder="如：联锁已修复并复测合格 / 已送读剂量计并调查原因" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      fixIncident(state, id, { actionISO: modalVal('m-date') || todayISO(), action: modalVal('m-action') });
      closeModal();
      commit('fix-incident', {});
      toast('整改已登记——验证关闭后闭环');
    } catch (e) { fail(e); }
  };
}

function showCloseIncident(id) {
  const n = (state.incidents ?? []).find((x) => x.id === id);
  if (!n) return;
  openModal(`验证关闭 · ${n.desc}`, `
    <p class="fine" style="margin-top:0">整改措施：${n.action || '—'}（${n.actionISO || '—'}）。验证建议由辐射安全管理负责人执行。</p>
    <div class="form-grid">
      <label>验证日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>验证人 *<input id="m-verifier" value="${state.org?.manager || ''}" placeholder="建议辐射安全负责人" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeIncident(state, id, { verifyISO: modalVal('m-date') || todayISO(), verifiedBy: modalVal('m-verifier') });
      closeModal();
      commit('close-incident', {});
      toast('已验证关闭——闭环台账完整在档');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 拍片核对单）
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
    downloadFile(`放射诊疗合规迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function shotDownload() {
  const shotId = document.getElementById('case-shot')?.value;
  if (!shotId) { toast('请先过闸落账拍片'); return; }
  try {
    const html = shotHtml(state, shotId, todayISO());
    track(state, 'shot-print', { shotId });
    downloadFile(`拍片合规核对单_${todayISO()}.html`, html, 'text/html');
    toast('核对单已下载——纠纷或抽档 10 秒自证');
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
    toast('已复制——去微信粘贴存档');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴存档');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function submitSettings() {
  const renew = Number(document.getElementById('set-renew')?.value);
  const dose = Number(document.getElementById('set-dose')?.value);
  const check = Number(document.getElementById('set-check')?.value);
  state.settings = {
    renewWarnDays: Number.isInteger(renew) && renew >= 15 && renew <= 365 ? renew : DEFAULT_RENEW_WARN_DAYS,
    doseWarnDays: Number.isInteger(dose) && dose >= 7 && dose <= 60 ? dose : DEFAULT_DOSE_WARN_DAYS,
    checkWarnDays: Number.isInteger(check) && check >= 7 && check <= 120 ? check : DEFAULT_CHECK_WARN_DAYS,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`拍片单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`拍片单使用记录_${todayISO()}.json`, JSON.stringify(state.traces ?? [], null, 2), 'application/json');
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
  state.org = {
    name: '明澈口腔门诊部（示例）', kind: 'dental',
    radSafeNo: 'X环辐证〔2023〕0812 号', radSafeExpiryISO: isoAgo(today, -20),
    radLicenseNo: '辐诊证〔2025〕第 0330 号', radLicenseExpiryISO: isoAgo(today, -120),
    issuer: 'X市生态环境局 / X区卫生健康委', address: 'X市X区望江路 56 号 2 层',
    manager: '沈清辉', phone: '028-88662300',
    note: '2023-10 首次取得辐射安全许可证（5 年）；放射诊疗许可随执业许可年度校验',
  };
  state.devices = [];
  state.deviceSeq = 0;
  state.workers = [];
  state.workerSeq = 0;
  state.shots = [];
  state.shotSeq = 0;
  state.incidents = [];
  state.incidentSeq = 0;
  state.changes = [];
  state.changeSeq = 0;
  state.duties = [];

  // 设备：牙科机状态检测临期 10 天（黄）/ 口腔 CT 状态检测超期 35 天（红灯，拍片会被拦）
  const dx = addDevice(state, { name: '牙科 X 射线机', code: 'DX-01', deviceClass: 'Ⅲ类', roomNo: '1 号机房', statusCheckISO: isoAgo(today, 355), siteCheckISO: isoAgo(today, 200), note: '装机 2023-10，验收检测已做' });
  addDevice(state, { name: '口腔 CT（CBCT）', code: 'CBCT-02', deviceClass: 'Ⅲ类', roomNo: '2 号机房', statusCheckISO: isoAgo(today, 400), siteCheckISO: isoAgo(today, 380), note: '年度状态检测已拖——约检中' });

  // 人员：王明澈全绿 / 李知行培训超期 + 剂量超 90 天上限（红灯）
  const wm = addWorker(state, { name: '王明澈', certNo: 'FS-PEIXUN-2025-0271', trainingISO: isoAgo(today, 300), doseISO: isoAgo(today, 20), lastDoseMsv: '0.08' });
  addWorker(state, { name: '李知行', certNo: 'FS-PEIXUN-2022-0198', trainingISO: isoAgo(today, 800), doseISO: isoAgo(today, 100), note: '培训与剂量均超期——拍片点名会被拦' });

  // 昨天：王明澈用牙科机给成人拍片，合规落账
  addShot(state, { dateISO: isoAgo(today, 1), deviceId: dx.id, workerId: wm.id, patientType: 'adult', bodyPart: '36 根尖片', note: '' });

  // 变更：新增 CBCT 按原程序重新申领中（未办结——黄灯示例）
  addChange(state, { dateISO: isoAgo(today, 400), kind: 'facility', detail: '2 号机房新建并新装口腔 CT 一台（重新申领许可证，已获批复待领证）' });
  // 注意：该记录 400 天前发生仍未办结，属示例红灯；实际办结后点「办结」

  // 周期义务：年度评估逾期 40 天（红）/ 演练在期 / 健康检查提醒逾期（黄——归岗卫账）
  setDutyDone(state, 'annualeval', isoAgo(today, 405), '2025 年度辐射安全和防护状况评估报告已提交');
  setDutyDone(state, 'drill', isoAgo(today, 50), '放射事件应急演练（失联锁情景）');
  setDutyDone(state, 'healthcheck', isoAgo(today, 750), '全员职业健康检查（组织归岗卫账）');

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
    case 'save-org': submitOrg(); break;
    case 'show-renew-radsafe': showRenewRadsafe(); break;
    case 'show-renew-radlicense': showRenewRadlicense(); break;
    case 'add-device': submitDevice(); break;
    case 'show-dev-check': showDevCheck(idx); break;
    case 'toggle-device': toggleDevice(idx); break;
    case 'del-device': deleteDevice(idx); break;
    case 'add-worker': submitWorker(); break;
    case 'toggle-worker': toggleWorker(idx); break;
    case 'quick-fix': showQuickFix(idx); break;
    case 'add-change': submitChange(); break;
    case 'show-file-change': showFileChange(idx); break;
    case 'set-duty': submitDuty(); break;
    case 'add-shot': submitShot(); break;
    case 'del-shot': deleteShot(idx); break;
    case 'add-incident': submitIncident(); break;
    case 'show-fix-incident': showFixIncident(idx); break;
    case 'show-close-incident': showCloseIncident(idx); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'shot-download': shotDownload(); break;
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
