/**
 * core.js — 拍片单 XrayPass 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；周期/时限/提醒窗口等口径
 * 全部参数化，可在设置中被机构覆盖（属地生态环境与卫生部门要求永远赢）。
 *
 * 合规口径（原文链接与核验方式见 docs/14-调研来源.md，全部 2026-09-08 一手核验）：
 * - 《放射性同位素与射线装置安全和防护条例》（国务院令第 449 号公布，经 2014、2019 年两次
 *   修订的现行版，维基文库全文逐条核验）：
 *   第 5 条（生产、销售、使用放射性同位素和射线装置的单位应当取得许可证）；
 *   第 8 条（使用射线装置进行放射诊疗的医疗卫生机构还应当获得放射诊疗技术和医用辐射机构
 *   许可——放射诊疗许可的条例锚）；
 *   第 11 条（名称/地址/法定代表人变更应自变更登记之日起 20 日内申请办理许可证变更手续）；
 *   第 12 条（改变种类或范围、新建改建扩建使用设施场所 → 按原申请程序重新申领许可证）；
 *   第 13 条（许可证有效期为 5 年；届满需要延续的应于有效期届满 30 日前提出延续申请）；
 *   第 15 条（禁止无许可证或不按照许可证规定的种类和范围从事使用活动；禁止伪造、变造、
 *   转让许可证）；
 *   第 28 条（对直接从事使用活动的工作人员进行安全和防护知识教育培训并考核，考核不合格的
 *   不得上岗）；
 *   第 29 条（进行个人剂量监测和职业健康检查，建立个人剂量档案和职业健康监护档案）；
 *   第 30 条（对本单位放射性同位素、射线装置的安全和防护状况进行年度评估，发现隐患立即
 *   整改）；
 *   第 41/42 条（单位制定辐射事故应急方案；发生辐射事故立即启动应急措施并立即向当地生态
 *   环境、公安、卫生主管部门报告，禁止缓报、瞒报、谎报、漏报）；
 *   第 52 条（无许可证/不按种类范围/未重新申领/届满未办延续从事使用活动：责令停止违法行为
 *   限期改正；逾期不改正的责令停产停业或吊销许可证，没收违法所得，违法所得 10 万元以上并处
 *   1~5 倍罚款，没有违法所得或不足 10 万元的并处 1 万~10 万元罚款）；
 *   第 53 条（变更未办手续：责令限期改正给予警告；逾期不改正的暂扣或吊销许可证）。
 * - 《放射诊疗管理规定》（卫生部令第 46 号公布，2006-03-01 施行，根据 2016-01-19 国家卫生
 *   计生委令第 8 号修订的现行版，国家卫健委官方 PDF + 江苏省卫健委官方转载双源核验）：
 *   第 4 条（放射诊疗分四类管理：放射治疗/核医学/介入放射学/X 射线影像诊断——口腔诊所
 *   拍片属 X 射线影像诊断，向县级卫生行政部门申请放射诊疗许可）；
 *   第 6 条（执业条件：经核准登记的医学影像科诊疗科目、场所设施、质控与安全防护专兼职管理
 *   人员和管理制度、防护用品和监测仪器、放射事件应急处理预案）；
 *   第 17 条（《放射诊疗许可证》与《医疗机构执业许可证》同时校验，校验时提交本周期放射诊疗
 *   设备性能与辐射工作场所检测报告、放射诊疗工作人员健康监护资料）；
 *   第 19 条（四）(五)（制定放射事件应急预案并组织演练；记录本机构发生的放射事件并及时报告
 *   卫生行政部门）；
 *   第 20 条（新安装、维修或更换重要部件后的设备经资质认证检测机构检测合格方可启用；定期
 *   稳定性检测、校正和维护保养，由省级以上卫生行政部门资质认证的检测机构每年至少进行一次
 *   状态检测）；
 *   第 21 条（定期对放射诊疗工作场所和防护设施进行放射防护检测）；
 *   第 25 条（遵守医疗照射正当化和防护最优化，屏蔽防护，事先告知辐射对健康的影响）；
 *   第 26 条（(一)严格执行检查资料的登记、保存、提取和借阅制度——拍片台账的法条锚；(二)不得
 *   将核素显像检查和 X 射线胸部检查列入婴幼儿及少年儿童体检常规项目；(三)对育龄妇女腹部或
 *   骨盆进行核素显像检查或 X 射线检查前应问明是否怀孕，非特殊需要，对受孕后八至十五周的
 *   育龄妇女不得进行下腹部放射影像检查；(四)不得将乳腺 X 射线摄影列入对妇女体检的常规检查
 *   项目）；
 *   第 38 条（未取得放射诊疗许可从事放射诊疗、未办理诊疗科目登记或未按规定校验、擅自变更或
 *   超范围：警告、责令限期改正，可处 3000 元以下罚款，情节严重的吊销《医疗机构执业许可证》）；
 *   第 39 条（使用不具备相应资质的人员从事放射诊疗：责令限期改正，可处 5000 元以下罚款）；
 *   第 41 条（购置使用不合格/淘汰设备、未按规定使用安全防护装置和个人防护用品、未按规定对
 *   设备场所防护设施检测检查、未按规定进行个人剂量监测/健康检查/建立个人剂量和健康档案、
 *   放射事件处置不当：警告、责令限期改正，可处 1 万元以下罚款）。
 * - 《放射工作人员职业健康管理办法》（卫生部令第 55 号，2007-11-01 施行，国家卫健委法规库
 *   现行有效）：
 *   第十一条（外照射个人剂量监测周期一般为 30 天，最长不应超过 90 天；内照射按标准执行）；
 *   第十九条（上岗后定期职业健康检查，两次检查间隔不应超过 2 年——**职业健康监护归 #22
 *   岗卫账领域**，本工具只挂提醒不重复建监护档，领域互斥）。
 * - 《射线装置分类》（原环境保护部、国家卫生计生委公告 2017 年第 66 号，mee.gov.cn 原文）：
 *   口腔（牙科）X 射线装置、医用诊断 X 射线装置（普通 X 射线机/X 射线摄影机/医用 CT）均为
 *   Ⅲ类射线装置；血管造影用 X 射线装置（DSA）为Ⅱ类——本工具设备默认Ⅲ类、逐台可改。
 * - 执法实证（均为政府官网/官方媒体口径）：上海黄浦某医疗机构持放射诊疗许可证但无辐射安全
 *   许可证使用牙科 X 射线机被罚（双证缺一实证）；四川马尔康某诊所无证使用口腔 CT 被责令
 *   停止使用并限期申领；重庆南川某口腔诊所无证从事射线装置使用活动按低限罚款 1 万元；
 *   山东泰安某诊所被责令补办并罚款 1 万元——口腔拍片「无证用机」低限 1 万罚已是执法常态。
 * - 统计口径：《中国辐射卫生》期刊（2023）约 10 万个放射工作单位、70 万名放射工作者；
 *   口腔诊所数量沿用 #9 灭菌单宽区间口径（6~10 万家）；宠物诊疗机构 22,320 家沿用 #27
 *   兽诊账口径。放射诊疗机构分档官方统计缺失，宽区间诚实标注。
 * - 领域互斥：本工具覆盖「辐射安全+放射诊疗」合规台账；口腔诊所的院感消毒灭菌归 #9 灭菌单、
 *   放射工作人员职业健康监护归 #22 岗卫账、动物诊疗主体管理归 #27 兽诊账——互不重复。
 *
 * 本工具是放射诊疗机构侧的自证台账，不构成法律意见，不替代辐射安全许可、放射诊疗许可、
 * 建设项目卫生审查/竣工验收、环境影响评价等法定程序；属地生态环境与卫生部门要求永远赢。
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
 * 2 月 29 日 + 12 = 2 月 28 日钳制）。校验/检测等周期「精确到月」用。
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

/** 机构类型（判型引擎：决定证件清单与审批口径） */
export const ORG_KINDS = {
  dental: '口腔诊所/门诊部（X 射线影像诊断 · 县级卫生行政部门审批）',
  medical: '其他医疗机构（X 射线影像诊断等）',
  vet: '动物诊疗机构（兽用 X 射线 · 仅辐射安全许可）',
};

