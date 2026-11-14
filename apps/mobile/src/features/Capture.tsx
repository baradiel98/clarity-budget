import { AlertTriangle, Check, Info, ShieldCheck, Trash2 } from 'lucide-react-native';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { captureTotals, localInterpreter, parseDrafts, reviewDraft, toTxInput, type CaptureContext, type CaptureDraft, type DraftKind, type Issue } from '@clarity/capture';
import type { TxInput } from '@clarity/data';
import { centsToDecimalString, formatCents, parseAmountInput, type WorkspaceData } from '@clarity/shared';
import { captureStore } from '../state/capture';
import { Button } from '../ui/Button';
import { DateField } from '../ui/DateField';
import { Field, Input } from '../ui/Field';
import { T } from '../ui/Text';
import { FONT, radius, useTheme } from '../ui/theme';

/**
 * Clarity Capture on mobile. Same shared interpreter, validation and review rules as the web app
 * (packages/capture). Reading happens on the device; nothing is saved until approved.
 */
const MAX_CHARS = 4000;
const EXAMPLES = [
  'Yesterday I spent $45 at Walmart on groceries, $18 at Starbucks for coffee, and today I paid $65 for gas at Shell.',
  'Received my paycheck of $1,850 today.',
  'Paid $300 toward my credit card today.',
];
const KIND_LABEL: Record<DraftKind, string> = { expense: 'Expense', income: 'Income', refund: 'Refund', transfer: 'Transfer' };
const SOURCE: Record<string, string> = { words: 'from your words', memory: 'used before', rule: 'suggested', default: 'your default', carried: 'from earlier', later: 'from later', none: 'not mentioned', description: 'your words' };

export function captureContext(data: WorkspaceData, today: string): CaptureContext {
  return { today, currency: data.settings.baseCurrency, categories: data.categories, accounts: data.accounts, defaultAccountId: data.settings.defaultAccountId, transactions: data.transactions };
}

function Pill({ label, on, onPress, testID }: { label: string; on?: boolean; onPress: () => void; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }} onPress={onPress}
      style={{ paddingHorizontal: 12, minHeight: 36, borderRadius: 10, justifyContent: 'center', backgroundColor: on ? c.accentSoft : c.surface, borderWidth: 1, borderColor: on ? c.accent : c.border }}>
      <T variant="footnote" color={on ? 'accent' : 'text'} style={{ fontFamily: FONT.medium }} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

/** Horizontal row of choices (accessible as a group). */
function Choices<V extends string>({ label, value, options, onChange }: { label: string; value: V | null; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <View accessibilityLabel={label} style={{ gap: 6 }}>
      <T variant="footnote" color="textSecondary" style={{ fontFamily: FONT.semibold }}>{label}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
        {options.map((o) => <Pill key={o.value} label={o.label} on={o.value === value} onPress={() => onChange(o.value)} />)}
      </ScrollView>
    </View>
  );
}

export interface CaptureViewProps {
  data: WorkspaceData;
  today: string;
  /** Saves the inputs atomically. Returns an error message, or null on success. */
  approve: (inputs: TxInput[]) => Promise<string | null>;
  onAddManually: () => void;
  disabled?: boolean;
}

