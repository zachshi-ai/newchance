/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  PRODUCT_KINDS, PURCHASE_SOURCES, DAYCHECK_ITEMS_BASE, DUTY_KINDS, CHANGE_KINDS, EVENT_SOURCES,
  DEFAULT_RENEW_WARN_DAYS, DEFAULT_CHANNEL_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
  licenseState, suspensionState, onSaleProducts, channelState,
  daycheckItemsFor, openChanges, openEvents, dutyBoard,
  healthCheck, monthlySummary, todaySales,
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
  ledger: IC('<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1z"/>'),
  reports: IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>'),
  settings: IC('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none"/>'),
  shield: IC('<path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.3-7 9-4.1-1.7-7-4.7-7-9V5.8z"/><path d="M9 11.8l2.2 2.2L15.4 9.6"/>'),
  clock: IC('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>'),
  cart: IC('<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2.4l2.2 11.4a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20.5 8H6"/>'),
  check: IC('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.8-5.4"/>'),
  bell: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
  calendar: IC('<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>'),
  dl: IC('<path d="M12 4v10.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M5 19.5h14"/>'),
  print: IC('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="1.5"/><path d="M7 14h10v6H7z"/>'),
  up: IC('<path d="M12 19V8.5"/><path d="M7.5 13 12 8.5 16.5 13"/><path d="M5 4.5h14"/>'),
  trend: IC('<path d="M3 7.5l5.5 5.5 3.5-3.5L20.5 18"/><path d="M20.5 12.5V18H15"/>'),
  box: IC('<path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5z"/><path d="M3 8.5 12 14l9-5.5"/><path d="M12 14v7"/>'),
  alert: IC('<path d="M12 4.2 21 19H3z"/><path d="M12 10v4"/><path d="M12 16.6v.4"/>'),
};

const icon = (name) => ICONS[name] ?? '';

const LEVEL_PILL = { overdue: 'bad', nolegal: 'bad', quarantined: 'bad', due: 'warn', window: 'warn', warn: 'warn', stale: 'warn', ok: 'ok', never: 'bad', unset: 'bad', none: 'ok', offSale: 'bad' };
const LEVEL_TEXT = { overdue: '逾期', due: '临期', window: '延续窗口', warn: '临期', ok: '正常', never: '从未开展', unset: '未登记', none: '不适用', stale: '待补进', nolegal: '无合法渠道', quarantined: '来源待核', offSale: '已停售' };

