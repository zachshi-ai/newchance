/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  CLASS_KINDS, STAFF_ROLES, DAYCHECK_SEGMENTS, DUTY_KINDS, CHANGE_KINDS, HEALTH_SOURCES, ORG_DOCS,
  DEFAULT_DOC_WARN_DAYS, DEFAULT_HEALTH_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS, DEFAULT_LEASE_WARN_DAYS,
  docState, orgDocBoard, activeStaff, staffHealthState, staffQualState,
  kidsInCare, kidDocGaps, classLoad, daycheckItemsFor, daycheckStatusFor,
  openHealthEvents, openHazards, openChanges, dutyBoard,
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
  kid: IC('<circle cx="10" cy="8.5" r="3.4"/><path d="M4.5 20c1.2-3.2 3.2-5 5.5-5s4.3 1.8 5.5 5"/><circle cx="17.5" cy="9.5" r="2.2"/><path d="M17 14.5c1.6.4 2.9 1.6 3.6 3.5"/>'),
  heart: IC('<path d="M12 20s-7.2-4.6-9-9c-1.2-3 .6-6.3 3.8-6.9 2-.4 4 .6 5.2 2.4 1.2-1.8 3.2-2.8 5.2-2.4 3.2.6 5 3.9 3.8 6.9-1.8 4.4-9 9-9 9z"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', due: 'warn', warn: 'warn', ok: 'ok', never: 'bad', unset: 'bad', none: 'ok' };
