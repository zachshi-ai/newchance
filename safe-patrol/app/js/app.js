/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, CHECK_ITEMS, HOTWORK_MEASURES, HOTWORK_KINDS, LICENSE_KINDS,
  submitCheck, registerHazard, fixHazard, closeHazard,
  issueHotwork, closeHotwork,
  addStaff, removeStaff, addLicense, removeLicense,
  addTraining, addDrill,
  exportBundle, importBundle, selfCheckText, selfCheckHtml,
} from './core.js';
import {
  viewBoard, viewHazards, viewHotwork, viewPeople, viewSheet, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let toastTimer = null;

const NAV = [
  ['#/board', '今日'], ['#/hazards', '隐患'], ['#/hotwork', '动火'],
  ['#/people', '人与证'], ['#/sheet', '迎检包'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return h.split('/')[0] || 'board';
}

export function render() {
  const path = parseHash();
  $nav.innerHTML = NAV.map(([href, label]) =>
    `<a href="${href}" class="${href.endsWith(path) ? 'active' : ''}">${label}</a>`).join('');
  const today = todayISO();
  switch (path) {
    case 'hazards': $view.innerHTML = viewHazards(state, today); break;
    case 'hotwork': $view.innerHTML = viewHotwork(state, today); break;
    case 'people': $view.innerHTML = viewPeople(state, today); break;
    case 'sheet': $view.innerHTML = viewSheet(state, today); break;
    case 'settings': $view.innerHTML = viewSettings(state); break;
    default: $view.innerHTML = viewBoard(state, today);
  }
  window.scrollTo(0, 0);
}

function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = `toast${isError ? ' error' : ''}`;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, isError ? 4200 : 2600);
}

function commit() {
  saveState(state);
  render();
}

function val(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// 示例数据（销售演示与培训用；覆盖红黄绿全状态）
// ---------------------------------------------------------------------------

function seedDemo() {
  const today = todayISO();
  const s = emptyState();
  s.org = { name: '明华五金制品厂', person: '陈厂长', phone: '13800001234', industry: 'metal', address: '××镇工业园 3 号' };
  s.staff = ['张三', '李四', '王五', '赵六'];
  addLicense(s, { id: 'lic-1', kind: 'weld', holderName: '张三', certNo: 'T3601***', expiryISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() + 400 * 86400000)) });
  addLicense(s, { id: 'lic-2', kind: 'weld', holderName: '李四', certNo: 'T3602***', expiryISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 20 * 86400000)) });
  addLicense(s, { id: 'lic-3', kind: 'elec', holderName: '王五', certNo: 'T3603***', expiryISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() + 25 * 86400000)) });
  addLicense(s, { id: 'lic-4', kind: 'forkliftCert', holderName: '赵六', certNo: 'N1***', expiryISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() + 600 * 86400000)) });
  addLicense(s, { id: 'lic-5', kind: 'forkliftInspect', holderName: '3 号叉车', certNo: 'J***', expiryISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 45 * 86400000)) });
  // 隐患：一条逾期未整改（红）、一条待复查、一条已闭环
  registerHazard(s, { id: 'hz-1', foundISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 12 * 86400000)), desc: '【自查】灭火器在位·压力正常：西区 2 具灭火器压力表指向红区', owner: '王五', area: '车间西区', source: 'checklist', dueISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 5 * 86400000)) });
  registerHazard(s, { id: 'hz-2', foundISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 6 * 86400000)), desc: '仓库堆垛与墙柱灯距合规：东侧堆垛贴墙，距不足 0.5 米', owner: '赵六', area: '仓库' });
  fixHazard(s, { id: 'hz-2', fixedISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 2 * 86400000)), fixNote: '已重新码垛并划线' });
  registerHazard(s, { id: 'hz-3', foundISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 30 * 86400000)), desc: '配电箱前无堆物：3 号配电箱前堆放纸箱', owner: '王五' });
  fixHazard(s, { id: 'hz-3', fixedISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 24 * 86400000)), fixNote: '当天清理完毕' });
  closeHazard(s, { id: 'hz-3', closedISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 23 * 86400000)), recheckNote: '复查通过，已拍照留档' });
  // 动火：一张今天未销票（张三有效焊工证）、一张上周已销票
  issueHotwork(s, {
    id: 'hw-1', dateISO: today, kind: 'weldCut', worker: '张三', workerLicenseId: 'lic-1',
    guardian: '李四', location: '车间东区平台', content: '更换传送带支架',
    measures: Object.fromEntries(HOTWORK_MEASURES.map((m) => [m.key, true])),
  });
  const closedPermit = issueHotwork(s, {
    id: 'hw-2', dateISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 7 * 86400000)), kind: 'weldCut', worker: '张三', workerLicenseId: 'lic-1',
    guardian: '王五', location: '仓库门口', content: '货架加固',
    measures: Object.fromEntries(HOTWORK_MEASURES.map((m) => [m.key, true])),
  });
  closeHotwork(s, { id: closedPermit.id, closedISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 7 * 86400000)), closedNote: '作业完毕，留守 30 分钟无异常' });
  // 自查：昨天全绿一次；今天的留给用户自己打
  const okItems = Object.fromEntries(Object.keys(CHECK_ITEMS).map((k) => [k, 'ok']));
  s.checks.push({ id: 'ck-demo', dateISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 1 * 86400000)), items: okItems, note: '例会交接后自查', createdAt: new Date().toISOString() });
  // 培训与演练：制造一条超期现场处置演练
  s.trainings.push({ id: 'tr-1', dateISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 60 * 86400000)), topic: '车间用电安全 + 灭火器实操', hours: 2, attendees: ['张三', '王五', '赵六'] });
  s.trainings.push({ id: 'tr-2', dateISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 200 * 86400000)), topic: '新员工三级安全教育', hours: 6, attendees: ['李四'] });
  s.drills.push({ id: 'dr-1', dateISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 210 * 86400000)), type: 'scene', topic: '初起火灾扑救与疏散', count: 8 });
  s.drills.push({ id: 'dr-2', dateISO: todayISO(new Date(new Date(`${today}T00:00:00Z`).getTime() - 120 * 86400000)), type: 'synth', topic: '年度综合预案演练', count: 12 });
  state = s;
  track(state, 'seed_demo');
  commit();
  toast('示例数据已载入：红黄绿全状态——先去「今日」看看今天做什么');
}

