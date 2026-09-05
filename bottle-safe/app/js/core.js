/**
 * core.js — 瓶安单 BottleSafe 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；金额一律整数「分」、瓶数一律非负整数运算；日期统一 ISO
 * 字符串 yyyy-mm-dd；在户瓶数不落库——由配送流水唯一派生（送出 − 收回，负数守卫）；
 * 隐患判定由检查项实时推导，整改闭环由流水唯一派生（未复访即未闭环）。
 *
 * 合规口径（来源与标注见 docs/14-调研来源.md）：
 * - 《城镇燃气管理条例》（国务院令第 583 号，2011 年施行）：燃气经营者应指导用户
 *   安全用气并对用户燃气设施定期进行安全检查，不履行义务有责令改正与罚款等罚则
 *   （义务框架通识口径；罚额区间检索受限，引用前在条例法律责任章节复核）
 * - 城镇燃气安全专项整治（2021 十堰"6·13"事故后部署，2023 起深化）：送气必检、
 *   实名购气、软管/减压阀/超期瓶为高频隐患（通识口径）
 * - 《气瓶安全技术规程》（TSG 23-2021）口径：气瓶定期检验由充装单位负责；网点侧
 *   义务为不给用户超期瓶——检验周期（通识 48 个月）与预警窗为参数化默认值
 * - 入户安检五项（软管/减压阀/钢瓶/灶具连接/通风环境）为常见检查通报关键词的
 *   通识整理，绝非完整安检清单——**条例原文与属地燃气管理部门要求永远赢**
 * 本工具是网点自己的经营底账与迎检/告知凭据，不判记录真伪，不替代充装追溯、
 * 政府报送与法定安检义务，不构成法律意见。
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

/** 金额：整数分 → 「¥420.00」 */
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
// 瓶型与安检项（内容供应链：行业通识口径整理）
// ---------------------------------------------------------------------------

/** 瓶型（液化石油气钢瓶常见规格） */
export const CYLINDER_SPECS = {
  '5kg': { label: '5kg（小瓶）' },
  '15kg': { label: '15kg（家用标准）' },
  '50kg': { label: '50kg（餐饮商用）' },
};

/** 入户安检五项（常见检查通报关键词的通识整理，属地安检表永远可覆盖） */
export const CHECK_ITEMS = {
  hose: { label: '软管', hint: '老化/龟裂/超长/穿墙' },
  valve: { label: '减压阀', hint: '超期/失效/漏气' },
  cylinder: { label: '钢瓶', hint: '超期未检/锈蚀/超量存放' },
  stove: { label: '灶具连接', hint: '连接不牢/距离过近' },
  vent: { label: '通风环境', hint: '通风不良/瓶灶同室/堆杂物' },
};

/** 检查项取值：ok 正常 | risk 隐患 | na 不适用 */
export const ITEM_VALUES = ['ok', 'risk', 'na'];

/** 周期默认参数（全部可被 settings 覆盖） */
export const DEFAULT_PARAMS = {
  annualCheckDays: 365,     // 年度安检周期（天，通识口径"每年至少一次"）
  nearAnnualDays: 30,       // 年度安检临期窗
  cylinderCycleMonths: 48,  // 钢瓶检验周期（月，通识口径）
  cylinderWarnDays: 90,     // 钢瓶检验预警窗
  certWarnDays: 30,         // 员工证件预警窗
  checkWindowDays: 30,      // 断更体检回看窗
};

/** 实际生效的周期参数 */
export function paramsOf(settings) {
  return { ...DEFAULT_PARAMS, ...(settings ?? {}) };
}

