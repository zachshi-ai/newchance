/**
 * core.test.mjs — 场记单 SceneLog 纯逻辑层单元测试
 * 运行：npm test（node --test）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, escapeHtml,
  dayTypeOf, minorsAllowedOn,
  venueFilingClock, filingClock, markScriptChanged,
  sessionViolations, removeSession,
  monthlyCheckStatus, drillStatus, trainingStatus, expiryClock, extinguisherBoard,
  openIssue, closeIssue,
  setupBoard, healthCheck,
  monthlySummaryText, inspectionPackHtml, patrolCardHtml,
  exportBundle, importBundle,
  DEFAULT_LIMITS, HOLIDAYS_2026, AGE_RANGES,
} from '../app/js/core.js';

const L = DEFAULT_LIMITS;
const CAL = {
  year: 2026,
  holidays: [...HOLIDAYS_2026.holidays],
  workdays: [...HOLIDAYS_2026.workdays],
  vacWinter: ['2026-01-15', '2026-02-28'],
  vacSummer: ['2026-07-01', '2026-08-31'],
};

test('日期工具：非法日期拒绝、addDays/daysUntil 对称', () => {
  assert.throws(() => assertISO('2026-2-1'));
  assert.throws(() => assertISO('not-a-date'));
  assert.equal(addDays('2026-09-07', 30), '2026-10-07');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysUntil('2026-09-07', '2026-09-07'), 0);
  assert.equal(daysUntil('2026-09-01', '2026-09-07'), -6);
});

test('todayISO 注入确定性', () => {
  const noon = new Date('2026-09-07T12:00:00+08:00');
  assert.equal(todayISO(noon), '2026-09-07');
});

test('假日引擎：2026 官方安排的五种日型', () => {
  assert.equal(dayTypeOf('2026-01-02', CAL), 'holiday');   // 元旦连休
  assert.equal(dayTypeOf('2026-02-16', CAL), 'holiday');   // 春节（周一但放假）
  assert.equal(dayTypeOf('2026-02-14', CAL), 'comp');      // 春节前补班的周六
  assert.equal(dayTypeOf('2026-02-28', CAL), 'comp');      // 春节后补班的周六
  assert.equal(dayTypeOf('2026-09-20', CAL), 'comp');      // 国庆前补班的周日
  assert.equal(dayTypeOf('2026-07-10', CAL), 'vacation');  // 暑假
  assert.equal(dayTypeOf('2026-02-01', CAL), 'vacation');  // 寒假（连周六也是寒假）
  assert.equal(dayTypeOf('2026-09-12', CAL), 'rest');      // 普通周六
  assert.equal(dayTypeOf('2026-09-07', CAL), 'work');      // 普通周一
  assert.equal(dayTypeOf('2026-10-02', CAL), 'holiday');   // 国庆（周五）
});

test('时段红线：允许=法定节假日/寒暑假/休息日；补班日一律不允许', () => {
  assert.equal(minorsAllowedOn('2026-10-02', CAL), true);
  assert.equal(minorsAllowedOn('2026-07-10', CAL), true);
  assert.equal(minorsAllowedOn('2026-09-12', CAL), true);
  assert.equal(minorsAllowedOn('2026-09-07', CAL), false);
  assert.equal(minorsAllowedOn('2026-02-14', CAL), false); // 最容易踩的补班周六
  assert.equal(minorsAllowedOn('2026-10-10', CAL), false);
});

test('假日表缺失整体拒绝（防脏状态）', () => {
  assert.throws(() => dayTypeOf('2026-09-07', null));
  assert.throws(() => dayTypeOf('2026-09-07', {}));
});

test('场所首报钟：营业日起 30 自然日三色', () => {
  const c1 = venueFilingClock('2026-08-01', '2026-08-20', '2026-09-07', L);
  assert.equal(c1.level, 'ok');
  const c2 = venueFilingClock('2026-08-20', '', '2026-09-14', L); // 到期 09-19，剩 5 天
  assert.equal(c2.level, 'warn');
  const c3 = venueFilingClock('2026-08-01', '', '2026-09-07', L); // 到期 08-31 已过
  assert.equal(c3.level, 'overdue');
  const c4 = venueFilingClock('2026-08-01', '', '2026-08-10', L);
  assert.equal(c4.level, 'todo');
  assert.equal(c4.dueISO, '2026-08-31');
  assert.throws(() => venueFilingClock('2026-09-01', '2026-08-30', '2026-09-07', L)); // 备案早于营业
});

test('剧本报备钟：使用日起 30 日、已备案归绿、未录=unset', () => {
  const s1 = { useStartISO: '2026-08-15', filedISO: '2026-09-10', changedAtISO: '' };
  assert.equal(filingClock(s1, '2026-09-07', L).level, 'ok');
  const s2 = { useStartISO: '2026-09-01', filedISO: '', changedAtISO: '' };
  const c2 = filingClock(s2, '2026-09-27', L); // 到期 10-01，剩 4 天
  assert.equal(c2.level, 'warn');
  assert.equal(c2.dueISO, '2026-10-01');
  const s3 = { useStartISO: '2026-07-01', filedISO: '', changedAtISO: '' };
  assert.equal(filingClock(s3, '2026-09-07', L).level, 'overdue');
  const s4 = { useStartISO: '', filedISO: '', changedAtISO: '' };
  assert.equal(filingClock(s4, '2026-09-07', L).level, 'unset');
  // 备案日早于开始使用日=尚未覆盖锚点，仍按未备案走钟
  const s5 = { useStartISO: '2026-08-15', filedISO: '2026-08-01', changedAtISO: '' };
  assert.equal(['todo', 'warn', 'overdue'].includes(filingClock(s5, '2026-09-07', L).level), true);
});

test('实质变更：锚点切换，报备重新起算', () => {
  const s = { useStartISO: '2026-01-09', filedISO: '2026-02-01', changedAtISO: '' };
  assert.equal(filingClock(s, '2026-09-07', L).level, 'ok');
  const s2 = markScriptChanged(s, '2026-09-05');
  const c = filingClock(s2, '2026-09-07', L);
  assert.equal(c.level, 'todo');
  assert.equal(c.dueISO, '2026-10-05');
});

test('场次违规：限时红线/适龄禁入/未核验/缺巡查 四类', () => {
  const sc12 = { name: 'A', ageRange: 'g12', restrictedScene: false };
  const sc18 = { name: 'B', ageRange: 'g18', restrictedScene: true };
  // 工作日接待未成年人 = time-red
  const v1 = sessionViolations({ dateISO: '2026-09-07', minors: 2, ageChecked: true, patrol: true }, sc12, CAL);
  assert.deepEqual(v1.map((x) => x.code), ['time-red']);
  // 补班周六同罪
  const v2 = sessionViolations({ dateISO: '2026-02-14', minors: 1, ageChecked: true, patrol: true }, sc12, CAL);
  assert.deepEqual(v2.map((x) => x.code), ['time-red']);
  // 周末+已核验+已巡查 = 零违规
  const v3 = sessionViolations({ dateISO: '2026-09-12', minors: 2, ageChecked: true, patrol: true }, sc12, CAL);
  assert.deepEqual(v3, []);
  // 周末但 18+ 禁入剧本 = age-ban
  const v4 = sessionViolations({ dateISO: '2026-09-12', minors: 1, ageChecked: true, patrol: true }, sc18, CAL);
  assert.deepEqual(v4.map((x) => x.code), ['age-ban']);
  // 未核验 + 未巡查 = 两个黄
  const v5 = sessionViolations({ dateISO: '2026-09-12', minors: 1, ageChecked: false, patrol: false }, sc12, CAL);
  assert.deepEqual(v5.map((x) => x.code).sort(), ['age-unchecked', 'patrol-missing']);
  // 全成年场次不触发核验类
  const v6 = sessionViolations({ dateISO: '2026-09-07', minors: 0, ageChecked: false, patrol: false }, sc12, CAL);
  assert.deepEqual(v6.map((x) => x.code), ['patrol-missing']);
});

test('撤销场次：不存在即抛错，绝不静默', () => {
  const sessions = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(removeSession(sessions, 'a'), [{ id: 'b' }]);
  assert.throws(() => removeSession(sessions, 'zzz'));
  // 原数组不变（纯函数）
  assert.equal(sessions.length, 2);
});

test('月检钟：本月已检=绿；月初未检=黄；25 日起=红', () => {
  const checks = [{ dateISO: '2026-09-03' }];
  assert.equal(monthlyCheckStatus(checks, '2026-09-07', L).level, 'ok');
  assert.equal(monthlyCheckStatus([], '2026-09-07', L).level, 'warn');
  assert.equal(monthlyCheckStatus([], '2026-09-25', L).level, 'overdue');
  assert.equal(monthlyCheckStatus(checks, '2026-10-07', L).level, 'warn'); // 跨月重置
});

test('演练钟：白天+夜间各一=绿；缺一=黄；缺二或从未=红', () => {
  const ok = [{ dateISO: '2026-08-01', phase: 'day' }, { dateISO: '2026-08-10', phase: 'night' }];
  assert.equal(drillStatus(ok, '2026-09-07', L).level, 'ok');
  const half = [{ dateISO: '2026-08-01', phase: 'day' }, { dateISO: '2026-02-01', phase: 'night' }]; // 夜间出窗
  assert.equal(drillStatus(half, '2026-09-07', L).level, 'warn');
  assert.equal(drillStatus(half, '2026-09-07', L).hasDay, true);
  assert.equal(drillStatus(half, '2026-09-07', L).hasNight, false);
  assert.equal(drillStatus([], '2026-09-07', L).level, 'overdue');
  const bothOld = [{ dateISO: '2026-01-01', phase: 'day' }, { dateISO: '2026-01-02', phase: 'night' }];
  assert.equal(drillStatus(bothOld, '2026-09-07', L).level, 'overdue');
});

test('培训钟：365 日窗口 + 30 日黄灯', () => {
  assert.equal(trainingStatus([{ dateISO: '2025-10-10' }], '2026-09-07', L).level, 'ok');   // 到期 2026-10-10，剩 33 天
  assert.equal(trainingStatus([{ dateISO: '2025-09-20' }], '2026-09-07', L).level, 'warn'); // 到期 2026-09-20，剩 13 天
  assert.equal(trainingStatus([{ dateISO: '2025-08-20' }], '2026-09-07', L).level, 'overdue'); // 到期 2026-08-20 已过
  assert.equal(trainingStatus([], '2026-09-07', L).level, 'overdue');
});

test('灭火器钟与台账最差钟', () => {
  assert.equal(expiryClock('2026-10-20', '2026-09-07', L).level, 'ok');    // 剩 43 天
  assert.equal(expiryClock('2026-09-30', '2026-09-07', L).level, 'warn');  // 剩 23 天
  assert.equal(expiryClock('2026-09-01', '2026-09-07', L).level, 'overdue');
  const b1 = extinguisherBoard([
    { id: '1', nextCheckISO: '2026-10-20' },
    { id: '2', nextCheckISO: '2026-09-01' },
  ], '2026-09-07', L);
  assert.equal(b1.level, 'overdue');
  assert.equal(extinguisherBoard([], '2026-09-07', L).level, 'unset');
});

test('隐患闭环：空描述拒绝、空措施拒绝、重复销案拒绝、不存在拒绝', () => {
  let { issues, seq } = openIssue([], 1, { dateISO: '2026-09-01', desc: '  应急灯不亮  ' });
  assert.equal(seq, 2);
  assert.equal(issues[0].desc, '应急灯不亮');
  assert.equal(issues[0].status, 'open');
  assert.throws(() => openIssue([], 1, { dateISO: '2026-09-01', desc: '   ' }));
  assert.throws(() => closeIssue(issues, issues[0].id, { closedISO: '2026-09-02', fix: '  ' }));
  const fixed = closeIssue(issues, issues[0].id, { closedISO: '2026-09-02', fix: '更换灯具' });
  assert.equal(fixed[0].status, 'fixed');
  assert.equal(fixed[0].fix, '更换灯具');
  assert.throws(() => closeIssue(fixed, fixed[0].id, { closedISO: '2026-09-03', fix: '再来一次' }));
  assert.throws(() => closeIssue(fixed, 'nope', { closedISO: '2026-09-03', fix: 'x' }));
});

test('选址自查板：计数与缺失清单', () => {
  const sb = setupBoard({ legalBuilding: true, notResidential: true });
  assert.equal(sb.done, 2);
  assert.equal(sb.total, 18);
  assert.equal(sb.missing.length, 16);
});

function sampleState() {
  return {
    venue: {
      name: '月境迷环·沉浸剧场', manager: '陈场长', address: '示例市', openedISO: '2025-11-20',
      filedISO: '2025-12-08', filingNo: 'X', scopeAdjusted: true, fireCheck: 'Y',
      jubensha: true, escape: true, area: '210', phone: '', setup: { legalBuilding: true, notResidential: true },
    },
    scripts: [
      { id: 's1', name: '月境迷环', kind: 'city', ageRange: 'g12', restrictedScene: false, useStartISO: '2025-12-01', filedISO: '2025-12-20', changedAtISO: '' },
      { id: 's3', name: '雾锁病栋', kind: 'escape', ageRange: 'g16', restrictedScene: true, useStartISO: '2026-07-20', filedISO: '', changedAtISO: '' },
      { id: 's4', name: '旧校舍怪谈', kind: 'exclusive', ageRange: 'g18', restrictedScene: true, useStartISO: '2026-01-09', filedISO: '2026-02-01', changedAtISO: '' },
    ],
    sessions: [
      { id: 'p1', dateISO: '2026-09-06', start: '19:00', scriptId: 's1', players: 6, minors: 2, ageChecked: true, patrol: true },
      { id: 'p2', dateISO: '2026-09-07', start: '14:00', scriptId: 's1', players: 5, minors: 0, ageChecked: false, patrol: true },
      { id: 'p3', dateISO: '2026-09-07', start: '19:30', scriptId: 's3', players: 6, minors: 0, ageChecked: false, patrol: false },
      { id: 'p4', dateISO: '2026-09-04', start: '13:00', scriptId: 's4', players: 5, minors: 1, ageChecked: false, patrol: true },
    ],
    checks: [{ dateISO: '2026-09-01' }],
    drills: [{ dateISO: '2026-08-01', phase: 'day' }, { dateISO: '2026-08-10', phase: 'night' }],
    trainings: [{ dateISO: '2026-04-11' }],
    extinguishers: [
      { id: 'e1', location: '吧台', count: 2, nextCheckISO: '2027-03-06' },
      { id: 'e2', location: '通道口', count: 2, nextCheckISO: '2026-09-01' },
    ],
    issues: [{ id: 'i1', dateISO: '2026-09-05', desc: '监控离线', sev: 'warn', status: 'open', closedISO: '', fix: '' }],
    calendar: CAL,
    limits: { ...L },
  };
}

test('八灯体检：确定性扣分（本样例应点名报备/红线/巡查/灭火器/自查）', () => {
  const hc = healthCheck(sampleState(), '2026-09-07');
  const byId = Object.fromEntries(hc.lamps.map((l) => [l.id, l.level]));
  assert.equal(byId.filing, 'overdue');   // s3 未备案已逾期（07-20 起算，到期 08-19）
  assert.equal(byId.minors, 'overdue');   // p4：工作日+18+剧本接待未成年（双红）
  assert.equal(byId.patrol, 'warn');      // p3 缺局后巡查
  assert.equal(byId.mcheck, 'ok');
  assert.equal(byId.drill, 'ok');
  assert.equal(byId.training, 'ok');
  assert.equal(byId.ext, 'overdue');      // e2 已过期
  assert.equal(byId.setup, 'warn');       // 2/18 确认
  // 红灯 3×15（报备/红线/灭火器） + 黄灯 2×8（巡查/自查） = 61 → 39 分
  assert.equal(hc.score, 39);
});

test('八灯体检：全绿样例=100 分；未建档=65 分基线', () => {
  const green = sampleState();
  green.scripts[1].filedISO = '2026-08-20';
  green.sessions[2].patrol = true;
  green.sessions[3].minors = 0;
  green.extinguishers[1].nextCheckISO = '2027-01-01';
  green.venue.setup = Object.fromEntries(['legalBuilding', 'notResidential', 'floorOk', 'notSanheyi', 'noHazmat', 'schoolDist', 'fireAlarm', 'extinguishers', 'emLights', 'evacMap', 'exitsOk', 'cctv24h', 'comms', 'prebrief', 'separation', 'oneUnlock', 'evacClear', 'signage'].map((k) => [k, true]));
  const hc = healthCheck(green, '2026-09-07');
  assert.equal(hc.score, 100);
  const empty = { venue: { name: '' }, scripts: [], sessions: [], checks: [], drills: [], trainings: [], extinguishers: [], issues: [], calendar: CAL, limits: L };
  assert.equal(healthCheck(empty, '2026-09-07').score, 65);
});

test('月度小结：确定性文本、跨月统计与红线计数', () => {
  const t = monthlySummaryText(sampleState(), '2026-09', '2026-09-07');
  assert.match(t, /开本 4 场/);
  assert.match(t, /接待未成年 2 场/);
  assert.match(t, /限时红线 1 场/);   // p4 工作日接待未成年
  assert.match(t, /缺局后巡查 1 场/); // p3
  assert.match(t, /账本体检 39 分/);
});

test('迎检自证包：单文件 HTML、无外部资源、XSS 转义、十大检查点齐全', () => {
  const s = sampleState();
  s.scripts[0].name = '<script>alert(1)</script>恶本';
  const html = inspectionPackHtml(s, '2026-09-07');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!/https?:\/\//.test(html.replace(/xmlns='http:\/\/www\.w3\.org\/2000\/svg'/g, '')));
  for (const k of ['剧本娱乐经营场所 迎检自证包', '告知性备案', '限时', '每局', '演练', '培训', '灭火器', '隐患', '签字', '属地规则永远赢']) {
    assert.ok(html.includes(k), `缺少 ${k}`);
  }
});

test('每局巡查卡：当日日型与红线提示', () => {
  const html = patrolCardHtml(sampleState(), '2026-09-07');
  assert.ok(html.includes('不得接待未成年人'));
  assert.ok(html.includes('每局防火巡查'));
  const html2 = patrolCardHtml(sampleState(), '2026-09-12');
  assert.ok(html2.includes('可接待未成年人'));
});

test('导出导入往返；异构与损坏整体拒绝', () => {
  const s = sampleState();
  const json = exportBundle(s);
  const back = importBundle(json);
  assert.equal(back.venue.name, s.venue.name);
  assert.equal(back.sessions.length, 4);
  assert.equal(JSON.stringify(importBundle(json)), JSON.stringify(s));
  assert.throws(() => importBundle('not json'));
  assert.throws(() => importBundle(JSON.stringify({ app: 'other', state: {} })));
  assert.throws(() => importBundle(JSON.stringify({ app: 'scene-log', state: { venue: {} } }))); // 缺字段
  const bad = JSON.parse(json);
  bad.state.sessions[0].players = 0;
  assert.throws(() => importBundle(JSON.stringify(bad)));
  const badDate = JSON.parse(json);
  badDate.state.sessions[0].dateISO = '2026-9-7';
  assert.throws(() => importBundle(JSON.stringify(badDate)));
});

test('常量口径：2026 假日表与整治口径的种子完整性', () => {
  assert.equal(HOLIDAYS_2026.holidays.length, 33);  // 3+9+3+5+3+3+7
  assert.equal(HOLIDAYS_2026.workdays.length, 6);
  assert.deepEqual(Object.keys(AGE_RANGES), ['all', 'g8', 'g12', 'g16', 'g18']);
  assert.equal(L.filingDays, 30);
});

test('escapeHtml 基础', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('monthKey 与 todayISO 边界', () => {
  assert.equal(monthKey('2026-09-07'), '2026-09');
  assert.throws(() => monthKey('2026-09'));
});
