/**
 * core.js — 危废账 GarageLedger 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；数量一律整数最小单位运算
 * （kg 类 = 0.1kg 的整数倍，件类 = 个数），金额一律整数「分」，杜绝浮点误差；
 * 日期统一 ISO 字符串 yyyy-mm-dd；所有规则参数（贮存红线/预警窗/断更天数）可在设置中被厂店覆盖。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md，均经原文核验）：
 * - 《固体废物污染环境防治法》（2020 修订）第 78 条（管理计划备案 + 台账如实记录）、
 *   第 80 条第 2 款（禁止委托无证单位）、第 81 条第 3 款（贮存不得超过一年）、
 *   第 112 条第 4/5/13 项（委托无证 = 处置费 3~5 倍不足 20 万按 20 万；联单 10 万~100 万；台账 10 万~100 万）
 * - 两高《关于办理环境污染刑事案件适用法律若干问题的解释》（法释〔2023〕7 号）第一条第（二）项：
 *   非法排放、倾倒、处置危险废物三吨以上 = 刑法第 338 条「严重污染环境」
 * - 《国家危险废物名录（2021 年版）》：汽修常见品目代码为预填模板，可编辑，
 *   以最新名录及属地生态环境部门要求为准
 * 本工具是产废单位侧的自查台账与整改指引，不构成法律意见，不替代法定申报与转移联单报送。
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

/** 金额：整数分 → 「¥129.00」 */
export function fmtYuan(cents) {
  if (!Number.isInteger(cents)) throw new Error(`金额必须为整数分: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 数量：整数最小单位 → 「12.5 kg」/「3 件」（unit: 'kg' | 'unit'） */
export function fmtQty(unit, minor) {
  if (!Number.isInteger(minor)) throw new Error(`数量必须为整数: ${minor}`);
  if (unit === 'kg') {
    const sign = minor < 0 ? '-' : '';
    const abs = Math.abs(minor);
    return `${sign}${Math.floor(abs / 10)}.${abs % 10} kg`;
  }
  return `${minor} 件`;
}

/** 用户输入（kg，≤1 位小数）→ 整数最小单位（0.1kg）；非法抛错 */
export function kgToMinor(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`非法数量: ${JSON.stringify(value)}`);
  const minor = Math.round(n * 10);
  if (minor <= 0) throw new Error(`数量必须大于 0: ${value}`);
  return minor;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 常量与汽修常见品目模板（内容供应链：名录口径的预填先验，全部可编辑）
// ---------------------------------------------------------------------------

/** 贮存红线默认值：不得超过一年（固废法第 81 条口径；法规另有规定或属地另有要求的以其为准） */
export const DEFAULT_STORAGE_LIMIT_DAYS = 365;
/** 贮存预警窗：距红线 N 天内亮黄灯 */
export const DEFAULT_STORAGE_WARN_DAYS = 30;
/** 接收方资质到期预警窗 */
export const DEFAULT_LICENSE_WARN_DAYS = 30;
/** 台账断更判定：N 天无任何台账动作且仍有存量 → 亮灯（自查口径，非法条） */
export const DEFAULT_STALE_DAYS = 60;
/** 迎检包明细最多列出最近 N 条（超出引导看完整导出） */
export const INSPECTION_MAX_ROWS = 40;

/**
 * 汽修常见危废品目模板（《国家危险废物名录（2021 年版）》常见口径，预填可编辑；
 * 名录动态调整，以最新名录及属地生态环境部门要求为准）。
 */
export const AUTO_REPAIR_ITEM_TEMPLATES = [
  { name: '废机油（发动机/变速箱/齿轮油）', code: '900-214-08', unit: 'kg', capacityMinor: 1000, note: '换油保养主要产废' },
  { name: '废铅蓄电池', code: '900-052-31', unit: 'unit', capacityMinor: 20, note: '以旧换新折价' },
  { name: '废机滤/油桶/吸油棉（沾染废物）', code: '900-041-49', unit: 'unit', capacityMinor: 100, note: '沥干后袋装' },
  { name: '漆渣/废油漆桶（喷漆废物）', code: '900-252-12', unit: 'kg', capacityMinor: 200, note: '钣喷房产废' },
  { name: '废活性炭（喷烤漆房废气处理）', code: '900-039-49', unit: 'kg', capacityMinor: 100, note: '更换周期按属地要求' },
];

/** 记录类型 */
export const RECORD_TYPES = {
  in: { label: '入库', sign: 1 },
  out: { label: '出库', sign: -1 },
  rev: { label: '冲销', sign: 0 },
};

function requireRef(list, id, label) {
  const hit = (list ?? []).find((x) => x.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

/** 一条记录对存量的带符号贡献：in=+，out=-，rev=与被冲销记录相反（冲入库回收、冲出库回补） */
export function signedQty(record) {
  if (record.type === 'in') return record.qtyMinor;
  if (record.type === 'out') return -record.qtyMinor;
  if (record.type === 'rev') return (record.revOf === 'out' ? 1 : -1) * record.qtyMinor;
  throw new Error(`未知记录类型: ${record.type}`);
}

/** 按品目汇总现存量（所有记录带符号求和，冲销自然抵扣） */
export function stockByItem(state) {
  const stock = new Map();
  for (const it of state.items ?? []) stock.set(it.id, 0);
  for (const r of state.records ?? []) {
    if (!stock.has(r.itemId)) stock.set(r.itemId, 0);
    stock.set(r.itemId, stock.get(r.itemId) + signedQty(r));
  }
  return stock;
}

/**
 * 单品目批次推演（唯一模型，agingByItem 与 consumedOfIn 共用）：
 * 入库建批次；出库按 FIFO 从最早批次扣（逐笔记录 draws）；冲销 = 该笔从未发生——
 * 冲销入库关闭原批次（必须原封未动），冲销出库把扣量精确退回原批次。
 * 返回按时间序的批次数组 [{ refId, dateISO, remain }]（已耗尽批次保留在列，remain=0）。
 */
function simulateBatches(records, itemId) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const ordered = records
    .filter((r) => r.itemId === itemId)
    .sort((a, b) => (a.dateISO === b.dateISO ? (a.seq ?? 0) - (b.seq ?? 0) : a.dateISO.localeCompare(b.dateISO)));
  const batches = [];
  const outDraws = new Map(); // outId → [{ batch, take }]
  for (const r of ordered) {
    if (r.type === 'in') {
      batches.push({ refId: r.id, dateISO: r.dateISO, remain: r.qtyMinor });
    } else if (r.type === 'out') {
      const draws = [];
      let need = r.qtyMinor;
      for (const b of batches) {
        if (need <= 0) break;
        if (b.remain <= 0) continue;
        const take = Math.min(b.remain, need);
        b.remain -= take;
        need -= take;
        draws.push({ batch: b, take });
      }
      outDraws.set(r.id, draws);
    } else if (r.type === 'rev') {
      const orig = byId.get(r.refId);
      if (!orig) continue;
      if (orig.type === 'in') {
        const b = batches.find((x) => x.refId === orig.id);
        if (b && b.remain === orig.qtyMinor) b.remain = 0; // 原封未动才允许整批关闭（addRecord 已校验，这里防御式跳过）
      } else if (orig.type === 'out') {
        for (const { batch, take } of outDraws.get(orig.id) ?? []) batch.remain += take; // 退回原批次
      }
    }
  }
  return batches;
}

/**
 * 按品目做批次推演汇总：{ stockMinor, oldestISO, daysOpen } —— daysOpen 以最早未清批次起算。
 */
export function agingByItem(state, todayISOStr) {
  assertISO(todayISOStr);
  const items = state.items ?? [];
  const result = new Map(items.map((it) => [it.id, { stockMinor: 0, oldestISO: null, daysOpen: 0 }]));
  const records = state.records ?? [];
  for (const it of items) {
    const batches = simulateBatches(records, it.id);
    const open = batches.filter((b) => b.remain > 0);
    const acc = { stockMinor: open.reduce((s, b) => s + b.remain, 0), oldestISO: null, daysOpen: 0 };
    if (open.length > 0) {
      acc.oldestISO = open[0].dateISO;
      acc.daysOpen = daysUntil(todayISOStr, acc.oldestISO);
    }
    result.set(it.id, acc);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 记账（入库/出库：先全量校验后落账；冲销 = 红字反向记录，绝不静默删除）
// ---------------------------------------------------------------------------

/** 数量/日期/金额公共校验，非法抛错 */
function validateCommon(state, { dateISO, itemId, qtyMinor, amountFen }) {
  assertISO(dateISO);
  requireRef(state.items, itemId, '危废品目');
  if (!Number.isInteger(qtyMinor) || qtyMinor <= 0) {
    throw new Error(`数量必须为正整数（最小 0.1kg / 1 件）: ${qtyMinor}`);
  }
  if (amountFen !== null && amountFen !== undefined) {
    if (!Number.isInteger(amountFen) || amountFen < 0) {
      throw new Error(`款额必须为非负整数分: ${amountFen}`);
    }
  }
}

/** 已用量：某入库记录对应批次已被消耗的数量（与批次推演同一模型；批次不存在=已整批冲销） */
function consumedOfIn(state, inRecord) {
  const batches = simulateBatches(state.records ?? [], inRecord.itemId);
  const b = batches.find((x) => x.refId === inRecord.id);
  return b ? inRecord.qtyMinor - b.remain : inRecord.qtyMinor;
}

/**
 * 新增台账记录并落账。
 * - 入库 in：{ itemId, dateISO, qtyMinor, note }（产废进桶）
 * - 出库 out：{ itemId, dateISO, qtyMinor, vendorId, manifestNo?, amountFen?, note }
 *   · 必须登记接收方（固废法第 80 条：禁止委托无证单位——接收方资质在红线台核验）
 *   · 现存量不足 → 整体抛错，绝不部分入账
 * - 冲销 rev：{ refId }——追加等额反向记录（红字），原记录保留作审计痕迹
 *   · 入库记录已被部分转移 → 拒绝冲销（请先冲销对应出库）
 *   · 已被冲销过的记录 → 拒绝二次冲销
 */
export function addRecord(state, rec) {
  if (rec.type === 'rev') {
    const orig = requireRef(state.records, rec.refId, '原记录');
    const already = (state.records ?? []).some((r) => r.type === 'rev' && r.refId === orig.id);
    if (already) throw new Error(`该记录已被冲销，不能重复冲销`);
    if (orig.type === 'in') {
      const consumed = consumedOfIn(state, orig);
      if (consumed > 0) {
        throw new Error(`该入库已转移 ${consumed}（0.1kg/件），不可直接冲销——请先冲销对应出库记录`);
      }
    }
    const rev = {
      id: rec.id, seq: rec.seq ?? (state.records?.length ?? 0) + 1,
      dateISO: rec.dateISO ?? rec.todayISOStr ?? todayISO(),
      itemId: orig.itemId, type: 'rev', qtyMinor: orig.qtyMinor, revOf: orig.type,
      vendorId: orig.vendorId ?? null, manifestNo: '', amountFen: orig.amountFen ? -orig.amountFen : 0,
      note: rec.note ?? `冲销原${RECORD_TYPES[orig.type].label}记录`, refId: orig.id,
    };
    state.records.push(rev);
    return rev;
  }
  validateCommon(state, rec);
  if (rec.type === 'out') {
    requireRef(state.vendors, rec.vendorId, '接收方');
    const stock = stockByItem(state).get(rec.itemId) ?? 0;
    if (stock < rec.qtyMinor) {
      const item = state.items.find((x) => x.id === rec.itemId);
      throw new Error(`「${item?.name ?? rec.itemId}」现存量仅 ${fmtQty(item?.unit ?? 'kg', stock)}，出库 ${fmtQty(item?.unit ?? 'kg', rec.qtyMinor)} 超出存量——整体拒绝，请核对数量`);
    }
  }
  const record = {
    id: rec.id, seq: rec.seq ?? (state.records?.length ?? 0) + 1,
    dateISO: rec.dateISO, itemId: rec.itemId, type: rec.type, qtyMinor: rec.qtyMinor,
    vendorId: rec.vendorId ?? null,
    manifestNo: (rec.manifestNo ?? '').trim(),
    amountFen: rec.amountFen ?? 0,
    note: (rec.note ?? '').trim(), refId: null,
  };
  state.records.push(record);
  return record;
}

// ---------------------------------------------------------------------------
// 预警（贮存超期 / 资质到期 / 联单待补）
// ---------------------------------------------------------------------------

/** 贮存期限预警：按批次倒计时分级 ok/warn/fail（红线=一年，固废法第 81 条口径参数化） */
export function storageWarnings(state, todayISOStr, limitDays = DEFAULT_STORAGE_LIMIT_DAYS, warnDays = DEFAULT_STORAGE_WARN_DAYS) {
  assertISO(todayISOStr);
  const aging = agingByItem(state, todayISOStr);
  const out = [];
  for (const it of state.items ?? []) {
    const a = aging.get(it.id);
    if (!a || a.stockMinor <= 0 || a.oldestISO === null) continue;
    const remainDays = limitDays - a.daysOpen;
    const level = remainDays < 0 ? 'fail' : remainDays <= warnDays ? 'warn' : 'ok';
    out.push({
      itemId: it.id, itemName: it.name, oldestISO: a.oldestISO,
      stockMinor: a.stockMinor, daysOpen: a.daysOpen, remainDays, level,
    });
  }
  return out.filter((x) => x.level !== 'ok').sort((a, b) => a.remainDays - b.remainDays);
}

/** 接收方资质预警：已过期 fail / N 天内到期 warn */
export function licenseWarnings(state, todayISOStr, warnDays = DEFAULT_LICENSE_WARN_DAYS) {
  assertISO(todayISOStr);
  const out = [];
  for (const v of state.vendors ?? []) {
    if (!v.licenseExpiryISO) continue;
    const days = daysUntil(v.licenseExpiryISO, todayISOStr);
    if (days < 0) out.push({ vendorId: v.id, vendorName: v.name, licenseExpiryISO: v.licenseExpiryISO, days, level: 'fail' });
    else if (days <= warnDays) out.push({ vendorId: v.id, vendorName: v.name, licenseExpiryISO: v.licenseExpiryISO, days, level: 'warn' });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** 联单待补清单：出库未填联单号（转移管理办法体系下联单是转移合法性的直接凭据） */
export function pendingManifests(state) {
  return (state.records ?? [])
    .filter((r) => r.type === 'out' && !(r.manifestNo ?? '').trim())
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

// ---------------------------------------------------------------------------
// 红线自查台（逐条亮灯 + 法条依据 + 今日行动；自查指引，不构成法律意见）
// ---------------------------------------------------------------------------

/**
 * 红线自查：返回固定顺序的检查项数组（含 ok 项，UI 全量渲染）。
 * 每条 { id, level: 'ok'|'warn'|'fail', title, legal, detail, action }
 */
export function complianceChecks(state, todayISOStr, settings = {}) {
  assertISO(todayISOStr);
  const limitDays = settings.storageLimitDays ?? DEFAULT_STORAGE_LIMIT_DAYS;
  const warnDays = settings.storageWarnDays ?? DEFAULT_STORAGE_WARN_DAYS;
  const licenseWarn = settings.licenseWarnDays ?? DEFAULT_LICENSE_WARN_DAYS;
  const staleDays = settings.staleDays ?? DEFAULT_STALE_DAYS;
  const checks = [];

  // 1. 台账记录与断更
  const records = state.records ?? [];
  const hasStock = [...stockByItem(state).values()].some((v) => v > 0);
  const lastDates = records.map((r) => r.dateISO).sort();
  const lastDate = lastDates[lastDates.length - 1] ?? null;
  if (records.length === 0) {
    checks.push({ id: 'LEDGER', level: 'warn', title: '台账记录', legal: '《固体废物污染环境防治法》第 78 条：产生危险废物的单位应当建立危险废物管理台账，如实记录有关信息（未建台账可处 10 万元以上 100 万元以下罚款，第 112 条第 13 项）', detail: '还没有任何台账记录', action: '记第一笔：换油/钣喷/换电瓶后立即入库落账' });
  } else {
    const stale = daysUntil(todayISOStr, lastDate) > staleDays;
    checks.push({
      id: 'LEDGER',
      level: stale && hasStock ? 'warn' : 'ok',
      title: '台账记录',
      legal: '《固体废物污染环境防治法》第 78 条：建立管理台账，如实记录（未建台账 10 万~100 万，第 112 条第 13 项）',
      detail: stale && hasStock ? `最近一笔台账是 ${lastDate}，已断更超过 ${staleDays} 天且仍有存量` : `共 ${records.length} 笔记录，最近一笔 ${lastDate}`,
      action: stale && hasStock ? '核对存量与台账是否一致，补记漏记的出入库' : '保持节奏：每次出入库当场记账',
    });
  }

  // 2. 管理计划备案（按年打卡）
  const year = todayISOStr.slice(0, 4);
  const planFiled = (state.checkins ?? []).some((c) => c.kind === 'plan' && (c.forYear ?? c.dateISO.slice(0, 4)) === year);
  checks.push({
    id: 'PLAN',
    level: planFiled ? 'ok' : 'fail',
    title: `危险废物管理计划备案（${year} 年度）`,
    legal: '《固体废物污染环境防治法》第 78 条：应当制定危险废物管理计划并报所在地生态环境主管部门备案',
    detail: planFiled ? `已完成 ${year} 年度备案打卡` : `${year} 年度尚未登记备案`,
    action: planFiled ? '留存备案回执，与台账装订在一起' : '向属地生态环境部门完成管理计划备案，回来登记备案日期',
  });

  // 3. 贮存超期
  const stor = storageWarnings(state, todayISOStr, limitDays, warnDays);
  const fails = stor.filter((x) => x.level === 'fail');
  const warns = stor.filter((x) => x.level === 'warn');
  checks.push({
    id: 'STORAGE',
    level: fails.length ? 'fail' : warns.length ? 'warn' : 'ok',
    title: '贮存期限（不得超过一年）',
    legal: '《固体废物污染环境防治法》第 81 条第 3 款：贮存危险废物不得超过一年；确需延长应报经批准',
    detail: fails.length
      ? `${fails.map((f) => `${f.itemName} 已贮存 ${f.daysOpen} 天`).join('；')}——已超红线`
      : warns.length
        ? `${warns.map((w) => `${w.itemName} 剩 ${w.remainDays} 天`).join('；')}——临近一年红线`
        : '所有在库批次均在安全期内',
    action: fails.length || warns.length ? '优先转移最早批次（FIFO 先出），联系接收方安排上门' : '保持先入先出的转移习惯',
  });

  // 4. 接收方资质
  const lic = licenseWarnings(state, todayISOStr, licenseWarn);
  const licFail = lic.filter((x) => x.level === 'fail');
  const usedVendors = new Set((state.records ?? []).filter((r) => r.type === 'out').map((r) => r.vendorId));
  const missingLicense = [...usedVendors].filter((vid) => {
    const v = (state.vendors ?? []).find((x) => x.id === vid);
    return !v?.licenseNo;
  });
  checks.push({
    id: 'LICENSE',
    level: licFail.length || missingLicense.length ? 'fail' : lic.length ? 'warn' : 'ok',
    title: '接收方资质核验',
    legal: '《固体废物污染环境防治法》第 80 条第 2 款：禁止将危险废物提供或委托给无许可证的单位（违者处所需处置费用 3~5 倍罚款，不足 20 万元按 20 万元计算，第 112 条第 4 项）',
    detail: [
      ...missingLicense.map(() => '有出库记录的接收方未登记经营许可证号'),
      ...licFail.map((x) => `${x.vendorName} 许可证已过期（${x.licenseExpiryISO}）`),
      ...lic.filter((x) => x.level === 'warn').map((x) => `${x.vendorName} 许可证 ${x.days} 天后到期`),
    ].join('；') || '全部接收方资质有效且已登记',
    action: licFail.length || missingLicense.length ? '立即核验接收方危废经营许可证原件并更新登记；过期的暂停交运' : '继续在每次交运前核验证件有效期',
  });

  // 5. 联单闭环
  const pending = pendingManifests(state);
  checks.push({
    id: 'MANIFEST',
    level: pending.length ? 'fail' : 'ok',
    title: '转移联单闭环',
    legal: '《固体废物污染环境防治法》第 112 条第 5 项：未按照国家有关规定填写、运行危险废物转移联单的，处 10 万元以上 100 万元以下罚款',
    detail: pending.length ? `${pending.length} 笔出库未填联单号（最近 ${pending[pending.length - 1].dateISO}）` : '全部出库已关联联单号',
    action: pending.length ? '向接收方逐笔索要联单号并补录（编辑对应出库记录）' : '保持：每次转移当场索取联单号',
  });

  // 6. 贮存容量
  const stock = stockByItem(state);
  const over = (state.items ?? []).filter((it) => (it.capacityMinor ?? 0) > 0 && (stock.get(it.id) ?? 0) > it.capacityMinor);
  checks.push({
    id: 'CAPACITY',
    level: over.length ? 'warn' : 'ok',
    title: '贮存容量',
    legal: '《危险废物贮存污染控制标准》（GB 18597）体系：贮存设施与容量管理要求（以现行版本及属地要求为准）',
    detail: over.length ? `${over.map((it) => it.name).join('、')} 超出登记容量` : '各品目存量均在登记容量内',
    action: over.length ? '安排接收方提前清运，或按实际重新核定容量并整改贮存条件' : '—',
  });

  return checks;
}

/** 「今天做什么」：fail > warn 优先级的行动清单（去重、最多 5 条） */
export function todayActions(checks) {
  return checks
    .filter((c) => c.level !== 'ok')
    .sort((a, b) => (a.level === 'fail' ? -1 : 1) - (b.level === 'fail' ? -1 : 1))
    .slice(0, 5)
    .map((c) => ({ id: c.id, level: c.level, action: c.action, title: c.title }));
}

// ---------------------------------------------------------------------------
// 收益账（出库款额按月/品目/接收方汇总；整数分；冲销自动冲减）
// ---------------------------------------------------------------------------

/**
 * 收益报表：只统计出库与冲销的带符号款额（冲销负值自动冲减）。
 * year: 'YYYY'；无款额记录不计入。
 */
export function revenueReport(state, year) {
  if (!/^\d{4}$/.test(year)) throw new Error(`非法年份: ${year}`);
  const itemById = new Map((state.items ?? []).map((x) => [x.id, x]));
  const vendorById = new Map((state.vendors ?? []).map((x) => [x.id, x]));
  const byMonth = new Map();
  const byItem = new Map();
  const byVendor = new Map();
  let totalFen = 0;
  for (const r of state.records ?? []) {
    if (r.type !== 'out' && r.type !== 'rev') continue;
    if (!r.amountFen || monthKey(r.dateISO).slice(0, 4) !== year) continue;
    const m = monthKey(r.dateISO);
    byMonth.set(m, (byMonth.get(m) ?? 0) + r.amountFen);
    byItem.set(r.itemId, (byItem.get(r.itemId) ?? 0) + r.amountFen);
    if (r.vendorId) byVendor.set(r.vendorId, (byVendor.get(r.vendorId) ?? 0) + r.amountFen);
    totalFen += r.amountFen;
  }
  const sortVal = (map, idFn, nameFn) => [...map.entries()]
    .map(([id, amountFen]) => ({ id: idFn ? idFn(id) : id, name: nameFn(id), amountFen }))
    .sort((a, b) => b.amountFen - a.amountFen);
  return {
    totalFen,
    byMonth: [...byMonth.entries()].map(([month, amountFen]) => ({ month, amountFen })).sort((a, b) => a.month.localeCompare(b.month)),
    byItem: sortVal(byItem, null, (id) => itemById.get(id)?.name ?? '?'),
    byVendor: sortVal(byVendor, null, (id) => vendorById.get(id)?.name ?? '?'),
  };
}

// ---------------------------------------------------------------------------
// 迎检包（微信文本 / 打印版单文件 HTML；同输入同输出）
// ---------------------------------------------------------------------------

/** 存量汇总行（品目 / 代码 / 存量 / 最早批次 / 期限状态） */
function stockRows(state, todayISOStr, settings) {
  const stock = stockByItem(state);
  const aging = agingByItem(state, todayISOStr);
  const limitDays = settings.storageLimitDays ?? DEFAULT_STORAGE_LIMIT_DAYS;
  return (state.items ?? []).map((it) => {
    const a = aging.get(it.id);
    const minor = stock.get(it.id) ?? 0;
    let status = minor > 0 && a.oldestISO ? `最早批次 ${a.oldestISO}（${a.daysOpen} 天）` : '—';
    if (minor > 0 && a.daysOpen > limitDays) status += '·已超一年红线';
    else if (minor > 0 && limitDays - a.daysOpen <= (settings.storageWarnDays ?? DEFAULT_STORAGE_WARN_DAYS)) status += '·临期';
    return { name: it.name, code: it.code, unit: it.unit, minor, status };
  });
}

/** 迎检包文本（确定性）：存量 + 明细 + 资质 + 自查结论 + 声明 */
export function inspectionText({ state, todayISOStr = todayISO(), settings = {} }) {
  assertISO(todayISOStr);
  const L = [];
  L.push(`【危险废物管理台账 · 自查概要】${state.org?.name ?? '（未设厂店名称）'}`);
  if (state.org?.phone) L.push(`联系电话：${state.org.phone}`);
  L.push(`截至：${todayISOStr}`);
  L.push('');
  L.push('一、存量汇总');
  for (const r of stockRows(state, todayISOStr, settings)) {
    L.push(`  - ${r.name}（${r.code}）：${fmtQty(r.unit, r.minor)}${r.status === '—' ? '' : `，${r.status}`}`);
  }
  L.push('');
  const outRows = (state.records ?? [])
    .filter((r) => r.type === 'out' || r.type === 'rev')
    .sort((a, b) => a.dateISO === b.dateISO ? (a.seq ?? 0) - (b.seq ?? 0) : a.dateISO.localeCompare(b.dateISO));
  L.push(`二、转移记录（最近 ${Math.min(INSPECTION_MAX_ROWS, outRows.length)} 笔${outRows.length > INSPECTION_MAX_ROWS ? `，共 ${outRows.length} 笔` : ''}）`);
  if (outRows.length === 0) L.push('  （暂无转移记录）');
  const vendorById = new Map((state.vendors ?? []).map((v) => [v.id, v.name]));
  const itemById = new Map((state.items ?? []).map((it) => [it.id, it]));
  for (const r of [...outRows].reverse().slice(0, INSPECTION_MAX_ROWS)) {
    const vName = r.vendorId ? (vendorById.get(r.vendorId) ?? '?') : '';
    const iName = itemById.get(r.itemId)?.name ?? '?';
    if (r.type === 'out') {
      L.push(`  - ${r.dateISO} 出库 ${iName} ${fmtQty(itemById.get(r.itemId)?.unit ?? 'kg', r.qtyMinor)} → ${vName}${r.manifestNo ? `，联单 ${r.manifestNo}` : '，联单待补'}${r.amountFen ? `，款额 ${fmtYuan(r.amountFen)}` : ''}`);
    } else {
      L.push(`  - ${r.dateISO} 冲销 ${iName} ${fmtQty(itemById.get(r.itemId)?.unit ?? 'kg', r.qtyMinor)}（红字留痕）`);
    }
  }
  L.push('');
  L.push('三、接收方资质核验');
  if ((state.vendors ?? []).length === 0) L.push('  （暂未登记接收方）');
  for (const v of state.vendors ?? []) {
    L.push(`  - ${v.name}：许可证 ${v.licenseNo || '（未登记）'}${v.licenseExpiryISO ? `，有效期至 ${v.licenseExpiryISO}` : ''}`);
  }
  L.push('');
  L.push('四、红线自查结论');
  for (const c of complianceChecks(state, todayISOStr, settings)) {
    const tag = c.level === 'ok' ? '✓' : c.level === 'warn' ? '△' : '✗';
    L.push(`  ${tag} ${c.title}：${c.detail}`);
  }
  L.push('');
  L.push('声明：本台账为产废单位自查记录与整改指引，不替代法定申报与转移联单报送；');
  L.push('品目代码与口径以最新《国家危险废物名录》、现行《固体废物污染环境防治法》及属地生态环境部门要求为准。');
  L.push(`经办人：____________　日期：____________`);
  L.push(`生成：危废账 GarageLedger · ${todayISOStr}`);
  return L.join('\n');
}

/** 迎检包打印版：单文件 HTML（内联样式、签字栏，无外部资源） */
export function inspectionHtml({ state, todayISOStr = todayISO(), settings = {} }) {
  const e = escapeHtml;
  assertISO(todayISOStr);
  const itemById = new Map((state.items ?? []).map((it) => [it.id, it]));
  const vendorById = new Map((state.vendors ?? []).map((v) => [v.id, v]));
  const stock = stockRows(state, todayISOStr, settings);
  const outRows = (state.records ?? [])
    .filter((r) => r.type === 'out' || r.type === 'rev')
    .sort((a, b) => a.dateISO === b.dateISO ? (a.seq ?? 0) - (b.seq ?? 0) : a.dateISO.localeCompare(b.dateISO))
    .reverse().slice(0, INSPECTION_MAX_ROWS);
  const checks = complianceChecks(state, todayISOStr, settings);
  const stockHtml = stock.map((r) => `<tr>
      <td>${e(r.name)}</td><td>${e(r.code)}</td><td>${e(fmtQty(r.unit, r.minor))}</td><td>${e(r.status)}</td>
    </tr>`).join('');
  const recHtml = outRows.length === 0 ? '<tr><td colspan="6">（暂无转移记录）</td></tr>' : outRows.map((r) => {
    const it = itemById.get(r.itemId);
    const v = r.vendorId ? vendorById.get(r.vendorId) : null;
    if (r.type === 'out') {
      return `<tr>
        <td>${e(r.dateISO)}</td><td>出库</td><td>${e(it?.name ?? '?')}</td>
        <td>${e(fmtQty(it?.unit ?? 'kg', r.qtyMinor))}</td>
        <td>${e(v?.name ?? '?')}${r.manifestNo ? `（联单 ${e(r.manifestNo)}）` : '（联单待补）'}</td>
        <td>${r.amountFen ? e(fmtYuan(r.amountFen)) : '—'}</td>
      </tr>`;
    }
    return `<tr>
      <td>${e(r.dateISO)}</td><td>冲销</td><td>${e(it?.name ?? '?')}</td>
      <td>${e(fmtQty(it?.unit ?? 'kg', r.qtyMinor))}</td><td>红字留痕</td><td>—</td>
    </tr>`;
  }).join('');
  const licHtml = (state.vendors ?? []).length === 0
    ? '<tr><td colspan="4">（暂未登记接收方）</td></tr>'
    : (state.vendors ?? []).map((v) => `<tr>
        <td>${e(v.name)}</td><td>${e(v.licenseNo || '（未登记）')}</td>
        <td>${e(v.licenseExpiryISO ?? '—')}</td>
        <td>${v.licenseNo ? (v.licenseExpiryISO && v.licenseExpiryISO < todayISOStr ? '已过期' : '有效') : '待核验'}</td>
      </tr>`).join('');
  const chkHtml = checks.map((c) => {
    const tag = c.level === 'ok' ? '✓' : c.level === 'warn' ? '△' : '✗';
    return `<tr><td>${tag}</td><td>${e(c.title)}</td><td>${e(c.detail)}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>危险废物管理台账 · ${e(state.org?.name ?? '')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; }
  th { color: #555; font-weight: 500; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>危险废物管理台账 · 自查概要</h1>
<div class="meta">厂店：${e(state.org?.name ?? '（未设厂店名称）')}${state.org?.phone ? ` · 电话 ${e(state.org.phone)}` : ''} · 截至 ${e(todayISOStr)}</div>
<h2>一、存量汇总</h2>
<table><tr><th>品目</th><th>废物代码</th><th>现存量</th><th>期限状态</th></tr>${stockHtml}</table>
<h2>二、转移记录（最近 ${outRows.length} 笔）</h2>
<table><tr><th>日期</th><th>类型</th><th>品目</th><th>数量</th><th>接收方/联单</th><th>款额</th></tr>${recHtml}</table>
<h2>三、接收方资质核验</h2>
<table><tr><th>接收方</th><th>经营许可证号</th><th>有效期至</th><th>状态</th></tr>${licHtml}</table>
<h2>四、红线自查结论</h2>
<table><tr><th>　</th><th>检查项</th><th>结论</th></tr>${chkHtml}</table>
<div class="sign">经办人（签字）：____________　负责人（签字）：____________　日期：____________</div>
<div class="foot">生成：危废账 GarageLedger · ${e(todayISOStr)} · 本台账为产废单位自查记录，不替代法定申报与转移联单报送；品目代码与口径以最新名录及属地要求为准</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 示例数据（一键体验；确定性）
// ---------------------------------------------------------------------------

/** 生成一套可运行的示例数据（相对 todayISOStr 偏移，保证任何时间演示都合理） */
export function demoState(todayISOStr = todayISO()) {
  const d = (n) => addDays(todayISOStr, n);
  const state = {
    org: { name: '示例汽修厂（快速保养）', phone: '13800000000', address: '示例市示例区修车路 1 号' },
    items: AUTO_REPAIR_ITEM_TEMPLATES.map((t, i) => ({ id: `it${i + 1}`, ...t })),
    vendors: [
      { id: 'v1', name: '示例危废收集服务有限公司', licenseNo: '示危废许证字〔2024〕001 号', licenseExpiryISO: d(200), phone: '13900000000' },
      { id: 'v2', name: '示例再生资源回收部', licenseNo: '', licenseExpiryISO: null, phone: '' },
    ],
    records: [],
    checkins: [{ id: 'c1', dateISO: d(-30), kind: 'plan', forYear: todayISOStr.slice(0, 4), note: '示例：已完成年度管理计划备案' }],
    settings: {},
  };
  const mk = (i, partial) => ({ id: `r${i}`, seq: i, refId: null, manifestNo: '', amountFen: 0, vendorId: null, note: '', ...partial });
  // 废机油：最早批次已临期（剩约 25 天）；一笔已联单出库走持证收集商，一笔现金收购待补联单
  state.records.push(
    mk(1, { dateISO: d(-340), itemId: 'it1', type: 'in', qtyMinor: 400, note: '换油集存（最早批次）' }),
    mk(2, { dateISO: d(-120), itemId: 'it1', type: 'in', qtyMinor: 300, note: '换油集存' }),
    mk(3, { dateISO: d(-15), itemId: 'it1', type: 'out', qtyMinor: 100, vendorId: 'v2', manifestNo: '', amountFen: 4000, note: '现金收购' }),
    mk(4, { dateISO: d(-90), itemId: 'it2', type: 'in', qtyMinor: 6, note: '以旧换新暂存' }),
    mk(5, { dateISO: d(-80), itemId: 'it2', type: 'out', qtyMinor: 6, vendorId: 'v1', manifestNo: 'SL2025-000123', amountFen: 18000, note: '凭联单转移' }),
    mk(6, { dateISO: d(-20), itemId: 'it3', type: 'in', qtyMinor: 24, note: '机滤沥干装袋' }),
    mk(7, { dateISO: d(-200), itemId: 'it4', type: 'in', qtyMinor: 150, note: '钣喷房清理' }),
  );
  return state;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 归档备份 / 迎检留存）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'garageledger', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'garageledger') return { ok: false, error: '不是危废账的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.org === 'object' && s.org !== null &&
    arr(s.items) && arr(s.vendors) && arr(s.records) && arr(s.checkins) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
