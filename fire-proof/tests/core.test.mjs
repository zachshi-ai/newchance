/**
 * tests/core.test.mjs — 防火单 FireProof 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, escapeHtml,
  VENUE_TYPES, PATROL_SLOTS, PATROL_ITEMS, PATROL_MODES, EXT_TYPES,
  HAZARD_SOURCES, NOTICE_SOURCES, CHECK_ITEMS, TRAIN_KINDS,
  DEFAULT_GAP_DAYS, DEFAULT_CHECK_DAYS,
  venueOf, trainingMonths, drillMonths, extCheckDays,
  precheckState, mixedState,
  addExtinguisher, removeExtinguisher, extClocks, serviceExtinguisher, addExtCheck, extCheckClock,
  addPatrol, removePatrol, lastPatrolISO, patrolGapDays, patrolAbnormals, patrolDailyDone,
  addMonthlyCheck, monthlyCheckClock,
  addHazard, closeHazard, openHazards, hazardRisk,
  addTraining, trainClock, dutyBoard,
  healthCheck, monthlySummary, inspectHtml, hazardSheetHtml,
  STATE_VERSION, exportBundle, importBundle,
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

test('addDays 跨月/跨年收敛；daysUntil/monthKey 跨年正确', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysUntil('2026-12-31', T), 116);
  assert.equal(daysUntil('2026-09-06', T), 0);
  assert.equal(monthKey('2026-09-06'), '2026-09');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('escapeHtml 全转义', () => {
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

test('口径常量基线：场所 11 类/灭火器 4 型/隐患来源/八查/三培训，法定默认值', () => {
  assert.deepEqual(Object.keys(VENUE_TYPES).sort(),
    ['catering', 'clinic', 'edu', 'fuel', 'fun', 'hotel', 'mixed', 'other', 'retail', 'storage', 'workshop']);
  assert.deepEqual(Object.keys(EXT_TYPES).sort(), ['clean', 'co2', 'powder', 'water']);
  assert.deepEqual(Object.keys(HAZARD_SOURCES), ['patrol', 'self', 'property', 'notice119', 'noticePolice']);
  assert.deepEqual(NOTICE_SOURCES, ['notice119', 'noticePolice']);
  assert.deepEqual(Object.keys(CHECK_ITEMS), ['exit', 'ext', 'elec', 'gas', 'tri', 'door', 'charge', 'evac']);
  assert.deepEqual(Object.keys(TRAIN_KINDS), ['training', 'drill', 'inspection']);
  assert.deepEqual(Object.keys(PATROL_SLOTS), ['open', 'mid', 'close']);
  assert.deepEqual(Object.keys(PATROL_ITEMS), ['fire', 'exit', 'equip', 'post']);
  assert.equal(DEFAULT_GAP_DAYS, 2);
  assert.equal(DEFAULT_CHECK_DAYS, 30);
  // 报废年限：水基 6 / 干粉 10 / 洁净气体 10 / 二氧化碳 12（GB 50444 通行口径）
  assert.deepEqual(Object.entries(EXT_TYPES).map(([k, v]) => [k, v.scrapYears]),
    [['water', 6], ['powder', 10], ['clean', 10], ['co2', 12]]);
});

test('场所类型驱动周期：人员密集培训半年/灭火器半月检；宾馆商场娱乐演练半年', () => {
  assert.equal(trainingMonths({ type: 'catering' }), 6);
  assert.equal(trainingMonths({ type: 'workshop' }), 12);
  assert.equal(drillMonths({ type: 'retail' }), 6);
  assert.equal(drillMonths({ type: 'hotel' }), 6);
  assert.equal(drillMonths({ type: 'fun' }), 6);
  assert.equal(drillMonths({ type: 'catering' }), 12);
  assert.equal(extCheckDays({ type: 'hotel' }), 15);
  assert.equal(extCheckDays({ type: 'workshop' }), 30);
  assert.equal(venueOf({ type: 'nope' }).label, VENUE_TYPES.other.label);
  assert.equal(venueOf(null).patrol, 'daily');
});

// ---------------------------------------------------------------------------
// 营业前消防安全检查钟（消防法第 15 条）与三合一（第 61 条）
// ---------------------------------------------------------------------------

test('precheckState：非公众聚集=不涉及；未申请=red；已申请=warn；已许可=ok 带凭证', () => {
  assert.equal(precheckState({ publicPlace: false }).level, 'na');
  assert.equal(precheckState({ publicPlace: true }).level, 'red');
  assert.match(precheckState({ publicPlace: true }).detail, /不得投入使用、营业/);
  const warn = precheckState({ publicPlace: true, precheck: { status: 'applied', appliedISO: '2026-09-01' } });
  assert.equal(warn.level, 'warn');
  const ok = precheckState({ publicPlace: true, precheck: { status: 'licensed', licenseNo: '许001', licensedISO: '2025-01-01' } });
  assert.equal(ok.level, 'ok');
  assert.match(ok.detail, /许001/);
});

test('mixedState：无住人 ok；未分隔 red（61 条口径）；已分隔 warn', () => {
  assert.equal(mixedState({}).level, 'ok');
  assert.equal(mixedState({ mixedWithHome: true }).level, 'red');
  assert.match(mixedState({ mixedWithHome: true }).detail, /停产停业/);
  assert.equal(mixedState({ mixedWithHome: true, homeSeparated: true }).level, 'warn');
});

// ---------------------------------------------------------------------------
// 灭火器台账（报废钟 + 送修钟 + 月检钟）
// ---------------------------------------------------------------------------

function baseState() {
  return {
    version: 1,
    place: {
      name: '', type: 'other', manager: '', phone: '', address: '', area: '', floors: '',
      openedISO: '', publicPlace: false, mixedWithHome: false, homeSeparated: false, hasSystems: false,
      precheck: { status: 'unset', appliedISO: '', licenseNo: '', licensedISO: '' },
    },
    extinguishers: [], extChecks: [], patrols: [], monthChecks: [], hazards: [], trainings: [],
    settings: { gapDays: 2, checkDays: 30, extCheckDays: 0 },
    extSeq: 0, extCheckSeq: 0, patrolSeq: 0, monthCheckSeq: 0, hazardSeq: 0, trainingSeq: 0,
    events: [],
  };
}

test('addExtinguisher：类型与出厂日校验；removeExtinguisher 级联清理检查记录', () => {
  const s = baseState();
  const e = addExtinguisher(s, { no: '1号', type: 'powder', madeISO: '2020-01-01', location: '大堂' });
  assert.equal(s.extinguishers.length, 1);
  assert.equal(e.id, 'ex-1');
  assert.throws(() => addExtinguisher(s, { type: 'foam', madeISO: T }), /非法灭火器类型/);
  assert.throws(() => addExtinguisher(s, { type: 'water', madeISO: '2020/1/1' }), /非法日期/);
  addExtCheck(s, { extId: e.id, dateISO: T });
  removeExtinguisher(s, e.id);
  assert.equal(s.extinguishers.length, 0);
  assert.equal(s.extChecks.length, 0);
  assert.throws(() => removeExtinguisher(s, 'ex-9'), /不存在/);
});

test('extClocks：报废钟（水基 6 年）与送修钟（3+1/5+2）三态', () => {
  const water = { type: 'water', madeISO: '2020-09-10', lastServiceISO: null };
  const scrap = extClocks(water, T).scrap;
  assert.equal(scrap.dueISO, addDays('2020-09-10', 6 * 365));
  assert.equal(scrap.dueISO, '2026-09-09'); // 锚定日剩 3 天 → 临期
  assert.equal(scrap.daysLeft, 3);
  assert.equal(scrap.level, 'due');

  const powder = { type: 'powder', madeISO: '2016-08-10', lastServiceISO: null };
  const clocks = extClocks(powder, T);
  assert.equal(clocks.scrap.level, 'overdue');
  assert.equal(clocks.service.level, 'overdue'); // 从未送修：出厂 + 5 年首修，早已超期
  assert.equal(clocks.service.dueISO, addDays('2016-08-10', 5 * 365));

  const serviced = { type: 'water', madeISO: '2022-01-01', lastServiceISO: '2025-09-20' };
  const svc = extClocks(serviced, T).service;
  assert.equal(svc.dueISO, addDays('2025-09-20', 365)); // 水基复修周期 1 年
  assert.equal(svc.daysLeft, 14);
  assert.equal(svc.level, 'due');

  const ok = extClocks({ type: 'co2', madeISO: '2024-01-01', lastServiceISO: null }, T);
  assert.equal(ok.scrap.level, 'ok');
  assert.equal(ok.service.level, 'ok');
  assert.throws(() => extClocks({ type: 'x', madeISO: T }, T), /非法灭火器类型/);
});

test('serviceExtinguisher：回溯拒绝、送修日重算周期', () => {
  const s = baseState();
  const e = addExtinguisher(s, { type: 'powder', madeISO: '2020-01-01' });
  assert.throws(() => serviceExtinguisher(s, e.id, { dateISO: '2019-12-31' }), /早于出厂/);
  serviceExtinguisher(s, e.id, { dateISO: '2025-01-10', note: '换粉' });
  assert.equal(s.extinguishers[0].lastServiceISO, '2025-01-10');
  assert.equal(extClocks(s.extinguishers[0], T).service.dueISO, addDays('2025-01-10', 2 * 365));
  assert.throws(() => serviceExtinguisher(s, 'ex-9', { dateISO: T }), /不存在/);
});

test('addExtCheck：同具同日唯一；异常必须写明；布尔校验', () => {
  const s = baseState();
  const e = addExtinguisher(s, { type: 'powder', madeISO: '2020-01-01' });
  addExtCheck(s, { extId: e.id, dateISO: T });
  assert.throws(() => addExtCheck(s, { extId: e.id, dateISO: T }), /同具同日唯一/);
  assert.throws(() => addExtCheck(s, { extId: e.id, dateISO: T, pressure: false }), /必须写明/);
  assert.throws(() => addExtCheck(s, { extId: e.id, dateISO: '2026-09-05', pressure: 'ok' }), /布尔/);
  assert.throws(() => addExtCheck(s, { extId: 'ex-9', dateISO: T }), /不存在/);
  addExtCheck(s, { extId: e.id, dateISO: '2026-09-05', pressure: false, note: '指针在红区，已报换新' });
  assert.equal(s.extChecks.length, 2);
});

test('extCheckClock：never/overdue/due/ok 与间隔校验', () => {
  const s = baseState();
  const e = addExtinguisher(s, { type: 'powder', madeISO: '2020-01-01' });
  assert.equal(extCheckClock(s, e, T, 15).level, 'never');
  addExtCheck(s, { extId: e.id, dateISO: '2026-08-20' });
  const c15 = extCheckClock(s, e, T, 15);   // 应检 2026-09-04，超 2 天
  assert.equal(c15.level, 'overdue');
  assert.equal(c15.daysLeft, -2);
  const c30 = extCheckClock(s, e, T, 30);   // 应检 2026-09-19，剩 13 天
  assert.equal(c30.daysLeft, 13);
  assert.equal(c30.level, 'ok');
  const c15b = extCheckClock(s, e, '2026-09-03', 15); // 应检 09-04 剩 1 天 → due
  assert.equal(c15b.level, 'due');
  assert.throws(() => extCheckClock(s, e, T, 5), /非法检查间隔/);
});

// ---------------------------------------------------------------------------
// 防火巡查
// ---------------------------------------------------------------------------

test('addPatrol：时段枚举；异常必须写处置；open/close 同日唯一，mid 允许多笔', () => {
  const s = baseState();
  addPatrol(s, { dateISO: T, slot: 'open', items: {}, note: '' });
  assert.throws(() => addPatrol(s, { dateISO: T, slot: 'open' }), /同日同段唯一/);
  assert.throws(() => addPatrol(s, { dateISO: T, slot: 'noon' }), /非法巡查时段/);
  assert.throws(() => addPatrol(s, { dateISO: T, slot: 'mid', items: { exit: false } }), /必须写明/);
  addPatrol(s, { dateISO: T, slot: 'mid', items: { exit: false }, note: '货箱挡道已搬走' });
  addPatrol(s, { dateISO: T, slot: 'mid' }); // 营业期间每 2 小时可多笔
  assert.equal(s.patrols.length, 3);
  assert.equal(s.patrols[1].abnormal, true);
  assert.equal(s.patrols[2].abnormal, false);
  addPatrol(s, { dateISO: '2026-09-05', slot: 'close' });
  assert.throws(() => addPatrol(s, { dateISO: '2026-09-05', slot: 'close' }), /同日同段唯一/);
});

test('removePatrol / lastPatrolISO / patrolGapDays / patrolDailyDone / patrolAbnormals', () => {
  const s = baseState();
  addPatrol(s, { dateISO: '2026-09-01', slot: 'open' });
  addPatrol(s, { dateISO: '2026-09-01', slot: 'close' });
  addPatrol(s, { dateISO: '2026-09-04', slot: 'open', items: { exit: false }, note: '出口被堵已清理' });
  assert.equal(lastPatrolISO(s), '2026-09-04');
  assert.equal(patrolGapDays(s, T), 2);
  assert.equal(patrolDailyDone(s, '2026-09-01'), true);
  assert.equal(patrolDailyDone(s, '2026-09-04'), false);
  const abn = patrolAbnormals(s);
  assert.deepEqual(abn.map((p) => p.dateISO), ['2026-09-04']);
  assert.equal(abn[0].items.exit, false);
  removePatrol(s, 'pt-3');
  assert.equal(patrolGapDays(s, T), 5);
  removePatrol(s, 'pt-1');
  removePatrol(s, 'pt-2');
  assert.equal(patrolGapDays(s, T), null);
  assert.throws(() => removePatrol(s, 'pt-9'), /不存在/);
  assert.throws(() => patrolGapDays(s, '2026-9-6'), /非法日期/);
});

// ---------------------------------------------------------------------------
// 防火检查（每月八查）
// ---------------------------------------------------------------------------

test('addMonthlyCheck：同日唯一；异常必须写明；缺省项为正常', () => {
  const s = baseState();
  addMonthlyCheck(s, { dateISO: T });
  assert.throws(() => addMonthlyCheck(s, { dateISO: T }), /同日唯一/);
  assert.throws(() => addMonthlyCheck(s, { dateISO: '2026-09-05', items: { exit: false } }), /必须写明/);
  addMonthlyCheck(s, { dateISO: '2026-09-05', items: { exit: false }, note: '出口堆货已清理并教育员工' });
  assert.equal(s.monthChecks[1].items.exit, false);
  assert.equal(s.monthChecks[1].items.ext, true);
  assert.equal(s.monthChecks[0].items.exit, true); // 首条全正常不受影响
});

test('monthlyCheckClock：never/overdue/due/ok', () => {
  const s = baseState();
  assert.equal(monthlyCheckClock(s, T).level, 'never');
  addMonthlyCheck(s, { dateISO: '2026-08-01' }); // 周期到 08-31，超 6 天
  const c = monthlyCheckClock(s, T);
  assert.equal(c.level, 'overdue');
  assert.equal(c.daysLeft, -6);
  addMonthlyCheck(s, { dateISO: '2026-08-10' }); // 同日唯一只限同日，不同日追加 → 最近为 08-10
  const c2 = monthlyCheckClock(s, T);            // 周期到 09-09 剩 3 天
  assert.equal(c2.level, 'due');
  assert.equal(c2.daysLeft, 3);
  addMonthlyCheck(s, { dateISO: '2026-09-01' });
  assert.equal(monthlyCheckClock(s, T).level, 'ok');
});

// ---------------------------------------------------------------------------
// 隐患整改闭环
// ---------------------------------------------------------------------------

test('addHazard：来源校验；描述必填；通知类必须带文书编号；期限校验', () => {
  const s = baseState();
  const h = addHazard(s, { dateISO: T, source: 'self', desc: '应急照明灯不亮', dueISO: '2026-09-10' });
  assert.equal(s.hazards.length, 1);
  assert.throws(() => addHazard(s, { dateISO: T, source: 'boss', desc: 'x' }), /非法隐患来源/);
  assert.throws(() => addHazard(s, { dateISO: T, source: 'self', desc: '  ' }), /描述不能为空/);
  assert.throws(() => addHazard(s, { dateISO: T, source: 'notice119', desc: '出口堵塞' }), /文书编号/);
  assert.throws(() => addHazard(s, { dateISO: T, source: 'self', desc: 'x', dueISO: '2026-9-9' }), /非法日期/);
  addHazard(s, { dateISO: T, source: 'noticePolice', docNo: '检字2026-088', desc: '灭火器遮挡' });
  assert.equal(s.hazards[1].docNo, '检字2026-088');
  assert.equal(h.id, 'hz-1');
});

test('closeHazard：回溯拒绝、一次定案', () => {
  const s = baseState();
  addHazard(s, { dateISO: '2026-09-01', source: 'self', desc: 'x' });
  assert.throws(() => closeHazard(s, 'hz-1', { closedISO: '2026-08-31' }), /早于登记日期/);
  closeHazard(s, 'hz-1', { closedISO: T, verifyNote: '已整改' });
  assert.equal(s.hazards[0].closedISO, T);
  assert.throws(() => closeHazard(s, 'hz-1', { closedISO: T }), /已复查销案/);
  assert.throws(() => closeHazard(s, 'hz-9', { closedISO: T }), /不存在/);
});

test('openHazards：通知类超期 > 普通超期 > 通知类在限 > 在限，同档按登记日升序', () => {
  const s = baseState();
  addHazard(s, { dateISO: '2026-08-20', source: 'self', desc: 'a', dueISO: '2026-09-01' });          // 普通超期
  addHazard(s, { dateISO: '2026-08-25', source: 'notice119', docNo: '1', desc: 'b', dueISO: '2026-09-01' }); // 通知超期
  addHazard(s, { dateISO: '2026-08-30', source: 'self', desc: 'c' });                                // 在限
  addHazard(s, { dateISO: '2026-08-15', source: 'noticePolice', docNo: '2', desc: 'd', dueISO: '2026-09-20' }); // 通知在限
  addHazard(s, { dateISO: '2026-08-10', source: 'self', desc: 'e', dueISO: '2026-09-03' });          // 普通超期（更早）
  closeHazard(s, 'hz-5', { closedISO: T }); // 已销案不进挂账
  const open = openHazards(s, T);
  assert.deepEqual(open.map((h) => h.id), ['hz-2', 'hz-1', 'hz-4', 'hz-3']);
  const risk = hazardRisk(s, T);
  assert.deepEqual(risk, { open: 4, noticeOpen: 2, overdue: 2, noticeOverdue: 1 });
  assert.throws(() => openHazards(s, 'bad-date'), /非法日期/);
});

// ---------------------------------------------------------------------------
// 培训 / 演练 / 年度检测
// ---------------------------------------------------------------------------

test('addTraining：类型与人数校验；trainClock 周期按场所类型与 na 判定', () => {
  const s = baseState();
  const catering = { type: 'catering' };
  assert.throws(() => addTraining(s, { dateISO: T, kind: 'yoga' }), /非法培训演练类型/);
  assert.throws(() => addTraining(s, { dateISO: T, kind: 'drill', count: -1 }), /非负整数/);
  addTraining(s, { dateISO: '2026-03-10', kind: 'training', count: 5 }); // 餐饮 6 个月=180 天 → 恰好今天到期
  const tc = trainClock(s, 'training', catering, T);
  assert.equal(tc.months, 6);
  assert.equal(tc.dueISO, '2026-09-06');
  assert.equal(tc.daysLeft, 0);
  assert.equal(tc.level, 'due');
  // 演练逾期样例（先加更早的，取最近记录后转 due）
  addTraining(s, { dateISO: '2025-08-20', kind: 'drill', count: 3 });
  const dc2 = trainClock(s, 'drill', { type: 'workshop' }, T); // 作坊 12 个月：2025-08-20+360 → 2026-08-14
  assert.equal(dc2.level, 'overdue');
  addTraining(s, { dateISO: '2025-09-11', kind: 'drill', count: 5 });    // 餐饮演练 12 个月=360 天
  const dc = trainClock(s, 'drill', catering, T);
  assert.equal(dc.months, 12);
  assert.equal(dc.dueISO, '2026-09-06');
  assert.equal(dc.level, 'due');
  // 年度检测：无自动消防设施 → na；有设施但从未检测 → never
  assert.equal(trainClock(s, 'inspection', { type: 'other', hasSystems: false }, T).level, 'na');
  assert.equal(trainClock(s, 'inspection', { type: 'other', hasSystems: true }, T).level, 'never');
  assert.throws(() => trainClock(s, 'yoga', catering, T), /非法培训演练类型/);
});

test('dutyBoard：红灯在前（never/overdue），na 排最后，附标签与依据', () => {
  const s = baseState();
  const place = { type: 'catering' };
  addTraining(s, { dateISO: T, kind: 'training', count: 4 });          // ok
  addTraining(s, { dateISO: '2025-08-01', kind: 'drill', count: 4 });  // overdue（360 天 → 2026-07-27）
  const board = dutyBoard(s, place, T);
  assert.deepEqual(board.map((d) => d.level), ['overdue', 'ok', 'na']);
  assert.equal(board[0].label, '灭火和应急疏散演练');
  assert.equal(board[2].label, '建筑消防设施年度检测');
  assert.match(board[0].basis, /第十六条/);
});

// ---------------------------------------------------------------------------
// 账本体检
// ---------------------------------------------------------------------------

test('healthCheck：空台账 5 红零黄 = 25 分（器材未登记×2/巡查/防火检查/培训演练）', () => {
  const s = baseState();
  s.place = { ...s.place, name: '测试场所', type: 'other' };
  const hc = healthCheck(s, T, s.settings);
  assert.equal(hc.items.length, 9);
  const byKey = Object.fromEntries(hc.items.map((i) => [i.key, i.level]));
  assert.equal(byKey.precheck, 'ok');       // 非公众聚集不涉及
  assert.equal(byKey.mixed, 'ok');
  assert.equal(byKey.scrap, 'bad');
  assert.equal(byKey.extcheck, 'bad');
  assert.equal(byKey.patrol, 'bad');
  assert.equal(byKey.monthcheck, 'bad');
  assert.equal(byKey.hazard, 'ok');
  assert.equal(byKey.duty, 'bad');
  assert.equal(byKey.abnormal, 'ok');
  assert.equal(hc.bad, 5);
  assert.equal(hc.warn, 0);
  assert.equal(hc.score, 25); // 100 - 5×15，确定性扣分
});

test('healthCheck：健康台账 75 分案例（警示黄×2 + 培训演练红×1），扣分确定性', () => {
  const s = baseState();
  s.place = {
    ...s.place, name: '老王家常菜', type: 'catering', publicPlace: true,
    precheck: { status: 'licensed', licenseNo: '许001', licensedISO: '2025-01-01' },
    mixedWithHome: true, homeSeparated: true, // warn
  };
  addExtinguisher(s, { no: '1号', type: 'water', madeISO: '2020-09-10', lastServiceISO: '2026-03-10' }); // 报废临期 → warn；送修刚做 → ok
  addExtCheck(s, { extId: 'ex-1', dateISO: '2026-09-03' });               // 15 天口径内 → ok
  addPatrol(s, { dateISO: T, slot: 'open' });                              // 巡查在续
  addMonthlyCheck(s, { dateISO: T });                                      // 检查在期
  addTraining(s, { dateISO: T, kind: 'training', count: 5 });              // 培训 ok
  // 演练从未开展 → duty 红
  const hc = healthCheck(s, T, s.settings);
  const byKey = Object.fromEntries(hc.items.map((i) => [i.key, i.level]));
  assert.equal(byKey.precheck, 'ok');
  assert.equal(byKey.mixed, 'warn');
  assert.equal(byKey.scrap, 'warn');
  assert.equal(byKey.extcheck, 'ok');
  assert.equal(byKey.patrol, 'ok');
  assert.equal(byKey.monthcheck, 'ok');
  assert.equal(byKey.hazard, 'ok');
  assert.equal(byKey.duty, 'bad');
  assert.equal(hc.bad, 1);
  assert.equal(hc.warn, 2);
  assert.equal(hc.score, 75); // 100 - 15 - 2×5
});

test('healthCheck：断更/超期检查/隐患超期分别亮红灯；展示层不出现负数天数', () => {
  const s = baseState();
  s.place = { ...s.place, name: 'X', type: 'other' };
  addPatrol(s, { dateISO: '2026-09-01', slot: 'open' });    // 断更 5 天 > 红线 2
  addMonthlyCheck(s, { dateISO: '2026-07-27' });            // 40 天前，超期 11 天
  addHazard(s, { dateISO: '2026-08-20', source: 'self', desc: '出口堆货', dueISO: '2026-09-01' }); // 超期
  const hc = healthCheck(s, T, s.settings);
  const patrol = hc.items.find((i) => i.key === 'patrol');
  assert.equal(patrol.level, 'bad');
  assert.match(patrol.detail, /断更 5 天/);
  assert.ok(!/-\d+ 天/.test(patrol.detail));
  const mc = hc.items.find((i) => i.key === 'monthcheck');
  assert.equal(mc.level, 'bad');
  assert.match(mc.detail, /已超期 11 天/);
  assert.ok(!/-\d+ 天/.test(mc.detail));
  const hz = hc.items.find((i) => i.key === 'hazard');
  assert.equal(hz.level, 'bad');
  assert.match(hz.detail, /已超整改期限/);
});

// ---------------------------------------------------------------------------
// 月度小结与出证（单文件 HTML）
// ---------------------------------------------------------------------------

function demoMonth() {
  const s = baseState();
  s.place = { ...s.place, name: '城南路老王家常菜', type: 'catering', manager: '王建国' };
  addExtinguisher(s, { no: '1号', type: 'powder', madeISO: '2024-01-01', location: '大堂' });
  addExtinguisher(s, { no: '2号', type: 'water', madeISO: '2020-09-10', location: '收银台' });
  addExtCheck(s, { extId: 'ex-1', dateISO: '2026-09-03' });
  addPatrol(s, { dateISO: '2026-09-01', slot: 'open' });
  addPatrol(s, { dateISO: '2026-09-05', slot: 'close', items: { exit: false }, note: '后门被货箱挡，已搬空' });
  addMonthlyCheck(s, { dateISO: '2026-09-02' });
  addHazard(s, { dateISO: '2026-08-20', source: 'self', desc: '杂物挡消火栓', dueISO: '2026-08-25' });
  closeHazard(s, 'hz-1', { closedISO: '2026-09-05', verifyNote: '已清理' });
  addHazard(s, { dateISO: '2026-09-04', source: 'self', desc: '应急照明灯不亮' });
  addTraining(s, { dateISO: '2026-09-05', kind: 'training', count: 5, note: '灭火器使用' });
  return s;
}

test('monthlySummary：五段文本、分月隔离、确定性、口径尾注', () => {
  const s = demoMonth();
  const sum = monthlySummary(s, '2026-09', T);
  assert.match(sum.text, /【场所消防安全月度小结】2026-09/);
  assert.match(sum.text, /场所：城南路老王家常菜（餐饮场所）/);
  assert.match(sum.text, /防火巡查 2 笔（异常留痕 1 笔）/);
  assert.match(sum.text, /防火检查 1 次/);
  assert.match(sum.text, /灭火器 2 具，本月检查 1 具，未检 1 具/);
  assert.match(sum.text, /隐患：本月新登记 1 条、复查销案 1 条；⚠ 未销案 1 条/);
  assert.match(sum.text, /全员消防培训 2026-09-05（5 人）/);
  assert.match(sum.text, /不替代法定检查与许可/);
  assert.match(sum.text, /生成：防火单 · 2026-09/);
  assert.equal(monthlySummary(s, '2026-09', T).text, sum.text);
  const aug = monthlySummary(s, '2026-08', T);
  assert.match(aug.text, /防火巡查 0 笔/);
  assert.throws(() => monthlySummary(s, '2026-9', T), /非法月份/);
});

test('monthlySummary：报废超期点名与周期点名', () => {
  const s = baseState();
  s.place = { ...s.place, name: 'X', type: 'hotel' };
  addExtinguisher(s, { no: '1号', type: 'water', madeISO: '2020-06-01' }); // 报废日 2026-06-08 已过
  const sum = monthlySummary(s, '2026-09', T);
  assert.match(sum.text, /⚠ 1 具已到报废年限须停用更换/);
  assert.match(sum.text, /周期点名：全员消防培训、灭火和应急疏散演练/); // hotel 均从未开展
});

test('inspectHtml：单文件离线可用（无外部资源），七段+签字栏+转义', () => {
  const s = demoMonth();
  s.place.name = '城南<路>家常菜';
  s.place.publicPlace = true;
  s.place.precheck = { status: 'licensed', licenseNo: '许041', licensedISO: '2023-01-05' };
  s.place.mixedWithHome = true;
  s.place.homeSeparated = true;
  const html = inspectHtml(s, T, s.settings);
  assert.ok(!/src=["']http/.test(html));
  assert.ok(!/href=["']http/.test(html));
  assert.match(html, /场所消防迎检自证包 · 城南&lt;路&gt;家常菜/);
  assert.match(html, /场所建档与营业前消防安全检查/);
  assert.match(html, /灭火器台账与月检/);
  assert.match(html, /防火巡查记录/);
  assert.match(html, /防火检查（每月一次八查）/);
  assert.match(html, /火灾隐患整改闭环/);
  assert.match(html, /培训、演练与年度检测/);
  assert.match(html, /账本体检/);
  assert.match(html, /消防安全责任人（签字\/盖章）/);
  assert.match(html, /许041/);
  assert.match(html, /已到报废年限须停用更换|（临期）/);
  assert.match(html, /未销案<\/strong>/);
  assert.match(html, /后门被货箱挡，已搬空/);
});

test('inspectHtml：空台账渲染不崩溃，无巡查/无器材文案兜底', () => {
  const s = baseState();
  const html = inspectHtml(s, T, s.settings);
  assert.match(html, /近 30 天无巡查记录/);
  assert.match(html, /未登记灭火器/);
  assert.ok(!/src=["']http/.test(html));
});

test('hazardSheetHtml：单条隐患的告知-要求-复查-签字；未销案复查栏留白', () => {
  const s = baseState();
  s.place = { ...s.place, name: '老王家常菜', manager: '王建国' };
  addHazard(s, { dateISO: '2026-09-01', source: 'notice119', docNo: 'X消检字〔2026〕0035', location: '后门出口', desc: '出口堆放杂物', dueISO: '2026-09-08', owner: '王建国', note: '当日清空' });
  const html = hazardSheetHtml(s, 'hz-1', T);
  assert.ok(!/src=["']http/.test(html));
  assert.match(html, /火灾隐患整改单/);
  assert.match(html, /X消检字〔2026〕0035/);
  assert.match(html, /出口堆放杂物/);
  assert.match(html, /2026-09-08/);
  assert.match(html, /当日清空/);
  assert.match(html, /（复查后填写：复查日期、复查结论、复查人）/);
  assert.match(html, /整改责任人（签字）/);
  assert.throws(() => hazardSheetHtml(s, 'hz-9', T), /不存在/);
  // 已销案：复查栏带结论
  closeHazard(s, 'hz-1', { closedISO: T, verifyNote: '复查合格' });
  assert.match(hazardSheetHtml(s, 'hz-1', T), /2026-09-06 复查合格：复查合格/);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = demoMonth();
  s.place.manager = '王建国';
  const round = importBundle(exportBundle(s));
  assert.ok(round.ok);
  assert.deepEqual(round.state.place, s.place);
  assert.deepEqual(round.state.extinguishers, s.extinguishers);
  assert.deepEqual(round.state.extChecks, s.extChecks);
  assert.deepEqual(round.state.patrols, s.patrols);
  assert.deepEqual(round.state.monthChecks, s.monthChecks);
  assert.deepEqual(round.state.hazards, s.hazards);
  assert.deepEqual(round.state.trainings, s.trainings);
});

test('importBundle：非 JSON / 错误应用 / 坏结构 / 高版本一律整体拒绝', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.match(importBundle('not json').error, /JSON/);
  const bad = importBundle(JSON.stringify({ app: 'parcelproof', version: 1, state: {} }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是防火单/);
  const incomplete = importBundle(JSON.stringify({
    app: 'fireproof', version: STATE_VERSION,
    state: { place: {}, extinguishers: [], extChecks: [], patrols: [], monthChecks: [], hazards: 'nope', trainings: [], settings: {} },
  }));
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /结构不完整/);
  const future = importBundle(JSON.stringify({
    app: 'fireproof', version: STATE_VERSION + 1,
    state: { place: {}, extinguishers: [], extChecks: [], patrols: [], monthChecks: [], hazards: [], trainings: [], settings: {} },
  }));
  assert.equal(future.ok, false);
  assert.match(future.error, /高于当前支持版本/);
});

// ---------------------------------------------------------------------------
// 杂项与回归
// ---------------------------------------------------------------------------

test('todayISO 返回 ISO 字符串', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('extClocks：年→天为 365 天参数化近似，出证口径注明属地与技术标准永远赢', () => {
  // 闰年 2/29 出厂不崩
  const leap = extClocks({ type: 'powder', madeISO: '2020-02-29', lastServiceISO: null }, T);
  assert.equal(leap.scrap.dueISO, addDays('2020-02-29', 10 * 365));
});

test('openHazards：空台账返回空数组，hazardRisk 全零', () => {
  assert.deepEqual(openHazards(baseState(), T), []);
  assert.deepEqual(hazardRisk(baseState(), T), { open: 0, noticeOpen: 0, overdue: 0, noticeOverdue: 0 });
});

test('healthCheck：自定义参数生效（gapDays=1、checkDays=15、extCheckDays 覆盖自动口径）', () => {
  const s = baseState();
  s.place = { ...s.place, name: 'X', type: 'hotel' };
  addExtinguisher(s, { type: 'powder', madeISO: '2020-01-01' });
  addExtCheck(s, { extId: 'ex-1', dateISO: '2026-08-20' }); // 17 天前
  addPatrol(s, { dateISO: T, slot: 'open' });               // 当日在巡
  addMonthlyCheck(s, { dateISO: '2026-08-20' });            // 17 天前
  addTraining(s, { dateISO: T, kind: 'training' });
  addTraining(s, { dateISO: T, kind: 'drill' });
  const strict = healthCheck(s, T, { gapDays: 1, checkDays: 15, extCheckDays: 15 });
  const byKey = Object.fromEntries(strict.items.map((i) => [i.key, i.level]));
  assert.equal(byKey.patrol, 'ok');       // 断更 0 天
  assert.equal(byKey.monthcheck, 'bad');  // 15 天周期已超 2 天
  assert.equal(byKey.extcheck, 'bad');    // 15 天口径超 2 天 → bad
  assert.equal(strict.items.find((i) => i.key === 'extcheck').label, '灭火器月检（15 天）');
});

test('dutyBoard：人员密集场所培训周期展示 6 个月口径', () => {
  const s = baseState();
  addTraining(s, { dateISO: '2026-06-10', kind: 'training' }); // +180 → 2026-12-07 ok
  const board = dutyBoard(s, { type: 'catering' }, T);
  const tr = board.find((d) => d.kind === 'training'); // drill 从未开展排在最前，取培训行断言
  assert.equal(tr.months, 6);
  assert.equal(tr.level, 'ok');
});
