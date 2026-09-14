import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { arrivalEstimate } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { ESTIMATED_ARRIVAL_SECONDS, FEE_MINOR } from '@entole/core/gateway';
import { formatDollars, formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

export default function Send() {
  const router = useRouter();
  const store = useStore();
  const params = useLocalSearchParams<{ contactId?: string }>();

  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const contact = store.contact(params.contactId ?? 'c-chidi') ?? store.contacts[0];
  const amount = useMemo(() => entryToMinor(entry), [entry]);
  const firstName = contact?.name.split(' ')[0] ?? 'They';
  const enough = amount > 0 && amount + FEE_MINOR <= store.balance;

  async function submit() {
    if (!contact || !enough || sending) return;
    setProblem(null);
    setSending(true);
    try {
      // Resolves only once the payment has settled. Nothing is shown as done
      // before then.
      const receipt = await store.send({ contactId: contact.id, amountMinor: amount });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: '/send/receipt', params: { receiptId: receipt.id } });
    } catch {
      setProblem('That payment did not go through. Nothing left your balance.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <Header title="Send" />

      <View className="flex-1 items-center px-gutter-lg pt-3">
        {contact ? (
          <>
            <Avatar initials={contact.initials} tone={contact.tone} size="hero" />
            <Text className="mt-3 font-strong text-headline text-ink">{contact.name}</Text>
            <View className="mt-1 flex-row items-center gap-1.5">
              <Text className="font-body text-label-sm text-slate">{contact.place}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change recipient"
                hitSlop={10}
                onPress={() => router.push('/send/pick')}
              >
                <Text className="font-strong text-label-sm text-indigo">Change</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        <View className="mt-7">
          <Amount value={amount} size="large" caret />
        </View>

        <Text tabular className="mt-2.5 font-body text-body-sm text-slate">
          {amount > 0
            ? `${firstName} receives ${formatDollars(toDollars(amount, store.rate))}`
            : 'Enter an amount'}
        </Text>

        <View className="mt-5 rounded-pill border border-line bg-card px-4 py-2.5">
          <Text tabular className="font-body text-label-sm text-slate">
            Fee {formatNaira(kobo(FEE_MINOR))} · arrives in {arrivalEstimate(ESTIMATED_ARRIVAL_SECONDS)}
          </Text>
        </View>

        {problem ? (
          <Text className="mt-4 text-center font-body text-label-sm text-halt">{problem}</Text>
        ) : null}

        {amount > 0 && !enough ? (
          <Text className="mt-4 text-center font-body text-label-sm text-caution">
            That is more than your balance covers, including the fee.
          </Text>
        ) : null}
      </View>

      <View className="flex-none px-3.5 pb-2.5">
        <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
        <View className="mt-3 flex-row">
          <Button
            label={sending ? 'Sending' : amount > 0 ? `Send ${formatNaira(amount)}` : 'Send'}
            busy={sending}
            disabled={!enough}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </Screen>
  );
}
