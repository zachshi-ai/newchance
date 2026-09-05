/**
 * core.js — 来路单 SourceLog 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；金额一律整数「分」运算；日期统一
 * ISO 字符串 yyyy-mm-dd；所有规则参数（参考价/低价阈值/高频口径）可在设置中覆盖。
 *
 * 合规口径（引用与检索边界见 docs/14-调研来源.md）：
 * - 《废旧金属收购业治安管理办法》第八条（国家行政法规库）：收购生产性废旧金属
 *   应当查验出售单位开具的证明，登记出售单位名称和经办人的姓名、住址、身份证
 *   号码以及物品的名称、数量、规格、新旧程度；《再生资源回收管理办法》（商务部）
 *   口径：登记资料保存期限不得少于两年——登记不是习惯，是法定义务
 * - 《刑法》第三百一十二条 掩饰、隐瞒犯罪所得罪：明知是犯罪所得而收购，处三年
 *   以下；情节严重处三年以上七年以下。司法裁判通识口径：「以明显低于市场价的
 *   价格收购」「从同一人手中多次收购」「交易时间场所异常」都是推定「明知」的
 *   依据——废品站老板收电缆获刑的公开判例持续出现
 * - 检察官与警方的公开建议口径：了解物品来源并做好记录，来路不明应拒绝收购，
 *   发现犯罪所得及时报警——「如实登记 + 主动拒收 + 留痕」正是本产品的三个动作
 * - 本工具是站点侧的收购底账与自证台：不判定物品是否赃物（那是公安与法院的
 *   职权），只把「查验与登记义务」变成顺手的动作；不替代属地公安的备案与
 *   特种行业管理要求（属地规则永远赢）
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

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 金额：整数分 → 「¥2350.00」 */
export function fmtYuan(cents) {
  if (!Number.isInteger(cents)) throw new Error(`金额必须为整数分: ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 重量：kg 数 → 「320 kg」；空值 → 「—」 */
export function fmtKg(kg) {
  if (kg === null || kg === undefined || kg === '') return '—';
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) throw new Error(`重量必须为正数: ${kg}`);
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1)} kg`;
}

/** 单价：整数分 + kg → 「¥7.35/kg」 */
export function fmtUnitPrice(cents, kg) {
  if (!Number.isInteger(cents)) throw new Error(`金额必须为整数分: ${cents}`);
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) throw new Error(`重量必须为正数: ${kg}`);
  const perKgCents = cents / kg;
  return `¥${(Math.round(perKgCents) / 100).toFixed(2)}/kg`;
}

