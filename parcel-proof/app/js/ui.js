/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  REJECT_REASONS, INTERCEPT_ACTIONS, COMPLAINT_CHANNELS, COMPLAINT_RESULTS,
  FINE_OUTCOMES, DESTROY_WAYS, DUTY_KINDS, DEFAULT_REPLY_DAYS, DEFAULT_DESTROY_DAYS,
  filingState, routineGapDays, unconfirmedRoutines,
  openIntercepts, openComplaints, replyStats, pendingFines, totalRecovered,
  destroyState, dutyBoard, healthCheck, monthlySummary,
  fmtYuan, escapeHtml, todayISO, addDays,
} from './core.js';

export const esc = escapeHtml;

const LEVEL_PILL = { overdue: 'bad', due: 'warn', ok: 'ok', never: 'bad', unset: 'bad' };
const LEVEL_TEXT = { overdue: '逾期', due: '临期', ok: '正常', never: '从未执行', unset: '未登记' };

export function daysBetween(aISO, bISO) {
  return Math.round((new Date(`${bISO}T00:00:00Z`) - new Date(`${aISO}T00:00:00Z`)) / 86400000);
}

export function viewOnboarding() {
  return `
  <h2 class="sec">末端网点，先有一本查得到的账</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>快递末端网点站在寄递安全的闸口上：收寄要验视并留标识、寄件人要查验实名、投诉要 7 日内处理并告知（《快递暂行条例》第 29 条）、运单底单要定期销毁（第 35 条）、培训演练要定期做（第 21、36 条）、开办 20 日内要备案（第 19 条，不备案最高罚 5 万并可停业）。检查、倒查、总部罚款申诉，三件事全在问"拿记录来"——而现状是送货单背面记流水、投诉靠翻微信群、底单塞麻袋。<strong>总部系统管业务流，管不了你自己的履责痕迹。</strong></p>
    <p><strong>递安单的做法：</strong>网点建档（备案 20 日红线自动倒计时）→ 每天 30 秒三确认落账 → 拦截就登记（拦下来的每一件都是没被罚的证据）→ 投诉登记自动算答复截止日 → 考核罚款登记、申诉、挽回金额进账 → 一键出迎检自证包 / 月度小结 / 罚款申诉材料单。</p>
    <div class="row">
      <a class="btn" href="#/station">📦 先把网点建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是网点自查与申诉的底账，不碰实名收寄报送、不做政府平台接口；相关人员信息建议只登记姓氏或尾号，数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：备案钟 + 投诉答复钟 + 罚款挂账 + 拦截未闭环 + 销毁/义务/断更点名）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.station?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const boxes = [];

  const filing = filingState(state.station, today);
  if (filing.level === 'overdue') {
    boxes.push(`<div class="card alert issue"><strong>🛑 备案红线已过</strong><ul><li>开办日 ${esc(state.station.openedISO)}，备案期限 ${esc(filing.deadline)}，已过 ${-filing.daysLeft} 天——开办之日起 20 日内应向邮管部门备案（条例第 19 条，未备案可罚 1 万~5 万并可停业整顿）。已备案的，去「网点」补登记备案编号。</li></ul></div>`);
  } else if (filing.level === 'due') {
    boxes.push(`<div class="card alert"><strong>⏰ 备案期限临近</strong><ul><li>${esc(filing.detail)}——剩 ${filing.daysLeft} 天（条例第 19 条）。</li></ul></div>`);
  }

  const cps = openComplaints(state, today);
  const overdueCp = cps.filter((c) => c.daysLeft < 0);
  const dueCp = cps.filter((c) => c.daysLeft >= 0);
  if (overdueCp.length) {
    boxes.push(`<div class="card alert issue"><strong>⚠ 投诉已超答复期限（${overdueCp.length}）</strong>
      <ul>${overdueCp.slice(0, 6).map((c) => `<li>${esc(c.dateISO)} ${esc(c.customer || '用户')} · ${esc(c.matter || '—')}——截止 ${esc(c.replyDueISO)}，已超 ${-c.daysLeft} 天（条例第 29 条：自接到投诉 7 日内处理并告知）。今天答复，去「台账」闭环</li>`).join('')}</ul></div>`);
  }
  if (dueCp.length) {
    boxes.push(`<div class="card alert"><strong>💬 ${settings.replyDays ?? DEFAULT_REPLY_DAYS} 日答复窗口内（${dueCp.length}）</strong>
      <ul>${dueCp.slice(0, 6).map((c) => `<li>${esc(c.dateISO)} ${esc(c.customer || '用户')} · ${esc(c.matter || '—')}——剩 ${c.daysLeft} 天（截止 ${esc(c.replyDueISO)}）</li>`).join('')}</ul></div>`);
  }

  const pfn = pendingFines(state);
  if (pfn.length) {
    boxes.push(`<div class="card alert issue"><strong>💰 考核罚款待处理（${pfn.length} · ${fmtYuan(pfn.reduce((n, f) => n + f.amountCents, 0))}）</strong>
      <ul>${pfn.slice(0, 6).map((f) => `<li>${esc(f.dateISO)} ${esc(f.no || '（无编号）')} ${fmtYuan(f.amountCents)} · ${esc(f.basis || '—')}——登记申诉、落结果，钱才回得来；去「台账」处理</li>`).join('')}</ul>
      <p class="fine">累计已挽回 ${fmtYuan(totalRecovered(state))}——这是台账帮你挣回来的钱。</p></div>`);
  }

  const ic = openIntercepts(state);
  if (ic.length) {
    boxes.push(`<div class="card alert"><strong>📦 拦截未闭环（${ic.length}）</strong>
      <ul>${ic.slice(0, 6).map((x) => `<li>${esc(x.dateISO)} ${esc(x.person || '当事人')} · ${esc(REJECT_REASONS[x.reason] ?? x.reason)} · ${esc(INTERCEPT_ACTIONS[x.action] ?? x.action)}——暂存/报告类要有下文，去「台账」销案</li>`).join('')}</ul></div>`);
  }

  const ds = destroyState(state, today, settings.destroyDays ?? DEFAULT_DESTROY_DAYS);
  if (ds.level === 'overdue' || ds.level === 'never') {
    boxes.push(`<div class="card alert issue"><strong>🗑 底单销毁${ds.level === 'never' ? '从未登记' : '已超期'}</strong>
      <ul><li>${ds.level === 'never' ? '运单底单定期销毁是条例第 35 条的明文义务，信息泄露倒查第一问就是销毁记录——今天销一次，登记 10 秒' : `上次销毁 ${esc(ds.lastISO)}，周期 ${settings.destroyDays ?? DEFAULT_DESTROY_DAYS} 天已过 ${-ds.daysLeft} 天`}</li></ul></div>`);
  } else if (ds.level === 'due') {
    boxes.push(`<div class="card alert"><strong>🗑 底单销毁临期</strong><ul><li>${esc(ds.detail)}——剩 ${ds.daysLeft} 天</li></ul></div>`);
  }

  const duties = dutyBoard(state, today).filter((d) => d.level === 'overdue' || d.level === 'never' || d.level === 'due');
  if (duties.length) {
    boxes.push(`<div class="card alert"><strong>🗓 周期义务点名</strong>
      <ul>${duties.map((d) => `<li>${esc(d.label)}：${d.level === 'never' ? '从未执行' : d.level === 'overdue' ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}（依据：${esc(d.basis)}）</li>`).join('')}</ul></div>`);
  }

  const gap = routineGapDays(state, today);
  const unconfirmed = unconfirmedRoutines(state);
  if (gap !== null && gap > (settings.gapDays ?? 7)) {
    boxes.push(`<div class="card alert issue"><strong>📉 三项制度落账已断更 ${gap} 天</strong><ul><li>台账的价值在「持续」，断更是检查现场最尴尬的一问。今天补一笔 30 秒。</li></ul></div>`);
  }
  if (unconfirmed.length) {
    boxes.push(`<div class="card alert issue"><strong>⚠ ${unconfirmed.length} 天存在「未执行」确认</strong><ul><li>最近一天 ${esc(unconfirmed[unconfirmed.length - 1].dateISO)}——如实登记是对的，但要逐日写明原因与整改，别让缺口裸奔。</li></ul></div>`);
  }

  const hc = healthCheck(state, today, settings);
  const stats = replyStats(state, today);
  const thisMonth = today.slice(0, 7);
  const sum = monthlySummary(state, thisMonth, today);

  if (!boxes.length) {
    boxes.push(`<div class="card alert" style="border-left-color:#16a34a;background:#f0fdf4"><strong>✅ 今天没有红灯</strong><ul><li>备案在期、投诉答复没超线、罚款无挂账、拦截全闭环、销毁与义务在期——继续保持，落账别断。</li></ul></div>`);
  }

  return `
  ${boxes.join('')}
  <div class="card progress-card">
    <strong class="progress-text">账本体检：${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）</strong>
    <p class="done-note">${esc(stats.total ? `${stats.onTime}/${stats.total} 笔投诉在 ${settings.replyDays ?? DEFAULT_REPLY_DAYS} 日内答复` : '尚无投诉记录')} · 本月落账 ${sum.routines} 天 · 拦截 ${sum.intercepts} 笔 · 累计挽回 ${fmtYuan(totalRecovered(state))}</p>
    <div class="row">
      <a class="btn small" href="#/ledger">去落账</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 网点（建档 + 备案 + 周期义务）
// ---------------------------------------------------------------------------

export function viewStation(state) {
  const s = state.station ?? {};
  const today = todayISO();
  const filing = filingState(s, today);
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;
  return `
  <h2 class="sec">网点建档与备案</h2>
  <div class="card">
    <div class="form-grid">
      <label>网点名称 *<input id="st-name" value="${esc(s.name ?? '')}" placeholder="如：XX路快递超市" /></label>
      <label>品牌/商标<input id="st-brand" value="${esc(s.brand ?? '')}" placeholder="加盟品牌或独立" /></label>
      <label>负责人<input id="st-manager" value="${esc(s.manager ?? '')}" /></label>
      <label>电话<input id="st-phone" value="${esc(s.phone ?? '')}" /></label>
      <label class="span2">地址<input id="st-address" value="${esc(s.address ?? '')}" /></label>
      <label>开办日 *<input id="st-opened" type="date" value="${esc(s.openedISO ?? '')}" /></label>
      <label>备案状态
        <select id="st-filed"><option value="no" ${!s.filed ? 'selected' : ''}>未备案</option><option value="yes" ${s.filed ? 'selected' : ''}>已备案</option></select>
      </label>
      <label>备案编号<input id="st-fileno" value="${esc(s.fileNo ?? '')}" placeholder="已备案则填" /></label>
      <label>备案日期<input id="st-filed-date" type="date" value="${esc(s.filedISO ?? '')}" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-station">保存网点信息</button>
      <span class="pill ${LEVEL_PILL[filing.level] ?? ''}">备案钟：${pill(filing.level)} ${esc(filing.detail)}</span>
    </div>
    <p class="fine">开办之日起 20 日内向所在地邮政管理部门备案，无需办理营业执照（《快递暂行条例》第 19 条）；未备案由邮管责令改正，可处 1 万元以下罚款，情节严重 1 万~5 万元并可责令停业整顿（第 50 条）。</p>
  </div>

  <h2 class="sec">周期义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}（默认 ${v.cycleDays} 天）</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="参训人员/演练科目/检查结果（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="set-duty">登记完成</button></div>
    ${(() => {
    const rows = dutyBoard(state, today).map((d) => {
      const lv = d.level === 'never' ? 'never' : d.level;
      const next = d.level === 'never' ? '从未执行' : `${esc(d.nextDue)}（剩 ${d.daysLeft} 天）`;
      return `<tr class="${lv === 'never' || lv === 'overdue' ? 'muted' : ''}"><td>${esc(d.label)}</td><td>${d.lastDoneISO ? esc(d.lastDoneISO) : '—'}</td><td>${next}</td><td><span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span></td><td class="basis">${esc(d.basis)}</td></tr>`;
    }).join('');
    return `<table class="plain"><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${rows || '<tr><td colspan="5">尚未登记——从培训开始记</td></tr>'}</table>`;
  })()}
    <p class="fine">周期为参数化默认值（培训 90 / 演练 365 / 消防器材 30 / 车辆电池 30 天），属地要求与品牌制度永远赢。</p>
  </div>

  <h2 class="sec">车辆与充电（可选登记）</h2>
  <div class="card">
    <p class="fine" style="margin:0 0 8px">快递三轮车属地统一编号管理（条例第 14 条）；电动自行车/电池不得在门厅、疏散走道、楼梯间、安全出口停放或充电（应急部令第 5 号第 37 条，拒不改正罚 2000~10000 元）——充电检查已并入「车辆与电池充电检查」周期义务，此处按需留备注。</p>
    <div class="row"><input id="veh-note" style="flex:1" placeholder="车辆编号/电池情况备注（存本机）" value="${esc(state.vehicleNote ?? '')}" /><button class="btn ghost" data-action="save-veh-note">保存备注</button></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 台账（日落账 / 拦截 / 投诉 / 罚款 / 销毁 五段）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;

  const routines = [...(state.routines ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 30);
  const routineRows = routines.map((r) => `<tr class="${!r.verifyOk || !r.realnameOk ? 'muted' : ''}">
    <td>${e(r.dateISO)}</td><td>${r.inbound}</td>
    <td>${r.verifyOk ? '✅' : '❌'}</td><td>${r.realnameOk ? '✅' : '❌'}</td>
    <td>${r.security === 'done' ? '已安检' : '无设备'}</td><td>${e(r.note || '—')}</td>
    <td><button class="btn small ghost" data-action="del-routine" data-idx="${r.id}">删</button></td>
  </tr>`).join('');

  const icList = [...(state.intercepts ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 30);
  const icRows = icList.map((x) => `<tr class="${x.closedISO ? '' : 'muted'}">
    <td>${e(x.dateISO)}</td><td>${e(x.person || '—')}</td><td>${e(x.item || '—')}</td>
    <td>${e(REJECT_REASONS[x.reason] ?? x.reason)}</td><td>${e(INTERCEPT_ACTIONS[x.action] ?? x.action)}</td>
    <td>${x.closedISO ? `${e(x.closedISO)}${x.result ? `·${e(x.result)}` : ''}` : '<strong>未闭环</strong>'}</td>
    <td>${x.closedISO ? '' : `<button class="btn small" data-action="show-close-intercept" data-idx="${x.id}">销案</button>`}</td>
  </tr>`).join('');

  const cpList = [...(state.complaints ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 30);
  const cpRows = cpList.map((c) => {
    const left = c.replyISO ? '' : c.replyDueISO < today ? `（<strong>超 ${daysBetween(c.replyDueISO, today)} 天</strong>）` : `（剩 ${daysBetween(today, c.replyDueISO)} 天）`;
    return `<tr class="${c.replyISO ? '' : 'muted'}">
    <td>${e(c.dateISO)}</td><td>${e(c.customer || '—')}</td><td>${e(COMPLAINT_CHANNELS[c.channel] ?? c.channel)}</td>
    <td>${e(c.matter || '—')}</td><td>${e(c.replyDueISO)}${left}</td>
    <td>${c.replyISO ? `${e(c.replyISO)}${c.late ? '（超期）' : ''}·${e(COMPLAINT_RESULTS[c.result] ?? c.result)}` : '<strong>未答复</strong>'}</td>
    <td>${c.replyISO ? '' : `<button class="btn small" data-action="show-close-complaint" data-idx="${c.id}">答复</button>`}</td>
  </tr>`;
  }).join('');

  const fnList = [...(state.fines ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 30);
  const cpOptions = (state.complaints ?? []).map((c) => `<option value="${e(c.id)}">${e(c.dateISO)} ${e(c.matter || c.customer || '投诉')}</option>`).join('');
  const fnRows = fnList.map((f) => `<tr class="${f.outcome === 'pending' ? 'muted' : ''}">
    <td>${e(f.dateISO)}</td><td>${e(f.no || '—')}</td><td>${fmtYuan(f.amountCents)}</td>
    <td>${e(f.basis || '—')}</td>
    <td>${e(FINE_OUTCOMES[f.outcome] ?? f.outcome)}${f.recoveredCents ? `<br><span class="basis">挽回 ${fmtYuan(f.recoveredCents)}</span>` : ''}</td>
    <td>${f.outcome === 'pending' ? `<button class="btn small" data-action="show-appeal" data-idx="${f.id}">申诉/落结果</button>` : ''}</td>
  </tr>`).join('');

  const dsList = [...(state.destroys ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20);
  const dsRows = dsList.map((d) => `<tr>
    <td>${e(d.dateISO)}</td><td>${e(DESTROY_WAYS[d.way] ?? d.way)}</td><td>${d.count}</td>
    <td>${e(d.operator || '—')}</td><td>${e(d.witness || '—')}</td><td>${e(d.note || '—')}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">① 每日三项制度落账（30 秒，同日一笔）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="rt-date" type="date" value="${e(today)}" /></label>
      <label>收寄件数<input id="rt-inbound" type="number" min="0" value="0" /></label>
      <label>验视已执行<select id="rt-verify"><option value="yes">✅ 均已验视</option><option value="no">❌ 有未执行（写明原因）</option></select></label>
      <label>实名已查验<select id="rt-realname"><option value="yes">✅ 均已查验</option><option value="no">❌ 有未执行（写明原因）</option></select></label>
      <label>安检<select id="rt-security"><option value="none">本网点无安检设备</option><option value="done">已执行安检并标识</option></select></label>
      <label class="span2">备注<input id="rt-note" placeholder="异常/原因/整改（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-routine">落账</button><span class="basis">条例第 23/32/33 条：拒绝验视或身份不实的当场拦截并去②登记——那也是自证资产</span></div>
    <table class="plain"><tr><th>日期</th><th>收寄</th><th>验视</th><th>实名</th><th>安检</th><th>备注</th><th></th></tr>${routineRows || '<tr><td colspan="7">还没有落账——今天第一笔</td></tr>'}</table>
  </div>

  <h2 class="sec">② 拦截登记簿（拒收/问题件）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="ic-date" type="date" value="${e(today)}" /></label>
      <label>当事人（建议姓氏/尾号）<input id="ic-person" placeholder="如：王先生 / 尾号5678" /></label>
      <label>物品<input id="ic-item" placeholder="如：充电宝散装/不明液体" /></label>
      <label>原因<select id="ic-reason">${Object.entries(REJECT_REASONS).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join('')}</select></label>
      <label>处置<select id="ic-action">${Object.entries(INTERCEPT_ACTIONS).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join('')}</select></label>
      <label class="span2">备注<input id="ic-note" placeholder="过程细节（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-intercept">登记拦截</button><span class="basis">条例第 34 条：发现禁寄拒绝收寄；在途疑似禁寄立即停止分拣运输投递并报告</span></div>
    <table class="plain"><tr><th>日期</th><th>当事人</th><th>物品</th><th>原因</th><th>处置</th><th>闭环</th><th></th></tr>${icRows || '<tr><td colspan="7">还没有拦截登记</td></tr>'}</table>
  </div>

  <h2 class="sec">③ 投诉台账（${state.settings?.replyDays ?? DEFAULT_REPLY_DAYS} 日答复钟自动算）</h2>
  <div class="card">
    <div class="form-grid">
      <label>登记日<input id="cp-date" type="date" value="${e(today)}" /></label>
      <label>用户（建议姓氏/尾号）<input id="cp-customer" placeholder="如：李女士" /></label>
      <label>渠道<select id="cp-channel">${Object.entries(COMPLAINT_CHANNELS).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join('')}</select></label>
      <label class="span2">事项<input id="cp-matter" placeholder="如：派件未送上门/破损" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-complaint">登记投诉</button><span class="basis">条例第 29 条：自接到投诉之日起 ${state.settings?.replyDays ?? DEFAULT_REPLY_DAYS} 日内处理并告知用户；12305 转办按管理办法第 30 条处理并反馈</span></div>
    <table class="plain"><tr><th>登记日</th><th>用户</th><th>渠道</th><th>事项</th><th>答复截止</th><th>答复</th><th></th></tr>${cpRows || '<tr><td colspan="7">还没有投诉登记</td></tr>'}</table>
  </div>

  <h2 class="sec">④ 考核罚款与申诉挽回账</h2>
  <div class="card">
    <div class="form-grid">
      <label>考核日期<input id="fn-date" type="date" value="${e(today)}" /></label>
      <label>罚款编号<input id="fn-no" placeholder="工单号/考核单号" /></label>
      <label>金额（元）<input id="fn-amount" type="number" min="0" step="0.01" /></label>
      <label>考核依据<input id="fn-basis" placeholder="如：投诉考核/延误考核" /></label>
      <label class="span2">关联投诉（可选）<select id="fn-complaint"><option value="">不关联</option>${cpOptions}</select></label>
    </div>
    <div class="row"><button class="btn" data-action="add-fine">登记罚款</button><span class="basis">金额为品牌考核口径；申诉后落结果——累计挽回 ${fmtYuan(totalRecovered(state))}</span></div>
    <table class="plain"><tr><th>日期</th><th>编号</th><th>金额</th><th>依据</th><th>结果</th><th></th></tr>${fnRows || '<tr><td colspan="6">还没有罚款登记</td></tr>'}</table>
  </div>

  <h2 class="sec">⑤ 底单销毁台账（条例第 35 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="ds-date" type="date" value="${e(today)}" /></label>
      <label>方式<select id="ds-way">${Object.entries(DESTROY_WAYS).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join('')}</select></label>
      <label>数量（张/公斤）<input id="ds-count" type="number" min="0" value="0" /></label>
      <label>经办<input id="ds-operator" /></label>
      <label>监销<input id="ds-witness" placeholder="第二人监销更硬" /></label>
      <label class="span2">备注<input id="ds-note" placeholder="含电子面单数据清理情况（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-destroy">登记销毁</button><span class="basis">周期 ${state.settings?.destroyDays ?? DEFAULT_DESTROY_DAYS} 天（参数化通识口径，总部制度永远赢）</span></div>
    <table class="plain"><tr><th>日期</th><th>方式</th><th>数量</th><th>经办</th><th>监销</th><th>备注</th></tr>${dsRows || '<tr><td colspan="6">还没有销毁登记</td></tr>'}</table>
  </div>

  <div id="modal-host"></div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 迎检自证包 / 申诉材料单）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const e = esc;
  const fineOptions = [...(state.fines ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((f) => `<option value="${e(f.id)}">${e(f.dateISO)} ${e(f.no || '（无编号）')} ${fmtYuan(f.amountCents)}</option>`).join('');

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到微信群或存档——含落账/拦截/投诉/罚款挽回/销毁/义务六段与法条口径尾注。</p>'}
  </div>

  <h2 class="sec">账本体检（${Object.keys(healthCheck(state, today, state.settings ?? {}).items).length} 项）</h2>
  <div class="card">
    ${(() => {
    const hc = healthCheck(state, today, state.settings ?? {});
    const rows = hc.items.map((i) => `<tr class="${i.level === 'bad' ? 'muted' : ''}">
        <td>${esc(i.label)}</td><td><span class="pill ${LEVEL_PILL[i.level] ?? ''}">${i.level === 'bad' ? '红' : i.level === 'warn' ? '黄' : '绿'}</span></td><td>${esc(i.detail)}</td>
      </tr>`).join('');
    return `<p class="progress-text" style="margin:0 0 6px"><strong>${hc.score} 分</strong>（红 ${hc.bad} · 黄 ${hc.warn}）</p><table class="plain"><tr><th>项目</th><th>灯</th><th>说明</th></tr>${rows}</table>`;
  })()}
  </div>

  <h2 class="sec">出证（三通道）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="inspect-download">⬇ 迎检自证包（HTML）</button>
      <button class="btn ghost" data-action="inspect-print">🖨 迎检自证包（打印）</button>
    </div>
    <p class="fine">单文件含：备案状态、近 30 天三项制度台账、拦截登记簿、投诉处理与 ${state.settings?.replyDays ?? DEFAULT_REPLY_DAYS} 日达成率、罚款挽回、销毁台账、周期义务——检查重点对标条例第 46 条，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>罚款笔<select id="appeal-fine">${fineOptions || '<option value="">先在台账登记罚款</option>'}</select></label>
      <button class="btn" data-action="appeal-print" ${fineOptions ? '' : 'disabled'}>⬇ 申诉材料单</button>
    </div>
    <p class="fine">按笔生成：罚款信息 + 关联投诉处理时间线 + 前后 15 天履责证据 + 申诉理由栏——向品牌方/上级申诉时的底稿。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  return `
  <h2 class="sec">参数（属地规则与品牌制度永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>投诉答复时限（天）<input id="set-reply" type="number" min="1" max="30" value="${s.replyDays ?? DEFAULT_REPLY_DAYS}" /></label>
      <label>底单销毁周期（天）<input id="set-destroy" type="number" min="7" max="365" value="${s.destroyDays ?? DEFAULT_DESTROY_DAYS}" /></label>
      <label>落账断更红线（天）<input id="set-gap" type="number" min="2" max="30" value="${s.gapDays ?? 7}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">答复时限 7 天为《快递暂行条例》第 29 条口径；销毁周期 90 天为通识先验（条例只规定「定期」）；均可在属地或总部制度有更严要求时下调。</p>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">⬇ 导出备份</button>
      <button class="btn ghost" data-action="export-events">⬇ 导出使用记录</button>
      <label class="btn ghost" style="position:relative">⬆ 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与事件流；相关人员信息（姓氏/尾号）也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例网点（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 日落账 → 拦截 → 投诉答复钟 → 罚款挽回 → 三通道出证。</p>
  </div>`;
}
