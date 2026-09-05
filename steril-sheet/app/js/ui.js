/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  MACHINE_KINDS, WRAP_TYPES, CHEM_RESULTS, BD_RESULTS, BIO_RESULTS,
  batchState, BATCH_STATE_LABEL, shelfLevel, SHELF_DOT, unitStock,
  stockRows, expiredRows, bioDue, bioPendingOverdue, wasteDue, certLevel,
  consumableLevel, selfCheck, monthlyReport, traceFor, traceText,
  inspectionText, expireISOOf, isIssuable, recallList,
  escapeHtml, todayISO, monthKey, addDays, daysUntil,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const LEVEL_PILL = { ok: 'ok', warn: 'warn', issue: 'issue' };
const LEVEL_DOT = { ok: '🟢', warn: '🟡', issue: '🔴' };
const STATE_PILL = {
  normal: 'ok', 'bio-pending': 'todo', 'recall-open': 'issue', 'recall-closed': 'todo', rejected: 'issue',
};

export function viewOnboarding() {
  return `
  <h2 class="sec">一锅一单，链上可查</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>WS 506-2016 要求口腔器械一人一用一消毒/灭菌、清洗包装灭菌监测全程可追溯；灭菌效果肉眼不可见，<strong>台账是唯一的证明</strong>。而小微诊所的现状：三本手写记录 + 机壳上贴的指示胶带 + 全凭记忆的发放——患者用过哪个批次、哪锅监测合不合格，谁也拼不出完整的一条链。</p>
    <p><strong>灭菌单的做法：</strong>灭菌落账（一锅一单，装载/化学/BD/生物监测/操作者一次记全）→ 无菌柜先灭先用（失效日自动排第一行，过期的拒绝发放）→ 监测阳性强制召回（在库冻结 + 已发放患者名单）→ 追溯单/迎检包 30 秒出证。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏥 先建诊所档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不做挂号收费病历、不碰物联网传感器、不做监管报送——数据只存在你设备里，出证走微信与打印，患者和监督所都不用装任何东西。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（院感体检 + 预警点名 + 本月速览）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.packs?.length) return viewOnboarding();
  const today = todayISO();
  const month = monthKey(today);
  const check = selfCheck(state, today);
  const report = monthlyReport(state, month);
  const bio = bioDue(state, today, state.settings?.bioIntervalDays);
  const expired = expiredRows(state, today);
  const recalls = (state.batches ?? []).filter((b) => batchState(b) === 'recall-open');
  const badChecks = check.checks.filter((c) => c.level !== 'ok');
  const scorePill = check.score >= 90 ? 'ok' : check.score >= 70 ? 'warn' : 'issue';

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">🏥 院感体检 <span class="pill ${LEVEL_PILL[scorePill]}"><strong>${check.score}</strong> / 100 分</span>
      · 本月灭菌 <strong>${report.batchCount}</strong> 锅 / ${report.packCount} 包 · 发放 ${report.usedCount} 包</div>
    ${badChecks.length
    ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:13px">${badChecks.map((c) => `<li>${LEVEL_DOT[c.level]} <strong>${esc(c.label)}</strong>：${esc(c.detail)}</li>`).join('')}</ul>`
    : '<p class="done-note">七项体检全绿——台账连得上、效期对得上、周期有人盯。</p>'}
  </div>
  ${recalls.length ? `<div class="card alert issue"><strong>🔴 召回进行中——处置在库、通知患者、销案闭环</strong>
    <ul>${recalls.map((b) => { const list = recallList(state, b.id); return `<li>${esc(b.no)}（${esc(b.dateISO)}）：已发放 <strong>${list.length}</strong> 笔（${esc(list.slice(0, 3).map((x) => x.patientRef).join('、'))}${list.length > 3 ? '…' : ''}），在库冻结待处置——去「灭菌」页销案</li>`; }).join('')}</ul></div>` : ''}
  ${expired.length ? `<div class="card alert issue"><strong>🔴 过期在库（发放被工具硬性拒绝）</strong>
    <ul>${expired.map((r) => `<li>${esc(r.pack.name)} ×${r.qty}（批次 ${esc(r.batch.no)}，${esc(r.expireISO)} 失效）——去「无菌柜」处置登记</li>`).join('')}</ul></div>` : ''}
  ${bio.status === 'overdue' ? `<div class="card alert issue"><strong>🔴 生物监测超期</strong>
    <ul><li>上次 ${esc(bio.lastISO)}，按 ${state.settings?.bioIntervalDays ?? 7} 天周期已超 ${-bio.daysLeft} 天——下一锅落账时把生物监测一起做了，或单独补录</li></ul></div>` : ''}
  ${bio.status === 'due' && bio.daysLeft <= 2 ? `<div class="card alert"><strong>🟡 生物监测将到期</strong>
    <ul><li>下次到期 ${esc(bio.dueISO)}（还剩 ${bio.daysLeft} 天），安排本周的 biological 监测</li></ul></div>` : ''}
  <h2 class="sec">周期任务</h2>
  <div class="card"><table class="plain">
    <tr><th>任务</th><th>状态</th><th>说明</th></tr>
    ${check.checks.map((c) => `<tr><td>${LEVEL_DOT[c.level]} ${esc(c.label)}</td><td><span class="pill ${LEVEL_PILL[c.level]}">${c.level === 'ok' ? '正常' : c.level === 'warn' ? '注意' : '红灯'}</span></td><td class="fine">${esc(c.detail)}</td></tr>`).join('')}
  </table></div>
  <h2 class="sec">${month} 速览</h2>
  <div class="card">
    <div class="row stats-line">
      <span>灭菌 <strong>${report.batchCount}</strong> 锅</span>
      <span>${report.packCount} 包</span>
      <span>发放 <strong>${report.usedCount}</strong> 包</span>
      <span>生物监测 <strong>${report.bioCount}</strong> 次</span>
      <span>召回 <strong>${report.recallCount}</strong> 次</span>
    </div>
    <div class="row">
      <a class="btn" href="#/steril">🍲 灭菌落账</a>
      <a class="btn ghost" href="#/certs">🧾 追溯单 / 迎检包</a>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 灭菌（机器与包目录 / 落账 / 批次台账）
