/**
 * core.js — 适飞单 WingSheet 纯域逻辑（零依赖、可单测）
 *
 * 全部法定口径锚定（均为一手全文核验，条号出处见 docs/14）：
 *  ·《无人驾驶航空器飞行管理暂行条例》（国务院、中央军委令第761号，2023-05-31 公布，
 *    2024-01-01 施行，截至 2026-09 未修订）——分类（第62条）、实名登记（第10条）、
 *    运营合格证（第11条）、责任保险（第12条）、操控员执照（第16/17条）、管制空域与
 *    适飞空域（第19条）、飞行申请「前1日12时」红线（第26条）、起飞前1小时报告（第30条）、
 *    免申请情形与5种例外（第31条）、行为规范（第32条）、异常24小时报告（第40条）、
 *    罚则（第47~51条）、存量机识别信息豁免的后果（第61条）。
 *  ·《民用无人驾驶航空器运行安全管理规则》CCAR-92部（交通运输部令2024年第1号，
 *    2024-01-01 公布施行）——执照有效期6年（第92.61条）、定期检查24个日历月（第92.81条）、
 *    熟练检查12个日历月（第92.83条）、实名登记标志（第92.211条）、飞行数据保存
 *    12/15个月（第92.547条）、运营合格证适用与豁免（第92.603条）、责任保险（第92.669条）、
 *    年度运营报告（第92.671条）、违反证照管理罚则（第92.1005条）。
 *  · GB 42590—2023《民用无人驾驶航空器系统安全要求》（微轻小型强制国标，2024-06-01 实施：
 *    电子围栏、远程识别）；GB 46761—2025《民用无人驾驶航空器实名登记和激活要求》
 *    （2026-05-01 实施：实名登记+激活扩至全量、含250克以下微型机）；新修订《治安管理
 *    处罚法》（2026-01-01 施行）第46条：违规飞行无人机属妨害公共安全，情节较重可拘留。
 *
 * 属地实施办法与空管机构要求永远赢；所有周期与阈值均为可覆盖参数——工具亮灯提示
 * 不替代法定义务、许可文书与执法认定。
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

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ------------------------------------------------------------ 口径与常量 */

export const DEFAULT_SETTINGS = {
  certWarnDays: 60,          // 证照黄线（通识先验，属地永远赢）
  certRedDays: 15,           // 证照红线（临期告急）
  licenseYears: 6,           // 操控员执照有效期（CCAR-92 第92.61条）
  profCheckMonths: 24,       // 定期检查周期：24 个日历月（CCAR-92 第92.81条）
  profCheckLargeMonths: 12,  // 大型机操控员熟练检查周期：12 个日历月（第92.83条）
  agriCertMonths: 24,        // 农用操作证书复训周期（生产者培训口径，参数化，属地/厂家永远赢）
  annualReportDays: 365,     // 年度运营报告报送（CCAR-92 第92.671条）
  uasInfoUpdateDays: 180,    // 无人机性能参数/改装信息复核（条例第14条、92.209，参数化）
  batteryCheckDays: 30,      // 电池健康与循环数检查（GB 42590 锂电池安全，工具口径）
  firmwareDays: 90,          // 固件与电子围栏数据更新（条例第32条(二)，参数化）
};

/** 无人机分类（条例第62条(二)~(六)：按空机重量与最大起飞重量判定） */
export const CATEGORY_META = {
  micro:  { label: '微型',  basis: '空机重量<0.25千克', clause: '条例第62条(二)' },
  light:  { label: '轻型',  basis: '空机≤4千克且最大起飞重量≤7千克', clause: '条例第62条(三)' },
  small:  { label: '小型',  basis: '空机≤15千克且最大起飞重量≤25千克', clause: '条例第62条(四)' },
  medium: { label: '中型',  basis: '最大起飞重量≤150千克', clause: '条例第62条(五)' },
  large:  { label: '大型',  basis: '最大起飞重量>150千克', clause: '条例第62条(六)' },
};

/** 航前检查单 —— 条例第32条行为规范 + CCAR-92 运行要求的执行细化（工具口径，属地永远赢） */
export const PREFLIGHT_ITEMS = [
  { key: 'fence', label: '电子围栏/限飞区数据已更新', basis: '条例第32条(二)；GB 42590' },
  { key: 'remoteId', label: '识别信息广播正常', basis: '条例第24条', microNa: true },
  { key: 'battery', label: '电池无鼓包、电量与备电充足', basis: 'GB 42590 锂电池安全' },
  { key: 'link', label: '遥控链路/图传/定位正常', basis: '工具口径' },
  { key: 'weather', label: '天气适航，夜间灯光正常', basis: '条例第32条(七)' },
  { key: 'meds', label: '未受酒精/麻醉剂/药物影响', basis: '条例第32条(九)；92.1013' },
  { key: 'los', label: '视距内保持或超视距措施就绪', basis: '条例第32条(五)(八)' },
  { key: 'frame', label: '桨叶/机体/挂载紧固', basis: '工具口径' },
  { key: 'payload', label: '未载危险品、不投放物品（或已获批）', basis: '条例第31/34条' },
  { key: 'crowd', label: '不飞越集会人群上空（或已获批）', basis: '条例第31条2款(三)' },
  { key: 'docs', label: '证照随身携带备查', basis: '条例第32条(一)' },
];

/** 需要飞行活动申请的情形（管制空域=条例第19条；31条2款5项；61条存量机） */
export const PERMIT_REASONS = {
  controlled:    { label: '管制空域内飞行', basis: '条例第19/26条' },
  relay:         { label: '经通信基站/互联网中继飞行', basis: '条例第31条2款(一)' },
  drop:          { label: '投放物品/运载危险品', basis: '条例第31条2款(二)' },
  crowd:         { label: '飞越集会人群上空', basis: '条例第31条2款(三)' },
  movingVehicle: { label: '在移动的交通工具上操控', basis: '条例第31条2款(四)' },
  swarm:         { label: '分布式操作或集群飞行', basis: '条例第31条2款(五)' },
  legacy:        { label: '存量机不能自动报送识别信息', basis: '条例第61条' },
};

export const PERMIT_STATUS = {
  planned: '待申请（盯住前1日12时红线）',
  applied: '已申请，待批复',
  approved: '已批准（起飞前1小时报告后可用）',
  denied: '未获批准',
  cancelled: '已取消（留痕）',
};

export const FLIGHT_PURPOSE = {
  commercial: '经营性飞行（航拍/巡检/测绘等）',
  agri: '常规农用作业飞行（植保/播种/投饵）',
  personal: '非经营性飞行',
  training: '训练飞行',
};

export const FLIGHT_STATUS = {
  checking: '航前检查中',
  cleared: '已放行 · 待起飞',
  flying: '在飞',
  closed: '已降落闭环',
  cancelled: '已取消（留痕）',
};

export const DUTY_KINDS = {
  annualReport:   { label: '年度运营报告报送（UOM 平台）', cycleKey: 'annualReportDays', basis: 'CCAR-92 第92.671条' },
  uasInfoUpdate:  { label: '无人机性能参数/改装信息复核', cycleKey: 'uasInfoUpdateDays', basis: '条例第14条 · 92.209' },
  batteryCheck:   { label: '电池健康与循环数检查', cycleKey: 'batteryCheckDays', basis: 'GB 42590（工具口径）' },
  firmwareFence:  { label: '固件与电子围栏数据更新', cycleKey: 'firmwareDays', basis: '条例第32条(二)（参数化）' },
  agriRecert:     { label: '农用操作证书复训', cycleKey: 'agriCertMonths', basis: '条例第16条2款（厂家/属地口径）' },
};

