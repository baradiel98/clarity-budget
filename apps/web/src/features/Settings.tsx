import { Archive, ArchiveRestore, Download, KeyRound, Pencil, Plus, RefreshCw, Scale, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adjustBalance, createAccount, createCategory, exportTransactionsCsv, updateAccount, updateCategory, updateSettings, WorkspaceStore } from '@clarity/data';
import { accountBalance } from '@clarity/engine';
import { BACKUP_EXTENSION } from '@clarity/security';
import { centsToDecimalString, NO_SYNC_NOTICE, parseAmountInput, TERMS, type Account, type AccountType } from '@clarity/shared';
import { useRouter } from '../lib/router';
import { downloadText, pickFile, stamp } from '../platform/files';
import { useData, useRun, useSession, useStore } from '../state/session';
import { AmountInput } from '../ui/AmountInput';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { CategoryIcon, CATEGORY_ICON_NAMES } from '../ui/icons';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';
import { useToast } from '../ui/Toast';
import { ImportHistory } from './Import';
import { DeleteEverything } from './Lock';
import { PassphraseFields, passphraseValid } from './Passphrase';
import { RecoveryKeyStep } from './RecoveryKey';

const SECTIONS = [
  ['accounts', 'Accounts'], ['categories', 'Categories'], ['preferences', 'Preferences'], ['security', 'Security'],
  ['backup', 'Backup & export'], ['imports', 'Import history'], ['data', 'Privacy & data'],
] as const;

const TYPE_LABEL: Record<AccountType, string> = { checking: 'Checking', savings: 'Savings', cash: 'Cash', credit_card: 'Credit card' };

