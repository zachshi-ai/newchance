/**
 * tests/core.test.mjs — 消课单 ClassOff 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, fmtYuan, escapeHtml,
  PACKAGE_KINDS, balanceOf, consumablePackages,
  applySession, removeSession,
  lowBalanceWarnings, expiringPackages, expiredOutstanding, teacherPayroll,
  complianceCheck, refundEstimate, refundText,
  studentLedger, statementText, statementHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期（周六），不依赖墙钟

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-5'));
  assert.throws(() => assertISO('20260905'));
  assert.throws(() => assertISO(20260905));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
});

test('addDays 跨月/跨年收敛', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('daysUntil 与 monthKey 跨年正确', () => {
  assert.equal(daysUntil('2026-12-31', T), 117);
  assert.equal(daysUntil('2026-09-05', T), 0);
  assert.equal(daysUntil('2026-09-04', T), -1);
  assert.equal(monthKey('2026-09-05'), '2026-09');
  assert.equal(monthKey('2026-01-01'), '2026-01');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('fmtYuan 只吃整数分', () => {
  assert.equal(fmtYuan(240000), '¥2400.00');
  assert.equal(fmtYuan(305), '¥3.05');
  assert.throws(() => fmtYuan(12.5));
});

// ---------------------------------------------------------------------------
// 课时账派生与消耗顺序
// ---------------------------------------------------------------------------

function mkPkg(id, over = {}) {
  return {
    id, studentId: 'stu', courseId: 'c1', kind: 'paid',
    total: 10, used: 0, priceCents: 100000,
    boughtISO: '2026-08-01', expireISO: null, note: '',
    ...over,
  };
}

test('balanceOf：正课/赠课分列、余额派生', () => {
  const packages = [
    mkPkg('a', { total: 20, used: 15 }),
    mkPkg('b', { kind: 'bonus', total: 4, used: 1 }),
    mkPkg('c', { studentId: 'other' }),
  ];
  const bal = balanceOf(packages, 'stu');
  assert.equal(bal.total, 24);
  assert.equal(bal.used, 16);
  assert.equal(bal.remaining, 8);
  assert.equal(bal.paidRemaining, 5);
  assert.equal(bal.bonusRemaining, 3);
  const c1 = balanceOf(packages, 'stu', 'c1');
  assert.equal(c1.remaining, 8);
  assert.equal(balanceOf(packages, 'nobody').total, 0);
});

test('consumablePackages：正课先于赠课', () => {
  const packages = [
    mkPkg('bonus1', { kind: 'bonus' }),
    mkPkg('paid1', {}),
  ];
  const q = consumablePackages(packages, 'stu', 'c1', T);
  assert.deepEqual(q.map((p) => p.id), ['paid1', 'bonus1']);
});

test('consumablePackages：同优先级临期先消、再按购课日 FIFO', () => {
  const packages = [
    mkPkg('far', { expireISO: '2027-06-30', boughtISO: '2026-07-01' }),
    mkPkg('soon', { expireISO: '2026-09-10', boughtISO: '2026-07-05' }),
    mkPkg('noexp-old', { expireISO: null, boughtISO: '2026-06-01' }),
  ];
  const q = consumablePackages(packages, 'stu', 'c1', T);
  assert.deepEqual(q.map((p) => p.id), ['soon', 'far', 'noexp-old']);
  const fifo = consumablePackages([
    mkPkg('late', { boughtISO: '2026-07-02', expireISO: '2026-10-01' }),
    mkPkg('early', { boughtISO: '2026-07-01', expireISO: '2026-10-01' }),
  ], 'stu', 'c1', T);
  assert.deepEqual(fifo.map((p) => p.id), ['early', 'late']);
});

test('consumablePackages：耗尽与已过期被排除；到期日当天仍可用', () => {
  const packages = [
    mkPkg('done', { used: 10 }),
    mkPkg('expired', { expireISO: '2026-09-04' }),
    mkPkg('lastday', { expireISO: '2026-09-05' }),
  ];
  const q = consumablePackages(packages, 'stu', 'c1', T);
  assert.deepEqual(q.map((p) => p.id), ['lastday']);
  assert.equal(consumablePackages(packages, 'stu', 'c1', '2026-09-06').length, 0);
});

// ---------------------------------------------------------------------------
// 消课落账与回滚（一课一消）
// ---------------------------------------------------------------------------

function baseState() {
  return {
    org: { name: '测试机构', phone: '' },
    teachers: [{ id: 't1', name: '豆豆', feeCents: 10000 }],
    courses: [{ id: 'c1', name: '中国舞' }, { id: 'c2', name: '街舞' }],
    students: [{ id: 'stu', name: '王小满', phone: '', note: '' }, { id: 'stu2', name: '李多多', phone: '', note: '' }],
    packages: [mkPkg('p1', { total: 3, used: 0, expireISO: '2026-09-10' }), mkPkg('p2', { kind: 'bonus', total: 1, used: 0, courseId: 'c2' })],
    sessions: [],
    settings: { lowBalance: 3, expiryWindowDays: 30 },
    events: [],
  };
}

test('applySession：点名落账，余额递减、分配可追溯', () => {
  const s = baseState();
  const ses = applySession(s, { id: 'x1', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu'] });
  assert.equal(s.packages[0].used, 1);
  assert.deepEqual(ses.allocations, [{ studentId: 'stu', packageId: 'p1' }]);
  assert.equal(s.sessions.length, 1);
  assert.equal(balanceOf(s.packages, 'stu', 'c1').remaining, 2);
});

test('applySession：多人点名各自消耗；重复 key 学员只算一次', () => {
  const s = baseState();
  s.packages.push(mkPkg('q1', { studentId: 'stu2', total: 2 }));
  applySession(s, { id: 'x1', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu', 'stu2', 'stu'] });
  assert.equal(s.packages[0].used, 1);
  assert.equal(s.packages[2].used, 1);
  assert.equal(s.sessions[0].allocations.length, 2);
});

test('applySession：余额不足整体拒绝，绝不部分入账', () => {
  const s = baseState();
  s.packages.push(mkPkg('q1', { studentId: 'stu2', total: 1, used: 1 })); // stu2 余额为 0
  assert.throws(() => applySession(s, {
    id: 'x1', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu', 'stu2'],
  }), /无课可消/);
  assert.equal(s.packages[0].used, 0); // 排在前面的 stu 也完全没被消耗
  assert.equal(s.sessions.length, 0);
});

test('applySession：全部过期/耗尽时拒绝', () => {
  const s = baseState();
  s.packages = [mkPkg('p1', { total: 1, used: 1, expireISO: '2026-09-10' })];
  assert.throws(() => applySession(s, { id: 'x1', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu'] }), /无课可消/);
});

test('applySession：同学员同科目同日重复点名拒绝；不同科目同日不冲突', () => {
  const s = baseState();
  applySession(s, { id: 'x1', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu'] });
  assert.throws(() => applySession(s, { id: 'x2', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu'] }), /重复点名/);
  assert.doesNotThrow(() => applySession(s, { id: 'x3', dateISO: T, courseId: 'c2', teacherId: 't1', studentIds: ['stu'] }));
});

test('applySession：消耗顺序 = 正课先（临期先、FIFO）赠课后', () => {
  const s = baseState();
  s.packages = [
    mkPkg('bonus', { kind: 'bonus', total: 2 }),
    mkPkg('paid-far', { expireISO: '2027-01-01', total: 2 }),
    mkPkg('paid-soon', { expireISO: '2026-09-06' }),
  ];
  applySession(s, { id: 'x1', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu'] });
  assert.equal(s.packages.find((p) => p.id === 'paid-soon').used, 1);
  // paid-soon 到期次日才轮到 paid-far；paid-far 只有 2 节，两节耗尽后赠课接棒
  applySession(s, { id: 'x2', dateISO: '2026-09-07', courseId: 'c1', teacherId: 't1', studentIds: ['stu'] });
  assert.equal(s.packages.find((p) => p.id === 'paid-far').used, 1);
  applySession(s, { id: 'x3', dateISO: '2026-09-08', courseId: 'c1', teacherId: 't1', studentIds: ['stu'] });
  assert.equal(s.packages.find((p) => p.id === 'paid-far').used, 2);
  applySession(s, { id: 'x4', dateISO: '2026-09-09', courseId: 'c1', teacherId: 't1', studentIds: ['stu'] });
  assert.equal(s.packages.find((p) => p.id === 'bonus').used, 1);
});

test('applySession：引用不存在的学员/课程/教师一律拒绝', () => {
  const s = baseState();
  assert.throws(() => applySession(s, { id: 'x', dateISO: T, courseId: 'cx', teacherId: 't1', studentIds: ['stu'] }), /课程不存在/);
  assert.throws(() => applySession(s, { id: 'x', dateISO: T, courseId: 'c1', teacherId: 'tx', studentIds: ['stu'] }), /教师不存在/);
  assert.throws(() => applySession(s, { id: 'x', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['ghost'] }), /学员不存在/);
  assert.throws(() => applySession(s, { id: 'x', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: [] }), /至少点名/);
});

test('removeSession：按分配精确回滚，回滚后可重新消课（往返守恒）', () => {
  const s = baseState();
  applySession(s, { id: 'x1', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu'] });
  removeSession(s, 'x1');
  assert.equal(s.packages[0].used, 0);
  assert.equal(s.sessions.length, 0);
  applySession(s, { id: 'x2', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu'] });
  assert.equal(s.packages[0].used, 1);
  assert.throws(() => removeSession(s, 'ghost'), /不存在/);
});

test('守恒恒等式：Σ课包已消 == Σ消课分配（多包多学员混合）', () => {
  const s = baseState();
  s.packages.push(mkPkg('q1', { studentId: 'stu2', total: 5, expireISO: '2026-09-06' }));
  s.packages.push(mkPkg('q2', { studentId: 'stu2', kind: 'bonus', total: 2 }));
  applySession(s, { id: 'x1', dateISO: T, courseId: 'c1', teacherId: 't1', studentIds: ['stu', 'stu2'] });
  applySession(s, { id: 'x2', dateISO: addDays(T, 1), courseId: 'c1', teacherId: 't1', studentIds: ['stu', 'stu2'] });
  applySession(s, { id: 'x3', dateISO: addDays(T, 2), courseId: 'c1', teacherId: 't1', studentIds: ['stu2'] });
  const sumUsed = s.packages.reduce((n, p) => n + p.used, 0);
  const sumAlloc = s.sessions.reduce((n, x) => n + x.allocations.length, 0);
  assert.equal(sumUsed, sumAlloc);
  assert.equal(s.packages.find((p) => p.id === 'q1').used, 2); // 临期先消
  assert.equal(s.packages.find((p) => p.id === 'q2').used, 1); // 正课尽后赠课接棒
  assert.equal(s.packages.find((p) => p.id === 'p1').used, 2); // 王小满两次课都从自己的包扣
});

// ---------------------------------------------------------------------------
// 看板预警
// ---------------------------------------------------------------------------

test('lowBalanceWarnings：剩余 ≤ 阈值且 >0 才亮灯，按剩余升序', () => {
  const students = [{ id: 'stu', name: '王小满' }, { id: 'stu2', name: '李多多' }];
  const packages = [
    mkPkg('a', { studentId: 'stu', total: 10, used: 7 }),  // 剩 3 == 阈值 → 亮
    mkPkg('b', { studentId: 'stu2', total: 10, used: 10 }), // 剩 0 → 不亮
    mkPkg('c', { studentId: 'stu2', total: 10, used: 4 }),  // 剩 6 → 不亮
    mkPkg('d', { studentId: 'stu2', kind: 'bonus', total: 2, used: 2 }),
  ];
  const w = lowBalanceWarnings(packages, students, T, 3);
  assert.equal(w.length, 1);
  assert.equal(w[0].studentId, 'stu');
  assert.equal(w[0].remaining, 3);
});

test('expiringPackages：窗口边界（0 ≤ 剩余天数 ≤ 窗口）与耗尽排除', () => {
  const students = [{ id: 'stu', name: '王小满' }];
  const courses = [{ id: 'c1', name: '中国舞' }];
  const packages = [
    mkPkg('today', { expireISO: T }),
    mkPkg('edge', { expireISO: '2026-10-05' }),
    mkPkg('beyond', { expireISO: '2026-10-06' }),
    mkPkg('past', { expireISO: '2026-09-04' }),
    mkPkg('done', { expireISO: T, total: 2, used: 2 }),
  ];
  const w = expiringPackages(packages, students, courses, T, 30);
  assert.deepEqual(w.map((x) => x.packageId), ['today', 'edge']);
  assert.equal(w[0].daysLeft, 0);
  assert.equal(w[1].daysLeft, 30);
});

test('expiredOutstanding：过期且有剩余才点名', () => {
  const students = [{ id: 'stu', name: '王小满' }];
  const courses = [{ id: 'c1', name: '中国舞' }];
  const packages = [
    mkPkg('past-has', { expireISO: '2026-09-04', total: 3, used: 1 }),
    mkPkg('past-done', { expireISO: '2026-08-01', total: 2, used: 2 }),
    mkPkg('future', { expireISO: '2026-12-31', total: 2, used: 1 }),
    mkPkg('noexp', {}),
  ];
  const w = expiredOutstanding(packages, students, courses, T);
  assert.equal(w.length, 1);
  assert.equal(w[0].packageId, 'past-has');
  assert.equal(w[0].remaining, 2);
});

test('teacherPayroll：按月分组按节计酬，跨月隔离，零课教师不出现', () => {
  const teachers = [
    { id: 't1', name: '豆豆', feeCents: 12000 },
    { id: 't2', name: '安然', feeCents: 10000 },
  ];
  const sessions = [
    { dateISO: '2026-09-01', teacherId: 't1', allocations: [{ studentId: 'stu', packageId: 'p' }] },
    { dateISO: '2026-09-30', teacherId: 't1', allocations: [] },
    { dateISO: '2026-10-01', teacherId: 't1', allocations: [] },
    { dateISO: '2025-09-30', teacherId: 't1', allocations: [] },
    { dateISO: '2026-09-15', teacherId: 't2', allocations: [] },
  ];
  const sep = teacherPayroll(sessions, teachers, '2026-09');
  assert.deepEqual(sep.map((r) => r.teacherId), ['t1', 't2']);
  assert.equal(sep[0].classes, 2);
  assert.equal(sep[0].payCents, 24000);
  assert.equal(sep[1].payCents, 10000);
  assert.equal(teacherPayroll(sessions, teachers, '2026-10').length, 1);
  assert.equal(teacherPayroll(sessions, teachers, '2025-09')[0].classes, 1);
  assert.throws(() => teacherPayroll(sessions, teachers, '2026-9'), /非法月份/);
});

// ---------------------------------------------------------------------------
// 合规体检（60 课时红线）
// ---------------------------------------------------------------------------

test('complianceCheck：单包超 60 课时亮红线', () => {
  const w = complianceCheck([], mkPkg('big', { total: 61 }));
  assert.equal(w.length, 1);
  assert.match(w[0], /60 课时/);
  assert.equal(complianceCheck([], mkPkg('ok', { total: 60 })).length, 0);
});

test('complianceCheck：在途 + 新包打包超限（变相收取）点名', () => {
  const existing = [mkPkg('old', { total: 40, used: 10 })]; // 在途 30
  const w = complianceCheck(existing, mkPkg('new', { total: 31 }));
  assert.equal(w.length, 1);
  assert.match(w[0], /变相超限/);
  assert.equal(complianceCheck(existing, mkPkg('new2', { total: 30 })).length, 0);
});

test('complianceCheck：赠课不触发红线；金额超 5000 提示线单独亮灯', () => {
  const w1 = complianceCheck([], mkPkg('gift', { kind: 'bonus', total: 100 }));
  assert.equal(w1.length, 0);
  const w2 = complianceCheck([], mkPkg('rich', { total: 10, priceCents: 500001 }));
  assert.equal(w2.length, 1);
  assert.match(w2[0], /5000 元/);
  const w3 = complianceCheck([], mkPkg('richgift', { kind: 'bonus', total: 100, priceCents: 99999900 }));
  assert.equal(w3.length, 0);
});

// ---------------------------------------------------------------------------
// 退费试算
// ---------------------------------------------------------------------------

const REF_STUDENTS = [{ id: 'stu', name: '王小满' }, { id: 'stu2', name: '李多多' }];
const REF_COURSES = [{ id: 'c1', name: '中国舞' }, { id: 'c2', name: '街舞' }];

test('refundEstimate：逐包折算（整数分四舍五入），应退 = 实收 − 已消折算', () => {
  const packages = [
    mkPkg('a', { total: 3, used: 2, priceCents: 10000 }),   // 单节 3333；已消 6666；余 3334
    mkPkg('b', { total: 20, used: 5, priceCents: 240000, expireISO: '2026-12-31' }), // 单节 12000；余 180000
  ];
  const e = refundEstimate(packages, 'stu', REF_STUDENTS, REF_COURSES);
  assert.equal(e.paidTotal, 250000);
  assert.equal(e.consumedValue, 66666);
  assert.equal(e.refundCents, 183334);
  assert.equal(e.refundCents, e.paidTotal - e.consumedValue); // 恒等式
});

test('refundEstimate：赠课不折现；过期未消单列不计入', () => {
  const packages = [
    mkPkg('a', { total: 10, used: 3, priceCents: 100000 }),
    mkPkg('gift', { kind: 'bonus', total: 4, used: 1 }),
    mkPkg('dead', { total: 5, used: 2, priceCents: 50000, expireISO: '2025-01-01' }),
  ];
  const e = refundEstimate(packages, 'stu', REF_STUDENTS, REF_COURSES);
  // dead 包：单节 10000、已消 2 → 余 30000 仍在账面应退里，但 3 节过期未消被单列
  assert.equal(e.refundCents, (100000 - 30000) + (50000 - 20000));
  assert.equal(e.expiredRemaining, 3);
  const giftLine = e.lines.find((l) => l.label.includes('赠课'));
  assert.equal(giftLine.cents, 0);
});

test('refundEstimate：无课包学员拒绝', () => {
  assert.throws(() => refundEstimate([], 'stu', REF_STUDENTS, REF_COURSES), /无从试算/);
  assert.throws(() => refundEstimate([], 'ghost', REF_STUDENTS, REF_COURSES), /学员不存在/);
});

test('refundText：确定性文本，包含合计、应退与合同口径声明', () => {
  const packages = [
    mkPkg('a', { total: 20, used: 8, priceCents: 240000, courseId: 'c1' }),
    mkPkg('gift', { kind: 'bonus', total: 4, used: 0, courseId: 'c2' }),
  ];
  const estimate = refundEstimate(packages, 'stu', REF_STUDENTS, REF_COURSES);
  const t1 = refundText({ studentName: '王小满', estimate, orgName: '测试机构', todayISOStr: T });
  const t2 = refundText({ studentName: '王小满', estimate, orgName: '测试机构', todayISOStr: T });
  assert.equal(t1, t2);
  assert.match(t1, /【退费试算单】王小满/);
  assert.match(t1, /试算应退：¥1440\.00/);
  assert.match(t1, /赠课不折现/);
  assert.match(t1, /以培训合同为准/);
});

// ---------------------------------------------------------------------------
// 家长对账单
// ---------------------------------------------------------------------------

function stmtState() {
  return {
    org: { name: '小满舞蹈工作室', phone: '13800001234' },
    teachers: [{ id: 't1', name: '豆豆老师', feeCents: 12000 }],
    courses: [{ id: 'c1', name: '中国舞' }, { id: 'c2', name: '街舞' }],
    students: [{ id: 'stu', name: '王小满 <script>', phone: '139', note: '' }],
    packages: [
      mkPkg('p1', { total: 20, used: 3, priceCents: 240000, expireISO: '2026-12-31' }),
      mkPkg('p2', { kind: 'bonus', total: 4, used: 1, courseId: 'c2' }),
    ],
    sessions: [
      { id: 'x1', dateISO: '2026-09-01', courseId: 'c1', teacherId: 't1', allocations: [{ studentId: 'stu', packageId: 'p1' }], note: '' },
      { id: 'x2', dateISO: '2026-08-20', courseId: 'c1', teacherId: 't1', allocations: [{ studentId: 'stu', packageId: 'p1' }], note: '' },
      { id: 'x3', dateISO: '2026-08-10', courseId: 'c2', teacherId: 't1', allocations: [{ studentId: 'stu', packageId: 'p2' }], note: '' },
    ],
    settings: { lowBalance: 3, expiryWindowDays: 30 },
    events: [],
  };
}

test('studentLedger：倒序流水带课程与教师', () => {
  const ledger = studentLedger(stmtState(), 'stu');
  assert.deepEqual(ledger.map((r) => r.dateISO), ['2026-09-01', '2026-08-20', '2026-08-10']);
  assert.equal(ledger[0].teacherName, '豆豆老师');
});

test('statementText：同输入同输出；余额与消课明细可读', () => {
  const s = stmtState();
  const t1 = statementText({ state: s, studentId: 'stu', todayISOStr: T });
  const t2 = statementText({ state: s, studentId: 'stu', todayISOStr: T });
  assert.equal(t1, t2);
  assert.match(t1, /【课时对账单】/);
  assert.match(t1, /中国舞：剩 17\/20 节/);
  assert.match(t1, /最早到期 2026-12-31/);
  assert.match(t1, /消课明细（共 3 节/);
  assert.match(t1, /2026-09-01 中国舞（豆豆老师）/, '最近一节在前');
});

test('statementText / statementHtml：学员姓名中的 HTML 被转义（XSS 防护）', () => {
  const s = stmtState();
  const text = statementText({ state: s, studentId: 'stu', todayISOStr: T });
  assert.match(text, /王小满 <script>/);
  const html = statementHtml({ state: s, studentId: 'stu', todayISOStr: T });
  assert.ok(!html.includes('王小满 <script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('statementHtml：单文件离线可用（无外部资源），含购课/余额/明细/签字栏', () => {
  const html = statementHtml({ state: stmtState(), studentId: 'stu', todayISOStr: T });
  assert.ok(!/src=["']http/.test(html));
  assert.ok(!/href=["']http/.test(html));
  assert.match(html, /购课记录/);
  assert.match(html, /课时余额/);
  assert.match(html, /剩 <strong>17<\/strong> \/ 20 节/);
  assert.match(html, /家长（签字确认）/);
  assert.match(html, /以培训合同为准/);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = stmtState();
  s.sessions.push({
    id: 'x9', dateISO: T, courseId: 'c1', teacherId: 't1',
    allocations: [{ studentId: 'stu', packageId: 'p1' }], note: '',
  });
  s.packages[0].used = 4;
  const round = importBundle(exportBundle(s));
  assert.ok(round.ok);
  assert.deepEqual(round.state.packages, s.packages);
  assert.deepEqual(round.state.sessions, s.sessions);
  assert.equal(round.state.org.name, '小满舞蹈工作室');
});

test('importBundle：非 JSON / 错误应用 / 坏结构 / 高版本一律整体拒绝', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.match(importBundle('not json').error, /JSON/);
  const bad = importBundle(JSON.stringify({ app: 'turnsheet', version: 1, state: {} }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是消课单/);
  const incomplete = importBundle(JSON.stringify({
    app: 'classoff', version: STATE_VERSION,
    state: { org: {}, teachers: [], courses: [], students: 'nope', packages: [], sessions: [], settings: {} },
  }));
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /结构不完整/);
  const future = importBundle(JSON.stringify({
    app: 'classoff', version: STATE_VERSION + 1,
    state: {
      org: {}, teachers: [], courses: [], students: [], packages: [], sessions: [], settings: {},
    },
  }));
  assert.equal(future.ok, false);
  assert.match(future.error, /高于当前支持版本/);
});

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

test('escapeHtml 与 PACKAGE_KINDS 基线', () => {
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  assert.deepEqual(Object.keys(PACKAGE_KINDS), ['paid', 'bonus']);
  assert.ok(typeof todayISO() === 'string');
});
