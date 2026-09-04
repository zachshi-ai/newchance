/**
 * ui.js — 视图层：纯字符串渲染 + 约定式 data-action 事件
 * 事件绑定集中在 app.js（事件委托），本文件只产出 HTML。
 */
import {
  todayISO, ageFromBirth, scheduleStatus, nextDue, SCHEDULE_TEMPLATES,
  upcomingTasks, buildHandoff, handoffToText, TOXICS, LOG_TYPES,
} from './core.js';

export const SPECIES = { dog: '狗', cat: '猫', other: '其他' };
const COLORS = { orange: '#f97316', gray: '#9ca3af', brown: '#92400e', black: '#374151', gold: '#d97706', white: '#d1d5db' };
const ESCAPE_RISK = { low: '低 · 安分', mid: '中 · 需留意', high: '高 · 易越狱！' };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const petById = (state, id) => state.pets.find((p) => p.id === id);
const careOf = (state, petId) => state.care[petId] ?? {};
const petAge = (pet) => {
  if (!pet.birth) return '';
  const a = ageFromBirth(pet.birth);
  if (a.future) return '未出生';
  return a.years > 0 ? `${a.years} 岁 ${a.months} 个月` : `${a.months} 个月`;
};

function statusBadge(st) {
  if (!st) return '<span class="badge gray">未记录</span>';
  if (st.level === 'expired') return `<span class="badge red">已过期 ${-st.days} 天</span>`;
  if (st.level === 'due_soon') return `<span class="badge amber">${st.days === 0 ? '今天到期' : `${st.days} 天后到期`}</span>`;
  return `<span class="badge green">${st.days} 天后</span>`;
}

// ---------------------------------------------------------------------------
// 今日（仪表盘）
// ---------------------------------------------------------------------------

export function viewDashboard(state) {
  const tasks = upcomingTasks(state.schedule, todayISO());
  const urgent = tasks.filter((t) => t.status.level !== 'ok');
  const recentLog = [...state.log].slice(-5).reverse();

  if (state.pets.length === 0) {
    return `
      <div class="card" style="text-align:center; padding:34px 20px;">
        <div style="font-size:46px">🐾</div>
        <h2 style="margin:8px 0 6px">欢迎来到宠托付</h2>
        <p style="color:var(--ink-2); font-size:14px; margin:0 0 18px">
          建立宠物档案，一键生成照护者真正会看的<br/>托养交接单 —— 出门旅行，安心把毛孩子交出去。
        </p>
        <button class="btn block" data-action="goto" data-hash="#/pets">建立第一份宠物档案</button>
        <button class="btn subtle block" style="margin-top:10px" data-action="demo">先看示例数据</button>
      </div>`;
  }

  return `
    <div class="stat-row">
      <div class="stat"><b>${state.pets.length}</b><span>宠物档案</span></div>
      <div class="stat ${urgent.length ? 'warn' : ''}"><b>${urgent.length}</b><span>待办提醒</span></div>
      <div class="stat"><b>${state.handoffs.length}</b><span>已生成交接单</span></div>
    </div>

    <h2 class="sec">⏰ 未来 30 天待办 <span class="hint">疫苗 / 驱虫 / 体检</span></h2>
    ${urgent.length === 0
      ? '<div class="empty">一切正常，30 天内没有到期项目 🎉</div>'
      : `<div class="card">${urgent.map((t) => {
          const pet = petById(state, t.petId);
          return `<div class="item-row">
            <div class="item-main">
              <span class="dot" style="background:${COLORS[pet?.colorTag] ?? '#9ca3af'}"></span>
              <b>${esc(pet?.name ?? '未知宠物')}</b> · ${esc(t.item)}
              <div class="sub">${esc(t.note || '')}</div>
            </div>
            ${statusBadge(t.status)}
          </div>`;
        }).join('')}</div>`}

    <h2 class="sec">📄 快捷入口</h2>
    <div class="row">
      <button class="btn block" data-action="goto" data-hash="#/handoff">生成交接单</button>
      <button class="btn ghost block" data-action="goto" data-hash="#/log">记一笔照护日志</button>
    </div>

    <h2 class="sec">🧾 最近日志</h2>
    ${recentLog.length === 0
      ? '<div class="empty">还没有记录。托养期间让照护者随手记，你随时掌握。</div>'
      : `<div class="card">${recentLog.map(logRow).join('')}</div>`}
  `;
}

