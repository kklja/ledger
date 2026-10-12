'use strict';
const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, nativeTheme, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const QRCode = require('qrcode');

const { Store, DEFAULT_SETTINGS, deepMerge, uid } = require('./store');
const ai = require('./ai');
const { releaseProfile, profileProcesses } = require('./edge-profile');
const { initUpdater, consumeRelaunchHidden } = require('./updater');
const lms = require('./lms');
const { fetchFeed } = require('./feeds');
const { writeContext, courseDir } = require('./context');
const { TASKS } = require('./tasks');
const phone = require('./phone');
const { classOccurrences, ymd } = require('../shared/schedule');
const { markdownToNote } = require('../shared/notes-md');

const DEV = !!process.env.LEDGER_DEV;
// Dev/test only: LEDGER_USERDATA + LEDGER_DATA point at a throwaway profile, LEDGER_SHOTS=<dir> saves a
// screenshot of each view there and quits (phone server and scheduler stay off in that mode).
const SHOTS = process.env.LEDGER_SHOTS || '';
if (process.env.LEDGER_USERDATA) app.setPath('userData', process.env.LEDGER_USERDATA);
// Course colors that read well on OLED black and on light.
const COLORS = ['#4cc2ff', '#6ccb5f', '#ffb454', '#c58cff', '#ff7a85', '#3ed6c6', '#f7d046', '#8fa3ff'];

app.setAppUserModelId('com.ledger.notes');
protocol.registerSchemesAsPrivileged([{ scheme: 'ledger-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start);
}

let win = null;
let tray = null;
let store = null;
let phoneServer = null;
let updater = null;
const keepAlive = new Set(); // notifications must stay referenced for click handlers on Windows
const runs = new Map(); // AI runs in this session

const S = {
  settings: null, courses: [], reminders: [], events: [], lms: lms.EMPTY, feeds: {}, activity: [], inbox: [], pending: [], fired: {},
  status: { checking: false, checkLog: '', lastError: '', loginOpen: false, phoneError: '' },
};

const FILES = { settings: 'settings.json', courses: 'courses.json', reminders: 'reminders.json', events: 'events.json', lms: 'lms.json', feeds: 'feeds.json', activity: 'activity.json', inbox: 'inbox.json', pending: 'pending.json', fired: 'fired.json' };

function dataDir() {
  if (process.env.LEDGER_DATA) return process.env.LEDGER_DATA;
  const cfgFile = path.join(app.getPath('userData'), 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch {}
  if (!cfg.dataDir) {
    cfg.dataDir = path.join(app.getPath('documents'), 'Ledger');
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 1));
  }
  return cfg.dataDir;
}

function load() {
  store = new Store(dataDir());
  S.settings = deepMerge(DEFAULT_SETTINGS, store.read(FILES.settings, {}));
  if (!S.settings.phone.key) S.settings.phone.key = phone.newKey();
  for (const k of ['courses', 'reminders', 'events', 'activity', 'inbox', 'pending']) S[k] = store.read(FILES[k], []);
  S.lms = { ...lms.EMPTY, ...store.read(FILES.lms, {}) };
  S.feeds = store.read(FILES.feeds, {});
  S.fired = store.read(FILES.fired, {});
  store.write(FILES.settings, S.settings);
}

function save(...keys) {
  for (const k of keys) if (FILES[k]) store.write(FILES[k], S[k]);
  send('state:changed', keys);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function publicState() {
  return {
    settings: S.settings, courses: S.courses, reminders: S.reminders, events: S.events, lms: S.lms, feeds: S.feeds,
    activity: S.activity.slice(0, 300), inbox: S.inbox, pending: S.pending, status: S.status, dataDir: store.root, version: app.getVersion(),
    runs: [...runs.values()].map(({ cancel, ...r }) => r).slice(-30),
  };
}

function setStatus(patch) {
  Object.assign(S.status, patch);
  send('state:changed', ['status']);
}

// ---------- notifications ----------
function notify(title, body, nav) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconPath() });
  keepAlive.add(n);
  n.on('click', () => { showWindow(); if (nav) send('nav', nav); });
  n.on('close', () => keepAlive.delete(n));
  setTimeout(() => keepAlive.delete(n), 10 * 60 * 1000);
  n.show();
}

