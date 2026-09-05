/**
 * app.js — 视图与交互层（零依赖，无框架）
 *
 * 页签：排班 / 电梯 / 落单 / 台账 / 应急 / 月账 / 体检 / 设置
 * 所有写操作走 core.js 的纯函数 + store.js 持久化；出证走 ui.js 三通道。
 */
import * as C from './core.js';
import { loadState, saveState } from './store.js';
import { badge, toast, download, printHtml, onClick } from './ui.js';

let state = loadState();
let view = 'dash';
let recordDraft = null; // 落单页草稿 {elevatorId, kind, dateISO}

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');

const TABS = [
  ['dash', '排班'], ['elevators', '电梯'], ['record', '落单'], ['ledger', '台账'],
  ['incident', '应急'], ['money', '月账'], ['check', '体检'], ['settings', '设置'],
];

function persist(mutator) {
  state = mutator(state);
  state = C.logEvent(state, `ui:${view}`, {}, C.todayISO());
  saveState(state);
  render();
}

const nameOfElev = (id) => { const e = state.elevators.find((x) => x.id === id); return e ? e.name : id; };
const elevOf = (id) => state.elevators.find((x) => x.id === id);
const workerOf = (id) => state.workers.find((x) => x.id === id);
const esc = C.escapeHtml;
const today = () => C.todayISO();

// ---------------------------------------------------------------------------
// 渲染骨架
// ---------------------------------------------------------------------------

function renderNav() {
  if ($nav.dataset.built !== '1') {
    $nav.innerHTML = TABS.map(([k, label]) =>
      `<button data-act="tab" data-tab="${k}">${label}</button>`).join('');
    $nav.dataset.built = '1';
  }
  for (const btn of $nav.children) btn.classList.toggle('active', btn.dataset.tab === view);
}

function render() {
  renderNav();
  $view.innerHTML = '';
  $view.appendChild(VIEWS[view]());
}

// ---------------------------------------------------------------------------
// 排班（今日看板）
// ---------------------------------------------------------------------------

