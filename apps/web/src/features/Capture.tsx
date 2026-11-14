import { AlertTriangle, ArrowRight, Check, CircleAlert, Info, PenLine, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { captureTotals, localInterpreter, parseDrafts, reviewDraft, toTxInput, type CaptureContext, type CaptureDraft, type DraftKind, type Issue } from '@clarity/capture';
import { addTransactions } from '@clarity/data';
import { centsToDecimalString, formatCents, parseAmountInput, type WorkspaceData } from '@clarity/shared';
import { Link } from '../lib/router';
import { captureStore } from '../state/capture';
import { useData, useRun, useSession, useStore } from '../state/session';
import { useUi } from '../state/ui';
import { AmountInput } from '../ui/AmountInput';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { CategorySelect } from './AddTransaction';

const MAX_CHARS = 4000;
const EXAMPLES = [
  'Yesterday I spent $45 at Walmart on groceries, $18 at Starbucks for coffee, and today I paid $65 for gas at Shell.',
  'Received my paycheck of $1,850 today.',
  'Paid $300 toward my credit card today.',
  'I spent $120 at Costco today: $70 groceries, $30 household supplies, and $20 personal care.',
];
const KIND_LABEL: Record<DraftKind, string> = { expense: 'Expense', income: 'Income', refund: 'Refund', transfer: 'Transfer' };
const SOURCE_LABEL: Record<string, string> = { words: 'from your words', memory: 'you used this before', rule: 'suggested', default: 'your default', carried: 'from earlier in your message', later: 'from later in your sentence', none: 'not mentioned', description: 'your words' };

export function captureContext(data: WorkspaceData, today: string): CaptureContext {
  return { today, currency: data.settings.baseCurrency, categories: data.categories, accounts: data.accounts, defaultAccountId: data.settings.defaultAccountId, transactions: data.transactions };
}

/** Clarity Capture: describe what you spent; review drafts; approve. Nothing is saved before approval. */
export function CapturePage() {
  const data = useData();
  const { today } = useSession();
  const { store, demo } = useStore();
  const run = useRun();
  const toast = useToast();
  const ui = useUi();
  const st = useSyncExternalStore(captureStore.subscribe, captureStore.get);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const ctx = useMemo(() => captureContext(data, today), [data, today]);
  const cur = data.settings.baseCurrency;

  const reviews = useMemo(() => new Map(st.drafts.map((d) => [d.id, reviewDraft(d, ctx)])), [st.drafts, ctx]);
  const ready = st.drafts.filter((d) => !reviews.get(d.id)!.some((i) => i.blocking));
  const attention = st.drafts.length - ready.length;
  const totals = captureTotals(st.drafts);

  const read = async () => {
    const text = st.text.trim();
    if (!text) { area.current?.focus(); return; }
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
      // Never lose what was typed.
      captureStore.set({ error: 'Something went wrong while reading that. Your text is still here: try again, or add it manually.' });
    } finally {
      setReading(false);
    }
  };

  const update = (id: string, patch: Partial<CaptureDraft>) => captureStore.set((s) => ({ drafts: s.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
  const remove = (id: string) => captureStore.set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));

  const approve = async (ids: string[]) => {
    const chosen = st.drafts.filter((d) => ids.includes(d.id));
    const inputs = chosen.map((d) => toTxInput(d, ctx));
    if (inputs.some((x) => !x) || inputs.length === 0) return;
    setSaving(true);
    const r = await run((c) => addTransactions(c, inputs.map((x) => x!)), { undoLabel: `Captured ${inputs.length}` });
    setSaving(false);
    if (!r.ok) {
      captureStore.set({ error: `Nothing was saved: ${r.errors.map((e) => e.message).join(' ')} Your drafts are still here.` });
      return;
    }
    captureStore.set((s) => ({ drafts: s.drafts.filter((d) => !ids.includes(d.id)), error: null, saved: s.saved + inputs.length }));
    toast({ message: inputs.length === 1 ? 'Saved 1 transaction' : `Saved ${inputs.length} transactions`, action: { label: 'Undo', run: () => void store.undo() } });
  };

  return (
    <div className="capture">
      <div className="page-head">
        <div>
          <h1>Clarity Capture</h1>
          <div className="sub muted t-callout">Tell Clarity what you spent. We’ll organize it for you.</div>
        </div>
      </div>

      <section className="card capture-input" aria-labelledby="cap-label">
        <label id="cap-label" htmlFor="cap-text" className="sr-only">Describe what you spent, earned or paid</label>
        <textarea
          id="cap-text"
          ref={area}
          className="capture-text"
          value={st.text}
          onChange={(e) => captureStore.set({ text: e.target.value, error: null })}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void read(); } }}
          placeholder="Tell me what you spent, earned, or paid today…"
          rows={3}
          maxLength={MAX_CHARS + 500}
          autoFocus
          data-testid="capture-text"
        />
        {!st.text && st.drafts.length === 0 && (
          <div className="capture-examples" aria-label="Examples">
            {EXAMPLES.map((x) => <button key={x} type="button" className="chip" onClick={() => { captureStore.set({ text: x }); area.current?.focus(); }}>{x}</button>)}
          </div>
        )}
        <div className="capture-foot">
          <span className="capture-privacy"><ShieldCheck size={14} aria-hidden /> Read on this device. Nothing is sent anywhere.</span>
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={() => void read()} disabled={reading} aria-busy={reading} data-testid="capture-read">
            {reading ? <><Spinner /> Reading…</> : <><Sparkles size={15} aria-hidden /> Prepare</>}
          </button>
        </div>
      </section>

      {st.error && (
        <div className="capture-error" role="alert">
          <CircleAlert size={18} aria-hidden />
          <div className="grow">{st.error}</div>
          <button className="btn btn-secondary btn-sm" onClick={() => void read()}>Try again</button>
          <button className="btn btn-ghost btn-sm" onClick={() => ui.openAdd()}><PenLine size={14} /> Add manually</button>
        </div>
      )}
      {st.notUnderstood.length > 0 && (
        <div className="callout capture-missed" role="status">
          <Info size={15} aria-hidden /> No amount found in {st.notUnderstood.map((x) => `“${x}”`).join(', ')}. Add the amount and prepare again, or add it manually.
        </div>
      )}

      {st.drafts.length > 0 && (
        <>
          <div className="capture-bar" data-testid="capture-summary">
            <div className="capture-totals">
              <strong>{st.drafts.length} draft{st.drafts.length === 1 ? '' : 's'}</strong>
              {totals.out > 0 && <span>{formatCents(totals.out, cur)} out</span>}
              {totals.in > 0 && <span className="pos">{formatCents(totals.in, cur)} in</span>}
              {totals.moved > 0 && <span>{formatCents(totals.moved, cur)} moved between accounts</span>}
              {attention > 0 && <span className="warn"><AlertTriangle size={13} aria-hidden /> {attention} need{attention === 1 ? 's' : ''} attention</span>}
            </div>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => captureStore.set({ drafts: [], notUnderstood: [], error: null })}>Discard all</button>
            <button className="btn btn-primary" disabled={ready.length === 0 || saving || demo} aria-busy={saving} onClick={() => void approve(ready.map((d) => d.id))} data-testid="approve-all">
              {saving ? <Spinner /> : <Check size={15} />} {ready.length === st.drafts.length ? `Approve all ${ready.length}` : `Approve ${ready.length} ready`}
            </button>
          </div>
          {demo && <p className="hint">Sample data: approving is turned off in demo mode.</p>}
          <p className="hint capture-note">Drafts don’t change your balances, budget or Safe to Spend until you approve them.</p>
          <div className="capture-list stagger">
            {st.drafts.map((d) => (
              <DraftCard key={d.id} d={d} issues={reviews.get(d.id)!} data={data} cur={cur} saving={saving || demo}
                onChange={(p) => update(d.id, p)} onRemove={() => remove(d.id)} onApprove={() => void approve([d.id])} />
            ))}
          </div>
        </>
      )}

      {st.saved > 0 && st.drafts.length === 0 && (
        <div className="capture-done" role="status">
          <Check size={16} aria-hidden /> Saved {st.saved} transaction{st.saved === 1 ? '' : 's'} from Capture. <Link to="/transactions">View transactions <ArrowRight size={13} /></Link>
        </div>
      )}
    </div>
  );
}

