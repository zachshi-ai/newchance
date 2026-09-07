/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  PREFLIGHT_ITEMS, PERMIT_REASONS, PERMIT_STATUS, FLIGHT_PURPOSE, FLIGHT_STATUS, DUTY_KINDS,
  classifyUas, CATEGORY_META, obligations,
  uasClocks, pilotClocks, pilotReadyFor, permitWindows,
  dutyBoard, healthCheck, monthlySummary, staleFlights, openIssues, incidentDue,
  escapeHtml, todayISO, addDays,
} from './core.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// 内联 SVG 图标（stroke: currentColor；零依赖、随主题变色）
// ---------------------------------------------------------------------------

const IC = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  board: IC('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  drone: IC('<circle cx="6" cy="6" r="3.2"/><circle cx="18" cy="6" r="3.2"/><circle cx="6" cy="18" r="3.2"/><circle cx="18" cy="18" r="3.2"/><rect x="9.2" y="9.2" width="5.6" height="5.6" rx="1.4"/><path d="M8.2 8.2l1.6 1.6M15.8 8.2l-1.6 1.6M8.2 15.8l1.6-1.6M15.8 15.8l-1.6-1.6"/>'),
  fleet: IC('<rect x="3.5" y="9" width="7" height="7" rx="1.5"/><rect x="13.5" y="9" width="7" height="7" rx="1.5"/><path d="M7 9V6.5M17 9V6.5M4.5 6.5h5M14.5 6.5h5"/>'),
  people: IC('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.6c2.3.3 4.2 1.9 4.9 4.4"/>'),
  flight: IC('<path d="M10.5 13.5 4 11l1.5-1.5 6 1 4.5-4.5c.8-.8 2-1 2.6-.4.6.6.4 1.8-.4 2.6L13.5 12.5l1 6L13 20l-2.5-6.5z"/>'),
  permit: IC('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8h6M9 12h6M9 16h3.5"/><path d="M14.5 15.5l2 2 3-3.5"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  hazard: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  copy: IC('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5v-1a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" transform="translate(1.5 1.5) scale(.92)"/>'),
  trash: IC('<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.5h9.2L17.5 7"/><path d="M10.2 10.5v6M13.8 10.5v6"/>'),
  shield: IC('<path d="M12 3.5 19 6v6c0 4.2-2.9 7.2-7 8.5-4.1-1.3-7-4.3-7-8.5V6z"/><path d="M9 11.8l2.2 2.2L15.5 9.5"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { expired: 'bad', red: 'bad', warn: 'warn', ok: 'ok' };
const LEVEL_TEXT = { expired: '已过期', red: '告急', warn: '临期', ok: '正常' };

export function pill(level, text) {
  const cls = LEVEL_PILL[level] ?? 'ok';
  return `<span class="pill ${cls}">${text ?? LEVEL_TEXT[level] ?? level}</span>`;
}

/** 体检分计分环 */
export function scoreRing(score, small = false) {
  const tone = score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'bad';
  return `<div class="ring ${tone} ${small ? 'small' : ''}" role="img" aria-label="体检得分 ${score}">
    <svg viewBox="0 0 44 44"><circle class="ring-bg" cx="22" cy="22" r="18"/>
    <circle class="ring-fg" cx="22" cy="22" r="18" stroke-dasharray="${(score * 1.13).toFixed(1)} 113"/>
    <text x="22" y="26" text-anchor="middle">${score}</text></svg></div>`;
}

/* ------------------------------------------------------------- 空态引导 */

export function viewOnboarding() {
  return `
  <section class="hero card">
    <h2>黑飞入刑拘留时代，飞之前就知道差哪张纸</h2>
    <p>2024-01-01 起施行的《无人驾驶航空器飞行管理暂行条例》把无人机分成微/轻/小/中/大五类，分别挂上不同的法定动作：<b>实名登记</b>（第10条，GB 46761—2025 起 250 克以下微型机也要）、<b>操控员执照</b>（第16条，6 年有效+定期检查）、<b>运营合格证</b>（第11条，单位飞非微型机）、<b>责任保险</b>（第12条）；管制空域与特殊情形飞行要<b>提前 1 日 12 时前申请</b>（第26条）、起飞前 1 小时报告（第30条）、出安全问题<b>降落后 24 小时内报告</b>（第40条）。2026-01-01 起新《治安管理处罚法》第46条：违规飞行可行政拘留。适飞单把这本账变成白箱：判档上钟 → 航前检查放行 → 申请台账盯红线 → 一键出迎检自证包。</p>
    <ol class="onboard">
      <li>「设置」里保存主体信息（个人飞手 / 单位，单位填运营合格证号）</li>
      <li>「机队」一机一档建档——判档器自动算出微/轻/小/中/大和该机义务清单</li>
      <li>「人员」登记操控员（执照颁发日、定期检查日、农用操作证书）</li>
      <li>每次飞行在「飞行」建架次：航前检查 → 起飞 → 降落闭环，需要批准的先去「申请」</li>
    </ol>
    <div class="row"><a class="btn" href="#/settings">从主体信息开始</a></div>
  </section>`;
}

/* ------------------------------------------------------------- 看板 */

export function viewBoard(state, todayISOStr = todayISO()) {
  if (!state.uas.length && !state.pilots.length) return viewOnboarding();
  const s = state.settings;
  const hc = healthCheck(state, todayISOStr);
  const activeUas = state.uas.filter((u) => u.status === 'active');
  const reds = [];
  for (const u of activeUas) {
    for (const c of uasClocks(u, todayISOStr, s)) {
      if (c.level !== 'ok') reds.push({ uas: u.nickname, ...c });
    }
  }
  const badPilots = state.pilots.filter((p) => p.status === 'active' && !pilotReadyFor(p, 'any', todayISOStr, s).ok);
  const stale = staleFlights(state, todayISOStr);
  const issues = openIssues(state);
  const overdueDuties = dutyBoard(state, todayISOStr).filter((d) => d.level === 'expired');
  const badPermits = state.permits.filter((m) => (m.status === 'planned' && m.flyingDateISO < addDays(todayISOStr, 1)) || (m.status === 'applied' && m.flyingDateISO < todayISOStr));
  const incidentPending = state.flights.filter((f) => {
    const due = incidentDue(f);
    return due !== null;
  });
  const todayFlights = state.flights.filter((f) => f.dateISO === todayISOStr && f.status !== 'cancelled');

  const todo = [];
  if (incidentPending.length) todo.push(`报告 <b>${incidentPending.length}</b> 起飞行安全问题（第40条：降落后 24 小时内）→ <a href="#/flights">去飞行</a>`);
  if (stale.length) todo.push(`闭环 <b>${stale.length}</b> 个过日未闭环的架次 → <a href="#/flights">去飞行</a>`);
  if (issues.length) todo.push(`闭环 <b>${issues.length}</b> 项在册检修——带病机不开飞 → <a href="#/issues">去检修</a>`);
  if (reds.length) todo.push(`处理 <b>${reds.length}</b> 只证照红灯/临期钟 → <a href="#/fleet">去机队</a>`);
  if (badPilots.length) todo.push(`处理 <b>${badPilots.length}</b> 名操控员执照/定期检查红灯 → <a href="#/crew">去人员</a>`);
  if (badPermits.length) todo.push(`处理 <b>${badPermits.length}</b> 条申请（错失窗口或批复过期）→ <a href="#/permits">去申请</a>`);
  if (overdueDuties.length) todo.push(`登记 <b>${overdueDuties.length}</b> 项到期义务（年报/参数/电池/固件/复训）→ <a href="#/duties">去义务</a>`);
  if (!todayFlights.length) todo.push(`今天还没有架次记录——飞前先做航前检查（第32条(二)）`);

  return `
  <section class="hero card dark">
    <div class="hero-l">
      <h2>今日飞行台</h2>
      <p class="sub">${esc(state.org?.name || '未登记主体')} · ${todayISOStr} · 今日架次 ${todayFlights.length}</p>
      <ul class="redlist">
        ${todo.length ? todo.map((t) => `<li>${t}</li>`).join('') : '<li class="okline">八灯全绿：机队有钟、人员有证、架次闭环、申请不欠、异常已报。</li>'}
      </ul>
    </div>
    ${scoreRing(hc.score)}
  </section>

  <div class="grid2">
    <section class="card">
      <h3>${icon('flight')} 今日架次</h3>
      ${todayFlights.length ? todayFlights.map((f) => {
        const u = state.uas.find((x) => x.id === f.uasId);
        return `<div class="item"><b>${esc(u?.nickname || '?')}</b> · ${esc(FLIGHT_PURPOSE[f.purpose] || f.purpose)} · ${pill(f.status === 'closed' ? 'ok' : f.status === 'flying' ? 'warn' : 'warn', FLIGHT_STATUS[f.status])}
          <a class="btn small ghost" href="#/flights">去架次</a></div>`;
      }).join('') : '<p class="dim">今天还没有架次。</p>'}
      <div class="row"><a class="btn small" href="#/flights">飞行架次</a></div>
    </section>
    <section class="card">
      <h3>${icon('clock')} 证照钟点名（红/临期）</h3>
      ${reds.length ? reds.slice(0, 6).map((c) => `<div class="item">${pill(c.level, c.level === 'expired' ? '未登记/已过期' : `剩 ${c.days} 天`)} <b>${esc(c.uas)}</b> · ${esc(c.label)} <span class="basis">${esc(c.basis)}</span></div>`).join('') : '<p class="dim">机队钟全绿。</p>'}
      <div class="row"><a class="btn small ghost" href="#/fleet">一机一档</a></div>
    </section>
    <section class="card">
      <h3>${icon('hazard')} 检修与安全（第32/40条）</h3>
      ${issues.length ? issues.map((h) => `<div class="item">${pill('red', h.deadlineISO && h.deadlineISO < todayISOStr ? '超期' : '在册')} ${esc(h.item)} <span class="basis">${esc(h.measure)}</span></div>`).join('') : '<p class="dim">在册无检修项。</p>'}
      <div class="row"><a class="btn small ghost" href="#/issues">检修账</a></div>
    </section>
    <section class="card">
      <h3>${icon('permit')} 申请与义务</h3>
      ${badPermits.length ? badPermits.map((m) => `<div class="item">${pill('expired', PERMIT_STATUS[m.status])} ${esc(PERMIT_REASONS[m.reason]?.label || m.reason)} · 拟飞 ${esc(m.flyingDateISO)}</div>`).join('') : '<p class="dim">申请台账无欠账。</p>'}
      ${overdueDuties.map((d) => `<div class="item">${pill('expired', d.dueISO ? `逾期 ${-d.days} 天` : '从未登记')} ${esc(d.label)}</div>`).join('')}
      <div class="row"><a class="btn small ghost" href="#/permits">申请台账</a> <a class="btn small ghost" href="#/duties">义务账</a></div>
    </section>
  </div>`;
}

/* ------------------------------------------------------------- 机队（一机一档 + 判档器） */

function uasForm() {
  return `
  <section class="card">
    <h3>${icon('drone')} 判档建档（重量照铭牌/说明书抄，条例第62条）</h3>
    <div class="formgrid">
      <label>机昵称 *<input id="uas-name" placeholder="例：云雀 Air-3" /></label>
      <label>型号<input id="uas-model" placeholder="例：轻型四旋翼（航拍）" /></label>
      <label>空机重量（千克）*<input id="uas-empty" type="number" step="0.01" min="0" placeholder="例：0.9" /></label>
      <label>最大起飞重量（千克）*<input id="uas-mtow" type="number" step="0.01" min="0" placeholder="例：2.0" /></label>
      <label class="chk wide"><input type="checkbox" id="uas-agri" /> 农用作业意向（植保/播种/投饵——须满足第62条(八)包线：真高≤30米、平飞≤50km/h、半径≤2000米）</label>
      <label class="chk wide"><input type="checkbox" id="uas-commercial" /> 该机有经营用途（航拍/巡检收费等——触发第12条责任保险钟）</label>
      <label class="chk wide"><input type="checkbox" id="uas-legacy" /> 存量机：不能自动向监管平台报送识别信息（第61条——一律申请批准后飞行）</label>
      <label>实名登记号（92.211：UAS+8位）<input id="uas-regno" placeholder="UAS 开头，UOM 平台获取" /></label>
      <label>实名登记日<input id="uas-regdate" type="date" /></label>
      <label class="chk"><input type="checkbox" id="uas-mark" /> 登记标志/二维码已粘贴（92.213）</label>
      <label>责任保险到期日<input id="uas-insurance" type="date" /></label>
      <label class="wide">备注<input id="uas-note" placeholder="SN、电池配置等" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-uas">判档并建档</button></div>
    <div id="uas-cls-preview" class="basis"></div>
  </section>`;
}

export function viewFleet(state, todayISOStr = todayISO()) {
  const s = state.settings;
  const rows = state.uas.filter((u) => u.status === 'active').map((u) => {
    let cls;
    try { cls = classifyUas(u); } catch { cls = null; }
    const clocks = uasClocks(u, todayISOStr, s);
    return `
    <div class="card uascard">
      <div class="item head">
        <b>${esc(u.nickname)}</b><span class="dim">${esc(u.model || '')}${cls ? ` · ${CATEGORY_META[cls.category].label}${cls.agriOk ? ' · 农用作业（第11条3款豁免运营合格证）' : ''}` : ''}</span>
        <span class="grow"></span>
        <button class="btn small ghost" data-action="retire-uas" data-idx="${u.id}">停用</button>
      </div>
      <table class="tbl"><thead><tr><th>证照钟</th><th>到期/说明</th><th>状态</th><th>依据</th></tr></thead><tbody>
      ${clocks.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.dueISO || c.detail || '—')}</td>
        <td>${c.missing ? pill('expired', '未登记') : pill(c.level, c.level === 'ok' ? (c.key === 'registration' ? (u.markAffixed ? '已登记·标志已贴' : '标志未确认') : '正常') : `${LEVEL_TEXT[c.level]}${c.days !== null && c.key === 'insurance' ? ` ${c.days} 天` : ''}`)}</td>
        <td class="basis">${esc(c.basis)}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
  }).join('');

  return `
  <section class="card">
    <h3>${icon('fleet')} 一机一档（条例第10/12/62条 · 92.205/92.211）</h3>
    ${rows || '<p class="dim">还没有无人机。重量照铭牌/说明书抄——判档器会算出微/轻/小/中/大和该机的义务清单。</p>'}
  </section>
  ${uasForm()}`;
}

/* ------------------------------------------------------------- 人员 */

export function viewCrew(state, todayISOStr = todayISO()) {
  const s = state.settings;
  const rows = state.pilots.filter((p) => p.status === 'active').map((p) => {
    const clocks = pilotClocks(p, todayISOStr, s);
    const ready = pilotReadyFor(p, 'any', todayISOStr, s);
    const lic = clocks.find((c) => c.key === 'license');
    const prof = clocks.find((c) => c.key === 'profCheck');
    const agri = clocks.find((c) => c.key === 'agriCert');
    const cell = (c, fallback) => c
      ? `${esc(c.dueISO)} ${c.level !== 'ok' ? pill(c.level, LEVEL_TEXT[c.level]) : ''}`
      : fallback;
    return `<tr>
      <td><b>${esc(p.name)}</b></td>
      <td>${p.licenseIssueISO ? `${esc(p.licenseIssueISO)} → ${cell(lic)}` : pill('ok', '微/轻型免执照')}</td>
      <td>${p.lastProfCheckISO ? `${esc(p.lastProfCheckISO)} → ${cell(prof)}` : p.licenseIssueISO ? pill('warn', '未登记检查') : '—'}</td>
      <td>${p.agriCertISO ? `${esc(p.agriCertISO)} → ${cell(agri)}` : '—'}</td>
      <td>${ready.ok ? pill('ok') : pill('expired', '禁止起飞')}</td>
      <td><button class="btn small ghost" data-action="retire-pilot" data-idx="${p.id}">停用</button></td></tr>`;
  }).join('');

  return `
  <section class="card">
    <h3>${icon('people')} 操控员（条例第16/17条 · 92.61/92.81/92.83）</h3>
    ${rows ? `<table class="tbl"><thead><tr><th>姓名</th><th>执照（颁发→到期，6年）</th><th>定期检查（上次→下次）</th><th>农用操作证书</th><th>状态</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="dim">还没有操控员。小型/中型/大型须执照（第16条）；微/轻型免执照但要熟练掌握操作（第17条）；农用作业由生产者培训考核发操作证书（第16条2款）。</p>'}
    <div class="formgrid">
      <label>姓名 *<input id="pl-name" /></label>
      <label>电话<input id="pl-phone" /></label>
      <label>执照颁发日（无执照留空=只飞微/轻型）<input id="pl-license" type="date" /></label>
      <label>最近定期/熟练检查日（92.81/92.83）<input id="pl-profcheck" type="date" /></label>
      <label class="chk"><input type="checkbox" id="pl-ifrlarge" /> 大型机/IFR（熟练检查按 12 个日历月）</label>
      <label>农用操作证书取得日（第16条2款）<input id="pl-agricert" type="date" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-pilot">登记操控员</button></div>
  </section>`;
}

/* ------------------------------------------------------------- 飞行架次 */

function flightActionForm(state, f, todayISOStr) {
  const uas = state.uas.find((u) => u.id === f.uasId);
  const isMicro = uas ? (() => { try { return classifyUas(uas).category === 'micro'; } catch { return false; } })() : false;
  const items = PREFLIGHT_ITEMS.filter((it) => !(isMicro && it.microNa));
  if (f.status === 'checking') {
    return `
    <div class="step">
      <p class="steptitle"><b>第一步 · 航前检查</b>（条例第32条行为规范 + GB 42590，逐项确认）</p>
      <div class="checks">
        ${items.map((it) => `<label class="chk" title="${esc(it.basis)}"><input type="checkbox" id="pf-${f.id}-${it.key}" checked /> ${it.label}</label>`).join('')}
        ${isMicro ? `<span class="basis">微型机：识别信息广播项按第24条豁免，已自动勾选。</span>` : ''}
      </div>
      <div id="pf-note-${f.id}" class="hiddennote">
        <p class="warnline">有异常项：必须先登记检修单与处置措施才让检查通过（第32条(二)：实施飞行活动前检查无人机状态）。</p>
        <div class="formgrid">
          <label class="wide">处置措施 *<input id="pf-measure-${f.id}" placeholder="例：换装备用电池，复查后销案" /></label>
          <label>处置期限<input id="pf-deadline-${f.id}" type="date" /></label>
        </div>
      </div>
      <label>检查备注<input id="pf-memo-${f.id}" placeholder="选填" /></label>
      <div class="row"><button class="btn" data-action="submit-preflight" data-idx="${f.id}">完成检查，放行</button>
      <button class="btn ghost" data-action="cancel-flight" data-idx="${f.id}">取消架次</button></div>
    </div>`;
  }
  if (f.status === 'cleared') {
    const permit = f.permitId ? state.permits.find((m) => m.id === f.permitId) : null;
    const warn = f.preflight?.abnormal ? `<p class="warnline">本架次航前检查有异常（检修在册）——检修闭环前「起飞」会被拒绝（第32条(二)）。</p>` : '';
    const preDep = permit && !permit.preDepISO ? `<p class="warnline">本架次需批复飞行：起飞前 1 小时须向空管报告并确认（第30条）——先到 <a href="#/permits">申请</a> 登记，否则起飞被拒。</p>` : '';
    return `
    <div class="step">
      <p class="steptitle"><b>第二步 · 起飞确认</b>（第32条(三)：实时掌握飞行动态，飞行结束后及时报告）</p>
      ${warn}${preDep}
      <div class="row"><button class="btn" data-action="takeoff-flight" data-idx="${f.id}">起飞</button>
      <button class="btn ghost" data-action="cancel-flight" data-idx="${f.id}">取消架次</button></div>
    </div>`;
  }
  if (f.status === 'flying') {
    const commercial = f.purpose === 'commercial';
    return `
    <div class="step">
      <p class="steptitle"><b>第三步 · 降落闭环</b>（第32条(三)飞后报告；第40条安全问题 24 小时钟从此刻起算）</p>
      <div class="formgrid">
        <label>降落日期<input id="cl-landing-${f.id}" type="date" value="${todayISOStr}" /></label>
        <label>飞行时长（分钟）<input id="cl-duration-${f.id}" type="number" min="0" placeholder="例：35" /></label>
        ${commercial ? `<label>本次收入（元，经营性）<input id="cl-income-${f.id}" type="number" min="0" placeholder="例：800" /></label>` : ''}
        <label class="chk"><input type="checkbox" id="cl-issue-${f.id}" /> 本次发生飞行安全问题（异常/失控/伤损）</label>
        <label class="wide">安全问题描述（发生时必填）<input id="cl-incnote-${f.id}" placeholder="例：图传短暂丢失，按预案悬停返航" /></label>
        <label class="wide">备注<input id="cl-note-${f.id}" placeholder="选填" /></label>
      </div>
      <div class="row"><button class="btn" data-action="close-flight" data-idx="${f.id}">降落，闭环</button></div>
    </div>`;
  }
  if (f.status === 'closed') {
    const due = incidentDue(f);
    return `
    <div class="step done">
      <p class="steptitle"><b>✅ 已闭环</b> ${f.takeoffISO || '—'} 起飞 → ${f.landingISO || '—'} 降落${f.durationMin ? ` · ${f.durationMin} 分钟` : ''}${f.income !== null && f.income !== undefined ? ` · 收入 ¥${f.income}` : ''}
      ${f.safetyIssue ? (f.incidentReportedISO ? ` · 安全问题已报告（${esc(f.incidentReportedISO)}）` : ` · ⚠️ 安全问题待报告，24 小时截止 <b>${esc(due || '')}</b>（第40条）`) : ' · 无安全问题'}</p>
      <div class="row">
        ${f.safetyIssue && !f.incidentReportedISO ? `<button class="btn small" data-action="show-report-incident" data-idx="${f.id}">登记已向空管报告</button>` : ''}
        <button class="btn small ghost" data-action="print-flight-card" data-idx="${f.id}">${icon('print')} 打印飞行记录卡</button>
      </div>
    </div>`;
  }
  return `<p class="dim">${FLIGHT_STATUS[f.status] || f.status}${f.cancelNote ? ` · ${esc(f.cancelNote)}` : ''}</p>`;
}

export function viewFlights(state, todayISOStr = todayISO()) {
  if (!state.uas.length) return `<section class="card"><p class="dim">先到 <a href="#/fleet">机队</a> 建档，再建架次。</p></section>`;
  const activeUas = state.uas.filter((u) => u.status === 'active');
  const pilots = state.pilots.filter((p) => p.status === 'active');
  const flights = [...state.flights].sort((a, b) => (b.dateISO + b.id).localeCompare(a.dateISO + a.id)).slice(0, 40);

  return `
  <section class="card">
    <h3>${icon('flight')} 建架次（每次起飞一架次：航前检查 → 起飞 → 降落闭环）</h3>
    ${activeUas.length && pilots.length ? `
    <div class="formgrid">
      <label>无人机<select id="fl-uas">${activeUas.map((u) => {
        let tag = '';
        try { tag = CATEGORY_META[classifyUas(u).category].label; } catch { tag = '?'; }
        return `<option value="${u.id}">${esc(u.nickname)}（${tag}${u.regNo ? '·已登记' : '·未登记'}）</option>`;
      }).join('')}</select></label>
      <label>操控员<select id="fl-pilot">${pilots.map((p) => `<option value="${p.id}">${esc(p.name)}${p.licenseIssueISO ? '·持证' : '·微/轻'}</option>`).join('')}</select></label>
      <label>日期<input id="fl-date" type="date" value="${todayISOStr}" /></label>
      <label>任务性质<select id="fl-purpose">
        <option value="commercial">经营性飞行</option>
        <option value="agri">常规农用作业</option>
        <option value="personal">非经营性飞行</option>
        <option value="training">训练飞行</option>
      </select></label>
      <label>空域<select id="fl-airspace">
        <option value="suitable">适飞空域（管制区外）</option>
        <option value="controlled">管制空域（需批复）</option>
      </select></label>
      <label>任务地点 / 简述<input id="fl-location" placeholder="例：示例产业园宣传片" /></label>
    </div>
    <p class="basis">特殊情形勾选（任一勾选即需批复，第31条2款；农用作业在适飞空域免申请，第31条(二)）：</p>
    <div class="checks">
      ${['relay', 'drop', 'crowd', 'movingVehicle', 'swarm'].map((k) => `<label class="chk"><input type="checkbox" class="fl-flag" value="${k}" /> ${PERMIT_REASONS[k].label}</label>`).join('')}
    </div>
    <p class="basis">已批准的申请（需要批复的架次必选，批复不可挪用到其他日期）：</p>
    <select id="fl-permit"><option value="">—— 无需批复 / 尚未选择 ——</option>
      ${state.permits.filter((m) => m.status === 'approved').map((m) => `<option value="${m.id}">${esc(m.flyingDateISO)} · ${esc(PERMIT_REASONS[m.reason]?.label || '')} · ${esc(m.permitNo || '已批准')}</option>`).join('')}
    </select>
    <div class="row"><button class="btn" data-action="new-flight">建架次</button></div>`
      : '<p class="dim">还缺无人机或操控员——到 <a href="#/fleet">机队</a> / <a href="#/crew">人员</a> 先建档。</p>'}
  </section>
  ${flights.map((f) => {
    const u = state.uas.find((x) => x.id === f.uasId);
    const p = state.pilots.find((x) => x.id === f.pilotId);
    const isStale = f.dateISO < todayISOStr && !['closed', 'cancelled'].includes(f.status);
    return `
    <div class="card flightcard ${isStale ? 'stale' : ''}">
      <div class="item head">
        <b>${esc(f.dateISO)} · ${esc(u?.nickname || '?')}</b>
        <span class="dim">${esc(p?.name || '?')} · ${esc(f.location || FLIGHT_PURPOSE[f.purpose])}</span>
        <span class="grow"></span>
        ${pill(f.status === 'closed' ? 'ok' : f.status === 'cancelled' ? 'warn' : isStale ? 'expired' : 'warn', FLIGHT_STATUS[f.status] || f.status)}
        ${isStale ? pill('expired', '过日未闭环') : ''}
      </div>
      ${flightActionForm(state, f, todayISOStr)}
    </div>`;
  }).join('')}`;
}

/* ------------------------------------------------------------- 申请台账 */

export function viewPermits(state, todayISOStr = todayISO()) {
  const activeUas = state.uas.filter((u) => u.status === 'active');
  const pilots = state.pilots.filter((p) => p.status === 'active');
  const rows = [...state.permits].sort((a, b) => b.flyingDateISO.localeCompare(a.flyingDateISO)).map((m) => {
    const { applyByISO } = permitWindows(m.flyingDateISO);
    let statusPill = pill(m.status === 'approved' ? 'ok' : m.status === 'planned' ? 'warn' : m.status === 'applied' ? 'warn' : 'bad', PERMIT_STATUS[m.status]);
    const overdue = m.status === 'planned' && m.flyingDateISO < addDays(todayISOStr, 1);
    if (overdue) statusPill = pill('expired', '已错失申请窗口');
    const action = m.status === 'planned'
      ? `<button class="btn small" data-action="show-submit-application" data-idx="${m.id}">登记已提交</button>`
      : m.status === 'applied'
        ? `<button class="btn small" data-action="show-decide-permit" data-idx="${m.id}">登记批复</button>`
        : m.status === 'approved' && !m.preDepISO
          ? `<button class="btn small" data-action="show-predep" data-idx="${m.id}">登记起飞前报告</button>`
          : '';
    return `<tr><td>${esc(m.flyingDateISO)}</td><td>${esc(PERMIT_REASONS[m.reason]?.label || m.reason)}<br><span class="basis">${esc(PERMIT_REASONS[m.reason]?.basis || '')}</span></td>
      <td>${m.submittedISO ? `${esc(m.submittedISO)}（截止 ${esc(applyByISO)} 12:00）` : `<b class="warn">未申请</b><br><span class="basis">截止 ${esc(applyByISO)} 12:00</span>`}</td>
      <td>${m.decidedISO ? `${esc(m.decidedISO)}${m.permitNo ? ` · ${esc(m.permitNo)}` : ''}` : '—'}${m.preDepISO ? `<br><span class="basis">起飞前报告 ${esc(m.preDepISO)}</span>` : ''}</td>
      <td>${statusPill}</td><td>${action}</td></tr>`;
  }).join('');

  return `
  <section class="card">
    <h3>${icon('permit')} 申请台账（条例第19/26/30/31/61条）</h3>
    <p class="basis">红线时钟：<b>拟飞行前 1 日 12 时前</b>提交申请；空管在<b>飞行前 1 日 21 时前</b>批复；起飞前 <b>1 小时</b>报告并经确认。错过窗口=今天飞不了，改期重来。</p>
    ${rows ? `<table class="tbl"><thead><tr><th>拟飞日</th><th>事由</th><th>申请（截止前1日12时）</th><th>批复（前1日21时前）/ 起飞前报告</th><th>状态</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="dim">暂无申请。管制空域、飞越集会人群、投放物品、中继/集群飞行、存量机——都要先建申请。</p>'}
  </section>
  <section class="card">
    <h3>建申请</h3>
    ${activeUas.length && pilots.length ? `
    <div class="formgrid">
      <label>无人机<select id="pm-uas">${activeUas.map((u) => `<option value="${u.id}">${esc(u.nickname)}</option>`).join('')}</select></label>
      <label>操控员<select id="pm-pilot">${pilots.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label>拟飞行日期 *<input id="pm-date" type="date" value="${addDays(todayISOStr, 2)}" /></label>
      <label>申请事由<select id="pm-reason">${Object.entries(PERMIT_REASONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
      <label class="wide">飞行地点 / 任务说明<input id="pm-location" placeholder="例：示例高铁站周边航拍" /></label>
    </div>
    <div class="row"><button class="btn" data-action="create-permit">建申请</button>
      <span class="basis">建好后立刻安排提交——窗口是「前 1 日 12 时」，本工具会硬性拦截逾期提交。</span></div>`
      : '<p class="dim">先到机队/人员建档。</p>'}
  </section>`;
}

/* ------------------------------------------------------------- 检修账 */

export function viewIssues(state, todayISOStr = todayISO()) {
  const rows = [...state.issues].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((h) => {
    const uas = state.uas.find((u) => u.id === h.uasId);
    const overdue = h.status === 'open' && h.deadlineISO && h.deadlineISO < todayISOStr;
    return `<tr><td>${esc(h.dateISO)}</td><td>${esc(uas?.nickname || '—')}</td><td>${esc(h.item)}</td>
      <td>${esc(h.measure)}${h.deadlineISO ? `<span class="basis"> 期限 ${esc(h.deadlineISO)}</span>` : ''}</td>
      <td>${h.status === 'closed' ? pill('ok', `${esc(h.closedISO)} 闭环`) : overdue ? pill('expired', '超期未闭环') : pill('warn', '在册')}</td>
      <td>${h.status === 'open' ? `<button class="btn small" data-action="show-close-issue" data-idx="${h.id}">销案</button>` : ''}</td></tr>`;
  }).join('');
  return `
  <section class="card">
    <h3>${icon('hazard')} 检修账（第32条(二)：飞行前检查无人机状态——带病机不开飞）</h3>
    ${rows ? `<table class="tbl"><thead><tr><th>发现日</th><th>无人机</th><th>事项</th><th>处置措施</th><th>状态</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="dim">在册无检修项。航前检查有异常会自动到这里。</p>'}
  </section>`;
}

/* ------------------------------------------------------------- 周期义务 */

export function viewDuties(state, todayISOStr = todayISO()) {
  const rows = dutyBoard(state, todayISOStr).map((d) => `
    <div class="item duty">
      <div><b>${esc(d.label)}</b><br><span class="basis">${esc(d.basis)}</span></div>
      <div class="grow"></div>
      <div class="dutywhen">${d.lastDoneISO ? `${esc(d.lastDoneISO)}<br>→ ${esc(d.dueISO)}${d.days !== null ? `（${d.days < 0 ? `逾期 ${-d.days} 天` : `剩 ${d.days} 天`}）` : ''}` : '<span class="warnline">从未登记</span>'}</div>
      ${pill(d.level)}
      <button class="btn small" data-action="show-set-duty" data-idx="${d.kind}">登记完成</button>
    </div>`).join('');
  return `
  <section class="card">
    <h3>${icon('clock')} 周期义务账（法定周期钉死，「定期」口径参数化，属地永远赢）</h3>
    ${rows}
  </section>`;
}

/* ------------------------------------------------------------- 出证 */

export function viewReports(state, repMonth = null, cached = null, todayISOStr = todayISO()) {
  const month = repMonth || todayISOStr.slice(0, 7);
  const closedFlights = state.flights.filter((f) => f.status === 'closed').sort((a, b) => String(b.landingISO).localeCompare(String(a.landingISO))).slice(0, 10);
  return `
  <section class="card">
    <h3>${icon('reports')} 月度小结（微信文本）</h3>
    <div class="row"><label>月份 <input id="rep-month" type="month" value="${month}" /></label>
      <button class="btn" data-action="rep-gen">生成</button>
      <button class="btn ghost" data-action="rep-copy">${icon('copy')} 复制</button>
      <button class="btn ghost" data-action="rep-download">${icon('dl')} 下载</button></div>
    <pre id="rep-text" class="reptext">${esc(cached ?? '(点「生成」汇总本月台账)')}</pre>
  </section>
  <section class="card">
    <h3>${icon('shield')} 迎检自证包（单文件 HTML · 含签字栏）</h3>
    <p class="basis">主体档案 + 判档一机一档两钟 + 操控员执照检查 + 申请批复台账 + 近期架次 + 检修闭环 + 周期义务 + 体检打分——检查来了 30 秒出证。</p>
    <div class="row">
      <button class="btn" data-action="inspect-download">${icon('dl')} 下载</button>
      <button class="btn ghost" data-action="inspect-print">${icon('print')} 直接打印</button>
    </div>
  </section>
  <section class="card">
    <h3>${icon('print')} 飞行记录卡（近 10 个已闭环）</h3>
    ${closedFlights.length ? `<div class="cards">${closedFlights.map((f) => {
      const u = state.uas.find((x) => x.id === f.uasId);
      return `<button class="btn small ghost" data-action="print-flight-card" data-idx="${f.id}">${esc(f.dateISO)} · ${esc(u?.nickname || '')}</button>`;
    }).join('')}</div>` : '<p class="dim">还没有已闭环架次。</p>'}
  </section>`;
}

/* ------------------------------------------------------------- 设置 */

export function viewSettings(state) {
  const s = state.settings;
  const org = state.org;
  const numField = (key, label) => `<label>${label}<input id="set-${key}" type="number" value="${s[key]}" /></label>`;
  return `
  <section class="card">
    <h3>主体信息（个人飞手 / 单位）</h3>
    <div class="formgrid">
      <label>名称 *<input id="org-name" value="${esc(org.name)}" placeholder="例：云雀低空工作室 / 张三（个人飞手）" /></label>
      <label>主体性质<select id="org-mode">
        <option value="personal" ${org.orgMode !== 'unit' ? 'selected' : ''}>个人飞手</option>
        <option value="unit" ${org.orgMode === 'unit' ? 'selected' : ''}>单位（工作室/服务队/公司）</option>
      </select></label>
      <label>业务类型<input id="org-kind" value="${esc(org.kind)}" placeholder="例：航拍/植保/巡检/测绘" /></label>
      <label>属地（区县）<input id="org-district" value="${esc(org.district)}" /></label>
      <label>责任人<input id="org-manager" value="${esc(org.manager)}" /></label>
      <label>联系电话<input id="org-phone" value="${esc(org.phone)}" /></label>
      <label>运营合格证号（单位必填，条例第11条）<input id="org-opcert" value="${esc(org.opCertNumber)}" placeholder="例：运合-XXXX" /></label>
      <label>运营合格证颁发日<input id="org-opcertdate" type="date" value="${esc(org.opCertIssueISO)}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-org">保存主体信息</button></div>
  </section>
  <section class="card">
    <h3>口径参数（属地实施办法与空管要求永远赢，改这里即可覆盖）</h3>
    <div class="formgrid">
      ${numField('certWarnDays', '证照黄线（天）')}
      ${numField('certRedDays', '证照红线（天）')}
      ${numField('licenseYears', '操控员执照有效期（年，92.61）')}
      ${numField('profCheckMonths', '定期检查周期（月，92.81）')}
      ${numField('profCheckLargeMonths', '大型/IFR熟练检查周期（月，92.83）')}
      ${numField('agriCertMonths', '农用操作证书复训（月，厂家口径）')}
      ${numField('annualReportDays', '年度运营报告（天，92.671）')}
      ${numField('uasInfoUpdateDays', '性能参数复核（天，第14条）')}
      ${numField('batteryCheckDays', '电池健康检查（天，工具口径）')}
      ${numField('firmwareDays', '固件与电子围栏更新（天，第32条(二)）')}
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存口径参数</button></div>
  </section>
  <section class="card">
    <h3>数据（本地优先）</h3>
    <div class="row">
      <button class="btn ghost" data-action="data-export">${icon('dl')} 导出备份 JSON</button>
      <label class="btn ghost filelabel">导入备份<input id="data-import" type="file" accept="application/json" data-action="data-import" /></label>
      <button class="btn ghost" data-action="seed-demo">载入示例数据</button>
    </div>
    <p class="basis">全部数据只存本机浏览器 localStorage；不存客户身份信息（数据最小披露）。飞行数据记录建议留存 ≥12 个月、申请数据 ≥15 个月（92.547），导出备份即离线归档。</p>
  </section>`;
}
