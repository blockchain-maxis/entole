import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

/**
 * Icon + label as one unit, so the active state is a single pill
 * (`indigo.wash` behind both) rather than a separate underline indicator.
 * An assistant-initiated nav state, if one is ever needed, reuses this same
 * mechanic with the assistant tint in place of indigo — never the same
 * fill as a user-initiated active tab, per the assistant-distinct rule.
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
  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-pill px-3.5 py-2 ${
        focused ? 'bg-indigo-wash' : ''
      }`}
    >
      <Icon size={20} color={focused ? colors.ink : colors.mist} strokeWidth={1.5} />
      <Text className={`font-strong text-label-sm ${focused ? 'text-ink' : 'text-mist'}`}>{label}</Text>
    </View>
  );
}
