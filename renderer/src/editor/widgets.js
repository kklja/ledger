// Embedded blocks: spreadsheet table, chart, econ curves, T-account, journal entry, image.
// Each block edits its object in ctx.objects in place and calls ctx.changed() to save.

import Chart from 'chart.js/auto';
import { computeTable, formatValue, parseNumber, compileCurve, colName } from '../../../shared/formula.js';
import { h, clear, modal } from '../util.js';
import { removeBlock } from './editor.js';

const PALETTE = ['#4cc2ff', '#ff9f43', '#6ccb5f', '#c58cff', '#3ed6c6', '#f7d046', '#8fa3ff', '#ff7a85'];
const LABEL = { table: 'Table', chart: 'Chart', curves: 'Graph', taccount: 'T-account', journal: 'Journal entry', image: 'Image' };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const btn = (label, onclick, title) => h('button', { class: 'btn ghost', title: title || label, onclick }, label);

export function renderBlock(type, id, ctx, view) {
  const obj = ctx.objects[id];
  if (!obj) return h('div', { class: 'blk' }, h('div', { class: 'bb faint' }, `Missing ${type} data (${id})`));
  const del = () => removeBlock(view, id);
  return { table: tableBlock, chart: chartBlock, curves: curvesBlock, taccount: tBlock, journal: journalBlock, image: imageBlock }[type](obj, ctx, del);
}

function frame(type, obj, ctx, del, buttons = [], { title = true } = {}) {
  const body = h('div', { class: 'bb' });
  const el = h('div', { class: `blk blk-${type}` },
    h('div', { class: 'bh' },
      h('span', { class: 'ty' }, LABEL[type]),
      title ? h('input', { class: 'bt', value: obj.title || '', placeholder: 'Title', spellcheck: 'false', oninput: (e) => { obj.title = e.target.value; ctx.changed(); } }) : h('span', { class: 'grow' }),
      ...buttons,
      h('button', { class: 'btn ghost', title: 'Remove block (Ctrl+Z to undo)', onclick: del }, '✕')),
    body);
  return { el, body };
}