export const REJECT_REASONS = {
  NO_UAS: '无人机不存在或已停用',
  NO_PILOT: '操控员不存在或已停用',
  UNREGISTERED: '该机未实名登记——条例第10条（GB 46761—2025 起 250 克以下微型机也须登记）；未登记飞行第47条可罚 200 元~2 万元',
  NO_INSURANCE: '责任保险未投保或已过期——条例第12条（第48条：2000 元~2 万元，情节严重停业整顿直至吊销运营合格证）',
  NO_OP_CERT: '单位使用除微型以外的无人机飞行须先取得运营合格证——条例第11条（无证运行第49条：5 万~50 万元）',
  NO_LICENSE: '操控小型/中型/大型无人机须取得操控员执照——条例第16条（92.1005：无照飞行 5000 元~5 万元，情节严重 1 万~10 万元）',
  LICENSE_EXPIRED: '操控员执照已过有效期——CCAR-92 第92.61条（6 年有效，期满 30 个工作日前更新）',
  PROF_CHECK_OVERDUE: '执照定期检查超期——CCAR-92 第92.81条：行使权利前 24 个日历月内通过（大型机按第92.83条 12 个日历月）',
  NO_AGRI_CERT: '农用作业人员未取得操作证书——条例第16条2款：由生产者培训考核合格后取得',
  NO_PERMIT: '本次飞行需要事先批准——条例第19/26/31/61条：拟飞行前 1 日 12 时前向空管申请，未批准不得飞',
  PERMIT_NOT_APPROVED: '关联申请未获批准——条例第19条：未经批准不得在管制空域实施飞行',
  PRE_DEP_REQUIRED: '起飞前 1 小时须向空管报告预计起飞时刻并经确认——条例第30条',
  NOT_CHECKING: '架次不在「航前检查中」状态',
  NOT_CLEARED: '航前检查未通过——条例第32条(二)：飞行前做好安全飞行准备、检查无人机状态',
  NOT_FLYING: '架次不在「在飞」状态',
  ISSUE_REQUIRED: '检查存在异常项，必须先登记检修单与处置措施（第32条(二)）',
  ISSUE_OPEN: '该机存在未闭环检修项——带病机不开飞（第32条(二)：实施飞行活动前检查无人机状态）',
  CLOSED_IMMUTABLE: '已闭环架次为底账，不可修改或取消；漏记须如实补记事件并说明',
  NO_MEASURE: '检修单必须登记处置措施',
  CLOSED_TWICE: '该检修项已闭环，不可重复销案',
  BAD_NUMBER: '数值必须为非负数',
  APPLY_TOO_LATE: '已错过「拟飞行前 1 日 12 时前」的申请时限（条例第26条）——请重新安排飞行日期',
  BAD_CLASS: '重量参数不构成任何法定分类：请核对空机重量与最大起飞重量（条例第62条）',
};

/* ------------------------------------------------------------ 判档引擎 */

const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * 判档器（USP）：输入空机重量/最大起飞重量 → 微/轻/小/中/大（条例第62条）。
 * 农用意向须同时满足第62条(八)的作业包线（真高≤30米、平飞≤50km/h、半径≤2000米、
 * 且最大起飞重量≤150千克方可豁免运营合格证，条例第11条3款）。
 */
export function classifyUas({ emptyKg, mtowKg, agri = false, agriTrueHeightM = 30, agriSpeedKmh = 50, agriRadiusM = 2000 }) {
  const empty = num(emptyKg);
  const mtow = num(mtowKg);
  if (!Number.isFinite(empty) || !Number.isFinite(mtow) || empty <= 0 || mtow <= 0) {
    throw new Error('空机重量与最大起飞重量必须为正数（照铭牌/说明书填写，条例第62条）');
  }
  if (mtow < empty) throw new Error('最大起飞重量不能小于空机重量——请核对参数');
  let category = null;
  if (empty < 0.25) category = 'micro';
  else if (empty <= 4 && mtow <= 7) category = 'light';
  else if (empty <= 15 && mtow <= 25) category = 'small';
  else if (mtow <= 150) category = 'medium';
  else category = 'large';
  const meta = { ...CATEGORY_META[category], category };
  let agriOk = false;
  if (agri) {
    const h = num(agriTrueHeightM); const v = num(agriSpeedKmh); const r = num(agriRadiusM);
    agriOk = mtow <= 150 && h <= 30 && v <= 50 && r <= 2000;
    if (!agriOk) {
      throw new Error('不符合农用无人机作业包线（条例第62条(八)：真高≤30米、平飞≤50km/h、半径≤2000米；且第11条3款运营合格证豁免以最大起飞重量≤150千克为限）——请按普通分类管理');
    }
  }
  return { ...meta, agri, agriOk };
}

/** 农用作业飞行认定：agri 意向 + 包线达标（判定失败在 classifyUas 已拦截） */
export function agriOps(uas) {
  if (!uas?.agri) return false;
  const mtow = num(uas.mtowKg);
  const h = num(uas.agriTrueHeightM); const v = num(uas.agriSpeedKmh); const r = num(uas.agriRadiusM);
  return Number.isFinite(mtow) && mtow <= 150 && h <= 30 && v <= 50 && r <= 2000;
}

/**
 * 义务矩阵（USP）：判档结果 + 主体性质 + 任务性质 → 该机该飞必须齐备的法定动作清单。
 * 这是「飞之前就知道差哪张纸」的确定性引擎。
 */
export function obligations({ category, agriOps: agriRun = false, orgMode = 'personal', purpose = 'personal', legacyNoRemoteId = false }) {
  const heavy = ['small', 'medium', 'large'].includes(category);
  const commercial = purpose === 'commercial' || purpose === 'agri';
  const rows = [];
  rows.push({
    key: 'registration', required: true, label: '实名登记（含 250 克以下微型机，GB 46761—2025）',
    basis: '条例第10条 · 92.205/92.211', penalty: '第47条：200 元以下；情节严重 2000~2 万元',
  });
  if (category !== 'micro') {
    rows.push({
      key: 'remoteId', required: true, label: '识别信息报送/广播（除微型外）',
      basis: '条例第24条', penalty: legacyNoRemoteId ? '存量机不能自动报送的，一律申请批准后飞行（第61条）' : '',
    });
  }
  if (orgMode === 'unit' && category !== 'micro' && !agriRun) {
    rows.push({
      key: 'opCert', required: true, label: '运营合格证（单位 · 除微型外 · 常规农用豁免）',
      basis: '条例第11条 · 92.603', penalty: '第49条：5 万~50 万元',
    });
  }
  if (agriRun) {
    rows.push({
      key: 'agriCert', required: true, label: '农用操作证书（生产者培训考核，免操控员执照）',
      basis: '条例第16条2款', penalty: '无证作业按 92.1005 无照飞行口径处罚',
    });
  } else if (heavy) {
    rows.push({
      key: 'license', required: true, label: '操控员执照（小型/中型/大型）',
      basis: '条例第16条 · 92.61', penalty: '92.1005：5000~5 万元；情节严重 1 万~10 万元',
    });
  }
  if (category === 'light') {
    rows.push({
      key: 'lightControlled', required: false, label: '轻型机进管制空域：完全民事行为能力+培训合格',
      basis: '条例第17条3款', penalty: '',
    });
  }
  if (commercial || heavy) {
    rows.push({
      key: 'insurance', required: true, label: '责任保险（经营性飞行；或小/中/大型非经营性）',
      basis: '条例第12条 · 92.669', penalty: '第48条：2000~2 万元；情节严重停业整顿直至吊销',
    });
  }
  rows.push({
    key: 'airspace', required: false, label: '空域规则：管制空域/5 种特殊情形/存量机 → 先申请（前 1 日 12 时前）',
    basis: '条例第19/26/31/61条', penalty: '第51条：可处 1 万元以下；拒不改正 1 万~5 万',
  });
  return rows;
}

/* ------------------------------------------------------------ 证照钟引擎 */

export function certLevel(days, settings = DEFAULT_SETTINGS) {
  if (days < 0) return 'expired';
  if (days <= settings.certRedDays) return 'red';
  if (days <= settings.certWarnDays) return 'warn';
  return 'ok';
}

export function uasCategory(uas) {
  return classifyUas(uas).category;
}

