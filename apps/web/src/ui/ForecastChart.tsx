import { useEffect, useMemo, useRef, useState } from 'react';
import type { Forecast, ForecastEvent } from '@clarity/engine';
import { formatCents, formatShortDate, formatWeekdayDate, type Cents, type ISODate } from '@clarity/shared';

interface Point {
  date: ISODate;
  kind: 'recorded' | 'projected';
  /** Balance at the end of the day. */
  end: Cents;
  /** Lowest balance during the day (bills are applied before income). */
  low: Cents;
  events: ForecastEvent[];
}

interface Props {
  /** Recorded available cash for days before today (may be empty). */
  history: readonly { date: ISODate; cents: Cents }[];
  forecast: Forecast;
  currency: string;
  reserve: Cents;
  monthEnd: ISODate;
}

function niceStep(span: number): number {
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/**
 * Cash over time. Solid line = balances you recorded; dashed line = projection from the engine.
 * Every value comes from the engine's forecast days; nothing is computed here except positions.
 */
export function ForecastChart({ history, forecast, currency, reserve, monthEnd }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const points = useMemo<Point[]>(
    () => [
      ...history.map((h) => ({ date: h.date, kind: 'recorded' as const, end: h.cents, low: h.cents, events: [] })),
      ...forecast.days.map((d) => ({ date: d.date, kind: 'projected' as const, end: d.endCashCents, low: d.lowCashCents, events: d.events.filter((e) => e.cashDeltaCents !== 0) })),
    ],
    [history, forecast],
  );

  const H = 248;
  const pad = { t: 14, b: 40, l: 4, r: 4 };
  const n = points.length;
  const todayIdx = history.length;
  const fmt = (c: Cents) => formatCents(c, currency);

  const geo = useMemo(() => {
    if (n < 2 || width <= 0) return null;
    const lows = points.map((p) => p.low);
    const highs = points.map((p) => p.end);
    const min = Math.min(0, ...lows);
    const max = Math.max(...highs, ...lows, reserve, 100);
    const step = niceStep(max - min);
    const top = Math.ceil(max / step) * step;
    const bottom = Math.floor(min / step) * step;
    const x = (i: number) => pad.l + (i / (n - 1)) * (width - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - bottom) / (top - bottom || 1)) * (H - pad.t - pad.b);
    let rec = '';
    for (let i = 0; i < todayIdx; i++) rec += `${i === 0 ? 'M' : 'V'}${i === 0 ? `${x(0)},` : ''}${y(points[i]!.end)} H${x(i + 1)} `;
    let proj = `M${x(todayIdx)},${y(forecast.startCashCents)} `;
    for (let i = todayIdx; i < n; i++) {
      const p = points[i]!;
      proj += `V${y(p.low)} V${y(p.end)} `;
      if (i < n - 1) proj += `H${x(i + 1)} `;
    }
    const area = `${proj}V${y(bottom)} H${x(todayIdx)} Z`;
    const ticks: number[] = [];
    for (let v = bottom; v <= top; v += step) ticks.push(v);
    let lowIdx = todayIdx;
    for (let i = todayIdx; i < n; i++) if (points[i]!.low < points[lowIdx]!.low) lowIdx = i;
    return { x, y, rec, proj, area, ticks, lowIdx, bottom };
  }, [points, n, width, reserve, todayIdx, forecast.startCashCents]);

  const last = points[n - 1];
  const lowP = geo ? points[geo.lowIdx]! : null;
  const summary = last && lowP ? `Cash from ${formatShortDate(points[0]!.date)} to ${formatShortDate(last.date)}. Projected ${fmt(last.end)} on ${formatShortDate(last.date)}. Lowest ${fmt(lowP.low)} on ${formatShortDate(lowP.date)}.` : 'Not enough data for a chart yet.';

  const pick = (clientX: number) => {
    if (!geo || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const f = (clientX - r.left - pad.l) / (width - pad.l - pad.r);
    setCursor(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  };

  const cur = cursor !== null ? points[cursor] : null;
  const meIdx = points.findIndex((p) => p.date === monthEnd);

  return (
    <div className="chart-box" ref={box}>
      {geo && (
        <svg
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          aria-label={summary}
          tabIndex={0}
          data-testid="forecast-chart"
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setCursor(null)}
          onBlur={() => setCursor(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              const base = cursor ?? todayIdx;
              setCursor(Math.max(0, Math.min(n - 1, base + (e.key === 'ArrowRight' ? 1 : -1))));
            } else if (e.key === 'Escape') setCursor(null);
          }}
        >
          <defs>
            <linearGradient id="fc-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className="fc-stop-a" />
              <stop offset="100%" className="fc-stop-b" />
            </linearGradient>
          </defs>
          {geo.ticks.map((v) => (
            <g key={v}>
              <line x1={0} x2={width} y1={geo.y(v)} y2={geo.y(v)} className={v === 0 && geo.bottom < 0 ? 'fc-zero' : 'fc-grid'} />
              <text x={2} y={geo.y(v) - 5}>{formatCents(v, currency, { compact: true })}</text>
            </g>
          ))}
          {reserve > 0 && <line x1={0} x2={width} y1={geo.y(reserve)} y2={geo.y(reserve)} className="fc-reserve" />}
          <path d={geo.area} className="fc-area" />
          {geo.rec && <path d={geo.rec} className="fc-line recorded" />}
          <path d={geo.proj} className="fc-line projected" />
          <line x1={geo.x(todayIdx)} x2={geo.x(todayIdx)} y1={pad.t} y2={H - pad.b} className="fc-today" />
          {meIdx > todayIdx && meIdx < n - 1 && <line x1={geo.x(meIdx)} x2={geo.x(meIdx)} y1={pad.t} y2={H - pad.b} className="fc-grid" />}
          {/* income / bill markers under the axis */}
          {points.map((p, i) => {
            if (i < todayIdx || p.events.length === 0) return null;
            const hasIn = p.events.some((e) => e.cashDeltaCents > 0);
            const hasOut = p.events.some((e) => e.cashDeltaCents < 0);
            return (
              <g key={p.date}>
                {hasIn && <rect x={geo.x(i) - 3} y={H - pad.b + 5} width={6} height={6} rx={1.5} className="fc-tick-in" />}
                {hasOut && <rect x={geo.x(i) - 3} y={H - pad.b + (hasIn ? 13 : 5)} width={6} height={6} rx={1.5} className="fc-tick-out" />}
              </g>
            );
          })}
          {lowP && (
            <g>
              <circle cx={geo.x(geo.lowIdx)} cy={geo.y(lowP.low)} r={4.5} className={`fc-dot ${lowP.low < 0 ? 'neg' : ''}`} />
              <text
                x={geo.x(geo.lowIdx) + (geo.x(geo.lowIdx) > width - 150 ? -8 : 8)}
                y={Math.min(geo.y(lowP.low) + 16, H - pad.b - 4)}
                textAnchor={geo.x(geo.lowIdx) > width - 150 ? 'end' : 'start'}
              >
                Lowest {fmt(lowP.low)}
              </text>
            </g>
          )}
          {cur && cursor !== null && (
            <g>
              <line x1={geo.x(cursor)} x2={geo.x(cursor)} y1={pad.t} y2={H - pad.b} className="fc-cursor" />
              <circle cx={geo.x(cursor)} cy={geo.y(cur.end)} r={4.5} className="fc-dot cursor" />
            </g>
          )}
          {todayIdx > 3 && geo.x(todayIdx) > 90 && <text x={pad.l} y={H - 4}>{formatShortDate(points[0]!.date)}</text>}
          <text x={geo.x(todayIdx)} y={H - 4} textAnchor={geo.x(todayIdx) < 30 ? 'start' : 'middle'}>Today</text>
          {meIdx > todayIdx && meIdx < n - 1 && geo.x(n - 1) - geo.x(meIdx) > 70 && geo.x(meIdx) - geo.x(todayIdx) > 60 && <text x={geo.x(meIdx)} y={H - 4} textAnchor="middle">{formatShortDate(monthEnd)}</text>}
          <text x={width - pad.r} y={H - 4} textAnchor="end">{formatShortDate(last!.date)}</text>
        </svg>
      )}
      {geo && cur && cursor !== null && (
        <div className="chart-tip" style={{ left: Math.max(0, Math.min(width - 230, geo.x(cursor) - 105)) }} data-testid="chart-tip">
          <div className="d">{formatWeekdayDate(cur.date)}{cursor === todayIdx ? ' · Today' : ''}</div>
          <div className="b num">{fmt(cur.end)}</div>
          <div className="e"><span>{cur.kind === 'recorded' ? 'Recorded balance' : 'Projected end of day'}</span></div>
          {cur.low !== cur.end && <div className="e"><span>Lowest that day</span><span className="num">{fmt(cur.low)}</span></div>}
          {cur.events.slice(0, 5).map((e) => (
            <div key={e.id} className="e">
              <span>{e.label}{e.estimated ? ' (estimated)' : ''}{e.source === 'overdue' ? ' (overdue)' : ''}</span>
              <span className={`num ${e.cashDeltaCents > 0 ? 'pos' : ''}`}>{formatCents(e.cashDeltaCents, currency, { sign: 'always' })}</span>
            </div>
          ))}
          {cur.events.length > 5 && <div className="e"><span>{cur.events.length - 5} more</span></div>}
        </div>
      )}
      <div className="sr-only" aria-live="polite">{cur ? `${formatWeekdayDate(cur.date)}: ${fmt(cur.end)}${cur.events.length ? `, ${cur.events.map((e) => `${e.label} ${formatCents(e.cashDeltaCents, currency, { sign: 'always' })}`).join(', ')}` : ''}` : ''}</div>
      <div className="legend" aria-hidden>
        {history.length > 0 && <span><i className="rec" /> Recorded</span>}
        <span><i className="proj" /> Projected</span>
        <span><i className="in" /> Income</span>
        <span><i className="out" /> Bills and transfers out</span>
        {reserve > 0 && <span><i className="proj" style={{ borderColor: 'var(--c-warning)' }} /> Reserve</span>}
      </div>
    </div>
  );
}
