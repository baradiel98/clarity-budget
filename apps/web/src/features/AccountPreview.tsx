import { AlertCircle, ArrowLeft, Eye, EyeOff, Info } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from '../lib/router';
import { Segmented } from '../ui/Segmented';
import { useForcedDark } from './Lock';

/**
 * PREVIEW of the future email + password sign-in (see docs/accounts-architecture.md).
 * There is no account server yet, so this screen never signs anyone in, never sends anything,
 * and never stores what is typed: values live only in component state and are cleared on submit.
 * The real way into the data on this device is still the unlock screen (passphrase / recovery key).
 */
type View = 'signin' | 'create' | 'forgot';
type DemoState = 'normal' | 'loading' | 'error';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;

const COPY: Record<View, { title: string; sub: string; cta: string; busy: string; sampleError: string }> = {
  signin: { title: 'Welcome to Clarity', sub: 'Your financial picture, all in one place.', cta: 'Sign in', busy: 'Signing in…', sampleError: 'That email and password don’t match an account.' },
  create: { title: 'Create your account', sub: 'One account for Clarity on your devices.', cta: 'Create account', busy: 'Creating account…', sampleError: 'An account with this email already exists.' },
  forgot: { title: 'Reset your password', sub: 'Enter the email for your account and we’ll send you a link to reset your password.', cta: 'Send reset link', busy: 'Sending…', sampleError: 'We couldn’t send the email. Try again in a moment.' },
};

const NOTICE: Record<View, { title: string; body: string }> = {
  signin: { title: 'Accounts aren’t available yet', body: 'This is a preview of the sign-in screen. Nothing was sent and no account was checked. The data on this device is still protected by your passphrase.' },
  create: { title: 'No account was created', body: 'This is a preview of account sign-up. Nothing was sent or saved. Clarity accounts are not live yet.' },
  forgot: { title: 'No email was sent', body: 'Password reset needs Clarity accounts, which are not live yet. When they are, a reset will let you sign in again, but only your passphrase or recovery key can decrypt your financial data.' },
};

