/**
 * tests/core.test.mjs — 托安单 TotSafe 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addMonthsExact, daysUntil, monthKey, escapeHtml,
  CLASS_KINDS, STAFF_ROLES, QUAL_REQUIRED, ORG_DOCS, DUTY_KINDS, CHANGE_KINDS,
  HEALTH_SOURCES, DAYCHECK_SEGMENTS,
  DEFAULT_DOC_WARN_DAYS, DEFAULT_HEALTH_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS, DEFAULT_LEASE_WARN_DAYS,
  docState, orgDocBoard,
  addStaff, setStaffActive, activeStaff, staffHealthState, staffQualState, staffGateState,
  addKid, setKidInCare, kidsInCare, kidDocGaps, classLoad, ratioCheck,
  daycheckItemsFor, recordDaycheck, daycheckStatusFor, lastDaycheck,
  addHealthEvent, notifyHealthEvent, reportHealthEvent, returnHealthEvent, openHealthEvents,
  addHazard, fixHazard, closeHazard, openHazards,
  openGate, addDayPass, removeDayPass,
  addChange, fileChange, openChanges,
  setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary, inspectHtml, dayPassHtml, trustHtml, trustText,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';
import { emptyState } from '../app/js/store.js';

const T = '2026-09-08'; // 测试锚定日期（周二），不依赖墙钟

function freshState() {
  return emptyState();
}

/** 一个全绿的可送托状态：备案+三证远期+供餐，5 名员工健康证远期，15 名幼儿查验齐全，今日晨午检已落 */
function readyState() {
  const s = freshState();
  s.org = {
    ...s.org,
    name: '晨曦托育园', filedISO: '2026-01-01',
    meals: true,
    docs: { fire: '2027-01-01', food: '2028-01-01', lease: '2028-06-01' },
    principal: '苏晴禾',
  };
  s.a = addStaff(s, { name: '周暖晴', role: 'carer', healthValidISO: '2027-01-01' });
  s.b = addStaff(s, { name: '罗知夏', role: 'carer', healthValidISO: '2027-01-01' });
  s.c = addStaff(s, { name: '江眠', role: 'carer', healthValidISO: '2027-01-01' });
  s.q = addStaff(s, { name: '齐茉', role: 'health', healthValidISO: '2027-01-01', qualName: '保健员培训合格证', qualValidISO: '2027-01-01' });
  s.g = addStaff(s, { name: '石铁山', role: 'guard', healthValidISO: '2027-01-01', qualName: '保安员证', qualValidISO: '2027-01-01' });
  for (const [name, kind] of [['小满', 'infant'], ['年糕', 'infant'], ['糖糖', 'infant'],
    ['北北', 'small'], ['豆豆', 'small'], ['苗苗', 'small'], ['多多', 'small'], ['安安', 'small'],
    ['核桃', 'big'], ['朵朵', 'big'], ['乐乐', 'big'], ['西西', 'big'], ['果果', 'big'], ['壮壮', 'big'], ['一一', 'big']]) {
    addKid(s, { name, classKind: kind, vaccineOK: true, entryExamISO: '2026-08-01' });
  }
  for (const seg of ['morning', 'noon']) {
    const items = daycheckItemsFor(s, seg);
    recordDaycheck(s, {
      dateISO: T, segment: seg,
      results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])),
    });
  }
  for (const kind of Object.keys(DUTY_KINDS)) {
    setDutyDone(s, kind, '2026-08-25');
  }
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

