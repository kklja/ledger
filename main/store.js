'use strict';
// Plain JSON files in one folder (default: Documents\Ledger) so everything is
// easy to back up and the AI can read it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uid = (n = 10) => crypto.randomBytes(16).toString('hex').slice(0, n);

const DEFAULT_SETTINGS = {
  lms: {
    canvasUrl: '',
    blackboardUrl: '',
    checkTimes: ['07:30', '12:30', '18:30'],
    autoCheck: true,
    showBrowser: false,
    aiCanBrowse: true,
    autoRemap: true,
  },
  feeds: [], // optional iCal / RSS backups: { id, name, url, courseId }
  term: { start: '', end: '' },
  ai: { provider: 'claude', claudePath: '', codexPath: '' },
  phone: { enabled: true, port: 47821, key: '', autoInsert: true },
  reminders: { assignmentLeadHours: [24, 3], classLeadMinutes: 10, notifyChanges: true },
  app: { launchAtLogin: false, keepInTray: true, theme: 'dark', wrap: false },
  ignoredLms: [], // LMS course keys the student removed (e.g. orientation "courses")
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const b = base[k];
    const o = over[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o) ? deepMerge(b, o) : o;
  }
  return out;
}

class Store {
  constructor(root) {
    this.root = root;
    for (const d of ['notes', 'images', 'quizzes', 'ai-context', 'ai-runs']) fs.mkdirSync(path.join(root, d), { recursive: true });
  }

  file(...p) { return path.join(this.root, ...p); }

  read(name, fallback) {
    const f = this.file(name);
    if (!fs.existsSync(f)) return structuredClone(fallback);
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {
      // Never silently overwrite a file we couldn't parse.
      try { fs.copyFileSync(f, `${f}.corrupt-${Date.now()}`); } catch {}
      console.error('Could not parse', f, e.message);
      return structuredClone(fallback);
    }
  }

  write(name, data) {
    const f = this.file(name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, f);
  }

  // ---- notes: notes/<id>.json ----
  listNotes() {
    const dir = this.file('notes');
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const n = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        out.push({
          id: n.id, title: n.title, courseId: n.courseId || '', created: n.created, updated: n.updated,
          preview: (n.text || '').replace(/^::\w+ \w+$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 140),
        });
      } catch {}
    }
    return out.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  }

  getNote(id) {
    if (!/^[a-z0-9]+$/.test(id)) return null;
    return this.read(path.join('notes', `${id}.json`), null);
  }

  saveNote(note) {
    if (!note.id || !/^[a-z0-9]+$/.test(note.id)) throw new Error('Bad note id');
    note.updated = new Date().toISOString();
    if (!note.created) note.created = note.updated;
    this.write(path.join('notes', `${note.id}.json`), note);
    return note;
  }

  deleteNote(id) {
    if (!/^[a-z0-9]+$/.test(id)) return;
    const f = this.file('notes', `${id}.json`);
    // Move to a trash folder rather than destroying it.
    fs.mkdirSync(this.file('trash'), { recursive: true });
    if (fs.existsSync(f)) fs.renameSync(f, this.file('trash', `${id}-${Date.now()}.json`));
  }

  saveImage(bytes, ext) {
    const clean = String(ext || 'png').toLowerCase().replace('jpeg', 'jpg');
    if (!/^(png|jpg|gif|webp|heic|bmp)$/.test(clean)) throw new Error('Unsupported image type');
    const name = `${uid(12)}.${clean}`;
    fs.writeFileSync(this.file('images', name), Buffer.from(bytes));
    return name;
  }
}

module.exports = { Store, DEFAULT_SETTINGS, deepMerge, uid };
