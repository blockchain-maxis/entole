import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { AllowanceCard } from '@/components/ui/AllowanceCard';
import { ActivityRow } from '@/components/ui/ActivityRow';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { PauseIntro } from '@/components/ui/PauseIntro';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import {
  AllowanceCardSkeleton,
  BalanceSkeleton,
  RowSkeleton,
} from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { greetingFor } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { formatDollars } from '@entole/core/money';
import type { Activity } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';
import { useAccount } from '@/lib/account';
import { useAssistant } from '@/lib/assistant';

export default function Home() {
  const router = useRouter();
  const store = useStore();
  const { account } = useAccount();
  const assistant = useAssistant();
  // The device's own clock and the person's own full name. No name yet means
  // the greeting stands alone — nothing is invented to fill the gap.
  const fullName = account?.displayName.trim() ?? '';
  const greeting = fullName ? `${greetingFor()}, ${fullName}` : greetingFor();
  const loading = store.status === 'loading';
  const failed = store.status === 'failed';
  const announced = useRef(false);
  const { height } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const { refresh } = store;

  // A re-read keeps what is on screen while it loads; a read that fails simply
  // leaves the last real numbers where they are.
  const reload = useCallback(async () => {
    try {
      await refresh();
    } catch {
      // Nothing new to show; the pull indicator just settles.
    }
  }, [refresh]);

  async function pullToRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  async function retry() {
    setRetrying(true);
    await reload();
    setRetrying(false);
  }

  // A new account: nothing in it and nothing it has ever done.
  const firstRun = !loading && !failed && store.balance === 0 && store.activity.length === 0;
  const hasAllowances = store.allowances.length > 0;

  useEffect(() => {
    // The assistant is a setting: nothing is announced until it is turned on.
    if (loading || !assistant.enabled || !store.proposal || announced.current) return;
    announced.current = true;
    const timer = setTimeout(() => router.push('/assistant-action'), 1200);
    return () => clearTimeout(timer);
  }, [loading, router, store.proposal, assistant.enabled]);

  return (
    <Screen edges={{ bottom: false }}>
      <Header leading="brand" trailing={<PauseButton />} />
      <View className="px-5 pt-2 pb-4">
        <Text numberOfLines={1} className="font-strong text-headline text-ink">
          {greeting}
        </Text>
      </View>

      <FlashList<Activity>
        data={loading || failed ? [] : store.activity.slice(0, 5)}
        refreshing={refreshing}
        onRefresh={() => void pullToRefresh()}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <PauseIntro />
            {loading ? (
              <View className="px-5"><BalanceSkeleton /></View>
            ) : failed ? (
              <View className="mx-5 mb-5 rounded-panel bg-card p-6 shadow-raised">
                <Text className="font-strong text-label-sm text-mist">Available balance</Text>
                <Text className="mt-2.5 font-strong text-title text-ink">
                  We can’t reach the exchange rate
                </Text>
                <Text className="mt-2 font-body text-body-sm text-slate">
                  Your balance needs today’s rate to show in naira, so it can’t load right now. Check
                  your connection and try again.
                </Text>
                <View className="mt-4 flex-row">
                  <Button
                    label={retrying ? 'Trying again' : 'Retry'}
                    variant="secondary"
                    width="hug"
                    disabled={retrying}
                    onPress={() => void retry()}
                  />
                </View>
              </View>
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

            {firstRun ? (
              <View className="mx-5 mb-8 rounded-row border border-line bg-card p-4">
                <Text className="font-strong text-body text-ink">Start with some test money</Text>
                <Text className="mt-1.5 font-body text-body-sm text-slate">
                  Add test money to try Entole, then add someone you pay often.
                </Text>
                <View className="mt-4 flex-row gap-3">
                  <Button label="Add money" variant="raised" onPress={() => router.push('/add-money')} />
                  <Button
                    label="Add a beneficiary"
                    variant="secondary"
                    onPress={() => router.push('/beneficiaries/new')}
                  />
                </View>
              </View>
            ) : !loading && !failed ? (
              <View className="flex-row gap-3 px-5 mb-8">
                <Button label="Send" variant="raised" onPress={() => router.push('/send')} />
                <Button label="Add money" variant="secondary" onPress={() => router.push('/add-money')} />
                <Button label="Business" variant="secondary" onPress={() => router.push('/business')} />
              </View>
            ) : null}

            {failed ? null : (
              <>
                <SectionHeading
                  title="Allowances"
                  action={hasAllowances ? 'Manage' : undefined}
                  className="px-5"
                  onActionPress={() => router.push('/rules/new')}
                />

                <View className="gap-2.5 px-5">
                  {loading ? (
                    <>
                      <AllowanceCardSkeleton />
                      <AllowanceCardSkeleton />
                    </>
                  ) : hasAllowances ? (
                    store.allowances.map((allowance) => (
                      <AllowanceCard
                        key={allowance.id}
                        allowance={allowance}
                        resetsAt={allowance.resetsAt}
                        onPress={() => router.push({ pathname: '/rules/[id]', params: { id: allowance.id } })}
                      />
                    ))
                  ) : (
                    <View className="rounded-row border border-line bg-card p-4">
                      <Text className="font-body text-body-sm text-slate">
                        An allowance is an amount the assistant can spend for you, up to a limit you
                        choose.
                      </Text>
                      {assistant.loading ? null : (
                        <View className="mt-3.5 flex-row">
                          {assistant.enabled ? (
                            <Button
                              label="Set up an allowance"
                              variant="secondary"
                              width="hug"
                              onPress={() => router.push('/rules/new')}
                            />
                          ) : (
                            <Button
                              label="Turn on the assistant"
                              variant="secondary"
                              width="hug"
                              onPress={() => router.push('/assistant')}
                            />
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                <SectionHeading
                  title="Recent activity"
                  action={store.activity.length > 0 ? 'All' : undefined}
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
              </>
            )}
          </View>
        }
        ListFooterComponent={
          !loading && !failed && store.activity.length === 0 ? (
            <Text className="px-6 font-body text-body-sm text-slate">
              Payments you send and receive will show up here.
            </Text>
          ) : null
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
