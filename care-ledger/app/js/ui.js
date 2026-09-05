/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  RISK_FIELDS, RISK_LEVELS, CARE_LEVELS, SHIFTS, INCIDENT_TYPES, CYCLE_KINDS,
  riskSummary, unsetRiskResidents, watchList, coverageFor, recentGaps, shortNightRounds,
  openIncidents, dueCycles, monthlyReport, certText, cycleStatus,
  escapeHtml, todayISO, addDays, monthKey,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const PILL = { ok: 'ok', warn: 'warn', issue: 'issue' };

export function viewOnboarding() {
  return `
  <h2 class="sec">照护落在纸上，安全才站得住</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>GB 38600-2019 是养老服务业第一个强制性国标，要求对老人做服务安全风险评估、落实「九防」；《养老机构管理办法》要求 24 小时值班、建立档案、突发事件应急预案与演练，民政部门每年至少一次现场检查，未按强标提供服务可被处罚——而纠纷现场（跌倒、噎食、走失、压疮），机构方必须用记录证明「照护到位、发现及时、告知过家属」，拿不出记录就要吃下更大的责任比例。</p>
    <p><strong>护安单的做法：</strong>老人建档（九防登记，建档即全「未评估」，把「没评过」变成必须消灭的待办）→ 每班 30 秒打卡（缺班自动点名，夜巡次数有人盯）→ 事件闭环（处置 → 家属告知 → 复盘整改，未闭环一直亮灯）→ 周期义务账（评估复评/应急演练/员工体检到期点名）→ 30 秒生成照护安全自证包（微信文本 / 打印版，缺口如实列出）。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏥 先建机构档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不做呼叫系统、不做 IoT 硬件、不做民政报送、不做排班工资——数据只存在你设备里，自证包走微信与打印，家属和检查人员不用装任何东西。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：班次覆盖 + 五类点名 + 本月速览）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.residents?.length) return viewOnboarding();
  const today = todayISO();
  const month = monthKey(today);
  const residents = state.residents.filter((r) => r.status === 'in');
  const cov = coverageFor(state, today);
  const gaps = recentGaps(state, 7, today).slice(0, 6);
  const unset = unsetRiskResidents(state.residents);
  const watch = watchList(state.residents);
  const opens = openIncidents(state);
  const cycles = dueCycles(state, today);
  const shorts = shortNightRounds(state).filter((e) => e.dateISO > addDays(today, -7));
  const report = monthlyReport(state.rounds, state.incidents, month);

  const alerts = [];
  if (opens.length) {
    alerts.push(`<div class="card alert issue"><strong>🔴 未闭环照护事件（家属告知/复盘没走完，就一直亮灯）</strong>
      <ul>${opens.slice(0, 5).map((e) => `<li>${esc(e.dateISO)} ${esc(e.residentName)}【${esc(INCIDENT_TYPES[e.type]?.label ?? e.type)}】——去「事件」补告知与复盘</li>`).join('')}</ul></div>`);
  }
  if (unset.length) {
    alerts.push(`<div class="card alert issue"><strong>❓ 九防未评估（第十五条评估义务的缺口）</strong>
      <ul>${unset.slice(0, 5).map((r) => `<li>${esc(r.name)}：还有 ${riskSummary(r).unset} 项没评——评估是建档后的第一个动作，不是出了事才补的</li>`).join('')}${unset.length > 5 ? `<li>……另有 ${unset.length - 5} 人未评完</li>` : ''}</ul></div>`);
  }
  if (gaps.length) {
    alerts.push(`<div class="card alert issue"><strong>📵 近 7 天缺班 ${recentGaps(state, 7, today).length} 班（记录连续性是台账的生命线）</strong>
      <ul>${gaps.map((g) => `<li>${esc(g.dateISO)} 缺：${g.missing.map((k) => SHIFTS[k].label).join('、')}</li>`).join('')}</ul></div>`);
  }
  if (shorts.length) {
    alerts.push(`<div class="card alert"><strong>🌙 近 7 天夜巡不足 ${shorts.length} 班</strong>
      <ul>${shorts.slice(0, 4).map((e) => `<li>${esc(e.dateISO)} 夜班：${esc(e.shortNote ?? '')}——24 小时值班不是一句话，是次数</li>`).join('')}</ul></div>`);
  }
  if (watch.length) {
    alerts.push(`<div class="card alert"><strong>🔴 高风险老人 ${watch.length} 人（重点看护名册）</strong>
      <ul>${watch.slice(0, 5).map((r) => {
        const highKeys = Object.keys(RISK_FIELDS).filter((k) => r.riskBook[k].level === 'high');
        return `<li>${esc(r.name)}：${highKeys.map((k) => esc(RISK_FIELDS[k].label)).join('、')}</li>`;
      }).join('')}</ul></div>`);
  }
  if (cycles.length) {
    alerts.push(`<div class="card alert"><strong>⏰ 周期义务到期点名（${cycles.length} 项）</strong>
      <ul>${cycles.slice(0, 5).map((x) => `<li>${x.status === 'due' ? '🔴 已到期' : '🟡 临期'}：${esc(CYCLE_KINDS[x.cycle.kind]?.label ?? x.cycle.kind)} · ${esc(x.cycle.owner)} · ${esc(x.cycle.dueISO)}</li>`).join('')}</ul></div>`);
  }

  const quickForms = cov.missing.length
    ? `<div class="card">
        <strong>本班待打卡</strong>（30 秒：署名 + 一键平安，异常才多写两行）
        ${cov.missing.map((k) => `
        <div class="form-grid" style="margin-top:10px">
          <label>${SHIFTS[k].label}（${SHIFTS[k].time}）值班人<input id="q-staff-${k}" placeholder="如：李芳" /></label>
          ${SHIFTS[k].night ? `<label>夜巡次数（下限 ${state.settings?.nightMinTimes ?? 2}）<input type="number" id="q-night-${k}" min="1" max="12" value="${state.settings?.nightMinTimes ?? 2}" /></label>` : ''}
          <label class="span2">重点老人 / 交接事项（选填）<input id="q-majors-${k}" placeholder="如：3 楼周奶奶血压偏高已告知夜班" /></label>
        </div>
        <div class="row">
          <button class="btn small" data-action="quick-round" data-idx="${k}">✅ ${SHIFTS[k].label}平安打卡</button>
          <button class="btn small warn" data-action="quick-round-abnormal" data-idx="${k}">⚠️ 本班有异常</button>
        </div>`).join('')}
      </div>`
    : `<div class="card progress-card"><div class="progress-text">✅ 今日 ${cov.done.length}/${cov.done.length} 班次已完成打卡——值班人：${[...new Set((state.rounds ?? []).filter((e) => e.dateISO === today).map((e) => esc(e.staff)))].join('、')}</div>
        <p class="done-note">每班一条，连续就是证据。交接要点写在「重点老人」栏里，夜班别忘了核夜巡次数。</p></div>`;

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">🛏️ 在住 <strong>${residents.length}</strong> 人 · 未闭环事件 <strong>${opens.length}</strong> · 高风险 <strong>${watch.length}</strong> 人</div>
    <p class="done-note">检查与纠纷只问三句：评了吗？查了吗？告诉家属了吗？——答案都在这本账里。</p>
  </div>
  ${quickForms}
  ${alerts.join('')}
  <h2 class="sec">${month} 服务安全速览</h2>
  <div class="card">
    <div class="row stats-line">
      <span>打卡 <strong>${report.rounds}</strong> 班</span>
      <span>异常班次 <strong>${report.abnormal}</strong></span>
      <span>事件 <strong>${report.incidents}</strong> 起</span>
      <span>已闭环 <strong>${report.closed}</strong></span>
      <span>未闭环 <strong>${report.openLeft}</strong></span>
    </div>
    <div class="row">
      <a class="btn" href="#/residents">🛏️ 老人档案 / 九防评估</a>
      <a class="btn ghost" href="#/cert">🧾 生成照护安全自证包</a>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 老人（建档 / 九防登记 / 离院）
// ---------------------------------------------------------------------------

function riskEditor(r) {
  return Object.keys(RISK_FIELDS).map((k) => {
    const item = r.riskBook[k];
    const opts = Object.keys(RISK_LEVELS)
      .map((lv) => `<option value="${lv}" ${lv === item.level ? 'selected' : ''}>${RISK_LEVELS[lv].label}</option>`).join('');
    return `<div class="disc-row">
      <label class="disc-label" title="${esc(RISK_FIELDS[k].ask)}">${esc(RISK_FIELDS[k].label)}</label>
      <select id="rk-${r.id}-${k}">${opts}</select>
      <input id="rm-${r.id}-${k}" value="${esc(item.measures)}" placeholder="${esc(RISK_FIELDS[k].ask)}（watch/high 必填措施）" />
    </div>`;
  }).join('');
}

function residentCard(state, r) {
  const sum = riskSummary(r);
  const levelPill = sum.unset > 0
    ? ` <span class="pill issue">❓ 未评估 ${sum.unset}</span>`
    : (sum.high > 0
      ? ` <span class="pill issue">🔴 高风险 ${sum.high}</span>`
      : (sum.watch > 0 ? ` <span class="pill warn">🛡️ 需防护 ${sum.watch}</span>` : ' <span class="pill ok">✅ 九防已评</span>'));
  const statusPill = r.status === 'out'
    ? `<span class="pill todo">已离院${r.outISO ? ` · ${esc(r.outISO)}` : ''}</span>`
    : `<span class="pill ok">在住</span>`;

  return `<details class="card car-card">
    <summary>
      <span class="car-title"><strong>${esc(r.name)}</strong>${r.bed ? ` · ${esc(r.bed)}` : ''} <span class="basis">${esc(CARE_LEVELS[r.careLevel]?.label ?? '')} · 入住 ${esc(r.admitISO)}${r.assessedISO ? ` · 九防评估 ${esc(r.assessedISO)}` : ''}</span></span>
      ${statusPill}${levelPill}
    </summary>
    ${r.familyName || r.familyPhone ? `<div class="basis">紧急联系人：${esc(r.familyName ?? '')} ${esc(r.familyPhone ?? '')}${r.note ? ` · ${esc(r.note)}` : ''}</div>` : (r.note ? `<div class="basis">${esc(r.note)}</div>` : '')}

    <h3 class="sub">九防风险评估（GB 38600-2019 · watch/high 必须写防护措施）</h3>
    <div class="disc-grid">${riskEditor(r)}</div>
    <div class="row"><button class="btn small" data-action="save-risks" data-idx="${r.id}">保存九防评估（登记日 = 今天）</button>
      <a class="btn small ghost" href="#/cert">去生成自证包 →</a></div>

    <div class="row">
      ${r.status === 'in'
        ? `<button class="btn small ghost" data-action="discharge" data-idx="${r.id}">办理离院（档案保留）</button>`
        : `<button class="btn small ghost" data-action="undo-discharge" data-idx="${r.id}">撤销离院</button>`}
      ${state.incidents.filter((e) => e.residentId === r.id).length === 0
        ? `<button class="btn small ghost" data-action="del-resident" data-idx="${r.id}">删除档案（须先无事件记录）</button>`
        : '<span class="fine">有事件记录的档案是历史账的一部分，不可删除</span>'}
    </div>
  </details>`;
}

export function viewResidents(state) {
  const today = todayISO();
  const residents = [...state.residents].sort((a, b) => (a.status === b.status ? b.admitISO.localeCompare(a.admitISO) : a.status === 'in' ? -1 : 1));
  return `
  <h2 class="sec">🛏️ 老人建档（收住一位，建一档评估一份）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名<input id="re-name" placeholder="如：周桂芳" /></label>
      <label>房号 / 床号<input id="re-bed" placeholder="如：302-1" /></label>
      <label>照料护理等级<select id="re-level">${Object.keys(CARE_LEVELS).map((k) => `<option value="${k}">${CARE_LEVELS[k].label}</option>`).join('')}</select></label>
      <label>入住日期<input type="date" id="re-admit" value="${today}" /></label>
      <label>紧急联系人<input id="re-family" placeholder="如：周建国（儿子）" /></label>
      <label>联系电话<input id="re-phone" placeholder="如：13800001234" /></label>
      <label class="span2">备注（选填）<input id="re-note" placeholder="如：慢病用药清单见床头卡" /></label>
    </div>
    <button class="btn" data-action="add-resident">建档（九防自动置为「未评估」，评估是建档后的第一个动作）</button>
    <p class="fine">《养老机构管理办法》第十五条：建立入院评估制度、确定照料护理等级，身心状况变化要重新评估——评估不是纸面动作，是九防措施的前提。</p>
  </div>

  <h2 class="sec">老人档案（${state.residents.length}）</h2>
  ${residents.length ? residents.map((r) => residentCard(state, r)).join('') : '<div class="card"><p class="fine">还没有老人档案。收住第一位，从上面建档开始。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 值班（巡查台账：每班一条，打卡即交接）
// ---------------------------------------------------------------------------

export function viewRounds(state) {
  const today = todayISO();
  const rounds = [...(state.rounds ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.shift.localeCompare(a.shift)).slice(0, 60);
  return `
  <h2 class="sec">🌙 值班打卡（每班一条；署名 + 交接要点）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input type="date" id="rd-date" value="${today}" /></label>
      <label>班次<select id="rd-shift">${(state.settings?.enabledShifts ?? ['day', 'night']).map((k) => `<option value="${k}">${SHIFTS[k].label}（${SHIFTS[k].time}）</option>`).join('')}</select></label>
      <label>值班人<input id="rd-staff" placeholder="如：李芳" /></label>
      <label>夜巡次数（夜班必填）<input type="number" id="rd-night" min="1" max="12" value="${state.settings?.nightMinTimes ?? 2}" /></label>
      <label class="span2">重点老人 / 交接事项（选填）<input id="rd-majors" placeholder="如：302 周奶奶拒服药已记录；401 王爷爷需协助如厕" /></label>
      <label class="span2">本班异常情况（有异常才填，会要求写明处置）<input id="rd-abnormal" placeholder="如：无" /></label>
    </div>
    <button class="btn" data-action="add-round">落账打卡</button>
    <p class="fine">《养老机构管理办法》第二十八条：实行 24 小时值班，做好老年人安全保障工作——纸本交接本翻不出连续性，这里缺一班亮一班。</p>
  </div>

  <h2 class="sec">巡查台账（最近 ${rounds.length} 班）</h2>
  ${rounds.length ? `<div class="card"><table class="plain">
    <tr><th>日期</th><th>班次</th><th>值班人</th><th>要点 / 异常</th><th></th></tr>
    ${rounds.map((e) => `<tr>
      <td class="fine">${esc(e.dateISO)}</td>
      <td>${SHIFTS[e.shift]?.label ?? esc(e.shift)}${e.shortNote ? ' <span class="pill warn">🌙 夜巡不足</span>' : ''}</td>
      <td>${esc(e.staff)}</td>
      <td>${e.status === 'abnormal' ? `<strong>⚠ ${esc(e.abnormalNote ?? '')}</strong>${e.majors ? `<div class="basis">${esc(e.majors)}</div>` : ''}` : esc(e.majors || '—')}</td>
      <td><button class="btn small ghost" data-action="del-round" data-idx="${e.id}">删</button></td>
    </tr>`).join('')}
  </table></div>` : '<div class="card"><p class="fine">还没有打卡记录。下一班从上面落账开始。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 事件（登记 → 家属告知 → 复盘闭环）
// ---------------------------------------------------------------------------

function incidentCard(state, ev) {
  const resident = state.residents.find((r) => r.id === ev.residentId);
  const closed = ev.status === 'closed';
  return `<details class="card car-card">
    <summary>
      <span class="car-title"><strong>${esc(ev.dateISO)}【${esc(INCIDENT_TYPES[ev.type]?.label ?? ev.type)}】${esc(ev.residentName)}</strong>
        <div class="basis">${esc(ev.desc)}</div></span>
      ${closed ? '<span class="pill ok">✅ 已闭环</span>' : '<span class="pill issue">🔴 未闭环</span>'}
    </summary>
    <div class="basis">处置：${esc(ev.firstAid || '—')}${ev.sentToHospital ? ' · <strong>已送医</strong>' : ''}</div>
    ${closed ? `
      <div class="card inner">
        <strong>家属告知</strong>：${esc(ev.familyNotifiedAt)} · ${esc(ev.familyWay)} · 通知人 ${esc(ev.familyBy)}<br/>
        <strong>复盘整改</strong>：${esc(ev.reviewNote)}
        <div class="row"><button class="btn small ghost" data-action="undo-close" data-idx="${ev.id}">撤销闭环（误操作回滚）</button></div>
      </div>`
    : `
      <div class="card inner">
        <strong>闭环结案</strong>（66 号令第十九条：突发情况转送救治并通知紧急联系人——没告知家属的结案，工具拒绝落账）
        <div class="form-grid">
          <label>家属告知时间<input id="ic-at-${ev.id}" placeholder="如：${todayISO()} 21:30" /></label>
          <label>告知方式<select id="ic-way-${ev.id}"><option>电话</option><option>来访面谈</option><option>微信</option><option>视频</option></select></label>
          <label>通知人<input id="ic-by-${ev.id}" placeholder="如：护理站 李芳" /></label>
          <label>复盘整改措施<input id="ic-review-${ev.id}" placeholder="如：全院喂食再培训 + 3 楼加防滑垫" /></label>
        </div>
        <button class="btn" data-action="close-incident" data-idx="${ev.id}">完成告知与复盘，结案</button>
      </div>`}
    ${resident ? '' : '<p class="fine">该老人档案已删除——事件记录保留。</p>'}
  </details>`;
}

export function viewIncidents(state) {
  const today = todayISO();
  const residents = state.residents.filter((r) => r.status === 'in');
  const events = [...(state.incidents ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const openCount = events.filter((e) => e.status === 'open').length;
  return `
  <h2 class="sec">🚨 事件登记（发生了什么，就记什么）</h2>
  <div class="card">
    ${residents.length ? `
    <div class="form-grid">
      <label>老人<select id="ie-resident">${residents.map((r) => `<option value="${r.id}">${esc(r.name)}${r.bed ? ` · ${esc(r.bed)}` : ''}</option>`).join('')}</select></label>
      <label>类型<select id="ie-type">${Object.keys(INCIDENT_TYPES).map((k) => `<option value="${k}">${INCIDENT_TYPES[k].label}</option>`).join('')}</select></label>
      <label>日期<input type="date" id="ie-date" value="${today}" /></label>
      <label>是否送医<select id="ie-hospital"><option value="no">否</option><option value="yes">是（已转送救治）</option></select></label>
      <label class="span2">事件经过<input id="ie-desc" placeholder="如：如厕后滑坐于地，右髋部触痛，未碰撞头部" /></label>
      <label class="span2">现场处置（选填）<input id="ie-aid" placeholder="如：就地制动，15:40 送市二院拍片，通知家属" /></label>
    </div>
    <button class="btn" data-action="add-incident">登记事件（未闭环将一直点名）</button>`
    : '<p class="fine">先在「老人」页建档，再登记事件。</p>'}
  </div>

  <h2 class="sec">事件台账（${events.length} · 未闭环 ${openCount}）</h2>
  ${events.length ? events.map((e) => incidentCard(state, e)).join('') : '<div class="card"><p class="fine">还没有事件记录——这是好事，但真发生了别只走嘴：登记、处置、告知家属、复盘，四步落账。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 周期义务账
// ---------------------------------------------------------------------------

export function viewCycles(state) {
  const today = todayISO();
  const items = [...(state.cycles ?? [])].sort((a, b) => a.dueISO.localeCompare(b.dueISO));
  return `
  <h2 class="sec">⏰ 周期义务登记（评估复评 / 应急演练 / 员工体检）</h2>
  <div class="card">
    <div class="form-grid">
      <label>类型<select id="cy-kind">${Object.keys(CYCLE_KINDS).map((k) => `<option value="${k}">${CYCLE_KINDS[k].label}</option>`).join('')}</select></label>
      <label>对象 / 责任人<input id="cy-owner" placeholder="如：周桂芳 / 全员 / 护理员李芳" /></label>
      <label>到期日<input type="date" id="cy-due" value="${today}" /></label>
      <label>备注（选填）<input id="cy-note" placeholder="如：委托XX评估机构上门" /></label>
    </div>
    <button class="btn" data-action="add-cycle">加入周期账</button>
    <p class="fine">「定期开展应急演练」「定期体检」里的「定期」，纸本时代靠记性，这里到期就点名。周期天数可在设置里按属地要求调整。</p>
  </div>

  <h2 class="sec">周期台账（${items.length}）</h2>
  ${items.length ? `<div class="card"><table class="plain">
    <tr><th>事项</th><th>对象</th><th>到期日</th><th>状态</th><th></th></tr>
    ${items.map((c) => {
      const st = cycleStatus(c, today);
      const pill = st === 'due' ? '<span class="pill issue">🔴 已到期</span>' : st === 'soon' ? '<span class="pill warn">🟡 临期</span>' : '<span class="pill ok">✅ 正常</span>';
      return `<tr>
        <td>${esc(CYCLE_KINDS[c.kind]?.label ?? c.kind)}${c.note ? `<div class="basis">${esc(c.note)}</div>` : ''}</td>
        <td>${esc(c.owner)}</td>
        <td class="fine">${esc(c.dueISO)}</td>
        <td>${pill}</td>
        <td><button class="btn small" data-action="cycle-done" data-idx="${c.id}">今天完成（自动滚动下一轮）</button></td>
      </tr>`;
    }).join('')}
  </table></div>` : '<div class="card"><p class="fine">还没有周期义务。先把最近的应急演练和员工体检录进来。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 自证包（信任的交付物）
// ---------------------------------------------------------------------------

export function viewCert(state, certSel = null) {
  if (!state.residents?.length) return viewOnboarding();
  const today = todayISO();
  const sorted = [...state.residents].sort((a, b) => (a.status === b.status ? b.admitISO.localeCompare(a.admitISO) : a.status === 'in' ? -1 : 1));
  const sel = {
    residentId: certSel?.residentId ?? sorted[0]?.id,
    fromISO: certSel?.fromISO ?? addDays(today, -29),
    toISO: certSel?.toISO ?? today,
  };
  let preview = '';
  let error = '';
  try {
    preview = certText({ state, ...sel, todayISOStr: today });
  } catch (e) { error = e.message; }

  return `
  <h2 class="sec">🧾 照护安全自证包（检查 / 家属质询 / 纠纷，30 秒出证）</h2>
  <div class="card">
    <div class="form-grid">
      <label>老人<select id="cert-resident">${sorted.map((r) => `<option value="${r.id}" ${r.id === sel.residentId ? 'selected' : ''}>${esc(r.name)}${r.bed ? ` · ${esc(r.bed)}` : ''}${r.status === 'out' ? '（已离院）' : ''}</option>`).join('')}</select></label>
      <label>时段起<input type="date" id="cert-from" value="${sel.fromISO}" /></label>
      <label>时段止<input type="date" id="cert-to" value="${sel.toISO}" /></label>
    </div>
    <div class="row">
      <button class="btn small" data-action="cert-apply">生成</button>
      <button class="btn" data-action="cert-copy">📋 复制文本（微信发送）</button>
      <button class="btn ghost" data-action="cert-download">⬇️ 下载打印版 HTML</button>
      <button class="btn ghost" data-action="cert-print">🖨️ 直接打印</button>
    </div>
    ${error ? `<p class="fine">⚠ ${esc(error)}</p>` : `
      <pre class="preview">${esc(preview)}</pre>
      <p class="fine">文本通道为主：家属与检查人员不用装任何东西；打印版为单文件 HTML（含查阅签字栏）。缺班如实列出——检查现场「记录连不上」比「有缺口但补得诚实」更致命，缺口请安排当班人补录并注明。</p>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置（机构 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const home = state.home ?? {};
  const s = state.settings ?? {};
  const enabled = s.enabledShifts ?? ['day', 'night'];
  return `
  <h2 class="sec">🏥 机构</h2>
  <div class="card">
    <div class="form-grid">
      <label>机构名称<input id="hm-name" value="${esc(home.name ?? '')}" placeholder="如：慈安养护院（印在自证包上）" /></label>
      <label>联系电话<input id="hm-phone" value="${esc(home.phone ?? '')}" /></label>
      <label>床位数<input type="number" id="hm-beds" min="1" value="${home.beds ?? ''}" placeholder="如 38" /></label>
    </div>
    <button class="btn" data-action="save-home">保存</button>
  </div>

  <h2 class="sec">🔔 班次与周期参数（属地口径的本地覆盖）</h2>
  <div class="card">
    <div class="row" style="gap:14px">
      ${Object.keys(SHIFTS).map((k) => `<label style="font-size:13px"><input type="checkbox" id="sf-shift-${k}" ${enabled.includes(k) ? 'checked' : ''} style="margin-right:4px" />${SHIFTS[k].label}（${SHIFTS[k].time}）</label>`).join('')}
    </div>
    <div class="row">
      <label>夜班夜巡下限<input type="number" id="sf-nightmin" min="1" max="12" value="${s.nightMinTimes ?? 2}" style="width:70px" /> 次</label>
      <label>周期临期线<input type="number" id="sf-soon" min="3" max="180" value="${s.soonDays ?? 30}" style="width:70px" /> 天</label>
      <label>评估复评周期<input type="number" id="sf-p-assess" min="0" max="1095" value="${s.cyclePeriods?.assess ?? 180}" style="width:70px" /> 天</label>
      <label>应急演练周期<input type="number" id="sf-p-drill" min="0" max="1095" value="${s.cyclePeriods?.drill ?? 180}" style="width:70px" /> 天</label>
      <label>员工体检周期<input type="number" id="sf-p-health" min="0" max="1095" value="${s.cyclePeriods?.health ?? 365}" style="width:70px" /> 天</label>
    </div>
    <button class="btn small" data-action="save-settings">保存参数</button>
    <p class="fine">三班制机构勾上「中班」；夜巡下限、复评与演练周期以属地民政与消防要求为准——参数永远可覆盖，工具不替监管做主。</p>
  </div>

  <h2 class="sec">⚙️ 数据与备份</h2>
  <div class="card">
    <p class="fine" style="margin-top:0">老人健康与家属信息仅存于本机浏览器（本地优先，也是 66 号令第三十二条个人信息保护的最稳实现）。换手机/给合伙人备份：导出 JSON 文件，到目标设备导入。本地事件流（使用埋点）可单独导出，用于产品验证。</p>
    <div class="row">
      <button class="btn block" data-action="export-json">⬇️ 导出备份</button>
      <label class="btn ghost block" style="line-height:2.4">
        ⬆️ 导入备份<input type="file" id="import-file" accept=".json" hidden />
      </label>
      <button class="btn ghost block" data-action="export-events">📈 导出使用记录</button>
    </div>
  </div>`;
}
