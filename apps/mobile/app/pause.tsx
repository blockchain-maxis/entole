import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { View } from 'react-native';

import { KillSwitchBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useStore } from '@entole/core/store';

/**
 * The exit for the assistant. Reachable in one tap from every header; this
 * screen is where that tap lands. No further confirmation once the button here is
 * pressed — a second dialog on top of the one dedicated screen would just be
 * a second place for the exit to hide.
 */
export default function Pause() {
  const router = useRouter();
  const store = useStore();
  const [working, setWorking] = useState(false);

  async function toggle() {
    setWorking(true);
    try {
      await store.setPaused(!store.paused);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      router.back();
    } finally {
      setWorking(false);
    }
  }

  return (
    <Screen>
      <Header title="Assistant" leading="close" trailing={null} />

      <View className="flex-1 items-center px-gutter-lg pt-6">
        <KillSwitchBadge />

        <Text className="mt-6 text-center font-strong text-headline text-ink">
          {store.paused ? 'The assistant is paused' : 'Pause the assistant?'}
        </Text>
        <Text className="mt-2.5 text-center font-body text-body-sm text-slate">
          {store.paused
            ? 'The assistant cannot propose or make a payment for you while this is on. You can still send money yourself, and you can resume it any time. Every allowance stays exactly where it is.'
            : 'Entole\u2019s assistant stops proposing and making payments for you. You can still send money yourself. Your allowances and their balances stay exactly as they are.'}
        </Text>
      </View>

      <ActionBar>
        <Button
          label={working ? 'Working' : store.paused ? 'Resume the assistant' : 'Pause the assistant'}
          variant={store.paused ? 'secondary' : 'destructive'}
          busy={working}
          onPress={() => void toggle()}
        />
      </ActionBar>
    </Screen>
  );
}
