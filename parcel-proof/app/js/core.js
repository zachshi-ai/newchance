/**
 * core.js — 递安单 ParcelProof 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；金额一律整数「分」运算；日期统一 ISO 字符串
 * yyyy-mm-dd；所有周期与时限参数（答复时限/销毁周期/义务周期/预警窗）均可在设置中被网点覆盖。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md，全部为现行版条号）：
 * - 《中华人民共和国快递暂行条例》（2018 年国务院令第 697 号公布，2025-04-13 国务院令第 806 号
 *   第二次修订，2025-06-01 施行）：
 *   第 19 条：快递末端网点自开办之日起 20 日内向所在地邮政管理部门备案，无需办理营业执照；
 *   第 20 条：统一商标/字号/运单经营的各企业应实行统一管理、提供统一投诉处理服务（加盟链连坐的法理）；
 *   第 21 条：对从业人员加强安全生产等教育和培训；第 23 条：查验并登记寄件人身份，拒绝或不实不得收寄；
 *   第 29 条：用户投诉自接到之日起 7 日内处理并告知用户；第 32 条：验视内件并作出验视标识，拒绝验视不得收寄；
 *   第 33 条：安全检查并作出安检标识；第 34 条：发现禁寄物品拒绝收寄、在途疑似禁寄立即停止分拣运输投递并报告；
 *   第 35 条：建立运单及电子数据管理制度、定期销毁快递运单、不得出售泄露用户信息、泄露立即补救并报告；
 *   第 36 条：建立安全生产责任制、应急预案并定期演练；
 *   第 46 条：监督检查重点=安全管理制度有效实施+投诉妥善处理（迎检自证包的对口条款）；
 *   第 50 条（未备案 1 万以下/情节 1 万~5 万+停业）、第 51 条（未统一管理 1 万~10 万+停业）、
 *   第 53 条（不执行验视/实名/安检，转致邮政法与反恐法处罚）、第 54 条（未定期销毁运单、泄露信息 1 万~10 万+停业直至吊证）。
 * - 《中华人民共和国反恐怖主义法》（2018 修正）第 20 条：邮政快递等物流运营单位实行安全查验制度、
 *   查验客户身份、安检或开封验视；第 85 条：拒不改正处 10 万~50 万元罚款，责任人另处 10 万元以下。
 * - 《快递市场管理办法》（交通运输部令 2023 年第 22 号，2024-03-01 施行）第 30 条：企业应建立投诉申诉处理
 *   制度，依法处理邮政管理部门转告的申诉事项并反馈结果；第 31、32 条：安全培训与三项制度。
 * - 《高层民用建筑消防安全管理规定》（应急管理部令第 5 号）第 37 条：禁止在公共门厅、疏散走道、楼梯间、
 *   安全出口停放电动自行车或充电（拒不改正：经营性 2000~10000 元）。
 * 本工具是末端网点侧的自证台账，不构成法律意见，不替代法定报送与执法认定；属地规则与品牌制度永远赢。
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

/** 金额：整数分 → 「¥1290.00」 */
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
// 口径常量（法定口径的参数化，属地规则与品牌制度永远赢）
// ---------------------------------------------------------------------------

/** 拦截/拒绝收寄原因（条例第 23、32、34 条情形的现场归类） */
export const REJECT_REASONS = {
  'refuse-verify': '拒绝验视',
  'id-fake': '拒绝实名或身份不实',
  prohibited: '疑似禁寄物品',
  other: '其他',
};

/** 拦截处置方式（条例第 34 条：拒绝收寄/报告有关部门） */
export const INTERCEPT_ACTIONS = {
  return: '当场退回寄件人',
  'report-post': '报告邮政管理部门',
  'report-mps': '报告公安机关',
  hold: '暂存待处理',
  other: '其他',
};

/** 投诉来源渠道（条例第 29 条 / 管理办法第 30 条） */
export const COMPLAINT_CHANNELS = {
  counter: '用户现场或来电',
  hq: '总部考核/客服转来',
  '12305': '12305 申诉转办',
  other: '其他',
};

/** 投诉处理结果 */
export const COMPLAINT_RESULTS = {
  resolved: '已解决',
  explained: '已解释沟通',
  unresolved: '未能解决',
  other: '其他',
};

/** 考核罚款申诉结果（品牌考核规则的网点侧登记口径） */
export const FINE_OUTCOMES = {
  pending: '待申诉/待处理',
  overturn: '申诉成立·全额撤销',
  partial: '部分减免',
  sustain: '维持原罚',
};

/** 底单销毁方式（条例第 35 条「定期销毁」的现场落实） */
export const DESTROY_WAYS = {
  shred: '碎纸/机械销毁',
  burn: '焚烧销毁',
  recycle: '交合规回收处理',
  other: '其他',
};

/** 周期义务（周期为参数化默认值，属地与品牌制度永远赢） */
export const DUTY_KINDS = {
  training: { label: '安全教育培训', cycleDays: 90, basis: '《快递暂行条例》第二十一条' },
  drill: { label: '应急演练', cycleDays: 365, basis: '《快递暂行条例》第三十六条' },
  fire: { label: '消防器材检查', cycleDays: 30, basis: '行业通识口径，属地要求永远赢' },
  battery: { label: '车辆与电池充电检查', cycleDays: 30, basis: '应急部令第 5 号第三十七条场景自查' },
};

