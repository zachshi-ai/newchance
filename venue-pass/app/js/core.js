/**
 * core.js — 开馆单 VenuePass 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；周期/时限/提醒窗口等口径
 * 全部参数化，可在设置中被场馆覆盖（属地体育部门要求永远赢）。
 *
 * 合规口径（原文链接与核验方式见 docs/14-调研来源.md，全部 2026-09-08 一手核验）：
 * - 《中华人民共和国体育法》（2022-06-24 修订，2023-01-01 施行）：
 *   第 105 条（经营高危险性体育项目应当符合三条件并向县级以上体育行政部门申请许可：
 *   ①相关体育设施符合国家标准；②具有达到规定数量的取得相应国家职业资格证书或者职业技能
 *   等级证书的社会体育指导人员和救助人员；③具有相应的安全保障、应急救援制度和措施——
 *   30 日内实地核查；目录由国务院体育行政部门会同有关部门制定、调整并公布。经营许可的
 *   设定依据由《全民健身条例》第 32 条升格为法律，引旧条例条号设定许可即过期）；
 *   第 116 条（未经许可经营的：责令限期关闭，逾期未关闭处 10 万~50 万罚款；违法经营的：
 *   责令改正，逾期未改正处 5 万~50 万罚款，有违法所得的没收，造成严重后果的责令关闭、
 *   吊销许可证照、五年内不得再从事该项目经营活动——较《全民健身条例》第 36/37 条的
 *   3 万~10 万 / 2~5 倍罚则全面加码，引旧罚额即错）。
 * - 《全民健身条例》（国务院令第 560 号，2009-10-01 施行，gov.cn 原文核验）：
 *   第 32 条（经营高危体育项目三条件与 30 日实地核查；目录经国务院批准后公布）；
 *   第 33 条（国家鼓励经营者投保有关责任保险、鼓励参与者投保意外伤害保险——鼓励非强制）；
 *   第 34 条（体育主管部门监督检查职责）；第 36/37 条（无证经营/不再符合条件仍经营的
 *   3 万~10 万、2~5 倍罚则——已被体育法第 116 条吸收加码，保留用于地方执法衔接对照）。
 * - 《经营高危险性体育项目许可管理办法》（国家体育总局令第 17 号，2013-05-01 施行；
 *   经总局「体育领域涉企行政检查事项清单」引用原文 + 上海市长宁区政府官方问答 + 上海市
 *   实施办法转致条款三方拼合核验）：
 *   第 6 条（经营条件四项：设施符合国家标准；达到规定数量、取得国家职业资格证书的社会体育
 *   指导人员和救助人员；安全生产岗位责任制、安全操作规程、突发事件应急预案、体育设施设备
 *   器材安全检查制度等安全保障制度和措施；其他）；
 *   第 14 条（许可证到期后需继续经营的，应当在有效期届满 30 日前申请办理续期手续，同意的
 *   换发许可证）；
 *   第 19~23 条（经营规范：按规定获得许可；设施符合国标并保持规定数量人员；将许可证、安全
 *   生产岗位责任制、安全操作规程、设施设备器材使用说明及安全检查等制度、社会体育指导人员和
 *   救助人员名录及照片张贴于经营场所醒目位置；就可能危及消费者安全的事项和对参与者年龄、
 *   身体、技术的特殊要求作出真实说明和明确警示；做好设施设备器材的维护保养及定期检测，
 *   经营期间保持不低于规定数量的指导人员和救助人员且持证上岗、佩戴能标明其身份的醒目标识）；
 *   第 26/27 条（无证经营/不再符合条件仍经营的罚则，转致《全民健身条例》第 36/37 条，现与
 *   体育法第 116 条竞合）；第 28 条（违反第 20~23 条：责令限期改正，逾期未改正处 2 万元以下
 *   罚款）；第 29 条（拒绝、阻挠监督检查：责令改正，处 3 万元以下罚款）。
 * - 《第一批高危险性体育项目目录公告》（国家体育总局公告 2013 年第 16号，mem.gov.cn 原文
 *   核验）：一、游泳；二、高山滑雪、自由式滑雪、单板滑雪；三、潜水；四、攀岩。
 *   本工具覆盖滑雪/潜水/攀岩三类场馆；游泳场所的水质卫生与泳客公示属 #12 泳清单领域，
 *   不在本工具射程内（领域互斥）。
 * - 《高危险性体育赛事活动目录（第一批）》（体育总局等七部门公告，2023-01 公布，gov.cn
 *   官方解读核验）：潜水、航空运动、登山、攀岩、滑雪登山、汽车摩托车相关等 6 大类 18 小项
 *   赛事活动——举办目录内赛事活动须按《体育法》第 106 条另行申请赛事活动许可（与经营许可
 *   并行）。本工具以经营台账为主，赛事活动许可作为周期义务提醒项。
 * - 体规字〔2021〕4 号（自贸区经营高危体育项目许可告知承诺制，sport.gov.cn 原文核验）：
 *   延续应提前 30 日申请、许可证有效期内可办理变更手续、现场核查 15 个工作日、承诺不实
 *   责令停业并吊销——佐证延续窗口与变更手续口径。
 * - 体育总局《体育领域涉企行政检查事项清单》（政策法规司 2025-06-30 公布，sport.gov.cn
 *   原文核验）：对高危体育项目经营者的检查标准 5 条（获得许可；设施符合国标+规定数量持证
 *   人员+四项安全制度；真实说明和明确警示；设施设备器材维护保养及定期检测；经营期间保持
 *   规定数量人员且持证上岗、佩戴醒目标识）——县级实施，年度检查频次上限 2 次。
 * - 属地规章样例（参数化佐证）：《广东省高危险性体育项目经营活动管理规定》（2021-01-01
 *   施行，tyj.gd.gov.cn 原文核验）第 8 条（许可证有效期不超过 5 年；届满 30 日前申请续期，
 *   逾期未申请原证自动失效；15 日内作出延续决定，逾期未决定视为准予）、第 9 条（商业性竞赛
 *   表演 30 日前备案）、第 12 条（应急预案+器材设施维护保养+自检制度）、第 13 条（警示与
 *   未成年人保护）、第 19 条（禁止伪造涂改出租出借转让许可证）；《上海市高危险性体育项目
 *   （游泳）经营许可实施办法》（xuhui.gov.cn 原文核验）第 9 条（有效期不超过 5 年、届满
 *   30 日前重新申请、逾期自动失效）、第 11 条（指导员带教学员上限、监控录像日志留存）。
 * - 场所开放条件国家标准（GB 19079《体育场所开放条件与技术要求》系列，主管部门体育总局，
 *   openstd.samr.gov.cn 与河北省体育局公示核验）：GB 19079.1-2013 游泳场所、GB 19079.4-2013
 *   攀岩场所、GB 19079.6-2013 滑雪场所、GB 19079.10-2013 潜水场所（另有 .9 射箭等）。
 *   系列为强制性国标；日检卡条目为本工具按系列标准的通识整理（属地与标准原文永远赢）。
 * - 统计口径：《中国滑雪产业白皮书》2024~2025 雪季国内运营滑雪场约 748 家（室外 676 +
 *   室内滑雪馆 59~66，口径略有差异）、滑雪人次 2605 万（+12.9%）、《中国攀岩行业发展报告
 *   （2024）》（中国登山协会×数说故事×体坛传媒）商业攀岩馆 811 家（+27.5%，2023 年 636 家
 *   首超美国）、攀岩人口近 50 万；潜水俱乐部无全国权威统计（宽区间诚实标注）。国办发
 *   〔2024〕49 号《关于以冰雪运动高质量发展激发冰雪经济活力的若干意见》：2027 年冰雪经济
 *   总规模 1.2 万亿元、2030 年 1.5 万亿元。
 *
 * 本工具是高危体育场馆侧的自证台账，不构成法律意见，不替代经营许可申请、延续、变更、注销、
 * 赛事活动许可等法定程序；属地体育部门要求永远赢。
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
 * 2 月 29 日 + 12 = 2 月 28 日钳制）。许可证/器材/义务等周期「精确到月」用。
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

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 口径常量（法定口径的参数化，属地要求永远赢）
// ---------------------------------------------------------------------------

/** 高危体育项目（第一批目录公告 2013 年第 16 号；游泳场所归 #12 泳清单领域，不在射程） */
export const PROJECT_KINDS = {
  ski: '滑雪（高山滑雪/自由式滑雪/单板滑雪）· GB 19079.6-2013',
  dive: '潜水 · GB 19079.10-2013',
  climb: '攀岩 · GB 19079.4-2013',
};

