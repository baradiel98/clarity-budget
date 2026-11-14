import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Image, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockScreen } from '../src/features/Lock';
import { Onboarding } from '../src/features/Onboarding';
import { Welcome } from '../src/features/Welcome';
import { SessionProvider, useData, useSession } from '../src/state/session';
import { ThemeProvider, useTheme } from '../src/ui/theme';
import { ToastProvider } from '../src/ui/Toast';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
    // Android: block screenshots and screen recording of financial data (FLAG_SECURE).
    if (Platform.OS === 'android') void ScreenCapture.preventScreenCaptureAsync();
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const s = useSession();
  if (s.phase.kind !== 'ready') {
    return (
      <ThemeProvider preference="system">
        <Chrome>{s.phase.kind === 'loading' ? null : s.phase.kind === 'welcome' ? <Welcome /> : <LockScreen />}</Chrome>
      </ThemeProvider>
    );
  }
  return <Unlocked />;
}

function Unlocked() {
  const data = useData();
  const s = useSession();
  return (
    <ThemeProvider preference={data.settings.theme}>
      <Chrome>
        {!data.settings.onboardingComplete || s.introActive || s.pendingRecoveryKey ? (
          <Onboarding />
        ) : (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="add" options={{ presentation: 'modal' }} />
            <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
            <Stack.Screen name="afford" options={{ presentation: 'modal' }} />
            <Stack.Screen name="explain" options={{ presentation: 'modal' }} />
            <Stack.Screen name="recurring" options={{ presentation: 'modal' }} />
          </Stack>
        )}
      </Chrome>
    </ThemeProvider>
  );
}

/** Status bar, toasts, and the privacy overlay that hides content in the app switcher. */
function Chrome({ children }: { children: React.ReactNode }) {
  const { c, scheme } = useTheme();
  const { appActive } = useSession();
  return (
    <ToastProvider>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        {children}
        {!appActive && (
          <View style={{ position: 'absolute', inset: 0, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Image source={require('../assets/splash-icon.png')} style={{ width: 72, height: 72 }} />
          </View>
        )}
      </View>
    </ToastProvider>
  );
}
