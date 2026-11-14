import { useId, useLayoutEffect, type ReactNode } from 'react';

/**
 * Label + control + hint/error. The error (or, when there is none, the hint) is linked to the control with
 * aria-describedby using stable ids, so a screen reader reads it whenever the field gets focus — not only at
 * the moment the error appears (it still has role="alert" for that). The control is rendered by the caller
 * with the given id; Field adds the link and aria-invalid to it after render, keeping any description the
 * control already has.
 */
export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  const errId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errId : hint ? hintId : null;
  useLayoutEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const own = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== errId && x !== hintId);
    const all = [...own, ...(describedBy ? [describedBy] : [])];
    if (all.length) el.setAttribute('aria-describedby', all.join(' '));
    else el.removeAttribute('aria-describedby');
    if (error) {
      el.setAttribute('aria-invalid', 'true');
      el.dataset.fieldInvalid = '1';
    } else if (el.dataset.fieldInvalid) {
      el.removeAttribute('aria-invalid');
      delete el.dataset.fieldInvalid;
    }
  });
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <div className="error-text" id={errId} role="alert">{error}</div> : hint ? <div className="hint" id={hintId}>{hint}</div> : null}
    </div>
  );
}
