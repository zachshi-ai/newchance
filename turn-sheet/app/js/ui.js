/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  PLATFORMS, LINEN_TYPES, LINEN_STATUS, BASE_TASKS,
  turnoversOf, LEVEL_LABEL, taskExtras, turnoverStatus,
  todayBoard, coverageFor, transitOverdue, linenEconomics, suppliesLow,
  runSheetText, escapeHtml, minutesLabel, fmtYuan,
  todayISO, addDays,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

const LEVEL_PILL = {
  conflict: 'issue', red: 'issue', yellow: 'warn', green: 'ok', open: 'todo',
};

function statusPill(status) {
  const cls = status === 'clean' ? 'ok' : status === 'transit' ? 'warn' : status === 'dirty' ? 'issue' : status === 'retired' ? 'todo' : '';
  return `<span class="pill ${cls}">${LINEN_STATUS[status].label}</span>`;
}

export function viewOnboarding() {
  return `
  <h2 class="sec">退房到入住之间，不再靠喊</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>民宿的收入住在好评里，好评住在卫生里，而卫生住在「退房 → 入住」那两三个小时的执行里。小微房东的现状：微信喊保洁、口头交代、布草几套在洗全凭记忆——接重叠了、翻不完、客人到点进不了房、差评下来才知道。</p>
    <p><strong>翻房单的做法：</strong>录入房期 → 窗口自动变成带截止时间的任务单，复制文本发给保洁即派工；布草「在房/脏/在途/净」四态记账，缺套提前预警；退房查遗留、完成拍照留档——卫生差评申诉有证据。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏠 先建房源档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不做 OTA 直连、不做 PMS、不用保洁装 App——微信发文本即闭环。数据只存在你手机里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板 + 翻房打卡）
// ---------------------------------------------------------------------------

function turnoverCard(t, logs, sets, extras) {
  const st = turnoverStatus(t.key, logs);
  const pct = Math.round((st.done / st.total) * 100);
  const win = t.windowMinutes === null
    ? '无后续入住，按标准流程完成'
    : `窗口 ${minutesLabel(t.windowMinutes)}（标准保洁 ${minutesLabel(t.cleanMinutes)}）`;
  return `
  <div class="card turn-card">
    <div class="item-head">
      <div>
        <strong>${esc(t.propName)}</strong>
        <div class="basis">退房 ${esc(t.checkoutTime)}${t.guestOut ? ` · ${esc(t.guestOut)}` : ''} → ${t.checkinISO ? `入住 ${esc(t.checkinISO)} ${esc(t.checkinTime)}${t.guestIn ? ` · ${esc(t.guestIn)}` : ''}` : '暂无到客'}</div>
        <div class="basis">${esc(win)} · ${esc(t.platform)}</div>
      </div>
      <span class="pill ${LEVEL_PILL[t.level]}">${LEVEL_LABEL[t.level]}</span>
    </div>
    <div class="progress-line"><div class="progress-bar" style="width:${pct}%"></div></div>
    <div class="row wrap" style="margin-top:8px">
      ${BASE_TASKS.map((task) => {
        const done = st.done >= 0 && logs?.[t.key]?.tasks?.[task.id];
        return `<button class="btn small ${done ? '' : 'ghost'}" data-action="mark-task" data-turn="${esc(t.key)}" data-task="${task.id}">${done ? '✓' : '○'} ${task.name}</button>`;
      }).join('')}
    </div>
    ${extras.length ? `<ul class="extra-list">${extras.map((x) => `<li>‼ ${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="row">
      <input class="note-input" id="found-${esc(t.key)}" placeholder="遗留物品记录（品名/联系客人/处理）" value="${esc(st.found)}" />
      <button class="btn small" data-action="save-found" data-turn="${esc(t.key)}">保存记录</button>
    </div>
    ${st.allDone ? '<p class="done-note">✅ 本间翻房已完成并留档。</p>' : ''}
  </div>`;
}

export function viewBoard(state) {
  if (!state.properties?.length) return viewOnboarding();
  const today = todayISO();
  const board = todayBoard({
    todayISOStr: today, stays: state.stays, properties: state.properties,
    sets: state.linenSets, supplies: state.supplies, logs: state.turnoverLogs,
    slaDays: state.settings?.washSlaDays ?? 3,
  });
  const propsById = new Map(state.properties.map((p) => [p.id, p]));

  const alertHtml = [];
  if (board.conflicts.length) {
    alertHtml.push(`<div class="card alert issue"><strong>⚠ 订单重叠</strong>
      <ul>${board.conflicts.map((c) => `<li>同一房源存在时间重叠的订单——先改期，否则两位客人同时到门</li>`).join('')}</ul></div>`);
  }
  if (board.transitOverdue.length) {
    alertHtml.push(`<div class="card alert"><strong>🧺 布草在途超时</strong>
      <ul>${board.transitOverdue.map((g) => `<li>${g.sentAt} 送洗的 ${g.sets.length} 套已 ${g.days} 天未回（SLA ${state.settings?.washSlaDays ?? 3} 天）——催洗涤厂，超时可主张赔付</li>`).join('')}</ul></div>`);
  }
  if (board.linenShortages.length) {
    alertHtml.push(`<div class="card alert"><strong>🛏️ 布草缺口预警</strong>
      <ul>${board.linenShortages.map((w) => `<li>${w.date} ${esc(w.propName)}：${Object.entries(w.byType).map(([type, v]) => `${LINEN_TYPES[type].label}缺 ${v.shortfall}（净布 ${v.clean}/需 ${v.need}，在途 ${v.transit}）`).join('；')}</li>`).join('')}</ul></div>`);
  }
  if (board.suppliesLow.length) {
    alertHtml.push(`<div class="card alert"><strong>📦 耗品低库存</strong>
      <ul>${board.suppliesLow.map((s) => `<li>${esc(s.name)}：剩 ${s.stock}，安全线 ${s.minStock}——补货</li>`).join('')}</ul></div>`);
  }

  const checkouts = board.checkoutsToday.map((t) => `${esc(t.propName)}（${esc(t.checkoutTime)}${t.guestOut ? ` · ${esc(t.guestOut)}` : ''}）`).join('、');
  const checkins = board.checkinsToday.map((s) => `${esc(s.propName || propsById.get(s.propId)?.name || '')}（${esc(s.checkinTime)}${s.guest ? ` · ${esc(s.guest)}` : ''}）`).join('、');

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">🚪 今日退房：<strong>${board.checkoutsToday.length}</strong> 间　🛎️ 今日到客：<strong>${board.checkinsToday.length}</strong> 间</div>
    ${checkouts ? `<p class="done-note">退房：${checkouts}</p>` : ''}
    ${checkins ? `<p class="done-note">到客：${checkins}</p>` : ''}
  </div>
  ${alertHtml.join('')}
  <h2 class="sec">翻房窗口（昨日 ~ 未来 3 天，紧张的在前）</h2>
  ${board.upcoming.length
    ? board.upcoming.map((t) => turnoverCard(
        t, state.turnoverLogs, state.linenSets,
        taskExtras({
          prop: state.properties.find((p) => p.id === t.propId),
          linenByType: coverageFor(propsById.get(t.propId) ?? {}, state.linenSets),
          transitOverdue: board.transitOverdue.reduce((s, g) => s + g.sets.length, 0),
        }),
      )).join('')
    : '<div class="card"><p class="fine">未来 3 天没有翻房任务。去「房期」录入订单，窗口会自动出现在这里。</p></div>'}
  <div class="row" style="margin-top:14px">
    <a class="btn ghost" href="#/runsheet">🧾 生成翻房单发给保洁</a>
    <a class="btn ghost" href="#/linen">🧺 布草周转账</a>
  </div>`;
}

// ---------------------------------------------------------------------------
// 房期
// ---------------------------------------------------------------------------

export function viewStays(state) {
  if (!state.properties?.length) return viewOnboarding();
  const propsById = new Map(state.properties.map((p) => [p.id, p]));
  const today = todayISO();
  const turnovers = turnoversOf(state.stays, state.properties);
  const levelByKey = new Map(turnovers.map((t) => [t.key, t.level]));
  const sorted = [...state.stays].sort((a, b) => b.checkin.localeCompare(a.checkin));

  return `
  <h2 class="sec">🗓️ 房期（手工录入；不做 OTA 直连是特性不是缺陷）</h2>
  <div class="card">
    <div class="form-grid">
      <label>房源
        <select id="stay-prop">${state.properties.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      </label>
      <label>平台
        <select id="stay-platform">${Object.entries(PLATFORMS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      </label>
      <label>房客称呼<input id="stay-guest" placeholder="如：张先生（选填）" /></label>
      <label>联系电话<input id="stay-phone" placeholder="选填" /></label>
      <label>入住日期<input type="date" id="stay-in" value="${today}" /></label>
      <label>入住时间<input type="time" id="stay-in-t" value="14:00" /></label>
      <label>退房日期<input type="date" id="stay-out" value="${addDays(today, 1)}" /></label>
      <label>退房时间<input type="time" id="stay-out-t" value="12:00" /></label>
    </div>
    <button class="btn" data-action="add-stay">添加房期</button>
    <p class="fine">退房与下一次入住之间的窗口，就是翻房任务单的截止时间——它会被自动算出来。</p>
  </div>
  <h2 class="sec">订单列表（近的在前）</h2>
  ${sorted.length ? `<div class="card"><table class="plain">
    <tr><th>房源</th><th>入住</th><th>退房</th><th>房客</th><th>平台</th><th>翻房窗口</th><th></th></tr>
    ${sorted.map((s) => {
      const t = turnovers.find((x) => x.key.endsWith(`|${s.id}`));
      const lv = t ? levelByKey.get(t.key) : null;
      const win = t
        ? (t.windowMinutes === null ? '无后续' : `${minutesLabel(t.windowMinutes)} ${LEVEL_LABEL[t.level]}`)
        : '—';
      return `<tr>
        <td>${esc(propsById.get(s.propId)?.name ?? '?')}</td>
        <td>${esc(s.checkin)} ${esc(s.checkinTime ?? '14:00')}</td>
        <td>${esc(s.checkout)} ${esc(s.checkoutTime ?? '12:00')}</td>
        <td>${esc(s.guest || '—')}</td>
        <td class="fine">${esc(PLATFORMS[s.platform]?.label ?? PLATFORMS.other.label)}</td>
        <td>${lv ? `<span class="pill ${LEVEL_PILL[lv]}">${esc(win)}</span>` : esc(win)}</td>
        <td><button class="btn small ghost" data-action="del-stay" data-idx="${state.stays.indexOf(s)}">删除</button></td>
      </tr>`;
    }).join('')}
  </table></div>` : '<div class="card"><p class="fine">还没有订单。添加第一单后，翻房窗口与任务单会自动生成。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 布草周转账
// ---------------------------------------------------------------------------

function linenSummary(sets) {
  const byType = {};
  for (const type of Object.keys(LINEN_TYPES)) {
    const pool = sets.filter((s) => s.type === type && s.status !== 'retired');
    byType[type] = { total: pool.length, ...Object.fromEntries(['room', 'dirty', 'transit', 'clean'].map((k) => [k, pool.filter((s) => s.status === k).length])) };
  }
  return byType;
}

export function viewLinen(state) {
  const today = todayISO();
  const sets = state.linenSets;
  const eco = linenEconomics({
    sets, events: state.linenEvents, todayISOStr: today,
    ratedOverrides: state.settings?.ratedWashes ?? {},
  });
  const overdue = transitOverdue(sets, today, state.settings?.washSlaDays ?? 3);
  const summary = linenSummary(sets);

  const sumHtml = Object.entries(summary).map(([type, c]) => `
    <div class="card linen-sum">
      <strong>${LINEN_TYPES[type].label}</strong>
      <div class="basis">共 ${c.total} 套（不含报废）</div>
      <div class="row wrap linen-chips">
        <span class="pill">在房 ${c.room}</span><span class="pill issue">脏 ${c.dirty}</span>
        <span class="pill warn">在途 ${c.transit}</span><span class="pill ok">净 ${c.clean}</span>
      </div>
      <div class="basis">每次洗涤成本 ${fmtYuan(eco.types[type]?.costPerWash ?? 0)}（额定 ${eco.types[type]?.ratedWashes ?? '—'} 次）</div>
    </div>`).join('');

  return `
  <h2 class="sec">🧺 布草周转账（在房 → 脏 → 在途 → 净 → 再上房）</h2>
  <div class="grid">${sumHtml}</div>
  ${overdue.length ? `<div class="card alert"><strong>⏰ 在途超时（催厂/认损）</strong>
    <ul>${overdue.map((g) => `<li>${g.sentAt} 送洗 ${g.sets.length} 套：${g.sets.map((s) => esc(s.label)).join('、')}，已 ${g.days} 天未回</li>`).join('')}</ul></div>` : ''}
  <div class="card">
    <strong>重购预算</strong>
    ${eco.monthlyWashes === null
      ? '<p class="fine">洗涤节奏样本不足（近 90 天回洗 <4 套次），暂不预测报废——不编造节奏。正常周转几周后自动给出 90 天重购清单。</p>'
      : `<p class="fine">按月均 ${eco.monthlyWashes} 套次洗涤节奏，90 天内将耗尽寿命：${Object.entries(eco.types).filter(([, v]) => v && v.expiring > 0).map(([t, v]) => `${LINEN_TYPES[t].label} ${v.expiring} 套（预算 ${fmtYuan(v.replacementCents)}）`).join('；') || '暂无'}。</p>`}
  </div>

  <h2 class="sec">布草操作（勾选后按按钮批量过账）</h2>
  <div class="card">
    <div class="row wrap">
      <button class="btn small" data-action="linen-op" data-op="strip">撤下（在房→脏）</button>
      <button class="btn small" data-action="linen-op" data-op="send">送洗（脏→在途）</button>
      <button class="btn small" data-action="linen-op" data-op="recv">洗毕回库（在途→净）</button>
      <button class="btn small" data-action="linen-op" data-op="selfwash">自洗回库（脏→净）</button>
      <button class="btn small" data-action="linen-op" data-op="retire">报废</button>
    </div>
    <div class="row">
      <select id="linen-deploy-prop">${state.properties.map((p) => `<option value="${p.id}">铺入：${esc(p.name)}</option>`).join('')}</select>
      <button class="btn small" data-action="linen-op" data-op="deploy">铺入房间（净→在房）</button>
    </div>
    ${sets.length ? `<table class="plain" style="margin-top:8px">
      <tr><th></th><th>编号</th><th>类型</th><th>状态</th><th>位置</th><th>已洗/额定</th><th>送洗日</th></tr>
      ${[...sets].sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label)).map((s) => `
        <tr class="${s.status === 'retired' ? 'muted' : ''}">
          <td>${s.status === 'retired' ? '' : `<input type="checkbox" class="ln-check" value="${s.id}" />`}</td>
          <td>${esc(s.label)}</td>
          <td>${LINEN_TYPES[s.type].label}</td>
          <td>${statusPill(s.status)}</td>
          <td class="fine">${s.inProp ? esc(state.properties.find((p) => p.id === s.inProp)?.name ?? '?') : s.sentAt ? `送洗于 ${esc(s.sentAt)}` : '—'}</td>
          <td>${s.washes}/${eco.types[s.type]?.ratedWashes ?? '—'}</td>
          <td class="fine">${s.sentAt ?? '—'}</td>
        </tr>`).join('')}
    </table>` : '<p class="fine">还没有布草。先在下方「新购入库」。</p>'}
  </div>

  <h2 class="sec">新购入库 / 数据</h2>
  <div class="card">
    <div class="row">
      <select id="linen-buy-type">${Object.entries(LINEN_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
      <input type="number" id="linen-buy-count" min="1" max="99" value="2" style="width:70px" title="套数" />
      <input type="number" id="linen-buy-price" min="0" value="129" style="width:90px" title="单价（元）" />
      <span class="fine">元/套</span>
      <button class="btn small" data-action="linen-buy">新购入库</button>
    </div>
    <p class="fine">新购直接以「净布」入账；每套的洗涤次数从 0 开始累计，接近额定次数时进入重购清单——布草不是坏了才换，是按洗涤寿命换。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 翻房单导出
// ---------------------------------------------------------------------------

export function defaultSheetDate(today = todayISO()) {
  return today;
}

export function viewRunSheet(state, sheetDate) {
  if (!state.properties?.length) return viewOnboarding();
  const date = sheetDate ?? defaultSheetDate();
  const turnovers = turnoversOf(state.stays, state.properties)
    .filter((t) => t.checkoutISO === date)
    .sort((a, b) => (a.checkoutTime).localeCompare(b.checkoutTime));
  const propsById = new Map(state.properties.map((p) => [p.id, p]));
  const extrasByProp = {};
  for (const t of turnovers) {
    extrasByProp[t.propId] = taskExtras({
      prop: propsById.get(t.propId),
      linenByType: coverageFor(propsById.get(t.propId) ?? {}, state.linenSets),
      transitOverdue: transitOverdue(state.linenSets, todayISO(), state.settings?.washSlaDays ?? 3)
        .reduce((s, g) => s + g.sets.length, 0),
    });
  }
  let text = '';
  let none = false;
  try {
    text = runSheetText({
      turnovers, dateISO: date, extrasByProp,
      hostName: state.host?.name ?? '', todayISOStr: todayISO(),
    });
  } catch {
    none = true;
  }

  return `
  <h2 class="sec">🧾 翻房任务单（微信发保洁 = 派工完成）</h2>
  <div class="card">
    <div class="row">
      <label>翻房日 <input type="date" id="sheet-date" value="${date}" /></label>
      <button class="btn small" data-action="sheet-apply">生成</button>
    </div>
    ${none
      ? `<p class="fine">${esc(date)} 没有退房，不需要翻房单。换一天，或去「房期」录入订单。</p>`
      : `<div class="row stats-line"><span><strong>${turnovers.length}</strong> 间房</span>
          <span>紧张窗口 <strong>${turnovers.filter((t) => t.level === 'red' || t.level === 'conflict').length}</strong></span></div>
      <div class="row">
        <button class="btn" data-action="sheet-copy">📋 复制文本（微信粘贴给保洁）</button>
        <button class="btn ghost" data-action="sheet-download">⬇️ 下载打印版 HTML</button>
        <button class="btn ghost" data-action="sheet-print">🖨️ 直接打印</button>
      </div>
      <pre class="preview">${esc(text)}</pre>
      <p class="fine">文本通道为主：保洁阿姨不用装 App，微信收到就能照单干活；打印版为单文件 HTML，可贴在布草柜或留档。</p>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置（房东档案 / 房源 / 耗品 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const h = state.host ?? {};
  const low = suppliesLow(state.supplies);
  return `
  <h2 class="sec">🏠 房东 / 主理人</h2>
  <div class="card">
    <div class="form-grid">
      <label>称呼<input id="set-name" value="${esc(h.name ?? '')}" placeholder="如：小林（保洁认这个名字）" /></label>
      <label>联系电话<input id="set-phone" value="${esc(h.phone ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-host">保存</button>
  </div>

  <h2 class="sec">🚪 房源（${state.properties.length}）</h2>
  <div class="card">
    ${state.properties.length ? `<table class="plain">
      <tr><th>名称</th><th>床</th><th>巾类/次</th><th>标准保洁</th><th>门锁/取钥</th><th></th></tr>
      ${state.properties.map((p, i) => `<tr>
        <td>${esc(p.name)}</td><td>${p.beds ?? 1}</td><td>${p.towels ?? 2}</td>
        <td>${minutesLabel(p.cleanMinutes ?? 90)}</td><td class="fine">${esc(p.lockNote || '—')}</td>
        <td><button class="btn small ghost" data-action="del-prop" data-idx="${i}">删除</button></td>
      </tr>`).join('')}
    </table>` : '<p class="fine">先添加房源——它是翻房单、布草缺口计算的锚点。</p>'}
    <div class="form-grid" style="margin-top:10px">
      <label>房源名称<input id="prop-name" placeholder="如：山语小院·A栋" /></label>
      <label>床数<input type="number" id="prop-beds" min="1" max="9" value="1" /></label>
      <label>巾类套数/次<input type="number" id="prop-towels" min="1" max="9" value="2" /></label>
      <label>标准保洁分钟<input type="number" id="prop-clean" min="20" max="480" value="90" /></label>
      <label class="span2">门锁密码/取钥方式<input id="prop-lock" placeholder="如：密码 5026# / 物业前台取备用钥" /></label>
    </div>
    <button class="btn small" data-action="add-prop">添加房源</button>
  </div>

  <h2 class="sec">📦 耗品（翻房时逐项核对）</h2>
  <div class="card">
    ${state.supplies.length ? `<table class="plain">
      <tr><th>品名</th><th>当前库存</th><th>安全线</th><th></th><th></th></tr>
      ${state.supplies.map((s, i) => `<tr>
        <td>${esc(s.name)}</td>
        <td><input type="number" id="sup-stock-${i}" value="${s.stock}" min="0" style="width:70px" data-action-blur="sup-stock" data-idx="${i}" /></td>
        <td>${s.minStock}</td>
        <td>${low.includes(s) ? '<span class="pill warn">需补货</span>' : ''}</td>
        <td><button class="btn small ghost" data-action="del-supply" data-idx="${i}">删除</button></td>
      </tr>`).join('')}
    </table>` : '<p class="fine">还没有耗品条目。</p>'}
    <div class="row">
      <input id="sup-name" placeholder="品名，如：卷纸" />
      <input type="number" id="sup-stock" min="0" value="4" style="width:70px" title="当前库存" />
      <input type="number" id="sup-min" min="0" value="4" style="width:70px" title="安全线" />
      <button class="btn small" data-action="add-supply">添加耗品</button>
    </div>
  </div>

  <h2 class="sec">🧺 洗涤参数（行业先验的本地覆盖）</h2>
  <div class="card">
    <div class="row">
      <label>洗涤厂 SLA（天）<input type="number" id="set-sla" min="1" max="14" value="${state.settings?.washSlaDays ?? 3}" style="width:70px" /></label>
      <label>床品额定洗涤次数<input type="number" id="set-rw-bed" min="10" max="999" value="${state.settings?.ratedWashes?.bed ?? 130}" style="width:80px" /></label>
      <label>巾类额定洗涤次数<input type="number" id="set-rw-towel" min="10" max="999" value="${state.settings?.ratedWashes?.towel ?? 150}" style="width:80px" /></label>
    </div>
    <button class="btn small" data-action="save-settings">保存参数</button>
    <p class="fine">额定次数是行业通识先验（全棉布草常见 130~150 次），洗涤厂/供应商给你的数字永远赢——直接改这里。</p>
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
