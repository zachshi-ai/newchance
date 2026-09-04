/**
 * app.js — 路由、状态变更、事件委托、设置页与启动
 */
import {
  loadState, saveState, track, uid, emptyState,
} from './store.js';
import {
  todayISO, addDays, exportBundle, importBundle, appendLog,
} from './core.js';
import {
  esc, viewDashboard, viewPets, viewCare, viewSchedule, viewHandoff,
  makeHandoff, currentHandoffText, currentHandoffHTML, currentHandoff,
  markHandoffSaved, viewLog, logExportText, viewToxics, SPECIES,
} from './ui.js';

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

let state = loadState();

const NAV = [
  ['#/dashboard', '今日'], ['#/pets', '宠物'], ['#/schedule', '日程'],
  ['#/handoff', '交接单'], ['#/log', '日志'], ['#/toxics/dog', '禁忌'], ['#/settings', '设置'],
];

function parseHash() {
  const h = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [path, param] = h.split('/');
  return { path: path || 'dashboard', param };
}

export function render() {
  const { path, param } = parseHash();
  let html = '';
  switch (path) {
    case 'pets': html = viewPets(state, { edit: param }); break;
    case 'care': html = viewCare(state, { id: param }); break;
    case 'schedule': html = viewSchedule(state); break;
    case 'handoff': html = viewHandoff(state); break;
    case 'log': html = viewLog(state); break;
    case 'toxics': html = viewToxics(state, { species: param }); break;
    case 'settings': html = viewSettings(); break;
    default: html = viewDashboard(state);
  }
  $view.innerHTML = html;
  const active = path === 'dashboard' ? '#/dashboard' : `#/${path}${path === 'toxics' ? '/dog' : ''}`;
  $nav.innerHTML = NAV.map(([hash, label]) =>
    `<a href="${hash}" class="${hash === active ? 'active' : ''}">${label}</a>`).join('');
  window.scrollTo(0, 0);
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { $toast.hidden = true; }, 2400);
}

function commit(trackType, payload) {
  if (trackType) track(state, trackType, payload);
  saveState(state);
  render();
}

// ---------------------------------------------------------------------------
// 设置页
// ---------------------------------------------------------------------------

function viewSettings() {
  return `
    <h2 class="sec">⚙️ 数据与备份</h2>
    <div class="card">
      <p style="margin:0 0 10px; font-size:13.5px; color:var(--ink-2)">
        所有数据仅存于本机浏览器。换机/给家人备份：导出 JSON 文件，到目标设备导入。
      </p>
      <div class="row">
        <button class="btn block" data-action="export-json">⬇️ 导出备份</button>
        <label class="btn ghost block" style="line-height:2.4">
          ⬆️ 导入备份<input type="file" id="import-file" accept=".json" hidden/>
        </label>
      </div>
    </div>

    <h2 class="sec">🔬 验证埋点（HDD/OHELM）</h2>
    <div class="card">
      <p style="margin:0 0 10px; font-size:13.5px; color:var(--ink-2)">
        本地事件流共 <b>${state.events.length}</b> 条。导出后发给开发者，用于验证假设（只含行为事件，不含宠物隐私字段）。
      </p>
      <button class="btn subtle block" data-action="export-events">导出事件日志</button>
    </div>

    <h2 class="sec">示例与危险区</h2>
    <div class="card">
      <button class="btn subtle block" data-action="demo">载入示例数据（两只宠物）</button>
      <button class="btn danger block" style="margin-top:10px" data-action="wipe">清空全部数据</button>
    </div>
    <p class="sub" style="font-size:12px; color:var(--ink-2); text-align:center">
      宠托付 PetHandoff v0.1 · 零依赖本地优先 PWA
    </p>
  `;
}

function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

// ---------------------------------------------------------------------------
// 示例数据
// ---------------------------------------------------------------------------

