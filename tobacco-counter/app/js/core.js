/**
 * core.js — 烟柜账 CounterBook 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束：零外部依赖；日期统一 ISO 字符串 yyyy-mm-dd；周期/时限/提醒窗口等口径
 * 全部参数化，可在设置中被零售户覆盖（属地烟草专卖局要求永远赢）。
 *
 * 合规口径（原文链接与核验方式见 docs/14-调研来源.md，全部 2026-09-09 一手核验）：
 * - 《中华人民共和国烟草专卖法》（1991-06-29 通过，2009/2013/2015 三次修正，现行 43 条，
 *   维基文库全文核验）：
 *   第 3 条（国家对烟草专卖品的生产、销售、进出口实行专卖管理并实行烟草专卖许可证制度）；
 *   第 16 条（经营烟草制品零售业务由县级烟草专卖行政主管部门或受委托的工商部门发证）；
 *   第 17 条（卷烟、雪茄烟包装应标明焦油含量级和「吸烟有害健康」）；第 19 条（商标注册，
 *   禁止生产、销售假冒他人注册商标的烟草制品）；第 32 条（无零售许可证经营零售业务：
 *   责令停止、没收违法所得并处罚款——罚额由实施条例第 57 条细化）。
 * - 《烟草专卖法实施条例》（国务院令第 223 号，1997 发布；2013/2016/2021/2023 四次修订，
 *   现行 66 条——维基文库最新版全文 + 司法部国家行政法规库 2023 第四次修订版 PDF 双源互证；
 *   **网传大量旧文仍引 2021 版，2023-07-20 国务院令打包修改后现行版为第四次修订**）：
 *   第 6 条（烟草专卖许可证三类：生产企业/批发企业/零售）；第 9 条（取得零售许可证四条件：
 *   资金/固定经营场所/零售点合理布局/其他）；第 23 条第二款（**取得零售许可证的企业或个人，
 *   应当在当地的烟草专卖批发企业进货**——渠道义务核心条款）；第 24 条（无批发证一次销售
 *   卷烟、雪茄烟 50 条以上视为无证批发）；第 25 条（任何单位或个人不得销售非法生产的
 *   烟草制品）；第 27 条（境内销售卷烟小包、条包应标注焦油含量级和「吸烟有害健康」中文字样）；
 *   第 29 条（严禁销售霉坏、变质的烟草制品）；第 46 条（烟草专卖行政主管部门查处案件时
 *   **有权查阅、复制与违法活动有关的合同、发票、账册、单据、记录**——零售户进销台账是
 *   法定检查对口物）；第 56 条（**未在当地烟草专卖批发企业进货的：没收违法所得，可处进货
 *   总额 5%~10% 罚款**）；第 57 条（无零售证经营：没收违法所得，处违法经营总额 20%~50%
 *   罚款）；第 58 条（销售非法生产的烟草专卖品：责令停止销售、没收违法所得，处违法销售
 *   总额 20%~50% 罚款并公开销毁）；第 65 条（**电子烟等新型烟草制品参照本条例卷烟的有关
 *   规定执行**——2021-11-10 国务院令第 750 号第三次修订加入）。
 * - 《烟草专卖许可证管理办法》（工业和信息化部令第 37 号，2016-05-26 公布、2016-07-20
 *   施行，现行——本工具经实施细则转致条款引用其第 43/44/48 条，罚则金额未逐字核对处以
 *   转致呈现）；《烟草专卖许可证管理办法实施细则》（国烟法〔2020〕205 号，2021-03-01
 *   施行，北京市政府官网全文转载核验）：
 *   第 11 条（申请类型：新办/变更/延续/停业/恢复营业/歇业/补办等）；第 18 条（持证零售户
 *   在有效期内不受合理布局规划调整影响）；第 21/56 条（许可载明事项变化应及时申请变更，
 *   未及时申请的责令 30 日内依法申请变更登记）；第 22 条（**有效期届满 30 日前提出延续
 *   申请**）；第 23 条（**零售户停业 1 个月以上应提出停业申请；停业期限不得超过 1 年**）；
 *   第 42/43 条（有效期届满后不予延续情形——零售户 11 项：经营场所安全因素/中小学幼儿园
 *   周围/主体变化/不再具备固定场所/场所不再与住所相独立/布局要求变化/非法经营数额达标
 *   未追刑责/追刑责/买卖出租出借转让许可证/被吊销营业执照/其他严重违法）；第 46 条（审批
 *   8 日内决定；延续逾期未决定视为准予）；第 48 条（**许可证有效期最长不超过 5 年**）；
 *   第 49 条（**持证人应在核定经营地址经营——核定地址之外经营属无证经营**）；第 50 条
 *   （**不得向未成年人售烟；难以判明的应当要求出示身份证件；经营场所显著位置应设置相关
 *   禁止销售标志——违者属《办法》第 44 条第十项情形**）；第 51 条（**禁止利用自动售货机
 *   等自助售卖形式销售烟草制品；除持生产/批发证企业外任何主体不得通过信息网络销售烟草
 *   专卖品**）；第 52 条（不得涂改、伪造、变造许可证；不得买卖、出租、出借或以其他形式
 *   非法转让许可证）。
 * - 《电子烟管理办法》（国家烟草专卖局公告 2022 年第 1 号，2022-03-11 发布、2022-05-01
 *   施行，维基文库全文核验，现行 45 条）：
 *   第 18 条（从事电子烟零售业务应领取烟草专卖零售许可证或变更许可范围；普通中小学、
 *   特殊教育学校、中等职业学校、专门学校、幼儿园周边不得设置电子烟产品销售网点）；
 *   第 19 条（**全国统一电子烟交易管理平台；依法取得许可证的电子烟零售经营主体应当通过
 *   平台进行交易**）；第 20 条（**电子烟零售应当在当地电子烟批发企业购进电子烟产品**，
 *   并不得排他性经营）；第 22 条（**禁止向未成年人出售电子烟产品；显著位置设置不向未成年人
 *   销售标志；难以判明的应当要求出示身份证件**）；第 23 条（**禁止利用自动售货机等自助
 *   售卖方式销售电子烟；不得通过平台以外的信息网络销售电子烟**）；第 26 条（**禁止销售
 *   除烟草口味外的调味电子烟和可自行添加雾化物的电子烟**）；第 42 条（罚则转致专卖法/
 *   未保法/实施条例）。
 * - 《中华人民共和国未成年人保护法》（2020-10-17 修订，2021-06-01 施行，维基文库全文
 *   核验）：第 59 条（**学校、幼儿园周边不得设置烟、酒、彩票销售网点；禁止向未成年人
 *   销售烟、酒、彩票；烟、酒和彩票经营者应当在显著位置设置不向未成年人销售的标志；
 *   对难以判明是否是未成年人的，应当要求其出示身份证件**）；第 123 条（违反第 59 条
 *   第一款：责令限期改正、警告、没收违法所得，可并处 5 万元以下罚款；拒不改正或情节
 *   严重的：责令停业整顿或吊销营业执照、吊销相关许可证，可并处 5 万~50 万元罚款——
 *   烟草专卖部门按职责分工执法）。
 * - 统计口径（宽区间诚实标注）：全国烟草专卖零售许可证持证户业内常引约 550 万户量级
 *   （官方年度精确总数未公开检索到，待复核）；电子烟零售许可证 2022 年核发规划约 5 万~
 *   5.5 万张（行业统计口径）；国新办 2025-06-09 国家烟草专卖局新闻发布会：2024 年以来
 *   各级烟草专卖局累计出动执法人员 41.7 万人次、检查电子烟持证零售户 19.1 万户次、行政
 *   处罚 1941 户次、罚款 477.7 万元（转引发布会公开报道，执法强度锚点）。
 *
 * 本工具是烟草专卖零售户侧的自证台账，不构成法律意见，不替代烟草专卖零售许可证申请、
 * 延续、变更、停业、注销等法定程序；属地烟草专卖局要求永远赢。
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

/**
 * 日期加 n 个月，月末钳制。许可证/义务等周期「精确到月」用。
 */
