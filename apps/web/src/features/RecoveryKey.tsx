import { Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { downloadText, stamp } from '../platform/files';
import { Field } from '../ui/Field';

/** Show a newly created recovery key once and make the user prove they saved it. */
export function RecoveryKeyStep({ recoveryKey, onDone, inDialog }: { recoveryKey: string; onDone: () => void; inDialog?: boolean }) {
  const [check, setCheck] = useState('');
  const [copied, setCopied] = useState(false);
  const last = recoveryKey.split('-').pop()!;
  const ok = check.trim().toUpperCase() === last;
  const body = (
    <>
      <h1 className="t-title1">Save your recovery key</h1>
      <p className="muted t-callout">This is shown only once. Store it somewhere safe and separate from this device: a password manager, or printed and kept at home.</p>
      <div className="recovery-key" data-testid="recovery-key">{recoveryKey}</div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(recoveryKey); setCopied(true); }}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadText(`clarity-recovery-key-${stamp()}.txt`, `Clarity recovery key\n\n${recoveryKey}\n\nKeep this private. Anyone with this key and your data or backup file can read your finances.\n`, 'text/plain')}><Download size={14} /> Download</button>
      </div>
      <div className="callout warn" style={{ marginTop: 16 }}>If you lose both your passphrase and this recovery key, no one — including us — can recover your data.</div>
      <div style={{ marginTop: 16 }}>
        <Field label={`To confirm you saved it, type the last group (${last.length} characters)`}>
          {(id) => <input id={id} className="input" value={check} onChange={(e) => setCheck(e.target.value)} autoComplete="off" spellCheck={false} />}
        </Field>
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-primary" disabled={!ok} onClick={onDone}>I've saved it</button>
      </div>
    </>
  );
  if (inDialog) return body;
  return (
    <div className="center-screen">
      <div className="panel">
        <div className="steps" aria-hidden><span className="on" /><span className="on" /><span /><span /><span /></div>
        {body}
      </div>
    </div>
  );
}