/** 一机一档两钟：实名登记（长期有效，但须激活与信息更新）+ 责任保险 */
export function uasClocks(uas, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  assertISO(todayISOStr);
  const clocks = [];
  const cls = classifyUas(uas);
  if (!uas.regNo || !uas.registeredISO) {
    clocks.push({ key: 'registration', label: '实名登记', dueISO: '', days: null, level: 'expired', missing: true, basis: '条例第10条 · GB 46761—2025' });
  } else {
    clocks.push({
      key: 'registration', label: '实名登记', dueISO: `${uas.registeredISO} 登记（长期有效，信息变更须在 UOM 更新）`,
      days: 0, level: uas.markAffixed ? 'ok' : 'warn', basis: '条例第10条 · 92.211',
      detail: uas.markAffixed ? '' : '登记标志/二维码尚未确认粘贴或喷涂（92.211/92.213）',
    });
  }
  const needInsurance = uasNeedsInsurance(uas);
  if (needInsurance) {
    if (!uas.insuranceExpiryISO) {
      clocks.push({ key: 'insurance', label: '责任保险', dueISO: '', days: null, level: 'expired', missing: true, basis: '条例第12条 · 92.669' });
    } else {
      const days = daysUntil(uas.insuranceExpiryISO, todayISOStr);
      clocks.push({ key: 'insurance', label: '责任保险', dueISO: uas.insuranceExpiryISO, days, level: certLevel(days, settings), basis: '条例第12条 · 92.669' });
    }
  }
  if (cls.agriOk) {
    clocks.push({ key: 'agriWaiver', label: '常规农用作业：豁免运营合格证（≤150千克）', dueISO: '', days: 0, level: 'ok', basis: '条例第11条3款' });
  }
  if (uas.legacyNoRemoteId) {
    clocks.push({ key: 'legacy', label: '存量机不能自动报送识别信息：一律申请批准后飞行', dueISO: '', days: 0, level: 'warn', basis: '条例第61条' });
  }
  return clocks;
}

/** 该机是否需要责任保险（小/中/大任何用途需要；常规农用作业与经营用途需要——条例第12条） */
export function uasNeedsInsurance(uas) {
  const cls = classifyUas(uas);
  return ['small', 'medium', 'large'].includes(cls.category) || cls.agriOk || !!uas.commercialUse;
}

export function uasClockReds(uas, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  return uasClocks(uas, todayISOStr, settings).filter((c) => c.level === 'expired' || c.level === 'red');
}

/** 操控员三钟：执照有效期（92.61）+ 定期检查（92.81）/熟练检查（92.83）+ 农用操作证书 */
export function pilotClocks(pilot, todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  assertISO(todayISOStr);
  const clocks = [];
  if (pilot.licenseIssueISO) {
    const due = addMonthsISO(pilot.licenseIssueISO, settings.licenseYears * 12);
    const days = daysUntil(due, todayISOStr);
    clocks.push({ key: 'license', label: '操控员执照（6年有效）', dueISO: due, days, level: certLevel(days, settings), basis: 'CCAR-92 第92.61条' });
    const cycle = pilot.ifrLarge ? settings.profCheckLargeMonths : settings.profCheckMonths;
    const pDue = addMonthsISO(pilot.lastProfCheckISO || pilot.licenseIssueISO, cycle);
    const pDays = daysUntil(pDue, todayISOStr);
    clocks.push({
      key: 'profCheck', label: pilot.ifrLarge ? '熟练检查（大型/IFR，12个日历月）' : '定期检查（24个日历月）',
      dueISO: pDue, days: pDays, level: certLevel(pDays, settings), basis: pilot.ifrLarge ? 'CCAR-92 第92.83条' : 'CCAR-92 第92.81条',
    });
  }
  if (pilot.agriCertISO) {
    const due = addMonthsISO(pilot.agriCertISO, settings.agriCertMonths);
    const days = daysUntil(due, todayISOStr);
    clocks.push({ key: 'agriCert', label: '农用操作证书（参数化复训周期）', dueISO: due, days, level: certLevel(days, settings), basis: '条例第16条2款' });
  }
  return clocks;
}

/** 操控员可不可以飞：执照钟与检查钟任一过期即不可（农用证书过期只拦农用作业） */
export function pilotReadyFor(pilot, purpose = 'personal', todayISOStr = todayISO(), settings = DEFAULT_SETTINGS) {
  const clocks = pilotClocks(pilot, todayISOStr, settings);
  for (const c of clocks) {
    if (c.level === 'expired' && !(c.key === 'agriCert' && purpose !== 'agri')) return { ok: false, why: c };
  }
  return { ok: true, why: null };
}

/* ------------------------------------------------------------ 档案与人员 */

export function addUas(state, { nickname, model = '', sn = '', emptyKg, mtowKg, agri = false, agriTrueHeightM = 30, agriSpeedKmh = 50, agriRadiusM = 2000, legacyNoRemoteId = false, commercialUse = false, regNo = '', registeredISO = '', markAffixed = false, insuranceExpiryISO = '', note = '' }) {
  if (!nickname || !String(nickname).trim()) throw new Error('机昵称必填（例：云雀 Air-3）');
  const cls = classifyUas({ emptyKg, mtowKg, agri, agriTrueHeightM, agriSpeedKmh, agriRadiusM });
  const uas = {
    id: `u${++state.seq.uas}`, nickname: String(nickname).trim(), model: String(model).trim(), sn: String(sn).trim(),
    emptyKg: num(emptyKg), mtowKg: num(mtowKg), agri: !!agri,
    agriTrueHeightM: num(agriTrueHeightM), agriSpeedKmh: num(agriSpeedKmh), agriRadiusM: num(agriRadiusM),
    legacyNoRemoteId: !!legacyNoRemoteId, commercialUse: !!commercialUse, regNo: String(regNo).trim(), registeredISO: registeredISO || '',
    markAffixed: !!markAffixed, insuranceExpiryISO: insuranceExpiryISO || '', status: 'active', note: String(note).trim(),
  };
  state.uas.push(uas);
  return { uas, cls };
}

export function retireUas(state, uasId) {
  const uas = state.uas.find((u) => u.id === uasId);
  if (!uas) throw new Error(REJECT_REASONS.NO_UAS);
  uas.status = 'retired';
  return uas;
}

export function addPilot(state, { name, phone = '', licenseIssueISO = '', lastProfCheckISO = '', ifrLarge = false, agriCertISO = '', note = '' }) {
  if (!name || !String(name).trim()) throw new Error('姓名必填');
  const pilot = {
    id: `p${++state.seq.pilot}`, name: String(name).trim(), phone: String(phone).trim(),
    licenseIssueISO: licenseIssueISO || '', lastProfCheckISO: lastProfCheckISO || '',
    ifrLarge: !!ifrLarge, agriCertISO: agriCertISO || '', status: 'active', note: String(note).trim(),
  };
  state.pilots.push(pilot);
  return pilot;
}

/* ------------------------------------------------------------ 申请台账 */

/** 申请截止 = 飞行前 1 日 12:00；批复截止 = 飞行前 1 日 21:00（条例第26条原文时限） */
export function permitWindows(flyingDateISO) {
  assertISO(flyingDateISO);
  return { applyByISO: addDays(flyingDateISO, -1), decisionByISO: addDays(flyingDateISO, -1), applyByClock: '12:00', decisionByClock: '21:00' };
}

export function createPermit(state, { uasId, pilotId, flyingDateISO, reason = 'controlled', location = '', note = '' }) {
  assertISO(flyingDateISO);
  if (!PERMIT_REASONS[reason]) throw new Error(`未知申请事由：${reason}`);
  if (!state.uas.find((u) => u.id === uasId && u.status === 'active')) throw new Error(REJECT_REASONS.NO_UAS);
  if (!state.pilots.find((p) => p.id === pilotId && p.status === 'active')) throw new Error(REJECT_REASONS.NO_PILOT);
  const permit = {
    id: `m${++state.seq.permit}`, uasId, pilotId, flyingDateISO, reason, location: String(location).trim(),
    note: String(note).trim(), submittedISO: '', decidedISO: '', approved: false, permitNo: '', preDepISO: '',
    status: 'planned',
  };
  state.permits.push(permit);
  return permit;
}

/** 提交申请：硬性红线——必须不晚于「拟飞行前 1 日 12 时」（条例第26条1款） */
export function submitApplication(state, permitId, { submittedISO, nowISO = todayISO() }) {
  assertISO(submittedISO);
  const permit = state.permits.find((m) => m.id === permitId);
  if (!permit) throw new Error('申请不存在');
  if (permit.status !== 'planned') throw new Error(`该申请已不是「待申请」状态（${PERMIT_STATUS[permit.status]}）`);
  const { applyByISO } = permitWindows(permit.flyingDateISO);
  if (submittedISO > applyByISO) {
    throw new Error(`${REJECT_REASONS.APPLY_TOO_LATE}（截止 ${applyByISO} 12:00，今日 ${nowISO}）`);
  }
  permit.submittedISO = submittedISO;
  permit.status = 'applied';
  return permit;
}