function loadDemo() {
  const t = todayISO();
  const d = (n) => addDays(t, -n);
  const cat = { id: uid(), name: '煤球', species: 'cat', breed: '中华田园猫', sex: '公', birth: '2022-03-01', weightKg: 4.5, neutered: true, chip: '', colorTag: 'black' };
  const dog = { id: uid(), name: '馒头', species: 'dog', breed: '柴犬', sex: '母', birth: '2021-07-15', weightKg: 11.8, neutered: true, chip: 'A1234567', colorTag: 'orange' };
  state.pets = [cat, dog];
  state.care = {
    [cat.id]: {
      feedings: [
        { time: '08:00', label: '冻干粮', amount: '20g', note: '' },
        { time: '20:00', label: '主食罐', amount: '85g', note: '加一勺水' },
      ],
      meds: [],
      offLimits: ['百合', '人类零食'],
      stressTriggers: '怕吸尘器；陌生人来先躲床底，别硬拽，放粮蹲下等它自己出来',
      escapeRisk: 'mid',
      routine: { litter: '每天铲一次，一周整体换砂', walks: '', notes: '逗猫棒在鞋柜第二层' },
    },
    [dog.id]: {
      feedings: [
        { time: '07:30', label: '成犬粮', amount: '150g', note: '羊奶粉半包' },
        { time: '18:30', label: '成犬粮', amount: '120g', note: '' },
      ],
      meds: [{ name: '心丝虫预防 chewable', dose: '12-25kg 规格 1 片', freq: '每月 1 号', route: '口服', note: '当零食喂' }],
      offLimits: ['巧克力', '葡萄', '鸡骨头', '垃圾桶翻找'],
      stressTriggers: '雷雨天会钻沙发底；见其他狗兴奋扑人，遛弯必须胸背带',
      escapeRisk: 'high',
      routine: { litter: '', walks: '早晚各 30 分钟', notes: '出门前先收好鞋子' },
    },
  };
  state.schedule = [
    { id: uid(), petId: cat.id, item: '狂犬疫苗', lastDate: d(340), cycleDays: 365, note: '' },
    { id: uid(), petId: cat.id, item: '猫三联加强', lastDate: d(200), cycleDays: 365, note: '' },
    { id: uid(), petId: cat.id, item: '体外驱虫', lastDate: d(25), cycleDays: 30, note: '' },
    { id: uid(), petId: cat.id, item: '体内驱虫', lastDate: d(50), cycleDays: 90, note: '' },
    { id: uid(), petId: cat.id, item: '年度体检', lastDate: d(300), cycleDays: 365, note: '' },
    { id: uid(), petId: dog.id, item: '狂犬疫苗', lastDate: d(300), cycleDays: 365, note: '' },
    { id: uid(), petId: dog.id, item: '联苗年检（四/八联）', lastDate: d(280), cycleDays: 365, note: '' },
    { id: uid(), petId: dog.id, item: '体外驱虫', lastDate: d(45), cycleDays: 30, note: '' },
    { id: uid(), petId: dog.id, item: '体内驱虫', lastDate: d(10), cycleDays: 90, note: '' },
    { id: uid(), petId: dog.id, item: '年度体检', lastDate: d(360), cycleDays: 365, note: '' },
  ];
  state.log = [
    { id: uid(), at: `${t}T08:05`, petId: cat.id, type: '喂食', note: '吃了 20g 冻干，食欲正常' },
    { id: uid(), at: `${t}T08:20`, petId: dog.id, type: '遛弯', note: '30 分钟，大便一次正常' },
  ];
}