// ---------------------------------------------------------------------------

function machineCard(state, m) {
  const used = (state.batches ?? []).some((b) => b.machineId === m.id);
  return `<tr>
    <td><strong>${esc(m.name)}</strong>${m.code ? `<div class="basis">锅代码 ${esc(m.code)}</div>` : ''}</td>
    <td class="fine">${esc(MACHINE_KINDS[m.kind]?.label ?? '—')}</td>
    <td>${used ? '<span class="pill todo">已有锅次</span>' : `<button class="btn small ghost" data-action="del-machine" data-idx="${esc(m.id)}">删</button>`}</td>
  </tr>`;
}

function packCard(state, p) {
  const today = todayISO();
  const inStock = (state.batches ?? []).reduce((n, b) => n + Math.max(0, unitStock(b, p.id, state.usages, state.treatments)), 0);
  return `<tr class="${p.active === false ? 'muted' : ''}">
    <td><strong>${esc(p.name)}</strong>${p.items ? `<div class="basis">${esc(p.items)}</div>` : ''}</td>
    <td class="fine">${esc(WRAP_TYPES[p.wrap]?.label ?? '—')} · 效期 ${p.shelfDays} 天</td>
    <td>${inStock > 0 ? `<span class="pill ok">在库 ${inStock}</span>` : '<span class="pill">无在库</span>'}</td>
    <td>${p.active === false
    ? `<button class="btn small ghost" data-action="toggle-pack" data-idx="${esc(p.id)}">启用</button>`
    : `<button class="btn small ghost" data-action="toggle-pack" data-idx="${esc(p.id)}">停用</button>`}</td>
  </tr>`;
}

