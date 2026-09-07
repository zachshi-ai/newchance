/**
 * core.js — 秤平账 FairScale 纯域逻辑（零依赖、可单测）
 *
 * 全部法定口径锚定（均为一手全文核验，出处见 docs/14）：
 *  ·《集贸市场计量监督管理办法》（国家市场监督管理总局令第94号，2024-12-04 公布，
 *    2025-03-01 施行，截至 2026-09 未修订，同时废止 2002 年旧办法）——
 *    集市主办者九项义务（第5条：管理制度/核验公示/入场协议/计量管理员/登记造册备案/
 *    公平秤/制止作弊/诚信承诺/纠纷处理）、配备与督促检查（第6条）、红黄牌警示与清退
 *    （第7条）、鼓励数字化升级（第8条）、经营者八项义务（第9条：强检送检/不得使用超期
 *    未检或作弊器具/明示计量过程/计量偏差在法定范围内）、短秤缺量先行赔偿与追偿、
 *    作弊秤欺诈适用消保法第55条（第12条）、主办者罚则三档 1万/5万/10万（第13条）、
 *    经营者罚则转介（第14条）、作弊功能计量器具定义（第16条）。
 *  ·《计量法》（2018 修正）第9条（强检）、第27条（以欺骗消费者为目的的计量器具：
 *    没收+罚款+刑责）。
 *  ·《计量法实施细则》第43条（强检器具未申请检定/不合格继续使用：责令停止使用，
 *    可并处 1000 元以下罚款）、第46条（破坏准确度/伪造数据：赔偿+没收+2000 元以下）、
 *    第48条（作弊器具：没收+全部违法所得+2000 元以下+刑责）。
 *  ·《消费者权益保护法》第55条：欺诈→增加赔偿为价款三倍，不足 500 元按 500 元。
 *  ·《消费者权益保护法实施条例》（国务院令第778号，2024-07-01 施行）第13条
 *    （柜台/场地出租者场内经营管理制度）、第50条（罚则转介——办法第13条1款引用）。
 *  ·《零售商品称重计量监督管理办法》（原质检总局、工商总局令第66号公布，总局令第31号
 *    2020 修订）第5/6条与附表1——负偏差四档价格档×称重范围；三种核称法（原计量器具
 *    核称/高准确度核称：差值不超负偏差；等准确度核称：差值不超负偏差 2 倍）。
 *    注：活禽、活鱼、水发物除外。
 *  · 强制检定：用于贸易结算的电子秤属强检工作计量器具（JJG 539-2016《数字指示秤
 *    检定规程》：检定周期一般不超过 1 年；各地市监口径统一为 1 年）。
 *  ·《商品量计量违法行为处罚规定》第5条（结算值与实际值不符超负偏差：责令改正+
 *    3 万元以下罚款）、第6条（无负偏差规定商品：2 万元以下）。
 *
 * 属地实施口径永远赢；所有周期与阈值均为可覆盖参数——工具亮灯提示不替代备案、
 * 检定、调解、处罚等法定动作与执法认定。
 */

/* ---------------------------------------------------------------- 时间工具 */

export function assertISO(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`日期必须为 YYYY-MM-DD，收到：${iso}`);
  }
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`非法日期：${iso}`);
  return iso;
}

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso, n) {
  assertISO(iso);
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

/** 加 N 个月，月末钳制（1-31 加 12 个月落在平月时收回到 2-28） */
export function addMonthsISO(iso, n) {
  assertISO(iso);
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO); assertISO(todayISOStr);
  const a = new Date(`${targetISO}T00:00:00`);
  const b = new Date(`${todayISOStr}T00:00:00`);
  return Math.round((a - b) / 86400000);
}

