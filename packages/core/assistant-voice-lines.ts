import { formatNaira, kobo } from './money';

/**
 * What the assistant says out loud while a payment goes from "get it ready" to
 * "here is your receipt". Every figure in these sentences is one the screen was
 * given by the quote and the receipt, and is passed in: nothing is worked out
 * here, so what is said is always what is on the screen.
 */

const naira = (minor: number) => formatNaira(kobo(minor));

/** Read out when the review is on screen: what is being sent, to whom, at what cost, and the question. */
export function reviewLine(input: { name: string; amountMinor: number; feeMinor: number; totalMinor: number }): string {
  return `Sending ${naira(input.amountMinor)} to ${input.name}. The fee is ${naira(input.feeMinor)}, so ${naira(input.totalMinor)} leaves your account. Shall I send it?`;
}

/** Read out instead, when the account cannot cover the payment and the fee. */
export function notEnoughLine(input: { name: string; totalMinor: number; balanceMinor: number }): string {
  return `You don't have enough for that. With the fee, sending to ${input.name} takes ${naira(input.totalMinor)}, and you have ${naira(input.balanceMinor)}.`;
}

/** Read out once the payment has settled, with the offer that comes next. */
export function sentLine(input: { name: string; amountMinor: number }): string {
  return `Sent. ${naira(input.amountMinor)} has gone to ${input.name}. Want to share the receipt?`;
}

/** The answers to the offers above. */
export const NOT_SENT_LINE = 'Okay, I’ve left it. Nothing was sent.';
export const RECEIPT_LEFT_LINE = 'Alright. You can find it in your activity any time.';
export const STILL_THERE_LINE = 'Say yes when you’re ready, or tap Send yourself.';
