import { api } from '../api.js';
import { app, course, refresh } from '../state.js';
import { h, clear, rel, toast, fmtWhen, modal } from '../util.js';
import { watchRun, showAnswer, reviewPending } from './shared.js';
import { go } from '../nav.js';

const ui = { courseId: '', quizzes: [], detect: null };
const errMsg = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function mount(el, opts = {}) {
  const render = async () => {
    const top = el.scrollTop;
    ui.quizzes = await api.listQuizzes();
    clear(el).append(page());
    el.scrollTop = top;
  };
  render();
  if (!ui.detect) api.aiDetect().then((d) => { ui.detect = d; render(); });
  if (opts.quizId) openQuiz(opts.quizId);
  return { update: (keys) => { if (!keys || keys.some((k) => ['runs', 'courses', 'settings', 'pending'].includes(k))) render(); } };
}

function start(task, params, title, onDone) {
  api.aiRun(task, params).then((id) => watchRun(id, title, onDone)).catch((e) => toast(errMsg(e), 'bad'));
}

function page() {
  const st = app.st;
  const prov = st.settings.ai.provider;
  const d = ui.detect;
  const p = h('div', { class: 'page' });
  const courseSel = h('select', { class: 'in', onchange: (e) => (ui.courseId = e.target.value) }, h('option', { value: '' }, 'All classes'), st.courses.map((c) => h('option', { value: c.id }, `${c.code} — ${c.name || ''}`)));
  courseSel.value = ui.courseId;

  p.append(h('div', { class: 'pagehead' },
    h('div', null, h('h1', null, 'AI Study'), h('div', { class: 'sub' }, 'Uses your Claude or Codex subscription (no API key). The AI reads your notes, your Canvas/Blackboard data, and can open the course sites itself.')),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Class'), courseSel,
      h('div', { class: 'seg' }, ['claude', 'codex'].map((k) => h('button', { class: `btn ${prov === k ? 'on' : ''}`, title: d ? (d[k] || 'Not found') : '', onclick: () => api.updateSettings({ ai: { provider: k } }) }, `${k === 'claude' ? 'Claude' : 'Codex'}${d && !d[k] ? ' (not found)' : ''}`))))));

  const topic = h('input', { class: 'in', style: { width: '100%', marginBottom: '8px' }, value: ui.topic || '', oninput: (e) => (ui.topic = e.target.value), placeholder: 'Topic (optional) — e.g. "Chapter 9 inventory: FIFO, LIFO, weighted average"' });
  const qcount = h('select', { class: 'in' }, [5, 10, 15, 20].map((n) => h('option', { value: n, selected: n === 10 }, `${n} questions`)));
  const question = h('textarea', { class: 'in', rows: 3, value: ui.question || '', oninput: (e) => (ui.question = e.target.value), style: { width: '100%', marginBottom: '8px', fontFamily: 'var(--ui)', fontSize: '13px' }, placeholder: 'e.g. "What do I need to finish this week?" or "Explain the difference between accrued and deferred revenue using my notes"' });

  p.append(h('div', { class: 'cols3' },
    h('div', { class: 'action' }, h('h3', null, 'Study guide'), h('p', null, 'Built from your notes, slides, assignments and announcements. Saved as a note with real tables for journal entries.'), topic,
      h('button', { class: 'btn primary', onclick: () => start('studyGuide', { courseId: ui.courseId, topic: topic.value.trim() }, 'Writing study guide', (run) => run.result?.noteId && refresh(['notes']).then(() => go('notes', { noteId: run.result.noteId }))) }, 'Create study guide')),
    h('div', { class: 'action' }, h('h3', null, 'Practice quiz'), h('p', null, 'Multiple choice and numeric problems (accounting/econ calculations), graded instantly with explanations.'),
      h('div', { class: 'row', style: { marginBottom: '8px' } }, qcount, h('span', { class: 'faint small' }, 'uses the topic box on the left')),
      h('button', { class: 'btn primary', onclick: () => start('quiz', { courseId: ui.courseId, topic: topic.value.trim(), count: Number(qcount.value) }, 'Writing quiz', (run) => run.result?.quizId && openQuiz(run.result.quizId)) }, 'Create quiz')),
    h('div', { class: 'action' }, h('h3', null, 'Ask'), h('p', null, 'Anything about your classes. Answers cite the file or page they came from.'), question,
      h('button', { class: 'btn primary', onclick: () => { if (!question.value.trim()) return toast('Type a question', 'bad'); start('ask', { courseId: ui.courseId, question: question.value.trim() }, 'Thinking', (run) => showAnswer('Answer', run.result?.text || '')); } }, 'Ask')),
  ));

  // Syllabus mapping
  const sy = h('div', { class: 'panel', style: { marginTop: '16px' } },
    h('div', { class: 'ph' }, h('h2', null, 'Syllabus → calendar'), h('span', { class: 'faint small' }, st.settings.lms.autoRemap ? 'Auto-update on: re-maps when a syllabus changes or an announcement moves a date' : 'Auto-update off (Settings)')),
    h('div', { class: 'pb flush' }, h('table', { class: 'grid' },
      h('tr', null, h('th', null, 'Class'), h('th', null, 'Dated items in calendar'), h('th', null, 'Pending'), h('th')),
      st.courses.map((c) => {
        const n = st.events.filter((e) => e.courseId === c.id && e.source === 'syllabus').length;
        const pend = (st.pending || []).find((x) => x.courseId === c.id);
        return h('tr', null, h('td', null, h('span', { class: 'chip', style: { '--c': c.color } }, c.code)), h('td', null, n ? `${n} items` : h('span', { class: 'faint' }, 'not mapped')),
          h('td', null, pend ? h('a', { onclick: () => reviewPending(pend) }, 'Review changes') : ''),
          h('td', { style: { textAlign: 'right' } },
            h('button', { class: 'btn sm', title: 'Drop syllabus PDFs here for the AI', onclick: () => api.openCourseFiles(c.id) }, 'Files folder'), ' ',
            h('button', { class: 'btn sm primary', onclick: () => start('mapSyllabus', { courseId: c.id }, `Mapping ${c.code} syllabus`, async (run) => {
              await refresh();
              const pend2 = app.st.pending.find((x) => x.id === (run.result && run.result.pendingId));
              if (pend2) reviewPending(pend2);
              else toast('No changes — your calendar already matches the syllabus', 'ok');
            }) }, 'Map now')));
      }),
      !st.courses.length ? h('tr', null, h('td', { colspan: 4, class: 'empty' }, 'No classes yet.')) : null)));
  p.append(sy);

  // Quizzes + runs
  const ql = h('div');
  for (const q of ui.quizzes) ql.append(h('div', { class: 'act', style: { cursor: 'pointer' }, onclick: () => openQuiz(q.id) },
    h('div', null, course(q.courseId) ? h('span', { class: 'chip', style: { '--c': course(q.courseId).color, marginRight: '6px' } }, course(q.courseId).code) : null, h('b', null, q.title)),
    h('div', { class: 'meta' }, `${q.count} questions · ${rel(new Date(q.created))}${q.best >= 0 ? ` · best ${q.best}%` : ''}`)));
  if (!ui.quizzes.length) ql.append(h('div', { class: 'empty' }, 'No quizzes yet.'));

  const rl = h('div');
  for (const r of [...(st.runs || [])].reverse()) {
    rl.append(h('div', { class: 'act' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, r.label), h('span', { class: r.status === 'error' ? 'danger-t' : r.status === 'running' ? 'warn-t' : 'ok-t' }, r.status)),
      h('div', { class: 'meta' }, `${r.provider} · ${fmtWhen(new Date(r.started))}${r.error ? ` · ${r.error.slice(0, 160)}` : ''}`),
      h('div', { class: 'row', style: { marginTop: '4px' } },
        r.result?.noteId ? h('button', { class: 'btn sm', onclick: () => go('notes', { noteId: r.result.noteId }) }, 'Open note') : null,
        r.result?.quizId ? h('button', { class: 'btn sm', onclick: () => openQuiz(r.result.quizId) }, 'Open quiz') : null,
        r.result?.text ? h('button', { class: 'btn sm', onclick: () => showAnswer(r.label, r.result.text) }, 'Show answer') : null,
        r.status === 'running' ? h('button', { class: 'btn sm danger', onclick: () => api.aiCancel(r.id) }, 'Cancel') : null)));
  }
  if (!(st.runs || []).length) rl.append(h('div', { class: 'empty' }, 'Nothing run yet this session.'));

  p.append(h('div', { class: 'cols', style: { gridTemplateColumns: '1fr 1fr' } },
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Quizzes')), h('div', { class: 'pb flush' }, ql)),
    h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Recent AI runs')), h('div', { class: 'pb flush' }, rl))));
  return p;
}

// ---------- quiz player ----------
export async function openQuiz(id) {
  const q = await api.getQuiz(id);
  if (!q) return toast('Quiz not found', 'bad');
  const answers = new Array(q.questions.length).fill(null);
  let graded = false;
  const body = h('div');
  const result = h('div', { style: { fontWeight: 600 } });

  const draw = () => {
    clear(body);
    q.questions.forEach((qq, i) => {
      const box = h('div', { class: 'qz' }, h('div', { class: 'q' }, `${i + 1}. ${qq.q}`));
      if (qq.type === 'numeric') {
        const ok = graded && answers[i] != null && Math.abs(Number(answers[i]) - Number(qq.answer)) <= Math.max(Number(qq.tolerance) || 0.01, Math.abs(Number(qq.answer)) * 0.001);
        box.append(h('div', { class: 'row' }, qq.unit === '$' ? h('span', null, '$') : null,
          h('input', { class: 'in', style: { width: '180px', borderColor: graded ? (ok ? 'var(--ok)' : 'var(--danger)') : null }, value: answers[i] ?? '', disabled: graded, oninput: (e) => (answers[i] = e.target.value.replace(/[$,\s]/g, '')) }),
          qq.unit && qq.unit !== '$' ? h('span', null, qq.unit) : null,
          graded ? h('span', { class: ok ? 'ok-t' : 'danger-t' }, ok ? '✓ Correct' : `✗ Answer: ${qq.unit === '$' ? '$' : ''}${Number(qq.answer).toLocaleString('en-US', { maximumFractionDigits: 4 })}`) : null));
      } else {
        (qq.choices || []).forEach((ch, j) => {
          const cls = graded ? (j === qq.answer ? 'right' : answers[i] === j ? 'wrong' : '') : '';
          box.append(h('label', { class: cls }, h('input', { type: 'radio', name: `q${i}`, checked: answers[i] === j, disabled: graded, onchange: () => (answers[i] = j) }), ' ', `${String.fromCharCode(65 + j)}. ${ch}`));
        });
      }
      if (graded && qq.explain) box.append(h('div', { class: 'ex' }, qq.explain));
      body.append(box);
    });
  };
  draw();
  const grade = async () => {
    graded = true;
    let right = 0;
    q.questions.forEach((qq, i) => {
      if (qq.type === 'numeric') { if (answers[i] != null && answers[i] !== '' && Math.abs(Number(answers[i]) - Number(qq.answer)) <= Math.max(Number(qq.tolerance) || 0.01, Math.abs(Number(qq.answer)) * 0.001)) right++; }
      else if (answers[i] === qq.answer) right++;
    });
    const score = Math.round((right / q.questions.length) * 100);
    result.textContent = `Score: ${right}/${q.questions.length} (${score}%)`;
    q.attempts = [...(q.attempts || []), { at: new Date().toISOString(), score }];
    await api.saveQuiz(q);
    draw();
    return false;
  };
  modal(q.title, h('div', null, result, body), [
    { label: 'Retake', onClick: () => { graded = false; answers.fill(null); result.textContent = ''; draw(); return false; } },
    { label: 'Check answers', primary: true, onClick: grade },
  ], { width: '860px' });
}
