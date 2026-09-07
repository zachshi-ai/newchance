/**
 * tests/core.test.mjs — 叉车账 ForkLog 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addMonthsExact, daysUntil, monthKey, isoWeekKey, escapeHtml,
  VEHICLE_KINDS, INSPECT_CYCLE_MONTHS, INSPECT_APPLY_ADVANCE_DAYS, CERT_VALID_YEARS,
  REEXAM_ADVANCE_DAYS, REG_WITHIN_DAYS, HAZARD_SEVERITIES, HAZARD_SOURCES, DUTY_KINDS,
  PATROL_RESULT, DEFAULT_APPLY_ADVANCE_DAYS, DEFAULT_REEXAM_WARN_DAYS, DEFAULT_PATROL_GAP_DAYS,
  dutyRosterState,
  addVehicle, activeVehicles, inspectState, recordInspection,
  markModified, fileChangeReg, scrapVehicle, cancelVehicle, regState,
  addDriver, setDriverActive, activeDrivers, certState,
  addPatrol, removePatrol, patrolDone, patrolToday, patrolGapDays,
  addWeekly, addMonthly, weeklyDone, monthlyDone,
  addHazard, fixHazard, closeHazard, openHazards, openHazardsOf,
  dispatchGate, addWorkOrder, removeWorkOrder,
  setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary, inspectHtml, dispatchHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';
import { emptyState } from '../app/js/store.js';

const T = '2026-09-08'; // 测试锚定日期（周二），不依赖墙钟

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-8'));
  assert.throws(() => assertISO('20260908'));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
});

test('addDays 跨月/跨年收敛', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('addMonthsExact 精确到月且月末钳制（1/31+12 个月不溢出、2/29+12 钳到 2/28）', () => {
  assert.equal(addMonthsExact('2024-08-31', 24), '2026-08-31');
  assert.equal(addMonthsExact('2024-01-31', 12), '2025-01-31');
  assert.equal(addMonthsExact('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonthsExact('2026-05-15', 24), '2028-05-15');
  assert.equal(addMonthsExact('2026-01-31', 1), '2026-02-28');
  assert.throws(() => addMonthsExact('2026-01-31', 0));
});

test('daysUntil 与 monthKey 跨年正确', () => {
  assert.equal(daysUntil('2026-12-31', T), 114);
  assert.equal(daysUntil('2026-09-08', T), 0);
  assert.equal(daysUntil('2026-09-07', T), -1);
  assert.equal(monthKey('2026-09-08'), '2026-09');
});

test('isoWeekKey：2026-09-08 是 2026-W37；跨年周归下一年（2026-12-28 周是 2027-W01 的一部分）', () => {
  assert.equal(isoWeekKey('2026-09-08'), '2026-W37');
  assert.equal(isoWeekKey('2026-09-07'), '2026-W37');   // 周一同周
  assert.equal(isoWeekKey('2026-09-13'), '2026-W37');   // 周日同周
  assert.equal(isoWeekKey('2026-09-14'), '2026-W38');   // 下周一
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
  assert.equal(isoWeekKey('2026-12-28'), '2026-W53');   // 2026 年有 53 个 ISO 周（元旦是周四）
  assert.equal(isoWeekKey('2025-12-29'), '2026-W01');   // 周四落在 2026 → 归 2026
});

test('escapeHtml 全转义；常量基线与法定常数', () => {
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  assert.deepEqual(Object.keys(VEHICLE_KINDS), ['forklift', 'sightseeing']);
  assert.deepEqual(INSPECT_CYCLE_MONTHS, { forklift: 24, sightseeing: 12 }); // TSG 81—2022 4.2.1.2
  assert.equal(INSPECT_APPLY_ADVANCE_DAYS, 30);  // 特设法第 40 条：届满前 1 个月
  assert.equal(CERT_VALID_YEARS, 4);             // TSG Z6001—2019
  assert.equal(REEXAM_ADVANCE_DAYS, 30);         // 届满 1 个月以前申请复审
  assert.equal(REG_WITHIN_DAYS, 30);             // 特设法第 33 条
  assert.deepEqual(Object.keys(HAZARD_SEVERITIES).sort(), ['general', 'serious']);
  assert.deepEqual(Object.keys(HAZARD_SOURCES).sort(), ['daily', 'manual', 'monthly', 'weekly']);
  assert.deepEqual(Object.keys(DUTY_KINDS), ['training', 'drill', 'risklist']);
  assert.deepEqual(Object.keys(PATROL_RESULT).sort(), ['found', 'ok']);
  assert.equal(DEFAULT_APPLY_ADVANCE_DAYS, 30);
  assert.equal(DEFAULT_REEXAM_WARN_DAYS, 60);
  assert.equal(DEFAULT_PATROL_GAP_DAYS, 2);
});

// ---------------------------------------------------------------------------
// 建档：两员配备 + 车辆一车一档 + 定检钟
// ---------------------------------------------------------------------------

test('dutyRosterState：两员未配=unset；缺一=unset；未逐台绑定=warn；齐备=ok', () => {
  assert.equal(dutyRosterState({}, []).level, 'unset');
  assert.equal(dutyRosterState({ directorName: '周敏' }, []).level, 'unset');
  const warn = dutyRosterState({ directorName: '周敏', officerName: '王铁柱' }, [{ plateNo: 'A' }, { plateNo: 'B', keeperName: '王' }]);
  assert.equal(warn.level, 'warn');
  assert.equal(warn.unbound, 1);
  const ok = dutyRosterState({ directorName: '周敏', officerName: '王铁柱' }, [{ keeperName: '王铁柱' }]);
  assert.equal(ok.level, 'ok');
});

test('addVehicle：编号与品种必填；同编号拒绝；定检到期日自动按品种推导', () => {
  const s = emptyState();
  assert.throws(() => addVehicle(s, { plateNo: '', kind: 'forklift' }));
  assert.throws(() => addVehicle(s, { plateNo: 'X', kind: 'truck' }));
  const v = addVehicle(s, { plateNo: '叉车 01', kind: 'forklift', lastInspectISO: '2024-08-31' });
  assert.equal(v.inspectionDueISO, '2026-08-31');        // 2 年、月末不溢出
  const v2 = addVehicle(s, { plateNo: '观光车 01', kind: 'sightseeing', lastInspectISO: '2025-09-08' });
  assert.equal(v2.inspectionDueISO, '2026-09-08');       // 观光车 1 年
  assert.throws(() => addVehicle(s, { plateNo: '叉车 01', kind: 'forklift' }));
  assert.equal(activeVehicles(s).length, 2);
});

test('inspectState：unset/overdue/due/ok 四态；定检过期=不得继续使用；提前量参数化', () => {
  const mk = (due) => ({ plateNo: 'X', kind: 'forklift', inspectionDueISO: due, scrappedISO: '' });
  assert.equal(inspectState(mk(''), T).level, 'unset');
  const over = inspectState(mk('2026-09-01'), T);
  assert.equal(over.level, 'overdue');
  assert.match(over.detail, /不得继续使用/);
  const due = inspectState(mk('2026-09-20'), T);
  assert.equal(due.level, 'due');                        // 12 天 ≤ 30
  const ok = inspectState(mk('2027-01-01'), T);
  assert.equal(ok.level, 'ok');
  assert.equal(inspectState(mk('2026-09-20'), T, 7).level, 'ok'); // 提前量调小后转绿
  assert.equal(inspectState({ inspectionDueISO: '2027-01-01', scrappedISO: T }, T).level, 'none');
});

test('recordInspection：合格日滚动定检钟；报废车拒绝', () => {
  const s = emptyState();
  const v = addVehicle(s, { plateNo: '叉车 01', kind: 'forklift', lastInspectISO: '2024-09-08' });
  recordInspection(s, v.id, '2026-09-08', '报告编号 J-1');
  assert.equal(s.vehicles[0].inspectionDueISO, '2028-09-08');
  scrapVehicle(s, v.id, T);
  assert.throws(() => recordInspection(s, v.id, T));
  assert.throws(() => recordInspection(s, 'vh-99', T));
});

test('regState：无证号 unset；投用 30 日内 due；超期 overdue 罚 1 万~10 万口径', () => {
  assert.equal(regState({ regNo: 'X', firstUseISO: '' }, T).level, 'ok');
  assert.equal(regState({ regNo: '', firstUseISO: '' }, T).level, 'unset');
  const due = regState({ regNo: '', firstUseISO: '2026-08-25' }, T);
  assert.equal(due.level, 'due');
  assert.equal(due.deadline, '2026-09-24');
  const over = regState({ regNo: '', firstUseISO: '2026-07-01' }, T);
  assert.equal(over.level, 'overdue');
  assert.match(over.detail, /1 万~10 万/);
});

test('改造→变更登记闭环：未变更前标记在、日期倒挂拒绝', () => {
  const s = emptyState();
  const v = addVehicle(s, { plateNo: '叉车 01', kind: 'forklift' });
  assert.throws(() => fileChangeReg(s, v.id, T));            // 未改造不能办变更
  markModified(s, v.id, '2026-09-01');
  assert.throws(() => fileChangeReg(s, v.id, '2026-08-31')); // 早于改造日
  fileChangeReg(s, v.id, T);
  assert.equal(s.vehicles[0].changeRegISO, T);
});

test('报废注销：先报废后注销；日期倒挂拒绝；重复报废拒绝', () => {
  const s = emptyState();
  const v = addVehicle(s, { plateNo: '叉车 01', kind: 'forklift' });
  assert.throws(() => cancelVehicle(s, v.id, T));  // 未报废不能注销
  scrapVehicle(s, v.id, '2026-09-01');
  assert.throws(() => scrapVehicle(s, v.id, T));
  assert.throws(() => cancelVehicle(s, v.id, '2026-08-31'));
  cancelVehicle(s, v.id, T);
  assert.equal(s.vehicles[0].cancelISO, T);
});

// ---------------------------------------------------------------------------
// 司机名册与 N1 证钟
// ---------------------------------------------------------------------------

test('addDriver：姓名证号必填；同姓名同证号拒绝；停用后不在 activeDrivers', () => {
  const s = emptyState();
  const d = addDriver(s, { name: '王铁柱', certNo: 'N1-1', expiryISO: '2028-01-01' });
  assert.throws(() => addDriver(s, { name: '', certNo: 'X' }));
  assert.throws(() => addDriver(s, { name: '李四', certNo: '' }), /N1 证号/);
  assert.throws(() => addDriver(s, { name: '王铁柱', certNo: 'N1-1' }));
  assert.equal(activeDrivers(s).length, 1);
  setDriverActive(s, d.id, false);
  assert.equal(activeDrivers(s).length, 0);
  assert.throws(() => setDriverActive(s, 'dr-99', true));
});

test('certState：unset/expired/window/warn/ok 五态；窗口=届满 30 天（TSG Z6001—2019 口径）', () => {
  assert.equal(certState({ expiryISO: '' }, T).level, 'unset');
  const exp = certState({ expiryISO: '2026-09-01' }, T);
  assert.equal(exp.level, 'expired');
  assert.match(exp.detail, /重新考试/);
  const win = certState({ expiryISO: '2026-09-25' }, T);   // 17 天 → window
  assert.equal(win.level, 'window');
  assert.match(win.detail, /届满 1 个月以前/);
  assert.equal(certState({ expiryISO: '2026-10-20' }, T).level, 'warn');  // 42 天 → warn
  assert.equal(certState({ expiryISO: '2027-09-08' }, T).level, 'ok');
  assert.equal(certState({ expiryISO: '2026-10-13' }, T, 45).level, 'warn'); // 35 天：窗口(30)外、提醒(45)内
});

// ---------------------------------------------------------------------------
// 日管控（零风险报告：同日同车唯一；发现隐患自动挂出）
// ---------------------------------------------------------------------------

test('addPatrol：同日同车唯一；发现隐患必须写异常；自动挂一般隐患进闭环', () => {
  const s = emptyState();
  const v = addVehicle(s, { plateNo: '叉车 01', kind: 'forklift' });
  const p = addPatrol(s, { dateISO: T, vehicleId: v.id, checkerName: '王铁柱', result: 'ok' });
  assert.equal(p.result, 'ok');
  assert.throws(() => addPatrol(s, { dateISO: T, vehicleId: v.id, checkerName: '王铁柱' }), /唯一/);
  assert.throws(() => addPatrol(s, { dateISO: '2026-09-09', vehicleId: v.id, checkerName: '' }));
  assert.throws(() => addPatrol(s, { dateISO: '2026-09-09', vehicleId: v.id, checkerName: '王', result: 'found' }), /异常/);
  const p2 = addPatrol(s, { dateISO: '2026-09-09', vehicleId: v.id, checkerName: '王铁柱', result: 'found', findings: '制动偏软', action: '停用报修' });
  assert.equal(p2.result, 'found');
  assert.equal(s.hazards.length, 1);                       // 自动挂出
  assert.equal(s.hazards[0].severity, 'general');
  assert.equal(s.hazards[0].source, 'daily');
  assert.equal(s.hazards[0].status, 'open');
  assert.throws(() => addPatrol(s, { dateISO: T, vehicleId: 'vh-99', checkerName: '王' }));
  removePatrol(s, p.id);
  assert.throws(() => removePatrol(s, p.id));
});

test('patrolToday/patrolGapDays：完成率与断卡天数（0 - daysUntil 防 -0）', () => {
  const s = emptyState();
  const v1 = addVehicle(s, { plateNo: 'A', kind: 'forklift' });
  const v2 = addVehicle(s, { plateNo: 'B', kind: 'forklift' });
  addPatrol(s, { dateISO: T, vehicleId: v1.id, checkerName: '王' });
  const pt = patrolToday(s, T);
  assert.deepEqual({ done: pt.done, total: pt.total }, { done: 1, total: 2 });
  assert.equal(patrolGapDays(s, T), 0);
  assert.equal(patrolDone(s, T, v2.id), false);
  assert.equal(patrolGapDays(emptyState(), T), null);      // 从未打卡
});

// ---------------------------------------------------------------------------
// 周排查与月调度（同周/同月唯一）
// ---------------------------------------------------------------------------

test('addWeekly：同 ISO 周唯一；主持人内容必填', () => {
  const s = emptyState();
  addWeekly(s, { dateISO: '2026-09-07', hostName: '周敏', content: '全厂通道排查' });
  assert.throws(() => addWeekly(s, { dateISO: T, hostName: '周敏', content: '同周再来一次' })); // 09-08 与 09-07 同为 W37
  assert.throws(() => addWeekly(s, { dateISO: '2026-09-14', hostName: '', content: 'x' }));
  assert.throws(() => addWeekly(s, { dateISO: '2026-09-14', hostName: '周敏', content: '' }));
  addWeekly(s, { dateISO: '2026-09-14', hostName: '周敏', content: '下周排查' });
  assert.equal(s.weeklies.length, 2);
});

test('addMonthly：同月唯一；weeklyDone/monthlyDone 判定', () => {
  const s = emptyState();
  addMonthly(s, { dateISO: T, hostName: '刘建国', content: '听取月度汇报' });
  assert.throws(() => addMonthly(s, { dateISO: '2026-09-20', hostName: '刘建国', content: 'x' }), /唯一/);
  assert.equal(monthlyDone(s, T), true);
  assert.equal(monthlyDone(s, '2026-10-01'), false);
  assert.equal(weeklyDone(s, T), false);
});

// ---------------------------------------------------------------------------
// 隐患闭环状态机（open → fixed → closed，跳级拒绝）
// ---------------------------------------------------------------------------

test('addHazard：描述必填；严重程度与来源校验；openHazards 严重在前最老在前', () => {
  const s = emptyState();
  const v = addVehicle(s, { plateNo: 'A', kind: 'forklift' });
  assert.throws(() => addHazard(s, { dateISO: T, desc: '' }));
  assert.throws(() => addHazard(s, { dateISO: T, desc: 'x', severity: 'huge' }));
  assert.throws(() => addHazard(s, { dateISO: T, desc: 'x', source: 'boss' }));
  assert.throws(() => addHazard(s, { dateISO: T, desc: 'x', vehicleId: 'vh-99' }));
  const h1 = addHazard(s, { dateISO: '2026-09-01', desc: '一般隐患', vehicleId: v.id });
  const h2 = addHazard(s, { dateISO: T, desc: '严重隐患', vehicleId: v.id, severity: 'serious' });
  const open = openHazards(s);
  assert.deepEqual(open.map((h) => h.id), [h2.id, h1.id]); // 严重在前
  assert.deepEqual(openHazardsOf(s, v.id).length, 2);
});

test('fixHazard/closeHazard：跳级拒绝、日期倒挂拒绝、空措施拒绝、一次闭环', () => {
  const s = emptyState();
  const h = addHazard(s, { dateISO: '2026-09-01', desc: '制动渗油' });
  assert.throws(() => closeHazard(s, h.id, { verifyISO: T, verifiedBy: '周敏' })); // open 直接销案=跳级
  assert.throws(() => fixHazard(s, h.id, { actionISO: T, action: '' }));            // 空措施
  assert.throws(() => fixHazard(s, h.id, { actionISO: '2026-08-31', action: 'x' })); // 早于发现日
  fixHazard(s, h.id, { actionISO: T, action: '更换制动管路' });
  assert.equal(s.hazards[0].status, 'fixed');
  assert.throws(() => fixHazard(s, h.id, { actionISO: T, action: '重复整改' }));
  assert.throws(() => closeHazard(s, h.id, { verifyISO: '2026-09-07', verifiedBy: '周' })); // 早于整改日
  assert.throws(() => closeHazard(s, h.id, { verifyISO: T, verifiedBy: '' }));
  closeHazard(s, h.id, { verifyISO: T, verifiedBy: '周敏' });
  assert.equal(s.hazards[0].status, 'closed');
  assert.throws(() => closeHazard(s, h.id, { verifyISO: T, verifiedBy: '再次销案' }));
  assert.equal(openHazards(s).length, 0);
});

// ---------------------------------------------------------------------------
// 派工闸（产品的门禁：五道闸逐一验证）
// ---------------------------------------------------------------------------

test('dispatchGate：司机未登记/停用/证失效逐一拦截', () => {
  const s = emptyState();
  const v = addVehicle(s, { plateNo: 'A', kind: 'forklift', regNo: 'R1', lastInspectISO: '2026-08-01' });
  addPatrol(s, { dateISO: T, vehicleId: v.id, checkerName: '王', result: 'ok' });
  let gate = dispatchGate(s, { dateISO: T, vehicleId: v.id, driverId: '' });
  assert.equal(gate.ok, false);
  assert.match(gate.reasons[0], /名册/);
  const d1 = addDriver(s, { name: '王铁柱', certNo: 'N1-1', expiryISO: '2028-01-01' });
  gate = dispatchGate(s, { dateISO: T, vehicleId: v.id, driverId: d1.id });
  assert.equal(gate.ok, true);
  setDriverActive(s, d1.id, false);
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v.id, driverId: d1.id }).reasons.join(), /停用/);
  setDriverActive(s, d1.id, true);
  const d2 = addDriver(s, { name: '李有才', certNo: 'N1-2', expiryISO: '2026-09-01' });
  gate = dispatchGate(s, { dateISO: T, vehicleId: v.id, driverId: d2.id });
  assert.match(gate.reasons.join(), /失效/);
  const d3 = addDriver(s, { name: '赵无证', certNo: 'N1-3', expiryISO: '' });
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v.id, driverId: d3.id }).reasons.join(), /未登记 N1 证有效期/);
});

test('dispatchGate：未登记/定检过期/改造未变更/报废/隐患未闭环/当日缺卡逐一拦截', () => {
  const s = emptyState();
  const d = addDriver(s, { name: '王铁柱', certNo: 'N1-1', expiryISO: '2028-01-01' });
  // 未登记
  const v1 = addVehicle(s, { plateNo: 'A', kind: 'forklift', lastInspectISO: '2026-08-01' });
  addPatrol(s, { dateISO: T, vehicleId: v1.id, checkerName: '王' });
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v1.id, driverId: d.id }).reasons.join(), /使用登记/);
  v1.regNo = 'R1';
  // 定检过期
  v1.inspectionDueISO = '2026-09-01';
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v1.id, driverId: d.id }).reasons.join(), /不得继续使用/);
  v1.inspectionDueISO = '2027-09-01';
  // 定检未录入
  const v2 = addVehicle(s, { plateNo: 'B', kind: 'forklift', regNo: 'R2' });
  addPatrol(s, { dateISO: T, vehicleId: v2.id, checkerName: '王' });
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v2.id, driverId: d.id }).reasons.join(), /定检/);
  v2.inspectionDueISO = '2027-09-01';
  // 改造未变更
  markModified(s, v2.id, '2026-09-01');
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v2.id, driverId: d.id }).reasons.join(), /变更/);
  fileChangeReg(s, v2.id, T);
  // 隐患未闭环（一般）
  addHazard(s, { dateISO: T, vehicleId: v2.id, desc: '链条异响' });
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v2.id, driverId: d.id }).reasons.join(), /一般隐患/);
  // 严重隐患（停用闸）；已整改未复查的一般隐患仍算未闭环（先复查销案）
  const hz = openHazardsOf(s, v2.id)[0];
  fixHazard(s, hz.id, { actionISO: T, action: '润滑' });
  const hz2 = addHazard(s, { dateISO: T, vehicleId: v2.id, desc: '制动失灵', severity: 'serious' });
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v2.id, driverId: d.id }).reasons.join(), /停止使用/); // 严重优先遮蔽一般
  closeHazard(s, hz.id, { verifyISO: T, verifiedBy: '周' });   // 先销一般隐患也不放行严重隐患前的次序问题——见下两行
  fixHazard(s, hz2.id, { actionISO: T, action: '更换制动管路并试车' });
  closeHazard(s, hz2.id, { verifyISO: T, verifiedBy: '周' });
  assert.equal(dispatchGate(s, { dateISO: T, vehicleId: v2.id, driverId: d.id }).ok, true);
  // 当日缺卡
  const v3 = addVehicle(s, { plateNo: 'C', kind: 'forklift', regNo: 'R3', lastInspectISO: '2025-09-08' });
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v3.id, driverId: d.id }).reasons.join(), /日管控巡检卡/);
  addPatrol(s, { dateISO: T, vehicleId: v3.id, checkerName: '王' });
  assert.equal(dispatchGate(s, { dateISO: T, vehicleId: v3.id, driverId: d.id }).ok, true);
  // 报废
  scrapVehicle(s, v3.id, T);
  assert.match(dispatchGate(s, { dateISO: T, vehicleId: v3.id, driverId: d.id }).reasons.join(), /报废/);
});

test('addWorkOrder：闸机通过才落账并带快照；闸机拒绝抛错含理由；删除自救', () => {
  const s = emptyState();
  const v = addVehicle(s, { plateNo: 'A', kind: 'forklift', regNo: 'R1', lastInspectISO: '2026-08-01' });
  const d = addDriver(s, { name: '王铁柱', certNo: 'N1-1', expiryISO: '2028-01-01' });
  assert.throws(() => addWorkOrder(s, { dateISO: T, vehicleId: v.id, driverId: d.id }), /日管控巡检卡/);
  addPatrol(s, { dateISO: T, vehicleId: v.id, checkerName: '王' });
  const wo = addWorkOrder(s, { dateISO: T, vehicleId: v.id, driverId: d.id, task: '月台卸货' });
  assert.equal(wo.snapshot.inspectionDueISO, '2028-08-01');
  assert.equal(wo.snapshot.certExpiryISO, '2028-01-01');
  assert.equal(s.workOrders.length, 1);
  removeWorkOrder(s, wo.id);
  assert.throws(() => removeWorkOrder(s, wo.id));
});

// ---------------------------------------------------------------------------
// 周期义务
// ---------------------------------------------------------------------------

test('dutyBoard：never/overdue 红灯前置，打勾滚动下一周期', () => {
  const s = emptyState();
  setDutyDone(s, 'risklist', '2026-02-01', '半年评审');      // 180 天周期 → 逾期
  setDutyDone(s, 'training', '2026-06-01');                  // 365 天 → ok
  const board = dutyBoard(s, T);
  assert.equal(board[0].level, 'overdue');
  assert.equal(board[0].kind, 'risklist');
  assert.equal(board[1].level, 'ok');
  assert.throws(() => setDutyDone(s, 'party', T));
  assert.equal(dutyState({ kind: 'risklist', lastDoneISO: '2026-03-13' }, T).level, 'due'); // 180 天周期，剩 1 天 ≤ 30
  assert.equal(dutyState({ kind: 'risklist' }, T).level, 'never');
});

// ---------------------------------------------------------------------------
// 账本体检（确定性打分）
// ---------------------------------------------------------------------------

test('healthCheck：空档（种子前）确定性低分；种子后红灯精确点名', () => {
  const s = emptyState();
  s.station = { name: '某物流园', directorName: '周敏', officerName: '王铁柱' };
  const hc = healthCheck(s, T);
  const byKey = Object.fromEntries(hc.items.map((i) => [i.key, i.level]));
  assert.equal(byKey.reg, 'bad');         // 无车辆建档
  assert.equal(byKey.cert, 'bad');        // 名册为空
  assert.equal(byKey.daily, 'ok');        // 无对象视为 ok
  assert.equal(byKey.weekly, 'warn');
  assert.equal(byKey.monthly, 'warn');
  assert.equal(byKey.duty, 'warn');       // 义务从未登记=从未开展
  assert.equal(hc.bad, 2);
  assert.equal(hc.warn, 3);
  assert.equal(hc.score, 100 - 2 * 12 - 3 * 4);
});

test('healthCheck：全绿满分路径（登记/定检/证照/两员/日管控/周月/无隐患/义务）', () => {
  const s = emptyState();
  s.station = { name: '某物流园', directorName: '周敏', officerName: '王铁柱' };
  const v = addVehicle(s, { plateNo: 'A', kind: 'forklift', regNo: 'R1', lastInspectISO: '2026-08-01', keeperName: '王铁柱' });
  const d = addDriver(s, { name: '王铁柱', certNo: 'N1-1', expiryISO: '2028-01-01' });
  addPatrol(s, { dateISO: T, vehicleId: v.id, checkerName: '王铁柱' });
  addWorkOrder(s, { dateISO: T, vehicleId: v.id, driverId: d.id });
  addWeekly(s, { dateISO: T, hostName: '周敏', content: '排查' });
  addMonthly(s, { dateISO: T, hostName: '刘建国', content: '调度' });
  setDutyDone(s, 'training', T);
  setDutyDone(s, 'drill', T);
  setDutyDone(s, 'risklist', T);
  const hc = healthCheck(s, T);
  assert.equal(hc.bad, 0);
  assert.equal(hc.warn, 0);
  assert.equal(hc.score, 100);
});

// ---------------------------------------------------------------------------
// 月度小结与出证物
// ---------------------------------------------------------------------------

test('monthlySummary：确定性文本（派工/日管控/周月文书/隐患/点名段 + 口径尾注）', () => {
  const s = emptyState();
  s.station = { name: '城东云仓物流园', directorName: '周敏', officerName: '王铁柱' };
  const v = addVehicle(s, { plateNo: 'A', kind: 'forklift', regNo: 'R1', lastInspectISO: '2026-08-01', keeperName: '王' });
  const d = addDriver(s, { name: '王铁柱', certNo: 'N1-1', expiryISO: '2028-01-01' });
  addPatrol(s, { dateISO: T, vehicleId: v.id, checkerName: '王铁柱' });
  addWorkOrder(s, { dateISO: T, vehicleId: v.id, driverId: d.id, task: '卸货' });
  addWeekly(s, { dateISO: T, hostName: '周敏', content: '排查' });
  addMonthly(s, { dateISO: T, hostName: '刘建国', content: '调度' });
  const hz = addHazard(s, { dateISO: T, desc: '链条异响' });
  fixHazard(s, hz.id, { actionISO: T, action: '润滑' });
  closeHazard(s, hz.id, { verifyISO: T, verifiedBy: '周敏' });
  const sum = monthlySummary(s, '2026-09', T);
  assert.match(sum.text, /【场车使用安全月度小结】2026-09/);
  assert.match(sum.text, /派工 1 单/);
  assert.match(sum.text, /日管控巡检打卡 1 台·日/);
  assert.match(sum.text, /周排查 1 次、月调度 1 次/);
  assert.match(sum.text, /已整改销案 1 项/);
  assert.match(sum.text, /生成：叉车账 · 2026-09/);
  assert.equal(sum.orders, 1);
  assert.throws(() => monthlySummary(s, '2026-9', T));
});

test('inspectHtml：单文件无外部资源、含签字栏与全部十段、XSS 转义', () => {
  const s = emptyState();
  s.station = { name: '<script>alert(1)</script>物流园', directorName: '周敏', officerName: '王铁柱' };
  const v = addVehicle(s, { plateNo: '<img src=x onerror=alert(1)>', kind: 'forklift', regNo: 'R1', lastInspectISO: '2026-08-01', keeperName: '王' });
  const d = addDriver(s, { name: '王铁柱', certNo: 'N1-1', expiryISO: '2028-01-01' });
  addPatrol(s, { dateISO: T, vehicleId: v.id, checkerName: '王铁柱' });
  addWorkOrder(s, { dateISO: T, vehicleId: v.id, driverId: d.id });
  const html = inspectHtml(s, T);
  assert.ok(!/src="https?:/.test(html), '出证物不得引用外部资源');
  assert.ok(!/href="https?:/.test(html), '出证物不得引用外部资源');
  assert.ok(html.includes('签字/盖章'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('一车一档'));
  assert.ok(html.includes('日管控巡检记录'));
  assert.ok(html.includes('月调度'));
});

test('dispatchHtml：派工单含闸机核对快照与签字栏；缺记录拒绝', () => {
  const s = emptyState();
  s.station = { name: '城东云仓物流园' };
  const v = addVehicle(s, { plateNo: 'A', kind: 'forklift', regNo: 'R1', lastInspectISO: '2026-08-01' });
  const d = addDriver(s, { name: '王铁柱', certNo: 'N1-9', expiryISO: '2028-01-01' });
  addPatrol(s, { dateISO: T, vehicleId: v.id, checkerName: '王铁柱' });
  const wo = addWorkOrder(s, { dateISO: T, vehicleId: v.id, driverId: d.id, task: '月台卸货' });
  const html = dispatchHtml(s, wo.id, T);
  assert.ok(html.includes('N1-9'));
  assert.ok(html.includes('落账时闸机核对快照'));
  assert.ok(html.includes('零风险报告'));
  assert.ok(!/src="https?:/.test(html));
  assert.throws(() => dispatchHtml(s, 'wo-99', T));
});

// ---------------------------------------------------------------------------
// 数据导入导出
// ---------------------------------------------------------------------------

test('导出→导入往返一致；外来文件/坏 JSON/高版本整体拒绝', () => {
  const s = emptyState();
  s.station = { name: '某物流园', directorName: '周敏', officerName: '王铁柱' };
  const v = addVehicle(s, { plateNo: 'A', kind: 'forklift', regNo: 'R1' });
  addDriver(s, { name: '王铁柱', certNo: 'N1-1' });
  const bundle = exportBundle(s);
  const back = importBundle(bundle);
  assert.equal(back.ok, true);
  assert.equal(back.state.vehicles.length, 1);
  assert.equal(back.state.drivers[0].name, '王铁柱');
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'other', version: 1, state: {} })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'forklog', version: 99, state: {} })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'forklog', version: 1, state: { station: null } })).ok, false);
  assert.equal(STATE_VERSION, 1);
});

test('todayISO 使用本地时区（注入 Date 保持确定性）', () => {
  const d = new Date('2026-09-08T20:30:00+08:00');
  assert.equal(todayISO(d), '2026-09-08');
  const d2 = new Date('2026-09-08T23:30:00Z');
  const expected = new Date(d2.getTime() - d2.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  assert.equal(todayISO(d2), expected);
});