export function Settings() {
  const data = useData();
  const { today } = useSession();
  const { navigate } = useRouter();
  const { demo } = useStore();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const [dialog, setDialog] = useState<null | { kind: 'account'; account?: Account } | { kind: 'balance'; account: Account } | { kind: 'category' } | { kind: 'passphrase' } | { kind: 'recovery'; key?: string } | { kind: 'restore' } | { kind: 'csv' } | { kind: 'delete' }>(null);
  const [reserve, setReserve] = useState(centsToDecimalString(data.settings.minReserveCents));

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="t-title1">{TERMS.tabs.settings}</h1>
          <div className="sub muted t-callout">{NO_SYNC_NOTICE}</div>
        </div>
      </div>
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => <a key={id} className="nav-item" href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }}>{label}</a>)}
        </nav>
        <div className="stack">
          <section className="card" id="accounts">
            <div className="card-head"><h2 className="t-title2">Accounts</h2><button className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'account' })}><Plus size={14} /> Add account</button></div>
            <div className="list">
              {data.accounts.map((a) => {
                const bal = accountBalance(a, data.transactions, today);
                return (
                  <div key={a.id} className="kv">
                    <div>
                      <div style={{ fontWeight: 500 }}>{a.name} {a.archived && <span className="badge">Archived</span>} {data.settings.defaultAccountId === a.id && <span className="badge accent">Default</span>}</div>
                      <div className="hint">{TYPE_LABEL[a.type]}{a.type !== 'credit_card' ? (a.spendable ? ' · counts as available cash' : ' · not counted as available cash') : ''}</div>
                    </div>
                    <div className="row">
                      <span className="num" style={{ fontWeight: 600 }}>{a.type === 'credit_card' ? <>Owed <Money cents={-bal} currency={cur} /></> : <Money cents={bal} currency={cur} />}</span>
                      <button className="icon-btn" title="Update balance" aria-label={`Update balance of ${a.name}`} onClick={() => setDialog({ kind: 'balance', account: a })}><Scale size={15} /></button>
                      <button className="icon-btn" aria-label={`Edit ${a.name}`} onClick={() => setDialog({ kind: 'account', account: a })}><Pencil size={15} /></button>
                      <button className="icon-btn" aria-label={a.archived ? `Restore ${a.name}` : `Archive ${a.name}`} onClick={() => void run((ctx) => updateAccount(ctx, a.id, { archived: !a.archived }))}>{a.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card" id="categories">
            <div className="card-head"><h2 className="t-title2">Categories</h2><button className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'category' })}><Plus size={14} /> Add category</button></div>
            <div className="row wrap" style={{ gap: 8 }}>
              {data.categories.map((c) => (
                <span key={c.id} className={`badge ${c.archived ? '' : 'accent'}`} style={{ height: 30, paddingRight: 4 }}>
                  <CategoryIcon name={c.icon} size={14} /> {c.name}
                  <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label={`Rename ${c.name}`} onClick={() => { const n = window.prompt('Rename category', c.name); if (n) void run((ctx) => updateCategory(ctx, c.id, { name: n })); }}><Pencil size={12} /></button>
                  <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label={c.archived ? `Restore ${c.name}` : `Archive ${c.name}`} onClick={() => void run((ctx) => updateCategory(ctx, c.id, { archived: !c.archived }))}>{c.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}</button>
                </span>
              ))}
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>Archived categories stay on past transactions but are hidden when adding new ones.</p>
          </section>

          <section className="card" id="preferences">
            <h2 className="t-title2" style={{ marginBottom: 12 }}>Preferences</h2>
            <div className="form-grid">
              <Field label={TERMS.minReserve} hint="Safe to Spend keeps this much aside. It's never counted as spendable.">
                {(id) => <AmountInput id={id} value={reserve} onChange={setReserve} currency={cur} onBlur={() => { const c = parseAmountInput(reserve, cur); if (c !== null) void run((ctx) => updateSettings(ctx, { minReserveCents: c })); }} />}
              </Field>
              <Field label="Default account for new transactions">
                {(id) => (
                  <select id={id} className="select" value={data.settings.defaultAccountId ?? ''} onChange={(e) => void run((ctx) => updateSettings(ctx, { defaultAccountId: e.target.value || null }))}>
                    {data.accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Appearance">{() => <Segmented label="Theme" value={data.settings.theme} onChange={(v) => void run((ctx) => updateSettings(ctx, { theme: v }))} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />}</Field>
              <Field label="Lock automatically after">
                {(id) => (
                  <select id={id} className="select" value={data.settings.autoLockMinutes} onChange={(e) => void run((ctx) => updateSettings(ctx, { autoLockMinutes: Number(e.target.value) }))}>
                    {[1, 5, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} minute{m > 1 ? 's' : ''} of inactivity</option>)}
                  </select>
                )}
              </Field>
            </div>
          </section>

          <section className="card" id="security">
            <h2 className="t-title2" style={{ marginBottom: 4 }}>Security</h2>
            <div className="kv"><div><div style={{ fontWeight: 500 }}>Passphrase</div><div className="hint">Changing it does not re-encrypt your data; it re-protects the key.</div></div><button className="btn btn-secondary btn-sm" disabled={demo} onClick={() => setDialog({ kind: 'passphrase' })}><KeyRound size={14} /> Change</button></div>
            <RecoveryRow disabled={demo} onShow={(key) => setDialog({ kind: 'recovery', key })} />
          </section>

          <section className="card" id="backup">
            <h2 className="t-title2" style={{ marginBottom: 4 }}>Backup & export</h2>
            <BackupRow disabled={demo} />
            <div className="kv"><div><div style={{ fontWeight: 500 }}>Restore a backup</div><div className="hint">Replaces everything on this device with the backup's contents.</div></div><button className="btn btn-secondary btn-sm" disabled={demo} onClick={() => setDialog({ kind: 'restore' })}><Upload size={14} /> Restore</button></div>
            <div className="kv"><div><div style={{ fontWeight: 500 }}>Export transactions as CSV</div><div className="hint">Readable in any spreadsheet. Not encrypted.</div></div><button className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'csv' })}><Download size={14} /> Export CSV</button></div>
          </section>

          <section className="card" id="imports">
            <h2 className="t-title2">Import history</h2>
            {data.importBatches.length ? <ImportHistory /> : <p className="t-callout muted">No statements imported yet.</p>}
          </section>

          <section className="card" id="data">
            <h2 className="t-title2" style={{ marginBottom: 4 }}>Privacy & data</h2>
            <div className="kv"><div><div style={{ fontWeight: 500 }}>{TERMS.privacyCenter}</div><div className="hint">What is stored, where, and how it is protected.</div></div><button className="btn btn-secondary btn-sm" onClick={() => navigate('/privacy')}><ShieldCheck size={14} /> Open</button></div>
            <div className="kv"><div><div style={{ fontWeight: 500 }}>Diagnostics</div><div className="hint">Checks that calculations and encryption on this browser match the reference results.</div></div><button className="btn btn-secondary btn-sm" onClick={() => navigate('/dev/self-test')}><RefreshCw size={14} /> Run self-test</button></div>
            <div className="kv"><div><div style={{ fontWeight: 500 }} className="neg">Delete all data</div><div className="hint">Permanently removes everything on this device.</div></div><button className="btn btn-danger btn-sm" disabled={demo} onClick={() => setDialog({ kind: 'delete' })}><Trash2 size={14} /> Delete</button></div>
          </section>
        </div>
      </div>

      {dialog?.kind === 'account' && <AccountDialog account={dialog.account} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'balance' && <BalanceDialog account={dialog.account} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'category' && <CategoryDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'passphrase' && <PassphraseDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'recovery' && dialog.key && <Dialog title="New recovery key" onClose={() => setDialog(null)}><RecoveryKeyStep recoveryKey={dialog.key} inDialog onDone={() => setDialog(null)} /></Dialog>}
      {dialog?.kind === 'restore' && <RestoreDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'csv' && <CsvDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && <DeleteEverything onClose={() => setDialog(null)} onDone={() => setDialog(null)} />}
    </div>
  );
}

