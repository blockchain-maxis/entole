import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
 *
 * The wait is the contract's, not this sheet's. As it opens the run is put in
 * the policy contract's queue, and the countdown runs to the moment the
 * contract will let it be carried out. Cancelling stops it there. Mirrors
 * `apps/web/app/assistant/action/page.tsx`.
 */
export default function AssistantAction() {
  const router = useRouter();
  const store = useStore();
  const { show } = useToast();
  const proposal = store.proposal;
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Where the wait is held: being put in the contract's queue, waiting there
  // until `readyAt`, or (with no contract to hold it) in this sheet.
  const [queue, setQueue] = useState<{ state: 'starting' } | { state: 'queued'; readyAt: number; seconds: number } | { state: 'here' }>({
    state: 'starting',
  });
  const begun = useRef<string | null>(null);

  useEffect(() => {
    if (!proposal || begun.current === proposal.id) return;
    begun.current = proposal.id;
    store
      .beginProposal()
      .then((started) =>
        setQueue(() => {
          if (!started) return { state: 'here' };
          const readyAt = Date.parse(started.readyAt);
          // Counted from now to when the network will let it go.
          return { state: 'queued', readyAt, seconds: Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)) };
        }),
      )
      .catch((error: unknown) =>
        setProblem(plainMessage(error, "The assistant couldn't start that payment. Nothing was sent.")),
      );
  }, [proposal, store]);

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
    if (stopping) return;
    setStopped(true);
    setStopping(true);
    setProblem(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await store.cancelProposal();
      close();
    } catch (error) {
      setStopping(false);
      setProblem(plainMessage(error, "We couldn't stop it on the network. Pause the assistant now to be sure it does not go."));
    }
  }

  const waitSeconds = queue.state === 'queued' ? queue.seconds : proposal.undoSeconds;
  const counting = queue.state !== 'starting' && !stopped && !sending && !problem;

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
          key={queue.state === 'queued' ? queue.readyAt : queue.state}
          seconds={waitSeconds}
          running={counting}
          onElapsed={() => void run()}
        />
        <Text className="flex-1 font-body text-ui text-slate">
          {stopping
            ? 'Stopping it on the network.'
            : sending
              ? 'Sending now.'
              : problem
                ? 'Not sent. Nothing was taken.'
                : queue.state === 'starting'
                  ? 'Starting the wait. Nothing moves until it ends.'
                  : `Sending in ${secondsWords(waitSeconds)}. You can stop it until then.`}
        </Text>
      </View>

      {problem ? (
        <Text accessibilityRole="alert" className="mt-4 font-body text-ui text-halt">
          {problem}
        </Text>
      ) : null}

      {/* The one strong button is yours, in ink: stopping it. */}
      <View className="mt-6 flex-row">
        <Button
          label={stopping ? 'Stopping' : problem ? 'Close' : 'Cancel this payment'}
          busy={stopping}
          disabled={sending || stopping}
          onPress={() => void stop()}
        />
      </View>

      {/* The contract holds the wait, so there is no sending early; only a sheet-held wait can be cut short. */}
      {queue.state === 'here' || problem ? (
        <Pressable
          accessibilityRole="button"
          disabled={sending || stopping}
          onPress={() => void run()}
          className="items-center py-3.5 active:opacity-60"
        >
          <Text className="font-strong text-ui text-slate">{problem ? 'Try again' : 'Send it now'}</Text>
        </Pressable>
      ) : (
        <View className="h-3" />
      )}
    </Sheet>
  );
}
