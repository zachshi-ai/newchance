/**
 * core.js — 船安单 VesselPass 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；周期/时限/提醒窗口等口径
 * 全部参数化，可在设置中被船东覆盖（属地海事机构要求永远赢）。
 *
 * 合规口径（原文链接与核验方式见 docs/14-调研来源.md，全部 2026-09-09 一手核验）：
 * - 《中华人民共和国内河交通安全管理条例》（国务院令，现行修订版，国家行政法规库
 *   xzfg.moj.gov.cn LawID=933 全文 PDF 核验）：
 *   第 6 条（船舶航行四条件：①认可的检验机构依法检验并持合格检验证书；②依法登记并持
 *   登记证书；③配备符合规定的船员；④配备必要航行资料——开航闸总纲）；
 *   第 63 条（报废船航行：没收）；第 64 条（未持合格检验证书/登记证书/必要航行资料擅自
 *   航行：责令停航→拒不停止暂扣船舶→情节严重没收）；第 65 条（未按规定配员擅自航行：
 *   所有人/经营人 1 万~10 万，逾期不改责令停航）；第 66 条（无适任证件人员擅自航行：
 *   责令离岗，个人 2000~2 万+聘用单位 1 万~10 万）；第 67 条（按规定须取得船舶污染损害
 *   责任/沉船打捞责任保险文书或财务保证的船舶未取得：限期改正→停航+1 万~10 万）；
 *   第 68 条（未按规定报告航次计划/适航状态/船员配备等五情形：5000~5 万+禁进港/停航+
 *   暂扣适任证书 3~6 个月）。
 * - 《中华人民共和国船舶安全监督规则》（2017 年公布，2020 第一次修正、2022-09-26 第二次
 *   修正=交通运输部令 2022 年第 27 号，xxgk.mot.gov.cn 原文核验）：
 *   第 11 条（进出港报告制；固定航线可一天至少报告一次）、第 13 条（报告后在航行日志记载）；
 *   第 41 条（航运公司安全与防污染主体责任：有效维护保养设备、为船舶配备满足最低安全
 *   配员要求的适任船员）；
 *   第 42 条（**开航前自查制度**：离泊前对安全技术状况和货物装载情况自查，按规定格式填写
 *   《船舶开航前安全自查清单》，开航前船长签字确认；固定航线且单次航程不超过 2 小时的
 *   无须每次自查但一天内至少一次；自查清单在船上保存至少 2 年——本产品每日自查卡主锚）；
 *   第 44 条（恶劣天气限制开航+内河枯水季节通航限制通告）。
 * - 《中华人民共和国船舶登记条例》（国务院令第 155 号，2014 修订）：第 16 条（国籍证书
 *   有效期 5 年；光船租赁最长不超过 5 年）、第 45 条（届满前 1 年内办理换发——换发窗口锚）。
 * - 《中华人民共和国船舶最低安全配员规则》（交通部令 2004 年第 7 号，2014/2018 两次修正）：
 *   第 5 条（按规则配合格船员但不免除增配责任）、第 7 条（航行期间配备不低于附录确定的
 *   船员构成及数量）、第 9 条（总人数不得超过救生设备定员标准）、第 17 条（配员证书
 *   有效期截止前 1 年内或国籍证书重新核发/内容变化时换发）。
 * - 《内河船舶船员适任考试和发证规则》（交通运输部令 2015 年第 21 号发布，2020 年第 12 号
 *   令修正）：第 16 条（参加航行和轮机值班的船员适任证书有效期不超过 5 年；有效期截止日
 *   不超过持证人 65 周岁生日；任职不得高于证书记载的类别和职务资格、不得超出航区（线））。
 * - 《船舶检验管理规定》（交通运输部令 2016 年第 2 号，2016-05-01 施行）：营运检验种类与
 *   证书失效规则（营运船舶检验证书失效超过一个换证检验周期的，须重新申请检验）。
 *   内河船检验按《内河船舶检验规则（2024）》（部海事局 2024-04 发布，CCS 官网转载）执行，
 *   检验种类与下次检验日期以检验证书簿载明为准——本工具照证书录入，不自行推算周期。
 * - 统计锚（交通运输部《2024 年交通运输行业发展统计公报》，gov.cn 部门动态发布）：年末全国
 *   拥有水上运输船舶 11.02 万艘（比上年末减少 0.81 万艘）、净载重量 3.12 亿吨（+0.12 亿吨）。
 * - 口径雷区清单（引错即露馅）：①《船舶安全监督规则》现行版=2022 年第 27 号令二次修正版，
 *   网上大量引 2017 原版文号——开航前自查=第 42 条（两版条号未变但文号必须写 27 号令修正版）；
 *   ②开航前自查豁免=「固定航线且单次航程不超过 2 小时」才可一天一次，不是所有船每天一次即可；
 *   ③内河船员适任证书 65 周岁红线是「有效期截止日不超过 65 周岁生日」，非 65 岁禁航；
 *   ④国籍证书 5 年+届满前 1 年换发（登记条例第 16/45 条），与配员证书「有效期截止前 1 年内
 *   换发」（配员规则第 17 条）口径平行；⑤渔船/体育运动船艇/非营业游艇不适用配员规则
 *   （第 2 条），本工具客群=内河营业运输船舶；⑥检验周期不自行推算——检验证书簿载明下次
 *   检验日期，照证书录入；⑦《海上交通安全法》（2021 修订）管海上，内河主法=内河条例，
 *   引法别张冠李戴。
 *
 * 本工具是船东/船长侧的自查与迎检台账，不构成法律意见，不替代船舶登记、检验、进出港
 * 报告、船员考证等法定程序；属地海事机构要求永远赢。
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

/** 由生日算年龄（按目标日；65 周岁红线用） */
export function ageAt(birthISO, atISO) {
  assertISO(birthISO);
  assertISO(atISO);
  const b = birthISO.split('-').map(Number);
  const a = atISO.split('-').map(Number);
  let age = a[0] - b[0];
  if (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])) age -= 1;
  return age;
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

/** 国籍证书换发窗口：有效期届满前 1 年内（船舶登记条例第 45 条） */
export const RENEW_WINDOW_DAYS = 365;
/** 配员证书换发窗口：有效期截止前 1 年内（配员规则第 17 条） */
export const MANNING_RENEW_WINDOW_DAYS = 365;
/** 检验证书临期提醒（天，产品口径；下次检验日期照证书录入） */
export const SURVEY_WARN_DAYS = 60;
/** 保险文书临期提醒（天，产品口径） */
export const INSURANCE_WARN_DAYS = 30;
/** 适任证书临期提醒（天，产品口径） */
export const CERT_WARN_DAYS = 90;
/** 健康证明默认周期（天，参数化；以内河船员体检口径/证书载明为准） */
export const DEFAULT_HEALTH_CYCLE_DAYS = 730;
/** 健康证明临期提醒（天，产品口径） */
export const HEALTH_WARN_DAYS = 90;
/** 开航前自查固定航线豁免：单次航程不超过 2 小时（安全监督规则第 42 条，参数化开关用） */
export const SHORT_ROUTE_HOURS = 2;

