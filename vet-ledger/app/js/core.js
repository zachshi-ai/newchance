/**
 * core.js — 兽诊账 VetLedger 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；温度区间/时限/周期等口径
 * 全部参数化，可在设置中被机构覆盖（属地规则与主管部门要求永远赢）。
 *
 * 合规口径（原文链接与核验方式见 docs/14-调研来源.md）：
 * - 《中华人民共和国动物防疫法》（2021-01-22 修订通过，2021-05-01 施行，现行版）：
 *   第 30 条（犬只定期免疫狂犬疫苗，凭动物诊疗机构出具的免疫证明申请养犬登记）、
 *   第 31 条（诊疗机构发现染疫或疑似染疫立即报告并隔离）、
 *   第 57 条（病死动物、病害动物产品无害化处理义务）、
 *   第 61~63 条（动物诊疗许可；载明事项变更应申请变更或换发许可证）、
 *   第 64 条（卫生安全防护、消毒、隔离和诊疗废弃物处置）、
 *   第 65 条（使用符合规定的兽药和兽医器械）、
 *   第 69 条（执业兽医资格证书 + 向所在地县级农业农村主管部门备案）、
 *   第 70 条（开具兽医处方应当亲自诊断并对诊断结论负责）、
 *   第 105 条（无证诊疗：没收违法所得+违法所得 1~3 倍，不足 3 万处 3000~3 万；
 *              消毒/隔离/医废违规 1000~1 万，造成扩散 1 万~5 万，情节严重吊销许可证）、
 *   第 106 条（未备案从事经营性诊疗：个人没收+3000~3 万，所在机构 1 万~5 万；
 *              违规操作等三情形暂停 6 个月~1 年，情节严重吊销资格）、
 *   第 108 条（染疫未报告等：责令改正可处 1 万以下；拒不改正 1 万~5 万+停业整顿）。
 * - 《动物诊疗机构管理办法》（农业农村部令 2022 年第 5 号，2022-09-07 公布，2022-10-07 施行）：
 *   第 6 条（开办九条件：含诊疗废弃物暂存+委托专业机构处理、完善的处方/消毒/医废等制度）、
 *   第 14 条（变更名称或法定代表人：市场主体变更登记后 15 个工作日内向原发证机关申请变更；
 *            变更地点/范围重新办证）、第 17 条（悬挂许可证+公示从业人员基本情况）、
 *   第 18 条（互联网诊疗须用本机构备案执业兽医师且不超核定范围）、
 *   第 20 条（不得使用假劣兽药和禁用药品）、
 *   第 22 条（规范病历，病历档案保存不少于 3 年，电子病历与纸质同效）、
 *   第 23 条（为执业兽医师提供处方笺，格式与保存符合《兽医处方格式及应用规范》）、
 *   第 25 条（染疫立即报告，不得擅自治疗应扑杀疫病）、
 *   第 26 条（染疫动物排泄物/病理组织按规定处理；参照《医疗废物管理条例》处理诊疗废弃物）、
 *   第 30 条（每年 3 月底前向县级农业农村主管部门报告上年度诊疗活动情况）、
 *   第 35 条（四情形 1000~5000 元：名称/负责人变更未办手续；未悬挂未公示；未用规范病历/
 *            未提供处方笺/不保存病历；使用未在本机构备案从业的执业兽医）、
 *   第 36 条（消毒隔离医废违规转致防疫法 105 条第二款）、
 *   第 37 条（助理兽医师开处方等转致防疫法 106 条第一款处罚机构）、
 *   第 38 条（未按规定报告诊疗活动情况转致防疫法 108 条）。
 * - 《执业兽医和乡村兽医管理办法》（农业农村部令 2022 年第 6 号，2022-10-07 施行）：
 *   第 12 条（从事诊疗活动应向所在地备案机关备案）、第 16 条（机构变化及时更新备案）、
 *   第 17 条（患人畜共患传染病不得直接从事诊疗）、
 *   第 19 条（执业兽医师可开处方/填写诊断书/出具证明文件；执业助理兽医师不得）、
 *   第 20 条（未经亲自诊断不得开处方；不得出具虚假证明）、
 *   第 23 条（不得使用假劣兽药；发现可能与兽药有关的严重不良反应立即报告）、
 *   第 32 条（不使用病历/应开方未开/不规范填写/未亲自诊断/虚假证明：1000~5000 元）。
 * - 《兽药管理条例》（2020 年国务院令第 726 号修订口径，维基文库镜像逐字核验）：
 *   第 20 条（标签注明运输贮存保管条件——按标签条件储存的义务来源）、
 *   第 38 条（兽药使用单位建立用药记录）、第 39 条（禁止使用假劣兽药与禁用清单）、
 *   第 41 条（禁止将人用药品用于动物）、第 48 条（超过有效期即劣兽药）、
 *   第 49 条（禁止未经兽医开具处方销售、购买、使用处方药）、
 *   第 50 条（使用单位和开方兽医发现严重不良反应立即报告）、
 *   第 62 条（未建用药记录等：责令改正+1 万~5 万）、第 65 条（不报严重不良反应：警告+5000~1 万）、
 *   第 66 条（无方使用处方药：没收违法所得+5 万以下）。
 * - 《兽用处方药和非处方药管理办法》（农业部令 2013 年第 2 号，2014-03-01 施行）：
 *   第 7 条（处方药凭兽医处方笺买卖）、第 9 条（处方笺一式三联，保存二年以上）。
 * - 《农业农村部办公厅关于加强动物诊疗管理工作的通知》（农办牧〔2025〕20 号，2025-06-26）：
 *   2025-09-01 起全面启用新版动物诊疗许可证（电子证照 C 0401—2024）；全面落实信息公示、
 *   人员管理、处方行为、用药管理、诊疗废弃物处置、年度报告等制度；重点打击未经许可诊疗、
 *   超范围诊疗、使用未在本机构备案从业的执业兽医；2025-11-30 前诊疗机构与备案兽医
 *   全部纳入兽医卫生综合信息平台。
 * 本工具是动物诊疗机构侧的自证台账，不构成法律意见，不替代法定报告、备案与平台报送；
 * 属地规则、发证机关要求永远赢。
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

/** 日期加 n 个工作日（跳过周六周日；法定节假日不在此计算，属地要求永远赢） */
export function addWorkdays(iso, n) {
  assertISO(iso);
  if (!Number.isInteger(n) || n < 0) throw new Error(`工作日数必须为非负整数: ${n}`);
  const d = new Date(`${iso}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
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

/** 金额：整数分 → 「¥1290.00」（台账内金额类字段备用） */
export function fmtYuan(cents) {
  if (!Number.isInteger(cents)) throw new Error(`金额必须为整数分: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 口径常量（法定口径的参数化，属地规则与主管部门要求永远赢）
// ---------------------------------------------------------------------------

/** 人员类型（执业兽医和乡村兽医管理办法第 2、19 条） */
export const STAFF_TYPES = {
  vet: '执业兽医师',
  assistant: '执业助理兽医师',
  rural: '乡村兽医',
};

/** 可以开具处方/填写诊断书/出具证明文件的人员类型（办法 2022-6 号第 19 条：仅执业兽医师） */
export const PRESCRIBER_TYPES = ['vet'];

/** 诊疗事件类型 */
export const EVENT_KINDS = {
  adverse: '兽药不良反应',
  epidemic: '动物染疫/疑似染疫',
};

/** 事件严重程度 */
export const EVENT_SEVERITIES = {
  serious: '严重',
  general: '一般',
};

/** 医废与病死动物台账类别（办法 2022-5 号第 26 条） */
export const WASTE_KINDS = {
  clinic: '诊疗废弃物',
  pathology: '病理组织/样品',
  'dead-animal': '病死动物',
};

/** 医废处置方式 */
export const WASTE_WAYS = {
  stored: '暂存待移交',
  transferred: '已移交专业机构',
  other: '其他',
};

/** 兽药台账类别 */
export const DRUG_KINDS = {
  drug: '兽药',
  vaccine: '兽用疫苗（生物制品）',
};

/** 周期义务（周期为参数化默认值，属地要求永远赢） */
export const DUTY_KINDS = {
  disinfect: { label: '场所/器械消毒', cycleDays: 7, basis: '动物防疫法第 64 条·诊疗办法第 6 条(九)' },
  fridgeCheck: { label: '冷藏设备运行检查', cycleDays: 30, basis: '兽药管理条例第 29 条参照·行业通识口径' },
  training: { label: '从业人员培训', cycleDays: 365, basis: '农办牧〔2025〕20 号人员管理口径' },
};

/** 病历档案保存下限：不少于 3 年（办法 2022-5 号第 22 条） */
export const RECORD_KEEP_YEARS = 3;
/** 兽用处方药处方笺保存下限：二年以上（处方药办法第 9 条） */
export const RX_KEEP_YEARS = 2;
/** 名称/负责人变更后向原发证机关申请变更的时限：15 个工作日（办法 2022-5 号第 14 条） */
export const CHANGE_WORKDAYS = 15;
/** 年度报告：每年 3 月底前报告上年度诊疗活动情况（办法 2022-5 号第 30 条） */
export const ANNUAL_REPORT_MMDD = '03-31';
/** 疫苗/生物制品默认贮存区间（℃）：按标签贮存条件的通识默认，标签与属地要求永远赢 */
export const DEFAULT_COLD_MIN_C = 2;
export const DEFAULT_COLD_MAX_C = 8;
/** 医废暂存移交默认红线（天）：办法 2022-5 号第 26 条"参照医疗废物管理条例"，通识默认 2 天 */
export const DEFAULT_WASTE_MOVE_DAYS = 2;
/** 诊疗台账断更判定（天） */
export const DEFAULT_GAP_DAYS = 7;
/** 近效期两级预警（天） */
export const NEAR_EXPIRY_DAYS = 90;
export const URGENT_EXPIRY_DAYS = 30;

// ---------------------------------------------------------------------------
// 机构与证照（悬挂公示、变更钟）
// ---------------------------------------------------------------------------

/**
 * 悬挂与公示状态（办法 2022-5 号第 17 条：显著位置悬挂许可证并公示从业人员基本情况）。
 * posted=true 且有证号 → ok；否则 unset（红灯：1000~5000 元罚则对应项，第 35 条(二)）。
 */
export function postingState(station) {
  if (!station?.certNo) return { level: 'unset', detail: '未登记动物诊疗许可证证号' };
  if (!station?.posted) return { level: 'unset', detail: '未确认「悬挂许可证+公示从业人员」——诊疗场所现场核对' };
  return { level: 'ok', detail: `已悬挂并公示（${station.certNo}）` };
}

/**
 * 变更钟（办法 2022-5 号第 14 条：变更名称或法定代表人（负责人）的，应当在办理市场主体
 * 变更登记手续后 15 个工作日内向原发证机关申请变更）。
 * nameChangedISO 未填 → none；已填未办 → 按 15 个工作日倒计时；已办 → ok。
 */
export function changeState(station, todayISOStr, warnDays = 5) {
  assertISO(todayISOStr);
  if (!station?.nameChangedISO) return { level: 'none', detail: '无待办理的名称/负责人变更' };
  if (station.changeFiledISO) {
    return { level: 'ok', detail: `变更手续已办（${station.changeFiledISO}）` };
  }
  const deadline = addWorkdays(station.nameChangedISO, CHANGE_WORKDAYS);
  const daysLeft = daysUntil(deadline, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= warnDays ? 'due' : 'ok';
  return { level, deadline, daysLeft, detail: `市场主体变更登记日 ${station.nameChangedISO}，应于 ${deadline} 前（15 个工作日）向原发证机关申请变更` };
}

// ---------------------------------------------------------------------------
// 人员备案名册（处方闸的名册底座）
// ---------------------------------------------------------------------------

/**
 * 添加备案人员。staff: { name, type, certNo, sinceISO, note }
 * type 必须在 STAFF_TYPES 内；同姓名同类型拒绝重复。
 */
export function addStaff(state, { name, type, certNo = '', sinceISO = '', note = '' }) {
  if (!name) throw new Error('人员姓名必填');
  if (!STAFF_TYPES[type]) throw new Error(`非法人员类型: ${type}`);
  if (sinceISO) assertISO(sinceISO);
  if ((state.staffs ?? []).some((s) => s.name === name && s.type === type)) {
    throw new Error(`${name}（${STAFF_TYPES[type]}）已在名册中`);
  }
  state.staffSeq = (state.staffSeq ?? 0) + 1;
  const rec = { id: `st-${state.staffSeq}`, name, type, certNo, sinceISO, active: true, note };
  state.staffs.push(rec);
  return rec;
}

/** 停用/恢复人员（离职停用，不删除——历史处方要能回溯到人） */
export function setStaffActive(state, staffId, active) {
  const rec = (state.staffs ?? []).find((s) => s.id === staffId);
  if (!rec) throw new Error(`人员不存在: ${staffId}`);
  rec.active = !!active;
  return rec;
}

/** 在册人员（active），名册底座：处方闸只认在册执业兽医师 */
export function activeStaff(state) {
  return (state.staffs ?? []).filter((s) => s.active);
}

/** 取在册执业兽医师（办法 2022-6 号第 19 条的处方权主体） */
export function prescribers(state) {
  return activeStaff(state).filter((s) => PRESCRIBER_TYPES.includes(s.type));
}

function staffById(state, id) {
  return (state.staffs ?? []).find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// 诊疗台账（一诊一档：病历 + 处方合规闸）
// ---------------------------------------------------------------------------

/**
 * 写一笔诊疗记录。visit: { dateISO, owner, animal, complaint, diagnosis,
 * doctorId, rxRequired, rxItems, rxNo, note }
 * 闸机（硬拒绝）：
 * - doctorId 必须是在册人员（办法 2022-5 号第 35 条(四)：使用未在本机构备案从业的执业兽医）；
 * - 涉及兽用处方药时，开方人必须是执业兽医师（办法 2022-6 号第 19 条、办法 2022-5 号第 37 条(三)）；
 * - 涉及兽用处方药时必须登记处方笺编号（处方药办法第 7 条；兽药管理条例第 49 条）。
 */
export function addVisit(state, { dateISO, owner = '', animal = '', complaint = '', diagnosis = '', doctorId, rxRequired = false, rxItems = '', rxNo = '', note = '' }) {
  assertISO(dateISO);
  const doctor = staffById(state, doctorId);
  if (!doctor) throw new Error('开方/诊疗人员必须先在「人员备案名册」登记');
  if (!doctor.active) throw new Error(`${doctor.name} 已停用——离职人员的诊疗不能新落账`);
  if (rxRequired && !PRESCRIBER_TYPES.includes(doctor.type)) {
    throw new Error(`${STAFF_TYPES[doctor.type]}不得开具兽用处方药处方（办法 2022-6 号第 19 条）——请改由执业兽医师落账`);
  }
  if (rxRequired && !String(rxNo || '').trim()) {
    throw new Error('涉及兽用处方药必须登记处方笺编号（处方药办法第 7 条）');
  }
  state.visitSeq = (state.visitSeq ?? 0) + 1;
  const rec = {
    id: `vs-${state.visitSeq}`, dateISO, owner, animal, complaint, diagnosis,
    doctorId, doctorName: doctor.name, doctorType: doctor.type,
    rxRequired, rxItems, rxNo, note,
  };
  state.visits.push(rec);
  return rec;
}

/** 删除诊疗记录（记错可自救；开放更正比逼人记假账更诚实） */
export function removeVisit(state, visitId) {
  const idx = (state.visits ?? []).findIndex((v) => v.id === visitId);
  if (idx < 0) throw new Error(`诊疗记录不存在: ${visitId}`);
  state.visits.splice(idx, 1);
}

/** 最近一次诊疗落账日期（无则 null） */
export function lastVisitISO(state) {
  const dates = (state.visits ?? []).map((v) => v.dateISO).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** 诊疗台账断更天数：今天距最近一笔的天数；从未落账返回 null */
export function visitGapDays(state, todayISOStr) {
  assertISO(todayISOStr);
  const last = lastVisitISO(state);
  return last === null ? null : 0 - daysUntil(last, todayISOStr);
}

/** 处方合规缺口：涉及处方药但记录里缺处方要素的诊疗（倒查时最重的一类缺口） */
export function rxViolations(state) {
  return (state.visits ?? []).filter((v) => v.rxRequired && (!v.rxNo || v.doctorType !== 'vet'));
}

// ---------------------------------------------------------------------------
// 兽药与疫苗批台账（效期三色 + 批次冻结闸）
// ---------------------------------------------------------------------------

/**
 * 兽药/疫苗进货建档。drug: { dateISO, kind, name, manufacturer, batchNo, expiryISO,
 * qty, isRx, supplier, note }
 * isRx=处方药标记（兽用处方药目录以农业农村部公布为准）；kind=vaccine 为疫苗批（受冷链闸约束）。
 */
export function addDrug(state, { dateISO, kind = 'drug', name, manufacturer = '', batchNo = '', expiryISO, qty = 0, isRx = false, supplier = '', note = '' }) {
  assertISO(dateISO);
  assertISO(expiryISO);
  if (!name) throw new Error('兽药/疫苗名称必填');
  if (!DRUG_KINDS[kind]) throw new Error(`非法类别: ${kind}`);
  if (!Number.isInteger(qty) || qty < 0) throw new Error(`数量必须为非负整数: ${qty}`);
  if (expiryISO <= dateISO) throw new Error('有效期必须晚于进货日期——过期兽药属劣兽药（兽药管理条例第 48 条），不得入账在用');
  state.drugSeq = (state.drugSeq ?? 0) + 1;
  const rec = {
    id: `dg-${state.drugSeq}`, dateISO, kind, name, manufacturer, batchNo, expiryISO,
    qty, isRx, supplier, frozen: false, frozenNote: '', note,
  };
  state.drugs.push(rec);
  return rec;
}

/** 删除兽药批次（录入错误自救） */
export function removeDrug(state, drugId) {
  const idx = (state.drugs ?? []).findIndex((d) => d.id === drugId);
  if (idx < 0) throw new Error(`兽药批次不存在: ${drugId}`);
  state.drugs.splice(idx, 1);
}

/**
 * 批次可用性闸（使用/接种前调用）：过期批次 = 劣兽药（兽药管理条例第 48 条(二)），
 * 冻结批次（超温等处置）未解冻不得使用——两个闸都在使用前拦截，而不是事后登记。
 */
export function assertBatchUsable(state, drugId, todayISOStr) {
  assertISO(todayISOStr);
  const d = (state.drugs ?? []).find((x) => x.id === drugId);
  if (!d) throw new Error(`兽药批次不存在: ${drugId}`);
  if (d.expiryISO <= todayISOStr) {
    throw new Error(`${d.name}（批号 ${d.batchNo || '—'}）已过有效期 ${d.expiryISO}——过期即劣兽药（兽药管理条例第 48 条），禁止使用并下架登记`);
  }
  if (d.frozen) {
    throw new Error(`${d.name}（批号 ${d.batchNo || '—'}）已被冻结：${d.frozenNote || '处置未闭环'}——处置闭环解冻前不得使用`);
  }
  return d;
}

/** 批次三色：expired 过期 / urgent 30 天内 / near 90 天内 / ok */
export function batchColor(batch, todayISOStr) {
  assertISO(todayISOStr);
  const left = daysUntil(batch.expiryISO, todayISOStr);
  if (left < 0) return 'expired';
  if (left <= URGENT_EXPIRY_DAYS) return 'urgent';
  if (left <= NEAR_EXPIRY_DAYS) return 'near';
  return 'ok';
}

/** 冻结批次（超温/质量异常处置）：必须写明原因；解冻必须写明处置结果 */
export function freezeBatch(state, drugId, note) {
  const d = (state.drugs ?? []).find((x) => x.id === drugId);
  if (!d) throw new Error(`兽药批次不存在: ${drugId}`);
  if (!String(note || '').trim()) throw new Error('冻结必须写明处置原因（如：冷链超温，暂停使用待判定）');
  d.frozen = true;
  d.frozenNote = note;
  return d;
}

export function unfreezeBatch(state, drugId, note) {
  const d = (state.drugs ?? []).find((x) => x.id === drugId);
  if (!d) throw new Error(`兽药批次不存在: ${drugId}`);
  if (!d.frozen) throw new Error('该批次未处于冻结状态');
  if (!String(note || '').trim()) throw new Error('解冻必须写明判定结论（如：厂家判定可用/已废弃退回）');
  d.frozen = false;
  d.frozenNote = note ? `解冻：${note}` : '';
  return d;
}

/** 效期点名：过期在最前，其次 30 天内、90 天内（红灯优先） */
export function expiryBoard(state, todayISOStr) {
  assertISO(todayISOStr);
  const order = { expired: 0, urgent: 1, near: 2, ok: 3 };
  return (state.drugs ?? [])
    .map((d) => ({ ...d, color: batchColor(d, todayISOStr), daysLeft: daysUntil(d.expiryISO, todayISOStr) }))
    .filter((d) => d.color !== 'ok')
    .sort((a, b) => order[a.color] - order[b.color] || a.expiryISO.localeCompare(b.expiryISO));
}

// ---------------------------------------------------------------------------
// 疫苗冷链（每日两次双录 + 超温处置闸）
// ---------------------------------------------------------------------------

/**
 * 冷链温度落账。同一日期同一时段（am/pm）唯一。
 * 超出 [minC, maxC] 区间时必须写明处置措施（finding 记录进 note）——超温不处置不许过账。
 */
export function addColdchain(state, { dateISO, slot, tempC, note = '' }, range = {}) {
  assertISO(dateISO);
  if (!['am', 'pm'].includes(slot)) throw new Error(`非法时段: ${slot}`);
  const t = Number(tempC);
  if (!Number.isFinite(t) || t < -30 || t > 50) throw new Error(`温度读数不合法: ${tempC}`);
  if ((state.coldchains ?? []).some((c) => c.dateISO === dateISO && c.slot === slot)) {
    throw new Error(`${dateISO} ${slot === 'am' ? '上午' : '下午'}已有冷链记录（同日同时段唯一）`);
  }
  const minC = range.minC ?? DEFAULT_COLD_MIN_C;
  const maxC = range.maxC ?? DEFAULT_COLD_MAX_C;
  const excursion = t < minC || t > maxC;
  if (excursion && !String(note || '').trim()) {
    throw new Error(`温度 ${t}℃ 超出 [${minC}, ${maxC}]℃——必须写明处置措施（检查设备/隔离批次/判定），不许裸记`);
  }
  state.coldchainSeq = (state.coldchainSeq ?? 0) + 1;
  const rec = { id: `cc-${state.coldchainSeq}`, dateISO, slot, tempC: t, minC, maxC, excursion, note };
  state.coldchains.push(rec);
  return rec;
}

/** 删除冷链记录（录错自救） */
export function removeColdchain(state, id) {
  const idx = (state.coldchains ?? []).findIndex((c) => c.id === id);
  if (idx < 0) throw new Error(`冷链记录不存在: ${id}`);
  state.coldchains.splice(idx, 1);
}

/** 超温记录（最老的在前——每一笔都要有下文） */
export function excursions(state) {
  return (state.coldchains ?? []).filter((c) => c.excursion)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

/** 当日双录状态：{ am: bool, pm: bool, done: n/2 } */
export function coldchainToday(state, todayISOStr) {
  assertISO(todayISOStr);
  const todays = (state.coldchains ?? []).filter((c) => c.dateISO === todayISOStr);
  return {
    am: todays.some((c) => c.slot === 'am'),
    pm: todays.some((c) => c.slot === 'pm'),
    done: todays.length,
  };
}

/** 冷链断录天数：今天距最近一笔的天数；从未记录返回 null */
export function coldchainGapDays(state, todayISOStr) {
  assertISO(todayISOStr);
  const dates = (state.coldchains ?? []).map((c) => c.dateISO).sort();
  if (!dates.length) return null;
  return 0 - daysUntil(dates[dates.length - 1], todayISOStr);
}

// ---------------------------------------------------------------------------
// 狂犬免疫台账（防疫法第 30 条：免疫证明 = 养犬登记的前置凭证）
// ---------------------------------------------------------------------------

/**
 * 登记一剂狂犬疫苗接种并出具免疫证明。
 * 闸机：接种/出具证明人必须是在册执业兽医师（办法 2022-6 号第 19 条：
 * 出具动物诊疗有关证明文件属执业兽医师权限）；疫苗批号对应的批次必须在册且未过期未冻结。
 */
export function addRabies(state, { dateISO, pet, species = '犬', owner = '', vaccineBatchId, certNo, doctorId, note = '' }) {
  assertISO(dateISO);
  if (!pet) throw new Error('宠物名/编号必填');
  const doctor = staffById(state, doctorId);
  if (!doctor) throw new Error('接种人员必须先在「人员备案名册」登记');
  if (!PRESCRIBER_TYPES.includes(doctor.type)) {
    throw new Error(`免疫证明须由执业兽医师出具（办法 2022-6 号第 19 条）——${STAFF_TYPES[doctor.type]}不得签发`);
  }
  if (!String(certNo || '').trim()) throw new Error('免疫证明编号必填——这是主人养犬登记的凭证');
  const batch = (state.drugs ?? []).find((d) => d.id === vaccineBatchId);
  if (batch) {
    assertBatchUsable(state, vaccineBatchId, dateISO);
  }
  state.rabiesSeq = (state.rabiesSeq ?? 0) + 1;
  const rec = {
    id: `rb-${state.rabiesSeq}`, dateISO, pet, species, owner,
    vaccineBatchId: batch ? batch.id : '', vaccineName: batch ? batch.name : '',
    batchNo: batch ? batch.batchNo : '', certNo, doctorId, doctorName: doctor.name, note,
  };
  state.rabiesLog.push(rec);
  return rec;
}

// ---------------------------------------------------------------------------
// 医废与病死动物台账（办法 2022-5 号第 26 条：参照医疗废物管理条例，不得随意丢弃）
// ---------------------------------------------------------------------------

/**
 * 登记一笔医废/病理组织/病死动物。
 * way=stored（暂存待移交）→ 挂账，超过红线天数（默认 2 天，参数化）红灯点名；
 * way=transferred → 必须填移交去向与交接单号，闭环。
 */
export function addWaste(state, { dateISO, kind = 'clinic', qty = 0, way = 'stored', receiver = '', ticketNo = '', note = '' }) {
  assertISO(dateISO);
  if (!WASTE_KINDS[kind]) throw new Error(`非法类别: ${kind}`);
  if (!WASTE_WAYS[way]) throw new Error(`非法处置方式: ${way}`);
  if (!Number.isInteger(qty) || qty < 0) throw new Error(`数量必须为非负整数: ${qty}`);
  if (way === 'transferred' && !String(receiver || '').trim()) {
    throw new Error('移交必须填写接收单位（有资质的专业处理机构）');
  }
  state.wasteSeq = (state.wasteSeq ?? 0) + 1;
  const rec = { id: `ws-${state.wasteSeq}`, dateISO, kind, qty, way, receiver, ticketNo, movedISO: way === 'transferred' ? dateISO : null, note };
  state.wastes.push(rec);
  return rec;
}

/** 暂存批次的移交闭环：移交日不得早于登记日 */
export function moveWaste(state, wasteId, { movedISO, receiver = '', ticketNo = '' } = {}) {
  const rec = (state.wastes ?? []).find((w) => w.id === wasteId);
  if (!rec) throw new Error(`医废记录不存在: ${wasteId}`);
  if (rec.movedISO) throw new Error('该记录已移交闭环');
  assertISO(movedISO);
  if (movedISO < rec.dateISO) throw new Error('移交日期早于登记日期');
  if (!String(receiver || '').trim()) throw new Error('移交必须填写接收单位');
  rec.movedISO = movedISO;
  rec.receiver = receiver;
  rec.ticketNo = ticketNo;
  rec.way = 'transferred';
  return rec;
}

/** 未移交医废（最老的在前），附挂账天数 */
export function openWastes(state, todayISOStr) {
  assertISO(todayISOStr);
  return (state.wastes ?? [])
    .filter((w) => !w.movedISO)
    .map((w) => ({ ...w, daysHeld: 0 - daysUntil(w.dateISO, todayISOStr) }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

/** 超线挂账医废（超过 moveDays 天未移交） */
export function overdueWastes(state, todayISOStr, moveDays = DEFAULT_WASTE_MOVE_DAYS) {
  assertISO(todayISOStr);
  return openWastes(state, todayISOStr).filter((w) => w.daysHeld > moveDays);
}

// ---------------------------------------------------------------------------
// 事件台账（不良反应 + 染疫报告：报告时限闸）
// ---------------------------------------------------------------------------

/**
 * 登记一笔事件。severity=serious（严重不良反应 / 应报告疫病）时报告时限为"立即"：
 * 事件必须当日（dateISO 当天）报告——闭环时 reportedISO 晚于 dateISO 允许登记但如实打标「迟报」。
 * epidemic 类（防疫法第 31 条、办法 2022-5 号第 25 条）一律按 serious 对待。
 */
export function addEvent(state, { dateISO, kind = 'adverse', subject = '', severity = 'general', note = '' }) {
  assertISO(dateISO);
  if (!EVENT_KINDS[kind]) throw new Error(`非法事件类型: ${kind}`);
  if (!EVENT_SEVERITIES[severity]) throw new Error(`非法严重程度: ${severity}`);
  const effSeverity = kind === 'epidemic' ? 'serious' : severity;
  state.eventSeq = (state.eventSeq ?? 0) + 1;
  const rec = {
    id: `ev-${state.eventSeq}`, dateISO, kind, subject, severity: effSeverity,
    reportedISO: null, late: false, note,
  };
  state.events.push(rec);
  return rec;
}

/**
 * 报告闭环。serious 类的法定口径是"立即"报告：reportedISO > dateISO 时如实打标「迟报」
 * ——台账帮认真上报的机构自证，不帮迟报的机构洗时间。
 */
export function closeEvent(state, eventId, { reportedISO } = {}) {
  const rec = (state.events ?? []).find((e) => e.id === eventId);
  if (!rec) throw new Error(`事件记录不存在: ${eventId}`);
  if (rec.reportedISO) throw new Error('该事件已报告闭环');
  assertISO(reportedISO);
  rec.reportedISO = reportedISO;
  rec.late = reportedISO > rec.dateISO;
  return rec;
}

/** 未报告事件（严重的在前、最老的在前——倒查第一问） */
export function openEvents(state) {
  const order = { serious: 0, general: 1 };
  return (state.events ?? [])
    .filter((e) => !e.reportedISO)
    .sort((a, b) => order[a.severity] - order[b.severity] || a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

/** 迟报事件清单（如实点名） */
export function lateEvents(state) {
  return (state.events ?? []).filter((e) => e.reportedISO && e.late);
}

// ---------------------------------------------------------------------------
// 周期义务账（消毒/冷藏设备检查/培训，打勾自动滚动）
// ---------------------------------------------------------------------------

/** 登记或更新某类义务的最近完成日（一义务一条，重复打勾=更新最近完成日） */
export function setDutyDone(state, kind, doneISO, note = '') {
  if (!DUTY_KINDS[kind]) throw new Error(`非法义务类型: ${kind}`);
  assertISO(doneISO);
  let duty = (state.duties ?? []).find((d) => d.kind === kind);
  if (!duty) {
    duty = { id: `du-${kind}`, kind, lastDoneISO: doneISO, note };
    state.duties.push(duty);
  } else {
    duty.lastDoneISO = doneISO;
    if (note) duty.note = note;
  }
  return duty;
}

/** 单项义务状态：nextDue = 最近完成日 + 周期；never=从未执行 */
export function dutyState(duty, todayISOStr, cycleDays = null) {
  assertISO(todayISOStr);
  const cycle = cycleDays ?? DUTY_KINDS[duty.kind]?.cycleDays ?? 30;
  if (!duty.lastDoneISO) return { level: 'never', cycle };
  const nextDue = addDays(duty.lastDoneISO, cycle);
  const daysLeft = daysUntil(nextDue, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= 14 ? 'due' : 'ok';
  return { level, cycle, nextDue, daysLeft };
}

/** 全部义务看板：红灯在前，附类型与依据 */
export function dutyBoard(state, todayISOStr) {
  assertISO(todayISOStr);
  const order = { never: 0, overdue: 1, due: 2, ok: 3 };
  return (state.duties ?? [])
    .map((d) => ({ kind: d.kind, label: DUTY_KINDS[d.kind]?.label ?? d.kind, basis: DUTY_KINDS[d.kind]?.basis ?? '', lastDoneISO: d.lastDoneISO, ...dutyState(d, todayISOStr) }))
    .sort((a, b) => order[a.level] - order[b.level] || (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9));
}

// ---------------------------------------------------------------------------
// 年度报告钟（办法 2022-5 号第 30 条：每年 3 月底前报告上年度情况）
// ---------------------------------------------------------------------------

/** 登记上年度诊疗活动情况报告。year 必须是"上一年度"，同一年度重复报告拒绝 */
export function fileAnnualReport(state, { year, filedISO, no = '' }) {
  if (!Number.isInteger(year)) throw new Error(`年度必须为整数: ${year}`);
  assertISO(filedISO);
  const prevYear = Number(filedISO.slice(0, 4)) - 1;
  if (year !== prevYear) {
    throw new Error(`年度报告对象应为上一年度（${prevYear} 年度），收到 ${year}`);
  }
  if ((state.annualReports ?? []).some((r) => r.year === year)) {
    throw new Error(`${year} 年度报告已登记（同年度唯一）`);
  }
  state.annualReports.push({ year, filedISO, no });
  return state.annualReports[state.annualReports.length - 1];
}

/**
 * 年度报告钟状态：
 * - 本年度 3 月 31 日前未报上一年度 → warn（窗口期）；
 * - 3 月 31 日已过仍未报 → overdue（罚则转致防疫法 108 条：责令改正可处 1 万以下，
 *   拒不改正 1 万~5 万+停业整顿）；
 * - 已报 → ok。
 */
export function annualReportState(state, todayISOStr) {
  assertISO(todayISOStr);
  const year = Number(todayISOStr.slice(0, 4));
  const due = `${year}-${ANNUAL_REPORT_MMDD}`;
  const target = year - 1;
  const filed = (state.annualReports ?? []).find((r) => r.year === target);
  if (filed) return { level: 'ok', target, due, filedISO: filed.filedISO, detail: `${target} 年度报告已于 ${filed.filedISO} 报告` };
  const daysLeft = daysUntil(due, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', target, due, daysLeft, detail: `${target} 年度报告未登记（期限 ${due}）——未按规定报告转致防疫法第 108 条处罚` };
  }
  return { level: 'due', target, due, daysLeft, detail: `${target} 年度报告应于 ${due} 前向县级农业农村主管部门报告` };
}

// ---------------------------------------------------------------------------
// 账本体检（迎检前的自查打分；全部确定性输出）
// ---------------------------------------------------------------------------

/**
 * 十项体检。score = 100 - 红×12 - 黄×4（下限 0）。
 */
export function healthCheck(state, todayISOStr, settings = {}) {
  assertISO(todayISOStr);
  const gapDays = settings.gapDays ?? DEFAULT_GAP_DAYS;
  const moveDays = settings.wasteMoveDays ?? DEFAULT_WASTE_MOVE_DAYS;
  const items = [];

  const posting = postingState(state.station);
  items.push({ key: 'posting', label: '悬挂与公示', level: posting.level === 'ok' ? 'ok' : 'bad', detail: posting.detail });

  const change = changeState(state.station, todayISOStr);
  items.push({
    key: 'change', label: '变更手续',
    level: change.level === 'overdue' ? 'bad' : change.level === 'due' ? 'warn' : 'ok',
    detail: change.detail,
  });

  const vets = prescribers(state);
  const staffs = activeStaff(state);
  items.push({
    key: 'staff', label: '人员备案名册',
    level: vets.length ? 'ok' : 'bad',
    detail: vets.length
      ? `在册 ${staffs.length} 人，其中执业兽医师 ${vets.length} 人`
      : '名册中没有在册执业兽医师——处方与免疫证明都无法合规开出（办法 2022-5 号第 35 条(四)）',
  });

  const gap = visitGapDays(state, todayISOStr);
  if (gap === null) items.push({ key: 'gap', label: '诊疗台账', level: 'bad', detail: '从未落账——台账还没开始' });
  else if (gap > gapDays) items.push({ key: 'gap', label: '诊疗台账', level: 'bad', detail: `已断更 ${gap} 天（红线 ${gapDays} 天）——病历连续性是规范病历的一部分` });
  else if (gap > 2) items.push({ key: 'gap', label: '诊疗台账', level: 'warn', detail: `距最近一诊 ${gap} 天` });
  else items.push({ key: 'gap', label: '诊疗台账', level: 'ok', detail: '台账在续' });

  const rxv = rxViolations(state);
  items.push({
    key: 'rx', label: '处方合规',
    level: rxv.length ? 'bad' : 'ok',
    detail: rxv.length ? `${rxv.length} 笔处方药诊疗缺处方要素（最早 ${rxv[0].dateISO}）——无方使用处方药罚则 5 万以下` : '处方药诊疗全部凭方、由执业兽医师开具',
  });

  const ccGap = coldchainGapDays(state, todayISOStr);
  const hasVaccine = (state.drugs ?? []).some((d) => d.kind === 'vaccine');
  if (excursions(state).length) {
    items.push({ key: 'coldchain', label: '疫苗冷链', level: 'bad', detail: `${excursions(state).length} 笔超温记录——确认批次已冻结处置并闭环` });
  } else if (hasVaccine && (ccGap === null || ccGap > 1)) {
    items.push({ key: 'coldchain', label: '疫苗冷链', level: ccGap === null ? 'bad' : 'warn', detail: ccGap === null ? '在用疫苗批次存在但从未记录温度——按标签贮存条件每日两次记录' : `冷链记录断录 ${ccGap} 天` });
  } else {
    items.push({ key: 'coldchain', label: '疫苗冷链', level: 'ok', detail: hasVaccine ? '无超温、记录在续' : '暂无在用疫苗批次' });
  }

  const expired = expiryBoard(state, todayISOStr).filter((d) => d.color === 'expired');
  const near = expiryBoard(state, todayISOStr).filter((d) => d.color === 'urgent' || d.color === 'near');
  items.push({
    key: 'expiry', label: '兽药效期',
    level: expired.length ? 'bad' : near.length ? 'warn' : 'ok',
    detail: expired.length
      ? `${expired.length} 个批次已过期（过期即劣兽药）——下架登记、停止使用`
      : near.length ? `${near.length} 个批次近效期——先进先出、催用催退` : '在用批次效期健康',
  });

  const ow = overdueWastes(state, todayISOStr, moveDays);
  const openW = openWastes(state, todayISOStr);
  items.push({
    key: 'waste', label: '医废移交',
    level: ow.length ? 'bad' : openW.length ? 'warn' : 'ok',
    detail: ow.length
      ? `${ow.length} 笔暂存超 ${moveDays} 天未移交（最早 ${ow[0].dateISO}）`
      : openW.length ? `${openW.length} 笔暂存待移交` : '医废全部按时移交',
  });

  const oe = openEvents(state);
  const late = lateEvents(state);
  items.push({
    key: 'events', label: '事件上报',
    level: oe.some((e) => e.severity === 'serious') ? 'bad' : oe.length ? 'warn' : late.length ? 'warn' : 'ok',
    detail: oe.length
      ? `${oe.length} 笔事件未报告闭环（${oe[0].kind === 'epidemic' ? '染疫' : '不良反应'}${oe[0].severity === 'serious' ? '·严重' : ''}）`
      : late.length ? `${late.length} 笔存在迟报（如实保留）` : '事件全部按时报告',
  });

  const ar = annualReportState(state, todayISOStr);
  items.push({
    key: 'annual', label: '年度报告',
    level: ar.level === 'overdue' ? 'bad' : ar.level === 'due' ? 'warn' : 'ok',
    detail: ar.detail,
  });

  const bad = items.filter((i) => i.level === 'bad').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  return { items, bad, warn, score: Math.max(0, 100 - bad * 12 - warn * 4) };
}

// ---------------------------------------------------------------------------
// 月度小结（微信文本通道，确定性输出）
// ---------------------------------------------------------------------------

/**
 * 月度小结：诊疗/处方、狂犬免疫、冷链、医废、事件、效期、义务七段。month 形如 '2026-09'。
 */
export function monthlySummary(state, month, todayISOStr = todayISO()) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  assertISO(todayISOStr);
  const inMonth = (iso) => monthKey(iso) === month;
  const visits = (state.visits ?? []).filter((v) => inMonth(v.dateISO));
  const rxVisits = visits.filter((v) => v.rxRequired);
  const rabies = (state.rabiesLog ?? []).filter((r) => inMonth(r.dateISO));
  const cold = (state.coldchains ?? []).filter((c) => inMonth(c.dateISO));
  const coldExc = cold.filter((c) => c.excursion);
  const wastes = (state.wastes ?? []).filter((w) => inMonth(w.dateISO));
  const events = (state.events ?? []).filter((e) => inMonth(e.dateISO));
  const nearDrugs = expiryBoard(state, todayISOStr).filter((d) => d.color === 'expired' || d.color === 'urgent');
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => d.level === 'overdue' || d.level === 'never');
  const hc = healthCheck(state, todayISOStr);

  const L = [];
  L.push(`【动物诊疗机构合规月度小结】${month}`);
  if (state.station?.name) L.push(`机构：${state.station.name}${state.station.certNo ? `（证号 ${state.station.certNo}）` : ''}`);
  L.push(`诊疗落账 ${visits.length} 例，其中兽用处方药 ${rxVisits.length} 例（全部凭处方笺、由执业兽医师开具）`);
  L.push(`狂犬免疫 ${rabies.length} 剂，出具免疫证明 ${rabies.length} 份`);
  L.push(`冷链记录 ${cold.length} 次${coldExc.length ? `（含超温 ${coldExc.length} 次——超温批次应冻结待判定，处置情况以批次台账为准）` : ''}`);
  L.push(`医废/病理组织登记 ${wastes.length} 笔`);
  L.push(`事件 ${events.length} 笔：${events.filter((e) => e.reportedISO).length} 笔已报告${events.some((e) => !e.reportedISO) ? '、有未报告事件待闭环' : ''}`);
  if (nearDrugs.length) L.push(`⚠ 效期点名：${nearDrugs.map((d) => `${d.name}（${d.color === 'expired' ? '已过期' : '30 天内到期'}）`).join('、')}`);
  if (dutiesLate.length) L.push(`⚠ 周期义务点名：${dutiesLate.map((d) => d.label).join('、')}`);
  L.push(`账本体检 ${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）`);
  L.push('口径：《动物防疫法》（2021）第 30/64/69 条、《动物诊疗机构管理办法》（部令 2022 年第 5 号）第 17/22/23/26/30 条、《执业兽医和乡村兽医管理办法》（部令 2022 年第 6 号）第 19 条、《兽药管理条例》第 38/49/50 条；本小结为机构自查底稿，不替代法定报告与平台报送。');
  L.push(`生成：兽诊账 · ${month}`);
  return { text: L.join('\n'), visits: visits.length, rabies: rabies.length, cold: cold.length, wastes: wastes.length, events: events.length, score: hc.score };
}

// ---------------------------------------------------------------------------
// 迎检自证包（单文件 HTML：十段，含签字栏；同输入同输出）
// ---------------------------------------------------------------------------

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏） */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const st = state.station ?? {};
  const LEVEL = { overdue: '逾期', due: '临期', ok: '正常', never: '从未执行', unset: '未登记', none: '无待办' };

  const hc = healthCheck(state, todayISOStr, settings);
  const hcRows = hc.items.map((i) => `<tr><td>${e(i.label)}</td><td>${LEVEL[i.level] ?? i.level}</td><td>${e(i.detail)}</td></tr>`).join('');

  const from30 = addDays(todayISOStr, -29);
  const visits = (state.visits ?? []).filter((v) => v.dateISO >= from30).sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const visitRows = visits.map((v) => `<tr>
    <td>${e(v.dateISO)}</td><td>${e(v.owner || '—')}</td><td>${e(v.animal || '—')}</td>
    <td>${e(v.diagnosis || v.complaint || '—')}</td><td>${e(v.doctorName)}（${e(STAFF_TYPES[v.doctorType] ?? v.doctorType)}）</td>
    <td>${v.rxRequired ? `${e(v.rxNo || '—')}` : '—'}</td>
  </tr>`).join('') || '<tr><td colspan="6">近 30 天无诊疗落账</td></tr>';

  const staffRows = activeStaff(state).map((s) => `<tr>
    <td>${e(s.name)}</td><td>${e(STAFF_TYPES[s.type] ?? s.type)}</td><td>${e(s.certNo || '—')}</td>
    <td>${e(s.sinceISO || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="4">名册为空</td></tr>';

  const rabiesRows = [...(state.rabiesLog ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((r) => `<tr>
    <td>${e(r.dateISO)}</td><td>${e(r.pet)}</td><td>${e(r.species)}</td><td>${e(r.owner || '—')}</td>
    <td>${e(r.vaccineName || '—')}${r.batchNo ? ` / 批号 ${e(r.batchNo)}` : ''}</td><td>${e(r.certNo)}</td><td>${e(r.doctorName)}</td>
  </tr>`).join('') || '<tr><td colspan="7">无狂犬免疫记录</td></tr>';

  const drugRows = [...(state.drugs ?? [])].sort((a, b) => a.expiryISO.localeCompare(b.expiryISO)).map((d) => `<tr>
    <td>${e(d.name)}</td><td>${e(d.kind === 'vaccine' ? '疫苗' : '兽药')}</td><td>${e(d.batchNo || '—')}</td>
    <td>${e(d.expiryISO)}</td><td>${d.frozen ? `<strong>已冻结：${e(d.frozenNote || '')}</strong>` : '在用'}</td><td>${e(d.supplier || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="6">无兽药/疫苗批次</td></tr>';

  const coldRows = [...(state.coldchains ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 60).map((c) => `<tr>
    <td>${e(c.dateISO)}</td><td>${c.slot === 'am' ? '上午' : '下午'}</td><td>${c.tempC}℃</td><td>[${c.minC}, ${c.maxC}]℃</td>
    <td>${c.excursion ? `<strong>超温</strong>${c.note ? `：${e(c.note)}` : ''}` : e(c.note || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="5">无冷链记录</td></tr>';

  const wasteRows = [...(state.wastes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((w) => `<tr>
    <td>${e(w.dateISO)}</td><td>${e(WASTE_KINDS[w.kind] ?? w.kind)}</td><td>${w.qty}</td>
    <td>${w.movedISO ? `${e(w.movedISO)} → ${e(w.receiver)}${w.ticketNo ? `（单号 ${e(w.ticketNo)}）` : ''}` : '<strong>暂存待移交</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="4">无医废登记</td></tr>';

  const eventRows = [...(state.events ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((ev) => `<tr>
    <td>${e(ev.dateISO)}</td><td>${e(EVENT_KINDS[ev.kind] ?? ev.kind)}</td><td>${e(ev.subject || '—')}</td><td>${e(EVENT_SEVERITIES[ev.severity] ?? ev.severity)}</td>
    <td>${ev.reportedISO ? `${e(ev.reportedISO)}${ev.late ? '（迟报）' : ''}` : '<strong>未报告</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="5">无事件登记</td></tr>';

  const duRows = dutyBoard(state, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastDoneISO ? e(d.lastDoneISO) : '—'}</td>
    <td>${d.nextDue ? e(d.nextDue) : '—'}</td><td>${LEVEL[d.level] ?? d.level}</td><td>${e(d.basis)}</td>
  </tr>`).join('') || '<tr><td colspan="5">未登记周期义务</td></tr>';

  const ar = annualReportState(state, todayISOStr);
  const change = changeState(st, todayISOStr);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>动物诊疗机构迎检自证包 · ${e(st.name ?? '')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #14262b; margin: 24px; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 6px; padding-left: 12px; border-left: 6px solid #b3542f; letter-spacing: .02em; }
  .meta { font-size: 12.5px; color: #47606a; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 1px solid #d7e2e6; color: #0b4f63; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 6px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e0e8ea; }
  th { color: #0b4f63; font-weight: 600; background: #eff6f8; border-bottom: 2px solid #bcd6de; }
  tr:nth-child(even) td { background: #fafcfd; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>动物诊疗机构迎检自证包 · ${e(st.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 许可证：${e(st.certNo || '—')} · 诊疗范围：${e(st.scope || '—')} · 负责人：${e(st.manager || '—')} · ${e(st.address || '地址未填')}</div>
<h2>一、机构与证照公示（办法 2022-5 号第 12/17 条）</h2>
<div class="meta">发证机关：${e(st.org || '—')} · 发证日：${e(st.issuedISO || '—')} · 悬挂公示：${e(postingState(st).detail)} · 变更：${e(change.detail)}</div>
<h2>二、账本体检（${hc.items.length} 项）</h2>
<div class="meta">体检得分 ${hc.score}（红 ${hc.bad} · 黄 ${hc.warn}）——缺口如实列出，未闭环项以现场整改为准</div>
<table><tr><th>项目</th><th>状态</th><th>说明</th></tr>${hcRows}</table>
<h2>三、人员备案名册（防疫法第 69 条·办法 2022-6 号第 12 条）</h2>
<table><tr><th>姓名</th><th>类型</th><th>资格证书/备案</th><th>备案/入职</th></tr>${staffRows}</table>
<h2>四、诊疗台账（近 30 天：病历与处方合规）</h2>
<table><tr><th>日期</th><th>宠主</th><th>动物</th><th>诊断/处置</th><th>人员</th><th>处方笺</th></tr>${visitRows}</table>
<h2>五、狂犬免疫台账（防疫法第 30 条：免疫证明=养犬登记凭证）</h2>
<table><tr><th>日期</th><th>宠物</th><th>种类</th><th>宠主</th><th>疫苗/批号</th><th>免疫证明编号</th><th>签发人</th></tr>${rabiesRows}</table>
<h2>六、兽药与疫苗批台账（效期先进先出；过期即劣兽药禁止使用）</h2>
<table><tr><th>名称</th><th>类别</th><th>批号</th><th>有效期至</th><th>状态</th><th>供应商</th></tr>${drugRows}</table>
<h2>七、疫苗冷链记录（按标签贮存条件，默认 [2, 8]℃ 每日两次）</h2>
<table><tr><th>日期</th><th>时段</th><th>温度</th><th>区间</th><th>备注</th></tr>${coldRows}</table>
<h2>八、诊疗废弃物与病死动物台账（办法 2022-5 号第 26 条）</h2>
<table><tr><th>日期</th><th>类别</th><th>数量</th><th>移交</th></tr>${wasteRows}</table>
<h2>九、不良反应与染疫报告台账（兽药管理条例第 50 条·防疫法第 31 条）</h2>
<table><tr><th>发现日</th><th>类型</th><th>对象</th><th>程度</th><th>报告日</th></tr>${eventRows}</table>
<h2>十、周期义务与年度报告（办法 2022-5 号第 30 条）</h2>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<div class="meta">年度报告：${e(ar.detail)}</div>
<div class="sign">机构负责人（签字/盖章）：____________　执业兽医师（签字）：____________　日期：____________</div>
<div class="foot">生成：兽诊账 VetLedger · ${e(todayISOStr)} · 本页为机构自查与迎检备查材料，不替代法定报告、备案回执与兽医卫生综合信息平台报送；属地农业农村部门要求永远赢</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 患宠材料单（单次诊疗的证据链打印版：纠纷应对底稿）
// ---------------------------------------------------------------------------

/** 患宠材料单：单笔诊疗的登记-处方-疫苗-冷链证据时间线（单文件 HTML，含签字栏） */
export function caseHtml(state, visitId, todayISOStr = todayISO()) {
  const e = escapeHtml;
  const visit = (state.visits ?? []).find((v) => v.id === visitId);
  if (!visit) throw new Error(`诊疗记录不存在: ${visitId}`);
  const st = state.station ?? {};
  const from = addDays(visit.dateISO, -15);
  const to = addDays(visit.dateISO, 15);
  const rabies = (state.rabiesLog ?? []).filter((r) => (visit.owner && r.owner && r.owner === visit.owner) && r.dateISO >= from && r.dateISO <= to)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const cold = (state.coldchains ?? []).filter((c) => c.dateISO >= from && c.dateISO <= to)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  const rbRows = rabies.map((r) => `<tr>
    <td>${e(r.dateISO)}</td><td>${e(r.pet)}</td><td>${e(r.vaccineName || '—')}${r.batchNo ? ` / 批号 ${e(r.batchNo)}` : ''}</td>
    <td>${e(r.certNo)}</td><td>${e(r.doctorName)}</td>
  </tr>`).join('') || '<tr><td colspan="5">该时段无该宠免疫记录</td></tr>';
  const ccRows = cold.map((c) => `<tr>
    <td>${e(c.dateISO)} ${c.slot === 'am' ? '上午' : '下午'}</td><td>${c.tempC}℃</td><td>[${c.minC}, ${c.maxC}]℃</td>
    <td>${c.excursion ? `<strong>超温</strong>${c.note ? `：${e(c.note)}` : ''}` : '正常'}</td>
  </tr>`).join('') || '<tr><td colspan="4">该时段无冷链记录</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>诊疗材料单 · ${e(visit.pet || visit.dateISO)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #14262b; margin: 24px; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 6px; padding-left: 12px; border-left: 6px solid #b3542f; letter-spacing: .02em; }
  .meta { font-size: 12.5px; color: #47606a; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 1px solid #d7e2e6; color: #0b4f63; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 6px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e0e8ea; }
  th { color: #0b4f63; font-weight: 600; background: #eff6f8; border-bottom: 2px solid #bcd6de; }
  .box { border: 1px solid #ccc; border-radius: 8px; padding: 10px; font-size: 13px; min-height: 64px; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>诊疗材料单（机构自证底稿）</h1>
<div class="meta">机构：${e(st.name || '—')}${st.certNo ? `（许可证 ${e(st.certNo)}）` : ''} · 负责人：${e(st.manager || '—')} · 打印日：${e(todayISOStr)}</div>
<h2>一、本次诊疗（病历要素：办法 2022-5 号第 22 条）</h2>
<div class="meta">日期：${e(visit.dateISO)} · 宠主：${e(visit.owner || '—')} · 动物：${e(visit.animal || '—')}（${e(visit.pet || '—')}）</div>
<table>
  <tr><th>环节</th><th>内容</th></tr>
  <tr><td>主诉</td><td>${e(visit.complaint || '—')}</td></tr>
  <tr><td>诊断/处置</td><td>${e(visit.diagnosis || '—')}</td></tr>
  <tr><td>诊疗人员</td><td>${e(visit.doctorName)}（${e(STAFF_TYPES[visit.doctorType] ?? visit.doctorType)}，本机构备案在册）</td></tr>
  <tr><td>兽用处方药</td><td>${visit.rxRequired ? `处方笺编号 ${e(visit.rxNo || '—')} · 用药：${e(visit.rxItems || '—')}` : '未涉及'}</td></tr>
  <tr><td>备注</td><td>${e(visit.note || '—')}</td></tr>
</table>
<h2>二、同期免疫记录（前后 15 天，按宠主匹配）</h2>
<table><tr><th>日期</th><th>宠物</th><th>疫苗/批号</th><th>免疫证明</th><th>签发人</th></tr>${rbRows}</table>
<h2>三、同期疫苗冷链记录（前后 15 天）</h2>
<table><tr><th>时间</th><th>温度</th><th>区间</th><th>状态</th></tr>${ccRows}</table>
<h2>四、说明栏</h2>
<div class="box">${e(visit.note || '')}</div>
<div class="sign">机构负责人（签字/盖章）：____________　执业兽医师（签字）：____________　日期：____________</div>
<div class="foot">生成：兽诊账 VetLedger · ${e(todayISOStr)} · 本单为机构与宠主沟通、纠纷应对时的自查底稿，不构成医疗鉴定结论；诊疗纠纷的责任认定以农业农村主管部门与司法机关为准</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'vetledger', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'vetledger') return { ok: false, error: '不是兽诊账的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.station === 'object' && s.station !== null &&
    arr(s.staffs) && arr(s.visits) && arr(s.drugs) && arr(s.coldchains) &&
    arr(s.rabiesLog) && arr(s.wastes) && arr(s.events) && arr(s.duties) && arr(s.annualReports) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
