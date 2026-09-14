import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Header } from '@/components/ui/Header';
import { ContactRow } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import type { Contact } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

/** Recipients are people. There is nothing else here to pick. */
export default function PickRecipient() {
  const router = useRouter();
  const store = useStore();

  return (
    <Screen>
      <Header title="Who are you paying?" />

      {store.status === 'loading' ? (
        <View className="gap-2 px-gutter">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </View>
      ) : (
        <FlashList<Contact>
          data={store.contacts}
          keyExtractor={(contact) => contact.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View className="h-2" />}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ContactRow
              contact={item}
              trailing={<Text className="font-strong text-caption-sm text-indigo">Send</Text>}
              onPress={() => router.replace({ pathname: '/send', params: { contactId: item.id } })}
            />
          )}
        />
      )}
    </Screen>
  );
}
