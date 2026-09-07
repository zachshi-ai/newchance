/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  VENUE_TYPES, PATROL_MODES, PATROL_SLOTS, PATROL_ITEMS, CLOSE_CHECK_NOTE,
  EXT_TYPES, HAZARD_SOURCES, NOTICE_SOURCES, CHECK_ITEMS, TRAIN_KINDS,
  DEFAULT_GAP_DAYS, DEFAULT_CHECK_DAYS,
  venueOf, precheckState, mixedState, trainingMonths, drillMonths, extCheckDays,
  extClocks, extCheckClock, patrolGapDays, patrolAbnormals,
  monthlyCheckClock, openHazards, hazardRisk, dutyBoard, healthCheck, monthlySummary,
  escapeHtml, todayISO,
} from './core.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// 内联 SVG 图标（stroke: currentColor；零依赖、随主题变色）
// ---------------------------------------------------------------------------

const IC = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  board: IC('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>'),
  store: IC('<path d="M4 10v10h16V10"/><path d="M3 10l2-5h14l2 5"/><path d="M3 10h18"/><path d="M10 20v-5h4v5"/>'),
  ledger: IC('<path d="M4 20l1.2-4.2L16.6 4.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M13.5 7.5l3 3"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  shield: IC('<path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.3-7 9-4.1-1.7-7-4.7-7-9V5.8z"/><path d="M9 11.8l2.2 2.2L15.4 9.6"/>'),
  flame: IC('<path d="M12 3c1 3-4 5-4 9a4 4 0 0 0 8 0c0-1.5-.6-2.6-1.4-3.6C13.7 9.9 13 11 12 11c-1.6 0-.9-3.2 0-8z"/><path d="M12 21a7 7 0 0 1-7-7c0-2 .8-3.8 2-5.2"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  ext: IC('<rect x="8" y="4" width="8" height="13" rx="3"/><path d="M10 4V2.8h4V4"/><path d="M16 7l3-2M8 10H5.5"/><path d="M12 17v3"/>'),
  alert: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  calendar: IC('<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>'),
  trend: IC('<path d="M3 7.5l5.5 5.5 3.5-3.5L20.5 18"/><path d="M20.5 12.5V18H15"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  up: IC('<path d="M12 19V8.5"/><path d="M7.5 13 12 8.5 16.5 13"/><path d="M5 4.5h14"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', due: 'warn', ok: 'ok', never: 'bad', unset: 'bad', na: 'ok', red: 'bad', warn: 'warn' };
const LEVEL_TEXT = { overdue: '逾期', due: '临期', ok: '正常', never: '从未', unset: '未登记', na: '不涉及', red: '未许可', warn: '在办' };

/** 体检分计分环（暗色 hero 与报表页通用） */
export function scoreRing(score, small = false) {
  const r = 26;
  const c = (2 * Math.PI * r).toFixed(1);
  const off = (2 * Math.PI * r * (1 - score / 100)).toFixed(1);
  const col = score >= 85 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  return `<svg class="ring${small ? ' ring-sm' : ''}" viewBox="0 0 64 64" role="img" aria-label="账本体检 ${score} 分">
    <circle class="ring-bg" cx="32" cy="32" r="${r}"/>
    <circle class="ring-fg" cx="32" cy="32" r="${r}" style="stroke:${col};stroke-dasharray:${c};stroke-dashoffset:${off}"/>
    <text x="32" y="37.5" text-anchor="middle">${score}</text>
  </svg>`;
}

export function daysBetween(aISO, bISO) {
  return Math.round((new Date(`${bISO}T00:00:00Z`) - new Date(`${aISO}T00:00:00Z`)) / 86400000);
}

export function viewOnboarding() {
  return `
  <h2 class="sec">小场所，先有一本查得到的消防账</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>九小场所与小微公众聚集场所站在消防监管的最末端：灭火器要按月（人员密集每半月）检查、到期报废送修；宾馆/商场/公共娱乐场所营业期间每 2 小时巡查、每月防火检查（三类重点场所整治指南）；公众聚集场所要营业前消防安全检查（消防法第 15 条，未经许可不得营业）；隐患被通知改正后不消除，直接触发第 60 条第（七）项 5000~5 万元罚款；"三合一"未分隔是第 61 条停产停业级风险。2024 年全国接报火灾 90.8 万起、亡 2001 人（国家消防救援局）——派出所每年至少上门检查一次（消防监督检查规定第 30 条），查的就是这些记录。</p>
    <p><strong>防火单的做法：</strong>场所建档（类型自动判定巡查频次与检查周期）→ 灭火器逐具上双钟（报废钟 + 送修钟）→ 每天 30 秒巡查打卡（异常必写处置）→ 每月一次八查防火检查 → 隐患登记-整改-复查销案（通知类带文书编号）→ 培训演练到期自动点名 → 一键出迎检自证包 / 月度小结 / 隐患整改单。</p>
    <div class="row">
      <a class="btn" href="#/place">${icon('store')} 先把场所建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是场所自查与迎检的底账，不碰消防设施检测报告、不替代营业前行政许可；数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：体检环 + 器材钟 + 巡查 + 隐患 + 培训演练 + 三合一/营业前点名）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.place?.name) return viewOnboarding();
  const today = todayISO();
  const place = state.place;
  const v = venueOf(place);
  const settings = state.settings ?? {};
  const interval = settings.extCheckDays > 0 ? settings.extCheckDays : extCheckDays(place);
  const boxes = [];

  const pc = precheckState(place);
  if (pc.level === 'red') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>营业前消防安全检查未办理</strong></div><ul><li>场所属公众聚集场所（${esc(v.label)}），未经消防救援机构许可<strong>不得投入使用、营业</strong>（消防法第 15 条）。已办的，去「场所」登记许可/承诺凭证。</li></ul></div>`);
  } else if (pc.level === 'warn') {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>告知承诺待核查</strong></div><ul><li>${esc(pc.detail)}——核查前保持台账在续，别让承诺落空。</li></ul></div>`);
  }

  const mixed = mixedState(place);
  if (mixed.level === 'red') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('alert')}</span><strong>三合一风险：经营住人未分隔</strong></div><ul><li>${esc(mixed.detail)}。整治指南将"三合一"列为头号清理对象——要么人搬走，要么分隔 + 独立出口，去「场所」更新自查结论。</li></ul></div>`);
  } else if (mixed.level === 'warn') {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('alert')}</span><strong>经营与住人同建筑（已分隔）</strong></div><ul><li>已分隔 + 独立出口是底线，每月防火检查的第 5 查盯的就是它别回潮。</li></ul></div>`);
  }

  const exts = state.extinguishers ?? [];
  const scrapBad = exts.filter((e) => extClocks(e, today).scrap.level === 'overdue');
  const svcBad = exts.filter((e) => extClocks(e, today).service.level === 'overdue');
  if (scrapBad.length || svcBad.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('ext')}</span><strong>灭火器${scrapBad.length ? ` ${scrapBad.length} 具到报废年限` : ''}${scrapBad.length && svcBad.length ? '，' : ''}${svcBad.length ? ` ${svcBad.length} 具送修超期` : ''}</strong></div>
      <ul>${scrapBad.map((e) => `<li>${esc(e.no || '无编号')}（${esc(EXT_TYPES[e.type].label)}，出厂 ${esc(e.madeISO)}）：报废日 ${esc(extClocks(e, today).scrap.dueISO)} 已到——<strong>停用更换</strong>，继续摆放 = 第 60 条"未保持完好有效"的罚款对象</li>`).join('')}
      ${svcBad.map((e) => `<li>${esc(e.no || '无编号')}（${esc(EXT_TYPES[e.type].label)}）：应送修 ${esc(extClocks(e, today).service.dueISO)}——送修后回台账登记，周期重算</li>`).join('')}</ul></div>`);
  }

  const neverChecked = exts.filter((e) => extCheckClock(state, e, today, interval).level === 'never');
  const overChecked = exts.filter((e) => extCheckClock(state, e, today, interval).level === 'overdue');
  if (neverChecked.length || overChecked.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>灭火器月检缺口（${neverChecked.length + overChecked.length} 具）</strong></div>
      <ul>${neverChecked.slice(0, 4).map((e) => `<li>${esc(e.no || '无编号')}（${esc(e.location || '未填位置')}）：从未月检——GB 50444 月检口径，人员密集场所每半月一次</li>`).join('')}
      ${overChecked.slice(0, 4).map((e) => `<li>${esc(e.no || '无编号')}（${esc(e.location || '未填位置')}）：应检 ${esc(extCheckClock(state, e, today, interval).dueISO)}，已超 ${-extCheckClock(state, e, today, interval).daysLeft} 天</li>`).join('')}
      </ul><p class="fine">去「台账」逐具落月检：压力表绿区/铅封/外观/位置四项，30 秒一具。</p></div>`);
  }

  const gap = patrolGapDays(state, today);
  if (gap !== null && gap > (settings.gapDays ?? DEFAULT_GAP_DAYS)) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>防火巡查已断更 ${gap} 天</strong></div><ul><li>本场所巡查口径：${esc(PATROL_MODES[v.patrol])}。断更是检查现场最尴尬的一问——今天补一笔，30 秒。</li></ul></div>`);
  }

  const risk = hazardRisk(state, today);
  if (risk.open) {
    boxes.push(`<div class="card alert ${risk.noticeOpen || risk.overdue ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('alert')}</span><strong>隐患未销案 ${risk.open} 条${risk.noticeOpen ? `（含通知类 ${risk.noticeOpen}）` : ''}${risk.overdue ? `，超期 ${risk.overdue} 条` : ''}</strong></div>
      <ul>${openHazards(state, today).slice(0, 5).map((h) => `<li>${esc(h.dateISO)} ${esc(h.location || '—')} · ${esc(h.desc)}${h.dueISO ? ` · 期限 ${esc(h.dueISO)}` : ''}${h.closedISO ? '' : '——整改后去「台账」复查销案'}</li>`).join('')}</ul>
      ${risk.noticeOpen ? '<p class="fine">消防救援机构/派出所通知类隐患不销案，就是消防法第 60 条第（七）项"通知后不消除"的直接罚款敞口。</p>' : ''}</div>`);
  }

  const duties = dutyBoard(state, place, today).filter((d) => d.level === 'overdue' || d.level === 'never' || d.level === 'due');
  if (duties.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>培训演练点名</strong></div>
      <ul>${duties.map((d) => `<li>${esc(d.label)}：${d.level === 'never' ? '从未开展' : d.level === 'overdue' ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}（依据：${esc(d.basis)}）</li>`).join('')}</ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>器材双钟在期、月检无缺口、巡查在续、隐患全销案、培训演练在期——继续保持，巡查别断。</li></ul></div>`);
  }

  // hero：体检计分环 + 三只钟 + 本月计数
  const hc = healthCheck(state, today, settings);
  const abn = patrolAbnormals(state);
  const pcChip = pc.level === 'ok' ? { cls: 'ok', big: '已许可', sub: '营业前检查在档' }
    : pc.level === 'warn' ? { cls: 'warn', big: '待核查', sub: '告知承诺在办' }
      : pc.level === 'na' ? { cls: 'ok', big: '不涉及', sub: '非公众聚集场所' }
        : { cls: 'bad', big: '未许可', sub: '不得投入使用营业' };
  const extChip = scrapBad.length || svcBad.length ? { cls: 'bad', big: `${scrapBad.length + svcBad.length} 具超期`, sub: '报废/送修须处理' }
    : (neverChecked.length || overChecked.length) ? { cls: 'warn', big: `缺检 ${neverChecked.length + overChecked.length} 具`, sub: `月检 ${interval} 天口径` }
      : { cls: 'ok', big: `${exts.length} 具在期`, sub: `月检 ${interval} 天口径` };
  const hzChip = !risk.open ? { cls: 'ok', big: '0 挂账', sub: '隐患全部销案' }
    : risk.noticeOpen || risk.overdue ? { cls: 'bad', big: `${risk.open} 条未销`, sub: risk.overdue ? `${risk.overdue} 条超期限` : '通知类须闭环' }
      : { cls: 'warn', big: `${risk.open} 条在改`, sub: '整改中' };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · ${esc(v.label)}${v.dense ? ' · 人员密集' : ''}${abn.length ? ` · 异常留痕 ${abn.length} 笔` : ''}</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${pcChip.cls}"><span class="chip-label">营业前检查</span><span class="chip-big">${esc(pcChip.big)}</span><span class="chip-sub">${esc(pcChip.sub)}</span></div>
        <div class="chip ${extChip.cls}"><span class="chip-label">灭火器</span><span class="chip-big">${esc(extChip.big)}</span><span class="chip-sub">${esc(extChip.sub)}</span></div>
        <div class="chip ${hzChip.cls}"><span class="chip-label">隐患整改</span><span class="chip-big">${esc(hzChip.big)}</span><span class="chip-sub">${esc(hzChip.sub)}</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${gap === null ? '—' : gap}</b><span>距上次巡查（天）</span></div>
      <div class="stat"><b>${hc.items.find((i) => i.key === 'monthcheck')?.level === 'never' ? '从未' : esc(monthlyCheckClock(state, today, settings.checkDays ?? DEFAULT_CHECK_DAYS).lastISO ?? '—')}</b><span>上次防火检查</span></div>
      <div class="stat"><b>${hc.score >= 85 ? '绿' : hc.score >= 60 ? '黄' : '红'}</b><span>迎检底色</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/ledger">去落账</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 场所（建档 + 营业前检查 + 三合一 + 培训演练）
// ---------------------------------------------------------------------------

export function viewPlace(state) {
  const p = state.place ?? {};
  const today = todayISO();
  const v = venueOf(p);
  const pc = precheckState(p);
  const mixed = mixedState(p);
  const duties = dutyBoard(state, p, today);
  const st = p.precheck ?? { status: 'unset' };
  return `
  <h2 class="sec">场所建档（类型决定全部周期口径）</h2>
  <div class="card">
    <div class="form-grid">
      <label>场所名称 *<input id="pl-name" value="${esc(p.name ?? '')}" placeholder="如：城南路老王家常菜" /></label>
      <label>场所类型 *
        <select id="pl-type">${Object.entries(VENUE_TYPES).map(([k, val]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${esc(val.label)}</option>`).join('')}</select>
      </label>
      <label>消防安全责任人<input id="pl-manager" value="${esc(p.manager ?? '')}" /></label>
      <label>电话<input id="pl-phone" value="${esc(p.phone ?? '')}" /></label>
      <label class="span2">地址<input id="pl-address" value="${esc(p.address ?? '')}" /></label>
      <label>建筑面积（㎡）<input id="pl-area" value="${esc(p.area ?? '')}" placeholder="如：120" /></label>
      <label>层数<input id="pl-floors" value="${esc(p.floors ?? '')}" placeholder="如：地上2层" /></label>
      <label>开业/启用日<input id="pl-opened" type="date" value="${esc(p.openedISO ?? '')}" /></label>
      <label>是否公众聚集场所
        <select id="pl-public"><option value="no" ${!p.publicPlace ? 'selected' : ''}>否</option><option value="yes" ${p.publicPlace ? 'selected' : ''}>是（宾馆/饭店/商场/公共娱乐等）</option></select>
      </label>
      <label>有无自动消防设施
        <select id="pl-systems"><option value="no" ${!p.hasSystems ? 'selected' : ''}>无（灭火器/应急照明为主）</option><option value="yes" ${p.hasSystems ? 'selected' : ''}>有（报警/喷淋等，须年度检测）</option></select>
      </label>
      <label>场所内是否有人住宿
        <select id="pl-mixed"><option value="no" ${!p.mixedWithHome ? 'selected' : ''}>无人住宿</option><option value="yes" ${p.mixedWithHome ? 'selected' : ''}>有（三合一/多合一）</option></select>
      </label>
      <label>住宿与经营是否分隔+独立出口
        <select id="pl-separated"><option value="no" ${!p.homeSeparated ? 'selected' : ''}>未分隔</option><option value="yes" ${p.homeSeparated ? 'selected' : ''}>已分隔</option></select>
      </label>
    </div>
    <div class="row"><button class="btn" data-action="save-place">保存场所信息</button>
      <span class="stats-line">周期口径&nbsp;<span class="pill ok">巡查：${esc(PATROL_MODES[v.patrol])}</span>&nbsp;<span class="pill ok">培训 ${trainingMonths(p)} 个月</span>&nbsp;<span class="pill ok">演练 ${drillMonths(p)} 个月</span>&nbsp;<span class="pill ok">灭火器检查 ${extCheckDays(p)} 天</span></span>
    </div>
    <p class="fine">类型判定的口径：公众聚集场所与人员密集场所按《消防法》第 73 条，巡查频次与培训/演练/月检周期按《三类重点场所消防安全整治指南》与 GB 50444——属地更严要求永远赢。</p>
  </div>

  <h2 class="sec">营业前消防安全检查（消防法第 15 条）</h2>
  <div class="card">
    <div class="row" style="margin-top:0"><span class="pill ${LEVEL_PILL[pc.level] ?? ''}">${LEVEL_TEXT[pc.level] ?? pc.level}</span><span class="stats-line">${esc(pc.detail)}</span></div>
    <div class="form-grid">
      <label>办理状态
        <select id="pk-status">
          <option value="unset" ${st.status !== 'licensed' && st.status !== 'applied' ? 'selected' : ''}>未申请</option>
          <option value="applied" ${st.status === 'applied' ? 'selected' : ''}>已申请告知承诺（待核查）</option>
          <option value="licensed" ${st.status === 'licensed' ? 'selected' : ''}>已通过检查/已许可</option>
        </select>
      </label>
      <label>申请日期<input id="pk-applied" type="date" value="${esc(st.appliedISO ?? '')}" /></label>
      <label>许可/承诺凭证号<input id="pk-license" value="${esc(st.licenseNo ?? '')}" placeholder="公众聚集场所投入使用营业消防安全检查许可证/承诺凭证" /></label>
      <label>通过日期<input id="pk-licensed" type="date" value="${esc(st.licensedISO ?? '')}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-precheck">保存营业前检查信息</button></div>
    <p class="fine">公众聚集场所投入使用、营业前消防安全检查实行告知承诺管理；未经许可的不得投入使用、营业。非公众聚集场所不涉及，状态留"未申请"即可。</p>
  </div>

  <h2 class="sec">三合一自查（消防法第 61 条）</h2>
  <div class="card">
    <div class="row" style="margin-top:0"><span class="pill ${LEVEL_PILL[mixed.level === 'red' ? 'bad' : mixed.level === 'warn' ? 'warn' : 'ok']}">${mixed.level === 'red' ? '停产停业级风险' : mixed.level === 'warn' ? '重点管理' : '无住人'}</span><span class="stats-line">${esc(mixed.detail)}</span></div>
    <p class="fine">整治指南头号清理对象：生产、储存、经营易燃易爆危险品场所与居住同建筑属绝对禁止；其他场所与住人同建筑的，必须防火分隔 + 独立出口。派出所日常检查第（五）项查的就是它。</p>
  </div>

  <h2 class="sec">培训 · 演练 · 年度检测（登记即滚动周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>类型<select id="tr-kind">${Object.entries(TRAIN_KINDS).map(([k, val]) => `<option value="${k}">${esc(val.label)}</option>`).join('')}</select></label>
      <label>日期<input id="tr-date" type="date" value="${esc(today)}" /></label>
      <label>参加人数<input id="tr-count" type="number" min="0" value="0" /></label>
      <label class="span2">备注<input id="tr-note" placeholder="培训内容/演练科目/检测机构（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-training">登记完成</button></div>
    <div class="tbl"><table class="plain"><tr><th>项目</th><th>最近一次</th><th>下次到期</th><th>状态</th><th>依据</th></tr>
      ${duties.map((d) => `<tr class="${d.level === 'never' || d.level === 'overdue' ? 'muted' : ''}"><td>${esc(d.label)}</td><td>${d.lastISO ? esc(d.lastISO) : '—'}</td><td>${d.dueISO ? `${esc(d.dueISO)}（剩 ${d.daysLeft} 天）` : '—'}</td><td><span class="pill ${LEVEL_PILL[d.level] ?? ''}">${LEVEL_TEXT[d.level] ?? d.level}</span></td><td class="basis">${esc(d.basis)}</td></tr>`).join('') || '<tr><td colspan="5">尚未登记</td></tr>'}
    </table></div>
    <p class="fine">周期按场所类型自动判定：全员培训 ${trainingMonths(p)} 个月、演练 ${drillMonths(p)} 个月（整治指南）、年度检测仅"有自动消防设施"时适用（消防法第 16 条第（三）项）。</p>
  </div>

  <div id="modal-host"></div>`;
}

// ---------------------------------------------------------------------------
// 台账（灭火器/月检 / 防火巡查 / 防火检查 / 隐患 四段）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const p = state.place ?? {};
  const v = venueOf(p);
  const settings = state.settings ?? {};
  const interval = settings.extCheckDays > 0 ? settings.extCheckDays : extCheckDays(p);
  const e = esc;

  const exts = [...(state.extinguishers ?? [])];
  const extRows = exts.map((x) => {
    const clocks = extClocks(x, today);
    const chk = extCheckClock(state, x, today, interval);
    const scrapPill = `<span class="pill ${LEVEL_PILL[clocks.scrap.level] ?? ''}">${clocks.scrap.level === 'overdue' ? `报废日 ${e(clocks.scrap.dueISO)} 已到` : `报废 ${e(clocks.scrap.dueISO)}`}</span>`;
    const svcPill = `<span class="pill ${LEVEL_PILL[clocks.service.level] ?? ''}">${clocks.service.level === 'overdue' ? `送修超期（应 ${e(clocks.service.dueISO)}）` : `送修 ${e(clocks.service.dueISO)}`}</span>`;
    const chkPill = `<span class="pill ${LEVEL_PILL[chk.level] ?? ''}">${chk.level === 'never' ? '从未月检' : chk.level === 'overdue' ? `月检超 ${-chk.daysLeft} 天` : chk.level === 'due' ? `剩 ${chk.daysLeft} 天` : `${e(chk.lastISO)} 已检`}</span>`;
    return `<tr class="${clocks.scrap.level === 'overdue' ? 'muted' : ''}">
    <td>${e(x.no || '—')}</td><td>${e(EXT_TYPES[x.type]?.label ?? x.type)}</td><td>${e(x.madeISO)}</td><td>${e(x.location || '—')}</td>
    <td>${scrapPill}<br>${svcPill}<br>${chkPill}</td>
    <td>
      <button class="btn small" data-action="show-extcheck" data-idx="${x.id}">月检</button>
      ${clocks.service.level === 'overdue' || clocks.service.level === 'due' ? `<button class="btn small ghost" data-action="show-service" data-idx="${x.id}">送修登记</button>` : ''}
      <button class="btn small ghost" data-action="del-ext" data-idx="${x.id}">删</button>
    </td>
  </tr>`;
  }).join('');

  const recentChecks = [...(state.extChecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12);
  const chkRows = recentChecks.map((c) => {
    const ext = exts.find((x) => x.id === c.extId);
    return `<tr>
    <td>${e(c.dateISO)}</td><td>${e(ext?.no || c.extId)}</td>
    <td><b class="mark ${c.pressure ? 'ok' : 'no'}">${c.pressure ? '√' : '×'}</b></td>
    <td><b class="mark ${c.seal ? 'ok' : 'no'}">${c.seal ? '√' : '×'}</b></td>
    <td><b class="mark ${c.body ? 'ok' : 'no'}">${c.body ? '√' : '×'}</b></td>
    <td><b class="mark ${c.location ? 'ok' : 'no'}">${c.location ? '√' : '×'}</b></td>
    <td>${e(c.note || '—')}</td>
  </tr>`;
  }).join('');

  const patrols = [...(state.patrols ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 20);
  const ptRows = patrols.map((x) => `<tr class="${x.abnormal ? 'muted' : ''}">
    <td>${e(x.dateISO)}</td><td>${e(PATROL_SLOTS[x.slot] ?? x.slot)}</td>
    <td><b class="mark ${x.items.fire ? 'ok' : 'no'}">${x.items.fire ? '√' : '×'}</b></td>
    <td><b class="mark ${x.items.exit ? 'ok' : 'no'}">${x.items.exit ? '√' : '×'}</b></td>
    <td><b class="mark ${x.items.equip ? 'ok' : 'no'}">${x.items.equip ? '√' : '×'}</b></td>
    <td><b class="mark ${x.items.post ? 'ok' : 'no'}">${x.items.post ? '√' : '×'}</b></td>
    <td>${e(x.note || '—')}</td>
    <td><button class="btn small ghost" data-action="del-patrol" data-idx="${x.id}">删</button></td>
  </tr>`).join('');

  const mcList = [...(state.monthChecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12);
  const mcRows = mcList.map((c) => `<tr class="${c.abnormal ? 'muted' : ''}">
    <td>${e(c.dateISO)}</td>
    ${Object.keys(CHECK_ITEMS).map((k) => `<td><b class="mark ${c.items[k] ? 'ok' : 'no'}">${c.items[k] ? '√' : '×'}</b></td>`).join('')}
    <td>${e(c.note || '—')}</td>
  </tr>`).join('');

  const hzList = openHazards(state, today);
  const closedHz = (state.hazards ?? []).filter((h) => h.closedISO).sort((a, b) => b.closedISO.localeCompare(a.closedISO)).slice(0, 10);
  const hzRow = (h) => `<tr class="${h.closedISO ? '' : 'muted'}">
    <td>${e(h.dateISO)}</td><td>${e(HAZARD_SOURCES[h.source] ?? h.source)}${h.docNo ? `<br><span class="basis">${e(h.docNo)}</span>` : ''}</td>
    <td>${e(h.location || '—')}</td><td>${e(h.desc)}</td>
    <td>${h.dueISO ? e(h.dueISO) : '—'}</td>
    <td>${h.closedISO ? `${e(h.closedISO)}${h.verifyNote ? `·${e(h.verifyNote)}` : ''}` : `<button class="btn small" data-action="show-close-hazard" data-idx="${h.id}">复查销案</button> <button class="btn small ghost" data-action="print-hazard" data-idx="${h.id}">整改单</button>`}</td>
  </tr>`;

  return `
  <h2 class="sec">灭火器台账（报废钟 + 送修钟 + 月检钟）</h2>
  <div class="card">
    <div class="form-grid">
      <label>器具编号<input id="ex-no" placeholder="如：1号/东墙/收银台" /></label>
      <label>类型<select id="ex-type">${Object.entries(EXT_TYPES).map(([k, val]) => `<option value="${k}">${e(val.label)}（报废 ${val.scrapYears} 年）</option>`).join('')}</select></label>
      <label>出厂日期 *<input id="ex-made" type="date" /></label>
      <label>放置位置<input id="ex-location" placeholder="如：收银台侧/后厨门口" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-ext">登记灭火器</button><span class="basis">出厂日期在瓶体铭牌上；报废与送修周期按类型自动判定（水基 6 年/干粉·洁净气体 10 年/二氧化碳 12 年，送修 3+1、5+2 通识口径）</span></div>
    <div class="tbl"><table class="plain"><tr><th>编号</th><th>类型</th><th>出厂</th><th>位置</th><th>三只钟</th><th></th></tr>${extRows || '<tr><td colspan="6">还没有登记灭火器——检查第一问就是它</td></tr>'}</table></div>
    ${recentChecks.length ? `<div class="tbl"><table class="plain"><tr><th>检查日</th><th>器具</th><th>压力</th><th>铅封</th><th>外观</th><th>位置</th><th>备注</th></tr>${chkRows}</table></div>` : ''}
    <p class="fine">月检四查：压力表指针在绿区 / 铅封插销完好 / 外观无锈蚀损伤 / 放置位置正确未被遮挡；本场所检查间隔 <strong>${interval} 天</strong>（人员密集场所每半月，GB 50444 口径）。</p>
  </div>

  <h2 class="sec">防火巡查（${esc(PATROL_MODES[v.patrol] ?? '')}）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="pt-date" type="date" value="${e(today)}" /></label>
      <label>时段<select id="pt-slot">${Object.entries(PATROL_SLOTS).map(([k, val]) => `<option value="${k}">${e(val)}</option>`).join('')}</select></label>
      <label class="span2">四查（不勾 = 有异常，必须写处置）
        <span class="checkline">
          ${Object.entries(PATROL_ITEMS).map(([k, val]) => `<label class="chk"><input type="checkbox" id="pt-${k}" checked /> ${e(val)}</label>`).join('')}
        </span>
      </label>
      <label class="span2">异常与处置<input id="pt-note" placeholder="如：后堆杂物已清理/出口被货箱挡已搬走（异常必填）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-patrol">落巡查</button><span class="basis">应急部令第 5 号第 34 条四查口径${v.closeCheck ? `；${e(CLOSE_CHECK_NOTE)}` : ''}——发现异常也可直接转下方隐患登记</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>时段</th><th>用火电</th><th>出口</th><th>器材</th><th>在岗</th><th>异常与处置</th><th></th></tr>${ptRows || '<tr><td colspan="8">还没有巡查记录——营业前第一笔</td></tr>'}</table></div>
  </div>

  <h2 class="sec">防火检查（每月一次八查）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="mc-date" type="date" value="${e(today)}" /></label>
      <label class="span2">八查（不勾 = 有异常，必须写情况并转隐患）
        <span class="checkline">
          ${Object.entries(CHECK_ITEMS).map(([k, val]) => `<label class="chk"><input type="checkbox" id="mc-${k}" checked /> ${e(val)}</label>`).join('')}
        </span>
      </label>
      <label class="span2">异常说明<input id="mc-note" placeholder="异常部位与处理（有异常必填）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-monthcheck">落检查</button><span class="basis">整治指南口径每月一次；八查对标应急部令第 5 号第 35 条与派出所日常检查清单（消防监督检查规定第 31 条）</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th>${Object.keys(CHECK_ITEMS).map((k) => `<th>${e(CHECK_ITEMS[k].slice(0, 3))}</th>`).join('')}<th>异常说明</th></tr>${mcRows || '<tr><td colspan="10">还没有防火检查记录</td></tr>'}</table></div>
  </div>

  <h2 class="sec">隐患整改闭环（通知类必须带文书编号）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日期<input id="hz-date" type="date" value="${e(today)}" /></label>
      <label>来源<select id="hz-source">${Object.entries(HAZARD_SOURCES).map(([k, val]) => `<option value="${k}">${e(val)}</option>`).join('')}</select></label>
      <label>文书编号<input id="hz-docno" placeholder="通知类必填（责令改正通知书号）" /></label>
      <label>部位<input id="hz-location" placeholder="如：后厨/安全出口/二楼过道" /></label>
      <label class="span2">隐患描述<input id="hz-desc" placeholder="如：安全出口被货物堵塞/应急照明灯不亮" /></label>
      <label>整改期限<input id="hz-due" type="date" /></label>
      <label>整改责任人<input id="hz-owner" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-hazard">登记隐患</button><span class="basis">消防法第 60 条第（七）项：隐患经通知后不及时消除，处 5000~5 万元罚款——通知类销案是自证的关键一步</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>来源</th><th>部位</th><th>隐患</th><th>期限</th><th>复查</th></tr>${hzList.map(hzRow).join('') || '<tr><td colspan="6">无未销案隐患</td></tr>'}</table></div>
    ${closedHz.length ? `<div class="tbl"><table class="plain"><tr><th>发现日</th><th>来源</th><th>部位</th><th>隐患</th><th>期限</th><th>复查</th></tr>${closedHz.map(hzRow).join('')}</table></div>` : ''}
  </div>

  <div id="modal-host"></div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 体检明细 / 出证）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const settings = state.settings ?? {};
  const e = esc;
  const hzOptions = (state.hazards ?? []).filter((h) => !h.closedISO)
    .map((h) => `<option value="${e(h.id)}">${e(h.dateISO)} ${e(h.desc.slice(0, 18))}</option>`).join('');

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴给物业、出租方或存档——含巡查/检查/器材/隐患/培训演练五段与法条口径尾注。</p>'}
  </div>

  <h2 class="sec">账本体检（${healthCheck(state, today, settings).items.length} 项）</h2>
  <div class="card">
    ${(() => {
    const hc = healthCheck(state, today, settings);
    const rows = hc.items.map((i) => `<tr class="${i.level === 'bad' ? 'muted' : ''}">
        <td>${e(i.label)}</td><td><span class="pill ${LEVEL_PILL[i.level === 'red' ? 'bad' : i.level] ?? ''}">${i.level === 'bad' ? '红' : i.level === 'warn' ? '黄' : '绿'}</span></td><td>${e(i.detail)}</td>
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
    <p class="fine">单文件含：场所建档与营业前检查状态、灭火器台账三只钟、近 30 天巡查、防火检查八查、隐患整改闭环、培训演练年检、体检明细——检查重点对标《消防监督检查规定》第 31 条派出所日常检查清单，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>未销案隐患<select id="hazard-sheet">${hzOptions || '<option value="">无未销案隐患</option>'}</select></label>
      <button class="btn" data-action="print-hazard-sheet" ${hzOptions ? '' : 'disabled'}>${icon('dl')} 隐患整改单</button>
    </div>
    <p class="fine">按条生成：隐患信息 + 整改要求 + 复查销案栏 + 双签字——发给整改责任人、物业或出租方，把"口头说"变成"纸上账"。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  const p = state.place ?? {};
  return `
  <h2 class="sec">参数（属地规则永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>巡查断更红线（天）<input id="set-gap" type="number" min="1" max="15" value="${s.gapDays ?? DEFAULT_GAP_DAYS}" /></label>
      <label>防火检查周期（天）<input id="set-check" type="number" min="15" max="90" value="${s.checkDays ?? DEFAULT_CHECK_DAYS}" /></label>
      <label>灭火器检查间隔（天，0=自动）<input id="set-extcheck" type="number" min="0" max="60" value="${s.extCheckDays ?? 0}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">当前自动口径：巡查 ${esc(PATROL_MODES[venueOf(p).patrol] ?? '')}；防火检查每月一次（整治指南）；灭火器检查间隔 ${extCheckDays(p)} 天（人员密集每半月，GB 50444 口径）——设置 0 恢复自动，属地更严要求请手动下调。</p>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与事件流；责任人姓名也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例场所（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 灭火器双钟 → 巡查打卡 → 隐患闭环 → 培训演练点名 → 三通道出证。</p>
  </div>`;
}