function addActivity(entries) {
  if (!entries.length) return;
  S.activity = [...entries, ...S.activity].slice(0, 1000);
  save('activity');
}

// ---------- courses ----------
const codeKey = (s) => ((String(s || '').match(/[A-Za-z]{2,5}[\s\-_]*\d{2,4}/) || [''])[0]).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
function prettyCode(s) {
  const m = /([A-Za-z]{2,5})[\s\-_]*(\d{2,4}[A-Za-z]?)/.exec(s || '');
  return m ? `${m[1].toUpperCase()} ${m[2]}` : String(s || 'Course').slice(0, 24);
}

function linkCourses() {
  let changed = false;
  for (const lc of S.lms.courses || []) {
    if (S.courses.some((c) => (c.lmsKeys || []).includes(lc.key))) continue;
    if ((S.settings.ignoredLms || []).includes(lc.key)) continue;
    const k = codeKey(lc.code) || codeKey(lc.name);
    const match = k && S.courses.find((c) => codeKey(c.code) === k);
    if (match) match.lmsKeys = [...(match.lmsKeys || []), lc.key];
    else {
      S.courses.push({
        id: uid(), code: prettyCode(lc.code || lc.name), name: lc.name, color: COLORS[S.courses.length % COLORS.length],
        instructor: '', meetings: [], lmsKeys: [lc.key], cancelled: [],
      });
    }
    changed = true;
  }
  if (changed) save('courses');
}

const courseByLmsKey = (key) => S.courses.find((c) => (c.lmsKeys || []).includes(key));
const courseCode = (id) => (S.courses.find((c) => c.id === id) || {}).code || '';

// ---------- AI coursework check ----------
function profileDir() { return store.file('browser-profile'); }

