import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { countryName } from '@entole/core/countries';
import { toContact, type Beneficiary } from '@entole/core/records';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ContactRow } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; list: Beneficiary[] };

/** The small print under a name: who they are, where they are, what is on file. */
function captionFor(beneficiary: Beneficiary): string {
  return [
    beneficiary.nickname ? beneficiary.name : null,
    countryName(beneficiary.country) ?? null,
    beneficiary.bank ? 'Bank details saved' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Everyone the person can pay, in one place to add, edit and remove. */
export default function Beneficiaries() {
  const router = useRouter();
  const { source } = useBackend();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const read = useCallback(() => {
    let live = true;
    source
      .listBeneficiaries()
      .then((list) => live && setLoad({ state: 'ready', list }))
      .catch(() => live && setLoad({ state: 'failed' }));
    return () => {
      live = false;
    };
  }, [source]);

  // Read again every time this screen comes back into view — after adding or
  // editing, the list is already current.
  useFocusEffect(read);

  return (
    <Screen>
      <Header title="Beneficiaries" />

      {load.state === 'loading' ? (
        <View className="gap-2 px-gutter">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </View>
      ) : load.state === 'failed' ? (
        <View className="flex-1 items-center justify-center px-gutter-lg">
          <Text className="text-center font-strong text-body text-ink">We couldn&apos;t load your beneficiaries.</Text>
          <Text className="mt-1.5 text-center font-body text-label-sm text-slate">
            Nothing has been changed. Check your connection and try again.
          </Text>
          <View className="mt-5 flex-row">
            <Button
              label="Try again"
              variant="secondary"
              width="hug"
              onPress={() => {
                setLoad({ state: 'loading' });
                read();
              }}
            />
          </View>
        </View>
      ) : load.list.length === 0 ? (
        <View className="flex-1 justify-center px-gutter-lg pb-16">
          <Text className="font-strong text-title text-ink">No beneficiaries yet</Text>
          <Text className="mt-2 font-body text-body-sm text-slate">
            Add someone with their payment code, and you can send them money in a few taps.
          </Text>
        </View>
      ) : (
        <FlashList<Beneficiary>
          data={load.list}
          keyExtractor={(beneficiary) => beneficiary.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View className="h-2" />}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const contact = toContact(item);
            return (
              <ContactRow
                contact={contact}
                caption={captionFor(item)}
                accessibilityLabel={`Edit ${contact.name}`}
                trailing={<Text className="font-strong text-caption-sm text-indigo">Edit</Text>}
                onPress={() => router.push({ pathname: '/beneficiaries/[id]', params: { id: item.id } })}
              />
            );
          }}
        />
      )}

      <ActionBar>
        <Button label="Add a beneficiary" onPress={() => router.push('/beneficiaries/new')} />
      </ActionBar>
    </Screen>
  );
}
