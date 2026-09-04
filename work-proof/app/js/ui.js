/**
 * ui.js — 纯渲染层：state → HTML 字符串（无副作用，不碰存储）
 */
import {
  todayISO, addDays, addMonths, daysUntil,
  CONTRACT_TYPES, employeeRisks, companyRisks,
  parseMoneyToCents, fmtCents, maskIdCard, workYearsLabel,
  FREE_EMPLOYEE_LIMIT, LICENSE_PRICE_HINT,
} from './core.js';

const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const LEVEL_BADGE = {
  high: '<span class="badge high">高危</span>',
  medium: '<span class="badge medium">中危</span>',
  low: '<span class="badge low">低危</span>',
};

function riskCard(r) {
  return `
  <div class="risk risk-${r.level}">
    <div class="risk-head">${LEVEL_BADGE[r.level]}<strong>${e(r.title)}</strong></div>
    <p class="risk-why">${e(r.why)}</p>
    <p class="risk-action"><b>今天做什么：</b>${e(r.action)}</p>
    <p class="risk-basis">${r.basis.map((b) => e(b)).join(' · ')}</p>
  </div>`;
}

function riskBadgeRow(risks) {
  if (!risks.length) return '<span class="badge ok">干净</span>';
  const h = risks.filter((r) => r.level === 'high').length;
  const m = risks.filter((r) => r.level === 'medium').length;
  if (h) return `<span class="badge high">${h} 项高危</span>`;
  if (m) return `<span class="badge medium">${m} 项待办</span>`;
  return '<span class="badge low">提醒</span>';
}

// ---------------------------------------------------------------------------
// 今日 · 风险预警台
// ---------------------------------------------------------------------------

export function viewDashboard(state) {
  const today = todayISO();
  const risks = companyRisks(state.employees, today);
  const licensed = !!state.license?.activatedAt;
  const countdowns = state.employees
    .filter((x) => x.status !== 'left')
    .map((x) => {
      const rows = [];
      if (!x.contractSigned) {
        const dl = addMonths(x.hire, 1);
        if (today <= dl) rows.push({ label: `${x.name} · 签合同截止`, date: dl });
      }
      if (x.contractEnd && x.contractEnd >= today && daysUntil(x.contractEnd, today) <= 30) {
        rows.push({ label: `${x.name} · 合同到期`, date: x.contractEnd });
      }
      if (x.probationEnd && x.probationEnd >= today && daysUntil(x.probationEnd, today) <= 30) {
        rows.push({ label: `${x.name} · 试用期到期（评估转正）`, date: x.probationEnd });
      }
      return rows;
    })
    .flat()
    .sort((a, b) => a.date < b.date ? -1 : 1)
    .slice(0, 8);

  const empCards = risks.items
    .filter((x) => x.risks.length > 0)
    .map(({ emp, risks: rs }) => `
      <section class="card">
        <div class="card-head">
          <h3>${e(emp.name)}${emp.role ? ` · ${e(emp.role)}` : ''}${emp.status === 'left' ? ' <span class="muted">（已离职）</span>' : ''}</h3>
          <a class="btn small" href="#/staff/${e(emp.id)}">去处理</a>
        </div>
        ${rs.map(riskCard).join('')}
      </section>`)
    .join('');

  return `
  <div class="stats">
    <div class="stat ${risks.high ? 'stat-high' : 'stat-ok'}"><b>${risks.high}</b><span>高危项</span></div>
    <div class="stat"><b>${risks.medium}</b><span>待办项</span></div>
    <div class="stat"><b>${state.employees.filter((x) => x.status !== 'left').length}</b><span>在职员工</span></div>
    <div class="stat"><b>${risks.cleanEmployees}</b><span>档案干净</span></div>
  </div>
  ${!state.employees.length ? `
    <section class="card empty">
      <h3>从一个员工开始</h3>
      <p>双倍工资、违法试用期、弃保赔偿……小微企业最常见的劳动纠纷，都始于档案里没有的那一行记录。</p>
      <p><a class="btn primary" href="#/staff">＋ 录入第一个员工</a>　<button class="btn" data-action="seed-demo">先看示例数据</button></p>
    </section>` : ''}
  ${countdowns.length ? `
    <section class="card">
      <h3>⏳ 倒计时</h3>
      <ul class="countdown">
        ${countdowns.map((c) => `<li><b>${daysUntil(c.date, today)} 天</b><span>${e(c.label)}（${c.date}）</span></li>`).join('')}
      </ul>
    </section>` : ''}
  ${empCards || ''}
  ${risks.items.length && !empCards ? '<section class="card empty"><p>✅ 全员无风险项。保持：新员工入职当月签合同、社保当月参保、离职当天开证明。</p></section>' : ''}
  <p class="muted small">免费档最多 ${FREE_EMPLOYEE_LIMIT} 名员工${licensed ? '（已解锁）' : `，${LICENSE_PRICE_HINT} 解锁无限员工 —— 见「设置」`}。风险判定按主流裁审口径，仅供参考。</p>`;
}

