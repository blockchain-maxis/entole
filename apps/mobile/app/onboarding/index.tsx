import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { registerAccount } from '@/lib/session';

const PROMISES = ['No password to remember', 'Your face is the key', 'Ready in half a minute'];

/**
 * Sign-in is a biometric check. There is no phrase to write down, so there is
 * nothing here to lose, screenshot or be talked out of.
 */
export default function Welcome() {
  const router = useRouter();
  const { setAccount } = useAccount();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setProblem(null);
    const result = await registerAccount('Entole account');
    setBusy(false);
    if (result.ok) {
      setAccount(result.account);
      router.push('/onboarding/phone');
    } else {
      setProblem(result.reason);
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
          <Button label="Continue with Face ID" busy={busy} onPress={() => void start()} />
        </View>
        <Text className="mt-3.5 text-center font-body text-caption text-mist">
          By continuing you agree to our terms and privacy notice.
        </Text>
      </View>
    </Screen>
  );
}
