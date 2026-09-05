/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  CYLINDER_SPECS, CHECK_ITEMS, ITEM_VALUES, paramsOf,
  userBalance, openRisks, annualStatus, cylinderStatus, certAudit,
  complianceAudit, conservation,
  slipText, checkLedgerText, deliveryLedgerText,
  fmtYuan, escapeHtml, todayISO, addDays,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

export function viewOnboarding() {
  return `
  <h2 class="sec">液化气供应站，先把"责任对得上"这件事做实</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>《城镇燃气管理条例》要求燃气经营者指导用户安全用气、对用户燃气设施定期进行安全检查（罚则含责令改正与罚款）；十堰"6·13"事故后全国燃气安全专项整治常态化，"送气必检"、实名购气在多地落地。隐患只登记不复查，事故后责任反而更重；一户存几只瓶全凭记忆，餐馆以瓶抵款越记越乱。现状解法：纸安检单塞抽屉 + 瓶数靠脑子 + 检查前突击。</p>
    <p><strong>瓶安单的做法：</strong>用户建档 → 送气落账（在户瓶数守恒自动算）→ 入户安检五项逐检（有隐患必须登记整改）→ 复访合格才销案 → 年度安检/钢瓶检验/证件到期自动点名 → 隐患告知单当场打印签字、检查 30 秒打出台账包。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏪 先建供应站档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不碰充装追溯、不做政府报送、不做订气平台——那是充装单位、监管平台与零售生意的事；这里是网点自己的经营底账。数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：未闭环隐患 + 到期点名 + 断更 + 守恒体检）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.users?.length) return viewOnboarding();
  const today = todayISO();
  const audit = complianceAudit(state, today);
  const params = paramsOf(state.settings);
  const cons = conservation(state);

  const alerts = [];
  if (audit.openRisks.length) {
    alerts.push(`<div class="card alert issue"><strong>⚠ 隐患未闭环（复访合格才能销案）</strong>
      <ul>${audit.openRisks.map((x) => `<li>${esc(x.check.dateISO)} ${esc(x.user?.name ?? '?')}：${esc(x.check.riskItems.map((k) => CHECK_ITEMS[k].label).join('、'))}｜整改：${esc(x.check.measure?.action || '—')}——
        <button class="btn small" data-action="goto-recheck" data-idx="${x.check.id}">复访销案</button></li>`).join('')}</ul></div>`);
  }
  const annualBad = audit.annualProblems.filter((x) => x.status !== 'ok');
  if (annualBad.length) {
    alerts.push(`<div class="card alert issue"><strong>📅 年度安检待办（周期 ${params.annualCheckDays} 天，可调）</strong>
      <ul>${annualBad.slice(0, 8).map((x) => `<li>${esc(x.user?.name ?? '?')}：${x.status === 'none' ? '从未安检' : x.status === 'overdue' ? `已逾期 ${-x.dueIn} 天` : `${x.dueIn} 天内到期`}</li>`).join('')}${annualBad.length > 8 ? `<li>……另有 ${annualBad.length - 8} 户见「安检」页</li>` : ''}</ul></div>`);
  }
  const cyls = audit.cylinders;
  if (cyls.overdue.length || cyls.expiring.length) {
    alerts.push(`<div class="card alert ${cyls.overdue.length ? 'issue' : ''}"><strong>🛢️ 钢瓶检验待办（超期瓶流转即风险）</strong>
      <ul>${cyls.overdue.map((c) => `<li>${esc(c.code)}：检验到期 ${esc(c.checkDueISO)} 已过——停发并送检</li>`).join('')}
      ${cyls.expiring.map((c) => `<li>${esc(c.code)}：${c.daysLeft} 天后（${esc(c.checkDueISO)}）检验到期</li>`).join('')}</ul></div>`);
  }
  const certs = audit.certs;
  if (certs.expired.length || certs.expiring.length) {
    alerts.push(`<div class="card alert ${certs.expired.length ? 'issue' : ''}"><strong>🧑‍🔧 员工证件待办</strong>
      <ul>${certs.expired.map((w) => `<li>${esc(w.name)}：证件到期 ${esc(w.certExpiryISO)} 已过——立即停岗复训换证</li>`).join('')}
      ${certs.expiring.map((w) => `<li>${esc(w.name)}：${w.daysLeft === 0 ? '今天' : `${w.daysLeft} 天后`}（${esc(w.certExpiryISO)}）到期</li>`).join('')}</ul></div>`);
  }
  if (audit.missingDates.length) {
    alerts.push(`<div class="card alert issue"><strong>📅 断更体检：近 ${audit.continuity.checkedDays} 天有 ${audit.missingDates.length} 天零配送记录</strong>
      <p class="fine">断更是台账可信度的最大杀手（检查现场第一句就是"连得上吗"）。缺记日：${audit.missingDates.slice(-5).map((d) => esc(d)).join('、')}${audit.missingDates.length > 5 ? ' 等' : ''}——如实补录（录入即留痕），别空着。</p></div>`);
  }

  const todayDels = (state.deliveries ?? []).filter((d) => d.dateISO === today);
  const todayFull = todayDels.reduce((s, d) => s + d.lines.reduce((t, ln) => t + ln.full, 0), 0);
  const todayEmpty = todayDels.reduce((s, d) => s + d.lines.reduce((t, ln) => t + ln.empty, 0), 0);
  const todayAmount = todayDels.reduce((s, d) => s + (d.amountCents ?? 0), 0);

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">🛵 今日配送：<strong>${todayDels.length}</strong> 单 · 送出 <strong>${todayFull}</strong> 瓶 · 收回 <strong>${todayEmpty}</strong> 瓶${todayAmount ? ` · ${fmtYuan(todayAmount)}` : ''}</div>
    ${todayDels.length
    ? `<p class="done-note">${todayDels.map((d) => `${esc(state.users.find((u) => u.id === d.userId)?.name || '?')} ${d.lines.map((ln) => `${ln.spec} 送${ln.full}/收${ln.empty}`).join('，')}`).join(' · ')}</p>`
    : '<p class="done-note">今天还没出车。送完气记得进「配送」落一笔。</p>'}
    <div class="row">
      <a class="btn" href="#/delivery">🛵 记一笔配送</a>
      <a class="btn ghost" href="#/check">🔍 入户安检</a>
      <a class="btn ghost" href="#/ledger">🖨️ 告知单/出证</a>
    </div>
  </div>
  ${alerts.join('')}
  <h2 class="sec">台账速览</h2>
  <div class="card">
    <div class="row stats-line">
      <span>用户 <strong>${state.users.length}</strong> 户</span>
      <span>累计配送 <strong>${(state.deliveries ?? []).length}</strong> 单</span>
      <span>在户瓶数 <strong>${cons.balances}</strong> 瓶</span>
      <span class="${cons.residual === 0 ? 'ok' : 'issue'}">守恒 <strong>${cons.residual === 0 ? '一致 ✅' : `残差 ${cons.residual}`}</strong></span>
    </div>
    <p class="fine" style="margin-bottom:0">安检与配送记录照实际如实录入——工具不判真伪，只保完整与闭环；台账的可信度建立在连续真实的记录上。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 用户档案
// ---------------------------------------------------------------------------

export function viewUsers(state) {
  const today = todayISO();
  return `
  <h2 class="sec">🧑‍🌾 用户建档（${state.users.length} 户）</h2>
  <div class="card">
    <div class="form-grid">
      <label>用户名称<input id="user-name" placeholder="如：王建国 / 李大姐餐馆" /></label>
      <label>电话<input id="user-phone" placeholder="实名底档" /></label>
      <label class="span2">地址<input id="user-addr" placeholder="送气与安检路线用" /></label>
      <label class="span2">常用瓶型<input id="user-specs" placeholder="15kg、50kg（逗号分隔，默认 15kg）" /></label>
      <label class="span2">备注<input id="user-note" placeholder="选填，如：餐馆，以瓶抵款月底结" /></label>
    </div>
    <button class="btn" data-action="add-user">建档</button>
    <p class="fine">实名底档一次建好，配送与安检共用；常用瓶型用于配送落账的快捷行。</p>
  </div>
  ${state.users.length ? `<div class="card"><table class="plain">
    <tr><th>用户</th><th>地址</th><th>在户瓶数</th><th>上次安检</th><th></th></tr>
    ${[...state.users].reverse().map((u) => {
    const balances = Object.keys(CYLINDER_SPECS).map((spec) => ({ spec, n: userBalance(state, u.id, spec) })).filter((x) => x.n !== 0);
    const checks = (state.checks ?? []).filter((c) => c.userId === u.id).sort((a, b) => b.dateISO.localeCompare(a.dateISO));
    const last = checks[0] ?? null;
    const risky = last?.verdict === 'risk';
    return `<tr>
        <td><strong>${esc(u.name)}</strong>${u.phone ? `<div class="basis">${esc(u.phone)}</div>` : ''}</td>
        <td class="fine">${esc(u.addr || '—')}</td>
        <td>${balances.length ? balances.map((x) => `${x.n}×${x.spec}`).join(' ') : '<span class="basis">0 瓶</span>'}</td>
        <td>${last ? `<span class="${risky ? 'issue' : ''}">${esc(last.dateISO)}</span>${risky ? ' <span class="pill issue">隐患</span>' : ''}` : '<span class="issue">从未安检</span>'}</td>
        <td><button class="btn small ghost" data-action="del-user" data-idx="${state.users.indexOf(u)}">删除</button></td>
      </tr>`;
  }).join('')}
  </table><p class="fine">有配送或安检记录的用户不可删除（台账连续性）；在户瓶数 = 送出 − 收回，由流水守恒派生。</p></div>`
    : '<div class="card"><p class="fine">先建档用户，再记配送。</p></div>'}

  <h2 class="sec">🛢️ 钢瓶档案（${(state.cylinders ?? []).length}）</h2>
  <div class="card">
    <div class="form-grid">
      <label>瓶号<input id="cyl-code" placeholder="照瓶身钢印抄" /></label>
      <label>瓶型<select id="cyl-spec">${Object.keys(CYLINDER_SPECS).map((s) => `<option value="${s}">${CYLINDER_SPECS[s].label}</option>`).join('')}</select></label>
      <label class="span2">检验到期日<input type="date" id="cyl-due" value="${addDays(today, 400)}" /></label>
    </div>
    <button class="btn" data-action="add-cylinder">登记</button>
    <p class="fine">检验周期通识口径 48 个月、临期 90 天预警（可在「设置」调整）——超期瓶流转是检查与事故的双重红线，照钢印抄准。</p>
    ${(state.cylinders ?? []).length ? `<table class="plain">
      <tr><th>瓶号</th><th>瓶型</th><th>检验到期</th><th>状态</th><th></th></tr>
      ${state.cylinders.map((c, i) => {
    const left = Math.round((new Date(`${c.checkDueISO}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
    const pill = left < 0 ? '<span class="pill issue">已超期</span>' : left <= 90 ? `<span class="pill warn">${left} 天</span>` : '<span class="pill ok">有效</span>';
    return `<tr><td>${esc(c.code)}</td><td>${CYLINDER_SPECS[c.spec].label}</td><td class="fine">${esc(c.checkDueISO)}</td><td>${pill}</td>
          <td><button class="btn small ghost" data-action="del-cylinder" data-idx="${i}">删除</button></td></tr>`;
  }).join('')}
    </table>` : ''}
  </div>

  <h2 class="sec">🧑‍🔧 员工证件（${(state.workers ?? []).length}）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名<input id="worker-name" placeholder="送气工/安检员" /></label>
      <label>岗位<input id="worker-role" placeholder="如：送气工（选填）" /></label>
      <label class="span2">证件到期日<input type="date" id="worker-cert" value="${addDays(today, 300)}" /></label>
    </div>
    <button class="btn" data-action="add-worker">建档</button>
    <p class="fine">送气工/安检员证件到期前 30 天自动点名，过期即红线；姓名落名在每张安检单上。</p>
    ${(state.workers ?? []).length ? `<table class="plain">
      <tr><th>姓名</th><th>岗位</th><th>证件到期</th><th>状态</th><th></th></tr>
      ${state.workers.map((w, i) => {
    const left = Math.round((new Date(`${w.certExpiryISO}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
    const pill = left < 0 ? '<span class="pill issue">已过期</span>' : left <= 30 ? `<span class="pill warn">${left} 天</span>` : '<span class="pill ok">有效</span>';
    return `<tr><td>${esc(w.name)}</td><td>${esc(w.role || '—')}</td><td class="fine">${esc(w.certExpiryISO)}</td><td>${pill}</td>
          <td><button class="btn small ghost" data-action="del-worker" data-idx="${i}">删除</button></td></tr>`;
  }).join('')}
    </table>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// 配送落账（守恒账）
// ---------------------------------------------------------------------------

export function viewDelivery(state) {
  const today = todayISO();
  const recent = [...(state.deliveries ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 20);
  const specRows = Object.keys(CYLINDER_SPECS).map((spec) => `
    <label class="check-chip">${CYLINDER_SPECS[spec].label}
      送 <input type="number" class="d-full" data-spec="${spec}" min="0" value="0" style="width:52px" />
      收 <input type="number" class="d-empty" data-spec="${spec}" min="0" value="0" style="width:52px" />
    </label>`).join('');
  return `
  <h2 class="sec">🛵 记一笔配送（送出去的是气，账上的是瓶）</h2>
  <div class="card">
    ${state.users.length ? `
    <div class="form-grid">
      <label>用户<select id="d-user">${state.users.map((u) => `<option value="${u.id}">${esc(u.name)}${u.addr ? `（${esc(u.addr)}）` : ''}</option>`).join('')}</select></label>
      <label>日期<input type="date" id="d-date" value="${today}" /></label>
      <label>金额（元，选填）<input type="number" id="d-amount" min="0" placeholder="如 420" /></label>
      <label>备注<input id="d-note" placeholder="选填" /></label>
    </div>
    <p class="basis" style="margin:4px 0">按瓶型填送出/收回（只填动了的瓶型，0 可留）：</p>
    <div class="row wrap">${specRows}</div>
    <button class="btn" data-action="add-delivery" style="margin-top:10px">配送落账</button>
    <p class="fine">在户瓶数 = 送出 − 收回，由流水守恒派生；收回超过在户瓶数会整单拒绝（超收守卫）。金额留空则台账只记瓶数。</p>`
    : '<p class="fine">先在「档案」建档用户。</p>'}
  </div>

  <h2 class="sec">配送台账（最近 ${recent.length} 单）</h2>
  ${recent.length ? `<div class="card"><table class="plain">
    <tr><th>日期</th><th>用户</th><th>明细</th><th>金额</th><th></th></tr>
    ${recent.map((d) => {
    const user = state.users.find((u) => u.id === d.userId);
    const balancesAfter = d.lines.map((ln) => `${ln.spec} 送${ln.full}/收${ln.empty}（在户 ${userBalance(state, d.userId, ln.spec)}）`).join('，');
    return `<tr>
        <td class="fine">${esc(d.dateISO)}</td>
        <td><strong>${esc(user?.name ?? '?')}</strong></td>
        <td class="fine">${esc(balancesAfter)}</td>
        <td>${d.amountCents !== null ? fmtYuan(d.amountCents) : '—'}</td>
        <td><button class="btn small ghost" data-action="undo-delivery" data-idx="${d.id}">撤销</button></td>
      </tr>`;
  }).join('')}
  </table><p class="fine">撤销只删这条流水，在户瓶数自动回滚；若撤销将导致瓶数为负会拒绝（先撤更早的收回）。</p></div>`
    : '<div class="card"><p class="fine">还没有配送记录。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 入户安检（隐患 → 整改 → 复访销案）
// ---------------------------------------------------------------------------

export function viewCheck(state, recheckTarget = null) {
  const today = todayISO();
  const recent = [...(state.checks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 20);
  const target = recheckTarget ? (state.checks ?? []).find((c) => c.id === recheckTarget) : null;
  const targetUser = target ? state.users.find((u) => u.id === target.userId) : null;
  const annual = annualStatus(state, today, state.settings);
  const bad = annual.filter((x) => x.status !== 'ok').slice(0, 10);
  return `
  <h2 class="sec">🔍 入户安检（五项逐检，检完顺手落账）</h2>
  ${target ? `<div class="card alert"><strong>复访模式：${esc(targetUser?.name ?? '')} ${esc(target.dateISO)} 的隐患单</strong>
    <p class="fine" style="margin:4px 0 0">原单整改：${esc(target.measure?.action || '—')}${target.measure?.detail ? `（${esc(target.measure.detail)}）` : ''}。复访合格即销案；仍有隐患则须再次登记整改、接棒未闭环。</p></div>` : ''}
  <div class="card">
    ${state.users.length ? `
    <div class="form-grid">
      <label>用户<select id="c-user">${state.users.map((u) => `<option value="${u.id}" ${targetUser?.id === u.id ? 'selected' : ''}>${esc(u.name)}${u.addr ? `（${esc(u.addr)}）` : ''}</option>`).join('')}</select></label>
      <label>日期<input type="date" id="c-date" value="${today}" /></label>
      <label>检查员<input id="c-checker" placeholder="落名在安检单上" /></label>
      <label class="span2">备注<input id="c-note" placeholder="选填，如：已当面提醒用户" /></label>
    </div>
    <p class="basis" style="margin:4px 0">五项逐项必检（每项：正常 / 隐患 / 不适用）：</p>
    <div class="form-grid">
      ${Object.keys(CHECK_ITEMS).map((k) => `
      <label>${CHECK_ITEMS[k].label}<span class="basis">${esc(CHECK_ITEMS[k].hint)}</span>
        <select class="c-item" data-item="${k}"><option value="ok">正常</option><option value="risk">隐患</option><option value="na">不适用</option></select>
      </label>`).join('')}
    </div>
    <p class="basis" style="margin:4px 0">整改措施（<span class="issue">有隐患必填</span>，全正常可留空）：</p>
    <div class="form-grid">
      <label>措施<select id="c-action"><option value="">—无隐患/未整改—</option><option>限期更换软管</option><option>更换减压阀</option><option>停用超期钢瓶</option><option>移灶通风整改</option><option>停止供气并报告</option><option>其他</option></select></label>
      <label>整改说明<input id="c-detail" placeholder="如：已发告知单，约定三日内更换复访" /></label>
    </div>
    <button class="btn" data-action="add-check" style="margin-top:6px">安检落账${target ? '（复访）' : ''}</button>
    <p class="fine">有隐患必须登记整改措施才能落账——"检了不处置"是事故后责任放大的根源；复访在「今日」看板的未闭环卡片发起。</p>`
    : '<p class="fine">先在「档案」建档用户。</p>'}
  </div>

  ${bad.length ? `<h2 class="sec">📅 年度安检到期名单（先检快到期的）</h2>
  <div class="card"><table class="plain">
    <tr><th>用户</th><th>状态</th><th>上次安检</th></tr>
    ${bad.map((x) => `<tr><td>${esc(x.user?.name ?? '?')}</td>
      <td>${x.status === 'none' ? '<span class="pill issue">从未安检</span>' : x.status === 'overdue' ? `<span class="pill issue">逾期 ${-x.dueIn} 天</span>` : `<span class="pill warn">临期 ${x.dueIn} 天</span>`}</td>
      <td class="fine">${esc(x.lastISO ?? '—')}</td></tr>`).join('')}
  </table><p class="fine">周期默认 365 天（通识口径"每年至少一次"）、临期 30 天——可在「设置」按属地调整。</p></div>` : ''}

  <h2 class="sec">安检台账（最近 ${recent.length} 条）</h2>
  ${recent.length ? `<div class="card"><table class="plain">
    <tr><th>日期</th><th>用户</th><th>结论</th><th></th></tr>
    ${recent.map((c) => {
    const user = state.users.find((u) => u.id === c.userId);
    const refs = (state.checks ?? []).some((x) => x.recheckOf === c.id);
    return `<tr>
        <td class="fine">${esc(c.dateISO)}</td>
        <td><strong>${esc(user?.name ?? '?')}</strong></td>
        <td>${c.verdict === 'ok' ? '<span class="pill ok">正常</span>' : `<span class="pill issue">隐患 · ${esc(c.riskItems.map((k) => CHECK_ITEMS[k].label).join('、'))}</span>${c.measure ? `<div class="basis">整改：${esc(c.measure.action)}</div>` : ''}`}${refs ? '<div class="basis ok">已复访</div>' : c.verdict === 'risk' ? '<div class="basis issue">未闭环</div>' : ''}</td>
        <td>${c.verdict === 'risk' && !refs ? `<button class="btn small" data-action="goto-recheck" data-idx="${c.id}">复访</button>` : ''}
          <button class="btn small ghost" data-action="undo-check" data-idx="${c.id}">撤销</button></td>
      </tr>`;
  }).join('')}
  </table><p class="fine">撤销只删这条流水；被复访引用的隐患单不可撤销（会凭空销案）。</p></div>`
    : '<div class="card"><p class="fine">还没有安检记录。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 台账·出证（告知单 / 台账文本 / 迎检打印包）
// ---------------------------------------------------------------------------

export function viewLedger(state, slipCache = null) {
  if (!state.users?.length) return viewOnboarding();
  const today = todayISO();
  const hasChecks = (state.checks ?? []).length > 0;
  const audit = complianceAudit(state, today);
  const slipBlock = slipCache
    ? `<div class="card"><strong>告知单预览（${esc(slipCache.userName)} · ${esc(slipCache.dateISO)} · ${slipCache.verdict === 'risk' ? '隐患告知单' : '安检回执'}）</strong>
      <pre class="preview">${esc(slipCache.text)}</pre>
      <div class="row"><button class="btn" data-action="slip-copy">📋 复制告知单文本</button>
      <button class="btn ghost" data-action="slip-download">⬇️ 下载告知单（打印签字）</button>
      <button class="btn ghost" data-action="slip-print">🖨️ 直接打印</button></div></div>`
    : '';
  return `
  <h2 class="sec">🧾 隐患告知单 / 安检回执（当场打印签字，微信同步发用户）</h2>
  <div class="card">
    <div class="row">
      <label>选择安检单<select id="slip-check">${(state.checks ?? []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 50).map((c) => `<option value="${c.id}">${esc(c.dateISO)} ${esc(state.users.find((u) => u.id === c.userId)?.name ?? '?')}（${c.verdict === 'risk' ? '隐患' : '正常'}）</option>`).join('')}</select></label>
      <button class="btn" data-action="slip-generate">出单</button>
    </div>
    <p class="fine">隐患单带整改要求、复访约定与签字栏——"我提醒过、他签收了"第一次变成可留存的凭据；告知单是提醒凭据不是责任切割，事故责任认定以司法机关与属地规则为准。</p>
    ${slipBlock}
  </div>

  <h2 class="sec">📒 配送与安检台账</h2>
  <div class="card">
    <div class="row">
      <button class="btn ghost" data-action="ledger-copy-delivery">📋 复制配送台账</button>
      <button class="btn ghost" data-action="ledger-copy-check">📋 复制安检台账</button>
    </div>
    <h2 class="sec" style="margin-top:10px">安检台账预览</h2>
    <pre class="preview">${esc(checkLedgerText({ state, todayISOStr: today, limit: 12 }))}</pre>
    <h2 class="sec" style="margin-top:10px">配送台账预览</h2>
    <pre class="preview">${esc(deliveryLedgerText({ state, todayISOStr: today, limit: 12 }))}</pre>
  </div>

  <h2 class="sec">🖨️ 迎检打印包（单文件 HTML / 直接打印）</h2>
  <div class="card">
    ${hasChecks || (state.deliveries ?? []).length ? `
    <div class="row">
      <button class="btn" data-action="inspection-download">⬇️ 下载迎检打印包</button>
      <button class="btn ghost" data-action="inspection-print">🖨️ 直接打印</button>
    </div>
    <p class="fine">包含：站点与许可证号 · 体检结论（未闭环/到期/断更/守恒）· 入户安检台账（闭环列）· 配送台账（守恒体检）· 年度安检到期点名 · 钢瓶检验台账 · 员工证件。单文件 HTML，微信传给家里电脑打印也行。</p>`
    : '<p class="fine">先有配送或安检记录，打印包才有内容。</p>'}
    <p class="fine" style="margin-top:8px">当前体检：未闭环隐患 <strong>${audit.openRisks.length}</strong> · 年度安检问题 <strong>${audit.annualProblems.length}</strong> 户 · 钢瓶超期 <strong>${audit.cylinders.overdue.length}</strong> · 证件过期 <strong>${audit.certs.expired.length}</strong> · 断更 <strong>${audit.missingDates.length}</strong> 天——打印前先自扫一遍，别让检查员先发现。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置（站点 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const station = state.station ?? {};
  const params = paramsOf(state.settings);
  const cons = conservation(state);
  return `
  <h2 class="sec">🏪 供应站档案（印在告知单与台账上）</h2>
  <div class="card">
    <div class="form-grid">
      <label>站点名称<input id="station-name" value="${esc(station.name ?? '')}" placeholder="如：红旗液化气供应站" /></label>
      <label>燃气经营许可证号<input id="station-license" value="${esc(station.licenseNo ?? '')}" placeholder="如：燃（2026）第0101号" /></label>
      <label>联系电话<input id="station-phone" value="${esc(station.phone ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-station">保存</button>
    <p class="fine">瓶装液化气经营须取得燃气经营许可证（条例口径）；许可证号印在告知单与台账上，监管者与用户都看得到。</p>
  </div>

  <h2 class="sec">🔔 周期参数</h2>
  <div class="card">
    <div class="form-grid">
      <label>年度安检周期（天）<input type="number" id="set-annual" min="30" max="730" value="${params.annualCheckDays}" /></label>
      <label>安检临期窗（天）<input type="number" id="set-nearannual" min="7" max="180" value="${params.nearAnnualDays}" /></label>
      <label>钢瓶检验周期（月）<input type="number" id="set-cylcycle" min="12" max="96" value="${params.cylinderCycleMonths}" /></label>
      <label>钢瓶预警窗（天）<input type="number" id="set-cylwarn" min="15" max="365" value="${params.cylinderWarnDays}" /></label>
      <label>证件预警窗（天）<input type="number" id="set-cert" min="7" max="180" value="${params.certWarnDays}" /></label>
      <label>断更体检回看（天）<input type="number" id="set-window" min="7" max="120" value="${params.checkWindowDays}" /></label>
    </div>
    <button class="btn" data-action="save-params">保存参数</button>
    <p class="fine">年度安检 365 天、钢瓶检验 48 个月、预警窗 30/90 天均为行业通识默认值——以条例原文与属地燃气管理部门要求为准，你的属地口径永远赢。</p>
  </div>

  <h2 class="sec">🔍 守恒与体检</h2>
  <div class="card">
    <p class="fine" style="margin-bottom:6px">守恒体检：净送出 <strong>${cons.fullOut}</strong> 瓶 ＝ 在户瓶数合计 <strong>${cons.balances}</strong> 瓶${cons.residual === 0 ? '（残差 0，账实一致 ✅）' : `（<span class="issue">残差 ${cons.residual}，请核查</span>）`}；合规自查：未闭环隐患、年度安检到期、钢瓶检验、员工证件、断更日五查在「今日」与打印包常亮。</p>
    <p class="fine">台账体检在每次进入「今日」与出证时自动运行——迎检前先自扫一遍，别让检查员先发现。</p>
  </div>

  <h2 class="sec">⚙️ 数据与备份（交接即盘点）</h2>
  <div class="card">
    <p class="fine" style="margin-top:0">数据仅存于本机浏览器。换手机/给合伙人备份/网点移交：导出 JSON 文件，到目标设备导入——用户底档 + 在户瓶数 + 未闭环隐患清单整体带走，接手即盘点。本地事件流（使用埋点）可单独导出，用于产品验证。</p>
    <div class="row">
      <button class="btn block" data-action="export-json">⬇️ 导出备份</button>
      <label class="btn ghost block" style="line-height:2.4">
        ⬆️ 导入备份<input type="file" id="import-file" accept=".json" hidden />
      </label>
      <button class="btn ghost block" data-action="export-events">📈 导出使用记录</button>
    </div>
  </div>`;
}
