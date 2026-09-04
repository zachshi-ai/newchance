/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState, newDisclosure,
} from './store.js';
import {
  todayISO, monthKey, addDays, sellCar, undoSell, addCost, removeCost, sellWarnings,
  disclosureText, disclosureHtml, fmtYuan,
  exportBundle, importBundle, CAR_SOURCES, DISCLOSURE_FIELDS,
} from './core.js';
import {
  viewBoard, viewCars, viewSheet, viewLedger, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let sheetCar = null; // 披露单页用户选择的车辆（跨渲染保留）
let ledMonth = null; // 账本页用户选择的月份

const NAV = [
  ['#/board', '今日'], ['#/cars', '车辆'], ['#/sheet', '披露单'], ['#/ledger', '账本'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'cars': html = viewCars(state); break;
    case 'sheet': html = viewSheet(state, sheetCar); break;
    case 'ledger': html = viewLedger(state, ledMonth); break;
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

// ---------------------------------------------------------------------------
// 车行动作
// ---------------------------------------------------------------------------

function saveDealer() {
  state.dealer = { name: val('dl-name'), phone: val('dl-phone') };
  commit('save-dealer');
  toast('已保存');
}

// ---------------------------------------------------------------------------
// 收车建档（建档即体检：九项披露默认「未核查」）
// ---------------------------------------------------------------------------

function addCar() {
  const brand = val('car-brand');
  if (!brand) { toast('请填写品牌车型'); return; }
  const year = Number(val('car-year'));
  if (!Number.isInteger(year) || year < 1980 || year > new Date().getFullYear() + 1) {
    toast('初登年份不合法'); return;
  }
  const kmRaw = val('car-km');
  const displayKm = kmRaw === '' ? null : Number(kmRaw);
  if (displayKm !== null && (!Number.isInteger(displayKm) || displayKm < 0)) {
    toast('表显里程应为非负整数'); return;
  }
  const priceYuan = Number(val('car-price'));
  if (!Number.isFinite(priceYuan) || priceYuan < 0) { toast('收车价不合法'); return; }
  const buyISO = val('car-date') || todayISO();
  const car = {
    id: `v-${uid().slice(0, 8)}`,
    brand,
    plate: val('car-plate'),
    vinTail: val('car-vin'),
    regYear: year,
    displayKm,
    source: document.getElementById('car-source')?.value || 'other',
    buyCents: Math.round(priceYuan * 100),
    buyISO,
    note: val('car-note'),
    status: 'stock',
    disclosure: newDisclosure(),
    createdAt: new Date().toISOString(),
  };
  state.cars.push(car);
  commit('add-car', { source: car.source });
  toast('车档已建——四问体检（抵押/事故/维修/里程）查完一项销一项');
}

function delCar(carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  if (car.status === 'sold') { toast('已售车档是历史账的一部分，不可删除'); return; }
  if (state.costs.some((e) => e.carId === carId)) { toast('该车有整备记录，先逐笔删除（账实一致）'); return; }
  state.cars = state.cars.filter((c) => c.id !== carId);
  commit('del-car');
}

// ---------------------------------------------------------------------------
// 披露登记（把「我不知道」变成三态里的一个明确答案）
// ---------------------------------------------------------------------------

function saveDisclosure(carId) {
  const car = state.cars.find((c) => c.id === carId);
  if (!car) return;
  for (const k of Object.keys(DISCLOSURE_FIELDS)) {
    const status = document.getElementById(`ds-${carId}-${k}`)?.value;
    const note = document.getElementById(`dn-${carId}-${k}`)?.value?.trim() ?? '';
    if (status && ['ok', 'issue', 'unknown'].includes(status)) {
      car.disclosure[k] = { status, note };
    }
  }
  commit('save-disclosure', { unknown: Object.values(car.disclosure).filter((x) => x.status === 'unknown').length });
  const left = Object.values(car.disclosure).filter((x) => x.status === 'unknown').length;
  toast(left === 0 ? '九项已核完——这台车可以放心卖了' : `已保存，还剩 ${left} 项「未核查」`);
}

// ---------------------------------------------------------------------------
// 整备与售出
// ---------------------------------------------------------------------------

function costAction(action, carId, costId) {
  try {
    if (action === 'add') {
      const amountYuan = Number(val(`cf-amount-${carId}`));
      if (!Number.isFinite(amountYuan) || amountYuan < 0) { toast('金额不合法'); return; }
      addCost(state, {
        id: `e-${uid().slice(0, 8)}`,
        carId,
        dateISO: val(`cf-date-${carId}`) || todayISO(),
        kind: document.getElementById(`cf-kind-${carId}`)?.value || 'other',
        note: val(`cf-note-${carId}`),
        cents: Math.round(amountYuan * 100),
      });
      commit('add-cost', {});
      toast('整备已落账——它同时进了毛利与披露单');
    } else if (action === 'del') {
      removeCost(state, costId);
      commit('del-cost');
    }
  } catch (e) {
    fail(e);
  }
}

function doSell(carId) {
  const priceYuan = Number(val(`sf-price-${carId}`));
  if (!Number.isFinite(priceYuan) || priceYuan < 0) { toast('成交价不合法'); return; }
  try {
    const { car, warnings, settlement } = sellCar(state, {
      carId,
      sellCents: Math.round(priceYuan * 100),
      soldISO: val(`sf-date-${carId}`) || todayISO(),
      buyer: val(`sf-buyer-${carId}`),
    });
    track(state, 'sell', { unknown: warnings.length, profitCents: settlement.profitCents, days: settlement.daysInStock });
    commit('sell');
    toast(`已落账：毛利 ${fmtYuan(settlement.profitCents)} · 在库 ${settlement.daysInStock} 天${warnings.length ? `　⚠ ${warnings[0]}` : '　别忘把披露单发买家并留签字版'}`);
  } catch (e) {
    fail(e);
  }
}

function doUndoSell(carId) {
  try {
    undoSell(state, carId);
    commit('undo-sell');
    toast('已撤销售出，恢复在库计时');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 披露单三通道
// ---------------------------------------------------------------------------

function currentCar() {
  sheetCar = document.getElementById('sheet-car')?.value ?? sheetCar ?? state.cars[0]?.id;
  return sheetCar;
}

function sheetAction(action) {
  const carId = currentCar();
  if (!carId) { toast('请先在「车辆」页建档'); return; }
  const car = state.cars.find((c) => c.id === carId);
  const common = { car, costs: state.costs, dealer: state.dealer, todayISOStr: todayISO() };
  track(state, 'sheet', { action, carId });
  if (action === 'copy') {
    copyText(disclosureText(common));
    saveState(state);
  } else {
    const html = disclosureHtml(common);
    if (action === 'download') {
      downloadFile(`车况披露单_${car.brand}${car.plate ? `_${car.plate}` : ''}_${todayISO()}.html`, html, 'text/html');
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
    toast('已复制——去微信粘贴给买家');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴给买家');
  }
}

// ---------------------------------------------------------------------------
// 设置动作
// ---------------------------------------------------------------------------

function saveSettings() {
  const warn = Number(document.getElementById('set-warn')?.value);
  const issue = Number(document.getElementById('set-issue')?.value);
  state.settings = {
    warnDays: Number.isInteger(warn) && warn >= 7 && warn <= 365 ? warn : 45,
    issueDays: Number.isInteger(issue) && issue >= 14 && issue <= 730 ? issue : 75,
  };
  if (state.settings.warnDays >= state.settings.issueDays) {
    state.settings.issueDays = state.settings.warnDays + 30;
    toast('红线必须晚于黄线，已自动调整为黄线 +30 天');
  }
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`车况单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`车况单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      sheetCar = null;
      ledMonth = null;
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
  state.dealer = { name: '老周车务', phone: '13800001234' };
  const car = (over = {}) => ({
    id: `v-${uid().slice(0, 8)}`,
    plate: '', vinTail: '', brand: '', regYear: 2020, displayKm: null,
    source: 'person', buyCents: 0, buyISO: today, note: '',
    status: 'stock', disclosure: newDisclosure(), createdAt: new Date().toISOString(),
    ...over,
  });

  const camry = car({
    brand: '丰田凯美瑞 2019款', plate: '粤A·12345', vinTail: 'AB12CD', regYear: 2019,
    displayKm: 62000, source: 'trade', buyCents: 7800000, buyISO: addDays(today, -100),
    status: 'sold', soldISO: addDays(today, -20), sellCents: 8680000, buyer: '王先生',
    disclosure: {
      ...newDisclosure(),
      accident: { status: 'ok', note: '' },
      flood: { status: 'ok', note: '' },
      fire: { status: 'ok', note: '' },
      mortgage: { status: 'ok', note: '已解除' },
      operation: { status: 'ok', note: '非营运' },
      mileage: { status: 'ok', note: '与 4S 维保一致' },
    },
  });
  const accord = car({
    brand: '本田雅阁 2021款', plate: '粤B·88990', regYear: 2021, displayKm: 41000,
    source: 'person', buyCents: 6580000, buyISO: addDays(today, -30),
    disclosure: {
      ...newDisclosure(),
      mortgage: { status: 'ok', note: '' },
      accident: { status: 'ok', note: '' },
      mileage: { status: 'issue', note: '出险记录比表显多 1.2 万公里，待向原车主核实' },
    },
  });
  const magotan = car({
    brand: '大众迈腾 2020款', plate: '粤C·45678', regYear: 2020, displayKm: 58000,
    source: 'peer', buyCents: 7200000, buyISO: addDays(today, -52),
    disclosure: { ...newDisclosure(), mortgage: { status: 'ok', note: '' } },
  });
  const aion = car({
    brand: '埃安AION S 网约退役', plate: '粤D·22222', regYear: 2021, displayKm: 186000,
    source: 'auction', buyCents: 4200000, buyISO: addDays(today, -80), note: '拍卖平台拍得，记录不全',
    disclosure: {
      ...newDisclosure(),
      operation: { status: 'issue', note: '营运退役，里程与记录基本对上' },
      accident: { status: 'issue', note: '左后纵梁轻微变形已修复' },
    },
  });
  const qin = car({
    brand: '比亚迪秦PLUS 2023款', plate: '粤E·66666', regYear: 2023, displayKm: 21000,
    source: 'person', buyCents: 5600000, buyISO: today, note: '刚收，还没来得及查',
  });
  state.cars = [camry, accord, magotan, aion, qin];

  state.costs = [
    { id: `e-${uid().slice(0, 8)}`, carId: camry.id, dateISO: addDays(today, -95), kind: 'repair', note: '更换前轮轴承', cents: 260000 },
    { id: `e-${uid().slice(0, 8)}`, carId: camry.id, dateISO: addDays(today, -90), kind: 'beauty', note: '全车打蜡', cents: 80000 },
    { id: `e-${uid().slice(0, 8)}`, carId: camry.id, dateISO: addDays(today, -88), kind: 'transfer', note: '过户代办费', cents: 50000 },
    { id: `e-${uid().slice(0, 8)}`, carId: accord.id, dateISO: addDays(today, -25), kind: 'part', note: '两条新轮胎', cents: 96000 },
    { id: `e-${uid().slice(0, 8)}`, carId: accord.id, dateISO: addDays(today, -24), kind: 'beauty', note: '内饰精洗', cents: 60000 },
    { id: `e-${uid().slice(0, 8)}`, carId: magotan.id, dateISO: addDays(today, -48), kind: 'repair', note: '变速箱油更换', cents: 180000 },
    { id: `e-${uid().slice(0, 8)}`, carId: aion.id, dateISO: addDays(today, -75), kind: 'beauty', note: '整备清洗', cents: 50000 },
  ];

  sheetCar = null;
  ledMonth = null;
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
    case 'save-dealer': saveDealer(); break;
    case 'add-car': addCar(); break;
    case 'del-car': delCar(idx); break;
    case 'save-disclosure': saveDisclosure(idx); break;
    case 'add-cost': costAction('add', idx); break;
    case 'del-cost': costAction('del', null, idx); break;
    case 'sell': doSell(idx); break;
    case 'undo-sell': doUndoSell(idx); break;
    case 'sheet-apply': {
      sheetCar = document.getElementById('sheet-car')?.value ?? sheetCar;
      render();
      break;
    }
    case 'sheet-copy': sheetAction('copy'); break;
    case 'sheet-download': sheetAction('download'); break;
    case 'sheet-print': sheetAction('print'); break;
    case 'led-apply': {
      ledMonth = document.getElementById('led-month')?.value || ledMonth;
      render();
      break;
    }
    case 'save-settings': saveSettings(); break;
    case 'export-json': dataAction('export-json'); break;
    case 'export-events': dataAction('export-events'); break;
    case 'seed-demo': seedDemo(); break;
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
