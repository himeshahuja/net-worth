import { daysBetween } from '../lib/networth.js';
import { measure, placeNotes, ticks, timeTicks } from './scale.js';
import { useWidth } from './useWidth.js';
import { useState } from 'react';

const ROW = 14;

// One series over time: a 2px line of straight segments in the one chart hue, on a real time axis (a missing
// day leaves a longer segment, not a squeezed one), 4–5 quiet gridlines and notes in rows above the plot.
//   points: [{ date: 'YYYY-MM-DD', value }]   notes: [{ date, label, short }]
//   tickFormat: the axis   describe: for screen readers
export default function LineChart({ points, notes = [], height = 240, tickFormat, describe }) {
  const [ref, width] = useWidth();
  const [selected, setSelected] = useState(null);

  let chart = null;
  if (width) {
    const values = points.map((p) => p.value);
    let lo = Math.min(...values), hi = Math.max(...values);
    // A nearly flat line still gets a readable range: at least $100, or 2% of the figure.
    const least = Math.max(100, Math.abs(hi) * 0.02);
    if (hi - lo < least) { const mid = (hi + lo) / 2; lo = mid - least / 2; hi = mid + least / 2; }
    const yt = ticks(lo, hi, 4);

    const first = points[0].date, last = points.at(-1).date, span = Math.max(1, daysBetween(first, last));
    const padL = 12 + Math.max(...yt.map((v) => measure(tickFormat(v), 12))), padB = 26, padR = 4;
    const x = (date) => padL + (daysBetween(first, date) / span) * (width - padL - padR);
    const lane = placeNotes(notes.map((n) => ({ ...n, x: x(n.date) })), width);
    const padT = lane.rows ? 8 + lane.rows * ROW + 4 : 8;
    const y = (v) => padT + (height - padT - padB) * (1 - (v - yt[0]) / (yt.at(-1) - yt[0]));
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');
    const active = selected == null ? null : points[selected];
    const activeX = active && x(active.date);
    const activeY = active && y(active.value);

    // x labels: the first pulled inside the plot, none past the right edge
    const xt = timeTicks(first, last, width - padL).map((t) => {
      const tw = measure(t.label, 12);
      return { ...t, left: Math.max(padL, Math.min(width - tw, x(t.date) - tw / 2)) };
    });

    chart = (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={describe}>
        <g className="chart-grid">
          {yt.map((v) => <line key={v} className={v === 0 ? 'zero' : undefined} x1={padL} x2={width} y1={y(v)} y2={y(v)} />)}
        </g>
        <g className="chart-axis">
          {yt.map((v) => <text key={v} x={padL - 8} y={y(v) + 4} textAnchor="end">{tickFormat(v)}</text>)}
          {xt.map((t) => <text key={t.date} x={t.left} y={height - padB + 18}>{t.label}</text>)}
        </g>
        <g className="chart-note">
          {notes.map((n) => <line key={n.date} x1={x(n.date)} x2={x(n.date)} y1={padT} y2={height - padB} />)}
          {lane.placed.map((p) => {
            const base = padT - 9 - p.row * ROW;
            return (
              <g key={p.date}>
                <line x1={p.x} x2={p.x} y1={base - 8} y2={padT} />
                <text x={p.x0} y={base}>{p.text}</text>
              </g>
            );
          })}
        </g>
        <path className="chart-line" d={path} />
        <g className="chart-points">
          {points.map((p, i) => (
            <circle
              key={p.date}
              cx={x(p.date)}
              cy={y(p.value)}
              r={selected === i ? 5 : 10}
              className={selected === i ? 'chart-point active' : 'chart-point-hit'}
              tabIndex="0"
              role="button"
              aria-label={`${p.date}: ${tickFormat(p.value)}`}
              onMouseEnter={() => setSelected(i)}
              onFocus={() => setSelected(i)}
              onMouseLeave={() => setSelected(null)}
              onBlur={() => setSelected(null)}
            />
          ))}
          {active && (
            <g className="chart-tooltip" pointerEvents="none">
              <line x1={activeX} x2={activeX} y1={padT} y2={height - padB} />
              <rect x={Math.max(padL, Math.min(width - 132, activeX - 66))} y={Math.max(2, activeY - 38)} width="132" height="32" rx="4" />
              <text x={Math.max(padL + 8, Math.min(width - 124, activeX - 58))} y={Math.max(15, activeY - 18)}>{active.date} · {tickFormat(active.value)}</text>
            </g>
          )}
        </g>
      </svg>
    );
  }

  return <div className="chart" ref={ref} style={{ height }}>{chart}</div>;
}
