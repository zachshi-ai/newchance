/**
 * core.js — 购销单 AgriLedger 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；金额一律整数「分」运算；日期统一 ISO 字符串 yyyy-mm-dd；
 * 库存不落库——批次剩余 = 进货量 − Σ销售分配 − Σ报损，由流水唯一派生（账实恒等式）。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md）：
 * - 《农药管理条例》（2017 修订）第 26 条：农药经营者应当建立采购台账，如实记录农药的
 *   名称、有关许可证明文件编号、规格、数量、生产企业和供货人名称及其联系方式、进货日期
 *   等内容，保存 2 年以上；第 27 条：销售台账如实记录名称、规格、数量、生产企业、购买人、
 *   销售日期等，保存 2 年以上；第 58 条第（一）项：不执行台账制度的责令改正，拒不改正
 *   或情节严重的处罚款
 * - 《农药经营许可管理办法》第 7 条：具有可追溯电子信息码扫描识别设备和用于记载农药
 *   购进、储存、销售电子台账的计算机管理系统是取得农药经营许可的法定条件
 * - 限制使用农药实行定点经营、实名购买、专柜存放（农业农村部限制使用农药名录及各地
 *   执行口径）；禁用农药一律不得经营——内置名录为常见条目的通识整理，绝非完整名录，
 *   以农业农村部最新公告为准（第 736 号公告：氧乐果、克百威、灭多威、涕灭威自
 *   2026-06-01 起全面禁止销售和使用），商品上手动标记永远可覆盖
 * - 超过质量保证期的农药按劣质农药管理，经营劣质农药将被没收并处罚款——过期批次
 *   必须下架封存，本工具到点自动从可售队列剔除并点名
 * 本工具是门店自己的经营底账与迎检/自证凭据，不构成法律意见，不替代追溯平台报送。
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
// 禁限用名录（内容供应链：农业农村部历次公告的通识整理条目）
// 【诚实声明】这只是农资店最常接触条目的通识整理，绝非完整名录。现行禁用农药
// 数十种、限制使用农药 32 种，以农业农村部最新公告为准；商品可用「限用」勾选
// 手动标记，手动标记与自动匹配取并集。匹配采用名称完全一致（去首尾空白），不猜模糊词。
// ---------------------------------------------------------------------------

/** 禁用农药（不得生产、经营和使用）——常见条目。note 为依据口径 */
export const BANNED_PESTICIDES = [
  { name: '甲胺磷', note: '禁用农药（历次公告累积禁用）' },
  { name: '对硫磷', note: '禁用农药（历次公告累积禁用）' },
  { name: '甲基对硫磷', note: '禁用农药（历次公告累积禁用）' },
  { name: '久效磷', note: '禁用农药（历次公告累积禁用）' },
  { name: '磷胺', note: '禁用农药（历次公告累积禁用）' },
  { name: '百草枯', note: '百草枯水剂自 2016 年起禁售、可溶胶剂 2020 年起禁用' },
  { name: '六六六', note: '禁用农药（历次公告累积禁用）' },
  { name: '滴滴涕', note: '禁用农药（历次公告累积禁用）' },
  { name: '杀虫脒', note: '禁用农药（历次公告累积禁用）' },
  { name: '除草醚', note: '禁用农药（历次公告累积禁用）' },
  { name: '敌枯双', note: '禁用农药（历次公告累积禁用）' },
  { name: '毒鼠强', note: '禁用杀鼠剂' },
  { name: '氟乙酰胺', note: '禁用杀鼠剂' },
  { name: '甘氟', note: '禁用杀鼠剂' },
  { name: '氧乐果', note: '农业农村部第 736 号公告：自 2026-06-01 起全面禁止销售和使用' },
  { name: '克百威', note: '农业农村部第 736 号公告：自 2026-06-01 起全面禁止销售和使用' },
  { name: '灭多威', note: '农业农村部第 736 号公告：自 2026-06-01 起全面禁止销售和使用' },
  { name: '涕灭威', note: '农业农村部第 736 号公告：自 2026-06-01 起全面禁止销售和使用' },
];

