/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, monthKey, addDays,
  addSeller, removeSeller, addBuy, removeBuy, addRefuse, removeRefuse, addOut, removeOut,
  isLowPrice, healthCheck,
  sourceText, sourceHtml, registerHtml, outStatementText,
  exportBundle, importBundle, ITEM_CATS, fmtUnitPrice,
} from './core.js';
import {
  viewBoard, viewBuys, viewRefuses, viewLedger, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let sheetBuy = null;  // 自证单页用户选择的收购记录（跨渲染保留）
let ledMonth = null;  // 台账页用户选择的月份

const NAV = [
  ['#/board', '今日'], ['#/buys', '收购'], ['#/refuses', '拒收'], ['#/ledger', '台账'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'buys': html = viewBuys(state, sheetBuy); break;
    case 'refuses': html = viewRefuses(state); break;
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

// ---------------------------------------------------------------------------
// 站点档案
// ---------------------------------------------------------------------------

function saveStation() {
  state.station = { name: val('st-name'), phone: val('st-phone'), lic: val('st-lic'), filedNo: val('st-filed') };
  commit('save-station');
  toast('已保存');
}

// ---------------------------------------------------------------------------
// 出售人
// ---------------------------------------------------------------------------

function addSellerAction() {
  try {
    const s = addSeller(state, {
      id: `s-${uid().slice(0, 8)}`,
      name: val('sl-name'),
      idNo: val('sl-idno'),
      phone: val('sl-phone'),
      note: val('sl-note'),
    });
    track(state, 'add-seller', { hasId: Boolean(s.idNo) });
    commit();
    toast(s.idNo ? '档案已建——收购时点选即可' : '档案已建——建议补证件号，高危品类落账会被拦');
  } catch (e) {
    fail(e);
  }
}

function delSellerAction(id) {
  try {
    removeSeller(state, id);
    commit('del-seller');
    toast('已删除');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 收购
// ---------------------------------------------------------------------------

function addBuyAction() {
  const sellerId = document.getElementById('buy-seller')?.value;
  if (!sellerId) { toast('请先建出售人档案'); return; }
  const weightRaw = val('buy-weight');
  const weightKg = weightRaw === '' ? null : Number(weightRaw);
  const priceYuan = Number(val('buy-price'));
  try {
    const entry = addBuy(state, {
      id: `b-${uid().slice(0, 8)}`,
      dateISO: val('buy-date') || todayISO(),
      sellerId,
      cat: document.getElementById('buy-cat')?.value || 'other',
      desc: val('buy-desc'),
      weightKg,
      priceCents: Number.isFinite(priceYuan) ? Math.round(priceYuan * 100) : NaN,
      proofNote: val('buy-proof'),
      lowNote: val('buy-lownote'),
    });
    const low = isLowPrice(entry, state.settings);
    track(state, 'add-buy', { cat: entry.cat, low, hasProof: Boolean(entry.proofNote) });
    commit();
    toast(low ? '已落账——低价原因已入册，被问到拿得出来' : '已落账——单据与登记册自动汇入');
  } catch (e) {
    fail(e);
  }
}

function delBuyAction(id) {
  try {
    removeBuy(state, id);
    if (sheetBuy === id) sheetBuy = null;
    commit('del-buy');
    toast('已删除误录');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 拒收 / 出货
// ---------------------------------------------------------------------------

function addRefuseAction() {
  try {
    addRefuse(state, {
      id: `r-${uid().slice(0, 8)}`,
      dateISO: val('rf-date') || todayISO(),
      sellerName: val('rf-name'),
      sellerId: document.getElementById('rf-seller')?.value || '',
      cat: document.getElementById('rf-cat')?.value || 'other',
      desc: val('rf-desc'),
      reason: document.getElementById('rf-reason')?.value || 'other',
      note: val('rf-note'),
    });
    track(state, 'add-refuse', {});
    commit();
    toast('拒收已登记——这张记录就是「我查验过、我拒绝了」的白纸黑字');
  } catch (e) {
    fail(e);
  }
}

function delRefuseAction(id) {
  try {
    removeRefuse(state, id);
    commit('del-refuse');
    toast('已删除');
  } catch (e) {
    fail(e);
  }
}

function addOutAction() {
  const weightRaw = val('out-weight');
  const priceYuan = Number(val('out-price'));
  try {
    addOut(state, {
      id: `o-${uid().slice(0, 8)}`,
      dateISO: val('out-date') || todayISO(),
      buyer: val('out-buyer'),
      cat: document.getElementById('out-cat')?.value || 'other',
      weightKg: weightRaw === '' ? null : Number(weightRaw),
      priceCents: Number.isFinite(priceYuan) ? Math.round(priceYuan * 100) : NaN,
    });
    track(state, 'add-out', {});
    commit();
    toast('出货已落账——去向留痕，链条两头说得清');
  } catch (e) {
    fail(e);
  }
}

function delOutAction(id) {
  try {
    removeOut(state, id);
    commit('del-out');
    toast('已删除');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 单据三通道（自证单 / 登记册 / 对账单）
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
    toast('已复制——去微信粘贴给对方');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴给对方');
  }
}

function sourceAction(action) {
  if (!sheetBuy) { toast('请先在收购流水里点「出自证单」'); return; }
  track(state, 'source-sheet', { action });
  if (action === 'copy') {
    copyText(sourceText({ state, buyId: sheetBuy, todayISOStr: todayISO() }));
    saveState(state);
  } else {
    const html = sourceHtml({ state, buyId: sheetBuy, todayISOStr: todayISO() });
    if (action === 'download') {
      downloadFile(`收购来源说明_${sheetBuy.slice(0, 10)}_${todayISO()}.html`, html, 'text/html');
      toast('已下载，打印后让出售人签字确认');
    } else {
      printHtml(html);
    }
    saveState(state);
  }
}

function registerAction(action) {
  const month = ledMonth ?? monthKey(todayISO());
  try {
    const html = registerHtml({ state, month, todayISOStr: todayISO() });
    track(state, 'register', { action, month });
    if (action === 'download') {
      downloadFile(`收购登记册_${month}.html`, html, 'text/html');
      toast('登记册已导出——收购、拒收、查验痕迹一册在案');
    } else {
      printHtml(html);
    }
    saveState(state);
  } catch (e) {
    fail(e);
  }
}

function statementAction() {
  const month = ledMonth ?? monthKey(todayISO());
  try {
    copyText(outStatementText({ state, month, todayISOStr: todayISO() }));
    track(state, 'out-statement', { month });
    saveState(state);
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 设置动作
// ---------------------------------------------------------------------------

function saveParams() {
  const ratio = Number(val('set-lowratio'));
  const refPrices = { ...(state.settings?.refPrices ?? {}) };
  for (const k of Object.keys(ITEM_CATS)) {
    const raw = val(`ref-${k}`);
    if (raw === '') {
      delete refPrices[k];
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) { toast(`${ITEM_CATS[k].label} 参考价不合法`); return; }
      refPrices[k] = n === 0 ? null : n;
    }
  }
  state.settings = {
    lowRatio: Number.isInteger(ratio) && ratio >= 10 && ratio <= 95 ? ratio : 50,
    refPrices,
  };
  commit('save-params');
  toast('参数已保存——当日实时行情永远赢');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`来路单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出（含实名信息，请妥善保管）');
  } else if (action === 'export-events') {
    downloadFile(`来路单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      sheetBuy = null;
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
  state.station = { name: '顺发废品站', phone: '13800001234', lic: '92330106MA2XXXXX', filedNo: '备案 3301X-2026-118' };
  state.settings = { lowRatio: 50, refPrices: {} };

  state.sellers = [
    { id: 's-seed1', name: '张老三', idNo: '330106197501011234', phone: '13911112222', note: '小区门口开面包车收货的', createdAt: new Date().toISOString() },
    { id: 's-seed2', name: '王二', idNo: '330106198802022345', phone: '', note: '装修队退料的中间人', createdAt: new Date().toISOString() },
    { id: 's-seed3', name: '赵某', idNo: '330106199003033456', phone: '13933334444', note: '近期来得勤', createdAt: new Date().toISOString() },
  ];

  const pushBuy = (over) => {
    state.buys.push({
      id: `b-${uid().slice(0, 8)}`,
      desc: '', weightKg: null, proofNote: '', lowNote: '',
      createdAt: new Date().toISOString(),
      ...over,
    });
  };
  pushBuy({ dateISO: addDays(today, -26), sellerId: 's-seed2', cat: 'build', desc: '装修队退的扣件两袋', weightKg: 300, priceCents: 90000, proofNote: '城南装饰工程部出库单（手写）' });
  pushBuy({ dateISO: addDays(today, -24), sellerId: 's-seed1', cat: 'iron', desc: '废钢筋头', weightKg: 420, priceCents: 96600 });
  pushBuy({ dateISO: addDays(today, -18), sellerId: 's-seed1', cat: 'paper', desc: '纸箱一车', weightKg: null, priceCents: 32000 });
  pushBuy({ dateISO: addDays(today, -15), sellerId: 's-seed3', cat: 'copper', desc: '电机拆铜', weightKg: 25, priceCents: 140000 });
  pushBuy({ dateISO: addDays(today, -12), sellerId: 's-seed2', cat: 'cable', desc: '工程退下的旧电缆', weightKg: 200, priceCents: 500000, proofNote: '宏远建设退库单（2026-087）', lowNote: '含绝缘皮折重' });
  pushBuy({ dateISO: addDays(today, -9), sellerId: 's-seed3', cat: 'copper', desc: '铜管一批', weightKg: 18, priceCents: 102000 });
  pushBuy({ dateISO: addDays(today, -6), sellerId: 's-seed1', cat: 'appliance', desc: '旧洗衣机两台', weightKg: null, priceCents: 16000 });
  pushBuy({ dateISO: addDays(today, -2), sellerId: 's-seed3', cat: 'copper', desc: '电机拆铜（又说一批）', weightKg: 22, priceCents: 123000 });

  state.refuses = [
    { id: `r-${uid().slice(0, 8)}`, dateISO: addDays(today, -10), sellerId: '', sellerName: '不明人员（骑三轮）', cat: 'infra', desc: '两个铸铁井盖还带着泥，说工地捡的', reason: 'noProof', note: '告知来路不明不能收，人走了', createdAt: new Date().toISOString() },
    { id: `r-${uid().slice(0, 8)}`, dateISO: addDays(today, -3), sellerId: '', sellerName: '小年轻（称新收的）', cat: 'battery', desc: '五十多块电动车电瓶，包装全无', reason: 'suspicious', note: '价格压得极低仍说不清来路，已拒', createdAt: new Date().toISOString() },
  ];

  state.outs = [
    { id: `o-${uid().slice(0, 8)}`, dateISO: addDays(today, -20), buyer: '金桥再生资源打包站', cat: 'iron', weightKg: 420, priceCents: 109200, createdAt: new Date().toISOString() },
    { id: `o-${uid().slice(0, 8)}`, dateISO: addDays(today, -8), buyer: '金桥再生资源打包站', cat: 'copper', weightKg: 60, priceCents: 348000, createdAt: new Date().toISOString() },
    { id: `o-${uid().slice(0, 8)}`, dateISO: addDays(today, -5), buyer: '宏发废纸打包点', cat: 'paper', weightKg: null, priceCents: 41000, createdAt: new Date().toISOString() },
  ];

  sheetBuy = null;
  ledMonth = null;
  commit('seed-demo');
  toast('示例数据已载入——看看「今日」的销赃特征点名与拒收自证');
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
    case 'add-seller': addSellerAction(); break;
    case 'del-seller': delSellerAction(idx); break;
    case 'add-buy': addBuyAction(); break;
    case 'del-buy': delBuyAction(idx); break;
    case 'buy-sheet': {
      sheetBuy = idx;
      commit('buy-sheet');
      break;
    }
    case 'source-copy': sourceAction('copy'); break;
    case 'source-download': sourceAction('download'); break;
    case 'source-print': sourceAction('print'); break;
    case 'add-refuse': addRefuseAction(); break;
    case 'del-refuse': delRefuseAction(idx); break;
    case 'add-out': addOutAction(); break;
    case 'del-out': delOutAction(idx); break;
    case 'register-download': registerAction('download'); break;
    case 'register-print': registerAction('print'); break;
    case 'statement-copy': statementAction(); break;
    case 'led-apply': {
      ledMonth = document.getElementById('led-month')?.value || ledMonth;
      render();
      break;
    }
    case 'save-params': saveParams(); break;
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
