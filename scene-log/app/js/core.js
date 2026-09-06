/**
 * core.js — 场记单 SceneLog 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；
 * 不碰收银/会员/网约，不连备案平台报送；所有周期与阈值参数（报备时限/巡查/月检/演练/
 * 培训/年检/寒暑假窗口）均可在设置中被门店覆盖；法定假日表为 2026 年官方安排的种子数据，
 * 属地校历与年度安排永远赢。
 *
 * 合规口径（原文均已于 2026-09-07 核验，链接见 docs/14-调研来源.md）：
 * - 《文化和旅游部 公安部 住房和城乡建设部 应急管理部 市场监管总局关于加强剧本娱乐经营场所
 *   管理的通知》（文旅市场发〔2022〕70号，2022-06-27 公开发布）：
 *   ① 实行告知性备案：通过全国文化市场技术监管与服务平台提交场所经营地址与正在使用的剧本脚本
 *     作者、简介、适龄范围等信息；新增剧本脚本或内容发生实质性变更的需再次备案；
 *   ② 适龄提示：使用的剧本脚本应当设置适龄提示、标明适龄范围；设置的场景不适宜未成年人的，
 *     应当在显著位置予以提示，并不得允许未成年人进入；
 *   ③ 未成年人限时：**除国家法定节假日、休息日及寒暑假期外，剧本娱乐经营场所不得向未成年人
 *     提供剧本娱乐活动**；
 *   ④ 选址与安全：不得设在居民楼内、建筑物地下一层以下等地（场所消防要求以 2023 消防指南为准）；
 *   ⑤ 经营范围应调整为「剧本娱乐活动」；政策过渡期至 2023-06-30（已届满，当前为常态监管）。
 * - 文化和旅游部办公厅《关于开展剧本娱乐专项整治工作的通知》（办综执发〔2023〕37号）及地方
 *   转发文件（大文广旅字〔2023〕13号，原文件型核验）列明的检查点，本工具的「迎检自证包」逐项对表：
 *   未按期备案／选址违规（居民楼内、学校和幼儿园周边不足 200 米）／未取得公众聚集场所消防审批／
 *   **剧本脚本自营业之日起 30 个自然日内未备案**／**新增或实质变更剧本自使用之日起 30 个自然日
 *   内未备案**／名称地址法人变更未办登记／内容违规／未设置适龄提示范围或未成年人禁入标识／
 *   违规向未成年人提供服务。
 * - 国家消防救援局、文化和旅游部《剧本娱乐经营场所消防安全指南（试行）》（2023-04-06 印发）：
 *   （一）选址：所在建筑应为合法建筑，不得设地下二层及以下、住宅建筑内、「三合一」场所、
 *         彩钢板建筑和村（居）民自建房内，不得与易燃易爆危险品场所同一建筑、不得毗连甲乙类仓库；
 *   （二）火灾自动报警系统；50㎡ 以上房间/长 20m 疏散走道排烟；每 50㎡ 至少一组 2 具 5kg 以上
 *         ABC 干粉灭火器，保护距离 ≤15m；
 *   （三）应急照明与疏散指示、明显位置设安全疏散指示图、>50㎡ 房间疏散门 ≥2 个、疏散门净宽
 *         ≥0.90m；
 *   （四）游玩场景全覆盖 24 小时可视监控并专人值班，监控值班区不得设在游玩场景区域；
 *   （五）事前告知消防注意事项与疏散路线；密室应为消费者配备对讲机、定位器（蜂鸣警报）；
 *   （六）疏散走道两侧耐火极限 ≥1.00h 防火隔墙；严禁低于 A 级彩钢板布景；
 *   （七）**一键开锁装置**：密室应可一键启动全部开锁（密码锁/电子锁/门禁全开）；
 *   （八）**每局剧本娱乐活动结束后必须进行一次防火巡查，至少每月一次全面防火检查**，定期对消防
 *         设施维护检测；营业结束后重点部位全面检查并切断非必要电源；
 *   （九）**每半年至少一次全员灭火和应急疏散演练，并分别选定白天与夜间开展**；
 *   （十）**每年至少一次消防安全培训**，新员工上岗前应经消防安全培训；
 *   （十一~二十）明火/电器/高温灯具/充电/易燃可燃装修/危险品/疏散通道/疏散门/障碍物等负面清单。
 * - 《国务院办公厅关于 2026 年部分节假日安排的通知》（国办发明电〔2025〕7号，2025-11-04）：
 *   元旦 1/1~1/3（1/4 上班）；春节 2/15~2/23（2/14、2/28 上班）；清明 4/4~4/6；
 *   劳动节 5/1~5/5（5/9 上班）；端午 6/19~6/21；中秋 9/25~9/27；国庆 10/1~10/7
 *   （9/20、10/10 上班）——**调休补班的周六日按工作日判定**，是纸质台账最容易踩的时段红线。
 * - 《中华人民共和国未成年人保护法》（2020 修订，2021-06-01 施行）第 58 条：营业性娱乐场所等
 *   不适宜未成年人活动场所的时限管理逻辑源；上海《密室剧本杀内容管理暂行规定》（2022-03-01
 *   施行，全国首个）与地方规定为属地深化，属地规则永远赢。
 * 本工具是门店侧的自证台账，不构成法律意见，不替代法定报送、消防审批与执法认定；
 * 平台备案以「全国文化市场技术监管与服务平台」实际办理结果为准，本工具只做时钟与留痕。
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

/** 'YYYY-MM' 月份键（月检分组用） */
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
// 口径常量（法定与通识口径的参数化，年度安排与属地规则永远赢）
// ---------------------------------------------------------------------------

