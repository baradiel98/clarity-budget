interface Props<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  block?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, label, block }: Props<T>) {
  return (
    <div className={`segmented ${block ? 'block' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
