/**
 * tests/core.test.mjs — 车销单 RideLedger 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addMonths, daysUntil, monthKey, fmtYuan, escapeHtml,
  PRODUCT_KINDS, CCC_MIN_LEN, DEFAULT_WARRANTY_WINDOW_DAYS,
  addProduct, applyIntake, batchRemaining, sellableBatches, stockOf,
  applySale, removeSale, recordLoss,
  expiringWarranties, expiredWarranties,
  addTradeIn, removeTradeIn,
  conservation, complianceAudit,
  purchaseLedgerRows, saleLedgerRows, tradeinRows,
  purchaseLedgerText, saleLedgerText, tradeinLedgerText,
  proofOfSale, inspectionHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期，不依赖墙钟

function mkState() {
  return {
    version: STATE_VERSION,
    shop: { name: '测试车行', licenseNo: '91320911TEST00001X', phone: '13800000000' },
    recyclers: [],
    suppliers: [],
    products: [],
    batches: [],
    sales: [],
    tradeins: [],
    losses: [],
    settings: { warrantyWindowDays: 60 },
    events: [],
  };
}

function addP(state, over = {}) {
  return addProduct(state, {
    id: over.id ?? 'p1',
    name: over.name ?? '雅迪冠能3 E8',
    kind: over.kind ?? 'ebike',
    brand: over.brand ?? '雅迪',
    model: over.model ?? '',
    cccNo: over.cccNo ?? '2024011109123456',
    spec: over.spec ?? '48V24Ah',
    unit: over.unit ?? '辆',
    maker: over.maker ?? '雅迪科技',
    warrantyMonths: over.warrantyMonths ?? 12,
    note: '',
  });
}

function inB(state, over = {}) {
  return applyIntake(state, {
    id: over.id ?? 'b1',
    productId: over.productId ?? 'p1',
    supplierId: over.supplierId ?? '',
    inISO: over.inISO ?? '2026-08-01',
    qty: over.qty ?? 10,
    unitCostCents: over.cost ?? null,
    lotNo: over.lotNo ?? '',
    traceCode: over.trace ?? '',
    note: '',
  });
}

function mkSale(state, over = {}) {
  return applySale(state, {
    id: over.id ?? 'x1',
    dateISO: over.dateISO ?? T,
    buyerName: over.buyerName ?? '王师傅',
    buyerPhone: over.buyerPhone ?? '',
    note: over.note ?? '',
    items: over.items ?? [{
      productId: 'p1', qty: 1, priceCents: over.price ?? 299900,
      frameNos: over.frameNos ?? ['LTDX2026090500001'],
    }],
  });
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

test('addDays 跨月/跨年收敛', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('addMonths 月末钳制与跨年（质保期按售出日起算的基础）', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 13), '2027-02-28');
  assert.equal(addMonths('2026-03-15', 12), '2027-03-15');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonths('2026-12-31', 2), '2027-02-28');
});

test('daysUntil 与 monthKey 跨年正确', () => {
  assert.equal(daysUntil('2026-12-31', T), 117);
  assert.equal(daysUntil('2026-09-05', T), 0);
  assert.equal(daysUntil('2026-09-04', T), -1);
  assert.equal(monthKey('2026-09-05'), '2026-09');
  assert.equal(monthKey('2026-01-01'), '2026-01');
});

test('fmtYuan 只吃整数分', () => {
  assert.equal(fmtYuan(299900), '¥2999.00');
  assert.equal(fmtYuan(305), '¥3.05');
  assert.throws(() => fmtYuan(12.5));
});

test('escapeHtml 转义五个危险字符', () => {
  assert.equal(escapeHtml('<script>&"\'</script>'), '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
});

// ---------------------------------------------------------------------------
// 商品档案（整车 CCC 红线）
// ---------------------------------------------------------------------------

test('addProduct：整车缺 CCC 拒绝建档；证号过短拒绝；非整车免填', () => {
  const s = mkState();
  assert.throws(() => addP(s, { id: 'px', cccNo: '' }), /CCC/);
  assert.throws(() => addP(s, { id: 'px', cccNo: '123' }), /CCC 证号过短/);
  const p = addP(s, { id: 'p1' });
  assert.equal(p.cccNo, '2024011109123456');
  const bat = addP(s, { id: 'p2', name: '天能 48V20Ah 电池组', kind: 'battery', cccNo: '', unit: '', warrantyMonths: 12 });
  assert.equal(bat.cccNo, '');
  assert.equal(bat.unit, '件'); // 默认单位
  assert.throws(() => addProduct(s, { id: 'p4', name: '  ', kind: 'parts' }), /名称必填/);
  assert.throws(() => addProduct(s, { id: 'p4', name: '神秘件', kind: 'car' }), /未知商品类别/);
});

test('addProduct：质保月数钳制（0~120，非法归 0）', () => {
  const s = mkState();
  assert.equal(addP(s, { id: 'a', kind: 'battery', name: '电池A', warrantyMonths: 12 }).warrantyMonths, 12);
  assert.equal(addP(s, { id: 'b', kind: 'helmet', name: '头盔', warrantyMonths: -3 }).warrantyMonths, 0);
  assert.equal(addP(s, { id: 'c', kind: 'parts', name: '脚踏', warrantyMonths: 999 }).warrantyMonths, 0);
  assert.equal(addP(s, { id: 'd', kind: 'charger', name: '充电器', warrantyMonths: 6 }).warrantyMonths, 6);
});

// ---------------------------------------------------------------------------
// 进货落账
// ---------------------------------------------------------------------------

test('applyIntake：档案缺 3C 的整车拒绝进货（导入数据场景）', () => {
  const s = mkState();
  s.products.push({
    id: 'bad', name: '无证整车', kind: 'ebike', brand: '', model: '', cccNo: '',
    spec: '', unit: '辆', maker: '', warrantyMonths: 12, note: '',
  });
  assert.throws(() => inB(s, { productId: 'bad' }), /缺 CCC/);
});

test('applyIntake：数量与单价校验；未知商品拒绝', () => {
  const s = mkState();
  addP(s);
  assert.throws(() => inB(s, { qty: 0 }), /正整数/);
  assert.throws(() => inB(s, { qty: 2.5 }), /正整数/);
  assert.throws(() => inB(s, { cost: 8.5 }), /整数分/);
  assert.throws(() => inB(s, { productId: 'ghost' }), /商品不存在/);
  assert.doesNotThrow(() => inB(s));
});

// ---------------------------------------------------------------------------
// 库存派生与批次队列
// ---------------------------------------------------------------------------

test('batchRemaining：剩余 = 进货 − 已售 − 报损，负数拒绝', () => {
  const s = mkState();
  addP(s);
  inB(s, { qty: 10 });
  mkSale(s);
  recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b1', qty: 2, reason: 'damaged', note: '' });
  assert.equal(batchRemaining(s, 'b1'), 7);
  assert.throws(() => batchRemaining(s, 'ghost'), /批次不存在/);
});

test('sellableBatches：先进先出、同进货日按建档序、售罄剔除', () => {
  const s = mkState();
  addP(s);
  inB(s, { id: 'b-later', inISO: '2026-08-20', qty: 5 });
  inB(s, { id: 'b-earlier', inISO: '2026-06-01', qty: 5 });
  inB(s, { id: 'b-tie2', inISO: '2026-07-01', qty: 1 });
  inB(s, { id: 'b-tie1', inISO: '2026-07-01', qty: 1 });
  assert.deepEqual(sellableBatches(s, 'p1').map((b) => b.id), ['b-earlier', 'b-tie1', 'b-tie2', 'b-later']);
  assert.equal(stockOf(s, 'p1'), 12);
  mkSale(s, { items: [{ productId: 'p1', qty: 5, priceCents: null, frameNos: ['F1'] }] });
  assert.deepEqual(sellableBatches(s, 'p1').map((b) => b.id), ['b-tie1', 'b-tie2', 'b-later']);
});

// ---------------------------------------------------------------------------
// 销售落账（车架号/电池码强制 + 拆分销售警示）
// ---------------------------------------------------------------------------

test('applySale：整车缺车架号拒绝；电池缺编码拒绝', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '天能电池组', kind: 'battery', cccNo: '' });
  inB(s);
  inB(s, { id: 'b2', productId: 'p2', qty: 5 });
  assert.throws(() => mkSale(s, { items: [{ productId: 'p1', qty: 1, priceCents: null, frameNos: [] }] }), /车架号/);
  assert.throws(() => mkSale(s, { items: [{ productId: 'p1', qty: 1, priceCents: null }] }), /车架号/);
  assert.throws(() => mkSale(s, { items: [{ productId: 'p2', qty: 1, priceCents: null }] }), /电池编码/);
  assert.doesNotThrow(() => mkSale(s, { items: [{ productId: 'p2', qty: 1, priceCents: null, batteryCodes: ['TN001'] }] }));
});

test('applySale：CCC 缺档整车拒绝销售（只可能来自导入数据）', () => {
  const s = mkState();
  s.products.push({
    id: 'bad', name: '无证整车', kind: 'ebike', brand: '', model: '', cccNo: '',
    spec: '', unit: '辆', maker: '', warrantyMonths: 12, note: '',
  });
  assert.throws(() => mkSale(s, { items: [{ productId: 'bad', qty: 1, priceCents: null, frameNos: ['F9'] }] }), /CCC/);
});

test('applySale：FIFO 跨批次分配（多批接续，每件可追批次）', () => {
  const s = mkState();
  addP(s);
  inB(s, { id: 'b-old', inISO: '2026-06-01', qty: 3, lotNo: 'LOT-OLD' });
  inB(s, { id: 'b-new', inISO: '2026-08-20', qty: 5, lotNo: 'LOT-NEW' });
  const sale = mkSale(s, { items: [{ productId: 'p1', qty: 5, priceCents: 299900, frameNos: ['F1', 'F2'] }] });
  assert.deepEqual(sale.items[0].allocations, [
    { batchId: 'b-old', qty: 3 },
    { batchId: 'b-new', qty: 2 },
  ]);
  assert.equal(batchRemaining(s, 'b-old'), 0);
  assert.equal(batchRemaining(s, 'b-new'), 3);
});

test('applySale：任何一品库存不足 → 整单拒绝，绝不部分入账', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '头盔', kind: 'helmet', cccNo: '' });
  inB(s, { qty: 1 });
  inB(s, { id: 'b2', productId: 'p2', qty: 5 });
  assert.throws(() => mkSale(s, {
    items: [
      { productId: 'p1', qty: 1, priceCents: 299900, frameNos: ['F1'] },
      { productId: 'p2', qty: 6, priceCents: 6900 },
    ],
  }), /可售库存不足/);
  assert.equal(s.sales.length, 0);
  assert.equal(batchRemaining(s, 'b1'), 1);
  assert.equal(batchRemaining(s, 'b2'), 5);
});

test('applySale：拆分销售警示（非阻断）——电池多于整车、单卖电池无备注', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '天能电池组', kind: 'battery', cccNo: '' });
  inB(s, { qty: 2 });
  inB(s, { id: 'b2', productId: 'p2', qty: 10 });
  // 一车一池：1 整车 + 1 电池，无警示
  const clean = mkSale(s, {
    id: 'x-ok',
    items: [
      { productId: 'p1', qty: 1, priceCents: null, frameNos: ['F1'] },
      { productId: 'p2', qty: 1, priceCents: null, batteryCodes: ['B1'] },
    ],
  });
  assert.equal(clean.warnings.length, 0);
  // 电池多于整车：警示
  const more = mkSale(s, {
    id: 'x-more', note: '旧车换电池',
    items: [
      { productId: 'p1', qty: 1, priceCents: null, frameNos: ['F2'] },
      { productId: 'p2', qty: 3, priceCents: null, batteryCodes: ['B2', 'B3', 'B4'] },
    ],
  });
  assert.equal(more.warnings.length, 1);
  assert.match(more.warnings[0], /拆分销售/);
  // 单卖电池无备注：警示
  const solo = mkSale(s, {
    id: 'x-solo',
    items: [{ productId: 'p2', qty: 1, priceCents: null, batteryCodes: ['B5'] }],
  });
  assert.equal(solo.warnings.length, 1);
  assert.match(solo.warnings[0], /备注用途/);
  // 单卖电池有备注：不警示
  const noted = mkSale(s, {
    id: 'x-noted', note: '原车电池鼓包更换',
    items: [{ productId: 'p2', qty: 1, priceCents: null, batteryCodes: ['B6'] }],
  });
  assert.equal(noted.warnings.length, 0);
});

test('applySale：同商品重复行拒绝；空卖单拒绝；撤销自动回滚', () => {
  const s = mkState();
  addP(s);
  inB(s, { qty: 5 });
  assert.throws(() => mkSale(s, {
    items: [
      { productId: 'p1', qty: 1, priceCents: null, frameNos: ['F1'] },
      { productId: 'p1', qty: 1, priceCents: null, frameNos: ['F2'] },
    ],
  }), /重复出现/);
  assert.throws(() => mkSale(s, { items: [] }), /至少包含一个商品行/);
  mkSale(s, { id: 'x1' });
  assert.equal(batchRemaining(s, 'b1'), 4);
  removeSale(s, 'x1');
  assert.equal(batchRemaining(s, 'b1'), 5);
  assert.throws(() => removeSale(s, 'ghost'), /卖单不存在/);
});

// ---------------------------------------------------------------------------
// 质保引擎（售出日起算）
// ---------------------------------------------------------------------------

test('临保质保名单：窗口含边界、无质保商品不进名单、按剩余天数排序', () => {
  const s = mkState();
  addP(s, { id: 'p1', warrantyMonths: 12 });                       // 12 个月
  addP(s, { id: 'p2', name: '头盔', kind: 'helmet', cccNo: '', warrantyMonths: 0 });
  inB(s, { id: 'b1', qty: 5 });
  inB(s, { id: 'b2', productId: 'p2', qty: 5 });
  // 350 天前卖 12 个月质保 → 还有约 15 天临保
  mkSale(s, { id: 'x1', dateISO: addDays(T, -350), items: [{ productId: 'p1', qty: 1, priceCents: null, frameNos: ['F1'] }] });
  // 头盔无质保 → 不进任何名单
  mkSale(s, { id: 'x2', dateISO: addDays(T, -100), items: [{ productId: 'p2', qty: 1, priceCents: null }] });
  const exp = expiringWarranties(s, T, 60);
  assert.equal(exp.length, 1);
  assert.equal(exp[0].saleId, 'x1');
  assert.equal(exp[0].until, addMonths(addDays(T, -350), 12));
  assert.equal(exp[0].daysLeft, daysUntil(addMonths(addDays(T, -350), 12), T));
  // 过保名单：两年前卖的车已过保
  mkSale(s, { id: 'x3', dateISO: addDays(T, -800), items: [{ productId: 'p1', qty: 1, priceCents: null, frameNos: ['F2'] }] });
  const expired = expiredWarranties(s, T);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].saleId, 'x3');
  assert.equal(expiredWarranties(s, T).map((r) => r.saleId).includes('x1'), false);
});

// ---------------------------------------------------------------------------
// 以旧换新旧车回收台账
// ---------------------------------------------------------------------------

test('addTradeIn：旧车车架号必填；电池数量/补贴校验；关联卖单校验', () => {
  const s = mkState();
  addP(s);
  inB(s);
  mkSale(s, { id: 'x1' });
  assert.throws(() => addTradeIn(s, { id: 't1', dateISO: T, oldFrameNo: ' ', batteryCount: 1 }), /车架号.*必填/);
  assert.throws(() => addTradeIn(s, { id: 't1', dateISO: T, oldFrameNo: '苏N1', batteryCount: 1.5 }), /非负整数/);
  assert.throws(() => addTradeIn(s, { id: 't1', dateISO: T, oldFrameNo: '苏N1', subsidyCents: 50.5 }), /整数分/);
  assert.throws(() => addTradeIn(s, { id: 't1', dateISO: T, oldFrameNo: '苏N1', saleId: 'ghost' }), /关联卖单不存在/);
  const { record, warning } = addTradeIn(s, {
    id: 't1', dateISO: T, buyerName: '李大姐', oldBrand: '旧雅迪', oldFrameNo: '苏N123450',
    batteryCount: 1, recyclerId: 'rec1', saleId: 'x1', subsidyCents: 50000,
  });
  assert.equal(record.oldFrameNo, '苏N123450');
  assert.equal(warning, null);
  // 同一卖单不许重复挂回收
  assert.throws(() => addTradeIn(s, { id: 't2', dateISO: T, oldFrameNo: '苏N999999', saleId: 'x1' }), /已关联/);
  // 未挂回收企业 → 非阻断提示
  const { warning: warn2 } = addTradeIn(s, { id: 't3', dateISO: T, oldFrameNo: '苏N888888' });
  assert.match(warn2, /资质的回收企业/);
  removeTradeIn(s, 't3');
  assert.equal(s.tradeins.length, 1);
  assert.throws(() => removeTradeIn(s, 'ghost'), /回收记录不存在/);
});

// ---------------------------------------------------------------------------
// 账本体检
// ---------------------------------------------------------------------------

test('conservation：进货 = 已售 + 报损 + 库存（混合场景残差为 0）', () => {
  const s = mkState();
  addP(s);
  inB(s, { id: 'b1', qty: 20 });
  inB(s, { id: 'b2', qty: 10 });
  mkSale(s, { items: [{ productId: 'p1', qty: 7, priceCents: null, frameNos: ['F1'] }] });
  recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b2', qty: 3, reason: 'damaged', note: '运输破损' });
  const cons = conservation(s);
  assert.equal(cons.inQty, 30);
  assert.equal(cons.soldQty, 7);
  assert.equal(cons.lossQty, 3);
  assert.equal(cons.stockQty, 20);
  assert.equal(cons.residual, 0);
});

test('recordLoss：原因限定、超量拒绝、报损扣库存', () => {
  const s = mkState();
  addP(s);
  inB(s, { qty: 10 });
  assert.throws(() => recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b1', qty: 1, reason: 'expired', note: '' }), /未知报损原因/);
  assert.throws(() => recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b1', qty: 11, reason: 'damaged', note: '' }), /超过批次剩余/);
  recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b1', qty: 3, reason: 'damaged', note: '' });
  assert.equal(stockOf(s, 'p1'), 7);
});

test('complianceAudit：缺 3C 档案 / 缺车架号 / 缺电池码 / 回收未挂企业，四类都点名', () => {
  const s = mkState();
  addP(s);
  s.products.push({
    id: 'bad', name: '无证整车', kind: 'ebike', brand: '', model: '', cccNo: '',
    spec: '', unit: '辆', maker: '', warrantyMonths: 12, note: '',
  });
  addP(s, { id: 'p2', name: '电池', kind: 'battery', cccNo: '' });
  inB(s);
  inB(s, { id: 'b2', productId: 'p2', qty: 5 });
  // 手工塞一条缺车架号与电池码的历史卖单（模拟导入/补录）
  s.sales.push({
    id: 'x-bad', dateISO: '2026-08-20', buyerName: '散客', buyerPhone: '', note: '', warnings: [],
    items: [
      { productId: 'p1', qty: 1, priceCents: null, frameNos: [], allocations: [{ batchId: 'b1', qty: 1 }] },
      { productId: 'p2', qty: 1, priceCents: null, batteryCodes: [], allocations: [{ batchId: 'b2', qty: 1 }] },
    ],
  });
  s.tradeins.push({
    id: 't-bad', dateISO: T, buyerName: '', oldBrand: '', oldFrameNo: '苏N1',
    batteryCount: null, batteryWeightKg: null, recyclerId: '', saleId: '', subsidyCents: null, note: '',
  });
  const audit = complianceAudit(s);
  assert.equal(audit.missingCCC.length, 1);
  assert.equal(audit.missingFrameNo.length, 1);
  assert.equal(audit.missingBatteryCode.length, 1);
  assert.equal(audit.tradeinNoRecycler.length, 1);
});

// ---------------------------------------------------------------------------
// 台账导出
// ---------------------------------------------------------------------------

test('台账行：进货带 3C/供货人；销售带车架号/电池码/金额；回收带回收企业与补贴', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '天能电池组', kind: 'battery', cccNo: '' });
  inB(s, { id: 'b1', supplierId: 'sup1', qty: 10, lotNo: 'LOT-A', trace: 'F-001' });
  inB(s, { id: 'b2', productId: 'p2', inISO: '2026-08-10', qty: 4 });
  mkSale(s, { id: 'x1', items: [{ productId: 'p1', qty: 2, priceCents: 299900, frameNos: ['F-001', 'F-002'] }] });
  mkSale(s, { id: 'x2', buyerName: '李大姐', items: [{ productId: 'p2', qty: 1, priceCents: 39900, batteryCodes: ['TN-001'] }] });
  addTradeIn(s, { id: 't1', dateISO: T, buyerName: '李大姐', oldBrand: '旧雅迪', oldFrameNo: '苏N123450', batteryCount: 1, recyclerId: 'rec1', saleId: 'x2', subsidyCents: 50000 });

  const buys = purchaseLedgerRows(s);
  assert.equal(buys.length, 2);
  assert.equal(buys[0].inISO, '2026-08-10');
  assert.equal(buys[1].cccNo, '2024011109123456');
  assert.equal(buys[1].supplier, 'sup1'); // 未在名册中的供货商 id 原样带出

  const sells = saleLedgerRows(s);
  assert.equal(sells.length, 2);
  const frameRow = sells.find((r) => r.frameNos.length);
  assert.deepEqual(frameRow.frameNos, ['F-001', 'F-002']);
  assert.equal(frameRow.amountCents, 599800);
  const batRow = sells.find((r) => r.batteryCodes.length);
  assert.deepEqual(batRow.batteryCodes, ['TN-001']);

  const trades = tradeinRows(s);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].recycler, 'rec1');
  assert.equal(trades[0].subsidyCents, 50000);
});

test('台账文本：确定性输出，含信用代码、车架号、电池编码、CCC 与回收口径', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '天能电池组', kind: 'battery', cccNo: '' });
  inB(s, { qty: 10, lotNo: 'LOT-A', trace: 'F-001' });
  inB(s, { id: 'b2', productId: 'p2', qty: 5 });
  mkSale(s, { items: [{ productId: 'p1', qty: 2, priceCents: 299900, frameNos: ['F-001', 'F-002'] }] });
  mkSale(s, { id: 'x2', buyerName: '李大姐', items: [{ productId: 'p2', qty: 1, priceCents: 39900, batteryCodes: ['TN-001'] }] });
  addTradeIn(s, { id: 't1', dateISO: T, oldFrameNo: '苏N123450', batteryCount: 1, subsidyCents: 50000 });

  const buy1 = purchaseLedgerText({ state: s, todayISOStr: T });
  assert.equal(buy1, purchaseLedgerText({ state: s, todayISOStr: T }));
  assert.ok(buy1.includes('91320911TEST00001X'));
  assert.ok(buy1.includes('3C 2024011109123456'));
  assert.ok(buy1.includes('LOT-A'));

  const saleText = saleLedgerText({ state: s, todayISOStr: T });
  assert.equal(saleText, saleLedgerText({ state: s, todayISOStr: T }));
  assert.ok(saleText.includes('车架号 F-001、F-002'));
  assert.ok(saleText.includes('电池编码 TN-001'));

  const tradeText = tradeinLedgerText({ state: s, todayISOStr: T });
  assert.ok(tradeText.includes('苏N123450'));
  assert.ok(tradeText.includes('¥500.00'));
  assert.ok(tradeText.includes('资质的回收企业'));
});

test('proofOfSale：按人捞出卖单与车架号/电池码/批次；未查到如实出具；空姓名拒绝', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '天能电池组', kind: 'battery', cccNo: '' });
  inB(s, { id: 'b1', qty: 10, lotNo: 'LOT-A', trace: 'F-001' });
  inB(s, { id: 'b2', productId: 'p2', qty: 5 });
  mkSale(s, { id: 'x1', dateISO: '2026-08-20', items: [{ productId: 'p1', qty: 1, priceCents: 299900, frameNos: ['F-100'] }] });
  mkSale(s, { id: 'x2', dateISO: T, items: [
    { productId: 'p1', qty: 1, priceCents: 299900, frameNos: ['F-200'] },
    { productId: 'p2', qty: 1, priceCents: 39900, batteryCodes: ['TN-200'] },
  ] });
  mkSale(s, { id: 'x3', dateISO: T, buyerName: '李大姐', items: [{ productId: 'p1', qty: 1, priceCents: 299900, frameNos: ['F-300'] }] });
  const proof = proofOfSale(s, { buyerName: '王师傅', todayISOStr: T });
  assert.equal(proof.count, 2);
  assert.ok(proof.text.includes('91320911TEST00001X'));
  assert.ok(proof.text.includes('CCC 2024011109123456'));
  assert.ok(proof.text.includes('F-100'));
  assert.ok(proof.text.includes('LOT-A'));
  assert.ok(proof.text.indexOf('■ 2026-08-20') < proof.text.indexOf('■ 2026-09-05')); // 按时间升序
  const onDate = proofOfSale(s, { buyerName: '王师傅', dateISO: T, todayISOStr: T });
  assert.equal(onDate.count, 1);
  const none = proofOfSale(s, { buyerName: '查无此人', todayISOStr: T });
  assert.equal(none.count, 0);
  assert.ok(none.text.includes('未查到'));
  assert.throws(() => proofOfSale(s, { buyerName: '  ', todayISOStr: T }), /购买人姓名/);
});

test('inspectionHtml：单文件无外部资源、转义注入、含承诺书/回收台账/缺项统计/残差警示', () => {
  const s = mkState();
  addP(s);
  inB(s, { qty: 10 });
  mkSale(s, {
    buyerName: '<script>alert(1)</script>',
    items: [{ productId: 'p1', qty: 2, priceCents: 299900, frameNos: ['F-001'] }],
  });
  s.tradeins.push({
    id: 't1', dateISO: T, buyerName: '李大姐', oldBrand: '旧雅迪', oldFrameNo: '<img src=x onerror=alert(1)>',
    batteryCount: 1, batteryWeightKg: null, recyclerId: '', saleId: '', subsidyCents: null, note: '',
  });
  const html = inspectionHtml({ state: s, todayISOStr: T });
  assert.ok(!html.includes('http://'));
  assert.ok(!html.includes('https://'));
  assert.ok(!html.includes('<script src='));
  assert.ok(!html.includes('rel="stylesheet" href='));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('91320911TEST00001X'));
  assert.ok(html.includes('本店承诺')); // 四上墙承诺书行
  assert.ok(html.includes('旧车回收台账'));
  assert.ok(html.includes('台账缺项 1 处')); // 回收未挂企业
  // 破坏账本 → 残差警示
  s.sales.push({
    id: 'x-bad', dateISO: T, buyerName: '散客', buyerPhone: '', note: '', warnings: [],
    items: [{ productId: 'p1', qty: 99, priceCents: null, frameNos: ['FX'], allocations: [] }],
  });
  const broken = inspectionHtml({ state: s, todayISOStr: T });
  assert.ok(broken.includes('残差 -99'));
  assert.ok(broken.includes('请核查'));
});

// ---------------------------------------------------------------------------
// 数据导入导出与常量
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = mkState();
  addP(s);
  inB(s);
  mkSale(s);
  addTradeIn(s, { id: 't1', dateISO: T, oldFrameNo: '苏N123450', batteryCount: 1 });
  const restored = importBundle(exportBundle(s));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state, s);
});

test('importBundle 拒绝坏 JSON / 错应用 / 高版本 / 缺结构', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle('{"app":"classoff","version":1,"state":{}}').ok, false);
  assert.equal(importBundle('{"app":"agriledger","version":1,"state":{}}').ok, false);
  assert.equal(importBundle('{"app":"rideledger","version":99,"state":{}}').ok, false);
  const bad = importBundle('{"app":"rideledger","version":1,"state":{"shop":{}}}');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /结构不完整/);
});

test('品类/常量口径', () => {
  assert.deepEqual(Object.keys(PRODUCT_KINDS), ['ebike', 'battery', 'charger', 'helmet', 'parts']);
  assert.equal(CCC_MIN_LEN, 6);
  assert.equal(DEFAULT_WARRANTY_WINDOW_DAYS, 60);
  assert.equal(STATE_VERSION, 1);
  assert.equal(typeof todayISO(), 'string');
});

test('单价留空：台账只记数量不记金额（车行赊账/抹零的诚实出口）', () => {
  const s = mkState();
  addP(s);
  inB(s);
  mkSale(s, { items: [{ productId: 'p1', qty: 1, priceCents: null, frameNos: ['F-001'] }] });
  const row = saleLedgerRows(s)[0];
  assert.equal(row.priceCents, null);
  assert.equal(row.amountCents, null);
  const text = saleLedgerText({ state: s, todayISOStr: T });
  assert.ok(!text.includes('@ ¥'));
  assert.ok(text.includes('× 1辆'));
});

test('台账文本超限截断并指向打印版', () => {
  const s = mkState();
  addP(s);
  for (let i = 0; i < 15; i += 1) inB(s, { id: `b${i}`, inISO: `2026-08-${String(i + 1).padStart(2, '0')}`, qty: 1 });
  const text = purchaseLedgerText({ state: s, todayISOStr: T, limit: 10 });
  assert.ok(text.includes('更早 5 条见打印版台账'));
});

test('临保窗参数可覆盖：窗沿外一天不进名单', () => {
  const s = mkState();
  addP(s, { id: 'p1', warrantyMonths: 12 });
  inB(s);
  // 售出日使质保恰在 31 天后到期
  const soldISO = addDays(addMonths(T, -12), 31);
  mkSale(s, { dateISO: soldISO, items: [{ productId: 'p1', qty: 1, priceCents: null, frameNos: ['F1'] }] });
  assert.equal(expiringWarranties(s, T, 30).length, 0);
  const in30 = expiringWarranties(s, T, 31);
  assert.equal(in30.length, 1);
  assert.equal(in30[0].daysLeft, 31);
});

test('回收台账带电池重量与备注字段（平顶山模板字段口径）', () => {
  const s = mkState();
  addTradeIn(s, {
    id: 't1', dateISO: T, buyerName: '李大姐', oldBrand: '旧雅迪', oldFrameNo: '苏N123450',
    batteryCount: 2, batteryWeightKg: 35.5, recyclerId: '', saleId: '', subsidyCents: null, note: '两组旧铅酸',
  });
  const row = tradeinRows(s)[0];
  assert.equal(row.batteryCount, 2);
  assert.equal(row.batteryWeightKg, 35.5);
  assert.equal(row.note, '两组旧铅酸');
  const text = tradeinLedgerText({ state: s, todayISOStr: T });
  assert.ok(text.includes('35.5kg'));
});

test('迎检包含库存盘点与 3C 列（进货查验留痕）', () => {
  const s = mkState();
  addP(s);
  inB(s, { id: 'b1', qty: 10, lotNo: 'LOT-A', trace: 'F-001' });
  const html = inspectionHtml({ state: s, todayISOStr: T });
  assert.ok(html.includes('库存盘点'));
  assert.ok(html.includes('LOT-A'));
  assert.ok(html.includes('F-001'));
  assert.ok(html.includes('2024011109123456'));
  assert.ok(html.includes('账实一致'));
});
