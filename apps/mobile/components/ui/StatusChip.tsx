import { View } from 'react-native';

import { Text } from './Text';

type Tone = 'neutral' | 'settled' | 'halt' | 'caution';

const CHIP: Record<Tone, { box: string; text: string }> = {
  neutral: { box: 'bg-track', text: 'text-slate' },
  settled: { box: 'bg-settled-wash', text: 'text-settled' },
  halt: { box: 'bg-halt-wash', text: 'text-halt' },
  caution: { box: 'bg-track', text: 'text-caution' },
};

/**
 * A word for where something stands — Sent, Paid, Overdue. Colour follows the
 * meaning, never the assistant tint, which belongs to what the assistant did.
 */
export function StatusChip({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { box, text } = CHIP[tone];
  return (
    <View className={`self-start rounded-md px-2 py-1 ${box}`}>
      <Text className={`font-heavy text-badge uppercase ${text}`}>{label}</Text>
    </View>
  );
}
