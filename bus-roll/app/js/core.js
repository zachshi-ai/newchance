/**
 * core.js — 护学账 BusRoll 纯域逻辑（零依赖、可单测）
 *
 * 全部法定口径锚定《校车安全管理条例》（国务院令第617号，2012-04-05 公布施行，现行有效未修订），
 * 条号在 docs/14 逐条带出处维护；属地实施办法（省级实施办法系条例第 61 条要求）永远赢，
 * 所有周期与阈值均为可覆盖参数——工具亮灯提示不替代法定义务。
 *
 * 三条主线：
 *  1) 证照钟：每半年安全技术检验（第20条）、校车标牌有效期（第16条）、承运人责任保险（第14条(五)）、
 *     驾驶人年度审验（第26条）与年龄红线（第23条(一) 25~60 周岁）。
 *  2) 趟次点名：出车前七项检查（第41条）→ 上车清点并确认（第39条(三)）→ 下车核实与车内三查
 *     （第39条(五)「确认乘车学生已经全部离车后本人方可离车」——防遗忘的工具化），
 *     超员红线（第34条）与「带病校车开不了趟」（第41条+第22条）。
 *  3) 周期义务：应急演练与安全教育（第12条）、驾驶人安全教育（第10条）、照管人员培训（第38条）、
 *     安全设备定期检查（第21条）、责任书备案（第11条）。
 */

/* ---------------------------------------------------------------- 时间工具 */

export function assertISO(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`日期必须为 YYYY-MM-DD，收到：${iso}`);
  }
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`非法日期：${iso}`);
  return iso;
}

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso, n) {
  assertISO(iso);
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

/** 加 N 个月，月末钳制（1-31 加 6 个月落在平月时收回到 2-28） */
export function addMonthsISO(iso, n) {
  assertISO(iso);
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO); assertISO(todayISOStr);
  const a = new Date(`${targetISO}T00:00:00`);
  const b = new Date(`${todayISOStr}T00:00:00`);
  return Math.round((a - b) / 86400000);
}

export function monthKey(iso) {
  assertISO(iso);
  return iso.slice(0, 7);
}

