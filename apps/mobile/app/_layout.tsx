import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text as PlainText, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BackendProvider } from '@entole/core/backend';
import { StoreProvider } from '@entole/core/store';

import { AccountProvider, useAccount } from '@/lib/account';
import { AssistantProvider, useAssistant } from '@/lib/assistant';
import { useOnChainBackend } from '@/lib/onchain';
import { ThemeProvider, useThemeColors } from '@/lib/theme';
import { ToastProvider } from '@/lib/toast';
import { ToastHost } from '@/components/ui/Toast';

import '../global.css';
import '@/lib/interop';
import '@/lib/polyfills';

void SplashScreen.preventAutoHideAsync();

function OnChainStoreProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAccount();
  const assistant = useAssistant();
  const { gateway, backend } = useOnChainBackend(account, assistant);
  return (
    <BackendProvider value={backend}>
      <StoreProvider gateway={gateway}>{children}</StoreProvider>
    </BackendProvider>
  );
}

function ThemedStack() {
  const themeColors = useThemeColors();

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: themeColors.paper },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="assistant" />
        <Stack.Screen name="pause" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen
          name="lock"
          options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
        />
        <Stack.Screen
          name="assistant-action"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="edit-profile"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="rules/[id]"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="send/receipt"
          options={{ presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: false }}
        />
      </Stack>
      <ToastHost />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ToastProvider>
            <AccountProvider>
              <AssistantProvider>
                <OnChainStoreProvider>
                  <ThemedStack />
                </OnChainStoreProvider>
              </AssistantProvider>
            </AccountProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Shown instead of a bare red screen when a route throws. In development it
 * also prints the error's own stack — the stack names the component that
 * failed, which is the one thing needed to fix it. This renders above the
 * app's providers, so it uses plain React Native styles and nothing themed.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const inDevelopment = process.env.NODE_ENV !== 'production';
  if (inDevelopment) console.warn('[route error]', error.stack ?? error.message);

  return (
    <View style={{ flex: 1, backgroundColor: 'white', paddingHorizontal: 24, paddingTop: 72 }}>
      <PlainText style={{ color: 'black', fontSize: 22, fontWeight: '700' }}>Something went wrong</PlainText>
      {inDevelopment ? (
        <ScrollView style={{ marginTop: 16 }}>
          <PlainText selectable style={{ color: 'black', fontSize: 12 }}>
            {`${error.name}: ${error.message}\n\n${(error.stack ?? '').split('\n').slice(0, 24).join('\n')}`}
          </PlainText>
        </ScrollView>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={{ marginVertical: 24, paddingVertical: 16, backgroundColor: 'black', borderRadius: 14, alignItems: 'center' }}
      >
        <PlainText style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>Try again</PlainText>
      </Pressable>
    </View>
  );
}
