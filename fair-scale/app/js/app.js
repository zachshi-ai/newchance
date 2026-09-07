/**
 * app.js — 路由、状态变更、事件委托、弹窗、示例数据与启动
 */
import {
  loadState, saveState, track,
} from './store.js';
import {
  todayISO,
  addScale, recordScaleChange, resumeScale, logFairCheck, logPatrol,
  issueCard, liftCard, activeCards,
  createComplaint, recheckComplaint, resolveComplaint, recoverComplaint, closeComplaint,
  setDutyDone, DEVIATION_TABLE, SCALE_CHANGES,
  recheckSheetHtml, inspectHtml, monthlyText, seedState,
  exportBundle, importBundle,
} from './core.js';
import {
  viewBoard, viewScales, viewFair, viewPatrol, viewCards, viewComplaints, viewDuties,
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
  ['#/board', '今日', 'board'], ['#/scales', '秤档', 'scale'], ['#/fair', '公平秤', 'balance'],
  ['#/patrol', '巡查', 'patrol'], ['#/cards', '牌榜', 'flag'], ['#/complaints', '投诉', 'chat'],
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
    case 'scales': html = viewScales(state, today); break;
    case 'fair': html = viewFair(state, today); break;
    case 'patrol': html = viewPatrol(state, today); break;
    case 'cards': html = viewCards(state, today); break;
    case 'complaints': html = viewComplaints(state, today); break;
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
// 弹窗（变动报备 / 恢复使用 / 公平秤核查 / 摘牌 / 追偿 / 闭环 / 义务登记）
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

function modalChecked(id) {
  return document.getElementById(id)?.checked === true;
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
// 设置：市场信息与口径参数
// ---------------------------------------------------------------------------

function saveOrg() {
  const name = val('org-name');
  if (!name) { fail('市场名称必填'); return; }
  state.org = {
    ...state.org,
    name, district: val('org-district'), manager: val('org-manager'),
    phone: val('org-phone'), note: val('org-note'),
  };
  commit('org_saved');
  ok('市场信息已保存');
}

function saveSettings() {
  const keys = ['certWarnDays', 'certRedDays', 'verifyMonths', 'patrolDays', 'complaintDays',
    'ledgerAuditDays', 'adminTrainingDays', 'agreementAuditDays', 'promiseOrgDays', 'verifyPlanDays'];
  for (const k of keys) {
    const n = numVal(`set-${k}`);
    if (Number.isInteger(n) && n > 0) state.settings[k] = n;
  }
  commit('settings_saved');
  ok('口径参数已保存（属地要求永远赢）');
}

// ---------------------------------------------------------------------------
// 秤档：建档 / 变动报备 / 恢复
// ---------------------------------------------------------------------------

function addScaleAction() {
  try {
    const x = addScale(state, {
      role: val('sc-role') || 'trade', stall: val('sc-stall'), vendor: val('sc-vendor'),
      vendorPhone: val('sc-vendorphone'), type: val('sc-type') || '电子计价秤', brand: val('sc-brand'),
      capacityKg: numVal('sc-capacity'), divisionG: numVal('sc-division'),
      certNo: val('sc-certno'), verifiedISO: val('sc-verified'), stickerAffixed: checked('sc-sticker'),
      note: val('sc-note'),
    });
    if (x.role === 'fair') state.org.fairStall = x.stall;
    commit('scale_added', { role: x.role });
    ok(`已登记造册：${x.stall}${x.role === 'fair' ? '（公平秤）' : ''}——强检钟开走`);
  } catch (e) { fail(e); }
}

function showChangeScale(scaleId) {
  const x = state.scales.find((y) => y.id === scaleId);
  if (!x) return;
  openModal(`变动报备（第9条(二)：新增/减少/更换/维修及时更新登记）——${x.stall}`,
    `<div class="formgrid">
      <label>变动情形<select id="m-change">
        ${Object.entries(SCALE_CHANGES).map(([k, v]) => `<option value="${k}">${v}${k === 'replace' || k === 'repair' ? '（换/修后须重新检定才可继续用）' : ''}</option>`).join('')}
      </select></label>
      <label>日期<input id="m-change-date" type="date" value="${todayISO()}" /></label>
      <label class="wide">说明<input id="m-change-note" placeholder="例：新秤到位/旧秤退场/换传感器" /></label>
    </div>
    <p class="basis">减少=撤场留痕；更换=停用待新检定；维修=在用但检定钟作废（重新检定后用「恢复」录入新检定记录）。</p>`, 'confirm-change-scale');
  $modalHost.querySelector('.modal').dataset.scaleId = scaleId;
}

function confirmChangeScale() {
  const scaleId = $modalHost.querySelector('.modal')?.dataset.scaleId;
  try {
    recordScaleChange(state, scaleId, modalVal('m-change'), {
      dateISO: modalVal('m-change-date') || todayISO(), note: modalVal('m-change-note'),
    });
    closeModal();
    commit('scale_changed', { scaleId });
    ok('变动已报备登记');
  } catch (e) { fail(e); }
}

function showResumeScale(scaleId) {
  openModal('恢复使用（更换/维修后：录新检定记录才能回台面）',
    `<div class="formgrid">
      <label>新检定日期 *<input id="m-resume-verified" type="date" value="${todayISO()}" /></label>
      <label>新检定证书号<input id="m-resume-cert" placeholder="例：JS2026-00xxxxx" /></label>
      <label class="chk"><input type="checkbox" id="m-resume-sticker" /> 新强检合格标志已确认粘贴</label>
    </div>`, 'confirm-resume-scale');
  $modalHost.querySelector('.modal').dataset.scaleId = scaleId;
}

function confirmResumeScale() {
  const scaleId = $modalHost.querySelector('.modal')?.dataset.scaleId;
  try {
    resumeScale(state, scaleId, {
      verifiedISO: modalVal('m-resume-verified'), certNo: modalVal('m-resume-cert'), stickerAffixed: modalChecked('m-resume-sticker'),
    });
    closeModal();
    commit('scale_resumed', { scaleId });
    ok('已恢复使用，强检钟按新检定日重走');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 公平秤 / 巡查 / 牌榜
// ---------------------------------------------------------------------------

function showFairCheck(scaleId) {
  openModal('公平秤按日核账（第5条(六)：保管、维护和监督检查，保证量值准确）',
    `<div class="formgrid">
      <label>核查日期<input id="m-fair-date" type="date" value="${todayISO()}" /></label>
      <label class="chk"><input type="checkbox" id="m-fair-ok" checked /> 砝码试核正常（放标准砝码示值一致）</label>
      <label class="wide">备注<input id="m-fair-note" placeholder="异常时写明处置" /></label>
    </div>`, 'confirm-fair-check');
  $modalHost.querySelector('.modal').dataset.scaleId = scaleId;
}

function confirmFairCheck() {
  const scaleId = $modalHost.querySelector('.modal')?.dataset.scaleId;
  try {
    logFairCheck(state, {
      scaleId, dateISO: modalVal('m-fair-date') || todayISO(), ok: modalChecked('m-fair-ok'), note: modalVal('m-fair-note'),
    });
    closeModal();
    commit('fair_checked', { scaleId });
    ok('公平秤核查已记录');
  } catch (e) { fail(e); }
}

function logPatrolAction() {
  try {
    const finds = [];
    const fproblem = val('pt-fproblem');
    if (fproblem) {
      finds.push({ stall: val('pt-fstall'), problem: fproblem, measure: val('pt-fmeasure') });
    }
    logPatrol(state, {
      dateISO: val('pt-date') || todayISO(), stallsChecked: numVal('pt-stalls') || 0,
      finds, note: val('pt-note'),
    });
    commit('patrol_logged', { finds: finds.length });
    ok('巡查已登记');
  } catch (e) { fail(e); }
}

function issueCardAction() {
  try {
    issueCard(state, {
      stall: val('cd-stall'), vendor: val('cd-vendor'), color: val('cd-color'),
      reason: val('cd-reason'), note: val('cd-note'),
    });
    commit('card_issued');
    ok('红黄牌已出具（记得按第7条在场内公示）');
  } catch (e) { fail(e); }
}

function showLiftCard(cardId) {
  openModal('摘牌（整改验收合格后）',
    `<label>摘牌日期<input id="m-lift-date" type="date" value="${todayISO()}" /></label>
     <label>验收说明<input id="m-lift-note" placeholder="例：换秤并检定合格，复秤无异常" /></label>`, 'confirm-lift-card');
  $modalHost.querySelector('.modal').dataset.cardId = cardId;
}

function confirmLiftCard() {
  const cardId = $modalHost.querySelector('.modal')?.dataset.cardId;
  try {
    liftCard(state, cardId, { liftedISO: modalVal('m-lift-date') || todayISO(), note: modalVal('m-lift-note') });
    closeModal();
    commit('card_lifted', { cardId });
    ok('已摘牌');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 投诉（第12条状态机）
// ---------------------------------------------------------------------------

function createComplaintAction() {
  try {
    createComplaint(state, {
      dateISO: val('cp-date') || todayISO(), stall: val('cp-stall'), vendor: val('cp-vendor'),
      commodity: val('cp-commodity'), band: val('cp-band'), unitPrice: numVal('cp-price'),
      settleKg: numVal('cp-settle'), note: val('cp-note'),
    });
    commit('complaint_created');
    ok('投诉已受理——下一步用公平秤复核');
  } catch (e) { fail(e); }
}

function recheckComplaintAction(complaintId) {
  try {
    const c = recheckComplaint(state, complaintId, {
      actualKg: numVal(`ck-actual-${complaintId}`),
      method: val(`ck-method-${complaintId}`) || 'same',
      unitPrice: numVal(`ck-price-${complaintId}`),
    });
    commit('complaint_rechecked', { complaintId, excess: c.verdict === 'excess' });
    ok(c.verdict === 'excess'
      ? `复核判定：短秤缺量超差（差 ${c.verify.diffG}g / 允 ${c.verify.allowedG}g）——进入处置`
      : '复核判定：未超法定负偏差——可向消费者解释结案');
  } catch (e) { fail(e); }
}

function resolveComplaintAction(complaintId) {
  try {
    resolveComplaint(state, complaintId, {
      mode: val(`rs-mode-${complaintId}`) || (state.complaints.find((c) => c.id === complaintId)?.verdict === 'excess' ? 'refund' : 'dismiss'),
      measure: val(`rs-measure-${complaintId}`),
    });
    commit('complaint_resolved', { complaintId });
    ok('处置已登记');
  } catch (e) { fail(e); }
}

function showRecoverComplaint(complaintId) {
  openModal('登记追偿到账（第12条：主办者先行赔偿后向经营者追偿）',
    `<label>追偿日期<input id="m-recover-date" type="date" value="${todayISO()}" /></label>
     <label>追偿说明<input id="m-recover-note" placeholder="例：从摊位保证金中扣回" /></label>
     <p class="basis">追偿不闭环，这笔钱就一直挂在市场账上——体检会一直亮红灯。</p>`, 'confirm-recover-complaint');
  $modalHost.querySelector('.modal').dataset.complaintId = complaintId;
}

function confirmRecoverComplaint() {
  const complaintId = $modalHost.querySelector('.modal')?.dataset.complaintId;
  try {
    recoverComplaint(state, complaintId, { recoveredISO: modalVal('m-recover-date') || todayISO(), note: modalVal('m-recover-note') });
    closeModal();
    commit('complaint_recovered', { complaintId });
    ok('追偿已登记，闭环');
  } catch (e) { fail(e); }
}

function closeComplaintAction(complaintId) {
  try {
    closeComplaint(state, complaintId, { closedISO: todayISO() });
    commit('complaint_closed', { complaintId });
    ok('投诉已闭环');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 义务 / 出证 / 数据
// ---------------------------------------------------------------------------

function showSetDuty(kind) {
  openModal('登记义务完成',
    `<label>完成日期<input id="m-duty-date" type="date" value="${todayISO()}" /></label>
     <p class="basis">下一次到期 = 该日期 + 周期（周期在「设置」可按属地覆盖）。</p>`, 'confirm-set-duty');
  $modalHost.querySelector('.modal').dataset.dutyKind = kind;
}

function confirmSetDuty() {
  const kind = $modalHost.querySelector('.modal')?.dataset.dutyKind;
  try {
    setDutyDone(state, kind, modalVal('m-duty-date') || todayISO());
    closeModal();
    commit('duty_done', { kind });
    ok('义务已登记');
  } catch (e) { fail(e); }
}

function repGen() {
  repMonth = val('rep-month') || todayISO().slice(0, 7);
  repCache = monthlyText(state, repMonth);
  commit('monthly_report');
  ok(`已汇总 ${repMonth}`);
}

function repDownload() {
  if (!repCache) repGen();
  downloadFile(`集贸市场计量合规月度小结-${repMonth}.txt`, repCache ?? monthlyText(state, repMonth ?? todayISO().slice(0, 7)));
}

function inspectDownload() {
  const html = inspectHtml(state, todayISO());
  track(state, 'inspect_generated');
  saveState(state);
  downloadFile(`集贸市场计量合规迎检自证包-${todayISO()}.html`, html, 'text/html;charset=utf-8');
  ok('自证包已生成');
}

function inspectPrint() {
  printHtml(inspectHtml(state, todayISO()));
}

function printRecheckSheet(complaintId) {
  printHtml(recheckSheetHtml(state, complaintId));
}

function dataExport() {
  downloadFile(`秤平账备份-${todayISO()}.json`, JSON.stringify(exportBundle(state), null, 2), 'application/json');
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
    case 'add-scale': addScaleAction(); break;
    case 'show-change-scale': showChangeScale(idx); break;
    case 'confirm-change-scale': confirmChangeScale(); break;
    case 'show-resume-scale': showResumeScale(idx); break;
    case 'confirm-resume-scale': confirmResumeScale(); break;
    case 'show-fair-check': showFairCheck(idx); break;
    case 'confirm-fair-check': confirmFairCheck(); break;
    case 'log-patrol': logPatrolAction(); break;
    case 'issue-card': issueCardAction(); break;
    case 'show-lift-card': showLiftCard(idx); break;
    case 'confirm-lift-card': confirmLiftCard(); break;
    case 'create-complaint': createComplaintAction(); break;
    case 'recheck-complaint': recheckComplaintAction(idx); break;
    case 'resolve-complaint': resolveComplaintAction(idx); break;
    case 'show-recover-complaint': showRecoverComplaint(idx); break;
    case 'confirm-recover-complaint': confirmRecoverComplaint(); break;
    case 'close-complaint': closeComplaintAction(idx); break;
    case 'show-set-duty': showSetDuty(idx); break;
    case 'confirm-set-duty': confirmSetDuty(); break;
    case 'rep-gen': repGen(); break;
    case 'rep-copy': if (!repCache) repGen(); copyText(repCache); break;
    case 'rep-download': repDownload(); break;
    case 'inspect-download': inspectDownload(); break;
    case 'inspect-print': inspectPrint(); break;
    case 'print-recheck-sheet': printRecheckSheet(idx); break;
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
  if (el.id === 'rep-month') {
    repMonth = el.value;
  }
});

window.addEventListener('hashchange', render);
render();

// 离线可用（PWA）：注册失败静默降级为在线应用
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