export function ageOn(birthdayISO, onISO) {
  assertISO(birthdayISO); assertISO(onISO);
  const b = birthdayISO.split('-').map(Number);
  const t = onISO.split('-').map(Number);
  let age = t[0] - b[0];
  if (t[1] < b[1] || (t[1] === b[1] && t[2] < b[2])) age -= 1;
  return age;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ------------------------------------------------------------ 口径与常量 */

export const DEFAULT_SETTINGS = {
  certWarnDays: 60,        // 证照黄线（通识先验，属地永远赢）
  certRedDays: 15,         // 证照红线（临期告急）
  inspectionMonths: 6,     // 安全技术检验周期 = 法定每半年（第20条）
  auditMonths: 12,         // 驾驶人审验周期 = 法定每年（第26条）
  driverMinAge: 25,        // 校车驾驶资格年龄下限（第23条(一)）
  driverMaxAge: 60,        // 年龄上限（第23条(一)）
  drillCycleDays: 180,     // 应急演练「定期」（第12条，学期节奏参数化）
  eduCycleDays: 180,       // 学生交通安全教育（第12条）
  driverEduCycleDays: 90,  // 驾驶人安全教育（第10条「定期」参数化）
  escortCycleDays: 180,    // 照管人员培训（第38条「定期」参数化）
  deviceCycleDays: 30,     // 安全设备检查（第21条「定期」参数化）
  bookFileCycleDays: 365,  // 责任书备案复核（第11条参数化）
};

/** 出车前检查七项 —— 第41条逐项原文列举：制动、转向、外部照明、轮胎、安全门、座椅、安全带 */
export const PRECHECK_ITEMS = [
  { key: 'brake', label: '制动' },
  { key: 'steering', label: '转向' },
  { key: 'lights', label: '外部照明' },
  { key: 'tyres', label: '轮胎' },
  { key: 'door', label: '安全门' },
  { key: 'seats', label: '座椅' },
  { key: 'belts', label: '安全带' },
];

/** 车内三查 —— 第39条(五)「核实学生下车人数，确认全部离车」的执行细化（工具口径，属地永远赢） */
export const RECHECK_ITEMS = [
  { key: 'seats', label: '座位前后' },
  { key: 'aisle', label: '过道车尾' },
  { key: 'space', label: '行李与车窗' },
];

export const TRIP_SLOTS = { am: '早送学', pm: '晚接回', other: '其他趟次' };

export const TRIP_STATUS = {
  checking: '出车前检查中',
  ready: '待出发（检查通过）',
  boarded: '在途/已载学生',
  closed: '已闭环（全数离车）',
  cancelled: '已取消（留痕）',
};

export const DUTY_KINDS = {
  drill: { label: '校车安全事故应急处理演练', cycleKey: 'drillCycleDays', basis: '条例第12条' },
  edu: { label: '学生交通安全教育（含监护人）', cycleKey: 'eduCycleDays', basis: '条例第12条' },
  driverEdu: { label: '驾驶人安全教育（法规/应急/救援）', cycleKey: 'driverEduCycleDays', basis: '条例第10条' },
  escortTraining: { label: '随车照管人员安全教育', cycleKey: 'escortCycleDays', basis: '条例第38条' },
  deviceCheck: { label: '安全设备与卫星定位检查', cycleKey: 'deviceCycleDays', basis: '条例第21条' },
  bookFile: { label: '校车安全管理责任书备案复核', cycleKey: 'bookFileCycleDays', basis: '条例第11条' },
};

export const REJECT_REASONS = {
  NO_BUS: '车辆不存在或已停用',
  NO_DRIVER: '驾驶人不存在或已停用',
  DRIVER_UNQUALIFIED: '该驾驶人未登记校车驾驶资格取得日期（条例第23/25条：未取得资格不得驾驶、禁止聘用）',
  DRIVER_AGE: `驾驶人年龄超出校车驾驶资格范围（条例第23条(一)：25~60 周岁）`,
  NO_ESCORT: '未指派随车照管人员（条例第38条：应指派照管人员随车全程照管；违者第53条可处 500 元）',
  DUP_TRIP: '同一车辆同日同趟次已有登记',
  NOT_CHECKING: '趟次不在「出车前检查中」状态',
  NOT_READY: '趟次未完成出车前检查（条例第41条：出车前应当检查车况）',
  NOT_BOARDED: '趟次不在「已载学生」状态',
  HAZARD_REQUIRED: '检查存在异常项，必须先登记隐患与整改措施（条例第22条：不符合安全技术条件的应当停运维修）',
  HAZARD_OPEN: '该车存在未闭环隐患——带病校车开不了趟（条例第41条：不得驾驶存在安全隐患的校车上道路行驶）',
  OVERLOAD: '上车人数超过核定人数——校车不得以任何理由超员（条例第34条；刑修九后严重超员构成危险驾驶罪）',
  ON_CONFIRM_REQUIRED: '必须确认「已清点人数、指导落座系好安全带、关闭车门」（条例第39条(三)）',
  COUNT_MISMATCH: '下车人数与上车人数对不上——中途下车必须逐人登记原因（条例第39条(五)：核实下车人数）',
  MID_NOTE_REQUIRED: '有中途下车必须写明原因',
  RECHECK_REQUIRED: '车内三查未逐项确认——未确认全数离车不得闭环（条例第39条(五)）',
  CLOSED_IMMUTABLE: '已闭环趟次为底账，不可修改或取消；漏点须当日补记事件并如实说明',
  NO_MEASURE: '隐患必须登记整改措施',
  CLOSED_TWICE: '该隐患已闭环，不可重复销案',
  BAD_COUNT: '人数必须为非负整数',
};

/* ------------------------------------------------------------ 证照钟引擎 */

export function certLevel(days, settings = DEFAULT_SETTINGS) {
  if (days < 0) return 'expired';
  if (days <= settings.certRedDays) return 'red';
  if (days <= settings.certWarnDays) return 'warn';
  return 'ok';
}

/** 车辆四钟：每半年安检（第20条）/ 标牌有效期（第16条）/ 交强险（道交法强制）/ 承运人责任险（第14条(五)） */
export function busClocks(bus, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  assertISO(todayISOStr);
  const clocks = [];
  const push = (key, label, dueISO, basis) => {
    if (!dueISO) {
      clocks.push({ key, label, dueISO: '', days: null, level: 'expired', basis, missing: true });
      return;
    }
    const days = daysUntil(dueISO, todayISOStr);
    clocks.push({ key, label, dueISO, days, level: certLevel(days, settings), basis });
  };
  push('inspection', '安全技术检验（每半年）', bus.inspectionLastISO ? addMonthsISO(bus.inspectionLastISO, settings.inspectionMonths) : '', '条例第20条');
  push('plate', '校车标牌有效期', bus.plateExpiryISO, '条例第16条');
  push('cvt', '交通事故责任强制保险', bus.insuranceCvtExpiryISO, '道交法强制险');
  push('carrier', '承运人责任保险', bus.insuranceCarrierExpiryISO, '条例第14条(五)');
  return clocks;
}

export function busClockReds(bus, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  return busClocks(bus, todayISOStr, settings).filter((c) => c.level === 'expired' || c.level === 'red');
}

/** 驾驶人两钟：年度审验（第26条）+ 年龄红线（第23条(一)） */
export function driverClocks(driver, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  assertISO(todayISOStr);
  const clocks = [];
  if (!driver.qualificationDateISO) {
    clocks.push({ key: 'qualification', label: '校车驾驶资格', dueISO: '', days: null, level: 'expired', basis: '条例第23/24条', missing: true });
  }
  if (driver.auditLastISO) {
    const due = addMonthsISO(driver.auditLastISO, settings.auditMonths);
    const days = daysUntil(due, todayISOStr);
    clocks.push({ key: 'audit', label: '年度审验', dueISO: due, days, level: certLevel(days, settings), basis: '条例第26条' });
  } else {
    clocks.push({ key: 'audit', label: '年度审验', dueISO: '', days: null, level: 'expired', basis: '条例第26条', missing: true });
  }
  const age = driver.birthdayISO ? ageOn(driver.birthdayISO, todayISOStr) : null;
  if (age !== null && age > settings.driverMaxAge) {
    clocks.push({ key: 'age', label: '年龄红线', dueISO: '', days: null, level: 'expired', basis: '条例第23条(一)', missing: false, detail: `已 ${age} 周岁，超 ${settings.driverMaxAge} 周岁上限` });
  }
  return clocks;
}

export function driverOk(driver, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  return driverClocks(driver, todayISOStr, settings).every((c) => c.level !== 'expired');
}

/* ------------------------------------------------------------ 档案与人员 */

export function addBus(state, { plate, model = '', seats, plateNo = '', plateExpiryISO = '', usePermitDateISO = '', inspectionLastISO = '', insuranceCvtExpiryISO = '', insuranceCarrierExpiryISO = '', note = '' }) {
  if (!plate || !String(plate).trim()) throw new Error(REJECT_REASONS.NO_BUS);
  const n = Number(seats);
  if (!Number.isInteger(n) || n < 1 || n > 66) throw new Error('核定人数必须为 1~66 的整数（行驶证签注口径，条例第15条）');
  const bus = {
    id: `b${++state.seq.bus}`, plate: String(plate).trim(), model: String(model).trim(), seats: n,
    plateNo: String(plateNo).trim(), plateExpiryISO: plateExpiryISO || '', usePermitDateISO: usePermitDateISO || '',
    inspectionLastISO: inspectionLastISO || '', insuranceCvtExpiryISO: insuranceCvtExpiryISO || '',
    insuranceCarrierExpiryISO: insuranceCarrierExpiryISO || '', status: 'active', note: String(note).trim(),
  };
  state.buses.push(bus);
  return bus;
}

export function retireBus(state, busId) {
  const bus = state.buses.find((b) => b.id === busId);
  if (!bus) throw new Error(REJECT_REASONS.NO_BUS);
  bus.status = 'retired';
  return bus;
}

export function updateBusInspection(state, busId, inspectionLastISO) {
  assertISO(inspectionLastISO);
  const bus = state.buses.find((b) => b.id === busId);
  if (!bus) throw new Error(REJECT_REASONS.NO_BUS);
  bus.inspectionLastISO = inspectionLastISO;
  return bus;
}

export function addDriver(state, { name, licenseClass = '', birthdayISO = '', qualificationDateISO = '', auditLastISO = '', phone = '', note = '' }) {
  if (!name || !String(name).trim()) throw new Error('姓名必填');
  const driver = {
    id: `d${++state.seq.driver}`, name: String(name).trim(), licenseClass: String(licenseClass).trim(),
    birthdayISO: birthdayISO || '', qualificationDateISO: qualificationDateISO || '',
    auditLastISO: auditLastISO || '', phone: String(phone).trim(), status: 'active', note: String(note).trim(),
  };
  state.drivers.push(driver);
  return driver;
}

export function addEscort(state, { name, phone = '', note = '' }) {
  if (!name || !String(name).trim()) throw new Error('姓名必填');
  const escort = {
    id: `e${++state.seq.escort}`, name: String(name).trim(), phone: String(phone).trim(),
    status: 'active', note: String(note).trim(),
  };
  state.escorts.push(escort);
  return escort;
}

/* ------------------------------------------------------------ 趟次点名引擎 */

/** 新建趟次：资格与指派红线在前——无照管人员不开趟、无资格不开趟、超龄不开趟（第23/25/38条） */
export function startTrip(state, { busId, driverId, escortIds, dateISO, slot = 'am', route = '' }) {
  assertISO(dateISO);
  const bus = state.buses.find((b) => b.id === busId && b.status === 'active');
  if (!bus) throw new Error(REJECT_REASONS.NO_BUS);
  const driver = state.drivers.find((d) => d.id === driverId && d.status === 'active');
  if (!driver) throw new Error(REJECT_REASONS.NO_DRIVER);
  if (!driver.qualificationDateISO) throw new Error(REJECT_REASONS.DRIVER_UNQUALIFIED);
  if (driver.birthdayISO) {
    const age = ageOn(driver.birthdayISO, dateISO);
    if (age > DEFAULT_SETTINGS.driverMaxAge || age < DEFAULT_SETTINGS.driverMinAge) {
      throw new Error(REJECT_REASONS.DRIVER_AGE);
    }
  }
  const escorts = (escortIds || []).map((id) => state.escorts.find((e) => e.id === id && e.status === 'active')).filter(Boolean);
  if (!escorts.length) throw new Error(REJECT_REASONS.NO_ESCORT);
  if (!TRIP_SLOTS[slot]) throw new Error(`未知趟次类型：${slot}`);
  if (state.trips.some((t) => t.busId === busId && t.dateISO === dateISO && t.slot === slot && t.status !== 'cancelled')) {
    throw new Error(REJECT_REASONS.DUP_TRIP);
  }
  const trip = {
    id: `t${++state.seq.trip}`, busId, driverId, escortIds: escorts.map((e) => e.id),
    dateISO, slot, route: String(route).trim(),
    check: null,            // { items: {key:bool}, note, abnormal, checkedISO }
    onCount: null, onConfirmed: false, boardedISO: '',
    midOffCount: 0, midNote: '',
    offCount: null, recheck: null, closedISO: '',
    hazardIds: [], status: 'checking',
  };
  state.trips.push(trip);
  return trip;
}

/** 出车前七项检查（第41条逐项）：全部正常 → 待出发；有异常必须先登记隐患，且闭环前开不了趟 */
export function preCheck(state, tripId, { items, note = '', dateISO = todayISO() }) {
  const trip = state.trips.find((t) => t.id === tripId);
  if (!trip) throw new Error('趟次不存在');
  if (trip.status !== 'checking') throw new Error(REJECT_REASONS.NOT_CHECKING);
  const marks = {};
  for (const it of PRECHECK_ITEMS) {
    if (typeof items?.[it.key] !== 'boolean') throw new Error(`检查项「${it.label}」必须逐项确认`);
    marks[it.key] = items[it.key];
  }
  const abnormalKeys = PRECHECK_ITEMS.filter((it) => !marks[it.key]).map((it) => it.key);
  if (abnormalKeys.length) {
    const labels = PRECHECK_ITEMS.filter((it) => abnormalKeys.includes(it.key)).map((it) => it.label).join('、');
    const hz = state.hazards.find((h) => h.tripId === tripId && h.status === 'open');
    if (!hz) throw new Error(`${REJECT_REASONS.HAZARD_REQUIRED}（异常项：${labels}）`);
    trip.hazardIds.push(hz.id);
  }
  trip.check = { items: marks, note: String(note).trim(), abnormal: abnormalKeys.length > 0, checkedISO: dateISO };
  trip.status = 'ready';
  return trip;
}

/** 为检查异常强制补建隐患单（UI 在 preCheck 前调用），整改措施必填（条例第22条停运维修口径） */
export function openHazard(state, { busId, tripId = '', dateISO, item, measure, deadlineISO = '', note = '' }) {
  if (!item || !String(item).trim()) throw new Error('隐患事项必填');
  if (!measure || !String(measure).trim()) throw new Error(REJECT_REASONS.NO_MEASURE);
  assertISO(dateISO);
  const hz = {
    id: `h${++state.seq.hazard}`, busId, tripId, dateISO, item: String(item).trim(),
    measure: String(measure).trim(), deadlineISO: deadlineISO || '', closedISO: '', closeNote: '',
    status: 'open', note: String(note).trim(),
  };
  state.hazards.push(hz);
  return hz;
}

export function closeHazard(state, hazardId, { closedISO, closeNote = '' }) {
  assertISO(closedISO);
  const hz = state.hazards.find((h) => h.id === hazardId);
  if (!hz) throw new Error('隐患不存在');
  if (hz.status === 'closed') throw new Error(REJECT_REASONS.CLOSED_TWICE);
  hz.status = 'closed';
  hz.closedISO = closedISO;
  hz.closeNote = String(closeNote).trim();
  return hz;
}

export function openHazards(state, busId = null) {
  return state.hazards.filter((h) => h.status === 'open' && (busId ? h.busId === busId : true));
}

/** 上车点名（第39条(三)）：清点人数、落座系带、关门示意——超员在此被硬性拒绝（第34条） */
export function board(state, tripId, { onCount, onConfirmed, dateISO = todayISO() }) {
  const trip = state.trips.find((t) => t.id === tripId);
  if (!trip) throw new Error('趟次不存在');
  if (trip.status !== 'ready') throw new Error(REJECT_REASONS.NOT_READY);
  const n = Number(onCount);
  if (!Number.isInteger(n) || n < 0) throw new Error(REJECT_REASONS.BAD_COUNT);
  const bus = state.buses.find((b) => b.id === trip.busId);
  if (n > bus.seats) throw new Error(`${REJECT_REASONS.OVERLOAD}（核载 ${bus.seats} 人，点名 ${n} 人）`);
  if (trip.check.abnormal && openHazards(state, trip.busId).some((h) => trip.hazardIds.includes(h.id))) {
    throw new Error(REJECT_REASONS.HAZARD_OPEN);
  }
  if (onConfirmed !== true) throw new Error(REJECT_REASONS.ON_CONFIRM_REQUIRED);
  trip.onCount = n;
  trip.onConfirmed = true;
  trip.boardedISO = dateISO;
  trip.status = 'boarded';
  return trip;
}

/** 下车清点（第39条(五)）：人数守恒 + 中途下车逐人留因 + 车内三查全勾才许闭环 */
export function alight(state, tripId, { offCount, midOffCount = 0, midNote = '', recheck, dateISO = todayISO() }) {
  const trip = state.trips.find((t) => t.id === tripId);
  if (!trip) throw new Error('趟次不存在');
  if (trip.status !== 'boarded') throw new Error(REJECT_REASONS.NOT_BOARDED);
  const off = Number(offCount);
  const mid = Number(midOffCount);
  if (!Number.isInteger(off) || off < 0) throw new Error(REJECT_REASONS.BAD_COUNT);
  if (!Number.isInteger(mid) || mid < 0 || mid > trip.onCount) throw new Error(REJECT_REASONS.BAD_COUNT);
  if (off + mid !== trip.onCount) {
    throw new Error(`${REJECT_REASONS.COUNT_MISMATCH}（上车 ${trip.onCount} = 到校下车 ${off} + 中途下车 ${mid}）`);
  }
  if (mid > 0 && !String(midNote).trim()) throw new Error(REJECT_REASONS.MID_NOTE_REQUIRED);
  const marks = {};
  for (const it of RECHECK_ITEMS) {
    if (recheck?.[it.key] !== true) throw new Error(`${REJECT_REASONS.RECHECK_REQUIRED}（缺：${it.label}）`);
    marks[it.key] = true;
  }
  trip.offCount = off;
  trip.midOffCount = mid;
  trip.midNote = String(midNote).trim();
  trip.recheck = { items: marks, checkedISO: dateISO };
  trip.status = 'closed';
  trip.closedISO = dateISO;
  return trip;
}

export function cancelTrip(state, tripId, { note = '' } = {}) {
  const trip = state.trips.find((t) => t.id === tripId);
  if (!trip) throw new Error('趟次不存在');
  if (trip.status === 'closed') throw new Error(REJECT_REASONS.CLOSED_IMMUTABLE);
  trip.status = 'cancelled';
  trip.cancelNote = String(note).trim();
  return trip;
}

/** 人数守恒：闭环趟次 Σ上车 = Σ到校下车 + Σ中途下车；取消趟次不计入（留痕不入账） */
export function tripConservation(state, month = null) {
  const trips = state.trips.filter((t) => t.status === 'closed' && (!month || monthKey(t.dateISO) === month));
  const on = trips.reduce((s, t) => s + (t.onCount || 0), 0);
  const off = trips.reduce((s, t) => s + (t.offCount || 0), 0);
  const mid = trips.reduce((s, t) => s + (t.midOffCount || 0), 0);
  return { trips: trips.length, on, off, mid, ok: on === off + mid };
}

/* ------------------------------------------------------------ 周期义务账 */

export function setDutyDone(state, kind, doneISO, note = '') {
  if (!DUTY_KINDS[kind]) throw new Error(`未知义务类型：${kind}`);
  assertISO(doneISO);
  let duty = state.duties.find((d) => d.kind === kind);
  if (!duty) {
    duty = { id: `o${++state.seq.duty}`, kind, lastDoneISO: '', note: '' };
    state.duties.push(duty);
  }
  duty.lastDoneISO = doneISO;
  duty.note = String(note).trim();
  return duty;
}

export function dutyState(duty, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  const meta = DUTY_KINDS[duty.kind];
  if (!duty.lastDoneISO) {
    return { ...meta, kind: duty.kind, lastDoneISO: '', dueISO: '', days: null, level: 'expired' };
  }
  const due = addDays(duty.lastDoneISO, settings[meta.cycleKey] ?? 180);
  const days = daysUntil(due, todayISOStr);
  return { ...meta, kind: duty.kind, lastDoneISO: duty.lastDoneISO, dueISO: due, days, level: days < 0 ? 'expired' : days <= 30 ? 'warn' : 'ok' };
}

export function dutyBoard(state, todayISOStr = todayISO()) {
  const kinds = Object.keys(DUTY_KINDS);
  return kinds.map((k) => {
    const duty = state.duties.find((d) => d.kind === k) || { kind: k, lastDoneISO: '', note: '' };
    return dutyState(duty, todayISOStr, state.settings || DEFAULT_SETTINGS);
  });
}

/* ------------------------------------------------------------ 看板与体检 */

export function staleTrips(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  return state.trips.filter((t) => !['closed', 'cancelled'].includes(t.status) && t.dateISO < todayISOStr);
}

export function healthCheck(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  const s = state.settings || DEFAULT_SETTINGS;
  const lights = [];
  let score = 100;

  const activeBuses = state.buses.filter((b) => b.status === 'active');
  const redCerts = [];
  for (const bus of activeBuses) {
    for (const c of busClockReds(bus, todayISOStr, s)) redCerts.push({ bus: bus.plate, ...c });
  }
  const lost = Math.min(30, redCerts.length * 10);
  score -= lost;
  lights.push({ key: 'cert', label: '车辆证照钟（安检/标牌/双险）', level: redCerts.length ? 'red' : 'ok', lost, detail: redCerts.length ? redCerts.map((c) => `${c.bus}·${c.label}`) : [] });

  const badDrivers = state.drivers.filter((d) => d.status === 'active' && !driverOk(d, todayISOStr, s));
  const lost2 = Math.min(25, badDrivers.length * 10);
  score -= lost2;
  lights.push({ key: 'driver', label: '驾驶人资格（审验/年龄）', level: badDrivers.length ? 'red' : 'ok', lost: lost2, detail: badDrivers.map((d) => d.name) });

  const stale = staleTrips(state, todayISOStr);
  const lost3 = stale.length * 10;
  score -= Math.min(20, lost3);
  lights.push({ key: 'stale', label: '未闭环趟次（过日未点名）', level: stale.length ? 'red' : 'ok', lost: Math.min(20, lost3), detail: stale.map((t) => `${t.dateISO}·${TRIP_SLOTS[t.slot]}`) });

  const hzOverdue = state.hazards.filter((h) => h.status === 'open' && h.deadlineISO && h.deadlineISO < todayISOStr);
  const lost4 = hzOverdue.length * 10;
  score -= Math.min(15, lost4);
  lights.push({ key: 'hzOverdue', label: '隐患整改超期未闭环', level: hzOverdue.length ? 'red' : 'ok', lost: Math.min(15, lost4), detail: hzOverdue.map((h) => h.item) });

  const hzOpen = openHazards(state);
  const lost5 = hzOpen.length * 5;
  score -= Math.min(10, lost5);
  lights.push({ key: 'hzOpen', label: '在册未闭环隐患', level: hzOpen.length ? 'warn' : 'ok', lost: Math.min(10, lost5), detail: hzOpen.map((h) => h.item) });

  const duties = dutyBoard(state, todayISOStr);
  const overdueDuties = duties.filter((d) => d.level === 'expired');
  const lost6 = overdueDuties.length * 5;
  score -= Math.min(20, lost6);
  lights.push({ key: 'duty', label: '周期义务（演练/教育/培训/设备/责任书）', level: overdueDuties.length ? 'red' : 'ok', lost: Math.min(20, lost6), detail: overdueDuties.map((d) => d.label) });

  score = Math.max(0, score);
  return { score, lights };
}

export function monthlySummary(state, month, todayISOStr = todayISO()) {
  const trips = state.trips.filter((t) => monthKey(t.dateISO) === month);
  const closed = trips.filter((t) => t.status === 'closed');
  const conserve = tripConservation(state, month);
  return {
    month,
    tripCount: trips.filter((t) => t.status !== 'cancelled').length,
    closed: closed.length,
    cancelled: trips.filter((t) => t.status === 'cancelled').length,
    on: conserve.on, off: conserve.off, mid: conserve.mid,
    conserveOk: conserve.ok,
    abnormal: closed.filter((t) => t.check?.abnormal).length,
    midOff: closed.filter((t) => t.midOffCount > 0).length,
    hazardsOpened: state.hazards.filter((h) => monthKey(h.dateISO) === month).length,
    hazardsClosed: state.hazards.filter((h) => h.status === 'closed' && monthKey(h.closedISO) === month).length,
    staleTrips: staleTrips(state, todayISOStr).map((t) => `${t.dateISO}·${TRIP_SLOTS[t.slot]}`),
  };
}

/* ------------------------------------------------------------ 出证三通道 */

/** 趟次点名卡：一张纸带走一趟的法定动作（第38/39/41条），签字栏齐全 */
export function tripCardHtml(state, tripId) {
  const t = state.trips.find((x) => x.id === tripId);
  if (!t) throw new Error('趟次不存在');
  const bus = state.buses.find((b) => b.id === t.busId) || {};
  const driver = state.drivers.find((d) => d.id === t.driverId) || {};
  const escorts = (t.escortIds || []).map((id) => state.escorts.find((e) => e.id === id)).filter(Boolean);
  const pc = t.check ? PRECHECK_ITEMS.map((it) => `${it.label}${t.check.items[it.key] ? '√' : '×'}`).join('　') : '未检查';
  const rc = t.recheck ? RECHECK_ITEMS.map((it) => `${it.label}${t.recheck.items[it.key] ? '√' : '×'}`).join('　') : '未清点';
  const org = state.org?.name || '';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>校车趟次点名卡 ${escapeHtml(t.dateISO)}</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;color:#111;padding:28px;max-width:720px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:12px 0}
td,th{border:1px solid #999;padding:7px 9px;font-size:13px;text-align:left}th{background:#f3f4f6;width:120px}
.sig{margin-top:26px;display:flex;gap:26px;font-size:13px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px}
.small{color:#555;font-size:11px;line-height:1.7;margin-top:18px}@media print{body{padding:0}}</style></head><body>
<h1>校车趟次点名卡</h1><div style="font-size:12px;color:#555">${escapeHtml(org)} · 依据《校车安全管理条例》第38/39/41条</div>
<table><tr><th>日期 / 趟次</th><td>${escapeHtml(t.dateISO)} · ${TRIP_SLOTS[t.slot] || t.slot}${t.route ? ` · 线路：${escapeHtml(t.route)}` : ''}</td></tr>
<tr><th>车辆</th><td>${escapeHtml(bus.plate || t.busId)}${bus.plateNo ? `（标牌 ${escapeHtml(bus.plateNo)}）` : ''} · 核载 ${bus.seats ?? '?'} 人</td></tr>
<tr><th>驾驶人</th><td>${escapeHtml(driver.name || t.driverId)}${driver.licenseClass ? ` · ${escapeHtml(driver.licenseClass)}` : ''}</td></tr>
<tr><th>随车照管员</th><td>${escorts.map((e) => escapeHtml(e.name)).join('、') || '—'}</td></tr>
<tr><th>出车前检查</th><td>${pc}${t.check?.abnormal ? ' · 含异常（隐患已登记）' : ''}</td></tr>
<tr><th>上车点名</th><td>${t.onCount ?? '未点名'} 人${t.onConfirmed ? ' · 已确认落座系带关门' : ''}</td></tr>
<tr><th>中途下车</th><td>${t.midOffCount || 0} 人${t.midNote ? ` · ${escapeHtml(t.midNote)}` : ''}</td></tr>
<tr><th>下车清点</th><td>${t.offCount ?? '未清点'} 人 · 车内三查：${rc}</td></tr>
<tr><th>状态</th><td>${TRIP_STATUS[t.status] || t.status}${t.closedISO ? ` · 闭环时间 ${escapeHtml(t.closedISO)}` : ''}</td></tr></table>
<div class="sig"><div>驾驶人签字</div><div>随车照管员签字</div><div>复核（安全管理人员）</div></div>
<p class="small">本卡为单位自查留痕底稿，依据《校车安全管理条例》第39条(三)(五)：清点上下车人数、确认全部离车后方可离车；不替代法定报送与执法文书。</p>
</body></html>`;
}

/** 迎检自证包：单位档案 + 一车一档四钟 + 人员资格 + 趟次守恒 + 隐患闭环 + 周期义务 + 体检 */
export function inspectHtml(state, todayISOStr = todayISO()) {
  const s = state.settings || DEFAULT_SETTINGS;
  const org = state.org || {};
  const sec = (title, inner) => `<section><h2>${title}</h2>${inner}</section>`;
  const busRows = state.buses.filter((b) => b.status === 'active').map((b) => {
    const clocks = busClocks(b, todayISOStr, s);
    const lvl = (c) => c.level === 'ok' ? '正常' : c.level === 'warn' ? `临期(${c.days}天)` : c.level === 'red' ? `告急(${c.days}天)` : '已过期';
    return `<tr><td>${escapeHtml(b.plate)}<br><span class="dim">${escapeHtml(b.model || '')}</span></td>
      <td>${b.seats}</td><td>${escapeHtml(b.plateNo || '—')}</td>
      <td>${clocks.map((c) => `${c.label}：${c.dueISO ? `${c.dueISO}（${lvl(c)}）` : '<b class="bad">未登记</b>'}`).join('<br>')}</td></tr>`;
  }).join('');
  const drvRows = state.drivers.filter((d) => d.status === 'active').map((d) => {
    const clocks = driverClocks(d, todayISOStr, s);
    const bad = !driverOk(d, todayISOStr, s);
    return `<tr class="${bad ? 'badrow' : ''}"><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.licenseClass || '—')}</td>
      <td>${d.qualificationDateISO || '<b class="bad">未登记</b>'}</td>
      <td>${d.auditLastISO || '<b class="bad">未登记</b>'} → ${clocks.find((c) => c.key === 'audit')?.dueISO || '—'}</td>
      <td>${d.birthdayISO ? `${d.birthdayISO}（${ageOn(d.birthdayISO, todayISOStr)} 岁）` : '—'}</td></tr>`;
  }).join('');
  const escRows = state.escorts.filter((e) => e.status === 'active').map((e) => `<tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.phone || '—')}</td><td>培训记录见「周期义务账」（第38条：定期对随车照管人员进行安全教育）</td></tr>`).join('');
  const tripRows = state.trips.slice(-40).reverse().map((t) => {
    const b = state.buses.find((x) => x.id === t.busId);
    return `<tr><td>${escapeHtml(t.dateISO)}</td><td>${TRIP_SLOTS[t.slot] || t.slot}</td><td>${escapeHtml(b?.plate || t.busId)}</td>
      <td>${t.onCount ?? '—'} / ${t.offCount ?? '—'}${t.midOffCount ? `（中途${t.midOffCount}）` : ''}</td>
      <td>${TRIP_STATUS[t.status] || t.status}</td></tr>`;
  }).join('');
  const hzRows = state.hazards.map((h) => `<tr><td>${escapeHtml(h.dateISO)}</td><td>${escapeHtml(h.item)}</td><td>${escapeHtml(h.measure)}</td>
    <td>${h.status === 'closed' ? `${escapeHtml(h.closedISO)} 闭环` : '<b class="bad">未闭环</b>'}</td></tr>`).join('');
  const dutyRows = dutyBoard(state, todayISOStr).map((d) => `<tr><td>${escapeHtml(d.label)}</td><td>${escapeHtml(d.basis)}</td>
    <td>${d.lastDoneISO || '<b class="warn">未登记</b>'}</td><td>${d.dueISO || '—'}${d.days !== null ? `（${d.days < 0 ? `逾期${-d.days}天` : `剩${d.days}天`}）` : ''}</td></tr>`).join('');
  const hc = healthCheck(state, todayISOStr);
  const conserve = tripConservation(state);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>校车安全迎检自证包 ${escapeHtml(todayISOStr)}</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;color:#111;padding:30px;max-width:860px;margin:0 auto;line-height:1.55}
h1{font-size:21px;margin:0}h2{font-size:15px;margin:26px 0 8px;border-left:4px solid #e09c00;padding-left:8px}
table{width:100%;border-collapse:collapse;margin:8px 0}td,th{border:1px solid #aaa;padding:6px 8px;font-size:12px;text-align:left;vertical-align:top}
th{background:#f3f4f6}.dim{color:#777;font-size:11px}.bad{color:#c22d1b}.warn{color:#9a6a00}
.badrow td{background:#fdf3f1}.sig{margin-top:30px;display:flex;gap:26px;font-size:13px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px}
.head{font-size:12px;color:#555;margin:4px 0 14px}.note{font-size:11px;color:#555;margin-top:20px;line-height:1.7}
@media print{body{padding:0}}</style></head><body>
<h1>校车安全台账 · 迎检自证包</h1>
<div class="head">${escapeHtml(org.name || '')}${org.kind ? ` · ${escapeHtml(org.kind)}` : ''}${org.district ? ` · ${escapeHtml(org.district)}` : ''} · 出证日 ${escapeHtml(todayISOStr)} · 体检得分 ${hc.score}</div>
${sec('一、单位与责任书备案（条例第10/11条）', `<table><tr><th>单位名称</th><td>${escapeHtml(org.name || '—')}</td><th>责任人</th><td>${escapeHtml(org.manager || '—')}${org.phone ? ` / ${escapeHtml(org.phone)}` : ''}</td></tr>
<tr><th>责任书备案日</th><td>${org.bookFileDateISO || '<b class="warn">未登记</b>'}（报教育行政部门备案，第11条）</td><th>安全管理人员</th><td>${escapeHtml(org.safetyOfficer || '—')}（第10条：配备安全管理人员）</td></tr></table>`)}
${sec('二、一车一档 · 车辆证照钟（第14~22条）', busRows ? `<table><tr><th>车辆</th><th>核载</th><th>校车标牌</th><th>四钟状态（每半年安检/标牌/交强险/承运人责任险）</th></tr>${busRows}</table>` : '<p class="warn">尚未登记车辆。</p>')}
${sec('三、驾驶人资格与审验（第23~26条）', drvRows ? `<table><tr><th>姓名</th><th>准驾车型</th><th>取得校车驾驶资格</th><th>最近审验 → 下次</th><th>出生/年龄</th></tr>${drvRows}</table>` : '<p class="warn">尚未登记驾驶人。</p>')}
${sec('四、随车照管人员（第38条）', escRows ? `<table><tr><th>姓名</th><th>最近培训</th></tr>${escRows}</table>` : '<p class="warn">尚未登记照管人员。</p>')}
${sec('五、近期趟次点名（第39/41条，最多近40趟）', tripRows ? `<table><tr><th>日期</th><th>趟次</th><th>车辆</th><th>上车/下车</th><th>状态</th></tr>${tripRows}</table>
<p class="note">全程守恒校验：Σ上车 ${conserve.on} = Σ下车 ${conserve.off} + Σ中途下车 ${conserve.mid} —— ${conserve.ok ? '✅ 一致' : '<b class="bad">不一致，须查明</b>'}</p>` : '<p class="warn">尚无趟次记录。</p>')}
${sec('六、隐患登记与整改闭环（第22/41条）', hzRows ? `<table><tr><th>发现日</th><th>事项</th><th>整改措施</th><th>闭环</th></tr>${hzRows}</table>` : '<p>在册无隐患登记。</p>')}
${sec('七、周期义务（第10/11/12/21/38条）', `<table><tr><th>义务</th><th>依据</th><th>最近完成</th><th>下次到期</th></tr>${dutyRows}</table>`)}
${sec('八、台账体检', `<p>得分 <b>${hc.score}</b>/100。${hc.lights.filter((l) => l.level !== 'ok').map((l) => `${l.label}（-${l.lost}）：${escapeHtml(l.detail.join('、'))}`).join('；') || '八灯全绿。'}</p>`)}
<div class="sig"><div>单位负责人签字</div><div>安全管理人员签字</div><div>日期：${escapeHtml(todayISOStr)}</div></div>
<p class="note">本包为「做动作即留痕」的自查底账汇总，依据《校车安全管理条例》（国务院令第617号）生成，条号见 docs/14；周期阈值为参数化口径，属地实施办法、教育行政部门与公安交管要求永远赢；本包不替代法定报送、许可文书与执法认定，不承诺执法采信。</p>
</body></html>`;
}

