import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { formatWeekdayDate, toISO, type ISODate } from '@clarity/shared';
import { T } from './Text';
import { radius, useTheme } from './theme';

/** Native date picker. Converts to/from ISO calendar dates without time-zone math. */
export function DateField({ value, onChange, minimum, label }: { value: ISODate; onChange: (d: ISODate) => void; minimum?: ISODate; label: string }) {
  const { c, scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const asDate = new Date(y, m - 1, d, 12);
  const min = minimum ? (() => { const [a, b, e] = minimum.split('-').map(Number) as [number, number, number]; return new Date(a, b - 1, e, 12); })() : undefined;
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${formatWeekdayDate(value)}`} onPress={() => setOpen(!open)} style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surface, paddingHorizontal: 14, justifyContent: 'center' }}>
        <T>{formatWeekdayDate(value)}</T>
      </Pressable>
      {open && (
        <DateTimePicker
          value={asDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          themeVariant={scheme}
          {...(min ? { minimumDate: min } : {})}
          onChange={(e, date) => {
            if (Platform.OS === 'android') setOpen(false);
            if (e.type === 'set' && date) onChange(toISO(date.getFullYear(), date.getMonth() + 1, date.getDate()));
          }}
        />
      )}
    </View>
  );
}
