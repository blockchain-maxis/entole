'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { resetLabel, secondsWords } from '@entole/core/format';
import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo, remaining } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { AllowanceCardSkeleton } from '@/components/Skeleton';
import { AssistantBadge } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';
import { Header } from '@/components/Header';
import { Meter } from '@/components/Meter';
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
      <Header title="Entole is sending" back="/" />

      <div className="flex flex-1 flex-col justify-end px-gutter pb-[max(24px,env(safe-area-inset-bottom))]">
        {store.status === 'loading' ? (
          <AllowanceCardSkeleton />
        ) : receipt ? (
          <SentPanel receiptId={receipt.id} />
        ) : !proposal ? (
          <section className="rounded-panel bg-card p-6 shadow-raised">
            <p className="font-body text-body-sm text-slate">Nothing is waiting to be sent right now.</p>
            <button
              type="button"
              onClick={leave}
              className="mt-5 flex h-14 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-body-lg text-ink transition-colors hover:border-mist"
            >
              Close
            </button>
          </section>
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
    <section
      aria-labelledby="proposal-title"
      className="rounded-t-sheet bg-card px-gutter-lg pb-6 pt-6 shadow-floating"
    >
      <AssistantBadge />

      <div className="mt-4 flex items-center gap-3.5">
        <span
          aria-hidden
          className="flex h-14 w-14 flex-none items-center justify-center rounded-pill bg-avatar-1 font-strong text-body-lg text-paper"
        >
          {contact?.initials ?? '?'}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="proposal-title" className="truncate font-strong text-headline text-ink">
            {contact?.name ?? 'Recipient'}
          </h2>
          <p className="mt-0.5 truncate font-body text-label-sm text-slate">
            {proposal.note}
            {contact?.place ? `, ${contact.place}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular font-strong text-title text-ink">{formatNaira(amount)}</p>
          <p className="tabular mt-0.5 font-body text-caption text-mist">
            ≈ {formatDollars(toDollars(amount, store.rate))}
          </p>
        </div>
      </div>

      {allowance ? (
        <div className="mt-5 rounded-control bg-indigo-wash px-4 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="flex-1 font-strong text-label text-ink">{allowance.name}</p>
            <p className="tabular font-strong text-caption text-indigo">
              {formatNaira(allowance.remainingMinor)} to {formatNaira(afterRun)} left
            </p>
          </div>
          <div className="mt-3">
            <Meter
              fraction={allowance.remainingFraction}
              tone={allowance.tone}
              label={`${allowance.name} remaining`}
            />
          </div>
          <p className="tabular mt-2.5 font-body text-caption text-slate">
            {resetLabel(allowance.resetsAt)}, within your {formatNaira(allowance.limitMinor)}{' '}
            {allowance.cadence === 'weekly' ? 'weekly' : 'monthly'} limit
          </p>
        </div>
      ) : null}

      <div className="mt-5 flex items-center gap-3.5">
        <Countdown seconds={proposal.undoSeconds} running={!stopped && !sending} onElapsed={onRun} />
        <p className="flex-1 font-body text-label text-slate">
          {sending
            ? 'Sending. This updates when the payment has settled.'
            : `Sending in ${secondsWords(proposal.undoSeconds)}. You can stop it until then.`}
        </p>
      </div>

      {problem ? <p className="mt-4 font-body text-label text-halt">{problem}</p> : null}

      <button
        type="button"
        disabled={sending}
        onClick={onStop}
        className="mt-5 flex h-14 w-full items-center justify-center rounded-control border border-halt bg-card font-strong text-body-lg text-halt transition-colors hover:bg-paper disabled:opacity-60"
      >
        Cancel this payment
      </button>
      <button
        type="button"
        disabled={sending}
        onClick={onRun}
        className="mt-1 flex h-12 w-full items-center justify-center font-strong text-label-sm text-mist hover:text-slate disabled:opacity-60"
      >
        Send it now
      </button>
    </section>
  );
}

function SentPanel({ receiptId }: { receiptId: string }) {
  const store = useStore();
  const receipt = store.receipt(receiptId)!;
  const contact = store.contact(receipt.contactId);

  return (
    <section className="rounded-t-sheet bg-card px-gutter-lg pb-6 pt-6 shadow-floating">
      <AssistantBadge />
      <h2 className="mt-4 font-strong text-headline text-ink">
        Entole sent {contact?.name ?? 'a payment'}
      </h2>
      <dl className="mt-4 border-t border-hairline">
        <Line label="Amount sent" value={formatNaira(kobo(receipt.amountMinor))} />
        <Line label="Fee" value={formatNaira(kobo(receipt.feeMinor))} />
        <Line label="Delivered in" value={secondsWords(receipt.deliveredInSeconds)} />
      </dl>
      <Link
        href="/activity"
        className="mt-5 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep"
      >
        See activity
      </Link>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-hairline py-2.5">
      <dt className="font-body text-label text-slate">{label}</dt>
      <dd className="tabular font-strong text-label text-ink">{value}</dd>
    </div>
  );
}
