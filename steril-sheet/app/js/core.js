/**
 * core.js — 灭菌单 SterilSheet 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；数量一律整数运算；日期统一 ISO 字符串
 * yyyy-mm-dd；所有规则参数（生物监测周期/效期/临期天数/医废间隔）可在设置中被覆盖——
 * 标准原文与属地要求永远赢。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md）：
 * - WS 506-2016《口腔器械消毒灭菌技术操作规范》（强制性卫生行业标准）：口腔器械
 *   一人一用一消毒/灭菌，高度危险口腔器械（牙科手机等）必须灭菌；清洗、包装、灭菌、
 *   监测应记录并可追溯——「追溯链」是本产品的第一性对象
 * - 《消毒管理办法》《医院感染管理办法》：医疗机构应建立消毒管理组织与制度，
 *   对消毒灭菌效果进行监测；监督抽查以记录为证据形态
 * - 《医疗废物管理条例》：医疗废物交接登记资料保存 3 年，暂时贮存不得超过 2 天
 * - 《民法典》医疗损害责任纠纷中，隐匿/拒绝提供或遗失、伪造、篡改、违法销毁资料
 *   可被推定有过错（通识口径）——追溯记录 = 诊所在纠纷里的第一道自证
 * - 灭菌物品标识通识：物品名称、灭菌日期、失效日期、操作者——「先用先发」按失效日
 *   FIFO（先灭先用，临期先发）
 * 本工具是诊所侧的院感自查底账与追溯单生成器，不构成医疗鉴定意见，不替代法定报送。
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
// 目录模板（内容供应链：包装类型默认效期 = 行业通识先验，参数可覆盖）
// ---------------------------------------------------------------------------

/** 灭菌器类型 */
export const MACHINE_KINDS = {
  b: { label: 'B 型（预真空）' },
  s: { label: 'S 型' },
  n: { label: 'N 型' },
  cart: { label: '卡式/瞬间' },
};

/** 包装类型与默认效期（灭菌日 + shelfDays = 失效日；行业通识先验，逐包可改） */
export const WRAP_TYPES = {
  pp: { label: '纸塑袋', shelfDays: 180 },
  cloth: { label: '棉布/纺织品', shelfDays: 7 },
  container: { label: '硬质容器', shelfDays: 7 },
};

export const BIO_DEFAULT_INTERVAL_DAYS = 7;  // 生物监测周期默认（以 WS 506 原文与设备说明书为准）
export const BIO_DEFAULT_GRACE_DAYS = 3;     // 「培养中」结果超期亮灯的宽限天数
export const WASTE_DEFAULT_INTERVAL_DAYS = 2; // 医废交接间隔上限（《医疗废物管理条例》暂存≤2天）
export const EXPIRY_DEFAULT_WARN_DAYS = 7;   // 无菌包临期黄线（默认 7 天，参数可覆盖）

/** 器械包目录项：{ id, name, items, wrap, shelfDays, active } */
export function assertPack(pack) {
  if (!pack || typeof pack.name !== 'string' || !pack.name.trim()) {
    throw new Error('器械包必须有名称');
  }
  if (!WRAP_TYPES[pack.wrap]) throw new Error(`包装类型非法: ${pack.wrap}`);
  if (!Number.isInteger(pack.shelfDays) || pack.shelfDays < 1 || pack.shelfDays > 365) {
    throw new Error(`效期天数必须为 1~365 的整数: ${pack.shelfDays}`);
  }
  return pack;
}

/** 建包装默认效期的器械包 */
export function makePack({ id, name, items = '', wrap = 'pp', shelfDays, active = true }) {
  if (!WRAP_TYPES[wrap]) throw new Error(`包装类型非法: ${wrap}`);
  const p = {
    id, name: name.trim(), items, wrap,
    shelfDays: shelfDays ?? WRAP_TYPES[wrap].shelfDays,
    active,
  };
  return assertPack(p);
}

// ---------------------------------------------------------------------------
// 灭菌批次（一锅一单：装载 + 化学/BD/生物监测 + 操作者，锅编号 = 日期 + 锅 + 序）
// ---------------------------------------------------------------------------

export const CHEM_RESULTS = {
  pass: { label: '✅ 合格' },
  fail: { label: '❌ 不合格' },
};

export const BD_RESULTS = {
  none: { label: '— 未做' },
  pass: { label: '✅ 合格' },
  fail: { label: '❌ 不合格' },
};

export const BIO_RESULTS = {
  none: { label: '— 本锅未做' },
  pending: { label: '⏳ 培养中' },
  pass: { label: '✅ 合格' },
  fail: { label: '❌ 阳性' },
};

