/**
 * tests/core.test.mjs — 烟柜账 CounterBook 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addMonthsExact, daysUntil, monthKey, ageFromDob, escapeHtml,
  RENEW_ADVANCE_DAYS, LICENSE_MAX_YEARS, LICENSE_WARN_DAYS, SUSPENSION_MAX_DAYS, MINOR_AGE, CHANNEL_LOOKBACK_DAYS,
  DEFAULT_RENEW_WARN_DAYS, DEFAULT_CHANNEL_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
  PRODUCT_KINDS, PURCHASE_SOURCES, LEGAL_SOURCE_FOR_KIND, DAYCHECK_ITEMS_BASE, DAYCHECK_ITEMS_VAPE,
  DUTY_KINDS, CHANGE_KINDS, EVENT_SOURCES,
  licenseState, renewLicense, startSuspension, endSuspension, suspensionState,
  addProduct, onSaleProducts, setProductOnSale, channelState,
  addPurchase, daycheckItemsFor, recordDaycheck, lastDaycheck,
  addEvent, fixEvent, closeEvent, openEvents,
  sellGate, addSale, removeSale, todaySales,
  addChange, fileChange, openChanges,
  setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary, inspectHtml, dayPassHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';
import { emptyState, track } from '../app/js/store.js';

const T = '2026-09-09'; // 测试锚定日期（周三），不依赖墙钟

function freshState() {
  return emptyState();
}

/** 一个全绿的可售烟状态（许可证远期 + 卷烟/电子烟品规各一 + 合法进货 + 库存充足） */
function readyState() {
  const s = freshState();
  s.shop.name = '金叶便利店';
  s.shop.licenseNo = '烟零售许〔2024〕03301 号';
  s.shop.licenseExpiryISO = '2027-09-09';
  s.smoke = addProduct(s, { name: '软中华（84mm 硬盒）', kind: 'cigarette', code: '6901028xxxxxxxx1' });
  s.vape = addProduct(s, { name: '某品牌烟弹·烟草口味', kind: 'vape', code: 'VP-TB-001' });
  addPurchase(s, { dateISO: '2026-09-01', productId: s.smoke.id, source: 'localWholesale', orderNo: 'JY-20260901-01', qty: 20 });
  addPurchase(s, { dateISO: '2026-09-01', productId: s.vape.id, source: 'vapePlatform', orderNo: 'PT-20260901-77', qty: 10 });
  return s;
}

// ---------------------------------------------------------------------------
// 日期与工具 + 常量口径基线
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-9'));
  assert.throws(() => assertISO('20260909'));
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
  assert.equal(daysUntil('2026-12-31', T), 113);
  assert.equal(daysUntil('2026-09-09', T), 0);
  assert.equal(Object.is(daysUntil('2026-09-09', T), -0), false);
  assert.equal(monthKey('2026-09-09'), '2026-09');
});

test('ageFromDob：18 周岁生日当天已满；生日前一天仍 17；未来日期无效', () => {
  assert.equal(ageFromDob('2008-09-09', T), 18, '生日当天=已满 18');
  assert.equal(ageFromDob('2008-09-10', T), 17, '生日前一天=17');
  assert.equal(ageFromDob('2008-12-31', T), 17);
  assert.equal(ageFromDob('2008-01-01', T), 18);
  assert.equal(ageFromDob('2026-09-10', T), -1);
  assert.throws(() => ageFromDob('2008-13-01', T));
});