function vDash() {
  const now = today();
  const q = C.queue(state.elevators, state.jobs, state.settings.cycles, now, state.settings.warnDays);
  const reds = q.filter((r) => r.schedule.worst === 'red');
  const yellows = q.filter((r) => r.schedule.worst === 'yellow');
  const pend = C.pendingConfirm(state);
  const account = C.monthlyAccount(state, C.monthKey(now));
  const rescues = state.incidents.filter((i) => ['open', 'open_over', 'arrived_open'].includes(C.clockOf(i, state.settings).status));

  const box = document.createElement('div');
  box.innerHTML = `
    <div class="kpi">
      <div class="cell"><div class="num ${reds.length ? 'red' : 'green'}">${reds.length}</div><div class="lbl">保养逾期台数</div></div>
      <div class="cell"><div class="num ${yellows.length ? 'yellow' : 'green'}">${yellows.length}</div><div class="lbl">7 日内到期</div></div>
      <div class="cell"><div class="num ${pend.length ? 'red' : 'green'}">${pend.length}</div><div class="lbl">维保单待签字</div></div>
      <div class="cell"><div class="num ${rescues.length ? 'red' : 'green'}">${rescues.length}</div><div class="lbl">应急未闭环</div></div>
      <div class="cell"><div class="num ${account.owed ? 'yellow' : 'green'}">${account.owed}</div><div class="lbl">本月维保费欠收（元）</div></div>
    </div>`;

  if (!state.elevators.length) {
    box.innerHTML += `<div class="card"><h2>第一次使用</h2>
      <p class="hint">1. 到「设置」填写维保单位名称与 24h 值班电话、添加维保人员；2. 到「电梯」录入在保电梯（使用单位、设备代码、品种、接管日）；3. 回到本页，四周期排班自动滚动——到期红灯先做，落单 30 秒。</p>
      <p class="hint">周期口径：半月/季度/半年/年度四类保养（TSG T5002-2017 第六条），深层保养自动覆盖浅层欠账；排班默认按接管日起算，做完第一单即进入滚动。</p></div>`;
    return box;
  }

  const groups = {};
  for (const r of q) (groups[r.elevator.site] ||= []).push(r);

  const rowsHtml = Object.entries(groups).map(([site, rows]) => `
    <div class="site-group"><h3>${esc(site)} <span class="hint">${rows.length} 台在保</span></h3>
    <table><thead><tr><th>电梯</th><th>半月保</th><th>季度保</th><th>半年保</th><th>年度保</th><th>建议本次</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td><b>${esc(r.elevator.name)}</b><br><span class="hint">${esc(r.elevator.code)}</span></td>
        <td>${badge(r.schedule.kinds.half.status)}<br><span class="hint">${r.schedule.kinds.half.due}</span></td>
        <td>${badge(r.schedule.kinds.quarter.status)}<br><span class="hint">${r.schedule.kinds.quarter.due}</span></td>
        <td>${badge(r.schedule.kinds.halfyear.status)}<br><span class="hint">${r.schedule.kinds.halfyear.due}</span></td>
        <td>${badge(r.schedule.kinds.yearly.status)}<br><span class="hint">${r.schedule.kinds.yearly.due}</span></td>
        <td><span class="badge gray">${C.JOB_KINDS[r.suggest].short}</span></td>
        <td><button class="act small" data-act="go-record" data-elevator="${r.elevator.id}" data-kind="${r.suggest}">去落单</button></td>
      </tr>`).join('')}</tbody></table></div>`).join('');

  box.innerHTML += `<div class="card"><h2>四周期排班 <span class="hint">红=已逾期 · 黄=7 日内到期 · 深层保养覆盖浅层</span></h2>${rowsHtml}</div>`;
  return box;
}

// ---------------------------------------------------------------------------
// 电梯档案
// ---------------------------------------------------------------------------

function vElevators() {
  const box = document.createElement('div');
  box.innerHTML = `
  <div class="card"><h2>新增电梯</h2>
    <form class="form" id="f-elev">
      <div class="inline">
        <div class="frow"><label>使用单位 *</label><input name="site" required placeholder="XX物业/XX商场"></div>
        <div class="frow"><label>电梯内编号 *</label><input name="name" required placeholder="1号楼客梯"></div>
        <div class="frow"><label>设备代码 *</label><input name="code" required placeholder="注册代码尾段即可"></div>
        <div class="frow"><label>品种 *</label><select name="kind">${Object.entries(C.ELEV_KINDS).map(([k, v]) => `<option value="${k}">${v.label}（附件${v.annex}）</option>`).join('')}</select></div>
        <div class="frow"><label>层/站</label><input name="fs" placeholder="11/11"></div>
        <div class="frow"><label>接管日（周期起算）*</label><input name="startISO" type="date" required value="${today()}"></div>
        <div class="frow"><label>下次定期检验</label><input name="nextInspectionISO" type="date"></div>
        <div class="frow"><label>月维保费（元）</label><input name="monthlyFee" type="number" min="0" step="1" placeholder="1200"></div>
      </div>
      <div><button class="act" type="submit">建档</button></div>
    </form>
  </div>
  <div class="card"><h2>在保电梯 <span class="hint">${state.elevators.length} 台</span></h2>
    ${state.elevators.length ? `<table><thead><tr><th>使用单位</th><th>电梯</th><th>品种</th><th>接管日</th><th>下次检验</th><th>月费</th><th></th></tr></thead><tbody>
      ${state.elevators.map((e) => `
        <tr>
          <td>${esc(e.site)}</td><td><b>${esc(e.name)}</b> <span class="hint">${esc(e.code)}</span></td>
          <td>${C.ELEV_KINDS[e.kind].label}</td><td>${esc(e.startISO || '—')}</td>
          <td>${esc(e.nextInspectionISO || '未填')}${e.nextInspectionISO ? ` ${badge(C.statusOf(e.nextInspectionISO, today(), state.settings.inspectionWarnDays))}` : ''}</td>
          <td>${e.monthlyFee || 0}</td>
          <td class="row-actions">
            <button class="act small ghost" data-act="elev-toggle" data-id="${e.id}">${e.active === false ? '恢复在保' : '停保'}</button>
            <button class="act small danger" data-act="elev-del" data-id="${e.id}">删除</button>
          </td>
        </tr>`).join('')}
    </tbody></table>` : '<p class="empty">还没有电梯档案——建档后排班自动开始滚动。</p>'}
  </div>`;

  box.querySelector('#f-elev').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const elev = C.assertElevator({
        id: `e_${Date.now()}`,
        site: f.get('site').trim(), name: f.get('name').trim(), code: f.get('code').trim(),
        kind: f.get('kind'), floorsStations: f.get('fs').trim(),
        startISO: f.get('startISO'),
        nextInspectionISO: f.get('nextInspectionISO') || null,
        monthlyFee: f.get('monthlyFee') ? parseInt(f.get('monthlyFee'), 10) : 0,
        active: true,
      });
      persist((s) => ({ ...s, elevators: [...s.elevators, elev] }));
      toast(`已建档：${elev.name}`);
    } catch (err) { toast(err.message, true); }
  });
  return box;
}

// ---------------------------------------------------------------------------
// 落单
// ---------------------------------------------------------------------------

function vRecord() {
  const box = document.createElement('div');
  if (!state.elevators.length || !state.workers.length) {
    box.innerHTML = '<div class="card"><h2>落单</h2><p class="warn-note">落单前需要：至少 1 台在保电梯（电梯页）+ 至少 1 名维保人员（设置页）。</p></div>';
    return box;
  }
  if (!recordDraft) {
    recordDraft = { elevatorId: state.elevators.find((e) => e.active !== false).id, kind: 'half', dateISO: today() };
  }
  const d = recordDraft;
  const elev = elevOf(d.elevatorId);
  const sched = C.scheduleFor(elev, state.jobs, state.settings.cycles, today());
  const suggest = C.suggestKind(sched);
  if (!d.kind) d.kind = suggest;
  const items = C.itemsFor(elev.kind, d.kind);
  const backfill = d.dateISO < today();

  box.innerHTML = `
  <div class="card"><h2>落单 <span class="hint">选电梯 → 确认类别 → 逐项过一遍 → 提交；异常必须写处置说明</span></h2>
    <form class="form" id="f-job">
      <div class="inline">
        <div class="frow"><label>电梯 *</label>
          <select name="elevatorId">${state.elevators.filter((e) => e.active !== false).map((e) => `<option value="${e.id}" ${e.id === d.elevatorId ? 'selected' : ''}>${esc(e.site)} · ${esc(e.name)}（${esc(e.code)}）</option>`).join('')}</select></div>
        <div class="frow"><label>保养类别 *（建议：<b>${C.JOB_KINDS[suggest].short}</b>）</label>
          <select name="kind">${Object.entries(C.JOB_KINDS).filter(([k]) => k !== 'selfcheck').map(([k, v]) => `<option value="${k}" ${k === d.kind ? 'selected' : ''}>${v.label}</option>`).join('')}
            <option value="selfcheck" ${d.kind === 'selfcheck' ? 'selected' : ''}>年度自行检查（检验前做，需检查/审核人）</option></select></div>
        <div class="frow"><label>维保日期 *</label><input name="dateISO" type="date" required value="${d.dateISO}"></div>
        <div class="frow"><label>维保人员 *</label>
          <select name="workerId">${state.workers.map((w) => `<option value="${w.id}">${esc(w.name)}${w.certNo ? `（${esc(w.certNo)}）` : ''}${w.certValidUntil && w.certValidUntil < today() ? ' ⚠证已过期' : ''}</option>`).join('')}</select></div>
      </div>
      ${backfill ? '<div class="warn-note">补录提醒：维保日期早于今天。单子会如实打上「补录」标记——工具不把补录伪装成当日记录。</div>' : ''}
      <div class="frow"><label>保养项目（${C.ELEV_KINDS[elev.kind].label} · ${C.JOB_KINDS[d.kind].label} 应做 ${items.length} 项，据 TSG T5002-2017 附件预填，未勾选=正常，勾选=异常）</label>
        <div class="checklist" id="items">
          ${items.map((it, i) => `
            <div class="item" data-i="${i}">
              <input type="checkbox" id="ck${i}" data-i="${i}">
              <label for="ck${i}" style="flex:1;font-size:13px;color:var(--ink)">${esc(it.label)}</label>
              <input type="text" data-note="${i}" placeholder="异常处置说明（勾选异常后必填）" style="display:none">
            </div>`).join('')}
        </div></div>
      <div class="frow" id="selfcheck-row" style="display:${d.kind === 'selfcheck' ? 'grid' : 'none'}">
        <div class="inline">
          <div class="frow"><label>检查人 *</label><input name="checker" placeholder="自行检查人员"></div>
          <div class="frow"><label>审核人 *</label><input name="reviewer" placeholder="质量检验(查)人员"></div>
        </div>
      </div>
      <div class="frow"><label>备注</label><input name="note" placeholder="更换配件、天气、物业配合情况等（选填）"></div>
      <div><button class="act" type="submit">提交落单</button> <span class="hint">提交后进入台账，需使用单位安全管理人员签字确认</span></div>
    </form>
  </div>`;

  const form = box.querySelector('#f-job');
  form.querySelector('[name=elevatorId]').addEventListener('change', (e) => { recordDraft = { elevatorId: e.target.value, kind: null, dateISO: d.dateISO }; render(); });
  form.querySelector('[name=kind]').addEventListener('change', (e) => { recordDraft = { ...d, kind: e.target.value }; render(); });
  form.querySelector('[name=dateISO]').addEventListener('change', (e) => { recordDraft = { ...d, dateISO: e.target.value }; render(); });

  box.querySelector('#items').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const i = e.target.dataset.i;
    const item = box.querySelector(`#items .item[data-i="${i}"]`);
    const note = item.querySelector('input[type=text]');
    note.style.display = e.target.checked ? 'block' : 'none';
    item.classList.toggle('bad', e.target.checked);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const jobItems = items.map((it, i) => ({
      ...it,
      ok: !form.querySelector(`#ck${i}`).checked,
      note: form.querySelector(`[data-note="${i}"]`).value.trim(),
    }));
    try {
      const job = {
        id: `j_${Date.now()}`,
        elevatorId: f.get('elevatorId'),
        kind: f.get('kind'),
        dateISO: f.get('dateISO'),
        workerId: f.get('workerId'),
        items: jobItems,
        note: (f.get('note') || '').trim(),
        checker: (f.get('checker') || '').trim(),
        reviewer: (f.get('reviewer') || '').trim(),
      };
      C.assertJob(job, state, today());
      persist((s) => C.registerJob(s, job, today()));
      recordDraft = { elevatorId: job.elevatorId, kind: null, dateISO: today() };
      toast('已落单，记得让使用单位签字确认');
      view = 'ledger';
      render();
    } catch (err) { toast(err.message, true); }
  });
  return box;
}

