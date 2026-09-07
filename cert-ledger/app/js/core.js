/**
 * core.js — 检证账 CertLedger 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；周期/时限/提醒窗口等口径
 * 全部参数化，可在设置中被机构覆盖（属地资质认定部门与监管部门要求永远赢）。
 *
 * 合规口径（原文链接与核验方式见 docs/14-调研来源.md，全部 2026-09-08 一手核验）：
 * - 《检验检测机构资质认定管理办法》（质检总局令第 163 号，2015-08-01 施行；经 2021-04-02
 *   《国家市场监督管理总局关于废止和修改部分规章的决定》（总局令第 38 号，2021-06-01 施行）
 *   修改后重新公布——条号全部位移，引 2015 原版条号即错。现行版条号以重新公布文本为准：
 *   第 13 条（资质认定证书有效期为 6 年；需要延续的应当在有效期届满 3 个月前提出申请；
 *   上一许可周期无违规的可书面审查延续）、
 *   第 14 条（变更手续五情形：机构名称/地址/法人性质；法定代表人、最高管理者、技术负责人、
 *   授权签字人变更；检验检测项目取消；标准或方法变更；其他——应向资质认定部门申请办理变更），
 *   第 18 条（定期审查和完善管理体系，保证基本条件和技术能力持续符合；不再符合的不得向社会
 *   出具证明作用的数据结果）、
 *   第 19 条（应在证书规定的检验检测能力范围内出具数据、结果）、
 *   第 20 条（不得转让/出租/出借证书标志，不得伪造变造冒用，不得使用已过期或被撤销、注销的
 *   证书标志）、
 *   第 21 条（向社会出具证明作用数据结果应在报告上标注资质认定标志 CMA）、
 *   第 31 条（证书有效期届满未申请延续或不予延续的，依法办理注销）、
 *   第 35 条（未按第 14 条办理变更手续、未按第 21 条标注标志：责令限期改正，逾期未改正处
 *   1 万元以下罚款）、
 *   第 36 条（基本条件和技术能力不能持续符合仍出报告、超出证书规定能力范围出报告：法规有
 *   撤销吊销规定的从其规定；未规定的责令改正处 3 万元罚款）、
 *   第 37 条（转让/出租/出借/伪造/变造/冒用/使用过期或被撤销注销证书标志：责令改正处 3 万元
 *   以下罚款）。
 *   注意：2015 原版第 37 条（年度报告+自我声明）已被 38 号令删去，现行年度报告义务载体为
 *   39 号令第 16 条——引「163 号令第 37 条年度报告」即错。
 * - 《检验检测机构监督管理办法》（国家市场监督管理总局令第 39 号，2021-04-08 公布，
 *   2021-06-01 施行）：
 *   第 7 条（人员不得同时在两个以上检验检测机构从业；授权签字人应符合相关技术能力要求）、
 *   第 10 条（分包给具备条件能力的机构并事先取得委托人同意；报告注明分包项目与承担机构）、
 *   第 11 条（报告加盖机构公章或检验检测专用章，由授权签字人在其技术能力范围内签发）、
 *   第 12 条（原始记录和报告归档留存，保存期限不少于 6 年）、
 *   第 13 条（不得出具不实检验检测报告——样品不符合规定/使用未经检定或者校准的仪器设备设施/
 *           违反强制性规程方法/未按规传输保存原始数据，且数据错误或无法复核的即不实报告）、
 *   第 14 条（不得出具虚假检验检测报告——未经检验检测/伪造变造原始数据/减少遗漏变更项目/
 *           调换样品/伪造签章签名签时间的五种情形）、
 *   第 16 条（在其官方网站或以其他公开方式自我声明；向所在地省级市场监管部门报告持续符合
 *           条件要求、遵守从业规范、开展检验检测活动以及统计数据等信息）、
 *   第 18 条（按要求参加省级以上市场监管部门组织的能力验证）、
 *   第 20 条（采取自查自改措施、配合监督检查）、
 *   第 25 条（样品管理/分包/签章签字违规：责令限期改正，逾期未改正处 3 万元以下罚款——
 *           含「未经授权签字人签发或者授权签字人超出其技术能力范围签发」）、
 *   第 26 条（出具不实/虚假报告：法律法规对撤销吊销有规定的从其规定；未规定的责令改正处
 *   3 万元罚款；《检验检测机构资质认定管理办法》第 32 条：以欺骗贿赂等不正当手段取得资质
 *   认定的撤销且三年内不得再次申请）。
 * - 《检验检测机构资质认定评审准则》（市场监管总局 2023 年第 21 号公告，2023-05-30 发布，
 *   2023-12-01 施行，《检验检测机构资质认定评审准则》（国认实〔2016〕33 号）同时废止）：
 *   第 9 条（人员：劳动关系合法；人员教育程度/专业技术背景/工作经历/资质资格/技术能力符合
 *   工作需要；授权签字人应具有中级及以上相关专业技术职称或者同等能力并符合技术能力要求）、
 *   第 10 条（场所环境）、
 *   第 11 条（设备设施：配备独立支配使用权、性能符合要求的设备设施；对数据结果准确性或有效性
 *   有影响的设备（含辅助测量设备）实施检定、校准或核查，保证计量溯源性；标准物质满足计量
 *   溯源性）、
 *   第 12 条（管理体系有效、可控、稳定运行：文件化体系/合同评审/服务供应品采购/方法验证确认/
 *           测量不确定度/报告规范/质量记录技术记录管理——原始记录和报告保存期限不少于 6 年/
 *           信息系统安全/内外部质量控制——内部含人员比对、设备比对、留样再测、盲样考核，
 *           外部含能力验证、实验室间比对）。
 *   注意：内审「每年一次」（RB/T 214—2017 4.5.15）、管理评审「12 个月一次」（4.5.16）是已废止
 *   评审依据（2016 版准则）与推荐性标准 RB/T 214—2017 的惯例口径；2023 版准则正文将其收拢为
 *   第 12 条「管理体系有效、可控、稳定实施」的概括义务——本工具按惯例口径 12 个月参数化并在
 *   界面注明惯例属性，引「2023 版准则第 4.5.15 条」即错。
 * - 《检验检测机构能力验证管理办法》（市场监管总局 2023 年第 13 号公告，2023-03-27 发布施行，
 *   《实验室能力验证实施办法》（认监委 2006 年第 9 号公告）同时废止）：
 *   第 10 条（积极实施人员比对、设备比对、留样再测等内部质量控制措施；按要求参加能力验证；
 *   独立完成、不得私下比对串通）、
 *   第 14 条（对结果有异议可在收到结果之日起 15 个工作日内申诉）、
 *   第 17 条（能力验证原始记录、数据信息和结果报告保存不少于六年）、
 *   第 18 条（无故不参加能力验证：予以纠正、公布机构名单、双随机抽查中加大抽查概率）、
 *   第 20 条（能力验证相关项目结果不合格：应在规定期限内完成整改、提交整改和验证材料并经
 *   市场监管部门确认通过；整改期间或整改后仍不符合仍擅自出报告的，按 163 号令/39 号令处理）。
 * - 年度自查（市场监管总局等八部门《关于组织开展 2026 年度检验检测机构监督抽查工作的通知》，
 *   2026-08 部署，省级局同步转发）：总局制定《2026 年度检验检测机构自查表》，各机构须于
 *   2026-08-31 前完成自查整改、材料留存备查，重点防范出具虚假或不实报告；2026 年度国家监督
 *   抽查计划检查 120 家（总局资质认定 100 家+省级资质认定 20 家）。年度「先自查后抽查」已成
 *   例行机制（2026 年为八部门联合第三年部署），自查截止日按年度参数化。
 * - 监督检查方式（39 号令第 17 条）：依据年度监督检查计划随机抽取检查对象、随机选派执法人员
 *   （双随机、一公开）；检查结果依法公开并纳入国家企业信用信息公示系统（第 22 条）；省级部门
 *   可按风险程度、能力验证及监督检查结果、投诉举报情况实施分类监管（第 19 条）。
 * - 统计口径（国新办 2025-07-17 市场监管总局「检验检测支撑高质量发展」新闻发布会）：截至
 *   2024 年底全国检验检测机构 53,057 家（同比 -1.44%，近年首降、行业出清），2024 年营业收入
 *   4,875.97 亿元（+4.41%），全年出具检验检测报告 5.51 亿份；规模以上机构近 8,000 家。
 *   抽查问题面：山西省 2025 年度检验检测机构「双随机」抽查通报 100 家中 68 家存在一般性质量
 *   管理或技术问题（省级示例口径）。
 *
 * 本工具是检验检测机构侧的自证台账，不构成法律意见，不替代资质认定申请、延续、变更、注销、
 * 能力验证报名与整改报送等法定程序；属地资质认定部门与监管部门要求永远赢。
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
 * 2 月 29 日 + 12 = 2 月 28 日钳制）。证书/检定/内审等周期「精确到月」用。
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

/** 资质认定证书有效期（年）：163 号令现行版第 13 条 */
export const CERT_VALID_YEARS = 6;
/** 延续申请窗口：证书有效期届满 3 个月前提出申请（163 号令现行版第 13 条） */
export const RENEW_ADVANCE_DAYS = 90;
/** 证书临期提醒（天，产品口径，早于法定申请窗口，只提示不判定） */
export const CERT_WARN_DAYS = 180;

