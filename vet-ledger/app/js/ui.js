/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  STAFF_TYPES, EVENT_KINDS, EVENT_SEVERITIES, WASTE_KINDS, WASTE_WAYS, DRUG_KINDS, DUTY_KINDS,
  DEFAULT_COLD_MIN_C, DEFAULT_COLD_MAX_C, DEFAULT_WASTE_MOVE_DAYS, DEFAULT_GAP_DAYS,
  postingState, changeState, prescribers, activeStaff,
  visitGapDays, rxViolations, lastVisitISO,
  expiryBoard, excursions, coldchainToday, coldchainGapDays,
  openWastes, openEvents, lateEvents, dutyBoard,
  annualReportState, healthCheck, monthlySummary,
  fmtYuan, escapeHtml, todayISO, daysUntil,
} from './core.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// 内联 SVG 图标（stroke: currentColor；零依赖、随主题变色）
// ---------------------------------------------------------------------------

const IC = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  board: IC('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>'),
  clinic: IC('<path d="M4 21V8l8-4 8 4v13"/><path d="M4 21h16"/><path d="M12 10v6M9 13h6"/>'),
  ledger: IC('<path d="M4 20l1.2-4.2L16.6 4.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M13.5 7.5l3 3"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  shield: IC('<path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.3-7 9-4.1-1.7-7-4.7-7-9V5.8z"/><path d="M9 11.8l2.2 2.2L15.4 9.6"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  paw: IC('<ellipse cx="8" cy="8.5" rx="1.5" ry="2.1"/><ellipse cx="12" cy="7" rx="1.5" ry="2.1"/><ellipse cx="16" cy="8.5" rx="1.5" ry="2.1"/><path d="M12 11.2c2.3 0 4.1 2 4.1 4 0 1.7-1.3 2.8-2.6 2.8-.8 0-1.2-.4-1.5-.4s-.7.4-1.5.4c-1.3 0-2.6-1.1-2.6-2.8 0-2 1.8-4 4.1-4z"/>'),
  pill: IC('<path d="M10.5 4.5l9 9a4.95 4.95 0 1 1-7 7l-9-9a4.95 4.95 0 1 1 7-7z"/><path d="M8 8l8 8"/>'),
  temp: IC('<path d="M10 4a2 2 0 1 1 4 0v9.3a4.5 4.5 0 1 1-4 0z"/><path d="M12 9v6"/>'),
  waste: IC('<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.5h9.2L17.5 7"/><path d="M10.2 10.5v6M13.8 10.5v6"/>'),
  bell: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  calendar: IC('<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  up: IC('<path d="M12 19V8.5"/><path d="M7.5 13 12 8.5 16.5 13"/><path d="M5 4.5h14"/>'),
  trend: IC('<path d="M3 7.5l5.5 5.5 3.5-3.5L20.5 18"/><path d="M20.5 12.5V18H15"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', due: 'warn', ok: 'ok', never: 'bad', unset: 'bad', none: 'ok' };
const LEVEL_TEXT = { overdue: '逾期', due: '临期', ok: '正常', never: '从未执行', unset: '未登记', none: '无待办' };

/** 体检分计分环（暗色 hero 与浅色报表卡通用，颜色按上下文由 CSS 决定） */
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
  <h2 class="sec">动物诊疗机构，先有一本查得到的账</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>宠物诊疗是监管收紧最快的赛道之一：机构要悬挂许可证并公示从业人员（办法 2022-5 号第 17 条）、病历档案保存不少于 3 年（第 22 条）、每年 3 月底前报上年度诊疗情况（第 30 条）、变更名称/负责人 15 个工作日内办变更（第 14 条）；执业助理兽医师不得开处方（2022-6 号第 19 条）、使用未在本机构备案的执业兽医机构被罚（1000~5000 元，第 35 条）；过期兽药即劣兽药（兽药管理条例第 48 条）、无方使用处方药罚 5 万以下（第 66 条）。2025 年 9 月起全面启用新版许可证、专项检查常态化（农办牧〔2025〕20 号）。<strong>诊疗记录在病历本上、温度在墙上表格里、兽医证在抽屉里——"做了"与"能证明做了"之间没有任何小微级工具。</strong></p>
    <p><strong>兽诊账的做法：</strong>机构建档（悬挂公示 + 变更钟自动倒计时）→ 人员备案名册（处方权的名册底座）→ 诊疗 30 秒落账（处方药必须凭方 + 执业兽医师，闸机硬拒绝）→ 疫苗冷链每日两次双录（超温必须处置、批次冻结）→ 狂犬免疫出具证明（只认执业兽医师）→ 医废移交、事件上报、年度报告四只钟 → 一键出迎检自证包 / 月度小结 / 患宠材料单。</p>
    <div class="row">
      <a class="btn" href="#/clinic">${icon('clinic')} 先把机构建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是机构自查与应对检查/纠纷的底账，不替代法定报告、备案与兽医卫生综合信息平台报送；宠主信息建议只登记姓氏或尾号，数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：四只钟 + 名册 + 处方 + 冷链 + 医废 + 事件 + 效期点名）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.station?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const boxes = [];

  const posting = postingState(state.station);
  if (posting.level !== 'ok') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>悬挂公示未落实</strong></div><ul><li>${esc(posting.detail)}——未悬挂许可证或未公示从业人员，责令限期改正可处 1000~5000 元（办法 2022-5 号第 35 条(二)）。去「机构」补登记。</li></ul></div>`);
  }

  const change = changeState(state.station, today);
  if (change.level === 'overdue') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>变更手续已超期</strong></div><ul><li>${esc(change.detail)}——超期可处 1000~5000 元（第 35 条(一)），去「机构」补登记办妥日期。</li></ul></div>`);
  } else if (change.level === 'due') {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>变更手续临近时限</strong></div><ul><li>${esc(change.detail)}——剩 ${change.daysLeft} 天。</li></ul></div>`);
  }

  if (!prescribers(state).length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('paw')}</span><strong>名册中没有在册执业兽医师</strong></div><ul><li>没有执业兽医师，处方、诊断书、免疫证明都开不出去；使用未备案兽医从事诊疗，机构罚 1000~5000 元、个人未备案经营性诊疗机构罚 1 万~5 万（防疫法第 106 条）。去「机构」登记人员名册。</li></ul></div>`);
  }

  const rxv = rxViolations(state);
  if (rxv.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('pill')}</span><strong>处方合规缺口（${rxv.length}）</strong></div>
      <ul>${rxv.slice(0, 5).map((v) => `<li>${esc(v.dateISO)} ${esc(v.animal || v.owner || '—')} · ${esc(v.doctorName)}——缺处方要素，倒查最重的缺口。属实无法补正的，保留原样并写整改说明</li>`).join('')}</ul></div>`);
  }

  const ccToday = coldchainToday(state, today);
  const hasVaccine = (state.drugs ?? []).some((d) => d.kind === 'vaccine' && !d.frozen);
  const exc = excursions(state);
  if (hasVaccine && (!ccToday.am || !ccToday.pm)) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('temp')}</span><strong>今日冷链双录未完成（${ccToday.done}/2）</strong></div><ul><li>按标签贮存条件每日两次记录（默认 [2, 8]℃）——去「台账」打卡，30 秒。</li></ul></div>`);
  }
  if (exc.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('temp')}</span><strong>冷链超温待处置（${exc.length}）</strong></div>
      <ul>${exc.slice(0, 5).map((c) => `<li>${esc(c.dateISO)} ${c.slot === 'am' ? '上午' : '下午'} ${c.tempC}℃——相关批次应冻结待判定，去「台账」处理批次</li>`).join('')}</ul></div>`);
  }

  const nearDrugs = expiryBoard(state, today).filter((d) => d.color === 'expired' || d.color === 'urgent');
  if (nearDrugs.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('pill')}</span><strong>效期点名（${nearDrugs.length}）</strong></div>
      <ul>${nearDrugs.slice(0, 6).map((d) => `<li>${esc(d.name)}（批号 ${esc(d.batchNo || '—')}）${d.color === 'expired' ? `已过期（${esc(d.expiryISO)}）——过期即劣兽药，停止使用、下架登记` : `剩 ${d.daysLeft} 天到期——先进先出`}</li>`).join('')}</ul></div>`);
  }

  const ow = openWastes(state, today);
  const moveDays = settings.wasteMoveDays ?? DEFAULT_WASTE_MOVE_DAYS;
  const overW = ow.filter((w) => w.daysHeld > moveDays);
  if (ow.length) {
    boxes.push(`<div class="card alert ${overW.length ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('waste')}</span><strong>医废暂存待移交（${ow.length}）</strong></div>
      <ul>${ow.slice(0, 5).map((w) => `<li>${esc(w.dateISO)} ${esc(WASTE_KINDS[w.kind] ?? w.kind)} · 已暂存 ${w.daysHeld} 天${w.daysHeld > moveDays ? `——超 ${moveDays} 天红线，今天移交` : ''}</li>`).join('')}</ul></div>`);
  }

  const oe = openEvents(state);
  if (oe.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('bell')}</span><strong>事件未报告闭环（${oe.length}）</strong></div>
      <ul>${oe.slice(0, 5).map((ev) => `<li>${esc(ev.dateISO)} ${esc(EVENT_KINDS[ev.kind] ?? ev.kind)}${ev.severity === 'serious' ? '·严重' : ''} · ${esc(ev.subject || '—')}——严重不良反应立即报告（条例第 50 条）、染疫立即报告（防疫法第 31 条），去「台账」闭环</li>`).join('')}</ul></div>`);
  }

  const ar = annualReportState(state, today);
  if (ar.level === 'overdue') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>年度报告未登记</strong></div><ul><li>${esc(ar.detail)}。去「机构」补登记。</li></ul></div>`);
  } else if (ar.level === 'due') {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>年度报告窗口期</strong></div><ul><li>${esc(ar.detail)}——剩 ${ar.daysLeft} 天。</li></ul></div>`);
  }

  const duties = dutyBoard(state, today).filter((d) => d.level === 'overdue' || d.level === 'never' || d.level === 'due');
  if (duties.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>周期义务点名</strong></div>
      <ul>${duties.map((d) => `<li>${esc(d.label)}：${d.level === 'never' ? '从未执行' : d.level === 'overdue' ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}（依据：${esc(d.basis)}）</li>`).join('')}</ul></div>`);
  }

  const gap = visitGapDays(state, today);
  if (gap !== null && gap > (settings.gapDays ?? DEFAULT_GAP_DAYS)) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>诊疗台账已断更 ${gap} 天</strong></div><ul><li>病历连续性是「规范病历」的一部分（办法 2022-5 号第 22 条），断更是检查现场最尴尬的一问。今天补一笔 30 秒。</li></ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>公示在位、名册齐、处方合规、冷链在续、医废按时移交、事件无挂账——继续保持，落账别断。</li></ul></div>`);
  }

  // hero：体检计分环 + 三只钟 + 本月计数
  const hc = healthCheck(state, today, settings);
  const sum = monthlySummary(state, today.slice(0, 7), today);
  const changeChip = change.level === 'none' || change.level === 'ok'
    ? { cls: 'ok', big: change.level === 'ok' ? '已办结' : '无待办', sub: change.detail }
    : change.level === 'overdue'
      ? { cls: 'bad', big: `超 ${-change.daysLeft} 天`, sub: `期限 ${change.deadline}` }
      : { cls: 'warn', big: `剩 ${change.daysLeft} 天`, sub: `期限 ${change.deadline}` };
  const ccChip = exc.length
    ? { cls: 'bad', big: `超温${exc.length}`, sub: '批次待判定处置' }
    : hasVaccine && (!ccToday.am || !ccToday.pm)
      ? { cls: 'warn', big: `双录 ${ccToday.done}/2`, sub: '今日未录完' }
      : { cls: 'ok', big: '双录在续', sub: hasVaccine ? '无超温记录' : '暂无在用疫苗' };
  const annualChip = ar.level === 'ok'
    ? { cls: 'ok', big: '已报告', sub: `${ar.target} 年度` }
    : ar.level === 'overdue'
      ? { cls: 'bad', big: '未登记', sub: `期限 ${ar.due}` }
      : { cls: 'warn', big: `剩 ${ar.daysLeft} 天`, sub: `期限 ${ar.due}` };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · ${prescribers(state).length ? `在册执业兽医师 ${prescribers(state).length} 人` : '名册缺执业兽医师'}</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${changeChip.cls}"><span class="chip-label">变更钟</span><span class="chip-big">${esc(changeChip.big)}</span><span class="chip-sub">${esc(changeChip.sub)}</span></div>
        <div class="chip ${ccChip.cls}"><span class="chip-label">疫苗冷链</span><span class="chip-big">${esc(ccChip.big)}</span><span class="chip-sub">${esc(ccChip.sub)}</span></div>
        <div class="chip ${annualChip.cls}"><span class="chip-label">年度报告</span><span class="chip-big">${esc(annualChip.big)}</span><span class="chip-sub">${esc(annualChip.sub)}</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${sum.visits}</b><span>本月诊疗落账</span></div>
      <div class="stat"><b>${sum.rabies}</b><span>本月狂犬免疫</span></div>
      <div class="stat"><b>${sum.score}</b><span>体检得分</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/ledger">去落账</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 机构（建档 + 公示 + 变更钟 + 人员名册 + 年度报告 + 周期义务）
// ---------------------------------------------------------------------------

export function viewClinic(state) {
  const s = state.station ?? {};
  const today = todayISO();
  const posting = postingState(s);
  const change = changeState(s, today);
  const ar = annualReportState(state, today);
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;
  const staffRows = (state.staffs ?? []).map((p) => {
    const canRx = prescribers(state).some((x) => x.id === p.id);
    return `<tr class="${p.active ? '' : 'muted'}">
    <td>${esc(p.name)}</td><td>${esc(STAFF_TYPES[p.type] ?? p.type)}${canRx ? ' <span class="pill ok">可开方</span>' : ''}</td>
    <td>${esc(p.certNo || '—')}</td><td>${esc(p.sinceISO || '—')}</td><td class="w"><span>${esc(p.note || '—')}</span></td>
    <td><button class="btn small ghost" data-action="toggle-staff" data-idx="${p.id}">${p.active ? '停用' : '恢复'}</button></td>
  </tr>`;
  }).join('');

  const year = Number(today.slice(0, 4)) - 1;

  return `
  <h2 class="sec">机构建档与证照公示</h2>
  <div class="card">
    <div class="form-grid">
      <label>机构名称 *<input id="st-name" value="${esc(s.name ?? '')}" placeholder="如：XX区XX宠物医院" /></label>
      <label>动物诊疗许可证号<input id="st-certno" value="${esc(s.certNo ?? '')}" placeholder="如：兽诊字第XXXXX号" /></label>
      <label>诊疗活动范围<input id="st-scope" value="${esc(s.scope ?? '')}" placeholder="按许可证核定范围填写" /></label>
      <label>发证机关<input id="st-org" value="${esc(s.org ?? '')}" placeholder="如：XX区农业农村局" /></label>
      <label>发证日期<input id="st-issued" type="date" value="${esc(s.issuedISO ?? '')}" /></label>
      <label>负责人<input id="st-manager" value="${esc(s.manager ?? '')}" /></label>
      <label>电话<input id="st-phone" value="${esc(s.phone ?? '')}" /></label>
      <label class="span2">地址<input id="st-address" value="${esc(s.address ?? '')}" /></label>
      <label>悬挂与公示
        <select id="st-posted"><option value="no" ${!s.posted ? 'selected' : ''}>未落实</option><option value="yes" ${s.posted ? 'selected' : ''}>已悬挂许可证并公示从业人员</option></select>
      </label>
      <label>市场主体变更登记日<input id="st-changed" type="date" value="${esc(s.nameChangedISO ?? '')}" placeholder="名称/负责人变更后填写" /></label>
      <label>变更手续办妥日<input id="st-change-filed" type="date" value="${esc(s.changeFiledISO ?? '')}" placeholder="向原发证机关办妥后填写" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-station">保存机构信息</button>
      <span class="stats-line">公示&nbsp;${pill(posting.level)}&nbsp;变更钟&nbsp;${pill(change.level)}&nbsp;<span class="basis" style="display:inline">${esc(change.detail)}</span></span>
    </div>
    <p class="fine">显著位置悬挂许可证并公示从业人员基本情况（办法 2022-5 号第 17 条，未落实 1000~5000 元，第 35 条(二)）；变更名称或法定代表人（负责人）应自市场主体变更登记后 15 个工作日内向原发证机关申请变更，变更地点/范围重新办证（第 14 条，超期 1000~5000 元，第 35 条(一)）。2025-09-01 起全面启用新版电子证照（农办牧〔2025〕20 号）。</p>
  </div>

  <h2 class="sec">人员备案名册（处方权的名册底座）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名 *<input id="sp-name" placeholder="如：张医生" /></label>
      <label>类型 *
        <select id="sp-type"><option value="vet">执业兽医师（可开方/出证明）</option><option value="assistant">执业助理兽医师（不得开方）</option><option value="rural">乡村兽医（限备案县域乡村）</option></select>
      </label>
      <label>资格证书/备案编号<input id="sp-certno" placeholder="执业兽医资格证书编号" /></label>
      <label>备案/入职日<input id="sp-since" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="sp-note" placeholder="执业范围/继续教育（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-staff">加入名册</button><span class="basis">从事动物诊疗活动应向所在地县级农业农村主管部门备案（防疫法第 69 条·办法 2022-6 号第 12 条）；使用未在本机构备案从业的执业兽医，机构罚 1000~5000 元（办法 2022-5 号第 35 条(四)）</span></div>
    <div class="tbl"><table class="plain"><tr><th>姓名</th><th>类型</th><th>证书/备案</th><th>备案日</th><th>备注</th><th></th></tr>${staffRows || '<tr><td colspan="6">名册为空——先登记执业兽医师</td></tr>'}</table></div>
    <p class="fine">执业兽医师可开具处方、填写诊断书、出具证明文件；执业助理兽医师不得（办法 2022-6 号第 19 条）。台账里的处方闸按名册硬拦截，助理兽医师落账处方药会被直接拒绝。</p>
  </div>

  <h2 class="sec">年度报告钟（每年 3 月底前报上年度）</h2>
  <div class="card">
    <div class="row" style="margin-top:0">${pill(ar.level)}<span class="basis" style="display:inline">${esc(ar.detail)}</span></div>
    <div class="form-grid">
      <label>报告年度<input id="ar-year" type="number" value="${year}" readonly /></label>
      <label>报告日期<input id="ar-date" type="date" value="${esc(today)}" /></label>
      <label>回执/编号<input id="ar-no" placeholder="如：平台报送回执号（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="file-annual">登记已报告</button></div>
    <p class="fine">动物诊疗机构应当于每年 3 月底前将上年度动物诊疗活动情况向县级农业农村主管部门报告（办法 2022-5 号第 30 条）；未按规定报告转致《动物防疫法》第 108 条：责令改正可处 1 万元以下罚款，拒不改正 1 万~5 万元并可责令停业整顿。</p>
  </div>

  <h2 class="sec">周期义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)} · ${v.cycleDays}天</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="消毒区域/设备状态/参训人员（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="set-duty">登记完成</button></div>
    ${(() => {
    const rows = dutyBoard(state, today).map((d) => {
      const lv = d.level === 'never' ? 'never' : d.level;
      const next = d.level === 'never' ? '从未执行' : `${esc(d.nextDue)}（${d.daysLeft < 0 ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}）`;
      return `<tr class="${lv === 'never' || lv === 'overdue' ? 'muted' : ''}"><td>${esc(d.label)}</td><td>${d.lastDoneISO ? esc(d.lastDoneISO) : '—'}</td><td>${next}</td><td><span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span></td><td class="basis w"><span>${esc(d.basis)}</span></td></tr>`;
    }).join('');
    return `<div class="tbl"><table class="plain"><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${rows || '<tr><td colspan="5">尚未登记——从消毒开始记</td></tr>'}</table></div>`;
  })()}
    <p class="fine">周期为参数化默认值（消毒 7 天 / 冷藏设备 30 天 / 培训 365 天），属地要求与主管部门制度永远赢。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 台账（诊疗 / 兽药疫苗 / 冷链 / 狂犬 / 医废 / 事件 六段）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;
  const settings = state.settings ?? {};

  const staffOptions = activeStaff(state).map((p) => `<option value="${e(p.id)}">${e(p.name)} · ${e(STAFF_TYPES[p.type] ?? p.type)}</option>`).join('');
  const vetOptions = prescribers(state).map((p) => `<option value="${e(p.id)}">${e(p.name)}</option>`).join('');
  const vaccineOptions = (state.drugs ?? []).filter((d) => d.kind === 'vaccine').map((d) => `<option value="${e(d.id)}">${e(d.name)}（批号 ${e(d.batchNo || '—')}）</option>`).join('');

  const visits = [...(state.visits ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 30);
  const visitRows = visits.map((v) => `<tr class="${v.rxRequired && (!v.rxNo || v.doctorType !== 'vet') ? 'muted' : ''}">
    <td>${e(v.dateISO)}</td><td>${e(v.owner || '—')}</td><td>${e(v.animal || '—')}</td>
    <td class="w"><span>${e(v.diagnosis || v.complaint || '—')}</span></td>
    <td>${e(v.doctorName)}<br><span class="basis">${e(STAFF_TYPES[v.doctorType] ?? v.doctorType)}</span></td>
    <td>${v.rxRequired ? `№ ${e(v.rxNo || '—')}${v.rxItems ? `<br><span class="basis">${e(v.rxItems)}</span>` : ''}` : '—'}</td>
    <td><button class="btn small ghost" data-action="del-visit" data-idx="${v.id}">删</button></td>
  </tr>`).join('');

  const drugs = [...(state.drugs ?? [])].sort((a, b) => a.expiryISO.localeCompare(b.expiryISO)).slice(0, 30);
  const drugRows = drugs.map((d) => {
    const left = daysUntil(d.expiryISO, today);
    const expired = left < 0;
    return `<tr class="${expired || d.frozen ? 'muted' : ''}">
    <td>${e(d.name)}<br><span class="basis">${e(d.kind === 'vaccine' ? '疫苗' : '兽药')}${d.isRx ? ' · 处方药' : ''}</span></td>
    <td>${e(d.batchNo || '—')}</td><td>${e(d.expiryISO)}<br><span class="basis">${expired ? `已过期 ${-left} 天` : `剩 ${left} 天`}</span></td>
    <td>${d.frozen ? `<span class="pill bad">已冻结</span><br><span class="basis">${e(d.frozenNote || '')}</span>` : (expired ? '<span class="pill bad">禁止使用</span>' : '<span class="pill ok">在用</span>')}</td>
    <td class="w"><span>${e(d.supplier || '—')}</span></td>
    <td>${d.frozen ? `<button class="btn small" data-action="unfreeze-batch" data-idx="${d.id}">解冻</button>` : `<button class="btn small ghost" data-action="freeze-batch" data-idx="${d.id}">冻结</button>`}</td>
  </tr>`;
  }).join('');

  const ccs = [...(state.coldchains ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20);
  const ccRows = ccs.map((c) => `<tr class="${c.excursion ? 'muted' : ''}">
    <td>${e(c.dateISO)}</td><td>${c.slot === 'am' ? '上午' : '下午'}</td><td>${c.tempC}℃</td><td>[${c.minC}, ${c.maxC}]℃</td>
    <td class="w"><span>${c.excursion ? `超温：${e(c.note || '已处置')}` : e(c.note || '—')}</span></td>
    <td><button class="btn small ghost" data-action="del-coldchain" data-idx="${c.id}">删</button></td>
  </tr>`).join('');

  const rabies = [...(state.rabiesLog ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20);
  const rbRows = rabies.map((r) => `<tr>
    <td>${e(r.dateISO)}</td><td>${e(r.pet)}（${e(r.species)}）</td><td>${e(r.owner || '—')}</td>
    <td>${e(r.vaccineName || '—')}<br><span class="basis">批号 ${e(r.batchNo || '—')}</span></td>
    <td>${e(r.certNo)}</td><td>${e(r.doctorName)}</td>
  </tr>`).join('');

  const wastes = [...(state.wastes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20);
  const wsRows = wastes.map((w) => `<tr class="${!w.movedISO ? 'muted' : ''}">
    <td>${e(w.dateISO)}</td><td>${e(WASTE_KINDS[w.kind] ?? w.kind)}</td><td>${w.qty}</td>
    <td>${w.movedISO ? `${e(w.movedISO)}<br><span class="basis">${e(w.receiver)}${w.ticketNo ? ` · 单号 ${e(w.ticketNo)}` : ''}</span>` : '<strong>暂存待移交</strong>'}</td>
    <td>${!w.movedISO ? `<button class="btn small" data-action="show-move-waste" data-idx="${w.id}">移交</button>` : ''}</td>
  </tr>`).join('');

  const events = [...(state.events ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20);
  const evRows = events.map((ev) => `<tr class="${!ev.reportedISO ? 'muted' : ''}">
    <td>${e(ev.dateISO)}</td><td>${e(EVENT_KINDS[ev.kind] ?? ev.kind)}</td><td class="w"><span>${e(ev.subject || '—')}</span></td>
    <td>${e(EVENT_SEVERITIES[ev.severity] ?? ev.severity)}</td>
    <td>${ev.reportedISO ? `${e(ev.reportedISO)}${ev.late ? '<br><span class="basis">迟报（如实保留）</span>' : ''}` : '<strong>未报告</strong>'}</td>
    <td>${!ev.reportedISO ? `<button class="btn small" data-action="show-report-event" data-idx="${ev.id}">报告闭环</button>` : ''}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">诊疗落账（病历 + 处方闸，30 秒一诊）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="vs-date" type="date" value="${e(today)}" /></label>
      <label>宠主（建议姓氏/尾号）<input id="vs-owner" placeholder="如：李女士 / 尾号8823" /></label>
      <label>动物<input id="vs-animal" placeholder="如：金毛「豆豆」/ 猫" /></label>
      <label>诊疗人员（从名册选）<select id="vs-doctor">${staffOptions || '<option value="">先去「机构」登记名册</option>'}</select></label>
      <label class="span2">主诉<input id="vs-complaint" placeholder="如：呕吐两天 / 年度体检（可空）" /></label>
      <label class="span2">诊断与处置<input id="vs-diagnosis" placeholder="如：急性胃炎，输液三天（可空）" /></label>
      <label>涉及兽用处方药
        <select id="vs-rx"><option value="no">否</option><option value="yes">是（必须凭处方笺）</option></select>
      </label>
      <label>处方笺编号<input id="vs-rxno" placeholder="涉及处方药必填" /></label>
      <label class="span2">处方用药<input id="vs-rxitems" placeholder="药名/规格/用法（涉及处方药时填写）" /></label>
      <label class="span2">备注<input id="vs-note" placeholder="告知事项/复查安排（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-visit">落账</button><span class="basis">处方药凭兽医处方笺（处方药办法第 7 条），无方使用没收违法所得并处 5 万元以下罚款（兽药管理条例第 66 条）；助理兽医师开处方按防疫法第 106 条处罚（闸机会拦截）</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>宠主</th><th>动物</th><th>诊断/处置</th><th>人员</th><th>处方</th><th></th></tr>${visitRows || '<tr><td colspan="7">还没有诊疗落账——今天第一诊</td></tr>'}</table></div>
  </div>

  <h2 class="sec">兽药与疫苗批台账（效期先进先出 + 冻结闸）</h2>
  <div class="card">
    <div class="form-grid">
      <label>进货日<input id="dg-date" type="date" value="${e(today)}" /></label>
      <label>类别<select id="dg-kind"><option value="drug">兽药</option><option value="vaccine">兽用疫苗（生物制品）</option></select></label>
      <label>名称 *<input id="dg-name" placeholder="通用名/商品名" /></label>
      <label>批号<input id="dg-batchno" /></label>
      <label>有效期至 *<input id="dg-expiry" type="date" /></label>
      <label>数量<input id="dg-qty" type="number" min="0" value="1" /></label>
      <label>供应商<input id="dg-supplier" placeholder="从有资质企业购进" /></label>
      <label>是否处方药<select id="dg-isrx"><option value="no">非处方药</option><option value="yes">处方药（目录以农业农村部公布为准）</option></select></label>
      <label class="span2">备注<input id="dg-note" placeholder="批准文号/标签核查（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-drug">入账</button><span class="basis">购进兽药应核对标签、说明书与质量合格证（兽药管理条例第 26 条）；过期即劣兽药（第 48 条），闸机在使用/接种前拦截</span></div>
    <div class="tbl"><table class="plain"><tr><th>名称</th><th>批号</th><th>有效期</th><th>状态</th><th>供应商</th><th></th></tr>${drugRows || '<tr><td colspan="6">还没有兽药/疫苗批次</td></tr>'}</table></div>
  </div>

  <h2 class="sec">疫苗冷链双录（每日两次，同日同时段唯一）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="cc-date" type="date" value="${e(today)}" /></label>
      <label>时段<select id="cc-slot"><option value="am">上午</option><option value="pm">下午</option></select></label>
      <label>温度（℃）<input id="cc-temp" type="number" step="0.1" placeholder="如 4.5" /></label>
      <label class="span2">处置说明（超温必填）<input id="cc-note" placeholder="如：门未关严已复位，批次隔离待判定" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-coldchain">打卡</button><span class="basis">区间 [${settings.coldMinC ?? DEFAULT_COLD_MIN_C}, ${settings.coldMaxC ?? DEFAULT_COLD_MAX_C}]℃（按标签贮存条件，参数化）；超温必须写明处置，相关批次应冻结待判定</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>时段</th><th>温度</th><th>区间</th><th>备注</th><th></th></tr>${ccRows || '<tr><td colspan="6">还没有冷链记录</td></tr>'}</table></div>
  </div>

  <h2 class="sec">狂犬免疫台账（防疫法第 30 条：免疫证明=养犬登记凭证）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="rb-date" type="date" value="${e(today)}" /></label>
      <label>宠物名/编号 *<input id="rb-pet" placeholder="如：豆豆" /></label>
      <label>种类<select id="rb-species"><option value="犬">犬</option><option value="猫">猫</option><option value="其他">其他</option></select></label>
      <label>宠主（建议姓氏/尾号）<input id="rb-owner" placeholder="如：尾号8823" /></label>
      <label>疫苗批次（从台账选）<select id="rb-batch">${vaccineOptions || '<option value="">先在上方登记疫苗批</option>'}</select></label>
      <label>签发人（执业兽医师）<select id="rb-doctor">${vetOptions || '<option value="">名册中无执业兽医师</option>'}</select></label>
      <label class="span2">免疫证明编号 *<input id="rb-certno" placeholder="主人凭此办理养犬登记" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-rabies">登记并出证</button><span class="basis">犬只定期免疫狂犬疫苗、凭动物诊疗机构出具的免疫证明申请养犬登记（防疫法第 30 条）；证明文件须由执业兽医师出具（办法 2022-6 号第 19 条）</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>宠物</th><th>宠主</th><th>疫苗/批号</th><th>证明编号</th><th>签发人</th></tr>${rbRows || '<tr><td colspan="6">还没有免疫登记</td></tr>'}</table></div>
  </div>

  <h2 class="sec">诊疗废弃物与病死动物台账（办法 2022-5 号第 26 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="ws-date" type="date" value="${e(today)}" /></label>
      <label>类别<select id="ws-kind"><option value="clinic">诊疗废弃物</option><option value="pathology">病理组织/样品</option><option value="dead-animal">病死动物</option></select></label>
      <label>数量<input id="ws-qty" type="number" min="0" value="1" /></label>
      <label>处置<select id="ws-way"><option value="stored">暂存待移交</option><option value="transferred">已移交专业机构</option></select></label>
      <label>接收单位<input id="ws-receiver" placeholder="移交时必填（有资质机构）" /></label>
      <label>交接单号<input id="ws-ticket" placeholder="可空" /></label>
      <label class="span2">备注<input id="ws-note" placeholder="暂存位置/包装（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-waste">登记</button><span class="basis">参照《医疗废物管理条例》处理，不得随意丢弃；暂存超 ${settings.wasteMoveDays ?? DEFAULT_WASTE_MOVE_DAYS} 天未移交红灯点名（参数化，属地要求永远赢）</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>类别</th><th>数量</th><th>移交</th><th></th></tr>${wsRows || '<tr><td colspan="5">还没有医废登记</td></tr>'}</table></div>
  </div>

  <h2 class="sec">事件台账（不良反应 / 染疫报告：立即报告的时钟）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日<input id="ev-date" type="date" value="${e(today)}" /></label>
      <label>类型<select id="ev-kind"><option value="adverse">兽药不良反应</option><option value="epidemic">动物染疫/疑似染疫</option></select></label>
      <label>严重程度<select id="ev-severity"><option value="general">一般</option><option value="serious">严重</option></select></label>
      <label class="span2">对象与情形<input id="ev-subject" placeholder="如：豆豆·犬瘟热疑似 / 某批药物过敏" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-event">登记事件</button><span class="basis">发现可能与兽药有关的严重不良反应立即报告（兽药管理条例第 50 条）；发现染疫或疑似染疫立即向农业农村部门或疫控机构报告（防疫法第 31 条）——登记后当天闭环才算按时</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>类型</th><th>对象</th><th>程度</th><th>报告</th><th></th></tr>${evRows || '<tr><td colspan="6">还没有事件登记（无事即最好的事）</td></tr>'}</table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 体检 / 出证三通道）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const e = esc;
  const visitOptions = [...(state.visits ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((v) => `<option value="${e(v.id)}">${e(v.dateISO)} ${e(v.animal || v.owner || '诊疗')}</option>`).join('');

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到机构群存档或发合伙人——含诊疗/免疫/冷链/医废/事件/效期/义务七段与法条口径尾注。</p>'}
  </div>

  <h2 class="sec">账本体检（${Object.keys(healthCheck(state, today, state.settings ?? {}).items).length} 项）</h2>
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
    <p class="fine">单文件含：证照公示、人员备案名册、近 30 天诊疗台账、狂犬免疫、兽药效期、冷链双录、医废移交、事件报告、周期义务与年度报告——对口办法 2022-5 号第 17/22/23/26/30 条制度要求，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>诊疗笔<select id="case-visit">${visitOptions || '<option value="">先在台账落诊疗</option>'}</select></label>
      <button class="btn" data-action="case-print" ${visitOptions ? '' : 'disabled'}>${icon('dl')} 患宠材料单</button>
    </div>
    <p class="fine">按诊生成：病历要素 + 同期免疫记录 + 同期冷链证据链 + 签字栏——向宠主解释、应对诊疗纠纷时的底稿。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  return `
  <h2 class="sec">参数（属地规则与主管部门要求永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>冷链下限（℃）<input id="set-coldmin" type="number" step="0.5" value="${s.coldMinC ?? DEFAULT_COLD_MIN_C}" /></label>
      <label>冷链上限（℃）<input id="set-coldmax" type="number" step="0.5" value="${s.coldMaxC ?? DEFAULT_COLD_MAX_C}" /></label>
      <label>医废移交红线（天）<input id="set-waste" type="number" min="1" max="30" value="${s.wasteMoveDays ?? DEFAULT_WASTE_MOVE_DAYS}" /></label>
      <label>诊疗断更红线（天）<input id="set-gap" type="number" min="2" max="30" value="${s.gapDays ?? DEFAULT_GAP_DAYS}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">冷链区间默认 [2, 8]℃ 为按标签贮存条件的通识默认——每支疫苗以**标签标注的运输贮存保管条件**为准（兽药管理条例第 20 条）；医废移交红线参照《医疗废物管理条例》口径参数化。属地与最新要求更严时请下调。</p>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与事件流；宠主信息（姓氏/尾号）也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例机构（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 处方闸拦截 → 诊疗落账 → 冷链超温冻结 → 狂犬免疫出证 → 三通道出证。</p>
  </div>`;
}
