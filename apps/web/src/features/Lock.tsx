import { Lock as LockIcon } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../state/session';
import { Field } from '../ui/Field';
import { Dialog } from '../ui/Dialog';

export function LockScreen() {
  const session = useSession();
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(false);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await session.unlock(mode === 'passphrase' ? { passphrase: secret } : { recoveryKey: secret });
    } catch (e) {
      setError((e as Error).message);
      setSecret('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="center-screen">
      <form className="panel" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
        <div className="row" style={{ marginBottom: 20 }}>
          <img src="/favicon.svg" alt="" width={36} height={36} style={{ borderRadius: 10 }} />
          <LockIcon size={16} className="faint" />
        </div>
        <h1 className="t-title1">Welcome back</h1>
        <p className="muted t-callout">Your data is encrypted on this device. Enter your {mode === 'passphrase' ? 'passphrase' : 'recovery key'} to unlock it.</p>
        <Field label={mode === 'passphrase' ? 'Passphrase' : 'Recovery key'} error={error}>
          {(id) => <input id={id} className="input" type={mode === 'passphrase' ? 'password' : 'text'} value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus autoComplete={mode === 'passphrase' ? 'current-password' : 'off'} aria-invalid={!!error} />}
        </Field>
        <div className="row between" style={{ marginTop: 20 }}>
          <button type="button" className="btn-link" onClick={() => { setMode(mode === 'passphrase' ? 'recovery' : 'passphrase'); setSecret(''); setError(null); }}>
            {mode === 'passphrase' ? 'Use recovery key instead' : 'Use passphrase instead'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!secret || busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
        </div>
        <button type="button" className="btn-link" style={{ marginTop: 18, color: 'var(--c-text-tertiary)' }} onClick={() => setLost(true)}>Lost both?</button>
      </form>
      {lost && <LostBoth onClose={() => setLost(false)} />}
    </div>
  );
}

export function DeleteEverything({ onClose, onDone, title = 'Delete all data on this device' }: { onClose: () => void; onDone: () => void; title?: string }) {
  const session = useSession();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={typed !== 'DELETE' || busy} onClick={async () => { setBusy(true); await session.wipe(); onDone(); }}>
            Delete permanently
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="t-callout" style={{ margin: 0 }}>This destroys the encryption keys stored on this device and then deletes the database. The remaining data cannot be decrypted by anyone. Backup files you saved elsewhere are not affected.</p>
        <Field label="Type DELETE to confirm">{(id) => <input id={id} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}</Field>
      </div>
    </Dialog>
  );
}

function LostBoth({ onClose }: { onClose: () => void }) {
  const [del, setDel] = useState(false);
  if (del) return <DeleteEverything onClose={onClose} onDone={onClose} title="Start over" />;
  return (
    <Dialog title="If you lost your passphrase and recovery key" onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Back</button><button className="btn btn-secondary" onClick={() => setDel(true)}>Delete data and start over</button></>}>
      <p className="t-callout" style={{ marginTop: 0 }}>Your data is encrypted with keys only you hold. Without the passphrase or the recovery key, no one — including us — can unlock it. There is no reset email because there is no account.</p>
      <p className="t-callout">If you have a <strong>backup file</strong> and remember the passphrase you used when you made it, delete this data and choose “Restore a backup”.</p>
    </Dialog>
  );
}
