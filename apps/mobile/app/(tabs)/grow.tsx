import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';

import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo } from '@entole/core/money';
import { savingsEarning } from '@entole/core/savings';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { HoldingRow } from '@/components/ui/HoldingRow';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { PauseButton } from '@/components/ui/PauseButton';
import { DetailRow, SectionHeading } from '@/components/ui/Rows';
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
 * The Grow hub. Savings is the one raised surface; the rest is ruled sections
 * on the page. Each is honest about what it is today:
 *
 * - Savings is real: money set aside in the person's own account, read back
 *   from where it is held. It does not earn interest, and nothing here says
 *   it does — there is no accrued figure, no payout date and no rate.
 * - Stocks can be bought only when a brokerage partner is connected. Until
 *   then the card leads to a list to look through, with live prices, and
 *   shows nothing that could pass for a holding.
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
  // Only ever a rate read from where the money is held. Null means it earns nothing.
  const earning = savingsEarning(savings);
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
            colors={[colors.ink]}
          />
        }
      >
        {loading ? (
          <View accessibilityLabel="Loading" className="gap-3">
            <View className="rounded-card bg-card p-6 shadow-raised">
              <Skeleton className="h-4 w-20 rounded-md" />
              <Skeleton className="mt-4 h-[48px] w-56 rounded-control" />
              <Skeleton className="mt-3 h-4 w-24 rounded-md" />
              <Skeleton className="mt-4 h-4 w-full rounded-md" />
              <View className="mt-5 flex-row gap-3">
                <Skeleton className="h-[54px] flex-1 rounded-control" />
                <Skeleton className="h-[54px] flex-1 rounded-control" />
              </View>
            </View>
            <View className="pt-7">
              <Skeleton className="h-5 w-28 rounded-md" />
              <Skeleton className="mt-5 h-4 w-full rounded-md" />
              <Skeleton className="mt-5 h-4 w-full rounded-md" />
            </View>
            <View className="pt-7">
              <Skeleton className="h-5 w-20 rounded-md" />
              <Skeleton className="mt-5 h-4 w-full rounded-md" />
            </View>
          </View>
        ) : failed ? (
          <LoadFailed
            title="We can't load Grow"
            body="Your balances couldn't be read just now. Nothing has changed. Check your connection and try again."
          />
        ) : (
          <View>
            {savings ? (
              <View className="rounded-card bg-card p-6 shadow-raised">
                <Text className="font-strong text-note text-slate">Savings</Text>
                <View className="mt-3">
                  <Amount value={kobo(saved)} size="large" />
                </View>
                <Text tabular className="mt-2 font-body text-note text-slate">
                  about {formatDollars(toDollars(kobo(saved), store.rate))}
                </Text>
                {earning ? (
                  <View className="mt-3">
                    {earning.earnedMinor > 0 ? (
                      <Text tabular className="font-body text-ui text-settled">
                        + {formatNaira(kobo(earning.earnedMinor))} earned so far
                      </Text>
                    ) : null}
                    <Text className="mt-1 font-strong text-ui text-ink">Earning about {earning.rate} a year</Text>
                    <Text className="mt-1 font-body text-note text-slate">
                      The rate moves from day to day. To earn it, your savings are lent out through a lending market.
                    </Text>
                  </View>
                ) : (
                  <Text className="mt-3 font-body text-note text-slate">
                    Money set aside, separate from what you spend. It doesn&apos;t earn interest yet.
                  </Text>
                )}
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
              <View className="rounded-card bg-card p-6 shadow-raised">
                <Text className="font-strong text-note text-slate">Savings</Text>
                <Text className="mt-2.5 font-display text-subhead text-ink">Savings isn&apos;t available yet</Text>
                <Text className="mt-2 font-body text-ui text-slate">
                  It isn&apos;t switched on for your account yet. Your money hasn&apos;t moved.
                </Text>
              </View>
            )}

            {savings ? (
              <View>
                <SectionHeading title="Your money" />
                <DetailRow label="You can spend" value={formatNaira(kobo(spendable))} />
                <DetailRow label="In savings" value={formatNaira(kobo(saved))} />
                {share !== null ? (
                  <View className="mt-4">
                    <SplitBar share={share} label={savedShareLabel(share)} />
                    <Text className="mt-2 font-body text-note text-slate">{savedShareLabel(share)}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {store.stocksAvailable ? (
              <View>
                <SectionHeading title="Stocks" />
                {holdings.length > 0 ? (
                  <View>
                    <DetailRow label="Worth today" value={formatNaira(kobo(holdingsValue))} />
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
                  <Text className="font-body text-ui text-slate">You don&apos;t hold any shares yet.</Text>
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
              <View>
                <SectionHeading title="Stocks" />
                <Text className="font-body text-ui text-slate">
                  See the companies and funds you will be able to buy, with live prices. Buying opens soon.
                </Text>
                <View className="mt-4 flex-row">
                  <Button label="Look at stocks" variant="secondary" onPress={() => router.push('/grow/stocks')} />
                </View>
              </View>
            )}

            <View>
              <SectionHeading title="Earn" />
              <Text className="font-body text-ui text-slate">
                Interest on savings is planned for when Entole goes live. Nothing earns interest today.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