/** 辐射安全许可证有效期（年）：449 号令第 13 条 */
export const RADSAFE_VALID_YEARS = 5;
/** 延续申请窗口：有效期届满 30 日前提出延续申请（449 号令第 13 条） */
export const RENEW_ADVANCE_DAYS = 30;
/** 许可证临期提醒（天，产品口径，早于法定申请窗口，只提示不判定） */
export const LICENSE_WARN_DAYS = 90;

/** 设备状态检测周期（月）：每年至少一次（46 号令第 20 条(二)） */
export const STATUS_CHECK_CYCLE_MONTHS = 12;
/** 场所/机房放射防护检测周期（月，参数化默认 12：46 号令第 21 条「定期」+ 惯例一年） */
export const SITE_CHECK_CYCLE_MONTHS = 12;
/** 检测临期提醒（天，产品口径） */
export const CHECK_WARN_DAYS = 30;

/** 个人剂量监测周期上限（天）：外照射一般为 30 天、最长不应超过 90 天（55 号令第十一条） */
export const DOSE_MAX_DAYS = 90;
/** 个人剂量临期提醒（天，产品口径：临近 30 天一般周期） */
export const DOSE_WARN_DAYS = 15;

/** 安全和防护知识培训复训周期（天，参数化默认两年）：449 号令第 28 条培训考核 + 惯例口径 */
export const TRAINING_CYCLE_DAYS = 730;
/** 职业健康检查提醒周期（天）：55 号令第十九条两次检查间隔不应超过 2 年（归 #22 岗卫账，仅提醒） */
export const HEALTH_CHECK_CYCLE_DAYS = 730;

/** 周期义务（周期为参数化默认值，属地要求永远赢） */
export const DUTY_KINDS = {
  annualeval: { label: '辐射安全和防护状况年度评估', cycleDays: 365, basis: '449 号令第 30 条' },
  drill: { label: '放射事件应急预案演练', cycleDays: 365, basis: '46 号令第 19 条(四)（制定预案并组织演练）· 惯例一年参数化' },
  healthcheck: { label: '放射工作人员职业健康检查提醒（监护归岗卫账）', cycleDays: 730, basis: '55 号令第十九条（间隔不超过 2 年）· 监护档属 #22 岗卫账领域' },
};

/** 变更/重新申领情形（449 号令第 11/12 条） */
export const CHANGE_KINDS = {
  name: '单位名称/法定代表人/地址变更（20 日内办变更手续 · 第 11 条）',
  scope: '改变种类或范围（按原程序重新申领 · 第 12 条(一)）',
  facility: '新建/改建/扩建使用场所（按原程序重新申领 · 第 12 条(二)）',
  other: '其他依法需办理变更的事项',
};

/** 受检者类型（46 号令第 26 条红线的载体） */
export const PATIENT_TYPES = {
  adult: '成人',
  child: '儿童/青少年（体检红线提示）',
  woman: '育龄妇女（妊娠询问红线）',
};

/** 默认提醒参数 */
export const DEFAULT_RENEW_WARN_DAYS = 30;
export const DEFAULT_DOSE_WARN_DAYS = 15;
export const DEFAULT_CHECK_WARN_DAYS = 30;

// ---------------------------------------------------------------------------
// 机构建档与双证钟（449 号令第 5/8/13 条；46 号令第 4/17 条）
// ---------------------------------------------------------------------------

/** 本机构应持证件清单（判型引擎：医疗类双证、动物诊疗类单证） */
export function requiredLicenses(org) {
  const list = ['radsafe'];
  if (org?.kind !== 'vet') list.unshift('radlicense');
  return list;
}

/**
 * 通用证件钟。levels:
 * unset 未登记（红）；overdue 已过期（红）；window 延续/校验窗口（黄，仍在有效期内不拦截开门/拍片）；
 * warn 临期提醒（黄）；ok 正常。
 */
