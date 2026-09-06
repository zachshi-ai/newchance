/**
 * core.test.mjs — 护学账 BusRoll 域逻辑单元测试
 * 口径锚点：《校车安全管理条例》（国务院令第617号）——条号见 docs/14
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays, addMonthsISO, daysUntil, monthKey, ageOn, todayISO, escapeHtml,
  DEFAULT_SETTINGS, PRECHECK_ITEMS, RECHECK_ITEMS,
  certLevel, busClocks, driverClocks, driverOk,
  addBus, addDriver, addEscort, retireBus, updateBusInspection,
  startTrip, preCheck, board, alight, cancelTrip,
  openHazard, closeHazard, openHazards,
  setDutyDone, dutyState, dutyBoard, DUTY_KINDS,
  staleTrips, healthCheck, monthlySummary, tripConservation,
  tripCardHtml, inspectHtml, monthlyText,
  emptyState, exportBundle, importBundle, seedState,
} from '../app/js/core.js';

const T = '2026-09-07'; // 固定"今天"，测试全部确定性

function fresh() {
  const s = emptyState();
  s.settings = { ...DEFAULT_SETTINGS };
  return s;
}

/** 建一套最小可用人员车档并返回 id */
function rig(s) {
  const bus = addBus(s, {
    plate: '测A·11111', seats: 19, plateNo: '校牌-01',
    plateExpiryISO: '2027-06-01', inspectionLastISO: '2026-06-01',
    insuranceCvtExpiryISO: '2027-01-01', insuranceCarrierExpiryISO: '2027-03-01',
  });
  const driver = addDriver(s, { name: '张师傅', licenseClass: 'A1', birthdayISO: '1981-06-15', qualificationDateISO: '2024-01-01', auditLastISO: '2026-03-01' });
  const escort = addEscort(s, { name: '陈老师', phone: '13900000000' });
  return { bus, driver, escort };
}

function allOk() {
  return Object.fromEntries(PRECHECK_ITEMS.map((i) => [i.key, true]));
}
function allRechecked() {
  return Object.fromEntries(RECHECK_ITEMS.map((i) => [i.key, true]));
}

/* --------------------------------------------------------- 时间与口径 */

test('addMonthsISO 月末钳制：8-31 加 6 个月落在 2-28', () => {
  assert.equal(addMonthsISO('2024-08-31', 6), '2025-02-28');
  assert.equal(addMonthsISO('2025-11-30', 3), '2026-02-28');
  assert.equal(addMonthsISO('2026-03-15', 6), '2026-09-15');
});

test('addDays / daysUntil / monthKey / ageOn', () => {
  assert.equal(addDays('2026-09-07', 30), '2026-10-07');
  assert.equal(addDays('2026-10-07', -30), '2026-09-07');
  assert.equal(daysUntil('2026-10-07', T), 30);
  assert.equal(daysUntil('2026-09-01', T), -6);
  assert.equal(monthKey('2026-09-07'), '2026-09');
  assert.equal(ageOn('1981-06-15', T), 45);
  assert.equal(ageOn('1981-09-08', T), 44); // 明天才生日
  assert.equal(ageOn('1981-09-07', T), 45); // 今天生日
});

test('certLevel 三段边界：60 天黄线 / 15 天红线 / 负数过期', () => {
  assert.equal(certLevel(61), 'ok');
  assert.equal(certLevel(60), 'warn');
  assert.equal(certLevel(16), 'warn');
  assert.equal(certLevel(15), 'red');
  assert.equal(certLevel(1), 'red');
  assert.equal(certLevel(0), 'red');
  assert.equal(certLevel(-1), 'expired');
});

