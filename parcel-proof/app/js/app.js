/**
 * app.js — 路由、状态变更、事件委托、弹窗、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, monthKey, fmtYuan,
  addRoutine, removeRoutine,
  addIntercept, closeIntercept,
  addComplaint, closeComplaint,
  addFine, appealFine, settleFine,
  addDestroy, setDutyDone,
  monthlySummary, inspectHtml, appealHtml,
  exportBundle, importBundle, DEFAULT_REPLY_DAYS, DEFAULT_DESTROY_DAYS,
} from './core.js';
import {
  viewBoard, viewStation, viewLedger, viewReports, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const $modalHost = document.getElementById('modal-host');

let state = loadState();
let repMonth = null;   // 月度小结用户选择的月份（跨渲染保留）
let repCache = null;   // 最近一次小结文本

const NAV = [
  ['#/board', '今日'], ['#/station', '网点'], ['#/ledger', '台账'], ['#/reports', '报表'], ['#/settings', '设置'],
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
// 弹窗（销案 / 答复 / 申诉）
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
  // 遮罩点击关闭：只处理直接点在遮罩上的事件
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
// 网点与义务
// ---------------------------------------------------------------------------

function saveStation() {
  const name = val('st-name');
  const openedISO = val('st-opened');
  if (!name) { toast('请填写网点名称'); return; }
  if (openedISO && !/^\d{4}-\d{2}-\d{2}$/.test(openedISO)) { toast('开办日不合法'); return; }
  const filed = document.getElementById('st-filed')?.value === 'yes';
  state.station = {
    ...state.station,
    name,
    brand: val('st-brand'),
    manager: val('st-manager'),
    phone: val('st-phone'),
    address: val('st-address'),
    openedISO,
    filed,
    fileNo: filed ? val('st-fileno') : '',
    filedISO: filed ? val('st-filed-date') : '',
  };
  commit('save-station');
  toast('网点信息已保存——备案钟已按开办日重算');
}

function setDuty() {
  const kind = document.getElementById('du-kind')?.value;
  const doneISO = val('du-done') || todayISO();
  try {
    setDutyDone(state, kind, doneISO, val('du-note'));
    commit('duty-done', { kind });
    toast('已登记，周期自动滚动');
  } catch (e) { fail(e); }
}

function saveVehNote() {
  state.vehicleNote = val('veh-note');
  commit('save-veh-note');
  toast('备注已保存（只存本机）');
}

// ---------------------------------------------------------------------------
// 落账 / 拦截 / 投诉 / 罚款 / 销毁
// ---------------------------------------------------------------------------

function addRoutineAction() {
  const dateISO = val('rt-date') || todayISO();
  const inbound = Number(document.getElementById('rt-inbound')?.value ?? 0);
  try {
    addRoutine(state, {
      dateISO,
      inbound: Number.isFinite(inbound) ? Math.round(inbound) : 0,
      verifyOk: document.getElementById('rt-verify')?.value !== 'no',
      realnameOk: document.getElementById('rt-realname')?.value !== 'no',
      security: document.getElementById('rt-security')?.value === 'done' ? 'done' : 'none',
      note: val('rt-note'),
    });
    commit('routine', { dateISO });
    toast('已落账——做过的动作从此有痕迹');
  } catch (e) { fail(e); }
}

function delRoutine(id) {
  try {
    removeRoutine(state, id);
    commit('del-routine');
    toast('已删除该日落账');
  } catch (e) { fail(e); }
}

function addInterceptAction() {
  try {
    addIntercept(state, {
      dateISO: val('ic-date') || todayISO(),
      person: val('ic-person'),
      item: val('ic-item'),
      reason: document.getElementById('ic-reason')?.value || 'other',
      action: document.getElementById('ic-action')?.value || 'return',
      note: val('ic-note'),
    });
    commit('add-intercept', {});
    toast('拦截已登记——这就是你没被罚的证据');
  } catch (e) { fail(e); }
}

function showCloseIntercept(id) {
  const rec = (state.intercepts ?? []).find((x) => x.id === id);
  if (!rec) return;
  openModal(`拦截销案 · ${rec.dateISO}`, `
    <p class="fine" style="margin-top:0">${rec.person || '当事人'} · ${rec.item || '—'}：暂存/报告类处置要有下文才叫闭环。</p>
    <div class="form-grid">
      <label>销案日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">处置结果<input id="m-result" placeholder="如：已当面退回并拍照 / 已报派出所回执号" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeIntercept(state, id, { closedISO: modalVal('m-date') || todayISO(), result: modalVal('m-result') });
      closeModal();
      commit('close-intercept', {});
      toast('已销案闭环');
    } catch (e) { fail(e); }
  };
}

function addComplaintAction() {
  try {
    const rec = addComplaint(state, {
      dateISO: val('cp-date') || todayISO(),
      customer: val('cp-customer'),
      channel: document.getElementById('cp-channel')?.value || 'counter',
      matter: val('cp-matter'),
    });
    commit('add-complaint', { channel: rec.channel });
    toast(`投诉已登记，答复截止 ${rec.replyDueISO}`);
  } catch (e) { fail(e); }
}

function showCloseComplaint(id) {
  const rec = (state.complaints ?? []).find((x) => x.id === id);
  if (!rec) return;
  openModal(`投诉答复 · 登记于 ${rec.dateISO}`, `
    <p class="fine" style="margin-top:0">${rec.matter || '—'} · 答复截止 ${rec.replyDueISO}（条例第 29 条：自接到投诉 ${state.settings?.replyDays ?? DEFAULT_REPLY_DAYS} 日内处理并告知）</p>
    <div class="form-grid">
      <label>答复日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>结果<select id="m-result">
        <option value="resolved">已解决</option><option value="explained">已解释沟通</option>
        <option value="unresolved">未能解决</option><option value="other">其他</option>
      </select></label>
      <label class="span2">答复方式与说明<input id="m-way" placeholder="如：电话致歉并补送 / 上门换货" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeComplaint(state, id, {
        replyISO: modalVal('m-date') || todayISO(),
        result: modalVal('m-result') || 'resolved',
        replyWay: modalVal('m-way'),
      });
      closeModal();
      commit('close-complaint', {});
      toast('答复已闭环归档');
    } catch (e) { fail(e); }
  };
}

function addFineAction() {
  const amountYuan = Number(document.getElementById('fn-amount')?.value);
  try {
    addFine(state, {
      dateISO: val('fn-date') || todayISO(),
      no: val('fn-no'),
      amountCents: Number.isFinite(amountYuan) ? Math.round(amountYuan * 100) : 0,
      basis: val('fn-basis'),
      complaintId: document.getElementById('fn-complaint')?.value || null,
    });
    commit('add-fine', {});
    toast('罚款已入账——登记申诉、落结果，钱才回得来');
  } catch (e) { fail(e); }
}

function showAppeal(id) {
  const rec = (state.fines ?? []).find((x) => x.id === id);
  if (!rec) return;
  openModal(`申诉与落结果 · ${fmtYuan(rec.amountCents)}`, `
    <p class="fine" style="margin-top:0">考核日 ${rec.dateISO} · ${rec.no || '（无编号）'} · ${rec.basis || '—'}</p>
    <div class="form-grid">
      <label>申诉日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>申诉结果<select id="m-outcome">
        <option value="pending">仅登记申诉，结果待定</option>
        <option value="overturn">申诉成立·全额撤销</option>
        <option value="partial">部分减免</option>
        <option value="sustain">维持原罚</option>
      </select></label>
      <label>挽回金额（元，部分减免时填）<input id="m-recovered" type="number" min="0" step="0.01" /></label>
      <label class="span2">申诉理由<input id="m-note" placeholder="如：该单已当面验视并留有拦截记录（可空）" /></label>
    </div>
    <p class="fine">申诉材料单在「报表」页按笔生成——把落账和拦截记录变成申诉底稿。</p>`);
  openModal._confirm = () => {
    try {
      appealFine(state, id, { appealISO: modalVal('m-date') || todayISO(), appealNote: modalVal('m-note') });
      const outcome = modalVal('m-outcome') || 'pending';
      if (outcome !== 'pending') {
        const recYuan = Number(document.getElementById('m-recovered')?.value);
        settleFine(state, id, {
          outcome,
          recoveredCents: outcome === 'sustain' ? 0 : (Number.isFinite(recYuan) ? Math.round(recYuan * 100) : 0),
        });
      }
      closeModal();
      commit('appeal-fine', { outcome });
      toast(outcome === 'pending' ? '申诉已登记' : '结果已定案，挽回金额已入账');
    } catch (e) { fail(e); }
  };
}

function addDestroyAction() {
  const count = Number(document.getElementById('ds-count')?.value ?? 0);
  try {
    addDestroy(state, {
      dateISO: val('ds-date') || todayISO(),
      way: document.getElementById('ds-way')?.value || 'shred',
      count: Number.isFinite(count) ? Math.round(count) : 0,
      operator: val('ds-operator'),
      witness: val('ds-witness'),
      note: val('ds-note'),
    });
    commit('add-destroy', {});
    toast('销毁已登记——信息泄露倒查时这就是答案');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 申诉材料单）
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
    downloadFile(`末端网点迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function appealPrint() {
  const fineId = document.getElementById('appeal-fine')?.value;
  if (!fineId) { toast('请先在台账登记罚款'); return; }
  const fine = (state.fines ?? []).find((x) => x.id === fineId);
  try {
    const html = appealHtml(state, fineId, todayISO());
    track(state, 'appeal-print', { fineId });
    downloadFile(`罚款申诉材料单_${fine?.dateISO ?? fineId}_${todayISO()}.html`, html, 'text/html');
    toast('申诉材料单已下载——附在申诉里');
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
    toast('已复制——去微信粘贴存档或发承包区群');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴存档或发承包区群');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function saveSettings() {
  const reply = Number(document.getElementById('set-reply')?.value);
  const destroy = Number(document.getElementById('set-destroy')?.value);
  const gap = Number(document.getElementById('set-gap')?.value);
  state.settings = {
    replyDays: Number.isInteger(reply) && reply >= 1 && reply <= 30 ? reply : DEFAULT_REPLY_DAYS,
    destroyDays: Number.isInteger(destroy) && destroy >= 7 && destroy <= 365 ? destroy : DEFAULT_DESTROY_DAYS,
    gapDays: Number.isInteger(gap) && gap >= 2 && gap <= 30 ? gap : 7,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`递安单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`递安单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
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
// 示例数据（30 秒体验完整流程）
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  state.station = {
    name: '城南路快递超市', brand: '星达快递（示例）', manager: '王建国', phone: '13800001234',
    address: 'XX 市城南路 128 号', openedISO: (state.station?.openedISO) || today,
    filed: true, fileNo: '邮管备字2025-0341', filedISO: today,
  };
  state.routines = [];
  state.routineSeq = 0;
  state.intercepts = [];
  state.interceptSeq = 0;
  state.complaints = [];
  state.complaintSeq = 0;
  state.fines = [];
  state.fineSeq = 0;
  state.destroys = [];
  state.destroySeq = 0;
  state.duties = [];

  // 落账：近 9 天 8 笔（含 1 天断更与 1 天实名未执行）
  const R = (daysAgo, inbound, verifyOk, realnameOk, note = '') => {
    state.routineSeq += 1;
    state.routines.push({
      id: `rt-${state.routineSeq}`, dateISO: isoAgo(today, daysAgo), inbound, verifyOk, realnameOk,
      security: 'none', note,
    });
  };
  R(1, 46, true, true);
  R(2, 52, true, true);
  R(3, 38, true, false, '一个学生件没带身份证，已让他次日带证件再寄——次日已补验');
  R(5, 61, true, true);
  R(6, 44, true, true);
  R(7, 58, true, true);
  R(8, 49, true, true);
  R(9, 41, true, true);

  // 拦截：一笔已闭环（打火机当场退回），一笔未闭环（不明液体暂存）
  state.interceptSeq += 1;
  state.intercepts.push({
    id: `ic-${state.interceptSeq}`, dateISO: isoAgo(today, 6), person: '刘先生', item: '散装打火机 20 只',
    reason: 'prohibited', action: 'return', note: '当面说明禁寄规定', closedISO: isoAgo(today, 6), result: '当场退回',
  });
  state.interceptSeq += 1;
  state.intercepts.push({
    id: `ic-${state.interceptSeq}`, dateISO: isoAgo(today, 2), person: '尾号3308', item: '无标签液体一箱',
    reason: 'prohibited', action: 'hold', note: '客户说不清是什么，先扣下', closedISO: null, result: '',
  });

  // 投诉：一笔按期闭环、一笔窗口内待答复、一笔已超期
  state.complaintSeq += 1;
  state.complaints.push({
    id: `cp-${state.complaintSeq}`, dateISO: isoAgo(today, 8), customer: '陈女士', channel: 'counter',
    matter: '快件外箱破损，内件完好', note: '', replyDueISO: isoAgo(today, 1), replyISO: isoAgo(today, 6),
    replyWay: '电话致歉并当面验货', result: 'resolved', late: false,
  });
  state.complaintSeq += 1;
  state.complaints.push({
    id: `cp-${state.complaintSeq}`, dateISO: isoAgo(today, 5), customer: '尾号6621', channel: 'hq',
    matter: '反映派件未送上门', note: '', replyDueISO: isoAgo(today, -2), replyISO: null, replyWay: '', result: '', late: false,
  });
  state.complaintSeq += 1;
  state.complaints.push({
    id: `cp-${state.complaintSeq}`, dateISO: isoAgo(today, 12), customer: '周先生', channel: '12305',
    matter: '快件显示签收但未收到（放门口丢失）', note: '', replyDueISO: isoAgo(today, 5), replyISO: null,
    replyWay: '', result: '', late: false,
  });

  // 罚款：一笔部分减免（挽回 120），一笔待申诉（关联超期投诉）
  state.fineSeq += 1;
  state.fines.push({
    id: `fn-${state.fineSeq}`, dateISO: isoAgo(today, 20), no: 'KH-20260817-021', amountCents: 20000,
    basis: '破损考核', complaintId: `cp-1`, note: '', appealISO: isoAgo(today, 18),
    appealNote: '包装为寄件人自备，收寄时已当面验视外箱完好', outcome: 'partial', recoveredCents: 12000,
  });
  state.fineSeq += 1;
  state.fines.push({
    id: `fn-${state.fineSeq}`, dateISO: isoAgo(today, 4), no: 'KH-20260902-114', amountCents: 30000,
    basis: '12305 申诉考核', complaintId: `cp-3`, note: '', appealISO: null, appealNote: '',
    outcome: 'pending', recoveredCents: 0,
  });

  // 销毁：105 天前一次（90 天周期 → 已超期）
  state.destroySeq += 1;
  state.destroys.push({
    id: `ds-${state.destroySeq}`, dateISO: isoAgo(today, 105), way: 'shred', count: 340,
    operator: '王建国', witness: '李芳', note: '纸质底单集中碎纸',
  });

  // 义务：培训 40 天前（90 天周期，在期）、演练 380 天前（逾期）、消防器材 45 天前（逾期）
  setDutyDone(state, 'training', isoAgo(today, 40), '全员 4 人，含新入职 1 人');
  setDutyDone(state, 'drill', isoAgo(today, 380), '半年度预案演练');
  setDutyDone(state, 'fire', isoAgo(today, 45), '灭火器 4 具压力正常');

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
    case 'save-station': saveStation(); break;
    case 'set-duty': setDuty(); break;
    case 'save-veh-note': saveVehNote(); break;
    case 'add-routine': addRoutineAction(); break;
    case 'del-routine': delRoutine(idx); break;
    case 'add-intercept': addInterceptAction(); break;
    case 'show-close-intercept': showCloseIntercept(idx); break;
    case 'add-complaint': addComplaintAction(); break;
    case 'show-close-complaint': showCloseComplaint(idx); break;
    case 'add-fine': addFineAction(); break;
    case 'show-appeal': showAppeal(idx); break;
    case 'add-destroy': addDestroyAction(); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'appeal-print': appealPrint(); break;
    case 'save-settings': saveSettings(); break;
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
