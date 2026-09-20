import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { countryName } from '@entole/core/countries';
import { entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
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
import { cleanNote, entryFromParam } from '@/lib/recipient';
import { checkSendAmount } from '@/lib/send';

/**
 * Amount entry. No fee is shown here: the fee is only real once it is quoted,
 * so it appears on the review sheet after Review is tapped, next to what the
 * person will actually be charged.
 *
 * Params: `contactId` is the recipient (a saved one, or a `code:` one-off);
 * `amount` (kobo) pre-fills the keypad — a link that asks for an amount sends
 * it here — and `note` pre-fills the review sheet's note. The amount is only a
 * starting point: the keypad still edits it.
 */
export default function Send() {
  const router = useRouter();
  const store = useStore();
  const params = useLocalSearchParams<{ contactId?: string; amount?: string; note?: string }>();

  const [entry, setEntry] = useState<AmountEntry>(() => entryFromParam(params.amount));
  const [reviewing, setReviewing] = useState(false);

  const loading = store.status === 'loading';
  const contact = params.contactId ? store.contact(params.contactId) : undefined;
  const amount = useMemo(() => entryToMinor(entry), [entry]);
  const firstName = contact?.name.split(' ')[0] ?? 'They';
  const where = countryName(contact?.place);

  const check = checkSendAmount({ amount, balance: store.balance, rate: store.rate });
  const reason = check.ok || check.kind === 'empty' || check.kind === 'no-balance' ? null : check.reason;
  const defaultNote = cleanNote(params.note);
  const changeRecipient = () =>
    router.replace({ pathname: '/send/pick', params: defaultNote ? { note: defaultNote } : {} });
  const canReview = store.status === 'ready' && Boolean(contact) && check.ok;

  return (
    <View className="flex-1">
      <Screen>
        <Header title="Send" />

        <View className="flex-1 items-center px-gutter-lg pt-3">
          {loading ? (
            <View className="items-center">
              <Skeleton className="h-[88px] w-[88px] rounded-pill" />
              <Skeleton className="mt-3 h-5 w-36 rounded-md" />
            </View>
          ) : contact ? (
            <>
              <Avatar initials={contact.initials} tone={contact.tone} size="hero" />
              <Text className="mt-3 font-strong text-headline text-ink">{contact.name}</Text>
              <View className="mt-1 flex-row items-center gap-1.5">
                {where ? <Text className="font-body text-label-sm text-slate">{where}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change who you are sending to"
                  hitSlop={10}
                  onPress={changeRecipient}
                >
                  <Text className="font-strong text-label-sm text-indigo">Change</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View className="items-center pt-4">
              <Text className="font-strong text-headline text-ink">Who are you sending to?</Text>
              <Pressable
                accessibilityRole="button"
                onPress={changeRecipient}
                className="mt-3 rounded-pill border border-line bg-card px-4 py-2.5 active:border-mist"
              >
                <Text className="font-strong text-label text-indigo">Choose who to send to</Text>
              </Pressable>
            </View>
          )}

          <View className="mt-7">
            <Amount value={amount} size="large" caret />
          </View>

          <Text tabular className="mt-2.5 font-body text-body-sm text-slate">
            {amount > 0 && !loading
              ? `${firstName} receives ${formatDollars(toDollars(amount, store.rate))}`
              : 'Enter an amount'}
          </Text>

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
            ) : !loading && !contact ? (
              <Text className="text-center font-body text-label-sm text-slate">
                Choose who you&apos;re sending to.
              </Text>
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
          {...(defaultNote ? { defaultNote } : {})}
          onDismiss={() => setReviewing(false)}
        />
      ) : null}
    </View>
  );
}
