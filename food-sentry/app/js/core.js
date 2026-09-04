/**
 * core.js — 食安哨 FoodSentry 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖，日期与汇总计算不使用任何第三方库。
 */

// ---------------------------------------------------------------------------
// 日期工具（ISO 字符串 yyyy-mm-dd 为唯一日期表示）
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 校验 ISO 日期字符串，非法则抛错 */
export function assertISO(iso) {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) {
    throw new Error(`非法日期: ${JSON.stringify(iso)}`);
  }
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`非法日期: ${iso}`);
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

/**
 * 某日所在周的 7 个日期，周一为起点（监管台账的通行口径，与自然周报表一致）。
 * 跨年/跨月由 addDays 的 UTC 运算天然收敛。
 */
export function weekDatesOf(iso) {
  assertISO(iso);
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=周日 … 6=周六
  const shiftToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = addDays(iso, shiftToMonday);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 某年某月的全部日期。month 取 1~12，闰月由 UTC 运算天然正确 */
export function monthDatesOf(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`非法年月: ${year}-${month}`);
  }
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return Array.from({ length: days }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, '0')}`);
}

/** 闭区间日期序列；起点晚于终点直接抛错（不静默返回空，防止"生成了一份空台账"） */
export function rangeDates(startISO, endISO) {
  assertISO(startISO);
  assertISO(endISO);
  if (endISO < startISO) throw new Error(`日期区间倒置: ${startISO} > ${endISO}`);
  const out = [];
  let cur = startISO;
  while (cur <= endISO) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 检查项模板（内容供应链：法规依据见 docs/14 调研来源；模板为通识口径，以属地监管要求为准）
// ---------------------------------------------------------------------------

export const BUSINESS_TYPES = {
  restaurant: { label: '餐馆 / 小吃 / 饮品', sample: false },
  canteen: { label: '单位 / 学校食堂（集体用餐）', sample: true },
};

export const CHECK_TEMPLATES = [
  {
    id: 'morning', name: '晨检（人员健康·个人卫生）',
    basis: '从业人员健康管理制度',
    hint: '发热、腹泻、手部有伤口者不得上岗接触直接入口食品',
  },
  {
    id: 'purchase', name: '进货查验（索证索票·验收）',
    basis: '《食品安全法》第五十三条',
    hint: '留存供货商资质与票据；过期、感官异常、无标签一律拒收',
  },
  {
    id: 'env', name: '环境卫生·虫害防治',
    basis: '《餐饮服务食品安全操作规范》',
    hint: '操作区无积水油垢，防蝇防鼠设施在位有效',
  },
  {
    id: 'disinfect', name: '餐用具清洗消毒',
    basis: '《餐饮服务食品安全操作规范》',
    hint: '消毒设备运行正常；化学消毒按浓度浸泡后用清水冲净',
  },
  {
    id: 'equip', name: '设备设施（冷藏·冷冻·排风）',
    basis: '《餐饮服务食品安全操作规范》',
    hint: '冷藏 0~8℃、冷冻 -12℃ 以下（以设备标注为准），生熟分开存放',
  },
  {
    id: 'waste', name: '餐厨废弃物处置',
    basis: '《餐饮服务食品安全操作规范》',
    hint: '容器加盖、当日清运，留存收运联单',
  },
  {
    id: 'sample', name: '食品留样（≥125g·48h·专柜）',
    basis: '学校食堂 / 集体用餐单位强制要求',
    hint: '每品种不少于 125g，专用冰箱 0~8℃ 存放 48 小时以上并做好记录',
  },
];

/** 按业态取检查项；自定义项追加在后（id 不得与内置冲突，冲突时抛错保护台账完整性） */
export function itemsFor(businessType, customItems = []) {
  const bt = BUSINESS_TYPES[businessType];
  if (!bt) return [];
  const builtIn = CHECK_TEMPLATES.filter((t) => t.id !== 'sample' || bt.sample);
  const seen = new Set(builtIn.map((t) => t.id));
  const custom = customItems.map((c) => {
    if (!c?.id || !c?.name) throw new Error('自定义检查项缺少 id 或名称');
    if (seen.has(c.id)) throw new Error(`自定义检查项 id 与内置冲突: ${c.id}`);
    seen.add(c.id);
    return { id: c.id, name: c.name, basis: c.basis || '自定义检查项', hint: c.hint || '' };
  });
  return [...builtIn, ...custom];
}

// ---------------------------------------------------------------------------
// 打卡与汇总
// ---------------------------------------------------------------------------

/**
 * 单日状态。checks 结构：{ [dateISO]: { [itemId]: { status:'ok'|'issue', note, at } } }
 * 只认 ok/issue 两种已检状态；缺记录/乱值一律按"未检"处理（宁漏勿假）。
 */
export function dayStatus(dateISO, items, checks) {
  assertISO(dateISO);
  const dayChecks = checks?.[dateISO] ?? {};
  const missing = [];
  const issues = [];
  let done = 0;
  for (const it of items) {
    const rec = dayChecks[it.id];
    if (rec && (rec.status === 'ok' || rec.status === 'issue')) {
      done += 1;
      if (rec.status === 'issue') issues.push({ id: it.id, name: it.name, note: rec.note ?? '' });
    } else {
      missing.push({ id: it.id, name: it.name });
    }
  }
  const total = items.length;
  return { date: dateISO, total, done, missing, issues, rate: total ? done / total : 1 };
}

/** 区间汇总：完成率、异常数、漏检日清单 */
export function rangeStats(dates, items, checks) {
  const byDate = dates.map((d) => dayStatus(d, items, checks));
  const done = byDate.reduce((s, x) => s + x.done, 0);
  const total = byDate.reduce((s, x) => s + x.total, 0);
  const issueCount = byDate.reduce((s, x) => s + x.issues.length, 0);
  const missingDays = byDate
    .filter((x) => x.missing.length > 0)
    .map((x) => ({ date: x.date, missing: x.missing }));
  return { byDate, done, total, rate: total ? done / total : 1, issueCount, missingDays };
}

/**
 * 连续全勤天数：从 todayISOStr 往前逐日数，遇"有缺项"即断。
 * 今天尚未打完不归零此前连胜（改从昨天起算）；datesAsc 为账本中已存在的日期集合。
 */
export function completionStreak(datesAsc, items, checks, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  const set = new Set(datesAsc);
  const isComplete = (d) =>
    set.has(d) && dayStatus(d, items, checks).missing.length === 0;
  let streak = 0;
  let cur = isComplete(todayISOStr) ? todayISOStr : addDays(todayISOStr, -1);
  while (isComplete(cur)) {
    streak += 1;
    cur = addDays(cur, -1);
  }
  return streak;
}

// ---------------------------------------------------------------------------
// 周排查 / 月调度 报告
// ---------------------------------------------------------------------------

/** 报告文本（确定性输出：同输入同输出，供复制/打印与快照比对） */
export function reportText({ store, title, dates, stats, signRole, todayISOStr = todayISO() }) {
  const pct = `${(stats.rate * 100).toFixed(1)}%`;
  const typeLabel = BUSINESS_TYPES[store?.type]?.label ?? '';
  const L = [];
  L.push(`【${title}】`);
  L.push(`门店：${store?.name || '（未设置门店）'}　业态：${typeLabel}${store?.safetyOfficer ? `　食品安全员：${store.safetyOfficer}` : ''}`);
  L.push(`周期：${dates[0]} 至 ${dates[dates.length - 1]}（共 ${dates.length} 天）`);
  L.push(`检查项次：应检 ${stats.total}，完成 ${stats.done}（完成率 ${pct}）`);
  if (stats.issueCount > 0) {
    L.push('异常与整改：');
    for (const d of stats.byDate) {
      for (const i of d.issues) L.push(`· ${d.date} ${i.name}：${i.note || '（未记录整改说明）'}`);
    }
  } else {
    L.push('异常与整改：本周期无异常记录');
  }
  if (stats.missingDays.length > 0) {
    L.push('漏检提示：');
    for (const m of stats.missingDays) {
      L.push(`· ${m.date} 未完成：${m.missing.map((x) => x.name).join('、')}`);
    }
  }
  L.push('');
  L.push(`${signRole}（签字）：____________　日期：____________`);
  L.push(`生成：食安哨 · ${todayISOStr}（本地记录，仅供自查与检查备查，不替代属地监管的法定报送要求）`);
  return L.join('\n');
}

/** 周排查：以 weekOfISO 所在周（周一起算）生成 */
export function weekReport({ store, items, checks, weekOfISO, todayISOStr = todayISO() }) {
  const weekDates = weekDatesOf(weekOfISO);
  const stats = rangeStats(weekDates, items, checks);
  const text = reportText({
    store, title: '每周食品安全排查治理报告', dates: weekDates, stats,
    signRole: store?.safetyOfficer ? '食品安全员' : '食品安全员 / 负责人', todayISOStr,
  });
  return { kind: 'week', dates: weekDates, ...stats, text };
}

/** 月调度：指定年月 */
export function monthReport({ store, items, checks, year, month, todayISOStr = todayISO() }) {
  const dates = monthDatesOf(year, month);
  const stats = rangeStats(dates, items, checks);
  const text = reportText({
    store, title: '每月食品安全调度会议纪要', dates, stats,
    signRole: '主要负责人', todayISOStr,
  });
  return { kind: 'month', dates, ...stats, text };
}

// ---------------------------------------------------------------------------
// 台账导出（文本通道 → 微信粘贴；HTML 通道 → 打印/存 PDF 迎检）
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 台账纯文本版（微信直接粘贴的降级通道） */
export function ledgerText({ store, items, checks, startISO, endISO, todayISOStr = todayISO() }) {
  const dates = rangeDates(startISO, endISO);
  const typeLabel = BUSINESS_TYPES[store?.type]?.label ?? '';
  const L = [];
  L.push(`【食品安全台账】${store?.name || '（未设置门店）'}`);
  L.push(`业态：${typeLabel}　周期：${startISO} 至 ${endISO}（共 ${dates.length} 天）`);
  L.push('');
  for (const d of dates) {
    const st = dayStatus(d, items, checks);
    L.push(`■ ${d}（${st.done}/${st.total}）`);
    for (const it of items) {
      const rec = checks?.[d]?.[it.id];
      const mark = !rec
        ? '未检'
        : rec.status === 'ok'
          ? '正常'
          : `异常${rec.note ? `（${rec.note}）` : ''}`;
      L.push(`  · ${it.name}：${mark}`);
    }
  }
  L.push('');
  L.push('食品安全员（签字）：____________　日期：____________');
  L.push(`生成：食安哨 · ${todayISOStr}（本地记录，仅供自查与检查备查）`);
  return L.join('\n');
}

/** 台账打印版：单文件 HTML（内联样式，无外部资源，可直接打印/存 PDF） */
export function ledgerHtml({ store, items, checks, startISO, endISO, todayISOStr = todayISO() }) {
  const dates = rangeDates(startISO, endISO);
  const e = escapeHtml;
  const typeLabel = e(BUSINESS_TYPES[store?.type]?.label ?? '');
  const head = `<tr><th class="date">日期</th>${items.map((it) => `<th>${e(it.name)}</th>`).join('')}</tr>`;
  const rows = dates.map((d) => {
    const st = dayStatus(d, items, checks);
    const cells = items.map((it) => {
      if (st.missing.some((m) => m.id === it.id)) return '<td class="miss">未检</td>';
      const rec = checks[d][it.id];
      if (rec.status === 'issue') {
        return `<td class="issue">异常${rec.note ? `·${e(rec.note)}` : ''}</td>`;
      }
      return '<td class="ok">✓</td>';
    }).join('');
    return `<tr><td class="date">${d}</td>${cells}</tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>食品安全台账 · ${e(store?.name || '')} ${e(startISO)} ~ ${e(endISO)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f0fdf4; }
  td.date, th.date { white-space: nowrap; width: 88px; }
  td.ok { color: #15803d; text-align: center; }
  td.issue { color: #b91c1c; }
  td.miss { color: #9a3412; background: #fff7ed; }
  .sign { margin-top: 18px; font-size: 13px; }
  .foot { margin-top: 10px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>食品安全台账${store?.name ? ` · ${e(store.name)}` : ''}</h1>
<div class="meta">业态：${typeLabel}${store?.safetyOfficer ? `　食品安全员：${e(store.safetyOfficer)}` : ''}${store?.address ? `　地址：${e(store.address)}` : ''}<br/>周期：${e(startISO)} 至 ${e(endISO)}（共 ${dates.length} 天）</div>
<table>${head}${rows}</table>
<div class="sign">食品安全员（签字）：____________　负责人（签字）：____________　日期：____________</div>
<div class="foot">生成：食安哨 · ${e(todayISOStr)} · 本地记录，仅供自查与检查备查，不替代属地监管的法定报送要求</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 员工健康证预警（从业人员健康管理制度）
// ---------------------------------------------------------------------------

export const SOON_WINDOW_DAYS = 30;

export function certStatus(expiryISO, todayISOStr = todayISO()) {
  const days = daysUntil(expiryISO, todayISOStr);
  if (days < 0) return { level: 'expired', days };
  if (days <= SOON_WINDOW_DAYS) return { level: 'due_soon', days };
  return { level: 'ok', days };
}

/** 需要处理的员工健康证：已过期在前、临期在后，组内按剩余天数升序 */
export function staffWarnings(staff, todayISOStr = todayISO()) {
  const rank = { expired: 0, due_soon: 1 };
  return (staff ?? [])
    .filter((s) => s?.certExpiry)
    .map((s) => ({
      name: s.name || '（未命名员工）',
      expiry: s.certExpiry,
      ...certStatus(s.certExpiry, todayISOStr),
    }))
    .filter((s) => s.level !== 'ok')
    .sort((a, b) => rank[a.level] - rank[b.level] || a.days - b.days);
}

/** 今日待办聚合：漏检项 + 异常项 + 证件预警 */
export function todayAlerts({ dateISO, items, checks, staff, todayISOStr = todayISO() }) {
  const st = dayStatus(dateISO, items, checks);
  return {
    missing: st.missing,
    issues: st.issues,
    certs: staffWarnings(staff, todayISOStr),
    allDone: st.total > 0 && st.missing.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 给老板或合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'foodsentry', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'foodsentry') return { ok: false, error: '不是食安哨的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.store === 'object' && s.store !== null &&
    Array.isArray(s.staff) &&
    Array.isArray(s.customItems) &&
    typeof s.checks === 'object' && s.checks !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
