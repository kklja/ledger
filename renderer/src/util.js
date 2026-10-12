// DOM + date helpers shared by all views.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let value;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}

export function append(el, ...kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : String(k));
  }
  return el;
}

// Empties el; the returned .append skips null/false and flattens arrays (native append would print "null").
export const clear = (el) => { el.replaceChildren(); return { el, append: (...kids) => append(el, kids) }; };
export const rid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join('');

// ---- dates ----
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LETTER = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'];
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export function startOfWeek(d) { const s = startOfDay(d); const dow = (s.getDay() + 6) % 7; return addDays(s, -dow); } // Monday
export const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtLong = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtWhen = (d) => `${fmtDay(d)}, ${fmtTime(d)}`;
export function hm12(s) { if (!s) return ''; const [h, m] = s.split(':').map(Number); return fmtTime(new Date(2000, 0, 1, h, m)); }

export function rel(d, now = new Date()) {
  const ms = d - now;
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000); // round once, then split, so we never show "8h 60m"
  const hr = Math.floor(m / 60), dy = Math.floor(m / 1440);
  let s;
  if (m < 1) s = 'now';
  else if (m < 60) s = `${m} min`;
  else if (hr < 24) s = `${hr}h ${m % 60}m`;
  else if (dy < 7) s = `${dy}d ${Math.floor((m % 1440) / 60)}h`;
  else s = `${dy} days`;
  if (s === 'now') return s;
  return ms >= 0 ? `in ${s}` : `${s} ago`;
}

export function dayLabel(d, now = new Date()) {
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, addDays(now, 1))) return 'Tomorrow';
  if (sameDay(d, addDays(now, -1))) return 'Yesterday';
  return fmtDay(d);
}

// ---- toasts / modals ----
export function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3800);
}

export function modal(title, body, actions = [], opts = {}) {
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); opts.onClose && opts.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: `modal ${opts.class || ''}`, style: opts.width ? { width: opts.width } : null },
    h('div', { class: 'mh' }, h('h2', null, title), h('button', { class: 'btn ghost sm', onclick: close }, 'Close')),
    h('div', { class: 'mb' }, body),
    actions.length ? h('div', { class: 'mf' }, actions.map((a) => h('button', { class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, onclick: async () => { if ((await a.onClick?.()) !== false) close(); } }, a.label))) : null);
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  return close;
}

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    let done = false;
    modal(title, h('div', null, text), [
      { label: 'Cancel', onClick: () => { done = true; res(false); } },
      { label: okLabel, primary: !danger, danger, onClick: () => { done = true; res(true); } },
    ], { width: '440px', onClose: () => { if (!done) res(false); } });
  });
}

// Very small Markdown -> DOM (headings, bullets, tables, bold, code). Text only, no HTML injection.
export function renderMarkdown(md) {
  const root = h('div', { class: 'md' });
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const inline = (s) => {
    const span = h('span');
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const p of parts) {
      if (/^\*\*[^*]+\*\*$/.test(p)) span.append(h('b', null, p.slice(2, -2)));
      else if (/^`[^`]+`$/.test(p)) span.append(h('code', null, p.slice(1, -1)));
      else span.append(p);
    }
    return span;
  };
  let list = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*[-*] /.test(l)) { if (!list) { list = h('ul'); root.append(list); } list.append(h('li', null, inline(l.replace(/^\s*[-*] /, '')))); continue; }
    list = null;
    if (/^#{1,3} /.test(l)) { root.append(h(`h${l.match(/^#+/)[0].length}`, null, inline(l.replace(/^#+ /, '')))); continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const t = h('table', null, h('tr', null, cells(l).map((c) => h('th', null, inline(c)))));
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) t.append(h('tr', null, cells(lines[i++]).map((c) => h('td', null, inline(c)))));
      i--;
      root.append(t);
      continue;
    }
    if (l.startsWith('```')) {
      const buf = [];
      while (++i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i]);
      root.append(h('pre', null, buf.join('\n')));
      continue;
    }
    if (l.trim()) root.append(h('p', { style: { margin: '4px 0' } }, inline(l)));
  }
  return root;
}
