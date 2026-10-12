'use strict';
// The AI coursework checker: the agent opens Canvas and Blackboard in Ledger's Edge
// profile, reads everything, and returns JSON. This module builds that prompt,
// validates/normalizes the answer, merges it per site, and diffs it against the
// last check so Ledger can tell you exactly what changed.

const crypto = require('crypto');

const EMPTY = { lastCheck: null, sources: {}, courses: [], assignments: [], announcements: [], events: [], syllabi: {} };

function origin(url) {
  if (!url) return '';
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { return new URL(u).origin; } catch { return ''; }
}

function buildPrompt({ canvasUrl, blackboardUrl, now, wantSyllabus, knownCourses }) {
  const sites = [];
  if (canvasUrl) sites.push(`- canvas: ${origin(canvasUrl)}`);
  if (blackboardUrl) sites.push(`- blackboard: ${origin(blackboardUrl)}`);
  const since = new Date(now.getTime() - 30 * 864e5).toISOString();
  const dueFrom = new Date(now.getTime() - 14 * 864e5).toISOString();

  return `You are the coursework checker for "Ledger", a student's notes app. Use the browser tools to read the student's
course sites and report everything as JSON. Current time: ${now.toString()} (ISO ${now.toISOString()}).

Sites (the browser profile is already signed in):
${sites.join('\n')}

STRICT RULES
- Use only the Playwright browser tools (names start with "browser_", e.g. browser_navigate, browser_evaluate, browser_snapshot). Do not use any other browser, computer-use or shell tool to open websites.
- Read only. Never submit, post, reply, upload, delete, mark anything complete, change settings, or click anything that changes data.
- Never type a username or password. If a login page, SSO page or Duo/MFA prompt appears for a site, stop working on that site and report its status as "login_required".
- Do not guess. Only report what you actually saw. Copy dates/times exactly and convert them to ISO 8601 with a timezone offset
  (Canvas API times ending in "Z" are already correct; for times shown on pages, use the site's displayed timezone, or the computer's local timezone if none is shown).

WHAT TO COLLECT (current-term courses only)
1. Courses: id (from the URL or API), course code (e.g. "ECON 120"), full name, URL.
2. Assignments, quizzes, exams and discussions with due dates from ${dueFrom} onward, plus undated ones. For each: id, course id, title, due,
   points, status ("open", "submitted", "graded", "missing"), score if graded, URL, and up to 400 characters of instructions.
3. Announcements posted since ${since}: id, course id, title, posted time, author, the text (up to 1500 characters), URL.
4. Calendar events (class sessions moved/cancelled, exam rooms, office hours, etc.) from today onward: id, course id, title, start, end, location, URL.
${wantSyllabus ? `5. Syllabus: for each course, the plain-text syllabus with the full schedule section (dates, readings, exams), up to 8000 characters.
   Check the Canvas syllabus page, Blackboard syllabus/course content items, and syllabus PDFs if they open in the browser.` : '5. Skip syllabi this time.'}

FAST, ACCURATE METHOD
- Canvas: after loading any Canvas page, use browser_evaluate to call Canvas's own JSON API on the same site with the existing session, e.g.
  async () => { const r = await fetch('/api/v1/courses?enrollment_state=active&include[]=term&per_page=50'); return (await r.text()).replace(/^while\\(1\\);/, ''); }
  Useful endpoints: /api/v1/courses/<id>/assignments?include[]=submission&per_page=100 ,
  /api/v1/announcements?context_codes[]=course_<id>&start_date=${since.slice(0, 10)}&per_page=50 ,
  /api/v1/calendar_events?type=event&context_codes[]=course_<id>&start_date=${now.toISOString().slice(0, 10)}&per_page=100 ,
  /api/v1/courses/<id>?include[]=syllabus_body . Map the fields yourself and keep only what is needed (return compact data from browser_evaluate, not whole pages).
- Blackboard: open the site, then try same-origin JSON endpoints with browser_evaluate (e.g. /learn/api/public/v1/users/me ,
  /learn/api/public/v1/users/<userId>/courses , /learn/api/public/v1/courses/<courseId>/announcements ,
  /learn/api/public/v1/calendars/items?since=...&until=... , /learn/api/v1/... ). If those are blocked, navigate the UI instead:
  Activity Stream, Calendar, each course's Announcements, Gradebook/due dates, and Course Content.
${knownCourses ? `- Courses the student entered in Ledger (for matching codes): ${knownCourses}` : ''}

OUTPUT: reply with ONLY this JSON object, no other text:
{
  "sources": { "canvas": {"status": "ok|login_required|error|skipped", "note": ""}, "blackboard": {"status": "ok|login_required|error|skipped", "note": ""} },
  "courses": [ {"source": "canvas|blackboard", "id": "", "code": "", "name": "", "url": ""} ],
  "assignments": [ {"source": "", "id": "", "courseId": "", "title": "", "due": "ISO or null", "points": null, "status": "open", "score": "", "url": "", "details": ""} ],
  "announcements": [ {"source": "", "id": "", "courseId": "", "title": "", "posted": "ISO", "author": "", "text": "", "url": ""} ],
  "events": [ {"source": "", "id": "", "courseId": "", "title": "", "start": "ISO", "end": "ISO or null", "allDay": false, "location": "", "url": ""} ],
  "syllabi": [ {"source": "", "courseId": "", "text": "", "url": ""} ]
}
Use "skipped" for a site that is not listed above.`;
}

