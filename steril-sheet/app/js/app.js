/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, monthKey, addDays, assertISO,
  WRAP_TYPES, makePack, makeBatchNo, assertBatch, batchState,
  recordUsage, removeUsage, updateBio, closeRecall, registerTreatment,
  traceFor, traceText, traceHtml, inspectionText, inspectionHtml,
  exportBundle, importBundle, MACHINE_KINDS,
} from './core.js';
import {
  viewBoard, viewSteril, viewCabinet, viewCerts, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let certTab = 'trace';      // 出证页签：trace | inspect
let tracePatient = '';      // 追溯单当前患者标识
let traceCache = null;      // { patientRef, text }（生成后供复制/下载/打印）
let inspectMonth = null;    // 迎检包当前月份
let inspectCache = null;    // { month, html, text }

const NAV = [
  ['#/board', '今日'], ['#/steril', '灭菌'], ['#/cabinet', '无菌柜'], ['#/certs', '出证'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'steril': html = viewSteril(state); break;
    case 'cabinet': html = viewCabinet(state); break;
    case 'certs': html = viewCerts(state, certTab, tracePatient, inspectMonth); break;
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

function num(id) {
  const n = Number(val(id));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 目录动作（灭菌器 / 器械包）
// ---------------------------------------------------------------------------

function addMachine() {
  const name = val('mc-name');
  if (!name) { toast('请填写灭菌器名称'); return; }
  const machine = {
    id: `m-${uid().slice(0, 8)}`,
    name,
    code: (val('mc-code') || 'M').toUpperCase().slice(0, 4),
    kind: document.getElementById('mc-kind')?.value || 'b',
    note: val('mc-note'),
  };
  state.machines.push(machine);
  commit('add-machine');
  toast(`灭菌器已登记，锅代码 ${machine.code}`);
}

function delMachine(id) {
  if (state.batches.some((b) => b.machineId === id)) {
    toast('该灭菌器已有锅次记录，是台账的一部分，不可删除'); return;
  }
  state.machines = state.machines.filter((m) => m.id !== id);
  commit('del-machine');
}

function addPack() {
  const name = val('pk-name');
  if (!name) { toast('请填写包名称'); return; }
  const wrap = document.getElementById('pk-wrap')?.value || 'pp';
  const shelfRaw = val('pk-shelf');
  try {
    const pack = makePack({
      id: `p-${uid().slice(0, 8)}`,
      name, items: val('pk-items'), wrap,
      shelfDays: shelfRaw === '' ? undefined : Number(shelfRaw),
    });
    state.packs.push(pack);
    commit('add-pack', { wrap });
    toast(`「${pack.name}」已建档，默认效期 ${pack.shelfDays} 天`);
  } catch (e) {
    fail(e);
  }
}

function togglePack(id) {
  const pack = state.packs.find((p) => p.id === id);
  if (!pack) return;
  pack.active = pack.active === false;
  commit('toggle-pack');
  toast(pack.active ? `「${pack.name}」已启用` : `「${pack.name}」已停用（不再发放，历史保留）`);
}

// ---------------------------------------------------------------------------
// 灭菌落账 / 生物监测 / 召回
// ---------------------------------------------------------------------------

function addBatch() {
  const machineId = document.getElementById('bt-machine')?.value;
  if (!machineId) { toast('请先登记灭菌器'); return; }
  const loads = state.packs
    .filter((p) => p.active !== false)
    .map((p) => ({ packId: p.id, qty: Math.max(0, Math.floor(Number(val(`ld-${p.id}`)) || 0)) }))
    .filter((l) => l.qty > 0);
  try {
    const batch = assertBatch({
      id: `b-${uid().slice(0, 8)}`,
      machineId,
      dateISO: val('bt-date') || todayISO(),
      operator: val('bt-operator'),
      loads,
      chem: document.getElementById('bt-chem')?.value || 'pass',
      chemNote: val('bt-chemnote'),
      bd: document.getElementById('bt-bd')?.value || 'none',
      bio: document.getElementById('bt-bio')?.value || 'none',
    });
    batch.no = makeBatchNo(state.batches, state.machines.find((m) => m.id === machineId), batch.dateISO);
    state.batches.push(batch);
    track(state, 'add-batch', { packs: batch.loads.reduce((n, l) => n + l.qty, 0), bio: batch.bio, chem: batch.chem });
    commit();
    const st = batchState(batch);
    toast(st === 'recall-open'
      ? '已落账——生物阳性批次已冻结在库，去本页该批次生成已发放名单'
      : st === 'rejected'
        ? '已落账——化学不合格批次未放行，处置后在无菌柜复核'
        : `已落账 ${batch.no}——在库已按失效日排进无菌柜`);
  } catch (e) {
    fail(e);
  }
}

function saveBio(batchId) {
  try {
    const bio = document.getElementById(`bio-result-${batchId}`)?.value;
    const bioISO = val(`bio-date-${batchId}`) || todayISO();
    updateBio(state, batchId, { bio, bioISO });
    track(state, 'save-bio', { result: bio });
    commit();
    toast(bio === 'fail'
      ? '已记录阳性——批次冻结、名单可出，处置完在库后销案'
      : bio === 'pass' ? '已记录合格，监测周期顺延' : '已保持培养中');
  } catch (e) {
    fail(e);
  }
}

function doCloseRecall(batchId) {
  try {
    closeRecall(state, batchId, { note: val(`recall-note-${batchId}`) });
    track(state, 'close-recall', { batchId });
    commit();
    toast('召回已销案——处置经过已入账');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 无菌柜动作（发放 / 撤销 / 处置）
// ---------------------------------------------------------------------------

function addUsage() {
  const packId = document.getElementById('us-pack')?.value;
  const qty = Number(document.getElementById('us-qty')?.value || 1);
  try {
    const usage = recordUsage(state, {
      id: `u-${uid().slice(0, 8)}`,
      packId,
      qty,
      patientRef: val('us-patient'),
      operator: val('us-operator'),
      dateISO: val('us-date') || todayISO(),
    });
    track(state, 'add-usage', { patient: true, qty: usage.qty });
    commit();
    toast(`已发放 ${usage.qty} 包给 ${usage.patientRef}——追溯链接通（批次 ${usage.alloc.map((a) => a.no).join('、')}）`);
  } catch (e) {
    fail(e);
  }
}

function doRemoveUsage(usageId) {
  try {
    removeUsage(state, usageId);
    commit('del-usage');
    toast('已撤销发放，在库恢复');
  } catch (e) {
    fail(e);
  }
}

function addTreatment() {
  const target = val('tx-target');
  const [batchId, packId] = target.split('|');
  try {
    registerTreatment(state, {
      id: `t-${uid().slice(0, 8)}`,
      batchId,
      packId,
      qty: Number(val('tx-qty') || 1),
      action: document.getElementById('tx-action')?.value || 'discard',
      note: val('tx-note'),
      dateISO: todayISO(),
    });
    track(state, 'add-treatment', { action: document.getElementById('tx-action')?.value });
    commit();
    toast('处置已登记——账实守恒校验通过');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 出证三通道
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
    toast('已复制——去微信粘贴');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴');
  }
}

function generateTrace() {
  tracePatient = val('trace-patient');
  try {
    const entries = traceFor(state, tracePatient);
    traceCache = {
      patientRef: tracePatient,
      text: traceText({ clinic: state.clinic, patientRef: tracePatient, entries, todayISOStr: todayISO() }),
      html: traceHtml({ clinic: state.clinic, patientRef: tracePatient, entries, todayISOStr: todayISO() }),
    };
    track(state, 'trace', { found: entries.length });
    commit();
    toast(entries.length ? `已生成 ${entries.length} 次使用的追溯链` : '没有查到该标识的记录——请核对写法');
  } catch (e) {
    fail(e);
  }
}

function generateInspect() {
  inspectMonth = val('inspect-month') || monthKey(todayISO());
  try {
    inspectCache = {
      month: inspectMonth,
      text: inspectionText({ clinic: state.clinic, state, month: inspectMonth, todayISOStr: todayISO() }),
      html: inspectionHtml({ clinic: state.clinic, state, month: inspectMonth, todayISOStr: todayISO() }),
    };
    track(state, 'inspect', { month: inspectMonth });
    commit();
    toast(`${inspectMonth} 迎检包已生成`);
  } catch (e) {
    fail(e);
  }
}

function certAction(action) {
  if (action.startsWith('trace')) {
    if (!traceCache || traceCache.patientRef !== val('trace-patient')) generateTrace();
    if (!traceCache) return;
    if (action === 'trace-copy') { copyText(traceCache.text); track(state, 'trace', { action: 'copy' }); saveState(state); }
    else if (action === 'trace-download') {
      downloadFile(`器械灭菌追溯单_${traceCache.patientRef}_${todayISO()}.html`, traceCache.html, 'text/html');
      toast('已下载，可打印或微信发送');
      track(state, 'trace', { action: 'download' }); saveState(state);
    } else if (action === 'trace-print') { printHtml(traceCache.html); track(state, 'trace', { action: 'print' }); saveState(state); }
  } else {
    if (!inspectCache || inspectCache.month !== (val('inspect-month') || inspectMonth)) generateInspect();
    if (!inspectCache) return;
    if (action === 'inspect-download') {
      downloadFile(`灭菌与监测台账_${inspectCache.month}.html`, inspectCache.html, 'text/html');
      toast('已下载，监督所进门直接打');
      track(state, 'inspect', { action: 'download' }); saveState(state);
    } else if (action === 'inspect-print') { printHtml(inspectCache.html); track(state, 'inspect', { action: 'print' }); saveState(state); }
  }
}

// ---------------------------------------------------------------------------
// 设置动作
// ---------------------------------------------------------------------------

function saveClinic() {
  state.clinic = { name: val('cl-name'), phone: val('cl-phone') };
  commit('save-clinic');
  toast('已保存');
}

function saveSettings() {
  const read = (id, min, max, dflt) => {
    const n = Number(document.getElementById(id)?.value);
    return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
  };
  state.settings = {
    bioIntervalDays: read('set-bio', 1, 31, 7),
    bioGraceDays: read('set-grace', 1, 14, 3),
    wasteIntervalDays: read('set-waste', 1, 7, 2),
    expWarnDays: read('set-expwarn', 1, 60, 7),
  };
  commit('save-settings');
  toast('参数已保存');
}

function staffAction(action, id) {
  if (action === 'add') {
    const name = val('st-name');
    const validUntil = val('st-valid');
    if (!name || !validUntil) { toast('姓名与有效期都要填'); return; }
    try { assertISO(validUntil); } catch (e) { fail(e); return; }
    state.staff.push({ id: `s-${uid().slice(0, 8)}`, name, certValidUntil: validUntil });
    commit('add-staff');
    toast('已加入——到期前 30 天开始亮黄灯');
  } else if (action === 'del') {
    state.staff = state.staff.filter((s) => s.id !== id);
    commit('del-staff');
  }
}

function wasteAction(action, id) {
  if (action === 'add') {
    const dateISO = val('ws-date') || todayISO();
    const handler = val('ws-handler');
    if (!handler) { toast('请填写回收方'); return; }
    const weightRaw = num('ws-weight');
    state.wastes.push({
      id: `w-${uid().slice(0, 8)}`, dateISO, handler,
      weightKg: weightRaw !== null && weightRaw >= 0 ? weightRaw : null,
    });
    commit('add-waste');
    toast('交接已记——周期从此起算');
  } else if (action === 'del') {
    state.wastes = state.wastes.filter((w) => w.id !== id);
    commit('del-waste');
  }
}

function consumableAction(action, id) {
  if (action === 'add') {
    const name = val('cs-name');
    const validUntil = val('cs-valid');
    if (!name || !validUntil) { toast('名称与有效期都要填'); return; }
    try { assertISO(validUntil); } catch (e) { fail(e); return; }
    state.consumables.push({ id: `c-${uid().slice(0, 8)}`, name, validUntil });
    commit('add-consumable');
    toast('已加入效期清单');
  } else if (action === 'del') {
    state.consumables = state.consumables.filter((c) => c.id !== id);
    commit('del-consumable');
  }
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`灭菌单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`灭菌单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      certTab = 'trace'; tracePatient = ''; traceCache = null; inspectMonth = null; inspectCache = null;
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
  state.clinic = { name: '向阳口腔诊所', phone: '0512-66667777' };
  const m1 = { id: 'm-m1', name: '卡式灭菌器', code: 'M1', kind: 'cart', note: '主要是牙科手机快灭菌' };
  const m2 = { id: 'm-m2', name: '台式B级灭菌器', code: 'M2', kind: 'b', note: '布巾包与器械盒' };
  state.machines = [m1, m2];

  const phone = makePack({ id: 'p-phone', name: '牙科手机', items: '高速手机×1', wrap: 'pp' });
  const exam = makePack({ id: 'p-exam', name: '检查包', items: '口镜/探针/镊子', wrap: 'pp' });
  const extract = makePack({ id: 'p-ext', name: '拔牙包', items: '挺子×2 钳×1', wrap: 'cloth' });
  state.packs = [phone, exam, extract];

  const d = (n) => addDays(today, n);
  const b1 = assertBatch({
    id: 'b-1', machineId: m2.id, dateISO: d(-21), operator: '王护士',
    loads: [{ packId: extract.id, qty: 2 }, { packId: exam.id, qty: 3 }],
    chem: 'pass', bd: 'pass', bio: 'pass', bioISO: d(-19),
  });
  b1.no = `${d(-21).replace(/-/g, '')}-M2-01`;
  const b2 = assertBatch({
    id: 'b-2', machineId: m1.id, dateISO: d(-14), operator: '王护士',
    loads: [{ packId: phone.id, qty: 4 }],
    chem: 'pass', bd: 'none', bio: 'pass', bioISO: d(-12),
  });
  b2.no = `${d(-14).replace(/-/g, '')}-M1-01`;
  const b3 = assertBatch({
    id: 'b-3', machineId: m2.id, dateISO: d(-8), operator: '刘医生',
    loads: [{ packId: extract.id, qty: 2 }],
    chem: 'pass', bd: 'pass', bio: 'pending',
  });
  b3.no = `${d(-8).replace(/-/g, '')}-M2-01`;
  const b4 = assertBatch({
    id: 'b-4', machineId: m1.id, dateISO: d(-2), operator: '王护士',
    loads: [{ packId: phone.id, qty: 5 }, { packId: exam.id, qty: 2 }],
    chem: 'pass', bd: 'none', bio: 'pending',
  });
  b4.no = `${d(-2).replace(/-/g, '')}-M1-01`;
  const b5 = assertBatch({
    id: 'b-5', machineId: m2.id, dateISO: d(-10), operator: '王护士',
    loads: [{ packId: exam.id, qty: 2 }],
    chem: 'pass', bd: 'none', bio: 'none',
  });
  b5.no = `${d(-10).replace(/-/g, '')}-M2-01`;
  state.batches = [b1, b2, b3, b4, b5];

  // 发放记录：陈* 两次、李* 一次（追溯链演示）；b2 曾生物阳性 → 召回已销案演示
  state.usages = [
    {
      id: 'u-1', packId: phone.id, qty: 1, patientRef: '陈*', operator: '刘医生', dateISO: d(-13), note: '',
      alloc: [{ batchId: b2.id, no: b2.no, packId: phone.id, qty: 1, expireISO: addDays(b2.dateISO, phone.shelfDays) }],
    },
    {
      id: 'u-2', packId: phone.id, qty: 1, patientRef: '陈*', operator: '刘医生', dateISO: d(-1), note: '',
      alloc: [{ batchId: b4.id, no: b4.no, packId: phone.id, qty: 1, expireISO: addDays(b4.dateISO, phone.shelfDays) }],
    },
    {
      id: 'u-3', packId: extract.id, qty: 1, patientRef: '李*', operator: '刘医生', dateISO: d(-5), note: '',
      alloc: [{ batchId: b1.id, no: b1.no, packId: extract.id, qty: 1, expireISO: addDays(b1.dateISO, extract.shelfDays) }],
    },
  ];
  state.treatments = [];
  state.staff = [
    { id: 's-1', name: '王护士', certValidUntil: d(120) },
    { id: 's-2', name: '刘医生', certValidUntil: d(20) },
  ];
  state.wastes = [{ id: 'w-1', dateISO: d(-1), handler: '绿源环保', weightKg: 2.4 }];
  state.consumables = [
    { id: 'c-1', name: '生物指示剂（嗜热脂肪杆菌）', validUntil: d(200) },
    { id: 'c-2', name: '包内化学指示卡', validUntil: d(45) },
  ];
  certTab = 'trace'; tracePatient = ''; traceCache = null; inspectMonth = null; inspectCache = null;
  commit('seed-demo');
  toast('示例数据已就位——今日看板、无菌柜、追溯单（搜「陈*」）都能点开看');
}

// ---------------------------------------------------------------------------
// 事件委托与启动
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, idx } = el.dataset;
  switch (action) {
    case 'save-clinic': saveClinic(); break;
    case 'add-machine': addMachine(); break;
    case 'del-machine': delMachine(idx); break;
    case 'add-pack': addPack(); break;
    case 'toggle-pack': togglePack(idx); break;
    case 'add-batch': addBatch(); break;
    case 'save-bio': saveBio(idx); break;
    case 'close-recall': doCloseRecall(idx); break;
    case 'add-usage': addUsage(); break;
    case 'del-usage': doRemoveUsage(idx); break;
    case 'add-treatment': addTreatment(); break;
    case 'cert-tab': {
      certTab = idx;
      render();
      break;
    }
    case 'trace-generate': generateTrace(); break;
    case 'trace-copy': certAction('trace-copy'); break;
    case 'trace-download': certAction('trace-download'); break;
    case 'trace-print': certAction('trace-print'); break;
    case 'inspect-generate': generateInspect(); break;
    case 'inspect-download': certAction('inspect-download'); break;
    case 'inspect-print': certAction('inspect-print'); break;
    case 'add-staff': staffAction('add'); break;
    case 'del-staff': staffAction('del', idx); break;
    case 'add-waste': wasteAction('add'); break;
    case 'del-waste': wasteAction('del', idx); break;
    case 'add-consumable': consumableAction('add'); break;
    case 'del-consumable': consumableAction('del', idx); break;
    case 'save-settings': saveSettings(); break;
    case 'export-json': dataAction('export-json'); break;
    case 'export-events': dataAction('export-events'); break;
    case 'seed-demo': seedDemo(); break;
    default: break;
  }
});

// 追溯单输入框回车直接生成
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target?.id === 'trace-patient') generateTrace();
});

document.addEventListener('change', (ev) => {
  if (ev.target?.id === 'import-file') dataAction('import-json', ev.target.files?.[0]);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 离线增强失败不影响功能 */ });
}

window.addEventListener('hashchange', render);

render();
