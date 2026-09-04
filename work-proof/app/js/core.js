/**
 * core.js — 工据 WorkProof 纯逻辑层
 *
 * 全部函数为纯函数（无 DOM、无存储依赖），可同时运行在浏览器与 Node 测试环境。
 * 设计约束（供应链原则的落地）：零外部依赖；金额一律整数「分」运算，杜绝浮点误差；
 * 期限计算用「日历月」（月末收敛），与《劳动合同法》"以上/不满"口径对齐。
 *
 * 主要法规依据（全文链接见 docs/14-调研来源.md）：
 * - 《劳动合同法》第 10/14/19/20/21/38/40/46/47/50/82/83/87 条
 * - 《劳动合同法实施条例》第 6/7/24 条
 * - 《最高人民法院关于审理劳动争议案件适用法律问题的解释（二）》（法释〔2025〕12 号，
 *   2025-09-01 施行）第 6/7/9/11/19 条
 * 通用合规提示，不构成法律意见；各地裁审口径存在差异。
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
 * 日历月加法：2026-01-31 加 1 个月收敛为 2026-02-28（月末不足顺延截断）。
 * 法律期限以「日历月」表述（如"用工之日起一个月内"），不能用 30 天近似。
 */
export function addMonths(iso, n) {
  assertISO(iso);
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const y2 = Math.floor(total / 12);
  const m2 = (total % 12 + 12) % 12 + 1;
  const last = new Date(Date.UTC(y2, m2, 0)).getUTCDate();
  const d2 = Math.min(d, last);
  return `${String(y2).padStart(4, '0')}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`;
}

