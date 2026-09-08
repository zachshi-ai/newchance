/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 * 窄屏铁律（#31 judge 教训）：表格 ≤4 列、长文本用 .w 列 clamp、状态用确定性短标签、
 * 日期+说明拆两行、下拉 option 用短文本——禁止 slice 硬截与超宽表。
 */
import {
  SHIP_DOCS, CREW_ROLES, SELFCHECK_ITEMS, DUTY_KINDS, CHANGE_KINDS, DEFECT_SOURCES,
  DEFAULT_SURVEY_WARN_DAYS, DEFAULT_INSURANCE_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
  shipDocBoard, activeCrew, crewCertState, crewHealthState, crewAgeState,
  todaySelfcheck, lastSelfcheck, selfcheckItemsFor,
  openDefects, openChanges, dutyBoard, manningCheck,
  healthCheck, monthlySummary,
  escapeHtml, todayISO,
} from './core.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// 内联 SVG 图标（stroke: currentColor；零依赖、随主题变色）
// ---------------------------------------------------------------------------

const IC = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  board: IC('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>'),
  station: IC('<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9 21v-4h6v4"/><path d="M12 7.5v3M10.5 9h3"/>'),
  ledger: IC('<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1z"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  shield: IC('<path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.3-7 9-4.1-1.7-7-4.7-7-9V5.8z"/><path d="M9 11.8l2.2 2.2L15.4 9.6"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  person: IC('<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.8-3.4 3.4-5.2 6.5-5.2s5.7 1.8 6.5 5.2"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  bell: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  calendar: IC('<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  up: IC('<path d="M12 19V8.5"/><path d="M7.5 13 12 8.5 16.5 13"/><path d="M5 4.5h14"/>'),
  trend: IC('<path d="M3 7.5l5.5 5.5 3.5-3.5L20.5 18"/><path d="M20.5 12.5V18H15"/>'),
  ship: IC('<path d="M12 4.5v9"/><path d="M12 6.5l7 3.2-7 3.2-7-3.2z"/><path d="M4.5 15c2.6 2 5.2 2 7.5 0s4.9-2 7.5 0 3.4 1.7 4.5 0"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', window: 'warn', warn: 'warn', due: 'warn', ok: 'ok', never: 'bad', unset: 'bad', none: 'ok' };
const LEVEL_TEXT = { overdue: '已过期', window: '换发窗口', warn: '临期', due: '临期', ok: '在期', never: '从未开展', unset: '未登记', none: '不适用' };

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
  <h2 class="sec">内河跑船，先有一本能证明「这个航次怎么开的」的账</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>全国水上运输船舶 <strong>11.02 万艘</strong>（2024 公报，一年又减 0.81 万艘——老旧船退出、单船效益要求更高），内河货船多是夫妻船、父子船式的个体船东：一条船 <strong>七八本证</strong>（检验证书、国籍证书 5 年、最低安全配员证书、保险文书……），证书到期日各不相同；船员流动快、适任证书 5 年一换、65 周岁红线一不留神就跨过。而内河条例的罚则是「扣船级」的：<strong>无证擅自航行→暂扣船舶、情节严重没收</strong>（第 64 条）；<strong>未按规定配员航行→船东罚 1 万~10 万、逾期不改责令停航</strong>（第 65 条）；无保险文书→停航+1 万~10 万（第 67 条）。海事登轮检查还要看出航前自查清单（在船保存 ≥2 年）。现状解法是驾驶台抽屉里一摞证+脑子记+微信催——<strong>「证在期、人配齐、自查签」与「能向海事证明」之间，没有任何船东级工具。</strong></p>
    <p><strong>船安单的做法：</strong>船舶建档（四证钟：检验证书照证书录入、国籍证书 5 年+届满前 1 年换发窗口自动黄、配员证书、保险文书）→ 船员名册（适任证书钟+65 周岁红线+健康证明钟）→ <strong>每日开航前自查卡</strong>（五组条目，异常必写处置并自动转缺陷）→ <strong>开航五道闸</strong>（证书在期→保险在期→配员达标→自查已签→缺陷闭环，当场拦截带法条理由；开出来的每张开航单都自带当次快照）→ 缺陷闭环 + 变更登记 + 周期义务账 → 一键出<strong>海事迎检自证包 / 当次开航单</strong>。</p>
    <div class="row">
      <a class="btn" href="#/station">${icon('station')} 先把船建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是船东/船长自查与海事检查备查的底账，不替代船舶登记、检验、进出港报告、船员考证等法定程序；数据只存在你设备里。渔船/体育运动船艇/非营业游艇不适用配员规则（第 2 条），本工具面向内河营业运输船舶。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：四证钟 + 船员证书 + 今日自查/开航 + 缺陷 + 义务）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.ship?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const boxes = [];

  const docs = shipDocBoard(state, today);
  const badDocs = docs.filter((d) => ['unset', 'overdue'].includes(d.level));
  const winDocs = docs.filter((d) => d.level === 'window');
  const warnDocs = docs.filter((d) => d.level === 'warn');
  if (badDocs.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>证书红灯（${badDocs.length}）</strong></div>
      <ul>${badDocs.map((d) => `<li>${esc(d.detail)}</li>`).join('')}</ul></div>`);
  }
  if (winDocs.length || warnDocs.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>换发窗口/临期（${winDocs.length + warnDocs.length}）</strong></div>
      <ul>${[...winDocs, ...warnDocs].map((d) => `<li>${esc(d.detail)}</li>`).join('')}</ul></div>`);
  }

  const crew = activeCrew(state);
  const badCrew = crew.filter((c) => ['overdue', 'unset'].includes(crewCertState(c, today).level));
  const warnCrew = crew.filter((c) => crewCertState(c, today).level === 'warn');
  const badHealth = crew.filter((c) => ['overdue', 'unset'].includes(crewHealthState(c, today).level));
  if (badCrew.length || badHealth.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('person')}</span><strong>船员证书红灯（${badCrew.length + badHealth.length}）</strong></div>
      <ul>${[...badCrew, ...badHealth].slice(0, 4).map((c) => `<li>${esc(crewCertState(c, today).level === 'overdue' || crewCertState(c, today).level === 'unset' ? crewCertState(c, today).detail : crewHealthState(c, today).detail)}</li>`).join('')}</ul></div>`);
  } else if (warnCrew.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>适任证书临期（${warnCrew.length}）</strong></div>
      <ul>${warnCrew.slice(0, 4).map((c) => `<li>${esc(crewCertState(c, today).detail)}</li>`).join('')}</ul></div>`);
  }

  const sc = todaySelfcheck(state, today);
  const sailed = (state.voyages ?? []).some((v) => v.dateISO === today);
  const df = openDefects(state);
  if (!sailed) {
    boxes.push(`<div class="card alert ${df.length ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('ledger')}</span><strong>今日还没开开航单</strong></div><ul><li>离泊前先过五道闸（证书在期 → 保险在期 → 配员达标 → 自查已签 → 缺陷闭环）${df.length ? `——当前 ${df.length} 项未闭环缺陷，先销案` : ''}。</li></ul></div>`);
  }
  if (df.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('bell')}</span><strong>缺陷未闭环（${df.length}）</strong></div>
      <ul>${df.slice(0, 4).map((d) => `<li>${esc(d.desc)}</li>`).join('')}</ul></div>`);
  }

  const dutiesLate = dutyBoard(state, today).filter((d) => d.level === 'never' || d.level === 'overdue');
  if (dutiesLate.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>周期义务欠账（${dutiesLate.length}）</strong></div>
      <ul>${dutiesLate.slice(0, 3).map((d) => `<li>${esc(d.label)}——${esc(d.basis)}</li>`).join('')}</ul></div>`);
  }

  const openCh = openChanges(state);
  if (openCh.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>变更登记未办结（${openCh.length}）</strong></div>
      <ul>${openCh.slice(0, 3).map((c) => `<li>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}（${esc(c.dateISO)}）——${esc(c.detail)}；办理后点「办结」</li>`).join('')}</ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>证在期、人配齐、自查签、缺陷闭环——继续保持，自查和开航单别断。</li></ul></div>`);
  }

  // hero：体检计分环 + 芯片 + 本月计数
  const hc = healthCheck(state, today, settings);
  const sum = monthlySummary(state, today.slice(0, 7), today);
  const docChip = badDocs.length
    ? { cls: 'bad', big: `缺${badDocs.length}证`, sub: '先补证再开航' }
    : winDocs.length
      ? { cls: 'warn', big: '换发窗口', sub: `${winDocs.map((d) => d.label.split('（')[0]).join('、')}` }
      : warnDocs.length
        ? { cls: 'warn', big: `临期${warnDocs.length}`, sub: '安排检验/续保' }
        : { cls: 'ok', big: '四证在期', sub: '检验·国籍·配员·保险' };
  const scChip = sc
    ? { cls: sc.status === 'issue' ? 'warn' : 'ok', big: '自查已签', sub: sc.status === 'issue' ? `含 ${sc.items.filter((i) => !i.ok).length} 项异常` : '全项正常' }
    : { cls: 'warn', big: '未自查', sub: '离泊前自查签字' };
  const sailChip = sailed
    ? { cls: 'ok', big: '已开航', sub: '五道闸全过' }
    : { cls: df.length ? 'bad' : 'warn', big: '未开航', sub: df.length ? '缺陷未闭环' : '离泊前过五道闸' };
  const crewChip = badCrew.length || badHealth.length
    ? { cls: 'bad', big: `异常${badCrew.length + badHealth.length}`, sub: '过期/未登记·禁任职' }
    : warnCrew.length
      ? { cls: 'warn', big: `临期${warnCrew.length}`, sub: '安排换证' }
      : { cls: 'ok', big: crew.length ? `${crew.length}人在册` : '无船员', sub: crew.length ? '证书全部在期' : '先建船员名册' };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · 在册船员 ${crew.length} 人 · 核定配员 ${state.ship.minCrew || '—'} 人</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${docChip.cls}"><span class="chip-label">船舶四证钟</span><span class="chip-big">${esc(docChip.big)}</span><span class="chip-sub">${esc(docChip.sub)}</span></div>
        <div class="chip ${crewChip.cls}"><span class="chip-label">船员证书钟</span><span class="chip-big">${esc(crewChip.big)}</span><span class="chip-sub">${esc(crewChip.sub)}</span></div>
        <div class="chip ${scChip.cls}"><span class="chip-label">开航前自查</span><span class="chip-big">${esc(scChip.big)}</span><span class="chip-sub">${esc(scChip.sub)}</span></div>
        <div class="chip ${sailChip.cls}"><span class="chip-label">今日开航</span><span class="chip-big">${esc(sailChip.big)}</span><span class="chip-sub">${esc(sailChip.sub)}</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${sum.voyages}</b><span>本月开航单</span></div>
      <div class="stat"><b>${sum.blocked}</b><span>闸机拦截（都算没被扣）</span></div>
      <div class="stat"><b>${sum.score}</b><span>体检得分</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/ledger">去开航/自查</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 建档（船舶四证 + 船员名册 + 变更登记 + 周期义务）
// ---------------------------------------------------------------------------

export function viewStation(state) {
  const s = state.ship ?? {};
  const today = todayISO();
  const settings = state.settings ?? {};
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;

  const docs = shipDocBoard(state, today);

  const crewRows = (state.crew ?? []).map((p) => {
    const cs = crewCertState(p, today);
    const hs = crewHealthState(p, today);
    const as = crewAgeState(p, today);
    const CS_SHORT = { overdue: '已过期·禁任职', unset: '未登记证期', warn: `剩 ${cs.daysLeft} 天`, ok: '在期', none: '—' };
    return `<tr class="${p.active ? '' : 'muted'}">
    <td>${esc(p.name)}</td>
    <td class="w"><span>${esc(CREW_ROLES[p.role] ?? p.role)}${p.certNo ? `<br><span class="basis">${esc(p.certNo)}</span>` : ''}</span></td>
    <td>${esc(p.certValidISO || '—')}<span class="basis">${esc(CS_SHORT[cs.level] ?? '')}${hs.level !== 'ok' && hs.level !== 'none' ? `·健康${hs.level === 'overdue' ? '过期' : '临期'}` : ''}${as.level === 'warn' ? '·跨65周岁' : ''}</span></td>
    <td><button class="btn small ghost" data-action="toggle-crew" data-idx="${p.id}">${p.active ? '离船' : '复职'}</button></td>
  </tr>`;
  }).join('');

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr class="${c.status === 'open' ? '' : 'muted'}">
    <td>${esc(c.dateISO)}</td><td class="w"><span>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}<span class="basis">${esc(c.detail)}</span></span></td>
    <td>${c.status === 'filed' ? `<span class="pill ok">已办结</span><span class="basis">${esc(c.filedISO)}</span>` : `<span class="pill warn">未办结</span><button class="btn small" data-action="show-file-change" data-idx="${c.id}">办结</button>`}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">船舶建档与四证钟（内河条例第 6 条；登记条例第 16/45 条；配员规则第 17 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>船名 *<input id="vs-name" value="${esc(s.name ?? '')}" placeholder="如：皖顺达 666" /></label>
      <label>船舶登记号<input id="vs-nationalno" value="${esc(s.nationalNo ?? '')}" placeholder="国籍证书载明" /></label>
      <label>船检登记号<input id="vs-surveyno" value="${esc(s.surveyNo ?? '')}" placeholder="检验证书簿载明" /></label>
      <label>船舶种类
        <select id="vs-kind">${['', '干货船', '散货船', '油船/化学品船', '集装箱船', '客船', '其他'].map((x) => `<option value="${x}" ${s.kind === x ? 'selected' : ''}>${x || '未选择'}</option>`).join('')}</select>
      </label>
      <label>总吨（GT）<input id="vs-gt" type="number" min="0" value="${esc(String(s.gt ?? ''))}" placeholder="照证书录入" /></label>
      <label>核定最低配员（人）*<input id="vs-mincrew" type="number" min="1" max="30" value="${esc(String(s.minCrew ?? ''))}" placeholder="照《最低安全配员证书》录入" /></label>
      <label>检验证书有效期至 *<input id="vs-survey" type="date" value="${esc(s.docs?.survey ?? '')}" placeholder="检验证书簿载明下次检验日" /></label>
      <label>国籍证书有效期至 *<input id="vs-national" type="date" value="${esc(s.docs?.national ?? '')}" placeholder="有效期 5 年，届满前 1 年换发" /></label>
      <label>配员证书有效期至 *<input id="vs-manning" type="date" value="${esc(s.docs?.manning ?? '')}" placeholder="截止前 1 年内换发" /></label>
      <label>责任保险文书至<input id="vs-insurance" type="date" value="${esc(s.docs?.insurance ?? '')}" placeholder="污染损害/沉船打捞责任（第 67 条）" /></label>
      <label>船长<input id="vs-captain" value="${esc(s.captain ?? '')}" /></label>
      <label>船籍港<input id="vs-port" value="${esc(s.port ?? '')}" placeholder="如：芜湖" /></label>
      <label class="span2">固定航线/常跑航段<input id="vs-route" value="${esc(s.route ?? '')}" placeholder="如：芜湖—南京（单航次≤2 小时自查可一天一次）" /></label>
      <label>联系电话<input id="vs-phone" value="${esc(s.phone ?? '')}" placeholder="可空" /></label>
      <label class="span2">备注<input id="vs-note" value="${esc(s.note ?? '')}" placeholder="如：2024-05 换发国籍证书（可空）" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-ship">保存船舶信息</button>
      <span>${docs.map((d) => `${pill(d.level)}&nbsp;${esc(d.label.split('（')[0])}`).join('&nbsp;&nbsp;')}</span>
    </div>
    <div class="tbl"><table class="plain"><tr><th>证书/文书</th><th>有效期至</th><th>状态与依据</th></tr>
    ${docs.map((d) => `<tr><td class="w"><span>${esc(d.label)}<span class="basis">${esc(d.basis)}</span></span></td><td>${esc(state.ship?.docs?.[d.key] || '—')}</td><td>${pill(d.level)}<span class="basis">${esc(d.detail)}</span></td></tr>`).join('')}
    </table></div>
    <p class="fine">无证擅自航行：责令停航→拒不停止暂扣船舶→情节严重没收（内河条例第 64 条）；国籍证书有效期 5 年、届满前 1 年内换发（登记条例第 16/45 条）；配员证书截止前 1 年内换发、随国籍证书核发（配员规则第 17 条）；未取得规定保险文书：限期改正→停航+1 万~10 万（第 67 条）。检验周期不自行推算——照检验证书簿载明的下次检验日期录入。</p>
  </div>

  <h2 class="sec">船员名册与证书钟（内河适任规则第 16 条：值班船员适任证 ≤5 年、有效期截止不超过 65 周岁）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名 *<input id="cw-name" placeholder="如：陈定波" /></label>
      <label>岗位 *
        <select id="cw-role">${Object.entries(CREW_ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label>适任证书号<input id="cw-certno" placeholder="值班船员必持（备查核对）" /></label>
      <label>适任证书有效期至<input id="cw-cert" type="date" placeholder="船长/驾驶员/轮机员必填" /></label>
      <label>出生日期<input id="cw-birth" type="date" placeholder="用于 65 周岁红线校验" /></label>
      <label>健康证明有效期至<input id="cw-health" type="date" placeholder="按船员体检口径（默认 2 年参数化）" /></label>
      <label class="span2">备注<input id="cw-note" placeholder="航区（线）/等级（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-crew">入册</button><span class="basis">无适任证件人员擅自航行：个人罚 2000~2 万、聘用单位罚 1 万~10 万（内河条例第 66 条）——开航点名对证书当场核对</span></div>
    <div class="tbl"><table class="plain"><tr><th>姓名</th><th>岗位/证号</th><th>适任证书至</th><th></th></tr>${crewRows || '<tr><td colspan="4">名册为空——先登记船长</td></tr>'}</table></div>
    <p class="fine">离船点「离船」不删除：历史开航单可回溯到当次点名；任职不得高于证书记载的职务资格、不得超出航区（线）（内河适任规则第 6 条）。</p>
  </div>

  <h2 class="sec">变更登记台账（船舶登记条例：登记事项变更向船籍港登记机关办理）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发生日<input id="cg-date" type="date" value="${esc(today)}" /></label>
      <label>情形
        <select id="cg-kind">${Object.entries(CHANGE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.split('（')[0])}</option>`).join('')}</select>
      </label>
      <label class="span2">说明 *<input id="cg-detail" placeholder="变更前后内容，如：经营人变更为 XX 水运（已报材料）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-change">登记变更</button><span class="basis">变更办结后如涉及国籍证书换发，配员证书同步换发（配员规则第 17 条）——办理回执后点「办结」</span></div>
    <div class="tbl"><table class="plain"><tr><th>发生日</th><th>情形与说明</th><th>办理</th></tr>${changeRows || '<tr><td colspan="3">暂无变更事项（有变化先登记再办手续）</td></tr>'}</table></div>
  </div>

  <h2 class="sec">周期义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label.split('（')[0])} · ${v.cycleDays}天</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="演习科目/保养内容/保单号（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="set-duty">登记完成</button></div>
    ${(() => {
    const rows = dutyBoard(state, today).map((d) => {
      const lv = d.level === 'never' ? 'never' : d.level;
      const next = d.level === 'never'
        ? '从未执行'
        : `${esc(d.nextDue)}<span class="basis">${d.daysLeft < 0 ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}</span>`;
      return `<tr class="${lv === 'never' || lv === 'overdue' ? 'muted' : ''}"><td class="w"><span>${esc(d.label)}</span></td><td>${d.lastDoneISO ? esc(d.lastDoneISO) : '—'}</td><td>${next}</td><td><span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span></td></tr>`;
    }).join('');
    return `<div class="tbl"><table class="plain"><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th></tr>${rows}</table></div>`;
  })()}
    <p class="fine">演习/维护周期为参数化默认值（安全监督规则第 41 条「有效维护和保养」，惯例季度/月度）；进出港报告制（第 11 条）报告后在航行日志记载（第 13 条）；枯水季节与恶劣天气限航通告逐日核对（第 44 条）。属地海事机构要求永远赢。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 开航（五道闸 / 自查卡 / 缺陷闭环）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;

  const crew = activeCrew(state);
  const crewOptions = crew.map((c) => `<option value="${e(c.id)}">${e(c.name)} · ${e((CREW_ROLES[c.role] ?? c.role).split('（')[0])}</option>`).join('');

  const voyages = [...(state.voyages ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const vgRows = voyages.map((v) => `<tr>
    <td>${e(v.dateISO)}<br><span class="basis">在船 ${v.snapshot?.onBoard ?? '—'}/${e(String(v.snapshot?.minCrew ?? '—'))} 人</span></td>
    <td class="w"><span>${e(v.crewNames.join('、'))}</span></td>
    <td class="ops">
      <button class="btn small ghost" data-action="voyage-print" data-idx="${v.id}">开航单</button>
      <button class="btn small ghost" data-action="del-voyage" data-idx="${v.id}">删</button>
    </td>
  </tr>`).join('');

  const scToday = todaySelfcheck(state, today);
  const items = selfcheckItemsFor();
  const scCard = `<div class="checklist">${items.map((it) => `
      <label class="check-item"><input type="checkbox" id="sc-${e(it.key)}" ${scToday?.items.find((x) => x.key === it.key)?.ok ? 'disabled checked' : ''} /> <span>${e(it.label)}</span></label>
      <input class="dc-note" id="scnote-${e(it.key)}" placeholder="异常时必写处置说明" ${scToday ? 'disabled' : ''} />
    `).join('')}</div>
    <div class="row"><button class="btn" data-action="add-selfcheck" ${scToday ? 'disabled' : ''}>${scToday ? `今日已落卡（${scToday.status === 'issue' ? `含 ${scToday.items.filter((i) => !i.ok).length} 项异常` : '全项正常'}）` : '落自查卡'}</button>
    <span class="basis">同日唯一（固定航线单航次≤2 小时口径）；异常必须写处置说明并自动转缺陷——缺陷闭环前，开航闸不放行</span></div>`;

  const dfs = [...(state.defects ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const DFST = { open: ['未整改', 'bad'], fixed: ['待复查', 'warn'], closed: ['已闭环', 'ok'] };
  const dfRows = dfs.map((d) => `<tr class="${d.status !== 'closed' ? 'muted' : ''}">
    <td>${e(d.dateISO)}</td><td>${e(DEFECT_SOURCES[d.source] ?? d.source)}</td>
    <td class="w"><span>${e(d.desc)}</span></td>
    <td>${d.status === 'open' ? '<strong>未整改</strong>' : `${e(d.actionISO || '—')}<br><span class="basis">${e(d.action || '')}</span>`}</td>
    <td><span class="pill ${DFST[d.status]?.[1] ?? ''}">${DFST[d.status]?.[0] ?? d.status}</span></td>
    <td class="ops">${d.status === 'open' ? `<button class="btn small" data-action="show-fix-defect" data-idx="${d.id}">整改</button>` : d.status === 'fixed' ? `<button class="btn small" data-action="show-close-defect" data-idx="${d.id}">复查销案</button>` : ''}</td>
  </tr>`).join('');

  const manning = manningCheck(state, crew.map((c) => c.id), today);

  return `
  <h2 class="sec">开航五道闸（离泊前的门禁：五闸全过才许开航）</h2>
  <div class="card">
    <div class="form-grid">
      <label>开航日期<input id="vg-date" type="date" value="${e(today)}" /></label>
      <label>当次在船船员（按住 Ctrl 多选）*
        <select id="vg-crew" multiple size="4">${crewOptions || '<option value="">先去「建档」登记船员</option>'}</select>
      </label>
      <label class="span2">备注<input id="vg-note" placeholder="航次/天气/装载（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-voyage">过闸开航</button><span class="basis">在册 ${crew.length} 人·静态核对：${e(manning.detail)}——开航点名以实际在船为准</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>在船船员</th><th></th></tr>${vgRows || '<tr><td colspan="3">还没有开航单——营运日离泊第一件事</td></tr>'}</table></div>
    <p class="fine">五道闸：检验/国籍/配员证书在期（内河条例第 6 条·第 64 条无证航行暂扣船舶）→ 责任保险在期（第 67 条）→ 配员达标且船长在船、全员适任/健康证在期（第 65/66 条·配员规则）→ 今日开航前自查已签（安全监督规则第 42 条）→ 无未闭环缺陷。落账即存当次快照。</p>
  </div>

  <h2 class="sec">每日开航前自查（安全监督规则第 42 条 · 清单格式以海事机构规定为准）</h2>
  <div class="card">${scCard}
    <p class="fine">固定航线且单次航程不超过 2 小时的船舶无须每次自查，但一天内至少一次（第 42 条）——多航次船舶逐航次留纸质清单，《船舶开航前安全自查清单》在船保存至少 2 年，本卡同时生成电子留档。</p>
  </div>

  <h2 class="sec">缺陷整改闭环（自查异常自动转入 / 海事监督检查 / 公司自查）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日<input id="df-date" type="date" value="${e(today)}" /></label>
      <label>来源
        <select id="df-source"><option value="selfcheck">开航前自查</option><option value="inspection">海事监督检查</option><option value="company">公司/船东自查</option></select>
      </label>
      <label class="span2">描述 *<input id="df-desc" placeholder="如：右舷 2 号救生圈自亮浮灯失效 / 舵机压力异常" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-defect">登记缺陷</button><span class="basis">闭环状态机：登记 → 整改（措施+完成日）→ 复查销案（复查人+复查日）；跳级拒绝。未闭环缺陷=开航闸第 5 道不放行</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>来源</th><th>描述</th><th>整改</th><th>状态</th><th></th></tr>${dfRows || '<tr><td colspan="6">还没有缺陷登记（无事即最好的事）</td></tr>'}</table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 体检 / 出证两通道）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const e = esc;
  const voyageOptions = [...(state.voyages ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((v) => `<option value="${e(v.id)}">${e(v.dateISO)}</option>`).join('');

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到船东群/公司存档——含开航单/闸机拦截/自查/缺陷/证照与船员点名/体检与法条口径尾注。</p>'}
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

  <h2 class="sec">出证（两通道）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="inspect-download">${icon('dl')} 海事迎检自证包（HTML）</button>
      <button class="btn ghost" data-action="inspect-print">${icon('print')} 迎检自证包（打印）</button>
    </div>
    <p class="fine">单文件含：船舶与四证一览、体检明细、船员名册与证书、开航记录、自查记录、缺陷闭环、变更登记、周期义务——对口海事现场监督/船旗国监督检查，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>当次开航单<select id="case-voyage">${voyageOptions || '<option value="">先过闸开出开航单</option>'}</select></label>
      <button class="btn" data-action="voyage-download" ${voyageOptions ? '' : 'disabled'}>${icon('dl')} 当次开航单打印版</button>
    </div>
    <p class="fine">打印随船/贴驾驶台：五道闸核对 + 当次在船船员与证书期 + 进出港报告自查栏——海事登轮 10 秒出示「今天这船是合规开的」。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  return `
  <h2 class="sec">参数（属地海事机构要求永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>检验证书临期提醒（天）<input id="set-survey" type="number" min="15" max="180" value="${s.surveyWarnDays ?? DEFAULT_SURVEY_WARN_DAYS}" /></label>
      <label>保险文书临期提醒（天）<input id="set-insurance" type="number" min="7" max="120" value="${s.insuranceWarnDays ?? DEFAULT_INSURANCE_WARN_DAYS}" /></label>
      <label>周期义务临期提醒（天）<input id="set-duty" type="number" min="7" max="120" value="${s.dutyWarnDays ?? DEFAULT_DUTY_WARN_DAYS}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">国籍/配员证书「届满前 1 年换发窗口」为法定口径不可调（登记条例第 45 条+配员规则第 17 条）；检验周期不自行推算——照检验证书簿载明录入，这里只调提醒提前量；演习/维护等义务周期按惯例参数化；健康证明周期默认 2 年参数化（以内河船员体检口径为准）。</p>
  </div>

  <h2 class="sec">合规雷达（立法与口径动态）</h2>
  <div class="card">
    <ul class="radar">
      <li><strong>《船舶安全监督规则》现行版=交通运输部令 2022 年第 27 号（二次修正）</strong>：开航前自查=第 42 条——网上大量引 2017 原版文号，引旧文号即露馅。</li>
      <li><strong>《内河船舶检验规则（2024）》</strong>已由部海事局发布（CCS 官网 2024-04 转载），另有法定检验技术规则 2025 年修改通报——检验口径以最新版与检验证书簿载明为准，本工具照证书录入不推算。</li>
      <li><strong>老旧营运船舶与运力结构调整</strong>：水上运输船舶 11.02 万艘（2024 公报，一年减 0.81 万艘）——单船合规成本权重上升，账做实才能跑得久。</li>
      <li><strong>口径雷区</strong>：内河船员适任证书 65 周岁红线是「有效期截止日不超过 65 周岁生日」，非 65 岁禁航；《海上交通安全法》（2021 修订）管海上——内河主法是《内河交通安全管理条例》，引法别张冠李戴。</li>
    </ul>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与使用记录；船员证书号等信息也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例船舶（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 开航闸三连拦截（配员不足/证书过期/缺陷未闭环）→ 整改销案 → 过闸开航 → 出证。</p>
  </div>`;
}