async function checkCoursework({ manual = false, wantSyllabus = null } = {}) {
  const { canvasUrl, blackboardUrl, showBrowser } = S.settings.lms;
  if (!canvasUrl && !blackboardUrl) throw new Error('Add your Canvas and/or Blackboard address in Settings first.');
  if (S.status.loginOpen) throw Object.assign(new Error('Close the sign-in window first, then check again.'), { code: 'LOGIN_OPEN' });
  if (S.status.checking) throw new Error('A check is already running.');
  fired('_lastAttempt', Date.now());

  if (wantSyllabus == null) {
    const linked = S.courses.flatMap((c) => c.lmsKeys || []);
    wantSyllabus = !linked.length || linked.some((k) => !S.lms.syllabi[k] || Date.now() - Date.parse(S.lms.syllabi[k].fetched) > 7 * 864e5);
  }
  setStatus({ checking: true, checkLog: '', lastError: '' });
  const known = S.courses.map((c) => c.code).join(', ');
  const prompt = lms.buildPrompt({ canvasUrl, blackboardUrl, now: new Date(), wantSyllabus, knownCourses: known });
  let log = '';
  const job = ai.run(prompt, {
    provider: S.settings.ai.provider, settings: S.settings, cwd: store.file('ai-context'),
    browser: { profileDir: profileDir(), headless: !showBrowser },
    onLog: (t) => { log = (log + t).slice(-6000); S.status.checkLog = log; send('check:log', t); },
  });
  try {
    const text = await job.promise;
    const parsed = lms.normalize(ai.extractJson(text));
    const prev = S.lms;
    const oldSyllabi = { ...(prev.syllabi || {}) };
    S.lms = lms.merge(prev, parsed);
    const changes = lms.diff(prev, S.lms).map((c) => ({ ...c, courseId: (courseByLmsKey(c.courseKey) || {}).id || '' }));
    save('lms');
    linkCourses();
    addActivity(changes);

    const needLogin = Object.entries(parsed.sources).filter(([, v]) => v.status === 'login_required').map(([k]) => k);
    const failed = Object.entries(parsed.sources).filter(([, v]) => v.status === 'error').map(([k, v]) => `${k}: ${v.note || 'error'}`);
    if (needLogin.length) notify('Ledger: sign-in needed', `${needLogin.join(' and ')} signed you out. Open Ledger → Coursework → Sign in.`, { view: 'coursework' });
    if (S.settings.reminders.notifyChanges && changes.length) {
      if (changes.length === 1) notify(`${courseCode(changes[0].courseId) || 'Coursework'} update`, changes[0].text, { view: 'coursework' });
      else notify(`Ledger: ${changes.length} coursework updates`, changes.slice(0, 3).map((c) => c.text).join('\n'), { view: 'coursework' });
    }
    setStatus({ checking: false, lastError: [...needLogin.map((s) => `${s}: sign-in required`), ...failed].join(' · ') });
    writeContext(store, S);

    // Keep the syllabus map current: re-map a course when its syllabus is new/changed
    // or an announcement mentions schedule changes. Results wait for your approval.
    if (S.settings.lms.autoRemap) {
      const targets = new Set();
      for (const [key, syl] of Object.entries(S.lms.syllabi || {})) {
        const old = oldSyllabi[key];
        const c = courseByLmsKey(key);
        if (c && (!old || old.text !== syl.text)) targets.add(c.id);
      }
      for (const ch of changes) if (ch.kind === 'announcement' && ch.courseId) {
        const a = S.lms.announcements.find((x) => x.key === ch.ref);
        if (a && lms.SCHEDULE_WORDS.test(`${a.title} ${a.text}`)) targets.add(ch.courseId);
      }
      for (const courseId of targets) startAiTask('mapSyllabus', { courseId, reason: 'auto' });
    }
    return { changes: changes.length, sources: parsed.sources };
  } catch (e) {
    setStatus({ checking: false, lastError: e.message });
    if (!manual && e.code !== 'LOGIN_OPEN') notify('Ledger: coursework check failed', e.message.slice(0, 200), { view: 'coursework' });
    throw e;
  }
}

async function openLogin() {
  const edge = ai.findEdge();
  if (!edge) throw new Error('Microsoft Edge was not found.');
  if (S.status.checking) throw new Error('Wait for the current check to finish.');
  const urls = [S.settings.lms.canvasUrl, S.settings.lms.blackboardUrl].map(lms.origin).filter(Boolean);
  if (!urls.length) throw new Error('Add your Canvas and/or Blackboard address first.');
  fs.mkdirSync(profileDir(), { recursive: true });
  // Close any hidden/background Edge on this profile first, or the new window would attach to it.
  try { await releaseProfile(profileDir()); } catch (e) { if (e.code !== 'LOGIN_OPEN') throw e; }
  spawn(edge, [`--user-data-dir=${profileDir()}`, '--no-first-run', '--no-default-browser-check', '--new-window', ...urls], { detached: true, stdio: 'ignore' }).unref();
  setStatus({ loginOpen: true });
  watchLogin();
}

// "Sign-in open" = an Edge window on Ledger's profile is actually on screen. (Edge's launcher
// process can exit early or linger in the background, so it isn't a reliable signal.)
let loginTimer = null;
function watchLogin() {
  clearInterval(loginTimer);
  let seen = false;
  const started = Date.now();
  loginTimer = setInterval(async () => {
    const open = (await profileProcesses(profileDir())).some((p) => p.browser && p.hasWindow && !p.automation);
    if (open) seen = true;
    if (!open && (seen || Date.now() - started > 20000)) {
      clearInterval(loginTimer);
      setStatus({ loginOpen: false });
      // Edge may keep running in the background after the window closes; free the profile now.
      releaseProfile(profileDir()).catch(() => {});
    }
  }, 3000);
}