test('口径基线：四班型红线（上限 10/15/20/18、配比 1:3/1:5/1:7）、五类岗位、七类义务', () => {
  assert.equal(CLASS_KINDS.infant.max, 10);
  assert.equal(CLASS_KINDS.infant.ratio, 3);
  assert.equal(CLASS_KINDS.small.max, 15);
  assert.equal(CLASS_KINDS.small.ratio, 5);
  assert.equal(CLASS_KINDS.big.max, 20);
  assert.equal(CLASS_KINDS.big.ratio, 7);
  assert.equal(CLASS_KINDS.mixed.max, 18);   // 设置标准第 19 条：混合编班每班不超过 18 人
  assert.equal(CLASS_KINDS.mixed.ratio, 5);  // 配比未定，参数化从严 1:5
  assert.ok(CLASS_KINDS.infant.basis.includes('19/20'));
  assert.deepEqual(Object.keys(STAFF_ROLES).sort(), ['carer', 'cook', 'guard', 'health', 'principal']);
  assert.ok(QUAL_REQUIRED.guard.includes('保安员证'));
  assert.ok(QUAL_REQUIRED.health.includes('妇幼保健'));
  assert.ok(!QUAL_REQUIRED.carer, '保育人员无强制资质证（健康证全员必配）');
  assert.deepEqual(Object.keys(ORG_DOCS).sort(), ['fire', 'food', 'lease']);
  assert.equal(ORG_DOCS.fire.cycleMonths, 12);  // WS/T 821 4.1.4 年度口径
  assert.deepEqual(Object.keys(DUTY_KINDS).sort(),
    ['annual', 'drill', 'fireequip', 'facility', 'insurance', 'kidreport', 'training'].sort());
  assert.equal(DUTY_KINDS.fireequip.cycleDays, 30);  // WS/T 821 9.3.2 每月
  assert.ok(DUTY_KINDS.annual.basis.includes('38'), '年度报告锚管理规范第 38 条');
  assert.deepEqual(Object.keys(CHANGE_KINDS).sort(), ['name', 'other', 'person', 'quit', 'scale', 'site'].sort());
  assert.deepEqual(Object.keys(HEALTH_SOURCES).sort(), ['morning', 'noon', 'parent', 'selfcheck'].sort());
  assert.deepEqual(Object.keys(DAYCHECK_SEGMENTS).sort(), ['morning', 'noon']);
  assert.equal(DEFAULT_DOC_WARN_DAYS, 30);
  assert.equal(DEFAULT_HEALTH_WARN_DAYS, 45);
  assert.equal(DEFAULT_DUTY_WARN_DAYS, 30);
  assert.equal(DEFAULT_LEASE_WARN_DAYS, 60);
  assert.equal(STATE_VERSION, 1);
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

// ---------------------------------------------------------------------------
// 机构三证钟（管理规范第 4 条；设置标准第 11 条；WS/T 821 4.1.4）
// ---------------------------------------------------------------------------

test('docState 四态：unset 红 / overdue 红 / warn 黄 / ok 绿，文案带依据锚', () => {
  const unset = docState({ label: '消防安全检查合格证明', basis: 'b', validISO: '' }, T);
  assert.equal(unset.level, 'unset');
  const over = docState({ label: 'x', basis: 'b', validISO: '2026-09-01' }, T);
  assert.equal(over.level, 'overdue');
  const warn = docState({ label: 'x', basis: 'b', validISO: '2026-09-25' }, T);
  assert.equal(warn.level, 'warn');
  const ok = docState({ label: 'x', basis: 'b', validISO: '2027-09-08' }, T);
  assert.equal(ok.level, 'ok');
});

test('orgDocBoard：未供餐时食品证不适用（none）；供餐后三证齐发', () => {
  const s = freshState();
  s.org.docs = { fire: '2027-01-01', food: '', lease: '2028-06-01' };
  let board = orgDocBoard(s, T);
  assert.equal(board.find((d) => d.key === 'food').level, 'none');
  assert.equal(board.find((d) => d.key === 'fire').level, 'ok');
  s.org.meals = true;
  board = orgDocBoard(s, T);
  assert.equal(board.find((d) => d.key === 'food').level, 'unset', '供餐后食品证未登记=红');
});

test('租约钟用独立的 60 天提醒窗口（settings.leaseWarnDays）', () => {
  const s = freshState();
  s.org.docs = { fire: '2027-01-01', food: '2028-01-01', lease: '2026-10-01' }; // 剩 23 天
  const board = orgDocBoard(s, T);
  assert.equal(board.find((d) => d.key === 'lease').level, 'warn', '23 天 < 60 天租约提醒窗口');
  s.settings.leaseWarnDays = 14;
  assert.equal(orgDocBoard(s, T).find((d) => d.key === 'lease').level, 'ok');
});

// ---------------------------------------------------------------------------
// 人员名册与健康证钟（76 号令第 12/14 条；设置标准第 18 条）
// ---------------------------------------------------------------------------

test('addStaff：姓名必填、岗位合法、同姓名同岗位拒绝；setStaffActive 停用/恢复', () => {
  const s = freshState();
  assert.throws(() => addStaff(s, { name: '', role: 'carer' }));
  assert.throws(() => addStaff(s, { name: 'x', role: 'pilot' }));
  const a = addStaff(s, { name: '周暖晴', role: 'carer', healthValidISO: '2027-01-01' });
  assert.throws(() => addStaff(s, { name: '周暖晴', role: 'carer' }));
  assert.doesNotThrow(() => addStaff(s, { name: '周暖晴', role: 'health' }), '同姓名不同岗位可入册');
  setStaffActive(s, a.id, false);
  assert.equal(activeStaff(s).length, 1);
});

test('staffHealthState 四态：unset 红 / overdue 红（76 号令第 14 条）/ warn 黄 / ok', () => {
  const unset = staffHealthState({ name: '甲', healthValidISO: '' }, T);
  assert.equal(unset.level, 'unset');
  assert.ok(unset.detail.includes('76 号令第 14 条'));
  const over = staffHealthState({ name: '乙', healthValidISO: '2026-09-01' }, T);
  assert.equal(over.level, 'overdue');
  assert.ok(over.detail.includes('第 19 条'), '过期文案应带聘用处罚情形锚');
  const warn = staffHealthState({ name: '丙', healthValidISO: '2026-10-01' }, T);
  assert.equal(warn.level, 'warn');
  const ok = staffHealthState({ name: '丁', healthValidISO: '2027-01-01' }, T);
  assert.equal(ok.level, 'ok');
});

test('staffQualState：负责人/保健/保安为硬钟，保育/炊事不适用（none）', () => {
  const unset = staffQualState({ name: '苏', role: 'principal', qualValidISO: '' }, T);
  assert.equal(unset.level, 'unset');
  const ok = staffQualState({ name: '齐', role: 'health', qualName: '保健员证', qualValidISO: '2027-01-01' }, T);
  assert.equal(ok.level, 'ok');
  const none = staffQualState({ name: '周', role: 'carer' }, T);
  assert.equal(none.level, 'none');
});

test('staffGateState 取健康证与资质的最严', () => {
  const s = freshState();
  const st = addStaff(s, { name: '石铁山', role: 'guard', healthValidISO: '2027-01-01' });
  assert.equal(staffGateState(st, T).level, 'unset', '健康证在期但保安员证未登记=unset');
  st.qualValidISO = '2027-01-01';
  assert.equal(staffGateState(st, T).level, 'ok');
});

// ---------------------------------------------------------------------------
// 婴幼儿名册与收托查验（管理规范第 11 条；76 号令第 15 条(六)）
// ---------------------------------------------------------------------------

test('addKid：姓名/班型必填、在园同名同班拒绝；离园后可重名收托', () => {
  const s = freshState();
  assert.throws(() => addKid(s, { name: '', classKind: 'small' }));
  assert.throws(() => addKid(s, { name: '小满', classKind: 'primary' }));
  const k = addKid(s, { name: '小满', classKind: 'infant', vaccineOK: true, entryExamISO: '2026-08-01' });
  assert.throws(() => addKid(s, { name: '小满', classKind: 'infant', vaccineOK: true }));
  setKidInCare(s, k.id, false, T);
  assert.doesNotThrow(() => addKid(s, { name: '小满', classKind: 'infant', vaccineOK: true }), '离园后同名可再次收托');
});

test('kidDocGaps：接种证/入托体检未齐即挂缺口；离园幼儿不计入', () => {
  const s = freshState();
  const a = addKid(s, { name: '壮壮', classKind: 'big', vaccineOK: false, entryExamISO: '2026-08-01' });
  addKid(s, { name: '朵朵', classKind: 'big', vaccineOK: true, entryExamISO: '' });
  addKid(s, { name: '乐乐', classKind: 'big', vaccineOK: true, entryExamISO: '2026-08-01' });
  assert.equal(kidDocGaps(s).length, 2);
  setKidInCare(s, a.id, false, T);
  assert.equal(kidDocGaps(s).length, 1);
  assert.ok(kidDocGaps(s)[0].name.includes('朵朵'));
});

// ---------------------------------------------------------------------------
// 班级配比引擎（设置标准第 19/20 条）
// ---------------------------------------------------------------------------

test('classLoad：按班型计数、ceil 出保育需求、超上限点名', () => {
  const s = freshState();
  for (let i = 0; i < 4; i++) addKid(s, { name: `乳${i}`, classKind: 'infant', vaccineOK: true, entryExamISO: '2026-08-01' });
  for (let i = 0; i < 7; i++) addKid(s, { name: `小${i}`, classKind: 'small', vaccineOK: true, entryExamISO: '2026-08-01' });
  const loads = classLoad(s);
  assert.equal(loads.infant.carersNeeded, 2, '乳儿班 4 人 ÷ 1:3 → ceil=2');
  assert.equal(loads.small.carersNeeded, 2, '托小班 7 人 ÷ 1:5 → ceil=2');
  assert.equal(loads.big.kids, 0);
  assert.equal(loads.big.carersNeeded, 0);
  assert.equal(loads.infant.overMax, false);
});

test('ratioCheck：配比不足给法条理由；满额通过；超收托上限独立拦截', () => {
  const s = freshState();
  for (let i = 0; i < 3; i++) addKid(s, { name: `乳${i}`, classKind: 'infant', vaccineOK: true, entryExamISO: '2026-08-01' });
  for (let i = 0; i < 5; i++) addKid(s, { name: `小${i}`, classKind: 'small', vaccineOK: true, entryExamISO: '2026-08-01' });
  for (let i = 0; i < 7; i++) addKid(s, { name: `大${i}`, classKind: 'big', vaccineOK: true, entryExamISO: '2026-08-01' });
  // 3×1:3=1 + 5×1:5=1 + 7×1:7=1 → 3 名保育
  assert.equal(ratioCheck(s, 2).ok, false);
  const short = ratioCheck(s, 2);
  assert.ok(short.reasons[0].includes('第 20 条'));
  assert.equal(ratioCheck(s, 3).ok, true);
  assert.equal(ratioCheck(s, 3).carersNeeded, 3);
  // 超上限：乳儿班加到 11 人（max=10），配比足额只测上限拦截
  for (let i = 3; i < 11; i++) addKid(s, { name: `乳${i}`, classKind: 'infant', vaccineOK: true, entryExamISO: '2026-08-01' });
  const over = ratioCheck(s, 20);
  assert.equal(over.ok, false);
  assert.ok(over.reasons.some((r) => r.includes('上限 10 人') && r.includes('第 19 条')));
});

// ---------------------------------------------------------------------------
// 每日晨午检卡（管理规范第 24 条；WS/T 821 7.2.3）
// ---------------------------------------------------------------------------

test('daycheckItemsFor：供餐开关驱动食谱条目、乳儿班驱动母乳冰箱条目', () => {
  const s = freshState();
  s.org.meals = false;
  const m1 = daycheckItemsFor(s, 'morning');
  assert.ok(!m1.some((i) => i.key === 'morning:menu'));
  s.org.meals = true;
  assert.ok(daycheckItemsFor(s, 'morning').some((i) => i.key === 'morning:menu'));
  assert.ok(!daycheckItemsFor(s, 'noon').some((i) => i.key === 'noon:milk'));
  addKid(s, { name: '小满', classKind: 'infant', vaccineOK: true, entryExamISO: '2026-08-01' });
  assert.ok(daycheckItemsFor(s, 'noon').some((i) => i.key === 'noon:milk'), '有乳儿班才有母乳冰箱条目');
  assert.throws(() => daycheckItemsFor(s, 'evening'));
});

test('recordDaycheck：同日同段唯一、异常必写处置、管理异常自动转隐患', () => {
  const s = freshState();
  s.org.meals = true;
  const items = daycheckItemsFor(s, 'morning');
  recordDaycheck(s, { dateISO: T, segment: 'morning', results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])) });
  assert.throws(() => recordDaycheck(s, { dateISO: T, segment: 'morning', results: {} }), /同日同段唯一/);
  const s2 = freshState();
  const items2 = daycheckItemsFor(s2, 'morning');
  assert.throws(() => recordDaycheck(s2, {
    dateISO: T, segment: 'morning',
    results: Object.fromEntries(items2.map((it) => [it.key, it.key === 'morning:sanitize' ? { ok: false, note: '' } : { ok: true, note: '' }])),
  }), /处置说明/);
  recordDaycheck(s2, {
    dateISO: T, segment: 'morning',
    results: Object.fromEntries(items2.map((it) => [it.key, it.key === 'morning:sanitize' ? { ok: false, note: '补做后复查' } : { ok: true, note: '' }])),
  });
  assert.equal(s2.daychecks[0].status, 'issue');
  assert.equal(s2.hazards.length, 1, '管理类异常自动转隐患');
  assert.ok(s2.hazards[0].desc.includes('消毒'));
  assert.equal(daycheckStatusFor(s2, T).morning.status, 'issue');
  assert.equal(lastDaycheck(s2).segment, 'morning');
});

