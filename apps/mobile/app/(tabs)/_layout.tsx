import { createMaterialTopTabNavigator } from 'expo-router/js-top-tabs';
import { useRouter, withLayoutContext } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingTabBar, TAB_BAR_HEIGHT, TAB_BAR_LIFT } from '@/components/ui/FloatingTabBar';
import { useAccount } from '@/lib/account';
import { lockScreen } from '@/lib/lock-state';
import { sessionIsFresh } from '@/lib/session';
import { useThemeColors } from '@/lib/theme';

function renderTabBar(props: React.ComponentProps<typeof FloatingTabBar>) {
  return <FloatingTabBar {...props} />;
}

const TopTabs = createMaterialTopTabNavigator().Navigator;
const MaterialTopTabs = withLayoutContext(TopTabs);

/** A stale session never lapses into a screen that still looks signed in —
 * every return to the foreground, and once on mount, re-checks and routes to
 * `/lock` instead of letting a tab render on an expired session.
 *
 * "Signed in" means two things: the session timestamp is fresh *and* the
 * signing account is actually in memory. The timestamp is on disk and survives
 * the app closing; the account is deliberately never written to disk, so a
 * cold start inside the window has a fresh timestamp and no account — tabs
 * would render forever waiting on a gateway that has nothing to sign with. */
function useSessionGuard() {
  const router = useRouter();
  const { account } = useAccount();
  const checking = useRef(false);

  useEffect(() => {
    async function check() {
      // The passkey sheet opening and closing returns the app to the
      // foreground; without this each return would stack another lock screen.
      if (checking.current || lockScreen.visible) return;
      checking.current = true;
      try {
        if (!account || !(await sessionIsFresh())) router.push('/lock');
      } finally {
        checking.current = false;
      }
    }

    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => subscription.remove();
  }, [router, account]);
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const themeColors = useThemeColors();
  useSessionGuard();

  return (
    <MaterialTopTabs
      tabBarPosition="bottom"
      tabBar={renderTabBar}
      screenOptions={{
        // Mount a tab when it is first opened, not all five at launch. A theme
        // change re-renders every mounted screen, and in a dev build five full
        // screens took several seconds to re-render.
        lazy: true,
        // The navigator paints every scene with the *navigation theme's*
        // background (a fixed light colour we never theme), which showed as a
        // light rectangle behind the floating bar and stayed light in dark mode.
        sceneStyle: {
          backgroundColor: themeColors.paper,
          paddingBottom: TAB_BAR_HEIGHT + insets.bottom + TAB_BAR_LIFT + 8,
        },
      }}
    >
      <MaterialTopTabs.Screen name="index" options={{ title: 'Home' }} />
      <MaterialTopTabs.Screen name="transfer" options={{ title: 'Pay' }} />
      <MaterialTopTabs.Screen name="business" options={{ title: 'Business' }} />
      <MaterialTopTabs.Screen name="grow" options={{ title: 'Grow' }} />
      <MaterialTopTabs.Screen name="me" options={{ title: 'Me' }} />
    </MaterialTopTabs>
  );
}