export function monthKey(iso) {
  assertISO(iso);
  return iso.slice(0, 7);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ------------------------------------------------------------ 口径与常量 */

export const DEFAULT_SETTINGS = {
  certWarnDays: 60,        // 强检钟黄线（通识先验，属地永远赢）
  certRedDays: 15,         // 强检钟红线（临期告急）
  verifyMonths: 12,        // 强检周期（JJG 539-2016：一般不超过 1 年；属地口径永远赢）
  fairWarnDays: 1,         // 公平秤日检宽限（昨日已核=临期；更早/从未=红灯）
  patrolDays: 7,           // 巡查周期（工具口径——办法第5条(七)「发现」义务的落实节奏，属地永远赢）
  complaintDays: 7,        // 投诉处置时限（第5条(九)「及时处理」的工具化口径，属地永远赢）
  ledgerAuditDays: 90,     // 登记造册盘点与备案更新（第5条(五)「及时更新」的工具化节奏）
  adminTrainingDays: 365,  // 计量管理员培训（第5条(四)）
  agreementAuditDays: 365, // 入场协议计量条款审查（第5条(三)）
  promiseOrgDays: 365,     // 诚信计量自我承诺组织（第5条(八)）
  verifyPlanDays: 365,     // 年度强检计划与配合检定（第5条(五)）
};

/** 计量器具角色（办法第2/5条(五)/第5条(六)） */
export const SCALE_ROLE = {
  trade: '场内经营用秤（贸易结算 · 强检）',
  fair: '公平秤（公平复核 · 强检 + 保管维护监督检查）',
};

export const SCALE_STATUS = {
  active: '在用',
  suspended: '停用（报备留痕）',
  gone: '已撤场（报备留痕）',
};

/** 变动报备情形（办法第9条(二)：新增、减少、更换、维修应当及时报备/更新登记） */
export const SCALE_CHANGES = {
  add: '新增',
  remove: '减少',
  replace: '更换',
  repair: '维修',
};

/** 零售商品负偏差附表1（总局令第31号 2020 修订 · 附表1；活禽、活鱼、水发物除外）
 *  四档价格档 × 称重范围。单位：克。 */
export const DEVIATION_TABLE = {
  low: {
    label: '粮食、蔬菜、水果或不高于 6 元/kg 的食品',
    bands: [
      { max: 1, g: 20 }, { max: 2, g: 40 }, { max: 4, g: 80 }, { max: Infinity, g: 100 },
    ],
  },
  mid: {
    label: '肉、蛋、禽、海（水）产品、糕点、糖果、调味品，或高于 6 元/kg 但不高于 30 元/kg 的食品',
    bands: [
      { max: 2.5, g: 5 }, { max: 10, g: 10 }, { max: Infinity, g: 15 },
    ],
  },
  high: {
    label: '干菜、山（海）珍品，或高于 30 元/kg 但不高于 100 元/kg 的食品',
    bands: [
      { max: 1, g: 2 }, { max: 4, g: 4 }, { max: Infinity, g: 6 },
    ],
  },
  premium: {
    label: '高于 100 元/kg 的食品',
    bands: [
      { max: 0.5, g: 1 }, { max: 2, g: 2 }, { max: Infinity, g: 3 },
    ],
  },
};

/** 核称法（办法附表原文第6条）：等准确度核称时判定线放宽到负偏差的 2 倍 */
export const RECHECK_METHOD = {
  same: { label: '原器具核称 / 高准确度器具核称', multiplier: 1 },
  equal: { label: '等准确度器具核称', multiplier: 2 },
};

/** 红黄牌（办法第7条：违法失信经营者红黄牌警示制度并公示） */
export const CARD_META = {
  yellow: { label: '黄牌警示', active: true },
  red: { label: '红牌（整改/公示/报市场监管部门）', active: true },
  lifted: { label: '已摘牌', active: false },
};

/** 投诉处置（第12条） */
export const COMPLAINT_STATUS = {
  received: '已受理 · 待公平秤复核',
  weighed: '已复核 · 待处置',
  resolved: '已处置 · 待闭环',
  advanced: '主办者已先行赔偿 · 待向经营者追偿',
  recovered: '已追偿 · 闭环',
  dismissed: '复核未超差 · 已向消费者解释（留痕）',
  closed: '闭环',
};

export const DUTY_KINDS = {
  ledgerAudit:   { label: '强检台账盘点与备案更新（登记造册向市监部门备案）', cycleKey: 'ledgerAuditDays', basis: '办法第5条(五)' },
  adminTraining: { label: '计量管理人员计量业务培训', cycleKey: 'adminTrainingDays', basis: '办法第5条(四)' },
  agreementAudit:{ label: '入场经营协议计量条款与违约责任审查', cycleKey: 'agreementAuditDays', basis: '办法第5条(三)' },
  promiseOrg:    { label: '组织经营者诚信计量自我承诺', cycleKey: 'promiseOrgDays', basis: '办法第5条(八)' },
  verifyPlan:    { label: '年度强检计划编制与配合检定', cycleKey: 'verifyPlanDays', basis: '办法第5条(五) · 计量法第9条' },
};

export const REJECT_REASONS = {
  NO_SCALE: '器具不存在或已不在用',
  NO_COMPLAINT: '投诉不存在',
  BAD_NUMBER: '数值必须为非负数',
  NO_UNIT_PRICE: '必须填写商品单价（元/kg）——负偏差档位与赔偿计算都依赖它',
  NOT_RECEIVED: '投诉不在「已受理」状态',
  NOT_WEIGHED: '投诉尚未完成公平秤复核',
  NOT_RESOLVED_OR_ADVANCED: '投诉不在「已处置/已先行赔偿」状态',
  NOT_ADVANCED: '该投诉不是「主办者先行赔偿」状态，无需追偿',
  ALREADY_RECOVERED: '该投诉已追偿闭环，不可重复',
  ALREADY_WEIGHED: '该投诉已复核，不可重复复核',
  NOT_DISMISSIBLE: '复核已判定短秤缺量超差的投诉不可「解释结案」——必须处置或先行赔偿（第12条）',
  CLOSED_TWICE: '该投诉已闭环，不可重复操作',
  CARD_LIFTED: '该红黄牌已摘牌，不可重复摘牌',
  NO_MEASURE: '处置措施必填',
  BAD_BAND: '未知商品价格档',
  BAD_METHOD: '未知核称法',
};

const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/* ---------------------------------------------------- 复秤判定引擎（USP） */

/**
 * 负偏差查表（附表1）：价格档 + 称重范围 → 法定负偏差（克）。
 * 边界按原文：如 mid 档 m≤2.5kg→5g、2.5<m≤10kg→10g、m>10kg→15g。
 */
export function negativeDeviation(band, weightKg) {
  const meta = DEVIATION_TABLE[band];
  if (!meta) throw new Error(REJECT_REASONS.BAD_BAND);
  const w = num(weightKg);
  if (!Number.isFinite(w) || w <= 0) throw new Error('称重范围必须为正数（kg）');
  const row = meta.bands.find((b) => w <= b.max) || meta.bands[meta.bands.length - 1];
  return { band, bandLabel: meta.label, weightKg: w, limitG: row.g };
}

/**
 * 复秤判定（第6条三种核称法 + 附表1）：
 *  · same（原器具核称/高准确度核称）：|结算值 − 实际值| > 负偏差 → 超差
 *  · equal（等准确度核称）：差值 > 2 × 负偏差 → 超差
 * 返回 { excess, diffG, settleKg, actualKg, limitG, multiplier, bandLabel, methodLabel }
 * diffG > 0 = 结算值大于实际值（短秤缺量方向）；< 0 = 多给了。
 */
export function verifyWeigh({ band, settleKg, actualKg, method = 'same' }) {
  const m = RECHECK_METHOD[method];
  if (!m) throw new Error(REJECT_REASONS.BAD_METHOD);
  const s = num(settleKg); const a = num(actualKg);
  if (!Number.isFinite(s) || s <= 0) throw new Error('结算重量必须为正数（kg）');
  if (!Number.isFinite(a) || a < 0) throw new Error(REJECT_REASONS.BAD_NUMBER);
  const dev = negativeDeviation(band, s);
  const diffG = Math.round((s - a) * 1000);
  const limit = dev.limitG * m.multiplier;
  return {
    ...dev, settleKg: s, actualKg: a, diffG, method, methodLabel: m.label,
    multiplier: m.multiplier, allowedG: limit, excess: diffG > limit,
  };
}

/**
 * 消保法第55条欺诈赔偿计算器（办法第12条2款：作弊秤构成欺诈→适用 55 条）：
 *  · 退还差价 = 单价 ×（结算重量 − 实际重量）（短秤方向；向上取整到分）
 *  · 惩罚性赔偿 = max(500, 3 × 价款)（价款 = 单价 × 结算重量）
 * 返回 { pricePaid, refundDiff, punitive, total } —— 执法与司法认定以有权机关为准。
 */
export function compensation55({ unitPrice, settleKg, actualKg }) {
  const p = num(unitPrice);
  if (!Number.isFinite(p) || p <= 0) throw new Error(REJECT_REASONS.NO_UNIT_PRICE);
  const s = num(settleKg); const a = num(actualKg);
  if (!Number.isFinite(s) || s <= 0) throw new Error('结算重量必须为正数（kg）');
  if (!Number.isFinite(a) || a < 0) throw new Error(REJECT_REASONS.BAD_NUMBER);
  const pricePaid = Math.round(p * s * 100) / 100;
  const overpay = Math.max(0, Math.round(p * (s - a) * 100) / 100);
  const punitive = Math.max(500, Math.round(3 * pricePaid * 100) / 100);
  return { unitPrice: p, settleKg: s, actualKg: a, pricePaid, refundDiff: overpay, punitive, total: Math.round((overpay + punitive) * 100) / 100 };
}

/* ------------------------------------------------------------ 强检钟 */

export function certLevel(days, settings = DEFAULT_SETTINGS) {
  if (days < 0) return 'expired';
  if (days <= settings.certRedDays) return 'red';
  if (days <= settings.certWarnDays) return 'warn';
  return 'ok';
}

/** 强检到期日 = 检定日期 + 检定周期（默认 12 个月，属地口径可覆盖） */
export function verifyDue(verifiedISO, settings = DEFAULT_SETTINGS) {
  assertISO(verifiedISO);
  return addMonthsISO(verifiedISO, Math.round((settings.verifyMonths ?? 12)));
}

/** 一秤一钟：登记造册缺项（缺检定证书号/缺强检标志）→ warn；超期 → expired */
export function scaleClock(scale, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  assertISO(todayISOStr);
  if (scale.status !== 'active') {
    return { key: 'verify', label: '强检钟', level: 'ok', dueISO: '', days: null,
      detail: SCALE_STATUS[scale.status], basis: '办法第5条(五)登记造册' };
  }
  if (!scale.verifiedISO) {
    return { key: 'verify', label: '强检钟', level: 'expired', dueISO: '', days: null, missing: true,
      detail: '无检定记录——未经检定合格不得使用（办法第9条(三)；细则第43条：责令停止使用+1000元以下罚款）',
      basis: '计量法第9条 · JJG 539-2016' };
  }
  const due = verifyDue(scale.verifiedISO, settings);
  const days = daysUntil(due, todayISOStr);
  const level = certLevel(days, settings);
  const noSticker = !scale.stickerAffixed;
  return {
    key: 'verify', label: '强检钟', dueISO: due, days, level: level === 'ok' && noSticker ? 'warn' : level,
    detail: `${scale.verifiedISO} 检定${noSticker ? ' · 强检合格标志未确认粘贴' : ''}`,
    basis: '办法第5条(五)/第9条(三) · JJG 539-2016 周期≤1年',
  };
}

export function scaleRed(scale, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  const c = scaleClock(scale, todayISOStr, settings);
  return c.level === 'expired' || c.level === 'red';
}

/** 登记造册缺项（第5条(五)：登记造册要能当备案清单用——缺证书号/缺标志=缺项） */
export function scaleLedgerGaps(scale) {
  if (scale.status !== 'active') return [];
  const gaps = [];
  if (!String(scale.certNo || '').trim()) gaps.push('缺检定证书号');
  if (!scale.stickerAffixed) gaps.push('强检标志未确认');
  return gaps;
}

/* ------------------------------------------------------------ 档案：器具 */

export function addScale(state, { role = 'trade', stall = '', vendor = '', vendorPhone = '', type = '电子计价秤', brand = '', model = '', capacityKg = null, divisionG = null, certNo = '', verifiedISO = '', stickerAffixed = false, note = '' }) {
  if (!stall || !String(stall).trim()) throw new Error('摊位号必填（公平秤填「公平秤」及位置）');
  if (role === 'trade' && !String(vendor).trim()) throw new Error('经营者名称必填（办法第5条(一)：核验、更新、公示经营者信息）');
  const scale = {
    id: `s${++state.seq.scale}`, role, stall: String(stall).trim(), vendor: String(vendor).trim(),
    vendorPhone: String(vendorPhone).trim(), type: String(type).trim(), brand: String(brand).trim(), model: String(model).trim(),
    capacityKg: capacityKg === null || capacityKg === '' ? null : num(capacityKg),
    divisionG: divisionG === null || divisionG === '' ? null : num(divisionG),
    certNo: String(certNo).trim(), verifiedISO: verifiedISO || '', stickerAffixed: !!stickerAffixed,
    status: 'active', addedISO: todayISO(), note: String(note).trim(),
  };
  state.scales.push(scale);
  return scale;
}

export function updateScale(state, scaleId, patch = {}) {
  const scale = state.scales.find((s) => s.id === scaleId);
  if (!scale) throw new Error(REJECT_REASONS.NO_SCALE);
  const allowed = ['stall', 'vendor', 'vendorPhone', 'type', 'brand', 'model', 'certNo', 'verifiedISO', 'note'];
  for (const k of allowed) {
    if (patch[k] !== undefined) scale[k] = String(patch[k]).trim();
  }
  if (patch.stickerAffixed !== undefined) scale.stickerAffixed = patch.stickerAffixed === true;
  return scale;
}

/** 器具变动报备（第9条(二)：新增、减少、更换、维修应当及时更新登记信息） */
export function recordScaleChange(state, scaleId, change, { dateISO = todayISO(), note = '' } = {}) {
  if (!SCALE_CHANGES[change]) throw new Error(`未知变动情形：${change}`);
  const scale = state.scales.find((s) => s.id === scaleId);
  if (!scale) throw new Error(REJECT_REASONS.NO_SCALE);
  assertISO(dateISO);
  const log = { id: `c${++state.seq.change}`, scaleId, change, dateISO, note: String(note).trim() };
  state.changes.push(log);
  if (change === 'remove') scale.status = 'gone';
  if (change === 'replace' || change === 'repair') {
    // 更换/维修后必须重新检定才能继续用——旧钟作废，等新检定日期
    scale.verifiedISO = '';
    scale.stickerAffixed = false;
    if (change === 'replace') scale.status = 'suspended';
  }
  return log;
}

export function resumeScale(state, scaleId, { verifiedISO, certNo = '', stickerAffixed = false }) {
  const scale = state.scales.find((s) => s.id === scaleId);
  if (!scale) throw new Error(REJECT_REASONS.NO_SCALE);
  if (scale.status === 'gone') throw new Error('已撤场器具不可恢复使用——请新增登记');
  assertISO(verifiedISO);
  scale.status = 'active';
  scale.verifiedISO = verifiedISO;
  scale.certNo = String(certNo).trim() || scale.certNo;
  scale.stickerAffixed = stickerAffixed === true;
  return scale;
}

/* ------------------------------------------------------------ 公平秤日检 */

/** 当日公平秤核查（第5条(六)：保管、维护和监督检查，保证量值准确——工具化为按日核账） */
export function logFairCheck(state, { scaleId, dateISO = todayISO(), ok = true, note = '' }) {
  const scale = state.scales.find((s) => s.id === scaleId && s.role === 'fair');
  if (!scale) throw new Error('公平秤不存在——先在「秤档」以公平秤角色登记');
  assertISO(dateISO);
  const rec = { id: `q${++state.seq.fair}`, scaleId, dateISO, ok: ok === true, note: String(note).trim() };
  state.fairLogs.push(rec);
  return rec;
}

/** 公平秤日检状态：当日已核=ok；昨日已核=warn；更早/从未=red */
export function fairDailyLevel(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  const fairScales = state.scales.filter((s) => s.role === 'fair' && s.status === 'active');
  if (!fairScales.length) return { level: 'red', detail: '未配置在用公平秤（第5条(六)）', lastISO: '' };
  let lastISO = '';
  let badNote = '';
  for (const s of fairScales) {
    const last = state.fairLogs
      .filter((q) => q.scaleId === s.id)
      .reduce((m, q) => (q.dateISO > m ? q.dateISO : m), '');
    if (!last || last < addDays(todayISOStr, -1)) {
      return { level: 'red', detail: `公平秤（${s.stall}）${last ? `最近核查 ${last}` : '从未核查'}——按日核账中断`, lastISO: last };
    }
    if (last < todayISOStr) { if (!badNote) badNote = `公平秤（${s.stall}）今日未核（昨日已核）`; }
    if (last > lastISO) lastISO = last;
  }
  return badNote
    ? { level: 'warn', detail: badNote, lastISO }
    : { level: 'ok', detail: '当日已核', lastISO };
}

/* ------------------------------------------------------------ 巡查（第5条(七)） */

export function logPatrol(state, { dateISO = todayISO(), stallsChecked = 0, finds = [], note = '' }) {
  assertISO(dateISO);
  const n = num(stallsChecked);
  if (!Number.isFinite(n) || n < 0) throw new Error(REJECT_REASONS.BAD_NUMBER);
  for (const f of finds) {
    if (!f?.problem || !String(f.problem).trim()) throw new Error('发现问题必须写明问题');
  }
  const patrol = {
    id: `r${++state.seq.patrol}`, dateISO, stallsChecked: n,
    finds: finds.map((f) => ({ stall: String(f.stall || '').trim(), problem: String(f.problem).trim(), measure: String(f.measure || '').trim() })),
    note: String(note).trim(),
  };
  state.patrols.push(patrol);
  return patrol;
}

export function patrolState(state, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  assertISO(todayISOStr);
  const last = state.patrols.reduce((m, p) => (p.dateISO > m ? p.dateISO : m), '');
  if (!last) return { lastISO: '', daysOver: null, level: 'red', detail: '从未巡查（第5条(七)发现义务）' };
  const daysOver = -(daysUntil(last, todayISOStr)) - (settings.patrolDays ?? 7);
  return {
    lastISO: last, daysOver,
    level: daysOver > 0 ? 'red' : daysOver >= -2 ? 'warn' : 'ok',
    detail: daysOver > 0 ? `最近巡查 ${last}，已超周期 ${daysOver} 天` : `最近巡查 ${last}（剩 ${-daysOver} 天到周期）`,
  };
}

/* ------------------------------------------------------------ 红黄牌（第7条） */

export function issueCard(state, { stall, vendor = '', color = 'yellow', reason, issuedISO = todayISO(), note = '' }) {
  if (!stall || !String(stall).trim()) throw new Error('摊位号必填');
  if (!CARD_META[color] || color === 'lifted') throw new Error('牌色必须为 yellow 或 red');
  if (!reason || !String(reason).trim()) throw new Error('警示事由必填（公示与违约追责都要能对上）');
  assertISO(issuedISO);
  const card = {
    id: `d${++state.seq.card}`, stall: String(stall).trim(), vendor: String(vendor).trim(), color,
    reason: String(reason).trim(), issuedISO, liftedISO: '', status: color, note: String(note).trim(),
  };
  state.cards.push(card);
  return card;
}

export function liftCard(state, cardId, { liftedISO = todayISO(), note = '' } = {}) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) throw new Error('红黄牌不存在');
  if (card.status === 'lifted') throw new Error(REJECT_REASONS.CARD_LIFTED);
  assertISO(liftedISO);
  card.status = 'lifted';
  card.liftedISO = liftedISO;
  card.liftNote = String(note).trim();
  return card;
}