test('recordDaycheck：晨检异常幼儿自动转健康事件（open 态）', () => {
  const s = freshState();
  const items = daycheckItemsFor(s, 'morning');
  recordDaycheck(s, {
    dateISO: T, segment: 'morning',
    results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])),
    abnormalKids: [{ kidName: '苗苗', symptom: '低热 37.8℃' }],
  });
  assert.equal(s.healthEvents.length, 1);
  assert.equal(s.healthEvents[0].status, 'open');
  assert.equal(s.healthEvents[0].kidName, '苗苗');
});

// ---------------------------------------------------------------------------
// 健康事件状态机（open → notified → returned；76 号令第 18 条）
// ---------------------------------------------------------------------------

test('addHealthEvent：幼儿姓名必填；非法来源拒绝', () => {
  const s = freshState();
  assert.throws(() => addHealthEvent(s, { dateISO: T, kidName: '' }));
  assert.throws(() => addHealthEvent(s, { dateISO: T, kidName: '苗苗', source: 'police' }));
  addHealthEvent(s, { dateISO: T, kidName: '苗苗', symptom: '低热' });
  assert.equal(s.healthEvents[0].status, 'open');
});

test('notifyHealthEvent：处置意见必填、日期不得早于发现日；跳级返园拒绝', () => {
  const s = freshState();
  const he = addHealthEvent(s, { dateISO: T, kidName: '苗苗' });
  assert.throws(() => notifyHealthEvent(s, he.id, { notifyISO: '2026-09-07', action: 'x' }), /早于发现日/);
  assert.throws(() => notifyHealthEvent(s, he.id, { notifyISO: T, action: '' }), /处置意见必填/);
  notifyHealthEvent(s, he.id, { notifyISO: T, action: '家长接回就医' });
  assert.equal(he.status, 'notified');
  assert.throws(() => returnHealthEvent(s, he.id, { returnISO: T, returnProof: '' }), /返园凭证必填/);
  returnHealthEvent(s, he.id, { returnISO: '2026-09-10', returnProof: '复课证明' });
  assert.equal(he.status, 'returned');
});

