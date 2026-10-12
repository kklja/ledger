// The note editor: a monospace "page" where you can click anywhere — past the end of
// a line or below the last line — and type right there (virtual space). Padding is
// added only when you click, is invisible, and is trimmed again if you leave without
// typing. Tables, charts, T-accounts, journal entries and images are embedded as
// block widgets on their own line (stored as "::type id" in the text).

import { EditorState, StateField, RangeSetBuilder, Transaction, Annotation, EditorSelection, Facet, Compartment, countColumn } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, keymap, drawSelection, highlightActiveLine, BlockType, placeholder } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { renderBlock } from './widgets.js';
import { rid } from '../util.js';

export const BLOCK_RE = /^::(table|chart|curves|taccount|journal|image) ([a-z0-9]+)\s*$/;
const ctxFacet = Facet.define({ combine: (v) => v[0] });
const cleanupAnno = Annotation.define();
const TAB = 4;

// ---------- block widgets ----------
class BlockWidget extends WidgetType {
  constructor(type, id, ctx) { super(); this.type = type; this.id = id; this.ctx = ctx; }
  eq(o) { return o.type === this.type && o.id === this.id; }
  toDOM(view) {
    const wrap = document.createElement('div');
    wrap.className = 'blkwrap';
    wrap.style.padding = '6px 28px';
    wrap.append(renderBlock(this.type, this.id, this.ctx, view));
    return wrap;
  }
  ignoreEvent() { return true; }
  get estimatedHeight() { return this.type === 'image' ? 300 : 220; }
  destroy(dom) { dom.querySelectorAll('.blk').forEach((b) => b._destroy && b._destroy()); }
}

function buildBlocks(state) {
  const b = new RangeSetBuilder();
  const ctx = state.facet(ctxFacet);
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (line.text.charCodeAt(0) !== 58) continue; // ':'
    const m = BLOCK_RE.exec(line.text);
    if (m) b.add(line.from, line.to, Decoration.replace({ widget: new BlockWidget(m[1], m[2], ctx), block: true }));
  }
  return b.finish();
}

const blocks = StateField.define({
  create: buildBlocks,
  update: (deco, tr) => (tr.docChanged ? buildBlocks(tr.state) : deco),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

// ---------- light formatting (same font size everywhere so the grid stays aligned) ----------
const lineStyles = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view) {
    const b = new RangeSetBuilder();
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        const t = line.text;
        const cls = /^# /.test(t) ? 'cm-h1' : /^## /.test(t) ? 'cm-h2' : /^### /.test(t) ? 'cm-h3' : /^\s*> /.test(t) ? 'cm-quote' : null;
        if (cls) b.add(line.from, line.from, Decoration.line({ class: cls }));
        const bm = /^(\s*)([-*•]|\d+[.)])\s/.exec(t);
        if (bm && !cls) b.add(line.from + bm[1].length, line.from + bm[1].length + bm[2].length, Decoration.mark({ class: 'cm-bullet' }));
        pos = line.to + 1;
      }
    }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

// ---------- virtual space ----------
function textOrigin(view) {
  const line = view.contentDOM.querySelector('.cm-line');
  const pad = line ? parseFloat(getComputedStyle(line).paddingLeft) || 0 : 0;
  return view.contentDOM.getBoundingClientRect().left + pad;
}

const virtualSpace = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.detail > 1) return false;
    if (e.target.closest && e.target.closest('.blkwrap')) return false;
    const cw = view.defaultCharacterWidth;
    const lh = view.defaultLineHeight;
    const col = Math.max(0, Math.round((e.clientX - textOrigin(view)) / cw));
    const y = e.clientY - view.documentTop;
    const doc = view.state.doc;
    const last = doc.line(doc.lines);
    const lastBlock = view.lineBlockAt(last.from);
    const opts = { annotations: Transaction.addToHistory.of(false), userEvent: 'select.virtual' };

    if (y > lastBlock.bottom) {
      // Below the end of the note: add lines down to where you clicked.
      const extra = Math.max(1, Math.ceil((y - lastBlock.bottom) / lh));
      const insert = '\n'.repeat(extra) + ' '.repeat(col);
      view.dispatch({ changes: { from: last.to, insert }, selection: { anchor: last.to + insert.length }, ...opts });
      view.focus();
      e.preventDefault();
      return true;
    }

    const block = view.lineBlockAtHeight(y);
    if (block.type !== BlockType.Text) return false;
    if (block.height > lh * 1.5) return false; // wrapped line: normal behaviour
    const line = doc.lineAt(block.from);
    const width = countColumn(line.text, TAB);
    if (col <= width) return false; // inside the text: let the editor place the caret
    const insert = ' '.repeat(col - width);
    view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length }, ...opts });
    view.focus();
    e.preventDefault();
    return true;
  },
});

// Trim invisible padding (trailing spaces, empty lines at the end) once the caret leaves it.
function cleanup(view) {
  const { state } = view;
  const doc = state.doc;
  const cur = doc.lineAt(state.selection.main.head).number;
  let keep = doc.lines;
  while (keep > cur && doc.line(keep).text.trim() === '') keep--;
  const changes = [];
  for (let i = 1; i <= keep; i++) {
    if (i === cur) continue;
    const l = doc.line(i);
    const m = /[ \t]+$/.exec(l.text);
    if (m) changes.push({ from: l.to - m[0].length, to: l.to });
  }
  if (keep < doc.lines) changes.push({ from: doc.line(keep).to, to: doc.length });
  if (changes.length) view.dispatch({ changes, annotations: [cleanupAnno.of(true), Transaction.addToHistory.of(false)] });
}

