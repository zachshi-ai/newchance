/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  ORG_KINDS, PATIENT_TYPES, DUTY_KINDS, CHANGE_KINDS,
  DEFAULT_RENEW_WARN_DAYS, DEFAULT_DOSE_WARN_DAYS, DEFAULT_CHECK_WARN_DAYS,
  orgLicenseState, activeDevices, deviceClockState, activeWorkers,
  trainingState, doseState, openChanges, openIncidents, dutyBoard,
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
  ledger: IC('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5"/>'),
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
  xray: IC('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5"/>'),
  alert: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', due: 'warn', window: 'warn', warn: 'warn', ok: 'ok', never: 'bad', unset: 'bad', none: 'ok' };
const LEVEL_TEXT = { overdue: '逾期', due: '临期', window: '延续窗口', warn: '临期', ok: '正常', never: '从未开展', unset: '未登记', none: '不适用' };

/** 体检分计分环（hero 与报表卡通用） */
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
  <h2 class="sec">拍片这件小事，法律把它拆成了六道闸</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>口腔诊所/宠物医院装一台 X 光机，就要同时面对两条监管线：《放射性同位素与射线装置安全和防护条例》（449 号令）要求持有<strong>辐射安全许可证</strong>（5 年、届满 30 日前延续），《放射诊疗管理规定》（46 号令）要求医疗机构另持<strong>放射诊疗许可证</strong>并与执业许可同时校验；设备要<strong>每年至少一次状态检测</strong>，操作人员要<strong>培训考核合格</strong>、<strong>个人剂量监测最长不超过 90 天</strong>，育龄妇女拍片前<strong>应问明是否怀孕</strong>（46 号令第 26 条(三)）。无证用机罚 1 万起（52 条低限、政府通报口径）、未按规定检测/监测再罚 1 万以下——而全国约 10 万放射工作单位里，绝大多数是只有一两台机器的小微机构，现状解法是许可证压玻璃板下、剂量计往抽屉一塞、检查前夜翻检测报告。<strong>「机在检、人在训、量在读」与「能证明」之间没有任何小微级工具。</strong></p>
    <p><strong>拍片单的做法：</strong>机构建档（判型：口腔/医疗/动物诊疗 → 证件清单自动生成，双证钟）→ 设备一机一档（状态检测+场所防护检测双钟）→ 人员名册（培训钟+剂量钟）→ <strong>拍片六道闸</strong>（双证在期 → 设备检测在期 → 培训在期 → 剂量在期 → 妊娠询问红线——当场拦截带法条理由；过闸落账即存合规快照）→ 事件隐患闭环 → 变更/重新申领台账 → 周期义务账（年度评估/演练/健康检查提醒）→ 一键出迎检自证包 / 拍片合规核对单 / 月度小结。</p>
    <div class="row">
      <a class="btn" href="#/station">${icon('station')} 先把机构建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是机构自查与应对检查的底账，不替代辐射安全许可、放射诊疗许可、校验与建设项目审查等法定程序；数据只存在你设备里。口腔院感归灭菌单、职业健康监护归岗卫账、动物诊疗主体管理归兽诊账（领域互斥）。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：双证钟 + 设备钟 + 人员钟 + 拍片台账 + 义务）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.org?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const boxes = [];

  const lic = orgLicenseState(state.org, today, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);
  if (lic.level === 'overdue' || lic.level === 'unset') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>证件红灯</strong></div><ul><li>${esc(lic.detail)}</li></ul></div>`);
  } else if (lic.level === 'window' || lic.level === 'warn') {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>延续/校验窗口</strong></div><ul><li>${esc(lic.detail)}</li></ul></div>`);
  }

  const dvs = activeDevices(state);
  const badDev = dvs.filter((d) => ['overdue', 'unset'].includes(deviceClockState(d, 'status', today, settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS).level));
  const dueDev = dvs.filter((d) => deviceClockState(d, 'status', today, settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS).level === 'due');
  if (badDev.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('xray')}</span><strong>状态检测红灯（${badDev.length}）</strong></div>
      <ul>${badDev.slice(0, 4).map((d) => `<li>${esc(d.name)}（${esc(d.code)}）——${esc(deviceClockState(d, 'status', today, settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS).detail)}</li>`).join('')}</ul></div>`);
  } else if (dueDev.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>状态检测临期（${dueDev.length}）</strong></div>
      <ul>${dueDev.slice(0, 4).map((d) => `<li>${esc(d.name)}（${esc(d.code)}）——${esc(deviceClockState(d, 'status', today, settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS).detail)}</li>`).join('')}</ul></div>`);
  }

  const workers = activeWorkers(state);
  const badDose = workers.filter((w) => ['overdue', 'unset'].includes(doseState(w, today, 90, settings.doseWarnDays ?? DEFAULT_DOSE_WARN_DAYS).level));
  const badTr = workers.filter((w) => ['overdue', 'unset'].includes(trainingState(w, today).level));
  if (badDose.length || badTr.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('person')}</span><strong>人员红灯（剂量 ${badDose.length} · 培训 ${badTr.length}）</strong></div>
      <ul>${[...badDose, ...badTr].slice(0, 4).map((w) => `<li>${esc(doseState(w, today, 90, settings.doseWarnDays ?? DEFAULT_DOSE_WARN_DAYS).level !== 'ok' && ['overdue', 'unset'].includes(doseState(w, today, 90, settings.doseWarnDays ?? DEFAULT_DOSE_WARN_DAYS).level) ? doseState(w, today, 90, settings.doseWarnDays ?? DEFAULT_DOSE_WARN_DAYS).detail : trainingState(w, today).detail)}</li>`).join('')}</ul></div>`);
  }

  const inc = openIncidents(state);
  if (inc.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('bell')}</span><strong>事件/隐患未闭环（${inc.length}）</strong></div>
      <ul>${inc.slice(0, 4).map((n) => `<li>${esc(n.desc)}</li>`).join('')}</ul></div>`);
  }

  const dutiesLate = dutyBoard(state, today).filter((d) => d.level === 'never' || d.level === 'overdue');
  if (dutiesLate.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>周期义务欠账（${dutiesLate.length}）</strong></div>
      <ul>${dutiesLate.slice(0, 3).map((d) => `<li>${esc(d.label)}——${esc(d.basis)}</li>`).join('')}</ul></div>`);
  }

  const openCh = openChanges(state);
  if (openCh.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>变更/重新申领未办结（${openCh.length}）</strong></div>
      <ul>${openCh.slice(0, 3).map((c) => `<li>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}（${esc(c.dateISO)}）——${esc(c.detail)}；办理后点「办结」</li>`).join('')}</ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>双证在期、设备在检、人员培训剂量在期、事件全闭环——保持，拍片落账别断。</li></ul></div>`);
  }

  // hero
  const hc = healthCheck(state, today, settings);
  const sum = monthlySummary(state, today.slice(0, 7), today);
  const licChip = lic.level === 'overdue'
    ? { cls: 'bad', big: '已过期', sub: '停用+办证（52 条）' }
    : lic.level === 'window'
      ? { cls: 'warn', big: `剩${lic.daysLeft}天`, sub: '届满 30 日前办' }
      : { cls: 'ok', big: lic.level === 'unset' ? '未登记' : '在期', sub: lic.level === 'unset' ? '先录证件有效期' : '双证在管' };
  const doseChip = badDose.length
    ? { cls: 'bad', big: `异常${badDose.length}`, sub: '剂量超期·禁拍片' }
    : badTr.length
      ? { cls: 'bad', big: `培训${badTr.length}`, sub: '考核过期·禁上岗' }
      : { cls: 'ok', big: workers.length ? `${workers.length}人在册` : '无人员', sub: workers.length ? '培训剂量在期' : '先建人员名册' };
  const devChip = badDev.length
    ? { cls: 'bad', big: `异常${badDev.length}`, sub: '检测超期·停用' }
    : dueDev.length
      ? { cls: 'warn', big: `临期${dueDev.length}`, sub: '安排约检' }
      : { cls: 'ok', big: dvs.length ? `${dvs.length}台在用` : '无设备', sub: dvs.length ? '状态检测在期' : '先建设备台账' };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · 在用设备 ${dvs.length} 台 · 在册人员 ${workers.length} 名 · 本月拍片 ${sum.shots} 笔</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${licChip.cls}"><span class="chip-label">双证钟</span><span class="chip-big">${esc(licChip.big)}</span><span class="chip-sub">${esc(licChip.sub)}</span></div>
        <div class="chip ${devChip.cls}"><span class="chip-label">状态检测钟</span><span class="chip-big">${esc(devChip.big)}</span><span class="chip-sub">${esc(devChip.sub)}</span></div>
        <div class="chip ${doseChip.cls}"><span class="chip-label">剂量/培训钟</span><span class="chip-big">${esc(doseChip.big)}</span><span class="chip-sub">${esc(doseChip.sub)}</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${sum.shots}</b><span>本月拍片落账</span></div>
      <div class="stat"><b>${sum.blocked}</b><span>闸机拦截（都算没被罚）</span></div>
      <div class="stat"><b>${sum.score}</b><span>体检得分</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/ledger">去拍片落账</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 建档（机构 + 设备 + 人员 + 变更 + 义务）
