/**
 * tests/core.test.mjs — 递安单 ParcelProof 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, monthKey, fmtYuan, escapeHtml,
  REJECT_REASONS, INTERCEPT_ACTIONS, COMPLAINT_CHANNELS, FINE_OUTCOMES, DESTROY_WAYS, DUTY_KINDS,
  DEFAULT_REPLY_DAYS, DEFAULT_DESTROY_DAYS, FILING_DEADLINE_DAYS,
  filingState, addRoutine, removeRoutine, lastRoutineISO, routineGapDays, unconfirmedRoutines,
  addIntercept, closeIntercept, openIntercepts,
  addComplaint, closeComplaint, openComplaints, replyStats,
  addFine, appealFine, settleFine, pendingFines, totalRecovered, monthlyRecovery,
  addDestroy, destroyState, setDutyDone, dutyState, dutyBoard,
  healthCheck, monthlySummary, inspectHtml, appealHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-06'; // 测试锚定日期（周日），不依赖墙钟

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-6'));
  assert.throws(() => assertISO('20260906'));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
});

test('addDays 跨月/跨年收敛', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('daysUntil 与 monthKey 跨年正确', () => {
  assert.equal(daysUntil('2026-12-31', T), 116);
  assert.equal(daysUntil('2026-09-06', T), 0);
  assert.equal(daysUntil('2026-09-05', T), -1);
  assert.equal(monthKey('2026-09-06'), '2026-09');
  assert.equal(monthKey('2025-12-31'), '2025-12');
});

test('fmtYuan 只吃整数分；escapeHtml 全转义', () => {
  assert.equal(fmtYuan(129000), '¥1290.00');
  assert.equal(fmtYuan(305), '¥3.05');
  assert.throws(() => fmtYuan(12.5));
  assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});

test('口径常量基线：拦截原因/处置/渠道/罚款结果/销毁方式/义务四类', () => {
  assert.deepEqual(Object.keys(REJECT_REASONS).sort(), ['id-fake', 'other', 'prohibited', 'refuse-verify']);
  assert.deepEqual(Object.keys(INTERCEPT_ACTIONS).sort(), ['hold', 'other', 'report-mps', 'report-post', 'return']);
  assert.deepEqual(Object.keys(COMPLAINT_CHANNELS).sort(), ['12305', 'counter', 'hq', 'other']);
  assert.deepEqual(Object.keys(FINE_OUTCOMES), ['pending', 'overturn', 'partial', 'sustain']);
  assert.deepEqual(Object.keys(DESTROY_WAYS).sort(), ['burn', 'other', 'recycle', 'shred']);
  assert.deepEqual(Object.keys(DUTY_KINDS), ['training', 'drill', 'fire', 'battery']);
  assert.equal(DEFAULT_REPLY_DAYS, 7);   // 条例第 29 条
  assert.equal(DEFAULT_DESTROY_DAYS, 90);
  assert.equal(FILING_DEADLINE_DAYS, 20); // 条例第 19 条
});

// ---------------------------------------------------------------------------
// 备案钟（条例第 19 条：开办之日起 20 日内）
// ---------------------------------------------------------------------------

test('filingState：未填开办日=unset；未备案按开办日+20 天倒计时', () => {
  assert.equal(filingState({}, T).level, 'unset');
  const st = { openedISO: T };
  const fresh = filingState(st, T, 7);
  assert.equal(fresh.deadline, '2026-09-26');
  assert.equal(fresh.daysLeft, 20);
  assert.equal(fresh.level, 'ok');
  const near = filingState({ openedISO: '2026-09-01' }, T, 7); // 期限 09-21，剩 15 天
  assert.equal(near.level, 'ok');
  assert.equal(near.daysLeft, 15);
  const due = filingState({ openedISO: '2026-08-24' }, T, 7); // 期限 09-13，剩 7 天
  assert.equal(due.level, 'due');
  const late = filingState({ openedISO: '2026-08-10' }, T, 7); // 期限 08-30 已过
  assert.equal(late.level, 'overdue');
  assert.equal(late.daysLeft, -7);
});

test('filingState：已备案无论何时开办都是绿灯，附编号与备案日', () => {
  const ok = filingState({ openedISO: '2020-01-01', filed: true, fileNo: '备001', filedISO: '2020-01-10' }, T);
  assert.equal(ok.level, 'ok');
  assert.match(ok.detail, /备001/);
  assert.match(ok.detail, /2020-01-10/);
});

// ---------------------------------------------------------------------------
// 每日三项制度落账
// ---------------------------------------------------------------------------

function baseState() {
  return {
    version: 1,
    station: { name: '', brand: '', manager: '', phone: '', address: '', openedISO: '', filed: false, fileNo: '', filedISO: '' },
    routines: [],
    intercepts: [],
    complaints: [],
    fines: [],
    destroys: [],
    duties: [],
    settings: { replyDays: 7, destroyDays: 90, gapDays: 7 },
    routineSeq: 0,
    interceptSeq: 0,
    complaintSeq: 0,
    fineSeq: 0,
    destroySeq: 0,
    events: [],
  };
}

test('addRoutine：同日唯一拒绝、件数/布尔/安检枚举校验、引用校验', () => {
  const s = baseState();
  const r = addRoutine(s, { dateISO: T, inbound: 42, verifyOk: true, realnameOk: true, security: 'none' });
  assert.equal(s.routines.length, 1);
  assert.equal(r.id, 'rt-1');
  assert.throws(() => addRoutine(s, { dateISO: T }), /同日唯一/);
  assert.throws(() => addRoutine(s, { dateISO: T, inbound: -1 }), /非负整数/);
  assert.throws(() => addRoutine(s, { dateISO: T, inbound: 3.5 }), /非负整数/);
  assert.throws(() => addRoutine(s, { dateISO: T, verifyOk: 'yes' }), /布尔/);
  assert.throws(() => addRoutine(s, { dateISO: T, security: 'x' }), /非法安检状态/);
  assert.throws(() => addRoutine(s, { dateISO: '2026/09/06' }), /非法日期/);
});

test('removeRoutine / lastRoutineISO / routineGapDays：断更天数与空台账', () => {
  const s = baseState();
  addRoutine(s, { dateISO: '2026-09-01' });
  addRoutine(s, { dateISO: '2026-09-04' });
  assert.equal(lastRoutineISO(s), '2026-09-04');
  assert.equal(routineGapDays(s, T), 2);
  removeRoutine(s, 'rt-2');
  assert.equal(routineGapDays(s, T), 5);
  removeRoutine(s, 'rt-1');
  assert.equal(lastRoutineISO(s), null);
  assert.equal(routineGapDays(s, T), null);
  assert.throws(() => removeRoutine(s, 'ghost'), /不存在/);
});

test('unconfirmedRoutines：只列验视/实名有「未执行」的落账日，升序', () => {
  const s = baseState();
  addRoutine(s, { dateISO: '2026-09-03', realnameOk: false });
  addRoutine(s, { dateISO: '2026-09-01', verifyOk: false });
  addRoutine(s, { dateISO: '2026-09-05' });
  const bad = unconfirmedRoutines(s);
  assert.deepEqual(bad.map((r) => r.dateISO), ['2026-09-01', '2026-09-03']);
});

// ---------------------------------------------------------------------------
// 拦截登记簿
// ---------------------------------------------------------------------------

test('addIntercept：原因/处置枚举校验；closeIntercept 闭环校验（回溯拒绝、重复拒绝）', () => {
  const s = baseState();
  const ic = addIntercept(s, { dateISO: T, person: '刘先生', item: '散装打火机', reason: 'prohibited', action: 'return' });
  assert.equal(s.intercepts.length, 1);
  assert.throws(() => addIntercept(s, { dateISO: T, reason: 'gun' }), /非法拦截原因/);
  assert.throws(() => addIntercept(s, { dateISO: T, action: 'sell' }), /非法处置方式/);
  closeIntercept(s, ic.id, { closedISO: T, result: '当场退回' });
  assert.equal(s.intercepts[0].closedISO, T);
  assert.throws(() => closeIntercept(s, ic.id, { closedISO: T }), /已闭环/);
  const b = addIntercept(s, { dateISO: T, reason: 'id-fake', action: 'hold' });
  assert.throws(() => closeIntercept(s, b.id, { closedISO: '2026-09-05' }), /早于登记日期/);
  assert.throws(() => closeIntercept(s, 'ghost', { closedISO: T }), /不存在/);
});

test('openIntercepts：只列未闭环，最老的在前', () => {
  const s = baseState();
  const a = addIntercept(s, { dateISO: '2026-08-20', action: 'hold' });
  addIntercept(s, { dateISO: '2026-09-01', action: 'return' });
  const c = addIntercept(s, { dateISO: '2026-08-28', action: 'report-mps' });
  closeIntercept(s, c.id, { closedISO: '2026-08-29' });
  const open = openIntercepts(s);
  assert.deepEqual(open.map((x) => x.id), [a.id, 'ic-2']);
});

// ---------------------------------------------------------------------------
// 投诉台账（7 日答复钟）
// ---------------------------------------------------------------------------

test('addComplaint：答复截止 = 登记日 + settings.replyDays；渠道校验', () => {
  const s = baseState();
  const c = addComplaint(s, { dateISO: T, customer: '陈女士', channel: 'counter', matter: '破损' });
  assert.equal(c.replyDueISO, addDays(T, 7));
  assert.throws(() => addComplaint(s, { dateISO: T, channel: 'weibo' }), /非法投诉渠道/);
  s.settings.replyDays = 3;
  const c2 = addComplaint(s, { dateISO: '2026-09-01', channel: '12305' });
  assert.equal(c2.replyDueISO, '2026-09-04');
});

test('closeComplaint：按时/超期打标、回溯拒绝、重复拒绝', () => {
  const s = baseState();
  const c = addComplaint(s, { dateISO: '2026-09-01', channel: 'hq' });
  closeComplaint(s, c.id, { replyISO: '2026-09-08', result: 'resolved', replyWay: '电话' });
  assert.equal(s.complaints[0].late, false);
  assert.throws(() => closeComplaint(s, c.id, { replyISO: T }), /已答复闭环/);
  const b = addComplaint(s, { dateISO: '2026-09-01', channel: 'counter' });
  assert.throws(() => closeComplaint(s, b.id, { replyISO: '2026-08-31' }), /早于登记日期/);
  closeComplaint(s, b.id, { replyISO: '2026-09-20', result: 'explained' });
  assert.equal(s.complaints[1].late, true);
  assert.throws(() => closeComplaint(s, b.id, { replyISO: T }), /已答复闭环/);
});

test('openComplaints 与 replyStats：截止升序、超期计数、达成率口径', () => {
  const s = baseState();
  const a = addComplaint(s, { dateISO: '2026-08-25', channel: 'counter' }); // 截止 09-01，超 5 天
  const b = addComplaint(s, { dateISO: '2026-08-28', channel: 'hq' });      // 截止 09-04，超 2 天
  const c = addComplaint(s, { dateISO: '2026-09-04', channel: '12305' });   // 截止 09-11 剩 5 天
  const d = addComplaint(s, { dateISO: '2026-08-20', channel: 'counter' }); // 按期闭环
  closeComplaint(s, d.id, { replyISO: '2026-08-25', result: 'resolved' });
  const open = openComplaints(s, T);
  assert.deepEqual(open.map((x) => x.id), [a.id, b.id, c.id]);
  assert.equal(open[0].daysLeft, -5);
  const stats = replyStats(s, T);
  assert.deepEqual({ total: stats.total, onTime: stats.onTime, late: stats.late, open: stats.open, overdue: stats.overdue },
    { total: 4, onTime: 1, late: 0, open: 3, overdue: 2 });
});

// ---------------------------------------------------------------------------
// 考核罚款与申诉挽回账
// ---------------------------------------------------------------------------

test('addFine：金额正整数分、关联投诉引用校验', () => {
  const s = baseState();
  const f = addFine(s, { dateISO: T, no: 'KH-1', amountCents: 20000, basis: '破损考核' });
  assert.equal(f.outcome, 'pending');
  assert.throws(() => addFine(s, { dateISO: T, amountCents: 0 }), /正整数分/);
  assert.throws(() => addFine(s, { dateISO: T, amountCents: -5 }), /正整数分/);
  assert.throws(() => addFine(s, { dateISO: T, amountCents: 100, complaintId: 'ghost' }), /关联投诉不存在/);
});

test('appealFine：申诉日不得早于罚款日；settleFine 三种结果金额守恒且一次定案', () => {
  const s = baseState();
  const f = addFine(s, { dateISO: '2026-09-01', amountCents: 20000 });
  assert.throws(() => appealFine(s, f.id, { appealISO: '2026-08-31' }), /早于罚款日期/);
  appealFine(s, f.id, { appealISO: T, appealNote: '有验视记录' });
  assert.throws(() => settleFine(s, f.id, { outcome: 'overturn', recoveredCents: 19999 }), /应等于罚款金额/);
  settleFine(s, f.id, { outcome: 'overturn', recoveredCents: 20000 });
  assert.equal(totalRecovered(s), 20000);
  assert.throws(() => settleFine(s, f.id, { outcome: 'sustain' }), /一次定案/);

  const g = addFine(s, { dateISO: '2026-09-02', amountCents: 30000 });
  assert.throws(() => settleFine(s, g.id, { outcome: 'partial', recoveredCents: 0 }), /0 与罚款金额之间/);
  assert.throws(() => settleFine(s, g.id, { outcome: 'partial', recoveredCents: 30000 }), /0 与罚款金额之间/);
  assert.throws(() => settleFine(s, g.id, { outcome: 'sustain', recoveredCents: 100 }), /应为 0/);
  settleFine(s, g.id, { outcome: 'partial', recoveredCents: 12000 });
  assert.equal(totalRecovered(s), 32000);
  assert.throws(() => settleFine(s, 'ghost', { outcome: 'sustain' }), /不存在/);
  assert.throws(() => settleFine(s, addFine(s, { dateISO: T, amountCents: 100 }).id, { outcome: 'cash' }), /非法申诉结果/);
});

test('pendingFines：待处理最老在前；totalRecovered 与 pending 互斥', () => {
  const s = baseState();
  const a = addFine(s, { dateISO: '2026-08-10', amountCents: 10000 });
  const b = addFine(s, { dateISO: '2026-09-01', amountCents: 20000 });
  const c = addFine(s, { dateISO: '2026-08-20', amountCents: 30000 });
  settleFine(s, c.id, { outcome: 'sustain' });
  const pending = pendingFines(s);
  assert.deepEqual(pending.map((x) => x.id), [a.id, b.id]);
  assert.equal(totalRecovered(s), 0);
});

test('monthlyRecovery：分月隔离、挽回汇总、待处理点名、文本确定性', () => {
  const s = baseState();
  const f1 = addFine(s, { dateISO: '2026-09-02', no: 'A1', amountCents: 20000 });
  settleFine(s, f1.id, { outcome: 'partial', recoveredCents: 12000 });
  addFine(s, { dateISO: '2026-09-20', no: 'A2', amountCents: 30000 });
  addFine(s, { dateISO: '2026-08-10', no: 'A0', amountCents: 10000, basis: '延误考核' });
  const sep = monthlyRecovery(s, '2026-09');
  assert.equal(sep.count, 2);
  assert.equal(sep.finedCents, 50000);
  assert.equal(sep.recoveredCents, 12000);
  assert.equal(sep.pendingCount, 1);
  assert.equal(sep.byOutcome.partial, 1);
  assert.match(sep.text, /【考核罚款与申诉挽回月账】2026-09/);
  assert.match(sep.text, /罚款 2 笔共 ¥500\.00，已挽回 ¥120\.00，待申诉\/待处理 1 笔/);
  assert.match(sep.text, /A1 ¥200\.00 → 部分减免（挽回 ¥120\.00）/);
  const aug = monthlyRecovery(s, '2026-08');
  assert.equal(aug.count, 1);
  assert.equal(monthlyRecovery(s, '2026-09').text, sep.text);
  assert.throws(() => monthlyRecovery(s, '2026-9'), /非法月份/);
});

// ---------------------------------------------------------------------------
// 底单销毁台账与周期义务
// ---------------------------------------------------------------------------

test('addDestroy：方式/数量校验；destroyState 三态与从未销毁', () => {
  const s = baseState();
  addDestroy(s, { dateISO: '2026-08-01', way: 'shred', count: 100, operator: '王', witness: '李' });
  assert.throws(() => addDestroy(s, { dateISO: T, way: 'magic' }), /非法销毁方式/);
  assert.throws(() => addDestroy(s, { dateISO: T, count: -1 }), /非负整数/);
  const ok = destroyState(s, T, 90); // 上次 08-01，周期到 10-30
  assert.equal(ok.level, 'ok');
  assert.equal(ok.daysLeft, 54);
  const due = destroyState(s, '2026-10-20', 90);
  assert.equal(due.level, 'due');
  const late = destroyState(s, '2026-11-01', 90);
  assert.equal(late.level, 'overdue');
  const never = destroyState(baseState(), T, 90);
  assert.equal(never.level, 'never');
});

test('setDutyDone / dutyState：打勾自动滚动、never、周期覆盖', () => {
  const s = baseState();
  setDutyDone(s, 'training', '2026-06-10');
  const st = dutyState(s.duties[0], T); // 90 天周期 → 到期 2026-09-08
  assert.equal(st.nextDue, '2026-09-08');
  assert.equal(st.daysLeft, 2);
  assert.equal(st.level, 'due');
  setDutyDone(s, 'training', '2026-09-01'); // 再打勾=更新最近完成日
  const st2 = dutyState(s.duties[0], T);
  assert.equal(st2.nextDue, '2026-11-30');
  assert.equal(st2.level, 'ok');
  const drill = setDutyDone(s, 'drill', '2025-08-20');
  const st3 = dutyState(drill, T); // 365 天周期 → 已逾期 1 天
  assert.equal(st3.level, 'overdue');
  const custom = dutyState({ kind: 'fire', lastDoneISO: '2026-09-01' }, T, 10);
  assert.equal(custom.nextDue, '2026-09-11');
  assert.equal(dutyState({ kind: 'battery' }, T).level, 'never');
  assert.throws(() => setDutyDone(s, 'yoga', T), /非法义务类型/);
  assert.throws(() => setDutyDone(s, 'training', '2026-9-6'), /非法日期/);
});

test('dutyBoard：红灯在前（never/overdue 优先），附类型标签与依据', () => {
  const s = baseState();
  setDutyDone(s, 'training', T);           // ok
  setDutyDone(s, 'drill', '2025-08-01');   // overdue
  setDutyDone(s, 'fire', '2026-08-15');    // 30 天周期 → 09-14 到期剩 8 天 due
  const board = dutyBoard(s, T);
  assert.deepEqual(board.map((d) => d.level), ['overdue', 'due', 'ok']);
  assert.equal(board[0].label, '应急演练');
  assert.match(board[0].basis, /第三十六条/);
});

// ---------------------------------------------------------------------------
// 账本体检
// ---------------------------------------------------------------------------

test('healthCheck：八项灯位与扣分，空台账低分（备案逾期+从未落账红、销毁从未黄）', () => {
  const s = baseState();
  s.station = { name: '测试网点', openedISO: '2026-08-01' }; // 未备案，期限 08-21 已过
  const hc = healthCheck(s, T, s.settings);
  assert.equal(hc.items.length, 8);
  const byKey = Object.fromEntries(hc.items.map((i) => [i.key, i.level]));
  assert.equal(byKey.filing, 'bad');
  assert.equal(byKey.gap, 'bad');
  assert.equal(byKey.destroy, 'warn');
  assert.equal(hc.bad, 2);
  assert.equal(hc.warn, 1);
  assert.equal(hc.score, 65); // 100 - 2×15 - 1×5，确定性扣分
});

test('healthCheck：健康台账接近满分；断更/未执行确认/超期投诉/待处理罚款分别亮灯', () => {
  const s = baseState();
  s.station = { name: '测试网点', openedISO: '2026-01-01', filed: true, fileNo: '备001', filedISO: '2026-01-05' };
  addRoutine(s, { dateISO: addDays(T, -1), inbound: 30 });
  const hc1 = healthCheck(s, T, s.settings);
  assert.equal(hc1.items.find((i) => i.key === 'filing').level, 'ok');
  assert.equal(hc1.items.find((i) => i.key === 'gap').level, 'ok');
  assert.equal(hc1.items.find((i) => i.key === 'confirm').level, 'ok');
  assert.ok(hc1.score >= 90);

  // 最后一次落账停在 9 天前且带「未执行」确认 → 断更红 + 确认缺口红
  addRoutine(s, { dateISO: addDays(T, -9), realnameOk: false });
  removeRoutine(s, 'rt-1');
  const f = addFine(s, { dateISO: addDays(T, -2), amountCents: 5000 });
  const c = addComplaint(s, { dateISO: addDays(T, -10), channel: 'counter' }); // 截止 3 天前
  const hc2 = healthCheck(s, T, s.settings);
  assert.equal(hc2.items.find((i) => i.key === 'gap').level, 'bad');
  assert.equal(hc2.items.find((i) => i.key === 'confirm').level, 'bad');
  assert.equal(hc2.items.find((i) => i.key === 'complaint').level, 'bad');
  assert.equal(hc2.items.find((i) => i.key === 'fines').level, 'warn');
  assert.ok(hc2.score < hc1.score);
  settleFine(s, f.id, { outcome: 'sustain' });
  closeComplaint(s, c.id, { replyISO: addDays(T, -5), result: 'resolved' });
  assert.equal(healthCheck(s, T, s.settings).items.find((i) => i.key === 'complaint').level, 'ok');
});

// ---------------------------------------------------------------------------
// 月度小结与出证（单文件 HTML）
// ---------------------------------------------------------------------------

test('monthlySummary：六段文本、分月隔离、确定性', () => {
  const s = baseState();
  s.station = { name: '城南路快递超市', brand: '星达快递（示例）' };
  addRoutine(s, { dateISO: '2026-09-01', inbound: 40 });
  addRoutine(s, { dateISO: '2026-09-02', inbound: 38, verifyOk: false, note: '高峰漏一单' });
  const ic = addIntercept(s, { dateISO: '2026-09-03', reason: 'prohibited', action: 'return' });
  closeIntercept(s, ic.id, { closedISO: '2026-09-03', result: '退回' });
  const cp = addComplaint(s, { dateISO: '2026-09-04', channel: 'counter', matter: '破损' });
  closeComplaint(s, cp.id, { replyISO: '2026-09-06', result: 'resolved' });
  const f = addFine(s, { dateISO: '2026-09-05', no: 'A1', amountCents: 20000 });
  settleFine(s, f.id, { outcome: 'overturn', recoveredCents: 20000 });
  addDestroy(s, { dateISO: '2026-09-05', way: 'shred', count: 50 });
  setDutyDone(s, 'drill', '2025-08-01'); // 逾期点名
  const sum = monthlySummary(s, '2026-09', T);
  assert.match(sum.text, /【末端网点安全与服务月度小结】2026-09/);
  assert.match(sum.text, /网点：城南路快递超市（星达快递（示例））/);
  assert.match(sum.text, /落账 2 天/);
  assert.match(sum.text, /1 天存在未执行确认/);
  assert.match(sum.text, /拦截登记 1 笔（全部闭环）/);
  assert.match(sum.text, /投诉 1 笔：1 笔 7 日内答复/);
  assert.match(sum.text, /罚款 1 笔共 ¥200\.00，已挽回 ¥200\.00，无挂账/);
  assert.match(sum.text, /底单销毁 1 次/);
  assert.match(sum.text, /周期义务点名：应急演练/);
  assert.match(sum.text, /不替代法定报送/);
  assert.equal(monthlySummary(s, '2026-09', T).text, sum.text);
  const aug = monthlySummary(s, '2026-08', T);
  assert.match(aug.text, /落账 0 天/);
  assert.throws(() => monthlySummary(s, '2026-9', T), /非法月份/);
});

test('inspectHtml：单文件离线可用（无外部资源），七段+签字栏+转义', () => {
  const s = baseState();
  s.station = { name: '城南路<快递>超市', brand: '星达', manager: '王建国', address: '城南路128号', openedISO: '2026-01-01', filed: true, fileNo: '备041', filedISO: '2026-01-05' };
  addRoutine(s, { dateISO: '2026-09-01', inbound: 40 });
  addRoutine(s, { dateISO: '2026-09-02', realnameOk: false });
  const ic = addIntercept(s, { dateISO: '2026-09-03', person: '刘先生', reason: 'prohibited', action: 'hold' });
  addComplaint(s, { dateISO: '2026-09-01', customer: '陈女士', channel: 'counter', matter: '破损' });
  closeComplaint(s, 'cp-1', { replyISO: '2026-09-05', result: 'resolved' });
  const f = addFine(s, { dateISO: '2026-08-20', no: 'KH-1', amountCents: 20000, basis: '破损考核' });
  settleFine(s, f.id, { outcome: 'partial', recoveredCents: 12000 });
  addDestroy(s, { dateISO: '2026-08-01', way: 'shred', count: 300, operator: '王建国', witness: '李芳' });
  setDutyDone(s, 'training', '2026-08-01');
  const html = inspectHtml(s, T, s.settings);
  assert.ok(!/src=["']http/.test(html));
  assert.ok(!/href=["']http/.test(html));
  assert.match(html, /末端网点迎检自证包 · 城南路&lt;快递&gt;超市/);
  assert.match(html, /网点与备案/);
  assert.match(html, /三项制度执行台账/);
  assert.match(html, /拦截登记簿/);
  assert.match(html, /投诉处理台账/);
  assert.match(html, /考核罚款与申诉挽回/);
  assert.match(html, /底单销毁台账/);
  assert.match(html, /周期义务台账/);
  assert.match(html, /网点负责人（签字\/盖章）/);
  assert.match(html, /¥120\.00/);
  assert.match(html, /已备案（备041）/);
  assert.match(html, /未执行<\/strong>/);
  assert.match(html, /未闭环<\/strong>/);
});

test('appealHtml：罚款证据链打印版（关联投诉时间线+同期落账拦截+申诉理由栏）', () => {
  const s = baseState();
  s.station = { name: '城南路快递超市', brand: '星达', manager: '王建国' };
  const cp = addComplaint(s, { dateISO: '2026-08-25', customer: '周先生', channel: '12305', matter: '显示签收未收到' });
  const f = addFine(s, { dateISO: '2026-09-01', no: 'KH-114', amountCents: 30000, basis: '12305 申诉考核', complaintId: cp.id });
  appealFine(s, f.id, { appealISO: '2026-09-03', appealNote: '该时段有完整落账与拦截记录' });
  addRoutine(s, { dateISO: '2026-09-01', inbound: 46 });
  const ic = addIntercept(s, { dateISO: '2026-08-30', person: '尾号3308', reason: 'prohibited', action: 'hold' });
  const html = appealHtml(s, f.id, T);
  assert.ok(!/src=["']http/.test(html));
  assert.match(html, /考核罚款申诉材料单/);
  assert.match(html, /KH-114/);
  assert.match(html, /¥300\.00/);
  assert.match(html, /关联投诉处理时间线/);
  assert.match(html, /显示签收未收到/);
  assert.match(html, /答复截止/);
  assert.match(html, /同期履责证据/);
  assert.match(html, /2026-09-01/);
  assert.match(html, /尾号3308/);
  assert.match(html, /有完整落账与拦截记录/);
  assert.match(html, /网点负责人（签字\/盖章）/);
  assert.throws(() => appealHtml(s, 'ghost', T), /罚款记录不存在/);
});

test('appealHtml：未答复关联投诉如实标「未答复」，不粉饰', () => {
  const s = baseState();
  const cp = addComplaint(s, { dateISO: '2026-08-25', customer: '周先生', channel: '12305', matter: '丢件' });
  const f = addFine(s, { dateISO: '2026-09-01', amountCents: 10000, complaintId: cp.id });
  const html = appealHtml(s, f.id, T);
  assert.match(html, /<strong>未答复<\/strong>/);
});

test('inspectHtml：空台账渲染不崩溃，备案未登记亮红灯文案', () => {
  const s = baseState();
  const html = inspectHtml(s, T, s.settings);
  assert.match(html, /近 30 天无落账/);
  assert.match(html, /未登记/);
  assert.ok(!/src=["']http/.test(html));
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = baseState();
  s.station = { name: '城南路快递超市', brand: '星达', manager: '王建国', phone: '', address: 'XX路128号', openedISO: '2026-01-01', filed: true, fileNo: '备041', filedISO: '2026-01-05' };
  addRoutine(s, { dateISO: T, inbound: 40 });
  const ic = addIntercept(s, { dateISO: T, reason: 'prohibited', action: 'return' });
  closeIntercept(s, ic.id, { closedISO: T, result: '退回' });
  const cp = addComplaint(s, { dateISO: T, channel: 'counter' });
  closeComplaint(s, cp.id, { replyISO: T, result: 'resolved' });
  const f = addFine(s, { dateISO: T, amountCents: 10000 });
  settleFine(s, f.id, { outcome: 'sustain' });
  addDestroy(s, { dateISO: T, way: 'burn', count: 10 });
  setDutyDone(s, 'training', T);
  const round = importBundle(exportBundle(s));
  assert.ok(round.ok);
  assert.deepEqual(round.state.station, s.station);
  assert.deepEqual(round.state.routines, s.routines);
  assert.deepEqual(round.state.intercepts, s.intercepts);
  assert.deepEqual(round.state.complaints, s.complaints);
  assert.deepEqual(round.state.fines, s.fines);
  assert.deepEqual(round.state.destroys, s.destroys);
  assert.deepEqual(round.state.duties, s.duties);
});

test('importBundle：非 JSON / 错误应用 / 坏结构 / 高版本一律整体拒绝', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.match(importBundle('not json').error, /JSON/);
  const bad = importBundle(JSON.stringify({ app: 'trucklog', version: 1, state: {} }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是递安单/);
  const incomplete = importBundle(JSON.stringify({
    app: 'parcelproof', version: STATE_VERSION,
    state: { station: {}, routines: [], intercepts: [], complaints: [], fines: [], destroys: 'nope', duties: [], settings: {} },
  }));
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.error, /结构不完整/);
  const future = importBundle(JSON.stringify({
    app: 'parcelproof', version: STATE_VERSION + 1,
    state: { station: {}, routines: [], intercepts: [], complaints: [], fines: [], destroys: [], duties: [], settings: {} },
  }));
  assert.equal(future.ok, false);
  assert.match(future.error, /高于当前支持版本/);
});

// ---------------------------------------------------------------------------
// 杂项与回归
// ---------------------------------------------------------------------------

test('todayISO 返回 ISO 字符串', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addRoutine：零件数允许（纯派件日留痕），id 自增', () => {
  const s = baseState();
  const a = addRoutine(s, { dateISO: T, inbound: 0 });
  const b = addRoutine(s, { dateISO: '2026-09-05', inbound: 1 });
  assert.equal(a.inbound, 0);
  assert.equal(b.id, 'rt-2');
});

test('openComplaints：空台账返回空数组，不抛错', () => {
  assert.deepEqual(openComplaints(baseState(), T), []);
  assert.equal(replyStats(baseState(), T).total, 0);
});

test('destroyState：自定义周期生效（destroyDays=30）', () => {
  const s = baseState();
  addDestroy(s, { dateISO: addDays(T, -40), way: 'shred', count: 1 });
  assert.equal(destroyState(s, T, 90).level, 'ok');
  assert.equal(destroyState(s, T, 30).level, 'overdue');
});

test('monthlySummary：空月份给出 0 口径且不抛错', () => {
  const s = baseState();
  const sum = monthlySummary(s, '2026-09', T);
  assert.equal(sum.routines, 0);
  assert.match(sum.text, /落账 0 天/);
  assert.match(sum.text, /拦截登记 0 笔（全部闭环）/);
});

test('users-visible 数字不出现负数歧义：断更与超期一律以正数天数呈现', () => {
  const s = baseState();
  s.station = { name: 'X', openedISO: '2026-08-01' };
  addRoutine(s, { dateISO: '2026-08-25', inbound: 1 });
  const hc = healthCheck(s, T, s.settings);
  const gapItem = hc.items.find((i) => i.key === 'gap');
  assert.match(gapItem.detail, /断更 12 天/);
  assert.ok(!/-\d+ 天/.test(gapItem.detail));
  const cp = addComplaint(s, { dateISO: '2026-08-20', channel: 'counter' });
  const hc2 = healthCheck(s, T, s.settings);
  assert.match(hc2.items.find((i) => i.key === 'complaint').detail, /已超答复期限/);
  assert.equal(daysUntil(cp.replyDueISO, T) < 0, true); // 内部仍可判负，展示层转正
});
