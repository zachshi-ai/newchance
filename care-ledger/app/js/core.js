/**
 * core.js — 护安单 CareLedger 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；
 * 所有规则参数（班次、夜巡次数、周期天数）都在设置中开放覆盖——属地口径永远赢。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md）：
 * - GB 38600-2019《养老机构服务安全基本规范》：养老服务领域第一个强制性国家标准，
 *   2019-12 批准发布，2022-01-01 起实施（过渡期 2 年届满）。第 5 章要求对老年人
 *   开展服务安全风险评估；第 6 章「服务防护」明确九类风险的预防与处置（业内称
 *   「九防」）：防噎食、防食品药品误食、防压疮、防烫伤、防坠床、防跌倒、防走失、
 *   防他伤和自伤、防文体活动意外（本仓库已对照国家标准全文公开系统与国务院政策
 *   例行吹风会实录核验）
 * - 《养老机构管理办法》（民政部令第 66 号，2020-11-01 施行，本仓库已对照司法部
 *   官网全文核验）：
 *   · 第十五条 入院评估制度：对老年人身心状况评估、确定照料护理等级，变化重新评估
 *   · 第十九条 健康档案；突发危重疾病及时转送救治并通知紧急联系人
 *   · 第二十八条 实行 24 小时值班，做好老年人安全保障工作；视频监控并妥善保管记录
 *   · 第三十一条 突发事件应急预案、定期开展应急演练
 *   · 第三十二条 老年人信息档案妥善保管，保管期限不少于服务协议期满后五年
 *   · 第三十八条 民政部门每年对养老机构服务安全和质量进行不少于一次的现场检查
 *   · 第四十六条 未建立评估制度／未按强制性国家标准提供服务／未依规定预防和处置
 *     突发事件——责令改正、警告，情节严重可处 3 万元以下罚款；治安、刑事责任另论
 * - 《民法典》第一千一百九十八条 安全保障义务：经营场所、公共场所的经营者未尽到
 *   安全保障义务造成他人损害的承担侵权责任——养老机构纠纷中，机构方必须用记录
 *   证明「照护到位、发现及时、告知过家属」，拿不出记录就要吃下更大的责任比例
 * 本工具是机构侧的服务安全底账与沟通记录，不构成法律意见，不替代法定档案、
 * 视频监控记录与民政报送义务。
 */

// ---------------------------------------------------------------------------
// 日期与工具（ISO 字符串 yyyy-mm-dd 为唯一日期表示）
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

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