const str = (v, max = 400) => (v == null ? '' : String(v)).slice(0, max);
const iso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const SRC = new Set(['canvas', 'blackboard']);

// Turn the agent's JSON into Ledger's shape, dropping anything malformed.
function normalize(raw) {
  const out = { sources: {}, courses: [], assignments: [], announcements: [], events: [], syllabi: {} };
  const src = (x) => (SRC.has(String(x && x.source).toLowerCase()) ? String(x.source).toLowerCase() : null);
  for (const s of SRC) {
    const st = raw.sources && raw.sources[s];
    out.sources[s] = { status: st && /^(ok|login_required|error|skipped)$/.test(st.status) ? st.status : 'error', note: str(st && st.note, 300) };
  }
  for (const c of raw.courses || []) {
    const s = src(c);
    if (!s || !c.id) continue;
    out.courses.push({ key: `${s}:${c.id}`, source: s, id: str(c.id, 60), code: str(c.code, 60), name: str(c.name, 200), url: str(c.url, 500) });
  }
  for (const a of raw.assignments || []) {
    const s = src(a);
    if (!s || !a.title) continue;
    const id = a.id ? str(a.id, 60) : hash(`${a.courseId}|${a.title}`);
    out.assignments.push({
      key: `${s}:a:${id}`, source: s, courseKey: a.courseId ? `${s}:${a.courseId}` : '', title: str(a.title, 300), due: iso(a.due),
      points: typeof a.points === 'number' ? a.points : null,
      status: /^(open|submitted|graded|missing)$/.test(a.status) ? a.status : 'open',
      score: str(a.score, 40), url: str(a.url, 500), details: str(a.details, 600),
    });
  }
  for (const a of raw.announcements || []) {
    const s = src(a);
    if (!s || !a.title) continue;
    const id = a.id ? str(a.id, 60) : hash(`${a.courseId}|${a.title}|${a.posted}`);
    out.announcements.push({
      key: `${s}:n:${id}`, source: s, courseKey: a.courseId ? `${s}:${a.courseId}` : '', title: str(a.title, 300),
      posted: iso(a.posted), author: str(a.author, 100), text: str(a.text, 2000), url: str(a.url, 500),
    });
  }
  for (const e of raw.events || []) {
    const s = src(e);
    if (!s || !e.title || !iso(e.start)) continue;
    const id = e.id ? str(e.id, 60) : hash(`${e.courseId}|${e.title}|${e.start}`);
    out.events.push({
      key: `${s}:e:${id}`, source: s, courseKey: e.courseId ? `${s}:${e.courseId}` : '', title: str(e.title, 300),
      start: iso(e.start), end: iso(e.end), allDay: !!e.allDay, location: str(e.location, 200), url: str(e.url, 500),
    });
  }
  for (const y of raw.syllabi || []) {
    const s = src(y);
    if (!s || !y.courseId || !y.text) continue;
    out.syllabi[`${s}:${y.courseId}`] = { text: str(y.text, 12000), url: str(y.url, 500), fetched: new Date().toISOString() };
  }
  return out;
}

