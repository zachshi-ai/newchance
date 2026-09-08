/**
 * tests/core.test.mjs — 拍片单 XrayPass 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addMonthsExact, daysUntil, monthKey, escapeHtml,
  RADSAFE_VALID_YEARS, RENEW_ADVANCE_DAYS, LICENSE_WARN_DAYS,
  STATUS_CHECK_CYCLE_MONTHS, SITE_CHECK_CYCLE_MONTHS, DOSE_MAX_DAYS,
  TRAINING_CYCLE_DAYS, HEALTH_CHECK_CYCLE_DAYS,
  DEFAULT_RENEW_WARN_DAYS, DEFAULT_DOSE_WARN_DAYS, DEFAULT_CHECK_WARN_DAYS,
  ORG_KINDS, PATIENT_TYPES, DUTY_KINDS, CHANGE_KINDS,
  radSafeState, radLicenseState, orgLicenseState, renewLicense, requiredLicenses,
  addDevice, activeDevices, deviceClockState, recordDeviceCheck, setDeviceService,
  addWorker, setWorkerActive, activeWorkers, trainingState, doseState, recordTraining, recordDose,
  shotGate, addShot, removeShot,
  addIncident, fixIncident, closeIncident, openIncidents,
  addChange, fileChange, openChanges,
  setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary, inspectHtml, shotHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';
import { emptyState } from '../app/js/store.js';

const T = '2026-09-08'; // 测试锚定日期（周二），不依赖墙钟

function freshState() {
  return emptyState();
}

/** 全绿可拍片状态（口腔类双证远期、一台设备检测在期、一名人员培训剂量在期） */
function readyState() {
  const s = freshState();
  s.org.name = '明澈口腔门诊部';
  s.org.kind = 'dental';
  s.org.radSafeNo = 'X环辐证〔2023〕0812 号';
  s.org.radSafeExpiryISO = '2028-09-08';
  s.org.radLicenseNo = '辐诊证〔2025〕第 0330 号';
  s.org.radLicenseExpiryISO = '2027-06-01';
  s.dv = addDevice(s, { name: '牙科 X 射线机', code: 'DX-01', statusCheckISO: '2026-06-01', siteCheckISO: '2026-06-01' });
  s.wk = addWorker(s, { name: '王明澈', trainingISO: '2026-06-01', doseISO: '2026-08-20' });
  return s;
}

// ---------------------------------------------------------------------------
// 日期与工具 + 常量口径基线
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-8'));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
});

test('addDays 跨月/跨年收敛；addMonthsExact 月末钳制', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addMonthsExact('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonthsExact('2026-01-31', 1), '2026-02-28');
  assert.throws(() => addMonthsExact('2026-01-31', 0));
});

test('daysUntil 与 monthKey 正确；同日为 0 不出现 -0', () => {
  assert.equal(daysUntil('2026-12-31', T), 114);
  assert.equal(Object.is(daysUntil('2026-09-08', T), -0), false);
  assert.equal(monthKey('2026-09-08'), '2026-09');
});

test('法定/惯例常数基线：辐射安全证 5 年/30 日延续、状态检测 12 月、剂量 90 天上限、培训 2 年', () => {
  assert.equal(RADSAFE_VALID_YEARS, 5);              // 449 号令第 13 条
  assert.equal(RENEW_ADVANCE_DAYS, 30);              // 届满 30 日前延续
  assert.equal(STATUS_CHECK_CYCLE_MONTHS, 12);       // 46 号令第 20 条 每年至少一次
  assert.equal(SITE_CHECK_CYCLE_MONTHS, 12);         // 46 号令第 21 条 参数化
  assert.equal(DOSE_MAX_DAYS, 90);                   // 55 号令第十一条 最长不应超过 90 天
  assert.equal(TRAINING_CYCLE_DAYS, 730);            // 惯例两年参数化
  assert.equal(HEALTH_CHECK_CYCLE_DAYS, 730);        // 55 号令第十九条 间隔≤2 年
  assert.equal(LICENSE_WARN_DAYS, 90);
  assert.equal(DEFAULT_RENEW_WARN_DAYS, 30);
  assert.equal(DEFAULT_DOSE_WARN_DAYS, 15);
  assert.equal(DEFAULT_CHECK_WARN_DAYS, 30);
  assert.equal(STATE_VERSION, 1);
  assert.deepEqual(Object.keys(ORG_KINDS).sort(), ['dental', 'medical', 'vet']);
  assert.ok(ORG_KINDS.dental.includes('县级'));
  assert.deepEqual(Object.keys(PATIENT_TYPES), ['adult', 'child', 'woman']);
  assert.deepEqual(Object.keys(DUTY_KINDS), ['annualeval', 'drill', 'healthcheck']);
  assert.deepEqual(Object.keys(CHANGE_KINDS), ['name', 'scope', 'facility', 'other']);
  assert.equal(escapeHtml('<b>&x</b>'), '&lt;b&gt;&amp;x&lt;/b&gt;');
});

