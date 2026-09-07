/**
 * core.test.mjs — 秤平账 FairScale 域逻辑单元测试
 * 口径锚点：《集贸市场计量监督管理办法》（总局令第94号，2025-03-01 施行）
 *          《零售商品称重计量监督管理办法》（总局令第31号2020修订）附表1
 *          《计量法》第9/27条 ·《计量法实施细则》第43/46/48条 ·《消保法》第55条
 * ——条号出处见 docs/14
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays, addMonthsISO, daysUntil, monthKey, todayISO, escapeHtml,
  DEFAULT_SETTINGS, DEVIATION_TABLE, RECHECK_METHOD, DUTY_KINDS, SCALE_CHANGES, COMPLAINT_STATUS,
  negativeDeviation, verifyWeigh, compensation55,
  certLevel, verifyDue, scaleClock, scaleRed, scaleLedgerGaps,
  addScale, updateScale, recordScaleChange, resumeScale,
  logFairCheck, fairDailyLevel,
  logPatrol, patrolState,
  issueCard, liftCard, activeCards,
  createComplaint, recheckComplaint, resolveComplaint, recoverComplaint, closeComplaint,
  complaintOverdue, unrecovered,
  setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary,
  recheckSheetHtml, inspectHtml, monthlyText,
  emptyState, exportBundle, importBundle, seedState,
} from '../app/js/core.js';

const T = '2026-09-07'; // 固定"今天"，测试全部确定性

function fresh() {
  const s = emptyState();
  s.settings = { ...DEFAULT_SETTINGS };
  return s;
}

/** 干净台面：1 杆合规经营秤 + 1 台合规公平秤 + 今日日检 + 今日巡查 + 五项义务全登记 */
function rig(s) {
  s.org = { name: '测试农贸市场', district: '测试区', manager: '测试员', phone: '13800000000', note: '' };
  addScale(s, {
    stall: '01 号·测试', vendor: '张商户', type: '电子计价秤', capacityKg: 30, divisionG: 5,
    certNo: 'CERT-001', verifiedISO: T, stickerAffixed: true,
  });
  const fair = addScale(s, {
    role: 'fair', stall: '公平秤·服务台', type: '电子台秤', capacityKg: 60, divisionG: 10,
    certNo: 'CERT-000', verifiedISO: T, stickerAffixed: true,
  });
  logFairCheck(s, { scaleId: fair.id, dateISO: T, ok: true });
  logPatrol(s, { dateISO: T, stallsChecked: 5, finds: [] });
  for (const kind of Object.keys(DUTY_KINDS)) setDutyDone(s, kind, T);
  return s;
}

/* --------------------------------------------------------- 时间与口径 */

test('addMonthsISO 月末钳制与基础时间工具', () => {
  assert.equal(addMonthsISO('2024-08-31', 12), '2025-08-31'); // 强检 12 个月
  assert.equal(addMonthsISO('2024-02-29', 12), '2025-02-28'); // 闰日钳制
  assert.equal(addDays('2026-09-07', -1), '2026-09-06');
  assert.equal(daysUntil('2026-09-22', T), 15);
  assert.equal(monthKey('2026-09-07'), '2026-09');
});

test('certLevel 三段边界：60 天黄线 / 15 天红线 / 负数过期', () => {
  assert.equal(certLevel(61), 'ok');
  assert.equal(certLevel(60), 'warn');
  assert.equal(certLevel(15), 'red');
  assert.equal(certLevel(0), 'red');
  assert.equal(certLevel(-1), 'expired');
});