// ---------- optional feeds ----------
async function syncFeeds() {
  const all = [];
  for (const f of S.settings.feeds || []) {
    try {
      const { type, items } = await fetchFeed(f.url);
      const prev = S.feeds[f.id];
      const mapped = items.map((it) => {
        const c = f.courseId ? S.courses.find((x) => x.id === f.courseId) : S.courses.find((x) => codeKey(x.code) && codeKey(`${it.title} ${it.text}`).includes(codeKey(x.code)));
        return { ...it, key: `feed:${f.id}:${it.uid}`, type, courseId: c ? c.id : '' };
      });
      if (prev && prev.ok) {
        const old = new Map(prev.items.map((i) => [i.key, i]));
        for (const it of mapped) {
          const o = old.get(it.key);
          if (!o) all.push({ at: new Date().toISOString(), kind: type === 'rss' ? 'announcement' : 'new-assignment', source: f.name, courseId: it.courseId, ref: it.key, text: `${type === 'rss' ? 'Announcement' : 'New'}: ${it.title}` });
          else if (o.start !== it.start) all.push({ at: new Date().toISOString(), kind: 'due-changed', source: f.name, courseId: it.courseId, ref: it.key, text: `Date changed: ${it.title} — now ${new Date(it.start).toLocaleString()}` });
        }
      }
      S.feeds[f.id] = { ok: true, at: new Date().toISOString(), error: '', items: mapped };
    } catch (e) {
      S.feeds[f.id] = { ...(S.feeds[f.id] || { items: [] }), ok: false, at: new Date().toISOString(), error: e.message };
    }
  }
  for (const id of Object.keys(S.feeds)) if (!(S.settings.feeds || []).some((f) => f.id === id)) delete S.feeds[id];
  save('feeds');
  addActivity(all);
  if (S.settings.reminders.notifyChanges && all.length) notify('Ledger: calendar feed updates', all.slice(0, 3).map((c) => c.text).join('\n'), { view: 'coursework' });
}

// ---------- AI tasks ----------
function startAiTask(task, params = {}) {
  if (!TASKS[task]) throw new Error('Unknown task');
  const id = uid();
  const provider = params.provider || S.settings.ai.provider;
  const L = S.settings.lms;
  const browse = !!(L.aiCanBrowse && (L.canvasUrl || L.blackboardUrl) && !['importSchedule', 'test'].includes(task) && !S.status.loginOpen);
  const label = { studyGuide: 'Study guide', quiz: 'Practice quiz', ask: 'Question', mapSyllabus: 'Map syllabus', importSchedule: 'Import schedule', test: 'Connection test' }[task];
  const entry = { id, task, label: `${label}${params.courseId ? ` · ${courseCode(params.courseId)}` : ''}`, provider, started: new Date().toISOString(), status: 'running', log: '', result: null, error: '' };
  runs.set(id, entry);
  send('state:changed', ['runs']);

  (async () => {
    try {
      writeContext(store, S);
      const prompt = TASKS[task](S, params, browse);
      const job = ai.run(prompt, {
        provider, settings: S.settings, cwd: store.file('ai-context'),
        browser: browse ? { profileDir: profileDir(), headless: !L.showBrowser } : null,
        onLog: (t) => { entry.log = (entry.log + t).slice(-8000); send('ai:log', { id, text: t }); },
      });
      entry.cancel = job.cancel;
      const text = await job.promise;
      entry.result = finishTask(task, params, text);
      entry.status = 'done';
    } catch (e) {
      entry.status = 'error';
      entry.error = e.message;
    }
    delete entry.cancel;
    entry.finished = new Date().toISOString();
    send('state:changed', ['runs']);
    send('ai:done', { id });
  })();
  return id;
}

