import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { markOnboarded, registerAccount, signInWithExistingPasskey } from '@/lib/session';

const PROMISES = ['No password to remember', 'Your phone unlock is the key', 'Ready in half a minute'];

/**
 * Sign-in is a passkey — confirmed with whatever unlocks the phone (face,
 * fingerprint or screen lock). There is no phrase to write down, so there is
 * nothing here to lose, screenshot or be talked out of.
 */
export default function Welcome() {
  const router = useRouter();
  const { setAccount } = useAccount();
  // Which of the two buttons is waiting on the passkey prompt, if either.
  const [busy, setBusy] = useState<'new' | 'existing' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function start() {
    setBusy('new');
    setProblem(null);
    const result = await registerAccount('Entole account');
    setBusy(null);
    if (result.ok) {
      setAccount(result.account);
      router.push('/onboarding/name');
    } else {
      setProblem(result.reason);
    }
  }

  /**
   * For someone whose account was made on another device. Asks for the
   * passkey that account was made with and makes nothing new; without this,
   * a new phone could only ever start a new, empty account.
   */
  async function signIn() {
    setBusy('existing');
    setProblem(null);
    const result = await signInWithExistingPasskey();
    setBusy(null);
    if (!result.ok) {
      setProblem(result.reason);
      return;
    }
    setAccount(result.account);
    if (result.account.displayName) {
      await markOnboarded();
      router.replace('/(tabs)');
    } else {
      router.push({ pathname: '/onboarding/name', params: { returning: '1' } });
    }
  }

  return (
    <Screen>
      <View className="flex-1 justify-center px-7">
        <View className="h-[46px] w-[46px] items-center justify-center rounded-control bg-ink">
          <Text className="font-heavy text-title text-paper">E</Text>
        </View>

        <Text className="mt-7 font-strong text-hero text-ink">Money that moves like a message</Text>
        <Text className="mt-4 font-body text-body-lg text-slate">
          Send naira home, share costs with friends, and set limits Entole will keep for you.
        </Text>

        <View className="mt-[30px] gap-3">
          {PROMISES.map((promise) => (
            <View key={promise} className="flex-row items-center gap-3">
              <View className="h-5 w-5 flex-none items-center justify-center rounded-pill bg-settled-wash">
                <Text className="font-heavy text-caption-sm text-settled">✓</Text>
              </View>
              <Text className="font-body text-label text-slate">{promise}</Text>
            </View>
          ))}
        </View>

        {problem ? (
          <Text className="mt-6 font-body text-label-sm text-halt">{problem}</Text>
        ) : null}
      </View>

      <View className="flex-none px-gutter-lg pb-2.5 pt-3">
        <View className="flex-row">
          <Button
            label="Continue with passkey"
            busy={busy === 'new'}
            disabled={busy !== null}
            onPress={() => void start()}
          />
        </View>
        <View className="mt-1 flex-row">
          <Button
            label="I already have an account"
            variant="quiet"
            busy={busy === 'existing'}
            disabled={busy !== null}
            onPress={() => void signIn()}
          />
        </View>
        <Text className="mt-3.5 text-center font-body text-caption text-mist">
          By continuing you agree to our terms and privacy notice.
        </Text>
      </View>
    </Screen>
  );
}