/** 常规仪器检定/校准周期（月，参数化默认 12 个月；JJG/JJF 规程与溯源计划永远赢；2023 准则第 11 条） */
export const DEFAULT_CALIB_CYCLE_MONTHS = 12;
/** 设备检定/校准临期提醒（天，产品口径） */
export const CALIB_WARN_DAYS = 45;

/** 原始记录与报告保存期限（年）：39 号令第 12 条、2023 准则第 12 条(七)——不少于 6 年 */
export const RECORD_KEEP_YEARS = 6;

/** 内审/管理评审惯例周期（月，参数化）：RB/T 214—2017 4.5.15/4.5.16 惯例口径；2023 准则第 12 条概括义务 */
export const DEFAULT_AUDIT_CYCLE_MONTHS = 12;

/** 变更手续五情形（163 号令现行版第 14 条） */
export const CHANGE_KINDS = {
  name: '机构名称/地址/法人性质变更',
  keyperson: '法定代表人/最高管理者/技术负责人/授权签字人变更',
  itemcancel: '资质认定检验检测项目取消',
  method: '检验检测标准或方法变更',
  other: '其他依法需要办理变更的事项',
};

/** 人员角色（2023 准则第 9 条；39 号令第 7/11 条） */
export const STAFF_ROLES = {
  signer: '授权签字人（中级及以上职称或同等能力）',
  tester: '检验检测人员',
  supervisor: '监督人员',
};

/** 设备量值溯源方式（2023 准则第 11 条(二)：检定、校准或核查） */
export const CALIB_TYPES = {
  verify: '检定',
  calibrate: '校准',
  check: '核查',
};

/** 质量记录类型（内审/管理评审/能力验证/内部质控；2023 准则第 12 条(九)、能力验证办法第 10 条） */
export const QUALITY_KINDS = {
  internal: '内部审核',
  mreview: '管理评审',
  pt: '能力验证/实验室间比对',
  qc: '内部质控（人员比对/设备比对/留样再测/盲样考核）',
};

/** 能力验证结论（能力验证办法第 11 条：合格/不合格） */
export const PT_RESULTS = { pass: '合格', unsat: '不合格（不满意或有问题）' };

/** 年度义务（周期为参数化默认值，属地要求永远赢；39 号令第 16 条、八部门 2026 年度抽查通知） */
export const DUTY_KINDS = {
  annualreport: { label: '年度报告与统计信息报送（省级市场监管部门）', cycleDays: 365, basis: '39 号令第 16 条' },
  selfdeclare: { label: '自我声明公开与更新（官网或其他公开方式）', cycleDays: 365, basis: '39 号令第 16 条' },
  selfcheck: { label: '年度监督抽查自查表（自查整改、材料留存备查）', cycleDays: 365, basis: '八部门 2026 年度抽查通知（2026-08-31 前）' },
  training: { label: '人员培训与技术能力确认', cycleDays: 365, basis: '2023 准则第 9 条' },
};

/** 默认提醒参数 */
export const DEFAULT_RENEW_WARN_DAYS = 90;
export const DEFAULT_DUTY_WARN_DAYS = 30;

// ---------------------------------------------------------------------------
// 机构建档与资质证书钟（163 号令现行版第 13/31/37 条）
// ---------------------------------------------------------------------------

/**
 * 资质证书钟。levels:
 * overdue  已过期（红：使用过期证书出报告=3 万以下罚款+注销风险，第 37/31 条）；
 * window   延续申请窗口（黄：届满 3 个月前应提出延续申请，第 13 条）；
 * warn     临期提醒（黄，产品口径）；
 * ok       正常；unset 未登记有效期（红）。
 */
export function certState(station, todayISOStr, warnDays = CERT_WARN_DAYS) {
  assertISO(todayISOStr);
  const warn = typeof warnDays === 'number' ? warnDays : CERT_WARN_DAYS;
  const expiry = station?.certExpiryISO;
  if (!expiry) return { level: 'unset', detail: '未登记资质认定证书有效期——证书是出报告的合法性地基（163 号令第 13 条）' };
  const daysLeft = daysUntil(expiry, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `证书已于 ${expiry} 过期——使用过期证书出报告罚 3 万元以下（第 37 条），且面临注销（第 31 条）；立即停报并申请延续` };
  }
  if (daysLeft <= RENEW_ADVANCE_DAYS) {
    return { level: 'window', daysLeft, detail: `证书 ${expiry} 到期（剩 ${daysLeft} 天）——延续申请应在有效期届满 3 个月前提出（第 13 条），今天就办` };
  }
  if (daysLeft <= warn) {
    return { level: 'warn', daysLeft, detail: `证书 ${expiry} 到期（剩 ${daysLeft} 天）——请准备延续申请材料（人员/设备/体系运行记录）` };
  }
  return { level: 'ok', daysLeft, detail: `证书有效期至 ${expiry}（6 年一续，第 13 条）` };
}

/** 延续办结：录入新证书有效期（自动按 +6 年推导校验），滚动证书钟 */
export function renewCert(station, newExpiryISO) {
  assertISO(newExpiryISO);
  if (!station?.certExpiryISO) throw new Error('先在机构建档登记现有证书信息');
  if (newExpiryISO <= station.certExpiryISO) throw new Error('新证书有效期应晚于当前有效期（延续换证）');
  station.certExpiryISO = newExpiryISO;
  station.renewedISO = todayISO();
  return station;
}

// ---------------------------------------------------------------------------
// 能力附表（163 号令现行版第 19 条「证书规定的检验检测能力范围」+ 超范围闸底座）
// ---------------------------------------------------------------------------

/**
 * 录入一个能力附表参数。cap: { name, standard, remark }
 * 闸机：参数名必填；同参数名拒绝。
 */
