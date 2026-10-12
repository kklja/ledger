import { api } from '../api.js';
import { app, course, courseForLms, buildItems } from '../state.js';
import { h, clear, fmtWhen, rel, dayLabel, fmtTime, toast, addDays } from '../util.js';
import { go } from '../nav.js';

const ui = { tab: 'upcoming', courseId: '', showLog: false, open: new Set() };
const errMsg = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function mount(el, opts = {}) {
  if (opts.tab) ui.tab = opts.tab;
  let logEl = null;
  const render = () => {
    const top = el.scrollTop;
    clear(el).append(page((l) => (logEl = l)));
    el.scrollTop = top;
  };
  render();
  const off = api.on('check:log', (t) => { if (logEl) { logEl.append(t); logEl.scrollTop = logEl.scrollHeight; } });
  return { update: (keys) => { if (!keys || keys.some((k) => ['lms', 'status', 'activity', 'courses', 'feeds', 'settings'].includes(k))) render(); }, destroy: off };
}

const chip = (c) => (c ? h('span', { class: 'chip', style: { '--c': c.color } }, c.code) : h('span', { class: 'faint' }, '—'));

function page(setLog) {
  const st = app.st;
  const L = st.settings.lms;
  const s = st.status;
  const p = h('div', { class: 'page' });
  const configured = L.canvasUrl || L.blackboardUrl;

  p.append(h('div', { class: 'pagehead' },
    h('div', null, h('h1', null, 'Coursework'), h('div', { class: 'sub' },
      st.lms.lastCheck ? `AI last checked ${rel(new Date(st.lms.lastCheck))} · next automatic checks at ${(L.checkTimes || []).join(', ')}` : 'The AI hasn\'t checked your sites yet.')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: !configured || s.checking, onclick: () => api.openLogin().catch((e) => toast(errMsg(e), 'bad')) }, s.loginOpen ? 'Sign-in window open…' : 'Sign in to school sites'),
      h('button', { class: 'btn primary', disabled: !configured || s.checking || s.loginOpen, onclick: async () => {
        try { const r = await api.checkCoursework(); toast(`Check finished · ${r.changes} change${r.changes === 1 ? '' : 's'}`, 'ok'); } catch (e) { toast(errMsg(e), 'bad'); }
      } }, s.checking ? 'Checking…' : 'Check now'))));

  if (!configured) {
    p.append(h('div', { class: 'banner warn' }, h('div', { class: 'grow' }, 'Add your Canvas and Blackboard web addresses first.'), h('button', { class: 'btn sm', onclick: () => go('settings') }, 'Settings')));
  }

  // Site status
  const srcRow = (key, label, url) => {
    const v = (st.lms.sources || {})[key];
    if (!url) return null;
    const stt = v ? v.status : 'never';
    const cls = stt === 'ok' ? 'ok-t' : stt === 'never' ? 'faint' : 'danger-t';
    const text = { ok: 'OK', login_required: 'Sign-in needed — press "Sign in to school sites"', error: `Error${v && v.note ? `: ${v.note}` : ''}`, never: 'Not checked yet', skipped: 'Skipped' }[stt] || stt;
    return h('tr', null, h('td', null, h('b', null, label)), h('td', { class: 'muted' }, url), h('td', { class: cls }, text), h('td', { class: 'faint nowrap' }, v && v.lastOk ? `last OK ${rel(new Date(v.lastOk))}` : ''));
  };
  const logBox = h('div', { class: 'log', style: { display: ui.showLog || s.checking ? 'block' : 'none', margin: '0 12px 12px' } }, s.checkLog || 'No log yet.');
  setLog(logBox);
  p.append(h('div', { class: 'panel' },
    h('div', { class: 'ph' }, h('h2', null, 'Sites the AI reads'), h('button', { class: 'btn ghost sm', onclick: () => { ui.showLog = !ui.showLog; logBox.style.display = ui.showLog ? 'block' : 'none'; } }, 'Agent log')),
    h('div', { class: 'pb flush' }, h('table', { class: 'grid' }, srcRow('canvas', 'Canvas', L.canvasUrl), srcRow('blackboard', 'Blackboard', L.blackboardUrl))),
    s.lastError ? h('div', { class: 'danger-t', style: { padding: '0 12px 10px' } }, s.lastError) : null,
    logBox));

  // Tabs
  const tabs = [['upcoming', 'Upcoming'], ['announcements', 'Announcements'], ['changes', 'What changed'], ['all', 'All assignments']];
  const courseSel = h('select', { class: 'in', onchange: (e) => { ui.courseId = e.target.value; rerender(); } }, h('option', { value: '' }, 'All classes'), st.courses.map((c) => h('option', { value: c.id }, c.code)));
  courseSel.value = ui.courseId;
  const body = h('div');
  const tabBar = h('div', { class: 'row', style: { marginBottom: '10px' } }, h('div', { class: 'seg' }, tabs.map(([k, l]) => h('button', { class: `btn ${ui.tab === k ? 'on' : ''}`, onclick: () => { ui.tab = k; rerender(); } }, l))), h('div', { class: 'grow' }), courseSel);
  const rerender = () => { tabBar.querySelectorAll('.seg .btn').forEach((b, i) => b.classList.toggle('on', tabs[i][0] === ui.tab)); clear(body).append(tabBody()); };
  p.append(tabBar, body);
  rerender();
  return p;
}