export function activeCards(state, color = null) {
  return state.cards.filter((c) => c.status !== 'lifted' && (color ? c.color === color : true));
}

/* ------------------------------------------------------------ 投诉与先行赔偿（第12条） */

export function createComplaint(state, { dateISO = todayISO(), stall, vendor = '', commodity = '', band, unitPrice = null, settleKg = null, note = '' }) {
  if (!stall || !String(stall).trim()) throw new Error('被投诉摊位必填');
  if (!DEVIATION_TABLE[band]) throw new Error('请选择商品价格档（决定法定负偏差）');
  assertISO(dateISO);
  const c = {
    id: `t${++state.seq.complaint}`, dateISO, stall: String(stall).trim(), vendor: String(vendor).trim(),
    commodity: String(commodity).trim(), band,
    unitPrice: unitPrice === null || unitPrice === '' ? null : num(unitPrice),
    settleKg: settleKg === null || settleKg === '' ? null : num(settleKg),
    actualKg: null, verdict: null, verify: null, compensation: null,
    mode: '', advancedISO: '', recoveredISO: '', closedISO: '', closeNote: '',
    status: 'received', note: String(note).trim(),
  };
  state.complaints.push(c);
  return c;
}

/** 公平秤复核：判定超差与否 + 55 条赔偿测算（unitPrice 仅供测算，缺省可后补） */
export function recheckComplaint(state, complaintId, { actualKg, method = 'same', recheckedISO = todayISO(), unitPrice = null } = {}) {
  const c = state.complaints.find((x) => x.id === complaintId);
  if (!c) throw new Error(REJECT_REASONS.NO_COMPLAINT);
  if (c.status !== 'received') throw new Error(REJECT_REASONS.ALREADY_WEIGHED);
  if (c.status === 'closed') throw new Error(REJECT_REASONS.CLOSED_TWICE);
  const v = verifyWeigh({ band: c.band, settleKg: c.settleKg, actualKg, method });
  c.actualKg = v.actualKg;
  c.verify = v;
  c.verdict = v.excess ? 'excess' : 'ok';
  c.recheckedISO = recheckedISO;
  const price = unitPrice === null || unitPrice === '' ? c.unitPrice : num(unitPrice);
  if (price !== null && Number.isFinite(price) && price > 0 && v.excess) {
    c.compensation = compensation55({ unitPrice: price, settleKg: v.settleKg, actualKg: v.actualKg });
  }
  c.status = 'weighed';
  return c;
}

