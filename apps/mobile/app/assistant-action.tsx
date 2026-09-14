import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { AssistantTag } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Countdown } from '@/components/ui/Countdown';
import { Meter } from '@/components/ui/Meter';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { resetLabel, secondsWords } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo, remaining } from '@entole/core/money';
import { useStore } from '@entole/core/store';

/**
 * Delegation with an undo window, never a confirmation dialog. Confirming every
 * assistant action would defeat the point of delegating; executing silently
 * would destroy the trust that makes delegation possible.
 *
 * The sheet does not dismiss by gesture: an undo window that can disappear by
 * accident is not an undo window.
 */
export default function AssistantAction() {
  const router = useRouter();
  const store = useStore();
  const proposal = store.proposal;
  const [sending, setSending] = useState(false);
  const [stopped, setStopped] = useState(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (!proposal) {
    return (
      <Sheet onDismiss={close} locked={false}>
        <Text className="pb-6 font-body text-body-sm text-slate">
          Nothing is waiting to be sent right now.
        </Text>
        <Button label="Close" variant="secondary" onPress={close} />
      </Sheet>
    );
  }

  const contact = store.contact(proposal.contactId);
  const allowance = store.allowance(proposal.allowanceId);
  const amount = kobo(proposal.amountMinor);

  const afterRun = allowance ? remaining(allowance.remainingMinor, amount) : kobo(0);

  async function run() {
    if (sending || stopped) return;
    setSending(true);
    try {
      const receipt = await store.runProposal();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: '/send/receipt', params: { receiptId: receipt.id } });
    } catch {
      setSending(false);
    }
  }

  async function stop() {
    setStopped(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await store.cancelProposal();
    close();
  }

  return (
    <Sheet onDismiss={close} locked>
      <AssistantTag>Entole is sending</AssistantTag>

      <View className="mt-[18px] flex-row items-center gap-3.5">
        <Avatar initials={contact?.initials ?? '?'} tone={contact?.tone ?? 1} size="xl" />
        <View className="flex-1">
          <Text className="font-strong text-headline text-ink">{contact?.name ?? 'Recipient'}</Text>
          <Text className="mt-0.5 font-body text-label-sm text-slate">
            {proposal.note}
            {contact?.place ? ` · ${contact.place}` : ''}
          </Text>
        </View>
        <View className="items-end">
          <Text tabular className="font-strong text-amount text-ink">
            {formatNaira(amount)}
          </Text>
          <Text tabular className="mt-0.5 font-body text-caption-sm text-mist">
            ≈ {formatDollars(toDollars(amount, store.rate))}
          </Text>
        </View>
      </View>

      {allowance ? (
        <View className="mt-[18px] rounded-row bg-indigo-wash px-4 py-4">
          <View className="flex-row items-baseline justify-between gap-3">
            <Text className="flex-1 font-strong text-label text-ink">{allowance.name}</Text>
            <Text tabular className="font-strong text-caption text-indigo">
              {formatNaira(allowance.remainingMinor)} → {formatNaira(afterRun)} left
            </Text>
          </View>

          <View className="mt-3">
            <Meter
              fraction={allowance.remainingFraction}
              tone={allowance.tone}
              onTint
              pending
              label={`${allowance.name} remaining after this payment`}
            />
          </View>

          <Text tabular className="mt-2.5 font-body text-caption-sm text-slate">
            {resetLabel(allowance.resetsAt)} · within your {formatNaira(allowance.limitMinor)}{' '}
            {allowance.cadence === 'weekly' ? 'weekly' : 'monthly'} limit
          </Text>
        </View>
      ) : null}

      <View className="mt-5 flex-row items-center gap-3.5">
        <Countdown
          seconds={proposal.undoSeconds}
          running={!stopped && !sending}
          onElapsed={() => void run()}
        />
        <Text className="flex-1 font-body text-label text-slate">
          {sending
            ? 'Sending now.'
            : `Sending in ${secondsWords(proposal.undoSeconds)}. You can stop it until then.`}
        </Text>
      </View>

      <View className="mt-[18px] flex-row">
        <Button
          label="Cancel this payment"
          variant="danger-outline"
          disabled={sending}
          onPress={() => void stop()}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={sending}
        onPress={() => void run()}
        className="items-center py-3.5"
      >
        <Text className="font-strong text-label-sm text-mist">Send it now</Text>
      </Pressable>
    </Sheet>
  );
}
