import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { exitMs } from '../lib/motion';

interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  tone?: 'default' | 'error';
  leaving?: boolean;
}

const Ctx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    setTimeout(() => {
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), exitMs());
    }, t.action ? 7000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.leaving ? 'leaving' : ''}`}>
            <span className={`grow ${t.tone === 'error' ? 'neg' : ''}`}>{t.message}</span>
            {t.action && (
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  t.action!.run();
                  setItems((xs) => xs.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
