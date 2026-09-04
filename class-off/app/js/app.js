/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, addDays, monthKey, applySession, removeSession, complianceCheck,
  statementText, statementHtml, refundEstimate, refundText,
  exportBundle, importBundle,
} from './core.js';
import {
  viewBoard, viewStudents, viewSessions, viewStatement, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();
let stmtStudent = null; // 对账单页用户选择的学员（跨渲染保留）
let refundCache = null; // 最近一次退费试算 { studentId, studentName, text }

const NAV = [
  ['#/board', '今日'], ['#/students', '学员'], ['#/sessions', '消课'], ['#/statement', '对账单'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/board').replace(/^#\/?/, '');
  return { path: h.split('/')[0] || 'board' };
}

export function render() {
  const { path } = parseHash();
  let html = '';
  switch (path) {
    case 'students': html = viewStudents(state); break;
    case 'sessions': html = viewSessions(state); break;
    case 'statement': html = viewStatement(state, stmtStudent, refundCache); break;
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

// ---------------------------------------------------------------------------
// 档案动作（机构 / 教师 / 课程 / 学员）
// ---------------------------------------------------------------------------

function val(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

function saveOrg() {
  state.org = { name: val('org-name'), phone: val('org-phone') };
  commit('save-org');
  toast('已保存');
}

function addTeacher() {
  const name = val('tea-name');
  if (!name) { toast('请填写教师姓名'); return; }
  const fee = Number(document.getElementById('tea-fee')?.value);
  state.teachers.push({
    id: `t-${uid().slice(0, 8)}`,
    name,
    feeCents: Number.isFinite(fee) && fee >= 0 ? Math.round(fee * 100) : 10000,
  });
  commit('add-teacher', {});
  toast('教师已添加');
}

function addCourse() {
  const name = val('course-name');
  if (!name) { toast('请填写课程名称'); return; }
  state.courses.push({ id: `c-${uid().slice(0, 8)}`, name });
  commit('add-course', {});
  toast('课程已添加');
}

function addStudent() {
  const name = val('stu-name');
  if (!name) { toast('请填写学员姓名'); return; }
  state.students.push({
    id: `s-${uid().slice(0, 8)}`,
    name,
    phone: val('stu-phone'),
    note: val('stu-note'),
  });
  commit('add-student', {});
  toast('学员已添加');
}

// ---------------------------------------------------------------------------
// 课包动作（购课入账 + 合规体检）
// ---------------------------------------------------------------------------

function addPackage() {
  const studentId = document.getElementById('pkg-student')?.value;
  const courseId = document.getElementById('pkg-course')?.value;
  const kind = document.getElementById('pkg-kind')?.value || 'paid';
  const total = Number(document.getElementById('pkg-total')?.value);
  const priceYuan = Number(document.getElementById('pkg-price')?.value);
  const boughtISO = val('pkg-bought') || todayISO();
  const expireISO = val('pkg-expire') || null;
  if (!studentId || !courseId) { toast('请先建学员与课程'); return; }
  if (!Number.isInteger(total) || total < 1 || total > 200) { toast('课时数应为 1~200 的整数'); return; }
  if (!Number.isFinite(priceYuan) || priceYuan < 0) { toast('金额不合法'); return; }
  const pkg = {
    id: `p-${uid().slice(0, 8)}`,
    studentId, courseId, kind,
    total, used: 0,
    priceCents: kind === 'paid' ? Math.round(priceYuan * 100) : 0,
    boughtISO, expireISO, note: '',
  };
  const warnings = complianceCheck(state.packages, pkg);
  state.packages.push(pkg);
  commit('add-package', { kind, total });
  toast(warnings.length ? `已入账 · ⚠ ${warnings[0]}` : '课包已入账');
}

function delPackage(idx) {
  const pkg = state.packages[idx];
  if (!pkg) return;
  if (pkg.used > 0) { toast('该课包已有消课记录，不可删除（账实一致）；请线下按合同处理'); return; }
  state.packages.splice(idx, 1);
  commit('del-package');
}

// ---------------------------------------------------------------------------
// 消课动作
// ---------------------------------------------------------------------------

function addSession() {
  const dateISO = val('ses-date') || todayISO();
  const courseId = document.getElementById('ses-course')?.value;
  const teacherId = document.getElementById('ses-teacher')?.value;
  const studentIds = [...document.querySelectorAll('.ses-check:checked')].map((el) => el.value);
  const note = val('ses-note');
  if (!courseId || !teacherId) { toast('请先建课程与教师'); return; }
  try {
    const session = applySession(state, {
      id: `x-${uid().slice(0, 8)}`, dateISO, courseId, teacherId, studentIds, note,
    });
    commit('session', { students: session.allocations.length });
    toast(`已消课 ${session.allocations.length} 人次——账上少一节，心里少一债`);
  } catch (e) {
    fail(e);
  }
}

function undoSession(sessionId) {
  try {
    removeSession(state, sessionId);
    commit('undo-session', { sessionId });
    toast('已撤销并回滚课时');
  } catch (e) {
    fail(e);
  }
}

// ---------------------------------------------------------------------------
// 对账单与退费试算
// ---------------------------------------------------------------------------

function currentStudent() {
  stmtStudent = document.getElementById('stmt-student')?.value ?? stmtStudent ?? state.students[0]?.id;
  return stmtStudent;
}

function stmtAction(action) {
  const studentId = currentStudent();
  if (!studentId) { toast('请先添加学员'); return; }
  const common = { state, studentId, todayISOStr: todayISO() };
  track(state, 'statement', { action, studentId });
  const st = state.students.find((s) => s.id === studentId);
  if (action === 'copy') {
    copyText(statementText(common));
    saveState(state);
  } else {
    const html = statementHtml(common);
    if (action === 'download') {
      downloadFile(`课时对账单_${st?.name ?? studentId}_${todayISO()}.html`, html, 'text/html');
      toast('已下载，可打印或微信发送');
    } else {
      printHtml(html);
    }
    saveState(state);
  }
}

function estimateRefund() {
  const studentId = currentStudent();
  if (!studentId) { toast('请先添加学员'); return; }
  try {
    const st = state.students.find((s) => s.id === studentId);
    const estimate = refundEstimate(state.packages, studentId, state.students, state.courses);
    const text = refundText({
      studentName: st.name, estimate, orgName: state.org?.name ?? '', todayISOStr: todayISO(),
    });
    refundCache = { studentId, studentName: st.name, text };
    track(state, 'refund-estimate', { refundCents: estimate.refundCents });
    commit('refund-estimate');
    toast(`试算完成：应退 ${text.match(/试算应退：(.+)/)?.[1] ?? ''}`);
  } catch (e) {
    fail(e);
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
    toast('已复制——去微信粘贴给家长');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制——去微信粘贴给家长');
  }
}

// ---------------------------------------------------------------------------
// 设置动作
// ---------------------------------------------------------------------------

function saveSettings() {
  const low = Number(document.getElementById('set-low')?.value);
  const expwin = Number(document.getElementById('set-expwin')?.value);
  state.settings = {
    lowBalance: Number.isInteger(low) && low >= 0 && low <= 30 ? low : 3,
    expiryWindowDays: Number.isInteger(expwin) && expwin >= 1 && expwin <= 180 ? expwin : 30,
  };
  commit('save-settings');
  toast('参数已保存');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`消课单备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`消课单使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      stmtStudent = null;
      refundCache = null;
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
  state.org = { name: '小满舞蹈工作室', phone: '13800001234' };
  const teacherA = `t-${uid().slice(0, 8)}`;
  const teacherB = `t-${uid().slice(0, 8)}`;
  state.teachers = [
    { id: teacherA, name: '豆豆老师', feeCents: 12000 },
    { id: teacherB, name: '安然老师', feeCents: 10000 },
  ];
  const courseA = `c-${uid().slice(0, 8)}`; // 少儿中国舞
  const courseB = `c-${uid().slice(0, 8)}`; // 街舞启蒙
  state.courses = [
    { id: courseA, name: '少儿中国舞' },
    { id: courseB, name: '街舞启蒙' },
  ];
  const stuA = `s-${uid().slice(0, 8)}`; // 王小满
  const stuB = `s-${uid().slice(0, 8)}`; // 李多多
  const stuC = `s-${uid().slice(0, 8)}`; // 陈小满
  state.students = [
    { id: stuA, name: '王小满', phone: '13911112222', note: '周六 10 点班' },
    { id: stuB, name: '李多多', phone: '13933334444', note: '' },
    { id: stuC, name: '陈小满', phone: '13955556666', note: '多多的表妹' },
  ];
  const pkg = (studentId, courseId, kind, total, priceCents, bought, expire) => ({
    id: `p-${uid().slice(0, 8)}`, studentId, courseId, kind,
    total, used: 0, priceCents, boughtISO: addDays(today, bought), expireISO: expire === null ? null : addDays(today, expire), note: '',
  });
  const P1 = pkg(stuA, courseA, 'paid', 20, 240000, -170, 25);   // 20 节还剩 3 → 余额预警
  const P2 = pkg(stuA, courseB, 'bonus', 4, 0, -100, null);      // 赠课
  const P3 = pkg(stuB, courseA, 'paid', 40, 408000, -45, 75);
  const P4 = pkg(stuB, courseB, 'paid', 10, 99000, -30, null);
  const P5 = pkg(stuB, courseB, 'bonus', 2, 0, -30, null);
  const P6 = pkg(stuC, courseB, 'paid', 15, 135000, -140, 10);   // 10 天后到期 → 临期预警
  const P7 = pkg(stuB, courseA, 'bonus', 2, 0, -300, -15);       // 过期未消 1 节 → 过期预警
  state.packages = [P1, P2, P3, P4, P5, P6, P7];

  // 消课流水：先造流水，used 由流水推导（守恒恒等式按构造成立）
  // P1：近 17 周每周一节（i=1..17 → 7~119 天前）
  const plan = [];
  for (let i = 1; i <= 17; i += 1) {
    plan.push({ daysAgo: i * 7, courseId: courseA, teacherId: teacherA, alloc: [[stuA, P1.id]] });
  }
  // P3：李多多 45 天前购课，近两周加入王班两次
  plan.push({ daysAgo: 14, courseId: courseA, teacherId: teacherA, alloc: [[stuB, P3.id]] });
  plan.push({ daysAgo: 7, courseId: courseA, teacherId: teacherA, alloc: [[stuB, P3.id]] });
  // P7：李多多 120 天前消费赠课（当时名下唯一的中国舞课包，顺序合法）
  plan.push({ daysAgo: 120, courseId: courseA, teacherId: teacherA, alloc: [[stuB, P7.id]] });
  // P2：王小满用赠课上了次街舞体验
  plan.push({ daysAgo: 28, courseId: courseB, teacherId: teacherB, alloc: [[stuA, P2.id]] });
  // P6：陈小满近两周四次街舞（临期未消的大头）
  for (const d of [10, 7, 3, 1]) {
    plan.push({ daysAgo: d, courseId: courseB, teacherId: teacherB, alloc: [[stuC, P6.id]] });
  }
  const notes = { 10: '期中汇演排练', 1: '补上周请假' };
  state.sessions = plan.map((x) => ({
    id: `x-${uid().slice(0, 8)}`,
    dateISO: addDays(today, -x.daysAgo),
    courseId: x.courseId,
    teacherId: x.teacherId,
    allocations: x.alloc.map(([studentId, packageId]) => ({ studentId, packageId })),
    note: notes[x.daysAgo] ?? '',
  }));
  const usedByPkg = new Map();
  for (const s of state.sessions) {
    for (const a of s.allocations) usedByPkg.set(a.packageId, (usedByPkg.get(a.packageId) ?? 0) + 1);
  }
  for (const p of state.packages) p.used = usedByPkg.get(p.id) ?? 0;

  refundCache = null;
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
    case 'save-org': saveOrg(); break;
    case 'add-teacher': addTeacher(); break;
    case 'del-teacher': state.teachers.splice(Number(idx), 1); commit('del-teacher'); break;
    case 'add-course': addCourse(); break;
    case 'del-course': state.courses.splice(Number(idx), 1); commit('del-course'); break;
    case 'add-student': addStudent(); break;
    case 'del-student': {
      const sid = state.students[Number(idx)]?.id;
      const hasPkg = state.packages.some((p) => p.studentId === sid);
      if (hasPkg) { toast('该学员名下有课包，先处理课包（账实一致）'); return; }
      state.students.splice(Number(idx), 1);
      commit('del-student');
      break;
    }
    case 'add-package': addPackage(); break;
    case 'del-package': delPackage(Number(idx)); break;
    case 'add-session': addSession(); break;
    case 'undo-session': undoSession(el.dataset.idx); break;
    case 'stmt-apply': {
      stmtStudent = document.getElementById('stmt-student')?.value ?? stmtStudent;
      refundCache = null;
      render();
      break;
    }
    case 'stmt-copy': stmtAction('copy'); break;
    case 'stmt-download': stmtAction('download'); break;
    case 'stmt-print': stmtAction('print'); break;
    case 'refund-estimate': estimateRefund(); break;
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
