import { api } from './api.js';
import { classOccurrences, parseYmd } from '../../shared/schedule.js';

export const app = { st: null, notes: [], listeners: new Set() };

export async function refresh(keys) {
  app.st = await api.getState();
  if (!keys || keys.includes('notes')) app.notes = await api.listNotes();
  for (const fn of app.listeners) fn(keys);
}

export const onChange = (fn) => { app.listeners.add(fn); return () => app.listeners.delete(fn); };

export const course = (id) => (app.st.courses || []).find((c) => c.id === id);
export const courseForLms = (key) => (app.st.courses || []).find((c) => (c.lmsKeys || []).includes(key));
export const visibleCourses = () => (app.st.courses || []).filter((c) => !c.hidden);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Everything dated between from and to, as display items:
 * { key, kind: 'class'|'due'|'event'|'reminder', tag, title, start, end, allDay, course, ... }
 */
export function buildItems(from, to) {
  const st = app.st;
  const out = [];
  const noClass = new Set(st.events.filter((e) => e.kind === 'no-class').map((e) => `${e.courseId}|${e.date}`));

  for (const o of classOccurrences(st.courses, st.settings.term, from, to)) {
    const c = course(o.courseId);
    out.push({
      key: o.key, kind: 'class', tag: o.meeting.kind || 'Class', title: c.code, sub: c.name, start: o.start, end: o.end, course: c,
      room: o.meeting.room, building: o.meeting.building, date: o.date, meetingIndex: Number(o.key.split(':')[2]),
      cancelled: o.cancelled || noClass.has(`${c.id}|${o.date}`),
    });
  }

  const seen = new Set();
  for (const a of st.lms.assignments || []) {
    if (!a.due) continue;
    const d = new Date(a.due);
    if (d < from || d > to) continue;
    seen.add(`${norm(a.title)}|${d.toISOString().slice(0, 16)}`);
    out.push({ key: a.key, kind: 'due', tag: a.source === 'canvas' ? 'Canvas' : 'Blackboard', title: a.title, start: d, course: courseForLms(a.courseKey), status: a.status, url: a.url, points: a.points, score: a.score, details: a.details, source: a.source });
  }
  for (const e of st.lms.events || []) {
    const d = new Date(e.start);
    if (d < from || d > to) continue;
    out.push({ key: e.key, kind: 'event', tag: 'Event', title: e.title, start: d, end: e.end ? new Date(e.end) : null, allDay: e.allDay, course: courseForLms(e.courseKey), location: e.location, url: e.url, source: e.source });
  }
  for (const [fid, f] of Object.entries(st.feeds || {})) {
    const feed = (st.settings.feeds || []).find((x) => x.id === fid);
    for (const it of f.items || []) {
      if (it.type !== 'ics' || !it.start) continue;
      const d = new Date(it.start);
      if (d < from || d > to) continue;
      if (seen.has(`${norm(it.title)}|${d.toISOString().slice(0, 16)}`)) continue;
      out.push({ key: it.key, kind: 'due', tag: feed ? feed.name : 'Feed', title: it.title, start: d, allDay: it.allDay, course: course(it.courseId), url: it.url, details: it.text, status: 'open' });
    }
  }
  for (const e of st.events || []) {
    const d = e.time ? new Date(`${e.date}T${e.time}`) : parseYmd(e.date);
    if (!d || d < from || d > to) continue;
    const deadline = ['exam', 'quiz', 'due'].includes(e.kind);
    out.push({ key: `ev:${e.id}`, kind: deadline ? 'due' : 'event', tag: e.kind, title: e.title, start: d, allDay: !e.time, course: course(e.courseId), note: e.note, event: e, soft: ['reading', 'topic'].includes(e.kind) });
  }
  for (const r of st.reminders || []) {
    const d = new Date(r.at);
    if (d < from || d > to) continue;
    out.push({ key: `rem:${r.id}`, kind: 'reminder', tag: 'Reminder', title: r.title, start: d, course: course(r.courseId), reminder: r, done: r.done });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function termWeek(now = new Date()) {
  const s = parseYmd(app.st.settings.term.start);
  const e = parseYmd(app.st.settings.term.end);
  if (!s) return '';
  const w = Math.floor((now - s) / (7 * 864e5)) + 1;
  const total = e ? Math.ceil((e - s + 864e5) / (7 * 864e5)) : null;
  if (w < 1) return `Term starts ${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  if (total && w > total) return 'Term ended';
  return `Week ${w}${total ? ` of ${total}` : ''}`;
}
