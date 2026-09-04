/**
 * app.js — 路由、状态变更、事件委托、示例数据与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, addDays, addMonths, assertISO,
  parseMoneyToCents, fmtCents,
  employeeRisks, severance, complianceReportText,
  separationCertText, separationCertHtml,
  makeLicenseKey, verifyLicenseKey, canAddEmployee, FREE_EMPLOYEE_LIMIT,
  exportBundle, importBundle,
} from './core.js';
import {
  viewDashboard, viewStaff, viewDocs, viewCalc, viewSettings,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();

const NAV = [
  ['#/today', '今日'], ['#/staff', '员工'], ['#/docs', '单据'], ['#/calc', '计算器'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/today').replace(/^#\/?/, '');
  const [path, param] = h.split('/');
  return { path: path || 'today', param };
}

export function render() {
  const { path, param } = parseHash();
  let html = '';
  switch (path) {
    case 'staff': html = viewStaff(state, param); break;
    case 'docs': html = viewDocs(state, param); break;
    case 'calc': html = viewCalc(state); break;
    case 'settings': html = viewSettings(state); break;
    default: html = viewDashboard(state);
  }
  $view.innerHTML = html;
  $nav.innerHTML = NAV.map(([hash, label]) => {
    const base = hash.slice(2);
    const active = path === base || (path === 'today' && base === 'today');
    return `<a href="${hash}" class="${active ? 'active' : ''}">${label}</a>`;
  }).join('');
  window.scrollTo(0, 0);
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { $toast.hidden = true; }, 2600);
}

function commit(trackType, payload) {
  if (trackType) track(state, trackType, payload);
  saveState(state);
  render();
}

const licensed = () => !!state.license?.activatedAt;

// ---------------------------------------------------------------------------
// 员工表单读写
// ---------------------------------------------------------------------------

function readEmployeeForm(id) {
  const val = (f) => document.getElementById(`f-${f}-${id}`)?.value?.trim() ?? '';
  const name = val('name');
  const hire = val('hire');
  if (!name) { toast('请填写员工姓名'); return null; }
  try {
    if (!hire) { toast(`请填写 ${name} 的入职日期`); return null; }
    assertISO(hire);
    const contractStart = val('cstart');
    const contractEnd = val('cend');
    if (contractStart) assertISO(contractStart);
    if (contractEnd) assertISO(contractEnd);
    if (contractStart && contractEnd && contractEnd <= contractStart) {
      toast('合同止日必须晚于合同起日'); return null;
    }
    const probationEnd = val('prob');
    if (probationEnd) {
      assertISO(probationEnd);
      if (probationEnd < hire) { toast('试用期止日不能早于入职日期'); return null; }
    }
    const leftDate = val('left');
    if (leftDate) assertISO(leftDate);
    const rawRegular = val('rsalary');
    const rawProbation = val('psalary');
    const regularSalaryCents = rawRegular ? parseMoneyToCents(rawRegular) : null;
    const probationSalaryCents = rawProbation ? parseMoneyToCents(rawProbation) : null;
    return {
      name,
      role: val('role'),
      hire,
      idCard: val('idcard'),
      contractType: document.getElementById(`f-type-${id}`)?.value || 'fixed',
      contractSigned: (document.getElementById(`f-signed-${id}`)?.value || 'no') === 'yes',
      contractStart: contractStart || '',
      contractEnd: contractEnd || '',
      probationEnd: probationEnd || '',
      hadProbationBefore: (document.getElementById(`f-hadprob-${id}`)?.value || 'no') === 'yes',
      regularSalaryCents,
      probationSalaryCents,
      socialInsured: (document.getElementById(`f-social-${id}`)?.value || 'yes') === 'yes',
      status: (document.getElementById(`f-status-${id}`)?.value || 'active') === 'left' ? 'left' : 'active',
      leftDate: leftDate || '',
      certIssued: (document.getElementById(`f-cert-${id}`)?.value || 'no') === 'yes',
    };
  } catch (err) {
    toast(err?.message || '表单数据不合法');
    return null;
  }
}

// ---------------------------------------------------------------------------
// 员工动作
// ---------------------------------------------------------------------------

function addEmployee() {
  if (!canAddEmployee(state.employees.length, licensed())) {
    toast(`免费档最多 ${FREE_EMPLOYEE_LIMIT} 名员工，到「设置」输入授权码解锁`);
    return;
  }
  const data = readEmployeeForm('new');
  if (!data) return;
  state.employees.push({ id: uid(), note: '', ...data });
  commit('add-employee', { name: data.name });
  toast(`已添加 ${data.name}`);
}

function saveEmployee(id) {
  const emp = state.employees.find((x) => x.id === id);
  if (!emp) return;
  const data = readEmployeeForm(id);
  if (!data) return;
  Object.assign(emp, data);
  commit('update-employee', { id });
  toast('已保存');
}

function delEmployee(id) {
  const i = state.employees.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [emp] = state.employees.splice(i, 1);
  commit('del-employee', { name: emp?.name });
}

// ---------------------------------------------------------------------------
// 文件与剪贴板工具
// ---------------------------------------------------------------------------

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function printHtml(html) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:100%;bottom:100%;width:0;height:0;border:0;';
  iframe.srcdoc = html;
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  };
  document.body.appendChild(iframe);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制到剪贴板');
  }
}

// ---------------------------------------------------------------------------
// 单据动作（生成成功即回写 certIssued，档案与单据不打架）
// ---------------------------------------------------------------------------

function selectedEmployee() {
  const id = document.getElementById('doc-emp')?.value;
  return state.employees.find((x) => x.id === id);
}

function docDate() {
  return document.getElementById('doc-date')?.value || todayISO();
}

function certAction(action) {
  const emp = selectedEmployee();
  if (!emp) { toast('先选择员工'); return; }
  const args = { company: state.company, emp, todayISOStr: docDate() };
  try {
    if (action === 'preview') {
      document.getElementById('doc-preview').value = separationCertText(args);
    } else if (action === 'copy') {
      copyText(separationCertText(args));
    } else if (action === 'download') {
      downloadFile(`离职证明_${emp.name}_${docDate()}.html`, separationCertHtml(args), 'text/html');
      toast('已下载，可直接打印或微信发送');
    } else if (action === 'print') {
      printHtml(separationCertHtml(args));
    }
    if (!emp.certIssued) {
      emp.certIssued = true;
      track(state, 'issue-cert', { id: emp.id });
      saveState(state);
    }
  } catch (err) {
    toast(err?.message || '无法生成离职证明');
  }
}

function reportAction(action) {
  const text = complianceReportText({ company: state.company, employees: state.employees, todayISOStr: todayISO() });
  if (action === 'preview') {
    document.getElementById('report-preview').value = text;
  } else if (action === 'copy') {
    copyText(text);
  } else if (action === 'print') {
    printHtml(`<pre style="font:13px/1.7 'PingFang SC','Microsoft YaHei',monospace; white-space:pre-wrap; padding:24px;">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`);
  }
  track(state, 'report', { action });
  saveState(state);
}

// ---------------------------------------------------------------------------
// 计算器
// ---------------------------------------------------------------------------

function runCalc() {
  const out = document.getElementById('calc-result');
  const hire = document.getElementById('calc-hire')?.value;
  const end = document.getElementById('calc-end')?.value;
  const kind = document.getElementById('calc-kind')?.value || 'n';
  try {
    if (!hire || !end) { toast('请填写入职与离职日期'); return; }
    const salaryCents = parseMoneyToCents(document.getElementById('calc-salary')?.value);
    const capRaw = document.getElementById('calc-cap')?.value?.trim();
    const r = severance({
      hireISO: hire,
      endISO: end,
      monthlyCents: salaryCents,
      socialCapCents: capRaw ? parseMoneyToCents(capRaw) : null,
      multiplier: kind === '2n' ? 2 : 1,
      noticeGiven: kind !== 'n1',
    });
    const lines = [];
    lines.push(`<p>工龄：<b>${r.yearsLabel}</b>（${r.workMonths} 个月）→ 补偿月数 <b>${r.units % 1 ? r.units.toFixed(1) : r.units}</b> 个月</p>`);
    lines.push(`<p>计算基数：<b>${fmtCents(r.baseCents)}</b> 元/月${r.cappedBySocial ? `（高于社平三倍，按三倍封顶 ${fmtCents(r.baseCents)} 计发，年限封顶 12 年）` : ''}</p>`);
    if (kind === '2n') {
      lines.push(`<p>违法解除赔偿金 2N = <b>${fmtCents(r.totalCents)}</b> 元</p>`);
    } else {
      lines.push(`<p>N = <b>${fmtCents(r.nCents)}</b> 元${r.extraNoticeCents ? `；代通知金 +1 = <b>${fmtCents(r.extraNoticeCents)}</b> 元` : ''}</p>`);
      lines.push(`<p>合计：<b>${fmtCents(r.totalCents)}</b> 元</p>`);
    }
    lines.push(`<p class="muted small">依据：${r.basis.map((b) => escape(b)).join('；')}。本计算为通用口径估算，未计入加班费、年终奖分摊等争议变量，不构成法律意见。</p>`);
    out.innerHTML = `<div class="calc-result">${lines.join('')}</div>`;
    track(state, 'calc', { kind });
    saveState(state);
  } catch (err) {
    toast(err?.message || '计算失败，请检查输入');
  }
}

function escape(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------------------------------------------------------------------------
// 设置动作
// ---------------------------------------------------------------------------

function saveCompany() {
  const val = (id) => document.getElementById(id)?.value?.trim() ?? '';
  if (!val('set-name')) { toast('企业名称不能为空'); return; }
  state.company = {
    name: val('set-name'),
    creditCode: val('set-credit'),
    owner: val('set-owner'),
    city: val('set-city'),
  };
  commit('save-company');
  toast('企业档案已保存');
}

function activate() {
  const name = document.getElementById('lic-name')?.value?.trim();
  const key = document.getElementById('lic-key')?.value?.trim();
  if (!name || !key) { toast('请填写企业名称与授权码'); return; }
  if (!verifyLicenseKey(name, key)) {
    toast('授权码与企业名称不匹配，请核对（授权码按企业名称生成）');
    track(state, 'activate-fail');
    saveState(state);
    return;
  }
  state.license = { name, key, activatedAt: todayISO() };
  commit('activate', { name });
  toast('已解锁完整版，感谢支持');
}

function dataAction(action, file) {
  if (action === 'export-json') {
    downloadFile(`工据备份_${todayISO()}.json`, exportBundle(state), 'application/json');
    toast('备份已导出');
  } else if (action === 'export-events') {
    downloadFile(`工据使用记录_${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
    toast('使用记录已导出');
  } else if (action === 'import-json' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importBundle(String(reader.result));
      if (!res.ok) { toast(`导入失败：${res.error}`); return; }
      state = { ...emptyState(), ...res.state };
      commit('import');
      toast('导入成功');
    };
    reader.readAsText(file);
  } else if (action === 'wipe') {
    if (confirm('确定清空全部数据？此操作不可恢复（建议先导出备份）。')) {
      state = emptyState();
      commit('wipe');
      toast('已清空');
    }
  }
}

// ---------------------------------------------------------------------------
// 示例数据（30 秒体验完整风险台 → 单据 → 计算器）
// ---------------------------------------------------------------------------

export function seedDemo() {
  const today = todayISO();
  state.company = {
    name: '示例 · 小满茶饮店（个体工商户）',
    creditCode: '92350100MA0000000X',
    owner: '陈小满',
    city: '示例市',
  };
  // 五个典型画像：未签合同计时中 / 到期预警 / 试用期违法+未参保 / 离职未开证明 / 干净档案
  const hire2mAgo = addMonths(today, -2);
  const c3yEnd = addDays(today, 20);
  const c3yStart = addDays(addMonths(c3yEnd, -36), 1);
  const start12m = addMonths(today, -5);
  state.employees = [
    {
      id: uid(), name: '阿珍', role: '店员', hire: hire2mAgo, idCard: '',
      contractType: 'fixed', contractSigned: false, contractStart: '', contractEnd: '',
      probationEnd: '', hadProbationBefore: false,
      regularSalaryCents: 380000, probationSalaryCents: null,
      socialInsured: true, status: 'active', leftDate: '', certIssued: false, note: '亲戚介绍，先干着',
    },
    {
      id: uid(), name: '大伟', role: '厨师', hire: c3yStart, idCard: '',
      contractType: 'fixed', contractSigned: true, contractStart: c3yStart, contractEnd: c3yEnd,
      probationEnd: addDays(addMonths(c3yStart, 2), -1), hadProbationBefore: false,
      regularSalaryCents: 700000, probationSalaryCents: 560000,
      socialInsured: true, status: 'active', leftDate: '', certIssued: false, note: '三年合同即将到期',
    },
    {
      id: uid(), name: '阿豪', role: '仓管', hire: start12m, idCard: '',
      contractType: 'fixed', contractSigned: true, contractStart: start12m,
      contractEnd: addDays(addMonths(start12m, 12), -1),
      probationEnd: addDays(addMonths(start12m, 6), -1), hadProbationBefore: false,
      regularSalaryCents: 600000, probationSalaryCents: 450000,
      socialInsured: false, status: 'active', leftDate: '', certIssued: false, note: '本人签了自愿弃保承诺（无效）',
    },
    {
      id: uid(), name: '芳姐', role: '前厅', hire: addMonths(today, -14), idCard: '',
      contractType: 'fixed', contractSigned: true,
      contractStart: addMonths(today, -14), contractEnd: addDays(addMonths(today, -2), -1),
      probationEnd: addDays(addMonths(addMonths(today, -14), 2), -1), hadProbationBefore: false,
      regularSalaryCents: 420000, probationSalaryCents: null,
      socialInsured: true, status: 'left', leftDate: addDays(today, -10), certIssued: false, note: '回老家，证明一直没开',
    },
    {
      id: uid(), name: '小龙', role: '奶茶师', hire: addMonths(today, -8), idCard: '',
      contractType: 'fixed', contractSigned: true, contractStart: addMonths(today, -8),
      contractEnd: addDays(addMonths(today, 28), -1),
      probationEnd: addDays(addMonths(addMonths(today, -8), 2), -1), hadProbationBefore: false,
      regularSalaryCents: 520000, probationSalaryCents: null,
      socialInsured: true, status: 'active', leftDate: '', certIssued: false, note: '',
    },
  ];
  commit('seed-demo');
}

// ---------------------------------------------------------------------------
// 事件委托与启动
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action, id } = el.dataset;
  switch (action) {
    case 'add-employee': addEmployee(); break;
    case 'save-employee': saveEmployee(id); break;
    case 'del-employee': if (confirm('确定删除该员工档案？')) delEmployee(id); break;
    case 'issue-cert': {
      const emp = state.employees.find((x) => x.id === id);
      if (emp && emp.status !== 'left') { toast('在职员工无需离职证明；先在档案中登记离职'); break; }
      location.hash = `#/docs/${id}`;
      break;
    }
    case 'cert-preview': certAction('preview'); break;
    case 'cert-download': certAction('download'); break;
    case 'cert-print': certAction('print'); break;
    case 'cert-copy': certAction('copy'); break;
    case 'report-preview': reportAction('preview'); break;
    case 'report-copy': reportAction('copy'); break;
    case 'report-print': reportAction('print'); break;
    case 'calc-run': runCalc(); break;
    case 'save-company': saveCompany(); break;
    case 'activate': activate(); break;
    case 'export-json': dataAction('export-json'); break;
    case 'export-events': dataAction('export-events'); break;
    case 'seed-demo': seedDemo(); break;
    case 'wipe': dataAction('wipe'); break;
    default: break;
  }
});

document.addEventListener('change', (ev) => {
  if (ev.target?.id === 'import-file') dataAction('import-json', ev.target.files?.[0]);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 离线增强失败不影响功能 */ });
}

window.addEventListener('hashchange', render);

render();
