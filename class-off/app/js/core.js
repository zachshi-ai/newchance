/**
 * core.js — 消课单 ClassOff 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；金额一律整数「分」运算，杜绝浮点误差；
 * 日期统一 ISO 字符串 yyyy-mm-dd；所有规则参数（预警线/临期窗/红线）可在设置中被机构覆盖。
 *
 * 合规口径（全文链接见 docs/14-调研来源.md）：
 * - 教育部等六部门《关于加强校外培训机构预收费监管工作的通知》（教监管函〔2021〕2号，
 *   2021-10 成文）第 20 条：不得一次性收取或以充值、次卡等形式变相收取时间跨度
 *   超过 3 个月或 60 课时的费用（本仓库已对照 gov.cn 原文核验）
 * - 《校外培训行政处罚暂行办法》（教育部令第 53 号，2023-10-15 施行）：收费与预收费
 *   管理违规的罚则见第 22 条；第 42 条明确违法所得中「依法已经予以退还的预收费
 *   未消课款项，可以扣除」——消课记录本身就是官方认可的事实界定线
 * - 全国校外教育培训监管与服务综合平台（「校外培训家长端」App）：公开报道口径为
 *   一课一消、家长确认后托管资金按课时拨付（本工具与平台互补，不替代报送）
 * - 退费试算采用行业通识口径：按已消正课课时折算、赠课不折现——最终以培训合同为准
 * 本工具是机构侧的课时账本与家长沟通凭证，不构成法律意见，不替代监管平台报送。
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

/** 'YYYY-MM' 月份键（工资/月报分组用） */
export function monthKey(iso) {
  assertISO(iso);
  return iso.slice(0, 7);
}

/** 金额：整数分 → 「¥129.00」 */
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
// 档案模板（内容供应链：课包类型、消耗顺序的行业通识先验）
// ---------------------------------------------------------------------------

/** 课包类型：paid 正课包（可退费折算）/ bonus 赠课包（不折现） */
export const PACKAGE_KINDS = {
  paid: { label: '正课' },
  bonus: { label: '赠课' },
};

/**
 * 预收费红线（教监管函〔2021〕2号第 20 条）：一次性收费不得超过 3 个月或 60 课时。
 * 以充值、次卡、赠课等形式变相突破同样在禁止之列（多地属地细则对加赠打包有更细口径）。
 * 工具只亮灯提示，不阻止录入——红线执行以属地监管与合同为准。
 */
export const MAX_COURSE_HOURS = 60;
/** 部分地区家长提示口径：单笔预收费不超过 5000 元（提示线而非全国统一红线，属地口径为准） */
export const SOFT_AMOUNT_CAP_CENTS = 500000;
/** 余额预警默认线：剩余课时 ≤ 此值提醒续费（机构可在设置覆盖） */
export const DEFAULT_LOW_BALANCE = 3;
/** 临期默认窗：到期日前 N 天内提醒消课或办延期 */
export const DEFAULT_EXPIRY_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// 学员课时账（balance 派生，不落库；packages.used 是唯一事实）
// ---------------------------------------------------------------------------

function packagesOf(packages, studentId, courseId = null) {
  return (packages ?? [])
    .filter((p) => p.studentId === studentId && (courseId === null || p.courseId === courseId));
}

/** 某学员（可限科目）的课时账：总数/已消/剩余，正课与赠课分列 */
export function balanceOf(packages, studentId, courseId = null) {
  const mine = packagesOf(packages, studentId, courseId);
  const sum = (kind) => mine.filter((p) => p.kind === kind)
    .reduce((acc, p) => ({ total: acc.total + p.total, used: acc.used + p.used }), { total: 0, used: 0 });
  const paid = sum('paid');
  const bonus = sum('bonus');
  return {
    total: paid.total + bonus.total,
    used: paid.used + bonus.used,
    remaining: paid.total - paid.used + (bonus.total - bonus.used),
    paidTotal: paid.total,
    paidUsed: paid.used,
    paidRemaining: paid.total - paid.used,
    bonusRemaining: bonus.total - bonus.used,
  };
}

/**
 * 消课包消耗顺序：正课先于赠课（行业通识：赠课是"用完正课后的福利"，也保证退费折算
 * 对家长公平可解释）；同优先级内临期先消、再按购课日先买先消。
 * 返回排序后的可消课包数组（过滤掉已耗尽与已过期）。
 */
