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
  renewCert,
  addCapability, setCapabilityStatus,
  addEquipment, recordCalibration, setEquipService,
  addStaff, setStaffActive,
  addChange, fileChange,
  addNC, fixNC, closeNC,
  addQuality, removeQuality,
  addReport, removeReport, reportGate,
  setDutyDone,
  monthlySummary, inspectHtml, reportHtml,
  exportBundle, importBundle,
  DEFAULT_RENEW_WARN_DAYS, CALIB_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
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

function multiVal(id) {
  const el = document.getElementById(id);
  return el ? [...el.selectedOptions].map((o) => o.value).filter(Boolean) : [];
}

// ---------------------------------------------------------------------------
// 弹窗（延续办结 / 参数停用 / 溯源完成 / 变更办结 / 不符合项整改 / 验证关闭 / 到期处置）
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
// 建档（机构 / 能力附表 / 设备 / 人员 / 变更 / 义务）
// ---------------------------------------------------------------------------

function submitStation() {
  const name = val('st-name');
  if (!name) { toast('请填写机构名称'); return; }
  state.station = {
    ...state.station,
    name,
    certNo: val('st-certno'),
    issuer: val('st-issuer'),
    certExpiryISO: val('st-certexpiry'),
    field: val('st-field'),
    manager: val('st-manager'),
    techLeader: val('st-tech'),
    qualityLeader: val('st-quality'),
    address: val('st-address'),
    note: val('st-note'),
  };
  commit('save-station');
  toast('机构信息已保存——证书钟已按有效期起算');
}

function showRenew() {
  const s = state.station;
  if (!s?.certExpiryISO) return;
  openModal(`延续办结 · ${s.name}`, `
    <p class="fine" style="margin-top:0">录入新证书载明的有效期，证书钟自动滚动 6 年（163 号令现行版第 13 条）。延续申请应在旧证届满 3 个月前提出。</p>
    <div class="form-grid">
      <label>新证书有效期至 *<input id="m-date" type="date" value="" /></label>
      <label class="span2">新证书编号<input id="m-certno" value="${s.certNo}" placeholder="换证后编号（可空=不变）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      const newExpiry = modalVal('m-date');
      if (!newExpiry) { toast('请填写新证书有效期'); return; }
      renewCert(s, newExpiry);
      const no = modalVal('m-certno');
      if (no) s.certNo = no;
      closeModal();
      commit('cert-renew', {});
      toast('延续已办结——证书钟滚动至新有效期');
    } catch (e) { fail(e); }
  };
}

function submitCap() {
  try {
    addCapability(state, {
      name: val('cap-name'),
      standard: val('cap-standard'),
      remark: val('cap-remark'),
    });
    commit('add-cap', {});
    toast('参数已录入能力附表——报告闸的可用范围以此为准');
  } catch (e) { fail(e); }
}

function showSuspendCap(id) {
  const cap = (state.capabilities ?? []).find((c) => c.id === id);
  if (!cap) return;
  openModal(`停用参数 · ${cap.name}`, `
    <p class="fine" style="margin-top:0">项目取消/暂停检测应停用参数并办理变更手续（163 号令第 14 条(三)）；停用期间出报告闸不放行。</p>
    <div class="form-grid">
      <label class="span2">停用原因 *<input id="m-reason" placeholder="如：项目取消 / 设备退役" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      setCapabilityStatus(state, id, 'suspended', modalVal('m-reason'));
      closeModal();
      commit('suspend-cap', {});
      toast('参数已停用——建议同时在「变更台账」登记项目取消');
    } catch (e) { fail(e); }
  };
}

function resumeCap(id) {
  try {
    setCapabilityStatus(state, id, 'active');
    commit('resume-cap', {});
    toast('参数已恢复在用');
  } catch (e) { fail(e); }
}

function deleteCap(id) {
  try {
    const rec = (state.capabilities ?? []).find((c) => c.id === id);
    state.capabilities = state.capabilities.filter((c) => c.id !== id);
    commit('del-cap');
    toast(`已删除 ${rec?.name ?? id}`);
  } catch (e) { fail(e); }
}

