// Small, safe spreadsheet formula engine shared by the renderer (tables, curves)
// and the main process (exporting notes for the AI). No eval.
//
//   =A1+B2*2   =SUM(B2:B9)   =PMT(0.05/12, 360, 250000)   =ROUND(C4/C5, 2)
//   Curves use the same parser with a variable: "20 - 2*Q"

'use strict';

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?/i.exec(src.slice(i));
      if (!m) throw new Error('Bad number');
      let v = parseFloat(m[0]);
      if (m[0].endsWith('%')) v /= 100;
      out.push({ t: 'num', v });
      i += m[0].length;
      continue;
    }
    if (c === '$' || /[A-Za-z_]/.test(c)) {
      const m = /^\$?[A-Za-z_]+\$?[0-9]*/.exec(src.slice(i));
      const word = m[0].replace(/\$/g, '');
      const ref = /^([A-Za-z]{1,2})([0-9]+)$/.exec(word);
      if (ref) out.push({ t: 'ref', col: colIndex(ref[1]), row: parseInt(ref[2], 10) - 1, name: word.toUpperCase() });
      else out.push({ t: 'id', v: word.toUpperCase() });
      i += m[0].length;
      continue;
    }
    if ('+-*/^(),:'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// Recursive descent: expr := term (('+'|'-') term)*, term := unary (('*'|'/') unary)*,
// unary := '-' unary | power, power := atom ('^' unary)?
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`Expected "${v}"`); p++; };

  function expr() {
    let node = term();
    while (isOp('+') || isOp('-')) { const op = toks[p++].v; node = { k: 'bin', op, a: node, b: term() }; }
    return node;
  }
  function term() {
    let node = unary();
    while (isOp('*') || isOp('/')) { const op = toks[p++].v; node = { k: 'bin', op, a: node, b: unary() }; }
    return node;
  }
  function unary() {
    if (isOp('-')) { p++; return { k: 'neg', a: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }
  function power() {
    const base = atom();
    if (isOp('^')) { p++; return { k: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function atom() {
    const t = peek();
    if (!t) throw new Error('Unexpected end');
    if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
    if (t.t === 'ref') {
      p++;
      if (isOp(':')) {
        p++;
        const e = peek();
        if (!e || e.t !== 'ref') throw new Error('Bad range');
        p++;
        return { k: 'range', a: t, b: e };
      }
      return { k: 'ref', ref: t };
    }
    if (t.t === 'id') {
      p++;
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) {
          args.push(expr());
          while (isOp(',')) { p++; args.push(expr()); }
        }
        expect(')');
        return { k: 'call', fn: t.v, args };
      }
      return { k: 'var', name: t.v };
    }
    if (isOp('(')) { p++; const e = expr(); expect(')'); return e; }
    throw new Error(`Unexpected "${t.v}"`);
  }

  const tree = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v || toks[p].name}"`);
  return tree;
}

const flat = (args) => args.flat(Infinity).filter((x) => typeof x === 'number' && !Number.isNaN(x));

const FUNCS = {
  SUM: (a) => flat(a).reduce((s, x) => s + x, 0),
  AVG: (a) => { const f = flat(a); return f.length ? f.reduce((s, x) => s + x, 0) / f.length : 0; },
  MIN: (a) => Math.min(...flat(a)),
  MAX: (a) => Math.max(...flat(a)),
  COUNT: (a) => flat(a).length,
  ABS: ([x]) => Math.abs(x),
  SQRT: ([x]) => Math.sqrt(x),
  LN: ([x]) => Math.log(x),
  LOG: ([x]) => Math.log10(x),
  EXP: ([x]) => Math.exp(x),
  ROUND: ([x, n = 0]) => { const f = 10 ** n; return Math.round(x * f) / f; },
  // Excel-compatible time value of money (cash out is negative)
  FV: ([r, n, pmt, pv = 0, type = 0]) =>
    r === 0 ? -(pv + pmt * n) : -(pv * (1 + r) ** n + pmt * (1 + r * type) * (((1 + r) ** n - 1) / r)),
  PV: ([r, n, pmt, fv = 0, type = 0]) =>
    r === 0 ? -(fv + pmt * n) : -(fv + pmt * (1 + r * type) * (((1 + r) ** n - 1) / r)) / (1 + r) ** n,
  PMT: ([r, n, pv, fv = 0, type = 0]) =>
    r === 0 ? -(pv + fv) / n : -(r * (fv + pv * (1 + r) ** n)) / ((1 + r * type) * ((1 + r) ** n - 1)),
  NPV: ([r, ...vals]) => flat(vals).reduce((s, v, i) => s + v / (1 + r) ** (i + 1), 0),
};
FUNCS.AVERAGE = FUNCS.AVG;

function evaluate(node, ctx) {
  switch (node.k) {
    case 'num': return node.v;
    case 'neg': return -evaluate(node.a, ctx);
    case 'ref': return ctx.cell ? ctx.cell(node.ref.row, node.ref.col) : NaN;
    case 'var': {
      if (ctx.vars && node.name in ctx.vars) return ctx.vars[node.name];
      throw new Error(`Unknown name ${node.name}`);
    }
    case 'range': {
      const r0 = Math.min(node.a.row, node.b.row), r1 = Math.max(node.a.row, node.b.row);
      const c0 = Math.min(node.a.col, node.b.col), c1 = Math.max(node.a.col, node.b.col);
      const out = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(ctx.cell ? ctx.cell(r, c) : NaN);
      return out;
    }
    case 'call': {
      const fn = FUNCS[node.fn];
      if (!fn) throw new Error(`Unknown function ${node.fn}`);
      return fn(node.args.map((a) => evaluate(a, ctx)));
    }
    case 'bin': {
      const a = evaluate(node.a, ctx), b = evaluate(node.b, ctx);
      if (Array.isArray(a) || Array.isArray(b)) throw new Error('Range used outside a function');
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '^': return a ** b;
      }
    }
  }
  throw new Error('Bad expression');
}