export function consumablePackages(packages, studentId, courseId, todayISOStr) {
  assertISO(todayISOStr);
  return packagesOf(packages, studentId, courseId)
    .filter((p) => p.used < p.total)
    .filter((p) => p.expireISO === null || p.expireISO >= todayISOStr) // 到期日当天仍可用，次日作废
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'paid' ? -1 : 1;
      const ea = a.expireISO ?? '9999-12-31';
      const eb = b.expireISO ?? '9999-12-31';
      if (ea !== eb) return ea.localeCompare(eb);
      return a.boughtISO.localeCompare(b.boughtISO);
    });
}

// ---------------------------------------------------------------------------
// 消课（一课一消：session 落账 → 课包 used 前进；撤销 → 精确回滚）
// ---------------------------------------------------------------------------

function requireRef(repos, id, label) {
  const hit = (repos ?? []).find((x) => x.id === id);
  if (!hit) throw new Error(`${label}不存在: ${id}`);
  return hit;
}

/**
 * 新建消课记录并落账。session: { id, dateISO, courseId, teacherId, studentIds, note }
 * - 每位学员在本科目按 consumablePackages 顺序消耗 1 课时，分配结果写入 allocations
 * - 任何一位学员无课可消（余额不足/全部过期）→ 整体抛错，绝不部分入账
 * - 同学员同科目同日重复点名 → 拒绝（防止手工补录与点名重复消课）
 */
export function applySession(state, { id, dateISO, courseId, teacherId, studentIds, note = '' }) {
  assertISO(dateISO);
  requireRef(state.courses, courseId, '课程');
  requireRef(state.teachers, teacherId, '教师');
  const ids = [...new Set(studentIds)];
  if (ids.length === 0) throw new Error('至少点名一位学员');
  for (const sid of ids) requireRef(state.students, sid, '学员');
  const taken = new Set(
    (state.sessions ?? [])
      .filter((s) => s.dateISO === dateISO && s.courseId === courseId)
      .flatMap((s) => s.allocations.map((a) => a.studentId)),
  );
  for (const sid of ids) {
    if (taken.has(sid)) throw new Error(`学员在 ${dateISO} 该科目已有消课记录，请检查是否重复点名`);
  }
  const allocations = ids.map((sid) => {
    const queue = consumablePackages(state.packages, sid, courseId, dateISO);
    if (queue.length === 0) {
      const bal = balanceOf(state.packages, sid, courseId);
      throw new Error(`学员「${state.students.find((s) => s.id === sid)?.name ?? sid}」${courseId} 科目无课可消（剩余 ${bal.remaining}）——先续费或核实`);
    }
    return { studentId: sid, packageId: queue[0].id };
  });
  // 校验全部通过后才统一落账：任何一位学员无课可消都绝不部分入账
  const byId = new Map(state.packages.map((p) => [p.id, p]));
  for (const a of allocations) byId.get(a.packageId).used += 1;
  const session = { id, dateISO, courseId, teacherId, allocations, note };
  state.sessions.push(session);
  return session;
}

/** 撤销消课：按 allocations 精确回滚 used，再移除记录。账实必须回到消课前状态 */
export function removeSession(state, sessionId) {
  const idx = state.sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) throw new Error(`消课记录不存在: ${sessionId}`);
  const session = state.sessions[idx];
  const byId = new Map(state.packages.map((p) => [p.id, p]));
  for (const a of session.allocations) {
    const pkg = byId.get(a.packageId);
    if (!pkg) throw new Error(`课包不存在: ${a.packageId}——账本被破坏，拒绝回滚`);
    if (pkg.used <= 0) throw new Error(`课包 ${pkg.id} 已消数异常，拒绝回滚`);
    pkg.used -= 1;
  }
  state.sessions.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// 看板预警（余额 / 临期 / 过期未消 / 教师月课时）
// ---------------------------------------------------------------------------

/** 学员科目余额预警：剩余 ≤ lowBalance 且 >0（还没到催退费的程度，是续费触点） */
export function lowBalanceWarnings(packages, students, todayISOStr, lowBalance = DEFAULT_LOW_BALANCE) {
  assertISO(todayISOStr);
  const out = [];
  for (const st of students ?? []) {
    const courseIds = [...new Set(packagesOf(packages, st.id).map((p) => p.courseId))];
    for (const cid of courseIds) {
      const bal = balanceOf(packages, st.id, cid);
      if (bal.remaining > 0 && bal.remaining <= lowBalance) {
        out.push({ studentId: st.id, studentName: st.name, courseId: cid, remaining: bal.remaining });
      }
    }
  }
  return out.sort((a, b) => a.remaining - b.remaining);
}

