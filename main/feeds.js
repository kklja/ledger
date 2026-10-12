'use strict';
// Optional backup sources that cost no AI usage: the iCal calendar link Canvas and
// Blackboard both offer, and Canvas announcement RSS/Atom links.

function unescapeIcs(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function tzToUtc(parts, tz) {
  const [y, mo, d, h, mi, s] = parts;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const p = Object.fromEntries(f.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return new Date(guess - (wall - guess));
  } catch {
    return new Date(y, mo - 1, d, h, mi, s); // unknown tz name: treat as local
  }
}

function icsDate(prop) {
  if (!prop) return { date: null, allDay: false };
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(prop.val.trim());
  if (!m) return { date: null, allDay: false };
  const parts = [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
  if (!m[4] || prop.p.VALUE === 'DATE') return { date: new Date(parts[0], parts[1] - 1, parts[2]), allDay: true };
  if (m[7]) return { date: new Date(Date.UTC(...parts.map((v, i) => (i === 1 ? v - 1 : v)))), allDay: false };
  if (prop.p.TZID) return { date: tzToUtc(parts, prop.p.TZID.replace(/"/g, '')), allDay: false };
  return { date: new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]), allDay: false };
}

function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const items = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT' || line === 'BEGIN:VTODO') cur = {};
    else if (line === 'END:VEVENT' || line === 'END:VTODO') {
      if (cur) {
        const start = icsDate(cur.DTSTART || cur.DUE);
        const end = icsDate(cur.DTEND);
        if (start.date) {
          items.push({
            uid: cur.UID ? cur.UID.val : `${cur.SUMMARY && cur.SUMMARY.val}|${start.date.toISOString()}`,
            title: unescapeIcs(cur.SUMMARY ? cur.SUMMARY.val : '(untitled)'),
            start: start.date.toISOString(),
            end: end.date ? end.date.toISOString() : null,
            allDay: start.allDay,
            text: unescapeIcs(cur.DESCRIPTION ? cur.DESCRIPTION.val : '').slice(0, 1500),
            url: cur.URL ? cur.URL.val : '',
            location: unescapeIcs(cur.LOCATION ? cur.LOCATION.val : ''),
          });
        }
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const p = {};
      for (const x of params) { const [k, v] = x.split('='); p[k.toUpperCase()] = v || ''; }
      cur[name.toUpperCase()] = { val: line.slice(i + 1), p };
    }
  }
  return items;
}

function decodeXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function stripHtml(html) {
  return decodeXml(String(html || ''))
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseFeedXml(text) {
  const items = [];
  const blocks = text.match(/<entry[\s>][\s\S]*?<\/entry>/g) || text.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
  const tag = (b, t) => { const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i').exec(b); return m ? m[1] : ''; };
  for (const b of blocks) {
    const link = (/<link[^>]*href="([^"]+)"/i.exec(b) || [])[1] || decodeXml(tag(b, 'link'));
    const when = tag(b, 'published') || tag(b, 'updated') || tag(b, 'pubDate') || tag(b, 'dc:date');
    const d = new Date(decodeXml(when).trim());
    items.push({
      uid: decodeXml(tag(b, 'id') || tag(b, 'guid') || link),
      title: stripHtml(tag(b, 'title')),
      start: Number.isNaN(d.getTime()) ? null : d.toISOString(),
      kind: 'post',
      text: stripHtml(tag(b, 'content') || tag(b, 'summary') || tag(b, 'description')).slice(0, 2000),
      url: link,
    });
  }
  return items;
}

async function fetchFeed(url) {
  const u = url.trim().replace(/^webcal:\/\//i, 'https://');
  const res = await fetch(u, { headers: { 'User-Agent': 'Ledger/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.includes('BEGIN:VCALENDAR')) return { type: 'ics', items: parseIcs(text) };
  if (/<feed[\s>]|<rss[\s>]/.test(text)) return { type: 'rss', items: parseFeedXml(text) };
  throw new Error('Not an iCal or RSS/Atom feed');
}

module.exports = { fetchFeed, parseIcs, parseFeedXml, stripHtml };
