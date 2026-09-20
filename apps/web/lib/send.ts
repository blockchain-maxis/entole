import type { Rate } from '@entole/core/fx';
import { formatNaira, kobo, type Naira } from '@entole/core/money';

/**
 * What the send screens check before they let someone press Review. This is the
 * web copy of `apps/mobile/lib/send.ts` — same limits, same words — so the two
 * apps never disagree about what a valid payment is. The per-send limits are the
 * server's: at least $1.00 and at most $10,000, so in the account's own currency
 * they move with the rate. The fee is deliberately not here: it is only known
 * from a quote, and the confirmation sheet handles "not enough once the fee is
 * added".
 *
 * (Both copies want to live in `@entole/core`; that move touches the phone app,
 * so it is left for the pass that owns it.)
 */

const MAX_SEND_DOLLARS = 10_000;

export function sendBounds(rate: Rate): { min: Naira; max: Naira } {
  return { min: kobo(rate.koboPerDollar), max: kobo(MAX_SEND_DOLLARS * rate.koboPerDollar) };
}

export type AmountCheck =
  | { ok: true }
  | {
      ok: false;
      /** `empty` and `no-balance` are states, not mistakes — the screen is
       * quiet about the first and says plainly what the second means. */
      kind: 'empty' | 'no-balance' | 'below-minimum' | 'above-balance' | 'above-maximum';
      reason: string;
    };

export function checkSendAmount(input: { amount: number; balance: number; rate: Rate }): AmountCheck {
  const { amount, balance, rate } = input;
  const { min, max } = sendBounds(rate);

  if (balance <= 0) {
    return { ok: false, kind: 'no-balance', reason: 'You have nothing to send yet.' };
  }
  if (amount <= 0) return { ok: false, kind: 'empty', reason: 'Enter an amount' };
  if (amount < min) {
    return {
      ok: false,
      kind: 'below-minimum',
      reason: `The smallest payment is ${formatNaira(min)}, which is $1.00.`,
    };
  }
  if (amount > balance) {
    return {
      ok: false,
      kind: 'above-balance',
      reason: `That is more than your balance of ${formatNaira(kobo(balance))}.`,
    };
  }
  if (amount > max) {
    return {
      ok: false,
      kind: 'above-maximum',
      reason: `The largest payment is ${formatNaira(max)}, which is $10,000.`,
    };
  }
  return { ok: true };
}

/** "₦1,580 = $1.00" — the rate the quote carries, kept to the kobo. */
export function rateLine(rate: Rate): string {
  return `${formatNaira(kobo(rate.koboPerDollar))} = $1.00`;
}

const NOT_FOR_PEOPLE =
  /\b(wallet|crypto|blockchain|chain|gas|token|on-chain|signature|transaction hash)\b|0x[0-9a-f]{6,}|https?:\/\//i;

/**
 * The message an error already carries, when it is fit to show a person — the
 * gateway and the sponsor server write theirs in plain words. Anything else
 * (a raw network or library failure) gets `fallback`, so a technical message
 * never reaches the screen.
 */
export function plainMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && message.length <= 160 && !NOT_FOR_PEOPLE.test(message)) return message;
  }
  return fallback;
}
