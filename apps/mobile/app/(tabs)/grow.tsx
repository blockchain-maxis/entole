import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';

import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { HoldingRow } from '@/components/ui/HoldingRow';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { PauseButton } from '@/components/ui/PauseButton';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { SplitBar } from '@/components/ui/SplitBar';
import { Text } from '@/components/ui/Text';
import { useReload } from '@/lib/reload';
import { savedShare, savedShareLabel } from '@/lib/savings';
import { useThemeColors } from '@/lib/theme';

/** How many holdings the hub shows before sending you to the full list. */
const HOLDINGS_SHOWN = 3;

/**
 * The Grow hub. Three cards, each honest about what it is today:
 *
 * - Savings is real: money set aside in the person's own account, read back
 *   from where it is held. It does not earn interest, and nothing here says
 *   it does — there is no accrued figure, no payout date and no rate.
 * - Stocks opens only when a brokerage partner is connected. Until then it
 *   says so and shows nothing that could pass for a price or a holding.
 * - Earn says plainly that interest is planned for later. It is not a button.
 */
export default function Grow() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();
  const { reload, reloading } = useReload();

  const loading = store.status === 'loading';
  const failed = store.status === 'failed';
  const savings = store.growPosition;
  const spendable = store.balance;
  const saved = savings?.balanceMinor ?? 0;
  const share = savedShare(spendable, saved);
  const holdings = store.stockPositions;
  const holdingsValue = holdings.reduce((sum, position) => sum + position.currentValueMinor, 0);

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Grow" leading="none" trailing={<PauseButton />} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={reloading && !failed && !loading}
            onRefresh={() => void reload()}
            tintColor={colors.mist}
            colors={[colors.indigo.DEFAULT]}
          />
        }
      >
        {loading ? (
          <View accessibilityLabel="Loading" className="gap-3">
            <View className="rounded-panel bg-card p-6 shadow-raised">
              <Skeleton className="h-4 w-20 rounded-md" />
              <Skeleton className="mt-4 h-[48px] w-56 rounded-chip" />
              <Skeleton className="mt-3 h-4 w-24 rounded-md" />
              <Skeleton className="mt-4 h-4 w-full rounded-md" />
              <View className="mt-5 flex-row gap-3">
                <Skeleton className="h-[54px] flex-1 rounded-control" />
                <Skeleton className="h-[54px] flex-1 rounded-control" />
              </View>
            </View>
            <View className="rounded-row border border-line bg-card p-4">
              <Skeleton className="h-4 w-28 rounded-md" />
              <Skeleton className="mt-3.5 h-4 w-full rounded-md" />
              <Skeleton className="mt-3.5 h-4 w-full rounded-md" />
            </View>
            <View className="rounded-row border border-line bg-card p-4">
              <Skeleton className="h-4 w-20 rounded-md" />
              <Skeleton className="mt-3.5 h-4 w-full rounded-md" />
            </View>
          </View>
        ) : failed ? (
          <LoadFailed
            title="We can't load Grow"
            body="Your balances couldn't be read just now. Nothing has changed. Check your connection and try again."
          />
        ) : (
          <View className="gap-3">
            {savings ? (
              <View className="rounded-panel bg-card p-6 shadow-raised">
                <Text className="font-strong text-label-sm text-mist">Savings</Text>
                <View className="mt-3">
                  <Amount value={kobo(saved)} size="large" />
                </View>
                <Text tabular className="mt-2 font-body text-body-sm text-slate">
                  ≈ {formatDollars(toDollars(kobo(saved), store.rate))}
                </Text>
                <Text className="mt-3 font-body text-label-sm text-slate">
                  Money set aside, separate from what you spend. It doesn&apos;t earn interest yet.
                </Text>
                <View className="mt-5 flex-row gap-3">
                  <Button
                    label="Add to savings"
                    variant="raised"
                    onPress={() => router.push({ pathname: '/grow/savings', params: { mode: 'deposit' } })}
                  />
                  <Button
                    label="Take out"
                    variant="secondary"
                    disabled={saved <= 0}
                    onPress={() => router.push({ pathname: '/grow/savings', params: { mode: 'withdraw' } })}
                  />
                </View>
              </View>
            ) : (
              <View className="rounded-panel bg-card p-6 shadow-raised">
                <Text className="font-strong text-label-sm text-mist">Savings</Text>
                <Text className="mt-2.5 font-strong text-title text-ink">Savings isn&apos;t available yet</Text>
                <Text className="mt-2 font-body text-body-sm text-slate">
                  It isn&apos;t switched on for your account yet. Your money hasn&apos;t moved.
                </Text>
              </View>
            )}

            {savings ? (
              <View className="rounded-row border border-line bg-card p-4">
                <Text className="font-heavy text-body-sm text-ink">Your money</Text>
                <View className="mt-3 flex-row items-baseline justify-between">
                  <Text className="font-body text-label text-slate">You can spend</Text>
                  <Text tabular className="font-strong text-label text-ink">
                    {formatNaira(kobo(spendable))}
                  </Text>
                </View>
                <View className="mt-2.5 flex-row items-baseline justify-between">
                  <Text className="font-body text-label text-slate">In savings</Text>
                  <Text tabular className="font-strong text-label text-ink">
                    {formatNaira(kobo(saved))}
                  </Text>
                </View>
                {share !== null ? (
                  <View className="mt-4">
                    <SplitBar share={share} label={savedShareLabel(share)} />
                    <Text className="mt-2 font-body text-caption text-slate">{savedShareLabel(share)}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {store.stocksAvailable ? (
              <View className="rounded-row border border-line bg-card p-4">
                <View className="flex-row items-baseline justify-between">
                  <Text className="font-heavy text-body-sm text-ink">Stocks</Text>
                  {holdings.length > 0 ? (
                    <Text tabular className="font-strong text-label text-ink">
                      {formatNaira(kobo(holdingsValue))}
                    </Text>
                  ) : null}
                </View>
                {holdings.length > 0 ? (
                  <View className="mt-3 gap-2">
                    {holdings.slice(0, HOLDINGS_SHOWN).map((position) => (
                      <HoldingRow
                        key={position.symbol}
                        position={position}
                        onPress={() =>
                          router.push({ pathname: '/grow/stock/[symbol]', params: { symbol: position.symbol } })
                        }
                      />
                    ))}
                  </View>
                ) : (
                  <Text className="mt-2 font-body text-label-sm text-slate">You don&apos;t hold any shares yet.</Text>
                )}
                <View className="mt-4 flex-row">
                  <Button
                    label={holdings.length > HOLDINGS_SHOWN ? 'See all and search' : 'Search stocks'}
                    variant="secondary"
                    onPress={() => router.push('/grow/stocks')}
                  />
                </View>
              </View>
            ) : (
              <View className="rounded-row border border-line bg-card p-4">
                <Text className="font-heavy text-body-sm text-ink">Stocks</Text>
                <Text className="mt-2 font-body text-label-sm text-slate">
                  Buying stocks opens when our brokerage partner is connected.
                </Text>
              </View>
            )}

            <View className="rounded-row border border-line bg-card p-4">
              <Text className="font-heavy text-body-sm text-ink">Earn</Text>
              <Text className="mt-2 font-body text-label-sm text-slate">
                Interest on savings is planned for when Entole goes live. Nothing earns interest today.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
