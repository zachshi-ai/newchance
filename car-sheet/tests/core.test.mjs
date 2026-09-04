/**
 * tests/core.test.mjs — 车况单 CarSheet 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, fmtYuan, fmtKm, fmtTieUp, escapeHtml,
  CAR_SOURCES, COST_KINDS, DISCLOSURE_FIELDS, DISCLOSURE_STATUS,
  newDisclosure, assertDisclosure, totalCostCents, settle, agingLevel,
  unverifiedKeys, disclosureSummary, sellWarnings, sellCar, undoSell,
  addCost, removeCost, inventoryRows, ledgerRows, monthlyReport,
  disclosureText, disclosureHtml,
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

test('addDays 跨月/跨年收敛', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('daysUntil 与 monthKey 跨年正确', () => {
  assert.equal(daysUntil('2026-12-31', T), 117);
  assert.equal(daysUntil('2026-09-05', T), 0);
  assert.equal(daysUntil('2026-09-04', T), -1);
  assert.equal(monthKey('2026-09-05'), '2026-09');
  assert.equal(monthKey('2026-01-01'), '2026-01');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('fmtYuan 只吃整数分；fmtKm 千分位；fmtTieUp 万元·天量纲', () => {
  assert.equal(fmtYuan(7800000), '¥78000.00');
  assert.equal(fmtYuan(305), '¥3.05');
  assert.throws(() => fmtYuan(12.5));
  assert.equal(fmtKm(62000), '62,000 km');
  assert.equal(fmtKm(0), '0 km');
  assert.equal(fmtKm(null), '—');
  assert.throws(() => fmtKm(-5));
  assert.equal(fmtTieUp(4070000000), '4070.0 万元·天'); // 4070 万分·天量纲换算
  assert.equal(fmtTieUp(528000000), '528.0 万元·天'); // 8 万元收车 × 66 天
  assert.equal(fmtTieUp(0), '0.0 万元·天');
  assert.throws(() => fmtTieUp(1.5));
});

// ---------------------------------------------------------------------------
// 车档与披露模板
// ---------------------------------------------------------------------------

function mkCar(id, over = {}) {
  return {
    id, plate: '粤A·12345', vinTail: 'AB12CD', brand: '丰田凯美瑞 2019款',
    regYear: 2019, displayKm: 62000, source: 'person',
    buyCents: 7800000, buyISO: '2026-07-01', note: '',
    status: 'stock', disclosure: newDisclosure(), createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function baseState() {
  return {
    dealer: { name: '老周车务', phone: '13800001234' },
    cars: [mkCar('v1'), mkCar('v2', { brand: '本田雅阁 2021款', buyCents: 6580000, buyISO: '2026-08-06' })],
    costs: [],
    settings: { warnDays: 45, issueDays: 75 },
    events: [],
  };
}

test('newDisclosure 建档即九项全「未核查」；字段集与状态集基线', () => {
  const d = newDisclosure();
  assert.deepEqual(Object.keys(d), Object.keys(DISCLOSURE_FIELDS));
  assert.equal(Object.keys(DISCLOSURE_FIELDS).length, 9);
  for (const k of Object.keys(d)) {
    assert.equal(d[k].status, 'unknown');
    assert.equal(d[k].note, '');
  }
  assert.deepEqual(Object.keys(DISCLOSURE_STATUS), ['ok', 'issue', 'unknown']);
  assert.deepEqual(Object.keys(CAR_SOURCES), ['trade', 'person', 'peer', 'auction', 'other']);
  assert.deepEqual(Object.keys(COST_KINDS), ['repair', 'beauty', 'part', 'transfer', 'other']);
  assert.throws(() => assertDisclosure({ accident: { status: 'nope' } }), /披露项缺失/);
});

test('totalCostCents：收车价 + Σ整备，只算本车成本，拒绝非整数收车价', () => {
  const car = mkCar('v1');
  const costs = [
    { id: 'e1', carId: 'v1', cents: 260000 },
    { id: 'e2', carId: 'v1', cents: 80000 },
    { id: 'e3', carId: 'v2', cents: 9900000 }, // 别的车的不算
  ];
  assert.equal(totalCostCents(car, costs), 7800000 + 260000 + 80000);
  assert.equal(totalCostCents(car, []), 7800000);
  assert.throws(() => totalCostCents({ ...car, buyCents: 78.5 }, []), /整数分/);
});

test('settle：在库车按今天计时，资金占用 = 总成本 × 在库天数；当天收车为 0', () => {
  const car = mkCar('v1', { buyISO: '2026-07-01' }); // 7-01 → 9-05 = 66 天
  const costs = [{ id: 'e1', carId: 'v1', cents: 200000 }];
  const s = settle(car, costs, T);
  assert.equal(s.totalCostCents, 8000000);
  assert.equal(s.daysInStock, 66);
  assert.equal(s.tieUpCents, 8000000 * 66);
  assert.equal(s.profitCents, null);
  const fresh = mkCar('fresh', { buyISO: T });
  const sf = settle(fresh, [], T);
  assert.equal(sf.daysInStock, 0);
  assert.equal(sf.tieUpCents, 0);
});

test('settle：已售车按售出日结算，毛利 = 售价 − 总成本（跨月口径）', () => {
  const car = mkCar('v1', {
    status: 'sold', buyISO: '2026-06-20', soldISO: '2026-08-10', sellCents: 8680000,
  });
  const s = settle(car, [{ id: 'e1', carId: 'v1', cents: 340000 }], T);
  assert.equal(s.daysInStock, 51); // 6-20 → 8-10
  assert.equal(s.totalCostCents, 8140000);
  assert.equal(s.profitCents, 8680000 - 8140000);
});

test('agingLevel：黄线/红线边界（44/45/74/75）与参数覆盖、参数合法性', () => {
  assert.equal(agingLevel(44), 'ok');
  assert.equal(agingLevel(45), 'warn');
  assert.equal(agingLevel(74), 'warn');
  assert.equal(agingLevel(75), 'issue');
  assert.equal(agingLevel(10, 7, 14), 'warn');
  assert.equal(agingLevel(20, 7, 14), 'issue');
  assert.throws(() => agingLevel(30, 75, 45), /黄线/);
  assert.throws(() => agingLevel(-1), /非法/);
});

// ---------------------------------------------------------------------------
// 披露体检与售出门诊（亮灯不阻止）
// ---------------------------------------------------------------------------

test('unverifiedKeys / disclosureSummary：三态计数与未核查清单', () => {
  const car = mkCar('v1');
  car.disclosure.mortgage = { status: 'ok', note: '' };
  car.disclosure.accident = { status: 'issue', note: '右后门更换' };
  const unknown = unverifiedKeys(car);
  assert.equal(unknown.length, 7);
  assert.ok(!unknown.includes('mortgage'));
  const sum = disclosureSummary(car);
  assert.deepEqual(sum, { ok: 1, issue: 1, unknown: 7 });
});

test('sellWarnings：未核查点名具体项；已知异常要求写入披露单', () => {
  const car = mkCar('v1');
  const w = sellWarnings(car);
  assert.equal(w.length, 1);
  assert.match(w[0], /9 项车况「未核查」/);
  assert.match(w[0], /结构·事故/);
  car.disclosure.mileage = { status: 'issue', note: '与维保记录差 2 万公里' };
  const w2 = sellWarnings(car);
  assert.equal(w2.length, 2);
  assert.match(w2[1], /里程一致性/);
  assert.match(w2[1], /签字确认/);
});

test('sellWarnings：九项全核查完且无异常时不亮灯', () => {
  const car = mkCar('v1');
  for (const k of Object.keys(DISCLOSURE_FIELDS)) car.disclosure[k] = { status: 'ok', note: '' };
  assert.equal(sellWarnings(car).length, 0);
});

// ---------------------------------------------------------------------------
// 售出落账与撤销（毛利永远由流水推导）
// ---------------------------------------------------------------------------

test('sellCar：落账成功并返回结算与门诊警告；改一笔整备账，毛利自动跟变', () => {
  const s = baseState();
  const { car, warnings, settlement } = sellCar(s, {
    carId: 'v1', sellCents: 8680000, soldISO: '2026-08-20', buyer: '王先生',
  });
  assert.equal(car.status, 'sold');
  assert.equal(car.soldISO, '2026-08-20');
  assert.equal(car.buyer, '王先生');
  assert.equal(warnings.length, 1); // 全未核查 → 门诊亮灯但不阻止
  assert.equal(settlement.profitCents, 880000);
  assert.equal(settlement.daysInStock, 50);
  // 卖出后又补一笔整备账？不允许——但撤销后可以，账随流水变
  assert.throws(() => addCost(s, { id: 'e9', carId: 'v1', dateISO: T, kind: 'beauty', cents: 10000 }), /成本账已结/);
  undoSell(s, 'v1');
  addCost(s, { id: 'e9', carId: 'v1', dateISO: T, kind: 'beauty', cents: 100000 });
  const { settlement: again } = sellCar(s, { carId: 'v1', sellCents: 8680000, soldISO: '2026-08-20' });
  assert.equal(again.profitCents, 780000); // 毛利被新成本挤掉 1000 元
});

test('sellCar：重复售出、售出日早于收车日、非法售价、幽灵车一律拒绝', () => {
  const s = baseState();
  sellCar(s, { carId: 'v1', sellCents: 8680000, soldISO: '2026-08-20' });
  assert.throws(() => sellCar(s, { carId: 'v1', sellCents: 1, soldISO: '2026-08-21' }), /重复落账/);
  const s2 = baseState();
  assert.throws(() => sellCar(s2, { carId: 'v1', sellCents: 8680000, soldISO: '2026-06-30' }), /早于收车日/);
  assert.throws(() => sellCar(s2, { carId: 'v1', sellCents: 86800.5, soldISO: '2026-08-20' }), /整数分/);
  assert.throws(() => sellCar(s2, { carId: 'v1', sellCents: -1, soldISO: '2026-08-20' }), /整数分/);
  assert.throws(() => sellCar(s2, { carId: 'ghost', sellCents: 1, soldISO: T }), /车辆不存在/);
});

test('undoSell：回到在库并清空售出字段；在库车撤销报错', () => {
  const s = baseState();
  sellCar(s, { carId: 'v1', sellCents: 8680000, soldISO: '2026-08-20' });
  const car = undoSell(s, 'v1');
  assert.equal(car.status, 'stock');
  assert.equal(car.soldISO, undefined);
  assert.equal(car.sellCents, undefined);
  assert.equal(car.buyer, undefined);
  assert.equal(settle(car, s.costs, T).daysInStock, 66); // 自动恢复计时
  assert.throws(() => undoSell(s, 'v1'), /无需撤销/);
  assert.throws(() => undoSell(s, 'ghost'), /车辆不存在/);
});

// ---------------------------------------------------------------------------
// 整备落账（账实一致的门禁）
// ---------------------------------------------------------------------------

test('addCost：类型/金额/日期/售出状态四重门禁', () => {
  const s = baseState();
  addCost(s, { id: 'e1', carId: 'v1', dateISO: '2026-07-10', kind: 'repair', note: '更换前轮轴承', cents: 260000 });
  assert.equal(s.costs.length, 1);
  assert.throws(() => addCost(s, { id: 'e2', carId: 'ghost', dateISO: T, kind: 'repair', cents: 1 }), /车辆不存在/);
  assert.throws(() => addCost(s, { id: 'e2', carId: 'v1', dateISO: '2026-06-30', kind: 'repair', cents: 1 }), /早于收车日/);
  assert.throws(() => addCost(s, { id: 'e2', carId: 'v1', dateISO: T, kind: 'wash', cents: 1 }), /类型非法/);
  assert.throws(() => addCost(s, { id: 'e2', carId: 'v1', dateISO: T, kind: 'repair', cents: 10.5 }), /整数分/);
  assert.throws(() => addCost(s, { id: 'e2', carId: 'v1', dateISO: T, kind: 'repair', cents: -100 }), /整数分/);
  assert.throws(() => addCost(s, { id: 'e2', carId: 'v1', dateISO: '2026-09-05 ', kind: 'repair', cents: 100 }), /非法日期/);
});

test('removeCost：可删在库车的成本；删幽灵记录与已售车成本拒绝', () => {
  const s = baseState();
  addCost(s, { id: 'e1', carId: 'v1', dateISO: '2026-07-10', kind: 'repair', cents: 260000 });
  removeCost(s, 'e1');
  assert.equal(s.costs.length, 0);
  assert.throws(() => removeCost(s, 'e1'), /不存在/);
  addCost(s, { id: 'e2', carId: 'v1', dateISO: T, kind: 'beauty', cents: 80000 });
  sellCar(s, { carId: 'v1', sellCents: 8680000, soldISO: T });
  assert.throws(() => removeCost(s, 'e2'), /成本账已结/);
});

// ---------------------------------------------------------------------------
// 看板与账本
// ---------------------------------------------------------------------------

test('inventoryRows：只含在库车，按资金占用降序，带老化分级与未核查数', () => {
  const s = baseState();
  // v1：7-01 收车 66 天 ≥ 红线 75? 66 < 75 → warn；v2：8-06 收车 30 天 → ok
  s.cars.push(mkCar('v3', { brand: '埃安AION S', buyISO: '2026-06-18', buyCents: 4200000 }));
  s.cars[2].disclosure.accident = { status: 'issue', note: '营运车退役' };
  addCost(s, { id: 'e1', carId: 'v3', dateISO: '2026-06-20', kind: 'beauty', cents: 50000 });
  const rows = inventoryRows(s, T);
  // v1：780 万 × 66 天 = 5.15 亿分·天；v3：425 万 × 79 天 = 3.36 亿分·天；v2：658 万 × 30 天最低
  assert.deepEqual(rows.map((r) => r.car.id), ['v1', 'v3', 'v2']);
  assert.equal(rows[0].aging, 'warn'); // 66 天，黄线 45 与红线 75 之间
  assert.equal(rows[1].aging, 'issue'); // 6-18 → 9-05 = 79 天 ≥ 75
  assert.equal(rows[2].aging, 'ok'); // 30 天
  assert.equal(rows[1].unverified, 8); // 九项中一项已标 issue
});

test('ledgerRows：在库与已售全量倒序（按收车日），售出带毛利', () => {
  const s = baseState();
  sellCar(s, { carId: 'v1', sellCents: 8680000, soldISO: '2026-08-20' });
  const rows = ledgerRows(s, T);
  assert.deepEqual(rows.map((r) => r.car.id), ['v2', 'v1']); // v2 收车 8-06 最新
  const sold = rows.find((r) => r.car.id === 'v1');
  assert.equal(sold.profitCents, 880000);
  const stock = rows.find((r) => r.car.id === 'v2');
  assert.equal(stock.profitCents, null);
});

test('monthlyReport：收/售/毛利/周转/整备按月分组，跨年隔离，非法月份拒绝', () => {
  const cars = [
    mkCar('a', { buyISO: '2026-09-01', status: 'sold', soldISO: '2026-09-20', sellCents: 9000000, buyCents: 8000000 }),
    mkCar('b', { buyISO: '2026-09-10', status: 'sold', soldISO: '2026-09-30', sellCents: 7000000, buyCents: 6600000 }),
    mkCar('c', { buyISO: '2025-09-15', status: 'sold', soldISO: '2025-09-30', sellCents: 9999999, buyCents: 1 }),
    mkCar('d', { buyISO: '2026-08-01', status: 'stock' }),
  ];
  const costs = [
    { id: 'e1', carId: 'a', dateISO: '2026-09-02', cents: 100000 },
    { id: 'e2', carId: 'b', dateISO: '2026-08-30', cents: 50000 },
  ];
  const sep = monthlyReport(cars, costs, '2026-09');
  assert.equal(sep.boughtCount, 2);
  assert.equal(sep.soldCount, 2);
  // a：900 万 −（800 万 + 9 月整备 1 万）= 90 万；b：700 万 −（660 万 + 8 月整备 0.5 万）= 35 万
  // 毛利按全部整备成本算，不按整备发生月切——卖完的车结的是总账
  assert.equal(sep.profitCents, 900000 + 350000);
  assert.equal(sep.avgDays, 20); // (19 + 20) / 2 = 19.5 → 20
  assert.equal(sep.costCents, 100000); // 月度整备投入只按成本日期算
  const lastYear = monthlyReport(cars, costs, '2025-09');
  assert.equal(lastYear.soldCount, 1);
  assert.throws(() => monthlyReport(cars, costs, '2026-9'), /非法月份/);
  const empty = monthlyReport([], [], '2026-09');
  assert.deepEqual([empty.boughtCount, empty.soldCount, empty.profitCents, empty.avgDays, empty.costCents], [0, 0, 0, 0, 0]);
});

// ---------------------------------------------------------------------------
// 车况披露单（三通道）
// ---------------------------------------------------------------------------

function discState() {
  const s = baseState();
  s.cars[0].disclosure.mortgage = { status: 'ok', note: '已解除' };
  s.cars[0].disclosure.accident = { status: 'issue', note: '右后门更换（收车前）' };
  s.cars[0].disclosure.flood = { status: 'unknown', note: '建议第三方检测' };
  addCost(s, { id: 'e1', carId: 'v1', dateISO: '2026-07-10', kind: 'repair', note: '更换前轮轴承', cents: 260000 });
  addCost(s, { id: 'e2', carId: 'v1', dateISO: '2026-07-15', kind: 'beauty', cents: 80000 });
  return s;
}

test('disclosureText：同输入同输出；九项三态、整备流水与声明齐全', () => {
  const s = discState();
  const car = s.cars[0];
  const t1 = disclosureText({ car, costs: s.costs, dealer: s.dealer, todayISOStr: T });
  const t2 = disclosureText({ car, costs: s.costs, dealer: s.dealer, todayISOStr: T });
  assert.equal(t1, t2);
  assert.match(t1, /【车况披露单】丰田凯美瑞 2019款 · 粤A·12345/);
  assert.match(t1, /车行：老周车务（13800001234）/);
  assert.match(t1, /表显 62,000 km/);
  assert.match(t1, /结构·事故：⚠️ 有异常（右后门更换（收车前））/);
  assert.match(t1, /抵押·查封：✅ 正常（已解除）/);
  assert.match(t1, /水泡：❓ 未核查（建议第三方检测）/);
  assert.match(t1, /里程一致性：❓ 未核查/);
  assert.match(t1, /2026-07-10 维修整备：更换前轮轴承 ¥2600\.00/);
  assert.match(t1, /2026-07-15 美容清洗：— ¥800\.00/);
  assert.match(t1, /不等于没有问题/);
  assert.match(t1, /以双方签署的买卖合同及实车现状为准/);
});

test('disclosureText / disclosureHtml：车行名与买家注入的 HTML 被转义（XSS 防护）', () => {
  const s = discState();
  s.dealer.name = '老周<script>alert(1)</script>车务';
  const car = s.cars[0];
  const text = disclosureText({ car, costs: s.costs, dealer: s.dealer, todayISOStr: T });
  assert.match(text, /老周<script>alert\(1\)<\/script>车务/); // 文本通道原文保留
  const html = disclosureHtml({ car, costs: s.costs, dealer: s.dealer, todayISOStr: T });
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('disclosureHtml：单文件离线可用（无外部资源），含签字栏', () => {
  const s = discState();
  const html = disclosureHtml({ car: s.cars[0], costs: s.costs, dealer: s.dealer, todayISOStr: T });
  assert.ok(!/src=["']http/.test(html));
  assert.ok(!/href=["']http/.test(html));
  assert.match(html, /车况告知（卖方如实告知记录）/);
  assert.match(html, /整备记录/);
  assert.match(html, /买方（阅读并确认以上车况，签字）/);
  assert.match(html, /卖方（签字\/盖章）/);
});

test('disclosureText：无整备记录显示「（无）」；损坏的披露结构拒绝出单', () => {
  const s = baseState();
  const t = disclosureText({ car: s.cars[0], costs: [], dealer: s.dealer, todayISOStr: T });
  assert.match(t, /二、本店收车后整备记录\n  （无）/);
  const broken = mkCar('bad');
  delete broken.disclosure.recall;
  assert.throws(() => disclosureText({ car: broken, costs: [], dealer: s.dealer, todayISOStr: T }), /披露项缺失/);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = discState();
  sellCar(s, { carId: 'v1', sellCents: 8680000, soldISO: '2026-08-20' });
  const round = importBundle(exportBundle(s));
  assert.ok(round.ok);
  assert.deepEqual(round.state.cars, s.cars);
  assert.deepEqual(round.state.costs, s.costs);
  assert.equal(round.state.dealer.name, '老周车务');
});

test('importBundle：非 JSON / 错误应用 / 坏结构 / 高版本一律整体拒绝', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.match(importBundle('not json').error, /JSON/);
  const bad = importBundle(JSON.stringify({ app: 'classoff', version: 1, state: {} }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是车况单/);
  const incomplete = importBundle(JSON.stringify({
    app: 'carsheet', version: STATE_VERSION,
    state: { dealer: {}, cars: 'nope', costs: [], settings: {} },
  }));
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /结构不完整/);
  const future = importBundle(JSON.stringify({
    app: 'carsheet', version: STATE_VERSION + 1,
    state: { dealer: {}, cars: [], costs: [], settings: {} },
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
  assert.equal(DISCLOSURE_FIELDS.mileage.label, '里程一致性');
  assert.equal(COST_KINDS.transfer.label, '过户车务');
});