function RecoveryRow({ onShow, disabled }: { onShow: (key: string) => void; disabled: boolean }) {
  const { store } = useStore();
  const toast = useToast();
  const [has, setHas] = useState(store.hasRecoveryKey);
  return (
    <div className="kv">
      <div>
        <div style={{ fontWeight: 500 }}>Recovery key {has ? <span className="badge pos">Set up</span> : <span className="badge warn">Not set up</span>}</div>
        <div className="hint">{has ? 'Creating a new one makes the old key stop working.' : 'Without one, a forgotten passphrase means your data cannot be recovered.'}</div>
      </div>
      <div className="row">
        {has && <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={async () => { if (!window.confirm('Remove the recovery key? Only your passphrase will unlock your data.')) return; await store.removeRecoveryKey(); setHas(false); toast({ message: 'Recovery key removed' }); }}>Remove</button>}
        <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={async () => { const k = await store.regenerateRecoveryKey(); setHas(true); onShow(k); }}>{has ? 'Create new key' : 'Create key'}</button>
      </div>
    </div>
  );
}

function BackupRow({ disabled }: { disabled: boolean }) {
  const data = useData();
  const { store } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="kv">
      <div>
        <div style={{ fontWeight: 500 }}>Encrypted backup</div>
        <div className="hint">
          {data.settings.lastBackupAt ? `Last backup ${new Date(data.settings.lastBackupAt).toLocaleString()}.` : 'No backup yet.'} Restores on this browser, another computer, or the Clarity app on iPhone and Android, with your passphrase or recovery key.
        </div>
      </div>
      <button className="btn btn-primary btn-sm" disabled={disabled || busy} data-testid="backup-btn" onClick={async () => {
        setBusy(true);
        const text = await store.exportBackup('web');
        downloadText(`clarity-${stamp()}${BACKUP_EXTENSION}`, text, 'application/json');
        setBusy(false);
        toast({ message: 'Encrypted backup saved to your downloads' });
      }}>
        <Download size={14} /> Download backup
      </button>
    </div>
  );
}