// ---------------- table ----------------
function tableBlock(obj, ctx, del) {
  if (!obj.rows) obj.rows = [['', '', ''], ['', '', ''], ['', '', '']];
  if (!obj.formats) obj.formats = obj.rows[0].map(() => 'auto');
  if (obj.header == null) obj.header = true;
  let sel = { r: 0, c: 0 };
  let inputs = [];

  const fmtSel = h('select', { class: 'in', style: { height: '22px', fontSize: '11.5px' }, title: 'Number format for the selected column', onchange: (e) => { obj.formats[sel.c] = e.target.value; ctx.changed(); paint(); } },
    [['auto', 'General'], ['text', 'Text'], ['number', 'Number'], ['currency', '$ Currency'], ['accounting', 'Accounting (1,000.00)'], ['percent', 'Percent']].map(([v, l]) => h('option', { value: v }, l)));
  const cols = () => Math.max(1, ...obj.rows.map((r) => r.length));
  const structural = (fn) => () => { fn(); build(); ctx.changed(); };
  const buttons = [
    fmtSel,
    btn('+ Row', structural(() => obj.rows.splice(sel.r + 1, 0, Array(cols()).fill(''))), 'Insert row below'),
    btn('+ Col', structural(() => { obj.rows.forEach((r) => r.splice(sel.c + 1, 0, '')); obj.formats.splice(sel.c + 1, 0, 'auto'); }), 'Insert column right'),
    btn('− Row', structural(() => { if (obj.rows.length > 1) obj.rows.splice(sel.r, 1); sel.r = Math.min(sel.r, obj.rows.length - 1); }), 'Delete selected row'),
    btn('− Col', structural(() => { if (cols() > 1) { obj.rows.forEach((r) => r.splice(sel.c, 1)); obj.formats.splice(sel.c, 1); } sel.c = Math.min(sel.c, cols() - 1); }), 'Delete selected column'),
    btn('Header', structural(() => (obj.header = !obj.header)), 'Toggle bold header row'),
  ];
  const { el, body } = frame('table', obj, ctx, del, buttons);
  const table = h('table', { class: 'sheet' });
  body.append(table, h('div', { class: 'faint', style: { fontSize: '11px', marginTop: '4px' } }, 'Formulas: =B2*C2  =SUM(B2:B9)  =AVG()  =ROUND(x,2)  =PMT(rate,n,pv)  =PV()  =FV()  =NPV() · paste cells from Excel'));

  function focusCell(r, c) { const i = inputs[r] && inputs[r][c]; if (i) i.focus(); }

  function onKey(e, r, c) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) return focusCell(Math.max(0, r - 1), c);
      if (r === obj.rows.length - 1) { obj.rows.push(Array(cols()).fill('')); build(); ctx.changed(); }
      focusCell(r + 1, c);
    } else if (e.key === 'ArrowDown') { e.preventDefault(); focusCell(r + 1, c); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c); }
    else if (e.key === 'Escape') { e.target.blur(); }
  }

  function onPaste(e, r, c) {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return;
    e.preventDefault();
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    rows.forEach((row, i) => row.forEach((v, j) => {
      while (obj.rows.length <= r + i) obj.rows.push(Array(cols()).fill(''));
      if (c + j >= cols()) { obj.rows.forEach((x) => { while (x.length <= c + j) x.push(''); }); }
      obj.rows[r + i][c + j] = v.trim();
    }));
    build();
    ctx.changed();
  }

  function build() {
    clear(table);
    inputs = [];
    const n = cols();
    obj.rows.forEach((r) => { while (r.length < n) r.push(''); });
    for (let i = 0; i < n; i++) obj.formats[i] = obj.formats[i] || 'auto';
    obj.formats.length = n;
    table.append(h('tr', null, h('th'), Array.from({ length: n }, (_, c) => h('th', null, colName(c)))));
    obj.rows.forEach((row, r) => {
      const tr = h('tr', { class: r === 0 && obj.header ? 'hdr' : '' }, h('th', null, String(r + 1)));
      inputs[r] = [];
      row.forEach((_, c) => {
        const inp = h('input', { class: 'cell', spellcheck: 'false' });
        inp.addEventListener('focus', () => { sel = { r, c }; inp.value = obj.rows[r][c]; inp.classList.remove('num'); fmtSel.value = obj.formats[c]; });
        inp.addEventListener('input', () => { obj.rows[r][c] = inp.value; ctx.changed(); });
        inp.addEventListener('blur', paint);
        inp.addEventListener('keydown', (e) => onKey(e, r, c));
        inp.addEventListener('paste', (e) => onPaste(e, r, c));
        inputs[r][c] = inp;
        tr.append(h('td', { class: c === 0 ? 'first' : '' }, inp));
      });
      table.append(tr);
    });
    paint();
  }

  function paint() {
    computeTable(obj).forEach((row, r) => row.forEach((cell, c) => {
      const inp = inputs[r] && inputs[r][c];
      if (!inp || document.activeElement === inp) return;
      inp.value = cell.display;
      inp.classList.toggle('num', !Number.isNaN(cell.value) && !(r === 0 && obj.header));
      inp.parentElement.classList.toggle('err', !!cell.error);
      inp.title = cell.error || (cell.raw.startsWith('=') ? cell.raw : '');
    }));
  }

  build();
  return el;
}

// ---------------- chart ----------------
function themeChart() {
  Chart.defaults.color = css('--muted') || '#566170';
  Chart.defaults.borderColor = css('--line-2') || '#e5e8ed';
  Chart.defaults.font.family = 'Segoe UI, system-ui, sans-serif';
}

