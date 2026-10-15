'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { resetLabel, secondsWords } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo, remaining } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Figure } from '@/components/Amount';
import { AssistantBadge } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';
import { Header } from '@/components/Header';
import { Meter } from '@/components/Meter';
import { FigureSkeleton, Skeleton } from '@/components/Skeleton';
import { plainMessage } from '@/lib/send';

/**
 * Delegation with an undo window, never a confirmation dialog: confirming every
 * assistant action would defeat the point of delegating, and doing it silently
 * would destroy the trust that makes delegating possible. The web twin of the
 * phone's assistant-action sheet, with the same states and the same words.
 *
 * Nothing here says "sent" until the payment has settled: `runProposal`
 * resolves only then, and only then does the receipt appear.
 *
 * The wait is the contract's, not this page's. As the page opens the run is
 * put in the policy contract's queue, and the countdown runs to the moment the
 * contract will let it be carried out. Cancelling stops it there. Closing the
 * page does not send it; a run nobody carries out goes stale on its own.
 */
export default function AssistantAction() {
  const router = useRouter();
  const store = useStore();
  const proposal = store.proposal;
  const [sending, setSending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const leave = () => router.replace('/');

  async function run() {
    if (sending || stopped) return;
    setSending(true);
    setProblem(null);
    try {
      const receipt = await store.runProposal();
      setReceiptId(receipt.id);
    } catch (error) {
      setSending(false);
      setProblem(plainMessage(error, "That payment didn't go through. Nothing was taken."));
      // If it did go through after all, the balance says so.
      void store.refresh().catch(() => undefined);
    }
  }

  async function stop() {
    if (stopping) return;
    setStopped(true);
    setStopping(true);
    setProblem(null);
    try {
      await store.cancelProposal();
      leave();
    } catch (error) {
      setStopping(false);
      setProblem(plainMessage(error, "We couldn't stop it on the network. Pause the assistant now to be sure it does not go."));
    }
  }

  const receipt = receiptId ? store.receipt(receiptId) : undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="The assistant" back="/" />

      <div className="flex flex-1 flex-col px-gutter pb-[max(24px,env(safe-area-inset-bottom))] pt-2">
        {store.status === 'loading' ? (
          <div>
            <Skeleton className="h-5 w-24 rounded-pill" />
            <FigureSkeleton />
            <Skeleton className="mt-6 h-[132px] w-full rounded-card" />
          </div>
        ) : receipt ? (
          <SentPanel receiptId={receipt.id} />
        ) : !proposal ? (
          <>
            <h2 className="font-display text-heading text-ink">Nothing is waiting</h2>
            <p className="mt-2 text-pretty font-body text-prose text-slate">
              The assistant has no payment to send right now.
            </p>
            <button
              type="button"
              onClick={leave}
              className="mt-auto flex h-14 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist active:translate-y-px"
            >
              Close
            </button>
          </>
        ) : (
          <ProposalPanel
            sending={sending}
            stopped={stopped}
            stopping={stopping}
            problem={problem}
            onProblem={setProblem}
            onRun={() => void run()}
            onStop={() => void stop()}
          />
        )}
      </div>
    </main>
  );
}

/**
 * The undo window. What the assistant is about to send is the figure; the
 * allowance it comes from sits under it in the assistant's blue, with what
 * will be left. The one strong button is yours, in ink: stopping it.
 */