test('法定/产品常数基线：届满 30 日延续窗口、有效期上限 5 年、停业上限 1 年、18 岁红线、渠道回看 90 天', () => {
  assert.equal(RENEW_ADVANCE_DAYS, 30);          // 实施细则第 22 条：届满 30 日前提出延续申请
  assert.equal(LICENSE_MAX_YEARS, 5);            // 实施细则第 48 条：有效期最长不超过 5 年
  assert.equal(SUSPENSION_MAX_DAYS, 365);        // 实施细则第 23 条：停业不得超过一年
  assert.equal(MINOR_AGE, 18);                   // 未保法第 59 条
  assert.equal(LICENSE_WARN_DAYS, 90);
  assert.equal(CHANNEL_LOOKBACK_DAYS, 90);
  assert.equal(DEFAULT_RENEW_WARN_DAYS, 30);
  assert.equal(DEFAULT_CHANNEL_WARN_DAYS, 14);
  assert.equal(DEFAULT_DUTY_WARN_DAYS, 15);
  assert.equal(STATE_VERSION, 1);
  assert.deepEqual(Object.keys(PRODUCT_KINDS).sort(), ['cigar', 'cigarette', 'cutTobacco', 'vape']);
  // 实施条例第 23 条第二款 + 电子烟办法第 19/20 条：类型驱动的合法进货来源
  assert.equal(LEGAL_SOURCE_FOR_KIND.cigarette, 'localWholesale');
  assert.equal(LEGAL_SOURCE_FOR_KIND.cigar, 'localWholesale');
  assert.equal(LEGAL_SOURCE_FOR_KIND.cutTobacco, 'localWholesale');
  assert.equal(LEGAL_SOURCE_FOR_KIND.vape, 'vapePlatform');
  assert.ok(PURCHASE_SOURCES.localWholesale.includes('当地烟草专卖批发企业'));
  assert.ok(PURCHASE_SOURCES.vapePlatform.includes('交易管理平台'));
  assert.ok(PURCHASE_SOURCES.other.includes('待核'));
  assert.equal(DAYCHECK_ITEMS_BASE.length, 3, '基础三项：张贴/无自助售卖/无网络售烟');
  assert.equal(DAYCHECK_ITEMS_VAPE.length, 2, '电子烟追加两项：口味/平台单');
  assert.deepEqual(Object.keys(DUTY_KINDS), ['stocktake', 'bizLicense', 'licenseSelfcheck', 'vapeReconcile']);
  assert.deepEqual(Object.keys(CHANGE_KINDS), ['address', 'subject', 'scope', 'name', 'other']);
  assert.deepEqual(Object.keys(EVENT_SOURCES), ['daycheck', 'inspection', 'selfcheck']);
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

// ---------------------------------------------------------------------------
// 许可证钟（专卖法第 3/16/32 条；实施细则第 22/48 条）与停业登记
// ---------------------------------------------------------------------------

test('licenseState 五态：unset 红 / overdue 红 / window 黄（届满 30 日）/ warn 黄 / ok 绿', () => {
  const s = freshState();
  const unset = licenseState(s.shop, T);
  assert.equal(unset.level, 'unset');
  assert.ok(unset.detail.includes('第 3/16 条'), 'unset 文案应带法条锚');
  s.shop.licenseExpiryISO = '2026-09-01';
  assert.equal(licenseState(s.shop, T).level, 'overdue');
  s.shop.licenseExpiryISO = '2026-09-20';
  assert.equal(licenseState(s.shop, T).level, 'window');     // 剩 11 天 ≤ 30 天窗口
  s.shop.licenseExpiryISO = '2026-11-01';
  assert.equal(licenseState(s.shop, T).level, 'warn');       // 剩 53 天 ≤ 90 天提醒
  s.shop.licenseExpiryISO = '2027-03-01';
  assert.equal(licenseState(s.shop, T).level, 'ok');
  s.shop.licenseExpiryISO = '2026-08-01';
  assert.ok(licenseState(s.shop, T).detail.includes('第 57 条'), '过期文案应带条例第 57 条罚则锚');
});

test('renewLicense：新有效期必须晚于当前；办结滚动许可证钟', () => {
  const s = freshState();
  assert.throws(() => renewLicense(s.shop, '2027-01-01'), /先在店铺建档/);
  s.shop.licenseExpiryISO = '2026-09-20';
  assert.throws(() => renewLicense(s.shop, '2026-09-20'), /晚于当前/);
  renewLicense(s.shop, '2031-09-19');
  assert.equal(s.shop.licenseExpiryISO, '2031-09-19');
  assert.ok(s.shop.renewedISO);
  assert.equal(licenseState(s.shop, T).level, 'ok');
});

test('startSuspension/endSuspension/suspensionState：停业 1 年上限红线', () => {
  const s = freshState();
  assert.equal(suspensionState(s.shop, T).level, 'none');
  startSuspension(s.shop, '2025-08-01', '店铺装修');
  assert.throws(() => startSuspension(s.shop, T), /已处于停业登记/);
  const over = suspensionState(s.shop, T); // 停业 404 天
  assert.equal(over.level, 'overdue');
  assert.ok(over.detail.includes('实施细则第 23 条'));
  assert.throws(() => endSuspension(s.shop, '2025-07-01'), /早于停业日/);
  const { days } = endSuspension(s.shop, '2026-01-10');
  assert.equal(days, 162);
  assert.equal(suspensionState(s.shop, T).level, 'none');
});

// ---------------------------------------------------------------------------
// 品规一物一档（电子烟办法第 26 条建档即拦调味电子烟）
// ---------------------------------------------------------------------------

test('addProduct：编号唯一；调味电子烟建档即拒；电子烟须警示标识确认', () => {
  const s = freshState();
  const p1 = addProduct(s, { name: '软中华', kind: 'cigarette', code: 'A001' });
  assert.equal(p1.stock, 0);
  assert.ok(p1.onSale);
  assert.throws(() => addProduct(s, { name: '重复编号', kind: 'cigarette', code: 'A001' }), /已建档/);
  assert.throws(() => addProduct(s, { name: '', kind: 'cigarette', code: 'A002' }), /必填/);
  assert.throws(() => addProduct(s, { name: '无编号', kind: 'cigarette', code: '' }), /必填/);
  assert.throws(() => addProduct(s, { name: '非法品类', kind: 'hookah', code: 'A003' }), /非法品类/);
  // 电子烟办法第 26 条：禁止销售除烟草口味外的调味电子烟——建档即拦
  assert.throws(() => addProduct(s, { name: '果味烟弹', kind: 'vape', code: 'VP-FL-01', flavor: 'fruit' }), /电子烟办法第 26 条/);
  assert.throws(() => addProduct(s, { name: '无警语烟弹', kind: 'vape', code: 'VP-TB-02', flavor: 'tobacco', warnLabel: false }), /警语/);
  const okVape = addProduct(s, { name: '烟草味烟弹', kind: 'vape', code: 'VP-TB-03', flavor: 'tobacco' });
  assert.equal(okVape.flavor, 'tobacco', '电子烟口味强制落 tobacco');
});

test('setProductOnSale：停售后渠道闸不放行，历史销售台账可回溯', () => {
  const s = readyState();
  setProductOnSale(s, s.smoke.id, false);
  assert.equal(onSaleProducts(s).length, 1);
  const ch = channelState(s.smoke, s, T);
  assert.equal(ch.level, 'offSale');
});

// ---------------------------------------------------------------------------
// 进货台账与渠道钟（实施条例第 23 条第二款/第 24 条；电子烟办法第 19/20 条）
// ---------------------------------------------------------------------------

test('addPurchase：来源与品类错配当场拒绝；数量正整数；同单号防重', () => {
  const s = freshState();
  const smoke = addProduct(s, { name: '利群', kind: 'cigarette', code: 'A010' });
  // 卷烟走电子烟平台=错配拒绝
  assert.throws(() => addPurchase(s, { dateISO: T, productId: smoke.id, source: 'vapePlatform', orderNo: 'X', qty: 1 }), /当地烟草专卖批发企业/);
  // 电子烟走当地批发=错配拒绝
  const vape = addProduct(s, { name: '烟弹', kind: 'vape', code: 'V010' });
  assert.throws(() => addPurchase(s, { dateISO: T, productId: vape.id, source: 'localWholesale', orderNo: 'Y', qty: 1 }), /交易管理平台/);
  assert.throws(() => addPurchase(s, { dateISO: T, productId: smoke.id, source: 'localWholesale', qty: 0 }), /正整数/);
  assert.throws(() => addPurchase(s, { dateISO: T, productId: smoke.id, source: 'localWholesale', qty: 1.5 }), /正整数/);
  addPurchase(s, { dateISO: T, productId: smoke.id, source: 'localWholesale', orderNo: 'JY-1', qty: 10 });
  assert.throws(() => addPurchase(s, { dateISO: T, productId: smoke.id, source: 'localWholesale', orderNo: 'JY-1', qty: 5 }), /防重复录入/);
  // 实施条例第 24 条：一次销售卷烟、雪茄烟 50 条以上视为无证批发（非当地批发来源时提示）
  assert.throws(() => addPurchase(s, { dateISO: T, productId: smoke.id, source: 'other', qty: 60 }), /第 24 条/);
});

test('红旗批次：other 来源自动隔离品规并转合规事件；闭环后解除隔离', () => {
  const s = freshState();
  const smoke = addProduct(s, { name: '红塔山', kind: 'cigarette', code: 'A020' });
  addPurchase(s, { dateISO: T, productId: smoke.id, source: 'localWholesale', orderNo: 'JY-2', qty: 5 });
  const bad = addPurchase(s, { dateISO: addDays(T, 1), productId: smoke.id, source: 'other', orderNo: '', qty: 2 });
  assert.ok(bad.quarantined);
  assert.equal(smoke.quarantinedISO, addDays(T, 1));
  const ch = channelState(smoke, s, addDays(T, 1));
  assert.equal(ch.level, 'quarantined');
  assert.ok(ch.detail.includes('第 56/58 条'));
  // 自动转了一个合规事件
  const evs = openEvents(s);
  assert.equal(evs.length, 1);
  assert.ok(evs[0].desc.includes('红旗批次'));
  // 闭环：整改 → 销案 → 隔离解除
  fixEvent(s, evs[0].id, { actionISO: addDays(T, 2), action: '向烟草专卖局报备并退回该 2 条来路不明卷烟' });
  closeEvent(s, evs[0].id, { verifyISO: addDays(T, 2), verifiedBy: '店主' });
  assert.equal(channelState(smoke, s, addDays(T, 2)).level, 'ok', '闭环后恢复合法渠道在核（此前有合法批次）');
  assert.equal(smoke.quarantinedISO, undefined);
});

test('channelState 六态：none / offSale / quarantined / nolegal / stale（超回看窗）/ ok', () => {
  const s = freshState();
  assert.equal(channelState(null, s, T).level, 'none');
  const smoke = addProduct(s, { name: '云烟', kind: 'cigarette', code: 'A030' });
  // 从未有过合法进货=nolegal（红，售出硬拦），文案带实施条例第 23 条锚
  const nolegal = channelState(smoke, s, T);
  assert.equal(nolegal.level, 'nolegal');
  assert.ok(nolegal.detail.includes('第 23 条'));
  addPurchase(s, { dateISO: T, productId: smoke.id, source: 'localWholesale', orderNo: 'JY-3', qty: 10 });
  assert.equal(channelState(smoke, s, T).level, 'ok');
  assert.equal(channelState(smoke, s, addDays(T, 89)).level, 'ok');
  assert.equal(channelState(smoke, s, addDays(T, 91)).level, 'stale', '超过 90 天回看窗转 stale（黄，提醒补进）');
  assert.ok(channelState(smoke, s, addDays(T, 91)).detail.includes('回看窗'));
});

// ---------------------------------------------------------------------------
// 每日开柜检查（类型驱动；同日唯一；异常转合规事件）
// ---------------------------------------------------------------------------

test('daycheckItemsFor：基础三项；在售电子烟追加两项；停售电子烟不追加', () => {
  const s = freshState();
  const smoke = addProduct(s, { name: '中华', kind: 'cigarette', code: 'A040' });
  assert.equal(daycheckItemsFor(s).length, 3);
  const vape = addProduct(s, { name: '烟弹', kind: 'vape', code: 'V040' });
  assert.equal(daycheckItemsFor(s).length, 5, '在售电子烟追加 2 项');
  assert.ok(daycheckItemsFor(s).at(-1).label.includes('平台'));
  setProductOnSale(s, vape.id, false);
  assert.equal(daycheckItemsFor(s).length, 3, '停售后不再追加');
  assert.ok(smoke && vape);
});

test('recordDaycheck：同日唯一；异常必写处置；异常自动转合规事件', () => {
  const s = freshState();
  addProduct(s, { name: '中华', kind: 'cigarette', code: 'A050' });
  const items = daycheckItemsFor(s);
  assert.throws(() => recordDaycheck(s, { dateISO: T, results: {} }), /异常必须|处置说明/);
  // 全 ok
  const rec = recordDaycheck(s, { dateISO: T, results: Object.fromEntries(items.map((i) => [i.key, { ok: true, note: '' }])) });
  assert.equal(rec.status, 'ok');
  assert.throws(() => recordDaycheck(s, { dateISO: T, results: {} }), /同日唯一/);
  // 次日 1 项异常必写处置
  const t2 = addDays(T, 1);
  assert.throws(() => recordDaycheck(s, {
    dateISO: t2,
    results: Object.fromEntries(items.map((i) => [i.key, { ok: i.key !== 'signage', note: '' }])),
  }), /处置说明/);
  recordDaycheck(s, {
    dateISO: t2,
    results: Object.fromEntries(items.map((i) => [i.key, i.key === 'signage'
      ? { ok: false, note: '标志被风吹落，已重新张贴并加双面胶' }
      : { ok: true, note: '' }])),
  });
  const evs = openEvents(s);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].source, 'daycheck');
  assert.ok(evs[0].desc.includes('开柜检查异常'));
  assert.equal(lastDaycheck(s).dateISO, t2);
});

