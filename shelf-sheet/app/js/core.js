/**
 * core.js — 药清账 ShelfSheet 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；不碰价格与财务；
 * 所有周期与限值参数（近效期红线/催销线/养护周期/温区限值/湿度区间/断更红线）均可在设置中被药店覆盖。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md，全部为现行版条号，2026-09-07 核验）：
 * - 《中华人民共和国药品管理法》（2019-08-26 第二次修订，2019-12-01 施行，现行版）：
 *   第 12 条：国家建立健全药品追溯制度；
 *   第 49 条：标签/说明书应注明有效期等并显著标注；
 *   第 50 条：直接接触药品的工作人员应当每年进行健康检查，患传染病等不得从事直接接触药品的工作；
 *   第 51 条：药品零售须经县级以上地方药监部门批准取得药品经营许可证，许可证标明有效期和经营范围，
 *             到期重新审查发证，无证不得经营；
 *   第 52 条：开办条件（药师或其他药学技术人员/场所设备仓储/质量机构或人员/制度+GSP）；
 *   第 53 条：应遵守药品经营质量管理规范（GSP），鼓励零售连锁，连锁总部应建立统一质量管理制度并对
 *             所属零售企业履行管理责任，法定代表人、主要负责人对经营活动全面负责；
 *   第 54 条：处方药与非处方药分类管理；
 *   第 55/56/57 条：合法渠道购进、进货检查验收、购销记录真实完整（注明产品批号、有效期等）；
 *   第 58 条：零售准确无误、调配处方核对且不得擅自更改代用、配伍禁忌或超剂量处方拒绝调配，
 *             药师或其他药学技术人员负责药品管理、处方审核和调配、合理用药指导；
 *   第 59 条：制定执行药品保管制度，采取必要的冷藏、防冻、防潮、防虫、防鼠等措施；
 *   第 98 条：劣药情形含「未标明或者更改有效期的药品」「超过有效期的药品」；
 *   第 115 条：无证经营，货值 15~30 倍罚款、不足 10 万按 10 万计；
 *   第 116 条：销售假药，货值 15~30 倍罚款、不足 10 万按 10 万计；
 *   第 117 条：销售劣药，货值 10~20 倍罚款；违法生产、批发的货值不足 10 万按 10 万计，
 *             **违法零售的货值不足 1 万元按 1 万元计算**（卖一盒过期药＝罚款 10 万~20 万元起步）；
 *   第 126 条：未遵守 GSP：警告+限期改正；逾期不改正处 10 万~50 万；情节严重 50 万~200 万并可吊证。
 * - 《中华人民共和国药品管理法实施条例》（2026-01-27 国务院令第 828 号公布修订，2026-05-15 施行，
 *   9 章 89 条——旧版 2002 公布/2016 修订的条号已全部作废，引用旧条号即露馅）：
 *   第 42 条：经营许可审查、药品经营许可证有效期 5 年、届满需继续经营的申请重新核发；
 *   第 43 条：配备依法经过资格认定的药师或其他药学技术人员（只经营乙类非处方药的零售企业可按规定
 *             配备药学技术人员）；**药品零售企业应当凭处方销售处方药**；
 *   第 44 条：储存、运输按药品包装、质量特性、温度控制要求采取措施保证质量；零售企业向患者配送的
 *             药品应当有独立包装和显著标识。
 * - 《药品经营和使用质量监督管理办法》（国家市场监督管理总局令第 84 号，2024-01-01 施行，
 *   同时废止《药品经营许可证管理办法》《药品流通监督管理办法》）：
 *   第 5 条：遵守统一药品追溯标准和规范、建立实施追溯制度；
 *   第 10 条：零售条件——经营处方药、甲类非处方药的应当按规定配备药师或其他药学技术人员；
 *   第 17 条：药品经营许可证有效期五年；
 *   第 41 条：储存运输遵守 GSP、按温度控制要求采取措施；冷藏冷冻药品配备设施设备并按规定做好监测记录；
 *   第 42 条：凭处方销售处方药、处方保留不少于五年；不得以买药品赠药品等方式向公众赠送处方药、
 *             甲类非处方药；处方药不得开架销售；
 *   第 66 条：法律责任转致法律法规已有规定。
 * - 执法实践口径：药品零售 GSP 检查要点表（检查细则）要求——陈列检查与温湿度监测记录真实完整可追溯、
 *   处方药不得开架自选、外用药分开摆放、拆零药品集中存放拆零专柜、定期检查陈列存放药品且重点为
 *   拆零/易变质/近效期/摆放时间较长药品及中药饮片、直接接触药品人员岗前及年度健康检查并建档案。
 * 本工具是药店侧的效期与养护自证台账，不构成法律意见，不替代法定报送、许可与执法认定；
 * 温区限值、近效期阈值、养护周期均为参数化通识默认值，药品说明书标示的储藏条件与属地规则永远赢。
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
// 口径常量（法定与通识口径的参数化，说明书与属地规则永远赢）
// ---------------------------------------------------------------------------

/** 储藏条件分类（与药品说明书标示对应，标签只做台账归类） */
export const STORAGE_KINDS = {
  normal: '常温（10~30℃）',
  cool: '阴凉（≤20℃）',
  cold: '冷藏（2~8℃）',
};

/** 温湿度限值默认值（药典凡例与行业通识的参数化，说明书标示与属地 GSP 口径永远赢） */
export const DEFAULT_LIMITS = {
  normalMin: 10, normalMax: 30,   // 营业场所按常温区判定
  coolMax: 20,                     // 阴凉柜
  coldMin: 2, coldMax: 8,          // 冷藏柜
  rhMin: 35, rhMax: 75,            // 相对湿度 %
};