export function addMonthsExact(iso, n) {
  assertISO(iso);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`月数必须为正整数: ${n}`);
  const d = new Date(`${iso}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(y, m + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** 距目标日还有几天（负数=已过期） */
export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO);
  assertISO(todayISOStr);
  const ms = new Date(`${targetISO}T00:00:00Z`) - new Date(`${todayISOStr}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** 由出生日期算周岁（生日当天=已满）。用于未成年人禁售判定 */
export function ageFromDob(dobISO, todayISOStr = todayISO()) {
  assertISO(dobISO);
  assertISO(todayISOStr);
  if (dobISO > todayISOStr) return -1; // 未来日期无效
  const by = Number(dobISO.slice(0, 4));
  const bm = Number(dobISO.slice(5, 7));
  const bd = Number(dobISO.slice(8, 10));
  const ty = Number(todayISOStr.slice(0, 4));
  const tm = Number(todayISOStr.slice(5, 7));
  const td = Number(todayISOStr.slice(8, 10));
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
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
// 口径常量（法定口径的参数化，属地要求永远赢）
// ---------------------------------------------------------------------------

/** 品规类型（专卖法第 2 条烟草专卖品零售射程内的常见品类；电子烟经实施条例第 65 条参照卷烟） */
export const PRODUCT_KINDS = {
  cigarette: '卷烟（含进口卷烟）',
  cigar: '雪茄烟',
  cutTobacco: '烟丝（有包装）',
  vape: '电子烟（烟弹/烟具/一次性）',
};

/** 进货来源（实施条例第 23 条第二款：应在当地烟草专卖批发企业进货；电子烟办法第 19/20 条：应通过全国统一电子烟交易管理平台、向当地电子烟批发企业购进） */
export const PURCHASE_SOURCES = {
  localWholesale: '当地烟草专卖批发企业（烟卷订单/电子结算）',
  vapePlatform: '全国统一电子烟交易管理平台（当地电子烟批发企业）',
  other: '其他来源（来路待核——登记即红旗，核清前不得上架销售）',
};

/** 品规类型对应的合法进货来源（类型驱动；选错=渠道闸拒绝） */
export const LEGAL_SOURCE_FOR_KIND = {
  cigarette: 'localWholesale',
  cigar: 'localWholesale',
  cutTobacco: 'localWholesale',
  vape: 'vapePlatform',
};

/** 延续申请窗口：有效期届满 30 日前提出延续申请（实施细则第 22 条） */
export const RENEW_ADVANCE_DAYS = 30;
/** 许可证有效期上限（实施细则第 48 条：最长不超过 5 年） */
export const LICENSE_MAX_YEARS = 5;
/** 许可证临期提醒（天，产品口径，早于法定申请窗口，只提示不判定） */
export const LICENSE_WARN_DAYS = 90;
/** 停业申请红线（实施细则第 23 条：停业 1 个月以上应申请；停业期限不得超过 1 年） */
export const SUSPENSION_NOTICE_DAYS = 30;
export const SUSPENSION_MAX_DAYS = 365;
/** 未成年人禁售法定年龄（未保法第 59 条） */
export const MINOR_AGE = 18;
/** 渠道核验回看窗口（天，产品口径：近 N 天内有合法进货记录视为渠道在核） */
export const CHANNEL_LOOKBACK_DAYS = 90;

/** 每日开柜合规检查项（类型驱动：卷烟户 3 项基础；在售电子烟追加 2 项。条目为本工具按
 *  细则第 50/51 条与电子烟办法第 22/23/26 条义务的现场落地整理，属地要求永远赢） */
export const DAYCHECK_ITEMS_BASE = [
  ['signage', '「不向未成年人售烟」标志在显著位置张贴完好（未保法第 59 条、细则第 50 条）'],
  ['vending', '店内无自动售货机/自助售卖形式售烟（细则第 51 条、电子烟办法第 23 条）'],
  ['online', '无信息网络售烟/网店内卷烟链接在架（细则第 51 条、电子烟办法第 23 条）'],
];
export const DAYCHECK_ITEMS_VAPE = [
  ['vapeFlavor', '在售电子烟全部为烟草口味、无调味电子烟在架（电子烟办法第 26 条）'],
  ['vapePlatform', '在售电子烟均可对应平台进货单号（电子烟办法第 19/20 条）'],
];

/** 周期义务（周期为参数化默认值，属地要求永远赢） */
export const DUTY_KINDS = {
  stocktake: { label: '库存盘点与标识完好月查（防串码/假冒/霉坏变质）', cycleDays: 30, basis: '实施条例第 25/29 条禁售非法生产与霉坏变质烟草制品 · 月查惯例参数化' },
  bizLicense: { label: '营业执照年报（市场监管义务，跨线提醒）', cycleDays: 365, basis: '《公司法》/市场主体登记管理条例年报制度 · 每年 1 月 1 日~6 月 30 日' },
  licenseSelfcheck: { label: '许可证载明事项与实际经营一致性自查', cycleDays: 180, basis: '实施细则第 21/56 条：载明事项变化应及时申请变更，未申请责令 30 日内办理' },
  vapeReconcile: { label: '电子烟平台交易对账（仅电子烟零售户）', cycleDays: 30, basis: '电子烟办法第 19 条：应当通过全国统一电子烟交易管理平台交易' },
};

/** 变更手续情形（实施细则第 11/21/56 条；电子烟办法第 18 条：许可范围变更） */
export const CHANGE_KINDS = {
  address: '经营地址变更（应在核定地址经营，地址外经营=无证）',
  subject: '经营者/主体变更（家庭经营者成员间变化可申请变更）',
  scope: '许可范围变更（如新增电子烟零售业务）',
  name: '字号/名称变更',
  other: '其他依法需办理变更的事项',
};

/** 合规事件来源（日检=每日开柜检查卡；另两类手工登记） */
export const EVENT_SOURCES = {
  daycheck: '每日开柜检查',
  inspection: '烟草专卖局检查',
  selfcheck: '自查上报',
};

/** 默认提醒参数 */
export const DEFAULT_RENEW_WARN_DAYS = 30;
export const DEFAULT_CHANNEL_WARN_DAYS = 14;
export const DEFAULT_DUTY_WARN_DAYS = 15;

// ---------------------------------------------------------------------------
// 店铺建档与许可证钟（专卖法第 16 条；实施细则第 22/48 条）
// ---------------------------------------------------------------------------

/**
 * 零售许可证钟。levels:
 * overdue  已过期（红：期间经营=无证经营，条例第 57 条没收+违法经营总额 20%~50% 罚款）；
 * window   延续申请窗口（黄：届满 30 日前应申请延续，实施细则第 22 条）；
 * warn     临期提醒（黄，产品口径）；
 * ok       正常；unset 未登记有效期（红）。
 */
export function licenseState(shop, todayISOStr, warnDays = LICENSE_WARN_DAYS) {
  assertISO(todayISOStr);
  const warn = typeof warnDays === 'number' ? warnDays : LICENSE_WARN_DAYS;
  const expiry = shop?.licenseExpiryISO;
  if (!expiry) return { level: 'unset', detail: '未登记烟草专卖零售许可证有效期——许可证是持证经营的合法性地基（专卖法第 3/16 条）' };
  const daysLeft = daysUntil(expiry, todayISOStr);
  if (daysLeft < 0) {
    return { level: 'overdue', daysLeft, detail: `许可证已于 ${expiry} 过期——期间售烟属无证经营，没收违法所得并处违法经营总额 20%~50% 罚款（实施条例第 57 条）；立即停售并向烟草专卖局申请延续` };
  }
  if (daysLeft <= RENEW_ADVANCE_DAYS) {
    return { level: 'window', daysLeft, detail: `许可证 ${expiry} 到期（剩 ${daysLeft} 天）——延续应在届满 30 日前提出申请（实施细则第 22 条），今天就办` };
  }
  if (daysLeft <= warn) {
    return { level: 'warn', daysLeft, detail: `许可证 ${expiry} 到期（剩 ${daysLeft} 天）——准备延续材料（营业执照/经营场所证明等）` };
  }
  return { level: 'ok', daysLeft, detail: `许可证有效期至 ${expiry}` };
}

/** 续期/换证办结：录入新证载明的有效期（应晚于当前），滚动许可证钟 */
export function renewLicense(shop, newExpiryISO) {
  assertISO(newExpiryISO);
  if (!shop?.licenseExpiryISO) throw new Error('先在店铺建档登记现有许可证信息');
  if (newExpiryISO <= shop.licenseExpiryISO) throw new Error('新证有效期应晚于当前有效期（延续换证）');
  shop.licenseExpiryISO = newExpiryISO;
  shop.renewedISO = todayISO();
  return shop;
}

/** 停业登记（实施细则第 23 条：停业 1 个月以上应提出停业申请，停业不得超过 1 年） */
export function startSuspension(shop, fromISO, note = '') {
  assertISO(fromISO);
  if (shop?.suspensionFromISO) throw new Error('已处于停业登记状态，先恢复营业再重新登记');
  shop.suspensionFromISO = fromISO;
  shop.suspensionNote = note;
  return shop;
}

export function endSuspension(shop, toISO) {
  assertISO(toISO);
  if (!shop?.suspensionFromISO) throw new Error('当前无停业登记');
  if (toISO < shop.suspensionFromISO) throw new Error('恢复营业日早于停业日');
  const days = daysUntil(toISO, shop.suspensionFromISO);
  shop.suspensionFromISO = '';
  shop.suspensionNote = '';
  return { days };
}

/** 停业超期检查（细则第 23 条：停业不得超过 1 年） */
export function suspensionState(shop, todayISOStr) {
  assertISO(todayISOStr);
  if (!shop?.suspensionFromISO) return { level: 'none' };
  const days = daysUntil(todayISOStr, shop.suspensionFromISO);
  if (days > SUSPENSION_MAX_DAYS) {
    return { level: 'overdue', days, detail: `停业已 ${days} 天（超 1 年上限）——停业期限不得超过一年（实施细则第 23 条），及时恢复营业或向烟草专卖局办理歇业/注销` };
  }
  return { level: 'on', days, detail: `停业登记中（自 ${shop.suspensionFromISO}，${days} 天；上限 1 年）` };
}

// ---------------------------------------------------------------------------
// 品规一物一档（专卖法第 2 条品类射程；电子烟办法第 26 条口味红线建档即拦）
// ---------------------------------------------------------------------------

/**
 * 建档一个品规。product: { name, kind, code, flavor, warnLabel, note }
 * 闸机：名称/编号必填、编号唯一；电子烟口味必须 tobacco（调味电子烟建档即拒——电子烟办法
 * 第 26 条禁止销售除烟草口味外的调味电子烟）；电子烟须有警示标识确认。
 */
export function addProduct(state, { name, kind, code, flavor = 'tobacco', warnLabel = true, note = '' }) {
  if (!String(name || '').trim()) throw new Error('品规名称必填');
  if (!String(code || '').trim()) throw new Error('品规编号/条码必填——一物一档的档主');
  if (!PRODUCT_KINDS[kind]) throw new Error(`非法品类: ${kind}`);
  if (kind === 'vape') {
    if (flavor !== 'tobacco') throw new Error('调味电子烟不得建档在售——禁止销售除烟草口味外的调味电子烟（电子烟办法第 26 条），当场拦截');
    if (!warnLabel) throw new Error('电子烟建档须确认包装标识与警语合规（电子烟办法第 14 条；实施条例第 27 条卷烟口径）');
  }
  if ((state.products ?? []).some((p) => p.code === code)) {
    throw new Error(`品规编号 ${code} 已建档（同编号唯一）`);
  }
  state.productSeq = (state.productSeq ?? 0) + 1;
  const rec = {
    id: `pd-${state.productSeq}`, name, kind, code,
    flavor: kind === 'vape' ? 'tobacco' : '',
    warnLabel: !!warnLabel,
    stock: 0,
    onSale: true,
    note,
  };
  state.products.push(rec);
  return rec;
}

/** 在售品规 */
export function onSaleProducts(state) {
  return (state.products ?? []).filter((p) => p.onSale);
}

/** 停售/恢复品规（售罄下架、退出经营；历史销售台账可回溯） */
export function setProductOnSale(state, productId, onSale) {
  const rec = (state.products ?? []).find((p) => p.id === productId);
  if (!rec) throw new Error(`品规不存在: ${productId}`);
  rec.onSale = !!onSale;
  return rec;
}

/**
 * 单品规渠道状态。levels:
 * none         未建档（红）；offSale 已停售（红）；quarantined 来源待核（红，红旗批次未核清）；
 * nolegal      从未有过合法渠道进货（红：这笔烟无法自证来路，不得售出）；
 * stale        合法进货记录超过回看窗口（黄，产品口径提醒——历史合法批次仍可自证，放行）；
 * ok           近期有合法进货记录（绿）。
 */
export function channelState(product, state, todayISOStr, lookbackDays = CHANNEL_LOOKBACK_DAYS) {
  assertISO(todayISOStr);
  const warn = typeof lookbackDays === 'number' ? lookbackDays : CHANNEL_LOOKBACK_DAYS;
  if (!product) return { level: 'none', detail: '品规未建档——先建档再进货再销售' };
  if (!product.onSale) return { level: 'offSale', detail: '已停售下架——恢复在售后方可售出' };
  if (product.quarantinedISO) {
    return { level: 'quarantined', detail: `来源待核（${product.quarantinedISO} 登记非正规渠道进货）——核清处置（报备/退回）并闭环合规事件前不得售出（实施条例第 56/58 条）` };
  }
  const legalSource = LEGAL_SOURCE_FOR_KIND[product.kind];
  const legal = (state.purchases ?? [])
    .filter((b) => b.productId === product.id && b.source === legalSource)
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];
  if (!legal) {
    return { level: 'nolegal', detail: '无合法渠道进货记录——应在当地烟草专卖批发企业进货（实施条例第 23 条第二款；电子烟办法第 19/20 条），来源不明售出=第 56/58 条处罚风险' };
  }
  const daysLeft = warn - daysUntil(todayISOStr, legal.dateISO);
  if (daysLeft < 0) {
    return { level: 'stale', detail: `最近一次合法进货在 ${legal.dateISO}（超过 ${warn} 天核验回看窗）——及时补进新订单保持渠道在核` };
  }
  return { level: 'ok', detail: `最近合法进货 ${legal.dateISO}（${PURCHASE_SOURCES[legalSource]}）` };
}

// ---------------------------------------------------------------------------
// 进货台账（渠道钟的喂食器；append-only——进销台账不删行）
// ---------------------------------------------------------------------------

/**
 * 落一笔进货。purchase: { dateISO, productId, source, orderNo, qty, amount, note }
 * 闸机：品规在档；来源与品类匹配（卷烟类→当地批发企业；电子烟→交易平台，选错当场拒绝）；
 * other=红旗批次：自动将品规置 quarantined 并登记合规事件（闭环后解除）；
 * 数量为正整数；同品规同日同单号去重。
 */
export function addPurchase(state, { dateISO, productId, source, orderNo, qty, amount = 0, note = '' }) {
  assertISO(dateISO);
  const pd = (state.products ?? []).find((p) => p.id === productId);
  if (!pd) throw new Error(`品规不存在: ${productId}`);
  if (!PURCHASE_SOURCES[source]) throw new Error(`非法进货来源: ${source}`);
  if (source !== 'other' && LEGAL_SOURCE_FOR_KIND[pd.kind] !== source) {
    throw new Error(`${PRODUCT_KINDS[pd.kind]}的合法进货来源应为「${PURCHASE_SOURCES[LEGAL_SOURCE_FOR_KIND[pd.kind]]}」（实施条例第 23 条第二款；电子烟办法第 19/20 条），选错来源当场拒绝`);
  }
  const n = Number(qty);
  if (!Number.isInteger(n) || n <= 0) throw new Error('进货数量必须为正整数');
  if (n > 50 && pd.kind !== 'vape' && source !== 'localWholesale') {
    throw new Error('一次销售卷烟、雪茄烟 50 条以上视为无证批发（实施条例第 24 条）——零售户单笔超 50 条请核对');
  }
  const no = String(orderNo ?? '').trim();
  if ((state.purchases ?? []).some((b) => b.productId === productId && b.dateISO === dateISO && b.orderNo === no && no)) {
    throw new Error('同品规同日同订单号已落账（防重复录入）');
  }
  state.purchaseSeq = (state.purchaseSeq ?? 0) + 1;
  const rec = {
    id: `pu-${state.purchaseSeq}`, dateISO, productId, source, orderNo: no,
    qty: n, amount: Number(amount) || 0, note, quarantined: source === 'other',
  };
  state.purchases.push(rec);
  pd.stock += n;
  if (source === 'other') {
    pd.quarantinedISO = dateISO;
    addEvent(state, {
      dateISO,
      source: 'selfcheck',
      desc: `红旗批次：${pd.name}（${pd.code}）×${n} 来源登记为「其他来源」——应在当地烟草专卖批发企业/电子烟平台进货（实施条例第 23 条第二款；电子烟办法第 19 条），核清处置并闭环前该品规不得售出`,
    });
  }
  return rec;
}

// ---------------------------------------------------------------------------
// 每日开柜合规检查（类型驱动；同日唯一；异常自动转合规事件）
// ---------------------------------------------------------------------------

/** 当日应检条目（在售品类含电子烟则追加电子烟条目） */
export function daycheckItemsFor(state) {
  const items = [...DAYCHECK_ITEMS_BASE];
  const hasVape = onSaleProducts(state).some((p) => p.kind === 'vape');
  if (hasVape) items.push(...DAYCHECK_ITEMS_VAPE);
  return items.map(([key, label]) => ({ key, label }));
}

/**
 * 落一笔当日开柜检查（同日唯一）。results: { [key]: { ok: bool, note: string } }
 * 闸机：同日已检拒绝；任一条目异常必须写处置说明；异常条目自动登记合规事件
 * （未闭环事件会拦截相关品规的销售——带病的柜台开不了张）。
 */
export function recordDaycheck(state, { dateISO, results = {}, note = '' }) {
  assertISO(dateISO);
  const items = daycheckItemsFor(state);
  if ((state.daychecks ?? []).some((d) => d.dateISO === dateISO)) {
    throw new Error(`${dateISO} 已有开柜检查记录（同日唯一；漏检如实留缺，不补造）`);
  }
  const entries = [];
  const issues = [];
  for (const it of items) {
    const r = results[it.key];
    const ok = !!(r && r.ok);
    const itemNote = String(r?.note ?? '').trim();
    if (!ok && !itemNote) {
      throw new Error(`「${it.label.split('（')[0]}」异常必须写明处置说明——只打叉不留痕不算检查`);
    }
    entries.push({ key: it.key, label: it.label, ok, note: itemNote });
    if (!ok) issues.push(it.label);
  }
  state.daycheckSeq = (state.daycheckSeq ?? 0) + 1;
  const rec = {
    id: `dc-${state.daycheckSeq}`, dateISO,
    items: entries,
    status: issues.length ? 'issue' : 'ok',
    note,
  };
  state.daychecks.push(rec);
  for (const label of issues) {
    addEvent(state, {
      dateISO,
      source: 'daycheck',
      desc: `开柜检查异常：${label}——${entries.find((x) => x.label === label)?.note ?? ''}`,
    });
  }
  return rec;
}

/** 最近一次开柜检查，从未返回 null */
export function lastDaycheck(state) {
  const list = [...(state.daychecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  return list[0] ?? null;
}

// ---------------------------------------------------------------------------
// 合规事件闭环（状态机 open → fixed → closed；来源：开柜检查/烟草局检查/自查）
// ---------------------------------------------------------------------------

/** 手工登记合规事件（开柜检查异常由 recordDaycheck 自动登记，无需手工重复） */
export function addEvent(state, { dateISO, source = 'selfcheck', desc }) {
  assertISO(dateISO);
  if (!EVENT_SOURCES[source]) throw new Error(`非法来源: ${source}`);
  if (!String(desc || '').trim()) throw new Error('事件描述必填');
  state.eventSeq = (state.eventSeq ?? 0) + 1;
  const rec = {
    id: `ev-${state.eventSeq}`, dateISO, source, desc,
    action: '', actionISO: '', verifyISO: '', verifiedBy: '', status: 'open',
  };
  state.events.push(rec);
  return rec;
}

/** 整改（open → fixed）：措施与完成日必填；完成日不得早于发现日 */
export function fixEvent(state, eventId, { actionISO, action }) {
  const ev = (state.events ?? []).find((x) => x.id === eventId);
  if (!ev) throw new Error(`事件不存在: ${eventId}`);
  if (ev.status !== 'open') throw new Error('只有未整改事件可以登记整改（状态机 open → fixed → closed）');
  assertISO(actionISO);
  if (actionISO < ev.dateISO) throw new Error('整改完成日早于发现日');
  if (!String(action || '').trim()) throw new Error('处置措施必填——只打勾不留痕不算整改');
  ev.action = action;
  ev.actionISO = actionISO;
  ev.status = 'fixed';
  return ev;
}

/** 复查销案（fixed → closed）：复查人与复查日必填；红旗批次品规在销案时解除隔离 */
export function closeEvent(state, eventId, { verifyISO, verifiedBy }) {
  const ev = (state.events ?? []).find((x) => x.id === eventId);
  if (!ev) throw new Error(`事件不存在: ${eventId}`);
  if (ev.status === 'open') throw new Error('先登记处置措施，再复查销案（跳级拒绝）');
  if (ev.status === 'closed') throw new Error('该事件已闭环');
  assertISO(verifyISO);
  if (verifyISO < ev.actionISO) throw new Error('复查日早于处置完成日');
  if (!String(verifiedBy || '').trim()) throw new Error('复查人必填（建议店主本人）');
  ev.verifyISO = verifyISO;
  ev.verifiedBy = verifiedBy;
  ev.status = 'closed';
  // 红旗批次来源的事件闭环时，解除品规隔离（对应红旗事件描述含品规编号）
  const m = ev.desc.match(/（([^（）]+)）×\d+ 来源登记为/);
  if (m) {
    const pd = (state.products ?? []).find((p) => p.code === m[1]);
    if (pd && pd.quarantinedISO) delete pd.quarantinedISO;
  }
  return ev;
}

/** 未闭环合规事件（早的在前） */
export function openEvents(state) {
  return (state.events ?? []).filter((h) => h.status !== 'closed').sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// 售烟四闸与销售台账（产品的门禁：每一笔销售都过闸落账）
// ---------------------------------------------------------------------------

/**
 * 单笔售烟闸机体检。返回 { ok, reasons[], gates: [{key, ok, detail}] }，每条拒绝理由带法条口径。
 * 四道闸（全部通过才放行）：
 * 1. 许可证在期（专卖法第 3/16 条；过期经营=无证经营，条例第 57 条 20%~50% 罚款）；
 * 2. 渠道合法（实施条例第 23 条第二款当地批发企业进货；电子烟办法第 19/20 条平台进货；
 *    红旗批次核清前不得售出；库存不足当场拦截——台账与实物一致）；
 * 3. 未成年人核验（未保法第 59 条：禁售+难以判明应当要求出示身份证件；违者第 123 条
 *    5 万以下、拒不改正或情节严重 5 万~50 万+停业整顿/吊销执照/吊销许可证）；
 * 4. 电子烟专闸（在售电子烟必须有平台进货单号且为烟草口味——电子烟办法第 19/26 条）。
 */
export function sellGate(state, { dateISO, productId, qty = 1, buyerLooksMinor = false, ageVerified = false, buyerDobISO = '' }) {
  assertISO(dateISO);
  const reasons = [];
  const gates = [];

  // 闸 1：许可证
  const lic = licenseState(state.shop ?? {}, dateISO);
  // window=仍在有效期、只是进入延续窗口——照常售烟，只提醒办手续
  const g1 = ['ok', 'warn', 'window'].includes(lic.level);
  if (!g1) reasons.push(lic.level === 'unset' ? `许可证未登记有效期——${lic.detail}` : `许可证已过期——${lic.detail}`);
  gates.push({ key: 'license', ok: g1, detail: lic.detail });

  // 闸 2：渠道与库存
  const pd = (state.products ?? []).find((p) => p.id === productId);
  const ch = channelState(pd, state, dateISO);
  const n = Number(qty);
  const qtyOk = Number.isInteger(n) && n > 0;
  const stockOk = pd ? pd.stock >= n : false;
  // stale=历史合法批次仍可自证（放行+提醒）；nolegal=从未有合法批次（硬拦）
  const g2 = pd && ['ok', 'stale'].includes(ch.level) && qtyOk && stockOk;
  if (!pd) reasons.push('品规未选择或未建档——先进货台账再售烟');
  else {
    if (!qtyOk) reasons.push('售出数量必须为正整数');
    else if (!stockOk) reasons.push(`库存不足（账面 ${pd.stock}，售 ${n}）——先进货或核对数量，台账与实物一致才能迎检`);
    if (['offSale', 'quarantined', 'none', 'nolegal'].includes(ch.level)) reasons.push(ch.detail);
  }
  gates.push({ key: 'channel', ok: g2, detail: pd ? `${ch.detail}${qtyOk ? ` · 账面库存 ${pd.stock}` : ''}` : '未选品规' });

  // 闸 3：未成年人核验
  let g3 = true;
  if (buyerLooksMinor && !ageVerified) {
    g3 = false;
    reasons.push('购买人疑似未成年人且未核验身份证件——对难以判明是否是未成年人的，应当要求其出示身份证件（未保法第 59 条；细则第 50 条）。先核验证件再售');
  } else if (buyerLooksMinor && ageVerified && buyerDobISO) {
    const age = ageFromDob(buyerDobISO, dateISO);
    if (age < MINOR_AGE) {
      g3 = false;
      reasons.push(`核验结果为未成年人（${buyerDobISO} 出生，${age} 周岁）——禁止向未成年人销售烟草制品（未保法第 59 条；违者第 123 条：责令改正、警告、没收违法所得可并处 5 万元以下罚款，拒不改正或情节严重的停业整顿或吊销营业执照、吊销许可证并可并处 5 万~50 万元罚款）。这笔烟不能卖`);
    }
  }
  gates.push({
    key: 'minor', ok: g3,
    detail: buyerLooksMinor ? (ageVerified ? (buyerDobISO ? `已核验证件（出生 ${buyerDobISO}）` : '已核验证件为成年人') : '疑似未成年·未核验') : '无未成年人表征',
  });

  // 闸 4：电子烟专闸（渠道闸已含平台来源校验；这里核在售电子烟的口味与平台单留痕）
  let g4 = true;
  if (pd && pd.kind === 'vape') {
    const platformBuy = (state.purchases ?? []).some((b) => b.productId === pd.id && b.source === 'vapePlatform' && (b.orderNo || '').trim());
    if (!platformBuy) {
      g4 = false;
      reasons.push(`在售电子烟无平台进货单号留痕——应当通过全国统一电子烟交易管理平台交易（电子烟办法第 19 条、第 20 条向当地电子烟批发企业购进）。补录平台订单号`);
    }
    if (pd.flavor !== 'tobacco') {
      g4 = false;
      reasons.push('在售电子烟口味非烟草味——禁止销售除烟草口味外的调味电子烟（电子烟办法第 26 条）');
    }
  }
  gates.push({ key: 'vape', ok: g4, detail: pd && pd.kind === 'vape' ? (g4 ? '烟草口味·平台单留痕在案' : '电子烟专闸未过') : '非电子烟·不适用' });

  return { ok: reasons.length === 0, reasons, gates, product: pd };
}

/**
 * 落一笔销售台账：四道闸全部通过才落账，同时扣减账面库存并记录合规快照。
 * 同日同品规同数量同核验结果可重复（真实柜台就是这样）——销售台账不设同日唯一。
 */
export function addSale(state, { dateISO, productId, qty = 1, buyerLooksMinor = false, ageVerified = false, buyerDobISO = '', note = '' }) {
  assertISO(dateISO);
  const n = Number(qty);
  if (!Number.isInteger(n) || n <= 0) throw new Error('售出数量必须为正整数');
  const gate = sellGate(state, { dateISO, productId, qty: n, buyerLooksMinor, ageVerified, buyerDobISO });
  if (!gate.ok) {
    throw new Error(`售烟被闸机拦截：${gate.reasons.join('；')}`);
  }
  const pd = gate.product;
  state.saleSeq = (state.saleSeq ?? 0) + 1;
  const rec = {
    id: `sl-${state.saleSeq}`, dateISO, productId, productCode: pd.code, productName: pd.name,
    kind: pd.kind, qty: n,
    minorCheck: buyerLooksMinor ? (ageVerified ? (buyerDobISO ? `已核验证件（${buyerDobISO}）` : '已核验证件·成年人') : '未核验') : '无表征',
    note,
    snapshot: {
      licenseExpiryISO: state.shop?.licenseExpiryISO ?? '',
      stockAfter: pd.stock - n,
    },
  };
  pd.stock -= n;
  state.sales.push(rec);
  return rec;
}

/** 删除销售记录（录错自救；回滚库存；删除埋点留痕） */
export function removeSale(state, saleId) {
  const idx = (state.sales ?? []).findIndex((s) => s.id === saleId);
  if (idx < 0) throw new Error(`销售记录不存在: ${saleId}`);
  const [rec] = state.sales.splice(idx, 1);
  const pd = (state.products ?? []).find((p) => p.id === rec.productId);
  if (pd) pd.stock += rec.qty;
}

/** 今日销售笔数/盒数（看板用） */
export function todaySales(state, dateISO) {
  assertISO(dateISO);
  const list = (state.sales ?? []).filter((s) => s.dateISO === dateISO);
  return { count: list.length, units: list.reduce((a, s) => a + s.qty, 0), minorBlocked: list.filter((s) => s.minorCheck !== '无表征').length };
}

// ---------------------------------------------------------------------------
// 变更手续台账（实施细则第 21/56 条；电子烟办法第 18 条）
// ---------------------------------------------------------------------------

/** 登记一项变更事实（发生日 + 情形 + 说明） */
export function addChange(state, { dateISO, kind, detail = '' }) {
  assertISO(dateISO);
  if (!CHANGE_KINDS[kind]) throw new Error(`非法变更情形: ${kind}`);
  if (!String(detail || '').trim()) throw new Error('变更说明必填（变更前后内容）');
  state.changeSeq = (state.changeSeq ?? 0) + 1;
  const rec = { id: `cg-${state.changeSeq}`, dateISO, kind, detail, filedISO: '', status: 'open' };
  state.changes.push(rec);
  return rec;
}

/** 办结变更手续（向烟草专卖局办理完毕，回执日期） */
export function fileChange(state, changeId, filedISO) {
  assertISO(filedISO);
  const rec = (state.changes ?? []).find((c) => c.id === changeId);
  if (!rec) throw new Error(`变更记录不存在: ${changeId}`);
  if (rec.status === 'filed') throw new Error('该变更已办结');
  if (filedISO < rec.dateISO) throw new Error('办理日期早于变更发生日');
  rec.filedISO = filedISO;
  rec.status = 'filed';
  return rec;
}

/** 未办结变更 */
export function openChanges(state) {
  return (state.changes ?? []).filter((c) => c.status === 'open');
}

// ---------------------------------------------------------------------------
// 周期义务账（库存月查/执照年报/许可自查/平台对账；打勾自动滚动）
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
  const cycle = cycleDays ?? DUTY_KINDS[duty.kind]?.cycleDays ?? 365;
  if (!duty.lastDoneISO) return { level: 'never', cycle };
  const nextDue = addDays(duty.lastDoneISO, cycle);
  const daysLeft = daysUntil(nextDue, todayISOStr);
  const level = daysLeft < 0 ? 'overdue' : daysLeft <= 15 ? 'due' : 'ok';
  return { level, cycle, nextDue, daysLeft };
}

/** 全部义务看板：未登记的义务也以「从未执行」入板；红灯在前，附类型与依据 */
export function dutyBoard(state, todayISOStr) {
  assertISO(todayISOStr);
  const order = { never: 0, overdue: 1, due: 2, ok: 3 };
  const hasVape = onSaleProducts(state).some((p) => p.kind === 'vape');
  const kinds = Object.keys(DUTY_KINDS).filter((k) => k !== 'vapeReconcile' || hasVape);
  const registered = new Map((state.duties ?? []).map((d) => [d.kind, d]));
  const all = kinds.map((kind) => registered.get(kind) ?? { kind, lastDoneISO: '' });
  return all
    .map((d) => ({ kind: d.kind, label: DUTY_KINDS[d.kind]?.label ?? d.kind, basis: DUTY_KINDS[d.kind]?.basis ?? '', lastDoneISO: d.lastDoneISO, ...dutyState(d, todayISOStr) }))
    .sort((a, b) => order[a.level] - order[b.level] || (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9));
}

// ---------------------------------------------------------------------------
// 账本体检（迎检前的自查打分；全部确定性输出）
// ---------------------------------------------------------------------------

/**
 * 十项体检。score = 100 - 红×12 - 黄×4（下限 0）。
 */
export function healthCheck(state, todayISOStr, settings = {}) {
  assertISO(todayISOStr);
  const renewWarn = settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS;
  const channelWarn = settings.channelWarnDays ?? DEFAULT_CHANNEL_WARN_DAYS;
  const items = [];

  // ① 许可证与延续窗口
  const lic = licenseState(state.shop ?? {}, todayISOStr, renewWarn);
  items.push({
    key: 'license', label: '零售许可证与延续窗口',
    level: ['unset', 'overdue'].includes(lic.level) ? 'bad' : ['window', 'warn'].includes(lic.level) ? 'warn' : 'ok',
    detail: lic.detail,
  });

  // ② 进货渠道（在售品规全部有合法进货记录且在核）
  const sale = onSaleProducts(state);
  const badChannel = sale.filter((p) => ['none', 'nolegal', 'quarantined', 'offSale'].includes(channelState(p, state, todayISOStr, channelWarn).level));
  const staleChannel = sale.filter((p) => channelState(p, state, todayISOStr, channelWarn).level === 'stale');
  items.push({
    key: 'channel', label: '进货渠道合法性（当地批发/平台）',
    level: badChannel.length ? 'bad' : staleChannel.length || !sale.length ? 'warn' : 'ok',
    detail: badChannel.length
      ? `${badChannel.length} 个在售品规渠道红灯（${badChannel.map((p) => `${p.name}（${p.code}）`).join('、')}）——无合法进货记录或来源待核（实施条例第 23 条第二款/第 56 条）`
      : staleChannel.length
        ? `${staleChannel.length} 个品规渠道在核临期（最近合法进货超 ${channelWarn} 天）——补进新订单`
        : sale.length
          ? `${sale.length} 个在售品规渠道全部在核`
          : '品规台账为空——先建档再进货',
  });

  // ③ 今日销售台账
  const ts = todaySales(state, todayISOStr);
  items.push({
    key: 'sales', label: '今日销售台账落账',
    level: ts.count > 0 ? 'ok' : 'warn',
    detail: ts.count > 0
      ? `今日已落 ${ts.count} 笔（${ts.units} 盒/条），含未成年人核验留痕 ${ts.minorBlocked} 笔——检查对口「账册、单据、记录」（实施条例第 46 条）`
      : '今日尚无销售落账——非营业日可忽略；营业日每笔售烟过闸落账',
  });

  // ④ 开柜检查坚持
  const last = lastDaycheck(state);
  const daysSince = last ? 0 - daysUntil(last.dateISO, todayISOStr) : null;
  items.push({
    key: 'daycheck', label: '每日开柜检查坚持',
    level: daysSince === null ? 'bad' : daysSince === 0 ? 'ok' : daysSince <= 3 ? 'warn' : 'bad',
    detail: daysSince === null
      ? '从未落开柜检查卡——「不向未成年人售烟」标志、无自助售卖、无网络售烟三项现场义务无自查证据（未保法第 59 条；细则第 50/51 条）'
      : daysSince === 0
        ? '今日检查已落卡' + (last.status === 'issue' ? `（${last.items.filter((i) => !i.ok).length} 项异常已转合规事件）` : '，全项正常')
        : `最近一次检查在 ${daysSince} 天前（${last.dateISO}）——营业日每日开柜都应检查`,
  });

  // ⑤ 未成年人核验留痕（近 90 天）
  const recentSales = (state.sales ?? []).filter((s) => daysUntil(todayISOStr, s.dateISO) <= 90);
  const unverified = recentSales.filter((s) => s.minorCheck === '未核验' || s.minorCheck.includes('拦截'));
  const verified = recentSales.filter((s) => s.minorCheck.startsWith('已核验'));
  items.push({
    key: 'minor', label: '未成年人核验留痕（近 90 天）',
    level: unverified.length ? 'bad' : 'ok',
    detail: unverified.length
      ? `${unverified.length} 笔销售登记为疑似未成年且未核验——这类台账留在账上就是检查时的反证，先走核验流程`
      : verified.length
        ? `近 90 天 ${verified.length} 笔核验留痕在案（难以判明时核验了证件——未保法第 59 条义务的执行证据）`
        : '近 90 天无疑似未成年情形——遇到难以判明的顾客记得核验证件并落账',
  });

  // ⑥ 电子烟专账（仅电子烟户）
  const vape = sale.filter((p) => p.kind === 'vape');
  if (vape.length) {
    const badVape = vape.filter((p) => p.flavor !== 'tobacco' || channelState(p, state, todayISOStr).level === 'none');
    items.push({
      key: 'vape', label: '电子烟专账（平台进货/烟草口味）',
      level: badVape.length ? 'bad' : 'ok',
      detail: badVape.length
        ? `${badVape.length} 个电子烟品规专账异常（非烟草口味或无平台进货）——电子烟办法第 19/26 条`
        : `${vape.length} 个电子烟品规：烟草口味、平台进货单留痕在案（电子烟办法第 19/20/26 条）`,
    });
  }

  // ⑦ 库存月查义务
  const board = dutyBoard(state, todayISOStr);
  const st = board.find((d) => d.kind === 'stocktake');
  items.push({
    key: 'stocktake', label: '库存盘点与标识月查',
    level: !st || st.level === 'never' || st.level === 'overdue' ? 'bad' : st.level === 'due' ? 'warn' : 'ok',
    detail: !st || st.level === 'never'
      ? '从未登记库存盘点——霉坏变质/非法生产烟草制品禁售（实施条例第 25/29 条），月查是防患底账'
      : st.level === 'overdue'
        ? `库存月查已逾期（应于 ${st.nextDue} 前开展）`
        : st.level === 'due'
          ? `库存月查应于 ${st.nextDue} 前开展（剩 ${st.daysLeft} 天）`
          : `上次库存月查 ${st.lastDoneISO}，${st.nextDue} 前再查`,
  });

  // ⑧ 变更手续与许可证自查
  const openCh = openChanges(state);
  const lc = board.find((d) => d.kind === 'licenseSelfcheck');
  items.push({
    key: 'change', label: '变更手续与许可一致性',
    level: openCh.length ? 'warn' : lc && ['never', 'overdue'].includes(lc.level) ? 'warn' : 'ok',
    detail: [
      openCh.length ? `${openCh.length} 项变更未办结——载明事项变化应及时申请变更（实施细则第 21 条；未申请责令 30 日内办理，第 56 条）` : '',
      lc && ['never', 'overdue'].includes(lc.level) ? '许可证载明事项一致性自查欠账（半年周期参数化）' : '',
      !openCh.length && lc && !['never', 'overdue'].includes(lc.level) ? '变更无欠账、一致性自查在期' : '',
    ].filter(Boolean).join('；') || '变更无欠账',
  });

  // ⑨ 合规事件闭环
  const ev = openEvents(state);
  items.push({
    key: 'events', label: '合规事件闭环',
    level: ev.some((x) => x.status === 'open') ? 'bad' : ev.length ? 'warn' : 'ok',
    detail: ev.length
      ? `${ev.length} 项合规事件未销案（最早 ${ev[0].dateISO}：${ev[0].desc.slice(0, 40)}…）——红旗品规闭环前不得售出`
      : '合规事件全闭环',
  });

  // ⑩ 停业登记与执照年报
  const susp = suspensionState(state.shop ?? {}, todayISOStr);
  const bl = board.find((d) => d.kind === 'bizLicense');
  items.push({
    key: 'status', label: '停业登记与执照年报',
    level: susp.level === 'overdue' ? 'bad' : !bl || ['never', 'overdue'].includes(bl.level) ? 'warn' : 'ok',
    detail: [
      susp.level === 'overdue' ? susp.detail : '',
      susp.level === 'on' ? susp.detail : '',
      !bl || bl.level === 'never' ? '营业执照年报未登记（市场监管义务，每年 1~6 月报上一年度）' : bl.level === 'overdue' ? `执照年报已逾期（应于 ${bl.nextDue} 前）` : bl && bl.level === 'due' ? `执照年报应于 ${bl.nextDue} 前完成` : '',
      susp.level === 'none' && bl && bl.level === 'ok' ? '无停业登记、年报在期' : '',
    ].filter(Boolean).join('；'),
  });

  const bad = items.filter((i) => i.level === 'bad').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  return { items, bad, warn, score: Math.max(0, 100 - bad * 12 - warn * 4) };
}

// ---------------------------------------------------------------------------
// 月度小结（微信文本通道，确定性输出）
// ---------------------------------------------------------------------------

/**
 * 月度小结。month 形如 '2026-12'。
 */
export function monthlySummary(state, month, todayISOStr = todayISO()) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  assertISO(todayISOStr);
  const inMonth = (iso) => monthKey(iso) === month;
  const settings = state.settings ?? {};
  const sales = (state.sales ?? []).filter((s) => inMonth(s.dateISO));
  const units = sales.reduce((a, s) => a + s.qty, 0);
  const blocked = (state.traces ?? []).filter((t) => t.type === 'sell-blocked' && inMonth((t.dateISO || t.at || '').slice(0, 10)));
  const minorBlocked = blocked.filter((t) => String(t.reasons || '').includes('未成年人') || String(t.reasons || '').includes('核验'));
  const daychecks = (state.daychecks ?? []).filter((d) => inMonth(d.dateISO));
  const issues = daychecks.filter((d) => d.status === 'issue');
  const evs = (state.events ?? []).filter((h) => inMonth(h.dateISO));
  const evsClosed = evs.filter((h) => h.status === 'closed');
  const openEv = openEvents(state);
  const purchases = (state.purchases ?? []).filter((b) => inMonth(b.dateISO));
  const lic = licenseState(state.shop ?? {}, todayISOStr, settings.renewWarnDays ?? DEFAULT_RENEW_WARN_DAYS);
  const hc = healthCheck(state, todayISOStr, settings);

  const L = [];
  L.push(`【烟柜合规月度小结】${month}`);
  if (state.shop?.name) L.push(`门店：${state.shop.name}（零售许可证 ${state.shop.licenseNo || '—'}，有效期至 ${state.shop.licenseExpiryISO || '—'}）`);
  L.push(`销售台账落账 ${sales.length} 笔（${units} 盒/条），闸机拦截不合规售烟 ${blocked.length} 次（其中未成年人核验拦截 ${minorBlocked.length} 次）——每次拦截都是没被罚的证据`);
  L.push(`进货落账 ${purchases.length} 笔${purchases.length ? `（${purchases.filter((b) => b.source === 'other').length} 笔来源待核已红旗）` : ''}；开柜检查 ${daychecks.length} 次（异常 ${issues.length} 次已转事件）`);
  L.push(`合规事件登记 ${evs.length} 项、销案 ${evsClosed.length} 项${openEv.length ? `，仍有 ${openEv.length} 项未闭环（红旗品规闭环前不得售出）` : ''}`);
  if (['window', 'warn'].includes(lic.level)) L.push(`⚠ 延续窗口提醒：${lic.detail}`);
  if (lic.level === 'overdue') L.push(`⚠ 许可证已过期：${lic.detail}`);
  const dutiesLate = dutyBoard(state, todayISOStr).filter((d) => d.level === 'never' || d.level === 'overdue');
  if (dutiesLate.length) L.push(`⚠ 周期义务欠账：${dutiesLate.map((d) => d.label).join('、')}`);
  L.push(`账本体检 ${hc.score} 分（红 ${hc.bad} · 黄 ${hc.warn}）`);
  L.push('口径：《烟草专卖法》（2015 修正）第 3/16/32 条、《烟草专卖法实施条例》（2023 第四次修订）第 23/25/46/56/57/58/65 条、《烟草专卖许可证管理办法实施细则》（国烟法〔2020〕205 号）第 22/23/48/49/50/51 条、《电子烟管理办法》（国家烟草专卖局公告 2022 年第 1 号）第 19/20/22/23/26 条、《未成年人保护法》（2021 施行）第 59/123 条；本小结为零售户自查底稿，不替代许可证申请、延续、变更、停业、注销等法定程序。');
  L.push(`生成：烟柜账 · ${month}`);
  return {
    text: L.join('\n'), sales: sales.length, units, blocked: blocked.length,
    minorBlocked: minorBlocked.length, purchases: purchases.length,
    daychecks: daychecks.length, evs: evs.length, evsClosed: evsClosed.length, score: hc.score,
  };
}

// ---------------------------------------------------------------------------
// 出证物（单文件 HTML：迎检自证包 / 当日柜台核对单；同输入同输出）
// ---------------------------------------------------------------------------

/** 迎检自证包：单文件 HTML（内联样式、无外部资源、含签字栏）——对口实施条例第 46 条「查阅、复制账册单据记录」的检查职权 */
export function inspectHtml(state, todayISOStr = todayISO(), settings = {}) {
  const e = escapeHtml;
  const v = state.shop ?? {};
  const LEVEL = { overdue: '逾期', due: '临期', window: '延续窗口', warn: '临期', ok: '正常', never: '从未开展', unset: '未登记', none: '不适用', stale: '待补进', nolegal: '无合法渠道', quarantined: '来源待核', offSale: '已停售' };

  const hc = healthCheck(state, todayISOStr, settings);
  const hcRows = hc.items.map((i) => `<tr><td>${e(i.label)}</td><td>${LEVEL[i.level] ?? i.level}</td><td>${e(i.detail)}</td></tr>`).join('');

  const pdRows = (state.products ?? []).map((p) => {
    const cs = channelState(p, state, todayISOStr, settings.channelWarnDays ?? DEFAULT_CHANNEL_WARN_DAYS);
    return `<tr class="${p.onSale ? '' : 'muted'}">
    <td>${e(p.name)}<br><span class="basis">${e(p.code)}</span></td>
    <td>${e(PRODUCT_KINDS[p.kind] ?? p.kind)}</td>
    <td>${p.onSale ? `在售 · 账面 ${p.stock}` : '已停售'}</td>
    <td>${LEVEL[cs.level] ?? cs.level}<br><span class="basis">${e(cs.detail).slice(0, 60)}</span></td>
  </tr>`;
  }).join('') || '<tr><td colspan="4">品规台账为空</td></tr>';

  const puRows = [...(state.purchases ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((b) => {
    const pd = (state.products ?? []).find((p) => p.id === b.productId);
    return `<tr class="${b.quarantined ? 'muted' : ''}">
    <td>${e(b.dateISO)}</td><td>${e(pd?.name ?? b.productId)}</td>
    <td>${e(PURCHASE_SOURCES[b.source] ?? b.source)}${b.orderNo ? `<br><span class="basis">单号 ${e(b.orderNo)}</span>` : ''}</td>
    <td>${b.qty}</td><td>${b.quarantined ? '<strong>红旗·待核</strong>' : '合法渠道'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="5">进货台账为空</td></tr>';

  const slRows = [...(state.sales ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 60).map((s) => `<tr>
    <td>${e(s.dateISO)}</td><td>${e(s.productName)}<br><span class="basis">${e(s.productCode)}</span></td>
    <td>${s.qty}</td><td>${e(s.minorCheck)}</td><td>四闸全过</td>
  </tr>`).join('') || '<tr><td colspan="5">销售台账为空</td></tr>';

  const dcRows = [...(state.daychecks ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 40).map((d) => {
    const bad = d.items.filter((i) => !i.ok);
    return `<tr>
    <td>${e(d.dateISO)}</td><td>${d.items.length} 项</td>
    <td>${bad.length ? `<strong>异常 ${bad.length}</strong>：${e(bad.map((i) => `${i.label.split('（')[0]}（${i.note}）`).join('；'))}` : '全项正常'}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="3">无检查记录</td></tr>';

  const evRows = [...(state.events ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((h) => `<tr>
    <td>${e(h.dateISO)}</td><td>${e(EVENT_SOURCES[h.source] ?? h.source)}</td><td class="w"><span>${e(h.desc)}</span></td>
    <td>${h.status === 'open' ? '<strong>未处置</strong>' : `${e(h.actionISO || '—')} ${e(h.action || '')}`}</td>
    <td>${h.status === 'closed' ? `${e(h.verifyISO)} ${e(h.verifiedBy)}` : h.status === 'fixed' ? '<strong>待复查</strong>' : '<strong>未闭环</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="5">无合规事件</td></tr>';

  const changeRows = [...(state.changes ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).map((c) => `<tr>
    <td>${e(c.dateISO)}</td><td>${e(CHANGE_KINDS[c.kind] ?? c.kind)}</td><td class="w"><span>${e(c.detail)}</span></td>
    <td>${c.status === 'filed' ? `${e(c.filedISO)} 已办结` : '<strong>未办结</strong>'}</td>
  </tr>`).join('') || '<tr><td colspan="4">暂无变更事项</td></tr>';

  const duRows = dutyBoard(state, todayISOStr).map((d) => `<tr>
    <td>${e(d.label)}</td><td>${d.lastDoneISO ? e(d.lastDoneISO) : '—'}</td>
    <td>${d.nextDue ? e(d.nextDue) : '—'}</td><td>${LEVEL[d.level] ?? d.level}</td><td>${e(d.basis)}</td>
  </tr>`).join('') || '<tr><td colspan="5">未登记周期义务</td></tr>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>烟柜合规迎检自证包 · ${e(v.name ?? '')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; margin: 24px; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 6px; padding-left: 12px; border-left: 6px solid #3370ff; letter-spacing: .02em; }
  .meta { font-size: 12.5px; color: #51565f; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 1px solid #e5e6eb; color: #245bdb; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 6px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e6eb; }
  th { color: #245bdb; font-weight: 600; background: #f0f4ff; border-bottom: 2px solid #c9dcff; }
  tr:nth-child(even) td { background: #fafbfd; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>烟草专卖零售合规迎检自证包 · ${e(v.name ?? '')}</h1>
<div class="meta">截至 ${e(todayISOStr)} · 店主：${e(v.owner || '—')} · ${e(v.address || '地址未填')}</div>
<h2>一、证照与许可证钟（《烟草专卖法》第 16 条；实施细则第 22/48 条）</h2>
<div class="meta">零售许可证编号：${e(v.licenseNo || '—')} · 发证机关：${e(v.issuer || '—')} · 有效期至：${e(v.licenseExpiryISO || '—')}（${e(licenseState(v, todayISOStr).detail)}） · 营业执照：${e(v.bizRegNo || '—')}</div>
<h2>二、账本体检（${hc.items.length} 项）</h2>
<div class="meta">体检得分 ${hc.score}（红 ${hc.bad} · 黄 ${hc.warn}）——缺口如实列出，未闭环项以现场整改为准</div>
<table><tr><th>项目</th><th>状态</th><th>说明</th></tr>${hcRows}</table>
<h2>三、品规台账（一物一档；电子烟烟草口味建档即核）</h2>
<table><tr><th>品规</th><th>品类</th><th>状态/账面</th><th>渠道状态</th></tr>${pdRows}</table>
<h2>四、进货台账（实施条例第 23 条第二款：应在当地烟草专卖批发企业进货；电子烟经全国统一交易平台）</h2>
<table><tr><th>日期</th><th>品规</th><th>来源/单号</th><th>数量</th><th>渠道</th></tr>${puRows}</table>
<h2>五、销售台账（四闸全过才落账；对口实施条例第 46 条检查职权「查阅、复制账册、单据、记录」）</h2>
<table><tr><th>日期</th><th>品规</th><th>数量</th><th>未成年人核验</th><th>闸机</th></tr>${slRows}</table>
<h2>六、每日开柜检查（未保法第 59 条张贴与核验义务；细则第 50/51 条现场义务的自查留痕）</h2>
<table><tr><th>日期</th><th>检查项</th><th>结果</th></tr>${dcRows}</table>
<h2>七、合规事件闭环（开柜检查/烟草专卖局检查/自查）</h2>
<table><tr><th>发现日</th><th>来源</th><th>描述</th><th>处置</th><th>复查销案</th></tr>${evRows}</table>
<h2>八、变更手续台账（实施细则第 21/56 条：载明事项变化及时申请变更）</h2>
<table><tr><th>发生日</th><th>情形</th><th>说明</th><th>办理</th></tr>${changeRows}</table>
<h2>九、周期义务账（库存月查/执照年报/许可自查/平台对账）</h2>
<table><tr><th>义务</th><th>最近完成</th><th>下次到期</th><th>状态</th><th>依据</th></tr>${duRows}</table>
<div class="sign">店主（签字/盖章）：____________　店员（签字）：____________　日期：____________</div>
<div class="foot">生成：烟柜账 CounterBook · ${e(todayISOStr)} · 本页为零售户自查与迎检备查材料，不替代烟草专卖零售许可证申请、延续、变更、停业、注销等法定程序；属地烟草专卖局要求永远赢</div>
</body>
</html>`;
}

/** 当日柜台核对单打印版（单文件 HTML）——贴在烟柜后：今天每一笔都过了四道闸 */
export function dayPassHtml(state, dateISO, todayISOStr = todayISO()) {
  assertISO(dateISO);
  const e = escapeHtml;
  const v = state.shop ?? {};
  const ts = todaySales(state, dateISO);
  const dc = (state.daychecks ?? []).find((d) => d.dateISO === dateISO);
  const sales = (state.sales ?? []).filter((s) => s.dateISO === dateISO);
  const lic = licenseState(v, dateISO);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>当日柜台核对单 · ${e(dateISO)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; margin: 24px; line-height: 1.6; }
  h1 { font-size: 20px; margin: 0 0 6px; padding-left: 12px; border-left: 6px solid #3370ff; letter-spacing: .02em; }
  .meta { font-size: 12.5px; color: #51565f; margin: 3px 0; }
  h2 { font-size: 14.5px; margin: 18px 0 7px; padding-bottom: 4px; border-bottom: 1px solid #e5e6eb; color: #245bdb; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 6px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e6eb; }
  th { color: #245bdb; font-weight: 600; background: #f0f4ff; border-bottom: 2px solid #c9dcff; }
  .sign { margin-top: 22px; font-size: 13px; }
  .foot { margin-top: 12px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<h1>当日柜台核对单（四闸核对）</h1>
<div class="meta">门店：${e(v.name || '—')} · 日期：${e(dateISO)} · 打印日：${e(todayISOStr)}</div>
<h2>一、证照核对（落账时点）</h2>
<table>
  <tr><th>零售许可证有效期</th><td>${e(v.licenseExpiryISO || '—')}（${e(lic.detail)}）</td></tr>
  <tr><th>今日开柜检查</th><td>${dc ? (dc.status === 'ok' ? '已落卡·全项正常' : `已落卡·含 ${dc.items.filter((i) => !i.ok).length} 项异常处置`) : '<strong>未落卡</strong>'}</td></tr>
  <tr><th>今日销售</th><td>${ts.count} 笔 / ${ts.units} 盒（条）</td></tr>
</table>
<h2>二、当日销售台账（每笔四闸：证在期 → 渠道合法 → 未成年人核验 → 电子烟专闸）</h2>
<table><tr><th>时间序</th><th>品规</th><th>数量</th><th>未成年人核验</th></tr>
${sales.map((s, i) => `<tr><td>${i + 1}</td><td>${e(s.productName)}（${e(s.productCode)}）</td><td>${s.qty}</td><td>${e(s.minorCheck)}</td></tr>`).join('') || '<tr><td colspan="4">今日暂无销售</td></tr>'}
</table>
<h2>三、现场义务自查（未保法第 59 条；细则第 50/51 条）</h2>
<div class="meta">「不向未成年人售烟」标志显著张贴：□ 是　□ 否　·　无自动售货机/自助售卖：□ 是　□ 否　·　无信息网络售烟：□ 是　□ 否</div>
<div class="sign">值班店员（签字）：____________　时间：____________</div>
<div class="foot">生成：烟柜账 CounterBook · ${e(todayISOStr)} · 本单为当日经营的自证底稿，不替代许可证与监督检查</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 家人店员备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'counterbook', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'counterbook') return { ok: false, error: '不是烟柜账的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.shop === 'object' && s.shop !== null &&
    arr(s.products) && arr(s.purchases) && arr(s.sales) && arr(s.daychecks) &&
    arr(s.events) && arr(s.changes) && arr(s.duties) &&
    typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