function ProposalPanel({
  sending,
  stopped,
  stopping,
  problem,
  onProblem,
  onRun,
  onStop,
}: {
  sending: boolean;
  stopped: boolean;
  stopping: boolean;
  problem: string | null;
  onProblem: (problem: string) => void;
  onRun: () => void;
  onStop: () => void;
}) {
  const store = useStore();
  const proposal = store.proposal!;
  // Where the wait is held: being put in the contract's queue, waiting there
  // until `readyAt`, or (with no contract to hold it) on this page.
  const [queue, setQueue] = useState<{ state: 'starting' } | { state: 'queued'; readyAt: number; seconds: number } | { state: 'here' }>({
    state: 'starting',
  });
  const begun = useRef<string | null>(null);

  useEffect(() => {
    if (begun.current === proposal.id) return;
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
      .catch((error: unknown) => onProblem(plainMessage(error, "The assistant couldn't start that payment. Nothing was sent.")));
  }, [proposal.id, store, onProblem]);

  const waitSeconds = queue.state === 'queued' ? queue.seconds : proposal.undoSeconds;
  const counting = queue.state !== 'starting' && !stopped && !sending && !problem;
  const contact = store.contact(proposal.contactId);
  const allowance = store.allowance(proposal.allowanceId);
  const amount = kobo(proposal.amountMinor);
  const afterRun = allowance ? remaining(allowance.remainingMinor, amount) : kobo(0);

  return (
    <section aria-labelledby="proposal-title" className="flex flex-1 flex-col">
      <div className="flex items-center gap-2">
        <AssistantBadge />
        <p className="font-body text-note text-slate">{sending ? 'is sending' : 'is about to send'}</p>
      </div>

      <div className="mt-3">
        <Figure value={amount} />
      </div>
      <h2 id="proposal-title" className="mt-2 text-pretty font-display text-subhead text-ink">
        to {contact?.name ?? 'someone'}
      </h2>
      <p className="tabular mt-1 truncate font-body text-ui text-slate">
        {proposal.note} · about {formatDollars(toDollars(amount, store.rate))}
      </p>

      {allowance ? (
        <div className="mt-6 rounded-card bg-indigo-wash p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-body text-note text-slate">From this allowance</p>
            <p className="tabular flex-none font-strong text-note text-indigo">
              {formatNaira(allowance.remainingMinor)} to {formatNaira(afterRun)} left
            </p>
          </div>
          <div className="mt-3">
            <Meter
              fraction={allowance.remainingFraction}
              tone={allowance.tone}
              label={`${formatNaira(allowance.remainingMinor)} left of the allowance`}
            />
          </div>
          <p className="tabular mt-2.5 font-body text-note text-slate">
            {resetLabel(allowance.resetsAt)}, within your {formatNaira(allowance.limitMinor)}{' '}
            {allowance.cadence === 'weekly' ? 'weekly' : 'monthly'} limit
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-3.5">
        <Countdown
          key={queue.state === 'queued' ? queue.readyAt : queue.state}
          seconds={waitSeconds}
          running={counting}
          onElapsed={onRun}
        />
        <p className="flex-1 text-pretty font-body text-ui text-slate">
          {stopping
            ? 'Stopping it on the network.'
            : sending
              ? 'Sending. This updates when the payment has been delivered.'
              : problem
                ? 'Not sent. Nothing was taken.'
                : queue.state === 'starting'
                  ? 'Starting the wait. Nothing moves until it ends.'
                  : `Sending in ${secondsWords(waitSeconds)}. You can stop it until then.`}
        </p>
      </div>

      {problem ? (
        <p role="alert" className="mt-4 text-pretty font-body text-ui text-halt">
          {problem}
        </p>
      ) : null}

      <div className="mt-auto pt-8">
        <button
          type="button"
          disabled={sending || stopping}
          onClick={onStop}
          className="flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
        >
          {stopping ? 'Stopping' : problem ? 'Close' : 'Cancel this payment'}
        </button>
        {/* The contract holds the wait, so there is no sending early; only a page-held wait can be cut short. */}
        {queue.state === 'here' || problem ? (
          <button
            type="button"
            disabled={sending || stopping}
            onClick={onRun}
            className="mt-1 flex h-12 w-full items-center justify-center rounded-control font-strong text-ui text-slate transition-colors hover:bg-press hover:text-ink disabled:opacity-60"
          >
            {problem ? 'Try again' : 'Send it now'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Only ever drawn for a payment that has been delivered. */
function SentPanel({ receiptId }: { receiptId: string }) {
  const store = useStore();
  const receipt = store.receipt(receiptId)!;
  const contact = store.contact(receipt.contactId);

  return (
    <section className="flex flex-1 flex-col">
      <div className="flex items-center gap-2">
        <AssistantBadge />
        <p className="font-body text-note text-slate">sent</p>
      </div>
      <div className="mt-3">
        <Figure value={kobo(receipt.amountMinor)} />
      </div>
      <h2 className="mt-2 text-pretty font-display text-subhead text-ink">The assistant sent {contact?.name ?? 'a payment'}</h2>
      <dl className="mt-5 border-t border-hairline">
        <Line label="Amount sent" value={formatNaira(kobo(receipt.amountMinor))} />
        <Line label="Fee" value={formatNaira(kobo(receipt.feeMinor))} />
        <Line label="Delivered in" value={secondsWords(receipt.deliveredInSeconds)} />
      </dl>
      <Link
        href="/activity"
        className="mt-auto flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
      >
        See activity
      </Link>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-hairline py-3">
      <dt className="font-body text-ui text-slate">{label}</dt>
      <dd className="tabular font-strong text-ui text-ink">{value}</dd>
    </div>
  );
}
