/**
 * app.js — 路由、状态变更、事件委托、弹窗、示例数据与启动
 */
import {
  loadState, saveState, track, emptyState,
} from './store.js';
import {
  todayISO, monthKey,
  addExtinguisher, removeExtinguisher, serviceExtinguisher, addExtCheck,
  addPatrol, removePatrol, addMonthlyCheck,
  addHazard, closeHazard,
  addTraining, monthlySummary, inspectHtml, hazardSheetHtml,
  exportBundle, importBundle, DEFAULT_GAP_DAYS, DEFAULT_CHECK_DAYS,
} from './core.js';
import {
  viewBoard, viewPlace, viewLedger, viewReports, viewSettings, ICONS,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const $modalHost = document.getElementById('modal-host');

let state = loadState();
let repMonth = null;   // 月度小结用户选择的月份（跨渲染保留）
let repCache = null;   // 最近一次小结文本

const NAV = [
  ['#/board', '今日', 'board'], ['#/place', '场所', 'store'], ['#/ledger', '台账', 'ledger'], ['#/reports', '报表', 'reports'], ['#/settings', '设置', 'settings'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'place': html = viewPlace(state); break;
    case 'ledger': html = viewLedger(state); break;
    case 'reports': html = viewReports(state, repMonth, repCache); break;
    case 'settings': html = viewSettings(state); break;
    default: html = viewBoard(state);
  }
  $view.innerHTML = html;
  // 导航栏只在首次构建，之后只切 active 类（整页重渲染型应用的点击稳定性，见 docs/12）
  if (!$nav.children.length) {
    $nav.innerHTML = NAV.map(([hash, label, ic]) =>
      `<a href="${hash}">${ICONS[ic] ?? ''}<span>${label}</span></a>`).join('');
  }
  [...$nav.querySelectorAll('a')].forEach((a, i) => a.classList.toggle('active', NAV[i][0] === `#/${path}`));
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

function bool(id) {
  return document.getElementById(id)?.checked !== false;
}

// ---------------------------------------------------------------------------
// 弹窗（月检 / 送修 / 销案）
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
// 场所 / 营业前检查 / 培训演练
// ---------------------------------------------------------------------------

function savePlace() {
  const name = val('pl-name');
  if (!name) { toast('请填写场所名称'); return; }
  const openedISO = val('pl-opened');
  if (openedISO && !/^\d{4}-\d{2}-\d{2}$/.test(openedISO)) { toast('开业日期不合法'); return; }
  state.place = {
    ...state.place,
    name,
    type: document.getElementById('pl-type')?.value || 'other',
    manager: val('pl-manager'),
    phone: val('pl-phone'),
    address: val('pl-address'),
    area: val('pl-area'),
    floors: val('pl-floors'),
    openedISO,
    publicPlace: document.getElementById('pl-public')?.value === 'yes',
    hasSystems: document.getElementById('pl-systems')?.value === 'yes',
    mixedWithHome: document.getElementById('pl-mixed')?.value === 'yes',
    homeSeparated: document.getElementById('pl-separated')?.value === 'yes',
  };
  commit('save-place', { type: state.place.type });
  toast('场所信息已保存——巡查频次与检查周期已按类型重算');
}

function savePrecheck() {
  const status = document.getElementById('pk-status')?.value || 'unset';
  state.place = {
    ...state.place,
    publicPlace: state.place.publicPlace || status !== 'unset', // 办过营业前检查的必是公众聚集场所
    precheck: {
      status,
      appliedISO: val('pk-applied'),
      licenseNo: val('pk-license'),
      licensedISO: val('pk-licensed'),
    },
  };
  commit('save-precheck', { status });
  toast('营业前检查信息已保存');
}

function addTrainingAction() {
  const count = Number(document.getElementById('tr-count')?.value ?? 0);
  try {
    addTraining(state, {
      dateISO: val('tr-date') || todayISO(),
      kind: document.getElementById('tr-kind')?.value || 'training',
      count: Number.isFinite(count) ? Math.round(count) : 0,
      note: val('tr-note'),
    });
    commit('add-training', { kind: document.getElementById('tr-kind')?.value });
    toast('已登记，周期自动滚动');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 灭火器 / 巡查 / 防火检查 / 隐患
// ---------------------------------------------------------------------------

function addExtAction() {
  try {
    const rec = addExtinguisher(state, {
      no: val('ex-no'),
      type: document.getElementById('ex-type')?.value || 'powder',
      madeISO: val('ex-made'),
      location: val('ex-location'),
    });
    commit('add-ext', {});
    toast(`已登记（${rec.id}）——报废钟与送修钟已按出厂日上弦`);
  } catch (e) { fail(e); }
}

function delExt(id) {
  try {
    removeExtinguisher(state, id);
    commit('del-ext');
    toast('已删除该灭火器及其检查记录');
  } catch (e) { fail(e); }
}

function showExtCheck(id) {
  const ext = (state.extinguishers ?? []).find((x) => x.id === id);
  if (!ext) return;
  openModal(`灭火器月检 · ${ext.no || ext.id}`, `
    <p class="fine" style="margin-top:0">出厂 ${ext.madeISO} · 四项全√才算检过；有异常必须写明并转隐患登记。</p>
    <div class="checkline" style="margin:8px 0">
      <label class="chk"><input type="checkbox" id="m-pressure" checked /> 压力表指针在绿区</label>
      <label class="chk"><input type="checkbox" id="m-seal" checked /> 铅封、插销完好</label>
      <label class="chk"><input type="checkbox" id="m-body" checked /> 外观无锈蚀、损伤</label>
      <label class="chk"><input type="checkbox" id="m-location" checked /> 在位、无遮挡</label>
    </div>
    <label class="span2">异常情况与处置<input id="m-note" placeholder="有异常必填，如：压力表指针在红区，已报换新" /></label>`);
  openModal._confirm = () => {
    try {
      addExtCheck(state, {
        extId: id,
        dateISO: todayISO(),
        pressure: bool('m-pressure'),
        seal: bool('m-seal'),
        body: bool('m-body'),
        location: bool('m-location'),
        note: modalVal('m-note'),
      });
      closeModal();
      commit('ext-check', { extId: id });
      toast('月检已落账——周期自动滚动');
    } catch (e) { fail(e); }
  };
}

function showService(id) {
  const ext = (state.extinguishers ?? []).find((x) => x.id === id);
  if (!ext) return;
  openModal(`送修登记 · ${ext.no || ext.id}`, `
    <p class="fine" style="margin-top:0">送修交灭火器生产企业或专业维修单位（GB 50444 口径）；登记后复修周期从今天重算。</p>
    <div class="form-grid">
      <label>送修日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>送修去向/回装备注<input id="m-note" placeholder="如：交 XX 消防器材维修部（可空）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      serviceExtinguisher(state, id, { dateISO: modalVal('m-date') || todayISO(), note: modalVal('m-note') });
      closeModal();
      commit('ext-service', { extId: id });
      toast('送修已登记，复修周期已重算');
    } catch (e) { fail(e); }
  };
}

function addPatrolAction() {
  try {
    addPatrol(state, {
      dateISO: val('pt-date') || todayISO(),
      slot: document.getElementById('pt-slot')?.value || 'open',
      items: {
        fire: bool('pt-fire'),
        exit: bool('pt-exit'),
        equip: bool('pt-equip'),
        post: bool('pt-post'),
      },
      note: val('pt-note'),
    });
    commit('patrol', { dateISO: val('pt-date') || todayISO() });
    toast('巡查已落账——做过的动作从此有痕迹');
  } catch (e) { fail(e); }
}

function delPatrol(id) {
  try {
    removePatrol(state, id);
    commit('del-patrol');
    toast('已删除该笔巡查');
  } catch (e) { fail(e); }
}

function addMonthCheckAction() {
  const keys = ['exit', 'ext', 'elec', 'gas', 'tri', 'door', 'charge', 'evac'];
  const items = {};
  keys.forEach((k) => { items[k] = bool(`mc-${k}`); });
  try {
    addMonthlyCheck(state, {
      dateISO: val('mc-date') || todayISO(),
      items,
      note: val('mc-note'),
    });
    commit('month-check', { dateISO: val('mc-date') || todayISO() });
    toast('防火检查已落账');
  } catch (e) { fail(e); }
}

function addHazardAction() {
  try {
    addHazard(state, {
      dateISO: val('hz-date') || todayISO(),
      source: document.getElementById('hz-source')?.value || 'self',
      docNo: val('hz-docno'),
      location: val('hz-location'),
      desc: val('hz-desc'),
      dueISO: val('hz-due') || null,
      owner: val('hz-owner'),
    });
    commit('add-hazard', {});
    toast('隐患已登记——整改后复查销案，闭环才算走完');
  } catch (e) { fail(e); }
}

function showCloseHazard(id) {
  const rec = (state.hazards ?? []).find((x) => x.id === id);
  if (!rec) return;
  openModal(`复查销案 · ${rec.desc.slice(0, 24)}`, `
    <p class="fine" style="margin-top:0">${rec.location || '—'} · 整改责任人：${rec.owner || '未填'} · 期限：${rec.dueISO || '未填'}</p>
    <div class="form-grid">
      <label>复查日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">复查结论<input id="m-verify" placeholder="如：杂物已清空，出口恢复畅通" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeHazard(state, id, { closedISO: modalVal('m-date') || todayISO(), verifyNote: modalVal('m-verify') });
      closeModal();
      commit('close-hazard', {});
      toast('已复查销案——这条隐患有头有尾了');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 隐患整改单）
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
    downloadFile(`场所消防迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function printHazardById(id) {
  try {
    const html = hazardSheetHtml(state, id, todayISO());
    track(state, 'hazard-sheet', { id });
    downloadFile(`火灾隐患整改单_${todayISO()}.html`, html, 'text/html');
    toast('整改单已下载——发给责任人/物业/出租方');
    saveState(state);
  } catch (e) { fail(e); }
}

function printHazardSheet() {
  const id = document.getElementById('hazard-sheet')?.value;
  if (!id) { toast('请先在台账登记隐患'); return; }
  printHazardById(id);
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
    toast('已复制——去微信粘贴存档或发给物业');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴存档或发给物业');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function saveSettings() {
  const gap = Number(document.getElementById('set-gap')?.value);
  const check = Number(document.getElementById('set-check')?.value);
  const ext = Number(document.getElementById('set-extcheck')?.value);
  state.settings = {
    gapDays: Number.isInteger(gap) && gap >= 1 && gap <= 15 ? gap : DEFAULT_GAP_DAYS,
    checkDays: Number.isInteger(check) && check >= 15 && check <= 90 ? check : DEFAULT_CHECK_DAYS,
    extCheckDays: Number.isInteger(ext) && ext >= 0 && ext <= 60 ? ext : 0,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`防火单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`防火单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
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
  const ago = (days) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };

  state.place = {
    name: '城南路老王家常菜（示例）', type: 'catering', manager: '王建国', phone: '13800001234',
    address: 'XX 市城南路 128 号', area: '110', floors: '地上 2 层',
    openedISO: ago(1180), publicPlace: true, mixedWithHome: false, homeSeparated: false, hasSystems: false,
    precheck: { status: 'licensed', appliedISO: ago(1185), licenseNo: 'X消检许字〔2023〕第 0121 号', licensedISO: ago(1160) },
  };

  state.extinguishers = [];
  state.extSeq = 0;
  state.extChecks = [];
  state.extCheckSeq = 0;
  state.patrols = [];
  state.patrolSeq = 0;
  state.monthChecks = [];
  state.monthCheckSeq = 0;
  state.hazards = [];
  state.hazardSeq = 0;
  state.trainings = [];
  state.trainingSeq = 0;

  // 灭火器 4 具：1 具报废超期（水基 6 年）、1 具送修超期（干粉 5+2）、2 具在期
  state.extinguishers.push({ id: 'ex-1', no: '1号·收银台', type: 'water', madeISO: ago(2530), location: '收银台侧', lastServiceISO: ago(400), note: '' });
  state.extinguishers.push({ id: 'ex-2', no: '2号·后厨', type: 'powder', madeISO: ago(2740), location: '后厨门口', lastServiceISO: null, note: '' });
  state.extinguishers.push({ id: 'ex-3', no: '3号·大堂', type: 'powder', madeISO: ago(1500), location: '大堂立柱', lastServiceISO: null, note: '' });
  state.extinguishers.push({ id: 'ex-4', no: '4号·储物间', type: 'co2', madeISO: ago(800), location: '储物间', lastServiceISO: null, note: '' });

  // 月检：3 天前查了 2/3/4 号（全绿）；1 号 40 天前查过（超期，且已报废）
  const E = (extId, daysAgo) => {
    state.extCheckSeq += 1;
    state.extChecks.push({ id: `ec-${state.extCheckSeq}`, extId, dateISO: ago(daysAgo), pressure: true, seal: true, body: true, location: true, note: '' });
  };
  E('ex-2', 3); E('ex-3', 3); E('ex-4', 3); E('ex-1', 40);

  // 巡查：营业前+打烊后近 4 天在巡（最近 4 天前——断更红灯），其中一笔异常留痕
  const P = (daysAgo, slot, items, note = '') => {
    state.patrolSeq += 1;
    const norm = { fire: items.fire !== false, exit: items.exit !== false, equip: items.equip !== false, post: items.post !== false };
    state.patrols.push({ id: `pt-${state.patrolSeq}`, dateISO: ago(daysAgo), slot, items: norm, abnormal: Object.values(norm).some((v) => !v), note });
  };
  P(4, 'open', {});
  P(4, 'close', {}, '打烊断电，查无遗留火种');
  P(5, 'open', {});
  P(5, 'close', { exit: false }, '后门安全出口被货箱挡了一半，已当场搬空——次日进货改走前门');
  P(6, 'open', {});
  P(6, 'close', {});
  P(7, 'open', {});
  P(7, 'close', {});

  // 防火检查：40 天前一次（30 天周期 → 超期红灯），全绿
  state.monthCheckSeq += 1;
  state.monthChecks.push({
    id: `mc-${state.monthCheckSeq}`, dateISO: ago(40), abnormal: false,
    items: { exit: true, ext: true, elec: true, gas: true, tri: true, door: true, charge: true, evac: true }, note: '',
  });

  // 隐患：通知类 1 条已销案（带文书号——销案就是自证）；自查类 1 条超期未销（红灯）
  state.hazards.push({
    id: 'hz-1', dateISO: ago(75), source: 'notice119', docNo: 'X消检字〔2026〕第 0035 号', location: '一楼后门安全出口',
    desc: '安全出口堆放杂物', dueISO: ago(68), owner: '王建国', note: '当天清空并教育员工出口 1 米内不放任何物品',
    closedISO: ago(72), verifyNote: '复查合格，出口恢复畅通',
  });
  state.hazards.push({
    id: 'hz-2', dateISO: ago(9), source: 'self', docNo: '', location: '二楼过道',
    desc: '应急照明灯不亮', dueISO: ago(2), owner: '王建国', note: '已下单换新，等师傅上门', closedISO: null, verifyNote: '',
  });

  // 培训演练：全员培训 200 天前（人员密集口径 180 天 → 逾期）、演练 400 天前（年检口径 360 天 → 逾期）
  state.trainings.push({ id: 'tr-1', dateISO: ago(200), kind: 'training', count: 5, note: '灭火器使用 + 疏散路线' });
  state.trainings.push({ id: 'tr-2', dateISO: ago(400), kind: 'drill', count: 5, note: '后厨起火疏散演练' });

  repCache = null;
  repMonth = null;
  commit('seed-demo');
}

// ---------------------------------------------------------------------------
// 事件委托与启动
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, idx } = el.dataset;
  switch (action) {
    case 'save-place': savePlace(); break;
    case 'save-precheck': savePrecheck(); break;
    case 'add-training': addTrainingAction(); break;
    case 'add-ext': addExtAction(); break;
    case 'del-ext': delExt(idx); break;
    case 'show-extcheck': showExtCheck(idx); break;
    case 'show-service': showService(idx); break;
    case 'add-patrol': addPatrolAction(); break;
    case 'del-patrol': delPatrol(idx); break;
    case 'add-monthcheck': addMonthCheckAction(); break;
    case 'add-hazard': addHazardAction(); break;
    case 'show-close-hazard': showCloseHazard(idx); break;
    case 'print-hazard': printHazardById(idx); break;
    case 'print-hazard-sheet': printHazardSheet(); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
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