test('escapeHtml 转义', () => {
  assert.equal(escapeHtml('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});

/* --------------------------------------------------------- 车辆证照钟 */

test('车辆四钟：每半年安检（第20条）与缺登记亮「未登记」', () => {
  const s = fresh();
  const bus = addBus(s, {
    plate: '测A·22222', seats: 34,
    inspectionLastISO: '2026-03-21', plateExpiryISO: '2026-09-21',
    insuranceCvtExpiryISO: '2026-10-07', insuranceCarrierExpiryISO: '2026-12-31',
  });
  const clocks = busClocks(bus, T, s.settings);
  assert.equal(clocks.length, 4);
  const insp = clocks.find((c) => c.key === 'inspection');
  assert.equal(insp.dueISO, '2026-09-21');
  assert.equal(insp.level, 'red'); // 剩 14 天 ≤ 15
  assert.equal(insp.basis, '条例第20条');
  assert.equal(clocks.find((c) => c.key === 'plate').level, 'red'); // 同为剩 14 天
  assert.equal(clocks.find((c) => c.key === 'cvt').level, 'warn');
  assert.equal(clocks.find((c) => c.key === 'carrier').level, 'ok');
});

test('证照缺登记 = 过期级，比「过期」更早暴露', () => {
  const s = fresh();
  const bus = addBus(s, { plate: '测B·33333', seats: 19 });
  const clocks = busClocks(bus, T, s.settings);
  for (const c of clocks) assert.equal(c.level, 'expired');
});

test('登记检验日期重置钟：+6 个月', () => {
  const s = fresh();
  const { bus } = rig(s);
  updateBusInspection(s, bus.id, T);
  const c = busClocks(s.buses[0], T, s.settings).find((x) => x.key === 'inspection');
  assert.equal(c.dueISO, '2027-03-07');
  assert.equal(c.level, 'ok');
});

test('停用车辆不再参与（retireBus）', () => {
  const s = fresh();
  const { bus } = rig(s);
  retireBus(s, bus.id);
  assert.equal(bus.status, 'retired');
});

/* --------------------------------------------------------- 驾驶人 */

test('驾驶人两钟：年度审验（第26条）+ 年龄红线（第23条(一)）', () => {
  const s = fresh();
  const ok60 = addDriver(s, { name: '刚好60', birthdayISO: '1966-09-07', qualificationDateISO: '2020-01-01', auditLastISO: '2026-01-05' });
  const clocks = driverClocks(ok60, T, s.settings);
  const age = clocks.find((c) => c.key === 'age');
  assert.equal(age, undefined); // 60 周岁未超
  const audit = clocks.find((c) => c.key === 'audit');
  assert.equal(audit.dueISO, '2027-01-05');

  const old61 = addDriver(s, { name: '超龄', birthdayISO: '1965-09-07', qualificationDateISO: '2020-01-01', auditLastISO: '2026-01-05' });
  const c2 = driverClocks(old61, T, s.settings).find((c) => c.key === 'age');
  assert.equal(c2.level, 'expired');
  assert.ok(driverOk(ok60, T, s.settings));
  assert.ok(!driverOk(old61, T, s.settings));
});

test('未登记审验/资格 = 过期级', () => {
  const s = fresh();
  const d = addDriver(s, { name: '无记录' });
  const clocks = driverClocks(d, T, s.settings);
  assert.equal(clocks.find((c) => c.key === 'audit').level, 'expired');
  assert.equal(clocks.find((c) => c.key === 'qualification').level, 'expired');
});

/* --------------------------------------------------------- 趟次状态机 */

test('建趟次红线：无照管员拒绝（第38/53条）', () => {
  const s = fresh();
  const { bus, driver } = rig(s);
  assert.throws(() => startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [], dateISO: T }), /未指派随车照管人员|照管人员/);
});

test('建趟次红线：无资格驾驶人拒绝（第23/25条）', () => {
  const s = fresh();
  const { bus, escort } = rig(s);
  const d = addDriver(s, { name: '没资格' });
  assert.throws(() => startTrip(s, { busId: bus.id, driverId: d.id, escortIds: [escort.id], dateISO: T }), /未登记校车驾驶资格/);
});

test('建趟次红线：年龄出界拒绝——61 岁与 24 岁（第23条(一)）', () => {
  const s = fresh();
  const { bus, escort } = rig(s);
  const old = addDriver(s, { name: '61岁', birthdayISO: '1965-09-06', qualificationDateISO: '2020-01-01' });
  assert.throws(() => startTrip(s, { busId: bus.id, driverId: old.id, escortIds: [escort.id], dateISO: T }), /年龄/);
  const young = addDriver(s, { name: '24岁', birthdayISO: '2002-09-08', qualificationDateISO: '2024-01-01' });
  assert.throws(() => startTrip(s, { busId: bus.id, driverId: young.id, escortIds: [escort.id], dateISO: T }), /年龄/);
});

test('建趟次唯一性：同车同日同趟次拒绝；取消后可复用', () => {
  const s = fresh();
  const { bus, driver, escort } = rig(s);
  const t = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T, slot: 'am' });
  assert.throws(() => startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T, slot: 'am' }), /同一车辆.*趟次/);
  // 不同 slot / 不同日期可以
  startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T, slot: 'pm' });
  startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: '2026-09-08', slot: 'am' });
  cancelTrip(s, t.id, { note: 'x' });
  const again = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T, slot: 'am' });
  assert.equal(again.status, 'checking');
});

