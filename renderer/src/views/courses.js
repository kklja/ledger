import { api } from '../api.js';
import { app } from '../state.js';
import { h, clear, rid, toast, confirmBox, modal, DAY_LETTER, hm12 } from '../util.js';
import { watchRun } from './shared.js';
import { go } from '../nav.js';

const COLORS = ['#4cc2ff', '#6ccb5f', '#ffb454', '#c58cff', '#ff7a85', '#3ed6c6', '#f7d046', '#8fa3ff'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
let saveT = null;
let draft = null;

function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => api.saveCourses(draft), 400);
}

export function mount(el) {
  const render = () => {
    draft = structuredClone(app.st.courses);
    const top = el.scrollTop;
    clear(el).append(page(render));
    el.scrollTop = top;
  };
  render();
  return {
    update: (keys) => {
      const a = document.activeElement;
      const typing = el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
      if (!typing && (!keys || keys.some((k) => ['courses', 'settings'].includes(k)))) render();
    },
    destroy: () => { if (saveT) { clearTimeout(saveT); api.saveCourses(draft); } },
  };
}

function page(render) {
  const st = app.st;
  const p = h('div', { class: 'page', style: { maxWidth: '1100px' } });
  p.append(h('div', { class: 'pagehead' },
    h('div', null, h('h1', null, 'Classes'), h('div', { class: 'sub' }, 'Times, buildings and rooms drive the Today screen, the calendar and "class in 10 min" alerts.')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => importDialog(render) }, 'Import schedule with AI'),
      h('button', { class: 'btn primary', onclick: () => { draft.push({ id: rid(), code: 'NEW 101', name: '', color: COLORS[draft.length % COLORS.length], instructor: '', aliases: '', meetings: [{ days: [], start: '09:00', end: '09:50', building: '', room: '', kind: 'Lecture' }], lmsKeys: [], cancelled: [] }); api.saveCourses(draft); } }, 'Add class'))));

  const term = st.settings.term;
  p.append(h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Term')), h('div', { class: 'pb row wrap' },
    h('span', { class: 'muted' }, 'Classes meet from'), h('input', { type: 'date', class: 'in', value: term.start, onchange: (e) => api.updateSettings({ term: { start: e.target.value } }) }),
    h('span', { class: 'muted' }, 'to'), h('input', { type: 'date', class: 'in', value: term.end, onchange: (e) => api.updateSettings({ term: { end: e.target.value } }) }),
    h('span', { class: 'faint small' }, 'Leave empty to show classes every week. Cancel a single class from the calendar (click it).'))));

  if (!draft.length) p.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No classes yet. They are created automatically after the first Canvas/Blackboard check, or add them here.')));

  draft.forEach((c) => {
    const meetings = h('div');
    const drawMeetings = () => {
      clear(meetings);
      (c.meetings || []).forEach((m, i) => {
        const days = h('div', { class: 'days' }, DAY_ORDER.map((d) => h('button', { class: (m.days || []).includes(d) ? 'on' : '', title: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d], onclick: (e) => {
          const set = new Set(m.days || []);
          set.has(d) ? set.delete(d) : set.add(d);
          m.days = [...set].sort();
          e.currentTarget.classList.toggle('on');
          save();
        } }, DAY_LETTER[d])));
        meetings.append(h('div', { class: 'meet' }, days,
          h('input', { type: 'time', class: 'in', value: m.start, title: 'Start', onchange: (e) => { m.start = e.target.value; save(); } }),
          h('input', { type: 'time', class: 'in', value: m.end, title: 'End', onchange: (e) => { m.end = e.target.value; save(); } }),
          h('input', { class: 'in', value: m.building || '', placeholder: 'Building', oninput: (e) => { m.building = e.target.value; save(); } }),
          h('input', { class: 'in', value: m.room || '', placeholder: 'Room', oninput: (e) => { m.room = e.target.value; save(); } }),
          h('select', { class: 'in', value: m.kind || 'Lecture', onchange: (e) => { m.kind = e.target.value; save(); } }, ['Lecture', 'Lab', 'Discussion', 'Recitation', 'Seminar', 'Exam', 'Online'].map((k) => h('option', { value: k }, k))),
          h('button', { class: 'btn ghost sm', title: 'Remove', onclick: () => { c.meetings.splice(i, 1); save(); drawMeetings(); } }, '✕')));
      });
      meetings.append(h('button', { class: 'btn sm', style: { marginTop: '8px' }, onclick: () => { (c.meetings = c.meetings || []).push({ days: [], start: '09:00', end: '09:50', building: '', room: '', kind: 'Lecture' }); save(); drawMeetings(); } }, '+ Meeting time'));
    };
    drawMeetings();
    const links = (c.lmsKeys || []).map((k) => { const lc = (st.lms.courses || []).find((x) => x.key === k); return h('span', { class: 'tag', style: { color: 'var(--muted)', marginRight: '4px' }, title: k }, `${k.split(':')[0]}${lc ? `: ${lc.code || lc.name}` : ''}`); });

    p.append(h('div', { class: 'course-row', style: { '--c': c.color, opacity: c.hidden ? 0.6 : 1 } }, h('div', { class: 'sw' }),
      h('div', { class: 'cb' },
        h('div', { class: 'row wrap' },
          h('input', { type: 'color', value: c.color, title: 'Color', style: { width: '28px', height: '28px', padding: 0, border: '1px solid var(--line)' }, onchange: (e) => { c.color = e.target.value; api.saveCourses(draft); } }),
          h('input', { class: 'in', style: { width: '120px', fontWeight: 700 }, value: c.code, placeholder: 'ECON 120', oninput: (e) => { c.code = e.target.value; save(); } }),
          h('input', { class: 'in grow', value: c.name || '', placeholder: 'Course name', oninput: (e) => { c.name = e.target.value; save(); } }),
          h('input', { class: 'in', style: { width: '170px' }, value: c.instructor || '', placeholder: 'Instructor', oninput: (e) => { c.instructor = e.target.value; save(); } }),
          h('input', { class: 'in', style: { width: '150px' }, value: c.aliases || '', placeholder: 'Nicknames: macro, econ', title: 'Words you use for this class in quick reminders', oninput: (e) => { c.aliases = e.target.value; save(); } })),
        meetings,
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('span', { class: 'faint small' }, 'Linked:'), links.length ? links : h('span', { class: 'faint small' }, 'not linked to Canvas/Blackboard'),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn sm', onclick: () => go('notes', { newNote: true, courseId: c.id }) }, 'New note'),
          h('button', { class: 'btn sm', onclick: () => api.openCourseFiles(c.id), title: 'Put syllabus PDFs, slides etc. here for the AI' }, 'Files folder'),
          h('button', { class: 'btn sm', onclick: () => { c.hidden = !c.hidden; api.saveCourses(draft); } }, c.hidden ? 'Unhide' : 'Hide'),
          h('button', { class: 'btn sm danger', onclick: async () => {
            if (!(await confirmBox(`Remove ${c.code}?`, 'Notes stay (they become Unfiled). If this came from Canvas/Blackboard it will not be re-added.', 'Remove', true))) return;
            for (const k of c.lmsKeys || []) await api.ignoreLmsCourse(k);
            draft = draft.filter((x) => x.id !== c.id);
            api.saveCourses(draft);
          } }, 'Remove')))));
  });
  return p;
}

