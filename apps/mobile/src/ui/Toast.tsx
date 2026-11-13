import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from './Glass';
import { T } from './Text';
import { FONT } from './theme';

interface ToastItem {
  message: string;
  action?: { label: string; run: () => void };
}
const Ctx = createContext<(t: ToastItem) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const show = useCallback((t: ToastItem) => {
    if (timer.current) clearTimeout(timer.current);
    setItem(t);
    timer.current = setTimeout(() => setItem(null), t.action ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {item && (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 96 }} accessibilityLiveRegion="polite">
          <Glass style={{ borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 12 }}>
            <T style={{ flex: 1 }} variant="callout">{item.message}</T>
            {item.action && (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { item.action!.run(); setItem(null); }}>
                <T variant="callout" color="accent" style={{ fontFamily: FONT.semibold }}>{item.action.label}</T>
              </Pressable>
            )}
          </Glass>
        </View>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
