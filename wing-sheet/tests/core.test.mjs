/**
 * core.test.mjs — 适飞单 WingSheet 域逻辑单元测试
 * 口径锚点：《无人驾驶航空器飞行管理暂行条例》（761号令）+ CCAR-92（交通运输部令2024年第1号）
 * ——条号出处见 docs/14
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays, addMonthsISO, daysUntil, monthKey, todayISO, escapeHtml,
  DEFAULT_SETTINGS, PREFLIGHT_ITEMS, CATEGORY_META,
  classifyUas, agriOps, obligations,
  certLevel, uasClocks, uasNeedsInsurance, uasClockReds, pilotClocks, pilotReadyFor,
  addUas, addPilot, retireUas,
  permitWindows, createPermit, submitApplication, decidePermit, recordPreDeparture, cancelPermit, permitRequired,
  startFlight, preflight, takeoff, closeFlight, reportIncident, incidentDue, cancelFlight, staleFlights,
  openIssue, closeIssue, openIssues,
  setDutyDone, dutyState, dutyBoard, DUTY_KINDS,
  healthCheck, monthlySummary,
  flightCardHtml, inspectHtml, monthlyText,
  emptyState, exportBundle, importBundle, seedState,
} from '../app/js/core.js';

const T = '2026-09-07'; // 固定"今天"，测试全部确定性

function fresh() {
  const s = emptyState();
  s.settings = { ...DEFAULT_SETTINGS };
  return s;
}

/** 建一套最小可用机队与人员并返回 id（轻型机 + 有证照保险） */
function rig(s) {
  const org = { name: '测试航拍', orgMode: 'unit', opCertNumber: '运合-001' };
  s.org = { ...s.org, ...org };
  const { uas } = addUas(s, {
    nickname: '测试机-轻', emptyKg: 0.9, mtowKg: 2.0, commercialUse: true,
    regNo: 'UAS00000001', registeredISO: '2026-01-01', markAffixed: true,
    insuranceExpiryISO: '2027-01-01',
  });
  const pilot = addPilot(s, { name: '小飞', licenseIssueISO: '2024-01-01', lastProfCheckISO: T });
  return { uas, pilot };
}

function allOk() {
  return Object.fromEntries(PREFLIGHT_ITEMS.map((i) => [i.key, true]));
}

/* --------------------------------------------------------- 时间与口径 */

test('addMonthsISO 月末钳制与基础时间工具', () => {
  assert.equal(addMonthsISO('2024-08-31', 6), '2025-02-28');
  assert.equal(addMonthsISO('2022-10-28', 72), '2028-10-28'); // 执照 6 年
  assert.equal(addMonthsISO('2026-03-15', 24), '2028-03-15'); // 定期检查 24 个日历月
  assert.equal(addDays('2026-09-07', -1), '2026-09-06');
  assert.equal(daysUntil('2026-09-22', T), 15);
  assert.equal(monthKey('2026-09-07'), '2026-09');
});

test('certLevel 三段边界：60 天黄线 / 15 天红线 / 负数过期', () => {
  assert.equal(certLevel(61), 'ok');
  assert.equal(certLevel(60), 'warn');
  assert.equal(certLevel(15), 'red');
  assert.equal(certLevel(0), 'red');
  assert.equal(certLevel(-1), 'expired');
});