const cleanupOnMove = EditorView.updateListener.of((u) => {
  if (!u.selectionSet || u.transactions.some((tr) => tr.annotation(cleanupAnno))) return;
  clearTimeout(u.view._cleanT);
  u.view._cleanT = setTimeout(() => { if (!u.view.destroyed) cleanup(u.view); }, 250);
});

// ---------- keys ----------
function insertTab(view) {
  const { state } = view;
  view.dispatch(state.changeByRange((r) => {
    const line = state.doc.lineAt(r.from);
    const col = countColumn(line.text.slice(0, r.from - line.from), TAB);
    const n = TAB - (col % TAB);
    return { changes: { from: r.from, to: r.to, insert: ' '.repeat(n) }, range: EditorSelection.cursor(r.from + n) };
  }), { userEvent: 'input' });
  return true;
}

function outdent(view) {
  const { state } = view;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const n = Math.min(TAB, /^ */.exec(line.text)[0].length);
        if (n) changes.push({ from: line.from, to: line.from + n });
      }
      pos = line.to + 1;
    }
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'delete' });
  return true;
}

// Excel/Sheets/web tables -> table block. Other tab-separated text -> aligned columns.
function tsvToRows(text) {
  return text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
}

function alignTabs(text) {
  const rows = tsvToRows(text);
  const widths = [];
  rows.forEach((r) => r.forEach((c, i) => (widths[i] = Math.max(widths[i] || 0, c.length))));
  return rows.map((r) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(widths[i] + 2) : c)).join('').trimEnd()).join('\n');
}

const pasteAndDrop = EditorView.domEventHandlers({
  paste(e, view) {
    const ctx = view.state.facet(ctxFacet);
    const dt = e.clipboardData;
    if (!dt) return false;
    const files = [...dt.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile());
    if (files.length) {
      e.preventDefault();
      files.forEach((f) => ctx.onImageFile(f));
      return true;
    }
    const text = dt.getData('text/plain');
    if (text && text.includes('\t')) {
      e.preventDefault();
      if (/<table/i.test(dt.getData('text/html') || '') && text.includes('\n')) {
        const rows = tsvToRows(text);
        const width = Math.max(...rows.map((r) => r.length));
        rows.forEach((r) => { while (r.length < width) r.push(''); });
        insertBlock(view, ctx, 'table', { rows, header: true, formats: rows[0].map(() => 'auto') });
      } else {
        view.dispatch(view.state.replaceSelection(alignTabs(text)), { userEvent: 'input.paste' });
      }
      return true;
    }
    return false;
  },
  drop(e, view) {
    const ctx = view.state.facet(ctxFacet);
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos != null) view.dispatch({ selection: { anchor: pos } });
    files.forEach((f) => ctx.onImageFile(f));
    return true;
  },
});

// ---------- block insertion ----------
export function insertBlock(view, ctx, type, data) {
  const id = rid(8);
  ctx.objects[id] = { type, ...data };
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const marker = `::${type} ${id}`;
  const isLast = line.number === state.doc.lines;
  let changes, anchor;
  if (!line.text.trim()) {
    changes = { from: line.from, to: line.to, insert: marker + (isLast ? '\n' : '') };
    anchor = line.from + marker.length + 1;
  } else {
    changes = { from: line.to, insert: `\n${marker}${isLast ? '\n' : ''}` };
    anchor = line.to + marker.length + 2;
  }
  view.dispatch({ changes, selection: { anchor }, userEvent: 'input', scrollIntoView: true });
  ctx.changed();
  view.focus();
  return id;
}

export function removeBlock(view, id) {
  const doc = view.state.doc;
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i);
    const m = BLOCK_RE.exec(l.text);
    if (m && m[2] === id) {
      const from = l.from;
      const to = i < doc.lines ? l.to + 1 : l.to;
      view.dispatch({ changes: { from: i === doc.lines && i > 1 ? from - 1 : from, to }, userEvent: 'delete' });
      return;
    }
  }
}

// ---------- factory ----------
export function createEditor({ parent, note, onChange, onImageFile, wrap = false, guides = false }) {
  if (!note.objects) note.objects = {};
  const ctx = { objects: note.objects, view: null, onImageFile: (f) => onImageFile(f), changed: () => { onChange(); ctx.view && ctx.view.requestMeasure(); } };
  const wrapComp = new Compartment();
  const state = EditorState.create({
    doc: note.text || '',
    extensions: [
      ctxFacet.of(ctx),
      blocks,
      lineStyles,
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorState.tabSize.of(TAB),
      EditorState.allowMultipleSelections.of(true),
      wrapComp.of(wrap ? EditorView.lineWrapping : []),
      placeholder('Click anywhere and start typing.  "# " = heading · "- " = bullet · paste screenshots with Ctrl+V'),
      virtualSpace,
      cleanupOnMove,
      pasteAndDrop,
      keymap.of([
        { key: 'Tab', run: insertTab },
        { key: 'Shift-Tab', run: outdent },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((u) => { if (u.docChanged && !u.transactions.every((t) => t.annotation(cleanupAnno))) onChange(); }),
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off' }),
    ],
  });
  const view = new EditorView({ state, parent });
  ctx.view = view;
  const applyGuides = (on) => {
    view.dom.classList.toggle('grid-on', on);
    view.dom.style.setProperty('--cw', `${view.defaultCharacterWidth}px`);
  };
  applyGuides(guides);
  return {
    view,
    ctx,
    insertBlock: (type, data) => insertBlock(view, ctx, type, data),
    getText: () => view.state.doc.toString(),
    setWrap: (on) => view.dispatch({ effects: wrapComp.reconfigure(on ? EditorView.lineWrapping : []) }),
    setGuides: applyGuides,
    focus: () => view.focus(),
    destroy: () => { clearTimeout(view._cleanT); view.destroy(); },
  };
}
