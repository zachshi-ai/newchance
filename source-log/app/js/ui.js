/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  ITEM_CATS, REFUSE_REASONS,
  isLowPrice, refPriceOf, freqSellers, idGaps, lowPriceBuys, healthCheck, monthlyReport,
  sourceText, outStatementText,
  fmtYuan, fmtKg, fmtUnitPrice, maskIdNo, escapeHtml, todayISO, addDays, monthKey,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

function catOptions(sel) {
  return Object.keys(ITEM_CATS)
    .map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${ITEM_CATS[k].label}${ITEM_CATS[k].needProof ? ' ❗需证明' : ITEM_CATS[k].needId ? ' ⚠需实名' : ''}</option>`)
    .join('');
}

export function viewOnboarding() {
  return `
  <h2 class="sec">来路清白，才敢收下；来路不明，留痕拒收</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>收购生产性废旧金属要查验出售单位证明并登记出售人姓名、证件号与物品明细（《废旧金属收购业治安管理办法》第八条口径），登记资料保存不少于两年；更要命的是《刑法》第三百一十二条——明知是赃物而收购，最高可判七年，而「明显低于市场价收购」「从同一人手中多次收购」都是推定「明知」的依据。废品站老板收电缆获刑的判例年年有，检察官的建议就是本产品的三个动作：<strong>查来源、做记录、来路不明拒收</strong>。</p>
    <p><strong>来路单的做法：</strong>出售人实名底档（一次建档，收购点选）→ 收购落账（生产性金属无证明当场拦截，改记拒收；明显低价强制写明原因）→ 销赃特征自动点名（同一人高频出售高危品类）→ 一键出证（登记册给检查、来源自证单给倒查、对账单给打包站）。全部数据只存在你手机里，身份证号不上云。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏪 先建站点档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不判定谁是贼（那是公安的职权），只把「查验与登记义务」变成顺手的动作；不碰网上拍卖、不接政务报送、不做行情报价——属地规则永远赢。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（点名与速览）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.sellers?.length && !state.buys?.length) return viewOnboarding();
  const today = todayISO();
  const month = monthKey(today);
  const h = healthCheck(state, today);
  const rep = monthlyReport(state, month);

  const alerts = [];
  if (h.freq.length) {
    alerts.push(`<div class="card alert issue"><strong>🔴 销赃特征点名（同一人多次出售高危品类）</strong>
      <ul>${h.freq.map((r) => `<li><strong>${esc(r.seller?.name ?? '？')}</strong>：30 天内向你出售高危品类 <strong>${r.count}</strong> 次（${esc(r.cats)}），最近 ${esc(r.lastISO)}——「从同一人手中多次收购」是推定「明知」的情形，多问一句来路，说不清就拒收并报警</li>`).join('')}</ul></div>`);
  }
  if (h.idGaps.length) {
    alerts.push(`<div class="card alert issue"><strong>🔴 实名缺口（需实名品类的收购缺证件号）</strong>
      <ul>${h.idGaps.slice(0, 5).map((r) => `<li>${esc(r.buy.dateISO)} ${esc(r.seller?.name ?? '？')} 的 ${esc(ITEM_CATS[r.buy.cat].label)}：出售人档案没登记证件号——检查现场这张就是「未如实登记」</li>`).join('')}</ul>
      <p class="fine">去「收购」页补全出售人证件号。历史缺口如实呈现，不替你藏。</p></div>`);
  }
  if (h.low.length) {
    alerts.push(`<div class="card alert"><strong>🟡 本月低价成交 ${h.low.length} 笔（原因已注明在册）</strong>
      <ul>${h.low.slice(0, 4).map((r) => `<li>${esc(r.buy.dateISO)} ${esc(ITEM_CATS[r.buy.cat].label)}：${fmtYuan(r.buy.priceCents)}${r.buy.weightKg ? `（${fmtUnitPrice(r.buy.priceCents, r.buy.weightKg)}）` : ''}——原因：${esc(r.buy.lowNote || '—')}</li>`).join('')}</ul>
      <p class="fine">「明显低于市场价」是推定「明知」的情形；注明了原因（折重/行情）就是查验过的痕迹，被问到拿得出来。</p></div>`);
  }

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">♻️ 本月收购 <strong>${rep.buys}</strong> 笔（投入 ${fmtYuan(rep.buyCents)}） · 出货 <strong>${rep.outs}</strong> 笔（${fmtYuan(rep.outCents)}） · 拒收 <strong>${rep.refuses}</strong> 笔</div>
    <p class="done-note">${rep.refuses > 0 ? `本月 ${rep.refuses} 次拒收都留了痕——拒收不是损失，是最硬的自证。` : '今天开门：查证件、问来路、记台账——三步都不落在纸上才是风险。'}</p>
  </div>
  ${alerts.join('')}
  <div class="card">
    <div class="row">
      <a class="btn" href="#/buys">➕ 收一笔记一笔（30 秒）</a>
      <a class="btn ghost" href="#/ledger">📒 登记册 / 对账单</a>
    </div>
    <p class="fine">登记资料保存不少于两年——数据在本机自动留存，随时可导出登记册备查。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 收购（出售人底档 + 落账 + 流水 + 自证单）