// ---------------------------------------------------------------------------
// 双证钟（449 号令第 13/52 条；46 号令第 17/38 条）
// ---------------------------------------------------------------------------

test('判型引擎：医疗类双证、动物诊疗类单证', () => {
  assert.deepEqual(requiredLicenses({ kind: 'dental' }), ['radlicense', 'radsafe']);
  assert.deepEqual(requiredLicenses({ kind: 'medical' }), ['radlicense', 'radsafe']);
  assert.deepEqual(requiredLicenses({ kind: 'vet' }), ['radsafe']);
});

test('radSafeState 五态：unset 红 / overdue 红（52 条罚则锚）/ window 黄（30 日）/ warn 黄 / ok', () => {
  const s = freshState();
  const unset = radSafeState(s.org, T);
  assert.equal(unset.level, 'unset');
  s.org.radSafeExpiryISO = '2026-09-01';
  assert.equal(radSafeState(s.org, T).level, 'overdue');
  assert.ok(radSafeState(s.org, T).detail.includes('第 52 条'));
  s.org.radSafeExpiryISO = '2026-09-20';
  assert.equal(radSafeState(s.org, T).level, 'window');       // 剩 12 天 ≤ 30 日窗口
  s.org.radSafeExpiryISO = '2026-11-01';
  assert.equal(radSafeState(s.org, T).level, 'warn');         // 剩 54 天 ≤ 90 提醒
  s.org.radSafeExpiryISO = '2027-03-01';
  assert.equal(radSafeState(s.org, T).level, 'ok');
});

test('radLicenseState 过期文案带 38 条锚；orgLicenseState 取最差证件态', () => {
  const s = freshState();
  s.org.kind = 'dental';
  s.org.radSafeExpiryISO = '2028-01-01';
  s.org.radLicenseExpiryISO = '2026-08-01';
  const worst = orgLicenseState(s.org, T);
  assert.equal(worst.level, 'overdue');
  assert.ok(worst.detail.includes('第 38 条'));
  s.org.radLicenseExpiryISO = '2027-01-01';
  assert.equal(orgLicenseState(s.org, T).level, 'ok');
});

test('renewLicense：非法键拒绝、新有效期必须晚于当前、办结滚动', () => {
  const s = freshState();
  s.org.radSafeExpiryISO = '2026-10-08';
  assert.throws(() => renewLicense(s.org, 'badKey', '2030-01-01'));
  assert.throws(() => renewLicense(s.org, 'radSafeExpiryISO', '2026-10-08'));
  renewLicense(s.org, 'radSafeExpiryISO', '2031-10-08');
  assert.equal(radSafeState(s.org, T).level, 'ok');
  const bare = freshState();
  assert.throws(() => renewLicense(bare.org, 'radLicenseExpiryISO', '2031-01-01'));
});

// ---------------------------------------------------------------------------
// 设备一机一档（46 号令第 20/21 条）
// ---------------------------------------------------------------------------

test('addDevice：名称/编号必填、编号唯一、双钟自动推导', () => {
  const s = freshState();
  assert.throws(() => addDevice(s, { name: 'X 机', code: '' }));
  const d = addDevice(s, { name: '牙科机', code: 'DX-01', statusCheckISO: '2025-09-08', siteCheckISO: '2025-09-08' });
  assert.throws(() => addDevice(s, { name: '另一台', code: 'DX-01' }));
  assert.equal(d.statusDueISO, '2026-09-08');
  assert.equal(d.siteDueISO, '2026-09-08');
  const d2 = addDevice(s, { name: 'CT', code: 'CBCT-02', statusCheckISO: '2023-01-31' });
  assert.equal(d2.statusDueISO, '2024-01-31');   // 月末钳制不越位
});

