/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  POOL_KINDS, DISINFECT_KINDS, SLOTS, DEFAULT_LIMITS,
  todayBoard, streakDays, expiryAlerts, openAnomalies, activePools, monthlyStats,
  dailyText, badge, todayISO, monthKey, addDays, fmtVal, fmtRange, escapeHtml,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const PILL = { ok: 'ok', warn: 'warn', issue: 'issue', todo: 'todo' };

function poolLabel(pool) {
  return `${POOL_KINDS[pool.kind]?.label ?? '水池'}「${pool.name}」`;
}

export function viewOnboarding() {
  return `
  <h2 class="sec">每天两笔检测，台账永远在册</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>游泳场所的水质自检与公示是法定动作：《游泳场所卫生规范》要求每场开放前、开放时检测池水余氯、pH、温度并记录备查，检测结果应公示并注明测定时间；《公共场所卫生管理条例实施细则》要求卫生管理档案至少保存两年，未按规定检测的责令改正、可处罚款，情节严重的停业整顿直至吊销卫生许可证。而小微泳馆的现状是纸台账 + 记忆 + 检查前突击——抽检不合格公示一挂，家长用脚投票。</p>
    <p><strong>泳清单的做法：</strong>建档（场馆 + 池子 + 证照）→ 每日两检打卡（超线强制留处置说明，处置后复测闭环）→ 一键生成三样东西：微信家长群的<strong>每日水质速报</strong>、贴公示栏/发群里的<strong>泳客公示页</strong>、迎检用的<strong>台账打印包</strong>（缺检点名、异常闭环率一目了然）。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏊 先建场馆档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不做水质在线监测硬件、不做法定检测报送、不做培训教务——数据只存在你设备里，公示页走微信与打印，家长不用装任何东西。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（打卡状态 + 异常处置 + 证照预警 + 月度速览）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.pools?.length) return viewOnboarding();
  const today = todayISO();
  const board = todayBoard(state, today);
  const streak = streakDays(state, today);
  const alerts = expiryAlerts(state, today, state.settings?.warnDays);
  const month = monthKey(today);
  let stats = null;
  let statsError = '';
  try { stats = monthlyStats(state, month, today); } catch (e) { statsError = e.message; }

  const cards = [];
  if (board.missing.length) {
    cards.push(`<div class="card alert issue"><strong>⬜ 今日未检（${board.missing.length} 池）——开放前首检是底线</strong>
      <ul>${board.missing.map((p) => `<li>${esc(poolLabel(p))}——开放前、开放中都要检，先补首检</li>`).join('')}</ul></div>`);
  }
  if (board.anomalyOpen.length) {
    cards.push(`<div class="card alert issue"><strong>❌ 异常处置中（未闭环）——复测达标才算完</strong>
      <ul>${board.anomalyOpen.slice(0, 5).map((r) => {
    const pool = state.pools.find((p) => p.id === r.poolId);
    return `<li>${esc(poolLabel(pool ?? { name: r.poolId, kind: 'other' }))} · ${esc(r.dateISO)} ${esc(SLOTS[r.slot]?.label ?? '')}：${esc(r.anomaly.action)}——<a href="#/checkin">去复测闭环 →</a></li>`;
  }).join('')}${board.anomalyOpen.length > 5 ? `<li>……另有 ${board.anomalyOpen.length - 5} 起未闭环</li>` : ''}</ul></div>`);
  }
  if (alerts.length) {
    cards.push(`<div class="card alert"><strong>🔔 证照与报告预警</strong>
      <ul>${alerts.slice(0, 6).map((x) => `<li>${esc(x.label)}：${x.level === 'expired' ? '🔴 已过期' : '🟡 临期'}（${esc(x.expiry)}）</li>`).join('')}</ul>
      <p class="fine">健康证按《公共场所卫生管理条例实施细则》每年一检；卫生许可证有效期四年；第三方全项检测报告到期前应复检。</p></div>`);
  }

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">🏊 今日已检 <strong>${board.rows.length - board.missing.length}/${board.rows.length}</strong> 池 · 🔥 连续全检 <strong>${streak.started ? `${streak.streak} 天` : '—'}</strong></div>
    <p class="done-note">${board.rows.length ? '每日两检（开放前首检 + 开放中抽检）是《游泳场所卫生规范》的底线口径。' : '还没有建档水池，先去「设置」建池子。'}</p>
  </div>
  ${cards.join('')}
  <h2 class="sec">各池状态（今日最新）</h2>
  <div class="card"><table class="plain">
    <tr><th>水池</th><th>今日</th><th>最新时点</th><th>判定</th></tr>
    ${board.rows.map((r) => `<tr>
      <td><strong>${esc(r.pool.name)}</strong><div class="basis">${esc(POOL_KINDS[r.pool.kind]?.label ?? '')}</div></td>
      <td>${r.count} 检</td>
      <td class="fine">${r.latest ? `${esc(r.latest.createdAt.slice(11, 16))} ${esc(SLOTS[r.latest.slot]?.label ?? '')}` : '—'}</td>
      <td><span class="pill ${r.latest && r.latest.anomaly && !r.latest.anomaly.closedBy ? 'issue' : r.checked ? 'ok' : 'todo'}">${esc(r.badge)}</span></td>
    </tr>`).join('')}
  </table>
  <div class="row">
    <a class="btn" href="#/checkin">🧪 水质打卡</a>
    <a class="btn ghost" href="#/outputs">📣 生成公示 / 台账</a>
  </div></div>
  <h2 class="sec">${month} 台账速览</h2>
  <div class="card">
    ${statsError ? `<p class="fine">${esc(statsError)}</p>` : `
    <div class="row stats-line">
      <span>应检 <strong>${stats.pairTotal}</strong> 检次（每日 ${stats.dailyRequired}）</span>
      <span>足额 <strong>${stats.doneChecks}</strong>（缺 ${stats.missingChecks}）</span>
      <span>达标率 <strong>${stats.passRate === null ? '—' : `${Math.round(stats.passRate * 100)}%`}</strong></span>
      <span>异常 <strong>${stats.anomalies}</strong> 起（闭环 ${stats.anomaliesClosed}）</span>
      <span>记录 <strong>${stats.recordCount}</strong> 条</span>
    </div>`}
    <p class="fine">台账体检（缺检点名、异常闭环率）见「台账」页，迎检打印包在「公示」页一键生成。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 打卡（30 秒一笔：读数即判定，超线强制处置说明，复测闭环）
// ---------------------------------------------------------------------------

function recentRecords(state) {
  const from = addDays(todayISO(), -7);
  const limits = state.settings?.limits;
  return (state.records ?? [])
    .filter((r) => r.dateISO >= from)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40)
    .map((r) => {
      const pool = state.pools.find((p) => p.id === r.poolId);
      return { r, pool, badgeText: pool ? badge(r, pool, limits) : '?' };
    });
}

export function viewCheckin(state, selPoolId = null) {
  if (!state.pools?.length) return viewOnboarding();
  const pools = activePools(state);
  const poolId = selPoolId ?? pools[0]?.id;
  const pool = pools.find((p) => p.id === poolId) ?? pools[0];
  const today = todayISO();
  const isFoot = pool.kind === 'footbath';
  const openForPool = openAnomalies(state).filter((r) => r.poolId === pool.id);
  const recent = recentRecords(state);

  return `
  <h2 class="sec">🧪 水质打卡（读数即判定，超线必须留处置）</h2>
  <div class="card">
    <div class="row">
      <label>水池 <select id="ck-pool">${pools.map((p) => `<option value="${p.id}" ${p.id === pool.id ? 'selected' : ''}>${esc(poolLabel(p))}</option>`).join('')}</select></label>
      <button class="btn small" data-action="ck-apply">切换</button>
    </div>
    <div class="form-grid">
      <label>检测日<input type="date" id="ck-date" value="${today}" /></label>
      <label>时点<select id="ck-slot">${Object.keys(SLOTS).map((k) => `<option value="${k}" ${k === 'open' ? 'selected' : ''}>${SLOTS[k].label}</option>`).join('')}</select></label>
      <label>游离性余氯（mg/L）<input type="number" step="0.1" min="0" id="ck-residual" placeholder="${isFoot ? '5~10 合规' : '0.3~1.0 合规'}" /></label>
      ${isFoot ? '' : '<label>pH<input type="number" step="0.1" min="0" max="14" id="ck-ph" placeholder="7.0~7.8 合规" /></label>'}
      ${isFoot ? '' : '<label>浑浊度 NTU（选填）<input type="number" step="0.1" min="0" id="ck-turb" placeholder="≤1 合规" /></label>'}
      ${isFoot ? '' : '<label>水温 ℃（选填）<input type="number" step="0.1" min="0" id="ck-temp" placeholder="宜 23~30" /></label>'}
      <label class="span2">加药/补水等操作（选填，写进台账）<input id="ck-op" placeholder="如：投二氯异氰尿酸钠 200g / 补新水 5m³" /></label>
      <label class="span2">处置说明（读数超线时必填）<input id="ck-action" placeholder="超线时写了什么处置：加药量、补水量、复测安排" /></label>
      <label class="span2">本次是异常复测？<select id="ck-recheck"><option value="">不是，常规检测</option>${openForPool.map((r) => `<option value="${r.id}">复测闭环：${esc(r.dateISO)} ${esc(r.anomaly.action.slice(0, 18))}</option>`).join('')}</select></label>
    </div>
    <button class="btn" data-action="checkin">落一笔检测（${isFoot ? '浸脚池只管余氯 5~10' : '余氯 + pH 必测'}）</button>
    <p class="fine">判定口径：泳池水执行 GB 37488-2019（余氯 0.3~1.0 mg/L、pH 7.0~7.8、浊度 ≤1 NTU、水温宜 23~30℃）；浸脚消毒池余氯 5~10 mg/L（205 号规范）。口径可在「设置」按属地要求覆盖。</p>
  </div>

  <h2 class="sec">待闭环异常（${openForPool.length}）</h2>
  ${openForPool.length ? openForPool.map((r) => `<div class="card inner">
      <span class="pill issue">❌ 待闭环</span> <strong>${esc(r.dateISO)}</strong> ${esc(SLOTS[r.slot]?.label ?? '')}
      <div class="basis">处置：${esc(r.anomaly.action)}（${esc(r.createdAt.slice(11, 16))} 落账）</div>
    </div>`).join('') : '<div class="card"><p class="fine">没有待闭环异常。异常在、复测跟上，台账才完整。</p></div>'}

  <h2 class="sec">近 7 天记录（最近 ${recent.length} 条）</h2>
  ${recent.length ? `<div class="card"><table class="plain">
    <tr><th>日期</th><th>水池</th><th>时点</th><th>余氯</th><th>pH</th><th>判定</th><th></th></tr>
    ${recent.map(({ r, pool, badgeText }) => {
    const isOpen = r.anomaly && !r.anomaly.closedBy;
    return `<tr>
      <td class="fine">${esc(r.dateISO)}</td>
      <td>${esc(pool?.name ?? '?')}<div class="basis">${esc(POOL_KINDS[pool?.kind]?.label ?? '')}</div></td>
      <td class="fine">${esc(SLOTS[r.slot]?.label ?? '')}</td>
      <td>${esc(fmtVal(r.residual))}</td>
      <td>${esc(fmtVal(r.ph))}</td>
      <td><span class="pill ${isOpen ? 'issue' : r.anomaly ? 'warn' : 'ok'}">${esc(badgeText)}${r.anomaly?.closedBy ? ' · 已闭环' : ''}</span></td>
      <td>${isOpen ? `<a class="btn small ghost" href="#/checkin" title="在上方打卡表选择复测闭环">复测</a>` : `<button class="btn small ghost" data-action="del-record" data-idx="${r.id}">删</button>`}</td>
    </tr>`;
  }).join('')}
  </table><p class="fine">只显示近 7 天；完整台账见「台账」页。删除异常的闭环记录会让异常自动回到「待闭环」。</p></div>`
    : '<div class="card"><p class="fine">近 7 天还没有记录，先落第一笔。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 公示（三通道：速报文本 / 泳客公示页 / 迎检台账包）
// ---------------------------------------------------------------------------

export function viewOutputs(state, outSel = {}) {
  if (!state.pools?.length) return viewOnboarding();
  const today = todayISO();
  const date = outSel.date ?? today;
  const from = outSel.from ?? addDays(today, -30);
  const to = outSel.to ?? today;
  let text = '';
  let textError = '';
  try { text = dailyText(state, date); } catch (e) { textError = e.message; }

  return `
  <h2 class="sec">📣 每日水质速报（微信家长群，主通道）</h2>
  <div class="card">
    <div class="row">
      <label>速报日期 <input type="date" id="out-date" value="${date}" /></label>
      <button class="btn small" data-action="out-apply">生成</button>
    </div>
    ${textError ? `<p class="fine">⚠ ${esc(textError)}</p>` : `
    <div class="row">
      <button class="btn" data-action="out-copy">📋 复制速报文本（发家长群）</button>
    </div>
    <pre class="preview">${esc(text)}</pre>
    <p class="fine">未检的池会如实写「今日未检」——公示的价值恰恰在「没达标也看得见」；先打卡再发，速报就是朋友圈里最硬的招生文案。</p>`}
  </div>

  <h2 class="sec">🪧 泳客公示页（贴公示栏 / 发群，家长零安装）</h2>
  <div class="card">
    <p class="fine" style="margin-top:0">《游泳场所卫生规范》要求检测结果应公示并注明测定时间——这是公示义务的法定落地。单文件 HTML、内联样式、离线可用：下载发家长群，或直接打印贴在入口公示栏。</p>
    <div class="row">
      <button class="btn" data-action="pub-download">⬇️ 下载公示页 HTML（按速报日期 ${esc(date)}）</button>
      <button class="btn ghost" data-action="pub-print">🖨️ 直接打印公示页</button>
    </div>
  </div>

  <h2 class="sec">🗂️ 迎检台账打印包（逐日记录 + 体检卡 + 签字栏）</h2>
  <div class="card">
    <div class="row">
      <label>从 <input type="date" id="audit-from" value="${from}" /></label>
      <label>到 <input type="date" id="audit-to" value="${to}" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="audit-download">⬇️ 下载台账包 HTML（区间 ${esc(from)} ~ ${esc(to)}）</button>
      <button class="btn ghost" data-action="audit-print">🖨️ 直接打印台账包</button>
    </div>
    <p class="fine">台账包含体检卡（应检/足额/缺检点名/达标率/异常闭环率）、逐日逐池明细、异常处置记录与签字栏——卫生管理档案按细则至少保存两年，本包是打印底稿，数据仍在本地。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 台账（月度体检 + 记录总表）
// ---------------------------------------------------------------------------

export function viewLedger(state, ledMonth = null) {
  if (!state.pools?.length) return viewOnboarding();
  const today = todayISO();
  const month = ledMonth ?? monthKey(today);
  let stats = null;
  let error = '';
  try { stats = monthlyStats(state, month, today); } catch (e) { error = e.message; }
  const poolName = (id) => state.pools.find((p) => p.id === id)?.name ?? '?';
  const records = (state.records ?? []).filter((r) => monthKey(r.dateISO) === month)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const limits = state.settings?.limits;

  return `
  <h2 class="sec">📒 月度台账体检</h2>
  <div class="card">
    <div class="row">
      <label>月份 <input type="month" id="led-month" value="${month}" /></label>
      <button class="btn small" data-action="led-apply">查看</button>
    </div>
    ${error ? `<p class="fine">⚠ ${esc(error)}</p>` : `
    <div class="row stats-line">
      <span>应检 <strong>${stats.pairTotal}</strong> 检次（每日 ${stats.dailyRequired}）</span>
      <span>足额 <strong>${stats.doneChecks}</strong></span>
      <span>缺检 <strong>${stats.missingChecks}</strong> 检次（${stats.missing.length} 池·日）</span>
      <span>达标率 <strong>${stats.passRate === null ? '—' : `${Math.round(stats.passRate * 100)}%`}</strong></span>
      <span>异常 <strong>${stats.anomalies}</strong> → 闭环 <strong>${stats.anomaliesClosed}</strong></span>
      <span>平均闭环 <strong>${stats.avgClosureHours === null ? '—' : `${stats.avgClosureHours.toFixed(1)} 小时`}</strong></span>
    </div>
    ${stats.missing.length ? `<table class="plain"><tr><th>缺检点名（体检卡同款）</th></tr>
      ${stats.missing.slice(0, 12).map((m) => `<tr><td>${esc(m.date)} · ${esc(poolName(m.poolId))}（实检 ${m.have}/${m.need}）</td></tr>`).join('')}
      ${stats.missing.length > 12 ? `<tr><td class="fine">……另有 ${stats.missing.length - 12} 条，见迎检台账包</td></tr>` : ''}
    </table>` : '<p class="fine">区间内无缺检 ✅——这就是检查来了最想看到的那行字。</p>'}
    <p class="fine">应检口径：区间内每天 × 每个当日已在用的池 × 每日应检频次（默认 2：开放前首检 + 开放中抽检，可在设置调整）。当日未到的日期不计应检。</p>`}
  </div>

  <h2 class="sec">本月记录（${records.length} 条）</h2>
  ${records.length ? `<div class="card"><table class="plain">
    <tr><th>日期</th><th>水池</th><th>时点</th><th>余氯</th><th>pH</th><th>判定 / 处置</th></tr>
    ${records.slice(0, 80).map((r) => {
    const pool = state.pools.find((p) => p.id === r.poolId);
    const b = pool ? badge(r, pool, limits) : '?';
    const isOpen = r.anomaly && !r.anomaly.closedBy;
    return `<tr>
      <td class="fine">${esc(r.dateISO)}</td>
      <td>${esc(poolName(r.poolId))}</td>
      <td class="fine">${esc(SLOTS[r.slot]?.label ?? '')}</td>
      <td>${esc(fmtVal(r.residual))}</td>
      <td>${esc(fmtVal(r.ph))}</td>
      <td><span class="pill ${isOpen ? 'issue' : 'ok'}">${esc(b)}</span>${r.anomaly ? `<div class="basis">处置：${esc(r.anomaly.action)}${r.anomaly.closedBy ? ' · 已复测闭环' : ' · 待复测'}</div>` : ''}</td>
    </tr>`;
  }).join('')}
  </table></div>` : '<div class="card"><p class="fine">本月还没有记录。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 设置（场馆 / 水池 / 证照 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const v = state.venue ?? {};
  const s = state.settings ?? {};
  const lim = { ...DEFAULT_LIMITS, ...(s.limits ?? {}) };
  const pools = state.pools ?? [];
  return `
  <h2 class="sec">🏊 场馆档案（印在台账与公示页上）</h2>
  <div class="card">
    <div class="form-grid">
      <label>场馆名称<input id="vn-name" value="${esc(v.name ?? '')}" placeholder="如：清波游泳馆" /></label>
      <label>卫生许可证号<input id="vn-license" value="${esc(v.licenseNo ?? '')}" placeholder="如：粤卫公证字〔2024〕第0385号" /></label>
      <label>卫生许可证有效期至<input type="date" id="vn-expiry" value="${esc(v.licenseExpiry ?? '')}" /></label>
      <label>联系电话<input id="vn-phone" value="${esc(v.phone ?? '')}" /></label>
      <label class="span2">地址（选填）<input id="vn-address" value="${esc(v.address ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-venue">保存场馆</button>
    <p class="fine">公共场所实行卫生许可证管理，有效期四年，须在醒目位置公示；许可证号与有效期进台账落款，临期自动进「今日」预警。</p>
  </div>

  <h2 class="sec">💧 水池建档（${pools.length}）</h2>
  <div class="card">
    <div class="form-grid">
      <label>名称<input id="pool-name" placeholder="如：25m 主池" /></label>
      <label>类型<select id="pool-kind">${Object.keys(POOL_KINDS).map((k) => `<option value="${k}">${POOL_KINDS[k].label}</option>`).join('')}</select></label>
      <label>消毒方式<select id="pool-disinfect">${Object.keys(DISINFECT_KINDS).map((k) => `<option value="${k}">${DISINFECT_KINDS[k].label}</option>`).join('')}</select></label>
      <label>投用/建档日<input type="date" id="pool-since" value="${todayISO()}" /></label>
    </div>
    <button class="btn" data-action="add-pool">建档水池</button>
    ${pools.length ? `<table class="plain"><tr><th>水池</th><th>消毒</th><th>状态</th><th></th></tr>
      ${pools.map((p) => `<tr class="${p.active === false ? 'muted' : ''}">
        <td><strong>${esc(p.name)}</strong><div class="basis">${esc(POOL_KINDS[p.kind]?.label ?? '')}</div></td>
        <td class="fine">${esc(DISINFECT_KINDS[p.disinfect]?.label ?? '—')}</td>
        <td>${p.active === false ? '<span class="pill todo">已停用</span>' : '<span class="pill ok">在用</span>'}</td>
        <td>${p.active === false
    ? `<button class="btn small ghost" data-action="restore-pool" data-idx="${p.id}">恢复</button>`
    : `<button class="btn small ghost" data-action="delist-pool" data-idx="${p.id}">停用</button>`}
          ${!(state.records ?? []).some((r) => r.poolId === p.id) ? ` <button class="btn small ghost" data-action="del-pool" data-idx="${p.id}">删</button>` : ''}</td>
      </tr>`).join('')}</table>` : ''}
    <p class="fine">浸脚消毒池单独口径：只测余氯（5~10 mg/L，规范要求每 4 小时更换一次池水）。停用的池不再进应检口径，历史记录保留。</p>
  </div>

  <h2 class="sec">🪪 从业人员健康证（${(state.certs ?? []).length}）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名<input id="cert-name" placeholder="如：陈教练" /></label>
      <label>岗位<input id="cert-role" placeholder="如：救生员/教练/前台" /></label>
      <label>健康证有效期至<input type="date" id="cert-expiry" /></label>
    </div>
    <button class="btn" data-action="add-cert">登记健康证</button>
    ${(state.certs ?? []).length ? `<table class="plain"><tr><th>人员</th><th>有效期至</th><th></th></tr>
      ${(state.certs ?? []).map((c) => `<tr><td><strong>${esc(c.name)}</strong>${c.role ? `<div class="basis">${esc(c.role)}</div>` : ''}</td><td class="fine">${esc(c.expiry)}</td>
      <td><button class="btn small ghost" data-action="del-cert" data-idx="${c.id}">删</button></td></tr>`).join('')}</table>` : ''}
    <p class="fine">直接服务顾客的从业人员每年健康检查、持有效健康合格证明上岗——临期 30 天自动预警。</p>
  </div>

  <h2 class="sec">🧾 第三方全项检测报告（${(state.reports ?? []).length}）</h2>
  <div class="card">
    <div class="form-grid">
      <label>检测机构<input id="rep-org" placeholder="如：XX 谱尼检测" /></label>
      <label>报告日<input type="date" id="rep-date" /></label>
      <label>下次到期日<input type="date" id="rep-next" /></label>
      <label class="span2">备注（选填，如报告编号）<input id="rep-note" /></label>
    </div>
    <button class="btn" data-action="add-report">登记检测报告</button>
    ${(state.reports ?? []).length ? `<table class="plain"><tr><th>机构</th><th>报告日</th><th>下次到期</th><th></th></tr>
      ${(state.reports ?? []).map((t) => `<tr><td>${esc(t.org)}${t.note ? `<div class="basis">${esc(t.note)}</div>` : ''}</td><td class="fine">${esc(t.reportISO)}</td><td class="fine">${esc(t.nextDue)}</td>
      <td><button class="btn small ghost" data-action="del-report" data-idx="${t.id}">删</button></td></tr>`).join('')}</table>` : ''}
    <p class="fine">尿素、菌落总数、大肠菌群等实验室项目由 CMA 机构检测——泳清单管自检台账与提醒，不替代法定检测。</p>
  </div>

  <h2 class="sec">🔔 判定口径与预警参数（属地口径永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>泳池余氯下限（mg/L）<input type="number" step="0.1" id="lim-res-min" value="${esc(String(lim.residual[0]))}" /></label>
      <label>泳池余氯上限（mg/L）<input type="number" step="0.1" id="lim-res-max" value="${esc(String(lim.residual[1]))}" /></label>
      <label>pH 下限<input type="number" step="0.1" id="lim-ph-min" value="${esc(String(lim.ph[0]))}" /></label>
      <label>pH 上限<input type="number" step="0.1" id="lim-ph-max" value="${esc(String(lim.ph[1]))}" /></label>
      <label>浊度上限（NTU）<input type="number" step="0.1" id="lim-turb" value="${esc(String(lim.turbidityMax))}" /></label>
      <label>水温「宜」下限（℃）<input type="number" step="0.1" id="lim-temp-min" value="${esc(String(lim.waterTemp[0]))}" /></label>
      <label>水温「宜」上限（℃）<input type="number" step="0.1" id="lim-temp-max" value="${esc(String(lim.waterTemp[1]))}" /></label>
      <label>浸脚池余氯下限<input type="number" step="0.5" id="lim-foot-min" value="${esc(String(lim.foot[0]))}" /></label>
      <label>浸脚池余氯上限<input type="number" step="0.5" id="lim-foot-max" value="${esc(String(lim.foot[1]))}" /></label>
      <label>每日应检频次（1~4）<input type="number" min="1" max="4" id="set-daily" value="${esc(String(s.dailyRequired ?? 2))}" /></label>
      <label>证照临期提醒（天）<input type="number" min="7" max="90" id="set-warn" value="${esc(String(s.warnDays ?? 30))}" /></label>
    </div>
    <button class="btn small" data-action="save-params">保存参数</button>
    <p class="fine">默认值为国标口径（GB 37488-2019 + 205 号规范）；属地有更严要求的照属地改——你的台账你定口径。</p>
  </div>

  <h2 class="sec">⚙️ 数据与备份</h2>
  <div class="card">
    <p class="fine" style="margin-top:0">数据仅存于本机浏览器。换手机/给合伙人备份：导出 JSON 文件，到目标设备导入。本地事件流（使用埋点）可单独导出，用于产品验证。</p>
    <div class="row">
      <button class="btn block" data-action="export-json">⬇️ 导出备份</button>
      <label class="btn ghost block" style="line-height:2.4">
        ⬆️ 导入备份<input type="file" id="import-file" accept=".json" hidden />
      </label>
      <button class="btn ghost block" data-action="export-events">📈 导出使用记录</button>
    </div>
  </div>`;
}
