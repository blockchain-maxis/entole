import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Share, View } from 'react-native';

import { Figure } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ReceiptLine } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { countryName } from '@entole/core/countries';
import { timeWithSeconds } from '@entole/core/format';
import { isOneOffId, oneOffCode } from '@entole/core/one-off';
import { cents, formatDollars, formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { rateLine } from '@/lib/send';

/**
 * A payment is pending until it is delivered, and then it is this: what was
 * sent, as the figure, to whom, and the facts of it as ruled lines. Nothing on
 * this screen is drawn before the payment has actually been delivered.
 */
export default function Receipt() {
  const router = useRouter();
  const store = useStore();
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();
  const receipt = store.receipt(receiptId);
  const contact = receipt ? store.contact(receipt.contactId) : undefined;

  if (!receipt) {
    return (
      <Screen>
        <Header leading="close" />
        <View className="flex-1 px-gutter pt-2">
          <Text accessibilityRole="header" className="font-display text-heading text-ink">
            That receipt is no longer open
          </Text>
          <Text className="mt-2 font-body text-prose text-slate">
            Your activity has every payment that has been delivered.
          </Text>
        </View>
        <ActionBar divided={false}>
          <Button label="Done" variant="secondary" onPress={() => router.replace('/(tabs)')} />
        </ActionBar>
      </Screen>
    );
  }

  const who = contact?.name ?? 'your recipient';
  const where = countryName(contact?.place);
  const seconds = `${receipt.deliveredInSeconds} ${receipt.deliveredInSeconds === 1 ? 'second' : 'seconds'}`;
  const summary = [
    `${formatNaira(kobo(receipt.amountMinor))} to ${who}`,
    `Delivered in ${seconds}`,
    `Reference ${receipt.reference}`,
  ].join('\n');

  return (
    <Screen>
      <Header leading="close" onLeadingPress={() => router.replace('/(tabs)')} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}
      >
        <View className="flex-row items-center gap-1.5 self-start rounded-pill bg-settled-wash px-2.5 py-1">
          <View className="h-1.5 w-1.5 rounded-pill bg-settled" />
          <Text tabular className="font-strong text-note text-settled">
            Delivered at {timeWithSeconds(receipt.settledAt)}
          </Text>
        </View>

        <View className="mt-4">
          <Figure value={kobo(receipt.amountMinor)} />
        </View>
        <Text accessibilityRole="header" className="mt-2 font-display text-subhead text-ink">
          to {who}
        </Text>
        {where ? <Text className="mt-0.5 font-body text-ui text-slate">{where}</Text> : null}

        <View className="mt-6 border-t border-hairline">
          <ReceiptLine label="They received" value={formatDollars(cents(receipt.receivedMinor))} />
          <ReceiptLine label="Fee" value={formatNaira(kobo(receipt.feeMinor))} />
          <ReceiptLine label="Total from you" value={formatNaira(kobo(receipt.amountMinor + receipt.feeMinor))} />
          <ReceiptLine
            label="Rate"
            value={rateLine({ koboPerDollar: receipt.koboPerDollar, quotedAt: receipt.settledAt })}
          />
          <ReceiptLine label="Sent at" value={timeWithSeconds(receipt.sentAt)} />
          <ReceiptLine label="Delivered in" value={seconds} />
        </View>

        <Text tabular className="mt-3 font-body text-note text-slate">
          Reference {receipt.reference} · nothing is pending
        </Text>

        {isOneOffId(receipt.contactId) ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() =>
              router.push({ pathname: '/beneficiaries/new', params: { code: oneOffCode(receipt.contactId) ?? '' } })
            }
            className="mt-6 self-start"
          >
            <Text className="font-strong text-ui text-ink underline">Save as a beneficiary</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <ActionBar divided={false}>
        <Button label="Share receipt" variant="secondary" onPress={() => void Share.share({ message: summary })} />
        <Button label="Done" onPress={() => router.replace('/(tabs)')} />
      </ActionBar>
    </Screen>
  );
}