/**
 * 处置（复核超差后）：refund 补足/退赔（经营者当场履行）、advance 主办者先行赔偿
 * （第12条：经营者租赁期满等情形，主办者赔偿后追偿）、dismiss 仅限复核未超差。
 */
export function resolveComplaint(state, complaintId, { mode, measure, resolvedISO = todayISO(), note = '' }) {
  const c = state.complaints.find((x) => x.id === complaintId);
  if (!c) throw new Error(REJECT_REASONS.NO_COMPLAINT);
  if (c.status !== 'weighed') throw new Error(REJECT_REASONS.NOT_WEIGHED);
  if (!measure || !String(measure).trim()) throw new Error(REJECT_REASONS.NO_MEASURE);
  assertISO(resolvedISO);
  if (c.verdict === 'excess') {
    if (!['refund', 'advance'].includes(mode)) throw new Error('短秤缺量已坐实：mode 必须为 refund（经营者退赔）或 advance（主办者先行赔偿）');
  } else if (mode !== 'dismiss') {
    throw new Error('复核未超差的投诉应选择 dismiss（向消费者解释并留痕）');
  }
  c.mode = mode;
  c.measure = String(measure).trim();
  c.resolvedISO = resolvedISO;
  if (mode === 'advance') c.status = 'advanced';
  else if (mode === 'dismiss') c.status = 'dismissed';
  else c.status = 'resolved';
  c.closeNote = String(note).trim();
  return c;
}

/** 先行赔偿后的追偿闭环（第12条：主办者赔偿后有权向经营者追偿） */
export function recoverComplaint(state, complaintId, { recoveredISO = todayISO(), note = '' } = {}) {
  const c = state.complaints.find((x) => x.id === complaintId);
  if (!c) throw new Error(REJECT_REASONS.NO_COMPLAINT);
  if (c.recoveredISO) throw new Error(REJECT_REASONS.ALREADY_RECOVERED);
  if (c.status !== 'advanced') throw new Error(REJECT_REASONS.NOT_ADVANCED);
  assertISO(recoveredISO);
  c.recoveredISO = recoveredISO;
  c.recoverNote = String(note).trim();
  c.status = 'recovered';
  c.closedISO = recoveredISO;
  return c;
}

export function closeComplaint(state, complaintId, { closedISO = todayISO(), note = '' } = {}) {
  const c = state.complaints.find((x) => x.id === complaintId);
  if (!c) throw new Error(REJECT_REASONS.NO_COMPLAINT);
  if (!['resolved', 'dismissed', 'recovered'].includes(c.status)) throw new Error(REJECT_REASONS.NOT_RESOLVED_OR_ADVANCED);
  if (c.closedISO) throw new Error(REJECT_REASONS.CLOSED_TWICE);
  assertISO(closedISO);
  c.closedISO = closedISO;
  c.closeNote = String(note || c.closeNote).trim();
  if (c.status === 'resolved' || c.status === 'dismissed') c.status = 'closed';
  return c;
}

/** 投诉是否超处置时限（第5条(九)「及时处理」的工具化口径） */
export function complaintOverdue(c, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  assertISO(todayISOStr);
  if (['recovered', 'dismissed', 'closed'].includes(c.status)) return false;
  if (c.status === 'advanced') return false; // 先行赔偿已兜底，只剩追偿（另行亮灯）
  const days = -(daysUntil(c.dateISO, todayISOStr));
  return days > (settings.complaintDays ?? 7);
}