const LEVEL_TEXT = { overdue: '已过期', due: '临期', warn: '临期', ok: '在期', never: '从未开展', unset: '未登记', none: '不适用' };

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
  <h2 class="sec">托育园，先有一本能证明「今天怎么开的」的账</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>全国托育服务机构已达 <strong>12.6 万家</strong>（2025-12-26 卫健委发布，两年增 110%）、托位 666 万个——「入托难」正在变成「抢生源」。而托育是备案制下多线监管最密的行业之一：<strong>消防年度证明、食品经营许可证、租期 ≥3 年的租约</strong>（备案材料，管理规范第 4 条；设置标准第 11 条）；<strong>全员健康证一年一检、无证不得上岗</strong>（76 号令第 14 条）；<strong>乳儿班 1:3、托小班 1:5、托大班 1:7 的师幼配比红线</strong>（设置标准第 20 条）；<strong>晨午检+全日健康观察每日两段</strong>（第 24 条）；监控录像留存 ≥90 日、应急演习、年度报告……现状解法是纸质登记本+微信群+记忆——<strong>「证在期、配比够、检已落」与「能向家长和检查证明」之间，没有任何小微级工具。</strong></p>
    <p><strong>托安单的做法：</strong>机构建档（备案+三证钟）→ 人员名册（健康证/资质钟，过期禁上岗）→ 婴幼儿名册（接种证+入托体检查验闸）→ <strong>每日晨午检卡</strong>（异常逐人自动转健康事件，必须「通知监护人+处置意见」闭环、凭治愈证明返园）→ <strong>送托六道闸</strong>（备案证照在期→配比达标→证书在期→晨检已落→隐患闭环→健康事件处置，当场拦截并给法条理由；开出来的每张送托单都自带当日快照）→ 变更备案与周期义务账 → 一键出<strong>迎检自证包 / 当日送托单 / 家长信任公示单</strong>——把信息公示义务（第 15 条）变成招生现场的第一信任资产。</p>
    <div class="row">
      <a class="btn" href="#/station">${icon('station')} 先把机构建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是托育机构自查、家长沟通与迎检备查的底账，不替代备案、卫生评价、消防安全检查、食品经营许可等法定程序；幼儿与健康数据只存你的设备里，出证物脱敏。《托育服务法（草案）》2025-12-22 已初审（8 章 76 条）、尚未施行——现行口径锚定 58 号文两标准+76 号令+备案办法，法律颁布后本工具合规雷达会提示升级。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：三证钟 + 健康证 + 配比 + 今日晨午检/送托 + 事件）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.org?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const boxes = [];

  const docs = orgDocBoard(state, today, settings.docWarnDays ?? DEFAULT_DOC_WARN_DAYS);
  const badDocs = docs.filter((d) => ['unset', 'overdue'].includes(d.level));
  const warnDocs = docs.filter((d) => d.level === 'warn');
  if (!state.org.filedISO) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>备案未登记</strong></div><ul><li>机构登记后应向县级卫健部门备案（管理规范第 4 条；备案办法第 8 条在线备案）——先在「建档」登记备案回执日。</li></ul></div>`);
  }
  if (badDocs.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>机构证照红灯（${badDocs.length}）</strong></div>
      <ul>${badDocs.map((d) => `<li>${esc(d.detail)}</li>`).join('')}</ul></div>`);
  } else if (warnDocs.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>证照临期（${warnDocs.length}）</strong></div>
      <ul>${warnDocs.map((d) => `<li>${esc(d.detail)}</li>`).join('')}</ul></div>`);
  }

  const staff = activeStaff(state);
  const badStaff = staff.filter((s) => ['overdue', 'unset'].includes(staffHealthState(s, today, settings.healthWarnDays ?? DEFAULT_HEALTH_WARN_DAYS).level));
  const warnStaff = staff.filter((s) => staffHealthState(s, today, settings.healthWarnDays ?? DEFAULT_HEALTH_WARN_DAYS).level === 'warn');
  if (badStaff.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('person')}</span><strong>健康证红灯（${badStaff.length}）</strong></div>
      <ul>${badStaff.slice(0, 4).map((s) => `<li>${esc(staffHealthState(s, today).detail)}</li>`).join('')}</ul></div>`);
  } else if (warnStaff.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>健康证临期（${warnStaff.length}）</strong></div>
      <ul>${warnStaff.slice(0, 4).map((s) => `<li>${esc(staffHealthState(s, today).detail)}</li>`).join('')}</ul></div>`);
  }

  const gaps = kidDocGaps(state);
  if (gaps.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('kid')}</span><strong>收托查验缺口（${gaps.length}）</strong></div>
      <ul><li>${esc(gaps.map((k) => `${k.name}${!k.vaccineOK ? '·接种证' : ''}${!k.entryExamISO ? '·入托体检' : ''}`).join('、'))}——查验补齐前不得收托（管理规范第 11 条）</li></ul></div>`);
  }

  const dc = daycheckStatusFor(state, today);
  const passedToday = (state.daypasses ?? []).some((o) => o.dateISO === today);
  const hz = openHazards(state);
  const heOpen = openHealthEvents(state).filter((h) => h.status === 'open');
  const heNotified = openHealthEvents(state).filter((h) => h.status === 'notified');
  if (!passedToday) {
    boxes.push(`<div class="card alert ${hz.length || heOpen.length ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('ledger')}</span><strong>今日还没开送托单</strong></div><ul><li>开园前先过六道闸（备案证照在期 → 配比达标 → 证书在期 → 晨检已落 → 隐患闭环 → 健康事件处置）${hz.length ? `——当前 ${hz.length} 项未闭环隐患` : ''}${heOpen.length ? `、${heOpen.length} 起待处置健康事件` : ''}。</li></ul></div>`);
  }
  if (heOpen.length || heNotified.length) {
    boxes.push(`<div class="card alert ${heOpen.length ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('heart')}</span><strong>健康事件待闭环（${heOpen.length + heNotified.length}）</strong></div>
      <ul>${[...heOpen, ...heNotified].slice(0, 4).map((h) => `<li>${esc(h.kidName)}（${esc(HEALTH_SOURCES[h.source] ?? h.source)}）——${h.status === 'open' ? '待通知监护人+处置' : '待返园核验（治愈证明）'}</li>`).join('')}</ul></div>`);
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
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>变更备案未办结（${openCh.length}）</strong></div>
      <ul>${openCh.slice(0, 3).map((c) => `<li>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}（${esc(c.dateISO)}）——${esc(c.detail)}；办理后点「办结」</li>`).join('')}</ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>证在期、配比够、检已落、事件闭环——继续保持，晨午检和送托单别断。</li></ul></div>`);
  }

  // hero：体检计分环 + 三只芯片 + 本月计数
  const hc = healthCheck(state, today, settings);
  const sum = monthlySummary(state, today.slice(0, 7), today);
  const kids = kidsInCare(state);
  const loads = classLoad(state);
  const ratioChipCls = Object.values(loads).some((l) => l.overMax) ? 'bad' : 'ok';
  const docChip = badDocs.length
    ? { cls: 'bad', big: `缺${badDocs.length}证`, sub: '先补备案材料' }
    : warnDocs.length
      ? { cls: 'warn', big: `临期${warnDocs.length}`, sub: '安排换证/续签' }
      : { cls: 'ok', big: '三证在期', sub: state.org.filedISO ? `备案 ${state.org.filedISO}` : '备案未登记' };
  const dcChip = dc.morning && dc.noon
    ? { cls: 'ok', big: '晨午检齐', sub: '今日两段已落卡' }
    : dc.morning ? { cls: 'warn', big: '晨检已落', sub: '午检待午间' }
      : { cls: 'warn', big: '晨检未落', sub: '入园时段先落卡' };
  const passChip = passedToday
    ? { cls: 'ok', big: '已送托', sub: '六道闸全过' }
    : { cls: heOpen.length || hz.length ? 'bad' : 'warn', big: '未送托', sub: heOpen.length || hz.length ? '先闭环再过闸' : '开园前过六道闸' };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · 在园 ${kids.length} 人 · 在册 ${staff.length} 人 · ${Object.values(loads).filter((l) => l.kids > 0).length} 个班</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${docChip.cls}"><span class="chip-label">机构证照钟</span><span class="chip-big">${esc(docChip.big)}</span><span class="chip-sub">${esc(docChip.sub)}</span></div>
        <div class="chip ${dcChip.cls}"><span class="chip-label">今日晨午检</span><span class="chip-big">${esc(dcChip.big)}</span><span class="chip-sub">${esc(dcChip.sub)}</span></div>
        <div class="chip ${passChip.cls}"><span class="chip-label">今日送托</span><span class="chip-big">${esc(passChip.big)}</span><span class="chip-sub">${esc(passChip.sub)}</span></div>
        <div class="chip ${ratioChipCls}"><span class="chip-label">收托上限</span><span class="chip-big">${Object.values(loads).some((l) => l.overMax) ? '超限' : '达标'}</span><span class="chip-sub">1:3 / 1:5 / 1:7</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${sum.passes}</b><span>本月送托单</span></div>
      <div class="stat"><b>${sum.blocked}</b><span>闸机拦截（都算没被罚）</span></div>
      <div class="stat"><b>${sum.score}</b><span>体检得分</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/ledger">去送托/晨午检</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 建档（机构 + 人员名册 + 婴幼儿名册 + 变更备案 + 周期义务）
// ---------------------------------------------------------------------------

export function viewStation(state) {
  const s = state.org ?? {};
  const today = todayISO();
  const settings = state.settings ?? {};
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;

  const docs = orgDocBoard(state, today, settings.docWarnDays ?? DEFAULT_DOC_WARN_DAYS);

  const staffRows = (state.staff ?? []).map((p) => {
    const hs = staffHealthState(p, today, settings.healthWarnDays ?? DEFAULT_HEALTH_WARN_DAYS);
    const qs = staffQualState(p, today);
    const HS_SHORT = { overdue: '已过期·禁上岗', unset: '未登记证期', warn: `剩 ${hs.daysLeft} 天`, ok: '在期' };
    return `<tr class="${p.active ? '' : 'muted'}">
    <td>${esc(p.name)}</td>
    <td class="w"><span>${esc(STAFF_ROLES[p.role] ?? p.role)}${p.qualName || p.qualValidISO ? `<br><span class="basis">${esc(p.qualName || '资质')}${p.qualValidISO ? ` 至 ${esc(p.qualValidISO)}` : ''}${qs.level === 'unset' || qs.level === 'overdue' ? '·缺位' : ''}</span>` : ''}</span></td>
    <td>${esc(p.healthValidISO || '—')}<span class="basis">${esc(HS_SHORT[hs.level] ?? hs.detail)}</span></td>
    <td><button class="btn small ghost" data-action="toggle-staff" data-idx="${p.id}">${p.active ? '停用' : '恢复'}</button></td>
  </tr>`;
  }).join('');

  const kids = kidsInCare(state);
  const loads = classLoad(state);
  const kidRows = kids.map((k) => {
    const gap = !k.vaccineOK || !k.entryExamISO;
    return `<tr class="${gap ? '' : ''}">
    <td>${esc(k.name)}</td>
    <td>${esc(CLASS_KINDS[k.classKind]?.label ?? k.className)}<br><span class="basis">${gap ? `${!k.vaccineOK ? '接种证未查验 ' : ''}${!k.entryExamISO ? '入托体检未登记' : ''}` : '查验齐全'}</span></td>
    <td>${esc(k.entryExamISO || '—')}</td>
    <td class="ops">
      <button class="btn small ghost" data-action="kid-vaccine" data-idx="${k.id}">${k.vaccineOK ? '重验接种' : '接种已验'}</button>
      <button class="btn small ghost" data-action="kid-out" data-idx="${k.id}">离园</button>
    </td>
  </tr>`;
  }).join('');

  const loadCards = Object.entries(loads).filter(([, l]) => l.kids > 0).map(([k, l]) => `
    <div class="chip ${l.overMax ? 'bad' : 'ok'}" style="min-width:0">
      <span class="chip-label">${esc(l.label)}</span>
      <span class="chip-big">${l.kids}/${l.max} 人</span>
      <span class="chip-sub">1:${l.ratio} · 需保育 ${l.carersNeeded}</span>
    </div>`).join('');

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr class="${c.status === 'open' ? '' : 'muted'}">
    <td>${esc(c.dateISO)}</td><td class="w"><span>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}<span class="basis">${esc(c.detail)}</span></span></td>
    <td>${c.status === 'filed' ? `<span class="pill ok">已办结</span><span class="basis">${esc(c.filedISO)}</span>` : `<span class="pill warn">未办结</span><button class="btn small" data-action="show-file-change" data-idx="${c.id}">办结</button>`}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">机构建档与备案证照钟（管理规范第 4 条；设置标准第 11 条；WS/T 821 4.1.4）</h2>
  <div class="card">
    <div class="form-grid">
      <label>机构名称 *<input id="vg-name" value="${esc(s.name ?? '')}" placeholder="如：晨曦托育园" /></label>
      <label>备案回执日<input id="vg-filed" type="date" value="${esc(s.filedISO ?? '')}" placeholder="卫健部门备案回执日期" /></label>
      <label>统一社会信用代码<input id="vg-uscc" value="${esc(s.uscc ?? '')}" placeholder="营业执照/法人证书载明" /></label>
      <label>机构性质
        <select id="vg-nature">
          ${['', '营利性', '非营利性', '事业单位/单位办托'].map((x) => `<option value="${x}" ${s.nature === x ? 'selected' : ''}>${x || '未选择'}</option>`).join('')}
        </select>
      </label>
      <label>消防安全检查合格证明至 *<input id="vg-fire" type="date" value="${esc(s.docs?.fire ?? '')}" placeholder="WS/T 821 4.1.4 年度口径" /></label>
      <label>食品经营许可证至<input id="vg-food" type="date" value="${esc(s.docs?.food ?? '')}" placeholder="供餐时必配" /></label>
      <label>场地租约到期日<input id="vg-lease" type="date" value="${esc(s.docs?.lease ?? '')}" placeholder="设置标准第 11 条：租赁期不少于 3 年" /></label>
      <label>负责人<input id="vg-principal" value="${esc(s.principal ?? '')}" /></label>
      <label class="span2">地址<input id="vg-address" value="${esc(s.address ?? '')}" placeholder="变更场地须办理变更备案（备案办法第 10 条）" /></label>
      <label>联系电话<input id="vg-phone" value="${esc(s.phone ?? '')}" placeholder="可空" /></label>
      <label class="check-item" style="align-self:end"><input type="checkbox" id="vg-meals" ${s.meals ? 'checked' : ''} /> <span>自办食堂/供餐（驱动食品证钟与晨检条目）</span></label>
      <label class="span2">备注<input id="vg-note" value="${esc(s.note ?? '')}" placeholder="如：2025-03 备案，收托规模 60 人（可空）" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-org">保存机构信息</button>
      <span>${docs.map((d) => `${pill(d.level)}&nbsp;${esc(d.label.split('（')[0])}`).join('&nbsp;&nbsp;')}</span>
    </div>
    <div class="tbl"><table class="plain"><tr><th>证照</th><th>有效期至</th><th>状态与依据</th></tr>
    ${docs.map((d) => `<tr><td class="w"><span>${esc(d.label)}<span class="basis">${esc(d.basis)}</span></span></td><td>${esc(state.org?.docs?.[d.key] || '—')}</td><td>${pill(d.level)}<span class="basis">${esc(d.detail)}</span></td></tr>`).join('')}
    </table></div>
    <p class="fine">备案材料六件套（备案办法第 8 条）：营业执照/法人证书、场地证明、人员资格与健康合格证明、评价合格的《托幼机构卫生评价报告》、消防安全检查合格证明、供餐的食品经营许可证——本工具按「有效期钟」跟踪消防年度证明（WS/T 821 4.1.4 年度口径）与食品证、租约；卫生评价报告在备案时核验，本工具以备案回执日为锚。</p>
  </div>

  <h2 class="sec">工作人员名册（设置标准第 18 条；健康证全员年检——76 号令第 14 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名 *<input id="ppl-name" placeholder="如：周暖晴" /></label>
      <label>岗位 *
        <select id="ppl-role">${Object.entries(STAFF_ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label>健康证有效期至 *<input id="ppl-health" type="date" placeholder="无健康合格证不得上岗（76 号令第 14 条）" /></label>
      <label>岗位资质证（负责人/保健/保安必配）<input id="ppl-qualname" placeholder="如：保健员培训合格证" /></label>
      <label>资质有效期至<input id="ppl-qualvalid" type="date" placeholder="按证书载明" /></label>
      <label>无犯罪记录核查日<input id="ppl-criminal" type="date" placeholder="入职核查（WS/T 821 5.1.6）" /></label>
      <label class="span2">备注<input id="ppl-note" placeholder="育婴员等级/急救复训等（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-staff">入册</button><span class="basis">健康证过期=送托闸第 3 道拦截（聘用未体检人员属 76 号令第 19 条处罚情形）；停用保留历史名册可回溯</span></div>
    <div class="tbl"><table class="plain"><tr><th>姓名</th><th>岗位/资质</th><th>健康证至</th><th></th></tr>${staffRows || '<tr><td colspan="4">名册为空——负责人、保育、保健、保安、炊事五类按需配齐</td></tr>'}</table></div>
    <p class="fine">保健人员按 76 号令第 12 条：收托 150 名以上至少 1 名专职（150 名以下专职或兼职）；负责人岗位培训 ≥60 学时（WS/T 821 5.2.1）；保安持《保安员证》并由持证保安公司派驻（设置标准第 18 条）。</p>
  </div>

  <h2 class="sec">婴幼儿名册与班级配比（管理规范第 11 条；设置标准第 19/20 条）</h2>
  <div class="card">
    <div class="row" style="flex-wrap:wrap">${loadCards || '<span class="basis">还没有在园幼儿——收托前逐人查验接种证与入托体检</span>'}</div>
    <div class="form-grid" style="margin-top:10px">
      <label>姓名 *<input id="kd-name" placeholder="如：小满" /></label>
      <label>班型 *
        <select id="kd-class">${Object.entries(CLASS_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)} · 上限 ${v.max} 人 · 1:${v.ratio}</option>`).join('')}</select>
      </label>
      <label class="check-item" style="align-self:end"><input type="checkbox" id="kd-vaccine" /> <span>接种证已查验（76 号令第 15 条(六)）</span></label>
      <label>入托体检合格日<input id="kd-exam" type="date" placeholder="管理规范第 11 条：健康检查合格方可入托" /></label>
      <label class="span2">备注<input id="kd-note" placeholder="过敏原/特殊照护（可空，只存本机）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-kid">收托入册</button><span class="basis">接种证或入托体检未齐=收托查验缺口（红灯+送托前必处理）；离园 3 个月以上返回须重新健康检查（第 11 条）</span></div>
    <div class="tbl"><table class="plain"><tr><th>姓名</th><th>班型/查验</th><th>入托体检</th><th></th></tr>${kidRows || '<tr><td colspan="4">婴幼儿名册为空</td></tr>'}</table></div>
  </div>

  <h2 class="sec">变更备案台账（管理规范第 6 条；备案办法第 10 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发生日<input id="cg-date" type="date" value="${esc(today)}" /></label>
      <label>情形
        <select id="cg-kind">${Object.entries(CHANGE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.split('（')[0])}</option>`).join('')}</select>
      </label>
      <label class="span2">说明 *<input id="cg-detail" placeholder="变更前后内容，如：收托规模 60→80 人（已报变更备案）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-change">登记变更</button><span class="basis">变更备案事项应向原备案部门办理变更备案（管理规范第 6 条）；终止服务先妥善安置再注销（第 7 条）——办理后点「办结」</span></div>
    <div class="tbl"><table class="plain"><tr><th>发生日</th><th>情形与说明</th><th>办理</th></tr>${changeRows || '<tr><td colspan="3">暂无变更事项（有变化先登记再办手续）</td></tr>'}</table></div>
  </div>

  <h2 class="sec">周期义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label.split('（')[0])} · ${v.cycleDays}天</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="演练科目/培训对象/保单号（可空）" /></label>
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
    <p class="fine">应急演习/培训周期为参数化默认值（管理规范第 31 条「定期」+WS/T 821 9.5.2，惯例半年/一年）；消防设备与设施设备按 WS/T 821 9.3 每月专人检查；年度报告每年年底向卫健部门报告（管理规范第 38 条）；监控录像保存 ≥90 日（第 32 条）在「设施维护」义务中一并核查。属地要求永远赢。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 日托（送托六道闸 / 晨午检卡 / 健康事件 / 隐患闭环）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;
  const settings = state.settings ?? {};

  const carers = activeStaff(state).filter((s) => s.role === 'carer');
  const allStaff = activeStaff(state);
  const staffOpt = (list, sel) => list.map((s) => `<option value="${e(s.id)}" ${sel?.includes(s.id) ? 'selected' : ''}>${e(s.name)} · ${e(STAFF_ROLES[s.role] ?? s.role)}${s.healthValidISO ? `（证至 ${e(s.healthValidISO)}）` : '（未登记证期）'}</option>`).join('');

  const passes = [...(state.daypasses ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const passRows = passes.map((o) => `<tr>
    <td>${e(o.dateISO)}<br><span class="basis">在园 ${o.snapshot?.kidCount ?? '—'} 人</span></td>
    <td class="w"><span>${e(o.staffNames.join('、'))}</span></td>
    <td class="ops">
      <button class="btn small ghost" data-action="daypass-print" data-idx="${o.id}">送托单</button>
      <button class="btn small ghost" data-action="del-daypass" data-idx="${o.id}">删</button>
    </td>
  </tr>`).join('');

  const dc = daycheckStatusFor(state, today);
  const dcCard = (['morning', 'noon']).map((seg) => {
    const items = daycheckItemsFor(state, seg);
    const rec = dc[seg];
    const segLabel = DAYCHECK_SEGMENTS[seg].label;
    return `<h3 style="margin:6px 0 8px;font-size:14px">${e(segLabel)}${rec ? ` · <span class="pill ${rec.status === 'issue' ? 'warn' : 'ok'}">${rec.status === 'issue' ? `异常 ${rec.items.filter((i) => !i.ok).length} 项已处置` : '全项正常'}</span>` : ''}</h3>
    <div class="checklist">${items.map((it) => `
      <label class="check-item"><input type="checkbox" id="dc-${e(it.key)}" ${rec?.items.find((x) => x.key === it.key)?.ok ? 'disabled checked' : ''} /> <span>${e(it.label)}</span></label>
      <input class="dc-note" id="dcnote-${e(it.key)}" placeholder="异常时必写处置说明" ${rec ? 'disabled' : ''} />
    `).join('')}</div>
    ${seg === 'morning' && !rec ? `
    <div class="form-grid" style="margin-top:8px">
      <label>晨检异常幼儿（姓名 · 症状，逗号分隔可多条）<input id="dc-abnormal" placeholder="如：小满 · 低热 37.8℃" /></label>
      <label class="span2 basis">填写后落卡将自动开健康事件——先「通知监护人+处置意见」闭环，才能过送托闸第 6 道</label>
    </div>` : ''}
    <div class="row"><button class="btn" data-action="add-daycheck" data-seg="${seg}" ${rec ? 'disabled' : ''}>${rec ? `已落卡（${rec.status === 'issue' ? '含异常' : '全项正常'}）` : `落${segLabel}`}</button></div>`;
  }).join('<div style="height:10px"></div>');

  const hes = [...(state.healthEvents ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 15);
  const HEST = { open: ['待通知处置', 'bad'], notified: ['待返园核验', 'warn'], returned: ['已闭环', 'ok'] };
  const heRows = hes.map((h) => `<tr class="${h.status !== 'returned' ? 'muted' : ''}">
    <td>${e(h.dateISO)}</td><td>${e(h.kidName)}<br><span class="basis">${e(HEALTH_SOURCES[h.source] ?? h.source)}</span></td>
    <td class="w"><span>${e(h.symptom || '—')}${h.reportISO ? `<br><span class="basis">疑似传染病已报告 ${e(h.reportISO)}</span>` : ''}</span></td>
    <td>${h.notifyISO ? `${e(h.notifyISO)}<br><span class="basis">${e(h.action)}</span>` : '<strong>待通知</strong>'}</td>
    <td><span class="pill ${HEST[h.status]?.[1] ?? ''}">${HEST[h.status]?.[0] ?? h.status}</span></td>
    <td class="ops">${h.status === 'open' ? `<button class="btn small" data-action="show-notify-he" data-idx="${h.id}">通知处置</button>` : h.status === 'notified' ? `<button class="btn small" data-action="show-return-he" data-idx="${h.id}">返园核验</button>` : ''}</td>
  </tr>`).join('');

  const hzs = [...(state.hazards ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const HZST = { open: ['未整改', 'bad'], fixed: ['待复查', 'warn'], closed: ['已闭环', 'ok'] };
  const hzRows = hzs.map((h) => `<tr class="${h.status !== 'closed' ? 'muted' : ''}">
    <td>${e(h.dateISO)}</td><td>${e({ daycheck: '晨午检卡', inspection: '监督检查', selfcheck: '自查上报' }[h.source] ?? h.source)}</td>
    <td class="w"><span>${e(h.desc)}</span></td>
    <td>${h.status === 'open' ? '<strong>未整改</strong>' : `${e(h.actionISO || '—')}<br><span class="basis">${e(h.action || '')}</span>`}</td>
    <td><span class="pill ${HZST[h.status]?.[1] ?? ''}">${HZST[h.status]?.[0] ?? h.status}</span></td>
    <td class="ops">${h.status === 'open' ? `<button class="btn small" data-action="show-fix-hazard" data-idx="${h.id}">整改</button>` : h.status === 'fixed' ? `<button class="btn small" data-action="show-close-hazard" data-idx="${h.id}">复查销案</button>` : ''}</td>
  </tr>`).join('');

  const ratio = classLoad(state);
  const carersNeeded = Object.values(ratio).filter((l) => l.kids > 0).reduce((a, b) => a + b.carersNeeded, 0);

  return `
  <h2 class="sec">送托六道闸（开园前的门禁：六闸全过才许收托）</h2>
  <div class="card">
    <div class="form-grid">
      <label>送托日期<input id="dp-date" type="date" value="${e(today)}" /></label>
      <label>今日在岗保育人员（按住 Ctrl 多选）*
        <select id="dp-carers" multiple size="4">${staffOpt(carers) || '<option value="">先去「建档」登记保育人员</option>'}</select>
      </label>
      <label>今日在岗全员（含保健/保安/炊事/负责人）
        <select id="dp-staff" multiple size="4">${staffOpt(allStaff) || '<option value="">先去「建档」登记人员</option>'}</select>
      </label>
      <label class="span2">备注<input id="dp-note" placeholder="天气/活动/家长开放日（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-daypass">过闸送托</button><span class="basis">今日在园 ${kidsInCare(state).length} 人，按班配比需保育 ≥${carersNeeded} 人（1:3/1:5/1:7，设置标准第 20 条）</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>在岗人员</th><th></th></tr>${passRows || '<tr><td colspan="3">还没有送托单——营业日开门第一件事</td></tr>'}</table></div>
    <p class="fine">六道闸：备案证照在期（管理规范第 4 条+WS/T 821 4.1.4）→ 师幼配比达标、班型不超上限（设置标准第 19/20 条）→ 在岗健康证与资质全部在期（76 号令第 14 条）→ 今日晨检已落（管理规范第 24 条）→ 无未闭环隐患 → 无待处置健康事件。落账即存当日快照。</p>
  </div>

  <h2 class="sec">每日晨午检卡（管理规范第 24 条晨午检与全日健康观察 · 条目按供餐/乳儿班自动生成）</h2>
  <div class="card">${dcCard}
    <p class="fine">同日同段唯一；异常必须写处置说明；晨检/午检发现的异常幼儿逐人自动转健康事件——「通知监护人+处置意见」闭环前，送托闸第 6 道不放行。异常条目属管理类隐患的自动登记隐患。</p>
  </div>

  <h2 class="sec">健康事件闭环（发现 → 通知监护人 → 凭治愈证明返园；76 号令第 18 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日<input id="he-date" type="date" value="${e(today)}" /></label>
      <label>来源
        <select id="he-source">${Object.entries(HEALTH_SOURCES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label>幼儿姓名 *<input id="he-kid" placeholder="在园幼儿姓名" /></label>
      <label>症状描述<input id="he-symptom" placeholder="如：低热 37.8℃ / 手部疱疹" /></label>
      <label class="span2 check-item"><input type="checkbox" id="he-reportable" /> <span>疑似传染病（按当地疾控规定报告并消毒——76 号令第 16 条；闭环时可补登记报告日）</span></label>
    </div>
    <div class="row"><button class="btn" data-action="add-healthevent">登记健康事件</button><span class="basis">状态机：发现 → 通知监护人+处置意见 → 返园核验（治愈/健康证明）；跳级拒绝。疑似传染病报告以疾控渠道为准，本工具留痕</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>幼儿</th><th>症状</th><th>通知与处置</th><th>状态</th><th></th></tr>${heRows || '<tr><td colspan="6">还没有健康事件登记（无事即最好的事）</td></tr>'}</table></div>
    <p class="fine">发现婴幼儿遭受或疑似遭受家庭暴力的，应当依法及时向公安机关报案（管理规范第 25 条强制报告）——此类事件不走本状态机，直接报案并线下留证。</p>
  </div>

  <h2 class="sec">安全隐患整改闭环（监督检查 / 自查 / 设施巡查）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日<input id="hz-date" type="date" value="${e(today)}" /></label>
      <label>来源
        <select id="hz-source"><option value="selfcheck">自查上报</option><option value="inspection">监督检查</option></select>
      </label>
      <label class="span2">描述 *<input id="hz-desc" placeholder="如：楼梯口护栏松动 / 应急灯失效" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-hazard">登记隐患</button><span class="basis">闭环状态机：登记 → 整改（措施+完成日）→ 复查销案（复查人+复查日）；跳级拒绝。未闭环隐患=送托闸第 5 道不放行</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>来源</th><th>描述</th><th>整改</th><th>状态</th><th></th></tr>${hzRows || '<tr><td colspan="6">还没有隐患登记（无事即最好的事）</td></tr>'}</table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 体检 / 出证四通道）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const e = esc;
  const passOptions = [...(state.daypasses ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((o) => `<option value="${e(o.id)}">${e(o.dateISO)}</option>`).join('');

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到家长群/举办者群存档——含送托单/闸机拦截/晨午检/健康事件/证照与健康证点名/体检与法条口径尾注。</p>'}
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

  <h2 class="sec">出证（四通道）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="inspect-download">${icon('dl')} 迎检自证包（HTML）</button>
      <button class="btn ghost" data-action="inspect-print">${icon('print')} 迎检自证包（打印）</button>
    </div>
    <p class="fine">单文件含：机构与备案、体检明细、人员名册（健康证/资质/无犯罪核查）、班级配比、在园幼儿查验、送托记录、晨午检记录、健康事件闭环、隐患闭环、变更备案与周期义务——对口卫健/妇幼/疾控/卫生监督的监督检查，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>当日送托单<select id="case-daypass">${passOptions || '<option value="">先过闸开出送托单</option>'}</select></label>
      <button class="btn" data-action="daypass-download" ${passOptions ? '' : 'disabled'}>${icon('dl')} 当日送托单打印版</button>
    </div>
    <p class="fine">按单打印贴园门口/前台：六道闸核对 + 当日在岗人员与健康证期 + 信息公示自查栏——家长接送、检查进门 10 秒出示「今天这个园是合规开的」。</p>
    <div class="row" style="margin-top:10px">
      <button class="btn" data-action="trust-download">${icon('heart')} 家长信任公示单（HTML）</button>
      <button class="btn ghost" data-action="trust-copy">家长信任公示（文本）</button>
    </div>
    <p class="fine">把管理规范第 15 条信息公示义务变成招生资产：备案与证照状态、员工健康证比例、师幼配比、晨午检与消毒频次、健康事件闭环——全部脱敏（不出幼儿姓名与证件号），打印贴大厅 / 文本发家长群，家长可现场调阅底稿核对。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  return `
  <h2 class="sec">参数（属地卫健部门要求永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>证照临期提醒（天）<input id="set-doc" type="number" min="7" max="180" value="${s.docWarnDays ?? DEFAULT_DOC_WARN_DAYS}" /></label>
      <label>健康证临期提醒（天）<input id="set-health" type="number" min="14" max="180" value="${s.healthWarnDays ?? DEFAULT_HEALTH_WARN_DAYS}" /></label>
      <label>周期义务临期提醒（天）<input id="set-duty" type="number" min="7" max="120" value="${s.dutyWarnDays ?? DEFAULT_DUTY_WARN_DAYS}" /></label>
      <label>租约到期提醒（天）<input id="set-lease" type="number" min="14" max="365" value="${s.leaseWarnDays ?? DEFAULT_LEASE_WARN_DAYS}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">班型收托上限与师幼配比（1:3/1:5/1:7）为设置标准第 19/20 条法定红线不可调（混合班配比未定、默认按 1:5 属地从严，可来信反馈属地口径）；健康证「每年 1 次」为 76 号令第 14 条口径；演练/培训/报送等义务周期按惯例参数化；预收费资金监管按属地试点规定执行（多地银行存管试点，国家层面暂无统一强制文件）。</p>
  </div>

  <h2 class="sec">合规雷达（立法与口径动态）</h2>
  <div class="card">
    <ul class="radar">
      <li><strong>《托育服务法（草案）》</strong>：2025-12-22 提请十四届全国人大常委会第十九次会议初次审议（8 章 76 条，设托育机构、托育人员等专章），已公开征求意见；<strong>截至 2026-09 尚未颁布施行</strong>——本工具全部条号锚定现行规范（58 号文两标准+76 号令+备案办法+WS/T 821），法律颁布后请关注升级版，不沿用草案条号。</li>
      <li><strong>WS/T 821—2023</strong>《托育机构质量评估标准》（2024-04-01 实施）为<strong>推荐性</strong>行业标准：七维度 1000 分、16 项基础指标一票否决——属地把它用于普惠验收/等级评定时，本工具体检项已按其指标对齐。</li>
      <li><strong>育儿补贴与普惠托位</strong>：2025 年新增普惠托位 89.2 万个、千人口托位数 4.73 个（卫健委 2025-12-26 发布）——普惠验收对台账与公示的要求只会更严，提前把账做实。</li>
      <li><strong>口径雷区</strong>：76 号令适用「托儿所、幼儿园」，托育机构经 58 号文第 23/28 条与《基本条件告知书》转致适用；「150 名儿童至少 1 名专职保健人员」不要写成「每 150 名配 1 名保健医」。</li>
    </ul>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与使用记录；婴幼儿姓名、健康事件等信息也在其中，转存注意保管、勿发公共群。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例机构（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 送托闸三连拦截（健康事件待处置/隐患未闭环/配比不足）→ 通知处置与整改销案 → 过闸送托 → 四通道出证。</p>
  </div>`;
}
