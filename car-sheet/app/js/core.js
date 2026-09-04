/**
 * core.js — 车况单 CarSheet 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；金额一律整数「分」运算，杜绝浮点误差；
 * 日期统一 ISO 字符串 yyyy-mm-dd；所有规则参数（黄线/红线天数）可在设置中被车商覆盖。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md）：
 * - 《二手车流通管理办法》（2005 年商务部等四部门令第 2 号，2017-09 修订）第十四条：
 *   二手车卖方应当向买方提供车辆的使用、修理、事故、检验以及是否办理抵押登记、
 *   交纳税费、报废期等真实情况和信息（本仓库已对照 moj.gov.cn 原文核验）
 * - 《消费者权益保护法》第五十五条：经营者提供商品有欺诈行为的，按价款三倍增加赔偿
 *   （退一赔三）——隐瞒车况的判例潮已把风险变成小微车商的现实概率
 * - 司法实践通识口径：二手车经营者负有主动查明车况的义务，「不知情」抗辩不成立——
 *   「未核查」必须如实标注，而不能装作没有问题
 * - 库存即资金：周转天数与资金占用是收售生意的第一性成本（行业通识，参数可覆盖）
 * 本工具是车商侧的告知底账与库存账本，不构成法律意见，不替代买卖合同与过户法定手续。
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

/** 距目标日还有几天（负数=已过去） */
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

