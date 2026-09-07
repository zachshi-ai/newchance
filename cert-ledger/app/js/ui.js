/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  CHANGE_KINDS, STAFF_ROLES, CALIB_TYPES, QUALITY_KINDS, PT_RESULTS, DUTY_KINDS,
  DEFAULT_RENEW_WARN_DAYS, CALIB_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
  certState, activeCapabilities, activeEquipments, equipState, activeSigners,
  openChanges, openNCs, auditState, dutyBoard,
  healthCheck, monthlySummary, expiredKeeps,
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
  ledger: IC('<path d="M4 20l1.2-4.2L16.6 4.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M13.5 7.5l3 3"/>'),
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
  lab: IC('<path d="M9.5 3h5"/><path d="M10 3v5.2L5.6 16a3 3 0 0 0 2.7 4.4h7.4a3 3 0 0 0 2.7-4.4L14 8.2V3"/><path d="M7.5 14h9"/>'),
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
  <h2 class="sec">检验检测机构，先有一本查得到的账</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>检验检测行业正在出清与强监管的交汇点：截至 2024 年底全国机构 53,057 家（近年首降）、2026 年八部门联合抽查已是第三个年头——每家机构先按《自查表》自查整改，再迎双随机抽查；山西省 2025 年抽查 100 家 68 家有一般性问题。而 39 号令把三条红线画在报告上：<strong>使用未经检定/校准的设备出报告=不实报告</strong>（第 13 条(二)）、<strong>未经检验检测或伪造数据=虚假报告</strong>（第 14 条）、两者都能罚到撤销资质；163 号令则把<strong>超范围出报告（第 36 条）、非授权签字人签发（39 号令第 25 条）、过期证书（第 37 条）</strong>各挂 3 万。一家 1~20 人的小微机构，证书 6 年一续、设备一年一检、内审管评一年一轮、能力验证年年参加、报告保存 6 年——现状解法是 Excel、台历和检查前突击。<strong>「做了」与「能证明做了」之间没有任何小微级工具。</strong></p>
    <p><strong>检证账的做法：</strong>机构建档（证书钟，届满 3 个月延续窗口自动黄）→ 能力附表（超范围闸的底座）→ 设备一机一档（检定/校准钟）→ 人员名册（授权签字人职称门槛）→ <strong>报告三道闸</strong>（超范围、无溯源、非授权签字人签发——当场拦截并给法条理由；开出来的每一份都自带参数-附表-设备-签字人证据链与 6 年保存钟）→ 内审/管理评审/能力验证质量账（能力验证不合格自动停报该参数、闭环自动恢复）→ 变更手续台账（第 14 条五情形，未办结=1 万风险在案）→ 年度义务（年报/自我声明/自查表）→ 一键出迎检自证包 / 报告合规核对单 / 月度小结。</p>
    <div class="row">
      <a class="btn" href="#/station">${icon('station')} 先把机构建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是机构自查与应对检查的底账，不替代资质认定申请、延续、变更、注销与能力验证报送等法定程序；数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：证书钟 + 设备钟 + 报告闸 + 质量 + 义务）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.station?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const boxes = [];

  const cert = certState(state.station, today, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);
  if (cert.level === 'overdue' || cert.level === 'unset') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>资质证书红灯</strong></div><ul><li>${esc(cert.detail)}</li></ul></div>`);
  } else if (cert.level === 'window' || cert.level === 'warn') {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>延续窗口/临期</strong></div><ul><li>${esc(cert.detail)}</li></ul></div>`);
  }

  const eqs = activeEquipments(state);
  const overEq = eqs.filter((e) => equipState(e, today, settings.calibWarnDays ?? CALIB_WARN_DAYS).level === 'overdue');
  const unsetEq = eqs.filter((e) => equipState(e, today, settings.calibWarnDays ?? CALIB_WARN_DAYS).level === 'unset');
  const dueEq = eqs.filter((e) => equipState(e, today, settings.calibWarnDays ?? CALIB_WARN_DAYS).level === 'due');
  if (overEq.length || unsetEq.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('lab')}</span><strong>设备溯源红灯（${overEq.length + unsetEq.length}）</strong></div>
      <ul>${[...overEq, ...unsetEq].slice(0, 4).map((e) => `<li>${esc(e.name)}（${esc(e.code)}）——${esc(equipState(e, today, settings.calibWarnDays ?? CALIB_WARN_DAYS).detail)}</li>`).join('')}</ul></div>`);
  } else if (dueEq.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>设备溯源临期（${dueEq.length}）</strong></div>
      <ul>${dueEq.slice(0, 4).map((e) => `<li>${esc(e.name)}（${esc(e.code)}）——${esc(equipState(e, today, settings.calibWarnDays ?? CALIB_WARN_DAYS).detail)}</li>`).join('')}</ul></div>`);
  }

  const signers = activeSigners(state);
  if (!signers.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('person')}</span><strong>无在册授权签字人</strong></div><ul><li>报告必须由授权签字人在其技术能力范围内签发（39 号令第 11 条）——去「建档」登记（中级及以上职称或同等能力，2023 准则第 9 条(三)）。</li></ul></div>`);
  }

  const openCh = openChanges(state);
  if (openCh.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>变更手续未办结（${openCh.length}）</strong></div>
      <ul>${openCh.slice(0, 3).map((c) => `<li>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}（${esc(c.dateISO)}）——${esc(c.detail)}；办理回执后点「办结」</li>`).join('')}</ul></div>`);
  }

  const ia = auditState(state, 'internal', today);
  const mr = auditState(state, 'mreview', today);
  for (const [a, label] of [[ia, '内部审核'], [mr, '管理评审']]) {
    if (a.level === 'never' || a.level === 'overdue') {
      boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>${label}欠账</strong></div><ul><li>${esc(a.detail)}</li></ul></div>`);
    } else if (a.level === 'due') {
      boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>${label}临期</strong></div><ul><li>${esc(a.detail)}</li></ul></div>`);
    }
  }

  const openNc = openNCs(state);
  const ptOpen = openNc.filter((n) => n.source === 'pt');
  if (openNc.length) {
    boxes.push(`<div class="card alert ${ptOpen.length ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('bell')}</span><strong>不符合项未闭环（${openNc.length}${ptOpen.length ? `，其中能力验证 ${ptOpen.length}` : ''}）</strong></div>
      <ul>${openNc.slice(0, 4).map((n) => `<li>${esc(n.desc)}${n.capName ? `——${esc(n.capName)}已停报` : ''}</li>`).join('')}</ul></div>`);
  }

  const expired = expiredKeeps(state, today);
  if (expired.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('reports')}</span><strong>报告保存期满（${expired.length}）</strong></div><ul><li>最早一批 ${esc(expired[0].reportNo)}（保存至 ${esc(expired[0].keepUntil)}）——按程序处置并登记留痕（39 号令第 12 条：保存不少于 6 年）。</li></ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>证书在期、设备溯源在期、授权签字人在册、内审管评在轮、能力验证已闭环、变更无欠账——继续保持，落账别断。</li></ul></div>`);
  }

  // hero：体检计分环 + 三只芯片 + 本月计数
  const hc = healthCheck(state, today, settings);
  const sum = monthlySummary(state, today.slice(0, 7), today);
  const certChip = cert.level === 'overdue'
    ? { cls: 'bad', big: '已过期', sub: '停报+延续（第 37 条）' }
    : cert.level === 'window'
      ? { cls: 'warn', big: `剩${cert.daysLeft}天`, sub: '届满 3 个月前延续' }
      : { cls: 'ok', big: cert.level === 'unset' ? '未登记' : '在期', sub: cert.level === 'unset' ? '先录证书有效期' : `至 ${state.station.certExpiryISO}` };
  const eqChip = overEq.length || unsetEq.length
    ? { cls: 'bad', big: `异常${overEq.length + unsetEq.length}`, sub: '超期=不实报告风险' }
    : dueEq.length
      ? { cls: 'warn', big: `临期${dueEq.length}`, sub: '安排送检' }
      : { cls: 'ok', big: eqs.length ? '全部在期' : '无设备', sub: eqs.length ? '检定/校准在管' : '先建设备台账' };
  const ncChip = openNc.length
    ? { cls: ptOpen.length ? 'bad' : 'warn', big: `${openNc.length} 项`, sub: ptOpen.length ? '能力验证整改中·参数停报' : '整改闭环中' }
    : { cls: 'ok', big: '全闭环', sub: '内审/管评/能力验证' };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · 在用参数 ${activeCapabilities(state).length} 项 · 在用设备 ${eqs.length} 台 · 在册 ${signers.length} 名签字人</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${certChip.cls}"><span class="chip-label">证书钟</span><span class="chip-big">${esc(certChip.big)}</span><span class="chip-sub">${esc(certChip.sub)}</span></div>
        <div class="chip ${eqChip.cls}"><span class="chip-label">设备溯源钟</span><span class="chip-big">${esc(eqChip.big)}</span><span class="chip-sub">${esc(eqChip.sub)}</span></div>
        <div class="chip ${ncChip.cls}"><span class="chip-label">整改闭环</span><span class="chip-big">${esc(ncChip.big)}</span><span class="chip-sub">${esc(ncChip.sub)}</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${sum.reports}</b><span>本月落账报告</span></div>
      <div class="stat"><b>${sum.blocked}</b><span>闸机拦截（都算没被罚）</span></div>
      <div class="stat"><b>${sum.score}</b><span>体检得分</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/ledger">去落账/打卡</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 建档（机构 + 能力附表 + 设备一机一档 + 人员名册 + 变更台账 + 年度义务）
// ---------------------------------------------------------------------------

export function viewStation(state) {
  const s = state.station ?? {};
  const today = todayISO();
  const settings = state.settings ?? {};
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;
  const capOptions = (state.capabilities ?? []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

  const cert = certState(s, today, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);

  const capRows = (state.capabilities ?? []).map((c) => `<tr class="${c.status === 'active' ? '' : 'muted'}">
    <td>${esc(c.name)}<br><span class="basis">${esc(c.standard || '—')}</span></td>
    <td>${c.status === 'active' ? '<span class="pill ok">在用</span>' : `<span class="pill bad">停用</span><br><span class="basis">${esc(c.suspendedReason || '')}</span>`}</td>
    <td class="ops">
      <button class="btn small ghost" data-action="${c.status === 'active' ? 'show-suspend-cap' : 'resume-cap'}" data-idx="${c.id}">${c.status === 'active' ? '停用' : '恢复'}</button>
      <button class="btn small ghost" data-action="del-cap" data-idx="${c.id}">删</button>
    </td>
  </tr>`).join('');

  const equipRows = (state.equipments ?? []).map((eq) => {
    const es = equipState(eq, today, settings.calibWarnDays ?? CALIB_WARN_DAYS);
    const caps = (eq.capIds ?? []).map((cid) => (state.capabilities ?? []).find((c) => c.id === cid)?.name ?? '').filter(Boolean).join('、');
    return `<tr class="${eq.outOfServiceISO ? 'muted' : ''}">
    <td>${esc(eq.name)}<br><span class="basis">${esc(eq.code)}</span></td>
    <td class="w w3"><span>${esc(caps || '—')}</span></td>
    <td>${esc(CALIB_TYPES[eq.calibType] ?? eq.calibType)}<br><span class="basis">${eq.cycleMonths} 个月</span></td>
    <td>${esc(eq.calibDueISO || '—')}<br><span class="basis">${esc(es.detail).slice(0, 40)}</span></td>
    <td>${eq.outOfServiceISO ? '<span class="pill bad">停用</span>' : '<span class="pill ok">在用</span>'}</td>
    <td class="ops">
      <button class="btn small ghost" data-action="show-calib" data-idx="${eq.id}">溯源完成</button>
      <button class="btn small ghost" data-action="toggle-equip" data-idx="${eq.id}">${eq.outOfServiceISO ? '复用' : '停用'}</button>
      <button class="btn small ghost" data-action="del-equip" data-idx="${eq.id}">删</button>
    </td>
  </tr>`;
  }).join('');

  const staffRows = (state.staff ?? []).map((p) => `<tr class="${p.active ? '' : 'muted'}">
    <td>${esc(p.name)}</td><td class="w"><span>${esc(STAFF_ROLES[p.role] ?? p.role)}${p.title ? `<br><span class="basis">${esc(p.title)}</span>` : ''}</span></td>
    <td>${esc(p.certValidISO || '—')}</td>
    <td><button class="btn small ghost" data-action="toggle-staff" data-idx="${p.id}">${p.active ? '停用' : '恢复'}</button></td>
  </tr>`).join('');

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr class="${c.status === 'open' ? '' : 'muted'}">
    <td>${esc(c.dateISO)}</td><td>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}</td><td class="w"><span>${esc(c.detail)}</span></td>
    <td>${c.status === 'filed' ? `<span class="pill ok">已办结 ${esc(c.filedISO)}</span>` : `<span class="pill warn">未办结</span><button class="btn small" data-action="show-file-change" data-idx="${c.id}">办结</button>`}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">机构建档与资质证书钟（163 号令现行版第 13/15 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>机构名称 *<input id="st-name" value="${esc(s.name ?? '')}" placeholder="如：绿源环境检测有限公司" /></label>
      <label>资质认定证书编号 *<input id="st-certno" value="${esc(s.certNo ?? '')}" placeholder="如：25xxxxxxxxxx" /></label>
      <label>发证机关<input id="st-issuer" value="${esc(s.issuer ?? '')}" placeholder="如：XX省市场监督管理局" /></label>
      <label>证书有效期至 *<input id="st-certexpiry" type="date" value="${esc(s.certExpiryISO ?? '')}" placeholder="6 年一续（第 13 条）" /></label>
      <label>检验检测领域<input id="st-field" value="${esc(s.field ?? '')}" placeholder="如：生态环境监测/食品/建材" /></label>
      <label>最高管理者<input id="st-manager" value="${esc(s.manager ?? '')}" placeholder="对体系全面负责" /></label>
      <label>技术负责人<input id="st-tech" value="${esc(s.techLeader ?? '')}" /></label>
      <label>质量负责人<input id="st-quality" value="${esc(s.qualityLeader ?? '')}" placeholder="内审、不符合项验证建议人选" /></label>
      <label class="span2">地址<input id="st-address" value="${esc(s.address ?? '')}" placeholder="检验检测场所地址（变更应办手续）" /></label>
      <label class="span2">备注<input id="st-note" value="${esc(s.note ?? '')}" placeholder="可空" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-station">保存机构信息</button>
      <button class="btn ghost" data-action="show-renew" ${s.certExpiryISO ? '' : 'disabled'}>延续办结（滚动 6 年）</button>
      <span>${pill(cert.level)}&nbsp;<span class="basis">${esc(cert.detail)}</span></span>
    </div>
    <p class="fine">证书有效期 6 年；延续申请应在有效期届满 3 个月前提出（163 号令现行版第 13 条，上一许可周期无违规可书面审查延续）；届满未延续将被注销（第 31 条），使用过期证书出报告罚 3 万元以下（第 37 条）。</p>
  </div>

  <h2 class="sec">能力附表（证书附表的参数底座——超范围闸在此校验）</h2>
  <div class="card">
    <div class="form-grid">
      <label>参数/项目名称 *<input id="cap-name" placeholder="如：水中化学需氧量 / 土壤 pH 值" /></label>
      <label>依据标准<input id="cap-standard" placeholder="如：HJ 828-2017 / NY/T 1121.2-2006" /></label>
      <label class="span2">备注<input id="cap-remark" placeholder="限制范围/点注（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-cap">录入附表</button><span class="basis">应在证书规定的检验检测能力范围内出具数据结果（163 号令第 19 条）——超范围出报告处 3 万元罚款（第 36 条(二)）；项目取消应办理变更手续（第 14 条(三)）</span></div>
    <div class="tbl"><table class="plain"><tr><th>参数/项目</th><th>状态</th><th></th></tr>${capRows || '<tr><td colspan="3">还没有录入——从证书附表第一行开始</td></tr>'}</table></div>
  </div>

  <h2 class="sec">设备一机一档（检定/校准/核查钟——2023 准则第 11 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>设备名称 *<input id="eq-name" placeholder="如：紫外可见分光光度计" /></label>
      <label>设备编号 *<input id="eq-code" placeholder="如：UV-752-01" /></label>
      <label>关联参数（按住 Ctrl 多选）
        <select id="eq-caps" multiple size="3">${capOptions || '<option value="">先录入能力附表</option>'}</select>
      </label>
      <label>溯源方式
        <select id="eq-calibtype"><option value="calibrate">校准</option><option value="verify">检定</option><option value="check">核查</option></select>
      </label>
      <label>周期（月）<input id="eq-cycle" type="number" min="1" max="60" value="12" placeholder="按 JJG/JJF 规程或溯源计划" /></label>
      <label>最近检定/校准日<input id="eq-lastcalib" type="date" placeholder="按证书填写，自动推导下次到期" /></label>
      <label class="span2">备注<input id="eq-note" placeholder="出厂编号/量程/标准物质（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-equip">建档</button><span class="basis">对数据结果准确性/有效性有影响的设备应实施检定、校准或核查，保证计量溯源性（2023 准则第 11 条(二)）；使用未经检定/校准的设备出报告属不实报告情形（39 号令第 13 条(二)）</span></div>
    <div class="tbl"><table class="plain"><tr><th>设备</th><th>关联参数</th><th>方式</th><th>有效期至</th><th>状态</th><th></th></tr>${equipRows || '<tr><td colspan="6">还没有设备建档——从第一台开始</td></tr>'}</table></div>
    <p class="fine">停用设备的关联参数出报告闸不放行；溯源完成后点「溯源完成」，到期钟按周期自动滚动。周期默认 12 个月可改（按规程/溯源计划）。</p>
  </div>

  <h2 class="sec">人员名册（2023 准则第 9 条 · 授权签字人是签发闸的钥匙）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名 *<input id="ppl-name" placeholder="如：林晚秋" /></label>
      <label>角色 *
        <select id="ppl-role">${Object.entries(STAFF_ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label>职称（授权签字人必填）<input id="ppl-title" placeholder="如：高级工程师（中级及以上或同等能力）" /></label>
      <label>资质有效期至<input id="ppl-certvalid" type="date" placeholder="职称证书/资格证书（可空）" /></label>
      <label class="span2">备注<input id="ppl-note" placeholder="劳动关系/多机构执业自查（39 号令第 7 条：不得同时在两个以上机构从业）（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-staff">入册</button><span class="basis">授权签字人应具有中级及以上相关专业技术职称或同等能力（2023 准则第 9 条(三)），并在其技术能力范围内签发报告（39 号令第 11 条）——非授权签字人签发责令改正，逾期处 3 万元以下（第 25 条(三)）</span></div>
    <div class="tbl"><table class="plain"><tr><th>姓名</th><th>角色/职称</th><th>资质有效期至</th><th></th></tr>${staffRows || '<tr><td colspan="4">名册为空——先登记授权签字人</td></tr>'}</table></div>
    <p class="fine">离职人员「停用」不删除：历史报告仍可回溯到签发人；停用后出报告闸直接拒绝。</p>
  </div>

  <h2 class="sec">变更手续台账（163 号令现行版第 14 条五情形）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发生日<input id="cg-date" type="date" value="${esc(today)}" /></label>
      <label>情形
        <select id="cg-kind">${Object.entries(CHANGE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label class="span2">说明 *<input id="cg-detail" placeholder="变更前后内容，如：授权签字人由张三变更为李四" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-change">登记变更</button><span class="basis">五情形应向资质认定部门申请办理变更手续（第 14 条）；未办理的责令限期改正，逾期未改正处 1 万元以下罚款（第 35 条(一)）——办理回执后点「办结」</span></div>
    <div class="tbl"><table class="plain"><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows || '<tr><td colspan="4">暂无变更事项（有变化先登记再办手续）</td></tr>'}</table></div>
  </div>

  <h2 class="sec">年度义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)} · ${v.cycleDays}天</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="报送回执/自查表年份（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="set-duty">登记完成</button></div>
    ${(() => {
    const rows = dutyBoard(state, today).map((d) => {
      const lv = d.level === 'never' ? 'never' : d.level;
      const next = d.level === 'never' ? '从未执行' : `${esc(d.nextDue)}（${d.daysLeft < 0 ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}）`;
      return `<tr class="${lv === 'never' || lv === 'overdue' ? 'muted' : ''}"><td>${esc(d.label)}</td><td>${d.lastDoneISO ? esc(d.lastDoneISO) : '—'}</td><td>${next}</td><td><span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span></td><td class="basis w"><span>${esc(d.basis)}</span></td></tr>`;
    }).join('');
    return `<div class="tbl"><table class="plain"><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${rows || '<tr><td colspan="5">尚未登记——从年度报告开始记</td></tr>'}</table></div>`;
  })()}
    <p class="fine">年度报告与统计信息、自我声明公开为 39 号令第 16 条义务（2015 版 163 号令原第 37 条已废止，勿引旧条号）；年度自查表为八部门 2026 年度监督抽查通知口径（2026-08-31 前完成自查整改、材料留存备查）。周期为参数化默认值，属地要求永远赢。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 台账（报告三道闸 / 质量记录 / 不符合项闭环）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;
  const settings = state.settings ?? {};

  const capOptions = activeCapabilities(state).map((c) => `<option value="${e(c.id)}">${e(c.name)}</option>`).join('');
  const signerOptions = activeSigners(state).map((s) => `<option value="${e(s.id)}">${e(s.name)}（${e(s.title)}）</option>`).join('');

  const reports = [...(state.reports ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 15);
  const rpRows = reports.map((r) => `<tr>
    <td>${e(r.reportNo)}<br><span class="basis">${e(r.dateISO)}${r.client ? ` · ${e(r.client)}` : ''}</span></td>
    <td class="w"><span>${e(r.paramNames.join('、'))}</span></td>
    <td>${e(r.signerName)}<br><span class="basis">${r.cmaMarked ? 'CMA 已标注' : '<strong>未标注 CMA</strong>'}</span></td>
    <td class="ops">
      <button class="btn small ghost" data-action="report-print" data-idx="${r.id}">核对单</button>
      <button class="btn small ghost" data-action="del-report" data-idx="${r.id}">删</button>
    </td>
  </tr>`).join('');

  const quality = [...(state.quality ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 12);
  const qtRows = quality.map((q) => `<tr>
    <td>${e(QUALITY_KINDS[q.kind] ?? q.kind)}</td><td>${e(q.dateISO)}</td>
    <td class="w"><span>${e(q.title)}</span></td>
    <td>${q.kind === 'pt' ? (q.result === 'pass' ? '<span class="pill ok">合格</span>' : '<span class="pill bad">不合格</span>') : ''}</td>
    <td class="ops"><button class="btn small ghost" data-action="del-quality" data-idx="${q.id}">删</button></td>
  </tr>`).join('');

  const ncs = [...(state.ncs ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const NCST = { open: ['未整改', 'bad'], fixed: ['待验证', 'warn'], closed: ['已闭环', 'ok'] };
  const ncRows = ncs.map((n) => `<tr class="${n.status !== 'closed' ? 'muted' : ''}">
    <td>${e(n.dateISO)}</td><td>${n.source === 'internal' ? '内审' : n.source === 'pt' ? '能力验证' : n.source === 'mreview' ? '管理评审' : n.source === 'inspection' ? '监督检查' : '自查'}${n.capName ? `<br><span class="basis">${e(n.capName)} 停报中</span>` : ''}</td>
    <td class="w"><span>${e(n.desc)}</span></td>
    <td>${n.status === 'open' ? '<strong>未整改</strong>' : `${e(n.actionISO || '—')}<br><span class="basis">${e(n.action || '')}</span>`}</td>
    <td><span class="pill ${NCST[n.status]?.[1] ?? ''}">${NCST[n.status]?.[0] ?? n.status}</span></td>
    <td class="ops">${n.status === 'open' ? `<button class="btn small" data-action="show-fix-nc" data-idx="${n.id}">整改</button>` : n.status === 'fixed' ? `<button class="btn small" data-action="show-close-nc" data-idx="${n.id}">验证关闭</button>` : ''}</td>
  </tr>`).join('');

  const ia = auditState(state, 'internal', today);
  const mr = auditState(state, 'mreview', today);

  return `
  <h2 class="sec">报告三道闸（39 号令红线：不实/虚假报告出不了门）</h2>
  <div class="card">
    <div class="form-grid">
      <label>报告编号 *<input id="rp-no" placeholder="编号规则唯一，如：绿源检字〔2026〕第 09-012 号" /></label>
      <label>报告日期<input id="rp-date" type="date" value="${e(today)}" /></label>
      <label>委托方<input id="rp-client" placeholder="如：XX食品有限公司（可空）" /></label>
      <label>检验检测参数（按住 Ctrl 多选）*
        <select id="rp-params" multiple size="4">${capOptions || '<option value="">先去「建档」录入能力附表</option>'}</select>
      </label>
      <label>签发授权签字人 *
        <select id="rp-signer">${signerOptions || '<option value="">先去「建档」登记授权签字人</option>'}</select>
      </label>
      <label>CMA 标志
        <select id="rp-cma"><option value="yes">已标注（163 号令第 21 条）</option><option value="no">未标注</option></select>
      </label>
      <label class="span2">分包说明<input id="rp-subcontract" placeholder="分包项目与承担机构（无分包留空）——39 号令第 10 条" /></label>
      <label class="span2">备注<input id="rp-note" placeholder="样品编号/原始记录位置（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-report">落账</button><span class="basis">闸机核对：证书在期（163 号令第 13/31/37 条）→ 参数在能力附表且在用（第 19/36 条(二)）→ 每个参数有在期溯源设备（39 号令第 13 条(二)）→ 签发人是在册授权签字人（第 11/25 条(三)）——任一不过，当场拦截</span></div>
    <div class="tbl"><table class="plain"><tr><th>报告</th><th>参数</th><th>签发</th><th></th></tr>${rpRows || '<tr><td colspan="4">还没有报告落账</td></tr>'}</table></div>
    <p class="fine">落账即存合规快照（证书有效期、设备溯源到期、签字人职称），6 年保存钟自动起算（39 号令第 12 条）；「核对单」可打印单份报告的证据链。</p>
  </div>

  <h2 class="sec">质量记录（内审/管理评审/能力验证/内部质控——2023 准则第 12 条）</h2>
  <div class="card">
    <div class="row" style="margin-top:0">
      <span class="basis">内审：${esc(ia.detail)}</span><br>
      <span class="basis">管理评审：${esc(mr.detail)}</span>
    </div>
    <div class="form-grid">
      <label>类型
        <select id="qt-kind">${Object.entries(QUALITY_KINDS).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join('')}</select>
      </label>
      <label>日期<input id="qt-date" type="date" value="${e(today)}" /></label>
      <label>能力验证结论（类型=能力验证时）
        <select id="qt-result"><option value="pass">合格</option><option value="unsat">不合格（不满意或有问题）</option></select>
      </label>
      <label>相关参数（不合格必选）
        <select id="qt-cap"><option value="">—</option>${capOptions}</select>
      </label>
      <label class="span2">内容摘要 *<input id="qt-title" placeholder="如：2026 年度内审（覆盖全部要素）/ 水质 pH 能力验证（NCATEST 2026-B）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-quality">登记</button><span class="basis">内审/管理评审惯例每年一次（同年度唯一，RB/T 214—2017 惯例口径，2023 准则第 12 条概括义务）；能力验证不合格自动挂不符合项并停报该参数——整改完成、确认通过后自动恢复（能力验证办法第 20 条）</span></div>
    <div class="tbl"><table class="plain"><tr><th>类型</th><th>日期</th><th>内容摘要</th><th>结论</th><th></th></tr>${qtRows || '<tr><td colspan="5">还没有质量记录——年内审先排上</td></tr>'}</table></div>
  </div>

  <h2 class="sec">不符合项整改闭环（内审/能力验证/管理评审/检查/自查）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日<input id="nc-date" type="date" value="${e(today)}" /></label>
      <label>来源
        <select id="nc-source"><option value="manual">自查上报</option><option value="internal">内部审核</option><option value="mreview">管理评审</option><option value="inspection">监督检查</option></select>
      </label>
      <label>涉及参数（挂起=停报）
        <select id="nc-cap"><option value="">不涉及具体参数</option>${capOptions}</select>
      </label>
      <label class="span2">描述 *<input id="nc-desc" placeholder="如：天平室未按规程记录温湿度 / 能力验证甲醛项目 z 值不合格" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-nc">登记不符合项</button><span class="basis">闭环状态机：登记 → 整改（措施+完成日）→ 验证关闭（验证人+验证日）；跳级拒绝。涉及参数勾选「挂起」即停报，验证关闭后自动恢复</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>来源</th><th>描述</th><th>整改</th><th>状态</th><th></th></tr>${ncRows || '<tr><td colspan="6">还没有不符合项登记（无事即最好的事）</td></tr>'}</table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 体检 / 出证三通道）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const e = esc;
  const reportOptions = [...(state.reports ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((r) => `<option value="${e(r.id)}">${e(r.reportNo)}</option>`).join('');

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到管理群存档或报最高管理者——含报告落账/闸机拦截/质量记录/不符合项/证书设备点名/体检七段与法条口径尾注。</p>'}
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
    <p class="fine">单文件含：机构与证书、体检明细、能力附表、设备溯源、人员名册、报告台账、质量记录、变更手续、不符合项闭环、年度义务——对口 39 号令第 17/20 条监督检查与自查要求，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>报告合规核对单<select id="case-report">${reportOptions || '<option value="">先在台账落账报告</option>'}</select></label>
      <button class="btn" data-action="report-download" ${reportOptions ? '' : 'disabled'}>${icon('dl')} 报告核对单</button>
    </div>
    <p class="fine">按单打印：报告要素 + 参数-附表-设备对照 + 落账快照 + 保存钟——委托方质疑或监管抽档时 10 秒自证单份报告的合规证据链。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  return `
  <h2 class="sec">参数（属地资质认定部门与监管部门要求永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>证书临期提醒（天）<input id="set-renew" type="number" min="30" max="365" value="${s.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS}" /></label>
      <label>设备溯源临期提醒（天）<input id="set-calib" type="number" min="7" max="120" value="${s.calibWarnDays ?? CALIB_WARN_DAYS}" /></label>
      <label>年度义务临期提醒（天）<input id="set-duty" type="number" min="7" max="120" value="${s.dutyWarnDays ?? DEFAULT_DUTY_WARN_DAYS}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">证书 6 年、届满 3 个月前申请延续（163 号令现行版第 13 条）、记录保存不少于 6 年（39 号令第 12 条）、内审/管理评审 12 个月惯例周期——均为法定/惯例口径不可调，这里只调提醒提前量；设备溯源周期按 JJG/JJF 规程在设备档案中逐台设置。</p>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与使用记录；报告台账与委托方信息也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例机构（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 报告闸三连拦截（超范围/无溯源/停用签字人）→ 合规落账 → 能力验证不合格停报参数 → 整改闭环自动恢复 → 三通道出证。</p>
  </div>`;
}