test('deviceClockState：unset 红 / overdue 红（41 条锚）/ due 黄 / ok / 停用 none', () => {
  const s = freshState();
  const unset = addDevice(s, { name: 'A', code: 'A-01' });
  assert.equal(deviceClockState(unset, 'status', T).level, 'unset');
  const over = addDevice(s, { name: 'B', code: 'B-01', statusCheckISO: '2025-08-08' });
  const st = deviceClockState(over, 'status', T);
  assert.equal(st.level, 'overdue');
  assert.ok(st.detail.includes('第 41 条(三)'));
  const due = addDevice(s, { name: 'C', code: 'C-01', statusCheckISO: '2025-09-15' });
  assert.equal(deviceClockState(due, 'status', T).level, 'due');   // 剩 7 天
  const ok = addDevice(s, { name: 'D', code: 'D-01', statusCheckISO: '2026-06-01', siteCheckISO: '2025-09-15' });
  assert.equal(deviceClockState(ok, 'status', T).level, 'ok');
  assert.equal(deviceClockState(ok, 'site', T).level, 'due');      // 场所检测剩 7 天
  setDeviceService(s, ok.id, false, T);
  assert.equal(deviceClockState(ok, 'status', T).level, 'none');
  assert.equal(activeDevices(s).length, 3);
});

test('recordDeviceCheck 滚动双钟；停用设备拒绝录入；非法类型拒绝', () => {
  const s = freshState();
  const d = addDevice(s, { name: 'A', code: 'A-01', statusCheckISO: '2025-09-08' });
  setDeviceService(s, d.id, false, T);
  assert.throws(() => recordDeviceCheck(s, d.id, 'status', T));
  setDeviceService(s, d.id, true, T);
  assert.throws(() => setDeviceService(s, d.id, true, T));
  recordDeviceCheck(s, d.id, 'status', '2026-09-01');
  assert.equal(d.statusDueISO, '2027-09-01');
  recordDeviceCheck(s, d.id, 'site', '2026-09-01');
  assert.equal(d.siteDueISO, '2027-09-01');
  assert.throws(() => recordDeviceCheck(s, d.id, 'yearly', T));
});

// ---------------------------------------------------------------------------
// 人员名册（449 号令第 28/29 条；55 号令第十一条）
// ---------------------------------------------------------------------------

test('addWorker：姓名必填、同姓名拒绝、日期校验；activeWorkers 过滤停用', () => {
  const s = freshState();
  assert.throws(() => addWorker(s, { name: '' }));
  const w = addWorker(s, { name: '王明澈', trainingISO: '2026-06-01', doseISO: '2026-08-20' });
  assert.throws(() => addWorker(s, { name: '王明澈' }));
  assert.throws(() => addWorker(s, { name: '李四', trainingISO: '2026-13-01' }));
  assert.equal(w.trainingDueISO, '2028-05-31');   // 2026-06-01 + 730 天
  assert.equal(w.doseDueISO, '2026-11-18');       // 2026-08-20 + 90 天
  setWorkerActive(s, w.id, false);
  assert.equal(activeWorkers(s).length, 0);
  assert.equal(s.workers.length, 1);
  assert.throws(() => setWorkerActive(s, 'wk-404', false));
});