export function licenseState(expiryISO, todayISOStr, warnDays = LICENSE_WARN_DAYS, texts = {}) {
  assertISO(todayISOStr);
  const warn = typeof warnDays === 'number' ? warnDays : LICENSE_WARN_DAYS;
  const t = { name: '许可证', unsetTip: '未登记有效期', overTip: '已过期——期间从事使用活动属违法', windowTip: '届满 30 日前应申请延续', ...texts };
  if (!expiryISO) return { level: 'unset', detail: `${t.name}${t.unsetTip}——${t.base}` };
  const daysLeft = daysUntil(expiryISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${t.name}${t.overTip}（${expiryISO}）：${t.overLaw}` };
  }
  if (daysLeft <= RENEW_ADVANCE_DAYS) {
    return { level: 'window', daysLeft, detail: `${t.name} ${expiryISO} 到期（剩 ${daysLeft} 天）——${t.windowTip}，今天就办` };
  }
  if (daysLeft <= warn) {
    return { level: 'warn', daysLeft, detail: `${t.name} ${expiryISO} 到期（剩 ${daysLeft} 天）——准备延续/校验材料` };
  }
  return { level: 'ok', daysLeft, detail: `${t.name}有效期至 ${expiryISO}` };
}

/** 辐射安全许可证钟（449 号令第 13/52 条） */
export function radSafeState(org, todayISOStr, warnDays = LICENSE_WARN_DAYS) {
  return licenseState(org?.radSafeExpiryISO, todayISOStr, warnDays, {
    name: '辐射安全许可证',
    base: '使用射线装置应当取得许可证（449 号令第 5 条）',
    overLaw: '无证/过期使用：责令停止违法行为限期改正，逾期不改正责令停产停业或吊销许可证，并处 1 万~10 万元罚款（第 52 条）',
    windowTip: '延续应在届满 30 日前申请（第 13 条）',
  });
}

/** 放射诊疗许可证校验钟（46 号令第 17 条：与《医疗机构执业许可证》同时校验；到期日照录） */
export function radLicenseState(org, todayISOStr, warnDays = LICENSE_WARN_DAYS) {
  return licenseState(org?.radLicenseExpiryISO, todayISOStr, warnDays, {
    name: '放射诊疗许可证（校验）',
    base: '放射诊疗应取得放射诊疗许可（449 号令第 8 条、46 号令第 4 条）',
    overLaw: '未取得许可或未按规定校验：警告、责令限期改正，可处 3000 元以下罚款，情节严重吊销《医疗机构执业许可证》（46 号令第 38 条）',
    windowTip: '与《医疗机构执业许可证》同时校验（46 号令第 17 条），校验要交设备性能与场所检测报告',
  });
}

/** 全部应持证件的最差状态（体检/看板用） */
export function orgLicenseState(org, todayISOStr, warnDays = LICENSE_WARN_DAYS) {
  const states = requiredLicenses(org).map((k) => (k === 'radsafe' ? radSafeState(org, todayISOStr, warnDays) : radLicenseState(org, todayISOStr, warnDays)));
  const order = { overdue: 0, unset: 1, window: 2, warn: 3, ok: 4 };
  return states.sort((a, b) => order[a.level] - order[b.level])[0];
}

/** 续期/校验办结：录入新证载明的有效期（应晚于当前），滚动对应证件钟 */
export function renewLicense(org, key, newExpiryISO) {
  assertISO(newExpiryISO);
  if (key !== 'radSafeExpiryISO' && key !== 'radLicenseExpiryISO') throw new Error(`非法证件键: ${key}`);
  if (!org?.[key]) throw new Error('先在机构建档登记现有证件信息');
  if (newExpiryISO <= org[key]) throw new Error('新证有效期应晚于当前有效期（续证/校验换发）');
  org[key] = newExpiryISO;
  return org;
}

// ---------------------------------------------------------------------------
// 设备一机一档（46 号令第 20/21 条：验收检测 + 每年状态检测 + 场所防护检测）
// ---------------------------------------------------------------------------

/**
 * 建档一台射线装置。device: { name, code, deviceClass, roomNo, acceptanceISO, statusCheckISO, siteCheckISO, note }
 * 闸机：名称/编号必填、编号唯一；录入最近检测日自动推导下次到期（+周期月，月末钳制）。
 */
export function addDevice(state, { name, code, deviceClass = 'Ⅲ类', roomNo = '', acceptanceISO = '', statusCheckISO = '', siteCheckISO = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('设备名称必填');
  if (!String(code || '').trim()) throw new Error('设备编号必填——一机一档的档主');
  if ((state.devices ?? []).some((x) => x.code === code)) {
    throw new Error(`设备编号 ${code} 已建档（同编号唯一）`);
  }
  state.deviceSeq = (state.deviceSeq ?? 0) + 1;
  const rec = {
    id: `dv-${state.deviceSeq}`, name, code, deviceClass, roomNo,
    acceptanceISO,
    statusCheckISO, statusDueISO: statusCheckISO ? addMonthsExact(statusCheckISO, STATUS_CHECK_CYCLE_MONTHS) : '',
    siteCheckISO, siteDueISO: siteCheckISO ? addMonthsExact(siteCheckISO, SITE_CHECK_CYCLE_MONTHS) : '',
    outISO: '', backISO: '',
    note,
  };
  state.devices.push(rec);
  return rec;
}

/** 在用设备（未停用） */
export function activeDevices(state) {
  return (state.devices ?? []).filter((x) => !x.outISO);
}

/**
 * 设备双钟通用态。kind: 'status'（状态检测，46 号令第 20 条）| 'site'（场所防护检测，第 21 条）。
 * levels: unset 红 / overdue 红 / due 黄 / ok / 停用 none。
 */
export function deviceClockState(device, kind, todayISOStr, warnDays = CHECK_WARN_DAYS) {
  assertISO(todayISOStr);
  const warn = typeof warnDays === 'number' ? warnDays : CHECK_WARN_DAYS;
  const dueISO = kind === 'status' ? device.statusDueISO : device.siteDueISO;
  const label = kind === 'status' ? '状态检测' : '场所防护检测';
  if (device.outISO) return { level: 'none', detail: `已停用（${device.outISO}）` };
  if (!dueISO) {
    return { level: 'unset', detail: `未录入最近${label}日——${kind === 'status' ? '每年至少一次状态检测无证据（46 号令第 20 条）' : '定期放射防护检测无证据（46 号令第 21 条）'}` };
  }
  const daysLeft = daysUntil(dueISO, todayISOStr);
  if (daysLeft < 0) {
    return {
      level: 'overdue', daysLeft,
      detail: kind === 'status'
        ? `状态检测已超期（${dueISO}）——期间拍片有「未按规定对放射诊疗设备进行检测」1 万元以下罚款风险（46 号令第 41 条(三)），停用并约检`
        : `场所防护检测已超期（${dueISO}）——定期放射防护检测义务未落实（46 号令第 21/41 条(三)），安排检测`,
    };
  }
  if (daysLeft <= warn) {
    return { level: 'due', daysLeft, detail: `${label} ${dueISO} 到期（剩 ${daysLeft} 天）——安排检测` };
  }
  return { level: 'ok', daysLeft, detail: `${label}有效期至 ${dueISO}` };
}

/** 记录一次检测完成：滚动对应检测钟（kind: 'status'|'site'|'acceptance'） */
export function recordDeviceCheck(state, deviceId, kind, doneISO, note = '') {
  assertISO(doneISO);
  const dv = (state.devices ?? []).find((x) => x.id === deviceId);
  if (!dv) throw new Error(`设备不存在: ${deviceId}`);
  if (dv.outISO) throw new Error('该设备已停用，恢复在用后再录检测');
  if (kind === 'status') {
    dv.statusCheckISO = doneISO;
    dv.statusDueISO = addMonthsExact(doneISO, STATUS_CHECK_CYCLE_MONTHS);
  } else if (kind === 'site') {
    dv.siteCheckISO = doneISO;
    dv.siteDueISO = addMonthsExact(doneISO, SITE_CHECK_CYCLE_MONTHS);
  } else if (kind === 'acceptance') {
    dv.acceptanceISO = doneISO;
  } else {
    throw new Error(`非法检测类型: ${kind}`);
  }
  if (note) dv.note = note;
  return dv;
}

/** 停用/恢复设备（待检、维修、退役） */
export function setDeviceService(state, deviceId, inService, iso) {
  assertISO(iso);
  const dv = (state.devices ?? []).find((x) => x.id === deviceId);
  if (!dv) throw new Error(`设备不存在: ${deviceId}`);
  if (inService) {
    if (!dv.outISO) throw new Error('该设备本就在用');
    dv.backISO = iso;
    dv.outISO = '';
  } else {
    if (dv.outISO) throw new Error('该设备已停用');
    dv.outISO = iso;
  }
  return dv;
}

// ---------------------------------------------------------------------------
// 放射工作人员名册（449 号令第 28/29 条；55 号令剂量周期）
// ---------------------------------------------------------------------------

/**
 * 入册一名放射工作人员。worker: { name, certNo, trainingISO, doseISO, note }
 * 闸机：姓名必填；同姓名拒绝；培训/剂量日期可留空（=unset，拍片点名不放行）。
 */
export function addWorker(state, { name, certNo = '', trainingISO = '', doseISO = '', note = '' }) {
  if (!String(name || '').trim()) throw new Error('姓名必填');
  if ((state.workers ?? []).some((w) => w.name === name)) {
    throw new Error(`${name} 已在名册中`);
  }
  if (trainingISO) assertISO(trainingISO);
  if (doseISO) assertISO(doseISO);
  state.workerSeq = (state.workerSeq ?? 0) + 1;
  const rec = {
    id: `wk-${state.workerSeq}`, name, certNo,
    trainingISO, trainingDueISO: trainingISO ? addDays(trainingISO, TRAINING_CYCLE_DAYS) : '',
    doseISO, doseDueISO: doseISO ? addDays(doseISO, DOSE_MAX_DAYS) : '',
    active: true, note,
  };
  state.workers.push(rec);
  return rec;
}

/** 停用/恢复人员（离职停用不删除：历史拍片单可回溯到当日操作者；停用后拍片点名不可选） */
export function setWorkerActive(state, workerId, active) {
  const rec = (state.workers ?? []).find((w) => w.id === workerId);
  if (!rec) throw new Error(`人员不存在: ${workerId}`);
  rec.active = !!active;
  return rec;
}

/** 在册人员 */
export function activeWorkers(state) {
  return (state.workers ?? []).filter((w) => w.active);
}

/**
 * 培训钟（449 号令第 28 条：培训考核不合格不得上岗；复训周期惯例两年参数化）。
 * levels: unset 红 / overdue 红 / due 黄 / ok。
 */
export function trainingState(worker, todayISOStr, cycleDays = TRAINING_CYCLE_DAYS, warnDays = 60) {
  assertISO(todayISOStr);
  if (!worker.trainingDueISO) {
    return { level: 'unset', detail: `${worker.name} 未登记培训考核日——培训考核不合格不得上岗（449 号令第 28 条）` };
  }
  const daysLeft = daysUntil(worker.trainingDueISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${worker.name} 培训考核已超期（${worker.trainingDueISO}）——安排复训考核前不得操作拍片（449 号令第 28 条）` };
  }
  if (daysLeft <= warnDays) {
    return { level: 'due', daysLeft, detail: `${worker.name} 培训 ${worker.trainingDueISO} 到期（剩 ${daysLeft} 天）——安排复训` };
  }
  return { level: 'ok', daysLeft, detail: `${worker.name} 培训考核有效期至 ${worker.trainingDueISO}` };
}

