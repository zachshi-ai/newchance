/**
 * core.test.mjs — 纯逻辑层测试（node --test，零依赖）
 * 运行：npm test 或 node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO, addDays, addMonths, addYears, daysUntil, ageFromBirth,
  scheduleStatus, nextDue, applyTemplate, upcomingTasks, SOON_WINDOW_DAYS,
  buildHandoff, handoffToText, appendLog, exportBundle, importBundle, TOXICS,
} from '../app/js/core.js';

const TODAY = '2026-09-05'; // 固定"今天"，保证测试确定性

// ---------- 日期工具 ----------

test('addDays 跨月与跨年', () => {
  assert.equal(addDays('2026-09-05', 30), '2026-10-05');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('addMonths 月末收敛：01-31 + 1月 → 02-28', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 13), '2027-02-28');
  assert.equal(addMonths('2026-09-05', 1), '2026-10-05');
});

test('addYears 闰日收敛：2024-02-29 + 1年 → 2025-02-28', () => {
  assert.equal(addYears('2024-02-29', 1), '2025-02-28');
  assert.equal(addYears('2024-02-29', 4), '2028-02-29');
});

test('daysUntil 正负与当天为零', () => {
  assert.equal(daysUntil('2026-09-05', TODAY), 0);
  assert.equal(daysUntil('2026-09-06', TODAY), 1);
  assert.equal(daysUntil('2026-09-04', TODAY), -1);
});

test('todayISO 格式合法', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('ageFromBirth 生日边界与未来日期', () => {
  assert.deepEqual(ageFromBirth('2021-09-04', TODAY), { years: 5, months: 0, future: false });
  assert.deepEqual(ageFromBirth('2021-09-06', TODAY), { years: 4, months: 11, future: false });
  assert.equal(ageFromBirth('2027-01-01', TODAY).future, true);
});

// ---------- 日程 ----------

test('scheduleStatus 三档判定（30 天窗口）', () => {
  assert.equal(scheduleStatus('2026-09-05', TODAY).level, 'due_soon');   // 今天到期
  assert.equal(scheduleStatus('2026-10-05', TODAY).level, 'due_soon');   // 恰好 30 天
  assert.equal(scheduleStatus('2026-10-06', TODAY).level, 'ok');
  assert.equal(scheduleStatus('2026-08-01', TODAY).level, 'expired');
  const s = scheduleStatus('2026-08-01', TODAY);
  assert.equal(s.days, -35);
  assert.ok(SOON_WINDOW_DAYS === 30);
});

test('nextDue 非法周期被拒绝', () => {
  assert.throws(() => nextDue('2026-01-01', 0));
  assert.throws(() => nextDue('2026-01-01', -30));
  assert.throws(() => nextDue('2026-01-01', 30.5));
  assert.equal(nextDue('2026-08-06', 30), '2026-09-05');
});

test('applyTemplate 犬模板生成 5 项并携带状态', () => {
  const rows = applyTemplate('dog', { '狂犬疫苗': '2025-09-20' }, TODAY);
  assert.equal(rows.length, 5);
  const rabies = rows.find((r) => r.item === '狂犬疫苗');
  assert.equal(rabies.nextDate, '2026-09-20');
  assert.equal(rabies.status.level, 'due_soon'); // 15 天后到期
  const walk = rows.find((r) => r.item === '体外驱虫');
  assert.equal(walk.nextDate, null); // 没填上次日期 → 不编造
  assert.equal(walk.status, null);
});

test('applyTemplate 未知种类返回空', () => {
  assert.deepEqual(applyTemplate('parrot', {}), []);
});

test('upcomingTasks 只留非 ok 并按紧急度排序', () => {
  // 与真实数据同构：日程记录是 lastDate + cycleDays（距 TODAY=2026-09-05）
  const rows = [
    { item: 'A', lastDate: '2026-09-03', cycleDays: 60 },  // 57 天后 → ok，过滤
    { item: 'B', lastDate: '2026-07-07', cycleDays: 30 },  // 已过期 12 天
    { item: 'C', lastDate: '2026-09-03', cycleDays: 7 },   // 5 天后到期
    { item: 'D', lastDate: null, cycleDays: 30 },          // 未记录，不参与
  ];
  const tasks = upcomingTasks(rows, TODAY);
  assert.deepEqual(tasks.map((t) => t.item), ['B', 'C']);
  assert.equal(tasks[0].status.level, 'expired');
  assert.equal(tasks[0].nextDate, '2026-08-06');
});

// ---------- 交接单 ----------

function validHandoffInput() {
  return {
    pet: { name: '煤球', species: 'cat', breed: '中华田园猫', birth: '2022-03-01', weightKg: 4.5 },
    care: {
      feedings: [
        { time: '08:00', label: '冻干粮', amount: '20g', note: '' },
        { time: '20:00', label: '主食罐', amount: '85g', note: '加水一勺' },
      ],
      meds: [{ name: '化毛膏', dose: '3cm', freq: '隔天', route: '口服', note: '' }],
      offLimits: ['百合', '人类零食'],
      stressTriggers: '怕吸尘器，先躲床底别硬拽',
      escapeRisk: 'mid',
      routine: { litter: '每天铲一次' },
    },
    period: { start: '2026-10-01', end: '2026-10-08' },
    contacts: {
      sitterName: '王阿姨', sitterPhone: '13800000000', ownerPhone: '13900000000',
      emergencyName: '李医生', emergencyPhone: '13700000000',
      vetClinic: '安安宠医', vetPhone: '010-0000000',
    },
  };
}

test('buildHandoff 完整输入 → ok 且合计克数正确', () => {
  const r = buildHandoff(validHandoffInput());
  assert.equal(r.ok, true);
  assert.equal(r.missing.length, 0);
  assert.equal(r.data.feedingTotalGrams, 105);
  assert.equal(r.data.pet.age.years >= 4, true);
});

test('buildHandoff 缺字段 → 列出全部缺失而非静默', () => {
  const { ok, missing } = buildHandoff({
    pet: { name: '' }, care: { feedings: [] }, period: {}, contacts: {},
  });
  assert.equal(ok, false);
  for (const need of ['宠物名字', '宠物种类', '托养起止日期', '照护者称呼', '紧急联系电话', '常去医院电话', '至少一条喂食计划']) {
    assert.ok(missing.includes(need), `缺少提示: ${need}`);
  }
});

test('handoffToText 包含关键段落与免责声明', () => {
  const r = buildHandoff(validHandoffInput());
  const text = handoffToText(r);
  assert.match(text, /煤球 的托养交接单/);
  assert.match(text, /2026-10-01 至 2026-10-08/);
  assert.match(text, /全天合计约 105g/);
  assert.match(text, /不能吃\/不能做：百合、人类零食/);
  assert.match(text, /不构成医疗建议/);
});

// ---------- 日志 / 导入导出 ----------

test('appendLog 超限截断保留最新', () => {
  let log = Array.from({ length: 2000 }, (_, i) => ({ id: `x${i}`, type: '喂食' }));
  log = appendLog(log, { id: 'new', type: '异常', note: '呕吐一次' });
  assert.equal(log.length, 2000);
  assert.equal(log[log.length - 1].id, 'new');
  assert.equal(log[0].id, 'x1'); // 最早的被挤掉
});

test('exportBundle → importBundle 往返一致', () => {
  const state = { version: 1, pets: [{ id: 'p1', name: '煤球' }], care: {}, schedule: [], handoffs: [], log: [], events: [] };
  const text = exportBundle(state);
  const r = importBundle(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.pets, [{ id: 'p1', name: '煤球' }]);
  assert.equal(r.state.version, 1);
});

test('importBundle 拒绝脏数据（四类）', () => {
  assert.equal(importBundle('not json').ok, false);
  assert.equal(importBundle('{"app":"other"}').ok, false);
  assert.equal(importBundle(JSON.stringify({ app: 'pethandoff', version: 99, state: {} })).ok, false);
  const badShape = JSON.stringify({ app: 'pethandoff', version: 1, state: { pets: 'oops' } });
  assert.equal(importBundle(badShape).ok, false);
});

test('TOXICS 犬猫清单齐备且猫含百合、犬含木糖醇', () => {
  assert.ok(TOXICS.cat.some((t) => t.name.includes('百合')));
  assert.ok(TOXICS.dog.some((t) => t.name.includes('木糖醇')));
  assert.ok(TOXICS.dog.length >= 6 && TOXICS.cat.length >= 6);
});