/** 校验「yyyy-mm-dd hh:mm」时间戳（家属告知时间用），非法则抛错 */
export function assertDT(dt) {
  if (typeof dt !== 'string' || !DATETIME_RE.test(dt)) {
    throw new Error(`非法时间戳: ${JSON.stringify(dt)}`);
  }
  assertISO(dt.slice(0, 10));
  const hh = Number(dt.slice(11, 13));
  const mm = Number(dt.slice(14, 16));
  if (hh > 23 || mm > 59) throw new Error(`非法时间戳: ${dt}`);
  return dt;
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

/** 'YYYY-MM' 月份键（月报分组用） */
export function monthKey(iso) {
  assertISO(iso);
  return iso.slice(0, 7);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 模板常量（内容供应链：字段 = GB 38600「九防」+ 66 号令义务的小微化拆解）
// ---------------------------------------------------------------------------

/**
 * 九防风险登记：GB 38600-2019 第 6 章九类服务风险。四级：
 * unset 未评估 / none 无此风险 / watch 需防护（填措施）/ high 高风险（重点看护）。
 * 建档即全「未评估」——把「没评过」从默认状态变成必须消灭的红色待办。
 */
export const RISK_FIELDS = {
  chokes: { label: '防噎食', ask: '进食饮水有无呛咳史；是否需糊化/半流食与喂食看护' },
  misIntake: { label: '防误食', ask: '有无误服风险；药品是否代管、有无食物禁忌' },
  pressureUlcer: { label: '防压疮', ask: '长期卧床/久坐是否需定时翻身与皮肤检查' },
  scald: { label: '防烫伤', ask: '洗浴/热食/取暖有无烫伤风险' },
  bedFall: { label: '防坠床', ask: '有无坠床史；是否需床栏或离床看护' },
  fall: { label: '防跌倒', ask: '有无跌倒史；行走/如厕/洗浴是否需扶助与防滑' },
  elope: { label: '防走失', ask: '有无走失史或认知障碍；外出是否需专人陪同' },
  hurt: { label: '防他伤自伤', ask: '有无情绪行为异常、自伤或伤人风险' },
  activity: { label: '防活动意外', ask: '参加文体活动是否需评估强度与专人防护' },
};

export const RISK_LEVELS = {
  unset: { label: '❓ 未评估', mark: '❓' },
  none: { label: '✅ 无此风险', mark: '✅' },
  watch: { label: '🛡️ 需防护', mark: '🛡️' },
  high: { label: '🔴 高风险', mark: '🔴' },
};

/** 照料护理等级（66 号令第十五条：评估后确定，须经老年人或其代理人同意） */
export const CARE_LEVELS = {
  self: { label: '自理' },
  assist: { label: '介助' },
  care: { label: '介护' },
  special: { label: '特护' },
};

/** 值班班次（66 号令第二十八条：实行 24 小时值班）。night 班次承担夜间巡查计数 */
export const SHIFTS = {
  day: { label: '白班', time: '08:00', night: false },
  mid: { label: '中班', time: '16:00', night: false },
  night: { label: '夜班', time: '20:00', night: true },
};

export const DEFAULT_ENABLED_SHIFTS = ['day', 'night'];
export const DEFAULT_NIGHT_MIN_TIMES = 2; // 夜班夜间巡查最少次数（通识口径，属地要求永远赢）

/** 事件类型 = 九防 + 其他 */
export const INCIDENT_TYPES = {
  ...Object.fromEntries(Object.keys(RISK_FIELDS).map((k) => [k, { label: RISK_FIELDS[k].label.replace(/^防/, '') }])),
  other: { label: '其他' },
};

/** 周期义务账（66 号令第十五条评估 / 第三十一条演练；体检与属地口径为通识） */
export const CYCLE_KINDS = {
  assess: { label: '能力评估复评', scope: '老人', unit: '人' },
  drill: { label: '应急演练', scope: '全院', unit: '次' },
  health: { label: '员工健康体检', scope: '员工', unit: '人' },
  other: { label: '其他周期事项', scope: '其他', unit: '项' },
};

export const DEFAULT_CYCLE_PERIODS = { assess: 180, drill: 180, health: 365, other: 0 };
export const DEFAULT_SOON_DAYS = 30;

/** 建一整套「未评估」风险书（建档即体检，默认状态即待办） */
export function newRiskBook() {
  const out = {};
  for (const key of Object.keys(RISK_FIELDS)) {
    out[key] = { level: 'unset', measures: '' };
  }
  return out;
}

export function assertRiskBook(rb) {
  for (const key of Object.keys(RISK_FIELDS)) {
    const item = rb?.[key];
    if (!item || !RISK_LEVELS[item.level]) {
      throw new Error(`风险项缺失或级别非法: ${key}`);
    }
  }
  return rb;
}

/** 单项风险登记：high 与 watch 都要求写防护措施——「知道有风险却没措施」是台账上的自供状 */
export function setRisk(riskBook, key, level, measures = '') {
  if (!RISK_FIELDS[key]) throw new Error(`风险项非法: ${key}`);
  if (!RISK_LEVELS[level]) throw new Error(`风险级别非法: ${level}`);
  if ((level === 'watch' || level === 'high') && !String(measures).trim()) {
    throw new Error(`${RISK_FIELDS[key].label}：登记「${RISK_LEVELS[level].label}」必须填写防护措施`);
  }
  riskBook[key] = { level, measures: String(measures).trim() };
  return riskBook[key];
}

function requireResident(residents, id, label = '老人') {
  const hit = (residents ?? []).find((r) => r.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

/** 九防四态计数 */
export function riskSummary(resident) {
  assertRiskBook(resident.riskBook);
  const sum = { unset: 0, none: 0, watch: 0, high: 0 };
  for (const k of Object.keys(RISK_FIELDS)) sum[resident.riskBook[k].level] += 1;
  return sum;
}

/** 未评估老人清单（66 号令第十五条评估义务的缺口点名） */
export function unsetRiskResidents(residents) {
  return (residents ?? []).filter((r) => r.status === 'in' && riskSummary(r).unset > 0);
}

/** 高风险老人清单（重点看护名册） */
export function watchList(residents) {
  return (residents ?? []).filter((r) => r.status === 'in' && riskSummary(r).high > 0);
}

/** 离院（误操作可撤销）：档案保留——出证与事件历史不能跟着人消失 */
export function discharge(residents, id, outISO) {
  const r = requireResident(residents, id);
  if (r.status === 'out') throw new Error('该老人已是离院状态');
  assertISO(outISO);
  if (outISO < r.admitISO) throw new Error('离院日期不能早于入住日期');
  r.status = 'out';
  r.outISO = outISO;
  return r;
}

export function undoDischarge(residents, id) {
  const r = requireResident(residents, id);
  if (r.status !== 'out') throw new Error('该老人不在离院状态，无需撤销');
  r.status = 'in';
  delete r.outISO;
  return r;
}

// ---------------------------------------------------------------------------
// 值班巡查账（每班一条：打卡即交接，缺班自动点名——记录的连续性是台账可信度的生命线）
// ---------------------------------------------------------------------------

function enabledShifts(settings) {
  const list = Array.isArray(settings?.enabledShifts) && settings.enabledShifts.length
    ? settings.enabledShifts
    : DEFAULT_ENABLED_SHIFTS;
  for (const k of list) {
    if (!SHIFTS[k]) throw new Error(`班次非法: ${k}`);
  }
  return list;
}

export function roundFor(state, dateISO, shiftKey) {
  assertISO(dateISO);
  if (!SHIFTS[shiftKey]) throw new Error(`班次非法: ${shiftKey}`);
  return (state.rounds ?? []).find((e) => e.dateISO === dateISO && e.shift === shiftKey);
}

/**
 * 打卡落账：{ dateISO, shift, staff, majors?, todos?, status, abnormalNote?, nightTimes? }
 * - 同日同班次唯一：重复打卡拒绝（要改先删，防止覆盖历史）
 * - 值班人必填：没有署名的巡查记录，等于没有巡查
 * - status=abnormal 必须写 abnormalNote（异常强制留处置说明）
 * - 未启用班次拒绝；未来日期拒绝（还没值到的班不能提前"已值"）
 * - night 班次必填 nightTimes；低于设置的最少次数不阻止，但 short 亮灯点名
 */
export function addRound(state, { dateISO, shift, staff, majors = '', todos = '', status = 'ok', abnormalNote = '', nightTimes = null }, todayISOStr = todayISO()) {
  assertISO(dateISO);
  assertISO(todayISOStr);
  if (!SHIFTS[shift]) throw new Error(`班次非法: ${shift}`);
  if (!enabledShifts(state.settings).includes(shift)) {
    throw new Error(`班次未启用: ${SHIFTS[shift].label}`);
  }
  if (dateISO > todayISOStr) throw new Error('不能给未来的班次打卡');
  if (roundFor(state, dateISO, shift)) throw new Error(`${dateISO} ${SHIFTS[shift].label}已有打卡记录，要改先删`);
  if (!String(staff ?? '').trim()) throw new Error('值班人必填——没有署名的巡查等于没巡查');
  if (!['ok', 'abnormal'].includes(status)) throw new Error(`打卡状态非法: ${status}`);
  if (status === 'abnormal' && !String(abnormalNote ?? '').trim()) {
    throw new Error('异常班次必须写明情况与处置——留痕不是签名，是内容');
  }
  const short = { level: 'ok', note: '' };
  const round = {
    id: `r-${state.rounds.length + 1}-${dateISO}-${shift}`,
    dateISO,
    shift,
    staff: String(staff).trim(),
    majors: String(majors ?? '').trim(),
    todos: String(todos ?? '').trim(),
    status,
    ...(status === 'abnormal' ? { abnormalNote: String(abnormalNote).trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  if (SHIFTS[shift].night) {
    const min = state.settings?.nightMinTimes ?? DEFAULT_NIGHT_MIN_TIMES;
    const n = Number(nightTimes);
    if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error('夜巡次数必须为 1~12 的整数');
    round.nightTimes = n;
    if (n < min) {
      short.level = 'short';
      short.note = `夜巡 ${n} 次，少于设定下限 ${min} 次`;
      round.shortNote = short.note;
    }
  }
  state.rounds.push(round);
  return { round, short };
}

export function removeRound(state, roundId) {
  const idx = (state.rounds ?? []).findIndex((e) => e.id === roundId);
  if (idx < 0) throw new Error(`打卡记录不存在: ${roundId}`);
  state.rounds.splice(idx, 1);
}

/** 某日的班次覆盖：done 已打卡 / missing 缺班（按设置启用的班次计） */
export function coverageFor(state, dateISO) {
  assertISO(dateISO);
  const enabled = enabledShifts(state.settings);
  const done = enabled.filter((k) => roundFor(state, dateISO, k));
  return { done, missing: enabled.filter((k) => !done.includes(k)) };
}

/**
 * 区间断班点名：fromISO..toISO（含端点，自动截断到今天）。
 * 返回每天缺口列表 [{dateISO, missing:[班次]}]——出证包里缺口如实列出，不掩饰。
 * 区间跨度上限 366 天，倒填拒绝。
 */
export function gapsBetween(state, fromISO, toISO, todayISOStr = todayISO()) {
  assertISO(fromISO);
  assertISO(toISO);
  assertISO(todayISOStr);
  if (fromISO > toISO) throw new Error('区间起点晚于终点');
  if (daysUntil(toISO, fromISO) > 366) throw new Error('区间过长（>366 天），请拆分查询');
  const end = toISO > todayISOStr ? todayISOStr : toISO;
  const gaps = [];
  for (let d = fromISO; d <= end; d = addDays(d, 1)) {
    const cov = coverageFor(state, d);
    if (cov.missing.length) gaps.push({ dateISO: d, missing: cov.missing });
  }
  return gaps;
}

/** 最近 N 天（含今天）缺班摘要：断更预警的数据源 */
export function recentGaps(state, days = 7, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  return gapsBetween(state, addDays(todayISOStr, -(days - 1)), todayISOStr, todayISOStr);
}

/** 夜巡不足的打卡（short 亮灯清单，按日期倒序） */
export function shortNightRounds(state) {
  return (state.rounds ?? [])
    .filter((e) => SHIFTS[e.shift]?.night && e.shortNote)
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

// ---------------------------------------------------------------------------
// 照护事件闭环（发生了什么 → 怎么处置 → 家属是否知情 → 复盘整改）
// ---------------------------------------------------------------------------

export function addIncident(state, { id, residentId, type, dateISO, desc, firstAid = '', sentToHospital = false }, todayISOStr = todayISO()) {
  const resident = requireResident(state.residents, residentId);
  if (!INCIDENT_TYPES[type]) throw new Error(`事件类型非法: ${type}`);
  assertISO(dateISO);
  assertISO(todayISOStr);
  if (dateISO > todayISOStr) throw new Error('事件日期不能是未来');
  if (!String(desc ?? '').trim()) throw new Error('事件经过必须写明——这行字将来就是机构的证词');
  const incident = {
    id,
    residentId,
    residentName: resident.name,
    type,
    dateISO,
    desc: String(desc).trim(),
    firstAid: String(firstAid ?? '').trim(),
    sentToHospital: Boolean(sentToHospital),
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  state.incidents.push(incident);
  return incident;
}

export function openIncidents(state) {
  return (state.incidents ?? []).filter((e) => e.status === 'open').sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

/**
 * 闭环结案：家属告知（时间 + 方式 + 通知人）与复盘整改都是硬前提。
 * 66 号令第十九条要求突发危重疾病转送救治「并通知其紧急联系人」——没告知家属
 * 的「结案」在纠纷里等于自认隐瞒，工具直接拒绝。
 */
export function closeIncident(state, { id, familyNotifiedAt, familyWay, familyBy, reviewNote }) {
  const incident = (state.incidents ?? []).find((e) => e.id === id);
  if (!incident) throw new Error(`事件不存在: ${id}`);
  if (incident.status === 'closed') throw new Error('该事件已闭环，不能重复结案（误操作请先撤销）');
  assertDT(familyNotifiedAt);
  if (!String(familyWay ?? '').trim()) throw new Error('家属告知方式必填（电话/来访/微信等）');
  if (!String(familyBy ?? '').trim()) throw new Error('通知人必填');
  if (!String(reviewNote ?? '').trim()) throw new Error('复盘整改必填——同类风险的防范措施写了吗');
  incident.familyNotifiedAt = String(familyNotifiedAt).trim();
  incident.familyWay = String(familyWay).trim();
  incident.familyBy = String(familyBy).trim();
  incident.reviewNote = String(reviewNote).trim();
  incident.status = 'closed';
  incident.closedISO = todayISO();
  return incident;
}

/** 撤销闭环（误操作回滚）：事件回到 open，重新点名 */
export function undoClose(state, id) {
  const incident = (state.incidents ?? []).find((e) => e.id === id);
  if (!incident) throw new Error(`事件不存在: ${id}`);
  if (incident.status !== 'closed') throw new Error('该事件不在闭环状态，无需撤销');
  incident.status = 'open';
  delete incident.familyNotifiedAt;
  delete incident.familyWay;
  delete incident.familyBy;
  delete incident.reviewNote;
  delete incident.closedISO;
  return incident;
}

// ---------------------------------------------------------------------------
// 周期义务账（评估复评 / 应急演练 / 员工体检——「定期」两个字全靠日历兜底）
// ---------------------------------------------------------------------------

export function addCycle(state, { id, kind, owner, dueISO, note = '' }) {
  if (!CYCLE_KINDS[kind]) throw new Error(`周期义务类型非法: ${kind}`);
  if (!String(owner ?? '').trim()) throw new Error('责任人/对象必填（如：张奶奶 / 全员 / 护理员李芳）');
  assertISO(dueISO);
  const cycle = { id, kind, owner: String(owner).trim(), dueISO, note: String(note ?? '').trim(), doneISO: null };
  state.cycles.push(cycle);
  return cycle;
}

export function cycleStatus(cycle, todayISOStr = todayISO(), periods = DEFAULT_CYCLE_PERIODS, soonDays = DEFAULT_SOON_DAYS) {
  assertISO(todayISOStr);
  const left = daysUntil(cycle.dueISO, todayISOStr);
  if (left <= 0) return 'due';
  if (left <= soonDays) return 'soon';
  return 'ok';
}

export function dueCycles(state, todayISOStr = todayISO()) {
  const periods = { ...DEFAULT_CYCLE_PERIODS, ...(state.settings?.cyclePeriods ?? {}) };
  const soonDays = state.settings?.soonDays ?? DEFAULT_SOON_DAYS;
  return (state.cycles ?? [])
    .map((c) => ({ cycle: c, status: cycleStatus(c, todayISOStr, periods, soonDays) }))
    .filter((x) => x.status !== 'ok')
    .sort((a, b) => a.cycle.dueISO.localeCompare(b.cycle.dueISO));
}

/** 打勾完成并滚动到期日：doneISO + 周期天数 = 下一次到期（周期为 0 只记账不滚动） */
export function markCycleDone(state, id, doneISO, todayISOStr = todayISO()) {
  const cycle = (state.cycles ?? []).find((c) => c.id === id);
  if (!cycle) throw new Error(`周期义务不存在: ${id}`);
  assertISO(doneISO);
  assertISO(todayISOStr);
  if (doneISO > todayISOStr) throw new Error('完成日期不能是未来');
  cycle.doneISO = doneISO;
  const periods = { ...DEFAULT_CYCLE_PERIODS, ...(state.settings?.cyclePeriods ?? {}) };
  const period = periods[cycle.kind] ?? 0;
  if (period > 0) cycle.dueISO = addDays(doneISO, period);
  return { cycle, nextDueISO: cycle.dueISO };
}

// ---------------------------------------------------------------------------
// 自证包（信任的交付物：按老人 × 时段，30 秒打出「我们是怎么照护的」）
// ---------------------------------------------------------------------------

function riskLines(resident) {
  assertRiskBook(resident.riskBook);
  return Object.keys(RISK_FIELDS).map((k) => {
    const item = resident.riskBook[k];
    const lv = RISK_LEVELS[item.level];
    const measures = item.measures ? `（${item.measures}）` : '';
    if (item.level === 'unset') return { label: RISK_FIELDS[k].label, mark: lv.mark, text: '未评估' };
    if (item.level === 'none') return { label: RISK_FIELDS[k].label, mark: lv.mark, text: '无此风险' };
    return { label: RISK_FIELDS[k].label, mark: lv.mark, text: `${lv.label.replace(/^\S+\s/, '')}${measures}` };
  });
}

/**
 * 组装自证包：老人档案与九防评估 + 时段内巡查覆盖（缺口如实点名）+ 照护事件与家属告知。
 * 缺口不会被隐藏——检查现场「记录连不上」比「有缺口但补得诚实」更致命。
 */
export function certBundle(state, { residentId, fromISO, toISO, todayISOStr = todayISO() }) {
  const resident = requireResident(state.residents, residentId);
  assertISO(fromISO);
  assertISO(toISO);
  if (fromISO > toISO) throw new Error('区间起点晚于终点');
  const gaps = gapsBetween(state, fromISO, toISO, todayISOStr);
  const enabled = enabledShifts(state.settings);
  const end = toISO > todayISOStr ? todayISOStr : toISO;
  const days = end >= fromISO ? daysUntil(end, fromISO) + 1 : 0;
  const totalPlanned = days * enabled.length;
  const doneCount = totalPlanned - gaps.reduce((n, g) => n + g.missing.length, 0);
  const incidents = (state.incidents ?? [])
    .filter((e) => e.residentId === residentId && e.dateISO >= fromISO && e.dateISO <= toISO)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return {
    resident,
    risks: riskLines(resident),
    coverage: {
      planned: totalPlanned,
      done: doneCount,
      missingCount: gaps.reduce((n, g) => n + g.missing.length, 0),
      gaps,
    },
    incidents,
  };
}

/** 自证包文本（微信发给家属或民政检查人员，主通道）。同输入同输出 */
export function certText({ state, residentId, fromISO, toISO, todayISOStr = todayISO() }) {
  const b = certBundle(state, { residentId, fromISO, toISO, todayISOStr });
  const r = b.resident;
  const L = [];
  L.push(`【照护安全自证包】${r.name}${r.bed ? ` · ${r.bed}` : ''}`);
  if (state.home?.name) L.push(`机构：${state.home.name}${state.home.phone ? `（${state.home.phone}）` : ''}`);
  L.push(`出具日：${todayISOStr} · 时段：${fromISO} 至 ${toISO}`);
  L.push(`等级：${CARE_LEVELS[r.careLevel]?.label ?? '—'} · 入住 ${r.admitISO}${r.status === 'out' ? ` · 离院 ${r.outISO ?? '—'}` : ''}`);
  L.push('');
  L.push('一、九防风险评估与防护（GB 38600-2019）');
  for (const ln of b.risks) {
    L.push(`  - ${ln.label}：${ln.mark} ${ln.text}`);
  }
  L.push('');
  L.push(`二、值班巡查覆盖（${fromISO} ~ ${toISO}，应打卡 ${b.coverage.planned} 班次）`);
  L.push(`  已打卡 ${b.coverage.done} 班次，缺口 ${b.coverage.missingCount} 班次（如实列出）：`);
  const gaps = b.coverage.gaps.slice(0, 10);
  for (const g of gaps) {
    L.push(`  - ${g.dateISO} 缺：${g.missing.map((k) => SHIFTS[k].label).join('、')}`);
  }
  if (b.coverage.gaps.length > 10) L.push(`  ……另有 ${b.coverage.gaps.length - 10} 天缺口`);
  if (!b.coverage.gaps.length) L.push('  （无缺口）');
  L.push('');
  L.push('三、照护事件与家属告知');
  if (!b.incidents.length) {
    L.push('  （本时段无照护事件记录）');
  } else {
    for (const e of b.incidents) {
      L.push(`  - ${e.dateISO}【${INCIDENT_TYPES[e.type]?.label ?? e.type}】${e.desc}`);
      if (e.firstAid) L.push(`    处置：${e.firstAid}${e.sentToHospital ? ' · 已送医' : ''}`);
      if (e.status === 'closed') {
        L.push(`    家属告知：${e.familyNotifiedAt}（${e.familyWay}，通知人 ${e.familyBy}）`);
        L.push(`    复盘整改：${e.reviewNote}`);
      } else {
        L.push('    ⚠ 该事件尚未闭环（家属告知/复盘未完成）');
      }
    }
  }
  L.push('');
  L.push('四、说明');
  L.push('本包为机构服务安全自查与家属沟通用途的记录摘编；不替代法定信息档案（保管期限不少于服务协议期满后五年）、视频监控记录与民政报送。记录缺口如实列出，补记由当班人补录并注明。');
  L.push(`生成：护安单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 自证包打印版：单文件 HTML（内联样式、查阅签字栏，无外部资源） */
export function certHtml({ state, residentId, fromISO, toISO, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const b = certBundle(state, { residentId, fromISO, toISO, todayISOStr });
  const r = b.resident;
  const riskRows = b.risks
    .map((ln) => `<tr><td style="width:8em">${e(ln.label)}</td><td>${e(ln.mark)} ${e(ln.text)}</td></tr>`)
    .join('');
  const gapRows = b.coverage.gaps.length
    ? b.coverage.gaps.slice(0, 12).map((g) =>
      `<tr><td>${e(g.dateISO)}</td><td>${e(g.missing.map((k) => SHIFTS[k].label).join('、'))}</td></tr>`).join('')
      + (b.coverage.gaps.length > 12 ? `<tr><td colspan="2">……另有 ${b.coverage.gaps.length - 12} 天缺口</td></tr>` : '')
    : '<tr><td colspan="2">（无缺口）</td></tr>';
  const incidentBlocks = b.incidents.length
    ? b.incidents.map((ev) => {
      const closed = ev.status === 'closed';
      return `<tr><td>${e(ev.dateISO)}</td><td>${e(INCIDENT_TYPES[ev.type]?.label ?? ev.type)}</td>
        <td>${e(ev.desc)}${ev.firstAid ? `<br/>处置：${e(ev.firstAid)}${ev.sentToHospital ? ' · 已送医' : ''}` : ''}<br/>
        ${closed
          ? `家属告知：${e(ev.familyNotifiedAt)}（${e(ev.familyWay)}，通知人 ${e(ev.familyBy)}）<br/>复盘整改：${e(ev.reviewNote)}`
          : '<strong>⚠ 该事件尚未闭环</strong>'}</td></tr>`;
    }).join('')
    : '<tr><td colspan="3">（本时段无照护事件记录）</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>照护安全自证包 · ${e(r.name)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { color: #555; font-weight: 500; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>照护安全自证包 · ${e(r.name)}</h1>
<div class="meta">机构：${e(state.home?.name ?? '')}${state.home?.phone ? `（${e(state.home.phone)}）` : ''} · 出具日 ${e(todayISOStr)}</div>
<div class="meta">时段：${e(fromISO)} 至 ${e(toISO)} · 照料护理等级 ${e(CARE_LEVELS[r.careLevel]?.label ?? '—')} · 入住 ${e(r.admitISO)}${r.status === 'out' ? ` · 离院 ${e(r.outISO ?? '')}` : ''}</div>
<h2>一、九防风险评估与防护（GB 38600-2019）</h2>
<table>${riskRows}</table>
<h2>二、值班巡查覆盖（应打卡 ${b.coverage.planned} 班次 · 已打卡 ${b.coverage.done} · 缺口 ${b.coverage.missingCount}）</h2>
<table><tr><th>日期</th><th>缺口班次</th></tr>${gapRows}</table>
<h2>三、照护事件与家属告知</h2>
<table><tr><th>日期</th><th>类型</th><th>经过 · 处置 · 告知 · 复盘</th></tr>${incidentBlocks}</table>
<p class="meta">本包为机构服务安全自查与家属沟通用途的记录摘编；不替代法定信息档案（保管期限不少于服务协议期满后五年）、视频监控记录与民政报送。记录缺口如实列出，补记由当班人补录并注明。</p>
<div class="sign">机构（签字/盖章）：____________　查阅人（家属/检查人员）签字：____________　日期：____________</div>
<div class="foot">生成：护安单 CareLedger · ${e(todayISOStr)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 月报（值班完成度 / 事件闭环率——「这个月稳不稳」要有数）
// ---------------------------------------------------------------------------

export function monthlyReport(rounds, incidents, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const inMonth = (iso) => monthKey(iso) === month;
  const rs = (rounds ?? []).filter((e) => inMonth(e.dateISO));
  const es = (incidents ?? []).filter((e) => inMonth(e.dateISO));
  const closed = es.filter((e) => e.status === 'closed');
  return {
    rounds: rs.length,
    abnormal: rs.filter((e) => e.status === 'abnormal').length,
    shortNight: rs.filter((e) => e.shortNote).length,
    incidents: es.length,
    closed: closed.length,
    openLeft: es.length - closed.length,
  };
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'careledger', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'careledger') return { ok: false, error: '不是护安单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.home === 'object' && s.home !== null &&
    arr(s.residents) && arr(s.rounds) && arr(s.incidents) && arr(s.cycles) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
