import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import type { Forecast } from '@clarity/engine';
import { formatCents, formatShortDate, type ISODate } from '@clarity/shared';
import { useTheme } from './theme';

/** Step chart of projected cash (daily low), with zero / reserve lines and the low point. */
export function ForecastChart({ forecast, currency, low, reserve, width }: { forecast: Forecast; currency: string; low: { date: ISODate; cents: number }; reserve: number; width: number }) {
  const { c } = useTheme();
  const H = 140;
  const days = forecast.days;
  if (days.length < 2 || width <= 0) return null;
  const values = days.map((d) => d.lowCashCents);
  const min = Math.min(0, ...values, low.cents);
  const max = Math.max(...values, reserve, 1);
  const span = max - min || 1;
  const x = (i: number) => 4 + (i / (days.length - 1)) * (width - 8);
  const y = (v: number) => 8 + (1 - (v - min) / span) * (H - 16);
  let line = `M${x(0)},${y(values[0]!)}`;
  for (let i = 1; i < values.length; i++) line += ` H${x(i)} V${y(values[i]!)}`;
  const area = `${line} L${x(days.length - 1)},${y(min)} L${x(0)},${y(min)} Z`;
  const li = days.findIndex((d) => d.date === low.date);
  return (
    <Svg width={width} height={H} accessibilityLabel={`Projected cash through ${formatShortDate(days[days.length - 1]!.date)}. Lowest ${formatCents(low.cents, currency)} on ${formatShortDate(low.date)}.`}>
      <Defs>
        <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.chartLine} stopOpacity={0.18} />
          <Stop offset="1" stopColor={c.chartLine} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {min < 0 && <Line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={c.negative} strokeDasharray="3 4" strokeWidth={1} />}
      {reserve > 0 && <Line x1={0} x2={width} y1={y(reserve)} y2={y(reserve)} stroke={c.warning} strokeDasharray="2 5" strokeWidth={1} opacity={0.7} />}
      <Path d={area} fill="url(#fill)" />
      <Path d={line} stroke={c.chartLine} strokeWidth={2} fill="none" strokeLinejoin="round" />
      {li >= 0 && <Circle cx={x(li)} cy={y(low.cents)} r={4.5} fill={c.surface} stroke={low.cents < 0 ? c.negative : c.chartLine} strokeWidth={2} />}
    </Svg>
  );
}