/** 体检分计分环（hero 与报表卡通用，颜色按上下文由 CSS 决定） */
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
  <h2 class="sec">一家持证烟店，先有一本能证明「每笔烟都卖得干净」的账</h2>
  <div class="card lead">
    <p><strong>为什么需要它？</strong>烟草专卖零售许可证是持证经营的合法性地基，但证照之外的日常义务才是检查的高频落点：<strong>必须在当地烟草专卖批发企业进货</strong>（未在当地批发企业进货：没收违法所得，可处进货总额 5%~10% 罚款，实施条例第 56 条——2023 年第四次修订版现行）；<strong>禁止向未成年人售烟，难以判明的应当要求出示身份证件</strong>（未保法第 59 条；违者先警告、可罚 5 万，拒不改正或情节严重停业整顿、吊销执照与许可证，可罚 5 万~50 万，第 123 条）；<strong>显著位置张贴「不向未成年人售烟」标志、不得用自动售货机、不得上网卖烟</strong>（实施细则第 50/51 条）；2022 年起<strong>电子烟参照卷烟监管：必须经全国统一交易平台进货、只许卖烟草口味</strong>（电子烟办法第 19/26 条）。国家烟草专卖局 2025 年 6 月发布会披露：2024 年以来仅电子烟一项就检查持证零售户 19.1 万户次、处罚 1941 户次。而全国约 550 万户持证零售户（业内常引口径）的现状解法是：进货单塞抽屉、核验凭眼力、检查前翻箱倒柜——<strong>「货来正、不卖未成年、张榜在墙」与「能证明」之间没有小微级工具。</strong></p>
    <p><strong>烟柜账的做法：</strong>店铺建档（许可证钟，届满 30 日延续窗口自动黄）→ 品规一物一档（调味电子烟建档即拦）→ 进货台账（来源与品类错配当场拒、非正规渠道自动红旗隔离）→ <strong>售烟四闸</strong>（证在期 → 渠道合法 → 未成年人核验 → 电子烟专闸，每笔销售过闸落账自带快照）→ 每日开柜检查卡（张贴/无自助售卖/无网络售烟，异常必写处置自动转合规事件）→ 合规事件闭环 → 变更手续与周期义务账 → 一键出迎检自证包 / 当日柜台核对单 / 月度小结。</p>
    <div class="row">
      <a class="btn" href="#/station">${icon('station')} 先把店铺建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">本工具是零售户自查与应对检查的底账，不替代烟草专卖零售许可证申请、延续、变更、停业、注销等法定程序；数据只存在你设备里。许可证申请与合理布局等准入事项请向属地烟草专卖局办理。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：许可证钟 + 渠道红灯 + 今日销售 + 开柜检查 + 事件 + 义务）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.shop?.name) return viewOnboarding();
  const today = todayISO();
  const settings = state.settings ?? {};
  const boxes = [];

  const lic = licenseState(state.shop, today, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);
  if (lic.level === 'overdue' || lic.level === 'unset') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('shield')}</span><strong>许可证红灯</strong></div><ul><li>${esc(lic.detail)}</li></ul></div>`);
  } else if (lic.level === 'window' || lic.level === 'warn') {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>延续窗口/临期</strong></div><ul><li>${esc(lic.detail)}</li></ul></div>`);
  }

  const susp = suspensionState(state.shop, today);
  if (susp.level === 'overdue') {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>停业超期</strong></div><ul><li>${esc(susp.detail)}</li></ul></div>`);
  }

  const sale = onSaleProducts(state);
  const badChannel = sale.filter((p) => ['nolegal', 'quarantined'].includes(channelState(p, state, today, settings.channelWarnDays ?? DEFAULT_CHANNEL_WARN_DAYS).level));
  const staleChannel = sale.filter((p) => channelState(p, state, today, settings.channelWarnDays ?? DEFAULT_CHANNEL_WARN_DAYS).level === 'stale');
  if (badChannel.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('box')}</span><strong>渠道红灯（${badChannel.length}）</strong></div>
      <ul>${badChannel.slice(0, 4).map((p) => `<li>${esc(p.name)}（${esc(p.code)}）——${esc(channelState(p, state, today).detail)}</li>`).join('')}</ul></div>`);
  } else if (staleChannel.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('clock')}</span><strong>渠道待补进（${staleChannel.length}）</strong></div>
      <ul>${staleChannel.slice(0, 4).map((p) => `<li>${esc(p.name)}——${esc(channelState(p, state, today, settings.channelWarnDays ?? DEFAULT_CHANNEL_WARN_DAYS).detail)}</li>`).join('')}</ul></div>`);
  }

  const ts = todaySales(state, today);
  if (ts.count === 0) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('cart')}</span><strong>今日还没有销售落账</strong></div><ul><li>营业日每笔售烟过四闸落账（证在期 → 渠道合法 → 未成年人核验 → 电子烟专闸）。</li></ul></div>`);
  }

  const dcToday = (state.daychecks ?? []).find((d) => d.dateISO === today);
  if (!dcToday) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今日开柜检查未落</strong></div><ul><li>开柜先过三项现场自查（张贴标志/无自助售卖/无网络售烟），异常必写处置并自动转合规事件。</li></ul></div>`);
  }

  const ev = openEvents(state);
  if (ev.length) {
    boxes.push(`<div class="card alert issue"><div class="alert-head"><span class="alert-ic">${icon('bell')}</span><strong>合规事件未闭环（${ev.length}）</strong></div>
      <ul>${ev.slice(0, 4).map((h) => `<li>${esc(h.desc)}</li>`).join('')}</ul></div>`);
  }

  const dutiesLate = dutyBoard(state, today).filter((d) => d.level === 'never' || d.level === 'overdue');
  if (dutiesLate.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('calendar')}</span><strong>周期义务欠账（${dutiesLate.length}）</strong></div>
      <ul>${dutiesLate.slice(0, 3).map((d) => `<li>${esc(d.label)}——${esc(d.basis)}</li>`).join('')}</ul></div>`);
  }

  const openCh = openChanges(state);
  if (openCh.length) {
    boxes.push(`<div class="card alert"><div class="alert-head"><span class="alert-ic">${icon('trend')}</span><strong>变更手续未办结（${openCh.length}）</strong></div>
      <ul>${openCh.slice(0, 3).map((c) => `<li>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}（${esc(c.dateISO)}）——${esc(c.detail)}；办理后点「办结」</li>`).join('')}</ul></div>`);
  }

  if (!boxes.length) {
    boxes.push(`<div class="card alert good"><div class="alert-head"><span class="alert-ic">${icon('check')}</span><strong>今天没有红灯</strong></div><ul><li>证在期、货来正、核验留痕、检查已落——继续保持，售烟落账别断。</li></ul></div>`);
  }

  // hero：体检计分环 + 三只芯片 + 本月计数
  const hc = healthCheck(state, today, settings);
  const sum = monthlySummary(state, today.slice(0, 7), today);
  const licChip = lic.level === 'overdue'
    ? { cls: 'bad', big: '已过期', sub: '停售+延续（第 57 条）' }
    : lic.level === 'window'
      ? { cls: 'warn', big: `剩${lic.daysLeft}天`, sub: '届满 30 日前延续' }
      : { cls: 'ok', big: lic.level === 'unset' ? '未登记' : '在期', sub: lic.level === 'unset' ? '先录许可证有效期' : `至 ${state.shop.licenseExpiryISO}` };
  const chChip = badChannel.length
    ? { cls: 'bad', big: `红灯${badChannel.length}`, sub: '来源待核/无合法批次' }
    : staleChannel.length
      ? { cls: 'warn', big: `待补进${staleChannel.length}`, sub: '渠道回看窗将到' }
      : { cls: 'ok', big: sale.length ? `${sale.length}品规` : '无品规', sub: sale.length ? '渠道全部在核' : '先建档进货' };
  const salesChip = ts.count > 0
    ? { cls: 'ok', big: `${ts.count} 笔`, sub: `核验留痕 ${ts.minorBlocked} 笔` }
    : { cls: 'warn', big: '未落账', sub: '营业日每笔过闸落账' };

  return `
  <section class="hero">
    <div class="hero-body">
      <div class="hero-top">
        ${scoreRing(hc.score)}
        <div class="hero-title">
          <h3>账本体检 · ${hc.score} 分</h3>
          <p>红 ${hc.bad} · 黄 ${hc.warn} · 在售 ${sale.length} 品规 · 本月售烟 ${sum.units} 盒（条）</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="chip ${licChip.cls}"><span class="chip-label">许可证钟</span><span class="chip-big">${esc(licChip.big)}</span><span class="chip-sub">${esc(licChip.sub)}</span></div>
        <div class="chip ${chChip.cls}"><span class="chip-label">进货渠道</span><span class="chip-big">${esc(chChip.big)}</span><span class="chip-sub">${esc(chChip.sub)}</span></div>
        <div class="chip ${salesChip.cls}"><span class="chip-label">今日销售</span><span class="chip-big">${esc(salesChip.big)}</span><span class="chip-sub">${esc(salesChip.sub)}</span></div>
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><b>${sum.sales}</b><span>本月销售落账</span></div>
      <div class="stat"><b>${sum.blocked}</b><span>闸机拦截（都算没被罚）</span></div>
      <div class="stat"><b>${sum.minorBlocked}</b><span>其中未成年人核验拦截</span></div>
    </div>
    <div class="row">
      <a class="btn small" href="#/ledger">去售烟/检查</a>
      <a class="btn ghost small" href="#/reports">出证与体检明细</a>
    </div>
  </section>
  ${boxes.join('')}`;
}

