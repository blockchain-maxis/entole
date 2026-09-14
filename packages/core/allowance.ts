import { kobo, remaining, type Naira } from './money';
import type { Allowance } from './schemas';

/**
 * An allowance is rendered as one thing only: the balance still left in it.
 * Caps, recipients, cadence and expiry are enforced by the policy contract;
 * the app never treats them as a permission, a scope or a toggle.
 */

export type MeterTone = 'settled' | 'caution' | 'halt';

/** Meters travel settled → caution → halt as they drain. */
export function meterTone(remainingFraction: number): MeterTone {
  if (remainingFraction > 0.5) return 'settled';
  if (remainingFraction > 0.15) return 'caution';
  return 'halt';
}

export type AllowanceView = {
  id: string;
  name: string;
  recipientId: string;
  remainingMinor: Naira;
  limitMinor: Naira;
  spentMinor: Naira;
  /** 0–1, how much of the allowance is still available. */
  remainingFraction: number;
  usedPercent: number;
  tone: MeterTone;
  paused: boolean;
  perRunMinor: Naira;
  cadence: Allowance['cadence'];
  resetsAt: string;
};

export function viewAllowance(allowance: Allowance): AllowanceView {
  const limitMinor = kobo(allowance.limitMinor);
  const spentMinor = kobo(allowance.spentMinor);
  const remainingMinor = remaining(limitMinor, spentMinor);
  const remainingFraction = limitMinor > 0 ? remainingMinor / limitMinor : 0;

  return {
    id: allowance.id,
    name: allowance.name,
    recipientId: allowance.recipientId,
    remainingMinor,
    limitMinor,
    spentMinor,
    remainingFraction,
    usedPercent: Math.round((1 - remainingFraction) * 100),
    tone: meterTone(remainingFraction),
    paused: allowance.paused,
    perRunMinor: kobo(allowance.perRunMinor),
    cadence: allowance.cadence,
    resetsAt: allowance.resetsAt,
  };
}

/**
 * Mirrors the contract's arithmetic so the app can grey out a run it knows will
 * be refused. The contract is still the only thing that decides.
 */
export function wouldExceed(allowance: Allowance, amountMinor: number): boolean {
  return allowance.spentMinor + amountMinor > allowance.limitMinor;
}

const CADENCE_WORDS = {
  weekly: 'every week',
  monthly: 'every month',
  'on-request': 'only when I ask',
} as const;

export function cadenceWords(cadence: Allowance['cadence']): string {
  return CADENCE_WORDS[cadence];
}

const CADENCE_DETAIL = {
  weekly: 'Mondays',
  monthly: '1st',
  'on-request': 'Manual',
} as const;

export function cadenceDetail(cadence: Allowance['cadence']): string {
  return CADENCE_DETAIL[cadence];
}