export function addCapability(state, { name, standard = '', remark = '' }) {
  if (!String(name || '').trim()) throw new Error('参数/项目名称必填——能力附表是超范围闸的底座');
  if ((state.capabilities ?? []).some((c) => c.name === name)) {
    throw new Error(`${name} 已在能力附表中（同名唯一，如需区分请带依据标准）`);
  }
  state.capSeq = (state.capSeq ?? 0) + 1;
  const rec = { id: `cap-${state.capSeq}`, name, standard, status: 'active', suspendedReason: '', remark };
  state.capabilities.push(rec);
  return rec;
}

/** 停用/恢复参数（项目取消、整改挂起用；停用原因必填） */
export function setCapabilityStatus(state, capId, status, reason = '') {
  const cap = (state.capabilities ?? []).find((c) => c.id === capId);
  if (!cap) throw new Error(`参数不存在: ${capId}`);
  if (status === 'suspended' && !String(reason || '').trim()) {
    throw new Error('停用必须写明原因（项目取消/能力验证不合格整改中）——163 号令第 14 条(三)取消项目还应办理变更手续');
  }
  cap.status = status;
  cap.suspendedReason = status === 'suspended' ? reason : '';
  return cap;
}

/** 在用参数（报告闸可用范围） */
export function activeCapabilities(state) {
  return (state.capabilities ?? []).filter((c) => c.status === 'active');
}

// ---------------------------------------------------------------------------
// 设备一机一档（2023 准则第 11 条：检定/校准/核查 + 计量溯源；39 号令第 13 条(二)不实报告闸）
// ---------------------------------------------------------------------------

/**
 * 建档一台设备。equip: { name, code, capIds, calibType, cycleMonths, lastCalibISO, note }
 * 闸机：名称/编号必填、编号唯一；有最近检定/校准日时自动推导下次到期日（+周期月，月末钳制）。
 */
