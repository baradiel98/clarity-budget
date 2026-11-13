import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable } from 'react-native';
import { Screen } from './Screen';
import { T } from './Text';
import { useTheme } from './theme';

export function SubScreen({ title, children }: { title: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <Screen tabBar={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -6 }}>
        <ChevronLeft size={24} color={c.accent} />
        <T color="accent">Settings</T>
      </Pressable>
      <T variant="title1" accessibilityRole="header">{title}</T>
      {children}
    </Screen>
  );
}