/** 金额：整数分 → 「¥78000.00」 */
export function fmtYuan(cents) {
  if (!Number.isInteger(cents)) throw new Error(`金额必须为整数分: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 公里数：整数 → 「62,000 km」；空值 → 「—」 */
export function fmtKm(km) {
  if (km === null || km === undefined || km === '') return '—';
  if (!Number.isInteger(km) || km < 0) throw new Error(`公里数必须为非负整数: ${km}`);
  return `${String(km).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} km`;
}

/** 资金占用：整数「分·天」→ 「40.7 万元·天」（库存压钱的量纲） */
export function fmtTieUp(centsDays) {
  if (!Number.isInteger(centsDays)) throw new Error(`资金占用必须为整数分·天: ${centsDays}`);
  return `${(centsDays / 1000000).toFixed(1)} 万元·天`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// 档案模板（内容供应链：披露项 = 《二手车流通管理办法》第十四条告知范围的小微化拆解）
// ---------------------------------------------------------------------------

/** 收车渠道 */
export const CAR_SOURCES = {
  trade: { label: '置换收车' },
  person: { label: '个人车主' },
  peer: { label: '同业调车' },
  auction: { label: '拍卖平台' },
  other: { label: '其他渠道' },
};

/** 整备成本类型（也是披露单「维修·更换」的记账原料） */
export const COST_KINDS = {
  repair: { label: '维修整备' },
  beauty: { label: '美容清洗' },
  part: { label: '轮胎电瓶' },
  transfer: { label: '过户车务' },
  other: { label: '其他' },
};

/**
 * 九项车况披露：第十四条告知义务（使用、修理、事故、检验、抵押、税费、报废期）
 * 在小微收售场景的九个可勾选项。三态：ok 正常 / issue 有异常 / unknown 未核查。
 * 建档即全「未核查」——把「我不知道」从默认状态变成必须被消灭的红色待办。
 */
export const DISCLOSURE_FIELDS = {
  accident: { label: '结构·事故', ask: '结构件（纵梁/A柱/B柱/C柱等）有无事故变形或修复' },
  flood: { label: '水泡', ask: '有无水泡痕迹' },
  fire: { label: '火烧', ask: '有无火烧痕迹' },
  repair: { label: '维修·更换', ask: '收车前有无已知的维修、更换件记录' },
  mortgage: { label: '抵押·查封', ask: '有无未解除的抵押登记或查封' },
  operation: { label: '营运历史', ask: '有无营运历史（网约车/出租/租赁）' },
  recall: { label: '召回', ask: '有无未完成的召回' },
  mileage: { label: '里程一致性', ask: '表显里程与维保/出险记录是否一致' },
  misc: { label: '其他瑕疵·违章', ask: '其他已知瑕疵与未处理违章' },
};

export const DISCLOSURE_STATUS = {
  ok: { label: '✅ 正常' },
  issue: { label: '⚠️ 有异常' },
  unknown: { label: '❓ 未核查' },
};

/** 建一整套「未核查」披露（建档即体检，默认状态即待办） */
export function newDisclosure() {
  const out = {};
  for (const key of Object.keys(DISCLOSURE_FIELDS)) {
    out[key] = { status: 'unknown', note: '' };
  }
  return out;
}

export function assertDisclosure(d) {
  for (const key of Object.keys(DISCLOSURE_FIELDS)) {
    const item = d?.[key];
    if (!item || !DISCLOSURE_STATUS[item.status]) {
      throw new Error(`披露项缺失或状态非法: ${key}`);
    }
  }
  return d;
}

// 库存黄线/红线默认值（行业通识：45 天资金压力显性化，75 天必须决策清库；设置可覆盖）
export const DEFAULT_WARN_DAYS = 45;
export const DEFAULT_ISSUE_DAYS = 75;

// ---------------------------------------------------------------------------
// 车档与整备账（毛利永远由流水推导，不落库——改一笔账，结算自动跟着变）
// ---------------------------------------------------------------------------

function requireCar(cars, id, label = '车辆') {
  const hit = (cars ?? []).find((c) => c.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

function carCosts(costs, carId) {
  return (costs ?? []).filter((e) => e.carId === carId);
}

/** 一台车的总成本 = 收车价 + Σ整备（整数分） */
export function totalCostCents(car, costs) {
  requireCar([car], car.id);
  if (!Number.isInteger(car.buyCents) || car.buyCents < 0) {
    throw new Error(`收车价必须为非负整数分: ${car.buyCents}`);
  }
  return car.buyCents + carCosts(costs, car.id).reduce((n, e) => n + e.cents, 0);
}

/**
 * 一台车的结算（永远现算，不是快照）：
 * - 在库：在库天数 = 今天 − 收车日，资金占用 = 总成本 × 在库天数
 * - 已售：在库天数 = 售出日 − 收车日，毛利 = 售价 − 总成本
 */
export function settle(car, costs, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  const endISO = car.status === 'sold' ? car.soldISO : todayISOStr;
  const days = daysUntil(endISO, car.buyISO);
  if (days < 0) throw new Error(`在库天数为负，账本被破坏: ${car.brand ?? car.id}`);
  const total = totalCostCents(car, costs);
  return {
    totalCostCents: total,
    daysInStock: days,
    tieUpCents: total * days,
    profitCents: car.status === 'sold' ? car.sellCents - total : null,
  };
}

/** 库存老化分级：≥ 红线 issue，≥ 黄线 warn，否则 ok（参数可覆盖，黄线必须小于红线） */
export function agingLevel(days, warnDays = DEFAULT_WARN_DAYS, issueDays = DEFAULT_ISSUE_DAYS) {
  if (!Number.isInteger(days) || days < 0) throw new Error(`在库天数非法: ${days}`);
  if (!Number.isInteger(warnDays) || !Number.isInteger(issueDays) || warnDays >= issueDays) {
    throw new Error('黄线天数必须小于红线天数');
  }
  if (days >= issueDays) return 'issue';
  if (days >= warnDays) return 'warn';
  return 'ok';
}

// ---------------------------------------------------------------------------
// 披露体检与售出门诊（亮灯不阻止：车商的决策自由，但风险必须先被看见）
// ---------------------------------------------------------------------------

/** 「未核查」披露项的 key 列表 */
export function unverifiedKeys(car) {
  assertDisclosure(car.disclosure);
  return Object.keys(DISCLOSURE_FIELDS).filter((k) => car.disclosure[k].status === 'unknown');
}

/** 九项披露的三态计数 */
export function disclosureSummary(car) {
  assertDisclosure(car.disclosure);
  const sum = { ok: 0, issue: 0, unknown: 0 };
  for (const k of Object.keys(DISCLOSURE_FIELDS)) sum[car.disclosure[k].status] += 1;
  return sum;
}

/**
 * 售出门诊：卖出前把披露的窟窿摊在桌面上。
 * 法院不认「我不知道」——经营者有主动查明义务，「未核查」装作没问题正是欺诈的温床。
 * 返回 warnings 数组；工具只提示不阻止，卖出动作始终由车商自己决定。
 */
export function sellWarnings(car) {
  assertDisclosure(car.disclosure);
  const warnings = [];
  const unknown = unverifiedKeys(car);
  if (unknown.length > 0) {
    warnings.push(
      `该车还有 ${unknown.length} 项车况「未核查」（${unknown.map((k) => DISCLOSURE_FIELDS[k].label).join('、')}）——经营者有主动查明义务，先核查或在披露单中如实标注`,
    );
  }
  const issues = Object.keys(DISCLOSURE_FIELDS).filter((k) => car.disclosure[k].status === 'issue');
  if (issues.length > 0) {
    warnings.push(
      `该车有 ${issues.length} 项已知异常（${issues.map((k) => DISCLOSURE_FIELDS[k].label).join('、')}）——务必写入披露单并让买家签字确认`,
    );
  }
  return warnings;
}

/**
 * 售出落账：{ carId, sellCents, soldISO, buyer?, note? }。
 * - 已售车辆拒绝重复落账；售出日早于收车日拒绝
 * - 有「未核查」项时不阻止，但 warnings 会随结算返回（门诊在先，决策在车商）
 */
export function sellCar(state, { carId, sellCents, soldISO, buyer = '', note = '' }) {
  const car = requireCar(state.cars, carId);
  if (car.status === 'sold') throw new Error('该车已售出，不能重复落账');
  assertISO(soldISO);
  if (soldISO < car.buyISO) throw new Error('售出日不能早于收车日');
  if (!Number.isInteger(sellCents) || sellCents < 0) {
    throw new Error(`售价必须为非负整数分: ${sellCents}`);
  }
  car.status = 'sold';
  car.soldISO = soldISO;
  car.sellCents = sellCents;
  car.buyer = buyer;
  car.sellNote = note;
  return { car, warnings: sellWarnings(car), settlement: settle(car, state.costs, soldISO) };
}

/** 撤销售出（误操作回滚）：车档回到在库，在库天数与资金占用自动恢复计时 */
export function undoSell(state, carId) {
  const car = requireCar(state.cars, carId);
  if (car.status !== 'sold') throw new Error('该车不在已售状态，无需撤销');
  car.status = 'stock';
  delete car.soldISO;
  delete car.sellCents;
  delete car.buyer;
  delete car.sellNote;
  return car;
}

/**
 * 整备落账：{ id, carId, dateISO, kind, note, cents }。
 * - 已售车辆成本账已结（再记账会改写历史毛利），拒绝
 * - 金额必须为非负整数分；日期合法且不早于收车日（早于收车日的支出属于收车前成本，收进价里去谈）
 */
export function addCost(state, { id, carId, dateISO, kind, note = '', cents }) {
  const car = requireCar(state.cars, carId);
  if (car.status === 'sold') throw new Error('该车已售出，成本账已结');
  assertISO(dateISO);
  if (dateISO < car.buyISO) throw new Error('整备日期不能早于收车日');
  if (!COST_KINDS[kind]) throw new Error(`整备类型非法: ${kind}`);
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`金额必须为非负整数分: ${cents}`);
  const entry = { id, carId, dateISO, kind, note, cents };
  state.costs.push(entry);
  return entry;
}

/** 删除整备记录（在库车才可改账） */
export function removeCost(state, costId) {
  const idx = state.costs.findIndex((e) => e.id === costId);
  if (idx < 0) throw new Error(`整备记录不存在: ${costId}`);
  const car = requireCar(state.cars, state.costs[idx].carId);
  if (car.status === 'sold') throw new Error('该车已售出，成本账已结');
  state.costs.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 看板与账本（库存账 / 月报）
// ---------------------------------------------------------------------------

/** 在库清单：按资金占用降序（压钱最多的车排最前——清库决策的第一张表） */
export function inventoryRows(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  return (state.cars ?? [])
    .filter((c) => c.status === 'stock')
    .map((car) => {
      const s = settle(car, state.costs, todayISOStr);
      return {
        car,
        ...s,
        aging: agingLevel(s.daysInStock, state.settings?.warnDays, state.settings?.issueDays),
        unverified: unverifiedKeys(car).length,
      };
    })
    .sort((a, b) => b.tieUpCents - a.tieUpCents);
}

/** 全部车档的账本行（账本页台账表；售出在前无意义，按收车日倒序） */
export function ledgerRows(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  return (state.cars ?? [])
    .map((car) => ({ car, ...settle(car, state.costs, todayISOStr) }))
    .sort((a, b) => b.car.buyISO.localeCompare(a.car.buyISO));
}

/**
 * 月度经营账：按月份键分组。
 * - 收车台数按 buyISO；售出台数与毛利按 soldISO；整备投入按成本日期
 * - 平均周转 = 当月售出车辆的在库天数均值（四舍五入，无售出为 0）
 */
export function monthlyReport(cars, costs, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const inMonth = (iso) => monthKey(iso) === month;
  const sold = (cars ?? []).filter((c) => c.status === 'sold' && inMonth(c.soldISO));
  const costOf = (c) => totalCostCents(c, costs);
  const profitCents = sold.reduce((n, c) => n + (c.sellCents - costOf(c)), 0);
  const avgDays = sold.length
    ? Math.round(sold.reduce((n, c) => n + daysUntil(c.soldISO, c.buyISO), 0) / sold.length)
    : 0;
  return {
    boughtCount: (cars ?? []).filter((c) => inMonth(c.buyISO)).length,
    soldCount: sold.length,
    profitCents,
    avgDays,
    costCents: (costs ?? []).filter((e) => inMonth(e.dateISO)).reduce((n, e) => n + e.cents, 0),
  };
}

// ---------------------------------------------------------------------------
// 车况披露单（信任的交付物：三通道送达，买方签字 = 车商的核心自证凭据）
// ---------------------------------------------------------------------------

function disclosureLines(car) {
  return Object.keys(DISCLOSURE_FIELDS).map((k) => {
    const item = car.disclosure[k];
    const note = item.note ? `（${item.note}）` : '';
    if (item.status === 'ok') return { label: DISCLOSURE_FIELDS[k].label, mark: '✅', text: `正常${note}` };
    if (item.status === 'issue') return { label: DISCLOSURE_FIELDS[k].label, mark: '⚠️', text: `有异常${note || '（请向卖方询问详情）'}` };
    return { label: DISCLOSURE_FIELDS[k].label, mark: '❓', text: `未核查${note}` };
  });
}

function carIdentLine(car) {
  const parts = [
    car.plate ? `车牌 ${car.plate}` : '',
    car.vinTail ? `车架号尾号 ${car.vinTail}` : '',
    `初登 ${car.regYear} 年`,
    `表显 ${fmtKm(car.displayKm)}`,
  ].filter(Boolean);
  return parts.join(' · ');
}

function preparedCosts(costs, carId) {
  return carCosts(costs, carId)
    .slice()
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/** 车况披露单文本（微信发给买家，主通道）。同输入同输出 */
export function disclosureText({ car, costs, dealer, todayISOStr = todayISO() }) {
  requireCar([car], car.id);
  assertDisclosure(car.disclosure);
  const L = [];
  L.push(`【车况披露单】${car.brand}${car.plate ? ` · ${car.plate}` : ''}`);
  if (dealer?.name) L.push(`车行：${dealer.name}${dealer.phone ? `（${dealer.phone}）` : ''}`);
  L.push(`出具日：${todayISOStr}`);
  L.push(`车辆：${carIdentLine(car)}`);
  L.push(`来源：${CAR_SOURCES[car.source]?.label ?? '其他渠道'} · 收车日 ${car.buyISO}`);
  L.push('');
  L.push('一、车况告知（卖方如实告知记录）');
  for (const ln of disclosureLines(car)) {
    L.push(`  - ${ln.label}：${ln.mark} ${ln.text}`);
  }
  L.push('');
  L.push('二、本店收车后整备记录');
  const list = preparedCosts(costs, car.id);
  if (list.length === 0) {
    L.push('  （无）');
  } else {
    for (const e of list) {
      L.push(`  - ${e.dateISO} ${COST_KINDS[e.kind]?.label ?? '其他'}：${e.note || '—'} ${fmtYuan(e.cents)}`);
    }
  }
  L.push('');
  L.push('三、说明');
  L.push('「未核查」指卖方未掌握该方面信息，不等于没有问题；建议查验实车或委托第三方检测。');
  L.push('本单为卖方对已知车况的如实告知记录，最终车况以双方签署的买卖合同及实车现状为准。');
  L.push(`生成：车况单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 车况披露单打印版：单文件 HTML（内联样式、双方签字栏，无外部资源） */
export function disclosureHtml({ car, costs, dealer, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  requireCar([car], car.id);
  assertDisclosure(car.disclosure);
  const rows = disclosureLines(car)
    .map((ln) => `<tr><td style="width:8em">${e(ln.label)}</td><td>${e(ln.mark)} ${e(ln.text)}</td></tr>`)
    .join('');
  const list = preparedCosts(costs, car.id);
  const costRows = list.length
    ? list.map((c) => `<tr><td>${e(c.dateISO)}</td><td>${e(COST_KINDS[c.kind]?.label ?? '其他')}</td><td>${e(c.note || '—')}</td><td>${e(fmtYuan(c.cents))}</td></tr>`).join('')
    : '<tr><td colspan="4">（无）</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>车况披露单 · ${e(car.brand)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { color: #555; font-weight: 500; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>车况披露单 · ${e(car.brand)}</h1>
<div class="meta">卖方：${e(dealer?.name ?? '')}${dealer?.phone ? `（${e(dealer.phone)}）` : ''} · 出具日 ${e(todayISOStr)}</div>
<div class="meta">车辆：${e(carIdentLine(car))}</div>
<div class="meta">来源：${e(CAR_SOURCES[car.source]?.label ?? '其他渠道')} · 收车日 ${e(car.buyISO)}</div>
<h2>一、车况告知（卖方如实告知记录）</h2>
<table>${rows}</table>
<h2>二、本店收车后整备记录</h2>
<table><tr><th>日期</th><th>类型</th><th>项目</th><th>金额</th></tr>${costRows}</table>
<p class="meta">「未核查」指卖方未掌握该方面信息，不等于没有问题；建议查验实车或委托第三方检测。本单为卖方对已知车况的如实告知记录，最终车况以双方签署的买卖合同及实车现状为准。</p>
<div class="sign">买方（阅读并确认以上车况，签字）：____________　卖方（签字/盖章）：____________　日期：____________</div>
<div class="foot">生成：车况单 CarSheet · ${e(todayISOStr)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'carsheet', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'carsheet') return { ok: false, error: '不是车况单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.dealer === 'object' && s.dealer !== null &&
    arr(s.cars) && arr(s.costs) && typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
