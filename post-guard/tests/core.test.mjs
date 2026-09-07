/**
 * tests/core.test.mjs — 岗卫账 PostGuard 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, addMonths, daysUntil, monthKey, fmtYuan, escapeHtml,
  FACTORS, FACTOR_IDS, GRADES, CONCLUSIONS, RISK_CLASSES, CHANGE_TYPES, STATE_VERSION, DISCLAIMER,
  factorCycleMonths, postCycle,
  preExamGate, onJobClock, leaveGate, workerState, openActions,
  detectionClock, declarationClock, trainingClock, ppeClock,
  uid, addPost, removePost, addWorker, removeWorker, addExam,
  examCostTotal, monthSummary,
  exportBundle, importBundle, selfCertHtml, leavingArchiveHtml,
} from '../app/js/core.js';

const T = '2026-09-06'; // 测试锚定日期，不依赖墙钟

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

test('addMonths 月末钳制与跨年', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-05-31', 1), '2026-06-30');
  assert.equal(addMonths('2025-09-06', 12), '2026-09-06');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
});

test('daysUntil 与 monthKey：负数=已过期', () => {
  assert.equal(daysUntil('2026-09-06', T), 0);
  assert.equal(daysUntil('2026-09-07', T), 1);
  assert.equal(daysUntil('2026-09-05', T), -1);
  assert.equal(monthKey('2026-09-06'), '2026-09');
});

test('fmtYuan 整数分格式化，拒绝小数', () => {
  assert.equal(fmtYuan(42000), '¥420.00');
  assert.equal(fmtYuan(-150), '-¥1.50');
  assert.throws(() => fmtYuan(12.5));
});

test('escapeHtml 防注入', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

// ---------------------------------------------------------------------------
// GBZ 188—2025 周期定档规则引擎
// ---------------------------------------------------------------------------

test('噪声 ≥85 dB(A) → 12 个月；80~85 → 24 个月；<80 无需监护', () => {
  assert.deepEqual(
    ((r) => ({ months: r.months, monitored: r.monitored }))(factorCycleMonths('noise', { noiseDb: 88 })),
    { months: 12, monitored: true },
  );
  assert.equal(factorCycleMonths('noise', { noiseDb: 82 }).months, 24);
  assert.equal(factorCycleMonths('noise', { noiseDb: 82 }).monitored, true);
  const r80 = factorCycleMonths('noise', { noiseDb: 78 });
  assert.equal(r80.monitored, false);
  assert.match(r80.basis, /无需监护/);
});

test('噪声未登记噪声级 → 从严 12 个月并在依据中说明', () => {
  const r = factorCycleMonths('noise', {});
  assert.equal(r.months, 12);
  assert.match(r.basis, /从严/);
});

test('粉尘/化学物按作业分级：Ⅰ级 24 个月，Ⅱ级与未分级从严 12 个月', () => {
  assert.equal(factorCycleMonths('dust_silica', { grade: 'I' }).months, 24);
  assert.equal(factorCycleMonths('dust_silica', { grade: 'II' }).months, 12);
  assert.equal(factorCycleMonths('lead', { grade: 'unknown' }).months, 12);
  assert.match(factorCycleMonths('lead', { grade: 'unknown' }).basis, /从严/);
});

test('高温固定 12 个月；未知因素抛错', () => {
  assert.equal(factorCycleMonths('high_temp', {}).months, 12);
  assert.throws(() => factorCycleMonths('nonexistent', {}));
});

test('postCycle 多因素取最短：噪声 82（24 个月）与矽尘 Ⅰ 级（24 个月）并存 → 24 个月', () => {
  const mixed = postCycle({ factors: ['noise', 'dust_silica'], noiseDb: 82, grade: 'I' });
  assert.equal(mixed.months, 24);
  assert.equal(mixed.monitored, true);
});

test('postCycle 最短周期计算（噪声 88 与矽尘 Ⅰ 级并存 → 12 个月）', () => {
  const mixed = postCycle({ factors: ['noise', 'dust_silica'], noiseDb: 88, grade: 'I' });
  assert.equal(mixed.months, 12);
  assert.equal(mixed.monitored, true);
  assert.equal(mixed.factors.length, 2);
});

test('postCycle 全为无需监护因素 → monitored:false', () => {
  const r = postCycle({ factors: ['noise'], noiseDb: 75 });
  assert.equal(r.monitored, false);
});

// ---------------------------------------------------------------------------
// 上岗前闸钟 / 在岗到期钟 / 离岗闸钟
// ---------------------------------------------------------------------------

const POST_WELD = { id: 'p1', name: '电焊岗', factors: ['dust_welding', 'noise'], noiseDb: 86, grade: 'II' };
const WORKER_OK = {
  id: 'w1', name: '张三', postId: 'p1', hiredDate: '2024-01-10', preExamDate: '2024-01-05',
  onJobExams: [{ date: '2025-09-01', conclusion: 'normal', costCents: 42000 }],
};

test('preExamGate：无检查阻断、晚于入岗警告、正常放行', () => {
  const blocked = preExamGate({ ...WORKER_OK, preExamDate: null }, T);
  assert.equal(blocked.state, 'blocked');
  assert.match(blocked.msg, /不得安排/);
  const warn = preExamGate({ ...WORKER_OK, preExamDate: '2024-02-01' }, T);
  assert.equal(warn.state, 'warn');
  const ok = preExamGate(WORKER_OK, T);
  assert.equal(ok.state, 'ok');
});

test('onJobClock：绿/黄/红三态与天数（2025-09-01 + 12 个月 = 2026-09-01 已逾期）', () => {
  const r = onJobClock(WORKER_OK, POST_WELD, T, 90);
  assert.equal(r.due, '2026-09-01');
  assert.equal(r.daysLeft, -5);
  assert.equal(r.state, 'red');
  assert.match(r.msg, /已逾期 5 天/); // 用户可见文案不得出现负数
});

test('onJobClock：临期黄灯（90 天窗边界）', () => {
  const w = { ...WORKER_OK, onJobExams: [{ date: '2025-12-10', conclusion: 'normal' }] };
  const r = onJobClock(w, POST_WELD, T, 90);
  assert.equal(r.due, '2026-12-10');
  assert.equal(r.daysLeft, 95);
  assert.equal(r.state, 'green');
  const w2 = { ...WORKER_OK, onJobExams: [{ date: '2025-12-01', conclusion: 'normal' }] };
  assert.equal(onJobClock(w2, POST_WELD, T, 90).state, 'amber'); // 2026-12-01 距 T 86 天
});

test('onJobClock：无任何检查 → blocked；无监护岗位 → none', () => {
  const b = onJobClock({ ...WORKER_OK, preExamDate: null, onJobExams: [] }, POST_WELD, T);
  assert.equal(b.state, 'blocked');
  const n = onJobClock(WORKER_OK, { id: 'p2', name: '仓库', factors: [] }, T);
  assert.equal(n.state, 'none');
});

test('onJobClock：以上岗前检查起算（无在岗记录）并标记 fromPre', () => {
  const w = { ...WORKER_OK, onJobExams: [], preExamDate: '2026-03-01' };
  const r = onJobClock(w, POST_WELD, T);
  assert.equal(r.fromPre, true);
  assert.equal(r.due, '2027-03-01');
  assert.equal(r.state, 'green');
});

test('leaveGate：在职 none / 30 日窗 amber / 已离职未检红牌', () => {
  assert.equal(leaveGate({ ...WORKER_OK }, T).state, 'none');
  const leaving = { ...WORKER_OK, leaveDate: '2026-09-20' };
  const lw = leaveGate(leaving, T);
  assert.equal(lw.state, 'amber');
  assert.match(lw.msg, /30 日|离岗检查/);
  const gone = { ...WORKER_OK, leaveDate: '2026-08-01' };
  assert.equal(leaveGate(gone, T).state, 'red');
  assert.match(leaveGate(gone, T).msg, /不得解除|终止/);
});

test('leaveGate：90 日内视同离岗检查（49 号令第 15 条）', () => {
  const covered = {
    ...WORKER_OK,
    leaveDate: '2026-09-01',
    onJobExams: [{ date: '2026-08-20', conclusion: 'normal' }],
  };
  const r = leaveGate(covered, T);
  assert.equal(r.state, 'ok');
  assert.equal(r.coveredOn, '2026-08-20');
  // 检查距离职日超过 90 天则不视同
  const notCovered = {
    ...WORKER_OK,
    leaveDate: '2026-09-01',
    onJobExams: [{ date: '2026-05-01', conclusion: 'normal' }],
  };
  assert.equal(leaveGate(notCovered, T).state, 'red');
  // 显式离岗检查优先
  const explicit = { ...WORKER_OK, leaveDate: '2026-09-01', leaveExamDate: '2026-08-31' };
  assert.equal(leaveGate(explicit, T).state, 'ok');
});

test('workerState 优先级：上岗前闸门 > 离岗红牌 > 在岗钟', () => {
  const noPre = workerState({ ...WORKER_OK, preExamDate: null }, POST_WELD, T);
  assert.equal(noPre.level, 'red');
  assert.equal(noPre.kind, 'pre');
  const leaveRed = workerState({ ...WORKER_OK, leaveDate: '2026-08-01' }, POST_WELD, T);
  assert.equal(leaveRed.kind, 'leave');
  const green = workerState(
    { ...WORKER_OK, onJobExams: [{ date: '2026-08-20', conclusion: 'normal' }] }, POST_WELD, T,
  );
  assert.equal(green.level, 'green');
  const noPost = workerState({ ...WORKER_OK, postId: 'ghost' }, null, T);
  assert.equal(noPost.level, 'amber');
});

test('openActions：异常结论生成待办、闭环后清空、正常无待办', () => {
  const withSuspect = { ...WORKER_OK, onJobExams: [{ date: '2026-08-20', conclusion: 'suspected' }] };
  const acts = openActions(withSuspect);
  assert.equal(acts.length, 1);
  assert.match(acts[0].action, /医学观察|诊断/);
  const closed = { ...withSuspect, closedActions: ['2026-08-20'] };
  assert.deepEqual(openActions(closed), []);
  assert.deepEqual(openActions(WORKER_OK), []);
});

// ---------------------------------------------------------------------------
// 机构级四件套钟
// ---------------------------------------------------------------------------

test('detectionClock：危害严重=年检+3年现状评价；危害一般=3年一检', () => {
  const serious = detectionClock('serious', '2025-09-01', '2023-09-01', T);
  assert.equal(serious.length, 2);
  assert.equal(serious[0].due, '2026-09-01');
  assert.equal(serious[0].state, 'red'); // 今天 09-06 已逾期 5 天
  assert.equal(serious[1].due, '2026-09-01');
  const general = detectionClock('general', '2024-09-01', null, T);
  assert.equal(general.length, 1);
  assert.equal(general[0].due, '2027-09-01');
  assert.equal(general[0].state, 'green');
  const never = detectionClock('serious', null, null, T);
  assert.equal(never[0].state, 'red');
  assert.match(never[0].basis, /从未登记|至少/);
});

test('declarationClock：竣工验收 30 日 / 工艺变化 15 日 / 逾期红牌 / 已申报闭环', () => {
  const c30 = declarationClock({ type: 'construction', date: '2026-08-20' }, false, T);
  assert.equal(c30.deadline, '2026-09-19');
  assert.equal(c30.state, 'amber');
  assert.match(c30.msg, /剩 13 天/);
  const c15 = declarationClock({ type: 'process', date: '2026-08-25' }, false, T);
  assert.equal(c15.deadline, '2026-09-09');
  const overdue = declarationClock({ type: 'detection', date: '2026-07-01' }, false, T);
  assert.equal(overdue.state, 'red');
  assert.match(overdue.msg, /已逾期/);
  assert.equal(declarationClock({ type: 'workplace', date: '2026-07-01' }, true, T).state, 'ok');
  assert.throws(() => declarationClock({ type: 'ghost', date: T }, false, T));
});

test('trainingClock：未登记红牌；临期与正常', () => {
  const rows = trainingClock({ managerDate: '2025-10-01', staffDate: null }, T);
  assert.equal(rows[0].state, 'amber'); // 2026-10-01 距 T 25 天
  assert.equal(rows[1].state, 'red');
  const ok = trainingClock({ managerDate: '2026-06-01', staffDate: '2026-06-01' }, T);
  assert.equal(ok[0].state, 'green');
});

test('ppeClock：未发红牌、逾期红牌、临期', () => {
  assert.equal(ppeClock(POST_WELD, null, T).state, 'red');
  const overdue = ppeClock(POST_WELD, '2026-05-01', T); // +3 月 = 2026-08-01 已过期
  assert.equal(overdue.state, 'red');
  const soon = ppeClock(POST_WELD, '2026-06-15', T); // +3 月 = 2026-09-15，剩 9 天（15 天窗内）
  assert.equal(soon.state, 'amber');
});

// ---------------------------------------------------------------------------
// 台账增删与统计
// ---------------------------------------------------------------------------

test('addPost/addWorker 校验与去重', () => {
  let posts = [];
  posts = addPost(posts, { name: '喷涂岗', factors: ['benzene'], grade: 'II' });
  assert.throws(() => addPost(posts, { name: '喷涂岗' }));
  assert.throws(() => addPost(posts, { name: '  ' }));
  let workers = [];
  workers = addWorker(workers, { name: '李四', postId: posts[0].id, hiredDate: '2026-01-05' });
  assert.throws(() => addWorker(workers, { name: '', postId: posts[0].id }));
  assert.throws(() => addWorker(workers, { name: '王五' }));
  assert.equal(workers.length, 1);
});

test('removePost：有员工挂靠时拒绝', () => {
  const posts = addPost([], { name: '打磨岗', factors: ['dust_wood'] });
  const workers = addWorker([], { name: '赵六', postId: posts[0].id });
  assert.throws(() => removePost(posts, workers, posts[0].id));
  assert.equal(removePost(posts, [], posts[0].id).length, 0);
});

test('removeWorker / addExam 排序与默认结论', () => {
  const w = { id: 'x', name: '钱七', postId: 'p1' };
  const w2 = addExam(w, { date: '2026-05-01' });
  assert.equal(w2.onJobExams[0].conclusion, 'normal');
  const w3 = addExam(w2, { date: '2026-03-01', conclusion: 'contraindication' });
  assert.equal(w3.onJobExams[0].date, '2026-03-01');
  assert.equal(w3.onJobExams.length, 2);
  assert.equal(removeWorker([w3], 'x').length, 0);
});

test('examCostTotal 与 monthSummary', () => {
  const workers = [
    { id: 'a', name: 'A', postId: 'p1', preExamCostCents: 30000, onJobExams: [{ date: '2026-09-02', costCents: 42000 }] },
    { id: 'b', name: 'B', postId: 'p1', onJobExams: [{ date: '2026-08-20', costCents: 42000 }, { date: '2026-09-04', conclusion: 'normal' }] },
  ];
  assert.equal(examCostTotal(workers), 114000);
  const ms = monthSummary(workers, T);
  assert.equal(ms.month, '2026-09');
  assert.equal(ms.count, 2);
});

test('uid 返回非空字符串且不重复', () => {
  const a = uid(); const b = uid();
  assert.ok(a && b && a !== b);
});

// ---------------------------------------------------------------------------
// 备份往返与导出 HTML
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致、坏版本拒绝', () => {
  const state = {
    posts: [POST_WELD],
    workers: [WORKER_OK],
    compliance: { riskClass: 'serious', lastDetectDate: '2025-09-01', changes: [] },
    settings: { warnDays: 90 },
  };
  const bundle = exportBundle(state);
  assert.equal(bundle.version, STATE_VERSION);
  const back = importBundle(JSON.parse(JSON.stringify(bundle)));
  assert.deepEqual(back.posts, state.posts);
  assert.deepEqual(back.workers, state.workers);
  assert.throws(() => importBundle({ ...bundle, version: 99 }));
  assert.throws(() => importBundle({ version: STATE_VERSION, posts: 'x', workers: [] }));
});

test('selfCertHtml：无脚本、含免责行与员工行、无 NaN/undefined 泄漏', () => {
  const html = selfCertHtml({
    posts: [POST_WELD],
    workers: [WORKER_OK, { ...WORKER_OK, id: 'w2', name: '孙八', preExamDate: null, postId: 'ghost' }],
    compliance: { riskClass: 'serious', lastDetectDate: '2025-09-01', changes: [{ type: 'process', date: '2026-08-25' }] },
    settings: {},
  }, T);
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes(DISCLAIMER.slice(0, 20)));
  assert.ok(html.includes('张三'));
  assert.ok(html.includes('职业健康监护迎检自证包'));
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  assert.ok(html.includes('变更申报'));
});

test('leavingArchiveHtml：含第 36 条签章文案与历次检查表', () => {
  const html = leavingArchiveHtml(
    { ...WORKER_OK, leaveDate: '2026-08-01' },
    POST_WELD, T,
  );
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('签章'));
  assert.ok(html.includes('第 36 条'));
  assert.ok(html.includes('15 年'));
  assert.ok(html.includes('¥420.00'));
  assert.ok(!html.includes('undefined'));
});

test('常量口径快照：因素库/分级/结论/变更类型', () => {
  assert.ok(FACTOR_IDS.includes('noise') && FACTOR_IDS.includes('dust_silica') && FACTOR_IDS.includes('benzene'));
  assert.equal(FACTORS.noise.rule, 'noise');
  assert.equal(FACTORS.benzene.rule, 'grade');
  assert.equal(RISK_CLASSES.serious.detectMonths, 12);
  assert.equal(RISK_CLASSES.general.detectMonths, 36);
  assert.equal(CHANGE_TYPES.construction.days, 30);
  assert.equal(CHANGE_TYPES.process.days, 15);
  assert.ok(CONCLUSIONS.contraindication.action.includes('调离'));
  assert.ok(Object.keys(GRADES).includes('unknown'));
});
