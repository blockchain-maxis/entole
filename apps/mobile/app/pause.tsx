import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { KillSwitchBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { resetLabel } from '@entole/core/format';
import { formatNaira } from '@entole/core/money';
import { useStore } from '@entole/core/store';

const DOT = {
  settled: 'bg-settled',
  caution: 'bg-caution',
  halt: 'bg-halt',
} as const;

/**
 * The exit, and it is always visible. Trust in a delegated system comes from a
 * reachable kill switch, not from reassuring copy.
 */
export default function Pause() {
  const router = useRouter();
  const store = useStore();
  const [working, setWorking] = useState(false);

  const count = store.allowances.length;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  async function pauseEverything() {
    setWorking(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await store.setPaused(true);
      close();
    } finally {
      setWorking(false);
    }
  }

  return (
    <Screen>
      <Header leading="close" trailing={<View />} onLeadingPress={close} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 10 }}
      >
        <View className="px-1">
          <KillSwitchBadge />
          <Text className="mt-[18px] font-strong text-title-lg text-ink">
            Pause everything Entole does for you
          </Text>
          <Text className="mt-3 font-body text-body-sm text-slate">
            {count === 1 ? 'Your allowance stops' : `All ${count} allowances stop`} immediately. No
            scheduled payment will be sent until you resume.
          </Text>
        </View>

        <Text className="px-1 pb-2.5 pt-[26px] font-heavy text-label text-ink">
          What will be paused
        </Text>

        <View className="gap-2">
          {store.allowances.map((allowance) => (
            <View
              key={allowance.id}
              className="flex-row items-center gap-3 rounded-row border border-line bg-card p-3.5"
            >
              <View className={`h-2.5 w-2.5 flex-none rounded-[2px] ${DOT[allowance.tone]}`} />
              <View className="flex-1">
                <Text className="font-strong text-body-sm text-ink">{allowance.name}</Text>
                <Text tabular className="mt-0.5 font-body text-caption text-slate">
                  {formatNaira(allowance.remainingMinor)} left ·{' '}
                  {resetLabel(allowance.resetsAt).replace('Resets', 'next')}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View className="mt-4 rounded-row border border-line bg-card px-[18px] py-4">
          <Text className="font-strong text-label text-settled">Nothing is lost</Text>
          <Text className="mt-1.5 font-body text-label-sm text-slate">
            Your rules, limits and history stay exactly as they are. Turn everything back on in one
            tap, whenever you’re ready.
          </Text>
        </View>
      </ScrollView>

      <View className="flex-none border-t border-hairline px-gutter pb-2.5 pt-3">
        <View className="flex-row">
          <Button
            label="Pause everything now"
            variant="destructive"
            busy={working}
            onPress={() => void pauseEverything()}
          />
        </View>
        <View className="mt-2.5 flex-row">
          <Button label="Keep everything running" variant="quiet" onPress={close} />
        </View>
      </View>
    </Screen>
  );
}