// ---------------------------------------------------------------------------
// 台账（维保记录 + 签字确认）
// ---------------------------------------------------------------------------

function vLedger() {
  const box = document.createElement('div');
  const jobs = [...state.jobs].sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  const pend = C.pendingConfirm(state);

  box.innerHTML = `
  ${pend.length ? `<div class="card"><h2>待签字确认 <span class="hint">${pend.length} 单 · TSG T5002-2017 第七条：维保记录应当经使用单位安全管理人员签字确认</span></h2>
    <table><thead><tr><th>单号</th><th>电梯</th><th>日期</th><th>类别</th><th>操作</th></tr></thead><tbody>
    ${pend.slice(0, 10).map((j) => `<tr><td>${esc(j.no)}${j.backfill ? ' <span class="badge yellow">补录</span>' : ''}</td>
      <td>${esc(nameOfElev(j.elevatorId))}</td><td>${esc(j.dateISO)}</td><td>${C.JOB_KINDS[j.kind].short}</td>
      <td class="row-actions">
        <button class="act small" data-act="confirm" data-id="${j.id}">签字确认</button>
        <button class="act small ghost" data-act="job-text" data-id="${j.id}">微信文本</button>
        <button class="act small ghost" data-act="job-html" data-id="${j.id}">打印单</button>
      </td></tr>`).join('')}
    </tbody></table></div>` : ''}

  <div class="card"><h2>维保记录台账 <span class="hint">${jobs.length} 单 · 依据 T5002 第五条(六)应归档保存不少于 4 年</span>
    <div class="row-actions" style="float:right">
      <button class="act small ghost" data-act="pack-html">迎检打印包（按使用单位）</button>
    </div></h2>
    ${jobs.length ? `<table><thead><tr><th>单号</th><th>电梯</th><th>日期</th><th>类别</th><th>人员</th><th>项目</th><th>签字确认</th><th>操作</th></tr></thead><tbody>
      ${jobs.map((j) => {
        const abns = j.items.filter((i) => i.ok === false);
        const e = elevOf(j.elevatorId);
        return `<tr>
        <td>${esc(j.no)}${j.backfill ? ' <span class="badge yellow">补录</span>' : ''}</td>
        <td>${e ? `${esc(e.site)} · ${esc(e.name)}` : esc(j.elevatorId)}</td>
        <td>${esc(j.dateISO)}</td>
        <td>${C.JOB_KINDS[j.kind].short}${j.kind === 'selfcheck' ? `<br><span class="hint">${esc(j.checker)}/${esc(j.reviewer)}</span>` : ''}</td>
        <td>${esc(workerOf(j.workerId)?.name || j.workerId)}</td>
        <td>${j.items.length} 项${abns.length ? ` <span class="badge red">异常 ${abns.length}</span>` : ''}</td>
        <td>${j.confirmedBy ? `<span class="badge green">${esc(j.confirmedBy)} ${esc(j.confirmedISO)}</span>` : '<span class="badge red">待签字</span>'}</td>
        <td class="row-actions">
          ${!j.confirmedBy ? `<button class="act small" data-act="confirm" data-id="${j.id}">签字确认</button>` : ''}
          <button class="act small ghost" data-act="job-text" data-id="${j.id}">文本</button>
          <button class="act small ghost" data-act="job-html" data-id="${j.id}">打印</button>
          ${!j.confirmedBy ? `<button class="act small danger" data-act="job-del" data-id="${j.id}">撤销</button>` : ''}
        </td></tr>`;
      }).join('')}
    </tbody></table>` : '<p class="empty">还没有维保记录——去「落单」提交第一单。</p>'}
  </div>`;
  return box;
}