/** 未追偿的先行赔偿单（主办者真金白银挂在账上） */
export function unrecovered(state) {
  return state.complaints.filter((c) => c.status === 'advanced' && !c.recoveredISO);
}

/* ------------------------------------------------------------ 周期义务账 */

export function setDutyDone(state, kind, doneISO, note = '') {
  if (!DUTY_KINDS[kind]) throw new Error(`未知义务类型：${kind}`);
  assertISO(doneISO);
  let duty = state.duties.find((d) => d.kind === kind);
  if (!duty) {
    duty = { id: `o${++state.seq.duty}`, kind, lastDoneISO: '', note: '' };
    state.duties.push(duty);
  }
  duty.lastDoneISO = doneISO;
  duty.note = String(note).trim();
  return duty;
}

export function dutyState(duty, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  const meta = DUTY_KINDS[duty.kind];
  if (!duty.lastDoneISO) {
    return { ...meta, kind: duty.kind, lastDoneISO: '', dueISO: '', days: null, level: 'expired' };
  }
  const cycleDays = settings[meta.cycleKey] ?? 365;
  const due = addDays(duty.lastDoneISO, cycleDays);
  const days = daysUntil(due, todayISOStr);
  return { ...meta, kind: duty.kind, lastDoneISO: duty.lastDoneISO, dueISO: due, days, level: days < 0 ? 'expired' : days <= 30 ? 'warn' : 'ok' };
}

export function dutyBoard(state, todayISOStr = todayISO()) {
  return Object.keys(DUTY_KINDS).map((k) => {
    const duty = state.duties.find((d) => d.kind === k) || { kind: k, lastDoneISO: '', note: '' };
    return dutyState(duty, todayISOStr, state.settings || DEFAULT_SETTINGS);
  });
}

/* ------------------------------------------------------------ 看板与体检 */

export function healthCheck(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  const s = state.settings || DEFAULT_SETTINGS;
  const lights = [];
  let score = 100;
  const activeScales = state.scales.filter((x) => x.status === 'active');

  const redScales = activeScales.filter((x) => scaleRed(x, todayISOStr, s));
  const lost1 = Math.min(25, redScales.length * 10);
  score -= lost1;
  lights.push({ key: 'clock', label: '强检钟（超期/告急=不得继续使用）', level: redScales.length ? 'red' : 'ok', lost: lost1,
    detail: redScales.map((x) => `${x.stall}${x.vendor ? `·${x.vendor}` : x.role === 'fair' ? '·公平秤' : ''}`) });

  const gaps = activeScales.map((x) => ({ x, gaps: scaleLedgerGaps(x) })).filter((e) => e.gaps.length);
  const lost2 = Math.min(10, gaps.length * 5);
  score -= lost2;
  lights.push({ key: 'ledger', label: '登记造册缺项（证书号/强检标志）', level: gaps.length ? 'red' : 'ok', lost: lost2,
    detail: gaps.map((e) => `${e.x.stall}：${e.gaps.join('/')}`) });

  const fair = fairDailyLevel(state, todayISOStr);
  const lost3 = fair.level === 'red' ? 15 : fair.level === 'warn' ? 5 : 0;
  score -= lost3;
  lights.push({ key: 'fair', label: '公平秤（配置 + 按日核账）', level: fair.level, lost: lost3, detail: [fair.detail] });

  const patrol = patrolState(state, todayISOStr, s);
  const lost4 = patrol.level === 'red' ? 10 : patrol.level === 'warn' ? 5 : 0;
  score -= lost4;
  lights.push({ key: 'patrol', label: '场内计量巡查（第5条(七)发现义务）', level: patrol.level, lost: lost4, detail: [patrol.detail] });

  const openComplaints = state.complaints.filter((c) => !['recovered', 'dismissed', 'closed'].includes(c.status));
  const overdueComplaints = openComplaints.filter((c) => complaintOverdue(c, todayISOStr, s));
  const lost5 = Math.min(15, overdueComplaints.length * 10 + openComplaints.length * 2);
  score -= lost5;
  lights.push({ key: 'complaint', label: '计量投诉（受理→复核→处置）', level: overdueComplaints.length ? 'red' : openComplaints.length ? 'warn' : 'ok', lost: lost5,
    detail: openComplaints.map((c) => `${c.dateISO}·${c.stall}`) });

  const adv = unrecovered(state);
  const lost6 = Math.min(10, adv.length * 10);
  score -= lost6;
  lights.push({ key: 'advance', label: '先行赔偿追偿（第12条：赔了要追回来）', level: adv.length ? 'red' : 'ok', lost: lost6,
    detail: adv.map((c) => `${c.dateISO}·${c.stall}·¥${c.compensation ? c.compensation.total : '—'}`) });

  const redCards = activeCards(state, 'red');
  const yellowCards = activeCards(state, 'yellow');
  const lost7 = Math.min(10, redCards.length * 10 + yellowCards.length * 3);
  score -= lost7;
  lights.push({ key: 'cards', label: '红黄牌在册（第7条：公示 + 违约追责）', level: redCards.length ? 'red' : yellowCards.length ? 'warn' : 'ok', lost: lost7,
    detail: [...redCards, ...yellowCards].map((c) => `${c.stall}·${c.color === 'red' ? '红' : '黄'}`) });

  const overdueDuties = dutyBoard(state, todayISOStr).filter((d) => d.level === 'expired');
  const lost8 = Math.min(15, overdueDuties.length * 5);
  score -= lost8;
  lights.push({ key: 'duty', label: '周期义务（备案盘点/培训/协议/承诺/强检计划）', level: overdueDuties.length ? 'red' : 'ok', lost: lost8,
    detail: overdueDuties.map((d) => d.label) });

  score = Math.max(0, score);
  return { score, lights };
}

export function monthlySummary(state, month, todayISOStr = todayISO()) {
  const inMonth = (iso) => monthKey(String(iso || '')) === month;
  const complaints = state.complaints.filter((c) => inMonth(c.dateISO));
  const weighed = complaints.filter((c) => c.verify);
  const excess = weighed.filter((c) => c.verdict === 'excess');
  const advanced = complaints.filter((c) => ['advanced', 'recovered'].includes(c.status) && inMonth(c.dateISO));
  const recovered = complaints.filter((c) => c.status === 'recovered');
  return {
    month,
    complaints: complaints.length,
    rechecked: weighed.length,
    excess: excess.length,
    dismissedOk: weighed.filter((c) => c.verdict === 'ok').length,
    advancedCount: advanced.length,
    advancedAmount: advanced.reduce((s2, c) => s2 + (c.compensation ? c.compensation.total : 0), 0),
    recoveredCount: recovered.length,
    recoveredAmount: recovered.reduce((s2, c) => s2 + (c.compensation ? c.compensation.total : 0), 0),
    cardsIssued: state.cards.filter((c) => inMonth(c.issuedISO)).length,
    patrols: state.patrols.filter((p) => inMonth(p.dateISO)).length,
    patrolStalls: state.patrols.filter((p) => inMonth(p.dateISO)).reduce((s2, p) => s2 + (p.stallsChecked || 0), 0),
    scalesActive: state.scales.filter((x) => x.status === 'active').length,
    scalesRed: state.scales.filter((x) => x.status === 'active' && scaleRed(x, todayISOStr)).length,
    openComplaints: state.complaints.filter((c) => !['recovered', 'dismissed', 'closed'].includes(c.status)).length,
  };
}

