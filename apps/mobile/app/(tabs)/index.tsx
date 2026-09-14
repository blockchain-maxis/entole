import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { AllowanceCard } from '@/components/ui/AllowanceCard';
import { ActivityRow } from '@/components/ui/ActivityRow';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { SectionHeading } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import {
  AllowanceCardSkeleton,
  BalanceSkeleton,
  RowSkeleton,
} from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { toDollars } from '@entole/core/fx';
import { formatDollars } from '@entole/core/money';
import type { Activity } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

export default function Home() {
  const router = useRouter();
  const store = useStore();
  const loading = store.status === 'loading';
  const announced = useRef(false);

  // The assistant proposes on its own; the undo window opens over the balance
  // rather than waiting to be found.
  useEffect(() => {
    if (loading || store.paused || !store.proposal || announced.current) return;
    announced.current = true;
    const timer = setTimeout(() => router.push('/assistant-action'), 1200);
    return () => clearTimeout(timer);
  }, [loading, router, store.paused, store.proposal]);

  return (
    <Screen>
      <Header leading="brand" />

      <FlashList<Activity>
        data={loading ? [] : store.activity}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {loading ? (
              <BalanceSkeleton />
            ) : (
              <View className="px-1 pb-[34px] pt-[22px]">
                <Text className="font-strong text-label-sm text-mist">Available balance</Text>
                <View className="mt-2.5">
                  <Amount value={store.balance} />
                </View>
                <Text tabular className="mt-3 font-body text-body-sm text-slate">
                  ≈ {formatDollars(toDollars(store.balance, store.rate))}
                </Text>
              </View>
            )}

            <SectionHeading
              title="Allowances"
              action="Manage"
              onActionPress={() => router.push('/rules/new')}
            />

            <View className="gap-2.5">
              {loading ? (
                <>
                  <AllowanceCardSkeleton />
                  <AllowanceCardSkeleton />
                  <AllowanceCardSkeleton />
                </>
              ) : (
                store.allowances.map((allowance) => (
                  <AllowanceCard
                    key={allowance.id}
                    allowance={allowance}
                    resetsAt={allowance.resetsAt}
                    onPress={() => router.push({ pathname: '/rules/[id]', params: { id: allowance.id } })}
                  />
                ))
              )}
            </View>

            <SectionHeading
              title="Recent activity"
              action="All"
              className="pt-[30px]"
              onActionPress={() => router.push('/activity')}
            />

            {loading ? (
              <View className="gap-2">
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
              item.allowanceId ? () => router.push({ pathname: '/rules/[id]', params: { id: item.allowanceId } }) : undefined
            }
          />
        )}
      />

      {store.paused ? <PausedBanner onResume={() => void store.setPaused(false)} /> : null}

      <ActionBar divided>
        <Button label="Send money" onPress={() => router.push('/send')} />
        <Button label="Receive" variant="secondary" onPress={() => router.push('/receive')} />
      </ActionBar>
    </Screen>
  );
}

function PausedBanner({ onResume }: { onResume: () => void }) {
  return (
    <View className="mx-gutter mb-2 flex-row items-center gap-3 rounded-control bg-ink px-4 py-3.5">
      <View className="h-2.5 w-2.5 flex-none rounded-[2px] bg-halt" />
      <Text className="flex-1 font-body text-label text-paper">
        All allowances paused. Nothing is lost.
      </Text>
      <Pressable accessibilityRole="button" hitSlop={10} onPress={onResume}>
        <Text className="font-strong text-label text-card underline">Resume</Text>
      </Pressable>
    </View>
  );
}
