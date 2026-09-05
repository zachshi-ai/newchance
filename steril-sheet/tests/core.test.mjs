/**
 * tests/core.test.mjs — 灭菌单 SterilSheet 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, escapeHtml,
  MACHINE_KINDS, WRAP_TYPES, CHEM_RESULTS, BD_RESULTS, BIO_RESULTS,
  assertPack, makePack, assertBatch, makeBatchNo, batchState, unitStock,
  expireISOOf, shelfLevel, isIssuable, allocateFIFO, recordUsage, removeUsage,
  updateBio, recallList, closeRecall, registerTreatment,
  stockRows, expiredRows, bioDue, bioPendingOverdue, wasteDue, certLevel,
  selfCheck, monthlyReport, monthBatchRows, traceFor, traceText, traceHtml,
  inspectionText, inspectionHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期（周六），不依赖墙钟

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-5'));
  assert.throws(() => assertISO('20260905'));
  assert.throws(() => assertISO(20260905));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
});

test('addDays 跨月/跨年收敛；daysUntil 与 monthKey 跨年正确', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysUntil('2026-12-31', T), 117);
  assert.equal(daysUntil('2026-09-05', T), 0);
  assert.equal(daysUntil('2026-09-04', T), -1);
  assert.equal(monthKey('2026-09-05'), '2026-09');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('WRAP_TYPES 默认效期；makePack/assertPack 门禁', () => {
  assert.deepEqual(
    Object.fromEntries(Object.keys(WRAP_TYPES).map((k) => [k, WRAP_TYPES[k].shelfDays])),
    { pp: 180, cloth: 7, container: 7 },
  );
  assert.equal(makePack({ id: 'p1', name: '拔牙包', wrap: 'cloth' }).shelfDays, 7);
  assert.equal(makePack({ id: 'p1', name: '牙科手机', wrap: 'pp' }).shelfDays, 180);
  assert.equal(makePack({ id: 'p1', name: '手机', wrap: 'pp', shelfDays: 90 }).shelfDays, 90);
  assert.throws(() => makePack({ id: 'p1', name: '  ', wrap: 'pp' }), /名称/);
  assert.throws(() => makePack({ id: 'p1', name: 'X', wrap: 'paper' }), /包装类型/);
  assert.throws(() => makePack({ id: 'p1', name: 'X', wrap: 'pp', shelfDays: 0 }), /效期/);
  assert.throws(() => assertPack({ name: 'X', wrap: 'pp', shelfDays: 400 }), /效期/);
});

// ---------------------------------------------------------------------------
// 批次落账门禁与锅编号
// ---------------------------------------------------------------------------

function mkPack(id, over = {}) {
  return makePack({ id, name: `包${id}`, wrap: 'pp', ...over });
}

function mkBatch(id, over = {}) {
  return {
    id, no: '20260905-M1-01', machineId: 'm1', dateISO: T, operator: '王护士',
    loads: [{ packId: 'p1', qty: 3 }], chem: 'pass', bd: 'none', bio: 'none',
    ...over,
  };
}

test('assertBatch：装载/数量/操作者/化学/生物五重门禁，不合格必须写处置说明', () => {
  const b = mkBatch('b1');
  assert.doesNotThrow(() => assertBatch(b));
  assert.throws(() => assertBatch({ ...b, loads: [] }), /装载不能为空/);
  assert.throws(() => assertBatch({ ...b, loads: [{ packId: 'p1', qty: 0 }] }), /正整数/);
  assert.throws(() => assertBatch({ ...b, loads: [{ packId: 'p1', qty: 1.5 }] }), /正整数/);
  assert.throws(() => assertBatch({ ...b, operator: ' ' }), /操作者/);
  assert.throws(() => assertBatch({ ...b, chem: 'maybe' }), /化学/);
  assert.throws(() => assertBatch({ ...b, chem: 'fail' }), /处置说明/);
  assert.doesNotThrow(() => assertBatch({ ...b, chem: 'fail', chemNote: '生物指示剂变色异常，整锅重新灭菌' }));
  assert.throws(() => assertBatch({ ...b, bio: 'maybe' }), /生物/);
  assert.throws(() => assertBatch({ ...b, dateISO: '2026-09-10' }), /未来/);
  assert.throws(() => assertBatch({ ...b, dateISO: '2026-09-05 ' }), /非法日期/);
});

test('assertBatch：同锅重复装载自动合并；带结果的生物监测默认锚定灭菌日', () => {
  const b = assertBatch(mkBatch('b1', { loads: [{ packId: 'p1', qty: 2 }, { packId: 'p1', qty: 1 }], bio: 'pass' }));
  assert.deepEqual(b.loads, [{ packId: 'p1', qty: 3 }]);
  assert.equal(b.bioISO, T);
});

test('makeBatchNo：日期+锅代码+当日序号，跨锅跨日连续', () => {
  const batches = [];
  const m1 = { id: 'm1', code: 'M1' };
  assert.equal(makeBatchNo(batches, m1, T), `20260905-M1-01`);
  batches.push({ no: '20260905-M1-01' });
  assert.equal(makeBatchNo(batches, m1, T), `20260905-M1-02`);
  batches.push({ no: `20260905-M1-02` });
  batches.push({ no: '20260904-M1-01' });
  assert.equal(makeBatchNo(batches, m1, T), `20260905-M1-03`);
  const m2 = { id: 'm2', code: 'M2' };
  assert.equal(makeBatchNo(batches, m2, T), `20260905-M2-01`);
});

// ---------------------------------------------------------------------------
// 守恒：在库 = 装载 − 已使用分配 − 已处置
// ---------------------------------------------------------------------------

function baseState() {
  return {
    clinic: { name: '向阳口腔诊所', phone: '' },
    machines: [{ id: 'm1', name: '卡式灭菌器', code: 'M1', kind: 'cart', note: '' }],
    packs: [mkPack('p1'), mkPack('p2', { name: '拔牙包', wrap: 'cloth' })],
    batches: [],
    usages: [],
    treatments: [],
    staff: [],
    wastes: [],
    consumables: [],
    settings: { bioIntervalDays: 7, bioGraceDays: 3, wasteIntervalDays: 2, expWarnDays: 7 },
    events: [],
  };
}

function stock(s, batchesExtra = [], usages = [], treatments = []) {
  s.batches.push(...batchesExtra);
  s.usages.push(...usages);
  s.treatments.push(...treatments);
  return s;
}

test('unitStock 守恒：装载 − 使用 − 处置，互不串包', () => {
  const b1 = mkBatch('b1', { loads: [{ packId: 'p1', qty: 5 }] });
  const usage = { id: 'u1', alloc: [{ batchId: 'b1', packId: 'p1', qty: 2 }] };
  const treat = { batchId: 'b1', packId: 'p1', qty: 1 };
  assert.equal(unitStock(b1, 'p1', [usage], [treat]), 2);
  const b2 = mkBatch('b2');
  assert.equal(unitStock(b2, 'p2', [usage], []), 0); // 没装的包不在库
  assert.equal(unitStock(b2, 'p1', [], []), 3);
});

test('expireISOOf / shelfLevel：失效日=灭菌日+效期；失效日当天可用、次日起过期；临期黄线参数化', () => {
  const b = mkBatch('b1', { dateISO: '2026-03-09' }); // +180 = 2026-09-05
  const pp = mkPack('p1', { wrap: 'pp', shelfDays: 180 });
  assert.equal(expireISOOf(b, pp), '2026-09-05');
  // 锚定 T=2026-09-05 的时间轴：9-04 过期 / 9-05 当天到期 / 9-12 临期界 / 9-13 正常
  assert.equal(shelfLevel('2026-09-04', T, 7), 'expired');
  assert.equal(shelfLevel('2026-09-05', T, 7), 'warn'); // 失效日当天仍在效期内
  assert.equal(shelfLevel('2026-09-06', T, 7), 'warn');
  assert.equal(shelfLevel('2026-09-12', T, 7), 'warn');
  assert.equal(shelfLevel('2026-09-13', T, 7), 'ok');
  assert.equal(shelfLevel('2026-09-05', T, 1), 'warn'); // 剩 0 天，已进临期
  assert.equal(shelfLevel('2026-09-07', T, 1), 'ok');   // 剩 2 天，超出 1 天黄线
  assert.throws(() => shelfLevel('2026-09-05', T, 0), /临期/);
});

// ---------------------------------------------------------------------------
// FIFO 分配与使用落账（过期不许发是硬门禁）
// ---------------------------------------------------------------------------

test('allocateFIFO：先灭先用（失效日最早优先），跨批次接力分配', () => {
  const s = baseState();
  // 用 7 天效期的布包（p2）构造效期阶梯：b1/b2 已过期，b3 失效 9-06（最先发），b4 失效 9-08
  const b1 = mkBatch('b1', { no: '20260820-M1-01', dateISO: '2026-08-20', loads: [{ packId: 'p2', qty: 2 }] });
  const b2 = mkBatch('b2', { no: '20260826-M1-01', dateISO: '2026-08-26', loads: [{ packId: 'p2', qty: 2 }] });
  const b3 = mkBatch('b3', { no: '20260830-M1-01', dateISO: '2026-08-30', loads: [{ packId: 'p2', qty: 3 }] });
  const b4 = mkBatch('b4', { no: '20260901-M1-01', dateISO: '2026-09-01', loads: [{ packId: 'p2', qty: 4 }] });
  stock(s, [b1, b2, b3, b4]);
  const alloc = allocateFIFO(s, 'p2', 5, T);
  assert.deepEqual(alloc.map((a) => a.no), [b3.no, b4.no]);
  assert.equal(alloc[0].qty, 3);
  assert.equal(alloc[1].qty, 2);
});

test('allocateFIFO：全部过期 → 拒绝并点名先处置；部分可用不足 → 给出可执行错误', () => {
  const s = baseState();
  const b1 = mkBatch('b1', { no: '20260820-M1-01', dateISO: '2026-08-20', loads: [{ packId: 'p2', qty: 2 }] }); // 失效 8-27 过期
  stock(s, [b1]);
  assert.throws(() => allocateFIFO(s, 'p2', 1, T), /过期.*处置/);
  const s2 = baseState();
  stock(s2, [mkBatch('b1', { no: '20260830-M1-01', dateISO: '2026-08-30', loads: [{ packId: 'p2', qty: 2 }] })]);
  assert.throws(() => allocateFIFO(s2, 'p2', 3, T), /只有 2 个/);
});

test('allocateFIFO：召回中与化学不合格批次被冻结，不可分配', () => {
  const s = baseState();
  const b1 = mkBatch('b1', { bio: 'fail', bioISO: '2026-08-31', recall: { openedISO: '2026-08-31', note: '生物阳性', closedISO: null, closeNote: null } });
  const b2 = mkBatch('b2', { chem: 'fail', chemNote: '整锅重灭' });
  stock(s, [b1, b2]);
  assert.throws(() => allocateFIFO(s, 'p1', 1, T), /冻结/);
});

test('recordUsage：患者标识必填、FIFO 分配快照、效期日当天可用次日内拒绝（回填按当日效期判定）', () => {
  const s = baseState();
  const b = mkBatch('b1', { dateISO: '2026-03-09' }); // p1 失效 2026-09-05
  stock(s, [b]);
  const u = recordUsage(s, {
    id: 'u1', packId: 'p1', qty: 2, patientRef: '陈*', operator: '王护士', dateISO: T,
  });
  assert.deepEqual(u.alloc, [{ batchId: 'b1', no: b.no, packId: 'p1', qty: 2, expireISO: '2026-09-05' }]);
  assert.throws(() => recordUsage(s, { id: 'u2', packId: 'p1', qty: 1, patientRef: '', dateISO: T }), /患者标识/);
  assert.throws(() => recordUsage(s, { id: 'u2', packId: 'p1', qty: 1, patientRef: '李*', dateISO: '2026-09-06' }), /过期/);
  assert.doesNotThrow(() => recordUsage(s, { id: 'u3', packId: 'p1', qty: 1, patientRef: '李*', dateISO: T }));
  assert.throws(() => recordUsage(s, { id: 'u4', packId: 'ghost', qty: 1, patientRef: '李*', dateISO: T }), /不存在/);
  s.packs.push(mkPack('p3', { name: '停用包', active: false }));
  s.batches.push(mkBatch('b9', { loads: [{ packId: 'p3', qty: 1 }] }));
  assert.throws(() => recordUsage(s, { id: 'u5', packId: 'p3', qty: 1, patientRef: '李*', dateISO: T }), /停用/);
});

test('removeUsage：撤销回滚恢复在库；被召回批次的发放记录不可撤销（召回名单已生成）', () => {
  const s = baseState();
  const b = mkBatch('b1', { dateISO: '2026-08-30' });
  stock(s, [b]);
  const u = recordUsage(s, { id: 'u1', packId: 'p1', qty: 1, patientRef: '陈*', dateISO: T });
  removeUsage(s, 'u1');
  assert.equal(unitStock(b, 'p1', s.usages, s.treatments), 3);
  const u2 = recordUsage(s, { id: 'u2', packId: 'p1', qty: 1, patientRef: '陈*', dateISO: T });
  updateBio(s, 'b1', { bio: 'fail', bioISO: T });
  assert.throws(() => removeUsage(s, 'u2'), /召回/);
});

// ---------------------------------------------------------------------------
// 生物监测补录与召回闭环
// ---------------------------------------------------------------------------

test('updateBio：pending→pass/fail 一次性锁定；合格不可改判；只能补录合法值', () => {
  const s = baseState();
  stock(s, [mkBatch('b1', { bio: 'pending' })]);
  const b = updateBio(s, 'b1', { bio: 'pass', bioISO: '2026-09-06' });
  assert.equal(b.bio, 'pass');
  assert.equal(b.bioISO, '2026-09-06');
  assert.throws(() => updateBio(s, 'b1', { bio: 'fail' }), /不能改判/);
  const s2 = baseState();
  stock(s2, [mkBatch('b1', { bio: 'pass' })]);
  assert.throws(() => updateBio(s2, 'b1', { bio: 'fail' }), /不能改判/);
  const s3 = baseState();
  stock(s3, [mkBatch('b1', {})]);
  assert.throws(() => updateBio(s3, 'b1', { bio: 'none' }), /只能补录/);
  assert.throws(() => updateBio(s3, 'ghost', { bio: 'pass' }), /不存在/);
});

test('召回闭环：fail 开启召回 → 冻结在库 → 名单可出 → 未处置完不许销案 → 处置后销案', () => {
  const s = baseState();
  const b = mkBatch('b1', { dateISO: '2026-08-30', bio: 'pending' });
  stock(s, [b]);
  recordUsage(s, { id: 'u1', packId: 'p1', qty: 1, patientRef: '陈*', dateISO: T });
  updateBio(s, 'b1', { bio: 'fail', bioISO: T });
  assert.equal(batchState(b), 'recall-open');
  const list = recallList(s, 'b1');
  assert.equal(list.length, 1);
  assert.equal(list[0].patientRef, '陈*');
  assert.equal(list[0].packName, '包p1');
  // 在库 2 个未处置 → 销案拒绝
  assert.throws(() => closeRecall(s, 'b1', { note: '已全部重新灭菌' }), /未处置/);
  registerTreatment(s, { id: 't1', batchId: 'b1', packId: 'p1', qty: 2, action: 'reprocess', dateISO: T, note: '重新清洗包装灭菌' });
  closeRecall(s, 'b1', { note: '在库 2 个重新处理；已电话通知陈* 复诊观察' });
  assert.equal(batchState(b), 'recall-closed');
  assert.ok(b.recall.closedISO);
  // 销案后仍不可分配（历史批次不回库）
  assert.throws(() => allocateFIFO(s, 'p1', 1, T), /只有 0 个|冻结/);
});

test('registerTreatment：数量超在库/幽灵批次/非法处置方式拒绝', () => {
  const s = baseState();
  stock(s, [mkBatch('b1', { dateISO: '2026-08-30' })]);
  assert.throws(() => registerTreatment(s, { id: 't1', batchId: 'b1', packId: 'p1', qty: 5, action: 'discard', dateISO: T }), /超过在库/);
  assert.throws(() => registerTreatment(s, { id: 't1', batchId: 'ghost', packId: 'p1', qty: 1, action: 'discard', dateISO: T }), /不存在/);
  assert.throws(() => registerTreatment(s, { id: 't1', batchId: 'b1', packId: 'p1', qty: 1, action: 'sell', dateISO: T }), /处置方式非法/);
  registerTreatment(s, { id: 't1', batchId: 'b1', packId: 'p1', qty: 3, action: 'discard', dateISO: T });
  assert.equal(unitStock(s.batches[0], 'p1', s.usages, s.treatments), 0);
});

// ---------------------------------------------------------------------------
// 无菌柜：在库台账与过期点名
// ---------------------------------------------------------------------------

test('stockRows：失效日升序（先用先发的一张表），0 在库不出现，冻结行带标记', () => {
  const s = baseState();
  const b1 = mkBatch('b1', { no: '20260901-M1-01', dateISO: '2026-09-01', loads: [{ packId: 'p2', qty: 2 }] }); // 失效 9-08
  const b2 = mkBatch('b2', { no: '20260830-M1-01', dateISO: '2026-08-30', loads: [{ packId: 'p2', qty: 2 }] }); // 失效 9-06
  stock(s, [b1, b2]);
  const rows = stockRows(s, T);
  assert.deepEqual(rows.map((r) => r.batch.no), [b2.no, b1.no]);
  assert.deepEqual(rows.map((r) => r.level), ['warn', 'warn']);
  const frozen = mkBatch('b3', { no: '20260831-M1-01', dateISO: '2026-08-31', loads: [{ packId: 'p1', qty: 1 }], bio: 'fail', bioISO: T, recall: { openedISO: T, note: '', closedISO: null, closeNote: null } });
  stock(s, [frozen]);
  const rows2 = stockRows(s, T);
  assert.equal(rows2.find((r) => r.batch.id === 'b3').frozen, true);
  // 处置完过期包后不再出现
  const s2 = baseState();
  const be = mkBatch('be', { no: '20260820-M1-01', dateISO: '2026-08-20', loads: [{ packId: 'p2', qty: 3 }] }); // 失效 8-27 过期
  stock(s2, [be]);
  assert.equal(expiredRows(s2, T).length, 1);
  registerTreatment(s2, { id: 't1', batchId: 'be', packId: 'p2', qty: 3, action: 'discard', dateISO: T });
  assert.equal(expiredRows(s2, T).length, 0);
  assert.equal(stockRows(s2, T).length, 0);
});

// ---------------------------------------------------------------------------
// 周期任务：生物监测 / 医废 / 健康证
// ---------------------------------------------------------------------------

test('bioDue：从未记录 → never；周期内 → due；超期 → overdue；锚点是最近一次结果日', () => {
  const s = baseState();
  assert.equal(bioDue(s, T).status, 'never');
  stock(s, [mkBatch('b1', { dateISO: '2026-08-30', bio: 'pending' })]);
  assert.equal(bioDue(s, T).status, 'never'); // 培养中不算完成
  s.batches[0].bio = 'pass';
  s.batches[0].bioISO = '2026-08-30';
  const due = bioDue(s, T);
  assert.equal(due.lastISO, '2026-08-30');
  assert.equal(due.dueISO, '2026-09-06');
  assert.equal(due.status, 'due');
  assert.equal(bioDue(s, T, 5).status, 'overdue');
  const s2 = baseState();
  stock(s2, [
    mkBatch('b1', { dateISO: '2026-08-01', bio: 'pass', bioISO: '2026-08-01' }),
    mkBatch('b2', { dateISO: '2026-08-28', bio: 'pass', bioISO: '2026-08-28' }),
  ]);
  assert.equal(bioDue(s2, T).lastISO, '2026-08-28');
  assert.equal(bioDue(s2, T).status, 'overdue'); // 8-28 + 7 = 9-04 < 9-05
});

test('bioPendingOverdue：超过宽限天数仍培养中 → 点名', () => {
  const s = baseState();
  stock(s, [mkBatch('b1', { dateISO: '2026-09-01', bio: 'pending' })]);
  assert.equal(bioPendingOverdue(s, T, 3).length, 1); // 9-01 → 9-05 已 4 天 > 3 → 超期
  assert.equal(bioPendingOverdue(s, T, 4).length, 0);
});

test('wasteDue：从未记录 never；间隔超期 overdue（默认 2 天）', () => {
  const s = baseState();
  assert.equal(wasteDue(s, T).status, 'never');
  s.wastes.push({ id: 'w1', dateISO: '2026-09-03', handler: '绿源环保' });
  assert.equal(wasteDue(s, T).status, 'due');   // 9-03 + 2 = 9-05 当天到
  assert.equal(wasteDue(s, T, 1).status, 'overdue');
});

test('certLevel：健康证三态边界（过期/30 天临期/正常）', () => {
  assert.equal(certLevel('2026-11-01', T), 'ok');
  assert.equal(certLevel('2026-10-06', T), 'ok');
  assert.equal(certLevel('2026-10-05', T), 'warn'); // 剩 30 天进入临期
  assert.equal(certLevel('2026-09-05', T), 'warn'); // 当天到期仍是 warn（还有效）
  assert.equal(certLevel('2026-09-04', T), 'expired');
});

// ---------------------------------------------------------------------------
// 院感体检（自查打分）
// ---------------------------------------------------------------------------

test('selfCheck：全绿 100 分；过期在库/召回未销案/监测断链逐项亮红灯扣分', () => {
  const s = baseState();
  s.staff = [{ id: 's1', name: '王护士', certValidUntil: '2027-03-01' }];
  s.wastes = [{ id: 'w1', dateISO: '2026-09-04', handler: '绿源' }];
  const healthy = selfCheck(s, T);
  assert.equal(healthy.checks.length, 7);
  assert.equal(healthy.score, 100);

  // 空诊所：无批次不扣监测分，但医废没记过 warn
  const empty = selfCheck(baseState(), T);
  assert.equal(empty.checks.find((c) => c.key === 'bio').level, 'ok');
  assert.equal(empty.checks.find((c) => c.key === 'waste').level, 'warn');

  // 制造三个红灯：监测超期 5 天、召回未销案、过期在库
  const bad = baseState();
  bad.packs.push(mkPack('p1'));
  stock(bad, [
    mkBatch('b1', { dateISO: '2026-08-20', bio: 'pass', bioISO: '2026-08-20' }), // 8-20+7=8-27 超期 9 天
    mkBatch('b2', { dateISO: '2026-08-21', bio: 'fail', bioISO: '2026-08-22', recall: { openedISO: '2026-08-22', note: '', closedISO: null, closeNote: null } }),
  ]);
  const badCheck = selfCheck(bad, T);
  const byKey = Object.fromEntries(badCheck.checks.map((c) => [c.key, c.level]));
  assert.equal(byKey.bio, 'issue');
  assert.equal(byKey.recall, 'issue');
  assert.ok(badCheck.score < 80);
});

// ---------------------------------------------------------------------------
// 月度台账与迎检包
// ---------------------------------------------------------------------------

test('monthlyReport：跨年隔离，锅/包/发放/监测/召回按各自日期归月', () => {
  const s = baseState();
  s.batches = [
    mkBatch('b1', { no: '20260901-M1-01', dateISO: '2026-09-01', bio: 'pass', bioISO: '2026-09-03', loads: [{ packId: 'p1', qty: 3 }] }),
    mkBatch('b2', { no: '20260902-M1-01', dateISO: '2026-09-02', bio: 'fail', bioISO: '2026-09-04', loads: [{ packId: 'p1', qty: 2 }], recall: { openedISO: '2026-09-04', note: '', closedISO: null, closeNote: null } }),
    mkBatch('b3', { no: '20251231-M1-01', dateISO: '2025-12-31' }),
  ];
  s.usages = [
    { id: 'u1', packId: 'p1', qty: 2, patientRef: '陈*', dateISO: '2026-09-03', alloc: [{ batchId: 'b1', no: b1No(), qty: 2 }] },
    { id: 'u2', packId: 'p1', qty: 1, patientRef: '李*', dateISO: '2025-12-31', alloc: [{ batchId: 'b3', no: '20251231-M1-01', qty: 1 }] },
  ];
  function b1No() { return '20260901-M1-01'; }
  const sep = monthlyReport(s, '2026-09');
  assert.deepEqual(
    [sep.batchCount, sep.packCount, sep.usedCount, sep.usageCount, sep.bioCount, sep.bioFailCount, sep.recallCount],
    [2, 5, 2, 1, 2, 1, 1],
  );
  const lastYear = monthlyReport(s, '2025-12');
  assert.deepEqual([lastYear.batchCount, lastYear.usedCount], [1, 1]);
  assert.throws(() => monthlyReport(s, '2026-9'), /非法月份/);
  const none = monthlyReport(baseState(), '2026-09');
  assert.deepEqual([none.batchCount, none.packCount, none.usedCount, none.bioCount], [0, 0, 0, 0]);
});

test('monthBatchRows：按锅编号排序，装载/监测/状态齐全', () => {
  const s = baseState();
  s.batches = [
    mkBatch('b2', { no: '20260902-M1-01', dateISO: '2026-09-02', loads: [{ packId: 'p1', qty: 2 }, { packId: 'p2', qty: 1 }] }),
    mkBatch('b1', { no: '20260901-M1-01', dateISO: '2026-09-01', bio: 'pending' }),
    mkBatch('bx', { no: '20260820-M1-01', dateISO: '2026-08-20' }),
  ];
  const rows = monthBatchRows(s, '2026-09');
  assert.deepEqual(rows.map((r) => r.no), ['20260901-M1-01', '20260902-M1-01']);
  assert.match(rows[1].loadsText, /包p1×2、拔牙包×1/);
  assert.match(rows[0].bio, /培养中/);
});

// ---------------------------------------------------------------------------
// 追溯自证单
// ---------------------------------------------------------------------------

function traceState() {
  const s = baseState();
  s.batches = [
    mkBatch('b1', { no: '20260901-M1-01', dateISO: '2026-09-01', operator: '王护士', bio: 'pass', bioISO: '2026-09-03', bd: 'pass' }),
    mkBatch('b2', { no: '20260903-M1-01', dateISO: '2026-09-03', operator: '刘医生' }),
  ];
  s.usages = [
    {
      id: 'u1', packId: 'p1', qty: 2, patientRef: '陈*', operator: '王护士', dateISO: '2026-09-02',
      alloc: [{ batchId: 'b1', no: '20260901-M1-01', qty: 2, expireISO: '2026-03-02' }],
    },
    {
      id: 'u2', packId: 'p2', qty: 1, patientRef: '陈*', operator: '刘医生', dateISO: '2026-09-04',
      alloc: [{ batchId: 'b2', no: '20260903-M1-01', qty: 1, expireISO: '2026-09-10' }],
    },
    {
      id: 'u3', packId: 'p1', qty: 1, patientRef: '李*', operator: '', dateISO: '2026-09-04',
      alloc: [{ batchId: 'b2', no: '20260903-M1-01', qty: 1, expireISO: '2026-09-10' }],
    },
  ];
  return s;
}

test('traceFor：精确匹配患者标识，链上带批次/监测/效期；召回批次打标', () => {
  const s = traceState();
  const entries = traceFor(s, '陈*');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].packs[0].no, '20260901-M1-01');
  assert.equal(entries[0].packs[0].bio, '✅ 合格');
  assert.equal(entries[1].packs[0].recalled, false);
  assert.equal(traceFor(s, '李*').length, 1);
  assert.equal(traceFor(s, '不存在').length, 0);
  updateBio(s, 'b2', { bio: 'fail', bioISO: T });
  assert.equal(traceFor(s, '陈*')[1].packs[0].recalled, true);
  assert.throws(() => traceFor(s, ' '), /患者标识/);
});

test('traceText：同输入同输出；链路、声明与召回标记齐全', () => {
  const s = traceState();
  updateBio(s, 'b2', { bio: 'fail', bioISO: T });
  const entries = traceFor(s, '陈*');
  const t1 = traceText({ clinic: s.clinic, patientRef: '陈*', entries, todayISOStr: T });
  const t2 = traceText({ clinic: s.clinic, patientRef: '陈*', entries, todayISOStr: T });
  assert.equal(t1, t2);
  assert.match(t1, /【器械灭菌追溯单】向阳口腔诊所/);
  assert.match(t1, /患者标识：陈\*/);
  assert.match(t1, /批次 20260901-M1-01 · 灭菌 2026-09-01 · 失效 2026-03-02/);
  assert.match(t1, /化学监测 ✅ 合格 · 生物监测 ✅ 合格 · 灭菌操作 王护士/);
  assert.match(t1, /该批次曾启动召回/);
  assert.match(t1, /不构成医疗鉴定意见/);
  const empty = traceText({ clinic: s.clinic, patientRef: '无', entries: [], todayISOStr: T });
  assert.match(empty, /未查询到/);
});

