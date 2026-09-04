/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, addDays, turnoversOf, applyLinenEvent, addLinenSets,
  taskExtras, coverageFor, transitOverdue,
  exportBundle, importBundle, runSheetText, runSheetHtml, assertLinenIntegrity,
} from './core.js';
import {
  viewBoard, viewStays, viewLinen, viewRunSheet, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let sheetDate = null; // 翻房单页用户选择的日期（跨渲染保留）

const NAV = [
  ['#/board', '今日'], ['#/stays', '房期'], ['#/linen', '布草'], ['#/runsheet', '翻房单'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'stays': html = viewStays(state); break;
    case 'linen': html = viewLinen(state); break;
    case 'runsheet': html = viewRunSheet(state, sheetDate ?? undefined); break;
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
  toast._t = setTimeout(() => { $toast.hidden = true; }, 2600);
}

function commit(trackType, payload) {
  if (trackType) track(state, trackType, payload);
  saveState(state);
  render();
}

function fail(err) {
  toast(`❌ ${err?.message ?? err}`);
}

// ---------------------------------------------------------------------------
// 翻房打卡动作
// ---------------------------------------------------------------------------

function markTask(turnKey, taskId) {
  state.turnoverLogs[turnKey] = state.turnoverLogs[turnKey] ?? { tasks: {}, found: '' };
  const log = state.turnoverLogs[turnKey];
  log.tasks[taskId] = !log.tasks[taskId];
  const doneCount = Object.values(log.tasks).filter(Boolean).length;
  log.doneAt = doneCount > 0 ? new Date().toISOString() : null;
  commit('check', { turnKey, taskId, done: log.tasks[taskId] });
}

function saveFound(turnKey) {
  const val = document.getElementById(`found-${CSS.escape(turnKey)}`)?.value?.trim() ?? '';
  state.turnoverLogs[turnKey] = state.turnoverLogs[turnKey] ?? { tasks: {}, found: '' };
  state.turnoverLogs[turnKey].found = val;
  commit('found-log', { has: val.length > 0 });
}

// ---------------------------------------------------------------------------
// 房期动作
// ---------------------------------------------------------------------------

function addStay() {
  const val = (id) => document.getElementById(id)?.value?.trim() ?? '';
  const stay = {
    id: `st-${uid().slice(0, 8)}`,
    propId: document.getElementById('stay-prop')?.value,
    platform: document.getElementById('stay-platform')?.value || 'other',
    guest: val('stay-guest'),
    phone: val('stay-phone'),
    checkin: val('stay-in'), checkinTime: val('stay-in-t') || '14:00',
    checkout: val('stay-out'), checkoutTime: val('stay-out-t') || '12:00',
  };
  if (!stay.propId) { toast('请先在「设置」添加房源'); return; }
  if (!stay.checkin || !stay.checkout) { toast('请填写入住与退房日期'); return; }
  if (stay.checkout < stay.checkin) { toast('退房日期不能早于入住日期'); return; }
  state.stays.push(stay);
  commit('add-stay', { propId: stay.propId });
}

// ---------------------------------------------------------------------------
// 布草动作
// ---------------------------------------------------------------------------

function checkedLinenIds() {
  return [...document.querySelectorAll('.ln-check:checked')].map((el) => el.value);
}

function linenOp(op) {
  const ids = checkedLinenIds();
  if (ids.length === 0) { toast('先勾选布草'); return; }
  const today = todayISO();
  try {
    applyLinenEvent(state.linenSets, {
      type: op,
      setIds: ids,
      propId: op === 'deploy' ? document.getElementById('linen-deploy-prop')?.value : undefined,
      dateISO: today,
    });
    assertLinenIntegrity(state.linenSets); // 入账后守恒自检
    state.linenEvents.push({ type: op, setIds: ids, dateISO: today });
    commit(`linen-${op}`, { count: ids.length });
    if (op === 'send') toast('已记送洗——记得按 SLA 回来看在途');
    else toast('布草账已更新');
  } catch (e) {
    fail(e);
  }
}

function linenBuy() {
  const type = document.getElementById('linen-buy-type')?.value;
  const count = Number(document.getElementById('linen-buy-count')?.value);
  const priceYuan = Number(document.getElementById('linen-buy-price')?.value);
  if (!Number.isInteger(count) || count < 1) { toast('数量应为正整数'); return; }
  if (!Number.isFinite(priceYuan) || priceYuan < 0) { toast('单价不合法'); return; }
  addLinenSets(state.linenSets, {
    type, count,
    priceCents: Math.round(priceYuan * 100),
    boughtISO: todayISO(),
    startNo: state.linenSets.filter((s) => s.type === type).length + 1,
  });
  state.linenEvents.push({ type: 'buy', setIds: [], dateISO: todayISO() });
  commit('linen-buy', { type, count });
}

// ---------------------------------------------------------------------------
// 翻房单导出
// ---------------------------------------------------------------------------

function currentSheet() {
  const date = sheetDate ?? todayISO();
  const turnovers = turnoversOf(state.stays, state.properties)
    .filter((t) => t.checkoutISO === date)
    .sort((a, b) => a.checkoutTime.localeCompare(b.checkoutTime));
  const propsById = new Map(state.properties.map((p) => [p.id, p]));
  // 动态提示行（与视图同一来源）：布草缺口 + 在途超时
  const extrasByProp = {};
  const today = todayISO();
  const overdueCount = transitOverdue(state.linenSets, today, state.settings?.washSlaDays ?? 3)
    .reduce((s, g) => s + g.sets.length, 0);
  for (const t of turnovers) {
    extrasByProp[t.propId] = taskExtras({
      prop: propsById.get(t.propId),
      linenByType: coverageFor(propsById.get(t.propId) ?? {}, state.linenSets),
      transitOverdue: overdueCount,
    });
  }
  return { date, turnovers, extrasByProp };
}

function sheetAction(action) {
  const { date, turnovers, extrasByProp } = currentSheet();
  if (turnovers.length === 0) { toast('这一天没有退房，无需翻房单'); return; }
  const common = {
    turnovers, dateISO: date, extrasByProp,
    hostName: state.host?.name ?? '', todayISOStr: todayISO(),
  };
  track(state, 'runsheet', { action, rooms: turnovers.length });
  if (action === 'copy') {
    copyText(runSheetText(common));
  } else {
    const html = runSheetHtml(common);
    if (action === 'download') {
      downloadFile(`翻房任务单_${date}.html`, html, 'text/html');
      toast('已下载，可打印或微信发送');
    } else {
      printHtml(html);
    }
    saveState(state);
  }
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
    toast('已复制——去微信粘贴给保洁');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴给保洁');
  }
}

// ---------------------------------------------------------------------------
// 设置动作
// ---------------------------------------------------------------------------

function saveHost() {
  const val = (id) => document.getElementById(id)?.value?.trim() ?? '';
  state.host = { name: val('set-name'), phone: val('set-phone') };
  commit('save-host');
  toast('已保存');
}

function addProperty() {
  const val = (id) => document.getElementById(id)?.value?.trim() ?? '';
  const num = (id, def, min, max) => {
    const n = Number(document.getElementById(id)?.value);
    return Number.isInteger(n) && n >= min && n <= max ? n : def;
  };
  const name = val('prop-name');
  if (!name) { toast('请填写房源名称'); return; }
  state.properties.push({
    id: `pr-${uid().slice(0, 8)}`,
    name,
    beds: num('prop-beds', 1, 1, 9),
    towels: num('prop-towels', 2, 1, 9),
    cleanMinutes: num('prop-clean', 90, 20, 480),
    lockNote: val('prop-lock'),
  });
  commit('add-prop', {});
  toast('房源已添加');
}

function addSupply() {
  const val = (id) => document.getElementById(id)?.value?.trim() ?? '';
  const name = val('sup-name');
  if (!name) { toast('请填写品名'); return; }
  const stock = Number(document.getElementById('sup-stock')?.value ?? 0);
  const minStock = Number(document.getElementById('sup-min')?.value ?? 0);
  state.supplies.push({
    id: `sp-${uid().slice(0, 8)}`,
    name,
    stock: Number.isInteger(stock) && stock >= 0 ? stock : 0,
    minStock: Number.isInteger(minStock) && minStock >= 0 ? minStock : 0,
  });
  commit('add-supply', {});
}

function saveSupplyStock(idx) {
  const el = document.getElementById(`sup-stock-${idx}`);
  const n = Number(el?.value);
  if (Number.isInteger(n) && n >= 0) {
    state.supplies[idx].stock = n;
    commit('sup-stock', { idx });
  }
}

function saveSettings() {
  const sla = Number(document.getElementById('set-sla')?.value);
  const rwBed = Number(document.getElementById('set-rw-bed')?.value);
  const rwTowel = Number(document.getElementById('set-rw-towel')?.value);
  state.settings = {
    washSlaDays: Number.isInteger(sla) && sla >= 1 && sla <= 14 ? sla : 3,
    ratedWashes: {
      bed: Number.isInteger(rwBed) && rwBed >= 10 ? rwBed : 130,
      towel: Number.isInteger(rwTowel) && rwTowel >= 10 ? rwTowel : 150,
    },
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`翻房单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`翻房单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      sheetDate = null;
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
  state.host = { name: '小林', phone: '13800005678' };
  const propA = `pr-${uid().slice(0, 8)}`;
  const propB = `pr-${uid().slice(0, 8)}`;
  state.properties = [
    { id: propA, name: '山语小院·A栋', beds: 2, towels: 2, cleanMinutes: 90, lockNote: '大门密码 5026#' },
    { id: propB, name: '山语小院·B栋', beds: 1, towels: 2, cleanMinutes: 60, lockNote: '钥匙盒 8360，取完打乱' },
  ];
  const mkStay = (propId, guest, platform, ci, cit, co, cot) => ({
    id: `st-${uid().slice(0, 8)}`, propId, guest, platform,
    checkin: ci, checkinTime: cit, checkout: co, checkoutTime: cot, phone: '', note: '',
  });
  state.stays = [
    // A 栋：今日退房 → 明日入住，窗口 26h（充裕）
    mkStay(propA, '王先生', 'meituan', addDays(today, -2), '14:00', today, '12:00'),
    mkStay(propA, '刘女士', 'airbnb', addDays(today, 1), '16:00', addDays(today, 3), '12:00'),
    // B 栋：今日退房 → 今日入住，窗口 3 小时（贴线偏紧）
    mkStay(propB, '陈同学', 'direct', addDays(today, -1), '14:00', today, '12:00'),
    mkStay(propB, '赵一家', 'ctrip', today, '15:00', addDays(today, 2), '12:00'),
  ];
  // 布草：床品 4 套（1 在 A、1 净、1 在途 4 天超 SLA、1 脏）、巾类 5 条（2 在 B、2 净、1 脏）
  const beds = addLinenSets(state.linenSets, { type: 'bed', count: 4, priceCents: 12900, boughtISO: addDays(today, -300) });
  const towels = addLinenSets(state.linenSets, { type: 'towel', count: 5, priceCents: 3600, boughtISO: addDays(today, -300) });
  beds[0].status = 'room'; beds[0].inProp = propA;
  beds[2].status = 'transit'; beds[2].sentAt = addDays(today, -4);
  beds[3].status = 'dirty';
  towels[0].status = 'room'; towels[0].inProp = propB;
  towels[1].status = 'room'; towels[1].inProp = propB;
  towels[2].status = 'dirty';
  // 洗涤事件流：前两个月回洗 6 套次（喂给报废预算），本月送洗 1 套
  for (let i = 0; i < 6; i += 1) {
    state.linenEvents.push({ type: 'recv', setIds: [beds[i % 2].id], dateISO: addDays(today, -60 + i * 9) });
  }
  state.linenEvents.push({ type: 'send', setIds: [beds[2].id], dateISO: addDays(today, -4) });
  // 耗品：卷纸低于安全线
  state.supplies = [
    { id: `sp-${uid().slice(0, 8)}`, name: '卷纸', stock: 2, minStock: 4 },
    { id: `sp-${uid().slice(0, 8)}`, name: '瓶装水', stock: 12, minStock: 6 },
    { id: `sp-${uid().slice(0, 8)}`, name: '洗漱包', stock: 8, minStock: 4 },
  ];
  // B 栋今天的翻房：已勾两项、记录了一条遗留物品
  const turnover = turnoversOf(state.stays, state.properties).find((t) => t.propId === propB && t.checkoutISO === today);
  if (turnover) {
    state.turnoverLogs[turnover.key] = {
      tasks: { found: true, strip: true },
      found: '蓝色充电头一个，已微信联系陈同学，今晚顺丰到付寄回',
    };
  }
  sheetDate = null;
  assertLinenIntegrity(state.linenSets);
  commit('seed-demo');
}

// ---------------------------------------------------------------------------
// 事件委托与启动
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, turn, task, op, idx } = el.dataset;
  switch (action) {
    case 'mark-task': markTask(turn, task); break;
    case 'save-found': saveFound(turn); break;
    case 'add-stay': addStay(); break;
    case 'del-stay': state.stays.splice(Number(idx), 1); commit('del-stay'); break;
    case 'linen-op': linenOp(op); break;
    case 'linen-buy': linenBuy(); break;
    case 'sheet-apply': {
      const d = document.getElementById('sheet-date')?.value;
      if (d) sheetDate = d;
      render();
      break;
    }
    case 'sheet-copy': sheetAction('copy'); break;
    case 'sheet-download': sheetAction('download'); break;
    case 'sheet-print': sheetAction('print'); break;
    case 'save-host': saveHost(); break;
    case 'add-prop': addProperty(); break;
    case 'del-prop': state.properties.splice(Number(idx), 1); commit('del-prop'); break;
    case 'add-supply': addSupply(); break;
    case 'del-supply': state.supplies.splice(Number(idx), 1); commit('del-supply'); break;
    case 'save-settings': saveSettings(); break;
    case 'export-json': dataAction('export-json'); break;
    case 'export-events': dataAction('export-events'); break;
    case 'seed-demo': seedDemo(); break;
    default: break;
  }
});

document.addEventListener('change', (ev) => {
  if (ev.target?.id === 'import-file') dataAction('import-json', ev.target.files?.[0]);
  if (ev.target?.id?.startsWith('sup-stock-')) saveSupplyStock(Number(ev.target.dataset.idx));
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target?.id === 'sheet-date') {
    const d = ev.target.value;
    if (d) { sheetDate = d; render(); }
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 离线增强失败不影响功能 */ });
}

window.addEventListener('hashchange', render);

render();
