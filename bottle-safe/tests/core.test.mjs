/**
 * tests/core.test.mjs — 瓶安单 BottleSafe 纯逻辑层单元测试（node --test，零依赖）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertISO, todayISO, addDays, daysUntil, fmtYuan, escapeHtml,
  CYLINDER_SPECS, CHECK_ITEMS, ITEM_VALUES, DEFAULT_PARAMS, paramsOf,
  addUser, removeUser,
  recordDelivery, removeDelivery, userBalance, conservation,
  recordCheck, removeCheck, openRisks,
  annualStatus, addCylinder, removeCylinder, cylinderStatus,
  addWorker, removeWorker, certAudit,
  continuityAudit, complianceAudit,
  slipText, checkLedgerText, deliveryLedgerText, slipHtml, inspectionHtml,
  STATE_VERSION, exportBundle, importBundle,
} from '../app/js/core.js';

const T = '2026-09-05'; // 测试锚定日期，不依赖墙钟

function mkState() {
  return {
    version: STATE_VERSION,
    station: { name: '测试供应站', licenseNo: 'TEST-001', phone: '13800000000' },
    users: [],
    cylinders: [],
    workers: [],
    deliveries: [],
    checks: [],
    settings: {},
    events: [],
  };
}

function addU(state, over = {}) {
  return addUser(state, {
    id: over.id ?? 'u1',
    name: over.name ?? '王建国',
    phone: over.phone ?? '13700000000',
    addr: over.addr ?? '幸福路 12 号',
    specs: over.specs ?? ['15kg'],
    note: '',
  });
}

function del(state, over = {}) {
  return recordDelivery(state, {
    id: over.id ?? 'd1',
    dateISO: over.dateISO ?? T,
    userId: over.userId ?? 'u1',
    lines: over.lines ?? [{ spec: '15kg', full: 2, empty: 1 }],
    amountCents: 'amountCents' in over ? over.amountCents : null,
    note: over.note ?? '',
  });
}

const OK_ITEMS = { hose: 'ok', valve: 'ok', cylinder: 'ok', stove: 'ok', vent: 'ok' };

function chk(state, over = {}) {
  return recordCheck(state, {
    id: over.id ?? 'c1',
    dateISO: over.dateISO ?? T,
    userId: over.userId ?? 'u1',
    checker: over.checker ?? '刘安检',
    items: over.items ?? OK_ITEMS,
    measure: over.measure ?? null,
    recheckOf: over.recheckOf ?? null,
    note: over.note ?? '',
  });
}

// ---------------------------------------------------------------------------
// 日期与工具
// ---------------------------------------------------------------------------

test('assertISO 拒绝非法日期，接受闰年', () => {
  assert.throws(() => assertISO('2026-9-5'));
  assert.throws(() => assertISO(20260905));
  assert.doesNotThrow(() => assertISO('2028-02-29'));
  assert.throws(() => assertISO('2027-02-29'));
});

test('addDays 跨月/跨年收敛；daysUntil 口径正确', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysUntil('2026-12-31', T), 117);
  assert.equal(daysUntil('2026-09-04', T), -1);
});

test('fmtYuan 只吃整数分；escapeHtml 转义五个危险字符', () => {
  assert.equal(fmtYuan(42000), '¥420.00');
  assert.equal(fmtYuan(305), '¥3.05');
  assert.throws(() => fmtYuan(12.5));
  assert.equal(escapeHtml('<script>&"\'</script>'), '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
});

// ---------------------------------------------------------------------------
// 用户档案
// ---------------------------------------------------------------------------

test('addUser：名称必填、瓶型过滤与默认；removeUser 有记录拒绝', () => {
  const s = mkState();
  assert.throws(() => addUser(s, { id: 'x', name: '  ' }), /名称必填/);
  const u = addU(s, { specs: ['50kg', 'weird'] });
  assert.deepEqual(u.specs, ['50kg']);
  assert.deepEqual(addU(s, { id: 'u2', specs: [] }).specs, ['15kg']);
  assert.throws(() => addUser(s, { id: 'u3', specs: ['weird'] }).specs, undefined); // 默认 15kg
  del(s);
  assert.throws(() => removeUser(s, 'u1'), /不可删除/);
  removeUser(s, 'u2');
  assert.throws(() => removeUser(s, 'ghost'), /不存在/);
});

// ---------------------------------------------------------------------------
// 配送落账（守恒账）
// ---------------------------------------------------------------------------

test('recordDelivery：空行拒绝、未知瓶型拒绝、重复瓶型拒绝、取值校验', () => {
  const s = mkState();
  addU(s);
  assert.throws(() => del(s, { lines: [] }), /至少包含一个瓶型行/);
  assert.throws(() => del(s, { lines: [{ spec: '12kg', full: 1, empty: 0 }] }), /未知瓶型/);
  assert.throws(() => del(s, {
    lines: [
      { spec: '15kg', full: 1, empty: 0 },
      { spec: '15kg', full: 0, empty: 1 },
    ],
  }), /重复出现/);
  assert.throws(() => del(s, { lines: [{ spec: '15kg', full: -1, empty: 0 }] }), /非负整数/);
  assert.throws(() => del(s, { lines: [{ spec: '15kg', full: 1.5, empty: 0 }] }), /非负整数/);
  assert.throws(() => del(s, { lines: [{ spec: '15kg', full: 0, empty: 0 }] }), /至少送出或收回/);
  assert.throws(() => del(s, { lines: [{ spec: '15kg', full: 1, empty: 0 }], amountCents: 12.5 }), /整数分/);
  assert.throws(() => del(s, { userId: 'ghost' }), /用户不存在/);
});

test('守恒账：在户瓶数 = 送出 − 收回；超收整单拒绝不部分入账', () => {
  const s = mkState();
  addU(s);
  del(s, { id: 'd-a', lines: [{ spec: '15kg', full: 3, empty: 1 }] });
  assert.equal(userBalance(s, 'u1', '15kg'), 2);
  assert.throws(() => del(s, { id: 'd-b', lines: [{ spec: '15kg', full: 0, empty: 3 }] }), /超收拒绝/);
  assert.equal(s.deliveries.length, 1);              // 整单未入账
  assert.equal(userBalance(s, 'u1', '15kg'), 2);
  // 瓶型独立守恒
  del(s, { id: 'd-c', lines: [{ spec: '50kg', full: 1, empty: 1 }] });
  assert.equal(userBalance(s, 'u1', '50kg'), 0);
  assert.equal(userBalance(s, 'u1', '15kg'), 2);
});

test('removeDelivery：撤销精确回滚；撤销导致负数守卫拒绝', () => {
  const s = mkState();
  addU(s);
  del(s, { id: 'd-a', lines: [{ spec: '15kg', full: 2, empty: 0 }] });
  del(s, { id: 'd-b', lines: [{ spec: '15kg', full: 0, empty: 2 }] });
  assert.equal(userBalance(s, 'u1', '15kg'), 0);
  assert.throws(() => removeDelivery(s, 'd-a'), /在户瓶数为负/);   // 先撤送出 → 后面收回变负
  removeDelivery(s, 'd-b');
  assert.equal(userBalance(s, 'u1', '15kg'), 2);
  removeDelivery(s, 'd-a');
  assert.equal(userBalance(s, 'u1', '15kg'), 0);
  assert.throws(() => removeDelivery(s, 'ghost'), /不存在/);
});

test('conservation：净送出 = 在户瓶数合计（多用户多瓶型残差恒 0）', () => {
  const s = mkState();
  addU(s);
  addU(s, { id: 'u2', name: '李大姐餐馆' });
  del(s, { id: 'd-a', lines: [{ spec: '15kg', full: 3, empty: 1 }, { spec: '50kg', full: 1, empty: 0 }] });
  del(s, { id: 'd-b', userId: 'u2', lines: [{ spec: '50kg', full: 2, empty: 2 }] });
  const cons = conservation(s);
  assert.equal(cons.fullOut, 3);
  assert.equal(cons.balances, 3);
  assert.equal(cons.residual, 0);
});

// ---------------------------------------------------------------------------
// 入户安检（隐患 → 整改 → 复访销案）
// ---------------------------------------------------------------------------

test('recordCheck：五项逐项必检；取值合法；全 na 拒绝', () => {
  const s = mkState();
  addU(s);
  const missing = { ...OK_ITEMS };
  delete missing.vent;
  assert.throws(() => chk(s, { items: missing }), /未检查/);
  assert.throws(() => chk(s, { items: { ...OK_ITEMS, hose: 'maybe' } }), /取值非法/);
  assert.throws(() => chk(s, { items: { hose: 'na', valve: 'na', cylinder: 'na', stove: 'na', vent: 'na' } }), /全不适用/);
  assert.throws(() => chk(s, { userId: 'ghost' }), /用户不存在/);
});

test('recordCheck：隐患必须登记整改措施；正常落账不带整改', () => {
  const s = mkState();
  addU(s);
  assert.throws(() => chk(s, { items: { ...OK_ITEMS, hose: 'risk' } }), /必须登记整改措施/);
  const bad = chk(s, {
    id: 'c-bad', items: { ...OK_ITEMS, hose: 'risk', valve: 'risk' },
    measure: { action: '限期更换软管', detail: '已发告知单' },
  });
  assert.equal(bad.verdict, 'risk');
  assert.deepEqual(bad.riskItems, ['hose', 'valve']);
  assert.equal(bad.measure.action, '限期更换软管');
  const ok = chk(s, { id: 'c-ok' });
  assert.equal(ok.verdict, 'ok');
  assert.equal(ok.measure, null);
});

test('闭环链：隐患入列未闭环 → 合格复访销案；复访仍有隐患接棒', () => {
  const s = mkState();
  addU(s);
  chk(s, { id: 'c-a', dateISO: T, items: { ...OK_ITEMS, hose: 'risk' }, measure: { action: '限期更换软管' } });
  assert.equal(openRisks(s).length, 1);
  chk(s, { id: 'c-b', dateISO: addDays(T, 3), items: { ...OK_ITEMS, hose: 'risk' }, recheckOf: 'c-a', measure: { action: '继续整改' } });
  const open = openRisks(s);
  assert.equal(open.length, 1);
  assert.equal(open[0].check.id, 'c-b');             // 接棒
  chk(s, { id: 'c-c', dateISO: addDays(T, 6), items: OK_ITEMS, recheckOf: 'c-b' });
  assert.equal(openRisks(s).length, 0);
});

test('闭环链：非法复访逐项拒绝（未知单/异户/非隐患/日期早于原单/重复复访）', () => {
  const s = mkState();
  addU(s);
  addU(s, { id: 'u2', name: '李大姐餐馆' });
  assert.throws(() => chk(s, { id: 'c-x', recheckOf: 'ghost' }), /不存在/);
  chk(s, { id: 'c-ok' });
  assert.throws(() => chk(s, { id: 'c-x', recheckOf: 'c-ok' }), /只有隐患单需要复访/);
  chk(s, { id: 'c-a', items: { ...OK_ITEMS, hose: 'risk' }, measure: { action: '限期更换软管' } });
  assert.throws(() => chk(s, { id: 'c-x', userId: 'u2', recheckOf: 'c-a' }), /同户/);
  assert.throws(() => chk(s, { id: 'c-x', dateISO: addDays(T, -1), recheckOf: 'c-a' }), /不得早于/);
  chk(s, { id: 'c-b', dateISO: T, recheckOf: 'c-a' });
  assert.throws(() => chk(s, { id: 'c-x', dateISO: T, recheckOf: 'c-a' }), /已被复访/);
});

test('removeCheck：被复访引用的隐患单不可删；删复访单重新打开原隐患', () => {
  const s = mkState();
  addU(s);
  chk(s, { id: 'c-a', items: { ...OK_ITEMS, hose: 'risk' }, measure: { action: '限期更换软管' } });
  chk(s, { id: 'c-b', recheckOf: 'c-a' });
  assert.throws(() => removeCheck(s, 'c-a'), /不可删除/);
  removeCheck(s, 'c-b');
  assert.equal(openRisks(s).length, 1);
  removeCheck(s, 'c-a');
  assert.equal(openRisks(s).length, 0);
  assert.throws(() => removeCheck(s, 'ghost'), /不存在/);
});

// ---------------------------------------------------------------------------
// 周期台账：年度安检 / 钢瓶检验 / 员工证件
// ---------------------------------------------------------------------------

test('annualStatus：从未/逾期/临期/正常四态与排序', () => {
  const s = mkState();
  addU(s);                                            // u1：从未安检
  addU(s, { id: 'u2', name: '李大姐餐馆' });
  addU(s, { id: 'u3', name: '赵茶馆' });
  addU(s, { id: 'u4', name: '孙家用户' });
  chk(s, { id: 'c-1', userId: 'u2', dateISO: addDays(T, -400) });  // 逾期 35 天
  chk(s, { id: 'c-2', userId: 'u3', dateISO: addDays(T, -340) });  // 25 天内到期 → due
  chk(s, { id: 'c-3', userId: 'u4', dateISO: addDays(T, -100) });  // 正常
  const st = annualStatus(s, T, s.settings);
  const byUser = new Map(st.map((x) => [x.user.id, x]));
  assert.equal(byUser.get('u1').status, 'none');
  assert.equal(byUser.get('u2').status, 'overdue');
  assert.equal(byUser.get('u2').dueIn, -35);
  assert.equal(byUser.get('u3').status, 'due');
  assert.equal(byUser.get('u4').status, 'ok');
  assert.equal(st[0].user.id, 'u2');                 // 逾期（dueIn 为负）排最前
  assert.equal(st[1].user.id, 'u1');                 // 从未安检次之
});

test('addCylinder：瓶号/瓶型/到期日必填；cylinderStatus 过期与 90 天窗边界', () => {
  const s = mkState();
  assert.throws(() => addCylinder(s, { id: 'x', code: '  ', spec: '15kg', checkDueISO: T }), /瓶号必填/);
  assert.throws(() => addCylinder(s, { id: 'x', code: 'A', spec: '12kg', checkDueISO: T }), /未知瓶型/);
  assert.throws(() => addCylinder(s, { id: 'x', code: 'A', spec: '15kg', checkDueISO: '2026/9/5' }), /非法日期/);
  addCylinder(s, { id: 'c1', code: 'YSP-1', spec: '15kg', checkDueISO: addDays(T, -1) });
  addCylinder(s, { id: 'c2', code: 'YSP-2', spec: '50kg', checkDueISO: addDays(T, 90) });   // 恰在窗沿 → 临期
  addCylinder(s, { id: 'c3', code: 'YSP-3', spec: '15kg', checkDueISO: addDays(T, 91) });   // 窗外 → 正常
  const st = cylinderStatus(s, T, s.settings);
  assert.deepEqual(st.overdue.map((c) => c.id), ['c1']);
  assert.deepEqual(st.expiring.map((c) => c.id), ['c2']);
  removeCylinder(s, 'c3');
  assert.throws(() => removeCylinder(s, 'ghost'), /不存在/);
});

test('addWorker：到期日必填；certAudit 过期红线与 30 天预警窗边界', () => {
  const s = mkState();
  assert.throws(() => addWorker(s, { id: 'w0', name: '  ', certExpiryISO: T }), /姓名必填/);
  assert.throws(() => addWorker(s, { id: 'w0', name: 'A', certExpiryISO: '2026/09/05' }), /非法日期/);
  addWorker(s, { id: 'w1', name: '张送气', role: '送气工', certExpiryISO: addDays(T, -1) });
  addWorker(s, { id: 'w2', name: '刘安检', role: '安检员', certExpiryISO: addDays(T, 30) });
  addWorker(s, { id: 'w3', name: '王帮工', role: '', certExpiryISO: addDays(T, 31) });
  const audit = certAudit(s, T, s.settings);
  assert.deepEqual(audit.expired.map((x) => x.id), ['w1']);
  assert.deepEqual(audit.expiring.map((x) => x.id), ['w2']);
  removeWorker(s, 'w3');
  assert.throws(() => removeWorker(s, 'ghost'), /不存在/);
});

// ---------------------------------------------------------------------------
// 断更体检与合规自查
// ---------------------------------------------------------------------------

test('continuityAudit：自首单起逐日核对、今日不点名、回看窗收敛', () => {
  const s = mkState();
  assert.deepEqual(continuityAudit(s, T, s.settings), { checkedDays: 0, missingDates: [] });
  addU(s);
  del(s, { id: 'd1', dateISO: addDays(T, -5) });
  del(s, { id: 'd2', dateISO: addDays(T, -3) });
  const c = continuityAudit(s, T, s.settings);
  assert.equal(c.checkedDays, 5);
  assert.deepEqual(c.missingDates, [addDays(T, -4), addDays(T, -2), addDays(T, -1)]);
});

test('complianceAudit：未闭环/到期/瓶检/证件/断更五查 + 守恒一次点名', () => {
  const s = mkState();
  addU(s);
  addWorker(s, { id: 'w1', name: '张送气', role: '', certExpiryISO: addDays(T, -2) });
  addCylinder(s, { id: 'c1', code: 'YSP-1', spec: '15kg', checkDueISO: addDays(T, -2) });
  del(s, { id: 'd1', dateISO: addDays(T, -2), lines: [{ spec: '15kg', full: 1, empty: 0 }] });
  chk(s, { id: 'c1', dateISO: addDays(T, -2), items: { ...OK_ITEMS, hose: 'risk' }, measure: { action: '限期更换软管' } });
  chk(s, { id: 'c2', dateISO: T });
  const audit = complianceAudit(s, T);
  assert.equal(audit.openRisks.length, 1);
  assert.equal(audit.certs.expired.length, 1);
  assert.equal(audit.cylinders.overdue.length, 1);
  assert.equal(audit.missingDates.length, 1);
  assert.equal(audit.conservation.residual, 0);
});

// ---------------------------------------------------------------------------
// 台账导出（告知单 / 台账文本 / 迎检打印包）
// ---------------------------------------------------------------------------

test('slipText：隐患告知单含整改与停气条款；合格单为回执口径；确定性', () => {
  const s = mkState();
  addU(s);
  chk(s, { id: 'c-ok' });
  chk(s, {
    id: 'c-risk', items: { ...OK_ITEMS, hose: 'risk' },
    measure: { action: '限期更换软管', detail: '三日内复访' },
  });
  const risk = slipText({ state: s, checkId: 'c-risk', todayISOStr: T });
  assert.equal(risk, slipText({ state: s, checkId: 'c-risk', todayISOStr: T }));
  assert.ok(risk.includes('隐患告知单'));
  assert.ok(risk.includes('限期更换软管'));
  assert.ok(risk.includes('停止供气'));
  assert.ok(risk.includes('TEST-001'));
  const ok = slipText({ state: s, checkId: 'c-ok', todayISOStr: T });
  assert.ok(ok.includes('安检回执'));
  assert.ok(ok.includes('各项正常'));
});

test('checkLedgerText / deliveryLedgerText：确定性输出，含许可证号与守恒口径', () => {
  const s = mkState();
  addU(s);
  del(s, { id: 'd1', lines: [{ spec: '15kg', full: 2, empty: 1 }], amountCents: 24000 });
  chk(s, { id: 'c1', items: { ...OK_ITEMS, hose: 'risk' }, measure: { action: '限期更换软管' } });
  chk(s, { id: 'c2', recheckOf: 'c1' });
  const ct = checkLedgerText({ state: s, todayISOStr: T });
  assert.equal(ct, checkLedgerText({ state: s, todayISOStr: T }));
  assert.ok(ct.includes('TEST-001'));
  assert.ok(ct.includes('隐患'));
  assert.ok(ct.includes('（复访）'));
  const dt = deliveryLedgerText({ state: s, todayISOStr: T });
  assert.equal(dt, deliveryLedgerText({ state: s, todayISOStr: T }));
  assert.ok(dt.includes('送2/收1'));
  assert.ok(dt.includes('¥240.00'));
});

test('slipHtml：单文件无外部资源、转义用户名注入、含签字栏与站点落款', () => {
  const s = mkState();
  addU(s, { name: '<script>alert(1)</script>' });
  chk(s, { id: 'c-risk', items: { ...OK_ITEMS, hose: 'risk' }, measure: { action: '限期更换软管' } });
  const html = slipHtml({ state: s, checkId: 'c-risk', todayISOStr: T });
  assert.ok(!html.includes('http://'));
  assert.ok(!html.includes('https://'));
  assert.ok(!html.includes('<script src='));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('用户确认'));
  assert.ok(html.includes('隐患告知单'));
});

test('inspectionHtml：无外部资源、转义站点名注入、含守恒体检/到期点名/瓶检/证件', () => {
  const s = mkState();
  s.station.name = '<script>alert(1)</script>';
  addU(s);
  addU(s, { id: 'u2', name: '赵茶馆' });               // 从未安检 → 到期点名演示
  addWorker(s, { id: 'w1', name: '张送气', role: '', certExpiryISO: addDays(T, -1) });
  addCylinder(s, { id: 'cyl1', code: 'YSP-1', spec: '15kg', checkDueISO: addDays(T, -1) });
  del(s, { id: 'd1', lines: [{ spec: '15kg', full: 2, empty: 1 }] });
  chk(s, { id: 'c1', items: { ...OK_ITEMS, hose: 'risk' }, measure: { action: '限期更换软管' } });
  const html = inspectionHtml({ state: s, todayISOStr: T });
  assert.ok(!html.includes('http://'));
  assert.ok(!html.includes('https://'));
  assert.ok(!html.includes('rel="stylesheet" href='));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('守恒体检'));
  assert.ok(html.includes('已超期'));
  assert.ok(html.includes('已过期'));
  assert.ok(html.includes('从未安检'));
  assert.equal(html, inspectionHtml({ state: s, todayISOStr: T }));   // 确定性
});

// ---------------------------------------------------------------------------
// 数据导入导出
// ---------------------------------------------------------------------------

test('exportBundle/importBundle 往返一致', () => {
  const s = mkState();
  addU(s);
  addCylinder(s, { id: 'cyl1', code: 'YSP-1', spec: '15kg', checkDueISO: T });
  addWorker(s, { id: 'w1', name: '张送气', role: '', certExpiryISO: T });
  del(s);
  chk(s);
  const restored = importBundle(exportBundle(s));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state, s);
});

test('importBundle 拒绝坏 JSON / 错应用 / 高版本 / 缺结构', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle('{"app":"agriledger","version":1,"state":{}}').ok, false);
  assert.equal(importBundle('{"app":"bottlesafe","version":99,"state":{}}').ok, false);
  const bad = importBundle('{"app":"bottlesafe","version":1,"state":{"station":{}}}');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /结构不完整/);
});

// ---------------------------------------------------------------------------
// 边界与覆盖（周期参数化、留痕细节、空状态、向前兼容）
// ---------------------------------------------------------------------------

test('recordDelivery：非法日期拒绝；多瓶型混合落账与撤销回滚', () => {
  const s = mkState();
  addU(s);
  assert.throws(() => del(s, { dateISO: '2026/09/05' }), /非法日期/);
  del(s, { id: 'd-a', lines: [{ spec: '15kg', full: 2, empty: 0 }, { spec: '50kg', full: 1, empty: 1 }] });
  assert.equal(userBalance(s, 'u1', '15kg'), 2);
  assert.equal(userBalance(s, 'u1', '50kg'), 0);
  removeDelivery(s, 'd-a');
  assert.equal(userBalance(s, 'u1', '15kg'), 0);
});

test('conservation：空账本为 0/0/0；userBalance 无流水用户为 0', () => {
  const s = mkState();
  assert.deepEqual(conservation(s), { fullOut: 0, balances: 0, residual: 0 });
  addU(s);
  assert.equal(userBalance(s, 'u1', '15kg'), 0);
  assert.equal(userBalance(s, 'ghost', '15kg'), 0);
});

test('recordCheck：整改说明与备注照抄留痕；复访与原单同日允许', () => {
  const s = mkState();
  addU(s);
  chk(s, { id: 'c-a', items: { ...OK_ITEMS, valve: 'risk' }, measure: { action: '更换减压阀', detail: '  三日内复访  ' }, note: ' 已当面提醒 ' });
  assert.equal(s.checks[0].measure.detail, '三日内复访');
  assert.equal(s.checks[0].note, '已当面提醒');
  assert.doesNotThrow(() => chk(s, { id: 'c-b', dateISO: T, recheckOf: 'c-a' }));   // 同日复访合法
});

test('annualStatus：恰满周期当天为临期（dueIn 0），自定义周期覆盖即时生效', () => {
  const s = mkState();
  addU(s);
  chk(s, { id: 'c-1', dateISO: addDays(T, -365) });
  assert.equal(annualStatus(s, T, s.settings)[0].status, 'due');                    // 365 天整 → 临期窗内
  const strict = { annualCheckDays: 200, nearAnnualDays: 10 };
  assert.equal(annualStatus(s, T, strict)[0].status, 'overdue');                    // 周期改 200 → 已逾期
  assert.equal(annualStatus(s, T, strict)[0].dueIn, -165);
});

test('cylinderStatus：自定义预警窗覆盖（窗 7 天：8 天后到期为正常）', () => {
  const s = mkState();
  addCylinder(s, { id: 'c1', code: 'YSP-8', spec: '15kg', checkDueISO: addDays(T, 8) });
  assert.equal(cylinderStatus(s, T, s.settings).expiring.length, 1);                // 默认窗 90 → 临期
  assert.equal(cylinderStatus(s, T, { cylinderWarnDays: 7 }).expiring.length, 0);   // 窗改 7 → 正常
  assert.equal(cylinderStatus(s, T, { cylinderWarnDays: 7 }).overdue.length, 0);
});

test('continuityAudit：自定义回看窗封顶（首单早于窗时只看窗内）', () => {
  const s = mkState();
  addU(s);
  del(s, { id: 'd1', dateISO: addDays(T, -20) });   // 早于窗外：窗封顶生效
  del(s, { id: 'd2', dateISO: addDays(T, -12) });
  const c = continuityAudit(s, T, { checkWindowDays: 10 });
  assert.equal(c.checkedDays, 9);                   // 只回看 10 天窗（today 不算）
  assert.equal(c.missingDates.length, 9);           // 窗内 9 天全部零配送
});

test('slipText：含用户地址与电话底档', () => {
  const s = mkState();
  addU(s, { addr: '幸福路 12 号', phone: '13700001111' });
  chk(s, { id: 'c1' });
  const text = slipText({ state: s, checkId: 'c1', todayISOStr: T });
  assert.ok(text.includes('幸福路 12 号'));
  assert.ok(text.includes('13700001111'));
});

test('slipHtml：合格单为安检回执口径', () => {
  const s = mkState();
  addU(s);
  chk(s, { id: 'c1' });
  const html = slipHtml({ state: s, checkId: 'c1', todayISOStr: T });
  assert.ok(html.includes('入户安检回执'));
  assert.ok(!html.includes('隐患告知单'));
});

test('checkLedgerText：正常单落「各项正常」；空状态如实标注', () => {
  const s = mkState();
  addU(s);
  const empty = checkLedgerText({ state: s, todayISOStr: T });
  assert.ok(empty.includes('暂无安检记录'));
  chk(s, { id: 'c1' });
  assert.ok(checkLedgerText({ state: s, todayISOStr: T }).includes('各项正常'));
});

test('deliveryLedgerText：空状态「暂无配送记录」', () => {
  const s = mkState();
  addU(s);
  assert.ok(deliveryLedgerText({ state: s, todayISOStr: T }).includes('暂无配送记录'));
});

test('importBundle：扩展字段向前兼容（原样保留）', () => {
  const text = JSON.stringify({
    app: 'bottlesafe', version: 1, exportedAt: T,
    state: {
      station: { name: 'X', licenseNo: '', phone: '' }, users: [], cylinders: [],
      workers: [], deliveries: [], checks: [], settings: {}, futureField: { a: 1 },
    },
  });
  const res = importBundle(text);
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.futureField, { a: 1 });
});

test('守恒账：多单同瓶型跨单累计，在户瓶数随流水线性可追溯', () => {
  const s = mkState();
  addU(s);
  del(s, { id: 'd1', lines: [{ spec: '15kg', full: 3, empty: 0 }] });
  del(s, { id: 'd2', lines: [{ spec: '15kg', full: 0, empty: 1 }] });
  del(s, { id: 'd3', lines: [{ spec: '15kg', full: 1, empty: 2 }] });
  assert.equal(userBalance(s, 'u1', '15kg'), 1);   // 3 − 1 + (1−2) = 1
  assert.equal(conservation(s).residual, 0);
});

// ---------------------------------------------------------------------------
// 常量与口径
// ---------------------------------------------------------------------------

test('addUser：省略瓶型默认 15kg；recordDelivery：备注透传与 trim', () => {
  const s = mkState();
  const u = addUser(s, { id: 'u9', name: '无瓶型用户' });
  assert.deepEqual(u.specs, ['15kg']);
  del(s, { id: 'd-note', userId: 'u9', note: '  以瓶抵款月底结  ' });
  assert.equal(s.deliveries[0].note, '以瓶抵款月底结');
});

test('slipText：站点名称落款', () => {
  const s = mkState();
  addU(s);
  chk(s, { id: 'c1' });
  assert.ok(slipText({ state: s, checkId: 'c1', todayISOStr: T }).includes('测试供应站'));
});

test('checkLedgerText：limit 截断提示（更早条数见打印版台账）', () => {
  const s = mkState();
  addU(s);
  for (let i = 0; i < 3; i += 1) {
    chk(s, { id: `c-${i}` });
  }
  const text = checkLedgerText({ state: s, todayISOStr: T, limit: 2 });
  assert.ok(text.includes('更早 1 条见打印版台账'));
});

test('瓶型/安检项/默认参数/版本常量口径', () => {
  assert.deepEqual(Object.keys(CYLINDER_SPECS), ['5kg', '15kg', '50kg']);
  assert.deepEqual(Object.keys(CHECK_ITEMS), ['hose', 'valve', 'cylinder', 'stove', 'vent']);
  assert.deepEqual(ITEM_VALUES, ['ok', 'risk', 'na']);
  assert.deepEqual(DEFAULT_PARAMS, {
    annualCheckDays: 365, nearAnnualDays: 30,
    cylinderCycleMonths: 48, cylinderWarnDays: 90,
    certWarnDays: 30, checkWindowDays: 30,
  });
  assert.deepEqual(paramsOf({ annualCheckDays: 200 }).annualCheckDays, 200);
  assert.equal(STATE_VERSION, 1);
  assert.equal(typeof todayISO(), 'string');
});
