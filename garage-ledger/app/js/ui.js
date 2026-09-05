/**
 * ui.js — 视图模板（纯函数：state → HTML 字符串；不含事件绑定）
 */
import {
  escapeHtml as e, fmtQty, fmtYuan, stockByItem, agingByItem, storageWarnings,
  licenseWarnings, pendingManifests, complianceChecks, todayActions, revenueReport,
  RECORD_TYPES, AUTO_REPAIR_ITEM_TEMPLATES, DEFAULT_STORAGE_LIMIT_DAYS,
  DEFAULT_STORAGE_WARN_DAYS, DEFAULT_LICENSE_WARN_DAYS, DEFAULT_STALE_DAYS,
} from './core.js';

function options(list, selectedId, labelFn) {
  return list.map((x) => `<option value="${x.id}" ${x.id === selectedId ? 'selected' : ''}>${e(labelFn(x))}</option>`).join('');
}

function daysBadge(level) {
  return level === 'fail' ? '<span class="badge bad">超期</span>'
    : level === 'warn' ? '<span class="badge warn">临期</span>'
      : '<span class="badge ok">正常</span>';
}

// ---------------------------------------------------------------------------
// 台账（存量卡片 + 记一笔 + 联单待补 + 流水）
// ---------------------------------------------------------------------------

export function viewBoard(state, today) {
  const stock = stockByItem(state);
  const aging = agingByItem(state, today);
  const limitDays = state.settings?.storageLimitDays ?? DEFAULT_STORAGE_LIMIT_DAYS;
  const cards = (state.items ?? []).map((it) => {
    const a = aging.get(it.id) ?? { stockMinor: 0, oldestISO: null, daysOpen: 0 };
    const minor = stock.get(it.id) ?? 0;
    const remain = limitDays - (a.daysOpen ?? 0);
    const level = minor <= 0 ? 'ok' : remain < 0 ? 'fail' : remain <= (state.settings?.storageWarnDays ?? DEFAULT_STORAGE_WARN_DAYS) ? 'warn' : 'ok';
    const sub = minor > 0 && a.oldestISO
      ? `最早批次 ${e(a.oldestISO)} · 已贮存 ${a.daysOpen} 天${remain < 0 ? ' · 超一年红线' : remain <= 30 ? ` · 剩 ${remain} 天` : ''}`
      : '暂无在库存量';
    return `<div class="card ${level}">
      <div class="card-head"><strong>${e(it.name)}</strong><span class="code">${e(it.code)}</span></div>
      <div class="card-qty">${fmtQty(it.unit, minor)} ${daysBadge(level)}</div>
      <div class="card-sub">${sub}</div>
      <div class="card-sub">容量上限 ${it.capacityMinor ? fmtQty(it.unit, it.capacityMinor) : '未设'}${it.note ? ` · ${e(it.note)}` : ''}</div>
    </div>`;
  }).join('') || '<p class="empty">还没有危废品目——去「设置 · 品目」用汽修模板一键添加。</p>';

  const itemOpts = options(state.items ?? [], '', (x) => `${x.name}（${x.code}）`);
  const vendorOpts = options(state.vendors ?? [], '', (x) => x.name)
    || '<option value="">（先到「自查 · 接收方」登记接收方）</option>';
  const pending = pendingManifests(state);
  const pendingHtml = pending.length === 0 ? '' : `<div class="panel warn-panel">
    <h3>⚠ 联单待补（${pending.length} 笔）</h3>
    <ul>${pending.map((r) => `<li>${e(r.dateISO)} · ${e((state.items ?? []).find((x) => x.id === r.itemId)?.name ?? '?')} · ${fmtQty('kg', r.qtyMinor)}
      <span class="mf-row"><input type="text" id="mf-${r.id}" placeholder="向接收方索要联单号" /><button class="link" data-act="fill-manifest" data-id="${r.id}">确认补录</button></span></li>`).join('')}</ul>
  </div>`;

  const rows = [...(state.records ?? [])].sort((a, b) =>
    a.dateISO === b.dateISO ? (b.seq ?? 0) - (a.seq ?? 0) : b.dateISO.localeCompare(a.dateISO));
  const vendorById = new Map((state.vendors ?? []).map((v) => [v.id, v]));
  const itemById = new Map((state.items ?? []).map((it) => [it.id, it]));
  const flow = rows.length === 0 ? '<p class="empty">还没有台账记录。换完油、收过桶，随手记一笔。</p>'
    : `<table class="flow"><tr><th>日期</th><th>类型</th><th>品目</th><th>数量</th><th>接收方/联单</th><th>款额</th><th></th></tr>
    ${rows.slice(0, 60).map((r) => {
      const it = itemById.get(r.itemId);
      const v = r.vendorId ? vendorById.get(r.vendorId) : null;
      const type = RECORD_TYPES[r.type]?.label ?? r.type;
      const qtyCell = r.type === 'rev' ? `-${fmtQty(it?.unit ?? 'kg', r.qtyMinor)}` : fmtQty(it?.unit ?? 'kg', r.qtyMinor);
      const mid = r.type === 'out' ? `${e(v?.name ?? '?')}${r.manifestNo ? ` · 联单 ${e(r.manifestNo)}` : ' · <em>联单待补</em>'}`
        : r.type === 'rev' ? '红字冲销' : e(r.note || '—');
      const canRevoke = r.type !== 'rev';
      return `<tr class="${r.type === 'rev' ? 'rev-row' : ''}">
        <td>${e(r.dateISO)}</td><td>${type}</td><td>${e(it?.name ?? '?')}</td><td>${qtyCell}</td>
        <td>${mid}</td><td>${r.amountFen ? e(fmtYuan(r.amountFen)) : '—'}</td>
        <td>${canRevoke ? `<button class="link" data-act="revoke" data-id="${r.id}">冲销</button>` : `（冲 ${e((rows.find((x) => x.id === r.refId)?.dateISO ?? ''))}）`}</td>
      </tr>`;
    }).join('')}</table>
    ${rows.length > 60 ? `<p class="empty">仅显示最近 60 笔，完整台账见「迎检包」导出。</p>` : ''}`;

  return `
  <section class="grid-cards">${cards}</section>
  <section class="panel">
    <h3>记一笔（30 秒）</h3>
    <div class="form-row">
      <select id="rec-type">
        <option value="in">入库（产废进桶）</option>
        <option value="out">出库（转移给接收方）</option>
      </select>
      <select id="rec-item">${itemOpts || '<option value="">（先在「设置」添加品目）</option>'}</select>
    </div>
    <div class="form-row">
      <label>日期 <input type="date" id="rec-date" value="${e(today)}" /></label>
      <label>数量 <input type="number" id="rec-qty" min="0" step="0.1" placeholder="kg 或 件" /></label>
      <label id="rec-vendor-wrap" hidden>接收方 <select id="rec-vendor">${vendorOpts}</select></label>
    </div>
    <div class="form-row">
      <label id="rec-manifest-wrap" hidden>联单号 <input type="text" id="rec-manifest" placeholder="可留空稍后补录" /></label>
      <label id="rec-amount-wrap" hidden>收款（元） <input type="number" id="rec-amount" min="0" step="0.01" placeholder="选填" /></label>
      <label>备注 <input type="text" id="rec-note" placeholder="选填" /></label>
      <button id="rec-save" class="primary">落账</button>
    </div>
    <p class="hint">出库数量超过现存量的会被整体拒绝；记错用「冲销」——红字留痕，不偷偷改账。</p>
  </section>
  ${pendingHtml}
  <section class="panel"><h3>台账流水</h3>${flow}</section>`;
}

