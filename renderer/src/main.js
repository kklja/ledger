import { api, isMock } from './api.js';
import { app, refresh, onChange } from './state.js';
import { h, clear, toast, rel } from './util.js';
import { quickAddBox } from './quickadd.js';
import nav, { setGo } from './nav.js';
import * as Today from './views/today.js';
import * as Calendar from './views/calendar.js';
import * as Notes from './views/notes.js';
import * as Coursework from './views/coursework.js';
import * as AI from './views/ai.js';
import * as Courses from './views/courses.js';
import * as Settings from './views/settings.js';

// Icons are Segoe Fluent Icons glyphs (built into Windows 11; MDL2 on Windows 10).
const VIEWS = [
  { id: 'today', label: 'Today', icon: '', mod: Today },
  { id: 'calendar', label: 'Calendar', icon: '', mod: Calendar },
  { id: 'notes', label: 'Notes', icon: '', mod: Notes, fill: true },
  { id: 'coursework', label: 'Coursework', icon: '', mod: Coursework },
  { id: 'ai', label: 'AI Study', icon: '', mod: AI },
  { id: 'courses', label: 'Classes', icon: '', mod: Courses },
  { id: 'settings', label: 'Settings', icon: '', mod: Settings },
];

let mounted = null;
let viewEl, navEl, footEl, statusEl;

function go(id, opts = {}) {
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  if (mounted && mounted.destroy) mounted.destroy();
  nav.current = v.id;
  clear(viewEl);
  viewEl.className = `view ${v.fill ? 'fill' : ''}`;
  viewEl.scrollTop = 0;
  mounted = v.mod.mount(viewEl, opts) || {};
  renderNav();
}
setGo(go);
window.__ledgerGo = go; // used by the dev screenshot mode

function renderNav() {
  clear(navEl);
  const st = app.st;
  const upcomingCount = (st.pending || []).length;
  VIEWS.forEach((v, i) => {
    let badge = null;
    if (v.id === 'today' && upcomingCount) badge = h('span', { class: 'badge', title: 'Schedule changes to review' }, String(upcomingCount));
    if (v.id === 'notes') { const n = (st.inbox || []).filter((x) => !x.used).length; if (n) badge = h('span', { class: 'badge', title: 'Images from your phone' }, String(n)); }
    navEl.append(h('div', { class: `navitem ${nav.current === v.id ? 'active' : ''}`, title: `${v.label} (Ctrl+${i + 1})`, onclick: () => go(v.id) },
      h('span', { class: 'ic' }, v.icon), h('span', { class: 'lbl' }, v.label), badge));
  });
}

function renderFoot() {
  const st = app.st;
  const s = st.status;
  const L = st.lms;
  let dot = 'idle', text = 'Coursework: not set up';
  if (s.checking) { dot = 'run'; text = 'Checking Canvas/Blackboard…'; }
  else if (s.loginOpen) { dot = 'run'; text = 'Sign-in window open'; }
  else if (s.lastError) { dot = 'bad'; text = s.lastError.slice(0, 80); }
  else if (L.lastCheck) { dot = 'ok'; text = `Checked ${rel(new Date(L.lastCheck))}`; }
  clear(footEl).append(
    h('div', { title: s.lastError || '' }, h('span', { class: `dot ${dot}` }), text),
    h('div', { class: 'faint' }, `AI: ${st.settings.ai.provider === 'codex' ? 'Codex' : 'Claude'} · Phone: ${st.settings.phone.enabled ? (s.phoneError ? 'error' : 'on') : 'off'}`),
    isMock ? h('div', { class: 'warn-t' }, 'Browser preview (sample data)') : null,
    s.update && s.update.state === 'ready' ? h('a', { onclick: () => api.installUpdate() }, `Update ${s.update.version} ready · Restart`) : null,
  );
  clear(statusEl).append(s.checking ? h('span', { class: 'warn-t' }, 'AI is checking coursework…') : null);
}

function applyTheme() {
  // OLED black unless the light theme is chosen explicitly.
  document.documentElement.dataset.theme = app.st.settings.app.theme === 'light' ? 'light' : 'dark';
}

async function boot() {
  await refresh();
  const quick = quickAddBox();
  navEl = h('div', { class: 'navlist' });
  footEl = h('div', { class: 'side-foot' });
  statusEl = h('div', { class: 'status' });
  viewEl = h('div', { class: 'view' });
  const root = document.getElementById('app');
  root.append(
    h('nav', { class: 'side' }, h('div', { class: 'brand' }, h('span', { class: 'mark' }), 'LEDGER'), navEl, footEl),
    h('main', { class: 'main' },
      h('header', { class: 'top' }, quick.el, h('div', { class: 'spacer' }), statusEl,
        h('button', { class: 'btn', title: 'Have the AI check Canvas & Blackboard now', onclick: async () => {
          try { toast('Checking coursework… this can take a few minutes.'); const r = await api.checkCoursework(); toast(`Check finished · ${r.changes} change${r.changes === 1 ? '' : 's'}`, 'ok'); } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'bad'); }
        } }, 'Check now')),
      viewEl),
  );
  applyTheme();
  renderFoot();
  go('today');

  onChange((keys) => {
    if (!keys || keys.includes('settings')) applyTheme();
    renderFoot();
    renderNav();
    if (mounted && mounted.update) mounted.update(keys);
  });
  api.on('state:changed', (keys) => refresh(keys));
  api.on('nav', (n) => n && n.view && go(n.view));
  api.on('phone:image', async (item) => {
    await refresh(['inbox']);
    if (Notes.insertPhoneImage(item)) toast('Inserted image from your phone', 'ok');
    else toast('Image from your phone → Notes inbox', 'ok');
  });

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= VIEWS.length && !e.shiftKey) { e.preventDefault(); go(VIEWS[n - 1].id); }
    else if (e.key.toLowerCase() === 'k') { e.preventDefault(); quick.input.focus(); }
    else if (e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); go('notes', { newNote: true }); }
  });
  setInterval(renderFoot, 60000);
}

boot().catch((e) => {
  document.body.append(h('pre', { style: { padding: '20px', color: 'crimson' } }, String(e && e.stack || e)));
  console.error(e);
});