/** 身份证号脱敏展示：保留前 3 后 4，其余打码 */
export function maskIdNo(idNo) {
  const s = String(idNo ?? '');
  if (s.length < 8) return s ? '（证件号未录全）' : '（未录）';
  return `${s.slice(0, 3)}***********${s.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// 品类模板（内容供应链：风险分级 = 治安管理与裁判口径的小微化拆解）
// ---------------------------------------------------------------------------

/**
 * 收购品类与风险分级（通识口径，属地要求永远赢）：
 * - needProof：生产性/公用设施废旧金属——收购必须查验出售单位证明（办法第八条口径），
 *   无证明就拒收并登记拒收记录
 * - needId：需实名登记证件号的品类——高价值易盗（裁判口径的高发品类），属地有
 *   更宽要求的按属地执行
 * - refPriceDefault：参考收购价（元/kg，行情属地且随时波动，仅作低价提示基线，
 *   以当日实时行情为准；设置中可改可清空）
 */
export const ITEM_CATS = {
  iron: { label: '废钢废铁', needProof: false, needId: false, refPriceDefault: 2.2 },
  copper: { label: '废铜', needProof: false, needId: true, refPriceDefault: 60 },
  aluminum: { label: '废铝', needProof: false, needId: false, refPriceDefault: 16 },
  cable: { label: '废电缆电线', needProof: true, needId: true, refPriceDefault: 28 },
  infra: { label: '井盖·护栏·公用设施金属', needProof: true, needId: true, refPriceDefault: null },
  build: { label: '建筑金属件（扣件/模板/脚手架）', needProof: true, needId: true, refPriceDefault: 2.6 },
  battery: { label: '电动车电瓶·锂电池', needProof: false, needId: true, refPriceDefault: null },
  appliance: { label: '废家电', needProof: false, needId: false, refPriceDefault: null },
  paper: { label: '废纸纸箱', needProof: false, needId: false, refPriceDefault: 0.9 },
  plastic: { label: '废塑料', needProof: false, needId: false, refPriceDefault: 2.4 },
  other: { label: '其他', needProof: false, needId: false, refPriceDefault: null },
};

/** 拒收原因（拒收登记的原料：检察官建议口径「来路不明应拒绝收购」） */
export const REFUSE_REASONS = {
  noProof: { label: '生产性/公用金属无单位证明' },
  suspicious: { label: '来路说不清·明显可疑' },
  lowPrice: { label: '坚持明显低于行情出售且说不明原因' },
  minor: { label: '出售人异常（疑似未成年等）' },
  other: { label: '其他' },
};

// 规则参数默认值（全部可在设置中覆盖——属地规则与当日行情永远赢）
export const DEFAULT_LOW_RATIO = 50;      // 单价低于参考价 X% → 低价风险（裁判口径「明显低于市场价」的保守提示线）
export const FREQ_WINDOW_DAYS = 30;       // 高频口径窗口
export const FREQ_COUNT = 3;              // 同一人窗口内高危品类收购 ≥ N 次 → 点名

function requireSeller(sellers, id, label = '出售人') {
  const hit = (sellers ?? []).find((s) => s.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

// ---------------------------------------------------------------------------
// 出售人实名底档（档案一次建，收购时点选——登记义务变成顺手的动作）
// ---------------------------------------------------------------------------

/**
 * 出售人建档：{ id, name, idNo, phone, note }。
 * 姓名必填；证件号建议登记（高危品类收购时强制校验）；最小采集、只存本机。
 */
export function addSeller(state, { id, name, idNo = '', phone = '', note = '' }) {
  if (!name || !String(name).trim()) throw new Error('请填写出售人姓名');
  const s = {
    id, name: String(name).trim(),
    idNo: String(idNo ?? '').trim(),
    phone: String(phone ?? '').trim(),
    note: String(note ?? '').trim(),
    createdAt: new Date().toISOString(),
  };
  state.sellers.push(s);
  return s;
}

export function removeSeller(state, sellerId) {
  const idx = state.sellers.findIndex((s) => s.id === sellerId);
  if (idx < 0) throw new Error(`出售人不存在: ${sellerId}`);
  if ((state.buys ?? []).some((b) => b.sellerId === sellerId)) {
    throw new Error('该出售人有收购记录，属历史底账不可删除');
  }
  state.sellers.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 收购落账（守门在先：让「该拒收的收不进来、说不清的写不进去」）
// ---------------------------------------------------------------------------

/** 参考价（元/kg）：品类默认 → 设置覆盖（null = 该品类不参与低价提示） */
export function refPriceOf(cat, settings = {}) {
  const c = ITEM_CATS[cat];
  if (!c) throw new Error(`品类非法: ${cat}`);
  const over = settings?.refPrices?.[cat];
  if (over === null) return null;
  if (typeof over === 'number' && over > 0) return over;
  return c.refPriceDefault;
}

/**
 * 低价风险判定（derived，不落库——改参考价，历史流水的风险标注自动跟变）：
 * 单价（分/kg）< 参考价(元/kg)×100×(lowRatio/100) → true
 * 「以明显低于市场价格收购」是裁判口径推定「明知」的情形之一，工具只提示不判定。
 */
export function isLowPrice(entry, settings = {}) {
  const ref = refPriceOf(entry.cat, settings);
  if (ref === null || ref === undefined) return false;
  if (!entry.weightKg || entry.weightKg <= 0) return false;
  const unitCentsPerKg = entry.priceCents / entry.weightKg;
  const thresholdCents = ref * 100 * ((settings.lowRatio ?? DEFAULT_LOW_RATIO) / 100);
  return unitCentsPerKg < thresholdCents;
}

/**
 * 收购落账：{ id, dateISO, sellerId, cat, desc, weightKg, priceCents, proofNote?, lowNote? }
 * 守门规则：
 * - 出售人必须存在；日期合法且不得是未来
 * - 品类必须合法
 * - needProof 品类（生产性/公用金属）必须已查验单位证明并填写证明信息（proofNote）
 *   ——没有证明就不该成交，该走「拒收登记」
 * - needId 品类：出售人档案必须已登记证件号（实名缺口在落账前被拦下）
 * - 低价风险（isLowPrice）必须写明原因（lowNote）——「明显低于市场价」是推定
 *   「明知」的情形，写下来的原因就是查验过的痕迹
 */
export function addBuy(state, { id, dateISO, sellerId, cat, desc = '', weightKg = null, priceCents, proofNote = '', lowNote = '', todayISOStr = todayISO() }) {
  const seller = requireSeller(state.sellers, sellerId);
  assertISO(dateISO);
  if (dateISO > todayISOStr) throw new Error('收购日期不能是未来');
  const c = ITEM_CATS[cat];
  if (!c) throw new Error(`品类非法: ${cat}`);
  if (weightKg !== null && (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0)) {
    throw new Error(`重量必须为正数: ${weightKg}`);
  }
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new Error(`金额必须为非负整数分: ${priceCents}`);
  }
  if (c.needProof && (!proofNote || !String(proofNote).trim())) {
    throw new Error(`「${c.label}」属生产性/公用设施金属：必须查验出售单位开具的证明并登记；拿不出证明请走「拒收登记」`);
  }
  if (c.needId && !seller.idNo) {
    throw new Error(`「${c.label}」需实名登记：该出售人档案缺证件号，请先补全再落账`);
  }
  const entry = {
    id, dateISO, sellerId, cat,
    desc: String(desc ?? '').trim(),
    weightKg, priceCents,
    proofNote: String(proofNote ?? '').trim(),
    lowNote: String(lowNote ?? '').trim(),
    createdAt: new Date().toISOString(),
  };
  if (isLowPrice(entry, state.settings) && !entry.lowNote) {
    throw new Error(`该笔单价 ${fmtUnitPrice(priceCents, weightKg)} 明显低于参考价：必须写明原因（如「含绝缘皮折重」「行情当日下跌」）——这就是查验过的痕迹`);
  }
  state.buys.push(entry);
  return entry;
}

/** 删除误录（同日同品类重复时用）；当日流水可删，历史底账同理可纠错 */
export function removeBuy(state, buyId) {
  const idx = state.buys.findIndex((b) => b.id === buyId);
  if (idx < 0) throw new Error(`收购记录不存在: ${buyId}`);
  state.buys.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 拒收登记（拒收不是损失，是最硬的自证：我查验了，我拒绝了）
// ---------------------------------------------------------------------------

/**
 * 拒收登记：{ id, dateISO, sellerName, cat, desc, reason, note? }
 * 拒收发生在成交之前，出售人未必建档——姓名手填即可，能选档案则选（sellerId 选填）。
 */
export function addRefuse(state, { id, dateISO, sellerName, sellerId = '', cat, desc, reason, note = '', todayISOStr = todayISO() }) {
  assertISO(dateISO);
  if (dateISO > todayISOStr) throw new Error('拒收日期不能是未来');
  if (!sellerName || !String(sellerName).trim()) throw new Error('请填写出售人姓名（或「不明人员」）');
  if (!ITEM_CATS[cat]) throw new Error(`品类非法: ${cat}`);
  if (!desc || !String(desc).trim()) throw new Error('请简述物品情况（这是查验过的痕迹）');
  if (!REFUSE_REASONS[reason]) throw new Error(`拒收原因非法: ${reason}`);
  const entry = {
    id, dateISO,
    sellerId: sellerId || '',
    sellerName: String(sellerName).trim(),
    cat, desc: String(desc).trim(),
    reason,
    note: String(note ?? '').trim(),
    createdAt: new Date().toISOString(),
  };
  state.refuses.push(entry);
  return entry;
}

export function removeRefuse(state, refuseId) {
  const idx = state.refuses.findIndex((r) => r.id === refuseId);
  if (idx < 0) throw new Error(`拒收记录不存在: ${refuseId}`);
  state.refuses.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 出货台账（去向也是链条自证：卖给哪个打包站，白纸黑字）
// ---------------------------------------------------------------------------

/** 出货落账：{ id, dateISO, buyer, cat, weightKg, priceCents } */
export function addOut(state, { id, dateISO, buyer, cat, weightKg = null, priceCents, todayISOStr = todayISO() }) {
  assertISO(dateISO);
  if (dateISO > todayISOStr) throw new Error('出货日期不能是未来');
  if (!buyer || !String(buyer).trim()) throw new Error('请填写去向（打包站/分拣中心名称）');
  if (!ITEM_CATS[cat]) throw new Error(`品类非法: ${cat}`);
  if (weightKg !== null && (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0)) {
    throw new Error(`重量必须为正数: ${weightKg}`);
  }
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new Error(`金额必须为非负整数分: ${priceCents}`);
  }
  const entry = { id, dateISO, buyer: String(buyer).trim(), cat, weightKg, priceCents, createdAt: new Date().toISOString() };
  state.outs.push(entry);
  return entry;
}

export function removeOut(state, outId) {
  const idx = state.outs.findIndex((o) => o.id === outId);
  if (idx < 0) throw new Error(`出货记录不存在: ${outId}`);
  state.outs.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 点名与体检（检查来之前，先自己查自己）
// ---------------------------------------------------------------------------

/**
 * 销赃特征点名（derived）：同一出售人在窗口期内的高危品类（needProof 或 refPrice≥20
 * 的高价值品类之外，统一用「needId 品类」口径）收购次数 ≥ FREQ_COUNT。
 * 「从同一人手中多次收购」是裁判口径推定「明知」的情形——点名只提示多问一句，
 * 必要时报警，不判定任何人是贼。
 */
export function freqSellers(state, { windowDays = FREQ_WINDOW_DAYS, count = FREQ_COUNT, todayISOStr = todayISO() } = {}) {
  assertISO(todayISOStr);
  const fromISO = addDays(todayISOStr, -windowDays);
  const bySeller = new Map();
  for (const b of state.buys ?? []) {
    const c = ITEM_CATS[b.cat];
    if (!c?.needId) continue;
    if (b.dateISO < fromISO || b.dateISO > todayISOStr) continue;
    const arr = bySeller.get(b.sellerId) ?? [];
    arr.push(b);
    bySeller.set(b.sellerId, arr);
  }
  const rows = [];
  for (const [sellerId, buys] of bySeller) {
    if (buys.length < count) continue;
    const seller = state.sellers.find((s) => s.id === sellerId);
    rows.push({
      seller, sellerId,
      count: buys.length,
      lastISO: buys.map((b) => b.dateISO).sort().at(-1),
      cats: [...new Set(buys.map((b) => ITEM_CATS[b.cat].label))].join('、'),
    });
  }
  return rows.sort((a, b) => b.count - a.count || String(b.lastISO).localeCompare(String(a.lastISO)));
}

/** 实名缺口点名：需实名品类的收购里，出售人档案缺证件号的（历史数据/属地放宽后回落） */
export function idGaps(state) {
  return (state.buys ?? [])
    .filter((b) => ITEM_CATS[b.cat]?.needId)
    .filter((b) => !state.sellers.find((s) => s.id === b.sellerId)?.idNo)
    .map((b) => ({ buy: b, seller: state.sellers.find((s) => s.id === b.sellerId) }));
}

/** 本月低价成交清单（如实标注了原因的也要在册——查验证痕迹的第一张表） */
export function lowPriceBuys(state, month, todayISOStr = todayISO()) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  return (state.buys ?? [])
    .filter((b) => monthKey(b.dateISO) === month && isLowPrice(b, state.settings))
    .map((b) => ({ buy: b, seller: state.sellers.find((s) => s.id === b.sellerId) }));
}

/**
 * 账本体检四查：实名缺口 / 销赃特征点名 / 本月低价成交 / 孤儿数据（出售人被误删等）。
 * 保存期 ≥2 年由本地存储天然满足，登记册打印包明示口径。
 */
export function healthCheck(state, todayISOStr = todayISO()) {
  assertISO(todayISOStr);
  return {
    idGaps: idGaps(state),
    freq: freqSellers(state, { todayISOStr }),
    low: lowPriceBuys(state, monthKey(todayISOStr), todayISOStr),
    orphans: (state.buys ?? []).filter((b) => !state.sellers.find((s) => s.id === b.sellerId)).length,
  };
}

/** 月度经营账：收购笔数/金额、出货笔数/金额、拒收笔数、毛利现算（出货额 − 对应收购成本不拆品类配对，按月总差额口径） */
export function monthlyReport(state, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const inMonth = (e) => monthKey(e.dateISO) === month;
  const buys = (state.buys ?? []).filter(inMonth);
  const outs = (state.outs ?? []).filter(inMonth);
  const buyCents = buys.reduce((n, b) => n + b.priceCents, 0);
  const outCents = outs.reduce((n, o) => n + o.priceCents, 0);
  return {
    buys: buys.length,
    buyCents,
    outs: outs.length,
    outCents,
    refuses: (state.refuses ?? []).filter(inMonth).length,
    marginCents: outCents - buyCents, // 月度总差额口径：不是逐笔毛利，只回答「这个月整体转了多少」
  };
}

// ---------------------------------------------------------------------------
// 单据（信任的交付物：登记册给检查，自证单给倒查，对账单给打包站）
// ---------------------------------------------------------------------------

function stationLine(station) {
  return [station?.name, station?.phone, station?.lic ? `执照 ${station.lic}` : '', station?.filedNo ? `备案 ${station.filedNo}` : '']
    .filter(Boolean).join(' · ');
}

function buyLines(state, buys) {
  return buys.map((b) => {
    const seller = state.sellers.find((s) => s.id === b.sellerId);
    const c = ITEM_CATS[b.cat];
    return {
      buy: b, seller, cat: c,
      low: isLowPrice(b, state.settings),
      priceText: fmtYuan(b.priceCents),
      weightText: fmtKg(b.weightKg),
      unitText: b.weightKg ? fmtUnitPrice(b.priceCents, b.weightKg) : '',
    };
  });
}

/**
 * 收购登记册（打印包，单文件 HTML）：按月份输出全部收购与拒收记录。
 * 公安检查与「保存两年备查」场景的交付物——纸台账的替代，不是纸台账的装饰。
 */
export function registerHtml({ state, month, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const buys = buyLines(state, (state.buys ?? []).filter((b) => monthKey(b.dateISO) === month).sort((a, b) => a.dateISO.localeCompare(b.dateISO)));
  const refuses = (state.refuses ?? []).filter((r) => monthKey(r.dateISO) === month).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const buyRows = buys.map((r) => `<tr>
    <td>${e(r.buy.dateISO)}</td>
    <td>${e(r.seller?.name ?? '？')}<div class="basis">${e(maskIdNo(r.seller?.idNo))}${r.seller?.phone ? ` · ${e(r.seller.phone)}` : ''}</div></td>
    <td>${e(r.cat.label)}${r.buy.desc ? `<div class="basis">${e(r.buy.desc)}</div></td>` : '</td>'}
    <td>${e(r.weightText)}</td>
    <td>${e(r.priceText)}${r.unitText ? `<div class="basis">${e(r.unitText)}</div>` : ''}${r.low ? `<div class="late">低于参考价·已注明：${e(r.buy.lowNote || '—')}</div>` : ''}</td>
    <td>${r.cat.needProof ? `✅ 已查证明：${e(r.buy.proofNote)}` : '—'}</td>
  </tr>`).join('') || '<tr><td colspan="6">（本月无收购记录）</td></tr>';
  const refuseRows = refuses.map((r) => `<tr>
    <td>${e(r.dateISO)}</td>
    <td>${e(r.sellerName)}</td>
    <td>${e(ITEM_CATS[r.cat]?.label ?? r.cat)}<div class="basis">${e(r.desc)}</div></td>
    <td>${e(REFUSE_REASONS[r.reason]?.label ?? r.reason)}${r.note ? `<div class="basis">${e(r.note)}</div>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="4">（本月无拒收记录）</td></tr>';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>收购登记册 · ${e(month)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14.5px; margin: 16px 0 6px; }
  .meta { font-size: 12.5px; color: #444; margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { color: #555; font-weight: 500; }
  .basis { font-size: 11px; color: #666; }
  .late { font-size: 11px; color: #b45309; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>再生资源收购登记册 · ${e(month)}</h1>
<div class="meta">站点：${e(stationLine(state.station))}</div>
<div class="meta">依据《废旧金属收购业治安管理办法》第八条口径登记：生产性废旧金属收购查验出售单位证明，并登记出售方姓名、证件号码与物品名称、数量、规格；登记资料保存期限不少于两年（本册由站点台账系统导出，数据留存本机可追溯）。</div>
<h2>一、收购记录（${buys.length} 笔）</h2>
<table><tr><th>日期</th><th>出售人 / 证件</th><th>品类 / 情况</th><th>数量</th><th>金额 / 单价</th><th>单位证明查验</th></tr>${buyRows}</table>
<h2>二、拒收登记（${refuses.length} 笔）</h2>
<table><tr><th>日期</th><th>出售人</th><th>品类 / 情况</th><th>拒收原因</th></tr>${refuseRows}</table>
<p class="meta">本册为站点收购底账：如实登记、主动拒收、留痕备查；本册不判定物品权属，涉案物品以公安机关认定为准。</p>
<div class="sign">站点负责人（签字/盖章）：____________　日期：____________</div>
<div class="foot">生成：来路单 SourceLog · ${e(todayISOStr)}</div>
</body>
</html>`;
}

/**
 * 单笔来源自证单文本（微信/短信备用通道）：被倒查某批货时按笔出证。
 * 同输入同输出；含出售人实名与证件（站点自己的底账，供公安查验场景使用）。
 */
export function sourceText({ state, buyId, todayISOStr = todayISO() }) {
  const buy = (state.buys ?? []).find((b) => b.id === buyId);
  if (!buy) throw new Error(`收购记录不存在: ${buyId}`);
  const seller = state.sellers.find((s) => s.id === buy.sellerId);
  const c = ITEM_CATS[buy.cat];
  const low = isLowPrice(buy, state.settings);
  const L = [];
  L.push(`【收购来源说明】${buy.dateISO}`);
  if (state.station?.name) L.push(`站点：${state.station.name}${state.station.phone ? `（${state.station.phone}）` : ''}`);
  L.push(`品类：${c.label}${buy.desc ? `（${buy.desc}）` : ''}`);
  L.push(`数量：${fmtKg(buy.weightKg)} · 金额：${fmtYuan(buy.priceCents)}${buy.weightKg ? `（${fmtUnitPrice(buy.priceCents, buy.weightKg)}）` : ''}`);
  L.push(`出售人：${seller?.name ?? '？'}${seller?.idNo ? ` · 证件号 ${seller.idNo}` : ' · 证件号未登记'}${seller?.phone ? ` · 电话 ${seller.phone}` : ''}`);
  if (c.needProof) L.push(`单位证明：已查验并登记（${buy.proofNote}）`);
  if (low) L.push(`价格说明：单价低于参考价，已注明原因（${buy.lowNote}）；当日行情以实时价为准`);
  L.push('');
  L.push('本说明由站点收购台账导出，如实记录收购当日查验与登记情况；物品权属以公安机关注明的为准。');
  L.push(`生成：来路单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 单笔来源自证单打印版：含出售人签字确认栏（出售人签字 = 最硬的「查验过」证据） */
export function sourceHtml({ state, buyId, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const buy = (state.buys ?? []).find((b) => b.id === buyId);
  if (!buy) throw new Error(`收购记录不存在: ${buyId}`);
  const seller = state.sellers.find((s) => s.id === buy.sellerId);
  const c = ITEM_CATS[buy.cat];
  const low = isLowPrice(buy, state.settings);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>收购来源说明 · ${e(buy.dateISO)}</title>
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
<h1>收购来源说明单</h1>
<div class="meta">站点：${e(stationLine(state.station))} · 收购日期 ${e(buy.dateISO)}</div>
<table>
<tr><th style="width:8em">品类</th><td>${e(c.label)}${c.needProof ? '（生产性/公用设施金属·已查证明）' : ''}</td></tr>
<tr><th>物品情况</th><td>${e(buy.desc || '—')}</td></tr>
<tr><th>数量 / 金额</th><td>${e(fmtKg(buy.weightKg))} · ${e(fmtYuan(buy.priceCents))}${buy.weightKg ? `（${e(fmtUnitPrice(buy.priceCents, buy.weightKg))}）` : ''}</td></tr>
<tr><th>出售人</th><td>${e(seller?.name ?? '？')} · 证件号 ${e(seller?.idNo || '未登记')}${seller?.phone ? ` · 电话 ${e(seller.phone)}` : ''}</td></tr>
${c.needProof ? `<tr><th>单位证明</th><td>已查验并登记：${e(buy.proofNote)}</td></tr>` : ''}
${low ? `<tr><th>价格说明</th><td>单价低于参考价，原因：${e(buy.lowNote)}（当日行情以实时价为准）</td></tr>` : ''}
</table>
<p class="meta">本单由站点收购台账导出，如实记录收购当日查验与登记情况；请出售人对以上信息签字确认（信息有变的应当场更正）。物品权属以公安机关注明的为准。</p>
<div class="sign">出售人（确认以上信息属实，签字）：____________　站点经手人（签字）：____________　日期：____________</div>
<div class="foot">生成：来路单 SourceLog · ${e(todayISOStr)}</div>
</body>
</html>`;
}

/** 出货对账单文本（发给打包站对账；「去向」链条的留痕件） */
export function outStatementText({ state, month, todayISOStr = todayISO() }) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const outs = (state.outs ?? []).filter((o) => monthKey(o.dateISO) === month).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  if (!outs.length) throw new Error('该月份没有出货记录可对账');
  const byBuyer = new Map();
  for (const o of outs) {
    const arr = byBuyer.get(o.buyer) ?? [];
    arr.push(o);
    byBuyer.set(o.buyer, arr);
  }
  const L = [];
  L.push(`【出货对账单】${month}`);
  if (state.station?.name) L.push(`站点：${state.station.name}${state.station.phone ? `（${state.station.phone}）` : ''}`);
  L.push('');
  for (const [buyer, arr] of byBuyer) {
    const cents = arr.reduce((n, o) => n + o.priceCents, 0);
    L.push(`· ${buyer}：${arr.length} 笔 · 合计 ${fmtYuan(cents)}`);
    for (const o of arr) {
      L.push(`    - ${o.dateISO} ${ITEM_CATS[o.cat]?.label ?? o.cat} ${fmtKg(o.weightKg)} ${fmtYuan(o.priceCents)}`);
    }
  }
  const total = outs.reduce((n, o) => n + o.priceCents, 0);
  L.push('');
  L.push(`合计：${outs.length} 笔 · ${fmtYuan(total)}`);
  L.push('本单为站点出货底账，供贵站核对与结算参考。');
  L.push(`生成：来路单 · ${todayISOStr}`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'sourcelog', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'sourcelog') return { ok: false, error: '不是来路单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.station === 'object' && s.station !== null &&
    arr(s.sellers) && arr(s.buys) && arr(s.refuses) && arr(s.outs) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