function DraftCard({ d, issues, data, cur, saving, onChange, onRemove, onApprove }: {
  d: CaptureDraft; issues: Issue[]; data: WorkspaceData; cur: string; saving: boolean;
  onChange: (p: Partial<CaptureDraft>) => void; onRemove: () => void; onApprove: () => void;
}) {
  const [amountText, setAmountText] = useState(d.amountCents === null ? '' : centsToDecimalString(d.amountCents));
  const blocking = issues.filter((i) => i.blocking);
  const notes = issues.filter((i) => !i.blocking);
  const accounts = data.accounts.filter((a) => !a.archived);
  const has = (field: Issue['field']) => blocking.some((i) => i.field === field);
  const label = d.merchant || KIND_LABEL[d.kind];
  const ack = (code: Issue['code']) => onChange({ acknowledged: [...d.acknowledged, code] });

  return (
    <article className={`draft ${blocking.length ? 'needs' : 'ready'}`} aria-label={`Draft: ${label}`} data-testid="draft">
      <header className="draft-head">
        <select className="draft-kind" aria-label="Type" value={d.kind} onChange={(e) => {
          const kind = e.target.value as DraftKind;
          onChange({ kind, kindUnclear: false, role: kind === 'transfer' ? d.role ?? 'transfer' : null, categoryId: kind === 'transfer' ? null : d.categoryId, splits: kind === 'expense' ? d.splits : [] });
        }}>
          {(Object.keys(KIND_LABEL) as DraftKind[]).map((k) => <option key={k} value={k}>{d.role === 'card_payment' && k === 'transfer' ? 'Card payment' : KIND_LABEL[k]}</option>)}
        </select>
        <span className={`draft-status ${blocking.length ? 'warn' : 'pos'}`}>{blocking.length ? <><AlertTriangle size={13} /> Needs attention</> : <><Check size={13} /> Ready</>}</span>
        <span className="spacer" />
        <button className="icon-btn" aria-label={`Remove draft ${label}`} onClick={onRemove}><Trash2 size={16} /></button>
      </header>
      <blockquote className="draft-source">“{d.sourceText}”</blockquote>

      <div className="draft-grid">
        {d.kind !== 'transfer' && (
          <Cell label={d.kind === 'income' ? 'From' : 'Merchant'} hint={d.merchant ? SOURCE_LABEL[d.merchantSource ?? ''] : undefined} invalid={has('merchant')}>
            {(id) => <input id={id} className="input" value={d.merchant} onChange={(e) => onChange({ merchant: e.target.value, merchantSource: 'words' })} aria-invalid={has('merchant')} />}
          </Cell>
        )}
        <Cell label="Amount" hint={d.approximate && !d.acknowledged.includes('amount_approx') ? 'approximate' : undefined} invalid={has('amount') || has('currency')}>
          {(id) => <AmountInput id={id} value={amountText} currency={cur} aria-invalid={has('amount')} onChange={(v) => {
            setAmountText(v);
            const c = parseAmountInput(v, cur);
            onChange({ amountCents: c !== null && c > 0 ? c : null, approximate: false, currency: cur });
          }} />}
        </Cell>
        <Cell label="Date" hint={d.date ? SOURCE_LABEL[d.dateSource ?? ''] : undefined} invalid={has('date')}>
          {(id) => <input id={id} className="input" type="date" value={d.date ?? ''} aria-invalid={has('date')} onChange={(e) => onChange({ date: e.target.value || null, dateSource: 'words', dateAmbiguous: false, dateText: null })} />}
        </Cell>
        {d.kind !== 'transfer' && d.splits.length === 0 && (
          <Cell label="Category" hint={d.categoryId ? SOURCE_LABEL[d.categorySource ?? ''] : undefined}>
            {(id) => <CategorySelect id={id} value={d.categoryId} kind={d.kind === 'income' ? 'income' : 'expense'} onChange={(v) => onChange({ categoryId: v, categorySource: 'words', categoryWords: null })} />}
          </Cell>
        )}
        <Cell label={d.kind === 'transfer' ? 'From account' : 'Account'} hint={d.accountId ? SOURCE_LABEL[d.accountSource ?? ''] : undefined} invalid={has('account')}>
          {(id) => (
            <select id={id} className="select" value={d.accountId ?? ''} aria-invalid={has('account')} onChange={(e) => onChange({ accountId: e.target.value || null, accountSource: 'words', accountWords: null })}>
              <option value="">Choose…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </Cell>
        {d.kind === 'transfer' && (
          <Cell label={d.role === 'card_payment' ? 'Card paid' : 'To account'} invalid={has('toAccount')}>
            {(id) => (
              <select id={id} className="select" value={d.toAccountId ?? ''} aria-invalid={has('toAccount')} onChange={(e) => onChange({ toAccountId: e.target.value || null, toAccountWords: null })}>
                <option value="">Choose…</option>
                {accounts.filter((a) => a.id !== d.accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </Cell>
        )}
      </div>

      {d.splits.length > 0 && (
        <div className="draft-splits" role="group" aria-label="Split into categories">
          <div className="t-footnote muted">Split into {d.splits.length} categories (one transaction)</div>
          {d.splits.map((s, i) => (
            <div key={i} className="split-line">
              <span className="split-label">{s.label || `Part ${i + 1}`}</span>
              <span className="num">{formatCents(s.amountCents, cur)}</span>
              <CategorySelect value={s.categoryId} kind="expense" onChange={(v) => onChange({ splits: d.splits.map((x, j) => (j === i ? { ...x, categoryId: v } : x)) })} />
            </div>
          ))}
        </div>
      )}

      {(blocking.length > 0 || notes.length > 0) && (
        <ul className="draft-issues">
          {blocking.map((i) => (
            <li key={i.code} className="blocking">
              <AlertTriangle size={14} aria-hidden /> <span className="grow">{i.message}</span>
              {i.confirmable && <button className="btn btn-secondary btn-sm" onClick={() => ack(i.code)}>{i.code === 'duplicate' ? 'Keep it' : 'Confirm'}</button>}
            </li>
          ))}
          {notes.map((i) => <li key={i.code} className="note"><Info size={14} aria-hidden /> <span className="grow">{i.message}</span></li>)}
        </ul>
      )}

      <footer className="draft-foot">
        <button className="btn btn-secondary btn-sm" disabled={blocking.length > 0 || saving} onClick={onApprove}>
          <Check size={14} /> Approve
        </button>
      </footer>
    </article>
  );
}

function Cell({ label, hint, invalid, children }: { label: string; hint?: string | undefined; invalid?: boolean; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={`draft-cell ${invalid ? 'invalid' : ''}`}>
      <label htmlFor={id}>{label}{hint && <span className="draft-hint"> · {hint}</span>}</label>
      {children(id)}
    </div>
  );
}

/** Compact entry point for Home. */
export function CaptureLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="capture-launch" onClick={onOpen} data-testid="capture-launch">
      <span className="capture-launch-ico"><Sparkles size={16} aria-hidden /></span>
      <span className="grow">
        <span className="t">Clarity Capture</span>
        <span className="s">Tell Clarity what you spent. We’ll organize it for you.</span>
      </span>
      <Plus size={16} aria-hidden className="faint" />
    </button>
  );
}

