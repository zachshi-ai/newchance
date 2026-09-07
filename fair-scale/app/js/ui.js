/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  DEVIATION_TABLE, RECHECK_METHOD, SCALE_ROLE, SCALE_STATUS, SCALE_CHANGES, CARD_META,
  DUTY_KINDS, COMPLAINT_STATUS,
  scaleClock, scaleLedgerGaps, fairDailyLevel, patrolState, dutyBoard, healthCheck,
  monthlySummary, complaintOverdue, unrecovered, activeCards,
  negativeDeviation, compensation55,
  escapeHtml, todayISO, addDays,
} from './core.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// 内联 SVG 图标（stroke: currentColor；零依赖、随主题变色）
// ---------------------------------------------------------------------------

const IC = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  board: IC('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  scale: IC('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M7.5 9v3M16.5 9v3"/><rect x="5" y="12" width="6" height="4.5" rx="1"/><rect x="13" y="12" width="6" height="4.5" rx="1"/><path d="M9 20h6"/><path d="M12 16.5V20"/>'),
  balance: IC('<path d="M12 4v15"/><path d="M8 20h8"/><path d="M5 7h14"/><path d="M5 7l-2.5 5.5a3.2 3.2 0 0 0 5 0z"/><path d="M19 7l-2.5 5.5a3.2 3.2 0 0 0 5 0z"/>'),
  patrol: IC('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/><path d="M8 11h6M11 8v6"/>'),
  flag: IC('<path d="M6 21V4"/><path d="M6 4h11l-2.5 3.5L17 11H6"/>'),
  chat: IC('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  hazard: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  copy: IC('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5v-1a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" transform="translate(1.5 1.5) scale(.92)"/>'),
  shield: IC('<path d="M12 3.5 19 6v6c0 4.2-2.9 7.2-7 8.5-4.1-1.3-7-4.3-7-8.5V6z"/><path d="M9 11.8l2.2 2.2L15.5 9.5"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { expired: 'bad', red: 'bad', warn: 'warn', ok: 'ok' };
const LEVEL_TEXT = { expired: '已过期', red: '告急', warn: '临期', ok: '正常' };

export function pill(level, text) {
  const cls = LEVEL_PILL[level] ?? 'ok';
  return `<span class="pill ${cls}">${text ?? LEVEL_TEXT[level] ?? level}</span>`;
}

/** 体检分计分环 */
export function scoreRing(score, small = false) {
  const tone = score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'bad';
  return `<div class="ring ${tone} ${small ? 'small' : ''}" role="img" aria-label="体检得分 ${score}">
    <svg viewBox="0 0 44 44"><circle class="ring-bg" cx="22" cy="22" r="18"/>
    <circle class="ring-fg" cx="22" cy="22" r="18" stroke-dasharray="${(score * 1.13).toFixed(1)} 113"/>
    <text x="22" y="26" text-anchor="middle">${score}</text></svg></div>`;
}

/* ------------------------------------------------------------- 空态引导 */

export function viewOnboarding() {
  return `
  <section class="hero card">
    <h2>鬼秤整治高压期，主办者的账要能当场翻给检查看</h2>
    <p>《集贸市场计量监督管理办法》（总局令第94号，<b>2025-03-01 施行</b>，废止 2002 旧办法）把集市主办者推到第一责任位：<b>九项义务</b>（第5条）——计量管理制度、核验公示经营者、入场协议约定计量违约责任、专兼职计量管理员、强检器具<b>登记造册并向市监部门备案</b>、<b>公平秤</b>设置保管、发现作弊<b>制止且不得包庇纵容</b>、诚信计量承诺、计量纠纷及时处理；对商户有<b>红黄牌警示直至清退</b>（第7条）。罚则三档：<b>未制止作弊处 5 万元以下、情节严重 10 万元以下</b>（第13条）；短秤缺量消费者可向主办者要赔偿、<b>主办者先赔后向商户追偿</b>（第12条），作弊秤欺诈按消保法第55条<b>退一赔三、不足 500 按 500</b>。秤平账把这本账变成白箱：一秤一档强检钟 → 公平秤按日核账 → 巡查红黄牌 → 复秤判差赔三倍 → 一键出迎检自证包。</p>
    <ol class="onboard">
      <li>「设置」里保存市场信息与计量管理员（第5条(四)）</li>
      <li>「秤档」一秤一档登记造册——强检钟自动开走（周期默认 12 个月）</li>
      <li>「公平秤」配置并按日核账；「巡查」记周期巡查；发现问题开「牌榜」红黄牌</li>
      <li>消费者投诉进「投诉」：受理 → 公平秤复核（自动判负偏差、算退一赔三）→ 处置/先行赔偿 → 追偿闭环</li>
    </ol>
    <div class="row"><a class="btn" href="#/settings">从市场信息开始</a> <a class="btn ghost" href="#/reports">先看示例账</a></div>
  </section>`;
}

/* ------------------------------------------------------------- 看板 */

export function viewBoard(state, todayISOStr = todayISO()) {
  if (!state.scales.length) return viewOnboarding();
  const s = state.settings;
  const hc = healthCheck(state, todayISOStr);
  const activeScales = state.scales.filter((x) => x.status === 'active');
  const redScales = activeScales.filter((x) => {
    const c = scaleClock(x, todayISOStr, s);
    return c.level === 'expired' || c.level === 'red';
  });
  const gapScales = activeScales.filter((x) => scaleLedgerGaps(x).length);
  const fair = fairDailyLevel(state, todayISOStr);
  const patrol = patrolState(state, todayISOStr, s);
  const openComplaints = state.complaints.filter((c) => !['recovered', 'dismissed', 'closed'].includes(c.status));
  const overdueComplaints = openComplaints.filter((c) => complaintOverdue(c, todayISOStr, s));
  const adv = unrecovered(state);
  const redCards = activeCards(state, 'red');
  const yellowCards = activeCards(state, 'yellow');
  const overdueDuties = dutyBoard(state, todayISOStr).filter((d) => d.level === 'expired');

  const todo = [];
  if (redScales.length) todo.push(`<b>${redScales.length}</b> 杆秤强检超期/告急——超期秤不得继续使用（第9条(三)），立即安排送检 → <a href="#/scales">去秤档</a>`);
  if (fair.level === 'red') todo.push(`公平秤红灯：${esc(fair.detail)} → <a href="#/fair">去公平秤</a>`);
  else if (fair.level === 'warn') todo.push(`公平秤今日未核账 → <a href="#/fair">去公平秤</a>`);
  if (patrol.level === 'red') todo.push(`场内巡查超期（${esc(patrol.detail)}）→ <a href="#/patrol">去巡查</a>`);
  if (overdueComplaints.length) todo.push(`<b>${overdueComplaints.length}</b> 件投诉超处置时限（第5条(九)及时处理）→ <a href="#/complaints">去投诉</a>`);
  else if (openComplaints.length) todo.push(`<b>${openComplaints.length}</b> 件投诉在途 → <a href="#/complaints">去投诉</a>`);
  if (adv.length) todo.push(`<b>${adv.length}</b> 笔先行赔偿未追偿——赔了要追回来（第12条）→ <a href="#/complaints">去投诉</a>`);
  if (redCards.length) todo.push(`<b>${redCards.length}</b> 张红牌在册（第7条公示+违约追责）→ <a href="#/cards">去牌榜</a>`);
  if (overdueDuties.length) todo.push(`登记 <b>${overdueDuties.length}</b> 项到期义务 → <a href="#/duties">去义务</a>`);
  if (gapScales.length) todo.push(`<b>${gapScales.length}</b> 杆秤登记缺项（证书号/强检标志）→ <a href="#/scales">去秤档</a>`);
  if (fair.level === 'ok' && patrol.level === 'ok' && !todo.length) todo.push(``,);
  if (!todo.length) todo.push('九灯全绿：秤秤有钟、公平秤日日核、巡查不欠、投诉不积、赔了必追。',);

  return `
  <section class="hero card dark">
    <div class="hero-l">
      <h2>今日计量台</h2>
      <p class="sub">${esc(state.org?.name || '未登记市场')} · ${todayISOStr} · 在用秤 ${activeScales.length} 杆（含公平秤 ${activeScales.filter((x) => x.role === 'fair').length} 台）· 黄牌 ${yellowCards.length} 张</p>
      <ul class="redlist">
        ${todo.map((t) => `<li>${t}</li>`).join('')}
      </ul>
    </div>
    ${scoreRing(hc.score)}
  </section>

  <div class="grid2">
    <section class="card">
      <h3>${icon('scale')} 强检钟点名（红/临期）</h3>
      ${(() => {
        const rows = activeScales.map((x) => ({ x, c: scaleClock(x, todayISOStr, s) }))
          .filter((e) => e.c.level !== 'ok')
          .slice(0, 6);
        const tag = (e) => {
          if (e.c.missing) return '无检定记录';
          if (e.c.level === 'expired') return '已超期';
          if (e.c.level === 'red') return `剩 ${e.c.days} 天`;
          return String(e.c.detail || '').includes('标志') ? '标志未确认' : `剩 ${e.c.days} 天`;
        };
        return rows.length ? rows.map((e) => `<div class="item">${pill(e.c.level, tag(e))} <b>${esc(e.x.stall)}</b> · ${esc(e.x.vendor || '公平秤')} <span class="basis">${esc(e.c.basis)}</span></div>`).join('') : '<p class="dim">全市场强检钟全绿。</p>';
      })()}
      <div class="row"><a class="btn small ghost" href="#/scales">一秤一档</a></div>
    </section>
    <section class="card">
      <h3>${icon('balance')} 公平秤与巡查</h3>
      <div class="item">${pill(fair.level, fair.level === 'ok' ? '今日已核' : fair.level === 'warn' ? '今日未核' : '中断')} ${esc(fair.detail)}</div>
      <div class="item">${pill(patrol.level, patrol.level === 'red' ? '超期' : patrol.level === 'warn' ? '临周期' : '正常')} ${esc(patrol.detail)}</div>
      <div class="row"><a class="btn small ghost" href="#/fair">公平秤</a> <a class="btn small ghost" href="#/patrol">巡查账</a></div>
    </section>
    <section class="card">
      <h3>${icon('chat')} 投诉与先行赔偿（第12条）</h3>
      ${openComplaints.length ? openComplaints.slice(0, 4).map((c) => `<div class="item">${pill(complaintOverdue(c, todayISOStr, s) ? 'expired' : 'warn', COMPLAINT_STATUS[c.status])} ${esc(c.dateISO)} · ${esc(c.stall)}${c.verify ? ` · ${c.verdict === 'excess' ? '<b>超差</b>' : '未超差'}` : ''}</div>`).join('') : '<p class="dim">在途无投诉。</p>'}
      ${adv.length ? adv.map((c) => `<div class="item">${pill('red', '待追偿')} ${esc(c.stall)} · 先赔 ¥${c.compensation ? c.compensation.total : '—'}</div>`).join('') : ''}
      <div class="row"><a class="btn small ghost" href="#/complaints">投诉台账</a></div>
    </section>
    <section class="card">
      <h3>${icon('flag')} 牌榜与义务</h3>
      ${[...redCards, ...yellowCards].slice(0, 4).map((c) => `<div class="item">${pill(c.color === 'red' ? 'red' : 'warn', c.color === 'red' ? '红牌' : '黄牌')} ${esc(c.stall)} · ${esc(c.reason)}</div>`).join('') || '<p class="dim">在册无红黄牌。</p>'}
      ${overdueDuties.map((d) => `<div class="item">${pill('expired', '逾期')} ${esc(d.label)}</div>`).join('')}
      <div class="row"><a class="btn small ghost" href="#/cards">牌榜</a> <a class="btn small ghost" href="#/duties">义务账</a></div>
    </section>
  </div>`;
}

/* ------------------------------------------------------------- 秤档（一秤一档） */

function scaleForm() {
  return `
  <section class="card">
    <h3>${icon('scale')} 建档（办法第5条(五)：登记造册、向市监部门备案）</h3>
    <div class="formgrid">
      <label>器具角色<select id="sc-role">
        <option value="trade">场内经营用秤（贸易结算 · 强检）</option>
        <option value="fair">公平秤（公平复核 · 强检）</option>
      </select></label>
      <label>摊位号 *<input id="sc-stall" placeholder="例：12 号·水产；公平秤填「公平秤·主入口服务台」" /></label>
      <label>经营者（经营秤必填，第5条(一)核验公示）<input id="sc-vendor" placeholder="例：王水产" /></label>
      <label>联系电话<input id="sc-vendorphone" placeholder="选填" /></label>
      <label>器具类型<input id="sc-type" value="电子计价秤" /></label>
      <label>品牌 / 型号<input id="sc-brand" placeholder="例：友声 ACS-30" /></label>
      <label>量程（kg）<input id="sc-capacity" type="number" min="0" step="0.1" placeholder="例：30" /></label>
      <label>分度值（g）<input id="sc-division" type="number" min="0" step="0.1" placeholder="例：5" /></label>
      <label>检定证书号<input id="sc-certno" placeholder="例：JS2025-0088123" /></label>
      <label>最近检定日期<input id="sc-verified" type="date" /></label>
      <label class="chk"><input type="checkbox" id="sc-sticker" /> 强检合格标志已确认粘贴</label>
      <label class="wide">备注<input id="sc-note" placeholder="新换秤、待送检等" /></label>
    </div>
    <p class="basis">保存后强检钟自动开走：到期日 = 最近检定日 + 检定周期（默认 12 个月，JJG 539-2016 口径，属地要求可在「设置」覆盖）。未经检定合格、超过检定周期的秤不得使用（第9条(三)；细则第43条：责令停止使用+1000元以下罚款）。</p>
    <div class="row"><button class="btn" data-action="add-scale">登记造册</button></div>
  </section>`;
}

export function viewScales(state, todayISOStr = todayISO()) {
  const s = state.settings;
  const rows = state.scales.map((x) => {
    const c = scaleClock(x, todayISOStr, s);
    const gaps = scaleLedgerGaps(x);
    const actions = [];
    if (x.status === 'active') actions.push(`<button class="btn small ghost" data-action="show-change-scale" data-idx="${x.id}">变动报备</button>`);
    if (x.status === 'suspended') actions.push(`<button class="btn small" data-action="show-resume-scale" data-idx="${x.id}">重新检定后恢复</button>`);
    return `<tr class="${c.level === 'expired' || c.level === 'red' ? 'stale' : ''}">
      <td><b>${esc(x.stall)}</b><br><span class="dim">${esc(x.vendor || (x.role === 'fair' ? '公平复核' : ''))}</span></td>
      <td>${esc(x.type)}${x.brand ? `<br><span class="dim">${esc(x.brand)} ${esc(x.model)}${x.capacityKg ? ` · ${esc(x.capacityKg)}kg/${esc(x.divisionG)}g` : ''}</span>` : ''}</td>
      <td>${x.certNo ? esc(x.certNo) : '<span class="warn">缺证书号</span>'}<br><span class="dim">${x.verifiedISO ? `${esc(x.verifiedISO)} 检定` : '<span class="warn">无检定记录</span>'}</span></td>
      <td>${c.missing ? pill('expired', '不得使用') : `${esc(c.dueISO)} ${pill(c.level, LEVEL_TEXT[c.level])}`}${gaps.length ? `<br><span class="basis warn">${esc(gaps.join(' · '))}</span>` : ''}</td>
      <td>${pill('ok', SCALE_STATUS[x.status])}</td>
      <td>${actions.join(' ')}</td></tr>`;
  }).join('');
  const changeRows = [...state.changes].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 10).map((ch) => {
    const x = state.scales.find((y) => y.id === ch.scaleId);
    return `<div class="item"><span class="pill ok">${esc(SCALE_CHANGES[ch.change])}</span> ${esc(ch.dateISO)} · ${esc(x ? `${x.stall}·${x.type}` : ch.scaleId)}${ch.note ? ` · ${esc(ch.note)}` : ''}</div>`;
  }).join('');

  return `
  <section class="card">
    <h3>${icon('scale')} 一秤一档 · 强检计量器具登记造册（第5条(五)——本表即备案底稿）</h3>
    ${rows ? `<table class="tbl"><thead><tr><th>摊位 / 经营者</th><th>器具</th><th>检定证书 / 检定日</th><th>强检钟（到期日+状态）</th><th>状态</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="dim">还没有登记器具。每一杆秤都要登记造册并向当地市场监管部门备案；新增、减少、更换、维修要「及时更新」——变动就用「变动报备」。</p>'}
  </section>
  ${changeRows ? `<section class="card"><h3>${icon('check')} 最近变动报备（第9条(二)：新增/减少/更换/维修及时更新）</h3>${changeRows}</section>` : ''}
  ${scaleForm()}`;
}

/* ------------------------------------------------------------- 公平秤 */

export function viewFair(state, todayISOStr = todayISO()) {
  const s = state.settings;
  const fairScales = state.scales.filter((x) => x.role === 'fair');
  const level = fairDailyLevel(state, todayISOStr);
  const rows = fairScales.map((x) => {
    const c = scaleClock(x, todayISOStr, s);
    const last = state.fairLogs.filter((q) => q.scaleId === x.id).sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];
    return `<div class="item head"><b>${esc(x.stall)}</b><span class="dim">${esc(x.type)}${x.certNo ? ` · ${esc(x.certNo)}` : ''} · 强检至 ${esc(c.dueISO || '—')}</span>
      <span class="grow"></span>${pill(c.level, LEVEL_TEXT[c.level])}
      <button class="btn small" data-action="show-fair-check" data-idx="${x.id}">记今日核查</button></div>
      ${last ? `<div class="item dim">最近核查 ${esc(last.dateISO)}：${last.ok ? '砝码试核正常' : `<span class="warnline">异常——${esc(last.note || '已处置')}</span>`}</div>` : '<div class="item dim">从未核查</div>'}`;
  }).join('');
  const logs = [...state.fairLogs].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 14).map((q) => {
    const x = state.scales.find((y) => y.id === q.scaleId);
    return `<tr><td>${esc(q.dateISO)}</td><td>${esc(x ? x.stall : q.scaleId)}</td><td>${q.ok ? pill('ok', '正常') : pill('red', '异常')}</td><td>${esc(q.note || '—')}</td></tr>`;
  }).join('');

  return `
  <section class="card">
    <h3>${icon('balance')} 公平秤（第5条(六)：合理设置、显著便捷位置、标识，保管维护+监督检查）</h3>
    <div class="item">${pill(level.level, level.level === 'ok' ? '今日已核' : level.level === 'warn' ? '今日未核' : '中断')} ${esc(level.detail)}</div>
    ${rows || `<p class="dim">尚未配置公平秤——先到 <a href="#/scales">秤档</a> 以「公平秤」角色登记（也属强检器具，同样一年一检）。</p>`}
  </section>
  <section class="card">
    <h3>${icon('check')} 按日核账（公平复核量值准，投诉复秤才有公信力）</h3>
    ${logs ? `<table class="tbl"><thead><tr><th>日期</th><th>公平秤</th><th>核查</th><th>备注</th></tr></thead><tbody>${logs}</tbody></table>` : '<p class="dim">暂无核查记录。</p>'}
  </section>`;
}

/* ------------------------------------------------------------- 巡查 */

export function viewPatrol(state, todayISOStr = todayISO()) {
  const s = state.settings;
  const ps = patrolState(state, todayISOStr, s);
  const rows = [...state.patrols].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20).map((p) => `<tr><td>${esc(p.dateISO)}</td><td>${p.stallsChecked} 摊次</td>
    <td>${p.finds.length ? p.finds.map((f) => `<b>${esc(f.stall)}</b>：${esc(f.problem)}${f.measure ? `<br><span class="basis">处置：${esc(f.measure)}</span>` : ''}`).join('<br>') : '未发现问题'}</td>
    <td>${esc(p.note || '—')}</td></tr>`).join('');
  return `
  <section class="card">
    <h3>${icon('patrol')} 场内计量巡查（第5条(七)：发现作弊制止、不得包庇纵容——查按键密码/垫泡沫/示值比对公平秤）</h3>
    <div class="item">${pill(ps.level, ps.level === 'red' ? '超期' : ps.level === 'warn' ? '临周期' : '正常')} ${esc(ps.detail)} <span class="basis">周期 ${esc(s.patrolDays)} 天（工具口径，属地永远赢）</span></div>
    ${rows ? `<table class="tbl"><thead><tr><th>日期</th><th>覆盖</th><th>发现问题与处置</th><th>备注</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="dim">暂无巡查记录。</p>'}
  </section>
  <section class="card">
    <h3>记一次巡查</h3>
    <div class="formgrid">
      <label>巡查日期<input id="pt-date" type="date" value="${todayISOStr}" /></label>
      <label>覆盖摊位数<input id="pt-stalls" type="number" min="0" placeholder="例：12" /></label>
      <label>发现问题摊位（无则留空）<input id="pt-fstall" placeholder="例：31 号·活鱼" /></label>
      <label>问题（无则留空）<input id="pt-fproblem" placeholder="例：秤下垫泡沫垫/按键有密码" /></label>
      <label class="wide">当场处置（有发现建议填写）<input id="pt-fmeasure" placeholder="例：当场责令撤除并复查；严重的转牌榜/报市监" /></label>
      <label class="wide">备注<input id="pt-note" placeholder="例：周二例行巡查" /></label>
    </div>
    <div class="row"><button class="btn" data-action="log-patrol">登记巡查</button></div>
  </section>`;
}

/* ------------------------------------------------------------- 牌榜 */

export function viewCards(state, todayISOStr = todayISO()) {
  const rows = [...state.cards].sort((a, b) => b.issuedISO.localeCompare(a.issuedISO)).map((c) => `<tr>
    <td>${esc(c.issuedISO)}</td><td><b>${esc(c.stall)}</b>${c.vendor ? `<br><span class="dim">${esc(c.vendor)}</span>` : ''}</td>
    <td>${c.color === 'red' ? pill('red', '红牌') : pill('warn', '黄牌')} ${esc(c.reason)}</td>
    <td>${c.status === 'lifted' ? pill('ok', `${esc(c.liftedISO)} 摘牌`) : pill(c.color === 'red' ? 'red' : 'warn', '在牌')}</td>
    <td>${c.status !== 'lifted' ? `<button class="btn small ghost" data-action="show-lift-card" data-idx="${c.id}">摘牌</button>` : ''}</td></tr>`).join('');
  return `
  <section class="card">
    <h3>${icon('flag')} 红黄牌警示（第7条：违法失信公示；计量失准拒不整改可按约定追责直至清退）</h3>
    ${rows ? `<table class="tbl"><thead><tr><th>出具日</th><th>摊位</th><th>事由（公示要能对上）</th><th>状态</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="dim">在册无红黄牌。</p>'}
  </section>
  <section class="card">
    <h3>出具红黄牌</h3>
    <div class="formgrid">
      <label>摊位号 *<input id="cd-stall" placeholder="例：31 号·活鱼" /></label>
      <label>经营者<input id="cd-vendor" placeholder="选填" /></label>
      <label>牌色<select id="cd-color"><option value="yellow">黄牌警示（公示）</option><option value="red">红牌（整改/报市场监管部门）</option></select></label>
      <label class="wide">事由 *<input id="cd-reason" placeholder="例：复核短秤超差 + 秤下垫物" /></label>
      <label class="wide">备注<input id="cd-note" placeholder="例：公示三日，整改验收后摘牌" /></label>
    </div>
    <div class="row"><button class="btn" data-action="issue-card">出具</button></div>
  </section>`;
}

/* ------------------------------------------------------------- 投诉（第12条） */

function complaintBody(c, todayISOStr) {
  const v = c.verify;
  const overdue = complaintOverdue(c, todayISOStr);
  const head = `<div class="item head"><b>${esc(c.dateISO)} · ${esc(c.stall)}</b>
    <span class="dim">${esc(c.vendor || '')}${c.commodity ? ` · ${esc(c.commodity)}` : ''} · ${esc(DEVIATION_TABLE[c.band].label.split('，')[0].split('或')[0])}${c.settleKg ? ` · 结算 ${esc(c.settleKg)}kg` : ''}</span>
    <span class="grow"></span>
    ${pill(['recovered', 'dismissed', 'closed'].includes(c.status) ? 'ok' : overdue ? 'expired' : 'warn', COMPLAINT_STATUS[c.status] || c.status)}</div>`;
  const detail = v ? `
    <div class="step done">
      <p class="steptitle"><b>公平秤复核</b>（${esc(v.methodLabel)}）：结算 ${v.settleKg}kg → 实际 ${v.actualKg}kg，差
      <b>${v.diffG > 0 ? '+' : ''}${v.diffG}g</b> / 允差 ${v.allowedG}g（负偏差 ${v.limitG}g${v.multiplier > 1 ? '×2 等准确度核称' : ''}）
      → ${v.excess ? '<b class="warnline">短秤缺量超差（第12条）</b>' : '未超法定负偏差'}</p>
      ${c.compensation ? `<p class="basis">消保法第55条测算：价款 ¥${c.compensation.pricePaid} + 退还差价 ¥${c.compensation.refundDiff} + 惩罚性赔偿 <b>¥${c.compensation.punitive}</b>（三倍，不足 500 按 500）= <b>¥${c.compensation.total}</b>（以有权机关认定为准）</p>` : ''}
      ${c.status === 'received' ? '' : ''}
    </div>` : '';
  const steps = [];
  if (c.status === 'received') {
    steps.push(`<div class="step"><p class="steptitle"><b>第一步 · 公平秤复核</b>（第12条：保持原状复核；有异议重新计量过程）</p>
      <div class="formgrid">
        <label>复核实际重量（kg）*<input id="ck-actual-${c.id}" type="number" min="0" step="0.001" placeholder="例：1.95" /></label>
        <label>核称法<select id="ck-method-${c.id}"><option value="same">原器具/高准确度核称（允差=负偏差）</option><option value="equal">等准确度核称（允差=负偏差×2）</option></select></label>
        <label>单价（元/kg，用于 55 条测算）<input id="ck-price-${c.id}" type="number" min="0" step="0.01" placeholder="例：96" /></label>
      </div>
      <div class="row"><button class="btn" data-action="recheck-complaint" data-idx="${c.id}">判定并测算</button></div></div>`);
  }
  if (c.status === 'weighed') {
    steps.push(c.verdict === 'excess'
      ? `<div class="step"><p class="steptitle"><b>第二步 · 处置</b>（短秤缺量坐实：经营者退赔，或主办者先行赔偿后追偿）</p>
        <div class="formgrid">
          <label>处置方式<select id="rs-mode-${c.id}"><option value="refund">经营者当场退赔（退差价+赔偿）</option><option value="advance">主办者先行赔偿（第12条：经营者撤场/拒不配合等）</option></select></label>
          <label class="wide">处置措施 *<input id="rs-measure-${c.id}" placeholder="例：现场退赔 ¥503.6 并黄牌警示" /></label>
        </div>
        <div class="row"><button class="btn" data-action="resolve-complaint" data-idx="${c.id}">登记处置</button></div></div>`
      : `<div class="step"><p class="steptitle"><b>第二步 · 解释结案</b>（复核未超差：向消费者演示负偏差标准并留痕）</p>
        <div class="formgrid"><label class="wide">解释说明 *<input id="rs-measure-${c.id}" placeholder="例：现场演示附表1标准，差值在允差内" /></label></div>
        <div class="row"><button class="btn" data-action="resolve-complaint" data-idx="${c.id}">登记解释结案</button></div></div>`);
  }
  if (c.status === 'advanced') {
    steps.push(`<div class="step"><p class="steptitle"><b>第三步 · 追偿</b>（第12条：主办者赔偿后有权向经营者追偿）${c.compensation ? `——先赔金额 ¥${c.compensation.total}` : ''}</p>
      <div class="row"><button class="btn" data-action="show-recover-complaint" data-idx="${c.id}">登记已追偿</button></div></div>`);
  }
  if (['resolved', 'dismissed'].includes(c.status)) {
    steps.push(`<div class="step"><p class="steptitle"><b>闭环</b>（${esc(c.measure || '')}）</p>
      <div class="row"><button class="btn" data-action="close-complaint" data-idx="${c.id}">确认闭环</button></div></div>`);
  }
  if (['recovered', 'closed'].includes(c.status)) {
    steps.push(`<div class="step done"><p class="steptitle">✅ ${esc(COMPLAINT_STATUS[c.status])}${c.resolvedISO ? ` · 处置 ${esc(c.resolvedISO)}` : ''}${c.recoveredISO ? ` · 追偿到账 ${esc(c.recoveredISO)}` : ''}${c.closedISO ? ` · 闭环 ${esc(c.closedISO)}` : ''}</p></div>`);
  }
  return `${head}${detail}${steps.join('')}`;
}

export function viewComplaints(state, todayISOStr = todayISO()) {
  const cards = [...state.complaints].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `
    <div class="card complaintcard">
      ${complaintBody(c, todayISOStr)}
      <div class="row">
        ${c.verify ? `<button class="btn small ghost" data-action="print-recheck-sheet" data-idx="${c.id}">${icon('print')} 打印复秤处置单</button>` : ''}
      </div>
    </div>`).join('');
  const bandOptions = Object.entries(DEVIATION_TABLE).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  return `
  ${cards ? cards : `<section class="card"><p class="dim">暂无投诉。消费者对秤有异议时：保持商品原状 → 公平秤复核 → 本页受理登记。</p></section>`}
  <section class="card">
    <h3>${icon('chat')} 受理投诉（第12条：短秤缺量→向经营者索赔；租赁期满等→主办者先赔后追偿；作弊秤欺诈→消保法第55条）</h3>
    <div class="formgrid">
      <label>受理日期<input id="cp-date" type="date" value="${todayISOStr}" /></label>
      <label>被投诉摊位 *<input id="cp-stall" placeholder="例：31 号·活鱼" /></label>
      <label>经营者<input id="cp-vendor" placeholder="选填" /></label>
      <label>商品<input id="cp-commodity" placeholder="例：草鱼" /></label>
      <label>价格档 *<select id="cp-band">${bandOptions}</select></label>
      <label>单价（元/kg）<input id="cp-price" type="number" min="0" step="0.01" placeholder="例：12" /></label>
      <label>结算重量（kg）<input id="cp-settle" type="number" min="0" step="0.001" placeholder="例：3" /></label>
      <label class="wide">备注<input id="cp-note" placeholder="消费者诉求描述" /></label>
    </div>
    <p class="basis">价格档决定法定负偏差（附表1：粮果蔬≤6元/kg 档 1kg 内允 20g；肉蛋水产 6~30 元/kg 档 2.5kg 内允 5g；30~100 元/kg 档 1kg 内允 2g；>100 元/kg 档 500g 内允 1g。活禽、活鱼、水发物除外）。</p>
    <div class="row"><button class="btn" data-action="create-complaint">受理登记</button></div>
  </section>`;
}

/* ------------------------------------------------------------- 义务 */

export function viewDuties(state, todayISOStr = todayISO()) {
  const rows = dutyBoard(state, todayISOStr).map((d) => `
    <div class="item duty">
      <div><b>${esc(d.label)}</b><br><span class="basis">${esc(d.basis)}</span></div>
      <div class="grow"></div>
      <div class="dutywhen">${d.lastDoneISO ? `${esc(d.lastDoneISO)}<br>→ ${esc(d.dueISO)}${d.days !== null ? `（${d.days < 0 ? `逾期 ${-d.days} 天` : `剩 ${d.days} 天`}）` : ''}` : '<span class="warnline">从未登记</span>'}</div>
      ${pill(d.level)}
      <button class="btn small" data-action="show-set-duty" data-idx="${d.kind}">登记完成</button>
    </div>`).join('');
  return `
  <section class="card">
    <h3>${icon('clock')} 周期义务账（办法第5条义务的节奏化，「及时」口径参数化，属地永远赢）</h3>
    ${rows}
  </section>`;
}

/* ------------------------------------------------------------- 出证 */

export function viewReports(state, repMonth = null, cached = null, todayISOStr = todayISO()) {
  const month = repMonth || todayISOStr.slice(0, 7);
  const sheets = state.complaints.filter((c) => c.verify).sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 10);
  return `
  <section class="card">
    <h3>${icon('reports')} 月度小结（微信文本）</h3>
    <div class="row"><label>月份 <input id="rep-month" type="month" value="${month}" /></label>
      <button class="btn" data-action="rep-gen">生成</button>
      <button class="btn ghost" data-action="rep-copy">${icon('copy')} 复制</button>
      <button class="btn ghost" data-action="rep-download">${icon('dl')} 下载</button></div>
    <pre id="rep-text" class="reptext">${esc(cached ?? '(点「生成」汇总本月台账)')}</pre>
  </section>
  <section class="card">
    <h3>${icon('shield')} 迎检自证包（单文件 HTML · 含盖章签字栏）</h3>
    <p class="basis">市场档案 + 一秤一档登记造册（即备案底稿）+ 变动报备 + 公平秤日检 + 巡查 + 红黄牌 + 投诉先行赔偿追偿 + 周期义务 + 体检打分——检查来了 30 秒出证。</p>
    <div class="row">
      <button class="btn" data-action="inspect-download">${icon('dl')} 下载</button>
      <button class="btn ghost" data-action="inspect-print">${icon('print')} 直接打印</button>
    </div>
  </section>
  <section class="card">
    <h3>${icon('print')} 复秤处置单（近 10 件已复核）</h3>
    ${sheets.length ? `<div class="cards">${sheets.map((c) => `<button class="btn small ghost" data-action="print-recheck-sheet" data-idx="${c.id}">${esc(c.dateISO)} · ${esc(c.stall)}</button>`).join('')}</div>` : '<p class="dim">还没有已复核投诉。</p>'}
  </section>`;
}

/* ------------------------------------------------------------- 设置 */

export function viewSettings(state) {
  const s = state.settings;
  const org = state.org;
  const numField = (key, label) => `<label>${label}<input id="set-${key}" type="number" value="${s[key]}" /></label>`;
  return `
  <section class="card">
    <h3>市场信息（集市主办者）</h3>
    <div class="formgrid">
      <label>市场名称 *<input id="org-name" value="${esc(org.name)}" placeholder="例：城南农贸市场" /></label>
      <label>属地（区县）<input id="org-district" value="${esc(org.district)}" /></label>
      <label>计量管理员（第5条(四)专兼职）<input id="org-manager" value="${esc(org.manager)}" /></label>
      <label>联系电话<input id="org-phone" value="${esc(org.phone)}" /></label>
      <label class="wide">备注<input id="org-note" value="${esc(org.note)}" placeholder="主办方单位名称、摊位数等" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-org">保存市场信息</button></div>
  </section>
  <section class="card">
    <h3>口径参数（属地市场监管部门要求永远赢，改这里即可覆盖）</h3>
    <div class="formgrid">
      ${numField('certWarnDays', '强检黄线（天）')}
      ${numField('certRedDays', '强检红线（天）')}
      ${numField('verifyMonths', '强检周期（月，JJG 539-2016≤1年）')}
      ${numField('patrolDays', '巡查周期（天，第5条(七)工具口径）')}
      ${numField('complaintDays', '投诉处置时限（天，第5条(九)工具口径）')}
      ${numField('ledgerAuditDays', '台账盘点与备案更新（天）')}
      ${numField('adminTrainingDays', '计量管理员培训（天）')}
      ${numField('agreementAuditDays', '入场协议计量条款审查（天）')}
      ${numField('promiseOrgDays', '诚信计量承诺组织（天）')}
      ${numField('verifyPlanDays', '年度强检计划（天）')}
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存口径参数</button></div>
  </section>
  <section class="card">
    <h3>数据（本地优先）</h3>
    <div class="row">
      <button class="btn ghost" data-action="data-export">${icon('dl')} 导出备份 JSON</button>
      <label class="btn ghost filelabel">导入备份<input id="data-import" type="file" accept="application/json" data-action="data-import" /></label>
      <button class="btn ghost" data-action="seed-demo">载入示例数据</button>
    </div>
    <p class="basis">全部数据只存本机浏览器 localStorage；不存消费者身份信息（投诉只存摊位与商品，数据最小披露）。台账建议留存备查（市监检查与调解都可能调取），导出备份即离线归档。</p>
  </section>`;
}
