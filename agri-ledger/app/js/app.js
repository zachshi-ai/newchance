/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, addDays, batchRemaining,
  addProduct, applyIntake, applySale, removeSale, recordLoss,
  purchaseLedgerText, saleLedgerText, proofOfSale, inspectionHtml,
  exportBundle, importBundle,
} from './core.js';
import {
  viewBoard, viewProducts, viewIntake, viewSale, viewLedger, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let proofCache = null; // 最近一次药害自证单 { key, dateISO, text, count }

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
// 档案动作（店铺 / 供应商 / 商品）
// ---------------------------------------------------------------------------

function saveShop() {
  state.shop = { name: val('shop-name'), licenseNo: val('shop-license'), phone: val('shop-phone') };
  commit('save-shop');
  toast('已保存');
}

function addSupplier() {
  const name = val('sup-name');
  if (!name) { toast('请填写供应商名称'); return; }
  state.suppliers.push({
    id: `sup-${uid().slice(0, 8)}`,
    name,
    contact: val('sup-contact'),
    phone: val('sup-phone'),
  });
  commit('add-supplier', {});
  toast('供应商已添加');
}

function submitProduct() {
  const name = val('prod-name');
  if (!name) { toast('请填写商品名称（照标签抄）'); return; }
  try {
    const item = addProduct(state, {
      id: `p-${uid().slice(0, 8)}`,
      name,
      kind: document.getElementById('prod-kind')?.value ?? 'pesticide',
      regNo: val('prod-reg'),
      maker: val('prod-maker'),
      spec: val('prod-spec'),
      toxicity: document.getElementById('prod-toxicity')?.value ?? '',
      restricted: document.getElementById('prod-restricted')?.value === '1',
      note: val('prod-note'),
    });
    commit('add-product', { kind: item.kind });
    toast(item.restricted ? '已建档 · 「限」标商品销售须实名（定点经营以属地为准）' : '商品已建档');
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
// 进货与销售
// ---------------------------------------------------------------------------

function addIntake() {
  const productId = document.getElementById('in-product')?.value;
  const inISO = val('in-date') || todayISO();
  const qty = Number(val('in-qty'));
  const costYuan = Number(val('in-cost'));
  const expireISO = val('in-expire') || null;
  if (!productId) { toast('请先在「商品」建档'); return; }
  try {
    applyIntake(state, {
      id: `b-${uid().slice(0, 8)}`,
      productId,
      supplierId: document.getElementById('in-supplier')?.value ?? '',
      inISO,
      qty,
      unitCostCents: Number.isFinite(costYuan) && costYuan > 0 ? Math.round(costYuan * 100) : null,
      lotNo: val('in-lot'),
      traceCode: val('in-trace'),
      expireISO,
      note: '',
    });
    commit('intake', { qty });
    toast('进货已落账——采购台账多一行');
  } catch (e) {
    fail(e);
  }
}

function addSale() {
  const dateISO = val('sale-date') || todayISO();
  const items = [];
  for (const check of document.querySelectorAll('.sale-check:checked')) {
    const productId = check.dataset.product;
    const qty = Number(document.querySelector(`.sale-qty[data-product="${productId}"]`)?.value);
    const priceYuan = Number(document.querySelector(`.sale-price[data-product="${productId}"]`)?.value);
    if (!Number.isInteger(qty) || qty < 1) { toast('卖出数量应为正整数'); return; }
    items.push({
      productId,
      qty,
      priceCents: Number.isFinite(priceYuan) && priceYuan > 0 ? Math.round(priceYuan * 100) : null,
    });
  }
  try {
    const sale = applySale(state, {
      id: `x-${uid().slice(0, 8)}`,
      dateISO,
      buyerName: val('sale-buyer'),
      buyerPhone: val('sale-phone'),
      buyerIdNo: val('sale-idno'),
      crop: val('sale-crop'),
      note: val('sale-note'),
      items,
    });
    commit('sale', { items: sale.items.length });
    toast(`已落账 ${sale.items.length} 品——台账有据，心里不慌`);
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

function sealBatch(batchId) {
  try {
    const qty = batchRemaining(state, batchId);
    const loss = recordLoss(state, {
      id: `l-${uid().slice(0, 8)}`,
      dateISO: todayISO(),
      batchId,
      qty,
      reason: 'expired',
      note: '过期下架封存',
    });
    commit('seal-batch', { qty: loss.qty });
    toast(`已封存 ${loss.qty} 件——过期农药务必按属地要求处置，不得再卖`);
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
  if (action === 'copy-purchase') {
    copyText(purchaseLedgerText({ state, todayISOStr: today }));
    saveState(state);
  } else if (action === 'copy-sale') {
    copyText(saleLedgerText({ state, todayISOStr: today }));
    saveState(state);
  } else {
    const html = inspectionHtml({ state, todayISOStr: today });
    if (action === 'download') {
      downloadFile(`购销台账迎检包_${state.shop?.name ?? '门店'}_${today}.html`, html, 'text/html');
      toast('已下载，可打印或微信传给家里电脑打印');
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
  const near = Number(document.getElementById('set-near')?.value);
  state.settings = {
    nearExpiryDays: Number.isInteger(near) && near >= 7 && near <= 365 ? near : 90,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`购销单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`购销单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
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
  state.shop = { name: '张记农资', licenseNo: '农经许（苏N）字第0088号', phone: '13800004567' };
  const supA = `sup-${uid().slice(0, 8)}`;
  const supB = `sup-${uid().slice(0, 8)}`;
  state.suppliers = [
    { id: supA, name: '县绿丰农资批发部', contact: '钱经理', phone: '13911118888' },
    { id: supB, name: '金禾种子化肥配送中心', contact: '孙老板', phone: '13922229999' },
  ];
  state.products = [];
  state.batches = [];
  state.sales = [];
  state.losses = [];
  const mk = (over) => ({ id: `p-${uid().slice(0, 8)}`, ...over });
  const P1 = mk({ name: '4.5% 高效氯氰菊酯乳油', kind: 'pesticide', regNo: 'PD20101234', spec: '250ml/瓶', unit: '瓶', maker: '红星农化', toxicity: '低毒', restricted: false, note: '' });
  const P2 = mk({ name: '80% 代森锰锌可湿性粉剂', kind: 'pesticide', regNo: 'PD20085566', spec: '100g/袋', unit: '袋', maker: '红星农化', toxicity: '低毒', restricted: false, note: '' });
  const P3 = mk({ name: '磷化铝', kind: 'pesticide', regNo: 'PD86123-4', spec: '56% 片剂 10片/瓶', unit: '瓶', maker: '红星农化', toxicity: '剧毒', restricted: false, note: '粮仓熏蒸' });
  const P4 = mk({ name: '中麦578 小麦种子', kind: 'seed', regNo: '国审麦20210086', spec: '15kg/袋', unit: '袋', maker: '金禾种业', toxicity: '', restricted: false, note: '秋播主打' });
  const P5 = mk({ name: '磷酸二氢钾', kind: 'fertilizer', regNo: '', spec: '400g/袋', unit: '袋', maker: '金禾化工厂', toxicity: '', restricted: false, note: '' });
  for (const p of [P1, P2, P3, P4, P5]) addProduct(state, p);

  const ib = (product, over) => applyIntake(state, {
    id: `b-${uid().slice(0, 8)}`, productId: product.id, inISO: today,
    qty: 1, unitCostCents: null, lotNo: '', traceCode: '', expireISO: null, note: '', ...over,
  });
  ib(P1, { supplierId: supA, inISO: day(-200), qty: 40, unitCostCents: 820, lotNo: '20260218-2', traceCode: '826610020218045588', expireISO: day(25) });   // 临期批（25 天）
  ib(P1, { supplierId: supA, inISO: day(-80), qty: 60, unitCostCents: 850, lotNo: '20260615-1', traceCode: '826610061501123377', expireISO: day(300) });
  ib(P2, { supplierId: supA, inISO: day(-45), qty: 30, unitCostCents: 320, lotNo: '20260722-4', traceCode: '826610072204421199', expireISO: day(400) });
  ib(P3, { supplierId: supA, inISO: day(-30), qty: 12, unitCostCents: 2100, lotNo: '20260806-1', traceCode: '826610080610052244', expireISO: day(500) });
  ib(P4, { supplierId: supB, inISO: day(-20), qty: 50, unitCostCents: 10500, lotNo: '20260816-7', traceCode: '', expireISO: day(150) });
  ib(P5, { supplierId: supB, inISO: day(-400), qty: 80, unitCostCents: 450, lotNo: '20250801-2', traceCode: '', expireISO: day(-10) });                    // 过期在库（红灯演示）

  const sb = (over) => applySale(state, {
    id: `x-${uid().slice(0, 8)}`, dateISO: today, buyerName: '', buyerPhone: '', buyerIdNo: '',
    crop: '', note: '', items: [], ...over,
  });
  sb({ dateISO: day(-28), buyerName: '王老汉', buyerPhone: '13700001111', crop: '小麦蚜虫', items: [{ productId: P1.id, qty: 2, priceCents: 1000 }] });
  sb({ dateISO: day(-12), buyerName: '李大姐', buyerPhone: '13700002222', crop: '番茄晚疫病', items: [
    { productId: P2.id, qty: 3, priceCents: 500 },
    { productId: P5.id, qty: 4, priceCents: 600 },
  ] });
  sb({ dateISO: day(-5), buyerName: '赵会计', buyerPhone: '13700003333', crop: '秋播小麦', items: [{ productId: P4.id, qty: 2, priceCents: 11500 }] });
  sb({ dateISO: day(-1), buyerName: '王老汉', buyerPhone: '13700001111', buyerIdNo: '320911196203045678', crop: '粮仓熏蒸', note: '限用实名演示', items: [{ productId: P3.id, qty: 1, priceCents: 2500 }] });

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
    case 'add-product': submitProduct(); break;
    case 'del-product': delProduct(Number(idx)); break;
    case 'add-intake': addIntake(); break;
    case 'add-sale': addSale(); break;
    case 'undo-sale': undoSale(el.dataset.idx); break;
    case 'seal-batch': sealBatch(el.dataset.idx); break;
    case 'proof-generate': generateProof(); break;
    case 'proof-copy': if (proofCache) copyText(proofCache.text); break;
    case 'ledger-copy-purchase': ledgerAction('copy-purchase'); break;
    case 'ledger-copy-sale': ledgerAction('copy-sale'); break;
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