/** 月度小结微信文本 */
export function monthlyText(state, month) {
  const m = monthlySummary(state, month);
  const org = state.org?.name || '本单位';
  const lines = [
    `【校车安全月度小结】${org} · ${m.month}`,
    `趟次：有效 ${m.tripCount} 趟，闭环 ${m.closed} 趟${m.cancelled ? `（取消 ${m.cancelled} 趟留痕）` : ''}；出车检查含异常 ${m.abnormal} 趟、中途下车 ${m.midOff} 趟。`,
    `点名守恒：上车 ${m.on} = 下车 ${m.off} + 中途 ${m.mid}${m.conserveOk ? ' ✅ 一致' : ' ⚠️ 不一致，须查明'}`,
    `隐患：本月新登记 ${m.hazardsOpened} 项，闭环 ${m.hazardsClosed} 项。`,
  ];
  if (m.staleTrips.length) lines.push(`⚠️ 未闭环趟次 ${m.staleTrips.length} 个：${m.staleTrips.join('、')}（条例第39条(五) 全数离车确认未完成）`);
  const hc = healthCheck(state);
  lines.push(`台账体检：${hc.score}/100${hc.score < 100 ? '——红灯项请到「看板」逐项处理' : '，全绿'}`);
  lines.push('依据《校车安全管理条例》（国务院令第617号）留痕，属地要求永远赢。');
  return lines.join('\n');
}

