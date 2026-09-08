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
  addCrew, setCrewActive,
  addChange, fileChange,
  addDefect, fixDefect, closeDefect,
  recordSelfcheck, selfcheckItemsFor,
  addVoyage, removeVoyage,
  setDutyDone,
  monthlySummary, inspectHtml, voyagePassHtml,
  exportBundle, importBundle,
  DEFAULT_SURVEY_WARN_DAYS, DEFAULT_INSURANCE_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
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
  ['#/board', '今日', 'board'], ['#/station', '建档', 'station'], ['#/ledger', '开航', 'ledger'], ['#/reports', '报表', 'reports'], ['#/settings', '设置', 'settings'],
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
// 弹窗（变更办结 / 缺陷整改 / 复查销案）
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
// 建档（船舶 / 船员 / 变更 / 义务）
// ---------------------------------------------------------------------------

function submitShip() {
  const name = val('vs-name');
  if (!name) { toast('请填写船名'); return; }
  const minCrew = Number(val('vs-mincrew'));
  state.ship = {
    ...state.ship,
    name,
    nationalNo: val('vs-nationalno'),
    surveyNo: val('vs-surveyno'),
    kind: document.getElementById('vs-kind')?.value || '',
    gt: val('vs-gt'),
    minCrew: Number.isInteger(minCrew) && minCrew > 0 ? minCrew : 0,
    docs: {
      survey: val('vs-survey'),
      national: val('vs-national'),
      manning: val('vs-manning'),
      insurance: val('vs-insurance'),
    },
    captain: val('vs-captain'),
    port: val('vs-port'),
    route: val('vs-route'),
    phone: val('vs-phone'),
    note: val('vs-note'),
  };
  commit('save-ship');
  toast('船舶信息已保存——四证钟已按有效期起算');
}

function submitCrew() {
  try {
    addCrew(state, {
      name: val('cw-name'),
      role: document.getElementById('cw-role')?.value || 'sailor',
      certNo: val('cw-certno'),
      certValidISO: val('cw-cert'),
      birthISO: val('cw-birth'),
      healthValidISO: val('cw-health'),
      note: val('cw-note'),
    });
    commit('add-crew', {});
    toast('已入册——开航点名与证书钟以此为准');
  } catch (e) { fail(e); }
}

function toggleCrew(id) {
  try {
    const rec = (state.crew ?? []).find((c) => c.id === id);
    setCrewActive(state, id, !(rec?.active));
    commit('toggle-crew', {});
    toast(rec?.active ? '已登记离船——历史开航单仍可回溯到当次点名' : '已复职在册');
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
    toast('变更已登记——向船籍港登记机关办理后点「办结」');
  } catch (e) { fail(e); }
}

function showFileChange(id) {
  const c = (state.changes ?? []).find((x) => x.id === id);
  if (!c) return;
  openModal(`变更办结 · ${c.detail}`, `
    <p class="fine" style="margin-top:0">向船籍港登记机关办理变更登记完成，录入办理回执日期。</p>
    <div class="form-grid">
      <label>办理日期 *<input id="m-date" type="date" value="${todayISO()}" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      fileChange(state, id, modalVal('m-date') || todayISO());
      closeModal();
      commit('file-change', {});
      toast('变更登记已办结');
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
// 开航五道闸 / 自查 / 缺陷
// ---------------------------------------------------------------------------

function submitSelfcheck() {
  const dateISO = todayISO();
  const results = {};
  for (const it of selfcheckItemsFor()) {
    results[it.key] = {
      ok: !!document.getElementById(`sc-${it.key}`)?.checked,
      note: document.getElementById(`scnote-${it.key}`)?.value?.trim() ?? '',
    };
  }
  try {
    const rec = recordSelfcheck(state, { dateISO, results, note: '' });
    commit('add-selfcheck', {});
    toast(rec.status === 'issue'
      ? '自查卡已落——异常已自动转缺陷，闭环前开航闸不放行'
      : '自查卡已落，全项正常——可以去过闸开航');
  } catch (e) { fail(e); }
}

function submitVoyage() {
  const payload = {
    dateISO: val('vg-date') || todayISO(),
    crewIds: multiVal('vg-crew'),
    note: val('vg-note'),
  };
  try {
    addVoyage(state, payload);
    commit('add-voyage', {});
    toast('✅ 开航单已落——五道闸全过，当次快照已存');
  } catch (e) {
    // 闸机拦截：埋点留痕——每次拦截都是没被扣的证据
    track(state, 'voyage-blocked', { reasons: String(e?.message ?? e).slice(0, 500), dateISO: payload.dateISO });
    saveState(state);
    toast(`⛔ ${String(e?.message ?? e).slice(0, 160)}`);
  }
}

function deleteVoyage(id) {
  try {
    removeVoyage(state, id);
    commit('del-voyage');
    toast('已删除该开航单');
  } catch (e) { fail(e); }
}

function submitDefect() {
  try {
    addDefect(state, {
      dateISO: val('df-date') || todayISO(),
      source: document.getElementById('df-source')?.value || 'company',
      desc: val('df-desc'),
    });
    commit('add-defect', {});
    toast('缺陷已登记——整改、复查销案后闭环');
  } catch (e) { fail(e); }
}

function showFixDefect(id) {
  const d = (state.defects ?? []).find((x) => x.id === id);
  if (!d) return;
  openModal(`缺陷整改 · ${d.desc}`, `
    <p class="fine" style="margin-top:0">整改必须写明措施与完成日，只打勾不留痕不算整改。</p>
    <div class="form-grid">
      <label>整改完成日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">整改措施 *<input id="m-action" placeholder="如：更换自亮浮灯并全船救生设备点验" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      fixDefect(state, id, { actionISO: modalVal('m-date') || todayISO(), action: modalVal('m-action') });
      closeModal();
      commit('fix-defect', {});
      toast('整改已登记——复查销案后闭环');
    } catch (e) { fail(e); }
  };
}

