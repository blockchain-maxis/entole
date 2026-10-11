import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { ActivityRow, byAssistant } from '@/components/ui/ActivityRow';
import { Header } from '@/components/ui/Header';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { ActivityRowSkeleton } from '@/components/ui/Skeleton';
import type { Activity } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { useLiveRefresh } from '@/lib/reload';

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

  // Keep the feed current on its own while it is open.
  useLiveRefresh();

  return (
    <Screen>
      <Header title="Activity" />

      <FlashList<Activity>
        data={loading ? [] : store.activity}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <SectionHeading title="Payments" className="pt-2" />

            {loading ? (
              <View>
                <ActivityRowSkeleton />
                <ActivityRowSkeleton />
                <ActivityRowSkeleton />
                <ActivityRowSkeleton />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const previous = store.activity[index - 1];
          return (
            <ActivityRow
              entry={item}
              contact={store.contact(item.contactId)}
              ruled={Boolean(previous) && !byAssistant(item) && !byAssistant(previous!)}
              onPress={() => router.push({ pathname: '/activity/[id]', params: { id: item.id } })}
            />
          );
        }}
      />
    </Screen>
  );
}