function finishTask(task, params, text) {
  switch (task) {
    case 'studyGuide': {
      const { text: body, objects } = markdownToNote(text, () => uid(8));
      const first = /^#\s+(.+)$/m.exec(text);
      const note = store.saveNote({ id: uid(), title: first ? first[1].trim() : 'Study guide', courseId: params.courseId || '', text: body, objects });
      send('state:changed', ['notes']);
      return { noteId: note.id };
    }
    case 'quiz': {
      const q = ai.extractJson(text);
      if (!Array.isArray(q.questions) || !q.questions.length) throw new Error('The AI returned no questions.');
      const quiz = { id: uid(), title: String(q.title || 'Practice quiz'), courseId: params.courseId || '', created: new Date().toISOString(), questions: q.questions, attempts: [] };
      store.write(path.join('quizzes', `${quiz.id}.json`), quiz);
      return { quizId: quiz.id };
    }
    case 'mapSyllabus': {
      const j = ai.extractJson(text);
      const pending = proposeSchedule(params.courseId, j.items || [], params.reason || 'manual');
      return { pendingId: pending ? pending.id : null, unchanged: !pending };
    }
    case 'importSchedule':
      return { data: ai.extractJson(text) };
    default:
      return { text };
  }
}

const KINDS = new Set(['exam', 'quiz', 'due', 'reading', 'topic', 'no-class', 'event']);
const evKey = (e) => `${e.kind}|${String(e.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;

function proposeSchedule(courseId, rawItems, reason) {
  const items = rawItems
    .filter((i) => i && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && i.title)
    .map((i) => ({ date: i.date, time: /^\d{1,2}:\d{2}$/.test(i.time || '') ? i.time.padStart(5, '0') : '', title: String(i.title).slice(0, 200), kind: KINDS.has(i.kind) ? i.kind : 'event', note: String(i.note || '').slice(0, 200) }));
  const current = S.events.filter((e) => e.courseId === courseId && e.source === 'syllabus');
  const oldMap = new Map(current.map((e) => [evKey(e), e]));
  const newMap = new Map(items.map((e) => [evKey(e), e]));
  const added = items.filter((e) => !oldMap.has(evKey(e)));
  const removed = current.filter((e) => !newMap.has(evKey(e)));
  const changed = items.filter((e) => { const o = oldMap.get(evKey(e)); return o && (o.date !== e.date || (o.time || '') !== e.time); }).map((e) => ({ from: oldMap.get(evKey(e)), to: e }));
  if (!added.length && !removed.length && !changed.length) return null;
  const p = { id: uid(), courseId, created: new Date().toISOString(), reason, items, added, removed, changed };
  S.pending = [p, ...S.pending.filter((x) => x.courseId !== courseId)];
  save('pending');
  if (reason === 'auto') notify(`${courseCode(courseId)} schedule update`, `${changed.length} moved · ${added.length} new · ${removed.length} removed — review in Ledger`, { view: 'today' });
  return p;
}

function resolvePending(id, apply) {
  const p = S.pending.find((x) => x.id === id);
  if (!p) return;
  if (apply) {
    S.events = [...S.events.filter((e) => !(e.courseId === p.courseId && e.source === 'syllabus')), ...p.items.map((i) => ({ ...i, id: uid(), courseId: p.courseId, source: 'syllabus' }))];
    save('events');
  }
  S.pending = S.pending.filter((x) => x.id !== id);
  save('pending');
}

// ---------- scheduler: reminders, deadlines, classes, auto checks ----------
function fired(key, value) {
  if (value === undefined) return S.fired[key];
  S.fired[key] = value;
  store.write(FILES.fired, S.fired);
}

function deadlines() {
  const out = [];
  for (const a of S.lms.assignments || []) {
    if (!a.due || a.status === 'submitted' || a.status === 'graded') continue;
    out.push({ key: a.key, title: a.title, due: Date.parse(a.due), courseId: (courseByLmsKey(a.courseKey) || {}).id });
  }
  for (const f of Object.values(S.feeds)) for (const it of f.items || []) if (it.type === 'ics' && it.start) out.push({ key: it.key, title: it.title, due: Date.parse(it.start), courseId: it.courseId });
  for (const e of S.events) if (['exam', 'quiz', 'due'].includes(e.kind)) out.push({ key: `ev:${e.id}`, title: e.title, due: Date.parse(`${e.date}T${e.time || '09:00'}`), courseId: e.courseId });
  return out;
}

let tickRunning = false;
function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const now = Date.now();
    let remChanged = false;
    for (const r of S.reminders) {
      if (r.done || r.notified || Date.parse(r.at) > now) continue;
      r.notified = true;
      remChanged = true;
      if (now - Date.parse(r.at) < 6 * 3600e3) notify(`Reminder${r.courseId ? ` · ${courseCode(r.courseId)}` : ''}`, r.title, { view: 'today' });
    }
    if (remChanged) save('reminders');

    for (const d of deadlines()) {
      if (!(d.due > now)) continue;
      for (const L of S.settings.reminders.assignmentLeadHours || []) {
        const k = `${d.key}:${L}`;
        if (fired(k) || now < d.due - L * 3600e3) continue;
        fired(k, now);
        const hrs = Math.round((d.due - now) / 3600e3);
        notify(`Due ${hrs >= 24 ? `in ${Math.round(hrs / 24)} day${hrs >= 36 ? 's' : ''}` : `in ${Math.max(1, hrs)} hour${hrs > 1 ? 's' : ''}`}${d.courseId ? ` · ${courseCode(d.courseId)}` : ''}`, `${d.title}\n${new Date(d.due).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, { view: 'today' });
      }
    }

    const lead = S.settings.reminders.classLeadMinutes;
    if (lead > 0) {
      const today = new Date();
      for (const o of classOccurrences(S.courses, S.settings.term, today, today)) {
        const t = o.start.getTime();
        const k = `${o.key}:${ymd(today)}`;
        if (o.cancelled || fired(k) || now < t - lead * 60e3 || now >= t) continue;
        fired(k, now);
        const c = S.courses.find((x) => x.id === o.courseId);
        const where = [o.meeting.building, o.meeting.room].filter(Boolean).join(' ');
        notify(`${c.code} in ${Math.max(1, Math.round((t - now) / 60e3))} min`, `${where || 'No room set'} · ${o.meeting.start}–${o.meeting.end}`, { view: 'today' });
      }
    }

    // Scheduled coursework checks (and one at startup if the last one is stale)
    const L = S.settings.lms;
    if (L.autoCheck && (L.canvasUrl || L.blackboardUrl) && !S.status.checking && !S.status.loginOpen) {
      const last = Math.max(Date.parse(S.lms.lastCheck || 0) || 0, fired('_lastAttempt') || 0);
      const d = new Date();
      const due = (L.checkTimes || []).some((t) => {
        const [h, m] = t.split(':').map(Number);
        const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
        return now >= slot && now - slot < 3 * 3600e3 && last < slot;
      });
      if (due || now - last > 12 * 3600e3) checkCoursework().catch(() => {});
    }

    if ((S.settings.feeds || []).length && now - (fired('_feeds') || 0) > 30 * 60e3) {
      fired('_feeds', now);
      syncFeeds().catch(() => {});
    }

    // prune fired keys older than 3 weeks
    if (now - (fired('_prune') || 0) > 864e5) {
      for (const [k, v] of Object.entries(S.fired)) if (!k.startsWith('_') && now - v > 21 * 864e5) delete S.fired[k];
      fired('_prune', now);
    }
  } finally {
    tickRunning = false;
  }
}

