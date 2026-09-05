/**
 * core.js — 梯保单 LiftSheet 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；金额一律整数（元）；日期统一 ISO 字符串
 * yyyy-mm-dd、时刻统一 HH:MM；所有规则参数（四类周期天数/救援时限/临期窗口）可在设置中
 * 被覆盖——TSG T5002-2017 原文与属地要求永远赢。
 *
 * 合规口径（原文摘录与链接见 docs/14-调研来源.md）：
 * - 《特种设备安全法》第四十五条：电梯维保须由制造单位或取得许可的安装/改造/修理单位进行；
 *   第八十八条：未经许可擅自从事电梯维保、或已许可单位未按照安全技术规范要求进行维保的，
 *   责令停止违法行为，处一万元以上十万元以下罚款——「未按规定维保」与「记录不实」是同一
 *   罚则下的直接暴露面。
 * - TSG T5002-2017《电梯维护保养规则》（2017-08-01 施行）：
 *   · 第六条：维保项目分为半月、季度、半年、年度四类，季度⊃半月、半年⊃季度、年度⊃半年（叠层）
 *   · 第五条(四)：设立 24 小时维保值班电话；困人救援「直辖市或者设区的市抵达时间不超过
 *     30 分钟，其他地区一般不超过 1 小时」；(三) 每半年至少按电梯类别进行一次应急演练；
 *     (六) 建立每台电梯的维保记录，归入安全技术档案并至少保存 4 年；(八) 作业人员持
 *     《特种设备作业人员证》；(九) 每年至少一次自行检查，在定期检验之前进行，并向使用单位
 *     出具经检查与审核人员签字、加盖公章的自行检查记录或报告
 *   · 第七条：维保记录至少包括电梯基本情况/使用单位/维保单位与日期与人员签字/维保项目与
 *     详细记载，「维保记录应当经使用单位安全管理人员签字确认」
 *   · 第十条：无纸化维保记录的数据在保存过程中不得有任何更改，并可实时查询——本工具
 *     定位为维保单位自持底账与确认单生成器，不宣称构成该条意义上的法定无纸化记录系统
 * 本工具是维保公司侧的经营与合规底账，不替代法定报送，不构成事故责任认定依据。
 */

// ---------------------------------------------------------------------------
// 日期与工具（ISO 字符串 yyyy-mm-dd 为唯一日期表示，HH:MM 为唯一时刻表示）
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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