/** 空管批复登记：批准/不批准 + 批复文号（条例第26条：飞行前 1 日 21 时前作出决定） */
export function decidePermit(state, permitId, { approved, decidedISO, permitNo = '', note = '' }) {
  assertISO(decidedISO);
  const permit = state.permits.find((m) => m.id === permitId);
  if (!permit) throw new Error('申请不存在');
  if (permit.status !== 'applied') throw new Error(`该申请不在「已申请」状态（${PERMIT_STATUS[permit.status]}）`);
  permit.approved = approved === true;
  permit.decidedISO = decidedISO;
  permit.permitNo = String(permitNo).trim();
  permit.closeNote = String(note).trim();
  permit.status = approved ? 'approved' : 'denied';
  return permit;
}

/** 起飞前 1 小时报告确认（条例第30条）——已批准的申请起飞前必须记录，且只记一次 */
export function recordPreDeparture(state, permitId, { preDepISO }) {
  assertISO(preDepISO);
  const permit = state.permits.find((m) => m.id === permitId);
  if (!permit) throw new Error('申请不存在');
  if (permit.status !== 'approved') throw new Error('申请未获批准，无需/不能登记起飞前报告');
  if (permit.preDepISO) throw new Error('该申请已登记起飞前报告，不可重复');
  permit.preDepISO = preDepISO;
  return permit;
}

export function cancelPermit(state, permitId, { note = '' } = {}) {
  const permit = state.permits.find((m) => m.id === permitId);
  if (!permit) throw new Error('申请不存在');
  permit.status = 'cancelled';
  permit.cancelNote = String(note).trim();
  return permit;
}

/** 本架次是否需要申请：管制空域、31条2款5种情形、存量机（61条） */
export function permitRequired({ airspaceKind, missionFlags = {}, uasLegacy = false }) {
  if (airspaceKind === 'controlled') return 'controlled';
  if (uasLegacy) return 'legacy';
  for (const key of ['relay', 'drop', 'crowd', 'movingVehicle', 'swarm']) {
    if (missionFlags[key]) return key;
  }
  return null;
}

/* ------------------------------------------------------------ 飞行架次引擎 */

/** 建架次：证照与资格红线在前——无登记不开飞、无保险不开飞、无照不开飞、无批复不开飞 */
export function startFlight(state, { uasId, pilotId, dateISO, purpose = 'personal', airspaceKind = 'suitable', missionFlags = {}, permitId = '', location = '' }) {
  assertISO(dateISO);
  const uas = state.uas.find((u) => u.id === uasId && u.status === 'active');
  if (!uas) throw new Error(REJECT_REASONS.NO_UAS);
  const pilot = state.pilots.find((p) => p.id === pilotId && p.status === 'active');
  if (!pilot) throw new Error(REJECT_REASONS.NO_PILOT);
  if (!FLIGHT_PURPOSE[purpose]) throw new Error(`未知任务性质：${purpose}`);
  if (airspaceKind !== 'suitable' && airspaceKind !== 'controlled') throw new Error('空域类型必须为 suitable（适飞空域）或 controlled（管制空域）');

  const cls = classifyUas(uas);
  const agriRun = purpose === 'agri';
  if (agriRun && !cls.agriOk) throw new Error('该机不满足农用无人机作业包线，不能按「常规农用作业飞行」管理（条例第62条(八)）');
  const org = state.org || {};
  const obls = obligations({ category: cls.category, agriOps: agriRun, orgMode: org.orgMode || 'personal', purpose, legacyNoRemoteId: uas.legacyNoRemoteId });

  if (!uas.regNo || !uas.registeredISO) throw new Error(REJECT_REASONS.UNREGISTERED);
  const ins = obls.find((o) => o.key === 'insurance');
  if (ins && (!uas.insuranceExpiryISO || daysUntil(uas.insuranceExpiryISO, dateISO) < 0)) {
    throw new Error(REJECT_REASONS.NO_INSURANCE);
  }
  if (obls.some((o) => o.key === 'opCert') && !(org.opCertNumber || '').trim()) {
    throw new Error(REJECT_REASONS.NO_OP_CERT);
  }
  if (obls.some((o) => o.key === 'agriCert') && !pilot.agriCertISO) {
    throw new Error(REJECT_REASONS.NO_AGRI_CERT);
  }
  if (obls.some((o) => o.key === 'license')) {
    if (!pilot.licenseIssueISO) throw new Error(REJECT_REASONS.NO_LICENSE);
    const ready = pilotReadyFor(pilot, purpose, dateISO, state.settings || DEFAULT_SETTINGS);
    if (!ready.ok) {
      if (ready.why.key === 'license') throw new Error(REJECT_REASONS.LICENSE_EXPIRED);
      if (ready.why.key === 'profCheck') throw new Error(REJECT_REASONS.PROF_CHECK_OVERDUE);
      throw new Error(`${ready.why.label}已过期——${ready.why.basis}`);
    }
  }
  // 检修门禁：带病机不开飞
  if (state.issues.some((h) => h.uasId === uasId && h.status === 'open')) {
    throw new Error(REJECT_REASONS.ISSUE_OPEN);
  }
  // 申请门禁
  const needReason = permitRequired({ airspaceKind, missionFlags, uasLegacy: uas.legacyNoRemoteId });
  let permit = null;
  if (needReason) {
    permit = state.permits.find((m) => m.id === permitId) || null;
    if (!permit) throw new Error(`${REJECT_REASONS.NO_PERMIT}（事由：${PERMIT_REASONS[needReason].label}；先到「申请」建申请）`);
    if (permit.status !== 'approved') throw new Error(REJECT_REASONS.PERMIT_NOT_APPROVED);
    if (permit.flyingDateISO !== dateISO) throw new Error('批复对应的飞行日期与本架次不一致——批复不可挪用（条例第26/31条）');
  }
  const flight = {
    id: `f${++state.seq.flight}`, uasId, pilotId, dateISO, purpose, airspaceKind,
    missionFlags: { ...missionFlags }, permitId: permit ? permit.id : '', location: String(location).trim(),
    needReason, preflight: null, takeoffISO: '', landingISO: '', durationMin: null,
    income: null, safetyIssue: false, incidentNote: '', incidentReportedISO: '',
    issueIds: [], status: 'checking',
  };
  state.flights.push(flight);
  return flight;
}

/** 航前检查（第32条工具化）：全部通过 → 已放行；有异常必须先登记检修单 */
export function preflight(state, flightId, { items, note = '', dateISO = todayISO() }) {
  const flight = state.flights.find((f) => f.id === flightId);
  if (!flight) throw new Error('架次不存在');
  if (flight.status !== 'checking') throw new Error(REJECT_REASONS.NOT_CHECKING);
  const uas = state.uas.find((u) => u.id === flight.uasId);
  const isMicro = classifyUas(uas).category === 'micro';
  const marks = {};
  for (const it of PREFLIGHT_ITEMS) {
    if (isMicro && it.microNa) { marks[it.key] = true; continue; }
    if (typeof items?.[it.key] !== 'boolean') throw new Error(`检查项「${it.label}」必须逐项确认`);
    marks[it.key] = items[it.key];
  }
  const abnormalKeys = PREFLIGHT_ITEMS.filter((it) => marks[it.key] === false).map((it) => it.key);
  if (abnormalKeys.length) {
    const labels = PREFLIGHT_ITEMS.filter((it) => abnormalKeys.includes(it.key)).map((it) => it.label).join('、');
    const hz = state.issues.find((h) => h.flightId === flightId && h.status === 'open');
    if (!hz) throw new Error(`${REJECT_REASONS.ISSUE_REQUIRED}（异常项：${labels}）`);
    flight.issueIds.push(hz.id);
  }
  flight.preflight = { items: marks, note: String(note).trim(), abnormal: abnormalKeys.length > 0, checkedISO: dateISO };
  flight.status = 'cleared';
  return flight;
}

/** 起飞：带病机复检门禁 + 需要申请的架次必须先有「起飞前 1 小时报告确认」（条例第30条） */
export function takeoff(state, flightId, { dateISO = todayISO() } = {}) {
  const flight = state.flights.find((f) => f.id === flightId);
  if (!flight) throw new Error('架次不存在');
  if (flight.status !== 'cleared') throw new Error(REJECT_REASONS.NOT_CLEARED);
  if (state.issues.some((h) => h.uasId === flight.uasId && h.status === 'open')) {
    throw new Error(REJECT_REASONS.ISSUE_OPEN);
  }
  if (flight.needReason) {
    const permit = state.permits.find((m) => m.id === flight.permitId);
    if (!permit?.preDepISO) throw new Error(REJECT_REASONS.PRE_DEP_REQUIRED);
  }
  flight.takeoffISO = dateISO;
  flight.status = 'flying';
  return flight;
}

