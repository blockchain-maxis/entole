import { z } from 'zod';

import type { Invoice } from './schemas';
import type { MovementState, PayInSourceId } from './intents-pockets';

/**
 * Invoices paid from another network, through NEAR Intents.
 *
 * The client opens the invoice link, picks what they hold ("USDT on Tron"),
 * and gets a one-time scan code. 1Click turns whatever they send into exactly
 * the invoice's value in dollars (USDC), delivered into the business's own
 * NEAR Intents account: their Dollars pocket. The invoice is in naira; it is
 * priced in dollars at the live rate when the code is made.
 *
 * The business's app asks which payments were made towards each of its open
 * invoices and marks one paid only when 1Click says the money arrived. Not
 * when it was sent, not when it is on its way.
 */

export const invoicePaymentStateSchema = z.object({
  source: z.string(),
  cents: z.number().int().nonnegative(),
  state: z.enum(['waiting', 'on_its_way', 'done', 'too_little', 'returned', 'failed']),
  at: z.string(),
  reference: z.string().nullable(),
});
export type InvoicePaymentState = z.infer<typeof invoicePaymentStateSchema>;

export const invoicePaymentsAnswerSchema = z.object({ payments: z.array(invoicePaymentStateSchema).max(20) });

/** The exact text the business's app signs to ask after its invoices' payments. */
export function buildInvoicePaysMessage(input: { account: string; timestampSeconds: number; references: readonly string[] }): string {
  return [
    'Entole invoice payments',
    `account: ${input.account.toLowerCase()}`,
    `invoices: ${[...input.references].map((ref) => ref.toUpperCase()).sort().join(',')}`,
    `timestamp: ${input.timestampSeconds}`,
  ].join('\n');
}

export const INVOICE_PAYS_MAX_AGE_SECONDS = 300;

/**
 * The payment that settles an invoice: the first that arrived. An invoice is
 * never settled by a payment still on its way.
 */
export function settlingPayment(payments: readonly InvoicePaymentState[]): InvoicePaymentState | null {
  return payments.filter((payment) => payment.state === 'done').sort((a, b) => a.at.localeCompare(b.at))[0] ?? null;
}

/** Open invoices that can be paid this way: sent, unpaid, with a reference. */
export function invoicesToFollow(invoices: readonly Invoice[]): Invoice[] {
  return invoices.filter((invoice) => invoice.status === 'sent' && invoice.reference);
}

/** USD cents for a naira amount at kobo-per-dollar, rounded up so the invoice is never short. */
export function invoiceCents(amountMinor: number, koboPerDollar: number): number {
  if (!(koboPerDollar > 0)) throw new Error('no rate');
  return Math.ceil((amountMinor * 100) / koboPerDollar);
}

export const MOVEMENT_FOR_PAYER: Record<MovementState, string> = {
  waiting: 'Waiting for your payment',
  on_its_way: 'Payment seen, on its way',
  done: 'Paid. Thank you',
  too_little: 'Less arrived than the invoice. It is held for them, and they can send it back',
  returned: 'Sent back',
  failed: 'Did not go through. It is held for them, and they can send it back',
};

export type { PayInSourceId };
