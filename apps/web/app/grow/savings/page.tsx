'use client';

import { useState } from 'react';

import { EMPTY_ENTRY, entryDisplay, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { daysUntil, payoutLabel } from '@entole/core/format';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { Meter } from '@/components/Meter';
import { BalanceSkeleton } from '@/components/Skeleton';

type Mode = 'view' | 'deposit' | 'withdraw';

/**
 * "Savings" — the Grow hub's first product: the owner's own money, growing. No delegate, no allowance;
 * moving money in or out here is always a direct owner action. Earnings
 * shown are a projection, never spendable until they settle into the
 * balance above. Mirrors `apps/mobile/app/grow/savings.tsx`.
 */
export default function SavingsPage() {
  const store = useStore();
  const loading = store.status === 'loading';
  const position = store.growPosition;

  const [mode, setMode] = useState<Mode>('view');
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const amount = entryToMinor(entry);

  function openMode(next: Mode) {
    setEntry(EMPTY_ENTRY);
    setProblem(null);
    setMode(next);
  }

  async function submit() {
    if (amount <= 0 || busy || !position) return;
    if (mode === 'withdraw' && amount > position.balanceMinor) {
      setProblem('That is more than what you have growing.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (mode === 'deposit') await store.depositGrow(amount);
      else if (mode === 'withdraw') await store.withdrawGrow(amount);
      setMode('view');
      setEntry(EMPTY_ENTRY);
    } catch {
      setProblem('That did not go through. Nothing changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Savings" back="/grow" />

      <div className="flex-1 px-gutter pb-28">
        {loading || !position ? (
          <BalanceSkeleton />
        ) : mode === 'view' ? (
          <>
            <div className="rounded-panel bg-card p-6 shadow-raised">
              <p className="font-strong text-label-sm text-mist">What&apos;s growing</p>
              <div className="mt-2.5">
                <Amount value={kobo(position.balanceMinor)} />
              </div>
              {position.accruedMinor > 0 ? (
                <p className="tabular mt-2 font-body text-body-sm text-settled">
                  + {formatNaira(kobo(position.accruedMinor))} earned so far
                </p>
              ) : null}

              <div className="mt-5">
                <Meter fraction={1} tone="settled" label="Growing" />
              </div>
              <div className="mt-2.5 flex items-baseline justify-between">
                <p className="font-body text-label-sm text-slate">{payoutLabel(position.nextPayoutAt)}</p>
                <p className="tabular font-strong text-label-sm text-mist">{daysUntil(position.nextPayoutAt)} days away</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-start gap-3">
              <button type="button" onClick={() => openMode('deposit')} className="font-strong text-body text-ink">
                Grow more money
              </button>
              <button
                type="button"
                onClick={() => openMode('withdraw')}
                aria-label="Move money out of Grow"
                className="font-strong text-label-sm text-indigo"
              >
                Move money out
              </button>
            </div>
          </>
        ) : (
          <div className="pt-2">
            <div className="flex items-baseline justify-between">
              <p className="font-heavy text-body-sm text-ink">{mode === 'deposit' ? 'Add to Grow' : 'Move out of Grow'}</p>
              <p className="tabular font-strong text-amount-sm text-ink">₦{entryDisplay(entry)}</p>
            </div>

            <div className="mt-3">
              <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
            </div>

            {problem ? <p className="mt-3 text-center font-body text-label-sm text-halt">{problem}</p> : null}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => openMode('view')}
                className="flex h-14 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-body-lg text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={amount <= 0 || busy}
                onClick={() => void submit()}
                className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
              >
                {busy ? 'Working' : mode === 'deposit' ? `Add ${formatNaira(amount)}` : `Move out ${formatNaira(amount)}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