// ---------------------------------------------------------------------------
// 自查（今日行动 + 红线台 + 打卡 + 接收方）
// ---------------------------------------------------------------------------

export function viewCompliance(state, today) {
  const checks = complianceChecks(state, today, state.settings ?? {});
  const actions = todayActions(checks);
  const year = today.slice(0, 4);
  const planDone = checks.find((c) => c.id === 'PLAN')?.level === 'ok';
  const lic = licenseWarnings(state, today, state.settings?.licenseWarnDays ?? DEFAULT_LICENSE_WARN_DAYS);
  const licById = new Map(lic.map((x) => [x.vendorId, x]));
  const vendors = (state.vendors ?? []).map((v) => {
    const w = licById.get(v.id);
    return `<tr>
      <td>${e(v.name)}</td>
      <td>${v.licenseNo ? e(v.licenseNo) : '<em>未登记</em>'}</td>
      <td>${e(v.licenseExpiryISO ?? '—')}</td>
      <td>${w ? (w.level === 'fail' ? '<span class="badge bad">已过期</span>' : `<span class="badge warn">剩 ${w.days} 天</span>`) : (v.licenseNo ? '<span class="badge ok">有效</span>' : '')}</td>
      <td><button class="link" data-act="del-vendor" data-id="${v.id}">删除</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">还没登记接收方——出库转移必须交代给"有资质的人"。</td></tr>';

  return `
  ${actions.length ? `<div class="panel actions-panel">
    <h3>今天做什么（${actions.length}）</h3>
    <ol>${actions.map((a) => `<li class="${a.level}"><strong>${e(a.title)}</strong>：${e(a.action)}</li>`).join('')}</ol>
  </div>` : '<div class="panel ok-panel"><h3>今天做什么</h3><p>✓ 暂无红灯事项——保持当场记账的习惯。</p></div>'}
  <section class="panel"><h3>红线自查台</h3>
    <table class="checks"><tr><th>　</th><th>检查项</th><th>结论</th><th>法条依据 / 行动</th></tr>
    ${checks.map((c) => `<tr class="${c.level}">
      <td>${c.level === 'ok' ? '✓' : c.level === 'warn' ? '△' : '✗'}</td>
      <td><strong>${e(c.title)}</strong></td>
      <td>${e(c.detail)}</td>
      <td class="legal">${e(c.legal)}${c.level !== 'ok' ? `<br /><strong>→ ${e(c.action)}</strong>` : ''}</td>
    </tr>`).join('')}</table>
    <p class="hint">自查结果是整改指引，不构成法律意见；不替代法定申报与转移联单报送，属地要求永远赢。</p>
  </section>
  <section class="panel"><h3>打卡</h3>
    <div class="form-row">
      <label>${year} 年度管理计划备案日期 <input type="date" id="plan-date" value="${e(today)}" ${planDone ? 'disabled' : ''} /></label>
      <button id="plan-save" class="primary" ${planDone ? 'disabled' : ''}>${planDone ? '已备案 ✓' : '登记备案'}</button>
      <button id="storage-check">贮存区今日已巡查</button>
    </div>
    <ul class="checkin-list">${(state.checkins ?? []).slice(-6).reverse().map((c) => `<li>${e(c.dateISO)} · ${c.kind === 'plan' ? '管理计划备案' : '贮存区巡查'}${c.note ? ` · ${e(c.note)}` : ''}</li>`).join('') || '<li class="empty">暂无打卡记录</li>'}</ul>
  </section>
  <section class="panel"><h3>接收方（危废收集/利用单位）</h3>
    <table class="vendors"><tr><th>名称</th><th>经营许可证号</th><th>有效期至</th><th>状态</th><th></th></tr>${vendors}</table>
    <div class="form-row">
      <label>名称 <input type="text" id="v-name" placeholder="接收方全称" /></label>
      <label>许可证号 <input type="text" id="v-license" placeholder="危废经营许可证编号" /></label>
    </div>
    <div class="form-row">
      <label>有效期至 <input type="date" id="v-expiry" /></label>
      <label>电话 <input type="text" id="v-phone" placeholder="选填" /></label>
      <button id="v-add" class="primary">登记接收方</button>
    </div>
    <p class="hint">固废法第 80 条：禁止将危废提供或委托给无许可证的单位——交运前核验证件原件，过期即暂停。</p>
  </section>`;
}

// ---------------------------------------------------------------------------
// 收益账（月度 / 品目 / 接收方）
// ---------------------------------------------------------------------------

export function viewRevenue(state, year) {
  const rep = revenueReport(state, year);
  const years = [...new Set((state.records ?? []).map((r) => r.dateISO.slice(0, 4)))].sort().reverse();
  if (!years.includes(year)) years.push(year);
  years.sort().reverse();
  return `
  <section class="panel">
    <div class="form-row">
      <h3 style="margin:0">收益账 · ${e(year)}</h3>
      <select id="rev-year">${years.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y} 年</option>`).join('')}</select>
    </div>
    <p class="total">合计入账 <strong>${e(fmtYuan(rep.totalFen))}</strong>（废油、旧电瓶等边角料变现；冲销自动冲减）</p>
    ${rep.totalFen === 0 ? '<p class="empty">本年度暂无出库收款记录——出库时填「收款」，台账顺手变钱账。</p>' : `
    <table><tr><th>月份</th><th>入账</th></tr>
      ${rep.byMonth.map((m) => `<tr><td>${e(m.month)}</td><td>${e(fmtYuan(m.amountFen))}</td></tr>`).join('')}
    </table>
    <table><tr><th>品目</th><th>入账</th></tr>
      ${rep.byItem.map((r) => `<tr><td>${e(r.name)}</td><td>${e(fmtYuan(r.amountFen))}</td></tr>`).join('')}
    </table>
    <table><tr><th>接收方</th><th>入账</th></tr>
      ${rep.byVendor.map((r) => `<tr><td>${e(r.name)}</td><td>${e(fmtYuan(r.amountFen))}</td></tr>`).join('')}
    </table>`}
  </section>`;
}

// ---------------------------------------------------------------------------
// 迎检包（文本 / 打印版 / 直接打印）
// ---------------------------------------------------------------------------

export function viewInspection(state, today, cache) {
  return `
  <section class="panel">
    <h3>迎检包（自查概要）</h3>
    <p class="hint">包含：存量汇总 · 转移记录 · 接收方资质核验 · 红线自查结论。检查前点一下，打印装订或微信存档。</p>
    <div class="form-row">
      <button id="insp-text" class="primary">生成文本（微信发送）</button>
      <button id="insp-html">下载打印版 HTML</button>
      <button id="insp-print">直接打印</button>
    </div>
    <textarea id="insp-out" rows="18" readonly placeholder="点击上方「生成文本」……">${cache?.text ? e(cache.text) : ''}</textarea>
    <div class="form-row">
      <button id="insp-copy" ${cache?.text ? '' : 'disabled'}>复制全文</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// 设置（厂店 / 品目 / 阈值 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const s = state.settings ?? {};
  const itemRows = (state.items ?? []).map((it) => `<tr>
    <td>${e(it.name)}</td><td>${e(it.code)}</td><td>${it.unit === 'kg' ? 'kg' : '件'}</td>
    <td>${it.capacityMinor ? fmtQty(it.unit, it.capacityMinor) : '—'}</td>
    <td>${(state.records ?? []).some((r) => r.itemId === it.id)
    ? '<span class="hint">已有台账</span>'
    : `<button class="link" data-act="del-item" data-id="${it.id}">删除</button>`}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="empty">还没有品目。</td></tr>';
  return `
  <section class="panel"><h3>厂店档案</h3>
    <div class="form-row">
      <label>厂店名称 <input type="text" id="org-name" value="${e(state.org?.name ?? '')}" placeholder="执照全称" /></label>
      <label>电话 <input type="text" id="org-phone" value="${e(state.org?.phone ?? '')}" /></label>
    </div>
    <div class="form-row">
      <label>地址 <input type="text" id="org-address" value="${e(state.org?.address ?? '')}" placeholder="选填" /></label>
      <button id="org-save" class="primary">保存档案</button>
    </div>
  </section>
  <section class="panel"><h3>危废品目</h3>
    <table class="vendors"><tr><th>品目</th><th>废物代码</th><th>单位</th><th>容量上限</th><th></th></tr>${itemRows}</table>
    <div class="form-row">
      <button id="tpl-add" class="primary">用汽修常见模板一键添加</button>
    </div>
    <div class="form-row">
      <label>名称 <input type="text" id="it-name" placeholder="品目名称" /></label>
      <label>代码 <input type="text" id="it-code" placeholder="如 900-214-08" /></label>
      <select id="it-unit"><option value="kg">单位 kg</option><option value="unit">单位 件</option></select>
      <label>容量 <input type="number" id="it-cap" min="0" step="0.1" placeholder="上限，选填" /></label>
      <button id="it-add">添加品目</button>
    </div>
    <p class="hint">代码与描述为行业常见口径的预填模板：以最新《国家危险废物名录》及属地生态环境部门要求为准，可编辑。</p>
  </section>
  <section class="panel"><h3>预警参数（属地口径覆盖）</h3>
    <div class="form-row">
      <label>贮存红线（天） <input type="number" id="set-limit" min="1" value="${s.storageLimitDays ?? DEFAULT_STORAGE_LIMIT_DAYS}" /></label>
      <label>临期预警（天） <input type="number" id="set-warn" min="1" value="${s.storageWarnDays ?? DEFAULT_STORAGE_WARN_DAYS}" /></label>
    </div>
    <div class="form-row">
      <label>资质到期预警（天） <input type="number" id="set-lic" min="1" value="${s.licenseWarnDays ?? DEFAULT_LICENSE_WARN_DAYS}" /></label>
      <label>台账断更（天） <input type="number" id="set-stale" min="1" value="${s.staleDays ?? DEFAULT_STALE_DAYS}" /></label>
      <button id="set-save" class="primary">保存参数</button>
    </div>
  </section>
  <section class="panel"><h3>数据（100% 本地，导出归档自持）</h3>
    <div class="form-row">
      <button id="data-export" class="primary">导出 JSON 归档</button>
      <label class="filelabel">导入 JSON<input type="file" id="data-import" accept=".json,application/json" hidden /></label>
      <button id="demo-load">载入示例数据</button>
      <button id="data-clear" class="danger">清空全部数据</button>
    </div>
    <p class="hint">数据仅存于本设备：导出 JSON 是唯一备份通道（换机迁移 / 迎检留存 / 给收集商或监管出示前的自持归档）。</p>
  </section>`;
}