/** 近效期两道线（行业通识参数化：黄线内催销、红线内下架或专区处置） */
export const DEFAULT_WARN_DAYS = 180;
export const DEFAULT_RED_DAYS = 90;
/** 养护周期默认值（检查细则「定期检查陈列存放药品」的参数化，重点为近效期/拆零/易变质） */
export const DEFAULT_CARE_DAYS = 30;
/** 温湿度断更判定：连续 N 天无记录进入点名 */
export const DEFAULT_GAP_DAYS = 3;
/** 许可证/药师注册证等证件钟的临期预警窗 */
export const CERT_WARN_DAYS = 180;

/** 拒售原因（条例第 43 条凭处方销售 + 84 号令第 42 条买赠禁止与处方药不得开架的现场归类） */
export const REFUSAL_REASONS = {
  'no-rx': '无处方索购处方药',
  'rx-bad': '处方不合格（涂改/超量/配伍禁忌）',
  gift: '要求以买赠方式获得处方药或甲类非处方药',
  other: '其他',
};

/** 出库方式（售出动销；不合格药品先隔离再处置，84 号令/GSP 检查细则口径） */
export const OUT_WAYS = {
  sold: '售出',
  quarantine: '下架隔离',
  return: '退回供应商',
  destroy: '报损销毁',
  recall: '召回下架',
};

/** 隔离批次处置结论（不合格药品处理：隔离 → 销毁/退货留痕） */
export const QUAR_ACTIONS = {
  destroy: '已报损销毁',
  return: '已退回供应商',
  other: '其他处置',
};

/** 周期义务（周期为参数化默认值，属地要求永远赢） */
export const DUTY_KINDS = {
  health: { label: '员工健康检查', cycleDays: 365, basis: '《药品管理法》第五十条：直接接触药品人员每年健康检查' },
  calib: { label: '温湿度计校准', cycleDays: 365, basis: '计量与 GSP 通识口径，属地要求永远赢' },
  training: { label: '药事法规培训', cycleDays: 365, basis: 'GSP 人员培训要求（通识周期）' },
};

// ---------------------------------------------------------------------------
// 通用证件钟（许可证 5 年/药师注册证/任何以证件载明日期为准的钟）
// ---------------------------------------------------------------------------

