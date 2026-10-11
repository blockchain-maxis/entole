import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { BrandMark } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { lockScreen } from '@/lib/lock-state';
import { hasStoredCredential, reauthenticate } from '@/lib/session';

/**
 * A stale session re-prompts here rather than lapsing into a screen that
 * still looks signed in. Non-dismissible on purpose — there is no "not now."
 */
export default function Lock() {
  const router = useRouter();
  const { setAccount } = useAccount();
  const [reason, setReason] = useState<string | null>(null);
  // Starts true: the effect below always begins checking immediately on
  // mount, so there is no synchronous frame where this should read false.
  const [checking, setChecking] = useState(true);
  const [attempts, setAttempts] = useState(0);

  // Tells the tabs' session guard this screen is up, so it does not stack a
  // second one when the passkey sheet closes and the app returns to the front.
  useEffect(() => {
    lockScreen.visible = true;
    return () => {
      lockScreen.visible = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // There is no passkey to confirm, so this screen could never succeed —
      // send the person to set one up rather than leave them here.
      if (!(await hasStoredCredential())) {
        if (!cancelled) router.replace('/onboarding');
        return;
      }

      const result = await reauthenticate();
      if (cancelled) return;
      if (result.ok) {
        setAccount(result.account);
        router.replace('/(tabs)');
      } else {
        setReason(result.reason);
      }
      setChecking(false);
    }

    void run();

    return () => {
      cancelled = true;
    };
    // Re-runs only when the person taps "Try again" (bumps `attempts`) — not
    // a dependency loop, a deliberate retry trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts]);

  function retry() {
    setChecking(true);
    setReason(null);
    setAttempts((n) => n + 1);
  }

  return (
    <Screen>
      <View className="h-16 flex-none flex-row items-center gap-2.5 px-gutter-lg">
        <BrandMark />
      </View>

      <View className="flex-1 justify-end px-gutter-lg pb-6">
        <Text accessibilityRole="header" className="font-display text-figure-sm text-ink">
          Confirm it&apos;s you
        </Text>
        <Text className="mt-3 font-body text-prose text-slate">
          Your session timed out. Nothing here moves until you do.
        </Text>
        {reason ? <Text className="mt-4 font-body text-ui text-halt">{reason}</Text> : null}
      </View>

      <View className="flex-none flex-row px-gutter-lg pb-2.5 pt-3">
        <Button label={checking ? 'Checking' : 'Try again'} busy={checking} disabled={checking} onPress={retry} />
      </View>
    </Screen>
  );
}