// ---------------------------------------------------------------------------

export function viewStation(state) {
  const o = state.org ?? {};
  const today = todayISO();
  const settings = state.settings ?? {};
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;

  const lic = orgLicenseState(o, today, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);
  const isVet = o.kind === 'vet';

  const devRows = (state.devices ?? []).map((d) => {
    const st = deviceClockState(d, 'status', today, settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS);
    const si = deviceClockState(d, 'site', today, settings.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS);
    return `<tr class="${d.outISO ? 'muted' : ''}">
    <td>${esc(d.name)}<br><span class="basis">${esc(d.code)} · ${esc(d.deviceClass)}${d.roomNo ? ` · ${esc(d.roomNo)}` : ''}</span></td>
    <td>${esc(d.statusDueISO || '—')}<br><span class="basis">${esc(st.detail).slice(0, 34)}</span></td>
    <td>${esc(d.siteDueISO || '—')}<br><span class="basis">${esc(si.detail).slice(0, 34)}</span></td>
    <td>${d.outISO ? '<span class="pill bad">停用</span>' : '<span class="pill ok">在用</span>'}</td>
    <td class="ops">
      <button class="btn small ghost" data-action="show-dev-check" data-idx="${d.id}">检测完成</button>
      <button class="btn small ghost" data-action="toggle-dev" data-idx="${d.id}">${d.outISO ? '复用' : '停用'}</button>
      <button class="btn small ghost" data-action="del-dev" data-idx="${d.id}">删</button>
    </td>
  </tr>`;
  }).join('');

  const wkRows = (state.workers ?? []).map((w) => {
    const tr = trainingState(w, today);
    const do_ = doseState(w, today, 90, settings.doseWarnDays ?? DEFAULT_DOSE_WARN_DAYS);
    return `<tr class="${w.active ? '' : 'muted'}">
    <td>${esc(w.name)}${w.certNo ? `<br><span class="basis">${esc(w.certNo)}</span>` : ''}</td>
    <td>${esc(w.trainingDueISO || '—')}<br><span class="basis">${esc(tr.detail).slice(0, 34)}</span></td>
    <td>${esc(w.doseDueISO || '—')}<br><span class="basis">${esc(do_.detail).slice(0, 34)}</span></td>
    <td><button class="btn small ghost" data-action="toggle-worker" data-idx="${w.id}">${w.active ? '停用' : '恢复'}</button></td>
  </tr>`;
  }).join('');

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr class="${c.status === 'open' ? '' : 'muted'}">
    <td>${esc(c.dateISO)}</td><td>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}</td><td class="w"><span>${esc(c.detail)}</span></td>
    <td>${c.status === 'filed' ? `<span class="pill ok">已办结 ${esc(c.filedISO)}</span>` : `<span class="pill warn">未办结</span><button class="btn small" data-action="show-file-change" data-idx="${c.id}">办结</button>`}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">机构建档与双证钟（449 号令第 5/8/13 条 · 46 号令第 17 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>机构名称 *<input id="og-name" value="${esc(o.name ?? '')}" placeholder="如：明澈口腔门诊部" /></label>
      <label>机构类型 *
        <select id="og-kind">${Object.entries(ORG_KINDS).map(([k, v]) => `<option value="${k}" ${o.kind === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      </label>
      <label>辐射安全许可证编号 *<input id="og-radsafeno" value="${esc(o.radSafeNo ?? '')}" placeholder="如：川环辐证〔2024〕0123 号" /></label>
      <label>辐射安全许可证有效期至 *<input id="og-radsafeexpiry" type="date" value="${esc(o.radSafeExpiryISO ?? '')}" placeholder="5 年一续、届满 30 日前延续（第 13 条）" /></label>
      <label>放射诊疗许可证编号${isVet ? '（动物诊疗类不适用）' : ''}<input id="og-radlicno" value="${esc(o.radLicenseNo ?? '')}" placeholder="如：辐诊证〔2024〕第 0456 号" ${isVet ? 'disabled' : ''} /></label>
      <label>放射诊疗许可证校验期至${isVet ? '（不适用）' : ''}<input id="og-radlicexpiry" type="date" value="${esc(o.radLicenseExpiryISO ?? '')}" placeholder="与执业许可证同时校验（46 号令第 17 条）" ${isVet ? 'disabled' : ''} /></label>
      <label>发证机关<input id="og-issuer" value="${esc(o.issuer ?? '')}" placeholder="生态环境局 / 卫生健康委" /></label>
      <label>机构负责人<input id="og-manager" value="${esc(o.manager ?? '')}" /></label>
      <label class="span2">地址<input id="og-address" value="${esc(o.address ?? '')}" placeholder="变更应 20 日内办手续（449 号令第 11 条）" /></label>
      <label class="span2">联系电话<input id="og-phone" value="${esc(o.phone ?? '')}" placeholder="可空" /></label>
      <label class="span2">备注<input id="og-note" value="${esc(o.note ?? '')}" placeholder="可空" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-org">保存机构信息</button>
      <button class="btn ghost" data-action="show-renew-radsafe" ${o.radSafeExpiryISO ? '' : 'disabled'}>辐射安全证延续办结</button>
      <button class="btn ghost" data-action="show-renew-radlicense" ${o.radLicenseExpiryISO && !isVet ? '' : 'disabled'}>放射诊疗证校验办结</button>
      <span>${pill(lic.level)}&nbsp;<span class="basis">${esc(lic.detail)}</span></span>
    </div>
    <p class="fine">辐射安全许可证 5 年、届满 30 日前申请延续（449 号令第 13 条）；无证/过期使用射线装置：责令停止违法行为限期改正，逾期不改正责令停产停业或吊销许可证并处 1 万~10 万元罚款（第 52 条）——政府通报的口腔诊所无证用机案例多按低限 1 万元罚。《放射诊疗许可证》与《医疗机构执业许可证》同时校验（46 号令第 17 条），未按规定校验可处 3000 元以下罚款（第 38 条）。类型切换后证件清单联动（动物诊疗类只需辐射安全许可证）。</p>
  </div>

  <h2 class="sec">射线装置一机一档（46 号令第 20/21 条：验收+每年状态检测+场所防护检测）</h2>
  <div class="card">
    <div class="form-grid">
      <label>装置名称 *<input id="dv-name" placeholder="如：牙科 X 射线机 / 口腔 CT" /></label>
      <label>编号 *<input id="dv-code" placeholder="如：DX-01" /></label>
      <label>装置类别
        <select id="dv-class"><option value="Ⅲ类">Ⅲ类（牙科/诊断 X 射线装置 · 2017 年第 66 号公告）</option><option value="Ⅱ类">Ⅱ类（如 DSA）</option></select>
      </label>
      <label>机房/位置<input id="dv-room" placeholder="如：1 号机房" /></label>
      <label>最近状态检测日<input id="dv-status" type="date" placeholder="每年至少一次（第 20 条），自动推导下次" /></label>
      <label>最近场所防护检测日<input id="dv-site" type="date" placeholder="定期防护检测（第 21 条，惯例一年）" /></label>
      <label class="span2">备注<input id="dv-note" placeholder="品牌/出厂号/检测机构（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-device">建档</button><span class="basis">新安装、维修或更换重要部件后应经检测合格方可启用（验收检测，第 20 条(一)，可在备注登记）；校验放射诊疗许可证时要提交设备性能与场所检测报告（第 17 条）</span></div>
    <div class="tbl"><table class="plain"><tr><th>装置</th><th>状态检测至</th><th>场所防护至</th><th>状态</th><th></th></tr>${devRows || '<tr><td colspan="5">还没有设备建档——从第一台 X 射线机开始</td></tr>'}</table></div>
    <p class="fine">停用设备（待检/维修）不可被拍片闸选中；检测完成后点「检测完成」，双钟按周期自动滚动。</p>
  </div>

  <h2 class="sec">放射工作人员名册（449 号令第 28/29 条 · 55 号令第十一条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名 *<input id="wk-name" placeholder="如：王明澈" /></label>
      <label>资质/考核编号<input id="wk-certno" placeholder="培训考核证明编号（可空，只存本机）" /></label>
      <label>最近培训考核日<input id="wk-training" type="date" placeholder="惯例两年复训，自动推导下次" /></label>
      <label>最近剂量报告日<input id="wk-dose" type="date" placeholder="一般 30 天一读、最长不超过 90 天（第十一条）" /></label>
      <label class="span2">备注<input id="wk-note" placeholder="岗位/剂量计编号（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-worker">入册</button><span class="basis">培训考核不合格不得上岗（449 号令第 28 条）；个人剂量监测超 90 天上限未读取前拍片会被闸机拦截（55 号令第十一条）；未按规定监测/建档属 1 万元以下罚款情形（46 号令第 41 条(四)）</span></div>
    <div class="tbl"><table class="plain"><tr><th>姓名</th><th>培训考核至</th><th>剂量监测至</th><th></th></tr>${wkRows || '<tr><td colspan="4">名册为空——把操作拍片的人登记进来</td></tr>'}</table></div>
    <p class="fine">「培训完成」「剂量读取」在拍片页快捷登记；职业健康检查（间隔≤2 年）在周期义务账挂提醒，监护档案归岗卫账管理（领域互斥）。</p>
  </div>

  <h2 class="sec">变更/重新申领台账（449 号令第 11/12 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发生日<input id="cg-date" type="date" value="${esc(today)}" /></label>
      <label>情形
        <select id="cg-kind">${Object.entries(CHANGE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label class="span2">说明 *<input id="cg-detail" placeholder="变更前后内容，如：新增口腔 CT 一台（已按程序重新申领）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-change">登记</button><span class="basis">名称/地址/法定代表人变更 20 日内办变更手续（第 11 条，未办：警告+责令改正，逾期暂扣/吊销第 53 条）；改变种类范围、新改扩建场所按原程序重新申领（第 12 条，未办入第 52 条罚则）</span></div>
    <div class="tbl"><table class="plain"><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows || '<tr><td colspan="4">暂无变更事项（有变化先登记再办手续）</td></tr>'}</table></div>
  </div>

  <h2 class="sec">周期义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)} · ${v.cycleDays}天</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="评估报告年份/演练科目（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="set-duty">登记完成</button></div>
    ${(() => {
    const rows = dutyBoard(state, today).map((d) => {
      const lv = d.level === 'never' ? 'never' : d.level;
      const next = d.level === 'never' ? '从未执行' : `${esc(d.nextDue)}（${d.daysLeft < 0 ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}）`;
      return `<tr class="${lv === 'never' || lv === 'overdue' ? 'muted' : ''}"><td>${esc(d.label)}</td><td>${d.lastDoneISO ? esc(d.lastDoneISO) : '—'}</td><td>${next}</td><td><span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span></td><td class="basis w"><span>${esc(d.basis)}</span></td></tr>`;
    }).join('');
    return `<div class="tbl"><table class="plain"><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${rows || '<tr><td colspan="5">尚未登记</td></tr>'}</table></div>`;
  })()}
    <p class="fine">年度评估为 449 号令第 30 条义务（每年对本单位安全和防护状况评估、发现隐患立即整改）；演练为 46 号令第 19 条(四)；健康检查提醒仅是提醒——监护档案与体检组织属职业卫生线（岗卫账）领域。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 拍片（六道闸 / 培训剂量快捷登记 / 事件闭环）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;
  const settings = state.settings ?? {};
  const isVet = state.org?.kind === 'vet';

  const devOptions = activeDevices(state).map((d) => `<option value="${e(d.id)}">${e(d.name)}（${e(d.code)}）${d.statusDueISO ? ` · 检测至 ${e(d.statusDueISO)}` : ' · 未录检测'}</option>`).join('');
  const wkOptions = activeWorkers(state).map((w) => `<option value="${e(w.id)}">${e(w.name)}${w.doseDueISO ? ` · 剂量至 ${e(w.doseDueISO)}` : ' · 未录剂量'}</option>`).join('');

  const shots = [...(state.shots ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 15);
  const shRows = shots.map((s) => `<tr>
    <td>${e(s.dateISO)}<br><span class="basis">${e(s.bodyPart || '—')}${s.special ? ' · <strong>特殊需要</strong>' : ''}</span></td>
    <td>${e(s.deviceName)}<br><span class="basis">${e(s.workerName)}</span></td>
    <td class="ops">
      <button class="btn small ghost" data-action="shot-print" data-idx="${s.id}">核对单</button>
      <button class="btn small ghost" data-action="del-shot" data-idx="${s.id}">删</button>
    </td>
  </tr>`).join('');

  const incs = [...(state.incidents ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const INST = { open: ['未整改', 'bad'], fixed: ['待验证', 'warn'], closed: ['已闭环', 'ok'] };
  const incRows = incs.map((n) => `<tr class="${n.status !== 'closed' ? 'muted' : ''}">
    <td>${e(n.dateISO)}</td><td>${e(n.sourceLabel ?? n.source)}</td>
    <td class="w"><span>${e(n.desc)}</span></td>
    <td>${n.status === 'open' ? '<strong>未整改</strong>' : `${e(n.actionISO || '—')}<br><span class="basis">${e(n.action || '')}</span>`}</td>
    <td><span class="pill ${INST[n.status]?.[1] ?? ''}">${INST[n.status]?.[0] ?? n.status}</span></td>
    <td class="ops">${n.status === 'open' ? `<button class="btn small" data-action="show-fix-incident" data-idx="${n.id}">整改</button>` : n.status === 'fixed' ? `<button class="btn small" data-action="show-close-incident" data-idx="${n.id}">验证关闭</button>` : ''}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">拍片六道闸（按下快门前的门禁：全过才落账）</h2>
  <div class="card">
    <div class="form-grid">
      <label>拍片日期<input id="sh-date" type="date" value="${e(today)}" /></label>
      <label>射线装置 *
        <select id="sh-device">${devOptions || '<option value="">先去「建档」建设备台账</option>'}</select>
      </label>
      <label>操作人员 *
        <select id="sh-worker">${wkOptions || '<option value="">先去「建档」登记放射工作人员</option>'}</select>
      </label>
      <label>受检者类型 *
        <select id="sh-ptype">
          <option value="adult">成人</option>
          <option value="child">儿童/青少年（体检红线提示）</option>
          <option value="woman">育龄妇女（妊娠询问红线）</option>
        </select>
      </label>
      <label>妊娠询问（育龄妇女时必答）
        <select id="sh-preg"><option value="">— 未问 —</option><option value="not-pregnant">已问明：未怀孕</option><option value="pregnant">已怀孕</option></select>
      </label>
      <label>临床特殊需要
        <select id="sh-special"><option value="no">否</option><option value="yes">是（须填理由，如实落账打标）</option></select>
      </label>
      <label class="span2">部位/牙位<input id="sh-bodypart" placeholder="如：14/24 根尖片（可空）" /></label>
      <label class="span2">备注/特殊需要理由<input id="sh-note" placeholder="特殊需要时必填，如：急症明确诊断需要，病历已记录正当性判断" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-shot">过闸拍片</button><span class="basis">闸机核对：${isVet ? '辐射安全许可证在期（449 号令第 5/52 条）' : '双证在期（449 号令第 5/52 条 · 46 号令第 38 条）'}→ 设备状态检测在期（46 号令第 20 条）→ 培训考核在期（449 号令第 28 条）→ 个人剂量在期（55 号令第十一条 ≤90 天）→ 妊娠询问红线（46 号令第 26 条(三)）——任一不过，当场拦截</span></div>
    ${(() => {
    const workers2 = activeWorkers(state);
    const needFix = [...new Map(
      [...workers2.filter((w) => ['overdue', 'unset'].includes(doseState(w, today, 90, settings.doseWarnDays ?? DEFAULT_DOSE_WARN_DAYS).level)),
       ...workers2.filter((w) => ['overdue', 'unset'].includes(trainingState(w, today).level))]
        .map((w) => [w.id, w]),
    ).values()];
    if (!needFix.length) return '';
    return `<div class="row" style="margin-top:6px">${needFix.map((w) => `<button class="btn small ghost" data-action="quick-fix" data-idx="${w.id}">登记 ${e(w.name)} 的培训/剂量</button>`).join('')}</div>`;
  })()}
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>装置/操作者</th><th></th></tr>${shRows || '<tr><td colspan="3">还没有拍片落账——按下快门后 10 秒落账</td></tr>'}</table></div>
    <p class="fine">落账即存合规快照（双证期、设备检测期、人员培训/剂量期），46 号令第 26 条(一)检查资料登记保存；受检者身份不登记（最小披露），诊断影像按病历系统管理。</p>
  </div>

  <h2 class="sec">放射事件与隐患闭环（46 号令第 19 条(五)：记录并及时报告）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日<input id="in-date" type="date" value="${e(today)}" /></label>
      <label>来源
        <select id="in-source"><option value="selfcheck">自查上报</option><option value="inspection">监督检查</option><option value="event">放射事件</option></select>
      </label>
      <label class="span2">描述 *<input id="in-desc" placeholder="如：机房防护门联锁失灵 / 剂量读数异常需调查" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-incident">登记</button><span class="basis">闭环状态机：登记 → 整改（措施+完成日）→ 验证关闭（验证人+验证日）；跳级拒绝。发生放射事件应立即报告生态环境、公安、卫生部门（449 号令第 42 条，禁止缓报瞒报）</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>来源</th><th>描述</th><th>整改</th><th>状态</th><th></th></tr>${incRows || '<tr><td colspan="6">还没有事件登记（无事即最好的事）</td></tr>'}</table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 体检 / 出证三通道）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const e = esc;
  const shotOptions = [...(state.shots ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((s) => `<option value="${e(s.id)}">${e(s.dateISO)} · ${e(s.deviceName.split('（')[0])}</option>`).join('');

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到机构群存档——含拍片落账/闸机拦截/特殊需要放行/剂量与设备点名/义务欠账/体检与法条口径尾注。</p>'}
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
    <p class="fine">单文件含：机构与双证、体检明细、设备一机一档双钟、人员名册（培训/剂量）、拍片台账、事件闭环、变更手续、周期义务——对口生态环境+卫生双线检查，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>拍片合规核对单<select id="case-shot">${shotOptions || '<option value="">先过闸落账拍片</option>'}</select></label>
      <button class="btn" data-action="shot-download" ${shotOptions ? '' : 'disabled'}>${icon('dl')} 拍片核对单</button>
    </div>
    <p class="fine">按单打印：拍片要素 + 妊娠询问 + 落账快照（双证/检测/培训/剂量四期）——纠纷或抽档时 10 秒自证单次拍片的合规证据链。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  return `
  <h2 class="sec">参数（属地生态环境与卫生部门要求永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>证件临期提醒（天）<input id="set-renew" type="number" min="15" max="365" value="${s.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS}" /></label>
      <label>剂量临期提醒（天）<input id="set-dose" type="number" min="7" max="60" value="${s.doseWarnDays ?? DEFAULT_DOSE_WARN_DAYS}" /></label>
      <label>检测临期提醒（天）<input id="set-check" type="number" min="7" max="120" value="${s.checkWarnDays ?? DEFAULT_CHECK_WARN_DAYS}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">届满 30 日前延续（449 号令第 13 条）、状态检测每年至少一次（46 号令第 20 条）、剂量监测最长 90 天（55 号令第十一条）为法定口径不可调，这里只调提醒提前量；培训复训（惯例两年）与健康检查（间隔≤2 年）周期随台账逐条登记滚动。</p>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与使用记录；人员资质编号等信息也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例机构（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 拍片闸三连拦截（剂量超期/检测超期/妊娠未问）→ 合规落账 → 出证三通道。</p>
  </div>`;
}
