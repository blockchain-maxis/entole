import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ActivityRow } from '@/components/ui/ActivityRow';
import { Header } from '@/components/ui/Header';
import { Meter } from '@/components/ui/Meter';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatNaira, kobo, remaining } from '@entole/core/money';
import type { Activity } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

/**
 * The full feed, plus the shared pots it rolls up into.
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
            {store.pots.length > 0 ? (
              <>
                <SectionHeading title="Shared pots" className="pt-2" />
                <View className="gap-2.5 pb-2">
                  {store.pots.map((pot) => {
                    const outstanding = remaining(kobo(pot.targetMinor), kobo(pot.collectedMinor));
                    const fraction = pot.targetMinor > 0 ? pot.collectedMinor / pot.targetMinor : 0;
                    return (
                      <Pressable
                        key={pot.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${pot.name}, ${formatNaira(outstanding)} still owed`}
                        onPress={() => router.push({ pathname: '/pots/[id]', params: { id: pot.id } })}
                        className="rounded-row border border-line bg-card px-4 pb-[18px] pt-4 active:border-mist"
                      >
                        <View className="flex-row items-start justify-between gap-3">
                          <Text className="flex-1 font-strong text-body text-ink">{pot.name}</Text>
                          <Text className="pt-0.5 font-strong text-caption-sm text-mist">
                            {pot.members.length} people
                          </Text>
                        </View>
                        <View className="mt-3 flex-row items-baseline gap-1.5">
                          <Text tabular className="font-strong text-amount-sm text-ink">
                            {formatNaira(kobo(pot.collectedMinor))}
                          </Text>
                          <Text tabular className="font-body text-label-sm text-slate">
                            of {formatNaira(kobo(pot.targetMinor))}
                          </Text>
                        </View>
                        <View className="mt-3.5">
                          <Meter fraction={fraction} tone="settled" label={`${pot.name} collected`} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <SectionHeading title="Payments" className="pt-6" />

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
            onPress={
              item.allowanceId ? () => router.push({ pathname: '/rules/[id]', params: { id: item.allowanceId! } }) : undefined
            }/>
        )}
      />
    </Screen>
  );
}