test('escapeHtml 转义', () => {
  assert.equal(escapeHtml('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});

/* --------------------------------------------------------- 判档引擎（第62条） */

test('判档器：五类边界（微<250克 / 轻空机4起飞7 / 小空机15起飞25 / 中150 / 大>150）', () => {
  const c = (emptyKg, mtowKg, extra = {}) => classifyUas({ emptyKg, mtowKg, ...extra }).category;
  assert.equal(c(0.19, 0.24), 'micro');
  assert.equal(c(0.25, 0.9), 'light');           // 0.25 千克恰在界上：空机<0.25 才是微型
  assert.equal(c(4, 7), 'light');
  assert.equal(c(4.1, 7), 'small');              // 空机超 4 千克：即便起飞 7 千克也不是轻型
  assert.equal(c(5, 8), 'small');
  assert.equal(c(10, 25), 'small');
  assert.equal(c(16, 25.1), 'medium');
  assert.equal(c(30, 150), 'medium');
  assert.equal(c(60, 150.1), 'large');
});

test('判档器：非法参数拒绝（负数/起飞<空机/缺参）', () => {
  assert.throws(() => classifyUas({ emptyKg: -1, mtowKg: 2 }), /正数/);
  assert.throws(() => classifyUas({ emptyKg: 3, mtowKg: 2 }), /不能小于空机/);
  assert.throws(() => classifyUas({ emptyKg: '', mtowKg: 2 }), /正数/);
  assert.throws(() => classifyUas({ emptyKg: 1, mtowKg: 'abc' }), /正数/);
});

test('农用作业包线（第62条(八)+第11条3款）：达标豁免 / 超限拒绝', () => {
  const ok = classifyUas({ emptyKg: 22, mtowKg: 46, agri: true, agriTrueHeightM: 20, agriSpeedKmh: 40, agriRadiusM: 1500 });
  assert.equal(ok.category, 'medium');
  assert.equal(ok.agriOk, true);
  assert.equal(agriOps({ agri: true, mtowKg: 46, agriTrueHeightM: 20, agriSpeedKmh: 40, agriRadiusM: 1500 }), true);
  // 超出包线任一维：真高>30
  assert.throws(() => classifyUas({ emptyKg: 22, mtowKg: 46, agri: true, agriTrueHeightM: 35, agriSpeedKmh: 40, agriRadiusM: 1500 }), /农用无人机作业包线/);
  // 半径>2000
  assert.throws(() => classifyUas({ emptyKg: 22, mtowKg: 46, agri: true, agriTrueHeightM: 20, agriSpeedKmh: 40, agriRadiusM: 2500 }), /包线/);
  // >150 千克：第11条3款运营合格证豁免不适用
  assert.throws(() => classifyUas({ emptyKg: 100, mtowKg: 160, agri: true }), /150千克|包线/);
  assert.equal(agriOps({ agri: false, mtowKg: 46 }), false);
});

/* --------------------------------------------------------- 义务矩阵 */

test('义务矩阵：微型个人非经营 = 实名登记为主，无执照/保险/运营合格证', () => {
  const rows = obligations({ category: 'micro', orgMode: 'personal', purpose: 'personal' });
  const keys = rows.filter((r) => r.required).map((r) => r.key);
  assert.deepEqual(keys.sort(), ['registration']);
  assert.ok(!rows.some((r) => r.key === 'remoteId')); // 微型免识别信息报送（第24条）
});

test('义务矩阵：轻型单位经营 = 登记+识别+运营合格证+保险，无执照（第11/12/17条）', () => {
  const rows = obligations({ category: 'light', orgMode: 'unit', purpose: 'commercial' });
  const required = rows.filter((r) => r.required).map((r) => r.key).sort();
  assert.deepEqual(required, ['insurance', 'opCert', 'registration', 'remoteId']);
  assert.ok(rows.some((r) => r.key === 'lightControlled' && !r.required)); // 第17条3款提示
});

test('义务矩阵：小型非经营个人 = 执照+保险（第12/16条）；农用作业=操作证书替执照', () => {
  const rows1 = obligations({ category: 'small', orgMode: 'personal', purpose: 'personal' });
  assert.deepEqual(rows1.filter((r) => r.required).map((r) => r.key).sort(), ['insurance', 'license', 'registration', 'remoteId']);
  const rows2 = obligations({ category: 'medium', agriOps: true, orgMode: 'unit', purpose: 'agri' });
  const keys2 = rows2.filter((r) => r.required).map((r) => r.key).sort();
  assert.deepEqual(keys2, ['agriCert', 'insurance', 'registration', 'remoteId']); // 常规农用豁免运营合格证（第11条3款）
  assert.ok(!keys2.includes('license')); // 农用免操控员执照（第16条2款）
});

/* --------------------------------------------------------- 证照钟 */

test('一机两钟：未登记=过期级；标志未贴=临期级；保险三段；微型无保险钟', () => {
  const s = fresh();
  const { uas: uOk } = addUas(s, {
    nickname: '登记全', emptyKg: 0.9, mtowKg: 2, commercialUse: true, regNo: 'UAS00000009', registeredISO: T, markAffixed: true,
    insuranceExpiryISO: '2026-09-22', // 剩 15 天 → 红
  });
  let clocks = uasClocks(uOk, T, s.settings);
  assert.equal(clocks.find((c) => c.key === 'registration').level, 'ok');
  assert.equal(clocks.find((c) => c.key === 'insurance').level, 'red');
  const { uas: uNoMark } = addUas(s, {
    nickname: '标志未贴', emptyKg: 0.9, mtowKg: 2, regNo: 'UAS00000008', registeredISO: T, markAffixed: false,
    insuranceExpiryISO: '2027-06-01',
  });
  clocks = uasClocks(uNoMark, T, s.settings);
  assert.equal(clocks.find((c) => c.key === 'registration').level, 'warn');
  const { uas: uBare } = addUas(s, { nickname: '裸机', emptyKg: 0.9, mtowKg: 2, commercialUse: true });
  clocks = uasClocks(uBare, T, s.settings);
  assert.equal(clocks.find((c) => c.key === 'registration').level, 'expired');
  assert.equal(clocks.find((c) => c.key === 'insurance').level, 'expired');
  const { uas: uMicro } = addUas(s, { nickname: '口袋机', emptyKg: 0.19, mtowKg: 0.24 });
  clocks = uasClocks(uMicro, T, s.settings);
  assert.ok(!clocks.some((c) => c.key === 'insurance')); // 微型非经营不强制保险
  assert.equal(uasNeedsInsurance(uMicro), false);
  assert.equal(uasNeedsInsurance(uOk), true);            // 经营性 → 保险
});

test('操控员三钟：执照 6 年 / 定期检查 24 个月 / 大型熟练检查 12 个月 / 农用证书过期只拦农用', () => {
  const s = fresh();
  const pLight = addPilot(s, { name: '轻型飞手' }); // 无执照：微/轻型合法
  assert.equal(pilotClocks(pLight, T, s.settings).length, 0);
  assert.ok(pilotReadyFor(pLight, 'commercial', T, s.settings).ok);
  const p = addPilot(s, { name: '持证', licenseIssueISO: '2020-09-06', lastProfCheckISO: '2024-08-01' });
  let clocks = pilotClocks(p, T, s.settings);
  assert.equal(clocks.find((c) => c.key === 'license').level, 'expired'); // 6 年已满
  assert.equal(clocks.find((c) => c.key === 'profCheck').level, 'expired'); // 24 个日历月已过
  assert.ok(!pilotReadyFor(p, 'personal', T, s.settings).ok);
  const pLarge = addPilot(s, { name: '大型飞手', licenseIssueISO: '2025-01-01', lastProfCheckISO: '2025-09-20', ifrLarge: true });
  clocks = pilotClocks(pLarge, T, s.settings);
  assert.equal(clocks.find((c) => c.key === 'profCheck').level, 'red'); // 12 个日历月：2026-09-20 剩 13 天
  const pAgri = addPilot(s, { name: '植保飞手', agriCertISO: '2024-06-01' });
  assert.ok(!pilotReadyFor(pAgri, 'agri', T, s.settings).ok);   // 农用：证书过期拦
  assert.ok(pilotReadyFor(pAgri, 'personal', T, s.settings).ok); // 非农用：证书过期不拦（微/轻型场景）
});

/* --------------------------------------------------------- 申请台账（第26/30条） */

test('permitWindows：申请截止=前1日12:00，批复截止=前1日21:00', () => {
  const w = permitWindows('2026-09-10');
  assert.equal(w.applyByISO, '2026-09-09');
  assert.equal(w.decisionByISO, '2026-09-09');
});

test('申请红线：前1日12时后提交被硬拒（第26条）；状态机 planned→applied→approved/denied', () => {
  const s = fresh();
  const { uas, pilot } = rig(s);
  const m = createPermit(s, { uasId: uas.id, pilotId: pilot.id, flyingDateISO: '2026-09-10', reason: 'controlled', location: '高铁站' });
  assert.equal(m.status, 'planned');
  assert.throws(() => submitApplication(s, m.id, { submittedISO: '2026-09-10' }), /12 时前/); // 已过前1日（09-09）12 时线
  const m2 = createPermit(s, { uasId: uas.id, pilotId: pilot.id, flyingDateISO: '2026-09-12', reason: 'crowd' });
  submitApplication(s, m2.id, { submittedISO: '2026-09-10' });
  assert.equal(m2.status, 'applied');
  assert.throws(() => submitApplication(s, m2.id, { submittedISO: '2026-09-11' }), /待申请/); // 不可重复提交
  decidePermit(s, m2.id, { approved: true, decidedISO: '2026-09-11', permitNo: '批2026-01' });
  assert.equal(m2.status, 'approved');
  recordPreDeparture(s, m2.id, { preDepISO: '2026-09-12' });
  assert.equal(m2.preDepISO, '2026-09-12');
  assert.throws(() => recordPreDeparture(s, m2.id, { preDepISO: '2026-09-12' }), /不可重复/);
  cancelPermit(s, m.id, { note: '改期' });
  assert.equal(m.status, 'cancelled');
});

test('permitRequired 映射：管制空域/五种特殊情形/存量机', () => {
  assert.equal(permitRequired({ airspaceKind: 'controlled' }), 'controlled');
  assert.equal(permitRequired({ airspaceKind: 'suitable', missionFlags: { crowd: true } }), 'crowd');
  assert.equal(permitRequired({ airspaceKind: 'suitable', missionFlags: { swarm: true } }), 'swarm');
  assert.equal(permitRequired({ airspaceKind: 'suitable', uasLegacy: true }), 'legacy');
  assert.equal(permitRequired({ airspaceKind: 'suitable' }), null);
});

/* --------------------------------------------------------- 建架次红线 */

test('建架次红线：未实名登记拒绝（第10/47条，含微型机）', () => {
  const s = fresh();
  s.org = { ...s.org, orgMode: 'personal' };
  const { uas: uMicro } = addUas(s, { nickname: '口袋机', emptyKg: 0.19, mtowKg: 0.24 });
  const pilot = addPilot(s, { name: '小吴' });
  assert.throws(() => startFlight(s, { uasId: uMicro.id, pilotId: pilot.id, dateISO: T, purpose: 'personal' }), /未实名登记/);
});

test('建架次红线：责任保险缺失/过期拒绝（第12/48条）', () => {
  const s = fresh();
  const { uas, pilot } = rig(s);
  uas.insuranceExpiryISO = '2026-09-01'; // 已过期
  assert.throws(() => startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'commercial' }), /责任保险/);
  uas.insuranceExpiryISO = '';
  assert.throws(() => startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'commercial' }), /责任保险/);
});

