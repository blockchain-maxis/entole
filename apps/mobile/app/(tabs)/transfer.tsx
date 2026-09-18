import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { ContactRow, SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import type { Contact } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

/** The corridor, one tap away. Everyone here is a person, not an address. */
export default function Transfer() {
  const router = useRouter();
  const store = useStore();
  const loading = store.status === 'loading';

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Transfer" trailing={<PauseButton />} />

      <View className="flex-row gap-3 px-5 pt-1 pb-6">
        <Button label="Send" onPress={() => router.push('/send')} />
        <Button label="Request" variant="secondary" onPress={() => router.push('/receive')} />
      </View>

      <SectionHeading title="Contacts" className="px-5" />

      {loading ? (
        <View className="gap-2 px-5">
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
              onPress={() => router.push({ pathname: '/send', params: { contactId: item.id } })}
            />
          )}
        />
      )}
    </Screen>
  );
}