/** 适龄分级（沿中国文化娱乐行业协会《剧本娱乐活动适龄提示指引（试行）》的 8+/12+/16+ 档） */
// 键不用整数样字符串（JS 对象整数样键会排到最前，破坏「全年龄」默认位）
export const AGE_RANGES = {
  all: '全年龄', g8: '8岁+', g12: '12岁+', g16: '16岁+', g18: '18岁禁入',
};

export const SCRIPT_KINDS = {
  boxed: '盒装', city: '城限', exclusive: '独家', self: '自写', escape: '密室机制',
};

/** 检查点口径：文旅专项整治清单 + 消防指南，自证包逐项对表 */
export const CHECK_POINTS = [
  { id: 'scope', label: '主体与经营范围', basis: '营业执照经营范围含「剧本娱乐活动」' },
  { id: 'filing', label: '场所与剧本备案', basis: '营业起30自然日场所备案；剧本自使用起30自然日备案；新增/实质变更再备案' },
  { id: 'site', label: '选址红线', basis: '非居民楼/住宅内；学校幼儿园周边≥200米；非地下二层及以下；非三合一/彩钢板/自建房' },
  { id: 'firelic', label: '消防手续', basis: '公众聚集场所投入使用/营业前消防安全检查（告知承诺）办理留痕' },
  { id: 'age', label: '适龄提示与禁入标识', basis: '剧本适龄范围标明；不适宜未成年人场景显著提示并禁入' },
  { id: 'minors', label: '未成年人限时', basis: '除国家法定节假日、休息日及寒暑假期外不得向未成年人提供' },
  { id: 'patrol', label: '每局巡查与月度检查', basis: '每局结束一次防火巡查；每月至少一次全面防火检查（消防指南八）' },
  { id: 'drill', label: '应急演练与培训', basis: '每半年至少一次演练（白天+夜间各一）；每年至少一次消防培训（消防指南九/十）' },
  { id: 'equip', label: '消防设施器材', basis: '火灾自动报警、每50㎡一组2具5kg ABC灭火器、应急照明、监控24h全覆盖、密室一键开锁' },
  { id: 'content', label: '内容自审', basis: '剧本脚本及表演/场景/道具/服饰内容自审留痕，禁含未保法等禁止内容' },
];

/** 2026 年官方假日表种子（国办发明电〔2025〕7号，MM-DD 字符串；可整体覆盖） */
export const HOLIDAYS_2026 = {
  holidays: [
    '01-01', '01-02', '01-03',
    '02-15', '02-16', '02-17', '02-18', '02-19', '02-20', '02-21', '02-22', '02-23',
    '04-04', '04-05', '04-06',
    '05-01', '05-02', '05-03', '05-04', '05-05',
    '06-19', '06-20', '06-21',
    '09-25', '09-26', '09-27',
    '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07',
  ],
  workdays: ['01-04', '02-14', '02-28', '05-09', '09-20', '10-10'],
};

/** 默认参数（设置页可全部覆盖） */
export const DEFAULT_LIMITS = {
  filingDays: 30,        // 剧本/场所备案时限（自然日，办综执发〔2023〕37号线检查口径）
  filingWarn: 7,         // 报备钟黄灯提前量
  patrolGrace: 0,        // 每局巡查无宽限（当局即查）
  drillDays: 183,        // 半年演练窗口
  drillWarn: 30,         // 演练钟黄灯提前量
  trainingDays: 365,     // 年度培训窗口
  trainingWarn: 30,
  extWarn: 30,           // 灭火器年检黄灯提前量
  monthCheckLate: 25,    // 每月 25 日起未月检升级红灯
};

export const STATE_VERSION = 1;

// ---------------------------------------------------------------------------
// 假日引擎：日型判定与未成年人时段红线
// ---------------------------------------------------------------------------

/**
 * 日型判定。优先级：调休补班（工作日）> 法定节假日 > 寒暑假 > 周末休息日 > 普通工作日。
 * cal: { year, holidays:['MM-DD'], workdays:['MM-DD'], vacWinter:[startISO,endISO], vacSummer:[startISO,endISO] }
 */
export function dayTypeOf(iso, cal) {
  assertISO(iso);
  if (!cal || !Array.isArray(cal.holidays) || !Array.isArray(cal.workdays)) {
    throw new Error('假日表缺失');
  }
  const md = iso.slice(5);
  if (cal.workdays.includes(md)) return 'comp';      // 调休补班＝工作日
  if (cal.holidays.includes(md)) return 'holiday';   // 国家法定节假日（含调休连休）
  for (const [s, e] of [cal.vacWinter, cal.vacSummer]) {
    if (s && e && iso >= s && iso <= e) return 'vacation';
  }
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) return 'rest';         // 休息日
  return 'work';
}

