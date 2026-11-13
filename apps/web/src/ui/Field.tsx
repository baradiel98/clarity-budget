import { useId, type ReactNode } from 'react';

export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <div className="error-text" role="alert">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
