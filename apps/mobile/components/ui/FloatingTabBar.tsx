import { Briefcase, House, SendHorizontal, Sprout, User, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nativeShadowStyle } from '@entole/tokens';

import { useThemeColors } from '@/lib/theme';

import { TabBarIcon } from './TabBarIcon';

/** Panel radius, matching `packages/tokens`' `panel` token — a plain style
 * object can't take a className, so the value is repeated here. */
const PANEL_RADIUS = 24;
export const TAB_BAR_HEIGHT = 68;
/** How far the floating bar sits above the bottom safe-area edge. */
export const TAB_BAR_LIFT = 20;
/** Gap between the bar and each screen edge: 16 gutter + 25 so the bar is 50px
 * narrower than full width, height unchanged. */
const TAB_BAR_INSET = 41;

const TABS: Record<string, { icon: LucideIcon; label: string }> = {
  index: { icon: House, label: 'Home' },
  transfer: { icon: SendHorizontal, label: 'Pay' },
  business: { icon: Briefcase, label: 'Business' },
  grow: { icon: Sprout, label: 'Grow' },
  me: { icon: User, label: 'Me' },
};

type Route = { key: string; name: string; params?: object };

export type FloatingTabBarProps = {
  state: { index: number; routes: Route[] };
  navigation: {
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented?: boolean;
    };
    navigate: (name: string, params?: object) => void;
  };
};

/**
 * The bottom bar, drawn with plain Views instead of the tab-view library's
 * own bar. The library bar wraps its tabs in a horizontal FlatList inside an
 * unsized View; any `flexDirection` set on its container collapses that
 * wrapper to zero width, so every icon and label disappeared. Owning the
 * layout means nothing here depends on how the library sizes its children.
 *
 * Swiping between tabs still works — the pager is the library's; only the bar
 * is ours, and it follows `state.index`.
 */
export function FloatingTabBar({ state, navigation }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  return (
    <View
      style={{
        position: 'absolute',
        left: TAB_BAR_INSET,
        right: TAB_BAR_INSET,
        bottom: insets.bottom + TAB_BAR_LIFT,
        zIndex: 10,
        height: TAB_BAR_HEIGHT,
        flexDirection: 'row',
        padding: 6,
        borderRadius: PANEL_RADIUS,
        backgroundColor: colors.card,
        // A hairline gives the bar an edge on dark, where the shadow alone
        // barely reads against a dark page.
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.line,
        ...nativeShadowStyle.floating,
      }}
    >
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = state.index === index;

        function onPress() {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }

        // Plain View slot + object-style Pressable. A function `style` on
        // Pressable (for pressed opacity) is dropped by NativeWind's wrapper,
        // which left every tab at content width, packed to the left.
        return (
          <View key={route.key} style={{ flex: 1 }}>
            <TabBarIcon icon={tab.icon} label={tab.label} focused={focused} />
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: focused }}
              onPress={onPress}
              android_ripple={{ color: colors.line, borderless: false, radius: 32 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
        );
      })}
    </View>
  );
}
