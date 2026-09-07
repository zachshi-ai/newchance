/**
 * tests/core.test.mjs — 开馆单 VenuePass 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addMonthsExact, daysUntil, monthKey, escapeHtml,
  RENEW_ADVANCE_DAYS, LICENSE_WARN_DAYS, DEFAULT_GEAR_CYCLE_MONTHS, GEAR_WARN_DAYS,
  DEFAULT_RENEW_WARN_DAYS, DEFAULT_GEAR_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
  PROJECT_KINDS, STAFF_ROLES, DAYCHECK_ITEMS, DUTY_KINDS, CHANGE_KINDS, HAZARD_SOURCES,
  licenseState, renewLicense,
  addStaff, setStaffActive, activeStaff, staffCertState,
  addGear, activeGear, gearState, recordGearCheck, setGearService,
  daycheckItemsFor, recordDaycheck, lastDaycheck,
  addHazard, fixHazard, closeHazard, openHazards,
  openGate, addOpening, removeOpening,
  addChange, fileChange, openChanges,
  setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary, inspectHtml, openPassHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';
import { emptyState } from '../app/js/store.js';

const T = '2026-09-08'; // 测试锚定日期（周二），不依赖墙钟

function freshState() {
  return emptyState();
}

/** 一个全绿的可开馆状态（许可证远期、2 名持证在册、器材在期） */
function readyState() {
  const s = freshState();
  s.venue.name = '岩语攀岩馆';
  s.venue.licenseNo = '高体证字〔2024〕第 0102 号';
  s.venue.licenseExpiryISO = '2027-09-08';
  s.venue.projects = ['climb'];
  s.venue.minStaffPerDay = 2;
  s.a = addStaff(s, { name: '林晚秋', role: 'instructor', certValidISO: '2027-01-01' });
  s.b = addStaff(s, { name: '苏千帆', role: 'rescuer', certValidISO: '2027-06-01' });
  return s;
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

test('法定/惯例常数基线：届满 30 日续期窗口、器材默认 12 个月、提醒参数', () => {
  assert.equal(RENEW_ADVANCE_DAYS, 30);          // 17 号令第 14 条：届满 30 日前申请续期
  assert.equal(LICENSE_WARN_DAYS, 90);
  assert.equal(DEFAULT_GEAR_CYCLE_MONTHS, 12);   // 检查标准 4：维护保养及定期检测（参数化）
  assert.equal(GEAR_WARN_DAYS, 30);
  assert.equal(DEFAULT_RENEW_WARN_DAYS, 30);
  assert.equal(DEFAULT_GEAR_WARN_DAYS, 30);
  assert.equal(DEFAULT_DUTY_WARN_DAYS, 30);
  assert.equal(STATE_VERSION, 1);
  // 目录公告 2013 年第 16 号四项目（游泳归 #12 泳清单领域，本工具三项）
  assert.deepEqual(Object.keys(PROJECT_KINDS).sort(), ['climb', 'dive', 'ski']);
  assert.ok(PROJECT_KINDS.ski.includes('GB 19079.6'));
  assert.ok(PROJECT_KINDS.dive.includes('GB 19079.10'));
  assert.ok(PROJECT_KINDS.climb.includes('GB 19079.4'));
  assert.deepEqual(Object.keys(STAFF_ROLES), ['instructor', 'rescuer']); // 体育法第 105 条(二)
  assert.deepEqual(Object.keys(DAYCHECK_ITEMS).sort(), ['climb', 'dive', 'ski']);
  for (const k of Object.keys(DAYCHECK_ITEMS)) {
    assert.ok(DAYCHECK_ITEMS[k].length >= 4, `${k} 日检条目应覆盖安全链`);
    for (const [key, label] of DAYCHECK_ITEMS[k]) {
      assert.ok(key && label);
    }
  }
  assert.deepEqual(Object.keys(DUTY_KINDS), ['drill', 'training', 'facility', 'insurance', 'eventpermit']);
  assert.deepEqual(Object.keys(CHANGE_KINDS), ['venue', 'person', 'project', 'name', 'other']);
  assert.deepEqual(Object.keys(HAZARD_SOURCES), ['daycheck', 'inspection', 'selfcheck']);
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

// ---------------------------------------------------------------------------
// 许可证钟（体育法第 105/116 条；17 号令第 14 条）
// ---------------------------------------------------------------------------

test('licenseState 五态：unset 红 / overdue 红 / window 黄（届满 30 日）/ warn 黄 / ok 绿', () => {
  const s = freshState();
  const unset = licenseState(s.venue, T);
  assert.equal(unset.level, 'unset');
  assert.ok(unset.detail.includes('第 105 条'), 'unset 文案应带法条锚');
  s.venue.licenseExpiryISO = '2026-09-01';
  assert.equal(licenseState(s.venue, T).level, 'overdue');
  s.venue.licenseExpiryISO = '2026-09-20';
  assert.equal(licenseState(s.venue, T).level, 'window');     // 剩 12 天 ≤ 30 天窗口
  s.venue.licenseExpiryISO = '2026-11-01';
  assert.equal(licenseState(s.venue, T).level, 'warn');       // 剩 54 天 ≤ 90 天提醒
  s.venue.licenseExpiryISO = '2027-03-01';
  assert.equal(licenseState(s.venue, T).level, 'ok');
  s.venue.licenseExpiryISO = '2026-08-01';
  assert.ok(licenseState(s.venue, T).detail.includes('第 116 条'), '过期文案应带体育法第 116 条罚则锚');
});

test('renewLicense：新有效期必须晚于当前；办结滚动许可证钟', () => {
  const s = freshState();
  s.venue.licenseExpiryISO = '2026-10-08';
  assert.throws(() => renewLicense(s.venue, '2026-10-08'));
  assert.throws(() => renewLicense(s.venue, '2025-01-01'));
  renewLicense(s.venue, '2031-10-08');
  assert.equal(s.venue.licenseExpiryISO, '2031-10-08');
  assert.equal(licenseState(s.venue, T).level, 'ok');
  const bare = freshState();
  assert.throws(() => renewLicense(bare.venue, '2031-01-01'));
});

// ---------------------------------------------------------------------------
// 人员名册与证书钟（体育法第 105 条(二)；检查标准 5）
// ---------------------------------------------------------------------------

test('addStaff：姓名必填、角色合法、同姓名同角色拒绝；activeStaff 过滤停用', () => {
  const s = freshState();
  assert.throws(() => addStaff(s, { name: '' }));
  assert.throws(() => addStaff(s, { name: '张三', role: 'boss' }));
  const a = addStaff(s, { name: '张三', role: 'instructor' });
  assert.throws(() => addStaff(s, { name: '张三', role: 'instructor' }));
  addStaff(s, { name: '张三', role: 'rescuer' });             // 同名不同岗可以
  assert.equal(s.staff.length, 2);
  assert.throws(() => addStaff(s, { name: '李四', role: 'rescuer', certValidISO: '2026-13-01' }));
  setStaffActive(s, a.id, false);
  assert.equal(activeStaff(s).length, 1);
  assert.equal(s.staff.length, 2);                            // 停用不删除
  assert.throws(() => setStaffActive(s, 'st-404', false));
});

test('staffCertState 四态：unset 红 / overdue 红（带禁上岗文案）/ warn 黄 / ok', () => {
  const s = freshState();
  const unset = addStaff(s, { name: '甲', role: 'instructor' });
  assert.equal(staffCertState(unset, T).level, 'unset');
  const over = addStaff(s, { name: '乙', role: 'instructor', certValidISO: '2026-08-01' });
  const st = staffCertState(over, T);
  assert.equal(st.level, 'overdue');
  assert.ok(st.detail.includes('不得安排上岗'));
  const warn = addStaff(s, { name: '丙', role: 'rescuer', certValidISO: '2026-09-20' });
  assert.equal(staffCertState(warn, T).level, 'warn');        // 剩 12 天 ≤ 60 天
  const ok = addStaff(s, { name: '丁', role: 'rescuer', certValidISO: '2027-06-01' });
  assert.equal(staffCertState(ok, T).level, 'ok');
});

// ---------------------------------------------------------------------------
// 器材一物一档（检查标准 4；17 号令第 22 条）
// ---------------------------------------------------------------------------

test('addGear：名称/编号必填、编号唯一、周期默认 12 个月、到期日自动推导且月末钳制', () => {
  const s = freshState();
  assert.throws(() => addGear(s, { name: '动力绳', code: '' }));
  const g = addGear(s, { name: '动力绳', code: 'ROPE-01', lastCheckISO: '2025-09-08' });
  assert.throws(() => addGear(s, { name: '动力绳 2', code: 'ROPE-01' }));
  assert.equal(g.cycleMonths, 12);
  assert.equal(g.dueISO, '2026-09-08');
  const g2 = addGear(s, { name: '气瓶', code: 'TANK-01', cycleMonths: 36, lastCheckISO: '2023-01-31' });
  assert.equal(g2.dueISO, '2026-01-31');
});

test('gearState 五态：unset 红 / overdue 红 / due 黄（30 天）/ ok / 停用 none', () => {
  const s = freshState();
  const unset = addGear(s, { name: 'A', code: 'A-01' });
  assert.equal(gearState(unset, T).level, 'unset');
  const over = addGear(s, { name: 'B', code: 'B-01', lastCheckISO: '2025-08-08' });
  assert.equal(gearState(over, T).level, 'overdue');
  const due = addGear(s, { name: 'C', code: 'C-01', lastCheckISO: '2025-09-15' });
  assert.equal(gearState(due, T).level, 'due');               // 剩 7 天
  const ok = addGear(s, { name: 'D', code: 'D-01', lastCheckISO: '2026-06-01' });
  assert.equal(gearState(ok, T).level, 'ok');
  setGearService(s, ok.id, false, T);
  assert.equal(gearState(ok, T).level, 'none');
  assert.ok(gearState(over, T).detail.includes('停用'), '超期文案应要求停用');
});

test('recordGearCheck 滚动检验钟；停用器材拒绝录入；setGearService 重复停用/复用拒绝', () => {
  const s = freshState();
  const g = addGear(s, { name: 'A', code: 'A-01', lastCheckISO: '2025-09-08' });
  setGearService(s, g.id, false, T);
  assert.throws(() => recordGearCheck(s, g.id, T));
  setGearService(s, g.id, true, T);
  assert.throws(() => setGearService(s, g.id, true, T));      // 已在用
  recordGearCheck(s, g.id, '2026-09-01');
  assert.equal(g.dueISO, '2027-09-01');
  assert.equal(gearState(g, T).level, 'ok');
  assert.throws(() => setGearService(s, 'gr-404', false, T));
  assert.equal(activeGear(s).length, 1);
});

// ---------------------------------------------------------------------------
// 每日开放前检查（17 号令第 22 条）与隐患自动转接
// ---------------------------------------------------------------------------

test('daycheckItemsFor 按项目合并条目并带项目前缀', () => {
  const s = freshState();
  assert.equal(daycheckItemsFor(s).length, 0);
  s.venue.projects = ['climb', 'dive'];
  const items = daycheckItemsFor(s);
  assert.equal(items.length, DAYCHECK_ITEMS.climb.length + DAYCHECK_ITEMS.dive.length);
  assert.ok(items.every((i) => i.key.includes(':')));
});

test('recordDaycheck：同日唯一；异常必写处置说明；异常自动转隐患', () => {
  const s = readyState();
  const items = daycheckItemsFor(s);
  // 异常未写说明 → 拒绝
  assert.throws(() => recordDaycheck(s, {
    dateISO: T,
    results: Object.fromEntries(items.map((it) => it.key === 'climb:wall' ? [it.key, { ok: false, note: '' }] : [it.key, { ok: true, note: '' }])),
  }));
  // 写了说明 → 落卡并自动转隐患
  const rec = recordDaycheck(s, {
    dateISO: T,
    results: Object.fromEntries(items.map((it) => it.key === 'climb:wall' ? [it.key, { ok: false, note: '3 号岩点松动已拆除' }] : [it.key, { ok: true, note: '' }])),
  });
  assert.equal(rec.status, 'issue');
  assert.equal(s.daychecks.length, 1);
  assert.equal(openHazards(s).length, 1);
  assert.ok(openHazards(s)[0].desc.includes('岩壁与岩点'));
  assert.ok(openHazards(s)[0].desc.includes('3 号岩点松动已拆除'));
  // 同日唯一
  assert.throws(() => recordDaycheck(s, { dateISO: T, results: {} }));
  // 全项正常不转隐患
  const s2 = readyState();
  recordDaycheck(s2, { dateISO: T, results: Object.fromEntries(daycheckItemsFor(s2).map((it) => [it.key, { ok: true, note: '' }])) });
  assert.equal(s2.daychecks[0].status, 'ok');
  assert.equal(openHazards(s2).length, 0);
  assert.equal(lastDaycheck(s2).dateISO, T);
});

test('recordDaycheck 未选项目/非法日期拒绝', () => {
  const s = freshState();
  assert.throws(() => recordDaycheck(s, { dateISO: T, results: {} }));   // 未选项目
  s.venue.projects = ['climb'];
  assert.throws(() => recordDaycheck(s, { dateISO: '2026-9-8', results: {} }));
});

// ---------------------------------------------------------------------------
// 隐患闭环（状态机 open → fixed → closed）
// ---------------------------------------------------------------------------

test('addHazard：来源/描述校验；fixHazard/closeHazard 状态机跳级与倒挂拒绝', () => {
  const s = freshState();
  assert.throws(() => addHazard(s, { dateISO: T, source: 'chat', desc: 'x' }));
  assert.throws(() => addHazard(s, { dateISO: T, source: 'selfcheck', desc: '' }));
  const hz = addHazard(s, { dateISO: '2026-09-01', source: 'inspection', desc: '坠落区垫块移位' });
  assert.throws(() => closeHazard(s, hz.id, { verifyISO: T, verifiedBy: '沈磐石' }));   // 跳级
  assert.throws(() => fixHazard(s, hz.id, { actionISO: '2026-08-01', action: '整改' })); // 倒挂
  assert.throws(() => fixHazard(s, hz.id, { actionISO: '2026-09-02', action: '' }));     // 无措施
  fixHazard(s, hz.id, { actionISO: '2026-09-05', action: '垫块复位加固' });
  assert.throws(() => fixHazard(s, hz.id, { actionISO: '2026-09-06', action: '再改' })); // 非 open
  assert.throws(() => closeHazard(s, hz.id, { verifyISO: '2026-09-01', verifiedBy: '沈磐石' })); // 早于整改日
  assert.throws(() => closeHazard(s, hz.id, { verifyISO: '2026-09-06', verifiedBy: '' }));  // 无复查人
  closeHazard(s, hz.id, { verifyISO: '2026-09-06', verifiedBy: '沈磐石' });
  assert.equal(hz.status, 'closed');
  assert.equal(openHazards(s).length, 0);
  assert.throws(() => closeHazard(s, hz.id, { verifyISO: '2026-09-07', verifiedBy: '沈磐石' })); // 已闭环
});

test('openHazards 未闭环在前、早的在前', () => {
  const s = freshState();
  addHazard(s, { dateISO: '2026-09-02', source: 'selfcheck', desc: '乙' });
  const a = addHazard(s, { dateISO: '2026-09-01', source: 'selfcheck', desc: '甲' });
  fixHazard(s, a.id, { actionISO: '2026-09-03', action: '改毕' });
  const open = openHazards(s);
  assert.equal(open.length, 2);
  assert.equal(open[0].desc, '甲');   // fixed 但未 closed 仍在 open，按日期在前
});

// ---------------------------------------------------------------------------
// 开馆五道闸（产品的门禁）
// ---------------------------------------------------------------------------

test('openGate：全绿通过；许可证过期/人数不足/证书过期/未日检/隐患未闭环逐道拦截且带法条口径', () => {
  const s = readyState();
  const items = daycheckItemsFor(s);
  recordDaycheck(s, { dateISO: T, results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])) });
  const pass = openGate(s, { dateISO: T, staffIds: [s.a.id, s.b.id] });
  assert.equal(pass.ok, true);
  assert.equal(pass.gates.length, 5);

  // 闸 1：许可证过期
  const expired = readyState();
  expired.venue.licenseExpiryISO = '2026-08-08';
  const g1 = openGate(expired, { dateISO: T, staffIds: [expired.a.id, expired.b.id] });
  assert.equal(g1.ok, false);
  assert.ok(g1.reasons[0].includes('第 116 条'));

  // 闸 1 反例：续期窗口期（届满 30 日内）许可证仍有效，不拦截开门（只提醒办手续）
  const windowLic = readyState();
  windowLic.venue.licenseExpiryISO = '2026-09-20';
  const g1w = openGate(windowLic, { dateISO: T, staffIds: [windowLic.a.id, windowLic.b.id] });
  assert.equal(g1w.gates[0].ok, true);

  // 闸 2：人数不足规定数量
  const g2 = openGate(s, { dateISO: T, staffIds: [s.a.id] });
  assert.ok(g2.reasons.some((r) => r.includes('规定数量')));
  const noNeed = readyState();
  noNeed.venue.minStaffPerDay = 0;
  const g2b = openGate(noNeed, { dateISO: T, staffIds: [noNeed.a.id] });
  assert.ok(g2b.reasons.some((r) => r.includes('第 105 条(二)')));

  // 闸 3：在岗人员证书过期（韩江雪过期证不得上岗）
  const badCert = readyState();
  badCert.c = addStaff(badCert, { name: '韩江雪', role: 'rescuer', certValidISO: '2026-08-01' });
  const g3 = openGate(badCert, { dateISO: T, staffIds: [badCert.a.id, badCert.c.id] });
  assert.equal(g3.ok, false);
  assert.ok(g3.reasons.some((r) => r.includes('不得安排上岗')));
  // 空点名
  const g3b = openGate(s, { dateISO: T, staffIds: [] });
  assert.ok(g3b.reasons.some((r) => r.includes('持证上岗')));

  // 闸 4：当日未落日检卡
  const g4 = openGate(readyState(), { dateISO: T, staffIds: [s.a.id, s.b.id] });
  assert.ok(g4.reasons.some((r) => r.includes('17 号令第 22 条')));

  // 闸 5：隐患未闭环
  const hz = readyState();
  addHazard(hz, { dateISO: T, source: 'daycheck', desc: 'X' });
  const g5 = openGate(hz, { dateISO: T, staffIds: [hz.a.id, hz.b.id] });
  assert.equal(g5.ok, false);
  assert.ok(g5.reasons.some((r) => r.includes('未闭环隐患')));
});