// ---------------------------------------------------------------------------
// 应急（救援时钟 + 演练）
// ---------------------------------------------------------------------------

function vIncident() {
  const now = { dateISO: today(), time: new Date().toTimeString().slice(0, 5) };
  const box = document.createElement('div');
  const rows = [...state.incidents].sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
  const drillList = C.drillRows(state, today());

  box.innerHTML = `
  <div class="card"><h2>登记故障 / 困人接报 <span class="hint">T5002 第五条(四)：24h 值班电话 · 困人到场时限 ${state.settings.areaType === 'city' ? state.settings.rescueCityMin : state.settings.rescueOtherMin} 分钟（可在设置改口径）</span></h2>
    <form class="form" id="f-inc">
      <div class="inline">
        <div class="frow"><label>电梯 *</label><select name="elevatorId">${state.elevators.filter((e) => e.active !== false).map((e) => `<option value="${e.id}">${esc(e.site)} · ${esc(e.name)}</option>`).join('')}</select></div>
        <div class="frow"><label>类别 *</label><select name="kind"><option value="trapped">困人</option><option value="fault">故障停梯</option></select></div>
        <div class="frow"><label>接报日期 *</label><input name="reportDate" type="date" required value="${today()}"></div>
        <div class="frow"><label>接报时刻 *</label><input name="reportTime" type="time" required value="${new Date().toTimeString().slice(0, 5)}"></div>
      </div>
      <div><button class="act" type="submit">开始计时</button></div>
    </form>
  </div>
  <div class="card"><h2>应急记录 <span class="hint">处置中的单一直计时点名；到场超时限如实保留（不可洗账）</span></h2>
    ${rows.length ? `<table><thead><tr><th>电梯</th><th>类别</th><th>接报</th><th>到场</th><th>闭环</th><th>接报到场</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${rows.map((i) => {
        const c = C.clockOf(i, state.settings, now);
        const stMap = {
          open: '<span class="badge yellow">处置中</span>', open_over: '<span class="badge red">处置中·已超时限</span>',
          arrived_open: '<span class="badge yellow">已到场·处置中</span>',
          closed_ok: '<span class="badge green">已闭环</span>', closed_over: '<span class="badge red">已闭环·到场超时限</span>',
        };
        return `<tr>
        <td>${esc(nameOfElev(i.elevatorId))}</td><td>${i.kind === 'trapped' ? '困人' : '故障'}</td>
        <td>${esc(i.reportDate)} ${esc(i.reportTime)}</td>
        <td>${i.arriveDate ? `${esc(i.arriveDate)} ${esc(i.arriveTime)}` : '—'}</td>
        <td>${i.fixedDate ? `${esc(i.fixedDate)} ${esc(i.fixedTime)}` : '—'}</td>
        <td>${c.minutes !== null ? `${c.minutes} 分 / 限 ${c.limit}` : '—'}</td>
        <td>${stMap[c.status]}</td>
        <td class="row-actions">
          ${!i.arriveDate ? `<button class="act small" data-act="inc-arrive" data-id="${i.id}">登记到场</button>` : ''}
          ${i.arriveDate && !i.fixedDate ? `<button class="act small" data-act="inc-fix" data-id="${i.id}">登记闭环</button>` : ''}
        </td></tr>`;
      }).join('')}
    </tbody></table>` : '<p class="empty">暂无应急记录。</p>'}
  </div>
  <div class="card"><h2>应急演练 <span class="hint">T5002 第五条(三)：每半年至少按电梯类别各一次</span></h2>
    ${drillList.length ? `<table><thead><tr><th>电梯类别</th><th>最近演练</th><th>下次到期</th><th>状态</th></tr></thead><tbody>
      ${drillList.map((r) => `<tr><td>${C.ELEV_KINDS[r.kind].label}</td><td>${r.last || '从未演练'}</td><td>${r.due || '—'}</td><td>${r.last === null ? '<span class="badge red">缺演练</span>' : badge(r.status)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="empty">先到「电梯」建档，这里按品种点名演练。</p>'}
    <form class="form" id="f-drill">
      <div class="inline">
        <div class="frow"><label>演练类别 *</label><select name="kind">${Object.entries(C.ELEV_KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
        <div class="frow"><label>演练日期 *</label><input name="dateISO" type="date" required value="${today()}"></div>
        <div class="frow"><label>记录/备注</label><input name="note" placeholder="参加人员、科目"></div>
      </div>
      <div><button class="act" type="submit">登记演练</button></div>
    </form>
  </div>`;

  box.querySelector('#f-inc').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const inc = C.assertIncident({
        id: `i_${Date.now()}`, elevatorId: f.get('elevatorId'), kind: f.get('kind'),
        reportDate: f.get('reportDate'), reportTime: f.get('reportTime'),
        arriveDate: null, arriveTime: null, fixedDate: null, fixedTime: null, note: '',
      });
      persist((s) => ({ ...s, incidents: [...s.incidents, inc] }));
      toast('已接报，救援时钟开始计时');
    } catch (err) { toast(err.message, true); }
  });

  box.querySelector('#f-drill').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    persist((s) => ({ ...s, drills: [...s.drills, { id: `d_${Date.now()}`, kind: f.get('kind'), dateISO: f.get('dateISO'), note: (f.get('note') || '').trim() }] }));
    toast('已登记演练');
  });
  return box;
}

