import { View } from 'react-native';

import type { AvatarTone } from '@entole/core/schemas';

import { Text } from './Text';

const TONES: Record<AvatarTone, string> = {
  1: 'bg-avatar-1',
  2: 'bg-avatar-2',
  3: 'bg-avatar-3',
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
      className={`${box} ${TONES[tone]} flex-none items-center justify-center rounded-pill ${
        stacked ? 'border-2 border-card' : ''
      }`}
    >
      <Text className={`font-strong ${text} text-slate`}>{initials}</Text>
    </View>
  );
}
