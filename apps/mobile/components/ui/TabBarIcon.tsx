import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

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
 * An assistant-initiated nav state, if one is ever needed, reuses this
 * mechanic with the assistant tint in place of indigo — never the same fill as
 * a user-initiated active tab.
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
        borderRadius: 18,
        backgroundColor: focused ? colors.indigo.wash : 'transparent',
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