// ---------------------------------------------------------------------------
// 员工档案
// ---------------------------------------------------------------------------

function employeeForm(emp) {
  const v = (f) => e(emp[f] ?? '');
  return `
  <div class="grid">
    <label>姓名 *<input id="f-name-${emp.id}" value="${v('name')}" placeholder="张三" /></label>
    <label>岗位<input id="f-role-${emp.id}" value="${v('role')}" placeholder="店员 / 厨师 / 仓管" /></label>
    <label>入职日期 *<input id="f-hire-${emp.id}" type="date" value="${v('hire')}" /></label>
    <label>身份证号（选填）<input id="f-idcard-${emp.id}" value="${v('idCard')}" placeholder="仅本机保存" /></label>
    <label>合同类型
      <select id="f-type-${emp.id}">
        ${Object.entries(CONTRACT_TYPES).map(([k, o]) => `<option value="${k}"${emp.contractType === k ? ' selected' : ''}>${o.label}</option>`).join('')}
      </select></label>
    <label>是否已签书面合同
      <select id="f-signed-${emp.id}">
        <option value="yes"${emp.contractSigned ? ' selected' : ''}>已签</option>
        <option value="no"${!emp.contractSigned ? ' selected' : ''}>未签</option>
      </select></label>
    <label>合同起（固定期限填）<input id="f-cstart-${emp.id}" type="date" value="${v('contractStart')}" /></label>
    <label>合同止（无固定期限留空）<input id="f-cend-${emp.id}" type="date" value="${v('contractEnd')}" /></label>
    <label>试用期止（未约定留空）<input id="f-prob-${emp.id}" type="date" value="${v('probationEnd')}" /></label>
    <label>此前是否已约定过试用期
      <select id="f-hadprob-${emp.id}">
        <option value="no"${!emp.hadProbationBefore ? ' selected' : ''}>否</option>
        <option value="yes"${emp.hadProbationBefore ? ' selected' : ''}>是（续签/再入职）</option>
      </select></label>
    <label>转正月薪（元）<input id="f-rsalary-${emp.id}" value="${emp.regularSalaryCents != null ? fmtCents(emp.regularSalaryCents) : ''}" placeholder="6000" inputmode="decimal" /></label>
    <label>试用期月薪（元）<input id="f-psalary-${emp.id}" value="${emp.probationSalaryCents != null ? fmtCents(emp.probationSalaryCents) : ''}" placeholder="4800" inputmode="decimal" /></label>
    <label>社保是否已参保
      <select id="f-social-${emp.id}">
        <option value="yes"${emp.socialInsured !== false ? ' selected' : ''}>已参保</option>
        <option value="no"${emp.socialInsured === false ? ' selected' : ''}>未参保</option>
      </select></label>
    <label>在职状态
      <select id="f-status-${emp.id}">
        <option value="active"${emp.status !== 'left' ? ' selected' : ''}>在职</option>
        <option value="left"${emp.status === 'left' ? ' selected' : ''}>已离职</option>
      </select></label>
    <label>离职日期（离职填）<input id="f-left-${emp.id}" type="date" value="${v('leftDate')}" /></label>
    <label>离职证明已开具
      <select id="f-cert-${emp.id}">
        <option value="no"${!emp.certIssued ? ' selected' : ''}>未开</option>
        <option value="yes"${emp.certIssued ? ' selected' : ''}>已开</option>
      </select></label>
  </div>`;
}

