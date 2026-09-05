/**
 * tests/core.test.mjs — 安巡单 SafePatrol 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, escapeHtml, assertHours,
  INDUSTRIES, LICENSE_KINDS, HOTWORK_KINDS, HOTWORK_MEASURES, CHECK_ITEMS,
  HAZARD_LEVELS, HAZARD_STATUS, DRILL_TYPES, DEFAULT_SETTINGS, STATE_VERSION,
  addLicense, removeLicense, licenseLevel, licenseView, licenseRows,
  hasValidLicense, issueHotwork, closeHotwork, openHotworks, hotworkRows,
  registerHazard, fixHazard, closeHazard, isOverdue, hazardRows, hazardSummary,
  submitCheck, checkedOn, checkRows,
  addTraining, annualHours, trainingAudit, addDrill, drillAudit,
  addStaff, removeStaff,
  boardSummary, todayActions, selfCheckDigest, selfCheckText, selfCheckHtml,
  exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期（周六），不依赖墙钟
const d = (offset) => addDays(T, offset);

function mkState(over = {}) {
  return {
    org: { name: '明华五金制品厂', person: '陈厂长', phone: '13800001234', industry: 'metal' },
    staff: ['张三', '李四'],
    licenses: [],
    hotworks: [],
    hazards: [],
    checks: [],
    trainings: [],
    drills: [],
    settings: { ...DEFAULT_SETTINGS },
    events: [],
    ...over,
  };
}

function addWeld(state, id = 'l1', holder = '张三', expiry = d(200)) {
  return addLicense(state, { id, kind: 'weld', holderName: holder, certNo: 'T***', expiryISO: expiry });
}

const measuresAll = () => Object.fromEntries(HOTWORK_MEASURES.map((m) => [m.key, true]));
const measuresMissing = (k) => {
  const m = measuresAll();
  m[k] = false;
  return m;
};

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年；addDays 跨月跨年收敛', () => {
  assert.throws(() => assertISO('2026-9-5'));
  assert.throws(() => assertISO(20260905));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(daysUntil('2026-09-05', T), 0);
  assert.equal(daysUntil('2025-09-05', T), -365);
});

test('assertHours 只吃 1~999 整数；escapeHtml 基线', () => {
  assert.equal(assertHours(8), 8);
  assert.throws(() => assertHours(0));
  assert.throws(() => assertHours(2.5));
  assert.throws(() => assertHours(1000));
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  assert.ok(typeof todayISO() === 'string');
});

// ---------------------------------------------------------------------------
// 证照档案与三态引擎
// ---------------------------------------------------------------------------

test('licenseLevel 三态边界：-1 过期 / 0 当天到期算黄 / 60 含黄线 / 61 绿', () => {
  assert.equal(licenseLevel(d(-1), T), 'expired');
  assert.equal(licenseLevel(d(0), T), 'warn');
  assert.equal(licenseLevel(d(60), T), 'warn');
  assert.equal(licenseLevel(d(61), T), 'ok');
  assert.equal(licenseLevel(d(30), T, 15), 'ok'); // 参数覆盖
  assert.throws(() => licenseLevel(d(1), T, 0), /黄线天数非法/);
  assert.throws(() => licenseLevel('2026-9-5', T), /非法日期/);
});

test('addLicense 门禁：持有人必填、证种合法、日期合法；LICENSE_KINDS 基线', () => {
  const s = mkState();
  addLicense(s, { id: 'l1', kind: 'weld', holderName: '张三', expiryISO: d(100) });
  assert.equal(s.licenses.length, 1);
  assert.throws(() => addLicense(s, { id: 'l2', kind: 'weld', holderName: '', expiryISO: d(1) }), /持有人/);
  assert.throws(() => addLicense(s, { id: 'l2', kind: 'pilot', holderName: '李四', expiryISO: d(1) }), /证件种类非法/);
  assert.throws(() => addLicense(s, { id: 'l2', kind: 'elec', holderName: '李四', expiryISO: '2026/1/1' }), /非法日期/);
  assert.deepEqual(Object.keys(LICENSE_KINDS), ['weld', 'elec', 'high', 'refrig', 'forkliftCert', 'forkliftInspect']);
  assert.equal(LICENSE_KINDS.forkliftCert.renew, '复审换证');
  assert.equal(LICENSE_KINDS.forkliftInspect.scope, 'device');
  assert.deepEqual(Object.keys(HOTWORK_KINDS), ['weldCut', 'grind', 'fire']);
  assert.equal(HOTWORK_KINDS.weldCut.requireKind, 'weld');
  assert.deepEqual(Object.keys(INDUSTRIES).length, 7);
  assert.equal(Object.keys(CHECK_ITEMS).length, 12);
  assert.equal(HOTWORK_MEASURES.length, 6);
  assert.equal(HAZARD_LEVELS.major, '疑似重大·立即停用上报');
  assert.deepEqual(Object.keys(HAZARD_STATUS), ['open', 'fixed', 'closed']);
  assert.deepEqual(Object.keys(DRILL_TYPES), ['synth', 'scene']);
});

test('removeLicense：动火台账引用过的证件不许删（证据链不能断）', () => {
  const s = mkState();
  const lic = addWeld(s);
  issueHotwork(s, { id: 'hw1', dateISO: T, kind: 'weldCut', worker: '张三', workerLicenseId: lic.id, guardian: '李四', location: '车间', measures: measuresAll() });
  assert.throws(() => removeLicense(s, lic.id), /证据链不能断/);
  addLicense(s, { id: 'l2', kind: 'elec', holderName: '李四', expiryISO: d(10) });
  removeLicense(s, 'l2');
  assert.equal(s.licenses.length, 1);
  assert.throws(() => removeLicense(s, 'ghost'), /证件不存在/);
});

test('licenseRows 排序：红灯在前，同色按剩余天数升序；licenseView 带续办口径', () => {
  const s = mkState();
  addLicense(s, { id: 'a', kind: 'weld', holderName: '甲', expiryISO: d(100) });
  addLicense(s, { id: 'b', kind: 'elec', holderName: '乙', expiryISO: d(-5) });
  addLicense(s, { id: 'c', kind: 'forkliftCert', holderName: '丙', expiryISO: d(3) });
  addLicense(s, { id: 'e', kind: 'high', holderName: '丁', expiryISO: d(-20) });
  const rows = licenseRows(s, T);
  assert.deepEqual(rows.map((r) => r.license.id), ['e', 'b', 'c', 'a']);
  assert.deepEqual(rows.map((r) => r.level), ['expired', 'expired', 'warn', 'ok']);
  assert.equal(rows[0].daysLeft, -20);
  assert.equal(rows[3].renew, '复训换证');
  const view = licenseView(s.licenses[2], T);
  assert.equal(view.level, 'warn');
});

test('hasValidLicense：持有人 + 证种 + 当日有效三者都要对上', () => {
  const s = mkState();
  const lic = addWeld(s, 'l1', '张三', d(30));
  assert.equal(hasValidLicense(s, '张三', 'weld', T), true);
  assert.equal(hasValidLicense(s, '李四', 'weld', T), false);
  assert.equal(hasValidLicense(s, '张三', 'elec', T), false);
  const s2 = mkState();
  addLicense(s2, { id: 'lx', kind: 'weld', holderName: '张三', expiryISO: d(-1) });
  assert.equal(hasValidLicense(s2, '张三', 'weld', T), false);
  assert.equal(licenseLevel(lic.expiryISO, d(31)), 'expired'); // 31 天后过期
});

// ---------------------------------------------------------------------------
// 动火作业许可（软件闸机）
// ---------------------------------------------------------------------------

function weldState() {
  const s = mkState();
  const lic = addWeld(s, 'l1', '张三', d(200));
  return { s, lic };
}

test('开票闸机：焊割动火无证 / 过期证 / 证种不符 / 冒名 / 措施缺项 / 无监护，全部拒绝', () => {
  const { s, lic } = weldState();
  const base = { id: 'hw1', dateISO: T, kind: 'weldCut', worker: '张三', workerLicenseId: lic.id, guardian: '李四', location: '车间东区', measures: measuresAll() };

  assert.throws(() => issueHotwork(s, { ...base, kind: 'welding' }), /动火种类非法/);
  assert.throws(() => issueHotwork(s, { ...base, workerLicenseId: null }), /证件不存在/);
  assert.throws(() => issueHotwork(s, { ...base, worker: '' }), /作业人必填/);
  assert.throws(() => issueHotwork(s, { ...base, guardian: '' }), /监护人必填/);
  assert.throws(() => issueHotwork(s, { ...base, location: '' }), /作业地点必填/);
  assert.throws(() => issueHotwork(s, { ...base, workerLicenseId: 'ghost' }), /证件不存在/);
  assert.throws(() => issueHotwork(s, { ...base, measures: measuresMissing('stay') }), /安全措施未全部确认/);

  const { s: s2 } = weldState();
  addLicense(s2, { id: 'l2', kind: 'elec', holderName: '李四', expiryISO: d(300) });
  assert.throws(() => issueHotwork(s2, { ...base, workerLicenseId: 'l2' }), /证种不匹配/);
  assert.throws(() => issueHotwork(s2, { ...base, worker: '李四' }), /不一致/);

  const { s: s3 } = weldState();
  addLicense(s3, { id: 'l3', kind: 'weld', holderName: '李四', expiryISO: d(-1) });
  assert.throws(() => issueHotwork(s3, { ...base, workerLicenseId: 'l3', worker: '李四' }), /无证动火属重大事故隐患/);
  assert.equal(s3.hotworks.length, 0, '被拒绝的开票不得留痕在动火台账');
});

test('开票成功：临期证件带黄灯 warning；grind/fire 无证种映射但走措施闸', () => {
  const { s, lic } = weldState();
  addLicense(s, { id: 'near', kind: 'weld', holderName: '李四', expiryISO: d(20) });
  const p1 = issueHotwork(s, { id: 'hw1', dateISO: T, kind: 'weldCut', worker: '李四', workerLicenseId: 'near', guardian: '张三', location: '西区', measures: measuresAll() });
  assert.equal(p1.status, 'open');
  assert.equal(p1.warnings.length, 1);
  assert.match(p1.warnings[0], /黄线/);
  const p2 = issueHotwork(s, { id: 'hw2', dateISO: T, kind: 'grind', worker: '张三', guardian: '李四', location: '仓库', measures: measuresAll() });
  assert.equal(p2.workerLicenseId, null);
  assert.match(p2.warnings[0], /无强制证种映射/);
  assert.throws(() => issueHotwork(s, { id: 'hw3', dateISO: T, kind: 'fire', worker: '张三', guardian: '李四', location: '院里', measures: measuresMissing('clear') }), /安全措施未全部确认/);
  assert.equal(lic.kind, 'weld');
});

test('销票：完工销票、重复销票拒绝、销票日早于作业日拒绝；openHotworks 按作业日升序', () => {
  const { s, lic } = weldState();
  issueHotwork(s, { id: 'hw1', dateISO: d(-3), kind: 'weldCut', worker: '张三', workerLicenseId: lic.id, guardian: '李四', location: '甲', measures: measuresAll() });
  issueHotwork(s, { id: 'hw2', dateISO: T, kind: 'weldCut', worker: '张三', workerLicenseId: lic.id, guardian: '李四', location: '乙', measures: measuresAll() });
  assert.deepEqual(openHotworks(s).map((h) => h.id), ['hw1', 'hw2']);
  closeHotwork(s, { id: 'hw1', closedISO: T, closedNote: '留守 30 分钟无异常' });
  assert.deepEqual(openHotworks(s).map((h) => h.id), ['hw2']);
  assert.throws(() => closeHotwork(s, { id: 'hw1' }), /已销票/);
  assert.throws(() => closeHotwork(s, { id: 'hw2', closedISO: d(-5) }), /销票日期不能早于作业日期/);
  assert.throws(() => closeHotwork(s, { id: 'ghost' }), /动火单不存在/);
  assert.equal(hotworkRows(s)[0].id, 'hw2', '台账按作业日倒序');
});

// ---------------------------------------------------------------------------
// 隐患闭环（登记 → 整改 → 复查销案）
// ---------------------------------------------------------------------------

test('隐患登记门禁：描述必填、等级合法、期限不早于发现日；默认期限 = 发现日 + 7（可覆盖）', () => {
  const s = mkState();
  registerHazard(s, { id: 'h1', foundISO: d(-10), desc: '灭火器失压' });
  assert.equal(s.hazards[0].dueISO, d(-3), '默认期限 7 天');
  assert.equal(s.hazards[0].status, 'open');
  assert.throws(() => registerHazard(s, { id: 'h2', desc: '' }), /隐患描述必填/);
  assert.throws(() => registerHazard(s, { id: 'h2', desc: 'x', level: 'huge' }), /隐患等级非法/);
  assert.throws(() => registerHazard(s, { id: 'h2', desc: 'x', foundISO: d(-5), dueISO: d(-6) }), /整改期限不能早于发现日/);
  const s2 = mkState({ settings: { ...DEFAULT_SETTINGS, checkDueDays: 3 } });
  registerHazard(s2, { id: 'h1', foundISO: d(-10), desc: 'x' });
  assert.equal(s2.hazards[0].dueISO, d(-7));
});

test('状态机：open→fixed→closed 逐级迁移，跳级与倒退全部拒绝；说明与复查记录必填', () => {
  const s = mkState();
  registerHazard(s, { id: 'h1', foundISO: d(-10), desc: '堆垛贴墙' });
  assert.throws(() => closeHazard(s, { id: 'h1', recheckNote: 'x' }), /只有「待复查」/);
  assert.throws(() => fixHazard(s, { id: 'h1', fixNote: '' }), /整改说明必填/);
  assert.throws(() => fixHazard(s, { id: 'h1', fixNote: '已整改', fixedISO: d(-11) }), /整改日期不能早于发现日/);
  fixHazard(s, { id: 'h1', fixNote: '已重新码垛划线', fixedISO: d(-4) });
  assert.equal(s.hazards[0].status, 'fixed');
  assert.throws(() => fixHazard(s, { id: 'h1', fixNote: 'again' }), /只有「待整改」/);
  assert.throws(() => closeHazard(s, { id: 'h1', recheckNote: '' }), /复查记录必填/);
  closeHazard(s, { id: 'h1', recheckNote: '复查通过', closedISO: d(-1) });
  assert.equal(s.hazards[0].status, 'closed');
  assert.throws(() => closeHazard(s, { id: 'h1', recheckNote: 'again' }), /只有「待复查」/);
  assert.throws(() => fixHazard(s, { id: 'ghost', fixNote: 'x' }), /隐患不存在/);
});

test('逾期判定与闭环体检：closeRate 四舍五入、逾期只数未销案；hazardRows open 在前', () => {
  const s = mkState();
  registerHazard(s, { id: 'a', foundISO: d(-20), desc: '逾期未整改', dueISO: d(-5) });
  registerHazard(s, { id: 'b', foundISO: d(-9), desc: '待复查' });
  fixHazard(s, { id: 'b', fixNote: 'x', fixedISO: d(-2) });
  registerHazard(s, { id: 'c', foundISO: d(-40), desc: '已闭环' });
  fixHazard(s, { id: 'c', fixNote: 'x', fixedISO: d(-30) });
  closeHazard(s, { id: 'c', recheckNote: 'y', closedISO: d(-29) });
  const sum = hazardSummary(s, T);
  assert.equal(sum.total, 3);
  assert.equal(sum.open, 1);
  assert.equal(sum.fixed, 1);
  assert.equal(sum.closed, 1);
  assert.equal(sum.overdue, 2, 'open 与 fixed 超期都算逾期——闭环才算数');
  assert.equal(sum.closeRate, 33);
  assert.equal(isOverdue(s.hazards[0], T), true);
  assert.equal(isOverdue(s.hazards[1], T), true, '待复查超过期限同样亮红灯');
  assert.deepEqual(hazardRows(s, T).map((r) => r.hazard.id), ['a', 'b', 'c']);
  assert.equal(hazardSummary(mkState(), T).closeRate, null);
});

// ---------------------------------------------------------------------------
// 今日自查（异常强制留隐患）
// ---------------------------------------------------------------------------

test('自查门禁：异常必须写明情况；至少一项；结果值合法', () => {
  const s = mkState();
  assert.throws(() => submitCheck(s, { id: 'c1', results: {} }), /至少勾选一项/);
  assert.throws(() => submitCheck(s, { id: 'c1', results: { exit: 'maybe' } }), /结果非法/);
  assert.throws(() => submitCheck(s, { id: 'c1', results: { exting: 'issue' } }), /有异常，必须写明情况/);
  const { check, hazards } = submitCheck(s, {
    id: 'c1',
    results: { exting: 'issue', exit: 'ok', wire: 'issue' },
    issueDescs: { exting: '2 具失压', wire: '东墙插座破损' },
  });
  assert.equal(hazards.length, 2);
  assert.ok(hazards.every((h) => h.source === 'checklist'));
  assert.match(hazards[0].desc, /【自查】灭火器/);
  assert.equal(check.items.exit, 'ok');
  assert.equal(s.hazards.length, 2);
  assert.equal(checkedOn(s, T), true);
  assert.equal(checkedOn(s, d(-1)), false);
  assert.deepEqual(checkRows(s).map((c) => c.id), ['c1']);
  // 部分自查：只查了三项也如实记录（没查的项留空）
  submitCheck(s, { id: 'c2', results: { exit: 'ok' } });
  assert.equal(s.checks.length, 2);
  assert.throws(() => submitCheck(s, { id: 'c3', results: null }), /自查结果必填/);
});

// ---------------------------------------------------------------------------
// 员工、培训与演练
// ---------------------------------------------------------------------------

test('员工名单：去重、删人门禁（名下有证件先删证件）', () => {
  const s = mkState();
  addStaff(s, '王五');
  assert.deepEqual(s.staff, ['张三', '李四', '王五']);
  assert.throws(() => addStaff(s, '王五'), /已在名单中/);
  assert.throws(() => addStaff(s, ''), /姓名必填/);
  addLicense(s, { id: 'l1', kind: 'weld', holderName: '王五', expiryISO: d(30) });
  assert.throws(() => removeStaff(s, '王五'), /先删证件再删人/);
  removeLicense(s, 'l1');
  removeStaff(s, '王五');
  assert.throws(() => removeStaff(s, '王五'), /不在名单中/);
});

test('培训登记：人员必须在册、学时整数、attendees 去重；annualHours 按年累计', () => {
  const s = mkState();
  addTraining(s, { id: 't1', dateISO: '2026-03-01', topic: '用电安全', hours: 2, attendees: ['张三', '张三', '李四'] });
  addTraining(s, { id: 't2', dateISO: '2026-08-15', topic: '灭火实操', hours: 3, attendees: ['张三'] });
  addTraining(s, { id: 't3', dateISO: '2025-12-01', topic: '去年培训', hours: 10, attendees: ['张三'] });
  assert.equal(annualHours(s, '张三', 2026), 5);
  assert.equal(annualHours(s, '张三', 2025), 10);
  assert.equal(annualHours(s, '李四', 2026), 2);
  assert.throws(() => addTraining(s, { id: 't4', dateISO: T, topic: 'x', hours: 2, attendees: ['赵六'] }), /不在员工名单中/);
  assert.throws(() => addTraining(s, { id: 't4', dateISO: T, topic: 'x', hours: 2, attendees: [] }), /参训人员不能为空/);
  assert.throws(() => addTraining(s, { id: 't4', dateISO: T, topic: '', hours: 2, attendees: ['张三'] }), /培训主题必填/);
  assert.throws(() => addTraining(s, { id: 't4', dateISO: T, topic: 'x', hours: 1.5, attendees: ['张三'] }), /学时必须为/);
  assert.throws(() => annualHours(s, '张三', '2026'), /年度非法/);
});

test('学时体检：0 学时点名 zero、低于红线 short；红线参数可覆盖', () => {
  const s = mkState({ staff: ['张三', '李四', '王五'] });
  addTraining(s, { id: 't1', dateISO: '2026-03-01', topic: 'a', hours: 4, attendees: ['张三'] });
  addTraining(s, { id: 't2', dateISO: '2026-06-01', topic: 'b', hours: 3, attendees: ['李四'] });
  let ta = trainingAudit(s, 2026, T);
  assert.deepEqual(ta.zero, ['王五']);
  assert.deepEqual(ta.short, ['张三', '李四'], '4 与 3 学时都低于红线 8');
  assert.equal(ta.minHours, 8);
  const s2 = mkState({ staff: ['张三'] });
  assert.equal(trainingAudit(s2, 2026, T).pending, true, '当年全员 0 学时且未过完 → 未开始');
  const s3 = mkState({ staff: ['张三'], settings: { ...DEFAULT_SETTINGS, annualMinHours: 24 } });
  addTraining(s3, { id: 't1', dateISO: '2026-01-05', topic: 'a', hours: 12, attendees: ['张三'] });
  assert.deepEqual(trainingAudit(s3, 2026, T).short, ['张三']);
});

test('演练体检：none / overdue / due / ok 四态，周期参数可覆盖', () => {
  const s = mkState();
  assert.equal(drillAudit(s, T).scene.level, 'none');
  addDrill(s, { id: 'd1', dateISO: d(-184), type: 'scene', topic: '疏散', count: 5 });
  assert.equal(drillAudit(s, T).scene.level, 'overdue');
  addDrill(s, { id: 'd2', dateISO: d(-160), type: 'scene', topic: '灭火', count: 6 });
  assert.equal(drillAudit(s, T).scene.level, 'due');
  addDrill(s, { id: 'd3', dateISO: d(-100), type: 'scene', topic: '触电', count: 7 });
  assert.equal(drillAudit(s, T).scene.level, 'ok');
  addDrill(s, { id: 'd4', dateISO: d(-400), type: 'synth', topic: '综合', count: 12 });
  assert.equal(drillAudit(s, T).synth.level, 'overdue');
  const s2 = mkState({ settings: { ...DEFAULT_SETTINGS, drillSceneDays: 90 } });
  addDrill(s2, { id: 'd1', dateISO: d(-100), type: 'scene', topic: 'x', count: 1 });
  assert.equal(drillAudit(s2, T).scene.level, 'overdue');
  assert.throws(() => addDrill(s, { id: 'd9', dateISO: T, type: 'war', topic: 'x', count: 1 }), /演练类型非法/);
  assert.throws(() => addDrill(s, { id: 'd9', dateISO: T, type: 'scene', topic: '', count: 1 }), /演练主题必填/);
  assert.throws(() => addDrill(s, { id: 'd9', dateISO: T, type: 'scene', topic: 'x', count: 0 }), /参演人数非法/);
});

// ---------------------------------------------------------------------------
// 今日安全台
// ---------------------------------------------------------------------------

test('boardSummary 与 todayActions：红灯优先级排序，最多 4 条', () => {
  const s = mkState();
  addLicense(s, { id: 'l-exp', kind: 'weld', holderName: '李四', expiryISO: d(-1) });
  const lic = addWeld(s, 'l-ok', '张三', d(200));
  issueHotwork(s, { id: 'hw1', dateISO: d(-2), kind: 'weldCut', worker: '张三', workerLicenseId: lic.id, guardian: '李四', location: 'x', measures: measuresAll() });
  registerHazard(s, { id: 'h1', foundISO: d(-10), desc: 'x', dueISO: d(-3) });
  addDrill(s, { id: 'd1', dateISO: d(-200), type: 'scene', topic: 'x', count: 3 });
  const sum = boardSummary(s, T);
  assert.equal(sum.checked, false);
  assert.equal(sum.expiredLicenses, 1);
  assert.equal(sum.unclosedHotworks, 1);
  assert.equal(sum.overdueHazards, 1);
  assert.equal(sum.drillOverdue, 1);
  const actions = todayActions(s, T);
  assert.equal(actions.length, 4);
  assert.match(actions[0], /过期/);
  assert.match(actions[1], /销票/);
  assert.match(actions[2], /逾期/);
  assert.match(actions[3], /自查/);
  // 全绿的一天：只有「去自查」
  const s2 = mkState();
  s2.checks.push({ id: 'ck', dateISO: T, items: { exit: 'ok' }, createdAt: new Date().toISOString() });
  const s2sum = boardSummary(s2, T);
  assert.equal(s2sum.checked, true);
  assert.equal(todayActions(s2, T).length, 0);
});

// ---------------------------------------------------------------------------
// 迎检自证包
// ---------------------------------------------------------------------------

function fullState() {
  const s = mkState();
  addLicense(s, { id: 'l1', kind: 'weld', holderName: '张三', expiryISO: d(200) });
  addLicense(s, { id: 'l2', kind: 'forkliftInspect', holderName: '3 号叉车', expiryISO: d(-10) });
  addLicense(s, { id: 'l3', kind: 'elec', holderName: '王五', expiryISO: d(20) });
  issueHotwork(s, { id: 'hw1', dateISO: d(-1), kind: 'weldCut', worker: '张三', workerLicenseId: 'l1', guardian: '李四', location: '东区', measures: measuresAll() });
  submitCheck(s, { id: 'ck1', dateISO: d(-1), results: { exit: 'issue' }, issueDescs: { exit: '通道被纸箱占用' } });
  fixHazard(s, { id: `ck1-exit`, fixNote: '已清理' });
  closeHazard(s, { id: `ck1-exit`, recheckNote: '复查通过', closedISO: T });
  addTraining(s, { id: 't1', dateISO: '2026-06-01', topic: '用电安全', hours: 3, attendees: ['张三'] });
  addDrill(s, { id: 'd1', dateISO: '2026-02-01', type: 'scene', topic: '疏散', count: 6 });
  return s;
}

test('selfCheckText：同输入同输出；体检摘要与点名、免责声明齐全', () => {
  const s = fullState();
  const t1 = selfCheckText(s, T);
  assert.equal(t1, selfCheckText(s, T));
  assert.match(t1, /【安全生产自查快报】明华五金制品厂/);
  assert.match(t1, /安全负责人：陈厂长（13800001234）/);
  assert.match(t1, /隐患：累计 1 条 · 闭环率 100%/);
  assert.match(t1, /证照：过期 1 本 · 黄灯 1 本/);
  assert.match(t1, /动火：未销票 1 张/);
  assert.match(t1, /培训：学时不达标 2 人/); // 张三 3 < 8 也算 short；李四 0 → zero
  assert.match(t1, /演练：超期 1 类/);
  assert.match(t1, /二、过期证件点名/);
  assert.match(t1, /3 号叉车 · 叉车定期检验/);
  assert.match(t1, /不替代法定报送、企业安全制度与应急预案文本/);
  assert.match(t1, /生成：安巡单 SafePatrol · 2026-09-05/);
});

test('selfCheckHtml：单文件离线可用（无外部资源）、签字栏、XSS 转义', () => {
  const s = fullState();
  s.org.name = '明华<script>alert(1)</script>五金厂';
  const html = selfCheckHtml(s, T);
  assert.ok(!/src=["']http/.test(html));
  assert.ok(!/href=["']http/.test(html));
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(html, /安全生产自查台账 · 明华&lt;script&gt;/);
  assert.match(html, /账本体检/);
  assert.match(html, /人员与设备证照状态/);
  assert.match(html, /隐患排查治理台账/);
  assert.match(html, /动火作业台账/);
  assert.match(html, /安全教育培训记录/);
  assert.match(html, /应急演练记录/);
  assert.match(html, /安全负责人（签字）/);
  assert.match(html, /企业（盖章）/);
  assert.match(html, /是否构成重大事故隐患以《工贸企业重大事故隐患判定标准》/);
});

test('selfCheckDigest 与台账状态一致；空台账出体检摘要不炸', () => {
  const s = fullState();
  const dg = selfCheckDigest(s, T);
  assert.equal(dg.expiredLicenses, 1);
  assert.equal(dg.warnLicenses, 1);
  assert.equal(dg.unclosedHotworks, 1);
  assert.equal(dg.closedRate, 100);
  assert.equal(dg.checksCount, 1);
  const empty = selfCheckDigest(mkState(), T);
  assert.equal(empty.closedRate, null);
  assert.equal(empty.overdueHazards, 0);
  const t = selfCheckText(mkState(), T);
  assert.match(t, /闭环率 —/);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = fullState();
  const round = importBundle(exportBundle(s));
  assert.ok(round.ok);
  assert.deepEqual(round.state.org, s.org);
  assert.deepEqual(round.state.hazards, s.hazards);
  assert.deepEqual(round.state.hotworks, s.hotworks);
  assert.equal(round.state.staff.length, 2);
});

test('importBundle：非 JSON / 错误应用 / 坏结构 / 高版本一律整体拒绝', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.match(importBundle('not json').error, /JSON/);
  const bad = importBundle(JSON.stringify({ app: 'carsheet', version: 1, state: {} }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是安巡单/);
  const incomplete = importBundle(JSON.stringify({
    app: 'safepatrol', version: STATE_VERSION,
    state: { org: {}, licenses: [], hotworks: [], hazards: 'nope', checks: [], trainings: [], drills: [], staff: [], settings: {} },
  }));
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /结构不完整/);
  const future = importBundle(JSON.stringify({
    app: 'safepatrol', version: STATE_VERSION + 1,
    state: { org: {}, licenses: [], hotworks: [], hazards: [], checks: [], trainings: [], drills: [], staff: [], settings: {} },
  }));
  assert.equal(future.ok, false);
  assert.match(future.error, /高于当前支持版本/);
});

test('常量基线：STATE_VERSION 与默认参数', () => {
  assert.equal(STATE_VERSION, 1);
  assert.deepEqual(DEFAULT_SETTINGS, {
    licenseWarnDays: 60, checkDueDays: 7, annualMinHours: 8,
    drillSynthDays: 365, drillSceneDays: 183,
  });
});