/** 限制使用农药（定点经营、实名购买、专柜存放）——常见条目，现行名录共 32 种 */
export const RESTRICTED_PESTICIDES = [
  { name: '甲拌磷', note: '限制使用农药（定点经营、实名购买）' },
  { name: '甲基异柳磷', note: '限制使用农药（定点经营、实名购买）' },
  { name: '水胺硫磷', note: '限制使用农药（定点经营、实名购买）' },
  { name: '灭线磷', note: '限制使用农药（定点经营、实名购买）' },
  { name: '溴甲烷', note: '限制使用农药（定点经营、实名购买）' },
  { name: '磷化铝', note: '限制使用农药（定点经营、实名购买）' },
  { name: '杀扑磷', note: '限制使用农药（定点经营、实名购买）' },
];

/** 商品名风险体检：完全一致匹配（去首尾空白），返回 { banned, restricted, hit } */
export function productRisk(name) {
  const key = String(name ?? '').trim();
  const hitBan = BANNED_PESTICIDES.find((x) => x.name === key);
  if (hitBan) return { banned: true, restricted: false, hit: hitBan.note };
  const hitRes = RESTRICTED_PESTICIDES.find((x) => x.name === key);
  if (hitRes) return { banned: false, restricted: true, hit: hitRes.note };
  return { banned: false, restricted: false, hit: null };
}

/** 商品类别：pesticide 农药（效期必填、受限用实名规则）/ seed 种子 / fertilizer 肥料 */
export const PRODUCT_KINDS = {
  pesticide: { label: '农药' },
  seed: { label: '种子' },
  fertilizer: { label: '肥料' },
};

/** 毒性分级（农药标签通识口径） */
export const TOXICITY_LEVELS = ['微毒', '低毒', '中等毒', '高毒', '剧毒'];

/** 《农药管理条例》第 26/27 条：购销台账保存 2 年以上 */
export const LEDGER_KEEP_YEARS = 2;
/** 临期默认窗：效期前 N 天进入临期盘点（设置页可覆盖） */
export const DEFAULT_NEAR_EXPIRY_DAYS = 90;

