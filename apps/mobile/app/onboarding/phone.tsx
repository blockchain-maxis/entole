import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { DirectoryError } from '@entole/core/directory';
import { normalizeNigerianNumber } from '@entole/core/handle';
import { initialsFor } from '@entole/core/profile';

import { Button } from '@/components/ui/Button';
import { Keypad } from '@/components/ui/Keypad';
import { StepDots } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';

/** A Nigerian number is ten digits, or eleven written the way people say it,
 * with the zero in front. Both are taken; the zero is dropped before the
 * number is kept, so nobody has to know to leave it off. */
function maxDigits(digits: string): number {
  return digits.startsWith('0') ? 11 : 10;
}

/** Grouped the way a Nigerian number is read aloud: 0803 412 9977, or 803 412 9977. */
function groupNumber(digits: string): string {
  const lead = digits.startsWith('0') ? 4 : 3;
  const parts = [digits.slice(0, lead), digits.slice(lead, lead + 3), digits.slice(lead + 3, lead + 7)].filter(Boolean);
  return parts.join(' ');
}

const NOT_A_NUMBER = "That doesn't look like a Nigerian mobile number. Check it and try again.";

export default function PhoneStep() {
  const router = useRouter();
  const { account } = useAccount();
  const backend = useBackend();
  const [digits, setDigits] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The ten digits the number is kept as, whichever way it was typed.
  const number = normalizeNigerianNumber(digits);
  const complete = digits.length >= maxDigits(digits);

  function press(key: string) {
    setProblem(null);
    if (key === '⌫') return setDigits((current) => current.slice(0, -1));
    if (key === '.') return;
    setDigits((current) => (current.length >= maxDigits(current) ? current : current + key));
  }

  async function submit() {
    if (!number || claiming || !account) return;
    setClaiming(true);
    setProblem(null);
    try {
      await backend.directory.claim({
        address: account.owner.address,
        name: account.displayName,
        initials: initialsFor(account.displayName),
        tone: 1,
        phone: { country: 'ng', number },
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
          <Text className="font-body text-subhead text-slate">←</Text>
        </Pressable>
        <StepDots total={4} done={3} />
      </View>

      <View className="flex-1 px-7 pt-[34px]">
        <Text className="font-display text-heading text-ink">Confirm your number</Text>
        <Text className="mt-3 font-body text-ui text-slate">
          This is how friends and family find you. They can pay you with just your number.
        </Text>

        <View className="mt-7 flex-row gap-2.5">
          <View className="flex-none flex-row items-center gap-2 rounded-control border border-line bg-card px-3.5 py-4">
            <Text tabular className="font-strong text-prose text-ink">
              +234
            </Text>
            <Text className="font-body text-note text-slate">▾</Text>
          </View>
          <View className="flex-1 justify-center rounded-control border-[1.5px] border-ink bg-card px-4 py-4">
            <Text tabular className="font-strong text-prose text-ink">
              {digits.length > 0 ? groupNumber(digits) : ' '}
            </Text>
          </View>
        </View>

        <Text className="mt-4 font-body text-note text-slate">
          Only your name and your number are made findable — nothing else about your account.
        </Text>
        {problem || (complete && !number) ? (
          <Text className="mt-3 font-body text-note text-halt">{problem ?? NOT_A_NUMBER}</Text>
        ) : null}
      </View>

      <View className="flex-none px-3.5 pb-2.5">
        <Keypad onKey={press} />
        <View className="mt-3 flex-row">
          <Button
            label={claiming ? 'Confirming…' : 'Confirm'}
            busy={claiming}
            disabled={!number || claiming}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </Screen>
  );
}
