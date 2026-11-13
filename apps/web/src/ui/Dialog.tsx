import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  variant?: 'dialog' | 'drawer';
  /** id for aria-labelledby */
  labelId?: string;
}

/** Modal dialog / side drawer with focus trap, Escape to close and focus restore. */
export function Dialog({ title, onClose, children, footer, wide, variant = 'dialog', labelId = 'dlg-title' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the focus effect on every parent render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Respect a field that already took focus (autoFocus); otherwise prefer the first form field.
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select, textarea') ?? el.querySelector<HTMLElement>('button:not(.dlg-close)');
      (first ?? el).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (f.length === 0) return;
        const a = f[0]!;
        const b = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className={`overlay ${variant === 'drawer' ? 'drawer-overlay' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={variant === 'drawer' ? 'drawer' : `dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelId} tabIndex={-1}>
        <div className="dialog-head">
          <h2 className="t-title2" id={labelId}>{title}</h2>
          <button className="icon-btn dlg-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