/** 降落闭环：经营性记录收入；发生飞行安全问题 → 触发 24 小时报告钟（条例第40条） */
export function closeFlight(state, flightId, { landingISO, durationMin = null, income = null, safetyIssue = false, incidentNote = '', note = '' }) {
  assertISO(landingISO);
  const flight = state.flights.find((f) => f.id === flightId);
  if (!flight) throw new Error('架次不存在');
  if (flight.status !== 'flying') throw new Error(REJECT_REASONS.NOT_FLYING);
  const dur = durationMin === null || durationMin === '' ? null : num(durationMin);
  if (dur !== null && (!Number.isFinite(dur) || dur < 0)) throw new Error(REJECT_REASONS.BAD_NUMBER);
  let inc = income;
  if (flight.purpose === 'commercial') {
    inc = inc === null || inc === '' ? null : num(income);
    if (inc !== null && (!Number.isFinite(inc) || inc < 0)) throw new Error(REJECT_REASONS.BAD_NUMBER);
  } else {
    inc = null;
  }
  if (safetyIssue && !String(incidentNote).trim()) {
    throw new Error('发生飞行安全问题必须写明情况（条例第40条：降落后 24 小时内须向空管报告）');
  }
  flight.landingISO = landingISO;
  flight.durationMin = dur;
  flight.income = inc;
  flight.safetyIssue = safetyIssue === true;
  flight.incidentNote = String(incidentNote).trim();
  flight.closeNote = String(note).trim();
  flight.status = 'closed';
  return flight;
}

/** 异常情况报告登记（条例第40条：降落后 24 小时内） */
export function reportIncident(state, flightId, { reportedISO }) {
  assertISO(reportedISO);
  const flight = state.flights.find((f) => f.id === flightId);
  if (!flight) throw new Error('架次不存在');
  if (flight.status !== 'closed') throw new Error('架次未闭环，无从报告');
  if (!flight.safetyIssue) throw new Error('该架次未标记飞行安全问题');
  if (flight.incidentReportedISO) throw new Error('该架次已登记报告，不可重复');
  flight.incidentReportedISO = reportedISO;
  return flight;
}

/** 安全问题的 24 小时报告截止（条例第40条：降落后 24 小时内 → 降落日 +1 天） */
export function incidentDue(flight) {
  return flight.safetyIssue && !flight.incidentReportedISO ? addDays(flight.landingISO, 1) : null;
}

export function cancelFlight(state, flightId, { note = '' } = {}) {
  const flight = state.flights.find((f) => f.id === flightId);
  if (!flight) throw new Error('架次不存在');
  if (flight.status === 'closed') throw new Error(REJECT_REASONS.CLOSED_IMMUTABLE);
  flight.status = 'cancelled';
  flight.cancelNote = String(note).trim();
  return flight;
}

export function staleFlights(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  return state.flights.filter((f) => !['closed', 'cancelled'].includes(f.status) && f.dateISO < todayISOStr);
}

/* ------------------------------------------------------------ 检修单 */

export function openIssue(state, { uasId, flightId = '', dateISO, item, measure, deadlineISO = '', note = '' }) {
  if (!item || !String(item).trim()) throw new Error('检修事项必填');
  if (!measure || !String(measure).trim()) throw new Error(REJECT_REASONS.NO_MEASURE);
  assertISO(dateISO);
  const hz = {
    id: `h${++state.seq.issue}`, uasId, flightId, dateISO, item: String(item).trim(),
    measure: String(measure).trim(), deadlineISO: deadlineISO || '', closedISO: '', closeNote: '',
    status: 'open', note: String(note).trim(),
  };
  state.issues.push(hz);
  return hz;
}

export function closeIssue(state, issueId, { closedISO, closeNote = '' }) {
  assertISO(closedISO);
  const hz = state.issues.find((h) => h.id === issueId);
  if (!hz) throw new Error('检修单不存在');
  if (hz.status === 'closed') throw new Error(REJECT_REASONS.CLOSED_TWICE);
  hz.status = 'closed';
  hz.closedISO = closedISO;
  hz.closeNote = String(closeNote).trim();
  return hz;
}

