import { api } from '../api.js';
import { app, buildItems, course, termWeek } from '../state.js';
import { h, clear, fmtTime, fmtLong, fmtDay, fmtWhen, rel, dayLabel, addDays, startOfDay, toast, modal } from '../util.js';
import { go } from '../nav.js';
import { reviewPending } from './shared.js';

export function mount(el) {
  const render = () => {
    const top = el.scrollTop;
    clear(el).append(page());
    el.scrollTop = top;
  };
  render();
  const timer = setInterval(render, 30000);
  return { update: render, destroy: () => clearInterval(timer) };
}

const where = (i) => [i.building, i.room && (i.building ? `Room ${i.room}` : i.room)].filter(Boolean).join(' · ') || 'No room set';
const chip = (c) => (c ? h('span', { class: 'chip', style: { '--c': c.color } }, c.code) : h('span', { class: 'faint' }, '—'));

function page() {
  const st = app.st;
  const now = new Date();
  const today0 = startOfDay(now);
  const items = buildItems(addDays(today0, -7), addDays(today0, 15));
  const classesToday = items.filter((i) => i.kind === 'class' && i.start >= today0 && i.start < addDays(today0, 1));
  const live = classesToday.filter((c) => !c.cancelled);
  const current = live.find((c) => c.start <= now && c.end > now);
  const next = live.find((c) => c.start > now) || items.find((i) => i.kind === 'class' && !i.cancelled && i.start > now);

  const p = h('div', { class: 'page' });
  p.append(h('div', { class: 'pagehead' },
    h('div', null, h('h1', null, fmtLong(now)), h('div', { class: 'sub' }, [termWeek(now), `${live.length} class${live.length === 1 ? '' : 'es'} today`].filter(Boolean).join(' · '))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => go('calendar') }, 'Week view'), h('button', { class: 'btn', onclick: () => go('notes', { newNote: true }) }, 'New note'))));

  if (!st.courses.length) p.append(onboarding());

  for (const pend of st.pending || []) {
    const c = course(pend.courseId);
    p.append(h('div', { class: 'banner warn' },
      h('div', { class: 'grow' }, h('b', null, `${c ? c.code : 'Course'} schedule update`), h('span', { class: 'muted' }, ` — ${pend.changed.length} moved · ${pend.added.length} new · ${pend.removed.length} removed (from ${pend.reason === 'auto' ? 'a new announcement/syllabus' : 'syllabus mapping'})`)),
      h('button', { class: 'btn primary sm', onclick: () => reviewPending(pend) }, 'Review')));
  }
  if (st.status.lastError) p.append(h('div', { class: 'banner bad' }, h('div', { class: 'grow' }, h('b', null, 'Coursework check: '), st.status.lastError), h('button', { class: 'btn sm', onclick: () => go('coursework') }, 'Open')));

  // Now / next card
  const focus = current || next;
  if (focus) {
    const isNow = focus === current;
    const isToday = focus.start < addDays(today0, 1);
    p.append(h('div', { class: 'nowcard', style: { '--c': focus.course.color } },
      h('div', { class: 'bar' }),
      h('div', { class: 'body' },
        h('div', { class: 'lbl' }, isNow ? `Now · until ${fmtTime(focus.end)}` : `Next · ${isToday ? '' : `${dayLabel(focus.start)} · `}${fmtTime(focus.start)}–${fmtTime(focus.end)}`),
        h('div', { class: 'title' }, `${focus.course.code} — ${focus.course.name || ''}`),
        h('div', { class: 'where' }, where(focus)),
        h('div', { class: 'muted', style: { marginTop: '4px' } }, [focus.tag, focus.course.instructor].filter(Boolean).join(' · '))),
      h('div', { class: 'side' }, h('div', { class: 'big' }, isNow ? rel(focus.end, now).replace('in ', '') : rel(focus.start, now).replace('in ', '')), h('div', { class: 'muted small' }, isNow ? 'left in class' : 'until it starts'))));
  }

  const left = h('div');
  const right = h('div');
  p.append(h('div', { class: 'cols' }, left, right));

  // Today's classes
  const list = h('div', { class: 'daylist' });
  if (!classesToday.length) list.append(h('div', { class: 'empty' }, st.courses.some((c) => (c.meetings || []).length) ? 'No classes today.' : 'Add your class times and rooms under Classes.'));
  for (const c of classesToday) {
    const state = c.cancelled ? 'cancelled' : c.end <= now ? 'past' : c.start <= now ? 'now' : '';
    list.append(h('div', { class: `cls ${state}` },
      h('div', { class: 't' }, `${fmtTime(c.start)} – ${fmtTime(c.end)}`),
      h('div', { class: 'sw', style: { '--c': c.course.color } }),
      h('div', { class: 'name' }, h('b', null, c.course.code), h('span', { class: 'muted' }, ` ${c.course.name || ''}`), c.cancelled ? h('span', { class: 'tag danger-t', style: { marginLeft: '8px' } }, 'CANCELLED') : null, c.tag && c.tag !== 'Lecture' ? h('span', { class: 'tag', style: { marginLeft: '8px', color: 'var(--muted)' } }, c.tag) : null),
      h('div', { class: 'room' }, where(c))));
  }
  left.append(panel("Today's classes", list, h('button', { class: 'btn ghost sm', onclick: () => go('courses') }, 'Edit')));

  // Due soon
  const dueWindow = items.filter((i) => i.kind === 'due' && i.start >= addDays(today0, -3) && i.start <= addDays(now, 8) && !(i.start < now && ['submitted', 'graded'].includes(i.status)));
  const tbl = h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Due'), h('th', null, 'Class'), h('th', null, 'Item'), h('th', null, 'Status')));
  for (const d of dueWindow) {
    const overdue = d.start < now && !['submitted', 'graded'].includes(d.status);
    const status = overdue ? 'overdue' : d.status || 'open';
    tbl.append(h('tr', { class: 'click', onclick: () => (d.url ? api.openExternal(d.url) : null), title: d.details || '' },
      h('td', { class: 'nowrap' }, h('div', { style: { fontWeight: 600 } }, `${dayLabel(d.start)} ${d.allDay ? '' : fmtTime(d.start)}`), h('div', { class: `small ${overdue ? 'danger-t' : 'faint'}` }, rel(d.start, now))),
      h('td', { class: 'nowrap' }, chip(d.course)),
      h('td', null, d.title, h('div', { class: 'faint small' }, [d.tag, d.points != null ? `${d.points} pts` : ''].filter(Boolean).join(' · '))),
      h('td', { class: `nowrap st-${status}` }, status === 'graded' && d.score ? `graded ${d.score}` : status)));
  }
  left.append(panel('Due in the next 7 days', dueWindow.length ? tbl : h('div', { class: 'empty' }, st.lms.lastCheck ? 'Nothing due. Nice.' : 'Set up Canvas/Blackboard so the AI can find your assignments.'), h('button', { class: 'btn ghost sm', onclick: () => go('coursework') }, 'All coursework'), true));

  // Reminders
  const rems = (st.reminders || []).filter((r) => !r.done || Date.parse(r.at) > now - 864e5).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 12);
  const rl = h('div');
  for (const r of rems) {
    const t = new Date(r.at);
    rl.append(h('div', { class: `rem ${r.done ? 'done' : ''}` },
      h('input', { type: 'checkbox', checked: r.done, onchange: (e) => api.saveReminders(st.reminders.map((x) => (x.id === r.id ? { ...x, done: e.target.checked } : x))) }),
      h('div', { class: 'rt' }, r.title, r.courseId ? h('span', null, ' ', chip(course(r.courseId))) : null),
      h('div', { class: `when ${!r.done && t < now ? 'late' : ''}` }, `${dayLabel(t)} ${fmtTime(t)}`),
      h('button', { class: 'btn ghost sm', title: 'Delete', onclick: () => api.saveReminders(st.reminders.filter((x) => x.id !== r.id)) }, '✕')));
  }
  if (!rems.length) rl.append(h('div', { class: 'empty' }, 'Type in the box at the top: "econ hw fri 5pm"'));
  right.append(panel('Reminders', rl, h('span', { class: 'faint small' }, 'Ctrl+K to add')));

  // Coming up (exams etc. from syllabus mapping)
  const big = items.filter((i) => ['exam', 'quiz'].includes(i.tag) && i.start >= today0).slice(0, 5);
  if (big.length) {
    const bl = h('div');
    for (const b of big) bl.append(h('div', { class: 'act' }, h('div', null, chip(b.course), ' ', h('b', null, b.title)), h('div', { class: 'meta' }, `${fmtWhen(b.start)} · ${rel(b.start, now)}`)));
    right.append(panel('Exams & quizzes', bl));
  }

  // Activity
  const acts = (st.activity || []).filter((a) => Date.parse(a.at) > now - 7 * 864e5).slice(0, 10);
  const al = h('div');
  for (const a of acts) al.append(h('div', { class: 'act' }, h('div', null, a.text), h('div', { class: 'meta' }, [course(a.courseId)?.code, a.source, rel(new Date(a.at), now)].filter(Boolean).join(' · '))));
  if (!acts.length) al.append(h('div', { class: 'empty' }, 'Changes the AI finds (new assignments, moved due dates, announcements) show up here.'));
  right.append(panel('What changed this week', al, h('button', { class: 'btn ghost sm', onclick: () => go('coursework', { tab: 'changes' }) }, 'All')));

  const unused = (st.inbox || []).filter((x) => !x.used).length;
  if (unused) right.append(h('div', { class: 'banner' }, h('div', { class: 'grow' }, `${unused} image${unused > 1 ? 's' : ''} from your phone waiting`), h('button', { class: 'btn sm', onclick: () => go('notes', { inbox: true }) }, 'Open')));
  return p;
}

