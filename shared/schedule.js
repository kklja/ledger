'use strict';
// Weekly class meetings -> dated occurrences (local time).

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** Classes between `from` and `to` (Dates). term: {start,end} 'YYYY-MM-DD' (optional). */
function classOccurrences(courses, term, from, to) {
  const out = [];
  const tStart = parseYmd(term && term.start);
  const tEnd = parseYmd(term && term.end);
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (; day <= to; day.setDate(day.getDate() + 1)) {
    if (tStart && day < tStart) continue;
    if (tEnd && day > tEnd) continue;
    const key = ymd(day);
    for (const c of courses) {
      if (c.hidden) continue;
      (c.meetings || []).forEach((m, mi) => {
        if (!(m.days || []).includes(day.getDay()) || !m.start) return;
        const s = hm(m.start), e = hm(m.end || m.start);
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(s / 60), s % 60);
        const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(e / 60), e % 60);
        out.push({
          key: `class:${c.id}:${mi}:${key}`, courseId: c.id, meeting: m, date: key, start, end,
          cancelled: (c.cancelled || []).includes(key),
        });
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

module.exports = { classOccurrences, ymd, hm, parseYmd, pad };
