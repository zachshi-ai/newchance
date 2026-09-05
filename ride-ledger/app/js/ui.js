/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  PRODUCT_KINDS,
  batchRemaining, stockOf,
  expiringWarranties, expiredWarranties, conservation, complianceAudit,
  purchaseLedgerRows, saleLedgerRows, tradeinRows,
  purchaseLedgerText, saleLedgerText, tradeinLedgerText,
  fmtYuan, escapeHtml, todayISO,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const KIND_ICON = { ebike: '🛵', battery: '🔋', charger: '🔌', helmet: '⛑️', parts: '🔧' };

export function viewOnboarding() {
  return `
  <h2 class="sec">车行，先有一本拿得出手的购销账</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>电动自行车安全隐患全链条整治（2024 起）要求销售门店落实<strong>进货检查验收制度、完善购销台账</strong>，严格核查 CCC 认证，<strong>严禁整车与蓄电池拆分销售</strong>；全国已办案 6.1 万起、查处非法改装黑作坊 3473 家。以旧换新这边，交售的旧车必须交资质回收企业报废处置并<strong>完善台账管理</strong>——2025 年 8.2 万家门店参加、平均拉动单店销售 30.2 万元，补贴核验认的就是台账。车行的现状：合格证扔抽屉、车架号懒得抄、旧车谁来收全靠记性。</p>
    <p><strong>车销单的做法：</strong>整车建档强制登记 CCC → 进货建批（查验留痕）→ 卖车落账（车架号必填、电池编码必填）→ 旧车回收台账（补贴核验备查）→ 质保临期自动点名（主动售后 = 换新线索）→ 迎检一键打印台账包、事故倒查按人 30 秒出证。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏪 先建店铺档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不做上牌代办平台、不做进销存财务软件、不碰改装——那是监管平台与执法部门的事；这里是门店自己的底账。数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：销售汇总 + 临保质保 + 红线自查 + 账实体检）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.products?.length) return viewOnboarding();
  const today = todayISO();
  const winDays = state.settings?.warrantyWindowDays ?? 60;
  const expiring = expiringWarranties(state, today, winDays).slice(0, 8);
  const expiredCount = expiredWarranties(state, today).length;
  const audit = complianceAudit(state);
  const cons = conservation(state);
  const todaySales = (state.sales ?? []).filter((s) => s.dateISO === today);
  const todayAmount = todaySales.reduce((sum, s) => sum + s.items.reduce((t, it) => t + (it.priceCents ?? 0) * it.qty, 0), 0);
  const stockUnits = state.products.reduce((sum, p) => sum + stockOf(state, p.id), 0);
  const auditIssues = audit.missingCCC.length + audit.missingFrameNo.length + audit.missingBatteryCode.length + audit.tradeinNoRecycler.length;

  const alerts = [];
  if (auditIssues) {
    const items = [];
    if (audit.missingCCC.length) items.push(`<li>${audit.missingCCC.length} 个整车档案缺 CCC 证号——销售无 3C 整车是红线，先补档案</li>`);
    if (audit.missingFrameNo.length) items.push(`<li>${audit.missingFrameNo.length} 条卖单缺车架号（${audit.missingFrameNo.slice(0, 3).map((x) => esc(x.dateISO)).join('、')} 等）——上牌与倒查都认它，补录</li>`);
    if (audit.missingBatteryCode.length) items.push(`<li>${audit.missingBatteryCode.length} 条卖单缺电池编码——「一车一池一码」销端锚点，补录</li>`);
    if (audit.tradeinNoRecycler.length) items.push(`<li>${audit.tradeinNoRecycler.length} 笔回收未登记回收企业——旧车必须交资质企业报废处置</li>`);
    alerts.push(`<div class="card alert issue"><strong>🚨 台账缺项自查（迎检会被点名，就地补录）</strong><ul>${items.join('')}</ul></div>`);
  }
  if (expiring.length) {
    alerts.push(`<div class="card alert"><strong>⏰ 质保临期（${winDays} 天内到保——主动约免费安检，事故防在前、换新线索到手）</strong>
      <ul>${expiring.map((x) => `<li>${esc(x.buyerName || '散客')} · ${esc(x.productName)}：${x.daysLeft === 0 ? '今天' : `${x.daysLeft} 天后`}（${esc(x.until)}）到保${x.buyerPhone ? ` · ${esc(x.buyerPhone)}` : ''}</li>`).join('')}</ul></div>`);
  }
  if (cons.residual !== 0) {
    alerts.push(`<div class="card alert issue"><strong>🚨 账实残差 ${cons.residual}</strong><p class="fine">进货 ${cons.inQty} ≠ 已售 ${cons.soldQty} ＋ 报损 ${cons.lossQty} ＋ 库存 ${cons.stockQty}。账本可能被手工改坏，请核对备份。</p></div>`);
  }

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">🧾 今日销售：<strong>${todaySales.length}</strong> 单 · <strong>${fmtYuan(todayAmount)}</strong> · 回收 <strong>${(state.tradeins ?? []).filter((t) => t.dateISO === today).length}</strong> 笔</div>
    ${todaySales.length
    ? `<p class="done-note">${todaySales.map((s) => `${esc(s.buyerName || '散客')} ${s.items.length} 品`).join(' · ')}</p>`
    : '<p class="done-note">今天还没开张落账。卖出车记得进「销售」落一笔。</p>'}
  </div>
  ${alerts.join('')}
  <h2 class="sec">账本速览</h2>
  <div class="card">
    <div class="row stats-line">
      <span>商品 <strong>${state.products.length}</strong></span>
      <span>库存 <strong>${stockUnits}</strong> 件</span>
      <span>累计销售 <strong>${(state.sales ?? []).length}</strong> 单</span>
      <span>换新回收 <strong>${(state.tradeins ?? []).length}</strong> 笔</span>
      <span>已过保 <strong>${expiredCount}</strong> 件</span>
      <span class="${cons.residual === 0 ? 'ok' : 'issue'}">账实 <strong>${cons.residual === 0 ? '一致 ✅' : `残差 ${cons.residual}`}</strong></span>
    </div>
    <div class="row">
      <a class="btn" href="#/sale">🧾 记一笔销售</a>
      <a class="btn ghost" href="#/intake">📦 进货登记</a>
      <a class="btn ghost" href="#/ledger">🖨️ 台账出证</a>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 商品档案（整车 3C 强制）
// ---------------------------------------------------------------------------

export function viewProducts(state) {
  return `
  <h2 class="sec">🛵 商品档案（${state.products.length}）</h2>
  <div class="card">
    <div class="form-grid">
      <label class="span2">商品名称<input id="prod-name" placeholder="如：雅迪冠能3 E8（照合格证抄）" /></label>
      <label>类别<select id="prod-kind">
        <option value="ebike">整车（CCC 必填）</option><option value="battery">蓄电池</option>
        <option value="charger">充电器</option><option value="helmet">头盔</option><option value="parts">配件</option>
      </select></label>
      <label>CCC 证号（整车）<input id="prod-ccc" placeholder="合格证/铭牌上的认证编号" /></label>
      <label>品牌<input id="prod-brand" placeholder="选填" /></label>
      <label>型号<input id="prod-model" placeholder="选填" /></label>
      <label>规格<input id="prod-spec" placeholder="如 48V24Ah 锂电（选填）" /></label>
      <label>单位<input id="prod-unit" placeholder="辆/组/个/顶，默认件" /></label>
      <label>生产企业<input id="prod-maker" placeholder="选填" /></label>
      <label>质保期（月）<input type="number" id="prod-warranty" min="0" max="120" value="12" /></label>
      <label class="span2">备注<input id="prod-note" placeholder="选填" /></label>
    </div>
    <button class="btn" data-action="add-product">建档</button>
    <p class="fine">整车缺 CCC 证号直接拒绝建档——进货查验第一个动作就是核对 3C，无证整车不得销售。质保期从「售出日」起算，0 表示无质保承诺；临保质保名单会出现在「今日」。</p>
  </div>
  ${state.products.length ? `<div class="card"><table class="plain">
    <tr><th>商品</th><th>类别</th><th>CCC</th><th>规格</th><th>质保</th><th>可售库存</th><th></th></tr>
    ${[...state.products].reverse().map((p) => {
    const stock = stockOf(state, p.id);
    const low = stock <= 0;
    return `<tr>
        <td><strong>${esc(p.name)}</strong>${p.brand ? `<div class="basis">${esc(p.brand)}${p.model ? ` ${esc(p.model)}` : ''}</div>` : ''}</td>
        <td>${KIND_ICON[p.kind] ?? ''} ${PRODUCT_KINDS[p.kind].label}</td>
        <td class="fine">${p.kind === 'ebike' ? esc(p.cccNo) : '—'}</td>
        <td class="fine">${esc(p.spec || '—')}</td>
        <td class="fine">${p.warrantyMonths ? `${p.warrantyMonths} 个月` : '—'}</td>
        <td class="${low ? 'issue' : ''}">${low ? '<span class="issue">0（无库存）</span>' : `${stock} ${esc(p.unit)}`}</td>
        <td><button class="btn small ghost" data-action="del-product" data-idx="${state.products.indexOf(p)}">删除</button></td>
      </tr>`;
  }).join('')}
  </table><p class="fine">有进货记录的商品不可删除（账实一致）。「今日」页的临保名单就是这台车的主动售后触点。</p></div>`
    : '<div class="card"><p class="fine">先建档商品，再登记进货。名称与 CCC 照合格证抄最准。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 进货（进货查验 + 采购台账）
// ---------------------------------------------------------------------------

export function viewIntake(state) {
  const today = todayISO();
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const supplierById = new Map((state.suppliers ?? []).map((s) => [s.id, s.name]));
  const recent = [...state.batches].sort((a, b) => b.inISO.localeCompare(a.inISO)).slice(0, 30);
  return `
  <h2 class="sec">📦 进货登记（进货查验 + 采购台账·进端）</h2>
  <div class="card">
    ${state.products.length ? `
    <div class="form-grid">
      <label>商品<select id="in-product">${state.products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label>进货日<input type="date" id="in-date" value="${today}" /></label>
      <label>数量<input type="number" id="in-qty" min="1" value="5" /></label>
      <label>进价（元/件，选填）<input type="number" id="in-cost" min="0" value="" /></label>
      <label>批号<input id="in-lot" placeholder="随货单/合格证批号（选填）" /></label>
      <label>首码<input id="in-trace" placeholder="本批首枚车架号/电池码（选填）" /></label>
      <label>供货商<select id="in-supplier"><option value="">—未选/散采—</option>${(state.suppliers ?? []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
    </div>
    <button class="btn" data-action="add-intake">进货落账</button>
    <p class="fine">进货查验 = 核对合格证与 CCC 并记下批号/首码，查验记录就在这张台账里；整车档案缺 3C 会被拒绝进货。供货商在「设置」维护。</p>`
    : '<p class="fine">先在「商品」建档。</p>'}
  </div>

  <h2 class="sec">批次台账（最近 ${recent.length} 批）</h2>
  ${recent.length ? `<div class="card"><table class="plain">
    <tr><th>进货日</th><th>商品</th><th>数量</th><th>剩余</th><th>批号/首码</th><th>供货商</th></tr>
    ${recent.map((b) => `<tr>
        <td class="fine">${esc(b.inISO)}</td>
        <td><strong>${esc(productById.get(b.productId)?.name ?? '?')}</strong></td>
        <td>${b.qty}</td>
        <td>${batchRemaining(state, b.id)}</td>
        <td class="basis">${esc(b.lotNo || '—')}${b.traceCode ? `<br/>${esc(b.traceCode)}` : ''}</td>
        <td class="fine">${esc(supplierById.get(b.supplierId) || '—')}</td>
      </tr>`).join('')}
  </table><p class="fine">剩余 = 进货 − 已售 − 报损，由流水实时派生；卖出时按「先进先出」扣批次，每件车都能追到哪批进的货。</p></div>`
    : '<div class="card"><p class="fine">还没有进货记录。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 销售 + 以旧换新（销端台账）
// ---------------------------------------------------------------------------

export function viewSale(state) {
  const recent = [...(state.sales ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20);
  const recentTrades = [...(state.tradeins ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 10);
  const hasStock = state.products.some((p) => stockOf(state, p.id) > 0);
  const saleOptions = (state.sales ?? []).slice(-20).map((s) => `<option value="${s.id}">${esc(s.dateISO)} ${esc(s.buyerName || '散客')}（${s.items.length} 品）</option>`).join('');
  return `
  <h2 class="sec">🧾 记一笔销售（销端台账：车架号、电池码一单录全）</h2>
  <div class="card">
    ${state.products.length && hasStock ? `
    <div class="form-grid">
      <label>日期<input type="date" id="sale-date" value="${todayISO()}" /></label>
      <label>购买人姓名<input id="sale-buyer" placeholder="散客可留空；质保名单要认人" /></label>
      <label>联系电话<input id="sale-phone" placeholder="选填，临保提醒要打" /></label>
      <label class="span2">备注<input id="sale-note" placeholder="如：旧车原电池鼓包更换（单卖电池必填）" /></label>
    </div>
    <p class="basis" style="margin:4px 0">勾选卖出商品并填数量/单价/编码（整车必填车架号、电池必填电池编码；库存不足会整单拒绝）：</p>
    <div class="row wrap">
      ${state.products.map((p) => {
    const stock = stockOf(state, p.id);
    const off = stock <= 0 ? 'disabled' : '';
    return `<label class="check-chip"><input type="checkbox" class="sale-check" data-product="${p.id}" ${off} /> ${KIND_ICON[p.kind] ?? ''} ${esc(p.name)} <span class="basis">可用 ${stock}${esc(p.unit)}</span><br/>
          <input type="number" class="sale-qty" data-product="${p.id}" min="1" value="1" style="width:52px" ${off} />${esc(p.unit)} ×
          <input type="number" class="sale-price" data-product="${p.id}" min="0" placeholder="元/件" style="width:74px" ${off} />
          ${p.kind === 'ebike' ? `<input class="sale-codes" data-product="${p.id}" placeholder="车架号，多辆逗号隔开" style="width:170px" ${off} />` : ''}
          ${p.kind === 'battery' ? `<input class="sale-codes" data-product="${p.id}" placeholder="电池编码，多组逗号隔开" style="width:170px" ${off} />` : ''}
        </label>`;
  }).join('')}
    </div>
    <button class="btn" data-action="add-sale" style="margin-top:10px">销售落账</button>
    <p class="fine">整车与电池同单卖出 = 一车一池；单卖电池请务必备注用途（如「旧车换电池」），工具会提示拆分销售风险——整治行动明令禁止整车与蓄电池拆分销售。</p>`
    : '<p class="fine">先在「商品」建档并完成一次「进货」——有库存才能卖。</p>'}
  </div>

  <h2 class="sec">🔄 以旧换新 · 旧车回收台账（补贴核验备查）</h2>
  <div class="card">
    <div class="form-grid">
      <label>回收日<input type="date" id="ti-date" value="${todayISO()}" /></label>
      <label>交售人<input id="ti-buyer" placeholder="姓名" /></label>
      <label>旧车品牌<input id="ti-brand" placeholder="如：旧雅迪" /></label>
      <label>旧车车架号/车牌<input id="ti-frame" placeholder="必填——补贴核验认它" /></label>
      <label>电池数量（组）<input type="number" id="ti-batcnt" min="0" value="1" /></label>
      <label>电池重量（kg，选填）<input type="number" id="ti-batkg" min="0" step="0.1" value="" /></label>
      <label>回收企业<select id="ti-recycler"><option value="">—未选（旧车须交资质企业）—</option>${(state.recyclers ?? []).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>
      <label>补贴金额（元，选填）<input type="number" id="ti-subsidy" min="0" value="" /></label>
      <label>关联本次新售单<select id="ti-sale"><option value="">—不关联—</option>${saleOptions}</select></label>
      <label class="span2">备注<input id="ti-note" placeholder="选填" /></label>
    </div>
    <button class="btn" data-action="add-tradein">回收落账</button>
    <p class="fine">旧车必须交由具备相关资质的回收企业报废处置并完善台账（商务部以旧换新口径）；回收企业名单在「设置」维护。</p>
    ${recentTrades.length ? `<table class="plain" style="margin-top:8px">
      <tr><th>日期</th><th>交售人</th><th>旧车</th><th>车架号/车牌</th><th>回收企业</th><th>补贴</th><th></th></tr>
      ${recentTrades.map((t) => `<tr>
        <td class="fine">${esc(t.dateISO)}</td>
        <td><strong>${esc(t.buyerName || '散客')}</strong></td>
        <td class="fine">${esc(t.oldBrand || '旧车')}</td>
        <td class="fine">${esc(t.oldFrameNo)}</td>
        <td class="fine">${esc((state.recyclers ?? []).find((r) => r.id === t.recyclerId)?.name ?? (t.recyclerId ? '?' : '未登记'))}</td>
        <td>${t.subsidyCents !== null ? fmtYuan(t.subsidyCents) : '—'}</td>
        <td><button class="btn small ghost" data-action="undo-tradein" data-idx="${t.id}">撤销</button></td>
      </tr>`).join('')}
    </table>` : ''}
  </div>

  <h2 class="sec">销售台账（最近 ${recent.length} 单）</h2>
  ${recent.length ? `<div class="card"><table class="plain">
    <tr><th>日期</th><th>购买人</th><th>明细</th><th>金额</th><th></th></tr>
    ${recent.map((s) => {
    const amount = s.items.reduce((t, it) => t + (it.priceCents ?? 0) * it.qty, 0);
    const detail = s.items.map((it) => {
      const p = state.products.find((x) => x.id === it.productId);
      const codes = it.frameNos?.length ? ` (${it.frameNos[0]}${it.frameNos.length > 1 ? '…' : ''})`
        : it.batteryCodes?.length ? ` (${it.batteryCodes[0]}${it.batteryCodes.length > 1 ? '…' : ''})` : '';
      return `${esc(p?.name ?? '?')}×${it.qty}${codes}`;
    }).join('、');
    return `<tr>
        <td class="fine">${esc(s.dateISO)}</td>
        <td><strong>${esc(s.buyerName || '散客')}</strong>${s.note ? `<div class="basis">${esc(s.note)}</div>` : ''}</td>
        <td class="fine">${detail}</td>
        <td>${amount ? fmtYuan(amount) : '—'}</td>
        <td><button class="btn small ghost" data-action="undo-sale" data-idx="${s.id}">撤销</button></td>
      </tr>`;
  }).join('')}
  </table><p class="fine">撤销只删这条流水，库存自动回滚（剩余量由流水派生，账实始终一致）。</p></div>`
    : '<div class="card"><p class="fine">还没有销售记录。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 台账·出证（自证单 / 台账文本 / 迎检打印包）
// ---------------------------------------------------------------------------

export function viewLedger(state, proofCache = null) {
  if (!state.products?.length) return viewOnboarding();
  const today = todayISO();
  const hasAny = purchaseLedgerRows(state).length > 0 || (state.sales ?? []).length > 0 || (state.tradeins ?? []).length > 0;
  const proofBlock = proofCache
    ? `<div class="card"><strong>自证单预览（${esc(proofCache.key)}${proofCache.dateISO ? ` · ${esc(proofCache.dateISO)}` : ''}，命中 ${proofCache.count} 单）</strong>
      <pre class="preview">${esc(proofCache.text)}</pre>
      <div class="row"><button class="btn" data-action="proof-copy">📋 复制自证单文本</button></div></div>`
    : '';
  return `
  <h2 class="sec">🛡️ 事故倒查自证单（按人一查，当场拿证据）</h2>
  <div class="card">
    <div class="row">
      <label>购买人姓名<input id="proof-buyer" placeholder="如：李大姐" /></label>
      <label>限定日期（选填）<input type="date" id="proof-date" /></label>
      <button class="btn" data-action="proof-generate">出证</button>
    </div>
    <p class="fine">电池起火、事故倒查、市监抽检对不上账——门店要一句话说清「卖的是谁、哪辆车、什么电池、哪批进的货」。这张单子含车架号、电池编码、CCC 证号与进货批次。</p>
    ${proofBlock}
  </div>

  <h2 class="sec">📒 购销台账（进端 / 销端 / 旧车回收）</h2>
  <div class="card">
    <div class="row">
      <button class="btn ghost" data-action="ledger-copy-purchase">📋 复制进货台账</button>
      <button class="btn ghost" data-action="ledger-copy-sale">📋 复制销售台账</button>
      <button class="btn ghost" data-action="ledger-copy-tradein">📋 复制回收台账</button>
    </div>
    <h2 class="sec" style="margin-top:10px">进货台账预览</h2>
    <pre class="preview">${esc(purchaseLedgerText({ state, todayISOStr: today, limit: 10 }))}</pre>
    <h2 class="sec" style="margin-top:10px">销售台账预览</h2>
    <pre class="preview">${esc(saleLedgerText({ state, todayISOStr: today, limit: 10 }))}</pre>
    <h2 class="sec" style="margin-top:10px">旧车回收台账预览</h2>
    <pre class="preview">${esc(tradeinLedgerText({ state, todayISOStr: today, limit: 10 }))}</pre>
  </div>

  <h2 class="sec">🖨️ 迎检打印包（单文件 HTML / 直接打印）</h2>
  <div class="card">
    ${hasAny ? `
    <div class="row">
      <button class="btn" data-action="inspection-download">⬇️ 下载迎检打印包</button>
      <button class="btn ghost" data-action="inspection-print">🖨️ 直接打印</button>
    </div>
    <p class="fine">包含：店铺与承诺书 · 账本体检（进货＝已售＋报损＋库存）· 进货台账（3C 列）· 销售台账（车架号/电池码列）· 旧车回收台账 · 库存盘点。单文件 HTML，微信传回店里电脑打印即可。</p>`
    : '<p class="fine">先有进货或销售记录，打印包才有内容。</p>'}
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置（店铺 / 供货商 / 回收企业 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const shop = state.shop ?? {};
  const audit = complianceAudit(state);
  const cons = conservation(state);
  const auditIssues = audit.missingCCC.length + audit.missingFrameNo.length + audit.missingBatteryCode.length + audit.tradeinNoRecycler.length;
  return `
  <h2 class="sec">🏪 店铺档案（印在台账与自证单上）</h2>
  <div class="card">
    <div class="form-grid">
      <label>门店名称<input id="shop-name" value="${esc(shop.name ?? '')}" placeholder="如：张记电动车" /></label>
      <label>统一社会信用代码<input id="shop-license" value="${esc(shop.licenseNo ?? '')}" placeholder="营业执照上" /></label>
      <label>联系电话<input id="shop-phone" value="${esc(shop.phone ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-shop">保存</button>
    <p class="fine">以旧换新门店须做到政策图解、价格公示、监督电话、承诺书「四上墙」——打印包首页已带承诺书行。</p>
  </div>

  <h2 class="sec">🚚 供货商（${(state.suppliers ?? []).length}）与回收企业（${(state.recyclers ?? []).length}）</h2>
  <div class="card">
    ${(state.suppliers ?? []).length || (state.recyclers ?? []).length ? `<table class="plain">
      <tr><th>类型</th><th>名称</th><th>联系人/电话</th><th></th></tr>
      ${state.suppliers.map((s, i) => `<tr><td>供货商</td><td>${esc(s.name)}</td><td class="fine">${esc(s.contact || '—')} ${esc(s.phone || '')}</td>
        <td><button class="btn small ghost" data-action="del-supplier" data-idx="${i}">删除</button></td></tr>`).join('')}
      ${state.recyclers.map((r, i) => `<tr><td>回收企业</td><td>${esc(r.name)}</td><td class="fine">${esc(r.phone || '')}</td>
        <td><button class="btn small ghost" data-action="del-recycler" data-idx="${i}">删除</button></td></tr>`).join('')}
    </table>` : '<p class="fine">登记品牌代理商（供货）与资质回收企业（旧车流向），落账时一键带出。</p>'}
    <div class="row">
      <input id="sup-name" placeholder="供货商名称" />
      <input id="sup-contact" placeholder="联系人" style="width:100px" />
      <input id="sup-phone" placeholder="电话" style="width:130px" />
      <button class="btn small" data-action="add-supplier">添加供货商</button>
    </div>
    <div class="row" style="margin-top:6px">
      <input id="rec-name" placeholder="回收企业名称" />
      <input id="rec-phone" placeholder="电话" style="width:130px" />
      <button class="btn small" data-action="add-recycler">添加回收企业</button>
    </div>
  </div>

  <h2 class="sec">🔔 参数与账本体检</h2>
  <div class="card">
    <div class="row">
      <label>临保质保窗<input type="number" id="set-win" min="7" max="365" value="${state.settings?.warrantyWindowDays ?? 60}" style="width:80px" /> 天</label>
      <button class="btn small" data-action="save-settings">保存参数</button>
    </div>
    <p class="fine" style="margin-bottom:6px">账实体检：进货 <strong>${cons.inQty}</strong> ＝ 已售 <strong>${cons.soldQty}</strong> ＋ 报损 <strong>${cons.lossQty}</strong> ＋ 库存 <strong>${cons.stockQty}</strong>${cons.residual === 0 ? '（残差 0，账实一致 ✅）' : `（<span class="issue">残差 ${cons.residual}，请核查</span>）`}；台账缺项 <strong>${auditIssues}</strong> 处（3C ${audit.missingCCC.length} / 车架号 ${audit.missingFrameNo.length} / 电池码 ${audit.missingBatteryCode.length} / 回收未挂企业 ${audit.tradeinNoRecycler.length}）。</p>
    <p class="fine">临保窗是主动售后的节奏——约顾客回店免费安检，事故防在前、换新线索到手。</p>
  </div>

  <h2 class="sec">⚙️ 数据与备份</h2>
  <div class="card">
    <p class="fine" style="margin-top:0">数据仅存于本机浏览器。换手机/给家里备份：导出 JSON 文件，到目标设备导入（台账要按属地要求留存，别只靠一台手机）。本地事件流（使用埋点）可单独导出，用于产品验证。</p>
    <div class="row">
      <button class="btn block" data-action="export-json">⬇️ 导出备份</button>
      <label class="btn ghost block" style="line-height:2.4">
        ⬆️ 导入备份<input type="file" id="import-file" accept=".json" hidden />
      </label>
      <button class="btn ghost block" data-action="export-events">📈 导出使用记录</button>
    </div>
  </div>`;
}
