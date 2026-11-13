import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, radius, space, type, type ColorScheme } from '@clarity/design-system';

export interface Theme {
  c: ColorScheme;
  scheme: 'light' | 'dark';
}

const Ctx = createContext<Theme>({ c: light, scheme: 'light' });

export function ThemeProvider({ preference, children }: { preference: 'system' | 'light' | 'dark'; children: ReactNode }) {
  const sys = useColorScheme();
  const scheme = preference === 'system' ? (sys === 'dark' ? 'dark' : 'light') : preference;
  return <Ctx.Provider value={{ c: scheme === 'dark' ? dark : light, scheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

export const FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const weightFont = (w: number) => (w >= 700 ? FONT.bold : w >= 600 ? FONT.semibold : w >= 500 ? FONT.medium : FONT.regular);

export { radius, space, type };
