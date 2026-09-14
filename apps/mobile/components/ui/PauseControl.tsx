import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useStore } from '@entole/core/store';

import { Text } from './Text';

/**
 * The exit. One tap from any header on any screen — never inside a menu, never
 * inside settings. When everything is already paused it becomes Resume.
 */
export function PauseControl() {
  const router = useRouter();
  const { paused, setPaused } = useStore();

  if (paused) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Resume everything Entole does for you"
        onPress={() => {
          void setPaused(false);
        }}
        className="flex-row items-center gap-2 rounded-pill border border-halt bg-halt-wash py-2 pl-3 pr-3.5 active:bg-halt-tint"
      >
        <View className="h-2.5 w-2.5 rounded-[3px] bg-halt" />
        <Text className="font-strong text-label-sm text-halt">Paused</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Pause everything Entole does for you"
      onPress={() => router.push('/pause')}
      className="flex-row items-center gap-2 rounded-pill border border-line bg-card py-2 pl-3 pr-3.5 active:border-halt"
    >
      <View className="h-2.5 w-2.5 rounded-[3px] bg-halt" />
      <Text className="font-strong text-label-sm text-slate">Pause all</Text>
    </Pressable>
  );
}