function matches(c) { return !ui.courseId || (c && c.id === ui.courseId); }

function tabBody() {
  const st = app.st;
  const now = new Date();
  if (ui.tab === 'upcoming' || ui.tab === 'all') {
    const from = ui.tab === 'upcoming' ? addDays(now, -3) : new Date(2000, 0, 1);
    const items = buildItems(from, addDays(now, ui.tab === 'upcoming' ? 30 : 400)).filter((i) => i.kind === 'due' && matches(i.course));
    const undated = ui.tab === 'all' ? (st.lms.assignments || []).filter((a) => !a.due && matches(courseForLms(a.courseKey))) : [];
    if (!items.length && !undated.length) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'Nothing here yet.'));
    const t = h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Due'), h('th', null, 'Class'), h('th', null, 'Item'), h('th', null, 'Source'), h('th', null, 'Status')));
    for (const i of items) {
      const overdue = i.start < now && !['submitted', 'graded'].includes(i.status);
      const status = overdue ? 'overdue' : i.status || 'open';
      t.append(h('tr', { class: 'click', onclick: () => i.url && api.openExternal(i.url), title: i.details || '' },
        h('td', { class: 'nowrap' }, h('b', null, `${dayLabel(i.start)} ${i.allDay ? '' : fmtTime(i.start)}`), h('div', { class: `small ${overdue ? 'danger-t' : 'faint'}` }, rel(i.start, now))),
        h('td', { class: 'nowrap' }, chip(i.course)),
        h('td', null, i.title, i.details ? h('div', { class: 'faint small', style: { maxWidth: '640px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, i.details) : null),
        h('td', { class: 'muted nowrap' }, i.tag),
        h('td', { class: `nowrap st-${status}` }, status === 'graded' && i.score ? `graded ${i.score}${i.points != null ? `/${i.points}` : ''}` : status)));
    }
    for (const a of undated) t.append(h('tr', { class: 'click', onclick: () => a.url && api.openExternal(a.url) }, h('td', { class: 'faint' }, 'No date'), h('td', null, chip(courseForLms(a.courseKey))), h('td', null, a.title), h('td', { class: 'muted' }, a.source), h('td', { class: `st-${a.status}` }, a.status)));
    return h('div', { class: 'panel' }, h('div', { class: 'pb flush' }, t));
  }
  if (ui.tab === 'announcements') {
    const anns = [...(st.lms.announcements || [])]
      .map((a) => ({ ...a, course: courseForLms(a.courseKey) }))
      .concat(Object.values(st.feeds || {}).flatMap((f) => (f.items || []).filter((i) => i.type === 'rss').map((i) => ({ key: i.key, title: i.title, posted: i.start, text: i.text, url: i.url, course: course(i.courseId), source: 'feed' }))))
      .filter((a) => matches(a.course))
      .sort((a, b) => (b.posted || '').localeCompare(a.posted || ''));
    if (!anns.length) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No announcements in the last 30 days.'));
    const wrap = h('div', { class: 'panel' });
    for (const a of anns) {
      const isOpen = ui.open.has(a.key);
      wrap.append(h('div', { class: 'act', style: { cursor: 'pointer', padding: '10px 12px' }, onclick: () => { isOpen ? ui.open.delete(a.key) : ui.open.add(a.key); clear(wrap.parentElement).append(tabBody()); } },
        h('div', { class: 'row' }, chip(a.course), h('b', { class: 'grow' }, a.title), h('span', { class: 'faint small nowrap' }, a.posted ? `${fmtWhen(new Date(a.posted))} · ${rel(new Date(a.posted))}` : '')),
        h('div', { class: 'muted', style: { marginTop: '4px', whiteSpace: 'pre-wrap', ...(isOpen ? {} : { maxHeight: '40px', overflow: 'hidden' }) } }, a.text || ''),
        isOpen && a.url ? h('a', { onclick: (e) => { e.stopPropagation(); api.openExternal(a.url); } }, 'Open on site →') : null));
    }
    return wrap;
  }
  // changes
  const acts = (st.activity || []).filter((a) => matches(course(a.courseId)));
  const wrap = h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, `${acts.length} changes`), h('button', { class: 'btn ghost sm', onclick: () => api.clearActivity() }, 'Clear')));
  for (const a of acts) wrap.append(h('div', { class: 'act' }, h('div', null, chip(course(a.courseId)), ' ', a.text), h('div', { class: 'meta' }, `${fmtWhen(new Date(a.at))} · ${a.source || ''}`)));
  if (!acts.length) wrap.append(h('div', { class: 'empty' }, 'When the AI finds a new assignment, a moved due date, a grade or an announcement, it is listed here and you get a notification.'));
  return wrap;
}
