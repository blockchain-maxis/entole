import { kobo } from '@entole/core/money';
import type { MoneyPicture, SafeToSpend } from '@entole/core/money-picture';

import { Figure } from './Amount';
import { safeToSpendNote } from '@/lib/plan-words';

/**
 * What is safe to spend today, as the figure, with how long it is meant to
 * last under it. Every part of it is the person's own: their balance, what is
 * due before they are next paid, and what is put aside first.
 */
export function SafeToSpendFigure({ picture, safe }: { picture: MoneyPicture; safe: SafeToSpend }) {
  return (
    <>
      <p className="font-strong text-note text-slate">Safe to spend today</p>
      <div className="mt-1">
        <Figure value={kobo(safe.todayMinor)} />
      </div>
      <p className="mt-2 text-pretty font-body text-ui text-slate">{safeToSpendNote(picture, safe)}</p>
    </>
  );
}
