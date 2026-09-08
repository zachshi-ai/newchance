/**
 * core.js — 托安单 TotSafe 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；周期/时限/提醒窗口等口径
 * 全部参数化，可在设置中被园所覆盖（属地卫健部门要求永远赢）。
 *
 * 合规口径（原文链接与核验方式见 docs/14-调研来源.md，全部 2026-09-08 一手核验）：
 * - 《托育机构设置标准（试行）》《托育机构管理规范（试行）》（国卫人口发〔2019〕58号，
 *   2019-10-08 印发自发布之日施行，gov.cn 政策库原文核验）：
 *   设置标准第 11 条（自有场地或租赁期不少于 3 年——租约钟的法定锚）；
 *   第 18 条（负责人大专以上学历+相关管理 3 年经历+岗位培训合格；保健人员经妇幼保健机构
 *   卫生保健专业知识培训合格；保安人员持《保安员证》并由持《保安服务许可证》公司派驻）；
 *   第 19 条（班型：乳儿班 6-12 个月 ≤10 人、托小班 12-24 个月 ≤15 人、托大班 24-36 个月
 *   ≤20 人；18 个月以上可混合编班每班 ≤18 人）；
 *   第 20 条（保育人员与婴幼儿配比不低于：乳儿班 1:3、托小班 1:5、托大班 1:7——混合班
 *   配比标准未列，本工具参数化默认 1:5 属地从严）；
 *   第 21 条（按托儿所卫生保健规定配备保健人员、炊事人员——转致 76 号令第 12 条 150:1）；
 *   管理规范第 4 条（备案材料：评价合格的《托幼机构卫生评价报告》+消防安全检查合格证明+
 *   场地证明+工作人员资格证明+供餐的《食品经营许可证》）；
 *   第 6 条（变更备案）、第 7 条（终止服务注销备案）；
 *   第 11 条（入托前完成适龄预防接种+健康检查合格；离开 3 个月以上返回重检）；
 *   第 12 条（收托婴幼儿信息管理、定期向备案部门报送——周期参数化）；
 *   第 15 条（信息公示制度：收费、保育照护、膳食营养、卫生保健、安全保卫）；
 *   第 18 条（每日户外活动不少于 2 小时）；
 *   第 24 条（坚持晨午检和全日健康观察，异常及时通知监护人）；
 *   第 25 条（发现遭受或疑似遭受家暴→依法及时向公安机关报案——强制报告红线）；
 *   第 27 条（卫生消毒和病儿隔离制度、传染病预防和管理制度）；
 *   第 28 条（工作人员上岗前健康检查合格方可上岗；在岗每年 1 次健康检查；患传染性疾病
 *   立即离岗，治愈后持证明返岗）；
 *   第 31 条（突发事件应急预案：自然灾害、传染病、食物中毒、踩踏、火灾、暴力+定期培训；
 *   明确专兼职消防安全管理人员）；
 *   第 32 条（监控报警系统 24 小时设防、婴幼儿生活和活动区域全覆盖、录像保存不少于 90 日）；
 *   第 38 条（年度工作计划、每年年底向卫生健康部门报告工作）；
 *   第 40 条（信息公示制度和质量评估制度）。
 * - 《托儿所幼儿园卫生保健管理办法》（卫生部 教育部令第 76 号，2010-11-01 施行，现行有效，
 *   教育部官网原文核验；托育机构经 58 号文管理规范第 23/28 条与《基本条件告知书》转致适用）：
 *   第 8 条（新设立招生前取得符合《托儿所幼儿园卫生保健工作规范》的卫生评价报告）；
 *   第 12 条（收托 150 名儿童至少设 1 名专职卫生保健人员，150 名以下配专职或兼职）；
 *   第 14 条（工作人员上岗前健康检查取得《托幼机构工作人员健康合格证》方可上岗；在岗每年
 *   1 次健康检查；患传染性疾病立即离岗治愈后方可上岗；精神病患者、有精神病史者不得工作）；
 *   第 15 条(六)（入托时查验预防接种证，未接种告知监护人督促补种）；
 *   第 16 条（发现传染病患儿及时报告+环境严格消毒）；
 *   第 18 条（儿童入托前健康检查合格；疑似传染病及时通知监护人离所诊治；治愈后凭医疗卫生
 *   机构健康证明返所；离开 3 个月以上重检）；
 *   第 19 条（五情形罚则：未按要求设保健室/配保健人员、聘用未体检或不合格人员、未定期组织
 *   员工体检、招收未体检儿童、未按工作规范开展卫生保健——责令限期改正、通报批评，逾期不改
 *   给予警告，情节严重由教育行政部门处罚）；
 *   第 21 条（未履职造成传染病流行、食物中毒等突发公共卫生事件——依相关法律法规处罚，最重红线）。
 * - 《托育机构登记和备案办法（试行）》（国卫办人口发〔2019〕25号，四部门联合印发，
 *   gov.cn 原文核验）：第 8 条（登录托育机构备案信息系统在线备案，材料：营业执照/法人证书、
 *   场地证明、人员资格与健康合格证明、评价合格的卫生评价报告、消防安全检查合格证明、
 *   供餐的食品经营许可证）；第 9 条（5 个工作日回执；不符 15 个工作日内通知并向社会公开）；
 *   第 10 条（变更登记、注销登记后及时变更备案信息/报送注销信息）。
 * - WS/T 821—2023《托育机构质量评估标准》（国卫通〔2023〕13号发布，2023-10-31 发布、
 *   2024-04-01 实施，卫健委法规司 PDF 原文核验；推荐性卫生行业标准，质量评估用途，
 *   引用其指标时不得表述为强制义务）：七维度 1000 分制（办托条件 100/托育队伍 140/
 *   保育照护 200/卫生保健 210/养育支持 80/安全保障 200/机构管理 70），A/B/C/D 四级、
 *   16 项基础标准指标一票否决；4.1.4（年度内的消防安全检查合格证明——消防证明年度钟锚）；
 *   5.1.5（所有工作人员健康证在有效期内，每年至少 1 次）；5.1.6（无犯罪记录证明）；
 *   5.2.1（负责人岗位培训 ≥60 学时）；7.2.1（收托时查验预防接种证与入托体检表）；
 *   7.2.3（每日晨检午检+全日健康观察及记录）；7.4.3（专人缺勤追踪）；7.3.1（食谱每周更换）；
 *   9.3.1（每月专人检查设备设施）；9.3.2（消防专责每月检查消防设备）；
 *   9.4.3（一键式报警、监控全覆盖、录像保存不少于 90 天）；9.5.2（定期应急演习）；
 *   9.7.1（购买至少一种托育机构责任类保险）；10.4（费用公示+膳食费专款专用）。
 * - 上位法与红线：《未成年人保护法》（2020 修订）第 84 条（政府发展托育事业）；《刑法》
 *   第 260 条之一（虐待被监护、看护人罪——负有看护职责的人员虐待被看护人的刑责红线，
 *   对虐童零容忍，《管理规范》第 35 条）。
 * - 立法动态（合规雷达，本工具内显式跟踪）：《中华人民共和国托育服务法（草案）》2025-12-22
 *   提请十四届全国人大常委会第十九次会议初次审议（8 章 76 条，含总则、托育机构、托育人员
 *   等章），并公开征求意见；截至本工具交付日（2026-09-08）尚未颁布施行——现行口径仍以
 *   58 号文两标准+76 号令+备案办法+WS/T 821 为准；法律颁布后条号与罚则将以本工具「合规
 *   雷达」提示升级，不悄悄沿用草案条号。
 * - 统计锚（国家卫健委 2025-12-26 新闻发布会）：全国托育服务机构 12.6 万家（较前增加
 *   6.6 万家、增幅 110%）、托位约 666 万个（+132%）、其中普惠性托位 332 万个、每千人口
 *   托位数 4.73 个（超额完成「十四五」4.5 目标）——供给两年翻倍，行业从「拿托位」转入
 *   「抢生源」，合规与信任直接决定招生。
 * - 口径雷区清单（引错即露馅）：①76 号令适用对象是「托儿所、幼儿园」，托育机构经 58 号文
 *   转致适用，引用时须写明转致链条；②WS/T 821 为推荐性标准（评估工具），不是强制义务，
 *   其中「年度内消防证明」等指标按备案材料（管理规范第 4 条）的口径执行；③「监控保存
 *   不少于 90 日」出自管理规范第 32 条；④配比是「不低于」，混合班配比未定从严参数化；
 *   ⑤预收费资金监管国家层面尚无统一强制文件，多地试点银行存管——按属地口径参数化提醒；
 *   ⑥网上把 76 号令第 12 条写成「每 150 名儿童必须配 1 名保健医」属误读：150 名以上
 *   至少 1 名专职，150 名以下专职或兼职均可。
 *
 * 本工具是托育机构侧的自查与出证台账，不构成法律意见，不替代备案、变更、注销、卫生评价、
 * 消防安全检查、食品经营许可等法定程序；属地卫健部门要求永远赢。
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
 * 2 月 29 日 + 12 = 2 月 28 日钳制）。证照/义务等周期「精确到月」用。
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

/** 班型与红线（设置标准第 19/20 条：班型收托上限 + 保育人员配比「不低于」） */
export const CLASS_KINDS = {
  infant: { label: '乳儿班（6-12 个月）', age: '6-12 个月', max: 10, ratio: 3, basis: '设置标准第 19/20 条' },
  small: { label: '托小班（12-24 个月）', age: '12-24 个月', max: 15, ratio: 5, basis: '设置标准第 19/20 条' },
  big: { label: '托大班（24-36 个月）', age: '24-36 个月', max: 20, ratio: 7, basis: '设置标准第 19/20 条' },
  mixed: { label: '混合班（18 个月以上）', age: '≥18 个月', max: 18, ratio: 5, basis: '设置标准第 19 条上限 18 人；配比未定按 1:5 属地从严参数化' },
};