// ---------- phone bridge ----------
async function restartPhone() {
  if (phoneServer) { await new Promise((r) => phoneServer.close(() => r())); phoneServer = null; }
  S.status.phoneError = '';
  if (!S.settings.phone.enabled) return send('state:changed', ['status']);
  try {
    phoneServer = await phone.createPhoneServer({
      port: S.settings.phone.port, key: S.settings.phone.key,
      onImage: (buf, ext) => {
        const file = store.saveImage(buf, ext);
        const item = { id: uid(), file, received: new Date().toISOString(), used: false };
        S.inbox = [item, ...S.inbox].slice(0, 300);
        save('inbox');
        send('phone:image', item);
      },
    });
  } catch (e) {
    S.status.phoneError = e.code === 'EADDRINUSE' ? `Port ${S.settings.phone.port} is in use — pick another in Settings.` : e.message;
  }
  send('state:changed', ['status']);
}

async function phoneInfo() {
  const ip = phone.lanAddress();
  const base = `http://${ip}:${S.settings.phone.port}`;
  const url = `${base}/?k=${encodeURIComponent(S.settings.phone.key)}`;
  return {
    url, uploadUrl: `${base}/upload?k=${encodeURIComponent(S.settings.phone.key)}`, ip,
    qr: await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#16202c', light: '#ffffff' } }),
    enabled: S.settings.phone.enabled, running: !!phoneServer, error: S.status.phoneError,
  };
}

