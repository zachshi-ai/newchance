/**
 * core.js — 岗卫账 PostGuard 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；
 * 金额一律整数「分」运算；所有周期参数（预警窗/检查周期/复训间隔）可在设置中被企业覆盖。
 *
 * 合规口径（原文核验与链接见 docs/14-调研来源.md）：
 * - 《职业病防治法》（2018-12-29 第四次修正，现行）
 *   第 20 条：用人单位应采取的管理措施，含（四）建立、健全职业卫生档案和劳动者健康监护档案；
 *   第 24 条：产生职业病危害的用人单位应在醒目位置设置公告栏，公布规章制度与检测结果；
 *   第 26 条：专人负责日常监测；定期检测、评价结果存入职业卫生档案并公布；
 *   第 34 条：主要负责人和职业卫生管理人员应接受职业卫生培训；劳动者上岗前培训+在岗期间定期培训；
 *   第 35 条：组织上岗前/在岗期间/离岗时职业健康检查并书面告知，费用由用人单位承担；
 *            不得安排未经上岗前检查者从事接害作业；未离岗检查不得解除或终止劳动合同；
 *   第 36 条：建立职业健康监护档案并按规定期限保存；劳动者离职时有权索取复印件，单位如实、
 *            无偿提供并签章；
 *   第 71 条(四)(五)：未按规定组织检查/建档/书面告知，或离职时不提供档案复印件——警告、责令
 *            限期改正，可并处 5 万~10 万元罚款；
 *   第 75 条(七)：安排未经职业健康检查者、职业禁忌者、未成年工、孕期哺乳期女职工从事接害作业
 *            ——责令限期治理并处 5 万~30 万元罚款，情节严重责令停业或关闭。
 * - 《用人单位职业健康监护监督管理办法》（原安监总局令第 49 号，2012-06-01 施行，现由卫生健康
 *   部门执行）
 *   第 11 条：新录用及转岗劳动者应做上岗前检查；
 *   第 12 条：不得安排未检者/职业禁忌者/未成年工/孕期哺乳期女职工接害；
 *   第 13 条：在岗检查周期按 GBZ 188 确定；
 *   第 14 条：两种应急检查情形；
 *   第 15 条：离岗前 30 日内组织离岗检查；离岗前 90 日内的在岗检查可视同离岗检查；
 *   第 16 条：检查结果及机构建议书面告知劳动者；
 *   第 17 条：按检查报告采取五项措施（禁忌调离、妥善安置、安排复查医学观察、疑似职业病诊治、
 *            改善岗位条件）；
 *   第 19 条：一人一档，档案含职业史、接触史、历次检查结果及处理情况等。
 * - 《职业病危害项目申报办法》（原安监总局令第 48 号，2012-06-01 施行）
 *   第 8 条：四种变更情形分别自竣工验收/变化/收到检测结果之日起 30 日或 15 日内申报变更；
 *   第 9 条：终止经营 15 日内办理注销。
 * - 《工作场所职业卫生管理规定》（国家卫健委令第 5 号，2021-02-01 施行）
 *   第 20 条：职业病危害严重的用人单位每年至少一次职业病危害因素检测、每三年至少一次现状评价；
 *            危害一般的用人单位每三年至少一次检测；
 *   第 22 条：实施由专人负责的日常监测。
 * - GBZ 188—2025《职业健康监护技术规范》（国家卫健委 2025-09 发布，2026-08-01 施行，
 *   代替 GBZ 188—2014；发布通告：nhc.gov.cn/fzs/c100048/202509/93c5090f626f471b98dac5088824fc8a）
 *   噪声：8h 等效声级 ≥85 dB(A) → 1 年 1 次；≥80 且 <85 → 2 年 1 次；<80 无需监护；
 *   粉尘/化学物：按作业分级（GBZ/T 229.1/.2—2025）定档，Ⅰ级及以下 → 2 年 1 次，
 *   Ⅱ级及以上 → 1 年 1 次，未分级或分级无效的从严按 Ⅱ级及以上 执行；
 *   高温：1 年 1 次；职业健康监护档案保存期限不少于 15 年。
 * - 《职业病分类和目录》（2025-08-01 施行）：10 大类 132 种 → 12 大类 135 种，
 *   新增职业性肌肉骨骼疾病（腕管综合征）与职业性精神和行为障碍（创伤后应激障碍）。
 * - 《职业健康检查管理办法》（国家卫生计生委令第 5 号公布，2019 年修改）：职业健康检查由
 *   备案的医疗卫生机构承担。
 * 本工具是企业侧的职业健康监护合规账本，不构成法律意见，不替代法定申报、报送与执法认定。
 */