// ---------------------------------------------------------------------------
// 合规事件闭环（状态机 open → fixed → closed）
// ---------------------------------------------------------------------------

test('addEvent/fixEvent/closeEvent：跳级拒绝；日期顺序校验', () => {
  const s = freshState();
  assert.throws(() => addEvent(s, { dateISO: T, desc: '' }), /必填/);
  const ev = addEvent(s, { dateISO: T, source: 'inspection', desc: '烟草专卖局检查指出一批卷烟无法提供当地批发订单' });
  assert.throws(() => closeEvent(s, ev.id, { verifyISO: T, verifiedBy: '店主' }), /先登记处置措施/);
  assert.throws(() => fixEvent(s, ev.id, { actionISO: addDays(T, -1), action: 'x' }), /早于发现日/);
  assert.throws(() => fixEvent(s, ev.id, { actionISO: T, action: '' }), /必填/);
  fixEvent(s, ev.id, { actionISO: addDays(T, 1), action: '补交订单凭证并向专卖局书面说明' });
  assert.throws(() => fixEvent(s, ev.id, { actionISO: T, action: 'x' }), /只有未整改/);
  assert.throws(() => closeEvent(s, ev.id, { verifyISO: T, verifiedBy: '店主' }), /早于处置完成日/);
  assert.throws(() => closeEvent(s, ev.id, { verifyISO: addDays(T, 2), verifiedBy: '' }), /复查人必填/);
  closeEvent(s, ev.id, { verifyISO: addDays(T, 2), verifiedBy: '店主' });
  assert.throws(() => closeEvent(s, ev.id, { verifyISO: addDays(T, 3), verifiedBy: '店主' }), /已闭环/);
  assert.equal(openEvents(s).length, 0);
});