// ---------------------------------------------------------------------------
// 建档（店铺证照 + 品规台账 + 变更台账 + 周期义务）
// ---------------------------------------------------------------------------

export function viewStation(state) {
  const s = state.shop ?? {};
  const today = todayISO();
  const settings = state.settings ?? {};
  const pill = (level) => `<span class="pill ${LEVEL_PILL[level] ?? ''}">${LEVEL_TEXT[level] ?? level}</span>`;

  const lic = licenseState(s, today, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);

  const kindBoxes = Object.entries(PRODUCT_KINDS).map(([k, label]) =>
    `<option value="${k}">${esc(label)}</option>`).join('');

  const pdRows = (state.products ?? []).map((p) => {
    const cs = channelState(p, state, today, settings.channelWarnDays ?? DEFAULT_CHANNEL_WARN_DAYS);
    return `<tr class="${p.onSale ? '' : 'muted'}">
    <td>${esc(p.name)}<br><span class="basis">${esc(p.code)}</span></td>
    <td>${esc(PRODUCT_KINDS[p.kind] ?? p.kind)}</td>
    <td>${p.onSale ? `在售 · ${p.stock}` : '停售'}<br><span class="basis">${p.kind === 'vape' ? '烟草味 · ' : ''}账面库存 ${p.stock}</span></td>
    <td><span class="pill ${LEVEL_PILL[cs.level] ?? ''}">${LEVEL_TEXT[cs.level] ?? cs.level}</span></td>
    <td class="ops"><button class="btn small ghost" data-action="toggle-product" data-idx="${p.id}">${p.onSale ? '停售' : '恢复'}</button></td>
  </tr>`;
  }).join('');

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr class="${c.status === 'open' ? '' : 'muted'}">
    <td>${esc(c.dateISO)}</td><td>${esc(CHANGE_KINDS[c.kind] ?? c.kind)}</td><td class="w"><span>${esc(c.detail)}</span></td>
    <td>${c.status === 'filed' ? `<span class="pill ok">已办结 ${esc(c.filedISO)}</span>` : `<span class="pill warn">未办结</span><button class="btn small" data-action="show-file-change" data-idx="${c.id}">办结</button>`}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">店铺建档与许可证钟（《烟草专卖法》第 16 条；实施细则第 22/48 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>店铺名称 *<input id="vs-name" value="${esc(s.name ?? '')}" placeholder="如：金叶便利店" /></label>
      <label>零售许可证编号 *<input id="vs-licno" value="${esc(s.licenseNo ?? '')}" placeholder="烟草专卖零售许可证" /></label>
      <label>发证机关<input id="vs-issuer" value="${esc(s.issuer ?? '')}" placeholder="如：XX县/市烟草专卖局" /></label>
      <label>许可证有效期至 *<input id="vs-licexpiry" type="date" value="${esc(s.licenseExpiryISO ?? '')}" placeholder="届满 30 日前申请延续" /></label>
      <label>营业执照统一代码<input id="vs-bizreg" value="${esc(s.bizRegNo ?? '')}" placeholder="个体户/公司执照（可空）" /></label>
      <label>店主<input id="vs-owner" value="${esc(s.owner ?? '')}" /></label>
      <label class="span2">经营地址<input id="vs-address" value="${esc(s.address ?? '')}" placeholder="应在核定地址经营——地址外经营属无证经营（实施细则第 49 条）" /></label>
      <label>联系电话<input id="vs-phone" value="${esc(s.phone ?? '')}" placeholder="可空" /></label>
      <label class="check-item"><input type="checkbox" id="vs-nearschool" ${(s.nearSchool ?? false) ? 'checked' : ''} /> <span>本店位于中小学、幼儿园周边（不予延续红线情形，如实自查——细则第 43 条(二)）</span></label>
      <label class="span2">备注<input id="vs-note" value="${esc(s.note ?? '')}" placeholder="如：2023-06 首次领证（可空）" /></label>
    </div>
    <div class="row">
      <button class="btn" data-action="save-shop">保存店铺信息</button>
      <button class="btn ghost" data-action="show-renew" ${s.licenseExpiryISO ? '' : 'disabled'}>延续办结（滚动许可证钟）</button>
      <span>${pill(lic.level)}&nbsp;<span class="basis">${esc(lic.detail)}</span></span>
    </div>
    <p class="fine">延续应在有效期届满 30 日前提出申请（实施细则第 22 条）；有效期最长不超过 5 年（第 48 条）；逾期未延续期间售烟=无证经营（实施条例第 57 条：没收违法所得+违法经营总额 20%~50% 罚款）。停业 1 个月以上应提出停业申请、停业不得超过 1 年（第 23 条，在「设置」登记）。</p>
  </div>

  <h2 class="sec">品规一物一档（卷烟/雪茄/烟丝/电子烟；调味电子烟建档即拦——电子烟办法第 26 条）</h2>
  <div class="card">
    <div class="form-grid">
      <label>品规名称 *<input id="pd-name" placeholder="如：软中华（84mm 硬盒）" /></label>
      <label>品类 *
        <select id="pd-kind">${kindBoxes}</select>
      </label>
      <label>口味（电子烟品类适用）
        <select id="pd-flavor"><option value="tobacco">烟草口味（合规）</option><option value="other">其他口味（调味——禁止销售）</option></select>
      </label>
      <label>编号/条码 *<input id="pd-code" placeholder="如：6901028…（一物一档的档主）" /></label>
      <label class="span2">备注<input id="pd-note" placeholder="规格/厂家/批发部（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-product">建档</button><span class="basis">电子烟仅允许烟草口味（禁止销售除烟草口味外的调味电子烟和可自行添加雾化物的电子烟——电子烟办法第 26 条）；库存由进货与售烟台账自动守恒，不手工改</span></div>
    <div class="tbl"><table class="plain"><tr><th>品规</th><th>品类</th><th>状态</th><th>渠道</th><th></th></tr>${pdRows || '<tr><td colspan="5">还没有品规建档——从店里的主力品规开始</td></tr>'}</table></div>
    <p class="fine">停售（清空/退出）品规历史销售台账仍可回溯；「来源待核」红旗品规在合规事件闭环前不得售出。</p>
  </div>

  <h2 class="sec">变更手续台账（实施细则第 21/56 条：载明事项变化及时申请变更）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发生日<input id="cg-date" type="date" value="${esc(today)}" /></label>
      <label>情形
        <select id="cg-kind">${Object.entries(CHANGE_KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label class="span2">说明 *<input id="cg-detail" placeholder="变更前后内容，如：新增电子烟零售业务（已报材料）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-change">登记变更</button><span class="basis">地址、经营者、许可范围（含新增电子烟）等变化应向烟草专卖局申请变更；未及时申请的责令 30 日内依法办理（实施细则第 56 条）——办理回执后点「办结」</span></div>
    <div class="tbl"><table class="plain"><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows || '<tr><td colspan="4">暂无变更事项（有变化先登记再办手续）</td></tr>'}</table></div>
  </div>

  <h2 class="sec">周期义务账（打勾自动滚动到下一周期）</h2>
  <div class="card">
    <div class="form-grid">
      <label>义务类型<select id="du-kind">${Object.entries(DUTY_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)} · ${v.cycleDays}天</option>`).join('')}</select></label>
      <label>最近完成日<input id="du-done" type="date" value="${esc(today)}" /></label>
      <label class="span2">备注<input id="du-note" placeholder="盘点范围/年报年份/对账单号（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="set-duty">登记完成</button></div>
    ${(() => {
    const rows = dutyBoard(state, today).map((d) => {
      const lv = d.level === 'never' ? 'never' : d.level;
      const next = d.level === 'never' ? '从未执行' : `${esc(d.nextDue)}（${d.daysLeft < 0 ? `已逾期 ${-d.daysLeft} 天` : `剩 ${d.daysLeft} 天`}）`;
      return `<tr class="${lv === 'never' || lv === 'overdue' ? 'muted' : ''}"><td>${esc(d.label)}</td><td>${d.lastDoneISO ? esc(d.lastDoneISO) : '—'}</td><td>${next}</td><td><span class="pill ${LEVEL_PILL[lv] ?? ''}">${LEVEL_TEXT[lv] ?? lv}</span></td><td class="basis w"><span>${esc(d.basis)}</span></td></tr>`;
    }).join('');
    return `<div class="tbl"><table class="plain"><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${rows || '<tr><td colspan="5">尚未登记——从库存月查开始记</td></tr>'}</table></div>`;
  })()}
    <p class="fine">库存月查防霉坏变质与非法生产烟草制品上柜（实施条例第 25/29 条禁售）；营业执照年报为市场监管线跨线提醒（每年 1 月 1 日~6 月 30 日报上一年度）；电子烟平台对账仅电子烟零售户需要（电子烟办法第 19 条）。周期均为参数化默认值，属地要求永远赢。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 售烟（四闸 / 进货台账 / 开柜检查 / 合规事件闭环）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const e = esc;
  const settings = state.settings ?? {};

  const pdOptions = onSaleProducts(state).map((p) => {
    const cs = channelState(p, state, today, settings.channelWarnDays ?? DEFAULT_CHANNEL_WARN_DAYS);
    return `<option value="${e(p.id)}">${e(p.name)} · 库存 ${p.stock}${['nolegal', 'quarantined'].includes(cs.level) ? ' ⛔渠道红灯' : cs.level === 'stale' ? ' ·渠道待补进' : ''}</option>`;
  }).join('');

  const saleRows = [...(state.sales ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 20).map((s) => `<tr>
    <td>${e(s.dateISO)}<br><span class="basis">证至 ${e(s.snapshot?.licenseExpiryISO || '—')}</span></td>
    <td>${e(s.productName)}<br><span class="basis">${e(s.productCode)}</span></td>
    <td>${s.qty}</td>
    <td>${e(s.minorCheck)}</td>
    <td class="ops"><button class="btn small ghost" data-action="del-sale" data-idx="${s.id}">删</button></td>
  </tr>`).join('');

  const puRows = [...(state.purchases ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 20).map((b) => {
    const pd = (state.products ?? []).find((p) => p.id === b.productId);
    return `<tr class="${b.quarantined ? 'muted' : ''}">
    <td>${e(b.dateISO)}</td>
    <td>${e(pd?.name ?? '—')}</td>
    <td>${b.source === 'other' ? '<strong>红旗</strong>·其他来源' : e(PURCHASE_SOURCES[b.source]?.split('（')[0] ?? b.source)}${b.orderNo ? `<br><span class="basis">单号 ${e(b.orderNo)}</span>` : ''}</td>
    <td>${b.qty}</td>
  </tr>`;
  }).join('');

  const dcToday = (state.daychecks ?? []).find((d) => d.dateISO === today);
  const items = daycheckItemsFor(state);
  const dcCard = `<div class="checklist">${items.map((it) => `
      <label class="check-item"><input type="checkbox" id="dc-${e(it.key)}" ${dcToday?.items.find((x) => x.key === it.key)?.ok ? 'disabled checked' : ''} /> <span>${e(it.label)}</span></label>
      <input class="dc-note" id="dcnote-${e(it.key)}" placeholder="异常时必写处置说明" ${dcToday ? 'disabled' : ''} />
    `).join('')}</div>
    <div class="row"><button class="btn" data-action="add-daycheck" ${dcToday ? 'disabled' : ''}>${dcToday ? `今日已落卡（${dcToday.status === 'issue' ? `含 ${dcToday.items.filter((i) => !i.ok).length} 项异常` : '全项正常'}）` : '落检查卡'}</button>
    <span class="basis">同日唯一；异常必须写处置说明并自动转合规事件</span></div>`;

  const evs = [...(state.events ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 15);
  const EVST = { open: ['未处置', 'bad'], fixed: ['待复查', 'warn'], closed: ['已闭环', 'ok'] };
  const evRows = evs.map((h) => `<tr class="${h.status !== 'closed' ? 'muted' : ''}">
    <td>${e(h.dateISO)}</td><td>${e(EVENT_SOURCES[h.source] ?? h.source)}</td>
    <td class="w"><span>${e(h.desc)}</span></td>
    <td>${h.status === 'open' ? '<strong>未处置</strong>' : `${e(h.actionISO || '—')}<br><span class="basis">${e(h.action || '')}</span>`}</td>
    <td><span class="pill ${EVST[h.status]?.[1] ?? ''}">${EVST[h.status]?.[0] ?? h.status}</span></td>
    <td class="ops">${h.status === 'open' ? `<button class="btn small" data-action="show-fix-event" data-idx="${h.id}">处置</button>` : h.status === 'fixed' ? `<button class="btn small" data-action="show-close-event" data-idx="${h.id}">复查销案</button>` : ''}</td>
  </tr>`).join('');

  return `
  <h2 class="sec">售烟四闸（每一笔的门禁：四闸全过才落账）</h2>
  <div class="card">
    <div class="form-grid">
      <label>售烟日期<input id="sl-date" type="date" value="${e(today)}" /></label>
      <label>品规 *
        <select id="sl-product">${pdOptions || '<option value="">先去「建档」登记品规并进货</option>'}</select>
      </label>
      <label>数量（盒/条）<input id="sl-qty" type="number" min="1" value="1" /></label>
      <label class="check-item"><input type="checkbox" id="sl-minor" /> <span>购买人疑似未成年人（难以判明）</span></label>
      <label class="check-item"><input type="checkbox" id="sl-verified" /> <span>已要求出示并核验身份证件</span></label>
      <label>核验出生日期<input id="sl-dob" type="date" placeholder="证件载明出生日期（核验后填写）" /></label>
      <label class="span2">备注<input id="sl-note" placeholder="可空" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-sale">过闸售烟</button><span class="basis">四道闸：许可证在期（《专卖法》第 3/16 条；过期=无证经营，条例第 57 条）→ 渠道合法（当地批发企业/电子烟平台进货，条例第 23 条第二款）→ 未成年人核验（未保法第 59 条禁售+核验义务）→ 电子烟专闸（平台单留痕+烟草口味，电子烟办法第 19/26 条）——任一不过，当场拦截</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>品规</th><th>数量</th><th>核验</th><th></th></tr>${saleRows || '<tr><td colspan="5">还没有销售落账——第一笔从过闸开始</td></tr>'}</table></div>
    <p class="fine">落账即存快照（许可证有效期、售后库存）；「疑似未成年未核验」直接拦截；核验后仍未满 18 周岁的当场硬拒并给法条理由。误录可删（库存自动回滚）。</p>
  </div>

  <h2 class="sec">进货台账（渠道钟的喂食器；来源与品类错配当场拒）</h2>
  <div class="card">
    <div class="form-grid">
      <label>进货日期<input id="pu-date" type="date" value="${e(today)}" /></label>
      <label>品规 *
        <select id="pu-product">${(state.products ?? []).map((p) => `<option value="${e(p.id)}">${e(p.name)}（${e(PRODUCT_KINDS[p.kind] ?? p.kind).split('（')[0]}）</option>`).join('') || '<option value="">先去「建档」登记品规</option>'}</select>
      </label>
      <label>来源 *
        <select id="pu-source">${Object.entries(PURCHASE_SOURCES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label>订单号/单据号<input id="pu-orderno" placeholder="烟卷订单/电子结算/平台单号（电子烟必留痕）" /></label>
      <label>数量（盒/条）<input id="pu-qty" type="number" min="1" value="1" /></label>
      <label class="span2">备注<input id="pu-note" placeholder="批发部/送货人/金额（可空）" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-purchase">落进货账</button><span class="basis">卷烟/雪茄/烟丝应在当地烟草专卖批发企业进货（实施条例第 23 条第二款；未在当地批发企业进货可处进货总额 5%~10% 罚款，第 56 条）；电子烟应通过全国统一交易管理平台购进（电子烟办法第 19/20 条）；误选「其他来源」自动红旗隔离该品规，核清闭环前不得售出</span></div>
    <div class="tbl"><table class="plain"><tr><th>日期</th><th>品规</th><th>来源/单号</th><th>数量</th></tr>${puRows || '<tr><td colspan="4">还没有进货落账——先进货再开卖</td></tr>'}</table></div>
  </div>

  <h2 class="sec">每日开柜检查（未保法第 59 条张贴与核验义务；细则第 50/51 条现场义务自查）</h2>
  <div class="card">${dcCard}</div>

  <h2 class="sec">合规事件闭环（开柜异常自动转入 / 烟草专卖局检查 / 自查）</h2>
  <div class="card">
    <div class="form-grid">
      <label>发现日<input id="ev-date" type="date" value="${e(today)}" /></label>
      <label>来源
        <select id="ev-source"><option value="selfcheck">自查上报</option><option value="inspection">烟草专卖局检查</option></select>
      </label>
      <label class="span2">描述 *<input id="ev-desc" placeholder="如：检查指出某批卷烟无法提供当地批发订单 / 发现有果味烟弹在架" /></label>
    </div>
    <div class="row"><button class="btn" data-action="add-event">登记事件</button><span class="basis">闭环状态机：登记 → 处置（措施+完成日）→ 复查销案（复查人+复查日）；跳级拒绝。红旗批次来源的事件闭环后，对应品规自动解除隔离</span></div>
    <div class="tbl"><table class="plain"><tr><th>发现日</th><th>来源</th><th>描述</th><th>处置</th><th>状态</th><th></th></tr>${evRows || '<tr><td colspan="6">还没有合规事件（无事即最好的事）</td></tr>'}</table></div>
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
    ${cached ? `<pre class="preview">${e(cached)}</pre>` : '<p class="fine">生成后可直接粘贴到家人群/店群存档——含销售落账/闸机拦截（未成年人核验细分）/进货/开柜检查/合规事件/许可证与义务点名/体检与法条口径尾注。</p>'}
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
    <p class="fine">单文件含：证照与许可证钟、体检明细、品规台账、进货台账、销售台账（含未成年人核验留痕）、开柜检查、合规事件闭环、变更手续、周期义务——对口实施条例第 46 条检查职权「查阅、复制……账册、单据、记录」，含签字栏。</p>
    <div class="row" style="margin-top:10px">
      <label>核对单日期<input id="case-date" type="date" value="${e(today)}" /></label>
      <button class="btn" data-action="daypass-download">${icon('dl')} 当日柜台核对单</button>
    </div>
    <p class="fine">按单打印贴烟柜后：证照核对 + 当日每笔销售与核验留痕 + 现场义务自查栏——检查进门 10 秒出示「今天每一笔烟都卖得干净」。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const e = esc;
  const s = state.settings ?? {};
  const shop = state.shop ?? {};
  const today = todayISO();
  const susp = suspensionState(shop, today);
  return `
  <h2 class="sec">参数（属地烟草专卖局要求永远赢）</h2>
  <div class="card">
    <div class="form-grid">
      <label>许可证临期提醒（天）<input id="set-renew" type="number" min="15" max="365" value="${s.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS}" /></label>
      <label>渠道回看窗提醒（天）<input id="set-channel" type="number" min="7" max="180" value="${s.channelWarnDays ?? DEFAULT_CHANNEL_WARN_DAYS}" /></label>
      <label>周期义务临期提醒（天）<input id="set-duty" type="number" min="7" max="120" value="${s.dutyWarnDays ?? DEFAULT_DUTY_WARN_DAYS}" /></label>
    </div>
    <div class="row"><button class="btn" data-action="save-settings">保存参数</button></div>
    <p class="fine">届满 30 日前申请延续（实施细则第 22 条）、停业不得超过 1 年（第 23 条）为法定口径不可调，这里只调提醒提前量；渠道回看窗（默认 90 天）是产品口径——有历史合法批次仍可售，超窗只提醒补进新订单。</p>
  </div>

  <h2 class="sec">停业登记（实施细则第 23 条）</h2>
  <div class="card">
    ${susp.level === 'none' ? `
    <div class="form-grid">
      <label>停业起始日<input id="ss-from" type="date" value="${e(today)}" /></label>
      <label class="span2">原因<input id="ss-note" placeholder="装修/返乡/盘店中（可空）" /></label>
    </div>
    <div class="row"><button class="btn ghost" data-action="start-suspension">登记停业</button><span class="basis">停业 1 个月以上应向烟草专卖局提出停业申请；停业期限不得超过一年</span></div>
    ` : `
    <div class="meta">${esc(susp.detail)}</div>
    <div class="row"><button class="btn" data-action="end-suspension">恢复营业</button></div>
    `}
  </div>

  <h2 class="sec">数据（只存本机，换机走备份）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="export-json">${icon('dl')} 导出备份</button>
      <button class="btn ghost" data-action="export-events">${icon('dl')} 导出使用记录</button>
      <label class="btn ghost" style="position:relative">${icon('up')} 导入备份<input id="import-file" type="file" accept="application/json" style="position:absolute;inset:0;opacity:0" /></label>
    </div>
    <p class="fine">备份为 JSON 文件，含全部台账与使用记录；证件号与订单号等信息也在其中，转存注意保管。</p>
  </div>

  <h2 class="sec">示例数据</h2>
  <div class="card">
    <div class="row"><button class="btn ghost" data-action="seed-demo">载入示例门店（覆盖现有数据）</button></div>
    <p class="fine">30 秒体验完整流程：建档 → 看板红灯 → 售烟四闸三连拦截（疑似未成年未核验 / 核验后未成年 / 许可证过期）→ 核验放行 → 开柜检查异常转事件 → 处置闭环 → 三通道出证。</p>
  </div>`;
}
