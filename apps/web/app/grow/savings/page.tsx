'use client';

import { useState } from 'react';

import { EMPTY_ENTRY, entryDisplay, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { formatNaira, kobo } from '@entole/core/money';
import { savingsEarning } from '@entole/core/savings';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { BalanceSkeleton } from '@/components/Skeleton';

type Mode = 'view' | 'deposit' | 'withdraw';

/**
 * "Savings" — the Grow hub's first product: the owner's own money, set aside.
 * No delegate, no allowance; moving money in or out here is always a direct
 * owner action.
 *
 * It says what is true and nothing more. Where savings are held somewhere that
 * pays, the rate and what has been earned are read from there and are part of
 * the balance, ready to take out. Where they are not, the page says they earn
 * nothing yet. There is no payout date and no projection either way. Mirrors
 * `apps/mobile/app/grow/savings.tsx`.
 */
export default function SavingsPage() {
  const store = useStore();
  const loading = store.status === 'loading';
  const position = store.growPosition;
  // Only ever a rate read from where the money is held. Null means it earns nothing.
  const earning = savingsEarning(position);

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
      setProblem('That is more than you have in savings.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (mode === 'deposit') await store.depositGrow(amount);
      else if (mode === 'withdraw') await store.withdrawGrow(amount);
      setMode('view');
      setEntry(EMPTY_ENTRY);
    } catch (error) {
      // A refusal written for people (savings busy, for one) is shown as it is.
      const said = error instanceof Error && error.name === 'SavingsBusyError' ? error.message : null;
      setProblem(said ?? 'That did not go through. Nothing changed.');
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
              <p className="font-strong text-label-sm text-mist">In savings</p>
              <div className="mt-2.5">
                <Amount value={kobo(position.balanceMinor)} />
              </div>
              {earning ? (
                <>
                  {earning.earnedMinor > 0 ? (
                    <p className="tabular mt-2 font-body text-body-sm text-settled">
                      + {formatNaira(kobo(earning.earnedMinor))} earned so far
                    </p>
                  ) : null}
                  <p className="mt-3 font-strong text-body-sm text-ink">Earning about {earning.rate} a year</p>
                  <p className="mt-1 text-pretty font-body text-label-sm text-slate">
                    The rate moves from day to day. To earn it, your savings are lent out through a lending market.
                    You can take them out at any time, unless all of it happens to be lent out at that moment.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-pretty font-body text-label-sm text-slate">
                  Money set aside, separate from what you spend. It doesn&apos;t earn interest yet.
                </p>
              )}
            </div>

            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => openMode('deposit')}
                className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px"
              >
                Add to savings
              </button>
              <button
                type="button"
                disabled={position.balanceMinor <= 0}
                onClick={() => openMode('withdraw')}
                className="flex h-14 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-body-lg text-ink transition-colors hover:border-mist active:translate-y-px disabled:opacity-60"
              >
                Take out
              </button>
            </div>
          </>
        ) : (
          <div className="pt-2">
            <div className="flex items-baseline justify-between">
              <p className="font-heavy text-body-sm text-ink">{mode === 'deposit' ? 'Add to savings' : 'Take out of savings'}</p>
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
                {busy ? 'Working' : mode === 'deposit' ? `Add ${formatNaira(amount)}` : `Take out ${formatNaira(amount)}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