// ---------------------------------------------------------------------------
// 售烟四闸（产品的核心门禁）
// ---------------------------------------------------------------------------

test('sellGate 闸 1：许可证过期/未登记拦截，延续窗口放行', () => {
  const s = readyState();
  s.shop.licenseExpiryISO = '';
  let g = sellGate(s, { dateISO: T, productId: s.smoke.id, qty: 1 });
  assert.equal(g.ok, false);
  assert.ok(g.reasons[0].includes('第 3/16 条'));
  s.shop.licenseExpiryISO = '2026-09-01';
  g = sellGate(s, { dateISO: T, productId: s.smoke.id, qty: 1 });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.join('').includes('第 57 条'));
  s.shop.licenseExpiryISO = '2026-09-25'; // window：剩 16 天，仍有效
  g = sellGate(s, { dateISO: T, productId: s.smoke.id, qty: 1 });
  assert.equal(g.ok, true, '延续窗口期许可证仍有效——放行只提醒');
  assert.equal(g.gates.find((x) => x.key === 'license').ok, true);
});

test('sellGate 闸 2：无合法进货/来源待核/库存不足拦截；品规停售拦截', () => {
  const s = freshState();
  const smoke = addProduct(s, { name: '黄金叶', kind: 'cigarette', code: 'A060' });
  s.shop.licenseExpiryISO = '2027-09-09';
  // 无进货记录
  let g = sellGate(s, { dateISO: T, productId: smoke.id, qty: 1 });
  assert.equal(g.gates.find((x) => x.key === 'channel').ok, false);
  assert.ok(g.reasons.join('').includes('第 23 条'));
  // 进货 2 条后放行
  addPurchase(s, { dateISO: addDays(T, -5), productId: smoke.id, source: 'localWholesale', orderNo: 'JY-6', qty: 2 });
  g = sellGate(s, { dateISO: T, productId: smoke.id, qty: 1 });
  assert.equal(g.ok, true);
  // 库存不足
  g = sellGate(s, { dateISO: T, productId: smoke.id, qty: 3 });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.join('').includes('库存不足'));
  // 停售
  setProductOnSale(s, smoke.id, false);
  g = sellGate(s, { dateISO: T, productId: smoke.id, qty: 1 });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.join('').includes('停售'));
});