// ---------------------------------------------------------------------------
// 事件委托
// ---------------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, hash } = el.dataset;

  switch (action) {
    case 'goto':
      location.hash = hash;
      break;

    case 'demo':
      loadDemo();
      commit('demo_loaded');
      toast('示例数据已载入');
      location.hash = '#/dashboard';
      break;

    case 'pet-del': {
      const pet = state.pets.find((p) => p.id === id);
      if (!pet) return;
      if (!confirm(`确定删除「${pet.name}」的档案？护理与日程一并删除。`)) return;
      state.pets = state.pets.filter((p) => p.id !== id);
      delete state.care[id];
      state.schedule = state.schedule.filter((r) => r.petId !== id);
      commit('pet_deleted', { species: pet.species });
      toast('已删除');
      break;
    }

    case 'add-feeding': {
      const box = document.getElementById('feedings');
      box.insertAdjacentHTML('beforeend', `
        <div class="feed-line">
          <input type="text" data-f="time" placeholder="18:00"/>
          <input type="text" data-f="label" placeholder="主食罐/冻干"/>
          <input type="text" data-f="amount" placeholder="85g"/>
          <button type="button" class="icon-btn" data-action="del-row">✕</button>
        </div>`);
      break;
    }

    case 'add-med': {
      const box = document.getElementById('meds');
      box.insertAdjacentHTML('beforeend', `
        <div class="med-line">
          <input type="text" data-f="name" placeholder="药名"/>
          <input type="text" data-f="dose" placeholder="剂量"/>
          <input type="text" data-f="freq" placeholder="频次"/>
          <button type="button" class="icon-btn" data-action="del-row">✕</button>
        </div>`);
      break;
    }

    case 'del-row':
      el.closest('.feed-line, .med-line')?.remove();
      break;

    case 'ho-download': {
      const h = currentHandoff();
      if (!h) return;
      downloadText(`交接单-${h.data.pet.name}-${h.data.period.start}.html`, currentHandoffHTML(), 'text/html');
      track(state, 'handoff_downloaded', { species: h.data.pet.species });
      saveState(state);
      toast('已下载，可通过微信/QQ 发送该文件');
      break;
    }

    case 'ho-copy': {
      const text = currentHandoffText();
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        track(state, 'handoff_text_copied');
        saveState(state);
        toast('纯文本已复制，去微信粘贴吧');
      }, () => toast('复制失败，请手动选择文本'));
      break;
    }

    case 'ho-print': {
      document.getElementById('ho-frame')?.contentWindow?.focus();
      document.getElementById('ho-frame')?.contentWindow?.print();
      break;
    }

    case 'log-copy': {
      navigator.clipboard.writeText(logExportText(state)).then(
        () => toast('日志已复制'),
        () => toast('复制失败'),
      );
      break;
    }

    case 'export-json':
      downloadText(`pethandoff-backup-${todayISO()}.json`, exportBundle(state), 'application/json');
      track(state, 'export_json');
      saveState(state);
      toast('备份已导出');
      break;

    case 'export-events':
      downloadText(`pethandoff-events-${todayISO()}.json`, JSON.stringify(state.events, null, 2), 'application/json');
      toast('事件日志已导出，谢谢参与验证');
      break;

    case 'wipe':
      if (confirm('确定清空全部数据？此操作不可恢复（建议先导出备份）。')) {
        state = emptyState();
        commit('wiped');
        toast('已清空');
      }
      break;

    default:
      break;
  }
});

// 日志类型选择（tabs 单选）
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-logtype]');
  if (!btn) return;
  btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
  btn.classList.add('on');
  const form = btn.closest('form');
  form.querySelector('[name="type"]').value = btn.dataset.logtype;
});

