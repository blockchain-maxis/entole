import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Meter } from '@/components/ui/Meter';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { cadenceWords } from '@entole/core/allowance';
import { relativeMoment, resetLabel } from '@entole/core/format';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

/**
 * One allowance, shown the only way an allowance is ever shown: the balance
 * left in it, and what has been spent against it.
 */
export default function AllowanceDetail() {
  const router = useRouter();
  const store = useStore();
  const { id } = useLocalSearchParams<{ id: string }>();
  const allowance = store.allowance(id);
  const recipient = allowance ? store.contact(allowance.recipientId) : undefined;
  const [revoking, setRevoking] = useState(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (!allowance) {
    return (
      <Sheet onDismiss={close} topInset={132}>
        <Text className="pb-6 font-body text-body-sm text-slate">
          That allowance is no longer here. It may have been revoked.
        </Text>
        <Button label="Close" variant="secondary" onPress={close} />
      </Sheet>
    );
  }

  const payments = store.activity.filter((entry) => entry.allowanceId === allowance.id);
  const period = allowance.cadence === 'weekly' ? 'a week' : 'a month';

  async function revoke() {
    if (!allowance || revoking) return;
    setRevoking(true);
    try {
      await store.revokeAllowance(allowance.id);
      close();
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Sheet onDismiss={close} topInset={132}>
      <ScrollView showsVerticalScrollIndicator={false} className="max-h-[620px]">
        <Text className="font-strong text-title-sm text-ink">{allowance.name}</Text>

        <Text className="mt-3.5 font-body text-body-lg text-slate">
          Send{' '}
          <Text tabular className="font-strong text-body-lg text-ink">
            {formatNaira(allowance.perRunMinor)}
          </Text>{' '}
          to <Text className="font-strong text-body-lg text-ink">{recipient?.name ?? 'them'}</Text>{' '}
          {cadenceWords(allowance.cadence)}, never more than{' '}
          <Text tabular className="font-strong text-body-lg text-ink">
            {formatNaira(allowance.limitMinor)}
          </Text>{' '}
          {period}.
        </Text>

        <View className="mt-[22px] rounded-tile border border-hairline bg-paper p-[18px]">
          <View className="flex-row items-baseline justify-between">
            <View className="flex-row items-baseline gap-1.5">
              <Text tabular className="font-strong text-amount-lg text-ink">
                {formatNaira(allowance.remainingMinor)}
              </Text>
              <Text className="font-body text-label text-slate">left</Text>
            </View>
            <Text
              tabular
              className={`font-strong text-caption ${
                allowance.tone === 'settled'
                  ? 'text-settled'
                  : allowance.tone === 'caution'
                    ? 'text-caution'
                    : 'text-halt'
              }`}
            >
              {allowance.usedPercent}% used
            </Text>
          </View>

          <View className="mt-3.5">
            <Meter
              fraction={allowance.remainingFraction}
              tone={allowance.tone}
              size="lg"
              label={`${allowance.name} remaining`}
            />
          </View>

          <View className="mt-3 flex-row items-baseline justify-between">
            <Text tabular className="font-body text-caption text-slate">
              {formatNaira(allowance.spentMinor)} spent this period
            </Text>
            <Text tabular className="font-body text-caption text-slate">
              {resetLabel(allowance.resetsAt)}
            </Text>
          </View>
        </View>

        <Text className="pb-2.5 pt-6 font-heavy text-body-sm text-ink">Payments under this rule</Text>

        <View className="gap-2 pb-2">
          {payments.length === 0 ? (
            <Text className="font-body text-label-sm text-mist">
              Nothing has been sent under this rule yet.
            </Text>
          ) : (
            payments.map((entry) => {
              const contact = store.contact(entry.contactId);
              return (
                <View
                  key={entry.id}
                  className="flex-row items-center gap-3 rounded-control border border-indigo-line bg-indigo-wash px-3.5 py-3"
                >
                  <Avatar initials={contact?.initials ?? '?'} tone={contact?.tone ?? 1} size="sm" />
                  <View className="flex-1">
                    <Text className="font-strong text-label text-ink">{contact?.name ?? 'Recipient'}</Text>
                    <Text tabular className="mt-0.5 font-body text-caption-sm text-slate">
                      {relativeMoment(entry.at)}
                    </Text>
                  </View>
                  <Text tabular className="font-strong text-label text-ink">
                    {formatNaira(kobo(entry.amountMinor))}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <View className="flex-none pt-3.5">
        <View className="flex-row">
          <Button
            label="Edit the rule"
            onPress={() => router.replace({ pathname: '/rules/new', params: { id: allowance.id } })}
          />
        </View>
        <View className="mt-2.5 flex-row">
          <Button
            label="Revoke this allowance"
            variant="danger-outline"
            busy={revoking}
            onPress={() => void revoke()}
          />
        </View>
      </View>
    </Sheet>
  );
}
