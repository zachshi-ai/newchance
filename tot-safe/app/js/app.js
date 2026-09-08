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
  addStaff, setStaffActive,
  addKid, setKidInCare,
  addChange, fileChange,
  addHazard, fixHazard, closeHazard,
  addHealthEvent, notifyHealthEvent, returnHealthEvent, reportHealthEvent,
  recordDaycheck, daycheckItemsFor, daycheckStatusFor,
  addDayPass, removeDayPass, kidsInCare,
  setDutyDone, CLASS_KINDS,
  monthlySummary, inspectHtml, dayPassHtml, trustHtml, trustText,
  exportBundle, importBundle,
  DEFAULT_DOC_WARN_DAYS, DEFAULT_HEALTH_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS, DEFAULT_LEASE_WARN_DAYS,
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
  ['#/board', '今日', 'board'], ['#/station', '建档', 'station'], ['#/ledger', '日托', 'ledger'], ['#/reports', '报表', 'reports'], ['#/settings', '设置', 'settings'],
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
// 弹窗（变更办结 / 隐患整改 / 复查销案 / 健康事件通知 / 返园核验）
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
// 建档（机构 / 人员 / 幼儿 / 变更 / 义务）
// ---------------------------------------------------------------------------

function submitOrg() {
  const name = val('vg-name');
  if (!name) { toast('请填写机构名称'); return; }
  state.org = {
    ...state.org,
    name,
    filedISO: val('vg-filed'),
    uscc: val('vg-uscc'),
    nature: document.getElementById('vg-nature')?.value || '',
    meals: !!document.getElementById('vg-meals')?.checked,
    docs: {
      fire: val('vg-fire'),
      food: val('vg-food'),
      lease: val('vg-lease'),
    },
    principal: val('vg-principal'),
    address: val('vg-address'),
    phone: val('vg-phone'),
    note: val('vg-note'),
  };
  commit('save-org');
  toast('机构信息已保存——三证钟已按有效期起算');
}

function submitStaff() {
  try {
    addStaff(state, {
      name: val('ppl-name'),
      role: document.getElementById('ppl-role')?.value || 'carer',
      healthValidISO: val('ppl-health'),
      qualName: val('ppl-qualname'),
      qualValidISO: val('ppl-qualvalid'),
      criminalDateISO: val('ppl-criminal'),
      note: val('ppl-note'),
    });
    commit('add-staff', {});
    toast('已入册——送托点名与健康证钟以此为准');
  } catch (e) { fail(e); }
}

function toggleStaff(id) {
  try {
    const rec = (state.staff ?? []).find((s) => s.id === id);
    setStaffActive(state, id, !(rec?.active));
    commit('toggle-staff', {});
    toast(rec?.active ? '已停用——历史送托单仍可回溯到当日名册' : '已恢复在册');
  } catch (e) { fail(e); }
}

function submitKid() {
  try {
    addKid(state, {
      name: val('kd-name'),
      classKind: document.getElementById('kd-class')?.value || 'small',
      vaccineOK: !!document.getElementById('kd-vaccine')?.checked,
      entryExamISO: val('kd-exam'),
      note: val('kd-note'),
    });
    commit('add-kid', {});
    toast('已收托入册——接种证/入托体检未齐会挂查验缺口红灯');
  } catch (e) { fail(e); }
}

function kidVaccine(id) {
  try {
    const rec = (state.kids ?? []).find((k) => k.id === id);
    if (!rec) throw new Error('幼儿不存在');
    rec.vaccineOK = !rec.vaccineOK;
    commit('kid-vaccine', {});
    toast(rec.vaccineOK ? '接种证已查验——查验缺口解除' : '已标记接种证未查验');
  } catch (e) { fail(e); }
}

function kidOut(id) {
  try {
    const rec = (state.kids ?? []).find((k) => k.id === id);
    if (!rec) throw new Error('幼儿不存在');
    setKidInCare(state, id, false, todayISO());
    commit('kid-out', {});
    toast(`已登记 ${rec.name} 离园——3 个月以上返回须重新健康检查（管理规范第 11 条）`);
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
    toast('变更已登记——向卫健部门办变更备案后点「办结」');
  } catch (e) { fail(e); }
}

