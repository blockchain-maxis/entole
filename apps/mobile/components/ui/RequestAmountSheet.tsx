import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  EMPTY_ENTRY,
  entryFromMinor,
  entryToMinor,
  pressKey,
  type AmountEntry,
} from '@entole/core/amount-entry';
import { kobo } from '@entole/core/money';

import { Amount } from './Amount';
import { Button } from './Button';
import { Keypad } from './Keypad';
import { Sheet, SheetLayer } from './Sheet';
import { Text } from './Text';

/**
 * Asks for a fixed amount on the checkout link. The amount goes in through the
 * keypad, never the system keyboard, and is naira in whole minor units — the
 * link carries it with its currency, so whoever opens it sees the same number.
 * `current` is the amount already on the link (0 for none).
 */
export function RequestAmountSheet({
  current,
  onSet,
  onDismiss,
}: {
  current: number;
  onSet: (amountMinor: number) => void;
  onDismiss: () => void;
}) {
  const [entry, setEntry] = useState<AmountEntry>(() =>
    current > 0 ? entryFromMinor(kobo(current)) : EMPTY_ENTRY,
  );
  const amount = useMemo(() => entryToMinor(entry), [entry]);

  return (
    <SheetLayer>
      <Sheet onDismiss={onDismiss} handleOnly>
        <Text className="font-strong text-title text-ink">Request an amount</Text>
        <Text className="mt-1 font-body text-label text-slate">
          The link will ask for exactly this. Leave it off and they choose.
        </Text>

        <View className="mt-5 items-center">
          <Amount value={amount} size="large" caret />
        </View>

        <View className="mt-4">
          <Keypad onKey={(key) => setEntry((existing) => pressKey(existing, key))} />
        </View>

        <View className="mt-3 flex-row gap-2.5">
          {current > 0 ? <Button label="Remove" variant="secondary" onPress={() => onSet(0)} /> : null}
          <Button label="Set amount" disabled={amount <= 0} onPress={() => onSet(amount)} />
        </View>
      </Sheet>
    </SheetLayer>
  );
}
