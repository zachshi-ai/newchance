/**
 * ui.js — 渲染小工具（无业务逻辑）
 */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const STATUS_LABEL = { red: '逾期', yellow: '临期', green: '正常' };

export function badge(status) {
  const label = STATUS_LABEL[status] || '未填';
  const cls = ['red', 'yellow', 'green'].includes(status) ? status : 'gray';
  return `<span class="badge ${cls}"><span class="dot ${cls}"></span>${label}</span>`;
}

export function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast${isErr ? ' err' : ''}`;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2600);
}

export function download(filename, text, mime = 'text/html') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function printHtml(html) {
  const w = window.open('', '_blank');
  if (!w) { toast('浏览器拦截了打印窗口，请允许弹窗', true); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

/** 简单事件委托：监听 [data-act] 点击 */
export function onClick(root, handler) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    handler(btn.dataset.act, btn.dataset, btn, e);
  });
}
