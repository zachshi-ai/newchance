/**
 * tests/core.test.mjs — 船安单 VesselPass 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, ageAt, daysUntil, monthKey, escapeHtml,
  SHIP_DOCS, CREW_ROLES, SELFCHECK_ITEMS, DUTY_KINDS, CHANGE_KINDS, DEFECT_SOURCES,
  RENEW_WINDOW_DAYS, SURVEY_WARN_DAYS, DEFAULT_SURVEY_WARN_DAYS,
  DEFAULT_INSURANCE_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS, STATE_VERSION,
  docState, shipDocBoard,
  addCrew, setCrewActive, activeCrew, crewCertState, crewHealthState, crewAgeState, crewGateState,
  manningCheck,
  selfcheckItemsFor, recordSelfcheck, todaySelfcheck, lastSelfcheck,
  addDefect, fixDefect, closeDefect, openDefects,
  openGate, addVoyage, removeVoyage,
  addChange, fileChange, openChanges,
  setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary, inspectHtml, voyagePassHtml,
  exportBundle, importBundle,
} from '../app/js/core.js';
import { emptyState } from '../app/js/store.js';

const T = '2026-09-09'; // 测试锚定日期（周三），不依赖墙钟

function freshState() {
  return emptyState();
}

/** 一个全绿的可开航状态：四证远期，4 名船员证书齐全，今日自查已落卡 */
function readyState() {
  const s = freshState();
  s.ship = {
    ...s.ship,
    name: '皖顺达 666', nationalNo: '皖XXXXXXX', kind: '干货船', gt: '980',
    minCrew: 3, captain: '陈定波', port: '芜湖', route: '芜湖—南京',
    docs: { survey: '2027-01-01', national: '2028-06-01', manning: '2028-01-01', insurance: '2027-03-01' },
  };
  s.a = addCrew(s, { name: '陈定波', role: 'captain', certNo: 'A001', certValidISO: '2027-06-01', birthISO: '1979-03-12', healthValidISO: '2027-06-01' });
  s.b = addCrew(s, { name: '刘江海', role: 'officer', certValidISO: '2027-06-01', birthISO: '1988-11-02', healthValidISO: '2027-06-01' });
  s.c = addCrew(s, { name: '王轮机', role: 'engineer', certValidISO: '2027-06-01', birthISO: '1985-06-18', healthValidISO: '2027-06-01' });
  s.d = addCrew(s, { name: '赵小满', role: 'sailor', healthValidISO: '2027-06-01' });
  const items = selfcheckItemsFor();
  recordSelfcheck(s, {
    dateISO: T,
    results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])),
  });
  for (const kind of Object.keys(DUTY_KINDS)) {
    setDutyDone(s, kind, '2026-08-26');
  }
  addVoyage(s, { dateISO: T, crewIds: [s.a.id, s.b.id, s.c.id] });
  s.voyages = [];
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

test('addDays 跨月/跨年收敛；ageAt 按生日精确', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(ageAt('1979-03-12', '2026-09-09'), 47);
  assert.equal(ageAt('1979-03-12', '2026-03-11'), 46, '生日前一天仍 46');
  assert.equal(ageAt('1979-03-12', '2026-03-12'), 47, '生日当天满岁');
});

test('daysUntil 与 monthKey 正确；同日为 0 不出现 -0', () => {
  assert.equal(daysUntil('2026-12-31', T), 113);
  assert.equal(daysUntil('2026-09-09', T), 0);
  assert.equal(Object.is(daysUntil('2026-09-09', T), -0), false);
  assert.equal(monthKey('2026-09-09'), '2026-09');
});

