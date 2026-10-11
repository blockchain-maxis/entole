import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ActivityRow, byAssistant } from '@/components/ui/ActivityRow';
import { AllowanceCard } from '@/components/ui/AllowanceCard';
import { AllowanceIntro } from '@/components/ui/AllowanceIntro';
import { Figure } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { ActivityRowSkeleton, AllowanceRowSkeleton, FigureSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { greetingFor } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { formatDollars } from '@entole/core/money';
import type { Activity } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';
import { useAssistant } from '@/lib/assistant';
import { useLiveRefresh } from '@/lib/reload';
import { useThemeColors } from '@/lib/theme';

/**
 * Home, as a page that has been written on. The balance is the one figure,
 * set large on the paper with no card around it. Under it, what the assistant
 * may do for you, each allowance a sentence in the assistant's blue. Then what
 * has happened, as ruled rows. Everything you do yourself is ink.
 */
export default function Home() {
  const router = useRouter();
  const store = useStore();
  const assistant = useAssistant();
  const colors = useThemeColors();
  // The device's own clock. The name is not repeated here: it is already in
  // the header, a line above.
  const greeting = greetingFor();
  const loading = store.status === 'loading';
  const failed = store.status === 'failed';
  const announced = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const { refresh } = store;

  // A payment someone sends you shows up on its own while this screen is open.
  useLiveRefresh();

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
  const waiting = !loading && assistant.enabled && Boolean(store.proposal);
  const recent = loading || failed ? [] : store.activity.slice(0, 5);

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

      <FlashList<Activity>
        data={recent}
        refreshing={refreshing}
        onRefresh={() => void pullToRefresh()}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {store.paused ? (
              // A paused assistant is said first, with the way back beside it.
              <View className="mb-2 mt-1 flex-row items-center gap-3 rounded-control bg-halt-wash px-4 py-3">
                <View className="h-2.5 w-2.5 rounded-[2px] bg-halt" />
                <Text className="flex-1 font-body text-ui text-ink">
                  The assistant is paused. Your allowances are as you left them.
                </Text>
                <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.push('/pause')}>
                  <Text className="font-strong text-ui text-ink underline">Resume</Text>
                </Pressable>
              </View>
            ) : null}

            <Text numberOfLines={1} className="pt-2 font-body text-ui text-slate">
              {greeting}
            </Text>

            {loading ? (
              <FigureSkeleton />
            ) : failed ? (
              // No figure at all: a zero here would read as the balance.
              <View className="pt-2">
                <Text className="font-display text-subhead text-ink">We can’t reach the exchange rate</Text>
                <Text className="mt-1.5 font-body text-ui text-slate">
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
              <View className="pt-1.5">
                <Figure value={store.balance} />
                <Text tabular className="mt-2 font-body text-ui text-slate">
                  Available · about {formatDollars(toDollars(store.balance, store.rate))}
                </Text>
              </View>
            )}

            {firstRun ? (
              <View className="mt-7">
                <Text className="font-display text-subhead text-ink">Start with some test money</Text>
                <Text className="mt-1.5 font-body text-ui text-slate">
                  Add test money to try Entole. Or share your link and have someone pay you.
                </Text>
                <View className="mt-4 flex-row gap-2.5">
                  <Button label="Add money" onPress={() => router.push('/add-money')} />
                  <Button label="Receive" variant="secondary" onPress={() => router.push('/receive')} />
                </View>
              </View>
            ) : !loading && !failed ? (
              <View className="mt-7 flex-row gap-2.5">
                <Button label="Send" onPress={() => router.push('/send/pick')} />
                <Button label="Add money" variant="secondary" onPress={() => router.push('/add-money')} />
                <Button label="Receive" variant="secondary" onPress={() => router.push('/receive')} />
              </View>
            ) : null}

            {failed ? null : (
              <>
                <SectionHeading
                  display
                  title="Allowances"
                  action={!loading && assistant.enabled && hasAllowances ? 'New allowance' : undefined}
                  onActionPress={() => router.push('/rules/new')}
                />

                {loading ? (
                  <View className="border-y border-hairline">
                    <AllowanceRowSkeleton />
                    <AllowanceRowSkeleton ruled />
                  </View>
                ) : hasAllowances ? (
                  <>
                    <View className="border-y border-hairline">
                      {store.allowances.map((allowance, index) => (
                        <AllowanceCard
                          key={allowance.id}
                          allowance={allowance}
                          recipientName={store.contact(allowance.recipientId)?.name ?? 'someone'}
                          resetsAt={allowance.resetsAt}
                          ruled={index > 0}
                          onPress={() => router.push({ pathname: '/rules/[id]', params: { id: allowance.id } })}
                        />
                      ))}
                    </View>
                    {assistant.enabled && !waiting ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => router.push('/assistant')}
                        className="mt-4 flex-row items-center gap-3 rounded-control bg-indigo-wash px-4 py-3.5 active:opacity-80"
                      >
                        <Text className="flex-1 font-strong text-ui text-ink">Ask the assistant to pay someone</Text>
                        <ArrowRight size={18} strokeWidth={1.75} color={colors.indigo.DEFAULT} />
                      </Pressable>
                    ) : null}
                  </>
                ) : (
                  <AllowanceIntro />
                )}

                <SectionHeading
                  display
                  title="Activity"
                  action={store.activity.length > 5 ? 'All activity' : undefined}
                  onActionPress={() => router.push('/activity')}
                />

                {loading ? (
                  <View>
                    <ActivityRowSkeleton />
                    <ActivityRowSkeleton />
                    <ActivityRowSkeleton />
                  </View>
                ) : null}
              </>
            )}
          </View>
        }
        ListFooterComponent={
          !loading && !failed && store.activity.length === 0 ? (
            <View className="border-y border-hairline py-5">
              <Text className="font-body text-ui text-slate">Payments you send and receive will show up here.</Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const previous = recent[index - 1];
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
