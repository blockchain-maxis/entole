import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import type { AvatarTone } from '@entole/core/schemas';

import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

/** Ground → deep, per tone — the same warm-neutral family, one stop
 * darker, for a soft gradient fill instead of a flat tint. Computed from
 * the live theme so it re-tones in dark mode instead of staying pinned to
 * the light palette's grounds. */
function gradientsFor(colors: ReturnType<typeof useThemeColors>): Record<AvatarTone, [string, string]> {
  return {
    1: [colors.avatar[1], colors['avatar-deep'][1]],
    2: [colors.avatar[2], colors['avatar-deep'][2]],
    3: [colors.avatar[3], colors['avatar-deep'][3]],
  };
}

const SIZES = {
  sm: { box: 'h-[38px] w-[38px]', text: 'text-label' },
  md: { box: 'h-[42px] w-[42px]', text: 'text-body' },
  lg: { box: 'h-[46px] w-[46px]', text: 'text-body-lg' },
  xl: { box: 'h-14 w-14', text: 'text-headline' },
  hero: { box: 'h-[88px] w-[88px]', text: 'text-amount-lg' },
} as const;

export type AvatarSize = keyof typeof SIZES;

/** A person, always. Initials stand in until a contact photo is available. */
export function Avatar({
  initials,
  tone = 1,
  size = 'md',
  stacked = false,
}: {
  initials: string;
  tone?: AvatarTone;
  size?: AvatarSize;
  stacked?: boolean;
}) {
  const { box, text } = SIZES[size];
  const colors = useThemeColors();
  return (
    <View
      className={`${box} flex-none rounded-pill ${stacked ? 'border-2 border-card' : 'border border-white/40'}`}
    >
      <LinearGradient
        colors={gradientsFor(colors)[tone]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text className={`font-strong ${text} text-slate`}>{initials}</Text>
      </LinearGradient>
    </View>
  );
}
