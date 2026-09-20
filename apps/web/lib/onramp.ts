import type { Checkout } from '@entole/core/checkout-link';

import { minorToMajorString } from '@/lib/checkout';

/**
 * The fiat on-ramp seam for the public checkout page.
 *
 * Someone who opens a checkout link without the app can pay from a bank or a
 * card through a payment partner, and the person being paid receives the dollar
 * settlement asset in their Entole account. The partner is not built here — it
 * is a URL. `NEXT_PUBLIC_ONRAMP_URL_TEMPLATE` is that URL with placeholders,
 * and nothing about the flow is pretended until it is set:
 *
 *   https://partner.example/buy?to={address}&amount={amount}&currency={currency}&ref={reference}
 *
 * - `{address}`   where the money lands. It lives only inside the URL — no page
 *                 ever prints it.
 * - `{amount}`    the amount in MAJOR units as a plain decimal string ("1500.00"),
 *                 worked out from integer minor units with integer arithmetic.
 *                 Empty when the link carries no amount, so the payer chooses.
 * - `{currency}`  the ISO 4217 code the amount is in. Empty with no amount.
 * - `{reference}` the invoice number or order reference. May be empty.
 *
 * Every substitution is URL-encoded. The result must be an https URL with no
 * placeholder left unfilled, or the adapter answers `null`: a half-configured
 * partner is treated as no partner, and the page says so honestly.
 *
 * Mercuryo (a Monad hackathon sponsor) or a similar provider slots in here once
 * credentials exist: put its widget URL in the template, or replace the body of
 * `onrampUrlFor` with a signed-URL call if the provider needs one. The page
 * does not change.
 */
export const ONRAMP_TEMPLATE_ENV = 'NEXT_PUBLIC_ONRAMP_URL_TEMPLATE';

type Placeholder = 'address' | 'amount' | 'currency' | 'reference';

export function onrampUrlFor(
  checkout: Checkout,
  // Read at call time on the server. Tests pass a template explicitly.
  template: string | undefined = process.env.NEXT_PUBLIC_ONRAMP_URL_TEMPLATE,
): string | null {
  const pattern = template?.trim();
  if (!pattern) return null;

  const hasAmount = checkout.amountMinor !== undefined;
  const currency = checkout.currency ?? 'NGN';
  const values: Record<Placeholder, string> = {
    address: checkout.address,
    amount: hasAmount ? minorToMajorString(checkout.amountMinor!, currency) : '',
    currency: hasAmount ? currency : '',
    reference: checkout.reference ?? '',
  };

  // One pass, so a value that happens to contain `{amount}` is never expanded.
  const filled = pattern.replace(/\{(address|amount|currency|reference)\}/g, (_match, key: Placeholder) =>
    encodeURIComponent(values[key]),
  );
  // `encodeURIComponent` escapes braces, so any left over are unknown placeholders.
  if (/[{}]/.test(filled)) return null;

  try {
    const url = new URL(filled);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Whether a partner is configured at all — what the receive screen reads to
 * describe, honestly, what a payer without the app will be able to do.
 */
export function onrampConfigured(template: string | undefined = process.env.NEXT_PUBLIC_ONRAMP_URL_TEMPLATE): boolean {
  return Boolean(template?.trim());
}
