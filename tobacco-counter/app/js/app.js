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
  renewLicense, startSuspension, endSuspension,
  addProduct, setProductOnSale,
  addPurchase,
  recordDaycheck, daycheckItemsFor,
  addEvent, fixEvent, closeEvent,
  addSale, removeSale,
  addChange, fileChange,
  setDutyDone,
  monthlySummary, inspectHtml, dayPassHtml,
  exportBundle, importBundle,
  DEFAULT_RENEW_WARN_DAYS, DEFAULT_CHANNEL_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
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
  ['#/board', '今日', 'board'], ['#/station', '建档', 'station'], ['#/ledger', '售烟', 'ledger'], ['#/reports', '报表', 'reports'], ['#/settings', '设置', 'settings'],
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

// ---------------------------------------------------------------------------
// 弹窗（延续办结 / 变更办结 / 事件处置 / 复查销案）
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
// 建档（店铺 / 品规 / 变更 / 义务）
// ---------------------------------------------------------------------------

function submitShop() {
  const name = val('vs-name');
  if (!name) { toast('请填写店铺名称'); return; }
  state.shop = {
    ...state.shop,
    name,
    licenseNo: val('vs-licno'),
    issuer: val('vs-issuer'),
    licenseExpiryISO: val('vs-licexpiry'),
    bizRegNo: val('vs-bizreg'),
    address: val('vs-address'),
    owner: val('vs-owner'),
    phone: val('vs-phone'),
    nearSchool: !!document.getElementById('vs-nearschool')?.checked,
    note: val('vs-note'),
  };
  commit('save-shop');
  toast('店铺信息已保存——许可证钟已按有效期起算');
}

