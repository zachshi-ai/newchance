/**
 * core.js — 叉车账 ForkLog 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；周期/时限/提醒窗口等口径
 * 全部参数化，可在设置中被企业覆盖（属地规则与主管部门要求永远赢）。
 *
 * 合规口径（原文链接与核验方式见 docs/14-调研来源.md，全部 2026-09-08 一手核验）：
 * - 《中华人民共和国特种设备安全法》（2013-06-29 通过，2014-01-01 施行，迄今未修订、条号稳定）：
 *   第 13 条（配备安全管理人员、检测人员和作业人员并进行安全教育和技能培训）、
 *   第 14 条（相关人员应按国家规定取得相应资格方可从业）、
 *   第 33 条（投入使用前或投入使用后 30 日内办理使用登记，取得使用登记证书；登记标志置于显著位置）、
 *   第 34 条（建立岗位责任、隐患治理、应急救援等安全管理制度，制定操作规程）、
 *   第 35 条（建立安全技术档案五项：技术资料、定检与定期自行检查记录、日常使用状况记录、
 *            维护保养记录、运行故障和事故记录）、
 *   第 39 条（经常性维护保养和定期自行检查并作出记录；安全附件、安全保护装置定期校验检修并记录）、
 *   第 40 条（检验合格有效期届满前 1 个月向检验机构提出定期检验要求；
 *            未经定期检验或者检验不合格的特种设备，不得继续使用；定检标志置于显著位置）、
 *   第 41 条（安全管理人员经常性检查；作业人员发现隐患立即报告）、
 *   第 42 条（出现故障或异常情况应全面检查、消除事故隐患方可继续使用）、
 *   第 47 条（改造、修理按规定需要变更使用登记的，应当办理变更登记，方可继续使用）、
 *   第 48 条（严重事故隐患无改造修理价值或达报废条件：依法履行报废义务、消除使用功能、
 *            向原登记部门办理使用登记证书注销；达设计使用年限继续使用须经检验或安全评估）、
 *   第 83 条（未办理使用登记/未建安全技术档案或未设标志/未维保自检记录/未及时申报检验/
 *            无应急预案：责令限期改正，逾期未改责令停用+1 万~10 万）、
 *   第 84 条（使用未经检验/检验不合格/已报废设备，或异常未消除继续使用，或应报废未报废
 *            未注销：责令停用+3 万~30 万）、
 *   第 86 条（未配备持证人员/使用无证人员作业/未开展培训：责令改正，逾期未改停用相关设备
 *            或停产停业整顿+1 万~5 万）、
 *   第 100 条（房屋建筑工地、市政工程工地用起重机械和场（厂）内专用机动车辆的安装使用的
 *            监督管理由有关部门实施——工地场景不归市场监管线，本工具目标场景为
 *            工厂厂区/物流仓储/旅游景区等「三区」内的场车）。
 * - 《特种设备使用单位落实使用安全主体责任监督管理规定》（国家市场监督管理总局令第 74 号，
 *   2023-03-27 通过，2023-05-05 施行；第 2 条：房屋建筑工地、市政工程工地用起重机械和场（厂）内
 *   专用机动车辆使用安全责任不适用本规定——即工地场车除外，厂区/园区/景区场车适用）：
 *   第十章「场（厂）内专用机动车辆」：
 *   第 135 条（使用单位依法配备场车安全总监和场车安全员，明确岗位职责；主要负责人全面负责）、
 *   第 136 条（安全员发现一般事故隐患立即处理；发现严重事故隐患立即责令停止使用并报告，
 *            总监立即组织分析研判、处置消除）、
 *   第 137 条（按场车数量、用途、使用环境配备总监和足够数量的安全员，并逐台明确负责的场车安全员）、
 *   第 139 条（场车安全总监九项职责：贯彻法规、制定制度、预案与演练、事故报告、培训监督、
 *            风险评价、检查报告、配合监督检查等）、
 *   第 140 条（场车安全员七项职责：建立健全场车安全技术档案并办理使用登记、制定操作规程、
 *            组织作业人员教育培训、对场车和作业区域日常巡检、编制定期检验计划督促定检与整改、
 *            报告事故、其他职责）、
 *   第 141 条（制定《场车安全风险管控清单》，建立健全日管控、周排查、月调度工作制度和机制）、
 *   第 142 条（日管控：安全员每日按清单对投入使用的场车和作业区域巡检，形成《每日场车安全
 *            检查记录》；发现隐患立即防范并上报；未发现问题也应当予以记录，实行零风险报告）、
 *   第 143 条（周排查：安全总监每周至少组织一次风险隐患排查，形成《每周场车安全排查治理报告》）、
 *   第 144 条（月调度：主要负责人每月至少听取一次工作情况汇报，形成《每月场车安全调度会议纪要》）、
 *   第 145 条（「两员」设立调整、清单、职责、守则及履职记录存档备查）、
 *   第 146 条（市场监管部门将日管控、周排查、月调度及整改情况作为监督检查的重要内容）、
 *   第 147 条（对「两员」培训考核并记录存档；县局按《场车使用安全管理人员考核指南》随机监督
 *            抽查考核）、
 *   第 148 条（查处违法行为时将落实主体责任情况作为主观过错、违法情节、处罚幅度考量因素；
 *            无正当理由未采纳「两员」意见建议的，视为已履职尽责不予处罚——记录即免罚抗辩证据）、
 *   第 149 条（未建制度或未配备/培训/考核「两员」：责令改正+通报批评，拒不改正 5000~5 万并
 *            纳入信用公示；「两员」未落实责任：拒不改正对责任人 2000~1 万）。
 * - TSG 81—2022《场（厂）内专用机动车辆安全技术规程》（市场监管总局 2022 年第 26 号公告发布，
 *   2022-12-01 施行；实施口径见市监特设发〔2022〕87 号）：
 *   第 4.2.1.2 条口径（在用叉车定期检验每 2 年 1 次——由旧规程 1 年调整为 2 年；
 *   在用非公路用旅游观光车辆每 1 年 1 次）；检验报告的下次检验日期精确到月，
 *   以首次检验或停用后重新检验的合格日期为基准；
 *   87 号意见：工厂厂区、旅游景区、游乐场所（「三区」）内场车按新版规程监管；使用登记在
 *   产权单位所在地办理，跨区域流动作业不得要求重复登记；
 *   自 2023-12-01 起新生产出厂的叉车必须安装安全监控装置，定检项目含安全监控装置检查
 *   （此前出厂且未装的，定检可不包含该项目）。
 * - TSG Z6001—2019《特种设备作业人员考核规则》：特种设备作业人员证（叉车司机项目 N1）
 *   有效期 4 年；持证人员应当在持证项目有效期届满 1 个月以前向发证机关提出复审申请
 *   （注意：旧版规则的「届满前 3 个月」已改，引旧口径即错）；逾期未复审或复审不合格，
 *   证书失效须重新考试（广东省政务服务网、陕西考核平台办事指南口径交叉核验）。
 * - 《特种设备目录》（质检总局 2014 年第 114 号公告修订版）：特种设备共八大类；
 *   场（厂）内专用机动车辆（代码 5000）分两品种——机动工业车辆（5100，叉车：可由司机直接操纵
 *   （含遥控），通过门架和货叉将载荷起升到一定高度进行作业的自行式车辆）、非公路用旅游观光
 *   车辆（5200）；场车定义：除道路交通、农用车辆以外仅在工厂厂区、旅游景区、游乐场所等
 *   特定区域使用的专用机动车辆。
 * - TSG 08—2026《特种设备使用管理规则》（市场监管总局公告 2026 年第 6 号，2026-02-02 发布，
 *   2026-05-01 施行，替代 TSG 08-2017；公告明示「为贯彻落实总局令第 74 号」修订）：
 *   使用登记、变更、停用、注销与档案的现行实施细则载体（官方 PDF 为扫描版，条款引用以
 *   公告与特设法为准，属地登记机关窗口口径永远赢）。
 * - 统计口径（市场监管总局《关于 2024 年全国特种设备安全状况的通报》，2026-09-08 一手核验）：
 *   截至 2024 年底全国特种设备总量 2294.18 万台，其中场（厂）内专用机动车辆 230.86 万台；
 *   2024 年场车事故 43 起、死亡 36 人，为特种设备中事故起数最多的类别（电梯 41 起、起重机械
 *   36 起）；场车、电梯和起重机械合计占事故总起数 90.90%、死亡总人数 91.23%；
 *   结案事故中因使用、管理不当发生的约占 81.36%，违章作业（操作不当甚至无证上岗）是主因。
 *
 * 本工具是场车使用单位侧的自证台账，不构成法律意见，不替代使用登记、定期检验申报、
 * 变更/注销登记等法定程序；属地规则、登记机关与监管部门要求永远赢。
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

/**
 * 日期加 n 个月，月末钳制（如 1 月 31 日 + 12 个月 = 次年 1 月 31 日；
 * 8 月 31 日 + 24 个月 = 2028-08-31；2 月 29 日 + 12 = 2 月 28 日钳制）。
 * 定检周期「精确到月」用。
 */
