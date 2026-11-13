import { CheckCircle2, CircleAlert, CircleMinus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { engineInput } from '@clarity/data';
import { canIAfford } from '@clarity/engine';
import { formatShortDate, parseAmountInput, TERMS } from '@clarity/shared';
import { useData, useSession } from '../state/session';
import { useUi } from '../state/ui';
import { AmountInput } from '../ui/AmountInput';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Money } from '../ui/Money';
import { AccountSelect } from './AddTransaction';

/** Runs the engine's Safe to Spend with one hypothetical purchase. Nothing is saved unless the user taps "Add as transaction". */
export function AffordDialog({ onClose }: { onClose: () => void }) {
  const data = useData();
  const { today } = useSession();
  const ui = useUi();
  const cur = data.settings.baseCurrency;
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [accountId, setAccountId] = useState(data.settings.defaultAccountId ?? data.accounts.find((a) => a.spendable)?.id ?? data.accounts[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const cents = parseAmountInput(amount, cur);
  const result = useMemo(() => (cents && cents > 0 && accountId ? canIAfford(engineInput(data, today), { amountCents: cents, accountId, date, label }) : null), [cents, accountId, date, label, data, today]);

  const tone = result?.verdict === 'yes' ? 'pos' : result?.verdict === 'tight' ? 'warn' : 'neg';
  const Icon = result?.verdict === 'yes' ? CheckCircle2 : result?.verdict === 'tight' ? CircleMinus : CircleAlert;
  const headline = result?.verdict === 'yes' ? 'Yes, you can afford it' : result?.verdict === 'tight' ? 'Tight — it dips into your reserve' : 'Not without coming up short';

  return (
    <Dialog
      title={TERMS.canIAfford}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-secondary" disabled={!result} onClick={() => { onClose(); ui.openAdd({ kind: 'expense', amountCents: cents!, accountId, date, merchant: label }); }}>
            Add as transaction
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="How much?">{(id) => <AmountInput id={id} value={amount} onChange={setAmount} currency={cur} large autoFocus data-testid="afford-amount" />}</Field>
        <div className="form-grid">
          <Field label="What is it? (optional)" className="full">{(id) => <input id={id} className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. New headphones" />}</Field>
          <Field label="Pay with">{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>
          <Field label="When">{(id) => <input id={id} className="input" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        {result && (
          <div className="card" style={{ background: 'var(--c-surface-muted)', border: 0 }} data-testid="afford-result" aria-live="polite">
            <div className={`row ${tone}`} style={{ fontWeight: 600, fontSize: 16 }}><Icon size={20} /> {headline}</div>
            <div className="facts" style={{ borderTop: 0, paddingTop: 0 }}>
              <div><div className="k">{TERMS.safeToSpend} now</div><div className="v"><Money cents={result.before.cents} currency={cur} /></div></div>
              <div><div className="k">After this purchase</div><div className={`v ${result.after.cents < 0 ? 'neg' : ''}`}><Money cents={result.after.cents} currency={cur} /></div></div>
              <div><div className="k">New lowest point</div><div className={`v ${result.after.lowPoint.cents < 0 ? 'neg' : ''}`}><Money cents={result.after.lowPoint.cents} currency={cur} /> <span className="faint t-footnote">{formatShortDate(result.after.lowPoint.date)}</span></div></div>
            </div>
            {result.verdict === 'no' && <p className="t-callout neg" style={{ marginBottom: 0 }}>You'd be short <Money cents={result.shortfallCents} currency={cur} /> before {formatShortDate(result.after.lowPoint.date)}.</p>}
            {result.notes.map((n) => <p key={n} className="t-footnote muted" style={{ marginBottom: 0 }}>{n}</p>)}
            <p className="hint" style={{ marginBottom: 0 }}>This is a what-if. Nothing has been saved.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