// ---------------------------------------------------------------------------
// 月账
// ---------------------------------------------------------------------------

function vMoney() {
  const box = document.createElement('div');
  const month = C.monthKey(today());
  const acc = C.monthlyAccount(state, month);

  box.innerHTML = `
  <div class="card"><h2>${month} 维保费月账 <span class="hint">按在保电梯月费全额计收，部分收款如实相抵——记录就是讨债的底气</span></h2>
    <div class="kpi">
      <div class="cell"><div class="num">${acc.activeCount}</div><div class="lbl">在保台数</div></div>
      <div class="cell"><div class="num">${acc.billed}</div><div class="lbl">应收（元）</div></div>
      <div class="cell"><div class="num green">${acc.paid}</div><div class="lbl">已收（元）</div></div>
      <div class="cell"><div class="num ${acc.owed ? 'red' : 'green'}">${acc.owed}</div><div class="lbl">欠收（元）</div></div>
      <div class="cell"><div class="num">${acc.jobCount}</div><div class="lbl">本月落单数</div></div>
      <div class="cell"><div class="num ${acc.confirmRate !== null && acc.confirmRate < 100 ? 'yellow' : 'green'}">${acc.confirmRate === null ? '—' : `${acc.confirmRate}%`}</div><div class="lbl">签字确认率</div></div>
    </div>
    ${acc.oweRows.length ? `<table><thead><tr><th>使用单位</th><th>电梯</th><th>月费</th><th>已收</th><th>欠收</th></tr></thead><tbody>
      ${acc.oweRows.map((r) => `<tr><td>${esc(r.elevator.site)}</td><td>${esc(r.elevator.name)}</td><td>${r.fee}</td><td>${r.paid}</td><td><b>${r.owed}</b></td></tr>`).join('')}
    </tbody></table>` : '<p class="empty">本月无欠收。</p>'}
  </div>
  <div class="card"><h2>登记收款</h2>
    <form class="form" id="f-pay">
      <div class="inline">
        <div class="frow"><label>电梯 *</label><select name="elevatorId">${state.elevators.filter((e) => e.active !== false).map((e) => `<option value="${e.id}">${esc(e.site)} · ${esc(e.name)}</option>`).join('')}</select></div>
        <div class="frow"><label>所属月份 *</label><input name="month" value="${month}" pattern="\\d{4}-\\d{2}" required></div>
        <div class="frow"><label>金额（元）*</label><input name="amount" type="number" min="1" step="1" required></div>
        <div class="frow"><label>到账日期 *</label><input name="paidISO" type="date" required value="${today()}"></div>
      </div>
      <div><button class="act" type="submit">登记</button></div>
    </form>
  </div>`;

  box.querySelector('#f-pay').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      persist((s) => C.recordPayment(s, {
        elevatorId: f.get('elevatorId'), month: f.get('month').trim(),
        amount: parseInt(f.get('amount'), 10), paidISO: f.get('paidISO'),
      }));
      toast('已登记收款');
    } catch (err) { toast(err.message, true); }
  });
  return box;
}

