import { api } from '../api.js';
import { app, course, visibleCourses, refresh } from '../state.js';
import { h, clear, fmtDay, rel, rid, toast, confirmBox, modal } from '../util.js';
import { createEditor } from '../editor/editor.js';
import { imgUrl } from '../editor/widgets.js';
import { markdownToNote, noteToMarkdown } from '../../../shared/notes-md.js';
import { watchRun } from './shared.js';
import { go } from '../nav.js';

const N = { folder: 'all', noteId: null, search: '', wrap: null, guides: false };
let ed = null;
let note = null;
let saveT = null;
let dirty = false;
let els = null;

export function mount(el, opts = {}) {
  if (N.wrap == null) N.wrap = !!app.st.settings.app.wrap;
  const folders = h('div', { class: 'folders' });
  const list = h('div', { class: 'list' });
  const pane = h('div', { class: 'editor-pane' });
  els = { folders, list, pane };
  el.append(h('div', { class: 'notes' }, folders, list, pane));
  renderFolders();
  renderList();

  (async () => {
    if (opts.newNote) await newNote(opts.courseId || (course(N.folder) ? N.folder : ''), opts.text, opts.title);
    else if (opts.noteId) await open(opts.noteId);
    else if (N.noteId && app.notes.some((n) => n.id === N.noteId)) await open(N.noteId);
    else renderEditor();
    if (opts.inbox) phoneInbox();
  })();

  const onUnload = () => flush();
  window.addEventListener('beforeunload', onUnload);
  return {
    update(keys) {
      if (!keys || keys.some((k) => ['notes', 'courses', 'inbox'].includes(k))) { renderFolders(); renderList(); updateToolbarBadge(); }
    },
    destroy() {
      window.removeEventListener('beforeunload', onUnload);
      flush();
      if (ed) { ed.destroy(); ed = null; }
      els = null;
    },
  };
}

// ---------- persistence ----------
function scheduleSave() {
  dirty = true;
  clearTimeout(saveT);
  saveT = setTimeout(flush, 500);
}

async function flush() {
  clearTimeout(saveT);
  if (!dirty || !note) return;
  dirty = false;
  if (ed) note.text = ed.getText();
  const n = { ...note };
  const saved = await api.saveNote(n);
  note.updated = saved.updated;
  const meta = { id: n.id, title: n.title, courseId: n.courseId, created: n.created || saved.created, updated: saved.updated, preview: n.text.replace(/^::\w+ \w+$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 140) };
  app.notes = [meta, ...app.notes.filter((x) => x.id !== n.id)];
  if (els) renderList();
}

async function open(id) {
  await flush();
  const n = await api.getNote(id);
  if (!n) { N.noteId = null; renderEditor(); return; }
  note = n;
  N.noteId = id;
  renderEditor();
  renderList();
}

async function newNote(courseId = '', md = '', title = '') {
  await flush();
  if (ed) { ed.destroy(); ed = null; } // the old editor must not write into the new note
  const c = course(courseId);
  const conv = md ? markdownToNote(md, () => rid(8)) : { text: '', objects: {} };
  note = { id: rid(10), title: title || `${c ? `${c.code} — ` : ''}${fmtDay(new Date())}`, courseId: courseId || '', text: conv.text, objects: conv.objects, created: new Date().toISOString() };
  N.noteId = note.id;
  if (courseId) N.folder = courseId;
  dirty = true;
  await flush();
  renderFolders();
  renderEditor();
  const t = els && els.pane.querySelector('input.t');
  if (t && !md) { t.focus(); t.select(); }
}

// ---------- folders + list ----------
function renderFolders() {
  if (!els) return;
  const counts = {};
  for (const n of app.notes) counts[n.courseId || ''] = (counts[n.courseId || ''] || 0) + 1;
  const f = (id, label, count, color) => h('div', { class: `folder ${N.folder === id ? 'active' : ''}`, onclick: () => { N.folder = id; renderFolders(); renderList(); } },
    h('span', { class: color ? 'chip' : '', style: color ? { '--c': color } : null }, label), h('span', { class: 'n' }, count || ''));
  clear(els.folders).append(
    h('div', { class: 'grp' }, 'Notes'),
    f('all', 'All notes', app.notes.length),
    h('div', { class: 'grp' }, 'Classes'),
    visibleCourses().map((c) => f(c.id, c.code, counts[c.id], c.color)),
    f('', 'Unfiled', counts['']),
  );
}