// ---------------------------------------------------------------------------

function sellerCard(state, s) {
  const buyCount = (state.buys ?? []).filter((b) => b.sellerId === s.id).length;
  return `<tr>
    <td><strong>${esc(s.name)}</strong>${s.phone ? `<div class="basis">${esc(s.phone)}</div>` : ''}</td>
    <td class="fine">${s.idNo ? esc(maskIdNo(s.idNo)) : '<span class="late">未录证件号（高危品类会被拦）</span>'}</td>
    <td class="fine">${buyCount} 笔</td>
    <td>${buyCount === 0 ? `<button class="btn small ghost" data-action="del-seller" data-idx="${s.id}">删除</button>` : ''}</td>
  </tr>`;
}

export function viewBuys(state, sheetBuy = null) {
  const today = todayISO();
  const sellers = state.sellers ?? [];
  const buys = [...(state.buys ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

  // 自证单预览
  let sheetBlock = '';
  if (sheetBuy) {
    const buy = (state.buys ?? []).find((b) => b.id === sheetBuy);
    if (buy) {
      const seller = sellers.find((s) => s.id === buy.sellerId);
      let preview = '';
      try { preview = sourceText({ state, buyId: sheetBuy, todayISOStr: today }); } catch { /* 忽略 */ }
      sheetBlock = `
      <h2 class="sec">🧾 收购来源说明单（被倒查时的自证凭据）</h2>
      <div class="card">
        <div class="row">
          <button class="btn" data-action="source-copy">📋 复制文本</button>
          <button class="btn ghost" data-action="source-download">⬇️ 下载打印版 HTML</button>
          <button class="btn ghost" data-action="source-print">🖨️ 直接打印</button>
        </div>
        <pre class="preview">${esc(preview)}</pre>
        <p class="fine">打印版含「出售人签字确认」栏——出售人签字 = 最硬的「我查验过」证据；下回他再来，让他签。</p>
      </div>`;
    }
  }

  return `
  ${sheetBlock}
  <h2 class="sec">🧑 出售人底档（实名一次，收购点选）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名<input id="sl-name" placeholder="如：张老三" /></label>
      <label>证件号（身份证，只存本机）<input id="sl-idno" placeholder="330106…" /></label>
      <label>电话（选填）<input id="sl-phone" /></label>
      <label>备注（选填）<input id="sl-note" placeholder="如：小区门口开面包车的" /></label>
    </div>
    <button class="btn small" data-action="add-seller">建档</button>
    ${sellers.length ? `<table class="plain"><tr><th>姓名</th><th>证件号</th><th>收购</th><th></th></tr>
      ${sellers.map((s) => sellerCard(state, s)).join('')}</table>` : '<p class="fine">还没有出售人档案。</p>'}
    <p class="fine">最小采集：姓名 + 证件号；电话与备注选填。只存本机浏览器，导出备份时随 JSON 一起走——别把备份发给不相干的人。</p>
  </div>

  <h2 class="sec">⚖️ 收购落账（查证件 → 问来路 → 记台账）</h2>
  ${sellers.length ? `
  <div class="card">
    <div class="form-grid">
      <label>出售人<select id="buy-seller">${sellers.map((s) => `<option value="${s.id}">${esc(s.name)}${s.idNo ? '' : '（缺证件号）'}</option>`).join('')}</select></label>
      <label>收购日期<input type="date" id="buy-date" value="${today}" /></label>
      <label>品类<select id="buy-cat">${catOptions('iron')}</select></label>
      <label>数量（kg，选填）<input type="number" id="buy-weight" min="0" step="0.1" placeholder="如 200" /></label>
      <label>金额（元）<input type="number" id="buy-price" min="0" placeholder="如 5200" /></label>
      <label>物品情况<input id="buy-desc" placeholder="如：工程退下的旧电缆约 200 米" /></label>
      <label class="span2">单位证明（生产性/公用金属必填：谁开的证明、什么证明）<input id="buy-proof" placeholder="如：宏远建设退库单（2026-087）；拿不出证明请去「拒收」登记" /></label>
      <label class="span2">低价原因（系统提示明显低于参考价时必填）<input id="buy-lownote" placeholder="如：含绝缘皮折重 / 当日行情回落" /></label>
    </div>
    <button class="btn" data-action="add-buy">落账（无证明会当场拦截；低价必须留原因）</button>
    <p class="fine">价格提示线按品类参考价的 ${state.settings?.lowRatio ?? 50}% 计算——参考价在「设置」里按本地行情改。「明显低于市场价收购」是推定「明知」的情形，写下来的原因就是查验过的痕迹。</p>
  </div>`
  : '<div class="card"><p class="fine">先在上面的「出售人底档」建一个档案，才能落账。</p></div>'}

  <h2 class="sec">收购流水（最近 ${Math.min(buys.length, 30)} / 共 ${buys.length} 笔）</h2>
  ${buys.length ? `<div class="card"><table class="plain">
    <tr><th>日期 / 品类</th><th>出售人</th><th>数量 / 金额</th><th>查验与操作</th></tr>
    ${buys.slice(0, 30).map((b) => {
    const seller = sellers.find((s) => s.id === b.sellerId);
    const c = ITEM_CATS[b.cat];
    const low = isLowPrice(b, state.settings);
    return `<tr>
        <td><strong>${esc(c.label)}</strong><div class="basis">${esc(b.dateISO)}${b.desc ? ` · ${esc(b.desc)}` : ''}</div></td>
        <td>${esc(seller?.name ?? '？')}<div class="basis">${esc(maskIdNo(seller?.idNo))}</div></td>
        <td>${esc(fmtKg(b.weightKg))}<div class="basis"><strong>${fmtYuan(b.priceCents)}</strong>${b.weightKg ? `（${esc(fmtUnitPrice(b.priceCents, b.weightKg))}）` : ''}</div></td>
        <td>${c.needProof ? `<div class="basis">✅ 证明：${esc(b.proofNote)}</div>` : ''}${low ? `<div class="late">低于参考价：${esc(b.lowNote)}</div>` : ''}
          <div class="row tight"><button class="btn small ghost" data-action="buy-sheet" data-idx="${b.id}">出自证单</button><button class="btn small ghost" data-action="del-buy" data-idx="${b.id}">删</button></div></td>
      </tr>`;
  }).join('')}
  </table></div>` : '<div class="card"><p class="fine">还没有收购记录。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 拒收（来路不明的第一道防线）
// ---------------------------------------------------------------------------

export function viewRefuses(state) {
  const today = todayISO();
  const sellers = state.sellers ?? [];
  const refuses = [...(state.refuses ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  return `
  <h2 class="sec">🚫 拒收登记（拒收不是损失，是最硬的自证）</h2>
  <div class="card">
    <div class="form-grid">
      <label>拒收日期<input type="date" id="rf-date" value="${today}" /></label>
      <label>出售人姓名<input id="rf-name" placeholder="对方说名字就记，说不清记「不明人员」" /></label>
      <label>关联底档（选填）<select id="rf-seller"><option value="">（无档案/不明人员）</option>${sellers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label>品类<select id="rf-cat">${catOptions('infra')}</select></label>
      <label class="span2">物品情况<input id="rf-desc" placeholder="如：两个铸铁井盖，还带着泥，说家里拆迁拆的" /></label>
      <label>拒收原因<select id="rf-reason">${Object.keys(REFUSE_REASONS).map((k) => `<option value="${k}">${REFUSE_REASONS[k].label}</option>`).join('')}</select></label>
      <label>备注（选填）<input id="rf-note" placeholder="如：已口头告知来路不明不能收" /></label>
    </div>
    <button class="btn" data-action="add-refuse">登记拒收（30 秒，这张记录关键时刻能自证）</button>
    <p class="fine">检察官的公开建议就是「来路不明应拒绝收购，发现犯罪所得及时报警」——拒收登记 + 必要时报警记录，就是「我尽了查验义务」的白纸黑字。</p>
  </div>

  <h2 class="sec">拒收记录（共 ${refuses.length} 笔）</h2>
  ${refuses.length ? `<div class="card"><table class="plain">
    <tr><th>日期 / 品类</th><th>出售人 / 情况</th><th>原因</th><th></th></tr>
    ${refuses.map((r) => `<tr>
      <td><strong>${esc(ITEM_CATS[r.cat]?.label ?? r.cat)}</strong><div class="basis">${esc(r.dateISO)}</div></td>
      <td>${esc(r.sellerName)}<div class="basis">${esc(r.desc)}</div></td>
      <td>${esc(REFUSE_REASONS[r.reason]?.label ?? r.reason)}${r.note ? `<div class="basis">${esc(r.note)}</div>` : ''}</td>
      <td><button class="btn small ghost" data-action="del-refuse" data-idx="${r.id}">删</button></td>
    </tr>`).join('')}
  </table></div>` : '<div class="card"><p class="fine">还没有拒收记录。愿你不缺这一个，但别缺这一页。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 台账（出货 + 月度账 + 登记册 + 对账单 + 点名）
// ---------------------------------------------------------------------------

export function viewLedger(state, ledMonth = null) {
  if (!state.buys?.length && !state.outs?.length) return viewOnboarding();
  const today = todayISO();
  const month = ledMonth ?? monthKey(today);
  const rep = monthlyReport(state, month);
  const outs = (state.outs ?? []).filter((o) => monthKey(o.dateISO) === month).sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const freq = freqSellers(state, { todayISOStr: today });
  const gaps = idGaps(state);
  let outPreview = '';
  try { outPreview = outStatementText({ state, month, todayISOStr: today }); } catch { /* 无出货 */ }

  return `
  <h2 class="sec">🚚 出货落账（去向也是链条自证）</h2>
  <div class="card">
    <div class="form-grid">
      <label>出货日期<input type="date" id="out-date" value="${today}" /></label>
      <label>去向（打包站/分拣中心）<input id="out-buyer" placeholder="如：金桥再生资源打包站" /></label>
      <label>品类<select id="out-cat">${catOptions('iron')}</select></label>
      <label>数量（kg，选填）<input type="number" id="out-weight" min="0" step="0.1" /></label>
      <label>金额（元）<input type="number" id="out-price" min="0" /></label>
    </div>
    <button class="btn small" data-action="add-out">落账</button>
    <p class="fine">货卖给谁、卖了多少钱——上游来路 + 下游去向两头都有账，链条倒查时才两头都说得清。</p>
  </div>

  <h2 class="sec">📒 ${month} 经营台账</h2>
  <div class="card">
    <div class="row">
      <label>月份 <input type="month" id="led-month" value="${month}" /></label>
      <button class="btn small" data-action="led-apply">查看</button>
    </div>
    <div class="row stats-line">
      <span>收购 <strong>${rep.buys}</strong> 笔 / 投入 <strong>${fmtYuan(rep.buyCents)}</strong></span>
      <span>出货 <strong>${rep.outs}</strong> 笔 / ${fmtYuan(rep.outCents)}</span>
      <span>月度差额 <strong>${fmtYuan(rep.marginCents)}</strong></span>
      <span>拒收 <strong>${rep.refuses}</strong> 笔</span>
    </div>
    <p class="fine">月度差额 = 出货额 − 收购额（月度总口径，不做逐笔配对——快进快出的生意看整体就行）。</p>
    ${outs.length ? `<table class="plain"><tr><th>日期</th><th>去向</th><th>品类 / 数量</th><th>金额</th><th></th></tr>
      ${outs.map((o) => `<tr>
        <td class="fine">${esc(o.dateISO)}</td><td>${esc(o.buyer)}</td>
        <td>${esc(ITEM_CATS[o.cat]?.label ?? o.cat)}${o.weightKg ? `<div class="basis">${esc(fmtKg(o.weightKg))}</div>` : ''}</td>
        <td><strong>${fmtYuan(o.priceCents)}</strong></td>
        <td><button class="btn small ghost" data-action="del-out" data-idx="${o.id}">删</button></td>
      </tr>`).join('')}</table>` : ''}

    <h3 class="sub">出证三件套（${month}）</h3>
    <div class="row">
      <button class="btn" data-action="register-download">⬇️ 收购登记册 HTML（给检查）</button>
      <button class="btn ghost" data-action="register-print">🖨️ 打印登记册</button>
      ${outPreview ? '<button class="btn ghost" data-action="statement-copy">📋 出货对账单文本（给打包站）</button>' : ''}
    </div>
    ${outPreview ? `<pre class="preview">${esc(outPreview)}</pre>` : '<p class="fine">本月还没有出货记录，出货对账单暂不可出。</p>'}
  </div>

  <h2 class="sec">🔔 风险点名</h2>
  ${freq.length ? `<div class="card alert issue"><strong>🔴 销赃特征（同一人 30 日内高危品类 ≥3 次）</strong>
    <ul>${freq.map((r) => `<li><strong>${esc(r.seller?.name ?? '？')}</strong>：${r.count} 次（${esc(r.cats)}），最近 ${esc(r.lastISO)}——多问一句，说不清就拒收</li>`).join('')}</ul></div>` : ''}
  ${gaps.length ? `<div class="card alert issue"><strong>🔴 实名缺口 ${gaps.length} 条</strong>
    <ul>${gaps.slice(0, 5).map((r) => `<li>${esc(r.buy.dateISO)} ${esc(r.seller?.name ?? '？')} · ${esc(ITEM_CATS[r.buy.cat].label)}：缺证件号</li>`).join('')}</ul></div>` : ''}
  ${!freq.length && !gaps.length ? '<div class="card"><p class="fine">✅ 没有点名项：实名齐全、高频异常没有。</p></div>' : ''}`;
}

// ---------------------------------------------------------------------------
// 设置（站点 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const st = state.station ?? {};
  const s = state.settings ?? {};
  const refPrices = s.refPrices ?? {};
  return `
  <h2 class="sec">🏪 站点档案（印在登记册与自证单上）</h2>
  <div class="card">
    <div class="form-grid">
      <label>站点名称<input id="st-name" value="${esc(st.name ?? '')}" placeholder="如：顺发废品站" /></label>
      <label>联系电话<input id="st-phone" value="${esc(st.phone ?? '')}" /></label>
      <label>营业执照号（选填）<input id="st-lic" value="${esc(st.lic ?? '')}" /></label>
      <label>商务/公安备案号（选填）<input id="st-filed" value="${esc(st.filedNo ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-station">保存</button>
    <p class="fine">《再生资源回收管理办法》要求回收经营者向商务部门备案，收购生产性废旧金属的还需向公安机关备案——备案号登记在这里，登记册上一并体现。</p>
  </div>

  <h2 class="sec">🔔 低价提示参数（行情属地随时波动，参考价仅作基线）</h2>
  <div class="card">
    <div class="row"><label>提示阈值：低于参考价<input type="number" id="set-lowratio" min="10" max="95" value="${s.lowRatio ?? 50}" style="width:70px" /> % 触发</label></div>
    <div class="form-grid" style="margin-top:10px">
      ${Object.keys(ITEM_CATS).filter((k) => ITEM_CATS[k].refPriceDefault !== null || refPrices[k]).map((k) => `
        <label>${esc(ITEM_CATS[k].label)}（元/kg，留空用默认 ${ITEM_CATS[k].refPriceDefault ?? '—'}，填 0 关闭）
          <input type="number" id="ref-${k}" min="0" step="0.1" value="${typeof refPrices[k] === 'number' ? refPrices[k] : ''}" placeholder="${ITEM_CATS[k].refPriceDefault ?? '关闭'}" />
        </label>`).join('')}
    </div>
    <button class="btn small" data-action="save-params">保存参数</button>
    <p class="fine">「明显低于市场价收购」是推定「明知」的情形之一——参考价是本地行情的粗基线，当日实时价永远赢；填 0 表示该品类不参与低价提示。</p>
  </div>

  <h2 class="sec">⚙️ 数据与备份</h2>
  <div class="card">
    <p class="fine" style="margin-top:0">数据（含出售人证件号）仅存于本机浏览器，不上云。换设备：导出 JSON → 新设备导入；备份文件含实名信息，请妥善保管。当前事件 ${state.events?.length ?? 0} 条。</p>
    <div class="row">
      <button class="btn block" data-action="export-json">⬇️ 导出备份</button>
      <label class="btn ghost block" style="line-height:2.4">
        ⬆️ 导入备份<input type="file" id="import-file" accept=".json" hidden />
      </label>
      <button class="btn ghost block" data-action="export-events">📈 导出使用记录</button>
    </div>
  </div>`;
}