test('出车前检查：必须逐项确认；状态门禁', () => {
  const s = fresh();
  const { bus, driver, escort } = rig(s);
  const t = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T });
  assert.throws(() => board(s, t.id, { onCount: 5, onConfirmed: true }), /出车前/); // 未检查不能点名
  assert.throws(() => preCheck(s, t.id, { items: { brake: true } }), /逐项/);
  preCheck(s, t.id, { items: allOk(), dateISO: T });
  assert.equal(t.status, 'ready');
  assert.throws(() => preCheck(s, t.id, { items: allOk() }), /出车前检查中/); // 不能重复检查
});

test('带病校车开不了趟：异常项必须先建隐患，隐患闭环前发车被拒（第22/41条）', () => {
  const s = fresh();
  const { bus, driver, escort } = rig(s);
  const t = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T });
  const items = { ...allOk(), tyres: false };
  assert.throws(() => preCheck(s, t.id, { items }), /整改措施/); // 有异常不建隐患 → 拒绝
  const hz = openHazard(s, { busId: bus.id, tripId: t.id, dateISO: T, item: '轮胎（左前）', measure: '停运换胎' });
  preCheck(s, t.id, { items, note: '左前胎压低', dateISO: T });
  assert.equal(t.status, 'ready');
  assert.equal(t.check.abnormal, true);
  assert.throws(() => board(s, t.id, { onCount: 5, onConfirmed: true }), /带病校车|安全隐患/);
  closeHazard(s, hz.id, { closedISO: T, closeNote: '换胎后复查正常' });
  board(s, t.id, { onCount: 5, onConfirmed: true });
  assert.equal(t.status, 'boarded');
});

test('超员红线：超过核载直接拒绝（第34条），点名信息完整', () => {
  const s = fresh();
  const { bus, driver, escort } = rig(s);
  const t = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T });
  preCheck(s, t.id, { items: allOk(), dateISO: T });
  assert.throws(() => board(s, t.id, { onCount: 20, onConfirmed: true }), /超员.*19/);
  assert.throws(() => board(s, t.id, { onCount: -1, onConfirmed: true }), /非负整数/);
  assert.throws(() => board(s, t.id, { onCount: 10, onConfirmed: false }), /落座系好安全带/);
  board(s, t.id, { onCount: 19, onConfirmed: true }); // 压核载线：可以
  assert.equal(t.onCount, 19);
});

test('下车清点：人数守恒 + 中途下车留因 + 车内三查（第39条(五)）', () => {
  const s = fresh();
  const { bus, driver, escort } = rig(s);
  const t = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T });
  preCheck(s, t.id, { items: allOk(), dateISO: T });
  board(s, t.id, { onCount: 16, onConfirmed: true });
  assert.throws(() => alight(s, t.id, { offCount: 15, recheck: allRechecked() }), /下车人数.*对不上|中途下车/);
  assert.throws(() => alight(s, t.id, { offCount: 15, midOffCount: 1, recheck: allRechecked() }), /中途下车.*原因/);
  assert.throws(() => alight(s, t.id, { offCount: 16, recheck: { seats: true, aisle: true } }), /车内三查|行李/);
  assert.throws(() => alight(s, t.id, { offCount: 17, recheck: allRechecked() }), /对不上/);
  alight(s, t.id, { offCount: 15, midOffCount: 1, midNote: '家长中途接走', recheck: allRechecked(), dateISO: T });
  assert.equal(t.status, 'closed');
  assert.equal(t.closedISO, T);
  assert.throws(() => alight(s, t.id, { offCount: 16, recheck: allRechecked() }), /已载学生/); // 不可重复闭环
});

