/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  VEHICLE_KINDS, DUTY_KINDS, HAZARD_SOURCES, HAZARD_SEVERITIES,
  DEFAULT_APPLY_ADVANCE_DAYS, DEFAULT_REEXAM_WARN_DAYS, DEFAULT_PATROL_GAP_DAYS,
  INSPECT_CYCLE_MONTHS,
  dutyRosterState, activeVehicles, activeDrivers,
  inspectState, regState, certState,
  patrolToday, patrolGapDays, weeklyDone, monthlyDone,
  openHazards, openHazardsOf, dutyBoard,
  healthCheck, monthlySummary,
  escapeHtml, todayISO, daysUntil,
} from './core.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// 内联 SVG 图标（stroke: currentColor；零依赖、随主题变色）
// ---------------------------------------------------------------------------

const IC = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  board: IC('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>'),
  station: IC('<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9 21v-4h6v4"/><path d="M12 7.5v3M10.5 9h3"/>'),
  ledger: IC('<path d="M4 20l1.2-4.2L16.6 4.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M13.5 7.5l3 3"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  shield: IC('<path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.3-7 9-4.1-1.7-7-4.7-7-9V5.8z"/><path d="M9 11.8l2.2 2.2L15.4 9.6"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  forklift: IC('<path d="M3 16.5h1.5"/><circle cx="7" cy="17.5" r="2.2"/><circle cx="14.5" cy="17.5" r="2.2"/><path d="M5 15l1.8-6.5H12l1.3 6.7"/><path d="M13.3 14.5h4.2"/><path d="M19.5 5v12.2"/><path d="M17 7.5h5"/>'),
  person: IC('<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.8-3.4 3.4-5.2 6.5-5.2s5.7 1.8 6.5 5.2"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  bell: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  calendar: IC('<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  up: IC('<path d="M12 19V8.5"/><path d="M7.5 13 12 8.5 16.5 13"/><path d="M5 4.5h14"/>'),
  trend: IC('<path d="M3 7.5l5.5 5.5 3.5-3.5L20.5 18"/><path d="M20.5 12.5V18H15"/>'),
  alert: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', due: 'warn', window: 'warn', warn: 'warn', ok: 'ok', never: 'bad', unset: 'bad', none: 'ok' };
const LEVEL_TEXT = { overdue: '逾期', due: '临期', window: '复审窗口', warn: '临期', ok: '正常', never: '从未执行', unset: '未登记', none: '不适用' };

/** 体检分计分环（hero 与报表卡通用，颜色按上下文由 CSS 决定） */
export function scoreRing(score, small = false) {
  const r = 26;
  const c = (2 * Math.PI * r).toFixed(1);
  const off = (2 * Math.PI * r * (1 - score / 100)).toFixed(1);
  const lv = score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'bad';
  return `<svg class="ring${small ? ' ring-sm' : ''}" viewBox="0 0 64 64" role="img" aria-label="账本体检 ${score} 分">
    <circle class="ring-bg" cx="32" cy="32" r="${r}"/>
    <circle class="ring-fg lv-${lv}" cx="32" cy="32" r="${r}" style="stroke-dasharray:${c};stroke-dashoffset:${off}"/>
    <text x="32" y="37.5" text-anchor="middle">${score}</text>
  </svg>`;
}

export function viewOnboarding() {
  return `
  <h2 class="sec">场车（叉车）使用单位，先有一本查得到的账</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>叉车是特种设备里事故最多的类别：2024 年全国场车事故 43 起、死亡 36 人，居各类特种设备之首；结案事故中因使用管理不当的约占 81.36%，违章作业甚至无证上岗是主因。而市场监管总局令第 74 号（2023-05-05 施行）给每一家场车使用单位压上了新担子：依法配备<strong>场车安全总监和场车安全员</strong>并逐台明确负责安全员（第 135/137 条）、安全员<strong>每日巡检形成《每日场车安全检查记录》</strong>——没发现问题也要记录、实行零风险报告（第 142 条）、总监每周排查（第 143 条）、主要负责人每月调度（第 144 条）；日管控周排查月调度已是监督检查的重要内容（第 146 条），未落实拒不改正罚 5000~5 万（第 149 条）。加上叉车定检每 2 年一次、司机 N1 证 4 年复审——<strong>「做了」与「能证明做了」之间没有任何小微级工具。</strong></p>
    <p><strong>叉车账的做法：</strong>单位建档（两员配备）→ 车辆一车一档（使用登记 + 定检钟自动按叉车 2 年/观光车 1 年推导）→ 司机 N1 名册（证钟 + 复审窗口）→ <strong>派工闸</strong>（无证司机、定检过期、未登记、未闭环隐患、当日未打卡的叉车——一样都开不出去）→ 日管控 30 秒打卡（零风险也要报告）→ 周排查/月调度两本法定文书 → 隐患闭环（严重隐患=停用闸）→ 一键出迎检自证包 / 派工单 / 月度小结。</p>
    <div class="row">
      <a class="btn" href="#/station">${icon('station')} 先把单位建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是使用单位自查与应对检查的底账，不替代使用登记、定期检验申报与变更/注销登记；房屋建筑工地、市政工程工地的场车按特设法第 100 条由有关部门监管（74 号令第 2 条排除），本工具面向工厂厂区、物流仓储、旅游景区等场景。数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：三只钟 + 两员 + 日管控 + 隐患 + 停用点名）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.station?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const boxes = [];

  const roster = dutyRosterState(state.station, activeVehicles(state));
  if (roster.level !== 'ok') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('person')}</span><strong>两员配备待补</strong></div><ul><li>${esc(roster.detail)}——去「建档」补登记。</li></ul></div>`);
  }

  const actives = activeVehicles(state);
  const badRegs = actives.filter((v) => ['overdue', 'unset'].includes(regState(v, today).level));
  if (badRegs.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>使用登记缺口（${badRegs.length}）</strong></div>
      <ul>${badRegs.slice(0, 4).map((v) => `<li>${esc(v.plateNo)}——${esc(regState(v, today).detail)}</li>`).join('')}</ul></div>`);
  }

  const overIns = actives.filter((v) => inspectState(v, today, settings.applyAdvanceDays ?? DEFAULT_APPLY_ADVANCE_DAYS).level === 'overdue');
  const dueIns = actives.filter((v) => ['due', 'unset'].includes(inspectState(v, today, settings.applyAdvanceDays ?? DEFAULT_APPLY_ADVANCE_DAYS).level));
  if (overIns.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('forklift')}</span><strong>定检过期停用点名（${overIns.length}）</strong></div>
      <ul>${overIns.slice(0, 4).map((v) => `<li>${esc(v.plateNo)}——定检 ${esc(v.inspectionDueISO)} 已过期，未经定检不得继续使用（特设法第 40 条），先停用并预约检验</li>`).join('')}</ul></div>`);
  } else if (dueIns.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>定检临期（${dueIns.length}）</strong></div>
      <ul>${dueIns.slice(0, 4).map((v) => `<li>${esc(v.plateNo)}——${esc(inspectState(v, today, settings.applyAdvanceDays ?? DEFAULT_APPLY_ADVANCE_DAYS).detail)}</li>`).join('')}</ul></div>`);
  }

  const drivers = activeDrivers(state);
  const badCerts = drivers.filter((d) => ['expired', 'unset'].includes(certState(d, today, settings.reexamWarnDays ?? DEFAULT_REEXAM_WARN_DAYS).level));
  const winCerts = drivers.filter((d) => ['window', 'warn'].includes(certState(d, today, settings.reexamWarnDays ?? DEFAULT_REEXAM_WARN_DAYS).level));
  if (badCerts.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('person')}</span><strong>司机证件失效/缺录（${badCerts.length}）</strong></div>
      <ul>${badCerts.slice(0, 4).map((d) => `<li>${esc(d.name)}——${esc(certState(d, today, settings.reexamWarnDays ?? DEFAULT_REEXAM_WARN_DAYS).detail)}</li>`).join('')}</ul></div>`);
  } else if (winCerts.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('person')}</span><strong>复审窗口（${winCerts.length}）</strong></div>
      <ul>${winCerts.slice(0, 4).map((d) => `<li>${esc(d.name)}——${esc(certState(d, today, settings.reexamWarnDays ?? DEFAULT_REEXAM_WARN_DAYS).detail)}</li>`).join('')}</ul></div>`);
  }

  const pt = patrolToday(state, today);
  if (pt.total > 0 && pt.done < pt.total) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今日日管控缺卡（${pt.total - pt.done} 台，${pt.done}/${pt.total}）</strong></div><ul><li>安全员每日巡检、没发现问题也要记录（零风险报告，74 号令第 142 条）——去「台账」打卡，每台 30 秒。</li></ul></div>`);
  }
  const gap = patrolGapDays(state, today);
  if (gap !== null && gap > (settings.patrolGapDays ?? DEFAULT_PATROL_GAP_DAYS) && pt.done < pt.total) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>日管控已断 ${gap} 天</strong></div><ul><li>日管控是监督检查的重要内容（74 号令第 146 条），断卡是检查现场最尴尬的一问。今天把在场车辆补打卡（补卡如实留痕）。</li></ul></div>`);
  }

  if (!weeklyDone(state, today)) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>本周周排查未记录</strong></div><ul><li>场车安全总监每周至少组织一次风险隐患排查、形成《每周场车安全排查治理报告》（74 号令第 143 条）——去「台账」登记。</li></ul></div>`);
  }
  if (!monthlyDone(state, today)) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>本月月调度未记录</strong></div><ul><li>主要负责人每月至少听取一次汇报、形成《每月场车安全调度会议纪要》（74 号令第 144 条）——去「台账」登记。</li></ul></div>`);
  }

  const open = openHazards(state);
  const seriousOpen = open.filter((h) => h.severity === 'serious');
  if (open.length) {
    boxes.push(`<div class="card alert ${seriousOpen.length ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('bell')}</span><strong>隐患未闭环（${open.length}${seriousOpen.length ? `，其中严重 ${seriousOpen.length}` : ''}）</strong></div>
      <ul>${open.slice(0, 5).map((h) => `<li>${esc(h.plateNo || '公共区域')} · ${esc(h.desc)}——${h.severity === 'serious' ? '严重隐患：车辆应立即停止使用（74 号令第 136 条）' : '先整改、再复查销案'}</li>`).join('')}</ul></div>`);
  }

  const modNoReg = actives.filter((v) => v.modifiedISO && !v.changeRegISO);
  if (modNoReg.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('forklift')}</span><strong>改造后未办变更登记（${modNoReg.length}）</strong></div>
      <ul>${modNoReg.slice(0, 4).map((v) => `<li>${esc(v.plateNo)} 于 ${esc(v.modifiedISO)} 登记改造——办妥变更使用登记前不得继续使用（特设法第 47 条）</li>`).join('')}</ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>两员齐、登记全、定检在期、证照在期、日管控打满、周排查月调度在账、隐患全闭环——继续保持，打卡别断。</li></ul></div>`);
  }

  // hero：体检计分环 + 三只芯片 + 本月计数
  const hc = healthCheck(state, today, settings);
  const sum = monthlySummary(state, today.slice(0, 7), today);
  const insChip = overIns.length
    ? { cls: 'bad', big: `超期${overIns.length}`, sub: '未经定检不得使用' }
    : dueIns.length
      ? { cls: 'warn', big: `临期${dueIns.length}`, sub: '届满前 1 个月申报' }
      : { cls: 'ok', big: '全部在期', sub: actives.length ? `叉车 2 年/观光车 1 年` : '暂无在用车辆' };
  const certChip = badCerts.length
    ? { cls: 'bad', big: `失效${badCerts.length}`, sub: '无证作业 1 万~5 万' }
    : winCerts.length
      ? { cls: 'warn', big: `复审${winCerts.length}`, sub: '届满前 1 个月申请' }
      : { cls: 'ok', big: drivers.length ? '证照在期' : '无司机', sub: drivers.length ? 'N1 证 4 年有效' : '先登记司机名册' };
  const patrolChip = pt.total === 0
    ? { cls: 'warn', big: '无对象', sub: '先给场车建档' }
    : pt.done < pt.total
      ? { cls: pt.done === 0 ? 'bad' : 'warn', big: `${pt.done}/${pt.total}`, sub: '零风险也要报告' }
      : { cls: 'ok', big: '已打满', sub: `${pt.done}/${pt.total} 台今日巡检` };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · 在用场车 ${actives.length} 台 · 在册司机 ${drivers.length} 人</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${insChip.cls}"><span class="chip-label">定检钟</span><span class="chip-big">${esc(insChip.big)}</span><span class="chip-sub">${esc(insChip.sub)}</span></div>
        <div class="chip ${certChip.cls}"><span class="chip-label">N1 证钟</span><span class="chip-big">${esc(certChip.big)}</span><span class="chip-sub">${esc(certChip.sub)}</span></div>
        <div class="chip ${patrolChip.cls}"><span class="chip-label">日管控</span><span class="chip-big">${esc(patrolChip.big)}</span><span class="chip-sub">${esc(patrolChip.sub)}</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${sum.orders}</b><span>本月派工</span></div>
      <div class="stat"><b>${sum.patrols}</b><span>本月巡检打卡</span></div>
      <div class="stat"><b>${sum.score}</b><span>体检得分</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/ledger">去打卡/派工</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 建档（单位 + 两员 + 车辆一车一档 + 司机名册 + 周期义务）