/** 距目标日还有几天（负数=已过期） */
export function daysUntil(targetISO, todayISOStr = todayISO()) {
  assertISO(targetISO);
  assertISO(todayISOStr);
  const ms = new Date(`${targetISO}T00:00:00Z`) - new Date(`${todayISOStr}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/**
 * 两个日期间的整日历月数（end 未含当日）。
 * monthsBetween('2026-01-01','2027-01-01') = 12。
 * 合同期限按「含头含尾」口径计算时，请先对 end 加 1 天（见 contractMonths）。
 */
export function monthsBetween(startISO, endISO) {
  assertISO(startISO);
  assertISO(endISO);
  const [y1, m1, d1] = startISO.split('-').map(Number);
  const [y2, m2, d2] = endISO.split('-').map(Number);
  let m = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) m -= 1;
  return m;
}

/** 含头含尾期限的整月数（2026-01-01 至 2026-12-31 = 12 个月） */
export function contractMonths(startISO, endISO) {
  assertISO(startISO);
  assertISO(endISO);
  return monthsBetween(startISO, addDays(endISO, 1));
}

/** 工作年限标签：「2 年 3 个月」（含头含尾口径） */
export function workYearsLabel(startISO, endISO) {
  const m = Math.max(contractMonths(startISO, endISO), 0);
  return `${Math.floor(m / 12)} 年 ${m % 12} 个月`;
}

// ---------------------------------------------------------------------------
// 金额工具（整数「分」运算，杜绝 0.1+0.2 浮点误差）
// ---------------------------------------------------------------------------

/** 解析金额为分。接受 "8000" / "8,000.5" / 8000.55；拒绝负数与非数字 */
export function parseMoneyToCents(input) {
  const s = String(input ?? '').trim().replace(/[,\s￥¥元]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`非法金额: ${JSON.stringify(input)}`);
  }
  const [yuan, fen = ''] = s.split('.');
  return Number(yuan) * 100 + Number((fen + '00').slice(0, 2));
}

/** 分 → 千分位金额字符串（确定性：同输入同输出） */
export function fmtCents(cents) {
  if (!Number.isInteger(cents)) throw new Error(`非法金额(分): ${cents}`);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const yuan = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fen = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${yuan}.${fen}`;
}

// ---------------------------------------------------------------------------
// 试用期红线（劳动合同法第 19/20/83 条）
// ---------------------------------------------------------------------------

export const CONTRACT_TYPES = {
  fixed: { label: '固定期限' },
  open: { label: '无固定期限' },
  task: { label: '以完成一定工作任务为期限' },
};

/**
 * 法定试用期上限（月）。0 = 不得约定试用期。
 * 第 19 条：期限<3 个月或以完成任务为期限 → 不得约定；
 * 3 个月 ≤ 期限 < 1 年 → ≤1 个月；1 年 ≤ 期限 < 3 年 → ≤2 个月；
 * 3 年以上固定期限与无固定期限 → ≤6 个月。
 */
export function probationCapMonths({ contractType, termMonths = null }) {
  if (contractType === 'open') return 6;
  if (contractType === 'task') return 0;
  if (contractType === 'fixed') {
    if (termMonths == null) throw new Error('固定期限合同缺少期限月数');
    if (termMonths < 3) return 0;
    if (termMonths < 12) return 1;
    if (termMonths < 36) return 2;
    return 6;
  }
  throw new Error(`未知合同类型: ${contractType}`);
}

/**
 * 试用期违法事实核查。返回发现的问题数组（可能为空）。
 * - 不得约定却约定（19 条：试用期不成立，该期限视为合同期限）
 * - 超过法定上限且已履行（83 条：按转正月薪 × 超出期间支付赔偿金）
 * - 试用期晚于合同期结束（19 条：试用期包含在合同期限内）
 * - 同一劳动者第二次约定试用期（19 条）
 * - 试用期工资低于转正 80%（20 条；两者都填了才核查）
 */
export function probationFindings(emp, todayISOStr = todayISO()) {
  const out = [];
  if (!emp?.probationEnd) return out;
  assertISO(emp.probationEnd);
  const type = emp.contractType || 'fixed';
  const termMonths = type === 'fixed' && emp.contractStart && emp.contractEnd
    ? contractMonths(emp.contractStart, emp.contractEnd)
    : null;
  // 期限信息不全（cap 为 null）只跳过上限类判断，不误报也不吞掉与期限无关的核查
  let cap = null;
  try {
    cap = probationCapMonths({ contractType: type, termMonths });
  } catch {
    cap = null;
  }
  if (cap === 0) {
    out.push({
      id: 'probation-forbidden', level: 'high',
      title: '不得约定试用期却约定了试用期',
      why: `${CONTRACT_TYPES[type].label}合同${type === 'fixed' ? `（${termMonths} 个月）` : ''}依法不得约定试用期；已约定的试用期不成立，该期间视为合同期限，可能被认定违法约定。`,
      action: '立即取消试用期约定并按转正口径计薪，重新核对这段期间的成本与风险。',
      basis: ['《劳动合同法》第十九条'],
    });
  } else if (cap != null && emp.contractStart && termMonths != null) {
    const probMonths = monthsBetween(emp.contractStart, addDays(emp.probationEnd, 1));
    if (probMonths > cap) {
      const excessFrom = addMonths(emp.contractStart, cap);
      const exceeded = daysUntil(excessFrom, todayISOStr) < 0;
      out.push({
        id: 'probation-exceed', level: 'high',
        title: `试用期 ${probMonths} 个月超过法定上限 ${cap} 个月`,
        why: `合同期限 ${termMonths} 个月，法定试用期上限 ${cap} 个月${exceeded ? `；超出部分（自 ${excessFrom} 起）已实际履行` : ''}。已履行的超出期间，须按转正月薪标准支付赔偿金。`,
        action: exceeded
          ? `立即将试用期调整为法定上限内，评估 ${excessFrom} 以来的赔偿金敞口（转正月薪 × 超出月数）。`
          : '立即将试用期调整到法定上限内，赶在履行前纠正。',
        basis: ['《劳动合同法》第十九条、第八十三条'],
      });
    }
  }
  if (emp.contractEnd && emp.probationEnd > emp.contractEnd) {
    out.push({
      id: 'probation-after-term', level: 'high',
      title: '试用期晚于合同期结束',
      why: `试用期（至 ${emp.probationEnd}）晚于合同期限（至 ${emp.contractEnd}）。试用期包含在劳动合同期限内，此约定自相矛盾。`,
      action: '修正试用期日期，使其落在合同期限内且不超过法定上限。',
      basis: ['《劳动合同法》第十九条'],
    });
  }
  if (emp.hadProbationBefore) {
    out.push({
      id: 'probation-repeat', level: 'high',
      title: '对该员工第二次约定试用期',
      why: '同一用人单位与同一劳动者只能约定一次试用期；续订或再次入职再约定属违法约定。',
      action: '取消本次试用期约定；已在履行的按违法约定试用期自查赔偿敞口。',
      basis: ['《劳动合同法》第十九条'],
    });
  }
  if (emp.probationSalaryCents != null && emp.regularSalaryCents != null) {
    if (emp.probationSalaryCents * 5 < emp.regularSalaryCents * 4) {
      out.push({
        id: 'probation-salary', level: 'medium',
        title: '试用期工资低于转正工资的 80%',
        why: `试用期 ${fmtCents(emp.probationSalaryCents)} 元/月 < 转正 ${fmtCents(emp.regularSalaryCents)} 元/月 × 80%，且不得低于当地最低工资标准。`,
        action: '补足差额；同步核对不低于当地最低工资标准。',
        basis: ['《劳动合同法》第二十条'],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 书面合同红线（劳动合同法第 10/82 条、实施条例第 6/7 条、解释二第 6/7/9/11 条）
// ---------------------------------------------------------------------------

/** 用工之日起一个月内的签约宽限截止日（日历月口径） */
export function signDeadline(hireISO) {
  return addMonths(hireISO, 1);
}

/** 二倍工资起算日：满一个月的次日（解释二第六条：按月计算） */
export function doublePayFrom(hireISO) {
  return addDays(signDeadline(hireISO), 1);
}

/** 用工满一年线：视为已订立无固定期限劳动合同（第 14 条第三款） */
export function oneYearLine(hireISO) {
  return addMonths(hireISO, 12);
}

/**
 * 书面合同风险核查（在职员工）。
 * - 未签但仍在签约窗口内 → medium 倒计时
 * - 超窗未签 → high：二倍工资已计时（上限 11 个月，至满一年线）
 * - 满一年仍未签 → high：视为无固定期限，应补订书面合同（二倍工资不再累计，解释二第九条）
 * - 到期未续仍用工 → high：续签同样有一个月宽限（解释二第十一条：未表示异议超一个月，
 *   劳动者可要求以原条件续订）
 */
export function contractFindings(emp, todayISOStr = todayISO()) {
  const out = [];
  if (emp.status === 'left') return out;
  const hired = emp.hire;
  if (!hired) return out;
  assertISO(hired);

  const signed = emp.contractSigned;
  const yearLine = oneYearLine(hired);

  if (!signed) {
    if (todayISOStr <= signDeadline(hired)) {
      out.push({
        id: 'no-contract-window', level: 'medium',
        title: `签约窗口倒计时：${daysUntil(signDeadline(hired), todayISOStr)} 天内必须签书面合同`,
        why: `自用工之日（${hired}）起一个月内须订立书面劳动合同（截止 ${signDeadline(hired)}）`,
        action: '在截止日前完成签署；超期一日即产生二倍工资风险。',
        basis: ['《劳动合同法》第十条'],
      });
    } else {
      const expired = todayISOStr >= yearLine;
      // 满 1 年后按司法实践通称「最多 11 个月」封顶展示；未满 1 年按整月计时
      const months = expired ? 11 : Math.max(monthsBetween(doublePayFrom(hired), todayISOStr), 0);
      const title = expired
        ? '未签书面合同：二倍工资已到 11 个月封顶'
        : months >= 1
          ? `未签书面合同：二倍工资已计时约 ${months} 个月`
          : '未签书面合同：二倍工资已开始计时';
      out.push({
        id: 'no-contract-double', level: 'high',
        title,
        why: `自 ${doublePayFrom(hired)} 起算（按月计算，上限 11 个月），劳动者可主张二倍工资差额。`,
        action: expired
          ? '已满一年：视为已订立无固定期限劳动合同，二倍工资停止累计，但应立即补订书面合同。'
          : '今天补签仍在止损：每拖一个月多一个月工资的二倍差额。',
        basis: ['《劳动合同法》第八十二条、第十四条', '司法解释（二）第六条、第九条'],
      });
      if (todayISOStr >= yearLine) {
        out.push({
          id: 'no-contract-1y', level: 'high',
          title: '用工满一年未签：视为无固定期限劳动合同',
          why: '满一年未订书面合同，法律直接视为已订立无固定期限合同；继续拖延不改变身份，只累积其他风险。',
          action: '立即补订书面无固定期限劳动合同；梳理该员工的历史考勤与工资记录备查。',
          basis: ['《劳动合同法》第十四条第三款', '司法解释（二）第九条'],
        });
      }
    }
  }

  // 到期未续（有合同结束日、已过期、仍在职）
  if (emp.contractEnd) {
    assertISO(emp.contractEnd);
    if (emp.contractEnd < todayISOStr) {
      const dl = signDeadline(emp.contractEnd);
      const from = doublePayFrom(emp.contractEnd);
      if (todayISOStr > dl) {
        const months = Math.max(monthsBetween(from, addDays(todayISOStr, 1)), 0);
        out.push({
          id: 'renew-double', level: 'high',
          title: `合同到期未续仍用工：二倍工资已计时约 ${months} 个月`,
          why: `合同 ${emp.contractEnd} 到期后继续用工，满一个月（${dl}）未续订书面合同，自 ${from} 起适用二倍工资；且劳动者可要求以原条件续订。`,
          action: '立即补签书面合同（新签或续订）；若不打算留用，尽快依法协商终止并留痕。',
          basis: ['《劳动合同法》第十条、第八十二条', '司法解释（二）第十一条'],
        });
      } else {
        out.push({
          id: 'renew-window', level: 'medium',
          title: `合同已到期：续签窗口剩 ${daysUntil(dl, todayISOStr)} 天`,
          why: `合同 ${emp.contractEnd} 到期后继续用工的，一个月内（截止 ${dl}）须续订书面合同。`,
          action: '窗口期内完成续签，或依法办理终止手续。',
          basis: ['《劳动合同法》第十条', '司法解释（二）第十一条'],
        });
      }
    } else if (daysUntil(emp.contractEnd, todayISOStr) <= 30) {
      out.push({
        id: 'contract-expiring', level: 'medium',
        title: `合同 ${daysUntil(emp.contractEnd, todayISOStr)} 天后到期`,
        why: `合同将于 ${emp.contractEnd} 到期。到期前决定续签或终止，到期后继续用工即重新进入签约计时。`,
        action: '提前 30 天做续签/终止决定：终止须依法支付经济补偿并出具证明。',
        basis: ['《劳动合同法》第四十四条、第四十六条'],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 社保与离职善后
// ---------------------------------------------------------------------------

/** 社保核查：解释二第十九条（2025-09-01 施行）——弃保协议无效 + 劳动者可解除并索经济补偿 */
export function socialFindings(emp) {
  if (emp.status === 'left' || emp.socialInsured !== false) return [];
  return [{
    id: 'social-uninsured', level: 'high',
    title: '未依法缴纳社会保险费（「自愿弃保」承诺无效）',
    why: '2025-09-01 起施行的司法解释（二）第十九条：约定或承诺不缴社保一律无效；员工可据《劳动合同法》第三十八条解除合同并主张经济补偿，还可主张补缴与损失赔偿。以「社保补贴」代替缴费同样挡不住解除+补偿。',
    action: '立即办理参保登记并补缴；停止以现金补贴替代参保的做法；已支付的「社保补偿」在补缴后可依法主张返还但先留好凭证。',
    basis: ['司法解释（二）第十九条（法释〔2025〕12 号）', '《劳动合同法》第三十八条第一款第三项、第四十六条', '《社会保险法》第八十六条（滞纳金）'],
  }];
}

/** 离职善后核查：解除/终止时必须出具证明 */
export function offboardingFindings(emp) {
  if (emp.status !== 'left' || emp.certIssued) return [];
  return [{
    id: 'left-no-cert', level: 'high',
    title: '已离职但未出具解除/终止劳动合同证明',
    why: '离职证明是法定义务，不是可选项：不出具被责令改正，造成损害的要赔偿（影响再就业、社保接续、失业金申领）。',
    action: '今日内在「单据」页生成并交付离职证明，同时在 15 日内办理档案和社保关系转移。',
    basis: ['《劳动合同法》第五十条、第八十九条', '《劳动合同法实施条例》第二十四条'],
  }];
}

/** 单个员工全部风险（high → medium → low 排序）。已离职员工只保留善后项（证明）：
 *  在职期违规的历史追责有时效计算，超出 MVP 范围，不在此误报「立即纠正」类动作。 */
const LEVEL_RANK = { high: 0, medium: 1, low: 2 };

export function employeeRisks(emp, todayISOStr = todayISO()) {
  const all = emp?.status === 'left'
    ? offboardingFindings(emp)
    : [
      ...probationFindings(emp, todayISOStr),
      ...contractFindings(emp, todayISOStr),
      ...socialFindings(emp),
      ...offboardingFindings(emp),
    ];
  return all.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/** 企业风险汇总 */
export function companyRisks(employees, todayISOStr = todayISO()) {
  const items = (employees ?? []).map((emp) => ({ emp, risks: employeeRisks(emp, todayISOStr) }));
  const count = (level) => items.reduce((s, x) => s + x.risks.filter((r) => r.level === level).length, 0);
  return {
    items,
    high: count('high'),
    medium: count('medium'),
    low: count('low'),
    cleanEmployees: items.filter((x) => x.risks.length === 0).length,
  };
}

// ---------------------------------------------------------------------------
// 经济补偿计算器（第 47 条 N / 第 87 条 2N / 第 40 条代通知金）
// ---------------------------------------------------------------------------

/**
 * 经济补偿。
 * - 每满一年 1 个月；6 个月以上不满 1 年按 1 年；不满 6 个月 0.5 个月（半整数月）。
 * - 月工资高于当地社平工资 3 倍的：按 3 倍封顶计发，且年限最高 12 年（第 47 条第二款）。
 * - multiplier=2 → 违法解除赔偿金 2N（第 87 条），不叠加代通知金。
 * - noticeGiven=false 且 multiplier=1 → 加 1 个月代通知金（「+1」，第 40 条）。
 */
export function severance({ hireISO, endISO, monthlyCents, socialCapCents = null, multiplier = 1, noticeGiven = true }) {
  assertISO(hireISO);
  assertISO(endISO);
  if (!Number.isInteger(monthlyCents) || monthlyCents < 0) throw new Error(`非法月工资: ${monthlyCents}`);
  const workMonths = Math.max(contractMonths(hireISO, endISO), 0);
  const years = Math.floor(workMonths / 12);
  const rem = workMonths % 12;
  let units = years + (rem >= 6 ? 1 : rem > 0 ? 0.5 : 0); // 补偿月数（0.5 步进）
  let baseCents = monthlyCents;
  let cappedBySocial = false;
  if (socialCapCents != null && monthlyCents > socialCapCents) {
    baseCents = socialCapCents;
    cappedBySocial = true;
    if (units > 12) units = 12; // 三倍封顶时年限封顶 12 年
  }
  const unitsHalf = Math.round(units * 2);
  const nCents = Math.round((baseCents * unitsHalf) / 2);
  const extraNoticeCents = multiplier === 1 && !noticeGiven ? monthlyCents : 0;
  const totalCents = nCents * multiplier + extraNoticeCents;
  const basis = ['《劳动合同法》第四十七条'];
  if (cappedBySocial) basis.push('《劳动合同法》第四十七条第二款（三倍封顶・12 年封顶）');
  if (multiplier === 2) basis.push('《劳动合同法》第八十七条（违法解除赔偿金 2N）');
  if (extraNoticeCents) basis.push('《劳动合同法》第四十条（代通知金 +1）');
  return {
    workMonths,
    yearsLabel: `${years} 年 ${rem} 个月`,
    units,
    baseCents,
    monthlyCents,
    cappedBySocial,
    nCents,
    extraNoticeCents,
    totalCents,
    basis,
  };
}

// ---------------------------------------------------------------------------
// 离职证明（劳动合同法第 50 条，实施条例第 24 条：四要素）
// ---------------------------------------------------------------------------

/** 身份证号脱敏（列表页展示用；证明文件由企业自行填写完整号码） */
export function maskIdCard(id) {
  const s = String(id ?? '').trim();
  if (!s) return '';
  if (s.length < 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(s.length - 8)}${s.slice(-4)}`;
}

function certCommon({ company, emp }) {
  if (!company?.name) throw new Error('缺少单位名称（先在「设置」完善企业档案）');
  if (!emp?.name) throw new Error('缺少员工姓名');
  if (!emp?.hire) throw new Error(`缺少 ${emp.name} 的入职日期`);
  if (emp.status !== 'left' || !emp?.leftDate) throw new Error(`${emp.name} 尚未登记离职日期，不能开具离职证明`);
  const termText = emp.contractType === 'open' || !emp.contractEnd
    ? '无固定期限'
    : `${emp.contractStart ?? emp.hire} 至 ${emp.contractEnd}`;
  return {
    years: workYearsLabel(emp.hire, emp.leftDate),
    termText,
  };
}

/** 离职证明纯文本（微信直接发送的降级通道） */
export function separationCertText({ company, emp, todayISOStr = todayISO() }) {
  const { years, termText } = certCommon({ company, emp });
  const L = [];
  L.push('解除／终止劳动合同证明');
  L.push('');
  L.push(`兹证明 ${emp.name}（身份证号：${emp.idCard || '____________'}）于 ${emp.hire} 入职我单位，担任 ${emp.role || '＿＿＿'} 岗位，双方签订的劳动合同（期限：${termText}）已于 ${emp.leftDate} 解除／终止。其在本单位工作年限为 ${years}。`);
  L.push('');
  L.push('特此证明。');
  L.push('');
  L.push(`单位名称（盖章）：${company.name}`);
  L.push(`统一社会信用代码：${company.creditCode || '____________________________'}`);
  L.push(`日期：${todayISOStr}`);
  L.push('');
  L.push('依据：《劳动合同法》第五十条、《劳动合同法实施条例》第二十四条（证明应写明劳动合同期限、解除或终止日期、工作岗位、工作年限）。本证明仅证明劳动关系存续及解除／终止事实，不含其他评价。');
  return L.join('\n');
}

/** 离职证明打印版：单文件 HTML（内联样式，可直接打印/存 PDF/盖章扫描） */
export function separationCertHtml({ company, emp, todayISOStr = todayISO() }) {
  const { years, termText } = certCommon({ company, emp });
  const e = escapeHtml;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>解除／终止劳动合同证明 · ${e(emp.name)}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", "SimSun", serif; color: #111; margin: 48px auto; max-width: 720px; line-height: 2; }
  h1 { font-size: 22px; text-align: center; letter-spacing: 6px; margin-bottom: 32px; }
  .seal { text-align: right; margin-top: 40px; }
  .sign-line { display: inline-block; min-width: 260px; border-bottom: 1px solid #111; }
  .foot { margin-top: 40px; font-size: 12px; color: #555; border-top: 1px dashed #bbb; padding-top: 10px; }
  @media print { body { margin: 16mm; } }
</style>
</head>
<body>
<h1>解除／终止劳动合同证明</h1>
<p>兹证明 <u>　${e(emp.name)}　</u>（身份证号：<u>　${e(emp.idCard || '＿＿＿＿＿＿＿＿＿＿＿＿')}　</u>）于 <u>　${e(emp.hire)}　</u> 入职我单位，担任 <u>　${e(emp.role || '＿＿＿')}　</u> 岗位，双方签订的劳动合同（期限：<u>　${e(termText)}　</u>）已于 <u>　${e(emp.leftDate)}　</u> 解除／终止。其在本单位工作年限为 <u>　${e(years)}　</u>。</p>
<p>特此证明。</p>
<div class="seal">
  <p>单位名称（盖章）：<span class="sign-line">${e(company.name)}</span></p>
  <p>统一社会信用代码：<span class="sign-line">${e(company.creditCode || '＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿')}</span></p>
  <p>日期：<span class="sign-line">${e(todayISOStr)}</span></p>
</div>
<div class="foot">依据：《劳动合同法》第五十条、《劳动合同法实施条例》第二十四条。本证明仅证明劳动关系存续及解除／终止事实，不含其他评价。生成：工据 WorkProof</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// 企业合规自查报告（确定性文本）
// ---------------------------------------------------------------------------

export function complianceReportText({ company, employees, todayISOStr = todayISO() }) {
  const risks = companyRisks(employees, todayISOStr);
  const L = [];
  L.push('【劳动用工合规自查报告】');
  L.push(`单位：${company?.name || '（未设置企业名称）'}${company?.owner ? `　负责人：${company.owner}` : ''}`);
  L.push(`日期：${todayISOStr}　在册员工：${(employees ?? []).length} 人（在职 ${(employees ?? []).filter((x) => x.status !== 'left').length} 人）`);
  L.push(`风险项：高危 ${risks.high}，中危 ${risks.medium}，低危 ${risks.low}；档案干净员工 ${risks.cleanEmployees} 人`);
  L.push('');
  for (const { emp, risks: rs } of risks.items) {
    L.push(`■ ${emp.name}${emp.role ? `（${emp.role}）` : ''}${emp.status === 'left' ? '【已离职】' : ''}：${rs.length === 0 ? '无风险项' : `${rs.length} 项`}`);
    for (const r of rs) {
      L.push(`  · [${r.level === 'high' ? '高危' : r.level === 'medium' ? '中危' : '低危'}] ${r.title}`);
      L.push(`    依据：${r.basis.join('；')}`);
      L.push(`    建议：${r.action}`);
    }
  }
  L.push('');
  L.push('说明：本报告按主流裁审口径生成，为通用合规提示，不构成法律意见；具体个案请咨询专业律师或属地劳动人事争议仲裁机构。');
  L.push(`生成：工据 WorkProof · ${todayISOStr}`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 离线授权码（第一桶金机制：免费 3 人，超出解锁）
// ---------------------------------------------------------------------------

export const FREE_EMPLOYEE_LIMIT = 3;
export const LICENSE_PRICE_HINT = '¥99 / 年';

// 无易混淆字符（0/O、1/I）的 32 字符表
const KEY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function fnv1a(str, salt) {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 由企业名称确定性地推导离线授权码 XXXX-XXXX-XXXX。
 * 诚实定位：校验和式钥匙，防顺手滥用、不防刻意破解；验证闭环阶段接受此折衷，
 * 正式收费阶段应替换为后端发码（见 docs/13 路线图）。
 */
export function makeLicenseKey(name) {
  const n = String(name ?? '').trim();
  if (!n) throw new Error('企业名称不能为空');
  const chars = [];
  for (let i = 0; i < 12; i += 1) {
    chars.push(KEY_CHARSET[fnv1a(`wp#${n}#${i}`, 0x9e3779b9 + i * 0x85ebca6b) % KEY_CHARSET.length]);
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export function verifyLicenseKey(name, key) {
  try {
    const expect = makeLicenseKey(name);
    const norm = (s) => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');
    return norm(key) === norm(expect);
  } catch {
    return false;
  }
}

/** 免费档闸门：是否还能新增员工 */
export function canAddEmployee(currentCount, licensed) {
  return licensed || currentCount < FREE_EMPLOYEE_LIMIT;
}

// ---------------------------------------------------------------------------
// 数据导入导出
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

export function exportBundle(state) {
  return JSON.stringify({ app: 'workproof', version: STATE_VERSION, exportedAt: todayISO(), state }, null, 2);
}

/** 导入并校验。绝不部分接受：结构不合法整体拒绝 */
export function importBundle(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (parsed?.app !== 'workproof') return { ok: false, error: '不是工据的备份文件' };
  if (typeof parsed.version !== 'number' || parsed.version > STATE_VERSION) {
    return { ok: false, error: `备份版本(${parsed.version})高于当前支持版本(${STATE_VERSION})，请升级应用` };
  }
  const s = parsed.state;
  const shapeOk =
    s && typeof s === 'object' &&
    typeof s.company === 'object' && s.company !== null &&
    Array.isArray(s.employees) &&
    typeof s.license === 'object' && s.license !== null;
  if (!shapeOk) return { ok: false, error: '备份结构不完整，已拒绝导入' };
  return { ok: true, state: s };
}

// ---------------------------------------------------------------------------
// HTML 工具
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
