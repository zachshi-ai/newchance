/**
 * tests/core.test.mjs — 车轮账 TruckLog 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addMonths, daysUntil, monthKey, fmtYuan, escapeHtml,
  CERT_KINDS, RECORD_TYPES, ALERT_TYPES, INSPECTION_AGE_MONTHS, DRIVER_CERT_YEARS,
  vehicleAgeMonths, inspectionCycleMonths, suggestExpiry,
  certState, certBoard, driverState,
  addRecord, removeRecord, vehicleLedger, vehicleCost, lastOdometer,
  addAlert, handleAlert, openAlerts, monthlyDynSummary,
  inspectHtml, archiveHtml, STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-06'; // 测试锚定日期（周日），不依赖墙钟

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-6'));
  assert.throws(() => assertISO('20260906'));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
});

test('addDays 跨月/跨年收敛', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('addMonths 月末钳制与跨年：1/31 +1 月 = 2/28，5/31 +1 月 = 6/30', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-05-31', 1), '2026-06-30');
  assert.equal(addMonths('2026-09-06', -9), '2025-12-06');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonths('2026-12-15', 3), '2027-03-15');
});

test('daysUntil 与 monthKey 跨年正确', () => {
  assert.equal(daysUntil('2026-12-31', T), 116);
  assert.equal(daysUntil('2026-09-06', T), 0);
  assert.equal(daysUntil('2026-09-05', T), -1);
  assert.equal(monthKey('2026-09-06'), '2026-09');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('fmtYuan 只吃整数分；escapeHtml 全转义', () => {
  assert.equal(fmtYuan(129000), '¥1290.00');
  assert.equal(fmtYuan(305), '¥3.05');
  assert.throws(() => fmtYuan(12.5));
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

test('口径常量基线：四证钟、档案六型、报警四型', () => {
  assert.deepEqual(Object.keys(CERT_KINDS), ['review', 'inspection', 'compulsory', 'commercial']);
  assert.deepEqual(Object.keys(RECORD_TYPES), ['maintain', 'repair', 'part', 'inspect', 'accident', 'other']);
  assert.deepEqual(Object.keys(ALERT_TYPES), ['fatigue', 'speed', 'offline', 'other']);
  assert.equal(INSPECTION_AGE_MONTHS, 120);
  assert.equal(DRIVER_CERT_YEARS, 6);
});

// ---------------------------------------------------------------------------
// 车龄与检验检测周期（2023 年第 3 号令第 21 条）
// ---------------------------------------------------------------------------

const V = (over = {}) => ({
  id: 'v1', plate: '冀A·12345', model: '仓栅式货车', regDateISO: '2018-03-10',
  transportCertNo: '冀交运货1300001', note: '', ...over,
});

test('vehicleAgeMonths：整月计龄，未到登记日同日不进一月', () => {
  assert.equal(vehicleAgeMonths(V(), '2026-03-10'), 96);
  assert.equal(vehicleAgeMonths(V(), '2026-03-09'), 95);
  assert.equal(vehicleAgeMonths(V(), '2018-03-10'), 0);
  assert.equal(vehicleAgeMonths(V({ regDateISO: '2026-09-06' }), T), 0);
});

test('inspectionCycleMonths：注册满 120 个月后由 12 个月缩为 6 个月', () => {
  assert.equal(inspectionCycleMonths(V({ regDateISO: '2016-09-07' }), T), 12); // 119 个月
  assert.equal(inspectionCycleMonths(V({ regDateISO: '2016-09-06' }), T), 6);  // 恰 120 个月
  assert.equal(inspectionCycleMonths(V({ regDateISO: '2024-09-06' }), T), 12);
});

test('suggestExpiry：检验检测按车龄选周期，年审/保险 12 个月，月末日钳制', () => {
  const old = V({ regDateISO: '2016-09-06' }); // 满 120 个月 → 6 个月周期
  const young = V();
  assert.equal(suggestExpiry(old, 'inspection', T), '2027-03-06');
  assert.equal(suggestExpiry(young, 'inspection', T), '2027-09-06');
  assert.equal(suggestExpiry(young, 'review', T), '2027-09-06');
  assert.equal(suggestExpiry(young, 'compulsory', '2026-01-31'), '2027-01-31');
  assert.equal(suggestExpiry(young, 'compulsory', '2026-05-31'), '2027-05-31');
});

// ---------------------------------------------------------------------------
// 证照钟与看板
// ---------------------------------------------------------------------------

function baseState() {
  return {
    version: 1,
    fleet: { name: '小满货运部', phone: '' },
    vehicles: [V(), V({ id: 'v2', plate: '冀A·67890', regDateISO: '2016-09-06' })],
    drivers: [],
    certs: [],
    records: [],
    alerts: [],
    settings: { warnDays: 60, alertDays: 7 },
    recordSeq: 0,
    alertSeq: 0,
    events: [],
  };
}

test('certState：到期日当天仍是黄灯，次日即逾期；预警窗边界', () => {
  const mk = (days) => ({ expiryISO: addDays(T, days) });
  assert.equal(certState(mk(0), T, 60).level, 'due');
  assert.equal(certState(mk(-1), T, 60).level, 'overdue');
  assert.equal(certState(mk(-60), T, 60).level, 'overdue');
  assert.equal(certState(mk(-61), T, 60).level, 'overdue');
  assert.equal(certState(mk(60), T, 60).level, 'due');
  assert.equal(certState(mk(61), T, 60).level, 'ok');
  assert.equal(certState(mk(60), T, 60).daysLeft, 60);
});

test('certBoard：红灯在前、其余按剩余天数升序，附车牌与类型', () => {
  const s = baseState();
  s.certs = [
    { id: 'c1', vehicleId: 'v1', kind: 'review', expiryISO: addDays(T, 100) },
    { id: 'c2', vehicleId: 'v1', kind: 'compulsory', expiryISO: addDays(T, -10) },
    { id: 'c3', vehicleId: 'v2', kind: 'inspection', expiryISO: addDays(T, 30) },
    { id: 'c4', vehicleId: 'v2', kind: 'commercial', expiryISO: addDays(T, 29) },
  ];
  const board = certBoard(s, T, 60);
  assert.deepEqual(board.map((r) => r.certId), ['c2', 'c4', 'c3', 'c1']);
  assert.equal(board[0].level, 'overdue');
  assert.equal(board[0].plate, '冀A·12345');
  assert.equal(board[1].kindLabel, '商业险');
  // 悬空证照（车辆已删）不进看板
  s.certs.push({ id: 'cx', vehicleId: 'ghost', kind: 'review', expiryISO: addDays(T, -99) });
  assert.equal(certBoard(s, T, 60).length, 4);
});

// ---------------------------------------------------------------------------
// 驾驶员台账（从业资格 6 年钟 + 诚信考核周年）
// ---------------------------------------------------------------------------

test('driverState：资格证倒计时、超 180 日失效点名、诚信考核周年到期', () => {
  const d = { id: 'd1', name: '张师傅', certExpiryISO: addDays(T, -181), assessISO: '2025-09-01' };
  const st = driverState(d, T, 60);
  assert.equal(st.certLevel, 'overdue');
  assert.match(st.certExpired, /180 日/);
  assert.equal(st.assessDueISO, '2026-09-01');
  assert.equal(st.assessDaysLeft, -5);
  const ok = driverState({ certExpiryISO: addDays(T, 300), assessISO: '2025-10-01' }, T, 60);
  assert.equal(ok.certLevel, 'ok');
  assert.equal(ok.assessDueISO, '2026-10-01'); // 周年 25 天后 → 黄灯
  assert.equal(ok.assessLevel, 'due');
  const bare = driverState({ name: '李师傅' }, T, 60);
  assert.equal(bare.certLevel, undefined);
  assert.equal(bare.assessDueISO, undefined);
});

// ---------------------------------------------------------------------------
// 技术档案（一车一档）
// ---------------------------------------------------------------------------

test('addRecord：写入流水、类型/费用/里程校验、引用校验', () => {
  const s = baseState();
  const r1 = addRecord(s, { vehicleId: 'v1', dateISO: T, odometer: 235600, type: 'maintain', title: '二级维护', costCents: 128000 });
  assert.equal(s.records.length, 1);
  assert.equal(r1.id, 'r-1');
  assert.throws(() => addRecord(s, { vehicleId: 'v1', dateISO: T, type: 'unknown' }), /非法档案类型/);
  assert.throws(() => addRecord(s, { vehicleId: 'v1', dateISO: T, costCents: -5 }), /非负整数分/);
  assert.throws(() => addRecord(s, { vehicleId: 'v1', dateISO: T, costCents: 10.5 }), /整数分/);
  assert.throws(() => addRecord(s, { vehicleId: 'v1', dateISO: T, odometer: -1 }), /里程/);
  assert.throws(() => addRecord(s, { vehicleId: 'ghost', dateISO: T }), /车辆不存在/);
  assert.throws(() => addRecord(s, { vehicleId: 'v1', dateISO: '2026/09/06' }), /非法日期/);
});

test('vehicleLedger：同车倒序、异车隔离；removeRecord 删除与幽灵拒绝', () => {
  const s = baseState();
  addRecord(s, { vehicleId: 'v1', dateISO: '2026-01-05', type: 'repair', title: '换离合器片' });
  addRecord(s, { vehicleId: 'v1', dateISO: '2026-08-20', type: 'maintain', title: '二级维护' });
  addRecord(s, { vehicleId: 'v2', dateISO: '2026-07-01', type: 'inspect', title: '综检+技术等级' });
  const l1 = vehicleLedger(s, 'v1');
  assert.deepEqual(l1.map((r) => r.dateISO), ['2026-08-20', '2026-01-05']);
  assert.equal(vehicleLedger(s, 'v2').length, 1);
  removeRecord(s, l1[0].id);
  assert.equal(vehicleLedger(s, 'v1').length, 1);
  assert.throws(() => removeRecord(s, 'ghost'), /不存在/);
});

test('vehicleCost：按年分桶，Σ年份 == 总额（恒等式）；lastOdometer 取最新读数', () => {
  const s = baseState();
  addRecord(s, { vehicleId: 'v1', dateISO: '2025-11-01', costCents: 50000, odometer: 230000 });
  addRecord(s, { vehicleId: 'v1', dateISO: '2026-03-01', costCents: 128000, odometer: 235600 });
  addRecord(s, { vehicleId: 'v1', dateISO: '2026-08-01', costCents: 32000 }); // 无里程
  addRecord(s, { vehicleId: 'v2', dateISO: '2026-05-01', costCents: 40000 });
  assert.equal(vehicleCost(s, 'v1', '2025'), 50000);
  assert.equal(vehicleCost(s, 'v1', '2026'), 160000);
  assert.equal(vehicleCost(s, 'v1'), 210000);
  assert.equal(vehicleCost(s, 'v1', '2025') + vehicleCost(s, 'v1', '2026'), vehicleCost(s, 'v1'));
  assert.equal(vehicleCost(s, 'v2'), 40000);
  assert.equal(lastOdometer(s, 'v1'), 235600);
  assert.equal(lastOdometer(s, 'v2'), null);
  assert.throws(() => vehicleCost(s, 'v1', '2026-01'), /非法年份/);
});

// ---------------------------------------------------------------------------
// 动态监控台账（报警 → 闭环）
// ---------------------------------------------------------------------------

test('addAlert：类型与引用校验；handleAlert 闭环校验（重复拒绝、日期回溯拒绝）', () => {
  const s = baseState();
  s.drivers = [{ id: 'd1', name: '张师傅' }];
  const a = addAlert(s, { vehicleId: 'v1', driverId: 'd1', dateISO: '2026-09-01', type: 'fatigue', detail: '连续驾驶 4.5 小时' });
  assert.equal(s.alerts.length, 1);
  assert.throws(() => addAlert(s, { vehicleId: 'ghost', dateISO: T }), /车辆不存在/);
  assert.throws(() => addAlert(s, { vehicleId: 'v1', dateISO: T, type: 'crash' }), /非法报警类型/);
  assert.throws(() => addAlert(s, { vehicleId: 'v1', driverId: 'ghost', dateISO: T }), /驾驶员不存在/);
  handleAlert(s, a.id, { handledISO: '2026-09-02', action: '电话提醒并停运半天', handler: '老王' });
  assert.equal(s.alerts[0].handledISO, '2026-09-02');
  assert.throws(() => handleAlert(s, a.id, { handledISO: T }), /已处理闭环/);
  const b = addAlert(s, { vehicleId: 'v1', dateISO: '2026-09-05', type: 'speed' });
  assert.throws(() => handleAlert(s, b.id, { handledISO: '2026-09-04' }), /早于报警日期/);
  assert.throws(() => handleAlert(s, 'ghost', { handledISO: T }), /不存在/);
});

test('openAlerts：只列未处理，最老的在前', () => {
  const s = baseState();
  const a1 = addAlert(s, { vehicleId: 'v1', dateISO: '2026-08-01', type: 'offline' });
  const a2 = addAlert(s, { vehicleId: 'v2', dateISO: '2026-09-01', type: 'fatigue' });
  addAlert(s, { vehicleId: 'v2', dateISO: '2026-08-15', type: 'speed' });
  handleAlert(s, 'a-3', { handledISO: '2026-08-16', action: '已提醒' });
  const open = openAlerts(s);
  assert.deepEqual(open.map((x) => x.id), [a1.id, a2.id]);
  assert.equal(open[0].type, 'offline');
});

test('monthlyDynSummary：分月隔离、处理率、未处理点名、文本确定性', () => {
  const s = baseState();
  s.drivers = [{ id: 'd1', name: '张师傅' }];
  addAlert(s, { vehicleId: 'v1', driverId: 'd1', dateISO: '2026-09-01', type: 'fatigue', detail: '连续驾驶 4.5 小时' });
  addAlert(s, { vehicleId: 'v2', dateISO: '2026-09-03', type: 'speed' });
  addAlert(s, { vehicleId: 'v1', dateISO: '2026-08-20', type: 'offline' });
  handleAlert(s, 'a-2', { handledISO: '2026-09-03', action: '已提醒纠正' });
  const sep = monthlyDynSummary(s, '2026-09');
  assert.equal(sep.total, 2);
  assert.equal(sep.handled, 1);
  assert.equal(sep.unhandled, 1);
  assert.equal(sep.handleRate, 50);
  assert.equal(sep.byType.fatigue, 1);
  assert.equal(sep.byType.speed, 1);
  assert.equal(sep.unhandledList.length, 1);
  assert.equal(sep.unhandledList[0].plate, '冀A·12345');
  assert.match(sep.text, /【动态监控月度小结】2026-09/);
  assert.match(sep.text, /处理率 50%/);
  assert.match(sep.text, /冀A·12345（张师傅） 疲劳驾驶：连续驾驶 4\.5 小时/);
  assert.match(sep.text, /至少保存 3 年/);
  const aug = monthlyDynSummary(s, '2026-08');
  assert.equal(aug.total, 1);
  assert.equal(aug.unhandled, 1);
  assert.equal(monthlyDynSummary(s, '2026-09').text, sep.text); // 同输入同输出
  assert.throws(() => monthlyDynSummary(s, '2026-9'), /非法月份/);
});

// ---------------------------------------------------------------------------
// 迎检一页纸（单文件 HTML）
// ---------------------------------------------------------------------------

test('inspectHtml：单文件离线可用（无外部资源），含四段与签字栏', () => {
  const s = baseState();
  s.drivers = [{ id: 'd1', name: '张师傅', certExpiryISO: addDays(T, 40), assessISO: '2025-10-01' }];
  s.certs = [
    { id: 'c1', vehicleId: 'v1', kind: 'compulsory', expiryISO: addDays(T, -10) },
    { id: 'c2', vehicleId: 'v2', kind: 'review', expiryISO: addDays(T, 30) },
  ];
  addRecord(s, { vehicleId: 'v1', dateISO: '2026-08-01', odometer: 235600, type: 'maintain', title: '二级维护', costCents: 128000 });
  addAlert(s, { vehicleId: 'v1', driverId: 'd1', dateISO: '2026-09-01', type: 'fatigue' });
  const html = inspectHtml(s, T, 60);
  assert.ok(!/src=["']http/.test(html));
  assert.ok(!/href=["']http/.test(html));
  assert.match(html, /证照时钟/);
  assert.match(html, /一车一档速览/);
  assert.match(html, /动态监控台账/);
  assert.match(html, /驾驶员台账/);
  assert.match(html, /安全管理员（签字）/);
  assert.match(html, /逾期 10 天/);
  assert.match(html, /冀A·12345/);
  assert.match(html, /¥1280\.00/);
});

test('inspectHtml：车牌与明细中的 HTML 被转义（XSS 防护）', () => {
  const s = baseState();
  s.vehicles = [V({ plate: '冀A·<script>', model: '<<"onclick">' })];
  s.certs = [{ id: 'c1', vehicleId: 'v1', kind: 'review', expiryISO: addDays(T, 1) }];
  const html = inspectHtml(s, T, 60);
  assert.ok(!html.includes('冀A·<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  const text = monthlyDynSummary((() => { const x = baseState(); x.vehicles = s.vehicles; addAlert(x, { vehicleId: 'v1', dateISO: '2026-09-01', type: 'speed' }); return x; })(), '2026-09').text;
  assert.match(text, /冀A·<script>/); // 纯文本通道不转义，交由渲染端处理
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = baseState();
  s.certs.push({ id: 'c1', vehicleId: 'v1', kind: 'review', expiryISO: addDays(T, 100) });
  addRecord(s, { vehicleId: 'v1', dateISO: T, costCents: 128000 });
  addAlert(s, { vehicleId: 'v1', dateISO: T, type: 'speed' });
  const round = importBundle(exportBundle(s));
  assert.ok(round.ok);
  assert.deepEqual(round.state.certs, s.certs);
  assert.deepEqual(round.state.records, s.records);
  assert.deepEqual(round.state.alerts, s.alerts);
  assert.equal(round.state.fleet.name, '小满货运部');
});

test('importBundle：非 JSON / 错误应用 / 坏结构 / 高版本一律整体拒绝', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.match(importBundle('not json').error, /JSON/);
  const bad = importBundle(JSON.stringify({ app: 'garageledger', version: 1, state: {} }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是车轮账/);
  const incomplete = importBundle(JSON.stringify({
    app: 'trucklog', version: STATE_VERSION,
    state: { fleet: {}, vehicles: [], drivers: [], certs: [], records: 'nope', alerts: [], settings: {} },
  }));
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /结构不完整/);
  const future = importBundle(JSON.stringify({
    app: 'trucklog', version: STATE_VERSION + 1,
    state: { fleet: {}, vehicles: [], drivers: [], certs: [], records: [], alerts: [], settings: {} },
  }));
  assert.equal(future.ok, false);
  assert.match(future.error, /高于当前支持版本/);
});

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

test('todayISO 返回 ISO 字符串', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addMonths 负数月与 0 月：往返一致、原样返回', () => {
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2026-03-31', -13), '2025-02-28');
  assert.equal(addMonths('2026-09-06', 0), '2026-09-06');
});

test('vehicleAgeMonths：登记日在未来不产生负车龄', () => {
  assert.equal(vehicleAgeMonths(V({ regDateISO: '2027-01-01' }), T), 0);
});

test('suggestExpiry：拒绝非法日期输入', () => {
  assert.throws(() => suggestExpiry(V(), 'review', '2026-9-6'), /非法日期/);
});

test('certState：自定义预警窗生效（warnDays=30）', () => {
  const cert = { expiryISO: addDays(T, 45) };
  assert.equal(certState(cert, T, 60).level, 'due');
  assert.equal(certState(cert, T, 30).level, 'ok');
});

test('certBoard：空车队/空证照返回空数组，不抛错', () => {
  const s = baseState();
  s.certs = [];
  assert.deepEqual(certBoard(s, T, 60), []);
  assert.deepEqual(certBoard(baseState(), T, 60), []);
});

test('driverState：warnDays=0 时只有逾期才亮灯', () => {
  const d = { certExpiryISO: addDays(T, 5) };
  assert.equal(driverState(d, T, 0).certLevel, 'ok');
  const d2 = { certExpiryISO: addDays(T, -1) };
  assert.equal(driverState(d2, T, 0).certLevel, 'overdue');
});

test('addRecord：零费用与空标题允许（自修/未发生费用），id 自增', () => {
  const s = baseState();
  const a = addRecord(s, { vehicleId: 'v1', dateISO: T, costCents: 0, title: '' });
  const b = addRecord(s, { vehicleId: 'v1', dateISO: T, costCents: 1 });
  assert.equal(a.costCents, 0);
  assert.equal(b.id, 'r-2');
});

test('removeRecord 后费用与流水同步归零（账实一致）', () => {
  const s = baseState();
  const r = addRecord(s, { vehicleId: 'v1', dateISO: T, costCents: 99000 });
  assert.equal(vehicleCost(s, 'v1'), 99000);
  removeRecord(s, r.id);
  assert.equal(vehicleCost(s, 'v1'), 0);
  assert.deepEqual(vehicleLedger(s, 'v1'), []);
});

test('monthlyDynSummary：空月份给出 0/0、处理率 null、不抛错', () => {
  const s = baseState();
  const m = monthlyDynSummary(s, '2026-09');
  assert.equal(m.total, 0);
  assert.equal(m.handleRate, null);
  assert.equal(m.unhandledList.length, 0);
  assert.match(m.text, /报警合计 0 起/);
});

test('monthlyDynSummary：无驾驶员的报警点名不带括号', () => {
  const s = baseState();
  addAlert(s, { vehicleId: 'v1', dateISO: '2026-09-02', type: 'offline' });
  const m = monthlyDynSummary(s, '2026-09');
  assert.match(m.text, /2026-09-02 冀A·12345 终端离线/);
});

test('inspectHtml：空车队渲染空表不崩溃', () => {
  const s = baseState();
  s.vehicles = [];
  s.certs = [];
  const html = inspectHtml(s, T, 60);
  assert.match(html, /共 0 辆营运车/);
  assert.ok(!/src=["']http/.test(html));
});

test('archiveHtml：一车一档打印版，含车辆信息、证照有效期与流水表', () => {
  const s = baseState();
  s.certs = [{ id: 'c1', vehicleId: 'v1', kind: 'review', expiryISO: addDays(T, 100) }];
  addRecord(s, { vehicleId: 'v1', dateISO: '2026-08-01', odometer: 235600, type: 'maintain', title: '二级维护', costCents: 128000, vendor: '宏发修理厂' });
  const html = archiveHtml(s, 'v1', T);
  assert.ok(!/src=["']http/.test(html));
  assert.match(html, /车辆技术档案（一车一档）· 冀A·12345/);
  assert.match(html, /冀交运货1300001/);
  assert.match(html, /二级维护/);
  assert.match(html, /宏发修理厂/);
  assert.match(html, /车队长（签字）/);
  assert.match(html, /235600 km/);
  assert.throws(() => archiveHtml(s, 'ghost', T), /车辆不存在/);
});

test('exportBundle：同状态同输出（确定性），含 app 标识与版本', () => {
  const s = baseState();
  const s2 = JSON.parse(JSON.stringify(s));
  assert.equal(exportBundle(s), exportBundle(s2));
  const bundle = JSON.parse(exportBundle(s));
  assert.equal(bundle.app, 'trucklog');
  assert.equal(bundle.version, STATE_VERSION);
});

test('importBundle：合法最小结构接受并保留事件流', () => {
  const s = baseState();
  s.events.push({ type: 'seed-demo', at: '2026-09-06T00:00:00.000Z' });
  const round = importBundle(exportBundle(s));
  assert.ok(round.ok);
  assert.equal(round.state.events.length, 1);
  assert.equal(round.state.events[0].type, 'seed-demo');
});
