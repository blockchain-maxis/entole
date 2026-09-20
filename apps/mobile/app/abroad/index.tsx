import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { useStore } from '@entole/core/store';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { ContactRow, SectionHeading } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { groupByCountry } from '@/lib/send';

/** Send abroad starts from the country the beneficiary is in, then the person. */
export default function SendAbroad() {
  const router = useRouter();
  const store = useStore();
  const loading = store.status === 'loading';

  const groups = useMemo(() => groupByCountry(store.contacts), [store.contacts]);

  return (
    <Screen>
      <Header title="Send abroad" trailing={<PauseButton />} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View className="gap-2">
            <RowSkeleton />
            <RowSkeleton />
          </View>
        ) : store.status === 'failed' ? (
          <View className="pt-6">
            <Text className="font-strong text-body text-ink">We couldn&apos;t load your beneficiaries.</Text>
            <Text className="mt-1.5 font-body text-label-sm text-slate">
              Check your connection and try again.
            </Text>
            <View className="mt-4 flex-row">
              <Button label="Try again" variant="secondary" width="hug" onPress={() => void store.refresh()} />
            </View>
          </View>
        ) : groups.length === 0 ? (
          <View className="pt-6">
            <Text className="font-strong text-title text-ink">No beneficiaries yet</Text>
            <Text className="mt-2 font-body text-body-sm text-slate">
              Add someone with their payment code and their country, and they appear here under it.
            </Text>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.code ?? 'none'} className="pb-6">
              <SectionHeading title={group.name} />
              {group.code === null ? (
                <Text className="-mt-1.5 px-1 pb-3 font-body text-label-sm text-slate">
                  Set their country under Beneficiaries to see them with the others.
                </Text>
              ) : null}
              <View className="gap-2">
                {group.contacts.map((contact) => (
                  <ContactRow
                    key={contact.id}
                    contact={contact}
                    trailing={<Text className="font-strong text-caption-sm text-indigo">Send</Text>}
                    onPress={() => router.push({ pathname: '/send', params: { contactId: contact.id } })}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <ActionBar>
        <Button
          label="Add a beneficiary"
          variant={groups.length === 0 && !loading ? 'primary' : 'secondary'}
          onPress={() => router.push('/beneficiaries/new')}
        />
      </ActionBar>
    </Screen>
  );
}
