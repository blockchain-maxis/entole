import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { BrandMark } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { lockScreen } from '@/lib/lock-state';
import { isPayPath } from '@/lib/recipient';
import { forgetEverything, hasStoredCredential, reauthenticate } from '@/lib/session';

/**
 * A stale session re-prompts here rather than lapsing into a screen that
 * still looks signed in. Non-dismissible on purpose — there is no "not now."
 *
 * There is one way out, offered only after an unlock has failed: start again
 * on this phone. Without it, a phone whose passkey is gone could never leave
 * this screen. It asks first, and says what it does and does not do.
 *
 * `next` is a pay link someone opened from outside the app before they were
 * signed in here: once they are back in, they go on to it. Nothing but a pay
 * link is ever followed.
 */
export default function Lock() {
  const router = useRouter();
  const { setAccount } = useAccount();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [reason, setReason] = useState<string | null>(null);
  // Starts true: the effect below always begins checking immediately on
  // mount, so there is no synchronous frame where this should read false.
  const [checking, setChecking] = useState(true);
  const [attempts, setAttempts] = useState(0);
  const [startingAgain, setStartingAgain] = useState(false);

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
        router.replace(isPayPath(next) ? (next as Href) : '/(tabs)');
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
    setStartingAgain(false);
    setAttempts((n) => n + 1);
  }

  async function startAgain() {
    await forgetEverything();
    router.replace('/onboarding');
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
        {startingAgain ? (
          <Text className="mt-4 font-body text-ui text-slate">
            This phone will forget the account it holds. The account and its money are not touched: sign back in
            with its passkey from the first screen.
          </Text>
        ) : null}
      </View>

      {startingAgain ? (
        <View className="flex-none flex-row gap-3 px-gutter-lg pb-2.5 pt-3">
          <Button label="Keep trying" variant="secondary" onPress={() => setStartingAgain(false)} />
          <Button label="Start again" variant="danger-outline" onPress={() => void startAgain()} />
        </View>
      ) : (
        <View className="flex-none px-gutter-lg pb-2.5 pt-3">
          <View className="flex-row">
            <Button label={checking ? 'Checking' : 'Try again'} busy={checking} disabled={checking} onPress={retry} />
          </View>
          {reason && !checking ? (
            <View className="mt-2 flex-row">
              <Button label="Start again on this phone" variant="quiet" onPress={() => setStartingAgain(true)} />
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