test('trainingState/doseState：unset 红 / overdue 红 / due 黄 / ok；剂量文案带 90 天上限', () => {
  const s = freshState();
  const unset = addWorker(s, { name: '甲' });
  assert.equal(trainingState(unset, T).level, 'unset');
  assert.equal(doseState(unset, T).level, 'unset');
  const over = addWorker(s, { name: '乙', trainingISO: '2024-06-01', doseISO: '2026-05-01' });
  assert.equal(trainingState(over, T).level, 'overdue');    // +730 = 2026-05-31 已过
  const doSt = doseState(over, T);
  assert.equal(doSt.level, 'overdue');                      // +90 = 2026-07-30 已过
  assert.ok(doSt.detail.includes('90 天'));
  const due = addWorker(s, { name: '丙', trainingISO: T, doseISO: '2026-06-25' });
  assert.equal(trainingState(due, T).level, 'ok');
  assert.equal(doseState(due, T).level, 'due');             // 2026-06-25+90=2026-09-23，剩 15 天
  const ok = addWorker(s, { name: '丁', trainingISO: '2026-06-01', doseISO: '2026-08-20' });
  assert.equal(trainingState(ok, T).level, 'ok');
  assert.equal(doseState(ok, T).level, 'ok');
  recordTraining(s, ok.id, T);
  assert.equal(ok.trainingDueISO, '2028-09-07');
  recordDose(s, ok.id, T, '0.12');
  assert.equal(ok.doseDueISO, '2026-12-07');
  assert.equal(ok.lastDoseMsv, '0.12');
});

// ---------------------------------------------------------------------------
// 拍片六道闸（产品的门禁）
// ---------------------------------------------------------------------------

test('shotGate：全绿通过（口腔类六道闸）；window 期双证不拦截拍片', () => {
  const s = readyState();
  const pass = shotGate(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'adult' });
  assert.equal(pass.ok, true);
  assert.equal(pass.gates.length, 6);
  // 窗口期（届满 30 日内）许可证仍有效——放行拍片（venue-pass 教训反例）
  const win = readyState();
  win.org.radSafeExpiryISO = '2026-09-20';
  win.org.radLicenseExpiryISO = '2026-09-20';
  const g = shotGate(win, { dateISO: T, deviceId: win.dv.id, workerId: win.wk.id, patientType: 'adult' });
  assert.equal(g.gates[0].ok, true);
  assert.equal(g.gates[1].ok, true);
});

test('shotGate：辐射安全证过期/放射诊疗证过期/设备检测超期/停用设备逐道拦截且带法条口径', () => {
  // 闸 1：辐射安全证过期
  const rs = readyState();
  rs.org.radSafeExpiryISO = '2026-08-08';
  const g1 = shotGate(rs, { dateISO: T, deviceId: rs.dv.id, workerId: rs.wk.id, patientType: 'adult' });
  assert.equal(g1.ok, false);
  assert.ok(g1.reasons[0].includes('第 52 条'));

  // 闸 2：放射诊疗证过期（46 号令第 38 条）
  const rl = readyState();
  rl.org.radLicenseExpiryISO = '2026-08-08';
  const g2 = shotGate(rl, { dateISO: T, deviceId: rl.dv.id, workerId: rl.wk.id, patientType: 'adult' });
  assert.equal(g2.ok, false);
  assert.ok(g2.reasons.some((r) => r.includes('第 38 条')));

  // 闸 3：设备状态检测超期（46 号令第 20/41 条(三)）
  const dv = readyState();
  dv.dv.statusDueISO = '2026-08-01';
  const g3 = shotGate(dv, { dateISO: T, deviceId: dv.dv.id, workerId: dv.wk.id, patientType: 'adult' });
  assert.equal(g3.ok, false);
  assert.ok(g3.reasons.some((r) => r.includes('46 号令第 20 条') || r.includes('第 41 条(三)')));

  // 闸 3b：停用设备
  const off = readyState();
  setDeviceService(off, off.dv.id, false, T);
  const g3b = shotGate(off, { dateISO: T, deviceId: off.dv.id, workerId: off.wk.id, patientType: 'adult' });
  assert.equal(g3b.ok, false);
  assert.ok(g3b.reasons[0].includes('停用'));

  // 闸 4：培训超期（449 号令第 28 条）
  const tr = readyState();
  setWorkerActive(tr, tr.wk.id, false);
  const g4 = shotGate(tr, { dateISO: T, deviceId: tr.dv.id, workerId: tr.wk.id, patientType: 'adult' });
  assert.equal(g4.ok, false);
  assert.ok(g4.reasons.some((r) => r.includes('停用')));
  const noWk = shotGate(readyState(), { dateISO: T, deviceId: readyState().dv.id, workerId: '', patientType: 'adult' });
  assert.ok(noWk.reasons.some((r) => r.includes('第 28 条')));
});