test('addOpening：同日唯一；落账存当日快照；闸机拒绝时不落账', () => {
  const s = readyState();
  const items = daycheckItemsFor(s);
  recordDaycheck(s, { dateISO: T, results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])) });
  const o = addOpening(s, { dateISO: T, staffIds: [s.a.id, s.b.id] });
  assert.equal(o.snapshot.licenseExpiryISO, '2027-09-08');
  assert.equal(o.staffNames.length, 2);
  assert.ok(o.staffNames[0].includes('林晚秋'));
  assert.equal(o.snapshot.staffCerts['林晚秋'], '2027-01-01');
  assert.throws(() => addOpening(s, { dateISO: T, staffIds: [s.a.id, s.b.id] }));   // 同日唯一
  const n0 = s.openings.length;
  assert.throws(() => addOpening(s, { dateISO: '2026-09-09', staffIds: [s.a.id, s.b.id] })); // 9 日未日检
  assert.equal(s.openings.length, n0);
  removeOpening(s, o.id);
  assert.equal(s.openings.length, 0);
  assert.throws(() => removeOpening(s, 'op-404'));
});

// ---------------------------------------------------------------------------
// 变更台账 / 周期义务
// ---------------------------------------------------------------------------

test('addChange：非法情形/空说明拒绝；fileChange 日期倒挂与重复办结拒绝；openChanges 只返回未办结', () => {
  const s = freshState();
  assert.throws(() => addChange(s, { dateISO: T, kind: 'salary' }));
  assert.throws(() => addChange(s, { dateISO: T, kind: 'person', detail: '' }));
  const c1 = addChange(s, { dateISO: '2026-08-01', kind: 'person', detail: '经营者变更' });
  const c2 = addChange(s, { dateISO: '2026-09-01', kind: 'project', detail: '新增潜水项目' });
  assert.equal(openChanges(s).length, 2);
  assert.throws(() => fileChange(s, c1.id, '2026-07-01'));   // 早于发生日
  fileChange(s, c1.id, '2026-08-15');
  assert.equal(openChanges(s).length, 1);
  assert.throws(() => fileChange(s, c1.id, '2026-09-01'));   // 重复办结
  assert.equal(c2.status, 'open');
});

