'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { cadenceWords } from '@entole/core/allowance';
import { resetLabel } from '@entole/core/format';
import { formatNaira } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { Meter } from '@/components/Meter';
import { Skeleton } from '@/components/Skeleton';

/** An allowance, read the only way this app ever renders one: a remaining
 * balance, never a permission, a scope or a toggle. */
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
        <div className="rounded-panel bg-card p-6 shadow-raised">
          <p className="font-strong text-label-sm text-mist">{allowance.name}</p>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="tabular font-strong text-amount text-ink">{formatNaira(allowance.remainingMinor)}</span>
            <span className="tabular font-body text-label-sm text-slate">left of {formatNaira(allowance.limitMinor)}</span>
          </div>
          <div className="mt-4">
            <Meter fraction={allowance.remainingFraction} tone={allowance.tone} label={`${allowance.name} remaining`} />
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          <Row label="To" value={recipient?.name ?? 'Someone'} />
          <Row label="Each time" value={formatNaira(allowance.perRunMinor)} />
          <Row label="How often" value={cadenceWords(allowance.cadence)} />
          <Row label="Resets" value={allowance.paused ? 'Paused' : resetLabel(allowance.resetsAt)} />
        </div>

        {asking ? (
          // Asked in place: revoking cannot be taken back, so one tap is not enough.
          <div className="mt-8 rounded-tile border border-halt bg-halt-wash p-[18px]">
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
            className="mt-8 flex h-14 w-full items-center justify-center rounded-control border border-halt bg-halt-wash font-strong text-body-lg text-halt transition-colors hover:bg-halt-tint active:translate-y-px"
          >
            Revoke this allowance
          </button>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-row border border-line bg-card px-4 py-3">
      <span className="font-body text-label-sm text-slate">{label}</span>
      <span className="font-strong text-label text-ink">{value}</span>
    </div>
  );
}