test('escapeHtml 转义', () => {
  assert.equal(escapeHtml('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});

/* --------------------------------------------------------- 负偏差附表1（总局令31号2020修订） */

test('负偏差表结构：四档价格档，边界递增且以不设上限收尾', () => {
  const keys = Object.keys(DEVIATION_TABLE);
  assert.deepEqual(keys, ['low', 'mid', 'high', 'premium']);
  for (const k of keys) {
    const bands = DEVIATION_TABLE[k].bands;
    for (let i = 1; i < bands.length; i++) assert.ok(bands[i].max > bands[i - 1].max, k);
    assert.equal(bands[bands.length - 1].max, Infinity);
  }
});

test('负偏差查表边界：粮果蔬档 1/2/4 千克 → 20/40/80/100 克', () => {
  assert.equal(negativeDeviation('low', 1).limitG, 20);
  assert.equal(negativeDeviation('low', 1.001).limitG, 40);
  assert.equal(negativeDeviation('low', 2).limitG, 40);
  assert.equal(negativeDeviation('low', 2.001).limitG, 80);
  assert.equal(negativeDeviation('low', 4).limitG, 80);
  assert.equal(negativeDeviation('low', 4.001).limitG, 100);
});

test('负偏差查表边界：肉蛋档 2.5/10 千克 → 5/10/15 克；高档与贵价档', () => {
  assert.equal(negativeDeviation('mid', 2.5).limitG, 5);
  assert.equal(negativeDeviation('mid', 2.6).limitG, 10);
  assert.equal(negativeDeviation('mid', 10).limitG, 10);
  assert.equal(negativeDeviation('mid', 10.6).limitG, 15);
  assert.equal(negativeDeviation('high', 1).limitG, 2);
  assert.equal(negativeDeviation('high', 1.5).limitG, 4);
  assert.equal(negativeDeviation('high', 4).limitG, 4);
  assert.equal(negativeDeviation('high', 4.5).limitG, 6);
  assert.equal(negativeDeviation('premium', 0.5).limitG, 1);
  assert.equal(negativeDeviation('premium', 0.75).limitG, 2);
  assert.equal(negativeDeviation('premium', 2).limitG, 2);
  assert.equal(negativeDeviation('premium', 2.5).limitG, 3);
});

test('负偏差查表：未知档与非法重量拒绝', () => {
  assert.throws(() => negativeDeviation('nope', 1), /价格档/);
  assert.throws(() => negativeDeviation('low', 0), /正数/);
  assert.throws(() => negativeDeviation('low', -1), /正数/);
  assert.throws(() => negativeDeviation('low', 'abc'), /正数/);
});

/* --------------------------------------------------------- 复秤判定（第6条三种核称法） */

test('复秤判定：原器具/高准确度核称——差值超负偏差即超差', () => {
  const v = verifyWeigh({ band: 'mid', settleKg: 2, actualKg: 1.95, method: 'same' });
  assert.equal(v.limitG, 5);
  assert.equal(v.diffG, 50);
  assert.equal(v.excess, true);
  const ok2 = verifyWeigh({ band: 'mid', settleKg: 2, actualKg: 1.999, method: 'same' });
  assert.equal(ok2.diffG, 1);
  assert.equal(ok2.excess, false);
});

test('复秤判定：等准确度核称放宽 2 倍；多给（负差值）不判超差', () => {
  const same = verifyWeigh({ band: 'low', settleKg: 4.5, actualKg: 4.39, method: 'same' });
  assert.equal(same.limitG, 100);
  assert.equal(same.excess, true);            // 110g > 100g
  const equal = verifyWeigh({ band: 'low', settleKg: 4.5, actualKg: 4.39, method: 'equal' });
  assert.equal(equal.allowedG, 200);
  assert.equal(equal.excess, false);          // 110g ≤ 200g
  const gave = verifyWeigh({ band: 'mid', settleKg: 2, actualKg: 2.05, method: 'same' });
  assert.equal(gave.diffG, -50);
  assert.equal(gave.excess, false);
  assert.throws(() => verifyWeigh({ band: 'low', settleKg: 1, actualKg: 0.9, method: 'zzz' }), /核称法/);
  assert.throws(() => verifyWeigh({ band: 'low', settleKg: 0, actualKg: 0.9 }), /正数/);
});

/* --------------------------------------------------------- 消保法第55条计算器 */

test('55条计算器：三倍价款不足 500 元按 500 元；差价另退', () => {
  // 低价档：12 元/kg × 3kg = 36 元价款 → 三倍 108 < 500 → 按 500
  const low = compensation55({ unitPrice: 12, settleKg: 3, actualKg: 2.7 });
  assert.equal(low.pricePaid, 36);
  assert.equal(low.refundDiff, 3.6);
  assert.equal(low.punitive, 500);
  assert.equal(low.total, 503.6);
  // 高价档：96 元/kg × 2kg = 192 元 → 三倍 576 ≥ 500 → 576
  const high = compensation55({ unitPrice: 96, settleKg: 2, actualKg: 1.95 });
  assert.equal(high.punitive, 576);
  assert.equal(high.refundDiff, 4.8);
  assert.equal(high.total, 580.8);
  assert.throws(() => compensation55({ unitPrice: 0, settleKg: 1, actualKg: 0.9 }), /单价/);
  assert.throws(() => compensation55({ unitPrice: -5, settleKg: 1, actualKg: 0.9 }), /单价/);
});

/* --------------------------------------------------------- 一秤一档与强检钟 */

test('建档：摊位必填；经营秤必须登记经营者（第5条(一)核验公示）；公平秤豁免', () => {
  const s = fresh();
  assert.throws(() => addScale(s, { stall: '', vendor: '张' }), /摊位号必填/);
  assert.throws(() => addScale(s, { stall: '02 号', vendor: '' }), /经营者名称必填/);
  const fair = addScale(s, { role: 'fair', stall: '公平秤', vendor: '' });
  assert.equal(fair.role, 'fair');
});

test('强检钟：无检定记录=不得使用（expired）；周期 12 个月；标志未贴=临期级提示', () => {
  const s = fresh();
  const bare = addScale(s, { stall: '02 号', vendor: '无证户' });
  let c = scaleClock(bare, T, s.settings);
  assert.equal(c.level, 'expired');
  assert.ok(c.missing);
  const fresh1 = addScale(s, {
    stall: '03 号', vendor: '新秤户', certNo: 'C1', verifiedISO: addDays(T, -30), stickerAffixed: true,
  });
  c = scaleClock(fresh1, T, s.settings);
  assert.equal(c.level, 'ok');
  assert.equal(c.dueISO, addMonthsISO(addDays(T, -30), 12));
  const noSticker = addScale(s, {
    stall: '04 号', vendor: '缺标户', certNo: 'C2', verifiedISO: addDays(T, -90), stickerAffixed: false,
  });
  c = scaleClock(noSticker, T, s.settings);
  assert.equal(c.level, 'warn');
  assert.ok(scaleRed(noSticker, addMonthsISO(addDays(T, -90), 12) ? addDays(addMonthsISO(addDays(T, -90), 12), 1) : T, s.settings));
});

test('verifyDue 月末钳制 + 属地周期参数可覆盖', () => {
  const s = fresh();
  assert.equal(verifyDue('2024-02-29', s.settings), '2025-02-28');
  const s2 = fresh();
  s2.settings.verifyMonths = 6; // 属地口径半年送检
  const x = addScale(s2, { stall: '05 号', vendor: '半年户', verifiedISO: '2026-01-31', certNo: 'C3', stickerAffixed: true });
  const c = scaleClock(x, T, s2.settings);
  assert.equal(c.dueISO, '2026-07-31');
  assert.equal(c.level, 'expired'); // 2026-09-07 已过 07-31
});

test('登记造册缺项：缺证书号/缺标志（第5条(五)备案清单要能直接用）', () => {
  const s = fresh();
  const x = addScale(s, { stall: '06 号', vendor: '缺项户', verifiedISO: T, certNo: '', stickerAffixed: false });
  assert.deepEqual(scaleLedgerGaps(x), ['缺检定证书号', '强检标志未确认']);
  updateScale(s, x.id, { certNo: 'C4', stickerAffixed: true });
  assert.deepEqual(scaleLedgerGaps(s.scales[0]), []);
});

test('变动报备（第9条(二)）：减少=撤场；更换=停用+旧钟作废；维修=在用但须重新检定；撤场不可恢复', () => {
  const s = fresh();
  const a = addScale(s, { stall: '07 号', vendor: '变动户', certNo: 'C5', verifiedISO: T, stickerAffixed: true });
  recordScaleChange(s, a.id, 'repair', { dateISO: T, note: '换传感器' });
  assert.equal(a.status, 'active');
  assert.equal(a.verifiedISO, '');            // 修理后须重新检定才能继续用
  const b = addScale(s, { stall: '08 号', vendor: '更换户', certNo: 'C6', verifiedISO: T, stickerAffixed: true });
  recordScaleChange(s, b.id, 'replace', { dateISO: T });
  assert.equal(b.status, 'suspended');
  resumeScale(s, b.id, { verifiedISO: T, certNo: 'C7', stickerAffixed: true });
  assert.equal(b.status, 'active');
  assert.equal(b.certNo, 'C7');
  const c = addScale(s, { stall: '09 号', vendor: '退场户', certNo: 'C8', verifiedISO: T, stickerAffixed: true });
  recordScaleChange(s, c.id, 'remove', { dateISO: T });
  assert.equal(c.status, 'gone');
  assert.throws(() => resumeScale(s, c.id, { verifiedISO: T }), /撤场/);
  assert.throws(() => recordScaleChange(s, 's999', 'add'), /不存在|未知/);
  assert.equal(s.changes.length, 3);
});

/* --------------------------------------------------------- 公平秤日检（第5条(六)） */

test('公平秤日检：未配置=红；当日=ok；昨日=warn；更早=红；经营秤不能当日检', () => {
  const s = fresh();
  assert.equal(fairDailyLevel(s, T).level, 'red'); // 未配置
  const fair = addScale(s, { role: 'fair', stall: '公平秤', certNo: 'C0', verifiedISO: T, stickerAffixed: true });
  assert.equal(fairDailyLevel(s, T).level, 'red'); // 配了但从未核
  logFairCheck(s, { scaleId: fair.id, dateISO: T });
  assert.equal(fairDailyLevel(s, T).level, 'ok');
  const s2 = fresh();
  const f2 = addScale(s2, { role: 'fair', stall: '公平秤', certNo: 'C0', verifiedISO: T, stickerAffixed: true });
  logFairCheck(s2, { scaleId: f2.id, dateISO: addDays(T, -1) });
  assert.equal(fairDailyLevel(s2, T).level, 'warn');
  assert.equal(fairDailyLevel(s2, addDays(T, 1)).level, 'red');
  const trade = addScale(s2, { stall: '10 号', vendor: '商户' });
  assert.throws(() => logFairCheck(s2, { scaleId: trade.id, dateISO: T }), /公平秤不存在/);
});

/* --------------------------------------------------------- 巡查（第5条(七)） */

test('巡查：从未=红；超周期=红点名超期天数；周期尾段=warn；发现项必须写明问题', () => {
  const s = fresh();
  assert.equal(patrolState(s, T, s.settings).level, 'red');
  logPatrol(s, { dateISO: addDays(T, -8), stallsChecked: 10, finds: [] });
  const st = patrolState(s, T, s.settings);
  assert.equal(st.level, 'red');            // 7 天周期已超 1 天
  assert.ok(st.daysOver >= 1);
  const s2 = fresh();
  logPatrol(s2, { dateISO: addDays(T, -2), stallsChecked: 10, finds: [] });
  assert.equal(patrolState(s2, T, s2.settings).level, 'ok');
  const s3 = fresh();
  logPatrol(s3, { dateISO: addDays(T, -5), stallsChecked: 10, finds: [] });
  assert.equal(patrolState(s3, T, s3.settings).level, 'warn');
  assert.throws(() => logPatrol(s3, { dateISO: T, stallsChecked: 3, finds: [{ problem: '' }] }), /写明问题/);
});

/* --------------------------------------------------------- 红黄牌（第7条） */

test('红黄牌：事由必填；摘牌不可重复；activeCards 过滤', () => {
  const s = fresh();
  assert.throws(() => issueCard(s, { stall: '11 号', color: 'yellow', reason: '' }), /事由必填/);
  assert.throws(() => issueCard(s, { stall: '11 号', color: 'gold', reason: 'x' }), /牌色/);
  const c1 = issueCard(s, { stall: '11 号', vendor: '警示户', color: 'yellow', reason: '复核短秤超差', issuedISO: T });
  const c2 = issueCard(s, { stall: '12 号', vendor: '作弊户', color: 'red', reason: '使用作弊秤（第9条(四)）', issuedISO: T });
  assert.equal(activeCards(s).length, 2);
  assert.equal(activeCards(s, 'red').length, 1);
  liftCard(s, c1.id, { liftedISO: T, note: '整改验收' });
  assert.throws(() => liftCard(s, c1.id), /重复摘牌/);
  assert.equal(activeCards(s).length, 1);
  assert.equal(c2.status, 'red');
});

/* --------------------------------------------------------- 投诉与先行赔偿（第12条） */

test('投诉状态机：受理→复核超差（附表1判定+55条测算）→不可重复复核', () => {
  const s = fresh();
  const t = createComplaint(s, {
    dateISO: T, stall: '12 号·水产', vendor: '王水产', commodity: '基围虾', band: 'mid', unitPrice: 96, settleKg: 2,
  });
  assert.equal(t.status, 'received');
  assert.throws(() => createComplaint(s, { stall: '13 号', band: 'zzz' }), /价格档/);
  recheckComplaint(s, t.id, { actualKg: 1.95, method: 'same', recheckedISO: T });
  assert.equal(t.verdict, 'excess');
  assert.equal(t.verify.limitG, 5);
  assert.equal(t.compensation.punitive, 576);
  assert.equal(t.status, 'weighed');
  assert.throws(() => recheckComplaint(s, t.id, { actualKg: 1.95 }), /不可重复复核/);
});

test('投诉处置：超差必须 refund/advance；未超差必须 dismiss；先行赔偿进追偿在途', () => {
  const s = fresh();
  const t1 = createComplaint(s, { stall: '14 号', band: 'mid', unitPrice: 96, settleKg: 2 });
  recheckComplaint(s, t1.id, { actualKg: 1.95, recheckedISO: T });
  assert.throws(() => resolveComplaint(s, t1.id, { mode: 'dismiss', measure: '解释' }), /必须为 refund/);
  assert.throws(() => resolveComplaint(s, t1.id, { mode: 'refund', measure: '' }), /处置措施必填/);
  resolveComplaint(s, t1.id, { mode: 'advance', measure: '经营者撤场，主办者先行赔偿（第12条）', resolvedISO: T });
  assert.equal(t1.status, 'advanced');
  assert.equal(unrecovered(s).length, 1);
  assert.throws(() => resolveComplaint(s, t1.id, { mode: 'refund', measure: 'x' }), /复核/);
  recoverComplaint(s, t1.id, { recoveredISO: T, note: '保证金扣回' });
  assert.equal(t1.status, 'recovered');
  assert.equal(unrecovered(s).length, 0);
  assert.throws(() => recoverComplaint(s, t1.id), /不可重复/);
  assert.throws(() => closeComplaint(s, t1.id), /重复操作/);

  const t2 = createComplaint(s, { stall: '15 号', band: 'low', unitPrice: 3, settleKg: 3 });
  recheckComplaint(s, t2.id, { actualKg: 2.95, recheckedISO: T });
  assert.equal(t2.verdict, 'ok'); // 差 50g ≤ 80g
  assert.throws(() => resolveComplaint(s, t2.id, { mode: 'refund', measure: 'x' }), /dismiss/);
  resolveComplaint(s, t2.id, { mode: 'dismiss', measure: '向消费者演示负偏差标准并解释', resolvedISO: T });
  assert.equal(t2.status, 'dismissed');
  closeComplaint(s, t2.id, { closedISO: T });
  assert.equal(t2.status, 'closed');
  assert.equal(COMPLAINT_STATUS.closed.includes('闭环'), true);
});

test('投诉处置时限：受理超 7 日未处置=超时；先行赔偿期间不计时（另有追偿灯）', () => {
  const s = fresh();
  const t1 = createComplaint(s, { dateISO: addDays(T, -8), stall: '16 号', band: 'mid', settleKg: 1 });
  assert.equal(complaintOverdue(t1, T, s.settings), true);
  const t2 = createComplaint(s, { dateISO: T, stall: '17 号', band: 'mid', settleKg: 1 });
  assert.equal(complaintOverdue(t2, T, s.settings), false);
  const t3 = createComplaint(s, { dateISO: addDays(T, -30), stall: '18 号', band: 'mid', settleKg: 1 });
  recheckComplaint(s, t3.id, { actualKg: 0.9, recheckedISO: addDays(T, -29) });
  resolveComplaint(s, t3.id, { mode: 'advance', measure: '先行赔偿', resolvedISO: addDays(T, -28) });
  assert.equal(complaintOverdue(t3, T, s.settings), false);
});

/* --------------------------------------------------------- 周期义务账 */

test('义务账：从未登记=逾期；完成后按周期滚动；未知类型拒绝；台账五项', () => {
  const s = fresh();
  let d = dutyState({ kind: 'ledgerAudit', lastDoneISO: '' }, T, s.settings);
  assert.equal(d.level, 'expired');
  setDutyDone(s, 'ledgerAudit', addDays(T, -89));
  d = dutyState(s.duties[0], T, s.settings);
  assert.equal(d.dueISO, addDays(T, 1));
  assert.equal(d.level, 'warn');
  assert.throws(() => setDutyDone(s, 'nope', T), /未知义务/);
  assert.equal(dutyBoard(s, T).length, 5);
});

/* --------------------------------------------------------- 体检与月报 */

test('体检：干净台面 100 分；种子坏状态确定性扣分且 <90', () => {
  const s = rig(fresh());
  assert.equal(healthCheck(s, T).score, 100);
  const bad = seedState(T);
  const h1 = healthCheck(bad, T);
  const h2 = healthCheck(bad, T);
  assert.equal(h1.score, h2.score);
  assert.ok(h1.score < 90);
  const keys = h1.lights.map((l) => l.key);
  assert.ok(keys.includes('clock'));    // 超期秤
  assert.ok(keys.includes('ledger'));   // 缺证书号
  assert.ok(keys.includes('patrol'));   // 巡查超周期
  assert.ok(keys.includes('fair'));     // 公平秤昨日核、今日未核
});

test('月度小结：投诉/复核/超差/先行赔偿/追偿分列，无 undefined', () => {
  const s = seedState(T);
  const m = monthlySummary(s, T.slice(0, 7), T);
  assert.equal(m.complaints, 2);
  assert.equal(m.rechecked, 2);
  assert.equal(m.excess, 2);
  assert.equal(m.advancedCount, 1);
  assert.equal(m.recoveredCount, 1);
  assert.ok(m.advancedAmount > 500);
  assert.ok(m.recoveredAmount > 500);
  const txt = monthlyText(s, T.slice(0, 7), T);
  assert.ok(txt.includes('追偿'));
  assert.ok(txt.includes('/100'));
  assert.ok(!txt.includes('undefined'));
});

/* --------------------------------------------------------- 出证三通道 */

test('复秤处置单：负偏差判定、500 元保底、三方法签字栏，无 undefined', () => {
  const s = seedState(T);
  const t = s.complaints.find((x) => x.verdict === 'excess');
  const html = recheckSheetHtml(s, t.id);
  for (const kw of ['复秤处置单', '负偏差', '500', '消费者签字', '计量管理员签字', '总局令第94号']) {
    assert.ok(html.includes(kw), `应包含 ${kw}`);
  }
  assert.ok(!html.includes('undefined'));
});

test('迎检自证包：一秤一档/公平秤/巡查红黄牌/先行赔偿追偿/义务/盖章齐全，无 undefined', () => {
  const s = seedState(T);
  const html = inspectHtml(s, T);
  for (const kw of ['迎检自证包', '登记造册', '公平秤', '红黄牌', '先行赔偿', '周期义务', '盖章', '94号']) {
    assert.ok(html.includes(kw), `应包含 ${kw}`);
  }
  assert.ok(!html.includes('undefined'));
});

/* --------------------------------------------------------- 数据完整性 */

test('导出/导入往返一致；异构文件拒绝', () => {
  const s = seedState(T);
  const back = importBundle(exportBundle(s));
  assert.equal(back.scales.length, s.scales.length);
  assert.equal(back.complaints.length, s.complaints.length);
  assert.equal(back.cards.length, s.cards.length);
  assert.deepEqual(back.org, s.org);
  assert.throws(() => importBundle('{"foo":1}'), /备份文件/);
});

test('示例种子自洽：超期秤点名在案；缺项秤可被体检定位；黄牌在册；追偿闭环不挂账', () => {
  const s = seedState(T);
  // s4 活鱼档 370 天前检定：+12 个月已超期
  const s4 = s.scales.find((x) => x.stall === '31 号·活鱼');
  assert.equal(scaleRed(s4, T, s.settings), true);
  // s3 新换秤缺证书号+缺标志
  const s3 = s.scales.find((x) => x.stall === '27 号·果蔬');
  assert.deepEqual(scaleLedgerGaps(s3).length, 2);
  // 黄牌在册（31 号·活鱼）
  assert.equal(activeCards(s, 'yellow').length, 1);
  assert.equal(activeCards(s, 'yellow')[0].stall, '31 号·活鱼');
  // 先行赔偿已追偿：不挂账
  assert.equal(unrecovered(s).length, 0);
  // 在途投诉 1 件（已复核超差待处置）
  assert.equal(s.complaints.filter((c) => c.status === 'weighed').length, 1);
  // 公平秤在册且昨日已核
  assert.equal(s.fairLogs.length, 2);
});

test('todayISO 输出可回灌；settings 覆盖立即生效', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  const s = fresh();
  const x = addScale(s, { stall: '20 号', vendor: '参数户', verifiedISO: addDays(T, -350), certNo: 'C9', stickerAffixed: true });
  assert.equal(scaleClock(x, T, s.settings).level, 'red');
  s.settings.verifyMonths = 6; // 属地改口径
  assert.equal(scaleClock(x, T, s.settings).level, 'expired');
});
