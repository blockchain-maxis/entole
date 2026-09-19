import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { PauseButton } from '@/components/ui/PauseButton';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { UnavailableNote } from '@/components/ui/UnavailableNote';
import { billsSetup } from '@/lib/bills';
import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { payBill, type PayBillResponse } from '@entole/core/bill-payment';
import { formatNaira, kobo } from '@entole/core/money';
import { billCategory } from '@entole/core/pay-hub';
import { useStore } from '@entole/core/store';

export default function PayBillAmount() {
  const router = useRouter();
  const store = useStore();
  const params = useLocalSearchParams<{ category?: string; reference?: string }>();
  const info = billCategory(params.category);
  const setup = billsSetup();

  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [paying, setPaying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PayBillResponse | null>(null);

  const amount = useMemo(() => entryToMinor(entry), [entry]);
  const enough = amount > 0 && amount <= store.balance;

  async function submit() {
    if (!info || !setup || !enough || paying) return;
    const itemCode = setup.itemCodes[info.id];
    if (!itemCode) {
      setProblem("This biller isn't set up yet.");
      return;
    }
    setProblem(null);
    setPaying(true);
    try {
      // Resolves only once the aggregator answers — nothing shows as paid before then.
      const result = await payBill(
        {
          category: info.id,
          customerIdentifier: params.reference ?? '',
          itemCode,
          amountMinor: amount,
          reference: `bill-${Date.now()}`,
        },
        setup.config,
      );
      if (result.status === 'failed') {
        setProblem('That payment did not go through. Nothing left your balance.');
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setOutcome(result);
      }
    } catch {
      setProblem('That payment did not go through. Nothing left your balance.');
    } finally {
      setPaying(false);
    }
  }

  if (outcome && info) {
    return (
      <Screen>
        <Header title={info.label} leading="none" trailing={<PauseButton />} />
        <View className="flex-1 items-center justify-center px-gutter-lg">
          <View className="rounded-chip bg-settled-wash px-2.5 py-1">
            <Text className="font-heavy text-caption-sm uppercase text-settled">
              {outcome.status === 'successful' ? 'Paid' : 'Submitted'}
            </Text>
          </View>
          <View className="mt-4">
            <Amount value={kobo(amount)} size="large" />
          </View>
          <Text className="mt-2 font-body text-body-sm text-slate">for {info.label}</Text>
          <Text tabular className="mt-1 font-body text-caption text-mist">
            {outcome.reference}
          </Text>
        </View>
        <View className="flex-none flex-row px-gutter-lg pb-2.5 pt-3">
          <Button label="Done" onPress={() => router.dismissAll()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={info ? info.label : 'Pay a bill'} trailing={<PauseButton />} />

      <View className="flex-1 items-center px-gutter-lg pt-3">
        {setup ? null : (
          <View className="mb-5 w-full">
            <UnavailableNote
              title="Bill payments aren't available yet"
              body="Nothing will be charged. Paying switches on once bill payments are set up."
            />
          </View>
        )}

        <Text className="font-body text-label-sm text-slate">How much?</Text>
        <View className="mt-4">
          <Amount value={amount} size="large" caret />
        </View>

        {problem ? <Text className="mt-4 text-center font-body text-label-sm text-halt">{problem}</Text> : null}

        {amount > 0 && !enough ? (
          <Text className="mt-4 text-center font-body text-label-sm text-caution">
            That is more than your balance covers.
          </Text>
        ) : null}
      </View>

      <View className="flex-none px-3.5 pb-2.5">
        <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
        <View className="mt-3 flex-row">
          <Button
            label={paying ? 'Paying' : amount > 0 ? `Pay ${formatNaira(amount)}` : 'Pay'}
            busy={paying}
            disabled={!setup || !enough}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </Screen>
  );
}
