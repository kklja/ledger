'use strict';
// Converts a Ledger note (plain text + embedded objects) to Markdown, so the AI
// can read notes, and parses Markdown tables back into table objects.

const { computeTable, formatValue } = require('./formula');

const BLOCK_RE = /^::(table|chart|curves|taccount|journal|image) ([a-z0-9]+)\s*$/;

function mdTable(rows) {
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
  const [head, ...body] = rows;
  return [`| ${pad(head).join(' | ')} |`, `| ${pad(head).map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${pad(r).join(' | ')} |`)].join('\n');
}

function objectToMarkdown(type, o, imageRoot) {
  if (!o) return `[missing ${type}]`;
  switch (type) {
    case 'table': {
      const computed = computeTable(o).map((r) => r.map((c) => c.display));
      return (o.title ? `**${o.title}**\n\n` : '') + mdTable(computed);
    }
    case 'journal': {
      const rows = [['Date', 'Account', 'Debit', 'Credit']];
      let dr = 0, cr = 0;
      for (const r of o.rows || []) {
        const d = parseFloat(r.debit) || 0, c = parseFloat(r.credit) || 0;
        dr += d; cr += c;
        rows.push([r.date || '', c && !d ? `    ${r.account || ''}` : r.account || '', d ? formatValue(d, 'accounting') : '', c ? formatValue(c, 'accounting') : '']);
      }
      rows.push(['', 'Total', formatValue(dr, 'accounting'), formatValue(cr, 'accounting')]);
      return `**Journal entry${o.title ? `: ${o.title}` : ''}**${o.memo ? ` — ${o.memo}` : ''}\n\n${mdTable(rows)}`;
    }
    case 'taccount': {
      const sum = (a) => (a || []).reduce((s, x) => s + (parseFloat(x.amt) || 0), 0);
      const L = sum(o.left), R = sum(o.right);
      const lines = [`**T-account: ${o.title || 'Account'}**`, '', 'Debits:'];
      for (const x of o.left || []) lines.push(`- ${x.label || ''} ${formatValue(parseFloat(x.amt) || 0, 'accounting')}`);
      lines.push('', 'Credits:');
      for (const x of o.right || []) lines.push(`- ${x.label || ''} ${formatValue(parseFloat(x.amt) || 0, 'accounting')}`);
      lines.push('', `Balance: ${formatValue(Math.abs(L - R), 'accounting')} ${L >= R ? 'debit' : 'credit'}`);
      return lines.join('\n');
    }
    case 'chart': {
      const rows = [['', ...(o.series || []).map((s) => s.name)]];
      (o.labels || []).forEach((l, i) => rows.push([l, ...(o.series || []).map((s) => s.values[i] ?? '')]));
      return `**${o.kind || 'bar'} chart${o.title ? `: ${o.title}` : ''}**\n\n${mdTable(rows)}`;
    }
    case 'curves': {
      const lines = [`**Graph${o.title ? `: ${o.title}` : ''}** (x: ${o.xLabel || 'Q'}, y: ${o.yLabel || 'P'})`];
      for (const c of o.curves || []) lines.push(`- ${c.name}: P = ${c.eq}`);
      for (const l of o.hlines || []) lines.push(`- ${l.name}: P = ${l.y}`);
      return lines.join('\n');
    }
    case 'image':
      return `![image](${imageRoot ? `${imageRoot}/${o.file}` : o.file})`;
  }
  return '';
}

function noteToMarkdown(note, imageRoot) {
  const lines = String(note.text || '').split('\n');
  const out = [`# ${note.title || 'Untitled'}`, ''];
  for (const line of lines) {
    const m = BLOCK_RE.exec(line);
    if (m) out.push('', objectToMarkdown(m[1], (note.objects || {})[m[2]], imageRoot), '');
    else out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// Split Markdown into plain text + table objects (used for AI-made notes).
function markdownToNote(md, makeId) {
  const lines = String(md).replace(/\r/g, '').split('\n');
  const out = [];
  const objects = {};
  for (let i = 0; i < lines.length; i++) {
    const isRow = (l) => /^\s*\|.*\|\s*$/.test(l || '');
    if (isRow(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const rows = [];
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|').replace(/\*\*/g, ''));
      rows.push(cells(lines[i]));
      i += 2;
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      i--;
      const id = makeId();
      const numeric = rows[0].map((_, c) => rows.slice(1).some((r) => /^\(?\$?-?[\d,]+(\.\d+)?\)?$/.test(r[c] || '')));
      objects[id] = { type: 'table', rows, header: true, formats: numeric.map((n) => (n ? 'auto' : 'text')) };
      out.push(`::table ${id}`);
    } else {
      out.push(lines[i].replace(/\*\*(.+?)\*\*/g, '$1'));
    }
  }
  return { text: out.join('\n'), objects };
}

module.exports = { noteToMarkdown, markdownToNote, mdTable, BLOCK_RE };
