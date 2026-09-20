import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { buildCheckoutLink } from '@entole/core/checkout-link';
import { formatNaira, kobo } from '@entole/core/money';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PaymentCode, PaymentCodeText } from '@/components/ui/PaymentCode';
import { RequestAmountSheet } from '@/components/ui/RequestAmountSheet';
import { LinkRow, SectionHeading } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { CHECKOUT_BASE } from '@/lib/onchain';

type Copied = 'link' | 'code' | null;

/**
 * How someone pays you: one link. It opens in any browser, so a payer without
 * the app can pay from it; the QR is the same link, for someone standing next
 * to you. Your plain code sits underneath for anyone who would rather type it.
 * An amount can be put on the link. Nothing here is invented, and no address is
 * ever shown — the link names you by your payment code and your name.
 */
export default function Receive() {
  const { paymentCode } = useBackend();
  const { account } = useAccount();
  const [amount, setAmount] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [copied, setCopied] = useState<Copied>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const payee = account?.displayName.trim() ?? '';
  const link = useMemo(
    () =>
      paymentCode
        ? buildCheckoutLink(CHECKOUT_BASE, {
            code: paymentCode,
            kind: 'pay',
            ...(amount > 0 ? { amountMinor: amount, currency: 'NGN' } : {}),
            ...(payee ? { payee } : {}),
          })
        : null,
    [paymentCode, amount, payee],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(what: Exclude<Copied, null>, text: string | null) {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(what);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  }

  return (
    <View className="flex-1">
      <Screen>
        <Header title="Receive" />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 }}
        >
          <View className="items-center rounded-panel bg-card px-gutter py-7 shadow-raised">
            {link ? (
              <>
                <PaymentCode value={link} />
                <Text
                  selectable
                  numberOfLines={2}
                  ellipsizeMode="middle"
                  className="mt-5 text-center font-body text-caption text-slate"
                >
                  {link}
                </Text>
                {amount > 0 ? (
                  <Text tabular className="mt-3 font-strong text-body-sm text-ink">
                    Asking for {formatNaira(kobo(amount))}
                  </Text>
                ) : null}
              </>
            ) : (
              <View className="items-center">
                <Skeleton className="h-[232px] w-[232px] rounded-row" />
                <Skeleton className="mt-5 h-4 w-56 rounded-md" />
              </View>
            )}
          </View>

          <Text className="mt-5 px-1 font-body text-body-sm text-slate">
            {paymentCode
              ? 'Anyone you send this link to can open it and pay you, even without Entole.'
              : 'Your link shows up here once you are signed in.'}
          </Text>

          <View className="mt-5">
            <LinkRow
              label="Request an amount"
              value={amount > 0 ? formatNaira(kobo(amount)) : 'Optional'}
              onPress={() => setRequesting(true)}
            />
          </View>

          <View className="mt-8">
            <SectionHeading
              title="Your code"
              {...(paymentCode
                ? {
                    action: copied === 'code' ? 'Copied' : 'Copy',
                    onActionPress: () => void copy('code', paymentCode),
                  }
                : {})}
            />
            <View className="items-center rounded-row border border-line bg-card px-gutter py-5">
              {paymentCode ? (
                <PaymentCodeText code={paymentCode} />
              ) : (
                <View className="items-center">
                  <Skeleton className="h-6 w-52 rounded-md" />
                  <Skeleton className="mt-2 h-6 w-52 rounded-md" />
                </View>
              )}
            </View>
            <Text className="mt-2.5 px-1 font-body text-caption text-slate">
              For someone who would rather type it than open a link.
            </Text>
          </View>
        </ScrollView>

        <ActionBar>
          <Button
            label={copied === 'link' ? 'Copied' : 'Copy link'}
            variant="secondary"
            disabled={!link}
            onPress={() => void copy('link', link)}
          />
          <Button
            label="Share link"
            disabled={!link}
            onPress={() => {
              if (link) void Share.share({ message: `Pay me on Entole: ${link}` });
            }}
          />
        </ActionBar>
      </Screen>

      {requesting ? (
        <RequestAmountSheet
          current={amount}
          onSet={(next) => {
            setAmount(next);
            setRequesting(false);
          }}
          onDismiss={() => setRequesting(false)}
        />
      ) : null}
    </View>
  );
}