function chartBlock(obj, ctx, del) {
  if (!obj.kind) obj.kind = 'bar';
  if (!obj.labels) obj.labels = ['2024', '2025', '2026'];
  if (!obj.series) obj.series = [{ name: 'Revenue', values: [120, 150, 175] }];
  let chart = null;
  let editing = !obj.title && obj.series.length === 1 && obj.series[0].name === 'Revenue';

  const kindSel = h('select', { class: 'in', style: { height: '22px', fontSize: '11.5px' }, onchange: (e) => { obj.kind = e.target.value; ctx.changed(); draw(true); } },
    [['bar', 'Bar'], ['hbar', 'Horizontal bar'], ['line', 'Line'], ['stacked', 'Stacked bar'], ['pie', 'Pie']].map(([v, l]) => h('option', { value: v }, l)));
  kindSel.value = obj.kind;
  const editBtn = btn('Edit data', () => { editing = !editing; renderData(); });
  const { el, body } = frame('chart', obj, ctx, del, [kindSel, editBtn]);
  const box = h('div', { style: { position: 'relative', width: '640px', height: '300px' } });
  const canvas = h('canvas');
  box.append(canvas);
  const data = h('div', { style: { marginTop: '8px' } });
  body.append(box, data);

  function config() {
    const pie = obj.kind === 'pie';
    const num = (v) => { const n = parseNumber(v); return Number.isNaN(n) ? null : n; };
    return {
      type: pie ? 'pie' : obj.kind === 'line' ? 'line' : 'bar',
      data: {
        labels: obj.labels,
        datasets: obj.series.map((s, i) => ({
          label: s.name, data: obj.labels.map((_, j) => num(s.values[j])),
          backgroundColor: pie ? obj.labels.map((_, j) => PALETTE[j % PALETTE.length]) : PALETTE[i % PALETTE.length],
          borderColor: pie ? css('--panel') : PALETTE[i % PALETTE.length], borderWidth: pie ? 1 : 2, tension: 0, pointRadius: 3,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, indexAxis: obj.kind === 'hbar' ? 'y' : 'x',
        plugins: { legend: { display: pie || obj.series.length > 1, position: 'bottom', labels: { boxWidth: 10 } }, title: { display: false } },
        scales: pie ? {} : { x: { stacked: obj.kind === 'stacked', grid: { display: false } }, y: { stacked: obj.kind === 'stacked', beginAtZero: true } },
      },
    };
  }

  function draw(recreate) {
    if (chart && !recreate) {
      const c = config();
      chart.data = c.data;
      chart.update('none');
      return;
    }
    if (chart) chart.destroy();
    themeChart();
    chart = new Chart(canvas, config());
  }

  function renderData() {
    clear(data);
    editBtn.classList.toggle('on', editing);
    if (!editing) return;
    const t = h('table', { class: 'sheet' });
    const changed = () => { ctx.changed(); draw(false); };
    t.append(h('tr', null, h('td', { class: 'first' }, h('input', { class: 'cell', value: 'Label', disabled: true })),
      obj.series.map((s, i) => h('td', null, h('div', { class: 'row', style: { gap: '0' } },
        h('input', { class: 'cell', value: s.name, style: { fontWeight: '700' }, oninput: (e) => { s.name = e.target.value; changed(); } }),
        obj.series.length > 1 ? h('button', { class: 'btn ghost sm', title: 'Remove series', onclick: () => { obj.series.splice(i, 1); changed(); renderData(); } }, '✕') : null))),
      h('td', null, h('button', { class: 'btn ghost sm', onclick: () => { obj.series.push({ name: `Series ${obj.series.length + 1}`, values: [] }); changed(); renderData(); } }, '+ Series'))));
    obj.labels.forEach((l, j) => {
      t.append(h('tr', null,
        h('td', { class: 'first' }, h('input', { class: 'cell', value: l, oninput: (e) => { obj.labels[j] = e.target.value; changed(); } })),
        obj.series.map((s) => h('td', null, h('input', { class: 'cell num', value: s.values[j] ?? '', oninput: (e) => { s.values[j] = e.target.value; changed(); } }))),
        h('td', null, h('button', { class: 'btn ghost sm', title: 'Remove row', onclick: () => { obj.labels.splice(j, 1); obj.series.forEach((s) => s.values.splice(j, 1)); changed(); renderData(); } }, '✕'))));
    });
    data.append(t, h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => { obj.labels.push(`Item ${obj.labels.length + 1}`); changed(); renderData(); } }, '+ Row'));
    ctx.view && ctx.view.requestMeasure();
  }

  requestAnimationFrame(() => draw(true));
  renderData();
  el._destroy = () => chart && chart.destroy();
  return el;
}

// ---------------- econ curves (supply/demand, AD/AS, cost curves...) ----------------
function intersections(fa, fb, xMax) {
  const out = [];
  const N = 600;
  const g = (x) => { try { return fa(x) - fb(x); } catch { return NaN; } };
  let px = 0, pg = g(0);
  for (let i = 1; i <= N; i++) {
    const x = (xMax * i) / N;
    const v = g(x);
    if (Number.isFinite(pg) && Number.isFinite(v) && (pg === 0 || pg * v < 0)) {
      let lo = px, hi = x;
      for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (g(lo) * g(mid) <= 0) hi = mid; else lo = mid; }
      const xs = (lo + hi) / 2;
      if (!out.some((p) => Math.abs(p.x - xs) < xMax / 1000)) out.push({ x: xs, y: fa(xs) });
    }
    px = x; pg = v;
  }
  return out;
}

