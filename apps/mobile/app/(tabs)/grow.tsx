import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { Meter } from '@/components/ui/Meter';
import { PauseButton } from '@/components/ui/PauseButton';
import { Screen } from '@/components/ui/Screen';
import { Sentence, type SentencePart } from '@/components/ui/Sentence';
import { BalanceSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { EMPTY_ENTRY, entryDisplay, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { daysUntil, payoutLabel } from '@entole/core/format';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

type Mode = 'view' | 'deposit' | 'withdraw';

/**
 * "Grow" — the owner's own money, growing. No delegate, no allowance;
 * moving money in or out here is always a direct owner action, same trust
 * level as a plain send. Earnings shown are a projection, never treated as
 * spendable until they actually settle into the balance above.
 */
export default function Grow() {
  const store = useStore();
  const loading = store.status === 'loading';
  const position = store.growPosition;

  const [mode, setMode] = useState<Mode>('view');
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const amount = entryToMinor(entry);

  function openMode(next: Mode) {
    setEntry(EMPTY_ENTRY);
    setProblem(null);
    setMode(next);
  }

  async function submit() {
    if (amount <= 0 || busy || !position) return;
    if (mode === 'withdraw' && amount > position.balanceMinor) {
      setProblem('That is more than what you have growing.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (mode === 'deposit') {
        await store.depositGrow(amount);
      } else if (mode === 'withdraw') {
        await store.withdrawGrow(amount);
      }
      setMode('view');
      setEntry(EMPTY_ENTRY);
    } catch {
      setProblem('That did not go through. Nothing changed.');
    } finally {
      setBusy(false);
    }
  }

  const sentenceParts: SentencePart[] = [
    { kind: 'words', text: 'Grow ' },
    { kind: 'pill', id: 'amount', text: 'more money', tabular: false },
    { kind: 'words', text: '.' },
  ];

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Grow" trailing={<PauseButton />} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {loading || !position ? (
          <BalanceSkeleton />
        ) : mode === 'view' ? (
          <>
            <View className="rounded-panel bg-card p-6 shadow-raised">
              <Text className="font-strong text-label-sm text-mist">What&apos;s growing</Text>
              <View className="mt-2.5">
                <Amount value={kobo(position.balanceMinor)} />
              </View>
              {position.accruedMinor > 0 ? (
                <Text tabular className="mt-2 font-body text-body-sm text-settled">
                  + {formatNaira(kobo(position.accruedMinor))} earned so far
                </Text>
              ) : null}

              <View className="mt-5">
                <Meter fraction={1} tone="settled" label="Growing" />
              </View>
              <View className="mt-2.5 flex-row items-baseline justify-between">
                <Text className="font-body text-label-sm text-slate">{payoutLabel(position.nextPayoutAt)}</Text>
                <Text tabular className="font-strong text-label-sm text-mist">
                  {daysUntil(position.nextPayoutAt)} days away
                </Text>
              </View>
            </View>

            <View className="mt-6 px-1">
              <Pressable accessibilityRole="button" onPress={() => openMode('deposit')}>
                <Sentence parts={sentenceParts} onPressPill={() => openMode('deposit')} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Move money out of Grow"
                className="mt-4"
                onPress={() => openMode('withdraw')}
              >
                <Text className="font-strong text-label-sm text-indigo">Move money out</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View className="pt-2">
            <View className="flex-row items-baseline justify-between px-1">
              <Text className="font-heavy text-body-sm text-ink">
                {mode === 'deposit' ? 'Add to Grow' : 'Move out of Grow'}
              </Text>
              <Text tabular className="font-strong text-amount-sm text-ink">
                ₦{entryDisplay(entry)}
              </Text>
            </View>

            <View className="mt-3">
              <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
            </View>

            {problem ? (
              <Text className="mt-3 text-center font-body text-label-sm text-halt">{problem}</Text>
            ) : null}

            <View className="mt-4 flex-row gap-3">
              <Button variant="secondary" label="Cancel" width="hug" onPress={() => openMode('view')} />
              <Button
                label={
                  busy
                    ? 'Working'
                    : mode === 'deposit'
                      ? `Add ${formatNaira(amount)}`
                      : `Move out ${formatNaira(amount)}`
                }
                busy={busy}
                disabled={amount <= 0}
                onPress={() => void submit()}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
