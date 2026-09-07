/**
 * tests/core.test.mjs — 兽诊账 VetLedger 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addWorkdays, daysUntil, monthKey, fmtYuan, escapeHtml,
  STAFF_TYPES, EVENT_KINDS, EVENT_SEVERITIES, WASTE_KINDS, DRUG_KINDS, DUTY_KINDS,
  RECORD_KEEP_YEARS, RX_KEEP_YEARS, CHANGE_WORKDAYS, ANNUAL_REPORT_MMDD,
  DEFAULT_COLD_MIN_C, DEFAULT_COLD_MAX_C, DEFAULT_WASTE_MOVE_DAYS, DEFAULT_GAP_DAYS,
  postingState, changeState,
  addStaff, setStaffActive, activeStaff, prescribers,
  addVisit, removeVisit, lastVisitISO, visitGapDays, rxViolations,
  addDrug, removeDrug, assertBatchUsable, batchColor, freezeBatch, unfreezeBatch, expiryBoard,
  addColdchain, removeColdchain, excursions, coldchainToday, coldchainGapDays,
  addRabies,
  addWaste, moveWaste, openWastes, overdueWastes,
  addEvent, closeEvent, openEvents, lateEvents,
  setDutyDone, dutyState, dutyBoard,
  fileAnnualReport, annualReportState,
  healthCheck, monthlySummary, inspectHtml, caseHtml,
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

test('addWorkdays 跳过周末：周五起 15 个工作日 = 9 月 25 日', () => {
  assert.equal(addWorkdays('2026-09-04', 0), '2026-09-04');
  assert.equal(addWorkdays('2026-09-04', 1), '2026-09-07');   // 周末跳过
  assert.equal(addWorkdays('2026-09-04', 15), '2026-09-25');
  assert.equal(addWorkdays('2026-08-01', 15), '2026-08-21');
  assert.throws(() => addWorkdays('2026-09-04', -1));
});

test('daysUntil 与 monthKey 跨年正确', () => {
  assert.equal(daysUntil('2026-12-31', T), 114);
  assert.equal(daysUntil('2026-09-08', T), 0);
  assert.equal(daysUntil('2026-09-07', T), -1);
  assert.equal(monthKey('2026-09-08'), '2026-09');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('fmtYuan 只吃整数分；escapeHtml 全转义', () => {
  assert.equal(fmtYuan(129000), '¥1290.00');
  assert.equal(fmtYuan(305), '¥3.05');
  assert.throws(() => fmtYuan(12.5));
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

test('口径常量基线：人员/事件/医废/兽药/义务 + 法定常数', () => {
  assert.deepEqual(Object.keys(STAFF_TYPES), ['vet', 'assistant', 'rural']);
  assert.deepEqual(Object.keys(EVENT_KINDS).sort(), ['adverse', 'epidemic']);
  assert.deepEqual(Object.keys(EVENT_SEVERITIES).sort(), ['general', 'serious']);
  assert.deepEqual(Object.keys(WASTE_KINDS).sort(), ['clinic', 'dead-animal', 'pathology']);
  assert.deepEqual(Object.keys(DRUG_KINDS).sort(), ['drug', 'vaccine']);
  assert.deepEqual(Object.keys(DUTY_KINDS), ['disinfect', 'fridgeCheck', 'training']);
  assert.equal(RECORD_KEEP_YEARS, 3);   // 办法 2022-5 号第 22 条
  assert.equal(RX_KEEP_YEARS, 2);       // 处方药办法第 9 条
  assert.equal(CHANGE_WORKDAYS, 15);    // 办法 2022-5 号第 14 条
  assert.equal(ANNUAL_REPORT_MMDD, '03-31'); // 办法 2022-5 号第 30 条
  assert.equal(DEFAULT_COLD_MIN_C, 2);
  assert.equal(DEFAULT_COLD_MAX_C, 8);
  assert.equal(DEFAULT_WASTE_MOVE_DAYS, 2);
  assert.equal(DEFAULT_GAP_DAYS, 7);
});

// ---------------------------------------------------------------------------
// 证照公示与变更钟（办法 2022-5 号第 17/14 条）
// ---------------------------------------------------------------------------

test('postingState：无证号或未勾选公示都是 unset，落实后绿灯', () => {
  assert.equal(postingState({}).level, 'unset');
  assert.equal(postingState({ certNo: 'A1' }).level, 'unset');
  const ok = postingState({ certNo: '兽诊字第1号', posted: true });
  assert.equal(ok.level, 'ok');
  assert.match(ok.detail, /兽诊字第1号/);
});

test('changeState：无变更=none；未办按 15 个工作日倒计时（临期/逾期）；办妥=ok', () => {
  assert.equal(changeState({}, T).level, 'none');
  const due = changeState({ nameChangedISO: '2026-08-20' }, T); // 期限 2026-09-10，剩 2 天
  assert.equal(due.level, 'due');
  assert.equal(due.deadline, '2026-09-10');
  assert.equal(due.daysLeft, 2);
  const late = changeState({ nameChangedISO: '2026-08-01' }, T); // 期限 2026-08-21 已过
  assert.equal(late.level, 'overdue');
  assert.equal(late.daysLeft, -18);
  const done = changeState({ nameChangedISO: '2026-08-01', changeFiledISO: '2026-08-19' }, T);
  assert.equal(done.level, 'ok');
});

// ---------------------------------------------------------------------------
// 人员备案名册（处方闸的名册底座）
// ---------------------------------------------------------------------------

test('addStaff：类型校验、同姓名同类型拒绝、名册与可开方名单', () => {
  const s = emptyState();
  const vet = addStaff(s, { name: '张医生', type: 'vet', certNo: 'V1' });
  assert.equal(vet.id, 'st-1');
  addStaff(s, { name: '李助理', type: 'assistant' });
  assert.throws(() => addStaff(s, { name: '张医生', type: 'vet' }));
  assert.throws(() => addStaff(s, { name: '王五', type: 'boss' }));
  assert.equal(activeStaff(s).length, 2);
  assert.equal(prescribers(s).length, 1);
  setStaffActive(s, vet.id, false);
  assert.equal(prescribers(s).length, 0);
  assert.throws(() => setStaffActive(s, 'st-99', true));
});

// ---------------------------------------------------------------------------
// 诊疗台账（病历 + 处方闸）
// ---------------------------------------------------------------------------

test('addVisit 闸机：无名册人员拒绝；停用人员拒绝；处方药必须执业兽医师+处方编号', () => {
  const s = emptyState();
  const vet = addStaff(s, { name: '张医生', type: 'vet' });
  const assistant = addStaff(s, { name: '李助理', type: 'assistant' });
  // 无 doctorId
  assert.throws(() => addVisit(s, { dateISO: T, doctorId: '' }));
  // 不存在的人员
  assert.throws(() => addVisit(s, { dateISO: T, doctorId: 'st-99' }));
  // 助理 + 处方药 → 硬拒绝（办法 2022-6 号第 19 条）
  assert.throws(() => addVisit(s, { dateISO: T, doctorId: assistant.id, rxRequired: true, rxNo: 'CF-1' }), /不得开具/);
  // 兽医师 + 处方药但无处方编号 → 拒绝（处方药办法第 7 条）
  assert.throws(() => addVisit(s, { dateISO: T, doctorId: vet.id, rxRequired: true }), /处方笺编号/);
  // 正常：非处方药助理可落账
  const v1 = addVisit(s, { dateISO: T, doctorId: assistant.id, diagnosis: '体检' });
  assert.equal(v1.doctorType, 'assistant');
  // 正常：处方药凭方
  const v2 = addVisit(s, { dateISO: T, doctorId: vet.id, rxRequired: true, rxNo: 'CF-2026-001', rxItems: '甲硝唑' });
  assert.equal(v2.doctorName, '张医生');
  // 停用后新落账拒绝
  setStaffActive(s, vet.id, false);
  assert.throws(() => addVisit(s, { dateISO: T, doctorId: vet.id }), /停用/);
});

test('诊疗台账：删除自救、断更天数、处方缺口点名（引用校验在先）', () => {
  const s = emptyState();
  const vet = addStaff(s, { name: '张医生', type: 'vet' });
  addVisit(s, { dateISO: '2026-09-01', doctorId: vet.id });
  addVisit(s, { dateISO: '2026-09-05', doctorId: vet.id });
  assert.equal(lastVisitISO(s), '2026-09-05');
  assert.equal(visitGapDays(s, T), 3);
  removeVisit(s, 'vs-2');
  assert.equal(lastVisitISO(s), '2026-09-01');
  assert.equal(visitGapDays(s, T), 7);
  assert.throws(() => removeVisit(s, 'vs-99'));
  // 历史脏数据（直接注入）：处方药缺方 → 缺口点名
  s.visits.push({ id: 'vs-x', dateISO: '2026-08-01', doctorId: vet.id, doctorName: '张医生', doctorType: 'vet', rxRequired: true, rxNo: '' });
  assert.equal(rxViolations(s).length, 1);
  // 断更从未落账 → null
  const empty = emptyState();
  addStaff(empty, { name: '赵', type: 'vet' });
  assert.equal(visitGapDays(empty, T), null);
});

// ---------------------------------------------------------------------------
// 兽药与疫苗批台账（效期三色 + 冻结闸）
// ---------------------------------------------------------------------------

test('addDrug：过期批次不得入账在用、类别与数量校验、删除自救', () => {
  const s = emptyState();
  assert.throws(() => addDrug(s, { dateISO: T, name: 'X', expiryISO: '2026-09-01' }), /劣兽药/);
  assert.throws(() => addDrug(s, { dateISO: T, name: 'X', expiryISO: '2026-10-01', kind: 'food' }));
  assert.throws(() => addDrug(s, { dateISO: T, name: 'X', expiryISO: '2026-10-01', qty: -2 }));
  const d = addDrug(s, { dateISO: T, name: '狂犬疫苗', kind: 'vaccine', batchNo: 'R1', expiryISO: '2027-09-01', qty: 10 });
  assert.equal(d.id, 'dg-1');
  assert.equal(d.frozen, false);
  removeDrug(s, 'dg-1');
  assert.throws(() => removeDrug(s, 'dg-1'));
});

test('批次可用性闸：过期=劣兽药拒绝；冻结未解冻拒绝；解冻必须写结论', () => {
  const s = emptyState();
  addDrug(s, { dateISO: '2026-01-01', name: '过期药', batchNo: 'E1', expiryISO: '2026-09-01', qty: 1 });
  addDrug(s, { dateISO: '2026-01-01', name: '冻结药', batchNo: 'F1', expiryISO: '2027-09-01', qty: 1 });
  addDrug(s, { dateISO: '2026-01-01', name: '好药', batchNo: 'G1', expiryISO: '2027-09-01', qty: 1 });
  assert.throws(() => assertBatchUsable(s, 'dg-1', T), /劣兽药/);
  assert.throws(() => freezeBatch(s, 'dg-2', ''));   // 不写原因 → 拒绝
  freezeBatch(s, 'dg-2', '冷链超温待判定');
  assert.throws(() => assertBatchUsable(s, 'dg-2', T), /冻结/);
  assert.throws(() => unfreezeBatch(s, 'dg-2', '')); // 解冻必须写结论
  unfreezeBatch(s, 'dg-2', '厂家判定可用');
  assert.doesNotThrow(() => assertBatchUsable(s, 'dg-2', T));
  assert.throws(() => unfreezeBatch(s, 'dg-2', '再次解冻'));
  assert.doesNotThrow(() => assertBatchUsable(s, 'dg-3', T));
});

test('批次三色与效期点名：expired 在最前，urgent/near 分级', () => {
  const s = emptyState();
  addDrug(s, { dateISO: '2026-01-01', name: '近效期', expiryISO: '2026-11-01', qty: 1 });   // 54 天 → near
  addDrug(s, { dateISO: '2026-01-01', name: '急效期', expiryISO: '2026-09-20', qty: 1 });   // 12 天 → urgent
  addDrug(s, { dateISO: '2025-06-01', name: '过期批', expiryISO: '2026-06-01', qty: 1 });   // expired
  const board = expiryBoard(s, T);
  assert.deepEqual(board.map((d) => d.color), ['expired', 'urgent', 'near']);
  assert.equal(batchColor({ expiryISO: '2027-01-01' }, T), 'ok');
});

// ---------------------------------------------------------------------------
// 疫苗冷链（每日两次双录 + 超温处置闸）
// ---------------------------------------------------------------------------

test('冷链落账：同日同时段唯一；超温必须写处置；区间可参数化', () => {
  const s = emptyState();
  const c1 = addColdchain(s, { dateISO: T, slot: 'am', tempC: 4.5 });
  assert.equal(c1.excursion, false);
  assert.throws(() => addColdchain(s, { dateISO: T, slot: 'am', tempC: 5 }));
  assert.throws(() => addColdchain(s, { dateISO: T, slot: 'noon', tempC: 5 }));
  assert.throws(() => addColdchain(s, { dateISO: T, slot: 'pm', tempC: 60 }));
  assert.throws(() => addColdchain(s, { dateISO: T, slot: 'pm', tempC: 9.6 }));         // 超温无说明
  const c2 = addColdchain(s, { dateISO: T, slot: 'pm', tempC: 9.6, note: '门未关严已复位' });
  assert.equal(c2.excursion, true);
  // 自定义区间（按标签口径覆盖）
  const wide = addColdchain(s, { dateISO: '2026-09-07', slot: 'pm', tempC: -5, note: '' }, { minC: -10, maxC: 0 });
  assert.equal(wide.excursion, false);
  removeColdchain(s, c1.id);
  assert.throws(() => removeColdchain(s, c1.id));
});

test('冷链双录状态与断录天数；超温点名排序', () => {
  const s = emptyState();
  addColdchain(s, { dateISO: T, slot: 'am', tempC: 4 });
  const today = coldchainToday(s, T);
  assert.deepEqual({ am: today.am, pm: today.pm }, { am: true, pm: false });
  assert.equal(today.done, 1);
  assert.equal(coldchainGapDays(s, T), 0);
  addColdchain(s, { dateISO: '2026-09-05', slot: 'pm', tempC: 10.2, note: '停电 2 小时' });
  addColdchain(s, { dateISO: '2026-09-06', slot: 'am', tempC: 11.0, note: '复测仍高' });
  const exc = excursions(s);
  assert.equal(exc.length, 2);
  assert.equal(exc[0].dateISO, '2026-09-05');
  const empty = emptyState();
  assert.equal(coldchainGapDays(empty, T), null);
});

// ---------------------------------------------------------------------------
// 狂犬免疫台账（执业兽医师出证闸 + 批次可用性闸）
// ---------------------------------------------------------------------------

test('addRabies 闸机：仅执业兽医师可出证；证明编号必填；过期/冻结批次拒绝', () => {
  const s = emptyState();
  const vet = addStaff(s, { name: '张医生', type: 'vet' });
  const assistant = addStaff(s, { name: '李助理', type: 'assistant' });
  addDrug(s, { dateISO: '2026-01-01', name: '狂犬疫苗', kind: 'vaccine', batchNo: 'R1', expiryISO: '2026-08-01', qty: 10 }); // 已过期
  addDrug(s, { dateISO: '2026-01-01', name: '狂犬疫苗B', kind: 'vaccine', batchNo: 'R2', expiryISO: '2027-09-01', qty: 10 });
  assert.throws(() => addRabies(s, { dateISO: T, pet: '豆豆', vaccineBatchId: 'dg-2', certNo: 'IMM-1', doctorId: assistant.id }), /执业兽医师/);
  assert.throws(() => addRabies(s, { dateISO: T, pet: '豆豆', vaccineBatchId: 'dg-2', certNo: '', doctorId: vet.id }), /编号/);
  assert.throws(() => addRabies(s, { dateISO: T, pet: '豆豆', vaccineBatchId: 'dg-1', certNo: 'IMM-2', doctorId: vet.id }), /劣兽药/);
  const r = addRabies(s, { dateISO: T, pet: '豆豆', species: '犬', owner: '尾号8823', vaccineBatchId: 'dg-2', certNo: 'IMM-2026-001', doctorId: vet.id });
  assert.equal(r.batchNo, 'R2');
  assert.equal(r.doctorName, '张医生');
  assert.equal(s.rabiesLog.length, 1);
  assert.throws(() => addRabies(s, { dateISO: T, pet: '', vaccineBatchId: '', certNo: 'X', doctorId: vet.id }));
});

// ---------------------------------------------------------------------------
// 医废台账（暂存挂账 + 移交闭环）
// ---------------------------------------------------------------------------

test('addWaste：移交必填接收单位；moveWaste 日期校验与一次闭环', () => {
  const s = emptyState();
  assert.throws(() => addWaste(s, { dateISO: T, way: 'transferred', receiver: '' }));
  assert.throws(() => addWaste(s, { dateISO: T, qty: -1 }));
  const w1 = addWaste(s, { dateISO: '2026-09-04', kind: 'clinic', qty: 2, way: 'stored' });
  const w2 = addWaste(s, { dateISO: '2026-08-20', kind: 'pathology', qty: 1, way: 'transferred', receiver: '市无害化处理中心' });
  assert.equal(w2.movedISO, '2026-08-20');
  const open = openWastes(s, T);
  assert.equal(open.length, 1);
  assert.equal(open[0].daysHeld, 4);
  assert.equal(overdueWastes(s, T, 2).length, 1);
  assert.equal(overdueWastes(s, T, 30).length, 0);
  assert.throws(() => moveWaste(s, w1.id, { movedISO: '2026-09-01', receiver: 'X' })); // 早于登记日
  moveWaste(s, w1.id, { movedISO: T, receiver: '市无害化处理中心', ticketNo: 'WH-1' });
  assert.throws(() => moveWaste(s, w1.id, { movedISO: T, receiver: '再次移交' }));
  assert.equal(openWastes(s, T).length, 0);
});

// ---------------------------------------------------------------------------
// 事件台账（不良反应/染疫：立即报告时钟）
// ---------------------------------------------------------------------------

test('addEvent：染疫强制按严重处理；closeEvent 迟报如实打标、一次闭环', () => {
  const s = emptyState();
  const ev1 = addEvent(s, { dateISO: T, kind: 'epidemic', subject: '疑似犬瘟热', severity: 'general' });
  assert.equal(ev1.severity, 'serious');   // 染疫一律按严重口径
  assert.throws(() => addEvent(s, { dateISO: T, kind: 'robbery' }));
  assert.throws(() => addEvent(s, { dateISO: T, severity: 'huge' }));
  const ev2 = addEvent(s, { dateISO: '2026-09-06', kind: 'adverse', subject: '流涎', severity: 'general' });
  closeEvent(s, ev2.id, { reportedISO: '2026-09-07' });
  assert.equal(ev2.late, true);            // 非"立即"→ 迟报留痕
  assert.throws(() => closeEvent(s, ev2.id, { reportedISO: T }));
  assert.throws(() => closeEvent(s, ev2.id, { reportedISO: '2026-09-05' })); // 不存在→已被闭环拦截先触发
  const open = openEvents(s);
  assert.equal(open.length, 1);
  assert.equal(open[0].id, ev1.id);
  assert.equal(lateEvents(s).length, 1);
  // 报告早于发现日不允许（直接对未闭环记录）
  const ev3 = addEvent(s, { dateISO: T, kind: 'adverse', subject: 'x', severity: 'serious' });
  closeEvent(s, ev3.id, { reportedISO: T });
  assert.equal(ev3.late, false);           // 当天=按时
});

// ---------------------------------------------------------------------------
// 周期义务与年度报告钟
// ---------------------------------------------------------------------------

test('dutyBoard：never/overdue 红灯前置，打勾滚动下一周期', () => {
  const s = emptyState();
  setDutyDone(s, 'disinfect', '2026-08-25', '诊室消毒');     // 7 天周期 → 逾期
  setDutyDone(s, 'training', '2026-06-01');                  // 365 天 → ok
  const board = dutyBoard(s, T);
  assert.equal(board[0].level, 'overdue');
  assert.equal(board[0].kind, 'disinfect');
  assert.equal(board[1].level, 'ok');
  assert.throws(() => setDutyDone(s, 'party', T));
  const d = dutyState({ kind: 'disinfect', lastDoneISO: T }, T);
  assert.equal(d.level, 'due');   // 7 天周期，剩 7 天 ≤ 14 → 临期
  assert.equal(dutyState({ kind: 'disinfect' }, T).level, 'never');
});

test('annualReportState：窗口期 warn、逾期 overdue、已报 ok；fileAnnualReport 年度校验', () => {
  const s = emptyState();
  const ar = annualReportState(s, T); // 2026-09-08：2025 年度期限已过
  assert.equal(ar.level, 'overdue');
  assert.equal(ar.target, 2025);
  const warn = annualReportState(s, '2026-03-02');
  assert.equal(warn.level, 'due');
  assert.equal(warn.daysLeft, 29);
  assert.throws(() => fileAnnualReport(s, { year: 2024, filedISO: T })); // 非上一年度
  fileAnnualReport(s, { year: 2025, filedISO: '2026-03-01', no: 'HZ-1' });
  assert.throws(() => fileAnnualReport(s, { year: 2025, filedISO: '2026-03-02' })); // 同年度唯一
  assert.equal(annualReportState(s, T).level, 'ok');
});

// ---------------------------------------------------------------------------
// 账本体检（确定性打分）
// ---------------------------------------------------------------------------

test('healthCheck：空档状态确定性 76 分（断更+年度报告双红）', () => {
  const s = emptyState();
  s.station = { name: '某宠物医院', certNo: '兽诊字第1号', posted: true };
  addStaff(s, { name: '张医生', type: 'vet' });
  const hc = healthCheck(s, T);
  const byKey = Object.fromEntries(hc.items.map((i) => [i.key, i.level]));
  assert.equal(byKey.posting, 'ok');
  assert.equal(byKey.staff, 'ok');
  assert.equal(byKey.gap, 'bad');       // 从未落诊
  assert.equal(byKey.annual, 'bad');    // 2025 年度未报
  assert.equal(byKey.rx, 'ok');
  assert.equal(byKey.coldchain, 'ok');
  assert.equal(hc.bad, 2);
  assert.equal(hc.score, 76);
});

test('healthCheck：健康状态满分 100（诊疗在续、年度已报、冷链在续）', () => {
  const s = emptyState();
  s.station = { name: '某宠物医院', certNo: '兽诊字第1号', posted: true };
  const vet = addStaff(s, { name: '张医生', type: 'vet' });
  addVisit(s, { dateISO: T, doctorId: vet.id, diagnosis: '体检' });
  fileAnnualReport(s, { year: 2025, filedISO: '2026-03-01' });
  addDrug(s, { dateISO: '2026-01-01', name: '狂犬疫苗', kind: 'vaccine', expiryISO: '2027-01-01', qty: 10 });
  addColdchain(s, { dateISO: T, slot: 'am', tempC: 4 });
  addColdchain(s, { dateISO: T, slot: 'pm', tempC: 4.5 });
  setDutyDone(s, 'disinfect', T);
  const hc = healthCheck(s, T);
  assert.equal(hc.bad, 0);
  assert.equal(hc.warn, 0);
  assert.equal(hc.score, 100);
});

// ---------------------------------------------------------------------------
// 月度小结与出证物
// ---------------------------------------------------------------------------

test('monthlySummary：确定性文本（诊疗/免疫/冷链段 + 口径尾注）', () => {
  const s = emptyState();
  s.station = { name: '城南宠物医院', certNo: '兽诊字第1号', posted: true };
  const vet = addStaff(s, { name: '张医生', type: 'vet' });
  addVisit(s, { dateISO: T, owner: '尾号8823', animal: '金毛', diagnosis: '胃炎', doctorId: vet.id, rxRequired: true, rxNo: 'CF-1' });
  addRabies(s, { dateISO: T, pet: '豆豆', vaccineBatchId: '', certNo: 'IMM-1', doctorId: vet.id });
  addColdchain(s, { dateISO: T, slot: 'am', tempC: 4 });
  const sum = monthlySummary(s, '2026-09', T);
  assert.match(sum.text, /【动物诊疗机构合规月度小结】2026-09/);
  assert.match(sum.text, /诊疗落账 1 例，其中兽用处方药 1 例/);
  assert.match(sum.text, /狂犬免疫 1 剂/);
  assert.match(sum.text, /冷链记录 1 次/);
  assert.match(sum.text, /生成：兽诊账 · 2026-09/);
  assert.equal(sum.visits, 1);
  assert.throws(() => monthlySummary(s, '2026-9', T));
});

test('inspectHtml：单文件无外部资源、含签字栏与全部十段、XSS 转义', () => {
  const s = emptyState();
  s.station = { name: '<script>alert(1)</script>医院', certNo: '兽诊字第1号', posted: true };
  const vet = addStaff(s, { name: '张医生', type: 'vet' });
  addVisit(s, { dateISO: T, owner: '尾号1', animal: '<img src=x onerror=alert(1)>', diagnosis: '胃炎', doctorId: vet.id, rxRequired: true, rxNo: 'CF-1' });
  const html = inspectHtml(s, T);
  assert.ok(!/src="https?:/.test(html), '出证物不得引用外部资源');
  assert.ok(!/href="https?:/.test(html), '出证物不得引用外部资源');
  assert.ok(html.includes('签字/盖章'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('人员备案名册'));
  assert.ok(html.includes('疫苗冷链记录'));
  assert.ok(html.includes('年度报告'));
});

test('caseHtml：患宠材料单含病历要素/免疫/冷链三段与签字栏；缺记录拒绝', () => {
  const s = emptyState();
  s.station = { name: '城南宠物医院', certNo: 'X1', posted: true };
  const vet = addStaff(s, { name: '张医生', type: 'vet' });
  addDrug(s, { dateISO: '2026-08-01', name: '狂犬疫苗', kind: 'vaccine', batchNo: 'R9', expiryISO: '2027-09-01', qty: 10 });
  addRabies(s, { dateISO: T, pet: '豆豆', owner: '尾号8823', vaccineBatchId: 'dg-1', certNo: 'IMM-9', doctorId: vet.id });
  const v = addVisit(s, { dateISO: T, owner: '尾号8823', animal: '金毛「豆豆」', diagnosis: '胃炎', doctorId: vet.id, rxRequired: true, rxNo: 'CF-9', rxItems: '奥美拉唑' });
  const html = caseHtml(s, v.id, T);
  assert.ok(html.includes('处方笺编号 CF-9'));
  assert.ok(html.includes('IMM-9'));
  assert.ok(html.includes('签字/盖章'));
  assert.ok(!/src="https?:/.test(html));
  assert.throws(() => caseHtml(s, 'vs-99', T));
});

// ---------------------------------------------------------------------------
// 数据导入导出
// ---------------------------------------------------------------------------

test('导出→导入往返一致；外来文件/坏 JSON/高版本整体拒绝', () => {
  const s = emptyState();
  s.station = { name: '某宠物医院', certNo: 'X1', posted: true };
  const vet = addStaff(s, { name: '张医生', type: 'vet' });
  addVisit(s, { dateISO: T, doctorId: vet.id });
  const bundle = exportBundle(s);
  const back = importBundle(bundle);
  assert.equal(back.ok, true);
  assert.equal(back.state.visits.length, 1);
  assert.equal(back.state.staffs[0].name, '张医生');
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'other', version: 1, state: {} })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'vetledger', version: 99, state: {} })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'vetledger', version: 1, state: { station: null } })).ok, false);
  assert.equal(STATE_VERSION, 1);
});

test('todayISO 使用本地时区（注入 Date 保持确定性）', () => {
  const d = new Date('2026-09-08T20:30:00+08:00');
  assert.equal(todayISO(d), '2026-09-08');
  // 任一时刻的本地日期 = (时刻 - 时区偏移) 的 UTC 日期（与实现同构，机器无关）
  const d2 = new Date('2026-09-08T23:30:00Z');
  const expected = new Date(d2.getTime() - d2.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  assert.equal(todayISO(d2), expected);
});