test('setDutyDone/dutyState/dutyBoard：打勾滚动、未登记义务入板为 never、红灯排序', () => {
  const s = freshState();
  setDutyDone(s, 'drill', '2026-02-28', '冬季演练');           // 180 天周期
  const d = dutyState(s.duties[0], T);
  assert.equal(d.level, 'overdue');                            // 2026-08-27 已过
  assert.throws(() => setDutyDone(s, 'tax', T));
  setDutyDone(s, 'training', T);
  const board = dutyBoard(s, T);
  assert.equal(board.length, Object.keys(DUTY_KINDS).length);  // 未登记义务也入板
  assert.equal(board[0].level, 'never');                       // never 排最前
  assert.equal(board.find((x) => x.kind === 'drill').daysLeft, -12);  // drill 逾期 12 天
  const never = board.find((x) => x.kind === 'eventpermit');
  assert.equal(never.level, 'never');
});

// ---------------------------------------------------------------------------
// 体检 / 月报 / 出证
// ---------------------------------------------------------------------------

test('healthCheck：全绿 100 分；种子红灯扣分且下限 0', () => {
  const s = readyState();
  const items = daycheckItemsFor(s);
  recordDaycheck(s, { dateISO: T, results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])) });
  addOpening(s, { dateISO: T, staffIds: [s.a.id, s.b.id] });
  setDutyDone(s, 'drill', T);
  setDutyDone(s, 'training', T);
  setDutyDone(s, 'facility', T);
  setDutyDone(s, 'insurance', T);
  setDutyDone(s, 'eventpermit', T);
  const hc = healthCheck(s, T, s.settings);
  assert.equal(hc.bad, 0);
  assert.equal(hc.warn, 0);
  assert.equal(hc.score, 100);
  const empty = healthCheck(freshState(), T, {});
  assert.ok(empty.bad >= 3);
  assert.ok(empty.score < 100 && empty.score >= 0);
  const wiped = freshState();
  wiped.venue = {};
  const floor = healthCheck(wiped, T, {});
  assert.ok(floor.score >= 0);
});

