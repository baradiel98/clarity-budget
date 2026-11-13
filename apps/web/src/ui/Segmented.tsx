import { useLayoutEffect, useRef, useState } from 'react';

interface Props<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  block?: boolean;
}

/** Segmented control. The selection slides to the chosen option (instant with reduced motion). */
export function Segmented<T extends string>({ value, options, onChange, label, block }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      setThumb(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    return () => ro?.disconnect();
  }, [value, options]);
  return (
    <div ref={ref} className={`segmented ${block ? 'block' : ''} ${thumb ? 'has-thumb' : ''}`} role="group" aria-label={label}>
      {thumb && <span className="seg-thumb" aria-hidden style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} />}
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
