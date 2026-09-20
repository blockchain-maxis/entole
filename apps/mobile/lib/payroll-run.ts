import type { Rate } from '@entole/core/fx';
import { formatNaira, kobo } from '@entole/core/money';

import { plainMessage, sendBounds } from './send';

/**
 * Paying a team in one go, without pretending anything happened early.
 *
 * This file is the rules of a payroll run, kept free of React so they can be
 * tested: what each line is checked against, what the total and the fees add up
 * to, and the runner that pays one person at a time. The runner only ever marks
 * a line `settled` after the payment has resolved — there is no optimistic
 * state, and a failure is the plain message it came with.
 */

export type RunLine = {
  id: string;
  name: string;
  /** `PAY-XXXX-…` */
  code: string;
  amountMinor: number;
};

export type PayState =
  | { status: 'waiting' }
  | { status: 'paying' }
  | { status: 'settled'; receiptId: string; feeMinor: number }
  | { status: 'failed'; message: string };

/** What is wrong with one line's amount, in plain words, or `null` when it can be paid. */
export function lineProblem(amountMinor: number, rate: Rate): string | null {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return 'Set an amount';
  const { min, max } = sendBounds(rate);
  if (amountMinor < min) return `At least ${formatNaira(min)} ($1.00)`;
  if (amountMinor > max) return `At most ${formatNaira(max)} ($10,000)`;
  return null;
}

/** Fees by payment amount, as the quotes came back. */
export type FeeBook = ReadonlyMap<number, number>;

export type Totals = {
  payMinor: number;
  /** `null` until every line's fee is known — a half-added fee is not shown. */
  feeMinor: number | null;
  totalMinor: number | null;
};

export function planTotals(lines: readonly RunLine[], fees: FeeBook | null): Totals {
  const payMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  if (!fees) return { payMinor, feeMinor: null, totalMinor: null };
  let feeMinor = 0;
  for (const line of lines) {
    const fee = fees.get(line.amountMinor);
    if (fee === undefined) return { payMinor, feeMinor: null, totalMinor: null };
    feeMinor += fee;
  }
  return { payMinor, feeMinor, totalMinor: payMinor + feeMinor };
}

export type Affordability =
  | { state: 'unknown' }
  | { state: 'enough' }
  | { state: 'short'; shortByMinor: number };

/** Total plus fees against the balance. Unknown while the fees are still coming. */
export function affordability(totalMinor: number | null, balanceMinor: number): Affordability {
  if (totalMinor === null) return { state: 'unknown' };
  return totalMinor <= balanceMinor
    ? { state: 'enough' }
    : { state: 'short', shortByMinor: totalMinor - balanceMinor };
}

/** The payment gateway's own words for running out of money. */
export function isNotEnough(error: unknown): boolean {
  return error instanceof Error && /enough|more than your balance/i.test(error.message);
}

export const NOT_ENOUGH_MESSAGE = "You don't have enough for this payment and its fee.";
const FALLBACK_MESSAGE = "That payment didn't go through. Nothing was taken.";

export type RunOutcome = {
  /** True when the run stopped because the money ran out, leaving the rest waiting. */
  stoppedForBalance: boolean;
};

/**
 * Pays `lines` one after another. A line goes `paying` when its turn starts and
 * `settled` only after `send` has resolved with a receipt. A failure marks that
 * line failed with its message and moves on to the next — except running out of
 * money, which stops the run and leaves everyone after that person untouched
 * (still `waiting`), so a top-up and "retry" pays exactly them.
 */
export async function runPayroll(options: {
  lines: readonly RunLine[];
  send: (line: RunLine) => Promise<{ id: string; feeMinor: number }>;
  onState: (id: string, state: PayState) => void;
}): Promise<RunOutcome> {
  const { lines, send, onState } = options;
  for (const line of lines) {
    onState(line.id, { status: 'paying' });
    try {
      const receipt = await send(line);
      onState(line.id, { status: 'settled', receiptId: receipt.id, feeMinor: receipt.feeMinor });
    } catch (error) {
      if (isNotEnough(error)) {
        onState(line.id, { status: 'failed', message: NOT_ENOUGH_MESSAGE });
        return { stoppedForBalance: true };
      }
      onState(line.id, { status: 'failed', message: plainMessage(error, FALLBACK_MESSAGE) });
    }
  }
  return { stoppedForBalance: false };
}

/** The lines still to pay: everyone who has not settled. Used by "Retry". */
export function unsettled(lines: readonly RunLine[], states: Readonly<Record<string, PayState>>): RunLine[] {
  return lines.filter((line) => states[line.id]?.status !== 'settled');
}

export type RunSummary = {
  settled: number;
  failed: number;
  waiting: number;
  paidMinor: number;
  feeMinor: number;
};

export function summarise(lines: readonly RunLine[], states: Readonly<Record<string, PayState>>): RunSummary {
  const summary: RunSummary = { settled: 0, failed: 0, waiting: 0, paidMinor: 0, feeMinor: 0 };
  for (const line of lines) {
    const state = states[line.id];
    if (state?.status === 'settled') {
      summary.settled += 1;
      summary.paidMinor += line.amountMinor;
      summary.feeMinor += state.feeMinor;
    } else if (state?.status === 'failed') {
      summary.failed += 1;
    } else {
      summary.waiting += 1;
    }
  }
  return summary;
}

/** "3 people" / "1 person". */
export function peopleWords(count: number): string {
  return `${count} ${count === 1 ? 'person' : 'people'}`;
}

/** What "how much left" reads as once the fees are in: the shortfall in naira. */
export function shortByWords(shortByMinor: number): string {
  return formatNaira(kobo(shortByMinor));
}
