import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StepDots } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { token } from '@entole/tokens';
import { useAccount } from '@/lib/account';
import { storeDisplayName } from '@/lib/session';

/**
 * The one onboarding field that isn't money — a plain text input is correct
 * here, not the numeric `Keypad`. Every screen after this one can finally
 * say a real name instead of a placeholder.
 */
export default function NameStep() {
  const router = useRouter();
  const { account, setAccount } = useAccount();
  const [name, setName] = useState('');

  const trimmed = name.trim();

  async function submit() {
    if (!trimmed) return;
    await storeDisplayName(trimmed);
    if (account) setAccount({ ...account, displayName: trimmed });
    router.push('/onboarding/phone');
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
        <StepDots total={4} done={2} />
      </View>

      <View className="flex-1 px-7 pt-[34px]">
        <Text className="font-strong text-title-xl text-ink">What should we call you?</Text>
        <Text className="mt-3 font-body text-body-sm text-slate">
          This is how Entole greets you — nothing else sees it.
        </Text>

        <View className="mt-7 rounded-control border-[1.5px] border-indigo bg-card px-4 py-4">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={token.mist}
            autoFocus
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            className="font-strong text-body-lg text-ink"
            style={{ padding: 0 }}
          />
        </View>
      </View>

      <View className="flex-none px-gutter-lg pb-2.5 pt-3">
        <View className="flex-row">
          <Button label="Continue" disabled={!trimmed} onPress={() => void submit()} />
        </View>
      </View>
    </Screen>
  );
}
