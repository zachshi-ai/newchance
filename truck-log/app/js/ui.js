/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  CERT_KINDS, RECORD_TYPES, ALERT_TYPES,
  certBoard, certState, driverState, openAlerts,
  vehicleLedger, vehicleCost, lastOdometer, monthlyDynSummary,
  fmtYuan, escapeHtml, todayISO, addDays, monthKey,
} from './core.js';

export const esc = escapeHtml;

const LEVEL_PILL = { overdue: 'bad', due: 'warn', ok: 'ok' };
const LEVEL_TEXT = { overdue: '逾期', due: '临期', ok: '正常' };

export function weekdayLabel(iso) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

export function viewOnboarding() {
  return `
  <h2 class="sec">营运货车，先有一本查得到的账</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>配发《道路运输证》的货车每年审验一次；检验检测按车龄 12 或 6 个月一个周期；交强险断保上路就是扣车加保费二倍罚款；技术档案要一车一档；动态监控报警要「提醒了、处理了、记录了」——漏掉任何一只钟，罚单和停运就在下一个路检口。小微货运部的现状：证照日期全在车主脑子里，技术档案是空白本子，报警提示音响了就划掉。</p>
    <p><strong>车轮账的做法：</strong>车辆建档 → 四只证照钟（年审/检验检测/交强险/商业险）红黄绿倒计时 → 技术档案随手记一笔（维护/维修/换件/检验/事故）→ 动态监控报警登记与处理闭环 → 一键出迎检一页纸和一车一档打印版。</p>
    <div class="row">
      <a class="btn" href="#/vehicles">🚚 先把第一辆车建上档</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">4.5 吨及以下蓝牌普货车不适用《道路运输车辆技术管理规定》（部令 2023 年第 3 号第 33 条），本工具按黄牌营运车设计；数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：未处理报警 + 证照钟 + 驾驶员 + 车队速览）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.vehicles?.length) return viewOnboarding();
  const today = todayISO();
  const warnDays = state.settings?.warnDays ?? 60;
  const alertDays = state.settings?.alertDays ?? 7;
  const board = certBoard(state, today, warnDays);
  const red = board.filter((r) => r.level === 'overdue');
  const yellow = board.filter((r) => r.level === 'due');
  const open = openAlerts(state);
  const year = today.slice(0, 4);
  const yearCost = (state.vehicles ?? []).reduce((n, v) => n + vehicleCost(state, v.id, year), 0);

  const alerts = [];
  if (open.length) {
    alerts.push(`<div class="card alert issue"><strong>⚠ 动态监控未处理报警（${open.length}）</strong>
      <ul>${open.slice(0, 8).map((a) => {
      const v = state.vehicles.find((x) => x.id === a.vehicleId);
      const age = daysBetween(a.dateISO, today);
      const hot = age >= alertDays ? '（挂账超线）' : '';
      return `<li>${esc(a.dateISO)} ${esc(v?.plate ?? '?')} · ${esc(ALERT_TYPES[a.type] ?? a.type)}${a.detail ? `：${esc(a.detail)}` : ''}——挂了 ${age} 天${hot}，去「台账」闭环</li>`;
    }).join('')}</ul>
      <p class="fine">处理率低于 90% 属法定罚则情形（《道路运输车辆动态监督管理办法》第 35 条）；违法驾驶信息及处理情况至少保存 3 年（第 25 条）。</p></div>`);
  }
  if (red.length) {
    alerts.push(`<div class="card alert issue"><strong>🛑 证照已逾期（${red.length}）</strong>
      <ul>${red.map((r) => `<li>${esc(r.plate)} · ${esc(r.kindLabel)}：${esc(r.expiryISO)} 到期，已逾期 ${-r.daysLeft} 天——${r.kind === 'compulsory' ? '交强险脱保上路可扣车并处保费二倍罚款（道交法第 98 条）' : '先停运再补办，别赌路检'}</li>`).join('')}</ul></div>`);
  }
  if (yellow.length) {
    alerts.push(`<div class="card alert"><strong>⏰ 证照临期（${warnDays} 天内到期）</strong>
      <ul>${yellow.map((r) => `<li>${esc(r.plate)} · ${esc(r.kindLabel)}：${r.daysLeft === 0 ? '今天' : `${r.daysLeft} 天后`}（${esc(r.expiryISO)}）到期——预约检测站/保险，别拖到红灯</li>`).join('')}</ul></div>`);
  }
  const driverAlerts = (state.drivers ?? []).map((d) => ({ d, st: driverState(d, today, warnDays) }))
    .filter((x) => x.st.certLevel === 'overdue' || x.st.certLevel === 'due' || x.st.assessLevel === 'overdue' || x.st.assessLevel === 'due');
  if (driverAlerts.length) {
    alerts.push(`<div class="card alert"><strong>🧑‍✈️ 驾驶员证照</strong>
      <ul>${driverAlerts.map(({ d, st }) => {
      const parts = [];
      if (st.certLevel && st.certLevel !== 'ok') parts.push(`从业资格证 ${st.certLevel === 'overdue' ? `已逾期 ${-st.certDaysLeft} 天` : `剩 ${st.certDaysLeft} 天`}`);
      if (st.assessLevel && st.assessLevel !== 'ok') parts.push(`诚信考核 ${st.assessDueISO} ${st.assessLevel === 'overdue' ? '已过期' : '到期'}`);
      return `<li>${esc(d.name)}：${parts.join('；')}</li>`;
    }).join('')}</ul>
      <p class="fine">从业资格证有效期 6 年，届满 30 日前换证；诚信考核周期 12 个月。</p></div>`);
  }

  const redCount = red.length + open.filter((a) => -daysBetween(a.dateISO, today) >= alertDays).length;
  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">🚚 车队在册：<strong>${state.vehicles.length}</strong> 辆 · <strong>${open.length}</strong> 条报警未处理 · <strong>${red.length}</strong> 只证照逾期</div>
    ${redCount === 0
    ? '<p class="done-note">今天没有红灯。把黄灯的证照约掉，就是给下个月的自己省钱。</p>'
    : '<p class="done-note">有红灯在烧：先停运、再补办，路检口不认「忘了」。</p>'}
  </div>
  ${alerts.join('')}
  <h2 class="sec">证照钟全景（按紧急排序）</h2>
  <div class="card"><table class="plain">
    <tr><th>车牌</th><th>证照</th><th>到期日</th><th>倒计时</th><th>状态</th></tr>
    ${board.map((r) => `<tr class="${r.level === 'overdue' ? 'muted' : ''}">
      <td><strong>${esc(r.plate)}</strong></td><td>${esc(r.kindLabel)}</td><td class="fine">${esc(r.expiryISO)}</td>
      <td>${r.daysLeft < 0 ? `逾期 ${-r.daysLeft} 天` : `${r.daysLeft} 天`}</td>
      <td><span class="pill ${LEVEL_PILL[r.level]}">${LEVEL_TEXT[r.level]}</span></td>
    </tr>`).join('')}
  </table><p class="fine">检验检测周期按车龄自动判档：注册不满 120 个月每 12 个月一次，满 120 个月后每 6 个月一次（部令 2023 年第 3 号第 21 条口径，以车籍地要求为准）。</p></div>
  <h2 class="sec">车队速览</h2>
  <div class="card">
    <div class="row stats-line">
      <span>技术档案 <strong>${(state.records ?? []).length}</strong> 条</span>
      <span>${year} 年养车支出 <strong>${fmtYuan(yearCost)}</strong></span>
      <span>驾驶员 <strong>${(state.drivers ?? []).length}</strong> 人</span>
    </div>
    <div class="row">
      <a class="btn" href="#/ledger">🧾 记一笔技术档案</a>
      <a class="btn ghost" href="#/reports">📑 生成迎检一页纸</a>
    </div>
  </div>`;
}

