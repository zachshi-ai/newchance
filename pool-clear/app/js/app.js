/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid,
} from './store.js';
import {
  todayISO, monthKey, addDays, addRecord, removeRecord, openAnomalies, activePools,
  dailyText, publicHtml, auditHtml, validateLimits,
  exportBundle, importBundle, SLOTS, POOL_KINDS, DISINFECT_KINDS,
} from './core.js';
import {
  viewBoard, viewCheckin, viewOutputs, viewLedger, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let ckPool = null;              // 打卡页选中的水池
let outSel = { date: null, from: null, to: null }; // 公示页参数
let ledMonth = null;            // 台账页月份

const NAV = [
  ['#/board', '今日'], ['#/checkin', '打卡'], ['#/outputs', '公示'], ['#/ledger', '台账'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'checkin': html = viewCheckin(state, ckPool); break;
    case 'outputs': html = viewOutputs(state, outSel); break;
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

function numOrNull(id) {
  const raw = val(id);
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

// ---------------------------------------------------------------------------
// 场馆与水池
// ---------------------------------------------------------------------------

function saveVenue() {
  state.venue = {
    name: val('vn-name'),
    licenseNo: val('vn-license'),
    licenseExpiry: val('vn-expiry'),
    address: val('vn-address'),
    phone: val('vn-phone'),
  };
  commit('save-venue');
  toast('场馆已保存——台账与公示页落款生效');
}

function addPool() {
  const name = val('pool-name');
  if (!name) { toast('请填写水池名称'); return; }
  const kind = document.getElementById('pool-kind')?.value || 'main';
  const pool = {
    id: `p-${uid().slice(0, 8)}`,
    name,
    kind,
    disinfect: document.getElementById('pool-disinfect')?.value || 'other',
    since: val('pool-since') || todayISO(),
    active: true,
    createdAt: new Date().toISOString(),
  };
  state.pools.push(pool);
  commit('add-pool', { kind });
  toast(`「${name}」已建档——浸脚池只测余氯，其余池余氯 + pH 必测`);
}

function poolAction(action, poolId) {
  const pool = state.pools.find((p) => p.id === poolId);
  if (!pool) return;
  if (action === 'delist') {
    pool.active = false;
    commit('delist-pool');
    toast(`「${pool.name}」已停用——不再进应检口径，历史记录保留`);
  } else if (action === 'restore') {
    pool.active = true;
    commit('restore-pool');
    toast(`「${pool.name}」已恢复在用`);
  } else if (action === 'del') {
    if ((state.records ?? []).some((r) => r.poolId === poolId)) {
      toast('有检测记录的池不可删除（台账要完整），只能停用');
      return;
    }
    state.pools = state.pools.filter((p) => p.id !== poolId);
    commit('del-pool');
  }
}

// ---------------------------------------------------------------------------
// 检测打卡（判定、异常处置说明、复测闭环都在 core.addRecord 门禁里）
// ---------------------------------------------------------------------------

function doCheckin() {
  const poolId = document.getElementById('ck-pool')?.value ?? ckPool ?? state.pools[0]?.id;
  ckPool = poolId;
  const pool = state.pools.find((p) => p.id === poolId);
  if (!pool) { toast('请先在「设置」建水池'); return; }
  const residual = Number(val('ck-residual'));
  if (!Number.isFinite(residual)) { toast('余氯读数必填'); return; }
  const isFoot = pool.kind === 'footbath';
  const ph = numOrNull('ck-ph');
  if (!isFoot && !Number.isFinite(ph)) { toast('泳池的 pH 读数必填'); return; }
  const turbidity = numOrNull('ck-turb');
  const waterTemp = numOrNull('ck-temp');
  if (Number.isNaN(ph) || Number.isNaN(turbidity) || Number.isNaN(waterTemp)) {
    toast('读数必须是数字'); return;
  }
  const recheckOf = val('ck-recheck');
  try {
    const { record, evaluation } = addRecord(state, {
      id: `r-${uid().slice(0, 8)}`,
      poolId,
      dateISO: val('ck-date') || todayISO(),
      slot: document.getElementById('ck-slot')?.value || 'open',
      residual, ph, turbidity, waterTemp,
      opNote: val('ck-op'),
      action: val('ck-action'),
      recheckOf: recheckOf || null,
      createdAt: new Date().toISOString(),
    }, todayISO());
    track(state, 'checkin', {
      slot: record.slot,
      ok: evaluation.ok,
      closed: Boolean(recheckOf),
      footbath: isFoot,
    });
    commit('checkin');
    if (recheckOf) toast('✅ 复测达标，异常已闭环——台账恢复干净');
    else if (!evaluation.ok) toast('已落账，指标超线已登记——处置后记得复测闭环');
    else if (evaluation.soft.length) toast('已落账 ✅（水温出了「宜」区间，留意一下）');
    else toast('已落账 ✅ 达标');
  } catch (e) {
    fail(e);
  }
}

function delRecord(recordId) {
  try {
    const rec = removeRecord(state, recordId);
    commit('del-record');
    toast(`已删除 ${rec.dateISO} 的一笔记录`);
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 证照台账（健康证 / 第三方检测报告）
// ---------------------------------------------------------------------------

function addCert() {
  const name = val('cert-name');
  const expiry = val('cert-expiry');
  if (!name || !expiry) { toast('姓名与有效期必填'); return; }
  state.certs.push({ id: `c-${uid().slice(0, 8)}`, name, role: val('cert-role'), expiry });
  commit('add-cert');
  toast('健康证已登记，临期 30 天自动预警');
}

function delCert(id) {
  state.certs = state.certs.filter((c) => c.id !== id);
  commit('del-cert');
}

function addReport() {
  const org = val('rep-org');
  if (!org) { toast('检测机构必填'); return; }
  state.reports.push({
    id: `t-${uid().slice(0, 8)}`,
    org,
    reportISO: val('rep-date') || todayISO(),
    nextDue: val('rep-next'),
    note: val('rep-note'),
  });
  commit('add-report');
  toast('检测报告已登记，到期自动预警');
}

function delReport(id) {
  state.reports = state.reports.filter((t) => t.id !== id);
  commit('del-report');
}

// ---------------------------------------------------------------------------
// 参数与数据
// ---------------------------------------------------------------------------

function saveParams() {
  try {
    const limits = validateLimits({
      residual: [Number(val('lim-res-min')), Number(val('lim-res-max'))],
      ph: [Number(val('lim-ph-min')), Number(val('lim-ph-max'))],
      turbidityMax: Number(val('lim-turb')),
      waterTemp: [Number(val('lim-temp-min')), Number(val('lim-temp-max'))],
      foot: [Number(val('lim-foot-min')), Number(val('lim-foot-max'))],
    });
    const daily = Number(val('set-daily'));
    const warn = Number(val('set-warn'));
    state.settings = {
      limits,
      dailyRequired: Number.isInteger(daily) && daily >= 1 && daily <= 4 ? daily : 2,
      warnDays: Number.isInteger(warn) && warn >= 7 && warn <= 90 ? warn : 30,
    };
    commit('save-params');
    toast('口径已保存——你的台账你定');
  } catch (e) {
    fail(e);
  }
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`泳清单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`泳清单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...loadState(), ...res.state };
      ckPool = null;
      outSel = { date: null, from: null, to: null };
      ledMonth = null;
      commit('import');
      toast('导入成功');
    };
    reader.readAsText(file);
  }
}

// ---------------------------------------------------------------------------
// 三通道出证
// ---------------------------------------------------------------------------

function outputsAction(action) {
  outSel.date = document.getElementById('out-date')?.value || outSel.date || todayISO();
  if (action === 'copy') {
    try {
      copyText(dailyText(state, outSel.date));
      track(state, 'output', { channel: 'text', missing: activePools(state).length });
      saveState(state);
    } catch (e) { fail(e); }
  } else if (action === 'pub-download' || action === 'pub-print') {
    try {
      const html = publicHtml(state, outSel.date);
      track(state, 'output', { channel: action === 'pub-print' ? 'print' : 'html', kind: 'public' });
      if (action === 'pub-download') {
        downloadFile(`水质公示页_${state.venue?.name || ''}_${outSel.date}.html`, html, 'text/html');
        toast('公示页已下载——发家长群或打印贴公示栏');
      } else {
        printHtml(html);
      }
      saveState(state);
    } catch (e) { fail(e); }
  } else if (action === 'audit-download' || action === 'audit-print') {
    outSel.from = document.getElementById('audit-from')?.value || outSel.from || addDays(todayISO(), -30);
    outSel.to = document.getElementById('audit-to')?.value || outSel.to || todayISO();
    try {
      const html = auditHtml(state, outSel.from, outSel.to, todayISO());
      track(state, 'output', { channel: action === 'audit-print' ? 'print' : 'html', kind: 'audit' });
      if (action === 'audit-download') {
        downloadFile(`水质检测台账_${outSel.from}_${outSel.to}.html`, html, 'text/html');
        toast('台账包已下载——打印装订就是迎检档案');
      } else {
        printHtml(html);
      }
      saveState(state);
    } catch (e) { fail(e); }
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
    toast('已复制——去微信粘贴到家长群');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴到家长群');
  }
}

// ---------------------------------------------------------------------------
// 示例数据（30 秒体验完整流程）
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  const at = (daysAgo, hh, mm) => {
    const d = new Date(`${addDays(today, -daysAgo)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  };
  state.venue = {
    name: '清波游泳馆',
    licenseNo: '粤卫公证字〔2024〕第0385号',
    licenseExpiry: addDays(today, 640),
    address: '示例市清波路 12 号',
    phone: '13800001234',
  };
  const main = {
    id: 'p-main0001', name: '25m 主池', kind: 'main', disinfect: 'dosing',
    since: addDays(today, -400), active: true, createdAt: at(400, 9, 0),
  };
  const kids = {
    id: 'p-kids0001', name: '儿童池', kind: 'kids', disinfect: 'chlorine',
    since: addDays(today, -380), active: true, createdAt: at(380, 9, 0),
  };
  const foot = {
    id: 'p-foot0001', name: '入口浸脚池', kind: 'footbath', disinfect: 'chlorine',
    since: addDays(today, -400), active: true, createdAt: at(400, 9, 0),
  };
  state.pools = [main, kids, foot];

  const rec = (over) => ({
    id: `r-${uid().slice(0, 8)}`,
    opNote: '',
    ...over,
  });
  state.records = [];
  // 近 8 天的常规记录：主池/儿童池每日两检、浸脚池每日一检，达标为主
  for (let d = 9; d >= 2; d -= 1) {
    const date = addDays(today, -d);
    state.records.push(rec({ poolId: main.id, dateISO: date, slot: 'open', residual: 0.5, ph: 7.4, turbidity: 0.4, waterTemp: 27, createdAt: at(d, 7, 40) }));
    state.records.push(rec({ poolId: main.id, dateISO: date, slot: 'mid', residual: 0.6, ph: 7.5, turbidity: 0.3, waterTemp: 28, createdAt: at(d, 14, 20) }));
    state.records.push(rec({ poolId: kids.id, dateISO: date, slot: 'open', residual: 0.5, ph: 7.3, waterTemp: 29, createdAt: at(d, 7, 50) }));
    state.records.push(rec({ poolId: kids.id, dateISO: date, slot: 'mid', residual: 0.4, ph: 7.4, waterTemp: 30, createdAt: at(d, 15, 0) }));
    state.records.push(rec({ poolId: foot.id, dateISO: date, slot: 'open', residual: 6, createdAt: at(d, 7, 55) }));
  }
  // 昨天：儿童池开放前首检余氯偏低 → 白天处置 → 闭馆前复测达标闭环
  const yd = addDays(today, -1);
  const anomaly = rec({
    poolId: kids.id, dateISO: yd, slot: 'open', residual: 0.2, ph: 7.4, waterTemp: 29,
    createdAt: at(1, 7, 50), anomaly: { action: '余氯偏低：投二氯异氰尿酸钠 150g，闭馆前复测' },
  });
  const recheck = rec({
    poolId: kids.id, dateISO: yd, slot: 'extra', residual: 0.6, ph: 7.4, waterTemp: 29,
    createdAt: at(1, 19, 30), recheckOf: anomaly.id,
  });
  anomaly.anomaly.closedBy = recheck.id;
  anomaly.anomaly.closedAt = recheck.createdAt;
  state.records.push(
    rec({ poolId: main.id, dateISO: yd, slot: 'open', residual: 0.6, ph: 7.4, turbidity: 0.4, waterTemp: 27, createdAt: at(1, 7, 40) }),
    rec({ poolId: main.id, dateISO: yd, slot: 'mid', residual: 0.6, ph: 7.5, turbidity: 0.3, waterTemp: 28, createdAt: at(1, 14, 20) }),
    anomaly,
    rec({ poolId: kids.id, dateISO: yd, slot: 'mid', residual: 0.4, ph: 7.4, waterTemp: 30, createdAt: at(1, 15, 0) }),
    rec({ poolId: foot.id, dateISO: yd, slot: 'open', residual: 6, createdAt: at(1, 7, 55) }),
    recheck,
  );
  // 今天：主池已首检达标，儿童池未检（演示「今日未检」点名），浸脚池偏高待处置。
  // 今天的 createdAt 用真实时钟（稍早几分钟）——示例数据不许伪造未来的检测时间
  const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
  state.records.push(rec({ poolId: main.id, dateISO: today, slot: 'open', residual: 0.7, ph: 7.5, turbidity: 0.3, waterTemp: 27, opNote: '夜间自动投药正常', createdAt: minsAgo(12) }));
  state.records.push(rec({
    poolId: foot.id, dateISO: today, slot: 'open', residual: 11,
    createdAt: minsAgo(8), anomaly: { action: '浸脚池余氯偏高：兑水稀释并补新水，10 点复测' },
  }));

  state.certs = [
    { id: 'c-demo001', name: '陈救生', role: '救生员', expiry: addDays(today, 210) },
    { id: 'c-demo002', name: '李教练', role: '游泳教练', expiry: addDays(today, 18) },
    { id: 'c-demo003', name: '王前台', role: '前台', expiry: addDays(today, 300) },
  ];
  state.reports = [
    { id: 't-demo001', org: 'XX 检测认证集团', reportISO: addDays(today, -60), nextDue: addDays(today, 120), note: '全项检测（含尿素/菌落/大肠）报告编号 CMA-2607-0385' },
  ];
  state.settings = {
    limits: validateLimits({}),
    dailyRequired: 2,
    warnDays: 30,
  };

  ckPool = null;
  outSel = { date: null, from: null, to: null };
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
    case 'save-venue': saveVenue(); break;
    case 'add-pool': addPool(); break;
    case 'delist-pool': poolAction('delist', idx); break;
    case 'restore-pool': poolAction('restore', idx); break;
    case 'del-pool': poolAction('del', idx); break;
    case 'ck-apply': {
      ckPool = document.getElementById('ck-pool')?.value ?? ckPool;
      render();
      break;
    }
    case 'checkin': doCheckin(); break;
    case 'del-record': delRecord(idx); break;
    case 'add-cert': addCert(); break;
    case 'del-cert': delCert(idx); break;
    case 'add-report': addReport(); break;
    case 'del-report': delReport(idx); break;
    case 'save-params': saveParams(); break;
    case 'out-apply': {
      outSel.date = document.getElementById('out-date')?.value || outSel.date;
      render();
      break;
    }
    case 'out-copy': outputsAction('copy'); break;
    case 'pub-download': outputsAction('pub-download'); break;
    case 'pub-print': outputsAction('pub-print'); break;
    case 'audit-download': outputsAction('audit-download'); break;
    case 'audit-print': outputsAction('audit-print'); break;
    case 'led-apply': {
      ledMonth = document.getElementById('led-month')?.value || ledMonth;
      render();
      break;
    }
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