/* ------------------------------------------------------------ 出证三通道 */

/** 复秤处置单：一投诉一单，含负偏差判定、55 条测算、双方签字栏 */
export function recheckSheetHtml(state, complaintId) {
  const c = state.complaints.find((x) => x.id === complaintId);
  if (!c) throw new Error(REJECT_REASONS.NO_COMPLAINT);
  const org = state.org?.name || '';
  const v = c.verify;
  const rows = [
    ['投诉受理日 / 摊位', `${c.dateISO} · ${c.stall}${c.vendor ? `（${c.vendor}）` : ''}`],
    ['商品 / 价格档', `${c.commodity || '—'} · ${DEVIATION_TABLE[c.band].label}`],
    ['结算重量 / 公平秤复核重量', `${v ? v.settleKg : (c.settleKg ?? '—')} kg / ${v ? v.actualKg : '未复核'} kg`],
  ];
  if (v) {
    rows.push(['核称法', v.methodLabel]);
    rows.push(['差值 / 法定负偏差', `${v.diffG > 0 ? '+' : ''}${v.diffG} g / 允差 ${v.allowedG} g（负偏差 ${v.limitG} g${v.multiplier > 1 ? ' × 2（等准确度核称）' : ''}）`]);
    rows.push(['判定', v.excess ? '<b style="color:#c22d1b">短秤缺量超差（办法第12条）</b>' : '未超法定负偏差']);
  }
  if (c.compensation) {
    const k = c.compensation;
    rows.push(['价款 / 退还差价', `¥${k.pricePaid} / ¥${k.refundDiff}`]);
    rows.push(['惩罚性赔偿（消保法第55条）', `¥${k.punitive}（三倍价款，不足 500 元按 500 元）`]);
    rows.push(['合计', `<b>¥${k.total}</b>`]);
  }
  rows.push(['处置', `${COMPLAINT_STATUS[c.status]}${c.measure ? ` · ${escapeHtml(c.measure)}` : ''}${c.resolvedISO ? `（${escapeHtml(c.resolvedISO)}）` : ''}${c.recoveredISO ? `<br>追偿到账 ${escapeHtml(c.recoveredISO)}` : ''}${c.closedISO ? `<br>闭环 ${escapeHtml(c.closedISO)}` : ''}`]);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>复秤处置单 ${escapeHtml(c.dateISO)} ${escapeHtml(c.stall)}</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;color:#111;padding:28px;max-width:720px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:12px 0}
td,th{border:1px solid #999;padding:7px 9px;font-size:13px;text-align:left;vertical-align:top}th{background:#f3f4f6;width:190px}
.sig{margin-top:26px;display:flex;gap:26px;font-size:13px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px}
.small{color:#555;font-size:11px;line-height:1.7;margin-top:18px}@media print{body{padding:0}}</style></head><body>
<h1>集贸市场计量投诉复秤处置单</h1><div style="font-size:12px;color:#555">${escapeHtml(org)} · 依据《集贸市场计量监督管理办法》（总局令第94号）第5/12条、《零售商品称重计量监督管理办法》附表1</div>
<table>${rows.map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join('')}</table>
<div class="sig"><div>消费者签字</div><div>经营者签字</div><div>计量管理员签字<br>日期：${escapeHtml(c.dateISO)}</div></div>
<p class="small">本单为市场主办者自查留痕底稿；短秤缺量经复核超差的，消费者可向经营者要求赔偿，经营者租赁期满的也可向主办者要求赔偿、主办者赔偿后向经营者追偿（办法第12条）；利用作弊秤构成欺诈的适用消保法第55条（退一赔三、不足 500 元按 500 元）；金额测算不替代执法与司法认定。</p>
</body></html>`;
}

/** 迎检自证包：市场档案 + 一秤一档（=登记造册备案清单）+ 公平秤 + 巡查红黄牌 + 投诉处置 + 义务账 + 体检 */
export function inspectHtml(state, todayISOStr = todayISO()) {
  const s = state.settings || DEFAULT_SETTINGS;
  const org = state.org || {};
  const sec = (title, inner) => `<section><h2>${title}</h2>${inner}</section>`;
  const lvl = (c) => c.level === 'ok' ? '正常' : c.level === 'warn' ? '临期' : c.level === 'red' ? `告急(${c.days}天)` : '已过期';
  const scaleRows = state.scales.map((x) => {
    const c = scaleClock(x, todayISOStr, s);
    const gaps = scaleLedgerGaps(x);
    return `<tr class="${c.level === 'expired' || c.level === 'red' ? 'badrow' : ''}"><td>${escapeHtml(x.stall)}<br><span class="dim">${escapeHtml(x.vendor || (x.role === 'fair' ? '公平复核' : ''))}</span></td>
      <td>${escapeHtml(x.type)}${x.brand ? ` · ${escapeHtml(x.brand)}` : ''}${x.model ? ` ${escapeHtml(x.model)}` : ''}<br><span class="dim">${x.capacityKg ? `量程 ${escapeHtml(x.capacityKg)}kg · ` : ''}${x.divisionG ? `分度 ${escapeHtml(x.divisionG)}g · ` : ''}${SCALE_ROLE[x.role] || ''}</span></td>
      <td>${escapeHtml(x.certNo || '—')}<br><span class="dim">${x.verifiedISO ? `${escapeHtml(x.verifiedISO)} 检定` : '无检定记录'}</span></td>
      <td>${c.missing ? '<b class="bad">无检定记录——不得使用</b>' : `${escapeHtml(c.dueISO)}（${lvl(c)}）`}${gaps.length ? `<br><span class="warn">${escapeHtml(gaps.join(' · '))}</span>` : ''}</td>
      <td>${SCALE_STATUS[x.status] || x.status}</td></tr>`;
  }).join('');
  const changeRows = state.changes.slice(-15).reverse().map((ch) => {
    const x = state.scales.find((y) => y.id === ch.scaleId);
    return `<tr><td>${escapeHtml(ch.dateISO)}</td><td>${SCALE_CHANGES[ch.change]}</td><td>${escapeHtml(x ? `${x.stall}·${x.type}` : ch.scaleId)}</td><td>${escapeHtml(ch.note || '—')}</td></tr>`;
  }).join('');
  const fairRows = state.fairLogs.slice(-15).reverse().map((q) => {
    const x = state.scales.find((y) => y.id === q.scaleId);
    return `<tr><td>${escapeHtml(q.dateISO)}</td><td>${escapeHtml(x ? x.stall : q.scaleId)}</td><td>${q.ok ? '核查正常' : '<b class="bad">异常（已处置）</b>'}</td><td>${escapeHtml(q.note || '—')}</td></tr>`;
  }).join('');
  const patrolRows = state.patrols.slice(-12).reverse().map((p) => `<tr><td>${escapeHtml(p.dateISO)}</td><td>${p.stallsChecked} 个摊位</td>
    <td>${p.finds.length ? p.finds.map((f) => `${escapeHtml(f.stall)}：${escapeHtml(f.problem)}${f.measure ? `（${escapeHtml(f.measure)}）` : ''}`).join('<br>') : '未发现问题'}</td></tr>`).join('');
  const cardRows = state.cards.slice(-12).reverse().map((c) => `<tr><td>${escapeHtml(c.issuedISO)}</td><td>${escapeHtml(c.stall)}${c.vendor ? `（${escapeHtml(c.vendor)}）` : ''}</td>
    <td>${c.color === 'red' ? '<b class="bad">红牌</b>' : '<b class="warn">黄牌</b>'} ${escapeHtml(c.reason)}</td>
    <td>${c.status === 'lifted' ? `${escapeHtml(c.liftedISO)} 摘牌` : '<b class="warn">在牌</b>'}</td></tr>`).join('');
  const complaintRows = state.complaints.slice(-20).reverse().map((c) => `<tr><td>${escapeHtml(c.dateISO)}</td><td>${escapeHtml(c.stall)}</td>
    <td>${c.verify ? `${c.verify.settleKg}→${c.verify.actualKg}kg（差 ${c.verify.diffG > 0 ? '+' : ''}${c.verify.diffG}g / 允 ${c.verify.allowedG}g）` : '待复核'}</td>
    <td>${c.verify ? (c.verdict === 'excess' ? '<b class="bad">超差</b>' : '未超差') : '—'}</td>
    <td>${c.compensation ? `¥${c.compensation.total}` : '—'}</td>
    <td>${escapeHtml(COMPLAINT_STATUS[c.status] || c.status)}${c.recoveredISO ? `<br><span class="dim">追偿 ${escapeHtml(c.recoveredISO)}</span>` : ''}</td></tr>`).join('');
  const dutyRows = dutyBoard(state, todayISOStr).map((d) => `<tr><td>${escapeHtml(d.label)}</td><td>${escapeHtml(d.basis)}</td>
    <td>${d.lastDoneISO || '<b class="warn">未登记</b>'}</td><td>${d.dueISO || '—'}${d.days !== null ? `（${d.days < 0 ? `逾期${-d.days}天` : `剩${d.days}天`}）` : ''}</td></tr>`).join('');
  const hc = healthCheck(state, todayISOStr);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>集贸市场计量合规迎检自证包 ${escapeHtml(todayISOStr)}</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;color:#111;padding:30px;max-width:860px;margin:0 auto;line-height:1.55}
h1{font-size:21px;margin:0}h2{font-size:15px;margin:26px 0 8px;border-left:4px solid #12805c;padding-left:8px}
table{width:100%;border-collapse:collapse;margin:8px 0}td,th{border:1px solid #aaa;padding:6px 8px;font-size:12px;text-align:left;vertical-align:top}
th{background:#f3f4f6}.dim{color:#777;font-size:11px}.bad{color:#c22d1b}.warn{color:#9a6a00}
.badrow td{background:#fdf3f1}.sig{margin-top:30px;display:flex;gap:26px;font-size:13px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px}
.head{font-size:12px;color:#555;margin:4px 0 14px}.note{font-size:11px;color:#555;margin-top:20px;line-height:1.7}
@media print{body{padding:0}}</style></head><body>
<h1>集贸市场计量合规台账 · 迎检自证包</h1>
<div class="head">${escapeHtml(org.name || '')}${org.district ? ` · ${escapeHtml(org.district)}` : ''} · 计量管理员 ${escapeHtml(org.manager || '—')}${org.phone ? ` / ${escapeHtml(org.phone)}` : ''} · 出证日 ${escapeHtml(todayISOStr)} · 体检得分 ${hc.score}</div>
${sec('一、市场计量管理制度与人员（办法第5条(一)(四)）', `<table><tr><th>市场名称</th><td>${escapeHtml(org.name || '—')}</td><th>计量管理员</th><td>${escapeHtml(org.manager || '—')}${org.phone ? ` / ${escapeHtml(org.phone)}` : ''}</td></tr>
<tr><th>属地</th><td>${escapeHtml(org.district || '—')}</td><th>培训最近完成</th><td>${escapeHtml(state.duties.find((d) => d.kind === 'adminTraining')?.lastDoneISO || '—')}</td></tr></table>`)}
${sec('二、一秤一档 · 强检计量器具登记造册（办法第5条(五)——本表即备案底稿）', scaleRows ? `<table><tr><th>摊位/经营者</th><th>器具</th><th>检定证书号</th><th>检定有效期至（周期≤1年）</th><th>状态</th></tr>${scaleRows}</table>` : '<p class="warn">尚未登记计量器具。</p>')}
${sec('三、器具变动报备（办法第9条(二)：新增/减少/更换/维修及时更新）', changeRows ? `<table><tr><th>日期</th><th>情形</th><th>器具</th><th>说明</th></tr>${changeRows}</table>` : '<p>登记期内无变动。</p>')}
${sec('四、公平秤配置与按日核账（办法第5条(六)）', fairRows ? `<table><tr><th>日期</th><th>公平秤</th><th>核查</th><th>备注</th></tr>${fairRows}</table>` : '<p class="warn">暂无核查记录。</p>')}
${sec('五、场内计量巡查（办法第5条(七)：发现作弊应当制止、不得包庇纵容）', patrolRows ? `<table><tr><th>日期</th><th>覆盖</th><th>发现问题与处置</th></tr>${patrolRows}</table>` : '<p class="warn">暂无巡查记录。</p>')}
${sec('六、违法失信经营者红黄牌（办法第7条：公示 + 违约追责直至清退）', cardRows ? `<table><tr><th>出具日</th><th>摊位</th><th>事由</th><th>状态</th></tr>${cardRows}</table>` : '<p>在册无红黄牌。</p>')}
${sec('七、计量投诉与先行赔偿追偿（办法第12条 · 消保法第55条）', complaintRows ? `<table><tr><th>受理日</th><th>摊位</th><th>复核</th><th>判定</th><th>金额</th><th>状态</th></tr>${complaintRows}</table>` : '<p>期内无投诉。</p>')}
${sec('八、周期义务（办法第5条(三)(四)(五)(八)）', `<table><tr><th>义务</th><th>依据</th><th>最近完成</th><th>下次到期</th></tr>${dutyRows}</table>`)}
${sec('九、台账体检', `<p>得分 <b>${hc.score}</b>/100。${hc.lights.filter((l) => l.level !== 'ok').map((l) => `${l.label}（-${l.lost}）：${escapeHtml(l.detail.join('、'))}`).join('；') || '九灯全绿。'}</p>`)}
<div class="sig"><div>集市主办者（盖章）</div><div>计量管理员签字</div><div>日期：${escapeHtml(todayISOStr)}</div></div>
<p class="note">本包为「做动作即留痕」的自查底账汇总，依据《集贸市场计量监督管理办法》（国家市场监督管理总局令第94号，2025-03-01 施行）、《计量法》第9/27条、《计量法实施细则》第43/46/48条、《零售商品称重计量监督管理办法》（总局令第31号2020修订）附表1、《消费者权益保护法》第55条生成，条号见 docs/14；周期阈值为参数化口径，属地市场监管部门要求永远赢；本包不替代强检检定、备案、调解、处罚等法定程序与执法认定。</p>
</body></html>`;
}

/** 月度小结微信文本 */
export function monthlyText(state, month, todayISOStr = todayISO()) {
  const m = monthlySummary(state, month, todayISOStr);
  const org = state.org?.name || '本市场';
  const lines = [
    `【集贸市场计量合规月度小结】${org} · ${m.month}`,
    `在用秤 ${m.scalesActive} 杆${m.scalesRed ? `（其中 ${m.scalesRed} 杆强检临期/超期，须立即安排送检）` : '（强检钟全绿）'}；巡查 ${m.patrols} 次覆盖 ${m.patrolStalls} 摊次；红黄牌 ${m.cardsIssued} 张。`,
    `计量投诉 ${m.complaints} 件：复核 ${m.rechecked} 件，短秤超差 ${m.excess} 件、未超差 ${m.dismissedOk} 件。`,
  ];
  if (m.advancedCount) lines.push(`主办者先行赔偿 ${m.advancedCount} 件 ¥${m.advancedAmount}${m.recoveredCount ? `；已追偿 ${m.recoveredCount} 件 ¥${m.recoveredAmount}` : '；追偿在途'}（办法第12条）。`);
  if (m.openComplaints) lines.push(`⚠️ 在途投诉 ${m.openComplaints} 件——请到「投诉」页处置闭环。`);
  const hc = healthCheck(state, todayISOStr);
  lines.push(`台账体检：${hc.score}/100${hc.score < 100 ? '——红灯项请到「看板」逐项处理' : '，九灯全绿'}`);
  lines.push('依据《集贸市场计量监督管理办法》（总局令第94号）留痕，属地市场监管部门要求永远赢。');
  return lines.join('\n');
}

/* ------------------------------------------------------------ 示例数据 */

/** 演示种子：1 家市场 + 6 杆秤（1 公平秤）+ 投诉/巡查/红黄牌/义务跨状态 */
export function seedState(todayISOStr = todayISO()) {
  const s = emptyState();
  s.org = {
    name: '示例·城南农贸市场', district: '示例市城南区', manager: '陈市场', phone: '13900000001',
    note: '主办方：城南市场服务有限公司（摊位 86 个）',
  };
  const s1 = addScale(s, {
    stall: '12 号·水产', vendor: '王水产', type: '电子计价秤', brand: '友声', model: 'ACS-30',
    capacityKg: 30, divisionG: 5, certNo: 'JS2025-0088123', verifiedISO: addDays(todayISOStr, -340), stickerAffixed: true,
  });
  const s2 = addScale(s, {
    stall: '03 号·猪肉', vendor: '李肉铺', type: '电子计价秤', brand: '友声', model: 'ACS-15',
    capacityKg: 15, divisionG: 5, certNo: 'JS2025-0088156', verifiedISO: addDays(todayISOStr, -355), stickerAffixed: true,
  });
  const s3 = addScale(s, {
    stall: '27 号·果蔬', vendor: '赵果篮', type: '电子计价秤', brand: '香山', model: 'ACS-30',
    capacityKg: 30, divisionG: 5, certNo: '', verifiedISO: addDays(todayISOStr, -30), stickerAffixed: false,
    note: '新换秤：检定证号待录入',
  });
  const s4 = addScale(s, {
    stall: '31 号·活鱼', vendor: '孙鱼档', type: '电子计价秤', brand: '凯丰', model: 'ACS-30',
    capacityKg: 30, divisionG: 10, certNo: 'JS2024-0066210', verifiedISO: addDays(todayISOStr, -370), stickerAffixed: true,
    note: '证已超期，检定机构已预约',
  });
  const s5 = addScale(s, {
    stall: '08 号·熟食', vendor: '周卤味', type: '电子计价秤', brand: '友声', model: 'ACS-6',
    capacityKg: 6, divisionG: 2, certNo: 'JS2025-0088201', verifiedISO: addDays(todayISOStr, -120), stickerAffixed: true,
  });
  const fair = addScale(s, {
    role: 'fair', stall: '公平秤·主入口服务台', vendor: '', type: '电子台秤', brand: '友声', model: 'TCS-60',
    capacityKg: 60, divisionG: 10, certNo: 'JS2025-0088001', verifiedISO: addDays(todayISOStr, -200), stickerAffixed: true,
  });
  // 公平秤日检：昨日已核、今日未核 → 黄灯演示
  logFairCheck(s, { scaleId: fair.id, dateISO: addDays(todayISOStr, -1), ok: true, note: 'M1 砝码试核正常' });
  logFairCheck(s, { scaleId: fair.id, dateISO: addDays(todayISOStr, -2), ok: true });
  // 投诉一：已闭环（超差 → 先行赔偿 → 已追偿）
  const t1 = createComplaint(s, {
    dateISO: addDays(todayISOStr, -6), stall: '12 号·水产', vendor: '王水产', commodity: '基围虾', band: 'mid',
    unitPrice: 96, settleKg: 2, note: '消费者复秤诉求',
  });
  recheckComplaint(s, t1.id, { actualKg: 1.95, method: 'same', recheckedISO: addDays(todayISOStr, -6) });
  resolveComplaint(s, t1.id, { mode: 'advance', measure: '经营者当晚撤场，主办者按第12条先行赔偿', resolvedISO: addDays(todayISOStr, -5) });
  recoverComplaint(s, t1.id, { recoveredISO: addDays(todayISOStr, -2), note: '从摊位保证金中扣回' });
  // 投诉二：已复核超差，待处置（红演示）——草鱼 12 元/kg 属「高于 6 但不高于 30 元/kg」档
  const t2 = createComplaint(s, {
    dateISO: addDays(todayISOStr, -1), stall: '31 号·活鱼', vendor: '孙鱼档', commodity: '草鱼', band: 'mid',
    unitPrice: 12, settleKg: 3, note: '消费者自带弹簧秤复核后投诉',
  });
  recheckComplaint(s, t2.id, { actualKg: 2.7, method: 'same', recheckedISO: addDays(todayISOStr, -1) });
  // 巡查：8 天前一次（超 7 天周期 → 红演示）
  logPatrol(s, {
    dateISO: addDays(todayISOStr, -8), stallsChecked: 12,
    finds: [{ stall: '31 号·活鱼', problem: '秤下垫泡沫垫', measure: '当场责令撤除并复查' }],
    note: '周二例行巡查',
  });
  // 红黄牌：黄牌在册
  issueCard(s, {
    stall: '31 号·活鱼', vendor: '孙鱼档', color: 'yellow',
    reason: '复核短秤超差 + 秤下垫物', issuedISO: addDays(todayISOStr, -1), note: '公示三日，整改验收后摘牌',
  });
  setDutyDone(s, 'ledgerAudit', addDays(todayISOStr, -100));
  setDutyDone(s, 'adminTraining', addDays(todayISOStr, -200));
  setDutyDone(s, 'agreementAudit', addDays(todayISOStr, -400)); // 逾期 → 红演示
  setDutyDone(s, 'promiseOrg', addDays(todayISOStr, -60));
  setDutyDone(s, 'verifyPlan', addDays(todayISOStr, -300));
  return s;
}

/* ------------------------------------------------------------ 状态与序列 */

export const STATE_VERSION = 1;

export function emptyState() {
  return {
    version: STATE_VERSION,
    org: { name: '', district: '', manager: '', phone: '', note: '' },
    scales: [],   // 一秤一档（含公平秤）
    changes: [],  // 器具变动报备
    fairLogs: [], // 公平秤日检
    patrols: [],  // 场内巡查
    cards: [],    // 红黄牌
    complaints: [], // 计量投诉（第12条状态机）
    duties: [],   // 周期义务
    settings: { ...DEFAULT_SETTINGS },
    seq: { scale: 0, change: 0, fair: 0, patrol: 0, card: 0, complaint: 0, duty: 0 },
    events: [],   // HDD 埋点
  };
}

export function exportBundle(state) {
  return JSON.stringify(state, null, 2);
}

export function importBundle(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object' || !Array.isArray(s.scales)) throw new Error('不是有效的秤平账备份文件');
  return { ...emptyState(), ...s };
}
