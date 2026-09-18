'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

import { cadenceWords } from '@entole/core/allowance';
import { resetLabel } from '@entole/core/format';
import { formatNaira } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { Meter } from '@/components/Meter';

/** An allowance, read the only way this app ever renders one: a remaining
 * balance, never a permission, a scope or a toggle. */
export default function RuleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const store = useStore();
  const allowance = store.allowance(id);
  const recipient = allowance ? store.contact(allowance.recipientId) : undefined;
  const [revoking, setRevoking] = useState(false);

  async function revoke() {
    if (!allowance || revoking) return;
    setRevoking(true);
    try {
      await store.revokeAllowance(allowance.id);
      router.push('/');
    } finally {
      setRevoking(false);
    }
  }

  if (!allowance) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
        <Header title="Rule" />
        <p className="px-gutter pt-6 font-body text-label-sm text-mist">This rule no longer exists.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Rule" />

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

        <button
          type="button"
          disabled={revoking}
          onClick={() => void revoke()}
          className="mt-8 flex h-14 w-full items-center justify-center rounded-control border border-halt bg-halt-wash font-strong text-body-lg text-halt transition-colors hover:bg-halt-tint disabled:opacity-60"
        >
          {revoking ? 'Revoking' : 'Revoke this rule'}
        </button>
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