function showCloseDefect(id) {
  const d = (state.defects ?? []).find((x) => x.id === id);
  if (!d) return;
  openModal(`复查销案 · ${d.desc}`, `
    <p class="fine" style="margin-top:0">整改措施：${d.action || '—'}（${d.actionISO || '—'}）。销案建议由船长/船东执行；闭环后开航闸恢复放行。</p>
    <div class="form-grid">
      <label>复查日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>复查人 *<input id="m-verifier" value="${state.ship?.captain || ''}" placeholder="建议船长/船东" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeDefect(state, id, { verifyISO: modalVal('m-date') || todayISO(), verifiedBy: modalVal('m-verifier') });
      closeModal();
      commit('close-defect', {});
      toast('已复查销案——缺陷闭环，开航闸放行');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 当次开航单）
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
    downloadFile(`内河船舶合规迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function voyageDownload(voyageId) {
  voyageId = voyageId || document.getElementById('case-voyage')?.value;
  if (!voyageId) { toast('请先过闸开出开航单'); return; }
  try {
    const html = voyagePassHtml(state, voyageId, todayISO());
    track(state, 'voyage-print', { voyageId });
    downloadFile(`当次开航单_${todayISO()}.html`, html, 'text/html');
    toast('开航单已下载——打印随船，海事登轮 10 秒出示');
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
    toast('已复制——去船东群/公司粘贴存档');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去船东群/公司粘贴存档');
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
    surveyWarnDays: num('set-survey', 15, 180, DEFAULT_SURVEY_WARN_DAYS),
    insuranceWarnDays: num('set-insurance', 7, 120, DEFAULT_INSURANCE_WARN_DAYS),
    dutyWarnDays: num('set-duty', 7, 120, DEFAULT_DUTY_WARN_DAYS),
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`船安单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`船安单使用记录_${todayISO()}.json`, JSON.stringify(state.traces ?? [], null, 2), 'application/json');
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
// 顺序敏感：先落昨日自查+开航单，再落今日异常自查——否则回溯被当前缺陷拦截。
// 种子必须完整通过自己造的闸机（配员/证书口径先行自检）。
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  state.ship = {
    name: '皖顺达 666（示例）', nationalNo: '皖XXXXXXX', surveyNo: '2024XXXXXX', kind: '干货船', gt: '980',
    minCrew: 3,
    captain: '陈定波', port: '芜湖', route: '芜湖—南京（单航次约 5 小时）', phone: '138XXXX6666',
    note: '2024-05-20 换发国籍证书；配员证书核定船长 1+驾驶员 1+轮机员 1',
    docs: {
      survey: isoAgo(today, -40),      // 剩 40 天=临期黄（isoAgo 负数=未来）
      national: isoAgo(today, -300),   // 剩 300 天=换发窗口黄（届满前 1 年）
      manning: isoAgo(today, -500),    // 在期
      insurance: isoAgo(today, -25),   // 剩 25 天=临期黄
    },
  };
  state.crew = [];
  state.crewSeq = 0;
  state.selfchecks = [];
  state.selfcheckSeq = 0;
  state.voyages = [];
  state.voyageSeq = 0;
  state.defects = [];
  state.defectSeq = 0;
  state.changes = [];
  state.changeSeq = 0;
  state.duties = [];

  // 船员：船长+驾驶员+轮机员+水手（水手适任证过期 20 天=红灯；轮机员健康证明临期 20 天）
  const chen = addCrew(state, { name: '陈定波', role: 'captain', certNo: '皖3410******0001', certValidISO: isoAgo(today, -700), birthISO: '1979-03-12', healthValidISO: isoAgo(today, -400) });
  const liu = addCrew(state, { name: '刘江海', role: 'officer', certNo: '皖3410******0012', certValidISO: isoAgo(today, -80), birthISO: '1988-11-02', healthValidISO: isoAgo(today, -350) });
  const wang = addCrew(state, { name: '王轮机', role: 'engineer', certNo: '皖3410******0021', certValidISO: isoAgo(today, -600), birthISO: '1985-06-18', healthValidISO: isoAgo(today, -20), note: '健康证明剩 20 天=临期黄' });
  addCrew(state, { name: '赵小满', role: 'sailor', certNo: '', certValidISO: '', birthISO: '1996-01-15', healthValidISO: isoAgo(today, -300), note: '水手——培训证明按公司口径管理' });
  addCrew(state, { name: '孙老三', role: 'sailor', certValidISO: isoAgo(today, 20), birthISO: '1970-08-01', healthValidISO: isoAgo(today, -320), note: '适任证已过期 20 天——开航点名不可用' });

  // 昨天：全项正常自查 + 已开航（闸机全过，3 名合格船员在船）
  const yesterday = isoAgo(today, 1);
  const itemsY = selfcheckItemsFor();
  recordSelfcheck(state, {
    dateISO: yesterday,
    results: Object.fromEntries(itemsY.map((it) => [it.key, { ok: true, note: '' }])),
  });
  addVoyage(state, { dateISO: yesterday, crewIds: [chen.id, liu.id, wang.id], note: '芜湖→南京，普货 800 吨' });

  // 今天：自查 1 项异常（舵机压力→自动转缺陷未闭环=开航闸第 5 道拦截）
  const itemsT = selfcheckItemsFor();
  recordSelfcheck(state, {
    dateISO: today,
    results: Object.fromEntries(itemsT.map((it) => it.key === 'engine'
      ? [it.key, { ok: false, note: '舵机压力偏低，已停航联系检修，待复位复测' }]
      : [it.key, { ok: true, note: '' }])),
  });

  // 变更：1 项未办结（经营人变更中——黄灯示例）
  addChange(state, { dateISO: isoAgo(today, 30), kind: 'owner', detail: '经营人由个体变更为顺达水运（已报材料待回执）' });

  // 周期义务：演习逾期 20 天（红）/ 维护在期 / 报告核查在期 / 图籍逾期 10 天（红）/ 换发窗口核查在期 / 保险在期
  setDutyDone(state, 'drill', isoAgo(today, 110), '弃船+消防演习（全员）');
  setDutyDone(state, 'maintenance', isoAgo(today, 15), '主机 250h 保养');
  setDutyDone(state, 'reportcheck', isoAgo(today, 10), '进出港报告与日志核查');
  setDutyDone(state, 'charts', isoAgo(today, 100), '图籍更新（新版航道图）');
  setDutyDone(state, 'renewcheck', isoAgo(today, 60), '国籍证书换发窗口核查（已约船籍港登记）');
  setDutyDone(state, 'insurance', isoAgo(today, 30), '污染损害责任险（保单 CY2026-0712）');

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
    case 'save-ship': submitShip(); break;
    case 'add-crew': submitCrew(); break;
    case 'toggle-crew': toggleCrew(idx); break;
    case 'add-change': submitChange(); break;
    case 'show-file-change': showFileChange(idx); break;
    case 'set-duty': submitDuty(); break;
    case 'add-selfcheck': submitSelfcheck(); break;
    case 'add-voyage': submitVoyage(); break;
    case 'del-voyage': deleteVoyage(idx); break;
    case 'voyage-print': voyageDownload(idx); break;
    case 'add-defect': submitDefect(); break;
    case 'show-fix-defect': showFixDefect(idx); break;
    case 'show-close-defect': showCloseDefect(idx); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'voyage-download': voyageDownload(); break;
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
