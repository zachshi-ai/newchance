/**
 * core.test.mjs — 工据 WorkProof 核心逻辑单元测试（node --test，零依赖）
 *
 * 覆盖：日历月运算与月末收敛、含头含尾期限、金额分运算、
 * 试用期四类违法、双倍工资计时（窗口/起算/满一年线/到期续签）、
 * 社保弃保、离职善后、经济补偿 N/2N/N+1 与三倍封顶、
 * 离职证明四要素与确定性输出、自查报告、离线授权码、导入导出与拒绝。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertISO, todayISO, addDays, addMonths, daysUntil,
  monthsBetween, contractMonths, workYearsLabel,
  parseMoneyToCents, fmtCents,
  CONTRACT_TYPES, probationCapMonths, probationFindings,
  signDeadline, doublePayFrom, oneYearLine, contractFindings,
  socialFindings, offboardingFindings, employeeRisks, companyRisks,
  severance, maskIdCard, separationCertText, separationCertHtml,
  complianceReportText, escapeHtml,
  makeLicenseKey, verifyLicenseKey, canAddEmployee, FREE_EMPLOYEE_LIMIT,
  exportBundle, importBundle, STATE_VERSION,
} from '../app/js/core.js';

// ---------------------------------------------------------------------------
// 日期与日历月
// ---------------------------------------------------------------------------

test('assertISO 拒绝非 ISO 格式与假日期', () => {
  assert.throws(() => assertISO('2026-9-1'));
  assert.throws(() => assertISO('2026-02-30')); // 不存在的日期
  assert.throws(() => assertISO(20260901));
  assert.doesNotThrow(() => assertISO('2026-09-01'));
});

test('addDays 跨月与闰年收敛', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
});

test('addMonths 日历月月末收敛（法律期限口径）', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); // 闰年
  assert.equal(addMonths('2026-09-05', -6), '2026-03-05');
  assert.equal(addMonths('2026-12-31', 2), '2027-02-28');
});

test('monthsBetween 与 contractMonths（含头含尾）', () => {
  assert.equal(monthsBetween('2026-01-01', '2027-01-01'), 12);
  assert.equal(monthsBetween('2026-01-31', '2026-02-28'), 0); // 31 日签约 2 月末不满 1 个月
  assert.equal(contractMonths('2026-01-01', '2026-12-31'), 12); // 含头含尾的标准一年期
  assert.equal(contractMonths('2026-01-01', '2026-03-31'), 3);
});

test('签约宽限与双倍工资起算的锚点日期', () => {
  assert.equal(signDeadline('2026-01-31'), '2026-02-28'); // 一个月宽限按日历月
  assert.equal(doublePayFrom('2026-01-31'), '2026-03-01'); // 满月次日
  assert.equal(oneYearLine('2026-01-31'), '2027-01-31');
});

test('workYearsLabel 与 daysUntil', () => {
  assert.equal(workYearsLabel('2024-07-01', '2026-09-01'), '2 年 2 个月');
  assert.equal(daysUntil('2026-09-10', '2026-09-01'), 9);
  assert.equal(daysUntil('2026-08-31', '2026-09-01'), -1);
});

test('todayISO 接受注入时间保证确定性', () => {
  assert.equal(todayISO(new Date(2026, 8, 5, 12, 0, 0)), '2026-09-05');
  assert.equal(todayISO(new Date(2026, 0, 1, 23, 59, 0)), '2026-01-01');
});

// ---------------------------------------------------------------------------
// 金额
// ---------------------------------------------------------------------------

test('parseMoneyToCents 容忍千分位与两位小数，拒绝负数与非法', () => {
  assert.equal(parseMoneyToCents('8000'), 800000);
  assert.equal(parseMoneyToCents('8,000.50'), 800050);
  assert.equal(parseMoneyToCents(8000.55), 800055);
  assert.throws(() => parseMoneyToCents('-5'));
  assert.throws(() => parseMoneyToCents('1.234'));
  assert.throws(() => parseMoneyToCents('abc'));
  assert.throws(() => parseMoneyToCents(''));
});

test('fmtCents 千分位确定性与负数', () => {
  assert.equal(fmtCents(800000), '8,000.00');
  assert.equal(fmtCents(123456789), '1,234,567.89');
  assert.equal(fmtCents(-100), '-1.00');
  assert.throws(() => fmtCents(1.5));
});

// ---------------------------------------------------------------------------
// 试用期红线
// ---------------------------------------------------------------------------

test('probationCapMonths 边界齐全', () => {
  assert.equal(probationCapMonths({ contractType: 'fixed', termMonths: 2 }), 0);
  assert.equal(probationCapMonths({ contractType: 'fixed', termMonths: 3 }), 1);
  assert.equal(probationCapMonths({ contractType: 'fixed', termMonths: 11 }), 1);
  assert.equal(probationCapMonths({ contractType: 'fixed', termMonths: 12 }), 2);
  assert.equal(probationCapMonths({ contractType: 'fixed', termMonths: 35 }), 2);
  assert.equal(probationCapMonths({ contractType: 'fixed', termMonths: 36 }), 6);
  assert.equal(probationCapMonths({ contractType: 'open' }), 6);
  assert.equal(probationCapMonths({ contractType: 'task' }), 0);
  assert.throws(() => probationCapMonths({ contractType: 'fixed', termMonths: null }));
  assert.throws(() => probationCapMonths({ contractType: 'weird' }));
});

const BASE_EMP = {
  id: 'e1', name: '测试', role: '店员', hire: '2026-01-01', status: 'active',
  contractType: 'fixed', contractSigned: true, socialInsured: true, certIssued: true,
};

test('试用期超过法定上限：识别超出期间与赔偿敞口', () => {
  const emp = {
    ...BASE_EMP, contractStart: '2026-03-01', contractEnd: '2027-02-28',
    probationEnd: '2026-08-31', // 一年期合同法定上限 2 个月，却约了 6 个月
  };
  const fs = probationFindings(emp, '2026-09-05');
  const f = fs.find((x) => x.id === 'probation-exceed');
  assert.ok(f, '应发现超上限');
  assert.equal(f.level, 'high');
  assert.ok(f.title.includes('超过法定上限 2 个月'));
  assert.ok(f.why.includes('2026-05-01')); // 超出部分起点
  assert.ok(f.basis[0].includes('第八十三条'));
});

test('不得约定试用期却约定（任务制/短期）', () => {
  const fs = probationFindings({ ...BASE_EMP, contractType: 'task', probationEnd: '2026-06-30' });
  assert.equal(fs.filter((f) => f.id === 'probation-forbidden').length, 1);
  const fs2 = probationFindings({
    ...BASE_EMP, contractType: 'fixed', contractStart: '2026-05-01',
    contractEnd: '2026-06-30', probationEnd: '2026-05-31', // 2 个月合同
  });
  assert.equal(fs2.filter((f) => f.id === 'probation-forbidden').length, 1);
});

test('试用期晚于合同期 + 二次试用期各成一条', () => {
  const fs = probationFindings({
    ...BASE_EMP, contractStart: '2026-01-01', contractEnd: '2026-06-30',
    probationEnd: '2026-07-31', hadProbationBefore: true,
  });
  assert.ok(fs.some((f) => f.id === 'probation-after-term'));
  assert.ok(fs.some((f) => f.id === 'probation-repeat'));
});

test('试用期工资低于转正 80%：等于 80% 不报，低于才报', () => {
  const mk = (probCents) => ({
    ...BASE_EMP, probationEnd: '2026-02-28',
    regularSalaryCents: 600000, probationSalaryCents: probCents,
  });
  assert.ok(!probationFindings(mk(480000)).some((f) => f.id === 'probation-salary'));
  assert.ok(probationFindings(mk(450000)).some((f) => f.id === 'probation-salary'));
});

test('期限信息不全时不误报试用期', () => {
  const fs = probationFindings({ ...BASE_EMP, probationEnd: '2026-02-28' }); // 无合同起止
  assert.deepEqual(fs, []);
});

// ---------------------------------------------------------------------------
// 书面合同
// ---------------------------------------------------------------------------

test('签约窗口内：中危倒计时', () => {
  const emp = { ...BASE_EMP, hire: '2026-08-20', contractSigned: false };
  const fs = contractFindings(emp, '2026-09-05');
  assert.equal(fs.length, 1);
  assert.equal(fs[0].id, 'no-contract-window');
  assert.equal(fs[0].level, 'medium');
  assert.ok(fs[0].title.includes('15 天'));
});

test('超窗未签：高危双倍工资计时，月数按解释二第六条', () => {
  const emp = { ...BASE_EMP, hire: '2026-06-01', contractSigned: false };
  const fs = contractFindings(emp, '2026-09-05');
  const f = fs.find((x) => x.id === 'no-contract-double');
  assert.ok(f);
  assert.equal(f.level, 'high');
  assert.ok(f.title.includes('约 2 个月')); // 07-02 起算至 09-05 → 约 2 个月
  assert.ok(f.why.includes('2026-07-02'));
});

test('满一年未签：11 个月封顶 + 视为无固定期限两条并列', () => {
  const emp = { ...BASE_EMP, hire: '2025-08-01', contractSigned: false };
  const fs = contractFindings(emp, '2026-09-05');
  const f = fs.find((x) => x.id === 'no-contract-double');
  assert.ok(f && f.title.includes('11 个月封顶'));
  assert.ok(fs.some((x) => x.id === 'no-contract-1y'));
});

test('到期未续：一个月内是窗口，超窗是双倍工资', () => {
  const inWindow = contractFindings({
    ...BASE_EMP, hire: '2025-08-26', contractStart: '2025-08-26',
    contractEnd: '2026-08-26', // 到期后 10 天
  }, '2026-09-05');
  assert.ok(inWindow.some((f) => f.id === 'renew-window' && f.title.includes('21 天')));

  const over = contractFindings({
    ...BASE_EMP, hire: '2025-05-01', contractStart: '2025-05-01',
    contractEnd: '2026-06-01', // 到期后 3 个多月
  }, '2026-09-05');
  const f = over.find((x) => x.id === 'renew-double');
  assert.ok(f && f.level === 'high' && f.title.includes('约 2 个月'));
});

test('合同 30 天内到期 → 中危预警；已签且远期 → 无发现', () => {
  const soon = contractFindings({
    ...BASE_EMP, hire: '2023-09-01', contractStart: '2025-09-01',
    contractEnd: '2026-09-25',
  }, '2026-09-05');
  assert.ok(soon.some((f) => f.id === 'contract-expiring' && f.title.includes('20 天')));

  assert.deepEqual(contractFindings({
    ...BASE_EMP, hire: '2026-01-01', contractStart: '2026-01-01',
    contractEnd: '2028-12-31',
  }, '2026-09-05'), []);
});

test('已离职员工不产生合同类发现', () => {
  assert.deepEqual(contractFindings({
    ...BASE_EMP, status: 'left', hire: '2025-01-01', contractSigned: false, leftDate: '2026-08-01',
  }, '2026-09-05'), []);
});

// ---------------------------------------------------------------------------
// 社保与离职善后
// ---------------------------------------------------------------------------

test('未参保高危且引用解释二第十九条', () => {
  const fs = socialFindings({ ...BASE_EMP, socialInsured: false });
  assert.equal(fs.length, 1);
  assert.equal(fs[0].level, 'high');
  assert.ok(fs[0].basis.join().includes('第十九条'));
  assert.deepEqual(socialFindings({ ...BASE_EMP, socialInsured: true }), []);
  assert.deepEqual(socialFindings({ ...BASE_EMP, socialInsured: false, status: 'left' }), []);
});

test('离职未开证明：高危善后项', () => {
  assert.equal(offboardingFindings({ ...BASE_EMP, status: 'left', leftDate: '2026-08-01', certIssued: false }).length, 1);
  assert.deepEqual(offboardingFindings({ ...BASE_EMP, status: 'left', leftDate: '2026-08-01', certIssued: true }), []);
});

test('employeeRisks：高危排前；已离职只保留善后项', () => {
  const messy = {
    ...BASE_EMP, hire: '2026-06-01', contractSigned: false,
    contractStart: '2026-01-01', contractEnd: '2026-09-25',
    probationEnd: '2026-03-31', contractStart2: undefined,
    regularSalaryCents: 600000, probationSalaryCents: 450000,
  };
  const rs = employeeRisks(messy, '2026-09-05');
  assert.ok(rs.length >= 2);
  assert.equal(rs[0].level, 'high');
  const idx = rs.map((r) => r.level);
  assert.deepEqual([...idx].sort(), idx); // high→medium→low 有序

  const left = employeeRisks({
    ...BASE_EMP, status: 'left', leftDate: '2026-08-01', certIssued: false, socialInsured: false,
  }, '2026-09-05');
  assert.equal(left.length, 1);
  assert.equal(left[0].id, 'left-no-cert');
});

test('companyRisks 汇总计数与干净员工', () => {
  const emps = [
    { ...BASE_EMP, id: 'a', socialInsured: false },            // 1 高
    { ...BASE_EMP, id: 'b', hire: '2026-08-20', contractSigned: false }, // 1 中（窗口内）
    { ...BASE_EMP, id: 'c', hire: '2026-01-01', contractSigned: true },  // 干净
  ];
  const c = companyRisks(emps, '2026-09-05');
  assert.equal(c.high, 1);
  assert.equal(c.medium, 1);
  assert.equal(c.cleanEmployees, 1);
});

// ---------------------------------------------------------------------------
// 经济补偿
// ---------------------------------------------------------------------------

test('N：3 年 5 个月 → 3.5 个月补偿', () => {
  const r = severance({ hireISO: '2023-03-10', endISO: '2026-09-05', monthlyCents: 600000 });
  assert.equal(r.workMonths, 41);
  assert.equal(r.yearsLabel, '3 年 5 个月');
  assert.equal(r.units, 3.5);
  assert.equal(r.nCents, 2100000);
  assert.equal(r.totalCents, 2100000);
});

test('六个月规则：满 6 个月按 1 年，5 个月按半月在封顶场景生效', () => {
  const six = severance({ hireISO: '2025-03-01', endISO: '2025-09-01', monthlyCents: 600000 });
  assert.equal(six.units, 1);
  assert.equal(six.nCents, 600000);
  const five = severance({ hireISO: '2025-04-01', endISO: '2025-08-31', monthlyCents: 600000 });
  assert.equal(five.units, 0.5);
  assert.equal(five.nCents, 300000);
});

test('三倍封顶：高薪长年限按社平三倍且 12 年封顶', () => {
  const r = severance({
    hireISO: '2000-01-01', endISO: '2026-01-01',
    monthlyCents: 1200000, socialCapCents: 900000,
  });
  assert.equal(r.workMonths, 312);
  assert.equal(r.cappedBySocial, true);
  assert.equal(r.baseCents, 900000);
  assert.equal(r.units, 12);
  assert.equal(r.nCents, 10800000);
  assert.ok(r.basis.join().includes('三倍封顶'));
});

test('2N 与 N+1：违法解除翻倍；代通知金加一个月且不叠加', () => {
  const args = { hireISO: '2023-03-10', endISO: '2026-09-05', monthlyCents: 600000 };
  assert.equal(severance({ ...args, multiplier: 2 }).totalCents, 4200000);
  const n1 = severance({ ...args, noticeGiven: false });
  assert.equal(n1.extraNoticeCents, 600000);
  assert.equal(n1.totalCents, 2700000);
  const both = severance({ ...args, multiplier: 2, noticeGiven: false });
  assert.equal(both.extraNoticeCents, 0); // 2N 不叠加代通知金
  assert.equal(both.totalCents, 4200000);
  assert.throws(() => severance({ hireISO: '2023-03-10', endISO: '2026-09-05', monthlyCents: 600.5 }));
});

// ---------------------------------------------------------------------------
// 离职证明
// ---------------------------------------------------------------------------

const CERT_COMPANY = { name: '某茶饮店', creditCode: '92350100MA0000000X', owner: '陈某', city: '示例市' };
const CERT_EMP = {
  ...BASE_EMP, name: '芳姐', role: '前厅', hire: '2024-07-01',
  status: 'left', leftDate: '2026-08-26',
  contractType: 'fixed', contractStart: '2024-07-01', contractEnd: '2026-06-30',
};

test('离职证明含实施条例第二十四条四要素且确定性输出', () => {
  const text = separationCertText({ company: CERT_COMPANY, emp: CERT_EMP, todayISOStr: '2026-09-05' });
  assert.ok(text.includes('解除／终止劳动合同证明'));
  assert.ok(text.includes('芳姐'));
  assert.ok(text.includes('2024-07-01 至 2026-06-30')); // 合同期限
  assert.ok(text.includes('2026-08-26'));               // 解除/终止日期
  assert.ok(text.includes('前厅'));                     // 工作岗位
  assert.ok(text.includes('2 年 1 个月'));               // 工作年限
  assert.ok(text.includes('第五十条'));
  assert.ok(text.includes('某茶饮店'));
  const again = separationCertText({ company: CERT_COMPANY, emp: CERT_EMP, todayISOStr: '2026-09-05' });
  assert.equal(text, again);
});

test('离职证明 HTML：单文件、转义注入', () => {
  const html = separationCertHtml({
    company: CERT_COMPANY,
    emp: { ...CERT_EMP, name: '<script>alert(1)</script>' },
    todayISOStr: '2026-09-05',
  });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('离职证明拒绝缺要素：无企业名 / 未登记离职 / 无入职日期', () => {
  assert.throws(() => separationCertText({ company: { name: '' }, emp: CERT_EMP }));
  assert.throws(() => separationCertText({ company: CERT_COMPANY, emp: { ...CERT_EMP, status: 'active', leftDate: '' } }));
  assert.throws(() => separationCertText({ company: CERT_COMPANY, emp: { ...CERT_EMP, hire: '' } }));
});

test('maskIdCard 脱敏', () => {
  assert.equal(maskIdCard('350102199001011234'), '3501**********1234');
  assert.equal(maskIdCard('1234567'), '*******');
  assert.equal(maskIdCard(''), '');
});

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

test('自查报告：汇总、逐人、免责与确定性', () => {
  const emps = [
    { ...BASE_EMP, id: 'a', name: '阿珍', socialInsured: false },
    { ...BASE_EMP, id: 'b', name: '小龙', hire: '2026-01-01', contractSigned: true },
  ];
  const text = complianceReportText({ company: CERT_COMPANY, employees: emps, todayISOStr: '2026-09-05' });
  assert.ok(text.includes('劳动用工合规自查报告'));
  assert.ok(text.includes('高危 1'));
  assert.ok(text.includes('阿珍'));
  assert.ok(text.includes('小龙'));
  assert.ok(text.includes('无风险项'));
  assert.ok(text.includes('不构成法律意见'));
  const again = complianceReportText({ company: CERT_COMPANY, employees: emps, todayISOStr: '2026-09-05' });
  assert.equal(text, again);
});

// ---------------------------------------------------------------------------
// 授权码与免费档
// ---------------------------------------------------------------------------

test('授权码：格式、往返、容错与拒绝', () => {
  const key = makeLicenseKey('小满茶饮店');
  assert.match(key, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(verifyLicenseKey('小满茶饮店', key), true);
  assert.equal(verifyLicenseKey('小满茶饮店', key.toLowerCase().replace(/-/g, ' ')), true);
  assert.equal(verifyLicenseKey('小满茶饮店', 'AAAA-BBBB-CCCC'), false);
  assert.equal(verifyLicenseKey('别家店', key), false);
  assert.throws(() => makeLicenseKey(''));
});

test('免费档闸门', () => {
  assert.equal(canAddEmployee(2, false), true);
  assert.equal(canAddEmployee(FREE_EMPLOYEE_LIMIT, false), false);
  assert.equal(canAddEmployee(99, true), true);
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

function sampleState() {
  return {
    version: STATE_VERSION,
    company: CERT_COMPANY,
    employees: [{ ...BASE_EMP, contractStart: '2026-01-01', contractEnd: '2028-12-31' }],
    license: { name: '', key: '', activatedAt: null },
    events: [],
  };
}

test('导出→导入往返一致', () => {
  const s = sampleState();
  const res = importBundle(exportBundle(s));
  assert.equal(res.ok, true);
  assert.deepEqual(res.state, s);
});

test('导入拒绝：非 JSON / 非本应用 / 高版本 / 结构缺失', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'foodsentry', version: 1, state: sampleState() })).ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'workproof', version: 99, state: sampleState() })).ok, false);
  const bad = sampleState();
  delete bad.employees;
  assert.equal(importBundle(JSON.stringify({ app: 'workproof', version: 1, state: bad })).ok, false);
});

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

test('escapeHtml 覆盖五类字符', () => {
  assert.equal(escapeHtml(`a<b>&"'\``), 'a&lt;b&gt;&amp;&quot;&#39;`');
});

test('CONTRACT_TYPES 三类齐全', () => {
  assert.deepEqual(Object.keys(CONTRACT_TYPES), ['fixed', 'open', 'task']);
});