// ---------------------------------------------------------------------------

export function viewStation(state) {
  const s = state.station ?? {};
  const today = todayISO();
  const settings = state.settings ?? {};
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;

  const vehicleRows = (state.vehicles ?? []).map((v) => {
    const ins = inspectState(v, today, settings.applyAdvanceDays ?? DEFAULT_APPLY_ADVANCE_DAYS);
    const rg = regState(v, today);
    const hz = openHazardsOf(state, v.id).length;
    return `<tr class="${v.scrappedISO ? 'muted' : ''}">
    <td>${esc(v.plateNo)}<br><span class="basis">${esc(VEHICLE_KINDS[v.kind] ?? v.kind)}${v.monitor ? ' · 监控装置' : ''}</span></td>
    <td>${esc(v.regNo || '—')}<br><span class="basis">${esc(rg.detail)}</span></td>
    <td>${esc(v.inspectionDueISO || '—')}<br><span class="basis">${esc(ins.detail).slice(0, 42)}</span></td>
    <td>${esc(v.keeperName || '—')}${hz ? `<br><span class="pill bad">隐患 ${hz}</span>` : ''}</td>
    <td>${v.scrappedISO ? `<span class="pill bad">已报废${v.cancelISO ? '·已注销' : '·未注销'}</span>` : (v.modifiedISO && !v.changeRegISO ? '<span class="pill warn">待变更登记</span>' : '<span class="pill ok">在用</span>')}</td>
    <td class="ops">
      <button class="btn small ghost" data-action="show-inspect-pass" data-idx="${v.id}">定检合格</button>
      <button class="btn small ghost" data-action="show-modify" data-idx="${v.id}">改造</button>
      <button class="btn small ghost" data-action="show-scrap" data-idx="${v.id}">报废</button>
      <button class="btn small ghost" data-action="del-vehicle" data-idx="${v.id}">删</button>
    </td>
  </tr>`;
  }).join('');

  const driverRows = (state.drivers ?? []).map((d) => {
    const cs = certState(d, today, settings.reexamWarnDays ?? DEFAULT_REEXAM_WARN_DAYS);
    return `<tr class="${d.active ? '' : 'muted'}">
    <td>${esc(d.name)}</td><td>${esc(d.certNo)}</td>
    <td>${esc(d.expiryISO || '—')}<br><span class="basis">${esc(cs.detail)}</span></td>
    <td><span class="pill ${LEVEL_PILL[cs.level] ?? ''}">${LEVEL_TEXT[cs.level] ?? cs.level}</span></td>
    <td><button class="btn small ghost" data-action="toggle-driver" data-idx="${d.id}">${d.active ? '停用' : '恢复'}</button></td>
  </tr>`;
  }).join('');

  const year = Number(today.slice(0, 4));

  return `
  <h2 class="sec">使用单位建档与「两员」配备（74 号令第 135/137 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>单位名称 *<input id="st-name" value="${esc(s.name ?? '')}" placeholder="如：XX市城东云仓物流有限公司" /></label>
      <label>主要负责人<input id="st-manager" value="${esc(s.manager ?? '')}" placeholder="对场车使用安全全面负责" /></label>
      <label>电话<input id="st-phone" value="${esc(s.phone ?? '')}" /></label>
      <label class="span2">地址<input id="st-address" value="${esc(s.address ?? '')}" placeholder="厂区/园区/景区地址" /></label>
      <label>场车安全总监 *<input id="st-director" value="${esc(s.directorName ?? '')}" placeholder="管理层中负责场车使用安全" /></label>
      <label>总监电话<input id="st-director-phone" value="${esc(s.directorPhone ?? '')}" /></label>
      <label>场车安全员（牵头） *<input id="st-officer" value="${esc(s.officerName ?? '')}" placeholder="具体负责巡检检查" /></label>
      <label>安全员电话<input id="st-officer-phone" value="${esc(s.officerPhone ?? '')}" /></label>
      <label class="span2">备注<input id="st-note" value="${esc(s.note ?? '')}" placeholder="安全管理制度/操作规程建立情况（可空）" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-station">保存单位信息</button>
      <span class="stats-line">两员&nbsp;${pill(dutyRosterState(s, activeVehicles(state)).level)}&nbsp;<span class="basis" style="display:inline">${esc(dutyRosterState(s, activeVehicles(state)).detail)}</span></span>
    </div>
    <p class="fine">场车安全总监与场车安全员依法配备、明确岗位职责，按场车数量与用途配足安全员并逐台明确负责（74 号令第 135/137 条）；未建制度或未配备/培训/考核「两员」，拒不改正罚 5000~5 万并纳入信用公示，责任人 2000~1 万（第 149 条）。</p>
  </div>

  <h2 class="sec">车辆一车一档（登记 + 定检钟）</h2>
  <div class="card">
    <div class="form-grid">
      <label>车牌/设备编号 *<input id="vh-plate" placeholder="如：场内 A-1024 / 叉车 03" /></label>
      <label>品种 *
        <select id="vh-kind"><option value="forklift">叉车（机动工业车辆）</option><option value="sightseeing">非公路用旅游观光车辆</option></select>
      </label>
      <label>品牌型号<input id="vh-brand" placeholder="如：合力 K30 / 杭叉 3t" /></label>
      <label>使用登记证号<input id="vh-regno" placeholder="如：特设登记 场2026-xxxx" /></label>
      <label>投入使用日<input id="vh-firstuse" type="date" placeholder="未登记证号时按此算 30 日登记钟" /></label>
      <label>最近定检合格日<input id="vh-lastinspect" type="date" placeholder="按检验报告填写，自动推导下次到期" /></label>
      <label>逐台负责安全员<input id="vh-keeper" placeholder="74 号令第 137 条：逐台明确" /></label>
      <label>安全监控装置
        <select id="vh-monitor"><option value="no">无/不适用（2023-12-01 前出厂）</option><option value="yes">有（新车已装）</option></select>
      </label>
      <label>产权
        <select id="vh-owner"><option value="own">自有</option><option value="leased">租赁</option></select>
      </label>
      <label class="span2">备注<input id="vh-note" placeholder="电池/甲醇/属具等（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-vehicle">建档</button><span class="basis">投入使用前或后 30 日内办理使用登记（特设法第 33 条，未登记罚 1 万~10 万第 83 条）；定检周期叉车 2 年/观光车 1 年（TSG 81—2022），未经定检不得继续使用（第 40 条）</span></div>
    <div class="tbl"><table class="plain"><tr><th>车辆</th><th>使用登记</th><th>定检有效期至</th><th>负责安全员</th><th>状态</th><th></th></tr>${vehicleRows || '<tr><td colspan="6">还没有场车建档——从第一台开始</td></tr>'}</table></div>
    <p class="fine">最近定检合格日填入后自动按品种推导下次到期日（精确到月、月末钳制）；检验合格后点「定检合格」录合格日，定检钟自动滚动。改造/重大修理后点「改造」登记，办妥变更使用登记前派工闸不放行（特设法第 47 条）。</p>
  </div>

  <h2 class="sec">作业人员名册（叉车司机 N1 证钟）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名 *<input id="dr-name" placeholder="如：王铁柱" /></label>
      <label>N1 证号 *<input id="dr-certno" placeholder="特种设备安全管理和作业人员证（叉车司机 N1）" /></label>
      <label>有效期至<input id="dr-expiry" type="date" placeholder="证载有效期，4 年一复审" /></label>
      <label>电话<input id="dr-phone" /></label>
      <label class="span2">备注<input id="dr-note" placeholder="发证机关/复审记录（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-driver">加入名册</button><span class="basis">特种设备作业人员应取得相应资格方可作业（特设法第 14 条），使用无证人员作业罚 1 万~5 万（第 86 条）；复审申请应在有效期届满 1 个月以前提出（TSG Z6001—2019），逾期未复审证书失效须重考</span></div>
    <div class="tbl"><table class="plain"><tr><th>姓名</th><th>N1 证号</th><th>有效期至</th><th>证钟</th><th></th></tr>${driverRows || '<tr><td colspan="5">名册为空——先登记持证司机</td></tr>'}</table></div>
    <p class="fine">离职司机「停用」不删除：历史派工单仍可回溯到人；停用后派工闸直接拒绝。</p>
  </div>

  <h2 class="sec">周期义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)} · ${v.cycleDays}天</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="培训对象/演练科目（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="set-duty">登记完成</button></div>
    ${(() => {
    const rows = dutyBoard(state, today).map((d) => {
      const lv = d.level === 'never' ? 'never' : d.level;
      const next = d.level === 'never' ? '从未执行' : `${esc(d.nextDue)}（${d.daysLeft < 0 ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}）`;
      return `<tr class="${lv === 'never' || lv === 'overdue' ? 'muted' : ''}"><td>${esc(d.label)}</td><td>${d.lastDoneISO ? esc(d.lastDoneISO) : '—'}</td><td>${next}</td><td><span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span></td><td class="basis w"><span>${esc(d.basis)}</span></td></tr>`;
    }).join('');
    return `<div class="tbl"><table class="plain"><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${rows || '<tr><td colspan="5">尚未登记——从年度培训开始记</td></tr>'}</table></div>`;
  })()}
    <p class="fine">周期为参数化默认值（培训/演练 365 天、清单评审 180 天），属地要求与监管部门制度永远赢。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 台账（日管控打卡 / 周排查 / 月调度 / 派工闸 / 隐患闭环）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;
  const settings = state.settings ?? {};

  const vehicleOptions = activeVehicles(state).map((v) => `<option value="${e(v.id)}">${e(v.plateNo)}</option>`).join('');
  const driverOptions = activeDrivers(state).map((d) => `<option value="${e(d.id)}">${e(d.name)}</option>`).join('');
  const officer = state.station?.officerName || '';
  const director = state.station?.directorName || '';

  const patrols = [...(state.patrols ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 24);
  const ptRows = patrols.map((p) => `<tr class="${p.result === 'found' ? 'muted' : ''}">
    <td>${e(p.dateISO)}</td><td>${e(p.plateNo)}</td><td>${e(p.checkerName)}</td>
    <td class="w"><span>${p.result === 'found' ? `${e(p.findings)}${p.action ? ` · 处置：${e(p.action)}` : ''}` : '零风险报告'}</span></td>
    <td><button class="btn small ghost" data-action="del-patrol" data-idx="${p.id}">删</button></td>
  </tr>`).join('');

  const weeklies = [...(state.weeklies ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 8);
  const wkRows = weeklies.map((w) => `<tr>
    <td>${e(w.weekKey)}</td><td>${e(w.dateISO)}</td><td>${e(w.hostName)}</td>
    <td class="w"><span>${e(w.content)}${w.issues ? `<br><span class="basis">问题：${e(w.issues)}</span>` : ''}</span></td>
  </tr>`).join('');

  const monthlies = [...(state.monthlies ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 6);
  const moRows = monthlies.map((m) => `<tr>
    <td>${e(m.monthKey)}</td><td>${e(m.dateISO)}</td><td>${e(m.hostName)}</td>
    <td class="w"><span>${e(m.content)}</span></td>
  </tr>`).join('');

  const orders = [...(state.workOrders ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const woRows = orders.map((w) => `<tr>
    <td>${e(w.dateISO)}<br><span class="basis">${w.shift === 'am' ? '白班' : w.shift === 'pm' ? '中班' : e(w.shift)}</span></td>
    <td>${e(w.plateNo)}</td><td>${e(w.driverName)}</td>
    <td class="w"><span>${e(w.task || '—')}</span></td>
    <td class="ops">
      <button class="btn small ghost" data-action="dispatch-print" data-idx="${w.id}">派工单</button>
      <button class="btn small ghost" data-action="del-workorder" data-idx="${w.id}">删</button>
    </td>
  </tr>`).join('');

  const hazards = [...(state.hazards ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const ST = { open: ['未整改', 'bad'], fixed: ['待复查', 'warn'], closed: ['已闭环', 'ok'] };
  const hzRows = hazards.map((h) => `<tr class="${h.status !== 'closed' ? 'muted' : ''}">
    <td>${e(h.dateISO)}</td><td>${e(h.plateNo || '—')}</td><td>${e(HAZARD_SOURCES[h.source] ?? h.source)}<br><span class="basis">${e(HAZARD_SEVERITIES[h.severity] ?? h.severity)}</span></td>
    <td class="w"><span>${e(h.desc)}</span></td>
    <td>${h.status === 'open' ? '<strong>未整改</strong>' : `${e(h.actionISO || '—')}<br><span class="basis">${e(h.action || '')}</span>`}</td>
    <td><span class="pill ${ST[h.status]?.[1] ?? ''}">${ST[h.status]?.[0] ?? h.status}</span></td>
    <td class="ops">${h.status === 'open' ? `<button class="btn small" data-action="show-fix-hazard" data-idx="${h.id}">整改</button>` : h.status === 'fixed' ? `<button class="btn small" data-action="show-close-hazard" data-idx="${h.id}">复查销案</button>` : ''}</td>
  </tr>`).join('');

  const todayCount = patrolToday(state, today);

  return `
  <h2 class="sec">日管控巡检打卡（74 号令第 142 条：每日巡检、零风险也要报告）</h2>
  <div class="card">
    <div class="row" style="margin-top:0"><span class="basis">今日进度：${todayCount.done}/${todayCount.total} 台已打卡</span></div>
    <div class="form-grid">
      <label>日期<input id="pt-date" type="date" value="${e(today)}" /></label>
      <label>车辆（从一车一档选）<select id="pt-vehicle">${vehicleOptions || '<option value="">先去「建档」登记场车</option>'}</select></label>
      <label>巡检人（场车安全员）<input id="pt-checker" value="${e(officer)}" placeholder="逐台安全员或牵头安全员" /></label>
      <label>巡检结论
        <select id="pt-result"><option value="ok">无异常（零风险报告）</option><option value="found">发现隐患</option></select>
      </label>
      <label class="span2">异常部位与情况（发现隐患必填）<input id="pt-findings" placeholder="如：右侧货叉根部裂纹 / 制动偏软" /></label>
      <label class="span2">当场处置（发现隐患必填）<input id="pt-action" placeholder="如：立即停用并挂警示牌，报安全总监" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-patrol">打卡</button><span class="basis">检查清单参考：制动/转向/货叉与链条/喇叭灯光/轮胎/安全监控装置——发现隐患自动挂入闭环；严重隐患立即停用并报告（74 号令第 136 条）</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>车号</th><th>巡检人</th><th>结论</th><th></th></tr>${ptRows || '<tr><td colspan="5">还没有巡检打卡——今天第一笔</td></tr>'}</table></div>
  </div>

  <h2 class="sec">派工闸（带病叉车开不出去：证/车/检/患/卡五道闸）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="wo-date" type="date" value="${e(today)}" /></label>
      <label>班次<select id="wo-shift"><option value="am">白班</option><option value="pm">中班</option></select></label>
      <label>车辆<select id="wo-vehicle">${vehicleOptions || '<option value="">先建档场车</option>'}</select></label>
      <label>司机<select id="wo-driver">${driverOptions || '<option value="">先登记司机名册</option>'}</select></label>
      <label class="span2">任务<input id="wo-task" placeholder="如：3 号库月台卸货 / 成品转运" /></label>
      <label class="span2">备注<input id="wo-note" placeholder="可空" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-workorder">派工</button><span class="basis">闸机核对：司机持证在期（特设法第 14/86 条）→ 车辆已登记（第 33 条）→ 定检在期（第 40 条）→ 无未闭环隐患、严重隐患停用（74 号令第 136 条）→ 当日已打卡（第 142 条）——任一不过，当场拦截</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期/班次</th><th>车号</th><th>司机</th><th>任务</th><th></th></tr>${woRows || '<tr><td colspan="5">还没有派工记录</td></tr>'}</table></div>
  </div>

  <h2 class="sec">周排查（74 号令第 143 条：总监每周至少一次）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="wk-date" type="date" value="${e(today)}" /></label>
      <label>主持人（场车安全总监）<input id="wk-host" value="${e(director)}" placeholder="总监署名" /></label>
      <label class="span2">排查内容 *<input id="wk-content" placeholder="如：全厂叉车通道/限速标志/充电区检查，复核本周巡检异常" /></label>
      <label class="span2">发现问题<input id="wk-issues" placeholder="可空；有隐患请同时到下方登记闭环" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-weekly">登记周排查</button></div>
    <div class="tbl"><table class="plain"><tr><th>周次</th><th>日期</th><th>主持人</th><th>内容</th></tr>${wkRows || '<tr><td colspan="4">还没有周排查记录</td></tr>'}</table></div>
  </div>

  <h2 class="sec">月调度（74 号令第 144 条：主要负责人每月至少听取一次）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="mo-date" type="date" value="${e(today)}" /></label>
      <label>主持人（主要负责人）<input id="mo-host" value="${e(state.station?.manager || '')}" placeholder="单位主要负责人署名" /></label>
      <label class="span2">调度内容 *<input id="mo-content" placeholder="如：听取本月场车安全汇报，下月重点推进 2 台叉车定检" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-monthly">登记月调度</button></div>
    <div class="tbl"><table class="plain"><tr><th>月份</th><th>日期</th><th>主持人</th><th>内容</th></tr>${moRows || '<tr><td colspan="4">还没有月调度记录</td></tr>'}</table></div>
  </div>

  <h2 class="sec">隐患闭环（一般隐患立即处理 · 严重隐患立即停用——74 号令第 136 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日<input id="hz-date" type="date" value="${e(today)}" /></label>
      <label>涉及车辆<select id="hz-vehicle"><option value="">不涉及具体车辆（区域/制度类）</option>${vehicleOptions}</select></label>
      <label>来源<select id="hz-source">${Object.entries(HAZARD_SOURCES).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join('')}</select></label>
      <label>程度<select id="hz-severity"><option value="general">一般事故隐患</option><option value="serious">严重事故隐患（车辆立即停用）</option></select></label>
      <label class="span2">描述 *<input id="hz-desc" placeholder="如：充电区灭火器缺失 / 2 号叉车制动管渗油" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-hazard">登记隐患</button><span class="basis">闭环状态机：登记 → 整改（措施+完成日）→ 复查销案（复查人+复查日）；跳级拒绝。日管控「发现隐患」会自动在这里挂出一条</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>车号</th><th>来源/程度</th><th>描述</th><th>整改</th><th>状态</th><th></th></tr>${hzRows || '<tr><td colspan="7">还没有隐患登记（无事即最好的事）</td></tr>'}</table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 体检 / 出证三通道）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const e = esc;
  const orderOptions = [...(state.workOrders ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((w) => `<option value="${e(w.id)}">${e(w.dateISO)} ${e(w.plateNo)} · ${e(w.driverName)}</option>`).join('');

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到管理群存档或报主要负责人——含派工/日管控/周排查月调度/隐患/证照定检点名/体检七段与法条口径尾注。</p>'}
  </div>

  <h2 class="sec">账本体检（${healthCheck(state, today, state.settings ?? {}).items.length} 项）</h2>
  <div class="card">
    ${(() => {
    const hc = healthCheck(state, today, state.settings ?? {});
    const rows = hc.items.map((i) => `<tr class="${i.level === 'bad' ? 'muted' : ''}">
        <td>${esc(i.label)}</td><td><span class="pill ${LEVEL_PILL[i.level] ?? ''}">${i.level === 'bad' ? '红' : i.level === 'warn' ? '黄' : '绿'}</span></td><td class="w w3"><span>${esc(i.detail)}</span></td>
      </tr>`).join('');
    return `<div class="row" style="margin:0 0 10px">${scoreRing(hc.score, true)}<div class="progress-text"><strong>${hc.score} 分</strong>（红 ${hc.bad} · 黄 ${hc.warn}）</div></div><div class="tbl"><table class="plain"><tr><th>项目</th><th>灯</th><th>说明</th></tr>${rows}</table></div>`;
  })()}
  </div>

  <h2 class="sec">出证（三通道）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="inspect-download">${icon('dl')} 迎检自证包（HTML）</button>
      <button class="btn ghost" data-action="inspect-print">${icon('print')} 迎检自证包（打印）</button>
    </div>
    <p class="fine">单文件含：两员配备、场车一车一档、司机证照、日管控近 30 天、周排查、月调度、隐患闭环、派工台账、培训与预案——对口 74 号令第 146 条监督检查重要内容与特设法第 35 条档案五项，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>派工单<select id="case-order">${orderOptions || '<option value="">先在台账派工</option>'}</select></label>
      <button class="btn" data-action="dispatch-download" ${orderOptions ? '' : 'disabled'}>${icon('dl')} 派工单（合规核对版）</button>
    </div>
    <p class="fine">按单打印：派工要素 + 落账时闸机核对快照 + 班前告知栏 + 三方签字——车队现场与检查备查两用。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  return `
  <h2 class="sec">参数（属地规则与监管部门要求永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>定检临期提醒（天）<input id="set-apply" type="number" min="7" max="120" value="${s.applyAdvanceDays ?? DEFAULT_APPLY_ADVANCE_DAYS}" /></label>
      <label>证照临期提醒（天）<input id="set-reexam" type="number" min="15" max="180" value="${s.reexamWarnDays ?? DEFAULT_REEXAM_WARN_DAYS}" /></label>
      <label>日管控断卡红线（天）<input id="set-patrolgap" type="number" min="1" max="7" value="${s.patrolGapDays ?? DEFAULT_PATROL_GAP_DAYS}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">定检法定申报窗口=检验合格有效期届满前 1 个月（特设法第 40 条）、N1 复审申请窗口=有效期届满 1 个月以前（TSG Z6001—2019）——提醒天数只是产品口径，可以调早，别调晚过法定窗口；定检周期法定（叉车 2 年/观光车 1 年，TSG 81—2022）不可调。</p>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与使用记录；司机姓名与证号也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例单位（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 派工闸拦截（无证/未打卡）→ 日管控打卡 → 周排查月调度 → 隐患闭环 → 三通道出证。</p>
  </div>`;
}
