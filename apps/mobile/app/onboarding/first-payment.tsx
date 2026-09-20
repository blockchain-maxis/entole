import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { countryName } from '@entole/core/countries';
import { formatNaira } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Button } from '@/components/ui/Button';
import { ContactRow, StepDots } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { markOnboarded } from '@/lib/session';

type Destination = { to: 'home' } | { to: 'send'; contactId: string } | { to: 'pick' } | { to: 'add-money' };

/** Last step. Picking a person is the whole task — nothing else is asked for. */
export default function FirstPayment() {
  const router = useRouter();
  const store = useStore();
  const [leaving, setLeaving] = useState(false);

  const loading = store.status === 'loading';
  const empty = !loading && store.contacts.length === 0;
  const noMoney = !loading && store.status === 'ready' && store.balance <= 0;

  async function finish(destination: Destination) {
    if (leaving) return;
    setLeaving(true);
    await markOnboarded();
    if (destination.to === 'send') {
      router.replace({ pathname: '/send', params: { contactId: destination.contactId } });
    } else if (destination.to === 'pick') {
      router.replace('/(tabs)');
      router.push('/send/pick');
    } else if (destination.to === 'add-money') {
      router.replace('/(tabs)');
      router.push('/add-money');
    } else {
      router.replace('/(tabs)');
    }
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
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => void finish({ to: 'home' })}>
          <Text className="font-strong text-label text-indigo">Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 16 }}
      >
        <Text className="font-strong text-title-xl text-ink">Send your first payment</Text>
        <Text className="mt-3 font-body text-body-sm text-slate">
          {empty
            ? 'Send money to someone with their code or the link they shared.'
            : 'Choose who you are sending to, or use a code or link.'}
        </Text>

        <View className="mt-[22px] gap-2">
          {loading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            store.contacts.map((contact) => {
              const where = countryName(contact.place);
              return (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  {...(where ? { caption: where } : {})}
                  trailing={<Text className="font-strong text-caption-sm text-indigo">Send</Text>}
                  onPress={() => void finish({ to: 'send', contactId: contact.id })}
                />
              );
            })
          )}
        </View>
      </ScrollView>

      <View className="flex-none border-t border-hairline px-gutter-lg pb-2.5 pt-3">
        <View className="flex-row items-baseline justify-between px-0.5 pb-3">
          <Text className="font-strong text-label-sm text-slate">Your balance</Text>
          {loading ? (
            <Skeleton className="h-4 w-20 rounded-md" />
          ) : (
            <Text tabular className="font-strong text-body-sm text-ink">
              {formatNaira(store.balance)}
            </Text>
          )}
        </View>
        <View className="gap-2.5">
          <View className="flex-row">
            <Button
              label="Use a code or link"
              variant={empty ? 'primary' : 'secondary'}
              onPress={() => void finish({ to: 'pick' })}
            />
          </View>
          {noMoney ? (
            <View className="flex-row">
              <Button
                label="Add money first"
                variant="secondary"
                onPress={() => void finish({ to: 'add-money' })}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
