import { formatCents, type Cents } from '@clarity/shared';

interface Props {
  cents: Cents;
  currency: string;
  sign?: 'auto' | 'always' | 'never';
  tone?: 'auto' | 'none';
  compact?: boolean;
  className?: string;
  /** Headline numbers: when the value changes, the new (exact) value fades in. Never counts through other values. */
  animate?: boolean;
}

/** All money on screen goes through this component: tabular numerals, true minus sign. */
export function Money({ cents, currency, sign = 'auto', tone = 'none', compact, className = '', animate }: Props) {
  const toneClass = tone === 'auto' ? (cents > 0 ? 'pos' : cents < 0 ? '' : '') : '';
  const text = formatCents(cents, currency, { sign, ...(compact !== undefined ? { compact } : {}) });
  return <span className={`money ${toneClass} ${className}`.trim()}>{animate ? <span key={text} className="value-in">{text}</span> : text}</span>;
}
