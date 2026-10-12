import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Figure } from '@/components/ui/Amount';
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
import { useToast } from '@/lib/toast';
import { plainMessage } from '@/lib/send';

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
  const { show } = useToast();
  const proposal = store.proposal;
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (!proposal) {
    return (
      <Sheet onDismiss={close} locked={false}>
        <Text className="pb-6 font-body text-ui text-slate">
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
    setProblem(null);
    try {
      const receipt = await store.runProposal();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      show(`The assistant sent ${contact?.name ?? 'a payment'}`, 'assistant');
      router.replace({ pathname: '/send/receipt', params: { receiptId: receipt.id } });
    } catch (error) {
      // The network refused it, or it could not be reached. Either way nothing
      // was sent, and the person is told which: a refusal is the point of an
      // allowance, and it used to pass here without a word.
      setSending(false);
      setProblem(plainMessage(error, "That payment didn't go through. Nothing was taken."));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
      <AssistantTag>{sending ? 'The assistant is sending' : 'The assistant is about to send'}</AssistantTag>

      <View className="mt-4">
        <Figure value={amount} />
      </View>
      <Text accessibilityRole="header" className="mt-2 font-display text-subhead text-ink">
        to {contact?.name ?? 'someone'}
      </Text>
      <Text tabular numberOfLines={1} className="mt-1 font-body text-ui text-slate">
        {proposal.note} · about {formatDollars(toDollars(amount, store.rate))}
      </Text>

      {allowance ? (
        <View className="mt-5 rounded-card bg-indigo-wash p-5">
          <View className="flex-row items-baseline justify-between gap-3">
            <Text className="flex-1 font-body text-note text-slate">From this allowance</Text>
            <Text tabular className="font-strong text-note text-indigo">
              {formatNaira(allowance.remainingMinor)} to {formatNaira(afterRun)} left
            </Text>
          </View>

          <View className="mt-3">
            <Meter
              fraction={allowance.remainingFraction}
              tone={allowance.tone}
              onTint
              pending
              label={`${formatNaira(allowance.remainingMinor)} left of the allowance before this payment`}
            />
          </View>

          <Text tabular className="mt-2.5 font-body text-note text-slate">
            {resetLabel(allowance.resetsAt)}, within your {formatNaira(allowance.limitMinor)}{' '}
            {allowance.cadence === 'weekly' ? 'weekly' : 'monthly'} limit
          </Text>
        </View>
      ) : null}

      <View className="mt-5 flex-row items-center gap-3.5">
        <Countdown
          seconds={proposal.undoSeconds}
          running={!stopped && !sending && !problem}
          onElapsed={() => void run()}
        />
        <Text className="flex-1 font-body text-ui text-slate">
          {sending
            ? 'Sending now.'
            : problem
              ? 'Not sent. Nothing was taken.'
              : `Sending in ${secondsWords(proposal.undoSeconds)}. You can stop it until then.`}
        </Text>
      </View>

      {problem ? (
        <Text accessibilityRole="alert" className="mt-4 font-body text-ui text-halt">
          {problem}
        </Text>
      ) : null}

      {/* The one strong button is yours, in ink: stopping it. */}
      <View className="mt-6 flex-row">
        <Button label={problem ? 'Close' : 'Cancel this payment'} disabled={sending} onPress={() => void stop()} />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={sending}
        onPress={() => void run()}
        className="items-center py-3.5 active:opacity-60"
      >
        <Text className="font-strong text-ui text-slate">{problem ? 'Try again' : 'Send it now'}</Text>
      </Pressable>
    </Sheet>
  );
}
