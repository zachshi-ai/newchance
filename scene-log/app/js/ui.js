/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  AGE_RANGES, SCRIPT_KINDS, DAY_TYPE_TEXT, SETUP_ITEMS, DEFAULT_LIMITS,
  dayTypeOf, minorsAllowedOn, filingClock, venueFilingClock, sessionViolations,
  monthlyCheckStatus, drillStatus, trainingStatus, extinguisherBoard,
  healthCheck, setupBoard, monthKey, escapeHtml, todayISO, addDays, expiryClock,
  monthlySummaryText,
} from './core.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// 内联 SVG 图标（stroke: currentColor；零依赖、随主题变色）
// ---------------------------------------------------------------------------

const IC = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  board: IC('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  scripts: IC('<path d="M5 4.5h11a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z"/><path d="M5 4.5v13.2"/><path d="M9 9h6M9 12.5h6M9 16h4"/>'),
  ledger: IC('<path d="M4 20l1.2-4.2L16.6 4.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M13.5 7.5l3 3"/>'),
  duties: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  venue: IC('<path d="M4 10v10h16V10"/><path d="M3 10l2-5h14l2 5"/><path d="M3 10h18"/><path d="M10 20v-5h4v5"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  shield: IC('<path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.3-7 9-4.1-1.7-7-4.7-7-9V5.8z"/><path d="M9 11.8l2.2 2.2L15.4 9.6"/>'),
  mask: IC('<path d="M4 5h16v6a8 8 0 0 1-16 0z"/><path d="M8.5 10h.01M15.5 10h.01"/><path d="M9.5 14.5c.8.8 1.7 1.2 2.5 1.2s1.7-.4 2.5-1.2"/>'),
  box: IC('<path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2z"/><path d="M4 7.2l8 4.2 8-4.2M12 11.4V21"/>'),
  trash: IC('<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.5h9.2L17.5 7"/><path d="M10.2 10.5v6M13.8 10.5v6"/>'),
  calendar: IC('<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>'),
  trend: IC('<path d="M3 7.5l5.5 5.5 3.5-3.5L20.5 18"/><path d="M20.5 12.5V18H15"/>'),
  alert: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  gauge: IC('<path d="M5 20a9 9 0 1 1 14 0"/><path d="M12 13l3.5-3.5"/><circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  up: IC('<path d="M12 19V8.5"/><path d="M7.5 13 12 8.5 16.5 13"/><path d="M5 4.5h14"/>'),
  fire: IC('<path d="M12 3c1 3-2.5 4.5-2.5 7a2.5 2.5 0 0 0 5 .3c1.6 1 2.5 2.5 2.5 4.2A5 5 0 0 1 12 19a5 5 0 0 1-5-5c0-4.5 4-6 5-11z"/><path d="M12 21a7.5 7.5 0 0 0 7.5-7.5c0-4.8-4.6-6.6-4-12" opacity=".45"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', unset: 'bad', warn: 'warn', todo: 'warn', ok: 'ok', red: 'bad' };
const LEVEL_TEXT = { ok: '正常', warn: '临窗', todo: '待办', overdue: '逾期', unset: '未录' };
const pill = (lv) => `<span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span>`;

/** 体检分计分环 */
export function scoreRing(score, small = false) {
  if (score === null || score === undefined) return '';
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

const daysCn = (n) => (n === null || n === undefined ? '' : n < 0 ? `已过 ${-n} 天` : `还剩 ${n} 天`);

// ---------------------------------------------------------------------------
// 今日看板
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  const today = todayISO();
  const cal = state.calendar;
  const dt = dayTypeOf(today, cal);
  const allowed = minorsAllowedOn(today, cal);
  const hc = healthCheck(state, today);
  const hasVenue = !!(state.venue && state.venue.name);

  if (!hasVenue) {
    return `
    <div class="card lead">
      <h2>开张第一件事：给门店建一张场记单</h2>
      <p class="muted">场记单是小微剧本娱乐场所（剧本杀·密室）自己的合规底账：场所与剧本的<b>报备钟</b>、未成年人<b>时段红线</b>（2026 假日表已内置，调休补班的周六日按工作日判定）、消防指南的<b>每局防火巡查</b>与月检/半年演练/年培训四钟，最后一键出「迎检自证包」。</p>
      <p><a class="btn" href="#/venue">先建档门店</a> <a class="btn ghost" href="#/scripts">再上剧本</a> <button class="btn ghost" data-act="load-sample">先看示例数据</button></p>
    </div>`;
  }

  const v = state.venue;
  const sessionsToday = (state.sessions || []).filter((s) => s.dateISO === today);
  const missPatrol = sessionsToday.filter((s) => !s.patrol);
  const vfc = v.openedISO ? venueFilingClock(v.openedISO, v.filedISO, today, state.limits) : { level: 'unset' };
  const scriptClocks = (state.scripts || []).map((s) => ({ s, c: filingClock(s, today, state.limits) }));
  const badScripts = scriptClocks.filter(({ c }) => c.level === 'overdue' || c.level === 'unset');
  const warnScripts = scriptClocks.filter(({ c }) => c.level === 'warn');
  const mc = monthlyCheckStatus(state.checks || [], today, state.limits);
  const dr = drillStatus(state.drills || [], today, state.limits);
  const tr = trainingStatus(state.trainings || [], today, state.limits);
  const ex = extinguisherBoard(state.extinguishers || [], today, state.limits);

  const alertCards = [];
  if (!allowed) {
    alertCards.push(`
    <div class="card alert issue">
      <div class="alert-head"><span class="alert-ic">${icon('alert')}</span><strong>今日${esc(DAY_TYPE_TEXT[dt])}：不得向未成年人提供剧本娱乐活动</strong></div>
      <p class="muted">除国家法定节假日、休息日及寒暑假期外不得接待未成年人（文旅市场发〔2022〕70号）。今日是<b>${esc(DAY_TYPE_TEXT[dt])}</b>，开场请照常核验——若遇未成年人订场，礼貌改期。</p>
    </div>`);
  } else {
    alertCards.push(`
    <div class="card alert good">
      <div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今日${esc(DAY_TYPE_TEXT[dt])}：可接待未成年人（需核验年龄并留痕）</strong></div>
    </div>`);
  }
  if (missPatrol.length) {
    alertCards.push(`
    <div class="card alert issue">
      <div class="alert-head"><span class="alert-ic">${icon('fire')}</span><strong>今日 ${missPatrol.length} 场未做局后防火巡查</strong></div>
      <ul>${missPatrol.map((s) => `<li>${esc(s.start || '')} ${esc(state.scripts.find((x) => x.id === s.scriptId)?.name || '')} —— 消防指南（八）：每局活动结束后必须进行一次防火巡查</li>`).join('')}</ul>
      <p><button class="btn small" data-act="patrol-all-today">一键补打今日全部巡查</button></p>
    </div>`);
  }
  if (badScripts.length) {
    alertCards.push(`
    <div class="card alert issue">
      <div class="alert-head"><span class="alert-ic">${icon('alert')}</span><strong>${badScripts.length} 个剧本未备案或已逾期</strong></div>
      <ul>${badScripts.map(({ s, c }) => `<li>${esc(s.name)}：${c.level === 'unset' ? '未录开始使用日' : `已逾期，到期 ${esc(c.dueISO)}`}</li>`).join('')}</ul>
    </div>`);
  }
  if (vfc.level === 'overdue') {
    alertCards.push(`
    <div class="card alert issue">
      <div class="alert-head"><span class="alert-ic">${icon('alert')}</span><strong>场所备案已逾期</strong></div>
      <p class="muted">营业日 ${esc(v.openedISO)} 起 ${state.limits.filingDays} 自然日内应完成场所备案（告知性备案），到期 ${esc(vfc.dueISO)}。请登录全国文化市场技术监管与服务平台办理后在「场所」页登记回执。</p>
    </div>`);
  }

  const dutyChips = [
    { k: '场所报备', lv: vfc.level, sub: vfc.level === 'ok' ? `已备 ${v.filedISO}` : vfc.dueISO ? daysCn(vfc.daysLeft) : '未录营业日' },
    { k: '剧本报备', lv: badScripts.length ? 'overdue' : warnScripts.length ? 'warn' : state.scripts.length ? 'ok' : 'unset', sub: `${badScripts.length} 逾期 / ${warnScripts.length} 临窗` },
    { k: '月度检查', lv: mc.level, sub: mc.level === 'ok' ? '本月已检' : '本月未检' },
    { k: '半年演练', lv: dr.level, sub: `白天${dr.hasDay ? '✓' : '✗'} 夜间${dr.hasNight ? '✓' : '✗'}` },
    { k: '年度培训', lv: tr.level, sub: tr.lastISO ? `上次 ${tr.lastISO}` : '从未' },
    { k: '灭火器', lv: ex.level, sub: ex.level === 'unset' ? '未建台账' : `最近 ${ex.worst?.dueISO ?? '—'}` },
  ];

  const week = [];
  for (let i = 0; i < 14; i += 1) {
    const iso = addDays(today, i);
    const t = dayTypeOf(iso, cal);
    const ok = minorsAllowedOn(iso, cal);
    week.push(`<div class="day ${ok ? 'open' : 'shut'} ${i === 0 ? 'today' : ''}"><span class="d">${iso.slice(5)}</span><span class="t">${esc(DAY_TYPE_TEXT[t])}</span></div>`);
  }

  return `
  <div class="card lead">
    <div class="hero">
      <div class="hero-top">
        <div class="hero-title"><h3>${esc(v.name)} · ${esc(DAY_TYPE_TEXT[dt])}</h3>
        <p>${allowed ? '今日可接待未成年人' : '今日不得接待未成年人'} · 开本 ${sessionsToday.length} 场</p></div>
        ${scoreRing(hc.score)}
      </div>
      <div class="hero-chips">
        ${dutyChips.map((c) => `<div class="chip ${LEVEL_PILL[c.lv] === 'bad' ? 'bad' : LEVEL_PILL[c.lv] === 'warn' ? 'warn' : 'ok'}"><div class="chip-label">${esc(c.k)} ${pill(c.lv)}</div><div class="chip-sub">${esc(c.sub)}</div></div>`).join('')}
      </div>
    </div>
  </div>
  ${alertCards.join('')}
  <div class="sec"><h3>未来 14 天 · 未成年人时段闸</h3><p class="fine">绿=可接待未成年人（法定节假日/休息日/寒暑假）；红=不得接待（工作日与调休补班日）。假日本地可改，年度安排永远赢。</p>
    <div class="week">${week.join('')}</div>
  </div>
  <div class="sec"><h3>今日八灯体检</h3>
    <div class="lamp-grid">${hc.lamps.map((l) => `<div class="lamp ${l.level === 'ok' ? '' : l.level === 'warn' ? 'w' : 'b'}"><b>${esc(l.label)}</b><span class="lamp-pill">${pill(l.level)}</span><span class="fine">${esc(l.detail)}</span></div>`).join('')}</div>
    <p><a class="btn ghost small" href="#/reports">看体检明细与自证包 →</a></p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 剧本库
// ---------------------------------------------------------------------------

export function viewScripts(state) {
  const today = todayISO();
  const rows = (state.scripts || []).map((s) => {
    const c = filingClock(s, today, state.limits);
    const played = (state.sessions || []).filter((se) => se.scriptId === s.id).length;
    return `<tr>
      <td><b>${esc(s.name)}</b><span class="fine">${esc(SCRIPT_KINDS[s.kind] || '')}${s.author ? ` · ${esc(s.author)}` : ''}</span></td>
      <td>${esc(AGE_RANGES[s.ageRange] || '—')}${s.restrictedScene ? '<span class="pill bad">场景禁入</span>' : ''}</td>
      <td>${esc(s.useStartISO || '—')}</td>
      <td>${c.level === 'ok' ? `${pill('ok')}<span class="fine">备 ${esc(c.filedISO)}${s.filingNo ? ` · ${esc(s.filingNo)}` : ''}</span>` : `${pill(c.level)}<span class="fine">${c.level === 'unset' ? '未录开始使用日' : `${daysCn(c.daysLeft)}（${esc(c.dueISO)}）`}</span>`}</td>
      <td>${s.selfReviewedISO ? `自审 ${esc(s.selfReviewedISO)}` : '<span class="pill bad">未自审</span>'}</td>
      <td>${played}</td>
      <td class="row">
        ${c.level !== 'ok' ? `<button class="btn small" data-act="file-script" data-id="${s.id}">登记备案</button>` : `<button class="btn small ghost" data-act="file-script" data-id="${s.id}">改回执</button>`}
        ${!s.selfReviewedISO ? `<button class="btn small ghost" data-act="review-script" data-id="${s.id}">记自审</button>` : ''}
        <button class="btn small ghost" data-act="change-script" data-id="${s.id}">实质变更</button>
        <button class="btn small ghost" data-act="del-script" data-id="${s.id}">删</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">还没有剧本——先上第一本。</td></tr>';

  return `
  <div class="card lead"><h2>剧本库 · 报备钟</h2>
    <p class="muted">剧本脚本应当设置<b>适龄提示</b>；自开始使用之日起 <b>${state.limits.filingDays} 个自然日</b>内通过「全国文化市场技术监管与服务平台」备案，<b>新增或内容实质变更</b>重新起算（办综执发〔2023〕37号线检查口径）。18岁+ 或场景禁入的剧本永远不得接待未成年人。</p>
  </div>
  <div class="card"><div class="tbl"><table>
    <thead><tr><th>剧本</th><th>适龄</th><th>开始使用</th><th>报备钟</th><th>内容自审</th><th>开本</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>
  <div class="card">
    <h3>上新剧本</h3>
    <form class="form-grid" data-form="add-script">
      <label>剧本名 *<input id="sc-name" required placeholder="如：月境迷环"></label>
      <label>类型<select id="sc-kind">${Object.entries(SCRIPT_KINDS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>作者/发行方<input id="sc-author" placeholder="选填"></label>
      <label>适龄范围 *<select id="sc-age">${Object.entries(AGE_RANGES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label class="span2"><input type="checkbox" id="sc-restricted"> 设置的场景不适宜未成年人（显著位置提示 + 不得允许进入）</label>
      <label>开始使用日 *<input id="sc-use" type="date" required value="${todayISO()}"></label>
      <label>内容自审日<input id="sc-review" type="date"></label>
      <label>备注<input id="sc-note" placeholder="选填"></label>
      <div class="span2"><button class="btn" type="submit">建本上钟</button></div>
    </form>
  </div>`;
}

// ---------------------------------------------------------------------------
// 开本台账
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const cal = state.calendar;
  const dt = dayTypeOf(today, cal);
  const allowed = minorsAllowedOn(today, cal);
  const sessions = (state.sessions || []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO) || (b.start || '').localeCompare(a.start || ''));
  const rows = sessions.slice(0, 120).map((se) => {
    const sc = state.scripts.find((s) => s.id === se.scriptId);
    const viols = sc ? sessionViolations(se, sc, cal) : [];
    return `<tr class="${viols.some((x) => x.sev === 'red') ? 'bad-row' : ''}">
      <td>${esc(se.dateISO)}<span class="fine">${esc(DAY_TYPE_TEXT[dayTypeOf(se.dateISO, cal)])}</span></td>
      <td>${esc(se.start || '—')}</td>
      <td>${esc(sc?.name || '已删剧本')}</td>
      <td>${se.players}</td>
      <td>${se.minors ? `${se.minors}${se.ageChecked ? '（已核验）' : '<span class="pill warn">未核验</span>'}` : '—'}</td>
      <td>${se.patrol ? '<span class="pill ok">已巡查</span>' : '<span class="pill warn">缺巡查</span>'}</td>
      <td>${viols.length ? viols.map((x) => `<span class="pill ${x.sev === 'red' ? 'bad' : 'warn'}">${esc(x.text)}</span>`).join(' ') : '<span class="fine">—</span>'}</td>
      <td class="row"><button class="btn small ghost" data-act="patrol-session" data-id="${se.id}" ${se.patrol ? 'disabled' : ''}>巡查打卡</button><button class="btn small ghost" data-act="del-session" data-id="${se.id}">撤</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="muted">还没有开本记录。</td></tr>';

  const issues = (state.issues || []).slice().sort((a, b) => (a.status === b.status ? b.dateISO.localeCompare(a.dateISO) : a.status === 'open' ? -1 : 1));
  const issueRows = issues.map((it) => `<tr class="${it.status === 'open' ? 'bad-row' : ''}">
    <td>${esc(it.dateISO)}</td><td>${esc(it.desc)}${it.note ? `<span class="fine">${esc(it.note)}</span>` : ''}</td>
    <td>${it.status === 'fixed' ? `<span class="pill ok">已闭环 ${esc(it.closedISO)}</span><span class="fine">${esc(it.fix)}</span>` : '<span class="pill bad">未闭环</span>'}</td>
    <td class="row">${it.status === 'open' ? `<button class="btn small" data-act="close-issue" data-id="${it.id}">销案</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">暂无隐患记录。</td></tr>';

  return `
  <div class="card lead"><h2>开本台账 · 每局防火巡查</h2>
    <p class="muted">消防指南（八）：<b>每局剧本娱乐活动结束后必须进行一次防火巡查</b>；今日是<b>${esc(DAY_TYPE_TEXT[dt])}</b>，${allowed ? '可接待未成年人，开场请核验年龄并留痕' : '<b>不得接待未成年人</b>'}。玩家只记人数与年龄核验标记，不采集个人信息。</p>
  </div>
  <div class="card">
    <h3>登记一场开本</h3>
    <form class="form-grid" data-form="add-session">
      <label>日期 *<input id="ss-date" type="date" required value="${today}"></label>
      <label>开场时间<input id="ss-start" type="time" value="19:30"></label>
      <label>剧本 *<select id="ss-script">${state.scripts.map((s) => `<option value="${s.id}">${esc(s.name)}（${esc(AGE_RANGES[s.ageRange] || '')}${s.restrictedScene ? '·禁入' : ''}）</option>`).join('') || '<option value="">请先建剧本</option>'}</select></label>
      <label>玩家人数 *<input id="ss-players" type="number" min="1" max="30" required placeholder="6"></label>
      <label>其中未成年人<input id="ss-minors" type="number" min="0" max="30" value="0"></label>
      <label class="span2"><input type="checkbox" id="ss-ageck"> 已核验未成年玩家年龄（学生证/身份证/家长确认，门店自选方式留痕）</label>
      <div class="span2"><button class="btn" type="submit" ${state.scripts.length ? '' : 'disabled'}>开本落账</button></div>
    </form>
  </div>
  <div class="card"><div class="tbl"><table>
    <thead><tr><th>日期</th><th>开场</th><th>剧本</th><th>人数</th><th>未成年</th><th>局后巡查</th><th>合规提示</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>
  <div class="card"><h3>隐患整改闭环</h3>
    <form class="form-grid" data-form="add-issue">
      <label>发现日<input id="is-date" type="date" value="${today}"></label>
      <label class="span2">隐患描述 *<input id="is-desc" required placeholder="如：三号房应急照明灯不亮"></label>
      <div class="span2"><button class="btn" type="submit">登记隐患</button></div>
    </form>
    <div class="tbl"><table><thead><tr><th>发现日</th><th>隐患</th><th>状态</th><th></th></tr></thead><tbody>${issueRows}</tbody></table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 周期义务
// ---------------------------------------------------------------------------

export function viewDuties(state) {
  const today = todayISO();
  const mc = monthlyCheckStatus(state.checks || [], today, state.limits);
  const dr = drillStatus(state.drills || [], today, state.limits);
  const tr = trainingStatus(state.trainings || [], today, state.limits);
  const ex = extinguisherBoard(state.extinguishers || [], today, state.limits);

  const checkRows = (state.checks || []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 18)
    .map((c) => `<tr><td>${esc(c.dateISO)}</td><td>${esc(c.findings || '无异常')}</td><td>${esc(c.fixed || '—')}</td><td class="row"><button class="btn small ghost" data-act="del-check" data-id="${c.id}">删</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">暂无月检记录。</td></tr>';
  const drillRows = (state.drills || []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12)
    .map((d) => `<tr><td>${esc(d.dateISO)}</td><td>${d.phase === 'day' ? '白天' : '夜间'}</td><td>${esc(d.note || '')}</td><td class="row"><button class="btn small ghost" data-act="del-drill" data-id="${d.id}">删</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">暂无演练记录。</td></tr>';
  const trainRows = (state.trainings || []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12)
    .map((t) => `<tr><td>${esc(t.dateISO)}</td><td>${esc(t.topic || '消防安全培训')}</td><td>${esc(t.coverage || '')}</td><td class="row"><button class="btn small ghost" data-act="del-training" data-id="${t.id}">删</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">暂无培训记录。</td></tr>';
  const extRows = (state.extinguishers || []).map((x) => {
    const c = expiryClock(x.nextCheckISO, today, state.limits);
    return `<tr><td>${esc(x.location || '—')}</td><td>${x.count ?? '—'}</td><td>${esc(x.nextCheckISO)}<span class="fine">${daysCn(c.daysLeft)}</span></td><td>${pill(c.level)}</td></tr>`;
  }).join('');

  return `
  <div class="card lead"><h2>周期义务四钟</h2>
    <p class="muted">消防指南（八）（九）（十）：每局巡查之外，<b>每月至少一次全面防火检查</b>、<b>每半年至少一次全员演练（白天与夜间各一）</b>、<b>每年至少一次消防安全培训</b>（新员工上岗前另训）；灭火器等设施定期维护检测。</p>
  </div>
  <div class="sec"><div class="lamp-grid">
    <div class="lamp ${mc.level === 'ok' ? '' : mc.level === 'warn' ? 'w' : 'b'}"><b>月度防火检查</b><span class="lamp-pill">${pill(mc.level)}</span><span class="fine">${mc.level === 'ok' ? '本月已检' : `本月未检（${state.limits.monthCheckLate} 日起升级红灯）`}</span></div>
    <div class="lamp ${dr.level === 'ok' ? '' : dr.level === 'warn' ? 'w' : 'b'}"><b>半年演练</b><span class="lamp-pill">${pill(dr.level)}</span><span class="fine">白天${dr.hasDay ? '✓' : '✗'} · 夜间${dr.hasNight ? '✓' : '✗'}</span></div>
    <div class="lamp ${tr.level === 'ok' ? '' : tr.level === 'warn' ? 'w' : 'b'}"><b>年度培训</b><span class="lamp-pill">${pill(tr.level)}</span><span class="fine">${tr.lastISO ? `上次 ${esc(tr.lastISO)}` : '从未培训'}</span></div>
    <div class="lamp ${ex.level === 'ok' ? '' : ex.level === 'warn' ? 'w' : 'b'}"><b>灭火器年检</b><span class="lamp-pill">${pill(ex.level)}</span><span class="fine">${ex.level === 'unset' ? '未建台账' : `最近到期 ${esc(ex.worst?.dueISO ?? '—')}`}</span></div>
  </div></div>
  <div class="card"><h3>① 月度全面防火检查（本月打卡）</h3>
    <form class="form-grid" data-form="add-check">
      <label>检查日<input id="ck-date" type="date" value="${today}"></label>
      <label class="span2">发现的问题<input id="ck-find" placeholder="无异常可留空"></label>
      <label class="span2">整改情况<input id="ck-fix" placeholder="有问题必填去向"></label>
      <div class="span2"><button class="btn" type="submit">记本月检查</button></div>
    </form>
    <div class="tbl"><table><thead><tr><th>日期</th><th>发现</th><th>整改</th><th></th></tr></thead><tbody>${checkRows}</tbody></table></div>
  </div>
  <div class="card"><h3>② 灭火和应急疏散演练（半年 · 白天+夜间）</h3>
    <form class="form-grid" data-form="add-drill">
      <label>演练日<input id="dr-date" type="date" value="${today}"></label>
      <label>时段<select id="dr-phase"><option value="day">白天</option><option value="night">夜间</option></select></label>
      <label class="span2">备注<input id="dr-note" placeholder="参与人数/路线/问题"></label>
      <div class="span2"><button class="btn" type="submit">记演练</button></div>
    </form>
    <div class="tbl"><table><thead><tr><th>日期</th><th>时段</th><th>备注</th><th></th></tr></thead><tbody>${drillRows}</tbody></table></div>
  </div>
  <div class="card"><h3>③ 消防安全培训（每年 · 新员工上岗前）</h3>
    <form class="form-grid" data-form="add-training">
      <label>培训日<input id="tr-date" type="date" value="${today}"></label>
      <label>主题<input id="tr-topic" placeholder="如：灭火器+疏散+一键开锁"></label>
      <label>覆盖人数<input id="tr-cov" type="number" min="1" placeholder="全员"></label>
      <div class="span2"><button class="btn" type="submit">记培训</button></div>
    </form>
    <div class="tbl"><table><thead><tr><th>日期</th><th>主题</th><th>覆盖</th><th></th></tr></thead><tbody>${trainRows}</tbody></table></div>
  </div>
  <div class="card"><h3>④ 灭火器台账（每50㎡一组2具5kg ABC · 年检钟）</h3>
    <form class="form-grid" data-form="add-ext">
      <label>位置<input id="ex-loc" required placeholder="如：吧台/三号房门口"></label>
      <label>具数<input id="ex-count" type="number" min="1" value="2"></label>
      <label>下次检测日<input id="ex-next" type="date" required></label>
      <div class="span2"><button class="btn" type="submit">入台账</button></div>
    </form>
    <div class="tbl"><table><thead><tr><th>位置</th><th>具数</th><th>下次检测</th><th>状态</th></tr></thead><tbody>${extRows || '<tr><td colspan="4" class="muted">暂无灭火器台账。</td></tr>'}</tbody></table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 场所档案
// ---------------------------------------------------------------------------

export function viewVenue(state) {
  const today = todayISO();
  const v = state.venue;
  const vfc = v.openedISO ? venueFilingClock(v.openedISO, v.filedISO, today, state.limits) : { level: 'unset' };
  const sb = setupBoard(v.setup);
  const cal = state.calendar;

  const setupRows = sb.items.map((i) => `<label class="check-line"><input type="checkbox" data-setup="${i.id}" ${i.ok ? 'checked' : ''}><span><b>${esc(i.label)}</b><span class="fine">${esc(i.basis)}</span></span></label>`).join('');

  return `
  <div class="card lead"><h2>场所档案 · 选址与设施自查</h2>
    <p class="muted">选址红线（居民楼/住宅、地下二层及以下、学校和幼儿园周边不足 200 米…）与消防设施（报警、灭火器、监控 24h、<b>密室一键开锁</b>…）逐项确认——确认过的每一项都是迎检时的现成答案。</p>
  </div>
  <div class="card">
    <h3>门店信息</h3>
    <form class="form-grid" data-form="save-venue">
      <label>门店名 *<input id="vn-name" required value="${esc(v.name)}"></label>
      <label>负责人<input id="vn-manager" value="${esc(v.manager)}"></label>
      <label>电话<input id="vn-phone" value="${esc(v.phone)}"></label>
      <label class="span2">地址<input id="vn-address" value="${esc(v.address)}"></label>
      <label>面积（㎡）<input id="vn-area" type="number" min="1" value="${esc(v.area)}"></label>
      <label>业态<label class="row"><span><input type="checkbox" id="vn-js" ${v.jubensha ? 'checked' : ''}> 剧本杀</span><span><input type="checkbox" id="vn-esc" ${v.escape ? 'checked' : ''}> 密室</span></label></label>
      <label>营业日（首报钟锚点）<input id="vn-open" type="date" value="${esc(v.openedISO)}"></label>
      <label>场所备案日<input id="vn-filed" type="date" value="${esc(v.filedISO)}"></label>
      <label>备案回执号<input id="vn-filno" value="${esc(v.filingNo)}"></label>
      <label class="span2"><input type="checkbox" id="vn-scope" ${v.scopeAdjusted ? 'checked' : ''}> 营业执照经营范围已含「剧本娱乐活动」</label>
      <label class="span2">消防手续留痕<input id="vn-fire" value="${esc(v.fireCheck)}" placeholder="合格意见书/告知承诺凭证编号"></label>
      <div class="span2"><button class="btn" type="submit">保存门店信息</button>
      ${v.openedISO ? `<span class="fine">场所首报钟：${vfc.level === 'ok' ? `已备案（${esc(v.filedISO)}）` : `${pill(vfc.level)} 到期 ${esc(vfc.dueISO)} · ${daysCn(vfc.daysLeft)}`}</span>` : '<span class="fine">填写营业日后首报钟自动起算（30 自然日）</span>'}</div>
    </form>
  </div>
  <div class="card">
    <h3>选址与设施自查 <span class="fine">${sb.done}/${sb.total} 项确认</span></h3>
    <div class="setup-grid">${setupRows}</div>
    <p class="fine">逐项依据见括号内口径（消防指南一~七、整治清单检查点）；本自查是门店侧留痕，不替代消防部门监督检查。</p>
  </div>
  <div class="card">
    <h3>2026 假日表（时段引擎种子 · 国办发明电〔2025〕7号）</h3>
    <p class="fine">法定节假日 ${cal.holidays.length} 天（含调休连休）｜调休补班 ${cal.workdays.length} 天（${cal.workdays.join('、')}）——补班的周六日按工作日判定，不得接待未成年人｜寒暑假窗口 ${esc(cal.vacWinter?.[0] || '')}~${esc(cal.vacWinter?.[1] || '')}、${esc(cal.vacSummer?.[0] || '')}~${esc(cal.vacSummer?.[1] || '')}。年份更新或属地校历不同，在「设置」页整体覆盖。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表与出证
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, repCache) {
  const today = todayISO();
  const hc = healthCheck(state, today);
  const months = [...new Set((state.sessions || []).map((s) => monthKey(s.dateISO)))].sort().reverse();
  const m = repMonth || months[0] || monthKey(today);
  const summary = repCache ?? monthlySummaryText(state, m, today);

  return `
  <div class="card lead"><h2>账本体检与出证</h2>
    <p class="muted">体检灯逐项点名 → 月度小结发老板群 → <b>迎检自证包</b>（十大检查点逐项对表，含每局巡查/月检/演练/培训/隐患全量台账与签字栏）与<b>每局巡查卡</b>打印上墙。</p>
  </div>
  <div class="card"><h3>八灯体检 · ${hc.score} 分</h3>
    <div class="lamp-grid">${hc.lamps.map((l) => `<div class="lamp ${l.level === 'ok' ? '' : l.level === 'warn' ? 'w' : 'b'}"><b>${esc(l.label)}</b><span class="lamp-pill">${pill(l.level)}</span><span class="fine">${esc(l.detail)}</span></div>`).join('')}</div>
  </div>
  <div class="card"><h3>月度小结</h3>
    <form class="row" data-form="pick-month">
      <select id="rp-month">${(months.length ? months : [monthKey(today)]).map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <button class="btn small" type="submit">生成</button>
      <button class="btn small ghost" type="button" data-act="copy-summary">复制文本</button>
    </form>
    <pre class="preview">${esc(summary)}</pre>
  </div>
  <div class="card"><h3>三通道出证</h3>
    <div class="row">
      <button class="btn" data-act="dl-pack">${icon('dl')} 下载迎检自证包（HTML）</button>
      <button class="btn ghost" data-act="print-pack">${icon('print')} 打印自证包</button>
      <button class="btn ghost" data-act="print-patrol">${icon('print')} 打印今日巡查卡</button>
    </div>
    <p class="fine">自证包为单文件 HTML：无外部资源、可离线存档，含签字栏；对表文旅整治清单十大检查点。巡查卡按消防指南（八）设计，每局一勾。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const lim = state.limits;
  const cal = state.calendar;
  const events = (state.events || []).slice(-30).reverse();
  return `
  <div class="card lead"><h2>设置 · 口径参数与数据自持</h2>
    <p class="muted">所有时限与阈值本地可覆盖；<b>法定假日表、寒暑假窗口、属地规则永远赢</b>——年度安排更新后在此整体替换。</p>
  </div>
  <div class="card"><h3>口径参数</h3>
    <form class="form-grid" data-form="save-limits">
      <label>剧本/场所备案时限（自然日）<input id="lm-filing" type="number" min="1" value="${lim.filingDays}"></label>
      <label>报备钟黄灯提前（天）<input id="lm-fw" type="number" min="1" value="${lim.filingWarn}"></label>
      <label>演练窗口（天）<input id="lm-drill" type="number" min="30" value="${lim.drillDays}"></label>
      <label>培训窗口（天）<input id="lm-train" type="number" min="30" value="${lim.trainingDays}"></label>
      <label>灭火器黄灯提前（天）<input id="lm-ext" type="number" min="1" value="${lim.extWarn}"></label>
      <label>月检升级红灯日（每月几号）<input id="lm-mc" type="number" min="1" max="28" value="${lim.monthCheckLate}"></label>
      <div class="span2"><button class="btn" type="submit">保存参数</button></div>
    </form>
  </div>
  <div class="card"><h3>假日表与寒暑假（每行一个值，逗号分隔）</h3>
    <form class="form-grid" data-form="save-calendar">
      <label class="span2">法定节假日（MM-DD）<textarea id="cl-holidays" rows="3">${cal.holidays.join(',')}</textarea></label>
      <label class="span2">调休补班日（MM-DD）<textarea id="cl-workdays" rows="1">${cal.workdays.join(',')}</textarea></label>
      <label>寒假起<input id="cl-ws" type="date" value="${esc(cal.vacWinter?.[0] || '')}"></label>
      <label>寒假止<input id="cl-we" type="date" value="${esc(cal.vacWinter?.[1] || '')}"></label>
      <label>暑假起<input id="cl-ss" type="date" value="${esc(cal.vacSummer?.[0] || '')}"></label>
      <label>暑假止<input id="cl-se" type="date" value="${esc(cal.vacSummer?.[1] || '')}"></label>
      <div class="span2"><button class="btn" type="submit">保存假日表</button> <span class="fine">种子数据：国办发明电〔2025〕7号（2026）；寒假窗口为默认值，属地校历永远赢。</span></div>
    </form>
  </div>
  <div class="card"><h3>数据自持</h3>
    <div class="row">
      <button class="btn" data-act="export-json">${icon('dl')} 导出备份 JSON</button>
      <label class="btn ghost">${icon('up')} 导入备份<input type="file" id="import-file" accept="application/json" hidden></label>
      <button class="btn ghost" data-act="export-events">导出本地事件流（验证用）</button>
      <button class="btn ghost" data-act="wipe">清空全部数据</button>
    </div>
    <p class="fine">备份含门店/剧本/开本/义务/隐患全量与设置；导入做结构校验，异构文件整体拒绝。事件流为本地埋点（HDD 验证闭环用）。</p>
  </div>
  <div class="card"><h3>最近本地事件</h3>
    <div class="tbl"><table><thead><tr><th>时间</th><th>事件</th><th>详情</th></tr></thead><tbody>
    ${events.map((ev) => `<tr><td class="fine">${esc(ev.at?.slice(0, 19).replace('T', ' ') || '')}</td><td>${esc(ev.type)}</td><td class="fine">${esc(Object.entries(ev).filter(([k]) => !['type', 'at'].includes(k)).map(([k, x]) => `${k}=${x}`).join(' · ') || '—')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">暂无事件。</td></tr>'}
    </tbody></table></div>
  </div>`;
}
