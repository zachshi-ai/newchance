/**
 * tests/core.test.mjs — 来路单 SourceLog 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, escapeHtml,
  fmtYuan, fmtKg, fmtUnitPrice, maskIdNo,
  ITEM_CATS, REFUSE_REASONS,
  refPriceOf, isLowPrice, addSeller, removeSeller,
  addBuy, removeBuy, addRefuse, removeRefuse, addOut, removeOut,
  freqSellers, idGaps, lowPriceBuys, healthCheck, monthlyReport,
  registerHtml, sourceText, sourceHtml, outStatementText,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期（周六），不依赖墙钟

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-5'));
  assert.throws(() => assertISO('20260905'));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
});

test('addDays 跨月/跨年收敛', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('daysUntil 与 monthKey 正确', () => {
  assert.equal(daysUntil('2026-12-31', T), 117);
  assert.equal(daysUntil('2026-09-04', T), -1);
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('fmtYuan 只吃整数分；fmtKg/fmtUnitPrice 量纲正确；maskIdNo 脱敏', () => {
  assert.equal(fmtYuan(235000), '¥2350.00');
  assert.throws(() => fmtYuan(12.5));
  assert.equal(fmtKg(320), '320 kg');
  assert.equal(fmtKg(12.35), '12.3 kg');
  assert.equal(fmtKg(null), '—');
  assert.throws(() => fmtKg(-5));
  assert.equal(fmtUnitPrice(235000, 320), '¥7.34/kg'); // 2350 元 / 320kg = 7.34375
  assert.throws(() => fmtUnitPrice(100, 0));
  assert.equal(maskIdNo('330106199001011234'), '330***********1234');
  assert.equal(maskIdNo(''), '（未录）');
});

test('escapeHtml 转义五类字符', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

// ---------------------------------------------------------------------------
// 品类与参考价
// ---------------------------------------------------------------------------

test('品类模板：生产性/公用金属必须查证明；高价值品类需实名；参考价可覆盖可关闭', () => {
  assert.equal(ITEM_CATS.cable.needProof, true);
  assert.equal(ITEM_CATS.infra.needProof, true);
  assert.equal(ITEM_CATS.build.needProof, true);
  assert.equal(ITEM_CATS.copper.needId, true);
  assert.equal(ITEM_CATS.paper.needId, false);
  assert.equal(refPriceOf('copper', {}), 60);
  assert.equal(refPriceOf('copper', { refPrices: { copper: 70 } }), 70);
  assert.equal(refPriceOf('copper', { refPrices: { copper: null } }), null); // 显式关闭
  assert.equal(refPriceOf('copper', { refPrices: { copper: 0 } }), 60); // 非法覆盖回退默认
  assert.throws(() => refPriceOf('uranium', {}), /品类非法/);
});

// ---------------------------------------------------------------------------
// 出售人底档
// ---------------------------------------------------------------------------

function mkState() {
  return {
    station: { name: '顺发废品站', phone: '13800001234', lic: '', filedNo: '' },
    sellers: [],
    buys: [],
    refuses: [],
    outs: [],
    settings: { lowRatio: 50 },
    events: [],
  };
}

test('addSeller：姓名必填；removeSeller：有收购记录的不可删', () => {
  const s = mkState();
  assert.throws(() => addSeller(s, { id: 's1', name: '  ' }), /姓名/);
  addSeller(s, { id: 's1', name: '张老三', idNo: '330106199001011234', phone: '13911112222' });
  assert.equal(s.sellers.length, 1);
  addBuy(s, { id: 'b1', dateISO: '2026-09-01', sellerId: 's1', cat: 'iron', weightKg: 100, priceCents: 22000, todayISOStr: T });
  assert.throws(() => removeSeller(s, 's1'), /不可删除/);
  assert.throws(() => removeSeller(s, 's9'), /不存在/);
});

// ---------------------------------------------------------------------------
// 收购落账守门
// ---------------------------------------------------------------------------

function baseBuy(over = {}) {
  return { id: 'b1', dateISO: '2026-09-01', sellerId: 's1', cat: 'iron', desc: '', weightKg: 100, priceCents: 22000, todayISOStr: T, ...over };
}

test('addBuy 守门：未知出售人/未来日期/非法品类/坏重量坏金额全部拒绝', () => {
  const s = mkState();
  addSeller(s, { id: 's1', name: '张老三', idNo: '330106199001011234' });
  assert.throws(() => addBuy(s, baseBuy({ sellerId: 's9' })), /出售人不存在/);
  assert.throws(() => addBuy(s, baseBuy({ dateISO: '2026-09-06' })), /未来/);
  assert.throws(() => addBuy(s, baseBuy({ cat: 'uranium' })), /品类非法/);
  assert.throws(() => addBuy(s, baseBuy({ weightKg: 0 })), /重量/);
  assert.throws(() => addBuy(s, baseBuy({ priceCents: -1 })), /金额/);
  assert.equal(s.buys.length, 0);
});

test('addBuy 守门：生产性/公用金属无单位证明拒绝成交（该走拒收登记）', () => {
  const s = mkState();
  addSeller(s, { id: 's1', name: '张老三', idNo: '330106199001011234' });
  for (const cat of ['cable', 'infra', 'build']) {
    assert.throws(() => addBuy(s, baseBuy({ cat, proofNote: '' })), /拒收登记/);
  }
  assert.doesNotThrow(() => addBuy(s, baseBuy({ cat: 'cable', desc: '工程退下来的旧电缆', priceCents: 260000, proofNote: '宏远建设工程有限公司退库单' })));
  assert.equal(s.buys.length, 1);
});

test('addBuy 守门：需实名品类缺证件号拒绝——实名缺口在落账前被拦下', () => {
  const s = mkState();
  addSeller(s, { id: 's1', name: '无证人' });
  assert.throws(() => addBuy(s, baseBuy({ cat: 'copper' })), /实名登记/);
  assert.doesNotThrow(() => addBuy(s, baseBuy({ cat: 'paper', weightKg: null, priceCents: 9000 }))); // 生活源废品不强制
});

test('addBuy 守门：明显低价必须写明原因——「白菜价」收购是推定明知的情形', () => {
  const s = mkState();
  addSeller(s, { id: 's1', name: '张老三', idNo: '330106199001011234' });
  // 铜参考价 60 元/kg，50% 阈值 = 30 元/kg；2300kg 报 46000 分（¥460）→ 2 元/kg，明显低价
  assert.throws(() => addBuy(s, baseBuy({ cat: 'copper', weightKg: 2300, priceCents: 46000 })), /明显低于参考价/);
  assert.doesNotThrow(() => addBuy(s, baseBuy({ cat: 'copper', weightKg: 2300, priceCents: 46000, lowNote: '含电机壳折重，实际含铜率低' })));
  // 正常价不触发
  assert.doesNotThrow(() => addBuy(s, baseBuy({ id: 'b2', cat: 'copper', weightKg: 100, priceCents: 610000 })));
});

test('isLowPrice 边界与参考价关闭：改参数，历史标注自动跟变（derived 不落库）', () => {
  const entry = { cat: 'copper', weightKg: 100, priceCents: 299000 }; // 29.9 元/kg
  assert.equal(isLowPrice(entry, {}), true); // 低于 30
  assert.equal(isLowPrice({ ...entry, priceCents: 300000 }, {}), false); // 恰在阈值不算
  assert.equal(isLowPrice(entry, { refPrices: { copper: null } }), false); // 关闭提示
  assert.equal(isLowPrice({ ...entry, weightKg: null }, {}), false); // 无重量不判
});

test('removeBuy / removeRefuse / removeOut：误录可删，未知 id 拒绝', () => {
  const s = mkState();
  addSeller(s, { id: 's1', name: '张老三', idNo: '330106199001011234' });
  addBuy(s, baseBuy());
  removeBuy(s, 'b1');
  assert.equal(s.buys.length, 0);
  assert.throws(() => removeBuy(s, 'b1'), /不存在/);
});

// ---------------------------------------------------------------------------
// 拒收登记
// ---------------------------------------------------------------------------

test('addRefuse 守门：日期/姓名/物品情况/原因全部必填；未来日期拒绝', () => {
  const s = mkState();
  const base = { id: 'r1', dateISO: '2026-09-02', sellerName: '不明人员', cat: 'infra', desc: '两个铸铁井盖，来源说不清', reason: 'noProof', todayISOStr: T };
  assert.throws(() => addRefuse(s, { ...base, sellerName: '' }), /出售人/);
  assert.throws(() => addRefuse(s, { ...base, desc: '' }), /物品情况/);
  assert.throws(() => addRefuse(s, { ...base, reason: 'bad' }), /拒收原因非法/);
  assert.throws(() => addRefuse(s, { ...base, dateISO: '2026-09-06' }), /未来/);
  addRefuse(s, base);
  assert.equal(s.refuses.length, 1);
  removeRefuse(s, 'r1');
  assert.equal(s.refuses.length, 0);
});

// ---------------------------------------------------------------------------
// 出货台账
// ---------------------------------------------------------------------------

test('addOut 守门：去向必填、品类/重量/金额校验', () => {
  const s = mkState();
  assert.throws(() => addOut(s, { id: 'o1', dateISO: '2026-09-03', buyer: '', cat: 'copper', weightKg: 500, priceCents: 30000000, todayISOStr: T }), /去向/);
  assert.throws(() => addOut(s, { id: 'o1', dateISO: '2026-09-03', buyer: '金桥打包站', cat: 'bad', weightKg: 500, priceCents: 1, todayISOStr: T }), /品类非法/);
  addOut(s, { id: 'o1', dateISO: '2026-09-03', buyer: '金桥打包站', cat: 'copper', weightKg: 500, priceCents: 30000000, todayISOStr: T });
  assert.equal(s.outs.length, 1);
  removeOut(s, 'o1');
  assert.equal(s.outs.length, 0);
});

// ---------------------------------------------------------------------------
// 点名与体检
// ---------------------------------------------------------------------------

test('freqSellers：同一人 30 日内高危品类 ≥3 次点名，窗口边界与品类口径正确', () => {
  const s = mkState();
  addSeller(s, { id: 's1', name: '赵某', idNo: '330106199001010011' });
  addSeller(s, { id: 's2', name: '钱某', idNo: '330106199001010022' });
  const buy = (id, sellerId, cat, daysAgo) => addBuy(s, {
    id, dateISO: addDays(T, -daysAgo), sellerId, cat, weightKg: 10, priceCents: 90000, todayISOStr: T,
  });
  buy('b1', 's1', 'copper', 29); // 窗口内
  buy('b2', 's1', 'copper', 20);
  buy('b3', 's1', 'copper', 1);
  buy('b4', 's2', 'copper', 40); // 超窗不计
  buy('b5', 's2', 'paper', 2);   // 非高危品类不计
  // b6：20 元/kg < 铜参考价 60 的 50% 阈值（30 元/kg）→ 低价守门拦截
  assert.throws(() => addBuy(s, {
    id: 'b6', dateISO: T, sellerId: 's1', cat: 'copper', weightKg: 10, priceCents: 20000, todayISOStr: T,
  }), /明显低于参考价/);
  const rows = freqSellers(s, { todayISOStr: T });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sellerId, 's1');
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].lastISO, '2026-09-04'); // daysAgo=1 → T-1
});

test('idGaps 与 healthCheck：实名缺口、低价清单、孤儿数据一次点名', () => {
  const s = mkState();
  addSeller(s, { id: 's1', name: '有证人', idNo: '330106199001010011' });
  addSeller(s, { id: 's2', name: '无证人' });
  addBuy(s, { id: 'b1', dateISO: '2026-09-01', sellerId: 's1', cat: 'copper', weightKg: 100, priceCents: 610000, todayISOStr: T });
  assert.throws(() => addBuy(s, { id: 'b2', dateISO: '2026-09-02', sellerId: 's2', cat: 'copper', weightKg: 100, priceCents: 610000, todayISOStr: T }), /实名登记/);
  // 模拟历史数据/属地回落：绕过 addBuy 直接写流水（登记册要如实呈现缺口）
  s.buys.push({ id: 'b3', dateISO: '2026-09-03', sellerId: 's2', cat: 'battery', desc: '', weightKg: 20, priceCents: 30000, proofNote: '', lowNote: '', createdAt: 'x' });
  const h = healthCheck(s, T);
  assert.equal(h.idGaps.length, 1);
  assert.equal(h.idGaps[0].buy.id, 'b3');
  assert.equal(h.freq.length, 0);
  assert.equal(h.orphans, 0);
});

test('monthlyReport：月度总差额口径、跨月隔离、拒收计数', () => {
  const s = mkState();
  addSeller(s, { id: 's1', name: '张老三', idNo: '330106199001011234' });
  addBuy(s, { id: 'b1', dateISO: '2026-09-01', sellerId: 's1', cat: 'iron', weightKg: 1000, priceCents: 2200000, todayISOStr: T });
  addBuy(s, { id: 'b2', dateISO: '2026-08-31', sellerId: 's1', cat: 'iron', weightKg: 500, priceCents: 1100000, todayISOStr: T });
  addOut(s, { id: 'o1', dateISO: '2026-09-03', buyer: '金桥打包站', cat: 'iron', weightKg: 900, priceCents: 2700000, todayISOStr: T });
  addRefuse(s, { id: 'r1', dateISO: '2026-09-02', sellerName: '不明人员', cat: 'infra', desc: '井盖', reason: 'noProof', todayISOStr: T });
  const rep = monthlyReport(s, '2026-09');
  assert.equal(rep.buys, 1);
  assert.equal(rep.buyCents, 2200000);
  assert.equal(rep.outCents, 2700000);
  assert.equal(rep.marginCents, 500000);
  assert.equal(rep.refuses, 1);
  assert.throws(() => monthlyReport(s, '2026-9'), /非法月份/);
});

// ---------------------------------------------------------------------------
// 单据
// ---------------------------------------------------------------------------

function demoState() {
  const s = mkState();
  addSeller(s, { id: 's1', name: '张老三', idNo: '330106199001011234', phone: '13911112222' });
  addBuy(s, {
    id: 'b1', dateISO: '2026-09-01', sellerId: 's1', cat: 'cable',
    desc: '工程退下的旧电缆', weightKg: 200, priceCents: 250000,
    proofNote: '宏远建设退库单（2026-087）', lowNote: '含绝缘皮折重', todayISOStr: T,
  });
  addBuy(s, { id: 'b2', dateISO: '2026-09-02', sellerId: 's1', cat: 'paper', weightKg: null, priceCents: 9000, todayISOStr: T });
  addRefuse(s, { id: 'r1', dateISO: '2026-09-02', sellerName: '不明人员', cat: 'infra', desc: '铸铁井盖两个，来源说不清', reason: 'noProof', todayISOStr: T });
  addOut(s, { id: 'o1', dateISO: '2026-09-03', buyer: '金桥打包站', cat: 'cable', weightKg: 200, priceCents: 620000, todayISOStr: T });
  return s;
}

test('registerHtml：登记册含第八条口径、证明查验列、拒收节、签字栏与转义', () => {
  const s = demoState();
  s.station = { name: '<script>x</script>废品站', phone: '', lic: '', filedNo: '' };
  const html = registerHtml({ state: s, month: '2026-09', todayISOStr: T });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('收购登记册 · 2026-09'));
  assert.ok(html.includes('第八条'));
  assert.ok(html.includes('保存期限不少于两年'));
  assert.ok(html.includes('✅ 已查证明：宏远建设退库单（2026-087）'));
  assert.ok(html.includes('低于参考价·已注明'));
  assert.ok(html.includes('铸铁井盖两个'));
  assert.ok(html.includes('拒收登记（1 笔）'));
  assert.ok(html.includes('站点负责人（签字/盖章）'));
  assert.ok(!html.includes('<script>x</script>废品站'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.throws(() => registerHtml({ state: s, month: '2026-9', todayISOStr: T }), /非法月份/);
});

test('sourceText：同输入同输出，实名/证明/低价原因如实呈现', () => {
  const s = demoState();
  const text = sourceText({ state: s, buyId: 'b1', todayISOStr: T });
  assert.ok(text.includes('【收购来源说明】2026-09-01'));
  assert.ok(text.includes('站点：顺发废品站（13800001234）'));
  assert.ok(text.includes('证件号 330106199001011234'));
  assert.ok(text.includes('已查验并登记（宏远建设退库单（2026-087））'));
  assert.ok(text.includes('含绝缘皮折重'));
  assert.equal(text, sourceText({ state: s, buyId: 'b1', todayISOStr: T }));
  assert.throws(() => sourceText({ state: s, buyId: 'b9', todayISOStr: T }), /不存在/);
});

test('sourceHtml：出售人签字栏 + 证件号全文（供公安查验）+ 转义', () => {
  const s = demoState();
  s.sellers[0].name = '<img src=x onerror=alert(1)>';
  const html = sourceHtml({ state: s, buyId: 'b1', todayISOStr: T });
  assert.ok(html.includes('出售人（确认以上信息属实，签字）'));
  assert.ok(html.includes('单位证明'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
  assert.throws(() => sourceHtml({ state: s, buyId: 'b9', todayISOStr: T }), /不存在/);
});

test('outStatementText：按打包站分组合计、逐笔明细、跨月拒绝', () => {
  const s = demoState();
  addOut(s, { id: 'o2', dateISO: '2026-09-04', buyer: '金桥打包站', cat: 'paper', weightKg: null, priceCents: 12000, todayISOStr: T });
  const text = outStatementText({ state: s, month: '2026-09', todayISOStr: T });
  assert.ok(text.includes('【出货对账单】2026-09'));
  assert.ok(text.includes('· 金桥打包站：2 笔 · 合计 ¥6320.00'));
  assert.ok(text.includes('2026-09-03 废电缆电线 200 kg ¥6200.00'));
  assert.ok(text.includes('合计：2 笔 · ¥6320.00'));
  assert.throws(() => outStatementText({ state: s, month: '2026-08', todayISOStr: T }), /没有出货记录/);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle 确定性结构；importBundle 往返一致、非本应用与坏结构整体拒绝', () => {
  const s = demoState();
  const bundle = exportBundle(s);
  const parsed = JSON.parse(bundle);
  assert.equal(parsed.app, 'sourcelog');
  assert.equal(parsed.version, STATE_VERSION);
  const ok = importBundle(bundle);
  assert.equal(ok.ok, true);
  assert.equal(ok.state.buys.length, 2);
  assert.equal(importBundle('{oops').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'carsheet', version: 1, state: s })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'sourcelog', version: 99, state: s })).ok, false, '高版本拒绝');
  assert.equal(
    importBundle(JSON.stringify({ app: 'sourcelog', version: 1, state: { station: {}, sellers: [] } })).ok,
    false,
    '缺 buys/refuses/outs/settings 的坏结构整体拒绝',
  );
});
