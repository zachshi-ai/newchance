/**
 * tests/core.test.mjs — 检证账 CertLedger 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addMonthsExact, daysUntil, monthKey, escapeHtml,
  CERT_VALID_YEARS, RENEW_ADVANCE_DAYS, CERT_WARN_DAYS,
  DEFAULT_CALIB_CYCLE_MONTHS, CALIB_WARN_DAYS, RECORD_KEEP_YEARS,
  DEFAULT_AUDIT_CYCLE_MONTHS, DEFAULT_RENEW_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
  CHANGE_KINDS, STAFF_ROLES, CALIB_TYPES, QUALITY_KINDS, PT_RESULTS, DUTY_KINDS,
  certState, renewCert,
  addCapability, setCapabilityStatus, activeCapabilities,
  addEquipment, activeEquipments, equipState, recordCalibration, setEquipService, readyEquipmentsOf,
  addStaff, setStaffActive, activeSigners,
  addChange, fileChange, openChanges,
  addNC, fixNC, closeNC, openNCs,
  addQuality, removeQuality, lastQualityDays, auditState,
  reportGate, addReport, removeReport, expiredKeeps, markDisposed,
  setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary, inspectHtml, reportHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';
import { emptyState } from '../app/js/store.js';

const T = '2026-09-08'; // 测试锚定日期（周二），不依赖墙钟

function freshState() {
  return emptyState();
}

// ---------------------------------------------------------------------------
// 日期与工具 + 常量口径基线
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-8'));
  assert.throws(() => assertISO('20260908'));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
});

test('addDays 跨月/跨年收敛；addMonthsExact 月末钳制', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addMonthsExact('2024-08-31', 24), '2026-08-31');
  assert.equal(addMonthsExact('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonthsExact('2026-01-31', 1), '2026-02-28');
  assert.throws(() => addMonthsExact('2026-01-31', 0));
});

test('daysUntil 与 monthKey 正确；同日为 0 不出现 -0', () => {
  assert.equal(daysUntil('2026-12-31', T), 114);
  assert.equal(daysUntil('2026-09-08', T), 0);
  assert.equal(Object.is(daysUntil('2026-09-08', T), -0), false);
  assert.equal(monthKey('2026-09-08'), '2026-09');
});

test('法定/惯例常数基线：证书 6 年、届满 3 个月延续、记录保存 6 年、溯源与内审管评 12 个月', () => {
  assert.equal(CERT_VALID_YEARS, 6);                 // 163 号令现行版第 13 条
  assert.equal(RENEW_ADVANCE_DAYS, 90);              // 届满 3 个月前提出延续申请
  assert.equal(CERT_WARN_DAYS, 180);
  assert.equal(RECORD_KEEP_YEARS, 6);                // 39 号令第 12 条
  assert.equal(DEFAULT_CALIB_CYCLE_MONTHS, 12);      // 2023 准则第 11 条（溯源周期参数化）
  assert.equal(DEFAULT_AUDIT_CYCLE_MONTHS, 12);      // RB/T 214—2017 惯例口径
  assert.equal(DEFAULT_RENEW_WARN_DAYS, 90);
  assert.equal(DEFAULT_DUTY_WARN_DAYS, 30);
  assert.equal(CALIB_WARN_DAYS, 45);
  assert.equal(STATE_VERSION, 1);
  assert.deepEqual(Object.keys(CHANGE_KINDS), ['name', 'keyperson', 'itemcancel', 'method', 'other']); // 第 14 条五情形
  assert.deepEqual(Object.keys(STAFF_ROLES), ['signer', 'tester', 'supervisor']);
  assert.deepEqual(Object.keys(CALIB_TYPES), ['verify', 'calibrate', 'check']);  // 检定/校准/核查
  assert.deepEqual(Object.keys(QUALITY_KINDS), ['internal', 'mreview', 'pt', 'qc']);
  assert.deepEqual(Object.keys(PT_RESULTS).sort(), ['pass', 'unsat']);
  assert.deepEqual(Object.keys(DUTY_KINDS), ['annualreport', 'selfdeclare', 'selfcheck', 'training']);
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

// ---------------------------------------------------------------------------
// 资质证书钟（163 号令现行版第 13/31/37 条）
// ---------------------------------------------------------------------------

test('certState 五态：unset 红 / overdue 红 / window 黄（届满 3 个月）/ warn 黄 / ok 绿', () => {
  const s = freshState();
  assert.equal(certState(s.station, T).level, 'unset');
  s.station.certExpiryISO = '2026-09-01';
  assert.equal(certState(s.station, T).level, 'overdue');
  s.station.certExpiryISO = '2026-10-01';
  assert.equal(certState(s.station, T).level, 'window');     // 剩 23 天 ≤ 90 天窗口
  s.station.certExpiryISO = '2027-02-01';
  assert.equal(certState(s.station, T).level, 'warn');       // 剩 146 天 ≤ 180 天提醒
  s.station.certExpiryISO = '2028-09-08';
  const ok = certState(s.station, T);
  assert.equal(ok.level, 'ok');
  assert.equal(ok.daysLeft, 731);                            // 含 2028-02-29 闰日
});

test('renewCert：新有效期必须晚于当前；办结滚动证书钟', () => {
  const s = freshState();
  s.station.certExpiryISO = '2026-11-08';
  assert.throws(() => renewCert(s.station, '2026-11-08'));
  assert.throws(() => renewCert(s.station, '2025-01-01'));
  renewCert(s.station, '2032-11-08');
  assert.equal(s.station.certExpiryISO, '2032-11-08');
  assert.equal(certState(s.station, T).level, 'ok');
  const bare = freshState();
  assert.throws(() => renewCert(bare.station, '2032-01-01'));
});

// ---------------------------------------------------------------------------
// 能力附表（163 号令现行版第 19/36 条：超范围闸底座）
// ---------------------------------------------------------------------------

test('addCapability：名称必填、同名拒绝；setCapabilityStatus 停用必填原因；activeCapabilities 只返回在用', () => {
  const s = freshState();
  assert.throws(() => addCapability(s, { name: '  ' }));
  const cap = addCapability(s, { name: '水中 pH 值', standard: 'HJ 1147-2020' });
  assert.throws(() => addCapability(s, { name: '水中 pH 值' }));
  assert.equal(activeCapabilities(s).length, 1);
  assert.throws(() => setCapabilityStatus(s, cap.id, 'suspended', ''));
  setCapabilityStatus(s, cap.id, 'suspended', '项目取消');
  assert.equal(activeCapabilities(s).length, 0);
  assert.equal(cap.suspendedReason, '项目取消');
  setCapabilityStatus(s, cap.id, 'active');
  assert.equal(cap.suspendedReason, '');
  assert.throws(() => setCapabilityStatus(s, 'cap-404', 'active'));
});

// ---------------------------------------------------------------------------
// 设备一机一档（2023 准则第 11 条；39 号令第 13 条(二)）
// ---------------------------------------------------------------------------

test('addEquipment：名称/编号必填、编号唯一、周期默认 12 个月、到期日自动推导且月末钳制', () => {
  const s = freshState();
  assert.throws(() => addEquipment(s, { name: '天平', code: '' }));
  const eq = addEquipment(s, { name: '天平', code: 'BAL-01', lastCalibISO: '2025-09-08' });
  assert.throws(() => addEquipment(s, { name: '天平 2', code: 'BAL-01' }));
  assert.equal(eq.cycleMonths, 12);
  assert.equal(eq.calibDueISO, '2026-09-08');
  const eq2 = addEquipment(s, { name: '消解仪', code: 'RZ-01', cycleMonths: 24, lastCalibISO: '2024-01-31' });
  assert.equal(eq2.calibDueISO, '2026-01-31');
});

test('equipState 五态：unset 红 / overdue 红 / due 黄（45 天）/ ok / 停用 none', () => {
  const s = freshState();
  const unset = addEquipment(s, { name: 'A', code: 'A-01' });
  assert.equal(equipState(unset, T).level, 'unset');
  const over = addEquipment(s, { name: 'B', code: 'B-01', lastCalibISO: '2025-08-08' });
  assert.equal(equipState(over, T).level, 'overdue');
  const due = addEquipment(s, { name: 'C', code: 'C-01', lastCalibISO: '2025-09-15' });
  assert.equal(equipState(due, T).level, 'due');             // 剩 7 天
  const ok = addEquipment(s, { name: 'D', code: 'D-01', lastCalibISO: '2026-06-01' });
  assert.equal(equipState(ok, T).level, 'ok');
  setEquipService(s, ok.id, false, T);
  assert.equal(equipState(ok, T).level, 'none');
  assert.ok(equipState(over, T).detail.includes('39 号令第 13 条(二)'));
});

test('recordCalibration 滚动溯源钟；停用设备拒绝录入；setEquipService 重复停用/复用拒绝', () => {
  const s = freshState();
  const eq = addEquipment(s, { name: 'A', code: 'A-01', lastCalibISO: '2025-09-08' });
  setEquipService(s, eq.id, false, T);
  assert.throws(() => recordCalibration(s, eq.id, T));
  setEquipService(s, eq.id, true, T);
  assert.throws(() => setEquipService(s, eq.id, true, T));   // 已在用
  recordCalibration(s, eq.id, '2026-09-01');
  assert.equal(eq.calibDueISO, '2027-09-01');
  assert.equal(equipState(eq, T).level, 'ok');
  assert.throws(() => setEquipService(s, 'eq-404', false, T));
});

test('readyEquipmentsOf：只返回在用且溯源在期且关联该参数的设备', () => {
  const s = freshState();
  const cap = addCapability(s, { name: 'COD' });
  const cap2 = addCapability(s, { name: '氨氮' });
  addEquipment(s, { name: '消解仪', code: 'RZ-01', capIds: [cap.id], lastCalibISO: '2026-06-01' });
  addEquipment(s, { name: '旧消解仪', code: 'RZ-02', capIds: [cap.id], lastCalibISO: '2024-09-01' });  // 超期
  addEquipment(s, { name: '氨氮仪', code: 'NH3-01', capIds: [cap2.id], lastCalibISO: '2026-06-01' });  // 别的参数
  assert.equal(readyEquipmentsOf(s, cap.id, T).length, 1);
  assert.equal(readyEquipmentsOf(s, cap2.id, T).length, 1);
});

// ---------------------------------------------------------------------------
// 人员名册（2023 准则第 9 条；39 号令第 7/11 条）
// ---------------------------------------------------------------------------

test('addStaff：姓名必填、角色合法、授权签字人职称必填、同姓名同角色拒绝；activeSigners 过滤', () => {
  const s = freshState();
  assert.throws(() => addStaff(s, { name: '' }));
  assert.throws(() => addStaff(s, { name: '张三', role: 'boss' }));
  assert.throws(() => addStaff(s, { name: '张三', role: 'signer', title: '' }));  // 准则第 9 条(三)
  addStaff(s, { name: '张三', role: 'signer', title: '高级工程师' });
  assert.throws(() => addStaff(s, { name: '张三', role: 'signer', title: '工程师' }));
  addStaff(s, { name: '李四', role: 'tester' });
  assert.equal(activeSigners(s).length, 1);
});

test('setStaffActive 停用不删除、可恢复；不存在的人拒绝', () => {
  const s = freshState();
  const p = addStaff(s, { name: '张三', role: 'signer', title: '高级工程师' });
  setStaffActive(s, p.id, false);
  assert.equal(activeSigners(s).length, 0);
  assert.equal(s.staff.length, 1);
  setStaffActive(s, p.id, true);
  assert.equal(activeSigners(s).length, 1);
  assert.throws(() => setStaffActive(s, 'st-404', false));
});

// ---------------------------------------------------------------------------
// 变更台账（163 号令现行版第 14/35 条）
// ---------------------------------------------------------------------------

test('addChange：非法情形/空说明拒绝；fileChange 日期倒挂与重复办结拒绝；openChanges 只返回未办结', () => {
  const s = freshState();
  assert.throws(() => addChange(s, { dateISO: T, kind: 'salary' }));
  assert.throws(() => addChange(s, { dateISO: T, kind: 'name', detail: '' }));
  const c1 = addChange(s, { dateISO: '2026-08-01', kind: 'keyperson', detail: '授权签字人变更' });
  const c2 = addChange(s, { dateISO: '2026-09-01', kind: 'itemcancel', detail: '取消土壤铅' });
  assert.equal(openChanges(s).length, 2);
  assert.throws(() => fileChange(s, c1.id, '2026-07-01'));   // 早于发生日
  fileChange(s, c1.id, '2026-08-15');
  assert.equal(openChanges(s).length, 1);
  assert.throws(() => fileChange(s, c1.id, '2026-09-01'));   // 重复办结
  assert.equal(c2.status, 'open');
});

// ---------------------------------------------------------------------------
// 不符合项闭环（状态机 open → fixed → closed）
// ---------------------------------------------------------------------------

test('addNC：来源/描述校验；挂起参数写入原因；fixNC/closeNC 状态机跳级与倒挂拒绝', () => {
  const s = freshState();
  const cap = addCapability(s, { name: '空气中氨' });
  assert.throws(() => addNC(s, { dateISO: T, source: 'chat', desc: 'x' }));
  assert.throws(() => addNC(s, { dateISO: T, source: 'manual', desc: '' }));
  const nc = addNC(s, { dateISO: '2026-09-01', source: 'pt', desc: '能力验证不合格', capabilityId: cap.id, suspendCap: true });
  assert.equal(cap.status, 'suspended');
  assert.ok(cap.suspendedReason.includes(nc.id));
  assert.throws(() => closeNC(s, nc.id, { verifyISO: T, verifiedBy: '质量负责人' }));  // 跳级
  assert.throws(() => fixNC(s, nc.id, { actionISO: '2026-08-01', action: '整改' }));    // 倒挂
  assert.throws(() => fixNC(s, nc.id, { actionISO: '2026-09-02', action: '' }));        // 无措施
  fixNC(s, nc.id, { actionISO: '2026-09-05', action: '重做验证合格' });
  assert.throws(() => fixNC(s, nc.id, { actionISO: '2026-09-06', action: '再改' }));    // 非 open
  assert.throws(() => closeNC(s, nc.id, { verifyISO: '2026-09-01', verifiedBy: '孙既白' })); // 早于整改日
  assert.throws(() => closeNC(s, nc.id, { verifyISO: '2026-09-06', verifiedBy: '' }));  // 无验证人
  closeNC(s, nc.id, { verifyISO: '2026-09-06', verifiedBy: '孙既白' });
  assert.equal(nc.status, 'closed');
  assert.equal(cap.status, 'active');                        // 关闭即恢复参数
  assert.equal(cap.suspendedReason, '');
  assert.throws(() => closeNC(s, nc.id, { verifyISO: '2026-09-07', verifiedBy: '孙既白' })); // 已闭环
  assert.throws(() => addNC(s, { dateISO: '2026-09-01', source: 'pt', desc: 'x', capabilityId: 'cap-404' }));
});

test('openNCs 未闭环在前、早的在前', () => {
  const s = freshState();
  addNC(s, { dateISO: '2026-09-02', source: 'manual', desc: '乙' });
  const a = addNC(s, { dateISO: '2026-09-01', source: 'manual', desc: '甲' });
  fixNC(s, a.id, { actionISO: '2026-09-03', action: '改毕' });
  const open = openNCs(s);
  assert.equal(open.length, 2);
  assert.equal(open[0].desc, '甲');   // fixed 但未 closed 仍在 open，按日期在前
});

// ---------------------------------------------------------------------------
// 质量记录（内审/管理评审/能力验证/内部质控）
// ---------------------------------------------------------------------------

test('addQuality：类型/摘要必填；内审与管理评审同年度唯一；能力验证结论校验', () => {
  const s = freshState();
  assert.throws(() => addQuality(s, { kind: 'townmeeting', dateISO: T, title: 'x' }));
  assert.throws(() => addQuality(s, { kind: 'internal', dateISO: T, title: '' }));
  addQuality(s, { kind: 'internal', dateISO: '2026-03-01', title: '2026 年度内审' });
  assert.throws(() => addQuality(s, { kind: 'internal', dateISO: '2026-09-01', title: '同年第二次' }));
  addQuality(s, { kind: 'internal', dateISO: '2025-03-01', title: '2025 年度内审' });  // 跨年可以
  addQuality(s, { kind: 'mreview', dateISO: '2026-04-01', title: '2026 管理评审' });
  assert.throws(() => addQuality(s, { kind: 'pt', dateISO: T, title: 'x', result: 'maybe' }));
  assert.throws(() => addQuality(s, { kind: 'pt', dateISO: T, title: '不合格无参数', result: 'unsat' }));
  removeQuality(s, s.quality[0].id);
  assert.equal(s.quality.length, 2);
});

test('能力验证不合格自动挂不符合项并挂起参数；closeNC 后恢复', () => {
  const s = freshState();
  const cap = addCapability(s, { name: '空气中氨' });
  const q = addQuality(s, { kind: 'pt', dateISO: '2026-08-01', title: '氨 PT |z|=3.2', result: 'unsat', capabilityId: cap.id });
  assert.equal(cap.status, 'suspended');
  const nc = openNCs(s).find((n) => n.source === 'pt');
  assert.ok(nc);
  assert.equal(q.capabilityId, cap.id);
  fixNC(s, nc.id, { actionISO: '2026-08-20', action: '查原因复测合格' });
  closeNC(s, nc.id, { verifyISO: '2026-08-25', verifiedBy: '质量负责人' });
  assert.equal(cap.status, 'active');
});

test('auditState：never 红 / 超 12 个月红 / 60 天内黄 / ok；lastQualityDays 同日不出现 -0', () => {
  const s = freshState();
  assert.equal(auditState(s, 'internal', T).level, 'never');
  addQuality(s, { kind: 'internal', dateISO: '2025-08-01', title: '去年内审' });
  assert.equal(auditState(s, 'internal', T).level, 'overdue');   // 403 天前 > 12 个月
  const s2 = freshState();
  addQuality(s2, { kind: 'internal', dateISO: T, title: '今天内审' });
  const st = auditState(s2, 'internal', T);
  assert.equal(st.level, 'ok');
  assert.ok(!Object.is(st.days, -0));
  assert.equal(lastQualityDays(s2, 'internal', T), 0);
  const s3 = freshState();
  addQuality(s3, { kind: 'mreview', dateISO: '2026-04-01', title: '管理评审' });
  assert.equal(auditState(s3, 'mreview', T).level, 'ok');        // +12 个月 = 2027-04-01，剩 205 天
  const s4 = freshState();
  addQuality(s4, { kind: 'mreview', dateISO: '2026-04-01', title: '管理评审' });
  assert.equal(auditState(s4, 'mreview', '2027-03-15').level, 'due');  // 临期 17 天
});

// ---------------------------------------------------------------------------
// 报告三道闸（产品的门禁）
// ---------------------------------------------------------------------------

function gateReadyState() {
  const s = freshState();
  s.station.name = '绿源环境检测有限公司';
  s.station.certNo = '241602341256';
  s.station.certExpiryISO = '2028-09-08';
  s.capCOD = addCapability(s, { name: 'COD', standard: 'HJ 828-2017' });
  s.cappH = addCapability(s, { name: 'pH', standard: 'HJ 1147-2020' });
  s.eqCOD = addEquipment(s, { name: '消解仪', code: 'RZ-01', capIds: [s.capCOD.id], lastCalibISO: '2026-06-01' });
  s.eqPH = addEquipment(s, { name: '酸度计', code: 'PH-02', capIds: [s.cappH.id], lastCalibISO: '2026-06-01' });
  s.signer = addStaff(s, { name: '钱未央', role: 'signer', title: '高级工程师' });
  return s;
}

test('reportGate：全绿通过；证书过期/参数超范围/设备超期/非签字人逐道拦截且带法条口径', () => {
  const s = gateReadyState();
  const pass = reportGate(s, { dateISO: T, paramIds: [s.capCOD.id], signerId: s.signer.id });
  assert.equal(pass.ok, true);

  const expired = gateReadyState();
  expired.station.certExpiryISO = '2026-08-08';
  const g1 = reportGate(expired, { dateISO: T, paramIds: [expired.capCOD.id], signerId: expired.signer.id });
  assert.equal(g1.ok, false);
  assert.ok(g1.reasons[0].includes('第 37 条'));

  const g2 = reportGate(s, { dateISO: T, paramIds: [], signerId: s.signer.id });
  assert.ok(g2.reasons[0].includes('第 19 条'));

  const g3 = reportGate(s, { dateISO: T, paramIds: ['cap-404'], signerId: s.signer.id });
  assert.ok(g3.reasons[0].includes('第 36 条(二)'));
  const noEquipCap = addCapability(s, { name: '在附表但无设备' });   // 附表在、设备无 → 准则第 11 条提示
  const g9 = reportGate(s, { dateISO: T, paramIds: [noEquipCap.id], signerId: s.signer.id });
  assert.ok(g9.reasons[0].includes('2023 准则第 11 条'));

  const over = gateReadyState();
  over.eqCOD.calibDueISO = '2026-08-01';
  const g4 = reportGate(over, { dateISO: T, paramIds: [over.capCOD.id], signerId: over.signer.id });
  assert.equal(g4.ok, false);
  assert.ok(g4.reasons[0].includes('第 13 条(二)'));

  const tester = addStaff(s, { name: '周疏影', role: 'tester' });
  const g5 = reportGate(s, { dateISO: T, paramIds: [s.capCOD.id], signerId: tester.id });
  assert.ok(g5.reasons[0].includes('第 25 条(三)'));
  const g6 = reportGate(s, { dateISO: T, paramIds: [s.capCOD.id], signerId: '' });
  assert.equal(g6.ok, false);

  const off = gateReadyState();
  setStaffActive(off, off.signer.id, false);
  const g7 = reportGate(off, { dateISO: T, paramIds: [off.capCOD.id], signerId: off.signer.id });
  assert.equal(g7.ok, false);

  const suspended = gateReadyState();
  setCapabilityStatus(suspended, suspended.capCOD.id, 'suspended', '能力验证整改中');
  const g8 = reportGate(suspended, { dateISO: T, paramIds: [suspended.capCOD.id], signerId: suspended.signer.id });
  assert.ok(g8.reasons[0].includes('停用'));
});

test('addReport：编号唯一；落账存快照、6 年保存钟自动起算；闸机拒绝时不落账', () => {
  const s = gateReadyState();
  const r = addReport(s, { reportNo: '检字〔2026〕001', dateISO: '2026-09-08', paramIds: [s.capCOD.id], signerId: s.signer.id, cmaMarked: true });
  assert.equal(r.keepUntil, '2032-09-08');
  assert.equal(r.snapshot.certExpiryISO, '2028-09-08');
  assert.equal(r.signerTitle, '高级工程师');
  assert.throws(() => addReport(s, { reportNo: '检字〔2026〕001', dateISO: '2026-09-09', paramIds: [s.capCOD.id], signerId: s.signer.id }));
  assert.throws(() => addReport(s, { reportNo: '', dateISO: T }));
  const n0 = s.reports.length;
  assert.throws(() => addReport(s, { reportNo: '检字〔2026〕002', dateISO: T, paramIds: ['cap-404'], signerId: s.signer.id }));
  assert.equal(s.reports.length, n0);
  removeReport(s, r.id);
  assert.equal(s.reports.length, 0);
});

test('expiredKeeps 与 markDisposed：保存未满 6 年不得处置', () => {
  const s = gateReadyState();
  const r = addReport(s, { reportNo: '检字〔2026〕003', dateISO: '2020-09-07', paramIds: [s.capCOD.id], signerId: s.signer.id, cmaMarked: true });
  assert.equal(expiredKeeps(s, T).length, 1);                 // 保存至 2026-09-07，已过期 1 天
  assert.throws(() => markDisposed(s, r.id, '2026-09-07'));   // 不得在到期当日处置
  markDisposed(s, r.id, T, '按程序销毁');
  assert.equal(expiredKeeps(s, T).length, 0);
  assert.equal(r.disposedHow, '按程序销毁');
});

// ---------------------------------------------------------------------------
// 年度义务 / 体检 / 月报 / 出证
// ---------------------------------------------------------------------------

test('setDutyDone/dutyState/dutyBoard：打勾滚动与红灯排序', () => {
  const s = freshState();
  setDutyDone(s, 'annualreport', '2025-09-07', '已报');
  const d = dutyState(s.duties[0], T);
  assert.equal(d.level, 'overdue');                            // 366 天周期已过 1 天
  assert.throws(() => setDutyDone(s, 'tax', T));
  setDutyDone(s, 'training', T);
  const board = dutyBoard(s, T);
  assert.equal(board[0].kind, 'annualreport');                 // overdue 在 never/ok 前
  assert.equal(board[0].daysLeft, -1);
});

test('healthCheck：全绿 100 分；种子红灯扣分且下限 0', () => {
  const s = gateReadyState();
  addQuality(s, { kind: 'internal', dateISO: T, title: '内审' });
  addQuality(s, { kind: 'mreview', dateISO: T, title: '管评' });
  addQuality(s, { kind: 'pt', dateISO: T, title: 'PT 合格', result: 'pass' });
  setDutyDone(s, 'annualreport', T);
  setDutyDone(s, 'selfdeclare', T);
  setDutyDone(s, 'selfcheck', T);
  setDutyDone(s, 'training', T);
  addReport(s, { reportNo: '检字〔2026〕000', dateISO: T, paramIds: [s.capCOD.id], signerId: s.signer.id, cmaMarked: true });
  const hc = healthCheck(s, T, s.settings);
  assert.equal(hc.bad, 0);
  assert.equal(hc.warn, 0);
  assert.equal(hc.score, 100);
  const empty = healthCheck(freshState(), T, {});
  assert.ok(empty.bad >= 3);
  assert.ok(empty.score < 100 && empty.score >= 0);
  const wiped = freshState();
  wiped.station = {};
  const floor = healthCheck(wiped, T, {});
  assert.ok(floor.score >= 0);
});

test('monthlySummary：结构完整、拦截计数、口径尾注带现行条号', () => {
  const s = gateReadyState();
  addReport(s, { reportNo: '检字〔2026〕101', dateISO: T, paramIds: [s.capCOD.id], signerId: s.signer.id, cmaMarked: true });
  // 模拟一次闸机拦截埋点
  s.traces.push({ type: 'report-gate-blocked', at: `${T}T02:00:00.000Z`, dateISO: T, reasons: ['x'] });
  const sum = monthlySummary(s, '2026-09', T);
  assert.equal(sum.reports, 1);
  assert.equal(sum.blocked, 1);
  assert.ok(sum.text.includes('检证账'));
  assert.ok(sum.text.includes('163 号令'));
  assert.ok(sum.text.includes('39 号令'));
  assert.throws(() => monthlySummary(s, '2026-9', T));
});

test('inspectHtml 与 reportHtml：十段自证包与核对单含关键段落与转义', () => {
  const s = gateReadyState();
  const r = addReport(s, { reportNo: '检字〈2026〉x&y', dateISO: T, client: '委托方<b>', paramIds: [s.capCOD.id], signerId: s.signer.id, cmaMarked: true });
  const html = inspectHtml(s, T, s.settings);
  assert.ok(html.includes('迎检自证包'));
  assert.ok(html.includes('能力附表'));
  assert.ok(html.includes('变更手续台账'));
  assert.ok(html.includes('不符合项整改闭环'));
  assert.ok(html.includes('年度义务'));
  assert.ok(html.includes('检字〈2026〉x&amp;y'));   // 报告编号已转义
  const single = reportHtml(s, r.id, T);
  assert.ok(single.includes('报告合规核对单'));
  assert.ok(single.includes('&lt;b&gt;'));            // 委托方名已转义
  assert.ok(single.includes('2032-09-08'));
  assert.throws(() => reportHtml(s, 'rp-404', T));
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle：跨 app 拒绝、结构缺失拒绝、合法备份通过', () => {
  const s = gateReadyState();
  const bundle = exportBundle(s);
  assert.equal(importBundle(bundle).ok, true);
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'forklog', version: 1, state: {} })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'certledger', version: 99, state: {} })).ok, false);
  const partial = JSON.stringify({ app: 'certledger', version: 1, state: { station: {} } });
  assert.equal(importBundle(partial).ok, false);
});