function batchCard(state, b) {
  const st = batchState(b);
  const packById = Object.fromEntries(state.packs.map((p) => [p.id, p]));
  const loadsText = b.loads.map((l) => `${esc(packById[l.packId]?.name ?? l.packId)}×${l.qty}`).join('、');
  const bioForm = (b.bio === 'none' || b.bio === 'pending') && st !== 'rejected'
    ? `<div class="card inner">
        <strong>补录生物监测结果</strong>（${b.bio === 'pending' ? '培养中——结果出来第一时间录' : '本锅还没做生物监测'}）
        <div class="form-grid">
          <label>结果<select id="bio-result-${esc(b.id)}"><option value="pass">✅ 合格</option><option value="fail">❌ 阳性（触发召回）</option><option value="pending">⏳ 继续培养</option></select></label>
          <label>结果日期<input type="date" id="bio-date-${esc(b.id)}" value="${todayISO()}" /></label>
        </div>
        <button class="btn small" data-action="save-bio" data-idx="${esc(b.id)}">保存结果</button>
      </div>`
    : '';
  const recallBlock = st === 'recall-open'
    ? `<div class="card inner">
        <strong>🔴 召回进行中</strong>（${esc(b.recall?.note || '生物监测阳性')}）
        ${(() => {
      const list = recallList(state, b.id);
      if (!list.length) return '<p class="fine">该批次无已发放记录——只需处置在库。</p>';
      return `<table class="plain"><tr><th>发放日</th><th>患者标识</th><th>器械包</th><th>数量</th></tr>
            ${list.map((x) => `<tr><td>${esc(x.dateISO)}</td><td>${esc(x.patientRef)}</td><td>${esc(x.packName)}</td><td>×${x.qty}</td></tr>`).join('')}
          </table><p class="fine">以上为已发放名单——逐一通知患者并记录（电话/微信截图自存）。</p>`;
    })()}
        <div class="form-grid">
          <label class="span2">处置经过（复测结果 / 全部重新处理凭证 / 患者通知方式）<input id="recall-note-${esc(b.id)}" placeholder="如：在库 2 个重新清洗灭菌复测合格；已电话通知 陈* 复诊" /></label>
        </div>
        <button class="btn small" data-action="close-recall" data-idx="${esc(b.id)}">在库处置完后销案</button>
        <p class="fine">在库冻结包先去「无菌柜」做处置登记（报废或重新处理），工具守恒校验通过后才能销案。</p>
      </div>`
    : (st === 'recall-closed'
      ? `<div class="card inner"><strong>🟤 召回已销案</strong>（${esc(b.recall?.closeNote || '')}）</div>`
      : (st === 'rejected' ? `<div class="card inner"><strong>⛔ 化学不合格，未放行</strong>：${esc(b.chemNote || '')}</div>` : ''));
  return `<details class="card">
    <summary>
      <span class="car-title"><strong>${esc(b.no)}</strong> <span class="basis">${esc(b.dateISO)}</span></span>
      <span class="pill ${STATE_PILL[st]}">${BATCH_STATE_LABEL[st]}</span>
      <span class="pill">${esc(b.bio === 'pass' ? `生物 ✅ ${esc(b.bioISO ?? '')}` : b.bio === 'pending' ? '生物 ⏳ 培养中' : b.bio === 'fail' ? '生物 ❌ 阳性' : '生物未做')}</span>
    </summary>
    <div class="basis">灭菌器 ${esc((state.machines.find((m) => m.id === b.machineId) ?? {}).name ?? '—')} · 操作 ${esc(b.operator)} · 装载：${loadsText} · 化学 ${CHEM_RESULTS[b.chem].label} · BD ${BD_RESULTS[b.bd ?? 'none'].label}</div>
    ${bioForm}
    ${recallBlock}
  </details>`;
}