// ---------------------------------------------------------------------------
// 体检
// ---------------------------------------------------------------------------

function vCheck() {
  const box = document.createElement('div');
  const check = C.selfCheck(state);
  const cls = check.score >= 90 ? 'good' : check.score >= 60 ? 'mid' : 'bad';

  box.innerHTML = `
  <div class="card"><h2>合规体检 <span class="hint">六项合规 + 一项经营，检查前先自查</span></h2>
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <div class="score ${cls}">${check.score}<span style="font-size:16px;color:var(--muted)">/100</span></div>
      <div style="flex:1;min-width:200px">
        <div class="hint">红灯项 ${check.redCount} · 黄灯项 ${check.yellowCount}</div>
        <div class="bar"><i style="width:${check.score}%"></i></div>
      </div>
      <div class="row-actions">
        <button class="act ghost" data-act="check-text">体检文本（微信转发）</button>
      </div>
    </div>
  </div>
  <div class="card">${check.items.map((it) => `
    <div style="margin-bottom:14px">
      <h2 style="margin:0">${{ red: '<span class="badge red">红灯</span>', yellow: '<span class="badge yellow">黄灯</span>', green: '<span class="badge green">正常</span>' }[it.level]} ${esc(it.label)} <span class="hint">${it.count} 项</span></h2>
      ${it.offenders.length ? `<div class="${it.level === 'red' ? 'danger-note' : 'warn-note'}">${it.offenders.map(esc).join('；')}</div>` : ''}
    </div>`).join('')}
  </div>`;

  const textBtn = box.querySelector('[data-act=check-text]');
  textBtn.addEventListener('click', () => {
    const lines = [`【梯保单体检】${today()} 得分 ${check.score}/100`];
    for (const it of check.items) lines.push(`${it.level === 'red' ? '🔴' : it.level === 'yellow' ? '🟡' : '🟢'} ${it.label}：${it.count}`);
    download(`体检-${today()}.txt`, lines.join('\n'), 'text/plain');
  });
  return box;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

function vSettings() {
  const box = document.createElement('div');
  const s = state.settings;
  box.innerHTML = `
  <div class="card"><h2>维保单位</h2>
    <form class="form" id="f-co">
      <div class="inline">
        <div class="frow"><label>单位名称</label><input name="name" value="${esc(state.company.name)}" placeholder="XX电梯工程有限公司"></div>
        <div class="frow"><label>24h 值班电话（T5002 第五条(四)）</label><input name="phone" value="${esc(state.company.phone)}" placeholder="138XXXXXXXX"></div>
      </div>
      <div><button class="act" type="submit">保存</button></div>
    </form>
  </div>
  <div class="card"><h2>维保人员 <span class="hint">特种设备作业人员证（T5002 第五条(八)：持证上岗）</span></h2>
    <form class="form" id="f-worker">
      <div class="inline">
        <div class="frow"><label>姓名 *</label><input name="name" required></div>
        <div class="frow"><label>证号</label><input name="certNo" placeholder="T 证编号"></div>
        <div class="frow"><label>证件有效期至</label><input name="certValidUntil" type="date"></div>
      </div>
      <div><button class="act" type="submit">添加</button></div>
    </form>
    ${state.workers.length ? `<table><thead><tr><th>姓名</th><th>证号</th><th>有效期至</th><th>状态</th><th></th></tr></thead><tbody>
      ${C.certRows(state, today()).map((r) => `<tr><td>${esc(r.worker.name)}</td><td>${esc(r.worker.certNo || '—')}</td><td>${esc(r.worker.certValidUntil || '未填')}</td>
      <td>${r.status === 'red' ? '<span class="badge red">已过期</span>' : r.status === 'yellow' ? `<span class="badge yellow">${r.days} 天</span>` : r.status === 'green' ? '<span class="badge green">有效</span>' : '<span class="badge gray">未填</span>'}</td>
      <td><button class="act small danger" data-act="worker-del" data-id="${r.worker.id}">删除</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="empty">还没有维保人员。</p>'}
  </div>
  <div class="card"><h2>口径参数 <span class="hint">预填为通识口径——TSG T5002-2017 原文与属地要求永远赢</span></h2>
    <form class="form" id="f-set">
      <div class="inline">
        <div class="frow"><label>地区口径</label><select name="areaType"><option value="city" ${s.areaType === 'city' ? 'selected' : ''}>直辖市/设区的市（到场 ≤ ${s.rescueCityMin} 分钟）</option><option value="other" ${s.areaType === 'other' ? 'selected' : ''}>其他地区（一般 ≤ ${s.rescueOtherMin} 分钟）</option></select></div>
        <div class="frow"><label>半月保周期（天）</label><input name="half" type="number" min="1" value="${s.cycles.half}"></div>
        <div class="frow"><label>季度保周期（天）</label><input name="quarter" type="number" min="1" value="${s.cycles.quarter}"></div>
        <div class="frow"><label>半年保周期（天）</label><input name="halfyear" type="number" min="1" value="${s.cycles.halfyear}"></div>
        <div class="frow"><label>年度保周期（天）</label><input name="yearly" type="number" min="1" value="${s.cycles.yearly}"></div>
        <div class="frow"><label>排班临期黄线（天）</label><input name="warnDays" type="number" min="1" value="${s.warnDays}"></div>
        <div class="frow"><label>检验临期黄线（天）</label><input name="inspectionWarnDays" type="number" min="1" value="${s.inspectionWarnDays}"></div>
        <div class="frow"><label>证件临期黄线（天）</label><input name="certWarnDays" type="number" min="1" value="${s.certWarnDays}"></div>
        <div class="frow"><label>演练周期（天）</label><input name="drillIntervalDays" type="number" min="1" value="${s.drillIntervalDays}"></div>
        <div class="frow"><label>自行检查提前窗口（天）</label><input name="selfcheckLeadDays" type="number" min="1" value="${s.selfcheckLeadDays}"></div>
      </div>
      <div><button class="act" type="submit">保存参数</button></div>
    </form>
  </div>
  <div class="card"><h2>数据备份</h2>
    <p class="hint">数据仅存于本机浏览器。换设备/清缓存前请先导出。导出文件为明文 JSON，请妥善保管。</p>
    <div class="row-actions">
      <button class="act" data-act="export">导出备份（JSON）</button>
      <label class="act ghost" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">导入备份 <input type="file" id="f-import" accept=".json" style="display:none"></label>
      <button class="act danger" data-act="wipe">清空全部数据</button>
    </div>
  </div>`;

  box.querySelector('#f-co').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    persist((st) => ({ ...st, company: { name: f.get('name').trim(), phone: f.get('phone').trim() } }));
    toast('已保存');
  });
  box.querySelector('#f-worker').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = f.get('name').trim();
    if (!name) { toast('姓名必填', true); return; }
    persist((st) => ({ ...st, workers: [...st.workers, { id: `w_${Date.now()}`, name, certNo: f.get('certNo').trim(), certValidUntil: f.get('certValidUntil') || null }] }));
    toast('已添加');
  });
  box.querySelector('#f-set').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const num = (k, dflt) => { const v = parseInt(f.get(k), 10); return Number.isInteger(v) && v > 0 ? v : dflt; };
    persist((st) => ({
      ...st,
      settings: {
        ...st.settings,
        areaType: f.get('areaType'),
        cycles: { half: num('half', 15), quarter: num('quarter', 92), halfyear: num('halfyear', 183), yearly: num('yearly', 365) },
        warnDays: num('warnDays', 7), inspectionWarnDays: num('inspectionWarnDays', 30),
        certWarnDays: num('certWarnDays', 60), drillIntervalDays: num('drillIntervalDays', 183),
        selfcheckLeadDays: num('selfcheckLeadDays', 45),
      },
    }));
    toast('参数已保存');
  });
  box.querySelector('#f-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = C.importBundle(String(reader.result));
        saveState(state);
        toast('导入成功');
        render();
      } catch (err) { toast(err.message, true); }
    };
    reader.readAsText(file);
  });
  return box;
}