/** 证件钟：unset（未登记）/ overdue（已过期）/ due（≤warnDays 临期）/ ok */
export function certClock(expiryISO, todayISOStr, warnDays = CERT_WARN_DAYS) {
  assertISO(todayISOStr);
  if (!expiryISO) return { level: 'unset', daysLeft: null, detail: '未登记有效期' };
  assertISO(expiryISO);
  const daysLeft = daysUntil(expiryISO, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= warnDays ? 'due' : 'ok';
  const detail = `有效期至 ${expiryISO}${daysLeft < 0 ? `，已过期 ${-daysLeft} 天` : `，剩 ${daysLeft} 天`}`;
  return { level, daysLeft, detail };
}

/** 药品经营许可证钟（药品管理法第 51 条 + 实施条例第 42 条/84 号令第 17 条：有效期 5 年） */
export function licenseState(pharmacy, todayISOStr) {
  const c = certClock(pharmacy?.licenseExpiryISO, todayISOStr);
  if (c.level === 'unset') return { ...c, detail: '未登记许可证有效期（许可证有效期 5 年，84 号令第 17 条）' };
  return c;
}

// ---------------------------------------------------------------------------
// 药品目录与批次效期（第 57 条购销记录注明批号/有效期的台账化）
// ---------------------------------------------------------------------------

function requireDrug(state, drugId) {
  const drug = (state.drugs ?? []).find((d) => d.id === drugId);
  if (!drug) throw new Error(`药品不存在: ${drugId}`);
  return drug;
}

/** 药品建档。name 必填；同名同规格拒绝（防止重复台账） */
export function addDrug(state, { name, spec = '', storage = 'normal', approvalNo = '', manufacturer = '', note = '' }) {
  if (!name || !String(name).trim()) throw new Error('药品名称必填');
  if (!STORAGE_KINDS[storage]) throw new Error(`非法储藏分类: ${storage}`);
  const dup = (state.drugs ?? []).some((d) => d.name === name.trim() && d.spec === spec.trim());
  if (dup) throw new Error(`该药品已建档：${name}（${spec || '无规格'}）`);
  state.drugSeq = (state.drugSeq ?? 0) + 1;
  const rec = {
    id: `dg-${state.drugSeq}`, name: name.trim(), spec: spec.trim(), storage,
    approvalNo: approvalNo.trim(), manufacturer: manufacturer.trim(), note: note.trim(),
  };
  state.drugs.push(rec);
  return rec;
}

/** 删除药品档案（仅当名下没有在架数量——卖清的批次是历史记录，不拦建档清理） */
export function removeDrug(state, drugId) {
  const idx = (state.drugs ?? []).findIndex((d) => d.id === drugId);
  if (idx < 0) throw new Error(`药品不存在: ${drugId}`);
  if ((state.batches ?? []).some((b) => b.drugId === drugId && b.qty > 0)) {
    throw new Error('该药品名下还有在架批次，先清批次再删档案');
  }
  state.drugs.splice(idx, 1);
}

/** 进货建批（批号/效期照包装抄——第 57 条购销记录字段口径）。同药品+批号+效期唯一 */
export function addBatch(state, { drugId, batchNo, expiryISO, qty, location = '' }) {
  requireDrug(state, drugId);
  if (!batchNo || !String(batchNo).trim()) throw new Error('产品批号必填（药品管理法第 57 条）');
  assertISO(expiryISO);
  const n = qty;
  if (!Number.isInteger(n) || n <= 0) throw new Error(`数量必须为正整数: ${qty}`);
  const dup = (state.batches ?? []).some((b) => b.drugId === drugId && b.batchNo === batchNo.trim() && b.expiryISO === expiryISO);
  if (dup) throw new Error('同药品同批号同效期的批次已存在');
  state.batchSeq = (state.batchSeq ?? 0) + 1;
  const rec = {
    id: `bt-${state.batchSeq}`, drugId, batchNo: batchNo.trim(), expiryISO,
    qty, location: location.trim(), addedISO: todayISO(),
  };
  state.batches.push(rec);
  return rec;
}

/**
 * 出库落账。way：售出 / 下架隔离 / 退回供应商 / 报损销毁 / 召回下架。
 * 数量超过在架数量整体拒绝（账实守恒）；下架隔离与召回自动生成待处置隔离单。
 */
export function outBatch(state, batchId, { dateISO, qty, way, note = '' }) {
  const batch = (state.batches ?? []).find((b) => b.id === batchId);
  if (!batch) throw new Error(`批次不存在: ${batchId}`);
  assertISO(dateISO);
  if (!OUT_WAYS[way]) throw new Error(`非法出库方式: ${way}`);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error(`数量必须为正整数: ${qty}`);
  if (qty > batch.qty) throw new Error(`出库数量超过在架数量（在架 ${batch.qty}），整体拒绝`);
  state.outSeq = (state.outSeq ?? 0) + 1;
  const out = { id: `ou-${state.outSeq}`, batchId, dateISO, qty, way, note: note.trim() };
  state.outs.push(out);
  batch.qty -= qty;
  let quarantine = null;
  if (way === 'quarantine' || way === 'recall') {
    const drug = requireDrug(state, batch.drugId);
    state.quarSeq = (state.quarSeq ?? 0) + 1;
    quarantine = {
      id: `qt-${state.quarSeq}`, outId: out.id, batchId,
      drugName: drug.name, spec: drug.spec, batchNo: batch.batchNo, expiryISO: batch.expiryISO,
      qty, dateISO, closedISO: null, action: '', note: '',
    };
    state.quarantines.push(quarantine);
  }
  return { out, quarantine };
}

/** 撤销出库（记错自救）：数量回滚；对应隔离单未处置才允许一并撤销 */
export function removeOut(state, outId) {
  const idx = (state.outs ?? []).findIndex((o) => o.id === outId);
  if (idx < 0) throw new Error(`出库记录不存在: ${outId}`);
  const out = state.outs[idx];
  const qt = (state.quarantines ?? []).find((q) => q.outId === outId);
  if (qt?.closedISO) throw new Error('该隔离单已有处置结论，不可随出库撤销');
  const batch = (state.batches ?? []).find((b) => b.id === out.batchId);
  if (batch) batch.qty += out.qty;
  if (qt) state.quarantines.splice(state.quarantines.indexOf(qt), 1);
  state.outs.splice(idx, 1);
}

/** 隔离单处置销案（不合格药品处理留痕：销毁/退货） */
export function resolveQuarantine(state, quarId, { closedISO, action, note = '' }) {
  const rec = (state.quarantines ?? []).find((q) => q.id === quarId);
  if (!rec) throw new Error(`隔离单不存在: ${quarId}`);
  if (rec.closedISO) throw new Error('该隔离单已处置销案');
  if (!QUAR_ACTIONS[action]) throw new Error(`非法处置结论: ${action}`);
  assertISO(closedISO);
  if (closedISO < rec.dateISO) throw new Error('处置日期早于隔离日期');
  rec.closedISO = closedISO;
  rec.action = action;
  rec.note = note.trim();
  return rec;
}

/** 未处置隔离单（最老的在前——检查现场第一问） */
export function openQuarantines(state) {
  return (state.quarantines ?? [])
    .filter((q) => !q.closedISO)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

/** 批次视图：附药品信息、剩余天数与三色档 */
export function batchView(state, batch, todayISOStr, settings = {}) {
  const drug = (state.drugs ?? []).find((d) => d.id === batch.drugId);
  const warnDays = settings.warnDays ?? DEFAULT_WARN_DAYS;
  const redDays = settings.redDays ?? DEFAULT_RED_DAYS;
  const daysLeft = daysUntil(batch.expiryISO, todayISOStr);
  const level = daysLeft < 0 ? 'expired' : daysLeft <= redDays ? 'red' : daysLeft <= warnDays ? 'warn' : 'ok';
  return {
    ...batch,
    drugName: drug?.name ?? '（药品已删除）', spec: drug?.spec ?? '', storage: drug?.storage ?? 'normal',
    daysLeft, level,
  };
}

/**
 * 货架总表：过期 / 红线 / 催销 / 正常 四档，各档按效期升序（最先到期的排最前）。
 * expired：劣药红线（第 98 条），在架一日都是倒查事故；red：≤redDays 建议下架或专区处置；
 * warn：≤warnDays 催销窗口。
 */
export function shelfBoard(state, todayISOStr, settings = {}) {
  assertISO(todayISOStr);
  const views = (state.batches ?? []).filter((b) => b.qty > 0).map((b) => batchView(state, b, todayISOStr, settings));
  const byExpiry = (a, b) => a.expiryISO.localeCompare(b.expiryISO) || a.id.localeCompare(b.id);
  const board = {
    expired: views.filter((v) => v.level === 'expired').sort(byExpiry),
    red: views.filter((v) => v.level === 'red').sort(byExpiry),
    warn: views.filter((v) => v.level === 'warn').sort(byExpiry),
    ok: views.filter((v) => v.level === 'ok').sort(byExpiry),
  };
  board.units = views.reduce((n, v) => n + v.qty, 0);
  board.batches = views.length;
  return board;
}

// ---------------------------------------------------------------------------
// 温湿度日双录（第 59 条保管措施 + 84 号令第 41 条监测记录的台账化）
// ---------------------------------------------------------------------------

export const TEMP_SLOTS = { am: '上午', pm: '下午' };

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

/**
 * 记一笔温湿度。tempC/rhPct 为营业场所读数（按常温区+湿度区间判定）；
 * coolTempC/coldTempC 为阴凉柜/冷藏柜读数（可选，超限即亮灯）。
 * 同日同次唯一；超限的读数允许登记，但必须处置销案（处置才是记录的意义）。
 */
export function addReading(state, { dateISO, slot, tempC, rhPct, coolTempC = null, coldTempC = null, note = '' }) {
  assertISO(dateISO);
  if (!TEMP_SLOTS[slot]) throw new Error(`非法时段: ${slot}`);
  if (!isFiniteNum(tempC) || tempC < -30 || tempC > 60) throw new Error(`温度读数不合法: ${tempC}`);
  if (!isFiniteNum(rhPct) || rhPct < 0 || rhPct > 100) throw new Error(`湿度读数不合法: ${rhPct}`);
  if (coolTempC !== null && (!isFiniteNum(coolTempC) || coolTempC < -30 || coolTempC > 60)) throw new Error(`阴凉柜读数不合法: ${coolTempC}`);
  if (coldTempC !== null && (!isFiniteNum(coldTempC) || coldTempC < -30 || coldTempC > 60)) throw new Error(`冷藏柜读数不合法: ${coldTempC}`);
  if ((state.readings ?? []).some((r) => r.dateISO === dateISO && r.slot === slot)) {
    throw new Error(`${dateISO} ${TEMP_SLOTS[slot]}已有记录（同日同次唯一）；如需更正请先删除原记录`);
  }
  const L = { ...DEFAULT_LIMITS, ...(state.settings ?? {}) };
  const flags = {
    temp: tempC < L.normalMin || tempC > L.normalMax,
    rh: rhPct < L.rhMin || rhPct > L.rhMax,
    cool: coolTempC !== null && coolTempC > L.coolMax,
    cold: coldTempC !== null && (coldTempC < L.coldMin || coldTempC > L.coldMax),
  };
  state.readingSeq = (state.readingSeq ?? 0) + 1;
  const rec = {
    id: `tp-${state.readingSeq}`, dateISO, slot, tempC, rhPct,
    coolTempC, coldTempC, note: note.trim(), flags, exceeded: flags.temp || flags.rh || flags.cool || flags.cold,
    handled: false, handledISO: null, measure: '',
  };
  state.readings.push(rec);
  return rec;
}

/** 删除温湿度记录（记错自救，开放更正比逼人补假账诚实） */
export function removeReading(state, readingId) {
  const idx = (state.readings ?? []).findIndex((r) => r.id === readingId);
  if (idx < 0) throw new Error(`温湿度记录不存在: ${readingId}`);
  state.readings.splice(idx, 1);
}

/** 异常处置销案：必须写处置措施；处置日期不得早于记录日期 */
export function handleReading(state, readingId, { handledISO, measure }) {
  const rec = (state.readings ?? []).find((r) => r.id === readingId);
  if (!rec) throw new Error(`温湿度记录不存在: ${readingId}`);
  if (!rec.exceeded) throw new Error('该记录未超限，无需处置');
  if (rec.handled) throw new Error('该异常已处置销案');
  assertISO(handledISO);
  if (handledISO < rec.dateISO) throw new Error('处置日期早于记录日期');
  if (!measure || !String(measure).trim()) throw new Error('必须写明处置措施（如：开启空调降温后复测正常）');
  rec.handled = true;
  rec.handledISO = handledISO;
  rec.measure = measure.trim();
  return rec;
}

/** 未处置的异常读数（最老的在前） */
export function openExceededReadings(state) {
  return (state.readings ?? [])
    .filter((r) => r.exceeded && !r.handled)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

/** 最近一次记录日期（无记录返回 null） */
export function lastReadingISO(state) {
  const dates = (state.readings ?? []).map((r) => r.dateISO).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/**
 * 漏录点名：检查 gapDays 窗口内的过去日期（不含今天），缺上午/下午记录的天数与明细。
 * 返回 { missing: [{dateISO, slot}], missingDays, never }。
 */
export function readingGaps(state, todayISOStr, gapDays = DEFAULT_GAP_DAYS) {
  assertISO(todayISOStr);
  const byKey = new Set((state.readings ?? []).map((r) => `${r.dateISO}#${r.slot}`));
  const missing = [];
  for (let i = 1; i <= gapDays; i += 1) {
    const d = addDays(todayISOStr, -i);
    for (const slot of ['am', 'pm']) {
      if (!byKey.has(`${d}#${slot}`)) missing.push({ dateISO: d, slot });
    }
  }
  return { missing, missingDays: new Set(missing.map((m) => m.dateISO)).size, never: lastReadingISO(state) === null };
}

// ---------------------------------------------------------------------------
// 拒售登记簿（无处方不卖、不合格处方不调配——拒下的每一单都是没被罚的证据）
// ---------------------------------------------------------------------------

/** 登记一笔拒售。顾客建议只登记姓氏或尾号（最小披露，只存本机） */
export function addRefusal(state, { dateISO, customer = '', drugName = '', reason = 'other', note = '' }) {
  assertISO(dateISO);
  if (!REFUSAL_REASONS[reason]) throw new Error(`非法拒售原因: ${reason}`);
  state.refusalSeq = (state.refusalSeq ?? 0) + 1;
  const rec = { id: `rf-${state.refusalSeq}`, dateISO, customer: customer.trim(), drugName: drugName.trim(), reason, note: note.trim() };
  state.refusals.push(rec);
  return rec;
}

/** 本月拒售笔数（月报与迎检包的正面资产计数） */
export function monthlyRefusals(state, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  return (state.refusals ?? []).filter((r) => monthKey(r.dateISO) === month).length;
}

// ---------------------------------------------------------------------------
// 养护台账（检查细则「定期检查陈列存放药品，重点为近效期/拆零/易变质」的台账化）
// ---------------------------------------------------------------------------

/** 登记一次养护。发现异常品种数 >0 时必须写处置措施 */
export function addCare(state, { dateISO, found = 0, measure = '', note = '' }) {
  assertISO(dateISO);
  if (!Number.isInteger(found) || found < 0) throw new Error(`发现异常品种数必须为非负整数: ${found}`);
  if (found > 0 && !measure.trim()) throw new Error('发现异常品种必须写明处置措施（下架/隔离/退回）');
  state.careSeq = (state.careSeq ?? 0) + 1;
  const rec = { id: `cr-${state.careSeq}`, dateISO, found, measure: measure.trim(), note: note.trim() };
  state.cares.push(rec);
  return rec;
}

/** 养护钟：距下次养护还有几天；never=从未登记 */
export function careState(state, todayISOStr, careDays = DEFAULT_CARE_DAYS) {
  assertISO(todayISOStr);
  const last = (state.cares ?? []).map((c) => c.dateISO).sort().pop();
  if (!last) return { level: 'never', lastISO: null, detail: '从未登记养护' };
  const dueISO = addDays(last, careDays);
  const daysLeft = daysUntil(dueISO, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= Math.min(7, careDays) ? 'due' : 'ok';
  return { level, lastISO: last, dueISO, daysLeft, detail: `上次养护 ${last}，周期 ${careDays} 天` };
}

// ---------------------------------------------------------------------------
// 周期义务账（健康检查/温湿度计校准/药事培训，打勾自动滚动）
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
 * 八项体检。score = 100 - 红×15 - 黄×5（下限 0）。
 * items: { key, label, level: ok|warn|bad, detail }
 */
export function healthCheck(state, todayISOStr, settings = {}) {
  assertISO(todayISOStr);
  const gapDays = settings.gapDays ?? DEFAULT_GAP_DAYS;
  const careDays = settings.careDays ?? DEFAULT_CARE_DAYS;
  const warnDays = settings.warnDays ?? DEFAULT_WARN_DAYS;
  const redDays = settings.redDays ?? DEFAULT_RED_DAYS;
  const items = [];

  const lic = licenseState(state.pharmacy, todayISOStr);
  items.push({
    key: 'license', label: '药品经营许可证',
    level: lic.level === 'unset' || lic.level === 'overdue' ? 'bad' : lic.level === 'due' ? 'warn' : 'ok',
    detail: lic.detail,
  });

  const shelf = shelfBoard(state, todayISOStr, settings);
  if (shelf.expired.length) {
    items.push({
      key: 'expired', label: '过期药品在架',
      level: 'bad',
      detail: `${shelf.expired.length} 个批次已过期仍在架（第 98 条劣药；第 117 条零售不足 1 万按 1 万计罚 10~20 倍）——立即下架隔离`,
    });
  } else {
    items.push({ key: 'expired', label: '过期药品在架', level: 'ok', detail: '无过期在架批次' });
  }

  if (shelf.red.length) {
    items.push({
      key: 'near', label: `近效期红线（≤${redDays} 天）`,
      level: 'warn',
      detail: `${shelf.red.length} 个批次进入红线，建议下架隔离或专区催销（最早 ${shelf.red[0].expiryISO}）`,
    });
  } else {
    items.push({
      key: 'near', label: `近效期红线（≤${redDays} 天）`,
      level: 'ok',
      detail: shelf.warn.length ? `红线内无批次；${shelf.warn.length} 个批次在 ${warnDays} 天催销窗口` : '近效期两道线内无批次',
    });
  }

  const gaps = readingGaps(state, todayISOStr, gapDays);
  if (gaps.never) items.push({ key: 'temp-gap', label: '温湿度日双录', level: 'bad', detail: '从未记录——84 号令第 41 条监测记录还没开始' });
  else if (gaps.missing.length) items.push({ key: 'temp-gap', label: '温湿度日双录', level: gaps.missingDays >= gapDays ? 'bad' : 'warn', detail: `近 ${gapDays} 天缺 ${gaps.missing.length} 笔（${gaps.missing[0].dateISO} 缺${TEMP_SLOTS[gaps.missing[0].slot]}起）` });
  else items.push({ key: 'temp-gap', label: '温湿度日双录', level: 'ok', detail: `近 ${gapDays} 天上午/下午记录齐全` });

  const openTemp = openExceededReadings(state);
  items.push({
    key: 'temp-open', label: '温湿度异常处置',
    level: openTemp.length ? 'bad' : 'ok',
    detail: openTemp.length ? `${openTemp.length} 笔超限未处置销案（最早 ${openTemp[0].dateISO}）——超限不可怕，留痕的处置才是合规` : '超限记录全部处置销案',
  });

  const care = careState(state, todayISOStr, careDays);
  items.push({
    key: 'care', label: `月度养护（${careDays} 天）`,
    level: care.level === 'never' ? 'warn' : care.level === 'overdue' ? (care.daysLeft < -15 ? 'bad' : 'warn') : care.level === 'due' ? 'warn' : 'ok',
    detail: care.level === 'never' ? '从未登记养护（检查细则：定期检查陈列存放药品，重点为近效期/拆零/易变质）' : care.level === 'overdue' ? `养护已逾期 ${-care.daysLeft} 天` : care.level === 'due' ? `养护临期：剩 ${care.daysLeft} 天` : care.detail,
  });

  const reg = certClock(state.pharmacy?.pharmacistRegExpiryISO, todayISOStr);
  items.push({
    key: 'pharmacist', label: '药师与注册证',
    level: reg.level === 'overdue' ? 'bad' : reg.level === 'due' || reg.level === 'unset' ? 'warn' : 'ok',
    detail: reg.level === 'unset'
      ? '未登记药师注册证——经营处方药/甲类非处方药应当配备药师（84 号令第 10 条；条例第 43 条凭处方销售）'
      : `药师 ${state.pharmacy?.pharmacistName || '（未填姓名）'}：${reg.detail}`,
  });

  const board = dutyBoard(state, todayISOStr);
  const dutiesBad = board.filter((d) => d.level === 'overdue' || d.level === 'never');
  const dutiesDue = board.filter((d) => d.level === 'due');
  items.push({
    key: 'duties', label: '周期义务',
    level: board.length === 0 ? 'bad' : dutiesBad.length ? 'bad' : dutiesDue.length ? 'warn' : 'ok',
    detail: board.length === 0
      ? '三项周期义务均未登记（员工健康检查是《药品管理法》第 50 条的明文义务）'
      : dutiesBad.length
        ? `${dutiesBad.map((d) => d.label).join('、')}逾期或从未执行`
        : dutiesDue.length ? `${dutiesDue.map((d) => d.label).join('、')}临期` : '义务全部在期',
  });

  const bad = items.filter((i) => i.level === 'bad').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  return { items, bad, warn, score: Math.max(0, 100 - bad * 15 - warn * 5) };
}

// ---------------------------------------------------------------------------
// 月度小结（微信文本通道，确定性输出）
// ---------------------------------------------------------------------------

/** 月度小结：温湿度/效期/拒售/隔离报损/养护/义务 六段。month 形如 '2026-09'。 */
export function monthlySummary(state, month, todayISOStr = todayISO(), settings = {}) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  assertISO(todayISOStr);
  const inMonth = (iso) => monthKey(iso) === month;
  const shelf = shelfBoard(state, todayISOStr, settings);
  const readings = (state.readings ?? []).filter((r) => inMonth(r.dateISO));
  const exceeded = readings.filter((r) => r.exceeded);
  const openTemp = exceeded.filter((r) => !r.handled);
  const refusals = (state.refusals ?? []).filter((r) => inMonth(r.dateISO));
  const quars = (state.quarantines ?? []).filter((q) => inMonth(q.dateISO));
  const quarsOpen = quars.filter((q) => !q.closedISO);
  const outs = (state.outs ?? []).filter((o) => inMonth(o.dateISO));
  const destroys = outs.filter((o) => o.way === 'destroy');
  const returns = outs.filter((o) => o.way === 'return');
  const cares = (state.cares ?? []).filter((c) => inMonth(c.dateISO));
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => d.level === 'overdue' || d.level === 'never');
  const hc = healthCheck(state, todayISOStr, settings);

  const L = [];
  L.push(`【零售药店效期与养护月度小结】${month}`);
  if (state.pharmacy?.name) L.push(`药店：${state.pharmacy.name}`);
  L.push(`温湿度日双录 ${readings.length} 笔${readings.length ? `（最近 ${readings.map((r) => r.dateISO).sort().pop()}）` : ''}，超限 ${exceeded.length} 笔${openTemp.length ? `（${openTemp.length} 笔未处置——红灯）` : '（全部处置销案）'}`);
  L.push(`效期：过期在架 ${shelf.expired.length} 批次、红线内 ${shelf.red.length} 批次、催销窗口 ${shelf.warn.length} 批次${shelf.expired.length ? '——过期在架是劣药红线，立即隔离' : ''}`);
  L.push(`拒售登记 ${refusals.length} 笔——无处方不卖、不合格处方不调配，拒下的每一单都是没被罚的证据`);
  L.push(`下架隔离 ${quars.length} 笔${quarsOpen.length ? `（${quarsOpen.length} 笔待处置结论）` : '（全部处置销案）'}；报损销毁 ${destroys.length} 笔、退回供应商 ${returns.length} 笔`);
  L.push(`养护 ${cares.length} 次${cares.length ? `（最近 ${cares.map((c) => c.dateISO).sort().pop()}）` : ''}，发现异常 ${cares.reduce((n, c) => n + c.found, 0)} 品种`);
  if (dutiesLate.length) L.push(`⚠ 周期义务点名：${dutiesLate.map((d) => d.label).join('、')}`);
  L.push(`账本体检 ${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）`);
  L.push('口径：《药品管理法》第 50/51/53/57/58/59/98/117/126 条、《药品管理法实施条例》（2026 修订，国务院令第 828 号）第 42~44 条、《药品经营和使用质量监督管理办法》（总局令第 84 号）第 41/42 条；本小结为药店自查底稿，不替代法定报送。');
  L.push(`生成：药清账 · ${month}`);
  return {
    text: L.join('\n'), readings: readings.length, refusals: refusals.length,
    quarantines: quars.length, score: hc.score,
  };
}

// ---------------------------------------------------------------------------
// 近效期催销处置单（单文件 HTML：贴柜台/给店员照单执行）
// ---------------------------------------------------------------------------

const HTML_HEAD = (title, accent) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${title}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #1c1a2e; margin: 24px; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 6px; padding-left: 12px; border-left: 6px solid ${accent}; letter-spacing: .02em; }
  .meta { font-size: 12.5px; color: #4d5060; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 1px solid #dcdce8; color: #33306b; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 6px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e4e4ee; }
  th { color: #33306b; font-weight: 600; background: #f2f2f9; border-bottom: 2px solid #c5c5e0; }
  tr:nth-child(even) td { background: #fafafd; }
  .bad { color: #b42318; font-weight: 600; }
  .warn { color: #b54708; font-weight: 600; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>`;

/** 近效期催销处置单：过期+红线+催销窗口三档照单执行（含签字栏） */
export function clearanceHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const warnDays = settings.warnDays ?? state.settings?.warnDays ?? DEFAULT_WARN_DAYS;
  const redDays = settings.redDays ?? state.settings?.redDays ?? DEFAULT_RED_DAYS;
  const shelf = shelfBoard(state, todayISOStr, settings);
  const st = state.pharmacy ?? {};

  const ACTION = {
    expired: '立即下架隔离 → 报损销毁（劣药，不得销售）',
    red: `下架隔离或专区催销，加速动销（≤${redDays} 天）`,
    warn: '催销：先进先出、店员主推、联系调拨',
  };
  const row = (v) => `<tr>
    <td>${e(v.drugName)}${v.spec ? `（${e(v.spec)}）` : ''}</td><td>${e(v.batchNo)}</td>
    <td>${e(STORAGE_KINDS[v.storage] ?? v.storage)}</td><td>${e(v.expiryISO)}</td>
    <td>${v.daysLeft < 0 ? `<span class="bad">已过期 ${-v.daysLeft} 天</span>` : `<span class="${v.level === 'red' ? 'bad' : 'warn'}">剩 ${v.daysLeft} 天</span>`}</td>
    <td>${v.qty}</td><td>${e(ACTION[v.level])}</td>
  </tr>`;
  const rows = [...shelf.expired, ...shelf.red, ...shelf.warn].map(row).join('') || '<tr><td colspan="7">货架上没有过期、红线与催销窗口内的批次——保持</td></tr>';

  return `${HTML_HEAD(`近效期催销处置单 · ${e(st.name ?? '')}`, '#7c3aed')}
<body>
<h1>近效期催销处置单</h1>
<div class="meta">药店：${e(st.name || '—')} · 负责人：${e(st.manager || '—')} · 出单日：${e(todayISOStr)} · 红线 ≤${e(String(redDays))} 天 / 催销 ≤${e(String(warnDays))} 天</div>
<h2>处置清单（按效期升序：最先到期的先动手）</h2>
<table><tr><th>药品/规格</th><th>批号</th><th>储藏</th><th>效期至</th><th>剩余</th><th>在架</th><th>处置</th></tr>${rows}</table>
<div class="meta">口径：超过有效期的药品为劣药（《药品管理法》第 98 条），销售劣药货值 10~20 倍罚款、零售不足 1 万按 1 万计（第 117 条）——下架永远比辩解便宜；近效期两道线为参数化通识口径，说明书与属地要求永远赢。</div>
<div class="sign">质量负责人（签字）：____________　营业员（签字）：____________　日期：____________</div>
<div class="foot">生成：药清账 ShelfSheet · ${e(todayISOStr)} · 本单为门店内部处置与催销的执行底稿</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 迎检自证包（单文件 HTML：八段，含签字栏；同输入同输出）
// ---------------------------------------------------------------------------

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏） */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const st = state.pharmacy ?? {};
  const LEVEL = { overdue: '逾期', due: '临期', ok: '正常', never: '从未执行', unset: '未登记', expired: '已过期', red: '红线', warn: '催销' };
  const lic = licenseState(st, todayISOStr);
  const reg = certClock(st.pharmacistRegExpiryISO, todayISOStr);
  const shelf = shelfBoard(state, todayISOStr, settings);
  const hc = healthCheck(state, todayISOStr, settings);

  const from30 = addDays(todayISOStr, -29);
  const readings = (state.readings ?? []).filter((r) => r.dateISO >= from30)
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || (a.slot === 'am' ? -1 : 1));
  const readRows = readings.map((r) => {
    const flagTxt = r.exceeded ? (r.handled ? `<span class="warn">超限·已处置</span>` : '<span class="bad">超限·未处置</span>') : '正常';
    return `<tr>
    <td>${e(r.dateISO)} ${e(TEMP_SLOTS[r.slot])}</td><td>${r.tempC}℃</td><td>${r.rhPct}%</td>
    <td>${r.coolTempC === null || r.coolTempC === undefined ? '—' : `${r.coolTempC}℃`}</td>
    <td>${r.coldTempC === null || r.coldTempC === undefined ? '—' : `${r.coldTempC}℃`}</td>
    <td>${flagTxt}</td><td>${r.handled ? `${e(r.handledISO)}：${e(r.measure)}` : e(r.note || '—')}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="7">近 30 天无温湿度记录</td></tr>';

  const shelfRows = [...shelf.expired, ...shelf.red, ...shelf.warn].map((v) => `<tr>
    <td>${e(v.drugName)}${v.spec ? `（${e(v.spec)}）` : ''}</td><td>${e(v.batchNo)}</td>
    <td>${e(v.expiryISO)}</td><td class="${v.level === 'expired' ? 'bad' : 'warn'}">${v.daysLeft < 0 ? `已过期 ${-v.daysLeft} 天` : `剩 ${v.daysLeft} 天`}</td>
    <td>${v.qty}</td><td>${e(LEVEL[v.level] ?? v.level)}</td>
  </tr>`).join('') || '<tr><td colspan="6">过期/红线/催销窗口内无批次</td></tr>';
  const shelfSummary = `在架批次 ${shelf.batches} 个、${shelf.units} 盒（支）；过期 ${shelf.expired.length}、红线 ${shelf.red.length}、催销 ${shelf.warn.length}`;

  const rfRows = [...(state.refusals ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((r) => `<tr>
    <td>${e(r.dateISO)}</td><td>${e(r.customer || '—')}</td><td>${e(r.drugName || '—')}</td>
    <td>${e(REFUSAL_REASONS[r.reason] ?? r.reason)}</td><td>${e(r.note || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="5">无拒售登记</td></tr>';

  const qtRows = [...(state.quarantines ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((q) => `<tr>
    <td>${e(q.dateISO)}</td><td>${e(q.drugName)}</td><td>${e(q.batchNo)}</td><td>${q.qty}</td>
    <td>${q.closedISO ? `${e(q.closedISO)}：${e(QUAR_ACTIONS[q.action] ?? q.action)}` : '<span class="bad">待处置</span>'}</td>
  </tr>`).join('') || '<tr><td colspan="5">无隔离记录</td></tr>';

  const careRows = [...(state.cares ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20).map((c) => `<tr>
    <td>${e(c.dateISO)}</td><td>${c.found}</td><td>${e(c.measure || '—')}</td><td>${e(c.note || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="4">无养护记录</td></tr>';

  const duRows = dutyBoard(state, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastDoneISO ? e(d.lastDoneISO) : '—'}</td>
    <td>${d.nextDue ? e(d.nextDue) : '—'}</td><td>${e(LEVEL[d.level] ?? d.level)}</td><td>${e(d.basis)}</td>
  </tr>`).join('') || '<tr><td colspan="5">未登记周期义务</td></tr>';

  return `${HTML_HEAD(`药店迎检自证包 · ${e(st.name ?? '')}`, '#7c3aed')}
<body>
<h1>零售药店迎检自证包 · ${e(st.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 许可证：${e(st.licenseNo || '未登记')} · 负责人：${e(st.manager || '—')} · 药师：${e(st.pharmacistName || '—')} · ${e(st.address || '地址未填')}</div>
<h2>一、许可与人员（条例第 42 条许可证 5 年 / 84 号令第 10 条药师配备）</h2>
<div class="meta">许可证：${e(lic.detail)}（${e(LEVEL[lic.level] ?? lic.level)}） · 药师注册证：${e(reg.detail)}（${e(LEVEL[reg.level] ?? reg.level)}） · 体检 ${e(String(hc.score))} 分（红 ${hc.bad} · 黄 ${hc.warn}）</div>
<h2>二、效期台账（过期/红线/催销三档点名：《药品管理法》第 57、98、117 条）</h2>
<div class="meta">${e(shelfSummary)}</div>
<table><tr><th>药品/规格</th><th>批号</th><th>效期至</th><th>剩余</th><th>在架</th><th>档位</th></tr>${shelfRows}</table>
<h2>三、温湿度监测记录（近 30 天：每日上午/下午——《药品管理法》第 59 条、84 号令第 41 条）</h2>
<table><tr><th>日期/时段</th><th>场所温度</th><th>湿度</th><th>阴凉柜</th><th>冷藏柜</th><th>判定</th><th>处置/备注</th></tr>${readRows}</table>
<h2>四、拒售登记簿（凭处方销售处方药：条例第 43 条、84 号令第 42 条——拒下的每一单都是没被罚的证据）</h2>
<table><tr><th>日期</th><th>顾客</th><th>药品</th><th>原因</th><th>备注</th></tr>${rfRows}</table>
<h2>五、下架隔离与处置（不合格药品处理：隔离 → 销毁/退货留痕）</h2>
<table><tr><th>隔离日</th><th>药品</th><th>批号</th><th>数量</th><th>处置结论</th></tr>${qtRows}</table>
<h2>六、养护台账（检查细则：定期检查陈列存放药品，重点为近效期/拆零/易变质）</h2>
<table><tr><th>日期</th><th>发现异常品种</th><th>处置措施</th><th>备注</th></tr>${careRows}</table>
<h2>七、周期义务台账（健康检查 / 温湿度计校准 / 药事培训）</h2>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<h2>八、账本体检（${hc.items.length} 项）</h2>
<table><tr><th>项目</th><th>灯</th><th>说明</th></tr>${hc.items.map((i) => `<tr><td>${e(i.label)}</td><td class="${i.level === 'bad' ? 'bad' : i.level === 'warn' ? 'warn' : ''}">${i.level === 'bad' ? '红' : i.level === 'warn' ? '黄' : '绿'}</td><td>${e(i.detail)}</td></tr>`).join('')}</table>
<div class="sign">药店负责人（签字/盖章）：____________　质量负责人（签字）：____________　日期：____________</div>
<div class="foot">生成：药清账 ShelfSheet · ${e(todayISOStr)} · 本页为药店自查与迎检备查材料，不替代法定报送、许可证件与追溯系统记录；持续合规对口《药品管理法》第 53 条，温区限值与近效期阈值为参数化口径、说明书标示与属地要求永远赢</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'shelfsheet', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'shelfsheet') return { ok: false, error: '不是药清账的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.pharmacy === 'object' && s.pharmacy !== null &&
    arr(s.drugs) && arr(s.batches) && arr(s.outs) && arr(s.quarantines) &&
    arr(s.readings) && arr(s.refusals) && arr(s.cares) && arr(s.duties) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
