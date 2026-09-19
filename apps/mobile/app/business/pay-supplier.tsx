import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { arrivalEstimate } from '@entole/core/format';
import { ESTIMATED_ARRIVAL_SECONDS, FEE_MINOR } from '@entole/core/gateway';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

/**
 * Paying a supplier is the same settlement as sending money to anyone — one
 * payment, one receipt — so this screen calls the same `store.send()` the
 * personal send flow does. A supplier has to be someone already in your
 * contacts; there is no separate supplier record to invent.
 */
export default function PaySupplier() {
  const router = useRouter();
  const store = useStore();

  const [contactId, setContactId] = useState<string | null>(null);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const contact = contactId ? store.contact(contactId) : undefined;
  const amount = useMemo(() => entryToMinor(entry), [entry]);
  const enough = amount > 0 && amount + FEE_MINOR <= store.balance;
  const ready = Boolean(contact) && enough;

  async function submit() {
    if (!contact || !ready || sending) return;
    setProblem(null);
    setSending(true);
    try {
      // Resolves only once the payment has settled — nothing is shown as
      // done before then.
      const receipt = await store.send({
        contactId: contact.id,
        amountMinor: amount,
        note: 'Supplier payment',
      });
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
      <Header title="Pay a supplier" />

      <View className="flex-1 px-gutter-lg pt-2">
        <Text className="font-heavy text-body-sm text-ink">Who are you paying?</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3 flex-none"
          contentContainerStyle={{ gap: 10, paddingRight: 8 }}
        >
          {store.contacts.map((entryContact) => {
            const selected = entryContact.id === contactId;
            return (
              <Pressable
                key={entryContact.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Pay ${entryContact.name}`}
                onPress={() => setContactId(entryContact.id)}
                className={`flex-row items-center gap-2 rounded-pill border py-1.5 pl-1.5 pr-3.5 ${
                  selected ? 'border-indigo bg-indigo-wash' : 'border-line bg-card'
                }`}
              >
                <Avatar initials={entryContact.initials} tone={entryContact.tone} />
                <Text className="font-strong text-label-sm text-ink">{entryContact.name.split(' ')[0]}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View className="mt-6 items-center">
          <Amount value={amount} size="large" caret />
          <Text tabular className="mt-2.5 font-body text-label-sm text-slate">
            {contact ? `To ${contact.name}` : 'Pick a supplier first'} · Fee {formatNaira(kobo(FEE_MINOR))} · arrives
            in {arrivalEstimate(ESTIMATED_ARRIVAL_SECONDS)}
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
            label={sending ? 'Sending' : amount > 0 ? `Pay ${formatNaira(amount)}` : 'Pay'}
            busy={sending}
            disabled={!ready}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </Screen>
  );
}
