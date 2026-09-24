import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { countryName } from '@entole/core/countries';
import type { SendQuote } from '@entole/core/gateway';
import { cents, formatDollars, formatNaira, kobo } from '@entole/core/money';
import type { Contact } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { plainMessage, rateLine } from '@/lib/send';
import { useToast } from '@/lib/toast';

import { Avatar } from './Avatar';
import { Button } from './Button';
import { Field } from './Field';
import { Sheet, SheetLayer } from './Sheet';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

type Quote = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; quote: SendQuote };

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row items-baseline justify-between py-2.5">
      <Text className={`font-body text-label ${strong ? 'text-ink' : 'text-slate'}`}>{label}</Text>
      <Text tabular className={`text-label text-ink ${strong ? 'font-heavy' : 'font-strong'}`}>
        {value}
      </Text>
    </View>
  );
}

/**
 * The last look before money leaves. Everything on it comes from
 * `store.quoteSend` — the fee is whatever the payment will really cost, never
 * a number this screen carries — and nothing is shown as sent until the
 * payment has settled: `store.send` resolves only then, and only then does
 * this move on to the receipt.
 *
 * States: `loading` (skeleton while the quote is fetched), `failed` (the
 * quote's own message, with a retry), `ready`, `not enough` (the total with
 * the fee does not fit the balance — no send is offered), `sending` (locked,
 * waiting for the payment to settle), and a send failure (the message inline,
 * with a retry).
 */
