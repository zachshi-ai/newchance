/**
 * app.js — 岗卫账 PostGuard 主装配：状态、路由、六视图
 * 约定：导航栏构建一次，切换只改 active 类；视图渲染全部落到 #view。
 */
import {
  todayISO, escapeHtml, fmtYuan,
  FACTORS, FACTOR_IDS, GRADES, CONCLUSIONS, RISK_CLASSES, CHANGE_TYPES, DISCLAIMER,
  postCycle, workerState, openActions, detectionClock, declarationClock, trainingClock, ppeClock,
  addPost, removePost, addWorker, removeWorker, addExam, examCostTotal, monthSummary,
  exportBundle, importBundle, selfCertHtml, leavingArchiveHtml,
} from './core.js';
import { loadState, saveState, clearState } from './store.js';
import { esc, badge, clockBadge, daysText, factorTags, yuan } from './ui.js';

const viewEl = document.getElementById('view');
const toastEl = document.getElementById('toast');

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------
const DEFAULT_STATE = {
  posts: [],
  workers: [],
  compliance: {
    riskClass: 'serious',
    lastDetectDate: null,
    lastAssessDate: null,
    changes: [],
    training: { managerDate: null, staffDate: null },
  },
  settings: { orgName: '', warnDays: 90, detectWarnDays: 60, refresherMonths: 12, ppeMonths: 3 },
};

let state = { ...DEFAULT_STATE, ...(loadState() || {}) };
state.compliance = { ...DEFAULT_STATE.compliance, ...(state.compliance || {}) };
state.settings = { ...DEFAULT_STATE.settings, ...(state.settings || {}) };

let current = 'dashboard';