test('已闭环趟次不可取消（底账严肃性）；未闭环可取消且留痕', () => {
  const s = fresh();
  const { bus, driver, escort } = rig(s);
  const t1 = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T });
  preCheck(s, t1.id, { items: allOk(), dateISO: T });
  board(s, t1.id, { onCount: 5, onConfirmed: true });
  alight(s, t1.id, { offCount: 5, recheck: allRechecked(), dateISO: T });
  assert.throws(() => cancelTrip(s, t1.id), /不可修改或取消/);
  const t2 = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: '2026-09-08' });
  cancelTrip(s, t2.id, { note: '下雨停运' });
  assert.equal(t2.status, 'cancelled');
});

test('全程守恒：Σ上车 = Σ下车 + Σ中途；取消趟次不计入', () => {
  const s = fresh();
  const { bus, driver, escort } = rig(s);
  const mk = (dateISO, on, off, mid = 0) => {
    const t = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO, slot: dateISO.endsWith('1') ? 'am' : 'pm' });
    preCheck(s, t.id, { items: allOk(), dateISO });
    board(s, t.id, { onCount: on, onConfirmed: true, dateISO });
    alight(s, t.id, { offCount: off, midOffCount: mid, midNote: mid ? '中转' : '', recheck: allRechecked(), dateISO });
  };
  mk('2026-09-01', 16, 16);
  mk('2026-09-02', 17, 16, 1);
  const bad = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: '2026-09-03' });
  cancelTrip(s, bad.id);
  const c = tripConservation(s, '2026-09');
  assert.equal(c.trips, 2);
  assert.equal(c.on, 33);
  assert.equal(c.off + c.mid, 33);
  assert.equal(c.ok, true);
});

/* --------------------------------------------------------- 隐患与义务 */

test('隐患：整改措施必填、不可重复销案', () => {
  const s = fresh();
  assert.throws(() => openHazard(s, { busId: 'b1', dateISO: T, item: 'x', measure: '' }), /整改措施/);
  const hz = openHazard(s, { busId: 'b1', dateISO: T, item: '灭火器压力不足', measure: '换新' });
  assert.equal(openHazards(s).length, 1);
  closeHazard(s, hz.id, { closedISO: T });
  assert.throws(() => closeHazard(s, hz.id, { closedISO: T }), /重复销案/);
  assert.equal(openHazards(s).length, 0);
});

test('义务账：从未登记=逾期；完成后按周期滚动；周期参数生效', () => {
  const s = fresh();
  let d = dutyState({ kind: 'drill', lastDoneISO: '' }, T, s.settings);
  assert.equal(d.level, 'expired');
  setDutyDone(s, 'drill', '2026-03-01');
  d = dutyState(s.duties[0], T, s.settings);
  assert.equal(d.dueISO, '2026-08-28'); // 2026-03-01 + 180 天
  assert.equal(d.level, 'expired'); // 已逾期 10 天
  const s2 = fresh();
  setDutyDone(s2, 'drill', T);
  d = dutyState(s2.duties[0], T, s2.settings);
  assert.equal(d.level, 'ok');
  s2.settings.drillCycleDays = 30;
  d = dutyState(s2.duties[0], '2026-10-10', s2.settings);
  assert.equal(d.level, 'expired');
  assert.throws(() => setDutyDone(s, 'nope', T), /未知义务/);
  assert.equal(dutyBoard(s2, T).length, 6);
});

/* --------------------------------------------------------- 体检与月报 */

test('体检：干净状态 100 分；演示坏状态确定性扣分；同输入同分', () => {
  const s = fresh();
  rig(s);
  for (const kind of Object.keys(DUTY_KINDS)) setDutyDone(s, kind, T);
  assert.equal(healthCheck(s, T).score, 100);
  const bad = seedState(T);
  const h1 = healthCheck(bad, T);
  const h2 = healthCheck(bad, T);
  assert.equal(h1.score, h2.score);
  assert.ok(h1.score < 90);
  const keys = h1.lights.map((l) => l.key);
  assert.ok(keys.includes('stale'));
  // 过期证照被点名
  const withRed = fresh();
  addBus(withRed, { plate: '测C·44444', seats: 19, plateExpiryISO: '2026-08-01' });
  const hr = healthCheck(withRed, T);
  assert.ok(hr.score < 100);
  assert.ok(hr.lights.find((l) => l.key === 'cert').level !== 'ok');
});

