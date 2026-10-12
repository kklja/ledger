'use strict';
// Writes <data>/ai-context: a read-only snapshot of courses, coursework, syllabi and
// notes that the AI CLIs read before answering. The courses/<CODE>/files folders are
// never touched, so you can drop syllabus PDFs or slides there yourself.

const fs = require('fs');
const path = require('path');
const { noteToMarkdown } = require('../shared/notes-md');

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const safe = (s) => String(s || 'Course').replace(/[\\/:*?"<>|]/g, '-').trim();
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'no date');

function courseDir(root, course) { return path.join(root, 'courses', safe(course.code || course.name)); }

function writeContext(store, S) {
  const root = store.file('ai-context');
  const courses = S.courses || [];
  const lms = S.lms || {};
  const keysOf = (c) => new Set(c.lmsKeys || []);
  const courseFor = (key) => courses.find((c) => keysOf(c).has(key));

  const readme = [
    '# Student data for Ledger AI tasks',
    `Exported ${new Date().toString()}`,
    '',
    'Folders: courses/<CODE>/ with course.md, assignments.md, announcements.md, syllabus.md, schedule.md, notes/, files/ (files/ holds documents the student added).',
    'calendar.md lists everything dated in the next 60 days.',
    `Canvas: ${S.settings.lms.canvasUrl || 'not set'} · Blackboard: ${S.settings.lms.blackboardUrl || 'not set'}`,
    `Last coursework check: ${when(lms.lastCheck)}`,
    '',
    '## Courses',
    ...courses.map((c) => `- ${c.code} — ${c.name || ''}`),
  ];
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), readme.join('\n'));

  const notes = store.listNotes().map((n) => store.getNote(n.id)).filter(Boolean);

  for (const c of courses) {
    const dir = courseDir(root, c);
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    const keys = keysOf(c);
    const meet = (c.meetings || []).map((m) => `- ${(m.days || []).map((d) => DAY[d]).join('/')} ${m.start}–${m.end} · ${m.building || ''} ${m.room || ''} ${m.kind ? `(${m.kind})` : ''}`);
    fs.writeFileSync(path.join(dir, 'course.md'), [`# ${c.code} — ${c.name || ''}`, c.instructor ? `Instructor: ${c.instructor}` : '', '', '## Meetings', ...meet].join('\n'));

    const asg = (lms.assignments || []).filter((a) => keys.has(a.courseKey)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
    fs.writeFileSync(path.join(dir, 'assignments.md'), [`# ${c.code} assignments`, '', ...asg.map((a) =>
      `## ${a.title}\n- Due: ${when(a.due)}\n- Status: ${a.status}${a.score ? ` (score ${a.score})` : ''}${a.points != null ? `\n- Points: ${a.points}` : ''}\n- Source: ${a.source} ${a.url}\n${a.details ? `\n${a.details}\n` : ''}`)].join('\n'));

    const ann = (lms.announcements || []).filter((a) => keys.has(a.courseKey)).sort((a, b) => (b.posted || '').localeCompare(a.posted || ''));
    fs.writeFileSync(path.join(dir, 'announcements.md'), [`# ${c.code} announcements (newest first)`, '', ...ann.map((a) => `## ${a.title}\nPosted ${when(a.posted)} by ${a.author || '?'} · ${a.url}\n\n${a.text}\n`)].join('\n'));

    const syl = [...keys].map((k) => lms.syllabi && lms.syllabi[k]).filter(Boolean);
    fs.writeFileSync(path.join(dir, 'syllabus.md'), syl.length ? syl.map((s) => `# Syllabus (fetched ${when(s.fetched)}) ${s.url}\n\n${s.text}`).join('\n\n') : '# Syllabus\n\nNot fetched yet. Check files/ or open the course site.');

    const sched = (S.events || []).filter((e) => e.courseId === c.id).sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(path.join(dir, 'schedule.md'), [`# ${c.code} dated schedule currently in Ledger`, '', ...sched.map((e) => `- ${e.date}${e.time ? ` ${e.time}` : ''} [${e.kind}] ${e.title}${e.note ? ` — ${e.note}` : ''}`)].join('\n'));

    const ndir = path.join(dir, 'notes');
    fs.rmSync(ndir, { recursive: true, force: true });
    fs.mkdirSync(ndir, { recursive: true });
    for (const n of notes.filter((x) => x.courseId === c.id)) {
      fs.writeFileSync(path.join(ndir, `${safe(n.title).slice(0, 80)} (${n.id}).md`), noteToMarkdown(n, store.file('images').replace(/\\/g, '/')));
    }
  }

  const loose = notes.filter((n) => !courses.some((c) => c.id === n.courseId));
  const ldir = path.join(root, 'unfiled-notes');
  fs.rmSync(ldir, { recursive: true, force: true });
  fs.mkdirSync(ldir, { recursive: true });
  for (const n of loose) fs.writeFileSync(path.join(ldir, `${safe(n.title).slice(0, 80)} (${n.id}).md`), noteToMarkdown(n, store.file('images').replace(/\\/g, '/')));

  // calendar.md: next 60 days of everything dated
  const now = Date.now(), horizon = now + 60 * 864e5;
  const rows = [];
  const label = (key) => { const c = courseFor(key); return c ? c.code : ''; };
  for (const a of lms.assignments || []) if (a.due && Date.parse(a.due) >= now - 864e5 && Date.parse(a.due) <= horizon) rows.push([a.due, `DUE ${label(a.courseKey)} ${a.title} (${a.status})`]);
  for (const e of lms.events || []) if (Date.parse(e.start) >= now - 864e5 && Date.parse(e.start) <= horizon) rows.push([e.start, `EVENT ${label(e.courseKey)} ${e.title}${e.location ? ` @ ${e.location}` : ''}`]);
  for (const e of S.events || []) { const t = Date.parse(`${e.date}T${e.time || '00:00'}`); if (t >= now - 864e5 && t <= horizon) rows.push([new Date(t).toISOString(), `${e.kind.toUpperCase()} ${(courses.find((c) => c.id === e.courseId) || {}).code || ''} ${e.title}`]); }
  for (const r of S.reminders || []) if (!r.done && Date.parse(r.at) <= horizon) rows.push([r.at, `REMINDER ${r.title}`]);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  fs.writeFileSync(path.join(root, 'calendar.md'), ['# Next 60 days', '', ...rows.map(([t, s]) => `- ${when(t)} — ${s}`)].join('\n'));
  return root;
}

module.exports = { writeContext, courseDir };
