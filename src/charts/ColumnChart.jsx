import { measure, ticks } from './scale.js';
import { useWidth } from './useWidth.js';

// Signed columns, one per period, on one scale around a heavier zero line: square corners, 3-5 quiet gridlines and
// round ticks on the left. A partial period (the month so far) is drawn in grey.
//   bars: [{ key, label, value, partial }]   tickFormat: axis   describe: for screen readers
export default function ColumnChart({ bars, height = 180, tickFormat, describe }) {
  const [ref, width] = useWidth();

  let chart = null;
  if (width) {
    const values = bars.map((b) => b.value);
    const yt = ticks(Math.min(0, ...values), Math.max(1, ...values), 4);
    const padL = 12 + Math.max(...yt.map((v) => measure(tickFormat(v), 12))), padB = 26, padT = 8;
    const step = (width - padL) / bars.length, bw = Math.min(40, step * 0.62);
    const y = (v) => padT + (height - padT - padB) * (1 - (v - yt[0]) / (yt.at(-1) - yt[0]));
    // Every other label when the columns are narrow, so labels never touch.
    const every = Math.ceil(bars.length / Math.max(2, Math.floor((width - padL) / 44)));

    chart = (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={describe}>
        <g className="chart-grid">
          {yt.map((v) => <line key={v} className={v === 0 ? 'zero' : undefined} x1={padL} x2={width} y1={y(v)} y2={y(v)} />)}
        </g>
        <g className="chart-axis">
          {yt.map((v) => <text key={v} x={padL - 8} y={y(v) + 4} textAnchor="end">{tickFormat(v)}</text>)}
          {bars.map((b, i) => (i % every === (bars.length - 1) % every ? <text key={b.key} x={padL + step * i + step / 2} y={height - padB + 18} textAnchor="middle">{b.label}</text> : null))}
        </g>
        {bars.map((b, i) => {
          const top = y(Math.max(0, b.value)), bottom = y(Math.min(0, b.value));
          return <rect key={b.key} className={b.partial ? 'chart-col partial' : 'chart-col'} x={padL + step * i + (step - bw) / 2} y={top} width={bw} height={Math.max(1, bottom - top)} />;
        })}
      </svg>
    );
  }

  return <div className="chart" ref={ref} style={{ height }}>{chart}</div>;
}