/** 批次落账校验：装载非空、数量正整数、化学监测必填、不合格必须有处置说明 */
export function assertBatch(batch) {
  assertISO(batch.dateISO);
  if (daysUntil(batch.dateISO, todayISO()) > 0) {
    throw new Error('灭菌日期不能是未来（落账未来发生的锅是编账）');
  }
  if (typeof batch.operator !== 'string' || !batch.operator.trim()) {
    throw new Error('必须填写操作者（灭菌标识通识：记录到人）');
  }
  if (!Array.isArray(batch.loads) || batch.loads.length === 0) {
    throw new Error('装载不能为空：一锅至少装一个器械包');
  }
  let merged = {};
  for (const load of batch.loads) {
    if (!Number.isInteger(load.qty) || load.qty < 1) {
      throw new Error(`装载数量必须为正整数: ${load.qty}`);
    }
    merged[load.packId] = (merged[load.packId] ?? 0) + load.qty;
  }
  batch.loads = Object.keys(merged).map((packId) => ({ packId, qty: merged[packId] }));
  if (!CHEM_RESULTS[batch.chem]) throw new Error(`化学监测结果非法: ${batch.chem}`);
  if (batch.chem === 'fail' && !(batch.chemNote ?? '').trim()) {
    throw new Error('化学监测不合格：必须填写处置说明（该锅器械不得发放使用）');
  }
  if (!BIO_RESULTS[batch.bio]) throw new Error(`生物监测结果非法: ${batch.bio}`);
  if (batch.bio === 'pass' || batch.bio === 'fail') {
    batch.bioISO = batch.bioISO ?? batch.dateISO;
    assertISO(batch.bioISO);
  }
  return batch;
}

/** 批次号：灭菌日 + 锅代码 + 当日第几锅（两位序号，创建时定死） */
export function makeBatchNo(batches, machine, dateISO) {
  assertISO(dateISO);
  const prefix = `${dateISO.replace(/-/g, '')}-${machine.code || 'M'}`;
  const seq = batches.filter((b) => b.no?.startsWith(prefix)).length + 1;
  return `${prefix}-${String(seq).padStart(2, '0')}`;
}

/** 批次状态（派生，不落库）：rejected 化学不合格未放行 / recall-open 召回中 / recall-closed 召回已销案 / bio-pending 培养中 / normal */
export function batchState(batch) {
  if (batch.chem === 'fail') return 'rejected';
  if (batch.bio === 'fail') {
    return batch.recall?.closedISO ? 'recall-closed' : 'recall-open';
  }
  if (batch.bio === 'pending') return 'bio-pending';
  return 'normal';
}

export const BATCH_STATE_LABEL = {
  normal: '✅ 正常',
  'bio-pending': '⏳ 培养中',
  'recall-open': '🔴 召回进行中',
  'recall-closed': '🟤 召回已销案',
  rejected: '⛔ 化学不合格',
};

/** 批次 + 某包的在库数量（守恒：装载 − 已使用分配 − 已处置），由流水派生不落库 */
export function unitStock(batch, packId, usages, treatments) {
  const load = batch.loads.find((l) => l.packId === packId)?.qty ?? 0;
  const used = (usages ?? []).reduce(
    (n, u) => n + (u.alloc ?? []).filter((a) => a.batchId === batch.id && a.packId === packId)
      .reduce((m, a) => m + a.qty, 0),
    0,
  );
  const treated = (treatments ?? []).reduce(
    (n, t) => n + (t.batchId === batch.id && t.packId === packId ? t.qty : 0),
    0,
  );
  return load - used - treated;
}

/** 失效日 = 灭菌日 + 包效期天数；失效日当天仍可用，次日起过期 */
export function expireISOOf(batch, pack) {
  return addDays(batch.dateISO, pack.shelfDays);
}

/** 效期三态：expired 过期 / warn 临期 / ok；warnDays 参数可覆盖 */
export function shelfLevel(expireISO, todayISOStr, warnDays = EXPIRY_DEFAULT_WARN_DAYS) {
  assertISO(expireISO);
  assertISO(todayISOStr);
  if (!Number.isInteger(warnDays) || warnDays < 1) throw new Error('临期天数非法');
  const left = daysUntil(expireISO, todayISOStr);
  if (left < 0) return 'expired';
  if (left <= warnDays) return 'warn';
  return 'ok';
}

export const SHELF_DOT = { ok: '🟢', warn: '🟡', expired: '🔴' };

/** 该批次是否可参与发放：状态正常/培养中、化学合格、未被召回 */
export function isIssuable(batch) {
  const st = batchState(batch);
  return st === 'normal' || st === 'bio-pending';
}

/**
 * FIFO 分配：先用最早失效的合格在库包（先灭先用，临期先发）。
 * 只从「发放合法」的批次分配：跳过过期（失效日在使用日之前）、召回中/已销案、
 * 化学不合格与过期批次——用过期无菌包是院感事故，工具在此处是硬门禁。
 * 返回 [{ batchId, no, qty, expireISO }]；可用不足时给出可执行的错误。
 */