function renderList() {
  if (!els) return;
  const q = N.search.toLowerCase();
  const notes = app.notes.filter((n) => (N.folder === 'all' || (n.courseId || '') === N.folder) && (!q || `${n.title} ${n.preview}`.toLowerCase().includes(q)));
  const search = h('input', { class: 'in grow', placeholder: 'Search notes', value: N.search, oninput: (e) => { N.search = e.target.value; renderListBody(); } });
  const body = h('div');
  const renderListBody = () => {
    const qq = N.search.toLowerCase();
    clear(body);
    const shown = app.notes.filter((n) => (N.folder === 'all' || (n.courseId || '') === N.folder) && (!qq || `${n.title} ${n.preview}`.toLowerCase().includes(qq)));
    for (const n of shown) {
      const c = course(n.courseId);
      body.append(h('div', { class: `nitem ${n.id === N.noteId ? 'active' : ''}`, onclick: () => open(n.id) },
        h('div', { class: 'nt' }, n.title || 'Untitled'),
        h('div', { class: 'np' }, n.preview || h('span', { class: 'faint' }, 'Empty')),
        h('div', { class: 'nd' }, [N.folder === 'all' && c ? c.code : null, rel(new Date(n.updated))].filter(Boolean).join(' · '))));
    }
    if (!shown.length) body.append(h('div', { class: 'empty' }, notes.length ? 'No matches' : 'No notes yet'));
  };
  clear(els.list).append(h('div', { class: 'lhead' }, search, h('button', { class: 'btn primary', title: 'New note (Ctrl+N)', onclick: () => newNote(course(N.folder) ? N.folder : '') }, 'New')), body);
  renderListBody();
}

// ---------- editor ----------
async function onImageFile(file) {
  if (!ed) return;
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const name = await api.saveImage(new Uint8Array(await file.arrayBuffer()), ext);
  ed.insertBlock('image', { file: name, size: 'm' });
}

export function insertPhoneImage(item) {
  if (!ed || !note || !app.st.settings.phone.autoInsert) return false;
  ed.insertBlock('image', { file: item.file, size: 'm' });
  api.saveInbox(app.st.inbox.map((x) => (x.id === item.id ? { ...x, used: true } : x)));
  return true;
}

function updateToolbarBadge() {
  const b = els && els.pane.querySelector('.phone-btn');
  if (b) b.textContent = `Phone (${(app.st.inbox || []).filter((x) => !x.used).length})`;
}

function phoneInbox() {
  const grid = h('div', { class: 'thumbs' });
  const items = app.st.inbox || [];
  for (const it of items) {
    grid.append(h('div', { class: 'th', title: new Date(it.received).toLocaleString(), onclick: () => {
      if (!ed) { toast('Open a note first', 'bad'); return; }
      ed.insertBlock('image', { file: it.file, size: 'm' });
      api.saveInbox(app.st.inbox.map((x) => (x.id === it.id ? { ...x, used: true } : x)));
      close();
    } }, h('img', { src: imgUrl(it.file), loading: 'lazy' }), it.used ? h('span', { class: 'u' }, 'used') : null));
  }
  const close = modal('Images from your phone', h('div', null,
    h('p', { class: 'muted', style: { marginTop: 0 } }, 'Click an image to insert it at the cursor. New images are inserted automatically while a note is open (Settings → iPhone).'),
    items.length ? grid : h('div', { class: 'empty' }, 'Nothing yet. Pair your iPhone in Settings → iPhone.')),
  [{ label: 'Clear used', onClick: () => api.saveInbox(items.filter((x) => !x.used)) }], { width: '760px' });
}

function aiFromNote(task) {
  flush();
  const text = noteToMarkdown(note).slice(0, 20000);
  const params = { courseId: note.courseId, noteText: text, topic: note.title, count: 10 };
  api.aiRun(task, params).then((id) => watchRun(id, task === 'quiz' ? 'Making a quiz from this note' : 'Making a study guide', (run) => {
    if (run.result && run.result.quizId) go('ai', { quizId: run.result.quizId });
    else if (run.result && run.result.noteId) refresh(['notes']).then(() => open(run.result.noteId));
  })).catch((e) => toast(e.message, 'bad'));
}