const round = (v) => formatValue(Math.round(v * 100) / 100, 'number');

function curvesBlock(obj, ctx, del) {
  if (!obj.curves) obj.curves = [{ name: 'D', eq: '20 - Q' }, { name: 'S', eq: '2 + 0.8Q' }];
  if (!obj.hlines) obj.hlines = [];
  if (obj.xMax == null) obj.xMax = 20;
  if (obj.yMax == null) obj.yMax = 20;
  if (!obj.xLabel) obj.xLabel = 'Quantity (Q)';
  if (!obj.yLabel) obj.yLabel = 'Price (P)';
  if (obj.showEq == null) obj.showEq = true;
  let chart = null;
  let showEditor = true;

  const toggle = btn('Edit', () => { showEditor = !showEditor; renderEditor(); });
  const { el, body } = frame('curves', obj, ctx, del, [toggle]);
  const box = h('div', { style: { position: 'relative', width: '560px', height: '400px' } });
  const canvas = h('canvas');
  box.append(canvas);
  const ed = h('div');
  body.append(box);
  el.append(ed);

  function compute() {
    const fns = obj.curves.map((c) => { try { const f = compileCurve(c.eq); f(1); return f; } catch { return null; } });
    const ds = [];
    const marks = [];
    const N = 160;
    obj.curves.forEach((c, i) => {
      if (!fns[i]) return;
      const pts = [];
      for (let k = 0; k <= N; k++) { const x = (obj.xMax * k) / N; const y = fns[i](x); if (Number.isFinite(y)) pts.push({ x, y }); }
      ds.push({ label: c.name, data: pts, showLine: true, pointRadius: 0, borderWidth: 2.5, borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length], fill: false });
    });
    obj.hlines.forEach((l, i) => {
      const y = parseNumber(l.y);
      if (Number.isNaN(y)) return;
      ds.push({ label: l.name, data: [{ x: 0, y }, { x: obj.xMax, y }], showLine: true, pointRadius: 0, borderWidth: 2, borderDash: [6, 4], borderColor: PALETTE[(i + 4) % PALETTE.length], fill: false });
      fns.forEach((f, j) => { if (f) for (const p of intersections(f, () => y, obj.xMax)) marks.push({ ...p, label: `${obj.curves[j].name}∩${l.name}` }); });
    });
    if (obj.showEq) {
      for (let i = 0; i < fns.length; i++) for (let j = i + 1; j < fns.length; j++) {
        if (fns[i] && fns[j]) for (const p of intersections(fns[i], fns[j], obj.xMax)) marks.push({ ...p, label: `${obj.curves[i].name}=${obj.curves[j].name}` });
      }
    }
    // Consumer / producer surplus for the first two curves (demand = the one higher at Q=0)
    if (obj.shade && fns[0] && fns[1]) {
      const [p] = intersections(fns[0], fns[1], obj.xMax);
      if (p) {
        const dIdx = fns[0](0) >= fns[1](0) ? 0 : 1;
        const seg = (f) => Array.from({ length: 81 }, (_, k) => { const x = (p.x * k) / 80; return { x, y: f(x) }; });
        ds.push({ label: 'Consumer surplus', data: seg(fns[dIdx]), showLine: true, pointRadius: 0, borderWidth: 0, fill: { value: p.y }, backgroundColor: 'rgba(108,203,95,.24)' });
        ds.push({ label: 'Producer surplus', data: seg(fns[1 - dIdx]), showLine: true, pointRadius: 0, borderWidth: 0, fill: { value: p.y }, backgroundColor: 'rgba(76,194,255,.2)' });
      }
    }
    for (const m of marks) {
      ds.push({ label: '_guide', data: [{ x: m.x, y: 0 }, { x: m.x, y: m.y }, { x: 0, y: m.y }], showLine: true, pointRadius: 0, borderWidth: 1, borderDash: [3, 3], borderColor: css('--faint') || '#8a93a0', fill: false });
    }
    ds.push({ label: '_points', data: marks, pointRadius: 4, pointBackgroundColor: css('--text') || '#16202c', showLine: false });
    return { ds, marks, fns };
  }

  const labelsPlugin = {
    id: 'curveLabels',
    afterDatasetsDraw(c) {
      const g = c.ctx;
      const { marks } = c.$ledger || { marks: [] };
      g.save();
      g.font = '600 12px Segoe UI, sans-serif';
      g.fillStyle = css('--text') || '#16202c';
      for (const m of marks) {
        const x = c.scales.x.getPixelForValue(m.x), y = c.scales.y.getPixelForValue(m.y);
        g.fillText(`(${round(m.x)}, ${round(m.y)})`, x + 7, y - 7);
      }
      // name each curve near its right end, inside the plot
      c.data.datasets.forEach((d, i) => {
        if (!d.showLine || d.label.startsWith('_') || /surplus/.test(d.label) || !c.isDatasetVisible(i)) return;
        const pts = d.data.filter((p) => p.y >= c.scales.y.min && p.y <= c.scales.y.max && p.x <= c.scales.x.max);
        const p = pts[pts.length - 1];
        if (!p) return;
        g.fillStyle = d.borderColor;
        g.fillText(d.label, Math.min(c.scales.x.getPixelForValue(p.x) + 4, c.chartArea.right - 30), c.scales.y.getPixelForValue(p.y) - 6);
      });
      g.restore();
    },
  };

  function draw() {
    const { ds, marks } = compute();
    if (chart) chart.destroy();
    themeChart();
    chart = new Chart(canvas, {
      type: 'scatter',
      data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { labels: { filter: (i) => !i.text.startsWith('_'), boxWidth: 10 } }, tooltip: { callbacks: { label: (t) => `${t.dataset.label.startsWith('_') ? '' : `${t.dataset.label}: `}(${round(t.parsed.x)}, ${round(t.parsed.y)})` } } },
        scales: {
          x: { type: 'linear', min: 0, max: Number(obj.xMax) || 20, title: { display: true, text: obj.xLabel }, grid: { color: css('--line-2') } },
          y: { min: 0, max: Number(obj.yMax) || 20, title: { display: true, text: obj.yLabel }, grid: { color: css('--line-2') } },
        },
      },
      plugins: [labelsPlugin],
    });
    chart.$ledger = { marks };
    chart.update('none');
  }

  function renderEditor() {
    clear(ed);
    toggle.classList.toggle('on', showEditor);
    if (!showEditor) { ctx.view && ctx.view.requestMeasure(); return; }
    const changed = () => { ctx.changed(); draw(); };
    const panel = h('div', { class: 'curves-ed' });
    panel.append(h('div', { class: 'faint', style: { fontSize: '11px' } }, 'Curves: P as a function of Q — e.g. 20 - 2Q, 4 + 0.5Q, 100/Q, 0.1Q^2 - 2Q + 15'));
    obj.curves.forEach((c, i) => {
      let ok = true;
      try { compileCurve(c.eq)(1); } catch { ok = false; }
      panel.append(h('div', { class: 'cr' },
        h('input', { class: 'in', value: c.name, style: { borderLeft: `4px solid ${PALETTE[i % PALETTE.length]}` }, oninput: (e) => { c.name = e.target.value; changed(); } }),
        h('input', { class: 'in mono', value: c.eq, style: ok ? null : { borderColor: 'var(--danger)' }, onchange: (e) => { c.eq = e.target.value; changed(); renderEditor(); } }),
        h('button', { class: 'btn ghost sm', title: 'Remove', onclick: () => { obj.curves.splice(i, 1); changed(); renderEditor(); } }, '✕')));
    });
    obj.hlines.forEach((l, i) => {
      panel.append(h('div', { class: 'cr' },
        h('input', { class: 'in', value: l.name, oninput: (e) => { l.name = e.target.value; changed(); } }),
        h('input', { class: 'in mono', value: l.y, placeholder: 'price level', onchange: (e) => { l.y = e.target.value; changed(); } }),
        h('button', { class: 'btn ghost sm', onclick: () => { obj.hlines.splice(i, 1); changed(); renderEditor(); } }, '✕')));
    });
    const num = (k) => h('input', { class: 'in', style: { width: '64px' }, value: obj[k], onchange: (e) => { obj[k] = parseNumber(e.target.value) || obj[k]; changed(); } });
    const txt = (k) => h('input', { class: 'in', style: { width: '130px' }, value: obj[k], onchange: (e) => { obj[k] = e.target.value; changed(); } });
    panel.append(
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', onclick: () => { obj.curves.push({ name: `C${obj.curves.length + 1}`, eq: '10' }); changed(); renderEditor(); } }, '+ Curve'),
        h('button', { class: 'btn sm', onclick: () => { obj.hlines.push({ name: 'Price ceiling', y: '8' }); changed(); renderEditor(); } }, '+ Price line'),
        h('span', { class: 'small muted' }, 'Q max'), num('xMax'), h('span', { class: 'small muted' }, 'P max'), num('yMax')),
      h('div', { class: 'row wrap' }, h('span', { class: 'small muted' }, 'Axes'), txt('xLabel'), txt('yLabel'),
        h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: obj.showEq, onchange: (e) => { obj.showEq = e.target.checked; changed(); } }), 'Mark intersections'),
        h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: obj.shade, onchange: (e) => { obj.shade = e.target.checked; changed(); } }), 'Shade CS / PS')),
    );
    ed.append(panel);
    ctx.view && ctx.view.requestMeasure();
  }

  requestAnimationFrame(draw);
  renderEditor();
  el._destroy = () => chart && chart.destroy();
  return el;
}