export function viewSteril(state) {
  if (!state.machines?.length) {
    return `
    <h2 class="sec">🍲 先登记你的灭菌锅</h2>
    <div class="card">
      <div class="form-grid">
        <label>灭菌器名称<input id="mc-name" placeholder="如：卡式灭菌器 / 台式B级" /></label>
        <label>锅代码（进锅编号）<input id="mc-code" placeholder="如：M1" /></label>
        <label>类型<select id="mc-kind">${Object.keys(MACHINE_KINDS).map((k) => `<option value="${k}">${MACHINE_KINDS[k].label}</option>`).join('')}</select></label>
        <label class="span2">备注（选填）<input id="mc-note" placeholder="如：2025-07 购入，年检至 2026-07" /></label>
      </div>
      <button class="btn" data-action="add-machine">登记灭菌器</button>
      <p class="fine">锅代码用于锅编号（日期-代码-当日序号，如 20260905-M1-01）——追溯单与迎检包都按它串链。</p>
      <div class="row"><button class="btn ghost" data-action="seed-demo">先看示例数据</button></div>
    </div>`;
  }
  const today = todayISO();
  const activePacks = state.packs.filter((p) => p.active !== false);
  const recent = [...(state.batches ?? [])].sort((a, b) => b.no.localeCompare(a.no)).slice(0, 30);
  return `
  <h2 class="sec">🍲 灭菌落账（一锅一单）</h2>
  <div class="card">
    <div class="form-grid">
      <label>灭菌日<input type="date" id="bt-date" value="${today}" /></label>
      <label>灭菌器<select id="bt-machine">${state.machines.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}${m.code ? `（${esc(m.code)}）` : ''}</option>`).join('')}</select></label>
      <label>操作者<input id="bt-operator" placeholder="如：王护士" /></label>
      <label>化学监测<select id="bt-chem"><option value="pass">✅ 合格</option><option value="fail">❌ 不合格</option></select></label>
      <label>BD 试验<select id="bt-bd"><option value="none">— 未做</option><option value="pass">✅ 合格</option><option value="fail">❌ 不合格</option></select></label>
      <label>生物监测<select id="bt-bio"><option value="none">— 本锅未做</option><option value="pending">⏳ 培养中</option><option value="pass">✅ 合格</option><option value="fail">❌ 阳性（触发召回）</option></select></label>
      <label class="span2">装载明细（今天装了几包，填数量）</label>
      ${activePacks.map((p) => `<label>${esc(p.name)}<input type="number" id="ld-${esc(p.id)}" min="0" placeholder="0" /></label>`).join('')}
      <label class="span2">处置说明（化学不合格时必填）<input id="bt-chemnote" placeholder="如：指示卡变色不全，整锅重新清洗包装灭菌" /></label>
    </div>
    ${activePacks.length === 0 ? '<p class="warn-note">还没有器械包目录——先在下方加一个包。</p>' : ''}
    <button class="btn" data-action="add-batch">落账这锅（锅编号自动生成）</button>
  </div>

  <h2 class="sec">批次台账（最近 ${recent.length} 锅）</h2>
  ${recent.length ? recent.map((b) => batchCard(state, b)).join('') : '<div class="card"><p class="fine">还没有锅次记录。灭菌完成当场落账，30 秒。</p></div>'}

  <h2 class="sec">灭菌器与器械包目录</h2>
  <div class="card">
    <table class="plain"><tr><th>灭菌器</th><th>类型</th><th></th></tr>${state.machines.map((m) => machineCard(state, m)).join('')}</table>
    <div class="form-grid">
      <label>新增灭菌器<input id="mc-name" placeholder="名称，如：台式 B 级" /></label>
      <label>锅代码<input id="mc-code" placeholder="如：M2" /></label>
      <label>类型<select id="mc-kind">${Object.keys(MACHINE_KINDS).map((k) => `<option value="${k}">${MACHINE_KINDS[k].label}</option>`).join('')}</select></label>
      <label class="span2">备注（选填）<input id="mc-note" placeholder="如：压力表校验至 2026-12" /></label>
    </div>
    <button class="btn small" data-action="add-machine">加一台锅</button>
  </div>
  <div class="card">
    <table class="plain"><tr><th>器械包</th><th>包装/效期</th><th>在库</th><th></th></tr>${state.packs.map((p) => packCard(state, p)).join('')}</table>
    <div class="form-grid">
      <label>包名称<input id="pk-name" placeholder="如：拔牙包 / 牙科手机" /></label>
      <label>内含器械（选填）<input id="pk-items" placeholder="如：挺子×2 镊×1" /></label>
      <label>包装类型<select id="pk-wrap">${Object.keys(WRAP_TYPES).map((k) => `<option value="${k}">${WRAP_TYPES[k].label}（默认效期 ${WRAP_TYPES[k].shelfDays} 天）</option>`).join('')}</select></label>
      <label>效期天数（可覆盖默认）<input type="number" id="pk-shelf" min="1" max="365" placeholder="留空用默认" /></label>
    </div>
    <button class="btn small" data-action="add-pack">加一种包</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// 无菌柜（在库效期 / 使用落账 / 过期处置）
// ---------------------------------------------------------------------------