function submitEquip() {
  try {
    addEquipment(state, {
      name: val('eq-name'),
      code: val('eq-code'),
      capIds: multiVal('eq-caps'),
      calibType: document.getElementById('eq-calibtype')?.value || 'calibrate',
      cycleMonths: Number(document.getElementById('eq-cycle')?.value) || undefined,
      lastCalibISO: val('eq-lastcalib'),
      note: val('eq-note'),
    });
    commit('add-equip', {});
    toast('设备已建档——溯源钟按周期自动推导');
  } catch (e) { fail(e); }
}

function showCalib(id) {
  const eq = (state.equipments ?? []).find((x) => x.id === id);
  if (!eq) return;
  openModal(`溯源完成 · ${eq.name}（${eq.code}）`, `
    <p class="fine" style="margin-top:0">录入本次检定/校准/核查完成日期，到期钟按 ${eq.cycleMonths} 个月周期自动滚动。</p>
    <div class="form-grid">
      <label>完成日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">备注<input id="m-note" placeholder="证书编号/机构（可空）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      recordCalibration(state, id, modalVal('m-date') || todayISO(), modalVal('m-note'));
      closeModal();
      commit('equip-calib', {});
      toast('溯源已录——该参数恢复可用');
    } catch (e) { fail(e); }
  };
}

function toggleEquip(id) {
  try {
    const eq = (state.equipments ?? []).find((x) => x.id === id);
    setEquipService(state, id, !!eq?.outOfServiceISO, todayISO());
    commit('toggle-equip', {});
    toast(eq?.outOfServiceISO ? '设备已复用在用' : '设备已停用——关联参数出报告闸不放行');
  } catch (e) { fail(e); }
}

function deleteEquip(id) {
  try {
    const rec = (state.equipments ?? []).find((x) => x.id === id);
    state.equipments = state.equipments.filter((x) => x.id !== id);
    commit('del-equip');
    toast(`已删除 ${rec?.name ?? id} 的档案`);
  } catch (e) { fail(e); }
}

function submitStaff() {
  try {
    addStaff(state, {
      name: val('ppl-name'),
      role: document.getElementById('ppl-role')?.value || 'tester',
      title: val('ppl-title'),
      certValidISO: val('ppl-certvalid'),
      note: val('ppl-note'),
    });
    commit('add-staff', {});
    toast('已入册——授权签字人出报告闸可选用');
  } catch (e) { fail(e); }
}

function toggleStaff(id) {
  try {
    const rec = (state.staff ?? []).find((s) => s.id === id);
    setStaffActive(state, id, !(rec?.active));
    commit('toggle-staff', {});
    toast(rec?.active ? '已停用——历史报告仍可回溯到签发人' : '已恢复在册');
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
    toast('变更已登记——向资质认定部门办理后点「办结」');
  } catch (e) { fail(e); }
}

function showFileChange(id) {
  const c = (state.changes ?? []).find((x) => x.id === id);
  if (!c) return;
  openModal(`变更办结 · ${c.detail}`, `
    <p class="fine" style="margin-top:0">向资质认定部门办理变更手续完成（163 号令现行版第 14 条），录入办理回执日期。</p>
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
// 报告三道闸 / 质量记录 / 不符合项
// ---------------------------------------------------------------------------

function submitReport() {
  const payload = {
    reportNo: val('rp-no'),
    dateISO: val('rp-date') || todayISO(),
    client: val('rp-client'),
    paramIds: multiVal('rp-params'),
    signerId: document.getElementById('rp-signer')?.value || '',
    cmaMarked: checked('rp-cma'),
    subcontract: val('rp-subcontract'),
    note: val('rp-note'),
  };
  const gate = reportGate(state, payload);
  if (!gate.ok) {
    track(state, 'report-gate-blocked', { reasons: gate.reasons, dateISO: payload.dateISO });
    saveState(state);
    toast(`⛔ 出报告被闸机拒绝：${gate.reasons[0]}${gate.reasons.length > 1 ? `（另有 ${gate.reasons.length - 1} 项，见体检明细）` : ''}`);
    return;
  }
  try {
    addReport(state, payload);
    commit('add-report', {});
    toast('报告已落账——三道闸全过，合规快照与 6 年保存钟已起算');
  } catch (e) { fail(e); }
}

function deleteReport(id) {
  try {
    removeReport(state, id);
    commit('del-report');
    toast('已删除该报告记录');
  } catch (e) { fail(e); }
}

function submitQuality() {
  try {
    addQuality(state, {
      kind: document.getElementById('qt-kind')?.value || 'qc',
      dateISO: val('qt-date') || todayISO(),
      title: val('qt-title'),
      result: document.getElementById('qt-result')?.value || 'pass',
      capabilityId: document.getElementById('qt-cap')?.value || '',
    });
    commit('add-quality', {});
    toast('质量记录已登记——内审/管评同年度唯一，能力验证不合格将自动停报参数');
  } catch (e) { fail(e); }
}

function deleteQuality(id) {
  try {
    removeQuality(state, id);
    commit('del-quality');
    toast('已删除该质量记录');
  } catch (e) { fail(e); }
}

function submitNC() {
  try {
    addNC(state, {
      dateISO: val('nc-date') || todayISO(),
      source: document.getElementById('nc-source')?.value || 'manual',
      desc: val('nc-desc'),
      capabilityId: document.getElementById('nc-cap')?.value || '',
      suspendCap: !!document.getElementById('nc-cap')?.value,
    });
    commit('add-nc', {});
    toast('不符合项已登记——整改、验证关闭后闭环');
  } catch (e) { fail(e); }
}

function showFixNC(id) {
  const n = (state.ncs ?? []).find((x) => x.id === id);
  if (!n) return;
  openModal(`不符合项整改 · ${n.desc}`, `
    <p class="fine" style="margin-top:0">整改必须写明纠正措施与完成日，只打勾不留痕不算整改。</p>
    <div class="form-grid">
      <label>整改完成日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">纠正措施 *<input id="m-action" placeholder="如：重做能力验证合格 / 修订温湿度记录规程并培训" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      fixNC(state, id, { actionISO: modalVal('m-date') || todayISO(), action: modalVal('m-action') });
      closeModal();
      commit('fix-nc', {});
      toast('整改已登记——验证关闭后闭环（停报参数同时恢复）');
    } catch (e) { fail(e); }
  };
}

function showCloseNC(id) {
  const n = (state.ncs ?? []).find((x) => x.id === id);
  if (!n) return;
  openModal(`验证关闭 · ${n.desc}`, `
    <p class="fine" style="margin-top:0">整改措施：${n.action || '—'}（${n.actionISO || '—'}）。验证建议由质量负责人执行${n.capName ? '；能力验证不合格项关闭即确认通过，停报参数自动恢复（能力验证办法第 20 条）' : ''}。</p>
    <div class="form-grid">
      <label>验证日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>验证人 *<input id="m-verifier" value="${state.station?.qualityLeader || ''}" placeholder="建议质量负责人" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeNC(state, id, { verifyISO: modalVal('m-date') || todayISO(), verifiedBy: modalVal('m-verifier') });
      closeModal();
      commit('close-nc', {});
      toast('已验证关闭——闭环台账完整在档');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 报告核对单）
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
    downloadFile(`检验检测机构合规迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function reportDownload() {
  const reportId = document.getElementById('case-report')?.value;
  if (!reportId) { toast('请先在台账落账报告'); return; }
  try {
    const html = reportHtml(state, reportId, todayISO());
    track(state, 'report-print', { reportId });
    downloadFile(`报告合规核对单_${todayISO()}.html`, html, 'text/html');
    toast('核对单已下载——委托方质疑或监管抽档 10 秒自证');
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
    toast('已复制——去微信粘贴存档或报最高管理者');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴存档或报最高管理者');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function submitSettings() {
  const renew = Number(document.getElementById('set-renew')?.value);
  const calib = Number(document.getElementById('set-calib')?.value);
  const duty = Number(document.getElementById('set-duty')?.value);
  state.settings = {
    renewWarnDays: Number.isInteger(renew) && renew >= 30 && renew <= 365 ? renew : DEFAULT_RENEW_WARN_DAYS,
    calibWarnDays: Number.isInteger(calib) && calib >= 7 && calib <= 120 ? calib : CALIB_WARN_DAYS,
    dutyWarnDays: Number.isInteger(duty) && duty >= 7 && duty <= 120 ? duty : DEFAULT_DUTY_WARN_DAYS,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`检证账备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`检证账使用记录_${todayISO()}.json`, JSON.stringify(state.traces ?? [], null, 2), 'application/json');
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
    name: '绿源环境检测有限公司（示例）', certNo: '241602341256', issuer: 'XX省市场监督管理局',
    certExpiryISO: isoAgo(today, -75), field: '生态环境监测（水质/气体）',
    address: 'XX市高新区科苑路 88 号 3 号楼', manager: '赵青禾', techLeader: '钱未央', qualityLeader: '孙既白',
    phone: '0510-88006688', note: '2020-11-08 首次取得资质认定，2026-11-08 届满',
  };
  state.capabilities = [];
  state.capSeq = 0;
  state.equipments = [];
  state.equipSeq = 0;
  state.staff = [];
  state.staffSeq = 0;
  state.changes = [];
  state.changeSeq = 0;
  state.ncs = [];
  state.ncSeq = 0;
  state.quality = [];
  state.qualitySeq = 0;
  state.reports = [];
  state.reportSeq = 0;
  state.duties = [];

  // 能力附表：3 个在用 + 1 个已停用（项目取消示例）
  const capCOD = addCapability(state, { name: '水中化学需氧量（COD）', standard: 'HJ 828-2017', remark: '地表水/废水' });
  const cappH = addCapability(state, { name: '水中 pH 值', standard: 'HJ 1147-2020' });
  const capNH3 = addCapability(state, { name: '空气中氨', standard: 'HJ 533-2009' });
  const capNoise = addCapability(state, { name: '厂界噪声', standard: 'GB 12348-2008', remark: '限厂界东侧' });
  const capPb = addCapability(state, { name: '土壤铅', standard: 'GB/T 17141-1997', remark: '' });
  setCapabilityStatus(state, capPb.id, 'suspended', '项目取消（2026-06 客户结构收缩），已列变更台账');

  // 设备：COD 消解仪正常 / pH 计临期 / 氨分析仪超期（停报风险）/ 声级计正常
  addEquipment(state, { name: '恒温消解仪', code: 'RZ-01', capIds: [capCOD.id], calibType: 'verify', cycleMonths: 12, lastCalibISO: isoAgo(today, 120), note: '计量院检定' });
  addEquipment(state, { name: '台式酸度计', code: 'PH-02', capIds: [cappH.id], calibType: 'calibrate', cycleMonths: 12, lastCalibISO: isoAgo(today, 355), note: '标准物质溯源' });
  addEquipment(state, { name: '氨自动分析仪', code: 'NH3-03', capIds: [capNH3.id], calibType: 'calibrate', cycleMonths: 12, lastCalibISO: isoAgo(today, 400), note: '待送校准' });
  addEquipment(state, { name: '声级计', code: 'SL-04', capIds: [capNoise.id], calibType: 'verify', cycleMonths: 12, lastCalibISO: isoAgo(today, 200) });

  // 人员：2 名在册授权签字人（1 名停用示例）+ 2 名检测人员
  const sg1 = addStaff(state, { name: '钱未央', role: 'signer', title: '高级工程师（环境监测）', certValidISO: isoAgo(today, -900), onboardISO: isoAgo(today, 1500) });
  const sg2 = addStaff(state, { name: '李渡口', role: 'signer', title: '工程师（分析化学）', certValidISO: isoAgo(today, -400), onboardISO: isoAgo(today, 800) });
  setStaffActive(state, sg2.id, false);
  addStaff(state, { name: '周疏影', role: 'tester', onboardISO: isoAgo(today, 500), note: '化学分析岗' });
  addStaff(state, { name: '吴镜湖', role: 'supervisor', onboardISO: isoAgo(today, 1200) });

  // 报告台账：1 份本月已落账（闸机全过）
  addReport(state, {
    reportNo: '绿源检字〔2026〕第 09-006 号', dateISO: today, client: 'XX市第二污水处理厂',
    paramIds: [capCOD.id, cappH.id], signerId: sg1.id, cmaMarked: true, subcontract: '',
    note: '样品编号 S2609-011/012，原始记录盒 F3',
  });

  // 变更台账：1 项已办结（名称变更）+ 1 项未办结（授权签字人变更——红灯示例）
  const cg1 = addChange(state, { dateISO: isoAgo(today, 150), kind: 'name', detail: '注册地址由科苑路 66 号变更为 88 号' });
  fileChange(state, cg1.id, isoAgo(today, 130));
  addChange(state, { dateISO: isoAgo(today, 20), kind: 'keyperson', detail: '授权签字人李渡口离职，拟变更为钱未央（已报材料待回执）' });

  // 质量记录：去年内审（即将满 12 个月，临期）+ 今年管理评审 + 一次合格能力验证 + 一次内部质控
  addQuality(state, { kind: 'internal', dateISO: isoAgo(today, 330), title: '2025 年度内部审核（覆盖全部 12 条要素，开列 3 项不符合已闭环）' });
  addQuality(state, { kind: 'mreview', dateISO: isoAgo(today, 150), title: '2026 年管理评审：输出设备更新与人员扩编决议' });
  addQuality(state, { kind: 'pt', dateISO: isoAgo(today, 210), title: '水质 pH 能力验证（NCATEST 2026-B，|z|<1）', result: 'pass' });
  addQuality(state, { kind: 'qc', dateISO: isoAgo(today, 30), title: 'COD 项目人员比对（周疏影/吴镜湖，En=0.32 合格）' });

  // 不符合项：1 项已闭环（内审）+ 1 项能力验证不合格整改中（氨参数已停报——红灯示例）
  const nc1 = addNC(state, { dateISO: isoAgo(today, 330), source: 'internal', desc: '天平室温湿度记录存在补记' });
  fixNC(state, nc1.id, { actionISO: isoAgo(today, 320), action: '修订记录规程并培训，改用自动温湿度记录仪' });
  closeNC(state, nc1.id, { verifyISO: isoAgo(today, 310), verifiedBy: '孙既白' });
  addNC(state, {
    dateISO: isoAgo(today, 40), source: 'inspection',
    desc: '监督检查发现氨分析仪校准证书过期后仍出报 2 份数据（已启动溯源核查）',
    capabilityId: capNH3.id, suspendCap: false,
  });
  // 能力验证不合格（氨）——挂起参数 + 自动停报
  addQuality(state, { kind: 'pt', dateISO: isoAgo(today, 40), title: '空气中氨能力验证（CNCA PT-2026-07，|z|=3.2 不满意）', result: 'unsat', capabilityId: capNH3.id });

  // 年度义务：年报已报（在期）、自我声明已更新（在期）、年度自查未登记（黄）、培训 400 天前（逾期红）
  setDutyDone(state, 'annualreport', isoAgo(today, 60), '2025 年度报告与统计数据已报省局');
  setDutyDone(state, 'selfdeclare', isoAgo(today, 90), '官网自我声明更新');
  setDutyDone(state, 'training', isoAgo(today, 400), '全员 RB/T 214 与 2023 评审准则宣贯');

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
    case 'show-renew': showRenew(); break;
    case 'add-cap': submitCap(); break;
    case 'show-suspend-cap': showSuspendCap(idx); break;
    case 'resume-cap': resumeCap(idx); break;
    case 'del-cap': deleteCap(idx); break;
    case 'add-equip': submitEquip(); break;
    case 'show-calib': showCalib(idx); break;
    case 'toggle-equip': toggleEquip(idx); break;
    case 'del-equip': deleteEquip(idx); break;
    case 'add-staff': submitStaff(); break;
    case 'toggle-staff': toggleStaff(idx); break;
    case 'add-change': submitChange(); break;
    case 'show-file-change': showFileChange(idx); break;
    case 'set-duty': submitDuty(); break;
    case 'add-report': submitReport(); break;
    case 'del-report': deleteReport(idx); break;
    case 'add-quality': submitQuality(); break;
    case 'del-quality': deleteQuality(idx); break;
    case 'add-nc': submitNC(); break;
    case 'show-fix-nc': showFixNC(idx); break;
    case 'show-close-nc': showCloseNC(idx); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'report-download': reportDownload(); break;
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