function parseDays(s) {
  const map = { M: 1, T: 2, W: 3, R: 4, F: 5, S: 6, U: 0 };
  const norm = String(s || '').replace(/Th|Thu|Thurs/gi, 'R').replace(/Su|Sun/gi, 'U').replace(/Sa|Sat/gi, 'S').replace(/Mon/gi, 'M').replace(/Tue|Tues/gi, 'T').replace(/Wed/gi, 'W').replace(/Fri/gi, 'F').toUpperCase();
  return [...new Set([...norm].map((ch) => map[ch]).filter((d) => d != null))].sort();
}

function importDialog(render) {
  const ta = h('textarea', { class: 'in', rows: 12, style: { width: '100%' }, placeholder: 'Paste your schedule here — copy the whole "My Schedule / Class Schedule" page from your registration portal. Messy is fine.' });
  modal('Import schedule with AI', h('div', null, h('p', { class: 'muted', style: { marginTop: 0 } }, 'The AI turns it into classes with days, times, buildings and rooms. You review before anything is saved.'), ta), [
    { label: 'Cancel' },
    { label: 'Import', primary: true, onClick: () => {
      if (!ta.value.trim()) { toast('Paste your schedule first', 'bad'); return false; }
      api.aiRun('importSchedule', { text: ta.value.slice(0, 20000) }).then((id) => watchRun(id, 'Reading your schedule', (run) => preview(run.result.data, render))).catch((e) => toast(e.message, 'bad'));
    } },
  ], { width: '760px' });
}

function preview(data, render) {
  const courses = (data.courses || []).map((c) => ({ ...c, meetings: (c.meetings || []).map((m) => ({ ...m, days: parseDays(m.days) })) }));
  const t = h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Class'), h('th', null, 'Meets'), h('th', null, 'Where')));
  for (const c of courses) {
    t.append(h('tr', null, h('td', null, h('b', null, c.code), h('div', { class: 'muted small' }, `${c.name || ''}${c.instructor ? ` · ${c.instructor}` : ''}`)),
      h('td', null, c.meetings.length ? c.meetings.map((m) => h('div', null, `${m.days.map((d) => DAY_LETTER[d]).join('')} ${hm12(m.start)}–${hm12(m.end)}${m.kind && m.kind !== 'Lecture' ? ` (${m.kind})` : ''}`)) : h('span', { class: 'faint' }, 'Online / no set time')),
      h('td', null, c.meetings.map((m) => h('div', null, [m.building, m.room].filter(Boolean).join(' · ') || '—')))));
  }
  modal('Review imported schedule', h('div', null, data.term && (data.term.start || data.term.end) ? h('p', null, `Term: ${data.term.start || '?'} → ${data.term.end || '?'}`) : null, t), [
    { label: 'Cancel' },
    { label: 'Save classes', primary: true, onClick: async () => {
      const key = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const next = structuredClone(app.st.courses);
      for (const c of courses) {
        const existing = next.find((x) => key(x.code) === key(c.code));
        if (existing) Object.assign(existing, { name: existing.name || c.name, instructor: c.instructor || existing.instructor, meetings: c.meetings });
        else next.push({ id: rid(), code: c.code, name: c.name || '', instructor: c.instructor || '', aliases: '', color: COLORS[next.length % COLORS.length], meetings: c.meetings, lmsKeys: [], cancelled: [] });
      }
      await api.saveCourses(next);
      if (data.term && (data.term.start || data.term.end)) await api.updateSettings({ term: { start: data.term.start || app.st.settings.term.start, end: data.term.end || app.st.settings.term.end } });
      toast(`Saved ${courses.length} classes`, 'ok');
      setTimeout(render, 300);
    } },
  ], { width: '820px' });
}
