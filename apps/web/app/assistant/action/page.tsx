'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
 */
export default function AssistantAction() {
  const router = useRouter();
  const store = useStore();
  const proposal = store.proposal;
  const [sending, setSending] = useState(false);
  const [stopped, setStopped] = useState(false);
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
    setStopped(true);
    await store.cancelProposal();
    leave();
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
            problem={problem}
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
  problem,
  onRun,
  onStop,
}: {
  sending: boolean;
  stopped: boolean;
  problem: string | null;
  onRun: () => void;
  onStop: () => void;
}) {
  const store = useStore();
  const proposal = store.proposal!;
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
        <Countdown seconds={proposal.undoSeconds} running={!stopped && !sending} onElapsed={onRun} />
        <p className="flex-1 text-pretty font-body text-ui text-slate">
          {sending
            ? 'Sending. This updates when the payment has been delivered.'
            : `Sending in ${secondsWords(proposal.undoSeconds)}. You can stop it until then.`}
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
          disabled={sending}
          onClick={onStop}
          className="flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
        >
          Cancel this payment
        </button>
        <button
          type="button"
          disabled={sending}
          onClick={onRun}
          className="mt-1 flex h-12 w-full items-center justify-center rounded-control font-strong text-ui text-slate transition-colors hover:bg-press hover:text-ink disabled:opacity-60"
        >
          Send it now
        </button>
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
