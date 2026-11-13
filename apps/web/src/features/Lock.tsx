import { AlertCircle, ArrowLeft, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSession } from '../state/session';
import { Field } from '../ui/Field';
import { Dialog } from '../ui/Dialog';

type View = 'passphrase' | 'recovery' | 'help';

/**
 * Unlock screen. Always dark: it is the brand moment people see every time they open Clarity,
 * and the user's theme preference is inside the encrypted data, so it cannot be read yet.
 * Behavior is unchanged from before the redesign: session.unlock() does all the cryptography.
 */
export function LockScreen() {
  const session = useSession();
  const [view, setView] = useState<View>('passphrase');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const [shake, setShake] = useState(0);
  const [hasRecovery, setHasRecovery] = useState<boolean | null>(null);
  const [erase, setErase] = useState(false);
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const ids = { title: useId(), desc: useId(), field: useId(), err: useId(), caps: useId() };

  useForcedDark();

  useEffect(() => {
    let live = true;
    session.recoveryKeyAvailable().then((v) => live && setHasRecovery(v)).catch(() => live && setHasRecovery(null));
    return () => { live = false; };
  }, [session]);

  const go = (v: View) => {
    setView(v);
    setSecret('');
    setError(null);
    setShown(false);
    if (v !== 'help') setTimeout(() => input.current?.focus(), 0);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return; // one attempt at a time (Enter can repeat)
    if (!secret.trim()) {
      // Keep a real error (e.g. wrong passphrase) visible if Enter is pressed again on the cleared field.
      if (!error) setError(view === 'passphrase' ? 'Enter your passphrase to unlock.' : 'Enter your recovery key to unlock.');
      setShake((n) => n + 1);
      input.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await session.unlock(view === 'passphrase' ? { passphrase: secret } : { recoveryKey: secret });
    } catch (err) {
      setError((err as Error).message);
      setSecret('');
      setShake((n) => n + 1);
      setTimeout(() => input.current?.focus(), 0);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);
  const isPass = view === 'passphrase';
  const describedBy = [ids.desc, error ? ids.err : null, caps && isPass ? ids.caps : null].filter(Boolean).join(' ');

  return (
    <main className="auth">
      <div className="auth-col">
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width={40} height={40} />
          <span>Clarity</span>
        </div>

        <section className="auth-panel" aria-labelledby={ids.title} key={view}>
          {view === 'help' ? (
            <HelpView titleId={ids.title} hasRecovery={hasRecovery} onRecovery={() => go('recovery')} onBack={() => go('passphrase')} onErase={() => setErase(true)} />
          ) : (
            <form onSubmit={submit} noValidate aria-busy={busy}>
              <h1 className="auth-title" id={ids.title}>{isPass ? 'Unlock Clarity' : 'Use your recovery key'}</h1>
              <p className="auth-sub" id={ids.desc}>
                {isPass
                  ? 'Your financial world, securely stored on this device.'
                  : 'Enter the recovery key you saved when you set up Clarity. Dashes and capital letters are optional.'}
              </p>

              <label className="auth-label" htmlFor={ids.field}>{isPass ? 'Passphrase' : 'Recovery key'}</label>
              <div className={`auth-input ${error ? 'invalid' : ''}`} data-shake={shake ? (shake % 2 ? 'a' : 'b') : undefined}>
                <input
                  ref={input}
                  id={ids.field}
                  type={isPass && !shown ? 'password' : 'text'}
                  className={isPass ? '' : 'mono'}
                  value={secret}
                  onChange={(e) => { setSecret(e.target.value); if (error) setError(null); }}
                  onKeyDown={onKey}
                  onKeyUp={onKey}
                  readOnly={busy}
                  autoFocus
                  autoComplete={isPass ? 'current-password' : 'off'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={isPass ? undefined : 'XXXX-XXXX-XXXX-…'}
                  aria-invalid={!!error}
                  aria-describedby={describedBy}
                />
                {isPass && (
                  <button type="button" className="auth-eye" onClick={() => { setShown((v) => !v); input.current?.focus(); }} aria-label={shown ? 'Hide passphrase' : 'Show passphrase'} aria-pressed={shown} aria-controls={ids.field}>
                    {shown ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                )}
              </div>
              <div className="auth-msgs" aria-live="polite">
                {error && <p className="auth-error" id={ids.err} role="alert"><AlertCircle size={15} aria-hidden /> {error}</p>}
                {!error && caps && isPass && <p className="auth-caps" id={ids.caps}>Caps Lock is on</p>}
              </div>

              <button type="submit" className="auth-primary" disabled={busy}>
                {busy ? <><span className="auth-spinner" aria-hidden /> Unlocking…</> : 'Unlock'}
              </button>

              <div className="auth-secondary">
                {isPass ? (
                  hasRecovery !== false && <button type="button" className="auth-link" onClick={() => go('recovery')} disabled={busy}><KeyRound size={15} aria-hidden /> Use recovery key instead</button>
                ) : (
                  <button type="button" className="auth-link" onClick={() => go('passphrase')} disabled={busy}><ArrowLeft size={15} aria-hidden /> Use passphrase instead</button>
                )}
              </div>
              <div className="auth-rule" />
              <button type="button" className="auth-help" onClick={() => go('help')} disabled={busy}>Forgot your passphrase?</button>
            </form>
          )}
        </section>

        <p className="auth-foot"><ShieldCheck size={14} aria-hidden /> Encrypted on this device. No account, no server.</p>
      </div>
      {erase && <DeleteEverything onClose={() => setErase(false)} onDone={() => setErase(false)} title="Erase data on this device" />}
    </main>
  );
}

function HelpView({ titleId, hasRecovery, onRecovery, onBack, onErase }: { titleId: string; hasRecovery: boolean | null; onRecovery: () => void; onBack: () => void; onErase: () => void }) {
  return (
    <div className="auth-help-view">
      <h1 className="auth-title" id={titleId}>Can't unlock Clarity?</h1>
      <p className="auth-sub">Clarity has no account and keeps no copy of your data or keys on a server, so there is no password reset. Here is what you can do.</p>

      <div className="auth-steps">
        <section>
          <h2>Forgot your passphrase</h2>
          {hasRecovery === false ? (
            <p>No recovery key was set up for the data on this device, so only the passphrase can unlock it.</p>
          ) : (
            <>
              <p>Unlock with the recovery key you saved during setup.</p>
              <button type="button" className="auth-link" onClick={onRecovery}><KeyRound size={15} aria-hidden /> Use recovery key</button>
            </>
          )}
        </section>
        <section>
          <h2>Have a backup file?</h2>
          <p>Erase the data on this device, then choose <strong>Restore a backup</strong>. You'll need the passphrase or recovery key that was in use when the backup was made.</p>
        </section>
        <section>
          <h2>Lost your passphrase and recovery key</h2>
          <p>The data on this device can't be decrypted by you, by us, or by anyone. The only option is to erase it and start over. This can't be undone.</p>
        </section>
      </div>

      <button type="button" className="auth-danger" onClick={onErase}>Erase data on this device…</button>
      <button type="button" className="auth-link auth-back" onClick={onBack}><ArrowLeft size={15} aria-hidden /> Back to unlock</button>
    </div>
  );
}

/** Dark theme while the lock screen is shown (page, dialogs and browser chrome); restores the previous state after. */
function useForcedDark() {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = 'dark';
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    const prevColors = metas.map((m) => m.content);
    metas.forEach((m) => { m.content = '#070B14'; });
    return () => {
      if (prev === undefined) delete root.dataset.theme;
      else root.dataset.theme = prev;
      metas.forEach((m, i) => { m.content = prevColors[i]!; });
    };
  }, []);
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
