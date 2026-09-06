/**
 * app.js — 路由、状态变更、事件委托、弹窗、示例数据与启动
 */
import {
  loadState, saveState, track, emptyState,
} from './store.js';
import {
  todayISO, monthKey, addDays,
  addDrug, removeDrug, addBatch, outBatch, removeOut, resolveQuarantine,
  addReading, removeReading, handleReading,
  addRefusal, addCare, setDutyDone,
  monthlySummary, inspectHtml, clearanceHtml,
  exportBundle, importBundle,
  DEFAULT_WARN_DAYS, DEFAULT_RED_DAYS, DEFAULT_CARE_DAYS, DEFAULT_GAP_DAYS,
} from './core.js';
import {
  viewBoard, viewStore, viewShelf, viewLedger, viewReports, viewSettings, ICONS,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const $modalHost = document.getElementById('modal-host');

let state = loadState();
let repMonth = null;   // 月度小结用户选择的月份（跨渲染保留）
let repCache = null;   // 最近一次小结文本

const NAV = [
  ['#/board', '今日', 'board'], ['#/shelf', '药架', 'shelf'], ['#/ledger', '台账', 'ledger'],
  ['#/reports', '报表', 'reports'], ['#/store', '药店', 'store'], ['#/settings', '设置', 'settings'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'shelf': html = viewShelf(state); break;
    case 'ledger': html = viewLedger(state); break;
    case 'reports': html = viewReports(state, repMonth, repCache); break;
    case 'store': html = viewStore(state); break;
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

// ---------------------------------------------------------------------------
// 弹窗（出库 / 隔离销案 / 异常处置）
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
// 药店与义务
// ---------------------------------------------------------------------------

function savePharmacy() {
  const name = val('ph-name');
  if (!name) { toast('请填写药店名称'); return; }
  state.pharmacy = {
    ...state.pharmacy,
    name,
    manager: val('ph-manager'),
    phone: val('ph-phone'),
    address: val('ph-address'),
    licenseNo: val('ph-licenseno'),
    licenseExpiryISO: val('ph-license-exp'),
    pharmacistName: val('ph-rx-name'),
    pharmacistRegNo: val('ph-rx-no'),
    pharmacistRegExpiryISO: val('ph-rx-exp'),
  };
  commit('save-pharmacy');
  toast('药店信息已保存——许可证与药师双证钟已重算');
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

// ---------------------------------------------------------------------------
// 药架：药品 / 批次 / 出库 / 隔离
// ---------------------------------------------------------------------------

function addDrugAction() {
  try {
    const d = addDrug(state, {
      name: val('dg-name'),
      spec: val('dg-spec'),
      storage: document.getElementById('dg-storage')?.value || 'normal',
      approvalNo: val('dg-approval'),
      manufacturer: val('dg-maker'),
    });
    commit('add-drug', { storage: d.storage });
    toast('药品已建档——进货时按批号建批');
  } catch (e) { fail(e); }
}

function delDrug(id) {
  try {
    removeDrug(state, id);
    commit('del-drug');
    toast('已删除药品档案');
  } catch (e) { fail(e); }
}

function addBatchAction() {
  const drugId = document.getElementById('bt-drug')?.value;
  const qty = num('bt-qty');
  try {
    addBatch(state, {
      drugId,
      batchNo: val('bt-batch'),
      expiryISO: val('bt-expiry'),
      qty: Number.isInteger(qty) ? qty : NaN,
      location: val('bt-loc'),
    });
    commit('add-batch', {});
    toast('批次已入架——效期三色档自动点名');
  } catch (e) { fail(e); }
}

function showOut(batchId) {
  const batch = (state.batches ?? []).find((b) => b.id === batchId);
  if (!batch) return;
  openModal(`出库落账 · 批号 ${batch.batchNo}`, `
    <p class="fine" style="margin-top:0">在架 ${batch.qty} 盒（支） · 效期至 ${batch.expiryISO}。售出选「售出」；发现质量问题先「下架隔离」，销毁或退货后在隔离单上销案。</p>
    <div class="form-grid">
      <label>日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>数量（盒/支）<input id="m-qty" type="number" min="1" max="${batch.qty}" value="1" /></label>
      <label class="span2">方式<select id="m-way">
        <option value="sold">售出</option>
        <option value="quarantine">下架隔离（自动生成待处置隔离单）</option>
        <option value="return">退回供应商</option>
        <option value="destroy">报损销毁</option>
        <option value="recall">召回下架</option>
      </select></label>
      <label class="span2">备注<input id="m-note" placeholder="如：近效期催销售出 / 检查发现外包装破损（可空）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      const way = document.getElementById('m-way')?.value || 'sold';
      const qty = num('m-qty');
      const { quarantine } = outBatch(state, batchId, {
        dateISO: modalVal('m-date') || todayISO(),
        qty: Number.isInteger(qty) ? qty : NaN,
        way,
        note: modalVal('m-note'),
      });
      closeModal();
      commit('batch-out', { way });
      toast(quarantine ? '已出库并生成待处置隔离单——销毁/退货后记得销案' : '出库已落账');
    } catch (e) { fail(e); }
  };
}

function delOut(id) {
  try {
    removeOut(state, id);
    commit('del-out');
    toast('出库已撤销，数量已回滚');
  } catch (e) { fail(e); }
}

function showCloseQuar(qtId) {
  const rec = (state.quarantines ?? []).find((q) => q.id === qtId);
  if (!rec) return;
  openModal(`隔离销案 · ${rec.drugName}`, `
    <p class="fine" style="margin-top:0">批号 ${rec.batchNo} × ${rec.qty}（${rec.dateISO} 隔离）——不合格药品的去向要有下文：销毁或退货，留痕才算闭环。</p>
    <div class="form-grid">
      <label>处置日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label>处置结论<select id="m-action">
        <option value="destroy">已报损销毁</option>
        <option value="return">已退回供应商</option>
        <option value="other">其他处置</option>
      </select></label>
      <label class="span2">凭证与说明<input id="m-note" placeholder="如：销毁记录照片存档 / 退货随货同行单号（可空）" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      resolveQuarantine(state, qtId, {
        closedISO: modalVal('m-date') || todayISO(),
        action: document.getElementById('m-action')?.value || 'other',
        note: modalVal('m-note'),
      });
      closeModal();
      commit('close-quar', {});
      toast('隔离已销案——不合格药品去向可追溯');
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------
// 台账：温湿度 / 拒售 / 养护
// ---------------------------------------------------------------------------

function addReadingAction() {
  const tempC = num('tp-temp');
  const rhPct = num('tp-rh');
  const cool = document.getElementById('tp-cool')?.value;
  const cold = document.getElementById('tp-cold')?.value;
  try {
    const rec = addReading(state, {
      dateISO: val('tp-date') || todayISO(),
      slot: document.getElementById('tp-slot')?.value || 'am',
      tempC,
      rhPct,
      coolTempC: cool === '' ? null : Number(cool),
      coldTempC: cold === '' ? null : Number(cold),
      note: val('tp-note'),
    });
    commit('add-reading', { exceeded: rec.exceeded });
    toast(rec.exceeded ? '已记录——本笔超限，记得写处置并复测' : '已记录，正常');
  } catch (e) { fail(e); }
}

function showHandleReading(id) {
  const rec = (state.readings ?? []).find((r) => r.id === id);
  if (!rec) return;
  openModal(`异常处置 · ${rec.dateISO}${rec.slot === 'am' ? '上午' : '下午'}`, `
    <p class="fine" style="margin-top:0">场所 ${rec.tempC}℃ / 湿度 ${rec.rhPct}%${rec.flags.cool ? ` · 阴凉柜 ${rec.coolTempC}℃` : ''}${rec.flags.cold ? ` · 冷藏柜 ${rec.coldTempC}℃` : ''}——超限不可怕，写明处置措施并复测才是合规。</p>
    <div class="form-grid">
      <label>处置日期<input id="m-date" type="date" value="${todayISO()}" /></label>
      <label class="span2">处置措施 *<input id="m-measure" placeholder="如：开启空调降温，半小时后复测 27℃ 正常" /></label>
    </div>`);
  openModal._confirm = () => {
    try {
      handleReading(state, id, {
        handledISO: modalVal('m-date') || todayISO(),
        measure: modalVal('m-measure'),
      });
      closeModal();
      commit('handle-reading', {});
      toast('异常已处置销案');
    } catch (e) { fail(e); }
  };
}

function delReading(id) {
  try {
    removeReading(state, id);
    commit('del-reading');
    toast('已删除该笔记录');
  } catch (e) { fail(e); }
}

function addRefusalAction() {
  try {
    addRefusal(state, {
      dateISO: val('rf-date') || todayISO(),
      customer: val('rf-customer'),
      drugName: val('rf-drug'),
      reason: document.getElementById('rf-reason')?.value || 'other',
      note: val('rf-note'),
    });
    commit('add-refusal', {});
    toast('拒售已登记——这就是你没被罚的证据');
  } catch (e) { fail(e); }
}

function addCareAction() {
  const found = num('cr-found');
  try {
    addCare(state, {
      dateISO: val('cr-date') || todayISO(),
      found: Number.isInteger(found) ? found : NaN,
      measure: val('cr-measure'),
      note: val('cr-note'),
    });
    commit('add-care', {});
    toast('养护已登记——周期自动滚动');
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检包 / 催销单）
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
    downloadFile(`药店迎检自证包_${todayISO()}.html`, html, 'text/html');
    toast('已下载——检查来了直接打开打印');
  } else {
    printHtml(html);
  }
  saveState(state);
}

function clearanceAction() {
  const html = clearanceHtml(state, todayISO(), state.settings ?? {});
  track(state, 'clearance', {});
  downloadFile(`近效期催销处置单_${todayISO()}.html`, html, 'text/html');
  toast('催销单已下载——打印贴柜台照单执行');
  saveState(state);
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
    toast('已复制——去微信粘贴存档或发督导群');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴存档或发督导群');
  }
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function saveSettings() {
  const n = (id, min, max, fallback) => {
    const v = num(id);
    return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  };
  state.settings = {
    warnDays: n('set-warn', 30, 365, DEFAULT_WARN_DAYS),
    redDays: n('set-red', 7, 365, DEFAULT_RED_DAYS),
    careDays: n('set-care', 7, 180, DEFAULT_CARE_DAYS),
    gapDays: n('set-gap', 1, 7, DEFAULT_GAP_DAYS),
    normalMin: n('set-nmin', -20, 40, 10),
    normalMax: n('set-nmax', 0, 60, 30),
    rhMin: n('set-rmin', 0, 100, 35),
    rhMax: n('set-rmax', 0, 100, 75),
    coolMax: n('set-coolmax', 0, 40, 20),
    coldMin: n('set-coldmin', -20, 20, 2),
    coldMax: n('set-coldmax', 0, 30, 8),
  };
  commit('save-settings');
  toast('参数已保存——限值与两道线已按你的口径重算');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`药清账备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`药清账使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
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

function isoAgo(today, days) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function seedDemo() {
  const today = todayISO();
  state.pharmacy = {
    name: '杏林堂大药房（示例）', licenseNo: '陇DA0123（示例）', licenseExpiryISO: isoAgo(today, -640),
    manager: '王秀兰', phone: '13800005678', address: 'XX 市文昌路 88 号',
    pharmacistName: '李芳芳', pharmacistRegNo: 'CC1101（示例）', pharmacistRegExpiryISO: isoAgo(today, -120),
  };
  state.drugs = []; state.drugSeq = 0;
  state.batches = []; state.batchSeq = 0;
  state.outs = []; state.outSeq = 0;
  state.quarantines = []; state.quarSeq = 0;
  state.readings = []; state.readingSeq = 0;
  state.refusals = []; state.refusalSeq = 0;
  state.cares = []; state.careSeq = 0;
  state.duties = [];

  // 药品建档：储藏分类照说明书抄
  const D = (name, spec, storage, approvalNo, maker) => addDrug(state, { name, spec, storage, approvalNo, manufacturer: maker });
  const amox = D('阿莫西林胶囊', '0.25g×24粒', 'normal', '国药准字H00000001（示例）', '华南制药（示例）');
  const insulin = D('胰岛素注射液', '300IU/3ml', 'cold', '国药准字S00000002（示例）', '北方生物（示例）');
  const aspirin = D('阿司匹林肠溶片', '100mg×30片', 'cool', '国药准字H00000003（示例）', '江南制药（示例）');
  const oint = D('红霉素软膏', '1%×20g', 'normal', '国药准字H00000004（示例）', '华南制药（示例）');
  const granule = D('感冒灵颗粒', '10g×9袋', 'normal', '国药准字Z00000005（示例）', '岭南中药（示例）');

  // 进货建批：一盒过期在架（最重红灯）+ 两批红线 + 一批催销
  addBatch(state, { drugId: amox.id, batchNo: 'B240817', expiryISO: isoAgo(today, 18), qty: 5, location: '货架 A2' });
  const ointBatch = addBatch(state, { drugId: oint.id, batchNo: 'B260112', expiryISO: isoAgo(today, -260), qty: 8, location: '货架 B1' });
  addBatch(state, { drugId: aspirin.id, batchNo: 'B260301', expiryISO: isoAgo(today, -48), qty: 8, location: '阴凉柜' });
  addBatch(state, { drugId: granule.id, batchNo: 'B260510', expiryISO: isoAgo(today, -150), qty: 12, location: '货架 C3' });
  addBatch(state, { drugId: insulin.id, batchNo: 'B260701', expiryISO: isoAgo(today, -210), qty: 6, location: '冷藏柜' });
  addBatch(state, { drugId: amox.id, batchNo: 'B260910', expiryISO: isoAgo(today, -400), qty: 20, location: '货架 A2' });

  // 出库与隔离：10 天前两盒软膏下架隔离（待处置——检查现场第一问）
  outBatch(state, ointBatch.id, {
    dateISO: isoAgo(today, 10), qty: 2, way: 'quarantine',
    note: '外包装挤压变形，标签污损无法辨认',
  });

  // 温湿度：今天上午正常；昨天上午正常（下午漏录）；前天下午超温未处置
  addReading(state, { dateISO: today, slot: 'am', tempC: 26, rhPct: 60, coolTempC: 18.5, coldTempC: 5.2, note: '晴，客流平稳' });
  addReading(state, { dateISO: isoAgo(today, 1), slot: 'am', tempC: 25.5, rhPct: 58 });
  addReading(state, { dateISO: isoAgo(today, 2), slot: 'am', tempC: 25, rhPct: 56 });
  addReading(state, { dateISO: isoAgo(today, 2), slot: 'pm', tempC: 34.5, rhPct: 78, coldTempC: 9.1, note: '午后高温，冷藏柜门未关严' });

  // 拒售：一笔无处方索购，一笔买赠要求
  addRefusal(state, {
    dateISO: isoAgo(today, 1), customer: '刘先生', drugName: '头孢克肟', reason: 'no-rx',
    note: '无处方，已引导持处方再来，必要时建议就医',
  });
  addRefusal(state, {
    dateISO: isoAgo(today, 6), customer: '尾号3308', drugName: '阿莫西林胶囊', reason: 'gift',
    note: '要求买感冒灵送消炎药，已告知处方药不得赠送',
  });

  // 养护：45 天前一次（30 天周期 → 逾期 15 天黄灯）
  addCare(state, { dateISO: isoAgo(today, 45), found: 1, measure: '1 盒近效期乳膏下架隔离', note: '重点检查了拆零柜与阴凉柜' });

  // 周期义务：体检在期、校准逾期、培训在期
  setDutyDone(state, 'health', isoAgo(today, 300), '全员 3 人体检，档案已归');
  setDutyDone(state, 'calib', isoAgo(today, 400), '温湿度计送检校准');
  setDutyDone(state, 'training', isoAgo(today, 30), '新员工的处方药销售制度培训');

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
    case 'save-pharmacy': savePharmacy(); break;
    case 'set-duty': setDuty(); break;
    case 'add-drug': addDrugAction(); break;
    case 'del-drug': delDrug(idx); break;
    case 'add-batch': addBatchAction(); break;
    case 'show-out': showOut(idx); break;
    case 'del-out': delOut(idx); break;
    case 'show-close-quar': showCloseQuar(idx); break;
    case 'add-reading': addReadingAction(); break;
    case 'show-handle-reading': showHandleReading(idx); break;
    case 'del-reading': delReading(idx); break;
    case 'add-refusal': addRefusalAction(); break;
    case 'add-care': addCareAction(); break;
    case 'rep-apply': repApply(); break;
    case 'rep-copy': repCopy(); break;
    case 'inspect-download': inspectAction('download'); break;
    case 'inspect-print': inspectAction('print'); break;
    case 'clearance-download': clearanceAction(); break;
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
