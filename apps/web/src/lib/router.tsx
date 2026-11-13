import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** Minimal history router (no dependency). `search` carries filters, e.g. /transactions?category=cat_groceries. */
interface Loc {
  path: string;
  search: string;
}
const read = (): Loc => ({ path: window.location.pathname, search: window.location.search });
const Ctx = createContext<Loc & { navigate: (to: string) => void }>({ path: '/', search: '', navigate: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const onPop = () => setLoc(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history.pushState(null, '', to);
    setLoc(read());
    window.scrollTo(0, 0);
  }, []);
  return <Ctx.Provider value={{ ...loc, navigate }}>{children}</Ctx.Provider>;
}

export const useRouter = () => useContext(Ctx);

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate, path } = useRouter();
  return (
    <a
      href={to}
      className={className}
      aria-current={path === to ? 'page' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
