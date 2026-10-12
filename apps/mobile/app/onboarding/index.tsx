import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { BrandMark } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { markOnboarded, registerAccount, signInWithExistingPasskey } from '@/lib/session';

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
      <View className="h-16 flex-none flex-row items-center gap-2.5 px-gutter-lg">
        <BrandMark />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 24, paddingBottom: 20 }}
      >
        {/* The product in one glance: an instruction, written once, in the assistant's blue. */}
        <View className="mb-8 mt-4 rounded-card bg-card p-5 shadow-raised">
          <Text className="font-body text-note text-slate">You write it once</Text>
          <Text className="mt-2 font-display-plain text-subhead text-indigo">
            Send ₦50,000 to Mum every month, never more than ₦100,000 a month.
          </Text>
          <Text className="mt-3 font-body text-ui text-slate">
            The assistant can pay inside it, and never past it.
          </Text>
        </View>

        <Text accessibilityRole="header" className="font-display text-figure-sm text-ink">
          Money that moves like a message
        </Text>
        <Text className="mt-3 font-body text-prose text-slate">
          Send naira home, share costs with friends, and set limits Entole will keep for you. No password to
          remember: your phone unlock is the key.
        </Text>

        {problem ? <Text className="mt-5 font-body text-ui text-halt">{problem}</Text> : null}
      </ScrollView>

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
        <Text className="mt-3.5 text-center font-body text-note text-slate">
          By continuing you agree to our{' '}
          <Text accessibilityRole="link" className="underline" onPress={() => router.push('/legal/terms')}>
            terms
          </Text>{' '}
          and{' '}
          <Text accessibilityRole="link" className="underline" onPress={() => router.push('/legal/privacy')}>
            privacy notice
          </Text>
          .
        </Text>
      </View>
    </Screen>
  );
}