test('sellGate 闸 3：疑似未成年三态——未核验拦截 / 核验后未成年硬拒 / 核验成年人放行', () => {
  const s = readyState();
  // 疑似未成年未核验
  let g = sellGate(s, { dateISO: T, productId: s.smoke.id, qty: 1, buyerLooksMinor: true });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.join('').includes('未保法第 59 条'));
  assert.ok(g.reasons.join('').includes('出示身份证件'));
  // 核验后仍未满 18 → 硬拒
  g = sellGate(s, { dateISO: T, productId: s.smoke.id, qty: 1, buyerLooksMinor: true, ageVerified: true, buyerDobISO: '2008-09-10' });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.join('').includes('第 123 条'), '硬拒文案带未保法罚则锚');
  assert.ok(g.reasons.join('').includes('17 周岁'));
  // 18 岁生日当天 → 放行（法定已满）
  g = sellGate(s, { dateISO: T, productId: s.smoke.id, qty: 1, buyerLooksMinor: true, ageVerified: true, buyerDobISO: '2008-09-09' });
  assert.equal(g.ok, true);
  // 核验为成年人（无出生日期留痕）→ 放行
  g = sellGate(s, { dateISO: T, productId: s.smoke.id, qty: 1, buyerLooksMinor: true, ageVerified: true });
  assert.equal(g.ok, true);
  // 无未成年人表征 → 放行
  g = sellGate(s, { dateISO: T, productId: s.smoke.id, qty: 1 });
  assert.equal(g.ok, true);
});

