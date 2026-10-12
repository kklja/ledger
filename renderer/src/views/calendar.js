import { api } from '../api.js';
import { app, buildItems } from '../state.js';
import { h, clear, fmtTime, addDays, startOfDay, startOfWeek, sameDay, DAY_SHORT, toast, rid } from '../util.js';
import { itemPopover, closePopover } from './shared.js';
import { addReminder } from '../quickadd.js';

const HOUR_PX = 48;
const ui = { mode: 'week', anchor: new Date(), layers: { class: true, due: true, event: true, reminder: true } };

export function mount(el) {
  const render = () => {
    const scroller = el.querySelector('.cal-scroll');
    const top = scroller ? scroller.scrollTop : null;
    clear(el).append(view());
    const s = el.querySelector('.cal-scroll');
    if (s) s.scrollTop = top != null ? top : Math.max(0, (Math.min(new Date().getHours(), 8) - ui.startHour) * HOUR_PX);
  };
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  render();
  const t = setInterval(render, 60000);
  return { update: render, destroy: () => { clearInterval(t); closePopover(); el.style.display = ''; } };
}

function head(rerender) {
  const shift = (n) => { ui.anchor = ui.mode === 'week' ? addDays(ui.anchor, 7 * n) : new Date(ui.anchor.getFullYear(), ui.anchor.getMonth() + n, 1); rerender(); };
  const ws = startOfWeek(ui.anchor);
  const title = ui.mode === 'week'
    ? `${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${addDays(ws, 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : ui.anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const layer = (k, label) => h('button', { class: `btn sm ${ui.layers[k] ? 'on' : ''}`, onclick: () => { ui.layers[k] = !ui.layers[k]; rerender(); } }, label);
  return h('div', { class: 'cal-head' },
    h('div', { class: 'seg' }, h('button', { class: 'btn', onclick: () => shift(-1) }, '‹'), h('button', { class: 'btn', onclick: () => { ui.anchor = new Date(); rerender(); } }, 'Today'), h('button', { class: 'btn', onclick: () => shift(1) }, '›')),
    h('h1', null, title),
    h('div', { class: 'seg' }, h('button', { class: `btn ${ui.mode === 'week' ? 'on' : ''}`, onclick: () => { ui.mode = 'week'; rerender(); } }, 'Week'), h('button', { class: `btn ${ui.mode === 'month' ? 'on' : ''}`, onclick: () => { ui.mode = 'month'; rerender(); } }, 'Month')),
    h('div', { class: 'grow' }),
    h('div', { class: 'legend' }, layer('class', 'Classes'), layer('due', 'Deadlines'), layer('event', 'Events'), layer('reminder', 'Reminders')),
    h('span', { class: 'faint small' }, 'Click an empty slot to add a reminder'));
}

function view() {
  const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } });
  const rerender = () => { const p = wrap.parentElement; if (p) { const s = wrap.querySelector('.cal-scroll'); const top = s ? s.scrollTop : 0; wrap.replaceWith(view()); const n = p.querySelector('.cal-scroll'); if (n) n.scrollTop = top; } };
  wrap.append(head(rerender), ui.mode === 'week' ? week() : month(rerender));
  return wrap;
}

const visible = (it) => ui.layers[it.kind];
const color = (it) => (it.course ? it.course.color : it.kind === 'reminder' ? 'var(--warn)' : 'var(--faint)');

function week() {
  const ws = startOfWeek(ui.anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const items = buildItems(ws, addDays(ws, 7)).filter(visible);
  const timed = items.filter((i) => (i.kind === 'class' || i.kind === 'reminder' || (i.kind === 'event' && !i.allDay)));
  const top = items.filter((i) => !timed.includes(i));
  let startHour = 7, endHour = 22;
  for (const i of timed) { startHour = Math.min(startHour, i.start.getHours()); endHour = Math.max(endHour, Math.min(24, (i.end || i.start).getHours() + 1)); }
  ui.startHour = startHour;
  const hours = endHour - startHour;
  const now = new Date();

  const grid = h('div', { class: 'week' });
  grid.append(h('div', { class: 'dh', style: { borderLeft: 0 } }));
  for (const d of days) grid.append(h('div', { class: `dh ${sameDay(d, now) ? 'today' : ''}` }, h('b', null, d.getDate()), DAY_SHORT[d.getDay()]));
  grid.append(h('div', { class: 'gut' }, 'due'));
  for (const d of days) {
    const cell = h('div', { class: 'duerow' });
    for (const it of top.filter((i) => sameDay(i.start, d))) {
      cell.append(h('span', { class: `pill ${it.soft ? 'soft' : ''} ${['submitted', 'graded'].includes(it.status) ? 'done' : ''}`, style: { '--c': color(it) }, title: it.title, onclick: (e) => itemPopover(it, e.clientX, e.clientY) },
        it.allDay ? '' : `${fmtTime(it.start).replace(':00', '')} `, it.course ? `${it.course.code} · ` : '', it.title));
    }
    grid.append(cell);
  }

  const body = h('div', { class: 'week', style: { gridTemplateRows: `${hours * HOUR_PX}px` } });
  const gutter = h('div');
  for (let hr = startHour; hr < endHour; hr++) gutter.append(h('div', { class: 'hl' }, hr === startHour ? '' : fmtTime(new Date(2000, 0, 1, hr)).replace(':00', '')));
  body.append(gutter);
  days.forEach((d) => {
    const col = h('div', { class: `col ${sameDay(d, now) ? 'today' : ''}` });
    for (let hr = startHour; hr < endHour; hr++) col.append(h('div', { class: 'hour' }));
    col.addEventListener('click', (e) => {
      if (e.target !== col && !e.target.classList.contains('hour')) return;
      const y = e.clientY - col.getBoundingClientRect().top;
      const mins = Math.round((y / HOUR_PX) * 4) * 15 + startHour * 60;
      quickSlot(new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60), e.clientX, e.clientY);
    });
    const dayItems = timed.filter((i) => sameDay(i.start, d));
    // simple lane layout for overlaps
    const lanes = [];
    const placed = dayItems.map((it) => {
      const s = it.start.getTime();
      const e = (it.end || new Date(s + 30 * 60e3)).getTime();
      let lane = lanes.findIndex((end) => end <= s);
      if (lane < 0) { lane = lanes.length; lanes.push(e); } else lanes[lane] = e;
      return { it, s, e, lane };
    });
    for (const p of placed) {
      const it = p.it;
      const topPx = ((it.start.getHours() - startHour) * 60 + it.start.getMinutes()) * (HOUR_PX / 60);
      const height = Math.max(22, ((p.e - p.s) / 60e3) * (HOUR_PX / 60) - 2);
      const width = 100 / lanes.length;
      const ev = h('div', {
        class: `ev ${it.kind === 'reminder' ? 'rem' : ''} ${it.cancelled ? 'cancelled' : ''}`,
        style: { top: `${topPx}px`, height: `${height}px`, left: `calc(${p.lane * width}% + 2px)`, width: `calc(${width}% - 4px)`, right: 'auto', '--c': color(it) },
        onclick: (e) => { e.stopPropagation(); itemPopover(it, e.clientX, e.clientY); },
        title: `${it.title}${it.room ? ` · ${it.building || ''} ${it.room}` : ''}`,
      },
      h('b', null, it.kind === 'class' ? it.title : it.title),
      it.kind === 'class' ? h('div', null, [it.building, it.room].filter(Boolean).join(' ') || '') : null,
      height > 40 ? h('div', { class: 'faint' }, `${fmtTime(it.start)}${it.end ? `–${fmtTime(it.end)}` : ''}`) : null);
      col.append(ev);
    }
    if (sameDay(d, now) && now.getHours() >= startHour && now.getHours() < endHour) {
      col.append(h('div', { class: 'nowline', style: { top: `${((now.getHours() - startHour) * 60 + now.getMinutes()) * (HOUR_PX / 60)}px` } }));
    }
    body.append(col);
  });
  return h('div', { class: 'cal-scroll', style: { overflow: 'auto', flex: 1, minHeight: 0 } }, h('div', { style: { position: 'sticky', top: 0, zIndex: 5 } }, grid), body);
}

function month(rerender) {
  const first = new Date(ui.anchor.getFullYear(), ui.anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const end = addDays(start, 42);
  const items = buildItems(start, end).filter(visible);
  const now = new Date();
  const g = h('div', { class: 'month' });
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => g.append(h('div', { class: 'mh' }, d)));
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const its = items.filter((x) => sameDay(x.start, d));
    const cell = h('div', { class: `md ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${sameDay(d, now) ? 'today' : ''}` }, h('span', { class: 'dn' }, d.getDate()));
    const max = 5;
    its.slice(0, max).forEach((it) => cell.append(h('span', {
      class: `pill ${it.soft ? 'soft' : ''} ${it.cancelled || ['submitted', 'graded'].includes(it.status) || it.done ? 'done' : ''}`,
      style: { '--c': color(it) }, title: it.title, onclick: (e) => itemPopover(it, e.clientX, e.clientY),
    }, it.kind === 'class' ? `${fmtTime(it.start).replace(':00', '')} ${it.title}${it.room ? ` · ${it.room}` : ''}` : `${it.allDay || it.kind === 'due' ? '' : `${fmtTime(it.start).replace(':00', '')} `}${it.course && it.kind !== 'class' ? `${it.course.code} · ` : ''}${it.title}`)));
    if (its.length > max) cell.append(h('a', { class: 'small', onclick: () => { ui.mode = 'week'; ui.anchor = d; rerender(); } }, `+${its.length - max} more`));
    g.append(cell);
  }
  return h('div', { class: 'cal-scroll', style: { overflow: 'auto', flex: 1 } }, g);
}

function quickSlot(date, x, y) {
  closePopover();
  const input = h('input', { class: 'in', style: { width: '100%' }, placeholder: 'Reminder title… (Enter)' });
  const pop = h('div', { class: 'popover', style: { left: `${Math.min(x, innerWidth - 360)}px`, top: `${Math.min(y, innerHeight - 140)}px` } },
    h('div', { class: 'ph' }, h('b', null, `Reminder · ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(date)}`)),
    h('div', { class: 'pb' }, input));
  document.body.append(pop);
  input.focus();
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') pop.remove();
    if (e.key === 'Enter' && input.value.trim()) { await addReminder({ title: input.value.trim(), at: date, courseId: '' }); pop.remove(); }
  });
  const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
}
