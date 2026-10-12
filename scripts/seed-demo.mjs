// node scripts/seed-demo.mjs <dataDir>  — writes sample data for screenshots/testing (never your real data folder).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: seed-demo.mjs <dataDir>');
mkdirSync(join(dir, 'notes'), { recursive: true });
const now = new Date();
const at = (d, h, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, h, m).toISOString();
const ymd = (d) => { const x = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const w = (f, v) => writeFileSync(join(dir, f), JSON.stringify(v, null, 1));
const dow = now.getDay();

w('settings.json', { lms: { canvasUrl: 'https://example.instructure.com', blackboardUrl: 'https://blackboard.example.edu' }, term: { start: ymd(-50), end: ymd(60) } });
w('courses.json', [
  { id: 'c1', code: 'ECON 120', name: 'Principles of Macroeconomics', color: '#4cc2ff', instructor: 'Dr. Patel', aliases: 'macro', lmsKeys: ['canvas:101'], cancelled: [], meetings: [{ days: [1, 3, dow], start: '10:00', end: '11:15', building: 'Business Hall', room: '204', kind: 'Lecture' }] },
  { id: 'c2', code: 'ACCT 201', name: 'Financial Accounting', color: '#6ccb5f', instructor: 'Prof. Kim', aliases: '', lmsKeys: ['blackboard:_77_1'], cancelled: [], meetings: [{ days: [2, 4, dow], start: '13:00', end: '14:15', building: 'Alder Center', room: '118', kind: 'Lecture' }] },
  { id: 'c3', code: 'MATH 130', name: 'Business Calculus', color: '#ffb454', instructor: 'Dr. Ruiz', aliases: 'calc', lmsKeys: ['canvas:103'], cancelled: [], meetings: [{ days: [1, 3, 5], start: '08:30', end: '09:20', building: 'Science 2', room: 'B12', kind: 'Lecture' }, { days: [dow], start: '15:00', end: '15:50', building: 'Science 2', room: 'Lab 4', kind: 'Lab' }] },
]);
w('reminders.json', [
  { id: 'r1', title: 'Email Prof. Kim about exam conflict', at: at(0, 17), courseId: 'c2', done: false, notified: false },
  { id: 'r2', title: 'Buy blue books', at: at(1, 9), courseId: '', done: false, notified: false },
]);
w('events.json', [
  { id: 'e1', courseId: 'c1', date: ymd(9), time: '10:00', title: 'Midterm 2 (Ch. 8–12)', kind: 'exam', note: 'moved per announcement', source: 'syllabus' },
  { id: 'e2', courseId: 'c1', date: ymd(2), time: '', title: 'Read Ch. 10: Aggregate demand', kind: 'reading', note: '', source: 'syllabus' },
  { id: 'e3', courseId: 'c2', date: ymd(5), time: '13:00', title: 'Quiz 5 (Ch. 5)', kind: 'quiz', note: 'syllabus p.2', source: 'syllabus' },
]);
w('lms.json', {
  lastCheck: at(0, Math.max(0, now.getHours() - 2)),
  sources: { canvas: { status: 'ok', lastOk: at(0, 7) }, blackboard: { status: 'ok', lastOk: at(0, 7) } },
  courses: [{ key: 'canvas:101', source: 'canvas', id: '101', code: 'ECON-120-02', name: 'Principles of Macroeconomics' }, { key: 'blackboard:_77_1', source: 'blackboard', id: '_77_1', code: 'ACCT201', name: 'Financial Accounting' }, { key: 'canvas:103', source: 'canvas', id: '103', code: 'MATH-130', name: 'Business Calculus' }],
  assignments: [
    { key: 'canvas:a:1', source: 'canvas', courseKey: 'canvas:101', title: 'Problem Set 6: Fiscal Policy', due: at(1, 23, 59), points: 20, status: 'open', url: 'https://example.com', details: 'Answer questions 1–8 from chapter 10.' },
    { key: 'blackboard:a:2', source: 'blackboard', courseKey: 'blackboard:_77_1', title: 'Homework 5 — Adjusting Entries', due: at(3, 23, 59), points: 30, status: 'open', url: 'https://example.com' },
    { key: 'canvas:a:3', source: 'canvas', courseKey: 'canvas:103', title: 'WebAssign 4.2', due: at(0, 23, 59), points: 10, status: 'submitted', url: 'https://example.com' },
    { key: 'blackboard:a:4', source: 'blackboard', courseKey: 'blackboard:_77_1', title: 'Quiz 4 (Ch. 4)', due: at(-1, 23, 59), points: 15, status: 'missing', url: 'https://example.com' },
    { key: 'canvas:a:5', source: 'canvas', courseKey: 'canvas:101', title: 'Reading response 7', due: at(6, 9), points: 5, status: 'open', url: 'https://example.com' },
  ],
  announcements: [{ key: 'canvas:n:1', source: 'canvas', courseKey: 'canvas:101', title: 'Midterm moved to next Wednesday', posted: at(-1, 15), author: 'Dr. Patel', text: 'Because of the campus closure, Midterm 2 moves to next Wednesday in our usual room (Business Hall 204). Chapters 8–12.', url: 'https://example.com' }],
  events: [], syllabi: {},
});
w('activity.json', [
  { at: at(-1, 15), kind: 'announcement', courseId: 'c1', text: 'Announcement: Midterm moved to next Wednesday', source: 'canvas' },
  { at: at(-1, 15), kind: 'due-changed', courseId: 'c2', text: 'Due date changed: Homework 5 — Thu → Sat', source: 'blackboard' },
]);
w('pending.json', [{ id: 'p1', courseId: 'c1', created: at(-1, 15), reason: 'auto', items: [], added: [{ date: ymd(16), time: '', title: 'Problem Set 7 due', kind: 'due', note: '' }], removed: [], changed: [{ from: { date: ymd(7), time: '10:00', title: 'Midterm 2' }, to: { date: ymd(9), time: '10:00', title: 'Midterm 2', note: 'moved per announcement' } }] }]);
w('notes/n1.json', {
  id: 'n1', title: 'Lecture 14 — Fiscal policy', courseId: 'c1', created: at(-2, 10), updated: at(-2, 11),
  text: '# Fiscal policy\n\nGovt spending (G) and taxes (T) shift AD.\n\n- Expansionary: G up or T down     -> AD shifts right\n- Contractionary: G down or T up   -> AD shifts left\n\n                                        Multiplier = 1 / (1 - MPC)\n                                        MPC = 0.8  ->  multiplier = 5\n\n::curves k1\n\n## Example: bond issue\n::journal j1\n\n::table t1\n',
  objects: {
    k1: { type: 'curves', title: 'Market for loanable funds', xLabel: 'Quantity (Q)', yLabel: 'Interest rate', xMax: 20, yMax: 20, curves: [{ name: 'D', eq: '18 - 0.8Q' }, { name: 'S', eq: '2 + 0.6Q' }], hlines: [], showEq: true, shade: true },
    j1: { type: 'journal', memo: 'Issued bonds at face value', rows: [{ date: 'Jan 1', account: 'Cash', debit: '50000', credit: '' }, { date: '', account: 'Bonds Payable', debit: '', credit: '50000' }] },
    t1: { type: 'table', title: 'Budget', rows: [['Item', 'Amount'], ['Spending', '1200'], ['Taxes', '(950)'], ['Deficit', '=SUM(B2:B3)']], header: true, formats: ['text', 'accounting'] },
  },
});
console.log('seeded', dir);
