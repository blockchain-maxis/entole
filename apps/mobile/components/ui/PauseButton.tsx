import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useStore } from '@entole/core/store';

import { Text } from './Text';

/**
 * The exit. Every screen header carries this — never buried, never a second
 * tap away. Pressing it opens the confirmation screen; it never toggles
 * silently from the header itself.
 */
export function PauseButton() {
  const router = useRouter();
  const { paused } = useStore();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={paused ? 'Resume everything Entole does for you' : 'Pause everything Entole does for you'}
      hitSlop={14}
      onPress={() => router.push('/pause')}
      className={`flex-row items-center gap-2 rounded-pill border px-3 py-2 ${
        paused ? 'border-halt bg-halt-wash' : 'border-line bg-card'
      }`}
    >
      <View className="h-2.5 w-2.5 rounded-[3px] bg-halt" />
      <Text className={`font-strong text-label-sm ${paused ? 'text-halt' : 'text-slate'}`}>
        {paused ? 'Paused' : 'Pause'}
      </Text>
    </Pressable>
  );
}