function showFileChange(id) {
  const c = (state.changes ?? []).find((x) => x.id === id);
  if (!c) return;
  openModal(`变更办结 · ${c.detail}`, `
    <p class="fine" style="margin-top:0">向卫健部门办理变更备案完成（管理规范第 6 条；备案办法第 10 条），录入办理回执日期。</p>
    <div class="form-grid">
      <label>办理日期 *<input id="m-date" type="date" value="${todayISO()}" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      fileChange(state, id, modalVal('m-date') || todayISO());
      closeModal();
      commit('file-change', {});
      toast('变更备案已办结');
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
// 晨午检 / 送托六道闸 / 健康事件 / 隐患
// ---------------------------------------------------------------------------

function submitDaycheck(seg) {
  const dateISO = todayISO();
  const results = {};
  for (const it of daycheckItemsFor(state, seg)) {
    results[it.key] = {
      ok: !!document.getElementById(`dc-${it.key}`)?.checked,
      note: document.getElementById(`dcnote-${it.key}`)?.value?.trim() ?? '',
    };
  }
  // 晨检异常幼儿输入："姓名 · 症状"，多条用中文/英文逗号分隔
  const abnormalKids = [];
  if (seg === 'morning') {
    const raw = val('dc-abnormal');
    if (raw) {
      for (const part of raw.split(/[,，；;]/)) {
        const s = part.trim();
        if (!s) continue;
        const m = s.split(/·|·|\||｜/);
        abnormalKids.push({ kidName: (m[0] ?? '').trim(), symptom: (m[1] ?? '').trim() });
      }
      if (abnormalKids.some((a) => !a.kidName)) {
        toast('异常幼儿请按「姓名 · 症状」格式填写——健康事件必须落到孩子');
        return;
      }
    }
  }
  try {
    const rec = recordDaycheck(state, { dateISO, segment: seg, results, abnormalKids });
    commit('add-daycheck', {});
    toast(rec.status === 'issue'
      ? '检查卡已落——异常已自动转隐患/健康事件，闭环前送托闸不放行'
      : '检查卡已落，全项正常——可以去过闸送托');
  } catch (e) { fail(e); }
}

function submitDayPass() {
  const payload = {
    dateISO: val('dp-date') || todayISO(),
    carerIds: multiVal('dp-carers'),
    allStaffIds: multiVal('dp-staff'),
    note: val('dp-note'),
  };
  try {
    addDayPass(state, payload);
    commit('add-daypass', {});
    toast('✅ 送托单已落——六道闸全过，当日快照已存');
  } catch (e) {
    // 闸机拦截：埋点留痕——每次拦截都是没被罚的证据
    track(state, 'daypass-blocked', { reasons: String(e?.message ?? e).slice(0, 500), dateISO: payload.dateISO });
    saveState(state);
    toast(`⛔ ${String(e?.message ?? e).slice(0, 160)}`);
  }
}

function deleteDayPass(id) {
  try {
    removeDayPass(state, id);
    commit('del-daypass');
    toast('已删除该送托单');
  } catch (e) { fail(e); }
}

function submitHealthEvent() {
  try {
    addHealthEvent(state, {
      dateISO: val('he-date') || todayISO(),
      source: document.getElementById('he-source')?.value || 'selfcheck',
      kidName: val('he-kid'),
      symptom: val('he-symptom'),
      reportable: !!document.getElementById('he-reportable')?.checked,
    });
    commit('add-healthevent', {});
    toast('健康事件已登记——通知监护人+处置后，凭治愈证明返园核验闭环');
  } catch (e) { fail(e); }
}

function showNotifyHe(id) {
  const h = (state.healthEvents ?? []).find((x) => x.id === id);
  if (!h) return;
  openModal(`通知处置 · ${h.kidName}（${h.symptom || '—'}）`, `
    <p class="fine" style="margin-top:0">发现异常应当及时通知婴幼儿监护人（管理规范第 24 条）；处置意见写清去向，如：家长 10:20 接回就医 / 隔离观察室留观。</p>
    <div class="form-grid">
      <label>通知监护人日期 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">处置意见 *<input id="m-action" placeholder="如：已电话通知家长接回就医，当日出勤注销" /></label>
      ${h.reportable ? `<label class="span2">疑似传染病报告日（按当地疾控渠道报告后登记）<input id="m-report" type="date" /></label>` : ''}
    </div>`);
  openModal._confirm = () => {
    try {
      notifyHealthEvent(state, id, { notifyISO: modalVal('m-date') || todayISO(), action: modalVal('m-action') });
      if (h.reportable && modalVal('m-report')) {
        reportHealthEvent(state, id, modalVal('m-report'));
        closeModal();
        commit('he-report', {});
        toast('通知处置已登记，疑似传染病报告已留痕');
        return;
      }
      closeModal();
      commit('notify-he', {});
      toast('通知处置已登记——返园时凭治愈/健康证明核验闭环');
    } catch (e) { fail(e); }
  };
}

function showReturnHe(id) {
  const h = (state.healthEvents ?? []).find((x) => x.id === id);
  if (!h) return;
  openModal(`返园核验 · ${h.kidName}`, `
    <p class="fine" style="margin-top:0">处置：${h.action || '—'}（${h.notifyISO || '—'}）。患传染病的幼儿治愈后凭医疗卫生机构出具的健康证明返所（76 号令第 18 条）。</p>
    <div class="form-grid">
      <label>返园日期 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">返园凭证 *<input id="m-proof" placeholder="如：XX 儿科复课证明（2026-09-10）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      returnHealthEvent(state, id, { returnISO: modalVal('m-date') || todayISO(), returnProof: modalVal('m-proof') });
      closeModal();
      commit('return-he', {});
      toast('返园核验完成——健康事件闭环');
    } catch (e) { fail(e); }
  };
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
      <label class="span2">整改措施 *<input id="m-action" placeholder="如：护栏加固并全园巡检一遍" /></label>
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
    <p class="fine" style="margin-top:0">整改措施：${h.action || '—'}（${h.actionISO || '—'}）。销案建议由园长/负责人执行；闭环后送托闸恢复放行。</p>
    <div class="form-grid">
      <label>复查日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>复查人 *<input id="m-verifier" value="${state.org?.principal || ''}" placeholder="建议园长/负责人" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeHazard(state, id, { verifyISO: modalVal('m-date') || todayISO(), verifiedBy: modalVal('m-verifier') });
      closeModal();
      commit('close-hazard', {});
      toast('已复查销案——隐患闭环，送托闸放行');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 当日送托单 / 家长信任公示单）
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
    downloadFile(`托育机构合规迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function dayPassDownload(dayPassId) {
  dayPassId = dayPassId || document.getElementById('case-daypass')?.value;
  if (!dayPassId) { toast('请先过闸开出送托单'); return; }
  try {
    const html = dayPassHtml(state, dayPassId, todayISO());
    track(state, 'daypass-print', { dayPassId });
    downloadFile(`当日送托单_${todayISO()}.html`, html, 'text/html');
    toast('送托单已下载——打印贴园门口，家长与检查进门 10 秒出示');
    saveState(state);
  } catch (e) { fail(e); }
}

function trustAction(mode) {
  try {
    if (mode === 'download') {
      const html = trustHtml(state, todayISO(), state.settings ?? {});
      track(state, 'trust', { mode });
      downloadFile(`家长信任公示单_${todayISO()}.html`, html, 'text/html');
      toast('已下载——打印贴大厅，招生参观第一张纸');
    } else {
      const text = trustText(state, todayISO(), state.settings ?? {});
      copyText(text);
      track(state, 'trust', { mode: 'copy' });
      saveState(state);
      return;
    }
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
    toast('已复制——去家长群/举办者群粘贴');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去家长群/举办者群粘贴');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function submitSettings() {
  const num = (id, min, max, dft) => {
    const n = Number(document.getElementById(id)?.value);
    return Number.isInteger(n) && n >= min && n <= max ? n : dft;
  };
  state.settings = {
    docWarnDays: num('set-doc', 7, 180, DEFAULT_DOC_WARN_DAYS),
    healthWarnDays: num('set-health', 14, 180, DEFAULT_HEALTH_WARN_DAYS),
    dutyWarnDays: num('set-duty', 7, 120, DEFAULT_DUTY_WARN_DAYS),
    leaseWarnDays: num('set-lease', 14, 365, DEFAULT_LEASE_WARN_DAYS),
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`托安单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`托安单使用记录_${todayISO()}.json`, JSON.stringify(state.traces ?? [], null, 2), 'application/json');
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
// 顺序敏感：先落昨日干净晨午检+送托单，再落今日异常晨检——否则回溯被当前事件拦截。
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  state.org = {
    name: '晨曦托育园（示例）', filedISO: isoAgo(today, 540), uscc: '91330106MA2XXXXX0A', nature: '营利性',
    meals: true,
    docs: { fire: isoAgo(today, -25), food: isoAgo(today, -400), lease: isoAgo(today, -700) },
    principal: '苏晴禾', address: 'XX市云栖区晨晖路 8 号 1-2 层', phone: '0571-88991200',
    note: '2025-03-12 备案，收托规模 60 人；乳儿班+托小班+托大班各 1',
  };
  state.staff = [];
  state.staffSeq = 0;
  state.kids = [];
  state.kidSeq = 0;
  state.daychecks = [];
  state.daycheckSeq = 0;
  state.daypasses = [];
  state.daypassSeq = 0;
  state.healthEvents = [];
  state.healthSeq = 0;
  state.hazards = [];
  state.hazardSeq = 0;
  state.changes = [];
  state.changeSeq = 0;
  state.duties = [];

  // 人员：负责人+4 保育+保健+保安+炊事（1 名保育健康证过期 12 天=红灯，1 名临期 30 天=黄）
  const su = addStaff(state, { name: '苏晴禾', role: 'principal', healthValidISO: isoAgo(today, -300), qualName: '负责人岗位培训合格证（60 学时）', qualValidISO: isoAgo(today, -600), criminalDateISO: isoAgo(today, 545) });
  const zhou = addStaff(state, { name: '周暖晴', role: 'carer', healthValidISO: isoAgo(today, -200), qualName: '育婴员（四级）', qualValidISO: '', criminalDateISO: isoAgo(today, 500), note: '乳儿班主班' });
  addStaff(state, { name: '许星野', role: 'carer', healthValidISO: isoAgo(today, 12), note: '健康证已过期 12 天——送托点名不可用' });
  const luo = addStaff(state, { name: '罗知夏', role: 'carer', healthValidISO: isoAgo(today, -30), note: '托小班主班（健康证临期黄灯）' });
  const jiang = addStaff(state, { name: '江眠', role: 'carer', healthValidISO: isoAgo(today, -260), note: '托大班主班' });
  const qi = addStaff(state, { name: '齐茉', role: 'health', healthValidISO: isoAgo(today, -180), qualName: '保健员培训合格证（妇幼保健院）', qualValidISO: isoAgo(today, -420), criminalDateISO: isoAgo(today, 520) });
  addStaff(state, { name: '石铁山', role: 'guard', healthValidISO: isoAgo(today, -330), qualName: '保安员证', qualValidISO: isoAgo(today, -500), criminalDateISO: isoAgo(today, 540) });
  addStaff(state, { name: '范香果', role: 'cook', healthValidISO: isoAgo(today, -210), note: '食品安全员' });

  // 幼儿：乳儿班 3 / 托小班 5 / 托大班 7（1 名未查验接种证=查验缺口红灯）
  const kidSeed = [
    ['小满', 'infant'], ['年糕', 'infant'], ['糖糖', 'infant'],
    ['北北', 'small'], ['豆豆', 'small'], ['苗苗', 'small'], ['多多', 'small'], ['安安', 'small'],
    ['核桃', 'big'], ['朵朵', 'big'], ['乐乐', 'big'], ['西西', 'big'], ['果果', 'big'], ['壮壮', 'big'], ['一一', 'big'],
  ];
  for (const [name, kind] of kidSeed) {
    addKid(state, {
      name, classKind: kind,
      vaccineOK: name !== '壮壮',
      entryExamISO: isoAgo(today, 30 + Math.floor(Math.random() * 300)),
    });
  }

  // 昨天：晨午检两段全绿 + 送托单（闸机全过）
  const yesterday = isoAgo(today, 1);
  for (const seg of ['morning', 'noon']) {
    const itemsY = daycheckItemsFor(state, seg);
    recordDaycheck(state, {
      dateISO: yesterday, segment: seg,
      results: Object.fromEntries(itemsY.map((it) => [it.key, { ok: true, note: '' }])),
    });
  }
  addDayPass(state, { dateISO: yesterday, carerIds: [zhou.id, luo.id, jiang.id], allStaffIds: [su.id, zhou.id, luo.id, jiang.id, qi.id], note: '常规在园' });

  // 今天：晨检 1 项异常（消毒未做→自动转隐患）+ 1 名异常幼儿（低热→自动转健康事件，待通知=送托闸第 6 道拦截）
  const itemsM = daycheckItemsFor(state, 'morning');
  recordDaycheck(state, {
    dateISO: today, segment: 'morning',
    results: Object.fromEntries(itemsM.map((it) => it.key === 'morning:sanitize'
      ? [it.key, { ok: false, note: '玩具消毒未完成，已停止晨间区角活动，补做后复查' }]
      : [it.key, { ok: true, note: '' }])),
    abnormalKids: [{ kidName: '苗苗', symptom: '晨检低热 37.8℃' }],
  });

  // 变更：1 项未办结（收托规模 60→80 人，已报待回执——黄灯示例）
  addChange(state, { dateISO: isoAgo(today, 20), kind: 'scale', detail: '收托规模 60→80 人（变更备案已报待回执）' });

  // 周期义务：演习逾期 15 天（红）/ 培训在期 / 消防月检在期 / 设施月检逾期 3 天（红）/ 报送在期 / 年报在期 / 保险临期
  setDutyDone(state, 'drill', isoAgo(today, 195), '防暴演习（全员+保安公司联训）');
  setDutyDone(state, 'training', isoAgo(today, 90), '急救与传染病防控复训（全员）');
  setDutyDone(state, 'fireequip', isoAgo(today, 20), '灭火器/应急灯/疏散通道月检');
  setDutyDone(state, 'facility', isoAgo(today, 33), '设施设备月检（含监控 90 日留存核查）');
  setDutyDone(state, 'kidreport', isoAgo(today, 60), '收托信息季度报送');
  setDutyDone(state, 'annual', isoAgo(today, 260), '2025 年度报告');
  setDutyDone(state, 'insurance', isoAgo(today, 340), '托育机构责任险（保单 TB2025-1107）');

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
  const { action, idx, seg } = el.dataset;
  switch (action) {
    case 'save-org': submitOrg(); break;
    case 'add-staff': submitStaff(); break;
    case 'toggle-staff': toggleStaff(idx); break;
    case 'add-kid': submitKid(); break;
    case 'kid-vaccine': kidVaccine(idx); break;
    case 'kid-out': kidOut(idx); break;
    case 'add-change': submitChange(); break;
    case 'show-file-change': showFileChange(idx); break;
    case 'set-duty': submitDuty(); break;
    case 'add-daycheck': submitDaycheck(seg || 'morning'); break;
    case 'add-daypass': submitDayPass(); break;
    case 'del-daypass': deleteDayPass(idx); break;
    case 'daypass-print': dayPassDownload(idx); break;
    case 'add-healthevent': submitHealthEvent(); break;
    case 'show-notify-he': showNotifyHe(idx); break;
    case 'show-return-he': showReturnHe(idx); break;
    case 'add-hazard': submitHazard(); break;
    case 'show-fix-hazard': showFixHazard(idx); break;
    case 'show-close-hazard': showCloseHazard(idx); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'daypass-download': dayPassDownload(); break;
    case 'trust-download': trustAction('download'); break;
    case 'trust-copy': trustAction('copy'); break;
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
