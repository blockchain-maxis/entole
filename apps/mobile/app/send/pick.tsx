import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { countryName } from '@entole/core/countries';
import type { Contact } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ContactRow } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';

/** Recipients are people you have added. There is nothing else to pick. */
export default function PickRecipient() {
  const router = useRouter();
  const store = useStore();

  return (
    <Screen>
      <Header title="Who are you sending to?" />

      {store.status === 'loading' ? (
        <View className="gap-2 px-gutter">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </View>
      ) : store.status === 'failed' ? (
        <View className="flex-1 justify-center px-gutter-lg pb-16">
          <Text className="font-strong text-title text-ink">We couldn&apos;t load your beneficiaries.</Text>
          <Text className="mt-2 font-body text-body-sm text-slate">
            Check your connection and try again.
          </Text>
          <View className="mt-5 flex-row">
            <Button label="Try again" variant="secondary" width="hug" onPress={() => void store.refresh()} />
          </View>
        </View>
      ) : store.contacts.length === 0 ? (
        <View className="flex-1 justify-center px-gutter-lg pb-16">
          <Text className="font-strong text-title text-ink">No beneficiaries yet</Text>
          <Text className="mt-2 font-body text-body-sm text-slate">
            Add someone with their payment code, then send them money.
          </Text>
        </View>
      ) : (
        <FlashList<Contact>
          data={store.contacts}
          keyExtractor={(contact) => contact.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View className="h-2" />}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const where = countryName(item.place);
            return (
              <ContactRow
                contact={item}
                {...(where ? { caption: where } : {})}
                trailing={<Text className="font-strong text-caption-sm text-indigo">Send</Text>}
                onPress={() => router.replace({ pathname: '/send', params: { contactId: item.id } })}
              />
            );
          }}
        />
      )}

      <ActionBar>
        <Button
          label="Add a beneficiary"
          variant={store.contacts.length === 0 ? 'primary' : 'secondary'}
          onPress={() => router.push({ pathname: '/beneficiaries/new', params: { next: 'send' } })}
        />
      </ActionBar>
    </Screen>
  );
}
