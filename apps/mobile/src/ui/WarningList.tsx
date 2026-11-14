import { AlertTriangle, CircleAlert, Info } from 'lucide-react-native';
import { View } from 'react-native';
import type { Warning } from '@clarity/engine';
import { formatShortDate } from '@clarity/shared';
import { Money } from './Money';
import { T } from './Text';
import { useTheme } from './theme';

const GROUPS: { severity: Warning['severity']; title: string }[] = [
  { severity: 'critical', title: 'Needs action' },
  { severity: 'warning', title: 'Check these' },
  { severity: 'info', title: 'For your information' },
];

/**
 * Every warning the engine returns (Phase 4A.4.2), grouped by severity, with every dated amount listed.
 * The same content and grouping as the web list (apps/web/src/ui/WarningList.tsx).
 */
export function WarningList({ warnings, currency }: { warnings: readonly Warning[]; currency: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      {GROUPS.map((g) => {
        const list = warnings.filter((w) => w.severity === g.severity);
        if (!list.length) return null;
        return (
          <View key={g.severity} testID={`warnings-${g.severity}`}>
            <T variant="caption" color="textTertiary" accessibilityRole="header">{`${g.title} (${list.length})`}</T>
            {list.map((w) => (
              <View key={w.id} testID="warning-item" style={{ flexDirection: 'row', gap: 10, paddingVertical: 8 }}>
                {w.severity === 'critical' ? <CircleAlert size={18} color={c.negative} /> : w.severity === 'warning' ? <AlertTriangle size={18} color={c.warning} /> : <Info size={18} color={c.textTertiary} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <T style={{ fontFamily: 'Inter_600SemiBold' }}>{w.title}</T>
                  <T variant="footnote" color="textSecondary">{w.detail}</T>
                  {w.items && w.items.length > 1 && w.items.map((x, i) => (
                    <View key={`${x.date}-${i}`} testID="warning-date" style={{ flexDirection: 'row', gap: 8 }}>
                      <T variant="footnote" color="textSecondary" style={{ width: 52 }}>{formatShortDate(x.date)}</T>
                      <T variant="footnote" color="textSecondary" style={{ flex: 1 }}>{x.label}</T>
                      <Money cents={x.cents} currency={currency} variant="footnote" color={x.cents < 0 ? 'negative' : 'textSecondary'} />
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