// ---------------------------------------------------------------------------
// 事件委托（跨页动作）
// ---------------------------------------------------------------------------

onClick(document.body, (act, d) => {
  if (act === 'tab') { view = d.tab; render(); return; }
  if (act === 'go-record') { recordDraft = { elevatorId: d.elevator, kind: d.kind, dateISO: today() }; view = 'record'; render(); return; }

  if (act === 'elev-toggle') {
    persist((st) => ({ ...st, elevators: st.elevators.map((e) => (e.id === d.id ? { ...e, active: e.active === false } : e)) }));
    return;
  }
  if (act === 'elev-del') {
    if (!confirm('删除电梯档案？其维保流水将一并失去挂靠对象，请先确认没有未归档记录。')) return;
    persist((st) => ({ ...st, elevators: st.elevators.filter((e) => e.id !== d.id) }));
    return;
  }
  if (act === 'worker-del') {
    persist((st) => ({ ...st, workers: st.workers.filter((w) => w.id !== d.id) }));
    return;
  }

  if (act === 'confirm') {
    const job = state.jobs.find((j) => j.id === d.id);
    if (!job) return;
    const by = prompt('使用单位安全管理人员姓名（签字确认）：');
    if (!by) return;
    const dateISO = prompt('确认日期（YYYY-MM-DD）：', today());
    if (!dateISO) return;
    try {
      persist((st) => C.confirmJob(st, d.id, by, dateISO.trim()));
      toast('已确认——签字链闭环');
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (act === 'job-text') {
    const job = state.jobs.find((j) => j.id === d.id);
    const e = elevOf(job.elevatorId);
    download(`${job.no}-确认单.txt`, C.confirmText(job, e, workerOf(job.workerId), state.company), 'text/plain');
    toast('文本已下载，可直接粘贴到微信');
    return;
  }
  if (act === 'job-html') {
    const job = state.jobs.find((j) => j.id === d.id);
    const e = elevOf(job.elevatorId);
    printHtml(C.confirmHtml(job, e, workerOf(job.workerId), state.company));
    return;
  }
  if (act === 'job-del') {
    if (!confirm('撤销这张维保单？删除即精确回滚，不可恢复。')) return;
    persist((st) => C.removeJob(st, d.id));
    toast('已撤销');
    return;
  }
  if (act === 'pack-html') {
    const site = prompt('按使用单位出迎检包，输入使用单位名称（须与建档一致）：', state.elevators[0]?.site || '');
    if (!site) return;
    if (!state.elevators.some((e) => e.site === site.trim())) { toast('没有该使用单位的电梯档案', true); return; }
    printHtml(C.packHtml(state, site.trim(), today()));
    return;
  }
  if (act === 'inc-arrive') {
    const dateISO = prompt('到场日期（YYYY-MM-DD）：', today());
    if (!dateISO) return;
    const time = prompt('到场时刻（HH:MM）：', new Date().toTimeString().slice(0, 5));
    if (!time) return;
    persist((st) => ({ ...st, incidents: st.incidents.map((i) => (i.id === d.id ? { ...i, arriveDate: dateISO.trim(), arriveTime: time.trim() } : i)) }));
    toast('已登记到场');
    return;
  }
  if (act === 'inc-fix') {
    const dateISO = prompt('处置完成日期（YYYY-MM-DD）：', today());
    if (!dateISO) return;
    const time = prompt('完成时刻（HH:MM）：', new Date().toTimeString().slice(0, 5));
    if (!time) return;
    persist((st) => ({ ...st, incidents: st.incidents.map((i) => (i.id === d.id ? { ...i, fixedDate: dateISO.trim(), fixedTime: time.trim() } : i)) }));
    toast('应急已闭环');
    return;
  }
  if (act === 'export') {
    download(`梯保单备份-${today()}.json`, C.exportBundle(state), 'application/json');
    return;
  }
  if (act === 'wipe') {
    if (!confirm('清空全部数据？此操作不可恢复，请先导出备份。')) return;
    localStorage.removeItem('liftsheet.v1');
    state = loadState();
    render();
    toast('已清空');
  }
});

const VIEWS = {
  dash: vDash, elevators: vElevators, record: vRecord, ledger: vLedger,
  incident: vIncident, money: vMoney, check: vCheck, settings: vSettings,
};

// service worker（本地优先离线可用；http.server 环境下静默失败即可）
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render();