test('traceText / traceHtml：诊所名与患者标识注入被转义（XSS 防护）；打印版单文件无外部资源', () => {
  const s = traceState();
  s.clinic.name = '向阳<script>alert(1)</script>口腔';
  const entries = traceFor(s, '陈*<img src=x onerror=1>');
  const text = traceText({ clinic: s.clinic, patientRef: '陈*<img src=x onerror=1>', entries, todayISOStr: T });
  assert.ok(text.includes('陈*<img src=x onerror=1>')); // 文本通道原文保留
  const html = traceHtml({ clinic: s.clinic, patientRef: '陈*<img src=x onerror=1>', entries, todayISOStr: T });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!/src=["']http/.test(html));
  assert.ok(!/href=["']http/.test(html));
  assert.match(html, /器械灭菌追溯单/);
  assert.match(html, /负责人签字/);
});

// ---------------------------------------------------------------------------
// 迎检包
// ---------------------------------------------------------------------------

test('inspectionText：月度台账 + 体检 + 声明；空月份不炸', () => {
  const s = traceState();
  const t = inspectionText({ clinic: s.clinic, state: s, month: '2026-09', todayISOStr: T });
  assert.match(t, /【2026-09 灭菌与监测台账】向阳口腔诊所/);
  assert.match(t, /20260901-M1-01/);
  assert.match(t, /装载：包p1×3/);
  assert.match(t, /院感自查体检/);
  assert.match(t, /WS 506-2016/);
  const empty = inspectionText({ clinic: s.clinic, state: baseState(), month: '2026-09', todayISOStr: T });
  assert.match(empty, /本月无灭菌记录/);
});

test('inspectionHtml：签字栏齐全、无外部资源、诊所名转义', () => {
  const s = traceState();
  s.clinic.name = '向阳<b>口腔</b>';
  const html = inspectionHtml({ clinic: s.clinic, state: s, month: '2026-09', todayISOStr: T });
  assert.ok(html.includes('向阳&lt;b&gt;口腔&lt;/b&gt;'));
  assert.ok(!/src=["']http/.test(html));
  assert.match(html, /诊所负责人（签字\/盖章）/);
  assert.match(html, /检查人员/);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = traceState();
  updateBio(s, 'b2', { bio: 'fail', bioISO: T });
  const round = importBundle(exportBundle(s));
  assert.ok(round.ok);
  assert.deepEqual(round.state.batches, s.batches);
  assert.deepEqual(round.state.usages, s.usages);
  assert.equal(round.state.clinic.name, '向阳口腔诊所');
});

test('importBundle：非 JSON / 错误应用 / 坏结构 / 高版本一律整体拒绝', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.match(importBundle('not json').error, /JSON/);
  const bad = importBundle(JSON.stringify({ app: 'carsheet', version: 1, state: {} }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是灭菌单/);
  const incomplete = importBundle(JSON.stringify({
    app: 'sterilsheet', version: STATE_VERSION,
    state: { clinic: {}, machines: [], packs: [], batches: 'nope', usages: [], treatments: [], settings: {} },
  }));
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /结构不完整/);
  const future = importBundle(JSON.stringify({
    app: 'sterilsheet', version: STATE_VERSION + 1,
    state: { clinic: {}, machines: [], packs: [], batches: [], usages: [], treatments: [], settings: {} },
  }));
  assert.equal(future.ok, false);
  assert.match(future.error, /高于当前支持版本/);
});

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

test('escapeHtml 与常量基线', () => {
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  assert.ok(typeof todayISO() === 'string');
  assert.equal(STATE_VERSION, 1);
  assert.deepEqual(Object.keys(MACHINE_KINDS), ['b', 's', 'n', 'cart']);
  assert.deepEqual(Object.keys(CHEM_RESULTS), ['pass', 'fail']);
  assert.deepEqual(Object.keys(BD_RESULTS), ['none', 'pass', 'fail']);
  assert.deepEqual(Object.keys(BIO_RESULTS), ['none', 'pending', 'pass', 'fail']);
  assert.equal(isIssuable({ chem: 'pass', bio: 'pending' }), true);
  assert.equal(isIssuable({ chem: 'pass', bio: 'none' }), true);
  assert.equal(isIssuable({ chem: 'fail', bio: 'none' }), false);
});
