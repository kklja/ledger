// "econ problem set fri 5pm" -> { title: 'problem set', courseId: <ECON 120>, at: Date }
import * as chrono from 'chrono-node';
import { h, clear, fmtWhen, rel, rid, toast } from './util.js';
import { app } from './state.js';
import { api } from './api.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matchCourse(text, courses) {
  const t = ` ${text.toLowerCase()} `;
  let best = null;
  for (const c of courses) {
    const code = c.code.toLowerCase();
    const [subj, num] = [code.split(/\s+/)[0], (code.match(/\d+[a-z]?/) || [''])[0]];
    const names = [code, code.replace(/\s+/g, ''), num && `${subj}${num}`, ...(c.aliases || '').toLowerCase().split(',').map((s) => s.trim())].filter(Boolean);
    for (const n of names) {
      const m = new RegExp(`(^|[^a-z0-9])(${esc(n)})(?![a-z0-9])`).exec(t);
      if (m && (!best || n.length > best.len)) best = { c, len: n.length, text: m[2] };
    }
    // bare subject ("econ") only counts when one course has it
    if (!best && courses.filter((x) => x.code.toLowerCase().startsWith(subj)).length === 1) {
      const m = new RegExp(`(^|[^a-z0-9])(${esc(subj)})(?![a-z0-9])`).exec(t);
      if (m) best = { c, len: subj.length, text: m[2] };
    }
  }
  return best;
}

export function parseQuick(text, courses) {
  const res = chrono.parse(text, new Date(), { forwardDate: true });
  let at = null;
  let title = text;
  if (res.length) {
    const r = res[0];
    at = r.start.date();
    if (!r.start.isCertain('hour')) at.setHours(9, 0, 0, 0);
    title = text.slice(0, r.index) + ' ' + text.slice(r.index + r.text.length);
  }
  const cm = matchCourse(title, courses);
  title = title
    .replace(/^\s*(remind me (to|about)|remind me|reminder:?|remind)\s+/i, '')
    .replace(/\s+(at|on|by|due)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { title: title || text.trim(), at, courseId: cm ? cm.c.id : '' };
}

export async function addReminder({ title, at, courseId }) {
  const r = { id: rid(), title, at: at.toISOString(), courseId: courseId || '', done: false, notified: at < new Date(), created: new Date().toISOString() };
  await api.saveReminders([...app.st.reminders, r]);
  toast(`Reminder set · ${fmtWhen(at)}`, 'ok');
  return r;
}

export function quickAddBox() {
  const preview = h('div', { class: 'preview', style: { display: 'none' } });
  const input = h('input', { placeholder: 'Add a reminder — e.g. "econ problem set fri 5pm"  (Ctrl+K)', spellcheck: 'false' });
  const render = () => {
    const v = input.value.trim();
    if (!v) { preview.style.display = 'none'; return; }
    const p = parseQuick(v, app.st.courses);
    const c = app.st.courses.find((x) => x.id === p.courseId);
    clear(preview).append(
      p.at
        ? h('div', null, h('b', null, p.title), c ? h('span', { class: 'chip', style: { '--c': c.color, marginLeft: '10px' } }, c.code) : null,
            h('span', { class: 'muted', style: { marginLeft: '10px' } }, `${fmtWhen(p.at)} · ${rel(p.at)}`), h('span', { class: 'faint', style: { float: 'right' } }, 'Enter to save'))
        : h('div', { class: 'muted' }, 'Add a time — e.g. "tomorrow 5pm", "fri 9am", "in 2 hours", "oct 20"'),
    );
    preview.style.display = 'block';
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => (preview.style.display = 'none'), 150));
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { input.value = ''; input.blur(); }
    if (e.key !== 'Enter') return;
    const p = parseQuick(input.value, app.st.courses);
    if (!p.at) { toast('Add a time, e.g. "fri 5pm"', 'bad'); return; }
    await addReminder(p);
    input.value = '';
    render();
  });
  return { el: h('div', { class: 'quick' }, input, preview), input };
}