export function allocateFIFO(state, packId, qty, usageISOStr = todayISO()) {
  assertISO(usageISOStr);
  if (!Number.isInteger(qty) || qty < 1) throw new Error(`发放数量必须为正整数: ${qty}`);
  const pack = (state.packs ?? []).find((p) => p.id === packId);
  if (!pack) throw new Error('器械包不存在');
  const rows = (state.batches ?? [])
    .filter((b) => b.loads.some((l) => l.packId === packId))
    .map((b) => ({
      batch: b,
      stock: unitStock(b, packId, state.usages, state.treatments),
      expireISO: expireISOOf(b, pack),
    }))
    .filter((r) => r.stock > 0);
  const available = rows
    .filter((r) => isIssuable(r.batch) && daysUntil(r.expireISO, usageISOStr) >= 0)
    .sort((a, b) => a.expireISO.localeCompare(b.expireISO) || a.batch.no.localeCompare(b.batch.no));
  const totalAvail = available.reduce((n, r) => n + r.stock, 0);
  if (totalAvail < qty) {
    const expiredQty = rows
      .filter((r) => daysUntil(r.expireISO, usageISOStr) < 0)
      .reduce((n, r) => n + r.stock, 0);
    const frozenQty = rows.filter((r) => !isIssuable(r.batch)).reduce((n, r) => n + r.stock, 0);
    if (expiredQty > 0) {
      throw new Error(`可用在库只有 ${totalAvail} 个，另有 ${expiredQty} 个已过期——先在「无菌柜」做过期处置，不许发过期的`);
    }
    if (frozenQty > 0) {
      throw new Error(`可用在库只有 ${totalAvail} 个，另有 ${frozenQty} 个在召回/不合格批次里被冻结——处置后再发放`);
    }
    throw new Error(`「${pack.name}」可用在库只有 ${totalAvail} 个，不够发 ${qty} 个`);
  }
  const alloc = [];
  let left = qty;
  for (const r of available) {
    if (left <= 0) break;
    const take = Math.min(left, r.stock);
    alloc.push({ batchId: r.batch.id, no: r.batch.no, packId, qty: take, expireISO: r.expireISO });
    left -= take;
  }
  return alloc;
}

/** 使用落账：{ id, packId, qty, patientRef, operator, dateISO }——追溯链的「患者端点」 */
export function recordUsage(state, { id, packId, qty, patientRef, operator = '', dateISO, note = '' }) {
  const pack = (state.packs ?? []).find((p) => p.id === packId);
  if (!pack) throw new Error('器械包不存在');
  if (pack.active === false) throw new Error(`「${pack.name}」已停用，不能再发放`);
  if (typeof patientRef !== 'string' || !patientRef.trim()) {
    throw new Error('必须填写患者标识（姓名缩写或病历号）——没有患者端点，追溯链就不闭合');
  }
  assertISO(dateISO);
  const alloc = allocateFIFO(state, packId, qty, dateISO);
  const usage = { id, packId, qty, patientRef: patientRef.trim(), operator, dateISO, note, alloc };
  state.usages.push(usage);
  return usage;
}