test('monthlySummary：结构完整、拦截计数、口径尾注带现行法条', () => {
  const s = readyState();
  const items = daycheckItemsFor(s);
  recordDaycheck(s, { dateISO: T, results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])) });
  addOpening(s, { dateISO: T, staffIds: [s.a.id, s.b.id] });
  // 模拟一次闸机拦截埋点
  s.traces.push({ type: 'open-gate-blocked', at: `${T}T02:00:00.000Z`, dateISO: T, reasons: ['x'] });
  const sum = monthlySummary(s, '2026-09', T);
  assert.equal(sum.openings, 1);
  assert.equal(sum.blocked, 1);
  assert.equal(sum.daychecks, 1);
  assert.ok(sum.text.includes('开馆单'));
  assert.ok(sum.text.includes('体育法') || sum.text.includes('《体育法》'));
  assert.ok(sum.text.includes('总局令第 17 号'));
  assert.throws(() => monthlySummary(s, '2026-9', T));
});

test('inspectHtml 与 openPassHtml：自证包与开馆单含关键段落与转义', () => {
  const s = readyState();
  const items = daycheckItemsFor(s);
  recordDaycheck(s, { dateISO: T, results: Object.fromEntries(items.map((it) => it.key === 'climb:wall' ? [it.key, { ok: false, note: '岩点松动<b>' }] : [it.key, { ok: true, note: '' }])) });
  // 异常已自动转隐患：整改+销案闭环后，开馆闸恢复放行
  const hz = openHazards(s)[0];
  fixHazard(s, hz.id, { actionISO: T, action: '岩点复紧' });
  closeHazard(s, hz.id, { verifyISO: T, verifiedBy: '沈磐石' });
  const o = addOpening(s, { dateISO: T, staffIds: [s.a.id, s.b.id] });
  const html = inspectHtml(s, T, s.settings);
  assert.ok(html.includes('迎检自证包'));
  assert.ok(html.includes('从业人员名册'));
  assert.ok(html.includes('器材设施一物一档'));
  assert.ok(html.includes('开馆记录'));
  assert.ok(html.includes('变更手续台账'));
  assert.ok(html.includes('周期义务账'));
  assert.ok(html.includes('&lt;b&gt;'));                       // 异常说明已转义
  const pass = openPassHtml(s, o.id, T);
  assert.ok(pass.includes('当日开馆单'));
  assert.ok(pass.includes('五道闸'));
  assert.ok(pass.includes('林晚秋'));
  assert.ok(pass.includes('2027-09-08'));
  assert.throws(() => openPassHtml(s, 'op-404', T));
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle：跨 app 拒绝、结构缺失拒绝、合法备份通过', () => {
  const s = readyState();
  const bundle = exportBundle(s);
  assert.equal(importBundle(bundle).ok, true);
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'certledger', version: 1, state: {} })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'venuepass', version: 99, state: {} })).ok, false);
  const partial = JSON.stringify({ app: 'venuepass', version: 1, state: { venue: {} } });
  assert.equal(importBundle(partial).ok, false);
});
