import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

/** The bar's slots are 56px tall (68 minus 6 padding a side), so half of that
 * is a full capsule. The highlight and the ripple share it: a ripple clipped to
 * anything less draws a square on Android. */
export const TAB_PILL_RADIUS = 28;

/**
 * One tab: icon over a short label, filling its slot in the bar. The active
 * state is a soft `indigo.wash` pill behind the stack.
 *
 * Every colour here — icon, label and pill — comes from the same JS token
 * source (`useThemeColors()`), never a mix of className colours and token
 * colours. The inactive tint is `slate`, not `mist`: `mist` on a white card is
 * ~2.7:1 and read as missing. Layout is plain style values (no className) so
 * nothing about the bar depends on the stylesheet compiling.
 *
 * The active tab sits on a neutral ground in ink: choosing a tab is something
 * the person does, and blue is kept for what the assistant does.
 */
export function TabBarIcon({
  icon: Icon,
  label,
  focused,
}: {
  icon: LucideIcon;
  label: string;
  focused: boolean;
}) {
  const colors = useThemeColors();
  const tint = focused ? colors.ink : colors.slate;

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: TAB_PILL_RADIUS,
        backgroundColor: focused ? colors.press : 'transparent',
      }}
    >
      <Icon size={22} color={tint} strokeWidth={focused ? 2.1 : 1.7} />
      <Text
        numberOfLines={1}
        className="font-strong"
        style={{ color: tint, fontSize: 11, lineHeight: 14, marginTop: 3 }}
      >
        {label}
      </Text>
    </View>
  );
}
