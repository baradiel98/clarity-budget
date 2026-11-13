import { useState } from 'react';
import { Alert, View } from 'react-native';
import { createCategory, updateCategory } from '@clarity/data';
import { useData, useRun } from '../../src/state/session';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Field, Input } from '../../src/ui/Field';
import { CategoryIcon } from '../../src/ui/icons';
import { IconBubble, ListRow } from '../../src/ui/ListRow';
import { Segmented } from '../../src/ui/Segmented';
import { SubScreen } from '../../src/ui/SubScreen';
import { T } from '../../src/ui/Text';
import { useTheme } from '../../src/ui/theme';

export default function Categories() {
  const data = useData();
  const run = useRun();
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [error, setError] = useState<string | null>(null);
  return (
    <SubScreen title="Categories">
      <Card title="Add category">
        <View style={{ gap: 12 }}>
          <Field label="Name" error={error}><Input value={name} onChangeText={setName} /></Field>
          <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }]} />
          <Button title="Add" small onPress={async () => { const r = await run((ctx) => createCategory(ctx, { name, kind })); if (!r.ok) setError(r.errors[0]?.message ?? ''); else { setName(''); setError(null); } }} />
        </View>
      </Card>
      <Card>
        {data.categories.map((x, i) => (
          <ListRow key={x.id} last={i === data.categories.length - 1} icon={<IconBubble><CategoryIcon name={x.icon} color={c.textSecondary} /></IconBubble>} title={x.name} subtitle={`${x.group}${x.archived ? ' · archived' : ''}`}
            onPress={() => Alert.alert(x.name, undefined, [{ text: x.archived ? 'Restore' : 'Archive', onPress: () => void run((ctx) => updateCategory(ctx, x.id, { archived: !x.archived })) }, { text: 'Cancel', style: 'cancel' }])} />
        ))}
      </Card>
      <T variant="footnote" color="textSecondary">Archived categories stay on past transactions but are hidden when adding new ones.</T>
    </SubScreen>
  );
}
