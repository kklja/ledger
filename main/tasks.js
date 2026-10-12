'use strict';
// Prompt templates for the AI actions. Every task runs inside the ai-context folder.

const header = (S, browse) => `You are the study assistant inside "Ledger", a college student's notes app. The student is an Accounting major.
Today is ${new Date().toString()}.
The current folder holds the student's real data: README.md, calendar.md, and courses/<CODE>/ with course.md, assignments.md,
announcements.md, syllabus.md, schedule.md, notes/*.md and files/* (documents the student added). Read the relevant files first.
${browse ? `You also have a browser already signed in to the course sites (Canvas: ${S.settings.lms.canvasUrl || 'n/a'}, Blackboard: ${S.settings.lms.blackboardUrl || 'n/a'}).
Use it (only the Playwright tools whose names start with "browser_") when the files are not enough (e.g. to open lecture slides, readings, or assignment pages). Read only: never submit, post or change anything, never type passwords.` : ''}
Base everything on this material. If something is not in it, say so instead of guessing. Do not create or modify files.`;

function courseLine(S, courseId) {
  const c = (S.courses || []).find((x) => x.id === courseId);
  return c ? `${c.code} (${c.name || ''}) — files in courses/${c.code.replace(/[\\/:*?"<>|]/g, '-')}/` : 'all courses';
}

const TASKS = {
  studyGuide: (S, p, browse) => `${header(S, browse)}

Task: write a study guide for ${courseLine(S, p.courseId)}${p.topic ? ` on: ${p.topic}` : ' covering the next exam or the most recent material'}.
${p.noteText ? `Start from this note the student wrote:\n<note>\n${p.noteText}\n</note>\n` : ''}
Format (plain Markdown, it is shown in a monospace notes editor):
- First line "# <title>". Use "## " section headings, short bullet points, and key formulas on their own lines.
- Accounting: show journal entries as Markdown tables with columns Account | Debit | Credit; show calculations step by step.
- Economics: give the equations and say what shifts each curve and which way.
- End with "## Practice" containing 5 questions, then "## Answers".
Output only the Markdown.`,

  quiz: (S, p, browse) => `${header(S, browse)}

Task: write a ${p.count || 10}-question practice quiz for ${courseLine(S, p.courseId)}${p.topic ? ` on: ${p.topic}` : ' on the material most likely to be tested next'}.
${p.noteText ? `Focus on this note:\n<note>\n${p.noteText}\n</note>\n` : ''}
Mix conceptual multiple choice with numeric problems (accounting/economics calculations) where the subject allows.
Reply with ONLY JSON:
{"title": "...", "questions": [
  {"type": "mc", "q": "...", "choices": ["...", "...", "...", "..."], "answer": 0, "explain": "..."},
  {"type": "numeric", "q": "...", "answer": 1234.5, "tolerance": 0.01, "unit": "$", "explain": "step by step"}
]}
"answer" for mc is the 0-based index of the correct choice.`,

  ask: (S, p, browse) => `${header(S, browse)}

Context: ${courseLine(S, p.courseId)}.
Question: ${p.question}
Answer clearly and concisely in Markdown. Cite which file or page each fact came from in parentheses.`,

  mapSyllabus: (S, p, browse) => `${header(S, browse)}

Task: build the complete dated schedule for ${courseLine(S, p.courseId)} for this term.
Sources, in order of authority: announcements.md (newest wins: when an announcement moves a date, use the new date), assignments.md, syllabus.md, files/ (syllabus PDFs) and the course site.
Term: ${S.settings.term.start || '?'} to ${S.settings.term.end || '?'}.
Include exams, quizzes, project/paper deadlines, readings or topics per class date if listed, and no-class days.
Leave out items that already appear in assignments.md with the same due date (Ledger already shows those).
Reply with ONLY JSON:
{"items": [{"date": "YYYY-MM-DD", "time": "HH:MM or empty", "title": "...", "kind": "exam|quiz|due|reading|topic|no-class|event", "note": "where this came from, e.g. 'syllabus p.3' or 'moved per announcement Oct 2'"}]}`,

  importSchedule: (S, p) => `You convert a college class schedule copied from a registration portal into JSON. Today is ${new Date().toDateString()}.
Schedule text:
<schedule>
${p.text}
</schedule>
Reply with ONLY JSON:
{"term": {"start": "YYYY-MM-DD or empty", "end": "YYYY-MM-DD or empty"},
 "courses": [{"code": "ECON 120", "name": "...", "instructor": "...", "meetings": [{"days": "MW", "start": "HH:MM (24h)", "end": "HH:MM (24h)", "building": "...", "room": "...", "kind": "Lecture|Lab|Discussion|Online"}]}]}
Days use M T W R F S U (R = Thursday, U = Sunday). Online/asynchronous classes get an empty meetings array.`,

  test: () => 'Reply with exactly: OK',
};

module.exports = { TASKS };