function requireRef(repos, id, label) {
  const hit = (repos ?? []).find((x) => x.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

// ---------------------------------------------------------------------------
// 用户档案（实名底档：配送与安检共用）
// ---------------------------------------------------------------------------

/**
 * 新建用户。user: { id, name, phone, addr, specs, note }
 * - specs 常用瓶型数组（默认 ['15kg']）
 */
export function addUser(state, user) {
  const name = String(user.name ?? '').trim();
  if (!name) throw new Error('用户名称必填');
  const specs = (user.specs ?? ['15kg']).filter((s) => CYLINDER_SPECS[s]);
  if (!specs.length) specs.push('15kg');
  const item = {
    id: user.id,
    name,
    phone: String(user.phone ?? '').trim(),
    addr: String(user.addr ?? '').trim(),
    specs,
    note: String(user.note ?? '').trim(),
  };
  state.users.push(item);
  return item;
}

/** 删除用户：有配送或安检记录的不可删（台账连续性） */
export function removeUser(state, userId) {
  const idx = state.users.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error(`用户不存在: ${userId}`);
  if ((state.deliveries ?? []).some((d) => d.userId === userId) ||
      (state.checks ?? []).some((c) => c.userId === userId)) {
    throw new Error('该用户有配送或安检记录，不可删除（台账连续性）');
  }
  state.users.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 配送落账（守恒账：送出 − 收回 = 在户瓶数，流水唯一派生）
// ---------------------------------------------------------------------------

/**
 * 配送落账。entry: { id, dateISO, userId, lines: [{ spec, full, empty }], amountCents, note }
 * - 每行：满瓶送出 full、空瓶收回 empty（非负整数，且该行 full+empty ≥ 1）
 * - 同一瓶型一行，重复行拒绝
 * - 收回不得超过在户瓶数：变动后在户瓶数为负 → 整单拒绝（负数守卫）
 * - 金额可选（整数分）
 */
export function recordDelivery(state, entry) {
  requireRef(state.users, entry.userId, '用户');
  assertISO(entry.dateISO);
  const lines = entry.lines ?? [];
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('配送至少包含一个瓶型行');
  const seen = new Set();
  for (const ln of lines) {
    if (!CYLINDER_SPECS[ln.spec]) throw new Error(`未知瓶型: ${ln.spec}`);
    if (seen.has(ln.spec)) throw new Error('同一瓶型在一单中重复出现，请合并数量');
    seen.add(ln.spec);
    if (!Number.isInteger(ln.full) || ln.full < 0) throw new Error(`送出瓶数应为非负整数: ${ln.full}`);
    if (!Number.isInteger(ln.empty) || ln.empty < 0) throw new Error(`收回瓶数应为非负整数: ${ln.empty}`);
    if (ln.full + ln.empty < 1) throw new Error('每个瓶型行至少送出或收回 1 瓶');
  }
  if (entry.amountCents !== null && entry.amountCents !== undefined && !Number.isInteger(entry.amountCents)) {
    throw new Error(`金额必须为整数分: ${entry.amountCents}`);
  }
  // 负数守卫：先校验后落账，绝不部分入账
  for (const ln of lines) {
    const balance = userBalance(state, entry.userId, ln.spec);
    if (balance + ln.full - ln.empty < 0) {
      throw new Error(`「${CYLINDER_SPECS[ln.spec].label}」收回后该户在户瓶数为负（现有 ${balance}），超收拒绝——整单未入账`);
    }
  }
  const record = {
    id: entry.id,
    dateISO: entry.dateISO,
    userId: entry.userId,
    lines: lines.map((ln) => ({ spec: ln.spec, full: ln.full, empty: ln.empty })),
    amountCents: entry.amountCents ?? null,
    note: String(entry.note ?? '').trim(),
  };
  state.deliveries.push(record);
  return record;
}

/** 在户瓶数 = Σ满瓶送出 − Σ空瓶收回（流水唯一派生） */
export function userBalance(state, userId, spec) {
  let balance = 0;
  for (const d of state.deliveries ?? []) {
    if (d.userId !== userId) continue;
    for (const ln of d.lines) {
      if (ln.spec === spec) balance += ln.full - ln.empty;
    }
  }
  return balance;
}

/**
 * 撤销配送单：直接移除流水；若撤销导致任一在户瓶数为负则拒绝
 * （必须先撤销更早的收回），账实始终一致。
 */
export function removeDelivery(state, deliveryId) {
  const idx = state.deliveries.findIndex((d) => d.id === deliveryId);
  if (idx < 0) throw new Error(`配送单不存在: ${deliveryId}`);
  const target = state.deliveries[idx];
  state.deliveries.splice(idx, 1);
  for (const ln of target.lines) {
    if (userBalance(state, target.userId, ln.spec) < 0) {
      state.deliveries.splice(idx, 0, target);
      throw new Error('撤销将导致该户在户瓶数为负——请先撤销更早的收回瓶，账实不能为负');
    }
  }
}

/** 守恒体检：Σ(送出−收回) 必须等于 Σ在户瓶数（残差恒 0，被手工改坏才会亮红） */
export function conservation(state) {
  let net = 0;
  for (const d of state.deliveries ?? []) {
    for (const ln of d.lines) net += ln.full - ln.empty;
  }
  let balances = 0;
  for (const u of state.users ?? []) {
    for (const spec of Object.keys(CYLINDER_SPECS)) balances += userBalance(state, u.id, spec);
  }
  return { fullOut: net, balances, residual: net - balances };
}

// ---------------------------------------------------------------------------
// 入户安检（责任账：隐患 → 整改 → 复访销案）
// ---------------------------------------------------------------------------

/** 引用某条隐患的复访是否存在（存在即该隐患已被复核/销案） */
function referencedIds(checks) {
  const s = new Set();
  for (const c of checks) if (c.recheckOf) s.add(c.recheckOf);
  return s;
}

/** 未闭环隐患：有隐患且尚无任何复访引用（复访仍有隐患的接棒，原单转已复核） */
export function openRisks(state) {
  const refs = referencedIds(state.checks ?? []);
  const userById = new Map(state.users.map((u) => [u.id, u]));
  return (state.checks ?? [])
    .filter((c) => c.verdict === 'risk' && !refs.has(c.id))
    .map((c) => ({ check: c, user: userById.get(c.userId) }))
    .sort((a, b) => a.check.dateISO.localeCompare(b.check.dateISO) || a.check.id.localeCompare(b.check.id));
}

/**
 * 入户安检落账。entry: { id, dateISO, userId, checker, items: {hose,valve,cylinder,stove,vent},
 *                          measure: { action, detail }, recheckOf, note }
 * - 五项逐项必检（ok/risk/na），缺项拒绝——"大概都看了"不是检查
 * - 至少一项为 ok/risk（全 na 拒绝）
 * - 有隐患必须登记整改措施，否则拒绝落账——"检了不处置"是事故后责任放大的根源
 * - recheckOf 复访引用：必须是同户、已存在、当前未闭环的隐患单，且复访日期不得早于原单；
 *   复访合格销案；复访仍有隐患则必须带整改措施、接棒成为新的未闭环
 */
export function recordCheck(state, entry) {
  const user = requireRef(state.users, entry.userId, '用户');
  assertISO(entry.dateISO);
  const items = entry.items ?? {};
  for (const k of Object.keys(CHECK_ITEMS)) {
    if (!(k in items)) throw new Error(`${CHECK_ITEMS[k].label}未检查——五项逐项必检`);
    if (!ITEM_VALUES.includes(items[k])) throw new Error(`「${CHECK_ITEMS[k].label}」取值非法: ${items[k]}`);
  }
  if (!Object.values(items).some((v) => v === 'ok' || v === 'risk')) {
    throw new Error('至少一项须为「正常」或「隐患」（全不适用拒绝落账）');
  }
  const riskItems = Object.keys(items).filter((k) => items[k] === 'risk');
  const verdict = riskItems.length ? 'risk' : 'ok';
  const measure = entry.measure ?? null;
  const action = String(measure?.action ?? '').trim();
  if (verdict === 'risk' && !action) {
    throw new Error(`「${user.name}」存在隐患（${riskItems.map((k) => CHECK_ITEMS[k].label).join('、')}）：必须登记整改措施后才能落账`);
  }
  const recheckOf = entry.recheckOf ?? null;
  if (recheckOf) {
    const target = (state.checks ?? []).find((c) => c.id === recheckOf);
    if (!target) throw new Error(`复访引用的安检单不存在: ${recheckOf}`);
    if (target.userId !== user.id) throw new Error('复访必须与原安检单同户');
    if (target.verdict !== 'risk') throw new Error('只有隐患单需要复访');
    if (entry.dateISO < target.dateISO) throw new Error(`复访日期（${entry.dateISO}）不得早于原隐患单（${target.dateISO}）`);
    if (referencedIds(state.checks ?? []).has(recheckOf)) throw new Error('该隐患单已被复访（销案或接棒），请在未闭环列表中选择最新一条');
  }
  const record = {
    id: entry.id,
    dateISO: entry.dateISO,
    userId: entry.userId,
    items: { ...items },
    riskItems,
    verdict,
    checker: String(entry.checker ?? '').trim(),
    note: String(entry.note ?? '').trim(),
    measure: verdict === 'risk' ? { action, detail: String(measure?.detail ?? '').trim() } : null,
    recheckOf: recheckOf ?? null,
  };
  state.checks.push(record);
  return record;
}

/** 撤销安检单：被复访引用的隐患单不可删（删除会凭空销案） */
export function removeCheck(state, checkId) {
  const idx = (state.checks ?? []).findIndex((c) => c.id === checkId);
  if (idx < 0) throw new Error(`安检单不存在: ${checkId}`);
  if (referencedIds(state.checks).has(checkId)) {
    throw new Error('该安检单已被复访引用，不可删除（删除会凭空销案）；可删除复访单后重试');
  }
  state.checks.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 周期台账：年度安检 / 钢瓶检验 / 员工证件
// ---------------------------------------------------------------------------

/**
 * 年度安检状态（按户）：距上次安检的天数 + 临期窗 →
 * { status: 'ok'|'due'|'overdue'|'none', lastISO, dueIn }
 */
export function annualStatus(state, todayISOStr, settings) {
  const params = paramsOf(settings);
  const userById = new Map(state.users.map((u) => [u.id, u]));
  const out = [];
  for (const user of state.users ?? []) {
    const rows = (state.checks ?? [])
      .filter((c) => c.userId === user.id)
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const last = rows[rows.length - 1] ?? null;
    if (!last) {
      out.push({ user, status: 'none', lastISO: null, dueIn: 0 });
      continue;
    }
    const daysSince = -daysUntil(last.dateISO, todayISOStr);
    const d = params.annualCheckDays - daysSince;
    out.push({
      user,
      status: d < 0 ? 'overdue' : d <= params.nearAnnualDays ? 'due' : 'ok',
      lastISO: last.dateISO,
      dueIn: d,
    });
  }
  return out.sort((a, b) => a.dueIn - b.dueIn);
}

/**
 * 钢瓶档案。entry: { id, code, spec, checkDueISO, note } —— 瓶号与检验到期日必填（照瓶身钢印抄）
 */
export function addCylinder(state, cyl) {
  const code = String(cyl.code ?? '').trim();
  if (!code) throw new Error('瓶号必填（照瓶身钢印抄）');
  if (!CYLINDER_SPECS[cyl.spec]) throw new Error(`未知瓶型: ${cyl.spec}`);
  assertISO(cyl.checkDueISO);
  const item = {
    id: cyl.id,
    code,
    spec: cyl.spec,
    checkDueISO: cyl.checkDueISO,
    note: String(cyl.note ?? '').trim(),
  };
  state.cylinders.push(item);
  return item;
}

export function removeCylinder(state, cylId) {
  const idx = (state.cylinders ?? []).findIndex((c) => c.id === cylId);
  if (idx < 0) throw new Error(`钢瓶不存在: ${cylId}`);
  state.cylinders.splice(idx, 1);
}

/** 钢瓶检验状态：过期红线（超期瓶流转即风险）+ 预警窗 */
export function cylinderStatus(state, todayISOStr, settings) {
  const params = paramsOf(settings);
  const overdue = [];
  const expiring = [];
  for (const c of state.cylinders ?? []) {
    const left = daysUntil(c.checkDueISO, todayISOStr);
    if (left < 0) overdue.push({ ...c, daysLeft: left });
    else if (left <= params.cylinderWarnDays) expiring.push({ ...c, daysLeft: left });
  }
  return { overdue, expiring };
}

// ---------------------------------------------------------------------------
// 员工证件台账
// ---------------------------------------------------------------------------

/** 员工建档。worker: { id, name, role, certExpiryISO } —— 送气工/安检员证件到期日必填 */
export function addWorker(state, worker) {
  const name = String(worker.name ?? '').trim();
  if (!name) throw new Error('员工姓名必填');
  assertISO(worker.certExpiryISO);
  const item = {
    id: worker.id,
    name,
    role: String(worker.role ?? '').trim(),
    certExpiryISO: worker.certExpiryISO,
  };
  state.workers.push(item);
  return item;
}

export function removeWorker(state, workerId) {
  const idx = (state.workers ?? []).findIndex((w) => w.id === workerId);
  if (idx < 0) throw new Error(`员工不存在: ${workerId}`);
  state.workers.splice(idx, 1);
}

/** 证件状态：过期红线 + 临期预警窗 */
export function certAudit(state, todayISOStr, settings) {
  const params = paramsOf(settings);
  const expired = [];
  const expiring = [];
  for (const w of state.workers ?? []) {
    const left = daysUntil(w.certExpiryISO, todayISOStr);
    if (left < 0) expired.push({ ...w, daysLeft: left });
    else if (left <= params.certWarnDays) expiring.push({ ...w, daysLeft: left });
  }
  return { expired, expiring };
}

// ---------------------------------------------------------------------------
// 台账体检（迎检自查：未闭环隐患 / 安检到期 / 瓶检证件 / 断更）
// ---------------------------------------------------------------------------

/**
 * 断更体检：自首条配送记录起（回看窗内）逐日核对，零配送日点名；今日不点名。
 * 返回 { checkedDays, missingDates }
 */
export function continuityAudit(state, todayISOStr, settings) {
  const params = paramsOf(settings);
  const dates = new Set((state.deliveries ?? []).map((d) => d.dateISO));
  const first = (state.deliveries ?? []).reduce((m, d) => (d.dateISO < m ? d.dateISO : m), '9999-12-31');
  if (first === '9999-12-31') return { checkedDays: 0, missingDates: [] };
  const start = first > addDays(todayISOStr, -(params.checkWindowDays - 1))
    ? first
    : addDays(todayISOStr, -(params.checkWindowDays - 1));
  const missingDates = [];
  let checkedDays = 0;
  for (let d = start; d < todayISOStr; d = addDays(d, 1)) {
    checkedDays += 1;
    if (!dates.has(d)) missingDates.push(d);
  }
  return { checkedDays, missingDates };
}

/**
 * 合规自查：迎检前先自扫一遍。
 * - openRisks：隐患未闭环（无复访销案）
 * - annualProblems：年度安检从未/逾期/临期
 * - cylinders：钢瓶检验过期与临期
 * - certs：员工证件过期与临期
 * - missingDates：断更日
 */
export function complianceAudit(state, todayISOStr) {
  assertISO(todayISOStr);
  const annual = annualStatus(state, todayISOStr, state.settings);
  return {
    openRisks: openRisks(state),
    annualProblems: annual.filter((x) => x.status !== 'ok'),
    cylinders: cylinderStatus(state, todayISOStr, state.settings),
    certs: certAudit(state, todayISOStr, state.settings),
    missingDates: continuityAudit(state, todayISOStr, state.settings).missingDates,
    continuity: continuityAudit(state, todayISOStr, state.settings),
    conservation: conservation(state),
  };
}

// ---------------------------------------------------------------------------
// 台账导出（告知单 / 台账文本 / 迎检打印包）
// ---------------------------------------------------------------------------

function itemsLine(check) {
  return Object.keys(CHECK_ITEMS)
    .map((k) => `${CHECK_ITEMS[k].label}${check.items[k] === 'risk' ? '⚠' : check.items[k] === 'na' ? '—' : '√'}`)
    .join(' ');
}

/**
 * 告知单/回执文本：隐患 → 【隐患告知单】（整改要求 + 复访约定）；合格 → 【入户安检回执】。
 * 微信发用户用，确定性输出。
 */
export function slipText({ state, checkId, todayISOStr = todayISO() }) {
  const check = requireRef(state.checks, checkId, '安检单');
  const user = requireRef(state.users, check.userId, '用户');
  const L = [];
  if (check.verdict === 'risk') {
    L.push(`【入户安检隐患告知单】用户：${user.name}`);
    L.push(`地址：${user.addr || '—'}（电话 ${user.phone || '—'}）`);
    L.push(`检查日：${check.dateISO} · 检查员：${check.checker || '—'}`);
    L.push('');
    L.push(`检查结果：${itemsLine(check)}`);
    L.push(`隐患项目：${check.riskItems.map((k) => CHECK_ITEMS[k].label).join('、')}`);
    L.push(`整改要求：${check.measure?.action ?? '—'}${check.measure?.detail ? `（${check.measure.detail}）` : ''}`);
    L.push('');
    L.push('请按上述要求尽快整改，本站将安排复访复查；逾期未整改的，本站将按规定停止供气并报告属地燃气管理部门。燃气安全，人人有责。');
  } else {
    L.push(`【入户安检回执】用户：${user.name}`);
    L.push(`地址：${user.addr || '—'}（电话 ${user.phone || '—'}）`);
    L.push(`检查日：${check.dateISO} · 检查员：${check.checker || '—'}`);
    L.push('');
    L.push(`检查结果：${itemsLine(check)}`);
    L.push('本次入户安检各项正常。软管请按期更换、保持通风、不用超期钢瓶——用气安全提醒，请放心使用。');
  }
  L.push('');
  L.push(`站点：${state.station?.name ?? ''}${state.station?.licenseNo ? `（燃气经营许可证号 ${state.station.licenseNo}）` : ''}`);
  L.push(`生成：瓶安单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 安检台账文本（最近 limit 条，微信转发用，确定性输出） */
export function checkLedgerText({ state, todayISOStr = todayISO(), limit = 40 }) {
  const userById = new Map(state.users.map((u) => [u.id, u]));
  const rows = [...(state.checks ?? [])]
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id));
  const L = [];
  L.push(`【入户安检台账】${state.station?.name ?? ''}${state.station?.licenseNo ? `（燃气经营许可证号 ${state.station.licenseNo}）` : ''}`);
  L.push(`截至 ${todayISOStr}（隐患须整改并复访销案；依条例定期安检义务整理）`);
  L.push('');
  if (!rows.length) {
    L.push('（暂无安检记录）');
  } else {
    rows.slice(0, limit).forEach((c) => {
      const user = userById.get(c.userId);
      const flag = c.verdict === 'ok' ? '正常' : '隐患';
      const rechecked = c.recheckOf ? '（复访）' : '';
      L.push(`- ${c.dateISO} ${user?.name ?? '?'}：${c.riskItems.length ? `隐患 ${c.riskItems.map((k) => CHECK_ITEMS[k].label).join('、')}` : '各项正常'} → ${flag}${rechecked}${c.measure ? `｜整改：${c.measure.action}` : ''}（${c.checker || '—'}）`);
    });
    if (rows.length > limit) L.push(`……更早 ${rows.length - limit} 条见打印版台账`);
  }
  L.push('');
  L.push(`生成：瓶安单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 配送台账文本（最近 limit 条，含在户瓶数守恒口径） */
export function deliveryLedgerText({ state, todayISOStr = todayISO(), limit = 40 }) {
  const userById = new Map(state.users.map((u) => [u.id, u]));
  const rows = [...(state.deliveries ?? [])]
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id));
  const L = [];
  L.push(`【配送台账】${state.station?.name ?? ''}${state.station?.licenseNo ? `（燃气经营许可证号 ${state.station.licenseNo}）` : ''}`);
  L.push(`截至 ${todayISOStr}（在户瓶数 = 送出 − 收回，守恒派生）`);
  L.push('');
  if (!rows.length) {
    L.push('（暂无配送记录）');
  } else {
    rows.slice(0, limit).forEach((d) => {
      const user = userById.get(d.userId);
      const lines = d.lines.map((ln) => `${CYLINDER_SPECS[ln.spec].label} 送${ln.full}/收${ln.empty}`).join('，');
      L.push(`- ${d.dateISO} ${user?.name ?? '?'}：${lines}${d.amountCents !== null ? `｜${fmtYuan(d.amountCents)}` : ''}`);
    });
    if (rows.length > limit) L.push(`……更早 ${rows.length - limit} 条见打印版台账`);
  }
  L.push('');
  L.push(`生成：瓶安单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 告知单：单文件 HTML（签字栏 + 站点落款，张贴/留存两用），无外部资源 */
export function slipHtml({ state, checkId, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const check = requireRef(state.checks, checkId, '安检单');
  const user = requireRef(state.users, check.userId, '用户');
  const isRisk = check.verdict === 'risk';
  const itemRows = Object.keys(CHECK_ITEMS).map((k) => {
    const v = check.items[k];
    const mark = v === 'risk' ? '<span class="flag">隐患</span>' : v === 'na' ? '不适用' : '<span class="ok">正常</span>';
    return `<tr><td>${e(CHECK_ITEMS[k].label)}</td><td>${e(CHECK_ITEMS[k].hint)}</td><td>${mark}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${isRisk ? '入户安检隐患告知单' : '入户安检回执'} · ${e(user.name)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 28px; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  .meta { font-size: 14px; color: #444; margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; margin-top: 14px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1.5px solid #ccc; }
  th { font-size: 13px; color: #555; }
  .ok { color: #15803d; font-weight: 600; }
  .flag { color: #b91c1c; font-weight: 700; }
  .action { margin-top: 14px; font-size: 15px; line-height: 1.8; }
  .action strong { color: #b91c1c; }
  .sign { margin-top: 34px; font-size: 15px; color: #333; }
  .sign span { display: inline-block; width: 200px; border-bottom: 1px solid #555; margin: 0 8px; }
  .foot { margin-top: 26px; font-size: 12px; color: #666; line-height: 1.7; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>${isRisk ? '入户安检隐患告知单' : '入户安检回执'}</h1>
<div class="meta">用户：${e(user.name)} · 地址：${e(user.addr || '—')} · 电话：${e(user.phone || '—')}</div>
<div class="meta">检查日：${e(check.dateISO)} · 检查员：${e(check.checker || '—')}</div>
<table>
<tr><th>检查项</th><th>常见隐患</th><th>结果</th></tr>
${itemRows}
</table>
${isRisk ? `<div class="action">隐患项目：<strong>${e(check.riskItems.map((k) => CHECK_ITEMS[k].label).join('、'))}</strong><br/>
整改要求：<strong>${e(check.measure?.action ?? '—')}</strong>${check.measure?.detail ? `（${e(check.measure.detail)}）` : ''}<br/>
本站将安排复访复查；逾期未整改的，本站将按规定停止供气并报告属地燃气管理部门。</div>`
  : '<div class="action">本次入户安检各项正常。请按期更换软管、保持通风、不使用超期钢瓶——用气安全提醒，请放心使用。</div>'}
<div class="sign">用户确认（签收）：${isRisk ? '<span></span>' : '<span></span>'} 日期：<span></span></div>
<div class="foot">站点：${e(state.station?.name ?? '')}${state.station?.licenseNo ? ` · 燃气经营许可证号 ${e(state.station.licenseNo)}` : ''}<br/>
依《城镇燃气管理条例》定期安全检查义务出具；本单为安检记录与整改提醒凭据，整改以属地要求为准。<br/>生成：瓶安单 BottleSafe · ${e(todayISOStr)}</div>
</body>
</html>`;
}

/** 迎检打印包：单文件 HTML（站点 + 守恒体检 + 配送/安检台账 + 到期点名 + 证件），无外部资源 */
export function inspectionHtml({ state, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const userById = new Map(state.users.map((u) => [u.id, u]));
  const checks = [...(state.checks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id));
  const deliveries = [...(state.deliveries ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const audit = complianceAudit(state, todayISOStr);
  const annual = annualStatus(state, todayISOStr, state.settings);
  const cons = audit.conservation;
  const checkRows = checks.slice(0, 200).map((c) => {
    const user = userById.get(c.userId);
    const ok = c.verdict === 'ok';
    return `<tr>
      <td>${e(c.dateISO)}</td><td>${e(user?.name ?? '?')}</td>
      <td>${e(c.riskItems.length ? c.riskItems.map((k) => CHECK_ITEMS[k].label).join('、') : '各项正常')}</td>
      <td class="${ok ? 'ok' : 'flag'}">${ok ? '正常' : `隐患${c.measure ? ` · 整改：${e(c.measure.action)}` : ''}`}</td>
      <td>${c.recheckOf ? '复访' : '—'}</td>
      <td>${e(c.checker || '—')}</td>
    </tr>`;
  }).join('');
  const deliveryRows = deliveries.slice(0, 120).map((d) => `<tr>
    <td>${e(d.dateISO)}</td><td>${e(userById.get(d.userId)?.name ?? '?')}</td>
    <td>${e(d.lines.map((ln) => `${CYLINDER_SPECS[ln.spec].label} 送${ln.full}/收${ln.empty}`).join('，'))}</td>
    <td>${d.amountCents !== null ? e(fmtYuan(d.amountCents)) : '—'}</td>
  </tr>`).join('');
  const annualRows = annual.filter((x) => x.status !== 'ok').map((x) => `<tr>
    <td>${e(x.user.name)}</td><td>${x.status === 'none' ? '从未安检' : x.status === 'overdue' ? `<span class="flag">已逾期 ${-x.dueIn} 天</span>` : `<span class="flag">临期 ${x.dueIn} 天</span>`}</td>
    <td>${e(x.lastISO ?? '—')}</td>
  </tr>`).join('');
  const cylRows = (state.cylinders ?? []).map((c) => {
    const left = daysUntil(c.checkDueISO, todayISOStr);
    return `<tr><td>${e(c.code)}</td><td>${e(CYLINDER_SPECS[c.spec].label)}</td><td>${e(c.checkDueISO)}</td>
      <td>${left < 0 ? '<span class="flag">已超期</span>' : left <= 90 ? '<span class="flag">临期</span>' : '<span class="ok">有效</span>'}</td></tr>`;
  }).join('');
  const workerRows = (state.workers ?? []).map((w) => {
    const left = daysUntil(w.certExpiryISO, todayISOStr);
    return `<tr><td>${e(w.name)}</td><td>${e(w.role || '—')}</td><td>${e(w.certExpiryISO)}</td>
      <td>${left < 0 ? '<span class="flag">已过期</span>' : left <= 30 ? '<span class="flag">临期</span>' : '<span class="ok">有效</span>'}</td></tr>`;
  }).join('');
  const auditLine = `体检：未闭环隐患 <strong>${audit.openRisks.length}</strong> · 年度安检问题户 <strong>${audit.annualProblems.length}</strong>／${(state.users ?? []).length} 户 · 钢瓶超期 <strong>${audit.cylinders.overdue.length}</strong>／临期 <strong>${audit.cylinders.expiring.length}</strong> · 证件过期 <strong>${audit.certs.expired.length}</strong> · 断更 <strong>${audit.missingDates.length}</strong> 天（回看 ${audit.continuity.checkedDays} 天） · 守恒残差 <strong>${cons.residual}</strong>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>配送安检台账迎检包 · ${e(state.station?.name ?? '')}</title>
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
<h1>配送安检台账迎检包 · ${e(state.station?.name ?? '')}</h1>
<div class="meta">燃气经营许可证号：${e(state.station?.licenseNo ?? '未填写')} · 联系电话：${e(state.station?.phone ?? '')} · 截至 ${e(todayISOStr)}</div>
<div class="meta">${auditLine}</div>

<h2>一、入户安检台账（隐患须整改并复访销案；条例定期安检义务口径）</h2>
<table><tr><th>日期</th><th>用户</th><th>检查结论</th><th>状态</th><th>复访</th><th>检查员</th></tr>
${checkRows || '<tr><td colspan="6">（暂无安检记录）</td></tr>'}
</table>

<h2>二、配送台账（在户瓶数 = 送出 − 收回，守恒派生）</h2>
<div class="meta">守恒体检：净送出 ${cons.fullOut} 瓶 ＝ 在户瓶数合计 ${cons.balances} 瓶${cons.residual === 0 ? '<span class="ok">（账实一致）</span>' : `<span class="flag">（残差 ${cons.residual}，请核查）</span>`}</div>
<table><tr><th>日期</th><th>用户</th><th>明细</th><th>金额</th></tr>
${deliveryRows || '<tr><td colspan="4">（暂无配送记录）</td></tr>'}
</table>

<h2>三、年度安检到期点名（周期 ${paramsOf(state.settings).annualCheckDays} 天，通识口径可调）</h2>
<table><tr><th>用户</th><th>状态</th><th>上次安检</th></tr>
${annualRows || '<tr><td colspan="3">（全部在期内）</td></tr>'}
</table>

<h2>四、钢瓶检验台账（周期 ${paramsOf(state.settings).cylinderCycleMonths} 个月，通识口径可调）</h2>
<table><tr><th>瓶号</th><th>瓶型</th><th>检验到期日</th><th>状态</th></tr>
${cylRows || '<tr><td colspan="4">（暂无钢瓶档案）</td></tr>'}
</table>

<h2>五、从业人员证件</h2>
<table><tr><th>姓名</th><th>岗位</th><th>证件到期日</th><th>状态</th></tr>
${workerRows || '<tr><td colspan="4">（暂无员工档案）</td></tr>'}
</table>

<div class="foot">生成：瓶安单 BottleSafe · ${e(todayISOStr)} · 台账为网点自查与迎检备查底账，安检与配送记录照实际如实录入；本包不替代充装追溯、政府数据报送、法定安检义务与公证存证，安检频次与整改要求以条例原文及属地燃气管理部门要求为准。</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 交接即盘点）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'bottlesafe', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'bottlesafe') return { ok: false, error: '不是瓶安单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.station === 'object' && s.station !== null &&
    arr(s.users) && arr(s.cylinders) && arr(s.workers) &&
    arr(s.deliveries) && arr(s.checks) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
