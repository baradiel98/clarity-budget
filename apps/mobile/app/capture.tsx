import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addTransactions } from '@clarity/data';
import { CaptureView } from '../src/features/Capture';
import { useData, useRun, useSession, useStore } from '../src/state/session';
import { LinkButton } from '../src/ui/Button';
import { T } from '../src/ui/Text';
import { useTheme } from '../src/ui/theme';
import { useToast } from '../src/ui/Toast';

/** Clarity Capture: describe what you spent; review; approve. */
export default function CaptureScreen() {
  const data = useData();
  const { today } = useSession();
  const { store, demo } = useStore();
  const run = useRun();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <LinkButton title="Close" color="textSecondary" onPress={() => router.back()} />
        <T variant="headline" accessibilityRole="header">Clarity Capture</T>
        <View style={{ width: 52 }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 14 }}>
        <T color="textSecondary">Tell Clarity what you spent. We’ll organize it for you.</T>
        {demo && <T variant="footnote" color="textTertiary">Sample data: approving is turned off in demo mode.</T>}
        <CaptureView
          data={data}
          today={today}
          disabled={demo}
          onAddManually={() => router.push('/add')}
          approve={async (inputs) => {
            const r = await run((ctx) => addTransactions(ctx, inputs), { undoLabel: `Captured ${inputs.length}` });
            if (!r.ok) return r.errors.map((e) => e.message).join(' ');
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            toast({ message: inputs.length === 1 ? 'Saved 1 transaction' : `Saved ${inputs.length} transactions`, action: { label: 'Undo', run: () => void store.undo() } });
            return null;
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
