/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  BUSINESS_TYPES, itemsFor, dayStatus, rangeStats, completionStreak,
  weekDatesOf, addDays, todayISO,
  todayAlerts, staffWarnings, ledgerText, escapeHtml,
  weekReport, monthReport,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

function itemRow(item, rec, editing) {
  const recNote = rec?.status === 'issue' ? (rec.note ?? '') : '';
  const state =
    rec?.status === 'ok' ? '<span class="pill ok">✓ 正常</span>'
    : rec?.status === 'issue' ? `<span class="pill issue">⚠ 异常</span>`
    : '<span class="pill todo">未检</span>';
  return `
  <div class="card item-row ${rec ? 'done' : ''}" data-item="${item.id}">
    <div class="item-head">
      <div>
        <strong>${esc(item.name)}</strong>
        <div class="basis">${esc(item.basis)}${item.hint ? ` · ${esc(item.hint)}` : ''}</div>
      </div>
      ${state}
    </div>
    <div class="row actions">
      <button class="btn small" data-action="mark" data-item="${item.id}" data-status="ok">✓ 正常</button>
      <button class="btn small warn" data-action="mark" data-item="${item.id}" data-status="issue">⚠ 异常</button>
      ${rec?.status === 'issue' || editing === item.id ? `
        <input class="note-input" id="note-${item.id}" placeholder="异常说明/整改情况（会写入台账）" value="${esc(recNote)}" />
        <button class="btn small" data-action="save-issue" data-item="${item.id}">保存说明</button>` : ''}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（日管控打卡）
// ---------------------------------------------------------------------------

export function viewDashboard(state) {
  const today = todayISO();
  if (!state.store?.name) return viewOnboarding();

  const items = itemsFor(state.store.type, state.customItems);
  const st = dayStatus(today, items, state.checks);
  const alerts = todayAlerts({ dateISO: today, items, checks: state.checks, staff: state.staff });
  const streak = completionStreak(Object.keys(state.checks), items, state.checks, today);
  const pct = Math.round(st.rate * 100);

  const alertHtml = [];
  if (alerts.certs.length) {
    alertHtml.push(`<div class="card alert">
      <strong>👥 员工健康证预警</strong>
      <ul>${alerts.certs.map((c) => `<li>${esc(c.name)}：${c.level === 'expired' ? '已过期' : `${c.days} 天后到期`}（${c.expiry}）— 请尽快安排体检换证</li>`).join('')}</ul>
    </div>`);
  }
  if (alerts.issues.length) {
    alertHtml.push(`<div class="card alert issue">
      <strong>⚠ 今日异常待跟进</strong>
      <ul>${alerts.issues.map((i) => `<li>${esc(i.name)}：${esc(i.note || '未记录说明')}</li>`).join('')}</ul>
    </div>`);
  }

  return `
  <h2 class="sec">今日日管控 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-line"><div class="progress-bar" style="width:${pct}%"></div></div>
    <div class="progress-text"><strong>${st.done}/${st.total}</strong> 项完成（${pct}%）
      ${streak > 1 ? `　🔥 连续全勤 <strong>${streak}</strong> 天` : ''}
    </div>
    ${alerts.allDone
      ? '<p class="done-note">✅ 今日全部检查项已完成，可在「台账」导出或去「报告」生成周报。</p>'
      : `<p class="done-note">还差：${st.missing.map((m) => esc(m.name)).join('、')}</p>`}
  </div>
  ${alertHtml.join('')}
  <div class="grid">
    ${items.map((it) => itemRow(it, state.checks?.[today]?.[it.id])).join('')}
  </div>
  <div class="row" style="margin-top:14px">
    <a class="btn ghost" href="#/ledger">🧾 导出台账</a>
    <a class="btn ghost" href="#/reports">📋 周报 / 月报</a>
  </div>`;
}

export function viewOnboarding() {
  return `
  <h2 class="sec">三分钟建立门店食安台账</h2>
  <div class="card">
    <p><strong>为什么要用它？</strong>「日管控、周排查、月调度」是市场监管 60 号令的硬要求，检查时台账不全，先警告、拒不改正可罚 5 千~3 万元。而小店的现状是：纸质台账本靠记忆补填，检查前突击补。</p>
    <p><strong>食安哨的做法：</strong>每天开店/闭店各 30 秒逐项打卡 → 自动汇总周排查报告与月调度纪要 → 检查前一天一键导出打印版台账。数据只存在你手机里。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏪 填写门店档案开始</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不替代属地监管的法定报送系统（如当地要求的追溯平台）；本工具是你的自查与打印台账生成器。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 台账导出
// ---------------------------------------------------------------------------

export function defaultLedgerRange(today = todayISO()) {
  return { start: addDays(today, -6), end: today };
}

export function viewLedger(state, { start, end } = {}) {
  if (!state.store?.name) return viewOnboarding();
  const range = start && end ? { start, end } : defaultLedgerRange();
  const items = itemsFor(state.store.type, state.customItems);
  const stats = rangeStats(rangeDatesSafe(range.start, range.end), items, state.checks);
  const text = ledgerText({ store: state.store, items, checks: state.checks, startISO: range.start, endISO: range.end });

  return `
  <h2 class="sec">🧾 台账导出（迎检打印）</h2>
  <div class="card">
    <div class="row">
      <label>从 <input type="date" id="ledger-start" value="${range.start}" /></label>
      <label>到 <input type="date" id="ledger-end" value="${range.end}" /></label>
      <button class="btn small" data-action="ledger-apply">生成预览</button>
    </div>
    <div class="row stats-line">
      <span>应检 <strong>${stats.total}</strong> 项次</span>
      <span>完成 <strong>${stats.done}</strong></span>
      <span>完成率 <strong>${Math.round(stats.rate * 100)}%</strong></span>
      <span>漏检 <strong>${stats.missingDays.length}</strong> 天</span>
    </div>
    <div class="row">
      <button class="btn" data-action="ledger-download">⬇️ 下载打印版 HTML</button>
      <button class="btn ghost" data-action="ledger-print">🖨️ 直接打印</button>
      <button class="btn ghost" data-action="ledger-copy">📋 复制纯文本（微信粘贴）</button>
    </div>
    <p class="fine">打印版为单文件 HTML：内联样式、无外部资源，发给任何人打开都是同一张表，可直接打印/存 PDF。建议每天闭店打卡，检查前一天补漏后导出。</p>
    <pre class="preview">${esc(text)}</pre>
  </div>`;
}

function rangeDatesSafe(start, end) {
  const dates = [];
  let cur = start;
  while (cur <= end) { dates.push(cur); cur = addDays(cur, 1); if (dates.length > 366 * 2) break; }
  return dates;
}

// ---------------------------------------------------------------------------
// 报告（周排查 / 月调度）
// ---------------------------------------------------------------------------

export function viewReports(state, { tab = 'week' } = {}) {
  if (!state.store?.name) return viewOnboarding();
  const today = todayISO();
  const items = itemsFor(state.store.type, state.customItems);
  const [y, m] = today.split('-').map(Number);
  const prevMonday = addDays(weekDatesOf(today)[0], -1);

  let report;
  let label;
  if (tab === 'week-prev') {
    report = weekReport({ store: state.store, items, checks: state.checks, weekOfISO: prevMonday, todayISOStr: today });
    label = '上周排查报告';
  } else if (tab === 'month') {
    report = monthReport({ store: state.store, items, checks: state.checks, year: y, month: m, todayISOStr: today });
    label = '本月调度纪要';
  } else if (tab === 'month-prev') {
    report = monthReport({
      store: state.store, items, checks: state.checks,
      year: m === 1 ? y - 1 : y, month: m === 1 ? 12 : m - 1, todayISOStr: today,
    });
    label = '上月调度纪要';
  } else {
    report = weekReport({ store: state.store, items, checks: state.checks, weekOfISO: today, todayISOStr: today });
    label = '本周排查报告';
  }

  return `
  <h2 class="sec">📋 周排查 · 月调度</h2>
  <div class="row tabs">
    ${[['week', '本周周报'], ['week-prev', '上周周报'], ['month', '本月月报'], ['month-prev', '上月月报']]
      .map(([k, l]) => `<a class="tab ${tab === k ? 'active' : ''}" href="#/reports/${k}">${l}</a>`).join('')}
  </div>
  <div class="card">
    <div class="row stats-line">
      <span>完成率 <strong>${Math.round(report.rate * 100)}%</strong></span>
      <span>异常 <strong>${report.issueCount}</strong> 项次</span>
      <span>漏检 <strong>${report.missingDays.length}</strong> 天</span>
      <span class="fine">${label} · ${report.dates[0]} ~ ${report.dates[report.dates.length - 1]}</span>
    </div>
    <div class="row">
      <button class="btn ghost" data-action="report-copy">📋 复制报告全文</button>
      <button class="btn ghost" data-action="report-print">🖨️ 打印报告</button>
    </div>
    <pre class="preview" id="report-text">${esc(report.text)}</pre>
  </div>
  <p class="fine">报告为 60 号令《每周食品安全排查治理报告》《每月食品安全调度会议纪要》的小店简化版：由日打卡记录自动汇总，异常项需补整改说明，签字栏留手工签字。</p>`;
}

// ---------------------------------------------------------------------------
// 设置（门店档案 / 员工健康证 / 自定义项 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.store ?? {};
  const items = itemsFor(s.type || 'restaurant', state.customItems);
  const certs = staffWarnings(state.staff);

  return `
  <h2 class="sec">🏪 门店档案</h2>
  <div class="card">
    <div class="form-grid">
      <label>门店名称<input id="set-name" value="${esc(s.name ?? '')}" placeholder="营业执照上的字号" /></label>
      <label>业态
        <select id="set-type">
          <option value="">请选择</option>
          ${Object.entries(BUSINESS_TYPES).map(([k, v]) =>
            `<option value="${k}" ${s.type === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
      </label>
      <label>食品安全员<input id="set-officer" value="${esc(s.safetyOfficer ?? '')}" placeholder="通常就是老板本人" /></label>
      <label>联系电话<input id="set-phone" value="${esc(s.phone ?? '')}" /></label>
      <label class="span2">经营地址<input id="set-address" value="${esc(s.address ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-store">保存档案</button>
    <p class="fine">业态决定检查项模板：食堂/集体用餐会自动加入「食品留样」项。</p>
  </div>

  <h2 class="sec">👥 员工健康证</h2>
  <div class="card">
    ${state.staff.length ? `<table class="plain">
      <tr><th>姓名</th><th>健康证到期</th><th>状态</th><th></th></tr>
      ${state.staff.map((p, i) => {
        const w = certs.find((c) => c.name === (p.name || '（未命名员工）'));
        const badge = w
          ? `<span class="pill ${w.level === 'expired' ? 'issue' : 'warn'}">${w.level === 'expired' ? '已过期' : `${w.days} 天后到期`}</span>`
          : '<span class="pill ok">正常</span>';
        return `<tr><td>${esc(p.name || '')}</td><td>${esc(p.certExpiry || '—')}</td><td>${badge}</td>
          <td><button class="btn small ghost" data-action="del-staff" data-idx="${i}">删除</button></td></tr>`;
      }).join('')}
    </table>` : '<p class="fine">尚未添加员工。所有接触食品的员工都需持有效健康证明。</p>'}
    <div class="row">
      <input id="staff-name" placeholder="姓名" />
      <input type="date" id="staff-expiry" />
      <button class="btn small" data-action="add-staff">添加员工</button>
    </div>
  </div>

  <h2 class="sec">✅ 检查项（${s.type ? '当前模板' : '选择业态后显示'}）</h2>
  <div class="card">
    ${s.type ? `<ol class="items-list">
      ${items.map((it) => `<li><strong>${esc(it.name)}</strong> <span class="basis">${esc(it.basis)}</span></li>`).join('')}
    </ol>` : '<p class="fine">先在上方选择业态。</p>'}
    <div class="row">
      <input id="custom-name" placeholder="自定义检查项名称，如：油烟净化器清洗" />
      <button class="btn small" data-action="add-custom">添加</button>
    </div>
    ${state.customItems.length ? `<div class="row wrap">
      ${state.customItems.map((c, i) => `<span class="pill todo">${esc(c.name)} <button class="linkish" data-action="del-custom" data-idx="${i}">✕</button></span>`).join('')}
    </div>` : ''}
  </div>

  <h2 class="sec">⚙️ 数据与备份</h2>
  <div class="card">
    <p class="fine" style="margin-top:0">台账数据仅存于本机浏览器。换手机/给合伙人备份：导出 JSON 文件，到目标设备导入。本地事件流（使用埋点）可单独导出，用于产品验证。</p>
    <div class="row">
      <button class="btn block" data-action="export-json">⬇️ 导出备份</button>
      <label class="btn ghost block" style="line-height:2.4">
        ⬆️ 导入备份<input type="file" id="import-file" accept=".json" hidden />
      </label>
      <button class="btn ghost block" data-action="export-events">📈 导出使用记录</button>
    </div>
  </div>`;
}