// ---------------- T-account ----------------
const amt = (v) => { const n = parseNumber(v); return Number.isNaN(n) ? 0 : n; };

function tBlock(obj, ctx, del) {
  if (!obj.left) obj.left = [{ label: 'Beg. bal.', amt: '' }];
  if (!obj.right) obj.right = [{ label: '', amt: '' }];
  const { el, body } = frame('taccount', obj, ctx, del, [], { title: false });
  const wrap = h('div', { class: 'taccount' });
  body.append(wrap);

  function build() {
    clear(wrap);
    const totals = h('div', { class: 'bal' });
    const update = () => {
      const L = obj.left.reduce((s, x) => s + amt(x.amt), 0), R = obj.right.reduce((s, x) => s + amt(x.amt), 0);
      wrap.querySelector('.tot.l .v').textContent = formatValue(L, 'accounting');
      wrap.querySelector('.tot.r .v').textContent = formatValue(R, 'accounting');
      totals.textContent = L === R ? 'Balance: 0.00' : `Balance: ${formatValue(Math.abs(L - R), 'accounting')} ${L > R ? 'Dr (debit)' : 'Cr (credit)'}`;
    };
    const side = (list, cls) => {
      const s = h('div', { class: `side ${cls}` });
      list.forEach((x, i) => s.append(h('div', { class: 'tl' },
        h('input', { class: 'cell', value: x.label, placeholder: cls === 'l' ? 'Debit' : 'Credit', oninput: (e) => { x.label = e.target.value; ctx.changed(); } }),
        h('input', { class: 'cell num', value: x.amt, placeholder: '0.00', oninput: (e) => { x.amt = e.target.value; ctx.changed(); update(); } }),
        h('button', { class: 'btn ghost sm', style: { padding: '0 2px' }, tabindex: '-1', onclick: () => { list.splice(i, 1); ctx.changed(); build(); } }, '✕'))));
      s.append(h('button', { class: 'btn ghost sm', onclick: () => { list.push({ label: '', amt: '' }); ctx.changed(); build(); } }, cls === 'l' ? '+ Debit' : '+ Credit'));
      s.append(h('div', { class: `tot ${cls}` }, h('span', null, 'Total'), h('span', { class: 'v mono', style: { textAlign: 'right', paddingRight: '6px' } }), h('span')));
      return s;
    };
    wrap.append(
      h('div', { class: 'tt' }, h('input', { class: 'cell', value: obj.title || '', placeholder: 'Account name (e.g. Cash)', oninput: (e) => { obj.title = e.target.value; ctx.changed(); } })),
      side(obj.left, 'l'), side(obj.right, 'r'), totals);
    update();
    ctx.view && ctx.view.requestMeasure();
  }
  build();
  return el;
}