export function addEquipment(state, { name, code, capIds = [], calibType = 'calibrate', cycleMonths = DEFAULT_CALIB_CYCLE_MONTHS, lastCalibISO = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('设备名称必填');
  if (!String(code || '').trim()) throw new Error('设备编号必填——一机一档的档主');
  if ((state.equipments ?? []).some((x) => x.code === code)) {
    throw new Error(`设备编号 ${code} 已建档（同编号唯一）`);
  }
  const cycle = Number.isInteger(cycleMonths) && cycleMonths > 0 ? cycleMonths : DEFAULT_CALIB_CYCLE_MONTHS;
  state.equipSeq = (state.equipSeq ?? 0) + 1;
  const rec = {
    id: `eq-${state.equipSeq}`, name, code,
    capIds: [...capIds], calibType, cycleMonths: cycle,
    lastCalibISO,
    calibDueISO: lastCalibISO ? addMonthsExact(lastCalibISO, cycle) : '',
    outOfServiceISO: '', backISO: '',
    note,
  };
  state.equipments.push(rec);
  return rec;
}

/** 在用设备（未停用） */
export function activeEquipments(state) {
  return (state.equipments ?? []).filter((x) => !x.outOfServiceISO);
}

/**
 * 设备检定/校准钟（2023 准则第 11 条(二)；超期设备继续出报告=不实报告风险，39 号令第 13 条(二)）。
 * levels: overdue 超期（红）/ due 临期（黄）/ unset 未录入（红）/ ok。
 */
export function equipState(equip, todayISOStr, warnDays = CALIB_WARN_DAYS) {
  assertISO(todayISOStr);
  const warn = typeof warnDays === 'number' ? warnDays : CALIB_WARN_DAYS;
  if (equip.outOfServiceISO) return { level: 'none', detail: `已停用（${equip.outOfServiceISO}）` };
  if (!equip.calibDueISO) {
    return { level: 'unset', detail: '未录入最近检定/校准日——无溯源证据的设备出报告属不实报告情形（39 号令第 13 条(二)）' };
  }
  const daysLeft = daysUntil(equip.calibDueISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${CALIB_TYPES[equip.calibType] ?? equip.calibType}已于 ${equip.calibDueISO} 超期——期间出报告有不实报告风险（39 号令第 13 条(二)），先送检/校准` };
  }
  if (daysLeft <= warn) {
    return { level: 'due', daysLeft, detail: `${CALIB_TYPES[equip.calibType] ?? equip.calibType} ${equip.calibDueISO} 到期（剩 ${daysLeft} 天）——安排送检` };
  }
  return { level: 'ok', daysLeft, detail: `${CALIB_TYPES[equip.calibType] ?? equip.calibType}有效期至 ${equip.calibDueISO}` };
}

/** 记录一次检定/校准完成：滚动溯源钟 */
export function recordCalibration(state, equipId, doneISO, note = '') {
  assertISO(doneISO);
  const eq = (state.equipments ?? []).find((x) => x.id === equipId);
  if (!eq) throw new Error(`设备不存在: ${equipId}`);
  if (eq.outOfServiceISO) throw new Error('该设备已停用，恢复在用后再录检定/校准');
  eq.lastCalibISO = doneISO;
  eq.calibDueISO = addMonthsExact(doneISO, eq.cycleMonths);
  if (note) eq.note = note;
  return eq;
}

/** 停用/恢复设备（损坏待修、长期闲置；停用期间其参数出报告闸不放行） */
export function setEquipService(state, equipId, inService, iso) {
  assertISO(iso);
  const eq = (state.equipments ?? []).find((x) => x.id === equipId);
  if (!eq) throw new Error(`设备不存在: ${equipId}`);
  if (inService) {
    if (!eq.outOfServiceISO) throw new Error('该设备本就在用');
    eq.backISO = iso;
    eq.outOfServiceISO = '';
  } else {
    if (eq.outOfServiceISO) throw new Error('该设备已停用');
    eq.outOfServiceISO = iso;
  }
  return eq;
}

/** 某参数当前可用的设备（在用 + 溯源在期 + 关联该参数） */
export function readyEquipmentsOf(state, capId, todayISOStr) {
  assertISO(todayISOStr);
  return activeEquipments(state).filter((eq) => eq.capIds.includes(capId) && ['ok', 'due'].includes(equipState(eq, todayISOStr).level));
}

// ---------------------------------------------------------------------------
// 人员名册（2023 准则第 9 条；39 号令第 7/11 条：授权签字人在其技术能力范围内签发）
// ---------------------------------------------------------------------------

/**
 * 入册一名人员。staff: { name, role, title, idNo, certValidISO, onboardISO, note }
 * 闸机：姓名必填；角色合法；授权签字人职称必填（2023 准则第 9 条(三)：中级及以上相关专业技术
 * 职称或同等能力）；同姓名同角色拒绝。
 */
export function addStaff(state, { name, role, title = '', idNo = '', certValidISO = '', onboardISO = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('姓名必填');
  if (!STAFF_ROLES[role]) throw new Error(`非法角色: ${role}（授权签字人/检验检测人员/监督人员）`);
  if (role === 'signer' && !String(title || '').trim()) {
    throw new Error('授权签字人必须登记职称（2023 准则第 9 条(三)：中级及以上相关专业技术职称或同等能力）');
  }
  if (certValidISO) assertISO(certValidISO);
  if ((state.staff ?? []).some((s) => s.name === name && s.role === role)) {
    throw new Error(`${name}（${STAFF_ROLES[role]}）已在名册中`);
  }
  state.staffSeq = (state.staffSeq ?? 0) + 1;
  const rec = { id: `st-${state.staffSeq}`, name, role, title, idNo, certValidISO, onboardISO, active: true, note };
  state.staff.push(rec);
  return rec;
}

/** 停用/恢复人员（离职停用不删除，历史报告可回溯到签发人；39 号令第 7 条：不得多机构执业） */
export function setStaffActive(state, staffId, active) {
  const rec = (state.staff ?? []).find((s) => s.id === staffId);
  if (!rec) throw new Error(`人员不存在: ${staffId}`);
  rec.active = !!active;
  return rec;
}

/** 在册授权签字人 */
export function activeSigners(state) {
  return (state.staff ?? []).filter((s) => s.active && s.role === 'signer');
}

// ---------------------------------------------------------------------------
// 变更台账（163 号令现行版第 14 条五情形 + 第 35 条(一)：未办变更手续罚 1 万以下）
// ---------------------------------------------------------------------------

/**
 * 登记一项变更事实（发生日 + 情形 + 说明）。授权签字人变更会提示能力附表同步与人员名册核对。
 */
export function addChange(state, { dateISO, kind, detail = '' }) {
  assertISO(dateISO);
  if (!CHANGE_KINDS[kind]) throw new Error(`非法变更情形: ${kind}（163 号令现行版第 14 条五情形）`);
  if (!String(detail || '').trim()) throw new Error('变更说明必填（变更前后内容）');
  state.changeSeq = (state.changeSeq ?? 0) + 1;
  const rec = { id: `cg-${state.changeSeq}`, dateISO, kind, detail, filedISO: '', status: 'open' };
  state.changes.push(rec);
  return rec;
}

/** 办结变更手续（向资质认定部门办理完毕，回执日期） */
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

/** 未办结变更（163 号令第 35 条(一)：未按第 14 条办理变更手续，责令改正，逾期处 1 万以下） */
export function openChanges(state) {
  return (state.changes ?? []).filter((c) => c.status === 'open');
}

// ---------------------------------------------------------------------------
// 不符合项整改（状态机 open → fixed → closed；来源：内审/管理评审/能力验证/检查/自查）
// ---------------------------------------------------------------------------

/** 手工登记不符合项。capabilityId 不为空时同时挂起该参数（能力验证不合格整改期间不得出该参数报告） */
export function addNC(state, { dateISO, source = 'manual', desc, capabilityId = '', suspendCap = false }) {
  assertISO(dateISO);
  const SOURCES = { internal: '内部审核', mreview: '管理评审', pt: '能力验证', inspection: '监督检查', manual: '自查上报' };
  if (!SOURCES[source]) throw new Error(`非法来源: ${source}`);
  if (!String(desc || '').trim()) throw new Error('不符合项描述必填');
  let cap = null;
  if (capabilityId) {
    cap = (state.capabilities ?? []).find((c) => c.id === capabilityId);
    if (!cap) throw new Error(`参数不存在: ${capabilityId}`);
  }
  state.ncSeq = (state.ncSeq ?? 0) + 1;
  const rec = {
    id: `nc-${state.ncSeq}`, dateISO, source, desc,
    capabilityId: cap ? cap.id : '', capName: cap ? cap.name : '',
    action: '', actionISO: '', verifyISO: '', verifiedBy: '', status: 'open',
  };
  state.ncs.push(rec);
  if (cap && suspendCap) {
    cap.status = 'suspended';
    cap.suspendedReason = `能力验证不合格整改中（${rec.id}）——整改完成并经确认通过前不得出该参数报告（能力验证办法第 20 条）`;
  }
  return rec;
}

/** 整改（open → fixed）：措施与完成日必填；完成日不得早于发现日 */
export function fixNC(state, ncId, { actionISO, action }) {
  const nc = (state.ncs ?? []).find((x) => x.id === ncId);
  if (!nc) throw new Error(`不符合项不存在: ${ncId}`);
  if (nc.status !== 'open') throw new Error('只有未整改不符合项可以登记整改（状态机 open → fixed → closed）');
  assertISO(actionISO);
  if (actionISO < nc.dateISO) throw new Error('整改完成日早于发现日');
  if (!String(action || '').trim()) throw new Error('纠正措施必填——只打勾不留痕不算整改');
  nc.action = action;
  nc.actionISO = actionISO;
  nc.status = 'fixed';
  return nc;
}

/**
 * 验证关闭（fixed → closed）：验证人与验证日必填；若该不符合项挂起了参数
 * （能力验证不合格整改），关闭即恢复参数可用（整改闭环=确认通过）。
 */
export function closeNC(state, ncId, { verifyISO, verifiedBy }) {
  const nc = (state.ncs ?? []).find((x) => x.id === ncId);
  if (!nc) throw new Error(`不符合项不存在: ${ncId}`);
  if (nc.status === 'open') throw new Error('先登记纠正措施，再验证关闭（跳级拒绝）');
  if (nc.status === 'closed') throw new Error('该不符合项已闭环');
  assertISO(verifyISO);
  if (verifyISO < nc.actionISO) throw new Error('验证日早于整改完成日');
  if (!String(verifiedBy || '').trim()) throw new Error('验证人必填（建议质量负责人）');
  nc.verifyISO = verifyISO;
  nc.verifiedBy = verifiedBy;
  nc.status = 'closed';
  if (nc.capabilityId) {
    const cap = (state.capabilities ?? []).find((c) => c.id === nc.capabilityId);
    if (cap && cap.status === 'suspended' && (cap.suspendedReason || '').includes(nc.id)) {
      cap.status = 'active';
      cap.suspendedReason = '';
    }
  }
  return nc;
}

/** 未闭环不符合项（早的在前） */
export function openNCs(state) {
  return (state.ncs ?? []).filter((n) => n.status !== 'closed').sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// 质量记录（内审 / 管理评审 / 能力验证 / 内部质控）
// ---------------------------------------------------------------------------

/**
 * 记一笔质量记录。internal/mreview：同一 ISO 年唯一（惯例每年一次，钟按最近一次 +12 个月滚动）；
 * pt：结果合格/不合格，不合格必须写明项目并自动挂起该参数 + 挂不符合项（能力验证办法第 20 条）；
 * qc：任意次（人员比对/设备比对/留样再测/盲样考核，准则第 12 条(九)）。
 */
export function addQuality(state, { kind, dateISO, title, result = 'pass', capabilityId = '', note = '' }) {
  assertISO(dateISO);
  if (!QUALITY_KINDS[kind]) throw new Error(`非法质量记录类型: ${kind}`);
  if (!String(title || '').trim()) throw new Error('内容摘要必填——质量记录是体系有效运行的证据（2023 准则第 12 条）');
  const year = dateISO.slice(0, 4);
  if ((kind === 'internal' || kind === 'mreview') && (state.quality ?? []).some((q) => q.kind === kind && q.dateISO.slice(0, 4) === year)) {
    throw new Error(`${year} 年已有${QUALITY_KINDS[kind]}记录（惯例每年一次，同年度唯一；如需补录请删旧记录）`);
  }
  let cap = null;
  if (kind === 'pt') {
    if (!PT_RESULTS[result]) throw new Error(`非法能力验证结论: ${result}`);
    if (result === 'unsat') {
      if (!capabilityId) throw new Error('不合格结论必须指明相关参数——整改期间该参数不得出报告（能力验证办法第 20 条）');
      cap = (state.capabilities ?? []).find((c) => c.id === capabilityId);
      if (!cap) throw new Error(`参数不存在: ${capabilityId}`);
    }
  }
  state.qualitySeq = (state.qualitySeq ?? 0) + 1;
  const rec = { id: `qt-${state.qualitySeq}`, kind, dateISO, year, title, result, capabilityId: cap ? cap.id : '', note };
  state.quality.push(rec);
  if (cap) {
    addNC(state, {
      dateISO, source: 'pt',
      desc: `能力验证不合格（${title}）：${cap.name}——限期整改并提交材料，确认通过前停报该参数`,
      capabilityId: cap.id, suspendCap: true,
    });
  }
  return rec;
}

/** 删除质量记录（录错自救） */
export function removeQuality(state, qualityId) {
  const idx = (state.quality ?? []).findIndex((q) => q.id === qualityId);
  if (idx < 0) throw new Error(`质量记录不存在: ${qualityId}`);
  state.quality.splice(idx, 1);
}

/** 最近一次内审/管理评审距今天数；从未返回 null */
export function lastQualityDays(state, kind, todayISOStr) {
  assertISO(todayISOStr);
  const dates = (state.quality ?? []).filter((q) => q.kind === kind).map((q) => q.dateISO).sort();
  return dates.length ? 0 - daysUntil(dates[dates.length - 1], todayISOStr) : null;
}

/** 内审/管理评审钟：null=从未开展（红）；超 12 个月=红；临期 60 天=黄 */
export function auditState(state, kind, todayISOStr, cycleMonths = DEFAULT_AUDIT_CYCLE_MONTHS) {
  assertISO(todayISOStr);
  const days = lastQualityDays(state, kind, todayISOStr);
  if (days === null) {
    return { level: 'never', detail: `从未登记${QUALITY_KINDS[kind]}记录——体系运行证据缺失（2023 准则第 12 条；惯例每年一次）` };
  }
  const lastDone = addDays(todayISOStr, -days);
  const due = addMonthsExact(lastDone, cycleMonths);
  const left = daysUntil(due, todayISOStr);
  if (left < 0) {
    return { level: 'overdue', days, due, detail: `上次${QUALITY_KINDS[kind]}在 ${days} 天前（应 ${due} 前开展）——超 12 个月惯例周期，体系运行有效性无法自证` };
  }
  if (left <= 60) {
    return { level: 'due', days, due, detail: `${QUALITY_KINDS[kind]}应于 ${due} 前完成（剩 ${left} 天）——纳入计划` };
  }
  return { level: 'ok', days, due, detail: `上次${QUALITY_KINDS[kind]}：${due} 前（剩 ${left} 天）` };
}

// ---------------------------------------------------------------------------
// 报告台账与出报告三道闸（产品的门禁：不实/虚假报告出不了门）
// ---------------------------------------------------------------------------

/**
 * 出报告前体检。返回 { ok, reasons[] }，每条拒绝理由都带法条口径。
 * 闸（全部通过才放行）：
 * 1. 资质证书在有效期且已登记（163 号令现行版第 13/31/37 条：过期证书出报告=3 万以下+注销风险）；
 * 2. 所报参数全部在能力附表且在用（第 19/36 条(二)：超范围出报告处 3 万；
 *    能力验证不合格整改挂起参数=能力验证办法第 20 条）；
 * 3. 签发人是在册授权签字人（39 号令第 11+25 条(三)：非授权签字人签发或超能力范围签发，
 *    责令改正逾期处 3 万以下）；
 * 4. 每个参数至少一台在用且检定/校准在期的设备
 *    （39 号令第 13 条(二)：使用未经检定或校准的仪器设备出报告=不实报告→第 26 条）。
 */
export function reportGate(state, { dateISO, paramIds = [], signerId = '' }) {
  assertISO(dateISO);
  const reasons = [];
  const cert = certState(state.station ?? {}, dateISO);
  if (cert.level === 'unset') reasons.push(`资质证书未登记有效期——${cert.detail}`);
  else if (cert.level === 'overdue') reasons.push(`资质证书已过期——${cert.detail}`);

  const caps = state.capabilities ?? [];
  const paramList = [...paramIds];
  if (!paramList.length) reasons.push('未选择检验检测参数——报告须落在证书附表能力范围内（163 号令第 19 条）');
  for (const pid of paramList) {
    const cap = caps.find((c) => c.id === pid);
    if (!cap) {
      reasons.push('所选参数不在能力附表——超范围出报告处 3 万元罚款（163 号令第 36 条(二)）');
      continue;
    }
    if (cap.status !== 'active') {
      reasons.push(`${cap.name} 已停用（${cap.suspendedReason || '原因未录'}）——停用期间出报告属超范围/能力不符合情形（163 号令第 18/36 条）`);
      continue;
    }
    const eqs = readyEquipmentsOf(state, cap.id, dateISO);
    if (!eqs.length) {
      const linked = activeEquipments(state).filter((eq) => eq.capIds.includes(cap.id));
      reasons.push(linked.length
        ? `${cap.name} 的设备溯源不在期或已停用（${linked.map((e) => e.code).join('、')}）——使用未经检定/校准设备出报告属不实报告情形（39 号令第 13 条(二)）`
        : `${cap.name} 无关联在用设备——先在设备台账建立「参数-设备」关联（2023 准则第 11 条）`);
    }
  }
  const signer = (state.staff ?? []).find((s) => s.id === signerId);
  if (!signer) {
    reasons.push('未选择签发人——报告应由授权签字人在其技术能力范围内签发（39 号令第 11 条）');
  } else if (!signer.active) {
    reasons.push(`${signer.name} 已停用——离职/停用人员不得签发（39 号令第 11 条）`);
  } else if (signer.role !== 'signer') {
    reasons.push(`${signer.name} 不是授权签字人——非授权签字人签发报告，责令改正逾期处 3 万元以下罚款（39 号令第 25 条(三)）`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * 落一笔报告台账：闸机全部通过才落账，同时记录合规快照。
 * 自检标记（不拦截）：cmaMarked 标注 CMA 标志（163 号令第 21+35 条(二)）、
 * subcontract 分包已注明（39 号令第 10+25 条(二)）。
 * keepUntil = 报告日 + 6 年（39 号令第 12 条保存期限）。
 */
export function addReport(state, { reportNo, dateISO, client = '', paramIds = [], signerId = '', cmaMarked = false, subcontract = '', note = '' }) {
  assertISO(dateISO);
  if (!String(reportNo || '').trim()) throw new Error('报告编号必填——编号规则唯一、可回溯');
  if ((state.reports ?? []).some((r) => r.reportNo === reportNo)) {
    throw new Error(`报告编号 ${reportNo} 已存在（同号唯一）`);
  }
  const gate = reportGate(state, { dateISO, paramIds, signerId });
  if (!gate.ok) {
    throw new Error(`出报告被闸机拒绝：${gate.reasons.join('；')}`);
  }
  const signer = (state.staff ?? []).find((s) => s.id === signerId);
  const caps = (state.capabilities ?? []).filter((c) => paramIds.includes(c.id));
  const eqs = (state.equipments ?? []).filter((e) => e.capIds.some((cid) => paramIds.includes(cid)));
  state.reportSeq = (state.reportSeq ?? 0) + 1;
  const rec = {
    id: `rp-${state.reportSeq}`, reportNo, dateISO, client,
    paramIds: [...paramIds], paramNames: caps.map((c) => c.name),
    signerId, signerName: signer.name, signerTitle: signer.title,
    cmaMarked: !!cmaMarked, subcontract, note,
    keepUntil: addMonthsExact(dateISO, RECORD_KEEP_YEARS * 12),
    snapshot: {
      certExpiryISO: state.station?.certExpiryISO ?? '',
      equipDue: Object.fromEntries(eqs.map((e) => [e.code, e.calibDueISO])),
    },
  };
  state.reports.push(rec);
  return rec;
}

/** 删除报告记录（录错自救；删除埋点留痕） */
export function removeReport(state, reportId) {
  const idx = (state.reports ?? []).findIndex((r) => r.id === reportId);
  if (idx < 0) throw new Error(`报告记录不存在: ${reportId}`);
  state.reports.splice(idx, 1);
}

/** 保存期限届满未处置的报告（39 号令第 12 条：保存不少于 6 年——到期前不得销毁） */
export function expiredKeeps(state, todayISOStr) {
  assertISO(todayISOStr);
  return (state.reports ?? []).filter((r) => r.keepUntil && r.keepUntil < todayISOStr && !r.disposedISO);
}

/** 标记一批到期记录已按程序处置（销毁/移交，留痕） */
export function markDisposed(state, reportId, disposedISO, how = '') {
  assertISO(disposedISO);
  const r = (state.reports ?? []).find((x) => x.id === reportId);
  if (!r) throw new Error(`报告记录不存在: ${reportId}`);
  if (!r.keepUntil || disposedISO <= r.keepUntil) throw new Error('保存期限不少于 6 年（39 号令第 12 条）——到期前不得标记处置');
  r.disposedISO = disposedISO;
  r.disposedHow = how;
  return r;
}

// ---------------------------------------------------------------------------
// 年度义务账（39 号令第 16 条、八部门年度自查、人员培训；打勾自动滚动）
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
  const renewWarn = settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS;
  const calibWarn = settings.calibWarnDays ?? CALIB_WARN_DAYS;
  const dutyWarn = settings.dutyWarnDays ?? DEFAULT_DUTY_WARN_DAYS;
  const items = [];

  // ① 资质证书与延续窗口
  const cert = certState(state.station ?? {}, todayISOStr, renewWarn);
  items.push({
    key: 'cert', label: '资质证书与延续窗口',
    level: ['unset', 'overdue'].includes(cert.level) ? 'bad' : ['window', 'warn'].includes(cert.level) ? 'warn' : 'ok',
    detail: cert.detail,
  });

  // ② 变更手续（第 14 条五情形）
  const openCh = openChanges(state);
  items.push({
    key: 'changes', label: '变更手续（第 14 条五情形）',
    level: openCh.length ? 'warn' : 'ok',
    detail: openCh.length
      ? `${openCh.length} 项变更未办结——未按第 14 条办理变更手续，责令改正逾期处 1 万元以下罚款（第 35 条(一)）`
      : '变更无欠账（或暂无变更事项）',
  });

  // ③ 设备检定/校准钟
  const eqs = activeEquipments(state);
  const overEq = eqs.filter((e) => equipState(e, todayISOStr, calibWarn).level === 'overdue');
  const unsetEq = eqs.filter((e) => equipState(e, todayISOStr, calibWarn).level === 'unset');
  const dueEq = eqs.filter((e) => equipState(e, todayISOStr, calibWarn).level === 'due');
  items.push({
    key: 'equip', label: '设备检定/校准钟',
    level: overEq.length || unsetEq.length ? 'bad' : dueEq.length ? 'warn' : 'ok',
    detail: overEq.length || unsetEq.length
      ? `${overEq.length} 台溯源超期、${unsetEq.length} 台未录入——使用未经检定/校准设备出报告属不实报告情形（39 号令第 13 条(二)）`
      : dueEq.length ? `${dueEq.length} 台临期（最早 ${dueEq[0].calibDueISO}）——安排送检` : `${eqs.length} 台在用设备溯源全部在期`,
  });

  // ④ 授权签字人
  const signers = activeSigners(state);
  const badSigners = signers.filter((s) => !s.title);
  items.push({
    key: 'signer', label: '授权签字人',
    level: !signers.length || badSigners.length ? 'bad' : 'ok',
    detail: !signers.length
      ? '无在册授权签字人——每份报告都须由授权签字人签发（39 号令第 11 条）'
      : badSigners.length
        ? `${badSigners.length} 名授权签字人未登记职称（2023 准则第 9 条(三)：中级及以上或同等能力）`
        : `${signers.length} 名授权签字人在册（${signers.map((s) => s.name).join('、')}）`,
  });

  // ⑤ 内审（惯例 12 个月）
  const ia = auditState(state, 'internal', todayISOStr);
  items.push({
    key: 'internal', label: '内部审核（惯例每年一次）',
    level: ia.level === 'never' || ia.level === 'overdue' ? 'bad' : ia.level === 'due' ? 'warn' : 'ok',
    detail: ia.detail,
  });

  // ⑥ 管理评审（惯例 12 个月）
  const mr = auditState(state, 'mreview', todayISOStr);
  items.push({
    key: 'mreview', label: '管理评审（惯例 12 个月一次）',
    level: mr.level === 'never' || mr.level === 'overdue' ? 'bad' : mr.level === 'due' ? 'warn' : 'ok',
    detail: mr.detail,
  });

  // ⑦ 能力验证（参加 + 不合格闭环）
  const pts = (state.quality ?? []).filter((q) => q.kind === 'pt');
  const unsatOpen = openNCs(state).filter((n) => n.source === 'pt');
  items.push({
    key: 'pt', label: '能力验证与整改闭环',
    level: unsatOpen.length ? 'bad' : pts.length ? 'ok' : 'warn',
    detail: unsatOpen.length
      ? `${unsatOpen.length} 项能力验证不合格未闭环——整改完成并确认通过前，相关参数已停报（能力验证办法第 20 条）`
      : pts.length
        ? `已登记 ${pts.length} 次能力验证/比对（最近 ${pts.map((p) => p.dateISO).sort().pop()}）——按要求参加，无故不参加将公布名单并加大抽查概率（第 18 条）`
        : '从未登记能力验证/实验室间比对——市场监管部门组织的应按要求参加（39 号令第 18 条）',
  });

  // ⑧ 不符合项整改
  const openNc = openNCs(state);
  items.push({
    key: 'nc', label: '不符合项整改闭环',
    level: openNc.filter((n) => n.status === 'open').length ? 'bad' : openNc.length ? 'warn' : 'ok',
    detail: openNc.length
      ? `${openNc.length} 项不符合项未闭环（最早 ${openNc[0].dateISO}，来源：${openNc[0].source === 'internal' ? '内审' : openNc[0].source === 'pt' ? '能力验证' : openNc[0].source === 'mreview' ? '管理评审' : openNc[0].source === 'inspection' ? '监督检查' : '自查'}）`
      : '不符合项全部闭环',
  });

  // ⑨ 报告台账与保存钟
  const reports = state.reports ?? [];
  const unmarked = reports.filter((r) => !r.cmaMarked);
  const expired = expiredKeeps(state, todayISOStr);
  items.push({
    key: 'reports', label: '报告台账与六年保存钟',
    level: !reports.length ? 'warn' : unmarked.length || expired.length ? 'warn' : 'ok',
    detail: !reports.length
      ? '报告台账为空——落账即存合规快照，超范围/无溯源/非授权签发当场拦截'
      : expired.length
        ? `${expired.length} 批报告保存期已满未处置——按程序处置并留痕（39 号令第 12 条：保存不少于 6 年）`
        : unmarked.length
          ? `${unmarked.length} 份报告未勾选「已标注 CMA 标志」——未标注标志责令改正逾期处 1 万元以下（163 号令第 35 条(二)）`
          : `${reports.length} 份报告在账，全部标注 CMA、保存期在管`,
  });

  // ⑩ 年度义务（年报/自我声明/自查表/培训）
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => d.level === 'overdue' || d.level === 'never');
  const noDutyAtAll = !(state.duties ?? []).length;
  items.push({
    key: 'duty', label: '年度义务（年报/声明/自查/培训）',
    level: dutiesLate.length || noDutyAtAll ? 'warn' : 'ok',
    detail: dutiesLate.length
      ? `${dutiesLate.map((d) => d.label).join('、')}逾期/从未执行`
      : noDutyAtAll ? '年度报告、自我声明、自查表、培训均未登记——39 号令第 16 条年度义务在账才可自证' : '年度义务全部在期',
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
  const reports = (state.reports ?? []).filter((r) => inMonth(r.dateISO));
  const blocked = (state.traces ?? []).filter((t) => t.type === 'report-gate-blocked' && inMonth((t.dateISO || t.at || '').slice(0, 10)));
  const quality = (state.quality ?? []).filter((q) => inMonth(q.dateISO));
  const ncs = (state.ncs ?? []).filter((n) => inMonth(n.dateISO));
  const ncsClosed = ncs.filter((n) => n.status === 'closed');
  const openNc = openNCs(state);
  const cert = certState(state.station ?? {}, todayISOStr, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);
  const hc = healthCheck(state, todayISOStr, settings);

  const L = [];
  L.push(`【检验检测机构合规月度小结】${month}`);
  if (state.station?.name) L.push(`机构：${state.station.name}（证书 ${state.station.certNo || '—'}，有效期至 ${state.station.certExpiryISO || '—'}）`);
  L.push(`落账报告 ${reports.length} 份（三道闸全过才落账），闸机拦截不合规出报告 ${blocked.length} 次——每次拦截都是没被罚的证据`);
  L.push(`质量记录：内审/管理评审/能力验证/内部质控共 ${quality.length} 笔；不符合项登记 ${ncs.length} 项、闭环 ${ncsClosed.length} 项${openNc.length ? `，仍有 ${openNc.length} 项未闭环（以闭环记录为准）` : ''}`);
  if (['window', 'warn'].includes(cert.level)) L.push(`⚠ 延续窗口提醒：${cert.detail}`);
  if (cert.level === 'overdue') L.push(`⚠ 证书已过期：${cert.detail}`);
  const overEq = activeEquipments(state).filter((e) => equipState(e, todayISOStr, settings.calibWarnDays ?? CALIB_WARN_DAYS).level === 'overdue');
  if (overEq.length) L.push(`⚠ 设备溯源超期点名：${overEq.map((e) => `${e.name}(${e.code})`).join('、')}——期间该参数已停报`);
  const ia = auditState(state, 'internal', todayISOStr);
  const mr = auditState(state, 'mreview', todayISOStr);
  if (ia.level === 'never' || ia.level === 'overdue') L.push(`⚠ 内审欠账：${ia.detail}`);
  if (mr.level === 'never' || mr.level === 'overdue') L.push(`⚠ 管理评审欠账：${mr.detail}`);
  if (openNc.some((n) => n.source === 'pt')) L.push('⚠ 存在能力验证不合格整改未闭环项，相关参数已停报，确认通过后自动恢复');
  L.push(`账本体检 ${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）`);
  L.push('口径：《检验检测机构资质认定管理办法》（163 号令，2021 修改现行版）第 13/14/18/19/20/21/31/35/36/37 条、《检验检测机构监督管理办法》（39 号令）第 7/10/11/12/13/14/16/18/25/26 条、《检验检测机构资质认定评审准则》（2023 年第 21 号公告）第 9/11/12 条、《检验检测机构能力验证管理办法》（2023 年第 13 号公告）第 10/18/20 条；本小结为机构自查底稿，不替代资质认定申请、延续、变更与能力验证报送等法定程序。');
  L.push(`生成：检证账 · ${month}`);
  return {
    text: L.join('\n'), reports: reports.length, blocked: blocked.length,
    quality: quality.length, ncs: ncs.length, ncsClosed: ncsClosed.length, score: hc.score,
  };
}

// ---------------------------------------------------------------------------
// 迎检自证包（单文件 HTML：十段，含签字栏；同输入同输出）
// ---------------------------------------------------------------------------

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏）——对口 39 号令第 17/20 条监督检查与自查要求 */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const st = state.station ?? {};
  const LEVEL = { overdue: '逾期', due: '临期', window: '延续窗口', warn: '临期', ok: '正常', never: '从未开展', unset: '未登记', none: '不适用' };

  const hc = healthCheck(state, todayISOStr, settings);
  const hcRows = hc.items.map((i) => `<tr><td>${e(i.label)}</td><td>${LEVEL[i.level] ?? i.level}</td><td>${e(i.detail)}</td></tr>`).join('');

  const capRows = (state.capabilities ?? []).map((c) => `<tr>
    <td>${e(c.name)}</td><td>${e(c.standard || '—')}</td>
    <td>${c.status === 'active' ? '在用' : `<strong>停用</strong>（${e(c.suspendedReason || '—')}）`}</td>
  </tr>`).join('') || '<tr><td colspan="3">能力附表未录入</td></tr>';

  const equipRows = (state.equipments ?? []).map((eq) => {
    const es = equipState(eq, todayISOStr, settings.calibWarnDays ?? CALIB_WARN_DAYS);
    const caps = (eq.capIds ?? []).map((cid) => (state.capabilities ?? []).find((c) => c.id === cid)?.name ?? '').filter(Boolean).join('、');
    return `<tr>
    <td>${e(eq.name)}<br><span class="basis">${e(eq.code)}</span></td><td>${e(caps || '—')}</td>
    <td>${e(CALIB_TYPES[eq.calibType] ?? eq.calibType)} · ${eq.cycleMonths} 个月</td>
    <td>${e(eq.lastCalibISO || '—')}</td><td>${e(eq.calibDueISO || '—')}（${LEVEL[es.level] ?? es.level}）</td>
    <td>${eq.outOfServiceISO ? `已停用${eq.backISO ? `·${e(eq.backISO)} 复用` : ''}` : '在用'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="6">设备台账为空</td></tr>';

  const staffRows = (state.staff ?? []).map((s) => `<tr class="${s.active ? '' : 'muted'}">
    <td>${e(s.name)}</td><td>${e(STAFF_ROLES[s.role] ?? s.role)}</td><td>${e(s.title || '—')}</td>
    <td>${e(s.certValidISO || '—')}</td><td>${s.active ? '在册' : '已停用'}</td>
  </tr>`).join('') || '<tr><td colspan="5">人员名册为空</td></tr>';

  const reportRows = [...(state.reports ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((r) => `<tr>
    <td>${e(r.reportNo)}</td><td>${e(r.dateISO)}</td><td class="w"><span>${e(r.paramNames.join('、'))}</span></td>
    <td>${e(r.signerName)}（${e(r.signerTitle)}）</td><td>${r.cmaMarked ? '已标注' : '<strong>未标注</strong>'}</td>
    <td>${e(r.keepUntil || '—')}${r.disposedISO ? `（已处置 ${e(r.disposedISO)}）` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="6">报告台账为空</td></tr>';

  const qualityRows = [...(state.quality ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20).map((q) => `<tr>
    <td>${e(QUALITY_KINDS[q.kind] ?? q.kind)}</td><td>${e(q.dateISO)}</td><td class="w"><span>${e(q.title)}</span></td>
    <td>${q.kind === 'pt' ? e(PT_RESULTS[q.result] ?? q.result) : '—'}</td>
  </tr>`).join('') || '<tr><td colspan="4">无质量记录</td></tr>';

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr>
    <td>${e(c.dateISO)}</td><td>${e(CHANGE_KINDS[c.kind] ?? c.kind)}</td><td class="w"><span>${e(c.detail)}</span></td>
    <td>${c.status === 'filed' ? `${e(c.filedISO)} 已办结` : '<strong>未办结</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="4">暂无变更事项</td></tr>';

  const ncRows = [...(state.ncs ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((n) => `<tr>
    <td>${e(n.dateISO)}</td><td>${e(n.desc)}</td>
    <td>${n.status === 'open' ? '<strong>未整改</strong>' : `${e(n.actionISO)} ${e(n.action)}`}</td>
    <td>${n.status === 'closed' ? `${e(n.verifyISO)} ${e(n.verifiedBy)}` : n.status === 'fixed' ? '<strong>待验证</strong>' : '<strong>未闭环</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="4">无不符合项登记</td></tr>';

  const duRows = dutyBoard(state, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastDoneISO ? e(d.lastDoneISO) : '—'}</td>
    <td>${d.nextDue ? e(d.nextDue) : '—'}</td><td>${LEVEL[d.level] ?? d.level}</td><td>${e(d.basis)}</td>
  </tr>`).join('') || '<tr><td colspan="5">未登记年度义务</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>检验检测机构合规迎检自证包 · ${e(st.name ?? '')}</title>
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
<h1>检验检测机构合规迎检自证包 · ${e(st.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 最高管理者：${e(st.manager || '—')} · 技术负责人：${e(st.techLeader || '—')} · 质量负责人：${e(st.qualityLeader || '—')} · ${e(st.address || '地址未填')}</div>
<h2>一、机构与资质证书（163 号令现行版第 13/15/31 条）</h2>
<div class="meta">证书编号：${e(st.certNo || '—')} · 发证机关：${e(st.issuer || '—')} · 有效期至：${e(st.certExpiryISO || '—')}（${e(certState(st, todayISOStr).detail)}） · 领域：${e(st.field || '—')}</div>
<h2>二、账本体检（${hc.items.length} 项）</h2>
<div class="meta">体检得分 ${hc.score}（红 ${hc.bad} · 黄 ${hc.warn}）——缺口如实列出，未闭环项以现场整改为准</div>
<table><tr><th>项目</th><th>状态</th><th>说明</th></tr>${hcRows}</table>
<h2>三、能力附表（163 号令第 19 条：在证书规定的能力范围内出报告）</h2>
<table><tr><th>参数/项目</th><th>依据标准</th><th>状态</th></tr>${capRows}</table>
<h2>四、设备一机一档与量值溯源（2023 准则第 11 条：检定/校准/核查）</h2>
<table><tr><th>设备</th><th>关联参数</th><th>溯源方式/周期</th><th>最近溯源</th><th>有效期至</th><th>状态</th></tr>${equipRows}</table>
<h2>五、人员名册（2023 准则第 9 条；39 号令第 7/11 条）</h2>
<table><tr><th>姓名</th><th>角色</th><th>职称</th><th>资质有效期至</th><th>状态</th></tr>${staffRows}</table>
<h2>六、报告台账（近 40 份：三道闸核对后的合规落账；39 号令第 12 条保存不少于 6 年）</h2>
<table><tr><th>报告编号</th><th>日期</th><th>参数</th><th>签发人</th><th>CMA 标志</th><th>保存至</th></tr>${reportRows}</table>
<h2>七、质量记录（内审/管理评审/能力验证/内部质控——2023 准则第 12 条(九)）</h2>
<table><tr><th>类型</th><th>日期</th><th>内容摘要</th><th>能力验证结论</th></tr>${qualityRows}</table>
<h2>八、变更手续台账（163 号令现行版第 14 条五情形；未办结罚 1 万以下第 35 条）</h2>
<table><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows}</table>
<h2>九、不符合项整改闭环（内审/管理评审/能力验证/检查/自查）</h2>
<table><tr><th>发现日</th><th>描述</th><th>整改</th><th>验证关闭</th></tr>${ncRows}</table>
<h2>十、年度义务（39 号令第 16 条年报与自我声明 · 八部门年度自查 · 人员培训）</h2>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<div class="sign">最高管理者（签字/盖章）：____________　质量负责人（签字）：____________　日期：____________</div>
<div class="foot">生成：检证账 CertLedger · ${e(todayISOStr)} · 本页为机构自查与迎检备查材料，不替代资质认定申请、延续、变更、注销与能力验证报送等法定程序；属地资质认定部门与监管部门要求永远赢</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 报告合规核对单（单份报告的证据链：参数-附表对照 + 设备溯源 + 签字人资质 + 保存钟）
// ---------------------------------------------------------------------------

/** 报告合规核对单打印版（单文件 HTML）——委托方质疑或监管抽档时 10 秒自证单份报告的合规证据链 */
export function reportHtml(state, reportId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const r = (state.reports ?? []).find((x) => x.id === reportId);
  if (!r) throw new Error(`报告记录不存在: ${reportId}`);
  const capRows = (r.paramIds ?? []).map((pid) => {
    const cap = (state.capabilities ?? []).find((c) => c.id === pid);
    const eqs = (state.equipments ?? []).filter((eq) => (eq.capIds ?? []).includes(pid));
    return `<tr><td>${e(cap?.name ?? pid)}</td><td>${e(cap?.standard || '—')}</td><td class="w"><span>${eqs.map((eq) => `${e(eq.code)}（${e(CALIB_TYPES[eq.calibType] ?? '')}至 ${e(eq.calibDueISO || '—')}）`).join('、') || '—'}</span></td></tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>报告合规核对单 · ${e(r.reportNo)}</title>
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
<h1>检验检测报告合规核对单</h1>
<div class="meta">机构：${e(state.station?.name || '—')} · 报告编号：${e(r.reportNo)} · 打印日：${e(todayISOStr)}</div>
<h2>一、报告要素</h2>
<table>
  <tr><th>报告日期</th><td>${e(r.dateISO)}</td></tr>
  <tr><th>委托方</th><td>${e(r.client || '—')}</td></tr>
  <tr><th>签发授权签字人</th><td>${e(r.signerName)}（${e(r.signerTitle)}——2023 准则第 9 条(三)中级及以上或同等能力）</td></tr>
  <tr><th>CMA 标志</th><td>${r.cmaMarked ? '已标注（163 号令第 21 条）' : '未标注'}</td></tr>
  <tr><th>分包</th><td>${e(r.subcontract || '无分包')}</td></tr>
  <tr><th>落账时证书有效期</th><td>${e(r.snapshot?.certExpiryISO || '—')}</td></tr>
</table>
<h2>二、参数-附表-设备对照（落账时闸机核对）</h2>
<table><tr><th>参数/项目</th><th>依据标准</th><th>关联设备与溯源有效期</th></tr>${capRows || '<tr><td colspan="3">—</td></tr>'}</table>
<h2>三、保存与处置（39 号令第 12 条：原始记录和报告保存不少于 6 年）</h2>
<table>
  <tr><th>保存期限至</th><td>${e(r.keepUntil || '—')}</td></tr>
  <tr><th>处置</th><td>${r.disposedISO ? `${e(r.disposedISO)} ${e(r.disposedHow || '')}` : '未处置（保存期内）'}</td></tr>
</table>
<div class="sign">质量负责人（签字）：____________　授权签字人（签字）：____________　日期：____________</div>
<div class="foot">生成：检证账 CertLedger · ${e(todayISOStr)} · 本单为单份报告的合规证据链底稿；落账即存快照，事后状态变化以台账与原始记录为准</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'certledger', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'certledger') return { ok: false, error: '不是检证账的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.station === 'object' && s.station !== null &&
    arr(s.capabilities) && arr(s.equipments) && arr(s.staff) && arr(s.changes) &&
    arr(s.ncs) && arr(s.quality) && arr(s.reports) && arr(s.duties) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