test('建架次红线：单位飞非微型无运营合格证拒绝（第11/49条）；农用豁免放行', () => {
  const s = fresh();
  const { uas, pilot } = rig(s);
  s.org.opCertNumber = '';
  assert.throws(() => startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'commercial' }), /运营合格证/);
});

test('建架次红线：小型机无执照/定期检查超期拒绝（第16条 · 92.81）', () => {
  const s = fresh();
  s.org = { ...s.org, orgMode: 'personal' };
  const { uas } = addUas(s, {
    nickname: '小巡检', emptyKg: 6.5, mtowKg: 13, regNo: 'UAS00000002', registeredISO: '2026-01-01', markAffixed: true,
    insuranceExpiryISO: '2027-06-01',
  });
  const pNo = addPilot(s, { name: '无照' });
  assert.throws(() => startFlight(s, { uasId: uas.id, pilotId: pNo.id, dateISO: T, purpose: 'personal' }), /操控员执照/);
  const pStale = addPilot(s, { name: '检查超期', licenseIssueISO: '2025-01-01', lastProfCheckISO: '2024-01-01' });
  assert.throws(() => startFlight(s, { uasId: uas.id, pilotId: pStale.id, dateISO: T, purpose: 'personal' }), /定期检查/);
});

test('建架次红线：农用作业无操作证书拒绝；普通机按农用目的拒绝（第16条2款/62条(八)）', () => {
  const s = fresh();
  s.org = { ...s.org, orgMode: 'personal' };
  const { uas } = addUas(s, {
    nickname: '植保机', emptyKg: 22, mtowKg: 46, agri: true, agriTrueHeightM: 20, agriSpeedKmh: 40, agriRadiusM: 1500,
    regNo: 'UAS00000003', registeredISO: '2026-01-01', markAffixed: true, insuranceExpiryISO: '2027-06-01',
  });
  const pNoCert = addPilot(s, { name: '无证' });
  assert.throws(() => startFlight(s, { uasId: uas.id, pilotId: pNoCert.id, dateISO: T, purpose: 'agri' }), /操作证书/);
  const pCert = addPilot(s, { name: '有证', agriCertISO: '2025-06-01' });
  const { uas: uPlain } = addUas(s, {
    nickname: '航拍机', emptyKg: 0.9, mtowKg: 2, regNo: 'UAS00000004', registeredISO: '2026-01-01', markAffixed: true,
    insuranceExpiryISO: '2027-06-01',
  });
  assert.throws(() => startFlight(s, { uasId: uPlain.id, pilotId: pCert.id, dateISO: T, purpose: 'agri' }), /作业包线/);
  // 农用机免申请直接飞（第31条(二)）
  const f = startFlight(s, { uasId: uas.id, pilotId: pCert.id, dateISO: T, purpose: 'agri' });
  assert.equal(f.needReason, null);
});

