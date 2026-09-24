import { useLocalSearchParams, useRouter } from 'expo-router';
import { Share, View } from 'react-native';

import { countryName } from '@entole/core/countries';
import { settledAt, timeWithSeconds } from '@entole/core/format';
import { cents, formatDollars, formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/ui/Avatar';
import { AssistantBadge, SettledBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ReceiptLine } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { rateLine } from '@/lib/send';

/**
 * Full detail for one line of the activity feed. A payment sent this session
 * still has its full `Receipt` (fee, rate, delivered-in-seconds) — that
 * doesn't survive an app restart, so anything older, and anything received
 * rather than sent, falls back to what the `Activity` entry itself carries.
 * Never invents the rest to fill the gap.
 */
export default function ActivityDetail() {
  const router = useRouter();
  const store = useStore();
  const { id } = useLocalSearchParams<{ id: string }>();

  const entry = store.activity.find((item) => item.id === id);
  const receipt = id ? store.receipt(id) : undefined;
  const contact = entry ? store.contact(entry.contactId) : undefined;

  if (!entry) {
    return (
      <Screen>
        <Header title="Payment" />
        <View className="flex-1 items-center justify-center px-gutter">
          <Text className="text-center font-body text-body-sm text-slate">
            That payment is no longer in your activity.
          </Text>
        </View>
      </Screen>
    );
  }

  const byAssistant = entry.initiatedBy === 'assistant';
  const pending = entry.state === 'pending';
  const summary = [
    `${formatNaira(kobo(entry.amountMinor))} ${entry.direction === 'in' ? 'from' : 'to'} ${contact?.name ?? 'a payment'}`,
    settledAt(entry.at),
  ].join('\n');

  return (
    <Screen>
      <Header title="Payment" />

      <View className="flex-1 px-gutter pt-2">
        <View className="items-center pb-[26px] pt-3.5">
          <Avatar initials={contact?.initials ?? '?'} tone={contact?.tone ?? 1} size="hero" />
          <View className="mt-3 flex-row items-center gap-1.5">
            <Text className="font-strong text-title text-ink">{contact?.name ?? 'Someone'}</Text>
            {byAssistant ? <AssistantBadge /> : null}
          </View>
          {countryName(contact?.place) ? (
            <Text className="mt-0.5 font-body text-caption text-slate">{countryName(contact?.place)}</Text>
          ) : null}
        </View>

        <View className="rounded-tile border border-line bg-card px-[18px] py-5">
          <View className="flex-row items-baseline justify-between border-b border-hairline pb-[18px]">
            <Text className="font-heavy text-body-sm text-ink">
              {entry.direction === 'in' ? 'Amount received' : 'Amount sent'}
            </Text>
            <Text
              tabular
              className={`font-strong text-amount-xs ${entry.direction === 'in' ? 'text-settled' : 'text-ink'}`}
            >
              {formatNaira(kobo(entry.amountMinor))}
            </Text>
          </View>

          {receipt ? (
            <>
              <ReceiptLine label="Fee" value={formatNaira(kobo(receipt.feeMinor))} />
              <ReceiptLine
                label="Total from you"
                value={formatNaira(kobo(receipt.amountMinor + receipt.feeMinor))}
              />
              <ReceiptLine
                label="Rate"
                value={rateLine({ koboPerDollar: receipt.koboPerDollar, quotedAt: receipt.settledAt })}
              />
              <ReceiptLine label="Sent at" value={timeWithSeconds(receipt.sentAt)} />
              <ReceiptLine
                label="Delivered in"
                value={`${receipt.deliveredInSeconds} ${receipt.deliveredInSeconds === 1 ? 'second' : 'seconds'}`}
              />
              <ReceiptLine label="Reference" value={receipt.reference} />
              <View className="mt-1.5 flex-row items-baseline justify-between border-t border-hairline pb-0.5 pt-4">
                <Text className="font-heavy text-body-sm text-ink">Amount received</Text>
                <Text tabular className="font-strong text-amount-xs text-settled">
                  {formatDollars(cents(receipt.receivedMinor))}
                </Text>
              </View>
            </>
          ) : (
            <>
              <ReceiptLine label="Note" value={entry.note} />
              <ReceiptLine label="When" value={settledAt(entry.at)} />
              <ReceiptLine label="Status" value={pending ? 'Pending' : 'Settled'} />
            </>
          )}

          {entry.allowanceId ? (
            <View className="mt-4 border-t border-hairline pt-4">
              <Button
                label="View this allowance"
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/rules/[id]', params: { id: entry.allowanceId! } })
                }
              />
            </View>
          ) : null}
        </View>

        {!pending ? (
          <View className="mt-4 flex-row items-center justify-center gap-2">
            <SettledBadge>Final</SettledBadge>
          </View>
        ) : null}
      </View>

      <ActionBar divided={false}>
        <Button label="Share" variant="secondary" onPress={() => void Share.share({ message: summary })} />
      </ActionBar>
    </Screen>
  );
}
