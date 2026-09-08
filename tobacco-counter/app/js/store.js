/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。店铺证照、品规一物一档、进货台账、销售台账、开柜
 * 检查卡、合规事件闭环、变更台账、周期义务 100% 存于浏览器 localStorage；出证物走本地
 * 生成的单文件 HTML / 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。
 * emptyState 必须载入全量默认参数（仓库教训：双头定义会让冷启动 settings 为空对象，
 * 参数化键全 undefined → NaN 炸渲染）；loadState/importBundle 对 settings 做显式并集。
 */
import {
  STATE_VERSION, DEFAULT_RENEW_WARN_DAYS, DEFAULT_CHANNEL_WARN_DAYS, DEFAULT_DUTY_WARN_DAYS,
} from './core.js';

const KEY = 'counterbook.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    shop: {
      name: '', licenseNo: '', issuer: '', licenseExpiryISO: '',
      bizRegNo: '',           // 营业执照统一社会信用代码（跨线核对项）
      address: '', owner: '', phone: '',
      nearSchool: false,      // 是否位于中小学、幼儿园周边（布局红线自查，细则第 43 条(二)不予延续情形）
      suspensionFromISO: '', suspensionNote: '',
      note: '',
    },
    products: [],    // { id, name, kind, code, flavor, warnLabel, stock, onSale, quarantinedISO?, note }
    purchases: [],   // { id, dateISO, productId, source, orderNo, qty, amount, quarantined, note }
    sales: [],       // { id, dateISO, productId, productCode, productName, kind, qty, minorCheck, note, snapshot }
    daychecks: [],   // { id, dateISO, items: [{key,label,ok,note}], status, note }
    events: [],      // { id, dateISO, source, desc, action, actionISO, verifyISO, verifiedBy, status }
    changes: [],     // { id, dateISO, kind, detail, filedISO, status }
    duties: [],      // { id, kind, lastDoneISO, note }
    settings: {
      renewWarnDays: DEFAULT_RENEW_WARN_DAYS,      // 许可证临期提醒（默认 30=法定届满 30 日延续窗口）
      channelWarnDays: DEFAULT_CHANNEL_WARN_DAYS,  // 渠道在核回看窗提醒（默认 14 天，产品口径）
      dutyWarnDays: DEFAULT_DUTY_WARN_DAYS,        // 周期义务临期提醒（默认 15 天）
    },
    productSeq: 0,
    purchaseSeq: 0,
    saleSeq: 0,
    daycheckSeq: 0,
    eventSeq: 0,
    changeSeq: 0,
    traces: [],      // HDD 埋点（本地事件流，用于验证闭环，可导出；与业务台账字段严格分离）
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    // 与 emptyState 做字段并集，向前兼容新增字段；settings 深一层并集，防旧备份缺参数键
    const merged = { ...emptyState(), ...s };
    merged.settings = { ...emptyState().settings, ...(s.settings ?? {}) };
    return merged;
  } catch {
    return emptyState();
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

/** 本地埋点：HDD/OHELM 验证闭环的数据入口（随状态持久化，可在设置页导出） */
export function track(state, type, payload = {}) {
  if (!Array.isArray(state.traces)) state.traces = [];
  state.traces.push({ type, at: new Date().toISOString(), ...payload });
  if (state.traces.length > 1000) state.traces = state.traces.slice(-1000);
  return state;
}
