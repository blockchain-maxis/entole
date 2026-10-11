'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { cadenceWords } from '@entole/core/allowance';
import { relativeMoment, resetLabel } from '@entole/core/format';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Figure } from '@/components/Amount';
import { EmptyState } from '@/components/EmptyState';
import { Header } from '@/components/Header';
import { Meter } from '@/components/Meter';
import { SectionHeading } from '@/components/SectionHeading';
import { Skeleton } from '@/components/Skeleton';

const USED_TONE = { settled: 'text-settled', caution: 'text-caution', halt: 'text-halt' } as const;

/**
 * One allowance, read the only way this app ever renders one: as the sentence
 * it is, in the assistant's blue, and a balance with something left in it.
 * Never a permission, a scope or a toggle. Under it, every payment the
 * assistant has made from it.
 */
export default function RuleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const store = useStore();
  const allowance = store.allowance(id);
  const recipient = allowance ? store.contact(allowance.recipientId) : undefined;
  const [asking, setAsking] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function revoke() {
    if (!allowance || revoking) return;
    setRevoking(true);
    setProblem(null);
    try {
      await store.revokeAllowance(allowance.id);
      router.push('/');
    } catch {
      setProblem("We couldn't revoke it. The allowance is still in force. Try again.");
    } finally {
      setRevoking(false);
    }
  }

  const payments = allowance ? store.activity.filter((entry) => entry.allowanceId === allowance.id) : [];
  const period = allowance?.cadence === 'weekly' ? 'a week' : 'a month';

  // Still reading the account: an allowance that has not loaded is not one
  // that is gone.
  if (!allowance && store.status === 'loading') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
        <Header title="Allowance" back="/" />
        <div className="px-gutter">
          <Skeleton className="h-[132px] w-full rounded-panel" />
          <Skeleton className="mt-5 h-[52px] w-full rounded-row" />
          <Skeleton className="mt-2.5 h-[52px] w-full rounded-row" />
        </div>
      </main>
    );
  }

  if (!allowance) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
        <Header title="Allowance" back="/" />
        <p className="px-gutter pt-6 font-body text-label-sm text-slate">
          {store.status === 'failed'
            ? "We couldn't load this allowance. Nothing about it has changed."
            : 'This allowance no longer exists.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Allowance" back="/" />

      <div className="flex-1 px-gutter pb-28">
        <section className="rounded-card bg-card p-5 shadow-raised">
          <p className="text-pretty font-display-plain text-subhead text-indigo">
            Send <span className="tabular">{formatNaira(allowance.perRunMinor)}</span> to {recipient?.name ?? 'them'}{' '}
            {cadenceWords(allowance.cadence)}, never more than{' '}
            <span className="tabular">{formatNaira(allowance.limitMinor)}</span> {period}.
          </p>

          <div className="mt-6 flex items-end justify-between gap-3">
            <div>
              <Figure value={allowance.remainingMinor} />
              <p className="mt-1 font-body text-note text-slate">left</p>
            </div>
            <p className={`tabular pb-1 font-strong text-note ${USED_TONE[allowance.tone]}`}>
              {allowance.usedPercent}% used
            </p>
          </div>

          <div className="mt-4">
            <Meter
              fraction={allowance.remainingFraction}
              tone={allowance.tone}
              label={`${formatNaira(allowance.remainingMinor)} left of the allowance`}
            />
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-3">
            <p className="tabular font-body text-note text-slate">{formatNaira(allowance.spentMinor)} spent this period</p>
            <p className="tabular flex-none font-body text-note text-slate">
              {allowance.paused ? 'Paused' : resetLabel(allowance.resetsAt)}
            </p>
          </div>
        </section>

        <SectionHeading title="Payments from it" />
        {payments.length === 0 ? (
          <EmptyState body="The assistant has not paid anything from this allowance yet." />
        ) : (
          <ul className="divide-y divide-hairline border-y border-hairline">
            {payments.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-strong text-ui text-ink">{entry.note}</p>
                  <p className="tabular mt-0.5 font-body text-note text-slate">
                    {entry.state === 'pending' ? 'Sending' : relativeMoment(entry.at)}
                  </p>
                </div>
                <p className="tabular flex-none font-strong text-ui text-ink">{formatNaira(kobo(entry.amountMinor))}</p>
              </li>
            ))}
          </ul>
        )}

        {asking ? (
          // Asked in place: revoking cannot be taken back, so one tap is not enough.
          <div className="mt-10 rounded-card border border-halt bg-halt-wash p-5">
            <p className="font-strong text-body text-ink">Revoke this allowance?</p>
            <p className="mt-1 text-pretty font-body text-label-sm text-slate">
              The assistant can no longer pay {recipient?.name ?? 'them'} from it. Payments already made stay made.
            </p>
            {problem ? (
              <p role="alert" className="mt-2 font-body text-label-sm text-halt">
                {problem}
              </p>
            ) : null}
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                disabled={revoking}
                onClick={() => void revoke()}
                className="flex h-12 flex-1 items-center justify-center rounded-control bg-halt font-strong text-body text-card transition-colors hover:bg-halt-deep active:translate-y-px disabled:opacity-60"
              >
                {revoking ? 'Revoking' : 'Revoke'}
              </button>
              <button
                type="button"
                disabled={revoking}
                onClick={() => {
                  setAsking(false);
                  setProblem(null);
                }}
                className="flex h-12 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-body text-ink transition-colors hover:border-mist active:translate-y-px disabled:opacity-60"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="mt-10 flex h-12 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-ui text-halt transition-colors hover:border-halt active:translate-y-px"
          >
            Revoke this allowance
          </button>
        )}
      </div>
    </main>
  );
}
