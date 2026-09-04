/**
 * core.js — 翻房单 TurnSheet 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；金额一律整数「分」运算，杜绝浮点误差；
 * 时间窗计算统一折算为分钟；洗涤寿命为行业通识先验，永远可被用户参数覆盖。
 *
 * 卫生与合规口径（全文链接见 docs/14-调研来源.md）：
 * - GB 9663-1996《旅店业卫生标准》：床单/枕套/被套等布草「一客一换」，长住客一周一换
 * - GB/T 41648-2022《旅游民宿基本要求与等级划分》：卫生和服务、公共用品用具要求
 * - 《公共场所卫生管理条例》及实施细则：公共用品用具未按规定清洗消毒保洁，警告或罚款，
 *   情节严重可责令停业整顿（罚则区间与适用以属地现行文本为准）
 * 本工具记录「谁该在什么时候完成什么」，不构成卫生学或法律意见。
 */

// ---------------------------------------------------------------------------
// 日期与时间工具（ISO 字符串 yyyy-mm-dd 为唯一日期表示；时刻 HH:MM 为唯一时刻表示）
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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

/** 校验 HH:MM 时刻，非法则抛错 */
export function assertHM(hm) {
  if (typeof hm !== 'string' || !HM_RE.test(hm)) {
    throw new Error(`非法时刻: ${JSON.stringify(hm)}`);
  }
  return hm;
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

function hmToMin(hm) {
  assertHM(hm);
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/** 两个「日期+时刻」之间的分钟差（B − A，可为负） */
export function diffMinutes(aDate, aHm, bDate, bHm) {
  assertISO(aDate); assertISO(bDate);
  const dayA = Math.round(new Date(`${aDate}T00:00:00Z`).getTime() / 86400000);
  const dayB = Math.round(new Date(`${bDate}T00:00:00Z`).getTime() / 86400000);
  return (dayB - dayA) * 1440 + (hmToMin(bHm) - hmToMin(aHm));
}

/** 分钟数 → 「X 小时 Y 分」人话（负数带「差」字样，仅供展示） */
export function minutesLabel(mins) {
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(Math.round(mins));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h && m) return `${sign}${h} 小时 ${m} 分`;
  if (h) return `${sign}${h} 小时`;
  return `${sign}${m} 分钟`;
}

/** 金额：整数分 → 「¥129.00」 */
export function fmtYuan(cents) {
  if (!Number.isInteger(cents)) throw new Error(`金额必须为整数分: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// 档案模板（内容供应链：OTA 平台、布草类型与洗涤寿命先验）
// ---------------------------------------------------------------------------

export const PLATFORMS = {
  airbnb: { label: 'Airbnb / 爱彼迎' },
  meituan: { label: '美团民宿' },
  ctrip: { label: '携程 / Trip.com' },
  qunar: { label: '去哪儿 / 途家' },
  direct: { label: '直客 / 复购 / 转介绍' },
  other: { label: '其他' },
};

/**
 * 布草类型。ratedWashes 为行业通识先验（全棉酒店布草常见 130~150 次洗涤寿命），
 * 只是默认参数不是真理——用户可在设置中覆盖，洗涤厂说的永远赢。
 */
export const LINEN_TYPES = {
  bed: { label: '床品套件', ratedWashes: 130 },
  towel: { label: '巾类（浴巾/毛巾）', ratedWashes: 150 },
};

/** 布草状态机：legal[from] = 允许迁往的状态集合（retired 为终态） */
export const LINEN_STATUS = {
  room: { label: '在房（铺在房间）' },
  dirty: { label: '脏布（待洗）' },
  transit: { label: '在途（送洗中）' },
  clean: { label: '净布（在库可用）' },
  retired: { label: '已报废' },
};
const LEGAL_TRANSITIONS = {
  room: ['dirty', 'retired'],
  dirty: ['transit', 'clean', 'retired'], // dirty→clean = 自洗回库（乡村民宿常见）
  transit: ['clean', 'retired'],
  clean: ['room', 'retired'],
  retired: [],
};

/** 洗涤厂送洗 SLA（天）。超时亮灯：催厂或认损——布草在途无人跟踪是缺套的第一原因 */
export const DEFAULT_WASH_SLA_DAYS = 3;
/** 布草报废预算展望期（天） */
export const REPLACEMENT_HORIZON_DAYS = 90;

// ---------------------------------------------------------------------------
// 房期与翻房任务派生（两次入住之间的执行黑箱，在这里变成白箱）
// ---------------------------------------------------------------------------

function validateStay(stay, propsById) {
  if (!stay?.id || !stay?.propId) throw new Error('房期缺少 id 或房源');
  if (!propsById.get(stay.propId)) throw new Error(`房期引用了不存在的房源: ${stay.propId}`);
  assertISO(stay.checkin); assertISO(stay.checkout);
  if (stay.checkout < stay.checkin) throw new Error(`房期退房日早于入住日: ${stay.id}`);
  assertHM(stay.checkinTime ?? '14:00');
  assertHM(stay.checkoutTime ?? '12:00');
}

/**
 * 从房期派生翻房任务（不落库，确定性派生）。
 * 每个退房生成一条翻房：窗口 = 本次退房 → 同房源下一次入住。
 * - 窗口 < 0：接了重叠订单（conflict，最高优先级红灯）
 * - 窗口 < cleanMinutes：翻不过来（red）
 * - 窗口 < 1.5 × cleanMinutes：贴线（yellow）
 * - 无后续入住：open（仍需翻房，但无硬时限）
 */
export function turnoversOf(stays, properties) {
  const propsById = new Map(properties.map((p) => [p.id, p]));
  stays.forEach((s) => validateStay(s, propsById));

  const out = [];
  for (const prop of properties) {
    const mine = stays
      .filter((s) => s.propId === prop.id)
      .sort((a, b) =>
        (a.checkin + (a.checkinTime ?? '14:00')).localeCompare(b.checkin + (b.checkinTime ?? '14:00')));
    for (const s of mine) {
      const startDt = `${s.checkin} ${s.checkinTime ?? '14:00'}`;
      // 下一客 = 晚于本单入住、且入住最早的订单。
      // 若其入住早于本单退房（订单重叠），窗口为负 → conflict，这正是要亮红灯的场景。
      let next = null;
      for (const t of mine) {
        if (t.id === s.id) continue;
        const tStart = `${t.checkin} ${t.checkinTime ?? '14:00'}`;
        if (tStart > startDt && (!next || tStart < `${next.checkin} ${next.checkinTime ?? '14:00'}`)) next = t;
      }
      const cleanMinutes = prop.cleanMinutes ?? 90;
      let windowMinutes = null;
      let level = 'open';
      if (next) {
        windowMinutes = diffMinutes(
          s.checkout, s.checkoutTime ?? '12:00',
          next.checkin, next.checkinTime ?? '14:00',
        );
        level = windowMinutes < 0 ? 'conflict'
          : windowMinutes < cleanMinutes ? 'red'
          : windowMinutes < cleanMinutes * 1.5 ? 'yellow'
          : 'green';
      }
      out.push({
        key: `${s.checkout}|${s.propId}|${s.id}`,
        propId: prop.id,
        propName: prop.name,
        lockNote: prop.lockNote ?? '',
        checkoutISO: s.checkout,
        checkoutTime: s.checkoutTime ?? '12:00',
        checkinISO: next?.checkin ?? null,
        checkinTime: next?.checkinTime ?? null,
        guestOut: s.guest ?? '',
        guestIn: next?.guest ?? '',
        platform: PLATFORMS[s.platform]?.label ?? PLATFORMS.other.label,
        cleanMinutes,
        windowMinutes,
        level,
      });
    }
  }
  return out.sort((a, b) =>
    (a.checkoutISO + a.checkoutTime).localeCompare(b.checkoutISO + b.checkoutTime));
}

const LEVEL_RANK = { conflict: 0, red: 1, yellow: 2, green: 3, open: 4 };
export const LEVEL_LABEL = {
  conflict: '⚠ 订单重叠', red: '● 窗口不足', yellow: '◐ 贴线', green: '○ 充裕', open: '－ 无硬时限',
};

/** 翻房任务清单模板：布草/耗品行由档案与账本实时生成（见 taskExtras） */
export const BASE_TASKS = [
  { id: 'found', name: '退房查遗留', hint: '充电器 · 证件 · 抽屉 · 床底 · 浴室' },
  { id: 'strip', name: '撤下脏布草', hint: '入脏布袋，勿与净布混放（交叉污染是卫生投诉重灾区）' },
  { id: 'clean', name: '清洁', hint: '卫生间 · 台面 · 地面 · 镜面 · 垃圾清运' },
  { id: 'make', name: '铺新布草', hint: '一客一换（GB 9663-1996），从净布柜取用' },
  { id: 'supply', name: '补充耗品', hint: '卷纸 · 瓶装水 · 洗漱包 · 一次性拖鞋' },
  { id: 'photo', name: '完成拍照回传', hint: '留档：卫生差评申诉与免责的第一证据' },
];

/** 翻房单里的动态提示行：布草缺口与在途催洗（账本 → 任务单的回灌） */
export function taskExtras({ prop, linenByType, transitOverdue }) {
  const extras = [];
  if (linenByType?.bed?.shortfall > 0) {
    extras.push(`⚠ 床品净布缺 ${linenByType.bed.shortfall} 套：净布 ${linenByType.bed.clean} / 需 ${linenByType.bed.need}，先催在途或动备用`);
  }
  if (linenByType?.towel?.shortfall > 0) {
    extras.push(`⚠ 巾类净布缺 ${linenByType.towel.shortfall} 条：净布 ${linenByType.towel.clean} / 需 ${linenByType.towel.need}`);
  }
  if (transitOverdue > 0) {
    extras.push(`⚠ 有 ${transitOverdue} 套布草在途超过 SLA：催洗涤厂，超时可主张赔付`);
  }
  if (prop?.lockNote) extras.push(`门锁/取钥：${prop.lockNote}`);
  return extras;
}

/** 翻房完成状态：tasks 全勾 + 记录完成时间。turnoverLogs: { [key]: { tasks, found, doneAt } } */
export function turnoverStatus(key, logs, baseCount = BASE_TASKS.length) {
  const log = logs?.[key];
  const doneIds = Object.entries(log?.tasks ?? {}).filter(([, v]) => v).map(([id]) => id);
  return {
    done: doneIds.length,
    total: baseCount,
    allDone: doneIds.length >= baseCount,
    found: log?.found ?? '',
    doneAt: log?.doneAt ?? null,
    started: doneIds.length > 0,
  };
}

// ---------------------------------------------------------------------------
// 布草周转账（撤 → 洗 → 回 → 铺 的闭环账本；egrity 恒等式钉住总量）
// ---------------------------------------------------------------------------

export function linenStatusCounts(sets) {
  const counts = { room: 0, dirty: 0, transit: 0, clean: 0, retired: 0 };
  for (const s of sets ?? []) {
    if (!(s.status in counts)) throw new Error(`布草状态非法: ${s.status}`);
    counts[s.status] += 1;
  }
  return counts;
}

/** 总量守恒：在房 + 脏 + 在途 + 净 + 报废 = 总套数。账本腐败立即抛错 */
export function assertLinenIntegrity(sets) {
  const c = linenStatusCounts(sets);
  const total = (sets ?? []).length;
  if (c.room + c.dirty + c.transit + c.clean + c.retired !== total) {
    throw new Error('布草账本总量守恒被破坏');
  }
  return c;
}

/**
 * 批量布草事件。type:
 * - deploy 净布铺入房间（clean→room，需 propId）
 * - strip  撤下脏布（room→dirty，需 propId 校验在房位置）
 * - send   脏布送洗（dirty→transit，记 sentAt）
 * - recv   洗毕回库（transit→clean，washes+1）
 * - selfwash 自洗回库（dirty→clean，washes+1）
 * - retire 报废（非 retired 任意→retired）
 * - buy    新购入库（创建新套，status=clean）
 * 任一套位置不满足前置状态即整体抛错（绝不部分入账）。
 */
export function applyLinenEvent(sets, { type, setIds, propId, dateISO, note = '' }) {
  assertISO(dateISO);
  const byId = new Map(sets.map((s) => [s.id, s]));
  const targets = setIds.map((id) => {
    const s = byId.get(id);
    if (!s) throw new Error(`布草不存在: ${id}`);
    return s;
  });

  if (type === 'buy') {
    throw new Error('buy 事件由 addLinenSets 处理，不走事件流');
  }
  const FROM = {
    deploy: 'clean', strip: 'room', send: 'dirty', recv: 'transit', selfwash: 'dirty', retire: null,
  };
  const TO = { deploy: 'room', strip: 'dirty', send: 'transit', recv: 'clean', selfwash: 'clean', retire: 'retired' };
  const from = FROM[type];
  if (!from && type !== 'retire') throw new Error(`未知布草事件: ${type}`);

  for (const s of targets) {
    if (s.status === 'retired') throw new Error(`${s.label} 已报废，不能变动`);
    if (from && s.status !== from) {
      throw new Error(`${s.label} 当前为「${LINEN_STATUS[s.status].label}」，${type} 要求「${LINEN_STATUS[from].label}」`);
    }
    if (!LEGAL_TRANSITIONS[s.status].includes(TO[type])) {
      throw new Error(`${s.label} 不允许 ${s.status} → ${TO[type]}`);
    }
    if (type === 'strip' && propId && s.inProp !== propId) {
      throw new Error(`${s.label} 不在房源 ${propId}，无法撤下`);
    }
  }
  for (const s of targets) {
    s.status = TO[type];
    if (type === 'deploy') s.inProp = propId ?? null;
    if (type === 'strip') s.inProp = null;
    if (type === 'send') s.sentAt = dateISO;
    if (type === 'recv' || type === 'selfwash') {
      s.washes = (s.washes ?? 0) + 1;
      s.sentAt = null;
    }
  }
  return { type, setIds, dateISO, note };
}

/** 新购入库：一次创建 n 套，status=clean，返回创建的套 */
export function addLinenSets(sets, { type, count, priceCents, boughtISO, startNo }) {
  const lt = LINEN_TYPES[type];
  if (!lt) throw new Error(`未知布草类型: ${type}`);
  if (!Number.isInteger(count) || count < 1 || count > 99) throw new Error(`数量非法: ${count}`);
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new Error(`单价非法: ${priceCents}`);
  assertISO(boughtISO);
  const created = [];
  for (let i = 0; i < count; i += 1) {
    const no = (startNo ?? 1) + i;
    created.push({
      id: `ln-${type}-${String(no).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6)}`,
      type, label: `${type === 'bed' ? '床品' : '巾类'}-${String(no).padStart(2, '0')}`,
      status: 'clean', inProp: null, sentAt: null,
      washes: 0, priceCents, boughtISO, retiredAt: null,
    });
  }
  sets.push(...created);
  return created;
}

/** 在途超时：按 sentAt 分组，超过 SLA 的组亮灯（催厂/认损） */
export function transitOverdue(sets, todayISOStr = todayISO(), slaDays = DEFAULT_WASH_SLA_DAYS) {
  const groups = new Map();
  for (const s of sets ?? []) {
    if (s.status !== 'transit' || !s.sentAt) continue;
    if (!groups.has(s.sentAt)) groups.set(s.sentAt, []);
    groups.get(s.sentAt).push(s);
  }
  const out = [];
  for (const [sentAt, list] of groups) {
    const days = Math.round((new Date(`${todayISOStr}T00:00:00Z`) - new Date(`${sentAt}T00:00:00Z`)) / 86400000);
    if (days > slaDays) {
      out.push({ sentAt, days, sets: list, overdueBy: days - slaDays });
    }
  }
  return out.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

/** 某房源某日接客所需的布草缺口（净布口径：只有 clean 能铺床） */
export function coverageFor(prop, sets) {
  const need = { bed: Math.max(1, prop.beds ?? 1), towel: Math.max(1, prop.towels ?? 2) };
  const out = {};
  for (const [type, req] of Object.entries(need)) {
    const pool = (sets ?? []).filter((s) => s.type === type && s.status !== 'retired');
    const clean = pool.filter((s) => s.status === 'clean').length;
    const transit = pool.filter((s) => s.status === 'transit').length;
    out[type] = { need: req, clean, transit, shortfall: Math.max(0, req - clean) };
  }
  return out;
}

/** 未来 N 天每房源到客日的布草缺口清单（按日期升序，缺口 >0 才出现） */
export function coverageWarnings({ properties, sets, stays, fromISO, days = 7 }) {
  const dates = Array.from({ length: days }, (_, i) => addDays(fromISO, i));
  const warnings = [];
  for (const date of dates) {
    for (const prop of properties ?? []) {
      const arrives = (stays ?? []).some((s) => s.propId === prop.id && s.checkin === date);
      if (!arrives) continue;
      const byType = coverageFor(prop, sets);
      const short = Object.entries(byType).filter(([, v]) => v.shortfall > 0);
      if (short.length > 0) {
        warnings.push({ date, propId: prop.id, propName: prop.name, byType: Object.fromEntries(short) });
      }
    }
  }
  return warnings;
}

/**
 * 布草经济账：
 * - costPerWash：单套每次洗涤成本 = 购价 ÷ 额定洗涤次数（整数分四舍五入）
 * - monthlyWashes：近窗口内的回洗总套次（recv+selfwash 事件）折算月均
 * - expiring：展望期内将耗尽寿命的套数与重购预算
 * monthlyWashes 不足一个月样本时返回 null（不编造节奏）。
 */
export function linenEconomics({ sets, events, todayISOStr = todayISO(), washWindowDays = 90, horizonDays = REPLACEMENT_HORIZON_DAYS, ratedOverrides = {} }) {
  assertISO(todayISOStr);
  const ratedOf = (type) => {
    const v = ratedOverrides[type] ?? LINEN_TYPES[type].ratedWashes;
    if (!Number.isInteger(v) || v < 1) throw new Error(`额定洗涤次数非法: ${type}=${v}`);
    return v;
  };
  const active = (sets ?? []).filter((s) => s.status !== 'retired');
  const types = {};
  for (const type of Object.keys(LINEN_TYPES)) {
    const pool = active.filter((s) => s.type === type);
    if (pool.length === 0) { types[type] = null; continue; }
    const rated = ratedOf(type);
    types[type] = {
      count: pool.length,
      costPerWash: Math.round((pool[0].priceCents ?? 0) / rated),
      ratedWashes: rated,
      minRemaining: Math.min(...pool.map((s) => rated - (s.washes ?? 0))),
    };
  }
  // 月均洗涤节奏：窗口内 recv+selfwash 的套次总和折算到 30 天；样本 <4 套次时拒绝判断
  const from = addDays(todayISOStr, -washWindowDays);
  let washCount = 0;
  for (const ev of events ?? []) {
    if ((ev.type === 'recv' || ev.type === 'selfwash') && ev.dateISO >= from && ev.dateISO <= todayISOStr) {
      washCount += (ev.setIds ?? []).length;
    }
  }
  const monthlyWashes = washCount >= 4
    ? Math.round(((washCount * 30) / washWindowDays) * 10) / 10
    : null;
  // 重购预算：期望洗涤均摊到每套（展望期机队总洗涤 ÷ 活跃套数），
  // 寿命 ≤ 预期消耗的套进入重购清单；无节奏数据时 expiring=null（不编造）
  for (const [type, e] of Object.entries(types)) {
    if (!e) continue;
    const pool = active.filter((s) => s.type === type);
    const needBy = monthlyWashes
      ? Math.ceil(((horizonDays / 30) * monthlyWashes) / Math.max(1, active.length))
      : null;
    const rated = types[type].ratedWashes;
    const expiring = needBy === null
      ? null
      : pool.filter((s) => rated - (s.washes ?? 0) <= needBy).length;
    types[type] = { ...e, expiring, replacementCents: expiring === null ? null : expiring * (pool[0]?.priceCents ?? 0) };
  }
  return { monthlyWashes, washCount, types };
}

// ---------------------------------------------------------------------------
// 耗品低库存
// ---------------------------------------------------------------------------

export function suppliesLow(supplies) {
  return (supplies ?? [])
    .filter((s) => Number.isInteger(s.minStock) && s.stock <= s.minStock)
    .sort((a, b) => (a.stock - a.minStock) - (b.stock - b.minStock));
}

// ---------------------------------------------------------------------------
// 今日看板聚合
// ---------------------------------------------------------------------------

/** 订单重叠检测：同房源两单的 [入住, 退房) 区间相交 */
export function stayConflicts(stays) {
  const conflicts = [];
  const byProp = new Map();
  for (const s of stays ?? []) {
    if (!byProp.has(s.propId)) byProp.set(s.propId, []);
    byProp.get(s.propId).push(s);
  }
  for (const [, list] of byProp) {
    const sorted = [...list].sort((a, b) => a.checkin.localeCompare(b.checkin));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]; const b = sorted[j];
        if (b.checkin < a.checkout) {
          conflicts.push({ aId: a.id, bId: b.id, propId: a.propId });
        }
      }
    }
  }
  return conflicts;
}

/**
 * 今日待办聚合：今日退房 / 今日到客 / 未来 3 天翻房窗口 / 布草缺口 / 在途超时 / 耗品低库存 / 订单重叠。
 * 全部由派生函数组装，UI 不做二次计算。
 */
export function todayBoard({ todayISOStr, stays, properties, sets, supplies, logs, slaDays = DEFAULT_WASH_SLA_DAYS }) {
  const propsById = new Map(properties.map((p) => [p.id, p]));
  const turnovers = turnoversOf(stays, properties);
  const window3 = addDays(todayISOStr, 3);
  const upcoming = turnovers
    .filter((t) => t.checkoutISO >= addDays(todayISOStr, -1) && t.checkoutISO <= window3)
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
      || (a.checkoutISO + a.checkoutTime).localeCompare(b.checkoutISO + b.checkoutTime));
  return {
    checkoutsToday: turnovers.filter((t) => t.checkoutISO === todayISOStr),
    checkinsToday: (stays ?? []).filter((s) => s.checkin === todayISOStr)
      .map((s) => ({ ...s, propName: propsById.get(s.propId)?.name ?? '' })),
    upcoming,
    linenShortages: coverageWarnings({ properties, sets, stays, fromISO: todayISOStr, days: 3 }),
    transitOverdue: transitOverdue(sets, todayISOStr, slaDays),
    suppliesLow: suppliesLow(supplies),
    conflicts: stayConflicts(stays),
    turnovers,
    linenCounts: assertLinenIntegrity(sets),
  };
}

// ---------------------------------------------------------------------------
// 翻房任务单导出（文本通道 → 微信发保洁；HTML 通道 → 打印/图片留存）
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 给保洁的翻房任务单：确定性文本。同输入同输出，供复制与快照比对 */
export function runSheetText({ turnovers, dateISO, extrasByProp = {}, hostName = '', todayISOStr = todayISO() }) {
  if (!Array.isArray(turnovers) || turnovers.length === 0) {
    throw new Error(`没有 ${dateISO} 的翻房任务`);
  }
  const L = [];
  L.push(`【翻房任务单】${dateISO}`);
  if (hostName) L.push(`房东/主理人：${hostName}`);
  L.push('');
  turnovers.forEach((t, i) => {
    const win = t.windowMinutes === null
      ? '（今日无后续入住，按标准流程完成）'
      : `退房 ${t.checkoutTime} → 入住 ${t.checkinTime}（窗口 ${minutesLabel(t.windowMinutes)}，标准保洁 ${minutesLabel(t.cleanMinutes)}）`;
    L.push(`■ ${i + 1}. ${t.propName}（${t.checkoutISO}）`);
    L.push(`   ${win}${t.level === 'red' || t.level === 'conflict' ? ' ⚠ 窗口紧张，请优先安排！' : ''}`);
    L.push(`   退住房客：${t.guestOut || '—'}${t.guestIn ? `　 incoming：${t.guestIn}` : ''}`);
    for (const task of BASE_TASKS) L.push(`   [ ] ${task.name}：${task.hint}`);
    for (const ex of extrasByProp[t.propId] ?? []) L.push(`   ‼ ${ex}`);
    L.push('');
  });
  L.push('完成后请拍照回传房东微信，谢谢！');
  L.push(`保洁（签字）：____________　日期：____________`);
  L.push(`生成：翻房单 · ${todayISOStr}（一客一换 · GB 9663-1996）`);
  return L.join('\n');
}

/** 翻房任务单打印版：单文件 HTML（内联样式，无外部资源） */
export function runSheetHtml({ turnovers, dateISO, extrasByProp = {}, hostName = '', todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const blocks = turnovers.map((t, i) => {
    const win = t.windowMinutes === null
      ? '今日无后续入住，按标准流程完成'
      : `退房 ${e(t.checkoutTime)} → 入住 ${e(t.checkinTime)}（窗口 ${e(minutesLabel(t.windowMinutes))}，标准保洁 ${e(minutesLabel(t.cleanMinutes))}）`;
    const urgent = t.level === 'red' || t.level === 'conflict' || t.level === 'yellow';
    return `<div class="job">
      <h2>${i + 1}. ${e(t.propName)} <span class="date">${e(t.checkoutISO)}</span></h2>
      <p class="meta">${win}${urgent ? ' <strong class="warn">⚠ 窗口紧张，请优先安排！</strong>' : ''}</p>
      <p class="meta">退住房客：${e(t.guestOut || '—')}${t.guestIn ? `　到客：${e(t.guestIn)}` : ''}</p>
      <ul>${BASE_TASKS.map((task) => `<li><span class="box"></span><strong>${e(task.name)}</strong>：${e(task.hint)}</li>`).join('')}
      ${(extrasByProp[t.propId] ?? []).map((x) => `<li class="extra">‼ ${e(x)}</li>`).join('')}</ul>
      <p class="foundline">遗留物品记录（品名 / 处理）：______________________________</p>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>翻房任务单 · ${e(dateISO)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta-h { font-size: 12.5px; color: #444; margin-bottom: 14px; }
  .job { border: 1.5px solid #155e75; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; page-break-inside: avoid; }
  .job h2 { font-size: 15.5px; margin: 0 0 6px; }
  .job h2 .date { font-size: 12px; color: #555; font-weight: 400; }
  .meta { font-size: 12.5px; margin: 3px 0; color: #333; }
  .warn { color: #b91c1c; }
  ul { margin: 8px 0; padding-left: 4px; list-style: none; }
  li { font-size: 13px; margin: 5px 0; }
  li.extra { color: #b45309; font-weight: 600; }
  .box { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #333; margin-right: 8px; vertical-align: -2px; }
  .foundline { font-size: 12.5px; margin: 8px 0 0; }
  .sign { margin-top: 18px; font-size: 13px; }
  .foot { margin-top: 10px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>翻房任务单 · ${e(dateISO)}</h1>
<div class="meta-h">${hostName ? `房东/主理人：${e(hostName)} · ` : ''}共 ${turnovers.length} 间房待翻 · 一客一换（GB 9663-1996）</div>
${blocks}
<div class="sign">完成后拍照回传 · 保洁（签字）：____________　日期：____________</div>
<div class="foot">生成：翻房单 TurnSheet · ${e(todayISOStr)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 给合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'turnsheet', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'turnsheet') return { ok: false, error: '不是翻房单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.host === 'object' && s.host !== null &&
    Array.isArray(s.properties) &&
    Array.isArray(s.stays) &&
    Array.isArray(s.linenSets) &&
    Array.isArray(s.linenEvents) &&
    Array.isArray(s.supplies) &&
    typeof s.turnoverLogs === 'object' && s.turnoverLogs !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
