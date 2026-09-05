/**
 * tests/core.test.mjs — 护安单 CareLedger 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, assertDT, todayISO, addDays, daysUntil, monthKey, escapeHtml,
  RISK_FIELDS, RISK_LEVELS, CARE_LEVELS, SHIFTS, INCIDENT_TYPES, CYCLE_KINDS,
  DEFAULT_ENABLED_SHIFTS, DEFAULT_NIGHT_MIN_TIMES, DEFAULT_CYCLE_PERIODS,
  newRiskBook, assertRiskBook, setRisk, riskSummary, unsetRiskResidents, watchList,
  discharge, undoDischarge,
  roundFor, addRound, removeRound, coverageFor, gapsBetween, recentGaps, shortNightRounds,
  addIncident, closeIncident, undoClose, openIncidents,
  addCycle, cycleStatus, dueCycles, markCycleDone,
  certBundle, certText, certHtml, monthlyReport,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期（周六），不依赖墙钟

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年；assertDT 校验「yyyy-mm-dd hh:mm」', () => {
  assert.throws(() => assertISO('2026-9-5'));
  assert.throws(() => assertISO('20260905'));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
  assert.doesNotThrow(() => assertDT('2026-09-05 21:30'));
  assert.throws(() => assertDT('2026-09-05 24:00'));
  assert.throws(() => assertDT('2026-09-05 21:60'));
  assert.throws(() => assertDT('2026-09-0521:30'));
  assert.throws(() => assertDT('2026-02-30 10:00'));
});

test('addDays 跨月/跨年收敛；daysUntil 与 monthKey 正确', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysUntil('2026-12-31', T), 117);
  assert.equal(daysUntil(T, T), 0);
  assert.equal(daysUntil('2026-09-04', T), -1);
  assert.equal(monthKey('2026-09-05'), '2026-09');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('escapeHtml 转义 XSS 字符', () => {
  assert.equal(escapeHtml('<script>&"\'</script>'), '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
});

// ---------------------------------------------------------------------------
// 九防风险登记（建档即全「未评估」）
// ---------------------------------------------------------------------------

function mkResident(id, over = {}) {
  return {
    id, name: `老人${id}`, bed: '101-1', careLevel: 'care',
    admitISO: '2026-03-01', familyName: '家属', familyPhone: '13800000000', note: '',
    status: 'in', riskBook: newRiskBook(), createdAt: '2026-03-01T00:00:00.000Z',
    ...over,
  };
}

function baseState() {
  return {
    home: { name: '慈安养护院', phone: '13800001234', beds: 38 },
    residents: [mkResident('p1'), mkResident('p2', { name: '王守业', careLevel: 'special' })],
    rounds: [],
    incidents: [],
    cycles: [],
    settings: {
      enabledShifts: ['day', 'night'],
      nightMinTimes: 2,
      soonDays: 30,
      cyclePeriods: { assess: 180, drill: 180, health: 365, other: 0 },
    },
    events: [],
  };
}

test('newRiskBook 建档即九项全「未评估」；模板基线（GB 38600 九防）', () => {
  const rb = newRiskBook();
  assert.deepEqual(Object.keys(rb), Object.keys(RISK_FIELDS));
  assert.equal(Object.keys(RISK_FIELDS).length, 9);
  for (const k of Object.keys(rb)) {
    assert.equal(rb[k].level, 'unset');
    assert.equal(rb[k].measures, '');
  }
  assert.deepEqual(Object.keys(RISK_LEVELS), ['unset', 'none', 'watch', 'high']);
  assert.deepEqual(Object.keys(CARE_LEVELS), ['self', 'assist', 'care', 'special']);
  assert.deepEqual(Object.keys(SHIFTS), ['day', 'mid', 'night']);
  assert.deepEqual(Object.keys(INCIDENT_TYPES).slice(0, 9), Object.keys(RISK_FIELDS));
  assert.equal(INCIDENT_TYPES.other.label, '其他');
  assert.throws(() => assertRiskBook({ chokes: { level: 'nope' } }), /风险项缺失/);
});

test('setRisk：watch/high 必须填措施；非法项与级别拒绝', () => {
  const rb = newRiskBook();
  assert.throws(() => setRisk(rb, 'fall', 'high', ''), /必须填写防护措施/);
  assert.throws(() => setRisk(rb, 'fall', 'watch', '  '), /必须填写防护措施/);
  setRisk(rb, 'fall', 'high', '专人扶助');
  assert.equal(rb.fall.level, 'high');
  assert.equal(rb.fall.measures, '专人扶助');
  setRisk(rb, 'scald', 'none');
  assert.equal(rb.scald.measures, '');
  assert.throws(() => setRisk(rb, 'nope', 'none'), /风险项非法/);
  assert.throws(() => setRisk(rb, 'fall', 'danger'), /风险级别非法/);
});

test('riskSummary / unsetRiskResidents / watchList：缺口与重点名册', () => {
  const state = baseState();
  assert.equal(unsetRiskResidents(state.residents).length, 2); // 建档即全未评估
  setRisk(state.residents[0].riskBook, 'fall', 'high', '专人扶助');
  setRisk(state.residents[0].riskBook, 'scald', 'none');
  const sum = riskSummary(state.residents[0]);
  assert.equal(sum.unset, 7);
  assert.equal(sum.high, 1);
  assert.equal(sum.none, 1);
  assert.equal(watchList(state.residents).length, 1);
  assert.equal(watchList(state.residents)[0].id, 'p1');
  state.residents[0].status = 'out'; // 离院老人不进在住点名
  assert.equal(watchList(state.residents).length, 0);
});

test('discharge / undoDischarge：离院日期早于入住拒绝，误操作可回滚', () => {
  const residents = [mkResident('p1')];
  assert.throws(() => discharge(residents, 'p1', '2026-02-01'), /不能早于入住/);
  discharge(residents, 'p1', '2026-09-01');
  assert.equal(residents[0].status, 'out');
  assert.equal(residents[0].outISO, '2026-09-01');
  assert.throws(() => discharge(residents, 'p1', '2026-09-02'), /已是离院/);
  undoDischarge(residents, 'p1');
  assert.equal(residents[0].status, 'in');
  assert.equal(residents[0].outISO, undefined);
  assert.throws(() => undoDischarge(residents, 'p1'), /不在离院状态/);
});

// ---------------------------------------------------------------------------
// 值班巡查账
// ---------------------------------------------------------------------------

test('addRound：署名必填、异常必写处置、重复打卡拒绝、未来日期拒绝、未启用班次拒绝', () => {
  const state = baseState();
  assert.throws(() => addRound(state, { dateISO: T, shift: 'day', staff: '' }, T), /值班人必填/);
  assert.throws(() => addRound(state, { dateISO: T, shift: 'day', staff: '李芳', status: 'abnormal' }, T), /必须写明情况与处置/);
  assert.throws(() => addRound(state, { dateISO: T, shift: 'mid', staff: '李芳' }, T), /班次未启用/);
  assert.throws(() => addRound(state, { dateISO: '2026-09-30', shift: 'day', staff: '李芳' }, T), /未来的班次/);
  assert.throws(() => addRound(state, { dateISO: T, shift: 'day', staff: '李芳', status: 'maybe' }, T), /状态非法/);
  const { round } = addRound(state, { dateISO: T, shift: 'day', staff: '李芳', majors: '全员平安' }, T);
  assert.equal(round.shift, 'day');
  assert.equal(round.status, 'ok');
  assert.throws(() => addRound(state, { dateISO: T, shift: 'day', staff: '张敏' }, T), /已有打卡记录/);
  assert.throws(() => addRound(state, { dateISO: T, shift: 'nope', staff: '李芳' }, T), /班次非法/);
});

test('addRound：夜班必填夜巡次数，低于下限亮 short 不阻止', () => {
  const state = baseState();
  assert.throws(() => addRound(state, { dateISO: T, shift: 'night', staff: '赵强', nightTimes: null }, T), /夜巡次数/);
  assert.throws(() => addRound(state, { dateISO: T, shift: 'night', staff: '赵强', nightTimes: 0 }, T), /夜巡次数/);
  const ok = addRound(state, { dateISO: T, shift: 'night', staff: '赵强', nightTimes: 2 }, T);
  assert.equal(ok.short.level, 'ok');
  const short = addRound(state, { dateISO: addDays(T, -1), shift: 'night', staff: '钱进', nightTimes: 1 }, T);
  assert.equal(short.short.level, 'short');
  assert.equal(short.round.shortNote, '夜巡 1 次，少于设定下限 2 次');
  assert.equal(shortNightRounds(state).length, 1);
});

test('coverageFor / gapsBetween：缺班点名、未来自动截断、倒填与超长区间拒绝', () => {
  const state = baseState();
  addRound(state, { dateISO: T, shift: 'day', staff: '李芳' }, T);
  const cov = coverageFor(state, T);
  assert.deepEqual(cov.done, ['day']);
  assert.deepEqual(cov.missing, ['night']);
  const empty = coverageFor(state, addDays(T, -1));
  assert.deepEqual(empty.missing, ['day', 'night']);

  const gaps = gapsBetween(state, addDays(T, -2), T, T);
  assert.equal(gaps.length, 3); // 3 天都有缺口：前 2 天全缺、今天缺夜班
  assert.deepEqual(gaps[2].missing, ['night']);
  assert.equal(gapsBetween(state, T, '2026-12-31', T).length, 1); // 未来截断后只剩今天：缺夜班
  assert.equal(gapsBetween(state, addDays(T, 1), '2026-12-31', T).length, 0); // 纯未来区间为空
  assert.throws(() => gapsBetween(state, T, addDays(T, -1), T), /起点晚于终点/);
  assert.throws(() => gapsBetween(state, '2025-01-01', T, T), /区间过长/);
  assert.equal(recentGaps(state, 7, T).length, 7); // 7 天窗口内每一天都有缺口
});

test('removeRound：删除后可重新打卡（要改先删）', () => {
  const state = baseState();
  const { round } = addRound(state, { dateISO: T, shift: 'day', staff: '李芳' });
  removeRound(state, round.id);
  assert.throws(() => removeRound(state, round.id), /不存在/);
  assert.doesNotThrow(() => addRound(state, { dateISO: T, shift: 'day', staff: '张敏' }));
});

// ---------------------------------------------------------------------------
// 事件闭环
// ---------------------------------------------------------------------------

test('addIncident：老人必须存在、类型合法、日期不能未来、经过必填', () => {
  const state = baseState();
  assert.throws(() => addIncident(state, { id: 'i1', residentId: 'ghost', type: 'fall', dateISO: T, desc: 'x' }), /老人不存在/);
  assert.throws(() => addIncident(state, { id: 'i1', residentId: 'p1', type: '火山', dateISO: T, desc: 'x' }), /事件类型非法/);
  assert.throws(() => addIncident(state, { id: 'i1', residentId: 'p1', type: 'fall', dateISO: '2026-10-01', desc: 'x' }), /未来/);
  assert.throws(() => addIncident(state, { id: 'i1', residentId: 'p1', type: 'fall', dateISO: T, desc: '  ' }), /经过必须写明/);
  const ev = addIncident(state, { id: 'i1', residentId: 'p1', type: 'fall', dateISO: T, desc: '如厕后滑坐于地' });
  assert.equal(ev.status, 'open');
  assert.equal(ev.residentName, '老人p1');
  assert.equal(openIncidents(state).length, 1);
});

test('closeIncident：家属告知（时间+方式+通知人）与复盘是硬前提；撤销可回滚', () => {
  const state = baseState();
  addIncident(state, { id: 'i1', residentId: 'p1', type: 'fall', dateISO: T, desc: '滑坐于地' }, T);
  assert.throws(() => closeIncident(state, { id: 'i1', familyNotifiedAt: '2026-09-05 10:00', familyWay: '', familyBy: 'x', reviewNote: 'y' }), /告知方式必填/);
  assert.throws(() => closeIncident(state, { id: 'i1', familyNotifiedAt: '2026-09-05 10:00', familyWay: '电话', familyBy: '', reviewNote: 'y' }), /通知人必填/);
  assert.throws(() => closeIncident(state, { id: 'i1', familyNotifiedAt: '2026-09-05 10:00', familyWay: '电话', familyBy: '院长', reviewNote: '' }), /复盘整改必填/);
  assert.throws(() => closeIncident(state, { id: 'i1', familyNotifiedAt: '2026-09-05 上午', familyWay: '电话', familyBy: '院长', reviewNote: 'y' }), /非法时间戳/);
  closeIncident(state, { id: 'i1', familyNotifiedAt: '2026-09-05 10:00', familyWay: '电话', familyBy: '院长', reviewNote: '加装扶手' });
  assert.equal(state.incidents[0].status, 'closed');
  assert.throws(() => closeIncident(state, { id: 'i1', familyNotifiedAt: '2026-09-05 11:00', familyWay: '电话', familyBy: '院长', reviewNote: 'y' }), /不能重复结案/);
  undoClose(state, 'i1');
  assert.equal(state.incidents[0].status, 'open');
  assert.equal(state.incidents[0].familyWay, undefined);
  assert.throws(() => undoClose(state, 'i1'), /不在闭环状态/);
});

// ---------------------------------------------------------------------------
// 周期义务账
// ---------------------------------------------------------------------------

test('addCycle / cycleStatus：三态边界（到期含当天，临期含 soonDays）', () => {
  const state = baseState();
  assert.throws(() => addCycle(state, { id: 'c1', kind: 'volcano', owner: '全员', dueISO: T }), /类型非法/);
  assert.throws(() => addCycle(state, { id: 'c1', kind: 'drill', owner: '', dueISO: T }), /必填/);
  addCycle(state, { id: 'c1', kind: 'drill', owner: '全员', dueISO: T });
  assert.throws(() => addCycle(state, { id: 'c2', kind: 'drill', owner: '全员', dueISO: '2026-13-01' }), /非法日期/);
  const periods = DEFAULT_CYCLE_PERIODS;
  assert.equal(cycleStatus({ dueISO: T }, T, periods), 'due');
  assert.equal(cycleStatus({ dueISO: addDays(T, -1) }, T, periods), 'due');
  assert.equal(cycleStatus({ dueISO: addDays(T, 1) }, T, periods), 'soon');
  assert.equal(cycleStatus({ dueISO: addDays(T, 30) }, T, periods), 'soon');
  assert.equal(cycleStatus({ dueISO: addDays(T, 31) }, T, periods), 'ok');
});

test('dueCycles 只点名到期与临期；markCycleDone 打勾并按周期滚动下一轮', () => {
  const state = baseState();
  addCycle(state, { id: 'c1', kind: 'drill', owner: '全员', dueISO: addDays(T, -12) });
  addCycle(state, { id: 'c2', kind: 'assess', owner: '王守业', dueISO: addDays(T, 18) });
  addCycle(state, { id: 'c3', kind: 'health', owner: '李芳', dueISO: addDays(T, 200) });
  const due = dueCycles(state, T);
  assert.deepEqual(due.map((x) => x.cycle.id), ['c1', 'c2']);
  assert.deepEqual(due.map((x) => x.status), ['due', 'soon']);

  assert.throws(() => markCycleDone(state, 'ghost', T), /不存在/);
  assert.throws(() => markCycleDone(state, 'c1', '2026-09-30'), /不能是未来/);
  const { cycle, nextDueISO } = markCycleDone(state, 'c1', T, T);
  assert.equal(cycle.doneISO, T);
  assert.equal(nextDueISO, addDays(T, 180)); // drill 周期 180 天
  assert.equal(dueCycles(state, T).length, 1); // c2 仍临期，c1 滚动后正常

  addCycle(state, { id: 'c4', kind: 'other', owner: '一次性事项', dueISO: T });
  const one = markCycleDone(state, 'c4', T, T);
  assert.equal(one.nextDueISO, T); // other 周期 0：只记账不滚动
});

// ---------------------------------------------------------------------------
// 自证包（老人 × 时段：评估 + 覆盖 + 事件，缺口如实列出）
// ---------------------------------------------------------------------------

function demoState() {
  const state = baseState();
  const r = state.residents[0];
  setRisk(r.riskBook, 'fall', 'high', '专人扶助');
  setRisk(r.riskBook, 'chokes', 'watch', '糊化餐');
  // 时段：T-2 ~ T（3 天 × 2 班 = 6 班次）
  addRound(state, { dateISO: addDays(T, -2), shift: 'day', staff: '李芳' });
  addRound(state, { dateISO: addDays(T, -2), shift: 'night', staff: '钱进', nightTimes: 2 });
  addRound(state, { dateISO: addDays(T, -1), shift: 'day', staff: '李芳' }); // 缺夜班
  addRound(state, { dateISO: T, shift: 'day', staff: '张敏' });
  addRound(state, { dateISO: T, shift: 'night', staff: '赵强', nightTimes: 2 }); // T-2 夜班齐
  addIncident(state, { id: 'i1', residentId: 'p1', type: 'fall', dateISO: addDays(T, -1), desc: '滑坐于地', firstAid: '制动' }, T);
  closeIncident(state, { id: 'i1', familyNotifiedAt: `${T} 10:00`, familyWay: '电话', familyBy: '院长', reviewNote: '加装扶手' });
  return state;
}

test('certBundle：应打卡/已打卡/缺口计数正确，事件进包且闭环信息完整', () => {
  const state = demoState();
  const from = addDays(T, -2);
  const b = certBundle(state, { residentId: 'p1', fromISO: from, toISO: T, todayISOStr: T });
  assert.equal(b.coverage.planned, 6);
  assert.equal(b.coverage.done, 5);
  assert.equal(b.coverage.missingCount, 1);
  assert.equal(b.coverage.gaps.length, 1);
  assert.deepEqual(b.coverage.gaps[0].missing, ['night']);
  assert.equal(b.incidents.length, 1);
  assert.equal(b.incidents[0].status, 'closed');
  assert.equal(b.incidents[0].familyWay, '电话');
  assert.equal(b.risks.find((x) => x.label === '防跌倒').mark, '🔴');
  assert.throws(() => certBundle(state, { residentId: 'p1', fromISO: T, toISO: from, todayISOStr: T }), /起点晚于终点/);
});

test('certText：结构四段齐全，缺口如实点名，未闭环事件亮警告，同输入同输出', () => {
  const state = demoState();
  const from = addDays(T, -2);
  const args = { state, residentId: 'p1', fromISO: from, toISO: T, todayISOStr: T };
  const text = certText(args);
  assert.match(text, /【照护安全自证包】老人p1/);
  assert.match(text, /一、九防风险评估与防护（GB 38600-2019）/);
  assert.match(text, /防跌倒：🔴 高风险（专人扶助）/);
  assert.match(text, /应打卡 6 班次/);
  assert.match(text, /已打卡 5 班次，缺口 1 班次（如实列出）/);
  assert.match(text, new RegExp(`${addDays(T, -1)} 缺：夜班`));
  assert.match(text, /【跌倒】滑坐于地/);
  assert.match(text, /家属告知：2026-09-05 10:00（电话，通知人 院长）/);
  assert.match(text, /复盘整改：加装扶手/);
  assert.equal(certText(args), text); // 同输入同输出（可复现）
});

test('certText：未闭环事件必须亮警告而不是消失', () => {
  const state = demoState();
  addIncident(state, { id: 'i2', residentId: 'p1', type: 'chokes', dateISO: T, desc: '呛咳' }, T);
  const text = certText({ state, residentId: 'p1', fromISO: T, toISO: T, todayISOStr: T });
  assert.match(text, /该事件尚未闭环/);
});

test('certHtml：单文件 HTML，名字被转义（XSS 防护），签字栏在场', () => {
  const state = demoState();
  state.residents[0].name = '<script>alert(1)</script>周';
  const html = certHtml({ state, residentId: 'p1', fromISO: addDays(T, -2), toISO: T, todayISOStr: T });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(html, /查阅人（家属\/检查人员）签字/);
  assert.match(html, /缺口 1/);
});

// ---------------------------------------------------------------------------
// 月报与导入导出
// ---------------------------------------------------------------------------

test('monthlyReport：按月隔离，统计打卡/异常/事件/闭环', () => {
  const state = demoState();
  const m0 = monthlyReport(state.rounds, state.incidents, monthKey(T));
  assert.equal(m0.rounds, 5);
  assert.equal(m0.abnormal, 0);
  assert.equal(m0.incidents, 1);
  assert.equal(m0.closed, 1);
  assert.equal(m0.openLeft, 0);
  const m1 = monthlyReport(state.rounds, state.incidents, monthKey(addDays(T, -32)));
  assert.equal(m1.rounds, 0);
  assert.equal(m1.incidents, 0);
  assert.throws(() => monthlyReport([], [], '2026-9'), /非法月份/);
});

test('exportBundle 确定性；importBundle 往返一致并整体拒绝非法结构', () => {
  const state = demoState();
  const bundle = exportBundle(state);
  assert.equal(exportBundle({ ...state, events: [...state.events] }), bundle); // 同日导出逐字节一致

  const round = importBundle(bundle);
  assert.ok(round.ok);
  assert.equal(round.state.residents.length, state.residents.length);
  assert.equal(round.state.incidents[0].reviewNote, '加装扶手');

  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle('{"app":"other"}').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'careledger', version: STATE_VERSION + 1 })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'careledger', version: 1, state: { home: {} } })).ok, false);
});
