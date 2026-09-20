import { useLocalSearchParams, useRouter } from 'expo-router';
import { Share, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { SettledBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ReceiptLine } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { countryName } from '@entole/core/countries';
import { settledAt, timeWithSeconds } from '@entole/core/format';
import { isOneOffId, oneOffCode } from '@entole/core/one-off';
import { cents, formatDollars, formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { rateLine } from '@/lib/send';

/**
 * A payment is pending until it settles, and then it is this. Nothing on this
 * screen is rendered before the settled state actually arrives.
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
        <View className="flex-1 items-center justify-center px-gutter">
          <Text className="text-center font-body text-body-sm text-slate">
            That receipt is no longer open. Your activity has every payment that has settled.
          </Text>
        </View>
        <ActionBar divided={false}>
          <Button label="Done" variant="secondary" onPress={() => router.replace('/(tabs)')} />
        </ActionBar>
      </Screen>
    );
  }

  const summary = [
    `${formatNaira(kobo(receipt.amountMinor))} to ${contact?.name ?? 'your recipient'}`,
    settledAt(receipt.settledAt),
    `Reference ${receipt.reference}`,
  ].join('\n');

  return (
    <Screen>
      <Header leading="close" onLeadingPress={() => router.replace('/(tabs)')} />

      <View className="flex-1 px-gutter pt-2">
        <View className="items-center pb-[26px] pt-3.5">
          <View className="h-[52px] w-[52px] items-center justify-center rounded-pill bg-settled">
            <Text className="font-strong text-amount text-card">✓</Text>
          </View>
          <Text className="mt-4 font-strong text-title text-ink">Money delivered</Text>
          <Text tabular className="mt-1.5 font-body text-label text-slate">
            {settledAt(receipt.settledAt)}
          </Text>
        </View>

        <View className="rounded-tile border border-line bg-card px-[18px] py-5">
          <View className="flex-row items-center gap-3 border-b border-hairline pb-[18px]">
            <Avatar initials={contact?.initials ?? '?'} tone={contact?.tone ?? 1} size="lg" />
            <View className="flex-1">
              <Text className="font-strong text-body-lg text-ink">{contact?.name ?? 'Recipient'}</Text>
              {countryName(contact?.place) ? (
                <Text className="mt-0.5 font-body text-caption text-slate">{countryName(contact?.place)}</Text>
              ) : null}
            </View>
            <SettledBadge>Final</SettledBadge>
          </View>

          <ReceiptLine label="Amount sent" value={formatNaira(kobo(receipt.amountMinor))} />
          <ReceiptLine label="Fee" value={formatNaira(kobo(receipt.feeMinor))} />
          <ReceiptLine label="Total from you" value={formatNaira(kobo(receipt.amountMinor + receipt.feeMinor))} />
          <ReceiptLine
            label="Rate"
            value={rateLine({ koboPerDollar: receipt.koboPerDollar, quotedAt: receipt.settledAt })}
          />
          <ReceiptLine label="Sent at" value={timeWithSeconds(receipt.sentAt)} />
          <ReceiptLine
            label="Delivered in"
            value={`${receipt.deliveredInSeconds} ${receipt.deliveredInSeconds === 1 ? 'second' : 'seconds'}`}
          />

          <View className="mt-1.5 flex-row items-baseline justify-between border-t border-hairline pb-0.5 pt-4">
            <Text className="font-heavy text-body-sm text-ink">Amount received</Text>
            <Text tabular className="font-strong text-amount-xs text-settled">
              {formatDollars(cents(receipt.receivedMinor))}
            </Text>
          </View>
        </View>

        <Text tabular className="mt-4 text-center font-body text-label-sm text-mist">
          Reference {receipt.reference} · nothing is pending
        </Text>
      </View>

      <ActionBar divided={false}>
        <Button
          label="Share receipt"
          onPress={() => void Share.share({ message: summary })}
        />
        {isOneOffId(receipt.contactId) ? (
          <Button
            label="Save as a beneficiary"
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/beneficiaries/new', params: { code: oneOffCode(receipt.contactId) ?? '' } })
            }
          />
        ) : null}
        <Button label="Done" variant="secondary" onPress={() => router.replace('/(tabs)')} />
      </ActionBar>
    </Screen>
  );
}