/* ------------------------------------------------------------ 示例数据 */

/** 演示种子：1 家民办园 + 2 车 + 2 司机 + 2 照管员 + 跨状态趟次与隐患（相对 today 偏移，保证演示即时可读） */
export function seedState(todayISOStr = todayISO()) {
  const s = emptyState();
  s.org = {
    name: '示例·小橡树民办幼儿园', kind: '民办幼儿园', district: '示例市示例区',
    manager: '王园长', phone: '13800000001', address: '示例区示例路 1 号',
    safetyOfficer: '李老师', bookFileDateISO: addDays(todayISOStr, -300), note: '',
  };
  const b1 = addBus(s, {
    plate: '示例A·12345', model: '专用幼儿校车 19 座', seats: 19, plateNo: '校牌-0001',
    plateExpiryISO: addDays(todayISOStr, 200), usePermitDateISO: addDays(todayISOStr, -400),
    inspectionLastISO: addMonthsISO(addDays(todayISOStr, -150), 0),
    insuranceCvtExpiryISO: addDays(todayISOStr, 120), insuranceCarrierExpiryISO: addDays(todayISOStr, 45),
  });
  const b2 = addBus(s, {
    plate: '示例B·67890', model: '专用小学生校车 34 座', seats: 34, plateNo: '校牌-0002',
    plateExpiryISO: addDays(todayISOStr, 90), usePermitDateISO: addDays(todayISOStr, -400),
    inspectionLastISO: addMonthsISO(addDays(todayISOStr, -170), 0),
    insuranceCvtExpiryISO: addDays(todayISOStr, 30), insuranceCarrierExpiryISO: addDays(todayISOStr, 260),
  });
  const d1 = addDriver(s, { name: '张师傅', licenseClass: 'A1', birthdayISO: `${new Date().getFullYear() - 45}-01-01`, qualificationDateISO: addDays(todayISOStr, -380), auditLastISO: addDays(todayISOStr, -200) });
  const d2 = addDriver(s, { name: '刘师傅', licenseClass: 'B1', birthdayISO: `${new Date().getFullYear() - 52}-01-01`, qualificationDateISO: addDays(todayISOStr, -360), auditLastISO: addDays(todayISOStr, -330) });
  const e1 = addEscort(s, { name: '陈老师', phone: '13900000001' });
  const e2 = addEscort(s, { name: '赵老师', phone: '13900000002' });

  const t1 = startTrip(s, { busId: b1.id, driverId: d1.id, escortIds: [e1.id], dateISO: addDays(todayISOStr, -2), slot: 'am', route: '1 号线' });
  preCheck(s, t1.id, { items: Object.fromEntries(PRECHECK_ITEMS.map((i) => [i.key, true])), dateISO: addDays(todayISOStr, -2) });
  board(s, t1.id, { onCount: 16, onConfirmed: true, dateISO: addDays(todayISOStr, -2) });
  alight(s, t1.id, { offCount: 16, recheck: Object.fromEntries(RECHECK_ITEMS.map((i) => [i.key, true])), dateISO: addDays(todayISOStr, -2) });

  const t2 = startTrip(s, { busId: b1.id, driverId: d1.id, escortIds: [e1.id], dateISO: addDays(todayISOStr, -2), slot: 'pm', route: '1 号线' });
  preCheck(s, t2.id, { items: Object.fromEntries(PRECHECK_ITEMS.map((i) => [i.key, true])), dateISO: addDays(todayISOStr, -2) });
  board(s, t2.id, { onCount: 16, onConfirmed: true, dateISO: addDays(todayISOStr, -2) });
  alight(s, t2.id, { offCount: 15, midOffCount: 1, midNote: '家长中途接走（已电话确认）', recheck: Object.fromEntries(RECHECK_ITEMS.map((i) => [i.key, true])), dateISO: addDays(todayISOStr, -2) });

  const t3 = startTrip(s, { busId: b2.id, driverId: d2.id, escortIds: [e2.id], dateISO: addDays(todayISOStr, -1), slot: 'am', route: '2 号线' });
  openHazard(s, { busId: b2.id, tripId: t3.id, dateISO: addDays(todayISOStr, -1), item: '轮胎（出车前检查：左前胎压偏低）', measure: '停运充气至标准胎压，复查后销案', deadlineISO: addDays(todayISOStr, 1) });
  preCheck(s, t3.id, { items: { ...Object.fromEntries(PRECHECK_ITEMS.map((i) => [i.key, true])), tyres: false }, note: '左前胎压偏低', dateISO: addDays(todayISOStr, -1) });

  const t4 = startTrip(s, { busId: b2.id, driverId: d2.id, escortIds: [e2.id], dateISO: addDays(todayISOStr, -9), slot: 'am', route: '2 号线' });
  preCheck(s, t4.id, { items: Object.fromEntries(PRECHECK_ITEMS.map((i) => [i.key, true])), dateISO: addDays(todayISOStr, -9) });

  setDutyDone(s, 'drill', addDays(todayISOStr, -190));
  setDutyDone(s, 'edu', addDays(todayISOStr, -120));
  setDutyDone(s, 'driverEdu', addDays(todayISOStr, -50));
  setDutyDone(s, 'escortTraining', addDays(todayISOStr, -60));
  setDutyDone(s, 'deviceCheck', addDays(todayISOStr, -20));
  return s;
}

/* ------------------------------------------------------------ 状态与序列 */

export const STATE_VERSION = 1;

export function emptyState() {
  return {
    version: STATE_VERSION,
    org: { name: '', kind: '', district: '', manager: '', phone: '', address: '', safetyOfficer: '', bookFileDateISO: '', note: '' },
    buses: [],
    drivers: [],
    escorts: [],
    trips: [],
    hazards: [],
    duties: [],
    settings: { ...DEFAULT_SETTINGS },
    seq: { bus: 0, driver: 0, escort: 0, trip: 0, hazard: 0, duty: 0 },
    events: [],
  };
}

export function exportBundle(state) {
  return JSON.stringify(state, null, 2);
}

export function importBundle(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object' || !Array.isArray(s.buses)) throw new Error('不是有效的护学账备份文件');
  return { ...emptyState(), ...s };
}