/** 该日是否允许向未成年人提供剧本娱乐活动（文旅市场发〔2022〕70号限时条款） */
export function minorsAllowedOn(iso, cal) {
  return ['holiday', 'vacation', 'rest'].includes(dayTypeOf(iso, cal));
}

export const DAY_TYPE_TEXT = {
  holiday: '法定节假日', vacation: '寒暑假', rest: '休息日',
  comp: '调休补班日', work: '工作日',
};

// ---------------------------------------------------------------------------
// 报备钟（场所首报 + 剧本报备，30 自然日）
// ---------------------------------------------------------------------------

/** 场所首报钟：自营业之日起 filingDays 内完成场所备案 */
export function venueFilingClock(openedISO, filedISO, today, limits = DEFAULT_LIMITS) {
  assertISO(openedISO);
  if (filedISO) {
    if (filedISO < openedISO) throw new Error('备案日期不得早于营业日期');
    return { level: 'ok', dueISO: openedISO, filedISO, daysLeft: null };
  }
  const dueISO = addDays(openedISO, limits.filingDays);
  const left = daysUntil(dueISO, today);
  const level = left < 0 ? 'overdue' : left <= limits.filingWarn ? 'warn' : 'todo';
  return { level, dueISO, filedISO: '', daysLeft: left };
}

/**
 * 剧本报备钟。锚点 = 实质变更日（若有）否则开始使用日；已报备且报备日不早于锚点 → 绿。
 * script: { useStartISO, filedISO, changedAtISO }
 */
export function filingClock(script, today, limits = DEFAULT_LIMITS) {
  const anchor = script.changedAtISO || script.useStartISO;
  if (!anchor) return { level: 'unset', dueISO: '', filedISO: script.filedISO || '', daysLeft: null };
  assertISO(anchor);
  if (script.filedISO && script.filedISO >= anchor) {
    return { level: 'ok', dueISO: addDays(anchor, limits.filingDays), filedISO: script.filedISO, daysLeft: null };
  }
  const dueISO = addDays(anchor, limits.filingDays);
  const left = daysUntil(dueISO, today);
  const level = left < 0 ? 'overdue' : left <= limits.filingWarn ? 'warn' : 'todo';
  return { level, dueISO, filedISO: script.filedISO || '', daysLeft: left };
}

/** 实质变更：重置报备（变更日成为新锚点，已备案状态失效） */
export function markScriptChanged(script, changedISO) {
  assertISO(changedISO);
  return { ...script, changedAtISO: changedISO };
}

// ---------------------------------------------------------------------------
// 开本（场次）与时段红线
// ---------------------------------------------------------------------------

/**
 * 场次合规判定。
 * session: { dateISO, minors, ageChecked, patrol }
 * script:  { name, ageRange, restrictedScene, ... }
 * 违规码：time-red（限时红线）/ age-ban（适龄禁入）/ age-unchecked（未核验年龄）/
 *         patrol-missing（每局防火巡查缺）
 */
export function sessionViolations(session, script, cal) {
  assertISO(session.dateISO);
  const v = [];
  const allowed = minorsAllowedOn(session.dateISO, cal);
  const banned = script.ageRange === 'g18' || script.restrictedScene;
  if (session.minors > 0) {
    if (!allowed) v.push({ code: 'time-red', sev: 'red', text: `${DAY_TYPE_TEXT[dayTypeOf(session.dateISO, cal)]}接待未成年人（限时红线）` });
    if (banned) v.push({ code: 'age-ban', sev: 'red', text: `${AGE_RANGES[script.ageRange]}${script.restrictedScene ? '·场景禁入' : ''}剧本接待未成年人` });
    if (!session.ageChecked) v.push({ code: 'age-unchecked', sev: 'warn', text: '接待未成年人未核验并留存年龄凭证' });
  }
  if (!session.patrol) v.push({ code: 'patrol-missing', sev: 'warn', text: '每局防火巡查未打卡（消防指南八）' });
  return v;
}

/** 撤销场次（先校验后变更：不存在即抛错，绝不静默） */
export function removeSession(sessions, sessionId) {
  const i = sessions.findIndex((s) => s.id === sessionId);
  if (i < 0) throw new Error('场次不存在');
  return sessions.filter((s) => s.id !== sessionId);
}

// ---------------------------------------------------------------------------
// 周期义务钟（月检 / 半年演练 / 年度培训 / 灭火器年检）
// ---------------------------------------------------------------------------

/** 月度全面防火检查：本月无记录=黄；本月 25 日起仍无=红（limits.monthCheckLate 可覆盖） */
export function monthlyCheckStatus(checks, today, limits = DEFAULT_LIMITS) {
  const mk = monthKey(today);
  const done = checks.some((c) => monthKey(c.dateISO) === mk);
  if (done) return { level: 'ok' };
  return { level: Number(today.slice(8)) >= limits.monthCheckLate ? 'overdue' : 'warn' };
}

