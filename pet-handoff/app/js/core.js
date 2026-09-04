/**
 * core.js — 宠托付 PetHandoff 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖，日期计算不使用任何第三方库。
 */

// ---------------------------------------------------------------------------
// 日期工具（ISO 字符串 yyyy-mm-dd 为唯一日期表示）
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 校验 ISO 日期字符串，非法则抛错 */
export function assertISO(iso) {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) {
    throw new Error(`非法日期: ${JSON.stringify(iso)}`);
  }
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`非法日期: ${iso}`);
  return iso;
}

/** 当前日期（ISO）。now 可注入，保证测试确定性 */
export function todayISO(now = new Date()) {
  const tzOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

/** 日期加 n 天 */
export function addDays(iso, n) {
  assertISO(iso);
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 日期加 n 月；月末溢出自动收敛（01-31 加 1 月 → 02-28） */
export function addMonths(iso, n) {
  assertISO(iso);
  const [y, m, day] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(day, lastDay);
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** 日期加 n 年（经 addMonths，天然处理闰年 02-29 → 02-28） */
export function addYears(iso, n) {
  return addMonths(iso, n * 12);
}

/** 距目标日还有几天（负数=已过期） */
export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO);
  assertISO(todayISOStr);
  const ms = new Date(`${targetISO}T00:00:00Z`) - new Date(`${todayISOStr}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** 从出生日计算年龄 → { years, months } */
export function ageFromBirth(birthISO, todayISOStr = todayISO()) {
  assertISO(birthISO);
  assertISO(todayISOStr);
  if (birthISO > todayISOStr) return { years: 0, months: 0, future: true };
  let [y, m, d] = birthISO.split('-').map(Number);
  let [ty, tm, td] = todayISOStr.split('-').map(Number);
  let years = ty - y;
  let months = tm - m;
  if (td < d) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return { years: 0, months: 0, future: true };
  return { years, months, future: false };
}

// ---------------------------------------------------------------------------
// 免疫/驱虫日程
// ---------------------------------------------------------------------------

/** 到期状态：expired(已过期) / due_soon(30 天内) / ok；SOON_WINDOW_DAYS 为产品级约定 */
export const SOON_WINDOW_DAYS = 30;

export function scheduleStatus(nextDateISO, todayISOStr = todayISO()) {
  const days = daysUntil(nextDateISO, todayISOStr);
  if (days < 0) return { level: 'expired', days };
  if (days <= SOON_WINDOW_DAYS) return { level: 'due_soon', days };
  return { level: 'ok', days };
}

/**
 * 由上次执行日 + 周期天数推算下次到期日。
 * cycleDays 必须为正整数；幼犬/幼猫首免系列不适用此模型（UI 层提示遵医嘱）。
 */
export function nextDue(lastDateISO, cycleDays) {
  assertISO(lastDateISO);
  if (!Number.isInteger(cycleDays) || cycleDays <= 0) {
    throw new Error(`非法周期: ${cycleDays}`);
  }
  return addDays(lastDateISO, cycleDays);
}

/** 犬/猫常规免疫·驱虫模板（周期为行业公开惯例，UI 必须携带"遵医嘱"声明） */
export const SCHEDULE_TEMPLATES = {
  dog: [
    { item: '狂犬疫苗', cycleDays: 365, note: '多数地区为法定接种' },
    { item: '联苗年检（四/八联）', cycleDays: 365, note: '成年犬每年加强一针' },
    { item: '体外驱虫', cycleDays: 30, note: '滴剂/口服，按体重选剂型' },
    { item: '体内驱虫', cycleDays: 90, note: '常规 3 个月一次，生食习惯遵医嘱加密' },
    { item: '年度体检', cycleDays: 365, note: '建议含血常规与生化' },
  ],
  cat: [
    { item: '狂犬疫苗', cycleDays: 365, note: '室内猫同样建议' },
    { item: '猫三联加强', cycleDays: 365, note: '成年猫每年加强' },
    { item: '体外驱虫', cycleDays: 30, note: '外出/多宠家庭不可省' },
    { item: '体内驱虫', cycleDays: 90, note: '' },
    { item: '年度体检', cycleDays: 365, note: '7 岁以上建议加做肾脏指标' },
  ],
};

/** 把模板套用到某只宠物：给定模板项上次日期，产出完整日程行（含状态） */
export function applyTemplate(species, lastDates, todayISOStr = todayISO()) {
  const tpl = SCHEDULE_TEMPLATES[species];
  if (!tpl) return [];
  return tpl.map((t) => {
    const last = lastDates?.[t.item] || null;
    const next = last ? nextDue(last, t.cycleDays) : null;
    const status = next ? scheduleStatus(next, todayISOStr) : null;
    return { ...t, lastDate: last, nextDate: next, status };
  });
}

/** 聚合多宠待办：输入为日程记录（lastDate + cycleDays），按紧急度排序（expired → due_soon 升序） */
export function upcomingTasks(scheduleRows, todayISOStr = todayISO()) {
  const rank = { expired: 0, due_soon: 1, ok: 2 };
  return scheduleRows
    .filter((r) => r.lastDate && r.cycleDays)
    .map((r) => {
      const nextDate = nextDue(r.lastDate, r.cycleDays);
      return { ...r, nextDate, status: scheduleStatus(nextDate, todayISOStr) };
    })
    .filter((r) => r.status.level !== 'ok')
    .sort((a, b) =>
      rank[a.status.level] - rank[b.status.level] || a.status.days - b.status.days
    );
}

// ---------------------------------------------------------------------------
// 交接单
// ---------------------------------------------------------------------------

/**
 * 组装托养交接单数据。
 * 返回 { ok, missing, data }：ok=false 时 missing 列出阻断字段（不瞎编信息）。
 */
export function buildHandoff({ pet, care, period, contacts }) {
  const missing = [];
  if (!pet?.name) missing.push('宠物名字');
  if (!pet?.species) missing.push('宠物种类');
  if (!period?.start || !period?.end) missing.push('托养起止日期');
  if (!contacts?.sitterName) missing.push('照护者称呼');
  if (!contacts?.emergencyPhone) missing.push('紧急联系电话');
  if (!contacts?.vetPhone) missing.push('常去医院电话');

  const feedings = care?.feedings ?? [];
  const meds = care?.meds ?? [];
  if (feedings.length === 0) missing.push('至少一条喂食计划');

  const feedingTotalGrams = feedings.reduce((s, f) => {
    const m = String(f.amount ?? '').match(/(\d+(?:\.\d+)?)\s*g/i);
    return s + (m ? Number(m[1]) : 0);
  }, 0);

  return {
    ok: missing.length === 0,
    missing,
    data: {
      pet: {
        name: pet?.name ?? '',
        species: pet?.species ?? '',
        breed: pet?.breed ?? '',
        sex: pet?.sex ?? '',
        age: pet?.birth ? ageFromBirth(pet.birth, period?.start || undefined) : null,
        weightKg: pet?.weightKg ?? '',
        neutered: pet?.neutered ?? '',
        chip: pet?.chip ?? '',
        colorTag: pet?.colorTag ?? '',
        escapeRisk: care?.escapeRisk ?? 'unknown',
      },
      feedings,
      feedingTotalGrams: feedingTotalGrams || null,
      meds,
      offLimits: care?.offLimits ?? [],
      stress: care?.stressTriggers ?? '',
      routine: care?.routine ?? {},
      period: { start: period?.start ?? '', end: period?.end ?? '' },
      contacts: {
        sitterName: contacts?.sitterName ?? '',
        sitterPhone: contacts?.sitterPhone ?? '',
        ownerPhone: contacts?.ownerPhone ?? '',
        emergencyName: contacts?.emergencyName ?? '',
        emergencyPhone: contacts?.emergencyPhone ?? '',
        vetClinic: contacts?.vetClinic ?? '',
        vetPhone: contacts?.vetPhone ?? '',
      },
    },
  };
}

/** 交接单纯文本版（微信直接粘贴 fallback；单文件 HTML 的降级通道） */
export function handoffToText(h) {
  const d = h.data;
  const L = [];
  L.push(`🐾 ${d.pet.name} 的托养交接单`);
  L.push(`托养期间：${d.period.start} 至 ${d.period.end}`);
  L.push('');
  L.push('【基本信息】');
  L.push(`种类：${d.pet.species}　品种：${d.pet.breed || '—'}　体重：${d.pet.weightKg || '—'}kg　绝育：${d.pet.neutered || '—'}`);
  if (d.pet.escapeRisk === 'high') L.push('⚠️ 易走失体质：进出请随手关门！');
  L.push('');
  L.push('【喂食】');
  for (const f of d.feedings) L.push(`· ${f.time} ${f.label} ${f.amount}${f.note ? `（${f.note}）` : ''}`);
  if (d.feedingTotalGrams) L.push(`（全天合计约 ${d.feedingTotalGrams}g）`);
  if (d.meds.length) {
    L.push('');
    L.push('【用药】');
    for (const m of d.meds) L.push(`· ${m.name} ${m.dose} ${m.freq}${m.note ? `（${m.note}）` : ''}`);
  }
  if (d.offLimits.length) {
    L.push('');
    L.push(`【禁止】不能吃/不能做：${d.offLimits.join('、')}`);
  }
  if (d.stress) { L.push(''); L.push(`【应激与安抚】${d.stress}`); }
  L.push('');
  L.push('【紧急联系】');
  L.push(`照护者：${d.contacts.sitterName} ${d.contacts.sitterPhone || ''}`);
  if (d.contacts.ownerPhone) L.push(`主人：${d.contacts.ownerPhone}`);
  L.push(`紧急联系人：${d.contacts.emergencyName} ${d.contacts.emergencyPhone}`);
  L.push(`常去医院：${d.contacts.vetClinic || '—'} ${d.contacts.vetPhone}`);
  L.push('');
  L.push('※ 本单不构成医疗建议；宠物异常请第一时间联系兽医。');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 照护日志（交接期间照护者快速记录）
// ---------------------------------------------------------------------------

export const LOG_TYPES = ['喂食', '饮水', '遛弯', '铲屎', '用药', '异常'];

/** 追加日志（幂等 id；上限 2000 条防止 localStorage 膨胀） */
export function appendLog(log, entry) {
  const MAX = 2000;
  const next = [...log, { id: entry.id ?? crypto.randomUUID(), ...entry }];
  return next.length > MAX ? next.slice(next.length - MAX) : next;
}

// ---------------------------------------------------------------------------
// 数据导入导出（家庭备份 / 换机迁移）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

/** 导出完整状态快照 */
export function exportBundle(state) {
  return JSON.stringify({ app: 'pethandoff', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/**
 * 导入并校验。返回 { ok, state?, error? }——绝不部分接受：结构不合法整体拒绝。
 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'pethandoff') return { ok: false, error: '不是宠托付的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const shapeOk =
    s && typeof s === 'object' &&
    Array.isArray(s.pets) &&
    typeof s.care === 'object' && s.care !== null &&
    Array.isArray(s.schedule) &&
    Array.isArray(s.handoffs) &&
    Array.isArray(s.log);
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}

// ---------------------------------------------------------------------------
// 常见有毒食物/植物速查（内容供应链：来源见 docs/12 供应链分析；仅供参考，不构成医疗建议）
// ---------------------------------------------------------------------------

export const TOXICS = {
  dog: [
    { name: '巧克力/咖啡/茶', level: '剧毒', why: '可可碱与咖啡因，犬代谢极慢' },
    { name: '木糖醇（口香糖/无糖食品）', level: '剧毒', why: '引发胰岛素骤降与肝衰' },
    { name: '葡萄/葡萄干', level: '剧毒', why: '剂量不定即可致急性肾衰' },
    { name: '洋葱/大蒜/韭菜', level: '高毒', why: '破坏红细胞，导致溶血性贫血' },
    { name: '酒精', level: '高毒', why: '远低于人的中毒剂量' },
    { name: '夏威夷果', level: '高毒', why: '致虚弱、震颤、高热' },
    { name: '牛油果', level: '中毒', why: 'Persin，致呕吐腹泻' },
    { name: '禽类尖骨/熟骨头', level: '物理风险', why: '碎裂可刺穿消化道' },
  ],
  cat: [
    { name: '百合（全株含花粉）', level: '剧毒', why: '极微量即致急性肾衰，猫独有' },
    { name: '对乙酰氨基酚（扑热息痛）', level: '剧毒', why: '人用退烧药对猫致命，严禁自行给药' },
    { name: '洋葱/大蒜/韭菜', level: '高毒', why: '溶血性贫血' },
    { name: '巧克力/咖啡因', level: '高毒', why: '可可碱中毒' },
    { name: '生面团/酒精', level: '高毒', why: '发酵产酒精+胃扩张' },
    { name: '木糖醇', level: '高毒', why: '低血糖与肝损伤' },
    { name: '牛奶（多数成年猫）', level: '不适', why: '乳糖不耐受，致腹泻' },
    { name: '线绳/发圈/圣诞金属丝', level: '物理风险', why: '线性异物，可切割肠道' },
  ],
};
