// node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { computeTable, parseNumber, compileCurve, formatValue, evaluate, parse } = require('../shared/formula');
const { markdownToNote, noteToMarkdown } = require('../shared/notes-md');
const { classOccurrences } = require('../shared/schedule');
const lms = require('../main/lms');
const { parseIcs, parseFeedXml } = require('../main/feeds');
const { extractJson } = require('../main/ai');

test('table formulas', () => {
  const t = computeTable({ rows: [['Item', 'Amt'], ['Rent', '$1,200.00'], ['Food', '(300)'], ['Total', '=SUM(B2:B3)'], ['Avg', '=ROUND(AVG(B2:B3)/3, 2)'], ['Bad', '=B9+'], ['Loop', '=B7']], formats: ['text', 'accounting'] });
  assert.strictEqual(t[3][1].value, 900);
  assert.strictEqual(t[3][1].display, '900.00');
  assert.strictEqual(t[2][1].display, '(300.00)');
  assert.strictEqual(t[4][1].value, 150);
  assert.ok(t[5][1].error);
  assert.ok(t[6][1].error, 'circular reference is an error');
});

test('finance functions match Excel', () => {
  const ev = (s) => evaluate(parse(s), {});
  assert.ok(Math.abs(ev('PMT(0.05/12, 360, 250000)') - -1342.05) < 0.01);
  assert.ok(Math.abs(ev('FV(0.06, 10, -1000)') - 13180.79) < 0.01);
  assert.ok(Math.abs(ev('PV(0.08, 5, -2000)') - 7985.42) < 0.01);
  assert.ok(Math.abs(ev('NPV(0.1, 100, 200, 300)') - 481.59) < 0.01);
});

test('numbers and curves', () => {
  assert.strictEqual(parseNumber('12%'), 0.12);
  assert.strictEqual(parseNumber('abc'), NaN);
  assert.strictEqual(compileCurve('20 - 2Q')(3), 14);
  assert.strictEqual(compileCurve('P = 2 + 0.5Q')(4), 4);
  assert.strictEqual(formatValue(-1234.5, 'currency'), '($1,234.50)');
});

test('markdown tables become table blocks and back', () => {
  let n = 0;
  const { text, objects } = markdownToNote('# Guide\n\n| Account | Debit | Credit |\n|---|---|---|\n| Cash | 500 | |\n| Revenue | | 500 |\n\nDone **now**', () => `t${++n}`);
  assert.match(text, /^::table t1$/m);
  assert.deepStrictEqual(objects.t1.rows[1], ['Cash', '500', '']);
  assert.match(text, /Done now/);
  const md = noteToMarkdown({ title: 'X', text, objects });
  assert.match(md, /\| Cash \| 500 \|/);
});

test('class occurrences respect term and days', () => {
  const courses = [{ id: 'a', meetings: [{ days: [1, 3], start: '10:00', end: '11:15' }] }];
  const occ = classOccurrences(courses, { start: '2026-10-05', end: '2026-10-09' }, new Date(2026, 9, 1), new Date(2026, 9, 20));
  assert.deepStrictEqual(occ.map((o) => o.date), ['2026-10-05', '2026-10-07']);
  assert.strictEqual(occ[0].start.getHours(), 10);
});

test('lms normalize, merge and diff', () => {
  const raw = (due, extra = []) => ({
    sources: { canvas: { status: 'ok' }, blackboard: { status: 'login_required' } },
    courses: [{ source: 'canvas', id: '1', code: 'ECON 120', name: 'Macro' }],
    assignments: [{ source: 'canvas', id: '9', courseId: '1', title: 'PS 6', due, status: 'open' }, { source: 'nope', title: 'x' }, ...extra],
    announcements: [], events: [], syllabi: [],
  });
  const first = lms.merge(lms.EMPTY, lms.normalize(raw('2026-10-12T23:59:00Z')));
  assert.strictEqual(first.assignments.length, 1, 'invalid source dropped');
  assert.deepStrictEqual(lms.diff(lms.EMPTY, first), [], 'no flood on first check');
  const second = lms.merge(first, lms.normalize(raw('2026-10-14T23:59:00Z', [{ source: 'canvas', id: '10', courseId: '1', title: 'Quiz 4', due: '2026-10-20T15:00:00Z' }])));
  const kinds = lms.diff(first, second).map((c) => c.kind).sort();
  assert.deepStrictEqual(kinds, ['due-changed', 'new-assignment']);
  // a failed site keeps its previous data
  const failed = lms.merge(second, lms.normalize({ sources: { canvas: { status: 'error' }, blackboard: { status: 'skipped' } } }));
  assert.strictEqual(failed.assignments.length, 2);
});

test('ical and atom parsing', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a1\r\nSUMMARY:Homework 3 [ECON-120-02]\r\nDTSTART:20261015T035900Z\r\nURL:https://x/1\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:a2\r\nSUMMARY:Exam\\, part 1\r\nDTSTART;VALUE=DATE:20261020\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:a3\r\nSUMMARY:Lab\r\nDTSTART;TZID=America/New_York:20261021T090000\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const items = parseIcs(ics);
  assert.strictEqual(items[0].start, '2026-10-15T03:59:00.000Z');
  assert.strictEqual(items[1].title, 'Exam, part 1');
  assert.ok(items[1].allDay);
  assert.strictEqual(items[2].start, '2026-10-21T13:00:00.000Z');
  const atom = parseFeedXml('<feed><entry><id>tag:1</id><title>Midterm moved</title><updated>2026-10-01T12:00:00Z</updated><link href="https://x/a"/><content type="html">&lt;p&gt;Now Wed&lt;/p&gt;</content></entry></feed>');
  assert.strictEqual(atom[0].title, 'Midterm moved');
  assert.strictEqual(atom[0].text, 'Now Wed');
});

test('codex runs headless with only the Ledger browser server, pre-approved', () => {
  const { codexArgs, browserServer } = require('../main/ai');
  const server = browserServer({ profileDir: 'C:\\p', headless: true, outputDir: 'C:\\o' });
  const args = codexArgs({ cwd: 'C:\\ctx', outFile: 'C:\\out.txt', server });
  assert.ok(args.includes('--ignore-user-config'), 'Codex app plugins stay out');
  assert.ok(args.includes("mcp_servers.playwright.default_tools_approval_mode='approve'"));
  assert.ok(args.includes("mcp_servers.playwright.env={ELECTRON_RUN_AS_NODE='1'}"));
  assert.ok(!args.some((a) => a.includes('"')), 'no double quotes that Windows quoting could strip');
  assert.strictEqual(args[args.length - 1], '-');
});

test('extractJson tolerates fences and chatter', () => {
  assert.deepStrictEqual(extractJson('Sure!\n```json\n{"a": [1]}\n```'), { a: [1] });
  assert.deepStrictEqual(extractJson('here {"b": 2} done'), { b: 2 });
});
