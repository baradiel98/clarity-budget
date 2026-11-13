import { formatCents, type Cents } from '@clarity/shared';

interface Props {
  cents: Cents;
  currency: string;
  sign?: 'auto' | 'always' | 'never';
  tone?: 'auto' | 'none';
  compact?: boolean;
  className?: string;
}

/** All money on screen goes through this component: tabular numerals, true minus sign. */
export function Money({ cents, currency, sign = 'auto', tone = 'none', compact, className = '' }: Props) {
  const toneClass = tone === 'auto' ? (cents > 0 ? 'pos' : cents < 0 ? '' : '') : '';
  return <span className={`money ${toneClass} ${className}`.trim()}>{formatCents(cents, currency, { sign, ...(compact !== undefined ? { compact } : {}) })}</span>;
}
