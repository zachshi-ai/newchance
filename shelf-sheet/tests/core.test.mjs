/**
 * tests/core.test.mjs — 药清账 ShelfSheet 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, escapeHtml,
  STORAGE_KINDS, REFUSAL_REASONS, OUT_WAYS, QUAR_ACTIONS, DUTY_KINDS,
  DEFAULT_WARN_DAYS, DEFAULT_RED_DAYS, DEFAULT_CARE_DAYS, DEFAULT_GAP_DAYS, CERT_WARN_DAYS,
  certClock, licenseState,
  addDrug, removeDrug, addBatch, outBatch, removeOut, resolveQuarantine, openQuarantines,
  batchView, shelfBoard,
  addReading, removeReading, handleReading, openExceededReadings, readingGaps, lastReadingISO,
  addRefusal, monthlyRefusals,
  addCare, careState,
  setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary, clearanceHtml, inspectHtml,
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

test('addDays 跨月/跨年收敛；daysUntil 跨年正确', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysUntil('2026-12-31', T), 116);
  assert.equal(daysUntil('2026-09-06', T), 0);
  assert.equal(monthKey('2026-09-06'), '2026-09');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('escapeHtml 全转义（XSS 防线）', () => {
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

test('口径常量基线：储藏三档/拒售原因/出库方式/隔离处置/义务三类与默认参数', () => {
  assert.deepEqual(Object.keys(STORAGE_KINDS), ['normal', 'cool', 'cold']);
  assert.deepEqual(Object.keys(REFUSAL_REASONS).sort(), ['gift', 'no-rx', 'other', 'rx-bad']);
  assert.deepEqual(Object.keys(OUT_WAYS).sort(), ['destroy', 'quarantine', 'recall', 'return', 'sold']);
  assert.deepEqual(Object.keys(QUAR_ACTIONS).sort(), ['destroy', 'other', 'return']);
  assert.deepEqual(Object.keys(DUTY_KINDS), ['health', 'calib', 'training']);
  assert.equal(DEFAULT_WARN_DAYS, 180);
  assert.equal(DEFAULT_RED_DAYS, 90);
  assert.equal(DEFAULT_CARE_DAYS, 30);
  assert.equal(DEFAULT_GAP_DAYS, 3);
  assert.equal(CERT_WARN_DAYS, 180);
});

// ---------------------------------------------------------------------------
// 证件钟（许可证 5 年 / 药师注册证）
// ---------------------------------------------------------------------------

test('certClock 四态：unset/ok/due/overdue，过期天数归正展示', () => {
  assert.equal(certClock('', T).level, 'unset');
  assert.equal(certClock('2028-01-01', T).level, 'ok');
  const due = certClock('2026-10-01', T); // 剩 25 天
  assert.equal(due.level, 'due');
  const over = certClock('2026-08-01', T); // 已过 36 天
  assert.equal(over.level, 'overdue');
  assert.match(over.detail, /已过期 36 天/);
  assert.doesNotMatch(over.detail, /-36/);
});

test('licenseState：unset 提示 84 号令第 17 条 5 年口径', () => {
  const u = licenseState({}, T);
  assert.equal(u.level, 'unset');
  assert.match(u.detail, /84 号令第 17 条/);
});

// ---------------------------------------------------------------------------
// 药品目录与批次
// ---------------------------------------------------------------------------

function baseState() {
  return {
    version: 1,
    pharmacy: { name: '', licenseNo: '', licenseExpiryISO: '', manager: '', phone: '', address: '', pharmacistName: '', pharmacistRegNo: '', pharmacistRegExpiryISO: '' },
    drugs: [], batches: [], outs: [], quarantines: [], readings: [],
    refusals: [], cares: [], duties: [],
    settings: { warnDays: 180, redDays: 90, careDays: 30, gapDays: 3, rhMin: 35, rhMax: 75, normalMin: 10, normalMax: 30, coolMax: 20, coldMin: 2, coldMax: 8 },
    drugSeq: 0, batchSeq: 0, outSeq: 0, quarSeq: 0, readingSeq: 0, refusalSeq: 0, careSeq: 0,
    events: [],
  };
}

const drug = (s, name = '阿莫西林胶囊') => addDrug(s, { name, spec: '0.25g×24粒', storage: 'normal' });

test('addDrug：名称必填、储藏枚举、同名同规格拒绝', () => {
  const s = baseState();
  const d = drug(s);
  assert.equal(d.id, 'dg-1');
  assert.throws(() => addDrug(s, { name: '  ' }));
  assert.throws(() => addDrug(s, { name: 'X', storage: 'fridge' }));
  assert.throws(() => addDrug(s, { name: '阿莫西林胶囊', spec: '0.25g×24粒' }));
  addDrug(s, { name: '阿莫西林胶囊', spec: '0.5g×24粒' }); // 不同规格可建档
});

test('removeDrug：有批次在档拒绝删除', () => {
  const s = baseState();
  const d = drug(s);
  const b = addBatch(s, { drugId: d.id, batchNo: 'B2401', expiryISO: '2027-06-01', qty: 10 });
  assert.throws(() => removeDrug(s, d.id), /先清批次/);
  outBatch(s, b.id, { dateISO: T, qty: 10, way: 'sold' });
  removeDrug(s, d.id); // 批次清零后可删
  assert.equal(s.drugs.length, 0);
});

test('addBatch：批号必填、数量正整数、效期合法、同批次唯一', () => {
  const s = baseState();
  const d = drug(s);
  assert.throws(() => addBatch(s, { drugId: d.id, batchNo: ' ', expiryISO: '2027-06-01', qty: 5 }), /批号必填/);
  assert.throws(() => addBatch(s, { drugId: d.id, batchNo: 'B1', expiryISO: '2027-06-01', qty: 0 }));
  assert.throws(() => addBatch(s, { drugId: d.id, batchNo: 'B1', expiryISO: '2027-6-1', qty: 5 }));
  addBatch(s, { drugId: d.id, batchNo: 'B2401', expiryISO: '2027-06-01', qty: 5 });
  assert.throws(() => addBatch(s, { drugId: d.id, batchNo: 'B2401', expiryISO: '2027-06-01', qty: 3 }), /已存在/);
  assert.throws(() => addBatch(s, { drugId: 'dg-999', batchNo: 'B1', expiryISO: '2027-06-01', qty: 1 }), /不存在/);
});

test('outBatch：超量整体拒绝、五种方式校验、隔离与召回自动生成待处置单', () => {
  const s = baseState();
  const d = drug(s);
  const b = addBatch(s, { drugId: d.id, batchNo: 'B2401', expiryISO: '2027-06-01', qty: 10 });
  assert.throws(() => outBatch(s, b.id, { dateISO: T, qty: 11, way: 'sold' }), /整体拒绝/);
  assert.throws(() => outBatch(s, b.id, { dateISO: T, qty: 1, way: 'gift' }));
  assert.throws(() => outBatch(s, b.id, { dateISO: T, qty: 0, way: 'sold' }));
  const { out: sold } = outBatch(s, b.id, { dateISO: T, qty: 3, way: 'sold' });
  assert.equal(sold.id, 'ou-1');
  assert.equal(b.qty, 7);
  const { quarantine: q1 } = outBatch(s, b.id, { dateISO: T, qty: 2, way: 'quarantine' });
  assert.equal(q1.id, 'qt-1');
  assert.equal(openQuarantines(s).length, 1);
  const { quarantine: q2 } = outBatch(s, b.id, { dateISO: T, qty: 1, way: 'recall' });
  assert.equal(q2.id, 'qt-2');
  assert.equal(b.qty, 4);
  // 售出/报损/退货不生成隔离单
  outBatch(s, b.id, { dateISO: T, qty: 1, way: 'destroy' });
  assert.equal(openQuarantines(s).length, 2);
});

test('removeOut：数量回滚；隔离单已销案则拒绝撤销', () => {
  const s = baseState();
  const d = drug(s);
  const b = addBatch(s, { drugId: d.id, batchNo: 'B1', expiryISO: '2027-06-01', qty: 10 });
  const { quarantine: q } = outBatch(s, b.id, { dateISO: T, qty: 4, way: 'quarantine' });
  assert.equal(b.qty, 6);
  assert.throws(() => resolveQuarantine(s, q.id, { closedISO: addDays(T, -1), action: 'destroy' }), /早于隔离日期/);
  resolveQuarantine(s, q.id, { closedISO: T, action: 'destroy', note: '交危废?否——过期药交属地指定回收' });
  assert.throws(() => removeOut(s, 'ou-1'), /已有处置结论/);
  assert.equal(b.qty, 6); // 未回滚
  const { out: sold } = outBatch(s, b.id, { dateISO: T, qty: 2, way: 'sold' });
  removeOut(s, sold.id);
  assert.equal(b.qty, 6); // 8-2+2-4 → 回滚后仍是 6
});

test('resolveQuarantine：重复销案拒绝、非法结论拒绝、回溯日期拒绝', () => {
  const s = baseState();
  const d = drug(s);
  const b = addBatch(s, { drugId: d.id, batchNo: 'B1', expiryISO: '2026-01-01', qty: 5 });
  const { quarantine: q } = outBatch(s, b.id, { dateISO: T, qty: 5, way: 'quarantine' });
  assert.throws(() => resolveQuarantine(s, q.id, { closedISO: T, action: 'sell' }));
  resolveQuarantine(s, q.id, { closedISO: T, action: 'return' });
  assert.throws(() => resolveQuarantine(s, q.id, { closedISO: T, action: 'destroy' }), /已处置销案/);
});

// ---------------------------------------------------------------------------
// 效期三色档（第 98/117 条劣药红线）
// ---------------------------------------------------------------------------

test('shelfBoard：四档分箱按效期升序，档位阈值吃设置覆盖', () => {
  const s = baseState();
  const d = drug(s);
  const mk = (batchNo, expiryISO, qty = 2) => addBatch(s, { drugId: d.id, batchNo, expiryISO, qty });
  mk('B-EXP', '2026-08-01');   // 已过 36 天
  mk('B-RED', '2026-11-01');   // 剩 56 天 → 红
  mk('B-WARN', '2027-01-15');  // 剩 131 天 → 黄
  mk('B-OK', '2028-01-01');    // 482 天 → 绿
  const board = shelfBoard(s, T);
  assert.deepEqual(board.expired.map((v) => v.batchNo), ['B-EXP']);
  assert.deepEqual(board.red.map((v) => v.batchNo), ['B-RED']);
  assert.deepEqual(board.warn.map((v) => v.batchNo), ['B-WARN']);
  assert.deepEqual(board.ok.map((v) => v.batchNo), ['B-OK']);
  assert.equal(board.units, 8);
  assert.equal(board.expired[0].daysLeft, -36);
  // 覆盖：红线收到 30 天 → B-RED 落入催销档
  const board2 = shelfBoard(s, T, { warnDays: 200, redDays: 30 });
  assert.equal(board2.red.length, 0);
  assert.equal(board2.warn.length, 2);
  // 出完库存的批次不再上总表
  const b = s.batches.find((x) => x.batchNo === 'B-OK');
  outBatch(s, b.id, { dateISO: T, qty: b.qty, way: 'sold' });
  assert.equal(shelfBoard(s, T).ok.length, 0);
});

test('batchView：药品被删后仍能出视图（不白屏）', () => {
  const s = baseState();
  const d = drug(s);
  const b = addBatch(s, { drugId: d.id, batchNo: 'B1', expiryISO: '2027-06-01', qty: 3 });
  const v1 = batchView(s, b, T);
  assert.equal(v1.drugName, '阿莫西林胶囊');
  s.drugs.length = 0; // 模拟脏数据
  const v2 = batchView(s, b, T);
  assert.equal(v2.drugName, '（药品已删除）');
  assert.equal(v2.level, 'ok');
});

// ---------------------------------------------------------------------------
// 温湿度日双录
// ---------------------------------------------------------------------------

test('addReading：同日同次唯一、读数边界校验、超限判定吃设置', () => {
  const s = baseState();
  addReading(s, { dateISO: T, slot: 'am', tempC: 25, rhPct: 60 });
  assert.throws(() => addReading(s, { dateISO: T, slot: 'am', tempC: 24, rhPct: 60 }), /同日同次唯一/);
  assert.throws(() => addReading(s, { dateISO: T, slot: 'pm', tempC: 99, rhPct: 60 }));
  assert.throws(() => addReading(s, { dateISO: T, slot: 'pm', tempC: 20, rhPct: 120 }));
  assert.throws(() => addReading(s, { dateISO: T, slot: 'noon', tempC: 20, rhPct: 60 }));
  const pm = addReading(s, { dateISO: T, slot: 'pm', tempC: 33, rhPct: 80, coldTempC: 9 });
  assert.equal(pm.exceeded, true);
  assert.deepEqual([pm.flags.temp, pm.flags.rh, pm.flags.cool, pm.flags.cold], [true, true, false, true]);
  // 覆盖限值：上限调到 35 → 33℃ 不再超温
  const s2 = baseState();
  s2.settings.normalMax = 35;
  const r2 = addReading(s2, { dateISO: T, slot: 'am', tempC: 33, rhPct: 60 });
  assert.equal(r2.exceeded, false);
});

test('handleReading：未超限/重复处置/空措施/回溯日期全拒绝', () => {
  const s = baseState();
  const ok = addReading(s, { dateISO: T, slot: 'am', tempC: 25, rhPct: 60 });
  assert.throws(() => handleReading(s, ok.id, { handledISO: T, measure: '空调' }), /未超限/);
  const bad = addReading(s, { dateISO: T, slot: 'pm', tempC: 33, rhPct: 60 });
  assert.throws(() => handleReading(s, bad.id, { handledISO: T, measure: '  ' }), /处置措施/);
  assert.throws(() => handleReading(s, bad.id, { handledISO: addDays(T, -1), measure: '开空调' }), /早于记录日期/);
  handleReading(s, bad.id, { handledISO: T, measure: '开启空调降温，半小时后复测 27℃' });
  assert.throws(() => handleReading(s, bad.id, { handledISO: T, measure: '再开一次' }), /已处置销案/);
  assert.equal(openExceededReadings(s).length, 0);
});

test('removeReading 开放更正；readingGaps 点名窗口内缺笔', () => {
  const s = baseState();
  assert.equal(lastReadingISO(s), null);
  // 窗口 3 天：昨天两笔齐、前天缺下午、大前天全缺
  addReading(s, { dateISO: addDays(T, -1), slot: 'am', tempC: 25, rhPct: 60 });
  addReading(s, { dateISO: addDays(T, -1), slot: 'pm', tempC: 25, rhPct: 60 });
  addReading(s, { dateISO: addDays(T, -2), slot: 'am', tempC: 25, rhPct: 60 });
  const gaps = readingGaps(s, T, 3);
  assert.equal(gaps.never, false);
  assert.equal(gaps.missing.length, 3); // 前天 pm + 大前天 am/pm
  assert.equal(gaps.missingDays, 2);
  assert.equal(gaps.missing[0].slot, 'pm');
  const r = s.readings[0];
  removeReading(s, r.id);
  assert.equal(s.readings.length, 2);
});

// ---------------------------------------------------------------------------
// 拒售登记 / 养护 / 周期义务
// ---------------------------------------------------------------------------

test('addRefusal：原因枚举、最小披露、月度计数', () => {
  const s = baseState();
  addRefusal(s, { dateISO: T, customer: '刘先生', drugName: '头孢克肟', reason: 'no-rx', note: '引导持处方再来/建议就医' });
  assert.throws(() => addRefusal(s, { dateISO: T, reason: 'discount' }));
  addRefusal(s, { dateISO: addDays(T, -40), reason: 'rx-bad' });
  assert.equal(monthlyRefusals(s, monthKey(T)), 1);
  assert.equal(monthlyRefusals(s, '2026-07'), 1); // 40 天前那笔落在 7 月
  assert.throws(() => monthlyRefusals(s, '2026-9'));
});

test('addCare：异常必写处置；careState 四态', () => {
  const s = baseState();
  assert.equal(careState(s, T).level, 'never');
  assert.throws(() => addCare(s, { dateISO: T, found: 2 }), /处置措施/);
  assert.throws(() => addCare(s, { dateISO: T, found: -1 }));
  addCare(s, { dateISO: addDays(T, -45), found: 1, measure: '1 盒近效期乳膏下架隔离' });
  assert.equal(careState(s, T).level, 'overdue'); // 45 天前 + 30 天周期
  addCare(s, { dateISO: T, found: 0 });
  const ok = careState(s, T);
  assert.equal(ok.level, 'ok');
  assert.equal(ok.lastISO, T);
});

test('dutyBoard：红灯在前、打勾自动滚动、周期依据齐全', () => {
  const s = baseState();
  assert.throws(() => setDutyDone(s, 'fire', T), /非法义务类型/);
  setDutyDone(s, 'health', addDays(T, -400));
  setDutyDone(s, 'calib', addDays(T, -30));    // 365 天周期 → 还剩 335 天，在期
  setDutyDone(s, 'training', addDays(T, -340)); // 还剩 25 天 → 临期
  const board = dutyBoard(s, T);
  assert.equal(board[0].kind, 'health'); // 逾期 35 天排最前
  assert.equal(board[0].level, 'overdue');
  assert.equal(board[1].kind, 'training');
  assert.equal(board[1].level, 'due');
  assert.equal(board[2].kind, 'calib');
  assert.equal(board[2].level, 'ok');
  setDutyDone(s, 'health', T); // 打勾滚动 → 365 天后到期，落到队尾
  assert.equal(dutyBoard(s, T)[0].kind, 'training');
  assert.equal(dutyBoard(s, T)[0].level, 'due');
  for (const d of board) assert.ok(d.basis.length > 5);
});

// ---------------------------------------------------------------------------
// 账本体检（确定性扣分）
// ---------------------------------------------------------------------------

test('healthCheck：空档定级（从未记录=bad、许可证未登记=bad、药师未登记=warn）', () => {
  const s = baseState();
  const hc = healthCheck(s, T);
  const byKey = Object.fromEntries(hc.items.map((i) => [i.key, i]));
  assert.equal(byKey.license.level, 'bad');
  assert.equal(byKey.expired.level, 'ok');
  assert.equal(byKey['temp-gap'].level, 'bad');
  assert.equal(byKey['temp-open'].level, 'ok');
  assert.equal(byKey.care.level, 'warn');
  assert.equal(byKey.pharmacist.level, 'warn');
  assert.equal(byKey.duties.level, 'bad');
  assert.equal(hc.bad, 3);
  assert.equal(hc.warn, 2);
  assert.equal(hc.score, 100 - 3 * 15 - 2 * 5);
});

test('healthCheck：过期在架是全场最重的红，且 detail 引用第 117 条口径', () => {
  const s = baseState();
  s.pharmacy = { ...s.pharmacy, name: '示例药店', licenseExpiryISO: '2028-01-01', pharmacistName: '李芳芳', pharmacistRegExpiryISO: '2028-06-01' };
  const d = drug(s);
  addBatch(s, { drugId: d.id, batchNo: 'B-EXP', expiryISO: '2026-08-01', qty: 2 });
  const hc = healthCheck(s, T);
  const expired = hc.items.find((i) => i.key === 'expired');
  assert.equal(expired.level, 'bad');
  assert.match(expired.detail, /第 117 条/);
  assert.match(expired.detail, /10~20 倍/);
});

test('healthCheck：全绿药店满分', () => {
  const s = baseState();
  s.pharmacy = { name: '示例药店', licenseNo: 'DA-0123', licenseExpiryISO: '2029-06-01', manager: '王秀兰', pharmacistName: '李芳芳', pharmacistRegExpiryISO: '2029-06-01' };
  const d = drug(s);
  addBatch(s, { drugId: d.id, batchNo: 'B1', expiryISO: '2028-06-01', qty: 10 });
  for (let i = 1; i <= 4; i += 1) {
    addReading(s, { dateISO: addDays(T, -i), slot: 'am', tempC: 25, rhPct: 60 });
    addReading(s, { dateISO: addDays(T, -i), slot: 'pm', tempC: 26, rhPct: 62 });
  }
  addCare(s, { dateISO: addDays(T, -10), found: 0 });
  setDutyDone(s, 'health', addDays(T, -100));
  setDutyDone(s, 'calib', addDays(T, -100));
  setDutyDone(s, 'training', addDays(T, -100));
  const hc = healthCheck(s, T);
  assert.equal(hc.score, 100);
  assert.equal(hc.bad, 0);
  assert.equal(hc.warn, 0);
});

// ---------------------------------------------------------------------------
// 月度小结 / 出证单
// ---------------------------------------------------------------------------

test('monthlySummary：文本确定、含口径尾注、负数归正展示', () => {
  const s = baseState();
  s.pharmacy = { ...s.pharmacy, name: '杏林堂大药房（示例）' };
  const d = drug(s);
  addBatch(s, { drugId: d.id, batchNo: 'B-EXP', expiryISO: '2026-08-01', qty: 2 });
  addReading(s, { dateISO: T, slot: 'am', tempC: 33, rhPct: 60 });
  addRefusal(s, { dateISO: T, reason: 'no-rx', drugName: '头孢克肟' });
  const sum = monthlySummary(s, monthKey(T), T);
  assert.match(sum.text, /杏林堂大药房（示例）/);
  assert.match(sum.text, /温湿度日双录 1 笔/);
  assert.match(sum.text, /过期在架 1 批次/);
  assert.match(sum.text, /拒售登记 1 笔/);
  assert.match(sum.text, /国务院令第 828 号/);
  assert.match(sum.text, /药清账 · 2026-09/);
  assert.doesNotMatch(sum.text, /-1 笔|-2 笔/);
  const again = monthlySummary(s, monthKey(T), T);
  assert.equal(sum.text, again.text);
});

test('clearanceHtml / inspectHtml：单文件无外部资源、含签字栏、XSS 转义', () => {
  const s = baseState();
  s.pharmacy = { ...s.pharmacy, name: '<script>alert(1)</script>药店' };
  const d = addDrug(s, { name: '<img src=x onerror=alert(2)>异常名', storage: 'cold' });
  addBatch(s, { drugId: d.id, batchNo: 'B1', expiryISO: '2026-08-01', qty: 1 });
  for (const html of [clearanceHtml(s, T), inspectHtml(s, T)]) {
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.doesNotMatch(html, /src=["']http|href=["']http|@import/);
    assert.match(html, /签字/);
    assert.ok(!html.includes('<img src=x onerror'));
    assert.ok(!html.includes('<script>alert(1)'));
  }
  assert.match(inspectHtml(s, T), /&lt;img src=x/);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle：往返一致、异构整体拒绝', () => {
  const s = baseState();
  s.pharmacy = { ...s.pharmacy, name: '示例药店', licenseExpiryISO: '2029-06-01' };
  const d = drug(s);
  addBatch(s, { drugId: d.id, batchNo: 'B1', expiryISO: '2027-06-01', qty: 5 });
  addReading(s, { dateISO: T, slot: 'am', tempC: 25, rhPct: 60 });
  const json = exportBundle(s);
  const res = importBundle(json);
  assert.equal(res.ok, true);
  assert.equal(res.state.batches.length, 1);
  assert.equal(res.state.readings.length, 1);
  assert.equal(importBundle('not-json').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'parcelproof', version: 1, state: s })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'shelfsheet', version: 99, state: s })).ok, false);
  const bad = { app: 'shelfsheet', version: 1, state: { ...s, batches: 'oops' } };
  assert.equal(importBundle(JSON.stringify(bad)).ok, false);
  assert.equal(STATE_VERSION, 1);
});