/** 船舶四证钟（内河条例第 6 条+第 67 条；登记条例第 16 条；配员规则第 17 条） */
export const SHIP_DOCS = {
  survey: { label: '船舶检验证书', basis: '内河条例第 6 条(一)·检验证书簿载明下次检验日期照录；失效超一个换证检验周期须重新检验（检验管理规定）' },
  national: { label: '船舶国籍证书', basis: '登记条例第 16 条有效期 5 年·第 45 条届满前 1 年内换发' },
  manning: { label: '船舶最低安全配员证书', basis: '配员规则第 17 条·有效期截止前 1 年内换发·随国籍证书核发' },
  insurance: { label: '责任保险文书（污染损害/沉船打捞）', basis: '内河条例第 67 条·规定船舶未取得：限期改正→停航+1 万~10 万' },
};

/** 船员岗位（内河适任规则职务体系简化四类） */
export const CREW_ROLES = {
  captain: '船长',
  officer: '驾驶员（大副/驾驶员）',
  engineer: '轮机员（轮机长/轮机员）',
  sailor: '普通船员（水手/机工）',
};

/** 需持适任证书的岗位（值班船员）；普通船员按需持培训证明（参数化） */
export const CERT_REQUIRED = { captain: true, officer: true, engineer: true, sailor: false };

/** 每日开航前自查条目（安全监督规则第 42 条「安全技术状况+货物装载」通识整理，清单格式以海事机构规定为准） */
export const SELFCHECK_ITEMS = {
  hull: '船体与水密（船体裂纹变形、舱口盖/水密门关闭）',
  engine: '主机与机电（主机/舵机/发电机/泵阀运转正常）',
  life: '救生消防（救生衣圈齐备、灭火器在位在压）',
  nav: '航行设备（AIS/号灯/通信/航行资料齐备有效）',
  cargo: '货物装载（按核定载重线装载、系固到位、不超载）',
};

/** 周期义务（周期为参数化默认值，属地要求永远赢） */
export const DUTY_KINDS = {
  drill: { label: '救生/消防演习', cycleDays: 90, basis: '安全监督规则第 41 条安全制度·惯例季度参数化' },
  maintenance: { label: '机电设备维护保养', cycleDays: 30, basis: '安全监督规则第 41 条「有效维护和保养」·惯例月度参数化' },
  reportcheck: { label: '进出港报告与航行日志记载核查', cycleDays: 30, basis: '安全监督规则第 11/13 条·报告后在航行日志记载' },
  charts: { label: '航行资料更新（图籍/通告）', cycleDays: 90, basis: '内河条例第 6 条(四)配备必要航行资料·含枯水/管制通告（第 44 条）' },
  renewcheck: { label: '证照换发窗口核查（国籍/配员证书届满前 1 年）', cycleDays: 180, basis: '登记条例第 45 条+配员规则第 17 条' },
  insurance: { label: '责任保险文书有效性确认', cycleDays: 365, basis: '内河条例第 67 条' },
};

/** 变更登记情形（船舶登记条例：登记事项变更向船籍港登记机关办理） */
export const CHANGE_KINDS = {
  owner: '船舶所有人/经营人变更',
  name: '船名/船籍港变更',
  rebuild: '船舶改建/重大修理',
  charter: '光船租赁（临时国籍证书）',
  other: '其他登记事项变更',
};

/** 缺陷来源 */
export const DEFECT_SOURCES = {
  selfcheck: '开航前自查',
  inspection: '海事监督检查（现场监督/FSC）',
  company: '公司/船东自查',
};

/** 默认提醒参数 */
export const DEFAULT_SURVEY_WARN_DAYS = 60;
export const DEFAULT_INSURANCE_WARN_DAYS = 30;
export const DEFAULT_DUTY_WARN_DAYS = 30;

// ---------------------------------------------------------------------------
// 一船一档四证钟（内河条例第 6 条；登记条例第 16/45 条；配员规则第 17 条）
// ---------------------------------------------------------------------------

/**
 * 单证钟。levels: unset 未登记（红）/ overdue 过期（红）/ window 换发窗口（黄：届满前 1 年，
 * 仅国籍/配员证书适用）/ warn 临期（黄）/ ok（绿）。
 */