test('建架次红线：管制空域无批复拒绝；批复日期不可挪用；存量机一律要批复（第19/26/61条）', () => {
  const s = fresh();
  const { uas, pilot } = rig(s);
  assert.throws(() => startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'commercial', airspaceKind: 'controlled' }), /事先批准|先到/);
  const { uas: uLegacy } = addUas(s, {
    nickname: '存量老机', emptyKg: 0.9, mtowKg: 2, legacyNoRemoteId: true,
    regNo: 'UAS00000005', registeredISO: '2026-01-01', markAffixed: true, insuranceExpiryISO: '2027-06-01',
  });
  assert.throws(() => startFlight(s, { uasId: uLegacy.id, pilotId: pilot.id, dateISO: T, purpose: 'personal' }), /存量机|批准|先到/);
  // 已批准但日期不符
  const m = createPermit(s, { uasId: uas.id, pilotId: pilot.id, flyingDateISO: '2026-09-08', reason: 'controlled' });
  submitApplication(s, m.id, { submittedISO: '2026-09-05' });
  decidePermit(s, m.id, { approved: true, decidedISO: '2026-09-06', permitNo: '批01' });
  assert.throws(() => startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'commercial', airspaceKind: 'controlled', permitId: m.id }), /不一致|挪用/);
});

