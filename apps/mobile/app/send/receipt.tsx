import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Figure } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ReceiptSlip, SlipFoot, SlipHead, SlipRow, SlipRows, SlipStatus } from '@/components/ui/ReceiptSlip';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { VoiceOffer } from '@/components/ui/VoiceOffer';
import { RECEIPT_LEFT_LINE, sentLine } from '@entole/core/assistant-voice-lines';
import { useBackend } from '@entole/core/backend';
import { countryName } from '@entole/core/countries';
import { timeWithSeconds } from '@entole/core/format';
import { isOneOffId } from '@entole/core/one-off';
import { cents, formatDollars, formatNaira, kobo } from '@entole/core/money';
import { reportForReceipt } from '@entole/core/receipt-slip';
import { useStore } from '@entole/core/store';

import { rateLine } from '@/lib/send';
import { shareReceipt } from '@/lib/share-receipt';

/**
 * A payment is pending until it is delivered, and then it is this: a slip.
 * The amount as the figure, to whom, and the facts of it as ruled rows, on the
 * one raised surface of the screen. Nothing on this screen is drawn before the
 * payment has actually been delivered. It is shared as a picture of the slip.
 */
export default function Receipt() {
  const router = useRouter();
  const store = useStore();
  const backend = useBackend();
  const { receiptId, voice } = useLocalSearchParams<{ receiptId: string; voice?: string }>();
  const receipt = store.receipt(receiptId);
  const contact = receipt ? store.contact(receipt.contactId) : undefined;
  // The same payment as it sits in activity: it has the note, and who made it.
  const entry = receipt ? store.activity.find((item) => item.id === receipt.id) : undefined;
  const [sharing, setSharing] = useState(false);
  const [line, setLine] = useState<string | null>(null);

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
  // The receipt in words, for when the picture cannot go.
  const summary = [
    `${formatNaira(kobo(receipt.amountMinor))} to ${who}`,
    `Delivered in ${seconds}`,
    `Reference ${receipt.reference}`,
  ].join('\n');

  async function share() {
    if (!receipt || sharing) return;
    setLine(null);
    setSharing(true);
    const report = reportForReceipt(receipt, entry?.note);
    const outcome = await shareReceipt({
      reference: receipt.reference,
      words: summary,
      tell: async () => (report ? backend.payments.record(report) : false),
    });
    setSharing(false);
    if (outcome === 'words-instead') setLine("We couldn't get the picture, so the receipt was shared in words.");
    if (outcome === 'failed') setLine("We couldn't share this receipt. Try again in a moment.");
  }

  return (
    <Screen>
      {/* Paid by voice: it says the payment has gone and offers the receipt; a spoken yes opens the share sheet. */}
      {voice === '1' ? (
        <VoiceOffer
          say={sentLine({ name: who, amountMinor: receipt.amountMinor })}
          yes={() => void share()}
          declined={RECEIPT_LEFT_LINE}
          no={() => undefined}
        />
      ) : null}
      <Header leading="close" onLeadingPress={() => router.replace('/(tabs)')} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}
      >
        <ReceiptSlip>
          <SlipHead />
          <SlipStatus byAssistant={entry?.initiatedBy === 'assistant'}>
            Delivered at {timeWithSeconds(receipt.settledAt)}
          </SlipStatus>

          <View className="mt-3">
            <Figure value={kobo(receipt.amountMinor)} />
          </View>
          <Text className="mt-1.5 font-display text-subhead text-ink">to {who}</Text>
          {where ? <Text className="mt-0.5 font-body text-ui text-slate">{where}</Text> : null}

          <SlipRows>
            <SlipRow label="They received" value={formatDollars(cents(receipt.receivedMinor))} />
            <SlipRow label="Fee" value={formatNaira(kobo(receipt.feeMinor))} />
            <SlipRow label="Total from you" value={formatNaira(kobo(receipt.amountMinor + receipt.feeMinor))} />
            <SlipRow
              label="Rate"
              value={rateLine({ koboPerDollar: receipt.koboPerDollar, quotedAt: receipt.settledAt })}
            />
            <SlipRow label="Sent at" value={timeWithSeconds(receipt.sentAt)} />
            <SlipRow label="Delivered in" value={seconds} />
            <SlipRow label="Reference" value={receipt.reference} spaced />
          </SlipRows>
          <SlipFoot>Nothing is pending.</SlipFoot>
        </ReceiptSlip>

        {isOneOffId(receipt.contactId) ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() =>
              router.push({ pathname: '/beneficiaries/new', params: { recipient: receipt.contactId } })
            }
            className="mt-6 self-start"
          >
            <Text className="font-strong text-ui text-ink underline">Save as a beneficiary</Text>
          </Pressable>
        ) : null}

        {line ? (
          <Text accessibilityLiveRegion="polite" className="mt-5 font-body text-note text-slate">
            {line}
          </Text>
        ) : null}
      </ScrollView>

      <ActionBar divided={false}>
        <Button label="Share receipt" variant="secondary" busy={sharing} onPress={() => void share()} />
        <Button label="Done" onPress={() => router.replace('/(tabs)')} />
      </ActionBar>
    </Screen>
  );
}
