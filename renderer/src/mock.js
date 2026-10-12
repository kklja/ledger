// UI-development stand-in for the Electron bridge. Sample data only; never used in the app.
export function createMock() {
  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((f) => f(p));
  const now = new Date();
  const at = (days, h, m = 0) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m); return d.toISOString(); };
  const ymd = (days) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days); return d.toISOString().slice(0, 10); };
  const st = {
    settings: {
      lms: { canvasUrl: 'https://example.instructure.com', blackboardUrl: 'https://blackboard.example.edu', checkTimes: ['07:30', '12:30', '18:30'], autoCheck: true, showBrowser: false, aiCanBrowse: true, autoRemap: true },
      feeds: [], term: { start: ymd(-50), end: ymd(60) }, ai: { provider: 'claude', claudePath: '', codexPath: '' },
      phone: { enabled: true, port: 47821, key: 'demo', autoInsert: true }, reminders: { assignmentLeadHours: [24, 3], classLeadMinutes: 10, notifyChanges: true },
      app: { launchAtLogin: false, keepInTray: true, theme: 'system', wrap: false }, ignoredLms: [],
    },
    courses: [
      { id: 'c1', code: 'ECON 120', name: 'Principles of Macroeconomics', color: '#4cc2ff', instructor: 'Dr. Patel', aliases: 'macro', lmsKeys: ['canvas:101'], cancelled: [], meetings: [{ days: [1, 3], start: '10:00', end: '11:15', building: 'Business Hall', room: '204', kind: 'Lecture' }] },
      { id: 'c2', code: 'ACCT 201', name: 'Financial Accounting', color: '#6ccb5f', instructor: 'Prof. Kim', aliases: 'fin acct', lmsKeys: ['blackboard:_77_1'], cancelled: [], meetings: [{ days: [2, 4], start: '13:00', end: '14:15', building: 'Alder Center', room: '118', kind: 'Lecture' }] },
      { id: 'c3', code: 'MATH 130', name: 'Business Calculus', color: '#ffb454', instructor: '', aliases: 'calc', lmsKeys: ['canvas:103'], cancelled: [], meetings: [{ days: [1, 3, 5], start: '08:30', end: '09:20', building: 'Science 2', room: 'B12', kind: 'Lecture' }, { days: [now.getDay()], start: '15:00', end: '15:50', building: 'Science 2', room: 'Lab 4', kind: 'Lab' }] },
    ],
    reminders: [
      { id: 'r1', title: 'Email Prof. Kim about exam conflict', at: at(0, 17), courseId: 'c2', done: false },
      { id: 'r2', title: 'Buy blue books', at: at(1, 9), courseId: '', done: false },
    ],
    events: [
      { id: 'e1', courseId: 'c1', date: ymd(9), time: '10:00', title: 'Midterm 2 (Ch. 8–12)', kind: 'exam', note: 'syllabus p.3', source: 'syllabus' },
      { id: 'e2', courseId: 'c1', date: ymd(2), time: '', title: 'Read Ch. 10: Aggregate demand', kind: 'reading', note: '', source: 'syllabus' },
    ],
    lms: {
      lastCheck: at(0, Math.max(0, now.getHours() - 2)), sources: { canvas: { status: 'ok', lastOk: at(0, 7) }, blackboard: { status: 'ok', lastOk: at(0, 7) } },
      courses: [{ key: 'canvas:101', source: 'canvas', code: 'ECON-120-02', name: 'Principles of Macroeconomics' }],
      assignments: [
        { key: 'canvas:a:1', source: 'canvas', courseKey: 'canvas:101', title: 'Problem Set 6: Fiscal Policy', due: at(1, 23, 59), points: 20, status: 'open', url: 'https://example.com', details: 'Answer questions 1–8 from chapter 10.' },
        { key: 'blackboard:a:2', source: 'blackboard', courseKey: 'blackboard:_77_1', title: 'Homework 5 — Adjusting Entries', due: at(3, 23, 59), points: 30, status: 'open', url: 'https://example.com' },
        { key: 'canvas:a:3', source: 'canvas', courseKey: 'canvas:103', title: 'WebAssign 4.2', due: at(0, 23, 59), points: 10, status: 'submitted', url: 'https://example.com' },
        { key: 'blackboard:a:4', source: 'blackboard', courseKey: 'blackboard:_77_1', title: 'Quiz 4 (Ch. 4)', due: at(-1, 23, 59), points: 15, status: 'missing', url: 'https://example.com' },
      ],
      announcements: [{ key: 'canvas:n:1', source: 'canvas', courseKey: 'canvas:101', title: 'Midterm moved to next Wednesday', posted: at(-1, 15), author: 'Dr. Patel', text: 'Because of the campus closure, Midterm 2 moves to next Wednesday in our usual room.', url: 'https://example.com' }],
      events: [], syllabi: {},
    },
    feeds: {},
    activity: [
      { at: at(-1, 15), kind: 'announcement', courseId: 'c1', text: 'Announcement: Midterm moved to next Wednesday', source: 'canvas' },
      { at: at(-1, 15), kind: 'due-changed', courseId: 'c2', text: 'Due date changed: Homework 5 — Thu → Sat', source: 'blackboard' },
    ],
    inbox: [], pending: [], status: { checking: false, checkLog: '', lastError: '', loginOpen: false, phoneError: '' }, dataDir: 'C:\\Users\\you\\Documents\\Ledger', runs: [],
  };
  const notes = {
    n1: { id: 'n1', title: 'Lecture 14 — Fiscal policy', courseId: 'c1', created: at(-2, 10), updated: at(-2, 11),
      text: '# Fiscal policy\n\nGovt spending (G) and taxes (T) shift AD.\n\n- Expansionary: G up or T down  -> AD right\n- Contractionary: G down or T up -> AD left\n\n                                   Multiplier = 1 / (1 - MPC)\n\n::curves k1\n\n## Example\nMPC = 0.8           multiplier = 5\n',
      objects: { k1: { type: 'curves', title: 'AD / AS', xLabel: 'Real GDP (Y)', yLabel: 'Price level', xMax: 20, yMax: 20, curves: [{ name: 'AD', eq: '18 - 0.8Q' }, { name: 'SRAS', eq: '2 + 0.6Q' }], hlines: [], showEq: true, shade: false } } },
  };
  const S = (x) => JSON.parse(JSON.stringify(x));
  const changed = (keys) => setTimeout(() => emit('state:changed', keys), 0);
  return {
    getState: async () => S(st),
    updateSettings: async (p) => { const m = (a, b) => { for (const k in b) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? m(a[k] || {}, b[k]) : b[k]; return a; }; m(st.settings, p); changed(['settings']); return st.settings; },
    saveCourses: async (c) => { st.courses = c; changed(['courses']); },
    ignoreLmsCourse: async () => {},
    saveReminders: async (r) => { st.reminders = r; changed(['reminders']); },
    saveEvents: async (e) => { st.events = e; changed(['events']); },
    clearActivity: async () => { st.activity = []; changed(['activity']); },
    saveInbox: async (i) => { st.inbox = i; changed(['inbox']); },
    resolvePending: async () => {},
    listNotes: async () => Object.values(notes).map((n) => ({ id: n.id, title: n.title, courseId: n.courseId, updated: n.updated, created: n.created, preview: n.text.slice(0, 120) })),
    getNote: async (id) => S(notes[id]),
    saveNote: async (n) => { n.updated = new Date().toISOString(); notes[n.id] = S(n); return n; },
    deleteNote: async (id) => { delete notes[id]; changed(['notes']); },
    saveImage: async () => 'demo.png',
    listQuizzes: async () => [], getQuiz: async () => null, saveQuiz: async () => {},
    checkCoursework: async () => { throw new Error('Not available in the browser preview'); },
    openLogin: async () => {}, syncFeeds: async () => {},
    aiDetect: async () => ({ claude: 'C:\\...\\claude.exe', codex: 'C:\\...\\codex.exe', edge: 'msedge.exe' }),
    aiRun: async () => { throw new Error('Not available in the browser preview'); }, aiCancel: async () => {}, aiGet: async () => null,
    phoneInfo: async () => ({ url: 'http://192.168.1.20:47821/?k=demo', uploadUrl: 'http://192.168.1.20:47821/upload?k=demo', qr: '', enabled: true, running: true }),
    openExternal: async () => {}, openDataDir: async () => {}, openCourseFiles: async () => {}, testNotification: async () => {},
    checkForUpdates: async () => {}, installUpdate: async () => {},
    on: (ch, fn) => { (listeners[ch] = listeners[ch] || []).push(fn); return () => {}; },
  };
}
