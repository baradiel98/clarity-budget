import type { InputHTMLAttributes } from 'react';

const SYMBOL: Record<string, string> = { USD: '$', CAD: '$', AUD: '$', MXN: '$', EUR: '€', GBP: '£', JPY: '¥' };

/**
 * Text input for money: decimal keyboard, no number spinner, parsed with parseAmountInput (never parseFloat).
 * `signed` (Phase 4A.5.8, balances): a minus sign is kept, never silently dropped; parse with parseSignedAmountInput.
 */
export function AmountInput({ value, onChange, currency, large, signed, ...rest }: { value: string; onChange: (v: string) => void; currency: string; large?: boolean; signed?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="amount-wrap">
      <span className="currency" aria-hidden style={large ? undefined : { fontSize: 15, left: 12 }}>{SYMBOL[currency] ?? currency}</span>
      <input
        {...rest}
        className={`input num ${large ? 'amount-input' : ''}`}
        style={large ? undefined : { paddingLeft: 26 }}
        inputMode={signed ? 'text' : 'decimal'}
        autoComplete="off"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(signed ? e.target.value.replace(/[^\d.,\-\u2212]/g, '') : e.target.value.replace(/[^\d.,]/g, ''))}
      />
    </div>
  );
}
