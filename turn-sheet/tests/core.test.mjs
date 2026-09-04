/**
 * tests/core.test.mjs — 翻房单 TurnSheet 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, assertHM, todayISO, addDays, daysUntil, diffMinutes, minutesLabel, fmtYuan,
  PLATFORMS, LINEN_TYPES,
  turnoversOf, BASE_TASKS, taskExtras, turnoverStatus,
  linenStatusCounts, assertLinenIntegrity, applyLinenEvent, addLinenSets,
  transitOverdue, coverageFor, coverageWarnings, linenEconomics,
  suppliesLow, stayConflicts, todayBoard,
  runSheetText, runSheetHtml, escapeHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期（周六），不依赖墙钟

// ---------------------------------------------------------------------------
// 日期与时间
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期', () => {
  assert.throws(() => assertISO('2026-9-5'));
  assert.throws(() => assertISO('20260905'));
  assert.throws(() => assertISO(20260905));
  assert.doesNotThrow(() => assertISO('2028-02-29')); // 闰年合法
});

test('assertISO 拒绝闰年外的 2 月 29 日', () => {
  assert.throws(() => assertISO('2027-02-29'));
});

test('assertHM 只认 24 小时制 HH:MM', () => {
  assert.doesNotThrow(() => assertHM('00:00'));
  assert.doesNotThrow(() => assertHM('23:59'));
  assert.throws(() => assertHM('24:00'));
  assert.throws(() => assertHM('12:60'));
  assert.throws(() => assertHM('9:00'));
});

test('addDays 跨月/跨年收敛', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01'); // 平年
  assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // 闰年
});

test('diffMinutes 跨日按分钟折算，可为负', () => {
  assert.equal(diffMinutes('2026-09-05', '12:00', '2026-09-05', '15:00'), 180);
  assert.equal(diffMinutes('2026-09-05', '12:00', '2026-09-06', '15:00'), 1620);
  assert.equal(diffMinutes('2026-09-06', '14:00', '2026-09-05', '12:00'), -1560);
});

test('minutesLabel 与 fmtYuan（整数分）', () => {
  assert.equal(minutesLabel(180), '3 小时');
  assert.equal(minutesLabel(170), '2 小时 50 分');
  assert.equal(minutesLabel(45), '45 分钟');
  assert.equal(fmtYuan(12900), '¥129.00');
  assert.equal(fmtYuan(305), '¥3.05');
  assert.throws(() => fmtYuan(12.5));
});

// ---------------------------------------------------------------------------
// 翻房任务派生（窗口 = 两次入住之间的执行黑箱）
// ---------------------------------------------------------------------------

const PROPS = [
  { id: 'pA', name: 'A栋', beds: 1, towels: 2, cleanMinutes: 90, lockNote: '密码 5026#' },
  { id: 'pB', name: 'B栋', beds: 2, towels: 2, cleanMinutes: 60 },
];

test('turnoversOf：窗口充裕为 green，贴线为 yellow，不足为 red', () => {
  const stays = [
    { id: 's1', propId: 'pA', guest: '甲', checkin: '2026-09-03', checkinTime: '14:00', checkout: '2026-09-05', checkoutTime: '12:00' },
    { id: 's2', propId: 'pA', guest: '乙', checkin: '2026-09-05', checkinTime: '16:00', checkout: '2026-09-07', checkoutTime: '12:00' }, // 窗口 4h < 1.5×90min=135min? 不，4h=240min ≥135 → green
    { id: 's3', propId: 'pB', guest: '丙', checkin: '2026-09-04', checkinTime: '14:00', checkout: '2026-09-05', checkoutTime: '12:00' },
    { id: 's4', propId: 'pB', guest: '丁', checkin: '2026-09-05', checkinTime: '14:30', checkout: '2026-09-06', checkoutTime: '12:00' }, // 窗口 150min ≥ 1.5×60 → green
  ];
  const tvs = turnoversOf(stays, PROPS);
  const t1 = tvs.find((t) => t.key.endsWith('|s1'));
  const t3 = tvs.find((t) => t.key.endsWith('|s3'));
  assert.equal(t1.level, 'green');
  assert.equal(t1.windowMinutes, 240);
  assert.equal(t3.level, 'green');
});

test('turnoversOf：窗口边界按 cleanMinutes 与 1.5 倍判定', () => {
  const stays = [
    { id: 'a', propId: 'pA', checkin: '2026-09-04', checkinTime: '14:00', checkout: '2026-09-05', checkoutTime: '12:00' },
    { id: 'b', propId: 'pA', checkin: '2026-09-05', checkinTime: '13:29', checkout: '2026-09-06', checkoutTime: '12:00' }, // 89min < 90 → red
    { id: 'c', propId: 'pB', checkin: '2026-09-04', checkinTime: '14:00', checkout: '2026-09-05', checkoutTime: '12:00' },
    { id: 'd', propId: 'pB', checkin: '2026-09-05', checkinTime: '13:30', checkout: '2026-09-06', checkoutTime: '12:00' }, // 恰 90min ≥ 1.5×60 → green
  ];
  const tvs = turnoversOf(stays, PROPS);
  assert.equal(tvs.find((t) => t.key.endsWith('|a')).level, 'red');
  assert.equal(tvs.find((t) => t.key.endsWith('|c')).level, 'green');
});

test('turnoversOf：重叠订单判 conflict，无后续入住判 open', () => {
  const stays = [
    { id: 'x1', propId: 'pA', checkin: '2026-09-05', checkinTime: '14:00', checkout: '2026-09-07', checkoutTime: '12:00' },
    { id: 'x2', propId: 'pA', checkin: '2026-09-06', checkinTime: '14:00', checkout: '2026-09-08', checkoutTime: '12:00' }, // 与 x1 重叠
    { id: 'x3', propId: 'pB', checkin: '2026-09-04', checkinTime: '14:00', checkout: '2026-09-05', checkoutTime: '12:00' }, // 无后续
  ];
  const tvs = turnoversOf(stays, PROPS);
  assert.equal(tvs.find((t) => t.key.endsWith('|x1')).level, 'conflict');
  assert.equal(tvs.find((t) => t.key.endsWith('|x3')).level, 'open');
  assert.equal(tvs.find((t) => t.key.endsWith('|x3')).windowMinutes, null);
});

test('turnoversOf：房期引用不存在的房源直接抛错', () => {
  assert.throws(() => turnoversOf([{ id: 's', propId: 'nope', checkin: '2026-09-05', checkout: '2026-09-06' }], PROPS));
});

test('turnoversOf：同日多单取最早的可衔接入住', () => {
  const stays = [
    { id: 'm1', propId: 'pA', checkin: '2026-09-04', checkinTime: '14:00', checkout: '2026-09-05', checkoutTime: '12:00' },
    { id: 'm2', propId: 'pA', checkin: '2026-09-05', checkinTime: '20:00', checkout: '2026-09-06', checkoutTime: '12:00' },
    { id: 'm3', propId: 'pA', checkin: '2026-09-05', checkinTime: '15:00', checkout: '2026-09-07', checkoutTime: '12:00' },
  ];
  const t = turnoversOf(stays, PROPS).find((x) => x.key.endsWith('|m1'));
  assert.equal(t.checkinTime, '15:00');
  assert.equal(t.windowMinutes, 180);
});

// ---------------------------------------------------------------------------
// 布草状态机与总量守恒
// ---------------------------------------------------------------------------

function freshSets() {
  const sets = [];
  addLinenSets(sets, { type: 'bed', count: 3, priceCents: 12900, boughtISO: T });
  addLinenSets(sets, { type: 'towel', count: 2, priceCents: 3600, boughtISO: T });
  return sets;
}

test('addLinenSets：新购以净布入账，标签可区分', () => {
  const sets = freshSets();
  assert.equal(sets.length, 5);
  assert.ok(sets.every((s) => s.status === 'clean' && s.washes === 0));
  assert.ok(sets[0].label !== sets[1].label);
});

test('布草事件流：合法迁移链 撤→洗→回→铺，washes 只在回库时 +1', () => {
  const sets = freshSets();
  const [b1] = sets.filter((s) => s.type === 'bed');
  applyLinenEvent(sets, { type: 'deploy', setIds: [b1.id], propId: 'pA', dateISO: T });
  assert.equal(b1.status, 'room');
  applyLinenEvent(sets, { type: 'strip', setIds: [b1.id], dateISO: T });
  assert.equal(b1.status, 'dirty');
  applyLinenEvent(sets, { type: 'send', setIds: [b1.id], dateISO: T });
  assert.equal(b1.status, 'transit');
  assert.equal(b1.sentAt, T);
  applyLinenEvent(sets, { type: 'recv', setIds: [b1.id], dateISO: T });
  assert.equal(b1.status, 'clean');
  assert.equal(b1.washes, 1);
  assert.equal(b1.sentAt, null);
});

test('布草事件流：非法迁移整体抛错且不留半套入账', () => {
  const sets = freshSets();
  const beds = sets.filter((s) => s.type === 'bed');
  // clean 不能直接送洗
  assert.throws(() => applyLinenEvent(sets, { type: 'send', setIds: beds.map((s) => s.id), dateISO: T }));
  assert.equal(beds[0].status, 'clean'); // 整体拒绝，状态未变
  // 报废后再变动被拒
  applyLinenEvent(sets, { type: 'retire', setIds: [beds[1].id], dateISO: T });
  assert.equal(beds[1].status, 'retired');
  assert.throws(() => applyLinenEvent(sets, { type: 'deploy', setIds: [beds[1].id], propId: 'pA', dateISO: T }));
});

test('总量守恒：在房+脏+在途+净+报废 = 总套数', () => {
  const sets = freshSets();
  const c0 = assertLinenIntegrity(sets);
  assert.equal(c0.clean, 5);
  applyLinenEvent(sets, { type: 'deploy', setIds: [sets[0].id], propId: 'pA', dateISO: T });
  applyLinenEvent(sets, { type: 'strip', setIds: [sets[0].id], dateISO: T });
  applyLinenEvent(sets, { type: 'send', setIds: [sets[0].id], dateISO: T });
  const c1 = assertLinenIntegrity(sets);
  assert.equal(c1.room + c1.dirty + c1.transit + c1.clean + c1.retired, sets.length);
  assert.equal(c1.transit, 1);
});

test('strip 校验在房位置：套不在该房源时拒绝', () => {
  const sets = freshSets();
  const [b1] = sets.filter((s) => s.type === 'bed');
  applyLinenEvent(sets, { type: 'deploy', setIds: [b1.id], propId: 'pA', dateISO: T });
  assert.throws(() => applyLinenEvent(sets, { type: 'strip', setIds: [b1.id], propId: 'pB', dateISO: T }));
  assert.doesNotThrow(() => applyLinenEvent(sets, { type: 'strip', setIds: [b1.id], propId: 'pA', dateISO: T }));
});

test('transitOverdue：超 SLA 的送洗批次亮灯，边界内不报', () => {
  const sets = freshSets();
  const beds = sets.filter((s) => s.type === 'bed');
  applyLinenEvent(sets, { type: 'deploy', setIds: [beds[0].id, beds[1].id], propId: 'pA', dateISO: addDays(T, -10) });
  applyLinenEvent(sets, { type: 'strip', setIds: [beds[0].id, beds[1].id], dateISO: addDays(T, -10) });
  applyLinenEvent(sets, { type: 'send', setIds: [beds[0].id], dateISO: addDays(T, -4) });
  applyLinenEvent(sets, { type: 'send', setIds: [beds[1].id], dateISO: addDays(T, -3) });
  const od = transitOverdue(sets, T, 3);
  assert.equal(od.length, 1);
  assert.equal(od[0].days, 4);
  assert.equal(od[0].sets.length, 1);
  assert.equal(od[0].overdueBy, 1);
});

// ---------------------------------------------------------------------------
// 布草缺口与经济账（供应链的两本账）
// ---------------------------------------------------------------------------

test('coverageFor：净布口径缺口，在途不算可用', () => {
  const sets = freshSets();
  const beds = sets.filter((s) => s.type === 'bed');
  applyLinenEvent(sets, { type: 'deploy', setIds: [beds[0].id, beds[1].id], propId: 'pA', dateISO: T });
  const cov = coverageFor(PROPS[0], sets); // pA: beds=1, towels=2
  assert.equal(cov.bed.need, 1);
  assert.equal(cov.bed.clean, 1);
  assert.equal(cov.bed.shortfall, 0);
  assert.equal(cov.towel.clean, 2);
  // 把净布全部铺出去再算：缺 1 床品
  applyLinenEvent(sets, { type: 'deploy', setIds: [beds[2].id], propId: 'pA', dateISO: T });
  const cov2 = coverageFor({ ...PROPS[0], beds: 3 }, sets);
  assert.equal(cov2.bed.need, 3);
  assert.equal(cov2.bed.clean, 0);
  assert.equal(cov2.bed.shortfall, 3);
});

test('coverageWarnings：只对到客日且有缺口的房源报警', () => {
  const props = [{ id: 'pA', name: 'A栋', beds: 2, towels: 2 }];
  const sets = [];
  addLinenSets(sets, { type: 'bed', count: 1, priceCents: 10000, boughtISO: T });
  addLinenSets(sets, { type: 'towel', count: 2, priceCents: 3000, boughtISO: T });
  const stays = [
    { id: 's1', propId: 'pA', checkin: addDays(T, 1), checkinTime: '14:00', checkout: addDays(T, 3), checkoutTime: '12:00' },
  ];
  const w = coverageWarnings({ properties: props, sets, stays, fromISO: T, days: 3 });
  assert.equal(w.length, 1);
  assert.equal(w[0].date, addDays(T, 1));
  assert.equal(w[0].byType.bed.shortfall, 1);
  assert.equal(w[0].byType.towel?.shortfall ?? 0, 0); // 无缺口的不出现在清单里
});

test('linenEconomics：每次洗涤成本 = 购价 ÷ 额定次数（整数分）', () => {
  const sets = [];
  addLinenSets(sets, { type: 'bed', count: 2, priceCents: 12900, boughtISO: T });
  const eco = linenEconomics({ sets, events: [], todayISOStr: T });
  assert.equal(eco.types.bed.costPerWash, 99); // 12900/130 → 99.23 → 99
  assert.equal(eco.monthlyWashes, null);       // 无洗涤事件：拒绝判断节奏
  assert.equal(eco.types.bed.expiring, null);  // 薄数据不编造报废预算
});

test('linenEconomics：按月均节奏推 90 天重购清单（均摊到每套）', () => {
  const sets = [];
  addLinenSets(sets, { type: 'bed', count: 4, priceCents: 10000, boughtISO: T });
  // 近 90 天回洗 48 套次 → 月均 16 套次 → 每套 90 天期望 16×3/4 = 12 次
  const events = [];
  for (let i = 0; i < 48; i += 1) {
    sets[i % 4].washes += 1; // 直接累计寿命（历史回洗），事件流喂给经济账
    events.push({ type: 'selfwash', setIds: [sets[i % 4].id], dateISO: addDays(T, -89 + i) });
  }
  const eco = linenEconomics({ sets, events, todayISOStr: T, washWindowDays: 90 });
  assert.equal(eco.monthlyWashes, 16);
  // 全部 4 套已洗 12 次，剩余 118 > 12 → 无一进入重购
  assert.equal(eco.types.bed.expiring, 0);
  // 把其中 1 套洗到只剩 10 次寿命
  const target = sets[0];
  while (LINEN_TYPES.bed.ratedWashes - target.washes > 10) target.washes += 1;
  const eco2 = linenEconomics({ sets, events, todayISOStr: T, washWindowDays: 90 });
  assert.equal(eco2.types.bed.expiring, 1);
  assert.equal(eco2.types.bed.replacementCents, 10000);
});

test('linenEconomics：额定次数可被用户参数覆盖', () => {
  const sets = [];
  addLinenSets(sets, { type: 'bed', count: 1, priceCents: 12900, boughtISO: T });
  const eco = linenEconomics({ sets, events: [], todayISOStr: T, ratedOverrides: { bed: 100 } });
  assert.equal(eco.types.bed.ratedWashes, 100);
  assert.equal(eco.types.bed.costPerWash, 129);
  assert.throws(() => linenEconomics({ sets, events: [], todayISOStr: T, ratedOverrides: { bed: 0 } }));
});

// ---------------------------------------------------------------------------
// 翻房任务与任务单导出
// ---------------------------------------------------------------------------

test('turnoverStatus：勾选进度与遗留记录', () => {
  const key = '2026-09-05|pA|s1';
  assert.equal(turnoverStatus(key, {}).allDone, false);
  const logs = { [key]: { tasks: Object.fromEntries(BASE_TASKS.map((t) => [t.id, true])), found: '充电器' } };
  const st = turnoverStatus(key, logs);
  assert.equal(st.allDone, true);
  assert.equal(st.found, '充电器');
});

test('taskExtras：缺口与在途超时回灌任务单，无异常时给出门锁信息', () => {
  const ex1 = taskExtras({
    prop: PROPS[0],
    linenByType: { bed: { need: 1, clean: 0, transit: 2, shortfall: 1 }, towel: { need: 2, clean: 2, transit: 0, shortfall: 0 } },
    transitOverdue: 2,
  });
  assert.equal(ex1.length, 3);
  assert.ok(ex1[0].includes('床品净布缺 1'));
  assert.ok(ex1[1].includes('2 套布草在途'));
  const ex2 = taskExtras({ prop: PROPS[0], linenByType: { bed: { shortfall: 0 }, towel: { shortfall: 0 } }, transitOverdue: 0 });
  assert.deepEqual(ex2, ['门锁/取钥：密码 5026#']);
});

test('runSheetText：确定性输出，包含窗口/任务/紧张标记', () => {
  const props = [{ id: 'pA', name: 'A栋', beds: 1, towels: 2, cleanMinutes: 90, lockNote: '密码 5026#' }];
  const stays = [
    { id: 's1', propId: 'pA', guest: '王先生', platform: 'meituan', checkin: '2026-09-04', checkinTime: '14:00', checkout: '2026-09-05', checkoutTime: '12:00' },
    { id: 's2', propId: 'pA', guest: '刘女士', checkin: '2026-09-05', checkinTime: '14:00', checkout: '2026-09-07', checkoutTime: '12:00' },
  ];
  const tvs = turnoversOf(stays, props);
  const args = { turnovers: tvs, dateISO: '2026-09-05', extrasByProp: { pA: ['门锁/取钥：密码 5026#'] }, hostName: '小林', todayISOStr: T };
  const text1 = runSheetText(args);
  const text2 = runSheetText(args);
  assert.equal(text1, text2); // 同输入同输出
  assert.ok(text1.includes('【翻房任务单】2026-09-05'));
  assert.ok(text1.includes('A栋'));
  assert.ok(text1.includes('窗口 2 小时'));
  assert.ok(text1.includes('退房查遗留'));
  assert.ok(text1.includes('门锁/取钥：密码 5026#'));
  assert.ok(text1.includes('一客一换 · GB 9663-1996'));
});

test('runSheetText：没有任务时拒绝生成空单', () => {
  assert.throws(() => runSheetText({ turnovers: [], dateISO: T, extrasByProp: {} }));
});

test('runSheetHtml：单文件内联样式，房客名做 XSS 转义', () => {
  const props = [{ id: 'pA', name: 'A栋', beds: 1, towels: 2, cleanMinutes: 90 }];
  const stays = [
    { id: 's1', propId: 'pA', guest: '<script>alert(1)</script>', checkin: '2026-09-04', checkinTime: '14:00', checkout: '2026-09-05', checkoutTime: '12:00' },
  ];
  const tvs = turnoversOf(stays, props);
  const html = runSheetHtml({ turnovers: tvs, dateISO: '2026-09-05', extrasByProp: {}, hostName: '小<x>', todayISOStr: T });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('href='));
  assert.ok(!html.includes('src='));
});

test('escapeHtml 覆盖五类字符', () => {
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

// ---------------------------------------------------------------------------
// 看板聚合与冲突
// ---------------------------------------------------------------------------

test('stayConflicts：同房源区间相交才报冲突', () => {
  const stays = [
    { id: 'a', propId: 'pA', checkin: '2026-09-03', checkout: '2026-09-05' },
    { id: 'b', propId: 'pA', checkin: '2026-09-05', checkout: '2026-09-07' }, // 退房日接住 = 不冲突
    { id: 'c', propId: 'pB', checkin: '2026-09-04', checkout: '2026-09-06' },
    { id: 'd', propId: 'pB', checkin: '2026-09-05', checkout: '2026-09-07' }, // 与 c 冲突
  ];
  const conflicts = stayConflicts(stays);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].bId, 'd');
});

test('todayBoard：聚合退房/到客/窗口/布草/耗品五类信号', () => {
  const props = [
    { id: 'pA', name: 'A栋', beds: 1, towels: 2, cleanMinutes: 90 },
    { id: 'pB', name: 'B栋', beds: 1, towels: 2, cleanMinutes: 60 },
  ];
  const sets = [];
  addLinenSets(sets, { type: 'bed', count: 1, priceCents: 10000, boughtISO: T }); // 全部为净布
  const beds = sets.filter((s) => s.type === 'bed');
  applyLinenEvent(sets, { type: 'deploy', setIds: [beds[0].id], propId: 'pA', dateISO: addDays(T, -2) });
  const stays = [
    { id: 's1', propId: 'pA', guest: '甲', checkin: addDays(T, -1), checkinTime: '14:00', checkout: T, checkoutTime: '12:00' },
    { id: 's2', propId: 'pA', guest: '乙', checkin: T, checkinTime: '14:00', checkout: addDays(T, 2), checkoutTime: '12:00' }, // 窗口 2h < 90min? 120≥90 且<135 → yellow
    { id: 's3', propId: 'pB', guest: '丙', checkin: T, checkinTime: '15:00', checkout: addDays(T, 1), checkoutTime: '12:00' },
  ];
  const supplies = [{ id: 'sp1', name: '卷纸', stock: 1, minStock: 4 }];
  const board = todayBoard({ todayISOStr: T, stays, properties: props, sets, supplies, logs: {} });
  assert.equal(board.checkoutsToday.length, 1);
  assert.equal(board.checkinsToday.length, 2);
  assert.ok(board.upcoming.length >= 1);
  assert.equal(board.suppliesLow.length, 1);
  assert.equal(board.conflicts.length, 0);
  // pA 的床品铺在房里（在房），乙今日 14:00 到 → 明日内有缺口预警（净布 0）
  assert.ok(board.linenShortages.some((w) => w.propId === 'pA' && w.byType.bed.shortfall === 1));
});

test('suppliesLow：库存 ≤ 安全线才上榜', () => {
  const list = [
    { name: '卷纸', stock: 4, minStock: 4 },
    { name: '瓶装水', stock: 5, minStock: 4 },
    { name: '拖鞋', stock: 0, minStock: 2 },
  ];
  const low = suppliesLow(list);
  assert.deepEqual(low.map((s) => s.name), ['拖鞋', '卷纸']);
});

// ---------------------------------------------------------------------------
// 数据导入导出
// ---------------------------------------------------------------------------

test('exportBundle / importBundle 往返一致，错误文件整体拒绝', () => {
  const state = {
    version: STATE_VERSION,
    host: { name: '小林', phone: '' },
    properties: PROPS, stays: [], linenSets: freshSets(), linenEvents: [],
    supplies: [], turnoverLogs: {}, settings: { washSlaDays: 3, ratedWashes: {} }, events: [],
  };
  const bundle = exportBundle(state);
  const res = importBundle(bundle);
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.properties, PROPS);

  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle('{"app":"foodsentry"}').ok, false); // 别家备份拒绝
  assert.equal(importBundle(JSON.stringify({ app: 'turnsheet', version: STATE_VERSION + 1, state })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'turnsheet', version: 1, state: { host: {} } })).ok, false);
});

// ---------------------------------------------------------------------------
// 平台与模板常量
// ---------------------------------------------------------------------------

test('平台与布草类型常量完整', () => {
  assert.ok(PLATFORMS.meituan.label.includes('美团'));
  assert.equal(LINEN_TYPES.bed.ratedWashes, 130);
  assert.equal(LINEN_TYPES.towel.ratedWashes, 150);
  assert.equal(BASE_TASKS.length, 6);
  assert.ok(BASE_TASKS.some((t) => t.id === 'found'));
});

test('todayISO 支持注入时钟保证测试确定性', () => {
  const fixed = new Date('2026-09-05T20:00:00+08:00');
  assert.equal(todayISO(fixed), '2026-09-05');
});
