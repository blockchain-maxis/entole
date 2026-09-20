import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { View } from 'react-native';

import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { plainMessage } from '@/lib/send';
import { checkSavingsAmount, type SavingsMode } from '@/lib/savings';

import { Button } from './Button';
import { Sheet, SheetLayer } from './Sheet';
import { Text } from './Text';

type Phase = 'review' | 'waiting' | 'settled';

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row items-baseline justify-between py-2.5">
      <Text className={`font-body text-label ${strong ? 'text-ink' : 'text-slate'}`}>{label}</Text>
      <Text tabular className={`text-label text-ink ${strong ? 'font-heavy' : 'font-strong'}`}>
        {value}
      </Text>
    </View>
  );
}

/**
 * The last look before money moves between what you can spend and what you have
 * set aside. Both directions are the owner's own action on their own money, so
 * there is no fee and no assistant.
 *
 * Nothing is shown as moved until it has: `store.depositGrow` and
 * `store.withdrawGrow` resolve only once the change has settled. Until then the
 * sheet is locked and says it is waiting; only afterwards does it show the real
 * balance that was read back. If it fails, the message is shown here and the
 * balances are re-read, in case it went through after all.
 */
export function SavingsSheet({
  mode,
  amountMinor,
  onDismiss,
  onDone,
}: {
  mode: SavingsMode;
  amountMinor: number;
  /** Closes the sheet without moving anything. */
  onDismiss: () => void;
  /** Called once a settled change has been seen and the sheet is dismissed. */
  onDone: () => void;
}) {
  const store = useStore();
  const [phase, setPhase] = useState<Phase>('review');
  const [problem, setProblem] = useState<string | null>(null);

  const deposit = mode === 'deposit';
  const spendable = store.balance;
  const saved = store.growPosition?.balanceMinor ?? 0;
  const check = checkSavingsAmount({ mode, amount: amountMinor, spendable, saved, rate: store.rate });
  const waiting = phase === 'waiting';

  async function confirm() {
    if (!check.ok || phase !== 'review') return;
    setProblem(null);
    setPhase('waiting');
    try {
      // These resolve only once the change has settled — there is no interim
      // success and no balance moved ahead of time.
      if (deposit) await store.depositGrow(amountMinor);
      else await store.withdrawGrow(amountMinor);
      setPhase('settled');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void store.refresh().catch(() => undefined);
    } catch (error) {
      setPhase('review');
      setProblem(
        plainMessage(
          error,
          deposit
            ? "That didn't go through. Nothing was moved to savings."
            : "That didn't go through. Nothing was taken out of savings.",
        ),
      );
      // If it went through after all, the balances say so.
      void store.refresh().catch(() => undefined);
    }
  }

  const dollars = formatDollars(toDollars(kobo(amountMinor), store.rate));

  return (
    <SheetLayer>
      <Sheet
        className="shrink"
        onDismiss={phase === 'settled' ? onDone : onDismiss}
        locked={waiting}
        handleOnly
      >
        {phase === 'settled' ? (
          <View>
            <Text className="font-strong text-title text-ink">
              {deposit ? 'Added to savings' : 'Taken out of savings'}
            </Text>
            <Text tabular className="mt-4 font-strong text-title-xl text-ink">
              {formatNaira(kobo(amountMinor))}
            </Text>
            <Text tabular className="mt-0.5 font-body text-caption text-slate">
              ≈ {dollars}
            </Text>
            <View className="mt-3 border-t border-hairline">
              <Line strong label="In savings now" value={formatNaira(kobo(saved))} />
            </View>
          </View>
        ) : (
          <View>
            <Text className="font-strong text-title text-ink">
              {deposit ? 'Add to savings' : 'Take out of savings'}
            </Text>
            <Text tabular className="mt-4 font-strong text-title-xl text-ink">
              {formatNaira(kobo(amountMinor))}
            </Text>
            <Text tabular className="mt-0.5 font-body text-caption text-slate">
              ≈ {dollars}
            </Text>

            <View className="mt-3 border-t border-hairline">
              <Line
                label="You can spend"
                value={`${formatNaira(kobo(spendable))} → ${formatNaira(
                  kobo(Math.max(0, deposit ? spendable - amountMinor : spendable + amountMinor)),
                )}`}
              />
              <Line
                label="In savings"
                value={`${formatNaira(kobo(saved))} → ${formatNaira(
                  kobo(Math.max(0, deposit ? saved + amountMinor : saved - amountMinor)),
                )}`}
              />
            </View>

            <Text className="mt-2 font-body text-caption text-slate">
              Money set aside, separate from what you spend. It doesn&apos;t earn interest yet.
            </Text>

            {!check.ok && check.kind !== 'empty' ? (
              <Text className="mt-3 font-body text-label text-caution">{check.reason}</Text>
            ) : null}
            {problem ? <Text className="mt-3 font-body text-label text-halt">{problem}</Text> : null}
            {waiting ? (
              <Text className="mt-3 font-body text-label text-slate">Waiting for it to settle.</Text>
            ) : null}
          </View>
        )}

        <View className="mt-5 flex-row">
          {phase === 'settled' ? (
            <Button label="Done" onPress={onDone} />
          ) : (
            <Button
              label={waiting ? 'Waiting' : problem ? 'Try again' : deposit ? 'Confirm and add' : 'Confirm and take out'}
              busy={waiting}
              disabled={!check.ok}
              onPress={() => void confirm()}
            />
          )}
        </View>
      </Sheet>
    </SheetLayer>
  );
}