function panel(title, body, action) {
  return h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, title), action || null), h('div', { class: 'pb flush' }, body));
}

function onboarding() {
  const st = app.st;
  const L = st.settings.lms;
  return h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Set up Ledger (5 minutes)')), h('div', { class: 'pb flush steps' },
    h('div', { class: L.canvasUrl || L.blackboardUrl ? 'done' : '' }, h('b', null, 'Add your Canvas and Blackboard addresses'), h('div', { class: 'muted small' }, 'Settings → Coursework.'), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => go('settings') }, 'Open Settings')),
    h('div', { class: st.lms.lastCheck ? 'done' : '' }, h('b', null, 'Sign in once, then let the AI check'), h('div', { class: 'muted small' }, 'Coursework → "Sign in to school sites" opens Edge with Ledger\'s own profile. Log in (incl. Duo), close it, then press "Check now". Your classes are created automatically.'), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => go('coursework') }, 'Open Coursework')),
    h('div', { class: st.courses.some((c) => (c.meetings || []).length) ? 'done' : '' }, h('b', null, 'Add class times, buildings and rooms'), h('div', { class: 'muted small' }, 'Classes → paste your schedule from the registration portal and let the AI fill it in.'), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => go('courses') }, 'Open Classes')),
    h('div', null, h('b', null, 'Pair your iPhone for screenshots'), h('div', { class: 'muted small' }, 'Settings → iPhone: scan the QR code with your camera.')),
  ));
}
