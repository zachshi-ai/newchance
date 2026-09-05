/**
 * core.test.mjs — 危废账核心逻辑单元测试（node --test，零依赖）
 * 覆盖：守恒校验、整体拒绝、红字冲销回滚、FIFO 批次与超期分级、
 * 资质预警、联单待补、红线自查台、收益账整数分、迎检包确定性输出、
 * XSS 转义、导入导出往返。日期全部注入固定值，保证测试确定性。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertISO, addDays, daysUntil, fmtYuan, fmtQty, kgToMinor, escapeHtml,
  stockByItem, agingByItem, signedQty, addRecord, storageWarnings,
  licenseWarnings, pendingManifests, complianceChecks, todayActions,
  revenueReport, inspectionText, inspectionHtml, demoState,
  exportBundle, importBundle, AUTO_REPAIR_ITEM_TEMPLATES,
  RECORD_TYPES,
} from '../app/js/core.js';

const T0 = '2026-09-05';
const d = (n) => addDays(T0, n);

function fresh() {
  return {
    org: { name: '测试汽修厂', phone: '', address: '' },
    items: [
      { id: 'oil', name: '废机油', code: '900-214-08', unit: 'kg', capacityMinor: 500, note: '' },
      { id: 'bat', name: '废铅蓄电池', code: '900-052-31', unit: 'unit', capacityMinor: 0, note: '' },
    ],
    vendors: [
      { id: 'v1', name: '甲收集公司', licenseNo: 'X-001', licenseExpiryISO: d(200), phone: '' },
      { id: 'v2', name: '乙回收部', licenseNo: 'X-002', licenseExpiryISO: d(10), phone: '' },
    ],
    records: [],
    checkins: [],
    settings: {},
  };
}

function rec(state, partial, seq) {
  return addRecord(state, { id: `r${seq ?? (state.records.length + 1)}`, seq: seq ?? state.records.length + 1, ...partial });
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

test('assertISO 接受合法日期并拒绝非法格式', () => {
  assert.equal(assertISO('2026-02-28'), '2026-02-28');
  assert.throws(() => assertISO('2026-2-28'));
  assert.throws(() => assertISO('2026-13-01'));
  assert.throws(() => assertISO(123));
});

test('addDays / daysUntil 跨月与负数回退', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysUntil('2026-09-05', '2026-09-05'), 0);
  assert.equal(daysUntil('2026-08-01', '2026-09-05'), -35);
});

test('fmtYuan 整数分格式化（含负数与零头）', () => {
  assert.equal(fmtYuan(0), '¥0.00');
  assert.equal(fmtYuan(21000), '¥210.00');
  assert.equal(fmtYuan(12345), '¥123.45');
  assert.equal(fmtYuan(-5), '-¥0.05');
  assert.throws(() => fmtYuan(1.5));
});

test('fmtQty / kgToMinor：0.1kg 最小单位，杜绝浮点漂移', () => {
  assert.equal(fmtQty('kg', 125), '12.5 kg');
  assert.equal(fmtQty('kg', 5), '0.5 kg');
  assert.equal(fmtQty('unit', 6), '6 件');
  assert.equal(fmtQty('kg', -3), '-0.3 kg');
  assert.equal(kgToMinor('12.5'), 125);
  assert.equal(kgToMinor('0.1'), 1);
  assert.equal(kgToMinor(2.34), 23); // 四舍五入到 0.1kg
  assert.throws(() => kgToMinor('0'));
  assert.throws(() => kgToMinor('-1'));
  assert.throws(() => kgToMinor('abc'));
});

test('escapeHtml 覆盖五类危险字符', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('a')">&`),
    '&lt;img src=x onerror=&quot;alert(&#39;a&#39;)&quot;&gt;&amp;');
});

// ---------------------------------------------------------------------------
// 记账：守恒、整体拒绝、冲销
// ---------------------------------------------------------------------------

test('入库建库存、出库扣库存，存量守恒', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-10), qtyMinor: 400 });
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-5), qtyMinor: 250 });
  rec(s, { type: 'out', itemId: 'oil', dateISO: d(-1), qtyMinor: 300, vendorId: 'v1', manifestNo: 'SL-1', amountFen: 21000 });
  assert.equal(stockByItem(s).get('oil'), 350);
  const signed = s.records.reduce((a, r) => a + signedQty(r), 0);
  assert.equal(signed, 350); // 明细带符号和 == 存量
});

test('出库超过存量：整体拒绝、不部分入账', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-10), qtyMinor: 100 });
  assert.throws(() => rec(s, { type: 'out', itemId: 'oil', dateISO: d(-1), qtyMinor: 150, vendorId: 'v1' }), /超出存量/);
  assert.equal(s.records.length, 1); // 失败记录绝不落账
  assert.equal(stockByItem(s).get('oil'), 100);
});

test('非法数量/日期/接收方/金额全部拒绝', () => {
  const s = fresh();
  assert.throws(() => rec(s, { type: 'in', itemId: 'oil', dateISO: d(0), qtyMinor: 0 }), /正整数/);
  assert.throws(() => rec(s, { type: 'in', itemId: 'oil', dateISO: d(0), qtyMinor: -5 }), /正整数/);
  assert.throws(() => rec(s, { type: 'in', itemId: 'oil', dateISO: '2026-9-1', qtyMinor: 5 }), /非法日期/);
  assert.throws(() => rec(s, { type: 'in', itemId: 'ghost', dateISO: d(0), qtyMinor: 5 }), /品目不存在/);
  assert.throws(() => rec(s, { type: 'out', itemId: 'oil', dateISO: d(0), qtyMinor: 5, vendorId: 'ghost' }), /接收方不存在/);
  assert.throws(() => rec(s, { type: 'out', itemId: 'oil', dateISO: d(0), qtyMinor: 1, vendorId: 'v1', amountFen: -1 }), /非负整数分/);
});

test('件类品目按件整数记账，与 kg 类互不干扰', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'bat', dateISO: d(-8), qtyMinor: 4 });
  rec(s, { type: 'out', itemId: 'bat', dateISO: d(-2), qtyMinor: 4, vendorId: 'v2', amountFen: 12000 });
  assert.equal(stockByItem(s).get('bat'), 0);
  assert.equal(fmtQty('unit', 4), '4 件');
});

test('冲销出库：存量精确回滚、原记录保留、金额红字冲减', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-10), qtyMinor: 400 });
  const out = rec(s, { type: 'out', itemId: 'oil', dateISO: d(-1), qtyMinor: 300, vendorId: 'v1', amountFen: 21000 });
  assert.equal(stockByItem(s).get('oil'), 100);
  rec(s, { type: 'rev', refId: out.id });
  assert.equal(stockByItem(s).get('oil'), 400);
  assert.equal(s.records.length, 3); // 原记录保留 + 反向记录追加
  const revRec = s.records[2];
  assert.equal(revRec.type, 'rev');
  assert.equal(revRec.amountFen, -21000); // 收益账自动冲减
  assert.equal(revRec.refId, out.id);
});

test('冲销入库：原封未动可冲销；已部分转移必须先冲出库', () => {
  const s = fresh();
  const inRec = rec(s, { type: 'in', itemId: 'oil', dateISO: d(-10), qtyMinor: 400 });
  rec(s, { type: 'out', itemId: 'oil', dateISO: d(-1), qtyMinor: 100, vendorId: 'v1' });
  assert.throws(() => rec(s, { type: 'rev', refId: inRec.id }), /已转移.*先冲销对应出库/);
  // 先冲销出库后，入库恢复原封未动，再冲销入库成功
  const outRec = s.records[1];
  rec(s, { type: 'rev', refId: outRec.id });
  rec(s, { type: 'rev', refId: inRec.id });
  assert.equal(stockByItem(s).get('oil'), 0);
});

test('二次冲销拒绝', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-10), qtyMinor: 100 });
  const out = rec(s, { type: 'out', itemId: 'oil', dateISO: d(-1), qtyMinor: 50, vendorId: 'v1' });
  rec(s, { type: 'rev', refId: out.id });
  assert.throws(() => rec(s, { type: 'rev', refId: out.id }), /重复冲销/);
});

test('压力序列后账实一致：任意出入冲销序列的守恒性质', () => {
  const s = fresh();
  const script = [
    { type: 'in', itemId: 'oil', dateISO: d(-30), qtyMinor: 500 },
    { type: 'out', itemId: 'oil', dateISO: d(-25), qtyMinor: 200, vendorId: 'v1' },
    { type: 'in', itemId: 'oil', dateISO: d(-20), qtyMinor: 300 },
    { type: 'out', itemId: 'oil', dateISO: d(-15), qtyMinor: 100, vendorId: 'v2' },
  ];
  for (const p of script) rec(s, p);
  const outRec = s.records[1];
  rec(s, { type: 'rev', refId: outRec.id });
  const sumIn = s.records.filter((r) => r.type === 'in').reduce((a, r) => a + r.qtyMinor, 0);
  const sumOut = s.records.filter((r) => r.type === 'out').reduce((a, r) => a + r.qtyMinor, 0);
  const revs = s.records.filter((r) => r.type === 'rev');
  // 手工口径：Σin − Σout + Σ冲销反向 = 存量
  const manual = sumIn - sumOut + revs.reduce((a, r) => a + r.qtyMinor, 0);
  assert.equal(stockByItem(s).get('oil'), manual);
  assert.equal(manual, 500 - 200 + 300 - 100 + 200);
});

// ---------------------------------------------------------------------------
// FIFO 批次与贮存超期
// ---------------------------------------------------------------------------

test('贮存超期分级：安全 ok / 30 天窗 warn / 超 365 fail', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-100), qtyMinor: 100 });
  assert.deepEqual(storageWarnings(s, T0), []); // 全部安全 → 空列表
  rec(s, { type: 'in', itemId: 'bat', dateISO: d(-340), qtyMinor: 4 });
  let w = storageWarnings(s, T0);
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'warn'); // 365-340=25 天 → 临期
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-366), qtyMinor: 50 });
  w = storageWarnings(s, T0);
  assert.equal(w[0].level, 'fail'); // 最严重排前
  assert.equal(w[0].daysOpen, 366);
});

test('FIFO：最早批次被出库消耗后，超期判定自动落到次早批次', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-400), qtyMinor: 100 }); // 已超期批次
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-30), qtyMinor: 100 });
  rec(s, { type: 'out', itemId: 'oil', dateISO: d(-1), qtyMinor: 100, vendorId: 'v1' }); // 先出最早的
  const w = storageWarnings(s, T0);
  assert.equal(w.length, 0); // 超期批次已被 FIFO 清掉，剩余批次安全
  const aging = agingByItem(s, T0).get('oil');
  assert.equal(aging.oldestISO, d(-30));
});

test('冲销出库：退回原批次按原入库日续算（冲销=该笔从未发生）', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-380), qtyMinor: 100 });
  const out = rec(s, { type: 'out', itemId: 'oil', dateISO: d(-200), qtyMinor: 100, vendorId: 'v1' });
  assert.deepEqual(storageWarnings(s, T0), []);
  rec(s, { type: 'rev', refId: out.id });
  const w = storageWarnings(s, T0);
  // 冲销后这批油视为从未转出：原批次（380 天前入库）恢复存续，一年红线立即亮灯
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'fail');
  assert.equal(w[0].daysOpen, 380);
});

test('孤儿记录（品目已删）不破坏批次推演', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-10), qtyMinor: 50 });
  // 模拟导入的遗留数据：记录指向已不存在的品目（正常删除入口已有 UI 防护）
  s.records.push({ id: 'ghost', seq: 99, dateISO: d(-400), itemId: 'bat', type: 'in', qtyMinor: 2, vendorId: null, manifestNo: '', amountFen: 0, note: '', refId: null });
  assert.equal(agingByItem(s, T0).get('oil').stockMinor, 50);
  assert.equal(agingByItem(s, T0).get('oil').daysOpen, 10);
});

// ---------------------------------------------------------------------------
// 资质预警与联单待补
// ---------------------------------------------------------------------------

test('接收方资质：过期 fail / 预警窗内 warn / 有效忽略', () => {
  const s = fresh();
  s.vendors[1].licenseExpiryISO = d(60); // 先移出预警窗
  assert.deepEqual(licenseWarnings(s, T0), []);
  s.vendors[1].licenseExpiryISO = d(-1);
  s.vendors[0].licenseExpiryISO = d(20);
  const w = licenseWarnings(s, T0);
  assert.equal(w.length, 2);
  assert.equal(w[0].level, 'fail'); // 已过期排最前
  assert.equal(w[1].level, 'warn');
});

test('联单待补：只列出库且未填联单号，冲销不重复列', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-10), qtyMinor: 400 });
  rec(s, { type: 'out', itemId: 'oil', dateISO: d(-5), qtyMinor: 100, vendorId: 'v1', manifestNo: 'SL-1' });
  const out2 = rec(s, { type: 'out', itemId: 'oil', dateISO: d(-2), qtyMinor: 100, vendorId: 'v2' });
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-1), qtyMinor: 10 });
  const pending = pendingManifests(s);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, out2.id);
});

// ---------------------------------------------------------------------------
// 红线自查台
// ---------------------------------------------------------------------------

test('自查台：空账本 → 台账与管理计划双灯，检查项固定且带法条依据', () => {
  const s = fresh();
  const checks = complianceChecks(s, T0, s.settings);
  assert.deepEqual(checks.map((c) => c.id), ['LEDGER', 'PLAN', 'STORAGE', 'LICENSE', 'MANIFEST', 'CAPACITY']);
  const ledger = checks.find((c) => c.id === 'LEDGER');
  assert.equal(ledger.level, 'warn');
  assert.match(ledger.legal, /第 78 条/);
  const plan = checks.find((c) => c.id === 'PLAN');
  assert.equal(plan.level, 'fail');
  assert.match(plan.legal, /管理计划/);
});

test('自查台：备案打卡后 PLAN 转 ok；断更台账触发 warn；超容量触发 warn', () => {
  const s = fresh();
  s.checkins.push({ id: 'c1', dateISO: d(-1), kind: 'plan', forYear: T0.slice(0, 4) });
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-120), qtyMinor: 600 }); // 超容量 500
  let checks = complianceChecks(s, T0, s.settings);
  assert.equal(checks.find((c) => c.id === 'PLAN').level, 'ok');
  assert.equal(checks.find((c) => c.id === 'CAPACITY').level, 'warn');
  // 台账最近动作 120 天前 → 断更 warn
  assert.equal(checks.find((c) => c.id === 'LEDGER').level, 'warn');
  // 把最近一笔移到今天 → 断更解除
  s.records[0].dateISO = T0;
  checks = complianceChecks(s, T0, s.settings);
  assert.equal(checks.find((c) => c.id === 'LEDGER').level, 'ok');
});

test('自查台：出库接收方未登记许可证号 → LICENSE fail；联单缺失 → MANIFEST fail', () => {
  const s = fresh();
  s.checkins.push({ id: 'c1', dateISO: d(-1), kind: 'plan', forYear: T0.slice(0, 4) });
  s.vendors[1].licenseNo = '';
  s.vendors[1].licenseExpiryISO = null;
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-10), qtyMinor: 400 });
  rec(s, { type: 'out', itemId: 'oil', dateISO: d(-1), qtyMinor: 100, vendorId: 'v2' });
  const checks = complianceChecks(s, T0, s.settings);
  const lic = checks.find((c) => c.id === 'LICENSE');
  assert.equal(lic.level, 'fail'); // 未登记许可证号
  assert.match(lic.detail, /未登记经营许可证号/);
  assert.equal(checks.find((c) => c.id === 'MANIFEST').level, 'fail');
});

test('自查台：跨年备案不顶替本年度（按年打卡）', () => {
  const s = fresh();
  s.checkins.push({ id: 'c1', dateISO: d(-400), kind: 'plan', forYear: d(-400).slice(0, 4) });
  const plan = complianceChecks(s, T0, s.settings).find((c) => c.id === 'PLAN');
  assert.equal(plan.level, 'fail');
});

test('todayActions：fail 优先、去 ok、最多 5 条', () => {
  const s = fresh();
  const actions = todayActions(complianceChecks(s, T0, s.settings));
  assert.ok(actions.length >= 1 && actions.length <= 5);
  assert.ok(actions[0].level === 'fail' || actions.every((a) => a.level !== 'fail') || actions[0].level === 'fail');
  assert.ok(actions.every((a) => a.action && a.title));
});

// ---------------------------------------------------------------------------
// 收益账（整数分）
// ---------------------------------------------------------------------------

test('收益账：按月/品目/接收方汇总，冲销自动冲减，跨年不计入', () => {
  const s = fresh();
  rec(s, { type: 'in', itemId: 'oil', dateISO: d(-200), qtyMinor: 1000 });
  rec(s, { type: 'out', itemId: 'oil', dateISO: d(-100), qtyMinor: 300, vendorId: 'v1', amountFen: 21000 }); // 2026-05
  rec(s, { type: 'out', itemId: 'oil', dateISO: d(-3), qtyMinor: 200, vendorId: 'v2', amountFen: 14000 });
  rec(s, { type: 'out', itemId: 'oil', dateISO: d(-2), qtyMinor: 50, vendorId: 'v1', amountFen: 0 }); // 无款额不计
  const out3 = s.records[2];
  rec(s, { type: 'rev', refId: out3.id }); // 冲销 14000 那笔：+14000 −14000，该笔净额归零
  const rep = revenueReport(s, '2026');
  assert.equal(rep.totalFen, 21000);
  assert.equal(rep.byMonth.length, 2);
  assert.equal(rep.byItem[0].name, '废机油');
  assert.equal(rep.byVendor[0].amountFen, 21000);
  assert.equal(rep.byVendor.length, 2); // 乙回收部净额 0 仍在列（透明呈现）
  // 别的年份为空
  assert.equal(revenueReport(s, '2025').totalFen, 0);
  assert.throws(() => revenueReport(s, '26'), /非法年份/);
});

// ---------------------------------------------------------------------------
// 迎检包：确定性 + XSS + 自包含
// ---------------------------------------------------------------------------

test('迎检包文本：同输入同输出，章节齐全，含待补联单与自查结论', () => {
  const s = demoState(T0);
  const a = inspectionText({ state: s, todayISOStr: T0 });
  const b = inspectionText({ state: s, todayISOStr: T0 });
  assert.equal(a, b);
  assert.match(a, /【危险废物管理台账 · 自查概要】示例汽修厂/);
  assert.match(a, /一、存量汇总/);
  assert.match(a, /二、转移记录/);
  assert.match(a, /三、接收方资质核验/);
  assert.match(a, /四、红线自查结论/);
  assert.match(a, /联单待补/);   // 演示数据含一笔待补
  assert.match(a, /属地生态环境部门要求为准/);
  assert.ok(!a.includes('undefined'));
});

test('迎检包 HTML：单文件自包含（无外链资源）、含签字栏、XSS 全转义', () => {
  const s = demoState(T0);
  s.org.name = `<script>alert("x")</script>厂`;
  s.vendors[0].name = `甲&乙"<img src=x onerror=alert(1)>`;
  const html = inspectionHtml({ state: s, todayISOStr: T0 });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!/src="http/.test(html) && !/href="http/.test(html), '不得引用外部资源');
  assert.ok(!html.includes('<script>alert'), '厂店名必须被转义');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('签字'));
  assert.match(html, /联单待补/);
});

// ---------------------------------------------------------------------------
// 示例数据与导入导出
// ---------------------------------------------------------------------------

test('示例数据确定性且场景完整（有存量、有临期、有待补联单）', () => {
  const s1 = demoState(T0);
  const s2 = demoState(T0);
  assert.deepEqual(s1, s2);
  assert.ok(stockByItem(s1).get('it1') > 0);
  assert.ok(pendingManifests(s1).length >= 1);
  assert.ok(storageWarnings(s1, T0).length >= 1);
  assert.equal(s1.items.length, AUTO_REPAIR_ITEM_TEMPLATES.length);
  assert.equal(s1.vendors[1].licenseNo, ''); // 一个未登记资质的接收方（演示红线场景）
});

test('导出 → 导入往返完全一致', () => {
  const s = demoState(T0);
  const bundle = exportBundle(s);
  const res = importBundle(bundle);
  assert.equal(res.ok, true);
  assert.deepEqual(res.state, s);
});

test('导入拒绝：非法 JSON / 别家备份 / 更高版本 / 结构残缺', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle('{"app":"classoff","version":1}').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'garageledger', version: 99, state: {} })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'garageledger', version: 1, state: { org: {} } })).ok, false);
  assert.match(importBundle('not json').error, /JSON/);
  assert.match(importBundle('{"app":"classoff","version":1}').error, /危废账/);
});

// ---------------------------------------------------------------------------
// 常量完整性
// ---------------------------------------------------------------------------

test('记录类型与汽修模板完整性', () => {
  assert.equal(RECORD_TYPES.in.sign, 1);
  assert.equal(RECORD_TYPES.out.sign, -1);
  for (const t of AUTO_REPAIR_ITEM_TEMPLATES) {
    assert.ok(t.name && /^\d{3}-\d{3}-\d{2}$/.test(t.code), `模板代码格式: ${t.code}`);
    assert.ok(t.unit === 'kg' || t.unit === 'unit');
  }
});
