/**
 * core.js — 防火单 FireProof 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；所有周期与时限
 * 参数（月检间隔/巡查断更红线/防火检查周期）均可在设置中被场所覆盖。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md，全部为现行版口径）：
 * - 《中华人民共和国消防法》（1998 公布，2008 修订，2019/2021 两次修正，现行版）：
 *   第 15 条：公众聚集场所投入使用、营业前消防安全检查实行告知承诺管理，未经许可不得投入使用、营业；
 *   第 16 条：单位消防安全职责——配置消防设施器材并定期检验维修、建筑消防设施每年至少一次全面检测、
 *   保障疏散通道畅通、组织防火检查、消防演练；第 17 条：消防安全重点单位每日防火巡查并建记录、消防档案、
 *   岗前与定期培训；第 18 条：共用建筑统一管理，物业维护共用消防设施；第 21 条：动火审批、电焊气焊持证；
 *   第 28 条：不得占用、堵塞、封闭疏散通道、安全出口；第 60 条罚则（器材不合规/占用堵塞通道/
 *   隐患通知后不消除等，5000~5 万元；个人警告或 500 元以下）；第 61 条（三合一：责令停产停业 +
 *   5000~5 万元）；第 67 条（违反 16/17/18 条责令限期改正）；第 73 条（公众聚集场所/人员密集场所定义）。
 * - 《消防监督检查规定》（公安部令第 107 号公布，第 120 号令修改）第 30 条：公安派出所对日常监督检查
 *   范围的单位每年至少进行一次日常消防监督检查；第 31 条：检查内容清单（营业前检查/制度/检查培训演练/
 *   通道出口/消火栓·疏散指示·应急照明·灭火器完好有效/三合一）——小场所执法的第一抓手。
 * - 《高层民用建筑消防安全管理规定》（应急管理部令第 5 号）第 34 条：每日防火巡查并填写记录，
 *   公众聚集场所营业期间至少每 2 小时一次，巡查四项内容；第 35 条：防火检查频次与八项内容；
 *   第 36 条：隐患立即整改/限期整改+临时防范；第 37 条：电动自行车及蓄电池禁止在公共门厅、疏散走道、
 *   楼梯间、安全出口停放或充电。高层场所直接对标；非高层场所为同源口径参照。
 * - 《三类重点场所消防安全整治指南》（国务院安委办 2023 专项行动附件，重庆沙坪坝区政府镜像核验）：
 *   每月开展防火检查；宾馆/商场/公共娱乐场所营业时间至少每 2 小时巡查一次、营业结束查遗留火种并断
 *   非必要电源；医院/养老院/寄宿制学校/托幼每日夜间防火巡查不少于 2 次；人员密集场所至少每半年一次
 *   全员消防培训、各类场所至少每年一次；演练各类场所至少每年一次、宾馆/商场/集贸市场/公共娱乐场所
 *   至少每半年一次；设有消防设施的每年至少一次全面检测。
 * - 《建筑灭火器配置验收及检查规范》（GB 50444-2008）：灭火器配置、外观等应至少每月检查一次
 *   （候车室、歌舞娱乐放映游艺等人员密集场所至少每半月一次）；报废期限（水基型出厂满 6 年、干粉与
 *   洁净气体满 10 年、二氧化碳满 12 年）为通行技术口径——其中部分强制性条文自 2023-03-01 起由
 *   GB 55036-2022《消防设施通用规范》承接，送修周期（水基 3+1 / 干粉 5+2 年）为行业通识口径。
 * 本工具是场所侧的自证台账，不构成法律意见，不替代法定检查、许可与执法认定；属地规则永远赢。
 */

// ---------------------------------------------------------------------------
// 日期与工具（ISO 字符串 yyyy-mm-dd 为唯一日期表示）
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 校验 ISO 日期字符串，非法则抛错 */
export function assertISO(iso) {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) {
    throw new Error(`非法日期: ${JSON.stringify(iso)}`);
  }
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new Error(`非法日期: ${iso}`);
  }
  return iso;
}