test('shotGate 妊娠矩阵：育龄妇女未问/怀孕拦截，问明未孕放行，特殊需要+理由放行并留痕；儿童/成人不适用', () => {
  const s = readyState();
  // 未问明 → 拦
  const g1 = shotGate(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'woman', pregnancy: '' });
  assert.equal(g1.ok, false);
  assert.ok(g1.reasons.some((r) => r.includes('第 26 条(三)')));
  // 怀孕 → 拦
  const g2 = shotGate(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'woman', pregnancy: 'pregnant' });
  assert.equal(g2.ok, false);
  // 问明未孕 → 过
  const g3 = shotGate(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'woman', pregnancy: 'not-pregnant' });
  assert.equal(g3.ok, true);
  // 怀孕但临床特殊需要 → 过（落账留痕）
  const g4 = shotGate(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'woman', pregnancy: 'pregnant', special: true, note: '急症诊断需要' });
  assert.equal(g4.ok, true);
  // 成人/儿童不适用妊娠闸
  const g5 = shotGate(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'child' });
  assert.equal(g5.ok, true);
});

test('addShot：落账存合规快照（双证/检测/培训/剂量四期）；闸机拒绝不落账；删除自救', () => {
  const s = readyState();
  const sh = addShot(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'woman', pregnancy: 'not-pregnant', bodyPart: '14 根尖片' });
  assert.equal(sh.snapshot.radSafeExpiryISO, '2028-09-08');
  assert.equal(sh.snapshot.radLicenseExpiryISO, '2027-06-01');
  assert.equal(sh.snapshot.deviceStatusDueISO, '2027-06-01');
  assert.equal(sh.snapshot.workerDoseDueISO, '2026-11-18');
  const n0 = s.shots.length;
  assert.throws(() => addShot(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'woman', pregnancy: 'pregnant' }));
  assert.equal(s.shots.length, n0);
  removeShot(s, sh.id);
  assert.equal(s.shots.length, 0);
  assert.throws(() => removeShot(s, 'sh-404'));
});

test('vet 判型：只核辐射安全证，拍片闸五道且不核放射诊疗证', () => {
  const s = readyState();
  s.org.kind = 'vet';
  s.org.radLicenseExpiryISO = '2026-08-01';   // 故意过期——vet 不核此证
  const g = shotGate(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'adult' });
  assert.equal(g.ok, true);
  assert.equal(g.gates.length, 5);
});

// ---------------------------------------------------------------------------
// 事件闭环 / 变更台账 / 义务
// ---------------------------------------------------------------------------

test('addIncident：来源/描述校验；fixIncident/closeIncident 状态机跳级与倒挂拒绝', () => {
  const s = freshState();
  assert.throws(() => addIncident(s, { dateISO: T, source: 'chat', desc: 'x' }));
  assert.throws(() => addIncident(s, { dateISO: T, source: 'event', desc: '' }));
  const it = addIncident(s, { dateISO: '2026-09-01', source: 'inspection', desc: '机房联锁失灵' });
  assert.throws(() => closeIncident(s, it.id, { verifyISO: T, verifiedBy: '沈清辉' }));   // 跳级
  assert.throws(() => fixIncident(s, it.id, { actionISO: '2026-08-01', action: '整改' })); // 倒挂
  assert.throws(() => fixIncident(s, it.id, { actionISO: '2026-09-02', action: '' }));
  fixIncident(s, it.id, { actionISO: '2026-09-05', action: '联锁修复复测合格' });
  assert.throws(() => closeIncident(s, it.id, { verifyISO: '2026-09-01', verifiedBy: '沈清辉' }));
  closeIncident(s, it.id, { verifyISO: '2026-09-06', verifiedBy: '沈清辉' });
  assert.equal(it.status, 'closed');
  assert.equal(openIncidents(s).length, 0);
});

