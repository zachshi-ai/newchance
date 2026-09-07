/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  PROJECT_KINDS, STAFF_ROLES, DAYCHECK_ITEMS, DUTY_KINDS, CHANGE_KINDS, HAZARD_SOURCES,
  DEFAULT_RENEW_WARN_DAYS, DEFAULT_GEAR_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
  licenseState, activeStaff, staffCertState, activeGear, gearState,
  daycheckItemsFor, openChanges, openHazards, dutyBoard,
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
  mountain: IC('<path d="M3 19l6-11 4 7 2.5-4L21 19z"/><path d="M9 8l1.5 2.5"/>'),
  alert: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', due: 'warn', window: 'warn', warn: 'warn', ok: 'ok', never: 'bad', unset: 'bad', none: 'ok' };
const LEVEL_TEXT = { overdue: '逾期', due: '临期', window: '延续窗口', warn: '临期', ok: '正常', never: '从未开展', unset: '未登记', none: '不适用' };

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
  <h2 class="sec">高危体育场馆，先有一本能证明「今天能开门」的账</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>经营高危险性体育项目实行许可制——《体育法》2022 修订把许可升格为法律（第 105 条）并把罚则全面加码：<strong>无证经营责令限期关闭、逾期不关罚 10 万~50 万；违法经营罚 5 万~50 万，造成严重后果的吊销证照、五年禁入</strong>（第 116 条，旧《全民健身条例》3 万~10 万的罚额已成历史）。许可证的合法性地基每天都在动：<strong>届满 30 日前要申请续期</strong>（17 号令第 14 条，逾期未申请原证自动失效）、人员要「达到规定数量」且持证上岗、设施器材要维护保养+定期检测、突发事件应急预案要演练。而体育部门的检查清单化（总局 2025 涉企检查事项清单：检查标准 5 条、县级、一年最多 2 次+旺季专项）。全国 811 家攀岩馆、约 748 家滑雪场、数百家潜水俱乐部几乎全是 2019 年后开的小微新店，现状解法是微信群排班、脑子记证期、检查前一夜凑材料——<strong>「人在岗、证在期、器在检」与「能证明」之间没有任何小微级工具。</strong></p>
    <p><strong>开馆单的做法：</strong>场馆建档（许可证钟，届满 30 日续期窗口自动黄）→ 人员名册（指导员/救助员证书钟）→ 器材一物一档（检验钟）→ <strong>每日开放前检查卡</strong>（按项目自动生成条目，异常必写处置并自动转隐患）→ <strong>开馆五道闸</strong>（证在期、人数够、证书在期、日检已落、隐患闭环——当场拦截并给法条理由；开出来的每一张开馆单都自带当日快照）→ 周期义务账（演练/培训/设施检测/保险）→ 变更手续台账 → 一键出迎检自证包 / 当日开馆单 / 月度小结。</p>
    <div class="row">
      <a class="btn" href="#/station">${icon('station')} 先把场馆建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是场馆自查与应对检查的底账，不替代经营许可申请、延续、变更、注销与高危险性体育赛事活动许可等法定程序；数据只存在你设备里。游泳场所的水质卫生台账属另一领域（泳清单），本工具覆盖滑雪/潜水/攀岩。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：许可证钟 + 人员证书 + 今日开馆 + 器材 + 义务）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.venue?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const boxes = [];

  const lic = licenseState(state.venue, today, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);
  if (lic.level === 'overdue' || lic.level === 'unset') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>许可证红灯</strong></div><ul><li>${esc(lic.detail)}</li></ul></div>`);
  } else if (lic.level === 'window' || lic.level === 'warn') {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>续期窗口/临期</strong></div><ul><li>${esc(lic.detail)}</li></ul></div>`);
  }

  const staff = activeStaff(state);
  const badStaff = staff.filter((s) => ['overdue', 'unset'].includes(staffCertState(s, today).level));
  const warnStaff = staff.filter((s) => staffCertState(s, today).level === 'warn');
  if (badStaff.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('person')}</span><strong>人员证书红灯（${badStaff.length}）</strong></div>
      <ul>${badStaff.slice(0, 4).map((s) => `<li>${esc(staffCertState(s, today).detail)}</li>`).join('')}</ul></div>`);
  } else if (warnStaff.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>证书临期（${warnStaff.length}）</strong></div>
      <ul>${warnStaff.slice(0, 4).map((s) => `<li>${esc(staffCertState(s, today).detail)}</li>`).join('')}</ul></div>`);
  }

  const gear = activeGear(state);
  const badGear = gear.filter((g) => ['overdue', 'unset'].includes(gearState(g, today, settings.gearWarnDays ?? DEFAULT_GEAR_WARN_DAYS).level));
  const dueGear = gear.filter((g) => gearState(g, today, settings.gearWarnDays ?? DEFAULT_GEAR_WARN_DAYS).level === 'due');
  if (badGear.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('mountain')}</span><strong>器材检验红灯（${badGear.length}）</strong></div>
      <ul>${badGear.slice(0, 4).map((g) => `<li>${esc(g.name)}（${esc(g.code)}）——${esc(gearState(g, today, settings.gearWarnDays ?? DEFAULT_GEAR_WARN_DAYS).detail)}</li>`).join('')}</ul></div>`);
  } else if (dueGear.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>器材临期（${dueGear.length}）</strong></div>
      <ul>${dueGear.slice(0, 4).map((g) => `<li>${esc(g.name)}（${esc(g.code)}）——${esc(gearState(g, today, settings.gearWarnDays ?? DEFAULT_GEAR_WARN_DAYS).detail)}</li>`).join('')}</ul></div>`);
  }

  const openedToday = (state.openings ?? []).some((o) => o.dateISO === today);
  const hz = openHazards(state);
  if (!openedToday) {
    boxes.push(`<div class="card alert ${hz.length ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('ledger')}</span><strong>今日还没开开馆单</strong></div><ul><li>营业日开门前先过五道闸（证在期 → 人数够 → 证书在期 → 日检已落 → 隐患闭环）${hz.length ? `——当前有 ${hz.length} 项未闭环隐患，先销案` : ''}。</li></ul></div>`);
  }
  if (hz.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('bell')}</span><strong>隐患未闭环（${hz.length}）</strong></div>
      <ul>${hz.slice(0, 4).map((h) => `<li>${esc(h.desc)}</li>`).join('')}</ul></div>`);
  }

  const dutiesLate = dutyBoard(state, today).filter((d) => d.level === 'never' || d.level === 'overdue');
  if (dutiesLate.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>周期义务欠账（${dutiesLate.length}）</strong></div>
      <ul>${dutiesLate.slice(0, 3).map((d) => `<li>${esc(d.label)}——${esc(d.basis)}</li>`).join('')}</ul></div>`);
  }

  const openCh = openChanges(state);
  if (openCh.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>变更手续未办结（${openCh.length}）</strong></div>
      <ul>${openCh.slice(0, 3).map((c) => `<li>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}（${esc(c.dateISO)}）——${esc(c.detail)}；办理后点「办结」</li>`).join('')}</ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>证在期、人够数、器在检、日检已落、隐患闭环——继续保持，开门落账别断。</li></ul></div>`);
  }

  // hero：体检计分环 + 三只芯片 + 本月计数
  const hc = healthCheck(state, today, settings);
  const sum = monthlySummary(state, today.slice(0, 7), today);
  const licChip = lic.level === 'overdue'
    ? { cls: 'bad', big: '已过期', sub: '停业+续期（第 116 条）' }
    : lic.level === 'window'
      ? { cls: 'warn', big: `剩${lic.daysLeft}天`, sub: '届满 30 日前续期' }
      : { cls: 'ok', big: lic.level === 'unset' ? '未登记' : '在期', sub: lic.level === 'unset' ? '先录许可证有效期' : `至 ${state.venue.licenseExpiryISO}` };
  const staffChip = badStaff.length
    ? { cls: 'bad', big: `异常${badStaff.length}`, sub: '过期/未登记·禁上岗' }
    : warnStaff.length
      ? { cls: 'warn', big: `临期${warnStaff.length}`, sub: '安排复审' }
      : { cls: 'ok', big: staff.length ? `${staff.length}人在册` : '无人员', sub: staff.length ? '证书全部在期' : '先建人员名册' };
  const openChip = openedToday
    ? { cls: 'ok', big: '已开单', sub: '五道闸全过' }
    : { cls: hz.length ? 'bad' : 'warn', big: '未开单', sub: hz.length ? '隐患未闭环' : '开门前先过闸' };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · 在册 ${staff.length} 人 · 在用器材 ${gear.length} 件 · 项目 ${(state.venue.projects ?? []).length} 个</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${licChip.cls}"><span class="chip-label">许可证钟</span><span class="chip-big">${esc(licChip.big)}</span><span class="chip-sub">${esc(licChip.sub)}</span></div>
        <div class="chip ${staffChip.cls}"><span class="chip-label">人员证书钟</span><span class="chip-big">${esc(staffChip.big)}</span><span class="chip-sub">${esc(staffChip.sub)}</span></div>
        <div class="chip ${openChip.cls}"><span class="chip-label">今日开馆</span><span class="chip-big">${esc(openChip.big)}</span><span class="chip-sub">${esc(openChip.sub)}</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${sum.openings}</b><span>本月开馆单</span></div>
      <div class="stat"><b>${sum.blocked}</b><span>闸机拦截（都算没被罚）</span></div>
      <div class="stat"><b>${sum.score}</b><span>体检得分</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/ledger">去开馆/日检</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 建档（场馆 + 人员名册 + 器材一物一档 + 变更台账 + 周期义务）
// ---------------------------------------------------------------------------

export function viewStation(state) {
  const s = state.venue ?? {};
  const today = todayISO();
  const settings = state.settings ?? {};
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;

  const lic = licenseState(s, today, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);

  const projBoxes = Object.entries(PROJECT_KINDS).map(([k, label]) => `
    <label class="check-item"><input type="checkbox" id="proj-${k}" value="${k}" ${(s.projects ?? []).includes(k) ? 'checked' : ''} /> <span>${esc(label)}</span></label>`).join('');

  const staffRows = (state.staff ?? []).map((p) => {
    const cs = staffCertState(p, today);
    return `<tr class="${p.active ? '' : 'muted'}">
    <td>${esc(p.name)}</td>
    <td class="w"><span>${esc(STAFF_ROLES[p.role] ?? p.role)}${p.certName ? `<br><span class="basis">${esc(p.certName)}${p.certNo ? ` · ${esc(p.certNo)}` : ''}</span>` : ''}</span></td>
    <td>${esc(p.certValidISO || '—')}<br><span class="basis">${esc(cs.detail).slice(0, 36)}</span></td>
    <td><button class="btn small ghost" data-action="toggle-staff" data-idx="${p.id}">${p.active ? '停用' : '恢复'}</button></td>
  </tr>`;
  }).join('');

  const gearRows = (state.gear ?? []).map((g) => {
    const gs = gearState(g, today, settings.gearWarnDays ?? DEFAULT_GEAR_WARN_DAYS);
    return `<tr class="${g.outISO ? 'muted' : ''}">
    <td>${esc(g.name)}<br><span class="basis">${esc(g.code)}</span></td>
    <td>${g.cycleMonths} 个月</td>
    <td>${esc(g.dueISO || '—')}<br><span class="basis">${esc(gs.detail).slice(0, 36)}</span></td>
    <td>${g.outISO ? '<span class="pill bad">停用</span>' : '<span class="pill ok">在用</span>'}</td>
    <td class="ops">
      <button class="btn small ghost" data-action="show-gear-check" data-idx="${g.id}">检验完成</button>
      <button class="btn small ghost" data-action="toggle-gear" data-idx="${g.id}">${g.outISO ? '复用' : '停用'}</button>
      <button class="btn small ghost" data-action="del-gear" data-idx="${g.id}">删</button>
    </td>
  </tr>`;
  }).join('');

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr class="${c.status === 'open' ? '' : 'muted'}">
    <td>${esc(c.dateISO)}</td><td>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}</td><td class="w"><span>${esc(c.detail)}</span></td>
    <td>${c.status === 'filed' ? `<span class="pill ok">已办结 ${esc(c.filedISO)}</span>` : `<span class="pill warn">未办结</span><button class="btn small" data-action="show-file-change" data-idx="${c.id}">办结</button>`}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">场馆建档与许可证钟（《体育法》第 105 条；17 号令第 14 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>场馆名称 *<input id="vs-name" value="${esc(s.name ?? '')}" placeholder="如：岩语攀岩馆" /></label>
      <label>许可证编号 *<input id="vs-licno" value="${esc(s.licenseNo ?? '')}" placeholder="高危险性体育项目经营许可证" /></label>
      <label>发证机关<input id="vs-issuer" value="${esc(s.issuer ?? '')}" placeholder="如：XX市/县体育行政部门" /></label>
      <label>许可证有效期至 *<input id="vs-licexpiry" type="date" value="${esc(s.licenseExpiryISO ?? '')}" placeholder="届满 30 日前申请续期" /></label>
      <label>最低在岗人数（规定数量）*<input id="vs-minstaff" type="number" min="1" max="99" value="${esc(String(s.minStaffPerDay ?? ''))}" placeholder="许可证核定的持证人员最低在岗数" /></label>
      <label>场馆负责人<input id="vs-manager" value="${esc(s.manager ?? '')}" /></label>
      <label class="span2">经营地址<input id="vs-address" value="${esc(s.address ?? '')}" placeholder="变更应办手续（17 号令第 14 条）" /></label>
      <label class="span2">经营项目 *</label>
      <div class="span2">${projBoxes}<p class="fine" style="margin:4px 0 0">第一批高危体育项目目录（总局公告 2013 年第 16 号）：游泳／高山·自由式·单板滑雪／潜水／攀岩——游泳场所的水质卫生台账属泳清单领域，本工具覆盖滑雪/潜水/攀岩。</p></div>
      <label class="span2">联系电话<input id="vs-phone" value="${esc(s.phone ?? '')}" placeholder="可空" /></label>
      <label class="span2">备注<input id="vs-note" value="${esc(s.note ?? '')}" placeholder="如：2024-05 首次取得许可（可空）" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-venue">保存场馆信息</button>
      <button class="btn ghost" data-action="show-renew" ${s.licenseExpiryISO ? '' : 'disabled'}>续期办结（滚动许可证钟）</button>
      <span>${pill(lic.level)}&nbsp;<span class="basis">${esc(lic.detail)}</span></span>
    </div>
    <p class="fine">续期应在有效期届满 30 日前申请（17 号令第 14 条），逾期未申请原证自动失效（广东规章第 8 条口径）；无证或过期经营：责令限期关闭、逾期处 10 万~50 万，违法经营 5 万~50 万+吊销+五年禁入（《体育法》第 116 条——旧条例 3 万~10 万罚额已加码废止）。有效期年限按许可证载明（广东规章上限 5 年），到期日照证录入即可。</p>
  </div>

  <h2 class="sec">人员名册（社会体育指导人员和救助人员——体育法第 105 条(二)）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名 *<input id="ppl-name" placeholder="如：林晚秋" /></label>
      <label>岗位 *
        <select id="ppl-role">${Object.entries(STAFF_ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label>证书名称<input id="ppl-certname" placeholder="如：社会体育指导员（攀岩）国家职业资格证" /></label>
      <label>证书编号<input id="ppl-certno" placeholder="备查核对用（只存本机）" /></label>
      <label>证书有效期至<input id="ppl-certvalid" type="date" placeholder="开馆点名前必须登记" /></label>
      <label class="span2">备注<input id="ppl-note" placeholder="急救证/心肺复苏复训等（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-staff">入册</button><span class="basis">经营期间应保持不低于规定数量的持证人员且持证上岗、佩戴能标明其身份的醒目标识（检查标准 5）；证书过期者不得安排上岗——开馆闸当场拦截</span></div>
    <div class="tbl"><table class="plain"><tr><th>姓名</th><th>岗位/证书</th><th>有效期至</th><th></th></tr>${staffRows || '<tr><td colspan="4">名册为空——先把持证教练/救生员登记进来</td></tr>'}</table></div>
    <p class="fine">离职人员「停用」不删除：历史开馆单仍可回溯到当日名册；停用后开馆点名不可选。</p>
  </div>

  <h2 class="sec">器材设施一物一档（检查标准 4：维护保养及定期检测；17 号令第 22 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>器材/设施名称 *<input id="gr-name" placeholder="如：动力绳 60m / 潜水气瓶 12L / 防护网 A 区" /></label>
      <label>编号 *<input id="gr-code" placeholder="如：ROPE-01 / TANK-07" /></label>
      <label>检验/更换周期（月）<input id="gr-cycle" type="number" min="1" max="120" value="12" placeholder="气瓶按检验规程、绳索按厂家口径" /></label>
      <label>最近检查/检验日<input id="gr-last" type="date" placeholder="按报告填写，自动推导下次到期" /></label>
      <label class="span2">备注<input id="gr-note" placeholder="品牌/出厂号/送检机构（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-gear">建档</button><span class="basis">潜水气瓶定期检验、攀岩绳索扁带按磨损更换、雪场防护网/魔毯巡检——周期逐件参数化，GB 19079 系列与厂家口径永远赢</span></div>
    <div class="tbl"><table class="plain"><tr><th>器材</th><th>周期</th><th>有效期至</th><th>状态</th><th></th></tr>${gearRows || '<tr><td colspan="5">还没有器材建档——从安全链条上的关键件开始</td></tr>'}</table></div>
    <p class="fine">停用器材（送检中/待换）不参与接待；检验完成后点「检验完成」，到期钟按周期自动滚动。</p>
  </div>

  <h2 class="sec">变更手续台账（17 号令第 14 条；许可载明事项变化先办手续）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发生日<input id="cg-date" type="date" value="${esc(today)}" /></label>
      <label>情形
        <select id="cg-kind">${Object.entries(CHANGE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label class="span2">说明 *<input id="cg-detail" placeholder="变更前后内容，如：新增攀岩项目（已报材料）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-change">登记变更</button><span class="basis">许可载明事项变更应向体育部门申请办理变更手续（17 号令第 14 条；广东规章第 7 条 15 日内办理）——办理回执后点「办结」</span></div>
    <div class="tbl"><table class="plain"><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows || '<tr><td colspan="4">暂无变更事项（有变化先登记再办手续）</td></tr>'}</table></div>
  </div>

  <h2 class="sec">周期义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)} · ${v.cycleDays}天</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="演练科目/培训对象/保单号（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="set-duty">登记完成</button></div>
    ${(() => {
    const rows = dutyBoard(state, today).map((d) => {
      const lv = d.level === 'never' ? 'never' : d.level;
      const next = d.level === 'never' ? '从未执行' : `${esc(d.nextDue)}（${d.daysLeft < 0 ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}）`;
      return `<tr class="${lv === 'never' || lv === 'overdue' ? 'muted' : ''}"><td>${esc(d.label)}</td><td>${d.lastDoneISO ? esc(d.lastDoneISO) : '—'}</td><td>${next}</td><td><span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span></td><td class="basis w"><span>${esc(d.basis)}</span></td></tr>`;
    }).join('');
    return `<div class="tbl"><table class="plain"><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${rows || '<tr><td colspan="5">尚未登记——从应急演练开始记</td></tr>'}</table></div>`;
  })()}
    <p class="fine">应急预案演练与从业人员培训是许可条件「安全保障、应急救援制度和措施」的运行证据（体育法第 105 条(三)）；周期为参数化默认值（演练惯例半年、培训一年），属地要求永远赢。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 开馆（五道闸 / 日检卡 / 隐患闭环）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;
  const settings = state.settings ?? {};

  const staffOptions = activeStaff(state).map((s) => `<option value="${e(s.id)}">${e(s.name)} · ${e(STAFF_ROLES[s.role] ?? s.role)}${s.certValidISO ? `（证至 ${e(s.certValidISO)}）` : '（未登记证期）'}</option>`).join('');

  const openings = [...(state.openings ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 15);
  const opRows = openings.map((o) => `<tr>
    <td>${e(o.dateISO)}<br><span class="basis">证至 ${e(o.snapshot?.licenseExpiryISO || '—')}</span></td>
    <td class="w"><span>${e(o.staffNames.join('、'))}</span></td>
    <td class="ops">
      <button class="btn small ghost" data-action="opening-print" data-idx="${o.id}">开馆单</button>
      <button class="btn small ghost" data-action="del-opening" data-idx="${o.id}">删</button>
    </td>
  </tr>`).join('');

  const dcToday = (state.daychecks ?? []).find((d) => d.dateISO === today);
  const items = daycheckItemsFor(state);
  const dcCard = !items.length
    ? '<p class="fine">先在「建档」勾选经营项目——检查卡按项目自动生成条目。</p>'
    : `<div class="checklist">${items.map((it) => `
      <label class="check-item"><input type="checkbox" id="dc-${e(it.key)}" ${dcToday?.items.find((x) => x.key === it.key)?.ok ? 'disabled checked' : ''} /> <span>${e(it.label)}</span></label>
      <input class="dc-note" id="dcnote-${e(it.key)}" placeholder="异常时必写处置说明" ${dcToday ? 'disabled' : ''} />
    `).join('')}</div>
    <div class="row"><button class="btn" data-action="add-daycheck" ${dcToday ? 'disabled' : ''}>${dcToday ? `今日已落卡（${dcToday.status === 'issue' ? `含 ${dcToday.items.filter((i) => !i.ok).length} 项异常` : '全项正常'}）` : '落检查卡'}</button>
    <span class="basis">同日唯一；异常必须写处置说明并自动转隐患——隐患闭环前，明日开馆闸不放行</span></div>`;

  const hzs = [...(state.hazards ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const HZST = { open: ['未整改', 'bad'], fixed: ['待复查', 'warn'], closed: ['已闭环', 'ok'] };
  const hzRows = hzs.map((h) => `<tr class="${h.status !== 'closed' ? 'muted' : ''}">
    <td>${e(h.dateISO)}</td><td>${e(HAZARD_SOURCES[h.source] ?? h.source)}</td>
    <td class="w"><span>${e(h.desc)}</span></td>
    <td>${h.status === 'open' ? '<strong>未整改</strong>' : `${e(h.actionISO || '—')}<br><span class="basis">${e(h.action || '')}</span>`}</td>
    <td><span class="pill ${HZST[h.status]?.[1] ?? ''}">${HZST[h.status]?.[0] ?? h.status}</span></td>
    <td class="ops">${h.status === 'open' ? `<button class="btn small" data-action="show-fix-hazard" data-idx="${h.id}">整改</button>` : h.status === 'fixed' ? `<button class="btn small" data-action="show-close-hazard" data-idx="${h.id}">复查销案</button>` : ''}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">开馆五道闸（开门前的门禁：五闸全过才许接待）</h2>
  <div class="card">
    <div class="form-grid">
      <label>开馆日期<input id="op-date" type="date" value="${e(today)}" /></label>
      <label>当日在岗人员（按住 Ctrl 多选）*
        <select id="op-staff" multiple size="4">${staffOptions || '<option value="">先去「建档」登记持证人员</option>'}</select>
      </label>
      <label class="span2">备注<input id="op-note" placeholder="天气/特殊活动/限流（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-opening">过闸开馆</button><span class="basis">五道闸：许可证在期（《体育法》第 105/116 条）→ 在岗人数达到规定数量（第 105 条(二)）→ 在岗证书全部在期（检查标准 5）→ 当日开放前检查已落卡（17 号令第 22 条）→ 无未闭环隐患——任一不过，当场拦截</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>在岗人员</th><th></th></tr>${opRows || '<tr><td colspan="3">还没有开馆单——营业日开门第一件事</td></tr>'}</table></div>
    <p class="fine">落账即存当日快照（许可证有效期、在岗人员证书期），检查进门出示「开馆单」+ 名录照片张贴即为检查标准 5 的自查答案。</p>
  </div>

  <h2 class="sec">每日开放前安全检查（17 号令第 22 条安全检查制度 · GB 19079 系列通识条目）</h2>
  <div class="card">${dcCard}</div>

  <h2 class="sec">隐患整改闭环（日检异常自动转入 / 监督检查 / 自查）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日<input id="hz-date" type="date" value="${e(today)}" /></label>
      <label>来源
        <select id="hz-source"><option value="selfcheck">自查上报</option><option value="inspection">监督检查</option></select>
      </label>
      <label class="span2">描述 *<input id="hz-desc" placeholder="如：B 区坠落区垫块移位 / 3 号气瓶年检到期" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-hazard">登记隐患</button><span class="basis">闭环状态机：登记 → 整改（措施+完成日）→ 复查销案（复查人+复查日）；跳级拒绝。未闭环隐患=开馆闸第 5 道不放行</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>来源</th><th>描述</th><th>整改</th><th>状态</th><th></th></tr>${hzRows || '<tr><td colspan="6">还没有隐患登记（无事即最好的事）</td></tr>'}</table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 体检 / 出证三通道）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const e = esc;
  const openingOptions = [...(state.openings ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((o) => `<option value="${e(o.id)}">${e(o.dateISO)}</option>`).join('');

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到场馆群存档或报合伙人——含开馆单/闸机拦截/日检/隐患/许可证与人员器材点名/体检与法条口径尾注。</p>'}
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
    <p class="fine">单文件含：场馆与许可证、体检明细、人员名册、器材一物一档、开馆记录、日检记录、隐患闭环、变更手续、周期义务——对口体育部门监督检查与总局检查标准 5 条，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>当日开馆单<select id="case-opening">${openingOptions || '<option value="">先过闸开出开馆单</option>'}</select></label>
      <button class="btn" data-action="opening-download" ${openingOptions ? '' : 'disabled'}>${icon('dl')} 开馆单打印版</button>
    </div>
    <p class="fine">按单打印贴前台：五道闸核对 + 当日在岗人员与证书期 + 张贴自查栏——检查进门 10 秒出示「今天这扇门是合规开的」。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  return `
  <h2 class="sec">参数（属地体育部门要求永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>许可证临期提醒（天）<input id="set-renew" type="number" min="15" max="365" value="${s.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS}" /></label>
      <label>器材检验临期提醒（天）<input id="set-gear" type="number" min="7" max="120" value="${s.gearWarnDays ?? DEFAULT_GEAR_WARN_DAYS}" /></label>
      <label>周期义务临期提醒（天）<input id="set-duty" type="number" min="7" max="120" value="${s.dutyWarnDays ?? DEFAULT_DUTY_WARN_DAYS}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">届满 30 日前申请续期（17 号令第 14 条）为法定窗口不可调，这里只调提醒提前量；器材检验周期逐件在档案中设置（气瓶按检验规程、绳索按厂家口径）；演练/培训等义务周期按惯例参数化。</p>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与使用记录；人员证书编号等信息也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例场馆（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 开馆闸三连拦截（证书过期/日检未落/隐患未闭环）→ 整改销案 → 过闸开馆 → 三通道出证。</p>
  </div>`;
}
