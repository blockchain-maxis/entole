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
 * An amount, entered on the custom keypad in a bottom sheet — never the system
 * keyboard. `current` is the amount already set (0 for none). `onClear` adds a
 * quiet "Remove" for amounts that are optional.
 */
export function AmountSheet({
  title,
  hint,
  current,
  setLabel = 'Set amount',
  onSet,
  onClear,
  onDismiss,
}: {
  title: string;
  hint?: string;
  current: number;
  setLabel?: string;
  onSet: (amountMinor: number) => void;
  onClear?: () => void;
  onDismiss: () => void;
}) {
  const [entry, setEntry] = useState<AmountEntry>(() => (current > 0 ? entryFromMinor(kobo(current)) : EMPTY_ENTRY));
  const amount = useMemo(() => entryToMinor(entry), [entry]);

  return (
    <SheetLayer>
      <Sheet onDismiss={onDismiss} handleOnly>
        <Text className="font-strong text-title text-ink">{title}</Text>
        {hint ? <Text className="mt-1 font-body text-label text-slate">{hint}</Text> : null}

        <View className="mt-5 items-center">
          <Amount value={amount} size="large" caret />
        </View>

        <View className="mt-4">
          <Keypad onKey={(key) => setEntry((existing) => pressKey(existing, key))} />
        </View>

        <View className="mt-3 flex-row gap-2.5">
          {onClear && current > 0 ? <Button label="Remove" variant="secondary" onPress={onClear} /> : null}
          <Button label={setLabel} disabled={amount <= 0} onPress={() => onSet(amount)} />
        </View>
      </Sheet>
    </SheetLayer>
  );
}
