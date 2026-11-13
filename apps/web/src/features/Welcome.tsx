import { HardDrive, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import { useState } from 'react';
import { WorkspaceStore } from '@clarity/data';
import { NO_SYNC_NOTICE } from '@clarity/shared';
import { useSession } from '../state/session';
import { pickFile } from '../platform/files';
import { Field } from '../ui/Field';
import { PassphraseFields, passphraseValid } from './Passphrase';

type Step = 'welcome' | 'passphrase' | 'restore';

export function Welcome() {
  const session = useSession();
  const [step, setStep] = useState<Step>('welcome');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [withRecovery, setWithRecovery] = useState(true);
  const [ackNoRecovery, setAckNoRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === 'restore') return <Restore onBack={() => setStep('welcome')} />;

  if (step === 'passphrase') {
    const create = async () => {
      setShowErrors(true);
      if (!passphraseValid(pass, confirm) || (!withRecovery && !ackNoRecovery)) return;
      setBusy(true);
      setError(null);
      try {
        // On success the session switches to the unlocked app, which continues onboarding.
        await session.createVault(pass, withRecovery);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="center-screen">
        <form className="panel" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <div className="steps" aria-hidden><span className="on" /><span /><span /><span /><span /></div>
          <h1 className="t-title1">Create your passphrase</h1>
          <p className="muted t-callout">It encrypts your data on this device. We never see it and can't reset it.</p>
          <PassphraseFields pass={pass} confirm={confirm} setPass={setPass} setConfirm={setConfirm} showErrors={showErrors} />
          <div className="stack" style={{ marginTop: 20 }}>
            <label className="check">
              <input type="checkbox" checked={withRecovery} onChange={(e) => setWithRecovery(e.target.checked)} />
              <span>
                <strong>Create a recovery key</strong> (recommended)
                <br />
                <span className="hint">A second key that unlocks your data if you forget the passphrase.</span>
              </span>
            </label>
            {!withRecovery && (
              <label className="check callout warn">
                <input type="checkbox" checked={ackNoRecovery} onChange={(e) => setAckNoRecovery(e.target.checked)} />
                <span>I understand that if I forget my passphrase, my data cannot be recovered by anyone.</span>
              </label>
            )}
            {error && <div className="error-text">{error}</div>}
          </div>
          <div className="dialog-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('welcome')}>Back</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Encrypting…' : 'Continue'}</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div className="panel">
        <img className="logo" src="/favicon.svg" alt="" />
        <h1 className="t-display" style={{ margin: 0 }}>Understand your money. Privately.</h1>
        <p className="muted" style={{ marginTop: 10 }}>See what you can safely spend, what's coming up, and where you'll land at the end of the month.</p>
        <div className="privacy-points">
          <div><HardDrive size={18} /><span><strong>Your data stays on this device.</strong> There is no account and no server holding your finances.</span></div>
          <div><ShieldCheck size={18} /><span><strong>No bank login, ever.</strong> Add transactions yourself or import a statement file.</span></div>
          <div><KeyRound size={18} /><span><strong>Encrypted with your passphrase.</strong> Only you can unlock it.</span></div>
        </div>
        <p className="hint">{NO_SYNC_NOTICE}</p>
        <div className="stack" style={{ marginTop: 20 }}>
          <button className="btn btn-primary btn-lg btn-block" onClick={() => setStep('passphrase')}>Get started</button>
          <div className="row">
            <button className="btn btn-secondary btn-block" onClick={() => setStep('restore')}><Upload size={16} /> Restore a backup</button>
            <button className="btn btn-secondary btn-block" onClick={() => void session.startDemo()}>Explore sample data</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Restore({ onBack }: { onBack: () => void }) {
  const session = useSession();
  const [file, setFile] = useState<{ name: string; text: string; info: ReturnType<typeof WorkspaceStore.inspectBackup> } | null>(null);
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    setError(null);
    const f = await pickFile('.claritybackup,application/json');
    if (!f) return;
    try {
      const text = await f.text();
      setFile({ name: f.name, text, info: WorkspaceStore.inspectBackup(text) });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const restore = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await session.restore(file.text, mode === 'passphrase' ? { passphrase: secret } : { recoveryKey: secret });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="center-screen">
      <form className="panel" onSubmit={(e) => { e.preventDefault(); void restore(); }}>
        <h1 className="t-title1">Restore a backup</h1>
        <p className="muted t-callout">Choose a <code>.claritybackup</code> file made on this or another device (web, iPhone or Android).</p>
        {!file ? (
          <button type="button" className="btn btn-secondary btn-block" onClick={() => void choose()}><Upload size={16} /> Choose backup file</button>
        ) : (
          <div className="stack">
            <div className="callout">
              <strong>{file.name}</strong>
              <br />
              Made {new Date(file.info.createdAt).toLocaleString()} on {file.info.appPlatform} · {file.info.rowCount} encrypted records
            </div>
            {file.info.hasRecoveryKey && (
              <div className="segmented block" role="group" aria-label="Unlock with">
                <button type="button" aria-pressed={mode === 'passphrase'} onClick={() => setMode('passphrase')}>Passphrase</button>
                <button type="button" aria-pressed={mode === 'recovery'} onClick={() => setMode('recovery')}>Recovery key</button>
              </div>
            )}
            <Field label={mode === 'passphrase' ? 'Passphrase used when the backup was made' : 'Recovery key'}>
              {(id) => <input id={id} className="input" type={mode === 'passphrase' ? 'password' : 'text'} value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus autoComplete="off" />}
            </Field>
          </div>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
          <button type="submit" className="btn btn-primary" disabled={!file || !secret || busy}>{busy ? 'Decrypting…' : 'Restore'}</button>
        </div>
      </form>
    </div>
  );
}