function showRenew() {
  const v = state.shop;
  if (!v?.licenseExpiryISO) return;
  openModal(`延续办结 · ${v.name}`, `
    <p class="fine" style="margin-top:0">录入新证载明的有效期，许可证钟自动滚动。延续应在届满 30 日前提出申请（实施细则第 22 条）。</p>
    <div class="form-grid">
      <label>新证有效期至 *<input id="m-date" type="date" value="" /></label>
      <label class="span2">新证编号<input id="m-no" value="${v.licenseNo}" placeholder="换证后编号（可空=不变）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      const newExpiry = modalVal('m-date');
      if (!newExpiry) { toast('请填写新证有效期'); return; }
      renewLicense(v, newExpiry);
      const no = modalVal('m-no');
      if (no) v.licenseNo = no;
      closeModal();
      commit('license-renew', {});
      toast('延续已办结——许可证钟滚动至新有效期');
    } catch (e) { fail(e); }
  };
}

function submitProduct() {
  try {
    addProduct(state, {
      name: val('pd-name'),
      kind: document.getElementById('pd-kind')?.value || 'cigarette',
      code: val('pd-code'),
      flavor: document.getElementById('pd-flavor')?.value || 'tobacco',
      note: val('pd-note'),
    });
    commit('add-product', {});
    toast('品规已建档——进货落账后库存自动累计');
  } catch (e) { fail(e); }
}

function toggleProduct(id) {
  try {
    const rec = (state.products ?? []).find((p) => p.id === id);
    setProductOnSale(state, id, !(rec?.onSale));
    commit('toggle-product', {});
    toast(rec?.onSale ? '已停售下架——历史销售台账仍可回溯' : '已恢复在售');
  } catch (e) { fail(e); }
}

function submitPurchase() {
  try {
    const rec = addPurchase(state, {
      dateISO: val('pu-date') || todayISO(),
      productId: document.getElementById('pu-product')?.value,
      source: document.getElementById('pu-source')?.value || 'localWholesale',
      orderNo: val('pu-orderno'),
      qty: Number(val('pu-qty')) || 1,
      note: val('pu-note'),
    });
    commit('add-purchase', {});
    toast(rec.quarantined
      ? '⚠ 进货已落账但来源为「其他来源」——该品规已红旗隔离，核清处置并闭环前不得售出'
      : '进货已落账——渠道钟与库存已更新');
  } catch (e) { fail(e); }
}

function submitSale() {
  const payload = {
    dateISO: val('sl-date') || todayISO(),
    productId: document.getElementById('sl-product')?.value,
    qty: Number(val('sl-qty')) || 1,
    buyerLooksMinor: !!document.getElementById('sl-minor')?.checked,
    ageVerified: !!document.getElementById('sl-verified')?.checked,
    buyerDobISO: val('sl-dob'),
    note: val('sl-note'),
  };
  try {
    addSale(state, payload);
    commit('add-sale', {});
    toast('✅ 售烟已落账——四闸全过，快照已存');
  } catch (e) {
    // 闸机拦截：埋点留痕——每次拦截都是没被罚的证据
    track(state, 'sell-blocked', { reasons: String(e?.message ?? e).slice(0, 500), dateISO: payload.dateISO });
    saveState(state);
    toast(`⛔ ${String(e?.message ?? e).slice(0, 160)}`);
  }
}

function deleteSale(id) {
  try {
    removeSale(state, id);
    commit('del-sale');
    toast('已删除该笔销售（库存已回滚）');
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
    toast('变更已登记——向烟草专卖局办理后点「办结」');
  } catch (e) { fail(e); }
}

function showFileChange(id) {
  const c = (state.changes ?? []).find((x) => x.id === id);
  if (!c) return;
  openModal(`变更办结 · ${c.detail}`, `
    <p class="fine" style="margin-top:0">向烟草专卖局办理变更手续完成（实施细则第 21 条），录入办理回执日期。</p>
    <div class="form-grid">
      <label>办理日期 *<input id="m-date" type="date" value="${todayISO()}" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      fileChange(state, id, modalVal('m-date') || todayISO());
      closeModal();
      commit('file-change', {});
      toast('变更已办结');
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
// 开柜检查 / 合规事件
// ---------------------------------------------------------------------------

function submitDaycheck() {
  const dateISO = todayISO();
  const results = {};
  for (const it of daycheckItemsFor(state)) {
    results[it.key] = {
      ok: !!document.getElementById(`dc-${it.key}`)?.checked,
      note: document.getElementById(`dcnote-${it.key}`)?.value?.trim() ?? '',
    };
  }
  try {
    const rec = recordDaycheck(state, { dateISO, results, note: '' });
    commit('add-daycheck', {});
    toast(rec.status === 'issue'
      ? '检查卡已落——异常已自动转合规事件，处置闭环前按台账口径整改'
      : '检查卡已落，全项正常');
  } catch (e) { fail(e); }
}

function submitEvent() {
  try {
    addEvent(state, {
      dateISO: val('ev-date') || todayISO(),
      source: document.getElementById('ev-source')?.value || 'selfcheck',
      desc: val('ev-desc'),
    });
    commit('add-event', {});
    toast('事件已登记——处置、复查销案后闭环');
  } catch (e) { fail(e); }
}

function showFixEvent(id) {
  const h = (state.events ?? []).find((x) => x.id === id);
  if (!h) return;
  openModal(`事件处置 · ${h.desc.slice(0, 40)}…`, `
    <p class="fine" style="margin-top:0">处置必须写明措施与完成日，只打勾不留痕不算整改。红旗批次应在处置中注明「报备/退回」去向。</p>
    <div class="form-grid">
      <label>处置完成日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">处置措施 *<input id="m-action" placeholder="如：向烟草专卖局报备并退回该批卷烟 / 果味烟弹已下架退回平台" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      fixEvent(state, id, { actionISO: modalVal('m-date') || todayISO(), action: modalVal('m-action') });
      closeModal();
      commit('fix-event', {});
      toast('处置已登记——复查销案后闭环');
    } catch (e) { fail(e); }
  };
}

function showCloseEvent(id) {
  const h = (state.events ?? []).find((x) => x.id === id);
  if (!h) return;
  openModal(`复查销案 · ${h.desc.slice(0, 40)}…`, `
    <p class="fine" style="margin-top:0">处置措施：${h.action || '—'}（${h.actionISO || '—'}）。销案建议由店主本人执行；红旗批次品规随之解除隔离。</p>
    <div class="form-grid">
      <label>复查日 *<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>复查人 *<input id="m-verifier" value="${state.shop?.owner || ''}" placeholder="建议店主本人" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      closeEvent(state, id, { verifyISO: modalVal('m-date') || todayISO(), verifiedBy: modalVal('m-verifier') });
      closeModal();
      commit('close-event', {});
      toast('已复查销案——事件闭环');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 柜台核对单）
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
    downloadFile(`烟柜合规迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function daypassDownload() {
  const dateISO = document.getElementById('case-date')?.value || todayISO();
  try {
    const html = dayPassHtml(state, dateISO, todayISO());
    track(state, 'daypass-print', { dateISO });
    downloadFile(`当日柜台核对单_${dateISO}.html`, html, 'text/html');
    toast('核对单已下载——打印贴烟柜后，检查进门 10 秒出示');
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
    toast('已复制——去微信粘贴存档');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴存档');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function submitSettings() {
  const renew = Number(document.getElementById('set-renew')?.value);
  const channel = Number(document.getElementById('set-channel')?.value);
  const duty = Number(document.getElementById('set-duty')?.value);
  state.settings = {
    renewWarnDays: Number.isInteger(renew) && renew >= 15 && renew <= 365 ? renew : DEFAULT_RENEW_WARN_DAYS,
    channelWarnDays: Number.isInteger(channel) && channel >= 7 && channel <= 180 ? channel : DEFAULT_CHANNEL_WARN_DAYS,
    dutyWarnDays: Number.isInteger(duty) && duty >= 7 && duty <= 120 ? duty : DEFAULT_DUTY_WARN_DAYS,
  };
  commit('save-settings');
  toast('参数已保存');
}

function submitStartSuspension() {
  try {
    startSuspension(state.shop, val('ss-from') || todayISO(), val('ss-note'));
    commit('start-suspension', {});
    toast('停业已登记——届满 1 个月前记得向烟草专卖局提出停业申请');
  } catch (e) { fail(e); }
}

function submitEndSuspension() {
  try {
    const { days } = endSuspension(state.shop, todayISO());
    commit('end-suspension', {});
    toast(`已恢复营业（本次停业 ${days} 天）`);
  } catch (e) { fail(e); }
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`烟柜账备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`烟柜账使用记录_${todayISO()}.json`, JSON.stringify(state.traces ?? [], null, 2), 'application/json');
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
// 种子必须全过自己造的闸机：合法进货在渠道回看窗内、品规在售、库存充足、无红旗未闭环
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  state.shop = {
    name: '金叶便利店（示例）', licenseNo: '烟零售许〔2023〕第 03301 号', issuer: 'XX县烟草专卖局',
    licenseExpiryISO: isoAgo(today, -255), bizRegNo: '92330106MA2XXXXXXX',
    address: 'XX县梧桐街 12 号', owner: '顾金叶', phone: '0571-88662300',
    nearSchool: false,
    suspensionFromISO: '', suspensionNote: '',
    note: '2023-06-20 首次领证（5 年期）；2025-11 新增电子烟零售范围',
  };
  state.products = [];
  state.productSeq = 0;
  state.purchases = [];
  state.purchaseSeq = 0;
  state.sales = [];
  state.saleSeq = 0;
  state.daychecks = [];
  state.daycheckSeq = 0;
  state.events = [];
  state.eventSeq = 0;
  state.changes = [];
  state.changeSeq = 0;
  state.duties = [];

  // 品规：卷烟主力 + 电子烟烟草口味 + 已停售品规
  const smoke = addProduct(state, { name: '软中华（84mm 硬盒）', kind: 'cigarette', code: '6901028075560', note: '主力品规' });
  const vape = addProduct(state, { name: '某品牌烟弹·烟草口味', kind: 'vape', code: 'VP-TB-031', note: '2025-11 新增' });
  const cigar = addProduct(state, { name: '长城雪茄（迷你）', kind: 'cigar', code: 'CC-MINI-20', note: '慢销' });
  const off = addProduct(state, { name: '旧包装利群（停售）', kind: 'cigarette', code: 'LQ-OLD-01', note: '2025 年退出' });
  setProductOnSale(state, off.id, false);

  // 进货：合法渠道、回看窗内（卷烟走当地批发、电子烟走平台、雪茄走当地批发）
  addPurchase(state, { dateISO: isoAgo(today, 15), productId: smoke.id, source: 'localWholesale', orderNo: 'JY-2026-0825-117', qty: 30, note: '县烟草公司每周订单' });
  addPurchase(state, { dateISO: isoAgo(today, 15), productId: cigar.id, source: 'localWholesale', orderNo: 'JY-2026-0825-117', qty: 5 });
  addPurchase(state, { dateISO: isoAgo(today, 10), productId: vape.id, source: 'vapePlatform', orderNo: 'PT-2026-0830-5521', qty: 10, note: '平台下单当地电子烟批发配送' });

  // 昨天：开柜检查全过 + 一笔正常销售（无未成年人表征）
  const yesterday = isoAgo(today, 1);
  const itemsY = daycheckItemsFor(state);
  recordDaycheck(state, { dateISO: yesterday, results: Object.fromEntries(itemsY.map((it) => [it.key, { ok: true, note: '' }])) });
  addSale(state, { dateISO: yesterday, productId: smoke.id, qty: 2 });
  addSale(state, { dateISO: yesterday, productId: vape.id, qty: 1 });

  // 今天：一笔正常销售（今天的开柜检查留给用户体验「落卡」动作）
  addSale(state, { dateISO: today, productId: smoke.id, qty: 1 });

  // 已闭环合规事件（上月：果味烟弹下架退回——展示闭环状态机；电子烟办法第 26 条口径）
  const ev = addEvent(state, {
    dateISO: isoAgo(today, 40), source: 'selfcheck',
    desc: '自查发现 1 盒非烟草口味果味烟弹（平台外购入样品）——禁止销售除烟草口味外的调味电子烟（电子烟办法第 26 条）',
  });
  fixEvent(state, ev.id, { actionISO: isoAgo(today, 39), action: '当场下架并退回平台对接人，留存退回记录；对店员做口味红线培训' });
  closeEvent(state, ev.id, { verifyISO: isoAgo(today, 38), verifiedBy: '顾金叶' });

  // 未办结变更（黄灯示例：新增电子烟范围办理中）
  addChange(state, { dateISO: isoAgo(today, 25), kind: 'scope', detail: '新增电子烟零售业务（许可范围变更，已报县烟草专卖局待回执）' });

  // 周期义务：库存月查逾期（红）/ 执照年报在期 / 许可自查在期 / 平台对账在期
  setDutyDone(state, 'stocktake', isoAgo(today, 45), '全柜盘点（此后未再盘）');
  setDutyDone(state, 'bizLicense', isoAgo(today, 120), '2025 年度年报（个体工商户）');
  setDutyDone(state, 'licenseSelfcheck', isoAgo(today, 60), '证照与实际经营一致性自查');
  setDutyDone(state, 'vapeReconcile', isoAgo(today, 20), '8 月平台对账单核对');

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
    case 'save-shop': submitShop(); break;
    case 'show-renew': showRenew(); break;
    case 'add-product': submitProduct(); break;
    case 'toggle-product': toggleProduct(idx); break;
    case 'add-purchase': submitPurchase(); break;
    case 'add-sale': submitSale(); break;
    case 'del-sale': deleteSale(idx); break;
    case 'add-change': submitChange(); break;
    case 'show-file-change': showFileChange(idx); break;
    case 'set-duty': submitDuty(); break;
    case 'add-daycheck': submitDaycheck(); break;
    case 'add-event': submitEvent(); break;
    case 'show-fix-event': showFixEvent(idx); break;
    case 'show-close-event': showCloseEvent(idx); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'daypass-download': daypassDownload(); break;
    case 'save-settings': submitSettings(); break;
    case 'start-suspension': submitStartSuspension(); break;
    case 'end-suspension': submitEndSuspension(); break;
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