/** 半年演练钟：窗口（drillDays）内白天、夜间各 ≥1 次；缺一=黄（另一类已临窗）缺二=红 */
export function drillStatus(drills, today, limits = DEFAULT_LIMITS) {
  const winStart = addDays(today, -limits.drillDays);
  const inWin = drills.filter((d) => d.dateISO >= winStart && d.dateISO <= today);
  const hasDay = inWin.some((d) => d.phase === 'day');
  const hasNight = inWin.some((d) => d.phase === 'night');
  if (hasDay && hasNight) return { level: 'ok', hasDay, hasNight };
  const anyEver = drills.length > 0;
  return { level: !anyEver || (!hasDay && !hasNight) ? 'overdue' : 'warn', hasDay, hasNight };
}

/** 年度培训钟：最近一次距今 ≤trainingDays=绿；剩 ≤trainingWarn=黄；超期或从未=红 */
export function trainingStatus(trainings, today, limits = DEFAULT_LIMITS) {
  if (!trainings.length) return { level: 'overdue', lastISO: '', daysLeft: null };
  const last = trainings.map((t) => t.dateISO).sort().at(-1);
  const due = addDays(last, limits.trainingDays);
  const left = daysUntil(due, today);
  const level = left < 0 ? 'overdue' : left <= limits.trainingWarn ? 'warn' : 'ok';
  return { level, lastISO: last, daysLeft: left };
}

/** 灭火器（或任一设施年检）钟：按下次检测到期日三色。第三参收天数或 limits 对象 */
export function expiryClock(dueISO, today, warnDays = DEFAULT_LIMITS) {
  assertISO(dueISO);
  const warn = typeof warnDays === 'number' ? warnDays : Number(warnDays?.extWarn ?? DEFAULT_LIMITS.extWarn);
  const left = daysUntil(dueISO, today);
  const level = left < 0 ? 'overdue' : left <= warn ? 'warn' : 'ok';
  return { level, dueISO, daysLeft: left };
}

/** 灭火器台账最差钟（多具取最差，全部逾期=红）。第三参收天数或 limits 对象 */
export function extinguisherBoard(exts, today, warnDays = DEFAULT_LIMITS) {
  if (!exts.length) return { level: 'unset', worst: null };
  const warn = typeof warnDays === 'number' ? warnDays : Number(warnDays?.extWarn ?? DEFAULT_LIMITS.extWarn);
  let worst = { level: 'ok', dueISO: '', daysLeft: Infinity };
  const rank = { ok: 0, warn: 1, overdue: 2, unset: 3 };
  for (const ex of exts) {
    const c = expiryClock(ex.nextCheckISO, today, warnDays);
    if (rank[c.level] >= rank[worst.level]) worst = { level: c.level, dueISO: c.dueISO, daysLeft: c.daysLeft, id: ex.id };
  }
  return { level: worst.level === 'ok' ? 'ok' : worst.level, worst };
}

// ---------------------------------------------------------------------------
// 隐患整改闭环（先校验后变更）
// ---------------------------------------------------------------------------

export function openIssue(issues, seq, { dateISO, desc, sev = 'warn', note = '' }) {
  assertISO(dateISO);
  if (!desc || !desc.trim()) throw new Error('隐患描述不得为空');
  const it = { id: `iss-${seq}`, dateISO, desc: desc.trim(), sev, note, status: 'open', closedISO: '', fix: '' };
  return { issues: [...issues, it], seq: seq + 1 };
}

export function closeIssue(issues, issueId, { closedISO, fix }) {
  if (!fix || !String(fix).trim()) throw new Error('整改措施不得为空（闭环必须留痕）');
  let hit = false;
  const next = issues.map((it) => {
    if (it.id !== issueId) return it;
    if (it.status === 'fixed') throw new Error('该隐患已闭环，不能重复销案');
    hit = true;
    return { ...it, status: 'fixed', closedISO: assertISO(closedISO), fix: String(fix).trim() };
  });
  if (!hit) throw new Error('隐患不存在');
  return next;
}

// ---------------------------------------------------------------------------
// 选址与设施自查（消防指南一~七的台账化；每项=undefined 视为未确认）
// ---------------------------------------------------------------------------

