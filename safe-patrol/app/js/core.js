/**
 * core.js — 安巡单 SafePatrol 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；
 * 学时为非负整数；所有规则参数（证照黄线天数、整改期限、年度学时红线、演练频次）
 * 都是企业可在设置中覆盖的默认值——属地规则与最新公告永远赢。
 *
 * 合规口径（全文链接与检索受限说明见 docs/14-调研来源.md）：
 * - 《安全生产法》（2021 修正）第 41 条：事故隐患排查治理情况应当如实记录并向从业人员通报；
 *   第 97 条：未如实记录/未通报、特种作业人员未取得资格证书上岗，责令限期改正处 10 万元以下罚款，
 *   逾期未改正责令停产停业整顿并处 10 万~20 万元罚款（区间为检索口径，执法以属地为准）
 * - 《工贸企业重大事故隐患判定标准》（应急管理部令第 10 号，2023-05-15 施行，已对照 mem.gov.cn 原文核验）
 *   第三条（二）：特种作业人员未按照规定经专门的安全作业培训并取得相应资格，上岗作业的——判定为重大事故隐患。
 *   本工具把这条判定标准变成动火开票前的软件闸机：无有效证件，单子开不出来
 * - 《消防法》第 21 条（通识口径）：进行电焊等具有火灾危险作业的人员必须持证上岗，并遵守消防安全操作规程
 * - 培训学时与应急演练频次（年度学时、演练周期）为通识口径的默认参数，可覆盖（检索受限见调研来源）
 * 本工具是企业侧自查与留痕台账：不构成安全评价，不替代法定报送、企业安全制度与应急预案文本。
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

/** 距目标日还有几天（负数=已过去） */
export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO);
  assertISO(todayISOStr);
  const ms = new Date(`${targetISO}T00:00:00Z`) - new Date(`${todayISOStr}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 学时：非负整数校验 */
export function assertHours(hours) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 999) {
    throw new Error(`学时必须为 1~999 的整数: ${hours}`);
  }
  return hours;
}

// ---------------------------------------------------------------------------
// 模板（内容供应链：检查项与证件种类 = 判定标准与执法高频词的小微化拆解）
// ---------------------------------------------------------------------------

/** 业态（决定检查项的默认侧重，MVP 阶段共用一套通用检查项） */
export const INDUSTRIES = {
  metal: { label: '金属加工/机械' },
  plastic: { label: '注塑塑料' },
  wood: { label: '木器家具' },
  garment: { label: '服装箱包' },
  print: { label: '纸品印刷' },
  warehouse: { label: '仓储物流' },
  other: { label: '其他工贸' },
};

/**
 * 证照种类。renewLabel = 到期后要办的事（复训/复检）。
 * - 特种作业操作证（应急线）：焊工、电工、高处、制冷——令 10 号判定标准的直接对象
 * - 特种设备作业人员证（市监线）：叉车司机 N1
 * - 特种设备定期检验（市检）：叉车定检
 * 复审/定检周期是展示口径的默认值，证件上印的「有效期至」永远赢（本工具只录有效期，不推算）。
 */
export const LICENSE_KINDS = {
  weld: { label: '焊工·熔化焊接与热切割', renew: '复训换证', scope: 'person' },
  elec: { label: '电工·低压电工作业', renew: '复训换证', scope: 'person' },
  high: { label: '高处作业', renew: '复训换证', scope: 'person' },
  refrig: { label: '制冷与空调作业', renew: '复训换证', scope: 'person' },
  forkliftCert: { label: '叉车司机证（N1）', renew: '复审换证', scope: 'person' },
  forkliftInspect: { label: '叉车定期检验', renew: '申报定检', scope: 'device' },
};

export const LICENSE_SCOPES = { person: '人员证件', device: '设备检验' };

/**
 * 动火作业种类 → 开票前必须持有的证件种类（软件闸机的映射表）。
 * weldCut：令 10 号第三条（二）+《消防法》第 21 条的直接对象——无有效焊工证，拒绝开票；
 * grindFire：打磨/切割/明火类，无强制证种映射，但开票时点名提醒（执法高频词）。
 */
export const HOTWORK_KINDS = {
  weldCut: { label: '焊割动火', requireKind: 'weld' },
  grind: { label: '打磨/切割火花作业', requireKind: null },
  fire: { label: '其他明火作业', requireKind: null },
};

/**
 * 动火安全措施清单（六项，开票必须逐项确认）。
 * 依据企业动火管理通识口径整理，参数化：企业制度永远赢。
 */
export const HOTWORK_MEASURES = [
  { key: 'clear', label: '清理作业点及周边可燃物' },
  { key: 'exting', label: '现场配备灭火器材且完好可用' },
  { key: 'guard', label: '专人监护，全程在场' },
  { key: 'equip', label: '气瓶/设备/线路完好，无破损泄漏' },
  { key: 'clean', label: '作业后现场清理' },
  { key: 'stay', label: '作业后留守确认（≥30 分钟）' },
];

/**
 * 通用自查清单（十二项）。来源：执法检查高频词 + 判定标准通用类的小微化拆解，
 * 属通识口径整理——属地检查表永远赢（可在描述中自由补充）。
 */
export const CHECK_ITEMS = {
  exit: { label: '疏散通道·安全出口畅通' },
  exting: { label: '灭火器在位·压力正常' },
  wire: { label: '电气线路无私拉乱接·无破损' },
  box: { label: '配电箱前无堆物·箱门完好' },
  chem: { label: '油漆/危化品分类存放·限量封闭' },
  guard: { label: '设备防护罩在位·急停有效' },
  special: { label: '叉车等特种设备检验·人员证件有效' },
  ppe: { label: '劳动防护用品按岗发放并佩戴' },
  train: { label: '新入职/转岗人员已培训并记录' },
  hotwork: { label: '动火作业已开票·措施已落实' },
  stack: { label: '仓库堆垛与墙柱灯距合规' },
  dorm: { label: '现场无违规住人·无吸烟' },
};

export const CHECK_RESULTS = { ok: '✅ 正常', issue: '⚠️ 有异常' };

/** 隐患等级（企业自评标签；是否构成重大事故隐患以判定标准与监管部门认定为准） */
export const HAZARD_LEVELS = { normal: '一般隐患', major: '疑似重大·立即停用上报' };

/** 隐患状态机：open（待整改）→ fixed（待复查）→ closed（销案） */
export const HAZARD_STATUS = { open: '待整改', fixed: '待复查', closed: '已销案' };

/** 演练类型 */
export const DRILL_TYPES = {
  synth: { label: '综合/专项预案演练' },
  scene: { label: '现场处置方案演练' },
};

// 默认参数（全部可在设置中覆盖；属地规则与最新公告永远赢）
export const DEFAULT_SETTINGS = {
  licenseWarnDays: 60,   // 证照黄线：距有效期 ≤60 天亮黄灯
  checkDueDays: 7,       // 自查异常默认整改期限：7 天
  annualMinHours: 8,     // 年度再培训红线：每人每年 ≥8 学时（通识口径）
  drillSynthDays: 365,   // 综合/专项预案演练周期（通识口径：每年 ≥1 次）
  drillSceneDays: 183,   // 现场处置方案演练周期（通识口径：每半年 ≥1 次）
};

export const STATE_VERSION = 1;

// ---------------------------------------------------------------------------
// 证照档案与三态引擎（把「有效期至」从抽屉里搬进日历）
// ---------------------------------------------------------------------------

function requireLicense(licenses, id) {
  const hit = (licenses ?? []).find((l) => l.id === id);
  if (!hit) throw new Error(`证件不存在: ${id}`);
  return hit;
}

export function assertLicense(l) {
  if (!l.holderName || typeof l.holderName !== 'string') throw new Error('持有人/设备名不能为空');
  if (!LICENSE_KINDS[l.kind]) throw new Error(`证件种类非法: ${l.kind}`);
  assertISO(l.expiryISO);
  return l;
}

/** 登记证件：直接录入证面「有效期至」（证面永远赢），不做周期推算 */
export function addLicense(state, { id, kind, holderName, certNo = '', expiryISO, note = '' }) {
  const license = assertLicense({ id, kind, holderName, certNo, expiryISO, note });
  state.licenses.push(license);
  return license;
}

export function removeLicense(state, id) {
  const idx = state.licenses.findIndex((l) => l.id === id);
  if (idx < 0) throw new Error(`证件不存在: ${id}`);
  // 开过动火单的证件不允许删（动火台账的证据链不能断）
  const used = (state.hotworks ?? []).some((h) => h.workerLicenseId === id);
  if (used) throw new Error('该证件已关联动火作业单，不能删除（证据链不能断）');
  state.licenses.splice(idx, 1);
}

/**
 * 证照三态：expired（已过期，红）/ warn（距有效期 ≤ 黄线，黄）/ ok（绿）。
 * 当天到期 = warn（今天还能用，明天就是红）；参数可覆盖。
 */
export function licenseLevel(expiryISO, todayISOStr = todayISO(), warnDays = DEFAULT_SETTINGS.licenseWarnDays) {
  assertISO(expiryISO);
  assertISO(todayISOStr);
  if (!Number.isInteger(warnDays) || warnDays < 1) throw new Error(`黄线天数非法: ${warnDays}`);
  const days = daysUntil(expiryISO, todayISOStr);
  if (days < 0) return 'expired';
  if (days <= warnDays) return 'warn';
  return 'ok';
}

/** 一本证件的完整视图（level + 剩余天数 + 到期后要办的事） */
export function licenseView(license, todayISOStr = todayISO(), warnDays = DEFAULT_SETTINGS.licenseWarnDays) {
  return {
    license,
    level: licenseLevel(license.expiryISO, todayISOStr, warnDays),
    daysLeft: daysUntil(license.expiryISO, todayISOStr),
    renew: LICENSE_KINDS[license.kind].renew,
  };
}

/** 证照台账按红灯在前排序（expired > warn > ok），同色按到期日升序 */
export function licenseRows(state, todayISOStr = todayISO()) {
  const rank = { expired: 0, warn: 1, ok: 2 };
  const warnDays = state.settings?.licenseWarnDays ?? DEFAULT_SETTINGS.licenseWarnDays;
  return (state.licenses ?? [])
    .map((l) => licenseView(l, todayISOStr, warnDays))
    .sort((a, b) => rank[a.level] - rank[b.level] || a.daysLeft - b.daysLeft);
}

/** 某人/某设备名下的证件（动火闸机与「人与证」页共用） */
export function licensesOf(state, holderName) {
  return (state.licenses ?? []).filter((l) => l.holderName === holderName);
}

/** 开票闸机的核心判定：持有人是否有「某证种·某日有效」的证件 */
export function hasValidLicense(state, holderName, kind, onISO = todayISO()) {
  const warnDays = state.settings?.licenseWarnDays ?? DEFAULT_SETTINGS.licenseWarnDays;
  return (state.licenses ?? []).some(
    (l) => l.holderName === holderName && l.kind === kind
      && licenseLevel(l.expiryISO, onISO, warnDays) !== 'expired',
  );
}

// ---------------------------------------------------------------------------
// 动火作业许可（令 10 号判定标准 → 开票前的软件闸机）
// ---------------------------------------------------------------------------

/**
 * 开票：{ id, dateISO, kind, worker, workerLicenseId, guardian, location, content, measures }。
 * 门禁（全部拒绝，无例外）：
 * - 证闸：weldCut 类作业，作业人必须登记在册且该证种当日未过期——无证开不出票；
 *   用过期证开票同样拒绝（这正是一次次事故的起点，也是令 10 号的红线）
 * - 措施闸：六项安全措施必须逐项确认，缺一不开
 * - 监护闸：监护人必填
 * - grind/fire 类无证种强制映射，但同走措施闸与监护闸，并在 warnings 里点名
 * 返回 warnings（不阻止的提示）。
 */
export function issueHotwork(state, p) {
  const kind = HOTWORK_KINDS[p.kind];
  if (!kind) throw new Error(`动火种类非法: ${p.kind}`);
  assertISO(p.dateISO);
  if (!p.worker || typeof p.worker !== 'string') throw new Error('作业人必填');
  if (!p.guardian || typeof p.guardian !== 'string') throw new Error('监护人必填');
  if (!p.location || typeof p.location !== 'string') throw new Error('作业地点必填');

  const warnings = [];
  let workerLicenseId = null;
  if (kind.requireKind) {
    const license = requireLicense(state.licenses, p.workerLicenseId);
    if (license.kind !== kind.requireKind) {
      throw new Error(`证种不匹配：${HOTWORK_KINDS[p.kind].label} 需要「${LICENSE_KINDS[kind.requireKind].label}」证件`);
    }
    if (license.holderName !== p.worker) {
      throw new Error(`证件持有人（${license.holderName}）与作业人（${p.worker}）不一致`);
    }
    if (licenseLevel(license.expiryISO, p.dateISO, state.settings?.licenseWarnDays) === 'expired') {
      throw new Error(`作业人的${LICENSE_KINDS[license.kind].label}证已于 ${license.expiryISO} 过期——无证动火属重大事故隐患，先复训换证，这张单开不出来`);
    }
    workerLicenseId = license.id;
    if (licenseLevel(license.expiryISO, p.dateISO, state.settings?.licenseWarnDays) === 'warn') {
      warnings.push(`作业人证件距有效期不足黄线（${license.expiryISO} 到期），尽快安排${license.renew ?? '复训'}`);
    }
  } else {
    warnings.push('该类作业无强制证种映射，请确认作业人具备相应能力并知晓动火制度');
  }

  const measures = {};
  for (const m of HOTWORK_MEASURES) {
    if (p.measures?.[m.key] !== true) throw new Error(`安全措施未全部确认：${m.label}`);
    measures[m.key] = true;
  }

  const permit = {
    id: p.id, dateISO: p.dateISO, kind: p.kind, worker: p.worker,
    workerLicenseId, guardian: p.guardian, location: p.location,
    content: p.content ?? '', measures, status: 'open', warnings,
    openedAt: new Date().toISOString(),
  };
  state.hotworks.push(permit);
  return permit;
}

/** 销票：作业结束必须销票（未销票的单子在今日台上亮灯） */
export function closeHotwork(state, { id, closedISO = todayISO(), closedNote = '' }) {
  const permit = (state.hotworks ?? []).find((h) => h.id === id);
  if (!permit) throw new Error(`动火单不存在: ${id}`);
  if (permit.status === 'closed') throw new Error('该动火单已销票');
  assertISO(closedISO);
  if (closedISO < permit.dateISO) throw new Error('销票日期不能早于作业日期');
  permit.status = 'closed';
  permit.closedISO = closedISO;
  permit.closedNote = closedNote;
  return permit;
}

/** 未销票动火单（按作业日期升序——最早的先销） */
export function openHotworks(state) {
  return (state.hotworks ?? [])
    .filter((h) => h.status === 'open')
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/** 动火台账行（倒序） */
export function hotworkRows(state) {
  return (state.hotworks ?? []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

// ---------------------------------------------------------------------------
// 隐患闭环（发现 → 整改 → 复查销案：只有闭环的隐患才有法律意义）
// ---------------------------------------------------------------------------

/**
 * 登记隐患：{ id, foundISO, desc, level, area, owner, dueISO, source }。
 * - 描述必填；整改期限 ≥ 发现日；责任人建议填但不强制（小微现实：先记下来）
 */
export function registerHazard(state, { id, foundISO = todayISO(), desc, level = 'normal', area = '', owner = '', dueISO, source = 'manual' }) {
  if (!desc || typeof desc !== 'string') throw new Error('隐患描述必填');
  assertISO(foundISO);
  if (!HAZARD_LEVELS[level]) throw new Error(`隐患等级非法: ${level}`);
  const due = dueISO ?? addDays(foundISO, state.settings?.checkDueDays ?? DEFAULT_SETTINGS.checkDueDays);
  assertISO(due);
  if (due < foundISO) throw new Error('整改期限不能早于发现日');
  const hazard = { id, foundISO, desc, level, area, owner, dueISO: due, status: 'open', source };
  state.hazards.push(hazard);
  return hazard;
}

/** 整改完成 → 待复查：open → fixed，必须留整改说明 */
export function fixHazard(state, { id, fixedISO = todayISO(), fixNote }) {
  const h = (state.hazards ?? []).find((x) => x.id === id);
  if (!h) throw new Error(`隐患不存在: ${id}`);
  if (h.status !== 'open') throw new Error(`只有「待整改」的隐患可以登记整改（当前：${HAZARD_STATUS[h.status]}）`);
  if (!fixNote || typeof fixNote !== 'string') throw new Error('整改说明必填——只打勾不留痕，台账等于没做');
  assertISO(fixedISO);
  if (fixedISO < h.foundISO) throw new Error('整改日期不能早于发现日');
  h.status = 'fixed';
  h.fixedISO = fixedISO;
  h.fixNote = fixNote;
  return h;
}

/** 复查销案：fixed → closed，必须留复查记录（隐患闭环的最后一步，也是台账的灵魂） */
export function closeHazard(state, { id, closedISO = todayISO(), recheckNote }) {
  const h = (state.hazards ?? []).find((x) => x.id === id);
  if (!h) throw new Error(`隐患不存在: ${id}`);
  if (h.status !== 'fixed') throw new Error(`只有「待复查」的隐患可以销案（当前：${HAZARD_STATUS[h.status]}）`);
  if (!recheckNote || typeof recheckNote !== 'string') throw new Error('复查记录必填');
  assertISO(closedISO);
  if (closedISO < h.foundISO) throw new Error('销案日期不能早于发现日');
  h.status = 'closed';
  h.closedISO = closedISO;
  h.recheckNote = recheckNote;
  return h;
}

/** 是否逾期：未销案且今天已过整改期限 */
export function isOverdue(hazard, todayISOStr = todayISO()) {
  return hazard.status !== 'closed' && daysUntil(hazard.dueISO, todayISOStr) < 0;
}

/** 隐患台账行（open 在前 → fixed → closed，组内按逾期/发现日排序） */
export function hazardRows(state, todayISOStr = todayISO()) {
  const rank = { open: 0, fixed: 1, closed: 2 };
  return (state.hazards ?? [])
    .map((h) => ({ hazard: h, overdue: isOverdue(h, todayISOStr) }))
    .sort((a, b) =>
      rank[a.hazard.status] - rank[b.hazard.status]
      || (a.overdue === b.overdue ? b.hazard.foundISO.localeCompare(a.hazard.foundISO) : a.overdue ? -1 : 1));
}

/** 闭环体检：闭环率 = 已销案 / 全部；未闭环逾期数 */
export function hazardSummary(state, todayISOStr = todayISO()) {
  const all = state.hazards ?? [];
  const closed = all.filter((h) => h.status === 'closed').length;
  return {
    total: all.length,
    closed,
    open: all.filter((h) => h.status === 'open').length,
    fixed: all.filter((h) => h.status === 'fixed').length,
    overdue: all.filter((h) => isOverdue(h, todayISOStr)).length,
    closeRate: all.length === 0 ? null : Math.round((closed / all.length) * 100),
  };
}

// ---------------------------------------------------------------------------
// 今日自查（30 秒走一遍：异常必须留隐患，打卡即台账）
// ---------------------------------------------------------------------------

/**
 * 提交自查：{ id, dateISO, results: {itemKey: 'ok'|'issue'}, issueDescs: {itemKey: 描述}, note }。
 * 门禁：每个「有异常」必须留文字描述——异常强制变成隐患（自动登记，期限 = 发现日 + 默认整改期），
 * 这是把「如实记录」（安法第 41 条）变成软件门禁的关键一步。
 * 返回 { check, hazards }（本次新建的隐患）。
 */
export function submitCheck(state, { id, dateISO = todayISO(), results, issueDescs = {}, note = '' }) {
  assertISO(dateISO);
  if (!results || typeof results !== 'object') throw new Error('自查结果必填');
  const items = {};
  const issues = [];
  for (const key of Object.keys(CHECK_ITEMS)) {
    const r = results[key];
    if (r === undefined) continue; // 没走到的项允许留空（当天只查了一半也如实记录）
    if (r !== 'ok' && r !== 'issue') throw new Error(`检查项结果非法: ${key}=${r}`);
    items[key] = r;
    if (r === 'issue') issues.push(key);
  }
  if (Object.keys(items).length === 0) throw new Error('至少勾选一项检查结果');
  const descs = {};
  for (const key of issues) {
    const d = issueDescs[key];
    if (!d || typeof d !== 'string') throw new Error(`「${CHECK_ITEMS[key].label}」有异常，必须写明情况——异常强制留隐患`);
    descs[key] = d;
  }
  const check = { id, dateISO, items, note, createdAt: new Date().toISOString() };
  state.checks.push(check);
  const hazards = issues.map((key) => registerHazard(state, {
    id: `${id}-${key}`,
    foundISO: dateISO,
    desc: `【自查】${CHECK_ITEMS[key].label}：${descs[key]}`,
    source: 'checklist',
    dueISO: addDays(dateISO, state.settings?.checkDueDays ?? DEFAULT_SETTINGS.checkDueDays),
  }));
  return { check, hazards };
}

/** 某日是否已自查（今日台的第一问） */
export function checkedOn(state, dateISO = todayISO()) {
  return (state.checks ?? []).some((c) => c.dateISO === dateISO);
}

/** 自查记录（倒序） */
export function checkRows(state) {
  return (state.checks ?? []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

// ---------------------------------------------------------------------------
// 培训与演练（学时红线与频次体检；参数通识口径、可覆盖）
// ---------------------------------------------------------------------------

/**
 * 登记培训：{ id, dateISO, topic, hours（整数）, attendees: [员工名] }。
 * attendees 必须是厂里在册员工（先在员工名单里，再谈学时）。
 */
export function addTraining(state, { id, dateISO, topic, hours, attendees }) {
  assertISO(dateISO);
  if (!topic || typeof topic !== 'string') throw new Error('培训主题必填');
  assertHours(hours);
  if (!Array.isArray(attendees) || attendees.length === 0) throw new Error('参训人员不能为空');
  const roster = new Set(state.staff ?? []);
  for (const name of attendees) {
    if (!roster.has(name)) throw new Error(`「${name}」不在员工名单中——先加人，再记学时`);
  }
  const training = { id, dateISO, topic, hours, attendees: [...new Set(attendees)] };
  state.trainings.push(training);
  return training;
}

/** 某员工某年度累计学时 */
export function annualHours(state, name, year) {
  if (!Number.isInteger(year)) throw new Error(`年度非法: ${year}`);
  return (state.trainings ?? [])
    .filter((t) => t.dateISO.startsWith(String(year)) && t.attendees.includes(name))
    .reduce((n, t) => n + t.hours, 0);
}

/** 学时体检：当年 0 学时与低于红线（默认 8，可覆盖）的员工点名 */
export function trainingAudit(state, year, todayISOStr = todayISO()) {
  const min = state.settings?.annualMinHours ?? DEFAULT_SETTINGS.annualMinHours;
  const isCurrentYear = todayISOStr.startsWith(String(year));
  const rows = (state.staff ?? []).map((name) => {
    const hours = annualHours(state, name, year);
    return { name, hours, level: hours === 0 ? 'zero' : hours < min ? 'short' : 'ok' };
  });
  // 当年还没过完时，0 学时只算「未开始」，不算违规——体检只在年终下结论，平时只点名
  return {
    year, minHours: min, rows,
    zero: rows.filter((r) => r.level === 'zero').map((r) => r.name),
    short: rows.filter((r) => r.level === 'short').map((r) => r.name),
    pending: isCurrentYear && rows.every((r) => r.hours === 0),
  };
}

/** 登记演练：{ id, dateISO, type: 'synth'|'scene', topic, count } */
export function addDrill(state, { id, dateISO, type, topic, count }) {
  assertISO(dateISO);
  if (!DRILL_TYPES[type]) throw new Error(`演练类型非法: ${type}`);
  if (!topic || typeof topic !== 'string') throw new Error('演练主题必填');
  if (!Number.isInteger(count) || count < 1) throw new Error(`参演人数非法: ${count}`);
  const drill = { id, dateISO, type, topic, count };
  state.drills.push(drill);
  return drill;
}

/** 演练频次体检：每类距上次演练的天数 vs 周期（默认综合 365 / 现场处置 183，可覆盖） */
export function drillAudit(state, todayISOStr = todayISO()) {
  const out = {};
  for (const type of Object.keys(DRILL_TYPES)) {
    const last = (state.drills ?? [])
      .filter((d) => d.type === type)
      .map((d) => d.dateISO)
      .sort()
      .pop() ?? null;
    const periodDays = type === 'synth'
      ? (state.settings?.drillSynthDays ?? DEFAULT_SETTINGS.drillSynthDays)
      : (state.settings?.drillSceneDays ?? DEFAULT_SETTINGS.drillSceneDays);
    const daysSince = last ? daysUntil(todayISOStr, last) : null;
    out[type] = {
      last, periodDays, daysSince,
      level: last === null ? 'none' : daysSince > periodDays ? 'overdue' : daysSince > periodDays - 30 ? 'due' : 'ok',
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 员工名单（人与证的最小结构：数组即可，不做花名册系统）
// ---------------------------------------------------------------------------

export function addStaff(state, name) {
  if (!name || typeof name !== 'string') throw new Error('姓名必填');
  if ((state.staff ?? []).includes(name)) throw new Error(`「${name}」已在名单中`);
  (state.staff ??= []).push(name);
  return name;
}

export function removeStaff(state, name) {
  const idx = (state.staff ?? []).indexOf(name);
  if (idx < 0) throw new Error(`「${name}」不在名单中`);
  const hasLicense = (state.licenses ?? []).some((l) => l.holderName === name);
  if (hasLicense) throw new Error('名下有证件登记，先删证件再删人');
  state.staff.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 今日安全台（今天做什么：三件事的优先级由红灯说了算）
// ---------------------------------------------------------------------------

export function boardSummary(state, todayISOStr = todayISO()) {
  const warnDays = state.settings?.licenseWarnDays ?? DEFAULT_SETTINGS.licenseWarnDays;
  const licenses = licenseRows(state, todayISOStr);
  const sum = hazardSummary(state, todayISOStr);
  const drill = drillAudit(state, todayISOStr);
  return {
    checked: checkedOn(state, todayISOStr),
    overdueHazards: sum.overdue,
    openHazards: sum.open + sum.fixed,
    unclosedHotworks: openHotworks(state).length,
    expiredLicenses: licenses.filter((l) => l.level === 'expired').length,
    warnLicenses: licenses.filter((l) => l.level === 'warn').length,
    drillOverdue: Object.values(drill).filter((d) => d.level === 'overdue').length,
    hazardSummary: sum,
  };
}

/** 「今天做什么」：按红灯优先级排序的三件事（最多 4 条） */
export function todayActions(state, todayISOStr = todayISO()) {
  const s = boardSummary(state, todayISOStr);
  const actions = [];
  if (s.expiredLicenses > 0) {
    actions.push(`🔴 ${s.expiredLicenses} 本证件/检验已过期：停止相关作业与驾驶，安排复训换证或申报定检`);
  }
  if (s.unclosedHotworks > 0) {
    actions.push(`🔥 ${s.unclosedHotworks} 张动火单未销票：确认现场清理与留守，完工即销票`);
  }
  if (s.overdueHazards > 0) {
    actions.push(`⏰ ${s.overdueHazards} 条隐患已逾期未销案：整改→复查→销案，闭环才算数`);
  }
  if (!s.checked) {
    actions.push('✅ 今天还没自查：30 秒走一遍十二项，异常强制留隐患');
  }
  if (s.drillOverdue > 0) {
    actions.push(`🚨 ${s.drillOverdue} 类演练已超期：补一次演练并记录`);
  }
  return actions.slice(0, 4);
}

// ---------------------------------------------------------------------------
// 迎检自证包（信任的交付物：一页纸摊开全厂安全账，三通道送达）
// ---------------------------------------------------------------------------

function licenseLines(state, todayISOStr) {
  return licenseRows(state, todayISOStr).map(({ license, level, daysLeft, renew }) => ({
    name: license.holderName,
    kind: LICENSE_KINDS[license.kind].label,
    expiry: license.expiryISO,
    level, daysLeft, renew,
    scope: LICENSE_KINDS[license.kind].scope,
  }));
}

function hazardLines(state, todayISOStr, limit = 20) {
  return hazardRows(state, todayISOStr).slice(0, limit).map(({ hazard, overdue }) => ({
    found: hazard.foundISO, desc: hazard.desc, level: HAZARD_LEVELS[hazard.level],
    owner: hazard.owner || '—', due: hazard.dueISO, status: HAZARD_STATUS[hazard.status], overdue,
    fixNote: hazard.fixNote ?? '', recheckNote: hazard.recheckNote ?? '',
  }));
}

function hotworkLines(state, limit = 20) {
  return hotworkRows(state).slice(0, limit).map((h) => ({
    date: h.dateISO, kind: HOTWORK_KINDS[h.kind].label, worker: h.worker,
    guardian: h.guardian, location: h.location, status: h.status === 'open' ? '未销票' : `已销票 ${h.closedISO ?? ''}`,
  }));
}

function trainingLines(state, limit = 10) {
  return (state.trainings ?? []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .slice(0, limit)
    .map((t) => ({ date: t.dateISO, topic: t.topic, hours: t.hours, who: t.attendees.join('、') }));
}

function drillLines(state) {
  return (state.drills ?? []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((d) => ({ date: d.dateISO, type: DRILL_TYPES[d.type].label, topic: d.topic, count: d.count }));
}

/** 体检摘要（迎检包与今日台共用）：一页纸的第一段 */
export function selfCheckDigest(state, todayISOStr = todayISO()) {
  const s = boardSummary(state, todayISOStr);
  const year = Number(todayISOStr.slice(0, 4));
  const ta = trainingAudit(state, year, todayISOStr);
  const drill = drillAudit(state, todayISOStr);
  return {
    today: todayISOStr,
    closedRate: s.hazardSummary.closeRate,
    overdueHazards: s.overdueHazards,
    openHazards: s.openHazards,
    expiredLicenses: s.expiredLicenses,
    warnLicenses: s.warnLicenses,
    unclosedHotworks: s.unclosedHotworks,
    trainingShort: ta.zero.length + ta.short.length,
    drillOverdue: s.drillOverdue,
    drillSceneOverdue: drill.scene.level === 'overdue',
    checksCount: (state.checks ?? []).length,
  };
}

/** 迎检快报文本（微信发给自己/安全员/镇街安监，主通道）。同输入同输出 */
export function selfCheckText(state, todayISOStr = todayISO()) {
  const d = selfCheckDigest(state, todayISOStr);
  const org = state.org?.name || '（未填企业名）';
  const L = [];
  L.push(`【安全生产自查快报】${org}`);
  if (state.org?.person) L.push(`安全负责人：${state.org.person}${state.org.phone ? `（${state.org.phone}）` : ''}`);
  L.push(`出具日：${d.today} · 业态：${INDUSTRIES[state.org?.industry ?? 'other']?.label ?? '其他工贸'}`);
  L.push('');
  L.push('一、账本体检');
  L.push(`  - 隐患：累计 ${(state.hazards ?? []).length} 条 · 闭环率 ${d.closedRate === null ? '—' : `${d.closedRate}%`} · 逾期未销案 ${d.overdueHazards} 条`);
  L.push(`  - 证照：过期 ${d.expiredLicenses} 本 · 黄灯 ${d.warnLicenses} 本`);
  L.push(`  - 动火：未销票 ${d.unclosedHotworks} 张`);
  L.push(`  - 培训：学时不达标 ${d.trainingShort} 人（红线 ${state.settings?.annualMinHours ?? DEFAULT_SETTINGS.annualMinHours} 学时/年）`);
  L.push(`  - 演练：超期 ${d.drillOverdue} 类`);
  L.push(`  - 自查打卡：累计 ${d.checksCount} 次`);
  const expired = licenseLines(state, todayISOStr).filter((l) => l.level === 'expired');
  if (expired.length) {
    L.push('');
    L.push('二、过期证件点名');
    for (const l of expired) L.push(`  - ${l.name} · ${l.kind}：${l.expiry} 已过期 → ${l.renew}`);
  }
  const overdue = hazardLines(state, todayISOStr, 5).filter((h) => h.overdue);
  if (overdue.length) {
    L.push('');
    L.push('三、逾期隐患点名（前 5 条）');
    for (const h of overdue) L.push(`  - ${h.found} ${h.desc}（期限 ${h.due}）`);
  }
  L.push('');
  L.push('本快报为企业安全生产自查底账摘要，不替代法定报送、企业安全制度与应急预案文本，不构成安全评价。');
  L.push(`生成：安巡单 SafePatrol · ${d.today}`);
  return L.join('\n');
}

/** 迎检自证包打印版：单文件 HTML（内联样式、签字栏，无外部资源） */
export function selfCheckHtml(state, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const d = selfCheckDigest(state, todayISOStr);
  const org = state.org ?? {};
  const licRows = licenseLines(state, todayISOStr).map((l) => {
    const mark = l.level === 'expired' ? '🔴 过期' : l.level === 'warn' ? `🟡 ${l.daysLeft}天` : `🟢 ${l.daysLeft}天`;
    return `<tr><td>${e(l.name)}</td><td>${e(l.scope)}</td><td>${e(l.kind)}</td><td>${e(l.expiry)}</td><td>${e(mark)}</td><td>${e(l.renew)}</td></tr>`;
  }).join('') || '<tr><td colspan="6">（无登记证件）</td></tr>';
  const hzRows = hazardLines(state, todayISOStr).map((h) => `<tr><td>${e(h.found)}</td><td>${e(h.desc)}</td><td>${e(h.level)}</td><td>${e(h.owner)}</td><td>${e(h.due)}${h.overdue ? ' ⚠️逾期' : ''}</td><td>${e(h.status)}</td><td>${e(h.status === '已销案' ? h.recheckNote : h.fixNote)}</td></tr>`).join('')
    || '<tr><td colspan="7">（无登记隐患）</td></tr>';
  const hwRows = hotworkLines(state).map((h) => `<tr><td>${e(h.date)}</td><td>${e(h.kind)}</td><td>${e(h.worker)}</td><td>${e(h.guardian)}</td><td>${e(h.location)}</td><td>${e(h.status)}</td></tr>`).join('')
    || '<tr><td colspan="6">（无动火作业）</td></tr>';
  const trRows = trainingLines(state).map((t) => `<tr><td>${e(t.date)}</td><td>${e(t.topic)}</td><td>${t.hours} 学时</td><td>${e(t.who)}</td></tr>`).join('')
    || '<tr><td colspan="4">（无培训记录）</td></tr>';
  const drRows = drillLines(state).map((x) => `<tr><td>${e(x.date)}</td><td>${e(x.type)}</td><td>${e(x.topic)}</td><td>${x.count} 人</td></tr>`).join('')
    || '<tr><td colspan="4">（无演练记录）</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>安全生产自查台账 · ${e(org.name ?? '')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { color: #555; font-weight: 500; white-space: nowrap; }
  .digest { background: #f6f7f5; border: 1px solid #ddd; padding: 8px 10px; font-size: 12.5px; margin: 8px 0; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>安全生产自查台账 · ${e(org.name ?? '')}</h1>
<div class="meta">安全负责人：${e(org.person ?? '')}${org.phone ? `（${e(org.phone)}）` : ''} · 业态：${e(INDUSTRIES[org.industry ?? 'other']?.label ?? '其他工贸')} · 出具日 ${e(d.today)}</div>
<div class="digest">账本体检：隐患闭环率 ${d.closedRate === null ? '—' : d.closedRate + '%'} · 逾期未销案 ${d.overdueHazards} 条 · 证照过期 ${d.expiredLicenses} 本/黄灯 ${d.warnLicenses} 本 · 动火未销票 ${d.unclosedHotworks} 张 · 培训学时不达标 ${d.trainingShort} 人 · 演练超期 ${d.drillOverdue} 类 · 自查打卡 ${d.checksCount} 次</div>
<h2>一、人员与设备证照状态</h2>
<table><tr><th>持有人/设备</th><th>类别</th><th>证种</th><th>有效期至</th><th>状态</th><th>到期办理</th></tr>${licRows}</table>
<h2>二、隐患排查治理台账（最近 20 条）</h2>
<table><tr><th>发现日</th><th>描述</th><th>等级</th><th>责任人</th><th>期限</th><th>状态</th><th>整改/复查记录</th></tr>${hzRows}</table>
<h2>三、动火作业台账（最近 20 条）</h2>
<table><tr><th>日期</th><th>种类</th><th>作业人</th><th>监护人</th><th>地点</th><th>销票</th></tr>${hwRows}</table>
<h2>四、安全教育培训记录（最近 10 条）</h2>
<table><tr><th>日期</th><th>主题</th><th>学时</th><th>参训人员</th></tr>${trRows}</table>
<h2>五、应急演练记录</h2>
<table><tr><th>日期</th><th>类型</th><th>主题</th><th>参演</th></tr>${drRows}</table>
<p class="meta">本台账为企业安全生产自查底账（隐患排查治理情况如实记录口径，《安全生产法》第 41 条），不替代法定报送、企业安全制度与应急预案文本，不构成安全评价；隐患等级为企业自评标签，是否构成重大事故隐患以《工贸企业重大事故隐患判定标准》及监管部门认定为准。</p>
<div class="sign">安全负责人（签字）：____________　企业（盖章）：____________　日期：____________</div>
<div class="foot">生成：安巡单 SafePatrol · ${e(d.today)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 安全员备份）
// ---------------------------------------------------------------------------

export function exportBundle(state) {
  return JSON.stringify({ app: 'safepatrol', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'safepatrol') return { ok: false, error: '不是安巡单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.org === 'object' && s.org !== null &&
    arr(s.licenses) && arr(s.hotworks) && arr(s.hazards) && arr(s.checks) &&
    arr(s.trainings) && arr(s.drills) && arr(s.staff) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