// ---------------------------------------------------------------------------
// 日期与工具（ISO 字符串 yyyy-mm-dd 为唯一日期表示）
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 校验 ISO 日期字符串，非法则抛错 */
export function assertISO(iso) {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) {
    throw new Error(`非法日期: ${JSON.stringify(iso)}`);
  }
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new Error(`非法日期: ${iso}`);
  }
  return iso;
}

/** 当前日期（ISO）。now 可注入，保证测试确定性 */
export function todayISO(now = new Date()) {
  const tzOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

/** 日期加 n 天（负数=回退） */
export function addDays(iso, n) {
  assertISO(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 日期加 n 个月，月末钳制（2026-01-31 + 1 月 = 2026-02-28），n 可为负 */
export function addMonths(iso, n) {
  assertISO(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

/** 距目标日还有几天（负数=已过期） */
export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO);
  assertISO(todayISOStr);
  const ms = new Date(`${targetISO}T00:00:00Z`) - new Date(`${todayISOStr}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** 'YYYY-MM' 月份键（月报分组用） */
export function monthKey(iso) {
  assertISO(iso);
  return iso.slice(0, 7);
}

/** 金额：整数分 → 「¥420.00」 */
export function fmtYuan(cents) {
  if (!Number.isInteger(cents)) throw new Error(`金额必须为整数分: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 接害因素库：GBZ 188—2025 周期定档规则（属地规则与检查机构意见永远赢）
// ---------------------------------------------------------------------------

/**
 * 定档规则类型：
 * - noise  ：按岗位噪声 8h 等效声级定档（≥85→12 个月；≥80 且 <85→24 个月；<80 无需监护）
 * - grade  ：按职业病危害作业分级定档（Ⅱ级及以上→12 个月；Ⅰ级及以下→24 个月；未分级从严 12 个月）
 * - year1  ：固定 12 个月
 * 粉尘与化学物共用 grade 规则（分别依据 GBZ/T 229.1 / 229.2—2025 分级），高温固定 1 年。
 */
export const FACTORS = {
  noise: {
    label: '噪声', rule: 'noise', category: 'physical',
    basis: 'GBZ 188—2025：8h 等效声级 ≥85 dB(A) 每 1 年 1 次；≥80 且 <85 每 2 年 1 次；<80 无需监护',
  },
  dust_silica: {
    label: '矽尘（游离 SiO₂ ≥10%）', rule: 'grade', category: 'dust',
    basis: 'GBZ 188—2025：按生产性粉尘作业分级（GBZ/T 229.1—2025），Ⅰ级及以下每 2 年 1 次、Ⅱ级及以上每 1 年 1 次；未分级或分级无效的按 Ⅱ级及以上 从严执行',
  },
  dust_coal: {
    label: '煤尘（含煤矽尘）', rule: 'grade', category: 'dust',
    basis: 'GBZ 188—2025：按生产性粉尘作业分级，Ⅰ级及以下每 2 年 1 次、Ⅱ级及以上每 1 年 1 次；未分级从严',
  },
  dust_welding: {
    label: '电焊烟尘', rule: 'grade', category: 'dust',
    basis: 'GBZ 188—2025：按生产性粉尘作业分级，Ⅰ级及以下每 2 年 1 次、Ⅱ级及以上每 1 年 1 次；未分级从严',
  },
  dust_wood: {
    label: '木粉尘', rule: 'grade', category: 'dust',
    basis: 'GBZ 188—2025：按生产性粉尘作业分级，Ⅰ级及以下每 2 年 1 次、Ⅱ级及以上每 1 年 1 次；未分级从严',
  },
  lead: {
    label: '铅及其无机化合物', rule: 'grade', category: 'chemical',
    basis: 'GBZ 188—2025：按毒物作业分级（GBZ/T 229.2—2025），Ⅰ级及以下每 2 年 1 次、Ⅱ级及以上每 1 年 1 次；未分级从严',
  },
  benzene: {
    label: '苯', rule: 'grade', category: 'chemical',
    basis: 'GBZ 188—2025：按毒物作业分级，Ⅰ级及以下每 2 年 1 次、Ⅱ级及以上每 1 年 1 次；未分级从严',
  },
  high_temp: {
    label: '高温', rule: 'year1', category: 'physical',
    basis: 'GBZ 188—2025 高温作业：每 1 年 1 次',
  },
};

export const FACTOR_IDS = Object.keys(FACTORS);

/** 作业分级（GBZ/T 229 系列）。unknown = 未分级或分级无效，从严处理 */
export const GRADES = {
  'I': 'Ⅰ级及以下',
  'II': 'Ⅱ级及以上',
  'unknown': '未分级（从严按 Ⅱ级及以上 执行）',
};

/** 岗位单一因素的检查周期（月）。噪声 <80 dB 不产生监护钟 */
export function factorCycleMonths(factorId, post) {
  const f = FACTORS[factorId];
  if (!f) throw new Error(`未知接害因素: ${factorId}`);
  if (f.rule === 'year1') return { months: 12, basis: f.basis, monitored: true };
  if (f.rule === 'noise') {
    const db = post.noiseDb;
    if (db == null) {
      return { months: 12, basis: `${f.basis}（岗位未登记噪声级，从严按 ≥85 dB(A) 档）`, monitored: true };
    }
    if (db >= 85) return { months: 12, basis: `${f.basis}（岗位登记 ${db} dB(A)）`, monitored: true };
    if (db >= 80) return { months: 24, basis: `${f.basis}（岗位登记 ${db} dB(A)）`, monitored: true };
    return { months: 0, basis: `${f.basis}（岗位登记 ${db} dB(A)，无需监护）`, monitored: false };
  }
  // grade：粉尘与化学物
  const months = post.grade === 'I' ? 24 : 12; // II / unknown 均从严 12 个月
  const tag = post.grade === 'I' ? 'Ⅰ级及以下' : post.grade === 'II' ? 'Ⅱ级及以上' : '未分级，从严按 Ⅱ级及以上';
  return { months, basis: `${f.basis}（本岗位分级：${tag}）`, monitored: true };
}

/** 岗位的监护周期：取各因素中最短周期（从严合并），全不监护返回 monitored:false */
export function postCycle(post) {
  if (!post || !Array.isArray(post.factors) || post.factors.length === 0) {
    return { months: 0, basis: '岗位未登记接害因素', monitored: false, factors: [] };
  }
  let best = null;
  const detail = [];
  for (const id of post.factors) {
    const r = factorCycleMonths(id, post);
    detail.push({ factor: id, ...r });
    if (r.monitored && (!best || r.months < best.months)) {
      best = { months: r.months, basis: r.basis, monitored: true };
    }
  }
  if (!best) return { months: 0, basis: '各因素均无需监护', monitored: false, factors: detail };
  return { ...best, factors: detail };
}

// ---------------------------------------------------------------------------
// 员工三钟：上岗前闸钟 / 在岗到期钟 / 离岗闸钟（依据 49 号令第 11~15 条）
// ---------------------------------------------------------------------------

/** 检查结论（GBZ 188—2025 已删除「复查」结论项；复查为机构建议的后续动作） */
export const CONCLUSIONS = {
  normal: { label: '正常', action: null },
  contraindication: { label: '职业禁忌', action: '调离或暂时脱离原岗位（49 号令第 17 条(一)）' },
  settle: { label: '健康损害可能与职业相关', action: '妥善安置（49 号令第 17 条(二)）' },
  suspected: { label: '疑似职业病', action: '按机构建议安排医学观察或职业病诊断（49 号令第 17 条(四)）' },
};

/**
 * 上岗前闸钟：49 号令第 11~12 条 + 职业病防治法第 35 条。
 * 无上岗前检查（或检查晚于入岗日）→ 禁止安排接害作业（第 75 条(七)：罚款 5 万~30 万）。
 */
export function preExamGate(worker, todayISOStr = todayISO()) {
  void todayISOStr;
  if (worker.preExamDate) {
    if (worker.hiredDate && worker.preExamDate > worker.hiredDate) {
      return {
        state: 'warn', ok: false,
        msg: `上岗前检查（${worker.preExamDate}）晚于入岗日（${worker.hiredDate}）——检查须在安排接害作业前完成，请复核`,
      };
    }
    return { state: 'ok', ok: true, msg: `上岗前检查 ${worker.preExamDate} ✓` };
  }
  return {
    state: 'blocked', ok: false,
    msg: '未登记上岗前职业健康检查——不得安排从事接害作业（第 75 条(七)：5万~30万罚款红线）',
  };
}

/**
 * 在岗到期钟：最近一次检查（在岗优先，否则以上岗前检查起算）+ 岗位周期 → 下次到期日。
 * 返回 red/amber/green 与剩余天数（展示层负责把负数转成「已逾期 N 天」文案）。
 */
export function onJobClock(worker, post, todayISOStr = todayISO(), warnDays = 90) {
  const cycle = postCycle(post);
  if (!cycle.monitored) {
    return { state: 'none', due: null, daysLeft: null, msg: '岗位无监护周期要求', cycle };
  }
  const exams = Array.isArray(worker.onJobExams) ? [...worker.onJobExams].sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
  const last = exams[0] || (worker.preExamDate ? { date: worker.preExamDate, conclusion: 'normal', fromPre: true } : null);
  if (!last) {
    return { state: 'blocked', due: null, daysLeft: null, msg: '无任何检查记录（含上岗前）——禁止安排接害作业', cycle };
  }
  const due = addMonths(last.date, cycle.months);
  const daysLeft = daysUntil(due, todayISOStr);
  const state = daysLeft < 0 ? 'red' : daysLeft <= warnDays ? 'amber' : 'green';
  return {
    state, due, daysLeft,
    lastExam: last.date,
    fromPre: Boolean(last.fromPre),
    msg: daysLeft < 0 ? `在岗检查已逾期 ${-daysLeft} 天` : daysLeft === 0 ? '在岗检查今日到期' : `距下次在岗检查还有 ${daysLeft} 天`,
    cycle,
  };
}

/**
 * 离岗闸钟：49 号令第 15 条。
 * - 拟离职日 ≤30 日未检 → 提醒立即安排离岗检查；
 * - 已离职未检 → 红牌：不得解除/终止劳动合同的红线已涉，提示尽快安排补检；
 * - 离岗前 90 日内的在岗检查可视同离岗检查。
 */
export function leaveGate(worker, todayISOStr = todayISO()) {
  if (!worker.leaveDate) {
    return { state: 'none', msg: '在职' };
  }
  const exams = Array.isArray(worker.onJobExams) ? worker.onJobExams : [];
  // 90 日视同规则：最后一次在岗检查距离职日 ≤90 天即可充当离岗检查
  const covered = worker.leaveExamDate
    || exams.find((e) => e.date <= worker.leaveDate && daysUntil(worker.leaveDate, e.date) <= 90);
  const windowStart = addDays(worker.leaveDate, -30);
  const inWindow = daysUntil(worker.leaveDate, todayISOStr) <= 30 && daysUntil(worker.leaveDate, todayISOStr) >= 0;
  if (covered) {
    return { state: 'ok', msg: `离岗检查已覆盖（${covered.date}）✓`, coveredOn: covered.date || worker.leaveExamDate };
  }
  if (daysUntil(worker.leaveDate, todayISOStr) < 0) {
    return {
      state: 'red',
      msg: `已于 ${worker.leaveDate} 离岗且无离岗检查——未检离岗不得解除/终止劳动合同（第 35 条红线），请尽快安排补检并书面告知`,
    };
  }
  if (inWindow || daysUntil(windowStart, todayISOStr) <= 0) {
    return { state: 'amber', msg: `离职窗口期（${windowStart} ~ ${worker.leaveDate}）：30 日内应安排离岗检查` };
  }
  return { state: 'pending', msg: `拟于 ${worker.leaveDate} 离岗，届期前 30 日安排离岗检查` };
}

/** 员工综合钟况（看板用）：闸门优先级 > 周期钟 */
export function workerState(worker, post, todayISOStr = todayISO(), warnDays = 90) {
  const pre = preExamGate(worker, todayISOStr);
  if (post && !pre.ok) {
    return { level: 'red', kind: 'pre', pre, leave: leaveGate(worker, todayISOStr), onJob: null };
  }
  const leave = leaveGate(worker, todayISOStr);
  if (leave.state === 'red') {
    return { level: 'red', kind: 'leave', pre, leave, onJob: null };
  }
  if (!post) {
    return { level: 'amber', kind: 'noPost', pre, leave, onJob: null, msg: '未分配接害岗位' };
  }
  const onJob = onJobClock(worker, post, todayISOStr, warnDays);
  if (onJob.state === 'blocked' || onJob.state === 'red') {
    return { level: 'red', kind: 'onJob', pre, leave, onJob };
  }
  if (onJob.state === 'amber' || leave.state === 'amber') {
    return { level: 'amber', kind: onJob.state === 'amber' ? 'onJob' : 'leave', pre, leave, onJob };
  }
  if (onJob.state === 'none') {
    return { level: 'none', kind: 'onJob', pre, leave, onJob };
  }
  return { level: 'green', kind: 'onJob', pre, leave, onJob };
}

/** 最近一次检查的异常结论是否未闭环（49 号令第 17 条后续措施） */
export function openActions(worker) {
  const exams = Array.isArray(worker.onJobExams) ? [...worker.onJobExams].sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
  const last = exams[0] || null;
  if (!last || !last.conclusion || last.conclusion === 'normal') return [];
  const c = CONCLUSIONS[last.conclusion];
  if (!c) return [];
  const closed = Array.isArray(worker.closedActions) && worker.closedActions.includes(last.date);
  return closed ? [] : [{ date: last.date, conclusion: last.conclusion, label: c.label, action: c.action }];
}

// ---------------------------------------------------------------------------
// 机构级合规钟：危害因素检测 / 危害项目申报 / 培训 / 防护用品（四件套）
// ---------------------------------------------------------------------------

/** 定期检测钟：危害严重=12 个月一检+36 个月现状评价；危害一般=36 个月一检（5 号令第 20 条） */
export const RISK_CLASSES = {
  serious: { label: '职业病危害严重', detectMonths: 12, assessMonths: 36 },
  general: { label: '职业病危害一般', detectMonths: 36, assessMonths: 0 },
};

export function detectionClock(riskClass, lastDetectDate, lastAssessDate, todayISOStr = todayISO(), warnDays = 60) {
  const rc = RISK_CLASSES[riskClass] || RISK_CLASSES.general;
  const items = [];
  if (lastDetectDate) {
    const due = addMonths(lastDetectDate, rc.detectMonths);
    const daysLeft = daysUntil(due, todayISOStr);
    items.push({
      name: '职业病危害因素定期检测', due, daysLeft,
      state: daysLeft < 0 ? 'red' : daysLeft <= warnDays ? 'amber' : 'green',
      basis: `${rc.label}：每 ${rc.detectMonths} 个月至少 1 次（5 号令第 20 条）`,
    });
  } else {
    items.push({
      name: '职业病危害因素定期检测', due: null, daysLeft: null, state: 'red',
      basis: `${rc.label}：每 ${rc.detectMonths} 个月至少 1 次（5 号令第 20 条）——从未登记`,
    });
  }
  if (rc.assessMonths > 0) {
    if (lastAssessDate) {
      const due = addMonths(lastAssessDate, rc.assessMonths);
      const daysLeft = daysUntil(due, todayISOStr);
      items.push({
        name: '职业病危害现状评价', due, daysLeft,
        state: daysLeft < 0 ? 'red' : daysLeft <= warnDays ? 'amber' : 'green',
        basis: `${rc.label}：每 ${rc.assessMonths} 个月至少 1 次（5 号令第 20 条）`,
      });
    } else {
      items.push({
        name: '职业病危害现状评价', due: null, daysLeft: null, state: 'red',
        basis: `${rc.label}：每 ${rc.assessMonths} 个月至少 1 次（5 号令第 20 条）——从未登记`,
      });
    }
  }
  return items;
}

/** 申报变更钟：48 号令第 8 条四种情形 */
export const CHANGE_TYPES = {
  construction: { label: '新改扩建/技改/技术引进项目（竣工验收）', days: 30 },
  process: { label: '技术/工艺/设备/材料变化致危害因素重大变化', days: 15 },
  workplace: { label: '工作场所、名称、法定代表人或主要负责人变化', days: 15 },
  detection: { label: '检测评价发现原申报内容变化（收到结果）', days: 15 },
};

/** 变更申报截止日与剩余天数。declared=true 表示已完成该次变更申报 */
export function declarationClock(change, declared = false, todayISOStr = todayISO()) {
  const t = CHANGE_TYPES[change.type];
  if (!t) throw new Error(`未知变更类型: ${change.type}`);
  const deadline = addDays(change.date, t.days);
  const daysLeft = daysUntil(deadline, todayISOStr);
  if (declared) return { ...change, deadline, daysLeft, state: 'ok', label: t.label, windowDays: t.days };
  const state = daysLeft < 0 ? 'red' : 'amber';
  return {
    ...change, deadline, daysLeft, state, label: t.label, windowDays: t.days,
    msg: daysLeft < 0
      ? `变更申报已逾期 ${-daysLeft} 天（第 71 条(一)：可并处 5万~10万）`
      : `须在 ${deadline} 前完成变更申报（剩 ${daysLeft} 天）`,
  };
}

/** 培训钟：负责人/管理人员 + 劳动者在岗定期复训（职业病防治法第 34 条），默认 12 个月复训 */
export function trainingClock(training, todayISOStr = todayISO(), warnDays = 60, refresherMonths = 12) {
  const rows = [
    { name: '主要负责人/职业卫生管理人员培训', date: training.managerDate },
    { name: '劳动者在岗职业卫生复训', date: training.staffDate },
  ];
  return rows.map((r) => {
    if (!r.date) return { ...r, state: 'red', msg: '从未登记（第 34 条：上岗前培训+定期培训）' };
    const due = addMonths(r.date, refresherMonths);
    const daysLeft = daysUntil(due, todayISOStr);
    return {
      ...r, due, daysLeft,
      state: daysLeft < 0 ? 'red' : daysLeft <= warnDays ? 'amber' : 'green',
    };
  });
}

/** 防护用品发放钟：按岗位设置发放周期（默认 3 个月），逾期未发红牌 */
export function ppeClock(post, lastIssueDate, todayISOStr = todayISO(), warnDays = 15, months = 3) {
  if (!lastIssueDate) {
    return { post: post.name, state: 'red', msg: '该岗位从未登记防护用品发放' };
  }
  const due = addMonths(lastIssueDate, months);
  const daysLeft = daysUntil(due, todayISOStr);
  return {
    post: post.name, due, daysLeft,
    state: daysLeft < 0 ? 'red' : daysLeft <= warnDays ? 'amber' : 'green',
  };
}

// ---------------------------------------------------------------------------
// 台账增删与统计（幂等 id、不可变更新）
// ---------------------------------------------------------------------------

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function addPost(posts, post) {
  if (!post.name || !post.name.trim()) throw new Error('岗位名称必填');
  if (posts.some((p) => p.name.trim() === post.name.trim())) throw new Error('岗位名称已存在');
  return [...posts, { factors: [], grade: 'unknown', ...post, id: post.id || uid(), name: post.name.trim() }];
}

export function removePost(posts, workers, id) {
  if (workers.some((w) => w.postId === id)) throw new Error('仍有员工挂在该岗位，请先转移或删除员工');
  return posts.filter((p) => p.id !== id);
}

export function addWorker(workers, w) {
  if (!w.name || !w.name.trim()) throw new Error('姓名必填');
  if (!w.postId) throw new Error('必须分配岗位（或先建岗位）');
  return [...workers, { onJobExams: [], ...w, id: w.id || uid(), name: w.name.trim() }];
}

export function removeWorker(workers, id) {
  return workers.filter((w) => w.id !== id);
}

/** 登记一次检查（preExamDate 直接记在员工上；在岗检查进 onJobExams） */
export function addExam(worker, exam) {
  assertISO(exam.date);
  const exams = [...(worker.onJobExams || []), { conclusion: 'normal', ...exam }];
  exams.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ...worker, onJobExams: exams };
}

/** 检查费用统计（元 → 分整数），用于「健康投入账」与迎检口径 */
export function examCostTotal(workers) {
  let cents = 0;
  for (const w of workers) {
    for (const e of w.onJobExams || []) {
      if (Number.isInteger(e.costCents)) cents += e.costCents;
    }
    if (Number.isInteger(w.preExamCostCents)) cents += w.preExamCostCents;
  }
  return cents;
}

export function monthSummary(workers, todayISOStr = todayISO()) {
  const key = monthKey(todayISOStr);
  const done = [];
  for (const w of workers) {
    for (const e of w.onJobExams || []) {
      if (monthKey(e.date) === key) done.push({ worker: w.name, date: e.date, conclusion: e.conclusion });
    }
  }
  return { month: key, done, count: done.length };
}

// ---------------------------------------------------------------------------
// 迎检自证包（单文件 HTML 导出）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export const DISCLAIMER = '岗卫账是企业侧职业健康监护合规台账：周期口径依据 GBZ 188—2025（2026-08-01 施行）与部门规章整理，属地卫生健康部门要求、检查机构意见与个体复查安排永远优先；本工具不构成法律意见，不替代法定申报、报送与执法认定。';

export function exportBundle(state) {
  return {
    version: STATE_VERSION,
    exportedAt: new Date().toISOString(),
    posts: state.posts || [],
    workers: state.workers || [],
    compliance: state.compliance || {},
    settings: state.settings || {},
  };
}

export function importBundle(bundle) {
  if (!bundle || bundle.version !== STATE_VERSION) {
    throw new Error(`不支持的备份版本: ${bundle && bundle.version}`);
  }
  if (!Array.isArray(bundle.posts) || !Array.isArray(bundle.workers)) {
    throw new Error('备份缺少岗位或员工数据');
  }
  return {
    posts: bundle.posts,
    workers: bundle.workers,
    compliance: bundle.compliance || {},
    settings: bundle.settings || {},
  };
}

function clockBadge(state) {
  return { green: '🟢 正常', amber: '🟡 临期', red: '🔴 逾期/红线', none: '⚪ 无需', ok: '✅ 已闭环', pending: '⏳ 未到窗' }[state] || state;
}

/** 迎检自证包 HTML（单文件、无脚本、可打印） */
export function selfCertHtml(state, todayISOStr = todayISO()) {
  const { posts, workers, compliance = {} } = state;
  const esc = escapeHtml;
  const postById = new Map(posts.map((p) => [p.id, p]));
  const rows = workers.map((w) => {
    const p = postById.get(w.postId);
    const st = workerState(w, p, todayISOStr);
    const acts = openActions(w);
    const onJob = st.onJob;
    return `<tr>
      <td>${esc(w.name)}</td>
      <td>${esc(p ? p.name : '—')}</td>
      <td>${p ? esc(p.factors.map((f) => FACTORS[f]?.label || f).join('、')) || '—' : '—'}</td>
      <td>${esc(w.preExamDate || '未登记')}</td>
      <td>${onJob && onJob.due ? esc(onJob.due) : '—'}</td>
      <td>${clockBadge(st.level === 'none' ? 'none' : st.level)}</td>
      <td>${esc(st.kind === 'pre' ? st.pre.msg : st.leave.state === 'red' ? st.leave.msg : (acts.length ? `待办：${acts[0].label} → ${acts[0].action}` : onJob ? onJob.msg : ''))}</td>
    </tr>`;
  }).join('\n');

  const det = detectionClock(
    compliance.riskClass || 'general',
    compliance.lastDetectDate, compliance.lastAssessDate, todayISOStr,
  ).map((r) => `<li>${esc(r.name)}：${r.due ? `下次 ${esc(r.due)}（剩 ${r.daysLeft} 天）` : '从未登记'} —— ${esc(r.basis)}</li>`).join('\n');

  const dec = (compliance.changes || []).map((c) => {
    const r = declarationClock(c, c.declared, todayISOStr);
    return `<li>${esc(r.label)}（变化日 ${esc(r.date)}）：${r.state === 'ok' ? '✅ 已申报' : esc(r.msg)}</li>`;
  }).join('\n');

  const tr = trainingClock(compliance.training || {}, todayISOStr)
    .map((r) => `<li>${esc(r.name)}：${r.date ? (r.state === 'red' ? '🔴 已逾期' : `${esc(r.date)} 登记，${r.due ? `下次 ${esc(r.due)}` : ''}`) : '🔴 从未登记'}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>职业健康监护迎检自证包 · ${esc(todayISOStr)}</title>
<style>body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;margin:24px;color:#111}
h1{font-size:20px}h2{font-size:16px;margin:18px 0 8px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #999;padding:6px 8px;text-align:left}
th{background:#f0fdfa}.warn{color:#b91c1c}.meta{color:#555;font-size:12px}
.note{font-size:12px;color:#555;border:1px solid #ccc;padding:8px;border-radius:6px;margin-top:16px}
@media print{body{margin:0;font-size:12px}}</style></head><body>
<h1>职业健康监护迎检自证包（岗卫账导出）</h1>
<p class="meta">生成日期：${esc(todayISOStr)} · 企业可在台账内维护后随时重新导出 · 一人一档口径：职业病防治法第 36 条 / 49 号令第 19 条</p>
<h2>一、劳动者职业健康监护一览（${workers.length} 人）</h2>
<table><thead><tr><th>姓名</th><th>岗位</th><th>接害因素</th><th>上岗前检查</th><th>下次在岗检查</th><th>钟况</th><th>提示</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<h2>二、工作场所职业病危害检测与评价</h2>
<ul>${det}</ul>
<h2>三、职业病危害项目申报变更</h2>
<ul>${dec || '<li>暂无变更登记</li>'}</ul>
<h2>四、职业卫生培训</h2>
<ul>${tr}</ul>
<div class="note">${esc(DISCLAIMER)}</div>
</body></html>`;
}

/** 离岗员工监护档案复印件（第 36 条：离职时无偿提供并签章） */
export function leavingArchiveHtml(worker, post, todayISOStr = todayISO()) {
  const esc = escapeHtml;
  const exams = (worker.onJobExams || []).map((e) => {
    const c = CONCLUSIONS[e.conclusion] || { label: e.conclusion };
    return `<tr><td>${esc(e.date)}</td><td>${esc(c.label)}</td><td>${esc(e.note || '')}</td><td>${Number.isInteger(e.costCents) ? esc(fmtYuan(e.costCents)) : '—'}</td></tr>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/><title>职业健康监护档案复印件 · ${esc(worker.name)}</title>
<style>body{font-family:-apple-system,'PingFang SC',sans-serif;margin:28px;color:#111}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #999;padding:6px 8px;text-align:left}
th{background:#f0fdfa}.sig{margin-top:36px;display:flex;justify-content:space-between;font-size:14px}
.note{font-size:12px;color:#555;border:1px solid #ccc;padding:8px;border-radius:6px;margin-top:20px}</style></head><body>
<h1 style="font-size:18px">职业健康监护档案（复印件）</h1>
<p>姓名：<b>${esc(worker.name)}</b> · 岗位：<b>${esc(post ? post.name : '—')}</b>
· 接害因素：<b>${post ? esc(post.factors.map((f) => FACTORS[f]?.label || f).join('、')) : '—'}</b>
· 入岗日：${esc(worker.hiredDate || '—')} · 离岗日：${esc(worker.leaveDate || '在职')}</p>
<p>职业史/接触史说明：${esc(worker.note || '无补充')}</p>
<h2 style="font-size:15px">历次职业健康检查</h2>
<table><thead><tr><th>日期</th><th>结论</th><th>备注</th><th>费用（单位承担）</th></tr></thead>
<tbody>${worker.preExamDate ? `<tr><td>${esc(worker.preExamDate)}</td><td>上岗前检查</td><td></td><td>${Number.isInteger(worker.preExamCostCents) ? esc(fmtYuan(worker.preExamCostCents)) : '—'}</td></tr>` : ''}
${exams}</tbody></table>
<div class="sig"><span>用人单位（签章）：＿＿＿＿＿＿＿＿</span><span>日期：＿＿＿＿＿＿＿＿</span></div>
<div class="note">依《职业病防治法》第 36 条：劳动者离开用人单位时有权索取本人职业健康监护档案复印件，用人单位应当如实、无偿提供，并在所提供的复印件上签章。监护档案保存期限不少于 15 年（GBZ 188—2025）。${esc(DISCLAIMER)}</div>
</body></html>`;
}