export function AccountPreview() {
  const { navigate } = useRouter();
  const [view, setView] = useState<View>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'email' | 'password' | 'confirm', string>>>({});
  const [notice, setNotice] = useState<View | null>(null);
  const [demo, setDemo] = useState<DemoState>('normal');
  const emailRef = useRef<HTMLInputElement>(null);
  const ids = { title: useId(), email: useId(), pass: useId(), confirm: useId(), eErr: useId(), pErr: useId(), cErr: useId(), formErr: useId() };
  useForcedDark();

  // Never keep typed passwords around longer than the screen.
  useEffect(() => () => { setPassword(''); setConfirm(''); }, []);

  const go = (v: View) => {
    setView(v);
    setNotice(null);
    setErrors({});
    setPassword('');
    setConfirm('');
    setShown(false);
    setDemo('normal');
    setTimeout(() => emailRef.current?.focus(), 0);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (demo === 'loading') return;
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Enter your email address.';
    else if (!EMAIL.test(email.trim())) next.email = 'Enter a valid email address, like name@example.com.';
    if (view !== 'forgot') {
      if (!password) next.password = 'Enter your password.';
      else if (view === 'create' && password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters.`;
      if (view === 'create' && password && confirm !== password) next.confirm = 'The passwords don’t match.';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    // Nothing is sent anywhere: explain that instead of pretending.
    setPassword('');
    setConfirm('');
    setNotice(view);
  };

  const c = COPY[view];
  const busy = demo === 'loading';
  const formError = demo === 'error' ? c.sampleError : null;

  return (
    <main className="auth">
      <div className="auth-col">
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width={40} height={40} />
          <span>Clarity</span>
        </div>

        <section className="auth-panel" aria-labelledby={ids.title} key={`${view}-${notice ?? ''}`}>
          <span className="auth-badge">Preview · not connected</span>
          {notice ? (
            <div role="status">
              <h1 className="auth-title" id={ids.title}>{NOTICE[notice].title}</h1>
              <p className="auth-sub">{NOTICE[notice].body}</p>
              <button type="button" className="auth-primary" onClick={() => navigate('/')}>Go to this device’s data</button>
              <button type="button" className="auth-link auth-back" onClick={() => go(notice)}><ArrowLeft size={15} aria-hidden /> Back to the preview</button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate aria-busy={busy}>
              <h1 className="auth-title" id={ids.title}>{c.title}</h1>
              <p className="auth-sub">{c.sub}</p>

              {formError && <p className="auth-error auth-form-error" id={ids.formErr} role="alert"><AlertCircle size={15} aria-hidden /> {formError}</p>}

              <label className="auth-label" htmlFor={ids.email}>Email</label>
              <div className={`auth-input ${errors.email ? 'invalid' : ''}`}>
                <input ref={emailRef} id={ids.email} type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }}
                  readOnly={busy} autoFocus autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@example.com"
                  aria-invalid={!!errors.email} aria-describedby={[errors.email ? ids.eErr : null, formError ? ids.formErr : null].filter(Boolean).join(' ') || undefined} />
              </div>
              <div className="auth-msgs">{errors.email && <p className="auth-error" id={ids.eErr}><AlertCircle size={15} aria-hidden /> {errors.email}</p>}</div>

              {view !== 'forgot' && (
                <>
                  <div className="auth-label-row">
                    <label className="auth-label" htmlFor={ids.pass}>Password</label>
                    {view === 'signin' && <button type="button" className="auth-link auth-small" onClick={() => go('forgot')} disabled={busy}>Forgot password?</button>}
                  </div>
                  <div className={`auth-input ${errors.password ? 'invalid' : ''}`}>
                    <input id={ids.pass} type={shown ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }}
                      readOnly={busy} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                      aria-invalid={!!errors.password} aria-describedby={errors.password ? ids.pErr : undefined} />
                    <button type="button" className="auth-eye" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} aria-controls={ids.pass}>
                      {shown ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className="auth-msgs">
                    {errors.password ? <p className="auth-error" id={ids.pErr}><AlertCircle size={15} aria-hidden /> {errors.password}</p> : view === 'create' ? <p className="auth-hint">At least {MIN_PASSWORD} characters.</p> : null}
                  </div>
                </>
              )}

              {view === 'create' && (
                <>
                  <label className="auth-label" htmlFor={ids.confirm}>Confirm password</label>
                  <div className={`auth-input ${errors.confirm ? 'invalid' : ''}`}>
                    <input id={ids.confirm} type={shown ? 'text' : 'password'} value={confirm} onChange={(e) => { setConfirm(e.target.value); setErrors((x) => ({ ...x, confirm: undefined })); }}
                      readOnly={busy} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                      aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? ids.cErr : undefined} />
                  </div>
                  <div className="auth-msgs">{errors.confirm && <p className="auth-error" id={ids.cErr}><AlertCircle size={15} aria-hidden /> {errors.confirm}</p>}</div>
                </>
              )}

              <button type="submit" className="auth-primary" disabled={busy}>{busy ? <><span className="auth-spinner" aria-hidden /> {c.busy}</> : c.cta}</button>

              <div className="auth-secondary">
                {view === 'signin' && <p className="auth-switch">New to Clarity? <button type="button" className="auth-link" onClick={() => go('create')} disabled={busy}>Create an account</button></p>}
                {view === 'create' && <p className="auth-switch">Already have an account? <button type="button" className="auth-link" onClick={() => go('signin')} disabled={busy}>Sign in</button></p>}
                {view === 'forgot' && <button type="button" className="auth-link" onClick={() => go('signin')} disabled={busy}><ArrowLeft size={15} aria-hidden /> Back to sign in</button>}
              </div>
            </form>
          )}
        </section>

        <div className="auth-preview-bar">
          <p><Info size={14} aria-hidden /> Accounts aren’t live yet. This preview doesn’t sign you in, send email or store what you type.</p>
          {!notice && <Segmented label="Preview state" value={demo} onChange={setDemo} options={[{ value: 'normal', label: 'Normal' }, { value: 'loading', label: 'Loading' }, { value: 'error', label: 'Error' }]} />}
          <button type="button" className="auth-link" onClick={() => navigate('/')}><ArrowLeft size={15} aria-hidden /> Back to Clarity</button>
        </div>
      </div>
    </main>
  );
}
