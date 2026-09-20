import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { EMPTY_ENTRY, entryFromMinor, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { LoadFailed } from '@/components/ui/LoadFailed';
import { SavingsSheet } from '@/components/ui/SavingsSheet';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { checkSavingsAmount, type SavingsMode } from '@/lib/savings';

/**
 * Savings — moving your own money between what you can spend and what you have
 * set aside. One screen, two directions: the hub sends you here already on the
 * one you chose (`?mode=deposit` or `?mode=withdraw`), and the switch at the
 * top changes it. The amount goes in on the custom keypad; Review opens a sheet,
 * and nothing is shown as moved until it has settled.
 */
export default function Savings() {
  const router = useRouter();
  const store = useStore();
  const params = useLocalSearchParams<{ mode?: string }>();

  const [mode, setMode] = useState<SavingsMode>(params.mode === 'withdraw' ? 'withdraw' : 'deposit');
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [reviewing, setReviewing] = useState(false);

  const loading = store.status === 'loading';
  const failed = store.status === 'failed';
  const position = store.growPosition;
  const spendable = store.balance;
  const saved = position?.balanceMinor ?? 0;
  const deposit = mode === 'deposit';

  const amount = useMemo(() => entryToMinor(entry), [entry]);
  const check = checkSavingsAmount({ mode, amount, spendable, saved, rate: store.rate });
  const reason = check.ok || check.kind === 'empty' ? null : check.reason;
  const ready = !loading && !failed && Boolean(position);

  function pickMode(next: SavingsMode) {
    setMode(next);
    setEntry(EMPTY_ENTRY);
  }

  function finish() {
    setReviewing(false);
    setEntry(EMPTY_ENTRY);
    if (router.canGoBack()) router.back();
  }

  return (
    <View className="flex-1">
      <Screen>
        <Header title="Savings" />

        {loading ? (
          <View className="px-gutter pt-2">
            <Skeleton className="h-11 w-full rounded-control" />
            <View className="items-center">
              <Skeleton className="mt-9 h-[54px] w-56 rounded-chip" />
              <Skeleton className="mt-4 h-4 w-28 rounded-md" />
            </View>
          </View>
        ) : failed ? (
          <View className="px-gutter pt-2">
            <LoadFailed
              title="We can't load your savings"
              body="Your balances couldn't be read just now. Nothing has changed. Check your connection and try again."
            />
          </View>
        ) : !position ? (
          <View className="px-gutter pt-2">
            <View className="rounded-panel bg-card p-6 shadow-raised">
              <Text className="font-strong text-title text-ink">Savings isn&apos;t available yet</Text>
              <Text className="mt-2 font-body text-body-sm text-slate">
                It isn&apos;t switched on for your account yet. Your money hasn&apos;t moved.
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View className="flex-1 px-gutter pt-1">
              <View className="flex-row gap-2">
                {(['deposit', 'withdraw'] as const).map((option) => {
                  const active = mode === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => pickMode(option)}
                      className={`flex-1 items-center rounded-control border py-3 ${
                        active ? 'border-indigo bg-indigo-wash' : 'border-line bg-card'
                      }`}
                    >
                      <Text className={`font-strong text-body-sm ${active ? 'text-indigo' : 'text-slate'}`}>
                        {option === 'deposit' ? 'Add to savings' : 'Take out'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View className="flex-1 items-center justify-center">
                <Amount value={kobo(amount)} size="large" caret />
                <Text tabular className="mt-2.5 font-body text-body-sm text-slate">
                  {amount > 0 ? `≈ ${formatDollars(toDollars(kobo(amount), store.rate))}` : 'Enter an amount'}
                </Text>

                <View className="mt-3 min-h-[52px] items-center px-2">
                  <Text tabular className="text-center font-body text-label-sm text-slate">
                    {deposit
                      ? `You can spend ${formatNaira(kobo(spendable))}`
                      : `You have ${formatNaira(kobo(saved))} in savings`}
                  </Text>
                  {reason ? (
                    <Text className="mt-1 text-center font-body text-label-sm text-caution">{reason}</Text>
                  ) : null}
                  {!reason && !deposit && saved > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={10}
                      onPress={() => setEntry(entryFromMinor(kobo(saved)))}
                      className="mt-1"
                    >
                      <Text className="font-strong text-label-sm text-indigo">Take out all of it</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>

            <View className="flex-none px-3.5 pb-2.5">
              <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
              <View className="mt-3 flex-row">
                <Button label="Review" disabled={!ready || !check.ok} onPress={() => setReviewing(true)} />
              </View>
            </View>
          </>
        )}
      </Screen>

      {reviewing && ready ? (
        <SavingsSheet
          mode={mode}
          amountMinor={amount}
          onDismiss={() => setReviewing(false)}
          onDone={finish}
        />
      ) : null}
    </View>
  );
}
