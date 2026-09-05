/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  INDUSTRIES, LICENSE_KINDS, LICENSE_SCOPES, HOTWORK_KINDS, HOTWORK_MEASURES,
  CHECK_ITEMS, HAZARD_LEVELS, HAZARD_STATUS, DRILL_TYPES,
  licenseRows, hazardRows, hazardSummary, openHotworks, hotworkRows,
  boardSummary, todayActions, selfCheckDigest, selfCheckText,
  trainingAudit, drillAudit, checkRows,
} from './core.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const LEVEL_DOT = { ok: '🟢', warn: '🟡', expired: '🔴' };
const LEVEL_LABEL = { ok: '正常', warn: '临近到期', expired: '已过期' };

export function pill(n, tone) {
  return `<span class="pill ${tone}">${n}</span>`;
}

export function viewOnboarding() {
  return `
  <h2 class="sec">检查来之前，台账先在</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>《安全生产法》要求事故隐患排查治理情况<strong>如实记录</strong>并向从业人员通报；应急管理部令第 10 号把「特种作业人员无证上岗」直接判定为<strong>重大事故隐患</strong>——一次检查翻不出台账、拿不出证件，就是限期整改、罚款、停产整顿的开始；出了事故，「早就发现了却没整改」比「没检查」更重。</p>
    <p><strong>安巡单的做法：</strong>每天 30 秒自查打卡（异常强制留隐患）→ 隐患登记→整改→复查销案全闭环 → 动火作业开票（无有效焊工证，这张单<strong>开不出来</strong>）→ 证照有效期三态亮灯 → 培训学时与演练频次自动体检 → 一键生成迎检自证包（微信文本 / 打印版单文件 HTML，检查来之前台账先在）。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏭 先建厂档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日安全台
// ---------------------------------------------------------------------------

function checklistForm() {
  const items = Object.entries(CHECK_ITEMS).map(([key, it], i) => `
    <div class="check-item">
      <div class="check-head">
        <span class="check-idx">${i + 1}</span>
        <span class="check-label">${esc(it.label)}</span>
        <label class="radio"><input type="radio" name="ck-${key}" value="ok" checked />正常</label>
        <label class="radio warn"><input type="radio" name="ck-${key}" value="issue" />异常</label>
      </div>
      <input type="text" class="check-desc" id="desc-${key}" placeholder="若异常：情况说明（必填）" />
    </div>`).join('');
  return `
  <div class="card">
    <h3>今日自查 · 十二项（30 秒走一遍）</h3>
    <p class="hint">异常必须写明情况——自动登记为隐患并进入闭环；当天只查了一半也如实记录（没查的项留空）。</p>
    <form id="check-form"><div class="checklist-grid">${items}</div>
      <input type="text" id="check-note" placeholder="备注（选填：检查人、当日特殊情况）" style="margin-top:10px" />
      <button class="btn primary" type="submit" data-action="check-submit">提交今日自查</button>
    </form>
  </div>`;
}

function licenseStrip(state, today) {
  const rows = licenseRows(state, today).filter((r) => r.level !== 'ok');
  if (!rows.length) return '<p class="hint ok-hint">🟢 证照全部正常</p>';
  return `<table class="list"><tr><th>持有人/设备</th><th>证种</th><th>状态</th></tr>${
    rows.map((r) => `<tr><td>${esc(r.license.holderName)}</td><td>${esc(r.license.kind ? LICENSE_KINDS[r.license.kind].label : '')}</td><td>${
      LEVEL_DOT[r.level]} ${r.level === 'expired' ? `${esc(r.license.expiryISO)} 已过期 → ${esc(r.renew)}` : `${r.daysLeft} 天后到期`}</td></tr>`).join('')}</table>`;
}

function hazardStrip(state, today) {
  const rows = hazardRows(state, today).filter((r) => r.hazard.status !== 'closed');
  if (!rows.length) return '<p class="hint ok-hint">🟢 无待办隐患</p>';
  return `<table class="list"><tr><th>发现</th><th>描述</th><th>期限</th></tr>${
    rows.map((r) => `<tr><td>${esc(r.hazard.foundISO)}</td><td>${esc(r.hazard.desc)}</td><td>${r.overdue ? '🔴 ' : ''}${esc(r.hazard.dueISO)}</td></tr>`).join('')}</table>`;
}

export function viewBoard(state, today) {
  if (!state.org?.name && !state.licenses.length && !state.hazards.length) return viewOnboarding();
  const s = boardSummary(state, today);
  const actions = todayActions(state, today);
  const open = openHotworks(state);
  return `
  <h2 class="sec">今日安全台 · ${today}</h2>
  <div class="stat-row">
    <div class="stat">${s.checked ? '✅ 已自查' : '⬜ 未自查'}</div>
    <div class="stat">🔴 证照过期 ${pill(s.expiredLicenses, s.expiredLicenses ? 'bad' : 'good')}</div>
    <div class="stat">🟡 临期 ${pill(s.warnLicenses, s.warnLicenses ? 'warn' : 'good')}</div>
    <div class="stat">⏰ 逾期隐患 ${pill(s.overdueHazards, s.overdueHazards ? 'bad' : 'good')}</div>
    <div class="stat">🔥 未销票 ${pill(s.unclosedHotworks, s.unclosedHotworks ? 'warn' : 'good')}</div>
  </div>
  <div class="card">
    <h3>今天做什么</h3>
    ${actions.length ? `<ul class="actions">${actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p class="hint ok-hint">🟢 今天没有红灯事项——保持。</p>'}
  </div>
  ${open.length ? `<div class="card"><h3>未销票动火单</h3><table class="list"><tr><th>日期</th><th>种类</th><th>作业人</th><th>地点</th><th></th></tr>${
    open.map((h) => `<tr><td>${esc(h.dateISO)}</td><td>${esc(HOTWORK_KINDS[h.kind].label)}</td><td>${esc(h.worker)}</td><td>${esc(h.location)}</td><td><button class="btn small" data-action="hotwork-close" data-id="${esc(h.id)}">销票</button></td></tr>`).join('')}</table></div>` : ''}
  ${checklistForm()}
  <div class="card"><h3>证照亮灯</h3>${licenseStrip(state, today)}
    <p class="hint"><a href="#/people">→ 去人与证处理</a></p></div>
  <div class="card"><h3>隐患待办</h3>${hazardStrip(state, today)}
    <p class="hint"><a href="#/hazards">→ 去隐患闭环</a></p></div>`;
}

// ---------------------------------------------------------------------------
// 隐患闭环
// ---------------------------------------------------------------------------

export function viewHazards(state, today) {
  const sum = hazardSummary(state, today);
  const rows = hazardRows(state, today);
  const table = rows.length ? `<table class="list"><tr><th>发现</th><th>描述</th><th>等级</th><th>责任人</th><th>期限</th><th>状态</th><th></th></tr>${
    rows.map(({ hazard: h, overdue }) => {
      const acts = h.status === 'open'
        ? `<button class="btn small" data-action="hazard-fix" data-id="${esc(h.id)}">登记整改</button>`
        : h.status === 'fixed'
          ? `<button class="btn small" data-action="hazard-close" data-id="${esc(h.id)}">复查销案</button>`
          : `<span class="hint">${esc(h.recheckNote ?? '')}</span>`;
      return `<tr><td>${esc(h.foundISO)}</td><td>${esc(h.desc)}</td><td>${esc(HAZARD_LEVELS[h.level])}</td><td>${esc(h.owner || '—')}</td><td>${overdue ? '🔴 ' : ''}${esc(h.dueISO)}</td><td>${overdue && h.status !== 'closed' ? '⚠️ ' : ''}${esc(HAZARD_STATUS[h.status])}</td><td>${acts}</td></tr>`;
    }).join('')}</table>` : '<p class="hint">还没有登记隐患——日常发现的、自查打出来的都在这里进闭环。</p>';
  return `
  <h2 class="sec">隐患闭环 · 登记 → 整改 → 复查销案</h2>
  <div class="stat-row">
    <div class="stat">累计 ${sum.total}</div>
    <div class="stat">待整改 ${pill(sum.open, sum.open ? 'warn' : 'good')}</div>
    <div class="stat">待复查 ${pill(sum.fixed, sum.fixed ? 'warn' : 'good')}</div>
    <div class="stat">逾期 ${pill(sum.overdue, sum.overdue ? 'bad' : 'good')}</div>
    <div class="stat">闭环率 ${sum.closeRate === null ? '—' : pill(`${sum.closeRate}%`, sum.closeRate === 100 ? 'good' : 'warn')}</div>
  </div>
  <div class="card">
    <h3>登记隐患</h3>
    <form id="hazard-form">
      <div class="grid2">
        <label>描述（必填）<input type="text" id="hz-desc" placeholder="如：3 号冲床急停失效" required /></label>
        <label>发现日<input type="date" id="hz-found" value="${today}" /></label>
        <label>等级<select id="hz-level"><option value="normal">一般隐患</option><option value="major">疑似重大·立即停用上报</option></select></label>
        <label>责任人（选填）<input type="text" id="hz-owner" placeholder="如：张三" /></label>
        <label>区域（选填）<input type="text" id="hz-area" placeholder="如：车间西区" /></label>
        <label>整改期限（默认 7 天）<input type="date" id="hz-due" value="${today}" /></label>
      </div>
      <button class="btn primary" type="submit" data-action="hazard-register">登记进入闭环</button>
    </form>
  </div>
  <div class="card"><h3>隐患台账</h3>${table}
  <p class="hint">只有闭环（销案）的隐患才有台账意义：整改说明与复查记录都是必填——只打勾不留痕，台账等于没做。</p></div>`;
}

// ---------------------------------------------------------------------------
// 动火作业许可
// ---------------------------------------------------------------------------

function hotworkForm(state, today) {
  const welders = (state.licenses ?? []).filter((l) => l.kind === 'weld');
  const welderOptions = welders.map((l) => `<option value="${esc(l.id)}">${esc(l.holderName)} · 有效期至 ${esc(l.expiryISO)}</option>`).join('');
  const staffOptions = (state.staff ?? []).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  const measures = HOTWORK_MEASURES.map((m) => `<label class="measure"><input type="checkbox" id="hm-${m.key}" /> ${esc(m.label)}</label>`).join('');
  return `
  <div class="card">
    <h3>开一张动火作业单</h3>
    <p class="hint">闸机规则：焊割动火必须有<strong>当日有效的焊工证</strong>（应急管理部令第 10 号：特种作业无证上岗属重大事故隐患）；六项措施逐项确认；监护人必填。<strong>开不出来的单子，就是今天不该动的火。</strong></p>
    <form id="hotwork-form">
      <div class="grid2">
        <label>作业日期<input type="date" id="hw-date" value="${today}" /></label>
        <label>种类<select id="hw-kind">${Object.entries(HOTWORK_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>
        <label>焊工证（焊割动火必选，从已登记证件中选）<select id="hw-license"><option value="">— 无登记焊工证 —</option>${welderOptions}</select></label>
        <label>作业人<select id="hw-worker">${staffOptions ? `<option value="">— 选择 —</option>${staffOptions}` : '<option value="">（先去「人与证」加员工）</option>'}</select></label>
        <label>监护人（必填）<input type="text" id="hw-guardian" placeholder="如：李四" /></label>
        <label>作业地点（必填）<input type="text" id="hw-location" placeholder="如：车间东区平台" /></label>
      </div>
      <label>作业内容（选填）<input type="text" id="hw-content" placeholder="如：更换传送带支架" /></label>
      <fieldset class="measures"><legend>六项安全措施（逐项确认，缺一不开）</legend>${measures}</fieldset>
      <button class="btn primary" type="submit" data-action="hotwork-issue">开票</button>
    </form>
  </div>`;
}

export function viewHotwork(state, today) {
  const open = openHotworks(state);
  const rows = hotworkRows(state);
  const openList = open.length ? `<table class="list"><tr><th>日期</th><th>种类</th><th>作业人</th><th>监护人</th><th>地点</th><th></th></tr>${
    open.map((h) => `<tr><td>${esc(h.dateISO)}</td><td>${esc(HOTWORK_KINDS[h.kind].label)}</td><td>${esc(h.worker)}</td><td>${esc(h.guardian)}</td><td>${esc(h.location)}</td><td><button class="btn small" data-action="hotwork-close" data-id="${esc(h.id)}">销票</button></td></tr>`).join('')}</table>`
    : '<p class="hint ok-hint">🟢 无未销票动火单</p>';
  const history = rows.length ? `<table class="list"><tr><th>日期</th><th>种类</th><th>作业人</th><th>地点</th><th>销票</th></tr>${
    rows.map((h) => `<tr><td>${esc(h.dateISO)}</td><td>${esc(HOTWORK_KINDS[h.kind].label)}</td><td>${esc(h.worker)}</td><td>${esc(h.location)}</td><td>${h.status === 'open' ? '⚠️ 未销票' : `${esc(h.closedISO ?? '')}`}</td></tr>`).join('')}</table>` : '<p class="hint">还没有动火记录。</p>';
  return `
  <h2 class="sec">动火作业 · 开票即留痕，完工即销票</h2>
  <div class="stat-row"><div class="stat">未销票 ${pill(open.length, open.length ? 'warn' : 'good')}</div><div class="stat">累计 ${rows.length} 张</div></div>
  ${hotworkForm(state, today)}
  <div class="card"><h3>未销票（今日台同步亮灯）</h3>${openList}</div>
  <div class="card"><h3>动火台账</h3>${history}</div>`;
}

// ---------------------------------------------------------------------------
// 人与证
// ---------------------------------------------------------------------------

export function viewPeople(state, today) {
  const warnDays = state.settings?.licenseWarnDays ?? 60;
  const licRows = licenseRows(state, today);
  const licTable = licRows.length ? `<table class="list"><tr><th>持有人/设备</th><th>类别</th><th>证种</th><th>有效期至</th><th>状态</th><th></th></tr>${
    licRows.map((r) => `<tr><td>${esc(r.license.holderName)}</td><td>${esc(LICENSE_SCOPES[LICENSE_KINDS[r.license.kind].scope])}</td><td>${esc(LICENSE_KINDS[r.license.kind].label)}</td><td>${esc(r.license.expiryISO)}</td><td>${LEVEL_DOT[r.level]} ${r.level === 'expired' ? `已过期 → ${esc(r.renew)}` : `${LEVEL_LABEL[r.level]}（${r.daysLeft} 天）`}</td><td><button class="btn small ghost" data-action="license-remove" data-id="${esc(r.license.id)}">删</button></td></tr>`).join('')}</table>`
    : '<p class="hint">还没有登记证件。先把焊工、电工、叉车司机的证和叉车的定检录进来——证面「有效期至」为准。</p>';
  const year = Number(today.slice(0, 4));
  const ta = trainingAudit(state, year, today);
  const da = drillAudit(state, today);
  const staffRows = (state.staff ?? []).map((n) => {
    const t = ta.rows.find((r) => r.name === n);
    const mark = t.hours === 0 ? '⬜ 0 学时' : t.level === 'short' ? `🟡 ${t.hours} 学时` : `🟢 ${t.hours} 学时`;
    return `<tr><td>${esc(n)}</td><td>${mark}</td><td><button class="btn small ghost" data-action="staff-remove" data-name="${esc(n)}">删</button></td></tr>`;
  }).join('');
  const trainingRows = (state.trainings ?? []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((t) => `<tr><td>${esc(t.dateISO)}</td><td>${esc(t.topic)}</td><td>${t.hours} 学时</td><td>${esc(t.attendees.join('、'))}</td></tr>`).join('');
  const drillRows = (state.drills ?? []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .map((d) => `<tr><td>${esc(d.dateISO)}</td><td>${esc(DRILL_TYPES[d.type].label)}</td><td>${esc(d.topic)}</td><td>${d.count} 人</td></tr>`).join('');
  const drillMark = (x) => x.level === 'none' ? '🔴 从未演练' : x.level === 'overdue' ? `🔴 超期（上次 ${esc(x.last ?? '')}）` : x.level === 'due' ? `🟡 临近（上次 ${esc(x.last ?? '')}）` : `🟢 正常（上次 ${esc(x.last ?? '')}）`;
  return `
  <h2 class="sec">人与证 · 证件不超期，学时有账，演练有数</h2>
  <div class="card">
    <h3>员工名单（培训学时与动火单的人名基础）</h3>
    <form id="staff-form" class="inline"><input type="text" id="staff-name" placeholder="姓名" required /><button class="btn small" type="submit" data-action="staff-add">加人</button></form>
    ${staffRows ? `<table class="list"><tr><th>姓名</th><th>${year} 年学时（红线 ${ta.minHours}）</th><th></th></tr>${staffRows}</table>` : '<p class="hint">先加员工，再记培训。</p>'}
    ${ta.zero.length ? `<p class="hint warn-hint">🔴 ${year} 年 0 学时：${esc(ta.zero.join('、'))}</p>` : ''}
    ${ta.short.length ? `<p class="hint warn-hint">🟡 学时未达红线：${esc(ta.short.join('、'))}</p>` : ''}
  </div>
  <div class="card">
    <h3>登记培训</h3>
    <form id="training-form">
      <div class="grid2">
        <label>日期<input type="date" id="tr-date" value="${today}" /></label>
        <label>学时（整数）<input type="number" id="tr-hours" min="1" max="99" value="2" /></label>
      </div>
      <label>主题<input type="text" id="tr-topic" placeholder="如：车间用电安全 + 灭火器实操" /></label>
      <label>参训人员（多选）<select id="tr-attendees" multiple size="3">${(state.staff ?? []).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></label>
      <button class="btn primary" type="submit" data-action="training-add">登记培训</button>
    </form>
    ${trainingRows ? `<table class="list"><tr><th>日期</th><th>主题</th><th>学时</th><th>参训</th></tr>${trainingRows}</table>` : '<p class="hint">还没有培训记录。</p>'}
  </div>
  <div class="card">
    <h3>应急演练体检</h3>
    <p class="hint">综合/专项预案演练每年 ≥1 次、现场处置方案每半年 ≥1 次（通识口径，设置可覆盖）。</p>
    <table class="list"><tr><th>类型</th><th>状态</th></tr>
      <tr><td>${esc(DRILL_TYPES.synth.label)}</td><td>${drillMark(da.synth)}</td></tr>
      <tr><td>${esc(DRILL_TYPES.scene.label)}</td><td>${drillMark(da.scene)}</td></tr></table>
    <form id="drill-form">
      <div class="grid2">
        <label>日期<input type="date" id="dr-date" value="${today}" /></label>
        <label>类型<select id="dr-type"><option value="scene">现场处置方案演练</option><option value="synth">综合/专项预案演练</option></select></label>
        <label>参演人数<input type="number" id="dr-count" min="1" value="5" /></label>
      </div>
      <label>主题<input type="text" id="dr-topic" placeholder="如：初起火灾扑救与疏散" /></label>
      <button class="btn primary" type="submit" data-action="drill-add">登记演练</button>
    </form>
    ${drillRows ? `<table class="list"><tr><th>日期</th><th>类型</th><th>主题</th><th>参演</th></tr>${drillRows}</table>` : '<p class="hint">还没有演练记录。</p>'}
  </div>
  <div class="card">
    <h3>证照档案（黄线 ${warnDays} 天，设置可调）</h3>
    <form id="license-form">
      <div class="grid2">
        <label>持有人/设备名<input type="text" id="lc-holder" placeholder="如：张三 / 3 号叉车" required /></label>
        <label>证种<select id="lc-kind">${Object.entries(LICENSE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}（${esc(LICENSE_SCOPES[v.scope])}）</option>`).join('')}</select></label>
        <label>证面有效期至<input type="date" id="lc-expiry" required /></label>
        <label>证号（选填）<input type="text" id="lc-certno" placeholder="证件号" /></label>
      </div>
      <button class="btn primary" type="submit" data-action="license-add">登记证件</button>
      <p class="hint">证件真伪请在官方平台核验（应急管理部特种作业操作证查询平台等）——本工具只管到期日历，不管真伪。</p>
    </form>
    ${licTable}
  </div>`;
}

// ---------------------------------------------------------------------------
// 迎检自证包
// ---------------------------------------------------------------------------

export function viewSheet(state, today) {
  const hasData = state.checks.length || state.hazards.length || state.hotworks.length || state.licenses.length || state.trainings.length || state.drills.length;
  if (!hasData) {
    return `<h2 class="sec">迎检自证包</h2><div class="card"><p class="hint">台账还是空的——先去今日台打卡、登记隐患或动火单，自证包随用随生成。</p></div>`;
  }
  const digest = selfCheckDigest(state, today);
  const text = selfCheckText(state, today);
  return `
  <h2 class="sec">迎检自证包 · 检查来之前，台账先在</h2>
  <div class="card">
    <h3>账本体检（${today}）</h3>
    <div class="stat-row">
      <div class="stat">隐患闭环率 ${digest.closedRate === null ? '—' : pill(`${digest.closedRate}%`, digest.closedRate === 100 ? 'good' : 'warn')}</div>
      <div class="stat">逾期未销案 ${pill(digest.overdueHazards, digest.overdueHazards ? 'bad' : 'good')}</div>
      <div class="stat">证照 🔴${digest.expiredLicenses} 🟡${digest.warnLicenses}</div>
      <div class="stat">动火未销票 ${pill(digest.unclosedHotworks, digest.unclosedHotworks ? 'warn' : 'good')}</div>
      <div class="stat">学时不达标 ${pill(digest.trainingShort, digest.trainingShort ? 'warn' : 'good')} 人</div>
      <div class="stat">演练超期 ${pill(digest.drillOverdue, digest.drillOverdue ? 'bad' : 'good')} 类</div>
    </div>
    <p class="hint">自查打卡累计 ${digest.checksCount} 次。体检红字清零，迎检包才有底气。</p>
  </div>
  <div class="card">
    <h3>三通道送达</h3>
    <div class="row">
      <button class="btn" data-action="sheet-copy-text">📋 复制快报文本（微信发安全员/镇街）</button>
      <button class="btn" data-action="sheet-download-html">⬇️ 下载打印版（单文件 HTML）</button>
      <button class="btn" data-action="sheet-print">🖨️ 直接打印</button>
    </div>
    <p class="hint">打印版含：证照状态、隐患闭环台账、动火台账、培训与演练记录、账本体检与签字栏——检查要看的都在一页纸上。</p>
  </div>
  <div class="card">
    <h3>快报文本预览</h3>
    <pre class="sheet-pre" id="sheet-text">${esc(text)}</pre>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings;
  const o = state.org ?? {};
  return `
  <h2 class="sec">设置 · 厂档与规则参数</h2>
  <div class="card">
    <h3>厂档</h3>
    <form id="org-form">
      <div class="grid2">
        <label>企业名称<input type="text" id="org-name" value="${esc(o.name ?? '')}" placeholder="如：××五金制品厂" /></label>
        <label>业态<select id="org-industry">${Object.entries(INDUSTRIES).map(([k, v]) => `<option value="${k}"${k === (o.industry ?? 'other') ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label>安全负责人<input type="text" id="org-person" value="${esc(o.person ?? '')}" placeholder="通常是厂长本人" /></label>
        <label>联系电话<input type="tel" id="org-phone" value="${esc(o.phone ?? '')}" /></label>
      </div>
      <button class="btn primary" type="submit" data-action="save-org">保存厂档</button>
    </form>
  </div>
  <div class="card">
    <h3>规则参数（通识口径默认值，属地规则与最新公告永远赢）</h3>
    <form id="settings-form">
      <div class="grid2">
        <label>证照黄线（距到期天数）<input type="number" id="st-warn" min="7" max="180" value="${s.licenseWarnDays}" /></label>
        <label>隐患默认整改期限（天）<input type="number" id="st-due" min="1" max="90" value="${s.checkDueDays}" /></label>
        <label>年度学时红线（学时/人/年）<input type="number" id="st-hours" min="1" max="200" value="${s.annualMinHours}" /></label>
        <label>综合预案演练周期（天）<input type="number" id="st-synth" min="30" max="730" value="${s.drillSynthDays}" /></label>
        <label>现场处置演练周期（天）<input type="number" id="st-scene" min="30" max="365" value="${s.drillSceneDays}" /></label>
      </div>
      <button class="btn primary" type="submit" data-action="save-settings">保存参数</button>
      <p class="hint">改这里不会改法律：检查口径以属地应急管理部门与最新公告为准；参数只是把通识先验落成本厂日历。</p>
    </form>
  </div>
  <div class="card">
    <h3>数据自持</h3>
    <div class="row">
      <button class="btn" data-action="export-json">⬇️ 导出备份（JSON）</button>
      <label class="btn file-btn">⬆️ 导入备份<input type="file" id="import-file" accept=".json" data-action="import-json" /></label>
      <button class="btn ghost" data-action="seed-demo">载入示例数据</button>
      <button class="btn danger" data-action="wipe-all">清空全部数据</button>
    </div>
    <p class="hint">全部数据只存在本机浏览器（本地优先）：员工名单、证件号、隐患与动火记录不出设备；换机用导出/导入。本地埋点 ${state.events.length} 条（验证闭环用）。</p>
  </div>`;
}
