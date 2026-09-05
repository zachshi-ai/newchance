/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState, newRiskBook,
} from './store.js';
import {
  todayISO, addDays, monthKey, setRisk, addRound, removeRound, coverageFor,
  addIncident, closeIncident, undoClose, discharge, undoDischarge,
  addCycle, markCycleDone, riskSummary,
  certText, certHtml, exportBundle, importBundle,
  RISK_FIELDS, SHIFTS,
} from './core.js';
import {
  viewBoard, viewResidents, viewRounds, viewIncidents, viewCycles, viewCert, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let certSel = null; // 自证包页用户选择的老人与时段（跨渲染保留）

const NAV = [
  ['#/board', '今日'], ['#/residents', '老人'], ['#/rounds', '值班'],
  ['#/incidents', '事件'], ['#/cycles', '周期'], ['#/cert', '自证包'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'residents': html = viewResidents(state); break;
    case 'rounds': html = viewRounds(state); break;
    case 'incidents': html = viewIncidents(state); break;
    case 'cycles': html = viewCycles(state); break;
    case 'cert': html = viewCert(state, certSel); break;
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
// 机构与设置
// ---------------------------------------------------------------------------

function saveHome() {
  const beds = Number(val('hm-beds'));
  state.home = {
    name: val('hm-name'),
    phone: val('hm-phone'),
    beds: Number.isInteger(beds) && beds > 0 ? beds : null,
  };
  commit('save-home');
  toast('已保存');
}

function saveSettings() {
  const enabled = Object.keys(SHIFTS).filter((k) => document.getElementById(`sf-shift-${k}`)?.checked);
  if (!enabled.length) { toast('至少启用一个班次'); return; }
  const num = (id, lo, hi, dft) => {
    const n = Number(val(id));
    return Number.isInteger(n) && n >= lo && n <= hi ? n : dft;
  };
  state.settings = {
    enabledShifts: enabled,
    nightMinTimes: num('sf-nightmin', 1, 12, 2),
    soonDays: num('sf-soon', 3, 180, 30),
    cyclePeriods: {
      ...state.settings.cyclePeriods,
      assess: num('sf-p-assess', 0, 1095, 180),
      drill: num('sf-p-drill', 0, 1095, 180),
      health: num('sf-p-health', 0, 1095, 365),
    },
  };
  commit('save-settings');
  toast('参数已保存——属地口径你说了算');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`护安单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`护安单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      certSel = null;
      commit('import');
      toast('导入成功');
    };
    reader.readAsText(file);
  }
}

// ---------------------------------------------------------------------------
// 老人建档与九防评估
// ---------------------------------------------------------------------------

function addResident() {
  const name = val('re-name');
  if (!name) { toast('请填写姓名'); return; }
  const admitISO = val('re-admit') || todayISO();
  const resident = {
    id: `p-${uid().slice(0, 8)}`,
    name,
    bed: val('re-bed'),
    careLevel: document.getElementById('re-level')?.value || 'self',
    admitISO,
    familyName: val('re-family'),
    familyPhone: val('re-phone'),
    note: val('re-note'),
    status: 'in',
    riskBook: newRiskBook(),
    createdAt: new Date().toISOString(),
  };
  state.residents.push(resident);
  commit('add-resident');
  toast('档案已建——九防评估是第一个动作，查完一项销一项');
}

function saveRisks(residentId) {
  const r = state.residents.find((x) => x.id === residentId);
  if (!r) return;
  try {
    for (const k of Object.keys(RISK_FIELDS)) {
      const level = document.getElementById(`rk-${residentId}-${k}`)?.value;
      const measures = document.getElementById(`rm-${residentId}-${k}`)?.value ?? '';
      if (level) setRisk(r.riskBook, k, level, measures); // watch/high 由 core 强校验措施非空
    }
    r.assessedISO = todayISO();
    const sum = riskSummary(r);
    commit('save-risks', { unset: sum.unset, high: sum.high });
    toast(sum.unset === 0
      ? (sum.high > 0 ? `九防已评完，高风险 ${sum.high} 项——重点看护名册见「今日」` : '九防已评完——评估结论会进自证包')
      : `已保存，还剩 ${sum.unset} 项「未评估」`);
  } catch (e) {
    fail(e);
  }
}

function delResident(residentId) {
  if (state.incidents.some((e) => e.residentId === residentId)) {
    toast('有事件记录的档案是历史账的一部分，不可删除');
    return;
  }
  state.residents = state.residents.filter((r) => r.id !== residentId);
  commit('del-resident');
}

function doDischarge(residentId) {
  try {
    discharge(state.residents, residentId, todayISO());
    commit('discharge');
    toast('已办离院（按今天）——档案与事件历史保留，出证不受影响');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 值班打卡
// ---------------------------------------------------------------------------

function quickRound(shift, status = 'ok') {
  const dateISO = todayISO();
  const payload = {
    dateISO,
    shift,
    staff: val(`q-staff-${shift}`),
    majors: val(`q-majors-${shift}`),
    status,
    abnormalNote: status === 'abnormal' ? val(`q-majors-${shift}`) : '',
    nightTimes: SHIFTS[shift].night ? Number(val(`q-night-${shift}`)) : null,
  };
  try {
    const { round, short } = addRound(state, payload);
    commit('quick-round', { shift, status });
    toast(short.level === 'short'
      ? `已打卡，但${short.note}——24 小时值班不是一句话`
      : (status === 'abnormal' ? '异常班次已落账，记得在「事件」里走闭环' : `${SHIFTS[shift].label}平安已落账，值班人 ${round.staff}`));
  } catch (e) {
    fail(e);
  }
}

function doAddRound() {
  const shift = document.getElementById('rd-shift')?.value;
  const abnormal = val('rd-abnormal');
  try {
    const { short } = addRound(state, {
      dateISO: val('rd-date') || todayISO(),
      shift,
      staff: val('rd-staff'),
      majors: val('rd-majors'),
      status: abnormal ? 'abnormal' : 'ok',
      abnormalNote: abnormal,
      nightTimes: SHIFTS[shift]?.night ? Number(val('rd-night')) : null,
    });
    commit('add-round', { shift, status: abnormal ? 'abnormal' : 'ok' });
    toast(short.level === 'short'
      ? `已打卡，但${short.note}`
      : (abnormal ? '异常班次已落账，记得在「事件」里走闭环' : '打卡已落账——每班一条，连续就是证据'));
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 事件闭环
// ---------------------------------------------------------------------------

function doAddIncident() {
  const residentId = document.getElementById('ie-resident')?.value;
  const hospital = document.getElementById('ie-hospital')?.value === 'yes';
  try {
    const ev = addIncident(state, {
      id: `i-${uid().slice(0, 8)}`,
      residentId,
      type: document.getElementById('ie-type')?.value || 'other',
      dateISO: val('ie-date') || todayISO(),
      desc: val('ie-desc'),
      firstAid: val('ie-aid'),
      sentToHospital: hospital,
    });
    commit('add-incident', { type: ev.type });
    toast('事件已登记——未闭环会一直点名，直到家属告知与复盘补完');
  } catch (e) {
    fail(e);
  }
}

function doCloseIncident(incidentId) {
  try {
    closeIncident(state, {
      id: incidentId,
      familyNotifiedAt: val(`ic-at-${incidentId}`),
      familyWay: document.getElementById(`ic-way-${incidentId}`)?.value ?? '',
      familyBy: val(`ic-by-${incidentId}`),
      reviewNote: val(`ic-review-${incidentId}`),
    });
    commit('close-incident');
    toast('已闭环：告知有痕、复盘有措——这本账现在是硬的了');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 周期义务
// ---------------------------------------------------------------------------

function doAddCycle() {
  try {
    addCycle(state, {
      id: `c-${uid().slice(0, 8)}`,
      kind: document.getElementById('cy-kind')?.value || 'other',
      owner: val('cy-owner'),
      dueISO: val('cy-due') || todayISO(),
      note: val('cy-note'),
    });
    commit('add-cycle');
    toast('已加入周期账——到期自动点名');
  } catch (e) {
    fail(e);
  }
}

function doCycleDone(cycleId) {
  try {
    const { nextDueISO } = markCycleDone(state, cycleId, todayISO());
    commit('cycle-done');
    toast(`已记完成，下一轮到期 ${nextDueISO}`);
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 自证包三通道
// ---------------------------------------------------------------------------

function certSelection() {
  certSel = {
    residentId: document.getElementById('cert-resident')?.value ?? certSel?.residentId ?? state.residents[0]?.id,
    fromISO: document.getElementById('cert-from')?.value || certSel?.fromISO || addDays(todayISO(), -29),
    toISO: document.getElementById('cert-to')?.value || certSel?.toISO || todayISO(),
  };
  return certSel;
}

function certAction(action) {
  const sel = certSelection();
  if (!sel.residentId) { toast('请先在「老人」页建档'); return; }
  track(state, 'cert', { action, residentId: sel.residentId, fromISO: sel.fromISO, toISO: sel.toISO });
  const common = { state, ...sel, todayISOStr: todayISO() };
  if (action === 'copy') {
    copyText(certText(common));
    saveState(state);
  } else if (action === 'download') {
    const r = state.residents.find((x) => x.id === sel.residentId);
    downloadFile(`照护安全自证包_${r?.name ?? ''}_${sel.fromISO}_${sel.toISO}.html`, certHtml(common), 'text/html');
    toast('已下载，可打印或微信发送');
    saveState(state);
  } else if (action === 'print') {
    printHtml(certHtml(common));
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
    toast('已复制——去微信粘贴给家属或检查人员');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴给家属或检查人员');
  }
}

// ---------------------------------------------------------------------------
// 示例数据（30 秒体验完整流程）
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  state.home = { name: '慈安养护院', phone: '13800001234', beds: 38 };

  const resident = (over = {}) => ({
    id: `p-${uid().slice(0, 8)}`,
    bed: '', careLevel: 'self', admitISO: today, familyName: '', familyPhone: '', note: '',
    status: 'in', riskBook: newRiskBook(), createdAt: new Date().toISOString(),
    ...over,
  });

  const zhou = resident({
    name: '周桂芳', bed: '302-1', careLevel: 'care', admitISO: addDays(today, -210),
    familyName: '周建国（儿子）', familyPhone: '13800001234', note: '高血压，慢病药由护理站代管',
    riskBook: (() => {
      const rb = newRiskBook();
      setRisk(rb, 'fall', 'high', '如厕/洗浴专人扶助，走廊加防滑垫，床边离床即查看');
      setRisk(rb, 'pressureUlcer', 'watch', '每 2 小时翻身，晨晚皮肤检查');
      setRisk(rb, 'chokes', 'watch', '糊化餐，喂食坐位、小口慢咽');
      setRisk(rb, 'scald', 'none');
      setRisk(rb, 'elope', 'none');
      setRisk(rb, 'misIntake', 'none');
      setRisk(rb, 'bedFall', 'none');
      setRisk(rb, 'hurt', 'none');
      setRisk(rb, 'activity', 'watch', '只参加低强度活动，专人陪同');
      return rb;
    })(),
    assessedISO: addDays(today, -3),
  });
  const wang = resident({
    name: '王守业', bed: '401-2', careLevel: 'special', admitISO: addDays(today, -95),
    familyName: '王丽（女儿）', familyPhone: '13900005678',
    riskBook: (() => {
      const rb = newRiskBook();
      setRisk(rb, 'pressureUlcer', 'high', '气垫床 + 每 2 小时翻身 + 晨晚皮肤交接');
      setRisk(rb, 'chokes', 'high', '鼻饲，翻身抬高床头 30 度');
      setRisk(rb, 'bedFall', 'watch', '双侧床栏，离床报警');
      setRisk(rb, 'fall', 'none');
      setRisk(rb, 'scald', 'none');
      setRisk(rb, 'elope', 'none');
      setRisk(rb, 'misIntake', 'watch', '药品全部代管，发药到口');
      setRisk(rb, 'hurt', 'none');
      setRisk(rb, 'activity', 'none');
      return rb;
    })(),
    assessedISO: addDays(today, -10),
  });
  const li = resident({
    name: '李淑芬', bed: '205-1', careLevel: 'assist', admitISO: today,
    familyName: '李强（儿子）', familyPhone: '13700009876', note: '今天新入住，还没来得及评估',
  });

  state.residents = [zhou, wang, li];

  // 值班：今天缺夜班（待打卡）；前天夜班夜巡不足；5 天前白班异常已留处置
  state.rounds = [
    { id: 'r-d0-day', dateISO: today, shift: 'day', staff: '李芳', majors: '302 周奶奶血压偏高已告知夜班；401 王爷爷鼻饲正常', todos: '', status: 'ok', createdAt: new Date().toISOString() },
    { id: 'r-d1-day', dateISO: addDays(today, -1), shift: 'day', staff: '张敏', majors: '全员平安，3 楼例行测量血压', todos: '', status: 'ok', createdAt: new Date().toISOString() },
    { id: 'r-d1-night', dateISO: addDays(today, -1), shift: 'night', staff: '赵国强', majors: '夜间平安，巡房均有人应答', todos: '', status: 'ok', nightTimes: 2, createdAt: new Date().toISOString() },
    { id: 'r-d2-day', dateISO: addDays(today, -2), shift: 'day', staff: '李芳', majors: '全员平安', todos: '', status: 'ok', createdAt: new Date().toISOString() },
    { id: 'r-d2-night', dateISO: addDays(today, -2), shift: 'night', staff: '钱进', majors: '201 门铃故障已报修', todos: '门铃明天跟物业催', status: 'ok', nightTimes: 1, shortNote: '夜巡 1 次，少于设定下限 2 次', createdAt: new Date().toISOString() },
    { id: 'r-d5-day', dateISO: addDays(today, -5), shift: 'day', staff: '张敏', majors: '', todos: '', status: 'abnormal', abnormalNote: '周桂芳如厕后滑坐于地，右髋触痛，就地制动后送医拍片无骨折，已通知家属', createdAt: new Date().toISOString() },
    { id: 'r-d5-night', dateISO: addDays(today, -5), shift: 'night', staff: '赵国强', majors: '夜间平安', todos: '', status: 'ok', nightTimes: 2, createdAt: new Date().toISOString() },
  ];

  // 事件：一起已闭环（跌倒，告知+复盘齐全）、一起未闭环（噎食疑似）
  state.incidents = [
    {
      id: 'i-demo-1', residentId: zhou.id, residentName: zhou.name, type: 'fall',
      dateISO: addDays(today, -5), desc: '如厕后滑坐于地，右髋部触痛，未碰撞头部',
      firstAid: '就地制动，11:20 送市二院拍片无骨折，晚间回院观察', sentToHospital: true,
      familyNotifiedAt: `${addDays(today, -5)} 11:35`, familyWay: '电话', familyBy: '院长 陈静',
      reviewNote: '卫生间加装扶手与防滑垫，全院如厕扶助流程再培训',
      status: 'closed', closedISO: addDays(today, -3), createdAt: new Date().toISOString(),
    },
    {
      id: 'i-demo-2', residentId: wang.id, residentName: wang.name, type: 'chokes',
      dateISO: addDays(today, -1), desc: '午间鼻饲后呛咳，血氧 92%，听诊肺内有杂音',
      firstAid: '暂停鼻饲，抬高床头 30 度，吸痰后缓解，16:00 通知家属择期送医复查',
      sentToHospital: false, status: 'open', createdAt: new Date().toISOString(),
    },
  ];

  // 周期义务：演练已逾期、王爷爷评估临期、体检正常
  state.cycles = [
    { id: 'c-demo-1', kind: 'drill', owner: '全员', dueISO: addDays(today, -12), note: '消防疏散+噎食急救联合演练', doneISO: null },
    { id: 'c-demo-2', kind: 'assess', owner: '王守业', dueISO: addDays(today, 18), note: '委托区评估机构上门', doneISO: null },
    { id: 'c-demo-3', kind: 'health', owner: '护理员李芳', dueISO: addDays(today, 120), note: '', doneISO: null },
  ];

  certSel = null;
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
    case 'save-home': saveHome(); break;
    case 'save-settings': saveSettings(); break;
    case 'add-resident': addResident(); break;
    case 'save-risks': saveRisks(idx); break;
    case 'discharge': doDischarge(idx); break;
    case 'undo-discharge': {
      undoDischarge(state.residents, idx);
      commit('undo-discharge');
      toast('已撤销离院');
      break;
    }
    case 'del-resident': delResident(idx); break;
    case 'quick-round': quickRound(idx, 'ok'); break;
    case 'quick-round-abnormal': quickRound(idx, 'abnormal'); break;
    case 'add-round': doAddRound(); break;
    case 'del-round': {
      try {
        removeRound(state, idx);
        commit('del-round');
        toast('已删除打卡记录');
      } catch (e) { fail(e); }
      break;
    }
    case 'add-incident': doAddIncident(); break;
    case 'close-incident': doCloseIncident(idx); break;
    case 'undo-close': {
      try {
        undoClose(state, idx);
        commit('undo-close');
        toast('已撤销闭环，事件回到未闭环点名');
      } catch (e) { fail(e); }
      break;
    }
    case 'add-cycle': doAddCycle(); break;
    case 'cycle-done': doCycleDone(idx); break;
    case 'cert-apply': {
      certSelection();
      render();
      break;
    }
    case 'cert-copy': certAction('copy'); break;
    case 'cert-download': certAction('download'); break;
    case 'cert-print': certAction('print'); break;
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
