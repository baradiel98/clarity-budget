import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** Minimal history router (no dependency). */
const Ctx = createContext<{ path: string; navigate: (to: string) => void }>({ path: '/', navigate: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);
  return <Ctx.Provider value={{ path, navigate }}>{children}</Ctx.Provider>;
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