/** 延续申请窗口：有效期届满 30 日前申请续期（17 号令第 14 条；广东规章：逾期未申请原证自动失效） */
export const RENEW_ADVANCE_DAYS = 30;
/** 许可证临期提醒（天，产品口径，早于法定申请窗口，只提示不判定） */
export const LICENSE_WARN_DAYS = 90;

/** 器材设施维护保养/定期检测默认周期（月，参数化；总局检查标准 4「维护保养及定期检测」+ 17 号令第 22 条） */
export const DEFAULT_GEAR_CYCLE_MONTHS = 12;
/** 器材检验临期提醒（天，产品口径） */
export const GEAR_WARN_DAYS = 30;

/** 从业人员角色（体育法第 105 条(二)：社会体育指导人员和救助人员，国家职业资格证书/职业技能等级证书） */
export const STAFF_ROLES = {
  instructor: '社会体育指导员（指导/教学）',
  rescuer: '救助人员（救援/救护）',
};

/** 每日开放前安全检查项（GB 19079 系列通识整理，属地与标准原文永远赢） */
export const DAYCHECK_ITEMS = {
  ski: [
    ['slope', '雪道与雪况巡查（冰区/裸露/障碍物）'],
    ['net', '防护网/垫层/警示标识完好'],
    ['lift', '魔毯/索道运行前试运行（如有）'],
    ['weather', '天气评估（大风/能见度/极端天气预警）'],
    ['rental', '雪具租借抽检（板/固定器/鞋/头盔）'],
  ],
  dive: [
    ['tank', '气瓶在检验有效期内、气密与压力充足'],
    ['air', '压缩机空气品质/滤芯在期（如适用）'],
    ['bcd', 'BCD/调节器/配重/浮具功能完好'],
    ['site', '水域环境评估（风浪流/能见度/警示旗）'],
    ['emergency', '应急氧/急救包/沟通设备在位'],
  ],
  climb: [
    ['wall', '岩壁与岩点松动/旋转检查'],
    ['rope', '绳索/扁带/快挂外观（磨损/老化/毛刺）'],
    ['harness', '安全带/头盔/保护器抽检'],
    ['landing', '坠落区缓冲垫覆盖到位'],
    ['anchor', '顶绳保护站/锚点/挂片状态'],
  ],
};

/** 周期义务（周期为参数化默认值，属地要求永远赢） */
export const DUTY_KINDS = {
  drill: { label: '突发事件应急预案演练', cycleDays: 180, basis: '17 号令第 6 条(三)应急预案 · 惯例半年参数化' },
  training: { label: '从业人员安全与救护培训', cycleDays: 365, basis: '总局检查标准 2/5 · 惯例一年参数化' },
  facility: { label: '体育设施符合国标的定期检测/说明性材料更新', cycleDays: 365, basis: '体育法第 105 条(一) · GB 19079 系列' },
  insurance: { label: '公众责任保险有效性确认（鼓励投保）', cycleDays: 365, basis: '《全民健身条例》第 33 条（鼓励非强制）' },
  eventpermit: { label: '高危体育赛事活动许可自查（举办目录内赛事前另行申请）', cycleDays: 365, basis: '《体育法》第 106 条 · 七部门目录公告（2023）' },
};

/** 变更手续情形（17 号令第 14 条 + 体规字〔2021〕4 号「变更办理」；广东规章第 7 条：15 日内办理） */
export const CHANGE_KINDS = {
  venue: '经营场所/地址变更',
  person: '经营者/法定代表人变更',
  project: '经营项目变更（新增/停开高危项目）',
  name: '单位名称变更',
  other: '其他依法需办理变更的事项',
};

/** 隐患来源 */
export const HAZARD_SOURCES = {
  daycheck: '每日开放前安全检查',
  inspection: '监督检查',
  selfcheck: '自查上报',
};

/** 默认提醒参数 */
export const DEFAULT_RENEW_WARN_DAYS = 30;
export const DEFAULT_GEAR_WARN_DAYS = 30;
export const DEFAULT_DUTY_WARN_DAYS = 30;

// ---------------------------------------------------------------------------
// 场馆建档与许可证钟（体育法第 105/116 条；17 号令第 14 条）
// ---------------------------------------------------------------------------

/**
 * 许可证钟。levels:
 * overdue  已过期（红：无有效许可经营=体育法第 116 条 10 万~50 万+限期关闭风险）；
 * window   延续申请窗口（黄：届满 30 日前应申请续期，17 号令第 14 条；逾期未申请原证自动失效——广东规章第 8 条）；
 * warn     临期提醒（黄，产品口径）；
 * ok       正常；unset 未登记有效期（红）。
 */
export function licenseState(venue, todayISOStr, warnDays = LICENSE_WARN_DAYS) {
  assertISO(todayISOStr);
  const warn = typeof warnDays === 'number' ? warnDays : LICENSE_WARN_DAYS;
  const expiry = venue?.licenseExpiryISO;
  if (!expiry) return { level: 'unset', detail: '未登记高危险性体育项目经营许可证有效期——许可证是开门经营的合法性地基（体育法第 105 条）' };
  const daysLeft = daysUntil(expiry, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `许可证已于 ${expiry} 过期——期间经营属违法经营，责令改正逾期未改处 5 万~50 万、无证经营责令限期关闭逾期处 10 万~50 万（体育法第 116 条）；立即停业并申请续期` };
  }
  if (daysLeft <= RENEW_ADVANCE_DAYS) {
    return { level: 'window', daysLeft, detail: `许可证 ${expiry} 到期（剩 ${daysLeft} 天）——续期应在届满 30 日前申请（17 号令第 14 条），逾期未申请原证自动失效（广东规章第 8 条口径），今天就办` };
  }
  if (daysLeft <= warn) {
    return { level: 'warn', daysLeft, detail: `许可证 ${expiry} 到期（剩 ${daysLeft} 天）——准备续期材料（人员证书/设施检测/制度文本）` };
  }
  return { level: 'ok', daysLeft, detail: `许可证有效期至 ${expiry}` };
}

