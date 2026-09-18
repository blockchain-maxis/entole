import { createMaterialTopTabNavigator } from 'expo-router/js-top-tabs';
import { useRouter, withLayoutContext } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { token } from '@entole/tokens';

import { sessionIsFresh } from '@/lib/session';

const TopTabs = createMaterialTopTabNavigator().Navigator;
const MaterialTopTabs = withLayoutContext(TopTabs);

/** A stale session never lapses into a screen that still looks signed in —
 * every return to the foreground, and once on mount, re-checks and routes to
 * `/lock` instead of letting a tab render on an expired session. */
function useSessionGuard() {
  const router = useRouter();
  const checking = useRef(false);

  useEffect(() => {
    async function check() {
      if (checking.current) return;
      checking.current = true;
      try {
        if (!(await sessionIsFresh())) router.push('/lock');
      } finally {
        checking.current = false;
      }
    }

    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => subscription.remove();
  }, [router]);
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  useSessionGuard();

  return (
    <MaterialTopTabs
      tabBarPosition="bottom"
      screenOptions={{
        tabBarActiveTintColor: token.ink,
        tabBarInactiveTintColor: token.mist,
        tabBarIndicatorStyle: {
          backgroundColor: token.ink,
          height: 3,
          position: 'absolute',
          top: 0,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          textTransform: 'capitalize',
          fontWeight: 'bold',
        },
        tabBarStyle: {
          backgroundColor: token.card,
          borderTopWidth: 1,
          borderTopColor: token.line,
          paddingBottom: insets.bottom,
          height: 50 + insets.bottom,
        },
        tabBarItemStyle: {
          height: 50,
          justifyContent: 'center',
        },
      }}
    >
      <MaterialTopTabs.Screen
        name="index"
        options={{ title: 'Home' }}
      />
      <MaterialTopTabs.Screen
        name="transfer"
        options={{ title: 'Transfer' }}
      />
      <MaterialTopTabs.Screen
        name="business"
        options={{ title: 'Business' }}
      />
      <MaterialTopTabs.Screen
        name="me"
        options={{ title: 'Me' }}
      />
    </MaterialTopTabs>
  );
}
