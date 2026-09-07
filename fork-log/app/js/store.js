/**
 * store.js — 本地优先存储层
 *
 * 供应链决策：不使用任何云端数据库。使用单位档案、车辆一车一档、司机名册、日管控巡检、
 * 周排查/月调度文书、隐患闭环、派工台账 100% 存于浏览器 localStorage；出证物走本地生成的
 * 单文件 HTML / 打印 / 文本；跨设备迁移走「导出 JSON → 导入」。
 * emptyState 必须载入全量默认参数（仓库教训：双头定义会让冷启动 settings 为空对象，
 * 参数化键全 undefined → NaN 炸渲染）；loadState/importBundle 对 settings 做显式并集。
 */
import { STATE_VERSION, DEFAULT_APPLY_ADVANCE_DAYS, DEFAULT_REEXAM_WARN_DAYS, DEFAULT_PATROL_GAP_DAYS } from './core.js';

const KEY = 'forklog.v1';

export function emptyState() {
  return {
    version: STATE_VERSION,
    station: {
      name: '', manager: '', phone: '', address: '',
      directorName: '', directorPhone: '',   // 场车安全总监（74 号令第 135 条）
      officerName: '', officerPhone: '',     // 场车安全员（可多名，这里登记牵头人）
      note: '',
    },
    vehicles: [],     // { id, plateNo, kind: forklift|sightseeing, brand, regNo, firstUseISO, lastInspectISO, inspectionDueISO, keeperName, monitor, ownerType, modifiedISO, changeRegISO, scrappedISO, cancelISO, note }
    drivers: [],      // { id, name, certNo, expiryISO, phone, active, note }
    patrols: [],      // { id, dateISO, vehicleId, plateNo, checkerName, result: ok|found, findings, action, note }
    weeklies: [],     // { id, dateISO, weekKey, hostName, content, issues }
    monthlies: [],    // { id, dateISO, monthKey, hostName, content }
    hazards: [],      // { id, dateISO, vehicleId, plateNo, source, severity, desc, action, actionISO, verifyISO, verifiedBy, status }
    workOrders: [],   // { id, dateISO, vehicleId, plateNo, driverId, driverName, task, shift, note, snapshot }
    duties: [],       // { id, kind, lastDoneISO, note }
    settings: {
      applyAdvanceDays: DEFAULT_APPLY_ADVANCE_DAYS,   // 定检临期提醒（默认 30=法定届满前 1 个月申报窗口）
      reexamWarnDays: DEFAULT_REEXAM_WARN_DAYS,       // 证照临期提醒（默认 60 天）
      patrolGapDays: DEFAULT_PATROL_GAP_DAYS,         // 日管控断卡红线（天）
    },
    vehicleSeq: 0,
    driverSeq: 0,
    patrolSeq: 0,
    weeklySeq: 0,
    monthlySeq: 0,
    hazardSeq: 0,
    workOrderSeq: 0,
    traces: [],       // HDD 埋点（本地事件流，用于验证闭环，可导出；与业务台账字段严格分离）
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
