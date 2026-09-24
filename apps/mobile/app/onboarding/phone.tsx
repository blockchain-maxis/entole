import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { DirectoryError } from '@entole/core/directory';
import { initialsFor } from '@entole/core/profile';

import { Button } from '@/components/ui/Button';
import { Keypad } from '@/components/ui/Keypad';
import { StepDots } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';

const MAX_DIGITS = 10;

/** Grouped the way a Nigerian number is read aloud: 803 412 9977. */
function groupNumber(digits: string): string {
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean);
  return parts.join(' ');
}

export default function PhoneStep() {
  const router = useRouter();
  const { account } = useAccount();
  const backend = useBackend();
  const [digits, setDigits] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function press(key: string) {
    if (key === '⌫') return setDigits((current) => current.slice(0, -1));
    if (key === '.') return;
    setDigits((current) => (current.length >= MAX_DIGITS ? current : current + key));
  }

  async function submit() {
    if (digits.length < MAX_DIGITS || claiming || !account) return;
    setClaiming(true);
    setProblem(null);
    try {
      await backend.directory.claim({
        address: account.owner.address,
        name: account.displayName,
        initials: initialsFor(account.displayName),
        tone: 1,
        phone: { country: 'ng', number: digits },
      });
      router.push('/onboarding/first-payment');
    } catch (error) {
      setProblem(error instanceof DirectoryError ? error.message : "That didn't go through. Try again.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Screen>
      <View className="flex-none flex-row items-center gap-3.5 px-gutter pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={14}
          onPress={() => router.back()}
        >
          <Text className="font-body text-title text-slate">←</Text>
        </Pressable>
        <StepDots total={4} done={3} />
      </View>

      <View className="flex-1 px-7 pt-[34px]">
        <Text className="font-strong text-title-xl text-ink">Confirm your number</Text>
        <Text className="mt-3 font-body text-body-sm text-slate">
          This is how friends and family find you — they can pay you by number instead of a long code.
        </Text>

        <View className="mt-7 flex-row gap-2.5">
          <View className="flex-none flex-row items-center gap-2 rounded-control border border-line bg-card px-3.5 py-4">
            <Text tabular className="font-strong text-body-lg text-ink">
              +234
            </Text>
            <Text className="font-body text-caption-sm text-mist">▾</Text>
          </View>
          <View className="flex-1 justify-center rounded-control border-[1.5px] border-indigo bg-card px-4 py-4">
            <Text tabular className="font-strong text-body-lg text-ink">
              {digits.length > 0 ? groupNumber(digits) : ' '}
            </Text>
          </View>
        </View>

        <Text className="mt-4 font-body text-label-sm text-mist">
          Only your name and your number are made findable — nothing else about your account.
        </Text>
        {problem ? <Text className="mt-3 font-body text-label-sm text-halt">{problem}</Text> : null}
      </View>

      <View className="flex-none px-3.5 pb-2.5">
        <Keypad onKey={press} />
        <View className="mt-3 flex-row">
          <Button
            label={claiming ? 'Confirming…' : 'Confirm'}
            busy={claiming}
            disabled={digits.length < MAX_DIGITS || claiming}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </Screen>
  );
}
