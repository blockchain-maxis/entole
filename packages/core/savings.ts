import type { GrowPosition } from './schemas';

/**
 * What savings are earning, for a screen to show. `null` unless the position
 * carries a real rate read from where the money is actually held: a plain
 * set-aside balance earns nothing, and no screen may suggest otherwise. There
 * is no default rate here and nowhere else to get one.
 */
export type SavingsEarning = {
  /** "3.3%". The yearly rate right now; it moves. */
  rate: string;
  /** How much of the balance is earnings, as far as this device knows. Can be zero. */
  earnedMinor: number;
};

/** 332 -> "3.3%", 300 -> "3%", 5 -> "0.1%" (never rounded down to nothing). */
export function ratePercent(basisPoints: number): string {
  const tenths = Math.max(1, Math.round(basisPoints / 10));
  return tenths % 10 === 0 ? `${tenths / 10}%` : `${(tenths / 10).toFixed(1)}%`;
}

export function savingsEarning(position: GrowPosition | null | undefined): SavingsEarning | null {
  if (!position || !position.ratePerYearBps || position.ratePerYearBps <= 0) return null;
  return { rate: ratePercent(position.ratePerYearBps), earnedMinor: position.accruedMinor };
}