function logRow(l) {
  const t = l.type === '异常' ? 'red' : 'gray';
  return `<div class="item-row">
    <div class="item-main">
      <b>${esc(l.type)}</b> <span class="badge ${t}">${esc((l.at || '').replace('T', ' ').slice(5, 16))}</span>
      <div class="sub">${esc(l.note || '')}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 宠物档案
// ---------------------------------------------------------------------------

export function viewPets(state, params) {
  const editing = params?.edit ? petById(state, params.edit) : null;

  return `
    ${editing ? petFormHTML(editing) : petFormHTML(null)}

    <h2 class="sec">🐶 全部宠物 <span class="hint">${state.pets.length} 只</span></h2>
    ${state.pets.length === 0
      ? '<div class="empty">还没有宠物档案，用上面的表单建立。</div>'
      : state.pets.map((p) => {
          const c = careOf(state, p.id);
          return `<div class="card">
            <div style="display:flex; align-items:center; gap:10px;">
              <span class="dot" style="background:${COLORS[p.colorTag] ?? '#9ca3af'}; width:14px; height:14px;"></span>
              <div style="flex:1">
                <b style="font-size:16px">${esc(p.name)}</b>
                <span class="badge gray">${SPECIES[p.species] ?? p.species}</span>
                ${c.escapeRisk === 'high' ? '<span class="badge red">易越狱</span>' : ''}
                <div class="sub" style="font-size:12.5px; color:var(--ink-2)">
                  ${esc(p.breed || '')} · ${petAge(p)} · ${esc(p.weightKg || '—')}kg · ${p.neutered ? '已绝育' : '未绝育'}
                </div>
              </div>
            </div>
            <div class="row" style="margin-top:10px">
              <button class="btn sm ghost" data-action="goto" data-hash="#/care/${p.id}">护理指令</button>
              <button class="btn sm subtle" data-action="goto" data-hash="#/pets/${p.id}">编辑</button>
              <button class="btn sm danger" data-action="pet-del" data-id="${p.id}">删除</button>
            </div>
          </div>`;
        }).join('')}
  `;
}

function petFormHTML(p) {
  const isEdit = !!p;
  return `
    <h2 class="sec">${isEdit ? `✏️ 编辑档案：${esc(p.name)}` : '➕ 建立宠物档案'}</h2>
    <form class="card" id="pet-form" data-id="${p?.id ?? ''}">
      <div class="row">
        <div><label class="f">名字 *</label><input type="text" name="name" required value="${esc(p?.name ?? '')}" placeholder="煤球"/></div>
        <div><label class="f">种类 *</label>
          <select name="species">
            ${Object.entries(SPECIES).map(([k, v]) => `<option value="${k}" ${p?.species === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="row">
        <div><label class="f">品种</label><input type="text" name="breed" value="${esc(p?.breed ?? '')}" placeholder="中华田园猫"/></div>
        <div><label class="f">性别</label>
          <select name="sex">
            <option value="" ${!p?.sex ? 'selected' : ''}>未知</option>
            <option value="公" ${p?.sex === '公' ? 'selected' : ''}>公</option>
            <option value="母" ${p?.sex === '母' ? 'selected' : ''}>母</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div><label class="f">生日</label><input type="date" name="birth" value="${esc(p?.birth ?? '')}"/></div>
        <div><label class="f">体重 (kg)</label><input type="number" step="0.1" min="0" name="weightKg" value="${esc(p?.weightKg ?? '')}" placeholder="4.5"/></div>
      </div>
      <div class="row">
        <div><label class="f">绝育</label>
          <select name="neutered">
            <option value="1" ${p?.neutered ? 'selected' : ''}>已绝育</option>
            <option value="" ${!p?.neutered ? 'selected' : ''}>未绝育</option>
          </select>
        </div>
        <div><label class="f">识别色（多宠区分）</label>
          <select name="colorTag">
            ${Object.keys(COLORS).map((k) => `<option value="${k}" ${p?.colorTag === k ? 'selected' : ''}>${k === 'orange' ? '橘' : k === 'gray' ? '灰' : k === 'brown' ? '棕' : k === 'black' ? '黑' : k === 'gold' ? '金' : '白'}</option>`).join('')}
          </select>
        </div>
      </div>
      <label class="f">芯片 / 耳标号</label>
      <input type="text" name="chip" value="${esc(p?.chip ?? '')}" placeholder="选填"/>
      <button class="btn block" style="margin-top:14px" type="submit">${isEdit ? '保存修改' : '建立档案'}</button>
    </form>
  `;
}

// ---------------------------------------------------------------------------
// 护理指令（照护者视角的字段）
// ---------------------------------------------------------------------------

export function viewCare(state, params) {
  const pet = petById(state, params?.id);
  if (!pet) return '<div class="empty">宠物不存在，先去「宠物」页建立档案。</div>';
  const c = careOf(state, pet.id);
  const feedings = c.feedings ?? [];
  const meds = c.meds ?? [];

  return `
    <h2 class="sec">🥣 护理指令 · ${esc(pet.name)}
      <span class="hint">照护者视角：写清楚「谁来看都能照做」</span>
    </h2>

    <form id="care-form" data-id="${pet.id}">
      <div class="card">
        <b>喂食计划 *</b>
        <div id="feedings" style="margin-top:8px">
          ${feedings.map((f) => feedingRowHTML(f)).join('') || feedingRowHTML({ time: '08:00', label: '', amount: '', note: '' })}
        </div>
        <button type="button" class="btn sm subtle" data-action="add-feeding">+ 加一餐</button>
        <div class="sub" id="feed-total" style="font-size:12px; color:var(--ink-2); margin-top:6px"></div>
      </div>

      <div class="card">
        <b>用药 / 保健品</b>
        <div id="meds" style="margin-top:8px">
          ${meds.map((m) => medRowHTML(m)).join('')}
        </div>
        <button type="button" class="btn sm subtle" data-action="add-med">+ 加一种药</button>
      </div>

      <div class="card">
        <b>禁忌（不能吃 / 不能做）</b>
        <label class="f">用顿号或逗号分隔，会以红条形式出现在交接单最显眼处</label>
        <textarea name="offLimits" placeholder="百合、人类的零食、散养出门">${esc((c.offLimits ?? []).join('、'))}</textarea>
      </div>

      <div class="card">
        <b>性格与应激点</b>
        <textarea name="stressTriggers" placeholder="怕吸尘器；陌生人来先躲床底，别硬拽，放粮蹲下等它">${esc(c.stressTriggers ?? '')}</textarea>
        <label class="f">走失风险</label>
        <select name="escapeRisk">
          <option value="low" ${c.escapeRisk === 'low' ? 'selected' : ''}>低 · 安分</option>
          <option value="mid" ${c.escapeRisk === 'mid' || !c.escapeRisk ? 'selected' : ''}>中 · 进出需留意</option>
          <option value="high" ${c.escapeRisk === 'high' ? 'selected' : ''}>高 · 易越狱（交接单将显著警示）</option>
        </select>
      </div>

      <div class="card">
        <b>日常事务</b>
        <div class="row">
          <div><label class="f">猫砂 / 卫生</label><input type="text" name="litter" value="${esc(c.routine?.litter ?? '')}" placeholder="每天铲一次，一周换砂"/></div>
          <div><label class="f">遛弯</label><input type="text" name="walks" value="${esc(c.routine?.walks ?? '')}" placeholder="早晚各一次，胸背带"/></div>
        </div>
        <label class="f">其他备注</label>
        <textarea name="routineNotes" placeholder="喜欢的玩具、喂药手法、和邻居家狗的恩怨…">${esc(c.routine?.notes ?? '')}</textarea>
      </div>

      <button class="btn block" type="submit">保存护理指令</button>
    </form>
  `;
}

function feedingRowHTML(f) {
  return `<div class="feed-line">
    <input type="text" data-f="time" value="${esc(f.time ?? '')}" placeholder="08:00"/>
    <input type="text" data-f="label" value="${esc(f.label ?? '')}" placeholder="主食罐/冻干"/>
    <input type="text" data-f="amount" value="${esc(f.amount ?? '')}" placeholder="85g"/>
    <button type="button" class="icon-btn" data-action="del-row">✕</button>
  </div>`;
}
function medRowHTML(m) {
  return `<div class="med-line">
    <input type="text" data-f="name" value="${esc(m.name ?? '')}" placeholder="药名"/>
    <input type="text" data-f="dose" value="${esc(m.dose ?? '')}" placeholder="剂量"/>
    <input type="text" data-f="freq" value="${esc(m.freq ?? '')}" placeholder="频次"/>
    <button type="button" class="icon-btn" data-action="del-row">✕</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// 免疫 / 驱虫日程
// ---------------------------------------------------------------------------

export function viewSchedule(state) {
  if (state.pets.length === 0) return '<div class="empty">先在「宠物」页建立档案，日程会按犬/猫模板自动生成。</div>';

  return `
    <div class="disclaimer">⚠️ 模板周期为行业公开惯例（犬猫常规免疫/驱虫），个体差异请以兽医意见为准。幼犬幼猫首免系列请遵医嘱单独安排，本页只管理「加强/续接」节奏。</div>
    ${state.pets.map((p) => {
      const rows = state.schedule.filter((r) => r.petId === p.id);
      const tpl = SCHEDULE_TEMPLATES[p.species] ?? [];
      return `<h2 class="sec">💉 ${esc(p.name)} <span class="badge gray">${SPECIES[p.species] ?? '其他'}</span></h2>
      <div class="card">
        ${tpl.map((t) => {
          const row = rows.find((r) => r.item === t.item);
          const last = row?.lastDate ?? '';
          const next = last ? nextDue(last, t.cycleDays) : null;
          const st = next ? scheduleStatus(next) : null;
          return `<div class="item-row">
            <div class="item-main">
              <b>${esc(t.item)}</b> <span class="sub">每 ${t.cycleDays} 天${t.note ? ` · ${esc(t.note)}` : ''}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px">
              ${statusBadge(st)}
              <input type="date" data-sched="${esc(t.item)}" data-pet="${p.id}" data-cycle="${t.cycleDays}" value="${esc(last)}" style="width:140px"/>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
    <p class="sub" style="font-size:12px; color:var(--ink-2)">填写「上次日期」即可，下次到期自动推算并出现在首页待办。</p>
  `;
}

// ---------------------------------------------------------------------------
// 交接单
// ---------------------------------------------------------------------------

let lastHandoff = null; // 当前已生成、待操作的交接单（内存态）

export function viewHandoff(state) {
  const pets = state.pets;
  if (pets.length === 0) return '<div class="empty">先在「宠物」页建立档案，再来生成交接单。</div>';
  const t = todayISO();
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const formHTML = `
    <h2 class="sec">📄 生成交接单 <span class="hint">照护者真正会看的那一页</span></h2>
    <form class="card" id="handoff-form">
      <label class="f">宠物 *</label>
      <select name="petId">${pets.map((p) => `<option value="${p.id}">${esc(p.name)}（${SPECIES[p.species] ?? '其他'}）</option>`).join('')}</select>
      <div class="row">
        <div><label class="f">托养开始 *</label><input type="date" name="start" value="${t}" required/></div>
        <div><label class="f">托养结束 *</label><input type="date" name="end" value="${in7}" required/></div>
      </div>
      <div class="row">
        <div><label class="f">照护者称呼 *</label><input type="text" name="sitterName" placeholder="王阿姨" required/></div>
        <div><label class="f">照护者电话</label><input type="tel" name="sitterPhone" placeholder="选填"/></div>
      </div>
      <div class="row">
        <div><label class="f">旅行期间能找到你的方式</label><input type="text" name="ownerPhone" placeholder="微信/酒店电话/漫游号"/></div>
        <div><label class="f">紧急联系人（你找不到时）*</label><input type="text" name="emergencyName" placeholder="李医生" required/></div>
      </div>
      <div class="row">
        <div><label class="f">紧急电话 *</label><input type="tel" name="emergencyPhone" placeholder="137…" required/></div>
        <div><label class="f">常去医院</label><input type="text" name="vetClinic" placeholder="安安宠医（xx路店）"/></div>
      </div>
      <div class="row">
        <div><label class="f">医院电话 *</label><input type="tel" name="vetPhone" placeholder="010-…" required/></div>
        <div></div>
      </div>
      <button class="btn block" style="margin-top:14px" type="submit">生成交接单</button>
    </form>
    <div id="ho-result"></div>
  `;

  if (lastHandoff) {
    return `${formHTML}
      <h2 class="sec">✅ 交接单已生成 <span class="hint">三通道送达照护者</span></h2>
      <div class="ho-actions">
        <button class="btn" data-action="ho-download">⬇️ 下载 HTML（微信发送）</button>
        <button class="btn ghost" data-action="ho-copy">📋 复制纯文本</button>
        <button class="btn subtle" data-action="ho-print">🖨️ 打印 / 存 PDF</button>
      </div>
      <iframe id="ho-frame" title="交接单预览" srcdoc="${esc(handoffFullHTML(lastHandoff))}"></iframe>
      <p class="sub" style="font-size:12px; color:var(--ink-2)">
        提示：微信里直接粘贴文本最稳；HTML 文件适合寄养机构存档；打印版可贴在航空箱上。
      </p>`;
  }
  return formHTML;
}

// 交接单自包含文档（单文件 HTML，可离线打开、可直接打印）
export function handoffFullHTML(h) {
  const d = h.data;
  const g = (v) => esc(v ?? '—');
  const redLines = d.offLimits.length
    ? `<div class="ho-banner">⛔ 禁止：${d.offLimits.map(esc).join(' · ')}</div>` : '';
  const escapeWarn = d.pet.escapeRisk === 'high'
    ? `<div class="ho-banner amber">⚠️ ${esc(d.pet.name)} 是易走失体质——进出请随手关门，开门先看脚下。</div>` : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(d.pet.name)} 的托养交接单</title>
<style>
  :root { --ink:#1f2937; --mut:#6b7280; --line:#e5e7eb; --brand:#ea580c; }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; color:var(--ink); margin:0; padding:28px 22px; font-size:14px; line-height:1.6; }
  .sheet { max-width:720px; margin:0 auto; }
  .ho-head { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid var(--brand); padding-bottom:10px; }
  .ho-head h1 { margin:0; font-size:24px; }
  .ho-head .period { color:var(--brand); font-weight:700; }
  .ho-meta { color:var(--mut); font-size:12px; margin-top:4px; }
  .ho-banner { background:#fee2e2; color:#b91c1c; border:1.5px solid #fca5a5; border-radius:10px; padding:10px 14px; font-weight:700; margin:14px 0; font-size:15px; }
  .ho-banner.amber { background:#fef3c7; color:#92400e; border-color:#fcd34d; }
  h2 { font-size:15px; margin:20px 0 8px; color:var(--brand); }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th, td { border:1px solid var(--line); padding:7px 10px; text-align:left; }
  th { background:#fff7ed; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 18px; font-size:13.5px; }
  .contacts { background:#f8f7f4; border-radius:12px; padding:14px 16px; margin-top:8px; }
  .contacts b { font-size:14px; }
  .ho-foot { margin-top:22px; padding-top:10px; border-top:1px solid var(--line); color:var(--mut); font-size:11.5px; }
  @media print { body { padding:0; } }
</style>
</head>
<body>
<div class="sheet">
  <div class="ho-head">
    <div><h1>🐾 ${esc(d.pet.name)} 的托养交接单</h1>
      <div class="ho-meta">由宠托付 PetHandoff 生成 · ${esc(h.generatedAt || '')}</div></div>
    <div class="period">${esc(d.period.start)}<br/>~ ${esc(d.period.end)}</div>
  </div>

  ${redLines}
  ${escapeWarn}

  <h2>基本信息</h2>
  <div class="grid">
    <div>种类：${g(SPECIES[d.pet.species] ?? d.pet.species)}</div>
    <div>品种：${g(d.pet.breed)}</div>
    <div>性别：${g(d.pet.sex)}</div>
    <div>年龄：${d.pet.age ? `${d.pet.age.years} 岁 ${d.pet.age.months} 个月` : '—'}</div>
    <div>体重：${g(d.pet.weightKg)} kg</div>
    <div>绝育：${d.pet.neutered ? '已绝育' : '未绝育'}</div>
    ${d.pet.chip ? `<div>芯片：${g(d.pet.chip)}</div>` : ''}
    <div>走失风险：${g(ESCAPE_RISK[d.pet.escapeRisk] ?? '未评估')}</div>
  </div>

  <h2>喂食${d.feedingTotalGrams ? `（全天合计约 ${d.feedingTotalGrams}g）` : ''}</h2>
  <table><tr><th style="width:20%">时间</th><th>食物</th><th style="width:18%">分量</th><th style="width:30%">备注</th></tr>
  ${d.feedings.map((f) => `<tr><td>${g(f.time)}</td><td>${g(f.label)}</td><td>${g(f.amount)}</td><td>${g(f.note) || '—'}</td></tr>`).join('')}
  </table>

  ${d.meds.length ? `<h2>用药 / 保健品</h2>
  <table><tr><th>名称</th><th style="width:18%">剂量</th><th style="width:18%">频次</th><th style="width:30%">备注</th></tr>
  ${d.meds.map((m) => `<tr><td>${g(m.name)}</td><td>${g(m.dose)}</td><td>${g(m.freq)}</td><td>${g(m.note) || '—'}</td></tr>`).join('')}
  </table>` : ''}

  ${d.stress ? `<h2>性格与安抚</h2><div>${esc(d.stress)}</div>` : ''}

  ${d.routine && (d.routine.litter || d.routine.walks || d.routine.notes) ? `<h2>日常事务</h2>
  <div class="grid">
    ${d.routine.litter ? `<div>卫生：${esc(d.routine.litter)}</div>` : ''}
    ${d.routine.walks ? `<div>遛弯：${esc(d.routine.walks)}</div>` : ''}
    ${d.routine.notes ? `<div style="grid-column:1/-1">备注：${esc(d.routine.notes)}</div>` : ''}
  </div>` : ''}

  <h2>紧急联系</h2>
  <div class="contacts">
    <div><b>照护者</b>：${g(d.contacts.sitterName)} ${g(d.contacts.sitterPhone)}</div>
    ${d.contacts.ownerPhone ? `<div><b>主人（旅行中）</b>：${g(d.contacts.ownerPhone)}</div>` : ''}
    <div><b>紧急联系人</b>：${g(d.contacts.emergencyName)} ${g(d.contacts.emergencyPhone)}</div>
    <div><b>常去医院</b>：${g(d.contacts.vetClinic)} ${g(d.contacts.vetPhone)}</div>
  </div>

  <div class="ho-foot">
    ※ 本单由宠物主人整理，仅作照护参考，不构成医疗建议；宠物出现异常（持续呕吐/腹泻、精神萎靡、拒食超 24 小时、外伤）请第一时间联系医院。
    <br/>※ 每次托养前请向主人确认本单为最新版本。
  </div>
</div>
</body>
</html>`;
}

/** 处理交接单表单提交：返回 {ok, html?, missing?}；成功时更新模块内存态 */
export function makeHandoff(state, formData) {
  const pet = petById(state, formData.get('petId'));
  const care = careOf(state, pet?.id);
  const result = buildHandoff({
    pet,
    care,
    period: { start: formData.get('start'), end: formData.get('end') },
    contacts: {
      sitterName: formData.get('sitterName'), sitterPhone: formData.get('sitterPhone'),
      ownerPhone: formData.get('ownerPhone'), emergencyName: formData.get('emergencyName'),
      emergencyPhone: formData.get('emergencyPhone'), vetClinic: formData.get('vetClinic'),
      vetPhone: formData.get('vetPhone'),
    },
  });
  if (!result.ok) return result;
  lastHandoff = { ...result, generatedAt: new Date().toLocaleString('zh-CN') };
  return result;
}

export function currentHandoffText() {
  return lastHandoff ? handoffToText(lastHandoff) : '';
}
export function currentHandoff() {
  return lastHandoff;
}
export function currentHandoffHTML() {
  return lastHandoff ? handoffFullHTML(lastHandoff) : '';
}
export function markHandoffSaved(state) {
  if (!lastHandoff) return;
  state.handoffs.push({
    id: `ho-${Date.now()}`, petId: lastHandoff.data.pet.id,
    period: lastHandoff.data.period, createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// 照护日志
// ---------------------------------------------------------------------------

export function viewLog(state) {
  if (state.pets.length === 0) return '<div class="empty">先建立宠物档案。</div>';
  const entries = [...state.log].reverse().slice(0, 50);
  return `
    <h2 class="sec">🧾 照护日志 <span class="hint">交接期间随手记，主人随时看</span></h2>
    <form class="card" id="log-form">
      <label class="f">宠物</label>
      <select name="petId">${state.pets.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <label class="f">类型</label>
      <div class="tabs">
        ${LOG_TYPES.map((t, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-logtype="${t}">${t}</button>`).join('')}
      </div>
      <input type="hidden" name="type" value="${LOG_TYPES[0]}"/>
      <label class="f">备注</label>
      <input type="text" name="note" placeholder="吃了 80g，精神不错"/>
      <button class="btn block" style="margin-top:12px" type="submit">记一笔</button>
    </form>
    <h2 class="sec">最近记录 <span class="hint">${state.log.length} 条 · 保留最新 50</span></h2>
    ${entries.length === 0
      ? '<div class="empty">还没有记录。</div>'
      : `<div class="card">${entries.map(logRow).join('')}</div>`}
    ${state.log.length ? '<button class="btn ghost block" data-action="log-copy">📋 复制全部日志（发给主人）</button>' : ''}
  `;
}

export function logExportText(state) {
  const name = (id) => petById(state, id)?.name ?? '未知';
  return state.log.map((l) => `${(l.at || '').replace('T', ' ').slice(0, 16)} [${name(l.petId)}] ${l.type}${l.note ? `：${l.note}` : ''}`).join('\n');
}

// ---------------------------------------------------------------------------
// 禁忌速查
// ---------------------------------------------------------------------------

export function viewToxics(state, params) {
  const sp = params?.species === 'cat' ? 'cat' : 'dog';
  return `
    <h2 class="sec">☠️ 禁忌速查 <span class="hint">照护前 30 秒扫一遍</span></h2>
    <div class="tabs">
      <button class="${sp === 'dog' ? 'on' : ''}" data-action="goto" data-hash="#/toxics/dog">狗</button>
      <button class="${sp === 'cat' ? 'on' : ''}" data-action="goto" data-hash="#/toxics/cat">猫</button>
    </div>
    ${TOXICS[sp].map((t) => `
      <div class="card toxic" style="border-left-color:${t.level === '剧毒' ? 'var(--red)' : t.level === '高毒' ? '#ea580c' : '#b45309'}">
        <b>${esc(t.name)}</b> <span class="lvl">${esc(t.level)}</span>
        <div class="why">${esc(t.why)}</div>
      </div>`).join('')}
    <div class="disclaimer">⚠️ 本清单为常见项速查，不完整且不构成医疗建议。疑似误食请立即联系兽医或宠物中毒急救渠道，不要等待症状出现。</div>
  `;
}
