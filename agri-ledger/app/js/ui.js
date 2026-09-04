/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  PRODUCT_KINDS, TOXICITY_LEVELS,
  batchRemaining, stockOf,
  expiredBatches, nearExpiryBatches, conservation, complianceAudit,
  purchaseLedgerRows, saleLedgerRows, purchaseLedgerText, saleLedgerText,
  fmtYuan, escapeHtml, todayISO, addDays,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const KIND_ICON = { pesticide: '🧪', seed: '🌱', fertilizer: '🧺' };

export function viewOnboarding() {
  return `
  <h2 class="sec">农资店，先有一本拿得出手的购销账</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>《农药管理条例》要求经营者建立采购、销售台账并保存 2 年以上（第 26、27 条），不执行台账制度会被责令改正、罚款；"电子台账"更是农药经营许可的法定条件。出了药害纠纷，拿不出进货来源与销售记录的门店往往直接担责（最高法涉农典型案例）。乡镇门店的现状：纸台账懒得记、Excel 不会用、谁的台账都在抽屉里睡觉。</p>
    <p><strong>购销单的做法：</strong>进货建批（登记批号/追溯码/效期）→ 卖货落账（限用农药强制实名）→ 禁限用名录当场亮红灯 → 效期临期先知道、过期自动踢出卖场 → 执法检查一键打印台账包、药害索赔按人 30 秒出证。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏪 先建店铺档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不做农药追溯平台报送、不做进销存财务软件——那是监管平台与通用软件的事；这里是门店自己的底账。数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：销售汇总 + 效期红灯/黄灯 + 实名缺漏 + 账实体检）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.products?.length) return viewOnboarding();
  const today = todayISO();
  const nearDays = state.settings?.nearExpiryDays ?? 90;
  const expired = expiredBatches(state, today);
  const near = nearExpiryBatches(state, today, nearDays).slice(0, 8);
  const audit = complianceAudit(state, today);
  const cons = conservation(state);
  const todaySales = (state.sales ?? []).filter((s) => s.dateISO === today);
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const todayAmount = todaySales.reduce((sum, s) => sum + s.items.reduce((t, it) => t + (it.priceCents ?? 0) * it.qty, 0), 0);
  const stockUnits = state.products.reduce((sum, p) => sum + stockOf(state, p.id, today), 0);

  const alerts = [];
  if (expired.length) {
    alerts.push(`<div class="card alert issue"><strong>⚠ 过期在库（过期农药按劣质农药管理，须立即下架封存）</strong>
      <ul>${expired.map((x) => `<li>${esc(x.productName)}：剩 ${x.remaining} 件，效期至 ${esc(x.expireISO)} 已过——
        <button class="btn small" data-action="seal-batch" data-idx="${x.batchId}">一键封存报损</button></li>`).join('')}</ul></div>`);
  }
  if (near.length) {
    alerts.push(`<div class="card alert"><strong>⏰ 临期批次（${nearDays} 天内到期，先卖临期）</strong>
      <ul>${near.map((x) => `<li>${esc(x.productName)}：剩 ${x.remaining} 件，${x.daysLeft === 0 ? '今天' : `${x.daysLeft} 天后`}（${esc(x.expireISO)}）到期</li>`).join('')}</ul></div>`);
  }
  if (audit.restrictedMissingId.length) {
    alerts.push(`<div class="card alert issue"><strong>🚨 限用实名缺漏（补录数据常见，迎检会被点名）</strong>
      <ul>${audit.restrictedMissingId.map((x) => `<li>${esc(x.dateISO)} 买主「${esc(x.buyerName || '散客')}」的卖单含限用农药，缺身份证号——补录或向执法说明</li>`).join('')}</ul></div>`);
  }
  if (cons.residual !== 0) {
    alerts.push(`<div class="card alert issue"><strong>🚨 账实残差 ${cons.residual}</strong><p class="fine">进货 ${cons.inQty} ≠ 已售 ${cons.soldQty} ＋ 报损 ${cons.lossQty} ＋ 库存 ${cons.stockQty}。账本可能被手工改坏，请核对备份。</p></div>`);
  }

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">🧾 今日销售：<strong>${todaySales.length}</strong> 单 · <strong>${fmtYuan(todayAmount)}</strong></div>
    ${todaySales.length
    ? `<p class="done-note">${todaySales.map((s) => `${esc(s.buyerName || '散客')} ${s.items.length} 品`).join(' · ')}</p>`
    : '<p class="done-note">今天还没开张落账。卖出货记得进「销售」落一笔。</p>'}
  </div>
  ${alerts.join('')}
  <h2 class="sec">账本速览</h2>
  <div class="card">
    <div class="row stats-line">
      <span>商品 <strong>${state.products.length}</strong></span>
      <span>库存 <strong>${stockUnits}</strong> 件</span>
      <span>累计销售 <strong>${(state.sales ?? []).length}</strong> 单</span>
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
// 商品档案（建库即红线体检）
// ---------------------------------------------------------------------------

export function viewProducts(state) {
  const today = todayISO();
  return `
  <h2 class="sec">🧺 商品档案（${state.products.length}）</h2>
  <div class="card">
    <div class="form-grid">
      <label class="span2">商品名称<input id="prod-name" placeholder="如：4.5% 高效氯氰菊酯乳油（与标签一致）" /></label>
      <label>类别<select id="prod-kind"><option value="pesticide">农药</option><option value="seed">种子</option><option value="fertilizer">肥料</option></select></label>
      <label>登记证号/审定号<input id="prod-reg" placeholder="如 PD20101234（选填）" /></label>
      <label>生产企业<input id="prod-maker" placeholder="选填" /></label>
      <label>规格<input id="prod-spec" placeholder="如 250ml/瓶（选填）" /></label>
      <label>毒性（农药）<select id="prod-toxicity"><option value="">不适用/未标</option>${TOXICITY_LEVELS.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label>限制使用<select id="prod-restricted"><option value="">否</option><option value="1">是（定点经营、实名购买）</option></select></label>
      <label class="span2">备注<input id="prod-note" placeholder="选填" /></label>
    </div>
    <button class="btn" data-action="add-product">建档</button>
    <p class="fine">名称与内置禁用名录完全一致时拒绝建档（如「百草枯」「甲胺磷」及 2026-06-01 起全面禁售的「氧乐果」「克百威」等）；命中限制使用名录自动打「限」标。内置名录只是常见条目，以农业农村部最新公告为准，请按标签自行核对。</p>
  </div>
  ${state.products.length ? `<div class="card"><table class="plain">
    <tr><th>商品</th><th>类别</th><th>规格</th><th>生产企业</th><th>可售库存</th><th></th></tr>
    ${[...state.products].reverse().map((p) => {
    const stock = stockOf(state, p.id, today);
    const low = stock <= 0;
    return `<tr>
        <td><strong>${esc(p.name)}</strong>${p.restricted ? ' <span class="pill warn">限</span>' : ''}${p.regNo ? `<div class="basis">${esc(p.regNo)}</div>` : ''}</td>
        <td>${KIND_ICON[p.kind] ?? ''} ${PRODUCT_KINDS[p.kind].label}${p.kind === 'pesticide' && p.toxicity ? `·${esc(p.toxicity)}` : ''}</td>
        <td class="fine">${esc(p.spec || '—')}</td>
        <td class="fine">${esc(p.maker || '—')}</td>
        <td class="${low ? 'issue' : ''}">${low ? '<span class="issue">0（无库存或全过期）</span>' : `${stock} ${esc(p.unit)}`}</td>
        <td><button class="btn small ghost" data-action="del-product" data-idx="${state.products.indexOf(p)}">删除</button></td>
      </tr>`;
  }).join('')}
  </table><p class="fine">有进货记录的商品不可删除（账实一致）；「限」标商品销售时强制实名。</p></div>`
    : '<div class="card"><p class="fine">先建档商品，再登记进货。名称照着标签抄最准。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 进货（采购台账）
// ---------------------------------------------------------------------------

export function viewIntake(state) {
  const today = todayISO();
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const supplierById = new Map((state.suppliers ?? []).map((s) => [s.id, s.name]));
  const recent = [...state.batches].sort((a, b) => b.inISO.localeCompare(a.inISO)).slice(0, 30);
  return `
  <h2 class="sec">📦 进货登记（采购台账，条例第 26 条字段）</h2>
  <div class="card">
    ${state.products.length ? `
    <div class="form-grid">
      <label>商品<select id="in-product">${state.products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label>进货日<input type="date" id="in-date" value="${today}" /></label>
      <label>数量（件）<input type="number" id="in-qty" min="1" value="10" /></label>
      <label>进价（元/件，选填）<input type="number" id="in-cost" min="0" value="" /></label>
      <label>效期至（农药必填）<input type="date" id="in-expire" value="${addDays(today, 730)}" /></label>
      <label>供应商<select id="in-supplier"><option value="">—未选/散采—</option>${(state.suppliers ?? []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label>批号<input id="in-lot" placeholder="见标签（选填）" /></label>
      <label>追溯码<input id="in-trace" placeholder="标签二维码数字串（选填）" /></label>
    </div>
    <button class="btn" data-action="add-intake">进货落账</button>
    <p class="fine">农药批次必须登记效期（质量保证期，标签必印）；效期早于进货日会被拒绝。供应商在「设置」维护。</p>`
    : '<p class="fine">先在「商品」建档。</p>'}
  </div>

  <h2 class="sec">批次台账（最近 ${recent.length} 批）</h2>
  ${recent.length ? `<div class="card"><table class="plain">
    <tr><th>进货日</th><th>商品</th><th>数量</th><th>剩余</th><th>效期至</th><th>批号/追溯码</th><th>供应商</th></tr>
    ${recent.map((b) => {
    const rem = (() => { try { return batchRemaining(state, b.id); } catch { return '?'; } })();
    const expired = b.expireISO && b.expireISO < today && rem > 0;
    return `<tr class="${expired ? 'issue' : ''}">
        <td class="fine">${esc(b.inISO)}</td>
        <td><strong>${esc(productById.get(b.productId)?.name ?? '?')}</strong></td>
        <td>${b.qty}</td>
        <td>${rem}${expired ? ' ⚠' : ''}</td>
        <td class="fine">${b.expireISO ? esc(b.expireISO) : '—'}</td>
        <td class="basis">${esc(b.lotNo || '—')}${b.traceCode ? `<br/>${esc(b.traceCode)}` : ''}</td>
        <td class="fine">${esc(supplierById.get(b.supplierId) || '—')}</td>
      </tr>`;
  }).join('')}
  </table><p class="fine">剩余 = 进货 − 已售 − 报损，由流水实时派生；过期批次会在「今日」点名并一键封存。</p></div>`
    : '<div class="card"><p class="fine">还没有进货记录。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 销售（限用实名强制 + FIFO 分配）
// ---------------------------------------------------------------------------

export function viewSale(state) {
  const today = todayISO();
  const recent = [...(state.sales ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 20);
  const hasStock = state.products.some((p) => stockOf(state, p.id, today) > 0);
  return `
  <h2 class="sec">🧾 记一笔销售（卖出即落账，条例第 27 条字段）</h2>
  <div class="card">
    ${state.products.length && hasStock ? `
    <div class="form-grid">
      <label>日期<input type="date" id="sale-date" value="${today}" /></label>
      <label>购买人姓名<input id="sale-buyer" placeholder="散客可留空；限用农药必填" /></label>
      <label>联系电话<input id="sale-phone" placeholder="选填，药害溯源有用" /></label>
      <label>身份证号<input id="sale-idno" placeholder="限用农药必填（实名购买）" /></label>
      <label>防治对象/作物<input id="sale-crop" placeholder="如：小麦蚜虫（选填）" /></label>
      <label class="span2">备注<input id="sale-note" placeholder="选填" /></label>
    </div>
    <p class="basis" style="margin:4px 0">勾选卖出商品并填数量与单价（带「限」标的商品须实名；库存不足会整单拒绝；单价留空则台账只记数量）：</p>
    <div class="row wrap">
      ${state.products.map((p) => {
    const stock = stockOf(state, p.id, today);
    return `<label class="check-chip"><input type="checkbox" class="sale-check" data-product="${p.id}" ${stock <= 0 ? 'disabled' : ''} /> ${esc(p.name)}${p.restricted ? ' <span class="pill warn">限</span>' : ''} <span class="basis">可用 ${stock}${esc(p.unit)}</span>
          <input type="number" class="sale-qty" data-product="${p.id}" min="1" value="1" style="width:56px" ${stock <= 0 ? 'disabled' : ''} />${esc(p.unit)} ×
          <input type="number" class="sale-price" data-product="${p.id}" min="0" placeholder="元/件" style="width:76px" ${stock <= 0 ? 'disabled' : ''} /></label>`;
  }).join('')}
    </div>
    <button class="btn" data-action="add-sale" style="margin-top:10px">销售落账</button>
    <p class="fine">批次分配：效期近的先出（临期先发）、同效期先进先出——卖出去的每一件都能追到批号与追溯码，药害自证才拿得出证据。</p>`
    : '<p class="fine">先在「商品」建档并完成一次「进货」——有库存才能卖。</p>'}
  </div>

  <h2 class="sec">销售台账（最近 ${recent.length} 单）</h2>
  ${recent.length ? `<div class="card"><table class="plain">
    <tr><th>日期</th><th>购买人</th><th>明细</th><th>金额</th><th></th></tr>
    ${recent.map((s) => {
    const amount = s.items.reduce((t, it) => t + (it.priceCents ?? 0) * it.qty, 0);
    const detail = s.items.map((it) => `${esc(state.products.find((p) => p.id === it.productId)?.name ?? '?')}×${it.qty}${it.allocations.length > 1 ? `（跨 ${it.allocations.length} 批）` : ''}`).join('、');
    return `<tr>
        <td class="fine">${esc(s.dateISO)}</td>
        <td><strong>${esc(s.buyerName || '散客')}</strong>${s.crop ? `<div class="basis">${esc(s.crop)}</div>` : ''}</td>
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
  const hasSales = (state.sales ?? []).length > 0;
  const proofBlock = proofCache
    ? `<div class="card"><strong>自证单预览（${esc(proofCache.key)}${proofCache.dateISO ? ` · ${esc(proofCache.dateISO)}` : ''}，命中 ${proofCache.count} 单）</strong>
      <pre class="preview">${esc(proofCache.text)}</pre>
      <div class="row"><button class="btn" data-action="proof-copy">📋 复制自证单文本</button></div></div>`
    : '';
  return `
  <h2 class="sec">🛡️ 药害自证单（按人一查，当场拿证据）</h2>
  <div class="card">
    <div class="row">
      <label>购买人姓名<input id="proof-buyer" placeholder="如：王老汉" /></label>
      <label>限定日期（选填）<input type="date" id="proof-date" /></label>
      <button class="btn" data-action="proof-generate">出证</button>
    </div>
    <p class="fine">最高法涉农典型案例：农资经营者拿不出进货来源与产品信息即可能担责。这张单子含卖出的商品、批号、追溯码、效期与实名记录——药害索赔、执法调查、平台投诉都用得上。</p>
    ${proofBlock}
  </div>

  <h2 class="sec">📒 购销台账（条例第 26、27 条口径）</h2>
  <div class="card">
    <div class="row">
      <button class="btn ghost" data-action="ledger-copy-purchase">📋 复制采购台账</button>
      <button class="btn ghost" data-action="ledger-copy-sale">📋 复制销售台账</button>
    </div>
    <h2 class="sec" style="margin-top:10px">采购台账预览</h2>
    <pre class="preview">${esc(purchaseLedgerText({ state, todayISOStr: today, limit: 12 }))}</pre>
    <h2 class="sec" style="margin-top:10px">销售台账预览</h2>
    <pre class="preview">${esc(saleLedgerText({ state, todayISOStr: today, limit: 12 }))}</pre>
  </div>

  <h2 class="sec">🖨️ 迎检打印包（单文件 HTML / 直接打印）</h2>
  <div class="card">
    ${purchaseLedgerRows(state).length || hasSales ? `
    <div class="row">
      <button class="btn" data-action="inspection-download">⬇️ 下载迎检打印包</button>
      <button class="btn ghost" data-action="inspection-print">🖨️ 直接打印</button>
    </div>
    <p class="fine">包含：店铺与许可证号 · 账本体检结论（进货＝已售＋报损＋库存）· 采购台账 · 销售台账（限用实名列）· 库存效期盘点。单文件 HTML，微信传给儿女电脑打印也行。</p>`
    : '<p class="fine">先有进货或销售记录，打印包才有内容。</p>'}
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置（店铺 / 供应商 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const shop = state.shop ?? {};
  const audit = complianceAudit(state, todayISO());
  const cons = conservation(state);
  return `
  <h2 class="sec">🏪 店铺档案（印在台账与自证单上）</h2>
  <div class="card">
    <div class="form-grid">
      <label>门店名称<input id="shop-name" value="${esc(shop.name ?? '')}" placeholder="如：张记农资" /></label>
      <label>农药经营许可证号<input id="shop-license" value="${esc(shop.licenseNo ?? '')}" placeholder="如：农农经许（县）字第××号" /></label>
      <label>联系电话<input id="shop-phone" value="${esc(shop.phone ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-shop">保存</button>
    <p class="fine">「电子台账」是农药经营许可的法定条件（《农药经营许可管理办法》第 7 条）；追溯扫码设备仍需门店自备，本工具支持手输追溯码。</p>
  </div>

  <h2 class="sec">🚚 供应商（${(state.suppliers ?? []).length}）</h2>
  <div class="card">
    ${(state.suppliers ?? []).length ? `<table class="plain">
      <tr><th>名称</th><th>联系人</th><th>电话</th><th></th></tr>
      ${state.suppliers.map((s, i) => `<tr><td>${esc(s.name)}</td><td>${esc(s.contact || '—')}</td><td>${esc(s.phone || '—')}</td>
        <td><button class="btn small ghost" data-action="del-supplier" data-idx="${i}">删除</button></td></tr>`).join('')}
    </table>` : '<p class="fine">登记常用批发商，进货台账会自动带上「供货人」字段。</p>'}
    <div class="row">
      <input id="sup-name" placeholder="供应商名称" />
      <input id="sup-contact" placeholder="联系人" style="width:110px" />
      <input id="sup-phone" placeholder="电话" style="width:130px" />
      <button class="btn small" data-action="add-supplier">添加</button>
    </div>
  </div>

  <h2 class="sec">🔔 参数与账本体检</h2>
  <div class="card">
    <div class="row">
      <label>临期提醒窗<input type="number" id="set-near" min="7" max="365" value="${state.settings?.nearExpiryDays ?? 90}" style="width:80px" /> 天</label>
      <button class="btn small" data-action="save-settings">保存参数</button>
    </div>
    <p class="fine" style="margin-bottom:6px">账实体检：进货 <strong>${cons.inQty}</strong> ＝ 已售 <strong>${cons.soldQty}</strong> ＋ 报损 <strong>${cons.lossQty}</strong> ＋ 库存 <strong>${cons.stockQty}</strong>${cons.residual === 0 ? '（残差 0，账实一致 ✅）' : `（<span class="issue">残差 ${cons.residual}，请核查</span>）`}；合规自查：过期在库 <strong>${audit.expiredOnShelf.length}</strong> 批、限用实名缺漏 <strong>${audit.restrictedMissingId.length}</strong> 单${audit.bannedProducts.length ? `、<span class="issue">禁用商品档案 ${audit.bannedProducts.length} 个（只可能来自导入数据）</span>` : ''}。</p>
    <p class="fine">临期窗按你的周转节奏改；过期批次必须下架封存（过期农药按劣质农药管理，经营即违法）。</p>
  </div>

  <h2 class="sec">⚙️ 数据与备份</h2>
  <div class="card">
    <p class="fine" style="margin-top:0">数据仅存于本机浏览器。换手机/给家人备份：导出 JSON 文件，到目标设备导入（台账要保存 2 年以上，别只靠一台手机）。本地事件流（使用埋点）可单独导出，用于产品验证。</p>
    <div class="row">
      <button class="btn block" data-action="export-json">⬇️ 导出备份</button>
      <label class="btn ghost block" style="line-height:2.4">
        ⬆️ 导入备份<input type="file" id="import-file" accept=".json" hidden />
      </label>
      <button class="btn ghost block" data-action="export-events">📈 导出使用记录</button>
    </div>
  </div>`;
}
