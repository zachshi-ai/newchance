/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  CAR_SOURCES, COST_KINDS, DISCLOSURE_FIELDS, DISCLOSURE_STATUS,
  settle, totalCostCents, agingLevel, unverifiedKeys, disclosureSummary, sellWarnings,
  inventoryRows, ledgerRows, monthlyReport,
  disclosureText, fmtYuan, fmtKm, fmtTieUp, escapeHtml, todayISO, addDays, monthKey,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const AGING_PILL = { ok: 'ok', warn: 'warn', issue: 'issue' };
const AGING_DOT = { ok: '🟢', warn: '🟡', issue: '🔴' };

export function viewOnboarding() {
  return `
  <h2 class="sec">收车即建档，卖车留证据</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>《二手车流通管理办法》要求卖方如实告知车辆的使用、修理、事故、检验、抵押等情况；隐瞒车况被认定欺诈就是「退一赔三」——一台十万的车，尾部风险四十万起。而小微车商的现状：收车信息记在脑子里、整备成本散在微信转账里、卖出全凭口头承诺——「我不知道」在法院是不成立的抗辩。</p>
    <p><strong>车况单的做法：</strong>收车建档（九项车况默认「未核查」，把「我不知道」变成必须消灭的待办）→ 整备落账（毛利永远是现算的）→ 一键生成车况披露单（微信文本 / 打印版，买方签字确认）→ 库存黄线红线自动点名（每台车每天压多少资金，清库决策有据）。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏭 先建车行档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不做收付款、不做过户代办、不做车辆网查询——数据只存在你设备里，披露单走微信与打印，买家不用装任何东西。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：库存预警 + 未核查点名 + 本月速览）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.cars?.length) return viewOnboarding();
  const today = todayISO();
  const month = monthKey(today);
  const inv = inventoryRows(state, today);
  const report = monthlyReport(state.cars, state.costs, month);
  const stockCost = inv.reduce((n, r) => n + r.totalCostCents, 0);
  const redCars = inv.filter((r) => r.aging === 'issue');
  const warnCars = inv.filter((r) => r.aging === 'warn');
  const dirtyCars = inv.filter((r) => r.unverified > 0).sort((a, b) => b.unverified - a.unverified);
  const topTie = inv.slice(0, 3);

  const alerts = [];
  if (redCars.length) {
    alerts.push(`<div class="card alert issue"><strong>🔴 库存红线（≥ ${state.settings?.issueDays ?? 75} 天）——资金决策窗口</strong>
      <ul>${redCars.map((r) => `<li>${esc(r.car.brand)}${r.car.plate ? ` · ${esc(r.car.plate)}` : ''}：在库 <strong>${r.daysInStock}</strong> 天，压着 ${fmtYuan(r.totalCostCents)}——降价清、渠道走、还是继续扛，本周给个说法</li>`).join('')}</ul></div>`);
  }
  if (dirtyCars.length) {
    alerts.push(`<div class="card alert issue"><strong>❓ 未核查车况（卖出前必须清零）</strong>
      <ul>${dirtyCars.slice(0, 5).map((r) => `<li>${esc(r.car.brand)}${r.car.plate ? ` · ${esc(r.car.plate)}` : ''}：还有 <strong>${r.unverified}</strong> 项没查——经营者有主动查明义务，「不知道」在法院不成立</li>`).join('')}${dirtyCars.length > 5 ? `<li>……另有 ${dirtyCars.length - 5} 台未核查</li>` : ''}</ul></div>`);
  }
  if (warnCars.length) {
    alerts.push(`<div class="card alert"><strong>🟡 库存黄线（≥ ${state.settings?.warnDays ?? 45} 天）</strong>
      <ul>${warnCars.map((r) => `<li>${esc(r.car.brand)}${r.car.plate ? ` · ${esc(r.car.plate)}` : ''}：在库 ${r.daysInStock} 天，资金占用 ${fmtTieUp(r.tieUpCents)}——加大推介或调价</li>`).join('')}</ul></div>`);
  }

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">🚗 在库 <strong>${inv.length}</strong> 台 · 库存投入 <strong>${fmtYuan(stockCost)}</strong> · 压钱最多：${topTie.length ? `${esc(topTie[0].car.brand)}（${fmtTieUp(topTie[0].tieUpCents)}）` : '—'}</div>
    <p class="done-note">${inv.length ? '每台车每天都在烧钱：台账见「账本」，披露见「披露单」。' : '库里没车。收一台，从「车辆」建档开始。'}</p>
  </div>
  ${alerts.join('')}
  <h2 class="sec">${month} 经营速览</h2>
  <div class="card">
    <div class="row stats-line">
      <span>收车 <strong>${report.boughtCount}</strong> 台</span>
      <span>售出 <strong>${report.soldCount}</strong> 台</span>
      <span>毛利 <strong>${fmtYuan(report.profitCents)}</strong></span>
      <span>平均周转 <strong>${report.avgDays}</strong> 天</span>
      <span>整备投入 <strong>${fmtYuan(report.costCents)}</strong></span>
    </div>
    <div class="row">
      <a class="btn" href="#/cars">🚙 收车建档 / 整备落账</a>
      <a class="btn ghost" href="#/sheet">🧾 生成车况披露单</a>
    </div>
  </div>
  <h2 class="sec">压钱排行（在库资金占用 TOP3）</h2>
  ${topTie.length ? `<div class="card"><table class="plain">
    <tr><th>车辆</th><th>在库</th><th>总成本</th><th>资金占用</th></tr>
    ${topTie.map((r) => `<tr>
      <td><strong>${esc(r.car.brand)}</strong>${r.car.plate ? `<div class="basis">${esc(r.car.plate)}</div>` : ''}</td>
      <td>${AGING_DOT[r.aging]} ${r.daysInStock} 天</td>
      <td>${fmtYuan(r.totalCostCents)}</td>
      <td><strong>${fmtTieUp(r.tieUpCents)}</strong></td>
    </tr>`).join('')}
  </table><p class="fine">资金占用 = 总成本 × 在库天数——它把「感觉压了很久」变成一个可比的数。</p></div>`
    : '<div class="card"><p class="fine">在库为空。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 车辆（建档 / 披露登记 / 整备落账 / 售出）
// ---------------------------------------------------------------------------

function disclosureEditor(car) {
  return Object.keys(DISCLOSURE_FIELDS).map((k) => {
    const item = car.disclosure[k];
    const opts = Object.keys(DISCLOSURE_STATUS)
      .map((st) => `<option value="${st}" ${st === item.status ? 'selected' : ''}>${DISCLOSURE_STATUS[st].label}</option>`).join('');
    return `<div class="disc-row">
      <label class="disc-label" title="${esc(DISCLOSURE_FIELDS[k].ask)}">${esc(DISCLOSURE_FIELDS[k].label)}</label>
      <select id="ds-${car.id}-${k}">${opts}</select>
      <input id="dn-${car.id}-${k}" value="${esc(item.note)}" placeholder="${esc(DISCLOSURE_FIELDS[k].ask)}（选填）" />
    </div>`;
  }).join('');
}

function carCard(state, car) {
  const today = todayISO();
  const s = settle(car, state.costs, today);
  const aging = agingLevel(s.daysInStock, state.settings?.warnDays, state.settings?.issueDays);
  const sum = disclosureSummary(car);
  const costs = state.costs.filter((e) => e.carId === car.id).sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const statusPill = car.status === 'sold'
    ? `<span class="pill ok">已售 · 毛利 ${fmtYuan(s.profitCents)}</span>`
    : `<span class="pill ${AGING_PILL[aging]}">${AGING_DOT[aging]} 在库 ${s.daysInStock} 天 · ${fmtTieUp(s.tieUpCents)}</span>`;
  const dirtyPill = sum.unknown > 0
    ? ` <span class="pill issue">❓ 未核查 ${sum.unknown}</span>`
    : (sum.issue > 0 ? ` <span class="pill warn">⚠️ 异常 ${sum.issue}</span>` : ' <span class="pill ok">✅ 九项已核</span>');

  const sellBlock = car.status === 'sold'
    ? `<div class="card inner">
        <strong>已售</strong>：${esc(car.soldISO)} · 售价 ${fmtYuan(car.sellCents)} · 毛利 <strong>${fmtYuan(s.profitCents)}</strong>（总成本 ${fmtYuan(s.totalCostCents)}，在库 ${s.daysInStock} 天）${car.buyer ? ` · 买家 ${esc(car.buyer)}` : ''}
        <div class="row"><button class="btn small ghost" data-action="undo-sell" data-idx="${car.id}">撤销售出（误操作回滚）</button></div>
      </div>`
    : `<div class="card inner">
        <strong>售出落账</strong>（毛利 = 售价 − 总成本，永远现算）
        ${sellWarnings(car).map((w) => `<p class="warn-note">⚠ ${esc(w)}</p>`).join('')}
        <div class="form-grid">
          <label>成交价（元）<input type="number" id="sf-price-${car.id}" min="0" placeholder="如 86800" /></label>
          <label>售出日<input type="date" id="sf-date-${car.id}" value="${today}" /></label>
          <label class="span2">买家（选填，印在披露单抬头之外）<input id="sf-buyer-${car.id}" placeholder="如：王先生 / 李女士" /></label>
        </div>
        <button class="btn" data-action="sell" data-idx="${car.id}">落账售出</button>
      </div>`;

  return `<details class="card car-card">
    <summary>
      <span class="car-title"><strong>${esc(car.brand)}</strong>${car.plate ? ` · ${esc(car.plate)}` : ''}${car.regYear ? ` <span class="basis">${car.regYear} 年 · ${esc(fmtKm(car.displayKm))}</span>` : ''}</span>
      ${statusPill}${dirtyPill}
    </summary>
    <div class="basis">来源：${esc(CAR_SOURCES[car.source]?.label ?? '其他')} · 收车 ${esc(car.buyISO)} · 收车价 ${fmtYuan(car.buyCents)} · 总成本 <strong>${fmtYuan(s.totalCostCents)}</strong>${car.vinTail ? ` · 车架尾号 ${esc(car.vinTail)}` : ''}</div>

    <h3 class="sub">九项车况披露（未核查 = 法院不认「我不知道」）</h3>
    <div class="disc-grid">${disclosureEditor(car)}</div>
    <div class="row"><button class="btn small" data-action="save-disclosure" data-idx="${car.id}">保存披露登记</button>
      <a class="btn small ghost" href="#/sheet">去生成披露单 →</a></div>

    <h3 class="sub">整备落账（${costs.length} 笔 · 合计 ${fmtYuan(s.totalCostCents - car.buyCents)}）</h3>
    ${car.status === 'stock' ? `
    <div class="form-grid">
      <label>日期<input type="date" id="cf-date-${car.id}" value="${today}" /></label>
      <label>类型<select id="cf-kind-${car.id}">${Object.keys(COST_KINDS).map((k) => `<option value="${k}">${COST_KINDS[k].label}</option>`).join('')}</select></label>
      <label>金额（元）<input type="number" id="cf-amount-${car.id}" min="0" placeholder="如 260" /></label>
      <label>项目<input id="cf-note-${car.id}" placeholder="如：更换前轮轴承（会进披露单）" /></label>
    </div>
    <div class="row"><button class="btn small" data-action="add-cost" data-idx="${car.id}">落一笔整备</button></div>`
    : '<p class="fine">已售车辆成本账已结——先撤销售出才能改账（防止历史毛利被悄悄改写）。</p>'}
    ${costs.length ? `<table class="plain"><tr><th>日期</th><th>类型</th><th>项目</th><th>金额</th><th></th></tr>
      ${costs.map((e) => `<tr><td class="fine">${esc(e.dateISO)}</td><td>${esc(COST_KINDS[e.kind]?.label ?? '其他')}</td>
        <td>${esc(e.note || '—')}</td><td>${fmtYuan(e.cents)}</td>
        <td>${car.status === 'stock' ? `<button class="btn small ghost" data-action="del-cost" data-idx="${e.id}">删</button>` : ''}</td></tr>`).join('')}
    </table>` : ''}

    ${sellBlock}
    ${car.status === 'stock' && costs.length === 0 ? `<div class="row"><button class="btn small ghost" data-action="del-car" data-idx="${car.id}">删除车档（须先清整备记录）</button></div>` : ''}
  </details>`;
}

export function viewCars(state) {
  const today = todayISO();
  const cars = [...state.cars].sort((a, b) => (a.status === b.status ? b.buyISO.localeCompare(a.buyISO) : a.status === 'stock' ? -1 : 1));
  return `
  <h2 class="sec">🚙 收车建档（收一台，建一个车档）</h2>
  <div class="card">
    <div class="form-grid">
      <label>品牌车型<input id="car-brand" placeholder="如：丰田凯美瑞 2019款" /></label>
      <label>车牌号（选填）<input id="car-plate" placeholder="如：粤A·12345" /></label>
      <label>车架号尾号（选填）<input id="car-vin" placeholder="如：AB12CD" /></label>
      <label>初登年份<input type="number" id="car-year" min="1980" max="${new Date().getFullYear() + 1}" value="${new Date().getFullYear() - 5}" /></label>
      <label>表显里程（km）<input type="number" id="car-km" min="0" placeholder="如 62000" /></label>
      <label>收车渠道<select id="car-source">${Object.keys(CAR_SOURCES).map((k) => `<option value="${k}">${CAR_SOURCES[k].label}</option>`).join('')}</select></label>
      <label>收车价（元）<input type="number" id="car-price" min="0" placeholder="如 78000" /></label>
      <label>收车日<input type="date" id="car-date" value="${today}" /></label>
      <label class="span2">备注（选填）<input id="car-note" placeholder="如：原车主一手，钥匙两把" /></label>
    </div>
    <button class="btn" data-action="add-car">建档入库（九项披露自动置为「未核查」）</button>
    <p class="fine">建档不是终点：四问体检（抵押查封？出险事故？维修记录？里程对不对？）没查的项会一直亮着「未核查」——它是待办清单，不是背景色。</p>
  </div>

  <h2 class="sec">车档台账（${state.cars.length}）</h2>
  ${cars.length ? cars.map((c) => carCard(state, c)).join('') : '<div class="card"><p class="fine">还没有车档。收第一台车，从上面建档开始。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 披露单（信任的交付物）
// ---------------------------------------------------------------------------

export function viewSheet(state, sheetCar = null) {
  if (!state.cars?.length) return viewOnboarding();
  const today = todayISO();
  const stockFirst = [...state.cars].sort((a, b) => (a.status === b.status ? b.buyISO.localeCompare(a.buyISO) : a.status === 'stock' ? -1 : 1));
  const carId = sheetCar ?? stockFirst[0]?.id;
  const car = state.cars.find((c) => c.id === carId) ?? stockFirst[0];
  let preview = '';
  let error = '';
  try {
    preview = disclosureText({ car, costs: state.costs, dealer: state.dealer, todayISOStr: today });
  } catch (e) { error = e.message; }
  const warnings = sellWarnings(car);

  return `
  <h2 class="sec">🧾 车况披露单（微信发给买家 = 信任交付）</h2>
  <div class="card">
    <div class="row">
      <label>车辆 <select id="sheet-car">${stockFirst.map((c) => `<option value="${c.id}" ${c.id === car.id ? 'selected' : ''}>${esc(c.brand)}${c.plate ? ` · ${esc(c.plate)}` : ''}${c.status === 'sold' ? '（已售）' : ''}</option>`).join('')}</select></label>
      <button class="btn small" data-action="sheet-apply">生成</button>
    </div>
    ${warnings.length ? `<div class="alert-box">${warnings.map((w) => `<p class="warn-note">⚠ ${esc(w)}</p>`).join('')}</div>` : ''}
    ${error ? `<p class="fine">⚠ ${esc(error)}</p>` : `
      <div class="row">
        <button class="btn" data-action="sheet-copy">📋 复制文本（微信发给买家）</button>
        <button class="btn ghost" data-action="sheet-download">⬇️ 下载打印版 HTML</button>
        <button class="btn ghost" data-action="sheet-print">🖨️ 直接打印</button>
      </div>
      <pre class="preview">${esc(preview)}</pre>
      <p class="fine">文本通道为主：买家不用装任何东西；打印版为单文件 HTML（含买方签字确认栏），交车时签字各留一份——「我书面告知过、买家签了字」是判例里最硬的自证证据。</p>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// 账本（库存台账 + 月度经营账）
// ---------------------------------------------------------------------------

export function viewLedger(state, ledMonth = null) {
  if (!state.cars?.length) return viewOnboarding();
  const today = todayISO();
  const month = ledMonth ?? monthKey(today);
  const rows = ledgerRows(state, today);
  const report = monthlyReport(state.cars, state.costs, month);
  const inv = inventoryRows(state, today);
  const stockCost = inv.reduce((n, r) => n + r.totalCostCents, 0);
  return `
  <h2 class="sec">📒 库存台账（${state.cars.length} 台 · 在库投入 ${fmtYuan(stockCost)}）</h2>
  <div class="card"><table class="plain">
    <tr><th>车辆</th><th>收车日</th><th>状态</th><th>总成本</th><th>售价</th><th>毛利</th><th>周转</th></tr>
    ${rows.map((r) => {
    const aging = agingLevel(r.daysInStock, state.settings?.warnDays, state.settings?.issueDays);
    const status = r.car.status === 'sold'
      ? '<span class="pill ok">已售</span>'
      : `<span class="pill ${AGING_PILL[aging]}">${AGING_DOT[aging]} 在库</span>`;
    return `<tr class="${r.car.status === 'sold' ? 'muted' : ''}">
        <td><strong>${esc(r.car.brand)}</strong>${r.car.plate ? `<div class="basis">${esc(r.car.plate)}</div>` : ''}</td>
        <td class="fine">${esc(r.car.buyISO)}</td>
        <td>${status}</td>
        <td>${fmtYuan(r.totalCostCents)}</td>
        <td>${r.car.status === 'sold' ? fmtYuan(r.car.sellCents) : '—'}</td>
        <td>${r.profitCents === null ? '—' : `<strong>${fmtYuan(r.profitCents)}</strong>`}</td>
        <td>${r.daysInStock} 天</td>
      </tr>`;
  }).join('')}
  </table><p class="fine">周转 = 收车日到售出日（在库车算到今天）。毛利 = 售价 − 总成本，改任何一笔整备账，这里自动跟着变。</p></div>

  <h2 class="sec">📅 月度经营账</h2>
  <div class="card">
    <div class="row">
      <label>月份 <input type="month" id="led-month" value="${month}" /></label>
      <button class="btn small" data-action="led-apply">查看</button>
    </div>
    <div class="row stats-line">
      <span>收车 <strong>${report.boughtCount}</strong> 台</span>
      <span>售出 <strong>${report.soldCount}</strong> 台</span>
      <span>毛利 <strong>${fmtYuan(report.profitCents)}</strong></span>
      <span>平均周转 <strong>${report.avgDays}</strong> 天</span>
      <span>整备投入 <strong>${fmtYuan(report.costCents)}</strong></span>
    </div>
    <p class="fine">「感觉赚了」和「账上赚了」是两回事——月底盘点看这里，别凭记忆。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置（车行 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const dealer = state.dealer ?? {};
  return `
  <h2 class="sec">🏭 车行</h2>
  <div class="card">
    <div class="form-grid">
      <label>车行名称<input id="dl-name" value="${esc(dealer.name ?? '')}" placeholder="如：老周车务（印在披露单上）" /></label>
      <label>联系电话<input id="dl-phone" value="${esc(dealer.phone ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-dealer">保存</button>
  </div>

  <h2 class="sec">🔔 库存预警参数（行业先验的本地覆盖）</h2>
  <div class="card">
    <div class="row">
      <label>黄线（压钱告警）<input type="number" id="set-warn" min="7" max="365" value="${state.settings?.warnDays ?? 45}" style="width:80px" /> 天</label>
      <label>红线（清库决策）<input type="number" id="set-issue" min="14" max="730" value="${state.settings?.issueDays ?? 75}" style="width:80px" /> 天</label>
    </div>
    <button class="btn small" data-action="save-settings">保存参数</button>
    <p class="fine">资金周转节奏因人而异：快进快出的车商把黄线调短，做大排量的把红线放宽——你的生意你定。</p>
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
