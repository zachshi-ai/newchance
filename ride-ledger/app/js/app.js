/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, addDays, fmtYuan,
  addProduct, applyIntake, applySale, removeSale,
  addTradeIn, removeTradeIn, recordLoss,
  purchaseLedgerText, saleLedgerText, tradeinLedgerText, proofOfSale, inspectionHtml,
  exportBundle, importBundle,
} from './core.js';
import {
  viewBoard, viewProducts, viewIntake, viewSale, viewLedger, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let proofCache = null; // 最近一次自证单 { key, dateISO, text, count }

const NAV = [
  ['#/board', '今日'], ['#/products', '商品'], ['#/intake', '进货'],
  ['#/sale', '销售'], ['#/ledger', '台账'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'products': html = viewProducts(state); break;
    case 'intake': html = viewIntake(state); break;
    case 'sale': html = viewSale(state); break;
    case 'ledger': html = viewLedger(state, proofCache); break;
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
// 档案动作（店铺 / 供货商 / 回收企业 / 商品）
// ---------------------------------------------------------------------------

function saveShop() {
  state.shop = { name: val('shop-name'), licenseNo: val('shop-license'), phone: val('shop-phone') };
  commit('save-shop');
  toast('已保存');
}

function addSupplier() {
  const name = val('sup-name');
  if (!name) { toast('请填写供货商名称'); return; }
  state.suppliers.push({
    id: `sup-${uid().slice(0, 8)}`,
    name,
    contact: val('sup-contact'),
    phone: val('sup-phone'),
  });
  commit('add-supplier', {});
  toast('供货商已添加');
}

function addRecycler() {
  const name = val('rec-name');
  if (!name) { toast('请填写回收企业名称'); return; }
  state.recyclers.push({
    id: `rec-${uid().slice(0, 8)}`,
    name,
    phone: val('rec-phone'),
  });
  commit('add-recycler', {});
  toast('回收企业已添加');
}

function createProduct() {
  const name = val('prod-name');
  if (!name) { toast('请填写商品名称（照合格证抄）'); return; }
  try {
    const warranty = Number(val('prod-warranty'));
    const item = addProduct(state, {
      id: `p-${uid().slice(0, 8)}`,
      name,
      kind: document.getElementById('prod-kind')?.value ?? 'ebike',
      brand: val('prod-brand'),
      model: val('prod-model'),
      cccNo: val('prod-ccc'),
      spec: val('prod-spec'),
      unit: val('prod-unit'),
      maker: val('prod-maker'),
      warrantyMonths: Number.isInteger(warranty) && warranty >= 0 ? warranty : 0,
      note: val('prod-note'),
    });
    commit('add-product', { kind: item.kind });
    toast(item.kind === 'ebike' ? `整车已建档（CCC ${item.cccNo}）` : '商品已建档');
  } catch (e) {
    fail(e);
  }
}

function delProduct(idx) {
  const p = state.products[idx];
  if (!p) return;
  if (state.batches.some((b) => b.productId === p.id)) {
    toast('该商品有进货批次，不可删除（账实一致）；可卖空后不再进货');
    return;
  }
  state.products.splice(idx, 1);
  commit('del-product');
}

// ---------------------------------------------------------------------------
// 进货 / 销售 / 换新
// ---------------------------------------------------------------------------

function addIntake() {
  const productId = document.getElementById('in-product')?.value;
  const qty = Number(val('in-qty'));
  const costYuan = Number(val('in-cost'));
  if (!productId) { toast('请先在「商品」建档'); return; }
  try {
    applyIntake(state, {
      id: `b-${uid().slice(0, 8)}`,
      productId,
      supplierId: document.getElementById('in-supplier')?.value ?? '',
      inISO: val('in-date') || todayISO(),
      qty,
      unitCostCents: Number.isFinite(costYuan) && costYuan > 0 ? Math.round(costYuan * 100) : null,
      lotNo: val('in-lot'),
      traceCode: val('in-trace'),
      note: '',
    });
    commit('intake', { qty });
    toast('进货已落账——查验记录就在台账里');
  } catch (e) {
    fail(e);
  }
}

function addSale() {
  const items = [];
  for (const check of document.querySelectorAll('.sale-check:checked')) {
    const productId = check.dataset.product;
    const qty = Number(document.querySelector(`.sale-qty[data-product="${productId}"]`)?.value);
    const priceYuan = Number(document.querySelector(`.sale-price[data-product="${productId}"]`)?.value);
    const codes = (document.querySelector(`.sale-codes[data-product="${productId}"]`)?.value ?? '')
      .split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!Number.isInteger(qty) || qty < 1) { toast('卖出数量应为正整数'); return; }
    const item = {
      productId,
      qty,
      priceCents: Number.isFinite(priceYuan) && priceYuan > 0 ? Math.round(priceYuan * 100) : null,
    };
    const kind = state.products.find((p) => p.id === productId)?.kind;
    if (kind === 'ebike') item.frameNos = codes;
    if (kind === 'battery') item.batteryCodes = codes;
    items.push(item);
  }
  try {
    const sale = applySale(state, {
      id: `x-${uid().slice(0, 8)}`,
      dateISO: val('sale-date') || todayISO(),
      buyerName: val('sale-buyer'),
      buyerPhone: val('sale-phone'),
      note: val('sale-note'),
      items,
    });
    commit('sale', { items: sale.items.length });
    toast(sale.warnings.length
      ? `已落账 ${sale.items.length} 品 · ⚠ ${sale.warnings[0]}`
      : `已落账 ${sale.items.length} 品——台账有据，心里不慌`);
  } catch (e) {
    fail(e);
  }
}

function undoSale(saleId) {
  try {
    removeSale(state, saleId);
    commit('undo-sale', { saleId });
    toast('已撤销，库存自动回滚');
  } catch (e) {
    fail(e);
  }
}

function addTradein() {
  const subsidyYuan = Number(val('ti-subsidy'));
  try {
    const { record, warning } = addTradeIn(state, {
      id: `t-${uid().slice(0, 8)}`,
      dateISO: val('ti-date') || todayISO(),
      buyerName: val('ti-buyer'),
      oldBrand: val('ti-brand'),
      oldFrameNo: val('ti-frame'),
      batteryCount: val('ti-batcnt') === '' ? null : Number(val('ti-batcnt')),
      batteryWeightKg: val('ti-batkg') === '' ? null : Number(val('ti-batkg')),
      recyclerId: document.getElementById('ti-recycler')?.value ?? '',
      saleId: document.getElementById('ti-sale')?.value ?? '',
      subsidyCents: Number.isFinite(subsidyYuan) && subsidyYuan > 0 ? Math.round(subsidyYuan * 100) : null,
      note: val('ti-note'),
    });
    commit('tradein', { oldFrameNo: record.oldFrameNo });
    toast(warning ? `回收已落账 · ⚠ ${warning}` : '回收已落账——旧车流向可追溯');
  } catch (e) {
    fail(e);
  }
}

function undoTradein(tradeInId) {
  try {
    removeTradeIn(state, tradeInId);
    commit('undo-tradein', { tradeInId });
    toast('已撤销回收记录');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 台账出证（自证单 / 台账文本 / 迎检打印包）
// ---------------------------------------------------------------------------

function generateProof() {
  const buyerName = val('proof-buyer');
  if (!buyerName) { toast('请填写购买人姓名'); return; }
  const dateISO = val('proof-date') || null;
  try {
    const { text, count } = proofOfSale(state, { buyerName, dateISO, todayISOStr: todayISO() });
    proofCache = { key: buyerName, dateISO, text, count };
    track(state, 'proof', { count });
    commit(null);
    toast(count > 0 ? `已出证：命中 ${count} 单销售记录` : '未命中销售记录——如实出具"未查到"也是证据');
  } catch (e) {
    fail(e);
  }
}

function ledgerAction(action) {
  const today = todayISO();
  track(state, 'ledger', { action });
  const common = { state, todayISOStr: today };
  if (action === 'copy-purchase') {
    copyText(purchaseLedgerText(common));
    saveState(state);
  } else if (action === 'copy-sale') {
    copyText(saleLedgerText(common));
    saveState(state);
  } else if (action === 'copy-tradein') {
    copyText(tradeinLedgerText(common));
    saveState(state);
  } else {
    const html = inspectionHtml(common);
    if (action === 'download') {
      downloadFile(`购销台账迎检包_${state.shop?.name ?? '门店'}_${today}.html`, html, 'text/html');
      toast('已下载，可打印或微信传回店里电脑打印');
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
    toast('已复制——去微信粘贴即可');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴即可');
  }
}

// ---------------------------------------------------------------------------
// 设置动作
// ---------------------------------------------------------------------------

function saveSettings() {
  const win = Number(document.getElementById('set-win')?.value);
  state.settings = {
    warrantyWindowDays: Number.isInteger(win) && win >= 7 && win <= 365 ? win : 60,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`车销单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`车销单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      proofCache = null;
      commit('import');
      toast('导入成功');
    };
    reader.readAsText(file);
  }
}

// ---------------------------------------------------------------------------
// 示例数据（30 秒体验完整流程；经 core 函数逐笔落账，守恒恒等式按构造成立）
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  const day = (n) => addDays(today, n);
  state.shop = { name: '张记电动车', licenseNo: '91320911MA1234567X', phone: '13800004567' };
  const supA = `sup-${uid().slice(0, 8)}`;
  const supB = `sup-${uid().slice(0, 8)}`;
  state.suppliers = [
    { id: supA, name: '雅迪县级代理商', contact: '钱经理', phone: '13911118888' },
    { id: supB, name: '天能电池批发', contact: '孙老板', phone: '13922229999' },
  ];
  const recA = `rec-${uid().slice(0, 8)}`;
  state.recyclers = [
    { id: recA, name: '县金桥再生资源回收有限公司', phone: '13933337777' },
  ];
  state.products = [];
  state.batches = [];
  state.sales = [];
  state.tradeins = [];
  state.losses = [];
  const mk = (over) => ({ id: `p-${uid().slice(0, 8)}`, brand: '', model: '', cccNo: '', spec: '', unit: '件', maker: '', warrantyMonths: 0, note: '', ...over });
  const P1 = mk({ name: '雅迪冠能3 E8', kind: 'ebike', brand: '雅迪', model: '冠能3 E8', cccNo: '2024011109123456', spec: '48V24Ah 锂电', unit: '辆', maker: '雅迪科技集团', warrantyMonths: 12 });
  const P2 = mk({ name: '爱玛指挥官 Pro', kind: 'ebike', brand: '爱玛', model: '指挥官 Pro', cccNo: '2024011109654321', spec: '48V20Ah 铅酸', unit: '辆', maker: '爱玛科技集团', warrantyMonths: 12 });
  const P3 = mk({ name: '天能 48V20Ah 电池组', kind: 'battery', brand: '天能', spec: '4 只装', unit: '组', maker: '天能电池', warrantyMonths: 12 });
  const P4 = mk({ name: '智能充电器 48V', kind: 'charger', spec: '48V 3A', unit: '个', maker: '星恒电器', warrantyMonths: 6 });
  const P5 = mk({ name: '3C 安全头盔', kind: 'helmet', spec: '通用款', unit: '顶', maker: '金盔防护', warrantyMonths: 0 });
  for (const p of [P1, P2, P3, P4, P5]) addProduct(state, p);

  const ib = (product, over) => applyIntake(state, {
    id: `b-${uid().slice(0, 8)}`, productId: product.id, inISO: today,
    qty: 1, unitCostCents: null, lotNo: '', traceCode: '', note: '', ...over,
  });
  ib(P1, { supplierId: supA, inISO: day(-90), qty: 8, unitCostCents: 189000, lotNo: 'YD20260610-1', traceCode: 'LTDX2026061000123' });
  ib(P2, { supplierId: supA, inISO: day(-45), qty: 6, unitCostCents: 158000, lotNo: 'AM20260715-2', traceCode: 'LTDS2026071500456' });
  ib(P3, { supplierId: supB, inISO: day(-60), qty: 20, unitCostCents: 32000, lotNo: 'TN20260701-3', traceCode: 'TN4820260701001' });
  ib(P4, { supplierId: supA, inISO: day(-30), qty: 30, unitCostCents: 4500, lotNo: 'XH20260731-1', traceCode: '' });
  ib(P5, { supplierId: supA, inISO: day(-30), qty: 50, unitCostCents: 3800, lotNo: 'JG20260731-1', traceCode: '' });

  const sb = (over) => applySale(state, {
    id: `x-${uid().slice(0, 8)}`, dateISO: today, buyerName: '', buyerPhone: '', note: '', items: [], ...over,
  });
  sb({ dateISO: day(-350), buyerName: '王师傅', buyerPhone: '13700001111', note: '铅酸款', items: [
    { productId: P2.id, qty: 1, priceCents: 259900, frameNos: ['LTDS2025091500077'] },
    { productId: P5.id, qty: 1, priceCents: 6900 },
  ] }); // 质保 12 个月 → 约 15 天后临保（「今日」页演示临保名单）
  const x2 = sb({ dateISO: day(-12), buyerName: '李大姐', buyerPhone: '13700002222', note: '换新购', items: [
    { productId: P1.id, qty: 1, priceCents: 329800, frameNos: ['LTDX2026082400201'] },
    { productId: P3.id, qty: 1, priceCents: 39900, batteryCodes: ['TN48202608240055'] },
    { productId: P5.id, qty: 2, priceCents: 6900 },
  ] });
  sb({ dateISO: day(-5), buyerName: '王师傅', buyerPhone: '13700001111', note: '旧车原电池鼓包更换', items: [
    { productId: P3.id, qty: 1, priceCents: 39900, batteryCodes: ['TN48202608310063'] },
  ] });
  sb({ dateISO: day(-1), buyerName: '赵会计', buyerPhone: '13700003333', items: [
    { productId: P4.id, qty: 2, priceCents: 8800 },
  ] });

  addTradeIn(state, {
    id: `t-${uid().slice(0, 8)}`,
    dateISO: day(-12),
    buyerName: '李大姐',
    oldBrand: '旧雅迪小电驴',
    oldFrameNo: '苏N123450',
    batteryCount: 1,
    batteryWeightKg: 17.5,
    recyclerId: recA,
    saleId: x2.id,
    subsidyCents: 50000,
    note: '以旧换新 500 元补贴',
  });

  proofCache = null;
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
    case 'save-shop': saveShop(); break;
    case 'add-supplier': addSupplier(); break;
    case 'del-supplier': state.suppliers.splice(Number(idx), 1); commit('del-supplier'); break;
    case 'add-recycler': addRecycler(); break;
    case 'del-recycler': state.recyclers.splice(Number(idx), 1); commit('del-recycler'); break;
    case 'add-product': createProduct(); break;
    case 'del-product': delProduct(Number(idx)); break;
    case 'add-intake': addIntake(); break;
    case 'add-sale': addSale(); break;
    case 'undo-sale': undoSale(el.dataset.idx); break;
    case 'add-tradein': addTradein(); break;
    case 'undo-tradein': undoTradein(el.dataset.idx); break;
    case 'proof-generate': generateProof(); break;
    case 'proof-copy': if (proofCache) copyText(proofCache.text); break;
    case 'ledger-copy-purchase': ledgerAction('copy-purchase'); break;
    case 'ledger-copy-sale': ledgerAction('copy-sale'); break;
    case 'ledger-copy-tradein': ledgerAction('copy-tradein'); break;
    case 'inspection-download': ledgerAction('download'); break;
    case 'inspection-print': ledgerAction('print'); break;
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