test('口径基线：四证/四岗位/五组自查/六类义务/365 天换发窗口', () => {
  assert.deepEqual(Object.keys(SHIP_DOCS).sort(), ['insurance', 'manning', 'national', 'survey']);
  assert.ok(SHIP_DOCS.national.basis.includes('45'), '国籍证书锚登记条例第 45 条换发窗口');
  assert.ok(SHIP_DOCS.insurance.basis.includes('67'), '保险锚内河条例第 67 条');
  assert.deepEqual(Object.keys(CREW_ROLES).sort(), ['captain', 'engineer', 'officer', 'sailor']);
  assert.deepEqual(Object.keys(SELFCHECK_ITEMS).sort(), ['cargo', 'engine', 'hull', 'life', 'nav']);
  assert.deepEqual(Object.keys(DUTY_KINDS).sort(), ['charts', 'drill', 'insurance', 'maintenance', 'reportcheck', 'renewcheck'].sort());
  assert.ok(DUTY_KINDS.maintenance.basis.includes('41'), '维护保养锚安全监督规则第 41 条');
  assert.deepEqual(Object.keys(CHANGE_KINDS).sort(), ['charter', 'name', 'other', 'owner', 'rebuild'].sort());
  assert.deepEqual(Object.keys(DEFECT_SOURCES).sort(), ['company', 'inspection', 'selfcheck'].sort());
  assert.equal(RENEW_WINDOW_DAYS, 365);   // 登记条例第 45 条+配员规则第 17 条：届满前 1 年
  assert.equal(SURVEY_WARN_DAYS, 60);
  assert.equal(DEFAULT_SURVEY_WARN_DAYS, 60);
  assert.equal(DEFAULT_INSURANCE_WARN_DAYS, 30);
  assert.equal(DEFAULT_DUTY_WARN_DAYS, 30);
  assert.equal(STATE_VERSION, 1);
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

// ---------------------------------------------------------------------------
// 四证钟（内河条例第 6 条；登记条例第 16/45 条；配员规则第 17 条）
// ---------------------------------------------------------------------------

test('docState 五态：unset 红 / overdue 红 / window 换发窗口 / warn 临期 / ok', () => {
  const unset = docState({ label: 'x', basis: 'b', validISO: '' }, T);
  assert.equal(unset.level, 'unset');
  const over = docState({ label: 'x', basis: 'b', validISO: '2026-09-01' }, T);
  assert.equal(over.level, 'overdue');
  const win = docState({ label: 'x', basis: 'b', validISO: '2026-12-01' }, T, { warnDays: 0, renewWindowDays: 365 });
  assert.equal(win.level, 'window', '剩 83 天 < 365 换发窗口');
  const warn = docState({ label: 'x', basis: 'b', validISO: '2026-10-01' }, T, { warnDays: 60 });
  assert.equal(warn.level, 'warn');
  const ok = docState({ label: 'x', basis: 'b', validISO: '2027-09-09' }, T, { warnDays: 60 });
  assert.equal(ok.level, 'ok');
});

test('shipDocBoard：国籍/配员证书走换发窗口、检验/保险走临期提醒', () => {
  const s = freshState();
  s.ship.docs = { survey: '2026-11-01', national: '2027-05-01', manning: '2028-01-01', insurance: '2026-12-01' };
  const board = shipDocBoard(s, T);
  assert.equal(board.find((d) => d.key === 'survey').level, 'warn', '剩 53 天 ≤ 60 临期');
  assert.equal(board.find((d) => d.key === 'national').level, 'window', '剩 234 天已进届满前 1 年换发窗口');
  assert.equal(board.find((d) => d.key === 'manning').level, 'ok', '剩 478 天未进窗口');
  assert.equal(board.find((d) => d.key === 'insurance').level, 'ok', '剩 83 天 > 30 临期线');
});

// ---------------------------------------------------------------------------
// 船员名册与证书钟（内河适任规则第 16 条）
// ---------------------------------------------------------------------------

test('addCrew：姓名/岗位必填合法、同姓名同岗位拒绝；setCrewActive 离船/复职', () => {
  const s = freshState();
  assert.throws(() => addCrew(s, { name: '', role: 'captain' }));
  assert.throws(() => addCrew(s, { name: 'x', role: 'pilot' }));
  const a = addCrew(s, { name: '陈定波', role: 'captain', certValidISO: '2027-01-01' });
  assert.throws(() => addCrew(s, { name: '陈定波', role: 'captain' }));
  assert.doesNotThrow(() => addCrew(s, { name: '陈定波', role: 'sailor' }), '同姓名不同岗位可入册');
  setCrewActive(s, a.id, false);
  assert.equal(activeCrew(s).length, 1);
});

test('crewCertState 五态：sailor 不适用（none）；unset 红带第 66 条罚则锚', () => {
  const none = crewCertState({ name: '赵', role: 'sailor' }, T);
  assert.equal(none.level, 'none');
  const unset = crewCertState({ name: '陈', role: 'captain', certValidISO: '' }, T);
  assert.equal(unset.level, 'unset');
  assert.ok(unset.detail.includes('第 66 条'));
  const over = crewCertState({ name: '陈', role: 'captain', certValidISO: '2026-09-01' }, T);
  assert.equal(over.level, 'overdue');
  const warn = crewCertState({ name: '陈', role: 'captain', certValidISO: '2026-11-01' }, T);
  assert.equal(warn.level, 'warn');
  const ok = crewCertState({ name: '陈', role: 'captain', certValidISO: '2027-06-01' }, T);
  assert.equal(ok.level, 'ok');
});

test('crewAgeState：证书有效期跨 65 周岁生日→warn；未登记生日→none', () => {
  const warn = crewAgeState({ name: '陈', role: 'captain', birthISO: '1961-12-01', certValidISO: '2027-06-01' }, T);
  assert.equal(warn.level, 'warn', '有效期截止日 2027-06-01 时已满 65 周岁（1961-12 生）');
  const ok = crewAgeState({ name: '陈', role: 'captain', birthISO: '1979-03-12', certValidISO: '2027-06-01' }, T);
  assert.equal(ok.level, 'none');
  const none = crewAgeState({ name: '陈', role: 'captain', certValidISO: '2027-06-01' }, T);
  assert.equal(none.level, 'none', '未登记生日不判定');
  const sailor = crewAgeState({ name: '赵', role: 'sailor', birthISO: '1961-12-01', certValidISO: '2027-06-01' }, T);
  assert.equal(sailor.level, 'none', '普通船员无适任证书红线');
});

test('crewHealthState：unset/overdue/warn/ok 四态', () => {
  assert.equal(crewHealthState({ name: 'x', healthValidISO: '' }, T).level, 'unset');
  assert.equal(crewHealthState({ name: 'x', healthValidISO: '2026-09-01' }, T).level, 'overdue');
  assert.equal(crewHealthState({ name: 'x', healthValidISO: '2026-11-15' }, T).level, 'warn', '剩 67 天 ≤ 90');
  assert.equal(crewHealthState({ name: 'x', healthValidISO: '2027-06-01' }, T).level, 'ok');
});

test('crewGateState 取适任/年龄/健康的最严', () => {
  const s = freshState();
  const c = addCrew(s, { name: '孙老三', role: 'sailor' });
  assert.equal(crewGateState(c, T).level, 'unset', '水手健康证未登记=unset');
  c.healthValidISO = '2027-06-01';
  assert.equal(crewGateState(c, T).level, 'ok');
});

// ---------------------------------------------------------------------------
// 配员核对引擎（配员规则第 5/7 条；内河条例第 65 条）
// ---------------------------------------------------------------------------

test('manningCheck：未登记核定/人数不足/缺船长/证书过期逐项拦截，达标放行', () => {
  const s = freshState();
  let m = manningCheck(s, [], T);
  assert.equal(m.ok, false);
  assert.ok(m.reasons[0].includes('最低安全配员证书'));

  s.ship.minCrew = 3;
  const a = addCrew(s, { name: '陈', role: 'captain', certValidISO: '2027-01-01', healthValidISO: '2027-01-01' });
  const b = addCrew(s, { name: '刘', role: 'officer', certValidISO: '2027-01-01', healthValidISO: '2027-01-01' });
  const c = addCrew(s, { name: '王', role: 'engineer', certValidISO: '2027-01-01', healthValidISO: '2027-01-01' });

  m = manningCheck(s, [a.id, b.id], T);
  assert.equal(m.ok, false);
  assert.ok(m.reasons.some((r) => r.includes('第 65 条')), '人数不足应带内河条例第 65 条罚则');

  m = manningCheck(s, [b.id, c.id, addCrew(s, { name: '孙', role: 'sailor', healthValidISO: '2027-01-01' }).id], T);
  assert.equal(m.ok, false);
  assert.ok(m.reasons.some((r) => r.includes('船长')), '缺船长拦截');

  const bad = addCrew(s, { name: '过期', role: 'sailor', healthValidISO: '2020-01-01' });
  m = manningCheck(s, [a.id, b.id, c.id, bad.id], T);
  assert.equal(m.ok, false);
  assert.ok(m.reasons.some((r) => r.includes('过期')), '证书过期点名');

  m = manningCheck(s, [a.id, b.id, c.id], T);
  assert.equal(m.ok, true);
  assert.equal(m.onBoard.length, 3);
});

// ---------------------------------------------------------------------------
// 每日开航前自查卡（安全监督规则第 42 条）
// ---------------------------------------------------------------------------

test('selfcheck 五组条目；同日唯一；异常必写处置并自动转缺陷', () => {
  const s = freshState();
  assert.equal(selfcheckItemsFor().length, 5);
  const items = selfcheckItemsFor();
  recordSelfcheck(s, { dateISO: T, results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])) });
  assert.throws(() => recordSelfcheck(s, { dateISO: T, results: {} }), /同日唯一/);
  assert.equal(todaySelfcheck(s, T).status, 'ok');
  assert.equal(lastSelfcheck(s).dateISO, T);

  const s2 = freshState();
  const items2 = selfcheckItemsFor();
  assert.throws(() => recordSelfcheck(s2, {
    dateISO: T,
    results: Object.fromEntries(items2.map((it) => [it.key, it.key === 'engine' ? { ok: false, note: '' } : { ok: true, note: '' }])),
  }), /处置说明/);
  recordSelfcheck(s2, {
    dateISO: T,
    results: Object.fromEntries(items2.map((it) => [it.key, it.key === 'engine' ? { ok: false, note: '停航检修' } : { ok: true, note: '' }])),
  });
  assert.equal(s2.selfchecks[0].status, 'issue');
  assert.equal(s2.defects.length, 1, '异常自动转缺陷');
  assert.ok(s2.defects[0].desc.includes('主机与机电'));
});