export function ConfirmSendSheet({
  contact,
  amountMinor,
  defaultNote,
  onDismiss,
}: {
  contact: Contact;
  amountMinor: number;
  /** Pre-fills the note — a supplier payment says so. */
  defaultNote?: string;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const store = useStore();
  const { show } = useToast();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { quoteSend } = store;

  const [quote, setQuote] = useState<Quote>({ state: 'loading' });
  const [note, setNote] = useState(defaultNote ?? '');
  const [noteOpen, setNoteOpen] = useState(Boolean(defaultNote));
  const [sending, setSending] = useState(false);
  const [settled, setSettled] = useState(false);
  // A sane default for the very first frame, before `onLayout` reports the
  // button row's real height.
  const [footerHeight, setFooterHeight] = useState(56);

  // A number the scrollable area can trust regardless of whether ancestor
  // `flexShrink` is honoured through the sheet's animated + absolutely
  // positioned tree — it wasn't, on Android, which left the button below the
  // screen. `footerHeight` is measured, not guessed, so the reserved space
  // matches whatever the button row actually renders at.
  const chromeAboveScroll = 22 + 28; // the card's own top padding + the grabber row
  const scrollMaxHeight = Math.max(
    120,
    height - insets.top - insets.bottom - chromeAboveScroll - footerHeight - 32 /* card's bottom padding + footer's own top margin */,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const requestId = useRef(0);

  // Asks for the quote. Only its answer sets state, so the first request can
  // run from an effect while the sheet is already showing its skeleton.
  const fetchQuote = useCallback(() => {
    const id = (requestId.current += 1);
    quoteSend(amountMinor).then(
      (next) => {
        if (id === requestId.current) setQuote({ state: 'ready', quote: next });
      },
      (error: unknown) => {
        if (id === requestId.current) {
          setQuote({
            state: 'failed',
            message: plainMessage(error, "We couldn't work out the fee for this payment. Try again."),
          });
        }
      },
    );
  }, [amountMinor, quoteSend]);

  useEffect(() => {
    fetchQuote();
    return () => {
      // A quote that arrives after the sheet is gone is dropped.
      requestId.current += 1;
    };
  }, [fetchQuote]);

  function retry() {
    setQuote({ state: 'loading' });
    fetchQuote();
  }

  const ready = quote.state === 'ready' ? quote.quote : null;
  // Not while sending: the moment a payment settles the balance drops, and that
  // must not read as "not enough" on the way to the receipt.
  const short = ready && !sending ? ready.totalMinor > store.balance : false;
  const where = countryName(contact.place);

  async function confirm() {
    if (!ready || short || sending) return;
    setProblem(null);
    setSending(true);
    try {
      const trimmed = note.trim();
      // One passkey prompt happens inside this. It resolves only once the
      // payment has settled — there is no interim success.
      const receipt = await store.send({
        contactId: contact.id,
        amountMinor,
        ...(trimmed ? { note: trimmed } : {}),
      });
      // Settled for real. The sheet stays locked until the receipt replaces it.
      setSettled(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      show(`Sent to ${contact.name}`);
      router.replace({ pathname: '/send/receipt', params: { receiptId: receipt.id } });
    } catch (error) {
      setSending(false);
      setProblem(plainMessage(error, "That payment didn't go through. Nothing was taken."));
      // If it did go through after all, the balance says so.
      void store.refresh().catch(() => undefined);
    }
  }

  return (
    <SheetLayer>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <Sheet className="shrink" onDismiss={onDismiss} locked={sending} handleOnly>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flexShrink: 1, maxHeight: scrollMaxHeight }}
          >
            <Text className="font-strong text-title text-ink">Review payment</Text>

            <View className="mt-4 flex-row items-center gap-3">
              <Avatar initials={contact.initials} tone={contact.tone} size="md" />
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="font-strong text-body text-ink">
                  {contact.name}
                </Text>
                {where ? <Text className="font-body text-caption text-slate">{where}</Text> : null}
              </View>
            </View>

            {ready ? (
              <View className="mt-5">
                <Text className="font-body text-caption text-slate">They receive</Text>
                <Text tabular className="mt-0.5 font-strong text-title-xl text-ink">
                  {formatDollars(cents(Math.floor(ready.receivesCents)))}
                </Text>
                <Text tabular className="mt-0.5 font-body text-caption text-slate">
                  {rateLine(ready.rate)}
                </Text>

                <View className="mt-3 border-t border-hairline">
                  <Line label="Amount" value={formatNaira(kobo(ready.amountMinor))} />
                  <Line label="Fee" value={formatNaira(kobo(ready.feeMinor))} />
                  <View className="border-t border-hairline">
                    <Line strong label="Total from you" value={formatNaira(kobo(ready.totalMinor))} />
                  </View>
                </View>
              </View>
            ) : quote.state === 'loading' ? (
              <View className="mt-5" accessibilityLabel="Working out the fee">
                <Skeleton className="h-3 w-20 rounded-md" />
                <Skeleton className="mt-2.5 h-8 w-44 rounded-md" />
                <Skeleton className="mt-2.5 h-3 w-28 rounded-md" />
                <View className="mt-6 gap-4">
                  <Skeleton className="h-4 w-full rounded-md" />
                  <Skeleton className="h-4 w-full rounded-md" />
                  <Skeleton className="h-4 w-full rounded-md" />
                </View>
              </View>
            ) : null}

            {quote.state === 'failed' ? (
              <Text className="mt-5 font-body text-label text-halt">{quote.message}</Text>
            ) : null}

            {ready && short ? (
              <View className="mt-3">
                <Text className="font-body text-label text-caution">
                  You don&apos;t have enough for this payment and its fee. You have {formatNaira(store.balance)}.
                </Text>
                <Pressable
                  accessibilityRole="link"
                  hitSlop={10}
                  onPress={() => {
                    onDismiss();
                    router.push('/add-money');
                  }}
                  className="mt-2 self-start"
                >
                  <Text className="font-strong text-label text-indigo">Add money</Text>
                </Pressable>
              </View>
            ) : null}

            {ready && !short ? (
              <View className="mt-4">
                {noteOpen ? (
                  <Field
                    label="What's it for?"
                    optional
                    value={note}
                    onChangeText={setNote}
                    placeholder="A few words, if you like"
                    maxLength={80}
                    returnKeyType="done"
                    editable={!sending}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => setNoteOpen(true)}
                    className="self-start"
                  >
                    <Text className="font-strong text-label text-indigo">Add a note</Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {problem ? <Text className="mt-4 font-body text-label text-halt">{problem}</Text> : null}
            {sending && !settled ? (
              <Text className="mt-4 font-body text-label text-slate">
                Sending. This updates when the payment has settled.
              </Text>
            ) : null}
          </ScrollView>

          <View
            className="mt-5 flex-row"
            onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
          >
            {quote.state === 'failed' ? (
              <Button label="Try again" onPress={retry} />
            ) : (
              <Button
                label={settled ? 'Settled' : sending ? 'Sending' : problem ? 'Try again' : 'Confirm and send'}
                busy={sending && !settled}
                disabled={!ready || short || settled}
                onPress={() => void confirm()}
              />
            )}
          </View>
        </Sheet>
      </KeyboardAvoidingView>
    </SheetLayer>
  );
}