test('月度小结：闭环/取消分列，未闭环趟次点名', () => {
  const s = fresh();
  const { bus, driver, escort } = rig(s);
  const t1 = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: '2026-09-01' });
  preCheck(s, t1.id, { items: allOk(), dateISO: '2026-09-01' });
  board(s, t1.id, { onCount: 10, onConfirmed: true, dateISO: '2026-09-01' });
  alight(s, t1.id, { offCount: 10, recheck: allRechecked(), dateISO: '2026-09-01' });
  const t2 = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: '2026-09-02', slot: 'pm' });
  preCheck(s, t2.id, { items: allOk(), dateISO: '2026-09-02' });
  const t3 = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: '2026-09-03' });
  cancelTrip(s, t3.id);
  const m = monthlySummary(s, '2026-09', T);
  assert.equal(m.tripCount, 2); // 取消趟次不计入
  assert.equal(m.closed, 1);
  assert.equal(m.cancelled, 1);
  assert.deepEqual(m.staleTrips, ['2026-09-02·晚接回']);
  assert.equal(m.conserveOk, true);
  assert.equal(staleTrips(s, T).length, 1);
});

/* --------------------------------------------------------- 出证三通道 */

test('趟次点名卡：含七项检查/人数/三查/签字栏，无 undefined', () => {
  const s = fresh();
  const { bus, driver, escort } = rig(s);
  const t = startTrip(s, { busId: bus.id, driverId: driver.id, escortIds: [escort.id], dateISO: T, route: '1号线' });
  preCheck(s, t.id, { items: allOk(), dateISO: T });
  board(s, t.id, { onCount: 12, onConfirmed: true, dateISO: T });
  alight(s, t.id, { offCount: 12, recheck: allRechecked(), dateISO: T });
  const html = tripCardHtml(s, t.id);
  for (const kw of ['点名卡', '测A·11111', '张师傅', '陈老师', '12 人', '车内三查', '驾驶人签字', '照管员签字', '全部离车']) {
    assert.ok(html.includes(kw), `应包含 ${kw}`);
  }
  assert.ok(!html.includes('undefined'));
});

test('迎检自证包：含一车一档/守恒/义务/签字栏，无 undefined 泄漏', () => {
  const s = seedState(T);
  const html = inspectHtml(s, T);
  for (const kw of ['迎检自证包', '一车一档', '守恒校验', '随车照管', '周期义务', '单位负责人签字', '617']) {
    assert.ok(html.includes(kw), `应包含 ${kw}`);
  }
  assert.ok(!html.includes('>undefined<'));
  assert.ok(!html.includes('undefined'));
});

test('月度小结文本：守恒行与风险行、无 undefined', () => {
  const s = seedState(T);
  const txt = monthlyText(s, '2026-09');
  assert.ok(txt.includes('守恒'));
  assert.ok(txt.includes('未闭环'));
  assert.ok(txt.includes('/100'));
  assert.ok(!txt.includes('undefined'));
});

/* --------------------------------------------------------- 数据完整性 */

test('导出/导入往返一致', () => {
  const s = seedState(T);
  const text = exportBundle(s);
  const back = importBundle(text);
  assert.equal(back.buses.length, s.buses.length);
  assert.equal(back.trips.length, s.trips.length);
  assert.deepEqual(back.org, s.org);
  assert.throws(() => importBundle('{"foo":1}'), /备份文件/);
});

test('示例种子自洽：守恒成立、趟次状态合法、体检确定', () => {
  const s = seedState(T);
  assert.equal(tripConservation(s).ok, true);
  const legal = ['checking', 'ready', 'boarded', 'closed', 'cancelled'];
  for (const t of s.trips) assert.ok(legal.includes(t.status), t.status);
  assert.ok(healthCheck(s, T).score >= 0);
  // ready+异常的趟次，隐患在册且发车被拒
  const blocked = s.trips.find((t) => t.status === 'ready' && t.check?.abnormal);
  assert.ok(blocked);
  assert.throws(() => board(s, blocked.id, { onCount: 5, onConfirmed: true }), /带病|隐患/);
});

test('todayISO 输出可回灌', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});
