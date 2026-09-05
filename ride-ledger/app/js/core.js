/**
 * core.js — 车销单 RideLedger 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；金额一律整数「分」运算；日期统一 ISO 字符串 yyyy-mm-dd；
 * 库存不落库——批次剩余 = 进货量 − Σ销售分配 − Σ报损，由流水唯一派生（账实恒等式）；
 * 质保期从**售出日**起算（库存没有保质期，卖出去那天才开始计时）。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md）：
 * - 《电动自行车安全隐患全链条整治行动方案》（2024 部署、2025 巩固）地方执行口径：
 *   督促销售企业建立并落实**进货检查验收制度**、组织安全承诺签约、**完善购销台账**，
 *   严格核查产品合格证明与强制性产品认证（CCC）信息，**严禁将电动自行车整车与
 *   蓄电池拆分销售**，严打拆改限速、改装蓄电池等；推行「一车一池一充一码」
 * - 《商务部等5部门关于做好2025年度电动自行车以旧换新工作的通知》及解读：
 *   销售门店做到政策图解、价格公示、监督电话、承诺书「四上墙」；交售的老旧电动
 *   自行车**必须交由具备相关资质的回收企业报废处置，并完善台账管理**（旧车回收
 *   台账参考字段：旧车品牌、车架号/车牌号、电池数量、电池重量、回收企业）
 * - 整治阶段性成效（新华社口径）：全国办理案件 6.1 万起、查处非法改装黑作坊 3473 家；
 *   2025 年 8.2 万家销售门店参加以旧换新、平均拉动单店销售 30.2 万元（商务部口径）
 * 本工具是门店自己的经营底账与迎检/自证凭据，不构成法律意见，不替代监管平台报送；
 * 属地条例（如各省电动自行车管理条例的改装罚则）永远赢。
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

/** 日期加 n 个月（月末钳制：2026-01-31 加 1 个月 = 2026-02-28） */
export function addMonths(iso, n) {
  assertISO(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/** 距目标日还有几天（负数=已过） */
export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO);
  assertISO(todayISOStr);
  const ms = new Date(`${targetISO}T00:00:00Z`) - new Date(`${todayISOStr}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** 'YYYY-MM' 月份键 */
export function monthKey(iso) {
  assertISO(iso);
  return iso.slice(0, 7);
}

/** 金额：整数分 → 「¥129.00」 */
export function fmtYuan(cents) {
  if (!Number.isInteger(cents)) throw new Error(`金额必须为整数分: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 商品档案模型
// ---------------------------------------------------------------------------

/** 商品类别：ebike 整车（CCC 必填）/ battery 蓄电池（一车一池）/ charger 充电器 / helmet 头盔 / parts 配件 */
export const PRODUCT_KINDS = {
  ebike: { label: '整车' },
  battery: { label: '电池' },
  charger: { label: '充电器' },
  helmet: { label: '头盔' },
  parts: { label: '配件' },
};

/** 整车强制性产品认证（CCC）证号的最小登记长度（宽松格式校验，真伪以认监委查询为准） */
export const CCC_MIN_LEN = 6;
/** 质保临期默认窗：售出后 N 天内到保的顾客名单（主动售后触点，设置页可覆盖） */
export const DEFAULT_WARRANTY_WINDOW_DAYS = 60;

function requireRef(repos, id, label) {
  const hit = (repos ?? []).find((x) => x.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

function nonEmpty(value, message) {
  const v = String(value ?? '').trim();
  if (!v) throw new Error(message);
  return v;
}

/**
 * 新建商品档案。product: { id, name, kind, brand, model, cccNo, spec, unit, maker, warrantyMonths, note }
 * - 整车（ebike）必须登记 CCC 认证证号——进货查验制度的第一个动作就是核对 3C；
 *   没有证号的整车不得建档销售（如是二手/改装车，本工具拒绝为它建档案）
 * - warrantyMonths：质保期（月），0 表示无质保承诺——售后与临保触点都由它驱动
 */
export function addProduct(state, product) {
  const name = nonEmpty(product.name, '商品名称必填');
  if (!PRODUCT_KINDS[product.kind]) throw new Error(`未知商品类别: ${product.kind}`);
  let cccNo = String(product.cccNo ?? '').trim();
  if (product.kind === 'ebike') {
    cccNo = nonEmpty(cccNo, '整车必须登记 CCC 认证证号（合格证/铭牌上）——无 3C 不得建档销售');
    if (cccNo.length < CCC_MIN_LEN) throw new Error(`CCC 证号过短（≥${CCC_MIN_LEN} 位）: ${cccNo}`);
  }
  const warrantyMonths = Number(product.warrantyMonths ?? 0);
  const item = {
    id: product.id,
    name,
    kind: product.kind,
    brand: String(product.brand ?? '').trim(),
    model: String(product.model ?? '').trim(),
    cccNo,
    spec: String(product.spec ?? '').trim(),
    unit: String(product.unit ?? '').trim() || '件',
    maker: String(product.maker ?? '').trim(),
    warrantyMonths: Number.isInteger(warrantyMonths) && warrantyMonths >= 0 && warrantyMonths <= 120 ? warrantyMonths : 0,
    note: String(product.note ?? '').trim(),
  };
  state.products.push(item);
  return item;
}

// ---------------------------------------------------------------------------
// 进货落账（进货查验 + 购销台账的进端）
// ---------------------------------------------------------------------------

/**
 * 进货建批。entry: { id, productId, supplierId, inISO, qty, unitCostCents, lotNo, traceCode, note }
 * - traceCode：整车批次可填本批首枚整车编码、电池批次填首枚电池编码（一车一池的进端锚点）
 * - 库存不落库：批次剩余由流水派生（见 batchRemaining）
 */
export function applyIntake(state, entry) {
  const product = requireRef(state.products, entry.productId, '商品');
  if (product.kind === 'ebike' && String(product.cccNo ?? '').length < CCC_MIN_LEN) {
    throw new Error(`整车「${product.name}」缺 CCC 证号，拒绝进货——先补档案再做进货查验`);
  }
  assertISO(entry.inISO);
  if (!Number.isInteger(entry.qty) || entry.qty < 1) {
    throw new Error(`进货数量应为正整数: ${entry.qty}`);
  }
  if (entry.unitCostCents !== null && entry.unitCostCents !== undefined && !Number.isInteger(entry.unitCostCents)) {
    throw new Error(`进货单价必须为整数分: ${entry.unitCostCents}`);
  }
  const batch = {
    id: entry.id,
    productId: entry.productId,
    supplierId: entry.supplierId || '',
    inISO: entry.inISO,
    qty: entry.qty,
    unitCostCents: entry.unitCostCents ?? null,
    lotNo: String(entry.lotNo ?? '').trim(),
    traceCode: String(entry.traceCode ?? '').trim(),
    note: String(entry.note ?? '').trim(),
  };
  state.batches.push(batch);
  return batch;
}

// ---------------------------------------------------------------------------
// 库存派生（唯一事实 = 进货 qty；销售与报损都是流水）
// ---------------------------------------------------------------------------

/** 批次剩余 = 进货量 − Σ销售分配 − Σ报损 */
export function batchRemaining(state, batchId) {
  const batch = requireRef(state.batches, batchId, '批次');
  let sold = 0;
  for (const s of state.sales ?? []) {
    for (const it of s.items) {
      for (const a of it.allocations) {
        if (a.batchId === batchId) sold += a.qty;
      }
    }
  }
  let lost = 0;
  for (const l of state.losses ?? []) {
    if (l.batchId === batchId) lost += l.qty;
  }
  const remaining = batch.qty - sold - lost;
  if (remaining < 0) throw new Error(`批次 ${batchId} 账实为负（进货 ${batch.qty} − 已售 ${sold} − 报损 ${lost}），账本被破坏`);
  return remaining;
}

/** 某商品的可售批次队列：先进先出（同进货日按建档序）——卖出的每件都能追到进货来源 */
export function sellableBatches(state, productId) {
  return state.batches
    .filter((b) => b.productId === productId)
    .filter((b) => batchRemaining(state, b.id) > 0)
    .sort((a, b) => (a.inISO !== b.inISO
      ? a.inISO.localeCompare(b.inISO)
      : a.id.localeCompare(b.id)));
}

/** 商品可用库存 */
export function stockOf(state, productId) {
  return sellableBatches(state, productId).reduce((sum, b) => sum + batchRemaining(state, b.id), 0);
}

// ---------------------------------------------------------------------------
// 销售落账（车架号/电池码强制 + 拆分销售警示 + 质保起算）
// ---------------------------------------------------------------------------

/**
 * 卖单落账。sale: { id, dateISO, buyerName, buyerPhone, note,
 *                   items: [{ productId, qty, priceCents, frameNos?, batteryCodes? }] }
 * - 整车行必须登记**整车编码（车架号）**——上牌、以旧换新、事故倒查都认它
 * - 电池行必须登记**电池编码**——「一车一池一码」的销端锚点
 * - 任何一品库存不足 → 整单拒绝，绝不部分入账
 * - 非阻断 warnings（同单返回）：电池多于整车、单卖电池未备注用途——「严禁整车与
 *   蓄电池拆分销售」的提示灯，属地执法口径永远赢
 */
export function applySale(state, sale) {
  assertISO(sale.dateISO);
  if (!Array.isArray(sale.items) || sale.items.length === 0) throw new Error('卖单至少包含一个商品行');
  const seen = new Set();
  for (const it of sale.items) {
    if (seen.has(it.productId)) throw new Error('同一商品在一单中重复出现，请合并数量');
    seen.add(it.productId);
    if (!Number.isInteger(it.qty) || it.qty < 1) throw new Error(`销售数量应为正整数: ${it.qty}`);
    if (it.priceCents !== null && it.priceCents !== undefined && !Number.isInteger(it.priceCents)) {
      throw new Error(`销售单价必须为整数分: ${it.priceCents}`);
    }
  }
  // 第一遍：校验与分配（不改任何状态；任何错误都在这里抛出）
  const plan = sale.items.map((it) => {
    const product = requireRef(state.products, it.productId, '商品');
    const frameNos = (it.frameNos ?? []).map((x) => String(x).trim()).filter(Boolean);
    const batteryCodes = (it.batteryCodes ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (product.kind === 'ebike' && frameNos.length === 0) {
      throw new Error(`「${product.name}」为整车：须登记整车编码（车架号，合格证上）后落账`);
    }
    if (product.kind === 'battery' && batteryCodes.length === 0) {
      throw new Error(`「${product.name}」为蓄电池：须登记电池编码（一车一池一码）后落账`);
    }
    if (product.kind === 'ebike' && String(product.cccNo ?? '').length < CCC_MIN_LEN) {
      throw new Error(`「${product.name}」缺 CCC 证号，不得销售（只可能来自导入数据）`);
    }
    const queue = sellableBatches(state, it.productId);
    let want = it.qty;
    const allocations = [];
    for (const b of queue) {
      if (want <= 0) break;
      const take = Math.min(want, batchRemaining(state, b.id));
      if (take > 0) allocations.push({ batchId: b.id, qty: take });
      want -= take;
    }
    if (want > 0) {
      const onHand = it.qty - want;
      throw new Error(`「${product.name}」可售库存不足：要卖 ${it.qty}${product.unit}，可用 ${onHand}${product.unit}——整单未入账`);
    }
    return {
      productId: it.productId,
      qty: it.qty,
      priceCents: it.priceCents ?? null,
      frameNos,
      batteryCodes,
      allocations,
    };
  });
  // 第二遍：统一落账 + 非阻断警示
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const warnings = [];
  const ebikeQty = plan.filter((it) => productById.get(it.productId)?.kind === 'ebike')
    .reduce((sum, it) => sum + it.qty, 0);
  const batteryQty = plan.filter((it) => productById.get(it.productId)?.kind === 'battery')
    .reduce((sum, it) => sum + it.qty, 0);
  const hasNote = String(sale.note ?? '').trim().length > 0;
  if (ebikeQty > 0 && batteryQty > ebikeQty) {
    warnings.push(`本单电池（${batteryQty}）多于整车（${ebikeQty}）——整治行动严禁将整车与蓄电池拆分销售，如属旧车换电池请在备注写明用途`);
  }
  if (ebikeQty === 0 && batteryQty > 0 && !hasNote) {
    warnings.push('单卖电池未备注用途——请写明「旧车换电池/原厂增配」等，避免被认定为拆分销售');
  }
  const record = {
    id: sale.id,
    dateISO: sale.dateISO,
    buyerName: String(sale.buyerName ?? '').trim(),
    buyerPhone: String(sale.buyerPhone ?? '').trim(),
    note: String(sale.note ?? '').trim(),
    warnings,
    items: plan,
  };
  state.sales.push(record);
  return record;
}

/** 撤销卖单：直接移除流水——剩余量由流水派生，撤销即自动精确回滚 */
export function removeSale(state, saleId) {
  const idx = state.sales.findIndex((s) => s.id === saleId);
  if (idx < 0) throw new Error(`卖单不存在: ${saleId}`);
  state.sales.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 质保引擎（从售出日起算：临保 = 主动售后触点与换新线索；过保 = 售后判责依据）
// ---------------------------------------------------------------------------

function warrantyRows(state, todayISOStr) {
  assertISO(todayISOStr);
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const rows = [];
  for (const s of state.sales ?? []) {
    for (const it of s.items) {
      const p = productById.get(it.productId);
      if (!p || !p.warrantyMonths) continue;
      const until = addMonths(s.dateISO, p.warrantyMonths);
      rows.push({
        saleId: s.id,
        dateISO: s.dateISO,
        buyerName: s.buyerName,
        buyerPhone: s.buyerPhone,
        productId: p.id,
        productName: p.name,
        frameNos: it.frameNos,
        batteryCodes: it.batteryCodes,
        warrantyMonths: p.warrantyMonths,
        until,
        daysLeft: daysUntil(until, todayISOStr),
      });
    }
  }
  return rows;
}

/** 临保质保：N 天内到保——联系顾客做免费安检，事故防在前、换新线索到手 */
export function expiringWarranties(state, todayISOStr, windowDays = DEFAULT_WARRANTY_WINDOW_DAYS) {
  return warrantyRows(state, todayISOStr)
    .filter((r) => r.daysLeft >= 0 && r.daysLeft <= windowDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 已过保：顾客回来修车时，是不是本店责任先看这张名单 */
export function expiredWarranties(state, todayISOStr) {
  return warrantyRows(state, todayISOStr)
    .filter((r) => r.daysLeft < 0)
    .sort((a, b) => b.daysLeft - a.daysLeft);
}

// ---------------------------------------------------------------------------
// 以旧换新旧车回收台账（商务部口径：交资质企业报废处置 + 完善台账管理）
// ---------------------------------------------------------------------------

/**
 * 旧车回收落账。entry: { id, dateISO, buyerName, oldBrand, oldFrameNo, batteryCount,
 *                        batteryWeightKg, recyclerId, saleId, subsidyCents, note }
 * - oldFrameNo 必填（旧车车架号/车牌号——补贴核验与流向追溯的字段）
 * - 未关联资质回收企业 → 非阻断提示（旧车必须交由具备相关资质的回收企业报废处置）
 */
export function addTradeIn(state, entry) {
  assertISO(entry.dateISO);
  const oldFrameNo = nonEmpty(entry.oldFrameNo, '旧车车架号/车牌号必填——补贴核验认它');
  if (entry.batteryCount !== null && entry.batteryCount !== undefined && (!Number.isInteger(entry.batteryCount) || entry.batteryCount < 0)) {
    throw new Error(`电池数量应为非负整数: ${entry.batteryCount}`);
  }
  if (entry.subsidyCents !== null && entry.subsidyCents !== undefined && !Number.isInteger(entry.subsidyCents)) {
    throw new Error(`补贴金额必须为整数分: ${entry.subsidyCents}`);
  }
  const saleId = String(entry.saleId ?? '').trim();
  if (saleId && !(state.sales ?? []).some((s) => s.id === saleId)) {
    throw new Error(`关联卖单不存在: ${saleId}`);
  }
  if (saleId && (state.tradeins ?? []).some((t) => t.saleId === saleId && t.id !== entry.id)) {
    throw new Error(`卖单 ${saleId} 已关联过一笔回收，请核对`);
  }
  const recyclerId = String(entry.recyclerId ?? '').trim();
  const record = {
    id: entry.id,
    dateISO: entry.dateISO,
    buyerName: String(entry.buyerName ?? '').trim(),
    oldBrand: String(entry.oldBrand ?? '').trim(),
    oldFrameNo,
    batteryCount: entry.batteryCount ?? null,
    batteryWeightKg: entry.batteryWeightKg === null || entry.batteryWeightKg === undefined || entry.batteryWeightKg === ''
      ? null : Number(entry.batteryWeightKg),
    recyclerId,
    saleId,
    subsidyCents: entry.subsidyCents ?? null,
    note: String(entry.note ?? '').trim(),
  };
  state.tradeins.push(record);
  return { record, warning: recyclerId ? null : '未登记回收企业——旧车必须交由具备相关资质的回收企业报废处置（商务部以旧换新口径）' };
}

/** 撤销回收记录 */
export function removeTradeIn(state, tradeInId) {
  const idx = state.tradeins.findIndex((t) => t.id === tradeInId);
  if (idx < 0) throw new Error(`回收记录不存在: ${tradeInId}`);
  state.tradeins.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 报损（运输破损 / 其他出库）
// ---------------------------------------------------------------------------

/** 报损落账。reason: 'damaged' 破损 | 'other' 其他 */
export function recordLoss(state, { id, dateISO, batchId, qty, reason, note = '' }) {
  assertISO(dateISO);
  if (!['damaged', 'other'].includes(reason)) throw new Error(`未知报损原因: ${reason}`);
  if (!Number.isInteger(qty) || qty < 1) throw new Error(`报损数量应为正整数: ${qty}`);
  const remaining = batchRemaining(state, batchId);
  if (qty > remaining) throw new Error(`报损数量超过批次剩余（剩 ${remaining}），拒绝入账`);
  const loss = { id, dateISO, batchId, qty, reason, note: String(note ?? '').trim() };
  state.losses.push(loss);
  return loss;
}

// ---------------------------------------------------------------------------
// 账本体检（迎检自查：查验缺项 / 台账缺项 / 守恒）
// ---------------------------------------------------------------------------

/** 账实守恒：Σ进货 == Σ已售 + Σ报损 + Σ库存（剩余）。返回总量与残差 */
export function conservation(state) {
  const inQty = state.batches.reduce((s, b) => s + b.qty, 0);
  const soldQty = (state.sales ?? []).reduce((s, x) => s + x.items.reduce((t, it) => t + it.qty, 0), 0);
  const lossQty = (state.losses ?? []).reduce((s, x) => s + x.qty, 0);
  const stockQty = state.batches.reduce((s, b) => s + batchRemaining(state, b.id), 0);
  return { inQty, soldQty, lossQty, stockQty, residual: inQty - soldQty - lossQty - stockQty };
}

/**
 * 合规自查：迎检前先自扫一遍（全部为「台账缺项」类问题，就地补录即可消除）。
 * - missingCCC：整车商品档案缺 CCC 证号（只可能来自导入数据，建档时已强制）
 * - missingFrameNo / missingBatteryCode：历史卖单缺整车编码/电池编码
 * - tradeinNoRecycler：回收台账未关联资质回收企业
 */
export function complianceAudit(state) {
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const missingCCC = state.products
    .filter((p) => p.kind === 'ebike' && String(p.cccNo ?? '').length < CCC_MIN_LEN)
    .map((p) => ({ productId: p.id, name: p.name }));
  const missingFrameNo = [];
  const missingBatteryCode = [];
  for (const s of state.sales ?? []) {
    for (const it of s.items) {
      const p = productById.get(it.productId);
      if (p?.kind === 'ebike' && (it.frameNos ?? []).length === 0) {
        missingFrameNo.push({ saleId: s.id, dateISO: s.dateISO, productName: p.name });
      }
      if (p?.kind === 'battery' && (it.batteryCodes ?? []).length === 0) {
        missingBatteryCode.push({ saleId: s.id, dateISO: s.dateISO, productName: p.name });
      }
    }
  }
  const tradeinNoRecycler = (state.tradeins ?? [])
    .filter((t) => !t.recyclerId)
    .map((t) => ({ tradeInId: t.id, dateISO: t.dateISO, oldFrameNo: t.oldFrameNo }));
  return { missingCCC, missingFrameNo, missingBatteryCode, tradeinNoRecycler };
}

// ---------------------------------------------------------------------------
// 台账导出（进货 / 销售 / 旧车回收 / 自证单 / 迎检打印包）
// ---------------------------------------------------------------------------

/** 采购台账行（进货查验口径，时间倒序） */
export function purchaseLedgerRows(state) {
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const supplierById = new Map((state.suppliers ?? []).map((s) => [s.id, s.name]));
  return [...state.batches]
    .sort((a, b) => b.inISO.localeCompare(a.inISO) || b.id.localeCompare(a.id))
    .map((b) => {
      const p = productById.get(b.productId);
      return {
        inISO: b.inISO,
        name: p?.name ?? '?',
        kind: p?.kind ?? '?',
        brand: p?.brand ?? '',
        model: p?.model ?? '',
        cccNo: p?.cccNo ?? '',
        spec: p?.spec ?? '',
        unit: p?.unit ?? '件',
        qty: b.qty,
        maker: p?.maker ?? '',
        supplier: supplierById.get(b.supplierId) ?? b.supplierId ?? '',
        lotNo: b.lotNo,
        traceCode: b.traceCode,
      };
    });
}

/** 销售台账行（购销台账销端口径，时间倒序；整车带车架号、电池带编码） */
export function saleLedgerRows(state) {
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const rows = [];
  for (const s of state.sales ?? []) {
    for (const it of s.items) {
      const p = productById.get(it.productId);
      rows.push({
        dateISO: s.dateISO,
        name: p?.name ?? '?',
        kind: p?.kind ?? '?',
        spec: p?.spec ?? '',
        unit: p?.unit ?? '件',
        qty: it.qty,
        maker: p?.maker ?? '',
        buyerName: s.buyerName,
        buyerPhone: s.buyerPhone,
        frameNos: it.frameNos,
        batteryCodes: it.batteryCodes,
        priceCents: it.priceCents,
        amountCents: it.priceCents === null ? null : it.priceCents * it.qty,
      });
    }
  }
  return rows.sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

/** 旧车回收台账行（商务部口径字段，时间倒序） */
export function tradeinRows(state) {
  const recyclerById = new Map((state.recyclers ?? []).map((r) => [r.id, r.name]));
  return [...(state.tradeins ?? [])]
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id))
    .map((t) => ({
      dateISO: t.dateISO,
      buyerName: t.buyerName,
      oldBrand: t.oldBrand,
      oldFrameNo: t.oldFrameNo,
      batteryCount: t.batteryCount,
      batteryWeightKg: t.batteryWeightKg,
      recycler: recyclerById.get(t.recyclerId) ?? t.recyclerId ?? '',
      saleId: t.saleId,
      subsidyCents: t.subsidyCents,
      note: t.note,
    }));
}

/** 进货台账文本（微信/打印两用，确定性输出） */
export function purchaseLedgerText({ state, todayISOStr = todayISO(), limit = 40 }) {
  const L = [];
  L.push(`【进货台账】${state.shop?.name ?? ''}${state.shop?.licenseNo ? `（统一社会信用代码 ${state.shop.licenseNo}）` : ''}`);
  L.push(`截至 ${todayISOStr}（依电动自行车安全隐患全链条整治「进货查验 + 购销台账」要求整理）`);
  L.push('');
  const rows = purchaseLedgerRows(state);
  if (rows.length === 0) {
    L.push('（暂无进货记录）');
  } else {
    rows.slice(0, limit).forEach((r) => {
      L.push(`- ${r.inISO} ${r.name}${r.spec ? `（${r.spec}）` : ''} × ${r.qty}${r.unit}${r.cccNo ? `｜3C ${r.cccNo}` : ''}｜生产企业：${r.maker || '—'}｜供货：${r.supplier || '—'}${r.lotNo ? `｜批号 ${r.lotNo}` : ''}${r.traceCode ? `｜首码 ${r.traceCode}` : ''}`);
    });
    if (rows.length > limit) L.push(`……更早 ${rows.length - limit} 条见打印版台账`);
  }
  L.push('');
  L.push(`生成：车销单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 销售台账文本（整车带车架号、电池带编码；确定性输出） */
export function saleLedgerText({ state, todayISOStr = todayISO(), limit = 40 }) {
  const L = [];
  L.push(`【销售台账】${state.shop?.name ?? ''}${state.shop?.licenseNo ? `（统一社会信用代码 ${state.shop.licenseNo}）` : ''}`);
  L.push(`截至 ${todayISOStr}（整车登记车架号、电池登记电池编码——一车一池一码）`);
  L.push('');
  const rows = saleLedgerRows(state);
  if (rows.length === 0) {
    L.push('（暂无销售记录）');
  } else {
    rows.slice(0, limit).forEach((r) => {
      L.push(`- ${r.dateISO} ${r.name}${r.spec ? `（${r.spec}）` : ''} × ${r.qty}${r.unit}${r.priceCents !== null ? ` @ ${fmtYuan(r.priceCents)}` : ''}｜购买人：${r.buyerName || '散客'}${r.frameNos?.length ? `｜车架号 ${r.frameNos.join('、')}` : ''}${r.batteryCodes?.length ? `｜电池编码 ${r.batteryCodes.join('、')}` : ''}`);
    });
    if (rows.length > limit) L.push(`……更早 ${rows.length - limit} 条见打印版台账`);
  }
  L.push('');
  L.push(`生成：车销单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 旧车回收台账文本（补贴核验与流向备查） */
export function tradeinLedgerText({ state, todayISOStr = todayISO(), limit = 40 }) {
  const L = [];
  L.push(`【旧车回收台账】${state.shop?.name ?? ''}`);
  L.push(`截至 ${todayISOStr}（交售旧车须交由具备相关资质的回收企业报废处置——商务部以旧换新口径）`);
  L.push('');
  const rows = tradeinRows(state);
  if (rows.length === 0) {
    L.push('（暂无回收记录）');
  } else {
    rows.slice(0, limit).forEach((r) => {
      L.push(`- ${r.dateISO} ${r.buyerName || '散客'} 交售 ${r.oldBrand || '旧车'}（车架号/车牌 ${r.oldFrameNo}）｜电池 ${r.batteryCount ?? '—'} 组${r.batteryWeightKg ? ` ${r.batteryWeightKg}kg` : ''}｜回收企业：${r.recycler || '未登记'}${r.subsidyCents !== null ? `｜补贴 ${fmtYuan(r.subsidyCents)}` : ''}${r.saleId ? `｜关联新售单 ${r.saleId}` : ''}`);
    });
    if (rows.length > limit) L.push(`……更早 ${rows.length - limit} 条见打印版台账`);
  }
  L.push('');
  L.push(`生成：车销单 · ${todayISOStr}`);
  return L.join('\n');
}

/**
 * 自证单：按购买人姓名（可再限日期）捞出卖车记录与三要素——车架号、电池编码、3C 证号。
 * 电池起火、事故倒查时，门店要说清"卖的是谁、哪辆车、什么电池、哪批进货"。
 */
export function proofOfSale(state, { buyerName, dateISO = null, todayISOStr = todayISO() }) {
  const key = String(buyerName ?? '').trim();
  if (!key) throw new Error('请填写购买人姓名');
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const batchById = new Map(state.batches.map((b) => [b.id, b]));
  const matched = (state.sales ?? [])
    .filter((s) => s.buyerName === key && (dateISO === null || s.dateISO === dateISO))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const L = [];
  L.push(`【销售凭据（自证单）】购买人：${key}`);
  L.push(`门店：${state.shop?.name ?? ''}${state.shop?.licenseNo ? `（统一社会信用代码 ${state.shop.licenseNo}）` : ''}`);
  L.push(`出具日：${todayISOStr}${dateISO ? `（限定查询日 ${dateISO}）` : ''}`);
  L.push('');
  if (matched.length === 0) {
    L.push(`（本店台账中未查到 ${key} 名下的销售记录${dateISO ? `（${dateISO}）` : ''}）`);
  }
  for (const s of matched) {
    L.push(`■ ${s.dateISO} 购买人 ${s.buyerName || '散客'}${s.buyerPhone ? `（电话 ${s.buyerPhone}）` : ''}`);
    for (const it of s.items) {
      const p = productById.get(it.productId);
      L.push(`  - ${p?.name ?? '?'}${p?.spec ? `（${p.spec}）` : ''} × ${it.qty}${p?.unit ?? '件'}｜生产企业：${p?.maker || '—'}${p?.cccNo ? `｜CCC ${p.cccNo}` : ''}${it.frameNos?.length ? `｜车架号 ${it.frameNos.join('、')}` : ''}${it.batteryCodes?.length ? `｜电池编码 ${it.batteryCodes.join('、')}` : ''}`);
      for (const a of it.allocations) {
        const b = batchById.get(a.batchId);
        if (!b) continue;
        L.push(`    · 批次：进货 ${b.inISO}${b.lotNo ? `｜批号 ${b.lotNo}` : ''}${b.traceCode ? `｜首码 ${b.traceCode}` : ''}`);
      }
    }
    if (s.note) L.push(`  备注：${s.note}`);
  }
  L.push('');
  L.push('本单依据门店购销台账出具，商品信息以实物合格证与铭牌为准；本店承诺不非法改装、整车与蓄电池不拆分销售。');
  L.push(`生成：车销单 · ${todayISOStr}`);
  return { text: L.join('\n'), count: matched.length };
}

/** 库存盘点行（迎检打印包用） */
function inventoryRows(state) {
  const productById = new Map(state.products.map((p) => [p.id, p]));
  return [...state.batches]
    .map((b) => ({
      name: productById.get(b.productId)?.name ?? '?',
      lotNo: b.lotNo,
      traceCode: b.traceCode,
      inISO: b.inISO,
      remaining: batchRemaining(state, b.id),
    }))
    .filter((r) => r.remaining > 0)
    .sort((a, b) => a.inISO.localeCompare(b.inISO));
}

/** 迎检打印包：单文件 HTML（店铺承诺 + 体检 + 进货/销售/回收台账 + 库存盘点），无外部资源 */
export function inspectionHtml({ state, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const buys = purchaseLedgerRows(state);
  const sells = saleLedgerRows(state);
  const trades = tradeinRows(state);
  const inv = inventoryRows(state);
  const cons = conservation(state);
  const audit = complianceAudit(state);
  const auditIssues = audit.missingCCC.length + audit.missingFrameNo.length + audit.missingBatteryCode.length + audit.tradeinNoRecycler.length;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>购销台账迎检包 · ${e(state.shop?.name ?? '')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; }
  th { color: #555; font-weight: 500; }
  .flag { color: #b91c1c; font-weight: 600; }
  .ok { color: #1d4ed8; }
  .foot { margin-top: 14px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>购销台账迎检包 · ${e(state.shop?.name ?? '')}</h1>
<div class="meta">统一社会信用代码：${e(state.shop?.licenseNo ?? '未填写')} · 联系电话：${e(state.shop?.phone ?? '')} · 截至 ${e(todayISOStr)}</div>
<div class="meta">本店承诺：严格执行进货检查验收制度，不销售无 CCC 认证或不合格车辆，不非法改装（拆改限速/改装蓄电池/外设蓄电池托架），整车与蓄电池不拆分销售。</div>
<div class="meta">账本体检：进货 ${cons.inQty} ＝ 已售 ${cons.soldQty} ＋ 报损 ${cons.lossQty} ＋ 库存 ${cons.stockQty}${cons.residual === 0 ? '<span class="ok">（账实一致）</span>' : `<span class="flag">（残差 ${cons.residual}，请核查）</span>`}${auditIssues === 0 ? '<span class="ok"> · 台账缺项 0</span>' : `<span class="flag"> · 台账缺项 ${auditIssues} 处（${audit.missingCCC.length} 档案3C / ${audit.missingFrameNo.length} 缺车架号 / ${audit.missingBatteryCode.length} 缺电池码 / ${audit.tradeinNoRecycler.length} 回收未挂企业）</span>`}</div>

<h2>一、进货台账（进货查验 + 购销台账·进端）</h2>
<table><tr><th>进货日</th><th>名称</th><th>品牌/型号</th><th>CCC</th><th>数量</th><th>生产企业</th><th>供货人</th><th>批号</th><th>首码</th></tr>
${buys.map((r) => `<tr><td>${e(r.inISO)}</td><td>${e(r.name)}${r.spec ? `<div class="meta">${e(r.spec)}</div>` : ''}</td><td>${e([r.brand, r.model].filter(Boolean).join(' '))}</td><td>${e(r.cccNo)}</td><td>${r.qty}${e(r.unit)}</td><td>${e(r.maker)}</td><td>${e(r.supplier)}</td><td>${e(r.lotNo)}</td><td>${e(r.traceCode)}</td></tr>`).join('')}
</table>

<h2>二、销售台账（购销台账·销端，整车带车架号、电池带编码）</h2>
<table><tr><th>日期</th><th>名称</th><th>数量</th><th>购买人</th><th>车架号</th><th>电池编码</th><th>单价</th><th>金额</th></tr>
${sells.map((r) => `<tr><td>${e(r.dateISO)}</td><td>${e(r.name)}${r.spec ? `<div class="meta">${e(r.spec)}</div>` : ''}</td><td>${r.qty}${e(r.unit)}</td><td>${e(r.buyerName || '散客')}</td><td>${e((r.frameNos ?? []).join('、'))}</td><td>${e((r.batteryCodes ?? []).join('、'))}</td><td>${r.priceCents !== null ? e(fmtYuan(r.priceCents)) : '—'}</td><td>${r.amountCents !== null ? e(fmtYuan(r.amountCents)) : '—'}</td></tr>`).join('')}
</table>

<h2>三、旧车回收台账（以旧换新·补贴核验备查）</h2>
<table><tr><th>日期</th><th>交售人</th><th>旧车品牌</th><th>车架号/车牌</th><th>电池</th><th>回收企业</th><th>补贴</th><th>关联新单</th></tr>
${trades.map((r) => `<tr><td>${e(r.dateISO)}</td><td>${e(r.buyerName)}</td><td>${e(r.oldBrand)}</td><td>${e(r.oldFrameNo)}</td><td>${r.batteryCount ?? '—'}${r.batteryWeightKg ? `（${e(String(r.batteryWeightKg))}kg）` : ''}</td><td>${e(r.recycler || '')}</td><td>${r.subsidyCents !== null ? e(fmtYuan(r.subsidyCents)) : '—'}</td><td>${e(r.saleId)}</td></tr>`).join('')}
</table>

<h2>四、库存盘点</h2>
<table><tr><th>名称</th><th>批号</th><th>首码</th><th>进货日</th><th>剩余</th></tr>
${inv.map((r) => `<tr><td>${e(r.name)}</td><td>${e(r.lotNo)}</td><td>${e(r.traceCode)}</td><td>${e(r.inISO)}</td><td>${r.remaining}</td></tr>`).join('')}
</table>

<div class="foot">生成：车销单 RideLedger · ${e(todayISOStr)} · 台账依电动自行车安全隐患全链条整治行动与商务部以旧换新要求整理；属地条例与监管要求永远赢；本包为门店自查与迎检备查凭据，不替代监管平台报送。</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 店主备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'rideledger', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'rideledger') return { ok: false, error: '不是车销单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.shop === 'object' && s.shop !== null &&
    arr(s.recyclers) && arr(s.suppliers) && arr(s.products) &&
    arr(s.batches) && arr(s.sales) && arr(s.tradeins) && arr(s.losses) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
