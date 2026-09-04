/**
 * tests/core.test.mjs — 购销单 AgriLedger 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, fmtYuan, escapeHtml,
  BANNED_PESTICIDES, RESTRICTED_PESTICIDES, productRisk, PRODUCT_KINDS,
  addProduct, applyIntake, batchRemaining, sellableBatches, stockOf,
  applySale, removeSale, recordLoss, expiredBatches, nearExpiryBatches,
  conservation, complianceAudit,
  purchaseLedgerRows, saleLedgerRows, purchaseLedgerText, saleLedgerText,
  proofOfSale, inspectionHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期，不依赖墙钟

function mkState() {
  return {
    version: STATE_VERSION,
    shop: { name: '测试农资', licenseNo: 'TEST-001', phone: '13800000000' },
    suppliers: [],
    products: [],
    batches: [],
    sales: [],
    losses: [],
    settings: { nearExpiryDays: 90 },
    events: [],
  };
}

function addP(state, over = {}) {
  return addProduct(state, {
    id: over.id ?? 'p1',
    name: over.name ?? '4.5% 高效氯氰菊酯乳油',
    kind: over.kind ?? 'pesticide',
    regNo: over.regNo ?? 'PD20101234',
    spec: over.spec ?? '250ml/瓶',
    unit: over.unit ?? '瓶',
    maker: over.maker ?? '红星农化',
    toxicity: over.toxicity ?? '低毒',
    restricted: over.restricted ?? false,
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
    expireISO: 'expireISO' in over ? over.expireISO : '2027-08-01',
    note: '',
  });
}

function mkSale(state, over = {}) {
  return applySale(state, {
    id: over.id ?? 'x1',
    dateISO: over.dateISO ?? T,
    buyerName: over.buyerName ?? '王老汉',
    buyerPhone: over.buyerPhone ?? '',
    buyerIdNo: over.buyerIdNo ?? '',
    crop: over.crop ?? '',
    note: '',
    items: over.items ?? [{ productId: 'p1', qty: 2, priceCents: over.price ?? 1000 }],
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

test('daysUntil 与 monthKey 跨年正确', () => {
  assert.equal(daysUntil('2026-12-31', T), 117);
  assert.equal(daysUntil('2026-09-05', T), 0);
  assert.equal(daysUntil('2026-09-04', T), -1);
  assert.equal(monthKey('2026-09-05'), '2026-09');
  assert.equal(monthKey('2026-01-01'), '2026-01');
});

test('fmtYuan 只吃整数分', () => {
  assert.equal(fmtYuan(10500), '¥105.00');
  assert.equal(fmtYuan(305), '¥3.05');
  assert.throws(() => fmtYuan(12.5));
});

test('escapeHtml 转义五个危险字符', () => {
  assert.equal(escapeHtml('<script>&"\'</script>'), '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
});

// ---------------------------------------------------------------------------
// 禁限用名录与商品建档红线
// ---------------------------------------------------------------------------

test('productRisk：禁用完全命中（含 2026-06-01 生效的 736 号公告条目）', () => {
  assert.equal(productRisk('百草枯').banned, true);
  assert.equal(productRisk('甲胺磷').banned, true);
  assert.equal(productRisk('氧乐果').banned, true);
  assert.equal(productRisk('克百威').banned, true);
  assert.equal(BANNED_PESTICIDES.find((x) => x.name === '氧乐果').note.includes('736'), true);
  assert.equal(BANNED_PESTICIDES.find((x) => x.name === '氧乐果').note.includes('2026-06-01'), true);
});

test('productRisk：限用命中与普通商品不命中；只做完全一致匹配', () => {
  assert.equal(productRisk('甲拌磷').restricted, true);
  assert.equal(productRisk('磷化铝').restricted, true);
  assert.equal(productRisk('  磷化铝  ').restricted, true);
  const normal = productRisk('4.5% 高效氯氰菊酯乳油');
  assert.equal(normal.banned, false);
  assert.equal(normal.restricted, false);
  // 名录不含「乳油」等商品化后缀——不猜模糊词，靠手动标记补位（诚实条款）
  assert.equal(productRisk('甲胺磷乳油').banned, false);
});

test('addProduct：禁用农药拒绝建档；限用自动打标；普通建档成功', () => {
  const s = mkState();
  assert.throws(() => addP(s, { id: 'px', name: '百草枯' }), /禁用农药不得经营/);
  const res = addP(s, { id: 'p2', name: '磷化铝' });
  assert.equal(res.restricted, true);
  const p = addP(s, { id: 'p3', name: '80% 代森锰锌可湿性粉剂' });
  assert.equal(p.restricted, false);
  assert.equal(p.unit, '瓶');
  assert.throws(() => addProduct(s, { id: 'p4', name: '  ', kind: 'seed' }), /名称必填/);
  assert.throws(() => addProduct(s, { id: 'p4', name: '复合肥', kind: 'liquid' }), /未知商品类别/);
});

// ---------------------------------------------------------------------------
// 进货落账（采购台账）
// ---------------------------------------------------------------------------

test('applyIntake：农药批次必须登记效期，效期早于进货日拒绝', () => {
  const s = mkState();
  addP(s);
  assert.throws(() => inB(s, { expireISO: null }), /必须登记效期/);
  assert.throws(() => inB(s, { expireISO: '2026-01-01' }), /效期.*早于进货日/);
  assert.doesNotThrow(() => inB(s, { expireISO: '2027-08-01' }));
});

test('applyIntake：数量与单价校验；种子/肥料可无有效期', () => {
  const s = mkState();
  addP(s);
  assert.throws(() => inB(s, { qty: 0 }), /正整数/);
  assert.throws(() => inB(s, { qty: 2.5 }), /正整数/);
  assert.throws(() => inB(s, { cost: 8.5 }), /整数分/);
  addP(s, { id: 'p9', name: '磷酸二氢钾', kind: 'fertilizer' });
  assert.doesNotThrow(() => inB(s, { id: 'b9', productId: 'p9', expireISO: null }));
});

test('applyIntake：禁用商品拒绝进货（只可能来自导入数据的档案）', () => {
  const s = mkState();
  s.products.push({
    id: 'bad', name: '甲胺磷', kind: 'pesticide', regNo: '', spec: '', unit: '瓶',
    maker: '', toxicity: '', restricted: false, note: '',
  });
  assert.throws(() => inB(s, { productId: 'bad' }), /禁用农药，不得进货/);
});

test('applyIntake：未知商品引用拒绝', () => {
  const s = mkState();
  assert.throws(() => inB(s, { productId: 'ghost' }), /商品不存在/);
});

// ---------------------------------------------------------------------------
// 库存派生与批次队列
// ---------------------------------------------------------------------------

test('batchRemaining：剩余 = 进货 − 已售 − 报损，负数拒绝', () => {
  const s = mkState();
  addP(s);
  inB(s, { qty: 10 });
  mkSale(s, { items: [{ productId: 'p1', qty: 3, priceCents: null }] });
  recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b1', qty: 2, reason: 'damaged', note: '' });
  assert.equal(batchRemaining(s, 'b1'), 5);
  assert.throws(() => batchRemaining(s, 'ghost'), /批次不存在/);
});

test('sellableBatches：临期先出、同效期 FIFO、过期剔除、售罄剔除', () => {
  const s = mkState();
  addP(s);
  inB(s, { id: 'b-old', inISO: '2026-06-01', qty: 5, expireISO: '2027-08-01' });       // 最早进货但效期远
  inB(s, { id: 'b-near', inISO: '2026-08-20', qty: 5, expireISO: '2026-11-01' });      // 效期近 → 应排最前
  inB(s, { id: 'b-dead', inISO: '2026-05-01', qty: 4, expireISO: '2026-09-01' });      // 已过期 → 剔除
  const queue = sellableBatches(s, 'p1', T);
  assert.deepEqual(queue.map((b) => b.id), ['b-near', 'b-old']);
  assert.equal(stockOf(s, 'p1', T), 10);
  inB(s, { id: 'b-tie1', inISO: '2026-07-01', qty: 1, expireISO: '2026-12-01' });
  inB(s, { id: 'b-tie2', inISO: '2026-07-01', qty: 1, expireISO: '2026-12-01' });
  const ties = sellableBatches(s, 'p1', T).filter((b) => b.expireISO === '2026-12-01');
  assert.deepEqual(ties.map((b) => b.id), ['b-tie1', 'b-tie2']); // 同效期按进货日先进先出
});

test('到期日当天仍可售，次日为过期（效期边界）', () => {
  const s = mkState();
  addP(s);
  inB(s, { expireISO: T });               // 今天到期
  assert.equal(stockOf(s, 'p1', T), 10);
  assert.equal(stockOf(s, 'p1', addDays(T, 1)), 0);
  assert.equal(expiredBatches(s, addDays(T, 1)).length, 1);
  assert.equal(expiredBatches(s, T).length, 0); // 到期日当天不算过期
});

// ---------------------------------------------------------------------------
// 销售落账（FIFO 分配 / 整单拒绝 / 限用实名）
// ---------------------------------------------------------------------------

test('applySale：跨批次 FIFO 分配（临期批先出，多批接续）', () => {
  const s = mkState();
  addP(s);
  inB(s, { id: 'b-near', inISO: '2026-08-20', qty: 3, expireISO: '2026-10-01', lotNo: 'LOT-NEAR' });
  inB(s, { id: 'b-far', inISO: '2026-08-01', qty: 5, expireISO: '2027-08-01', lotNo: 'LOT-FAR' });
  const sale = mkSale(s, { items: [{ productId: 'p1', qty: 5, priceCents: 1000 }] });
  assert.deepEqual(sale.items[0].allocations, [
    { batchId: 'b-near', qty: 3 },
    { batchId: 'b-far', qty: 2 },
  ]);
  assert.equal(batchRemaining(s, 'b-near'), 0);
  assert.equal(batchRemaining(s, 'b-far'), 3);
});

test('applySale：任何一品库存不足 → 整单拒绝，绝不部分入账', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '80% 代森锰锌可湿性粉剂' });
  inB(s, { productId: 'p1', qty: 5 });
  inB(s, { id: 'b2', productId: 'p2', qty: 1 });
  assert.throws(() => mkSale(s, {
    items: [
      { productId: 'p1', qty: 5, priceCents: 1000 },
      { productId: 'p2', qty: 2, priceCents: 500 },
    ],
  }), /可售库存不足/);
  assert.equal(s.sales.length, 0);                       // 第一品也没有被入账
  assert.equal(batchRemaining(s, 'b1'), 5);
  assert.equal(batchRemaining(s, 'b2'), 1);
});

test('applySale：限用农药强制实名——缺姓名或身份证号拒绝落账', () => {
  const s = mkState();
  addP(s, { id: 'p1', name: '磷化铝' });                 // 名录自动 restricted
  assert.equal(s.products[0].restricted, true);
  inB(s);
  assert.throws(() => mkSale(s, { buyerName: '', buyerIdNo: '' }), /实名购买/);
  assert.throws(() => mkSale(s, { buyerName: '王老汉', buyerIdNo: '' }), /实名购买/);
  assert.throws(() => mkSale(s, { buyerName: '王老汉', buyerIdNo: '12345' }), /实名购买/); // <6 位
  assert.doesNotThrow(() => mkSale(s, { buyerName: '王老汉', buyerIdNo: '320911196203045678' }));
  assert.equal(s.sales.length, 1);
});

test('applySale：禁用商品拒绝销售；同商品重复行拒绝；空卖单拒绝', () => {
  const s = mkState();
  s.products.push({
    id: 'bad', name: '克百威', kind: 'pesticide', regNo: '', spec: '', unit: '瓶',
    maker: '', toxicity: '', restricted: false, note: '',
  });
  assert.throws(() => mkSale(s, { items: [{ productId: 'bad', qty: 1, priceCents: null }] }), /不得销售/);
  addP(s);
  inB(s);
  assert.throws(() => mkSale(s, {
    items: [
      { productId: 'p1', qty: 1, priceCents: null },
      { productId: 'p1', qty: 1, priceCents: null },
    ],
  }), /重复出现/);
  assert.throws(() => mkSale(s, { items: [] }), /至少包含一个商品行/);
});

test('applySale：销售日期决定效期过滤——过期批次不参与当日分配', () => {
  const s = mkState();
  addP(s);
  inB(s, { expireISO: '2026-09-04' });                    // 昨天过期
  assert.throws(() => mkSale(s, { dateISO: T }), /可售库存不足/);
  // 回溯到到期日前一天的"补录"仍然成立（台账以销售日为准）
  assert.doesNotThrow(() => mkSale(s, { dateISO: '2026-09-03' }));
});

test('removeSale：撤销只删流水，库存自动精确回滚', () => {
  const s = mkState();
  addP(s);
  inB(s, { qty: 10 });
  mkSale(s, { items: [{ productId: 'p1', qty: 4, priceCents: 1000 }] });
  assert.equal(batchRemaining(s, 'b1'), 6);
  removeSale(s, 'x1');
  assert.equal(s.sales.length, 0);
  assert.equal(batchRemaining(s, 'b1'), 10);
  assert.throws(() => removeSale(s, 'ghost'), /卖单不存在/);
});

// ---------------------------------------------------------------------------
// 报损/封存与账本体检
// ---------------------------------------------------------------------------

test('recordLoss：超量拒绝；封存后从过期名单消失且账实守恒', () => {
  const s = mkState();
  addP(s);
  inB(s, { qty: 8, expireISO: '2026-09-01' });            // 已过期 4 天
  assert.equal(expiredBatches(s, T).length, 1);
  assert.throws(() => recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b1', qty: 9, reason: 'expired', note: '' }), /超过批次剩余/);
  assert.throws(() => recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b1', qty: 1, reason: 'whatever', note: '' }), /未知报损原因/);
  recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b1', qty: 8, reason: 'expired', note: '过期封存' });
  assert.equal(expiredBatches(s, T).length, 0);
  assert.equal(batchRemaining(s, 'b1'), 0);
  assert.equal(conservation(s).residual, 0);
});

test('nearExpiryBatches：窗口含当天与边界，已过期批次不进临期列表', () => {
  const s = mkState();
  addP(s);
  inB(s, { id: 'b-edge', qty: 5, expireISO: addDays(T, 90) });   // 恰在窗沿
  inB(s, { id: 'b-out', qty: 5, expireISO: addDays(T, 91) });    // 窗外一天
  inB(s, { id: 'b-exp', qty: 5, expireISO: addDays(T, -1) });    // 已过期
  const near = nearExpiryBatches(s, T, 90);
  assert.deepEqual(near.map((x) => x.batchId), ['b-edge']);
  assert.equal(near.length, 1);
  assert.equal(near[0].daysLeft, 90);
  assert.equal(nearExpiryBatches(s, T, 91).map((x) => x.batchId).includes('b-out'), true);
});

test('conservation：进货 = 已售 + 报损 + 库存（混合场景残差为 0）', () => {
  const s = mkState();
  addP(s);
  inB(s, { id: 'b1', qty: 20 });
  inB(s, { id: 'b2', qty: 10, expireISO: '2026-09-01' });
  mkSale(s, { items: [{ productId: 'p1', qty: 7, priceCents: 1000 }] });
  recordLoss(s, { id: 'l1', dateISO: T, batchId: 'b2', qty: 10, reason: 'expired', note: '' });
  const cons = conservation(s);
  assert.equal(cons.inQty, 30);
  assert.equal(cons.soldQty, 7);
  assert.equal(cons.lossQty, 10);
  assert.equal(cons.stockQty, 13);
  assert.equal(cons.residual, 0);
});

test('complianceAudit：过期在库 / 限用实名缺漏 / 禁用档案三类都点名', () => {
  const s = mkState();
  addP(s, { id: 'p1', name: '磷化铝' });
  addP(s, { id: 'p2', name: '80% 代森锰锌可湿性粉剂' });
  inB(s, { productId: 'p1', id: 'b1', qty: 5 });
  inB(s, { productId: 'p2', id: 'b2', qty: 5, expireISO: '2026-09-01' });
  // 限用缺实名（历史补录数据）
  s.sales.push({
    id: 'x-bad', dateISO: '2026-08-20', buyerName: '散客', buyerPhone: '', buyerIdNo: '', crop: '', note: '',
    items: [{ productId: 'p1', qty: 1, priceCents: null, allocations: [{ batchId: 'b1', qty: 1 }] }],
  });
  const audit = complianceAudit(s, T);
  assert.equal(audit.restrictedMissingId.length, 1);
  assert.equal(audit.expiredOnShelf.length, 1);
  assert.equal(audit.bannedProducts.length, 0);
  // 导入一份含禁用档案的账本也能被点名
  s.products.push({
    id: 'bad', name: '百草枯', kind: 'pesticide', regNo: '', spec: '', unit: '瓶',
    maker: '', toxicity: '', restricted: false, note: '',
  });
  assert.equal(complianceAudit(s, T).bannedProducts.length, 1);
});

// ---------------------------------------------------------------------------
// 台账导出（第 26/27 条字段口径）
// ---------------------------------------------------------------------------

test('purchaseLedgerRows：字段齐全、时间倒序；saleLedgerRows：限用列实名、金额=数量×单价', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '磷化铝' });
  inB(s, { id: 'b1', supplierId: 'sup1', qty: 10, lotNo: 'LOT-A', trace: 'TRACE-A' });
  inB(s, { id: 'b2', productId: 'p2', inISO: '2026-08-10', qty: 4 });
  const buys = purchaseLedgerRows(s);
  assert.equal(buys.length, 2);
  assert.equal(buys[0].inISO, '2026-08-10');
  assert.equal(buys[1].traceCode, 'TRACE-A');
  assert.equal(buys[1].regNo, 'PD20101234');

  mkSale(s, { id: 'x1', items: [{ productId: 'p1', qty: 3, priceCents: 1000 }] });
  mkSale(s, { id: 'x2', buyerName: '赵会计', buyerIdNo: '320911196203045678', items: [{ productId: 'p2', qty: 1, priceCents: 2500 }] });
  const sells = saleLedgerRows(s);
  assert.equal(sells.length, 2);
  assert.equal(sells[0].dateISO, T);
  const limited = sells.find((r) => r.restricted);
  assert.equal(limited.buyerIdNo, '320911196203045678');
  assert.equal(sells.find((r) => !r.restricted).buyerIdNo, ''); // 非限用不出示证件号（最小披露）
  assert.equal(limited.amountCents, 2500);
});

test('台账文本：确定性输出，含许可证号与「保存 2 年」口径，限用实名落字', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '磷化铝' });
  inB(s, { qty: 10, lotNo: 'LOT-A' });
  inB(s, { id: 'b2', productId: 'p2', qty: 2 });
  mkSale(s, { items: [{ productId: 'p1', qty: 2, priceCents: 1000 }] });
  mkSale(s, { id: 'x2', buyerName: '赵会计', buyerIdNo: '320911196203045678', items: [{ productId: 'p2', qty: 1, priceCents: 2500 }] });
  const buy1 = purchaseLedgerText({ state: s, todayISOStr: T });
  const buy2 = purchaseLedgerText({ state: s, todayISOStr: T });
  assert.equal(buy1, buy2);
  assert.ok(buy1.includes('TEST-001'));
  assert.ok(buy1.includes('保存 2 年'));
  assert.ok(buy1.includes('LOT-A'));
  const saleText = saleLedgerText({ state: s, todayISOStr: T });
  assert.equal(saleText, saleLedgerText({ state: s, todayISOStr: T }));
  assert.ok(saleText.includes('实名 320911196203045678'));
});

test('proofOfSale：按人捞出全部卖单与批次信息；未查到如实出具；空姓名拒绝', () => {
  const s = mkState();
  addP(s);
  inB(s, { id: 'b1', qty: 10, lotNo: 'LOT-A', trace: 'TRACE-A' });
  inB(s, { id: 'b2', inISO: '2026-08-15', qty: 5, lotNo: 'LOT-B' });
  mkSale(s, { id: 'x1', dateISO: '2026-08-20', items: [{ productId: 'p1', qty: 6, priceCents: 1000 }] });
  mkSale(s, { id: 'x2', dateISO: T, items: [{ productId: 'p1', qty: 1, priceCents: 1000 }] });
  mkSale(s, { id: 'x3', dateISO: T, buyerName: '李大姐', items: [{ productId: 'p1', qty: 1, priceCents: 1000 }] });
  const proof = proofOfSale(s, { buyerName: '王老汉', todayISOStr: T });
  assert.equal(proof.count, 2);
  assert.ok(proof.text.includes('TEST-001'));
  assert.ok(proof.text.includes('LOT-A'));
  assert.ok(proof.text.includes('TRACE-A'));
  assert.ok(proof.text.indexOf('■ 2026-08-20') < proof.text.indexOf('■ 2026-09-05')); // 按时间升序
  const onDate = proofOfSale(s, { buyerName: '王老汉', dateISO: T, todayISOStr: T });
  assert.equal(onDate.count, 1);
  const none = proofOfSale(s, { buyerName: '查无此人', todayISOStr: T });
  assert.equal(none.count, 0);
  assert.ok(none.text.includes('未查到'));
  assert.throws(() => proofOfSale(s, { buyerName: '  ', todayISOStr: T }), /购买人姓名/);
});

test('inspectionHtml：单文件无外部资源、转义买主注入、含账实体检与盘点表', () => {
  const s = mkState();
  addP(s);
  addP(s, { id: 'p2', name: '磷化铝' });
  inB(s, { qty: 10, lotNo: 'LOT-A', expireISO: '2026-09-01' });   // 过期在库
  inB(s, { id: 'b2', productId: 'p2', qty: 5 });
  mkSale(s, {
    buyerName: '<script>alert(1)</script>',
    buyerIdNo: '320911196203045678',
    items: [{ productId: 'p2', qty: 2, priceCents: 2500 }],
  });
  const html = inspectionHtml({ state: s, todayISOStr: T });
  assert.ok(!html.includes('http://'));
  assert.ok(!html.includes('https://'));
  assert.ok(!html.includes('<script src='));
  assert.ok(!html.includes('rel="stylesheet" href='));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('TEST-001'));
  assert.ok(html.includes('账本体检'));
  assert.ok(html.includes('已过期须封存'));
  assert.ok(html.includes('库存效期盘点'));
});

// ---------------------------------------------------------------------------
// 数据导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = mkState();
  addP(s);
  inB(s);
  mkSale(s);
  const restored = importBundle(exportBundle(s));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state, s);
});

test('importBundle 拒绝坏 JSON / 错应用 / 高版本 / 缺结构', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle('{"app":"classoff","version":1,"state":{}}').ok, false);
  assert.equal(importBundle('{"app":"agriledger","version":99,"state":{}}').ok, false);
  const bad = importBundle('{"app":"agriledger","version":1,"state":{"shop":{}}}');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /结构不完整/);
});

// ---------------------------------------------------------------------------
// 常量与口径
// ---------------------------------------------------------------------------

test('品类/毒性/保存年限常量口径', () => {
  assert.deepEqual(Object.keys(PRODUCT_KINDS), ['pesticide', 'seed', 'fertilizer']);
  assert.equal(RESTRICTED_PESTICIDES.length, 7);
  assert.equal(BANNED_PESTICIDES.length, 18);
  assert.equal(STATE_VERSION, 1);
  assert.equal(typeof todayISO(), 'string');
});