export const SETUP_ITEMS = [
  { id: 'legalBuilding', label: '所在建筑为合法建筑', basis: '消防指南一' },
  { id: 'notResidential', label: '非住宅建筑（居民楼）内', basis: '消防指南一 / 70号通知' },
  { id: 'floorOk', label: '不在地下二层及以下', basis: '消防指南一' },
  { id: 'notSanheyi', label: '非「三合一」/彩钢板/自建房', basis: '消防指南一' },
  { id: 'noHazmat', label: '不与易燃易爆危险品场所同建筑/毗连甲乙类仓库', basis: '消防指南一' },
  { id: 'schoolDist', label: '学校、幼儿园周边 ≥200 米', basis: '整治清单检查点2' },
  { id: 'fireAlarm', label: '火灾自动报警系统', basis: '消防指南二' },
  { id: 'extinguishers', label: '每50㎡一组2具5kg以上ABC干粉灭火器', basis: '消防指南二' },
  { id: 'emLights', label: '应急照明灯与灯光疏散指示标志', basis: '消防指南三' },
  { id: 'evacMap', label: '明显位置设安全疏散指示图', basis: '消防指南三' },
  { id: 'exitsOk', label: '>50㎡房间≥2疏散门、疏散门净宽≥0.90m', basis: '消防指南三' },
  { id: 'cctv24h', label: '游玩场景全覆盖24h监控+专人值班（值班区独立）', basis: '消防指南四' },
  { id: 'comms', label: '密室配对讲机/定位器（蜂鸣）', basis: '消防指南五' },
  { id: 'prebrief', label: '开场前告知消防注意事项与疏散路线', basis: '消防指南五' },
  { id: 'separation', label: '疏散走道两侧1.00h防火隔墙、无A级以下彩钢板布景', basis: '消防指南六' },
  { id: 'oneUnlock', label: '密室一键开锁装置（密码锁/电子锁/门禁全开）', basis: '消防指南七' },
  { id: 'evacClear', label: '疏散通道/出口畅通，无栅栏镜面遮挡物', basis: '消防指南十八~二十' },
  { id: 'signage', label: '适龄提示公示与未成年人禁入标识上墙', basis: '70号通知 / 整治清单检查点9' },
];

export function setupBoard(setup = {}) {
  const items = SETUP_ITEMS.map((it) => ({ ...it, ok: setup[it.id] === true }));
  const done = items.filter((i) => i.ok).length;
  return { items, done, total: items.length, missing: items.filter((i) => !i.ok).map((i) => i.id) };
}

// ---------------------------------------------------------------------------
// 账本体检灯（确定性扣分；空档 65 分）
// ---------------------------------------------------------------------------

const LAMP_RANK = { ok: 0, todo: 1, warn: 1, overdue: 2, unset: 2, red: 2 };

/**
 * 八灯体检：报备钟 / 时段红线 / 每局巡查 / 月检 / 演练 / 培训 / 灭火器 / 选址设施。
 * 红灯 -15，黄灯 -8，下限 0；无门店档案时返回固定 65 分（未建档基线）。
 */
export function healthCheck(state, today) {
  if (!state.venue || !state.venue.name) {
    return { score: 65, lamps: [{ id: 'venue', label: '门店档案', level: 'unset', detail: '未建档' }] };
  }
  const cal = state.calendar;
  const lamps = [];

  // ① 报备钟
  const scripts = state.scripts || [];
  const bad = scripts.filter((s) => ['overdue', 'unset'].includes(filingClock(s, today, state.limits).level));
  const warnS = scripts.filter((s) => filingClock(s, today, state.limits).level === 'warn');
  const vfc = state.venue.openedISO
    ? venueFilingClock(state.venue.openedISO, state.venue.filedISO, today, state.limits)
    : { level: 'unset' };
  const lv1 = ['overdue', 'unset'].includes(vfc.level) || bad.length ? 'overdue' : vfc.level === 'warn' || warnS.length ? 'warn' : 'ok';
  lamps.push({
    id: 'filing', label: '报备钟',
    level: lv1,
    detail: `剧本未备/逾期 ${bad.length}、临窗 ${warnS.length}；场所${{ ok: '已备', warn: '临窗', overdue: '逾期', unset: '未录营业日' }[vfc.level]}`,
  });

  // ② 时段红线
  const reds = (state.sessions || []).filter((se) => {
    const sc = scripts.find((s) => s.id === se.scriptId);
    return sc && sessionViolations(se, sc, cal).some((v) => v.sev === 'red');
  });
  lamps.push({ id: 'minors', label: '时段红线', level: reds.length ? 'overdue' : 'ok', detail: reds.length ? `${reds.length} 场违规接待未成年人` : '无限时违规场次' });

  // ③ 每局巡查（近 7 天）
  const since = addDays(today, -7);
  const recent = (state.sessions || []).filter((se) => se.dateISO >= since);
  const missP = recent.filter((se) => !se.patrol);
  lamps.push({ id: 'patrol', label: '每局巡查', level: missP.length ? 'warn' : 'ok', detail: `近7天 ${recent.length} 场、缺巡查 ${missP.length}` });

  // ④~⑦ 周期义务
  const mc = monthlyCheckStatus(state.checks || [], today, state.limits);
  lamps.push({ id: 'mcheck', label: '月度防火检查', level: mc.level === 'ok' ? 'ok' : mc.level === 'warn' ? 'warn' : 'overdue', detail: mc.level === 'ok' ? '本月已检' : '本月未检' });

  const dr = drillStatus(state.drills || [], today, state.limits);
  lamps.push({ id: 'drill', label: '半年演练', level: dr.level === 'ok' ? 'ok' : dr.level === 'warn' ? 'warn' : 'overdue', detail: `白天${dr.hasDay ? '✓' : '✗'} 夜间${dr.hasNight ? '✓' : '✗'}` });

  const tr = trainingStatus(state.trainings || [], today, state.limits);
  lamps.push({ id: 'training', label: '年度培训', level: tr.level === 'ok' ? 'ok' : tr.level === 'warn' ? 'warn' : 'overdue', detail: tr.lastISO ? `上次 ${tr.lastISO}` : '从未培训' });

  const ex = extinguisherBoard(state.extinguishers || [], today, state.limits);
  lamps.push({ id: 'ext', label: '灭火器年检', level: ex.level === 'ok' ? 'ok' : ex.level === 'warn' ? 'warn' : 'overdue', detail: ex.level === 'unset' ? '未建台账' : ex.worst?.dueISO ? `最近到期 ${ex.worst.dueISO}` : '未建台账' });

  // ⑧ 选址与设施 + 标识
  const sb = setupBoard(state.venue.setup);
  lamps.push({ id: 'setup', label: '选址与设施自查', level: sb.missing.length ? (sb.done === 0 ? 'overdue' : 'warn') : 'ok', detail: `${sb.done}/${sb.total} 项确认` });

  let score = 100;
  for (const l of lamps) score -= LAMP_RANK[l.level] === 2 ? 15 : LAMP_RANK[l.level] === 1 ? 8 : 0;
  return { score: Math.max(0, score), lamps };
}

