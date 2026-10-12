import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { buildPayLink } from '@entole/core/checkout-link';
import { formatNaira, kobo } from '@entole/core/money';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PaymentCode } from '@/components/ui/PaymentCode';
import { RequestAmountSheet } from '@/components/ui/RequestAmountSheet';
import { LinkRow, SectionHeading } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { CHECKOUT_BASE } from '@/lib/onchain';
import { usePayUsername } from '@/lib/pay-username';

type Copied = 'link' | 'username' | null;

/**
 * How someone pays you: by your username. Someone with Entole needs only
 * that, or your phone number. For anyone else there is one link, made from the
 * same username: it opens in any browser, so a payer without the app can pay
 * from it, and the QR is the same link, for someone standing next to you.
 * There is nothing longer than a username to copy, anywhere.
 *
 * An amount can be put on the link. Nothing here is invented, and no address
 * is ever shown. The link exists once the directory has said the username is
 * yours; until then the screen says what it is waiting for.
 */
export default function Receive() {
  const router = useRouter();
  const mine = usePayUsername();
  const [amount, setAmount] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [copied, setCopied] = useState<Copied>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const username = mine.state === 'held' ? mine.username : null;
  const link = useMemo(
    () =>
      username
        ? buildPayLink(CHECKOUT_BASE, {
            username,
            ...(amount > 0 ? { amountMinor: amount, currency: 'NGN' } : {}),
          })
        : null,
    [username, amount],
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
          {mine.state === 'unconfirmed' ? (
            <View className="pt-2">
              <Text className="font-display text-subhead text-ink">
                {mine.username ? 'Your username isn’t confirmed yet' : 'Choose a username to get paid'}
              </Text>
              <Text className="mt-2 font-body text-ui text-slate">
                {mine.username
                  ? `Your link is made from @${mine.username}. We couldn’t confirm it is yours just now. Check your connection and try again, or choose another username.`
                  : 'Your username is how people pay you, and it is what your link is made from.'}
              </Text>
              <View className="mt-5 gap-2.5">
                {mine.username ? (
                  <View className="flex-row">
                    <Button label="Try again" onPress={mine.retry} />
                  </View>
                ) : null}
                <View className="flex-row">
                  <Button
                    label={mine.username ? 'Change username' : 'Choose a username'}
                    variant={mine.username ? 'secondary' : 'primary'}
                    onPress={() => router.push('/edit-profile')}
                  />
                </View>
              </View>
            </View>
          ) : (
            <>
              <View className="items-center rounded-card bg-card px-gutter py-7 shadow-raised">
                {link && username ? (
                  <>
                    <PaymentCode value={link} />
                    <Text selectable className="mt-5 text-center font-display text-heading text-ink">
                      @{username}
                    </Text>
                    <Text
                      selectable
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      className="mt-1 text-center font-body text-note text-slate"
                    >
                      {link.replace(/^https?:\/\//, '')}
                    </Text>
                    {amount > 0 ? (
                      <Text tabular className="mt-3 font-strong text-ui text-ink">
                        Asking for {formatNaira(kobo(amount))}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <View className="items-center">
                    <Skeleton className="h-[232px] w-[232px] rounded-card" />
                    <Skeleton className="mt-5 h-6 w-40 rounded-md" />
                    <Skeleton className="mt-2 h-4 w-56 rounded-md" />
                  </View>
                )}
              </View>

              <Text className="mt-5 px-1 font-body text-ui text-slate">
                Anyone with Entole can pay you with your username, or with your phone number. Anyone else can open
                your link and pay you, even without the app.
              </Text>

              <View className="mt-5">
                <LinkRow
                  label="Request an amount"
                  value={amount > 0 ? formatNaira(kobo(amount)) : 'Optional'}
                  onPress={() => setRequesting(true)}
                />
              </View>

              {username ? (
                <View className="mt-6">
                  <SectionHeading
                    title="Your username"
                    action={copied === 'username' ? 'Copied' : 'Copy'}
                    onActionPress={() => void copy('username', `@${username}`)}
                  />
                  <Text className="px-1 font-body text-note text-slate">
                    Say it or send it. It is all someone with Entole needs to pay you.
                  </Text>
                </View>
              ) : null}
            </>
          )}
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