// ---------------------------------------------------------------------------
// 缺陷闭环状态机（open → fixed → closed）
// ---------------------------------------------------------------------------

test('缺陷三态与跳级拒绝', () => {
  const s = freshState();
  const df = addDefect(s, { dateISO: T, source: 'inspection', desc: '救生圈浮灯失效' });
  assert.throws(() => closeDefect(s, df.id, { verifyISO: T, verifiedBy: '船长' }), /先登记整改/);
  assert.throws(() => fixDefect(s, df.id, { actionISO: '2026-09-08', action: 'x' }), /早于发现日/);
  fixDefect(s, df.id, { actionISO: T, action: '更换浮灯并全船点验' });
  assert.throws(() => fixDefect(s, df.id, { actionISO: T, action: '重复' }), /只有未整改/);
  closeDefect(s, df.id, { verifyISO: T, verifiedBy: '船长' });
  assert.equal(openDefects(s).length, 0);
  assert.throws(() => addDefect(s, { dateISO: T, desc: '' }), /描述必填/);
  assert.throws(() => addDefect(s, { dateISO: T, source: 'police', desc: 'x' }));
});

// ---------------------------------------------------------------------------
// 开航五道闸与开航单（产品的门禁）
// ---------------------------------------------------------------------------

test('openGate 五道闸逐道拦截：证书/保险/配员/自查/缺陷', () => {
  const s = freshState();
  // 闸1：四证未登记
  let g = openGate(s, { dateISO: T, crewIds: [] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('未登记')), JSON.stringify(g.reasons));
  assert.equal(g.gates.length, 5, '五道闸');

  // 全绿底座（检验证书临期但未过期→不拦）
  s.ship.minCrew = 3;
  s.ship.docs = { survey: '2026-10-01', national: '2027-06-01', manning: '2028-01-01', insurance: '2027-03-01' };
  const a = addCrew(s, { name: '陈', role: 'captain', certValidISO: '2027-01-01', healthValidISO: '2027-01-01' });
  const b = addCrew(s, { name: '刘', role: 'officer', certValidISO: '2027-01-01', healthValidISO: '2027-01-01' });
  const c = addCrew(s, { name: '王', role: 'engineer', certValidISO: '2027-01-01', healthValidISO: '2027-01-01' });
  const bad = addCrew(s, { name: '孙', role: 'sailor', healthValidISO: '', certValidISO: '' });

  // 闸1：检验证书过期
  s.ship.docs.survey = '2026-09-01';
  g = openGate(s, { dateISO: T, crewIds: [a.id, b.id, c.id] });
  assert.ok(g.reasons.some((r) => r.includes('检验证书')), JSON.stringify(g.reasons));
  s.ship.docs.survey = '2027-01-01';

  // 闸2：保险过期
  s.ship.docs.insurance = '2026-09-01';
  g = openGate(s, { dateISO: T, crewIds: [a.id, b.id, c.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('保险')), JSON.stringify(g.reasons));
  s.ship.docs.insurance = '2027-03-01';

  // 闸3：配员不足（2 人 < 3）
  g = openGate(s, { dateISO: T, crewIds: [a.id, b.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('第 65 条')), JSON.stringify(g.reasons));

  // 闸3：点名含健康证未登记船员（unset 拦）
  g = openGate(s, { dateISO: T, crewIds: [a.id, b.id, bad.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('孙')), JSON.stringify(g.reasons));

  // 闸4：自查未落
  g = openGate(s, { dateISO: T, crewIds: [a.id, b.id, c.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('自查')), JSON.stringify(g.reasons));

  // 落自查（全正常）
  const items = selfcheckItemsFor();
  recordSelfcheck(s, { dateISO: T, results: Object.fromEntries(items.map((it) => [it.key, { ok: true, note: '' }])) });
  g = openGate(s, { dateISO: T, crewIds: [a.id, b.id, c.id] });
  assert.equal(g.ok, true, JSON.stringify(g.reasons));
  assert.equal(g.gates.filter((x) => x.ok).length, 5);

  // 闸5：缺陷拦截
  const df = addDefect(s, { dateISO: T, source: 'inspection', desc: 'AIS 静态信息船名错误' });
  g = openGate(s, { dateISO: T, crewIds: [a.id, b.id, c.id] });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some((r) => r.includes('AIS')));
  fixDefect(s, df.id, { actionISO: T, action: '更正 AIS 静态信息' });
  closeDefect(s, df.id, { verifyISO: T, verifiedBy: '船长' });
  assert.equal(openGate(s, { dateISO: T, crewIds: [a.id, b.id, c.id] }).ok, true);
});

test('addVoyage：同日唯一、落账存当次快照；removeVoyage 自救', () => {
  const s = readyState();
  const vg = addVoyage(s, { dateISO: T, crewIds: [s.a.id, s.b.id, s.c.id] });
  assert.equal(vg.snapshot.onBoard, 3);
  assert.equal(vg.snapshot.minCrew, 3);
  assert.equal(vg.snapshot.docs.national, '2028-06-01');
  assert.ok(vg.snapshot.crewCerts['陈定波'].cert);
  assert.throws(() => addVoyage(s, { dateISO: T, crewIds: [s.a.id, s.b.id, s.c.id] }), /同日唯一/);
  removeVoyage(s, vg.id);
  assert.equal(s.voyages.length, 0);
  assert.throws(() => removeVoyage(s, 'vg-99'), /不存在/);
});

// ---------------------------------------------------------------------------
// 变更登记 / 周期义务
// ---------------------------------------------------------------------------

test('变更登记：登记→办结；未办结列表；日期校验', () => {
  const s = freshState();
  assert.throws(() => addChange(s, { dateISO: T, kind: 'paint', detail: 'x' }));
  const cg = addChange(s, { dateISO: T, kind: 'owner', detail: '经营人变更' });
  assert.equal(openChanges(s).length, 1);
  assert.throws(() => fileChange(s, cg.id, '2026-09-08'), /早于变更发生日/);
  fileChange(s, cg.id, T);
  assert.equal(openChanges(s).length, 0);
});

test('周期义务：打勾滚动；dutyBoard 未登记以 never 入板且红灯在前', () => {
  const s = freshState();
  setDutyDone(s, 'maintenance', '2026-08-15');
  assert.equal(dutyState({ kind: 'maintenance', lastDoneISO: '2026-08-15' }, T).level, 'due', '剩 5 天（≤7 临期线）');
  assert.equal(dutyState({ kind: 'maintenance', lastDoneISO: '2026-08-25' }, T).level, 'ok', '剩 16 天 > 7 天临期线，30 天周期义务刚完成不应立即黄');
  assert.equal(dutyState({ kind: 'maintenance', lastDoneISO: '2026-07-01' }, T).level, 'overdue');
  const board = dutyBoard(s, T);
  assert.equal(board.length, Object.keys(DUTY_KINDS).length);
  assert.equal(board[0].level, 'never', '未登记义务排最前');
  assert.throws(() => setDutyDone(s, 'paint', T));
});

// ---------------------------------------------------------------------------
// 体检 / 月报 / 出证
// ---------------------------------------------------------------------------

test('healthCheck 十项：全绿底座应高分；缺口逐项点名', () => {
  const s = readyState();
  const hc = healthCheck(s, T);
  assert.equal(hc.items.length, 10);
  assert.ok(hc.score >= 85, `全绿底座得分应高（仅今日开航单一项黄）：${hc.score}`);
  // 制造缺口：适任证书过期 → 船员红灯（-12）+ 配员核对偏紧黄灯（-4）
  s.b.certValidISO = '2026-09-01';
  const hc2 = healthCheck(s, T);
  assert.equal(hc2.score, hc.score - 16);
  const crewItem = hc2.items.find((i) => i.key === 'crew');
  assert.equal(crewItem.level, 'bad');
  assert.ok(crewItem.detail.includes('刘江海'));
});

test('monthlySummary：拦截计数、点名段、法条尾注含 27 号令修正口径', () => {
  const s = readyState();
  addVoyage(s, { dateISO: T, crewIds: [s.a.id, s.b.id, s.c.id] });
  s.traces.push({ type: 'voyage-blocked', at: `${T}T01:00:00.000Z`, dateISO: T, reasons: 'x' });
  const sum = monthlySummary(s, '2026-09', T);
  assert.equal(sum.voyages, 1);
  assert.equal(sum.blocked, 1);
  assert.ok(sum.text.includes('开航单 1 张'));
  assert.ok(sum.text.includes('拦截不合规开航 1 次'));
  assert.ok(sum.text.includes('2022 年第 27 号令修正'));
  assert.ok(sum.text.includes('内河交通安全管理条例'));
  assert.ok(sum.text.includes('开航前自查 1 次'));
  assert.throws(() => monthlySummary(s, '2026-9', T));
});

test('inspectHtml：八段结构与脱敏底线', () => {
  const s = readyState();
  const html = inspectHtml(s, T);
  for (const k of ['迎检自证包', '四证一览', '船员名册', '开航记录', '开航前自查', '缺陷整改闭环', '变更登记台账', '周期义务账']) {
    assert.ok(html.includes(k), `应含「${k}」段`);
  }
  assert.ok(html.includes('安全监督规则第 42 条'));
});

test('voyagePassHtml：含五道闸核对与在船船员证书快照', () => {
  const s = readyState();
  const vg = addVoyage(s, { dateISO: T, crewIds: [s.a.id, s.b.id, s.c.id] });
  const html = voyagePassHtml(s, vg.id, T);
  assert.ok(html.includes('五道闸'));
  assert.ok(html.includes('陈定波'));
  assert.ok(html.includes('2027-06-01'));
  assert.throws(() => voyagePassHtml(s, 'vg-404', T));
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle：错名拒绝、缺结构拒绝、合法全量接受', () => {
  const s = readyState();
  const bundle = exportBundle(s);
  const parsed = JSON.parse(bundle);
  assert.equal(parsed.app, 'vesselpass');
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle(JSON.stringify({ ...parsed, app: 'venuepass' })).ok, false);
  assert.equal(importBundle(JSON.stringify({ ...parsed, version: 99 })).ok, false);
  assert.equal(importBundle(JSON.stringify({ ...parsed, state: { ...parsed.state, crew: 'x' } })).ok, false);
  const res = importBundle(bundle);
  assert.equal(res.ok, true);
  assert.equal(res.state.crew.length, s.crew.length);
});
