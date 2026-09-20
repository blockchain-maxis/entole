import type { Rate } from '@entole/core/fx';
import { formatNaira, kobo, type Naira } from '@entole/core/money';

/**
 * What the Savings screens check before they let someone press Review. Savings
 * is the person's own money moving between what they can spend and what they
 * have set aside: it carries no Entole fee, so there is no fee in any of this.
 * Every figure here is a real balance passed in — nothing is projected.
 */

export type SavingsMode = 'deposit' | 'withdraw';

/** The smallest amount that is worth at least one US cent at the live rate.
 * Anything below it would settle as nothing, so it is refused up front. */
export function smallestSavingsAmount(rate: Rate): Naira {
  return kobo(Math.ceil(rate.koboPerDollar / 100));
}

export type SavingsCheck =
  | { ok: true }
  | {
      ok: false;
      /** `empty` and `nothing-to-move` are states, not mistakes — the screen
       * stays quiet about the first and explains the second. */
      kind: 'empty' | 'nothing-to-move' | 'below-minimum' | 'above-limit';
      reason: string;
    };

export function checkSavingsAmount(input: {
  mode: SavingsMode;
  amount: number;
  /** What can be spent now. */
  spendable: number;
  /** What is set aside. */
  saved: number;
  rate: Rate;
}): SavingsCheck {
  const { mode, amount, spendable, saved, rate } = input;
  const available = mode === 'deposit' ? spendable : saved;

  if (available <= 0) {
    return {
      ok: false,
      kind: 'nothing-to-move',
      reason:
        mode === 'deposit'
          ? 'You have nothing to spend yet, so there is nothing to set aside.'
          : 'You have nothing in savings yet.',
    };
  }
  if (amount <= 0) return { ok: false, kind: 'empty', reason: 'Enter an amount' };

  if (amount < smallestSavingsAmount(rate)) {
    return {
      ok: false,
      kind: 'below-minimum',
      reason: `The smallest amount is ${formatNaira(smallestSavingsAmount(rate), { alwaysDecimals: true })}, which is $0.01.`,
    };
  }
  if (amount > available) {
    return {
      ok: false,
      kind: 'above-limit',
      reason:
        mode === 'deposit'
          ? `That is more than the ${formatNaira(kobo(spendable))} you can spend.`
          : `That is more than the ${formatNaira(kobo(saved))} you have in savings.`,
    };
  }
  return { ok: true };
}

/** The share of everything the person holds that is set aside, 0–1 — or null
 * when either side is empty, because a bar that is all one thing says nothing. */
export function savedShare(spendable: number, saved: number): number | null {
  if (spendable <= 0 || saved <= 0) return null;
  return saved / (spendable + saved);
}

/** "12% of your money is set aside" — never a rate of return. */
export function savedShareLabel(share: number): string {
  const percent = Math.round(share * 100);
  if (percent < 1) return 'Less than 1% of your money is set aside';
  if (percent > 99) return 'More than 99% of your money is set aside';
  return `${percent}% of your money is set aside`;
}
