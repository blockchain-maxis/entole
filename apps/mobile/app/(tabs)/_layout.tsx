import { createMaterialTopTabNavigator } from 'expo-router/js-top-tabs';
import { useRouter, withLayoutContext } from 'expo-router';
import { Briefcase, House, SendHorizontal, Sprout, User, type LucideIcon } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nativeShadowStyle, token } from '@entole/tokens';

import { TabBarIcon } from '@/components/ui/TabBarIcon';
import { sessionIsFresh } from '@/lib/session';

/** Panel radius, matching `packages/tokens`' `panel` token — screenOptions
 * takes a plain style object, not a className, so the value is repeated
 * here the same way Sheet.tsx repeats `sheet`'s radius. */
const PANEL_RADIUS = 24;

function tabIcon(icon: LucideIcon, label: string) {
  function RenderTabIcon({ focused }: { focused: boolean }) {
    return <TabBarIcon icon={icon} label={label} focused={focused} />;
  }
  return RenderTabIcon;
}

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
        tabBarShowLabel: false,
        tabBarShowIcon: true,
        tabBarIndicatorStyle: { height: 0 },
        tabBarGap: 2,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: insets.bottom + 12,
          height: 64,
          borderRadius: PANEL_RADIUS,
          backgroundColor: token.card,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-evenly',
          paddingHorizontal: 6,
          ...nativeShadowStyle.floating,
        },
        tabBarItemStyle: {
          height: 52,
          width: 'auto',
          justifyContent: 'center',
        },
        tabBarContentContainerStyle: {
          flex: 1,
          justifyContent: 'space-evenly',
        },
        sceneStyle: {
          paddingBottom: 64 + insets.bottom + 12,
        },
      }}
    >
      <MaterialTopTabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon(House, 'Home') }} />
      <MaterialTopTabs.Screen
        name="transfer"
        options={{ title: 'Transfer', tabBarIcon: tabIcon(SendHorizontal, 'Transfer') }}
      />
      <MaterialTopTabs.Screen
        name="business"
        options={{ title: 'Business', tabBarIcon: tabIcon(Briefcase, 'Business') }}
      />
      <MaterialTopTabs.Screen name="grow" options={{ title: 'Grow', tabBarIcon: tabIcon(Sprout, 'Grow') }} />
      <MaterialTopTabs.Screen name="me" options={{ title: 'Me', tabBarIcon: tabIcon(User, 'Me') }} />
    </MaterialTopTabs>
  );
}
