import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Figure } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Meter } from '@/components/ui/Meter';
import { SectionHeading } from '@/components/ui/Rows';
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
  const [asking, setAsking] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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
    setProblem(null);
    try {
      await store.revokeAllowance(allowance.id);
      close();
    } catch {
      setProblem("We couldn't revoke it. The allowance is still in force. Try again.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Sheet onDismiss={close} topInset={132}>
      <ScrollView showsVerticalScrollIndicator={false} className="max-h-[620px]">
        <Text className="font-display-plain text-subhead text-indigo">
          Send{' '}
          <Text tabular className="font-display-plain text-subhead text-indigo">
            {formatNaira(allowance.perRunMinor)}
          </Text>{' '}
          to {recipient?.name ?? 'them'} {cadenceWords(allowance.cadence)}, never more than{' '}
          <Text tabular className="font-display-plain text-subhead text-indigo">
            {formatNaira(allowance.limitMinor)}
          </Text>{' '}
          {period}.
        </Text>

        <View className="mt-6 flex-row items-end justify-between gap-3">
          <View>
            <Figure value={allowance.remainingMinor} />
            <Text className="mt-1 font-body text-note text-slate">left</Text>
          </View>
          <Text
            tabular
            className={`pb-1 font-strong text-note ${
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

        <View className="mt-4">
          <Meter
            fraction={allowance.remainingFraction}
            tone={allowance.tone}
            size="lg"
            label={`${formatNaira(allowance.remainingMinor)} left of the allowance`}
          />
        </View>

        <View className="mt-3 flex-row items-baseline justify-between">
          <Text tabular className="font-body text-note text-slate">
            {formatNaira(allowance.spentMinor)} spent this period
          </Text>
          <Text tabular className="font-body text-note text-slate">
            {allowance.paused ? 'Paused' : resetLabel(allowance.resetsAt)}
          </Text>
        </View>

        <SectionHeading display title="Payments from it" />

        <View className="border-y border-hairline pb-0.5">
          {payments.length === 0 ? (
            <Text className="py-4 font-body text-ui text-slate">
              The assistant has not paid anything from this allowance yet.
            </Text>
          ) : (
            payments.map((entry, index) => (
              <View
                key={entry.id}
                className={`flex-row items-baseline justify-between gap-3 py-3.5 ${
                  index > 0 ? 'border-t border-hairline' : ''
                }`}
              >
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="font-strong text-ui text-ink">
                    {entry.note}
                  </Text>
                  <Text tabular className="mt-0.5 font-body text-note text-slate">
                    {entry.state === 'pending' ? 'Sending' : relativeMoment(entry.at)}
                  </Text>
                </View>
                <Text tabular className="font-strong text-ui text-ink">
                  {formatNaira(kobo(entry.amountMinor))}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {asking ? (
        // Asked in place: revoking cannot be taken back, so one tap is not enough.
        <View className="mt-4 flex-none rounded-card border border-halt bg-halt-wash p-4">
          <Text className="font-strong text-ui text-ink">Revoke this allowance?</Text>
          <Text className="mt-1 font-body text-note text-slate">
            The assistant can no longer pay {recipient?.name ?? 'them'} from it. Payments already made stay made.
          </Text>
          {problem ? <Text className="mt-2 font-body text-note text-halt">{problem}</Text> : null}
          <View className="mt-3 flex-row gap-2.5">
            <Button label="Revoke" variant="destructive" busy={revoking} onPress={() => void revoke()} />
            <Button
              label="Keep it"
              variant="secondary"
              disabled={revoking}
              onPress={() => {
                setAsking(false);
                setProblem(null);
              }}
            />
          </View>
        </View>
      ) : (
        <View className="flex-none pt-3.5">
          <View className="flex-row">
            <Button
              label="Edit this allowance"
              onPress={() => router.replace({ pathname: '/rules/new', params: { id: allowance.id } })}
            />
          </View>
          <View className="mt-2.5 flex-row">
            <Button label="Revoke this allowance" variant="danger-outline" onPress={() => setAsking(true)} />
          </View>
        </View>
      )}
    </Sheet>
  );
}
