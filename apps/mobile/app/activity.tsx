import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { ActivityRow } from '@/components/ui/ActivityRow';
import { Header } from '@/components/ui/Header';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import type { Activity } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

/**
 * The full feed.
 *
 * There is no export for this screen in `design/`; it follows the patterns in
 * docs/DESIGN.md and is the only route in the app that does.
 */
export default function AllActivity() {
  const router = useRouter();
  const store = useStore();
  const loading = store.status === 'loading';

  return (
    <Screen>
      <Header title="Activity" />

      <FlashList<Activity>
        data={loading ? [] : store.activity}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <SectionHeading title="Payments" className="pt-2" />

            {loading ? (
              <View className="gap-2">
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <ActivityRow
            entry={item}
            contact={store.contact(item.contactId)}
            onPress={() => router.push({ pathname: '/activity/[id]', params: { id: item.id } })}
          />
        )}
      />
    </Screen>
  );
}
