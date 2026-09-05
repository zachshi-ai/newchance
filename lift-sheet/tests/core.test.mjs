/**
 * tests/core.test.mjs — 梯保单 LiftSheet 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, assertHM, todayISO, addDays, daysUntil, monthKey, hmToMin, diffMinutes, escapeHtml,
  ELEV_KINDS, JOB_KINDS, CYCLE_DEFAULTS, CHECKLISTS, checklistOf, itemsFor,
  assertElevator, statusOf, lastDoneISO, scheduleFor, suggestKind, queue,
  makeJobNo, resetJobSeq, assertJob, registerJob, removeJob, confirmJob, pendingConfirm,
  assertIncident, clockOf, openIncidents, drillRows, certRows, inspectionRows, selfcheckRows,
  recordPayment, feeRows, monthlyAccount, selfCheck,
  confirmText, confirmHtml, packHtml, logEvent,
  STATE_VERSION, exportBundle, importBundle, emptyStateFields,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期（周六），不依赖墙钟

function newState() {
  return {
    version: STATE_VERSION,
    company: { name: '惠民电梯工程', phone: '13800000000' },
    elevators: [
      { id: 'e1', site: '阳光花园物业', name: '1号楼客梯', code: 'TSC-001', kind: 'traction_pass', startISO: '2026-07-01', nextInspectionISO: '2026-10-20', monthlyFee: 1200, active: true },
      { id: 'e2', site: '阳光花园物业', name: '2号楼货梯', code: 'TSC-002', kind: 'traction_freight', startISO: '2026-07-01', nextInspectionISO: null, monthlyFee: 900, active: true },
      { id: 'e3', site: '市中心商场', name: '中庭扶梯', code: 'TSC-003', kind: 'escalator', startISO: '2026-08-01', nextInspectionISO: '2026-09-20', monthlyFee: 1500, active: true },
      { id: 'e4', site: '市中心商场', name: '后巷杂物梯', code: 'TSC-004', kind: 'dumbwaiter', startISO: '2026-08-01', nextInspectionISO: null, monthlyFee: 500, active: false },
    ],
    workers: [
      { id: 'w1', name: '王师傅', certNo: 'TS-T-1001', certValidUntil: '2027-06-30' },
      { id: 'w2', name: '李师傅', certNo: 'TS-T-1002', certValidUntil: '2026-09-20' },
    ],
    jobs: [],
    incidents: [],
    drills: [{ id: 'd1', kind: 'traction_pass', dateISO: '2026-06-01', note: '困人演练' }],
    payments: [],
    settings: {
      ...emptyStateFields().settings,
    },
    events: [],
  };
}

function job(s, over = {}) {
  return {
    id: over.id || `j_${s.jobs.length + 1}_${Math.random().toString(36).slice(2, 6)}`,
    elevatorId: 'e1', kind: 'half', dateISO: T, workerId: 'w1',
    items: itemsFor('traction_pass', 'half').map((i) => ({ ...i, ok: true, note: '' })),
    note: '', checker: '', reviewer: '',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年；assertHM 拒绝非法时刻', () => {
  assert.throws(() => assertISO('2026-9-5'));
  assert.throws(() => assertISO('20260905'));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
  assert.doesNotThrow(() => assertHM('00:00'));
  assert.doesNotThrow(() => assertHM('23:59'));
  assert.throws(() => assertHM('24:00'));
  assert.throws(() => assertHM('9:5'));
});

test('addDays 跨月跨年收敛；daysUntil/monthKey 正确', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysUntil('2026-09-05', T), 0);
  assert.equal(daysUntil('2026-09-04', T), -1);
  assert.equal(monthKey('2026-12-31'), '2026-12');
});

test('hmToMin 与 diffMinutes（含跨天）', () => {
  assert.equal(hmToMin('00:30'), 30);
  assert.equal(hmToMin('23:59'), 1439);
  assert.equal(diffMinutes('2026-09-05', '08:00', '2026-09-05', '08:31'), 31);
  assert.equal(diffMinutes('2026-09-05', '23:50', '2026-09-06', '00:10'), 20);
  assert.throws(() => diffMinutes('2026-09-06', '08:00', '2026-09-05', '08:00'));
});

test('escapeHtml 转义全部危险字符', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('1')">&`), '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;');
});

// ---------------------------------------------------------------------------
// 目录模板与叠层
// ---------------------------------------------------------------------------

test('品种目录：附件映射与清单选择', () => {
  assert.equal(ELEV_KINDS.traction_pass.annex, 'A');
  assert.equal(ELEV_KINDS.moving_walk.annex, 'D');
  assert.equal(checklistOf('escalator'), CHECKLISTS.escalator);
  assert.equal(checklistOf('hydraulic'), CHECKLISTS.generic);
});

test('itemsFor 叠层并集：季度保 = 半月项 + 季度增项，年度保全量', () => {
  const half = itemsFor('traction_pass', 'half');
  const quarter = itemsFor('traction_pass', 'quarter');
  const yearly = itemsFor('traction_pass', 'yearly');
  assert.equal(half.length, CHECKLISTS.traction.half.length);
  assert.equal(quarter.length, half.length + CHECKLISTS.traction.quarter.length);
  assert.equal(yearly.length, half.length + CHECKLISTS.traction.quarter.length + CHECKLISTS.traction.halfyear.length + CHECKLISTS.traction.yearly.length);
  // key 不重复
  assert.equal(new Set(yearly.map((i) => i.key)).size, yearly.length);
  // 自行检查不是保养类别
  assert.equal(JOB_KINDS.selfcheck.rank, 0);
});

// ---------------------------------------------------------------------------
// 电梯档案
// ---------------------------------------------------------------------------

test('assertElevator 门禁：代码/编号/品种/使用单位必填，月费整数', () => {
  const s = newState();
  assert.throws(() => assertElevator({ ...s.elevators[0], code: '' }));
  assert.throws(() => assertElevator({ ...s.elevators[0], name: '' }));
  assert.throws(() => assertElevator({ ...s.elevators[0], kind: 'rocket' }));
  assert.throws(() => assertElevator({ ...s.elevators[0], site: '' }));
  assert.throws(() => assertElevator({ ...s.elevators[0], monthlyFee: 1.5 }));
  assert.throws(() => assertElevator({ ...s.elevators[0], monthlyFee: -1 }));
  assert.doesNotThrow(() => assertElevator(s.elevators[0]));
});

// ---------------------------------------------------------------------------
// 四周期滚动引擎
// ---------------------------------------------------------------------------

test('statusOf 三态：今天到期算黄，黄线含第 7 天', () => {
  assert.equal(statusOf('2026-08-29', T), 'red');
  assert.equal(statusOf('2026-09-05', T), 'yellow');
  assert.equal(statusOf('2026-09-12', T, 7), 'yellow');
  assert.equal(statusOf('2026-09-13', T, 7), 'green');
});

test('无保养历史：按接管日起算四周期（欠账第一天就可见）', () => {
  const s = newState();
  const sched = scheduleFor(s.elevators[0], s.jobs, s.settings.cycles, T);
  // 接管 2026-07-01，T=09-05：半月 due=07-16（已过→红），季度 due=10-01（26 天后→绿）
  assert.equal(sched.kinds.half.due, '2026-07-16');
  assert.equal(sched.kinds.half.status, 'red');
  assert.equal(sched.kinds.quarter.due, '2026-10-01');
  assert.equal(sched.kinds.quarter.status, 'green');
  assert.equal(sched.worst, 'red');
});

test('有保养历史：从最后完成日滚动；深层保养覆盖浅层；黄线参数生效', () => {
  let s = newState();
  s = registerJob(s, job(s, { kind: 'quarter', dateISO: '2026-09-01' }), T);
  const sched = scheduleFor(s.elevators[0], s.jobs, s.settings.cycles, T);
  // 半月层最后一次完成=季度保日 09-01 → due 09-16（11 天后→绿）
  assert.equal(sched.kinds.half.last, '2026-09-01');
  assert.equal(sched.kinds.half.due, '2026-09-16');
  assert.equal(sched.kinds.half.status, 'green');
  // 季度层 due=12-02（绿）
  assert.equal(sched.kinds.quarter.due, '2026-12-02');
  assert.equal(sched.kinds.quarter.status, 'green');
  assert.equal(sched.worst, 'green');
  // 把黄线放宽到 14 天 → 半月层变黄
  const sched2 = scheduleFor(s.elevators[0], s.jobs, s.settings.cycles, T, 14);
  assert.equal(sched2.kinds.half.status, 'yellow');
  assert.equal(sched2.worst, 'yellow');
});

test('suggestKind：逾期最深层优先，全部正常则半月保', () => {
  let s = newState();
  // 半年保（03-01）已逾期：它覆盖季度+半月，建议先做半年保
  s = registerJob(s, job(s, { kind: 'halfyear', dateISO: '2026-03-01' }), T);
  const sched = scheduleFor(s.elevators[0], s.jobs, s.settings.cycles, T);
  assert.equal(sched.kinds.halfyear.status, 'red');
  assert.equal(suggestKind(sched), 'halfyear');
  // 年度保补上后四层全部新鲜，回落到日常半月保
  s = registerJob(s, job(s, { kind: 'yearly', dateISO: T }), T);
  assert.equal(suggestKind(scheduleFor(s.elevators[0], s.jobs, s.settings.cycles, T)), 'half');
});

test('queue：停保电梯不点名；红先黄后绿，红内按最早到期升序', () => {
  let s = newState();
  s = registerJob(s, job(s, { elevatorId: 'e2', kind: 'half', dateISO: T }), T); // e2 半月新鲜
  const rows = queue(s.elevators, s.jobs, s.settings.cycles, T);
  const ids = rows.map((r) => r.elevator.id);
  assert.ok(!ids.includes('e4'), '停保的 e4 不应出现在队列');
  assert.equal(ids[0], 'e1', '逾期的 e1 排最前');
  assert.equal(rows[0].suggest, 'half');
});

// ---------------------------------------------------------------------------
// 落单门禁与签字链
// ---------------------------------------------------------------------------

test('makeJobNo 递增；assertJob 六道门禁', () => {
  resetJobSeq();
  assert.equal(makeJobNo(T), 'VB-20260905-001');
  assert.equal(makeJobNo(T), 'VB-20260905-002');

  const s = newState();
  assert.throws(() => assertJob(job(s, { elevatorId: 'nope' }), s, T), /电梯不存在/);
  assert.throws(() => assertJob(job(s, { kind: 'weekly' }), s, T), /非法保养类别/);
  assert.throws(() => assertJob(job(s, { dateISO: '2026-09-06' }), s, T), /未来/);
  assert.throws(() => assertJob(job(s, { workerId: 'w9' }), s, T), /在册/);
  assert.throws(() => assertJob(job(s, { items: [] }), s, T), /项目不能为空/);
  const badItems = itemsFor('traction_pass', 'half').map((i, idx) => ({ ...i, ok: idx === 0, note: '' }));
  assert.throws(() => assertJob(job(s, { items: badItems }), s, T), /处置说明/);
  assert.doesNotThrow(() => assertJob(job(s), s, T));
});

test('registerJob：异常项写明处置后放行；补录如实打标', () => {
  let s = newState();
  const items = itemsFor('traction_pass', 'half').map((i, idx) => ({ ...i, ok: idx !== 0, note: idx === 0 ? '制动器间隙超标，已调整并复测合格' : '' }));
  s = registerJob(s, job(s, { dateISO: '2026-09-03', items }), T);
  assert.equal(s.jobs.length, 1);
  assert.equal(s.jobs[0].backfill, true, '09-03 早于今天 09-05 → 补录');
  s = registerJob(s, job(s, { dateISO: T }), T);
  assert.equal(s.jobs[1].backfill, false);
  assert.match(s.jobs[1].no, /^VB-20260905-/);
});

test('confirmJob：使用单位签字；不可重复确认；确认日期不得早于维保日期', () => {
  let s = newState();
  s = registerJob(s, job(s), T);
  const id = s.jobs[0].id;
  assert.throws(() => confirmJob(s, id, '', T), /确认人必填/);
  assert.throws(() => confirmJob(s, id, '张物业', '2026-09-04'), /不能早于/);
  s = confirmJob(s, id, '张物业', T);
  assert.equal(s.jobs[0].confirmedBy, '张物业');
  assert.throws(() => confirmJob(s, id, '李物业', T), /不可重复确认/);
  assert.deepEqual(pendingConfirm(s), []);
});

test('removeJob 撤销即回滚：排程立即还原', () => {
  let s = newState();
  s = registerJob(s, job(s, { kind: 'half', dateISO: T }), T);
  const id = s.jobs[0].id;
  assert.equal(scheduleFor(s.elevators[0], s.jobs, s.settings.cycles, T).kinds.half.last, T);
  s = removeJob(s, id);
  assert.throws(() => removeJob(s, id), /不存在/);
  assert.equal(scheduleFor(s.elevators[0], s.jobs, s.settings.cycles, T).kinds.half.last, null);
});

test('自行检查必须检查人+审核人（T5002 第五条(九)）', () => {
  const s = newState();
  assert.throws(() => assertJob(job(s, { kind: 'selfcheck' }), s, T), /检查人/);
  assert.throws(() => assertJob(job(s, { kind: 'selfcheck', checker: '王工' }), s, T), /审核人/);
  assert.doesNotThrow(() => assertJob(job(s, { kind: 'selfcheck', checker: '王工', reviewer: '钱总' }), s, T));
});

test('停保电梯不能落单', () => {
  const s = newState();
  assert.throws(() => assertJob(job(s, { elevatorId: 'e4' }), s, T), /停保/);
});

// ---------------------------------------------------------------------------
// 应急救援时钟
// ---------------------------------------------------------------------------

test('clockOf：30 分钟口径下的开单/到场/闭环全生命周期', () => {
  const s = newState(); // areaType city → limit 30
  const inc = { elevatorId: 'e1', kind: 'trapped', reportDate: T, reportTime: '10:00' };
  assert.deepEqual(
    { status: clockOf(inc, s.settings, { dateISO: T, time: '10:29' }).status, minutes: 29 },
    { status: 'open', minutes: 29 },
  );
  assert.equal(clockOf(inc, s.settings, { dateISO: T, time: '10:31' }).status, 'open_over');
  const arrived = { ...inc, arriveDate: T, arriveTime: '10:25' };
  assert.equal(clockOf(arrived, s.settings).status, 'arrived_open');
  const done = { ...arrived, fixedDate: T, fixedTime: '10:40' };
  assert.equal(clockOf(done, s.settings).status, 'closed_ok');
  const late = { ...inc, arriveDate: T, arriveTime: '10:40', fixedDate: T, fixedTime: '11:00' };
  assert.equal(clockOf(late, s.settings).status, 'closed_over', '到场超时如实保留');
});

test('clockOf：其他地区 60 分钟口径与跨天到场', () => {
  let s = newState();
  s = { ...s, settings: { ...s.settings, areaType: 'other' } };
  const inc = { elevatorId: 'e1', kind: 'trapped', reportDate: T, reportTime: '23:50' };
  assert.equal(clockOf(inc, s.settings, { dateISO: T, time: '23:55' }).status, 'open');
  const arrived = { ...inc, arriveDate: '2026-09-06', arriveTime: '00:40' };
  assert.equal(clockOf(arrived, s.settings).minutes, 50);
  assert.equal(clockOf(arrived, s.settings).status, 'arrived_open');
});

test('openIncidents：未闭环的单永远点名', () => {
  let s = newState();
  s = { ...s, incidents: [{ id: 'i1', elevatorId: 'e1', kind: 'fault', reportDate: T, reportTime: '08:00', arriveDate: T, arriveTime: '08:10' }] };
  assert.equal(openIncidents(s).length, 1);
  s = { ...s, incidents: [{ ...s.incidents[0], fixedDate: T, fixedTime: '08:30' }] };
  assert.equal(openIncidents(s).length, 0);
});

// ---------------------------------------------------------------------------
// 周期任务：演练 / 证件 / 检验 / 自行检查
// ---------------------------------------------------------------------------

test('drillRows：按在保电梯品种点名，从未演练=红', () => {
  const s = newState(); // 在保品种：traction_pass, traction_freight, escalator（e4 停保不算）
  const rows = drillRows(s, T);
  assert.equal(rows.length, 3);
  const tp = rows.find((r) => r.kind === 'traction_pass');
  assert.equal(tp.last, '2026-06-01');
  assert.equal(tp.due, '2026-12-01'); // +183 天
  assert.equal(tp.status, 'green');
  assert.ok(rows.find((r) => r.kind === 'traction_freight').status === 'red');
  assert.ok(rows.find((r) => r.kind === 'escalator').status === 'red');
});

test('certRows：过期红、60 天黄线', () => {
  const s = newState();
  const rows = certRows(s, T);
  assert.equal(rows.find((r) => r.worker.id === 'w1').status, 'green');
  assert.equal(rows.find((r) => r.worker.id === 'w2').status, 'yellow'); // 09-20 距 09-05 = 15 天
});

test('inspectionRows 与 selfcheckRows：检验过期红；检验临近无自行检查红', () => {
  let s = newState();
  assert.equal(inspectionRows(s, T).find((r) => r.elevator.id === 'e3').status, 'yellow'); // 09-20 临近
  assert.ok(selfcheckRows(s, T).find((r) => r.elevator.id === 'e3').status === 'red');
  // 做了自行检查后转绿
  s = registerJob(s, job(s, { elevatorId: 'e3', kind: 'selfcheck', checker: '王工', reviewer: '钱总', dateISO: T }), T);
  assert.ok(selfcheckRows(s, T).find((r) => r.elevator.id === 'e3').status === 'green');
});

// ---------------------------------------------------------------------------
// 月账
// ---------------------------------------------------------------------------

test('recordPayment 门禁与 feeRows/monthlyAccount 派生', () => {
  let s = newState();
  assert.throws(() => recordPayment(s, { elevatorId: 'e1', month: '2026-09', amount: 100.5, paidISO: T }), /正整数/);
  assert.throws(() => recordPayment(s, { elevatorId: 'nope', month: '2026-09', amount: 100, paidISO: T }), /不存在/);
  assert.throws(() => recordPayment(s, { elevatorId: 'e1', month: '2026-9', amount: 100, paidISO: T }), /非法月份/);

  // e1 半收、e2 未收、e3 全收、e4 停保不计
  s = recordPayment(s, { elevatorId: 'e1', month: '2026-09', amount: 700, paidISO: T });
  s = recordPayment(s, { elevatorId: 'e3', month: '2026-09', amount: 1500, paidISO: T });
  const fees = feeRows(s, '2026-09');
  assert.equal(fees.length, 3, '停保电梯不计应收');
  assert.equal(fees.find((f) => f.elevator.id === 'e1').owed, 500);
  assert.equal(fees.find((f) => f.elevator.id === 'e2').owed, 900);

  const acc = monthlyAccount(s, '2026-09');
  assert.equal(acc.billed, 3600);
  assert.equal(acc.paid, 2200);
  assert.equal(acc.owed, 1400);
  assert.equal(acc.oweRows.length, 2);
  assert.equal(acc.confirmRate, null);
});

test('monthlyAccount：签字确认率按已确认单计算', () => {
  let s = newState();
  s = registerJob(s, job(s), T);
  s = registerJob(s, job(s, { dateISO: '2026-09-02' }), T);
  s = confirmJob(s, s.jobs[0].id, '张物业', T);
  const acc = monthlyAccount(s, '2026-09');
  assert.equal(acc.jobCount, 2);
  assert.equal(acc.confirmRate, 50);
});

// ---------------------------------------------------------------------------
// 体检
// ---------------------------------------------------------------------------

test('selfCheck 七项：新账全红点名，逐项整改后得分回升', () => {
  let s = newState();
  const c1 = selfCheck(s, { dateISO: T, time: '12:00' });
  const get = (key) => c1.items.find((i) => i.key === key);
  assert.equal(get('overdue').level, 'red');
  assert.equal(get('drill').count, 2, '货梯与扶梯缺演练');
  assert.ok(get('fee').count >= 2, '欠费是经营黄灯');
  assert.equal(c1.score < 100, true);

  // 整改：e1 半月保+确认、演练补齐、e3 自行检查、收齐月费
  s = registerJob(s, job(s, { kind: 'halfyear', dateISO: T }), T);
  s = registerJob(s, job(s, { elevatorId: 'e2', kind: 'half', dateISO: T }), T);
  s = registerJob(s, job(s, { elevatorId: 'e3', kind: 'half', dateISO: T }), T);
  s = registerJob(s, job(s, { elevatorId: 'e3', kind: 'selfcheck', checker: '王工', reviewer: '钱总', dateISO: T }), T);
  s = registerJob(s, job(s, { elevatorId: 'e1', kind: 'selfcheck', checker: '王工', reviewer: '钱总', dateISO: T }), T);
  for (const j of s.jobs) s = confirmJob(s, j.id, '张物业', T);
  s = { ...s, drills: [...s.drills, { id: 'd2', kind: 'traction_freight', dateISO: T, note: '' }, { id: 'd3', kind: 'escalator', dateISO: T, note: '' }] };
  s = recordPayment(s, { elevatorId: 'e1', month: '2026-09', amount: 1200, paidISO: T });
  s = recordPayment(s, { elevatorId: 'e2', month: '2026-09', amount: 900, paidISO: T });
  s = recordPayment(s, { elevatorId: 'e3', month: '2026-09', amount: 1500, paidISO: T });

  const c2 = selfCheck(s, { dateISO: T, time: '12:00' });
  assert.equal(c2.items.find((i) => i.key === 'overdue').level, 'green');
  assert.equal(c2.items.find((i) => i.key === 'confirm').level, 'green');
  assert.equal(c2.items.find((i) => i.key === 'drill').level, 'green');
  assert.equal(c2.items.find((i) => i.key === 'inspection').level, 'green');
  assert.equal(c2.items.find((i) => i.key === 'cert').level, 'green');
  assert.equal(c2.items.find((i) => i.key === 'fee').level, 'green');
  assert.equal(c2.redCount, 0);
  assert.equal(c2.score, 100);
});

test('selfCheck：救援超时计入红灯', () => {
  let s = newState();
  s = { ...s, incidents: [{ id: 'i1', elevatorId: 'e1', kind: 'trapped', reportDate: T, reportTime: '10:00', arriveDate: T, arriveTime: '10:45', fixedDate: T, fixedTime: '11:00' }] };
  const c = selfCheck(s, { dateISO: T, time: '12:00' });
  assert.equal(c.items.find((i) => i.key === 'rescue').level, 'red');
  assert.equal(c.items.find((i) => i.key === 'rescue').count, 1);
});

// ---------------------------------------------------------------------------
// 出证
// ---------------------------------------------------------------------------

test('confirmText：含单号/设备代码/类别/异常处置/签字栏与条款注脚', () => {
  let s = newState();
  const items = itemsFor('traction_pass', 'half').map((i, idx) => ({ ...i, ok: idx !== 0, note: idx === 0 ? '应急照明失效，现场更换电池并复测正常' : '' }));
  s = registerJob(s, job(s, { dateISO: '2026-09-03', items }), T);
  const txt = confirmText(s.jobs[0], s.elevators[0], s.workers[0], s.company);
  assert.match(txt, /维保确认单/);
  assert.match(txt, /TSC-001/);
  assert.match(txt, /半月维护保养/);
  assert.match(txt, /（补录）/);
  assert.match(txt, /应急照明失效，现场更换电池并复测正常/);
  assert.match(txt, /使用单位安全管理人员签字/);
  assert.match(txt, /TSG T5002-2017/);
});

test('confirmHtml 与 packHtml：关键信息在位且全部转义', () => {
  let s = newState();
  s = registerJob(s, job(s, { dateISO: T }), T);
  const html = confirmHtml(s.jobs[0], s.elevators[0], s.workers[0], s.company);
  assert.match(html, /电梯维护保养确认单/);
  assert.match(html, /使用单位安全管理人员签字/);
  assert.ok(!html.includes('<script'), '不得含脚本');

  const malicious = newState();
  malicious.elevators[0] = { ...malicious.elevators[0], site: '阳光<img src=x onerror=alert(1)>物业' };
  malicious.company = { name: '惠民<script>alert(2)</script>电梯', phone: '' };
  const pack = packHtml(malicious, '阳光<img src=x onerror=alert(1)>物业', T);
  assert.match(pack, /迎检包/);
  assert.match(pack, /&lt;script&gt;/, '公司名被转义');
  assert.ok(!pack.includes('<script>alert'), '不得注入脚本');
});

// ---------------------------------------------------------------------------
// 事件流与备份
// ---------------------------------------------------------------------------

test('logEvent 截断到 500 条；exportBundle/importBundle 往返一致且拒绝异源文件', () => {
  let s = newState();
  for (let i = 0; i < 520; i += 1) s = logEvent(s, 'test', { i }, T);
  assert.equal(s.events.length, 500);

  s = registerJob(s, job(s), T);
  const raw = exportBundle(s);
  const back = importBundle(raw);
  assert.deepEqual(back.jobs, s.jobs);
  assert.equal(back.company.name, '惠民电梯工程');
  assert.throws(() => importBundle('{"app":"other","version":1,"state":{}}'), /不是梯保单/);
  assert.throws(() => importBundle('not json'), /JSON/);
  assert.throws(() => importBundle(JSON.stringify({ app: 'lift-sheet', version: 99, state: {} })), /版本不兼容/);
});

test('emptyStateFields 版本号一致且 settings 可覆盖合并', () => {
  assert.equal(emptyStateFields().version, STATE_VERSION);
  assert.deepEqual(CYCLE_DEFAULTS, { half: 15, quarter: 92, halfyear: 183, yearly: 365 });
});

test('todayISO 可注入确定性时钟', () => {
  assert.equal(todayISO(new Date('2026-09-05T20:00:00+08:00')), '2026-09-05');
});
