// Pieces used by more than one view: item details popover, schedule-change review, AI run watcher.
import { api } from '../api.js';
import { app, course } from '../state.js';
import { h, append, fmtWhen, fmtTime, fmtDay, rel, modal, toast, renderMarkdown, rid } from '../util.js';
import { go } from '../nav.js';

let openPop = null;
export function closePopover() { if (openPop) { openPop.remove(); openPop = null; } }
document.addEventListener('mousedown', (e) => { if (openPop && !openPop.contains(e.target)) closePopover(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });

export function itemPopover(item, x, y) {
  closePopover();
  const st = app.st;
  const c = item.course;
  const body = h('div', { class: 'pb' });
  const foot = h('div', { class: 'pf' });
  const line = (k, v) => (v ? h('div', { class: 'row', style: { alignItems: 'flex-start', marginBottom: '4px' } }, h('span', { class: 'muted', style: { width: '74px', flex: 'none' } }, k), h('span', null, v)) : null);

  if (item.kind === 'class') {
    append(body,line('When', `${fmtDay(item.start)} · ${fmtTime(item.start)}–${fmtTime(item.end)}`), line('Where', [item.building, item.room].filter(Boolean).join(' · ') || 'No room set'), line('Type', item.tag), line('Instructor', c.instructor));
    if (item.cancelled) body.append(h('div', { class: 'danger-t', style: { fontWeight: 600 } }, 'Cancelled this day'));
    foot.append(h('button', { class: 'btn sm', onclick: async () => {
      const list = new Set(c.cancelled || []);
      list.has(item.date) ? list.delete(item.date) : list.add(item.date);
      await api.saveCourses(st.courses.map((x) => (x.id === c.id ? { ...x, cancelled: [...list] } : x)));
      closePopover();
    } }, (c.cancelled || []).includes(item.date) ? 'Un-cancel' : 'Mark cancelled'),
    h('button', { class: 'btn sm', onclick: () => { closePopover(); go('notes', { newNote: true, courseId: c.id }); } }, 'Take notes'));
  } else if (item.kind === 'reminder') {
    const r = item.reminder;
    append(body,line('When', `${fmtWhen(item.start)} (${rel(item.start)})`));
    foot.append(
      h('button', { class: 'btn sm danger', onclick: async () => { await api.saveReminders(st.reminders.filter((x) => x.id !== r.id)); closePopover(); } }, 'Delete'),
      h('button', { class: 'btn sm', onclick: async () => { await api.saveReminders(st.reminders.map((x) => (x.id === r.id ? { ...x, at: new Date(Date.parse(x.at) + 864e5).toISOString(), notified: false } : x))); closePopover(); } }, '+1 day'),
      h('button', { class: 'btn sm primary', onclick: async () => { await api.saveReminders(st.reminders.map((x) => (x.id === r.id ? { ...x, done: !x.done } : x))); closePopover(); } }, r.done ? 'Not done' : 'Done'));
  } else {
    append(body,
      line('When', `${item.allDay ? fmtDay(item.start) : fmtWhen(item.start)} · ${rel(item.start)}`),
      line('Source', item.tag),
      item.status ? line('Status', h('span', { class: `st-${item.status}` }, item.status + (item.score ? ` · ${item.score}` : ''))) : null,
      item.points != null ? line('Points', String(item.points)) : null,
      line('Where', item.location),
      item.note ? line('Note', item.note) : null,
      item.details ? h('div', { class: 'small muted', style: { marginTop: '6px', maxHeight: '120px', overflow: 'auto', whiteSpace: 'pre-wrap' } }, item.details) : null);
    const remind = h('button', { class: 'btn sm', onclick: async () => {
      const at = new Date(item.start.getTime() - (item.allDay ? -9 * 3600e3 + 864e5 : 864e5));
      await api.saveReminders([...st.reminders, { id: rid(), title: `${c ? `${c.code}: ` : ''}${item.title}`, at: at.toISOString(), courseId: c ? c.id : '', done: false, notified: false }]);
      toast(`Reminder set for ${fmtWhen(at)}`, 'ok');
      closePopover();
    } }, 'Remind me a day before');
    foot.append(remind);
    if (item.event && item.event.source !== 'syllabus') foot.append(h('button', { class: 'btn sm danger', onclick: async () => { await api.saveEvents(st.events.filter((e) => e.id !== item.event.id)); closePopover(); } }, 'Delete'));
    if (item.url) foot.append(h('button', { class: 'btn sm primary', onclick: () => api.openExternal(item.url) }, 'Open'));
  }

  const pop = h('div', { class: 'popover', style: { '--c': c ? c.color : 'var(--accent)' } },
    h('div', { class: 'ph' }, h('div', { class: 'small muted' }, [c && c.code, item.kind === 'due' ? 'Deadline' : item.tag].filter(Boolean).join(' · ')), h('div', { style: { fontWeight: 600, fontSize: '14px' } }, item.title)),
    body, foot);
  document.body.append(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.min(x, innerWidth - r.width - 12)}px`;
  pop.style.top = `${Math.min(y, innerHeight - r.height - 12)}px`;
  openPop = pop;
}

export function reviewPending(p) {
  const c = course(p.courseId);
  const fmt = (e) => `${e.date}${e.time ? ` ${e.time}` : ''} · ${e.title}${e.note ? ` — ${e.note}` : ''}`;
  const body = h('div', { class: 'diff' },
    h('p', { class: 'muted', style: { marginTop: 0 } }, `The AI re-read ${c ? c.code : 'this course'}'s syllabus${p.reason === 'auto' ? ' after a new announcement/syllabus change' : ''}. Approve to update your calendar.`),
    p.changed.length ? h('h3', null, 'Moved') : null, p.changed.map((x) => h('div', { class: 'mov' }, `${x.to.title}: ${x.from.date}${x.from.time ? ` ${x.from.time}` : ''} → ${x.to.date}${x.to.time ? ` ${x.to.time}` : ''}${x.to.note ? ` (${x.to.note})` : ''}`)),
    p.added.length ? h('h3', null, 'New') : null, p.added.map((x) => h('div', { class: 'add' }, `+ ${fmt(x)}`)),
    p.removed.length ? h('h3', null, 'Removed') : null, p.removed.map((x) => h('div', { class: 'del' }, fmt(x))),
  );
  modal(`${c ? c.code : ''} schedule update`, body, [
    { label: 'Dismiss', onClick: () => api.resolvePending(p.id, false) },
    { label: 'Apply to calendar', primary: true, onClick: async () => { await api.resolvePending(p.id, true); toast('Calendar updated', 'ok'); } },
  ]);
}

// Shows a live log while an AI run works; calls onDone(run) at the end.
export function watchRun(id, title, onDone) {
  const log = h('div', { class: 'log' }, '');
  const status = h('div', { class: 'muted', style: { marginBottom: '8px' } }, 'Working… (this uses your subscription; big tasks can take a few minutes)');
  let closed = false;
  const close = modal(title, h('div', null, status, log), [{ label: 'Run in background', onClick: () => { closed = true; } }, { label: 'Cancel', danger: true, onClick: () => { api.aiCancel(id); closed = true; } }], { onClose: () => { closed = true; off1(); } });
  const off1 = api.on('ai:log', (m) => { if (m.id === id) { log.append(m.text); log.scrollTop = log.scrollHeight; } });
  const off2 = api.on('ai:done', async (m) => {
    if (m.id !== id) return;
    off1(); off2();
    const run = await api.aiGet(id);
    if (!closed) close();
    if (run.status === 'error') toast(`${title} failed: ${run.error.slice(0, 200)}`, 'bad');
    else onDone && onDone(run);
  });
}

export function showAnswer(title, text) {
  modal(title, renderMarkdown(text), [{ label: 'Save as note', onClick: () => go('notes', { newNote: true, text, title }) }], { width: '820px' });
}