test('addChange/fileChange：非法情形拒绝、日期倒挂拒绝、openChanges 只返回未办结', () => {
  const s = freshState();
  assert.throws(() => addChange(s, { dateISO: T, kind: 'salary' }));
  assert.throws(() => addChange(s, { dateISO: T, kind: 'facility', detail: '' }));
  const c1 = addChange(s, { dateISO: '2026-08-01', kind: 'facility', detail: '新增口腔 CT' });
  fileChange(s, c1.id, '2026-08-15');
  assert.throws(() => fileChange(s, c1.id, '2026-09-01'));
  addChange(s, { dateISO: '2026-09-01', kind: 'name', detail: '名称变更' });
  assert.equal(openChanges(s).length, 1);
});

test('setDutyDone/dutyBoard：打勾滚动、未登记义务入板为 never', () => {
  const s = freshState();
  setDutyDone(s, 'annualeval', '2025-09-07', '已提交');
  const d = dutyState(s.duties[0], T);
  assert.equal(d.level, 'overdue');
  assert.throws(() => setDutyDone(s, 'tax', T));
  const board = dutyBoard(s, T);
  assert.equal(board.length, Object.keys(DUTY_KINDS).length);
  assert.equal(board[0].level, 'never');
});

// ---------------------------------------------------------------------------
// 体检 / 月报 / 出证
// ---------------------------------------------------------------------------

test('healthCheck：全绿 100 分；种子红灯扣分且下限 0', () => {
  const s = readyState();
  setDutyDone(s, 'annualeval', T);
  setDutyDone(s, 'drill', T);
  setDutyDone(s, 'healthcheck', T);
  const hc = healthCheck(s, T, s.settings);
  assert.equal(hc.bad, 0);
  assert.ok(hc.warn > 0);                    // 拍片台账为空至少一黄
  assert.ok(hc.score > 0 && hc.score < 100);
  const empty = healthCheck(freshState(), T, {});
  assert.ok(empty.bad >= 3);
  assert.ok(empty.score >= 0);
});

test('monthlySummary：结构完整、拦截计数、特殊需要打标、口径尾注带现行法规', () => {
  const s = readyState();
  addShot(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'woman', pregnancy: 'pregnant', special: true, note: '急症需要' });
  s.traces.push({ type: 'shot-gate-blocked', at: `${T}T02:00:00.000Z`, dateISO: T, reasons: ['x'] });
  const sum = monthlySummary(s, '2026-09', T);
  assert.equal(sum.shots, 1);
  assert.equal(sum.blocked, 1);
  assert.equal(sum.special, 1);
  assert.ok(sum.text.includes('拍片单'));
  assert.ok(sum.text.includes('449 号令'));
  assert.ok(sum.text.includes('46 号令'));
  assert.throws(() => monthlySummary(s, '2026-9', T));
});

test('inspectHtml 与 shotHtml：自证包与核对单含关键段落与转义', () => {
  const s = readyState();
  const sh = addShot(s, { dateISO: T, deviceId: s.dv.id, workerId: s.wk.id, patientType: 'woman', pregnancy: 'pregnant', special: true, bodyPart: '部位<b>' });
  const html = inspectHtml(s, T, s.settings);
  assert.ok(html.includes('迎检自证包'));
  assert.ok(html.includes('明澈口腔门诊部'));
  assert.ok(html.includes('一机一档') || html.includes('射线装置一机一档'));
  assert.ok(html.includes('放射工作人员名册'));
  assert.ok(html.includes('拍片台账'));
  assert.ok(html.includes('变更/重新申领台账'));
  assert.ok(html.includes('&lt;b&gt;'));
  const single = shotHtml(s, sh.id, T);
  assert.ok(single.includes('拍片合规核对单'));
  assert.ok(single.includes('特殊需要'));
  assert.ok(single.includes('2028-09-08'));
  assert.throws(() => shotHtml(s, 'sh-404', T));
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle：跨 app 拒绝、结构缺失拒绝、合法备份通过', () => {
  const s = readyState();
  const bundle = exportBundle(s);
  assert.equal(importBundle(bundle).ok, true);
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'venuepass', version: 1, state: {} })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'xraypass', version: 99, state: {} })).ok, false);
  const partial = JSON.stringify({ app: 'xraypass', version: 1, state: { org: {} } });
  assert.equal(importBundle(partial).ok, false);
});
