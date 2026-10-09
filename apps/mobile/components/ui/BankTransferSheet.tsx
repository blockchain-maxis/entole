import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { formatNaira, kobo } from '@entole/core/money';
import { RelayError, type BankTransferOffer } from '@entole/core/relay-client';

import { Button } from './Button';
import { Sheet, SheetLayer } from './Sheet';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

type Offer = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; offer: BankTransferOffer };

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
 * The last look before leaving for the payment partner's page: what the person
 * pays, what it costs, and about what arrives. Every figure comes from the
 * server's answer; nothing is priced here. The link is opened, never shown.
 * The phone twin of the sheet in `apps/web/app/add-money/page.tsx`.
 */
export function BankTransferSheet({
  start,
  onContinue,
  onDismiss,
}: {
  /** Prices the transfer. Keep it stable: it is asked once per attempt. */
  start: () => Promise<BankTransferOffer>;
  /** Called with the partner link once the person chooses to go on. */
  onContinue: (url: string) => void;
  onDismiss: () => void;
}) {
  const [offer, setOffer] = useState<Offer>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Asked once when the sheet opens, and again only on "Try again".
  useEffect(() => {
    let live = true;
    start()
      .then((next) => {
        if (live) setOffer({ state: 'ready', offer: next });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setOffer({
          state: 'failed',
          message: error instanceof RelayError ? error.message : 'Something went wrong. Try again.',
        });
      });
    return () => {
      live = false;
    };
  }, [start, attempt]);

  return (
    <SheetLayer>
      <Sheet className="shrink" onDismiss={onDismiss} handleOnly>
        <Text className="font-strong text-title text-ink">Add by bank transfer</Text>

        {offer.state === 'ready' ? (
          <View>
            <Text className="mt-4 font-body text-caption text-slate">About this much arrives</Text>
            <Text tabular className="mt-0.5 font-strong text-title-xl text-ink">
              {formatNaira(kobo(offer.offer.arrivesMinor))}
            </Text>

            <View className="mt-3 border-t border-hairline">
              <Line strong label="You pay" value={formatNaira(kobo(offer.offer.payMinor))} />
              <View className="border-t border-hairline">
                <Line label="Fee" value={formatNaira(kobo(offer.offer.feeMinor))} />
              </View>
            </View>

            <Text className="mt-3 font-body text-label-sm text-slate">
              You pay on our payment partner&apos;s page. The first time, they ask for your phone number and ID. Your
              balance changes once the money has arrived.
            </Text>
          </View>
        ) : offer.state === 'loading' ? (
          <View accessibilityLabel="Working out the fee">
            <Skeleton className="mt-5 h-3 w-36 rounded-md" />
            <Skeleton className="mt-2.5 h-8 w-44 rounded-md" />
            <Skeleton className="mt-6 h-4 w-full rounded-md" />
            <Skeleton className="mt-4 h-4 w-full rounded-md" />
          </View>
        ) : (
          <Text accessibilityRole="alert" className="mt-4 font-body text-label text-halt">
            {offer.message}
          </Text>
        )}

        <View className="mt-5 flex-row">
          {offer.state === 'failed' ? (
            <Button
              label="Try again"
              onPress={() => {
                setOffer({ state: 'loading' });
                setAttempt((count) => count + 1);
              }}
            />
          ) : (
            <Button
              label="Continue"
              disabled={offer.state !== 'ready'}
              onPress={() => {
                if (offer.state === 'ready') onContinue(offer.offer.url);
              }}
            />
          )}
        </View>
      </Sheet>
    </SheetLayer>
  );
}