export function docState(doc, todayISOStr, opts = {}) {
  assertISO(todayISOStr);
  const { warnDays = 60, renewWindowDays = 0 } = opts;
  if (!doc?.validISO) {
    return { level: 'unset', detail: `未登记${doc?.label ?? '证书'}有效期——${doc?.basis ?? ''}` };
  }
  const daysLeft = daysUntil(doc.validISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${doc.label}已于 ${doc.validISO} 过期——${doc.basis}` };
  }
  if (renewWindowDays > 0 && daysLeft <= renewWindowDays) {
    return { level: 'window', daysLeft, detail: `${doc.label} ${doc.validISO} 到期（剩 ${daysLeft} 天）——已进入届满前 1 年换发窗口，尽快办换发` };
  }
  if (daysLeft <= warnDays) {
    return { level: 'warn', daysLeft, detail: `${doc.label} ${doc.validISO} 到期（剩 ${daysLeft} 天）——安排检验/换证/续保` };
  }
  return { level: 'ok', daysLeft, detail: `${doc.label}有效期至 ${doc.validISO}` };
}

/** 四证一览（检验证书 warn 60 天；国籍/配员证书 window 365 天；保险 warn 30 天） */
export function shipDocBoard(state, todayISOStr) {
  assertISO(todayISOStr);
  const v = state.ship ?? {};
  const s = state.settings ?? {};
  return Object.entries(SHIP_DOCS).map(([key, def]) => {
    const opts = key === 'survey' ? { warnDays: s.surveyWarnDays ?? DEFAULT_SURVEY_WARN_DAYS }
      : key === 'insurance' ? { warnDays: s.insuranceWarnDays ?? DEFAULT_INSURANCE_WARN_DAYS }
        : { warnDays: 0, renewWindowDays: RENEW_WINDOW_DAYS };
    const st = docState({ label: def.label, basis: def.basis, validISO: v.docs?.[key] }, todayISOStr, opts);
    return { key, label: def.label, basis: def.basis, ...st };
  });
}

// ---------------------------------------------------------------------------
// 船员名册与证书钟（内河适任规则第 16 条；安全监督规则第 41 条）
// ---------------------------------------------------------------------------

/**
 * 入册一名船员。crew: { name, role, certNo, certValidISO, birthISO, healthValidISO, note }
 * 闸机：姓名必填；岗位合法；同姓名同岗位拒绝；适任证书有效期可留空（=unset，开航闸不放行）。
 * birthISO 用于 65 周岁红线校验（内河适任规则第 16 条：有效期截止日不超过 65 周岁生日）。
 */
export function addCrew(state, { name, role, certNo = '', certValidISO = '', birthISO = '', healthValidISO = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('姓名必填');
  if (!CREW_ROLES[role]) throw new Error(`非法岗位: ${role}（船长/驾驶员/轮机员/普通船员）`);
  if (certValidISO) assertISO(certValidISO);
  if (birthISO) assertISO(birthISO);
  if (healthValidISO) assertISO(healthValidISO);
  if ((state.crew ?? []).some((c) => c.name === name && c.role === role)) {
    throw new Error(`${name}（${CREW_ROLES[role]}）已在名册中`);
  }
  state.crewSeq = (state.crewSeq ?? 0) + 1;
  const rec = { id: `cw-${state.crewSeq}`, name, role, certNo, certValidISO, birthISO, healthValidISO, active: true, note };
  state.crew.push(rec);
  return rec;
}

/** 停用/恢复船员（离船停用不删除：历史开航单可回溯到当次点名；停用后开航点名不可选） */
export function setCrewActive(state, crewId, active) {
  const rec = (state.crew ?? []).find((c) => c.id === crewId);
  if (!rec) throw new Error(`船员不存在: ${crewId}`);
  rec.active = !!active;
  return rec;
}

/** 在册船员 */
export function activeCrew(state) {
  return (state.crew ?? []).filter((c) => c.active);
}

/**
 * 适任证书钟（内河适任规则第 16 条）。levels: unset 未登记（红）/ overdue 过期（红）/
 * warn 临期（黄）/ ok。普通船员（sailor）无强制适任证书：未登记=none 不拦；
 * 登记了有效期则照常判定（值班水手持适任证书的情形）。
 */
export function crewCertState(crew, todayISOStr, warnDays = CERT_WARN_DAYS) {
  assertISO(todayISOStr);
  if (!CERT_REQUIRED[crew.role] && !crew.certValidISO) {
    return { level: 'none', detail: `${crew.name}（${CREW_ROLES[crew.role]}）无强制适任证书要求（按培训证明口径管理）` };
  }
  if (!crew.certValidISO) {
    return { level: 'unset', detail: `${crew.name} 未登记适任证书有效期——无适任证件人员擅自航行：个人 2000~2 万+聘用单位 1 万~10 万（内河条例第 66 条）` };
  }
  const daysLeft = daysUntil(crew.certValidISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${crew.name} 适任证书已于 ${crew.certValidISO} 过期——不得担任值班任职（内河适任规则第 16 条）` };
  }
  if (daysLeft <= warnDays) {
    return { level: 'warn', daysLeft, detail: `${crew.name} 适任证书 ${crew.certValidISO} 到期（剩 ${daysLeft} 天）——安排再有效考试/换证` };
  }
  return { level: 'ok', daysLeft, detail: `${crew.name} 适任证书有效期至 ${crew.certValidISO}` };
}

/**
 * 65 周岁红线（内河适任规则第 16 条：适任证书有效期截止日不超过持证人 65 周岁生日）。
 * 已登记生日且证书有效期跨越 65 周岁生日→提示换证受限。
 */
export function crewAgeState(crew, todayISOStr) {
  assertISO(todayISOStr);
  if (!CERT_REQUIRED[crew.role] || !crew.birthISO || !crew.certValidISO) return { level: 'none', detail: '' };
  const ageAtExpiry = ageAt(crew.birthISO, crew.certValidISO);
  if (ageAtExpiry >= 65) {
    return { level: 'warn', detail: `${crew.name} 现证书有效期（${crew.certValidISO}）已跨 65 周岁——换证有效期截止日不得超过 65 周岁生日（内河适任规则第 16 条）` };
  }
  return { level: 'none', detail: '' };
}