test('sellGate 闸 4：在售电子烟必须有平台进货单号留痕', () => {
  const s = readyState();
  // vape 进货带平台单号 → 过
  let g = sellGate(s, { dateISO: T, productId: s.vape.id, qty: 1 });
  assert.equal(g.gates.find((x) => x.key === 'vape').ok, true);
  // 无单号留痕的电子烟品规
  const vape2 = addProduct(s, { name: '无单烟弹', kind: 'vape', code: 'VP-X-1' });
  g = sellGate(s, { dateISO: T, productId: vape2.id, qty: 1 });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.join('').includes('电子烟办法第 19 条'));
});

test('addSale：四闸全过才落账+扣库存+快照；拦截不落账', () => {
  const s = readyState();
  assert.equal(s.smoke.stock, 20);
  const rec = addSale(s, { dateISO: T, productId: s.smoke.id, qty: 2, buyerLooksMinor: true, ageVerified: true });
  assert.equal(rec.snapshot.licenseExpiryISO, '2027-09-09');
  assert.equal(rec.snapshot.stockAfter, 18);
  assert.equal(s.smoke.stock, 18);
  assert.ok(rec.minorCheck.includes('已核验'));
  // 拦截：未核验未成年
  assert.throws(() => addSale(s, { dateISO: T, productId: s.smoke.id, qty: 1, buyerLooksMinor: true }), /售烟被闸机拦截/);
  assert.equal(s.sales.length, 1, '拦截不落账');
  assert.equal(s.smoke.stock, 18, '拦截不扣库存');
});

test('removeSale：回滚库存；删除留痕', () => {
  const s = readyState();
  const rec = addSale(s, { dateISO: T, productId: s.smoke.id, qty: 3 });
  assert.equal(s.smoke.stock, 17);
  removeSale(s, rec.id);
  assert.equal(s.smoke.stock, 20);
  assert.throws(() => removeSale(s, rec.id), /不存在/);
});