function persist() {
  saveState(state);
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function postById(id) {
  return state.posts.find((p) => p.id === id) || null;
}

// ---------------------------------------------------------------------------
// 路由（导航构建一次，切换只改 active 类）
// ---------------------------------------------------------------------------
const ROUTES = [
  ['dashboard', '📊 看板'],
  ['posts', '🏗️ 岗位'],
  ['workers', '👷 员工'],
  ['compliance', '📋 合规四件套'],
  ['export', '🧾 自证包'],
  ['settings', '⚙️ 设置'],
];

const navEl = document.getElementById('nav');
for (const [key, label] of ROUTES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.route = key;
  btn.textContent = label;
  btn.addEventListener('click', () => go(key));
  navEl.appendChild(btn);
}

function go(route) {
  current = route;
  for (const btn of navEl.children) {
    btn.classList.toggle('active', btn.dataset.route === route);
  }
  render();
}

function render() {
  const R = {
    dashboard: renderDashboard,
    posts: renderPosts,
    workers: renderWorkers,
    compliance: renderCompliance,
    export: renderExport,
    settings: renderSettings,
  };
  viewEl.innerHTML = (R[current] || renderDashboard)();
}

// ---------------------------------------------------------------------------
// 视图 1：看板
// ---------------------------------------------------------------------------
function renderDashboard() {
  const today = todayISO();
  const { warnDays } = state.settings;
  const counts = { red: 0, amber: 0, green: 0, none: 0 };
  const redRows = [];
  const todos = [];

  for (const w of state.workers) {
    const p = postById(w.postId);
    const st = workerState(w, p, today, warnDays);
    if (counts[st.level] !== undefined) counts[st.level] += 1;
    if (st.level === 'red') {
      const why = st.kind === 'pre' ? st.pre.msg : st.kind === 'leave' ? st.leave.msg : (st.onJob ? st.onJob.msg : '');
      redRows.push(`<tr><td>${esc(w.name)}</td><td>${esc(p ? p.name : '—')}</td><td>${esc(why)}</td></tr>`);
    }
    for (const act of openActions(w)) {
      todos.push(`<li><b>${esc(w.name)}</b>：${esc(act.label)}（${esc(act.date)} 检查）→ ${esc(act.action)}</li>`);
    }
    if (st.leave.state === 'amber') {
      todos.push(`<li><b>${esc(w.name)}</b>：${esc(st.leave.msg)}</li>`);
    }
  }

  const det = detectionClock(state.compliance.riskClass, state.compliance.lastDetectDate, state.compliance.lastAssessDate, today, state.settings.detectWarnDays);
  const dec = (state.compliance.changes || []).filter((c) => !c.declared).map((c) => declarationClock(c, false, today));
  const trs = trainingClock(state.compliance.training, today, state.settings.detectWarnDays, state.settings.refresherMonths);
  const ppeRows = state.posts.filter((p) => p.factors.length > 0).map((p) => ppeClock(p, p.lastPpeDate, today, 15, state.settings.ppeMonths));

  for (const r of [...det, ...dec, ...trs, ...ppeRows]) {
    if (r.state === 'red') todos.push(`<li>${esc(r.name || r.label || r.post)}：${esc(r.msg || '已逾期，请立即处理')}</li>`);
  }

  const ms = monthSummary(state.workers, today);
  const cents = examCostTotal(state.workers);

  return `
  <h2 class="sect">今日钟况 <span class="muted">${today}</span></h2>
  <div class="stats">
    <div class="stat red"><b>${counts.red}</b><span>红线（闸门/逾期）</span></div>
    <div class="stat amber"><b>${counts.amber}</b><span>临期（≤${state.settings.warnDays} 天）</span></div>
    <div class="stat green"><b>${counts.green}</b><span>正常</span></div>
    <div class="stat"><b>${ms.count}</b><span>本月已检（${ms.month}）</span></div>
    <div class="stat"><b>${esc(fmtYuan(cents))}</b><span>累计检查投入（单位承担）</span></div>
  </div>

  <h2 class="sect">🔴 红线名单</h2>
  <div class="card">
    ${redRows.length ? `<div class="table-wrap"><table><thead><tr><th>员工</th><th>岗位</th><th>触线说明</th></tr></thead><tbody>${redRows.join('')}</tbody></table></div>` : '<p class="empty">暂无红线员工 👍</p>'}
    <p class="muted">红线依据：安排未经上岗前检查者接害（第 75 条(七)：5万~30万）；在岗检查逾期（第 71 条(四)：5万~10万）；未检离岗（第 35 条：不得解除/终止合同）。</p>
  </div>

  <h2 class="sect">今日待办</h2>
  <div class="card">
    ${todos.length ? `<ul>${todos.slice(0, 12).join('')}</ul>${todos.length > 12 ? `<p class="muted">…共 ${todos.length} 项，详见各视图</p>` : ''}` : '<p class="empty">没有待办，保持节奏 ✅</p>'}
  </div>`;
}

// ---------------------------------------------------------------------------
// 视图 2：岗位
// ---------------------------------------------------------------------------
function renderPosts() {
  const rows = state.posts.map((p) => {
    const cyc = postCycle(p);
    const ppl = state.workers.filter((w) => w.postId === p.id).length;
    const ppe = ppeClock(p, p.lastPpeDate, todayISO(), 15, state.settings.ppeMonths);
    return `<tr>
      <td><b>${esc(p.name)}</b><br/><span class="muted">${ppl} 人 · 分级：${esc(GRADES[p.grade] || p.grade)}${p.noiseDb ? ` · 噪声 ${p.noiseDb} dB(A)` : ''}</span></td>
      <td>${factorTags(p.factors)}</td>
      <td><span class="muted">${esc(cyc.monitored ? `每 ${cyc.months} 个月` : '无需监护')}</span><br/><span class="muted">${esc(cyc.basis || '')}</span></td>
      <td>${clockBadge(ppe.state, { red: ppe.msg, amber: daysText(ppe.daysLeft), green: daysText(ppe.daysLeft), none: ppe.msg })}<br/>
        <button class="ghost mini" data-act="ppe" data-id="${p.id}">登记发放</button></td>
      <td><button class="ghost mini danger" data-act="del-post" data-id="${p.id}">删除</button></td>
    </tr>`;
  }).join('');

  const factorChecks = FACTOR_IDS.map((f) => `
    <label><input type="checkbox" name="factor" value="${f}"/> ${esc(FACTORS[f].label)}</label>`).join('');

  return `
  <h2 class="sect">岗位与接害因素</h2>
  <div class="card">
    ${rows ? `<div class="table-wrap"><table><thead><tr><th>岗位</th><th>接害因素</th><th>监护周期（GBZ 188—2025 定档）</th><th>防护用品</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">还没有岗位——先登记生产/维修一线的接害岗位</p>'}
  </div>

  <h2 class="sect">新增岗位</h2>
  <div class="card">
    <form id="f-post" class="panel">
      <div class="field"><label>岗位名称 *</label><input name="name" required placeholder="如：电焊岗 / 喷涂岗 / 破碎岗"/></div>
      <div class="field"><label>作业分级（GBZ/T 229，未知则从严）</label>
        <select name="grade">
          <option value="unknown">未分级（从严按 Ⅱ级及以上）</option>
          <option value="I">Ⅰ级及以下（2 年一检）</option>
          <option value="II">Ⅱ级及以上（1 年一检）</option>
        </select></div>
      <div class="field"><label>噪声 8h 等效声级 dB(A)（无噪声留空）</label><input name="noiseDb" type="number" min="60" max="140" step="1" placeholder="如 88"/></div>
      <div class="field field-wide"><label>接害因素（勾选后自动定档）</label><div class="checks">${factorChecks}</div></div>
      <div class="field"><label>&nbsp;</label><button class="primary" type="submit">添加岗位</button></div>
    </form>
  </div>`;
}

// ---------------------------------------------------------------------------
// 视图 3：员工
// ---------------------------------------------------------------------------
function renderWorkers() {
  const today = todayISO();
  const { warnDays } = state.settings;
  const rows = state.workers.map((w) => {
    const p = postById(w.postId);
    const st = workerState(w, p, today, warnDays);
    const acts = openActions(w);
    const levelBadge = clockBadge(st.level === 'amber' ? 'amber' : st.level, {
      red: '🔴 红线', amber: '🟡 临期', green: '🟢 正常', none: '⚪ 无需',
    });
    const examRows = (w.onJobExams || []).map((e, i) => {
      const c = CONCLUSIONS[e.conclusion] || { label: e.conclusion };
      const needClose = e.conclusion && e.conclusion !== 'normal' && !(w.closedActions || []).includes(e.date);
      return `<tr>
        <td>${esc(e.date)}</td><td>${esc(c.label)}</td><td>${esc(e.note || '')}</td><td>${yuan(e.costCents)}</td>
        <td>${needClose ? `<button class="ghost mini" data-act="close-act" data-id="${w.id}" data-date="${esc(e.date)}">标记已按机构建议处置</button>` : '✅'}</td>
        <td><button class="ghost mini danger" data-act="del-exam" data-id="${w.id}" data-date="${esc(e.date)}">删</button></td>
      </tr>`;
    }).join('');
    return `<details class="card detail-card" data-worker="${w.id}">
      <summary><b>${esc(w.name)}</b> · ${esc(p ? p.name : '未分配岗位')} ${levelBadge}
        <span class="muted">${st.kind === 'pre' ? esc(st.pre.msg) : st.leave.state === 'red' ? esc(st.leave.msg) : st.onJob && st.onJob.msg ? esc(st.onJob.msg) : ''}</span></summary>
      <div class="inner">
        <p class="muted">入岗 ${esc(w.hiredDate || '—')} · 上岗前检查 ${esc(w.preExamDate || '未登记')} · 离岗 ${esc(w.leaveDate || '在职')}${w.leaveExamDate ? ` · 离岗检查 ${esc(w.leaveExamDate)}` : ''}</p>
        ${st.kind === 'pre' ? `<div class="hint red">${esc(st.pre.msg)}</div>` : ''}
        ${st.leave.state !== 'none' && st.leave.state !== 'ok' ? `<div class="hint ${st.leave.state === 'amber' ? 'amber' : st.leave.state === 'red' ? 'red' : 'info'}">${esc(st.leave.msg)}</div>` : ''}
        ${acts.map((a) => `<div class="hint amber">待办：${esc(a.label)} → ${esc(a.action)}</div>`).join('')}
        <div class="table-wrap"><table><thead><tr><th>检查日期</th><th>结论</th><th>备注</th><th>费用</th><th>处置</th><th></th></tr></thead><tbody>
          ${examRows || '<tr><td colspan="6" class="muted">暂无在岗检查记录</td></tr>'}
        </tbody></table></div>
        <form class="panel" data-form="exam" data-id="${w.id}">
          <div class="field"><label>在岗检查日期</label><input name="date" type="date" required value="${esc(today)}"/></div>
          <div class="field"><label>结论</label><select name="conclusion">
            <option value="normal">正常</option>
            <option value="contraindication">职业禁忌（调离）</option>
            <option value="settle">健康损害可能与职业相关（安置）</option>
            <option value="suspected">疑似职业病（诊治安排）</option>
          </select></div>
          <div class="field"><label>费用（元，单位承担）</label><input name="cost" type="number" min="0" step="0.01" placeholder="如 420"/></div>
          <div class="field field-wide"><label>备注</label><input name="note" placeholder="机构建议/复查安排等"/></div>
          <div class="field"><label>&nbsp;</label><button class="primary" type="submit">登记检查</button></div>
        </form>
        <div class="checks" style="margin-top:8px">
          <button class="ghost mini" data-act="reg-pre" data-id="${w.id}">登记上岗前检查</button>
          <button class="ghost mini" data-act="reg-leave" data-id="${w.id}">登记离岗</button>
          <button class="ghost mini" data-act="archive" data-id="${w.id}">导出离岗档案复印件</button>
          <button class="ghost mini danger" data-act="del-worker" data-id="${w.id}">删除员工</button>
        </div>
      </div>
    </details>`;
  }).join('');

  const postOptions = state.posts.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  return `
  <h2 class="sect">员工监护名册（一人一档）</h2>
  ${rows || '<div class="card"><p class="empty">还没有员工——下方添加后自动挂入岗位监护钟</p></div>'}

  <h2 class="sect">添加员工</h2>
  <div class="card">
    <form id="f-worker" class="panel">
      <div class="field"><label>姓名 *</label><input name="name" required placeholder="员工姓名"/></div>
      <div class="field"><label>岗位 *</label><select name="postId" required>${postOptions}</select></div>
      <div class="field"><label>入岗日期</label><input name="hiredDate" type="date" value="${esc(today)}"/></div>
      <div class="field"><label>上岗前检查日期（未检则红线阻断）</label><input name="preExamDate" type="date"/></div>
      <div class="field"><label>&nbsp;</label><button class="primary" type="submit">添加员工</button></div>
    </form>
    ${state.posts.length === 0 ? '<div class="hint amber">请先到「岗位」视图登记接害岗位</div>' : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// 视图 4：合规四件套
// ---------------------------------------------------------------------------
function renderCompliance() {
  const today = todayISO();
  const c = state.compliance;
  const det = detectionClock(c.riskClass, c.lastDetectDate, c.lastAssessDate, today, state.settings.detectWarnDays);
  const dec = (c.changes || []).map((ch, i) => {
    const r = declarationClock(ch, ch.declared, today);
    return `<tr><td>${esc(r.label)}</td><td>${esc(r.date)}</td><td>${esc(r.deadline)}</td>
      <td>${r.state === 'ok' ? clockBadge('ok') : `${clockBadge(r.state)} ${esc(daysText(r.daysLeft))}`}</td>
      <td>${r.state !== 'ok' ? `<button class="ghost mini" data-act="declare-done" data-idx="${i}">标记已申报</button>` : ''}</td></tr>`;
  }).join('');
  const trs = trainingClock(c.training, today, state.settings.detectWarnDays, state.settings.refresherMonths);

  const changeOptions = Object.entries(CHANGE_TYPES).map(([k, v]) => `<option value="${k}">${esc(v.label)}（${v.days} 日内）</option>`).join('');

  return `
  <h2 class="sect">企业级合规四件套</h2>
  <p class="muted">检测与评价结果须存入职业卫生档案并公布（职业病防治法第 26 条）；公告栏设置见第 24 条。</p>

  <div class="card">
    <h3>① 职业病危害因素定期检测 / 现状评价（5 号令第 20 条）</h3>
    <div class="table-wrap"><table><thead><tr><th>事项</th><th>下次到期</th><th>状态</th><th>口径</th></tr></thead><tbody>
      ${det.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.due ? `${esc(r.due)}（${esc(daysText(r.daysLeft))}）` : '从未登记'}</td>
        <td>${clockBadge(r.state)}</td><td class="muted">${esc(r.basis)}</td></tr>`).join('')}
    </tbody></table></div>
    <form class="panel" data-form="detect" style="margin-top:8px">
      <div class="field"><label>危害风险等级</label><select name="riskClass">
        <option value="serious" ${c.riskClass === 'serious' ? 'selected' : ''}>职业病危害严重（年检+3年现状评价）</option>
        <option value="general" ${c.riskClass === 'general' ? 'selected' : ''}>职业病危害一般（3 年一检）</option>
      </select></div>
      <div class="field"><label>最近定期检测日期</label><input name="lastDetectDate" type="date" value="${esc(c.lastDetectDate || '')}"/></div>
      <div class="field"><label>最近现状评价日期（严重类）</label><input name="lastAssessDate" type="date" value="${esc(c.lastAssessDate || '')}"/></div>
      <div class="field"><label>&nbsp;</label><button class="primary" type="submit">保存</button></div>
    </form>
  </div>

  <div class="card">
    <h3>② 职业病危害项目申报变更（48 号令第 8 条）</h3>
    <div class="table-wrap"><table><thead><tr><th>变更情形</th><th>变化日</th><th>申报截止</th><th>状态</th><th></th></tr></thead><tbody>
      ${dec || '<tr><td colspan="5" class="muted">暂无变更登记</td></tr>'}
    </tbody></table></div>
    <form class="panel" data-form="change" style="margin-top:8px">
      <div class="field field-wide"><label>变更情形</label><select name="type">${changeOptions}</select></div>
      <div class="field"><label>变化/验收/收到结果日</label><input name="date" type="date" required value="${esc(today)}"/></div>
      <div class="field"><label>&nbsp;</label><button class="primary" type="submit">登记变更</button></div>
    </form>
  </div>

  <div class="card">
    <h3>③ 职业卫生培训（职业病防治法第 34 条）</h3>
    <div class="table-wrap"><table><thead><tr><th>培训</th><th>最近登记</th><th>下次复训</th><th>状态</th></tr></thead><tbody>
      ${trs.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.date || '从未登记')}</td><td>${r.due ? `${esc(r.due)}（${esc(daysText(r.daysLeft))}）` : '—'}</td><td>${clockBadge(r.state)}</td></tr>`).join('')}
    </tbody></table></div>
    <form class="panel" data-form="training" style="margin-top:8px">
      <div class="field"><label>负责人/管理人员培训日期</label><input name="managerDate" type="date" value="${esc(c.training.managerDate || '')}"/></div>
      <div class="field"><label>劳动者在岗复训日期</label><input name="staffDate" type="date" value="${esc(c.training.staffDate || '')}"/></div>
      <div class="field"><label>&nbsp;</label><button class="primary" type="submit">保存</button></div>
    </form>
  </div>

  <div class="card">
    <h3>④ 防护用品发放（按岗位，第 72 条(二)(三)：未提供或不维护 5万~20万）</h3>
    <p class="muted">发放周期默认 3 个月，可在「设置」调整；登记入口在「岗位」视图每行的「登记发放」。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 视图 5：自证包
// ---------------------------------------------------------------------------
function renderExport() {
  return `
  <h2 class="sect">迎检自证包</h2>
  <div class="card">
    <p>一键导出<b>单文件 HTML</b>：劳动者监护一览（三钟状态）+ 检测评价 + 申报变更 + 培训，含全部法规口径标注——卫生监督检查时打开即示、可打印纸质签收。</p>
    <p class="muted">口径：职业病防治法第 20/24/26/35/36 条 · 49 号令第 11~19 条 · 48 号令第 8 条 · 5 号令第 20 条 · GBZ 188—2025。${esc(DISCLAIMER)}</p>
    <button class="primary" data-act="export-cert">导出迎检自证包（单文件 HTML）</button>
    <button class="ghost" data-act="print-cert">打印/另存 PDF</button>
  </div>

  <h2 class="sect">整库备份</h2>
  <div class="card">
    <p class="muted">数据仅存本机浏览器。换机/清缓存前请先导出 JSON 备份。</p>
    <button class="ghost" data-act="export-json">导出 JSON 备份</button>
    <label class="ghost" style="display:inline-block;padding:7px 14px;border:1px solid var(--brand);border-radius:8px;cursor:pointer">
      导入 JSON 备份<input type="file" id="f-import" accept="application/json" style="display:none"/>
    </label>
  </div>`;
}

// ---------------------------------------------------------------------------
// 视图 6：设置
// ---------------------------------------------------------------------------
function renderSettings() {
  const s = state.settings;
  return `
  <h2 class="sect">企业信息与口径</h2>
  <div class="card">
    <form class="panel" data-form="settings">
      <div class="field"><label>企业名称（自证包抬头）</label><input name="orgName" value="${esc(s.orgName)}" placeholder="如：××机械加工厂"/></div>
      <div class="field"><label>在岗检查预警窗（天）</label><input name="warnDays" type="number" min="7" max="365" value="${s.warnDays}"/></div>
      <div class="field"><label>检测/培训预警窗（天）</label><input name="detectWarnDays" type="number" min="7" max="365" value="${s.detectWarnDays}"/></div>
      <div class="field"><label>劳动者复训间隔（月）</label><input name="refresherMonths" type="number" min="3" max="60" value="${s.refresherMonths}"/></div>
      <div class="field"><label>防护用品发放周期（月）</label><input name="ppeMonths" type="number" min="1" max="36" value="${s.ppeMonths}"/></div>
      <div class="field"><label>&nbsp;</label><button class="primary" type="submit">保存设置</button></div>
    </form>
  </div>

  <h2 class="sect">示例数据</h2>
  <div class="card">
    <p class="muted">载入一座小微机械加工厂的示例（电焊/打磨/喷涂三岗位 + 5 名员工 + 四件套记录），用于演示与培训。</p>
    <button class="ghost" data-act="load-demo">载入示例数据</button>
  </div>

  <h2 class="sect">危险区</h2>
  <div class="card">
    <button class="ghost danger" data-act="wipe">清空全部数据（不可恢复）</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// 示例数据
// ---------------------------------------------------------------------------
function loadDemo() {
  const d1 = addPost([], { name: '电焊岗', factors: ['dust_welding', 'noise'], grade: 'II', noiseDb: 88 });
  let posts = d1;
  posts = addPost(posts, { name: '打磨岗', factors: ['dust_silica', 'noise'], grade: 'unknown', noiseDb: 92 });
  posts = addPost(posts, { name: '喷涂岗', factors: ['benzene'], grade: 'I' });
  posts[0].lastPpeDate = '2026-08-10';
  posts[1].lastPpeDate = '2026-06-01';
  posts[2].lastPpeDate = '2026-07-20';
  let workers = [];
  workers = addWorker(workers, { name: '王铁柱', postId: posts[0].id, hiredDate: '2023-03-01', preExamDate: '2023-02-20', onJobExams: [{ date: '2025-09-10', conclusion: 'normal', costCents: 42000, note: '电焊工种专项' }] });
  workers = addWorker(workers, { name: '李梅', postId: posts[1].id, hiredDate: '2022-06-15', preExamDate: '2022-06-01', onJobExams: [{ date: '2026-08-28', conclusion: 'normal', costCents: 48000 }] });
  workers = addWorker(workers, { name: '张勇', postId: posts[2].id, hiredDate: '2024-04-01', preExamDate: null, onJobExams: [] });
  workers = addWorker(workers, { name: '刘芳', postId: posts[2].id, hiredDate: '2021-09-01', preExamDate: '2021-08-25', onJobExams: [{ date: '2026-07-15', conclusion: 'settle', note: '白细胞偏低，建议三个月后复查' }], leaveDate: '2026-09-30' });
  workers = addWorker(workers, { name: '陈刚', postId: posts[1].id, hiredDate: '2019-05-20', preExamDate: '2019-05-10', onJobExams: [{ date: '2026-05-01', conclusion: 'normal' }], leaveDate: '2026-08-15' });
  state.posts = posts;
  state.workers = workers;
  state.compliance = {
    riskClass: 'serious',
    lastDetectDate: '2025-09-01',
    lastAssessDate: '2023-09-10',
    changes: [{ type: 'process', date: '2026-08-25', declared: false }],
    training: { managerDate: '2025-10-20', staffDate: '2026-03-15' },
  };
  state.settings = { ...state.settings, orgName: '示例机械加工厂' };
  persist();
  go('dashboard');
  toast('示例数据已载入');
}

// ---------------------------------------------------------------------------
// 下载与导入
// ---------------------------------------------------------------------------
function download(filename, text, mime = 'text/html') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

// ---------------------------------------------------------------------------
// 事件委托
// ---------------------------------------------------------------------------
viewEl.addEventListener('submit', (e) => {
  const form = e.target;
  const today = todayISO();
  if (form.id === 'f-post') {
    e.preventDefault();
    const fd = new FormData(form);
    const factors = fd.getAll('factor');
    state.posts = addPost(state.posts, {
      name: fd.get('name'),
      grade: fd.get('grade'),
      noiseDb: fd.get('noiseDb') ? Number(fd.get('noiseDb')) : null,
      factors,
    });
    persist(); render();
    toast('岗位已添加，周期已按 GBZ 188—2025 定档');
  } else if (form.id === 'f-worker') {
    e.preventDefault();
    const fd = new FormData(form);
    state.workers = addWorker(state.workers, {
      name: fd.get('name'),
      postId: fd.get('postId'),
      hiredDate: fd.get('hiredDate') || null,
      preExamDate: fd.get('preExamDate') || null,
    });
    persist(); render();
    toast('员工已添加');
  } else if (form.dataset.form === 'exam') {
    e.preventDefault();
    const fd = new FormData(form);
    const w = state.workers.find((x) => x.id === form.dataset.id);
    const cost = fd.get('cost') ? Math.round(Number(fd.get('cost')) * 100) : undefined;
    const updated = addExam(w, { date: fd.get('date'), conclusion: fd.get('conclusion'), note: fd.get('note') || '', costCents: cost });
    state.workers = state.workers.map((x) => (x.id === w.id ? updated : x));
    persist(); render();
    toast('检查已登记，监护钟已更新');
  } else if (form.dataset.form === 'detect') {
    e.preventDefault();
    const fd = new FormData(form);
    state.compliance.riskClass = fd.get('riskClass');
    state.compliance.lastDetectDate = fd.get('lastDetectDate') || null;
    state.compliance.lastAssessDate = fd.get('lastAssessDate') || null;
    persist(); render();
    toast('检测口径已保存');
  } else if (form.dataset.form === 'change') {
    e.preventDefault();
    const fd = new FormData(form);
    state.compliance.changes = [...(state.compliance.changes || []), { type: fd.get('type'), date: fd.get('date'), declared: false }];
    persist(); render();
    toast('变更已登记，申报截止钟已启动');
  } else if (form.dataset.form === 'training') {
    e.preventDefault();
    const fd = new FormData(form);
    state.compliance.training = { managerDate: fd.get('managerDate') || null, staffDate: fd.get('staffDate') || null };
    persist(); render();
    toast('培训记录已保存');
  } else if (form.dataset.form === 'settings') {
    e.preventDefault();
    const fd = new FormData(form);
    state.settings = {
      orgName: fd.get('orgName') || '',
      warnDays: Number(fd.get('warnDays')) || 90,
      detectWarnDays: Number(fd.get('detectWarnDays')) || 60,
      refresherMonths: Number(fd.get('refresherMonths')) || 12,
      ppeMonths: Number(fd.get('ppeMonths')) || 3,
    };
    persist(); render();
    toast('设置已保存');
  }
});

viewEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act], input[type="file"]');
  if (!btn) return;
  const today = todayISO();
  if (btn.id === 'f-import') {
    btn.addEventListener('change', () => {
      const file = btn.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = importBundle(JSON.parse(String(reader.result)));
          state = { ...DEFAULT_STATE, ...data };
          persist(); go('dashboard');
          toast('备份已导入');
        } catch (err) {
          toast(`导入失败：${err.message}`);
        }
      };
      reader.readAsText(file);
    });
    return;
  }
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if (act === 'del-post') {
    const workers = state.workers;
    try {
      state.posts = removePost(state.posts, workers, id);
      persist(); render(); toast('岗位已删除');
    } catch (err) { toast(err.message); }
  } else if (act === 'ppe') {
    const p = postById(id);
    p.lastPpeDate = today;
    persist(); render(); toast(`已登记 ${p.name} 今日发放防护用品`);
  } else if (act === 'del-worker') {
    state.workers = removeWorker(state.workers, id);
    persist(); render(); toast('员工已删除');
  } else if (act === 'reg-pre') {
    const w = state.workers.find((x) => x.id === id);
    const d = window.prompt('上岗前职业健康检查日期（YYYY-MM-DD）', today);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      w.preExamDate = d;
      persist(); render(); toast('上岗前检查已登记');
    } else if (d) { toast('日期格式应为 YYYY-MM-DD'); }
  } else if (act === 'reg-leave') {
    const w = state.workers.find((x) => x.id === id);
    const d = window.prompt('离岗日期（YYYY-MM-DD，未来日期=拟离职，将启动 30 日离岗检查窗）', today);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      w.leaveDate = d;
      persist(); render(); toast('离岗已登记，离岗闸钟已启动');
    } else if (d) { toast('日期格式应为 YYYY-MM-DD'); }
  } else if (act === 'close-act') {
    const w = state.workers.find((x) => x.id === id);
    w.closedActions = [...(w.closedActions || []), btn.dataset.date];
    persist(); render(); toast('已标记按机构建议处置（49 号令第 17 条）');
  } else if (act === 'del-exam') {
    const w = state.workers.find((x) => x.id === id);
    w.onJobExams = (w.onJobExams || []).filter((ex) => ex.date !== btn.dataset.date);
    persist(); render(); toast('检查记录已删除');
  } else if (act === 'archive') {
    const w = state.workers.find((x) => x.id === id);
    download(`监护档案复印件-${w.name}.html`, leavingArchiveHtml(w, postById(w.postId), today));
  } else if (act === 'declare-done') {
    const idx = Number(btn.dataset.idx);
    state.compliance.changes[idx].declared = true;
    persist(); render(); toast('已标记完成变更申报');
  } else if (act === 'export-cert') {
    const html = selfCertHtml(state, today);
    download(`职业健康监护迎检自证包-${today}.html`, html);
    toast('自证包已导出（单文件 HTML）');
  } else if (act === 'print-cert') {
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(selfCertHtml(state, today));
      w.document.close();
      w.focus();
      w.print();
    } else {
      toast('浏览器拦截了新窗口，请改用导出按钮');
    }
  } else if (act === 'export-json') {
    download(`岗卫账备份-${today}.json`, JSON.stringify(exportBundle(state), null, 2), 'application/json');
    toast('JSON 备份已导出');
  } else if (act === 'load-demo') {
    loadDemo();
  } else if (act === 'wipe') {
    if (window.confirm('确定清空全部岗位与员工数据？此操作不可恢复。')) {
      clearState();
      state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      render(); toast('已清空');
    }
  }
});

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
go('dashboard');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
