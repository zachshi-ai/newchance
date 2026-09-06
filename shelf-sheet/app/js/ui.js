/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  STORAGE_KINDS, REFUSAL_REASONS, OUT_WAYS, DUTY_KINDS,
  TEMP_SLOTS, DEFAULT_WARN_DAYS, DEFAULT_RED_DAYS, DEFAULT_CARE_DAYS, DEFAULT_GAP_DAYS,
  certClock, licenseState,
  shelfBoard, openQuarantines, openExceededReadings, readingGaps,
  careState, dutyBoard, healthCheck, monthlySummary, monthlyRefusals,
  escapeHtml, todayISO,
} from './core.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// 内联 SVG 图标（stroke: currentColor；零依赖、随主题变色）
// ---------------------------------------------------------------------------

const IC = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  board: IC('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  shelf: IC('<path d="M4 4v16"/><path d="M20 4v16"/><path d="M4 9.5h16M4 15h16"/><path d="M8 9.5V6h4v3.5M13 15v-3.5h4V15"/>'),
  ledger: IC('<path d="M4 20l1.2-4.2L16.6 4.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M13.5 7.5l3 3"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  store: IC('<path d="M4 10v10h16V10"/><path d="M3 10l2-5h14l2 5"/><path d="M3 10h18"/><path d="M10 20v-5h4v5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  shield: IC('<path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.3-7 9-4.1-1.7-7-4.7-7-9V5.8z"/><path d="M9 11.8l2.2 2.2L15.4 9.6"/>'),
  cross: IC('<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>'),
  box: IC('<path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2z"/><path d="M4 7.2l8 4.2 8-4.2M12 11.4V21"/>'),
  trash: IC('<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.5h9.2L17.5 7"/><path d="M10.2 10.5v6M13.8 10.5v6"/>'),
  calendar: IC('<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>'),
  trend: IC('<path d="M3 7.5l5.5 5.5 3.5-3.5L20.5 18"/><path d="M20.5 12.5V18H15"/>'),
  alert: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  gauge: IC('<path d="M5 20a9 9 0 1 1 14 0"/><path d="M12 13l3.5-3.5"/><circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  up: IC('<path d="M12 19V8.5"/><path d="M7.5 13 12 8.5 16.5 13"/><path d="M5 4.5h14"/>'),
  hand: IC('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v7.5"/><path d="M8 12l-2.2 2.2a1.6 1.6 0 0 0 0 2.3L10 20.5h6.5a3.5 3.5 0 0 0 3.5-3.5V13.5"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', due: 'warn', ok: 'ok', never: 'bad', unset: 'bad', expired: 'bad', red: 'bad', warn: 'warn' };
const LEVEL_TEXT = { overdue: '逾期', due: '临期', ok: '正常', never: '从未执行', unset: '未登记', expired: '已过期', red: '红线', warn: '催销' };

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
  <h2 class="sec">药店的第一本效期账，从下架第一盒过期药开始</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>零售药店的法定义务每天都在走：药品要按批号管效期（第 57 条）、直接接触药品人员每年体检（第 50 条）、储存要冷藏防潮防虫鼠并记录（第 59 条、84 号令第 41 条）、处方药凭处方销售且不得开架（条例第 43 条、84 号令第 42 条）、经营许可证 5 年一换（条例第 42 条）。<strong>超过有效期的药品是劣药</strong>（第 98 条）：卖一盒，货值 10~20 倍罚款、零售不足 1 万按 1 万计——一盒 15 元的药，罚款 10 万~20 万起步。而小微药店的现状是效期靠记忆 + 纸登记本 + 检查前突击清货架。</p>
    <p><strong>药清账的做法：</strong>药店建档（许可证/药师注册证双钟）→ 药品建档、进货建批（批号+效期三色档自动点名）→ 每天 30 秒温湿度日双录（超限必须写处置）→ 无处方就拒售、拒售即登记（拒下的每一单都是没被罚的证据）→ 月度养护一键打卡 → 一键出近效期催销处置单 / 迎检自证包 / 月度小结。</p>
    <div class="row">
      <a class="btn" href="#/store">${icon('store')} 先把药店建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是药店自查与效期管理的底账，不碰药品追溯码报送、不做进销存与医保结算；顾客信息建议只登记姓氏或尾号，数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：双证钟 + 过期在架 + 近效期 + 温湿度 + 隔离 + 养护/义务点名）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.pharmacy?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const warnDays = settings.warnDays ?? DEFAULT_WARN_DAYS;
  const redDays = settings.redDays ?? DEFAULT_RED_DAYS;
  const gapDays = settings.gapDays ?? DEFAULT_GAP_DAYS;
  const boxes = [];

  const lic = licenseState(state.pharmacy, today);
  if (lic.level === 'overdue' || lic.level === 'unset') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>药品经营许可证${lic.level === 'overdue' ? '已过期' : '未登记'}</strong></div><ul><li>${esc(lic.detail)}——许可证有效期 5 年（条例第 42 条、84 号令第 17 条），无证经营货值 15~30 倍罚款（第 115 条）。去「药店」补登记有效期。</li></ul></div>`);
  } else if (lic.level === 'due') {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>许可证临期</strong></div><ul><li>${esc(lic.detail)}——届满需继续经营的，向原发证部门申请重新核发（条例第 42 条）。</li></ul></div>`);
  }

  const shelf = shelfBoard(state, today, settings);
  if (shelf.expired.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('alert')}</span><strong>过期药品仍在架（${shelf.expired.length} 批次）</strong></div>
      <ul>${shelf.expired.slice(0, 6).map((v) => `<li>${esc(v.drugName)}（批号 ${esc(v.batchNo)}）效期至 ${esc(v.expiryISO)}，已过期 ${-v.daysLeft} 天 × ${v.qty} 盒——超过有效期的药品是劣药（第 98 条），立即下架隔离</li>`).join('')}</ul>
      <p class="fine">销售劣药：货值 10~20 倍罚款，零售不足 1 万按 1 万计（第 117 条）——下架永远比辩解便宜。</p></div>`);
  }
  if (shelf.red.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>近效期红线（≤${redDays} 天，${shelf.red.length} 批次）</strong></div>
      <ul>${shelf.red.slice(0, 6).map((v) => `<li>${esc(v.drugName)}（批号 ${esc(v.batchNo)}）剩 ${v.daysLeft} 天——下架隔离或专区催销，去「药架」出库</li>`).join('')}</ul></div>`);
  } else if (shelf.warn.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>催销窗口（≤${warnDays} 天，${shelf.warn.length} 批次）</strong></div>
      <ul><li>${esc(shelf.warn[0].drugName)}（批号 ${esc(shelf.warn[0].batchNo)}）最先到期（${esc(shelf.warn[0].expiryISO)}）——先进先出，「报表」页可出催销处置单贴柜台</li></ul></div>`);
  }

  const gaps = readingGaps(state, today, gapDays);
  if (gaps.never) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>温湿度从未记录</strong></div><ul><li>按温度控制要求储存并做监测记录（84 号令第 41 条；第 59 条冷藏防潮防虫鼠）——每天上午/下午各一笔，30 秒。去「台账」记第一笔</li></ul></div>`);
  } else if (gaps.missing.length) {
    boxes.push(`<div class="card alert ${gaps.missingDays >= gapDays ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>温湿度漏录 ${gaps.missing.length} 笔</strong></div>
      <ul>${gaps.missing.slice(0, 4).map((m) => `<li>${esc(m.dateISO)} 缺${TEMP_SLOTS[m.slot]}记录——今天补如实补录</li>`).join('')}</ul></div>`);
  }
  const openTemp = openExceededReadings(state);
  if (openTemp.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('alert')}</span><strong>温湿度超限未处置（${openTemp.length}）</strong></div>
      <ul>${openTemp.slice(0, 5).map((r) => `<li>${esc(r.dateISO)}${TEMP_SLOTS[r.slot]}：场所 ${r.tempC}℃ / 湿度 ${r.rhPct}%——超限不可怕，写明处置措施并复测才是合规，去「台账」销案</li>`).join('')}</ul></div>`);
  }

  const qt = openQuarantines(state);
  if (qt.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('box')}</span><strong>隔离批次待处置结论（${qt.length}）</strong></div>
      <ul>${qt.slice(0, 5).map((q) => `<li>${esc(q.drugName)}（批号 ${esc(q.batchNo)}）× ${q.qty}，${esc(q.dateISO)} 隔离——销毁/退货要留痕，去「药架」销案</li>`).join('')}</ul></div>`);
  }

  const care = careState(state, today, settings.careDays ?? DEFAULT_CARE_DAYS);
  if (care.level === 'never' || care.level === 'overdue') {
    boxes.push(`<div class="card alert ${care.level === 'overdue' ? 'issue' : ''}"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>月度养护${care.level === 'never' ? '从未登记' : '已逾期'}</strong></div>
      <ul><li>${care.level === 'never' ? '检查细则要求定期检查陈列存放药品（重点：近效期/拆零/易变质）——今天巡一次货架，登记 10 秒' : `上次养护 ${esc(care.lastISO)}，已过周期 ${-care.daysLeft} 天`}</li></ul></div>`);
  }
  const duties = dutyBoard(state, today).filter((d) => d.level === 'overdue' || d.level === 'never' || d.level === 'due');
  if (duties.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>周期义务点名</strong></div>
      <ul>${duties.map((d) => `<li>${esc(d.label)}：${d.level === 'never' ? '从未执行' : d.level === 'overdue' ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}（依据：${esc(d.basis)}）</li>`).join('')}</ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>许可证在期、无过期在架、温湿度记录齐全且无超限、隔离全销案、养护与义务在期——继续保持，效期账每天看一眼。</li></ul></div>`);
  }

  // hero：体检计分环 + 三只钟 + 本月计数
  const hc = healthCheck(state, today, settings);
  const month = today.slice(0, 7);
  const sum = monthlySummary(state, month, today, settings);
  const reg = certClock(state.pharmacy.pharmacistRegExpiryISO, today);
  const licChip = lic.level === 'ok'
    ? { cls: 'ok', big: '在期', sub: `至 ${state.pharmacy.licenseExpiryISO}` }
    : lic.level === 'due'
      ? { cls: 'warn', big: `剩 ${lic.daysLeft} 天`, sub: '届满重新核发' }
      : lic.level === 'overdue'
        ? { cls: 'bad', big: '已过期', sub: lic.detail }
        : { cls: 'bad', big: '未登记', sub: '先补建档信息' };
  const expChip = shelf.expired.length
    ? { cls: 'bad', big: `${shelf.expired.length} 批`, sub: '过期在架=劣药红线' }
    : shelf.red.length
      ? { cls: 'warn', big: `${shelf.red.length} 批`, sub: `红线内 ≤${redDays} 天` }
      : { cls: 'ok', big: '0', sub: '无过期在架批次' };
  const tempChip = openTemp.length
    ? { cls: 'bad', big: `${openTemp.length} 笔`, sub: '超限未处置' }
    : gaps.never
      ? { cls: 'bad', big: '未开始', sub: '从未记录温湿度' }
      : gaps.missing.length
        ? { cls: 'warn', big: `缺 ${gaps.missing.length} 笔`, sub: `近 ${gapDays} 天有漏录` }
        : { cls: 'ok', big: '齐全', sub: `近 ${gapDays} 天无漏录` };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · 药师${state.pharmacy.pharmacistName ? ` ${esc(state.pharmacy.pharmacistName)}` : '未登记'}${reg.level === 'due' ? `（注册证剩 ${reg.daysLeft} 天）` : ''}</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${licChip.cls}"><span class="chip-label">许可证钟</span><span class="chip-big">${esc(licChip.big)}</span><span class="chip-sub">${esc(licChip.sub)}</span></div>
        <div class="chip ${expChip.cls}"><span class="chip-label">效期红灯</span><span class="chip-big">${esc(expChip.big)}</span><span class="chip-sub">${esc(expChip.sub)}</span></div>
        <div class="chip ${tempChip.cls}"><span class="chip-label">温湿度</span><span class="chip-big">${esc(tempChip.big)}</span><span class="chip-sub">${esc(tempChip.sub)}</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${sum.readings}</b><span>本月温湿度笔数</span></div>
      <div class="stat"><b>${monthlyRefusals(state, month)}</b><span>本月拒售笔数</span></div>
      <div class="stat"><b>${shelf.units}</b><span>在架盒数（支）</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/shelf">去记药架</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 药店（建档 + 双证钟 + 周期义务）
// ---------------------------------------------------------------------------

export function viewStore(state) {
  const s = state.pharmacy ?? {};
  const today = todayISO();
  const lic = licenseState(s, today);
  const reg = certClock(s.pharmacistRegExpiryISO, today);
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;
  return `
  <h2 class="sec">药店建档与双证</h2>
  <div class="card">
    <div class="form-grid">
      <label>药店名称 *<input id="ph-name" value="${esc(s.name ?? '')}" placeholder="如：杏林堂大药房" /></label>
      <label>负责人<input id="ph-manager" value="${esc(s.manager ?? '')}" /></label>
      <label>电话<input id="ph-phone" value="${esc(s.phone ?? '')}" /></label>
      <label class="span2">地址<input id="ph-address" value="${esc(s.address ?? '')}" /></label>
      <label>许可证编号<input id="ph-licenseno" value="${esc(s.licenseNo ?? '')}" placeholder="药品经营许可证号" /></label>
      <label>许可证有效期至 *<input id="ph-license-exp" type="date" value="${esc(s.licenseExpiryISO ?? '')}" /></label>
      <label>药师姓名<input id="ph-rx-name" value="${esc(s.pharmacistName ?? '')}" placeholder="执业药师/药师" /></label>
      <label>药师注册证号<input id="ph-rx-no" value="${esc(s.pharmacistRegNo ?? '')}" /></label>
      <label>注册证有效期至<input id="ph-rx-exp" type="date" value="${esc(s.pharmacistRegExpiryISO ?? '')}" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-pharmacy">保存药店信息</button>
      <span class="stats-line">许可证钟&nbsp;${pill(lic.level)}&nbsp;<span class="basis" style="display:inline">${esc(lic.detail)}</span></span>
    </div>
    <p class="fine">药品零售须经县级以上地方药监部门批准并取得药品经营许可证，许可证标明有效期和经营范围，到期重新审查发证（《药品管理法》第 51 条）；有效期 5 年（条例第 42 条、84 号令第 17 条）。经营处方药、甲类非处方药的应当配备药师或其他药学技术人员（84 号令第 10 条），药师负责处方审核和调配（第 58 条）。</p>
  </div>

  <h2 class="sec">周期义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)} · ${v.cycleDays}天</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="体检人数/校准机构/参训人员（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="set-duty">登记完成</button></div>
    ${(() => {
    const rows = dutyBoard(state, today).map((d) => {
      const lv = d.level === 'never' ? 'never' : d.level;
      const next = d.level === 'never' ? '从未执行' : `${esc(d.nextDue)}（${d.daysLeft < 0 ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}）`;
      return `<tr class="${lv === 'never' || lv === 'overdue' ? 'muted' : ''}"><td>${esc(d.label)}</td><td>${d.lastDoneISO ? esc(d.lastDoneISO) : '—'}</td><td>${next}</td><td><span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span></td><td class="basis w"><span>${esc(d.basis)}</span></td></tr>`;
    }).join('');
    return `<div class="tbl"><table class="plain"><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${rows || '<tr><td colspan="5">尚未登记——从员工健康检查开始（第 50 条明文义务）</td></tr>'}</table></div>`;
  })()}
    <p class="fine">周期为参数化默认值（健康检查 365 天为《药品管理法》第 50 条口径；校准与培训为通识周期），属地要求永远赢。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 药架（药品建档 + 批次效期 + 出库与隔离销案）
