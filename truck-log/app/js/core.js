/**
 * core.js — 车轮账 TruckLog 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；金额一律整数「分」、里程一律整数「公里」运算；
 * 日期统一 ISO 字符串 yyyy-mm-dd；所有周期参数（预警窗/检验周期/考核周年）可在设置中被车队覆盖。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md）：
 * - 《道路运输车辆技术管理规定》（交通运输部令 2023 年第 3 号，2023-06-01 施行）
 *   第 15 条：车辆技术档案实行一车一档，内容含维护修理、零部件更换、行驶里程、事故等记录；
 *   第 21 条：其他道路运输车辆注册不满 120 个月每 12 个月检验检测 1 次，超过 120 个月每 6 个月 1 次；
 *   第 31 条：未按规定周期频次检验检测或未按规定维护，处 1000~5000 元罚款；
 *   第 33 条：总质量 4500kg 及以下普通货运车辆不适用本规定。
 * - 《道路货物运输及站场管理规定》（交通运输部令 2026 年第 5 号，2026-03-20 施行）
 *   第 50 条：配发《道路运输证》的货运车辆每年审验一次（技术等级评定情况、结构尺寸变动、违章记录）。
 * - 《道路运输从业人员管理规定》第 29 条：从业资格证件有效期 6 年，届满 30 日前换证，
 *   超过有效期 180 日未申请换证的证件失效；诚信考核周期 12 个月。
 * - 《道路运输车辆动态监督管理办法》（2022 年第 10 号令修改）
 *   第 22 条：道路货运车辆公共平台监控个体货运车辆与 50 辆以下小型货运企业（本工具的目标客群）；
 *   第 25 条：及时提醒纠正超速、疲劳驾驶等违法行为并记录存档至动态监控台账，
 *   违法驾驶信息及处理情况至少保存 3 年；
 *   第 26 条：卫星定位装置故障不能保持在线的车辆不得安排运输经营；
 *   第 35 条：未有效执行交通违法动态信息处理制度、处理率低于 90%，拒不改正处 1000~3000 元罚款。
 * - 《道路交通安全法》第 98 条：未投保交强险上路，扣车并处最低责任限额保费二倍罚款。
 * 本工具是车队侧的车辆合规账本，不构成法律意见，不替代法定报送与执法认定。
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

/** 日期加 n 个月，月末钳制（2026-01-31 + 1 月 = 2026-02-28），n 可为负 */
export function addMonths(iso, n) {
  assertISO(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
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

/** 金额：整数分 → 「¥1290.00」 */
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
// 口径常量（行业法定口径的参数化，属地规则永远赢）
// ---------------------------------------------------------------------------

/** 证照钟类型（对应每辆营运车的法定时钟） */
export const CERT_KINDS = {
  review: { label: '运输证年审', basis: '每年一次（《道路货物运输及站场管理规定》第50条）' },
  inspection: { label: '检验检测/技术等级', basis: '注册不满120个月每12个月一次，超过每6个月一次（《道路运输车辆技术管理规定》第21条）' },
  compulsory: { label: '交强险', basis: '未投保上路：扣车+保费二倍罚款（《道路交通安全法》第98条）' },
  commercial: { label: '商业险', basis: '选填，脱保自担' },
};

/** 检验检测周期分界：注册登记满 120 个月后由 12 个月缩短为 6 个月（2023 年第 3 号令第 21 条） */
export const INSPECTION_AGE_MONTHS = 120;
/** 从业资格证件有效期（年）（《道路运输从业人员管理规定》第 29 条） */
export const DRIVER_CERT_YEARS = 6;
/** 诚信考核周期（月） */
export const ASSESS_MONTHS = 12;
/** 证照预警默认窗：到期日前 N 天进入黄灯 */
export const DEFAULT_WARN_DAYS = 60;
/** 未处理动态报警催办默认线（天） */
export const DEFAULT_ALERT_DAYS = 7;

export const RECORD_TYPES = {
  maintain: '维护保养',
  repair: '维修',
  part: '零部件更换',
  inspect: '检验检测',
  accident: '事故',
  other: '其他',
};

export const ALERT_TYPES = {
  fatigue: '疲劳驾驶',
  speed: '超速',
  offline: '终端离线',
  other: '其他',
};

// ---------------------------------------------------------------------------
// 证照时钟（一车四钟：年审 / 检验检测 / 交强险 / 商业险）
// ---------------------------------------------------------------------------

function requireRef(repos, id, label) {
  const hit = (repos ?? []).find((x) => x.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

/** 车龄（月）：按注册登记日到 asOf 的整月数 */
export function vehicleAgeMonths(vehicle, asOfISO = todayISO()) {
  assertISO(vehicle.regDateISO);
  assertISO(asOfISO);
  const from = new Date(`${vehicle.regDateISO}T00:00:00Z`);
  const to = new Date(`${asOfISO}T00:00:00Z`);
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** 检验检测周期（月）：注册不满 120 个月 12 个月一次，满 120 个月后 6 个月一次（第 21 条口径） */
export function inspectionCycleMonths(vehicle, asOfISO = todayISO()) {
  return vehicleAgeMonths(vehicle, asOfISO) >= INSPECTION_AGE_MONTHS ? 6 : 12;
}

/**
 * 按最近一次办理日建议下一到期日：检验检测按车龄定周期（12/6 个月），年审与保险按 12 个月。
 * 只做建议，实际到期日以证件与车籍地口径为准。
 */
export function suggestExpiry(vehicle, kind, lastDoneISO, asOfISO = todayISO()) {
  assertISO(lastDoneISO);
  const months = kind === 'inspection' ? inspectionCycleMonths(vehicle, lastDoneISO) : 12;
  return addMonths(lastDoneISO, months);
}

/** 单只证照钟状态：ok / due（黄）/ overdue（红，到期日当天仍算黄——次日即逾期） */
export function certState(cert, todayISOStr, warnDays = DEFAULT_WARN_DAYS) {
  assertISO(todayISOStr);
  const daysLeft = daysUntil(cert.expiryISO, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= warnDays ? 'due' : 'ok';
  return { daysLeft, level };
}

/** 全车队证照钟：红灯在前、其余按剩余天数升序；附车辆与证照类型信息 */
export function certBoard(state, todayISOStr, warnDays = DEFAULT_WARN_DAYS) {
  const order = { overdue: 0, due: 1, ok: 2 };
  const vehicleById = new Map((state.vehicles ?? []).map((v) => [v.id, v]));
  const rows = [];
  for (const cert of state.certs ?? []) {
    const vehicle = vehicleById.get(cert.vehicleId);
    if (!vehicle) continue;
    const st = certState(cert, todayISOStr, warnDays);
    rows.push({
      certId: cert.id,
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      kind: cert.kind,
      kindLabel: CERT_KINDS[cert.kind]?.label ?? cert.kind,
      expiryISO: cert.expiryISO,
      daysLeft: st.daysLeft,
      level: st.level,
    });
  }
  return rows.sort((a, b) => order[a.level] - order[b.level] || a.daysLeft - b.daysLeft || a.plate.localeCompare(b.plate));
}

// ---------------------------------------------------------------------------
// 驾驶员台账（从业资格证 6 年钟 + 诚信考核 12 个月周年）
// ---------------------------------------------------------------------------

export function driverState(driver, todayISOStr, warnDays = DEFAULT_WARN_DAYS) {
  assertISO(todayISOStr);
  const out = {};
  if (driver.certExpiryISO) {
    const daysLeft = daysUntil(driver.certExpiryISO, todayISOStr);
    out.certDaysLeft = daysLeft;
    out.certLevel = daysLeft < 0 ? 'overdue' : daysLeft <= warnDays ? 'due' : 'ok';
    out.certExpired = daysLeft < -180 ? '已超 180 日未换证，证件失效（《道路运输从业人员管理规定》第 29 条）' : '';
  }
  if (driver.assessISO) {
    const nextISO = addMonths(driver.assessISO, ASSESS_MONTHS);
    const daysLeft = daysUntil(nextISO, todayISOStr);
    out.assessDueISO = nextISO;
    out.assessDaysLeft = daysLeft;
    out.assessLevel = daysLeft < 0 ? 'overdue' : daysLeft <= warnDays ? 'due' : 'ok';
  }
  return out;
}

// ---------------------------------------------------------------------------
// 技术档案（一车一档：维护/维修/换件/检验/事故流水 + 费用）
// ---------------------------------------------------------------------------

/**
 * 写入一条技术档案记录。record: { vehicleId, dateISO, odometer, type, title, costCents, vendor, note }
 * 里程可空（进场小修没有里程读数是常态）；费用 0 = 自修/未发生。
 */
export function addRecord(state, { vehicleId, dateISO, odometer = null, type = 'maintain', title = '', costCents = 0, vendor = '', note = '' }) {
  assertISO(dateISO);
  requireRef(state.vehicles, vehicleId, '车辆');
  if (!RECORD_TYPES[type]) throw new Error(`非法档案类型: ${type}`);
  if (!Number.isInteger(costCents) || costCents < 0) throw new Error(`费用必须为非负整数分: ${costCents}`);
  if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) throw new Error(`里程必须为非负整数: ${odometer}`);
  state.recordSeq = (state.recordSeq ?? 0) + 1;
  const rec = { id: `r-${state.recordSeq}`, vehicleId, dateISO, odometer, type, title, costCents, vendor, note };
  state.records.push(rec);
  return rec;
}

/** 删除档案记录（记错的车队能自救；台账开放更正比逼人记假账更诚实） */
export function removeRecord(state, recordId) {
  const idx = state.records.findIndex((r) => r.id === recordId);
  if (idx < 0) throw new Error(`档案记录不存在: ${recordId}`);
  state.records.splice(idx, 1);
}

/** 一车一档流水（时间倒序） */
export function vehicleLedger(state, vehicleId) {
  requireRef(state.vehicles, vehicleId, '车辆');
  return (state.records ?? [])
    .filter((r) => r.vehicleId === vehicleId)
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id));
}

/** 某车某年费用合计（整数分） */
export function vehicleCost(state, vehicleId, year = null) {
  if (year !== null && !/^\d{4}$/.test(String(year))) throw new Error(`非法年份: ${year}`);
  return (state.records ?? [])
    .filter((r) => r.vehicleId === vehicleId && (year === null || r.dateISO.slice(0, 4) === String(year)))
    .reduce((n, r) => n + r.costCents, 0);
}

/** 最近一次档案里程（公里），无任何里程记录返回 null */
export function lastOdometer(state, vehicleId) {
  const rows = vehicleLedger(state, vehicleId).filter((r) => Number.isInteger(r.odometer));
  return rows.length ? rows[0].odometer : null;
}

// ---------------------------------------------------------------------------
// 动态监控台账（报警 → 提醒 → 处理闭环；违法信息与处理情况至少保存 3 年）
// ---------------------------------------------------------------------------

/**
 * 登记一条动态监控报警。alert: { vehicleId, driverId, dateISO, type, detail }
 * 未处理的报警在「今日」页持续点名——处理率低于 90% 属于法定罚则情形（办法第 35 条）。
 */
export function addAlert(state, { vehicleId, driverId = null, dateISO, type = 'other', detail = '' }) {
  assertISO(dateISO);
  requireRef(state.vehicles, vehicleId, '车辆');
  if (driverId) requireRef(state.drivers, driverId, '驾驶员');
  if (!ALERT_TYPES[type]) throw new Error(`非法报警类型: ${type}`);
  state.alertSeq = (state.alertSeq ?? 0) + 1;
  const alert = { id: `a-${state.alertSeq}`, vehicleId, driverId, dateISO, type, detail, handledISO: null, action: '', handler: '' };
  state.alerts.push(alert);
  return alert;
}

/** 处理闭环：填处理日/动作/处理人。闭环日期不得早于报警日；重复闭环拒绝 */
export function handleAlert(state, alertId, { handledISO, action = '', handler = '' } = {}) {
  const alert = requireRef(state.alerts, alertId, '报警记录');
  if (alert.handledISO) throw new Error('该报警已处理闭环');
  assertISO(handledISO);
  if (handledISO < alert.dateISO) throw new Error('处理日期早于报警日期');
  alert.handledISO = handledISO;
  alert.action = action;
  alert.handler = handler;
  return alert;
}

/** 未处理报警：最老的在前（挂账越久越危险，也是检查的第一问） */
export function openAlerts(state) {
  return (state.alerts ?? [])
    .filter((a) => !a.handledISO)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

/**
 * 月度动态监控小结：按月份分组全部报警，未处理单列。
 * month 形如 '2026-09'；跨年隔离。返回结构 + 确定性文本（text）。
 */
export function monthlyDynSummary(state, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const vehicleById = new Map((state.vehicles ?? []).map((v) => [v.id, v.plate]));
  const driverById = new Map((state.drivers ?? []).map((d) => [d.id, d.name]));
  const list = (state.alerts ?? []).filter((a) => monthKey(a.dateISO) === month);
  const byType = {};
  for (const a of list) byType[a.type] = (byType[a.type] ?? 0) + 1;
  const unhandled = list.filter((a) => !a.handledISO);
  const handled = list.filter((a) => a.handledISO);
  const summary = {
    month,
    total: list.length,
    handled: handled.length,
    unhandled: unhandled.length,
    handleRate: list.length ? Math.round((handled.length / list.length) * 100) : null,
    byType,
    unhandledList: unhandled.map((a) => ({
      dateISO: a.dateISO,
      plate: vehicleById.get(a.vehicleId) ?? '?',
      driverName: a.driverId ? (driverById.get(a.driverId) ?? '?') : '',
      typeLabel: ALERT_TYPES[a.type] ?? a.type,
      detail: a.detail,
    })),
  };
  const L = [];
  L.push(`【动态监控月度小结】${month}`);
  if (state.fleet?.name) L.push(`车队：${state.fleet.name}`);
  L.push(`报警合计 ${summary.total} 起，已处理 ${summary.handled} 起，未处理 ${summary.unhandled} 起`
    + (summary.handleRate === null ? '' : `，处理率 ${summary.handleRate}%（低于 90% 属《道路运输车辆动态监督管理办法》第 35 条罚则情形）`));
  const typeLine = Object.entries(summary.byType).map(([t, n]) => `${ALERT_TYPES[t] ?? t} ${n}`).join('、');
  if (typeLine) L.push(`分型：${typeLine}`);
  if (summary.unhandledList.length) {
    L.push('未处理点名：');
    for (const u of summary.unhandledList) {
      L.push(`  - ${u.dateISO} ${u.plate}${u.driverName ? `（${u.driverName}）` : ''} ${u.typeLabel}${u.detail ? `：${u.detail}` : ''}`);
    }
  }
  L.push('按办法第 25 条，违法驾驶信息及处理情况至少保存 3 年；本小结为台账底稿。');
  L.push(`生成：车轮账 · ${month}`);
  summary.text = L.join('\n');
  return summary;
}

// ---------------------------------------------------------------------------
// 迎检一页纸（单文件 HTML：一车一档速览 + 证照钟 + 报警台账 + 驾驶员）
// ---------------------------------------------------------------------------

/** 迎检一页纸：单文件 HTML（内联样式、无外部资源、含签字栏）。同输入同输出 */
export function inspectHtml(state, todayISOStr = todayISO(), warnDays = DEFAULT_WARN_DAYS) {
  const e = escapeHtml;
  const vehicleById = new Map((state.vehicles ?? []).map((v) => [v.id, v]));
  const board = certBoard(state, todayISOStr, warnDays);
  const LEVEL = { overdue: '逾期', due: '临期', ok: '正常' };
  const certRows = board.map((r) => `<tr>
    <td>${e(r.plate)}</td><td>${e(r.kindLabel)}</td><td>${e(r.expiryISO)}</td>
    <td>${r.daysLeft < 0 ? `逾期 ${-r.daysLeft} 天` : `剩 ${r.daysLeft} 天`}</td><td>${LEVEL[r.level]}</td>
  </tr>`).join('');
  const vehicleRows = (state.vehicles ?? []).map((v) => {
    const recs = vehicleLedger(state, v.id);
    const last = lastOdometer(state, v.id);
    return `<tr>
      <td>${e(v.plate)}</td>
      <td>${e(v.model || '—')}</td>
      <td>${e(v.regDateISO)}</td>
      <td>${e(v.transportCertNo || '—')}</td>
      <td>${recs.length} 条</td>
      <td>${last === null ? '—' : `${last} km`}</td>
      <td>${fmtYuan(vehicleCost(state, v.id))}</td>
    </tr>`;
  }).join('');
  const alertRows = [...(state.alerts ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((a) => `<tr>
    <td>${e(a.dateISO)}</td>
    <td>${e(vehicleById.get(a.vehicleId)?.plate ?? '?')}</td>
    <td>${e(ALERT_TYPES[a.type] ?? a.type)}</td>
    <td>${a.handledISO ? `已处理（${e(a.handledISO)}${a.action ? `：${e(a.action)}` : ''}）` : '<strong>未处理</strong>'}</td>
  </tr>`).join('');
  const driverRows = (state.drivers ?? []).map((d) => {
    const st = driverState(d, todayISOStr, warnDays);
    const certCell = d.certExpiryISO
      ? `${e(d.certExpiryISO)}（${st.certDaysLeft < 0 ? `逾期 ${-st.certDaysLeft} 天` : `剩 ${st.certDaysLeft} 天`}）`
      : '—';
    const assessCell = d.assessISO ? `${e(st.assessDueISO)} 到期` : '—';
    return `<tr><td>${e(d.name)}</td><td>${certCell}</td><td>${assessCell}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>车辆合规迎检一页纸 · ${e(state.fleet?.name ?? '')}</title>
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
<h1>车辆合规迎检一页纸 · ${e(state.fleet?.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 共 ${state.vehicles?.length ?? 0} 辆营运车 · ${state.drivers?.length ?? 0} 名驾驶员</div>
<h2>一、证照时钟（红黄绿）</h2>
<table><tr><th>车牌</th><th>证照</th><th>到期日</th><th>倒计时</th><th>状态</th></tr>${certRows}</table>
<h2>二、一车一档速览</h2>
<table><tr><th>车牌</th><th>车型</th><th>注册登记</th><th>道路运输证号</th><th>技术档案</th><th>最近里程</th><th>累计费用</th></tr>${vehicleRows}</table>
<h2>三、动态监控台账</h2>
<table><tr><th>报警日期</th><th>车牌</th><th>类型</th><th>处理情况</th></tr>${alertRows}</table>
<h2>四、驾驶员台账</h2>
<table><tr><th>姓名</th><th>从业资格证到期</th><th>下次诚信考核</th></tr>${driverRows}</table>
<div class="sign">安全管理员（签字）：____________　车队负责人（签字/盖章）：____________　日期：____________</div>
<div class="foot">生成：车轮账 TruckLog · ${e(todayISOStr)} · 本页为车队自查与迎检备查材料，不替代《道路运输证》审验、检验检测报告与法定报送</div>
</body>
</html>`;
}

/** 一车一档打印版（单文件 HTML）：车辆基本信息 + 技术档案流水（2023 年第 3 号令第 15 条形态） */
export function archiveHtml(state, vehicleId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const v = requireRef(state.vehicles, vehicleId, '车辆');
  const rows = vehicleLedger(state, v.id).map((r) => `<tr>
    <td>${e(r.dateISO)}</td><td>${e(RECORD_TYPES[r.type] ?? r.type)}</td><td>${e(r.title || '—')}</td>
    <td>${Number.isInteger(r.odometer) ? `${r.odometer} km` : '—'}</td>
    <td>${fmtYuan(r.costCents)}</td><td>${e(r.vendor || '—')}</td>
  </tr>`).join('');
  const certRows = (state.certs ?? []).filter((c) => c.vehicleId === v.id).map((c) => {
    const st = certState(c, todayISOStr);
    return `<tr><td>${e(CERT_KINDS[c.kind]?.label ?? c.kind)}</td><td>${e(c.expiryISO)}</td>
      <td>${st.daysLeft < 0 ? `逾期 ${-st.daysLeft} 天` : `剩 ${st.daysLeft} 天`}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>车辆技术档案 · ${e(v.plate)}</title>
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
<h1>车辆技术档案（一车一档）· ${e(v.plate)}</h1>
<div class="meta">车队：${e(state.fleet?.name ?? '')} · 车型：${e(v.model || '—')} · 注册登记：${e(v.regDateISO)} · 道路运输证号：${e(v.transportCertNo || '—')}</div>
<div class="meta">打印日：${e(todayISOStr)} · 最近里程：${(() => { const o = lastOdometer(state, v.id); return o === null ? '—' : `${o} km`; })()} · 档案记录 ${vehicleLedger(state, v.id).length} 条</div>
<h2>一、证照有效期</h2>
<table><tr><th>证照</th><th>到期日</th><th>倒计时</th></tr>${certRows}</table>
<h2>二、技术档案流水（维护/维修/换件/检验/事故）</h2>
<table><tr><th>日期</th><th>类型</th><th>事项</th><th>里程</th><th>费用</th><th>厂店/经办</th></tr>${rows}</table>
<div class="sign">车队长（签字）：____________　安全管理员（签字）：____________　日期：____________</div>
<div class="foot">生成：车轮账 TruckLog · ${e(todayISOStr)} · 依据《道路运输车辆技术管理规定》第 15 条一车一档要求整理，车辆转移所有权或车籍地时档案随车移交</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'trucklog', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'trucklog') return { ok: false, error: '不是车轮账的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.fleet === 'object' && s.fleet !== null &&
    arr(s.vehicles) && arr(s.drivers) && arr(s.certs) &&
    arr(s.records) && arr(s.alerts) && typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