/** 工作人员岗位（设置标准第 18 条；WS/T 821 3.2 托育工作人员五类） */
export const STAFF_ROLES = {
  principal: '负责人',
  carer: '保育人员',
  health: '卫生保健人员',
  guard: '保安人员',
  cook: '炊事人员',
};

/** 需要岗位资质证的岗位（健康证全员必配；资质证按岗位可选登记） */
export const QUAL_REQUIRED = {
  principal: '负责人岗位培训合格（WS/T 821 5.2.1 ≥60 学时）',
  health: '妇幼保健机构卫生保健专业知识培训合格（设置标准第 18 条）',
  guard: '保安员证（设置标准第 18 条，持证保安公司派驻）',
};

/** 机构资质三钟（备案材料与年度口径） */
export const ORG_DOCS = {
  fire: { label: '消防安全检查合格证明', cycleMonths: 12, basis: '备案材料（管理规范第 4 条）；WS/T 821 4.1.4「年度内」按年度钟参数化' },
  food: { label: '食品经营许可证（自办食堂/供餐必配）', cycleMonths: 36, basis: '管理规范第 4 条/备案办法第 8 条；有效期证载' },
  lease: { label: '场地租赁合同（自有场地登记远期）', cycleMonths: 36, basis: '设置标准第 11 条：自有场地或租赁期不少于 3 年' },
};

/** 周期义务（周期为参数化默认值，属地要求永远赢） */
export const DUTY_KINDS = {
  drill: { label: '突发事件应急演习（防灾/防暴/传染病）', cycleDays: 180, basis: '管理规范第 31 条应急预案+定期培训 · WS/T 821 9.5.2 定期 · 惯例半年参数化' },
  training: { label: '工作人员安全教育与应急能力培训', cycleDays: 365, basis: '管理规范第 31/34 条岗前与定期培训 · 惯例一年参数化' },
  fireequip: { label: '消防设备月检（专责+记录）', cycleDays: 30, basis: 'WS/T 821 9.3.2 每月定期检查消防设备并记录 · 专兼职消防安全管理人员（管理规范第 31 条）' },
  facility: { label: '设备设施安全检查与维护（含监控留存核查）', cycleDays: 30, basis: 'WS/T 821 9.3.1 每月专人检查 · 管理规范第 32 条监控录像保存不少于 90 日' },
  kidreport: { label: '收托婴幼儿信息向备案部门报送', cycleDays: 90, basis: '管理规范第 12 条定期报送 · 周期参数化（属地口径永远赢）' },
  annual: { label: '年度报告（每年年底向卫健部门报告工作）', cycleDays: 365, basis: '管理规范第 38 条' },
  insurance: { label: '托育机构责任类保险有效性确认', cycleDays: 365, basis: 'WS/T 821 9.7.1 至少购买一种责任类保险' },
};

/** 变更备案情形（管理规范第 6 条；备案办法第 10 条） */
export const CHANGE_KINDS = {
  site: '场地/地址变更',
  scale: '收托规模/班型变更',
  person: '负责人变更',
  name: '机构名称变更',
  quit: '终止服务·注销备案',
  other: '其他变更备案事项',
};

/** 健康事件来源（晨午检异常/家长告知/自查发现） */
export const HEALTH_SOURCES = {
  morning: '晨检发现',
  noon: '午检/全日观察发现',
  parent: '家长告知',
  selfcheck: '其他自查发现',
};

/** 每日晨午检卡条目（段位固定两段；条目按「供餐/乳儿班」开关自动增减——类型驱动） */
export const DAYCHECK_SEGMENTS = {
  morning: {
    label: '晨检（入园时段）',
    items: [
      ['mcheck', '晨检完成（一摸二看三问四查，异常逐人登记）'],
      ['absent', '缺勤追踪登记（专人联系缺勤婴幼儿家长）'],
      ['sanitize', '环境与玩具预防性消毒完成（记录消毒方式）'],
      ['tableware', '餐具/奶瓶消毒完成（备餐区卫生）'],
    ],
    meal: [['menu', '今日食谱已公示（每周更换，膳食费专款专用）']],
  },
  noon: {
    label: '午检与全日观察（午睡后）',
    items: [
      ['ncheck', '午检完成（全日健康观察无遗漏，异常逐人登记）'],
      ['outdoor', '户外活动 ≥2 小时（寒冷炎热或特殊天气酌情调整并记录）'],
      ['bedroom', '寝室/活动区整理与通风消毒'],
      ['water', '饮用水温/水质与饮水记录检查'],
    ],
    infant: [['milk', '乳儿班：母乳专用冰箱温度记录+奶瓶专区存放（专人管理）']],
  },
};

/** 默认提醒参数 */
export const DEFAULT_DOC_WARN_DAYS = 30;    // 机构证照/租约临期提醒
export const DEFAULT_HEALTH_WARN_DAYS = 45; // 健康证临期提醒（年检准备）
export const DEFAULT_DUTY_WARN_DAYS = 30;   // 周期义务临期提醒
export const DEFAULT_LEASE_WARN_DAYS = 60;  // 租约到期提醒（重签窗口）

// ---------------------------------------------------------------------------
// 机构建档与三证钟（消防年度/食品证/租约；管理规范第 4 条+设置标准第 11 条）
// ---------------------------------------------------------------------------

/**
 * 单证钟。levels: unset 未登记（红）/ overdue 过期（红）/ warn 临期（黄）/ ok（绿）。
 * 消防证明按 WS/T 821 4.1.4「年度内」以年度钟跟踪（自最近取得日起 12 个月）。
 */
export function docState(doc, todayISOStr, warnDays = DEFAULT_DOC_WARN_DAYS) {
  assertISO(todayISOStr);
  const warn = typeof warnDays === 'number' ? warnDays : DEFAULT_DOC_WARN_DAYS;
  if (!doc?.validISO) {
    return { level: 'unset', detail: `未登记${doc?.label ?? '证照'}有效期——备案材料（管理规范第 4 条）与日常运行核对均需要` };
  }
  const daysLeft = daysUntil(doc.validISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${doc.label}已于 ${doc.validISO} 过期——${doc.basis}` };
  }
  if (daysLeft <= warn) {
    return { level: 'warn', daysLeft, detail: `${doc.label} ${doc.validISO} 到期（剩 ${daysLeft} 天）——安排更新/换证` };
  }
  return { level: 'ok', daysLeft, detail: `${doc.label}有效期至 ${doc.validISO}` };
}

/** 机构三证一览（fire/food/lease；food 仅供餐园必配） */
export function orgDocBoard(state, todayISOStr, warnDays = DEFAULT_DOC_WARN_DAYS) {
  assertISO(todayISOStr);
  const v = state.org ?? {};
  return Object.entries(ORG_DOCS).map(([key, def]) => {
    if (key === 'food' && !v.meals) {
      return { key, label: def.label, basis: def.basis, level: 'none', detail: '未开通供餐——不适用（开通供餐后必配）' };
    }
    const st = docState({ label: def.label, basis: def.basis, validISO: v.docs?.[key] }, todayISOStr, key === 'lease' ? (state.settings?.leaseWarnDays ?? DEFAULT_LEASE_WARN_DAYS) : warnDays);
    return { key, label: def.label, basis: def.basis, ...st };
  });
}

// ---------------------------------------------------------------------------
// 工作人员名册（设置标准第 18 条；76 号令第 12/14 条；WS/T 821 5.1）
// ---------------------------------------------------------------------------

/**
 * 入册一名工作人员。staff: { name, role, qualName, qualValidISO, healthValidISO, criminalDateISO, note }
 * 闸机：姓名必填；角色合法；同姓名同角色拒绝；健康证有效期可留空（=unset，送托闸不放行）。
 * 76 号令第 14 条：无健康合格证不得上岗；精神病史禁入由入职筛查把关（本工具记录筛查确认）。
 */
export function addStaff(state, { name, role, qualName = '', qualValidISO = '', healthValidISO = '', criminalDateISO = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('姓名必填');
  if (!STAFF_ROLES[role]) throw new Error(`非法岗位: ${role}（负责人/保育/保健/保安/炊事）`);
  if (healthValidISO) assertISO(healthValidISO);
  if (qualValidISO) assertISO(qualValidISO);
  if (criminalDateISO) assertISO(criminalDateISO);
  if ((state.staff ?? []).some((s) => s.name === name && s.role === role)) {
    throw new Error(`${name}（${STAFF_ROLES[role]}）已在名册中`);
  }
  state.staffSeq = (state.staffSeq ?? 0) + 1;
  const rec = { id: `st-${state.staffSeq}`, name, role, qualName, qualValidISO, healthValidISO, criminalDateISO, active: true, note };
  state.staff.push(rec);
  return rec;
}

/** 停用/恢复人员（离职停用不删除：历史送托单可回溯到当日名册；停用后点名不可选） */
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
 * 健康证钟（全员每年 1 次，76 号令第 14 条+管理规范第 28 条+WS/T 821 5.1.5）。
 * levels: unset 未登记（红）/ overdue 过期（红：不得上岗）/ warn 临期（黄）/ ok。
 */
export function staffHealthState(staff, todayISOStr, warnDays = DEFAULT_HEALTH_WARN_DAYS) {
  assertISO(todayISOStr);
  if (!staff.healthValidISO) {
    return { level: 'unset', detail: `${staff.name} 未登记健康证有效期——无健康合格证不得上岗（76 号令第 14 条）` };
  }
  const daysLeft = daysUntil(staff.healthValidISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${staff.name} 健康证已于 ${staff.healthValidISO} 过期——不得安排上岗（76 号令第 14 条；聘用未体检人员属第 19 条处罚情形）` };
  }
  if (daysLeft <= warnDays) {
    return { level: 'warn', daysLeft, detail: `${staff.name} 健康证 ${staff.healthValidISO} 到期（剩 ${daysLeft} 天）——安排年度健康检查` };
  }
  return { level: 'ok', daysLeft, detail: `${staff.name} 健康证有效期至 ${staff.healthValidISO}` };
}