/** 校验 HH:MM 时刻，非法则抛错 */
export function assertHM(hm) {
  if (typeof hm !== 'string' || !HM_RE.test(hm)) {
    throw new Error(`非法时刻: ${JSON.stringify(hm)}`);
  }
  return hm;
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

/** 距目标日还有几天（负数=已过去） */
export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO);
  assertISO(todayISOStr);
  const ms = new Date(`${targetISO}T00:00:00Z`) - new Date(`${todayISOStr}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** 'YYYY-MM' 月份键（月账分组用） */
export function monthKey(iso) {
  assertISO(iso);
  return iso.slice(0, 7);
}

/** HH:MM → 当日分钟数 */
export function hmToMin(hm) {
  assertHM(hm);
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
}

/** 两个日期时刻之间的分钟数（支持跨天，d2 应不早于 d1） */
export function diffMinutes(d1, t1, d2, t2) {
  assertISO(d1); assertHM(t1); assertISO(d2); assertHM(t2);
  const dayDiff = Math.round(
    (new Date(`${d2}T00:00:00Z`) - new Date(`${d1}T00:00:00Z`)) / 86400000,
  );
  if (dayDiff < 0) throw new Error('结束时刻早于开始日期');
  return dayDiff * 1440 + hmToMin(t2) - hmToMin(t1);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 目录模板（内容供应链：品种、周期、保养项目预填）
// ---------------------------------------------------------------------------

/** 电梯品种（对应 TSG T5002-2017 附件 A~D） */
export const ELEV_KINDS = {
  traction_pass: { label: '曳引乘客电梯', annex: 'A' },
  traction_freight: { label: '曳引载货电梯', annex: 'A' },
  hydraulic: { label: '液压电梯', annex: 'B' },
  dumbwaiter: { label: '杂物电梯', annex: 'C' },
  escalator: { label: '自动扶梯', annex: 'D' },
  moving_walk: { label: '自动人行道', annex: 'D' },
};

/** 保养类别与叠层级次：季度⊃半月、半年⊃季度、年度⊃半年（TSG T5002-2017 第六条） */
export const JOB_KINDS = {
  half: { label: '半月维护保养', rank: 1, short: '半月保' },
  quarter: { label: '季度维护保养', rank: 2, short: '季度保' },
  halfyear: { label: '半年维护保养', rank: 3, short: '半年保' },
  yearly: { label: '年度维护保养', rank: 4, short: '年度保' },
  selfcheck: { label: '年度自行检查', rank: 0, short: '自行检查' },
};

/** 周期天数默认值（设置页可覆盖；T5002 原文与属地要求永远赢） */
export const CYCLE_DEFAULTS = { half: 15, quarter: 92, halfyear: 183, yearly: 365 };

/**
 * 保养项目预填（内容供应链：据 TSG T5002-2017 附件 A（曳引与强制驱动）整理的
 * 关键子集，非全量照录——全量项目以规则原文为准，工具内逐条可增删改）。
 * itemsFor(kind, jobKind) 返回叠层并集：季度保 = 半月项 + 季度增项，以此类推。
 */
const TRACTION_ITEMS = {
  half: [
    { key: 't01', label: '机房、滑轮间环境（清洁，门窗完好，照明正常）' },
    { key: 't02', label: '手动紧急操作装置（齐全，功能正常）' },
    { key: 't03', label: '曳引机与制动器（运行无异响，制动可靠）' },
    { key: 't04', label: '控制柜（仪表指示正常，无异味异响）' },
    { key: 't05', label: '轿厢照明与应急照明（正常）' },
    { key: 't06', label: '轿厢报警装置与对讲（三方通话有效）' },
    { key: 't07', label: '层门、轿门（开闭正常，门锁啮合可靠）' },
    { key: 't08', label: '层站按钮与显示（正常）' },
    { key: 't09', label: '轿厢平层精度（正常）' },
    { key: 't10', label: '钢丝绳（外观无断丝锈蚀，张力均匀）' },
    { key: 't11', label: '井道照明（正常）' },
    { key: 't12', label: '底坑环境（清洁，无渗水积水，照明正常）' },
    { key: 't13', label: '底坑停止装置（工作正常）' },
    { key: 't14', label: '缓冲器（油量适宜，无锈蚀）' },
  ],
  quarter: [
    { key: 'q01', label: '减速机润滑油（油量适宜，无渗漏）' },
    { key: 'q02', label: '门机传动装置（运行顺畅，无卡阻）' },
    { key: 'q03', label: '导靴/靴衬（磨损不超过制造单位要求）' },
  ],
  halfyear: [
    { key: 'h01', label: '电动机与减速机联轴器（连接无松动，弹性元件无老化）' },
    { key: 'h02', label: '驱动轮、导向轮轴承部（润滑，无异响）' },
    { key: 'h03', label: '曳引轮槽（磨损不超过制造单位要求）' },
    { key: 'h04', label: '限速器张紧轮装置和电气安全装置（工作正常）' },
    { key: 'h05', label: '补偿链（绳）与轿厢、对重接合处（固定，无松动）' },
    { key: 'h06', label: '上、下极限开关（工作正常）' },
  ],
  yearly: [
    { key: 'y01', label: '控制柜接触器、继电器触点（接触良好）' },
    { key: 'y02', label: '导电回路绝缘性能（符合要求）' },
    { key: 'y03', label: '整机自检试运行（按制造单位要求进行）' },
  ],
};

const ESCALATOR_ITEMS = {
  half: [
    { key: 'e01', label: '周边环境与围裙板（清洁，无杂物）' },
    { key: 'e02', label: '梳齿板（完好，啮合正常）' },
    { key: 'e03', label: '梯级/踏板（完好，运行无异响）' },
    { key: 'e04', label: '扶手带（运行正常，速度同步）' },
    { key: 'e05', label: '出入口安全装置（有效）' },
    { key: 'e06', label: '故障显示板信号功能（正常）' },
    { key: 'e07', label: '紧急停止开关（工作正常）' },
    { key: 'e08', label: '电器部件（清洁，接线紧固）' },
  ],
  quarter: [
    { key: 'eq1', label: '梯级链张紧装置（张力适宜）' },
    { key: 'eq2', label: '驱动主机固定（牢固可靠）' },
  ],
  halfyear: [
    { key: 'eh1', label: '制动衬厚度（不小于制造单位要求）' },
    { key: 'eh2', label: '防灌水保护装置（动作可靠，雨季前必须完成）' },
  ],
  yearly: [
    { key: 'ey1', label: '主接触器（触点接触良好）' },
    { key: 'ey2', label: '主驱动链（清理油污，润滑有效）' },
  ],
};

/** 通用子集（液压电梯/杂物电梯：附件 B/C 口径的关键项预填） */
const GENERIC_ITEMS = {
  half: TRACTION_ITEMS.half.filter((i) => !['t09', 't10'].includes(i.key)),
  quarter: [{ key: 'gq1', label: '液压系统/传动部件（无渗漏，运行顺畅）' }],
  halfyear: [{ key: 'gh1', label: '安全装置联动试验（工作正常）' }],
  yearly: [{ key: 'gy1', label: '整机自检试运行（按制造单位要求进行）' }],
};

export const CHECKLISTS = { traction: TRACTION_ITEMS, escalator: ESCALATOR_ITEMS, generic: GENERIC_ITEMS };

/** 品种 → 预填清单 */
export function checklistOf(elevKind) {
  if (elevKind === 'escalator' || elevKind === 'moving_walk') return CHECKLISTS.escalator;
  if (elevKind === 'traction_pass' || elevKind === 'traction_freight') return CHECKLISTS.traction;
  return CHECKLISTS.generic;
}

/** 某品种某类保养的应做项目（叠层并集） */
export function itemsFor(elevKind, jobKind) {
  const cl = checklistOf(elevKind);
  const rank = JOB_KINDS[jobKind].rank;
  return ['half', 'quarter', 'halfyear', 'yearly']
    .filter((k) => JOB_KINDS[k].rank <= rank)
    .flatMap((k) => cl[k]);
}

// ---------------------------------------------------------------------------
// 电梯档案
// ---------------------------------------------------------------------------

export function assertElevator(e) {
  if (!e || typeof e !== 'object') throw new Error('电梯档案不能为空');
  if (!e.code || typeof e.code !== 'string') throw new Error('设备代码必填');
  if (!e.name || typeof e.name !== 'string') throw new Error('电梯内编号必填');
  if (!ELEV_KINDS[e.kind]) throw new Error(`非法电梯品种: ${e.kind}`);
  if (!e.site || typeof e.site !== 'string') throw new Error('使用单位必填');
  if (e.monthlyFee !== undefined && (!Number.isInteger(e.monthlyFee) || e.monthlyFee < 0)) {
    throw new Error('月维保费必须是非负整数（元）');
  }
  if (e.nextInspectionISO) assertISO(e.nextInspectionISO);
  if (e.startISO) assertISO(e.startISO);
  return e;
}

export function elevatorLabel(e) {
  return `${e.name}（${e.code} · ${ELEV_KINDS[e.kind].label}）`;
}

// ---------------------------------------------------------------------------
// 四周期滚动引擎（排班的心脏）
// ---------------------------------------------------------------------------

/** 三态：red=已逾期，yellow=warnDays 内到期（含今天），green=正常 */
export function statusOf(dueISO, today, warnDays = 7) {
  assertISO(dueISO); assertISO(today);
  const d = daysUntil(dueISO, today);
  if (d < 0) return 'red';
  if (d <= warnDays) return 'yellow';
  return 'green';
}

const RANK = { half: 1, quarter: 2, halfyear: 3, yearly: 4 };

/** 某台电梯某层级最后一次保养完成日（层级叠合：季度保也算完成半月层） */
export function lastDoneISO(jobs, elevatorId, kind) {
  const rank = RANK[kind];
  let last = null;
  for (const j of jobs) {
    if (j.elevatorId !== elevatorId || j.kind === 'selfcheck') continue;
    if (RANK[j.kind] >= rank && (!last || j.dateISO > last)) last = j.dateISO;
  }
  return last;
}

/**
 * 一台电梯的四周期排程。
 * 基线：有保养历史按「该层级或更深层级最后一次完成日 + 周期天数」滚动；
 * 无历史按接管日 startISO 起算——「接管那天起，欠的每一保都看得见」。
 */
export function scheduleFor(elevator, jobs, cycles = CYCLE_DEFAULTS, today = todayISO(), warnDays = 7) {
  assertISO(today);
  const kinds = {};
  let worst = 'green';
  let earliestRed = null;
  for (const kind of ['half', 'quarter', 'halfyear', 'yearly']) {
    const last = lastDoneISO(jobs, elevator.id, kind);
    const base = last || elevator.startISO || today;
    const due = addDays(base, cycles[kind]);
    const status = statusOf(due, today, warnDays);
    kinds[kind] = { last, due, status };
    if (status === 'red') {
      worst = 'red';
      if (!earliestRed || due < earliestRed) earliestRed = due;
    } else if (status === 'yellow' && worst !== 'red') {
      worst = 'yellow';
    }
  }
  return { kinds, worst, earliestRed };
}

/** 建议本次落单类别：逾期/临期的最深层类别优先（一次深层保养覆盖其下层欠账） */
export function suggestKind(schedule) {
  for (const kind of ['yearly', 'halfyear', 'quarter', 'half']) {
    const s = schedule.kinds[kind].status;
    if (s === 'red' || s === 'yellow') return kind;
  }
  return 'half';
}

/** 全量排班队列：逾期优先、临期次之、组内按最早到期日升序 */
export function queue(elevators, jobs, cycles, today, warnDays = 7) {
  const rows = [];
  for (const e of elevators) {
    if (e.active === false) continue;
    const sched = scheduleFor(e, jobs, cycles, today, warnDays);
    rows.push({ elevator: e, schedule: sched, suggest: suggestKind(sched) });
  }
  const order = { red: 0, yellow: 1, green: 2 };
  rows.sort((a, b) => {
    if (order[a.schedule.worst] !== order[b.schedule.worst]) {
      return order[a.schedule.worst] - order[b.schedule.worst];
    }
    const da = a.schedule.earliestRed || a.schedule.kinds.half.due;
    const db = b.schedule.earliestRed || b.schedule.kinds.half.due;
    return da < db ? -1 : da > db ? 1 : 0;
  });
  return rows;
}

// ---------------------------------------------------------------------------
// 落单（维保记录）与签字确认链
// ---------------------------------------------------------------------------

let SEQ = 0;
/** 单号：VB-日期-当日序号（同一天内递增，进程内计数器，测试可重置） */
export function makeJobNo(dateISO) {
  assertISO(dateISO);
  SEQ += 1;
  return `VB-${dateISO.replaceAll('-', '')}-${String(SEQ).padStart(3, '0')}`;
}
export function resetJobSeq() { SEQ = 0; }

/**
 * 落单门禁（红线）：
 * - 电梯必须存在且在保（active）
 * - 维保人员必须在册（作业人员持证口径，证件到期由体检点名、不阻止落单）
 * - 不能预录未来日期
 * - 异常项（ok=false）必须填写处置说明——「发现异常不给说法，等于没做」
 * - 自行检查必须填写检查人与审核人（T5002 第五条(九)签字口径）
 * - 补录（落单日期早于创建日期）如实打标，不伪装成当日记录
 */
export function assertJob(job, state, nowISO) {
  if (!job || typeof job !== 'object') throw new Error('落单不能为空');
  const elev = state.elevators.find((e) => e.id === job.elevatorId);
  if (!elev) throw new Error('电梯不存在');
  if (elev.active === false) throw new Error('该电梯已停保，不能落单');
  if (!JOB_KINDS[job.kind]) throw new Error(`非法保养类别: ${job.kind}`);
  assertISO(job.dateISO);
  if (job.dateISO > nowISO) throw new Error('不能预录未来日期的维保单');
  const worker = state.workers.find((w) => w.id === job.workerId);
  if (!worker) throw new Error('维保人员必须在册（作业人员持证口径）');
  if (!Array.isArray(job.items) || job.items.length === 0) throw new Error('保养项目不能为空');
  for (const it of job.items) {
    if (it.ok === false && (!it.note || !String(it.note).trim())) {
      throw new Error(`异常项「${it.label}」必须填写处置说明`);
    }
  }
  if (job.kind === 'selfcheck') {
    if (!job.checker || !String(job.checker).trim()) throw new Error('自行检查必须填写检查人');
    if (!job.reviewer || !String(job.reviewer).trim()) throw new Error('自行检查必须填写审核人');
  }
  return true;
}

export function registerJob(state, job, nowISO = todayISO()) {
  assertJob(job, state, nowISO);
  const full = {
    ...job,
    no: job.no || makeJobNo(job.dateISO),
    backfill: job.dateISO < nowISO,
    confirmedBy: null,
    confirmedISO: null,
    createdAt: nowISO,
  };
  return { ...state, jobs: [...state.jobs, full] };
}

/** 撤销落单：账目为流水派生，删除即精确回滚 */
export function removeJob(state, jobId) {
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) throw new Error('落单不存在');
  return { ...state, jobs: state.jobs.filter((j) => j.id !== jobId) };
}

/**
 * 签字确认（TSG T5002-2017 第七条：维保记录应当经使用单位安全管理人员签字确认）。
 * 首次确认后不可覆盖（第十条「保存过程中不得更改」口径下宁可重开不可洗账）；
 * 确认日期不得早于落单日期。
 */
export function confirmJob(state, jobId, by, dateISO) {
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('落单不存在');
  if (!by || !String(by).trim()) throw new Error('确认人必填（使用单位安全管理人员）');
  assertISO(dateISO);
  if (dateISO < job.dateISO) throw new Error('确认日期不能早于维保日期');
  if (job.confirmedBy) throw new Error('该单已确认，不可重复确认——如需更正请撤销后重开');
  return {
    ...state,
    jobs: state.jobs.map((j) => (j.id === jobId ? { ...j, confirmedBy: String(by).trim(), confirmedISO: dateISO } : j)),
  };
}

/** 待签字确认的单（确认链断点点名） */
export function pendingConfirm(state) {
  return state.jobs
    .filter((j) => !j.confirmedBy)
    .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
}

// ---------------------------------------------------------------------------
// 应急（救援时钟）
// ---------------------------------------------------------------------------

export function assertIncident(inc) {
  if (!inc || typeof inc !== 'object') throw new Error('应急记录不能为空');
  if (!inc.elevatorId) throw new Error('电梯必选');
  if (!inc.kind || !['trapped', 'fault'].includes(inc.kind)) throw new Error('类别必须为困人或故障');
  assertISO(inc.reportDate); assertHM(inc.reportTime);
  if (inc.arriveDate) { assertISO(inc.arriveDate); assertHM(inc.arriveTime); }
  if (inc.fixedDate) { assertISO(inc.fixedDate); assertHM(inc.fixedTime); }
  return inc;
}

/**
 * 救援时钟：接报 → 到场 → 处置完成。
 * 口径参数化：直辖市/设区的市 30 分钟、其他地区一般不超过 1 小时（T5002 第五条(四)），
 * 属地要求永远赢。超时一旦发生如实保留（closed_over 不可洗账），处置完成前一直计时。
 */
export function clockOf(inc, settings, now = { dateISO: todayISO(), time: '23:59' }) {
  const limit = settings.areaType === 'city' ? settings.rescueCityMin : settings.rescueOtherMin;
  const end = inc.arriveDate
    ? { d: inc.arriveDate, t: inc.arriveTime }
    : { d: now.dateISO, t: now.time };
  const minutes = diffMinutes(inc.reportDate, inc.reportTime, end.d, end.t);
  if (!inc.arriveDate) {
    return { stage: 'report', limit, minutes, status: minutes > limit ? 'open_over' : 'open' };
  }
  if (!inc.fixedDate) {
    return { stage: 'arrive', limit, minutes, status: minutes > limit ? 'closed_over' : 'arrived_open' };
  }
  return { stage: 'done', limit, minutes, status: minutes > limit ? 'closed_over' : 'closed_ok' };
}

/** 应急台账状态行（open 的单永远在点名） */
export function openIncidents(state, now) {
  return state.incidents.filter((i) => {
    const c = clockOf(i, state.settings, now);
    return c.stage !== 'done';
  });
}

// ---------------------------------------------------------------------------
// 周期任务：应急演练 / 人员证 / 定期检验与自行检查
// ---------------------------------------------------------------------------

/** 应急演练：每半年至少按本单位维保的电梯类别各一次（T5002 第五条(三)） */
export function drillRows(state, today) {
  const kinds = [...new Set(state.elevators.filter((e) => e.active !== false).map((e) => e.kind))];
  return kinds.map((kind) => {
    const last = state.drills
      .filter((d) => d.kind === kind)
      .map((d) => d.dateISO)
      .sort()
      .pop();
    if (!last) return { kind, last: null, due: null, status: 'red' };
    const due = addDays(last, state.settings.drillIntervalDays);
    return { kind, last, due, status: statusOf(due, today, state.settings.drillWarnDays) };
  });
}

/** 作业人员证到期（黄线 60 天参数化） */
export function certRows(state, today) {
  return state.workers.map((w) => {
    if (!w.certValidUntil) return { worker: w, validUntil: null, days: null, status: 'none' };
    const days = daysUntil(w.certValidUntil, today);
    return {
      worker: w, validUntil: w.certValidUntil, days,
      status: days < 0 ? 'red' : days <= state.settings.certWarnDays ? 'yellow' : 'green',
    };
  });
}

/** 定期检验到期（黄线 30 天参数化） */
export function inspectionRows(state, today) {
  return state.elevators
    .filter((e) => e.active !== false)
    .map((e) => {
      if (!e.nextInspectionISO) return { elevator: e, due: null, status: 'none' };
      return { elevator: e, due: e.nextInspectionISO, status: statusOf(e.nextInspectionISO, today, state.settings.inspectionWarnDays) };
    });
}

/** 年度自行检查门：定期检验窗口临近（45 天参数化）而近一年无自行检查记录 → 亮灯 */
export function selfcheckRows(state, today) {
  return inspectionRows(state, today).filter((r) => r.due).map((r) => {
    const last = state.jobs
      .filter((j) => j.elevatorId === r.elevator.id && j.kind === 'selfcheck')
      .map((j) => j.dateISO)
      .sort()
      .pop();
    const windowNear = daysUntil(r.due, today) <= state.settings.selfcheckLeadDays;
    return {
      elevator: r.elevator, due: r.due, last,
      status: windowNear && !last ? 'red' : 'green',
    };
  });
}

// ---------------------------------------------------------------------------
// 应收维保费（月账）
// ---------------------------------------------------------------------------

export function recordPayment(state, { elevatorId, month, amount, paidISO }) {
  const elev = state.elevators.find((e) => e.id === elevatorId);
  if (!elev) throw new Error('电梯不存在');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('非法月份');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('收款金额必须为正整数（元）');
  assertISO(paidISO);
  return { ...state, payments: [...state.payments, { id: `pay_${state.payments.length + 1}_${elevatorId}`, elevatorId, month, amount, paidISO }] };
}

/** 某月应收/已收/欠费（活跃电梯按月费全额计收，部分收款如实相抵） */
export function feeRows(state, month) {
  return state.elevators
    .filter((e) => e.active !== false)
    .map((e) => {
      const fee = e.monthlyFee || 0;
      const paid = state.payments
        .filter((p) => p.elevatorId === e.id && p.month === month)
        .reduce((s, p) => s + p.amount, 0);
      return { elevator: e, fee, paid, owed: Math.max(0, fee - paid) };
    });
}

export function monthlyAccount(state, month) {
  const fees = feeRows(state, month);
  const billed = fees.reduce((s, r) => s + r.fee, 0);
  const paid = fees.reduce((s, r) => s + r.paid, 0);
  const jobsThisMonth = state.jobs.filter((j) => monthKey(j.dateISO) === month && j.kind !== 'selfcheck');
  const confirmed = jobsThisMonth.filter((j) => j.confirmedBy).length;
  return {
    month,
    activeCount: state.elevators.filter((e) => e.active !== false).length,
    billed, paid, owed: billed - paid,
    oweRows: fees.filter((r) => r.owed > 0),
    jobCount: jobsThisMonth.length,
    confirmRate: jobsThisMonth.length ? Math.round((confirmed / jobsThisMonth.length) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// 体检（七项打分）
// ---------------------------------------------------------------------------

/**
 * 七项体检：保养逾期 / 确认缺签 / 救援超时 / 检验与自行检查 / 人员证 / 应急演练 / 应收欠费。
 * 前六项是合规项，欠费是经营项（如实单列，不与合规混装）。
 */
export function selfCheck(state, now = { dateISO: todayISO(), time: '23:59' }) {
  const today = now.dateISO;
  const items = [];

  const q = queue(state.elevators, state.jobs, state.settings.cycles, today, state.settings.warnDays);
  const overdue = q.filter((r) => r.schedule.worst === 'red');
  items.push({
    key: 'overdue', label: '保养逾期（未按规定维保的直接暴露）',
    count: overdue.length, level: overdue.length ? 'red' : 'green',
    offenders: overdue.map((r) => `${r.elevator.site} · ${r.elevator.name}`),
  });

  const pend = pendingConfirm(state);
  items.push({
    key: 'confirm', label: '维保单缺使用单位签字确认（T5002 第七条）',
    count: pend.length, level: pend.length ? 'red' : 'green',
    offenders: pend.slice(0, 20).map((j) => `${j.no} @ ${j.dateISO}`),
  });

  const rescues = state.incidents
    .map((i) => ({ i, c: clockOf(i, state.settings, now) }))
    .filter((r) => r.c.status === 'open_over' || r.c.status === 'closed_over');
  items.push({
    key: 'rescue', label: '救援超时或未闭环（24h 值班与到场时限）',
    count: rescues.length, level: rescues.length ? 'red' : 'green',
    offenders: rescues.map((r) => `${r.i.elevatorId} · 已 ${r.c.minutes} 分`),
  });

  const inspRed = inspectionRows(state, today).filter((r) => r.status === 'red');
  const scRed = selfcheckRows(state, today).filter((r) => r.status === 'red');
  const inspOff = [
    ...inspRed.map((r) => `${r.elevator.site} · ${r.elevator.name} 检验已过期`),
    ...scRed.map((r) => `${r.elevator.site} · ${r.elevator.name} 检验临近未自行检查`),
  ];
  items.push({
    key: 'inspection', label: '定期检验过期或自行检查未做（T5002 第五条(九)）',
    count: inspOff.length, level: inspOff.length ? 'red' : 'green',
    offenders: inspOff,
  });

  const certRed = certRows(state, today).filter((r) => r.status === 'red');
  items.push({
    key: 'cert', label: '作业人员证已过期（持证上岗口径）',
    count: certRed.length, level: certRed.length ? 'red' : 'green',
    offenders: certRed.map((r) => `${r.worker.name} · ${r.validUntil}`),
  });

  const drillRed = drillRows(state, today).filter((r) => r.status === 'red');
  items.push({
    key: 'drill', label: '应急演练缺项（每半年按类别）',
    count: drillRed.length, level: drillRed.length ? 'red' : 'green',
    offenders: drillRed.map((r) => (r.last ? `${ELEV_KINDS[r.kind].label} 已逾期` : `${ELEV_KINDS[r.kind].label} 从未演练`)),
  });

  const month = monthKey(today);
  const owe = feeRows(state, month).filter((r) => r.owed > 0);
  items.push({
    key: 'fee', label: `本月维保费欠收（经营项，${month}）`,
    count: owe.length, level: owe.length ? 'yellow' : 'green',
    offenders: owe.map((r) => `${r.elevator.site} · ${r.elevator.name} 欠 ${r.owed} 元`),
  });

  const redCount = items.filter((i) => i.level === 'red').reduce((s, i) => s + i.count, 0);
  const yellowCount = items.filter((i) => i.level === 'yellow').reduce((s, i) => s + i.count, 0);
  const score = Math.max(0, 100 - redCount * 10 - yellowCount * 2);
  return { items, score, redCount, yellowCount };
}

// ---------------------------------------------------------------------------
// 出证三通道：微信文本 / 打印版单文件 HTML / 直接打印
// ---------------------------------------------------------------------------

/** 维保确认单 · 微信文本（发使用单位安全管理人员，回复确认或签字回传） */
export function confirmText(job, elevator, worker, company) {
  const kindLabel = JOB_KINDS[job.kind].label;
  const abns = job.items.filter((i) => i.ok === false);
  const lines = [
    `【维保确认单】${job.no}`,
    `电梯：${elevator.name}（设备代码 ${elevator.code}）`,
    `使用单位：${elevator.site}`,
    `维保日期：${job.dateISO}`,
    `维保类别：${kindLabel}${job.backfill ? '（补录）' : ''}`,
    `维保人员：${worker ? worker.name : job.workerId}${worker && worker.certNo ? `（证号 ${worker.certNo}）` : ''}`,
    `项目：共 ${job.items.length} 项，正常 ${job.items.length - abns.length} 项${abns.length ? '' : '，无异常'}`,
  ];
  if (abns.length) {
    lines.push('异常与处置：');
    abns.forEach((a, i) => lines.push(`${i + 1}. ${a.label} —— ${a.note}`));
  }
  if (job.kind === 'selfcheck') lines.push(`检查人：${job.checker} · 审核人：${job.reviewer}`);
  if (company && company.name) lines.push(`维保单位：${company.name}${company.phone ? ` · 24h 值班电话 ${company.phone}` : ''}`);
  lines.push('请使用单位安全管理人员签字确认：＿＿＿＿＿ 日期：＿＿＿＿＿');
  lines.push('（TSG T5002-2017 第七条：维保记录应当经使用单位安全管理人员签字确认）');
  return lines.join('\n');
}

/** 维保确认单 · 打印版单文件 HTML（含签字栏） */
export function confirmHtml(job, elevator, worker, company) {
  const kindLabel = JOB_KINDS[job.kind].label;
  const esc = escapeHtml;
  const rows = job.items.map((i) => `
    <tr><td>${esc(i.label)}</td><td class="${i.ok ? 'ok' : 'bad'}">${i.ok ? '正常' : '异常'}</td><td>${esc(i.note || '')}</td></tr>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>维保确认单 ${esc(job.no)}</title>
<style>
body{font-family:"Songti SC","SimSun",serif;margin:24px;color:#111;font-size:13px}
h1{font-size:18px;margin:0 0 4px} .sub{color:#555;margin-bottom:12px;font-size:12px}
table{width:100%;border-collapse:collapse;margin:8px 0}
td,th{border:1px solid #999;padding:4px 6px;text-align:left;font-size:12px}
.ok{color:#166534}.bad{color:#b91c1c;font-weight:700}
.meta td{border:none;padding:2px 0}
.sign{margin-top:36px;display:flex;gap:48px;font-size:13px}
.sign div{flex:1}
.foot{margin-top:24px;color:#777;font-size:11px;line-height:1.6}
@media print{.noprint{display:none}}
</style></head><body>
<h1>电梯维护保养确认单</h1>
<div class="sub">单号 ${esc(job.no)}${job.backfill ? ' · 补录单（落单日期晚于维保日期，如实标注）' : ''}</div>
<table class="meta">
<tr><td>电梯</td><td>${esc(elevator.name)}（设备代码 ${esc(elevator.code)} · ${esc(ELEV_KINDS[elevator.kind].label)}）</td></tr>
<tr><td>使用单位 / 地点</td><td>${esc(elevator.site)}${elevator.addr ? ` · ${esc(elevator.addr)}` : ''}</td></tr>
<tr><td>维保日期 / 类别</td><td>${esc(job.dateISO)} · ${esc(kindLabel)}</td></tr>
<tr><td>维保人员</td><td>${esc(worker ? worker.name : String(job.workerId))}${worker && worker.certNo ? `（特种设备作业人员证 ${esc(worker.certNo)}）` : ''}</td></tr>
${company && company.name ? `<tr><td>维保单位</td><td>${esc(company.name)}${company.phone ? ` · 24h 值班电话 ${esc(company.phone)}` : ''}</td></tr>` : ''}
</table>
<table><thead><tr><th>维保项目（据 TSG T5002-2017 附件预填，可增删）</th><th>结果</th><th>异常与处置说明</th></tr></thead>
<tbody>${rows}</tbody></table>
${job.kind === 'selfcheck' ? `<p>检查人：${esc(job.checker)} · 审核人：${esc(job.reviewer)}（年度自行检查在定期检验前完成）</p>` : ''}
<div class="sign"><div>维保人员签字：＿＿＿＿＿＿</div><div>使用单位安全管理人员签字：＿＿＿＿＿＿ 日期：＿＿＿＿＿＿</div></div>
<div class="foot">依据 TSG T5002-2017《电梯维护保养规则》：维保记录应当经使用单位安全管理人员签字确认，并至少保存 4 年。本单为维保单位自持底账与确认凭据，不替代法定报送，事故责任认定以监管与司法机关认定为准。</div>
</body></html>`;
}

/** 迎检打印包（按使用单位）：档案 + 维保台账 + 应急记录，单文件 HTML */
export function packHtml(state, site, nowISO = todayISO()) {
  const esc = escapeHtml;
  const elevators = state.elevators.filter((e) => e.site === site);
  const ids = new Set(elevators.map((e) => e.id));
  const jobs = state.jobs.filter((j) => ids.has(j.elevatorId)).sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  const incs = state.incidents.filter((i) => ids.has(i.elevatorId));
  const check = selfCheck(state, { dateISO: nowISO, time: '23:59' });
  const workerName = (id) => { const w = state.workers.find((x) => x.id === id); return w ? w.name : String(id); };

  const archRows = elevators.map((e) => {
    const sched = scheduleFor(e, state.jobs, state.settings.cycles, nowISO);
    return `<tr><td>${esc(e.name)}</td><td>${esc(e.code)}</td><td>${esc(ELEV_KINDS[e.kind].label)}</td>
    <td>${e.nextInspectionISO ? esc(e.nextInspectionISO) : '—'}</td>
    <td>${sched.kinds.half.last ? esc(sched.kinds.half.last) : '无记录'}</td>
    <td>${{ red: '逾期', yellow: '临期', green: '正常' }[sched.worst]}</td></tr>`;
  }).join('');

  const jobRows = jobs.map((j) => {
    const abns = j.items.filter((i) => i.ok === false);
    return `<tr><td>${esc(j.no)}</td><td>${esc(state.elevators.find((e) => e.id === j.elevatorId)?.name || j.elevatorId)}</td>
    <td>${esc(j.dateISO)}</td><td>${esc(JOB_KINDS[j.kind].label)}${j.backfill ? '<br>（补录）' : ''}</td>
    <td>${esc(workerName(j.workerId))}</td><td>${j.items.length} 项 / 异常 ${abns.length}</td>
    <td>${j.confirmedBy ? `${esc(j.confirmedBy)} ${esc(j.confirmedISO)}` : '<b>待签字</b>'}</td></tr>`;
  }).join('') || '<tr><td colspan="7">本使用单位暂无维保记录</td></tr>';

  const incRows = incs.map((i) => {
    const c = clockOf(i, state.settings, { dateISO: nowISO, time: '23:59' });
    return `<tr><td>${esc(state.elevators.find((e) => e.id === i.elevatorId)?.name || i.elevatorId)}</td>
    <td>${esc(i.reportDate)} ${esc(i.reportTime)}</td><td>${i.kind === 'trapped' ? '困人' : '故障'}</td>
    <td>${c.minutes === null ? '—' : `${c.minutes} 分`}</td>
    <td>${{ open: '处置中', open_over: '处置中（已超时限）', arrived_open: '已到场处置中', closed_ok: '已闭环', closed_over: '已闭环（到场超时限）' }[c.status]}</td></tr>`;
  }).join('') || '<tr><td colspan="5">本使用单位暂无应急记录</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>电梯维保迎检包 · ${esc(site)}</title>
<style>
body{font-family:"Songti SC","SimSun",serif;margin:24px;color:#111;font-size:13px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px;border-bottom:2px solid #333;padding-bottom:4px}
.sub{color:#555;margin-bottom:12px;font-size:12px}
table{width:100%;border-collapse:collapse;margin:8px 0}
td,th{border:1px solid #999;padding:4px 6px;text-align:left;font-size:12px}
.foot{margin-top:24px;color:#777;font-size:11px;line-height:1.6}
.sign{margin-top:32px;display:flex;gap:48px}
</style></head><body>
<h1>电梯维保台账 · 迎检包</h1>
<div class="sub">使用单位：${esc(site)} · 生成时间 ${esc(nowISO)} · 维保单位：${esc(state.company.name || '＿＿＿＿')}${state.company.phone ? ` · 24h 值班电话 ${esc(state.company.phone)}` : ''}</div>
<h2>一、在保电梯档案</h2>
<table><thead><tr><th>内编号</th><th>设备代码</th><th>品种</th><th>下次检验</th><th>最近半月保</th><th>排班状态</th></tr></thead><tbody>${archRows}</tbody></table>
<h2>二、维保记录台账（TSG T5002-2017 第七条，保存不少于 4 年）</h2>
<table><thead><tr><th>单号</th><th>电梯</th><th>日期</th><th>类别</th><th>人员</th><th>项目</th><th>使用单位签字确认</th></tr></thead><tbody>${jobRows}</tbody></table>
<h2>三、故障与应急救援记录（第五条(四)(五)：24h 值班 · 详细记录）</h2>
<table><thead><tr><th>电梯</th><th>接报</th><th>类别</th><th>接报到场用时</th><th>状态</th></tr></thead><tbody>${incRows}</tbody></table>
<h2>四、合规体检（生成时点）</h2>
<p>体检得分 <b>${check.score}</b>/100，红灯项 ${check.redCount} 个${check.redCount ? '（明细以工具内体检页为准并应整改后重新出包）' : '，七项全绿'}</p>
<div class="sign"><div>维保单位（盖章）：＿＿＿＿＿＿</div><div>使用单位安全管理人员：＿＿＿＿＿＿ 日期：＿＿＿＿＿＿</div></div>
<div class="foot">本包由维保单位自持台账生成，供自查与迎检备查；不替代法定报送与监管系统数据，事故责任认定以监管与司法机关认定为准。保养项目预填据 TSG T5002-2017 附件整理为关键子集，全量项目以规则原文为准。</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// 事件流（HDD 埋点）与备份
// ---------------------------------------------------------------------------

export function logEvent(state, type, payload = {}, nowISO = todayISO()) {
  const events = [...state.events, { type, payload, at: nowISO }].slice(-500);
  return { ...state, events };
}

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'lift-sheet', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

export function importBundle(raw) {
  let obj;
  try { obj = JSON.parse(raw); } catch { throw new Error('备份文件不是合法 JSON'); }
  if (obj.app !== 'lift-sheet') throw new Error('不是梯保单的备份文件');
  if (obj.version !== STATE_VERSION) throw new Error(`备份版本不兼容（${obj.version} ≠ ${STATE_VERSION}）`);
  return { ...emptyStateFields(), ...obj.state };
}

/** 空状态字段清单（store.js 用同一来源组装） */
export function emptyStateFields() {
  return {
    version: STATE_VERSION,
    company: { name: '', phone: '' },
    elevators: [],
    workers: [],
    jobs: [],
    incidents: [],
    drills: [],
    payments: [],
    settings: {
      cycles: { ...CYCLE_DEFAULTS },
      warnDays: 7,
      areaType: 'city',
      rescueCityMin: 30,
      rescueOtherMin: 60,
      inspectionWarnDays: 30,
      certWarnDays: 60,
      drillIntervalDays: 183,
      drillWarnDays: 30,
      selfcheckLeadDays: 45,
    },
    events: [],
  };
}
