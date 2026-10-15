import { useState } from 'react';
import { View } from 'react-native';

import { relativeMoment } from '@entole/core/format';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Button } from './Button';
import { Text } from './Text';

/**
 * What a paid invoice set aside for tax. It is a figure the business keeps in
 * view, not money moved: the card says so, and offers to move it into savings
 * so it is apart from what can be spent. No date is made up for paying it.
 * Mirrors `apps/web/components/TaxReserveCard.tsx`.
 */
export function TaxReserveCard() {
  const store = useStore();
  const [moving, setMoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reserves = store.taxReserves;
  if (reserves.length === 0) return null;
  const toMove = reserves.reduce((sum, reserve) => sum + (reserve.movedAt ? 0 : reserve.balanceMinor), 0);
  const moved = reserves.reduce((sum, reserve) => sum + (reserve.movedAt ? reserve.balanceMinor : 0), 0);
  const latest = reserves[0]!;

  async function move() {
    if (moving) return;
    setMoving(true);
    setProblem(null);
    try {
      await store.moveTaxReserveToSavings();
    } catch (error) {
      setProblem(
        error instanceof Error && error.name === 'MovementNotConfirmedError'
          ? error.message
          : "That didn't go through. Nothing moved. Try again.",
      );
    } finally {
      setMoving(false);
    }
  }

  return (
    <View className="mt-8 border-y border-hairline py-5">
      <Text accessibilityRole="header" className="font-strong text-note text-slate">
        Set aside for tax
      </Text>
      <Text tabular className="mt-2 font-display text-figure-sm text-ink">
        {formatNaira(kobo(toMove + moved))}
      </Text>
      <Text className="mt-1.5 font-body text-note text-slate">
        {`From ${reserves.length === 1 ? 'one paid invoice' : `${reserves.length} paid invoices`}${
          latest.setAsideAt ? `, the last ${relativeMoment(latest.setAsideAt)}` : ''
        }. `}
        {moved > 0 ? `${formatNaira(kobo(moved))} of it is in savings.` : 'It is a figure to keep in view; it has not left your balance.'}
      </Text>
      {problem ? <Text className="mt-2 font-body text-note text-halt">{problem}</Text> : null}
      {toMove > 0 ? (
        <View className="mt-4 flex-row">
          <Button
            label={moving ? 'Moving' : `Move ${formatNaira(kobo(toMove))} to savings`}
            width="hug"
            busy={moving}
            onPress={() => void move()}
          />
        </View>
      ) : null}
    </View>
  );
}