/**
 * 个人剂量钟（55 号令第十一条：外照射个人剂量监测周期一般为 30 天、最长不应超过 90 天）。
 * levels: unset 红 / overdue 红 / due 黄 / ok。
 */
export function doseState(worker, todayISOStr, maxDays = DOSE_MAX_DAYS, warnDays = DOSE_WARN_DAYS) {
  assertISO(todayISOStr);
  if (!worker.doseDueISO) {
    return { level: 'unset', detail: `${worker.name} 未登记最近个人剂量监测报告日——未按规定进行个人剂量监测属 1 万元以下罚款情形（46 号令第 41 条(四)）` };
  }
  const daysLeft = daysUntil(worker.doseDueISO, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `${worker.name} 个人剂量监测已超 ${DOSE_MAX_DAYS} 天上限（${worker.doseDueISO}）——先送佩戴剂量计读取再拍片（55 号令第十一条）` };
  }
  if (daysLeft <= warnDays) {
    return { level: 'due', daysLeft, detail: `${worker.name} 剂量周期 ${worker.doseDueISO} 到期（剩 ${daysLeft} 天）——送检读取` };
  }
  return { level: 'ok', daysLeft, detail: `${worker.name} 剂量监测在期（至 ${worker.doseDueISO}）` };
}

/** 记录一次培训考核完成：滚动培训钟 */
export function recordTraining(state, workerId, doneISO, note = '') {
  assertISO(doneISO);
  const w = (state.workers ?? []).find((x) => x.id === workerId);
  if (!w) throw new Error(`人员不存在: ${workerId}`);
  w.trainingISO = doneISO;
  w.trainingDueISO = addDays(doneISO, TRAINING_CYCLE_DAYS);
  if (note) w.note = note;
  return w;
}

/** 记录一次个人剂量监测报告：滚动剂量钟（可选记录读数 mSv） */
export function recordDose(state, workerId, reportISO, doseMsv = '', note = '') {
  assertISO(reportISO);
  const w = (state.workers ?? []).find((x) => x.id === workerId);
  if (!w) throw new Error(`人员不存在: ${workerId}`);
  w.doseISO = reportISO;
  w.doseDueISO = addDays(reportISO, DOSE_MAX_DAYS);
  if (doseMsv !== '') w.lastDoseMsv = String(doseMsv);
  if (note) w.note = note;
  return w;
}

// ---------------------------------------------------------------------------
// 拍片台账与拍片闸（产品的门禁：46 号令第 26 条(一)资料登记 + 红线拦截）
// ---------------------------------------------------------------------------

/**
 * 拍片前体检。返回 { ok, reasons[], gates }，每条拒绝理由都带法条口径。
 * 闸（全部通过才放行；window=仍在有效期只提醒不拦截）：
 * 1. 辐射安全许可证在期（449 号令第 5/15/52 条）；
 * 2. 放射诊疗许可证在期（医疗/口腔类；449 号令第 8 条、46 号令第 38 条）；
 * 3. 设备在用且状态检测在期（46 号令第 20/41 条(三)）；
 * 4. 操作人员培训考核在期（449 号令第 28 条）；
 * 5. 操作人员个人剂量监测在期（55 号令第十一条、46 号令第 41 条(四)）；
 * 6. 孕妇询问红线（46 号令第 26 条(三)：育龄妇女应问明是否怀孕；怀孕/未问明拦截；
 *    「临床特殊需要」须填理由并如实落账打标——工具不替医生做正当性判断，只强制留痕）。
 */
