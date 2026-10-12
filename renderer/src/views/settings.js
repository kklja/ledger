import { api } from '../api.js';
import { app } from '../state.js';
import { h, clear, toast, rid, rel } from '../util.js';
import { watchRun } from './shared.js';

const errMsg = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
let phone = null;
let detect = null;

export function mount(el) {
  const render = () => {
    const top = el.scrollTop;
    clear(el).append(page());
    el.scrollTop = top;
  };
  render();
  api.phoneInfo().then((p) => { phone = p; render(); });
  api.aiDetect().then((d) => { detect = d; render(); });
  return {
    update: (keys) => {
      const a = document.activeElement;
      if (el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (!keys || keys.some((k) => ['settings', 'status', 'feeds'].includes(k))) api.phoneInfo().then((p) => { phone = p; render(); });
    },
  };
}

const set = (patch) => api.updateSettings(patch).catch((e) => toast(errMsg(e), 'bad'));
const field = (label, input, help) => [h('label', { class: 'l' }, label), h('div', null, input, help ? h('div', { class: 'help', style: { marginTop: '4px' } }, help) : null)];
const check = (label, value, onChange) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) }), label);
const section = (title, ...body) => h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, title)), h('div', { class: 'pb' }, ...body));

function page() {
  const s = app.st.settings;
  const st = app.st;
  const p = h('div', { class: 'page', style: { maxWidth: '980px' } });
  p.append(h('div', { class: 'pagehead' }, h('div', null, h('h1', null, 'Settings'), h('div', { class: 'sub' }, `Data folder: ${st.dataDir}`)), h('button', { class: 'btn', onclick: () => api.openDataDir() }, 'Open data folder')));

  // ---- coursework ----
  p.append(section('Coursework — AI checks Canvas & Blackboard',
    h('div', { class: 'form' },
      ...field('Canvas address', h('input', { class: 'in', style: { width: '100%' }, value: s.lms.canvasUrl, placeholder: 'https://yourschool.instructure.com', onchange: (e) => set({ lms: { canvasUrl: e.target.value.trim() } }) })),
      ...field('Blackboard address', h('input', { class: 'in', style: { width: '100%' }, value: s.lms.blackboardUrl, placeholder: 'https://blackboard.yourschool.edu', onchange: (e) => set({ lms: { blackboardUrl: e.target.value.trim() } }) })),
      ...field('Automatic checks', h('div', { class: 'row wrap' },
        check('Check automatically at', s.lms.autoCheck, (v) => set({ lms: { autoCheck: v } })),
        h('input', { class: 'in', style: { width: '220px' }, value: (s.lms.checkTimes || []).join(', '), placeholder: '07:30, 12:30, 18:30', onchange: (e) => {
          const times = e.target.value.split(/[ ,;]+/).map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map((t) => t.padStart(5, '0'));
          set({ lms: { checkTimes: times } });
        } })), 'Ledger must be running (it lives in the system tray). Each check uses some of your AI subscription; three a day is plenty for most people.'),
      ...field('Options', h('div', null,
        h('div', null, check('Let the AI also open the sites during study tasks (slides, readings, files)', s.lms.aiCanBrowse, (v) => set({ lms: { aiCanBrowse: v } }))),
        h('div', null, check('Keep the syllabus calendar up to date automatically (you approve each change)', s.lms.autoRemap, (v) => set({ lms: { autoRemap: v } }))),
        h('div', null, check('Show the browser window while the AI works (otherwise it runs hidden)', s.lms.showBrowser, (v) => set({ lms: { showBrowser: v } }))))),
      ...field('Sign-in', h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => api.openLogin().catch((e) => toast(errMsg(e), 'bad')) }, st.status.loginOpen ? 'Sign-in window open…' : 'Sign in to school sites'),
        h('span', { class: 'faint small' }, st.lms.lastCheck ? `Last check ${rel(new Date(st.lms.lastCheck))}` : '')),
        'Opens Microsoft Edge with Ledger\'s own private profile. Log in to Canvas and Blackboard (tick "stay signed in" / "remember this device" for Duo), then close the window. The AI uses that session; it never sees or types your password and is told to never submit or change anything.'),
    )));

  // ---- AI ----
  const testBtn = h('button', { class: 'btn', onclick: () => api.aiRun('test', {}).then((id) => watchRun(id, 'Testing AI connection', (run) => toast(`AI replied: ${(run.result?.text || '').slice(0, 60)}`, 'ok'))).catch((e) => toast(errMsg(e), 'bad')) }, 'Test connection');
  p.append(section('AI (your subscription, no API key)',
    h('div', { class: 'form' },
      ...field('Use', h('div', { class: 'row' }, h('select', { class: 'in', value: s.ai.provider, onchange: (e) => set({ ai: { provider: e.target.value } }) }, h('option', { value: 'claude' }, 'Claude (Claude Code)'), h('option', { value: 'codex' }, 'ChatGPT (Codex)')), testBtn)),
      ...field('Claude Code', h('input', { class: 'in mono', style: { width: '100%' }, value: s.ai.claudePath, placeholder: detect ? detect.claude || 'Not found — install Claude Code or the Claude app' : 'detecting…', onchange: (e) => set({ ai: { claudePath: e.target.value.trim() } }) }), 'Leave empty to auto-detect. Uses the account you are logged into in Claude Code.'),
      ...field('Codex', h('input', { class: 'in mono', style: { width: '100%' }, value: s.ai.codexPath, placeholder: detect ? detect.codex || 'Not found — install the Codex app' : 'detecting…', onchange: (e) => set({ ai: { codexPath: e.target.value.trim() } }) }), 'Leave empty to auto-detect. Uses your ChatGPT login from the Codex app.'),
      ...field('Browser', h('span', { class: detect && detect.edge ? 'ok-t' : 'danger-t' }, detect ? (detect.edge ? 'Microsoft Edge found' : 'Microsoft Edge not found') : '…')),
    )));

  // ---- phone ----
  p.append(section('iPhone → screenshots into notes (free, no App Store app)',
    h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '20px' } },
      phone && phone.qr ? h('div', { class: 'qr' }, h('img', { src: phone.qr, width: 200, height: 200, alt: 'QR code' })) : h('div', { class: 'qr', style: { width: '216px', height: '216px' } }),
      h('div', { class: 'grow' },
        h('div', { class: 'row wrap', style: { marginBottom: '8px' } },
          check('Enabled', s.phone.enabled, (v) => set({ phone: { enabled: v } })),
          check('Insert into the open note automatically', s.phone.autoInsert, (v) => set({ phone: { autoInsert: v } })),
          h('span', { class: 'muted' }, 'Port'), h('input', { class: 'in', style: { width: '80px' }, value: s.phone.port, onchange: (e) => set({ phone: { port: Number(e.target.value) || 47821 } }) }),
          h('button', { class: 'btn sm', onclick: () => set({ phone: { key: rid(12) } }), title: 'Old QR codes and shortcuts stop working' }, 'New pairing key')),
        phone ? h('div', { class: phone.error ? 'danger-t' : phone.running ? 'ok-t' : 'faint', style: { marginBottom: '8px' } }, phone.error || (phone.running ? `Listening on ${phone.ip}:${s.phone.port}` : 'Off')) : null,
        h('div', { class: 'help' },
          h('b', null, 'Option A — Safari page (simplest)'),
          h('ol', null, h('li', null, 'iPhone and PC on the same Wi-Fi. Scan the QR code with the Camera app.'), h('li', null, 'Tap "Choose screenshots / photos". In Safari: Share → Add to Home Screen to keep it one tap away.'), h('li', null, 'If Windows asks about the firewall the first time, allow Ledger on Private networks.')),
          h('b', null, 'Option B — Share-sheet Shortcut (send right after taking a screenshot)'),
          h('ol', null,
            h('li', null, 'Shortcuts app → + → name it "Send to Ledger". Turn on "Show in Share Sheet" (accept Images).'),
            h('li', null, 'Add "Convert Image" → JPEG. Add "Get Contents of URL" with the URL below, Method POST, Request Body: File, File = Converted Image.'),
            h('li', null, 'Optional: add "Get Latest Screenshots" (count 1) before it and add the shortcut to the Back Tap setting (Settings → Accessibility → Touch → Back Tap) — double-tap the back of your phone to send the last screenshot.')),
          phone ? h('div', { class: 'row', style: { marginTop: '6px' } }, h('input', { class: 'in mono grow', readonly: true, value: phone.uploadUrl, onclick: (e) => e.target.select() }), h('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText(phone.uploadUrl); toast('Copied', 'ok'); } }, 'Copy')) : null,
          h('div', { class: 'faint', style: { marginTop: '6px' } }, 'Works on your home/dorm network. Some campus Wi-Fi blocks device-to-device traffic; then use your phone hotspot or iCloud Photos.'))))));

  // ---- reminders ----
  p.append(section('Reminders & notifications',
    h('div', { class: 'form' },
      ...field('Deadline reminders', h('div', { class: 'row' }, h('input', { class: 'in', style: { width: '160px' }, value: (s.reminders.assignmentLeadHours || []).join(', '), onchange: (e) => set({ reminders: { assignmentLeadHours: e.target.value.split(/[ ,;]+/).map(Number).filter((n) => n > 0) } }) }), h('span', { class: 'muted' }, 'hours before each unsubmitted assignment, quiz or exam'))),
      ...field('Class alerts', h('div', { class: 'row' }, h('input', { class: 'in', style: { width: '80px' }, value: s.reminders.classLeadMinutes, onchange: (e) => set({ reminders: { classLeadMinutes: Number(e.target.value) || 0 } }) }), h('span', { class: 'muted' }, 'minutes before class, with building + room (0 = off)'))),
      ...field('Changes', check('Notify me when the AI finds new assignments, moved due dates, grades or announcements', s.reminders.notifyChanges, (v) => set({ reminders: { notifyChanges: v } }))),
      ...field('', h('button', { class: 'btn sm', onclick: () => api.testNotification() }, 'Send a test notification')),
    )));

  // ---- feeds ----
  const feeds = s.feeds || [];
  const ft = h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Name'), h('th', null, 'Link'), h('th', null, 'Class'), h('th', null, 'Status'), h('th')));
  for (const f of feeds) {
    const fs = st.feeds[f.id];
    const upd = (patch) => set({ feeds: feeds.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) });
    ft.append(h('tr', null,
      h('td', null, h('input', { class: 'in', style: { width: '130px' }, value: f.name, onchange: (e) => upd({ name: e.target.value }) })),
      h('td', null, h('input', { class: 'in mono', style: { width: '100%' }, value: f.url, onchange: (e) => upd({ url: e.target.value.trim() }) })),
      h('td', null, h('select', { class: 'in', value: f.courseId || '', onchange: (e) => upd({ courseId: e.target.value }) }, h('option', { value: '' }, 'Auto-detect'), st.courses.map((c) => h('option', { value: c.id }, c.code)))),
      h('td', { class: fs ? (fs.ok ? 'ok-t' : 'danger-t') : 'faint' }, fs ? (fs.ok ? `${fs.items.length} items` : fs.error) : '—'),
      h('td', null, h('button', { class: 'btn ghost sm', onclick: () => set({ feeds: feeds.filter((x) => x.id !== f.id) }) }, '✕'))));
  }
  p.append(section('Backup feeds (optional, free, no AI)',
    h('div', { class: 'help', style: { marginBottom: '10px' } }, 'Calendar links give exact due dates between AI checks at no cost. Canvas: Calendar → "Calendar Feed" (bottom right). Blackboard: Calendar → settings gear → "Share Calendar" / "Get external calendar link". Canvas announcements also have an RSS link (Announcements page → "RSS feed").'),
    feeds.length ? ft : null,
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn sm', onclick: () => set({ feeds: [...feeds, { id: rid(), name: 'Calendar feed', url: '', courseId: '' }] }) }, '+ Add feed'),
      feeds.length ? h('button', { class: 'btn sm', onclick: () => api.syncFeeds().then(() => toast('Feeds updated', 'ok')) }, 'Refresh now') : null)));

  // ---- app ----
  const u = st.status.update || {};
  const updText = {
    dev: 'Development build — updates are off',
    checking: 'Checking for updates…',
    current: `Up to date${u.checked ? ` · checked ${rel(new Date(u.checked))}` : ''}`,
    downloading: `Downloading ${u.version ? `version ${u.version}` : 'update'}… ${u.percent || 0}%`,
    ready: `Version ${u.version} is ready`,
    error: `Couldn't check for updates: ${u.error || ''}`,
  }[u.state] || 'Updates check automatically every 2 hours';
  p.append(section('App',
    h('div', { class: 'form' },
      ...field('Version', h('div', { class: 'row wrap' },
        h('b', null, `Ledger ${st.version || ''}`),
        h('span', { class: u.state === 'error' ? 'danger-t' : u.state === 'ready' ? 'ok-t' : 'muted' }, updText),
        u.state === 'ready' ? h('button', { class: 'btn primary sm', onclick: () => api.installUpdate() }, 'Restart to update') : h('button', { class: 'btn sm', disabled: u.state === 'checking' || u.state === 'downloading' || u.state === 'dev', onclick: () => api.checkForUpdates() }, 'Check for updates')),
        'Updates come from GitHub and install by themselves when Ledger is in the tray — no installers to download.'),
      ...field('Theme', h('select', { class: 'in', value: s.app.theme === 'light' ? 'light' : 'dark', onchange: (e) => set({ app: { theme: e.target.value } }) }, h('option', { value: 'dark' }, 'Black (OLED)'), h('option', { value: 'light' }, 'Light'))),
      ...field('Startup', check('Start Ledger when I sign in to Windows (needed for reminders and automatic checks)', s.app.launchAtLogin, (v) => set({ app: { launchAtLogin: v } }))),
      ...field('Closing', check('Closing the window keeps Ledger running in the tray', s.app.keepInTray, (v) => set({ app: { keepInTray: v } }))),
      ...field('Notes', check('Wrap long lines by default', s.app.wrap, (v) => set({ app: { wrap: v } }))),
    )));
  return p;
}
