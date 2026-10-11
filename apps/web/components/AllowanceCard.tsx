import Link from 'next/link';

import { cadenceWords, type AllowanceView } from '@entole/core/allowance';
import { resetLabel } from '@entole/core/format';
import { formatNaira } from '@entole/core/money';

import { Meter } from './Meter';

/**
 * An allowance, as the sentence it is: how much, to whom, how often, written
 * in the assistant's blue. Under it, what is left, as a figure and as the
 * meter. It always reads as a balance with something left in it, never as a
 * permission, a scope, a key or a toggle. A row on paper, not a box; the whole
 * row opens the allowance.
 */
export function AllowanceCard({
  allowance,
  recipientName,
  resetsAt,
  href,
}: {
  allowance: AllowanceView;
  recipientName: string;
  resetsAt: string;
  href: string;
}) {
  return (
    <li>
      <Link href={href} className="-mx-3 block rounded-control px-3 py-4 transition-colors hover:bg-press">
        <p className="text-pretty font-display-plain text-prose text-indigo">
          <span className="tabular">{formatNaira(allowance.perRunMinor)}</span> to {recipientName}{' '}
          {cadenceWords(allowance.cadence)}
        </p>

        <div className="mt-2 flex items-baseline justify-between gap-3">
          <p className="tabular font-body text-note text-slate">
            <span className="font-strong text-ui text-ink">{formatNaira(allowance.remainingMinor)}</span> left of{' '}
            {formatNaira(allowance.limitMinor)}
          </p>
          <p className="tabular flex-none font-body text-note text-slate">
            {allowance.paused ? 'Paused' : resetLabel(resetsAt)}
          </p>
        </div>

        <div className="mt-2.5">
          <Meter
            fraction={allowance.remainingFraction}
            tone={allowance.tone}
            label={`${formatNaira(allowance.remainingMinor)} left of the allowance for ${recipientName}`}
          />
        </div>
      </Link>
    </li>
  );
}
