/** Passphrase policy. No short PINs: the passphrase is the only protection against offline guessing. */
export const MIN_PASSPHRASE_LENGTH = 10;

const COMMON = new Set([
  'password123', 'password1234', '1234567890', '0123456789', 'qwertyuiop', 'iloveyou12', 'letmein123',
  'welcome123', 'passw0rd12', 'abcdefghij', 'abc1234567', 'qwerty1234', 'password12', '1q2w3e4r5t',
  'aaaaaaaaaa', 'football12', 'baseball12', 'monkey1234', 'dragon1234', 'sunshine12', 'princess12',
]);

export interface PassphraseCheck {
  ok: boolean;
  /** 0 (very weak) – 4 (strong) */
  score: 0 | 1 | 2 | 3 | 4;
  message: string;
}

export function checkPassphrase(pass: string): PassphraseCheck {
  const p = pass.normalize('NFKC');
  if (p.length < MIN_PASSPHRASE_LENGTH) return { ok: false, score: 0, message: `Use at least ${MIN_PASSPHRASE_LENGTH} characters.` };
  if (/^\d+$/.test(p)) return { ok: false, score: 0, message: 'A number-only PIN is too easy to guess. Add letters or words.' };
  if (COMMON.has(p.toLowerCase())) return { ok: false, score: 0, message: 'This is a commonly used password. Choose something else.' };
  if (/^(.)\1+$/.test(p)) return { ok: false, score: 0, message: 'Avoid repeating one character.' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const words = p.trim().split(/\s+/).length;
  let score = 1;
  if (p.length >= 14 || words >= 3) score++;
  if (p.length >= 18 || words >= 4) score++;
  if (classes >= 3) score++;
  const s = Math.min(4, score) as PassphraseCheck['score'];
  const message = s >= 3 ? 'Strong passphrase.' : s === 2 ? 'Good. A longer phrase is stronger.' : 'Acceptable, but a few extra words would make it much stronger.';
  return { ok: true, score: s, message };
}
