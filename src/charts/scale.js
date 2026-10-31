// Axis arithmetic, ported from the taste skill's charts.js so the React chart keeps its rules: round ticks
// that top out above the largest value, labels on one step that never run past either edge, and notes
// laid out in rows above the plot where no leader line crosses another label.
import { addDays, daysBetween } from '../lib/networth.js';
import { shortDate, shortMonth } from '../lib/format.js';

// Steps of 1, 2, 2.5 or 5 × 10^n, the top tick above the maximum.
export function ticks(min, max, count = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= max) hi += step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

// Text widths in the page's own face; charts re-render once the fonts have loaded.
let ctx;
export function measure(text, size = 12, weight = 400) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`;
  return ctx.measureText(text).width;
}

// A time axis: weekly or fortnightly over a short span, otherwise the first of every month, or of every
// second, third, sixth or twelfth month, whichever keeps the labels apart. January carries its year.
export function timeTicks(start, end, width) {
  const cap = Math.max(2, Math.min(8, Math.floor(width / 76)));
  if (daysBetween(start, end) <= 62) {
    for (const step of [7, 14, 28]) {
      const out = [];
      for (let d = start; d <= end; d = addDays(d, step)) out.push({ date: d, label: shortDate(d) });
      if (out.length <= cap) return out;
    }
  }
  for (const step of [1, 2, 3, 6, 12]) {
    const out = [];
    for (let y = +start.slice(0, 4), m = +start.slice(5, 7); ; m++) {
      if (m > 12) { m = 1; y++; }
      const d = `${y}-${String(m).padStart(2, '0')}-01`;
      if (d > end) break;
      if (d >= start && (m - 1) % step === 0) out.push({ date: d, label: m === 1 ? `${shortMonth(d)} ${y}` : shortMonth(d) });
    }
    if (out.length <= cap) return out;
  }
  return [];
}

// Notes sit beside the top of their own leader line, right of it or left of it, in up to three rows. A place is
// free when no label in that row overlaps it, no leader runs through it, and its own leader runs through no label
// below. Full labels first, then short ones; a note that still cannot fit is dropped to its marker's tooltip.
export function placeNotes(items, width, maxRows = 3) {
  const gap = 6;
  const opts = items.map((it) => {
    const out = [];
    for (const text of [it.label, it.short].filter(Boolean)) {
      const tw = measure(text, 11);
      for (let row = 0; row < maxRows; row++) {
        for (const [x0, x1] of [[it.x + 4, it.x + 4 + tw], [it.x - 4 - tw, it.x - 4]]) {
          if (x0 >= 0 && x1 <= width) out.push({ ...it, text, isShort: text !== it.label, row, x0, x1 });
        }
      }
    }
    return out;
  });
  const free = (c, placed) => placed.every((p) => p.dropped || (
    !(p.row === c.row && c.x0 < p.x1 + gap && c.x1 > p.x0 - gap)
    && !(p.row >= c.row && p.x > c.x0 - 3 && p.x < c.x1 + 3)
    && !(p.row <= c.row && c.x > p.x0 - 3 && c.x < p.x1 + 3)));
  let best = null, steps = 0;
  const solve = (i, placed, allowShort, allowDrop) => {
    if (++steps > 20000) return false;
    if (i === items.length) { best = placed.slice(); return true; }
    for (const c of opts[i]) {
      if ((c.isShort && !allowShort) || !free(c, placed)) continue;
      placed.push(c);
      if (solve(i + 1, placed, allowShort, allowDrop)) return true;
      placed.pop();
    }
    if (allowDrop) {
      placed.push({ ...items[i], dropped: true });
      if (solve(i + 1, placed, allowShort, allowDrop)) return true;
      placed.pop();
    }
    return false;
  };
  for (const [short, drop] of [[false, false], [true, false], [true, true]]) {
    steps = 0;
    if (solve(0, [], short, drop)) break;
  }
  const placed = (best || []).filter((p) => !p.dropped);
  return { placed, rows: placed.length ? Math.max(...placed.map((p) => p.row)) + 1 : 0 };
}