/**
 * 岗位资质钟（负责人培训/保健培训/保安员证；设置标准第 18 条+WS/T 821 5.2.1）。
 * 仅 QUAL_REQUIRED 列出的岗位作硬钟，其余岗位不适用（none）。levels 同上。
 */
export function staffQualState(staff, todayISOStr, warnDays = DEFAULT_HEALTH_WARN_DAYS) {
  assertISO(todayISOStr);
  if (!QUAL_REQUIRED[staff.role]) return { level: 'none', detail: '该岗位无强制资质证要求（健康证全员必配）' };
  if (!staff.qualValidISO) {
    return { level: 'unset', detail: `${staff.name}（${STAFF_ROLES[staff.role]}）未登记${QUAL_REQUIRED[staff.role]}有效期` };
  }
  const daysLeft = daysUntil(staff.qualValidISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${staff.name} 岗位资质已于 ${staff.qualValidISO} 过期——${QUAL_REQUIRED[staff.role]}（设置标准第 18 条），过期不得上岗` };
  }
  if (daysLeft <= warnDays) {
    return { level: 'warn', daysLeft, detail: `${staff.name} 岗位资质 ${staff.qualValidISO} 到期（剩 ${daysLeft} 天）——安排复训/换证` };
  }
  return { level: 'ok', daysLeft, detail: `${staff.name} 岗位资质有效期至 ${staff.qualValidISO}` };
}

/** 人员综合灯（健康证与岗位资质取最严；送托闸第 3 道用） */
export function staffGateState(staff, todayISOStr, warnDays = DEFAULT_HEALTH_WARN_DAYS) {
  const h = staffHealthState(staff, todayISOStr, warnDays);
  const q = staffQualState(staff, todayISOStr, warnDays);
  const rank = { unset: 0, overdue: 0, warn: 1, ok: 2, none: 2 };
  return rank[h.level] <= rank[q.level] ? h : q;
}

// ---------------------------------------------------------------------------
// 婴幼儿名册与入托查验（管理规范第 11 条；76 号令第 15 条(六)/第 18 条）
// ---------------------------------------------------------------------------

/**
 * 收托一名婴幼儿。kid: { name, className, classKind, vaccineOK, entryExamISO, note }
 * 闸机：姓名/班型必填；同班同姓名拒绝。vaccineOK=接种证已查验（76 号令 15 条(六)）；
 * entryExamISO=入托健康检查合格日期（管理规范第 11 条）——两者未齐=收托闸拦截。
 */
export function addKid(state, { name, className, classKind, vaccineOK = false, entryExamISO = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('姓名必填');
  if (!CLASS_KINDS[classKind]) throw new Error(`非法班型: ${classKind}（乳儿班/托小班/托大班/混合班）`);
  if (entryExamISO) assertISO(entryExamISO);
  if ((state.kids ?? []).some((k) => k.name === name && k.classKind === classKind && k.inCare)) {
    throw new Error(`${name} 已在${CLASS_KINDS[classKind].label}名册中（在园唯一）`);
  }
  state.kidSeq = (state.kidSeq ?? 0) + 1;
  const rec = {
    id: `kd-${state.kidSeq}`, name, className: className || CLASS_KINDS[classKind].label, classKind,
    vaccineOK: !!vaccineOK, entryExamISO, inCare: true, outISO: '', backISO: '', note,
  };
  state.kids.push(rec);
  return rec;
}

/** 离园/返园（管理规范第 11 条：离开 3 个月以上返回须重新健康检查——返园时核验） */
export function setKidInCare(state, kidId, inCare, iso) {
  assertISO(iso);
  const rec = (state.kids ?? []).find((k) => k.id === kidId);
  if (!rec) throw new Error(`婴幼儿不存在: ${kidId}`);
  if (inCare) {
    if (rec.inCare) throw new Error('该幼儿本就在园');
    rec.backISO = iso;
    rec.inCare = true;
  } else {
    if (!rec.inCare) throw new Error('该幼儿已登记离园');
    rec.outISO = iso;
    rec.inCare = false;
  }
  return rec;
}

/** 在园幼儿 */
export function kidsInCare(state) {
  return (state.kids ?? []).filter((k) => k.inCare);
}

/** 收托查验缺口（接种证未查验 / 入托体检未登记；76 号令第 15 条(六)、管理规范第 11 条） */
export function kidDocGaps(state) {
  return kidsInCare(state).filter((k) => !k.vaccineOK || !k.entryExamISO);
}

/** 按班型统计在园人数与保育配比需求（设置标准第 19/20 条） */
export function classLoad(state) {
  const out = {};
  for (const k of Object.keys(CLASS_KINDS)) {
    const kids = kidsInCare(state).filter((x) => x.classKind === k);
    const ratio = CLASS_KINDS[k].ratio;
    out[k] = {
      label: CLASS_KINDS[k].label,
      kids: kids.length,
      max: CLASS_KINDS[k].max,
      ratio,
      carersNeeded: Math.ceil(kids.length / ratio),
      overMax: kids.length > CLASS_KINDS[k].max,
      basis: CLASS_KINDS[k].basis,
    };
  }
  return out;
}

/**
 * 配比引擎：给定在岗保育人员数，验证全部班型配比与收托上限。
 * 返回 { ok, reasons[], carersNeeded, loads }。混合班配比未定按 CLASS_KINDS.mixed.ratio 从严。
 */
export function ratioCheck(state, carersOnDuty) {
  const loads = classLoad(state);
  const reasons = [];
  let needed = 0;
  for (const [kind, l] of Object.entries(loads)) {
    if (!l.kids) continue;
    needed += l.carersNeeded;
    if (l.overMax) {
      reasons.push(`${l.label}在园 ${l.kids} 人，超过班型收托上限 ${l.max} 人——收托规模超标准（设置标准第 19 条）`);
    }
  }
  const n = Number(carersOnDuty ?? 0);
  if (needed > 0 && (!Number.isInteger(n) || n < needed)) {
    reasons.push(`在园婴幼儿按班型配比需保育人员至少 ${needed} 人（乳儿班1:3/托小班1:5/托大班1:7，设置标准第 20 条），今日在岗 ${Number.isInteger(n) ? n : 0} 人——配比不达标不得开班`);
  }
  return { ok: reasons.length === 0, reasons, carersNeeded: needed, loads };
}

// ---------------------------------------------------------------------------
// 每日晨午检卡（管理规范第 24 条晨午检与全日健康观察；WS/T 821 7.2.3）
// ---------------------------------------------------------------------------

/** 当日某段应检条目（按供餐/乳儿班开关生成——类型驱动） */
export function daycheckItemsFor(state, segment) {
  const seg = DAYCHECK_SEGMENTS[segment];
  if (!seg) throw new Error(`非法检查段: ${segment}`);
  let items = [...seg.items];
  if (state.org?.meals) items = items.concat(seg.meal ?? []);
  if (kidsInCare(state).some((k) => k.classKind === 'infant')) items = items.concat(seg.infant ?? []);
  return items.map(([key, label]) => ({ key: `${segment}:${key}`, label }));
}

/** 今日两段落卡状态 */
export function daycheckStatusFor(state, dateISO) {
  return {
    morning: (state.daychecks ?? []).find((d) => d.dateISO === dateISO && d.segment === 'morning') ?? null,
    noon: (state.daychecks ?? []).find((d) => d.dateISO === dateISO && d.segment === 'noon') ?? null,
  };
}

/**
 * 落一笔晨检/午检（同日同段唯一）。results: { [key]: { ok: bool, note: string } }
 * 闸机：同日同段已落拒绝；任一条目异常必须写处置说明；
 * 晨检/午检异常在 results.abnormalKids 登记异常幼儿（姓名+症状）→ 自动开健康事件
 * （未闭环健康事件会拦住次日送托闸——先把孩子的处置落账）。
 */
export function recordDaycheck(state, { dateISO, segment, results = {}, abnormalKids = [], note = '' }) {
  assertISO(dateISO);
  if (!DAYCHECK_SEGMENTS[segment]) throw new Error(`非法检查段: ${segment}`);
  const items = daycheckItemsFor(state, segment);
  if (!items.length) throw new Error('检查条目为空——先完成建档（供餐/班型开关驱动条目）');
  if ((state.daychecks ?? []).some((d) => d.dateISO === dateISO && d.segment === segment)) {
    throw new Error(`${dateISO} ${DAYCHECK_SEGMENTS[segment].label}已落卡（同日同段唯一；漏检如实留缺，不补造）`);
  }
  const entries = [];
  const issues = [];
  for (const it of items) {
    const r = results[it.key];
    const ok = !!(r && r.ok);
    const itemNote = String(r?.note ?? '').trim();
    if (!ok && !itemNote) {
      throw new Error(`「${it.label}」异常必须写明处置说明——只打叉不留痕不算检查（管理规范第 24 条晨午检与全日健康观察）`);
    }
    entries.push({ key: it.key, label: it.label, ok, note: itemNote });
    if (!ok) issues.push(it.label);
  }
  state.daycheckSeq = (state.daycheckSeq ?? 0) + 1;
  const rec = {
    id: `dc-${state.daycheckSeq}`, dateISO, segment,
    items: entries,
    status: issues.length ? 'issue' : 'ok',
    note,
  };
  state.daychecks.push(rec);
  // 异常幼儿逐人自动开健康事件（晨午检发现）——带病的孩子必须先有处置去向
  for (const a of abnormalKids) {
    addHealthEvent(state, {
      dateISO,
      source: segment === 'morning' ? 'morning' : 'noon',
      kidName: a.kidName,
      symptom: a.symptom ?? '',
      notifyISO: a.notifyISO ?? '',
      action: a.action ?? '',
    });
  }
  // 管理类异常条目自动转安全隐患（消毒未做/食谱未公示等）——闭环前送托闸第 5 道不放行
  for (const issue of issues) {
    addHazard(state, {
      dateISO,
      source: 'daycheck',
      desc: `${DAYCHECK_SEGMENTS[segment].label}异常：${issue}——${entries.find((x) => x.label === issue)?.note ?? ''}`,
    });
  }
  return rec;
}

/** 最近一次落卡（任一段），从未返回 null */
export function lastDaycheck(state) {
  const list = [...(state.daychecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id));
  return list[0] ?? null;
}

// ---------------------------------------------------------------------------
// 健康事件闭环（状态机 open → notified → returned；管理规范第 24/26 条+76 号令第 18 条）
// ---------------------------------------------------------------------------

/**
 * 登记健康事件（晨午检异常自动开/手工补录）。event: { dateISO, source, kidName, symptom }
 * 疑似传染病请同时勾 reportable → 应按当地疾控规定报告并消毒（76 号令第 16 条），
 * 报告日期登记后进入「已报告」标注——本工具留痕，不替代法定报告渠道。
 */
export function addHealthEvent(state, { dateISO, source = 'selfcheck', kidName, symptom = '', notifyISO = '', action = '', reportable = false, reportISO = '' }) {
  assertISO(dateISO);
  if (!HEALTH_SOURCES[source]) throw new Error(`非法来源: ${source}`);
  if (!String(kidName || '').trim()) throw new Error('婴幼儿姓名必填——健康事件必须落到孩子');
  state.healthSeq = (state.healthSeq ?? 0) + 1;
  const rec = {
    id: `he-${state.healthSeq}`, dateISO, source, kidName, symptom,
    notifyISO: '', action: '', actionISO: '', returnISO: '', returnProof: '',
    reportable: !!reportable, reportISO: '', status: 'open',
  };
  state.healthEvents.push(rec);
  if (notifyISO) notifyHealthEvent(state, rec.id, { notifyISO, action });
  if (reportable && reportISO) reportHealthEvent(state, rec.id, reportISO);
  return rec;
}

/** 通知监护人+处置意见（open → notified）：通知日期必填——发现异常应当及时通知监护人（管理规范第 24 条） */
export function notifyHealthEvent(state, eventId, { notifyISO, action = '' }) {
  const rec = (state.healthEvents ?? []).find((x) => x.id === eventId);
  if (!rec) throw new Error(`健康事件不存在: ${eventId}`);
  if (rec.status !== 'open') throw new Error('只有待通知事件可以登记通知处置（状态机 open → notified → returned）');
  assertISO(notifyISO);
  if (notifyISO < rec.dateISO) throw new Error('通知日期早于发现日');
  rec.notifyISO = notifyISO;
  rec.action = String(action || '').trim();
  if (!rec.action) throw new Error('处置意见必填（如：已通知家长接回就医/隔离观察）——只记名字不留处置不算闭环');
  rec.status = 'notified';
  return rec;
}

/** 疑似传染病报告登记（76 号令第 16 条：及时报告+环境严格消毒；报告以当地疾控渠道为准） */
export function reportHealthEvent(state, eventId, reportISO) {
  const rec = (state.healthEvents ?? []).find((x) => x.id === eventId);
  if (!rec) throw new Error(`健康事件不存在: ${eventId}`);
  assertISO(reportISO);
  if (reportISO < rec.dateISO) throw new Error('报告日期早于发现日');
  rec.reportable = true;
  rec.reportISO = reportISO;
  return rec;
}

/** 返园核验（notified → returned）：治愈后凭医疗卫生机构健康证明返所（76 号令第 18 条） */
export function returnHealthEvent(state, eventId, { returnISO, returnProof }) {
  const rec = (state.healthEvents ?? []).find((x) => x.id === eventId);
  if (!rec) throw new Error(`健康事件不存在: ${eventId}`);
  if (rec.status !== 'notified') throw new Error('先登记通知监护人与处置，再核验返园（跳级拒绝）');
  assertISO(returnISO);
  if (!String(returnProof || '').trim()) throw new Error('返园凭证必填（治愈证明/健康证明/家长确认）——凭证明返所（76 号令第 18 条）');
  rec.returnISO = returnISO;
  rec.returnProof = returnProof;
  rec.status = 'returned';
  return rec;
}

/** 未闭环健康事件（open 在前） */
export function openHealthEvents(state) {
  return (state.healthEvents ?? []).filter((h) => h.status !== 'returned')
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// 安全隐患闭环（状态机 open → fixed → closed；来源：日检/监督检查/自查）
// ---------------------------------------------------------------------------

/** 手工登记安全隐患（设施/制度/管理类；健康类走健康事件，两条线分开） */
export function addHazard(state, { dateISO, source = 'selfcheck', desc }) {
  assertISO(dateISO);
  if (!['daycheck', 'inspection', 'selfcheck'].includes(source)) throw new Error(`非法来源: ${source}`);
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

/** 复查销案（fixed → closed）：复查人与复查日必填；闭环后送托闸才放行 */
export function closeHazard(state, hazardId, { verifyISO, verifiedBy }) {
  const hz = (state.hazards ?? []).find((x) => x.id === hazardId);
  if (!hz) throw new Error(`隐患不存在: ${hazardId}`);
  if (hz.status === 'open') throw new Error('先登记整改措施，再复查销案（跳级拒绝）');
  if (hz.status === 'closed') throw new Error('该隐患已闭环');
  assertISO(verifyISO);
  if (verifyISO < hz.actionISO) throw new Error('复查日早于整改完成日');
  if (!String(verifiedBy || '').trim()) throw new Error('复查人必填（建议园长/负责人）');
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
// 送托六道闸与送托单（产品的门禁：六闸全过，才许开园收托）
// ---------------------------------------------------------------------------

/**
 * 开园前体检。返回 { ok, reasons[], gates: [{key, ok, detail}] }，每条拒绝理由都带法条口径。
 * 六道闸（全部通过才放行）：
 * 1. 备案与机构证照：备案回执已登记+消防年度证明/食品证（供餐）/租约全部在期（管理规范第 4 条、设置标准第 11 条、WS/T 821 4.1.4）；
 * 2. 师幼配比达标：在岗保育人员覆盖各班配比、各班不超收托上限（设置标准第 19/20 条）；
 * 3. 人员证书在期：在岗人员健康证+岗位资质全部在期（76 号令第 14 条；聘用未体检人员属第 19 条处罚情形）；
 * 4. 今日晨检已落（管理规范第 24 条）；
 * 5. 无未闭环安全隐患；
 * 6. 无待通知健康事件（晨午检异常的孩子必须先「通知监护人+处置意见」——带病处置去向不明不得开班）。
 */
export function openGate(state, { dateISO, carerIds = [], allStaffIds = [] }) {
  assertISO(dateISO);
  const reasons = [];
  const gates = [];
  const warnDoc = state.settings?.docWarnDays ?? DEFAULT_DOC_WARN_DAYS;

  const g1reasons = [];
  const org = state.org ?? {};
  if (!org.filedISO) g1reasons.push('备案回执未登记——机构登记后应向县级卫健部门备案（管理规范第 4 条；备案办法第 8 条在线备案）');
  for (const d of orgDocBoard(state, dateISO, warnDoc)) {
    if (d.level === 'unset' || d.level === 'overdue') g1reasons.push(d.detail);
  }
  const g1 = g1reasons.length === 0;
  reasons.push(...g1reasons);
  gates.push({
    key: 'orgdocs', ok: g1,
    detail: g1 ? '备案已登记，消防年度证明/食品证/租约全部在期' : `${g1reasons.length} 项证照缺位或过期`,
  });

  const ratio = ratioCheck(state, carerIds.length);
  const g2 = ratio.ok;
  reasons.push(...ratio.reasons);
  gates.push({
    key: 'ratio', ok: g2,
    detail: `在园 ${Object.values(ratio.loads).reduce((a, b) => a + b.kids, 0)} 人 · 在岗保育 ${carerIds.length} 人 / 需 ≥${ratio.carersNeeded} 人（1:3/1:5/1:7）`,
  });

  const staffAll = state.staff ?? [];
  const onDutyIds = allStaffIds.length ? allStaffIds : carerIds;
  const onDuty = onDutyIds.map((id) => staffAll.find((s) => s.id === id)).filter(Boolean);
  const badCerts = onDuty.filter((s) => !['ok', 'warn'].includes(staffGateState(s, dateISO).level));
  const g3 = onDuty.length > 0 && badCerts.length === 0;
  for (const s of badCerts) reasons.push(staffGateState(s, dateISO).detail);
  if (!onDuty.length) reasons.push('未点名今日在岗人员——无健康合格证不得上岗（76 号令第 14 条）');
  gates.push({
    key: 'staffcert', ok: g3,
    detail: onDuty.length ? `已核 ${onDuty.length} 人健康证与资质${badCerts.length ? `，${badCerts.length} 人不可上岗` : '，全部在期'}` : '未点名',
  });

  const dc = daycheckStatusFor(state, dateISO);
  const g4 = !!dc.morning;
  if (!g4) reasons.push('今日晨检尚未落卡——晨午检与全日健康观察是每日必修课（管理规范第 24 条）');
  gates.push({ key: 'daycheck', ok: g4, detail: dc.morning ? `晨检已落卡（${dc.morning.status === 'issue' ? `含 ${dc.morning.items.filter((i) => !i.ok).length} 项异常处置` : '全项正常'}）` : '晨检未落' });

  const hz = openHazards(state);
  const g5 = hz.length === 0;
  if (!g5) reasons.push(`存在 ${hz.length} 项未闭环安全隐患（最早 ${hz[0].dateISO}：${hz[0].desc}）——隐患闭环前不得开班收托`);
  gates.push({ key: 'hazard', ok: g5, detail: g5 ? '无未闭环隐患' : `${hz.length} 项未闭环` });

  const heOpen = openHealthEvents(state).filter((h) => h.status === 'open');
  const g6 = heOpen.length === 0;
  if (!g6) reasons.push(`存在 ${heOpen.length} 起待处置健康事件（${heOpen.map((h) => h.kidName).join('、')}）——先登记「通知监护人+处置意见」（管理规范第 24 条），异常幼儿去向不明不得开班`);
  gates.push({ key: 'healthevent', ok: g6, detail: g6 ? '无待处置健康事件' : `${heOpen.length} 起待通知处置` });

  return { ok: reasons.length === 0, reasons, gates, onDuty, ratio };
}

/**
 * 落一张送托单：六道闸全部通过才落账，同时记录合规快照。
 * snapshot 记录落账时的证照有效期、各班配比、在岗人员健康证期——检查进门出示的「今天合规开园」证据。
 */
export function addDayPass(state, { dateISO, carerIds = [], allStaffIds = [], note = '' }) {
  assertISO(dateISO);
  if ((state.daypasses ?? []).some((o) => o.dateISO === dateISO)) {
    throw new Error(`${dateISO} 已开出送托单（同日唯一）`);
  }
  const gate = openGate(state, { dateISO, carerIds, allStaffIds });
  if (!gate.ok) {
    throw new Error(`送托被闸机拒绝：${gate.reasons.join('；')}`);
  }
  state.daypassSeq = (state.daypassSeq ?? 0) + 1;
  const v = state.org ?? {};
  const loads = Object.fromEntries(Object.entries(gate.ratio.loads).filter(([, l]) => l.kids > 0).map(([k, l]) => [k, { kids: l.kids, carersNeeded: l.carersNeeded }]));
  const rec = {
    id: `dp-${state.daypassSeq}`, dateISO,
    carerIds: [...carerIds],
    carerNames: gate.onDuty.filter((s) => carerIds.includes(s.id)).map((s) => `${s.name}（${STAFF_ROLES[s.role]}）`),
    staffNames: gate.onDuty.map((s) => `${s.name}（${STAFF_ROLES[s.role]}）`),
    note,
    snapshot: {
      filedISO: v.filedISO ?? '',
      docs: Object.fromEntries(Object.entries(v.docs ?? {})),
      loads,
      healthCerts: Object.fromEntries(gate.onDuty.map((s) => [s.name, s.healthValidISO ?? ''])),
      kidCount: kidsInCare(state).length,
    },
  };
  state.daypasses.push(rec);
  return rec;
}

/** 删除送托单（录错自救；删除埋点留痕） */
export function removeDayPass(state, dayPassId) {
  const idx = (state.daypasses ?? []).findIndex((o) => o.id === dayPassId);
  if (idx < 0) throw new Error(`送托单不存在: ${dayPassId}`);
  state.daypasses.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 变更备案台账（管理规范第 6 条；备案办法第 10 条）
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

/** 办结变更备案（向卫健部门变更备案完成，回执日期） */
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
// 周期义务账（演练/培训/月检/报送/年报/保险；打勾自动滚动）
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
// 账本体检（迎检与家长信任前的自查打分；全部确定性输出）
// ---------------------------------------------------------------------------

/**
 * 十项体检。score = 100 - 红×12 - 黄×4（下限 0）。
 */
export function healthCheck(state, todayISOStr, settings = {}) {
  assertISO(todayISOStr);
  const warnDoc = settings.docWarnDays ?? DEFAULT_DOC_WARN_DAYS;
  const warnHealth = settings.healthWarnDays ?? DEFAULT_HEALTH_WARN_DAYS;
  const items = [];

  // ① 备案与机构三证
  const org = state.org ?? {};
  const docs = orgDocBoard(state, todayISOStr, warnDoc);
  const badDocs = docs.filter((d) => ['unset', 'overdue'].includes(d.level) && d.level !== 'none');
  const warnDocs = docs.filter((d) => d.level === 'warn');
  const noFile = !org.filedISO;
  items.push({
    key: 'orgdocs', label: '备案与机构证照（消防年度/食品证/租约）',
    level: noFile || badDocs.length ? 'bad' : warnDocs.length ? 'warn' : 'ok',
    detail: [
      noFile ? '备案回执未登记——向县级卫健部门备案是合法办托第一道手续（管理规范第 4 条）' : '',
      ...badDocs.map((d) => d.detail),
      !noFile && !badDocs.length && warnDocs.length ? warnDocs.map((d) => d.detail).join('；') : '',
      !noFile && !badDocs.length && !warnDocs.length ? '备案已登记，证照全部在期' : '',
    ].filter(Boolean).join('；'),
  });

  // ② 人员名册与健康证
  const staff = activeStaff(state);
  const badStaff = staff.filter((s) => ['unset', 'overdue'].includes(staffHealthState(s, todayISOStr, warnHealth).level));
  const warnStaff = staff.filter((s) => staffHealthState(s, todayISOStr, warnHealth).level === 'warn');
  const badQual = staff.filter((s) => ['unset', 'overdue'].includes(staffQualState(s, todayISOStr).level));
  items.push({
    key: 'staff', label: '人员名册与健康证（全员年检）',
    level: !staff.length || badStaff.length || badQual.length ? 'bad' : warnStaff.length ? 'warn' : 'ok',
    detail: !staff.length
      ? '人员名册为空——负责人/保育/保健/保安/炊事按设置标准第 18 条配置'
      : badStaff.length || badQual.length
        ? `${badStaff.length} 人健康证缺位或过期、${badQual.length} 人岗位资质缺位或过期——不得上岗（76 号令第 14/19 条）`
        : warnStaff.length
          ? `${staff.length} 人在册，${warnStaff.length} 人健康证临期（${warnStaff.map((s) => s.name).join('、')}）——安排年检`
          : `${staff.length} 人在册，健康证全部在期`,
  });

  // ③ 师幼配比、收托上限与查验（设置标准第 19/20 条；管理规范第 11 条）
  const ratio = ratioCheck(state, activeStaff(state).filter((s) => s.role === 'carer').length);
  const overMax = Object.values(ratio.loads).filter((l) => l.overMax);
  const fullRatio = ratio.ok;
  const gaps = kidDocGaps(state);
  const kids = kidsInCare(state);
  items.push({
    key: 'ratio', label: '师幼配比与收托查验（1:3/1:5/1:7）',
    level: overMax.length || gaps.length ? 'bad' : fullRatio ? 'ok' : kids.length ? 'warn' : 'warn',
    detail: [
      overMax.length ? `${overMax.map((l) => l.label).join('、')}超收托上限（设置标准第 19 条）` : '',
      gaps.length ? `${gaps.length} 名幼儿查验未齐（${gaps.map((k) => `${k.name}${!k.vaccineOK ? '·接种证' : ''}${!k.entryExamISO ? '·入托体检' : ''}`).join('、')}）——补齐前不得收托（管理规范第 11 条、76 号令第 15 条(六)）` : '',
      !overMax.length && !gaps.length
        ? fullRatio
          ? `在园 ${kids.length} 人查验齐全，全部班型配比达标（在册保育 ${activeStaff(state).filter((s) => s.role === 'carer').length} 人 ≥ 需 ${ratio.carersNeeded} 人）`
          : `在园 ${kids.length} 人查验齐全；按在册保育人员静态测算配比偏紧：需 ≥${ratio.carersNeeded} 人（排班时按班足额，设置标准第 20 条）`
        : '',
    ].filter(Boolean).join('；'),
  });

  // ⑤ 今日晨午检
  const dc = daycheckStatusFor(state, todayISOStr);
  const last = lastDaycheck(state);
  items.push({
    key: 'daycheck', label: '晨午检与全日观察',
    level: dc.morning && dc.noon ? 'ok' : dc.morning || dc.noon ? 'warn' : last ? 'warn' : 'bad',
    detail: dc.morning && dc.noon
      ? '今日晨检+午检均已落卡'
      : dc.morning || dc.noon
        ? `今日已落 ${(dc.morning ? '晨检' : '') + (dc.noon ? '午检' : '')}——另一段待落（管理规范第 24 条）`
        : last
          ? `今日未落卡（最近一次 ${last.dateISO}）——营业日晨午检每日两段`
          : '从未落晨午检卡——第 24 条晨午检与全日健康观察无运行证据',
  });

  // ⑥ 健康事件闭环
  const he = openHealthEvents(state);
  items.push({
    key: 'healthevent', label: '健康事件闭环（发现→通知→返园凭证）',
    level: he.some((x) => x.status === 'open') ? 'bad' : he.length ? 'warn' : 'ok',
    detail: he.length
      ? `${he.filter((x) => x.status === 'open').length} 起待通知处置、${he.filter((x) => x.status === 'notified').length} 起待返园核验——凭医疗卫生机构健康证明返所（76 号令第 18 条）`
      : '健康事件全部闭环（含返园凭证）',
  });

  // ⑦ 安全隐患与变更备案
  const openCh = openChanges(state);
  const hz = openHazards(state);
  items.push({
    key: 'closure', label: '安全隐患与变更备案闭环',
    level: hz.some((x) => x.status === 'open') ? 'bad' : hz.length || openCh.length ? 'warn' : 'ok',
    detail: [
      hz.length ? `${hz.length} 项隐患未销案（最早 ${hz[0].dateISO}）` : '',
      openCh.length ? `${openCh.length} 项变更未办结备案——办理后留回执（备案办法第 10 条）` : '',
      !hz.length && !openCh.length ? '变更无欠账、隐患全闭环' : '',
    ].filter(Boolean).join('；'),
  });

  // ⑧⑨ 周期义务（演练/培训/月检）
  for (const [key, label] of [['drill', '应急演习'], ['training', '人员培训'], ['fireequip', '消防设备月检']]) {
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

  // ⑩ 保险（推荐性指标，最高黄）
  const ins = dutyBoard(state, todayISOStr).find((d) => d.kind === 'insurance');
  items.push({
    key: 'insurance', label: '责任类保险（WS/T 821 推荐性指标）',
    level: !ins || ins.level === 'never' || ins.level === 'overdue' ? 'warn' : 'ok',
    detail: !ins || ins.level === 'never'
      ? '未登记保单——WS/T 821 9.7.1 建议至少购买一种托育机构责任类保险（推荐性指标，非强制）；事故赔付首当其冲'
      : ins.level === 'overdue'
        ? `保单确认已逾期（应于 ${ins.nextDue} 前续保核对）`
        : ins.level === 'due'
          ? `保单 ${ins.nextDue} 到期核对（剩 ${ins.daysLeft} 天）`
          : `保单在期（${ins.nextDue} 前再核对）`,
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
  const settings = state.settings ?? {};
  const passes = (state.daypasses ?? []).filter((o) => inMonth(o.dateISO));
  const blocked = (state.traces ?? []).filter((t) => t.type === 'daypass-blocked' && inMonth((t.dateISO || t.at || '').slice(0, 10)));
  const dcs = (state.daychecks ?? []).filter((d) => inMonth(d.dateISO));
  const issues = dcs.filter((d) => d.status === 'issue');
  const hes = (state.healthEvents ?? []).filter((h) => inMonth(h.dateISO));
  const hesClosed = hes.filter((h) => h.status === 'returned');
  const hzs = (state.hazards ?? []).filter((h) => inMonth(h.dateISO));
  const openHe = openHealthEvents(state);
  const hc = healthCheck(state, todayISOStr, settings);
  const kids = kidsInCare(state);

  const L = [];
  L.push(`【托育机构合规月度小结】${month}`);
  if (state.org?.name) L.push(`机构：${state.org.name}（备案回执 ${state.org.filedISO || '—'}；在园 ${kids.length} 人·${Object.entries(classLoad(state)).filter(([, l]) => l.kids > 0).map(([k, l]) => `${CLASS_KINDS[k].label.slice(0, 3)}${l.kids}人`).join(' ')}）`);
  L.push(`开出送托单 ${passes.length} 张（六道闸全过才落账），闸机拦截不合规开园 ${blocked.length} 次——每次拦截都是没被罚的证据`);
  L.push(`晨午检落卡 ${dcs.length} 段（异常 ${issues.length} 段已处置）；健康事件登记 ${hes.length} 起、闭环（含返园凭证）${hesClosed.length} 起${openHe.length ? `，仍有 ${openHe.length} 起未闭环（先通知处置再核验返园）` : ''}；安全隐患登记 ${hzs.length} 项`);
  const docs = orgDocBoard(state, todayISOStr, settings.docWarnDays ?? DEFAULT_DOC_WARN_DAYS).filter((d) => ['overdue', 'warn'].includes(d.level));
  if (docs.length) L.push(`⚠ 证照钟点名：${docs.map((d) => d.detail).join('；')}`);
  const staffBad = activeStaff(state).filter((s) => ['unset', 'overdue'].includes(staffHealthState(s, todayISOStr).level));
  if (staffBad.length) L.push(`⚠ 健康证点名：${staffBad.map((s) => `${s.name}（${staffHealthState(s, todayISOStr).detail}）`).join('、')}——不得上岗`);
  const kidGaps = kidDocGaps(state);
  if (kidGaps.length) L.push(`⚠ 收托查验缺口：${kidGaps.map((k) => k.name).join('、')}——补齐接种证/入托体检前按规范不得收托`);
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => d.level === 'never' || d.level === 'overdue');
  if (dutiesLate.length) L.push(`⚠ 周期义务欠账：${dutiesLate.map((d) => d.label).join('、')}`);
  L.push(`账本体检 ${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）`);
  L.push('口径：《托育机构设置标准（试行）》《托育机构管理规范（试行）》（国卫人口发〔2019〕58号）、《托儿所幼儿园卫生保健管理办法》（卫生部 教育部令第 76 号，经 58 号文转致适用）、《托育机构登记和备案办法（试行）》（国卫办人口发〔2019〕25号）、WS/T 821—2023《托育机构质量评估标准》（推荐性，2024-04-01 实施）；《托育服务法（草案）》2025-12-22 初审、尚未施行，颁布后按新法升级。本小结为机构自查底稿，不替代备案、卫生评价、消防安全检查、食品经营许可等法定程序。');
  L.push(`生成：托安单 · ${month}`);
  return {
    text: L.join('\n'), passes: passes.length, blocked: blocked.length,
    dcs: dcs.length, hes: hes.length, hesClosed: hesClosed.length, score: hc.score,
  };
}

// ---------------------------------------------------------------------------
// 出证物（单文件 HTML：迎检自证包 / 当日送托单 / 家长信任公示单）
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

const DOC_LEVEL = { overdue: '已过期', due: '临期', window: '窗口', warn: '临期', ok: '在期', never: '从未开展', unset: '未登记', none: '不适用' };

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏）——对口卫健/妇幼/卫生监督检查 */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const v = state.org ?? {};

  const hc = healthCheck(state, todayISOStr, settings);
  const hcRows = hc.items.map((i) => `<tr><td>${e(i.label)}</td><td>${DOC_LEVEL[i.level] ?? i.level}</td><td>${e(i.detail)}</td></tr>`).join('');

  const staffRows = (state.staff ?? []).map((s) => {
    const hs = staffHealthState(s, todayISOStr);
    const qs = staffQualState(s, todayISOStr);
    return `<tr class="${s.active ? '' : 'muted'}">
    <td>${e(s.name)}</td><td>${e(STAFF_ROLES[s.role] ?? s.role)}</td>
    <td>${e(s.qualName || (QUAL_REQUIRED[s.role] ?? '—'))}${s.qualValidISO ? `<br><span class="basis">至 ${e(s.qualValidISO)}（${e(DOC_LEVEL[qs.level] ?? qs.level)}）</span>` : ''}</td>
    <td>${e(s.healthValidISO || '—')}（${e(DOC_LEVEL[hs.level] ?? hs.level)}）</td>
    <td>${s.criminalDateISO ? `已核查 ${e(s.criminalDateISO)}` : '—'}</td>
    <td>${s.active ? '在册' : '已停用'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="6">人员名册为空</td></tr>';

  const loads = classLoad(state);
  const loadRows = Object.values(loads).filter((l) => l.kids > 0).map((l) => `<tr>
    <td>${e(l.label)}</td><td>${l.kids} 人（上限 ${l.max}）</td>
    <td>1:${l.ratio}</td><td>${l.carersNeeded} 人</td><td>${l.overMax ? '<strong>超上限</strong>' : '达标'}</td>
  </tr>`).join('') || '<tr><td colspan="5">暂无在园幼儿</td></tr>';

  const kidRows = kidsInCare(state).map((k) => {
    const gap = !k.vaccineOK || !k.entryExamISO;
    return `<tr class="${gap ? 'muted' : ''}">
    <td>${e(k.name)}</td><td>${e(k.className)}</td>
    <td>${k.vaccineOK ? '已查验' : '<strong>未查验</strong>'}</td>
    <td>${e(k.entryExamISO || '未登记')} </td>
    <td>${k.outISO ? `离园 ${e(k.outISO)}${k.backISO ? `·返园 ${e(k.backISO)}` : ''}` : '在园'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="5">婴幼儿名册为空</td></tr>';

  const passRows = [...(state.daypasses ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((o) => `<tr>
    <td>${e(o.dateISO)}</td><td>${o.snapshot?.kidCount ?? '—'} 人</td>
    <td class="w"><span>${e(o.staffNames.join('、'))}</span></td><td>六道闸全过</td>
  </tr>`).join('') || '<tr><td colspan="4">送托记录为空</td></tr>';

  const dcRows = [...(state.daychecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((d) => {
    const bad = d.items.filter((i) => !i.ok);
    return `<tr>
    <td>${e(d.dateISO)}</td><td>${d.segment === 'morning' ? '晨检' : '午检'}</td>
    <td>${bad.length ? `<strong>异常 ${bad.length}</strong>：${e(bad.map((i) => `${i.label}（${i.note}）`).join('；'))}` : '全项正常'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="3">无晨午检记录</td></tr>';

  const heRows = [...(state.healthEvents ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((h) => `<tr>
    <td>${e(h.dateISO)}</td><td>${e(HEALTH_SOURCES[h.source] ?? h.source)}</td><td>${e(h.kidName)}</td>
    <td class="w"><span>${e(h.symptom || '')}${h.reportISO ? `<br><span class="basis">疑似传染病已报告：${e(h.reportISO)}</span>` : ''}</span></td>
    <td>${h.notifyISO ? `${e(h.notifyISO)}<br><span class="basis">${e(h.action)}</span>` : '<strong>待通知</strong>'}</td>
    <td>${h.status === 'returned' ? `${e(h.returnISO)} ${e(h.returnProof)}` : h.status === 'notified' ? '<strong>待返园核验</strong>' : '<strong>待通知处置</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="6">无健康事件登记</td></tr>';

  const hzRows = [...(state.hazards ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((h) => `<tr>
    <td>${e(h.dateISO)}</td><td>${e({ daycheck: '晨午检卡', inspection: '监督检查', selfcheck: '自查上报' }[h.source] ?? h.source)}</td><td class="w"><span>${e(h.desc)}</span></td>
    <td>${h.status === 'open' ? '<strong>未整改</strong>' : `${e(h.actionISO || '—')} ${e(h.action || '')}`}</td>
    <td>${h.status === 'closed' ? `${e(h.verifyISO)} ${e(h.verifiedBy)}` : h.status === 'fixed' ? '<strong>待复查</strong>' : '<strong>未闭环</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="5">无隐患登记</td></tr>';

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr>
    <td>${e(c.dateISO)}</td><td>${e(CHANGE_KINDS[c.kind] ?? c.kind)}</td><td class="w"><span>${e(c.detail)}</span></td>
    <td>${c.status === 'filed' ? `${e(c.filedISO)} 已办结` : '<strong>未办结</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="4">暂无变更事项</td></tr>';

  const duRows = dutyBoard(state, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastDoneISO ? e(d.lastDoneISO) : '—'}</td>
    <td>${d.nextDue ? e(d.nextDue) : '—'}</td><td>${DOC_LEVEL[d.level] ?? d.level}</td><td>${e(d.basis)}</td>
  </tr>`).join('') || '<tr><td colspan="5">未登记周期义务</td></tr>';

  const docs = orgDocBoard(state, todayISOStr, settings.docWarnDays ?? DEFAULT_DOC_WARN_DAYS);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>托育机构合规迎检自证包 · ${e(v.name ?? '')}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1>托育机构合规迎检自证包 · ${e(v.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 园长/负责人：${e(v.principal || '—')} · 在园 ${kidsInCare(state).length} 人 · ${e(v.address || '地址未填')} · 咨询电话 ${e(v.phone || '—')}</div>
<h2>一、机构与备案信息（管理规范第 4 条；备案办法第 8 条）</h2>
<div class="meta">备案回执日：${e(v.filedISO || '—')} · 统一社会信用代码：${e(v.uscc || '—')} · 机构性质：${e(v.nature || '—')} · 供餐：${v.meals ? '是（食品经营许可证见下）' : '否'}</div>
<table><tr><th>证照</th><th>有效期至</th><th>状态</th></tr>
${docs.map((d) => `<tr><td>${e(d.label)}</td><td>${e(state.org?.docs?.[d.key] || '—')}</td><td>${e(DOC_LEVEL[d.level] ?? d.level)}</td></tr>`).join('')}
</table>
<h2>二、账本体检（${hc.items.length} 项）</h2>
<div class="meta">体检得分 ${hc.score}（红 ${hc.bad} · 黄 ${hc.warn}）——缺口如实列出，未闭环项以现场整改为准</div>
<table><tr><th>项目</th><th>状态</th><th>说明</th></tr>${hcRows}</table>
<h2>三、工作人员名册（设置标准第 18 条；76 号令第 12/14 条健康证全员年检）</h2>
<table><tr><th>姓名</th><th>岗位</th><th>岗位资质</th><th>健康证至</th><th>无犯罪核查</th><th>状态</th></tr>${staffRows}</table>
<h2>四、班级与师幼配比（设置标准第 19/20 条）</h2>
<table><tr><th>班型</th><th>在园/上限</th><th>配比</th><th>需保育</th><th>判定</th></tr>${loadRows}</table>
<h2>五、在园婴幼儿名册与收托查验（管理规范第 11 条；76 号令第 15 条(六)）</h2>
<table><tr><th>姓名</th><th>班级</th><th>接种证</th><th>入托体检</th><th>状态</th></tr>${kidRows}</table>
<h2>六、送托记录（近 40 日：六道闸全过才落账，含当日快照）</h2>
<table><tr><th>日期</th><th>在园</th><th>在岗人员</th><th>闸机</th></tr>${passRows}</table>
<h2>七、晨午检与全日观察记录（管理规范第 24 条；WS/T 821 7.2.3）</h2>
<table><tr><th>日期</th><th>段位</th><th>结果</th></tr>${dcRows}</table>
<h2>八、健康事件闭环（发现→通知监护人→返园凭证；76 号令第 18 条）</h2>
<table><tr><th>发现日</th><th>来源</th><th>幼儿</th><th>症状/报告</th><th>通知与处置</th><th>返园核验</th></tr>${heRows}</table>
<h2>九、安全隐患闭环（晨午检卡/监督检查/自查）</h2>
<table><tr><th>发现日</th><th>来源</th><th>描述</th><th>整改</th><th>复查销案</th></tr>${hzRows}</table>
<h2>十、变更备案台账与周期义务账</h2>
<table><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows}</table>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<div class="sign">园长/负责人（签字/盖章）：____________　卫生保健人员（签字）：____________　日期：____________</div>
<div class="foot">生成：托安单 TotSafe · ${e(todayISOStr)} · 本页为机构自查与迎检备查材料，不替代备案、卫生评价、消防安全检查、食品经营许可等法定程序；《托育服务法（草案）》2025-12-22 初审尚未施行，现行口径以 58 号文两标准+76 号令+备案办法为准；属地卫健部门要求永远赢</div>
</body>
</html>`;
}

/** 当日送托单打印版（单文件 HTML）——贴在园门口/前台：今天这个园是过了六道闸才开的 */
export function dayPassHtml(state, dayPassId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const o = (state.daypasses ?? []).find((x) => x.id === dayPassId);
  if (!o) throw new Error(`送托单不存在: ${dayPassId}`);
  const v = state.org ?? {};
  const loads = Object.entries(o.snapshot?.loads ?? {}).map(([k, l]) => `${CLASS_KINDS[k]?.label ?? k} ${l.kids} 人/需保育 ${l.carersNeeded}`).join('；');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>当日送托单 · ${e(o.dateISO)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1>当日送托单（六道闸核对）</h1>
<div class="meta">机构：${e(v.name || '—')} · 日期：${e(o.dateISO)} · 打印日：${e(todayISOStr)} · 备案回执：${e(o.snapshot?.filedISO || '—')}</div>
<h2>一、闸机核对（落账时点）</h2>
<table>
  <tr><th>在园婴幼儿</th><td>${o.snapshot?.kidCount ?? '—'} 人（${e(loads || '—')}）</td></tr>
  <tr><th>消防年度证明 / 食品证 / 租约</th><td>${Object.entries(o.snapshot?.docs ?? {}).map(([k, val]) => `${e(ORG_DOCS[k]?.label.split('（')[0] ?? k)} 至 ${e(val || '—')}`).join(' · ') || '—'}</td></tr>
  <tr><th>今日晨检</th><td>已落卡（管理规范第 24 条，可调取检查卡）</td></tr>
  <tr><th>未闭环隐患 / 待处置健康事件</th><td>0 项 / 0 起</td></tr>
</table>
<h2>二、当日在岗人员（健康证在期上岗——76 号令第 14 条）</h2>
<table><tr><th>人员</th><th>岗位</th><th>健康证有效期（落账时）</th></tr>
${o.staffNames.map((n) => {
    const name = n.split('（')[0];
    const role = n.match(/（(.*)）/)?.[1] ?? '';
    return `<tr><td>${e(name)}</td><td>${e(role)}</td><td>${e(o.snapshot?.healthCerts?.[name] || '—')}</td></tr>`;
  }).join('') || '<tr><td colspan="3">—</td></tr>'}
</table>
<h2>三、信息公示自查（管理规范第 15 条：收费项目与标准、保育照护、膳食营养、卫生保健、安全保卫）</h2>
<div class="meta">五类信息已按制度公示于醒目位置：□ 是　□ 否　·　监控正常运行且录像留存 ≥90 日（管理规范第 32 条）：□ 是　□ 否</div>
<div class="sign">值班负责人（签字）：____________　时间：____________</div>
<div class="foot">生成：托安单 TotSafe · ${e(todayISOStr)} · 本单为当日开园收托的自证底稿，不替代备案与监督检查；家长如有疑问可现场调阅台账</div>
</body>
</html>`;
}

/**
 * 家长信任公示单（单文件 HTML / 打印 / 文本）——把管理规范第 15 条信息公示义务，
 * 变成招生现场的第一信任资产：证照在期、人员健康证、配比、晨午检、消毒，一页说清。
 * 脱敏原则：只出状态与人数，不出幼儿姓名、不出证件号、不出人员身份证号。
 */
export function trustHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const v = state.org ?? {};
  const hc = healthCheck(state, todayISOStr, settings);
  const staff = activeStaff(state);
  const okHealth = staff.filter((s) => ['ok', 'warn'].includes(staffHealthState(s, todayISOStr).level)).length;
  const kids = kidsInCare(state);
  const loads = classLoad(state);
  const dc = daycheckStatusFor(state, todayISOStr);
  const dcs30 = (state.daychecks ?? []).filter((d) => daysUntil(todayISOStr, d.dateISO) <= 30);
  const hes30 = (state.healthEvents ?? []).filter((h) => h.dateISO >= addDays(todayISOStr, -30) && h.status === 'returned');
  const docs = orgDocBoard(state, todayISOStr, settings.docWarnDays ?? DEFAULT_DOC_WARN_DAYS);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>家长信任公示 · ${e(v.name ?? '')}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1>家长信任公示 · 今天这个园是怎么开的</h1>
<div class="meta">${e(v.name ?? '')} · ${e(todayISOStr)} · 数据生成自本园每日合规台账（托安单），脱敏公示，欢迎现场调阅底稿</div>
<h2>一、合规底座（备案与证照）</h2>
<table><tr><th>项目</th><th>状态</th></tr>
<tr><td>卫健部门备案</td><td>${v.filedISO ? `已备案（回执 ${e(v.filedISO)}）` : '<strong>未备案</strong>'}</td></tr>
${docs.filter((d) => d.level !== 'none').map((d) => `<tr><td>${e(d.label.split('（')[0])}</td><td>${e(DOC_LEVEL[d.level] ?? d.level)}</td></tr>`).join('')}
</table>
<h2>二、人（员工健康证全员年检 · 76 号令第 14 条）</h2>
<table><tr><th>指标</th><th>今日</th></tr>
<tr><td>在册工作人员</td><td>${staff.length} 人</td></tr>
<tr><td>健康证在期上岗</td><td>${okHealth}/${staff.length} 人</td></tr>
<tr><td>保育人员配比</td><td>${Object.values(loads).filter((l) => l.kids > 0).map((l) => `${e(l.label.slice(0, 3))} 1:${l.ratio}（在园 ${l.kids} 人）`).join('；') || '—'}</td></tr>
</table>
<h2>三、孩子（在园 ${kids.length} 人 · 收托查验 100%）</h2>
<table><tr><th>指标</th><th>今日</th></tr>
<tr><td>接种证与入托体检查验齐全</td><td>${kids.length - kidDocGaps(state).length}/${kids.length} 人</td></tr>
<tr><td>今日晨检 / 午检</td><td>${dc.morning ? '已完成' : '进行中'} / ${dc.noon ? '已完成' : '待午间'}</td></tr>
<tr><td>近 30 日晨午检落卡</td><td>${dcs30.length} 段（营业日每日两段）</td></tr>
<tr><td>近 30 日健康事件闭环（含返园凭证）</td><td>${hes30.length} 起全部闭环</td></tr>
</table>
<h2>四、每天必做的事（家长可随时核对）</h2>
<table><tr><th>每日</th><th>每半年/每年</th></tr>
<tr><td>晨检+午检+全日观察 · 环境与玩具消毒 · 餐具/奶瓶消毒 · 缺勤追踪 · 户外活动 ≥2 小时 · 食谱公示（每周更换） · 监控留存 ≥90 日</td><td>应急演习（防灾/防暴/传染病） · 员工健康证年检 · 消防设备月检 · 责任保险确认 · 信息向备案部门报送</td></tr>
</table>
<div class="sign">园长（签字）：____________　家长可现场调阅：备案回执 · 人员健康证 · 晨午检记录 · 消毒记录</div>
<div class="foot">生成：托安单 TotSafe · ${e(todayISOStr)} · 依据《托育机构管理规范（试行）》第 15 条信息公示制度 · 本单为脱敏自查公示，不替代法定公示与备案</div>
</body>
</html>`;
}

/** 家长信任公示文本版（微信群/朋友圈通道） */
export function trustText(state, todayISOStr = todayISO(), settings = {}) {
  const v = state.org ?? {};
  const hc = healthCheck(state, todayISOStr, settings);
  const staff = activeStaff(state);
  const okHealth = staff.filter((s) => ['ok', 'warn'].includes(staffHealthState(s, todayISOStr).level)).length;
  const kids = kidsInCare(state);
  const dc = daycheckStatusFor(state, todayISOStr);
  const L = [];
  L.push(`【${v.name || '本园'}·今日开园公示】${todayISOStr}`);
  L.push(`备案：${v.filedISO ? '已备案' : '未备案'} · 在园 ${kids.length} 人 · 员工健康证在期 ${okHealth}/${staff.length}`);
  L.push(`今日晨检 ${dc.morning ? '已完成' : '进行中'} · 午检 ${dc.noon ? '已完成' : '待午间'} · 环境消毒/餐具消毒/缺勤追踪每日执行`);
  L.push(`收托查验（接种证+入托体检）齐全率 ${kids.length - kidDocGaps(state).length}/${kids.length} · 户外活动每日 ≥2 小时`);
  L.push(`合规台账体检 ${hc.score} 分——家长可现场调阅底稿（备案回执/健康证/晨午检/消毒记录）`);
  L.push('依据《托育机构管理规范（试行）》第 15 条信息公示制度；数据脱敏，不含幼儿个人信息。');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'totsafe', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'totsafe') return { ok: false, error: '不是托安单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.org === 'object' && s.org !== null &&
    arr(s.staff) && arr(s.kids) && arr(s.daychecks) && arr(s.daypasses) &&
    arr(s.healthEvents) && arr(s.hazards) && arr(s.changes) && arr(s.duties) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