test('todaySales 计数：笔数/盒数/核验笔数', () => {
  const s = readyState();
  addSale(s, { dateISO: T, productId: s.smoke.id, qty: 1 });
  addSale(s, { dateISO: T, productId: s.vape.id, qty: 2, buyerLooksMinor: true, ageVerified: true });
  addSale(s, { dateISO: addDays(T, -1), productId: s.smoke.id, qty: 5 });
  const ts = todaySales(s, T);
  assert.equal(ts.count, 2);
  assert.equal(ts.units, 3);
  assert.equal(ts.minorBlocked, 1);
});

// ---------------------------------------------------------------------------
// 变更手续 / 周期义务
// ---------------------------------------------------------------------------

test('addChange/fileChange：办结日期顺序；未办结列表', () => {
  const s = freshState();
  assert.throws(() => addChange(s, { dateISO: T, kind: 'bad', detail: 'x' }), /非法变更情形/);
  const cg = addChange(s, { dateISO: T, kind: 'address', detail: '迁至隔壁 12-2 号' });
  assert.equal(openChanges(s).length, 1);
  assert.throws(() => fileChange(s, cg.id, addDays(T, -1)), /早于变更发生日/);
  fileChange(s, cg.id, addDays(T, 5));
  assert.equal(openChanges(s).length, 0);
  assert.throws(() => fileChange(s, cg.id, T), /已办结/);
});

test('dutyBoard：never 入板；电子烟对账义务仅电子烟户出现；周期滚动', () => {
  const s = freshState();
  addProduct(s, { name: '中华', kind: 'cigarette', code: 'A070' });
  let board = dutyBoard(s, T);
  assert.ok(!board.some((d) => d.kind === 'vapeReconcile'), '无电子烟不显示平台对账');
  assert.equal(board.filter((d) => d.level === 'never').length, 3);
  addProduct(s, { name: '烟弹', kind: 'vape', code: 'V070' });
  board = dutyBoard(s, T);
  assert.ok(board.some((d) => d.kind === 'vapeReconcile'), '电子烟户显示平台对账');
  setDutyDone(s, 'stocktake', addDays(T, -40));
  const st = dutyBoard(s, T).find((d) => d.kind === 'stocktake');
  assert.equal(st.level, 'overdue', '30 天周期超 40 天=逾期');
  assert.equal(st.nextDue, addDays(T, -10));
  setDutyDone(s, 'stocktake', addDays(T, -5));
  assert.equal(dutyBoard(s, T).find((d) => d.kind === 'stocktake').level, 'ok');
  assert.throws(() => setDutyDone(s, 'bad', T), /非法义务类型/);
});

test('dutyState 同日边界不出现 -0 挂 strict 断言', () => {
  const s = freshState();
  setDutyDone(s, 'stocktake', T);
  const st = dutyState(s.duties[0], addDays(T, 30));
  assert.equal(st.daysLeft, 0);
  assert.equal(Object.is(st.daysLeft, -0), false);
});

// ---------------------------------------------------------------------------
// 十项体检
// ---------------------------------------------------------------------------

test('healthCheck 十项结构固定；全绿状态 100 分', () => {
  const s = readyState();
  // 补齐全绿：今日销售 + 今日开柜检查 + 义务 + 年报
  addSale(s, { dateISO: T, productId: s.smoke.id, qty: 1 });
  const items = daycheckItemsFor(s);
  recordDaycheck(s, { dateISO: T, results: Object.fromEntries(items.map((i) => [i.key, { ok: true, note: '' }])) });
  setDutyDone(s, 'stocktake', addDays(T, -5));
  setDutyDone(s, 'bizLicense', addDays(T, -100));
  setDutyDone(s, 'licenseSelfcheck', addDays(T, -30));
  setDutyDone(s, 'vapeReconcile', addDays(T, -3));
  const hc = healthCheck(s, T);
  assert.equal(hc.items.length, 10);
  assert.equal(hc.bad, 0, `应无红灯：${hc.items.filter((i) => i.level === 'bad').map((i) => i.label + '→' + i.detail).join(' | ')}`);
  assert.equal(hc.score, 100, `全绿得分 100（warn=${hc.warn}: ${hc.items.filter((i) => i.level === 'warn').map((i) => i.label).join('、')}）`);
});