// ---------- window / tray ----------
function iconPath() { return path.join(__dirname, '..', 'build', 'icon.png'); }

// Native Windows minimize/maximize/close buttons drawn over our own title bar.
function chrome() {
  const light = S.settings.app.theme === 'light';
  return { bg: light ? '#f3f3f3' : '#000000', overlay: { color: light ? '#f3f3f3' : '#000000', symbolColor: light ? '#1a1a1a' : '#ffffff', height: 48 } };
}

function applyChrome() {
  nativeTheme.themeSource = S.settings.app.theme === 'light' ? 'light' : 'dark';
  if (!win || win.isDestroyed()) return;
  const c = chrome();
  win.setBackgroundColor(c.bg);
  win.setTitleBarOverlay(c.overlay);
}

function createWindow(hidden) {
  nativeTheme.themeSource = S.settings.app.theme === 'light' ? 'light' : 'dark';
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1000, minHeight: 640, show: !hidden, title: 'Ledger',
    backgroundColor: chrome().bg, titleBarStyle: 'hidden', titleBarOverlay: chrome().overlay, icon: iconPath(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && DEV) win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'r' && !input.shift) e.preventDefault();
  });
  if (DEV) {
    win.webContents.on('console-message', (...args) => {
      const e = args[0];
      const msg = e && e.message !== undefined ? `${e.level} ${e.message}` : `${args[1]} ${args[2]}`;
      console.log('[renderer]', msg);
    });
    win.webContents.on('did-finish-load', () => console.log('[main] renderer loaded'));
  }
  win.on('close', (e) => {
    if (!app.isQuitting && S.settings.app.keepInTray) { e.preventDefault(); win.hide(); }
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow(false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Ledger');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Ledger', click: () => showWindow() },
    { label: 'Check coursework now', click: () => checkCoursework({ manual: true }).catch((e) => notify('Ledger', e.message)) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showWindow());
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!S.settings.app.launchAtLogin, args: ['--hidden'] });
}

