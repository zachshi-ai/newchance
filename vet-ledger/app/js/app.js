/**
 * app.js — 路由、状态变更、事件委托、弹窗、示例数据与启动
 * 约定：本文件内的事件处理函数一律以 submit/show/toggle/file 前缀命名，
 * 避免与 core.js 导入同名而整模块白屏（仓库历史教训）。
 */
import {
  loadState, saveState, track, emptyState,
} from './store.js';
import {
  todayISO, monthKey,
  addStaff, setStaffActive, prescribers, activeStaff,
  addVisit, removeVisit,
  addDrug, freezeBatch, unfreezeBatch,
  addColdchain, removeColdchain,
  addRabies,
  addWaste, moveWaste,
  addEvent, closeEvent,
  setDutyDone, fileAnnualReport,
  monthlySummary, inspectHtml, caseHtml,
  exportBundle, importBundle,
  DEFAULT_COLD_MIN_C, DEFAULT_COLD_MAX_C, DEFAULT_WASTE_MOVE_DAYS, DEFAULT_GAP_DAYS,
} from './core.js';
import {
  viewBoard, viewClinic, viewLedger, viewReports, viewSettings, ICONS,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const $modalHost = document.getElementById('modal-host');

let state = loadState();
let repMonth = null;   // 月度小结用户选择的月份（跨渲染保留）
let repCache = null;   // 最近一次小结文本

const NAV = [
  ['#/board', '今日', 'board'], ['#/clinic', '机构', 'clinic'], ['#/ledger', '台账', 'ledger'], ['#/reports', '报表', 'reports'], ['#/settings', '设置', 'settings'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'clinic': html = viewClinic(state); break;
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
  toast._t = setTimeout(() => { $toast.hidden = true; }, 3600);
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

function num(id) {
  const n = Number(document.getElementById(id)?.value);
  return Number.isFinite(n) ? n : NaN;
}

// ---------------------------------------------------------------------------
// 弹窗（医废移交 / 事件报告 / 批次冻结）
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
// 机构 / 名册 / 义务 / 年度报告
// ---------------------------------------------------------------------------

function submitStation() {
  const name = val('st-name');
  if (!name) { toast('请填写机构名称'); return; }
  state.station = {
    ...state.station,
    name,
    certNo: val('st-certno'),
    scope: val('st-scope'),
    org: val('st-org'),
    issuedISO: val('st-issued'),
    manager: val('st-manager'),
    phone: val('st-phone'),
    address: val('st-address'),
    posted: checked('st-posted'),
    nameChangedISO: val('st-changed'),
    changeFiledISO: val('st-change-filed'),
  };
  commit('save-station');
  toast('机构信息已保存——变更钟已按登记日重算');
}

function submitStaff() {
  try {
    addStaff(state, {
      name: val('sp-name'),
      type: document.getElementById('sp-type')?.value || 'vet',
      certNo: val('sp-certno'),
      sinceISO: val('sp-since') || todayISO(),
      note: val('sp-note'),
    });
    commit('add-staff', {});
    toast('已入册——处方闸从名册取人');
  } catch (e) { fail(e); }
}

function toggleStaff(id) {
  try {
    const rec = (state.staffs ?? []).find((s) => s.id === id);
    setStaffActive(state, id, !(rec?.active));
    commit('toggle-staff', {});
    toast(rec?.active ? '已停用——历史处方仍可回溯到人' : '已恢复在册');
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

function submitAnnual() {
  const year = Number(document.getElementById('ar-year')?.value);
  try {
    fileAnnualReport(state, { year, filedISO: val('ar-date') || todayISO(), no: val('ar-no') });
    commit('file-annual', { year });
    toast('年度报告已登记——钟转绿');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 诊疗 / 兽药 / 冷链 / 狂犬 / 医废 / 事件
// ---------------------------------------------------------------------------

function submitVisit() {
  try {
    addVisit(state, {
      dateISO: val('vs-date') || todayISO(),
      owner: val('vs-owner'),
      animal: val('vs-animal'),
      complaint: val('vs-complaint'),
      diagnosis: val('vs-diagnosis'),
      doctorId: document.getElementById('vs-doctor')?.value || '',
      rxRequired: checked('vs-rx'),
      rxNo: val('vs-rxno'),
      rxItems: val('vs-rxitems'),
      note: val('vs-note'),
    });
    commit('add-visit', {});
    toast('诊疗已落账——病历从此可拼装');
  } catch (e) { fail(e); }
}

function deleteVisit(id) {
  try {
    removeVisit(state, id);
    commit('del-visit');
    toast('已删除该诊疗记录');
  } catch (e) { fail(e); }
}

function submitDrug() {
  const qty = num('dg-qty');
  try {
    addDrug(state, {
      dateISO: val('dg-date') || todayISO(),
      kind: document.getElementById('dg-kind')?.value || 'drug',
      name: val('dg-name'),
      batchNo: val('dg-batchno'),
      expiryISO: val('dg-expiry'),
      qty: Number.isInteger(qty) ? qty : 1,
      isRx: checked('dg-isrx'),
      supplier: val('dg-supplier'),
      note: val('dg-note'),
    });
    commit('add-drug', {});
    toast('批次已入账——效期钟开始倒数');
  } catch (e) { fail(e); }
}

function showFreeze(id) {
  const d = (state.drugs ?? []).find((x) => x.id === id);
  if (!d) return;
  openModal(`冻结批次 · ${d.name}`, `
    <p class="fine" style="margin-top:0">批号 ${d.batchNo || '—'} · 有效期至 ${d.expiryISO}。超温/质量异常的批次先冻结，判定闭环前不得使用。</p>
    <div class="form-grid">
      <label class="span2">处置原因 *<input id="m-freeze-note" placeholder="如：冷链超温，暂停使用待厂家判定" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      freezeBatch(state, id, modalVal('m-freeze-note'));
      closeModal();
      commit('freeze-batch', {});
      toast('批次已冻结——解冻前使用会被闸机拦截');
    } catch (e) { fail(e); }
  };
}

function showUnfreeze(id) {
  const d = (state.drugs ?? []).find((x) => x.id === id);
  if (!d) return;
  openModal(`解冻批次 · ${d.name}`, `
    <p class="fine" style="margin-top:0">冻结原因：${d.frozenNote || '—'}</p>
    <div class="form-grid">
      <label class="span2">判定结论 *<input id="m-unfreeze-note" placeholder="如：厂家书面判定可用 / 已废弃退回供应商" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      unfreezeBatch(state, id, modalVal('m-unfreeze-note'));
      closeModal();
      commit('unfreeze-batch', {});
      toast('批次已解冻（判定结论已留痕）');
    } catch (e) { fail(e); }
  };
}

function submitColdchain() {
  try {
    const rec = addColdchain(state, {
      dateISO: val('cc-date') || todayISO(),
      slot: document.getElementById('cc-slot')?.value || 'am',
      tempC: num('cc-temp'),
      note: val('cc-note'),
    }, state.settings ?? {});
    commit('add-coldchain', { excursion: rec.excursion });
    toast(rec.excursion ? '已记录超温——按处置说明冻结相关批次' : '冷链打卡成功');
  } catch (e) { fail(e); }
}

function deleteColdchain(id) {
  try {
    removeColdchain(state, id);
    commit('del-coldchain');
    toast('已删除该冷链记录');
  } catch (e) { fail(e); }
}

function submitRabies() {
  try {
    addRabies(state, {
      dateISO: val('rb-date') || todayISO(),
      pet: val('rb-pet'),
      species: document.getElementById('rb-species')?.value || '犬',
      owner: val('rb-owner'),
      vaccineBatchId: document.getElementById('rb-batch')?.value || '',
      certNo: val('rb-certno'),
      doctorId: document.getElementById('rb-doctor')?.value || '',
    });
    commit('add-rabies', {});
    toast('免疫已登记、证明已出具——主人凭编号办犬证');
  } catch (e) { fail(e); }
}

function submitWaste() {
  const qty = num('ws-qty');
  try {
    addWaste(state, {
      dateISO: val('ws-date') || todayISO(),
      kind: document.getElementById('ws-kind')?.value || 'clinic',
      qty: Number.isInteger(qty) ? qty : 1,
      way: document.getElementById('ws-way')?.value || 'stored',
      receiver: val('ws-receiver'),
      ticketNo: val('ws-ticket'),
      note: val('ws-note'),
    });
    commit('add-waste', {});
    toast('已登记——暂存类记得按时移交');
  } catch (e) { fail(e); }
}

function showMoveWaste(id) {
  const rec = (state.wastes ?? []).find((w) => w.id === id);
  if (!rec) return;
  openModal(`医废移交 · ${rec.dateISO}`, `
    <p class="fine" style="margin-top:0">${rec.kind === 'dead-animal' ? '病死动物' : rec.kind === 'pathology' ? '病理组织' : '诊疗废弃物'} · 数量 ${rec.qty}——移交给有资质的专业处理机构才算闭环。</p>
    <div class="form-grid">
      <label>移交日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>接收单位 *<input id="m-receiver" placeholder="专业处理机构名称" /></label>
      <label class="span2">交接单号<input id="m-ticket" placeholder="可空" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      moveWaste(state, id, { movedISO: modalVal('m-date') || todayISO(), receiver: modalVal('m-receiver'), ticketNo: modalVal('m-ticket') });
      closeModal();
      commit('move-waste', {});
      toast('已移交闭环');
    } catch (e) { fail(e); }
  };
}

function submitEvent() {
  try {
    addEvent(state, {
      dateISO: val('ev-date') || todayISO(),
      kind: document.getElementById('ev-kind')?.value || 'adverse',
      severity: document.getElementById('ev-severity')?.value || 'general',
      subject: val('ev-subject'),
    });
    commit('add-event', {});
    toast('事件已登记——当天报告、当天闭环');
  } catch (e) { fail(e); }
}

function showReportEvent(id) {
  const rec = (state.events ?? []).find((e2) => e2.id === id);
  if (!rec) return;
  openModal(`报告闭环 · ${rec.dateISO}`, `
    <p class="fine" style="margin-top:0">${rec.kind === 'epidemic' ? '染疫报告（防疫法第 31 条：发现染疫或疑似染疫立即报告）' : '不良反应报告（兽药管理条例第 50 条：严重不良反应立即报告）'}。登记日当天报告为按时，晚于当天将如实打标「迟报」。</p>
    <div class="form-grid">
      <label>报告日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">受理单位/方式<input id="m-way" placeholder="如：已报 XX 区农业农村局 / 疫控中心" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeEvent(state, id, { reportedISO: modalVal('m-date') || todayISO() });
      closeModal();
      commit('close-event', {});
      toast('报告已闭环归档');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 患宠材料单）
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
    downloadFile(`动物诊疗机构迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function casePrint() {
  const visitId = document.getElementById('case-visit')?.value;
  if (!visitId) { toast('请先在台账落诊疗'); return; }
  try {
    const visit = (state.visits ?? []).find((v) => v.id === visitId);
    const html = caseHtml(state, visitId, todayISO());
    track(state, 'case-print', { visitId });
    downloadFile(`诊疗材料单_${visit?.dateISO ?? visitId}_${todayISO()}.html`, html, 'text/html');
    toast('材料单已下载——纠纷沟通时附上');
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
    toast('已复制——去微信粘贴存档或发合伙人');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴存档或发合伙人');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function submitSettings() {
  const minC = Number(document.getElementById('set-coldmin')?.value);
  const maxC = Number(document.getElementById('set-coldmax')?.value);
  const waste = Number(document.getElementById('set-waste')?.value);
  const gap = Number(document.getElementById('set-gap')?.value);
  state.settings = {
    coldMinC: Number.isFinite(minC) ? minC : DEFAULT_COLD_MIN_C,
    coldMaxC: Number.isFinite(maxC) && maxC > (Number.isFinite(minC) ? minC : DEFAULT_COLD_MIN_C) ? maxC : DEFAULT_COLD_MAX_C,
    wasteMoveDays: Number.isInteger(waste) && waste >= 1 && waste <= 30 ? waste : DEFAULT_WASTE_MOVE_DAYS,
    gapDays: Number.isInteger(gap) && gap >= 2 && gap <= 30 ? gap : DEFAULT_GAP_DAYS,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`兽诊账备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`兽诊账使用记录_${todayISO()}.json`, JSON.stringify(state.traces ?? [], null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      repMonth = null;
      repCache = null;
      commit('import');
      toast('导入成功');
    };
    reader.readAsText(file);
  }
}

// ---------------------------------------------------------------------------
// 示例数据（30 秒体验完整流程；「今天」的记录用真实时钟 minsAgo 语义，避免未来时间戳）
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  state.station = {
    name: '城南宠物医院（示例）', certNo: '兽诊字第2025-0417号', scope: '动物疾病预防、诊断、治疗（不含水生动物）',
    org: 'XX区农业农村局', issuedISO: isoAgo(today, 400), manager: '张明远', phone: '13800005678',
    address: 'XX市城南区望江路 56 号', posted: true, nameChangedISO: '', changeFiledISO: '',
  };
  state.staffs = [];
  state.staffSeq = 0;
  state.visits = [];
  state.visitSeq = 0;
  state.drugs = [];
  state.drugSeq = 0;
  state.coldchains = [];
  state.coldchainSeq = 0;
  state.rabiesLog = [];
  state.rabiesSeq = 0;
  state.wastes = [];
  state.wasteSeq = 0;
  state.events = [];
  state.eventSeq = 0;
  state.duties = [];
  state.annualReports = [];

  // 人员名册：1 名执业兽医师（可开方）、1 名助理（不可开方）
  const vet = addStaff(state, { name: '张明远', type: 'vet', certNo: '执业兽医师 2202XXXX', sinceISO: isoAgo(today, 400), note: '机构负责人' });
  const assistant = addStaff(state, { name: '李小曼', type: 'assistant', certNo: '助理兽医师 2301XXXX', sinceISO: isoAgo(today, 120), note: '体检、给药' });

  // 疫苗与兽药批次：一支持效期紧张疫苗（30 天内）、两支已过期兽药（下架点名）、一批正常在用
  addDrug(state, { dateISO: isoAgo(today, 100), kind: 'vaccine', name: '狂犬病灭活疫苗', manufacturer: 'XX生物', batchNo: 'RAB2026-07', expiryISO: isoAgo(today, -20), qty: 40, isRx: false, supplier: '市兽药公司' });
  addDrug(state, { dateISO: isoAgo(today, 300), kind: 'drug', name: '头孢噻呋钠注射液', manufacturer: 'XX动物保健', batchNo: 'CEF25-118', expiryISO: isoAgo(today, -12), qty: 12, isRx: true, supplier: '县兽药经销部' });
  addDrug(state, { dateISO: isoAgo(today, 320), kind: 'drug', name: '奥美拉唑注射液', manufacturer: 'XX制药', batchNo: 'OME24-051', expiryISO: isoAgo(today, 3), qty: 6, isRx: true, supplier: '县兽药经销部' });

  // 诊疗台账：近 10 天 8 例（含 2 例处方药凭方）；1 例断更
  const V = (daysAgo, owner, animal, diagnosis, doctorId, rxRequired, rxNo = '', rxItems = '') => {
    addVisit(state, {
      dateISO: isoAgo(today, daysAgo), owner, animal, complaint: '', diagnosis,
      doctorId, rxRequired, rxNo, rxItems, note: '',
    });
  };
  V(1, '尾号8823', '金毛「豆豆」', '急性胃炎，输液三天', vet.id, true, 'CF-2026-0912-01', '奥美拉唑注射液 0.4mg/kg iv');
  V(2, '陈先生', '英短「煤球」', '年度体检，牙结石建议洁牙', assistant.id, false);
  V(3, '王女士', '泰迪「糖糖」', '趾间炎，局部处置', vet.id, false);
  V(4, '尾号3341', '拉布拉多「大壮」', '疫苗加强免疫咨询', vet.id, false);
  V(6, '刘先生', '柯基「短腿」', '软便，处方粮+益生菌', vet.id, true, 'CF-2026-0909-04', '甲硝唑片 25mg/kg po');
  V(7, '周女士', '布偶「雪球」', '皮肤真菌采样镜检', assistant.id, false);
  V(8, '尾号5177', '比熊「棉花」', '耳道感染清洗上药', vet.id, false);
  V(9, '吴先生', '中华田园犬「阿黄」', '外伤清创缝合', vet.id, false);

  // 冷链：昨天两次正常 + 今天上午正常（下午未录 → 看板黄灯）；上月一次超温已处置
  addColdchain(state, { dateISO: isoAgo(today, 1), slot: 'am', tempC: 4.2, note: '' }, state.settings ?? {});
  addColdchain(state, { dateISO: isoAgo(today, 1), slot: 'pm', tempC: 4.8, note: '' }, state.settings ?? {});
  addColdchain(state, { dateISO: today, slot: 'am', tempC: 4.0, note: '' }, state.settings ?? {});
  addColdchain(state, { dateISO: isoAgo(today, 6), slot: 'pm', tempC: 9.6, note: '冷藏柜门未关严，当场复位并隔离该批狂犬疫苗' }, state.settings ?? {});

  // 狂犬免疫：3 剂（凭名册执业兽医师）
  addRabies(state, { dateISO: isoAgo(today, 4), pet: '大壮', species: '犬', owner: '尾号3341', vaccineBatchId: state.drugs[0].id, certNo: 'IMM-2026-0611-07', doctorId: vet.id });
  addRabies(state, { dateISO: isoAgo(today, 9), pet: '来福', species: '犬', owner: '尾号2205', vaccineBatchId: state.drugs[0].id, certNo: 'IMM-2026-0606-06', doctorId: vet.id });
  addRabies(state, { dateISO: isoAgo(today, 15), pet: '咪咪', species: '猫', owner: '孙女士', vaccineBatchId: state.drugs[0].id, certNo: 'IMM-2026-0531-05', doctorId: vet.id });

  // 医废：一笔暂存 4 天（超 2 天红线 → 红灯）、一笔已移交闭环
  state.wasteSeq += 1;
  state.wastes.push({ id: `ws-${state.wasteSeq}`, dateISO: isoAgo(today, 4), kind: 'clinic', qty: 3, way: 'stored', receiver: '', ticketNo: '', movedISO: null, note: '输液器/药瓶，待周六集中移交' });
  state.wasteSeq += 1;
  state.wastes.push({ id: `ws-${state.wasteSeq}`, dateISO: isoAgo(today, 12), kind: 'pathology', qty: 1, way: 'transferred', receiver: '市动物无害化处理中心', ticketNo: 'WH-0912-223', movedISO: isoAgo(today, 12), note: '皮肤采样组织' });

  // 事件：一笔一般不良反应已报告；一笔严重染疫未报告（红灯）
  state.eventSeq += 1;
  state.events.push({ id: `ev-${state.eventSeq}`, dateISO: isoAgo(today, 18), kind: 'adverse', subject: '柯基「短腿」·驱虫药后短暂流涎', severity: 'general', reportedISO: isoAgo(today, 17), late: false, note: '已观察 24h 恢复' });
  state.eventSeq += 1;
  state.events.push({ id: `ev-${state.eventSeq}`, dateISO: isoAgo(today, 2), kind: 'epidemic', subject: '疑似犬瘟热一例（未确诊）', severity: 'serious', reportedISO: null, late: false, note: '' });

  // 义务：消毒 3 天前（在期）、冷藏设备 40 天前（逾期）、培训 200 天前（在期）
  setDutyDone(state, 'disinfect', isoAgo(today, 3), '诊室/手术台/笼具全消毒');
  setDutyDone(state, 'fridgeCheck', isoAgo(today, 40), '冷藏柜除霜');
  setDutyDone(state, 'training', isoAgo(today, 200), '全员急救与疫报培训');

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
    case 'add-staff': submitStaff(); break;
    case 'toggle-staff': toggleStaff(idx); break;
    case 'set-duty': submitDuty(); break;
    case 'file-annual': submitAnnual(); break;
    case 'add-visit': submitVisit(); break;
    case 'del-visit': deleteVisit(idx); break;
    case 'add-drug': submitDrug(); break;
    case 'freeze-batch': showFreeze(idx); break;
    case 'unfreeze-batch': showUnfreeze(idx); break;
    case 'add-coldchain': submitColdchain(); break;
    case 'del-coldchain': deleteColdchain(idx); break;
    case 'add-rabies': submitRabies(); break;
    case 'add-waste': submitWaste(); break;
    case 'show-move-waste': showMoveWaste(idx); break;
    case 'add-event': submitEvent(); break;
    case 'show-report-event': showReportEvent(idx); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'case-print': casePrint(); break;
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