test('reportHealthEvent：疑似传染病报告留痕，日期不得早于发现日', () => {
  const s = freshState();
  const he = addHealthEvent(s, { dateISO: T, kidName: '多多', reportable: true });
  assert.throws(() => reportHealthEvent(s, he.id, '2026-09-07'));
  reportHealthEvent(s, he.id, T);
  assert.equal(he.reportISO, T);
});

test('openHealthEvents：open 在前、returned 不入列', () => {
  const s = freshState();
  const a = addHealthEvent(s, { dateISO: '2026-09-07', kidName: '甲' });
  addHealthEvent(s, { dateISO: T, kidName: '乙', notifyISO: T, action: '接回' });
  notifyHealthEvent(s, a.id, { notifyISO: '2026-09-07', action: '留观' });
  assert.equal(openHealthEvents(s).length, 2);
  returnHealthEvent(s, a.id, { returnISO: T, returnProof: '证明' });
  assert.equal(openHealthEvents(s).length, 1);
  assert.equal(openHealthEvents(s)[0].kidName, '乙');
});

// ---------------------------------------------------------------------------
// 安全隐患状态机（open → fixed → closed）
// ---------------------------------------------------------------------------

test('隐患三态与跳级拒绝', () => {
  const s = freshState();
  const hz = addHazard(s, { dateISO: T, source: 'inspection', desc: '护栏松动' });
  assert.throws(() => closeHazard(s, hz.id, { verifyISO: T, verifiedBy: '园长' }), /先登记整改/);
  assert.throws(() => fixHazard(s, hz.id, { actionISO: '2026-09-07', action: 'x' }), /早于发现日/);
  fixHazard(s, hz.id, { actionISO: T, action: '加固并全园巡检' });
  assert.throws(() => fixHazard(s, hz.id, { actionISO: T, action: '重复' }), /只有未整改/);
  closeHazard(s, hz.id, { verifyISO: T, verifiedBy: '园长' });
  assert.equal(openHazards(s).length, 0);
  assert.throws(() => addHazard(s, { dateISO: T, desc: '' }), /描述必填/);
});