// ---------------- journal entry ----------------
function journalBlock(obj, ctx, del) {
  if (!obj.rows) obj.rows = [{ date: '', account: '', debit: '', credit: '' }, { date: '', account: '', debit: '', credit: '' }];
  const { el, body } = frame('journal', obj, ctx, del, [btn('+ Line', () => { obj.rows.push({ date: '', account: '', debit: '', credit: '' }); ctx.changed(); build(); })]);
  const table = h('table', { class: 'journal' });
  const status = h('div', { class: 'jstatus' });
  const memo = h('input', { class: 'cell', value: obj.memo || '', placeholder: 'Explanation / memo', style: { fontStyle: 'italic' }, oninput: (e) => { obj.memo = e.target.value; ctx.changed(); } });
  body.append(table, memo, status);

  function totals() {
    const dr = obj.rows.reduce((s, r) => s + amt(r.debit), 0), cr = obj.rows.reduce((s, r) => s + amt(r.credit), 0);
    table.querySelector('.tdr').textContent = formatValue(dr, 'accounting');
    table.querySelector('.tcr').textContent = formatValue(cr, 'accounting');
    const diff = Math.round((dr - cr) * 100) / 100;
    status.textContent = diff === 0 ? (dr ? '✓ Balanced' : '') : `Out of balance by ${formatValue(Math.abs(diff), 'accounting')} (${diff > 0 ? 'debits' : 'credits'} higher)`;
    status.className = `jstatus ${diff === 0 ? 'ok-t' : 'danger-t'}`;
    obj.rows.forEach((r, i) => table.rows[i + 1] && table.rows[i + 1].classList.toggle('cr', amt(r.credit) !== 0 && amt(r.debit) === 0));
  }

  function build() {
    clear(table);
    table.append(h('tr', null, h('th', { style: { width: '90px' } }, 'Date'), h('th', { style: { width: '300px' } }, 'Account'), h('th', { style: { width: '120px', textAlign: 'right' } }, 'Debit'), h('th', { style: { width: '120px', textAlign: 'right' } }, 'Credit'), h('th')));
    obj.rows.forEach((r, i) => {
      const f = (k, cls, ph) => h('input', { class: `cell ${cls || ''}`, value: r[k], placeholder: ph || '', oninput: (e) => { r[k] = e.target.value; ctx.changed(); totals(); } });
      table.append(h('tr', null, h('td', null, f('date', '', i === 0 ? 'Jan 1' : '')), h('td', { class: 'acct' }, f('account', '', 'Account title')), h('td', null, f('debit', 'num')), h('td', null, f('credit', 'num')),
        h('td', null, h('button', { class: 'btn ghost sm', tabindex: '-1', onclick: () => { obj.rows.splice(i, 1); ctx.changed(); build(); } }, '✕'))));
    });
    table.append(h('tr', { class: 'tot' }, h('td'), h('td', null, 'Totals'), h('td', { class: 'tdr mono', style: { textAlign: 'right' } }), h('td', { class: 'tcr mono', style: { textAlign: 'right' } }), h('td')));
    totals();
    ctx.view && ctx.view.requestMeasure();
  }
  build();
  return el;
}

