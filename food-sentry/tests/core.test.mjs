/**
 * core.test.mjs — 食安哨核心逻辑单元测试（node --test，零依赖）
 *
 * 覆盖：日期收敛（跨月/跨年周/闰月）、周一起始周、模板业态适配、
 * 打卡状态与汇总、连续全勤、周报/月报确定性文本、台账文本/HTML 通道、
 * XSS 转义、健康证三档预警、导入导出往返与拒绝。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertISO, todayISO, addDays, daysUntil,
  weekDatesOf, monthDatesOf, rangeDates,
  BUSINESS_TYPES, itemsFor, CHECK_TEMPLATES,
  dayStatus, rangeStats, completionStreak,
  reportText, weekReport, monthReport,
  ledgerText, ledgerHtml, escapeHtml,
  certStatus, staffWarnings, todayAlerts, SOON_WINDOW_DAYS,
  exportBundle, importBundle, STATE_VERSION,
} from '../app/js/core.js';

// ---------------------------------------------------------------------------
// 日期工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非 ISO 格式', () => {
  assert.throws(() => assertISO('2026-9-1'));
  assert.throws(() => assertISO('20260901'));
  assert.throws(() => assertISO(20260901));
  assert.doesNotThrow(() => assertISO('2026-09-01'));
});

test('addDays 跨月收敛', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // 闰年
});

test('daysUntil 负数表示已过期', () => {
  assert.equal(daysUntil('2026-09-10', '2026-09-01'), 9);
  assert.equal(daysUntil('2026-08-31', '2026-09-01'), -1);
});

test('weekDatesOf 以周一为起点且跨年正确', () => {
  const wk = weekDatesOf('2026-09-02'); // 周三
  assert.equal(wk.length, 7);
  assert.equal(wk[0], '2026-08-31');
  assert.equal(wk[6], '2026-09-06');
  // 周日归前一周
  const sun = weekDatesOf('2026-09-06');
  assert.equal(sun[0], '2026-08-31');
  // 元旦跨年：2026-01-01 是周四，所属周从 2025-12-29 开始
  const ny = weekDatesOf('2026-01-01');
  assert.equal(ny[0], '2025-12-29');
  assert.equal(ny[6], '2026-01-04');
});

test('monthDatesOf 闰年二月与平月', () => {
  assert.equal(monthDatesOf(2024, 2).length, 29);
  assert.equal(monthDatesOf(2026, 2).length, 28);
  assert.equal(monthDatesOf(2026, 9).length, 30);
  assert.equal(monthDatesOf(2026, 9)[0], '2026-09-01');
  assert.equal(monthDatesOf(2026, 9)[29], '2026-09-30');
  assert.throws(() => monthDatesOf(2026, 13));
});

test('rangeDates 闭区间含端点、跨月、倒置抛错', () => {
  assert.deepEqual(rangeDates('2026-09-30', '2026-10-02'), ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(rangeDates('2026-09-01', '2026-09-01'), ['2026-09-01']);
  assert.throws(() => rangeDates('2026-09-10', '2026-09-01'));
});

test('todayISO 接受注入时间保证确定性', () => {
  // 用本地时间构造，避免测试自身依赖运行环境的 UTC 偏移
  assert.equal(todayISO(new Date(2026, 8, 5, 12, 0, 0)), '2026-09-05');
  assert.equal(todayISO(new Date(2026, 0, 1, 23, 59, 0)), '2026-01-01');
});

// ---------------------------------------------------------------------------
// 模板与业态
// ---------------------------------------------------------------------------

test('餐馆模板不含留样，食堂模板含留样', () => {
  const r = itemsFor('restaurant');
  const c = itemsFor('canteen');
  assert.ok(!r.some((i) => i.id === 'sample'));
  assert.ok(c.some((i) => i.id === 'sample'));
  assert.equal(r.length, CHECK_TEMPLATES.length - 1);
  assert.equal(c.length, CHECK_TEMPLATES.length);
});

test('未知业态返回空数组', () => {
  assert.deepEqual(itemsFor('unknown'), []);
});

test('自定义检查项追加且 id 冲突抛错', () => {
  const items = itemsFor('restaurant', [{ id: 'x1', name: '油烟净化器清洗' }]);
  assert.equal(items.length, 7);
  assert.equal(items[6].name, '油烟净化器清洗');
  assert.throws(() => itemsFor('restaurant', [{ id: 'morning', name: '重复' }]));
  assert.throws(() => itemsFor('restaurant', [{ id: '', name: '无 id' }]));
});

// ---------------------------------------------------------------------------
// 打卡与汇总
// ---------------------------------------------------------------------------

const ITEMS = itemsFor('restaurant'); // 6 项

function mkChecks(spec) {
  // spec: { date: { itemId: ['ok'|'issue', note?] } }
  const checks = {};
  for (const [d, items] of Object.entries(spec)) {
    checks[d] = {};
    for (const [id, v] of Object.entries(items)) {
      checks[d][id] = { status: v[0], note: v[1] ?? '', at: `${d}T09:00:00.000Z` };
    }
  }
  return checks;
}

test('dayStatus 区分完成/漏检/异常，乱值按未检处理', () => {
  const checks = mkChecks({
    '2026-09-01': { morning: ['ok'], purchase: ['issue', '票据不全，已补'], env: ['weird'] },
  });
  const st = dayStatus('2026-09-01', ITEMS, checks);
  assert.equal(st.total, 6);
  assert.equal(st.done, 2);
  assert.equal(st.missing.length, 4);
  assert.equal(st.issues.length, 1);
  assert.equal(st.issues[0].note, '票据不全，已补');
});

test('rangeStats 汇总完成率与漏检日', () => {
  const checks = mkChecks({
    '2026-09-01': Object.fromEntries(ITEMS.map((i) => [i.id, ['ok']])),
    '2026-09-02': { morning: ['ok'] },
  });
  const stats = rangeStats(['2026-09-01', '2026-09-02', '2026-09-03'], ITEMS, checks);
  assert.equal(stats.total, 18);
  assert.equal(stats.done, 7);
  assert.equal(stats.missingDays.length, 2);
  assert.ok(Math.abs(stats.rate - 7 / 18) < 1e-9);
});

test('completionStreak 连续全勤且今天未打完不打断连胜', () => {
  const dates = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'];
  const full = {};
  for (const d of dates) full[d] = Object.fromEntries(ITEMS.map((i) => [i.id, ['ok']]));
  let checks = mkChecks(full);
  assert.equal(completionStreak(dates, ITEMS, checks, '2026-09-02'), 4);
  // 08-31 漏一项 → 从 09-01 起连胜 2 天
  delete checks['2026-08-31'].morning;
  assert.equal(completionStreak(dates, ITEMS, checks, '2026-09-02'), 2);
  // 今天（09-03）不在账本或未打完 → 不影响既有连胜
  assert.equal(completionStreak(dates, ITEMS, checks, '2026-09-03'), 2);
  // 今天在账本但未打完 → 从昨天起算
  checks['2026-09-03'] = { morning: { status: 'ok', at: '' } };
  assert.equal(completionStreak([...dates, '2026-09-03'], ITEMS, checks, '2026-09-03'), 2);
});

// ---------------------------------------------------------------------------
// 周报 / 月报
// ---------------------------------------------------------------------------

const STORE = { name: '老王家常菜', type: 'restaurant', safetyOfficer: '王建国' };

function weekFixture() {
  // 2026-08-31 ~ 09-06：前三天全勤，第三天一次异常，后四天漏检
  const checks = mkChecks({
    '2026-08-31': Object.fromEntries(ITEMS.map((i) => [i.id, ['ok']])),
    '2026-09-01': Object.fromEntries(ITEMS.map((i) => [i.id, ['ok']])),
    '2026-09-02': { ...Object.fromEntries(ITEMS.map((i) => [i.id, ['ok']])), env: ['issue', '地面油垢，已清理'] },
  });
  return checks;
}

test('weekReport 汇总、异常、漏检与确定性文本', () => {
  const rep = weekReport({ store: STORE, items: ITEMS, checks: weekFixture(), weekOfISO: '2026-09-02', todayISOStr: '2026-09-06' });
  assert.equal(rep.dates[0], '2026-08-31');
  assert.equal(rep.dates[6], '2026-09-06');
  assert.equal(rep.total, 42);
  assert.equal(rep.done, 18);
  assert.equal(rep.issueCount, 1);
  assert.equal(rep.missingDays.length, 4);
  const pct = `${(18 / 42 * 100).toFixed(1)}%`;
  assert.ok(rep.text.includes('每周食品安全排查治理报告'));
  assert.ok(rep.text.includes('老王家常菜'));
  assert.ok(rep.text.includes(pct));
  assert.ok(rep.text.includes('地面油垢，已清理'));
  assert.ok(rep.text.includes('09-03 未完成'));
  assert.ok(rep.text.includes('王建国'));
  assert.ok(rep.text.includes('签字'));
  // 确定性：同输入同输出
  const again = weekReport({ store: STORE, items: ITEMS, checks: weekFixture(), weekOfISO: '2026-09-02', todayISOStr: '2026-09-06' });
  assert.equal(rep.text, again.text);
});

test('monthReport 无异常时输出"无异常记录"', () => {
  const rep = monthReport({ store: STORE, items: ITEMS, checks: {}, year: 2026, month: 9, todayISOStr: '2026-09-06' });
  assert.equal(rep.dates.length, 30);
  assert.equal(rep.done, 0);
  assert.ok(rep.text.includes('每月食品安全调度会议纪要'));
  assert.ok(rep.text.includes('本周期无异常记录'));
});

test('reportText 未设门店时占位且不抛错', () => {
  const text = reportText({
    store: {}, title: '测试报告',
    dates: ['2026-09-01'], stats: { total: 0, done: 0, rate: 1, issueCount: 0, missingDays: [], byDate: [] },
    signRole: '测试签字', todayISOStr: '2026-09-01',
  });
  assert.ok(text.includes('（未设置门店）'));
});

// ---------------------------------------------------------------------------
// 台账导出
// ---------------------------------------------------------------------------

test('ledgerText 输出逐日逐项状态', () => {
  const checks = mkChecks({
    '2026-09-01': { ...Object.fromEntries(ITEMS.map((i) => [i.id, ['ok']])), env: ['issue', '地面油垢，已清理'] },
    '2026-09-02': { morning: ['ok'] },
  });
  const text = ledgerText({ store: STORE, items: ITEMS, checks, startISO: '2026-09-01', endISO: '2026-09-02', todayISOStr: '2026-09-02' });
  assert.ok(text.startsWith('【食品安全台账】老王家常菜'));
  assert.ok(text.includes('■ 2026-09-01（6/6）'));
  assert.ok(text.includes('· 环境卫生·虫害防治：异常（地面油垢，已清理）'));
  assert.ok(text.includes('■ 2026-09-02（1/6）'));
  assert.ok(text.includes('· 进货查验（索证索票·验收）：未检'));
  assert.ok(text.includes('食品安全员（签字）'));
});

test('ledgerHtml 转义注入并标注未检', () => {
  const evilStore = { name: '<script>alert(1)</script>', type: 'restaurant', safetyOfficer: '"><img src=x>' };
  const checks = mkChecks({ '2026-09-01': { morning: ['ok'] } });
  const html = ledgerHtml({ store: evilStore, items: ITEMS, checks, startISO: '2026-09-01', endISO: '2026-09-01', todayISOStr: '2026-09-01' });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(html.split('未检').length - 1, 5); // 6 项中 5 项未检
  assert.ok(html.includes('✓'));
});

test('escapeHtml 覆盖五类字符', () => {
  assert.equal(escapeHtml(`a<b>&"'\``), 'a&lt;b&gt;&amp;&quot;&#39;`');
});

// ---------------------------------------------------------------------------
// 健康证预警
// ---------------------------------------------------------------------------

test('certStatus 三档判定', () => {
  assert.equal(certStatus('2026-08-01', '2026-09-01').level, 'expired');
  assert.equal(certStatus('2026-10-01', '2026-09-01').level, 'due_soon');
  assert.equal(certStatus('2026-10-01', '2026-09-01').days, SOON_WINDOW_DAYS);
  assert.equal(certStatus('2026-12-01', '2026-09-01').level, 'ok');
});

test('staffWarnings 过期在前临期在后，正常不出现', () => {
  const staff = [
    { name: '甲', certExpiry: '2026-10-15' }, // 44 天后 → ok
    { name: '乙', certExpiry: '2026-08-20' }, // 已过期
    { name: '丙', certExpiry: '2026-09-20' }, // 19 天后 → 临期
    { name: '丁', certExpiry: '' },           // 未填 → 不参与
  ];
  const w = staffWarnings(staff, '2026-09-01');
  assert.deepEqual(w.map((s) => s.name), ['乙', '丙']);
  assert.equal(w[0].level, 'expired');
});

test('todayAlerts 聚合漏检/异常/证件', () => {
  const checks = mkChecks({
    '2026-09-01': { morning: ['ok'], purchase: ['issue', '待整改'] },
  });
  const a = todayAlerts({
    dateISO: '2026-09-01', items: ITEMS, checks,
    staff: [{ name: '乙', certExpiry: '2026-08-20' }], todayISOStr: '2026-09-01',
  });
  // 6 项中 morning 正常、purchase 异常均计为已检 → 漏检 4 项
  assert.equal(a.missing.length, 4);
  assert.equal(a.issues.length, 1);
  assert.equal(a.certs.length, 1);
  assert.equal(a.allDone, false);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

function sampleState() {
  return {
    version: STATE_VERSION,
    store: { name: '老王家常菜', type: 'restaurant', safetyOfficer: '王建国', phone: '', address: '' },
    staff: [{ name: '王建国', certExpiry: '2027-01-01' }],
    customItems: [],
    checks: mkChecks({ '2026-09-01': { morning: ['ok'] } }),
    events: [],
  };
}

test('导出→导入往返一致', () => {
  const s = sampleState();
  const bundle = exportBundle(s);
  const res = importBundle(bundle);
  assert.equal(res.ok, true);
  assert.deepEqual(res.state, s);
});

test('导入拒绝：非 JSON / 非本应用 / 高版本 / 结构缺失', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'pethandoff', version: 1, state: {} })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'foodsentry', version: 99, state: sampleState() })).ok, false);
  const bad = sampleState();
  delete bad.checks;
  assert.equal(importBundle(JSON.stringify({ app: 'foodsentry', version: 1, state: bad })).ok, false);
});
