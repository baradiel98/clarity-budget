import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addTransaction, deleteTransaction, markPostedBeforeOpening, matchOptionView, recordPaymentReturn, returnOptionsForEntry, updateTransaction, type TxInput } from '@clarity/data';
import { balanceAsOfDate, buildMerchantMemory, inclusionProblem, expandOccurrences, findPossibleDuplicates, merchantKey, suggestOccurrenceMatch } from '@clarity/engine';
import { addDays, ALREADY_INCLUDED_HINT, ALREADY_INCLUDED_LABEL, OPENING_POSTED_HINT, OPENING_POSTED_LABEL, RETURN_ASK_LINK, RETURN_CHECK_TITLE, RETURN_DECIDE_HINT, RETURN_NEEDS_DECISION, RETURN_SEPARATE_LABEL, centsToDecimalString, formatCents, formatShortDate, legsPendingOf, parseAmountInput, TERMS, transferChoiceOf, TRANSFER_STATUS_HINT, TRANSFER_STATUS_LABEL, transferStatusOptions, type Transaction, type TransferSettlementChoice } from '@clarity/shared';
import { useData, useRun, useSession, useStore } from '../state/session';
import type { AddPrefill } from '../state/ui';
import { AmountInput } from '../ui/AmountInput';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Segmented } from '../ui/Segmented';
import { useToast } from '../ui/Toast';
import { Spinner } from '../ui/Spinner';

type Kind = TxInput['kind'];
const KINDS: { value: Kind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'refund', label: 'Refund' },
];

