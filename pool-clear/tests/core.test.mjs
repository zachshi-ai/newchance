/**
 * tests/core.test.mjs — 泳清单 PoolClear 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, fmtVal, fmtRange, escapeHtml,
  POOL_KINDS, DISINFECT_KINDS, SLOTS, DEFAULT_LIMITS, validateLimits,
  evaluate, badge, addRecord, removeRecord, openAnomalies,
  todayBoard, streakDays, expiryLevel, expiryAlerts, activePools,
  audit, monthlyStats, latestByPool,
  dailyText, publicHtml, auditHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期（周六），不依赖墙钟

// ---------------------------------------------------------------------------
// 测试脚手架
// ---------------------------------------------------------------------------

function mkPool(id, over = {}) {
  return {
    id, name: id, kind: 'main', disinfect: 'chlorine',
    since: '2026-08-01', active: true, createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function baseState() {
  return {
    venue: { name: '清波游泳馆', licenseNo: '粤卫公证字〔2024〕第0385号', licenseExpiry: '2028-06-30', address: '', phone: '13800001234' },
    pools: [
      mkPool('main', { name: '25m 主池' }),
      mkPool('kids', { name: '儿童池', kind: 'kids', disinfect: 'chlorine' }),
      mkPool('foot', { name: '入口浸脚池', kind: 'footbath', since: '2026-08-01' }),
    ],
    records: [],
    certs: [{ id: 'c1', name: '李教练', role: '教练', expiry: '2027-03-01' }],
    reports: [{ id: 't1', org: 'XX 检测', reportISO: '2026-07-01', nextDue: '2027-01-05' }],
    settings: { limits: validateLimits({}), dailyRequired: 2, warnDays: 30 },
    events: [],
  };
}

/** 便捷落账（绕开 UI） */
function rec(state, over, today = T) {
  return addRecord(state, {
    id: `r-${state.records.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
    dateISO: T, slot: 'open',
    ph: null, turbidity: null, waterTemp: null, opNote: '', action: '', recheckOf: null,
    createdAt: `${over.dateISO ?? T}T08:00:00.000Z`,
    ...over,
  }, today);
}

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

test('addDays 跨月/跨年收敛；daysUntil 与 monthKey 正确', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysUntil('2026-12-31', T), 117);
  assert.equal(daysUntil('2026-09-05', T), 0);
  assert.equal(daysUntil('2026-09-04', T), -1);
  assert.equal(monthKey('2026-09-05'), '2026-09');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('fmtVal / fmtRange：读数与口径文案', () => {
  assert.equal(fmtVal(0.6), '0.6');
  assert.equal(fmtVal(7), '7.0');
  assert.equal(fmtVal(null), '—');
  assert.throws(() => fmtVal(-1));
  assert.throws(() => fmtVal('x'));
  assert.equal(fmtRange([0.3, 1.0], 'mg/L'), '0.3~1.0 mg/L');
  assert.equal(fmtRange([23, 30]), '23~30');
});

// ---------------------------------------------------------------------------
// 口径参数（属地永远赢，但要过合法性门）
// ---------------------------------------------------------------------------

test('validateLimits：默认口径返回国标值；覆盖属地口径；非法参数整体拒绝', () => {
  const d = validateLimits({});
  assert.deepEqual(d.residual, [0.3, 1.0]);
  assert.deepEqual(d.ph, [7.0, 7.8]);
  assert.equal(d.turbidityMax, 1);
  assert.deepEqual(d.waterTemp, [23, 30]);
  assert.deepEqual(d.foot, [5, 10]);
  const custom = validateLimits({ residual: [0.5, 1.0], foot: [5, 10] });
  assert.deepEqual(custom.residual, [0.5, 1.0]);
  assert.deepEqual(custom.ph, [7.0, 7.8]);
  assert.throws(() => validateLimits({ residual: [1.0, 0.3] }), /residual/);
  assert.throws(() => validateLimits({ ph: ['a', 'b'] }), /ph/);
  assert.throws(() => validateLimits({ turbidityMax: 0 }), /turbidityMax/);
  assert.throws(() => validateLimits({ waterTemp: [30, 23] }), /waterTemp/);
});

// ---------------------------------------------------------------------------
// 判定引擎（国标边界值：闭区间）
// ---------------------------------------------------------------------------

test('evaluate：余氯 0.3/1.0 达标、0.29 偏低、1.01 偏高（闭区间边界）', () => {
  const pool = mkPool('main');
  const mk = (residual) => ({ residual, ph: 7.4 });
  assert.equal(evaluate(mk(0.3), pool).ok, true);
  assert.equal(evaluate(mk(1.0), pool).ok, true);
  assert.deepEqual(evaluate(mk(0.29), pool).hard, ['residual']);
  assert.deepEqual(evaluate(mk(1.01), pool).hard, ['residual']);
  assert.equal(evaluate(mk(1.01), pool).items.residual.level, 'high');
  assert.equal(evaluate(mk(0.29), pool).items.residual.level, 'low');
});

test('evaluate：pH 7.0/7.8 达标、6.9/7.9 超线；浊度 ≤1；水温出「宜」区间只算软提示', () => {
  const pool = mkPool('main');
  assert.equal(evaluate({ residual: 0.5, ph: 7.0 }, pool).ok, true);
  assert.equal(evaluate({ residual: 0.5, ph: 7.8 }, pool).ok, true);
  assert.deepEqual(evaluate({ residual: 0.5, ph: 6.9 }, pool).hard, ['ph']);
  assert.deepEqual(evaluate({ residual: 0.5, ph: 7.9 }, pool).hard, ['ph']);
  const turb = evaluate({ residual: 0.5, ph: 7.4, turbidity: 1.1 }, pool);
  assert.deepEqual(turb.hard, ['turbidity']);
  assert.equal(evaluate({ residual: 0.5, ph: 7.4, turbidity: 1 }, pool).ok, true);
  const warm = evaluate({ residual: 0.5, ph: 7.4, waterTemp: 31 }, pool);
  assert.equal(warm.ok, true);           // 软指标不判硬
  assert.deepEqual(warm.soft, ['waterTemp']);
  assert.equal(evaluate({ residual: 0.5, ph: 7.4, waterTemp: 23 }, pool).soft.length, 0);
});

test('evaluate：浸脚消毒池只管余氯 5~10（无 pH 要求）；缺 pH 的泳池记录直接拒绝', () => {
  const foot = mkPool('foot', { kind: 'footbath' });
  assert.equal(evaluate({ residual: 5 }, foot).ok, true);
  assert.equal(evaluate({ residual: 10 }, foot).ok, true);
  assert.equal(evaluate({ residual: 4.9 }, foot).items.residual.level, 'low');
  assert.equal(evaluate({ residual: 10.1 }, foot).items.residual.level, 'high');
  const main = mkPool('main');
  assert.throws(() => evaluate({ residual: 0.5 }, main), /pH 读数缺失/);
  assert.throws(() => evaluate({ ph: 7.4 }, main), /余氯读数缺失/);
});

test('badge：达标/偏高偏低/水温提示三种话术', () => {
  const pool = mkPool('main');
  assert.equal(badge({ residual: 0.5, ph: 7.4 }, pool), '✅ 达标');
  assert.match(badge({ residual: 1.5, ph: 7.4 }, pool), /余氯偏高/);
  assert.match(badge({ residual: 0.1, ph: 6.5 }, pool), /余氯偏低/);
  assert.match(badge({ residual: 0.1, ph: 6.5 }, pool), /pH偏低/);
  assert.match(badge({ residual: 0.5, ph: 7.4, waterTemp: 31 }, pool), /水温偏高.*23~30 ℃/);
  const foot = mkPool('foot', { kind: 'footbath' });
  assert.match(badge({ residual: 11 }, foot), /余氯偏高/);
});

// ---------------------------------------------------------------------------
// 落账门禁（异常不许裸奔进台账）
// ---------------------------------------------------------------------------

test('addRecord：水池/日期/时点/读数四重门禁；同池同时点重复拒绝、复测加测不限次', () => {
  const s = baseState();
  rec(s, { poolId: 'main', dateISO: T, slot: 'open', residual: 0.5, ph: 7.4 });
  assert.equal(s.records.length, 1);
  assert.throws(() => rec(s, { poolId: 'ghost', dateISO: T, slot: 'open', residual: 0.5, ph: 7.4 }), /水池不存在/);
  assert.throws(() => rec(s, { poolId: 'main', dateISO: '2026-09-06', slot: 'open', residual: 0.5, ph: 7.4 }), /未来/);
  assert.throws(() => rec(s, { poolId: 'main', dateISO: T, slot: 'night', residual: 0.5, ph: 7.4 }), /时点非法/);
  assert.throws(() => rec(s, { poolId: 'main', dateISO: T, slot: 'open', residual: 0.5, ph: 7.4 }), /已检过/);
  assert.doesNotThrow(() => rec(s, { poolId: 'main', dateISO: T, slot: 'extra', residual: 0.6, ph: 7.5 }));
  assert.throws(() => rec(s, { poolId: 'main', dateISO: T, slot: 'mid', residual: -1, ph: 7.4 }), /非负数字/);
  assert.throws(() => rec(s, { poolId: 'main', dateISO: T, slot: 'mid', residual: 0.5, ph: 8 }), /超线必须填写处置说明/);
  assert.doesNotThrow(() => rec(s, { poolId: 'main', dateISO: T, slot: 'mid', residual: 0.5, ph: 7.4 }));
});

test('addRecord：泳池缺 pH 拒绝；pH 越界拒绝；浸脚池无 pH 要求', () => {
  const s = baseState();
  assert.throws(() => rec(s, { poolId: 'main', residual: 0.5, ph: null }), /pH 读数必须/);
  assert.throws(() => rec(s, { poolId: 'main', residual: 0.5, ph: 15 }), /pH 读数必须/);
  assert.doesNotThrow(() => rec(s, { poolId: 'foot', residual: 6 }));
});

test('addRecord：超硬限值必须留处置说明（水温软提示不强制）', () => {
  const s = baseState();
  assert.throws(() => rec(s, { poolId: 'main', residual: 1.5, ph: 7.4, action: '' }), /处置说明/);
  const { record } = rec(s, { poolId: 'main', residual: 1.5, ph: 7.4, action: '停止入场，加大补氯循环，两小时后复测' });
  assert.equal(record.anomaly.action, '停止入场，加大补氯循环，两小时后复测');
  const { record: warm } = rec(s, { poolId: 'kids', residual: 0.5, ph: 7.4, waterTemp: 33 });
  assert.equal(warm.anomaly, undefined); // 软指标登记不强制处置
});

// ---------------------------------------------------------------------------
// 复测闭环（处置 → 复测达标 → 闭环；未达标不闭环）
// ---------------------------------------------------------------------------

test('复测闭环：达标闭环写回 closedBy/closedAt；复测仍超线拒绝闭环', () => {
  const s = baseState();
  const { record: bad } = rec(s, { poolId: 'main', dateISO: T, slot: 'open', residual: 1.5, ph: 7.4, action: '加大补氯', createdAt: `${T}T08:00:00.000Z` });
  assert.throws(() => rec(s, { poolId: 'kids', slot: 'extra', residual: 0.5, ph: 7.4, recheckOf: bad.id }), /同一个池/);
  assert.throws(() => rec(s, { poolId: 'main', slot: 'extra', residual: 1.8, ph: 7.4, recheckOf: bad.id, action: '继续补氯' }), /复测仍超线/);
  const { record: okRec } = rec(s, { poolId: 'main', slot: 'extra', residual: 0.7, ph: 7.4, recheckOf: bad.id, createdAt: `${T}T10:00:00.000Z` });
  assert.equal(okRec.recheckOf, bad.id);
  assert.equal(bad.anomaly.closedBy, okRec.id);
  assert.equal(bad.anomaly.closedAt, `${T}T10:00:00.000Z`);
  assert.throws(() => rec(s, { poolId: 'main', slot: 'extra', residual: 0.6, ph: 7.4, recheckOf: bad.id }), /已闭环/);
  assert.throws(() => rec(s, { poolId: 'main', slot: 'extra', residual: 0.6, ph: 7.4, recheckOf: 'r-ghost' }), /复测目标/);
});

test('removeRecord：删除记录；删除闭环记录让异常自动回到「待闭环」', () => {
  const s = baseState();
  const { record: bad } = rec(s, { poolId: 'main', residual: 1.5, ph: 7.4, action: '加大补氯' });
  const { record: okRec } = rec(s, { poolId: 'main', slot: 'extra', residual: 0.7, ph: 7.4, recheckOf: bad.id });
  assert.equal(openAnomalies(s).length, 0);
  removeRecord(s, okRec.id);
  assert.equal(bad.anomaly.closedBy, undefined);
  assert.equal(openAnomalies(s).length, 1);
  removeRecord(s, bad.id);
  assert.equal(openAnomalies(s).length, 0);
  assert.throws(() => removeRecord(s, 'r-ghost'), /不存在/);
});

test('openAnomalies：只列未闭环，按发生时间倒序', () => {
  const s = baseState();
  rec(s, { poolId: 'main', residual: 1.5, ph: 7.4, action: 'a1', createdAt: '2026-09-03T08:00:00.000Z', dateISO: '2026-09-03' });
  rec(s, { poolId: 'kids', residual: 0.1, ph: 7.4, action: 'a2', createdAt: '2026-09-04T08:00:00.000Z', dateISO: '2026-09-04' });
  const open = openAnomalies(s);
  assert.deepEqual(open.map((r) => r.anomaly.action), ['a2', 'a1']);
});

// ---------------------------------------------------------------------------
// 今日看板与打卡习惯
// ---------------------------------------------------------------------------

test('todayBoard：未检点名、达标徽章、异常处置中', () => {
  const s = baseState();
  rec(s, { poolId: 'main', slot: 'open', residual: 0.5, ph: 7.4, createdAt: `${T}T07:30:00.000Z` });
  rec(s, { poolId: 'foot', slot: 'open', residual: 11, action: '兑水稀释', createdAt: `${T}T07:35:00.000Z` });
  const board = todayBoard(s, T);
  assert.equal(board.rows.length, 3);
  const main = board.rows.find((r) => r.pool.id === 'main');
  const kids = board.rows.find((r) => r.pool.id === 'kids');
  const foot = board.rows.find((r) => r.pool.id === 'foot');
  assert.equal(main.checked, true);
  assert.equal(main.count, 1);
  assert.match(main.badge, /✅/);
  assert.equal(kids.checked, false);
  assert.deepEqual(board.missing.map((p) => p.id), ['kids']);
  assert.match(foot.badge, /❌/);
  assert.equal(board.anomalyOpen.length, 1);
});

test('streakDays：连续全检天数；今天没检完从昨天起算；断档归零', () => {
  const s = baseState();
  for (let d = 4; d >= 1; d -= 1) {
    const date = addDays(T, -d);
    rec(s, { poolId: 'main', dateISO: date, residual: 0.5, ph: 7.4, createdAt: `${date}T07:30:00.000Z` });
    rec(s, { poolId: 'kids', dateISO: date, residual: 0.5, ph: 7.4, createdAt: `${date}T07:35:00.000Z` });
    rec(s, { poolId: 'foot', dateISO: date, residual: 6, createdAt: `${date}T07:40:00.000Z` });
  }
  // 今天没检：从昨天起算 = 4 天
  assert.deepEqual(streakDays(s, T), { streak: 4, started: true });
  // 今天只检主池：仍从昨天起算
  rec(s, { poolId: 'main', dateISO: T, residual: 0.5, ph: 7.4 });
  assert.equal(streakDays(s, T).streak, 4);
  // 今天三池全检：含今天 = 5 天
  rec(s, { poolId: 'kids', dateISO: T, residual: 0.5, ph: 7.4 });
  rec(s, { poolId: 'foot', dateISO: T, residual: 6 });
  assert.equal(streakDays(s, T).streak, 5);
  // 昨天断档：昨天之前全有也没用
  const s2 = baseState();
  rec(s2, { poolId: 'main', dateISO: addDays(T, -3), residual: 0.5, ph: 7.4 });
  rec(s2, { poolId: 'kids', dateISO: addDays(T, -3), residual: 0.5, ph: 7.4 });
  rec(s2, { poolId: 'foot', dateISO: addDays(T, -3), residual: 6 });
  assert.deepEqual(streakDays(s2, T), { streak: 0, started: false });
});

// ---------------------------------------------------------------------------
// 证照与预警
// ---------------------------------------------------------------------------

test('expiryLevel：边界（-1 过期 / 0 与 30 临期 / 31 正常）与提前天数参数', () => {
  assert.equal(expiryLevel('2026-09-04', T), 'expired');
  assert.equal(expiryLevel('2026-09-05', T), 'soon');
  assert.equal(expiryLevel('2026-10-05', T), 'soon');
  assert.equal(expiryLevel('2026-10-06', T), 'ok');
  assert.equal(expiryLevel('2026-10-20', T, 60), 'soon');
});

test('expiryAlerts：许可证/健康证/检测报告聚合点名，正常项过滤，按到期日排序', () => {
  const s = baseState();
  s.certs.push({ id: 'c2', name: '陈救生', role: '救生员', expiry: addDays(T, 10) });
  s.reports[0].nextDue = addDays(T, -3);
  const alerts = expiryAlerts(s, T, 30);
  assert.deepEqual(alerts.map((a) => a.kind), ['report', 'cert']);
  assert.match(alerts[0].label, /XX 检测/);
  assert.match(alerts[1].label, /陈救生/);
  assert.equal(alerts.length, 2); // 许可证 2028、李教练 2027 都正常
});

// ---------------------------------------------------------------------------
// 台账体检（应检守恒）与月报
// ---------------------------------------------------------------------------

test('audit：应检守恒（足额检次 + 缺检检次 == 应检检次），缺检点名带实检/应检', () => {
  const s = baseState();
  // 只检 9-03、9-04 两天，主池 9-03 只检一次（欠一次）、9-04 两次足额
  for (const date of ['2026-09-03', '2026-09-04']) {
    rec(s, { poolId: 'main', dateISO: date, slot: 'open', residual: 0.5, ph: 7.4 });
    rec(s, { poolId: 'kids', dateISO: date, slot: 'open', residual: 0.5, ph: 7.4 });
    rec(s, { poolId: 'kids', dateISO: date, slot: 'mid', residual: 0.5, ph: 7.4 });
    rec(s, { poolId: 'foot', dateISO: date, slot: 'open', residual: 6 });
  }
  rec(s, { poolId: 'main', dateISO: '2026-09-04', slot: 'mid', residual: 0.5, ph: 7.4 });
  const a = audit(s, '2026-09-01', '2026-09-05', T);
  // 应检：5 天 × 3 池（池 8-01 起在用）× 每日 2 = 30 检次
  assert.equal(a.pairTotal, 30);
  assert.equal(a.doneChecks + a.missingChecks, a.pairTotal);
  // 足额：kids 两天各 2 次 = 4；main 9-03 封顶 1、9-04 封顶 2 = 3；foot 两天各 1 = 2 → 共 9
  assert.equal(a.doneChecks, 9);
  assert.equal(a.missingChecks, 21);
  assert.equal(a.missing.length, 12); // 15 池·日 - 3 个足额（kids 两天 + main 9-04）
  const mainEarly = a.missing.find((m) => m.date === '2026-09-03' && m.poolId === 'main');
  assert.deepEqual([mainEarly.have, mainEarly.need], [1, 2]);
  const main4 = a.missing.find((m) => m.date === '2026-09-04' && m.poolId === 'main');
  assert.equal(main4, undefined); // 主池 9-04 两次足额
});

test('audit：池投用日前的日期不计应检；每日频次参数收紧口径；区间边界收敛', () => {
  const s = baseState();
  s.pools.push(mkPool('new', { name: '新池', since: '2026-09-04' }));
  rec(s, { poolId: 'new', dateISO: '2026-09-04', slot: 'open', residual: 0.5, ph: 7.4 });
  rec(s, { poolId: 'new', dateISO: '2026-09-04', slot: 'mid', residual: 0.5, ph: 7.4 });
  rec(s, { poolId: 'new', dateISO: '2026-09-05', slot: 'open', residual: 0.5, ph: 7.4 });
  s.settings.dailyRequired = 1;
  const a = audit(s, '2026-09-01', '2026-09-30', T);
  // 新池 9-01、9-02、9-03 不在应检口径；9-04 两次足额；9-05 一次足额
  assert.equal(a.missing.some((m) => m.poolId === 'new' && m.date === '2026-09-01'), false);
  assert.equal(a.missing.some((m) => m.poolId === 'new' && m.date === '2026-09-05'), false);
  assert.equal(a.toISO, T); // 未来日期收敛到今天
  assert.throws(() => audit(s, '2026-09-10', '2026-09-01', T), /晚于截止/);
  assert.throws(() => audit(s, '2026-09-20', '2026-09-30', T), /未来/);
});

test('audit：达标率、异常闭环率与平均闭环时长', () => {
  const s = baseState();
  rec(s, { poolId: 'main', dateISO: '2026-09-04', slot: 'open', residual: 1.5, ph: 7.4, action: '加大补氯', createdAt: '2026-09-04T08:00:00.000Z' });
  rec(s, { poolId: 'main', dateISO: '2026-09-04', slot: 'extra', residual: 0.6, ph: 7.4, recheckOf: s.records[0].id, createdAt: '2026-09-04T12:00:00.000Z' });
  rec(s, { poolId: 'kids', dateISO: '2026-09-04', slot: 'open', residual: 0.5, ph: 7.4 });
  rec(s, { poolId: 'foot', dateISO: '2026-09-04', slot: 'open', residual: 11, action: '兑水稀释' }); // 未闭环
  const a = audit(s, '2026-09-04', '2026-09-04', T);
  assert.equal(a.recordCount, 4);
  assert.equal(a.anomalies, 2);
  assert.equal(a.anomaliesClosed, 1);
  assert.equal(Math.round(a.avgClosureHours * 10) / 10, 4.0);
  // 达标率：4 条中 2 条达标（0.6 复测 + kids）
  assert.equal(a.passRate, 0.5);
});

test('monthlyStats：按月隔离、跨年隔离、非法与未来月份拒绝', () => {
  const s = baseState();
  rec(s, { poolId: 'main', dateISO: '2026-08-31', slot: 'open', residual: 0.5, ph: 7.4 });
  rec(s, { poolId: 'main', dateISO: '2026-09-01', slot: 'open', residual: 0.5, ph: 7.4 });
  assert.equal(monthlyStats(s, '2026-09', T).recordCount, 1);
  assert.equal(monthlyStats(s, '2026-08', T).recordCount, 1);
  assert.equal(monthlyStats(s, '2025-09', T).recordCount, 0);
  assert.throws(() => monthlyStats(s, '2026-9', T), /非法月份/);
  assert.throws(() => monthlyStats(s, '2026-10', T), /未来/);
});

// ---------------------------------------------------------------------------
// 三通道出证（速报文本 / 泳客公示页 / 迎检台账包）
// ---------------------------------------------------------------------------

function demoState() {
  const s = baseState();
  rec(s, { poolId: 'main', slot: 'open', residual: 0.6, ph: 7.4, turbidity: 0.4, waterTemp: 27, createdAt: `${T}T07:30:00.000Z` });
  rec(s, { poolId: 'kids', slot: 'open', residual: 0.5, ph: 7.4, waterTemp: 29, createdAt: `${T}T07:40:00.000Z` });
  rec(s, { poolId: 'foot', slot: 'open', residual: 6, createdAt: `${T}T07:45:00.000Z` });
  return s;
}

test('latestByPool：公示口径取当日最新一条', () => {
  const s = demoState();
  rec(s, { poolId: 'main', slot: 'extra', residual: 0.8, ph: 7.5, createdAt: `${T}T14:00:00.000Z` });
  const rows = latestByPool(s, T);
  const main = rows.find((r) => r.pool.id === 'main');
  assert.equal(main.latest.residual, 0.8);
  assert.equal(main.time, '14:00');
});

test('dailyText：同输入同输出；读数、判定、未检点名、口径说明与落款齐全', () => {
  const s = demoState();
  const t1 = dailyText(s, T);
  const t2 = dailyText(s, T);
  assert.equal(t1, t2);
  assert.match(t1, /【今日水质速报】2026-09-05/);
  assert.match(t1, /「25m 主池」：余氯 0\.6 · pH 7\.4 · 浊度 0\.4NTU · 水温 27\.0℃　✅ 达标（07:30）/);
  assert.match(t1, /「入口浸脚池」：余氯 6\.0（合规 5~10 mg\/L）　✅ 达标（07:45）/);
  assert.match(t1, /GB 37488-2019/);
  assert.match(t1, /清波游泳馆 · 卫生许可证号 粤卫公证字〔2024〕第0385号/);
  // 儿童池今天没检 → 如实点名
  const s2 = demoState();
  s2.records = s2.records.filter((r) => r.poolId !== 'kids');
  const t3 = dailyText(s2, T);
  assert.match(t3, /「儿童池」：今日未检 ⚠/);
  // 覆盖属地口径后文案跟着变
  const s3 = demoState();
  s3.settings.limits = validateLimits({ residual: [0.5, 1.0] });
  assert.match(dailyText(s3, T), /游离性余氯 0\.5~1\.0 mg\/L/);
});

test('dailyText：没有水池时给出人话报错', () => {
  const s = baseState();
  s.pools = [];
  assert.throws(() => dailyText(s, T), /把池子建起来/);
});

test('publicHtml：单文件离线可用（无外部资源），含许可证、达标徽章、未检红字与签字栏；XSS 转义', () => {
  const s = demoState();
  s.venue.name = '清波<script>alert(1)</script>游泳馆';
  s.pools[0].name = '<img src=x onerror=alert(1)>';
  s.records = s.records.filter((r) => r.poolId !== 'kids');
  const html = publicHtml(s, T);
  assert.ok(!/src=["']http/.test(html));
  assert.ok(!/href=["']http/.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /粤卫公证字〔2024〕第0385号/);
  assert.match(html, /今日未检/);
  assert.match(html, /水质负责人签字/);
  assert.match(html, /GB 37488-2019/);
  assert.match(html, /更新 2026-09-05/);
});

test('publicHtml：异常处置中的池如实标注，不粉饰', () => {
  const s = demoState();
  s.records.push({
    id: 'r-bad', poolId: 'kids', dateISO: T, slot: 'mid', residual: 1.6, ph: 7.4,
    opNote: '', createdAt: `${T}T15:00:00.000Z`, anomaly: { action: '停泳加大循环' },
  });
  const html = publicHtml(s, T);
  assert.match(html, /❌ 余氯偏高/);
  assert.match(html, /处置中，完成后复测/);
});

test('auditHtml：体检卡数字、缺检点名、处置记录与签字栏齐全；单文件离线可用', () => {
  const s = baseState();
  rec(s, { poolId: 'main', dateISO: '2026-09-04', slot: 'open', residual: 1.5, ph: 7.4, action: '加大补氯<script>' });
  const html = auditHtml(s, '2026-09-01', '2026-09-30', T);
  assert.ok(!/src=["']http/.test(html));
  assert.match(html, /游泳场所水质检测台账/);
  assert.match(html, /应检检次（池·日 × 每日 2）/);
  assert.match(html, /30 检次/);
  assert.match(html, /缺检点名：/);
  assert.match(html, /2026-09-04/);
  assert.match(html, /加大补氯&lt;script&gt;/);
  assert.ok(!html.includes('加大补氯<script>'));
  assert.match(html, /水质负责人（签字）/);
  assert.match(html, /卫监督发〔2007〕205 号/);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = demoState();
  rec(s, { poolId: 'kids', slot: 'mid', residual: 0.4, ph: 7.3 });
  const round = importBundle(exportBundle(s));
  assert.ok(round.ok);
  assert.deepEqual(round.state.records, s.records);
  assert.deepEqual(round.state.pools, s.pools);
  assert.equal(round.state.venue.name, '清波游泳馆');
});

test('importBundle：非 JSON / 错误应用 / 坏结构 / 高版本一律整体拒绝', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.match(importBundle('not json').error, /JSON/);
  const bad = importBundle(JSON.stringify({ app: 'carsheet', version: 1, state: {} }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是泳清单/);
  const incomplete = importBundle(JSON.stringify({
    app: 'poolclear', version: STATE_VERSION,
    state: { venue: {}, pools: [], records: 'nope', certs: [], reports: [], settings: {} },
  }));
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /结构不完整/);
  const future = importBundle(JSON.stringify({
    app: 'poolclear', version: STATE_VERSION + 1,
    state: { venue: {}, pools: [], records: [], certs: [], reports: [], settings: {} },
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
  assert.deepEqual(Object.keys(POOL_KINDS), ['main', 'kids', 'footbath', 'other']);
  assert.deepEqual(Object.keys(SLOTS), ['open', 'mid', 'close', 'extra']);
  assert.equal(POOL_KINDS.footbath.label, '浸脚消毒池');
  assert.equal(SLOTS.open.label, '开放前首检');
  assert.equal(DISINFECT_KINDS.dosing.label, '自动投药/次氯酸钠');
  assert.equal(activePools(baseState()).length, 3);
});