function AccountDialog({ account, onClose }: { account?: Account; onClose: () => void }) {
  const data = useData();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [balance, setBalance] = useState('');
  const [spendable, setSpendable] = useState(account?.spendable ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    const cents = parseAmountInput(balance || '0', cur);
    if (!account && cents === null) return setErrors({ balance: 'Enter a valid balance.' });
    const r = await run((ctx) => (account ? updateAccount(ctx, account.id, { name, ...(type !== 'credit_card' ? { spendable } : {}) }) : createAccount(ctx, { name, type, currentBalanceCents: cents!, spendable: type === 'credit_card' ? false : spendable })));
    if (!r.ok) setErrors(Object.fromEntries(r.errors.map((e) => [e.field, e.message])));
    else onClose();
  };
  return (
    <Dialog title={account ? `Edit ${account.name}` : 'Add account'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => void save()}>Save</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Name" error={errors.name}>{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        {!account && <Field label="Type">{() => <Segmented label="Account type" value={type} onChange={(t) => { setType(t); setSpendable(t === 'checking' || t === 'cash'); }} options={[{ value: 'checking', label: 'Checking' }, { value: 'savings', label: 'Savings' }, { value: 'cash', label: 'Cash' }, { value: 'credit_card', label: 'Credit card' }]} block />}</Field>}
        {!account && <Field label={type === 'credit_card' ? 'Amount owed today' : 'Balance today'} error={errors.balance}>{(id) => <AmountInput id={id} value={balance} onChange={setBalance} currency={cur} />}</Field>}
        {type !== 'credit_card' && (
          <label className="check"><input type="checkbox" checked={spendable} onChange={(e) => setSpendable(e.target.checked)} /><span>Count toward available cash and Safe to Spend<br /><span className="hint">Turn off for savings you don't want to spend from.</span></span></label>
        )}
        {type === 'credit_card' && <div className="callout">Card purchases are tracked as spending when they happen. Paying the card is a transfer, so it's never counted twice. Schedule a card payment in Planning so Safe to Spend accounts for it.</div>}
      </form>
    </Dialog>
  );
}

function BalanceDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const data = useData();
  const { today } = useSession();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const current = accountBalance(account, data.transactions, today);
  const isCard = account.type === 'credit_card';
  const [value, setValue] = useState(centsToDecimalString(isCard ? -current : current));
  const [reason, setReason] = useState('Matched balance in bank app');
  const [error, setError] = useState<string | null>(null);
  const cents = parseAmountInput(value, cur);
  const diff = cents === null ? null : (isCard ? -cents : cents) - current;
  const save = async () => {
    if (cents === null) return setError('Enter a valid amount.');
    const r = await run((ctx) => adjustBalance(ctx, account.id, cents, reason), { undoLabel: 'Balance update' });
    if (!r.ok) setError(r.errors[0]?.message ?? 'Could not update');
    else onClose();
  };
  return (
    <Dialog title={`Update ${account.name} balance`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!diff} onClick={() => void save()}>Record adjustment</button></>}>
      <div className="stack">
        <p className="t-callout muted" style={{ margin: 0 }}>Clarity shows <Money cents={isCard ? -current : current} currency={cur} />{isCard ? ' owed' : ''}. Enter what your bank shows now. The difference is recorded as an adjustment with your reason — history isn't changed.</p>
        <Field label={isCard ? 'Amount owed per bank' : 'Balance per bank'} error={error}>{(id) => <AmountInput id={id} value={value} onChange={setValue} currency={cur} autoFocus />}</Field>
        <Field label="Reason">{(id) => <input id={id} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {diff !== null && diff !== 0 && <div className="callout">Adjustment: <Money cents={diff} currency={cur} sign="always" /></div>}
      </div>
    </Dialog>
  );
}