export function shotGate(state, { dateISO, deviceId = '', workerId = '', patientType = 'adult', pregnancy = '', special = false, note = '' }) {
  assertISO(dateISO);
  const reasons = [];
  const gates = [];

  const rs = radSafeState(state.org ?? {}, dateISO);
  const g1 = ['ok', 'warn', 'window'].includes(rs.level);
  if (!g1) reasons.push(rs.level === 'unset' ? rs.detail : `辐射安全许可证已过期——${rs.detail}`);
  gates.push({ key: 'radsafe', ok: g1, detail: rs.detail });

  if (state.org?.kind !== 'vet') {
    const rl = radLicenseState(state.org ?? {}, dateISO);
    const g2 = ['ok', 'warn', 'window'].includes(rl.level);
    if (!g2) reasons.push(rl.level === 'unset' ? rl.detail : `放射诊疗许可证未校验/已过期——${rl.detail}`);
    gates.push({ key: 'radlicense', ok: g2, detail: rl.detail });
  }

  const dv = (state.devices ?? []).find((x) => x.id === deviceId);
  const sc = dv ? deviceClockState(dv, 'status', dateISO) : null;
  const g3 = !!dv && !dv.outISO && ['ok', 'due'].includes(sc.level);
  if (!dv) reasons.push('未选择射线装置——先在设备台账建档（46 号令第 20 条）');
  else if (dv.outISO) reasons.push(`${dv.name}（${dv.code}）已停用——停用设备不得拍片`);
  else if (!['ok', 'due'].includes(sc.level)) reasons.push(`${dv.name}（${dv.code}）${sc.detail}`);
  gates.push({ key: 'device', ok: g3, detail: dv ? (dv.outISO ? '已停用' : sc.detail) : '未选设备' });

  const wk = (state.workers ?? []).find((x) => x.id === workerId);
  const tr = wk ? trainingState(wk, dateISO) : null;
  const g4 = !!wk && wk.active && ['ok', 'due'].includes(tr.level);
  if (!wk) reasons.push('未选择操作人员——培训考核不合格不得上岗（449 号令第 28 条）');
  else if (!wk.active) reasons.push(`${wk.name} 已停用——离职/停用人员不得操作`);
  else if (!['ok', 'due'].includes(tr.level)) reasons.push(tr.detail);
  gates.push({ key: 'training', ok: g4, detail: wk ? (wk.active ? tr.detail : '已停用') : '未点名' });

  const do_ = wk ? doseState(wk, dateISO) : null;
  const g5 = !!wk && wk.active && ['ok', 'due'].includes(do_.level);
  if (wk && wk.active && !['ok', 'due'].includes(do_.level)) reasons.push(do_.detail);
  gates.push({ key: 'dose', ok: g5, detail: wk && wk.active ? do_.detail : '不适用' });

  let g6 = true;
  if (patientType === 'woman') {
    if (!special && (!pregnancy || pregnancy === 'unknown')) {
      reasons.push('育龄妇女拍片前应问明是否怀孕——未问明不得检查（46 号令第 26 条(三)）；确属临床特殊需要请勾选并填明理由，如实落账');
      g6 = false;
    } else if (!special && pregnancy === 'pregnant') {
      reasons.push('受检者已怀孕——非特殊需要不得进行放射影像检查；确属临床特殊需要请勾选并填明理由（46 号令第 26 条(三)）');
      g6 = false;
    }
  }
  gates.push({
    key: 'pregnancy', ok: g6,
    detail: patientType === 'woman'
      ? (special ? '按「临床特殊需要」放行并落账留痕' : pregnancy === 'not-pregnant' ? '已问明：未怀孕' : pregnancy === 'pregnant' ? '已怀孕——特殊需要才放行' : '未问明妊娠状态')
      : '不适用',
  });

  return { ok: reasons.length === 0, reasons, gates };
}

/**
 * 落一笔拍片台账：闸机全部通过才落账，同时记录合规快照（46 号令第 26 条(一)检查资料登记保存）。
 */
export function addShot(state, { dateISO, deviceId, workerId, patientType = 'adult', pregnancy = '', special = false, bodyPart = '', note = '' }) {
  assertISO(dateISO);
  const gate = shotGate(state, { dateISO, deviceId, workerId, patientType, pregnancy, special, note });
  if (!gate.ok) {
    throw new Error(`拍片被闸机拒绝：${gate.reasons.join('；')}`);
  }
  const dv = (state.devices ?? []).find((x) => x.id === deviceId);
  const wk = (state.workers ?? []).find((x) => x.id === workerId);
  state.shotSeq = (state.shotSeq ?? 0) + 1;
  const rec = {
    id: `sh-${state.shotSeq}`, dateISO, deviceId, deviceName: `${dv.name}（${dv.code}）`,
    workerId, workerName: wk.name,
    patientType, pregnancy, special: !!special, bodyPart, note,
    snapshot: {
      radSafeExpiryISO: state.org?.radSafeExpiryISO ?? '',
      radLicenseExpiryISO: state.org?.radLicenseExpiryISO ?? '',
      deviceStatusDueISO: dv.statusDueISO ?? '',
      workerTrainingDueISO: wk.trainingDueISO ?? '',
      workerDoseDueISO: wk.doseDueISO ?? '',
    },
  };
  state.shots.push(rec);
  return rec;
}