function daysBetween(fromISO, toISO) {
  return Math.round((new Date(`${toISO}T00:00:00Z`) - new Date(`${fromISO}T00:00:00Z`)) / 86400000);
}

// ---------------------------------------------------------------------------
// 车辆（车辆档案 + 证照钟 + 驾驶员）
// ---------------------------------------------------------------------------

export function viewVehicles(state) {
  const today = todayISO();
  const warnDays = state.settings?.warnDays ?? 60;
  const certChips = (vehicleId) => (state.certs ?? [])
    .filter((c) => c.vehicleId === vehicleId)
    .map((c) => {
      const st = certState(c, today, warnDays);
      return `<span class="pill ${LEVEL_PILL[st.level]}">${esc(CERT_KINDS[c.kind]?.label ?? c.kind)} ${st.daysLeft < 0 ? `逾期${-st.daysLeft}天` : `${st.daysLeft}天`}</span>`;
    }).join('') || '<span class="fine">未设证照钟</span>';
  return `
  <h2 class="sec">🚚 车辆（${state.vehicles.length}）——一车一档</h2>
  <div class="card">
    <div class="form-grid">
      <label>车牌号<input id="veh-plate" placeholder="如：冀A·12345" /></label>
      <label>车型<input id="veh-model" placeholder="如：仓栅式货车 / 牵引车（选填）" /></label>
      <label>注册登记日期<input type="date" id="veh-reg" value="2020-01-01" /></label>
      <label>道路运输证号<input id="veh-cert-no" placeholder="证上的编号（选填）" /></label>
      <label class="span2">备注<input id="veh-note" placeholder="如：拉京津线建材（选填）" /></label>
    </div>
    <button class="btn" data-action="add-vehicle">建车上档</button>
    <p class="fine">注册登记日期决定检验检测周期档（不满 120 个月 12 个月一次，满 120 个月后 6 个月一次）；档案随车，卖车时打印带走。</p>
  </div>
  ${state.vehicles.length ? `<div class="card"><table class="plain">
    <tr><th>车辆</th><th>证照钟</th><th>最近里程</th><th>${today.slice(0, 4)} 年支出</th><th></th></tr>
    ${[...state.vehicles].reverse().map((v) => `<tr>
      <td><strong>${esc(v.plate)}</strong>${v.model ? `<div class="basis">${esc(v.model)}</div>` : ''}
        <div class="basis">${esc(v.transportCertNo || '证号未填')}</div></td>
      <td>${certChips(v.id)}</td>
      <td>${lastOdometer(state, v.id) ?? '—'}</td>
      <td>${fmtYuan(vehicleCost(state, v.id, today.slice(0, 4)))}</td>
      <td>
        <button class="btn small ghost" data-action="print-archive" data-idx="${state.vehicles.indexOf(v)}">一车一档</button>
        <button class="btn small ghost" data-action="del-vehicle" data-idx="${state.vehicles.indexOf(v)}">删除</button>
      </td>
    </tr>`).join('')}
  </table><p class="fine">「一车一档」生成单文件打印版（部令 2023 年第 3 号第 15 条形态）；有证照或档案记录的车辆不可删除，先清数据。</p></div>`
    : '<div class="card"><p class="fine">先把第一辆车建上档。</p></div>'}

  <h2 class="sec">⏰ 证照钟（${(state.certs ?? []).length}）</h2>
  <div class="card">
    ${state.vehicles.length ? `
    <div class="form-grid">
      <label>车辆<select id="cert-vehicle">${state.vehicles.map((v) => `<option value="${v.id}">${esc(v.plate)}</option>`).join('')}</select></label>
      <label>证照<select id="cert-kind">
        ${Object.entries(CERT_KINDS).map(([k, x]) => `<option value="${k}">${esc(x.label)}</option>`).join('')}
      </select></label>
      <label>到期日<input type="date" id="cert-expiry" value="${addDays(today, 365)}" /></label>
      <label class="span2">备注<input id="cert-note" placeholder="如：已在宏发检测站预约（选填）" /></label>
    </div>
    <button class="btn" data-action="add-cert">上钟</button>
    <p class="fine">${Object.values(CERT_KINDS).map((x) => `${x.label}：${x.basis}`).join('；')}。工具只亮灯不代缴，属地规则永远赢。</p>`
    : '<p class="fine">先建车辆，再上证照钟。</p>'}
    ${(state.certs ?? []).length ? `<table class="plain" style="margin-top:10px">
      <tr><th>车辆</th><th>证照</th><th>到期日</th><th>续期（填新到期日）</th><th></th></tr>
      ${state.certs.map((c, i) => {
      const v = state.vehicles.find((x) => x.id === c.vehicleId);
      const st = certState(c, today, warnDays);
      return `<tr>
        <td><strong>${esc(v?.plate ?? '?')}</strong></td><td>${esc(CERT_KINDS[c.kind]?.label ?? c.kind)}</td>
        <td class="fine">${esc(c.expiryISO)} <span class="pill ${LEVEL_PILL[st.level]}">${LEVEL_TEXT[st.level]}</span></td>
        <td><input type="date" class="renew-date" data-renew="${c.id}" value="${addDays(today, 365)}" /></td>
        <td><button class="btn small" data-action="renew-cert" data-idx="${i}">办结续期</button>
          <button class="btn small ghost" data-action="del-cert" data-idx="${i}">删除</button></td>
      </tr>`;
    }).join('')}
    </table>` : ''}
  </div>

  <h2 class="sec">🧑‍✈️ 驾驶员（${(state.drivers ?? []).length}）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名<input id="drv-name" placeholder="如：张建国" /></label>
      <label>电话<input id="drv-phone" placeholder="选填" /></label>
      <label>从业资格证到期日<input type="date" id="drv-cert" value="${addDays(today, 365 * 3)}" /></label>
      <label>最近诚信考核完成日<input type="date" id="drv-assess" value="${addDays(today, -30)}" /></label>
    </div>
    <button class="btn" data-action="add-driver">添加驾驶员</button>
    <p class="fine">从业资格证件有效期 6 年、届满 30 日前换证，超 180 日未换证失效；诚信考核周期 12 个月——过期前几天这里会亮灯。</p>
    ${(state.drivers ?? []).length ? `<table class="plain" style="margin-top:10px">
      <tr><th>姓名</th><th>从业资格证</th><th>下次诚信考核</th><th></th></tr>
      ${state.drivers.map((d, i) => {
      const st = driverState(d, today, warnDays);
      const certCell = d.certExpiryISO
        ? `${esc(d.certExpiryISO)} <span class="pill ${LEVEL_PILL[st.certLevel] ?? 'ok'}">${st.certDaysLeft < 0 ? `逾期${-st.certDaysLeft}天` : `${st.certDaysLeft}天`}</span>${st.certExpired ? `<div class="basis">⚠ ${esc(st.certExpired)}</div>` : ''}`
        : '—';
      const assessCell = d.assessISO ? `${esc(st.assessDueISO)} <span class="pill ${LEVEL_PILL[st.assessLevel] ?? 'ok'}">${st.assessDaysLeft < 0 ? '已过期' : `${st.assessDaysLeft}天`}</span>` : '—';
      return `<tr><td><strong>${esc(d.name)}</strong>${d.phone ? `<div class="basis">${esc(d.phone)}</div>` : ''}</td>
        <td>${certCell}</td><td>${assessCell}</td>
        <td><button class="btn small ghost" data-action="del-driver" data-idx="${i}">删除</button></td></tr>`;
    }).join('')}
    </table>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// 台账（技术档案 + 动态监控报警）
// ---------------------------------------------------------------------------

export function viewLedger(state) {
  const today = todayISO();
  const alertDays = state.settings?.alertDays ?? 7;
  const open = openAlerts(state);
  const vehicleById = new Map(state.vehicles.map((v) => [v.id, v]));
  const driverById = new Map((state.drivers ?? []).map((d) => [d.id, d]));
  const recent = [...(state.records ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40);
  const allAlerts = [...(state.alerts ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 30);
  return `
  <h2 class="sec">🧾 技术档案（一车一档流水）</h2>
  <div class="card">
    ${state.vehicles.length ? `
    <div class="form-grid">
      <label>车辆<select id="rec-vehicle">${state.vehicles.map((v) => `<option value="${v.id}">${esc(v.plate)}</option>`).join('')}</select></label>
      <label>日期<input type="date" id="rec-date" value="${today}" /></label>
      <label>类型<select id="rec-type">${Object.entries(RECORD_TYPES).map(([k, x]) => `<option value="${k}">${esc(x)}</option>`).join('')}</select></label>
      <label>里程（km）<input type="number" id="rec-odo" min="0" placeholder="选填" /></label>
      <label>事项<input id="rec-title" placeholder="如：二级维护 / 换两只驱动轮" /></label>
      <label>费用（元）<input type="number" id="rec-cost" min="0" value="0" /></label>
      <label>厂店/经办<input id="rec-vendor" placeholder="选填" /></label>
      <label class="span2">备注<input id="rec-note" placeholder="选填" /></label>
    </div>
    <button class="btn" data-action="add-record">记入档案</button>
    <p class="fine">维护修理、零部件更换、行驶里程、事故都是法定档案内容（部令 2023 年第 3 号第 15 条）；费用自动进「车辆年度支出」。</p>`
    : '<p class="fine">先建车辆。</p>'}
    ${recent.length ? `<table class="plain" style="margin-top:10px">
      <tr><th>日期</th><th>车辆</th><th>类型</th><th>事项</th><th>里程</th><th>费用</th><th></th></tr>
      ${recent.map((r) => `<tr>
        <td class="fine">${esc(r.dateISO)}</td><td><strong>${esc(vehicleById.get(r.vehicleId)?.plate ?? '?')}</strong></td>
        <td>${esc(RECORD_TYPES[r.type] ?? r.type)}</td><td>${esc(r.title || '—')}${r.vendor ? `<div class="basis">${esc(r.vendor)}</div>` : ''}</td>
        <td class="fine">${Number.isInteger(r.odometer) ? `${r.odometer} km` : '—'}</td>
        <td>${fmtYuan(r.costCents)}</td>
        <td><button class="btn small ghost" data-action="del-record" data-idx="${r.id}">删除</button></td>
      </tr>`).join('')}
    </table><p class="fine">最近 40 条；误记可删，但删掉的每一笔都会让档案变薄——档案的厚度就是路检时的底气。</p>`
    : ''}
  </div>

  <h2 class="sec">📡 动态监控报警（${open.length} 条未处理）</h2>
  <div class="card">
    ${state.vehicles.length ? `
    <div class="form-grid">
      <label>车辆<select id="alr-vehicle">${state.vehicles.map((v) => `<option value="${v.id}">${esc(v.plate)}</option>`).join('')}</select></label>
      <label>驾驶员<select id="alr-driver"><option value="">不指定</option>${(state.drivers ?? []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
      <label>报警日期<input type="date" id="alr-date" value="${today}" /></label>
      <label>类型<select id="alr-type">${Object.entries(ALERT_TYPES).map(([k, x]) => `<option value="${k}">${esc(x)}</option>`).join('')}</select></label>
      <label class="span2">报警内容<input id="alr-detail" placeholder="如：平台提示连续驾驶超 4 小时" /></label>
    </div>
    <button class="btn" data-action="add-alert">登记报警</button>`
    : '<p class="fine">先建车辆。</p>'}
    ${open.length ? `
    <h3 class="basis" style="margin:10px 0 4px">处理闭环（提醒了、处理了、记录了）</h3>
    <div class="form-grid">
      <label>未处理报警<select id="hd-alert">${open.map((a) => `<option value="${a.id}">${esc(a.dateISO)} ${esc(vehicleById.get(a.vehicleId)?.plate ?? '?')} ${esc(ALERT_TYPES[a.type] ?? a.type)}</option>`).join('')}</select></label>
      <label>处理日期<input type="date" id="hd-date" value="${today}" /></label>
      <label>处理动作<input id="hd-action" placeholder="如：电话提醒强制休息 20 分钟" /></label>
      <label>处理人<input id="hd-handler" placeholder="如：老王/安全管理员" /></label>
    </div>
    <button class="btn" data-action="handle-alert">闭环归档</button>
    <p class="fine">闭环日期不得早于报警日；闭环后的记录与处理情况按办法要求至少保存 3 年。</p>`
    : '<p class="fine" style="margin-top:8px">没有未处理报警——每月生成一次动态监控小结（报表页）即可。</p>'}
    ${allAlerts.length ? `<table class="plain" style="margin-top:10px">
      <tr><th>日期</th><th>车辆</th><th>类型</th><th>内容</th><th>状态</th></tr>
      ${allAlerts.map((a) => {
      const statusCell = a.handledISO
        ? `<span class="pill ok">已闭环</span><div class="basis">${esc(a.handledISO)}${a.action ? ` · ${esc(a.action)}` : ''}</div>`
        : `<span class="pill bad">未处理</span>${daysBetween(a.dateISO, today) >= alertDays ? '<div class="basis">⚠ 挂账超线</div>' : ''}`;
      return `<tr>
        <td class="fine">${esc(a.dateISO)}</td><td><strong>${esc(vehicleById.get(a.vehicleId)?.plate ?? '?')}</strong></td>
        <td>${esc(ALERT_TYPES[a.type] ?? a.type)}</td>
        <td class="fine">${esc(a.detail || '—')}${a.driverId && driverById.get(a.driverId) ? `<div class="basis">驾驶员：${esc(driverById.get(a.driverId).name)}</div>` : ''}</td>
        <td>${statusCell}</td>
      </tr>`;
    }).join('')}
    </table>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// 报表（动态监控月度小结 + 迎检一页纸 + 一车一档打印）
// ---------------------------------------------------------------------------

export function viewReports(state, dynMonth, dynCache = null) {
  if (!state.vehicles?.length) return viewOnboarding();
  const today = todayISO();
  const month = dynMonth ?? monthKey(today);
  const vehicleOptions = state.vehicles.map((v) => `<option value="${v.id}">${esc(v.plate)}</option>`).join('');
  let preview = '';
  try {
    preview = monthlyDynSummary(state, month).text;
  } catch { preview = ''; }
  return `
  <h2 class="sec">📡 动态监控月度小结（台账底稿）</h2>
  <div class="card">
    <div class="row">
      <label>月份 <input type="month" id="dyn-month" value="${month}" /></label>
      <button class="btn small" data-action="dyn-apply">生成</button>
    </div>
    <pre class="preview">${esc(dynCache ?? preview)}</pre>
    <div class="row">
      <button class="btn" data-action="dyn-copy">📋 复制文本（发安全员/存档群）</button>
    </div>
    <p class="fine">按月汇总报警分型、处理率与未处理点名；处理率低于 90% 属法定罚则情形（办法第 35 条），小结文本自带口径与日期。</p>
  </div>

  <h2 class="sec">📑 迎检一页纸（路检/审验拿出即用）</h2>
  <div class="card">
    <div class="row">
      <button class="btn" data-action="inspect-download">⬇️ 下载打印版 HTML</button>
      <button class="btn ghost" data-action="inspect-print">🖨️ 直接打印</button>
    </div>
    <p class="fine">单文件、内联样式、含签字栏：证照钟全景 + 一车一档速览 + 动态监控台账 + 驾驶员台账。打印前先到「车辆」页把证照到期日补齐。</p>
  </div>

  <h2 class="sec">🖨️ 一车一档打印（卖车/审验随车带走）</h2>
  <div class="card">
    <div class="row">
      <label>车辆 <select id="arch-vehicle">${vehicleOptions}</select></label>
      <button class="btn" data-action="arch-print">🖨️ 打印该车技术档案</button>
    </div>
    <p class="fine">档案内容对照部令第 15 条清单生成；车辆转移所有权或车籍地时，档案随车移交——打印一份放进驾驶室副页。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置（车队 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const fleet = state.fleet ?? {};
  return `
  <h2 class="sec">🏭 车队 / 货运部</h2>
  <div class="card">
    <div class="form-grid">
      <label>名称<input id="fleet-name" value="${esc(fleet.name ?? '')}" placeholder="如：小满货运部（印在迎检材料上）" /></label>
      <label>联系电话<input id="fleet-phone" value="${esc(fleet.phone ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-fleet">保存</button>
  </div>

  <h2 class="sec">🔔 预警参数（法定周期的本地提醒口径）</h2>
  <div class="card">
    <div class="row">
      <label>证照预警窗（提前）<input type="number" id="set-warn" min="7" max="180" value="${state.settings?.warnDays ?? 60}" style="width:70px" /> 天</label>
      <label>报警挂账催办线<input type="number" id="set-alert" min="1" max="90" value="${state.settings?.alertDays ?? 7}" style="width:60px" /> 天</label>
    </div>
    <button class="btn small" data-action="save-settings">保存参数</button>
    <p class="fine">法定周期（年审 1 年、检验检测 12/6 个月、从业资格证 6 年）不在可改之列——能改的只是「提前几天提醒你」。属地与证件永远赢。</p>
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