export function addMonthsExact(iso, n) {
  assertISO(iso);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`月数必须为正整数: ${n}`);
  const d = new Date(`${iso}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(y, m + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
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

/** ISO 周键（周一为一周之始），形如 '2026-W37'（周排查「每周至少一次」的判重键） */
export function isoWeekKey(iso) {
  assertISO(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7; // 周一=0 … 周日=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // 本周四
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 口径常量（法定口径的参数化，属地规则与主管部门要求永远赢）
// ---------------------------------------------------------------------------

/** 场车品种（特种设备目录 2014 年 114 号公告：5000 场车 = 5100 机动工业车辆 + 5200 观光车辆） */
export const VEHICLE_KINDS = {
  forklift: '叉车（机动工业车辆）',
  sightseeing: '非公路用旅游观光车辆',
};

/** 在用场车定期检验周期（月）：TSG 81—2022 第 4.2.1.2 条口径——叉车 2 年、观光车 1 年 */
export const INSPECT_CYCLE_MONTHS = { forklift: 24, sightseeing: 12 };

/** 检验合格有效期届满前向检验机构提出定检要求的时间（特设法第 40 条：届满前 1 个月） */
export const INSPECT_APPLY_ADVANCE_DAYS = 30;

/** 特种设备作业人员证（叉车司机 N1）有效期（年）：TSG Z6001—2019 */
export const CERT_VALID_YEARS = 4;
/** 复审申请窗口：有效期届满 1 个月以前提出复审申请（TSG Z6001—2019 第 25 条口径） */
export const REEXAM_ADVANCE_DAYS = 30;
/** 证照临期提醒（天，产品口径，早于法定申请窗口，只提示不判定） */
export const CERT_WARN_DAYS = 60;

/** 投入使用前或投入使用后 30 日内办理使用登记（特设法第 33 条） */
export const REG_WITHIN_DAYS = 30;

/** 日管控/周排查/月调度（74 号令第 141~144 条） */
export const PATROL_RESULT = { ok: '无异常（零风险报告）', found: '发现隐患' };
export const HAZARD_SOURCES = { daily: '日管控巡检', weekly: '周排查', monthly: '月调度', manual: '自查上报' };
export const HAZARD_SEVERITIES = { general: '一般事故隐患', serious: '严重事故隐患' };

/** 周期义务（周期为参数化默认值，属地要求永远赢；74 号令第 139/147 条、特设法第 13 条） */
export const DUTY_KINDS = {
  training: { label: '作业人员/两员安全教育培训', cycleDays: 365, basis: '特设法第 13 条·74 号令第 139/147 条' },
  drill: { label: '场车事故应急专项预案演练', cycleDays: 365, basis: '74 号令第 139 条(三)' },
  risklist: { label: '场车安全风险管控清单评审更新', cycleDays: 180, basis: '74 号令第 141 条' },
};

/** 日管控断卡判定（天）：连续无任何巡检打卡超过该天数 → 体检红灯 */
export const DEFAULT_PATROL_GAP_DAYS = 2;
/** 证照/台账类缺口提醒（天） */
export const DEFAULT_APPLY_ADVANCE_DAYS = 30;
export const DEFAULT_REEXAM_WARN_DAYS = 60;

// ---------------------------------------------------------------------------
// 使用单位建档（74 号令第 135 条主体 + 两员配备）
// ---------------------------------------------------------------------------

/**
 * 「两员」配备状态（74 号令第 135/137 条：依法配备场车安全总监与场车安全员，
 * 并逐台明确负责的场车安全员）。
 */
export function dutyRosterState(station, vehicles = []) {
  const hasDirector = Boolean(station?.directorName);
  const hasOfficer = Boolean(station?.officerName);
  const unbound = vehicles.filter((v) => !v.scrappedISO && !v.keeperName);
  if (!hasDirector && !hasOfficer) {
    return { level: 'unset', unbound: unbound.length, detail: '未登记场车安全总监与场车安全员（74 号令第 135 条：依法配备并明确岗位职责；未配备拒不改正 5000~5 万，第 149 条）' };
  }
  if (!hasDirector || !hasOfficer) {
    return { level: 'unset', unbound: unbound.length, detail: `只登记了${hasDirector ? '场车安全总监' : '场车安全员'}——两员都应配备并明确职责（74 号令第 135 条）` };
  }
  if (unbound.length) {
    return { level: 'warn', unbound: unbound.length, detail: `${unbound.length} 台在用场车未逐台明确负责的场车安全员（74 号令第 137 条）` };
  }
  return { level: 'ok', unbound: 0, detail: `两员已配备：总监 ${station.directorName} · 安全员 ${station.officerName}${unbound.length ? '' : '，在用场车已逐台绑定安全员'}` };
}

// ---------------------------------------------------------------------------
// 车辆一车一档（使用登记 + 定检钟 + 报废注销）
// ---------------------------------------------------------------------------

/**
 * 建档一台场车。vehicle: { plateNo, kind, brand, regNo, firstUseISO, lastInspectISO,
 * keeperName, monitor, ownerType, note }
 * 闸机（硬拒绝）：车牌/设备编号与品种必填；品种必须在目录两品种内。
 * 有最近定检合格日时，自动推导下次定检到期日（+24/12 个月，精确到月、月末钳制）。
 */
export function addVehicle(state, { plateNo, kind, brand = '', regNo = '', firstUseISO = '', lastInspectISO = '', keeperName = '', monitor = false, ownerType = 'own', note = '' }) {
  if (!String(plateNo || '').trim()) throw new Error('场车车牌/设备编号必填——一车一档的档主');
  if (!VEHICLE_KINDS[kind]) throw new Error(`非法品种: ${kind}（特种设备目录场车仅叉车与非公路用旅游观光车辆两品种）`);
  if (firstUseISO) assertISO(firstUseISO);
  if (lastInspectISO) assertISO(lastInspectISO);
  if ((state.vehicles ?? []).some((v) => v.plateNo === plateNo)) {
    throw new Error(`${plateNo} 已建档（同车牌/设备编号唯一）`);
  }
  state.vehicleSeq = (state.vehicleSeq ?? 0) + 1;
  const rec = {
    id: `vh-${state.vehicleSeq}`, plateNo, kind, brand, regNo,
    firstUseISO, lastInspectISO,
    inspectionDueISO: lastInspectISO ? addMonthsExact(lastInspectISO, INSPECT_CYCLE_MONTHS[kind]) : '',
    keeperName, monitor: !!monitor, ownerType, scrappedISO: '', cancelISO: '', modifiedISO: '', changeRegISO: '',
    note,
  };
  state.vehicles.push(rec);
  return rec;
}

/** 在用车辆（未报废） */
export function activeVehicles(state) {
  return (state.vehicles ?? []).filter((v) => !v.scrappedISO);
}

/**
 * 定检钟（特设法第 40 条：届满前 1 个月申请；未经定检或检验不合格不得继续使用）。
 * applyAdvanceDays 参数化（默认 30 天=法定申请窗口）。
 */
export function inspectState(vehicle, todayISOStr, applyAdvanceDays = INSPECT_APPLY_ADVANCE_DAYS) {
  assertISO(todayISOStr);
  const adv = typeof applyAdvanceDays === 'number' ? applyAdvanceDays : INSPECT_APPLY_ADVANCE_DAYS;
  if (vehicle.scrappedISO) return { level: 'none', detail: '已报废停用' };
  if (!vehicle.inspectionDueISO) {
    return { level: 'unset', detail: '未登记定检有效期——请按检验报告填写最近定检合格日或下次到期日' };
  }
  const daysLeft = daysUntil(vehicle.inspectionDueISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `定检已于 ${vehicle.inspectionDueISO} 到期——未经定期检验的场车不得继续使用（特设法第 40 条），使用未经检验设备罚 3 万~30 万（第 84 条）` };
  }
  if (daysLeft <= adv) {
    return { level: 'due', daysLeft, detail: `定检 ${vehicle.inspectionDueISO} 到期（剩 ${daysLeft} 天）——应在届满前 1 个月向检验机构提出定检要求（特设法第 40 条），现在就约` };
  }
  return { level: 'ok', daysLeft, detail: `定检有效期至 ${vehicle.inspectionDueISO}` };
}

/**
 * 记录一次定检合格：更新最近定检合格日并自动推导下次到期日。
 * 合格日不得晚于今天；同日重复记录=更新（覆盖）。
 */
export function recordInspection(state, vehicleId, passISO, note = '') {
  assertISO(passISO);
  const v = (state.vehicles ?? []).find((x) => x.id === vehicleId);
  if (!v) throw new Error(`车辆不存在: ${vehicleId}`);
  if (v.scrappedISO) throw new Error('该车已报废停用，无需再检');
  v.lastInspectISO = passISO;
  v.inspectionDueISO = addMonthsExact(passISO, INSPECT_CYCLE_MONTHS[v.kind]);
  if (note) v.note = note;
  return v;
}

/** 登记改造/重大修理（特设法第 47 条：需变更使用登记的应办理变更登记后方可继续使用） */
export function markModified(state, vehicleId, modifiedISO) {
  assertISO(modifiedISO);
  const v = (state.vehicles ?? []).find((x) => x.id === vehicleId);
  if (!v) throw new Error(`车辆不存在: ${vehicleId}`);
  if (v.scrappedISO) throw new Error('该车已报废');
  v.modifiedISO = modifiedISO;
  return v;
}

/** 办妥变更使用登记（47 条闭环） */
export function fileChangeReg(state, vehicleId, changeRegISO) {
  assertISO(changeRegISO);
  const v = (state.vehicles ?? []).find((x) => x.id === vehicleId);
  if (!v) throw new Error(`车辆不存在: ${vehicleId}`);
  if (!v.modifiedISO) throw new Error('该车未登记改造/重大修理，无需变更登记');
  if (changeRegISO < v.modifiedISO) throw new Error('变更登记日期早于改造日期');
  v.changeRegISO = changeRegISO;
  return v;
}

/** 登记报废（特设法第 48 条：履行报废义务、消除使用功能、向原登记部门办理注销） */
export function scrapVehicle(state, vehicleId, scrappedISO) {
  assertISO(scrappedISO);
  const v = (state.vehicles ?? []).find((x) => x.id === vehicleId);
  if (!v) throw new Error(`车辆不存在: ${vehicleId}`);
  if (v.scrappedISO) throw new Error('该车已登记报废');
  v.scrappedISO = scrappedISO;
  return v;
}

/** 办理使用登记证书注销（48 条闭环；应报废未报废未注销罚 3 万~30 万，84 条(三)） */
export function cancelVehicle(state, vehicleId, cancelISO) {
  assertISO(cancelISO);
  const v = (state.vehicles ?? []).find((x) => x.id === vehicleId);
  if (!v) throw new Error(`车辆不存在: ${vehicleId}`);
  if (!v.scrappedISO) throw new Error('先登记报废（履行报废义务），再登记注销手续');
  if (cancelISO < v.scrappedISO) throw new Error('注销日期早于报废日期');
  v.cancelISO = cancelISO;
  return v;
}

/** 使用登记状态（特设法第 33 条：投用前或投用后 30 日内登记） */
export function regState(vehicle, todayISOStr) {
  assertISO(todayISOStr);
  if (vehicle.regNo) return { level: 'ok', detail: `使用登记证号 ${vehicle.regNo}` };
  if (vehicle.firstUseISO) {
    const deadline = addDays(vehicle.firstUseISO, REG_WITHIN_DAYS);
    const daysLeft = daysUntil(deadline, todayISOStr);
    if (daysLeft < 0) {
      return { level: 'overdue', daysLeft, deadline, detail: `投用 ${vehicle.firstUseISO} 已超 30 日未办使用登记（期限 ${deadline}）——未按规定登记罚 1 万~10 万（特设法第 83 条(一)）` };
    }
    return { level: 'due', daysLeft, deadline, detail: `投用 ${vehicle.firstUseISO}——应在 ${deadline} 前（投用前或后 30 日内）办理使用登记（特设法第 33 条）` };
  }
  return { level: 'unset', detail: '未登记使用登记证号——请补录登记证号或投用日' };
}

// ---------------------------------------------------------------------------
// 作业人员名册（N1 证钟：有效期 4 年 + 复审申请窗口）
// ---------------------------------------------------------------------------

/**
 * 司机入册。driver: { name, certNo, expiryISO, phone, note }
 * 闸机：姓名与证号必填；同姓名同证号拒绝。
 */
export function addDriver(state, { name, certNo, expiryISO = '', phone = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('司机姓名必填');
  if (!String(certNo || '').trim()) throw new Error('N1 证号必填——无证驾驶叉车属特种设备违法（特设法第 14/86 条）');
  if (expiryISO) assertISO(expiryISO);
  if ((state.drivers ?? []).some((d) => d.name === name && d.certNo === certNo)) {
    throw new Error(`${name}（${certNo}）已在名册中`);
  }
  state.driverSeq = (state.driverSeq ?? 0) + 1;
  const rec = { id: `dr-${state.driverSeq}`, name, certNo, expiryISO, phone, active: true, note };
  state.drivers.push(rec);
  return rec;
}

/** 停用/恢复司机（离职停用不删除，历史派工单可回溯到人） */
export function setDriverActive(state, driverId, active) {
  const rec = (state.drivers ?? []).find((d) => d.id === driverId);
  if (!rec) throw new Error(`司机不存在: ${driverId}`);
  rec.active = !!active;
  return rec;
}

export function activeDrivers(state) {
  return (state.drivers ?? []).filter((d) => d.active);
}

/**
 * 证钟（TSG Z6001—2019：有效期 4 年；复审申请应在有效期届满 1 个月以前提出；
 * 逾期未复审或复审不合格证书失效须重新考试）。
 * levels: expired 失效（红）/ window 复审申请窗口（黄，立即办）/ warn 临期提醒（黄）/
 *         ok / unset 未登记有效期（红）。
 */
export function certState(driver, todayISOStr, warnDays = CERT_WARN_DAYS) {
  assertISO(todayISOStr);
  const warn = typeof warnDays === 'number' ? warnDays : CERT_WARN_DAYS;
  if (!driver.expiryISO) return { level: 'unset', detail: '未登记证照有效期——无证或证件信息缺失无法自证' };
  const daysLeft = daysUntil(driver.expiryISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'expired', daysLeft, detail: `N1 证已过有效期（${driver.expiryISO}）——证书失效须重新考试取证，期间不得作业（特设法第 14/86 条）` };
  }
  if (daysLeft <= REEXAM_ADVANCE_DAYS) {
    return { level: 'window', daysLeft, detail: `N1 证 ${driver.expiryISO} 到期（剩 ${daysLeft} 天）——复审申请应在有效期届满 1 个月以前提出（TSG Z6001—2019），今天就办` };
  }
  if (daysLeft <= warn) {
    return { level: 'warn', daysLeft, detail: `N1 证 ${driver.expiryISO} 到期（剩 ${daysLeft} 天）——请准备复审资料` };
  }
  return { level: 'ok', daysLeft, detail: `N1 证有效期至 ${driver.expiryISO}` };
}

// ---------------------------------------------------------------------------
// 日管控（74 号令第 142 条：每日巡检 + 零风险报告）
// ---------------------------------------------------------------------------

/**
 * 打一笔日管控巡检卡。同日同车唯一；发现隐患必须写明异常与当场处置，
 * 并自动挂一笔一般事故隐患进入闭环流程（74 号令第 136 条：一般隐患立即处理，
 * 严重隐患责令停止使用）。
 */
export function addPatrol(state, { dateISO, vehicleId, checkerName, result = 'ok', findings = '', action = '', note = '' }) {
  assertISO(dateISO);
  const v = (state.vehicles ?? []).find((x) => x.id === vehicleId);
  if (!v) throw new Error(`车辆不存在: ${vehicleId}`);
  if (!String(checkerName || '').trim()) throw new Error('巡检人（场车安全员）必填——记录即履职证据（74 号令第 142 条）');
  if (!PATROL_RESULT[result]) throw new Error(`非法巡检结论: ${result}`);
  if (result === 'found' && !String(findings || '').trim()) {
    throw new Error('发现异常必须写明异常部位与情况，并当场采取防范措施（74 号令第 142 条）');
  }
  if ((state.patrols ?? []).some((p) => p.dateISO === dateISO && p.vehicleId === vehicleId)) {
    throw new Error(`${v.plateNo} 在 ${dateISO} 已有巡检卡（同日同车唯一）`);
  }
  state.patrolSeq = (state.patrolSeq ?? 0) + 1;
  const rec = { id: `pt-${state.patrolSeq}`, dateISO, vehicleId, plateNo: v.plateNo, checkerName, result, findings, action, note };
  state.patrols.push(rec);
  if (result === 'found') {
    state.hazardSeq = (state.hazardSeq ?? 0) + 1;
    state.hazards.push({
      id: `hz-${state.hazardSeq}`, dateISO, vehicleId, plateNo: v.plateNo,
      source: 'daily', severity: 'general', desc: findings, action: action || '',
      actionISO: action ? dateISO : '', verifyISO: '', verifiedBy: '', status: 'open',
    });
  }
  return rec;
}

/** 删除巡检卡（录错自救；若该卡自动挂出的隐患已处理，隐患记录不随之删除——审计痕保留） */
export function removePatrol(state, patrolId) {
  const idx = (state.patrols ?? []).findIndex((p) => p.id === patrolId);
  if (idx < 0) throw new Error(`巡检卡不存在: ${patrolId}`);
  state.patrols.splice(idx, 1);
}

/** 某车某日是否已有日管控卡 */
export function patrolDone(state, dateISO, vehicleId) {
  return (state.patrols ?? []).some((p) => p.dateISO === dateISO && p.vehicleId === vehicleId);
}

/** 今日日管控完成情况：{ done, total }（total=在用且已登记的车辆） */
export function patrolToday(state, todayISOStr) {
  assertISO(todayISOStr);
  const vs = activeVehicles(state);
  const done = vs.filter((v) => patrolDone(state, todayISOStr, v.id)).length;
  return { done, total: vs.length };
}

/** 最近一次（任意车辆）巡检打卡距今天数；从未打卡返回 null */
export function patrolGapDays(state, todayISOStr) {
  assertISO(todayISOStr);
  const dates = (state.patrols ?? []).map((p) => p.dateISO).sort();
  return dates.length ? 0 - daysUntil(dates[dates.length - 1], todayISOStr) : null;
}

// ---------------------------------------------------------------------------
// 周排查（74 号令第 143 条：总监每周至少一次）与月调度（第 144 条：主要负责人每月听取）
// ---------------------------------------------------------------------------

/** 周排查：同一 ISO 周唯一；内容必填 */
export function addWeekly(state, { dateISO, hostName, content, issues = '' }) {
  assertISO(dateISO);
  if (!String(hostName || '').trim()) throw new Error('排查主持人（场车安全总监）必填（74 号令第 143 条）');
  if (!String(content || '').trim()) throw new Error('排查内容必填——周排查要形成《每周场车安全排查治理报告》');
  const wk = isoWeekKey(dateISO);
  if ((state.weeklies ?? []).some((w) => w.weekKey === wk)) {
    throw new Error(`${wk} 已有周排查记录（每周至少一次，同周唯一）`);
  }
  state.weeklySeq = (state.weeklySeq ?? 0) + 1;
  const rec = { id: `wk-${state.weeklySeq}`, dateISO, weekKey: wk, hostName, content, issues };
  state.weeklies.push(rec);
  return rec;
}

/** 月调度：同一月唯一；内容必填 */
export function addMonthly(state, { dateISO, hostName, content }) {
  assertISO(dateISO);
  if (!String(hostName || '').trim()) throw new Error('主持人（单位主要负责人）必填（74 号令第 144 条）');
  if (!String(content || '').trim()) throw new Error('调度内容必填——月调度要形成《每月场车安全调度会议纪要》');
  const mk = monthKey(dateISO);
  if ((state.monthlies ?? []).some((m) => m.monthKey === mk)) {
    throw new Error(`${mk} 已有月调度记录（每月至少一次，同月唯一）`);
  }
  state.monthlySeq = (state.monthlySeq ?? 0) + 1;
  const rec = { id: `mo-${state.monthlySeq}`, dateISO, monthKey: mk, hostName, content };
  state.monthlies.push(rec);
  return rec;
}

/** 本周是否有周排查 */
export function weeklyDone(state, todayISOStr) {
  const wk = isoWeekKey(todayISOStr);
  return (state.weeklies ?? []).some((w) => w.weekKey === wk);
}

/** 本月是否有月调度 */
export function monthlyDone(state, todayISOStr) {
  const mk = monthKey(todayISOStr);
  return (state.monthlies ?? []).some((m) => m.monthKey === mk);
}

// ---------------------------------------------------------------------------
// 隐患闭环（状态机 open → fixed → closed；跳级拒绝；严重隐患=停用闸）
// ---------------------------------------------------------------------------

/** 手工登记隐患（日管控发现异常会自动挂出，也可在此补录/上报） */
export function addHazard(state, { dateISO, vehicleId = '', source = 'manual', severity = 'general', desc }) {
  assertISO(dateISO);
  if (!HAZARD_SOURCES[source]) throw new Error(`非法来源: ${source}`);
  if (!HAZARD_SEVERITIES[severity]) throw new Error(`非法严重程度: ${severity}`);
  if (!String(desc || '').trim()) throw new Error('隐患描述必填');
  const v = vehicleId ? (state.vehicles ?? []).find((x) => x.id === vehicleId) : null;
  if (vehicleId && !v) throw new Error(`车辆不存在: ${vehicleId}`);
  state.hazardSeq = (state.hazardSeq ?? 0) + 1;
  const rec = {
    id: `hz-${state.hazardSeq}`, dateISO, vehicleId: v ? v.id : '', plateNo: v ? v.plateNo : '',
    source, severity, desc, action: '', actionISO: '', verifyISO: '', verifiedBy: '', status: 'open',
  };
  state.hazards.push(rec);
  return rec;
}

/** 整改（open → fixed）：必须写明整改措施与完成日；完成日不得早于发现日 */
export function fixHazard(state, hazardId, { actionISO, action }) {
  const h = (state.hazards ?? []).find((x) => x.id === hazardId);
  if (!h) throw new Error(`隐患不存在: ${hazardId}`);
  if (h.status !== 'open') throw new Error('只有未整改隐患可以登记整改（状态机 open → fixed → closed）');
  assertISO(actionISO);
  if (actionISO < h.dateISO) throw new Error('整改完成日早于发现日');
  if (!String(action || '').trim()) throw new Error('整改措施必填——只打勾不留痕不算整改');
  h.action = action;
  h.actionISO = actionISO;
  h.status = 'fixed';
  return h;
}

/** 复查销案（fixed → closed）：必须复查人与复查日；复查日不得早于整改日 */
export function closeHazard(state, hazardId, { verifyISO, verifiedBy }) {
  const h = (state.hazards ?? []).find((x) => x.id === hazardId);
  if (!h) throw new Error(`隐患不存在: ${hazardId}`);
  if (h.status === 'open') throw new Error('先登记整改措施，再复查销案（跳级拒绝）');
  if (h.status === 'closed') throw new Error('该隐患已闭环销案');
  assertISO(verifyISO);
  if (verifyISO < h.actionISO) throw new Error('复查日早于整改完成日');
  if (!String(verifiedBy || '').trim()) throw new Error('复查人必填（建议场车安全总监）');
  h.verifyISO = verifyISO;
  h.verifiedBy = verifiedBy;
  h.status = 'closed';
  return h;
}

/** 未闭环隐患：严重在前、最老在前（74 号令第 136 条） */
export function openHazards(state) {
  const order = { serious: 0, general: 1 };
  return (state.hazards ?? [])
    .filter((h) => h.status !== 'closed')
    .sort((a, b) => order[a.severity] - order[b.severity] || a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

/** 某车未闭环隐患 */
export function openHazardsOf(state, vehicleId) {
  return openHazards(state).filter((h) => h.vehicleId === vehicleId);
}

// ---------------------------------------------------------------------------
// 派工闸（产品的门禁：带病叉车开不出去）
// ---------------------------------------------------------------------------

/**
 * 派工前体检。返回 { ok, reasons[] }，每条拒绝理由都带法条口径。
 * 闸（全部通过才放行）：
 * 1. 司机必须在作业人员名册且在册（特设法第 14 条：取得相应资格方可从业）；
 * 2. 司机 N1 证在有效期且已登记有效期（特设法第 86 条：使用无证人员作业罚 1 万~5 万）；
 * 3. 车辆已办理使用登记（特设法第 33/83 条）；
 * 4. 车辆定检在有效期（特设法第 40/84 条）；
 * 5. 车辆未报废、改造后已办变更登记（特设法第 47/48 条）；
 * 6. 车辆无未闭环隐患；严重事故隐患=立即停用（74 号令第 136 条）；
 * 7. 该车当日已有日管控巡检卡——未发现问题也要记录（74 号令第 142 条零风险报告）。
 */
export function dispatchGate(state, { dateISO, vehicleId, driverId }) {
  assertISO(dateISO);
  const reasons = [];
  const driver = (state.drivers ?? []).find((d) => d.id === driverId);
  if (!driver) {
    reasons.push('司机未在作业人员名册——先建档再派工（特设法第 14 条）');
  } else {
    if (!driver.active) reasons.push(`${driver.name} 已停用——离职/离岗人员不能新派工`);
    if (!driver.expiryISO) reasons.push(`${driver.name} 未登记 N1 证有效期——证件信息缺失无法自证（特设法第 14 条）`);
    else if (driver.expiryISO < dateISO) reasons.push(`${driver.name} 的 N1 证已于 ${driver.expiryISO} 失效——无证作业罚 1 万~5 万（特设法第 86 条），先复审/重考再派工`);
  }
  const v = (state.vehicles ?? []).find((x) => x.id === vehicleId);
  if (!v) {
    reasons.push('车辆未建档——一车一档先建起来');
  } else {
    if (v.scrappedISO) reasons.push(`${v.plateNo} 已于 ${v.scrappedISO} 登记报废——报废车辆不得使用（特设法第 48 条）`);
    else {
      const rg = regState(v, dateISO);
      if (rg.level === 'overdue' || rg.level === 'unset') reasons.push(`${v.plateNo} ${rg.detail}`);
      const ins = inspectState(v, dateISO);
      if (ins.level === 'overdue') reasons.push(`${v.plateNo} ${ins.detail}`);
      if (ins.level === 'unset') reasons.push(`${v.plateNo} ${ins.detail}`);
      if (v.modifiedISO && !v.changeRegISO) reasons.push(`${v.plateNo} 于 ${v.modifiedISO} 登记改造/重大修理但未办变更使用登记——未办妥不得继续使用（特设法第 47 条）`);
      const hz = openHazardsOf(state, v.id);
      if (hz.some((h) => h.severity === 'serious')) reasons.push(`${v.plateNo} 存在严重事故隐患未消除——应立即停止使用（74 号令第 136 条），消除前派工被拒绝`);
      else if (hz.length) reasons.push(`${v.plateNo} 有 ${hz.length} 项一般隐患未闭环（最早 ${hz[0].dateISO}）——先整改复查再派工`);
      if (!patrolDone(state, dateISO, v.id)) reasons.push(`${v.plateNo} 今日尚无日管控巡检卡——安全员每日巡检、零风险也要报告（74 号令第 142 条），先打卡再派工`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** 落一笔派工单：闸机全部通过才落账，同时记录通过时的证照快照 */
export function addWorkOrder(state, { dateISO, vehicleId, driverId, task = '', shift = 'am', note = '' }) {
  assertISO(dateISO);
  const gate = dispatchGate(state, { dateISO, vehicleId, driverId });
  if (!gate.ok) {
    throw new Error(`派工被闸机拒绝：${gate.reasons.join('；')}`);
  }
  const v = (state.vehicles ?? []).find((x) => x.id === vehicleId);
  const d = (state.drivers ?? []).find((x) => x.id === driverId);
  state.workOrderSeq = (state.workOrderSeq ?? 0) + 1;
  const rec = {
    id: `wo-${state.workOrderSeq}`, dateISO, vehicleId, plateNo: v.plateNo, driverId,
    driverName: d.name, task, shift, note,
    snapshot: {
      inspectionDueISO: v.inspectionDueISO, certExpiryISO: d.expiryISO,
      patrolId: (state.patrols ?? []).find((p) => p.dateISO === dateISO && p.vehicleId === vehicleId)?.id ?? '',
    },
  };
  state.workOrders.push(rec);
  return rec;
}

/** 删除派工单（记错自救） */
export function removeWorkOrder(state, orderId) {
  const idx = (state.workOrders ?? []).findIndex((w) => w.id === orderId);
  if (idx < 0) throw new Error(`派工单不存在: ${orderId}`);
  state.workOrders.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 周期义务账（培训/预案演练/清单评审，打勾自动滚动）
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
  const cycle = cycleDays ?? DUTY_KINDS[duty.kind]?.cycleDays ?? 365;
  if (!duty.lastDoneISO) return { level: 'never', cycle };
  const nextDue = addDays(duty.lastDoneISO, cycle);
  const daysLeft = daysUntil(nextDue, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= 30 ? 'due' : 'ok';
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
 * 十项体检。score = 100 - 红×12 - 黄×4（下限 0）。
 */
export function healthCheck(state, todayISOStr, settings = {}) {
  assertISO(todayISOStr);
  const applyAdv = settings.applyAdvanceDays ?? DEFAULT_APPLY_ADVANCE_DAYS;
  const reexamWarn = settings.reexamWarnDays ?? DEFAULT_REEXAM_WARN_DAYS;
  const patrolGap = settings.patrolGapDays ?? DEFAULT_PATROL_GAP_DAYS;
  const vs = state.vehicles ?? [];
  const actives = vs.filter((v) => !v.scrappedISO);
  const items = [];

  // ① 使用登记
  const badRegs = actives.filter((v) => ['overdue', 'unset'].includes(regState(v, todayISOStr).level));
  items.push({
    key: 'reg', label: '使用登记（一车一档）',
    level: badRegs.length ? 'bad' : actives.length ? 'ok' : 'bad',
    detail: badRegs.length
      ? `${badRegs.length} 台未办/未录使用登记（最早 ${badRegs[0].plateNo}）——未按规定登记罚 1 万~10 万（特设法第 83 条(一)）`
      : actives.length ? `${actives.length} 台在用场车登记齐全` : '还没有场车建档',
  });

  // ② 定检钟
  const overIns = actives.filter((v) => inspectState(v, todayISOStr, applyAdv).level === 'overdue');
  const dueIns = actives.filter((v) => inspectState(v, todayISOStr, applyAdv).level === 'due' || inspectState(v, todayISOStr, applyAdv).level === 'unset');
  items.push({
    key: 'inspect', label: '定期检验钟',
    level: overIns.length ? 'bad' : dueIns.length ? 'warn' : 'ok',
    detail: overIns.length
      ? `${overIns.length} 台定检已过期（最早 ${overIns[0].plateNo} ${inspectState(overIns[0], todayISOStr).detail.slice(0, 30)}…）——未经定检不得继续使用`
      : dueIns.length ? `${dueIns.length} 台定检临近或待录入——届满前 1 个月申报（特设法第 40 条）` : '全部在检有效期内（叉车 2 年/观光车 1 年，TSG 81—2022）',
  });

  // ③ 作业人员证
  const drivers = activeDrivers(state);
  const badCerts = drivers.filter((d) => ['expired', 'unset'].includes(certState(d, todayISOStr, reexamWarn).level));
  const windowCerts = drivers.filter((d) => ['window', 'warn'].includes(certState(d, todayISOStr, reexamWarn).level));
  items.push({
    key: 'cert', label: '作业人员证（N1）',
    level: !drivers.length || badCerts.length ? 'bad' : windowCerts.length ? 'warn' : 'ok',
    detail: !drivers.length
      ? '作业人员名册为空——叉车司机须持 N1 证（特设法第 14/86 条）'
      : badCerts.length
        ? `${badCerts.length} 人证件失效/未登记有效期（${badCerts[0].name}）——无证作业罚 1 万~5 万`
        : windowCerts.length ? `${windowCerts.length} 人进入复审窗口/临期（最早 ${windowCerts[0].name}）——届满 1 个月以前申请复审（TSG Z6001—2019）` : `${drivers.length} 名司机证照在有效期`,
  });

  // ④ 两员配备与逐台安全员
  const roster = dutyRosterState(state.station, actives);
  items.push({
    key: 'roster', label: '两员配备（总监/安全员）',
    level: roster.level === 'ok' ? 'ok' : roster.level === 'warn' ? 'warn' : 'bad',
    detail: roster.detail,
  });

  // ⑤ 日管控（今日完成 + 断卡）
  const pt = patrolToday(state, todayISOStr);
  const gap = patrolGapDays(state, todayISOStr);
  items.push({
    key: 'daily', label: '日管控（每日巡检）',
    level: pt.done < pt.total ? (gap !== null && gap > patrolGap ? 'bad' : 'warn') : 'ok',
    detail: pt.total === 0
      ? '无在用车辆，日管控暂无对象'
      : pt.done < pt.total
        ? `今日 ${pt.total - pt.done} 台未打卡（${pt.done}/${pt.total}）——安全员每日巡检、零风险也要记录（74 号令第 142 条）`
        : `今日 ${pt.done}/${pt.total} 台全部打卡（含零风险报告）`,
  });

  // ⑥ 周排查
  const wk = weeklyDone(state, todayISOStr);
  items.push({
    key: 'weekly', label: '周排查（总监每周一次）',
    level: wk ? 'ok' : 'warn',
    detail: wk ? '本周已有排查记录' : '本周尚无周排查——安全总监每周至少组织一次并形成报告（74 号令第 143 条）',
  });

  // ⑦ 月调度
  const mo = monthlyDone(state, todayISOStr);
  items.push({
    key: 'monthly', label: '月调度（主要负责人）',
    level: mo ? 'ok' : 'warn',
    detail: mo ? '本月已有调度记录' : '本月尚无月调度——主要负责人每月至少听取一次并形成纪要（74 号令第 144 条）',
  });

  // ⑧ 隐患闭环
  const open = openHazards(state);
  const seriousOpen = open.filter((h) => h.severity === 'serious');
  items.push({
    key: 'hazard', label: '隐患闭环',
    level: seriousOpen.length ? 'bad' : open.length ? 'warn' : 'ok',
    detail: seriousOpen.length
      ? `${seriousOpen.length} 项严重隐患未消除——涉事车辆应立即停止使用（74 号令第 136 条）`
      : open.length ? `${open.length} 项一般隐患整改/复查中（最早 ${open[0].dateISO}）` : '隐患全部闭环',
  });

  // ⑨ 报废注销与改造变更
  const scrapNoCancel = vs.filter((v) => v.scrappedISO && !v.cancelISO);
  const modNoReg = actives.filter((v) => v.modifiedISO && !v.changeRegISO);
  items.push({
    key: 'retire', label: '报废注销/改造变更',
    level: scrapNoCancel.length ? 'bad' : modNoReg.length ? 'warn' : 'ok',
    detail: scrapNoCancel.length
      ? `${scrapNoCancel.length} 台已报废未办注销——应报废未注销罚 3 万~30 万（特设法第 84 条(三)）`
      : modNoReg.length ? `${modNoReg.length} 台改造后未办变更登记（特设法第 47 条）` : '报废注销与改造变更无欠账',
  });

  // ⑩ 培训与预案（从未登记=从未开展的信号，与逾期同级点亮）
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => d.level === 'overdue' || d.level === 'never');
  const noDutyAtAll = !(state.duties ?? []).length;
  items.push({
    key: 'duty', label: '培训与预案',
    level: dutiesLate.length || noDutyAtAll ? 'warn' : 'ok',
    detail: dutiesLate.length
      ? `${dutiesLate.map((d) => d.label).join('、')}逾期/从未执行`
      : noDutyAtAll ? '培训、预案演练、清单评审均未登记——从未记录即从未开展（特设法第 13 条）' : '培训、预案演练、清单评审全部在期',
  });

  const bad = items.filter((i) => i.level === 'bad').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  return { items, bad, warn, score: Math.max(0, 100 - bad * 12 - warn * 4) };
}

// ---------------------------------------------------------------------------
// 月度小结（微信文本通道，确定性输出）
// ---------------------------------------------------------------------------

/**
 * 月度小结：派工与闸机、日管控、周排查/月调度、隐患、证照定检点名、体检七段。
 * month 形如 '2026-09'。
 */
export function monthlySummary(state, month, todayISOStr = todayISO()) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  assertISO(todayISOStr);
  const inMonth = (iso) => monthKey(iso) === month;
  const settings = state.settings ?? {};
  const orders = (state.workOrders ?? []).filter((w) => inMonth(w.dateISO));
  const patrols = (state.patrols ?? []).filter((p) => inMonth(p.dateISO));
  const found = patrols.filter((p) => p.result === 'found');
  const weeklies = (state.weeklies ?? []).filter((w) => inMonth(w.dateISO));
  const monthlies = (state.monthlies ?? []).filter((m) => inMonth(m.dateISO));
  const hazards = (state.hazards ?? []).filter((h) => inMonth(h.dateISO));
  const hazardsClosed = hazards.filter((h) => h.status === 'closed');
  const open = openHazards(state);
  const hc = healthCheck(state, todayISOStr, settings);

  const L = [];
  L.push(`【场车使用安全月度小结】${month}`);
  if (state.station?.name) L.push(`单位：${state.station.name}`);
  L.push(`派工 ${orders.length} 单（闸机全通过才落账），日管控巡检打卡 ${patrols.length} 台·日，其中发现并处置异常 ${found.length} 台·日`);
  L.push(`周排查 ${weeklies.length} 次、月调度 ${monthlies.length} 次（74 号令第 143/144 条要求每周至少一次/每月至少一次）`);
  L.push(`隐患登记 ${hazards.length} 项：已整改销案 ${hazardsClosed.length} 项${open.length ? `，仍有 ${open.length} 项未闭环（以闭环记录为准）` : ''}`);
  const overIns = activeVehicles(state).filter((v) => inspectState(v, todayISOStr, settings.applyAdvanceDays ?? DEFAULT_APPLY_ADVANCE_DAYS).level === 'overdue');
  const winDrivers = activeDrivers(state).filter((d) => certState(d, todayISOStr, settings.reexamWarnDays ?? DEFAULT_REEXAM_WARN_DAYS).level === 'window');
  if (overIns.length) L.push(`⚠ 定检超期点名：${overIns.map((v) => `${v.plateNo}（${v.inspectionDueISO} 到期）`).join('、')}——未经定检不得继续使用`);
  if (winDrivers.length) L.push(`⚠ 复审窗口点名：${winDrivers.map((d) => `${d.name}（${d.expiryISO} 到期）`).join('、')}——届满 1 个月以前申请复审`);
  if (open.some((h) => h.severity === 'serious')) L.push('⚠ 存在严重事故隐患未消除，涉事车辆已停止使用，消除并复查销案后恢复派工');
  L.push(`账本体检 ${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）`);
  L.push('口径：《特种设备安全法》第 14/33/35/39/40/47/48/83/84/86 条、市场监管总局令第 74 号第 135~150 条（场车专章）、TSG 81—2022（叉车定检 2 年/观光车 1 年）、TSG Z6001—2019（N1 证 4 年、届满 1 个月以前申请复审）；本小结为使用单位自查底稿，不替代使用登记、定检申报与变更/注销登记。');
  L.push(`生成：叉车账 · ${month}`);
  return {
    text: L.join('\n'), orders: orders.length, patrols: patrols.length,
    hazards: hazards.length, hazardsClosed: hazardsClosed.length, score: hc.score,
  };
}

// ---------------------------------------------------------------------------
// 迎检自证包（单文件 HTML：十段，含签字栏；同输入同输出）
// ---------------------------------------------------------------------------

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏）——对口 74 号令第 146 条监督检查内容 */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const st = state.station ?? {};
  const LEVEL = { overdue: '逾期', due: '临期', window: '复审窗口', warn: '临期', ok: '正常', never: '从未执行', unset: '未登记', none: '不适用' };

  const hc = healthCheck(state, todayISOStr, settings);
  const hcRows = hc.items.map((i) => `<tr><td>${e(i.label)}</td><td>${LEVEL[i.level] ?? i.level}</td><td>${e(i.detail)}</td></tr>`).join('');

  const actives = activeVehicles(state);
  const vehicleRows = (state.vehicles ?? []).map((v) => {
    const ins = inspectState(v, todayISOStr, settings.applyAdvanceDays ?? DEFAULT_APPLY_ADVANCE_DAYS);
    const rg = regState(v, todayISOStr);
    return `<tr>
    <td>${e(v.plateNo)}</td><td>${e(VEHICLE_KINDS[v.kind] ?? v.kind)}</td><td>${e(v.brand || '—')}</td>
    <td>${e(v.regNo || '未登记')}</td><td>${e(v.inspectionDueISO || '—')}（${LEVEL[ins.level] ?? ins.level}）</td>
    <td>${v.monitor ? '有' : '无/不适用'}</td><td>${e(v.keeperName || '未绑定')}</td>
    <td>${v.scrappedISO ? `已报废${v.cancelISO ? `·已注销` : '·未注销'}` : '在用'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="8">尚无场车建档</td></tr>';

  const driverRows = (state.drivers ?? []).map((d) => {
    const cs = certState(d, todayISOStr, settings.reexamWarnDays ?? DEFAULT_REEXAM_WARN_DAYS);
    return `<tr>
    <td>${e(d.name)}</td><td>${e(d.certNo)}</td><td>${e(d.expiryISO || '—')}（${LEVEL[cs.level] ?? cs.level}）</td>
    <td>${d.active ? '在册' : '已停用'}</td><td>${e(d.phone || '—')}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="5">名册为空</td></tr>';

  const from30 = addDays(todayISOStr, -29);
  const patrols = (state.patrols ?? []).filter((p) => p.dateISO >= from30).sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id));
  const patrolRows = patrols.slice(0, 120).map((p) => `<tr>
    <td>${e(p.dateISO)}</td><td>${e(p.plateNo)}</td><td>${e(p.checkerName)}</td>
    <td>${p.result === 'found' ? `<strong>发现隐患</strong>：${e(p.findings)}${p.action ? `；处置：${e(p.action)}` : ''}` : '无异常（零风险报告）'}</td>
  </tr>`).join('') || '<tr><td colspan="4">近 30 天无巡检打卡</td></tr>';

  const weeklyRows = [...(state.weeklies ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12).map((w) => `<tr>
    <td>${e(w.weekKey)}</td><td>${e(w.dateISO)}</td><td>${e(w.hostName)}</td><td class="w"><span>${e(w.content)}${w.issues ? `（问题：${e(w.issues)}）` : ''}</span></td>
  </tr>`).join('') || '<tr><td colspan="4">无周排查记录</td></tr>';

  const monthlyRows = [...(state.monthlies ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12).map((m) => `<tr>
    <td>${e(m.monthKey)}</td><td>${e(m.dateISO)}</td><td>${e(m.hostName)}</td><td class="w"><span>${e(m.content)}</span></td>
  </tr>`).join('') || '<tr><td colspan="4">无月调度记录</td></tr>';

  const hazardRows = [...(state.hazards ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((h) => `<tr>
    <td>${e(h.dateISO)}</td><td>${e(h.plateNo || '—')}</td><td>${e(HAZARD_SOURCES[h.source] ?? h.source)}</td><td>${e(HAZARD_SEVERITIES[h.severity] ?? h.severity)}</td>
    <td class="w"><span>${e(h.desc)}</span></td>
    <td>${h.status === 'open' ? '<strong>未整改</strong>' : `${e(h.actionISO)} ${e(h.action)}`}</td>
    <td>${h.status === 'closed' ? `${e(h.verifyISO)} ${e(h.verifiedBy)}` : h.status === 'fixed' ? '<strong>待复查</strong>' : '<strong>未闭环</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="7">无隐患登记</td></tr>';

  const orderRows = [...(state.workOrders ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((w) => `<tr>
    <td>${e(w.dateISO)}</td><td>${e(w.plateNo)}</td><td>${e(w.driverName)}</td><td class="w"><span>${e(w.task || '—')}</span></td>
    <td>${e(w.snapshot?.inspectionDueISO || '—')}${e(w.snapshot?.certExpiryISO ? ` / 证至 ${w.snapshot.certExpiryISO}` : '')}</td>
  </tr>`).join('') || '<tr><td colspan="5">无派工记录</td></tr>';

  const duRows = dutyBoard(state, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastDoneISO ? e(d.lastDoneISO) : '—'}</td>
    <td>${d.nextDue ? e(d.nextDue) : '—'}</td><td>${LEVEL[d.level] ?? d.level}</td><td>${e(d.basis)}</td>
  </tr>`).join('') || '<tr><td colspan="5">未登记周期义务</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>场车使用安全迎检自证包 · ${e(st.name ?? '')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; margin: 24px; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 6px; padding-left: 12px; border-left: 6px solid #3370ff; letter-spacing: .02em; }
  .meta { font-size: 12.5px; color: #51565f; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 1px solid #e5e6eb; color: #245bdb; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 6px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e6eb; }
  th { color: #245bdb; font-weight: 600; background: #f0f4ff; border-bottom: 2px solid #c9dcff; }
  tr:nth-child(even) td { background: #fafbfd; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>场车使用安全迎检自证包 · ${e(st.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 负责人：${e(st.manager || '—')} · 场车安全总监：${e(st.directorName || '未配备')} · 场车安全员：${e(st.officerName || '未配备')} · ${e(st.address || '地址未填')}</div>
<h2>一、使用单位与「两员」配备（74 号令第 135/137 条）</h2>
<div class="meta">主要负责人：${e(st.manager || '—')}（对本单位场车使用安全全面负责） · ${e(dutyRosterState(st, activeVehicles(state)).detail)}</div>
<h2>二、账本体检（${hc.items.length} 项）</h2>
<div class="meta">体检得分 ${hc.score}（红 ${hc.bad} · 黄 ${hc.warn}）——缺口如实列出，未闭环项以现场整改为准</div>
<table><tr><th>项目</th><th>状态</th><th>说明</th></tr>${hcRows}</table>
<h2>三、场车一车一档（特设法第 33/35/40 条：登记/档案/定检）</h2>
<table><tr><th>车牌/设备编号</th><th>品种</th><th>品牌型号</th><th>使用登记证号</th><th>定检有效期至</th><th>安全监控装置</th><th>负责安全员</th><th>状态</th></tr>${vehicleRows}</table>
<h2>四、作业人员名册（特设法第 14 条·TSG Z6001—2019：N1 证 4 年、届满 1 个月以前申请复审）</h2>
<table><tr><th>姓名</th><th>N1 证号</th><th>有效期至</th><th>状态</th><th>电话</th></tr>${driverRows}</table>
<h2>五、日管控巡检记录（近 30 天，74 号令第 142 条：每日打卡、零风险报告）</h2>
<table><tr><th>日期</th><th>车号</th><th>巡检人（安全员）</th><th>结论</th></tr>${patrolRows}</table>
<h2>六、周排查（74 号令第 143 条：总监每周至少一次）</h2>
<table><tr><th>周次</th><th>日期</th><th>主持人</th><th>排查内容与问题</th></tr>${weeklyRows}</table>
<h2>七、月调度（74 号令第 144 条：主要负责人每月至少一次）</h2>
<table><tr><th>月份</th><th>日期</th><th>主持人</th><th>调度内容</th></tr>${monthlyRows}</table>
<h2>八、隐患闭环台账（74 号令第 136 条：一般隐患立即处理，严重隐患立即停用）</h2>
<table><tr><th>发现日</th><th>车号</th><th>来源</th><th>程度</th><th>描述</th><th>整改</th><th>复查销案</th></tr>${hazardRows}</table>
<h2>九、派工台账（近 40 单：闸机核对后的合规派工）</h2>
<table><tr><th>日期</th><th>车号</th><th>司机</th><th>任务</th><th>核对快照（定检/证）</th></tr>${orderRows}</table>
<h2>十、培训与预案（特设法第 13 条·74 号令第 139/147 条）</h2>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<div class="sign">单位负责人（签字/盖章）：____________　场车安全总监（签字）：____________　日期：____________</div>
<div class="foot">生成：叉车账 ForkLog · ${e(todayISOStr)} · 本页为使用单位自查与迎检备查材料，不替代使用登记、定期检验申报、变更/注销登记等法定程序；属地市场监管部门要求永远赢</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 派工单（单笔派工的证据打印版：五项核对 + 签字栏）
// ---------------------------------------------------------------------------

/** 派工单打印版：派工要素 + 落账时的闸机核对快照 + 签字栏（单文件 HTML） */
export function dispatchHtml(state, orderId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const w = (state.workOrders ?? []).find((x) => x.id === orderId);
  if (!w) throw new Error(`派工单不存在: ${orderId}`);
  const v = (state.vehicles ?? []).find((x) => x.id === w.vehicleId);
  const d = (state.drivers ?? []).find((x) => x.id === w.driverId);
  const patrol = (state.patrols ?? []).find((p) => p.dateISO === w.dateISO && p.vehicleId === w.vehicleId);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>派工单 · ${e(w.plateNo)} · ${e(w.dateISO)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; margin: 24px; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 6px; padding-left: 12px; border-left: 6px solid #3370ff; letter-spacing: .02em; }
  .meta { font-size: 12.5px; color: #51565f; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 1px solid #e5e6eb; color: #245bdb; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 6px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e6eb; }
  th { color: #245bdb; font-weight: 600; background: #f0f4ff; border-bottom: 2px solid #c9dcff; }
  .box { border: 1px solid #ccc; border-radius: 8px; padding: 10px; font-size: 13px; min-height: 56px; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>场车派工单（合规核对版）</h1>
<div class="meta">单位：${e(state.station?.name || '—')} · 单号：${e(w.id)} · 打印日：${e(todayISOStr)}</div>
<h2>一、派工要素</h2>
<table>
  <tr><th>日期</th><td>${e(w.dateISO)}（${w.shift === 'am' ? '白班' : w.shift === 'pm' ? '中班' : e(w.shift)}）</td></tr>
  <tr><th>车辆</th><td>${e(w.plateNo)} · ${e(VEHICLE_KINDS[v?.kind] ?? '—')}${v?.brand ? ` · ${e(v.brand)}` : ''}</td></tr>
  <tr><th>司机</th><td>${e(w.driverName)}（N1 证号 ${e(d?.certNo || '—')}）</td></tr>
  <tr><th>任务</th><td>${e(w.task || '—')}</td></tr>
  <tr><th>备注</th><td>${e(w.note || '—')}</td></tr>
</table>
<h2>二、落账时闸机核对快照</h2>
<table>
  <tr><th>核对项</th><th>落账时点值</th></tr>
  <tr><td>车辆定检有效期至</td><td>${e(w.snapshot?.inspectionDueISO || '—')}</td></tr>
  <tr><td>司机 N1 证有效期至</td><td>${e(w.snapshot?.certExpiryISO || '—')}</td></tr>
  <tr><td>当日日管控巡检</td><td>${patrol ? `${e(patrol.checkerName)} 打卡 · ${patrol.result === 'found' ? `发现异常已处置` : '零风险报告'}` : '—'}</td></tr>
</table>
<h2>三、班前告知</h2>
<div class="box">作业区域 / 载荷限制 / 行驶路线等班前安全告知内容（可手写补充）。</div>
<div class="sign">派工人（签字）：____________　司机（签字）：____________　场车安全员（签字）：____________　日期：____________</div>
<div class="foot">生成：叉车账 ForkLog · ${e(todayISOStr)} · 本单为派工合规自证底稿；叉车作业同时应遵守本单位操作规程与场（厂）内交通安全制度</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'forklog', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'forklog') return { ok: false, error: '不是叉车账的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.station === 'object' && s.station !== null &&
    arr(s.vehicles) && arr(s.drivers) && arr(s.patrols) && arr(s.weeklies) &&
    arr(s.monthlies) && arr(s.hazards) && arr(s.workOrders) && arr(s.duties) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