/** 当前日期（ISO）。now 可注入，保证测试确定性 */
export function todayISO(now = new Date()) {
  const tzOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

/** 日期加 n 天（负数=回退） */
export function addDays(iso, n) {
  assertISO(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 距目标日还有几天（负数=已过期） */
export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO);
  assertISO(todayISOStr);
  const ms = new Date(`${targetISO}T00:00:00Z`) - new Date(`${todayISOStr}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** 'YYYY-MM' 月份键（月报分组用） */
export function monthKey(iso) {
  assertISO(iso);
  return iso.slice(0, 7);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 口径常量（法定口径的参数化，属地规则永远赢）
// ---------------------------------------------------------------------------

/**
 * 场所类型（对标《三类重点场所消防安全整治指南》九类 + 多业态/其他）。
 * dense：人员密集场所（消防法第 73 条口径）→ 培训每半年、灭火器检查每半月；
 * public：公众聚集场所 → 投入使用营业前消防安全检查义务（消防法第 15 条）；
 * patrol：巡查模式（two-hour 营业期间每 2 小时 / day-night 白天+夜间 / daily 营业前+打烊后）；
 * closeCheck：打烊查遗留火种并断非必要电源（整治指南）。
 */
export const VENUE_TYPES = {
  catering: { label: '餐饮场所', dense: true, public: true, patrol: 'daily', closeCheck: true },
  retail: { label: '商场/超市/门店', dense: true, public: true, patrol: 'two-hour', closeCheck: true },
  hotel: { label: '宾馆/旅馆/民宿', dense: true, public: true, patrol: 'two-hour', closeCheck: false },
  fun: { label: '公共娱乐场所（歌舞/网吧/洗浴）', dense: true, public: true, patrol: 'two-hour', closeCheck: true },
  clinic: { label: '小型医疗机构', dense: true, public: false, patrol: 'day-night', closeCheck: false },
  edu: { label: '学校/幼儿园/校外培训', dense: true, public: false, patrol: 'day-night', closeCheck: false },
  workshop: { label: '小生产加工/作坊', dense: false, public: false, patrol: 'daily', closeCheck: false },
  storage: { label: '仓储场所', dense: false, public: false, patrol: 'daily', closeCheck: false },
  fuel: { label: '易燃易爆危险品销售', dense: false, public: false, patrol: 'daily', closeCheck: false },
  mixed: { label: '多业态混合经营', dense: true, public: false, patrol: 'daily', closeCheck: false },
  other: { label: '其他小微场所', dense: false, public: false, patrol: 'daily', closeCheck: false },
};

export function venueOf(place) {
  return VENUE_TYPES[place?.type] ?? VENUE_TYPES.other;
}

/** 全员消防培训周期（月）：人员密集场所至少每半年一次，其他至少每年一次（整治指南） */
export function trainingMonths(place) {
  return venueOf(place).dense ? 6 : 12;
}

/** 演练周期（月）：宾馆/商场/集贸市场/公共娱乐每半年，其他每年（整治指南） */
export function drillMonths(place) {
  return ['retail', 'hotel', 'fun'].includes(place?.type) ? 6 : 12;
}

/** 灭火器检查间隔（天）：人员密集场所至少每半月，其他至少每月（GB 50444-2008 口径） */
export function extCheckDays(place) {
  return venueOf(place).dense ? 15 : 30;
}

export const PATROL_MODES = {
  'two-hour': '营业期间每 2 小时一次（营业前/营业中/打烊后）',
  'day-night': '白天和夜间各巡查一次',
  daily: '营业前 + 打烊后各一次',
};

export const PATROL_SLOTS = { open: '营业前', mid: '营业中', close: '打烊后' };

/** 巡查四查（应急部令第 5 号第 34 条口径） */
export const PATROL_ITEMS = {
  fire: '用火用电用气无违章',
  exit: '安全出口、疏散通道畅通',
  equip: '器材完好、常闭防火门关闭',
  post: '重点部位人员在岗',
};

/** 打烊必查（整治指南：购物、餐饮和公共娱乐场所营业结束时切断非必要电源、查遗留火种） */
export const CLOSE_CHECK_NOTE = '打烊后：查遗留火种、断非必要电源';

/** 灭火器类型与年限口径（GB 50444-2008 表 5.4.3 通行口径 + 3+1/5+2 送修通识） */
export const EXT_TYPES = {
  water: { label: '水基型', scrapYears: 6, firstServiceYears: 3, serviceYears: 1 },
  powder: { label: '干粉', scrapYears: 10, firstServiceYears: 5, serviceYears: 2 },
  clean: { label: '洁净气体', scrapYears: 10, firstServiceYears: 5, serviceYears: 2 },
  co2: { label: '二氧化碳', scrapYears: 12, firstServiceYears: 5, serviceYears: 2 },
};

/** 隐患来源（消防救援机构/派出所通知类带文书编号——第 60 条第（七）项的直接风险敞口） */
export const HAZARD_SOURCES = {
  patrol: '巡查/检查发现',
  self: '经营者自查',
  property: '物业/出租方告知',
  notice119: '消防救援机构通知改正',
  noticePolice: '公安派出所责令改正',
};

export const NOTICE_SOURCES = ['notice119', 'noticePolice'];

/** 月度防火检查八查（应急部令第 5 号第 35 条 + 整治指南检查要求浓缩） */
export const CHECK_ITEMS = {
  exit: '通道出口畅通，无栅栏/卷帘/堵塞',
  ext: '灭火器材在位、未遮挡、外观正常',
  elec: '线路无私拉乱接，打烊断非必要电源',
  gas: '燃气用具与管路正常，无违规用气',
  tri: '无违规住人，经营与住宿已分隔',
  door: '常闭式防火门关闭，防火分隔完好',
  charge: '电动自行车及蓄电池未在场所内停放充电',
  evac: '应急照明与疏散指示完好，标识在位',
};

export const TRAIN_KINDS = {
  training: { label: '全员消防培训', basis: '《三类重点场所消防安全整治指南》' },
  drill: { label: '灭火和应急疏散演练', basis: '消防法第十六条第（六）项 + 整治指南' },
  inspection: { label: '建筑消防设施年度检测', basis: '消防法第十六条第（三）项' },
};

/** 巡查断更红线（天）：默认 2，属地更严可下调 */
export const DEFAULT_GAP_DAYS = 2;
/** 防火检查周期（天）：整治指南口径每月一次 */
export const DEFAULT_CHECK_DAYS = 30;

// ---------------------------------------------------------------------------
// 营业前消防安全检查钟（消防法第 15 条：未经许可不得投入使用、营业）
// ---------------------------------------------------------------------------

/**
 * precheck: { status: 'unset'|'applied'|'licensed', appliedISO, licenseNo, licensedISO }
 * 非公众聚集场所 → na；已许可 → ok；已申请告知承诺待核查 → warn；未申请 → red。
 */
export function precheckState(place) {
  if (!place?.publicPlace) return { level: 'na', detail: '非公众聚集场所，不涉及营业前消防安全检查（消防法第 73 条口径）' };
  const st = place.precheck ?? { status: 'unset' };
  if (st.status === 'licensed') {
    return { level: 'ok', detail: `已通过消防安全检查${st.licenseNo ? `（许可/承诺凭证：${st.licenseNo}）` : ''}${st.licensedISO ? ` · ${st.licensedISO}` : ''}` };
  }
  if (st.status === 'applied') {
    return { level: 'warn', detail: `已申请告知承诺（${st.appliedISO ?? '日期未填'}），待消防救援机构核查` };
  }
  return { level: 'red', detail: '未经消防救援机构许可，不得投入使用、营业（消防法第 15 条）——先申请，再开业' };
}

// ---------------------------------------------------------------------------
// 三合一风险（经营、储存、住人同一建筑——消防法第 61 条最重罚则场景）
// ---------------------------------------------------------------------------

export function mixedState(place) {
  if (!place?.mixedWithHome) return { level: 'ok', detail: '场所内无人住宿' };
  if (place.homeSeparated) {
    return { level: 'warn', detail: '经营与住人同一建筑、已做防火分隔并独立设置出口——仍属整治重点，保持月检自查' };
  }
  return { level: 'red', detail: '经营、储存与住人"三合一"且未分隔——消防法第 61 条：责令停产停业，并处 5000 元以上 5 万元以下罚款' };
}

// ---------------------------------------------------------------------------
// 灭火器台账（报废钟 + 送修钟 + 月检钟）
// ---------------------------------------------------------------------------

/** 登记一具灭火器。ext: { no, type, madeISO, location, lastServiceISO?, note }（接管已有送修史时填 lastServiceISO） */
export function addExtinguisher(state, { no = '', type, madeISO, location = '', lastServiceISO = null, note = '' }) {
  if (!EXT_TYPES[type]) throw new Error(`非法灭火器类型: ${type}`);
  assertISO(madeISO);
  if (lastServiceISO !== null && lastServiceISO !== undefined && lastServiceISO !== '') {
    assertISO(lastServiceISO);
    if (lastServiceISO < madeISO) throw new Error('送修日期早于出厂日期');
  }
  state.extSeq = (state.extSeq ?? 0) + 1;
  const rec = { id: `ex-${state.extSeq}`, no, type, madeISO, location, lastServiceISO: lastServiceISO || null, note };
  state.extinguishers.push(rec);
  return rec;
}

export function removeExtinguisher(state, extId) {
  const idx = (state.extinguishers ?? []).findIndex((x) => x.id === extId);
  if (idx < 0) throw new Error(`灭火器不存在: ${extId}`);
  state.extinguishers.splice(idx, 1);
  // 同步清理其检查记录（换具后旧检查已无对象）
  state.extChecks = (state.extChecks ?? []).filter((c) => c.extId !== extId);
}

/**
 * 单具灭火器双钟。年→天按 365 天参数化近似（通识口径，属地与技术标准永远赢）。
 * scrap：出厂日 + 报废年限；临期窗 180 天。
 * service：出厂日 + 首修年限（未送修过）或最近送修日 + 复修周期；临期窗 60 天。
 */
export function extClocks(ext, todayISOStr) {
  assertISO(todayISOStr);
  const spec = EXT_TYPES[ext.type];
  if (!spec) throw new Error(`非法灭火器类型: ${ext.type}`);
  const scrapDue = addDays(ext.madeISO, spec.scrapYears * 365);
  const scrapLeft = daysUntil(scrapDue, todayISOStr);
  const scrap = { dueISO: scrapDue, daysLeft: scrapLeft, level: scrapLeft < 0 ? 'overdue' : scrapLeft <= 180 ? 'due' : 'ok' };
  const base = ext.lastServiceISO ?? ext.madeISO;
  const cycleDays = ext.lastServiceISO ? spec.serviceYears * 365 : spec.firstServiceYears * 365;
  const serviceDue = addDays(base, cycleDays);
  const serviceLeft = daysUntil(serviceDue, todayISOStr);
  const service = { dueISO: serviceDue, daysLeft: serviceLeft, level: serviceLeft < 0 ? 'overdue' : serviceLeft <= 60 ? 'due' : 'ok' };
  return { scrap, service };
}

/** 登记送修（水基 3+1 / 干粉等 5+2 周期以最近送修日重算） */
export function serviceExtinguisher(state, extId, { dateISO, note = '' } = {}) {
  const ext = (state.extinguishers ?? []).find((x) => x.id === extId);
  if (!ext) throw new Error(`灭火器不存在: ${extId}`);
  assertISO(dateISO);
  if (dateISO < ext.madeISO) throw new Error('送修日期早于出厂日期');
  ext.lastServiceISO = dateISO;
  if (note) ext.note = ext.note ? `${ext.note}；${note}` : note;
  return ext;
}

/**
 * 月检落账（逐具逐日唯一）：压力表在绿区 / 铅封插销完好 / 外观无锈蚀损伤 / 放置位置正确。
 * 任何一项异常必须写原因并转「隐患整改账」。
 */
export function addExtCheck(state, { extId, dateISO, pressure = true, seal = true, body = true, location = true, note = '' }) {
  const ext = (state.extinguishers ?? []).find((x) => x.id === extId);
  if (!ext) throw new Error(`灭火器不存在: ${extId}`);
  assertISO(dateISO);
  const items = { pressure, seal, body, location };
  for (const [k, v] of Object.entries(items)) {
    if (typeof v !== 'boolean') throw new Error(`检查项 ${k} 必须为布尔值`);
  }
  const abnormal = Object.values(items).some((v) => !v);
  if (abnormal && !note.trim()) throw new Error('存在异常项，必须写明异常情况（并转隐患登记）');
  if ((state.extChecks ?? []).some((c) => c.extId === extId && c.dateISO === dateISO)) {
    throw new Error(`${dateISO} 已有该灭火器的检查记录（同具同日唯一）`);
  }
  state.extCheckSeq = (state.extCheckSeq ?? 0) + 1;
  const rec = { id: `ec-${state.extCheckSeq}`, extId, dateISO, ...items, note };
  state.extChecks.push(rec);
  return rec;
}

/** 单具月检钟：距下次应检日（最近检查 + 间隔）的天数，never=从未检查 */
export function extCheckClock(state, ext, todayISOStr, intervalDays = 30) {
  assertISO(todayISOStr);
  if (!Number.isInteger(intervalDays) || intervalDays < 7) throw new Error(`非法检查间隔: ${intervalDays}`);
  const last = (state.extChecks ?? [])
    .filter((c) => c.extId === ext.id)
    .map((c) => c.dateISO)
    .sort()
    .pop();
  if (!last) return { level: 'never', lastISO: null, daysLeft: null };
  const dueISO = addDays(last, intervalDays);
  const daysLeft = daysUntil(dueISO, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'due' : 'ok';
  return { level, lastISO: last, dueISO, daysLeft };
}

// ---------------------------------------------------------------------------
// 防火巡查日结（营业前/营业中/打烊后；异常必须写处置）
// ---------------------------------------------------------------------------

/**
 * 写一笔巡查。patrol: { dateISO, slot, items: {fire,exit,equip,post}, note }
 * - items 全 true = 正常；任何一项 false 必须写 note（异常与处置）——如实的异常是痕迹，沉默的异常是缺口；
 * - open/close 同日唯一；mid（营业中每 2 小时）允许同日多笔。
 */
export function addPatrol(state, { dateISO, slot, items = {}, note = '' }) {
  assertISO(dateISO);
  if (!PATROL_SLOTS[slot]) throw new Error(`非法巡查时段: ${slot}`);
  const norm = {
    fire: items.fire !== false,
    exit: items.exit !== false,
    equip: items.equip !== false,
    post: items.post !== false,
  };
  const abnormal = Object.values(norm).some((v) => !v);
  if (abnormal && !note.trim()) throw new Error('巡查发现异常必须写明情况与处置（或先转隐患登记）');
  if (slot !== 'mid' && (state.patrols ?? []).some((p) => p.dateISO === dateISO && p.slot === slot)) {
    throw new Error(`${dateISO} ${PATROL_SLOTS[slot]}已有巡查记录（同日同段唯一）`);
  }
  state.patrolSeq = (state.patrolSeq ?? 0) + 1;
  const rec = { id: `pt-${state.patrolSeq}`, dateISO, slot, items: norm, abnormal, note };
  state.patrols.push(rec);
  return rec;
}

export function removePatrol(state, patrolId) {
  const idx = (state.patrols ?? []).findIndex((p) => p.id === patrolId);
  if (idx < 0) throw new Error(`巡查记录不存在: ${patrolId}`);
  state.patrols.splice(idx, 1);
}

/** 最近一笔巡查日（任意时段） */
export function lastPatrolISO(state) {
  const dates = (state.patrols ?? []).map((p) => p.dateISO).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** 巡查断更天数（今天距最近一笔巡查）；从未巡查返回 null */
export function patrolGapDays(state, todayISOStr) {
  assertISO(todayISOStr);
  const last = lastPatrolISO(state);
  return last === null ? null : daysUntil(last, todayISOStr) * -1;
}

/** 巡查异常记录（如实登记的偏差，倒查时的"发现-处置"痕迹），最新在前 */
export function patrolAbnormals(state) {
  return (state.patrols ?? [])
    .filter((p) => p.abnormal)
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

/** 某日营业前+打烊后是否都巡了（daily 模式的日完成判定；无日期要求返回 false） */
export function patrolDailyDone(state, dateISO) {
  assertISO(dateISO);
  const day = (state.patrols ?? []).filter((p) => p.dateISO === dateISO);
  return day.some((p) => p.slot === 'open') && day.some((p) => p.slot === 'close');
}

// ---------------------------------------------------------------------------
// 月度防火检查（每月一次八查）
// ---------------------------------------------------------------------------

/**
 * 写一次防火检查。check: { dateISO, items: {exit,ext,elec,gas,tri,door,charge,evac}, note }
 * 全 true = 全部正常；任何一项 false 必须写 note，并应转「隐患整改账」跟踪销案。
 * 同日唯一。
 */
export function addMonthlyCheck(state, { dateISO, items = {}, note = '' }) {
  assertISO(dateISO);
  const norm = {};
  for (const k of Object.keys(CHECK_ITEMS)) norm[k] = items[k] !== false;
  const abnormal = Object.values(norm).some((v) => !v);
  if (abnormal && !note.trim()) throw new Error('防火检查存在异常项，必须写明情况（并转隐患登记）');
  if ((state.monthChecks ?? []).some((c) => c.dateISO === dateISO)) {
    throw new Error(`${dateISO} 已有防火检查记录（同日唯一）`);
  }
  state.monthCheckSeq = (state.monthCheckSeq ?? 0) + 1;
  const rec = { id: `mc-${state.monthCheckSeq}`, dateISO, items: norm, abnormal, note };
  state.monthChecks.push(rec);
  return rec;
}

/** 防火检查钟：最近一次 + 周期；never=从未检查 */
export function monthlyCheckClock(state, todayISOStr, checkDays = DEFAULT_CHECK_DAYS) {
  assertISO(todayISOStr);
  const last = (state.monthChecks ?? []).map((c) => c.dateISO).sort().pop();
  if (!last) return { level: 'never', lastISO: null, daysLeft: null };
  const dueISO = addDays(last, checkDays);
  const daysLeft = daysUntil(dueISO, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'due' : 'ok';
  return { level, lastISO: last, dueISO, daysLeft };
}

// ---------------------------------------------------------------------------
// 隐患整改闭环（发现 → 整改 → 复查销案；通知类带文书编号）
// ---------------------------------------------------------------------------

/**
 * 登记一条隐患。hazard: { dateISO, source, docNo, location, desc, dueISO, owner, note }
 * 通知类来源（消防救援机构/公安派出所）必须填文书编号——第 60 条第（七）项"通知后不及时消除"
 * 是直接的罚款情形，文书编号是整改闭环的锚。
 */
export function addHazard(state, { dateISO, source, docNo = '', location = '', desc, dueISO = null, owner = '', note = '' }) {
  assertISO(dateISO);
  if (!HAZARD_SOURCES[source]) throw new Error(`非法隐患来源: ${source}`);
  if (!desc || !desc.trim()) throw new Error('隐患描述不能为空');
  if (NOTICE_SOURCES.includes(source) && !docNo.trim()) {
    throw new Error('通知类隐患必须登记文书编号（责令改正通知书/检查记录的凭证号）');
  }
  if (dueISO !== null && dueISO !== undefined && dueISO !== '') assertISO(dueISO);
  state.hazardSeq = (state.hazardSeq ?? 0) + 1;
  const rec = {
    id: `hz-${state.hazardSeq}`, dateISO, source, docNo, location, desc,
    dueISO: dueISO || null, owner, note, closedISO: null, verifyNote: '',
  };
  state.hazards.push(rec);
  return rec;
}

/** 复查销案：复查日不得早于登记日；一次定案不可重复 */
export function closeHazard(state, hazardId, { closedISO, verifyNote = '' } = {}) {
  const rec = (state.hazards ?? []).find((x) => x.id === hazardId);
  if (!rec) throw new Error(`隐患记录不存在: ${hazardId}`);
  if (rec.closedISO) throw new Error('该隐患已复查销案');
  assertISO(closedISO);
  if (closedISO < rec.dateISO) throw new Error('复查日期早于登记日期');
  rec.closedISO = closedISO;
  rec.verifyNote = verifyNote;
  return rec;
}

/**
 * 未销案隐患（挂账）：排序权重——通知类超期 > 普通超期 > 通知类在限 > 在限，
 * 同档按登记日升序（挂得越久越靠前）。
 */
export function openHazards(state, todayISOStr) {
  assertISO(todayISOStr);
  const weight = (h) => {
    const overdue = h.dueISO ? daysUntil(h.dueISO, todayISOStr) < 0 : false;
    const notice = NOTICE_SOURCES.includes(h.source);
    if (notice && overdue) return 0;
    if (overdue) return 1;
    if (notice) return 2;
    return 3;
  };
  return (state.hazards ?? [])
    .filter((h) => !h.closedISO)
    .sort((a, b) => weight(a) - weight(b)
      || String(a.dateISO).localeCompare(b.dateISO)
      || a.id.localeCompare(b.id));
}

/** 隐患风险盘点（体检与看板用） */
export function hazardRisk(state, todayISOStr) {
  const open = openHazards(state, todayISOStr);
  const isOverdue = (h) => h.dueISO ? daysUntil(h.dueISO, todayISOStr) < 0 : false;
  return {
    open: open.length,
    noticeOpen: open.filter((h) => NOTICE_SOURCES.includes(h.source)).length,
    overdue: open.filter((h) => isOverdue(h)).length,
    noticeOverdue: open.filter((h) => NOTICE_SOURCES.includes(h.source) && isOverdue(h)).length,
  };
}

// ---------------------------------------------------------------------------
// 培训 / 演练 / 年度检测（记录 + 周期钟）
// ---------------------------------------------------------------------------

/** 登记一次培训/演练/年度检测。rec: { dateISO, kind, count, note } */
export function addTraining(state, { dateISO, kind, count = 0, note = '' }) {
  assertISO(dateISO);
  if (!TRAIN_KINDS[kind]) throw new Error(`非法培训演练类型: ${kind}`);
  if (!Number.isInteger(count) || count < 0) throw new Error(`参加人数必须为非负整数: ${count}`);
  state.trainingSeq = (state.trainingSeq ?? 0) + 1;
  const rec = { id: `tr-${state.trainingSeq}`, dateISO, kind, count, note };
  state.trainings.push(rec);
  return rec;
}

/**
 * 周期钟：最近一次记录 + 周期（培训 6/12 月、演练 6/12 月按场所类型，年度检测 12 月；
 * 月按 30 天参数化）。never=从未；na=不涉及（未设自动消防设施时检测不涉及）。
 */
export function trainClock(state, kind, place, todayISOStr) {
  assertISO(todayISOStr);
  if (!TRAIN_KINDS[kind]) throw new Error(`非法培训演练类型: ${kind}`);
  if (kind === 'inspection' && !place?.hasSystems) {
    return { level: 'na', months: null, lastISO: null, dueISO: null, daysLeft: null };
  }
  const months = kind === 'inspection' ? 12 : kind === 'training' ? trainingMonths(place) : drillMonths(place);
  const last = (state.trainings ?? [])
    .filter((t) => t.kind === kind)
    .map((t) => t.dateISO)
    .sort()
    .pop();
  if (!last) return { level: 'never', months, lastISO: null, dueISO: null, daysLeft: null };
  const dueISO = addDays(last, months * 30);
  const daysLeft = daysUntil(dueISO, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= 30 ? 'due' : 'ok';
  return { level, months, lastISO: last, dueISO, daysLeft };
}

/** 培训演练看板：红灯在前，na 排最后 */
export function dutyBoard(state, place, todayISOStr) {
  assertISO(todayISOStr);
  const order = { never: 0, overdue: 1, due: 2, ok: 3, na: 4 };
  return Object.keys(TRAIN_KINDS)
    .map((kind) => ({ kind, label: TRAIN_KINDS[kind].label, basis: TRAIN_KINDS[kind].basis, ...trainClock(state, kind, place, todayISOStr) }))
    .sort((a, b) => order[a.level] - order[b.level] || (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9));
}

// ---------------------------------------------------------------------------
// 账本体检（迎检前的自查打分；全部确定性输出）
// ---------------------------------------------------------------------------

/**
 * 九项体检。score = 100 - 红×15 - 黄×5（下限 0）。
 */
export function healthCheck(state, todayISOStr, settings = {}) {
  assertISO(todayISOStr);
  const place = state.place ?? {};
  const gapDays = settings.gapDays ?? DEFAULT_GAP_DAYS;
  const checkDays = settings.checkDays ?? DEFAULT_CHECK_DAYS;
  const interval = settings.extCheckDays > 0 ? settings.extCheckDays : extCheckDays(place);
  const items = [];

  const pc = precheckState(place);
  items.push({
    key: 'precheck', label: '营业前消防安全检查',
    level: pc.level === 'red' ? 'bad' : pc.level === 'warn' ? 'warn' : 'ok',
    detail: pc.detail,
  });

  const mixed = mixedState(place);
  items.push({
    key: 'mixed', label: '三合一风险',
    level: mixed.level === 'red' ? 'bad' : mixed.level === 'warn' ? 'warn' : 'ok',
    detail: mixed.detail,
  });

  const exts = state.extinguishers ?? [];
  if (!exts.length) {
    items.push({ key: 'scrap', label: '灭火器台账', level: 'bad', detail: '未登记灭火器——器材台账是消防检查的第一张表' });
  } else {
    const scrapBad = exts.filter((e) => extClocks(e, todayISOStr).scrap.level === 'overdue');
    const scrapDue = exts.filter((e) => extClocks(e, todayISOStr).scrap.level === 'due');
    const svcBad = exts.filter((e) => extClocks(e, todayISOStr).service.level === 'overdue');
    const svcDue = exts.filter((e) => extClocks(e, todayISOStr).service.level === 'due');
    items.push({
      key: 'scrap', label: '灭火器双钟',
      level: scrapBad.length || svcBad.length ? 'bad' : scrapDue.length || svcDue.length ? 'warn' : 'ok',
      detail: [
        scrapBad.length ? `${scrapBad.length} 具已到报废年限（须停用更换）` : '',
        svcBad.length ? `${svcBad.length} 具送修超期` : '',
        scrapDue.length ? `${scrapDue.length} 具临近报废` : '',
        svcDue.length ? `${svcDue.length} 具临近送修` : '',
      ].filter(Boolean).join('；') || `${exts.length} 具全部在期`,
    });
  }

  if (exts.length) {
    const never = exts.filter((e) => extCheckClock(state, e, todayISOStr, interval).level === 'never');
    const over = exts.filter((e) => extCheckClock(state, e, todayISOStr, interval).level === 'overdue');
    const due = exts.filter((e) => extCheckClock(state, e, todayISOStr, interval).level === 'due');
    items.push({
      key: 'extcheck', label: `灭火器月检（${interval} 天）`,
      level: never.length || over.length ? 'bad' : due.length ? 'warn' : 'ok',
      detail: never.length
        ? `${never.length} 具从未月检（GB 50444 月检口径）`
        : over.length
          ? `${over.length} 具月检超期（最近应检 ${over.map((e) => extCheckClock(state, e, todayISOStr, interval).dueISO).sort()[0]}）`
          : due.length ? `${due.length} 具 7 天内到检期` : '全部灭火器按期检查',
    });
  } else {
    items.push({ key: 'extcheck', label: '灭火器月检', level: 'bad', detail: '未登记灭火器，无检查可查' });
  }

  const gap = patrolGapDays(state, todayISOStr);
  if (gap === null) items.push({ key: 'patrol', label: '防火巡查', level: 'bad', detail: '从未巡查——台账还没开始' });
  else if (gap > gapDays) items.push({ key: 'patrol', label: '防火巡查', level: 'bad', detail: `巡查已断更 ${gap} 天（红线 ${gapDays} 天）` });
  else if (gap > 0) items.push({ key: 'patrol', label: '防火巡查', level: 'warn', detail: `距最近巡查 ${gap} 天` });
  else items.push({ key: 'patrol', label: '防火巡查', level: 'ok', detail: '巡查在续' });

  const mc = monthlyCheckClock(state, todayISOStr, checkDays);
  items.push({
    key: 'monthcheck', label: `防火检查（${Math.round(checkDays / 30)} 个月一次）`,
    level: mc.level === 'never' || mc.level === 'overdue' ? 'bad' : mc.level === 'due' ? 'warn' : 'ok',
    detail: mc.level === 'never'
      ? '从未开展防火检查（整治指南：每月一次）'
      : mc.level === 'overdue'
        ? `上次防火检查 ${mc.lastISO}，已超期 ${-mc.daysLeft} 天`
        : mc.level === 'due' ? `距下次防火检查还有 ${mc.daysLeft} 天` : `上次防火检查 ${mc.lastISO}，周期在期`,
  });

  const risk = hazardRisk(state, todayISOStr);
  items.push({
    key: 'hazard', label: '隐患整改闭环',
    level: risk.noticeOverdue ? 'bad' : risk.overdue ? 'bad' : risk.noticeOpen ? 'warn' : risk.open ? 'warn' : 'ok',
    detail: !risk.open
      ? '隐患全部销案'
      : `${risk.open} 条未销案${risk.noticeOpen ? `（含 ${risk.noticeOpen} 条通知类）` : ''}${risk.overdue ? `，${risk.overdue} 条已超整改期限` : ''}——通知类不销案就是第 60 条第（七）项的敞口`,
  });

  const duties = dutyBoard(state, place, todayISOStr);
  const bad = duties.filter((d) => d.level === 'never' || d.level === 'overdue');
  const due = duties.filter((d) => d.level === 'due');
  items.push({
    key: 'duty', label: '培训演练年检',
    level: bad.length ? 'bad' : due.length ? 'warn' : 'ok',
    detail: bad.length
      ? `${bad.map((d) => d.label).join('、')}${bad.some((d) => d.level === 'never') ? '未开展或' : ''}逾期`
      : due.length ? `${due.map((d) => d.label).join('、')}临期` : '培训演练在期',
  });

  const abn = patrolAbnormals(state);
  items.push({
    key: 'abnormal', label: '巡查异常留痕',
    level: abn.length >= 3 ? 'warn' : 'ok',
    detail: abn.length ? `${abn.length} 笔异常已留痕处置（如实登记是自证，不是扣分）` : '巡查无异常记录',
  });

  const badCount = items.filter((i) => i.level === 'bad').length;
  const warnCount = items.filter((i) => i.level === 'warn').length;
  return { items, bad: badCount, warn: warnCount, score: Math.max(0, 100 - badCount * 15 - warnCount * 5) };
}

// ---------------------------------------------------------------------------
// 月度小结（微信文本通道，确定性输出）
// ---------------------------------------------------------------------------

/**
 * 月度小结：巡查/检查/器材/隐患/培训演练 五段 + 口径尾注。month 形如 '2026-09'。
 */
export function monthlySummary(state, month, todayISOStr = todayISO()) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  assertISO(todayISOStr);
  const inMonth = (iso) => monthKey(iso) === month;
  const place = state.place ?? {};
  const patrols = (state.patrols ?? []).filter((p) => inMonth(p.dateISO));
  const patrolAbn = patrols.filter((p) => p.abnormal);
  const checks = (state.monthChecks ?? []).filter((c) => inMonth(c.dateISO));
  const exts = state.extinguishers ?? [];
  const extChecks = (state.extChecks ?? []).filter((c) => inMonth(c.dateISO));
  const extsChecked = new Set(extChecks.map((c) => c.extId));
  const extNotChecked = exts.filter((e) => !extsChecked.has(e.id));
  const scrapBad = exts.filter((e) => extClocks(e, todayISOStr).scrap.level === 'overdue');
  const hazards = (state.hazards ?? []).filter((h) => inMonth(h.dateISO));
  const closedInMonth = (state.hazards ?? []).filter((h) => h.closedISO && inMonth(h.closedISO)); // 复查销案可能发生在登记之后的新月份
  const risk = hazardRisk(state, todayISOStr);
  const trainings = (state.trainings ?? []).filter((t) => inMonth(t.dateISO));
  const dutiesLate = dutyBoard(state, place, todayISOStr).filter((d) => d.level === 'overdue' || d.level === 'never');
  const gap = patrolGapDays(state, todayISOStr);

  const L = [];
  L.push(`【场所消防安全月度小结】${month}`);
  if (place.name) L.push(`场所：${place.name}（${venueOf(place).label}）`);
  L.push(`防火巡查 ${patrols.length} 笔（异常留痕 ${patrolAbn.length} 笔）${gap === null ? '；从未巡查' : `；断更 ${gap} 天内`}`);
  L.push(`防火检查 ${checks.length} 次（整治指南口径每月一次）`);
  L.push(`灭火器 ${exts.length} 具，本月检查 ${extsChecked.size} 具${extNotChecked.length ? `，未检 ${extNotChecked.length} 具` : ''}${scrapBad.length ? `；⚠ ${scrapBad.length} 具已到报废年限须停用更换` : ''}`);
  L.push(`隐患：本月新登记 ${hazards.length} 条、复查销案 ${closedInMonth.length} 条${risk.open ? `；⚠ 未销案 ${risk.open} 条${risk.noticeOpen ? `（含通知类 ${risk.noticeOpen} 条）` : ''}` : '；全部闭环'}`);
  L.push(trainings.length
    ? `培训演练：${trainings.map((t) => `${TRAIN_KINDS[t.kind].label} ${t.dateISO}（${t.count} 人）`).join('、')}`
    : '培训演练：本月无登记');
  if (dutiesLate.length) L.push(`⚠ 周期点名：${dutiesLate.map((d) => d.label).join('、')}已逾期或未开展`);
  L.push('口径：《消防法》第 15/16/17/28/60/61 条、《消防监督检查规定》第 30/31 条、应急部令第 5 号第 34/35/36/37 条、《三类重点场所消防安全整治指南》、GB 50444 月检与报废口径；本小结为场所自查底稿，不替代法定检查与许可。');
  L.push(`生成：防火单 · ${month}`);
  return { text: L.join('\n'), patrols: patrols.length, checks: checks.length, hazards: hazards.length };
}

// ---------------------------------------------------------------------------
// 迎检自证包（单文件 HTML：七段，含签字栏；同输入同输出）
// ---------------------------------------------------------------------------

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏） */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const place = state.place ?? {};
  const v = venueOf(place);
  const interval = settings.extCheckDays > 0 ? settings.extCheckDays : extCheckDays(place);
  const checkDays = settings.checkDays ?? DEFAULT_CHECK_DAYS;
  const LEVEL = { overdue: '逾期', due: '临期', ok: '正常', never: '从未', unset: '未登记', na: '不涉及', red: '未许可', warn: '在办' };

  const pc = precheckState(place);
  const mixed = mixedState(place);

  const from30 = addDays(todayISOStr, -29);
  const patrols = (state.patrols ?? []).filter((p) => p.dateISO >= from30).sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id.localeCompare(a.id));
  const patrolRows = patrols.map((p) => `<tr>
    <td>${e(p.dateISO)}</td><td>${e(PATROL_SLOTS[p.slot] ?? p.slot)}</td>
    <td>${p.items.fire ? '√' : '<strong>异常</strong>'}</td>
    <td>${p.items.exit ? '√' : '<strong>异常</strong>'}</td>
    <td>${p.items.equip ? '√' : '<strong>异常</strong>'}</td>
    <td>${p.items.post ? '√' : '<strong>异常</strong>'}</td>
    <td>${e(p.note || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="7">近 30 天无巡查记录</td></tr>';

  const extRows = [...(state.extinguishers ?? [])].map((x) => {
    const clocks = extClocks(x, todayISOStr);
    const chk = extCheckClock(state, x, todayISOStr, interval);
    const spec = EXT_TYPES[x.type];
    return `<tr>
    <td>${e(x.no || '—')}</td><td>${e(spec.label)}</td><td>${e(x.madeISO)}</td>
    <td>${e(x.location || '—')}</td>
    <td>${e(x.lastServiceISO ?? '未送修')}/${e(clocks.service.dueISO)}${clocks.service.level === 'overdue' ? '<strong>（超期）</strong>' : ''}</td>
    <td>${e(clocks.scrap.dueISO)}${clocks.scrap.level === 'overdue' ? '<strong>（已到期须停用）</strong>' : clocks.scrap.level === 'due' ? '（临期）' : ''}</td>
    <td>${chk.lastISO ? e(chk.lastISO) : '<strong>未检</strong>'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="7">未登记灭火器</td></tr>';

  const mcRows = [...(state.monthChecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 12).map((c) => `<tr>
    <td>${e(c.dateISO)}</td>
    <td>${c.items.exit ? '√' : '<strong>×</strong>'}</td><td>${c.items.ext ? '√' : '<strong>×</strong>'}</td>
    <td>${c.items.elec ? '√' : '<strong>×</strong>'}</td><td>${c.items.gas ? '√' : '<strong>×</strong>'}</td>
    <td>${c.items.tri ? '√' : '<strong>×</strong>'}</td><td>${c.items.door ? '√' : '<strong>×</strong>'}</td>
    <td>${c.items.charge ? '√' : '<strong>×</strong>'}</td><td>${c.items.evac ? '√' : '<strong>×</strong>'}</td>
    <td>${e(c.note || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="10">无防火检查记录</td></tr>';

  const hzRows = [...(state.hazards ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((h) => `<tr>
    <td>${e(h.dateISO)}</td><td>${e(HAZARD_SOURCES[h.source] ?? h.source)}${h.docNo ? `（${e(h.docNo)}）` : ''}</td>
    <td>${e(h.location || '—')}</td><td>${e(h.desc)}</td>
    <td>${h.dueISO ? e(h.dueISO) : '—'}</td>
    <td>${h.closedISO ? `${e(h.closedISO)}${h.verifyNote ? `：${e(h.verifyNote)}` : ''}` : '<strong>未销案</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="6">无隐患登记</td></tr>';

  const trRows = dutyBoard(state, place, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastISO ? e(d.lastISO) : '—'}</td>
    <td>${d.dueISO ? e(d.dueISO) : '—'}</td><td>${LEVEL[d.level] ?? d.level}</td><td>${e(d.basis)}</td>
  </tr>`).join('');

  const hc = healthCheck(state, todayISOStr, settings);
  const hcRows = hc.items.map((i) => `<tr>
    <td>${e(i.label)}</td><td>${i.level === 'bad' ? '红' : i.level === 'warn' ? '黄' : '绿'}</td><td>${e(i.detail)}</td>
  </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>场所消防迎检自证包 · ${e(place.name ?? '')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; }
  th { color: #555; font-weight: 500; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>场所消防迎检自证包 · ${e(place.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 场所类型：${e(v.label)} · 消防安全责任人：${e(place.manager || '—')} · ${e(place.address || '地址未填')}</div>
<h2>一、场所建档与营业前消防安全检查（消防法第 15 条）</h2>
<div class="meta">类型：${e(v.label)}（${v.public ? '公众聚集场所' : '非公众聚集场所'} · ${v.dense ? '人员密集场所' : '非人员密集'}） · 灭火器检查间隔 ${interval} 天 · 防火检查周期 ${checkDays} 天</div>
<div class="meta">营业前检查：${e(pc.detail)}（${LEVEL[pc.level] ?? pc.level}）</div>
<div class="meta">三合一自查：${e(mixed.detail)}</div>
<h2>二、灭火器台账与月检（GB 50444 月检口径：人员密集场所每半月，其他每月）</h2>
<table><tr><th>编号</th><th>类型</th><th>出厂</th><th>位置</th><th>最近送修/应送修</th><th>报废日</th><th>最近月检</th></tr>${extRows}</table>
<h2>三、防火巡查记录（近 30 天：用火用电用气/通道出口/器材防火门/重点部位）</h2>
<table><tr><th>日期</th><th>时段</th><th>用火电</th><th>出口</th><th>器材</th><th>在岗</th><th>异常与处置</th></tr>${patrolRows}</table>
<h2>四、防火检查（每月一次八查）</h2>
<table><tr><th>日期</th><th>出口</th><th>器材</th><th>用电</th><th>燃气</th><th>住人</th><th>防火门</th><th>电车</th><th>疏散</th><th>异常说明</th></tr>${mcRows}</table>
<h2>五、火灾隐患整改闭环（通知类带文书编号——消防法第 60 条第（七）项的对口留痕）</h2>
<table><tr><th>发现日</th><th>来源</th><th>部位</th><th>隐患</th><th>整改期限</th><th>复查销案</th></tr>${hzRows}</table>
<h2>六、培训、演练与年度检测（周期按场所类型判定）</h2>
<table><tr><th>项目</th><th>最近一次</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${trRows}</table>
<h2>七、账本体检（${hc.score} 分：红 ${hc.bad} · 黄 ${hc.warn}）</h2>
<table><tr><th>项目</th><th>灯</th><th>说明</th></tr>${hcRows}</table>
<div class="sign">消防安全责任人（签字/盖章）：____________　巡查人（签字）：____________　日期：____________</div>
<div class="foot">生成：防火单 FireProof · ${e(todayISOStr)} · 本页为场所自查与迎检备查材料，不替代法定检查记录、许可文书与消防设施检测报告；检查重点对标《消防监督检查规定》第 31 条派出所日常检查清单</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 隐患整改单（发给整改责任人/物业/出租方的单据，含复查与签字栏）
// ---------------------------------------------------------------------------

/** 隐患整改单：单条隐患的告知-要求-复查-签字（单文件 HTML） */
export function hazardSheetHtml(state, hazardId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const hz = (state.hazards ?? []).find((x) => x.id === hazardId);
  if (!hz) throw new Error(`隐患记录不存在: ${hazardId}`);
  const place = state.place ?? {};
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>火灾隐患整改单 · ${e(hz.dateISO)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; }
  th { color: #555; font-weight: 500; width: 8em; }
  .box { border: 1px solid #ccc; border-radius: 8px; padding: 10px; font-size: 13px; min-height: 56px; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>火灾隐患整改单</h1>
<div class="meta">场所：${e(place.name || '—')} · 消防安全责任人：${e(place.manager || '—')} · 打印日：${e(todayISOStr)}</div>
<h2>一、隐患信息</h2>
<table>
  <tr><th>发现日期</th><td>${e(hz.dateISO)}</td></tr>
  <tr><th>来源</th><td>${e(HAZARD_SOURCES[hz.source] ?? hz.source)}${hz.docNo ? ` · 文书编号：${e(hz.docNo)}` : ''}</td></tr>
  <tr><th>部位</th><td>${e(hz.location || '—')}</td></tr>
  <tr><th>隐患描述</th><td>${e(hz.desc)}</td></tr>
  <tr><th>整改期限</th><td>${hz.dueISO ? e(hz.dueISO) : '（未填——逾期整改即触发消防法第 60 条第（七）项罚则风险，建议明确期限）'}</td></tr>
</table>
<h2>二、整改要求</h2>
<div class="box">${e(hz.note || '（此处写整改要求：整改措施、临时防范、责任人——应急部令第 5 号第 36 条：不能当场改正的，明确整改责任、期限，落实整改期间临时防范措施）')}</div>
<h2>三、复查销案</h2>
<div class="box">${hz.closedISO ? `${e(hz.closedISO)} 复查合格：${e(hz.verifyNote || '已整改到位')}` : '（复查后填写：复查日期、复查结论、复查人）'}</div>
<div class="sign">整改责任人（签字）：____________　复查人（签字）：____________　日期：____________</div>
<div class="foot">生成：防火单 FireProof · ${e(todayISOStr)} · 本单为场所内部整改管理底稿，涉及消防救援机构/公安派出所通知事项的，以法律文书与属地要求为准</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'fireproof', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'fireproof') return { ok: false, error: '不是防火单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.place === 'object' && s.place !== null &&
    arr(s.extinguishers) && arr(s.extChecks) && arr(s.patrols) &&
    arr(s.monthChecks) && arr(s.hazards) && arr(s.trainings) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
