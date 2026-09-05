/**
 * core.js — 泳清单 PoolClear 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；数值直接用十进制读数
 * （试纸比色 / 比色管读数只到小数点后一两位，无浮点累加场景）；全部限值参数可在
 * 设置中被场馆覆盖——属地口径与场馆实际永远赢。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md）：
 * - GB 37488-2019《公共场所卫生指标及限值要求》表 4（人工游泳池水）：
 *   浑浊度 ≤1 NTU、pH 7.0~7.8、游离性余氯 0.3~1.0 mg/L、水温宜 23~30℃
 *   （菌落总数 ≤200 CFU/mL、大肠菌群不得检出、尿素等实验室项目不在日常自检范围）
 * - 《游泳场所卫生规范》（卫监督发〔2007〕205 号）：每场开放前、开放时均应进行
 *   池水余氯、pH、温度等检测（室内开放时每 2 小时测一次余氯）；浸脚消毒池水余氯
 *   应保持 5~10 mg/L、每 4 小时更换一次；检测结果应公示并注明测定时间、记录备查；
 *   直接服务顾客的从业人员每年进行一次健康检查
 * - 《公共场所卫生管理条例实施细则》：公共场所实行卫生许可证管理（有效期四年、
 *   醒目公示）；卫生管理档案分类记录、至少保存两年；未按规定对水质进行卫生检测
 *   的责令改正、警告，可处 2000 元以下罚款，逾期不改致卫生质量不符标准的处
 *   2000~20000 元罚款，情节严重的可责令停业整顿直至吊销卫生许可证
 * - 尿素 ≤3.5 mg/L 为 GB 9667-1996 口径（GB 37488-2019 表 4 以标准原文为准）
 *
 * 本工具是场馆侧的水质自检台账与泳客公示底稿，不替代法定检测报送，
 * 不构成卫生合规法律意见。
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

/** 读数格式化：0.6 → 「0.6」；7 → 「7.0」；空 → 「—」 */
export function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`读数非法: ${v}`);
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** 「0.3~1.0 mg/L」之类的区间文案（含小数的口径，整数端补齐一位小数） */
export function fmtRange([min, max], unit = '') {
  const frac = !Number.isInteger(min) || !Number.isInteger(max);
  const f = (v) => (frac && Number.isInteger(v) ? v.toFixed(1) : String(v));
  return `${f(min)}~${f(max)}${unit ? ` ${unit}` : ''}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 档案模板（内容供应链：检测项 = 国标限值 + 205 号规范检测频次的小微化拆解）
// ---------------------------------------------------------------------------

/** 水池类型：浸脚消毒池单独口径（余氯 5~10 mg/L，无 pH 要求） */
export const POOL_KINDS = {
  main: { label: '主池' },
  kids: { label: '儿童池/涉水池' },
  footbath: { label: '浸脚消毒池' },
  other: { label: '其他水池' },
};

/** 消毒方式（档案字段，台账落款用） */
export const DISINFECT_KINDS = {
  chlorine: { label: '含氯消毒剂（人工投加）' },
  dosing: { label: '自动投药/次氯酸钠' },
  ozone: { label: '臭氧 + 辅助氯' },
  salt: { label: '盐氯机' },
  other: { label: '其他' },
};

/** 检测时点：205 号文「每场开放前、开放时均应检测」的小微化四档 */
export const SLOTS = {
  open: { label: '开放前首检' },
  mid: { label: '开放中抽检' },
  close: { label: '闭馆检' },
  extra: { label: '复测/加测' },
};

/**
 * 默认限值（国标口径，设置页可覆盖——属地与场馆实际永远赢）：
 * residual  游离性余氯 mg/L（GB 37488-2019）
 * ph        pH（GB 37488-2019）
 * turbidityMax  浑浊度 NTU 上限（GB 37488-2019）
 * waterTemp 水温 ℃「宜」区间（GB 37488-2019，软指标）
 * foot      浸脚消毒池余氯 mg/L（205 号规范）
 */
export const DEFAULT_LIMITS = {
  residual: [0.3, 1.0],
  ph: [7.0, 7.8],
  turbidityMax: 1,
  waterTemp: [23, 30],
  foot: [5, 10],
};

/** 校验限值参数（区间 [min,max] 数字型、min ≤ max、上限为正），返回归一化副本 */
export function validateLimits(limits) {
  const d = DEFAULT_LIMITS;
  const pair = (v, fallback, name) => {
    const [min, max] = Array.isArray(v) ? v : fallback;
    if (typeof min !== 'number' || !Number.isFinite(min) ||
        typeof max !== 'number' || !Number.isFinite(max) || min > max) {
      throw new Error(`限值参数非法: ${name}`);
    }
    return [min, max];
  };
  const turbidityMax = limits?.turbidityMax ?? d.turbidityMax;
  if (typeof turbidityMax !== 'number' || !Number.isFinite(turbidityMax) || turbidityMax <= 0) {
    throw new Error('限值参数非法: turbidityMax');
  }
  return {
    residual: pair(limits?.residual, d.residual, 'residual'),
    ph: pair(limits?.ph, d.ph, 'ph'),
    turbidityMax,
    waterTemp: pair(limits?.waterTemp, d.waterTemp, 'waterTemp'),
    foot: pair(limits?.foot, d.foot, 'foot'),
  };
}

// ---------------------------------------------------------------------------
// 判定引擎（达标 / 偏高 / 偏低 / 软指标；边界值按国标闭区间处理）
// ---------------------------------------------------------------------------

function judge(v, [min, max]) {
  if (v >= min && v <= max) return 'ok';
  return v > max ? 'high' : 'low';
}

const HARD_LABEL = { high: '偏高', low: '偏低' };

/**
 * 单条检测记录的判定（浸脚消毒池只管余氯 5~10，其余池管余氯 + pH 必测、
 * 浊度选测硬指标、水温软指标）。
 * hard = 硬指标（国标/规范限值）有超线；soft = 水温出了「宜」区间（提示不强制）。
 */
export function evaluate(record, pool, limits = DEFAULT_LIMITS) {
  const footbath = pool.kind === 'footbath';
  const items = {};
  if (!Number.isFinite(record.residual)) throw new Error('余氯读数缺失，无法判定');
  items.residual = { v: record.residual, level: judge(record.residual, footbath ? limits.foot : limits.residual) };
  if (footbath) {
    items.residual.range = limits.foot;
  } else {
    if (!Number.isFinite(record.ph)) throw new Error('pH 读数缺失，无法判定');
    items.ph = { v: record.ph, level: judge(record.ph, limits.ph), range: limits.ph };
    if (record.turbidity !== null && record.turbidity !== undefined) {
      items.turbidity = {
        v: record.turbidity,
        level: record.turbidity <= limits.turbidityMax ? 'ok' : 'high',
        range: [0, limits.turbidityMax],
      };
    }
    if (record.waterTemp !== null && record.waterTemp !== undefined) {
      items.waterTemp = { v: record.waterTemp, level: judge(record.waterTemp, limits.waterTemp), range: limits.waterTemp, soft: true };
    }
  }
  const hard = Object.keys(items).filter((k) => !items[k].soft && items[k].level !== 'ok');
  const soft = Object.keys(items).filter((k) => items[k].soft && items[k].level !== 'ok');
  return { items, hard, soft, ok: hard.length === 0 };
}

/** 一条记录的展示用判定徽章：✅ 达标 / ⚠ 指标（水温）/ ❌ 余氯偏高 */
export function badge(record, pool, limits = DEFAULT_LIMITS) {
  const r = evaluate(record, pool, limits);
  if (r.hard.length > 0) {
    return `❌ ${r.hard.map((k) => `${k === 'residual' ? '余氯' : k === 'ph' ? 'pH' : '浊度'}${HARD_LABEL[r.items[k].level]}`).join('、')}`;
  }
  if (r.soft.length > 0) {
    return `⚠ 水温${HARD_LABEL[r.items.waterTemp.level]}（宜 ${fmtRange(limits.waterTemp, '℃')}）`;
  }
  return '✅ 达标';
}

// ---------------------------------------------------------------------------
// 台账动作（异常强制处置说明、复测闭环、缺检点名——证明链的地基）
// ---------------------------------------------------------------------------

function requirePool(pools, id, label = '水池') {
  const hit = (pools ?? []).find((p) => p.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

function sameCheckExists(records, { poolId, dateISO, slot }) {
  if (slot === 'extra') return false; // 复测/加测不限次
  return (records ?? []).some((r) => r.poolId === poolId && r.dateISO === dateISO && r.slot === slot);
}

/**
 * 落一条检测记录：{ id, poolId, dateISO, slot, residual, ph?, turbidity?, waterTemp?, opNote?, action?, recheckOf?, createdAt }。
 * 门禁：
 * - 水池必须存在且在用；日期合法且不得在未来；时点合法；同池同时点重复落账拒绝（复测/加测除外）
 * - 判定超硬限值时必须填写处置说明（action）——异常不许裸奔进台账
 * - 带 recheckOf 时按「复测闭环」处理：目标异常必须存在、同池、未闭环，
 *   且本条判定达标才允许闭环（复测还超标 = 没闭环，老老实实继续处置）
 */
export function addRecord(state, input, todayISOStr = todayISO()) {
  const pool = requirePool(state.pools, input.poolId);
  if (pool.active === false) throw new Error(`水池「${pool.name}」已停用，请先恢复或另选水池`);
  assertISO(input.dateISO);
  if (input.dateISO > todayISOStr) throw new Error('检测日期不能是未来');
  if (!SLOTS[input.slot]) throw new Error(`检测时点非法: ${input.slot}`);
  if (sameCheckExists(state.records, input)) throw new Error('该池此时点已检过，重复落账请选「复测/加测」');
  if (!Number.isFinite(input.residual) || input.residual < 0) throw new Error('余氯读数必须为非负数字');
  const footbath = pool.kind === 'footbath';
  if (!footbath) {
    if (!Number.isFinite(input.ph) || input.ph < 0 || input.ph > 14) throw new Error('pH 读数必须为 0~14 的数字');
  }
  for (const k of ['turbidity', 'waterTemp']) {
    const v = input[k];
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) {
      throw new Error(`${k === 'turbidity' ? '浊度' : '水温'}读数非法`);
    }
  }
  const record = {
    id: input.id,
    poolId: input.poolId,
    dateISO: input.dateISO,
    slot: input.slot,
    residual: input.residual,
    ...(footbath ? {} : {
      ph: input.ph,
      ...(input.turbidity !== null && input.turbidity !== undefined ? { turbidity: input.turbidity } : {}),
      ...(input.waterTemp !== null && input.waterTemp !== undefined ? { waterTemp: input.waterTemp } : {}),
    }),
    opNote: input.opNote ?? '',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const ev = evaluate(record, pool, validateLimits(state.settings?.limits));
  if (!ev.ok) {
    if (!input.action || !String(input.action).trim()) {
      throw new Error('指标超线必须填写处置说明（加了什么药、补了多少水），异常不许裸奔进台账');
    }
    record.anomaly = { action: String(input.action).trim() };
  }
  if (input.recheckOf) {
    const target = (state.records ?? []).find((r) => r.id === input.recheckOf);
    if (!target || !target.anomaly) throw new Error('复测目标不是待闭环的异常记录');
    if (target.poolId !== pool.id) throw new Error('复测必须落在同一个池');
    if (target.anomaly.closedBy) throw new Error('该异常已闭环，不要重复闭环');
    if (!ev.ok) throw new Error('复测仍超线：请继续处置（加药/补水/换水），达标后再闭环');
    record.recheckOf = input.recheckOf;
    target.anomaly.closedBy = record.id;
    target.anomaly.closedAt = record.createdAt;
  }
  state.records.push(record);
  return { record, evaluation: ev };
}

/** 撤销误操作：删除记录。若它是某异常的闭环记录，异常自动回到「待闭环」 */
export function removeRecord(state, recordId) {
  const idx = (state.records ?? []).findIndex((r) => r.id === recordId);
  if (idx < 0) throw new Error(`检测记录不存在: ${recordId}`);
  const [rec] = state.records.splice(idx, 1);
  for (const r of state.records) {
    if (r.anomaly?.closedBy === rec.id) {
      delete r.anomaly.closedBy;
      delete r.anomaly.closedAt;
    }
  }
  return rec;
}

/** 待闭环异常（全台账扫描）：异常发生但还没有达标复测跟上的记录 */
export function openAnomalies(state) {
  return (state.records ?? [])
    .filter((r) => r.anomaly && !r.anomaly.closedBy)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// 看板（今日打卡状态、连续全检天数、证照预警）
// ---------------------------------------------------------------------------

/** 某池某日的记录数（按时点计，复测/加测也算检） */
function dayRecords(records, poolId, dateISO) {
  return (records ?? []).filter((r) => r.poolId === poolId && r.dateISO === dateISO);
}

/** 当日在用水池（含当天新增的池） */
export function activePools(state) {
  return (state.pools ?? []).filter((p) => p.active !== false);
}

/**
 * 今日打卡状态（逐池）：no-check 未检 / done 已检（带达标徽章）。
 * 今日任一池未检时，点名清单就是「今天还差什么」的待办。
 */
export function todayBoard(state, dateISOStr = todayISO()) {
  const pools = activePools(state);
  const rows = pools.map((pool) => {
    const list = dayRecords(state.records, pool.id, dateISOStr)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const latest = list[list.length - 1] ?? null;
    return {
      pool,
      count: list.length,
      latest,
      badge: latest ? badge(latest, pool, validateLimits(state.settings?.limits)) : '⬜ 未检',
      checked: list.length > 0,
    };
  });
  return {
    dateISO: dateISOStr,
    rows,
    missing: rows.filter((r) => !r.checked).map((r) => r.pool),
    anomalyOpen: openAnomalies(state),
  };
}

/**
 * 连续全检天数：从今天（若今天已全检）或昨天往前数，所有在用水池每天
 * 至少一检的最长连续天数。它不是合规指标，是习惯指标——打卡粘性的第一因。
 */
export function streakDays(state, todayISOStr = todayISO()) {
  const pools = activePools(state);
  if (pools.length === 0) return { streak: 0, started: false };
  const complete = (iso) => pools.every((p) => dayRecords(state.records, p.id, iso).length > 0);
  let cursor = complete(todayISOStr) ? todayISOStr : addDays(todayISOStr, -1);
  if (!complete(cursor)) return { streak: 0, started: false };
  let streak = 0;
  while (complete(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return { streak, started: true };
}

/** 证照/报告到期分级：expired 已过期 / soon 临期（默认 30 天内）/ ok */
export function expiryLevel(expiryISO, todayISOStr = todayISO(), warnDays = 30) {
  const d = daysUntil(expiryISO, todayISOStr);
  if (d < 0) return 'expired';
  if (d <= warnDays) return 'soon';
  return 'ok';
}

/** 证照台账预警清单：卫生许可证 + 从业人员健康证 + 第三方检测报告 */
export function expiryAlerts(state, todayISOStr = todayISO(), warnDays = 30) {
  const out = [];
  const venue = state.venue ?? {};
  if (venue.licenseExpiry) {
    out.push({ kind: 'license', label: `卫生许可证（${venue.name || '本场馆'}）`, expiry: venue.licenseExpiry, level: expiryLevel(venue.licenseExpiry, todayISOStr, warnDays) });
  }
  for (const c of state.certs ?? []) {
    out.push({ kind: 'cert', label: `健康证 · ${c.name}${c.role ? `（${c.role}）` : ''}`, expiry: c.expiry, level: expiryLevel(c.expiry, todayISOStr, warnDays) });
  }
  for (const t of state.reports ?? []) {
    out.push({ kind: 'report', label: `第三方检测报告 · ${t.org || '检测机构'}`, expiry: t.nextDue, level: expiryLevel(t.nextDue, todayISOStr, warnDays) });
  }
  return out.filter((x) => x.level !== 'ok').sort((a, b) => a.expiry.localeCompare(b.expiry));
}

// ---------------------------------------------------------------------------
// 台账体检与月报（应检 = 天数 × 池数 × 每日频次；缺检点名是体检的核心产出）
// ---------------------------------------------------------------------------

/**
 * 日期区间台账体检（量纲：检次 = 池·日 × 每日应检频次）。
 * - 每日频次默认 2（开放前首检 + 开放中抽检，205 号文口径的底线化），可在设置覆盖为 1~4
 * - 应检 pairTotal = 区间内每天 × 每个当日已在用的池 × dailyRequired
 * - 足额 doneChecks = Σ min(实检次数, dailyRequired)；缺检 missingChecks = 应检 − 足额（守恒）
 * - 缺检点名 missing 列出每个不达频次的池·日（实检/应检）
 * - 异常闭环率 = 已闭环异常 / 区间内发生的异常；达标率 = 硬指标全达标的记录 / 全部记录
 */
export function audit(state, fromISO, toISO, todayISOStr = todayISO()) {
  assertISO(fromISO);
  assertISO(toISO);
  if (fromISO > toISO) throw new Error('起始日期晚于截止日期');
  const end = toISO < todayISOStr ? toISO : todayISOStr;
  if (fromISO > end) throw new Error('区间在未来，没有可体检的台账');
  const dailyRequired = Math.max(1, Math.min(4, Number(state.settings?.dailyRequired) || 2));
  const limits = validateLimits(state.settings?.limits);
  const dates = [];
  for (let d = fromISO; d <= end; d = addDays(d, 1)) dates.push(d);
  const missing = [];
  let pairTotal = 0;
  let doneChecks = 0;
  for (const date of dates) {
    for (const pool of activePools(state)) {
      if ((pool.since ?? pool.createdAtISO ?? '') > date) continue; // 当天还没建的池不算应检
      const n = dayRecords(state.records, pool.id, date).length;
      pairTotal += dailyRequired;
      doneChecks += Math.min(n, dailyRequired);
      if (n < dailyRequired) missing.push({ date, poolId: pool.id, poolName: pool.name, have: n, need: dailyRequired });
    }
  }
  const inRange = (state.records ?? []).filter((r) => r.dateISO >= fromISO && r.dateISO <= end);
  const anomalies = inRange.filter((r) => r.anomaly);
  const closed = anomalies.filter((r) => r.anomaly.closedBy);
  const closureHours = closed.map((r) => {
    const closing = state.records.find((x) => x.id === r.anomaly.closedBy);
    return (new Date(closing.createdAt) - new Date(r.createdAt)) / 3600000;
  });
  const passed = inRange.filter((r) => {
    const pool = requirePool(state.pools, r.poolId);
    return evaluate(r, pool, limits).ok;
  });
  return {
    fromISO, toISO: end, dailyRequired,
    pairTotal, doneChecks, missingChecks: pairTotal - doneChecks, missing,
    recordCount: inRange.length,
    passRate: inRange.length ? passed.length / inRange.length : null,
    anomalies: anomalies.length,
    anomaliesClosed: closed.length,
    avgClosureHours: closed.length ? closureHours.reduce((a, b) => a + b, 0) / closed.length : null,
  };
}

/** 月度小结：体检的月度切片 + 连续全检口径的完成天数 */
export function monthlyStats(state, month, todayISOStr = todayISO()) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const today = monthKey(todayISOStr) === month ? todayISOStr : null;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = today ?? `${month}-${String(lastDay).padStart(2, '0')}`;
  const from = `${month}-01`;
  return audit(state, from, to, todayISOStr);
}

// ---------------------------------------------------------------------------
// 三通道出证（每日速报文本 / 泳客公示页 / 迎检台账打印包）
// ---------------------------------------------------------------------------

function venueLine(venue) {
  const parts = [venue?.name ?? '本场馆'];
  if (venue?.licenseNo) parts.push(`卫生许可证号 ${venue.licenseNo}`);
  return parts.join(' · ');
}

/** 当日各池「最新一条」记录（公示口径：只展示最新状态） */
export function latestByPool(state, dateISOStr = todayISO()) {
  const limits = validateLimits(state.settings?.limits);
  return activePools(state).map((pool) => {
    const list = dayRecords(state.records, pool.id, dateISOStr).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const latest = list[list.length - 1] ?? null;
    return { pool, latest, badge: latest ? badge(latest, pool, limits) : null, time: latest ? latest.createdAt.slice(11, 16) : null };
  });
}

/** 单条记录的读数文案（口径随设置走，覆盖属地参数后文案同步变化） */
function metricLine(record, pool, limits) {
  if (pool.kind === 'footbath') {
    return `余氯 ${fmtVal(record.residual)}（合规 ${fmtRange(limits.foot, 'mg/L')}）`;
  }
  return `余氯 ${fmtVal(record.residual)} · pH ${fmtVal(record.ph)}`
    + `${record.turbidity !== undefined && record.turbidity !== null ? ` · 浊度 ${fmtVal(record.turbidity)}NTU` : ''}`
    + `${record.waterTemp !== undefined && record.waterTemp !== null ? ` · 水温 ${fmtVal(record.waterTemp)}℃` : ''}`;
}

/**
 * 每日水质速报（纯文本，微信家长群主通道）。
 * 同输入同输出；未检的池如实点名——公示的价值恰恰在「没达标/没检测也看得见」。
 */
export function dailyText(state, dateISOStr = todayISO()) {
  const venue = state.venue ?? {};
  const limits = validateLimits(state.settings?.limits);
  const rows = latestByPool(state, dateISOStr);
  if (rows.length === 0) throw new Error('还没有建档水池，先在「设置」把池子建起来');
  const L = [];
  L.push(`【今日水质速报】${dateISOStr}`);
  for (const { pool, latest, badge: b, time } of rows) {
    if (!latest) {
      L.push(`  ${POOL_KINDS[pool.kind]?.label ?? '水池'}「${pool.name}」：今日未检 ⚠`);
    } else {
      L.push(`  ${POOL_KINDS[pool.kind]?.label ?? '水池'}「${pool.name}」：${metricLine(latest, pool, limits)}　${b}${latest.anomaly && !latest.anomaly.closedBy ? '（处置中，完成后复测）' : ''}（${time}）`);
    }
  }
  L.push('');
  L.push(`说明：泳池水执行 GB 37488-2019（游离性余氯 ${fmtRange(limits.residual, 'mg/L')}、pH ${fmtRange(limits.ph)}），浸脚池余氯保持 ${fmtRange(limits.foot, 'mg/L')}；本馆每日开放前、开放中按规范检测并留存台账，欢迎到店查阅。`);
  L.push(`—— ${venueLine(venue)} · 出单 泳清单`);
  return L.join('\n');
}

/**
 * 泳客公示页：单文件 HTML（内联样式、无外部资源、离线可用）。
 * 下载发家长群、打印贴公示栏两用；205 号文「检测结果应公示并注明测定时间」的直接落地。
 */
export function publicHtml(state, dateISOStr = todayISO()) {
  const e = escapeHtml;
  const venue = state.venue ?? {};
  const limits = validateLimits(state.settings?.limits);
  const rows = latestByPool(state, dateISOStr);
  if (rows.length === 0) throw new Error('还没有建档水池，先在「设置」把池子建起来');
  const body = rows.map(({ pool, latest, badge: b, time }) => {
    const metrics = latest
      ? `<td>${e(metricLine(latest, pool, limits))}</td><td class="${b && b.startsWith('❌') ? 'bad' : b && b.startsWith('⚠') ? 'warn' : 'ok'}">${e(b ?? '')}${latest.anomaly && !latest.anomaly.closedBy ? '<div class="sub">处置中，完成后复测</div>' : ''}</td><td class="sub">${e(time ?? '')}</td>`
      : `<td colspan="3" class="bad">今日未检</td>`;
    return `<tr><td><strong>${e(POOL_KINDS[pool.kind]?.label ?? '水池')}</strong><div class="sub">${e(pool.name)}</div></td>${metrics}</tr>`;
  }).join('');
  const now = new Date();
  const updated = `${dateISOStr} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>今日水质公示 · ${e(venue.name ?? '游泳场所')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #0c4a6e; margin: 0; background: #f0f9ff; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 20px 16px 28px; }
  h1 { font-size: 21px; margin: 0 0 2px; color: #075985; }
  .meta { font-size: 12.5px; color: #0369a1; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; background: #fff; border-radius: 12px; overflow: hidden; margin-top: 12px; box-shadow: 0 1px 4px rgba(3,105,161,.12); }
  th, td { text-align: left; padding: 10px 10px; border-bottom: 1px solid #e0f2fe; vertical-align: top; }
  th { color: #075985; font-weight: 600; font-size: 12.5px; background: #e0f2fe; }
  td.ok { color: #15803d; font-weight: 600; white-space: nowrap; }
  td.warn { color: #b45309; font-weight: 600; white-space: nowrap; }
  td.bad { color: #b91c1c; font-weight: 600; white-space: nowrap; }
  .sub { font-size: 11px; color: #64748b; font-weight: 400; margin-top: 2px; }
  .note { font-size: 11.5px; color: #0369a1; margin-top: 12px; line-height: 1.7; }
  .sign { margin-top: 14px; font-size: 12.5px; color: #075985; }
  @media print { body { background: #fff; } .wrap { padding: 8mm; } table { box-shadow: none; } }
</style>
</head>
<body>
<div class="wrap">
<h1>今日水质公示</h1>
<div class="meta">${e(venueLine(venue))}</div>
<div class="meta">检测日 ${e(dateISOStr)} · 更新 ${e(updated)} · 数据来自本馆水质自检台账</div>
<table>
<tr><th>水池</th><th>检测读数</th><th>判定</th><th>时间</th></tr>
${body}
</table>
<p class="note">执行标准：泳池水 GB 37488-2019（游离性余氯 ${e(fmtRange(limits.residual, 'mg/L'))}、pH ${e(fmtRange(limits.ph))}、浑浊度 ≤${e(String(limits.turbidityMax))} NTU）；浸脚消毒池余氯保持 ${e(fmtRange(limits.foot, 'mg/L'))}（《游泳场所卫生规范》）。本馆每日开放前、开放中按规范检测并留存台账备查；第三方全项检测报告及历史台账，欢迎到店查阅。</p>
<div class="sign">水质负责人签字：____________　电话：${e(venue.phone ?? '')}</div>
<div class="note">生成：泳清单 PoolClear · 泳客公示页</div>
</div>
</body>
</html>`;
}

/**
 * 迎检台账打印包：按日期区间出「逐日逐池记录 + 异常处置链 + 体检卡」的
 * 单文件 HTML（含负责人签字栏）。对应细则「卫生管理档案至少保存两年」。
 */
export function auditHtml(state, fromISO, toISO, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const venue = state.venue ?? {};
  const a = audit(state, fromISO, toISO, todayISOStr);
  const limits = validateLimits(state.settings?.limits);
  const poolName = (id) => {
    const p = (state.pools ?? []).find((x) => x.id === id);
    return p ? `${POOL_KINDS[p.kind]?.label ?? '水池'}「${p.name}」` : id;
  };
  const recs = (state.records ?? [])
    .filter((r) => r.dateISO >= fromISO && r.dateISO <= a.toISO)
    .sort((x, y) => x.dateISO.localeCompare(y.dateISO) || x.createdAt.localeCompare(y.createdAt));
  const rows = recs.map((r) => {
    const pool = requirePool(state.pools, r.poolId);
    const ev = evaluate(r, pool, limits);
    const verdict = ev.ok
      ? '<span class="ok">✅ 达标</span>'
      : `<span class="bad">❌ ${r.anomaly ? e(r.anomaly.action) : '超线'}</span>${ev.soft.length ? ' <span class="sub">水温出「宜」区间</span>' : ''}`;
    return `<tr>
      <td>${e(r.dateISO)}</td><td>${e(poolName(r.poolId))}</td><td>${e(SLOTS[r.slot]?.label ?? r.slot)}</td>
      <td>${e(fmtVal(r.residual))}</td><td>${e(fmtVal(r.ph))}</td><td>${e(fmtVal(r.turbidity))}</td><td>${e(fmtVal(r.waterTemp))}</td>
      <td>${verdict}</td>
    </tr>`;
  }).join('');
  const missingRows = a.missing.length
    ? `<tr><td colspan="4" class="bad">缺检点名：${a.missing.map((m) => `${e(m.date)} ${e(poolName(m.poolId))}（${m.have}/${m.need}）`).join('；')}</td></tr>`
    : '<tr><td colspan="4">区间内无缺检 ✅</td></tr>';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>水质检测台账 · ${e(venue.name ?? '游泳场所')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { color: #555; font-weight: 500; }
  .ok { color: #15803d; font-weight: 600; }
  .bad { color: #b91c1c; font-weight: 600; }
  .sub { font-size: 10.5px; color: #777; font-weight: 400; }
  .sign { margin-top: 20px; font-size: 12.5px; }
  .foot { margin-top: 10px; font-size: 10.5px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>游泳场所水质检测台账</h1>
<div class="meta">${e(venueLine(venue))}${venue.address ? ` · 地址 ${e(venue.address)}` : ''}</div>
<div class="meta">区间 ${e(fromISO)} ~ ${e(a.toISO)} · 每日应检 ${a.dailyRequired} 次/池（开放前首检 + 开放中抽检）· 出单日 ${e(todayISOStr)}</div>
<h2>一、体检卡</h2>
<table>
<tr><th>应检检次（池·日 × 每日 ${a.dailyRequired}）</th><th>足额完成</th><th>达标率（硬指标）</th><th>异常 → 闭环</th></tr>
<tr><td>${a.pairTotal} 检次</td><td>${a.doneChecks} 检次（缺检 ${a.missingChecks} 检次 · ${a.missing.length} 池·日）</td>
<td>${a.passRate === null ? '—' : `${Math.round(a.passRate * 100)}%`}</td>
<td>${a.anomalies} 起 → 已闭环 ${a.anomaliesClosed} 起${a.avgClosureHours !== null ? `（平均 ${a.avgClosureHours.toFixed(1)} 小时）` : ''}</td></tr>
${missingRows}
</table>
<h2>二、检测记录明细（${a.recordCount} 条）</h2>
<table>
<tr><th>日期</th><th>水池</th><th>时点</th><th>余氯<br/>mg/L</th><th>pH</th><th>浊度<br/>NTU</th><th>水温<br/>℃</th><th>判定 / 处置</th></tr>
${rows || '<tr><td colspan="8">区间内无记录</td></tr>'}
</table>
<h2>三、说明</h2>
<p class="meta">泳池水执行 GB 37488-2019（游离性余氯 ${e(fmtRange(limits.residual, 'mg/L'))}、pH ${e(fmtRange(limits.ph))}、浑浊度 ≤${e(String(limits.turbidityMax))} NTU）；浸脚消毒池余氯保持 ${e(fmtRange(limits.foot, 'mg/L'))}（《游泳场所卫生规范》卫监督发〔2007〕205 号）。本台账为场馆自检留痕底稿，配合第三方全项检测报告使用；法定检测与报送以卫生健康主管部门要求为准。</p>
<div class="sign">水质负责人（签字）：____________　负责人（签字/盖章）：____________　日期：____________</div>
<div class="foot">生成：泳清单 PoolClear · 迎检台账包</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'poolclear', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'poolclear') return { ok: false, error: '不是泳清单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.venue === 'object' && s.venue !== null &&
    arr(s.pools) && arr(s.records) && arr(s.certs) && arr(s.reports) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