/* --------------------------------------------------------- 航前检查 → 起飞 → 闭环 */

test('航前检查：逐项确认；微型免识别信息项；异常必须先建检修单', () => {
  const s = fresh();
  const { uas, pilot } = rig(s);
  const f = startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'commercial' });
  assert.throws(() => preflight(s, f.id, { items: { fence: true } }), /逐项/);
  const items = { ...allOk(), battery: false };
  assert.throws(() => preflight(s, f.id, { items }), /检修单|处置措施/);
  openIssue(s, { uasId: uas.id, flightId: f.id, dateISO: T, item: '电池鼓包', measure: '换电复查' });
  preflight(s, f.id, { items, note: '电池鼓包', dateISO: T });
  assert.equal(f.status, 'cleared');
  assert.equal(f.preflight.abnormal, true);
});

test('微型机航前检查：识别信息项自动豁免', () => {
  const s = fresh();
  s.org = { ...s.org, orgMode: 'personal' };
  const { uas } = addUas(s, { nickname: '口袋机', emptyKg: 0.19, mtowKg: 0.24, regNo: 'UAS00000006', registeredISO: '2026-06-01', markAffixed: true });
  const pilot = addPilot(s, { name: '小吴' });
  const f = startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'personal' });
  const items = Object.fromEntries(PREFLIGHT_ITEMS.filter((i) => i.key !== 'remoteId').map((i) => [i.key, true]));
  preflight(s, f.id, { items, dateISO: T }); // 未给 remoteId 也不抛
  assert.equal(f.status, 'cleared');
  assert.equal(f.preflight.items.remoteId, true);
});

test('起飞门禁：检修未闭环拒绝；需批复的架次无起飞前报告拒绝（第30条）', () => {
  const s = fresh();
  const { uas, pilot } = rig(s);
  const f1 = startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'commercial' });
  openIssue(s, { uasId: uas.id, flightId: f1.id, dateISO: T, item: '桨叶裂纹', measure: '换桨' });
  preflight(s, f1.id, { items: { ...allOk(), frame: false }, dateISO: T });
  assert.throws(() => takeoff(s, f1.id, { dateISO: T }), /带病机|检修/); // 带病机不开飞
  const h = openIssues(s, uas.id)[0];
  closeIssue(s, h.id, { closedISO: T, closeNote: '换桨复查正常' });
  takeoff(s, f1.id, { dateISO: T });
  assert.equal(f1.status, 'flying');
  // 需批复的架次：起飞前报告缺失
  const m = createPermit(s, { uasId: uas.id, pilotId: pilot.id, flyingDateISO: '2026-09-08', reason: 'controlled' });
  submitApplication(s, m.id, { submittedISO: '2026-09-05' });
  decidePermit(s, m.id, { approved: true, decidedISO: '2026-09-06' });
  const f2 = startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: '2026-09-08', purpose: 'commercial', airspaceKind: 'controlled', permitId: m.id });
  preflight(s, f2.id, { items: allOk(), dateISO: '2026-09-08' });
  assert.throws(() => takeoff(s, f2.id, { dateISO: '2026-09-08' }), /起飞前 1 小时/);
  recordPreDeparture(s, m.id, { preDepISO: '2026-09-08' });
  takeoff(s, f2.id, { dateISO: '2026-09-08' });
  assert.equal(f2.status, 'flying');
});