// 表单提交
document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();

  if (form.id === 'pet-form') {
    const fd = new FormData(form);
    const id = form.dataset.id;
    const data = {
      name: fd.get('name').trim(),
      species: fd.get('species'),
      breed: fd.get('breed').trim(),
      sex: fd.get('sex'),
      birth: fd.get('birth'),
      weightKg: fd.get('weightKg'),
      neutered: fd.get('neutered') === '1',
      chip: fd.get('chip').trim(),
      colorTag: fd.get('colorTag'),
    };
    if (id) {
      const p = state.pets.find((x) => x.id === id);
      Object.assign(p, data);
      commit('pet_updated', { species: data.species });
      toast('已保存');
      location.hash = '#/pets';
    } else {
      state.pets.push({ id: uid(), ...data });
      state.care[state.pets.at(-1).id] = { feedings: [{ time: '08:00', label: '', amount: '', note: '' }], meds: [], offLimits: [], stressTriggers: '', escapeRisk: 'mid', routine: {} };
      commit('pet_added', { species: data.species });
      toast('档案已建立，接着写护理指令');
      location.hash = `#/care/${state.pets.at(-1).id}`;
    }
    return;
  }

  if (form.id === 'care-form') {
    const id = form.dataset.id;
    const fd = new FormData(form);
    const feedings = [...form.querySelectorAll('#feedings .feed-line')].map((row) => ({
      time: row.querySelector('[data-f="time"]').value.trim(),
      label: row.querySelector('[data-f="label"]').value.trim(),
      amount: row.querySelector('[data-f="amount"]').value.trim(),
      note: '',
    })).filter((f) => f.label || f.amount);
    const meds = [...form.querySelectorAll('#meds .med-line')].map((row) => ({
      name: row.querySelector('[data-f="name"]').value.trim(),
      dose: row.querySelector('[data-f="dose"]').value.trim(),
      freq: row.querySelector('[data-f="freq"]').value.trim(),
      note: '',
    })).filter((m) => m.name);
    state.care[id] = {
      ...state.care[id],
      feedings,
      meds,
      offLimits: (fd.get('offLimits') || '').split(/[、,，;；\n]/).map((s) => s.trim()).filter(Boolean),
      stressTriggers: (fd.get('stressTriggers') || '').trim(),
      escapeRisk: fd.get('escapeRisk'),
      routine: {
        ...(state.care[id]?.routine ?? {}),
        litter: (fd.get('litter') || '').trim(),
        walks: (fd.get('walks') || '').trim(),
        notes: (fd.get('routineNotes') || '').trim(),
      },
    };
    commit('care_saved');
    toast('护理指令已保存');
    return;
  }

  if (form.id === 'handoff-form') {
    const result = makeHandoff(state, new FormData(form));
    if (!result.ok) {
      toast(`还差这些信息：${result.missing.join('、')}`);
      return;
    }
    markHandoffSaved(state);
    commit('handoff_generated', { start: result.data.period.start, end: result.data.period.end });
    toast('交接单已生成');
    return;
  }

  if (form.id === 'log-form') {
    const fd = new FormData(form);
    state.log = appendLog(state.log, {
      id: uid(),
      at: new Date().toISOString().slice(0, 16),
      petId: fd.get('petId'),
      type: fd.get('type'),
      note: (fd.get('note') || '').trim(),
    });
    form.querySelector('[name="note"]').value = '';
    commit('log_added', { type: fd.get('type') });
    toast('已记录');
  }
});

// 免疫/驱虫「上次日期」变化 → 更新日程
document.addEventListener('change', (e) => {
  const input = e.target;
  if (input.matches('[data-sched]')) {
    const { sched: item, pet: petId, cycle } = input.dataset;
    const lastDate = input.value;
    const existing = state.schedule.find((r) => r.petId === petId && r.item === item);
    if (existing) {
      existing.lastDate = lastDate || null;
    } else {
      state.schedule.push({ id: uid(), petId, item, lastDate: lastDate || null, cycleDays: Number(cycle), note: '' });
    }
    commit('schedule_updated', { item });
  }
  if (input.id === 'import-file') {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importBundle(String(reader.result));
      if (!r.ok) {
        toast(`导入失败：${r.error}`);
        return;
      }
      state = r.state;
      commit('import_json');
      toast('备份已导入');
      location.hash = '#/dashboard';
    };
    reader.readAsText(file);
  }
});

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
