import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Keypad } from '@/components/ui/Keypad';
import { StepDots } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';

const MAX_DIGITS = 10;

/** Grouped the way a Nigerian number is read aloud: 803 412 9977. */
function groupNumber(digits: string): string {
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean);
  return parts.join(' ');
}

export default function PhoneStep() {
  const router = useRouter();
  const [digits, setDigits] = useState('');

  function press(key: string) {
    if (key === '⌫') return setDigits((current) => current.slice(0, -1));
    if (key === '.') return;
    setDigits((current) => (current.length >= MAX_DIGITS ? current : current + key));
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
        <StepDots total={3} done={2} />
      </View>

      <View className="flex-1 px-7 pt-[34px]">
        <Text className="font-strong text-title-xl text-ink">Confirm your number</Text>
        <Text className="mt-3 font-body text-body-sm text-slate">
          This is how friends and family find you. We’ll text you a six-digit code.
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
          We never post, message anyone, or share your number.
        </Text>
      </View>

      <View className="flex-none px-3.5 pb-2.5">
        <Keypad onKey={press} />
        <View className="mt-3 flex-row">
          <Button
            label="Send code"
            disabled={digits.length < MAX_DIGITS}
            onPress={() => router.push('/onboarding/first-payment')}
          />
        </View>
      </View>
    </Screen>
  );
}