// ---------------- image ----------------
const SIZES = { s: '260px', m: '460px', l: '720px', full: '100%' };
export const imgUrl = (file) => `ledger-img://i/${file}`;

function imageBlock(obj, ctx, del) {
  if (!obj.size) obj.size = 'm';
  const sizeBtns = Object.keys(SIZES).map((k) => h('button', { class: `btn ghost ${obj.size === k ? 'on' : ''}`, onclick: () => { obj.size = k; ctx.changed(); apply(); } }, k === 'full' ? 'Full' : k.toUpperCase()));
  const { el, body } = frame('image', obj, ctx, del, sizeBtns);
  const img = h('img', { class: 'img', src: imgUrl(obj.file), alt: obj.title || 'image', draggable: 'false' });
  img.addEventListener('load', () => ctx.view && ctx.view.requestMeasure());
  img.addEventListener('error', () => { body.replaceChildren(h('div', { class: 'bb faint' }, /\.heic$/.test(obj.file) ? 'HEIC photo — can\'t be shown. Send it as JPEG (the Safari page does this automatically).' : 'Image not found.')); });
  img.addEventListener('click', () => modal(obj.title || 'Image', h('div', { class: 'lightbox' }, h('img', { src: imgUrl(obj.file) })), [], { width: 'auto' }));
  body.append(img);
  function apply() {
    el.style.width = obj.size === 'full' ? 'calc(100% - 0px)' : SIZES[obj.size];
    img.style.width = '100%';
    sizeBtns.forEach((b, i) => b.classList.toggle('on', Object.keys(SIZES)[i] === obj.size));
    ctx.view && ctx.view.requestMeasure();
  }
  apply();
  return el;
}