// ---------------------------------------------------------------------------

export function viewShelf(state) {
  const today = todayISO();
  const settings = state.settings ?? {};
  const e = esc;
  const warnDays = settings.warnDays ?? DEFAULT_WARN_DAYS;
  const redDays = settings.redDays ?? DEFAULT_RED_DAYS;

  const drugOptions = (state.drugs ?? []).map((d) => `<option value="${e(d.id)}">${e(d.name)}${d.spec ? `（${e(d.spec)}）` : ''}</option>`).join('');
  const board = shelfBoard(state, today, settings);
  const shelfRow = (v) => `<tr class="${v.level === 'expired' || v.level === 'red' ? '' : ''}">
    <td>${e(v.drugName)}${v.spec ? `（${e(v.spec)}）` : ''}</td><td>${e(v.batchNo)}</td>
    <td>${e(STORAGE_KINDS[v.storage] ?? v.storage)}</td><td>${e(v.expiryISO)}</td>
    <td>${v.daysLeft < 0 ? `<strong>已过期 ${-v.daysLeft} 天</strong>` : v.daysLeft}</td><td>${v.qty}</td>
    <td><span class="pill ${LEVEL_PILL[v.level] ?? ''}">${LEVEL_TEXT[v.level] ?? v.level}</span></td>
    <td class="w"><span>${e(v.location || '—')}</span></td>
    <td><button class="btn small" data-action="show-out" data-idx="${v.id}">出库</button></td>
  </tr>`;
  const allShelf = [...board.expired, ...board.red, ...board.warn, ...board.ok];
  const shelfRows = allShelf.map(shelfRow).join('');

  const drugRows = (state.drugs ?? []).map((d) => {
    const count = (state.batches ?? []).filter((b) => b.drugId === d.id && b.qty > 0)
      .reduce((n, b) => n + b.qty, 0);
    return `<tr><td>${e(d.name)}</td><td>${e(d.spec || '—')}</td><td>${e(STORAGE_KINDS[d.storage] ?? d.storage)}</td><td>${e(d.approvalNo || '—')}</td><td>${count}</td><td><button class="btn small ghost" data-action="del-drug" data-idx="${d.id}">删</button></td></tr>`;
  }).join('');

  const outList = [...(state.outs ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20);
  const outRows = outList.map((o) => {
    const b = (state.batches ?? []).find((x) => x.id === o.batchId);
    const d = b ? (state.drugs ?? []).find((x) => x.id === b.drugId) : null;
    return `<tr><td>${e(o.dateISO)}</td><td>${e(d?.name || '—')}</td><td>${e(b?.batchNo || '—')}</td><td>${o.qty}</td><td>${e(OUT_WAYS[o.way] ?? o.way)}</td><td class="w"><span>${e(o.note || '—')}</span></td><td><button class="btn small ghost" data-action="del-out" data-idx="${o.id}">撤</button></td></tr>`;
  }).join('');

  const qtRows = openQuarantines(state).map((q) => `<tr class="muted">
    <td>${e(q.dateISO)}</td><td>${e(q.drugName)}</td><td>${e(q.batchNo)}</td><td>${q.qty}</td>
    <td><strong>待处置</strong></td><td><button class="btn small" data-action="show-close-quar" data-idx="${q.id}">销案</button></td>
  </tr>`).join('');

  return `
  <h2 class="sec">药品建档（一次建档，批次按批号进）</h2>
  <div class="card">
    <div class="form-grid">
      <label>药品名称 *<input id="dg-name" placeholder="如：阿莫西林胶囊" /></label>
      <label>规格<input id="dg-spec" placeholder="如：0.25g×24粒" /></label>
      <label>储藏分类<select id="dg-storage">${Object.entries(STORAGE_KINDS).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join('')}</select></label>
      <label>批准文号<input id="dg-approval" placeholder="国药准字…" /></label>
      <label class="span2">生产企业<input id="dg-maker" placeholder="可空" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-drug">建档</button><span class="basis">储藏分类照说明书标示抄——「阴凉/冷藏」的药品温区限值更严，分类错了温湿度判定就失真</span></div>
    <div class="tbl"><table class="plain"><tr><th>药品</th><th>规格</th><th>储藏</th><th>批准文号</th><th>在架</th><th></th></tr>${drugRows || '<tr><td colspan="6">还没有药品建档</td></tr>'}</table></div>
  </div>

  <h2 class="sec">进货建批（批号/效期照包装抄，三色档自动点名）</h2>
  <div class="card">
    <div class="form-grid">
      <label>药品 *<select id="bt-drug">${drugOptions || '<option value="">先建档药品</option>'}</select></label>
      <label>产品批号 *<input id="bt-batch" placeholder="照包装抄" /></label>
      <label>效期至 *<input id="bt-expiry" type="date" /></label>
      <label>数量（盒/支）*<input id="bt-qty" type="number" min="1" value="1" /></label>
      <label class="span2">货位<input id="bt-loc" placeholder="如：阴凉柜 2 层（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-batch" ${drugOptions ? '' : 'disabled'}>入架</button><span class="basis">购销记录应注明产品批号、有效期（《药品管理法》第 57 条）；红线 ≤${redDays} 天、催销 ≤${warnDays} 天（可在设置覆盖）</span></div>
    <div class="tbl"><table class="plain"><tr><th>药品</th><th>批号</th><th>储藏</th><th>效期至</th><th>剩余天数</th><th>在架</th><th>档位</th><th>货位</th><th></th></tr>${shelfRows || '<tr><td colspan="9">货架上还没有批次——进第一笔货</td></tr>'}</table></div>
  </div>

  <h2 class="sec">下架隔离销案（不合格药品：隔离 → 销毁/退货留痕）</h2>
  <div class="card">
    <div class="tbl"><table class="plain"><tr><th>隔离日</th><th>药品</th><th>批号</th><th>数量</th><th>状态</th><th></th></tr>${qtRows || '<tr><td colspan="6">没有待处置的隔离批次</td></tr>'}</table></div>
    <p class="fine">「下架隔离」「召回下架」出库会自动生成待处置隔离单——销毁或退回供应商后销案，检查问起不合格药品去向，这里就是答案。</p>
  </div>

  <h2 class="sec">出库流水（可撤销：记错自救）</h2>
  <div class="card">
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>药品</th><th>批号</th><th>数量</th><th>方式</th><th>备注</th><th></th></tr>${outRows || '<tr><td colspan="7">还没有出库记录</td></tr>'}</table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 台账（温湿度日双录 / 拒售登记 / 养护）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;
  const settings = state.settings ?? {};
  const L = { ...settings };

  const readings = [...(state.readings ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || (a.slot === 'am' ? -1 : 1)).slice(0, 30);
  const readRows = readings.map((r) => `<tr class="${r.exceeded && !r.handled ? '' : ''}">
    <td>${e(r.dateISO)} ${TEMP_SLOTS[r.slot]}</td><td>${r.tempC}℃</td><td>${r.rhPct}%</td>
    <td>${r.coolTempC === null || r.coolTempC === undefined ? '—' : `${r.coolTempC}℃`}</td>
    <td>${r.coldTempC === null || r.coldTempC === undefined ? '—' : `${r.coldTempC}℃`}</td>
    <td>${r.exceeded ? (r.handled ? `<span class="pill warn">已处置</span>` : `<span class="pill bad">未处置</span>`) : '<span class="pill ok">正常</span>'}</td>
    <td class="w"><span>${r.handled ? `${e(r.handledISO)}：${e(r.measure)}` : e(r.note || '—')}</span></td>
    <td>${r.exceeded && !r.handled ? `<button class="btn small" data-action="show-handle-reading" data-idx="${r.id}">处置</button>` : `<button class="btn small ghost" data-action="del-reading" data-idx="${r.id}">删</button>`}</td>
  </tr>`).join('');

  const refusals = [...(state.refusals ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 30);
  const rfRows = refusals.map((r) => `<tr>
    <td>${e(r.dateISO)}</td><td>${e(r.customer || '—')}</td><td>${e(r.drugName || '—')}</td>
    <td>${e(REFUSAL_REASONS[r.reason] ?? r.reason)}</td><td class="w"><span>${e(r.note || '—')}</span></td>
  </tr>`).join('');

  const cares = [...(state.cares ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20);
  const careRows = cares.map((c) => `<tr>
    <td>${e(c.dateISO)}</td><td>${c.found}</td><td class="w"><span>${e(c.measure || '—')}</span></td><td class="w"><span>${e(c.note || '—')}</span></td>
  </tr>`).join('');
  const care = careState(state, today, settings.careDays ?? DEFAULT_CARE_DAYS);

  return `
  <h2 class="sec">温湿度日双录（上午/下午各一笔，30 秒）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="tp-date" type="date" value="${e(today)}" /></label>
      <label>时段<select id="tp-slot"><option value="am">上午</option><option value="pm">下午</option></select></label>
      <label>场所温度（℃）*<input id="tp-temp" type="number" step="0.1" placeholder="${e(`${L.normalMin ?? 10}~${L.normalMax ?? 30}`)}" /></label>
      <label>湿度（%RH）*<input id="tp-rh" type="number" step="1" placeholder="${e(`${L.rhMin ?? 35}~${L.rhMax ?? 75}`)}" /></label>
      <label>阴凉柜（℃）<input id="tp-cool" type="number" step="0.1" placeholder="≤${e(String(L.coolMax ?? 20))}，可空" /></label>
      <label>冷藏柜（℃）<input id="tp-cold" type="number" step="0.1" placeholder="${e(`${L.coldMin ?? 2}~${L.coldMax ?? 8}`)}，可空" /></label>
      <label class="span2">备注<input id="tp-note" placeholder="天气/客流/设备情况（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-reading">记录</button><span class="basis">超限的记录照样收——但要写处置措施并复测；每天两笔是行业通识口径，属地更严的按属地</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期/时段</th><th>场所温度</th><th>湿度</th><th>阴凉柜</th><th>冷藏柜</th><th>判定</th><th>处置/备注</th><th></th></tr>${readRows || '<tr><td colspan="8">还没有温湿度记录——今天第一笔</td></tr>'}</table></div>
  </div>

  <h2 class="sec">拒售登记簿（拒下的每一单都是没被罚的证据）</h2>
  <div class="card">
    <div class="form-grid">
      <label>日期<input id="rf-date" type="date" value="${e(today)}" /></label>
      <label>顾客（建议姓氏/尾号）<input id="rf-customer" placeholder="如：刘先生" /></label>
      <label>药品<input id="rf-drug" placeholder="如：头孢克肟" /></label>
      <label>原因<select id="rf-reason">${Object.entries(REFUSAL_REASONS).map(([k, v]) => `<option value="${k}">${e(v)}</option>`).join('')}</select></label>
      <label class="span2">备注<input id="rf-note" placeholder="如：已引导持处方再来/建议就医（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-refusal">登记拒售</button><span class="basis">药品零售企业应当凭处方销售处方药（条例第 43 条）；处方保留不少于 5 年、处方药不得开架销售、不得买赠（84 号令第 42 条）</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>顾客</th><th>药品</th><th>原因</th><th>备注</th></tr>${rfRows || '<tr><td colspan="5">还没有拒售登记</td></tr>'}</table></div>
  </div>

  <h2 class="sec">月度养护（${settings.careDays ?? DEFAULT_CARE_DAYS} 天周期，巡货架 + 查近效期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>养护日期<input id="cr-date" type="date" value="${e(today)}" /></label>
      <label>发现异常品种数<input id="cr-found" type="number" min="0" value="0" /></label>
      <label class="span2">处置措施<input id="cr-measure" placeholder="有异常必填：下架/隔离/退回（如：2 盒近效期乳膏下架隔离）" /></label>
      <label class="span2">备注<input id="cr-note" placeholder="重点区域：近效期/拆零/易变质/中药饮片（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-care">登记养护</button><span class="basis">养护钟&nbsp;<span class="pill ${LEVEL_PILL[care.level] ?? ''}">${LEVEL_TEXT[care.level] ?? care.level}</span>&nbsp;${esc(care.detail)}</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>异常品种</th><th>处置措施</th><th>备注</th></tr>${careRows || '<tr><td colspan="4">还没有养护记录——今天巡一次货架</td></tr>'}</table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表（月度小结 / 体检 / 出证三通道）
// ---------------------------------------------------------------------------

export function viewReports(state, repMonth, cached) {
  const today = todayISO();
  const month = repMonth ?? today.slice(0, 7);
  const e = esc;

  return `
  <h2 class="sec">月度小结（微信文本通道）</h2>
  <div class="card">
    <div class="row">
      <label>月份<input id="rep-month" type="month" value="${e(month)}" /></label>
      <button class="btn" data-action="rep-apply">生成</button>
      <button class="btn ghost" data-action="rep-copy">复制文本</button>
    </div>
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到连锁督导群或存档——含温湿度/效期/拒售/隔离报损/养护/义务六段与法条口径尾注。</p>'}
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
    <p class="fine">单文件含：许可与双证、效期三档点名、近 30 天温湿度、拒售登记簿、隔离与处置、养护台账、周期义务、八项体检——持续合规对口《药品管理法》第 53 条，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <button class="btn" data-action="clearance-download">${icon('print')} 近效期催销处置单</button>
    </div>
    <p class="fine">贴柜台照单执行：过期立即下架隔离、红线批次下架或专区催销、催销窗口先进先出——质量负责人与营业员双签字。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  return `
  <h2 class="sec">参数（说明书与属地规则永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>催销线（天）<input id="set-warn" type="number" min="30" max="365" value="${s.warnDays ?? DEFAULT_WARN_DAYS}" /></label>
      <label>下架红线（天）<input id="set-red" type="number" min="7" max="365" value="${s.redDays ?? DEFAULT_RED_DAYS}" /></label>
      <label>养护周期（天）<input id="set-care" type="number" min="7" max="180" value="${s.careDays ?? DEFAULT_CARE_DAYS}" /></label>
      <label>温湿度断更红线（天）<input id="set-gap" type="number" min="1" max="7" value="${s.gapDays ?? DEFAULT_GAP_DAYS}" /></label>
      <label>场所温度下限（℃）<input id="set-nmin" type="number" value="${s.normalMin ?? 10}" /></label>
      <label>场所温度上限（℃）<input id="set-nmax" type="number" value="${s.normalMax ?? 30}" /></label>
      <label>湿度下限（%RH）<input id="set-rmin" type="number" value="${s.rhMin ?? 35}" /></label>
      <label>湿度上限（%RH）<input id="set-rmax" type="number" value="${s.rhMax ?? 75}" /></label>
      <label>阴凉柜上限（℃）<input id="set-coolmax" type="number" value="${s.coolMax ?? 20}" /></label>
      <label>冷藏柜下限（℃）<input id="set-coldmin" type="number" value="${s.coldMin ?? 2}" /></label>
      <label>冷藏柜上限（℃）<input id="set-coldmax" type="number" value="${s.coldMax ?? 8}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">催销 180 天/红线 90 天为行业通识先验（药典凡例：常温 10~30℃、阴凉 ≤20℃、冷处 2~10℃；冷藏品种多以 2~8℃ 管理）；药品说明书标示的储藏条件、属地 GSP 口径与连锁制度永远赢——有更严要求就在这里改严。</p>
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与事件流；顾客姓氏/尾号等信息也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例药店（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯（过期在架/温湿度超限）→ 建批三色档 → 温湿度双录 → 拒售登记 → 隔离销案 → 三通道出证。</p>
  </div>`;
}