/** 投诉答复时限：自接到投诉之日起 7 日内处理并告知用户（条例第 29 条，可被设置覆盖但不得放宽） */
export const DEFAULT_REPLY_DAYS = 7;
/** 底单销毁周期默认值（条例第 35 条只规定「定期」，90 天为通识先验，可覆盖） */
export const DEFAULT_DESTROY_DAYS = 90;
/** 备案红线：开办之日起 20 日内备案（条例第 19 条） */
export const FILING_DEADLINE_DAYS = 20;
/** 断更判定：连续 N 天无日落账进入点名（默认） */
export const DEFAULT_GAP_DAYS = 7;

// ---------------------------------------------------------------------------
// 备案钟（条例第 19 条：开办之日起 20 日内备案；罚则第 50 条）
// ---------------------------------------------------------------------------

/**
 * 备案状态。openedISO 未填 → unset（红灯提示先建档）；
 * filed=true → ok（附备案编号与备案日）；否则按开办日 + 20 天红线倒计时。
 */
export function filingState(station, todayISOStr, warnDays = 7) {
  assertISO(todayISOStr);
  if (!station?.openedISO) return { level: 'unset', detail: '未填开办日期——先补建档信息' };
  if (station.filed) return { level: 'ok', detail: `已备案${station.fileNo ? `（${station.fileNo}）` : ''}${station.filedISO ? ` · 备案日 ${station.filedISO}` : ''}` };
  const deadline = addDays(station.openedISO, FILING_DEADLINE_DAYS);
  const daysLeft = daysUntil(deadline, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= warnDays ? 'due' : 'ok';
  return { level, deadline, daysLeft, detail: `开办日 ${station.openedISO}，备案期限 ${deadline}` };
}

// ---------------------------------------------------------------------------
// 每日三项制度落账（验视 / 实名 / 安检三确认，同日唯一）
// ---------------------------------------------------------------------------

/**
 * 写一笔日落账。routine: { dateISO, inbound, verifyOk, realnameOk, security, note }
 * - inbound：当日收寄件数（整数，可 0——纯派件日也允许落账留痕）
 * - verifyOk / realnameOk：当日收寄均执行验视 / 均查验实名（布尔，如实勾选，假确认骗不了倒查）
 * - security：'done' 已执行安检并标识 / 'none' 本网点无安检设备（安检在处理中心或委托第三方）
 * 同一日期重复落账拒绝（当日唯一，配合补录如实打标）。
 */
export function addRoutine(state, { dateISO, inbound = 0, verifyOk = true, realnameOk = true, security = 'none', note = '' }) {
  assertISO(dateISO);
  if (!Number.isInteger(inbound) || inbound < 0) throw new Error(`收寄件数必须为非负整数: ${inbound}`);
  if (typeof verifyOk !== 'boolean' || typeof realnameOk !== 'boolean') throw new Error('验视/实名确认为布尔值');
  if (!['done', 'none'].includes(security)) throw new Error(`非法安检状态: ${security}`);
  if ((state.routines ?? []).some((r) => r.dateISO === dateISO)) {
    throw new Error(`${dateISO} 已有落账（同日唯一）；如需更正请先删除原记录`);
  }
  state.routineSeq = (state.routineSeq ?? 0) + 1;
  const rec = { id: `rt-${state.routineSeq}`, dateISO, inbound, verifyOk, realnameOk, security, note };
  state.routines.push(rec);
  return rec;
}

/** 删除日落账（记错的网点能自救；开放更正比逼人记假账更诚实） */
export function removeRoutine(state, routineId) {
  const idx = (state.routines ?? []).findIndex((r) => r.id === routineId);
  if (idx < 0) throw new Error(`落账记录不存在: ${routineId}`);
  state.routines.splice(idx, 1);
}

/** 最近一次落账日期（无落账返回 null） */
export function lastRoutineISO(state) {
  const dates = (state.routines ?? []).map((r) => r.dateISO).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** 断更天数：今天距最近一次落账的天数；从未落账返回 null */
export function routineGapDays(state, todayISOStr) {
  assertISO(todayISOStr);
  const last = lastRoutineISO(state);
  return last === null ? null : daysUntil(last, todayISOStr) * -1;
}

/** 未执行确认的落账日（验视或实名勾了「未执行」）——倒查时最重的一类缺口 */
export function unconfirmedRoutines(state) {
  return (state.routines ?? [])
    .filter((r) => !r.verifyOk || !r.realnameOk)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

// ---------------------------------------------------------------------------
// 拦截登记簿（拒收与问题件：条例第 23/32/34 条情形的现场痕迹）
// ---------------------------------------------------------------------------

/**
 * 登记一笔拦截/拒绝收寄。intercept: { dateISO, person, item, reason, action, note }
 * person 建议只登记姓氏或尾号等最小披露信息（只存本机）。
 * 拦截未处置（action 为暂存/报告类）必须闭环销案：closedISO + result。
 */
export function addIntercept(state, { dateISO, person = '', item = '', reason = 'other', action = 'return', note = '' }) {
  assertISO(dateISO);
  if (!REJECT_REASONS[reason]) throw new Error(`非法拦截原因: ${reason}`);
  if (!INTERCEPT_ACTIONS[action]) throw new Error(`非法处置方式: ${action}`);
  state.interceptSeq = (state.interceptSeq ?? 0) + 1;
  const rec = { id: `ic-${state.interceptSeq}`, dateISO, person, item, reason, action, note, closedISO: null, result: '' };
  state.intercepts.push(rec);
  return rec;
}

/** 闭环销案：填处置结果。闭环日期不得早于登记日；重复闭环拒绝 */
export function closeIntercept(state, interceptId, { closedISO, result = '' } = {}) {
  const rec = (state.intercepts ?? []).find((x) => x.id === interceptId);
  if (!rec) throw new Error(`拦截记录不存在: ${interceptId}`);
  if (rec.closedISO) throw new Error('该拦截已闭环销案');
  assertISO(closedISO);
  if (closedISO < rec.dateISO) throw new Error('闭环日期早于登记日期');
  rec.closedISO = closedISO;
  rec.result = result;
  return rec;
}

/** 未闭环拦截：最老的在前（挂账越久越是检查的第一问） */
export function openIntercepts(state) {
  return (state.intercepts ?? [])
    .filter((x) => !x.closedISO)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// 投诉台账（条例第 29 条：自接到投诉之日起 7 日内处理并告知用户）
// ---------------------------------------------------------------------------

/**
 * 登记一笔投诉。complaint: { dateISO, customer, channel, matter, note }
 * 答复截止日 = 登记日 + settings.replyDays（默认 7 日，条例第 29 条口径）。
 */
export function addComplaint(state, { dateISO, customer = '', channel = 'counter', matter = '', note = '' }) {
  assertISO(dateISO);
  if (!COMPLAINT_CHANNELS[channel]) throw new Error(`非法投诉渠道: ${channel}`);
  state.complaintSeq = (state.complaintSeq ?? 0) + 1;
  const replyDays = state.settings?.replyDays ?? DEFAULT_REPLY_DAYS;
  const rec = {
    id: `cp-${state.complaintSeq}`, dateISO, customer, channel, matter, note,
    replyDueISO: addDays(dateISO, replyDays), replyISO: null, replyWay: '', result: '',
  };
  state.complaints.push(rec);
  return rec;
}

/**
 * 闭环答复。replyISO 晚于答复截止日允许登记但如实打标「超期答复」——
 * 台账的立场是帮认真处理的网点自证，不是帮超期的网点洗账。
 */
export function closeComplaint(state, complaintId, { replyISO, replyWay = '', result = 'resolved', note = '' } = {}) {
  const rec = (state.complaints ?? []).find((x) => x.id === complaintId);
  if (!rec) throw new Error(`投诉记录不存在: ${complaintId}`);
  if (rec.replyISO) throw new Error('该投诉已答复闭环');
  assertISO(replyISO);
  if (replyISO < rec.dateISO) throw new Error('答复日期早于登记日期');
  if (!COMPLAINT_RESULTS[result]) throw new Error(`非法处理结果: ${result}`);
  rec.replyISO = replyISO;
  rec.replyWay = replyWay;
  rec.result = result;
  rec.note = note || rec.note;
  rec.late = replyISO > rec.replyDueISO;
  return rec;
}

/** 未答复投诉：按答复截止日升序（已超期的排最前） */
export function openComplaints(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  return (state.complaints ?? [])
    .filter((c) => !c.replyISO)
    .map((c) => ({ ...c, daysLeft: daysUntil(c.replyDueISO, todayISOStr) }))
    .sort((a, b) => a.replyDueISO.localeCompare(b.replyDueISO) || a.id.localeCompare(b.id));
}

/** 答复达成统计：onTime=7 日内答复数 / late=超期答复 / open=未答复（含已超期） */
export function replyStats(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  const list = state.complaints ?? [];
  const closed = list.filter((c) => c.replyISO);
  return {
    total: list.length,
    onTime: closed.filter((c) => !c.late).length,
    late: closed.filter((c) => c.late).length,
    open: list.length - closed.length,
    overdue: openComplaints(state, todayISOStr).filter((c) => c.daysLeft < 0).length,
  };
}

// ---------------------------------------------------------------------------
// 考核罚款与申诉挽回账（品牌考核规则的网点侧登记口径）
// ---------------------------------------------------------------------------

/**
 * 登记一笔总部考核罚款。fine: { dateISO, no, amountCents, basis, complaintId, note }
 * complaintId 可关联投诉台账（考核罚款多由投诉/申诉考核产生）。
 */
export function addFine(state, { dateISO, no = '', amountCents, basis = '', complaintId = null, note = '' }) {
  assertISO(dateISO);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(`罚款金额必须为正整数分: ${amountCents}`);
  if (complaintId && !(state.complaints ?? []).some((c) => c.id === complaintId)) {
    throw new Error(`关联投诉不存在: ${complaintId}`);
  }
  state.fineSeq = (state.fineSeq ?? 0) + 1;
  const rec = {
    id: `fn-${state.fineSeq}`, dateISO, no, amountCents, basis, complaintId, note,
    appealISO: null, appealNote: '', outcome: 'pending', recoveredCents: 0,
  };
  state.fines.push(rec);
  return rec;
}

/** 登记申诉动作（申诉日与理由；材料单在报表页生成） */
export function appealFine(state, fineId, { appealISO, appealNote = '' } = {}) {
  const rec = (state.fines ?? []).find((x) => x.id === fineId);
  if (!rec) throw new Error(`罚款记录不存在: ${fineId}`);
  assertISO(appealISO);
  if (appealISO < rec.dateISO) throw new Error('申诉日期早于罚款日期');
  rec.appealISO = appealISO;
  rec.appealNote = appealNote;
  return rec;
}

/**
 * 申诉结果落账（一次定案不可覆盖）：
 * - overturn 全额撤销：recovered 必须等于罚款金额；
 * - partial 部分减免：0 < recovered < 罚款金额；
 * - sustain 维持原罚：recovered 必须为 0。
 */
export function settleFine(state, fineId, { outcome, recoveredCents = 0, note = '' } = {}) {
  const rec = (state.fines ?? []).find((x) => x.id === fineId);
  if (!rec) throw new Error(`罚款记录不存在: ${fineId}`);
  if (rec.outcome !== 'pending') throw new Error('该罚款已有申诉结果（一次定案）');
  if (!['overturn', 'partial', 'sustain'].includes(outcome)) throw new Error(`非法申诉结果: ${outcome}`);
  if (!Number.isInteger(recoveredCents) || recoveredCents < 0) throw new Error(`挽回金额必须为非负整数分: ${recoveredCents}`);
  if (outcome === 'overturn' && recoveredCents !== rec.amountCents) {
    throw new Error('全额撤销时挽回金额应等于罚款金额');
  }
  if (outcome === 'partial' && !(recoveredCents > 0 && recoveredCents < rec.amountCents)) {
    throw new Error('部分减免时挽回金额应在 0 与罚款金额之间');
  }
  if (outcome === 'sustain' && recoveredCents !== 0) {
    throw new Error('维持原罚时挽回金额应为 0');
  }
  rec.outcome = outcome;
  rec.recoveredCents = recoveredCents;
  if (note) rec.note = rec.note ? `${rec.note}；${note}` : note;
  return rec;
}

/** 待处理罚款（未落申诉结果）：最老的在前——挽回窗口别错过 */
export function pendingFines(state) {
  return (state.fines ?? [])
    .filter((f) => f.outcome === 'pending')
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

/** 累计挽回金额（整数分） */
export function totalRecovered(state) {
  return (state.fines ?? []).reduce((n, f) => n + (f.recoveredCents || 0), 0);
}

/**
 * 月度罚款与挽回小结：按月份分组，未处理单列。month 形如 '2026-09'；跨年隔离。
 * 返回结构 + 确定性文本（text）。金额口径全部为网点自己登记的品牌考核数字。
 */
export function monthlyRecovery(state, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const list = (state.fines ?? []).filter((f) => monthKey(f.dateISO) === month);
  const fined = list.reduce((n, f) => n + f.amountCents, 0);
  const recovered = list.reduce((n, f) => n + (f.recoveredCents || 0), 0);
  const pending = list.filter((f) => f.outcome === 'pending');
  const byOutcome = {};
  for (const f of list) byOutcome[f.outcome] = (byOutcome[f.outcome] ?? 0) + 1;
  const summary = { month, count: list.length, finedCents: fined, recoveredCents: recovered, pendingCount: pending.length, byOutcome };
  const L = [];
  L.push(`【考核罚款与申诉挽回月账】${month}`);
  if (state.station?.name) L.push(`网点：${state.station.name}`);
  L.push(`罚款 ${summary.count} 笔共 ${fmtYuan(fined)}，已挽回 ${fmtYuan(recovered)}`
    + (summary.pendingCount ? `，待申诉/待处理 ${summary.pendingCount} 笔——挽回窗口别错过` : '，无挂账'));
  const outcomeLine = Object.entries(summary.byOutcome).map(([k, n]) => `${FINE_OUTCOMES[k] ?? k} ${n}`).join('、');
  if (outcomeLine) L.push(`分项：${outcomeLine}`);
  for (const f of list) {
    L.push(`  - ${f.dateISO} ${f.no || '（无编号）'} ${fmtYuan(f.amountCents)} → ${FINE_OUTCOMES[f.outcome]}${f.recoveredCents ? `（挽回 ${fmtYuan(f.recoveredCents)}）` : ''}`);
  }
  L.push('金额为网点登记的品牌考核口径；申诉材料单可在「报表」页按笔生成。');
  L.push(`生成：递安单 · ${month}`);
  summary.text = L.join('\n');
  return summary;
}

// ---------------------------------------------------------------------------
// 底单销毁台账（条例第 35 条「定期销毁快递运单」的落实痕迹）
// ---------------------------------------------------------------------------

/** 登记一次底单/运单销毁。destroy: { dateISO, way, count, operator, witness, note } */
export function addDestroy(state, { dateISO, way = 'shred', count = 0, operator = '', witness = '', note = '' }) {
  assertISO(dateISO);
  if (!DESTROY_WAYS[way]) throw new Error(`非法销毁方式: ${way}`);
  if (!Number.isInteger(count) || count < 0) throw new Error(`销毁数量必须为非负整数: ${count}`);
  state.destroySeq = (state.destroySeq ?? 0) + 1;
  const rec = { id: `ds-${state.destroySeq}`, dateISO, way, count, operator, witness, note };
  state.destroys.push(rec);
  return rec;
}

/** 销毁钟：距周期红线还有几天。never=从未销毁（有落账却从未销毁是倒查红灯） */
export function destroyState(state, todayISOStr, destroyDays = DEFAULT_DESTROY_DAYS) {
  assertISO(todayISOStr);
  const last = (state.destroys ?? []).map((d) => d.dateISO).sort().pop();
  if (!last) return { level: 'never', lastISO: null, detail: '从未登记过销毁' };
  const dueISO = addDays(last, destroyDays);
  const daysLeft = daysUntil(dueISO, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= Math.min(14, destroyDays) ? 'due' : 'ok';
  return { level, lastISO: last, dueISO, daysLeft, detail: `上次销毁 ${last}，周期 ${destroyDays} 天` };
}

// ---------------------------------------------------------------------------
// 周期义务账（培训/演练/消防器材/车辆电池，打勾自动滚动）
// ---------------------------------------------------------------------------

/** 登记或更新某类义务的最近完成日（一义务一条，重复打勾=更新最近完成日） */
export function setDutyDone(state, kind, doneISO, note = '') {
  if (!DUTY_KINDS[kind]) throw new Error(`非法义务类型: ${kind}`);
  assertISO(doneISO);
  let duty = (state.duties ?? []).find((d) => d.kind === kind);
  if (!duty) {
    duty = { id: `du-${kind}`, kind, lastDoneISO: doneISO, note };
    state.duties.push(duty);
  } else {
    duty.lastDoneISO = doneISO;
    if (note) duty.note = note;
  }
  return duty;
}

/** 单项义务状态：nextDue = 最近完成日 + 周期；never=从未执行 */
export function dutyState(duty, todayISOStr, cycleDays = null) {
  assertISO(todayISOStr);
  const cycle = cycleDays ?? DUTY_KINDS[duty.kind]?.cycleDays ?? 30;
  if (!duty.lastDoneISO) return { level: 'never', cycle };
  const nextDue = addDays(duty.lastDoneISO, cycle);
  const daysLeft = daysUntil(nextDue, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= 14 ? 'due' : 'ok';
  return { level, cycle, nextDue, daysLeft };
}

/** 全部义务看板：红灯在前，附类型与依据 */
export function dutyBoard(state, todayISOStr) {
  assertISO(todayISOStr);
  const order = { never: 0, overdue: 1, due: 2, ok: 3 };
  return (state.duties ?? [])
    .map((d) => ({ kind: d.kind, label: DUTY_KINDS[d.kind]?.label ?? d.kind, basis: DUTY_KINDS[d.kind]?.basis ?? '', lastDoneISO: d.lastDoneISO, ...dutyState(d, todayISOStr) }))
    .sort((a, b) => order[a.level] - order[b.level] || (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9));
}

// ---------------------------------------------------------------------------
// 账本体检（迎检前的自查打分；全部确定性输出）
// ---------------------------------------------------------------------------

/**
 * 七项体检。score = 100 - 红×15 - 黄×5（下限 0）。
 * items: { key, label, level: ok|warn|bad, detail }
 */
export function healthCheck(state, todayISOStr, settings = {}) {
  assertISO(todayISOStr);
  const replyDays = settings.replyDays ?? DEFAULT_REPLY_DAYS;
  const destroyDays = settings.destroyDays ?? DEFAULT_DESTROY_DAYS;
  const gapDays = settings.gapDays ?? DEFAULT_GAP_DAYS;
  const items = [];

  const filing = filingState(state.station, todayISOStr);
  items.push({
    key: 'filing', label: '网点备案',
    level: ['unset', 'overdue'].includes(filing.level) ? 'bad' : filing.level === 'due' ? 'warn' : 'ok',
    detail: filing.detail,
  });

  const gap = routineGapDays(state, todayISOStr);
  if (gap === null) items.push({ key: 'gap', label: '日落账', level: 'bad', detail: '从未落账——台账还没开始' });
  else if (gap > gapDays) items.push({ key: 'gap', label: '日落账', level: 'bad', detail: `已断更 ${gap} 天（红线 ${gapDays} 天）` });
  else if (gap > 2) items.push({ key: 'gap', label: '日落账', level: 'warn', detail: `距最近落账 ${gap} 天` });
  else items.push({ key: 'gap', label: '日落账', level: 'ok', detail: '落账在续' });

  const unconfirmed = unconfirmedRoutines(state);
  items.push({
    key: 'confirm', label: '三确认完整性',
    level: unconfirmed.length ? 'bad' : 'ok',
    detail: unconfirmed.length ? `${unconfirmed.length} 天存在「未执行」确认（${unconfirmed[0].dateISO} 起）——倒查最重的缺口` : '全部落账日三确认完整',
  });

  const openIc = openIntercepts(state);
  items.push({
    key: 'intercept', label: '拦截闭环',
    level: openIc.length >= 3 ? 'bad' : openIc.length ? 'warn' : 'ok',
    detail: openIc.length ? `${openIc.length} 笔拦截未闭环销案（最早 ${openIc[0].dateISO}）` : '拦截全部闭环',
  });

  const overdueCp = openComplaints(state, todayISOStr).filter((c) => c.daysLeft < 0);
  const dueCp = openComplaints(state, todayISOStr).filter((c) => c.daysLeft >= 0);
  items.push({
    key: 'complaint', label: `投诉 ${replyDays} 日答复`,
    level: overdueCp.length ? 'bad' : dueCp.length ? 'warn' : 'ok',
    detail: overdueCp.length
      ? `${overdueCp.length} 笔已超答复期限（条例第 29 条）`
      : dueCp.length ? `${dueCp.length} 笔在 ${replyDays} 日窗口内待答复` : '无待答复投诉',
  });

  const pfn = pendingFines(state);
  items.push({
    key: 'fines', label: '罚款申诉',
    level: pfn.length >= 3 ? 'bad' : pfn.length ? 'warn' : 'ok',
    detail: pfn.length ? `${pfn.length} 笔考核罚款待申诉/待落结果（累计 ${fmtYuan(pfn.reduce((n, f) => n + f.amountCents, 0))}）` : '罚款无挂账',
  });

  const ds = destroyState(state, todayISOStr, destroyDays);
  items.push({
    key: 'destroy', label: '底单销毁',
    level: ds.level === 'overdue' ? 'bad' : ['never', 'due'].includes(ds.level) ? 'warn' : 'ok',
    detail: ds.level === 'never' ? '从未登记销毁（条例第 35 条「定期销毁」）' : ds.detail,
  });

  const duties = dutyBoard(state, todayISOStr).filter((d) => d.level === 'overdue' || d.level === 'never');
  const dutiesDue = dutyBoard(state, todayISOStr).filter((d) => d.level === 'due');
  items.push({
    key: 'duties', label: '周期义务',
    level: duties.length ? 'bad' : dutiesDue.length ? 'warn' : 'ok',
    detail: duties.length
      ? `${duties.map((d) => d.label).join('、')}逾期或从未执行`
      : dutiesDue.length ? `${dutiesDue.map((d) => d.label).join('、')}临期` : '义务全部在期',
  });

  const bad = items.filter((i) => i.level === 'bad').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  return { items, bad, warn, score: Math.max(0, 100 - bad * 15 - warn * 5) };
}

// ---------------------------------------------------------------------------
// 月度小结（微信文本通道，确定性输出）
// ---------------------------------------------------------------------------

/**
 * 月度小结：落账/拦截/投诉/罚款挽回/销毁/义务 六段。month 形如 '2026-09'。
 */
export function monthlySummary(state, month, todayISOStr = todayISO()) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  assertISO(todayISOStr);
  const inMonth = (iso) => monthKey(iso) === month;
  const routines = (state.routines ?? []).filter((r) => inMonth(r.dateISO));
  const intercepts = (state.intercepts ?? []).filter((x) => inMonth(x.dateISO));
  const icOpen = intercepts.filter((x) => !x.closedISO);
  const complaints = (state.complaints ?? []).filter((c) => inMonth(c.dateISO));
  const stats = replyStats(state, todayISOStr);
  const recovery = monthlyRecovery(state, month);
  const destroys = (state.destroys ?? []).filter((d) => inMonth(d.dateISO));
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => d.level === 'overdue' || d.level === 'never');

  const L = [];
  L.push(`【末端网点安全与服务月度小结】${month}`);
  if (state.station?.name) L.push(`网点：${state.station.name}${state.station.brand ? `（${state.station.brand}）` : ''}`);
  L.push(`三项制度落账 ${routines.length} 天${routines.length ? `（最近 ${routines.map((r) => r.dateISO).sort().pop()}）` : ''}，收寄 ${routines.reduce((n, r) => n + r.inbound, 0)} 件`);
  const unconfirmed = routines.filter((r) => !r.verifyOk || !r.realnameOk);
  L.push(unconfirmed.length ? `⚠ ${unconfirmed.length} 天存在未执行确认，需逐日说明` : '验视/实名/安检三确认无未执行日');
  L.push(`拦截登记 ${intercepts.length} 笔${icOpen.length ? `（${icOpen.length} 笔未闭环销案）` : '（全部闭环）'}`);
  L.push(`投诉 ${complaints.length} 笔：${stats.onTime} 笔 ${state.settings?.replyDays ?? DEFAULT_REPLY_DAYS} 日内答复${stats.late ? `、${stats.late} 笔超期` : ''}${stats.open ? `、${stats.open} 笔未答复` : ''}`);
  const recLine = recovery.text.split('\n').filter((l) => l.startsWith('罚款 ') || l.startsWith('  - '));
  L.push(...recLine);
  L.push(`底单销毁 ${destroys.length} 次`);
  if (dutiesLate.length) L.push(`⚠ 周期义务点名：${dutiesLate.map((d) => d.label).join('、')}`);
  L.push('口径：《快递暂行条例》（2025 修订）第 19/21/29/32/34/35/36 条；本小结为网点自查底稿，不替代法定报送。');
  L.push(`生成：递安单 · ${month}`);
  return { text: L.join('\n'), routines: routines.length, intercepts: intercepts.length, complaints: complaints.length, recovery };
}

// ---------------------------------------------------------------------------
// 迎检自证包（单文件 HTML：八段，含签字栏；同输入同输出）
// ---------------------------------------------------------------------------

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏） */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const replyDays = settings.replyDays ?? state.settings?.replyDays ?? DEFAULT_REPLY_DAYS;
  const destroyDays = settings.destroyDays ?? state.settings?.destroyDays ?? DEFAULT_DESTROY_DAYS;
  const st = state.station ?? {};
  const LEVEL = { overdue: '逾期', due: '临期', ok: '正常', never: '从未执行', unset: '未登记' };
  const filing = filingState(st, todayISOStr);

  const from30 = addDays(todayISOStr, -29);
  const routines = (state.routines ?? []).filter((r) => r.dateISO >= from30).sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const routineRows = routines.map((r) => `<tr>
    <td>${e(r.dateISO)}</td><td>${r.inbound}</td>
    <td>${r.verifyOk ? '已执行' : '<strong>未执行</strong>'}</td>
    <td>${r.realnameOk ? '已执行' : '<strong>未执行</strong>'}</td>
    <td>${r.security === 'done' ? '已执行并标识' : '本网点无安检设备'}</td>
    <td>${e(r.note || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="6">近 30 天无落账</td></tr>';

  const icRows = [...(state.intercepts ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((x) => `<tr>
    <td>${e(x.dateISO)}</td><td>${e(x.person || '—')}</td><td>${e(x.item || '—')}</td>
    <td>${e(REJECT_REASONS[x.reason] ?? x.reason)}</td><td>${e(INTERCEPT_ACTIONS[x.action] ?? x.action)}</td>
    <td>${x.closedISO ? `${e(x.closedISO)}${x.result ? `：${e(x.result)}` : ''}` : '<strong>未闭环</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="6">无拦截记录</td></tr>';

  const cpRows = [...(state.complaints ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr>
    <td>${e(c.dateISO)}</td><td>${e(COMPLAINT_CHANNELS[c.channel] ?? c.channel)}</td><td>${e(c.matter || '—')}</td>
    <td>${e(c.replyDueISO)}</td>
    <td>${c.replyISO ? `${e(c.replyISO)}${c.late ? '（超期）' : ''}` : '<strong>未答复</strong>'}</td>
    <td>${c.replyISO ? e(COMPLAINT_RESULTS[c.result] ?? c.result) : '—'}</td>
  </tr>`).join('') || '<tr><td colspan="6">无投诉记录</td></tr>';
  const rs = replyStats(state, todayISOStr);
  const onTimeLine = rs.total
    ? `${rs.onTime}/${rs.total} 笔在 ${replyDays} 日内答复（${rs.late} 笔超期、${rs.open} 笔未答复）`
    : '本期内无投诉';

  const fnRows = [...(state.fines ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((f) => `<tr>
    <td>${e(f.dateISO)}</td><td>${e(f.no || '—')}</td><td>${fmtYuan(f.amountCents)}</td>
    <td>${e(f.basis || '—')}</td><td>${e(FINE_OUTCOMES[f.outcome] ?? f.outcome)}</td><td>${fmtYuan(f.recoveredCents || 0)}</td>
  </tr>`).join('') || '<tr><td colspan="6">无罚款登记</td></tr>';

  const dsRows = [...(state.destroys ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((d) => `<tr>
    <td>${e(d.dateISO)}</td><td>${e(DESTROY_WAYS[d.way] ?? d.way)}</td><td>${d.count}</td>
    <td>${e(d.operator || '—')}</td><td>${e(d.witness || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="5">无销毁记录</td></tr>';

  const duRows = dutyBoard(state, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastDoneISO ? e(d.lastDoneISO) : '—'}</td>
    <td>${d.nextDue ? e(d.nextDue) : '—'}</td><td>${LEVEL[d.level] ?? d.level}</td><td>${e(d.basis)}</td>
  </tr>`).join('') || '<tr><td colspan="5">未登记周期义务</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>末端网点迎检自证包 · ${e(st.name ?? '')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; }
  th { color: #555; font-weight: 500; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>末端网点迎检自证包 · ${e(st.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 品牌：${e(st.brand || '—')} · 负责人：${e(st.manager || '—')} · ${e(st.address || '地址未填')}</div>
<h2>一、网点与备案（《快递暂行条例》第 19 条）</h2>
<div class="meta">开办日：${e(st.openedISO || '—')} · 备案状态：${e(filing.detail)}（${LEVEL[filing.level] ?? filing.level}）</div>
<h2>二、三项制度执行台账（近 30 天：验视 / 实名 / 安检）</h2>
<table><tr><th>日期</th><th>收寄</th><th>验视</th><th>实名</th><th>安检</th><th>备注</th></tr>${routineRows}</table>
<h2>三、拦截登记簿（拒绝收寄与问题件处置）</h2>
<table><tr><th>日期</th><th>当事人</th><th>物品</th><th>原因</th><th>处置</th><th>闭环</th></tr>${icRows}</table>
<h2>四、投诉处理台账（答复时限 ${replyDays} 日：《快递暂行条例》第 29 条）</h2>
<div class="meta">${e(onTimeLine)}</div>
<table><tr><th>登记日</th><th>渠道</th><th>事项</th><th>答复截止</th><th>答复日</th><th>结果</th></tr>${cpRows}</table>
<h2>五、考核罚款与申诉挽回（网点登记口径）</h2>
<table><tr><th>日期</th><th>编号</th><th>金额</th><th>依据</th><th>结果</th><th>挽回</th></tr>${fnRows}</table>
<h2>六、底单销毁台账（周期 ${destroyDays} 天：《快递暂行条例》第 35 条）</h2>
<table><tr><th>日期</th><th>方式</th><th>数量</th><th>经办</th><th>监销</th></tr>${dsRows}</table>
<h2>七、周期义务台账（培训 / 演练 / 消防器材 / 车辆电池）</h2>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<div class="sign">网点负责人（签字/盖章）：____________　安全员（签字）：____________　日期：____________</div>
<div class="foot">生成：递安单 ParcelProof · ${e(todayISOStr)} · 本页为网点自查与迎检备查材料，不替代法定报送、备案回执与总部系统记录；检查重点对标《快递暂行条例》第 46 条</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 申诉材料单（单笔罚款的证据链打印版）
// ---------------------------------------------------------------------------

/** 申诉材料单：单笔罚款的登记-处理-证据时间线（单文件 HTML，含签字栏） */
export function appealHtml(state, fineId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const fine = (state.fines ?? []).find((x) => x.id === fineId);
  if (!fine) throw new Error(`罚款记录不存在: ${fineId}`);
  const st = state.station ?? {};
  const complaint = fine.complaintId ? (state.complaints ?? []).find((c) => c.id === fine.complaintId) : null;
  const evFrom = addDays(fine.dateISO, -15);
  const evTo = addDays(fine.dateISO, 15);
  const routines = (state.routines ?? []).filter((r) => r.dateISO >= evFrom && r.dateISO <= evTo)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const intercepts = (state.intercepts ?? []).filter((x) => x.dateISO >= evFrom && x.dateISO <= evTo)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  const cpBlock = complaint ? `
<h2>二、关联投诉处理时间线</h2>
<table>
  <tr><th>环节</th><th>日期</th><th>内容</th></tr>
  <tr><td>投诉登记</td><td>${e(complaint.dateISO)}</td><td>${e(COMPLAINT_CHANNELS[complaint.channel] ?? complaint.channel)}：${e(complaint.matter || '—')}</td></tr>
  <tr><td>答复截止（${e(String(state.settings?.replyDays ?? DEFAULT_REPLY_DAYS))} 日内）</td><td>${e(complaint.replyDueISO)}</td><td>《快递暂行条例》第 29 条口径</td></tr>
  <tr><td>实际答复</td><td>${complaint.replyISO ? e(complaint.replyISO) : '<strong>未答复</strong>'}</td><td>${complaint.replyISO ? `${e(complaint.replyWay || '—')} · ${e(COMPLAINT_RESULTS[complaint.result] ?? complaint.result)}${complaint.late ? '（超期）' : ''}` : '—'}</td></tr>
</table>` : '<h2>二、关联投诉</h2><p class="meta">本笔罚款未关联投诉记录</p>';

  const evRows = routines.map((r) => `<tr>
    <td>${e(r.dateISO)}</td><td>${r.inbound}</td><td>${r.verifyOk ? '已执行' : '未执行'}</td>
    <td>${r.realnameOk ? '已执行' : '未执行'}</td><td>${e(r.note || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="5">该时段无落账</td></tr>';
  const icRows = intercepts.map((x) => `<tr>
    <td>${e(x.dateISO)}</td><td>${e(x.person || '—')}</td><td>${e(REJECT_REASONS[x.reason] ?? x.reason)}</td>
    <td>${e(INTERCEPT_ACTIONS[x.action] ?? x.action)}</td><td>${x.closedISO ? e(x.closedISO) : '未闭环'}</td>
  </tr>`).join('') || '<tr><td colspan="5">该时段无拦截记录</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>罚款申诉材料单 · ${e(fine.no || fine.dateISO)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; }
  th { color: #555; font-weight: 500; }
  .box { border: 1px solid #ccc; border-radius: 8px; padding: 10px; font-size: 13px; min-height: 64px; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>考核罚款申诉材料单</h1>
<div class="meta">网点：${e(st.name || '—')}${st.brand ? `（${e(st.brand)}）` : ''} · 负责人：${e(st.manager || '—')} · 打印日：${e(todayISOStr)}</div>
<h2>一、罚款信息（网点登记口径）</h2>
<div class="meta">考核日期：${e(fine.dateISO)} · 编号：${e(fine.no || '—')} · 金额：${fmtYuan(fine.amountCents)} · 考核依据：${e(fine.basis || '—')}</div>
${cpBlock}
<h2>三、同期履责证据（前后 15 天）</h2>
<div class="meta">三项制度日落账</div>
<table><tr><th>日期</th><th>收寄</th><th>验视</th><th>实名</th><th>备注</th></tr>${evRows}</table>
<div class="meta">拦截登记（我拦下的，是我没被罚的证据）</div>
<table><tr><th>日期</th><th>当事人</th><th>原因</th><th>处置</th><th>闭环</th></tr>${icRows}</table>
<h2>四、申诉理由</h2>
<div class="box">${e(fine.appealNote || '（申诉后在台账补记理由，打印前更新）')}</div>
<div class="sign">网点负责人（签字/盖章）：____________　日期：____________</div>
<div class="foot">生成：递安单 ParcelProof · ${e(todayISOStr)} · 本单为网点向品牌方/承包区上级申诉时的自证材料底稿，不构成对品牌考核规则的判断</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'parcelproof', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'parcelproof') return { ok: false, error: '不是递安单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.station === 'object' && s.station !== null &&
    arr(s.routines) && arr(s.intercepts) && arr(s.complaints) &&
    arr(s.fines) && arr(s.destroys) && arr(s.duties) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