/** 续期办结：录入新证载明的有效期（应晚于当前），滚动许可证钟 */
export function renewLicense(venue, newExpiryISO) {
  assertISO(newExpiryISO);
  if (!venue?.licenseExpiryISO) throw new Error('先在场馆建档登记现有许可证信息');
  if (newExpiryISO <= venue.licenseExpiryISO) throw new Error('新证有效期应晚于当前有效期（续期换证）');
  venue.licenseExpiryISO = newExpiryISO;
  venue.renewedISO = todayISO();
  return venue;
}

// ---------------------------------------------------------------------------
// 人员名册（体育法第 105 条(二)：规定数量的持证社会体育指导人员和救助人员）
// ---------------------------------------------------------------------------

/**
 * 入册一名从业人员。staff: { name, role, certName, certNo, certValidISO, note }
 * 闸机：姓名必填；角色合法；同姓名同角色拒绝；登记证书时有效期可留空（=unset，开馆闸不放行）。
 * 检查标准 5：持证上岗并佩戴能标明其身份的醒目标识——证书号在本机登记用于备查核对。
 */
export function addStaff(state, { name, role, certName = '', certNo = '', certValidISO = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('姓名必填');
  if (!STAFF_ROLES[role]) throw new Error(`非法角色: ${role}（社会体育指导员/救助人员）`);
  if (certValidISO) assertISO(certValidISO);
  if ((state.staff ?? []).some((s) => s.name === name && s.role === role)) {
    throw new Error(`${name}（${STAFF_ROLES[role]}）已在名册中`);
  }
  state.staffSeq = (state.staffSeq ?? 0) + 1;
  const rec = { id: `st-${state.staffSeq}`, name, role, certName, certNo, certValidISO, active: true, note };
  state.staff.push(rec);
  return rec;
}

/** 停用/恢复人员（离职停用不删除：历史开馆单可回溯到当日名册；停用后开馆点名不可选） */
export function setStaffActive(state, staffId, active) {
  const rec = (state.staff ?? []).find((s) => s.id === staffId);
  if (!rec) throw new Error(`人员不存在: ${staffId}`);
  rec.active = !!active;
  return rec;
}

/** 在册人员 */
export function activeStaff(state) {
  return (state.staff ?? []).filter((s) => s.active);
}

/**
 * 个人证书钟。levels: unset 未登记（红）/ overdue 已过期（红）/ warn 临期（黄）/ ok。
 * 过期证继续带课=「未保持规定数量持证人员」+持证上岗要求失守（体育法第 105/116 条、检查标准 5）。
 */
export function staffCertState(staff, todayISOStr, warnDays = 60) {
  assertISO(todayISOStr);
  if (!staff.certValidISO) {
    return { level: 'unset', detail: `${staff.name} 未登记证书有效期——开馆点名不放行（持证上岗，检查标准 5）` };
  }
  const daysLeft = daysUntil(staff.certValidISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${staff.name} 证书已于 ${staff.certValidISO} 过期——不得安排上岗（体育法第 105 条(二)），安排即「未保持规定数量持证人员」` };
  }
  if (daysLeft <= warnDays) {
    return { level: 'warn', daysLeft, detail: `${staff.name} 证书 ${staff.certValidISO} 到期（剩 ${daysLeft} 天）——安排复审/换证` };
  }
  return { level: 'ok', daysLeft, detail: `${staff.name} 证书有效期至 ${staff.certValidISO}` };
}

// ---------------------------------------------------------------------------
// 器材一物一档（检查标准 4：设施设备器材的维护保养及定期检测；17 号令第 22 条）
// ---------------------------------------------------------------------------

/**
 * 建档一件器材/设施。gear: { name, code, cycleMonths, lastCheckISO, note }
 * 闸机：名称/编号必填、编号唯一；有最近检查日时自动推导下次到期日（+周期月，月末钳制）。
 * 潜水气瓶定期检验、攀岩绳索/扁带更换、雪场防护网巡检等均按此参数化（GB 19079 系列与厂家口径永远赢）。
 */
export function addGear(state, { name, code, cycleMonths = DEFAULT_GEAR_CYCLE_MONTHS, lastCheckISO = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('器材名称必填');
  if (!String(code || '').trim()) throw new Error('器材编号必填——一物一档的档主');
  if ((state.gear ?? []).some((x) => x.code === code)) {
    throw new Error(`器材编号 ${code} 已建档（同编号唯一）`);
  }
  const cycle = Number.isInteger(cycleMonths) && cycleMonths > 0 ? cycleMonths : DEFAULT_GEAR_CYCLE_MONTHS;
  state.gearSeq = (state.gearSeq ?? 0) + 1;
  const rec = {
    id: `gr-${state.gearSeq}`, name, code, cycleMonths: cycle,
    lastCheckISO,
    dueISO: lastCheckISO ? addMonthsExact(lastCheckISO, cycle) : '',
    outISO: '', backISO: '',
    note,
  };
  state.gear.push(rec);
  return rec;
}

/** 在用器材 */
export function activeGear(state) {
  return (state.gear ?? []).filter((x) => !x.outISO);
}

/**
 * 器材检验钟。levels: overdue 超期（红：应停用并安排检验）/ due 临期（黄）/ unset 未录入（红）/ ok / 停用 none。
 */
export function gearState(gear, todayISOStr, warnDays = GEAR_WARN_DAYS) {
  assertISO(todayISOStr);
  const warn = typeof warnDays === 'number' ? warnDays : GEAR_WARN_DAYS;
  if (gear.outISO) return { level: 'none', detail: `已停用（${gear.outISO}）` };
  if (!gear.dueISO) {
    return { level: 'unset', detail: '未录入最近检查/检验日——「维护保养及定期检测」无证据（检查标准 4）' };
  }
  const daysLeft = daysUntil(gear.dueISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `已超期（${gear.dueISO}）——停用并安排检验/更换后再投入服务` };
  }
  if (daysLeft <= warn) {
    return { level: 'due', daysLeft, detail: `${gear.dueISO} 到期（剩 ${daysLeft} 天）——安排检验/更换` };
  }
  return { level: 'ok', daysLeft, detail: `有效期至 ${gear.dueISO}` };
}

/** 记录一次检查/检验完成：滚动器材钟 */
export function recordGearCheck(state, gearId, doneISO, note = '') {
  assertISO(doneISO);
  const gr = (state.gear ?? []).find((x) => x.id === gearId);
  if (!gr) throw new Error(`器材不存在: ${gearId}`);
  if (gr.outISO) throw new Error('该器材已停用，恢复在用后再录检查');
  gr.lastCheckISO = doneISO;
  gr.dueISO = addMonthsExact(doneISO, gr.cycleMonths);
  if (note) gr.note = note;
  return gr;
}

/** 停用/恢复器材（磨损待换、送检中） */
export function setGearService(state, gearId, inService, iso) {
  assertISO(iso);
  const gr = (state.gear ?? []).find((x) => x.id === gearId);
  if (!gr) throw new Error(`器材不存在: ${gearId}`);
  if (inService) {
    if (!gr.outISO) throw new Error('该器材本就在用');
    gr.backISO = iso;
    gr.outISO = '';
  } else {
    if (gr.outISO) throw new Error('该器材已停用');
    gr.outISO = iso;
  }
  return gr;
}

// ---------------------------------------------------------------------------
// 每日开放前安全检查（17 号令第 22 条自检/安全检查制度；总局检查标准 2/4）
// ---------------------------------------------------------------------------

/** 当日应检条目（按场馆经营的项目合并） */
export function daycheckItemsFor(state) {
  const projects = state.venue?.projects ?? [];
  const out = [];
  for (const p of projects) {
    for (const [key, label] of (DAYCHECK_ITEMS[p] ?? [])) out.push({ key: `${p}:${key}`, label });
  }
  return out;
}

/**
 * 落一笔当日开放前检查（同日唯一）。results: { [key]: { ok: bool, note: string } }
 * 闸机：同日已检拒绝；任一条目异常必须写处置说明；异常条目自动登记隐患
 * （未闭环隐患会挡住次日的开馆闸——带病的场子开不了门）。
 */
export function recordDaycheck(state, { dateISO, results = {}, note = '' }) {
  assertISO(dateISO);
  const items = daycheckItemsFor(state);
  if (!items.length) throw new Error('先在场馆建档选择经营项目——日检卡按项目自动生成');
  if ((state.daychecks ?? []).some((d) => d.dateISO === dateISO)) {
    throw new Error(`${dateISO} 已有开放前检查记录（同日唯一；漏检如实留缺，不补造）`);
  }
  const itemKeys = new Set(items.map((i) => i.key));
  const entries = [];
  const hazards = [];
  for (const it of items) {
    const r = results[it.key];
    const ok = !!(r && r.ok);
    const itemNote = String(r?.note ?? '').trim();
    if (!ok && !itemNote) {
      throw new Error(`「${it.label}」异常必须写明处置说明——只打叉不留痕不算检查（17 号令第 22 条安全检查制度）`);
    }
    entries.push({ key: it.key, label: it.label, ok, note: itemNote });
    if (!ok) hazards.push(it.label);
  }
  state.daycheckSeq = (state.daycheckSeq ?? 0) + 1;
  const rec = {
    id: `dc-${state.daycheckSeq}`, dateISO,
    items: entries,
    status: hazards.length ? 'issue' : 'ok',
    note,
  };
  state.daychecks.push(rec);
  for (const label of hazards) {
    addHazard(state, {
      dateISO,
      source: 'daycheck',
      desc: `开放前检查异常：${label}——${entries.find((x) => x.label === label)?.note ?? ''}`,
    });
  }
  return rec;
}

/** 最近一次日检（含日期），从未返回 null */
export function lastDaycheck(state) {
  const list = [...(state.daychecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  return list[0] ?? null;
}

// ---------------------------------------------------------------------------
// 隐患闭环（状态机 open → fixed → closed；来源：日检/监督检查/自查）
// ---------------------------------------------------------------------------

/** 手工登记隐患（日检异常由 recordDaycheck 自动登记，无需手工重复） */
export function addHazard(state, { dateISO, source = 'selfcheck', desc }) {
  assertISO(dateISO);
  if (!HAZARD_SOURCES[source]) throw new Error(`非法来源: ${source}`);
  if (!String(desc || '').trim()) throw new Error('隐患描述必填');
  state.hazardSeq = (state.hazardSeq ?? 0) + 1;
  const rec = {
    id: `hz-${state.hazardSeq}`, dateISO, source, desc,
    action: '', actionISO: '', verifyISO: '', verifiedBy: '', status: 'open',
  };
  state.hazards.push(rec);
  return rec;
}

/** 整改（open → fixed）：措施与完成日必填；完成日不得早于发现日 */
export function fixHazard(state, hazardId, { actionISO, action }) {
  const hz = (state.hazards ?? []).find((x) => x.id === hazardId);
  if (!hz) throw new Error(`隐患不存在: ${hazardId}`);
  if (hz.status !== 'open') throw new Error('只有未整改隐患可以登记整改（状态机 open → fixed → closed）');
  assertISO(actionISO);
  if (actionISO < hz.dateISO) throw new Error('整改完成日早于发现日');
  if (!String(action || '').trim()) throw new Error('整改措施必填——只打勾不留痕不算整改');
  hz.action = action;
  hz.actionISO = actionISO;
  hz.status = 'fixed';
  return hz;
}

/** 复查销案（fixed → closed）：复查人与复查日必填；闭环后开馆闸才放行 */
export function closeHazard(state, hazardId, { verifyISO, verifiedBy }) {
  const hz = (state.hazards ?? []).find((x) => x.id === hazardId);
  if (!hz) throw new Error(`隐患不存在: ${hazardId}`);
  if (hz.status === 'open') throw new Error('先登记整改措施，再复查销案（跳级拒绝）');
  if (hz.status === 'closed') throw new Error('该隐患已闭环');
  assertISO(verifyISO);
  if (verifyISO < hz.actionISO) throw new Error('复查日早于整改完成日');
  if (!String(verifiedBy || '').trim()) throw new Error('复查人必填（建议场馆负责人）');
  hz.verifyISO = verifyISO;
  hz.verifiedBy = verifiedBy;
  hz.status = 'closed';
  return hz;
}

/** 未闭环隐患（早的在前） */
export function openHazards(state) {
  return (state.hazards ?? []).filter((h) => h.status !== 'closed').sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// 开馆闸与开馆单（产品的门禁：五道闸全过，才许开门接待）
// ---------------------------------------------------------------------------

/**
 * 开馆前体检。返回 { ok, reasons[], gates: [{key, ok, detail}] }，每条拒绝理由都带法条口径。
 * 五道闸（全部通过才放行）：
 * 1. 许可证在有效期且已登记（体育法第 105/116 条：无证/过期经营 5 万~50 万、10 万~50 万+关闭）；
 * 2. 当日在岗持证人数达到规定数量（体育法第 105 条(二)「规定数量」= 场馆建档的最低在岗数）；
 * 3. 当日在岗人员证书全部在期（持证上岗，检查标准 5）；
 * 4. 当日开放前安全检查已完成（17 号令第 22 条安全检查制度）；
 * 5. 无未闭环隐患（应急预案与整改制度，第 6 条(三)）。
 */
export function openGate(state, { dateISO, staffIds = [] }) {
  assertISO(dateISO);
  const reasons = [];
  const gates = [];

  const lic = licenseState(state.venue ?? {}, dateISO);
  // window=仍在有效期、只是进入续期窗口——照常开门，只提醒办手续
  const g1 = ['ok', 'warn', 'window'].includes(lic.level);
  if (!g1) reasons.push(lic.level === 'unset' ? `许可证未登记有效期——${lic.detail}` : `许可证已过期——${lic.detail}`);
  gates.push({ key: 'license', ok: g1, detail: lic.detail });

  const staffAll = state.staff ?? [];
  const onDuty = staffIds.map((id) => staffAll.find((s) => s.id === id)).filter(Boolean);
  const need = Number(state.venue?.minStaffPerDay ?? 0);
  const g2 = onDuty.length >= need && need > 0;
  if (!g2) {
    reasons.push(need > 0
      ? `当日在岗持证人员 ${onDuty.length} 人，未达到规定数量 ${need} 人——经营期间应保持不低于规定数量的社会体育指导人员和救助人员（体育法第 105 条(二)、检查标准 5）`
      : '场馆未设置最低在岗人数——先在建档录入许可证核定的规定数量（体育法第 105 条(二)）');
  }
  gates.push({ key: 'staffcount', ok: g2, detail: need > 0 ? `在岗 ${onDuty.length} / 规定 ${need} 人` : '规定数量未设置' });

  const badCerts = onDuty.filter((s) => !['ok', 'warn'].includes(staffCertState(s, dateISO).level));
  const g3 = onDuty.length > 0 && badCerts.length === 0;
  for (const s of badCerts) reasons.push(staffCertState(s, dateISO).detail);
  if (!onDuty.length) reasons.push('未勾选当日在岗人员——社会体育指导人员和救助人员应持证上岗（检查标准 5）');
  gates.push({ key: 'staffcert', ok: g3, detail: onDuty.length ? `已核 ${onDuty.length} 人证书${badCerts.length ? `，${badCerts.length} 人不可上岗` : '全部在期'}` : '未点名' });

  const dc = (state.daychecks ?? []).find((d) => d.dateISO === dateISO);
  const g4 = !!dc;
  if (!g4) reasons.push('今日尚未完成开放前安全检查——先落当日检查卡（17 号令第 22 条）');
  gates.push({ key: 'daycheck', ok: g4, detail: dc ? `当日检查已落卡（${dc.status === 'issue' ? `含 ${dc.items.filter((i) => !i.ok).length} 项异常处置` : '全项正常'}）` : '未检查' });

  const hz = openHazards(state);
  const g5 = hz.length === 0;
  if (!g5) reasons.push(`存在 ${hz.length} 项未闭环隐患（最早 ${hz[0].dateISO}：${hz[0].desc}）——隐患闭环前不得开门接待（17 号令第 6 条(三)安全保障制度）`);
  gates.push({ key: 'hazard', ok: g5, detail: g5 ? '无未闭环隐患' : `${hz.length} 项未闭环` });

  return { ok: reasons.length === 0, reasons, gates, onDuty };
}

/**
 * 落一张开馆单：五道闸全部通过才落账，同时记录合规快照。
 * snapshot 记录落账时的许可证有效期与在岗人员证书有效期——检查进门出示的「今天能开门」证据。
 */
export function addOpening(state, { dateISO, staffIds = [], note = '' }) {
  assertISO(dateISO);
  if ((state.openings ?? []).some((o) => o.dateISO === dateISO)) {
    throw new Error(`${dateISO} 已开出开馆单（同日唯一）`);
  }
  const gate = openGate(state, { dateISO, staffIds });
  if (!gate.ok) {
    throw new Error(`开馆被闸机拒绝：${gate.reasons.join('；')}`);
  }
  state.openingSeq = (state.openingSeq ?? 0) + 1;
  const rec = {
    id: `op-${state.openingSeq}`, dateISO,
    staffIds: [...staffIds],
    staffNames: gate.onDuty.map((s) => `${s.name}（${STAFF_ROLES[s.role]}）`),
    note,
    snapshot: {
      licenseExpiryISO: state.venue?.licenseExpiryISO ?? '',
      staffCerts: Object.fromEntries(gate.onDuty.map((s) => [s.name, s.certValidISO ?? ''])),
      projectCount: (state.venue?.projects ?? []).length,
    },
  };
  state.openings.push(rec);
  return rec;
}

/** 删除开馆单（录错自救；删除埋点留痕） */
export function removeOpening(state, openingId) {
  const idx = (state.openings ?? []).findIndex((o) => o.id === openingId);
  if (idx < 0) throw new Error(`开馆单不存在: ${openingId}`);
  state.openings.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 变更手续台账（17 号令第 14 条 + 体规字〔2021〕4 号；广东规章第 7 条 15 日办理）
// ---------------------------------------------------------------------------

/** 登记一项变更事实（发生日 + 情形 + 说明） */
export function addChange(state, { dateISO, kind, detail = '' }) {
  assertISO(dateISO);
  if (!CHANGE_KINDS[kind]) throw new Error(`非法变更情形: ${kind}`);
  if (!String(detail || '').trim()) throw new Error('变更说明必填（变更前后内容）');
  state.changeSeq = (state.changeSeq ?? 0) + 1;
  const rec = { id: `cg-${state.changeSeq}`, dateISO, kind, detail, filedISO: '', status: 'open' };
  state.changes.push(rec);
  return rec;
}

/** 办结变更手续（向体育部门办理完毕换发/背书，回执日期） */
export function fileChange(state, changeId, filedISO) {
  assertISO(filedISO);
  const rec = (state.changes ?? []).find((c) => c.id === changeId);
  if (!rec) throw new Error(`变更记录不存在: ${changeId}`);
  if (rec.status === 'filed') throw new Error('该变更已办结');
  if (filedISO < rec.dateISO) throw new Error('办理日期早于变更发生日');
  rec.filedISO = filedISO;
  rec.status = 'filed';
  return rec;
}

/** 未办结变更 */
export function openChanges(state) {
  return (state.changes ?? []).filter((c) => c.status === 'open');
}

// ---------------------------------------------------------------------------
// 周期义务账（演练/培训/设施检测/保险/赛事许可自查；打勾自动滚动）
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

/** 全部义务看板：未登记的义务也以「从未执行」入板；红灯在前，附类型与依据 */
export function dutyBoard(state, todayISOStr) {
  assertISO(todayISOStr);
  const order = { never: 0, overdue: 1, due: 2, ok: 3 };
  const registered = new Map((state.duties ?? []).map((d) => [d.kind, d]));
  const all = Object.keys(DUTY_KINDS).map((kind) => registered.get(kind) ?? { kind, lastDoneISO: '' });
  return all
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
  const renewWarn = settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS;
  const gearWarn = settings.gearWarnDays ?? DEFAULT_GEAR_WARN_DAYS;
  const items = [];

  // ① 许可证与延续窗口
  const lic = licenseState(state.venue ?? {}, todayISOStr, renewWarn);
  items.push({
    key: 'license', label: '经营许可证与延续窗口',
    level: ['unset', 'overdue'].includes(lic.level) ? 'bad' : ['window', 'warn'].includes(lic.level) ? 'warn' : 'ok',
    detail: lic.detail,
  });

  // ② 人员名册与证书在期
  const staff = activeStaff(state);
  const unsetCert = staff.filter((s) => staffCertState(s, todayISOStr).level === 'unset');
  const overdueCert = staff.filter((s) => staffCertState(s, todayISOStr).level === 'overdue');
  const warnCert = staff.filter((s) => staffCertState(s, todayISOStr).level === 'warn');
  items.push({
    key: 'staff', label: '人员名册与证书在期',
    level: !staff.length || unsetCert.length || overdueCert.length ? 'bad' : warnCert.length ? 'warn' : 'ok',
    detail: !staff.length
      ? '人员名册为空——持证的社会体育指导人员和救助人员是许可条件（体育法第 105 条(二)）'
      : overdueCert.length || unsetCert.length
        ? `${overdueCert.length} 人证书过期、${unsetCert.length} 人未登记有效期——不得安排上岗（检查标准 5）`
        : warnCert.length
          ? `${staff.length} 人在册，${warnCert.length} 人证书临期（${warnCert.map((s) => s.name).join('、')}）——安排复审`
          : `${staff.length} 人在册，证书全部在期`,
  });

  // ③ 今日开馆单
  const openedToday = (state.openings ?? []).some((o) => o.dateISO === todayISOStr);
  items.push({
    key: 'opening', label: '今日开馆单',
    level: openedToday ? 'ok' : 'warn',
    detail: openedToday ? '今日已过五道闸并落账' : '今日尚未开出开馆单——非营业日可忽略，营业日先过五道闸',
  });

  // ④ 器材检验钟
  const gear = activeGear(state);
  const overGear = gear.filter((g) => gearState(g, todayISOStr, gearWarn).level === 'overdue');
  const unsetGear = gear.filter((g) => gearState(g, todayISOStr, gearWarn).level === 'unset');
  const dueGear = gear.filter((g) => gearState(g, todayISOStr, gearWarn).level === 'due');
  items.push({
    key: 'gear', label: '器材检验钟（一物一档）',
    level: overGear.length || unsetGear.length ? 'bad' : dueGear.length ? 'warn' : 'ok',
    detail: overGear.length || unsetGear.length
      ? `${overGear.length} 件超期、${unsetGear.length} 件未录入——维护保养及定期检测无证据（检查标准 4）`
      : dueGear.length
        ? `${dueGear.length} 件临期（最早 ${dueGear[0].dueISO}）——安排检验/更换`
        : gear.length ? `${gear.length} 件在用器材检验全部在期` : '器材台账为空——从气瓶/绳索/防护网开始建档',
  });

  // ⑤ 日检坚持
  const last = lastDaycheck(state);
  const daysSince = last ? 0 - daysUntil(last.dateISO, todayISOStr) : null;
  items.push({
    key: 'daycheck', label: '开放前安全检查坚持',
    level: daysSince === null ? 'bad' : daysSince === 0 ? 'ok' : daysSince <= 3 ? 'warn' : 'bad',
    detail: daysSince === null
      ? '从未落开放前检查卡——17 号令第 22 条安全检查制度无运行证据'
      : daysSince === 0
        ? '今日检查已落卡' + (last.status === 'issue' ? `（${last.items.filter((i) => !i.ok).length} 项异常已转隐患）` : '，全项正常')
        : `最近一次检查在 ${daysSince} 天前（${last.dateISO}）——营业日每日开放前都应检查`,
  });

  // ⑥⑦⑧ 周期义务（演练/培训/设施检测）
  for (const [key, label] of [['drill', '应急预案演练'], ['training', '从业人员培训'], ['facility', '设施国标定期检测']]) {
    const board = dutyBoard(state, todayISOStr).find((d) => d.kind === key);
    const level = !board || board.level === 'never' || board.level === 'overdue' ? 'bad' : board.level === 'due' ? 'warn' : 'ok';
    items.push({
      key, label: `${label}（${Math.round((DUTY_KINDS[key].cycleDays / 365) * 12)} 个月周期参数化）`,
      level,
      detail: !board || board.level === 'never'
        ? `从未登记${label}记录——${DUTY_KINDS[key].basis}`
        : board.level === 'overdue'
          ? `${label}已逾期（应于 ${board.nextDue} 前开展）——${DUTY_KINDS[key].basis}`
          : board.level === 'due'
            ? `${label}应于 ${board.nextDue} 前开展（剩 ${board.daysLeft} 天）`
            : `上次 ${label}：${board.nextDue} 前再开展（剩 ${board.daysLeft} 天）`,
    });
  }

  // ⑨ 保险（鼓励性，最高黄）
  const ins = dutyBoard(state, todayISOStr).find((d) => d.kind === 'insurance');
  items.push({
    key: 'insurance', label: '公众责任保险（鼓励投保）',
    level: !ins || ins.level === 'never' || ins.level === 'overdue' ? 'warn' : 'ok',
    detail: !ins || ins.level === 'never'
      ? '未登记保单——《全民健身条例》第 33 条鼓励投保责任保险；事故赔付首当其冲，保单在期也是属地检查的常见核对项'
      : ins.level === 'overdue'
        ? `保单确认已逾期（应于 ${ins.nextDue} 前续保核对）——续保后重新登记`
        : ins.level === 'due'
          ? `保单 ${ins.nextDue} 到期核对（剩 ${ins.daysLeft} 天）`
          : `保单在期（${ins.nextDue} 前再核对）`,
  });

  // ⑩ 变更手续与隐患闭环
  const openCh = openChanges(state);
  const hz = openHazards(state);
  items.push({
    key: 'closure', label: '变更手续与隐患闭环',
    level: hz.some((x) => x.status === 'open') ? 'bad' : hz.length || openCh.length ? 'warn' : 'ok',
    detail: [
      hz.length ? `${hz.length} 项隐患未销案（最早 ${hz[0].dateISO}）——闭环前开馆闸不放行` : '',
      openCh.length ? `${openCh.length} 项变更未办结——应向体育部门申请办理变更手续（17 号令第 14 条）` : '',
      !hz.length && !openCh.length ? '变更无欠账、隐患全闭环' : '',
    ].filter(Boolean).join('；'),
  });

  const bad = items.filter((i) => i.level === 'bad').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  return { items, bad, warn, score: Math.max(0, 100 - bad * 12 - warn * 4) };
}

// ---------------------------------------------------------------------------
// 月度小结（微信文本通道，确定性输出）
// ---------------------------------------------------------------------------

/**
 * 月度小结。month 形如 '2026-12'。
 */
export function monthlySummary(state, month, todayISOStr = todayISO()) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  assertISO(todayISOStr);
  const inMonth = (iso) => monthKey(iso) === month;
  const settings = state.settings ?? {};
  const openings = (state.openings ?? []).filter((o) => inMonth(o.dateISO));
  const blocked = (state.traces ?? []).filter((t) => t.type === 'open-gate-blocked' && inMonth((t.dateISO || t.at || '').slice(0, 10)));
  const daychecks = (state.daychecks ?? []).filter((d) => inMonth(d.dateISO));
  const issues = daychecks.filter((d) => d.status === 'issue');
  const hzs = (state.hazards ?? []).filter((h) => inMonth(h.dateISO));
  const hzsClosed = hzs.filter((h) => h.status === 'closed');
  const openHz = openHazards(state);
  const lic = licenseState(state.venue ?? {}, todayISOStr, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);
  const hc = healthCheck(state, todayISOStr, settings);

  const L = [];
  L.push(`【高危体育场馆合规月度小结】${month}`);
  if (state.venue?.name) L.push(`场馆：${state.venue.name}（许可证 ${state.venue.licenseNo || '—'}，有效期至 ${state.venue.licenseExpiryISO || '—'}；项目：${(state.venue.projects ?? []).map((p) => (PROJECT_KINDS[p] ?? p).split(' ·')[0]).join('、') || '—'}）`);
  L.push(`开出开馆单 ${openings.length} 张（五道闸全过才落账），闸机拦截不合规开门 ${blocked.length} 次——每次拦截都是没被罚的证据`);
  L.push(`开放前检查 ${daychecks.length} 次（异常 ${issues.length} 次已转隐患）；隐患登记 ${hzs.length} 项、销案 ${hzsClosed.length} 项${openHz.length ? `，仍有 ${openHz.length} 项未闭环（闭环前不开门接待）` : ''}`);
  if (['window', 'warn'].includes(lic.level)) L.push(`⚠ 续期窗口提醒：${lic.detail}`);
  if (lic.level === 'overdue') L.push(`⚠ 许可证已过期：${lic.detail}`);
  const staff = activeStaff(state);
  const badStaff = staff.filter((s) => ['overdue', 'unset'].includes(staffCertState(s, todayISOStr).level));
  if (badStaff.length) L.push(`⚠ 人员证书点名：${badStaff.map((s) => `${s.name}（${staffCertState(s, todayISOStr).detail}）`).join('、')}——不得安排上岗`);
  const gearList = activeGear(state).filter((g) => gearState(g, todayISOStr, settings.gearWarnDays ?? DEFAULT_GEAR_WARN_DAYS).level === 'overdue');
  if (gearList.length) L.push(`⚠ 器材超期点名：${gearList.map((g) => `${g.name}(${g.code})`).join('、')}——停用并安排检验`);
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => d.level === 'never' || d.level === 'overdue');
  if (dutiesLate.length) L.push(`⚠ 周期义务欠账：${dutiesLate.map((d) => d.label).join('、')}`);
  L.push(`账本体检 ${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）`);
  L.push('口径：《体育法》（2022 修订）第 105/106/116 条、《全民健身条例》第 32/33/34 条、《经营高危险性体育项目许可管理办法》（总局令第 17 号）第 6/14/19~23/28/29 条、《第一批高危险性体育项目目录公告》（2013 年第 16 号）、GB 19079.4/.6/.10-2013；本小结为场馆自查底稿，不替代经营许可申请、延续、变更与赛事活动许可等法定程序。');
  L.push(`生成：开馆单 · ${month}`);
  return {
    text: L.join('\n'), openings: openings.length, blocked: blocked.length,
    daychecks: daychecks.length, hzs: hzs.length, hzsClosed: hzsClosed.length, score: hc.score,
  };
}

// ---------------------------------------------------------------------------
// 出证物（单文件 HTML：迎检自证包 / 当日开馆单；同输入同输出）
// ---------------------------------------------------------------------------

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏）——对口体育部门监督检查与总局检查标准 5 条 */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const v = state.venue ?? {};
  const LEVEL = { overdue: '逾期', due: '临期', window: '延续窗口', warn: '临期', ok: '正常', never: '从未开展', unset: '未登记', none: '不适用' };

  const hc = healthCheck(state, todayISOStr, settings);
  const hcRows = hc.items.map((i) => `<tr><td>${e(i.label)}</td><td>${LEVEL[i.level] ?? i.level}</td><td>${e(i.detail)}</td></tr>`).join('');

  const staffRows = (state.staff ?? []).map((s) => {
    const cs = staffCertState(s, todayISOStr);
    return `<tr class="${s.active ? '' : 'muted'}">
    <td>${e(s.name)}</td><td>${e(STAFF_ROLES[s.role] ?? s.role)}</td>
    <td>${e(s.certName || '—')}${s.certNo ? `<br><span class="basis">${e(s.certNo)}</span>` : ''}</td>
    <td>${e(s.certValidISO || '—')}（${LEVEL[cs.level] ?? cs.level}）</td>
    <td>${s.active ? '在册' : '已停用'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="5">人员名册为空</td></tr>';

  const gearRows = (state.gear ?? []).map((g) => {
    const gs = gearState(g, todayISOStr, settings.gearWarnDays ?? DEFAULT_GEAR_WARN_DAYS);
    return `<tr class="${g.outISO ? 'muted' : ''}">
    <td>${e(g.name)}<br><span class="basis">${e(g.code)}</span></td>
    <td>${g.cycleMonths} 个月</td><td>${e(g.lastCheckISO || '—')}</td>
    <td>${e(g.dueISO || '—')}（${LEVEL[gs.level] ?? gs.level}）</td>
    <td>${g.outISO ? `已停用${g.backISO ? `·${e(g.backISO)} 复用` : ''}` : '在用'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="5">器材台账为空</td></tr>';

  const openingRows = [...(state.openings ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((o) => `<tr>
    <td>${e(o.dateISO)}</td><td class="w"><span>${e(o.staffNames.join('、'))}</span></td>
    <td>${e(o.snapshot?.licenseExpiryISO || '—')}</td><td>五道闸全过</td>
  </tr>`).join('') || '<tr><td colspan="4">开馆记录为空</td></tr>';

  const dcRows = [...(state.daychecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((d) => {
    const bad = d.items.filter((i) => !i.ok);
    return `<tr>
    <td>${e(d.dateISO)}</td><td>${d.items.length} 项</td>
    <td>${bad.length ? `<strong>异常 ${bad.length}</strong>：${e(bad.map((i) => `${i.label}（${i.note}）`).join('；'))}` : '全项正常'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="3">无检查记录</td></tr>';

  const hzRows = [...(state.hazards ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((h) => `<tr>
    <td>${e(h.dateISO)}</td><td>${e(HAZARD_SOURCES[h.source] ?? h.source)}</td><td class="w"><span>${e(h.desc)}</span></td>
    <td>${h.status === 'open' ? '<strong>未整改</strong>' : `${e(h.actionISO || '—')} ${e(h.action || '')}`}</td>
    <td>${h.status === 'closed' ? `${e(h.verifyISO)} ${e(h.verifiedBy)}` : h.status === 'fixed' ? '<strong>待复查</strong>' : '<strong>未闭环</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="5">无隐患登记</td></tr>';

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr>
    <td>${e(c.dateISO)}</td><td>${e(CHANGE_KINDS[c.kind] ?? c.kind)}</td><td class="w"><span>${e(c.detail)}</span></td>
    <td>${c.status === 'filed' ? `${e(c.filedISO)} 已办结` : '<strong>未办结</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="4">暂无变更事项</td></tr>';

  const duRows = dutyBoard(state, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastDoneISO ? e(d.lastDoneISO) : '—'}</td>
    <td>${d.nextDue ? e(d.nextDue) : '—'}</td><td>${LEVEL[d.level] ?? d.level}</td><td>${e(d.basis)}</td>
  </tr>`).join('') || '<tr><td colspan="5">未登记周期义务</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>高危体育场馆合规迎检自证包 · ${e(v.name ?? '')}</title>
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
<h1>高危险性体育项目经营合规迎检自证包 · ${e(v.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 场馆负责人：${e(v.manager || '—')} · 项目：${e((v.projects ?? []).map((p) => (PROJECT_KINDS[p] ?? p).split(' ·')[0]).join('、') || '—')} · ${e(v.address || '地址未填')}</div>
<h2>一、场馆与经营许可证（《体育法》第 105 条；17 号令第 14 条）</h2>
<div class="meta">许可证编号：${e(v.licenseNo || '—')} · 发证机关：${e(v.issuer || '—')} · 有效期至：${e(v.licenseExpiryISO || '—')}（${e(licenseState(v, todayISOStr).detail)}） · 最低在岗人数（规定数量）：${e(String(v.minStaffPerDay ?? '—'))} 人</div>
<h2>二、账本体检（${hc.items.length} 项）</h2>
<div class="meta">体检得分 ${hc.score}（红 ${hc.bad} · 黄 ${hc.warn}）——缺口如实列出，未闭环项以现场整改为准</div>
<table><tr><th>项目</th><th>状态</th><th>说明</th></tr>${hcRows}</table>
<h2>三、从业人员名册（体育法第 105 条(二)规定数量的持证人员；检查标准 5 持证上岗）</h2>
<table><tr><th>姓名</th><th>岗位</th><th>证书名称/编号</th><th>有效期至</th><th>状态</th></tr>${staffRows}</table>
<h2>四、器材设施一物一档（检查标准 4：维护保养及定期检测；17 号令第 22 条）</h2>
<table><tr><th>器材/设施</th><th>检验周期</th><th>最近检查</th><th>有效期至</th><th>状态</th></tr>${gearRows}</table>
<h2>五、开馆记录（近 40 日：五道闸全过才落账，含当日快照）</h2>
<table><tr><th>日期</th><th>在岗人员</th><th>落账时许可证有效期</th><th>闸机</th></tr>${openingRows}</table>
<h2>六、每日开放前安全检查（17 号令第 22 条安全检查制度；GB 19079 系列通识条目）</h2>
<table><tr><th>日期</th><th>检查项</th><th>结果</th></tr>${dcRows}</table>
<h2>七、隐患整改闭环（日检/监督检查/自查）</h2>
<table><tr><th>发现日</th><th>来源</th><th>描述</th><th>整改</th><th>复查销案</th></tr>${hzRows}</table>
<h2>八、变更手续台账（17 号令第 14 条；广东规章第 7 条 15 日办理）</h2>
<table><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows}</table>
<h2>九、周期义务账（演练/培训/设施检测/保险/赛事许可自查）</h2>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<div class="sign">场馆负责人（签字/盖章）：____________　安全管理人（签字）：____________　日期：____________</div>
<div class="foot">生成：开馆单 VenuePass · ${e(todayISOStr)} · 本页为场馆自查与迎检备查材料，不替代经营许可申请、延续、变更、注销与高危险性体育赛事活动许可等法定程序；属地体育部门要求永远赢</div>
</body>
</html>`;
}

/** 当日开馆单打印版（单文件 HTML）——贴在门口/前台：今天这扇门是过了五道闸才开的 */
export function openPassHtml(state, openingId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const o = (state.openings ?? []).find((x) => x.id === openingId);
  if (!o) throw new Error(`开馆单不存在: ${openingId}`);
  const v = state.venue ?? {};
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>当日开馆单 · ${e(o.dateISO)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; margin: 24px; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 6px; padding-left: 12px; border-left: 6px solid #3370ff; letter-spacing: .02em; }
  .meta { font-size: 12.5px; color: #51565f; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 1px solid #e5e6eb; color: #245bdb; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 6px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e6eb; }
  th { color: #245bdb; font-weight: 600; background: #f0f4ff; border-bottom: 2px solid #c9dcff; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>当日开馆单（五道闸核对）</h1>
<div class="meta">场馆：${e(v.name || '—')} · 日期：${e(o.dateISO)} · 打印日：${e(todayISOStr)} · 项目：${e((v.projects ?? []).map((p) => (PROJECT_KINDS[p] ?? p).split(' ·')[0]).join('、') || '—')}</div>
<h2>一、闸机核对（落账时点）</h2>
<table>
  <tr><th>许可证有效期（落账时）</th><td>${e(o.snapshot?.licenseExpiryISO || '—')}</td></tr>
  <tr><th>在岗持证人数</th><td>${o.staffIds.length} 人（规定数量 ${e(String(v.minStaffPerDay ?? '—'))} 人）</td></tr>
  <tr><th>当日开放前检查</th><td>已完成（体育部门检查时可调取检查卡）</td></tr>
  <tr><th>未闭环隐患</th><td>0 项</td></tr>
</table>
<h2>二、当日在岗人员（持证上岗，佩戴醒目标识——检查标准 5）</h2>
<table><tr><th>人员</th><th>岗位</th><th>证书有效期（落账时）</th></tr>
${o.staffNames.map((n, i) => `<tr><td>${e(n.split('（')[0])}</td><td>${e((n.match(/（(.*)）/)?.[1]) ?? '')}</td><td>${e(o.snapshot?.staffCerts?.[o.staffNames[i].split('（')[0]] || '—')}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}
</table>
<h2>三、游客须知张贴自查（17 号令第 21 条：真实说明和明确警示）</h2>
<div class="meta">许可证与人员名录及照片已张贴于醒目位置：□ 是　□ 否（未张贴属第 28 条处罚情形）　·　年龄/身体/技术特殊要求已警示：□ 是　□ 否</div>
<div class="sign">值班负责人（签字）：____________　时间：____________</div>
<div class="foot">生成：开馆单 VenuePass · ${e(todayISOStr)} · 本单为当日开门营业的自证底稿，不替代许可与监督检查</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'venuepass', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'venuepass') return { ok: false, error: '不是开馆单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.venue === 'object' && s.venue !== null &&
    arr(s.staff) && arr(s.gear) && arr(s.daychecks) && arr(s.openings) &&
    arr(s.hazards) && arr(s.changes) && arr(s.duties) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