// "$1,234.50" -> 1234.5, "(500)" -> -500, "12%" -> 0.12, "abc" -> NaN
function parseNumber(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, '');
  let pct = false;
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  let v = parseFloat(s);
  if (pct) v /= 100;
  return neg ? -v : v;
}

// Compiles "20 - 2Q" style curve equations into f(q). Accepts Q or X as the variable.
function compileCurve(eq) {
  const src = String(eq).replace(/^\s*[PpYy]\s*=\s*/, '').replace(/(\d)\s*([QqXx])\b/g, '$1*$2');
  const tree = parse(src);
  return (q) => evaluate(tree, { vars: { Q: q, X: q } });
}

function formatValue(v, fmt) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '';
  if (!Number.isFinite(v)) return '#DIV/0!';
  const abs = Math.abs(v);
  const neg = v < 0;
  switch (fmt) {
    case 'currency': {
      const s = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return neg ? `(${s})` : s;
    }
    case 'accounting': {
      const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return neg ? `(${s})` : s;
    }
    case 'percent':
      return (v * 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
    case 'number':
      return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
    default: {
      if (Number.isInteger(v)) return v.toLocaleString('en-US');
      return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
    }
  }
}

// Evaluates every cell of a table object: { rows: string[][], formats: string[] }
// Returns rows of { raw, value (number|NaN), display, error }.
function computeTable(table) {
  const rows = table.rows || [];
  const formats = table.formats || [];
  const memo = new Map();
  const visiting = new Set();

  function cellValue(r, c) {
    const key = r + ':' + c;
    if (memo.has(key)) return memo.get(key).value;
    if (visiting.has(key)) throw new Error('Circular reference');
    visiting.add(key);
    const res = computeCell(r, c);
    visiting.delete(key);
    memo.set(key, res);
    if (res.error) throw new Error(res.error);
    return res.value;
  }

  function computeCell(r, c) {
    const raw = (rows[r] && rows[r][c]) != null ? String(rows[r][c]) : '';
    if (raw.startsWith('=')) {
      try {
        const v = evaluate(parse(raw.slice(1)), { cell: cellValue });
        if (Array.isArray(v)) return { value: NaN, error: 'Range' };
        return { value: v };
      } catch (e) {
        return { value: NaN, error: e.message };
      }
    }
    return { value: parseNumber(raw) };
  }

  return rows.map((row, r) =>
    row.map((raw, c) => {
      const key = r + ':' + c;
      let res = memo.get(key);
      if (!res) {
        try { cellValue(r, c); } catch { /* error captured in memo */ }
        res = memo.get(key) || { value: NaN, error: 'Error' };
      }
      const str = raw == null ? '' : String(raw);
      let display;
      if (res.error) display = '#ERR';
      else if (str.startsWith('=') || (!Number.isNaN(res.value) && formats[c] && formats[c] !== 'text')) display = formatValue(res.value, formats[c]);
      else display = str;
      return { raw: str, value: res.value, display, error: res.error };
    })
  );
}

module.exports = { parse, evaluate, parseNumber, formatValue, computeTable, compileCurve, colName, colIndex };
