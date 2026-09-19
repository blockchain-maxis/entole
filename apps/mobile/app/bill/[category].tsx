import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/lib/theme';
import { billCategory } from '@entole/core/pay-hub';

/** Whose bill it is — a meter, a line, a decoder. Not money, so the system keyboard is right here. */
export default function BillReference() {
  const router = useRouter();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ category?: string }>();
  const info = billCategory(params.category);
  const [reference, setReference] = useState('');
  const trimmed = reference.trim();

  if (!info) {
    return (
      <Screen>
        <Header title="Pay a bill" trailing={<PauseButton />} />
        <View className="flex-1 px-gutter-lg pt-6">
          <Text className="font-body text-body-sm text-slate">That kind of bill isn&apos;t one we know yet.</Text>
        </View>
      </Screen>
    );
  }

  function next() {
    if (!info || !trimmed) return;
    router.push({ pathname: '/bill/pay', params: { category: info.id, reference: trimmed } });
  }

  return (
    <Screen>
      <Header title={info.label} trailing={<PauseButton />} />

      <View className="flex-1 px-gutter-lg pt-4">
        <Text className="font-strong text-title-xl text-ink">{info.identifierLabel}</Text>
        <Text className="mt-3 font-body text-body-sm text-slate">
          We check it before any money moves, so you know whose bill it is.
        </Text>

        <View className="mt-7 rounded-control border-[1.5px] border-indigo bg-card px-4 py-4">
          <TextInput
            value={reference}
            onChangeText={setReference}
            placeholder={info.identifierLabel}
            placeholderTextColor={colors.mist}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={next}
            className="font-strong text-body-lg text-ink"
            style={{ padding: 0 }}
          />
        </View>
      </View>

      <View className="flex-none px-gutter-lg pb-2.5 pt-3">
        <View className="flex-row">
          <Button label="Continue" disabled={!trimmed} onPress={next} />
        </View>
      </View>
    </Screen>
  );
}
