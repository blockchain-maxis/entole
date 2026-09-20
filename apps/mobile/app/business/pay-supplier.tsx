import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { toDollars } from '@entole/core/fx';
import { formatDollars } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/ui/Amount';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmSendSheet } from '@/components/ui/ConfirmSendSheet';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { checkSendAmount } from '@/lib/send';

/**
 * Paying a supplier is the same settlement as sending money to anyone — one
 * payment, one receipt — so it goes through the same review sheet and the same
 * `store.send()` the personal send flow does. A supplier has to be a
 * beneficiary you have already added; there is no separate supplier record.
 */
export default function PaySupplier() {
  const router = useRouter();
  const store = useStore();

  const [contactId, setContactId] = useState<string | null>(null);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [reviewing, setReviewing] = useState(false);

  const loading = store.status === 'loading';
  const contact = contactId ? store.contact(contactId) : undefined;
  const amount = useMemo(() => entryToMinor(entry), [entry]);

  const check = checkSendAmount({ amount, balance: store.balance, rate: store.rate });
  const reason = check.ok || check.kind === 'empty' || check.kind === 'no-balance' ? null : check.reason;
  const canReview = store.status === 'ready' && Boolean(contact) && check.ok;

  return (
    <View className="flex-1">
      <Screen>
        <Header title="Pay a supplier" />

        <View className="flex-1 px-gutter-lg pt-2">
          <Text className="font-heavy text-body-sm text-ink">Who are you paying?</Text>
          {loading ? (
            <View className="mt-3 flex-row gap-2.5">
              <Skeleton className="h-[42px] w-28 rounded-pill" />
              <Skeleton className="h-[42px] w-28 rounded-pill" />
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              className="mt-3 flex-none"
              contentContainerStyle={{ gap: 10, paddingRight: 8 }}
            >
              {store.contacts.map((beneficiary) => {
                const selected = beneficiary.id === contactId;
                return (
                  <Pressable
                    key={beneficiary.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Pay ${beneficiary.name}`}
                    onPress={() => setContactId(beneficiary.id)}
                    className={`flex-row items-center gap-2 rounded-pill border py-1.5 pl-1.5 pr-3.5 ${
                      selected ? 'border-indigo bg-indigo-wash' : 'border-line bg-card'
                    }`}
                  >
                    <Avatar initials={beneficiary.initials} tone={beneficiary.tone} />
                    <Text className="font-strong text-label-sm text-ink">{beneficiary.name.split(' ')[0]}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/beneficiaries/new')}
                className="flex-row items-center rounded-pill border border-line bg-card px-4 py-3 active:border-mist"
              >
                <Text className="font-strong text-label-sm text-indigo">Add a beneficiary</Text>
              </Pressable>
            </ScrollView>
          )}

          <View className="mt-6 items-center">
            <Amount value={amount} size="large" caret />
            <Text tabular className="mt-2.5 text-center font-body text-label-sm text-slate">
              {!contact
                ? 'Choose who you are paying first'
                : amount > 0
                  ? `${contact.name} receives ${formatDollars(toDollars(amount, store.rate))}`
                  : `To ${contact.name}`}
            </Text>
          </View>

          <View className="mt-3 min-h-[44px] items-center">
            {store.status === 'failed' ? (
              <>
                <Text className="text-center font-body text-label-sm text-halt">
                  We couldn&apos;t load your account.
                </Text>
                <Pressable accessibilityRole="button" hitSlop={10} onPress={() => void store.refresh()}>
                  <Text className="mt-1 font-strong text-label-sm text-indigo">Try again</Text>
                </Pressable>
              </>
            ) : !loading && check.ok === false && check.kind === 'no-balance' ? (
              <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.push('/add-money')}>
                <Text className="text-center font-strong text-label text-indigo">Add money first</Text>
              </Pressable>
            ) : reason ? (
              <Text className="text-center font-body text-label-sm text-caution">{reason}</Text>
            ) : null}
          </View>
        </View>

        <View className="flex-none px-3.5 pb-2.5">
          <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
          <View className="mt-3 flex-row">
            <Button label="Review" disabled={!canReview} onPress={() => setReviewing(true)} />
          </View>
        </View>
      </Screen>

      {reviewing && contact ? (
        <ConfirmSendSheet
          contact={contact}
          amountMinor={amount}
          defaultNote="Supplier payment"
          onDismiss={() => setReviewing(false)}
        />
      ) : null}
    </View>
  );
}