/** 删除拍片记录（录错自救；删除埋点留痕） */
export function removeShot(state, shotId) {
  const idx = (state.shots ?? []).findIndex((s) => s.id === shotId);
  if (idx < 0) throw new Error(`拍片记录不存在: ${shotId}`);
  state.shots.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 放射事件与隐患闭环（状态机 open → fixed → closed；46 号令第 19 条(五)记录报告）
// ---------------------------------------------------------------------------

/** 手工登记事件/隐患。来源：selfcheck 自查 / inspection 监督检查 / event 放射事件 */
export function addIncident(state, { dateISO, source = 'selfcheck', desc }) {
  const SOURCES = { selfcheck: '自查上报', inspection: '监督检查', event: '放射事件' };
  if (!SOURCES[source]) throw new Error(`非法来源: ${source}`);
  if (!String(desc || '').trim()) throw new Error('事件/隐患描述必填');
  state.incidentSeq = (state.incidentSeq ?? 0) + 1;
  const rec = {
    id: `in-${state.incidentSeq}`, dateISO, source,
    sourceLabel: SOURCES[source], desc,
    action: '', actionISO: '', verifyISO: '', verifiedBy: '', status: 'open',
  };
  state.incidents.push(rec);
  return rec;
}

/** 整改（open → fixed）：措施与完成日必填；完成日不得早于发现日 */
export function fixIncident(state, incidentId, { actionISO, action }) {
  const it = (state.incidents ?? []).find((x) => x.id === incidentId);
  if (!it) throw new Error(`事件记录不存在: ${incidentId}`);
  if (it.status !== 'open') throw new Error('只有未整改记录可以登记整改（状态机 open → fixed → closed）');
  assertISO(actionISO);
  if (actionISO < it.dateISO) throw new Error('整改完成日早于发现日');
  if (!String(action || '').trim()) throw new Error('整改措施必填——只打勾不留痕不算整改');
  it.action = action;
  it.actionISO = actionISO;
  it.status = 'fixed';
  return it;
}

/** 验证关闭（fixed → closed）：验证人与验证日必填 */
export function closeIncident(state, incidentId, { verifyISO, verifiedBy }) {
  const it = (state.incidents ?? []).find((x) => x.id === incidentId);
  if (!it) throw new Error(`事件记录不存在: ${incidentId}`);
  if (it.status === 'open') throw new Error('先登记整改措施，再验证关闭（跳级拒绝）');
  if (it.status === 'closed') throw new Error('该记录已闭环');
  assertISO(verifyISO);
  if (verifyISO < it.actionISO) throw new Error('验证日早于整改完成日');
  if (!String(verifiedBy || '').trim()) throw new Error('验证人必填（建议 radiation 管理负责人）');
  it.verifyISO = verifyISO;
  it.verifiedBy = verifiedBy;
  it.status = 'closed';
  return it;
}

/** 未闭环事件/隐患（早的在前） */
export function openIncidents(state) {
  return (state.incidents ?? []).filter((n) => n.status !== 'closed').sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// 变更/重新申领台账（449 号令第 11/12 条；未办手续罚则第 53/52 条）
// ---------------------------------------------------------------------------

/** 登记一项变更/重新申领事实 */
export function addChange(state, { dateISO, kind, detail = '' }) {
  assertISO(dateISO);
  if (!CHANGE_KINDS[kind]) throw new Error(`非法情形: ${kind}`);
  if (!String(detail || '').trim()) throw new Error('说明必填（变更前后内容）');
  state.changeSeq = (state.changeSeq ?? 0) + 1;
  const rec = { id: `cg-${state.changeSeq}`, dateISO, kind, detail, filedISO: '', status: 'open' };
  state.changes.push(rec);
  return rec;
}

/** 办结变更/重新申领手续（回执日期） */
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
// 周期义务账（年度评估/应急演练/健康检查提醒；打勾自动滚动）
// ---------------------------------------------------------------------------

/** 登记或更新某类义务的最近完成日 */
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

/** 单项义务状态 */
export function dutyState(duty, todayISOStr, cycleDays = null) {
  assertISO(todayISOStr);
  const cycle = cycleDays ?? DUTY_KINDS[duty.kind]?.cycleDays ?? 365;
  if (!duty.lastDoneISO) return { level: 'never', cycle };
  const nextDue = addDays(duty.lastDoneISO, cycle);
  const daysLeft = daysUntil(nextDue, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= 30 ? 'due' : 'ok';
  return { level, cycle, nextDue, daysLeft };
}

/** 全部义务看板：未登记的义务也以「从未执行」入板；红灯在前 */
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
  const checkWarn = settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS;
  const items = [];

  // ① 双证钟
  const lic = orgLicenseState(state.org ?? {}, todayISOStr, renewWarn);
  items.push({
    key: 'license', label: '辐射安全/放射诊疗双证',
    level: ['unset', 'overdue'].includes(lic.level) ? 'bad' : ['window', 'warn'].includes(lic.level) ? 'warn' : 'ok',
    detail: lic.detail,
  });

  // ② 设备状态检测钟
  const dvs = activeDevices(state);
  const overSt = dvs.filter((d) => deviceClockState(d, 'status', todayISOStr, checkWarn).level === 'overdue');
  const unsetSt = dvs.filter((d) => deviceClockState(d, 'status', todayISOStr, checkWarn).level === 'unset');
  const dueSt = dvs.filter((d) => deviceClockState(d, 'status', todayISOStr, checkWarn).level === 'due');
  items.push({
    key: 'statuscheck', label: '设备状态检测钟（每年至少一次）',
    level: overSt.length || unsetSt.length ? 'bad' : dueSt.length ? 'warn' : 'ok',
    detail: overSt.length || unsetSt.length
      ? `${overSt.length} 台超期、${unsetSt.length} 台未录入——未按规定检测可处 1 万元以下罚款（46 号令第 41 条(三)）`
      : dueSt.length ? `${dueSt.length} 台临期（最早 ${dueSt[0].statusDueISO}）——约检` : dvs.length ? `${dvs.length} 台在用设备状态检测全部在期` : '设备台账为空——先把 X 射线机建上档',
  });

  // ③ 场所防护检测钟
  const overSite = dvs.filter((d) => deviceClockState(d, 'site', todayISOStr, checkWarn).level === 'overdue');
  const unsetSite = dvs.filter((d) => deviceClockState(d, 'site', todayISOStr, checkWarn).level === 'unset');
  const dueSite = dvs.filter((d) => deviceClockState(d, 'site', todayISOStr, checkWarn).level === 'due');
  items.push({
    key: 'sitecheck', label: '机房场所防护检测钟',
    level: overSite.length || unsetSite.length ? 'bad' : dueSite.length ? 'warn' : 'ok',
    detail: overSite.length || unsetSite.length
      ? `${overSite.length + unsetSite.length} 台机房防护检测缺——定期放射防护检测义务（46 号令第 21 条）`
      : dueSite.length ? `${dueSite.length} 台临期——安排检测` : '机房防护检测在期（校验时要交这份报告）',
  });

  // ④⑤ 人员剂量与培训
  const workers = activeWorkers(state);
  const badDose = workers.filter((w) => ['overdue', 'unset'].includes(doseState(w, todayISOStr).level));
  const dueDose = workers.filter((w) => doseState(w, todayISOStr).level === 'due');
  items.push({
    key: 'dose', label: '个人剂量监测钟（≤90 天）',
    level: badDose.length ? 'bad' : dueDose.length ? 'warn' : 'ok',
    detail: !workers.length
      ? '放射工作人员名册为空——操作拍片者均应入册（449 号令第 28/29 条）'
      : badDose.length
        ? `${badDose.map((w) => w.name).join('、')} 剂量监测超期/未登记——46 号令第 41 条(四) 1 万元以下罚款情形`
        : dueDose.length
          ? `${dueDose.map((w) => w.name).join('、')} 剂量周期临期——送检读取（一般 30 天一读、最长 90 天）`
          : `${workers.length} 名人员剂量全部在期`,
  });
  const badTr = workers.filter((w) => ['overdue', 'unset'].includes(trainingState(w, todayISOStr).level));
  items.push({
    key: 'training', label: '培训考核钟',
    level: badTr.length ? 'bad' : 'ok',
    detail: !workers.length
      ? '人员名册为空'
      : badTr.length
        ? `${badTr.map((w) => w.name).join('、')} 培训考核超期/未登记——考核不合格不得上岗（449 号令第 28 条）`
        : `${workers.length} 名人员培训考核在期`,
  });

  // ⑥ 拍片台账坚持
  const shots = state.shots ?? [];
  const lastShot = [...shots].sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];
  const gapDays = lastShot ? 0 - daysUntil(lastShot.dateISO, todayISOStr) : null;
  items.push({
    key: 'shots', label: '拍片台账（资料登记保存）',
    level: shots.length && gapDays <= 30 ? 'ok' : 'warn',
    detail: !shots.length
      ? '还没有拍片落账——46 号令第 26 条(一)要求严格执行检查资料的登记、保存制度'
      : gapDays <= 30
        ? `台账在记（最近 ${lastShot.dateISO}，共 ${shots.length} 笔）`
        : `最近一笔拍片在 ${gapDays} 天前——有拍片即应登记（46 号令第 26 条(一)）`,
  });

  // ⑦⑧⑨ 年度评估 / 演练 / 健康检查提醒
  const board = dutyBoard(state, todayISOStr);
  for (const kind of ['annualeval', 'drill', 'healthcheck']) {
    const d = board.find((x) => x.kind === kind);
    const isReminder = kind === 'healthcheck';
    items.push({
      key: kind, label: DUTY_KINDS[kind].label,
      level: !d || ['never', 'overdue'].includes(d.level) ? (isReminder ? 'warn' : 'bad') : d.level === 'due' ? 'warn' : 'ok',
      detail: !d || d.level === 'never'
        ? `从未登记——${DUTY_KINDS[kind].basis}`
        : d.level === 'overdue'
          ? `已逾期（应于 ${d.nextDue} 前完成）——${DUTY_KINDS[kind].basis}`
          : d.level === 'due'
            ? `应于 ${d.nextDue} 前完成（剩 ${d.daysLeft} 天）`
            : `上次完成：${d.nextDue} 前再开展（剩 ${d.daysLeft} 天）`,
    });
  }

  // ⑩ 变更手续与事件闭环
  const openCh = openChanges(state);
  const hz = openIncidents(state);
  items.push({
    key: 'closure', label: '变更手续与事件闭环',
    level: hz.some((x) => x.status === 'open') ? 'bad' : hz.length || openCh.length ? 'warn' : 'ok',
    detail: [
      hz.length ? `${hz.length} 项事件/隐患未闭环（最早 ${hz[0].dateISO}）` : '',
      openCh.length ? `${openCh.length} 项变更未办结——变更 20 日内办手续、重新申领情形按原程序办（449 号令第 11/12 条）` : '',
      !hz.length && !openCh.length ? '变更无欠账、事件全闭环' : '',
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
  const shots = (state.shots ?? []).filter((s) => inMonth(s.dateISO));
  const special = shots.filter((s) => s.special);
  const blocked = (state.traces ?? []).filter((t) => t.type === 'shot-gate-blocked' && inMonth((t.dateISO || t.at || '').slice(0, 10)));
  const incs = (state.incidents ?? []).filter((h) => inMonth(h.dateISO));
  const incsClosed = incs.filter((h) => h.status === 'closed');
  const openInc = openIncidents(state);
  const lic = orgLicenseState(state.org ?? {}, todayISOStr, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);
  const hc = healthCheck(state, todayISOStr, settings);

  const L = [];
  L.push(`【放射诊疗合规月度小结】${month}`);
  if (state.org?.name) L.push(`机构：${state.org.name}（辐射安全许可证 ${state.org.radSafeNo || '—'}，有效期至 ${state.org.radSafeExpiryISO || '—'}；类型：${(ORG_KINDS[state.org.kind] ?? state.org.kind ?? '—').split('（')[0]}）`);
  L.push(`落账拍片 ${shots.length} 笔（拍片闸全过才落账${special.length ? `，其中「临床特殊需要」放行 ${special.length} 笔已如实打标` : ''}），闸机拦截不合规拍片 ${blocked.length} 次——每次拦截都是没被罚的证据`);
  L.push(`事件/隐患登记 ${incs.length} 项、闭环 ${incsClosed.length} 项${openInc.length ? `，仍有 ${openInc.length} 项未闭环` : ''}`);
  if (['window', 'warn'].includes(lic.level)) L.push(`⚠ 证件延续/校验提醒：${lic.detail}`);
  if (lic.level === 'overdue') L.push(`⚠ 证件已过期：${lic.detail}`);
  const workers = activeWorkers(state);
  const badDose = workers.filter((w) => ['overdue', 'unset'].includes(doseState(w, todayISOStr).level));
  if (badDose.length) L.push(`⚠ 剂量监测点名：${badDose.map((w) => w.name).join('、')}——超 90 天上限（55 号令第十一条），先送读剂量计`);
  const dvs = activeDevices(state);
  const badDev = dvs.filter((d) => deviceClockState(d, 'status', todayISOStr, settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS).level === 'overdue');
  if (badDev.length) L.push(`⚠ 状态检测超期点名：${badDev.map((d) => `${d.name}(${d.code})`).join('、')}——停用约检（46 号令第 20 条）`);
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => ['never', 'overdue'].includes(d.level));
  if (dutiesLate.length) L.push(`⚠ 周期义务欠账：${dutiesLate.map((d) => d.label).join('、')}`);
  L.push(`账本体检 ${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）`);
  L.push('口径：《放射性同位素与射线装置安全和防护条例》（449 号令，2019 修订）第 5/8/11/12/13/28/29/30/42/52 条、《放射诊疗管理规定》（46 号令，2016 修订）第 4/17/19/20/21/25/26/38/39/41 条、《放射工作人员职业健康管理办法》（55 号令）第十一条、《射线装置分类》（2017 年第 66 号公告）；本小结为机构自查底稿，不替代辐射安全许可、放射诊疗许可、校验与建设项目审查等法定程序。');
  L.push(`生成：拍片单 · ${month}`);
  return {
    text: L.join('\n'), shots: shots.length, blocked: blocked.length, special: special.length,
    incs: incs.length, incsClosed: incsClosed.length, score: hc.score,
  };
}

// ---------------------------------------------------------------------------
// 出证物（单文件 HTML：迎检自证包 / 拍片合规核对单；同输入同输出）
// ---------------------------------------------------------------------------

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏）——对口生态环境+卫生双线检查 */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const o = state.org ?? {};
  const LEVEL = { overdue: '逾期', due: '临期', window: '延续窗口', warn: '临期', ok: '正常', never: '从未开展', unset: '未登记', none: '不适用' };

  const hc = healthCheck(state, todayISOStr, settings);
  const hcRows = hc.items.map((i) => `<tr><td>${e(i.label)}</td><td>${LEVEL[i.level] ?? i.level}</td><td>${e(i.detail)}</td></tr>`).join('');

  const devRows = (state.devices ?? []).map((d) => {
    const st = deviceClockState(d, 'status', todayISOStr, settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS);
    const si = deviceClockState(d, 'site', todayISOStr, settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS);
    return `<tr class="${d.outISO ? 'muted' : ''}">
    <td>${e(d.name)}<br><span class="basis">${e(d.code)} · ${e(d.deviceClass)}${d.roomNo ? ` · ${e(d.roomNo)}` : ''}</span></td>
    <td>${e(d.statusDueISO || '—')}（${LEVEL[st.level] ?? st.level}）</td>
    <td>${e(d.siteDueISO || '—')}（${LEVEL[si.level] ?? si.level}）</td>
    <td>${d.outISO ? `已停用${d.backISO ? `·${e(d.backISO)} 复用` : ''}` : '在用'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="4">设备台账为空</td></tr>';

  const wkRows = (state.workers ?? []).map((w) => {
    const tr = trainingState(w, todayISOStr);
    const do_ = doseState(w, todayISOStr);
    return `<tr class="${w.active ? '' : 'muted'}">
    <td>${e(w.name)}${w.certNo ? `<br><span class="basis">${e(w.certNo)}</span>` : ''}</td>
    <td>${e(w.trainingDueISO || '—')}（${LEVEL[tr.level] ?? tr.level}）</td>
    <td>${e(w.doseDueISO || '—')}（${LEVEL[do_.level] ?? do_.level}）${w.lastDoseMsv ? `<br><span class="basis">最近读数 ${e(w.lastDoseMsv)} mSv</span>` : ''}</td>
    <td>${w.active ? '在册' : '已停用'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="4">人员名册为空</td></tr>';

  const shotRows = [...(state.shots ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((s) => `<tr>
    <td>${e(s.dateISO)}</td><td>${e(s.deviceName)}</td><td>${e(s.workerName)}</td>
    <td>${e(PATIENT_TYPES[s.patientType] ?? s.patientType)}${s.patientType === 'woman' ? ` · ${s.special ? '<strong>特殊需要放行</strong>' : s.pregnancy === 'not-pregnant' ? '已问明未孕' : e(s.pregnancy || '—')}` : ''}</td>
    <td>${e(s.bodyPart || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="5">拍片台账为空</td></tr>';

  const incRows = [...(state.incidents ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((n) => `<tr>
    <td>${e(n.dateISO)}</td><td>${e(n.sourceLabel ?? n.source)}</td><td class="w"><span>${e(n.desc)}</span></td>
    <td>${n.status === 'open' ? '<strong>未整改</strong>' : `${e(n.actionISO || '—')} ${e(n.action || '')}`}</td>
    <td>${n.status === 'closed' ? `${e(n.verifyISO)} ${e(n.verifiedBy)}` : n.status === 'fixed' ? '<strong>待验证</strong>' : '<strong>未闭环</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="5">无事件/隐患登记</td></tr>';

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
<title>放射诊疗合规迎检自证包 · ${e(o.name ?? '')}</title>
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
<h1>放射诊疗合规迎检自证包 · ${e(o.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 机构负责人：${e(o.manager || '—')} · 类型：${e((ORG_KINDS[o.kind] ?? o.kind ?? '—').split('（')[0])} · ${e(o.address || '地址未填')}</div>
<h2>一、机构与双证（449 号令第 5/8/13 条；46 号令第 4/17 条）</h2>
<div class="meta">辐射安全许可证：${e(o.radSafeNo || '—')} · 有效期至 ${e(o.radSafeExpiryISO || '—')}（${e(radSafeState(o, todayISOStr).detail)}）${o.kind !== 'vet' ? `<br>放射诊疗许可证：${e(o.radLicenseNo || '—')} · 校验有效期至 ${e(o.radLicenseExpiryISO || '—')}（与《医疗机构执业许可证》同时校验，46 号令第 17 条）` : '<br>动物诊疗主体管理归兽诊账（本页只涉辐射安全线）'}</div>
<h2>二、账本体检（${hc.items.length} 项）</h2>
<div class="meta">体检得分 ${hc.score}（红 ${hc.bad} · 黄 ${hc.warn}）——缺口如实列出，未闭环项以现场整改为准</div>
<table><tr><th>项目</th><th>状态</th><th>说明</th></tr>${hcRows}</table>
<h2>三、射线装置一机一档（46 号令第 20/21 条：验收检测+每年状态检测+场所防护检测）</h2>
<table><tr><th>装置</th><th>状态检测至</th><th>场所防护检测至</th><th>状态</th></tr>${devRows}</table>
<h2>四、放射工作人员名册（449 号令第 28/29 条：培训考核+个人剂量监测+两档案）</h2>
<table><tr><th>姓名</th><th>培训考核至</th><th>个人剂量监测至</th><th>状态</th></tr>${wkRows}</table>
<h2>五、拍片台账（近 40 笔：拍片闸核对后落账 · 46 号令第 26 条(一)资料登记保存）</h2>
<table><tr><th>日期</th><th>装置</th><th>操作者</th><th>受检者/妊娠询问</th><th>部位</th></tr>${shotRows}</table>
<h2>六、放射事件与隐患闭环（46 号令第 19 条(五)：记录并及时报告）</h2>
<table><tr><th>发现日</th><th>来源</th><th>描述</th><th>整改</th><th>验证关闭</th></tr>${incRows}</table>
<h2>七、变更/重新申领台账（449 号令第 11/12 条；未办手续罚则第 53/52 条）</h2>
<table><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows}</table>
<h2>八、周期义务账（年度评估/应急演练/健康检查提醒）</h2>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<div class="sign">机构负责人（签字/盖章）：____________　辐射安全管理员（签字）：____________　日期：____________</div>
<div class="foot">生成：拍片单 XrayPass · ${e(todayISOStr)} · 本页为机构自查与迎检备查材料，不替代辐射安全许可、放射诊疗许可、校验与建设项目审查等法定程序；属地生态环境与卫生部门要求永远赢</div>
</body>
</html>`;
}

/** 拍片合规核对单（单次拍片证据链：双证-设备检测-人员资质-妊娠询问快照） */
export function shotHtml(state, shotId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const s = (state.shots ?? []).find((x) => x.id === shotId);
  if (!s) throw new Error(`拍片记录不存在: ${shotId}`);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>拍片合规核对单 · ${e(s.dateISO)}</title>
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
<h1>拍片合规核对单</h1>
<div class="meta">机构：${e(state.org?.name || '—')} · 拍片日期：${e(s.dateISO)} · 打印日：${e(todayISOStr)}</div>
<h2>一、拍片要素（落账时点）</h2>
<table>
  <tr><th>射线装置</th><td>${e(s.deviceName)}</td></tr>
  <tr><th>操作人员</th><td>${e(s.workerName)}</td></tr>
  <tr><th>受检者类型</th><td>${e(PATIENT_TYPES[s.patientType] ?? s.patientType)}${s.bodyPart ? ` · 部位：${e(s.bodyPart)}` : ''}</td></tr>
  <tr><th>妊娠询问（46 号令第 26 条(三)）</th><td>${s.patientType === 'woman' ? (s.special ? `<strong>按临床特殊需要放行</strong>——理由：${e(s.note || s.bodyPart || '见病历')}` : s.pregnancy === 'not-pregnant' ? '已问明：未怀孕' : e(s.pregnancy ?? '—')) : '不适用'}</td></tr>
</table>
<h2>二、闸机快照（落账时点状态）</h2>
<table>
  <tr><th>辐射安全许可证有效期</th><td>${e(s.snapshot?.radSafeExpiryISO || '—')}</td></tr>
  ${s.snapshot?.radLicenseExpiryISO ? `<tr><th>放射诊疗许可证校验期</th><td>${e(s.snapshot.radLicenseExpiryISO)}</td></tr>` : ''}
  <tr><th>设备状态检测有效期</th><td>${e(s.snapshot?.deviceStatusDueISO || '—')}（46 号令第 20 条每年至少一次）</td></tr>
  <tr><th>操作人员培训考核期</th><td>${e(s.snapshot?.workerTrainingDueISO || '—')}（449 号令第 28 条）</td></tr>
  <tr><th>个人剂量监测有效期</th><td>${e(s.snapshot?.workerDoseDueISO || '—')}（55 号令第十一条 ≤90 天）</td></tr>
</table>
<div class="sign">操作人员（签字）：____________　复核人（签字）：____________　日期：____________</div>
<div class="foot">生成：拍片单 XrayPass · ${e(todayISOStr)} · 本单为单次拍片的合规证据链底稿；受检者身份不在本单登记（最小披露），诊断资料按病历与影像系统管理</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'xraypass', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'xraypass') return { ok: false, error: '不是拍片单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.org === 'object' && s.org !== null &&
    arr(s.devices) && arr(s.workers) && arr(s.shots) &&
    arr(s.incidents) && arr(s.changes) && arr(s.duties) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