// ---------- IPC ----------
function ipc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => fn(...a));
  h('state:get', () => publicState());
  h('settings:update', async (patch) => {
    const before = JSON.stringify(S.settings.phone);
    S.settings = deepMerge(S.settings, patch);
    save('settings');
    if (JSON.stringify(S.settings.phone) !== before) await restartPhone();
    if (patch.app) { applyLoginItem(); applyChrome(); }
    if (patch.feeds) syncFeeds().catch(() => {});
    return S.settings;
  });
  h('courses:save', (courses) => { S.courses = courses; save('courses'); });
  h('courses:ignoreLms', (key) => { S.settings.ignoredLms = [...new Set([...(S.settings.ignoredLms || []), key])]; save('settings'); });
  h('reminders:save', (list) => { S.reminders = list; save('reminders'); });
  h('events:save', (list) => { S.events = list; save('events'); });
  h('activity:clear', () => { S.activity = []; save('activity'); });
  h('inbox:save', (list) => { S.inbox = list; save('inbox'); });
  h('pending:resolve', (id, apply) => resolvePending(id, apply));

  h('notes:list', () => store.listNotes());
  h('notes:get', (id) => store.getNote(id));
  h('notes:save', (note) => store.saveNote(note));
  h('notes:delete', (id) => { store.deleteNote(id); send('state:changed', ['notes']); });
  h('image:save', (bytes, ext) => store.saveImage(bytes, ext));

  h('quiz:list', () => {
    const dir = store.file('quizzes');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
      try { const q = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return { id: q.id, title: q.title, courseId: q.courseId, created: q.created, count: q.questions.length, best: Math.max(-1, ...(q.attempts || []).map((a) => a.score)) }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
  });
  h('quiz:get', (id) => (/^[a-z0-9]+$/.test(id) ? store.read(path.join('quizzes', `${id}.json`), null) : null));
  h('quiz:save', (q) => { if (/^[a-z0-9]+$/.test(q.id)) store.write(path.join('quizzes', `${q.id}.json`), q); });

  h('lms:check', () => checkCoursework({ manual: true }));
  h('lms:login', () => openLogin());
  h('feeds:sync', () => syncFeeds());

  h('ai:detect', () => ai.detect(S.settings));
  h('ai:run', (task, params) => startAiTask(task, params));
  h('ai:cancel', (id) => { const r = runs.get(id); if (r && r.cancel) r.cancel(); });
  h('ai:get', (id) => { const r = runs.get(id); if (!r) return null; const { cancel, ...rest } = r; return rest; });

  h('phone:info', () => phoneInfo());
  h('open:external', (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  h('open:dataDir', () => shell.openPath(store.root));
  h('open:courseFiles', (courseId) => {
    const c = S.courses.find((x) => x.id === courseId);
    if (!c) return;
    const dir = path.join(courseDir(store.file('ai-context'), c), 'files');
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });
  h('notify:test', () => notify('Ledger', 'Notifications are working.'));
  h('update:check', () => updater && updater.check());
  h('update:install', () => updater && updater.install());
}

// ---------- start ----------
async function start() {
  load();
  protocol.handle('ledger-img', (req) => {
    const file = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''));
    if (!/^[a-z0-9]+\.(png|jpg|gif|webp|heic|bmp)$/.test(file)) return new Response('Bad request', { status: 400 });
    return net.fetch(pathToFileURL(store.file('images', file)).toString());
  });
  ipc();
  createWindow(process.argv.includes('--hidden') || consumeRelaunchHidden());
  createTray();
  try { writeContext(store, S); } catch (e) { console.error('context', e); }
  if (SHOTS) return runShots(SHOTS);
  updater = initUpdater({
    onStatus: (u) => setStatus({ update: { ...(S.status.update || {}), ...u } }),
    notify: (t, b) => notify(t, b, { view: 'settings' }),
    isIdle: () => (!win || win.isDestroyed() || !win.isVisible()) && !S.status.checking && ![...runs.values()].some((r) => r.status === 'running'),
  });
  applyLoginItem();
  await restartPhone();
  setTimeout(tick, 15000);
  setInterval(tick, 30000);
}

async function runShots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(dir, { recursive: true });
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  await wait(1500);
  // steps: "name" or "name|<js>" separated by ";;"
  const steps = (process.env.LEDGER_SHOT_STEPS || 'today;;calendar;;notes;;coursework;;ai;;courses;;settings').split(';;');
  for (const step of steps) {
    const i = step.indexOf('|');
    const name = i < 0 ? step : step.slice(0, i);
    const js = i < 0 ? '' : step.slice(i + 1);
    const res = await win.webContents.executeJavaScript(js || `window.__ledgerGo(${JSON.stringify(name)})`).catch((e) => console.log('step error', name, e.message));
    if (res !== undefined) console.log('[result]', name, res);
    await wait(1300);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    console.log('[shot]', name);
  }
  app.isQuitting = true;
  app.quit();
}

app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => { if (!S.settings || !S.settings.app.keepInTray) app.quit(); });