export function CategorySelect({ id, value, onChange, kind, allowNone = true }: { id?: string; value: string | null; onChange: (v: string | null) => void; kind: 'expense' | 'income'; allowNone?: boolean }) {
  const data = useData();
  const groups = useMemo(() => {
    const m = new Map<string, typeof data.categories>();
    for (const c of data.categories) {
      if (c.archived && c.id !== value) continue;
      if (c.kind !== kind && c.id !== value) continue;
      m.set(c.group, [...(m.get(c.group) ?? []), c]);
    }
    return [...m];
  }, [data.categories, kind, value]);
  return (
    <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">Uncategorized</option>}
      {groups.map(([g, cs]) => (
        <optgroup key={g} label={g}>
          {cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export function AccountSelect({ id, value, onChange, exclude }: { id?: string; value: string; onChange: (v: string) => void; exclude?: string }) {
  const data = useData();
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {data.accounts.filter((a) => (!a.archived || a.id === value) && a.id !== exclude).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

function initialFrom(prefill: AddPrefill | undefined, existing: Transaction[] | null, defaults: { accountId: string; today: string }, recurring: ReturnType<typeof useData>['recurring']) {
  if (existing && existing.length) {
    const src = existing.find((t) => t.amountCents < 0) ?? existing[0]!;
    const other = existing.find((t) => t.id !== src.id);
    const kind: Kind = src.kind === 'adjustment' ? 'expense' : (src.kind as Kind);
    return {
      kind,
      amount: centsToDecimalString(Math.abs(src.amountCents)),
      merchant: src.merchant,
      categoryId: src.categoryId,
      accountId: src.accountId,
      toAccountId: other?.accountId ?? '',
      date: src.date,
      notes: src.notes,
      pending: src.status === 'pending',
      // Phase 4A.5.14: the receiving leg's own status
      toPending: (other ?? src).status === 'pending',
      included: !!src.includedInBalance as boolean | null,
      toIncluded: !!other?.includedInBalance as boolean | null,
      splits: src.splits?.map((s) => ({ categoryId: s.categoryId, amount: centsToDecimalString(Math.abs(s.amountCents)) })) ?? [],
    };
  }
  const item = prefill?.occurrenceRef ? recurring.find((r) => r.id === prefill.occurrenceRef!.recurringId) : undefined;
  const kind: Kind = prefill?.kind ?? (item ? (item.kind === 'income' ? 'income' : item.kind === 'transfer' || item.kind === 'savings' ? 'transfer' : 'expense') : 'expense');
  return {
    kind,
    amount: prefill?.amountCents ? centsToDecimalString(prefill.amountCents) : '',
    merchant: prefill?.merchant ?? item?.name ?? '',
    categoryId: prefill?.categoryId ?? item?.categoryId ?? null,
    accountId: prefill?.accountId ?? item?.accountId ?? defaults.accountId,
    toAccountId: prefill?.toAccountId ?? item?.toAccountId ?? '',
    date: prefill?.date ?? defaults.today,
    notes: '',
    pending: false,
    toPending: false,
    // Phase 4A.5.8 (D6): null = not chosen yet, so the default rule applies (ticked when dated before the confirmed date)
    included: null as boolean | null,
    toIncluded: null as boolean | null,
    splits: [] as { categoryId: string; amount: string }[],
  };
}

export function AddTransactionDialog({ prefill, onClose }: { prefill?: AddPrefill; onClose: () => void }) {
  const data = useData();
  const { store } = useStore();
  const { today } = useSession();
  const run = useRun();
  const toast = useToast();
  const cur = data.settings.baseCurrency;
  const existing = prefill?.editId
    ? (() => {
        const t = data.transactions.find((x) => x.id === prefill.editId);
        if (!t) return null;
        return t.transferGroupId ? data.transactions.filter((x) => x.transferGroupId === t.transferGroupId) : [t];
      })()
    : null;
  const defaultAccount = data.settings.defaultAccountId ?? data.accounts.find((a) => a.spendable && !a.archived)?.id ?? data.accounts[0]?.id ?? '';
  const init = useMemo(() => initialFrom(prefill, existing, { accountId: defaultAccount, today }, data.recurring), []);
  const [kind, setKind] = useState<Kind>(init.kind);
  const [amount, setAmount] = useState(init.amount);
  const [merchant, setMerchant] = useState(init.merchant);
  const [categoryId, setCategoryId] = useState<string | null>(init.categoryId);
  const [categoryTouched, setCategoryTouched] = useState(!!init.categoryId);
  const [accountId, setAccountId] = useState(init.accountId);
  const [toAccountId, setToAccountId] = useState(init.toAccountId);
  const [date, setDate] = useState(init.date);
  const [notes, setNotes] = useState(init.notes);
  const [pending, setPending] = useState(init.pending);
  // Phase 4A.5.14: for a transfer, `pending` is the sending leg and `toPending` the receiving leg (shown as one visible
  // "Status" choice); switching the type carries the state over visibly, never as a hidden setting
  const [toPending, setToPending] = useState(init.toPending);
  const [splits, setSplits] = useState(init.splits);
  const [more, setMore] = useState(init.splits.length > 0 || !!init.notes || init.pending);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupConfirmed, setDupConfirmed] = useState(false);
  const [linkOcc, setLinkOcc] = useState(true);
  const [included, setIncluded] = useState<boolean | null>(init.included);
  const [toIncluded, setToIncluded] = useState<boolean | null>(init.toIncluded);
  const [showSuggest, setShowSuggest] = useState(false);
  const [busy, setBusy] = useState(false);

  const isEdit = !!existing;
  // Phase 4A.5.14 (D7): switching the type never keeps a hidden pending setting. To a transfer: a pending item becomes
  // "Not posted by either bank yet", shown in the transfer's Status choice. From a transfer: if either side was
  // pending, the item is pending and the Pending checkbox is shown (the notes/pending section opens).
  const changeKind = (k: Kind) => {
    if (k === kind) return;
    if (k === 'transfer') setToPending(pending);
    else if (kind === 'transfer') { const p = pending || toPending; setPending(p); if (p) setMore(true); }
    setKind(k);
  };
  // Phase 4A.5.8: a reconciliation record; the data layer refuses edits too
  const isAdjustment = !!existing?.some((t) => t.kind === 'adjustment');
  // Phase 4A.5.6/4A.5.8: a posted transaction dated from the opening date through the account's confirmed balance date
  // may already be in that balance. Never offered for pending or future-dated items; for a transfer, each account is
  // decided against its own balance date. Default (D6): ticked when dated before that date; unticked on the date itself.
  const status = pending ? 'pending' : 'confirmed';
  const inclusion = (acctId: string, chosen: boolean | null, legStatus: 'pending' | 'confirmed' = status) => {
    const a = data.accounts.find((x) => x.id === acctId);
    if (!a) return null;
    if (inclusionProblem(a, data.transactions, date, legStatus, today)) return null;
    const bd = balanceAsOfDate(a, data.transactions);
    return { account: a, date: bd, checked: chosen ?? date < bd }; // default: ticked only when dated before the confirmed date
  };
  const fromInc = inclusion(accountId, included);
  const toInc = kind === 'transfer' && toAccountId ? inclusion(toAccountId, toIncluded, toPending ? 'pending' : 'confirmed') : null;
  const cents = parseAmountInput(amount, cur);
  const memory = useMemo(() => buildMerchantMemory(data.transactions, merchantKey), [data.transactions]);
  const merchants = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of data.transactions) if (t.merchant && t.kind !== 'transfer' && t.kind !== 'adjustment') count.set(t.merchant, (count.get(t.merchant) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  }, [data.transactions]);
  const matches = merchant.trim() ? merchants.filter((m) => m.toLowerCase().includes(merchant.trim().toLowerCase()) && m !== merchant).slice(0, 6) : [];

  const applyMerchant = (m: string) => {
    setMerchant(m);
    const mem = memory.get(merchantKey(m));
    if (mem && !categoryTouched) setCategoryId(mem.categoryId);
    if (mem && !isEdit && kind !== 'transfer' && data.accounts.some((a) => a.id === mem.accountId && !a.archived)) setAccountId(mem.accountId);
  };

  const signed = cents === null ? null : kind === 'expense' ? -cents : kind === 'transfer' ? -cents : cents;
  const duplicates = !isEdit && signed !== null && kind !== 'transfer' ? findPossibleDuplicates({ accountId, date, amountCents: signed, merchant }, data.transactions) : [];
  const occurrence = useMemo(() => {
    if (prefill?.occurrenceRef || isEdit || signed === null || kind === 'refund') return null;
    const occ = expandOccurrences(data.recurring, data.exceptions, data.transactions, { from: addDays(date, -40), to: addDays(date, 10), today });
    return suggestOccurrenceMatch({ accountId, date, amountCents: kind === 'income' ? Math.abs(signed) : -Math.abs(signed), merchant }, occ);
  }, [prefill, isEdit, signed, kind, data, date, accountId, merchant, today]);

  // Phase 4A.5.18: money coming in that could be a returned card payment needs an explicit decision (never automatic)
  const [returnChoice, setReturnChoice] = useState<string | null>(null); // a payment leg id, 'separate', or null
  const [askReturn, setAskReturn] = useState(false);
  const retEntry = { kind, accountId, amountCents: cents, date, merchant };
  const editingPlain = !isEdit || (existing!.length === 1 && !existing![0]!.transferGroupId);
  const suggestedReturns = editingPlain ? returnOptionsForEntry(data, retEntry) : [];
  const returnOptions = askReturn ? returnOptionsForEntry(data, retEntry, true) : suggestedReturns;
  const anyReturnPossible = editingPlain && !askReturn && suggestedReturns.length === 0 && returnOptionsForEntry(data, retEntry, true).length > 0;
  const chosenReturn = returnOptions.find((m) => m.txId === returnChoice) ?? null;
  const needsReturnDecision = suggestedReturns.length > 0 && returnChoice === null;
  const isPreOpeningPending = isEdit && existing!.length === 1 && existing![0]!.status === 'pending' && (data.accounts.find((a) => a.id === existing![0]!.accountId)?.openingDate ?? '') > existing![0]!.date;

  const splitTotal = splits.reduce((s, x) => s + (parseAmountInput(x.amount, cur) ?? 0), 0);

  const save = async () => {
    const e: Record<string, string> = {};
    if (cents === null || cents <= 0) e.amount = 'Enter an amount greater than zero.';
    if (kind !== 'income' && kind !== 'transfer' && !merchant.trim()) e.merchant = 'Add a merchant or description.';
    if (kind === 'transfer' && !toAccountId) e.toAccountId = 'Choose where the money goes.';
    if (splits.length > 0 && cents !== null && splitTotal !== cents) e.splits = `Split parts add up to ${formatCents(splitTotal, cur)}, not ${formatCents(cents, cur)}.`;
    if (splits.some((s) => !s.categoryId || (parseAmountInput(s.amount, cur) ?? 0) <= 0)) e.splits = 'Each split part needs a category and an amount.';
    setErrors(e);
    if (Object.keys(e).length) return;
    if (needsReturnDecision) { setErrors({ form: RETURN_NEEDS_DECISION }); return; }
    if (chosenReturn) {
      setBusy(true);
      const r = await run((ctx) => recordPaymentReturn(ctx, { paymentLegId: chosenReturn.txId, accountId, amountCents: cents!, date, status: pending ? 'pending' : 'confirmed', merchant, ...(isEdit ? { replaceTxId: existing![0]!.id } : {}) }), { undoLabel: 'Recorded returned payment' });
      setBusy(false);
      if (!r.ok) { setErrors(Object.fromEntries(r.errors.map((x) => [x.field === 'form' ? 'form' : x.field, x.message]))); return; }
      toast({ message: `Recorded a returned card payment of ${formatCents(cents!, cur)}`, action: { label: 'Undo', run: () => void store.undo() } });
      onClose();
      return;
    }
    if (duplicates.length && !dupConfirmed) {
      setDupConfirmed(true);
      return;
    }
    const input: TxInput = {
      kind,
      accountId,
      ...(kind === 'transfer' ? { toAccountId } : {}),
      date,
      amountCents: cents!,
      merchant,
      categoryId: kind === 'transfer' ? null : categoryId,
      notes,
      status: pending ? 'pending' : 'confirmed',
      ...(kind === 'transfer' ? { toStatus: toPending ? 'pending' : 'confirmed' } : {}),
      includedInBalance: !!fromInc?.checked,
      ...(kind === 'transfer' ? { toIncludedInBalance: !!toInc?.checked } : {}),
      ...(splits.length ? { splits: splits.map((s) => ({ categoryId: s.categoryId, amountCents: parseAmountInput(s.amount, cur)! })) } : {}),
      ...(prefill?.occurrenceRef ? { occurrenceRef: prefill.occurrenceRef } : occurrence && linkOcc ? { occurrenceRef: { recurringId: occurrence.recurringId, originalDate: occurrence.originalDate } } : {}),
      // Phase 4A.5.18: the user said it's separate income: the payments it could have been are kept on record
      ...(!isEdit && returnChoice === 'separate' && suggestedReturns.length ? { provenance: { source: 'manual' as const, separateFrom: suggestedReturns.map((m) => m.txId) } } : {}),
    };
    setBusy(true);
    const label = `${merchant.trim() || (kind === 'transfer' ? 'Transfer' : 'Income')} ${formatCents(signed!, cur, { sign: kind === 'transfer' ? 'never' : 'always' })}`;
    const r = await run((ctx) => (isEdit ? updateTransaction(ctx, existing![0]!.id, input) : addTransaction(ctx, input)), { undoLabel: isEdit ? `Edited ${label}` : `Added ${label}` });
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.fromEntries(r.errors.map((x) => [x.field === 'form' ? 'form' : x.field, x.message])));
      return;
    }
    toast({ message: isEdit ? `Saved ${label}` : `Added ${label}`, action: { label: 'Undo', run: () => void store.undo() } });
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    const r = await run((ctx) => deleteTransaction(ctx, existing[0]!.id), { undoLabel: 'Deleted transaction' });
    if (r.ok) {
      toast({ message: 'Transaction deleted', action: { label: 'Undo', run: () => void store.undo() } });
      onClose();
    }
  };

  if (data.accounts.filter((a) => !a.archived).length === 0) {
    return (
      <Dialog title={TERMS.addTransaction} onClose={onClose}>
        <p>Add an account first in Settings → Accounts.</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={isEdit ? 'Edit transaction' : prefill?.occurrenceName ? `Record ${prefill.occurrenceName}` : TERMS.addTransaction}
      onClose={onClose}
      footer={
        <>
          {isEdit && (
            <button type="button" className="btn btn-ghost" onClick={() => void remove()} style={{ marginRight: 'auto' }}>
              <Trash2 size={15} /> Delete
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="tx-form" className="btn btn-primary" disabled={busy || isAdjustment} aria-busy={busy} data-testid="save-tx">
            {busy && <Spinner />}{duplicates.length && dupConfirmed ? 'Save anyway' : 'Save'} <kbd aria-hidden="true" style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor', opacity: 0.9 }}>↵</kbd>
          </button>
        </>
      }
    >
      <form id="tx-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="stack">
        {isAdjustment && <div className="callout warn" role="alert" data-testid="adjustment-locked">Balance adjustments can’t be edited: changing it here would turn it into an expense or income and could flip its sign. Delete it, or use Update balance again in Settings.</div>}
        {!prefill?.occurrenceRef && !isEdit && <Segmented label="Type" value={kind} options={KINDS} onChange={(k) => { changeKind(k); if (!categoryTouched) setCategoryId(k === 'income' ? 'cat_paycheck' : null); }} block />}
        <Field label="Amount" error={errors.amount}>
          {(id) => <AmountInput id={id} value={amount} onChange={setAmount} currency={cur} large autoFocus aria-invalid={!!errors.amount} data-testid="amount" />}
        </Field>
        <div className="form-grid">
          {kind !== 'transfer' && (
            <Field label={kind === 'income' ? 'From (optional)' : 'Merchant'} error={errors.merchant} className="full">
              {(id) => (
                <div style={{ position: 'relative' }}>
                  <input
                    id={id}
                    className="input"
                    value={merchant}
                    autoComplete="off"
                    onChange={(e) => { setMerchant(e.target.value); setShowSuggest(true); }}
                    onBlur={() => { setTimeout(() => setShowSuggest(false), 120); applyMerchant(merchant); }}
                    onKeyDown={(e) => { if (e.key === 'Tab' && showSuggest && matches[0]) applyMerchant(matches[0]); }}
                    placeholder={kind === 'income' ? 'Employer or source' : 'Where did you spend?'}
                    data-testid="merchant"
                  />
                  {showSuggest && matches.length > 0 && (
                    <div className="suggest" role="listbox">
                      {matches.map((m) => (
                        <button key={m} type="button" role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); applyMerchant(m); setShowSuggest(false); }}>
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Field>
          )}
          {kind !== 'transfer' && splits.length === 0 && !chosenReturn && (
            <Field label="Category" hint={!categoryTouched && categoryId ? 'Suggested from your history' : undefined}>
              {(id) => <CategorySelect id={id} value={categoryId} onChange={(v) => { setCategoryId(v); setCategoryTouched(true); }} kind={kind === 'income' ? 'income' : 'expense'} />}
            </Field>
          )}
          <Field label={kind === 'transfer' ? 'From account' : 'Account'}>{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>
          {kind === 'transfer' && (
            <Field label="To account" error={errors.toAccountId}>
              {(id) => (
                <select id={id} className="select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                  <option value="">Choose…</option>
                  {data.accounts.filter((a) => !a.archived && a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === 'credit_card' ? ' (card payment)' : ''}</option>)}
                </select>
              )}
            </Field>
          )}
          <Field label="Date">{(id) => <input id={id} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          {returnOptions.length > 0 && (
            <div className="callout full" role="radiogroup" aria-label={RETURN_CHECK_TITLE} data-testid="return-check">
              <strong>{RETURN_CHECK_TITLE}</strong>
              {returnOptions.map((m) => { const v = matchOptionView(m, cents ?? 0, data, cur); return (
                <label key={m.txId} className="check"><input type="radio" name="return-choice" checked={returnChoice === m.txId} onChange={() => { setReturnChoice(m.txId); setErrors({}); }} /><span>{v.label}</span></label>
              ); })}
              <label className="check"><input type="radio" name="return-choice" checked={returnChoice === 'separate'} onChange={() => { setReturnChoice('separate'); setErrors({}); }} /><span>{RETURN_SEPARATE_LABEL}</span></label>
              {chosenReturn ? <div className="hint" data-testid="return-note">{matchOptionView(chosenReturn, cents ?? 0, data, cur).note}</div> : <div className="hint">{RETURN_DECIDE_HINT}</div>}
            </div>
          )}
          {anyReturnPossible && <button type="button" className="btn-link full" onClick={() => setAskReturn(true)} data-testid="return-ask">{RETURN_ASK_LINK}</button>}
          {isPreOpeningPending && (() => { const a = data.accounts.find((x) => x.id === existing![0]!.accountId)!; return (
            <div className="callout full" data-testid="opening-posted">
              <div className="hint">{OPENING_POSTED_HINT(a.name, formatShortDate(a.openingDate))}</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { const r = await run((ctx) => markPostedBeforeOpening(ctx, existing![0]!.id), { undoLabel: 'Marked as already in the opening balance' }); if (r.ok) { toast({ message: `Marked as already in ${a.name}'s opening balance`, action: { label: 'Undo', run: () => void store.undo() } }); onClose(); } }}>{OPENING_POSTED_LABEL(a.name)}</button>
            </div>
          ); })()}
          {kind === 'transfer' && (
            <Field label={TRANSFER_STATUS_LABEL} hint={TRANSFER_STATUS_HINT}>
              {(id) => (
                <select id={id} className="select" data-testid="transfer-status" value={transferChoiceOf(pending, toPending)} onChange={(e) => { const l = legsPendingOf(e.target.value as TransferSettlementChoice); setPending(l.fromPending); setToPending(l.toPending); }}>
                  {transferStatusOptions(data.accounts.find((a) => a.id === toAccountId)?.type === 'credit_card').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </Field>
          )}
        </div>

        {occurrence && (
          <label className="check callout">
            <input type="checkbox" checked={linkOcc} onChange={(e) => setLinkOcc(e.target.checked)} />
            <span>This {occurrence.kind === 'income' ? 'is' : 'pays'} <strong>{occurrence.name}</strong> {occurrence.kind === 'income' ? 'expected' : 'due'} {formatShortDate(occurrence.date)}, so it won't be counted again in your forecast.</span>
          </label>
        )}
        {fromInc && (
          <label className="check" data-testid="already-included">
            <input type="checkbox" checked={fromInc.checked} onChange={(e) => setIncluded(e.target.checked)} />
            <span>{ALREADY_INCLUDED_LABEL(formatShortDate(fromInc.date), kind === 'transfer' ? fromInc.account.name : undefined)}. <span className="hint">{ALREADY_INCLUDED_HINT}</span></span>
          </label>
        )}
        {toInc && (
          <label className="check" data-testid="already-included-to">
            <input type="checkbox" checked={toInc.checked} onChange={(e) => setToIncluded(e.target.checked)} />
            <span>{ALREADY_INCLUDED_LABEL(formatShortDate(toInc.date), toInc.account.name)}. <span className="hint">{ALREADY_INCLUDED_HINT}</span></span>
          </label>
        )}
        {date > today && <div className="callout">Dated in the future: it will appear as planned in your forecast and count toward your balance on {formatShortDate(date)}.</div>}
        {duplicates.length > 0 && (
          <div className="callout warn" role="alert">
            <AlertTriangle size={14} /> A {formatCents(Math.abs(duplicates[0]!.amountCents), cur)} transaction at {duplicates[0]!.merchant} on this date already exists. {dupConfirmed ? 'Press Save again to add it anyway.' : 'Is this a duplicate?'}
          </div>
        )}

        {kind !== 'transfer' && (
          <div>
            {!more ? (
              <button type="button" className="btn-link" onClick={() => setMore(true)}>Notes, split or pending</button>
            ) : (
              <div className="stack">
                <Field label="Notes">{(id) => <textarea id={id} className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />}</Field>
                <label className="check"><input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} /> Pending (not yet cleared by the bank)</label>
                <div className="field">
                  <div className="row between"><span className="label">Split across categories</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSplits([...(splits.length ? splits : [{ categoryId: categoryId ?? '', amount: amount }]), { categoryId: '', amount: '' }])}><Plus size={14} /> Add part</button>
                  </div>
                  {splits.map((s, i) => (
                    <div key={i} className="row">
                      <div style={{ flex: 1 }}><CategorySelect value={s.categoryId || null} onChange={(v) => setSplits(splits.map((x, j) => (j === i ? { ...x, categoryId: v ?? '' } : x)))} kind={kind === 'income' ? 'income' : 'expense'} /></div>
                      <div style={{ width: 140 }}><AmountInput value={s.amount} onChange={(v) => setSplits(splits.map((x, j) => (j === i ? { ...x, amount: v } : x)))} currency={cur} aria-label={`Split ${i + 1} amount`} /></div>
                      <button type="button" className="icon-btn" aria-label="Remove part" onClick={() => setSplits(splits.length <= 2 ? [] : splits.filter((_, j) => j !== i))}><X size={16} /></button>
                    </div>
                  ))}
                  {splits.length > 0 && cents !== null && (
                    <div className={`hint ${splitTotal !== cents ? 'warn' : ''}`}>{splitTotal === cents ? 'Parts add up to the total.' : `${formatCents(cents - splitTotal, cur)} left to assign.`}</div>
                  )}
                  {errors.splits && <div className="error-text">{errors.splits}</div>}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Phase 4A.5.14: also changes refused because another tab changed the data (stale) or because a linked item can't be made pending (status) */}
        {(errors.form ?? errors.includedInBalance ?? errors.stale ?? errors.status ?? errors.transfer) && <div className="error-text" role="alert" data-testid="form-error">{errors.form ?? errors.includedInBalance ?? errors.stale ?? errors.status ?? errors.transfer}</div>}
      </form>
    </Dialog>
  );
}
