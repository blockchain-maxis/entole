import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { PauseButton } from '@/components/ui/PauseButton';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { EMPTY_ENTRY, entryDisplay, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import type { StockQuote } from '@entole/core/gateway';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';
import { formatShares, stockQuantityForAmount, stockValueForQuantity } from '@entole/core/stock-broker';

type Side = 'buy' | 'sell';

/**
 * Buy or sell one stock. The price is always the broker's live quote — if it
 * cannot be fetched, the screen says so and offers no way to trade; there is
 * no placeholder price. Amounts are entered in naira on the custom keypad and
 * converted to shares at that quote (rounded down, so never more than you
 * entered).
 */
export default function StockTrade() {
  const router = useRouter();
  const store = useStore();
  const { symbol: rawSymbol } = useLocalSearchParams<{ symbol: string }>();
  const symbol = String(rawSymbol ?? '').toUpperCase();

  const holding = store.stockPositions.find((p) => p.symbol === symbol);

  const [side, setSide] = useState<Side>('buy');
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sellAll, setSellAll] = useState(false);

  const { getStockQuote } = store;

  useEffect(() => {
    let live = true;
    getStockQuote(symbol)
      .then((next) => {
        if (live) setQuote(next);
      })
      .catch(() => {
        if (live) setQuoteFailed(true);
      });
    return () => {
      live = false;
    };
  }, [getStockQuote, symbol]);

  const amount = entryToMinor(entry);
  const held = holding?.quantityScaled ?? 0;
  const quantity = !quote
    ? 0
    : side === 'sell' && sellAll
      ? held
      : Math.min(stockQuantityForAmount(amount, quote.priceMinor), side === 'sell' ? held : Number.MAX_SAFE_INTEGER);
  const canSubmit = Boolean(quote) && quantity > 0 && !busy;

  function pickSide(next: Side) {
    setSide(next);
    setSellAll(false);
    setEntry(EMPTY_ENTRY);
    setProblem(null);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setProblem(null);
    try {
      if (side === 'buy') await store.buyStock(symbol, quantity);
      else await store.sellStock(symbol, quantity);
      router.back();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setProblem(
        message.startsWith('Your order was received')
          ? message
          : 'That order did not go through. Nothing changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Header title={holding?.companyName ?? symbol} trailing={<PauseButton />} />

      <View className="flex-1 px-gutter pt-1">
        {quoteFailed ? (
          <View className="rounded-panel border border-line bg-card p-5">
            <Text className="font-heavy text-body text-ink">No price available right now</Text>
            <Text className="mt-2 font-body text-body-sm text-slate">
              We could not get a live price for {symbol}, so trading it is switched off for now.
            </Text>
          </View>
        ) : !quote ? (
          <Text className="px-1 font-body text-body-sm text-slate">Getting the latest price</Text>
        ) : (
          <>
            <View className="flex-row items-baseline justify-between px-1">
              <Text className="font-strong text-label-sm text-mist">{symbol} · per share</Text>
              <Text tabular className="font-strong text-body text-ink">
                {formatNaira(kobo(quote.priceMinor))}
              </Text>
            </View>

            <View className="mt-4 flex-row gap-2">
              {(['buy', 'sell'] as const).map((option) => {
                const disabled = option === 'sell' && held === 0;
                const active = side === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled }}
                    disabled={disabled}
                    onPress={() => pickSide(option)}
                    className={`flex-1 items-center rounded-control border py-3 ${
                      active ? 'border-indigo bg-indigo-wash' : 'border-line bg-card'
                    } ${disabled ? 'opacity-40' : ''}`}
                  >
                    <Text className={`font-strong text-body-sm ${active ? 'text-indigo' : 'text-slate'}`}>
                      {option === 'buy' ? 'Buy' : 'Sell'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="mt-5 flex-row items-baseline justify-between px-1">
              <Text className="font-heavy text-body-sm text-ink">{side === 'buy' ? 'Amount to buy' : 'Amount to sell'}</Text>
              <Text tabular className="font-strong text-amount-sm text-ink">
                {sellAll ? formatNaira(kobo(stockValueForQuantity(held, quote.priceMinor))) : `₦${entryDisplay(entry)}`}
              </Text>
            </View>
            <Text className="mt-1 px-1 font-body text-label-sm text-slate">
              {quantity > 0 ? `About ${formatShares(quantity)} shares` : 'Enter an amount'}
              {side === 'sell' && held > 0 ? ` · you hold ${formatShares(held)}` : ''}
            </Text>

            {side === 'sell' && held > 0 ? (
              <Pressable accessibilityRole="button" className="mt-2 px-1" onPress={() => setSellAll((v) => !v)}>
                <Text className="font-strong text-label-sm text-indigo">{sellAll ? 'Choose an amount' : 'Sell all'}</Text>
              </Pressable>
            ) : null}

            <View className="mt-3">
              <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
            </View>

            {problem ? <Text className="mt-3 text-center font-body text-label-sm text-halt">{problem}</Text> : null}

            <View className="mt-4 flex-row gap-3">
              <Button
                label={busy ? 'Working' : side === 'buy' ? 'Buy' : 'Sell'}
                busy={busy}
                disabled={!canSubmit}
                onPress={() => void submit()}
              />
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}