function requireRef(repos, id, label) {
  const hit = (repos ?? []).find((x) => x.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

// ---------------------------------------------------------------------------
// 商品档案（建库即做禁限用红线体检：禁用一律拒绝建档）
// ---------------------------------------------------------------------------

/**
 * 新建商品档案。product: { id, name, kind, regNo, spec, unit, maker, toxicity, restricted, note }
 * - 名称与内置禁用名录完全一致 → 拒绝建档（禁用农药不得经营；如属名录误匹配请核对
 *   登记证号并向属地农业部门求证，本工具不提供"继续建档"的后门）
 * - 名称命中限制使用名录或勾选「限用」→ restricted 置真（销售时强制实名）
 */
export function addProduct(state, product) {
  const name = String(product.name ?? '').trim();
  if (!name) throw new Error('商品名称必填');
  if (!PRODUCT_KINDS[product.kind]) throw new Error(`未知商品类别: ${product.kind}`);
  const risk = productRisk(name);
  if (risk.banned) {
    throw new Error(`「${name}」为${risk.hit}——国家禁用农药不得经营，拒绝建档`);
  }
  const item = {
    id: product.id,
    name,
    kind: product.kind,
    regNo: String(product.regNo ?? '').trim(),
    spec: String(product.spec ?? '').trim(),
    unit: String(product.unit ?? '').trim() || '件',
    maker: String(product.maker ?? '').trim(),
    toxicity: product.kind === 'pesticide' ? String(product.toxicity ?? '').trim() : '',
    restricted: Boolean(product.restricted) || risk.restricted,
    note: String(product.note ?? '').trim(),
  };
  state.products.push(item);
  return item;
}

// ---------------------------------------------------------------------------
// 进货落账（采购台账：条例第 26 条字段）
// ---------------------------------------------------------------------------

/**
 * 进货建批。entry: { id, productId, supplierId, inISO, qty, unitCostCents, lotNo, traceCode, expireISO, note }
 * - 农药批次必须登记「效期至」（质量保证期，标签必印）——没有效期的农药批次拒绝入账
 * - 数量为正整数（瓶/袋/包，拆零按最小销售单元记）
 * - 库存不落库：批次剩余由流水派生（见 batchRemaining）
 */
export function applyIntake(state, entry) {
  const product = requireRef(state.products, entry.productId, '商品');
  if (productRisk(product.name).banned) {
    throw new Error(`商品「${product.name}」为禁用农药，不得进货经营`);
  }
  assertISO(entry.inISO);
  if (!Number.isInteger(entry.qty) || entry.qty < 1) {
    throw new Error(`进货数量应为正整数: ${entry.qty}`);
  }
  if (entry.unitCostCents !== null && entry.unitCostCents !== undefined && !Number.isInteger(entry.unitCostCents)) {
    throw new Error(`进货单价必须为整数分: ${entry.unitCostCents}`);
  }
  if (product.kind === 'pesticide') {
    if (!entry.expireISO) throw new Error(`农药「${product.name}」必须登记效期（质量保证期，见标签）`);
    assertISO(entry.expireISO);
    if (entry.expireISO < entry.inISO) throw new Error(`效期（${entry.expireISO}）早于进货日（${entry.inISO}），请核对标签`);
  } else if (entry.expireISO) {
    assertISO(entry.expireISO);
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
    expireISO: entry.expireISO || null,
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

/**
 * 某商品的可售批次队列（按效期近者先出，同效期按进货日先进先出——农资行业通识：
 * 临期先发），过滤掉已售罄与已过期批次。到期日当天仍可售，次日为过期。
 */
export function sellableBatches(state, productId, todayISOStr) {
  assertISO(todayISOStr);
  return state.batches
    .filter((b) => b.productId === productId)
    .filter((b) => batchRemaining(state, b.id) > 0)
    .filter((b) => b.expireISO === null || b.expireISO >= todayISOStr)
    .sort((a, b) => {
      const ea = a.expireISO ?? '9999-12-31';
      const eb = b.expireISO ?? '9999-12-31';
      if (ea !== eb) return ea.localeCompare(eb);
      if (a.inISO !== b.inISO) return a.inISO.localeCompare(b.inISO);
      return a.id.localeCompare(b.id);
    });
}

/** 商品可用库存（可售口径：不含过期批次） */
export function stockOf(state, productId, todayISOStr) {
  return sellableBatches(state, productId, todayISOStr)
    .reduce((sum, b) => sum + batchRemaining(state, b.id), 0);
}

// ---------------------------------------------------------------------------
// 销售落账（销售台账：条例第 27 条字段 + 限用实名强制）
// ---------------------------------------------------------------------------

/**
 * 卖单落账。sale: { id, dateISO, buyerName, buyerPhone, buyerIdNo, crop, note,
 *                    items: [{ productId, qty, priceCents }] }
 * - 多品一单：逐品按 sellableBatches 队列做 FIFO 分配（allocations 落在流水上，
 *   药害自证可追到批号/追溯码）
 * - 任何一品库存不足 → 整单拒绝，绝不部分入账
 * - 限用农药（restricted）→ 必须实名：购买人姓名 + 身份证号（身份证/护照等法定证件号），
 *   缺一拒绝落账（《农药管理条例》限制使用农药实名购买制度）
 * - 禁用农药 → 拒绝销售
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
    if (productRisk(product.name).banned) {
      throw new Error(`商品「${product.name}」为禁用农药，不得销售`);
    }
    if (product.restricted) {
      const nameOk = String(sale.buyerName ?? '').trim().length > 0;
      const idOk = String(sale.buyerIdNo ?? '').trim().length >= 6;
      if (!nameOk || !idOk) {
        throw new Error(`「${product.name}」为限制使用农药：须实名购买，请补齐购买人姓名与身份证号后落账`);
      }
    }
    const queue = sellableBatches(state, it.productId, sale.dateISO);
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
      throw new Error(`「${product.name}」可售库存不足：要卖 ${it.qty}${product.unit}，可用 ${onHand}${product.unit}（含效期过滤）——整单未入账`);
    }
    return { productId: it.productId, qty: it.qty, priceCents: it.priceCents ?? null, allocations };
  });
  // 第二遍：统一落账
  const record = {
    id: sale.id,
    dateISO: sale.dateISO,
    buyerName: String(sale.buyerName ?? '').trim(),
    buyerPhone: String(sale.buyerPhone ?? '').trim(),
    buyerIdNo: String(sale.buyerIdNo ?? '').trim(),
    crop: String(sale.crop ?? '').trim(),
    note: String(sale.note ?? '').trim(),
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
// 报损/封存（过期批次必须下架：过期农药按劣质农药管理）
// ---------------------------------------------------------------------------

/** 过期在库批次：效期已过且仍有剩余——必须下架封存，不得销售（劣质农药红线） */
export function expiredBatches(state, todayISOStr) {
  assertISO(todayISOStr);
  return state.batches
    .filter((b) => b.expireISO !== null && b.expireISO < todayISOStr)
    .map((b) => {
      const product = state.products.find((p) => p.id === b.productId);
      return {
        batchId: b.id,
        productName: product?.name ?? '?',
        expireISO: b.expireISO,
        remaining: batchRemaining(state, b.id),
      };
    })
    .filter((x) => x.remaining > 0)
    .sort((a, b) => a.expireISO.localeCompare(b.expireISO));
}

/** 临期批次：N 天内到期且仍有剩余（临期先发的盘点清单） */
export function nearExpiryBatches(state, todayISOStr, windowDays = DEFAULT_NEAR_EXPIRY_DAYS) {
  assertISO(todayISOStr);
  const expired = new Set(expiredBatches(state, todayISOStr).map((x) => x.batchId));
  return state.batches
    .filter((b) => b.expireISO !== null && b.expireISO >= todayISOStr)
    .map((b) => {
      const product = state.products.find((p) => p.id === b.productId);
      return {
        batchId: b.id,
        productName: product?.name ?? '?',
        expireISO: b.expireISO,
        daysLeft: daysUntil(b.expireISO, todayISOStr),
        remaining: batchRemaining(state, b.id),
      };
    })
    .filter((x) => x.remaining > 0 && x.daysLeft <= windowDays && !expired.has(x.batchId))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * 报损/封存落账。reason: 'expired' 过期封存 | 'damaged' 破损 | 'other' 其他
 * 数量不得超过批次剩余；封存后批次剩余归零、从可售与过期名单中消失，账实守恒。
 */
export function recordLoss(state, { id, dateISO, batchId, qty, reason, note = '' }) {
  assertISO(dateISO);
  if (!['expired', 'damaged', 'other'].includes(reason)) throw new Error(`未知报损原因: ${reason}`);
  if (!Number.isInteger(qty) || qty < 1) throw new Error(`报损数量应为正整数: ${qty}`);
  const remaining = batchRemaining(state, batchId);
  if (qty > remaining) throw new Error(`报损数量超过批次剩余（剩 ${remaining}），拒绝入账`);
  const loss = { id, dateISO, batchId, qty, reason, note: String(note ?? '').trim() };
  state.losses.push(loss);
  return loss;
}

// ---------------------------------------------------------------------------
// 账本体检（迎检自查：过期在库 / 限用实名缺漏 / 账实守恒）
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
 * 合规自查：迎检前先自扫一遍。
 * - expiredOnShelf：过期批次仍在库（未封存）
 * - restrictedMissingId：历史卖单中限用商品缺实名（手工补录/导入数据常见）
 * - bannedProducts：不应存在的禁用商品档案（只可能来自导入数据）
 */
export function complianceAudit(state, todayISOStr) {
  assertISO(todayISOStr);
  const expiredOnShelf = expiredBatches(state, todayISOStr);
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const restrictedMissingId = [];
  for (const s of state.sales ?? []) {
    const hasRestricted = s.items.some((it) => productById.get(it.productId)?.restricted);
    if (hasRestricted && String(s.buyerIdNo ?? '').trim().length < 6) {
      restrictedMissingId.push({ saleId: s.id, dateISO: s.dateISO, buyerName: s.buyerName });
    }
  }
  const bannedProducts = state.products
    .filter((p) => productRisk(p.name).banned)
    .map((p) => ({ productId: p.id, name: p.name }));
  return { expiredOnShelf, restrictedMissingId, bannedProducts };
}

// ---------------------------------------------------------------------------
// 台账导出（进货台账 / 销售台账 / 药害自证单 / 迎检打印包）
// ---------------------------------------------------------------------------

/** 采购台账行（条例第 26 条字段口径，时间倒序） */
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
        regNo: p?.regNo ?? '',
        spec: p?.spec ?? '',
        unit: p?.unit ?? '件',
        qty: b.qty,
        maker: p?.maker ?? '',
        supplier: supplierById.get(b.supplierId) ?? (b.supplierId ? '?' : ''),
        lotNo: b.lotNo,
        traceCode: b.traceCode,
        expireISO: b.expireISO ?? '',
      };
    });
}

/** 销售台账行（条例第 27 条字段口径，时间倒序；限用商品标注实名） */
export function saleLedgerRows(state) {
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const rows = [];
  for (const s of state.sales ?? []) {
    for (const it of s.items) {
      const p = productById.get(it.productId);
      rows.push({
        dateISO: s.dateISO,
        name: p?.name ?? '?',
        spec: p?.spec ?? '',
        unit: p?.unit ?? '件',
        qty: it.qty,
        maker: p?.maker ?? '',
        restricted: Boolean(p?.restricted),
        buyerName: s.buyerName,
        buyerIdNo: p?.restricted ? s.buyerIdNo : '',
        priceCents: it.priceCents,
        amountCents: it.priceCents === null ? null : it.priceCents * it.qty,
        crop: s.crop,
      });
    }
  }
  return rows.sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

/** 进货台账文本（微信/打印两用，确定性输出） */
export function purchaseLedgerText({ state, todayISOStr = todayISO(), limit = 40 }) {
  const L = [];
  L.push(`【采购台账】${state.shop?.name ?? ''}${state.shop?.licenseNo ? `（许可证号 ${state.shop.licenseNo}）` : ''}`);
  L.push(`截至 ${todayISOStr}（依《农药管理条例》第 26 条整理，台账保存 2 年以上）`);
  L.push('');
  const rows = purchaseLedgerRows(state);
  if (rows.length === 0) {
    L.push('（暂无进货记录）');
  } else {
    rows.slice(0, limit).forEach((r) => {
      L.push(`- ${r.inISO} ${r.name}${r.spec ? `（${r.spec}）` : ''} × ${r.qty}${r.unit}｜生产企业：${r.maker || '—'}｜供货：${r.supplier || '—'}${r.lotNo ? `｜批号 ${r.lotNo}` : ''}${r.traceCode ? `｜追溯码 ${r.traceCode}` : ''}${r.expireISO ? `｜效期至 ${r.expireISO}` : ''}`);
    });
    if (rows.length > limit) L.push(`……更早 ${rows.length - limit} 条见打印版台账`);
  }
  L.push('');
  L.push(`生成：购销单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 销售台账文本（条例第 27 条字段口径；限用列实名证件号） */
export function saleLedgerText({ state, todayISOStr = todayISO(), limit = 40 }) {
  const L = [];
  L.push(`【销售台账】${state.shop?.name ?? ''}${state.shop?.licenseNo ? `（许可证号 ${state.shop.licenseNo}）` : ''}`);
  L.push(`截至 ${todayISOStr}（依《农药管理条例》第 27 条整理；限制使用农药已实名）`);
  L.push('');
  const rows = saleLedgerRows(state);
  if (rows.length === 0) {
    L.push('（暂无销售记录）');
  } else {
    rows.slice(0, limit).forEach((r) => {
      L.push(`- ${r.dateISO} ${r.name}${r.spec ? `（${r.spec}）` : ''} × ${r.qty}${r.unit}${r.priceCents !== null ? ` @ ${fmtYuan(r.priceCents)}` : ''}｜购买人：${r.buyerName || '散客'}${r.restricted ? `｜实名 ${r.buyerIdNo}` : ''}${r.crop ? `｜防治对象：${r.crop}` : ''}`);
    });
    if (rows.length > limit) L.push(`……更早 ${rows.length - limit} 条见打印版台账`);
  }
  L.push('');
  L.push(`生成：购销单 · ${todayISOStr}`);
  return L.join('\n');
}

/**
 * 药害自证单：按购买人姓名（可再限日期）捞出销售与批次明细。
 * 最高法涉农民事典型案例：农资经营者拿不出进货来源与产品信息即可能担责——
 * 这张单子就是"当场拿得出证据"的交付物。
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
  L.push(`门店：${state.shop?.name ?? ''}${state.shop?.licenseNo ? `（农药经营许可证号 ${state.shop.licenseNo}）` : ''}`);
  L.push(`出具日：${todayISOStr}${dateISO ? `（限定查询日 ${dateISO}）` : ''}`);
  L.push('');
  if (matched.length === 0) {
    L.push(`（本店台账中未查到 ${key} 名下的销售记录${dateISO ? `（${dateISO}）` : ''}）`);
  }
  for (const s of matched) {
    L.push(`■ ${s.dateISO} 购买人 ${s.buyerName || '散客'}${s.buyerPhone ? `（电话 ${s.buyerPhone}）` : ''}${s.crop ? ` · 防治对象：${s.crop}` : ''}`);
    for (const it of s.items) {
      const p = productById.get(it.productId);
      L.push(`  - ${p?.name ?? '?'}${p?.spec ? `（${p.spec}）` : ''} × ${it.qty}${p?.unit ?? '件'}｜生产企业：${p?.maker || '—'}${p?.regNo ? `｜登记证号 ${p.regNo}` : ''}`);
      for (const a of it.allocations) {
        const b = batchById.get(a.batchId);
        if (!b) continue;
        L.push(`    · 批次：进货 ${b.inISO}${b.lotNo ? `｜批号 ${b.lotNo}` : ''}${b.traceCode ? `｜追溯码 ${b.traceCode}` : ''}${b.expireISO ? `｜效期至 ${b.expireISO}` : ''}`);
      }
    }
    if (s.note) L.push(`  备注：${s.note}`);
  }
  L.push('');
  L.push('本单依据门店购销台账出具，商品信息以实物标签为准；台账依《农药管理条例》第 26、27 条建立并保存 2 年以上。');
  L.push(`生成：购销单 · ${todayISOStr}`);
  return { text: L.join('\n'), count: matched.length };
}

/** 库存效期盘点行（迎检打印包用） */
function inventoryRows(state, todayISOStr) {
  const productById = new Map(state.products.map((p) => [p.id, p]));
  return [...state.batches]
    .map((b) => ({
      name: productById.get(b.productId)?.name ?? '?',
      lotNo: b.lotNo,
      traceCode: b.traceCode,
      inISO: b.inISO,
      expireISO: b.expireISO,
      remaining: batchRemaining(state, b.id),
      expired: b.expireISO !== null && b.expireISO < todayISOStr && batchRemaining(state, b.id) > 0,
    }))
    .filter((r) => r.remaining > 0)
    .sort((a, b) => (a.expireISO ?? '9999').localeCompare(b.expireISO ?? '9999'));
}

/** 迎检打印包：单文件 HTML（店铺信息 + 采购台账 + 销售台账 + 库存效期盘点），无外部资源 */
export function inspectionHtml({ state, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const buys = purchaseLedgerRows(state);
  const sells = saleLedgerRows(state);
  const inv = inventoryRows(state, todayISOStr);
  const cons = conservation(state);
  const audit = complianceAudit(state, todayISOStr);
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
  .ok { color: #15803d; }
  .foot { margin-top: 14px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>购销台账迎检包 · ${e(state.shop?.name ?? '')}</h1>
<div class="meta">农药经营许可证号：${e(state.shop?.licenseNo ?? '未填写')} · 联系电话：${e(state.shop?.phone ?? '')} · 截至 ${e(todayISOStr)}</div>
<div class="meta">账本体检：进货 ${cons.inQty} ＝ 已售 ${cons.soldQty} ＋ 报损 ${cons.lossQty} ＋ 库存 ${cons.stockQty}${cons.residual === 0 ? '<span class="ok">（账实一致）</span>' : `<span class="flag">（残差 ${cons.residual}，请核查）</span>`}${audit.expiredOnShelf.length ? `<span class="flag"> · 过期在库 ${audit.expiredOnShelf.length} 批，须下架封存</span>` : '<span class="ok"> · 无过期在库</span>'}</div>

<h2>一、采购台账（依《农药管理条例》第 26 条）</h2>
<table><tr><th>进货日</th><th>名称</th><th>规格</th><th>数量</th><th>生产企业</th><th>供货人</th><th>批号</th><th>追溯码</th><th>效期至</th></tr>
${buys.map((r) => `<tr><td>${e(r.inISO)}</td><td>${e(r.name)}${r.regNo ? `<div class="meta">${e(r.regNo)}</div>` : ''}</td><td>${e(r.spec)}</td><td>${r.qty}${e(r.unit)}</td><td>${e(r.maker)}</td><td>${e(r.supplier)}</td><td>${e(r.lotNo)}</td><td>${e(r.traceCode)}</td><td>${e(r.expireISO)}</td></tr>`).join('')}
</table>

<h2>二、销售台账（依《农药管理条例》第 27 条）</h2>
<table><tr><th>日期</th><th>名称</th><th>规格</th><th>数量</th><th>购买人</th><th>实名（限用）</th><th>单价</th><th>金额</th></tr>
${sells.map((r) => `<tr><td>${e(r.dateISO)}</td><td>${e(r.name)}${r.restricted ? ' <span class="flag">限</span>' : ''}</td><td>${e(r.spec)}</td><td>${r.qty}${e(r.unit)}</td><td>${e(r.buyerName || '散客')}</td><td>${e(r.buyerIdNo)}</td><td>${r.priceCents !== null ? e(fmtYuan(r.priceCents)) : '—'}</td><td>${r.amountCents !== null ? e(fmtYuan(r.amountCents)) : '—'}</td></tr>`).join('')}
</table>

<h2>三、库存效期盘点</h2>
<table><tr><th>名称</th><th>批号</th><th>追溯码</th><th>进货日</th><th>效期至</th><th>剩余</th><th>状态</th></tr>
${inv.map((r) => `<tr><td>${e(r.name)}</td><td>${e(r.lotNo)}</td><td>${e(r.traceCode)}</td><td>${e(r.inISO)}</td><td>${e(r.expireISO)}</td><td>${r.remaining}</td><td>${r.expired ? '<span class="flag">已过期须封存</span>' : '在售'}</td></tr>`).join('')}
</table>

<div class="foot">生成：购销单 AgriLedger · ${e(todayISOStr)} · 台账依《农药管理条例》第 26、27 条整理，保存 2 年以上；禁限用名录以农业农村部最新公告为准；本包为门店自查与迎检备查凭据，不替代追溯平台报送与法定处置义务。</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 店主备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'agriledger', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'agriledger') return { ok: false, error: '不是购销单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.shop === 'object' && s.shop !== null &&
    arr(s.suppliers) && arr(s.products) && arr(s.batches) &&
    arr(s.sales) && arr(s.losses) && typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