// ---------------------------------------------------------------------------
// 出证三通道（单文件 HTML 无外部资源 + XSS 转义；微信文本确定性）
// ---------------------------------------------------------------------------

const FOOT_NOTE = '口径依据：文旅市场发〔2022〕70号通知；办综执发〔2023〕37号整治清单（地方转发原件核验）；《剧本娱乐经营场所消防安全指南（试行）》（国家消防救援局、文旅部 2023-04-06）；国办发明电〔2025〕7号2026年假日安排。本单为门店自查自证台账，不替代法定报送、消防审批与执法认定；属地规则永远赢。';

function levelBadge(lv) {
  const t = { ok: '绿·正常', warn: '黄·临窗', todo: '黄·待办', overdue: '红·逾期', unset: '红·未录' }[lv] ?? lv;
  return `<span class="pill lv-${lv.includes('overdue') || lv === 'unset' ? 'bad' : lv === 'ok' ? 'ok' : 'warn'}">${t}</span>`;
}

/** 迎检自证包：十大检查点逐项对表 + 全量台账，单文件 HTML（打印/存档两用） */
export function inspectionPackHtml(state, today) {
  const e = escapeHtml;
  const v = state.venue || {};
  const cal = state.calendar;
  const lim = state.limits;
  const scripts = (state.scripts || []).map((s) => {
    const c = filingClock(s, today, lim);
    return `<tr><td>${e(s.name)}</td><td>${e(SCRIPT_KINDS[s.kind] || s.kind || '')}</td><td>${e(AGE_RANGES[s.ageRange] || '')}${s.restrictedScene ? '·场景禁入' : ''}</td><td>${e(s.useStartISO)}</td><td>${c.level === 'ok' ? `已备案 ${e(c.filedISO)}（回执 ${e(s.filingNo || '—')}）` : c.level === 'unset' ? '未开始使用' : `${c.level === 'overdue' ? '已逾期' : '待备案'}，到期 ${e(c.dueISO)}`}</td></tr>`;
  }).join('') || '<tr><td colspan="5">（无剧本）</td></tr>';

  const sessions = (state.sessions || []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO) || (b.start || '').localeCompare(a.start || '')).slice(0, 200).map((se) => {
    const sc = (state.scripts || []).find((s) => s.id === se.scriptId);
    const viols = sc ? sessionViolations(se, sc, cal) : [];
    const dt = dayTypeOf(se.dateISO, cal);
    return `<tr><td>${e(se.dateISO)}</td><td>${e(DAY_TYPE_TEXT[dt])}${minorsAllowedOn(se.dateISO, cal) ? '' : '（限未成年）'}</td><td>${e(sc?.name || '已删剧本')}</td><td>${se.players}</td><td>${se.minors}${se.minors > 0 && !se.ageChecked ? '（未核验）' : ''}</td><td>${se.patrol ? '已巡查' : '<b>缺</b>'}</td><td>${viols.length ? e(viols.map((x) => x.text).join('；')) : '—'}</td></tr>`;
  }).join('') || '<tr><td colspan="7">（暂无开本记录）</td></tr>';

  const checks = (state.checks || []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 24)
    .map((c) => `<tr><td>${e(c.dateISO)}</td><td>${e(c.findings || '无异常')}</td><td>${e(c.fixed || '—')}</td></tr>`).join('') || '<tr><td colspan="3">（无月检记录）</td></tr>';
  const drills = (state.drills || []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12)
    .map((d) => `<tr><td>${e(d.dateISO)}</td><td>${d.phase === 'day' ? '白天' : '夜间'}</td><td>${e(d.note || '')}</td></tr>`).join('') || '<tr><td colspan="3">（无演练记录）</td></tr>';
  const trains = (state.trainings || []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12)
    .map((t) => `<tr><td>${e(t.dateISO)}</td><td>${e(t.topic || '消防安全培训')}</td><td>${e(t.coverage || '')}</td></tr>`).join('') || '<tr><td colspan="3">（无培训记录）</td></tr>';
  const exts = (state.extinguishers || []).map((x) => {
    const c = expiryClock(x.nextCheckISO, today, lim);
    return `<tr><td>${e(x.location || '')}</td><td>${x.count ?? ''}</td><td>${e(x.nextCheckISO)}</td><td>${levelBadge(c.level)}</td></tr>`;
  }).join('') || '<tr><td colspan="4">（无灭火器台账）</td></tr>';
  const issues = (state.issues || []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 24)
    .map((it) => `<tr><td>${e(it.dateISO)}</td><td>${e(it.desc)}</td><td>${it.status === 'fixed' ? `已闭环 ${e(it.closedISO)}：${e(it.fix)}` : '<b>未闭环</b>'}</td></tr>`).join('') || '<tr><td colspan="3">（无隐患记录）</td></tr>';
  const sb = setupBoard(v.setup);
  const setupRows = sb.items.map((i) => `<tr><td>${e(i.label)}</td><td>${e(i.basis)}</td><td>${i.ok ? '✓ 确认' : '□ 待确认'}</td></tr>`).join('');
  const hc = healthCheck(state, today);

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>剧本娱乐场所迎检自证包 · ${e(v.name || '')}</title>
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:24px auto;max-width:880px;color:#1c1a2e;line-height:1.55}h1{font-size:20px}h2{font-size:15px;border-left:4px solid #5c3a8e;padding-left:8px;margin-top:26px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #d0cfdf;padding:4px 6px;text-align:left;vertical-align:top}.pill{padding:1px 8px;border-radius:99px;font-size:11px}.lv-ok{background:#e9f7ef;color:#0c6e46}.lv-warn{background:#fdf6e6;color:#8f4a0a}.lv-bad{background:#fdf2f0;color:#ab2c1d}.meta{color:#4d5060;font-size:12px}.sign{margin-top:30px;display:flex;gap:48px;font-size:13px}.note{font-size:11px;color:#6b6d80;margin-top:22px;border-top:1px solid #d0cfdf;padding-top:8px}@media print{body{margin:0}}</style></head><body>
<h1>剧本娱乐经营场所 迎检自证包</h1>
<p class="meta">门店：${e(v.name || '—')} ｜ 负责人：${e(v.manager || '—')} ｜ 地址：${e(v.address || '—')} ｜ 营业日：${e(v.openedISO || '—')} ｜ 业态：${e([v.jubensha ? '剧本杀' : '', v.escape ? '密室' : ''].filter(Boolean).join('＋') || '—')}<br>账本体检：${hc.score} 分 ｜ 生成日期：${e(today)} ｜ 备案回执：${e(v.filingNo || '—')}</p>
<h2>① 主体与经营范围（CHECK_POINTS.scope）</h2><p>营业执照经营范围含「剧本娱乐活动」：${v.scopeAdjusted ? '✓ 已调整' : '□ 待调整'}；消防手续（投入使用/营业前消防安全检查）：${e(v.fireCheck || '未登记')}</p>
<h2>② 场所与剧本备案（70号通知·告知性备案）</h2><p>场所首报：${v.openedISO ? levelBadge(venueFilingClock(v.openedISO, v.filedISO, today, lim).level) + (v.filedISO ? ` 备案日 ${e(v.filedISO)}` : '') : '未录营业日'}；剧本脚本通过「全国文化市场技术监管与服务平台」报备，时限 ${lim.filingDays} 自然日。</p>
<table><tr><th>剧本</th><th>类型</th><th>适龄</th><th>开始使用</th><th>报备状态</th></tr>${scripts}</table>
<h2>③ 选址红线与消防设施自查（消防指南一~七）</h2><table><tr><th>项目</th><th>依据</th><th>自查</th></tr>${setupRows}</table>
<h2>④ 未成年人保护（限时＋适龄＋核验）</h2><p>限时口径：除国家法定节假日、休息日及寒暑假期外不得向未成年人提供；2026 年假日表已内置（含调休补班日按工作日判定）。</p>
<h2>⑤ 每局巡查与开本台账（近 200 场）</h2><table><tr><th>日期</th><th>日型</th><th>剧本</th><th>人数</th><th>未成年</th><th>每局巡查</th><th>合规提示</th></tr>${sessions}</table>
<h2>⑥ 月度全面防火检查</h2><table><tr><th>日期</th><th>发现</th><th>整改</th></tr>${checks}</table>
<h2>⑦ 应急疏散演练（白天/夜间）</h2><table><tr><th>日期</th><th>时段</th><th>备注</th></tr>${drills}</table>
<h2>⑧ 消防安全培训</h2><table><tr><th>日期</th><th>主题</th><th>覆盖</th></tr>${trains}</table>
<h2>⑨ 灭火器台账</h2><table><tr><th>位置</th><th>数量</th><th>下次检测</th><th>状态</th></tr>${exts}</table>
<h2>⑩ 隐患整改闭环</h2><table><tr><th>发现日</th><th>隐患</th><th>状态</th></tr>${issues}</table>
<div class="sign"><span>负责人签字：＿＿＿＿＿＿</span><span>消防安全管理员：＿＿＿＿＿＿</span><span>日期：＿＿＿＿＿＿</span></div>
<p class="note">${FOOT_NOTE}</p></body></html>`;
}

/** 每局巡查卡（当日 printable，场记板式打勾） */
export function patrolCardHtml(state, dateISO) {
  const e = escapeHtml;
  const cal = state.calendar;
  const allowed = minorsAllowedOn(dateISO, cal);
  const list = (state.sessions || []).filter((se) => se.dateISO === dateISO);
  const rows = list.map((se, i) => {
    const sc = (state.scripts || []).find((s) => s.id === se.scriptId);
    const warn = !allowed && se.minors > 0 ? '<b style="color:#ab2c1d">限时红线！</b>' : '';
    return `<tr><td>${i + 1}</td><td>${e(se.start || '')}</td><td>${e(sc?.name || '已删剧本')}</td><td>${se.players}${se.minors ? `（未成年${se.minors}${se.ageChecked ? '已核验' : '未核验'}）` : ''}</td><td>□ 局后防火巡查　□ 疏散通道畅　□ 断非必要电</td><td>${warn}</td></tr>`;
  }).join('') || '<tr><td colspan="6">（当日无场次——也请在打烊后完成重点部位检查并切断非必要电源）</td></tr>';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>每局防火巡查卡 · ${e(dateISO)}</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;margin:24px auto;max-width:760px;color:#1c1a2e}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #d0cfdf;padding:5px 6px;text-align:left}.note{font-size:11px;color:#6b6d80;margin-top:18px}</style></head><body>
<h2>每局防火巡查卡（消防指南八：每局活动结束后必须巡查一次）</h2>
<p>${e(state.venue?.name || '')} ｜ ${e(dateISO)} ｜ 今日${e(DAY_TYPE_TEXT[dayTypeOf(dateISO, cal)])}，${allowed ? '可接待未成年人（仍需核验年龄）' : '<b>不得接待未成年人</b>'}</p>
<table><tr><th>#</th><th>开场</th><th>剧本</th><th>人数</th><th>局后三查（打勾）</th><th>提示</th></tr>${rows}</table>
<p>打烊检查：□ 重点部位全面检查　□ 切断非必要电源　□ 一键开锁自测　□ 监控在录</p>
<p class="note">依据《剧本娱乐经营场所消防安全指南（试行）》第（八）条；本卡为门店自查留痕，不替代法定检查记录。</p></body></html>`;
}

