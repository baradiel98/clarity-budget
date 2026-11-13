import { checkPassphrase } from '@clarity/security';
import { Field } from '../ui/Field';

export function PassphraseFields({ pass, confirm, setPass, setConfirm, showErrors }: { pass: string; confirm: string; setPass: (v: string) => void; setConfirm: (v: string) => void; showErrors: boolean }) {
  const check = checkPassphrase(pass);
  const mismatch = confirm.length > 0 && confirm !== pass;
  return (
    <div className="stack">
      <Field label="Passphrase" hint={pass ? check.message : 'At least 10 characters. A few unrelated words work well.'} error={showErrors && !check.ok ? check.message : null}>
        {(id) => (
          <>
            <input id={id} className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={showErrors && !check.ok} autoFocus />
            <div className={`strength ${check.score < 2 ? 'weak' : ''}`} aria-hidden>
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={pass && check.ok && check.score >= i ? 'on' : ''} />
              ))}
            </div>
          </>
        )}
      </Field>
      <Field label="Confirm passphrase" error={mismatch || (showErrors && confirm !== pass) ? 'Passphrases do not match.' : null}>
        {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />}
      </Field>
    </div>
  );
}

export const passphraseValid = (pass: string, confirm: string) => checkPassphrase(pass).ok && pass === confirm;
