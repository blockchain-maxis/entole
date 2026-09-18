import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import type { AvatarTone } from '@entole/core/schemas';
import { token } from '@entole/tokens';

import { Text } from './Text';

/** Ground → deep, per tone — the same warm-neutral family, one stop
 * darker, for a soft gradient fill instead of a flat tint. */
const GRADIENTS: Record<AvatarTone, [string, string]> = {
  1: [token.avatar[1], token['avatar-deep'][1]],
  2: [token.avatar[2], token['avatar-deep'][2]],
  3: [token.avatar[3], token['avatar-deep'][3]],
};

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
  return (
    <View
      className={`${box} flex-none rounded-pill ${stacked ? 'border-2 border-card' : 'border border-white/40'}`}
    >
      <LinearGradient
        colors={GRADIENTS[tone]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text className={`font-strong ${text} text-slate`}>{initials}</Text>
      </LinearGradient>
    </View>
  );
}