/** 月度小结（微信文本，确定性） */
export function monthlySummaryText(state, month, today) {
  const cal = state.calendar;
  const lim = state.limits;
  const mk = month;
  const sessions = (state.sessions || []).filter((se) => monthKey(se.dateISO) === mk);
  const minorsSessions = sessions.filter((se) => se.minors > 0);
  const illegal = minorsSessions.filter((se) => !minorsAllowedOn(se.dateISO, cal));
  const missPatrol = sessions.filter((se) => !se.patrol);
  const newScripts = (state.scripts || []).filter((s) => monthKey(s.changedAtISO || s.useStartISO || today) === mk);
  const pending = newScripts.filter((s) => ['warn', 'todo', 'overdue', 'unset'].includes(filingClock(s, today, lim).level));
  const mc = monthlyCheckStatus(state.checks || [], today, lim);
  const dr = drillStatus(state.drills || [], today, lim);
  const tr = trainingStatus(state.trainings || [], today, lim);
  const hc = healthCheck(state, today);
  const lines = [
    `【场记单·${mk} 月度小结】${state.venue?.name || ''}`,
    `开本 ${sessions.length} 场｜接待未成年 ${minorsSessions.length} 场｜限时红线 ${illegal.length} 场｜缺局后巡查 ${missPatrol.length} 场`,
    `本月新上剧本 ${newScripts.length} 个，其中待备案 ${pending.length} 个`,
    `月检${mc.level === 'ok' ? '已完成' : '未完成'}｜演练白天${dr.hasDay ? '✓' : '✗'}夜间${dr.hasNight ? '✓' : '✗'}｜培训${tr.level === 'ok' ? '在有效期内' : '待安排'}`,
    `账本体检 ${hc.score} 分（100-红灯×15-黄灯×8）`,
    `——本单为门店自查台账，属地规则永远赢`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 导入导出（结构校验：异构整体拒绝）
// ---------------------------------------------------------------------------

export function exportBundle(state) {
  return JSON.stringify({ app: 'scene-log', version: STATE_VERSION, exportedAt: new Date().toISOString(), state }, null, 2);
}

export function importBundle(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('不是合法 JSON');
  }
  if (!raw || raw.app !== 'scene-log' || typeof raw.state !== 'object') {
    throw new Error('不是场记单的备份文件');
  }
  const s = raw.state;
  for (const k of ['scripts', 'sessions', 'checks', 'drills', 'trainings', 'extinguishers', 'issues', 'calendar', 'limits']) {
    if (!(k in s)) throw new Error(`备份缺少字段 ${k}，疑似异构数据`);
  }
  for (const se of s.sessions) {
    assertISO(se.dateISO);
    if (se.players <= 0) throw new Error('备份数据异常：场次人数非法');
  }
  for (const sc of s.scripts) {
    if (sc.useStartISO) assertISO(sc.useStartISO);
    if (sc.filedISO) assertISO(sc.filedISO);
  }
  return s;
}