/** 健康证明钟（周期参数化，默认 2 年；以内河船员体检口径/证书载明为准） */
export function crewHealthState(crew, todayISOStr, cycleDays = DEFAULT_HEALTH_CYCLE_DAYS, warnDays = HEALTH_WARN_DAYS) {
  assertISO(todayISOStr);
  if (!crew.healthValidISO) {
    return { level: 'unset', detail: `${crew.name} 未登记健康证明有效期——健康证明按船员体检口径管理（参数化 ${Math.round(cycleDays / 30)} 个月）` };
  }
  const daysLeft = daysUntil(crew.healthValidISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${crew.name} 健康证明已于 ${crew.healthValidISO} 过期——安排体检换证后再任职` };
  }
  if (daysLeft <= warnDays) {
    return { level: 'warn', daysLeft, detail: `${crew.name} 健康证明 ${crew.healthValidISO} 到期（剩 ${daysLeft} 天）——安排体检` };
  }
  return { level: 'ok', daysLeft, detail: `${crew.name} 健康证明有效期至 ${crew.healthValidISO}` };
}

/** 船员综合灯（适任+年龄+健康取最严；适任与年龄不适用时回退健康，全不适用=none） */
export function crewGateState(crew, todayISOStr) {
  const rank = { unset: 0, overdue: 0, warn: 1, ok: 2, none: 2 };
  const cand = [crewCertState(crew, todayISOStr), crewHealthState(crew, todayISOStr), crewAgeState(crew, todayISOStr)]
    .filter((x) => x.level !== 'none');
  if (cand.length === 0) return { level: 'none', detail: '' };
  let worst = cand[0];
  for (const x of cand.slice(1)) if (rank[x.level] < rank[worst.level]) worst = x;
  return worst;
}

// ---------------------------------------------------------------------------
// 配员核对引擎（配员规则第 5/7/9 条；内河条例第 6 条(三)/第 65 条）
// ---------------------------------------------------------------------------

/**
 * 配员核对：给定在船船员，验证 ①人数达到核定最低配员 ②船长在船 ③全员证书在期。
 * 核定数与岗位构成照《最低安全配员证书》录入（配员规则附录按种类/吨位/航区核定，不自行推算）。
 */
export function manningCheck(state, crewIds, todayISOStr) {
  assertISO(todayISOStr);
  const need = Number(state.ship?.minCrew ?? 0);
  const all = state.crew ?? [];
  const onBoard = (crewIds ?? []).map((id) => all.find((c) => c.id === id)).filter(Boolean);
  const reasons = [];
  if (need <= 0) {
    reasons.push('未登记《船舶最低安全配员证书》核定的最低配员人数——先在船舶建档录入（配员规则第 17 条随国籍证书核发）');
  }
  const captainOnBoard = onBoard.some((c) => c.role === 'captain');
  if (need > 0 && !captainOnBoard) {
    reasons.push('在船人员中没有船长——开航须由船长签字确认开航前自查并负责指挥（安全监督规则第 42 条）');
  }
  const badCerts = onBoard.filter((c) => !['ok', 'warn'].includes(crewGateState(c, todayISOStr).level));
  for (const c of badCerts) reasons.push(crewGateState(c, todayISOStr).detail);
  if (need > 0 && onBoard.length < need) {
    reasons.push(`在船 ${onBoard.length} 人，未达到配员证书核定最低 ${need} 人——未按规定配员擅自航行：所有人/经营人 1 万~10 万、逾期不改责令停航（内河条例第 65 条）`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    onBoard,
    need,
    detail: need > 0 ? `在船 ${onBoard.length} / 核定 ${need} 人${captainOnBoard ? '·船长在船' : '·缺船长'}` : '核定配员未登记',
  };
}

// ---------------------------------------------------------------------------
// 每日开航前自查卡（安全监督规则第 42 条；内河条例第 44 条枯水/恶劣天气）
// ---------------------------------------------------------------------------

/** 当日应检条目（固定五组，清单格式以海事机构规定为准） */
export function selfcheckItemsFor() {
  return Object.entries(SELFCHECK_ITEMS).map(([key, label]) => ({ key, label }));
}

/** 今日自查卡 */
export function todaySelfcheck(state, dateISO) {
  return (state.selfchecks ?? []).find((d) => d.dateISO === dateISO) ?? null;
}

/**
 * 落一笔开航前自查（同日唯一——固定航线单次航程≤2 小时口径下一天至少一次；多航次船舶
 * 逐航次自查留纸质清单，本卡记当日首航次）。results: { [key]: { ok, note } }
 * 闸机：同日已落拒绝；异常必写处置说明；异常自动转缺陷（未闭环缺陷会拦住开航闸——带病的船开不得）。
 */
export function recordSelfcheck(state, { dateISO, results = {}, note = '' }) {
  assertISO(dateISO);
  const items = selfcheckItemsFor();
  if ((state.selfchecks ?? []).some((d) => d.dateISO === dateISO)) {
    throw new Error(`${dateISO} 已有开航前自查记录（同日唯一；纸质清单逐航次留船，本卡记当日首航次）`);
  }
  const entries = [];
  const defects = [];
  for (const it of items) {
    const r = results[it.key];
    const ok = !!(r && r.ok);
    const itemNote = String(r?.note ?? '').trim();
    if (!ok && !itemNote) {
      throw new Error(`「${it.label}」异常必须写明处置说明——只打叉不留痕不算自查（安全监督规则第 42 条开航前自查制度）`);
    }
    entries.push({ key: it.key, label: it.label, ok, note: itemNote });
    if (!ok) defects.push(it.label);
  }
  state.selfcheckSeq = (state.selfcheckSeq ?? 0) + 1;
  const rec = {
    id: `sc-${state.selfcheckSeq}`, dateISO,
    items: entries,
    status: defects.length ? 'issue' : 'ok',
    signedBy: note?.signedBy ?? '',
    note: typeof note === 'string' ? note : '',
  };
  state.selfchecks.push(rec);
  for (const label of defects) {
    addDefect(state, {
      dateISO,
      source: 'selfcheck',
      desc: `开航前自查异常：${label}——${entries.find((x) => x.label === label)?.note ?? ''}`,
    });
  }
  return rec;
}

/** 最近一次自查，从未返回 null */
export function lastSelfcheck(state) {
  const list = [...(state.selfchecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  return list[0] ?? null;
}

// ---------------------------------------------------------------------------
// 缺陷闭环（状态机 open → fixed → closed；来源：开航前自查/海事监督检查/公司自查）
// ---------------------------------------------------------------------------

/** 手工登记缺陷（自查异常由 recordSelfcheck 自动登记，无需手工重复） */
export function addDefect(state, { dateISO, source = 'company', desc }) {
  assertISO(dateISO);
  if (!DEFECT_SOURCES[source]) throw new Error(`非法来源: ${source}`);
  if (!String(desc || '').trim()) throw new Error('缺陷描述必填');
  state.defectSeq = (state.defectSeq ?? 0) + 1;
  const rec = {
    id: `df-${state.defectSeq}`, dateISO, source, desc,
    action: '', actionISO: '', verifyISO: '', verifiedBy: '', status: 'open',
  };
  state.defects.push(rec);
  return rec;
}

/** 整改（open → fixed）：措施与完成日必填；完成日不得早于发现日 */
export function fixDefect(state, defectId, { actionISO, action }) {
  const df = (state.defects ?? []).find((x) => x.id === defectId);
  if (!df) throw new Error(`缺陷不存在: ${defectId}`);
  if (df.status !== 'open') throw new Error('只有未整改缺陷可以登记整改（状态机 open → fixed → closed）');
  assertISO(actionISO);
  if (actionISO < df.dateISO) throw new Error('整改完成日早于发现日');
  if (!String(action || '').trim()) throw new Error('整改措施必填——只打勾不留痕不算整改');
  df.action = action;
  df.actionISO = actionISO;
  df.status = 'fixed';
  return df;
}

/** 复查销案（fixed → closed）：复查人与复查日必填；闭环后开航闸才放行 */
export function closeDefect(state, defectId, { verifyISO, verifiedBy }) {
  const df = (state.defects ?? []).find((x) => x.id === defectId);
  if (!df) throw new Error(`缺陷不存在: ${defectId}`);
  if (df.status === 'open') throw new Error('先登记整改措施，再复查销案（跳级拒绝）');
  if (df.status === 'closed') throw new Error('该缺陷已闭环');
  assertISO(verifyISO);
  if (verifyISO < df.actionISO) throw new Error('复查日早于整改完成日');
  if (!String(verifiedBy || '').trim()) throw new Error('复查人必填（建议船长/船东）');
  df.verifyISO = verifyISO;
  df.verifiedBy = verifiedBy;
  df.status = 'closed';
  return df;
}

/** 未闭环缺陷（早的在前） */
export function openDefects(state) {
  return (state.defects ?? []).filter((d) => d.status !== 'closed').sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// 开航闸与开航单（产品的门禁：五道闸全过，才许开航）
// ---------------------------------------------------------------------------

/**
 * 开航前体检。返回 { ok, reasons[], gates: [{key, ok, detail}] }，每条拒绝理由都带法条口径。
 * 五道闸（全部通过才放行）：
 * 1. 证书闸：检验证书+国籍证书+配员证书全部在期（内河条例第 6 条(一)(二)/第 64 条：无证擅自
 *    航行暂扣船舶；国籍/配员证书届满前 1 年=换发窗口照常放行只提醒办手续）；
 * 2. 保险闸：责任保险文书在期（内河条例第 67 条：未取得停航+1 万~10 万）；
 * 3. 配员闸：在船人数达到核定+船长在船+在船全员适任/健康证在期（内河条例第 6 条(三)/第 65 条/
 *    第 66 条；安全监督规则第 41 条）；
 * 4. 自查闸：今日开航前自查已签（安全监督规则第 42 条）；
 * 5. 缺陷闸：无未闭环缺陷（安全监督规则第 41 条维护保养+第 42 条自查处置）。
 */
export function openGate(state, { dateISO, crewIds = [] }) {
  assertISO(dateISO);
  const reasons = [];
  const gates = [];

  const docs = shipDocBoard(state, dateISO);
  const g1bad = docs.filter((d) => ['survey', 'national', 'manning'].includes(d.key) && ['unset', 'overdue'].includes(d.level));
  const g1 = g1bad.length === 0;
  for (const d of g1bad) reasons.push(d.detail);
  gates.push({
    key: 'certs', ok: g1,
    detail: g1 ? '检验/国籍/配员证书全部在期' : `${g1bad.length} 证缺位或过期（内河条例第 64 条：无证擅自航行暂扣船舶）`,
  });

  const ins = docs.find((d) => d.key === 'insurance');
  const g2 = ins.level === 'ok' || ins.level === 'warn' || ins.level === 'window';
  if (!g2) reasons.push(ins.detail);
  gates.push({ key: 'insurance', ok: g2, detail: ins.level === 'unset' || ins.level === 'overdue' ? '责任保险文书缺位/过期' : ins.detail });

  const manning = manningCheck(state, crewIds, dateISO);
  const g3 = manning.ok;
  reasons.push(...manning.reasons);
  gates.push({ key: 'manning', ok: g3, detail: manning.detail });

  const sc = todaySelfcheck(state, dateISO);
  const g4 = !!sc;
  if (!g4) reasons.push('今日尚未落开航前自查——离泊前自查、船长签字确认（安全监督规则第 42 条）');
  gates.push({ key: 'selfcheck', ok: g4, detail: sc ? `自查已签（${sc.status === 'issue' ? `含 ${sc.items.filter((i) => !i.ok).length} 项异常处置` : '全项正常'}）` : '未自查' });

  const df = openDefects(state);
  const g5 = df.length === 0;
  if (!g5) reasons.push(`存在 ${df.length} 项未闭环缺陷（最早 ${df[0].dateISO}：${df[0].desc}）——缺陷闭环前不得开航（安全监督规则第 41/42 条）`);
  gates.push({ key: 'defect', ok: g5, detail: g5 ? '无未闭环缺陷' : `${df.length} 项未闭环` });

  return { ok: reasons.length === 0, reasons, gates, manning };
}

/**
 * 落一张开航单：五道闸全部通过才落账，同时记录合规快照。
 * snapshot 记录落账时的四证有效期、在船船员证书期、配员核对——海事登轮检查出示的「今天这船合规开的」证据。
 */
export function addVoyage(state, { dateISO, crewIds = [], note = '' }) {
  assertISO(dateISO);
  if ((state.voyages ?? []).some((v) => v.dateISO === dateISO)) {
    throw new Error(`${dateISO} 已开出开航单（同日唯一；多航次船舶逐航次自查留纸质清单，本单记当日首航次）`);
  }
  const gate = openGate(state, { dateISO, crewIds });
  if (!gate.ok) {
    throw new Error(`开航被闸机拒绝：${gate.reasons.join('；')}`);
  }
  state.voyageSeq = (state.voyageSeq ?? 0) + 1;
  const v = state.ship ?? {};
  const rec = {
    id: `vg-${state.voyageSeq}`, dateISO,
    crewIds: [...crewIds],
    crewNames: gate.manning.onBoard.map((c) => `${c.name}（${CREW_ROLES[c.role]}）`),
    note,
    snapshot: {
      shipName: v.name ?? '',
      docs: Object.fromEntries(Object.entries(v.docs ?? {})),
      minCrew: v.minCrew ?? 0,
      onBoard: gate.manning.onBoard.length,
      crewCerts: Object.fromEntries(gate.manning.onBoard.map((c) => [c.name, { cert: c.certValidISO ?? '', health: c.healthValidISO ?? '' }])),
    },
  };
  state.voyages.push(rec);
  return rec;
}

/** 删除开航单（录错自救；删除埋点留痕） */
export function removeVoyage(state, voyageId) {
  const idx = (state.voyages ?? []).findIndex((v) => v.id === voyageId);
  if (idx < 0) throw new Error(`开航单不存在: ${voyageId}`);
  state.voyages.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 变更登记台账（船舶登记条例：登记事项变更办理）
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

/** 办结变更登记（向船籍港登记机关办理完毕，回执日期） */
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
// 周期义务账（演习/维护/报告核查/图籍/换发窗口/保险；打勾自动滚动）
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

/** 单项义务状态：nextDue = 最近完成日 + 周期；never=从未执行；剩 ≤7 天才标临期（30 天周期义务刚完成不应立即黄） */
export function dutyState(duty, todayISOStr, cycleDays = null) {
  assertISO(todayISOStr);
  const cycle = cycleDays ?? DUTY_KINDS[duty.kind]?.cycleDays ?? 365;
  if (!duty.lastDoneISO) return { level: 'never', cycle };
  const nextDue = addDays(duty.lastDoneISO, cycle);
  const daysLeft = daysUntil(nextDue, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'due' : 'ok';
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
  const items = [];

  // ① 四证钟
  const docs = shipDocBoard(state, todayISOStr);
  const badDocs = docs.filter((d) => ['unset', 'overdue'].includes(d.level));
  const winDocs = docs.filter((d) => d.level === 'window');
  const warnDocs = docs.filter((d) => d.level === 'warn');
  items.push({
    key: 'docs', label: '船舶四证（检验/国籍/配员/保险）',
    level: badDocs.length ? 'bad' : winDocs.length || warnDocs.length ? 'warn' : 'ok',
    detail: badDocs.length
      ? badDocs.map((d) => d.detail).join('；')
      : [...winDocs, ...warnDocs].length
        ? [...winDocs, ...warnDocs].map((d) => d.detail).join('；')
        : '四证全部在期且未进换发窗口',
  });

  // ② 船员名册与适任证书
  const crew = activeCrew(state);
  const badCrew = crew.filter((c) => ['unset', 'overdue'].includes(crewCertState(c, todayISOStr).level));
  const warnCrew = crew.filter((c) => crewCertState(c, todayISOStr).level === 'warn');
  const badHealth = crew.filter((c) => ['unset', 'overdue'].includes(crewHealthState(c, todayISOStr).level));
  items.push({
    key: 'crew', label: '船员名册与适任证书',
    level: !crew.length || badCrew.length || badHealth.length ? 'bad' : warnCrew.length ? 'warn' : 'ok',
    detail: !crew.length
      ? '船员名册为空——船长/驾驶员/轮机员/普通船员按配员证书配齐'
      : badCrew.length || badHealth.length
        ? `${[...badCrew, ...badHealth].map((c) => c.name).join('、')} 适任证书/健康证明缺位或过期——不得任职（内河条例第 66 条）`
        : warnCrew.length
          ? `${crew.length} 人在册，${warnCrew.length} 人适任证书临期（${warnCrew.map((c) => c.name).join('、')}）——安排再有效换证`
          : `${crew.length} 人在册，证书全部在期`,
  });

  // ③ 今日自查与开航单
  const sc = todaySelfcheck(state, todayISOStr);
  const sailed = (state.voyages ?? []).some((v) => v.dateISO === todayISOStr);
  const last = lastSelfcheck(state);
  items.push({
    key: 'selfcheck', label: '开航前自查坚持（第 42 条）',
    level: sc ? 'ok' : last ? 'warn' : 'bad',
    detail: sc
      ? '今日自查已落卡' + (sc.status === 'issue' ? `（${sc.items.filter((i) => !i.ok).length} 项异常已转缺陷）` : '，全项正常')
      : last
        ? `今日未自查（最近一次 ${last.dateISO}）——离泊前自查、船长签字（安全监督规则第 42 条）`
        : '从未落开航前自查卡——第 42 条自查制度无运行证据',
  });
  items.push({
    key: 'voyage', label: '今日开航单',
    level: sailed ? 'ok' : 'warn',
    detail: sailed ? '今日已过五道闸并落账' : '今日尚未开出开航单——非营运日可忽略，营运日先过五道闸',
  });

  // ⑤ 配员静态核对
  const manning = manningCheck(state, activeCrew(state).filter((c) => true).map((c) => c.id), todayISOStr);
  items.push({
    key: 'manning', label: '配员核对（照配员证书核定）',
    level: state.ship?.minCrew > 0 && manning.ok ? 'ok' : state.ship?.minCrew > 0 ? 'warn' : 'bad',
    detail: state.ship?.minCrew > 0
      ? manning.ok
        ? `在册 ${manning.onBoard.length} 人 ≥ 核定 ${manning.need} 人，船长在册`
        : `按在册船员静态核对偏紧：${manning.detail}——开航点名时按班足额（内河条例第 65 条）`
      : '未登记配员证书核定人数——无法核对（配员规则第 17 条）',
  });

  // ⑥ 缺陷与变更
  const openCh = openChanges(state);
  const df = openDefects(state);
  items.push({
    key: 'closure', label: '缺陷闭环与变更登记',
    level: df.some((x) => x.status === 'open') ? 'bad' : df.length || openCh.length ? 'warn' : 'ok',
    detail: [
      df.length ? `${df.length} 项缺陷未销案（最早 ${df[0].dateISO}）——闭环前开航闸不放行` : '',
      openCh.length ? `${openCh.length} 项变更未办结登记——向船籍港登记机关办理` : '',
      !df.length && !openCh.length ? '变更无欠账、缺陷全闭环' : '',
    ].filter(Boolean).join('；'),
  });

  // ⑦⑧⑨ 周期义务（演习/维护/报告核查）
  for (const [key, label] of [['drill', '救生/消防演习'], ['maintenance', '机电维护保养'], ['reportcheck', '进出港报告核查']]) {
    const board = dutyBoard(state, todayISOStr).find((d) => d.kind === key);
    const level = !board || board.level === 'never' || board.level === 'overdue' ? 'bad' : board.level === 'due' ? 'warn' : 'ok';
    items.push({
      key, label: `${label}（${DUTY_KINDS[key].cycleDays} 天周期参数化）`,
      level,
      detail: !board || board.level === 'never'
        ? `从未登记${label}记录——${DUTY_KINDS[key].basis}`
        : board.level === 'overdue'
          ? `${label}已逾期（应于 ${board.nextDue} 前开展）——${DUTY_KINDS[key].basis}`
          : board.level === 'due'
            ? `${label}应于 ${board.nextDue} 前开展（剩 ${board.daysLeft} 天）`
            : `上次${label}：${board.nextDue} 前再开展（剩 ${board.daysLeft} 天）`,
    });
  }

  // ⑩ 图籍与保险义务（推荐性并档，最高黄）
  const charts = dutyBoard(state, todayISOStr).find((d) => d.kind === 'charts');
  const ins2 = dutyBoard(state, todayISOStr).find((d) => d.kind === 'insurance');
  const worst = [charts, ins2].sort((a, b) => ({ never: 0, overdue: 0, due: 1, ok: 2 }[a?.level ?? 'never'] - { never: 0, overdue: 0, due: 1, ok: 2 }[b?.level ?? 'never']))[0];
  items.push({
    key: 'charts', label: '航行资料与保险确认',
    level: !worst || ['never', 'overdue'].includes(worst.level) ? 'warn' : worst.level === 'due' ? 'warn' : 'ok',
    detail: !worst || worst.level === 'never'
      ? '航行资料更新/保险确认未登记——内河条例第 6 条(四)配备必要航行资料、第 67 条保险文书'
      : worst.level === 'overdue'
        ? '航行资料或保险确认已逾期——更新图籍/核对保单'
        : worst.level === 'due'
          ? `应于 ${worst.nextDue} 前开展（剩 ${worst.daysLeft} 天）`
          : '航行资料与保险确认在期',
  });

  const bad = items.filter((i) => i.level === 'bad').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  return { items, bad, warn, score: Math.max(0, 100 - bad * 12 - warn * 4) };
}

// ---------------------------------------------------------------------------
// 月度小结（微信文本通道，确定性输出）
// ---------------------------------------------------------------------------

/**
 * 月度小结。month 形如 '2026-09'。
 */
export function monthlySummary(state, month, todayISOStr = todayISO()) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  assertISO(todayISOStr);
  const inMonth = (iso) => monthKey(iso) === month;
  const voyages = (state.voyages ?? []).filter((v) => inMonth(v.dateISO));
  const blocked = (state.traces ?? []).filter((t) => t.type === 'voyage-blocked' && inMonth((t.dateISO || t.at || '').slice(0, 10)));
  const scs = (state.selfchecks ?? []).filter((d) => inMonth(d.dateISO));
  const issues = scs.filter((d) => d.status === 'issue');
  const dfs = (state.defects ?? []).filter((d) => inMonth(d.dateISO));
  const dfsClosed = dfs.filter((d) => d.status === 'closed');
  const openDf = openDefects(state);
  const hc = healthCheck(state, todayISOStr);

  const L = [];
  L.push(`【内河船舶合规月度小结】${month}`);
  if (state.ship?.name) L.push(`船名：${state.ship.name}（${state.ship.nationalNo || '登记号未填'}；核定最低配员 ${state.ship.minCrew || '—'} 人·在册 ${activeCrew(state).length} 人）`);
  L.push(`开出开航单 ${voyages.length} 张（五道闸全过才落账），闸机拦截不合规开航 ${blocked.length} 次——每次拦截都是没被扣的证据`);
  L.push(`开航前自查 ${scs.length} 次（异常 ${issues.length} 次已转缺陷）；缺陷登记 ${dfs.length} 项、销案 ${dfsClosed.length} 项${openDf.length ? `，仍有 ${openDf.length} 项未闭环（闭环前不开航）` : ''}`);
  const docs = shipDocBoard(state, todayISOStr).filter((d) => ['overdue', 'window', 'warn'].includes(d.level));
  if (docs.length) L.push(`⚠ 证照钟点名：${docs.map((d) => d.detail).join('；')}`);
  const crewBad = activeCrew(state).filter((c) => ['unset', 'overdue'].includes(crewCertState(c, todayISOStr).level));
  if (crewBad.length) L.push(`⚠ 适任证书点名：${crewBad.map((c) => `${c.name}（${crewCertState(c, todayISOStr).detail}）`).join('、')}——不得任职`);
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => d.level === 'never' || d.level === 'overdue');
  if (dutiesLate.length) L.push(`⚠ 周期义务欠账：${dutiesLate.map((d) => d.label).join('、')}`);
  L.push(`账本体检 ${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）`);
  L.push('口径：《内河交通安全管理条例》第 6/63~68 条、《船舶安全监督规则》（2022 年第 27 号令修正）第 11/41/42/44 条、《船舶登记条例》第 16/45 条、《船舶最低安全配员规则》（2004 年第 7 号令，2018 修正）、《内河船舶船员适任考试和发证规则》（2020 年第 12 号令修正）、《船舶检验管理规定》（2016 年第 2 号令）；本小结为船东自查底稿，不替代船舶登记、检验、进出港报告等法定程序。');
  L.push(`生成：船安单 · ${month}`);
  return {
    text: L.join('\n'), voyages: voyages.length, blocked: blocked.length,
    scs: scs.length, dfs: dfs.length, dfsClosed: dfsClosed.length, score: hc.score,
  };
}

// ---------------------------------------------------------------------------
// 出证物（单文件 HTML：海事迎检自证包 / 当次开航单）
// ---------------------------------------------------------------------------

const PRINT_CSS = `
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
  @media print { body { margin: 10mm; } }`;

const DOC_LEVEL = { overdue: '已过期', window: '换发窗口', warn: '临期', ok: '在期', never: '从未开展', unset: '未登记', none: '不适用' };

/** 海事迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏）——对口海事现场监督/FSC 检查 */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const v = state.ship ?? {};

  const hc = healthCheck(state, todayISOStr, settings);
  const hcRows = hc.items.map((i) => `<tr><td>${e(i.label)}</td><td>${DOC_LEVEL[i.level] ?? i.level}</td><td>${e(i.detail)}</td></tr>`).join('');

  const docs = shipDocBoard(state, todayISOStr);
  const docRows = docs.map((d) => `<tr><td>${e(d.label)}</td><td>${e(v.docs?.[d.key] || '—')}</td><td>${e(DOC_LEVEL[d.level] ?? d.level)}</td><td class="w"><span>${e(d.basis)}</span></td></tr>`).join('');

  const crewRows = (state.crew ?? []).map((c) => {
    const cs = crewCertState(c, todayISOStr);
    const hs = crewHealthState(c, todayISOStr);
    return `<tr class="${c.active ? '' : 'muted'}">
    <td>${e(c.name)}</td><td>${e(CREW_ROLES[c.role] ?? c.role)}</td>
    <td>${e(c.certNo || '—')}</td>
    <td>${e(c.certValidISO || '—')}（${e(DOC_LEVEL[cs.level] ?? cs.level)}）</td>
    <td>${e(c.healthValidISO || '—')}（${e(DOC_LEVEL[hs.level] ?? hs.level)}）</td>
    <td>${c.active ? '在册' : '已离船'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="6">船员名册为空</td></tr>';

  const voyageRows = [...(state.voyages ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((v2) => `<tr>
    <td>${e(v2.dateISO)}</td><td>${v2.snapshot?.onBoard ?? '—'} 人（核定 ${e(String(v2.snapshot?.minCrew ?? '—'))}）</td>
    <td class="w"><span>${e(v2.crewNames.join('、'))}</span></td><td>五道闸全过</td>
  </tr>`).join('') || '<tr><td colspan="4">开航记录为空</td></tr>';

  const scRows = [...(state.selfchecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((d) => {
    const bad = d.items.filter((i) => !i.ok);
    return `<tr>
    <td>${e(d.dateISO)}</td><td>${d.items.length} 项</td>
    <td>${bad.length ? `<strong>异常 ${bad.length}</strong>：${e(bad.map((i) => `${i.label}（${i.note}）`).join('；'))}` : '全项正常'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="3">无自查记录</td></tr>';

  const dfRows = [...(state.defects ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((d) => `<tr>
    <td>${e(d.dateISO)}</td><td>${e(DEFECT_SOURCES[d.source] ?? d.source)}</td><td class="w"><span>${e(d.desc)}</span></td>
    <td>${d.status === 'open' ? '<strong>未整改</strong>' : `${e(d.actionISO || '—')} ${e(d.action || '')}`}</td>
    <td>${d.status === 'closed' ? `${e(d.verifyISO)} ${e(d.verifiedBy)}` : d.status === 'fixed' ? '<strong>待复查</strong>' : '<strong>未闭环</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="5">无缺陷登记</td></tr>';

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr>
    <td>${e(c.dateISO)}</td><td>${e(CHANGE_KINDS[c.kind] ?? c.kind)}</td><td class="w"><span>${e(c.detail)}</span></td>
    <td>${c.status === 'filed' ? `${e(c.filedISO)} 已办结` : '<strong>未办结</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="4">暂无变更事项</td></tr>';

  const duRows = dutyBoard(state, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastDoneISO ? e(d.lastDoneISO) : '—'}</td>
    <td>${d.nextDue ? e(d.nextDue) : '—'}</td><td>${DOC_LEVEL[d.level] ?? d.level}</td><td>${e(d.basis)}</td>
  </tr>`).join('') || '<tr><td colspan="5">未登记周期义务</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>内河船舶合规迎检自证包 · ${e(v.name ?? '')}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1>内河船舶合规迎检自证包 · ${e(v.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 船长：${e(v.captain || '—')} · 船籍港：${e(v.port || '—')} · ${e(v.route || '航线未填')} · 联系电话 ${e(v.phone || '—')}</div>
<h2>一、船舶与四证一览（内河条例第 6 条；登记条例第 16 条；配员规则第 17 条）</h2>
<div class="meta">船名：${e(v.name || '—')} · 登记号：${e(v.nationalNo || '—')} · 船检登记号：${e(v.surveyNo || '—')} · 核定最低配员：${e(String(v.minCrew ?? '—'))} 人 · 船舶种类：${e(v.kind || '—')} · 总吨：${e(String(v.gt ?? '—'))}</div>
<table><tr><th>证书/文书</th><th>有效期至</th><th>状态</th><th>依据</th></tr>${docRows}</table>
<h2>二、账本体检（${hc.items.length} 项）</h2>
<div class="meta">体检得分 ${hc.score}（红 ${hc.bad} · 黄 ${hc.warn}）——缺口如实列出，未闭环项以现场整改为准</div>
<table><tr><th>项目</th><th>状态</th><th>说明</th></tr>${hcRows}</table>
<h2>三、船员名册与证书（内河适任规则第 16 条；安全监督规则第 41 条配员）</h2>
<table><tr><th>姓名</th><th>岗位</th><th>适任证书号</th><th>适任证书至</th><th>健康证明至</th><th>状态</th></tr>${crewRows}</table>
<h2>四、开航记录（近 40 日：五道闸全过才落账，含当次快照）</h2>
<table><tr><th>日期</th><th>在船/核定</th><th>在船船员</th><th>闸机</th></tr>${voyageRows}</table>
<h2>五、开航前自查记录（安全监督规则第 42 条；清单在船保存至少 2 年）</h2>
<table><tr><th>日期</th><th>检查项</th><th>结果</th></tr>${scRows}</table>
<h2>六、缺陷整改闭环（自查/海事监督检查/公司自查）</h2>
<table><tr><th>发现日</th><th>来源</th><th>描述</th><th>整改</th><th>复查销案</th></tr>${dfRows}</table>
<h2>七、变更登记台账（船舶登记条例）</h2>
<table><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows}</table>
<h2>八、周期义务账（演习/维护/报告核查/图籍/换发窗口/保险）</h2>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<div class="sign">船长（签字）：____________　船舶所有人/经营人（签字/盖章）：____________　日期：____________</div>
<div class="foot">生成：船安单 VesselPass · ${e(todayISOStr)} · 本页为船东自查与迎检备查材料，不替代船舶登记、检验、进出港报告、船员考证等法定程序；属地海事机构要求永远赢</div>
</body>
</html>`;
}

/** 当次开航单打印版（单文件 HTML）——驾驶室/随船：今天这船是过了五道闸才开的 */
export function voyagePassHtml(state, voyageId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const v = (state.voyages ?? []).find((x) => x.id === voyageId);
  if (!v) throw new Error(`开航单不存在: ${voyageId}`);
  const s = state.ship ?? {};
  const docs = v.snapshot?.docs ?? {};
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>当次开航单 · ${e(v.dateISO)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1>当次开航单（五道闸核对）</h1>
<div class="meta">船名：${e(v.snapshot?.shipName || s.name || '—')} · 日期：${e(v.dateISO)} · 打印日：${e(todayISOStr)} · 航线：${e(s.route || '—')}</div>
<h2>一、闸机核对（落账时点）</h2>
<table>
  <tr><th>检验证书 / 国籍证书 / 配员证书</th><td>检验至 ${e(docs.survey || '—')} · 国籍至 ${e(docs.national || '—')} · 配员至 ${e(docs.manning || '—')}</td></tr>
  <tr><th>责任保险文书</th><td>至 ${e(docs.insurance || '—')}（内河条例第 67 条）</td></tr>
  <tr><th>在船船员</th><td>${v.snapshot?.onBoard ?? '—'} 人（核定最低 ${e(String(v.snapshot?.minCrew ?? '—'))} 人，内河条例第 65 条）</td></tr>
  <tr><th>开航前自查</th><td>已落卡、船长签字（安全监督规则第 42 条）</td></tr>
  <tr><th>未闭环缺陷</th><td>0 项</td></tr>
</table>
<h2>二、当次在船船员（适任证书在期任职——内河适任规则第 16 条）</h2>
<table><tr><th>姓名</th><th>岗位</th><th>适任证书至（落账时）</th><th>健康证明至（落账时）</th></tr>
${v.crewNames.map((n) => {
    const name = n.split('（')[0];
    const role = n.match(/（(.*)）/)?.[1] ?? '';
    const cc = v.snapshot?.crewCerts?.[name] ?? {};
    return `<tr><td>${e(name)}</td><td>${e(role)}</td><td>${e(cc.cert || '—')}</td><td>${e(cc.health || '—')}</td></tr>`;
  }).join('') || '<tr><td colspan="4">—</td></tr>'}
</table>
<h2>三、航行公示自查（内河条例第 68 条：报告航次计划/适航状态/船员配备）</h2>
<div class="meta">进出港信息已按规定报告并记入航行日志：□ 是　□ 否　·　收到枯水/恶劣天气限航通告已核对（第 44 条）：□ 是　□ 否</div>
<div class="sign">船长（签字）：____________　开航时间：____________</div>
<div class="foot">生成：船安单 VesselPass · ${e(todayISOStr)} · 本单为当次开航的自证底稿，不替代进出港报告与监督检查</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 船东备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'vesselpass', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'vesselpass') return { ok: false, error: '不是船安单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.ship === 'object' && s.ship !== null &&
    arr(s.crew) && arr(s.selfchecks) && arr(s.voyages) &&
    arr(s.defects) && arr(s.changes) && arr(s.duties) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
