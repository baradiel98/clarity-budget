import type { Forecast } from '@clarity/engine';
import { formatCents, formatShortDate, type ISODate } from '@clarity/shared';

/** Daily projected cash (intraday low) as an area chart, with today, low point and month-end markers. */
export function ForecastChart({ forecast, currency, low, monthEnd, reserve }: { forecast: Forecast; currency: string; low: { date: ISODate; cents: number }; monthEnd: ISODate; reserve: number }) {
  const W = 720;
  const H = 220;
  const pad = { l: 8, r: 8, t: 20, b: 26 };
  const days = forecast.days;
  if (days.length < 2) return null;
  const values = days.map((d) => d.lowCashCents);
  const min = Math.min(0, ...values, low.cents);
  const max = Math.max(...values, reserve, 1);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / (days.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  // Step line: a balance holds all day and changes when money moves.
  let line = `M${x(0).toFixed(1)},${y(values[0]!).toFixed(1)}`;
  for (let i = 1; i < values.length; i++) line += ` H${x(i).toFixed(1)} V${y(values[i]!).toFixed(1)}`;
  const area = `${line} L${x(days.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const lowIdx = days.findIndex((d) => d.date === low.date);
  const meIdx = days.findIndex((d) => d.date === monthEnd);
  const zeroY = y(0);
  const label = `Projected cash from ${formatShortDate(days[0]!.date)} to ${formatShortDate(days[days.length - 1]!.date)}. Lowest ${formatCents(low.cents, currency)} on ${formatShortDate(low.date)}.`;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id="fc-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" className="fc-stop-a" />
          <stop offset="100%" className="fc-stop-b" />
        </linearGradient>
      </defs>
      {min < 0 && <line x1={pad.l} x2={W - pad.r} y1={zeroY} y2={zeroY} className="fc-zero" vectorEffect="non-scaling-stroke" />}
      {reserve > 0 && <line x1={pad.l} x2={W - pad.r} y1={y(reserve)} y2={y(reserve)} className="fc-reserve" vectorEffect="non-scaling-stroke" />}
      <path d={area} fill="url(#fc-fill)" />
      <path d={line} className="fc-line" vectorEffect="non-scaling-stroke" />
      {meIdx > 0 && <line x1={x(meIdx)} x2={x(meIdx)} y1={pad.t - 8} y2={H - pad.b} className="fc-grid" vectorEffect="non-scaling-stroke" />}
      {lowIdx >= 0 && (
        <g>
          <circle cx={x(lowIdx)} cy={y(low.cents)} r="4.5" className={`fc-dot ${low.cents < 0 ? 'neg' : ''}`} vectorEffect="non-scaling-stroke" />
        </g>
      )}
      <text x={pad.l} y={H - 6}>Today</text>
      {meIdx > 0 && <text x={x(meIdx)} y={H - 6} textAnchor={meIdx === days.length - 1 ? 'end' : 'middle'}>{formatShortDate(monthEnd)}</text>}
      {meIdx !== days.length - 1 && <text x={W - pad.r} y={H - 6} textAnchor="end">{formatShortDate(days[days.length - 1]!.date)}</text>}
    </svg>
  );
}
