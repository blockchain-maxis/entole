'use client';

import { useState } from 'react';

import { relativeMoment } from '@entole/core/format';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { LogoLoader } from './LogoLoader';

/**
 * What a paid invoice set aside for tax. It is a figure the business keeps in
 * view, not money moved: the card says so, and offers to move it into savings
 * so it is apart from what can be spent. No date is made up for paying it.
 */
export function TaxReserveCard() {
  const store = useStore();
  const [moving, setMoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reserves = store.taxReserves;
  if (reserves.length === 0) return null;
  const waiting = reserves.filter((reserve) => !reserve.movedAt);
  const toMove = waiting.reduce((sum, reserve) => sum + reserve.balanceMinor, 0);
  const moved = reserves.reduce((sum, reserve) => sum + (reserve.movedAt ? reserve.balanceMinor : 0), 0);
  const latest = reserves[0]!;

  async function move() {
    if (moving) return;
    setMoving(true);
    setProblem(null);
    try {
      await store.moveTaxReserveToSavings();
    } catch (error) {
      setProblem(
        error instanceof Error && error.name === 'MovementNotConfirmedError'
          ? error.message
          : "That didn't go through. Nothing moved. Try again.",
      );
    } finally {
      setMoving(false);
    }
  }

  return (
    <section aria-labelledby="tax-title" className="mt-6 border-y border-hairline py-5">
      <h2 id="tax-title" className="font-strong text-note text-slate">
        Set aside for tax
      </h2>
      <p className="tabular mt-2 font-display text-figure-sm text-ink">{formatNaira(kobo(toMove + moved))}</p>
      <p className="mt-1.5 text-pretty font-body text-note text-slate">
        {`From ${reserves.length === 1 ? 'one paid invoice' : `${reserves.length} paid invoices`}${
          latest.setAsideAt ? `, the last ${relativeMoment(latest.setAsideAt)}` : ''
        }.`}{' '}
        {moved > 0 ? `${formatNaira(kobo(moved))} of it is in savings.` : 'It is a figure to keep in view; it has not left your balance.'}
      </p>
      {problem ? <p className="mt-2 font-body text-note text-halt">{problem}</p> : null}
      {toMove > 0 ? (
        <button
          type="button"
          onClick={() => void move()}
          disabled={moving}
          className="mt-4 flex h-11 items-center gap-2.5 rounded-control bg-ink px-5 font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
        >
          {moving ? <LogoLoader size={18} label="Moving" mono /> : null}
          {moving ? 'Moving' : `Move ${formatNaira(kobo(toMove))} to savings`}
        </button>
      ) : null}
    </section>
  );
}
