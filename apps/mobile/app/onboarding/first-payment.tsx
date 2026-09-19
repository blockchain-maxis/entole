import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ContactRow, StepDots } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatNaira, kobo } from '@entole/core/money';
import { markOnboarded } from '@/lib/session';
import { useStore } from '@entole/core/store';

/** Last step. Picking a person is the whole task — nothing else is asked for. */
export default function FirstPayment() {
  const router = useRouter();
  const store = useStore();
  const [leaving, setLeaving] = useState(false);

  async function finish(next: '/(tabs)' | '/send', contactId?: string) {
    if (leaving) return;
    setLeaving(true);
    await markOnboarded();
    if (next === '/send' && contactId) router.replace({ pathname: '/send', params: { contactId } });
    else router.replace('/(tabs)');
  }

  return (
    <Screen>
      <View className="flex-none flex-row items-center justify-between px-gutter pt-2">
        <View className="flex-row items-center gap-3.5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={14}
            onPress={() => router.back()}
          >
            <Text className="font-body text-title text-slate">←</Text>
          </Pressable>
          <StepDots total={4} done={4} />
        </View>
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => void finish('/(tabs)')}>
          <Text className="font-strong text-label text-indigo">Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 16 }}
      >
        <Text className="font-strong text-title-xl text-ink">Send your first payment</Text>
        <Text className="mt-3 font-body text-body-sm text-slate">
          Pick someone from your contacts. They don’t need Entole to receive it.
        </Text>

        <View className="mt-[22px] flex-row items-center gap-3 rounded-control border border-line bg-card px-4 py-3.5">
          <View className="h-[15px] w-[15px] flex-none rounded-pill border-2 border-mist" />
          <Text className="font-body text-body-sm text-mist">Search contacts</Text>
        </View>

        <View className="mt-[18px] gap-2">
          {store.status === 'loading' ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            store.contacts.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                trailing={<Text className="font-strong text-caption-sm text-indigo">Send</Text>}
                onPress={() => void finish('/send', contact.id)}
              />
            ))
          )}
        </View>
      </ScrollView>

      <View className="flex-none border-t border-hairline px-gutter-lg pb-2.5 pt-3">
        <View className="flex-row items-baseline justify-between px-0.5 pb-3">
          <Text className="font-strong text-label-sm text-slate">Your balance is ready</Text>
          <Text tabular className="font-strong text-body-sm text-ink">
            {formatNaira(kobo(0))}
          </Text>
        </View>
        <View className="flex-row">
          <Button
            label="Add money first"
            variant="secondary"
            onPress={() => void finish('/(tabs)')}
          />
        </View>
      </View>
    </Screen>
  );
}