// Replace each site's data only if that site was read successfully this time.
function merge(prev, next) {
  const merged = { ...EMPTY, ...prev, lastCheck: new Date().toISOString(), sources: { ...(prev.sources || {}) } };
  for (const s of SRC) {
    const st = next.sources[s];
    if (st.status === 'skipped') continue;
    merged.sources[s] = { ...st, at: merged.lastCheck, lastOk: st.status === 'ok' ? merged.lastCheck : prev.sources?.[s]?.lastOk || null };
    if (st.status !== 'ok') continue;
    for (const kind of ['courses', 'assignments', 'announcements', 'events']) {
      merged[kind] = [...(merged[kind] || []).filter((x) => x.source !== s), ...next[kind].filter((x) => x.source === s)];
    }
  }
  merged.syllabi = { ...(prev.syllabi || {}), ...next.syllabi };
  return merged;
}

const fmt = (isoStr) => (isoStr ? new Date(isoStr).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'no date');

// What changed between two merged snapshots -> activity entries.
function diff(prev, next) {
  const changes = [];
  // Don't flood the first time a site is read successfully.
  const seen = (s) => !!(prev.sources && prev.sources[s] && prev.sources[s].lastOk);
  const at = new Date().toISOString();
  const byKey = (arr) => new Map((arr || []).filter((x) => seen(x.source)).map((x) => [x.key, x]));
  next = {
    assignments: next.assignments.filter((x) => seen(x.source)),
    announcements: next.announcements.filter((x) => seen(x.source)),
    events: next.events.filter((x) => seen(x.source)),
  };

  const pa = byKey(prev.assignments);
  for (const a of next.assignments) {
    const old = pa.get(a.key);
    if (!old) {
      changes.push({ at, kind: 'new-assignment', source: a.source, courseKey: a.courseKey, ref: a.key, text: `New: ${a.title} (due ${fmt(a.due)})` });
    } else {
      if (old.due !== a.due) changes.push({ at, kind: 'due-changed', source: a.source, courseKey: a.courseKey, ref: a.key, text: `Due date changed: ${a.title} — ${fmt(old.due)} → ${fmt(a.due)}` });
      if (old.status !== 'graded' && a.status === 'graded') changes.push({ at, kind: 'graded', source: a.source, courseKey: a.courseKey, ref: a.key, text: `Graded: ${a.title}${a.score ? ` — ${a.score}${a.points != null ? `/${a.points}` : ''}` : ''}` });
    }
  }
  const pn = byKey(prev.announcements);
  for (const n of next.announcements) {
    if (!pn.has(n.key)) changes.push({ at, kind: 'announcement', source: n.source, courseKey: n.courseKey, ref: n.key, text: `Announcement: ${n.title}` });
  }
  const pe = byKey(prev.events);
  for (const e of next.events) {
    const old = pe.get(e.key);
    if (!old) changes.push({ at, kind: 'event', source: e.source, courseKey: e.courseKey, ref: e.key, text: `New event: ${e.title} (${fmt(e.start)})` });
    else if (old.start !== e.start || old.location !== e.location) changes.push({ at, kind: 'event-changed', source: e.source, courseKey: e.courseKey, ref: e.key, text: `Event changed: ${e.title} — now ${fmt(e.start)}${e.location ? `, ${e.location}` : ''}` });
  }
  return changes;
}

const SCHEDULE_WORDS = /(postpon|reschedul|moved|move[sd]? to|cancel|delay|extend|extension|pushed|new date|due date|exam|midterm|final|quiz|no class|room change)/i;

module.exports = { EMPTY, buildPrompt, normalize, merge, diff, origin, SCHEDULE_WORDS };