export function openIssues(state, uasId = null) {
  return state.issues.filter((h) => h.status === 'open' && (uasId ? h.uasId === uasId : true));
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
  const cycleDays = meta.cycleKey.endsWith('Months')
    ? (settings[meta.cycleKey] ?? 24) * 30
    : (settings[meta.cycleKey] ?? 180);
  const due = addDays(duty.lastDoneISO, cycleDays);
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

export function healthCheck(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  const s = state.settings || DEFAULT_SETTINGS;
  const lights = [];
  let score = 100;
  const activeUas = state.uas.filter((u) => u.status === 'active');

  const redCerts = [];
  for (const u of activeUas) {
    for (const c of uasClockReds(u, todayISOStr, s)) redCerts.push({ uas: u.nickname, ...c });
  }
  const lost = Math.min(30, redCerts.length * 10);
  score -= lost;
  lights.push({ key: 'cert', label: '机队钟（实名登记/责任保险）', level: redCerts.length ? 'red' : 'ok', lost, detail: redCerts.map((c) => `${c.uas}·${c.label}`) });

  const badPilots = state.pilots.filter((p) => p.status === 'active' && !pilotReadyFor(p, 'any', todayISOStr, s).ok);
  const lost2 = Math.min(20, badPilots.length * 10);
  score -= lost2;
  lights.push({ key: 'pilot', label: '操控员钟（执照/定期检查）', level: badPilots.length ? 'red' : 'ok', lost: lost2, detail: badPilots.map((p) => p.name) });

  const org = state.org || {};
  const needOpCert = org.orgMode === 'unit' && activeUas.some((u) => {
    const cls = classifyUas(u);
    return cls.category !== 'micro' && !cls.agriOk;
  });
  const noOpCert = needOpCert && !(org.opCertNumber || '').trim();
  score -= noOpCert ? 15 : 0;
  lights.push({ key: 'opcert', label: '运营合格证（单位·除微型/常规农用外）', level: noOpCert ? 'red' : 'ok', lost: noOpCert ? 15 : 0, detail: noOpCert ? ['单位使用除微型外无人机：未登记运营合格证号'] : [] });

  const badPermits = state.permits.filter((m) => {
    if (m.status === 'planned') return m.flyingDateISO < addDays(todayISOStr, 1);
    if (m.status === 'applied') return m.flyingDateISO < todayISOStr;
    return false;
  });
  const lost4 = Math.min(10, badPermits.length * 5);
  score -= lost4;
  lights.push({ key: 'permit', label: '申请台账（错失窗口/待批复过期）', level: badPermits.length ? 'red' : 'ok', lost: lost4, detail: badPermits.map((m) => `${m.flyingDateISO}·${PERMIT_REASONS[m.reason]?.label || m.reason}`) });

  const stale = staleFlights(state, todayISOStr);
  const lost5 = Math.min(15, stale.length * 10);
  score -= lost5;
  lights.push({ key: 'stale', label: '未闭环架次（过日未闭环）', level: stale.length ? 'red' : 'ok', lost: lost5, detail: stale.map((f) => f.dateISO) });

  const incidentOverdue = state.flights.filter((f) => {
    const due = incidentDue(f);
    return due !== null && due < todayISOStr;
  });
  const lost6 = Math.min(15, incidentOverdue.length * 15);
  score -= lost6;
  lights.push({ key: 'incident', label: '飞行安全问题 24 小时报告（第40条）', level: incidentOverdue.length ? 'red' : 'ok', lost: lost6, detail: incidentOverdue.map((f) => `${f.landingISO} 降落`) });

  const hzOpen = openIssues(state);
  const hzOverdue = hzOpen.filter((h) => h.deadlineISO && h.deadlineISO < todayISOStr);
  const lost7 = Math.min(10, hzOpen.length * 5 + hzOverdue.length * 5);
  score -= lost7;
  lights.push({ key: 'issue', label: '在册检修单', level: hzOverdue.length ? 'red' : hzOpen.length ? 'warn' : 'ok', lost: lost7, detail: hzOpen.map((h) => h.item) });

  const duties = dutyBoard(state, todayISOStr);
  const overdueDuties = duties.filter((d) => d.level === 'expired');
  const lost8 = Math.min(15, overdueDuties.length * 5);
  score -= lost8;
  lights.push({ key: 'duty', label: '周期义务（年报/参数/电池/固件/复训）', level: overdueDuties.length ? 'red' : 'ok', lost: lost8, detail: overdueDuties.map((d) => d.label) });

  score = Math.max(0, score);
  return { score, lights };
}

export function monthlySummary(state, month, todayISOStr = todayISO()) {
  const flights = state.flights.filter((f) => monthKey(f.dateISO) === month);
  const closed = flights.filter((f) => f.status === 'closed');
  return {
    month,
    flightCount: flights.filter((f) => f.status !== 'cancelled').length,
    closed: closed.length,
    cancelled: flights.filter((f) => f.status === 'cancelled').length,
    minutes: closed.reduce((s2, f) => s2 + (f.durationMin || 0), 0),
    income: closed.reduce((s2, f) => s2 + (f.income || 0), 0),
    commercial: closed.filter((f) => f.purpose === 'commercial').length,
    agri: closed.filter((f) => f.purpose === 'agri').length,
    abnormalPreflight: closed.filter((f) => f.preflight?.abnormal).length,
    safetyIssues: closed.filter((f) => f.safetyIssue).length,
    incidentsReported: closed.filter((f) => f.safetyIssue && f.incidentReportedISO).length,
    permitsUsed: closed.filter((f) => f.permitId).length,
    staleFlights: staleFlights(state, todayISOStr).map((f) => `${f.dateISO}·${f.location || FLIGHT_PURPOSE[f.purpose]}`),
  };
}

/* ------------------------------------------------------------ 出证三通道 */

/** 飞行记录卡：一张纸带走一个架次的法定动作链（第26/30/32/40条），签字栏齐全 */
export function flightCardHtml(state, flightId) {
  const f = state.flights.find((x) => x.id === flightId);
  if (!f) throw new Error('架次不存在');
  const uas = state.uas.find((u) => u.id === f.uasId) || {};
  const pilot = state.pilots.find((p) => p.id === f.pilotId) || {};
  const pf = f.preflight ? PREFLIGHT_ITEMS.map((it) => `${it.label}${f.preflight.items[it.key] ? '√' : '×'}`).join('　') : '未检查';
  const permit = f.permitId ? state.permits.find((m) => m.id === f.permitId) : null;
  const org = state.org?.name || '';
  const inc = f.income !== null && f.income !== undefined ? `¥${f.income}` : '—';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>无人机飞行记录卡 ${escapeHtml(f.dateISO)}</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;color:#111;padding:28px;max-width:720px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:12px 0}
td,th{border:1px solid #999;padding:7px 9px;font-size:13px;text-align:left}th{background:#f3f4f6;width:120px}
.sig{margin-top:26px;display:flex;gap:26px;font-size:13px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px}
.small{color:#555;font-size:11px;line-height:1.7;margin-top:18px}@media print{body{padding:0}}</style></head><body>
<h1>无人机飞行记录卡</h1><div style="font-size:12px;color:#555">${escapeHtml(org)} · 依据《无人驾驶航空器飞行管理暂行条例》第26/30/32/40条</div>
<table><tr><th>日期 / 任务</th><td>${escapeHtml(f.dateISO)} · ${FLIGHT_PURPOSE[f.purpose] || f.purpose}${f.location ? ` · ${escapeHtml(f.location)}` : ''}</td></tr>
<tr><th>无人机</th><td>${escapeHtml(uas.nickname || f.uasId)}${uas.model ? `（${escapeHtml(uas.model)}）` : ''}${uas.regNo ? ` · 登记号 ${escapeHtml(uas.regNo)}` : ''}</td></tr>
<tr><th>操控员</th><td>${escapeHtml(pilot.name || f.pilotId)}</td></tr>
<tr><th>空域 / 申请</th><td>${f.airspaceKind === 'controlled' ? '管制空域' : '适飞空域'}${permit ? ` · 批复文号 ${escapeHtml(permit.permitNo || '—')}（申请 ${escapeHtml(permit.submittedISO)} / 批复 ${escapeHtml(permit.decidedISO)} / 起飞前报告 ${escapeHtml(permit.preDepISO || '—')}）` : (f.needReason ? ` · 事由：${escapeHtml(PERMIT_REASONS[f.needReason]?.label || f.needReason)}` : ' · 免申请情形（第31条）')}</td></tr>
<tr><th>航前检查</th><td>${pf}${f.preflight?.abnormal ? ' · 含异常（检修单已登记）' : ''}</td></tr>
<tr><th>起降</th><td>起飞 ${escapeHtml(f.takeoffISO || '—')} → 降落 ${escapeHtml(f.landingISO || '—')}${f.durationMin ? ` · ${f.durationMin} 分钟` : ''}</td></tr>
<tr><th>收入 / 安全</th><td>${inc}${f.safetyIssue ? ` · ⚠️ 安全问题：${escapeHtml(f.incidentNote)}${f.incidentReportedISO ? `（已报告 ${escapeHtml(f.incidentReportedISO)}）` : '（未报告——24 小时钟！）'}` : ' · 无安全问题'}</td></tr>
<tr><th>状态</th><td>${FLIGHT_STATUS[f.status] || f.status}${f.cancelNote ? ` · ${escapeHtml(f.cancelNote)}` : ''}</td></tr></table>
<div class="sig"><div>操控员签字</div><div>安全负责人签字</div><div>日期：${escapeHtml(f.dateISO)}</div></div>
<p class="small">本卡为单位自查留痕底稿；飞行数据记录建议保存不少于 12 个月、申请数据不少于 15 个月（CCAR-92 第92.547条）；不替代法定报送与执法文书。</p>
</body></html>`;
}

/** 迎检自证包：单位档案 + 判档一机一档 + 操控员 + 申请批复 + 近期架次 + 检修 + 义务 + 体检 */
export function inspectHtml(state, todayISOStr = todayISO()) {
  const s = state.settings || DEFAULT_SETTINGS;
  const org = state.org || {};
  const sec = (title, inner) => `<section><h2>${title}</h2>${inner}</section>`;
  const uasRows = state.uas.filter((u) => u.status === 'active').map((u) => {
    const cls = classifyUas(u);
    const clocks = uasClocks(u, todayISOStr, s);
    const lvl = (c) => c.level === 'ok' ? '正常' : c.level === 'warn' ? `临期` : c.level === 'red' ? `告急(${c.days}天)` : '已过期/未登记';
    return `<tr><td>${escapeHtml(u.nickname)}<br><span class="dim">${escapeHtml(u.model || '')}</span></td>
      <td>${CATEGORY_META[cls.category].label}${cls.agriOk ? ' · 农用作业' : ''}<br><span class="dim">${escapeHtml(cls.basis)}</span></td>
      <td>${escapeHtml(u.regNo || '—')}<br><span class="dim">${u.registeredISO || '未登记'}</span></td>
      <td>${clocks.filter((c) => c.key !== 'agriWaiver' && c.key !== 'legacy').map((c) => {
        if (c.key === 'registration') {
          if (c.level === 'expired') return `${c.label}：<b class="bad">未登记</b> <span class="dim">${escapeHtml(c.basis)}</span>`;
          return `${c.label}：已登记${u.markAffixed ? '·标志已贴' : '·<b class="warn">标志未确认（92.211/92.213）</b>'}`;
        }
        return `${c.label}：${escapeHtml(c.dueISO)}（${lvl(c)}） <span class="dim">${escapeHtml(c.basis)}</span>`;
      }).join('<br>')}</td></tr>`;
  }).join('');
  const pilotRows = state.pilots.filter((p) => p.status === 'active').map((p) => {
    const clocks = pilotClocks(p, todayISOStr, s);
    const bad = !pilotReadyFor(p, 'any', todayISOStr, s).ok;
    return `<tr class="${bad ? 'badrow' : ''}"><td>${escapeHtml(p.name)}</td>
      <td>${p.licenseIssueISO ? `${escapeHtml(p.licenseIssueISO)} 颁发 → ${escapeHtml(clocks.find((c) => c.key === 'license')?.dueISO || '—')}` : '<span class="dim">无执照（微/轻型）</span>'}</td>
      <td>${p.lastProfCheckISO ? `${escapeHtml(p.lastProfCheckISO)} → ${escapeHtml(clocks.find((c) => c.key === 'profCheck')?.dueISO || '—')}` : '—'}</td>
      <td>${p.agriCertISO ? escapeHtml(p.agriCertISO) : '—'}</td></tr>`;
  }).join('');
  const permitRows = state.permits.slice(-20).reverse().map((m) => `<tr><td>${escapeHtml(m.flyingDateISO)}</td><td>${escapeHtml(PERMIT_REASONS[m.reason]?.label || m.reason)}</td>
    <td>${m.submittedISO || '<b class="warn">未申请</b>'}${m.status === 'planned' ? `（截止 ${escapeHtml(addDays(m.flyingDateISO, -1))} 12:00）` : ''}</td>
    <td>${m.decidedISO || '—'} ${m.permitNo ? escapeHtml(m.permitNo) : ''}</td><td>${escapeHtml(PERMIT_STATUS[m.status] || m.status)}</td></tr>`).join('');
  const flightRows = state.flights.slice(-40).reverse().map((f) => {
    const u = state.uas.find((x) => x.id === f.uasId);
    return `<tr><td>${escapeHtml(f.dateISO)}</td><td>${escapeHtml(u?.nickname || f.uasId)}</td><td>${FLIGHT_PURPOSE[f.purpose] || f.purpose}</td>
      <td>${f.airspaceKind === 'controlled' ? '管制' : '适飞'}${f.permitId ? '·有批复' : ''}</td>
      <td>${f.takeoffISO || '—'} / ${f.landingISO || '—'}</td>
      <td>${f.safetyIssue ? (f.incidentReportedISO ? `已报告 ${escapeHtml(f.incidentReportedISO)}` : '<b class="bad">安全问题未报告</b>') : '正常'}</td>
      <td>${FLIGHT_STATUS[f.status] || f.status}</td></tr>`;
  }).join('');
  const hzRows = state.issues.map((h) => `<tr><td>${escapeHtml(h.dateISO)}</td><td>${escapeHtml(h.item)}</td><td>${escapeHtml(h.measure)}</td>
    <td>${h.status === 'closed' ? `${escapeHtml(h.closedISO)} 闭环` : '<b class="bad">未闭环</b>'}</td></tr>`).join('');
  const dutyRows = dutyBoard(state, todayISOStr).map((d) => `<tr><td>${escapeHtml(d.label)}</td><td>${escapeHtml(d.basis)}</td>
    <td>${d.lastDoneISO || '<b class="warn">未登记</b>'}</td><td>${d.dueISO || '—'}${d.days !== null ? `（${d.days < 0 ? `逾期${-d.days}天` : `剩${d.days}天`}）` : ''}</td></tr>`).join('');
  const hc = healthCheck(state, todayISOStr);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>无人机队合规迎检自证包 ${escapeHtml(todayISOStr)}</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;color:#111;padding:30px;max-width:860px;margin:0 auto;line-height:1.55}
h1{font-size:21px;margin:0}h2{font-size:15px;margin:26px 0 8px;border-left:4px solid #1c7ed6;padding-left:8px}
table{width:100%;border-collapse:collapse;margin:8px 0}td,th{border:1px solid #aaa;padding:6px 8px;font-size:12px;text-align:left;vertical-align:top}
th{background:#f3f4f6}.dim{color:#777;font-size:11px}.bad{color:#c22d1b}.warn{color:#9a6a00}
.badrow td{background:#fdf3f1}.sig{margin-top:30px;display:flex;gap:26px;font-size:13px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px}
.head{font-size:12px;color:#555;margin:4px 0 14px}.note{font-size:11px;color:#555;margin-top:20px;line-height:1.7}
@media print{body{padding:0}}</style></head><body>
<h1>无人机队合规台账 · 迎检自证包</h1>
<div class="head">${escapeHtml(org.name || '')}${org.kind ? ` · ${escapeHtml(org.kind)}` : ''}${org.district ? ` · ${escapeHtml(org.district)}` : ''} · 出证日 ${escapeHtml(todayISOStr)} · 体检得分 ${hc.score}</div>
${sec('一、单位与运营合格证（条例第11条）', `<table><tr><th>单位名称</th><td>${escapeHtml(org.name || '—')}${org.orgMode === 'personal' ? '（个人飞手）' : ''}</td><th>责任人</th><td>${escapeHtml(org.manager || '—')}${org.phone ? ` / ${escapeHtml(org.phone)}` : ''}</td></tr>
<tr><th>运营合格证号</th><td>${escapeHtml(org.opCertNumber || (org.orgMode === 'unit' ? '<b class="warn">未登记</b>' : '个人飞手不适用'))}</td><th>证日</th><td>${escapeHtml(org.opCertIssueISO || '—')}</td></tr></table>`)}
${sec('二、一机一档 · 判档与证照钟（条例第10/12/62条）', uasRows ? `<table><tr><th>无人机</th><th>判档</th><th>实名登记号</th><th>钟表状态</th></tr>${uasRows}</table>` : '<p class="warn">尚未登记无人机。</p>')}
${sec('三、操控员（条例第16/17条 · 92.61/92.81/92.83）', pilotRows ? `<table><tr><th>姓名</th><th>执照（颁发→到期）</th><th>定期检查（上次→下次）</th><th>农用操作证书</th></tr>${pilotRows}</table>` : '<p class="warn">尚未登记操控员。</p>')}
${sec('四、飞行活动申请与批复（条例第19/26/30/31/61条）', permitRows ? `<table><tr><th>拟飞日</th><th>事由</th><th>申请（前1日12时前）</th><th>批复（前1日21时前）</th><th>状态</th></tr>${permitRows}</table>` : '<p>暂无申请记录。</p>')}
${sec('五、近期飞行架次（第32/40条 · 92.547 数据保存口径）', flightRows ? `<table><tr><th>日期</th><th>无人机</th><th>任务</th><th>空域</th><th>起飞/降落</th><th>安全</th><th>状态</th></tr>${flightRows}</table>` : '<p class="warn">尚无飞行记录。</p>')}
${sec('六、检修登记与闭环（第32条(二)）', hzRows ? `<table><tr><th>发现日</th><th>事项</th><th>处置措施</th><th>闭环</th></tr>${hzRows}</table>` : '<p>在册无检修登记。</p>')}
${sec('七、周期义务（第14/32条 · 92.671）', `<table><tr><th>义务</th><th>依据</th><th>最近完成</th><th>下次到期</th></tr>${dutyRows}</table>`)}
${sec('八、台账体检', `<p>得分 <b>${hc.score}</b>/100。${hc.lights.filter((l) => l.level !== 'ok').map((l) => `${l.label}（-${l.lost}）：${escapeHtml(l.detail.join('、'))}`).join('；') || '八灯全绿。'}</p>`)}
<div class="sig"><div>单位负责人签字</div><div>安全负责人签字</div><div>日期：${escapeHtml(todayISOStr)}</div></div>
<p class="note">本包为「做动作即留痕」的自查底账汇总，依据《无人驾驶航空器飞行管理暂行条例》（国务院、中央军委令第761号）与 CCAR-92（交通运输部令2024年第1号）生成，条号见 docs/14；周期阈值为参数化口径，属地实施办法、空中交通管理机构与民用航空管理部门要求永远赢；本包不替代实名登记、运营合格证、飞行申请等法定手续与执法认定，不承诺执法采信。</p>
</body></html>`;
}

/** 月度小结微信文本 */
export function monthlyText(state, month) {
  const m = monthlySummary(state, month);
  const org = state.org?.name || '本单位';
  const lines = [
    `【无人机队合规月度小结】${org} · ${m.month}`,
    `架次：有效 ${m.flightCount} 架，闭环 ${m.closed} 架${m.cancelled ? `（取消 ${m.cancelled} 架留痕）` : ''}；经营 ${m.commercial} 架、农用 ${m.agri} 架、需批复飞行 ${m.permitsUsed} 架。`,
    `时长 ${m.minutes} 分钟 · 经营收入 ¥${m.income}。`,
    `航前检查含异常 ${m.abnormalPreflight} 架；安全问题 ${m.safetyIssues} 起、已报告 ${m.incidentsReported} 起。`,
  ];
  if (m.staleFlights.length) lines.push(`⚠️ 未闭环架次 ${m.staleFlights.length} 个：${m.staleFlights.join('、')}（航前检查/起飞/降落动作链未走完）`);
  const hc = healthCheck(state);
  lines.push(`台账体检：${hc.score}/100${hc.score < 100 ? '——红灯项请到「看板」逐项处理' : '，全绿'}`);
  lines.push('依据《无人驾驶航空器飞行管理暂行条例》（761号令）与 CCAR-92 留痕，属地与空管要求永远赢。');
  return lines.join('\n');
}

/* ------------------------------------------------------------ 示例数据 */

/** 演示种子：1 家航拍工作室 + 4 机（轻/中农/小/微）+ 2 操控员 + 跨状态架次/申请/检修 */
export function seedState(todayISOStr = todayISO()) {
  const s = emptyState();
  s.org = {
    name: '示例·云雀低空工作室', orgMode: 'unit', kind: '航拍/植保服务', district: '示例市示例区',
    manager: '周航拍', phone: '13700000001', opCertNumber: '运合-示-0001', opCertIssueISO: addDays(todayISOStr, -400), note: '',
  };
  const u1 = addUas(s, {
    nickname: '云雀 Air-3', model: '轻型四旋翼（航拍）', emptyKg: 0.9, mtowKg: 2.0, commercialUse: true,
    regNo: 'UAS8A2C1F01', registeredISO: addDays(todayISOStr, -380), markAffixed: true,
    insuranceExpiryISO: addDays(todayISOStr, 45),
  });
  const u2 = addUas(s, {
    nickname: '云雀 农保-60', model: '植保无人驾驶航空器', emptyKg: 22, mtowKg: 46, agri: true,
    agriTrueHeightM: 20, agriSpeedKmh: 40, agriRadiusM: 1500,
    regNo: 'UAS5B7D2E02', registeredISO: addDays(todayISOStr, -300), markAffixed: true,
    insuranceExpiryISO: addDays(todayISOStr, 120),
  });
  const u3 = addUas(s, {
    nickname: '云雀 巡检-M350', model: '小型四旋翼（巡检）', emptyKg: 6.5, mtowKg: 13,
    regNo: 'UAS3C9E4A03', registeredISO: addDays(todayISOStr, -250), markAffixed: true,
    insuranceExpiryISO: addDays(todayISOStr, 8),
  });
  const u4 = addUas(s, {
    nickname: '口袋机 Mini-1', model: '微型四旋翼', emptyKg: 0.19, mtowKg: 0.24,
    regNo: '', registeredISO: '', markAffixed: false, insuranceExpiryISO: '',
  });
  const p1 = addPilot(s, {
    name: '小吴', phone: '13800000002',
    agriCertISO: addDays(todayISOStr, -500),
  });
  const p2 = addPilot(s, {
    name: '郑师傅', phone: '13800000003',
    licenseIssueISO: addDays(todayISOStr, -1400), lastProfCheckISO: addDays(todayISOStr, -710), ifrLarge: false,
  });

  // 已闭环：经营性航拍（有收入）
  const f1 = startFlight(s, { uasId: u1.uas.id, pilotId: p1.id, dateISO: addDays(todayISOStr, -2), purpose: 'commercial', airspaceKind: 'suitable', location: '示例产业园宣传片', permitId: '' });
  preflight(s, f1.id, { items: Object.fromEntries(PREFLIGHT_ITEMS.map((i) => [i.key, true])), dateISO: addDays(todayISOStr, -2) });
  takeoff(s, f1.id, { dateISO: addDays(todayISOStr, -2) });
  closeFlight(s, f1.id, { landingISO: addDays(todayISOStr, -2), durationMin: 40, income: 800 });

  // 已闭环：常规农用作业（豁免运营合格证 · 免申请）
  const f2 = startFlight(s, { uasId: u2.uas.id, pilotId: p1.id, dateISO: addDays(todayISOStr, -1), purpose: 'agri', airspaceKind: 'suitable', location: '示例村稻田 3 号' });
  preflight(s, f2.id, { items: Object.fromEntries(PREFLIGHT_ITEMS.map((i) => [i.key, true])), dateISO: addDays(todayISOStr, -1) });
  takeoff(s, f2.id, { dateISO: addDays(todayISOStr, -1) });
  closeFlight(s, f2.id, { landingISO: addDays(todayISOStr, -1), durationMin: 90 });

  // 已闭环 + 安全问题 + 已按 24 小时报告（第40条）
  const f3 = startFlight(s, { uasId: u1.uas.id, pilotId: p2.id, dateISO: addDays(todayISOStr, -4), purpose: 'personal', airspaceKind: 'suitable', location: '河道巡飞练习' });
  preflight(s, f3.id, { items: Object.fromEntries(PREFLIGHT_ITEMS.map((i) => [i.key, true])), dateISO: addDays(todayISOStr, -4) });
  takeoff(s, f3.id, { dateISO: addDays(todayISOStr, -4) });
  closeFlight(s, f3.id, { landingISO: addDays(todayISOStr, -4), durationMin: 18, safetyIssue: true, incidentNote: '图传短暂丢失，已按预案悬停后手动返航' });
  reportIncident(s, f3.id, { reportedISO: addDays(todayISOStr, -4) });

  // 航前检查含异常：电池鼓包 → 检修单在册 → 开飞被拒
  const f4 = startFlight(s, { uasId: u3.uas.id, pilotId: p2.id, dateISO: todayISOStr, purpose: 'commercial', airspaceKind: 'suitable', location: '光伏电站巡检' });
  openIssue(s, { uasId: u3.uas.id, flightId: f4.id, dateISO: todayISOStr, item: '航前检查：电池鼓包（第2块）', measure: '停用该电池并送检，换装备用电池后复查', deadlineISO: addDays(todayISOStr, 2) });
  preflight(s, f4.id, { items: { ...Object.fromEntries(PREFLIGHT_ITEMS.map((i) => [i.key, true])), battery: false }, note: '电池鼓包', dateISO: todayISOStr });

  // 过日未闭环（演示 stale 红灯）
  const f5 = startFlight(s, { uasId: u1.uas.id, pilotId: p1.id, dateISO: addDays(todayISOStr, -9), purpose: 'commercial', airspaceKind: 'suitable', location: '婚礼跟拍' });
  preflight(s, f5.id, { items: Object.fromEntries(PREFLIGHT_ITEMS.map((i) => [i.key, true])), dateISO: addDays(todayISOStr, -9) });

  // 申请台账：一条已批准（后天管制空域任务）、一条错失窗口
  const m1 = createPermit(s, { uasId: u3.uas.id, pilotId: p2.id, flyingDateISO: addDays(todayISOStr, 2), reason: 'controlled', location: '示例高铁站周边航拍', note: '向示例空管分局申请' });
  submitApplication(s, m1.id, { submittedISO: addDays(todayISOStr, -2) });
  decidePermit(s, m1.id, { approved: true, decidedISO: addDays(todayISOStr, -1), permitNo: '空管批〔示〕2026-018' });
  const m2 = createPermit(s, { uasId: u1.uas.id, pilotId: p1.id, flyingDateISO: todayISOStr, reason: 'crowd', location: '开业庆典集会上空' });

  setDutyDone(s, 'annualReport', addDays(todayISOStr, -400));
  setDutyDone(s, 'uasInfoUpdate', addDays(todayISOStr, -30));
  setDutyDone(s, 'batteryCheck', addDays(todayISOStr, -10));
  setDutyDone(s, 'firmwareFence', addDays(todayISOStr, -100));
  setDutyDone(s, 'agriRecert', addDays(todayISOStr, -200));
  return s;
}

/* ------------------------------------------------------------ 状态与序列 */

export const STATE_VERSION = 1;

export function emptyState() {
  return {
    version: STATE_VERSION,
    org: { name: '', orgMode: 'personal', kind: '', district: '', manager: '', phone: '', opCertNumber: '', opCertIssueISO: '', note: '' },
    uas: [],
    pilots: [],
    flights: [],
    permits: [],
    issues: [],
    duties: [],
    settings: { ...DEFAULT_SETTINGS },
    seq: { uas: 0, pilot: 0, flight: 0, permit: 0, issue: 0, duty: 0 },
    events: [],
  };
}

export function exportBundle(state) {
  return JSON.stringify(state, null, 2);
}

export function importBundle(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object' || !Array.isArray(s.uas)) throw new Error('不是有效的适飞账备份文件');
  return { ...emptyState(), ...s };
}
