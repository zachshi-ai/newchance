/**
 * ui.js — 视图渲染层（纯字符串 HTML，不直接碰状态；事件委托在 app.js）
 */
import {
  PACKAGE_KINDS, balanceOf, lowBalanceWarnings, expiringPackages, expiredOutstanding,
  teacherPayroll, studentLedger, statementText, refundEstimate, refundText,
  fmtYuan, escapeHtml, todayISO, addDays, monthKey,
} from './core.js';

export const esc = escapeHtml;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(iso) {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

export function viewOnboarding() {
  return `
  <h2 class="sec">预收费机构，先有一本清白的课时账</h2>
  <div class="card">
    <p><strong>为什么需要它？</strong>双减之后，预收费被套上「3 个月或 60 课时」红线与「一课一消」资金监管；家长最怕机构说不清课时、跑路、退费扯皮。小微机构的现状：纸卡划课时、Excel 记名、余额靠算——课消对不上、临期没人管、退费全凭吵。</p>
    <p><strong>消课单的做法：</strong>学员购课建包 → 上完课点名消课（正课先消、赠课后消、临期先消）→ 余额临期自动预警 → 一键生成家长对账单（微信文本 / 打印版）发出去，续费与信任都长在对账单上；退费试算按「已消正课折算、赠课不折现」给双方一个都能看的数。</p>
    <div class="row">
      <a class="btn" href="#/settings">🏫 先建机构与课程档案</a>
      <button class="btn ghost" data-action="seed-demo">先看示例数据</button>
    </div>
    <p class="fine">不做监管平台报送、不做在线收退费——那是「校外培训家长端」的事；这里是机构自己的底账。数据只存在你设备里。</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// 今日（看板：消课汇总 + 四类预警）
// ---------------------------------------------------------------------------

export function viewBoard(state) {
  if (!state.students?.length) return viewOnboarding();
  const today = todayISO();
  const month = monthKey(today);
  const low = lowBalanceWarnings(state.packages, state.students, today, state.settings?.lowBalance ?? 3);
  const expiring = expiringPackages(state.packages, state.students, state.courses, today, state.settings?.expiryWindowDays ?? 30);
  const expired = expiredOutstanding(state.packages, state.students, state.courses, today);
  const payroll = teacherPayroll(state.sessions, state.teachers, month);
  const todaySessions = (state.sessions ?? []).filter((s) => s.dateISO === today);
  const courseById = new Map(state.courses.map((c) => [c.id, c.name]));
  const teacherById = new Map(state.teachers.map((t) => [t.id, t.name]));
  const studentById = new Map(state.students.map((s) => [s.id, s.name]));
  const headCount = todaySessions.reduce((n, s) => n + s.allocations.length, 0);

  const alerts = [];
  if (expired.length) {
    alerts.push(`<div class="card alert issue"><strong>⚠ 过期未消课时</strong>
      <ul>${expired.map((x) => `<li>${esc(x.studentName)} · ${esc(x.courseName)}：${x.remaining} 节已于 ${esc(x.expireISO)} 过期——按合同处理，主动找家长谈，别等投诉</li>`).join('')}</ul></div>`);
  }
  if (expiring.length) {
    alerts.push(`<div class="card alert"><strong>⏰ 课包临期（${state.settings?.expiryWindowDays ?? 30} 天内到期）</strong>
      <ul>${expiring.map((x) => `<li>${esc(x.studentName)} · ${esc(x.courseName)}：还剩 ${x.remaining} 节，${x.daysLeft === 0 ? '今天' : `${x.daysLeft} 天后`}（${esc(x.expireISO)}）到期——安排消课或办延期</li>`).join('')}</ul></div>`);
  }
  if (low.length) {
    alerts.push(`<div class="card alert"><strong>💡 余额预警（续费触点）</strong>
      <ul>${low.map((x) => `<li>${esc(x.studentName)} · ${esc(courseById.get(x.courseId) ?? '?')}：只剩 ${x.remaining} 节——发对账单顺带提续费</li>`).join('')}</ul></div>`);
  }

  return `
  <h2 class="sec">今日 · ${today} ${weekdayLabel(today)}</h2>
  <div class="card progress-card">
    <div class="progress-text">📒 今日消课：<strong>${todaySessions.length}</strong> 节 · <strong>${headCount}</strong> 人次</div>
    ${todaySessions.length
    ? `<p class="done-note">${todaySessions.map((s) => `${esc(courseById.get(s.courseId) ?? '?')}（${esc(teacherById.get(s.teacherId) ?? '?')}）${s.allocations.length} 人`).join(' · ')}</p>`
    : '<p class="done-note">今天还没点名。去「消课」完成今日课消。</p>'}
  </div>
  ${alerts.join('')}
  <h2 class="sec">教师课时 · ${month}（按节计酬）</h2>
  ${payroll.length ? `<div class="card"><table class="plain">
    <tr><th>教师</th><th>本月节数</th><th>每节</th><th>应发</th></tr>
    ${payroll.map((r) => `<tr><td>${esc(r.teacherName)}</td><td>${r.classes}</td><td>${fmtYuan(r.feeCents)}</td><td><strong>${fmtYuan(r.payCents)}</strong></td></tr>`).join('')}
  </table><p class="fine">课时费只是记账口径，实际结算以你与老师的约定为准；「消课」页可按月核对本表。</p></div>`
    : '<div class="card"><p class="fine">本月还没有消课记录。</p></div>'}
  <h2 class="sec">账本速览</h2>
  <div class="card">
    <div class="row stats-line">
      <span>学员 <strong>${state.students.length}</strong></span>
      <span>在管课包 <strong>${state.packages.filter((p) => p.used < p.total).length}</strong></span>
      <span>消课累计 <strong>${(state.sessions ?? []).reduce((n, s) => n + s.allocations.length, 0)}</strong> 人次</span>
    </div>
    <div class="row">
      <a class="btn" href="#/sessions">✅ 去点名消课</a>
      <a class="btn ghost" href="#/statement">🧾 生成家长对账单</a>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 学员与课包
// ---------------------------------------------------------------------------

export function viewStudents(state) {
  const today = todayISO();
  const lowSet = new Set(lowBalanceWarnings(state.packages, state.students, today, state.settings?.lowBalance ?? 3)
    .map((x) => `${x.studentId}|${x.courseId}`));
  return `
  <h2 class="sec">🧑‍🎓 学员（${state.students.length}）</h2>
  <div class="card">
    <div class="form-grid">
      <label>姓名<input id="stu-name" placeholder="如：王小满" /></label>
      <label>家长电话<input id="stu-phone" placeholder="微信/手机（对账单送达用）" /></label>
      <label class="span2">备注<input id="stu-note" placeholder="如：周六 10 点班、奶奶接送（选填）" /></label>
    </div>
    <button class="btn" data-action="add-student">添加学员</button>
  </div>
  ${state.students.length ? `<div class="card"><table class="plain">
    <tr><th>学员</th><th>联系方式</th><th>课时余额（按科目）</th><th></th></tr>
    ${[...state.students].reverse().map((s) => {
    const chips = state.courses.map((c) => {
      const bal = balanceOf(state.packages, s.id, c.id);
      if (bal.total === 0) return '';
      const low = lowSet.has(`${s.id}|${c.id}`);
      return `<span class="pill ${low ? 'warn' : 'ok'}">${esc(c.name)} ${bal.remaining}</span>`;
    }).join('');
    return `<tr>
        <td><strong>${esc(s.name)}</strong>${s.note ? `<div class="basis">${esc(s.note)}</div>` : ''}</td>
        <td class="fine">${esc(s.phone || '—')}</td>
        <td>${chips || '<span class="fine">未购课</span>'}</td>
        <td><button class="btn small ghost" data-action="del-student" data-idx="${state.students.indexOf(s)}">删除</button></td>
      </tr>`;
  }).join('')}
  </table></div>` : '<div class="card"><p class="fine">先添加学员，再给他们购课建包。</p></div>'}

  <h2 class="sec">🎒 购课建包（预收费入口）</h2>
  <div class="card">
    ${state.courses.length && state.students.length ? `
    <div class="form-grid">
      <label>学员<select id="pkg-student">${state.students.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label>科目<select id="pkg-course">${state.courses.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label>类型<select id="pkg-kind"><option value="paid">正课（实付）</option><option value="bonus">赠课（不折现）</option></select></label>
      <label>课时数<input type="number" id="pkg-total" min="1" max="200" value="20" /></label>
      <label>实付金额（元）<input type="number" id="pkg-price" min="0" value="2400" /></label>
      <label>购课日<input type="date" id="pkg-bought" value="${today}" /></label>
      <label class="span2">到期日（选填；建议按红线不超过 3 个月）<input type="date" id="pkg-expire" value="${addDays(today, 90)}" /></label>
    </div>
    <button class="btn" data-action="add-package">建包入账</button>
    <p class="fine">超过 60 课时或「在途 + 新包」打包超限时会亮红线（教育部等六部门 2021 通知口径）；赠课包金额为 0、退费不折现。工具只提示不阻止——红线执行以属地监管与合同为准。</p>`
    : '<p class="fine">先在「设置」添加课程、在本页添加学员。</p>'}
  </div>

  <h2 class="sec">📚 课包台账（${state.packages.length}）</h2>
  ${state.packages.length ? `<div class="card"><table class="plain">
    <tr><th>学员</th><th>科目</th><th>类型</th><th>购课日</th><th>已消/总</th><th>实付</th><th>到期</th><th></th></tr>
    ${[...state.packages].reverse().map((p) => {
    const st = state.students.find((s) => s.id === p.studentId);
    const done = p.used >= p.total;
    return `<tr class="${done ? 'muted' : ''}">
        <td>${esc(st?.name ?? '?')}</td>
        <td>${esc(state.courses.find((c) => c.id === p.courseId)?.name ?? '?')}</td>
        <td>${PACKAGE_KINDS[p.kind].label}</td>
        <td class="fine">${esc(p.boughtISO)}</td>
        <td>${p.used}/${p.total}${done ? ' ✅' : ''}</td>
        <td>${p.kind === 'paid' ? fmtYuan(p.priceCents) : '—'}</td>
        <td class="fine">${p.expireISO ? esc(p.expireISO) : '不限'}</td>
        <td><button class="btn small ghost" data-action="del-package" data-idx="${state.packages.indexOf(p)}">删除</button></td>
      </tr>`;
  }).join('')}
  </table><p class="fine">已消过的课包不可删除（账实一致）；确需作废走线下合同处理。过期未消的课时会在「今日」页点名提醒。</p></div>`
    : '<div class="card"><p class="fine">还没有课包。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 消课（点名 → 一课一消落账）
// ---------------------------------------------------------------------------

export function viewSessions(state) {
  const today = todayISO();
  const courseById = new Map(state.courses.map((c) => [c.id, c.name]));
  const teacherById = new Map(state.teachers.map((t) => [t.id, t.name]));
  const studentById = new Map(state.students.map((s) => [s.id, s.name]));
  const roster = state.students.map((s) => ({
    s,
    remaining: state.courses.reduce((n, c) => n + balanceOf(state.packages, s.id, c.id).remaining, 0),
  }));
  const recent = [...(state.sessions ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 30);
  return `
  <h2 class="sec">✅ 点名消课（上完课就记，一课一消）</h2>
  <div class="card">
    ${state.courses.length && state.teachers.length && state.students.length ? `
    <div class="form-grid">
      <label>上课日期<input type="date" id="ses-date" value="${today}" /></label>
      <label>科目<select id="ses-course">${state.courses.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label>教师<select id="ses-teacher">${state.teachers.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
      <label>备注<input id="ses-note" placeholder="如：期中汇演排练（选填）" /></label>
    </div>
    <p class="basis" style="margin:4px 0">勾选到场学员（同科目同日不可重复点名；余额不足会整体拒绝）：</p>
    <div class="row wrap">
      ${roster.map(({ s, remaining }) => `<label class="check-chip"><input type="checkbox" class="ses-check" value="${s.id}" /> ${esc(s.name)} <span class="basis">余 ${remaining}</span></label>`).join('')}
    </div>
    <button class="btn" data-action="add-session" style="margin-top:10px">消课落账</button>
    <p class="fine">消耗顺序：正课先于赠课；同优先级临期先消、再按购课日先买先消。点到无课可消的学员会整体拒绝，绝不部分入账。</p>`
    : '<p class="fine">需要先有课程、教师与学员——去「设置」和「学员」补齐。</p>'}
  </div>

  <h2 class="sec">消课记录（最近 30 条）</h2>
  ${recent.length ? `<div class="card"><table class="plain">
    <tr><th>日期</th><th>科目</th><th>教师</th><th>学员</th><th></th></tr>
    ${recent.map((s) => `<tr>
      <td>${esc(s.dateISO)}</td>
      <td>${esc(courseById.get(s.courseId) ?? '?')}</td>
      <td>${esc(teacherById.get(s.teacherId) ?? '?')}</td>
      <td class="fine">${s.allocations.map((a) => esc(studentById.get(a.studentId) ?? '?')).join('、')}</td>
      <td><button class="btn small ghost" data-action="undo-session" data-idx="${s.id}">撤销</button></td>
    </tr>`).join('')}
  </table><p class="fine">撤销会按分配精确回滚课包已消数——点错了不怕，账实始终一致。</p></div>`
    : '<div class="card"><p class="fine">还没有消课记录。</p></div>'}`;
}

// ---------------------------------------------------------------------------
// 对账单与退费试算
// ---------------------------------------------------------------------------

export function viewStatement(state, stmtStudent = null, refund = null) {
  if (!state.students?.length) return viewOnboarding();
  const today = todayISO();
  const studentId = stmtStudent ?? state.students[0]?.id;
  const hasData = (state.packages ?? []).some((p) => p.studentId === studentId);
  let preview = '';
  let error = '';
  try {
    preview = statementText({ state, studentId, todayISOStr: today });
  } catch (e) { error = e.message; }

  let refundBlock = '';
  if (refund && refund.studentId === studentId) {
    refundBlock = `<div class="card"><strong>退费试算结果（${esc(refund.studentName)}）</strong>
      <pre class="preview">${esc(refund.text)}</pre></div>`;
  }

  return `
  <h2 class="sec">🧾 家长对账单（微信发家长 = 信任交付）</h2>
  <div class="card">
    <div class="row">
      <label>学员 <select id="stmt-student">${state.students.map((s) => `<option value="${s.id}" ${s.id === studentId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <button class="btn small" data-action="stmt-apply">生成</button>
    </div>
    ${error ? `<p class="fine">⚠ ${esc(error)}</p>`
    : hasData ? `
      <div class="row">
        <button class="btn" data-action="stmt-copy">📋 复制文本（微信粘贴给家长）</button>
        <button class="btn ghost" data-action="stmt-download">⬇️ 下载打印版 HTML</button>
        <button class="btn ghost" data-action="stmt-print">🖨️ 直接打印</button>
      </div>
      <pre class="preview">${esc(preview)}</pre>
      <p class="fine">文本通道为主：家长不用装 App，微信里看课时余额与消课明细；打印版为单文件 HTML（含双方签字栏），可用于续费确认与留档。</p>`
    : '<p class="fine">该学员还没有课包——先在「学员」页购课建包。</p>'}
  </div>

  <h2 class="sec">💸 退费试算（按已消正课折算，赠课不折现）</h2>
  <div class="card">
    <button class="btn" data-action="refund-estimate">按当前学员试算</button>
    <p class="fine">口径：应退 = Σ正课包（实付 − 已消 × 单节折算价）；单节折算价 = 包实付 ÷ 包总课时；赠课与过期未消不折现、单列按合同处理。这是给双方一个都能看的数，<strong>最终以培训合同为准</strong>。</p>
    ${refundBlock}
  </div>`;
}

// ---------------------------------------------------------------------------
// 设置（机构 / 教师 / 课程 / 参数 / 数据）
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const org = state.org ?? {};
  return `
  <h2 class="sec">🏫 机构</h2>
  <div class="card">
    <div class="form-grid">
      <label>机构名称<input id="org-name" value="${esc(org.name ?? '')}" placeholder="如：小满舞蹈工作室（印在对账单上）" /></label>
      <label>联系电话<input id="org-phone" value="${esc(org.phone ?? '')}" /></label>
    </div>
    <button class="btn" data-action="save-org">保存</button>
  </div>

  <h2 class="sec">🧑‍🏫 教师（${state.teachers.length}）</h2>
  <div class="card">
    ${state.teachers.length ? `<table class="plain">
      <tr><th>姓名</th><th>每节课时费</th><th></th></tr>
      ${state.teachers.map((t, i) => `<tr><td>${esc(t.name)}</td><td>${fmtYuan(t.feeCents)}</td>
        <td><button class="btn small ghost" data-action="del-teacher" data-idx="${i}">删除</button></td></tr>`).join('')}
    </table>` : '<p class="fine">先添加授课教师。</p>'}
    <div class="row">
      <input id="tea-name" placeholder="教师姓名" />
      <input type="number" id="tea-fee" min="0" value="100" style="width:90px" title="每节课时费（元）" />
      <span class="fine">元/节</span>
      <button class="btn small" data-action="add-teacher">添加教师</button>
    </div>
    <p class="fine">课时费按「节」计不按人头：集体课一节课算一份；只是记账口径，设置随时可改。</p>
  </div>

  <h2 class="sec">📖 科目 / 课程（${state.courses.length}）</h2>
  <div class="card">
    ${state.courses.length ? `<table class="plain">
      <tr><th>课程</th><th></th></tr>
      ${state.courses.map((c, i) => `<tr><td>${esc(c.name)}</td>
        <td><button class="btn small ghost" data-action="del-course" data-idx="${i}">删除</button></td></tr>`).join('')}
    </table>` : '<p class="fine">先添加课程（如：少儿街舞启蒙班）。</p>'}
    <div class="row">
      <input id="course-name" placeholder="课程名称" />
      <button class="btn small" data-action="add-course">添加课程</button>
    </div>
  </div>

  <h2 class="sec">🔔 预警参数（行业先验的本地覆盖）</h2>
  <div class="card">
    <div class="row">
      <label>余额预警线（剩余 ≤）<input type="number" id="set-low" min="0" max="30" value="${state.settings?.lowBalance ?? 3}" style="width:70px" /> 节</label>
      <label>临期提醒窗<input type="number" id="set-expwin" min="1" max="180" value="${state.settings?.expiryWindowDays ?? 30}" style="width:80px" /> 天</label>
    </div>
    <button class="btn small" data-action="save-settings">保存参数</button>
    <p class="fine">余额线是续费触点，临期窗是「过期纠纷」的疫苗——都按你的招生节奏改。</p>
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
