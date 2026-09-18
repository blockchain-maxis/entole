import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { AllowanceCard } from '@/components/ui/AllowanceCard';
import { ActivityRow } from '@/components/ui/ActivityRow';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
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
  const { height } = useWindowDimensions();

  useEffect(() => {
    if (loading || !store.proposal || announced.current) return;
    announced.current = true;
    const timer = setTimeout(() => router.push('/assistant-action'), 1200);
    return () => clearTimeout(timer);
  }, [loading, router, store.proposal]);

  return (
    <Screen edges={{ bottom: false }}>
      <Header leading="brand" trailing={<PauseButton />} />
      <View className="px-5 pt-2 pb-4">
        <Text className="font-strong text-headline text-ink">Good morning, Evan 👋</Text>
      </View>

      <FlashList<Activity>
        data={loading ? [] : store.activity.slice(0, 5)}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {loading ? (
              <View className="px-5"><BalanceSkeleton /></View>
            ) : (
              <View
                style={{ height: height * 0.3 }}
                className="mx-5 mb-5 rounded-panel bg-card p-6 justify-center shadow-raised"
              >
                <Text className="font-strong text-label-sm text-mist">Available balance</Text>
                <View className="mt-2.5">
                  <Amount value={store.balance} />
                </View>
                <Text tabular className="mt-3 font-body text-body-sm text-slate">
                  ≈ {formatDollars(toDollars(store.balance, store.rate))}
                </Text>
              </View>
            )}

            <View className="flex-row gap-3 px-5 mb-8">
              <Button label="Send" variant="raised" onPress={() => router.push('/send')} />
              <Button label="Deposit" variant="secondary" onPress={() => router.push('/receive')} />
              <Button label="Business" variant="secondary" onPress={() => router.push('/business')} />
            </View>

            <SectionHeading
              title="Allowances"
              action="Manage"
              className="px-5"
              onActionPress={() => router.push('/rules/new')}
            />

            <View className="gap-2.5 px-5">
              {loading ? (
                <>
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
              className="pt-[30px] px-5"
              onActionPress={() => router.push('/activity')}
            />

            {loading ? (
              <View className="gap-2 px-5">
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View className="px-5">
            <ActivityRow
              entry={item}
              contact={store.contact(item.contactId)}
              onPress={
                item.allowanceId ? () => router.push({ pathname: '/rules/[id]', params: { id: item.allowanceId! } }) : undefined
              }
            />
          </View>
        )}
      />
    </Screen>
  );
}