// ---------------------------------------------------------------------------
// 事件委托
// ---------------------------------------------------------------------------

document.addEventListener('submit', (e) => {
  const form = e.target;
  const id = form.id;
  e.preventDefault();

  if (id === 'org-form') {
    state.org = {
      ...state.org,
      name: val('org-name'), person: val('org-person'), phone: val('org-phone'),
      industry: val('org-industry'),
    };
    track(state, 'org_saved');
    commit();
    toast('厂档已保存');
    return;
  }

  if (id === 'settings-form') {
    const num = (v, fallback, min, max) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
    };
    const d = state.settings;
    state.settings = {
      licenseWarnDays: num(val('st-warn'), d.licenseWarnDays, 7, 180),
      checkDueDays: num(val('st-due'), d.checkDueDays, 1, 90),
      annualMinHours: num(val('st-hours'), d.annualMinHours, 1, 200),
      drillSynthDays: num(val('st-synth'), d.drillSynthDays, 30, 730),
      drillSceneDays: num(val('st-scene'), d.drillSceneDays, 30, 365),
    };
    track(state, 'settings_saved');
    commit();
    toast('参数已保存——属地规则与最新公告永远赢');
    return;
  }

  if (id === 'check-form') {
    const results = {};
    const descs = {};
    for (const key of Object.keys(CHECK_ITEMS)) {
      const picked = form.querySelector(`input[name="ck-${key}"]:checked`);
      if (!picked) continue;
      results[key] = picked.value;
      if (picked.value === 'issue') descs[key] = document.getElementById(`desc-${key}`)?.value?.trim() ?? '';
    }
    try {
      const { hazards } = submitCheck(state, {
        id: uid(), dateISO: todayISO(), results, issueDescs: descs, note: val('check-note'),
      });
      track(state, 'check_submit', { issues: hazards.length });
      commit();
      toast(hazards.length ? `自查已记录：${hazards.length} 条异常已进入隐患闭环` : '今日自查完成——台账又厚了一页');
    } catch (err) {
      track(state, 'check_rejected', { reason: String(err.message).slice(0, 80) });
      saveState(state);
      toast(err.message, true);
    }
    return;
  }

  if (id === 'hazard-form') {
    try {
      registerHazard(state, {
        id: uid(), foundISO: val('hz-found') || todayISO(), desc: val('hz-desc'),
        level: val('hz-level'), owner: val('hz-owner'), area: val('hz-area'),
        dueISO: val('hz-due') || undefined,
      });
      track(state, 'hazard_register');
      commit();
      toast('隐患已登记——期限到了没闭环会亮红灯');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (id === 'hotwork-form') {
    const measures = {};
    for (const m of HOTWORK_MEASURES) measures[m.key] = document.getElementById(`hm-${m.key}`)?.checked === true;
    try {
      const permit = issueHotwork(state, {
        id: uid(), dateISO: val('hw-date') || todayISO(), kind: val('hw-kind'),
        worker: val('hw-worker'), workerLicenseId: val('hw-license') || null,
        guardian: val('hw-guardian'), location: val('hw-location'), content: val('hw-content'),
        measures,
      });
      track(state, 'hotwork_issue', { kind: permit.kind });
      commit();
      toast(permit.warnings?.length ? `开票成功（${permit.warnings[0]}）` : '开票成功——完工记得销票');
    } catch (err) {
      track(state, 'hotwork_gate_blocked', { reason: String(err.message).slice(0, 80) });
      saveState(state);
      toast(err.message, true);
    }
    return;
  }

  if (id === 'staff-form') {
    try {
      addStaff(state, val('staff-name'));
      commit();
      toast('已加入名单');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (id === 'training-form') {
    const attendees = [...(document.getElementById('tr-attendees')?.selectedOptions ?? [])].map((o) => o.value);
    try {
      addTraining(state, {
        id: uid(), dateISO: val('tr-date') || todayISO(), topic: val('tr-topic'),
        hours: Number(val('tr-hours')), attendees,
      });
      track(state, 'training_add');
      commit();
      toast('培训已记录');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (id === 'drill-form') {
    try {
      addDrill(state, {
        id: uid(), dateISO: val('dr-date') || todayISO(), type: val('dr-type'),
        topic: val('dr-topic'), count: Number(val('dr-count')),
      });
      track(state, 'drill_add');
      commit();
      toast('演练已记录');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (id === 'license-form') {
    try {
      addLicense(state, {
        id: uid(), kind: val('lc-kind'), holderName: val('lc-holder'),
        certNo: val('lc-certno'), expiryISO: val('lc-expiry'),
      });
      track(state, 'license_add');
      commit();
      toast('证件已登记——到期前黄线亮灯');
    } catch (err) {
      toast(err.message, true);
    }
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'seed-demo') { seedDemo(); return; }

  if (action === 'wipe-all') {
    if (confirm('确定清空全部数据？此操作不可恢复（建议先导出备份）。')) {
      state = emptyState();
      commit();
      toast('已清空');
    }
    return;
  }

  if (action === 'export-json') {
    const blob = new Blob([exportBundle(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `safepatrol-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    track(state, 'export_json');
    saveState(state);
    toast('备份已导出');
    return;
  }

  if (action === 'hazard-fix') {
    const note = prompt('整改说明（必填——只打勾不留痕，台账等于没做）：');
    if (note === null) return;
    try {
      fixHazard(state, { id, fixNote: note.trim() });
      track(state, 'hazard_fix');
      commit();
      toast('已登记整改，待复查销案');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (action === 'hazard-close') {
    const note = prompt('复查记录（必填——隐患闭环的最后一步）：');
    if (note === null) return;
    try {
      closeHazard(state, { id, recheckNote: note.trim() });
      track(state, 'hazard_close');
      commit();
      toast('已销案——这条隐患闭环了');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (action === 'hotwork-close') {
    const note = prompt('销票备注（选填：现场清理与留守确认情况）：');
    if (note === null) return;
    try {
      closeHotwork(state, { id, closedNote: note.trim() });
      track(state, 'hotwork_close');
      commit();
      toast('已销票');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (action === 'staff-remove') {
    try {
      removeStaff(state, btn.dataset.name);
      commit();
      toast('已移出名单');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (action === 'license-remove') {
    try {
      removeLicense(state, id);
      commit();
      toast('证件已删除');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (action === 'sheet-copy-text') {
    const text = selfCheckText(state, todayISO());
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast('快报文本已复制——去微信粘贴即可'),
        () => toast('复制失败，请手动选择文本复制', true),
      );
    } else {
      toast('浏览器不支持自动复制，请手动选择文本', true);
    }
    track(state, 'sheet_copy');
    saveState(state);
    return;
  }

  if (action === 'sheet-download-html') {
    const blob = new Blob([selfCheckHtml(state, todayISO())], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `安全生产自查台账-${todayISO()}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    track(state, 'sheet_export_html');
    saveState(state);
    toast('打印版已下载（单文件，离线可用）');
    return;
  }

  if (action === 'sheet-print') {
    const w = window.open('', '_blank');
    if (!w) { toast('弹窗被拦截——请允许弹窗后重试', true); return; }
    w.document.write(selfCheckHtml(state, todayISO()));
    w.document.close();
    w.focus();
    w.print();
    track(state, 'sheet_print');
    saveState(state);
  }
});

document.addEventListener('change', (e) => {
  if (e.target?.dataset?.action === 'import-json') {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importBundle(String(reader.result));
      if (!r.ok) { toast(r.error, true); return; }
      state = { ...emptyState(), ...r.state };
      track(state, 'import_json');
      commit();
      toast('备份已导入');
    };
    reader.readAsText(file);
  }
});

window.addEventListener('hashchange', render);

// PWA（仅在 http(s) 下注册；file:// 直开时跳过）
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