export function CaptureView({ data, today, approve, onAddManually, disabled }: CaptureViewProps) {
  const { c } = useTheme();
  const st = useSyncExternalStore(captureStore.subscribe, captureStore.get);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const ctx = useMemo(() => captureContext(data, today), [data, today]);
  const cur = data.settings.baseCurrency;
  const reviews = useMemo(() => new Map(st.drafts.map((d) => [d.id, reviewDraft(d, ctx)])), [st.drafts, ctx]);
  const ready = st.drafts.filter((d) => !reviews.get(d.id)!.some((i) => i.blocking));
  const totals = captureTotals(st.drafts);

  const read = async () => {
    const text = st.text.trim();
    if (!text) return;
    if (text.length > MAX_CHARS) { captureStore.set({ error: `That is more than ${MAX_CHARS.toLocaleString()} characters. Split it into smaller messages.` }); return; }
    setReading(true);
    try {
      const raw = await localInterpreter.interpret(text, ctx);
      const parsed = parseDrafts(raw, ctx);
      if (!parsed.ok) { captureStore.set({ error: parsed.error }); return; }
      const notUnderstood = (raw as { notUnderstood?: string[] }).notUnderstood ?? [];
      const stamp = Date.now().toString(36);
      const drafts = parsed.drafts.map((d, i) => ({ ...d, id: `${stamp}-${i}` }));
      captureStore.set((s) => ({ drafts: [...s.drafts, ...drafts], notUnderstood, error: drafts.length === 0 && notUnderstood.length === 0 ? 'Clarity couldn’t find any amounts in that. Include the amount, like “$12 at Target”.' : null, text: drafts.length ? '' : s.text }));
    } catch {
      captureStore.set({ error: 'Something went wrong while reading that. Your text is still here: try again, or add it manually.' });
    } finally {
      setReading(false);
    }
  };

  const update = (id: string, patch: Partial<CaptureDraft>) => captureStore.set((s) => ({ drafts: s.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
  const doApprove = async (ids: string[]) => {
    const inputs = st.drafts.filter((d) => ids.includes(d.id)).map((d) => toTxInput(d, ctx));
    if (!inputs.length || inputs.some((x) => !x)) return;
    setSaving(true);
    const err = await approve(inputs as TxInput[]);
    setSaving(false);
    if (err) { captureStore.set({ error: `Nothing was saved: ${err} Your drafts are still here.` }); return; }
    captureStore.set((s) => ({ drafts: s.drafts.filter((d) => !ids.includes(d.id)), error: null, saved: s.saved + inputs.length }));
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.accentSoft, padding: 14, gap: 10 }}>
        <Input testID="capture-text" accessibilityLabel="Describe what you spent, earned or paid" value={st.text} onChangeText={(t) => captureStore.set({ text: t, error: null })}
          placeholder="Tell me what you spent, earned, or paid today…" multiline style={{ minHeight: 96, paddingTop: 12, textAlignVertical: 'top', borderWidth: 0, paddingHorizontal: 0 }} />
        {!st.text && st.drafts.length === 0 && (
          <View style={{ gap: 8 }}>
            {EXAMPLES.map((x) => (
              <Pressable key={x} accessibilityRole="button" accessibilityLabel={`Example: ${x}`} onPress={() => captureStore.set({ text: x })} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 10 }}>
                <T variant="footnote" color="textSecondary">{x}</T>
              </Pressable>
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={14} color={c.positive} />
          <T variant="caption" color="textTertiary" style={{ flex: 1 }}>Read on this device. Nothing is sent anywhere.</T>
        </View>
        <Button testID="capture-read" title={reading ? 'Reading…' : 'Prepare'} busy={reading} onPress={() => void read()} />
      </View>

      {st.error && (
        <View accessibilityRole="alert" style={{ backgroundColor: c.negativeSoft, borderRadius: 12, padding: 12, gap: 8 }}>
          <T color="negative">{st.error}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small kind="secondary" title="Try again" onPress={() => void read()} />
            <Button small kind="ghost" title="Add manually" onPress={onAddManually} />
          </View>
        </View>
      )}
      {st.notUnderstood.length > 0 && (
        <T variant="footnote" color="textSecondary" testID="not-understood">No amount found in {st.notUnderstood.map((x) => `“${x}”`).join(', ')}. Add the amount and prepare again, or add it manually.</T>
      )}

      {st.drafts.length > 0 && (
        <View style={{ gap: 12 }}>
          <View testID="capture-summary" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <T style={{ fontFamily: FONT.semibold }}>{st.drafts.length} draft{st.drafts.length === 1 ? '' : 's'}</T>
            {totals.out > 0 && <T color="textSecondary">{formatCents(totals.out, cur)} out</T>}
            {totals.in > 0 && <T color="positive">{formatCents(totals.in, cur)} in</T>}
            {totals.moved > 0 && <T color="textSecondary">{formatCents(totals.moved, cur)} moved</T>}
          </View>
          <T variant="caption" color="textTertiary">Drafts don’t change your balances, budget or Safe to Spend until you approve them.</T>
          {st.drafts.map((d) => (
            <DraftCard key={d.id} d={d} issues={reviews.get(d.id)!} data={data} today={today} cur={cur} busy={saving || !!disabled}
              onChange={(p) => update(d.id, p)} onRemove={() => captureStore.set((s) => ({ drafts: s.drafts.filter((x) => x.id !== d.id) }))} onApprove={() => void doApprove([d.id])} />
          ))}
          <Button testID="approve-all" title={ready.length === st.drafts.length ? `Approve all ${ready.length}` : `Approve ${ready.length} ready`} disabled={ready.length === 0 || saving || disabled} busy={saving} onPress={() => void doApprove(ready.map((d) => d.id))} />
          <Button kind="ghost" title="Discard all" onPress={() => captureStore.set({ drafts: [], notUnderstood: [], error: null })} />
        </View>
      )}
      {st.saved > 0 && st.drafts.length === 0 && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: c.positiveSoft, borderRadius: 12, padding: 12 }}>
          <Check size={16} color={c.positive} />
          <T color="positive" testID="capture-saved">Saved {st.saved} transaction{st.saved === 1 ? '' : 's'} from Capture.</T>
        </View>
      )}
    </View>
  );
}

function DraftCard({ d, issues, data, today, cur, busy, onChange, onRemove, onApprove }: {
  d: CaptureDraft; issues: Issue[]; data: WorkspaceData; today: string; cur: string; busy: boolean;
  onChange: (p: Partial<CaptureDraft>) => void; onRemove: () => void; onApprove: () => void;
}) {
  const { c } = useTheme();
  const [amountText, setAmountText] = useState(d.amountCents === null ? '' : centsToDecimalString(d.amountCents));
  const blocking = issues.filter((i) => i.blocking);
  const notes = issues.filter((i) => !i.blocking);
  const accounts = data.accounts.filter((a) => !a.archived);
  const cats = data.categories.filter((x) => !x.archived && x.kind === (d.kind === 'income' ? 'income' : 'expense'));
  const label = d.merchant || KIND_LABEL[d.kind];

  return (
    <View testID="draft" accessibilityLabel={`Draft: ${label}`} style={{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, borderLeftWidth: 3, borderLeftColor: blocking.length ? c.warning : c.positive, padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T variant="footnote" color={blocking.length ? 'warning' : 'positive'} style={{ fontFamily: FONT.semibold, flex: 1 }}>{blocking.length ? 'Needs attention' : 'Ready'}</T>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove draft ${label}`} onPress={onRemove} hitSlop={10}><Trash2 size={18} color={c.textTertiary} /></Pressable>
      </View>
      <T variant="footnote" color="textSecondary" style={{ fontStyle: 'italic' }}>“{d.sourceText}”</T>
      <Choices label="Type" value={d.kind} options={(Object.keys(KIND_LABEL) as DraftKind[]).map((k) => ({ value: k, label: d.role === 'card_payment' && k === 'transfer' ? 'Card payment' : KIND_LABEL[k] }))}
        onChange={(kind) => onChange({ kind, kindUnclear: false, role: kind === 'transfer' ? d.role ?? 'transfer' : null, categoryId: kind === 'transfer' ? null : d.categoryId, splits: kind === 'expense' ? d.splits : [] })} />
      {d.kind !== 'transfer' && (
        <Field label={`${d.kind === 'income' ? 'From' : 'Merchant'}${d.merchant && d.merchantSource ? ` · ${SOURCE[d.merchantSource]}` : ''}`}>
          <Input accessibilityLabel="Merchant" value={d.merchant} onChangeText={(t) => onChange({ merchant: t, merchantSource: 'words' })} invalid={blocking.some((i) => i.field === 'merchant')} />
        </Field>
      )}
      <Field label="Amount">
        <Input accessibilityLabel="Amount" keyboardType="decimal-pad" value={amountText} onChangeText={(v) => { setAmountText(v); const x = parseAmountInput(v, cur); onChange({ amountCents: x !== null && x > 0 ? x : null, approximate: false, currency: cur }); }} invalid={blocking.some((i) => i.field === 'amount')} />
      </Field>
      <DateField label={`Date${d.date && d.dateSource ? ` · ${SOURCE[d.dateSource]}` : ''}`} value={d.date ?? today} onChange={(date) => onChange({ date, dateSource: 'words', dateAmbiguous: false, dateText: null })} />
      {d.kind !== 'transfer' && d.splits.length === 0 && (
        <Choices label={`Category${d.categoryId && d.categorySource ? ` · ${SOURCE[d.categorySource]}` : ''}`} value={d.categoryId} options={cats.map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => onChange({ categoryId: v, categorySource: 'words', categoryWords: null })} />
      )}
      {d.splits.map((s, i) => (
        <Choices key={i} label={`${s.label || `Part ${i + 1}`} · ${formatCents(s.amountCents, cur)}`} value={s.categoryId} options={cats.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(v) => onChange({ splits: d.splits.map((x, j) => (j === i ? { ...x, categoryId: v } : x)) })} />
      ))}
      <Choices label={d.kind === 'transfer' ? 'From account' : `Account${d.accountId && d.accountSource ? ` · ${SOURCE[d.accountSource]}` : ''}`} value={d.accountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => onChange({ accountId: v, accountSource: 'words', accountWords: null })} />
      {d.kind === 'transfer' && (
        <Choices label={d.role === 'card_payment' ? 'Card paid' : 'To account'} value={d.toAccountId} options={accounts.filter((a) => a.id !== d.accountId).map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => onChange({ toAccountId: v, toAccountWords: null })} />
      )}
      {blocking.map((i) => (
        <View key={i.code} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: c.warningSoft, borderRadius: 10, padding: 10 }}>
          <AlertTriangle size={14} color={c.warning} />
          <T variant="footnote" color="warning" style={{ flex: 1 }}>{i.message}</T>
          {i.confirmable && <Button small kind="secondary" title={i.code === 'duplicate' ? 'Keep it' : 'Confirm'} onPress={() => onChange({ acknowledged: [...d.acknowledged, i.code] })} />}
        </View>
      ))}
      {notes.map((i) => (
        <View key={i.code} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: c.surfaceMuted, borderRadius: 10, padding: 10 }}>
          <Info size={14} color={c.textSecondary} />
          <T variant="footnote" color="textSecondary" style={{ flex: 1 }}>{i.message}</T>
        </View>
      ))}
      <Button small kind="secondary" title="Approve" accessibilityLabel={`Approve ${label}`} disabled={blocking.length > 0 || busy} onPress={onApprove} />
    </View>
  );
}