export function viewStaff(state, selectedId) {
  const today = todayISO();
  const licensed = !!state.license?.activatedAt;
  const gateBlocked = state.employees.length >= FREE_EMPLOYEE_LIMIT && !licensed;
  const list = state.employees.map((emp) => {
    const risks = employeeRisks(emp, today);
    const isSel = emp.id === selectedId;
    return `
    <details class="card emp" ${isSel ? 'open' : ''} id="emp-${e(emp.id)}">
      <summary>
        <b>${e(emp.name)}</b><span class="muted">${e(emp.role || '')} · 入职 ${e(emp.hire || '？')}${emp.status === 'left' ? ' · 已离职' : ''}</span>
        ${riskBadgeRow(risks)}
      </summary>
      <div class="emp-body">
        ${risks.length ? `<div class="risk-list">${risks.map(riskCard).join('')}</div>` : '<p class="ok-line">✅ 暂无风险项</p>'}
        ${employeeForm(emp)}
        <div class="btn-row">
          <button class="btn primary" data-action="save-employee" data-id="${e(emp.id)}">保存修改</button>
          <button class="btn" data-action="issue-cert" data-id="${e(emp.id)}">开具离职证明</button>
          <button class="btn danger" data-action="del-employee" data-id="${e(emp.id)}">删除档案</button>
        </div>
      </div>
    </details>`;
  }).join('');

  return `
  ${list || '<section class="card empty"><p>还没有员工档案。第一行记录，就是第一份凭据。</p></section>'}
  <section class="card">
    <h3>＋ 新增员工</h3>
    ${gateBlocked ? `<p class="gate">免费档最多 ${FREE_EMPLOYEE_LIMIT} 名员工。${LICENSE_PRICE_HINT}/年 解锁无限员工与批量导出 —— 到「设置」输入授权码。</p>` : ''}
    ${employeeForm({
      id: 'new', name: '', role: '', hire: today, idCard: '', contractType: 'fixed',
      contractSigned: false, contractStart: today, contractEnd: '', probationEnd: '',
      hadProbationBefore: false, regularSalaryCents: null, probationSalaryCents: null,
      socialInsured: true, status: 'active', leftDate: '', certIssued: false,
    })}
    <div class="btn-row"><button class="btn primary" data-action="add-employee"${gateBlocked ? ' disabled' : ''}>添加员工</button></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// 单据中心
// ---------------------------------------------------------------------------

export function viewDocs(state, selectedId) {
  const today = todayISO();
  const selectable = state.employees.map((x) =>
    `<option value="${e(x.id)}"${x.id === selectedId ? ' selected' : ''}>${e(x.name)}${x.status === 'left' ? '（已离职）' : ''}</option>`).join('');
  return `
  <section class="card">
    <h3>🧾 离职证明（法定义务单据）</h3>
    <p class="muted">《劳动合同法》第五十条：解除或终止劳动合同时必须出具；《实施条例》第二十四条：须写明合同期限、解除/终止日期、工作岗位、工作年限 —— 四要素已内置。</p>
    ${state.employees.length ? `
    <div class="grid">
      <label>员工<select id="doc-emp">${selectable}</select></label>
      <label>证明日期<input id="doc-date" type="date" value="${today}" /></label>
    </div>
    <div class="btn-row">
      <button class="btn primary" data-action="cert-preview">生成预览</button>
      <button class="btn" data-action="cert-download">下载 HTML（可打印盖章）</button>
      <button class="btn" data-action="cert-print">直接打印</button>
      <button class="btn" data-action="cert-copy">复制文本（微信发送）</button>
    </div>
    <textarea id="doc-preview" rows="10" placeholder="点「生成预览」查看证明全文…" readonly></textarea>
    ` : '<p class="muted">先在「员工」页录入员工档案。</p>'}
  </section>

  <section class="card">
    <h3>📋 用工合规自查报告</h3>
    <p class="muted">全员风险清单：逐人列出风险等级、法规依据与整改建议。可用于向合伙人说明，或整改前后对比留档。</p>
    <div class="btn-row">
      <button class="btn primary" data-action="report-preview">生成预览</button>
      <button class="btn" data-action="report-copy">复制文本</button>
      <button class="btn" data-action="report-print">打印</button>
    </div>
    <textarea id="report-preview" rows="10" placeholder="点「生成预览」查看报告全文…" readonly></textarea>
  </section>`;
}

// ---------------------------------------------------------------------------
// 计算器
// ---------------------------------------------------------------------------

export function viewCalc(state) {
  const anyLeft = state.employees.find((x) => x.status === 'left');
  return `
  <section class="card">
    <h3>🧮 经济补偿计算器（N / 2N / N+1）</h3>
    <p class="muted">输入员工的工作起止与月薪，按《劳动合同法》第四十七条计算：每满一年补一个月，六个月以上不满一年按一年，不满六个月补半个月；月薪高于当地社平工资三倍的按三倍封顶且年限封顶十二年。</p>
    <div class="grid">
      <label>入职日期<input id="calc-hire" type="date" value="${e(anyLeft?.hire ?? '')}" /></label>
      <label>离职/终止日期<input id="calc-end" type="date" value="${e(anyLeft?.leftDate ?? todayISO())}" /></label>
      <label>月均工资（元，解除前 12 个月）<input id="calc-salary" value="${anyLeft?.regularSalaryCents != null ? fmtCents(anyLeft.regularSalaryCents) : ''}" placeholder="6000" inputmode="decimal" /></label>
      <label>当地社平工资 3 倍（元/月，不知道就留空）<input id="calc-cap" placeholder="留空 = 不适用三倍封顶" inputmode="decimal" /></label>
      <label>情形
        <select id="calc-kind">
          <option value="n">协商解除/无过失辞退 —— N</option>
          <option value="n1">未提前 30 日书面通知 —— N+1（代通知金）</option>
          <option value="2n">违法解除 —— 2N（赔偿金）</option>
        </select></label>
    </div>
    <div class="btn-row"><button class="btn primary" data-action="calc-run">计算</button></div>
    <div id="calc-result"></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function viewSettings(state) {
  const licensed = !!state.license?.activatedAt;
  return `
  <section class="card">
    <h3>🏢 企业档案</h3>
    <div class="grid">
      <label>企业名称 *<input id="set-name" value="${e(state.company.name)}" placeholder="XX市XX茶饮店（个体工商户）" /></label>
      <label>统一社会信用代码<input id="set-credit" value="${e(state.company.creditCode)}" /></label>
      <label>负责人<input id="set-owner" value="${e(state.company.owner)}" /></label>
      <label>所在城市<input id="set-city" value="${e(state.company.city)}" placeholder="用于匹配属地口径" /></label>
    </div>
    <div class="btn-row"><button class="btn primary" data-action="save-company">保存企业档案</button></div>
  </section>

  <section class="card">
    <h3>🔓 解锁完整版</h3>
    ${licensed ? `
      <p class="ok-line">✅ 已解锁：${e(state.license.name)}（${state.license.activatedAt} 激活）</p>` : `
      <p>免费档最多 ${FREE_EMPLOYEE_LIMIT} 名员工；${LICENSE_PRICE_HINT}/年 解锁无限员工。本 MVP 阶段验证的是付费意愿：填入企业名称与授权码即可解锁（授权码由作者按企业名称生成，验证的是「愿意掏钱」这个动作，不是防盗版）。</p>
      <div class="grid">
        <label>企业名称<input id="lic-name" value="${e(state.company.name)}" /></label>
        <label>授权码<input id="lic-key" placeholder="XXXX-XXXX-XXXX" /></label>
      </div>
      <div class="btn-row"><button class="btn primary" data-action="activate">激活</button></div>`}
  </section>

  <section class="card">
    <h3>💾 数据自持</h3>
    <p class="muted">全部数据只在本机浏览器。换机/备份走导出导入；员工个人信息不进任何服务器。</p>
    <div class="btn-row">
      <button class="btn" data-action="export-json">导出备份 JSON</button>
      <button class="btn" data-action="export-events">导出使用记录</button>
      <label class="btn file-btn">导入备份<input type="file" id="import-file" accept="application/json" hidden /></label>
      <button class="btn" data-action="seed-demo">载入示例数据</button>
      <button class="btn danger" data-action="wipe">清空全部数据</button>
    </div>
  </section>

  <section class="card">
    <h3>⚖️ 口径与边界</h3>
    <ul class="plain">
      <li>风险引擎按主流裁审口径实现（依据逐条标注），各地对二倍工资时效、社平工资口径等存在差异。</li>
      <li>输出为通用合规提示，不构成法律意见；个案请咨询执业律师或属地劳动人事争议仲裁机构。</li>
      <li>本地授权码为验证型实现，防顺手滥用不防刻意破解。</li>
    </ul>
  </section>`;
}
