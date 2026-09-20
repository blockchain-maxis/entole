import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PaymentCode, PaymentCodeText } from '@/components/ui/PaymentCode';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useBackend } from '@entole/core/backend';

/**
 * How someone pays you: your payment code, as a scannable square and as text
 * to read out or retype. It is the account's real code — nothing on this
 * screen is invented, and no address is ever shown.
 */
export default function Receive() {
  const { paymentCode } = useBackend();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (!paymentCode) return;
    await Clipboard.setStringAsync(paymentCode);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Screen>
      <Header title="Receive" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 }}
      >
        <View className="items-center rounded-panel bg-card px-gutter py-7 shadow-raised">
          {paymentCode ? (
            <>
              <PaymentCode code={paymentCode} />
              <View className="mt-6">
                <PaymentCodeText code={paymentCode} />
              </View>
            </>
          ) : (
            <View className="items-center">
              <Skeleton className="h-[200px] w-[200px] rounded-row" />
              <Skeleton className="mt-6 h-6 w-52 rounded-md" />
              <Skeleton className="mt-2 h-6 w-52 rounded-md" />
            </View>
          )}
        </View>

        <Text className="mt-6 px-1 font-body text-body-sm text-slate">
          {paymentCode
            ? 'Share this code so anyone can pay you.'
            : 'Your code shows up here once you are signed in.'}
        </Text>
      </ScrollView>

      <ActionBar>
        <Button
          label={copied ? 'Copied' : 'Copy code'}
          disabled={!paymentCode}
          onPress={() => void copy()}
        />
      </ActionBar>
    </Screen>
  );
}