function renderEditor() {
  if (!els) return;
  if (ed) { ed.destroy(); ed = null; }
  const pane = els.pane;
  pane.replaceChildren();
  if (!note) {
    pane.append(h('div', { class: 'empty', style: { gridRow: '1 / 4', alignSelf: 'center' } },
      h('div', { style: { fontSize: '15px', marginBottom: '10px' } }, 'Select a note or start a new one'),
      h('button', { class: 'btn primary', onclick: () => newNote(course(N.folder) ? N.folder : '') }, 'New note'), ' ',
      h('span', { class: 'faint' }, 'Ctrl+N')));
    return;
  }
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onchange: (e) => { [...e.target.files].forEach(onImageFile); e.target.value = ''; } });
  const courseSel = h('select', { class: 'in', title: 'Class', onchange: (e) => { note.courseId = e.target.value; scheduleSave(); flush().then(renderFolders); } },
    h('option', { value: '' }, 'Unfiled'), visibleCourses().map((c) => h('option', { value: c.id }, c.code)));
  courseSel.value = note.courseId || '';
  const ins = (type, data, label, title) => h('button', { class: 'btn sm', title, onclick: () => ed && ed.insertBlock(type, structuredClone(data)) }, label);
  const tog = (key, label, apply) => h('button', { class: `btn sm ${N[key] ? 'on' : ''}`, onclick: (e) => { N[key] = !N[key]; e.currentTarget.classList.toggle('on', N[key]); apply(N[key]); } }, label);

  pane.append(
    h('div', { class: 'ed-title' },
      h('input', { class: 't', value: note.title, placeholder: 'Title', spellcheck: 'false', oninput: (e) => { note.title = e.target.value; scheduleSave(); }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); ed && ed.focus(); } } }),
      courseSel,
      h('span', { class: 'faint small' }, `Edited ${rel(new Date(note.updated || Date.now()))}`)),
    h('div', { class: 'toolbar' },
      h('span', { class: 'faint small', style: { marginRight: '4px' } }, 'Insert'),
      ins('table', { rows: [['Account', 'Debit', 'Credit'], ['', '', ''], ['', '', ''], ['Total', '=SUM(B2:B3)', '=SUM(C2:C3)']], header: true, formats: ['text', 'accounting', 'accounting'] }, 'Table', 'Spreadsheet table with formulas'),
      ins('journal', {}, 'Journal entry', 'Debit/credit journal entry that checks it balances'),
      ins('taccount', {}, 'T-account', 'T-account with running balance'),
      ins('curves', {}, 'Supply/Demand', 'Graph curves from equations, marks equilibrium, shades surplus'),
      ins('chart', {}, 'Chart', 'Bar / line / pie chart'),
      h('button', { class: 'btn sm', onclick: () => fileIn.click() }, 'Image'), fileIn,
      h('button', { class: 'btn sm phone-btn', onclick: phoneInbox, title: 'Screenshots sent from your iPhone' }, `Phone (${(app.st.inbox || []).filter((x) => !x.used).length})`),
      h('span', { class: 'sep' }),
      tog('wrap', 'Wrap', (on) => ed && ed.setWrap(on)),
      tog('guides', 'Guides', (on) => ed && ed.setGuides(on)),
      h('span', { class: 'sep' }),
      h('button', { class: 'btn sm', onclick: () => aiFromNote('quiz'), title: 'AI writes a practice quiz from this note' }, 'Quiz me'),
      h('button', { class: 'btn sm', onclick: () => aiFromNote('studyGuide'), title: 'AI turns this note into a study guide' }, 'Study guide'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm ghost danger', onclick: async () => {
        if (!(await confirmBox('Delete note?', `"${note.title}" will be moved to the trash folder in your Ledger data folder.`, 'Delete', true))) return;
        const id = note.id;
        note = null; dirty = false; N.noteId = null;
        await api.deleteNote(id);
        app.notes = app.notes.filter((x) => x.id !== id);
        renderEditor(); renderFolders(); renderList();
      } }, 'Delete')),
  );
  const host = h('div', { class: 'ed-host' });
  pane.append(host);
  ed = createEditor({ parent: host, note, onChange: scheduleSave, onImageFile, wrap: N.wrap, guides: N.guides });
  window.__ledgerEditor = ed; // for the dev screenshot/test mode
  if (!note.text) ed.focus();
}