test('闭环：状态门禁；经营性记收入；安全问题必须写明；已闭环不可取消（底账严肃性）', () => {
  const s = fresh();
  const { uas, pilot } = rig(s);
  const f = startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'commercial' });
  preflight(s, f.id, { items: allOk(), dateISO: T });
  assert.throws(() => closeFlight(s, f.id, { landingISO: T }), /在飞/); // 未起飞不能闭环
  takeoff(s, f.id, { dateISO: T });
  assert.throws(() => closeFlight(s, f.id, { landingISO: T, safetyIssue: true }), /安全问题必须写明/);
  assert.throws(() => closeFlight(s, f.id, { landingISO: T, income: -5 }), /非负数/);
  closeFlight(s, f.id, { landingISO: T, durationMin: 30, income: 500 });
  assert.equal(f.status, 'closed');
  assert.equal(f.income, 500);
  assert.throws(() => cancelFlight(s, f.id), /不可修改或取消/);
  assert.throws(() => closeFlight(s, f.id, { landingISO: T }), /在飞/);
});

test('安全问题 24 小时报告钟（第40条）：截止=降落日+1；报告后清零', () => {
  const s = fresh();
  const { uas, pilot } = rig(s);
  const f = startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'commercial' });
  preflight(s, f.id, { items: allOk(), dateISO: T });
  takeoff(s, f.id, { dateISO: T });
  closeFlight(s, f.id, { landingISO: '2026-09-07', safetyIssue: true, incidentNote: '失控返航' });
  assert.equal(incidentDue(f), '2026-09-08');
  reportIncident(s, f.id, { reportedISO: '2026-09-08' });
  assert.equal(incidentDue(f), null);
  assert.throws(() => reportIncident(s, f.id, { reportedISO: '2026-09-09' }), /不可重复/);
});

test('过日未闭环架次被点名（staleFlights）', () => {
  const s = fresh();
  const { uas, pilot } = rig(s);
  const f1 = startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: '2026-08-29', purpose: 'commercial' });
  preflight(s, f1.id, { items: allOk(), dateISO: '2026-08-29' });
  const f2 = startFlight(s, { uasId: uas.id, pilotId: pilot.id, dateISO: T, purpose: 'personal' });
  const stale = staleFlights(s, T);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].id, f1.id);
  cancelFlight(s, f2.id, { note: '天气' });
  assert.equal(f2.status, 'cancelled');
});

/* --------------------------------------------------------- 检修单与义务 */

test('检修单：处置措施必填、不可重复销案；在册检修单存在时机队门禁生效', () => {
  const s = fresh();
  assert.throws(() => openIssue(s, { uasId: 'u1', dateISO: T, item: 'x', measure: '' }), /处置措施/);
  const h = openIssue(s, { uasId: 'u1', dateISO: T, item: '电机异响', measure: '送修' });
  assert.equal(openIssues(s).length, 1);
  closeIssue(s, h.id, { closedISO: T });
  assert.throws(() => closeIssue(s, h.id, { closedISO: T }), /重复销案/);
});

test('义务账：从未登记=逾期；完成后按周期滚动；农用复训按月转天', () => {
  const s = fresh();
  let d = dutyState({ kind: 'annualReport', lastDoneISO: '' }, T, s.settings);
  assert.equal(d.level, 'expired');
  setDutyDone(s, 'annualReport', '2025-08-01');
  d = dutyState(s.duties[0], T, s.settings);
  assert.equal(d.dueISO, '2026-08-01');
  assert.equal(d.level, 'expired');
  const s2 = fresh();
  setDutyDone(s2, 'agriRecert', T);
  const d2 = dutyState(s2.duties[0], T, s2.settings);
  assert.equal(d2.dueISO, addDays(T, 24 * 30));
  assert.throws(() => setDutyDone(s2, 'nope', T), /未知义务/);
  assert.equal(dutyBoard(s2, T).length, 5);
});