/** 撤销使用落账（误操作回滚）： allocations 归还在库；被召回批次的已发放记录不可撤销（召回名单已生成） */
export function removeUsage(state, usageId) {
  const idx = state.usages.findIndex((u) => u.id === usageId);
  if (idx < 0) throw new Error(`使用记录不存在: ${usageId}`);
  const usage = state.usages[idx];
  const touched = new Set(usage.alloc.map((a) => a.batchId));
  for (const batchId of touched) {
    const batch = state.batches.find((b) => b.id === batchId);
    if (batch && batchState(batch).startsWith('recall')) {
      throw new Error('该批次已进入召回流程，发放记录是召回名单的一部分，不可撤销');
    }
  }
  state.usages.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 生物监测补录与召回闭环（监测阳性 → 冻结在库 + 已发放名单 → 处置销案）
// ---------------------------------------------------------------------------

/** 补录生物监测结果：none/pending → pass/fail；合格与销案后锁定（防事后洗账） */
export function updateBio(state, batchId, { bio, bioISO, note = '' }) {
  const batch = (state.batches ?? []).find((b) => b.id === batchId);
  if (!batch) throw new Error(`批次不存在: ${batchId}`);
  if (!BIO_RESULTS[bio]) throw new Error(`生物监测结果非法: ${bio}`);
  const cur = batch.bio;
  if (cur === 'pass') throw new Error('生物监测已记录合格，不能改判（如录错请走处置登记并在设置中说明）');
  if (cur === 'fail') throw new Error('生物监测已记录阳性，走召回处置闭环，不能直接改判');
  if (bio === 'none') throw new Error('只能补录「培养中 / 合格 / 阳性」');
  batch.bio = bio;
  batch.bioISO = bioISO || todayISO();
  assertISO(batch.bioISO);
  if (bio === 'fail') {
    batch.recall = { openedISO: todayISO(), note: note || '生物监测阳性，启动召回', closedISO: null, closeNote: null };
  }
  return batch;
}

/** 召回名单：该批次已发放到哪些患者（什么时候、用了几个）——真实召回的执行清单 */
export function recallList(state, batchId) {
  const batch = (state.batches ?? []).find((b) => b.id === batchId);
  if (!batch) throw new Error(`批次不存在: ${batchId}`);
  const packById = Object.fromEntries((state.packs ?? []).map((p) => [p.id, p]));
  const out = [];
  for (const u of state.usages) {
    for (const a of u.alloc) {
      if (a.batchId !== batchId) continue;
      out.push({
        dateISO: u.dateISO,
        patientRef: u.patientRef,
        packName: packById[u.packId]?.name ?? u.packId,
        qty: a.qty,
      });
    }
  }
  return out.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/** 销案：必须先处置完在库冻结包（守恒闭环），并写明处置经过 */
export function closeRecall(state, batchId, { note }) {
  const batch = (state.batches ?? []).find((b) => b.id === batchId);
  if (!batch) throw new Error(`批次不存在: ${batchId}`);
  if (batchState(batch) !== 'recall-open') throw new Error('该批次不在召回进行中');
  if (typeof note !== 'string' || !note.trim()) {
    throw new Error('必须写明处置经过（复测结果 / 全部重新处理凭证）');
  }
  const frozen = (state.packs ?? [])
    .map((p) => ({ p, qty: unitStock(batch, p.id, state.usages, state.treatments) }))
    .filter((r) => r.qty > 0);
  if (frozen.length > 0) {
    throw new Error(`还有 ${frozen.reduce((n, r) => n + r.qty, 0)} 个在库包未处置（${frozen.map((r) => `${r.p.name}×${r.qty}`).join('、')}）——先在「无菌柜」完成处置登记再销案`);
  }
  batch.recall.closedISO = todayISO();
  batch.recall.closeNote = note.trim();
  return batch;
}

/** 处置登记（过期 / 召回冻结包的出口）：action = discard 报废 | reprocess 重新清洗包装灭菌 */
export function registerTreatment(state, { id, batchId, packId, qty, action, note = '', dateISO }) {
  const batch = (state.batches ?? []).find((b) => b.id === batchId);
  if (!batch) throw new Error(`批次不存在: ${batchId}`);
  if (!['discard', 'reprocess'].includes(action)) throw new Error(`处置方式非法: ${action}`);
  if (!Number.isInteger(qty) || qty < 1) throw new Error(`处置数量必须为正整数: ${qty}`);
  assertISO(dateISO);
  const stock = unitStock(batch, packId, state.usages, state.treatments);
  if (qty > stock) throw new Error(`处置数量（${qty}）超过在库（${stock}）——账实守恒不允许多处置`);
  const t = { id, batchId, packId, qty, action, note, dateISO };
  state.treatments.push(t);
  return t;
}

// ---------------------------------------------------------------------------
// 无菌柜（在库台账 + 过期点名）
// ---------------------------------------------------------------------------

/** 在库行：每个「批次 × 包」的在库单元，按失效日升序（先用先发的一张表） */
export function stockRows(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  const packById = Object.fromEntries((state.packs ?? []).map((p) => [p.id, p]));
  const rows = [];
  for (const b of state.batches ?? []) {
    for (const l of b.loads) {
      const pack = packById[l.packId];
      if (!pack) continue;
      const qty = unitStock(b, l.packId, state.usages, state.treatments);
      if (qty <= 0) continue;
      const expireISO = expireISOOf(b, pack);
      rows.push({
        batch: b, pack, qty, expireISO,
        level: shelfLevel(expireISO, todayISOStr),
        frozen: !isIssuable(b),
      });
    }
  }
  return rows.sort((a, b) => a.expireISO.localeCompare(b.expireISO) || a.batch.no.localeCompare(b.batch.no));
}

/** 过期未处置点名：在库 > 0 且已过期且批次本身未进召回（召回走召回流程） */
export function expiredRows(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  return stockRows(state, todayISOStr).filter(
    (r) => r.level === 'expired' && !r.frozen,
  );
}

// ---------------------------------------------------------------------------
// 周期任务（生物监测 / 医废交接 / 健康证 / 消毒产品效期）
// ---------------------------------------------------------------------------

/** 生物监测到期：以最近一次「合格/阳性」记录日为锚点 + 周期 */
export function bioDue(state, todayISOStr = todayISO(), intervalDays = BIO_DEFAULT_INTERVAL_DAYS) {
  assertISO(todayISOStr);
  if (!Number.isInteger(intervalDays) || intervalDays < 1) throw new Error('生物监测周期非法');
  const dated = (state.batches ?? []).filter((b) => b.bio === 'pass' || b.bio === 'fail');
  if (dated.length === 0) {
    return { lastISO: null, dueISO: null, daysLeft: null, status: 'never' };
  }
  const lastISO = dated.map((b) => b.bioISO).sort().at(-1);
  const dueISO = addDays(lastISO, intervalDays);
  const daysLeft = daysUntil(dueISO, todayISOStr);
  return { lastISO, dueISO, daysLeft, status: daysLeft < 0 ? 'overdue' : 'due' };
}

/** 「培养中」结果超期名单：超过宽限天数仍无结果的批次（阳性要 48 小时内知道，拖着就是隐瞒） */
export function bioPendingOverdue(state, todayISOStr = todayISO(), graceDays = BIO_DEFAULT_GRACE_DAYS) {
  assertISO(todayISOStr);
  return (state.batches ?? []).filter(
    (b) => b.bio === 'pending' && daysUntil(todayISOStr, b.dateISO) > graceDays,
  );
}

/** 医废交接到期：最近一次交接日 + 间隔（条例口径：暂存不超过 2 天） */
export function wasteDue(state, todayISOStr = todayISO(), intervalDays = WASTE_DEFAULT_INTERVAL_DAYS) {
  assertISO(todayISOStr);
  const lastISO = (state.wastes ?? []).map((w) => w.dateISO).sort().at(-1) ?? null;
  if (!lastISO) return { lastISO: null, dueISO: null, daysLeft: null, status: 'never' };
  const dueISO = addDays(lastISO, intervalDays);
  const daysLeft = daysUntil(dueISO, todayISOStr);
  return { lastISO, dueISO, daysLeft, status: daysLeft < 0 ? 'overdue' : 'due' };
}

/** 健康证预警：expired 过期 / warn 30 天内到期 / ok */
export function certLevel(validUntil, todayISOStr = todayISO(), warnDays = 30) {
  assertISO(validUntil);
  assertISO(todayISOStr);
  const left = daysUntil(validUntil, todayISOStr);
  if (left < 0) return 'expired';
  if (left <= warnDays) return 'warn';
  return 'ok';
}

/** 消毒产品/指示物效期预警 */
export function consumableLevel(item, todayISOStr = todayISO(), warnDays = 30) {
  return certLevel(item.validUntil, todayISOStr, warnDays);
}

// ---------------------------------------------------------------------------
// 院感体检（自查三查：监测连续性 / 效期守恒 / 周期任务）
// ---------------------------------------------------------------------------

/**
 * 院感体检：把「检查前心里没底」变成一张可打分的清单。
 * 返回 { score, total, checks: [{ key, label, level: ok|warn|issue, detail }] }。
 */
export function selfCheck(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  const settings = state.settings ?? {};
  const checks = [];
  const hasBatches = (state.batches ?? []).length > 0;

  const bio = bioDue(state, todayISOStr, settings.bioIntervalDays);
  if (!hasBatches) {
    checks.push({ key: 'bio', label: '生物监测周期', level: 'ok', detail: '尚无灭菌记录，建锅后开始计周期' });
  } else if (bio.status === 'never') {
    checks.push({ key: 'bio', label: '生物监测周期', level: 'issue', detail: '已有灭菌记录但从未做过生物监测——监测连续性断链' });
  } else if (bio.status === 'overdue') {
    const over = -bio.daysLeft;
    checks.push({
      key: 'bio', label: '生物监测周期',
      level: over > 3 ? 'issue' : 'warn',
      detail: `距上次已 ${daysUntil(todayISOStr, bio.lastISO)} 天（周期 ${settings.bioIntervalDays ?? BIO_DEFAULT_INTERVAL_DAYS} 天），超期 ${over} 天`,
    });
  } else {
    checks.push({ key: 'bio', label: '生物监测周期', level: 'ok', detail: `下次到期 ${bio.dueISO}（还有 ${bio.daysLeft} 天）` });
  }

  const pending = bioPendingOverdue(state, todayISOStr, settings.bioGraceDays);
  checks.push(pending.length
    ? { key: 'bio-pending', label: '培养中结果', level: 'issue', detail: `${pending.length} 锅「培养中」超过 ${settings.bioGraceDays ?? BIO_DEFAULT_GRACE_DAYS} 天没录结果——阳性要第一时间知道` }
    : { key: 'bio-pending', label: '培养中结果', level: 'ok', detail: '没有拖着没录结果的培养' });

  const expired = expiredRows(state, todayISOStr);
  checks.push(expired.length
    ? { key: 'expired', label: '过期在库', level: 'issue', detail: `${expired.reduce((n, r) => n + r.qty, 0)} 个过期包还在无菌柜（${expired.map((r) => `${r.pack.name}×${r.qty}`).join('、')}）——先处置，不许发放` }
    : { key: 'expired', label: '过期在库', level: 'ok', detail: '没有过期在库' });

  const recalls = (state.batches ?? []).filter((b) => batchState(b) === 'recall-open');
  checks.push(recalls.length
    ? { key: 'recall', label: '召回闭环', level: 'issue', detail: `${recalls.length} 锅召回未销案（${recalls.map((b) => b.no).join('、')}）——处置在库、通知已发放患者、写明经过` }
    : { key: 'recall', label: '召回闭环', level: 'ok', detail: '没有进行中的召回' });

  const waste = wasteDue(state, todayISOStr, settings.wasteIntervalDays);
  if (!state.wastes?.length) {
    checks.push({ key: 'waste', label: '医废交接', level: 'warn', detail: '还没记过交接——条例口径暂存不超过 2 天，先记一笔' });
  } else if (waste.status === 'overdue') {
    checks.push({
      key: 'waste', label: '医废交接',
      level: -waste.daysLeft > (settings.wasteIntervalDays ?? WASTE_DEFAULT_INTERVAL_DAYS) ? 'issue' : 'warn',
      detail: `上次交接 ${waste.lastISO}，按 ${settings.wasteIntervalDays ?? WASTE_DEFAULT_INTERVAL_DAYS} 天间隔已超期 ${-waste.daysLeft} 天`,
    });
  } else {
    checks.push({ key: 'waste', label: '医废交接', level: 'ok', detail: `下次交接 ${waste.dueISO}` });
  }

  const staffBad = (state.staff ?? []).filter((s) => certLevel(s.certValidUntil, todayISOStr) !== 'ok');
  checks.push(staffBad.length
    ? { key: 'cert', label: '健康证', level: staffBad.some((s) => certLevel(s.certValidUntil, todayISOStr) === 'expired') ? 'issue' : 'warn', detail: staffBad.map((s) => `${s.name}（至 ${s.certValidUntil}）`).join('、') + ' 需要体检换证' }
    : { key: 'cert', label: '健康证', level: 'ok', detail: `${(state.staff ?? []).length} 名人员证件均在有效期` });

  const consBad = (state.consumables ?? []).filter((c) => consumableLevel(c, todayISOStr) === 'expired');
  checks.push(consBad.length
    ? { key: 'consumable', label: '消毒产品/指示物', level: 'warn', detail: `${consBad.map((c) => c.name).join('、')} 已过期——停用并换新` }
    : { key: 'consumable', label: '消毒产品/指示物', level: 'ok', detail: '在用指示物与消毒剂均在有效期' });

  const weight = { ok: 1, warn: 0.5, issue: 0 };
  const score = Math.round((checks.reduce((n, c) => n + weight[c.level], 0) / checks.length) * 100);
  return { score, total: checks.length, checks };
}

// ---------------------------------------------------------------------------
// 月度台账
// ---------------------------------------------------------------------------

/** 月度灭菌账：按月分组，跨年隔离。锅按灭菌日、使用按落账日、监测按结果日 */
export function monthlyReport(state, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const inMonth = (iso) => monthKey(iso) === month;
  const batches = (state.batches ?? []).filter((b) => inMonth(b.dateISO));
  const usages = (state.usages ?? []).filter((u) => inMonth(u.dateISO));
  const bios = (state.batches ?? []).filter((b) => b.bioISO && inMonth(b.bioISO) && (b.bio === 'pass' || b.bio === 'fail'));
  return {
    batchCount: batches.length,
    packCount: batches.reduce((n, b) => n + b.loads.reduce((m, l) => m + l.qty, 0), 0),
    usedCount: usages.reduce((n, u) => n + u.qty, 0),
    usageCount: usages.length,
    bioCount: bios.length,
    bioFailCount: bios.filter((b) => b.bio === 'fail').length,
    recallCount: (state.batches ?? []).filter((b) => b.recall && inMonth(b.recall.openedISO)).length,
  };
}

/** 当月批次行（迎检包主表） */
export function monthBatchRows(state, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const machineById = Object.fromEntries((state.machines ?? []).map((m) => [m.id, m]));
  const packById = Object.fromEntries((state.packs ?? []).map((p) => [p.id, p]));
  return (state.batches ?? [])
    .filter((b) => monthKey(b.dateISO) === month)
    .sort((a, b) => a.no.localeCompare(b.no))
    .map((b) => ({
      no: b.no,
      dateISO: b.dateISO,
      machine: machineById[b.machineId]?.name ?? '—',
      loadsText: b.loads.map((l) => `${packById[l.packId]?.name ?? l.packId}×${l.qty}`).join('、'),
      chem: CHEM_RESULTS[b.chem].label,
      bd: BD_RESULTS[b.bd ?? 'none'].label,
      bio: BIO_RESULTS[b.bio].label,
      operator: b.operator,
      state: BATCH_STATE_LABEL[batchState(b)],
    }));
}

// ---------------------------------------------------------------------------
// 追溯自证单（纠纷与投诉里的第一道自证：患者端点 → 包 → 批次 → 监测）
// ---------------------------------------------------------------------------

/** 按患者标识拼追溯链（精确匹配患者标识；每次使用 → 分配的每个批次） */
export function traceFor(state, patientRef) {
  const ref = String(patientRef ?? '').trim();
  if (!ref) throw new Error('请输入患者标识（姓名缩写或病历号）');
  const packById = Object.fromEntries((state.packs ?? []).map((p) => [p.id, p]));
  const machineById = Object.fromEntries((state.machines ?? []).map((m) => [m.id, m]));
  const entries = [];
  for (const u of (state.usages ?? []).filter((x) => x.patientRef === ref)) {
    entries.push({
      dateISO: u.dateISO,
      operator: u.operator,
      packs: u.alloc.map((a) => {
        const b = (state.batches ?? []).find((x) => x.id === a.batchId);
        const bs = b ? batchState(b) : 'normal';
        return {
          packName: packById[u.packId]?.name ?? u.packId,
          qty: a.qty,
          no: b?.no ?? a.no,
          machine: b ? (machineById[b.machineId]?.name ?? '—') : '—',
          sterilizedISO: b?.dateISO ?? null,
          expireISO: a.expireISO,
          chem: b ? CHEM_RESULTS[b.chem].label : '—',
          bio: b ? BIO_RESULTS[b.bio].label : '—',
          operator: b?.operator ?? '',
          recalled: bs.startsWith('recall'),
        };
      }),
    });
  }
  return entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/** 追溯单文本（微信/口头查询即回，主通道）。同输入同输出 */
export function traceText({ clinic, patientRef, entries, todayISOStr = todayISO() }) {
  const L = [];
  L.push(`【器械灭菌追溯单】${clinic?.name || '本诊所'}`);
  L.push(`患者标识：${patientRef} · 出具日：${todayISOStr}`);
  L.push('说明：本单仅含器械清洗消毒灭菌追溯信息，不含诊疗内容；患者标识以本所登记为准。');
  L.push('');
  if (!entries.length) {
    L.push('未查询到该患者标识的使用记录。请核对标识写法（本所按登记原文检索）。');
  }
  let i = 0;
  for (const e of entries) {
    i += 1;
    L.push(`第 ${i} 次 · ${e.dateISO}`);
    for (const p of e.packs) {
      L.push(`  - ${p.packName} ×${p.qty}`);
      L.push(`    批次 ${p.no} · 灭菌 ${p.sterilizedISO ?? '—'} · 失效 ${p.expireISO} · 锅次 ${p.machine}`);
      L.push(`    化学监测 ${p.chem} · 生物监测 ${p.bio} · 灭菌操作 ${p.operator || '—'}`);
      if (p.recalled) L.push('    ⚠ 该批次曾启动召回，处置经过见召回记录');
    }
  }
  L.push('');
  L.push('声明：本单为诊所器械消毒灭菌追溯记录，供依法查询与监督检查备查；原始记录以本所灭菌台账为准，不构成医疗鉴定意见。');
  L.push(`生成：灭菌单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 追溯单打印版：单文件 HTML（内联样式，无外部资源） */
export function traceHtml({ clinic, patientRef, entries, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const rows = [];
  let i = 0;
  for (const en of entries) {
    i += 1;
    for (const p of en.packs) {
      rows.push(`<tr>
        <td>${i}</td><td>${e(en.dateISO)}</td><td>${e(p.packName)} ×${p.qty}</td>
        <td>${e(p.no)}</td><td>${e(p.sterilizedISO ?? '—')}</td><td>${e(p.expireISO)}</td>
        <td>${e(p.chem)} / ${e(p.bio)}</td><td>${e(p.operator || '—')}${p.recalled ? '<br/>⚠ 曾启动召回' : ''}</td>
      </tr>`);
    }
  }
  const body = rows.length
    ? `<table><tr><th>#</th><th>使用日</th><th>器械包</th><th>批次号</th><th>灭菌日</th><th>失效日</th><th>化学/生物监测</th><th>灭菌操作</th></tr>${rows.join('')}</table>`
    : '<p class="meta">未查询到该患者标识的使用记录，请核对标识写法。</p>';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>器械灭菌追溯单 · ${e(patientRef)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { color: #555; font-weight: 500; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>器械灭菌追溯单 · ${e(clinic?.name || '本诊所')}</h1>
<div class="meta">患者标识：${e(patientRef)} · 出具日 ${e(todayISOStr)}</div>
<div class="meta">说明：本单仅含器械清洗消毒灭菌追溯信息，不含诊疗内容。</div>
${body}
<p class="meta">声明：本单为诊所器械消毒灭菌追溯记录，供依法查询与监督检查备查；原始记录以本所灭菌台账为准，不构成医疗鉴定意见。</p>
<div class="foot">生成：灭菌单 SterilSheet · ${e(todayISOStr)} · 负责人签字：____________</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 迎检包（月度灭菌与监测台账：单文件 HTML 打印版 + 文本版）
// ---------------------------------------------------------------------------

/** 迎检包文本 */
export function inspectionText({ clinic, state, month, todayISOStr = todayISO() }) {
  const rows = monthBatchRows(state, month);
  const report = monthlyReport(state, month);
  const check = selfCheck(state, todayISOStr);
  const L = [];
  L.push(`【${month} 灭菌与监测台账】${clinic?.name || '本诊所'}`);
  L.push(`出具日：${todayISOStr} · 本月灭菌 ${report.batchCount} 锅 / ${report.packCount} 包 · 发放 ${report.usedCount} 包 · 生物监测 ${report.bioCount} 次`);
  L.push('');
  L.push('一、灭菌锅次台账');
  if (!rows.length) L.push('  （本月无灭菌记录）');
  for (const r of rows) {
    L.push(`  - ${r.no} · ${r.dateISO} · ${r.machine}`);
    L.push(`    装载：${r.loadsText}`);
    L.push(`    化学监测 ${r.chem} · BD ${r.bd} · 生物监测 ${r.bio} · 操作 ${r.operator} · ${r.state}`);
  }
  L.push('');
  L.push('二、院感自查体检');
  for (const c of check.checks) {
    const mark = c.level === 'ok' ? '✅' : c.level === 'warn' ? '🟡' : '🔴';
    L.push(`  - ${mark} ${c.label}：${c.detail}`);
  }
  L.push(`  体检得分：${check.score} / 100`);
  L.push('');
  L.push('声明：本台账为诊所自查与迎检备查记录，以本所原始记录为准；监测频次与判定标准以 WS 506-2016 及属地要求为准。');
  L.push(`生成：灭菌单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 迎检包打印版：单文件 HTML（含负责人签字栏） */
export function inspectionHtml({ clinic, state, month, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const rows = monthBatchRows(state, month);
  const report = monthlyReport(state, month);
  const check = selfCheck(state, todayISOStr);
  const batchRows = rows.length
    ? rows.map((r) => `<tr><td>${e(r.no)}</td><td>${e(r.dateISO)}</td><td>${e(r.machine)}</td>
        <td>${e(r.loadsText)}</td><td>${e(r.chem)}</td><td>${e(r.bd)}</td><td>${e(r.bio)}</td>
        <td>${e(r.operator)}</td><td>${e(r.state)}</td></tr>`).join('')
    : '<tr><td colspan="9">（本月无灭菌记录）</td></tr>';
  const checkRows = check.checks.map((c) => {
    const mark = c.level === 'ok' ? '✅' : c.level === 'warn' ? '🟡' : '🔴';
    return `<tr><td>${mark} ${e(c.label)}</td><td>${e(c.detail)}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${e(month)} 灭菌与监测台账 · ${e(clinic?.name || '本诊所')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { color: #555; font-weight: 500; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>${e(month)} 灭菌与监测台账 · ${e(clinic?.name || '本诊所')}</h1>
<div class="meta">出具日 ${e(todayISOStr)} · 本月灭菌 ${report.batchCount} 锅 / ${report.packCount} 包 · 发放 ${report.usedCount} 包 · 生物监测 ${report.bioCount} 次（阳性 ${report.bioFailCount}）· 召回 ${report.recallCount} 次</div>
<h2>一、灭菌锅次台账</h2>
<table><tr><th>锅编号</th><th>灭菌日</th><th>灭菌器</th><th>装载</th><th>化学</th><th>BD</th><th>生物</th><th>操作者</th><th>状态</th></tr>${batchRows}</table>
<h2>二、院感自查体检（得分 ${check.score}/100）</h2>
<table>${checkRows}</table>
<p class="meta">声明：本台账为诊所自查与迎检备查记录，以本所原始记录为准；监测频次与判定标准以 WS 506-2016 及属地要求为准。</p>
<div class="sign">诊所负责人（签字/盖章）：____________　检查人员：____________　日期：____________</div>
<div class="foot">生成：灭菌单 SterilSheet · ${e(todayISOStr)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'sterilsheet', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'sterilsheet') return { ok: false, error: '不是灭菌单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.clinic === 'object' && s.clinic !== null &&
    arr(s.machines) && arr(s.packs) && arr(s.batches) && arr(s.usages) &&
    arr(s.treatments) && typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