function CategoryDialog({ onClose }: { onClose: () => void }) {
  const run = useRun();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [icon, setIcon] = useState('tag');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const r = await run((ctx) => createCategory(ctx, { name, kind, icon }));
    if (!r.ok) setError(r.errors[0]?.message ?? '');
    else onClose();
  };
  return (
    <Dialog title="Add category" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => void save()}>Add</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Name" error={error}>{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }]} />
        <div className="field">
          <span className="label">Icon</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {CATEGORY_ICON_NAMES.map((n) => (
              <button key={n} type="button" className="cat-icon" aria-pressed={icon === n} aria-label={n} style={{ border: icon === n ? '2px solid var(--c-accent)' : '2px solid transparent', cursor: 'pointer' }} onClick={() => setIcon(n)}><CategoryIcon name={n} size={16} /></button>
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function PassphraseDialog({ onClose }: { onClose: () => void }) {
  const { store } = useStore();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setShow(true);
    if (!passphraseValid(pass, confirm)) return;
    setBusy(true);
    try {
      await store.changePassphrase(current, pass);
      toast({ message: 'Passphrase changed. Backups made before today still need the old passphrase or your recovery key.' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Change passphrase" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Change passphrase'}</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Current passphrase" error={error}>{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />}</Field>
        <PassphraseFields pass={pass} confirm={confirm} setPass={setPass} setConfirm={setConfirm} showErrors={show} />
      </form>
    </Dialog>
  );
}

function RestoreDialog({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const [file, setFile] = useState<{ name: string; text: string; info: ReturnType<typeof WorkspaceStore.inspectBackup> } | null>(null);
  const [secret, setSecret] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Restore a backup" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={!file || !secret || busy} onClick={async () => { setBusy(true); setError(null); try { await session.restore(file!.text, useRecovery ? { recoveryKey: secret } : { passphrase: secret }); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Replace data on this device</button></>}>
      <div className="stack">
        <div className="callout warn">Everything currently on this device is replaced by the backup. Make a backup of the current data first if you might need it.</div>
        {file ? (
          <div className="callout"><strong>{file.name}</strong><br />Made {new Date(file.info.createdAt).toLocaleString()} on {file.info.appPlatform}</div>
        ) : (
          <button className="btn btn-secondary" onClick={async () => { const f = await pickFile('.claritybackup,application/json'); if (!f) return; try { const text = await f.text(); setFile({ name: f.name, text, info: WorkspaceStore.inspectBackup(text) }); } catch (e) { setError((e as Error).message); } }}><Upload size={14} /> Choose backup file</button>
        )}
        {file && (
          <>
            <label className="check"><input type="checkbox" checked={useRecovery} onChange={(e) => setUseRecovery(e.target.checked)} /> Use recovery key instead of passphrase</label>
            <Field label={useRecovery ? 'Recovery key' : 'Passphrase at the time of the backup'} error={error}>{(id) => <input id={id} className="input" type={useRecovery ? 'text' : 'password'} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />}</Field>
          </>
        )}
        {!file && error && <div className="error-text">{error}</div>}
      </div>
    </Dialog>
  );
}

function CsvDialog({ onClose }: { onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  return (
    <Dialog title="Export unencrypted CSV" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => { downloadText(`clarity-transactions-${stamp()}.csv`, exportTransactionsCsv(data), 'text/csv'); toast({ message: 'CSV saved to your downloads' }); onClose(); }}>I understand, export</button></>}>
      <p className="t-callout" style={{ marginTop: 0 }}><strong>This file is not encrypted.</strong> Anyone who opens it can read every transaction, amount and note. Store it somewhere private and delete it when you're done.</p>
      <p className="t-callout muted">For moving your data to another device, use an <strong>encrypted backup</strong> instead.</p>
    </Dialog>
  );
}