test('healthCheck：空账本有红灯；渠道在核为绿、超回看窗转黄', () => {
  const s = freshState();
  const hc0 = healthCheck(s, T);
  assert.ok(hc0.bad >= 2);
  assert.ok(hc0.score < 100);
  assert.equal(hc0.items[0].key, 'license');
  // 刚进货 8 天（< 90 天回看窗）→ 渠道绿
  const s2 = readyState();
  const hc1 = healthCheck(s2, T);
  assert.equal(hc1.items.find((i) => i.key === 'channel').level, 'ok');
  // 把最近合法进货回推到 91 天前 → 渠道黄（stale）
  s2.purchases = s2.purchases.map((b) => ({ ...b, dateISO: addDays(T, -91) }));
  const hc2 = healthCheck(s2, T);
  assert.equal(hc2.items.find((i) => i.key === 'channel').level, 'warn');
});

test('healthCheck：体检渠道项在红旗品规隔离时为红灯', () => {
  const s = readyState();
  addPurchase(s, { dateISO: T, productId: s.smoke.id, source: 'other', orderNo: '', qty: 1 });
  const hc = healthCheck(s, T);
  assert.equal(hc.items.find((i) => i.key === 'channel').level, 'bad');
});

// ---------------------------------------------------------------------------
// 月度小结与出证物
// ---------------------------------------------------------------------------

test('monthlySummary：拦截计数含未成年人细分；法条尾注含四修条例口径', () => {
  const s = readyState();
  addSale(s, { dateISO: T, productId: s.smoke.id, qty: 1 });
  try {
    addSale(s, { dateISO: T, productId: s.smoke.id, qty: 1, buyerLooksMinor: true });
  } catch { /* 拦截即埋点 */ }
  track(s, 'sell-blocked', { dateISO: T, reasons: '疑似未成年且未核验（未保法第 59 条）' });
  const sum = monthlySummary(s, '2026-09', T);
  assert.ok(sum.text.includes('闸机拦截不合规售烟 1 次'));
  assert.ok(sum.text.includes('未成年人核验拦截 1 次'));
  assert.ok(sum.text.includes('2023 第四次修订'));
  assert.ok(sum.text.includes('《未成年人保护法》'));
  assert.ok(sum.text.includes('不替代'));
  assert.equal(sum.sales, 1);
});

test('inspectHtml：自证包含九段与关键台账；dayPassHtml 含当日销售与核验', () => {
  const s = readyState();
  addSale(s, { dateISO: T, productId: s.smoke.id, qty: 2, buyerLooksMinor: true, ageVerified: true });
  const items = daycheckItemsFor(s);
  recordDaycheck(s, { dateISO: T, results: Object.fromEntries(items.map((i) => [i.key, { ok: true, note: '' }])) });
  const html = inspectHtml(s, T);
  for (const kw of ['迎检自证包', '金叶便利店', '品规台账', '进货台账', '销售台账', '每日开柜检查', '合规事件闭环', '变更手续台账', '周期义务账', '当地烟草专卖批发企业', '第 46 条']) {
    assert.ok(html.includes(kw), `自证包应含「${kw}」`);
  }
  assert.ok(html.includes('已核验证件（2008-09-09）'.slice(0, 5)) || html.includes('已核验'), '核验留痕入证');
  const pass = dayPassHtml(s, T, T);
  for (const kw of ['当日柜台核对单', '四闸核对', '软中华', '已核验', '不向未成年人售烟']) {
    assert.ok(pass.includes(kw), `核对单应含「${kw}」`);
  }
  assert.throws(() => dayPassHtml(s, '2026-9-9'), /非法日期/);
});

// ---------------------------------------------------------------------------
// 导入导出与防脏数据
// ---------------------------------------------------------------------------

test('exportBundle/importBundle：版本与结构校验，绝不部分接受', () => {
  const s = readyState();
  const bundle = exportBundle(s);
  const res = importBundle(bundle);
  assert.equal(res.ok, true);
  assert.equal(res.state.shop.name, '金叶便利店');
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle('{"app":"venuepass","version":1}').ok, false, '拒绝别家备份');
  assert.equal(importBundle(JSON.stringify({ app: 'counterbook', version: 99, state: s })).ok, false, '拒绝更高版本');
  assert.equal(importBundle(JSON.stringify({ app: 'counterbook', version: 1, state: { shop: {} } })).ok, false, '结构不完整拒绝');
});
