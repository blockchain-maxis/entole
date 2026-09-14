import type { AllowanceView } from '@entole/core/allowance';
import { resetLabel } from '@entole/core/format';
import { formatNaira } from '@entole/core/money';

import { Meter } from './Meter';

/**
 * An allowance always reads as a balance with something left in it — never as a
 * permission, a scope, a key or a toggle.
 */
export function AllowanceCard({
  allowance,
  resetsAt,
}: {
  allowance: AllowanceView;
  resetsAt: string;
}) {
  return (
    <li className="rounded-row border border-line bg-card px-4 pb-[18px] pt-4">
      <div className="flex items-start justify-between gap-3">
        <span className="flex-1 font-strong text-body text-ink">{allowance.name}</span>
        <span className="tabular pt-0.5 font-strong text-caption-sm text-mist">
          {allowance.paused ? 'Paused' : resetLabel(resetsAt)}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="tabular font-strong text-amount-sm text-ink">
          {formatNaira(allowance.remainingMinor)}
        </span>
        <span className="tabular font-body text-label-sm text-slate">
          left of {formatNaira(allowance.limitMinor)}
        </span>
      </div>

      <div className="mt-3.5">
        <Meter
          fraction={allowance.remainingFraction}
          tone={allowance.tone}
          label={`${allowance.name} remaining`}
        />
      </div>
    </li>
  );
}
