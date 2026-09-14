import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PaymentCode } from '@/components/ui/PaymentCode';
import { DetailRow } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

/**
 * The far end of the corridor. Whoever pays has no app, no account and no
 * reason to get one — so everything they need is in the link.
 */
export default function Receive() {
  const store = useStore();
  const request = store.request;
  const [copied, setCopied] = useState(false);

  const link = request?.link ?? '';
  const url = `https://${link}`;

  async function copy() {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Screen>
      <Header title="Receive" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 }}
      >
        {request ? (
          <View className="items-center rounded-card border border-line bg-card px-gutter py-6">
            <Text className="font-strong text-body-sm text-ink">
              {request.requesterName} is asking for
            </Text>
            <View className="mt-2">
              <Amount value={kobo(request.amountMinor)} size="small" />
            </View>
            <Text className="mt-1.5 font-body text-label-sm text-slate">“For the {request.note.toLowerCase()}”</Text>
            <View className="mt-5">
              <PaymentCode link={link} />
            </View>
            <Text className="mt-4 font-strong text-caption text-mist">{link}</Text>
          </View>
        ) : (
          <View className="items-center rounded-card border border-line bg-card px-gutter py-6">
            <Skeleton className="h-5 w-44 rounded-md" />
            <Skeleton className="mt-3 h-10 w-40 rounded-chip" />
            <Skeleton className="mt-5 h-[200px] w-[200px] rounded-row" />
          </View>
        )}

        <View className="mt-3.5 rounded-row border border-line bg-card px-[18px] py-4">
          <Text className="font-strong text-label text-ink">They don’t need the app</Text>
          <Text className="mt-1.5 font-body text-label-sm text-slate">
            Anyone can open this link and pay you with their bank card or bank app. No account, no
            download, no sign-up.
          </Text>
        </View>

        {request ? (
          <View className="mt-3.5 gap-2">
            <DetailRow label="Amount" value={formatNaira(kobo(request.amountMinor))} />
            <DetailRow label="Note" value={request.note} tabular={false} />
          </View>
        ) : null}
      </ScrollView>

      <ActionBar>
        <Button
          label="Share on WhatsApp"
          disabled={!request}
          onPress={() =>
            void Share.share({
              message: `${request?.requesterName} is asking for ${formatNaira(
                kobo(request?.amountMinor ?? 0),
              )} — ${request?.note}. Pay here: ${url}`,
            })
          }
        />
        <Button
          label={copied ? 'Copied' : 'Copy'}
          variant="secondary"
          width="hug"
          disabled={!request}
          onPress={() => void copy()}
        />
      </ActionBar>
    </Screen>
  );
}
