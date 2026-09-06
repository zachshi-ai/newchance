/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  PRECHECK_ITEMS, RECHECK_ITEMS, TRIP_SLOTS, TRIP_STATUS, DUTY_KINDS,
  certLevel, busClocks, driverClocks, driverOk,
  dutyBoard, healthCheck, monthlySummary, staleTrips, openHazards, tripConservation,
  escapeHtml, todayISO, daysUntil, ageOn,
} from './core.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// 内联 SVG 图标（stroke: currentColor；零依赖、随主题变色）
// ---------------------------------------------------------------------------

const IC = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  board: IC('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  bus: IC('<rect x="3" y="5" width="18" height="12" rx="2.4"/><path d="M6.5 8.5h3v3.4h-3zm4.5 0h3v3.4h-3zm4.5 0h3v3.4h-3z"/><path d="M6 20.2a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8zm12 0a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z"/>'),
  roll: IC('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8h6M9 12h6M9 16h3.5"/>'),
  people: IC('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.6c2.3.3 4.2 1.9 4.9 4.4"/>'),
  hazard: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  trash: IC('<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.5h9.2L17.5 7"/><path d="M10.2 10.5v6M13.8 10.5v6"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  copy: IC('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5v-1a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" transform="translate(1.5 1.5) scale(.92)"/>'),
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
    <circle class="ring-fg" cx="22" cy="22" r="18" stroke-dasharray="${(score * 113).toFixed(0)} 113"/>
    <text x="22" y="26" text-anchor="middle">${score}</text></svg></div>`;
}

/* ------------------------------------------------------------- 空态引导 */

export function viewOnboarding() {
  return `
  <section class="hero card">
    <h2>校车每一天的安全，都要能被证明</h2>
    <p>《校车安全管理条例》给每台校车装了四只钟：每半年一次安全技术检验（第20条）、校车标牌有效期（第16条）、交强险与承运人责任保险（第14条）；给每位驾驶人装了年度审验钟（第26条）。而每天上下学的每一趟，都要：出车前检查车况（第41条）、清点上车人数系好安全带（第39条(三)）、<b>核实下车人数、确认全部离车后照管员才能离车</b>（第39条(五)——防遗忘就是这一条）。护学账把「做了」变成「能证明做了」。</p>
    <ol class="onboard">
      <li>「设置」里保存单位信息（名称/责任人/责任书备案日）</li>
      <li>「车辆」一车一档建档（核载、标牌、四只证照钟）</li>
      <li>「人员」登记驾驶人与随车照管员</li>
      <li>每天上下学在「趟次」点名——超员拦下、带病拦下、少一人闭环不了</li>
    </ol>
    <div class="row"><a class="btn" href="#/settings">从单位信息开始</a></div>
  </section>`;
}

/* ------------------------------------------------------------- 看板 */

export function viewBoard(state, todayISOStr = todayISO()) {
  if (!state.buses.length && !state.drivers.length) return viewOnboarding();
  const s = state.settings;
  const hc = healthCheck(state, todayISOStr);
  const activeBuses = state.buses.filter((b) => b.status === 'active');
  const reds = [];
  for (const b of activeBuses) {
    for (const c of busClocks(b, todayISOStr, s)) {
      if (c.level !== 'ok') reds.push({ bus: b.plate, ...c });
    }
  }
  const badDrivers = state.drivers.filter((d) => d.status === 'active' && !driverOk(d, todayISOStr, s));
  const stale = staleTrips(state, todayISOStr);
  const hzOpen = openHazards(state);
  const overdueDuties = dutyBoard(state, todayISOStr).filter((d) => d.level === 'expired');
  const today = state.trips.filter((t) => t.dateISO === todayISOStr && t.status !== 'cancelled');
  const todayClosed = today.filter((t) => t.status === 'closed').length;
  const noTripToday = activeBuses.filter((b) => !state.trips.some((t) => t.busId === b.id && t.dateISO === todayISOStr && t.status !== 'cancelled'));

  const todo = [];
  if (stale.length) todo.push(`处理 <b>${stale.length}</b> 个过日未闭环的趟次（第39条(五) 全数离车确认没完成）→ <a href="#/trips">去趟次</a>`);
  if (hzOpen.length) todo.push(`闭环 <b>${hzOpen.length}</b> 项在册隐患——带病校车开不了趟 → <a href="#/hazards">去隐患</a>`);
  if (reds.length) todo.push(`处理 <b>${reds.length}</b> 只证照红灯/临期钟 → <a href="#/buses">去车辆</a>`);
  if (badDrivers.length) todo.push(`处理 <b>${badDrivers.length}</b> 名驾驶人审验/年龄红线 → <a href="#/people">去人员</a>`);
  if (overdueDuties.length) todo.push(`登记 <b>${overdueDuties.length}</b> 项到期义务（演练/教育/培训/设备/责任书）→ <a href="#/duties">去义务</a>`);
  if (noTripToday.length && !stale.length) todo.push(`今天还没有趟次记录的车辆 <b>${noTripToday.map((b) => esc(b.plate)).join('、')}</b>——出车前先做七项检查（第41条）`);

  return `
  <section class="hero card dark">
    <div class="hero-l">
      <h2>今日安全台</h2>
      <p class="sub">${esc(state.org?.name || '未登记单位')} · ${todayISOStr} · 趟次闭环 ${todayClosed}/${today.length}</p>
      <ul class="redlist">
        ${todo.length ? todo.map((t) => `<li>${t}</li>`).join('') : '<li class="okline">八灯全绿：证照有钟、趟次有名、隐患闭环、义务不欠。</li>'}
      </ul>
    </div>
    ${scoreRing(hc.score)}
  </section>

  <div class="grid2">
    <section class="card">
      <h3>${icon('roll')} 今日趟次（早送学 / 晚接回）</h3>
      ${today.length ? today.map((t) => {
        const b = state.buses.find((x) => x.id === t.busId);
        return `<div class="item"><b>${esc(b?.plate || '?')}</b> · ${TRIP_SLOTS[t.slot]} · ${pill(t.status === 'closed' ? 'ok' : t.status === 'boarded' ? 'warn' : 'warn', TRIP_STATUS[t.status])}
          <a class="btn small ghost" href="#/trips">去点名</a></div>`;
      }).join('') : '<p class="dim">今天还没有趟次。放学前把晚接回的趟次建好。</p>'}
      <div class="row"><a class="btn small" href="#/trips">趟次点名</a></div>
    </section>
    <section class="card">
      <h3>${icon('clock')} 证照钟点名（红/临期）</h3>
      ${reds.length ? reds.slice(0, 6).map((c) => `<div class="item">${pill(c.level, c.level === 'expired' ? '已过期' : c.level === 'red' ? `剩 ${c.days} 天` : `剩 ${c.days} 天`)} <b>${esc(c.bus)}</b> · ${esc(c.label)} <span class="basis">${esc(c.basis)}</span></div>`).join('') : '<p class="dim">四只钟全绿。</p>'}
      <div class="row"><a class="btn small ghost" href="#/buses">一车一档</a></div>
    </section>
    <section class="card">
      <h3>${icon('hazard')} 隐患与整改（第22/41条）</h3>
      ${hzOpen.length ? hzOpen.map((h) => `<div class="item">${pill('red', h.deadlineISO && h.deadlineISO < todayISOStr ? '超期' : '在册')} ${esc(h.item)} <span class="basis">${esc(h.measure)}</span></div>`).join('') : '<p class="dim">在册无未闭环隐患。</p>'}
      <div class="row"><a class="btn small ghost" href="#/hazards">隐患账</a></div>
    </section>
    <section class="card">
      <h3>${icon('clock')} 周期义务（第10/11/12/21/38条）</h3>
      ${overdueDuties.length ? overdueDuties.map((d) => `<div class="item">${pill('expired', d.dueISO ? `逾期 ${-d.days} 天` : '从未登记')} ${esc(d.label)}</div>`).join('') : '<p class="dim">义务无欠账。</p>'}
      <div class="row"><a class="btn small ghost" href="#/duties">义务账</a></div>
    </section>
  </div>`;
}

/* ------------------------------------------------------------- 车辆一车一档 */

export function viewBuses(state, todayISOStr = todayISO()) {
  const s = state.settings;
  const rows = state.buses.filter((b) => b.status === 'active').map((b) => {
    const clocks = busClocks(b, todayISOStr, s);
    return `
    <div class="card buscard">
      <div class="item head">
        <b>${esc(b.plate)}</b><span class="dim">${esc(b.model || '')} · 核载 ${b.seats} 人${b.plateNo ? ` · ${esc(b.plateNo)}` : ''}</span>
        <span class="grow"></span>
        <button class="btn small ghost" data-action="show-inspect-date" data-idx="${b.id}">登记最近检验</button>
        <button class="btn small ghost" data-action="retire-bus" data-idx="${b.id}">停用</button>
      </div>
      <table class="tbl"><thead><tr><th>证照钟</th><th>到期日</th><th>状态</th><th>依据</th></tr></thead><tbody>
      ${clocks.map((c) => `<tr><td>${esc(c.label)}</td><td>${c.dueISO || '—'}</td>
        <td>${c.missing ? pill('expired', '未登记') : pill(c.level, c.level === 'ok' ? '正常' : `${LEVEL_TEXT[c.level]}${c.days !== null ? ` ${c.days} 天` : ''}`)}</td>
        <td class="basis">${esc(c.basis)}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
  }).join('');

  return `
  <section class="card">
    <h3>${icon('bus')} 一车一档（条例第22条：建立安全维护档案）</h3>
    ${rows || '<p class="dim">还没有车辆。核载人数照行驶证签注抄（第15条：行驶证上签注校车类型和核载人数）。</p>'}
  </section>
  <section class="card">
    <h3>车辆建档</h3>
    <div class="formgrid">
      <label>车牌号 *<input id="bus-plate" placeholder="例：示例A·12345" /></label>
      <label>车辆型号<input id="bus-model" placeholder="例：专用幼儿校车 19 座" /></label>
      <label>核定人数 *<input id="bus-seats" type="number" min="1" max="66" placeholder="照行驶证签注抄" /></label>
      <label>校车标牌号<input id="bus-plateno" placeholder="例：校牌-0001" /></label>
      <label>标牌有效期（第16条）<input id="bus-plateexp" type="date" /></label>
      <label>最近安全技术检验（第20条：每半年一次）<input id="bus-inspection" type="date" /></label>
      <label>交强险到期日<input id="bus-cvt" type="date" /></label>
      <label>承运人责任险到期日（第14条(五)）<input id="bus-carrier" type="date" /></label>
      <label class="wide">备注<input id="bus-note" placeholder="使用许可日期、卫星定位装置等" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-bus">建档</button>
      <span class="basis">四只钟能填就填——缺一只就是看板上一盏红灯；「未登记」比「过期」更早暴露。</span></div>
  </section>`;
}

/* ------------------------------------------------------------- 趟次点名 */

function tripActionForm(state, t, todayISOStr) {
  const bus = state.buses.find((b) => b.id === t.busId);
  if (t.status === 'checking') {
    return `
    <div class="step">
      <p class="steptitle"><b>第一步 · 出车前七项检查</b>（条例第41条逐项）</p>
      <div class="checks">
        ${PRECHECK_ITEMS.map((it) => `<label class="chk"><input type="checkbox" id="pc-${t.id}-${it.key}" checked /> ${it.label}</label>`).join('')}
      </div>
      <div id="pc-note-${t.id}" class="hiddennote">
        <p class="warnline">有异常项：必须先登记隐患与整改措施才让检查通过（第22条：不符合安全技术条件的应当停运维修）。</p>
        <div class="formgrid">
          <label class="wide">整改措施 *<input id="pc-measure-${t.id}" placeholder="例：停运换胎，复查后销案" /></label>
          <label>整改期限<input id="pc-deadline-${t.id}" type="date" /></label>
        </div>
      </div>
      <label>检查备注<input id="pc-memo-${t.id}" placeholder="选填" /></label>
      <div class="row"><button class="btn" data-action="submit-precheck" data-idx="${t.id}">完成检查</button>
      <button class="btn ghost" data-action="cancel-trip" data-idx="${t.id}">取消趟次</button></div>
    </div>`;
  }
  if (t.status === 'ready') {
    const warn = t.check?.abnormal ? `<p class="warnline">本趟检查有异常（隐患在册）——隐患闭环前，「发车」会被拒绝（第41条：不得驾驶存在安全隐患的校车上道路行驶）。</p>` : '';
    return `
    <div class="step">
      <p class="steptitle"><b>第二步 · 上车点名</b>（第39条(三)：清点人数、帮助落座系好安全带、确认车门关闭）</p>
      ${warn}
      <div class="formgrid">
        <label>上车点名人数 *<input id="bd-count-${t.id}" type="number" min="0" max="${bus?.seats ?? 99}" placeholder="≤ 核载 ${bus?.seats ?? '?'} 人，超员直接拒绝（第34条）" /></label>
        <label class="chk wide"><input type="checkbox" id="bd-confirm-${t.id}" /> 已清点人数、指导落座系好安全带、确认车门关闭</label>
      </div>
      <div class="row"><button class="btn" data-action="board-trip" data-idx="${t.id}">发车</button>
      <button class="btn ghost" data-action="cancel-trip" data-idx="${t.id}">取消趟次</button></div>
    </div>`;
  }
  if (t.status === 'boarded') {
    return `
    <div class="step">
      <p class="steptitle"><b>第三步 · 下车清点 + 车内三查</b>（第39条(五)：核实下车人数，确认全部离车后本人方可离车）</p>
      <div class="formgrid">
        <label>下车人数 *<input id="al-count-${t.id}" type="number" min="0" value="${t.onCount ?? ''}" /></label>
        <label>中途下车人数<input id="al-mid-${t.id}" type="number" min="0" value="0" /></label>
        <label class="wide">中途下车原因（有人中途下车必填）<input id="al-midnote-${t.id}" placeholder="例：家长中途接走（已电话确认）" /></label>
      </div>
      <p class="basis">人数守恒：下车 + 中途下车必须等于上车 ${t.onCount ?? ''} 人——少一个人，趟次闭环不了。</p>
      <div class="checks">
        ${RECHECK_ITEMS.map((it) => `<label class="chk"><input type="checkbox" id="rc-${t.id}-${it.key}" /> ${it.label}</label>`).join('')}
      </div>
      <div class="row"><button class="btn" data-action="alight-trip" data-idx="${t.id}">确认全数离车，闭环</button></div>
    </div>`;
  }
  if (t.status === 'closed') {
    return `
    <div class="step done">
      <p class="steptitle"><b>✅ 已闭环</b> 上车 ${t.onCount} 人 = 下车 ${t.offCount} 人 + 中途 ${t.midOffCount} 人${t.midNote ? ` · ${esc(t.midNote)}` : ''} · 车内三查已确认</p>
      <div class="row"><button class="btn small ghost" data-action="print-trip-card" data-idx="${t.id}">${icon('print')} 打印点名卡</button></div>
    </div>`;
  }
  return `<p class="dim">${TRIP_STATUS[t.status] || t.status}${t.cancelNote ? ` · ${esc(t.cancelNote)}` : ''}</p>`;
}

export function viewTrips(state, todayISOStr = todayISO()) {
  if (!state.buses.length) return `<section class="card"><p class="dim">先到 <a href="#/buses">车辆</a> 建档，再建趟次。</p></section>`;
  const activeBuses = state.buses.filter((b) => b.status === 'active');
  const drivers = state.drivers.filter((d) => d.status === 'active');
  const escorts = state.escorts.filter((e) => e.status === 'active');
  const trips = [...state.trips].sort((a, b) => (b.dateISO + b.id).localeCompare(a.dateISO + a.id)).slice(0, 40);

  return `
  <section class="card">
    <h3>${icon('roll')} 建趟次</h3>
    ${drivers.length && escorts.length ? `
    <div class="formgrid">
      <label>车辆<select id="tp-bus">${activeBuses.map((b) => `<option value="${b.id}">${esc(b.plate)}（核载 ${b.seats}）</option>`).join('')}</select></label>
      <label>驾驶人（须已登记校车驾驶资格，第23/25条）<select id="tp-driver">${drivers.map((d) => `<option value="${d.id}">${esc(d.name)}${d.qualificationDateISO ? '' : '（未登记资格——会被拒绝）'}</option>`).join('')}</select></label>
      <label>日期<input id="tp-date" type="date" value="${todayISOStr}" /></label>
      <label>趟次<select id="tp-slot"><option value="am">早送学</option><option value="pm">晚接回</option><option value="other">其他趟次</option></select></label>
      <label class="wide">线路 / 停靠点<input id="tp-route" placeholder="例：1 号线（按审核确定的线路行驶，第30条）" /></label>
    </div>
    <p class="basis">随车照管员（第38条：应指派照管人员随车全程照管——一个都不勾，趟次建不起来）：</p>
    <div class="checks">${escorts.map((e2) => `<label class="chk"><input type="checkbox" class="tp-escort" value="${e2.id}" checked /> ${esc(e2.name)}</label>`).join('')}</div>
    <div class="row"><button class="btn" data-action="new-trip">建趟次</button></div>`
      : '<p class="dim">还缺驾驶人或随车照管员——到 <a href="#/people">人员</a> 先登记（第38条：没有照管员的校车不能开）。</p>'}
  </section>
  ${trips.map((t) => {
    const b = state.buses.find((x) => x.id === t.busId);
    const d = state.drivers.find((x) => x.id === t.driverId);
    const isStale = t.dateISO < todayISOStr && !['closed', 'cancelled'].includes(t.status);
    return `
    <div class="card tripcard ${isStale ? 'stale' : ''}">
      <div class="item head">
        <b>${esc(t.dateISO)} · ${TRIP_SLOTS[t.slot]}</b>
        <span class="dim">${esc(b?.plate || '?')} · ${esc(d?.name || '?')} · ${esc(t.route || '')}</span>
        <span class="grow"></span>
        ${pill(t.status === 'closed' ? 'ok' : t.status === 'cancelled' ? 'warn' : isStale ? 'expired' : 'warn', TRIP_STATUS[t.status] || t.status)}
        ${isStale ? pill('expired', '过日未闭环') : ''}
      </div>
      ${tripActionForm(state, t, todayISOStr)}
    </div>`;
  }).join('')}`;
}

/* ------------------------------------------------------------- 人员 */

export function viewPeople(state, todayISOStr = todayISO()) {
  const s = state.settings;
  const drv = state.drivers.filter((d) => d.status === 'active').map((d) => {
    const clocks = driverClocks(d, todayISOStr, s);
    const ok = driverOk(d, todayISOStr, s);
    const audit = clocks.find((c) => c.key === 'audit');
    const age = d.birthdayISO ? ageOn(d.birthdayISO, todayISOStr) : null;
    return `<tr>
      <td><b>${esc(d.name)}</b></td><td>${esc(d.licenseClass || '—')}</td>
      <td>${d.qualificationDateISO ? esc(d.qualificationDateISO) : pill('expired', '未登记资格')}</td>
      <td>${d.auditLastISO ? `${esc(d.auditLastISO)} → ${esc(audit.dueISO)}` : pill('expired', '未登记审验')}
        ${audit && audit.level !== 'ok' && !audit.missing ? ` ${pill(audit.level, LEVEL_TEXT[audit.level])}` : ''}</td>
      <td>${age === null ? '—' : `${age} 岁`} ${age !== null && age > s.driverMaxAge ? pill('expired', `超 ${s.driverMaxAge} 上限`) : ''}</td>
      <td>${ok ? pill('ok') : pill('expired', '禁驾校车')}</td>
      <td><button class="btn small ghost" data-action="retire-driver" data-idx="${d.id}">停用</button></td></tr>`;
  }).join('');
  const esc2 = state.escorts.filter((e) => e.status === 'active').map((e) => `<tr>
      <td><b>${esc(e.name)}</b></td><td>${esc(e.phone || '—')}</td>
      <td class="basis">培训进度见「义务」（第38条：定期安全教育）</td>
      <td><button class="btn small ghost" data-action="retire-escort" data-idx="${e.id}">停用</button></td></tr>`).join('');

  return `
  <section class="card">
    <h3>${icon('people')} 校车驾驶人（第23~26条）</h3>
    ${drv ? `<table class="tbl"><thead><tr><th>姓名</th><th>准驾车型</th><th>取得校车驾驶资格</th><th>最近审验 → 下次（每年）</th><th>年龄（25~60 周岁）</th><th>可驾状态</th><th></th></tr></thead><tbody>${drv}</tbody></table>`
      : '<p class="dim">还没有驾驶人。资格条件（第23条）：相应准驾车型 3 年以上经历、25~60 周岁、近 3 个记分周期无满分记录、无酒驾/犯罪记录等——工具只做钟表与红线，资格认定以公安交管为准。</p>'}
    <div class="formgrid">
      <label>姓名 *<input id="dv-name" /></label>
      <label>准驾车型<input id="dv-class" placeholder="例：A1 / B1" /></label>
      <label>出生日期（算年龄红线）<input id="dv-birth" type="date" /></label>
      <label>取得校车驾驶资格日（第24条：交管签注）<input id="dv-qual" type="date" /></label>
      <label>最近审验日（第26条：每年审验）<input id="dv-audit" type="date" /></label>
      <label>电话<input id="dv-phone" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-driver">登记驾驶人</button></div>
  </section>
  <section class="card">
    <h3>${icon('people')} 随车照管员（第38/39条）</h3>
    ${esc2 ? `<table class="tbl"><thead><tr><th>姓名</th><th>电话</th><th>培训</th><th></th></tr></thead><tbody>${esc2}</tbody></table>`
      : '<p class="dim">还没有照管员。第38条：应指派照管人员随车全程照管；第53条：未指派可处 500 元罚款。</p>'}
    <div class="formgrid">
      <label>姓名 *<input id="es-name" /></label>
      <label>电话<input id="es-phone" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-escort">登记照管员</button></div>
  </section>`;
}

/* ------------------------------------------------------------- 隐患 */

export function viewHazards(state, todayISOStr = todayISO()) {
  const rows = [...state.hazards].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((h) => {
    const bus = state.buses.find((b) => b.id === h.busId);
    const overdue = h.status === 'open' && h.deadlineISO && h.deadlineISO < todayISOStr;
    return `<tr><td>${esc(h.dateISO)}</td><td>${esc(bus?.plate || '—')}</td><td>${esc(h.item)}</td>
      <td>${esc(h.measure)}${h.deadlineISO ? `<span class="basis"> 期限 ${esc(h.deadlineISO)}</span>` : ''}</td>
      <td>${h.status === 'closed' ? pill('ok', `${esc(h.closedISO)} 闭环`) : overdue ? pill('expired', '超期未闭环') : pill('warn', '在册')}</td>
      <td>${h.status === 'open' ? `<button class="btn small" data-action="show-close-hazard" data-idx="${h.id}">销案</button>` : ''}</td></tr>`;
  }).join('');
  return `
  <section class="card">
    <h3>${icon('hazard')} 隐患账（第22条：不符合安全技术条件的应当停运维修，消除安全隐患）</h3>
    ${rows ? `<table class="tbl"><thead><tr><th>发现日</th><th>车辆</th><th>事项</th><th>整改措施</th><th>状态</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="dim">在册无隐患。出车前检查有异常会自动到这里。</p>'}
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
    <h3>${icon('clock')} 周期义务账（「定期」的口径全部参数化，属地永远赢）</h3>
    ${rows}
  </section>`;
}

/* ------------------------------------------------------------- 出证 */

export function viewReports(state, repMonth = null, cached = null, todayISOStr = todayISO()) {
  const month = repMonth || todayISOStr.slice(0, 7);
  const m = monthlySummary(state, month, todayISOStr);
  const closedTrips = state.trips.filter((t) => t.status === 'closed').sort((a, b) => b.closedISO.localeCompare(a.closedISO)).slice(0, 10);
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
    <p class="basis">单位档案 + 一车一档四钟 + 驾驶人资格审验 + 照管员 + 近期趟次守恒 + 隐患闭环 + 周期义务 + 体检打分——开学季检查来了 30 秒出证。</p>
    <div class="row">
      <button class="btn" data-action="inspect-download">${icon('dl')} 下载</button>
      <button class="btn ghost" data-action="inspect-print">${icon('print')} 直接打印</button>
    </div>
  </section>
  <section class="card">
    <h3>${icon('print')} 趟次点名卡（近 10 张已闭环）</h3>
    ${closedTrips.length ? `<div class="cards">${closedTrips.map((t) => {
      const b = state.buses.find((x) => x.id === t.busId);
      return `<button class="btn small ghost" data-action="print-trip-card" data-idx="${t.id}">${esc(t.dateISO)} ${TRIP_SLOTS[t.slot]} · ${esc(b?.plate || '')}</button>`;
    }).join('')}</div>` : '<p class="dim">还没有已闭环趟次。</p>'}
  </section>`;
}

/* ------------------------------------------------------------- 设置 */

export function viewSettings(state) {
  const s = state.settings;
  const org = state.org;
  const numField = (key, label) => `<label>${label}<input id="set-${key}" type="number" value="${s[key]}" /></label>`;
  return `
  <section class="card">
    <h3>单位信息（条例第10/11条）</h3>
    <div class="formgrid">
      <label>单位名称 *<input id="org-name" value="${esc(org.name)}" placeholder="例：小橡树民办幼儿园 / 校车服务公司" /></label>
      <label>单位类型<select id="org-kind">
        ${['民办幼儿园', '民办中小学', '校车服务提供者'].map((k) => `<option ${org.kind === k ? 'selected' : ''}>${k}</option>`).join('')}
      </select></label>
      <label>属地（区县）<input id="org-district" value="${esc(org.district)}" /></label>
      <label>责任人<input id="org-manager" value="${esc(org.manager)}" /></label>
      <label>联系电话<input id="org-phone" value="${esc(org.phone)}" /></label>
      <label>安全管理人员（第10条：配备安全管理人员）<input id="org-officer" value="${esc(org.safetyOfficer)}" /></label>
      <label>责任书备案日（第11条：报教育行政部门备案）<input id="org-bookfile" type="date" value="${esc(org.bookFileDateISO)}" /></label>
      <label class="wide">地址<input id="org-address" value="${esc(org.address)}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-org">保存单位信息</button></div>
  </section>
  <section class="card">
    <h3>口径参数（属地实施办法永远赢，改这里即可覆盖）</h3>
    <div class="formgrid">
      ${numField('certWarnDays', '证照黄线（天）')}
      ${numField('certRedDays', '证照红线（天）')}
      ${numField('inspectionMonths', '安全技术检验周期（月，法定 6，第20条）')}
      ${numField('auditMonths', '驾驶人审验周期（月，法定 12，第26条）')}
      ${numField('driverMaxAge', '驾驶人年龄上限（周岁，第23条(一)）')}
      ${numField('drillCycleDays', '应急演练周期（天，第12条）')}
      ${numField('eduCycleDays', '学生交通安全教育周期（天，第12条）')}
      ${numField('driverEduCycleDays', '驾驶人安全教育周期（天，第10条）')}
      ${numField('escortCycleDays', '照管员培训周期（天，第38条）')}
      ${numField('deviceCycleDays', '安全设备检查周期（天，第21条）')}
      ${numField('bookFileCycleDays', '责任书备案复核周期（天，第11条）')}
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
    <p class="basis">全部数据只存本机浏览器 localStorage；趟次只记人数、不记学生姓名（未成年人信息最小披露）。导出文件含人员联系方式，请妥善保管。</p>
  </section>`;
}