// ---------------------------------------------------------------------------
// 送托六道闸与送托单（产品的门禁）
// ---------------------------------------------------------------------------

test('openGate 六道闸逐道拦截：备案/证照/配比/证书/晨检/隐患/健康事件', () => {
  const s = freshState();
  // 闸1：备案未登记
  let g = openGate(s, { dateISO: T, carerIds: [], allStaffIds: [] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('备案')));
  assert.equal(g.gates.length, 6, '六道闸');

  // 闸1：消防证明过期（年度口径）
  s.org.filedISO = '2026-01-01';
  s.org.docs = { fire: '2026-09-01', food: '2028-01-01', lease: '2028-01-01' };
  s.org.meals = true;
  g = openGate(s, { dateISO: T, carerIds: [], allStaffIds: [] });
  assert.ok(g.reasons.some((r) => r.includes('消防')), JSON.stringify(g.reasons));

  // 建全绿底座
  s.org.docs = { fire: '2027-01-01', food: '2028-01-01', lease: '2028-06-01' };
  const a = addStaff(s, { name: '周暖晴', role: 'carer', healthValidISO: '2027-01-01' });
  const b = addStaff(s, { name: '许星野', role: 'carer', healthValidISO: '2026-09-01' }); // 过期
  const c = addStaff(s, { name: '江眠', role: 'carer', healthValidISO: '2027-01-01' });
  const q = addStaff(s, { name: '齐茉', role: 'health', healthValidISO: '2027-01-01', qualName: '保健员证', qualValidISO: '2027-01-01' });
  addKid(s, { name: '小满', classKind: 'infant', vaccineOK: true, entryExamISO: '2026-08-01' });
  addKid(s, { name: '年糕', classKind: 'infant', vaccineOK: true, entryExamISO: '2026-08-01' });
  addKid(s, { name: '北北', classKind: 'small', vaccineOK: true, entryExamISO: '2026-08-01' });

  // 闸2：配比不足（乳儿班 2 人需 1 + 托小班 1 人需 1 = 2 名保育；只点 1 名）
  g = openGate(s, { dateISO: T, carerIds: [a.id], allStaffIds: [a.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('第 20 条')), JSON.stringify(g.reasons));

  // 闸3：点名含健康证过期人员
  g = openGate(s, { dateISO: T, carerIds: [a.id, c.id], allStaffIds: [a.id, b.id, c.id, q.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('许星野')), JSON.stringify(g.reasons));

  // 闸4：晨检未落
  g = openGate(s, { dateISO: T, carerIds: [a.id, c.id], allStaffIds: [a.id, c.id, q.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('晨检')), JSON.stringify(g.reasons));

  // 落晨检（含 1 名异常幼儿 → 健康事件 open → 闸6 拦截）
  const items = daycheckItemsFor(s, 'morning');
  recordDaycheck(s, {
    dateISO: T, segment: 'morning',
    results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])),
    abnormalKids: [{ kidName: '北北', symptom: '低热' }],
  });
  g = openGate(s, { dateISO: T, carerIds: [a.id, c.id], allStaffIds: [a.id, c.id, q.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('健康事件') && r.includes('北北')), JSON.stringify(g.reasons));

  // 通知处置后闸6 放行（notified 不拦截——去向已明，返园前不入班由人工管理）
  const he = s.healthEvents[0];
  notifyHealthEvent(s, he.id, { notifyISO: T, action: '家长接回就医' });
  g = openGate(s, { dateISO: T, carerIds: [a.id, c.id], allStaffIds: [a.id, c.id, q.id] });
  assert.equal(g.ok, true, JSON.stringify(g.reasons));
  assert.equal(g.gates.filter((x) => x.ok).length, 6);

  // 闸5：隐患拦截
  const hz = addHazard(s, { dateISO: T, source: 'selfcheck', desc: '应急灯失效' });
  g = openGate(s, { dateISO: T, carerIds: [a.id, c.id], allStaffIds: [a.id, c.id, q.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('应急灯失效')));
  fixHazard(s, hz.id, { actionISO: T, action: '更换应急灯' });
  closeHazard(s, hz.id, { verifyISO: T, verifiedBy: '园长' });
  assert.equal(openGate(s, { dateISO: T, carerIds: [a.id, c.id], allStaffIds: [a.id, c.id, q.id] }).ok, true);
});

test('addDayPass：同日唯一、落账存当日快照；removeDayPass 自救', () => {
  const s = readyState();
  const pass = addDayPass(s, { dateISO: T, carerIds: [s.a.id, s.b.id, s.c.id], allStaffIds: [s.a.id, s.b.id, s.c.id, s.q.id, s.g.id] });
  assert.equal(pass.snapshot.kidCount, 15);
  assert.equal(pass.snapshot.docs.fire, '2027-01-01');
  assert.equal(pass.snapshot.loads.infant.kids, 3);
  assert.equal(pass.snapshot.loads.infant.carersNeeded, 1);
  assert.ok(pass.snapshot.healthCerts['周暖晴']);
  assert.throws(() => addDayPass(s, { dateISO: T, carerIds: [s.a.id, s.b.id, s.c.id] }), /同日唯一/);
  removeDayPass(s, pass.id);
  assert.equal(s.daypasses.length, 0);
  assert.throws(() => removeDayPass(s, 'dp-99'), /不存在/);
});

// ---------------------------------------------------------------------------
// 变更备案 / 周期义务
// ---------------------------------------------------------------------------

test('变更备案：登记→办结；未办结列表；日期校验', () => {
  const s = freshState();
  assert.throws(() => addChange(s, { dateISO: T, kind: 'haircut', detail: 'x' }));
  const cg = addChange(s, { dateISO: T, kind: 'scale', detail: '60→80 人' });
  assert.equal(openChanges(s).length, 1);
  assert.throws(() => fileChange(s, cg.id, '2026-09-07'), /早于变更发生日/);
  fileChange(s, cg.id, T);
  assert.equal(openChanges(s).length, 0);
});

test('周期义务：打勾滚动；dutyBoard 未登记以 never 入板且红灯在前', () => {
  const s = freshState();
  setDutyDone(s, 'fireequip', '2026-08-20');
  assert.equal(dutyState({ kind: 'fireequip', lastDoneISO: '2026-08-20' }, T).level, 'due', '剩 12 天');
  assert.equal(dutyState({ kind: 'fireequip', lastDoneISO: '2026-07-01' }, T).level, 'overdue');
  const board = dutyBoard(s, T);
  assert.equal(board.length, Object.keys(DUTY_KINDS).length);
  assert.equal(board[0].level, 'never', '未登记义务排最前');
  assert.throws(() => setDutyDone(s, 'travel', T));
});

// ---------------------------------------------------------------------------
// 体检 / 月报 / 出证
// ---------------------------------------------------------------------------

test('healthCheck 十项：全绿底座应≥9 项绿；缺口逐项点名', () => {
  const s = readyState();
  const hc = healthCheck(s, T);
  assert.equal(hc.items.length, 10);
  assert.ok(hc.score >= 85, `全绿底座得分应高：${hc.score}`);
  // 制造缺口：接种证缺 1 人 → 收托查验红灯
  const kid = kidsInCare(s).find((k) => k.classKind === 'big');
  kid.vaccineOK = false;
  const hc2 = healthCheck(s, T);
  assert.equal(hc2.score, hc.score - 12);
  const ratioItem = hc2.items.find((i) => i.key === 'ratio');
  assert.equal(ratioItem.level, 'bad');
  assert.ok(ratioItem.detail.includes(kid.name));
});

test('monthlySummary：拦截计数、点名段、法条尾注含托育服务法在审口径', () => {
  const s = readyState();
  addDayPass(s, { dateISO: T, carerIds: [s.a.id, s.b.id, s.c.id], allStaffIds: [s.a.id, s.b.id, s.c.id, s.q.id, s.g.id] });
  s.traces.push({ type: 'daypass-blocked', at: `${T}T01:00:00.000Z`, dateISO: T, reasons: 'x' });
  const sum = monthlySummary(s, '2026-09', T);
  assert.equal(sum.passes, 1);
  assert.equal(sum.blocked, 1);
  assert.ok(sum.text.includes('送托单 1 张'));
  assert.ok(sum.text.includes('拦截不合规开园 1 次'));
  assert.ok(sum.text.includes('托育服务法（草案）'));
  assert.ok(sum.text.includes('教育部令第 76 号'));
  assert.ok(sum.text.includes('晨午检落卡 2 段'));
  assert.throws(() => monthlySummary(s, '2026-9', T));
});

test('inspectHtml：十段结构与脱敏底线', () => {
  const s = readyState();
  const html = inspectHtml(s, T);
  for (const k of ['迎检自证包', '备案', '工作人员名册', '师幼配比', '收托查验', '晨午检', '健康事件闭环', '变更备案台账', '周期义务账']) {
    assert.ok(html.includes(k), `应含「${k}」段`);
  }
  assert.ok(html.includes('托育服务法（草案）'));
});

test('dayPassHtml：含六道闸核对与在岗人员健康证快照', () => {
  const s = readyState();
  const pass = addDayPass(s, { dateISO: T, carerIds: [s.a.id, s.b.id, s.c.id], allStaffIds: [s.a.id, s.b.id, s.c.id, s.q.id, s.g.id] });
  const html = dayPassHtml(s, pass.id, T);
  assert.ok(html.includes('六道闸'));
  assert.ok(html.includes('周暖晴'));
  assert.ok(html.includes('2027-01-01'));
  assert.throws(() => dayPassHtml(s, 'dp-404', T));
});

test('trustHtml/trustText：脱敏公示（不出幼儿姓名），含配比与健康证比例', () => {
  const s = readyState();
  const html = trustHtml(s, T);
  assert.ok(html.includes('家长信任公示'));
  assert.ok(html.includes('健康证在期'));
  assert.ok(!html.includes('壮壮') && !html.includes('小满'), '信任公示不得出现幼儿姓名');
  const text = trustText(s, T);
  assert.ok(text.includes('员工健康证在期'));
  assert.ok(!text.includes('壮壮'));
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle：错名拒绝、缺结构拒绝、合法全量接受', () => {
  const s = readyState();
  const bundle = exportBundle(s);
  const parsed = JSON.parse(bundle);
  assert.equal(parsed.app, 'totsafe');
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle(JSON.stringify({ ...parsed, app: 'venuepass' })).ok, false);
  assert.equal(importBundle(JSON.stringify({ ...parsed, version: 99 })).ok, false);
  assert.equal(importBundle(JSON.stringify({ ...parsed, state: { ...parsed.state, staff: 'x' } })).ok, false);
  const res = importBundle(bundle);
  assert.equal(res.ok, true);
  assert.equal(res.state.staff.length, s.staff.length);
});
