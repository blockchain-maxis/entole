import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { toDollars } from '@entole/core/fx';
import type { PocketId } from '@entole/core/intents-pockets';
import { formatDollars, formatNaira, kobo } from '@entole/core/money';
import { pocketsOpeningFrom, type PocketsOpening } from '@entole/core/pockets-link';
import { savingsEarning } from '@entole/core/savings';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { HoldingRow } from '@/components/ui/HoldingRow';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { PauseButton } from '@/components/ui/PauseButton';
import {
  AddToPocketSheet,
  ChangeCurrencySheet,
  PocketRowsSkeleton,
  PocketsSection,
  usePockets,
} from '@/components/ui/Pockets';
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
 * Money: everything the person holds, in one place. The naira balance first,
 * as a line on the paper; then the pockets in dollars, euros and pounds, as
 * ruled rows with adding and changing in sheets; then what was Grow. Savings
 * is the one raised surface; the rest is ruled sections on the page. Each is
 * honest about what it is today:
 *
 * - Savings is real: money set aside in the person's own account, read back
 *   from where it is held. It does not earn interest, and nothing here says
 *   it does — there is no accrued figure, no payout date and no rate.
 * - Stocks can be bought only when a brokerage partner is connected. Until
 *   then the card leads to a list to look through, with live prices, and
 *   shows nothing that could pass for a holding.
 * - Earn says plainly that interest is planned for later. It is not a button.
 */
export default function Money() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();
  const { reload, reloading } = useReload();
  const pockets = usePockets();
  const [sheet, setSheet] = useState<'add' | 'change' | null>(null);
  /** Change currency found the pocket short and offered to add to it first. */
  const [addFirst, setAddFirst] = useState<PocketId | null>(null);

  // Ayo's "change 100 dollars to euros" arrives as a link, stamped with when it was asked, so asking again opens it again.
  const params = useLocalSearchParams<{ change?: string; from?: string; to?: string; amount?: string; add?: string; at?: string }>();
  const asked = pocketsOpeningFrom((key) => params[key as keyof typeof params] ?? null);
  const askedKey = asked ? `${params.at ?? ''}:${JSON.stringify(asked)}` : null;
  const [opening, setOpening] = useState<{ key: string; asked: PocketsOpening } | null>(null);
  if (asked && askedKey && opening?.key !== askedKey) {
    setOpening({ key: askedKey, asked });
    setSheet(asked.sheet);
  }

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
    <View className="flex-1">
      <Screen edges={{ bottom: false }}>
        <Header title="Money" leading="none" trailing={<PauseButton />} />

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={reloading && !failed && !loading}
              onRefresh={() => {
                void reload();
                void pockets.reload();
              }}
              tintColor={colors.mist}
              colors={[colors.ink]}
            />
          }
        >
          {loading ? (
            <View accessibilityLabel="Loading">
              <View className="pt-1">
                <Skeleton className="h-4 w-28 rounded-md" />
                <Skeleton className="mt-3 h-[48px] w-56 rounded-control" />
                <Skeleton className="mt-3 h-4 w-24 rounded-md" />
              </View>
              <View className="pb-3 pt-10">
                <Skeleton className="h-5 w-24 rounded-md" />
              </View>
              <PocketRowsSkeleton />
              <View className="mt-10 rounded-card bg-card p-6 shadow-raised">
                <Skeleton className="h-4 w-20 rounded-md" />
                <Skeleton className="mt-4 h-[48px] w-56 rounded-control" />
                <Skeleton className="mt-3 h-4 w-24 rounded-md" />
                <Skeleton className="mt-4 h-4 w-full rounded-md" />
                <View className="mt-5 flex-row gap-3">
                  <Skeleton className="h-[54px] flex-1 rounded-control" />
                  <Skeleton className="h-[54px] flex-1 rounded-control" />
                </View>
              </View>
            </View>
          ) : failed ? (
            <LoadFailed
              title="We can't load your money"
              body="Your balances couldn't be read just now. Nothing has changed. Check your connection and try again."
            />
          ) : (
            <View>
              <View accessible className="pt-1">
                <Text className="font-strong text-note text-slate">In your account</Text>
                <View className="mt-2">
                  <Amount value={kobo(spendable)} size="large" />
                </View>
                <Text tabular className="mt-1.5 font-body text-note text-slate">
                  about {formatDollars(toDollars(kobo(spendable), store.rate))}
                </Text>
              </View>

              <SectionHeading title="Pockets" />
              <PocketsSection
                state={pockets.state}
                onRetry={() => void pockets.reload()}
                onAdd={() => {
                  setAddFirst(null);
                  setSheet('add');
                }}
                onChange={() => setSheet('change')}
              />

              <View className="h-10" />
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

      {sheet === 'add' ? (
        <AddToPocketSheet
          initialPocket={addFirst ?? (opening?.asked.sheet === 'add' ? opening.asked.pocket : undefined)}
          onDismiss={() => {
            setAddFirst(null);
            setSheet(null);
          }}
          onArrived={() => void pockets.reload()}
        />
      ) : null}
      {sheet === 'change' && pockets.state.status === 'ready' ? (
        <ChangeCurrencySheet
          pockets={pockets.state.pockets}
          initial={opening?.asked.sheet === 'change' ? opening.asked : undefined}
          onDismiss={() => setSheet(null)}
          onFinished={() => void pockets.reload()}
          onAddFirst={(pocket) => {
            setAddFirst(pocket);
            setSheet('add');
          }}
        />
      ) : null}
    </View>
  );
}
