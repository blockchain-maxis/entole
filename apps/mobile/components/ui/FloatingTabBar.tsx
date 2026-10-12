import { Briefcase, House, SendHorizontal, Sprout, User, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nativeShadowStyle } from '@entole/tokens';

import { useThemeColors } from '@/lib/theme';

import { TAB_PILL_RADIUS, TabBarIcon } from './TabBarIcon';

export const TAB_BAR_HEIGHT = 68;
const BAR_PADDING = 6;
/** The bar is a capsule round the capsules inside it: its radius is theirs
 * plus the padding between them (28 + 6), which is half its own height. With
 * a tighter corner outside a rounder one, the two curves fought. */
const BAR_RADIUS = TAB_PILL_RADIUS + BAR_PADDING;
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
        padding: BAR_PADDING,
        borderRadius: BAR_RADIUS,
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
        //
        // The slot is the capsule: it carries the radius and clips to it, so
        // the active ground and the ripple are both cut to a round shape by
        // their parent. Rounding each of them separately still drew square
        // corners on Android.
        return (
          <View key={route.key} style={{ flex: 1, borderRadius: TAB_PILL_RADIUS, overflow: 'hidden' }}>
            <TabBarIcon icon={tab.icon} label={tab.label} focused={focused} />
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: focused }}
              onPress={onPress}
              android_ripple={{ color: colors.line, borderless: false }}
              style={styles.press}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Over the whole slot. One plain object, not a list: this wrapper has
  // dropped styles handed to it in other shapes before.
  press: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