export function viewCabinet(state) {
  if (!state.packs?.length) return viewOnboarding();
  const today = todayISO();
  const rows = stockRows(state, today);
  const expired = expiredRows(state, today);
  // 处置对象 = 过期在库 + 冻结在库（召回/化学不合格批次）——两条闭环都必须有出口
  const disposalRows = rows.filter((r) => r.level === 'expired' || r.frozen);
  const activePacks = state.packs.filter((p) => p.active !== false);
  const avail = activePacks.map((p) => ({
    p,
    qty: (state.batches ?? []).reduce((n, b) => n + Math.max(0, isIssuable(b) ? unitStock(b, p.id, state.usages, state.treatments) : 0), 0),
  }));
  const recentUsage = [...(state.usages ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id)).slice(0, 12);
  const packById = Object.fromEntries(state.packs.map((p) => [p.id, p]));
  const totalStock = rows.reduce((n, r) => n + r.qty, 0);

  return `
  <h2 class="sec">🧴 使用落账（追溯链的患者端点）</h2>
  <div class="card">
    <div class="form-grid">
      <label>器械包<select id="us-pack">${avail.map((x) => `<option value="${esc(x.p.id)}">${esc(x.p.name)}（可用 ${x.qty}）</option>`).join('')}</select></label>
      <label>数量<select id="us-qty">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
      <label>患者标识（姓名缩写或病历号）<input id="us-patient" placeholder="如：陈* / 2026-0087" /></label>
      <label>使用者（选填）<input id="us-operator" placeholder="如：刘医生" /></label>
      <label>使用日<input type="date" id="us-date" value="${today}" /></label>
    </div>
    <button class="btn" data-action="add-usage">落账发放（自动先灭先用，过期拒发）</button>
    <p class="fine">患者标识是追溯链的最后一环：真出事时，「这口锅这批包用在了谁身上」全靠它拼出来。写姓名缩写即可，不出设备。</p>
  </div>

  ${disposalRows.length ? `<div class="card alert issue"><strong>🔴 过期/冻结在库——处置登记（报废 / 重新处理）</strong>
    <table class="plain"><tr><th>器械包</th><th>批次</th><th>在库</th><th>失效日</th><th>标记</th></tr>
      ${disposalRows.map((r) => `<tr><td>${esc(r.pack.name)}</td><td class="fine">${esc(r.batch.no)}</td><td>×${r.qty}</td><td>${esc(r.expireISO)}</td>
        <td>${r.frozen ? '<span class="pill issue">冻结</span>' : '<span class="pill warn">过期</span>'}</td></tr>`).join('')}
    </table>
    <div class="form-grid">
      <label>处置对象<select id="tx-target">${disposalRows.map((r) => `<option value="${esc(r.batch.id)}|${esc(r.pack.id)}">${esc(r.pack.name)} · ${esc(r.batch.no)}（在库 ${r.qty}${r.frozen ? '，冻结' : '，过期'}）</option>`).join('')}</select></label>
      <label>数量<select id="tx-qty">${[1, 2, 3, 4, 5, 6, 8, 10, 12, 20].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
      <label>处置方式<select id="tx-action"><option value="reprocess">🔁 重新清洗包装灭菌</option><option value="discard">🗑️ 报废</option></select></label>
      <label class="span2">说明（选填）<input id="tx-note" placeholder="如：重新灭菌后按新锅落账" /></label>
    </div>
    <button class="btn danger" data-action="add-treatment">登记处置（账实守恒校验）</button>
  </div>` : ''}

  <h2 class="sec">🧦 无菌柜（${totalStock} 包在库 · 先灭先用）</h2>
  <div class="card"><table class="plain">
    <tr><th>器械包</th><th>批次</th><th>在库</th><th>灭菌日</th><th>失效日</th><th>状态</th></tr>
    ${rows.length ? rows.map((r) => `<tr class="${r.frozen ? 'muted' : ''}">
      <td>${esc(r.pack.name)}</td>
      <td class="fine">${esc(r.batch.no)}</td>
      <td>×${r.qty}</td>
      <td class="fine">${esc(r.batch.dateISO)}</td>
      <td class="fine">${esc(r.expireISO)}</td>
      <td>${r.frozen
      ? `<span class="pill issue">⛔ 冻结（召回/不合格）</span>`
      : `<span class="pill ${r.level === 'ok' ? 'ok' : r.level === 'warn' ? 'warn' : 'issue'}">${SHELF_DOT[r.level]} ${r.level === 'ok' ? '正常' : r.level === 'warn' ? `临期 ${daysUntil(r.expireISO, today)} 天` : '已过期'}</span>`}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="fine">无菌柜是空的——灭菌落账后自动入库。</td></tr>'}
  </table><p class="fine">失效日 = 灭菌日 + 包效期（纸塑默认 180 天 / 布类 7 天，逐包可改）。发放永远从最早失效的批次先走。</p></div>

  <h2 class="sec">最近发放（${recentUsage.length} 笔）</h2>
  <div class="card"><table class="plain">
    <tr><th>日期</th><th>患者标识</th><th>器械包</th><th>批次</th><th></th></tr>
    ${recentUsage.length ? recentUsage.map((u) => `<tr>
      <td class="fine">${esc(u.dateISO)}</td><td>${esc(u.patientRef)}</td>
      <td>${esc(packById[u.packId]?.name ?? u.packId)} ×${u.qty}</td>
      <td class="fine">${esc((u.alloc ?? []).map((a) => a.no).join('、'))}</td>
      <td><button class="btn small ghost" data-action="del-usage" data-idx="${esc(u.id)}">撤销</button></td>
    </tr>`).join('') : '<tr><td colspan="5" class="fine">还没有发放记录。</td></tr>'}
  </table><p class="fine">撤销只用于误操作当次纠正；批次一旦进入召回，发放记录是召回名单的一部分，不可撤销。</p></div>`;
}

// ---------------------------------------------------------------------------
// 出证（追溯单 / 迎检包）
// ---------------------------------------------------------------------------

export function viewCerts(state, certTab = 'trace', tracePatient = '', inspectMonth = null) {
  if (!state.batches?.length && !state.usages?.length) return viewOnboarding();
  const today = todayISO();
  const month = inspectMonth ?? monthKey(today);

  let traceHtml = '';
  if (certTab === 'trace' && tracePatient) {
    try {
      const entries = traceFor(state, tracePatient);
      traceHtml = `<pre class="preview">${esc(traceText({ clinic: state.clinic, patientRef: tracePatient, entries, todayISOStr: today }))}</pre>
      <div class="row">
        <button class="btn" data-action="trace-copy">📋 复制文本（微信回复查询）</button>
        <button class="btn ghost" data-action="trace-download">⬇️ 下载打印版</button>
        <button class="btn ghost" data-action="trace-print">🖨️ 直接打印</button>
      </div>`;
    } catch (e) {
      traceHtml = `<p class="fine">⚠ ${esc(e.message)}</p>`;
    }
  }

  let inspectHtml = '';
  if (certTab === 'inspect') {
    try {
      inspectHtml = `<pre class="preview">${esc(inspectionText({ clinic: state.clinic, state, month, todayISOStr: today }))}</pre>
      <div class="row">
        <button class="btn" data-action="inspect-download">⬇️ 下载打印版（单文件 HTML）</button>
        <button class="btn ghost" data-action="inspect-print">🖨️ 直接打印</button>
      </div>
      <p class="fine">迎检包 = 当月锅次台账 + 院感自查体检 + 负责人签字栏。监督所进门到拿出台账，30 秒。</p>`;
    } catch (e) {
      inspectHtml = `<p class="fine">⚠ ${esc(e.message)}</p>`;
    }
  }

  return `
  <h2 class="sec">🧾 出证（拿得出，才叫有台账）</h2>
  <div class="card">
    <div class="row">
      <button class="btn small ${certTab === 'trace' ? '' : 'ghost'}" data-action="cert-tab" data-idx="trace">🔎 追溯自证单（按患者）</button>
      <button class="btn small ${certTab === 'inspect' ? '' : 'ghost'}" data-action="cert-tab" data-idx="inspect">📋 月度迎检包（按月份）</button>
    </div>
    ${certTab === 'trace' ? `
      <div class="row" style="margin-top:12px">
        <label style="flex:1">患者标识 <input id="trace-patient" value="${esc(tracePatient)}" placeholder="如：陈*（与使用落账的写法一致）" /></label>
        <button class="btn" data-action="trace-generate">生成追溯单</button>
      </div>
      ${traceHtml}
      <p class="fine">只输出器械灭菌链，不含诊疗内容；批次若有召回历史会如实打标——「发生过、处置过、闭环了」本身就是合规的证据。</p>` : `
      <div class="row" style="margin-top:12px">
        <label>月份 <input type="month" id="inspect-month" value="${month}" /></label>
        <button class="btn" data-action="inspect-generate">生成迎检包</button>
      </div>
      ${inspectHtml}`}
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置（诊所 / 参数 / 周期台账 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const clinic = state.clinic ?? {};
  const s = state.settings ?? {};
  const today = todayISO();
  return `
  <h2 class="sec">🏥 诊所</h2>
  <div class="card">
    <div class="form-grid">
      <label>诊所名称<input id="cl-name" value="${esc(clinic.name ?? '')}" placeholder="如：向阳口腔诊所（印在追溯单上）" /></label>
      <label>联系电话<input id="cl-phone" value="${esc(clinic.phone ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-clinic">保存</button>
  </div>

  <h2 class="sec">🩺 人员健康证</h2>
  <div class="card">
    <table class="plain"><tr><th>姓名</th><th>有效期至</th><th>状态</th><th></th></tr>
      ${(state.staff ?? []).map((x) => {
    const lv = certLevel(x.certValidUntil, today);
    return `<tr><td>${esc(x.name)}</td><td class="fine">${esc(x.certValidUntil)}</td>
        <td><span class="pill ${LEVEL_PILL[lv]}">${lv === 'ok' ? '有效' : lv === 'warn' ? `临期 ${daysUntil(x.certValidUntil, today)} 天` : '已过期'}</span></td>
        <td><button class="btn small ghost" data-action="del-staff" data-idx="${esc(x.id)}">删</button></td></tr>`;
  }).join('')}
    </table>
    <div class="form-grid">
      <label>姓名<input id="st-name" placeholder="如：王护士" /></label>
      <label>健康证有效期至<input type="date" id="st-valid" /></label>
    </div>
    <button class="btn small" data-action="add-staff">加一人</button>
  </div>

  <h2 class="sec">🗑️ 医废交接台账</h2>
  <div class="card">
    <table class="plain"><tr><th>交接日</th><th>回收方</th><th>重量</th><th></th></tr>
      ${(state.wastes ?? []).slice().sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 8).map((w) => `<tr>
        <td class="fine">${esc(w.dateISO)}</td><td>${esc(w.handler ?? '')}</td><td class="fine">${w.weightKg ? `${w.weightKg} kg` : '—'}</td>
        <td><button class="btn small ghost" data-action="del-waste" data-idx="${esc(w.id)}">删</button></td></tr>`).join('')}
    </table>
    <div class="form-grid">
      <label>交接日<input type="date" id="ws-date" value="${today}" /></label>
      <label>回收方<input id="ws-handler" placeholder="如：绿源环保" /></label>
      <label>重量 kg（选填）<input type="number" id="ws-weight" min="0" step="0.1" /></label>
    </div>
    <button class="btn small" data-action="add-waste">记一笔交接</button>
    <p class="fine">《医疗废物管理条例》口径：交接登记资料保存 3 年，暂存不超过 2 天——超期体检会亮灯。</p>
  </div>

  <h2 class="sec">🧪 消毒产品 / 指示物效期</h2>
  <div class="card">
    <table class="plain"><tr><th>名称</th><th>有效期至</th><th>状态</th><th></th></tr>
      ${(state.consumables ?? []).map((c) => {
    const lv = consumableLevel(c, today);
    return `<tr class="${lv === 'expired' ? 'muted' : ''}"><td>${esc(c.name)}</td><td class="fine">${esc(c.validUntil)}</td>
        <td><span class="pill ${LEVEL_PILL[lv]}">${lv === 'ok' ? '有效' : lv === 'warn' ? '临期' : '已过期'}</span></td>
        <td><button class="btn small ghost" data-action="del-consumable" data-idx="${esc(c.id)}">删</button></td></tr>`;
  }).join('')}
    </table>
    <div class="form-grid">
      <label>名称<input id="cs-name" placeholder="如：生物指示剂（3M 1292）" /></label>
      <label>有效期至<input type="date" id="cs-valid" /></label>
    </div>
    <button class="btn small" data-action="add-consumable">加一种</button>
  </div>

  <h2 class="sec">🔔 周期参数（标准口径的本地覆盖）</h2>
  <div class="card">
    <div class="row wrap">
      <label>生物监测周期 <input type="number" id="set-bio" min="1" max="31" value="${s.bioIntervalDays ?? 7}" style="width:64px" /> 天</label>
      <label>培养宽限 <input type="number" id="set-grace" min="1" max="14" value="${s.bioGraceDays ?? 3}" style="width:64px" /> 天</label>
      <label>医废交接间隔 <input type="number" id="set-waste" min="1" max="7" value="${s.wasteIntervalDays ?? 2}" style="width:64px" /> 天</label>
      <label>临期黄线 <input type="number" id="set-expwarn" min="1" max="60" value="${s.expWarnDays ?? 7}" style="width:64px" /> 天</label>
    </div>
    <button class="btn small" data-action="save-settings">保存参数</button>
    <p class="fine">默认值是行业通识先验：监测频次与判定以 WS 506-2016 原文、设备说明书与属地要求为准——你的标准你定。</p>
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
