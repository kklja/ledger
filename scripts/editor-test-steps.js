// Screenshot-mode steps that exercise the editor's click-anywhere typing in the real app.
// Usage: set LEDGER_SHOT_STEPS to the output of `node scripts/editor-test-steps.js`.
const click = (lineExpr, colExpr) => `
  const v = window.__ledgerEditor.view;
  const cw = v.defaultCharacterWidth;
  const pad = parseFloat(getComputedStyle(v.contentDOM.querySelector('.cm-line')).paddingLeft);
  const left = v.contentDOM.getBoundingClientRect().left + pad;
  const yy = ${lineExpr};
  const x = left + cw * (${colExpr});
  const t = document.elementFromPoint(x, yy);
  t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: yy, button: 0, detail: 1 }));
  t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: yy, button: 0, detail: 1 }));`;

const steps = [
  "open|window.__ledgerGo('notes', { noteId: 'n1' })",
  // 1) click at column 60 on line 3 (which is only 41 chars long) and type
  `pastend|(async () => { ${click("(() => { const r = window.__ledgerEditor.view.coordsAtPos(window.__ledgerEditor.view.state.doc.line(3).from); return (r.top + r.bottom) / 2; })()", '60')}
    await new Promise((r) => setTimeout(r, 50));
    document.execCommand('insertText', false, 'TYPED@60');
    const l = v.state.doc.line(3).text; return JSON.stringify({ col: l.indexOf('TYPED'), line: l });
  })()`,
  // 2) click 3 lines below the end of the note at column 12 and type
  `below|(async () => {
    const v0 = window.__ledgerEditor.view; v0.scrollDOM.scrollTop = 1e6; await new Promise((r) => setTimeout(r, 300));
    const linesBefore = v0.state.doc.lines;
    ${click('v0.documentTop + v0.lineBlockAt(v0.state.doc.length).bottom + v0.defaultLineHeight * 2.5', '12')}
    await new Promise((r) => setTimeout(r, 50));
    document.execCommand('insertText', false, 'BELOW@12');
    await new Promise((r) => setTimeout(r, 100));
    const d = v.state.doc; const last = d.line(d.lines).text; return JSON.stringify({ linesBefore, lines: d.lines, col: last.indexOf('BELOW'), last });
  })()`,
  // 3) click past the end of line 1 but type nothing, then click elsewhere: padding must disappear
  `cleanup|(async () => { ${click("(() => { const r = window.__ledgerEditor.view.coordsAtPos(0); return (r.top + r.bottom) / 2; })()", '50')}
    await new Promise((r) => setTimeout(r, 50));
    const padded = v.state.doc.line(1).text.length;
    v.dispatch({ selection: { anchor: v.state.doc.line(5).from } });
    await new Promise((r) => setTimeout(r, 400));
    return JSON.stringify({ paddedLen: padded, afterLen: v.state.doc.line(1).text.length });
  })()`,
  "notes|window.__ledgerEditor.view.scrollDOM.scrollTop = 0",
  "notes-blocks|window.__ledgerEditor.view.scrollDOM.scrollTop = 420",
];
process.stdout.write(steps.map((s) => s.replace(/\n\s*/g, ' ')).join(';;'));
