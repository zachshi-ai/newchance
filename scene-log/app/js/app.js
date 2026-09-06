/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, emptyState, uid,
} from './store.js';
import {
  todayISO, monthKey, addDays, escapeHtml,
  dayTypeOf, minorsAllowedOn, filingClock, venueFilingClock, markScriptChanged,
  removeSession, openIssue, closeIssue,
  monthlySummaryText, inspectionPackHtml, patrolCardHtml,
  exportBundle, importBundle, healthCheck,
  AGE_RANGES, SCRIPT_KINDS, HOLIDAYS_2026,
} from './core.js';
import {
  viewBoard, viewScripts, viewLedger, viewDuties, viewVenue, viewReports, viewSettings, ICONS,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const $modalHost = document.getElementById('modal-host');

let state = loadState();
let repMonth = null;   // 月度小结用户选择的月份（跨渲染保留）
let repCache = null;   // 最近一次小结文本

const NAV = [
  ['#/board', '今日', 'board'], ['#/scripts', '剧本', 'scripts'], ['#/ledger', '开本', 'ledger'],
  ['#/duties', '义务', 'duties'], ['#/venue', '场所', 'venue'], ['#/reports', '出证', 'reports'],
  ['#/settings', '设置', 'settings'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'scripts': html = viewScripts(state); break;
    case 'ledger': html = viewLedger(state); break;
    case 'duties': html = viewDuties(state); break;
    case 'venue': html = viewVenue(state); break;
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

function num(id) {
  const v = document.getElementById(id)?.value;
  return v === '' || v === undefined || v === null ? NaN : Number(v);
}

function checked(id) {
  return !!document.getElementById(id)?.checked;
}

function download(name, text, mime = 'text/html;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function openPrintWindow(html) {
  const w = window.open('', '_blank');
  if (!w) { toast('浏览器拦截了打印窗口，请允许弹窗或改用下载'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

// ---------------------------------------------------------------------------
// 建模动作
// ---------------------------------------------------------------------------

function addScriptFromForm(e) {
  e.preventDefault();
  try {
    const name = val('sc-name');
    const useStartISO = val('sc-use');
    if (!name) throw new Error('剧本名必填');
    if (!useStartISO) throw new Error('开始使用日必填');
    if (state.scripts.some((s) => s.name === name && !s.removed)) throw new Error('同名剧本已存在');
    const review = val('sc-review');
    state.scripts.push({
      id: uid(), name, kind: val('sc-kind') || 'boxed', author: val('sc-author'),
      ageRange: val('sc-age') || 'all', restrictedScene: checked('sc-restricted'),
      useStartISO, filedISO: '', filingNo: '',
      selfReviewedISO: review || '', changedAtISO: '', note: val('sc-note'),
    });
    state.scriptSeq += 1;
    commit('script_added', { name, ageRange: val('sc-age') });
    toast(`✅《${name}》已上钟：${useStartISO} 起 ${state.limits.filingDays} 日内备案`);
  } catch (err) { fail(err); }
}

function fileScript(id) {
  const s = state.scripts.find((x) => x.id === id);
  if (!s) return fail(new Error('剧本不存在'));
  const today = todayISO();
  const def = today;
  const html = `<div class="modal-card"><h3>登记备案回执 · ${escapeHtml(s.name)}</h3>
    <p class="fine">在「全国文化市场技术监管与服务平台」办理后，把备案日与回执号抄进来——报备钟即刻归绿。</p>
    <div class="form-grid">
      <label>备案日<input id="mf-date" type="date" value="${def}"></label>
      <label>回执号/流水号<input id="mf-no" placeholder="选填"></label>
    </div>
    <div class="row"><button class="btn" id="mf-ok">登记</button><button class="btn ghost" id="mf-cancel">取消</button></div></div>`;
  $modalHost.innerHTML = html;
  document.getElementById('mf-cancel').onclick = () => { $modalHost.innerHTML = ''; };
  document.getElementById('mf-ok').onclick = () => {
    try {
      const d = val('mf-date');
      if (!d) throw new Error('备案日必填');
      s.filedISO = d;
      s.filingNo = val('mf-no');
      $modalHost.innerHTML = '';
      commit('script_filed', { name: s.name, filedISO: d });
      toast(`✅《${s.name}》报备钟归绿`);
    } catch (err) { fail(err); }
  };
}

function reviewScript(id) {
  const s = state.scripts.find((x) => x.id === id);
  if (!s) return;
  s.selfReviewedISO = todayISO();
  commit('script_reviewed', { name: s.name });
  toast(`✅《${s.name}》内容自审已留痕`);
}

function changeScript(id) {
  const s = state.scripts.find((x) => x.id === id);
  if (!s) return;
  const today = todayISO();
  s.changedAtISO = today;
  commit('script_changed', { name: s.name, changedAtISO: today });
  toast(`⚠️《${s.name}》按实质变更处理：报备钟自 ${today} 重新起算`);
}

function delScript(id) {
  const s = state.scripts.find((x) => x.id === id);
  if (!s) return;
  const used = (state.sessions || []).filter((se) => se.scriptId === id).length;
  if (used > 0) return fail(new Error(`该剧本已有 ${used} 场开本记录，先撤场次或保留剧本（台账不可断链）`));
  state.scripts = state.scripts.filter((x) => x.id !== id);
  commit('script_removed', { name: s.name });
  toast('已删除');
}

function addSessionFromForm(e) {
  e.preventDefault();
  try {
    const dateISO = val('ss-date');
    const scriptId = val('ss-script');
    const players = num('ss-players');
    const minors = num('ss-minors') || 0;
    if (!dateISO) throw new Error('日期必填');
    if (!scriptId) throw new Error('请先建剧本');
    if (!Number.isFinite(players) || players < 1) throw new Error('玩家人数至少 1 人');
    if (!Number.isFinite(minors) || minors < 0) throw new Error('未成年人数非法');
    if (minors > players) throw new Error('未成年人数不得超过玩家人数');
    const sc = state.scripts.find((s) => s.id === scriptId);
    if (!sc) throw new Error('剧本不存在');
    const dup = state.sessions.some((se) => se.dateISO === dateISO && (se.start || '') === val('ss-start') && se.scriptId === scriptId);
    if (dup) throw new Error('同日同时段同剧本的场次已存在');
    const ageChecked = checked('ss-ageck');
    state.sessions.push({
      id: uid(), dateISO, start: val('ss-start'), scriptId,
      players, minors, ageChecked, patrol: false, note: '',
    });
    state.sessionSeq += 1;
    const allowed = minorsAllowedOn(dateISO, state.calendar);
    commit('session_registered', { dateISO, minors, allowed });
    if (minors > 0 && !allowed) {
      toast(`🚨 落账成功，但这是${({ holiday: '法定节假日', vacation: '寒暑假', rest: '休息日', comp: '调休补班日', work: '工作日' })[dayTypeOf(dateISO, state.calendar)]}——接待未成年人触碰限时红线，建议改期`);
    } else {
      toast('✅ 开本已落账，局后记得防火巡查打卡');
    }
  } catch (err) { fail(err); }
}

function patrolSession(id) {
  const se = state.sessions.find((x) => x.id === id);
  if (!se) return fail(new Error('场次不存在'));
  if (se.patrol) return fail(new Error('该场已巡查'));
  se.patrol = true;
  commit('patrol_done', { dateISO: se.dateISO });
}

function patrolAllToday() {
  const today = todayISO();
  let n = 0;
  for (const se of state.sessions) {
    if (se.dateISO === today && !se.patrol) { se.patrol = true; n += 1; }
  }
  if (!n) return fail(new Error('今日没有待巡查的场次'));
  commit('patrol_all_today', { count: n });
  toast(`✅ 已补打 ${n} 场局后巡查`);
}

function delSession(id) {
  try {
    state.sessions = removeSession(state.sessions, id);
    commit('session_removed', { id });
    toast('场次已撤销（台账可审计）');
  } catch (err) { fail(err); }
}

function addIssueFromForm(e) {
  e.preventDefault();
  try {
    const dateISO = val('is-date') || todayISO();
    const r = openIssue(state.issues, state.issueSeq, { dateISO, desc: val('is-desc') });
    state.issues = r.issues;
    state.issueSeq = r.seq;
    commit('issue_opened', { dateISO });
    toast('✅ 隐患已登记，销案前体检灯会一直点你');
  } catch (err) { fail(err); }
}

function doCloseIssue(id) {
  const html = `<div class="modal-card"><h3>隐患销案</h3>
    <p class="fine">闭环必须留整改措施——「整改了」三个字本身就是迎检答案。</p>
    <div class="form-grid">
      <label>销案日<input id="ci-date" type="date" value="${todayISO()}"></label>
      <label class="span2">整改措施 *<input id="ci-fix" placeholder="如：更换应急灯具并复试通过"></label>
    </div>
    <div class="row"><button class="btn" id="ci-ok">销案</button><button class="btn ghost" id="ci-cancel">取消</button></div></div>`;
  $modalHost.innerHTML = html;
  document.getElementById('ci-cancel').onclick = () => { $modalHost.innerHTML = ''; };
  document.getElementById('ci-ok').onclick = () => {
    try {
      state.issues = closeIssue(state.issues, id, { closedISO: val('ci-date') || todayISO(), fix: val('ci-fix') });
      $modalHost.innerHTML = '';
      commit('issue_closed', { id });
      toast('✅ 隐患已闭环');
    } catch (err) { fail(err); }
  };
}

function addCheckFromForm(e) {
  e.preventDefault();
  try {
    const dateISO = val('ck-date') || todayISO();
    const findings = val('ck-find');
    const fixed = val('ck-fix');
    if (findings && !fixed) throw new Error('有发现问题必填整改情况');
    if (state.checks.some((c) => c.dateISO === dateISO)) throw new Error('该日期已有月检记录');
    state.checks.push({ id: uid(), dateISO, findings, fixed, note: '' });
    state.checkSeq += 1;
    commit('monthly_check_done', { dateISO });
    toast('✅ 月度全面防火检查已留痕');
  } catch (err) { fail(err); }
}

function addDrillFromForm(e) {
  e.preventDefault();
  try {
    const dateISO = val('dr-date') || todayISO();
    const phase = val('dr-phase') === 'night' ? 'night' : 'day';
    if (state.drills.some((d) => d.dateISO === dateISO && d.phase === phase)) throw new Error('同日同时段演练已登记');
    state.drills.push({ id: uid(), dateISO, phase, note: val('dr-note') });
    state.drillSeq += 1;
    commit('drill_done', { dateISO, phase });
    toast(`✅ ${phase === 'day' ? '白天' : '夜间'}演练已留痕`);
  } catch (err) { fail(err); }
}

function addTrainingFromForm(e) {
  e.preventDefault();
  try {
    const dateISO = val('tr-date') || todayISO();
    state.trainings.push({ id: uid(), dateISO, topic: val('tr-topic') || '消防安全培训', coverage: val('tr-cov'), note: '' });
    state.trainSeq += 1;
    commit('training_done', { dateISO });
    toast('✅ 培训已留痕，年钟归零');
  } catch (err) { fail(err); }
}

function addExtFromForm(e) {
  e.preventDefault();
  try {
    const nextCheckISO = val('ex-next');
    if (!nextCheckISO) throw new Error('下次检测日必填');
    state.extinguishers.push({ id: uid(), location: val('ex-loc'), count: num('ex-count') || 1, nextCheckISO });
    state.extSeq += 1;
    commit('ext_added', { nextCheckISO });
    toast('✅ 灭火器已入台账');
  } catch (err) { fail(err); }
}

function saveVenueFromForm(e) {
  e.preventDefault();
  try {
    const name = val('vn-name');
    if (!name) throw new Error('门店名必填');
    const openedISO = val('vn-open');
    const filedISO = val('vn-filed');
    if (filedISO && openedISO && filedISO < openedISO) throw new Error('备案日期不得早于营业日期');
    Object.assign(state.venue, {
      name, manager: val('vn-manager'), phone: val('vn-phone'), address: val('vn-address'),
      area: val('vn-area'), jubensha: checked('vn-js'), escape: checked('vn-esc'),
      openedISO, filedISO, filingNo: val('vn-filno'),
      scopeAdjusted: checked('vn-scope'), fireCheck: val('vn-fire'),
    });
    commit('venue_saved', {});
    toast('✅ 门店信息已保存');
  } catch (err) { fail(err); }
}

function saveLimitsFromForm(e) {
  e.preventDefault();
  const clamp = (id, lo, hi, def) => {
    const n = num(id);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  state.limits = {
    filingDays: clamp('lm-filing', 1, 365, 30),
    filingWarn: clamp('lm-fw', 1, 90, 7),
    drillDays: clamp('lm-drill', 30, 365, 183),
    trainingDays: clamp('lm-train', 30, 730, 365),
    extWarn: clamp('lm-ext', 1, 180, 30),
    monthCheckLate: clamp('lm-mc', 1, 28, 25),
    patrolGrace: 0,
  };
  commit('limits_saved', {});
  toast('✅ 口径参数已保存（属地规则永远赢）');
}

function saveCalendarFromForm(e) {
  e.preventDefault();
  try {
    const parseList = (id) => val(id).split(/[,，\s]+/).filter(Boolean).map((x) => x.trim());
    const hol = parseList('cl-holidays');
    const work = parseList('cl-workdays');
    const bad = [...hol, ...work].filter((x) => !/^\d{2}-\d{2}$/.test(x));
    if (bad.length) throw new Error(`假日表格式应为 MM-DD：${bad.join('、')}`);
    state.calendar = {
      year: state.calendar.year,
      holidays: hol, workdays: work,
      vacWinter: [val('cl-ws'), val('cl-we')],
      vacSummer: [val('cl-ss'), val('cl-se')],
    };
    commit('calendar_saved', { holidays: hol.length, workdays: work.length });
    toast('✅ 假日表已更新');
  } catch (err) { fail(err); }
}

// ---------------------------------------------------------------------------
// 示例数据（今天 2026-09-07 周一为工作日，演示红线与四钟）
// ---------------------------------------------------------------------------

function loadSample() {
  const fresh = emptyState();
  Object.assign(state, fresh);
  const T = todayISO();
  const d = (n) => addDays(T, n);
  state.venue = {
    name: '月境迷环·沉浸剧场', manager: '陈场长', phone: '138****6602',
    address: '示例市锦江区红星路 88 号 3F-301（商业综合体三层）', area: '210',
    jubensha: true, escape: true, openedISO: '2025-11-20',
    filedISO: '2025-12-08', filingNo: '备字2025-1147',
    scopeAdjusted: true, fireCheck: '消防安检查告承诺（编号 JQ-2025-2211）',
    setup: {
      legalBuilding: true, notResidential: true, floorOk: true, notSanheyi: true,
      noHazmat: true, schoolDist: true, fireAlarm: true, extinguishers: true,
      emLights: true, evacMap: true, exitsOk: true, cctv24h: true, comms: true,
      prebrief: true, separation: true, oneUnlock: true, evacClear: true, signage: true,
    },
  };
  state.scripts = [
    { id: 's1', name: '月境迷环', kind: 'city', author: '星尘工作室', ageRange: 'g12', restrictedScene: false, useStartISO: '2025-12-01', filedISO: '2025-12-20', filingNo: 'JB2025-88231', selfReviewedISO: '2025-11-28', changedAtISO: '', note: '' },
    { id: 's2', name: '长夜补给站', kind: 'boxed', author: '', ageRange: 'all', restrictedScene: false, useStartISO: '2026-03-14', filedISO: '2026-03-20', filingNo: 'JB2026-11042', selfReviewedISO: '2026-03-12', changedAtISO: '', note: '' },
    { id: 's3', name: '雾锁病栋', kind: 'escape', author: '灰盒文创', ageRange: 'g16', restrictedScene: true, useStartISO: d(-25), filedISO: '', filingNo: '', selfReviewedISO: d(-27), changedAtISO: '', note: '新密室主题，报备窗口中' },
    { id: 's4', name: '旧校舍怪谈（18+重恐）', kind: 'exclusive', author: '', ageRange: 'g18', restrictedScene: true, useStartISO: '2026-01-09', filedISO: '2026-02-01', filingNo: 'JB2026-3021', selfReviewedISO: '2026-01-06', changedAtISO: '', note: '未成年人永久禁入' },
  ];
  state.sessions = [
    { id: 'p1', dateISO: d(-1), start: '19:00', scriptId: 's1', players: 6, minors: 2, ageChecked: true, patrol: true, note: '' },
    { id: 'p2', dateISO: T, start: '14:00', scriptId: 's2', players: 5, minors: 0, ageChecked: false, patrol: false, note: '' },
    { id: 'p3', dateISO: T, start: '19:30', scriptId: 's3', players: 6, minors: 0, ageChecked: false, patrol: false, note: '' },
    { id: 'p4', dateISO: d(-3), start: '13:00', scriptId: 's4', players: 5, minors: 1, ageChecked: false, patrol: true, note: '' },
    { id: 'p5', dateISO: d(1), start: '10:30', scriptId: 's2', players: 8, minors: 8, ageChecked: false, patrol: false, note: '学生生日场预订' },
  ];
  state.checks = [{ id: 'c1', dateISO: d(-9), findings: '', fixed: '', note: '' }];
  state.drills = [{ id: 'd1', dateISO: d(-40), phase: 'day', note: '全员 7 人，疏散 2 分 10 秒' }, { id: 'd2', dateISO: d(-35), phase: 'night', note: '夜场散场后演练' }];
  state.trainings = [{ id: 't1', dateISO: '2026-04-11', topic: '灭火器+一键开锁+疏散', coverage: '7', note: '' }];
  state.extinguishers = [
    { id: 'e1', location: '吧台', count: 2, nextCheckISO: d(200) },
    { id: 'e2', location: '三号房门口', count: 2, nextCheckISO: d(21) },
    { id: 'e3', location: '疏散通道口', count: 2, nextCheckISO: d(-6) },
  ];
  state.issues = [
    { id: 'i1', dateISO: d(-12), desc: '二号房门吸失效，疏散门开启不畅', sev: 'warn', note: '', status: 'fixed', closedISO: d(-10), fix: '更换闭门器并复试' },
    { id: 'i2', dateISO: d(-2), desc: '监控 3 号点位离线', sev: 'warn', note: '24h 全覆盖要求', status: 'open', closedISO: '', fix: '' },
  ];
  state.scriptSeq = 5; state.sessionSeq = 6; state.checkSeq = 2; state.drillSeq = 3;
  state.trainSeq = 2; state.extSeq = 4; state.issueSeq = 3;
  state.settings.sampleLoaded = true;
  commit('sample_loaded', {});
  toast('✅ 示例数据已载入：注意今日红线灯与逾期灭火器');
}

// ---------------------------------------------------------------------------
// 出证与数据自持
// ---------------------------------------------------------------------------

function doExportJson() {
  download(`scenelog-backup-${todayISO()}.json`, exportBundle(state), 'application/json');
  commit('export_json', {});
}

function doImportJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = importBundle(String(reader.result));
      state = { ...emptyState(), ...s };
      commit('import_json', {});
      toast('✅ 备份已导入');
    } catch (err) { fail(err); }
  };
  reader.readAsText(file, 'utf-8');
}

function doExportEvents() {
  download(`scenelog-events-${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
}

function doWipe() {
  if (!confirm('确定清空本机全部台账数据？此操作不可撤销（建议先导出备份）。')) return;
  state = emptyState();
  commit('wipe', {});
  toast('已清空');
}

// ---------------------------------------------------------------------------
// 事件委托与启动
// ---------------------------------------------------------------------------

document.addEventListener('submit', (e) => {
  const form = e.target;
  const kind = form?.dataset?.form;
  if (!kind) return;
  switch (kind) {
    case 'add-script': return addScriptFromForm(e);
    case 'add-session': return addSessionFromForm(e);
    case 'add-issue': return addIssueFromForm(e);
    case 'add-check': return addCheckFromForm(e);
    case 'add-drill': return addDrillFromForm(e);
    case 'add-training': return addTrainingFromForm(e);
    case 'add-ext': return addExtFromForm(e);
    case 'save-venue': return saveVenueFromForm(e);
    case 'save-limits': return saveLimitsFromForm(e);
    case 'save-calendar': return saveCalendarFromForm(e);
    case 'pick-month':
      e.preventDefault();
      repMonth = val('rp-month') || null;
      repCache = monthlySummaryText(state, repMonth || monthKey(todayISO()), todayISO());
      return render();
    default: return undefined;
  }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;
  switch (act) {
    case 'load-sample': return loadSample();
    case 'file-script': return fileScript(id);
    case 'review-script': return reviewScript(id);
    case 'change-script': return changeScript(id);
    case 'del-script': return delScript(id);
    case 'patrol-session': return patrolSession(id);
    case 'patrol-all-today': return patrolAllToday();
    case 'del-session': return delSession(id);
    case 'close-issue': return doCloseIssue(id);
    case 'del-check':
      state.checks = state.checks.filter((x) => x.id !== id);
      return commit('check_removed', { id });
    case 'del-drill':
      state.drills = state.drills.filter((x) => x.id !== id);
      return commit('drill_removed', { id });
    case 'del-training':
      state.trainings = state.trainings.filter((x) => x.id !== id);
      return commit('training_removed', { id });
    case 'copy-summary':
      navigator.clipboard?.writeText(repCache ?? monthlySummaryText(state, repMonth || monthKey(todayISO()), todayISO()))
        .then(() => toast('✅ 小结已复制，去贴老板群'))
        .catch(() => toast('复制失败，请手动选择文本'));
      return;
    case 'dl-pack':
      download(`迎检自证包-${state.venue?.name || '门店'}-${todayISO()}.html`, inspectionPackHtml(state, todayISO()));
      return commit('pack_exported', {});
    case 'print-pack':
      openPrintWindow(inspectionPackHtml(state, todayISO()));
      return;
    case 'print-patrol':
      openPrintWindow(patrolCardHtml(state, todayISO()));
      return;
    case 'export-json': return doExportJson();
    case 'export-events': return doExportEvents();
    case 'wipe': return doWipe();
    default: return undefined;
  }
});

document.addEventListener('change', (e) => {
  // 场所自查勾选：即时保存（先校验后变更，id 不合法直接忽略）
  const el = e.target;
  if (el?.dataset?.setup) {
    if (!(el.dataset.setup in state.venue.setup) && !Object.keys(state.venue.setup).length) {
      state.venue.setup = {};
    }
    state.venue.setup = { ...state.venue.setup, [el.dataset.setup]: el.checked };
    return commit('setup_toggled', { item: el.dataset.setup, ok: el.checked });
  }
  if (el?.id === 'import-file' && el.files?.[0]) {
    return doImportJson(el.files[0]);
  }
  return undefined;
});

window.addEventListener('hashchange', render);
render();

// 注册 SW（失败静默——本地服务器不支持 SW 时应用照常工作）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
