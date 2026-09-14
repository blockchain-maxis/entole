import type { MeterTone } from '@entole/core/allowance';

const FILL = {
  settled: 'bg-settled',
  caution: 'bg-caution',
  halt: 'bg-halt',
} as const satisfies Record<MeterTone, string>;

/** How much of an allowance is still there, as a bar rather than a number. */
export function Meter({
  fraction,
  tone,
  label,
}: {
  fraction: number;
  tone: MeterTone;
  label: string;
}) {
  const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-pill bg-track"
    >
      <div className={`h-full rounded-pill ${FILL[tone]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}