/** 临期课包：N 天内到期且还有剩余（提醒消课或办延期，避免「过期即纠纷」） */
export function expiringPackages(packages, students, courses, todayISOStr, windowDays = DEFAULT_EXPIRY_WINDOW_DAYS) {
  assertISO(todayISOStr);
  const out = [];
  for (const p of packages ?? []) {
    if (p.expireISO === null || p.used >= p.total) continue;
    const days = daysUntil(p.expireISO, todayISOStr);
    if (days >= 0 && days <= windowDays) {
      out.push({
        packageId: p.id,
        studentName: students?.find((s) => s.id === p.studentId)?.name ?? '?',
        courseName: courses?.find((c) => c.id === p.courseId)?.name ?? '?',
        expireISO: p.expireISO,
        daysLeft: days,
        remaining: p.total - p.used,
      });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 过期未消：已经作废但账上还有剩余——退费纠纷的高发源，必须摊在桌面上 */
export function expiredOutstanding(packages, students, courses, todayISOStr) {
  assertISO(todayISOStr);
  const out = [];
  for (const p of packages ?? []) {
    if (p.expireISO === null || p.used >= p.total) continue;
    if (p.expireISO < todayISOStr) {
      out.push({
        packageId: p.id,
        studentName: students?.find((s) => s.id === p.studentId)?.name ?? '?',
        courseName: courses?.find((c) => c.id === p.courseId)?.name ?? '?',
        expireISO: p.expireISO,
        remaining: p.total - p.used,
      });
    }
  }
  return out.sort((a, b) => a.expireISO.localeCompare(b.expireISO));
}

/**
 * 教师月课时工资：按 monthKey('YYYY-MM') 分组消课记录 × 课时费。
 * 集体课按节计（一节课一份数），不按人头——这是行业通识口径，设置页可改每节单价。
 */
export function teacherPayroll(sessions, teachers, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`非法月份: ${month}`);
  const rows = (teachers ?? []).map((t) => {
    const list = (sessions ?? []).filter((s) => s.teacherId === t.id && monthKey(s.dateISO) === month);
    return {
      teacherId: t.id,
      teacherName: t.name,
      classes: list.length,
      feeCents: t.feeCents,
      payCents: list.length * t.feeCents,
    };
  });
  return rows.filter((r) => r.classes > 0).sort((a, b) => b.classes - a.classes);
}

// ---------------------------------------------------------------------------
// 合规体检（60 课时红线；加赠打包变相超限同样点名）
// ---------------------------------------------------------------------------

/**
 * 课包合规体检：
 * - 单个正课包 > 60 课时 → 红线提示
 * - 同学员同科目的「在途未消完课时 + 新包」打包超 60 → 变相超限提示（充值/次卡/加赠均属变相收取）
 * 返回 warnings 数组（空数组 = 未触发红线）；工具只提示不阻止。
 */
export function complianceCheck(packages, newPackage) {
  const warnings = [];
  if (newPackage.kind === 'paid' && newPackage.total > MAX_COURSE_HOURS) {
    warnings.push(`单个课包 ${newPackage.total} 课时超过「3 个月或 60 课时」预收费红线（教育部等六部门 2021 通知）`);
  }
  if (newPackage.kind === 'paid') {
    const outstanding = packagesOf(packages, newPackage.studentId, newPackage.courseId)
      .filter((p) => p.used < p.total)
      .reduce((sum, p) => sum + (p.total - p.used), 0);
    // 在途为 0 时单包红线已覆盖，不重复告警；叠加在途才是"变相打包"
    if (outstanding > 0 && outstanding + newPackage.total > MAX_COURSE_HOURS) {
      warnings.push(`该学员此科目在途 ${outstanding} 课时 + 新包 ${newPackage.total} 课时 = ${outstanding + newPackage.total}，打包超过 60 课时——以充值/加赠变相超限同样在禁止之列`);
    }
  }
  if (newPackage.kind === 'paid' && newPackage.priceCents > SOFT_AMOUNT_CAP_CENTS) {
    warnings.push(`单笔 ${fmtYuan(newPackage.priceCents)} 超过部分地区家长提示线 5000 元（提示线而非全国统一红线，以属地口径为准）`);
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// 退费试算（行业通识口径：按已消正课折算，赠课不折现；合同永远赢）
// ---------------------------------------------------------------------------

/**
 * 退费试算：应退 = Σ正课包（实付 − 已消 × 单节折算价），赠课包不进账。
 * 单节折算价 = 包实付 ÷ 包总课时（整数分四舍五入），逐包结算不上浮。
 * 过期未消的课时不推定为可退也不推定为不可退——单列出来，按合同处理。
 */
export function refundEstimate(packages, studentId, students, courses) {
  requireRef(students, studentId, '学员');
  const mine = packagesOf(packages, studentId);
  if (mine.length === 0) throw new Error('该学员没有任何课包，无从试算');
  const today = todayISO();
  let paidTotal = 0;
  let consumedValue = 0;
  const lines = [];
  let expiredRemaining = 0;
  for (const p of mine) {
    const courseName = courses?.find((c) => c.id === p.courseId)?.name ?? '?';
    if (p.kind === 'bonus') {
      lines.push({ label: `${courseName}·赠课 ${p.total} 节`, detail: '赠课不折现，不进退费账', cents: 0 });
      if (p.expireISO !== null && p.expireISO < today && p.used < p.total) {
        expiredRemaining += p.total - p.used;
      }
      continue;
    }
    const unit = p.total > 0 ? Math.round(p.priceCents / p.total) : 0;
    const usedVal = p.used * unit;
    const rest = Math.max(0, p.priceCents - usedVal);
    paidTotal += p.priceCents;
    consumedValue += usedVal;
    lines.push({
      label: `${courseName}·正课 ${p.total} 节（${fmtYuan(p.priceCents)}）`,
      detail: `已消 ${p.used} × ${fmtYuan(unit)} = ${fmtYuan(usedVal)}，余 ${fmtYuan(rest)}`,
      cents: rest,
    });
    if (p.expireISO !== null && p.expireISO < today && p.used < p.total) {
      expiredRemaining += p.total - p.used;
    }
  }
  const refundCents = Math.max(0, paidTotal - consumedValue);
  return {
    paidTotal,
    consumedValue,
    refundCents,
    lines,
    expiredRemaining,
  };
}

/** 退费试算文本（确定性，供复制到微信/合同附件） */
export function refundText({ studentName, estimate, orgName = '', todayISOStr = todayISO() }) {
  const L = [];
  L.push(`【退费试算单】${studentName}`);
  if (orgName) L.push(`机构：${orgName}`);
  L.push(`试算日：${todayISOStr}（口径：按已消正课折算、赠课不折现，最终以培训合同为准）`);
  L.push('');
  L.push('一、课包明细');
  estimate.lines.forEach((ln) => L.push(`  - ${ln.label}：${ln.detail}`));
  L.push('');
  L.push(`二、合计：实收 ${fmtYuan(estimate.paidTotal)}，已消折算 ${fmtYuan(estimate.consumedValue)}`);
  L.push(`三、试算应退：${fmtYuan(estimate.refundCents)}`);
  if (estimate.expiredRemaining > 0) {
    L.push(`注：有 ${estimate.expiredRemaining} 节已过期未消课时，按合同条款处理，未计入应退。`);
  }
  L.push('');
  L.push('本单为机构内部试算凭据，退费金额以双方确认的合同与结算单为准。');
  L.push(`生成：消课单 · ${todayISOStr}`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 家长对账单（信任的交付物：购课、消课、余额，三通道送达）
// ---------------------------------------------------------------------------

/** 学员的消课流水（时间倒序）：date / 课程 / 教师 */
export function studentLedger(state, studentId) {
  requireRef(state.students, studentId, '学员');
  const teacherById = new Map(state.teachers.map((t) => [t.id, t.name]));
  const courseById = new Map(state.courses.map((c) => [c.id, c.name]));
  const rows = [];
  for (const s of state.sessions ?? []) {
    for (const a of s.allocations) {
      if (a.studentId !== studentId) continue;
      rows.push({
        dateISO: s.dateISO,
        courseName: courseById.get(s.courseId) ?? '?',
        teacherName: teacherById.get(s.teacherId) ?? '?',
        packageId: a.packageId,
      });
    }
  }
  return rows.sort((a, b) => b.dateISO.localeCompare(a.dateISO));
}

/** 家长对账单文本：微信粘贴给家长（主通道）。同输入同输出 */
export function statementText({ state, studentId, todayISOStr = todayISO() }) {
  const st = requireRef(state.students, studentId, '学员');
  const courseById = new Map(state.courses.map((c) => [c.id, c.name]));
  const L = [];
  L.push(`【课时对账单】${st.name}`);
  if (state.org?.name) L.push(`机构：${state.org.name}${state.org.phone ? `（${state.org.phone}）` : ''}`);
  L.push(`截至 ${todayISOStr}`);
  L.push('');
  const byCourse = new Map();
  for (const c of state.courses) {
    const bal = balanceOf(state.packages, studentId, c.id);
    if (bal.total > 0) byCourse.set(c.id, bal);
  }
  if (byCourse.size === 0) {
    L.push('（暂无课包记录）');
    return L.join('\n');
  }
  L.push('一、课时余额');
  for (const [cid, bal] of byCourse) {
    const pkgs = packagesOf(state.packages, studentId, cid);
    const expires = pkgs.filter((p) => p.expireISO).map((p) => p.expireISO).sort();
    L.push(`  - ${courseById.get(cid) ?? '?'}：剩 ${bal.remaining}/${bal.total} 节（已消 ${bal.used}）${expires.length ? `，最早到期 ${expires[0]}` : ''}`);
  }
  const ledger = studentLedger(state, studentId);
  L.push('');
  L.push(`二、消课明细（共 ${ledger.length} 节，最近在前）`);
  for (const r of ledger.slice(0, 30)) {
    L.push(`  - ${r.dateISO} ${r.courseName}（${r.teacherName}）`);
  }
  if (ledger.length > 30) L.push(`  ……更早 ${ledger.length - 30} 节见打印版`);
  L.push('');
  L.push('如有疑问请随时联系机构核对；剩余课时不足时将提醒您续费。');
  L.push(`生成：消课单 · ${todayISOStr}`);
  return L.join('\n');
}

/** 家长对账单打印版：单文件 HTML（内联样式、签字栏，无外部资源） */
export function statementHtml({ state, studentId, todayISOStr = todayISO() }) {
  const e = escapeHtml;
  const st = requireRef(state.students, studentId, '学员');
  const courseById = new Map(state.courses.map((c) => [c.id, c.name]));
  const balances = state.courses
    .map((c) => ({ course: c, bal: balanceOf(state.packages, studentId, c.id) }))
    .filter((x) => x.bal.total > 0);
  const ledger = studentLedger(state, studentId);
  const pkgRows = state.packages
    .filter((p) => p.studentId === studentId)
    .map((p) => `<tr>
      <td>${e(courseById.get(p.courseId) ?? '?')}</td>
      <td>${e(PACKAGE_KINDS[p.kind].label)}</td>
      <td>${e(p.boughtISO)}</td>
      <td>${p.total} 节</td>
      <td>${p.used} 节</td>
      <td>${p.kind === 'paid' ? e(fmtYuan(p.priceCents)) : '—'}</td>
      <td>${p.expireISO ? e(p.expireISO) : '不限'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>课时对账单 · ${e(st.name)}</title>
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
<h1>课时对账单 · ${e(st.name)}</h1>
<div class="meta">机构：${e(state.org?.name ?? '')}${state.org?.phone ? `（${e(state.org.phone)}）` : ''} · 截至 ${e(todayISOStr)}</div>
<h2>一、购课记录</h2>
<table><tr><th>科目</th><th>类型</th><th>购课日</th><th>总课时</th><th>已消</th><th>实付</th><th>到期日</th></tr>${pkgRows}</table>
<h2>二、课时余额</h2>
${balances.map((x) => `<div class="meta">${e(x.course.name)}：剩 <strong>${x.bal.remaining}</strong> / ${x.bal.total} 节（已消 ${x.bal.used} 节）</div>`).join('')}
<h2>三、消课明细（共 ${ledger.length} 节）</h2>
<table><tr><th>日期</th><th>科目</th><th>教师</th></tr>
${ledger.map((r) => `<tr><td>${e(r.dateISO)}</td><td>${e(r.courseName)}</td><td>${e(r.teacherName)}</td></tr>`).join('')}
</table>
<div class="sign">家长（签字确认）：____________　机构（盖章/签字）：____________　日期：____________</div>
<div class="foot">生成：消课单 ClassOff · ${e(todayISOStr)} · 本单为双方课时对账凭据，退费以培训合同为准</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 数据导入导出（换机迁移 / 合伙人备份）
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'classoff', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'classoff') return { ok: false, error: '不是消课单的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const arr = (v) => Array.isArray(v);
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.org === 'object' && s.org !== null &&
    arr(s.teachers) && arr(s.courses) && arr(s.students) &&
    arr(s.packages) && arr(s.sessions) && typeof s.settings === 'object' && s.settings !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}