/* --------------------------------------------------------- 体检与月报 */

test('体检：干净状态 100 分；种子坏状态确定性扣分且 <90', () => {
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
  assert.ok(keys.includes('permit'));
});

test('月度小结：闭环/取消分列、收入与安全分列、未闭环架次点名', () => {
  const s = seedState(T);
  const m = monthlySummary(s, T.slice(0, 7), T);
  assert.equal(m.closed, 3);
  assert.equal(m.income, 800);
  assert.equal(m.safetyIssues, 1);
  assert.equal(m.incidentsReported, 1);
  assert.ok(m.staleFlights.length >= 1);
  const txt = monthlyText(s, T.slice(0, 7));
  assert.ok(txt.includes('未闭环'));
  assert.ok(txt.includes('/100'));
  assert.ok(!txt.includes('undefined'));
});

/* --------------------------------------------------------- 出证三通道 */

test('飞行记录卡：含检查/批复/签字栏，无 undefined', () => {
  const s = seedState(T);
  const f = s.flights.find((x) => x.status === 'closed' && x.purpose === 'commercial');
  const html = flightCardHtml(s, f.id);
  for (const kw of ['飞行记录卡', '云雀 Air-3', '小吴', '航前检查', '操控员签字', '¥800', '第26/30/32/40条']) {
    assert.ok(html.includes(kw), `应包含 ${kw}`);
  }
  assert.ok(!html.includes('undefined'));
});

test('迎检自证包：判档/执照/批复/架次/义务/签字栏齐全，无 undefined 泄漏', () => {
  const s = seedState(T);
  const html = inspectHtml(s, T);
  for (const kw of ['迎检自证包', '判档', '运营合格证', '农保-60', '批复', '761', '单位负责人签字']) {
    assert.ok(html.includes(kw), `应包含 ${kw}`);
  }
  assert.ok(!html.includes('undefined'));
});

/* --------------------------------------------------------- 数据完整性 */

test('导出/导入往返一致；异构文件拒绝', () => {
  const s = seedState(T);
  const back = importBundle(exportBundle(s));
  assert.equal(back.uas.length, s.uas.length);
  assert.equal(back.flights.length, s.flights.length);
  assert.equal(back.permits.length, s.permits.length);
  assert.deepEqual(back.org, s.org);
  assert.throws(() => importBundle('{"foo":1}'), /备份文件/);
});

test('示例种子自洽：架次状态合法；异常架次起飞被拒；口袋机红灯在册；批复台账可复算', () => {
  const s = seedState(T);
  const legal = ['checking', 'cleared', 'flying', 'closed', 'cancelled'];
  for (const f of s.flights) assert.ok(legal.includes(f.status), f.status);
  // 带病机：u3 有在册检修单 → 再建架次被拒
  const u3 = s.uas.find((u) => u.nickname === '云雀 巡检-M350');
  assert.ok(openIssues(s, u3.id).length >= 1);
  const p2 = s.pilots.find((p) => p.name === '郑师傅');
  assert.throws(() => startFlight(s, { uasId: u3.id, pilotId: p2.id, dateISO: T, purpose: 'commercial' }), /带病机|检修/);
  // 口袋机未实名登记 → 开飞被拒（GB 46761 后微型也须登记）
  const u4 = s.uas.find((u) => u.nickname === '口袋机 Mini-1');
  const p1 = s.pilots.find((p) => p.name === '小吴');
  assert.throws(() => startFlight(s, { uasId: u4.id, pilotId: p1.id, dateISO: T, purpose: 'personal' }), /未实名登记/);
  // 错失窗口的申请在册（拟飞日=今天、状态 planned）
  const m2 = s.permits.find((m) => m.status === 'planned');
  assert.ok(m2 && m2.flyingDateISO === T);
});

test('todayISO 输出可回灌；停用机不参与', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  const s = fresh();
  const { uas } = rig(s);
  for (const kind of Object.keys(DUTY_KINDS)) setDutyDone(s, kind, T);
  assert.equal(healthCheck(s, T).score, 100);
  retireUas(s, uas.id);
  assert.equal(uas.status, 'retired');
  assert.equal(healthCheck(s, T).score, 100);
});
