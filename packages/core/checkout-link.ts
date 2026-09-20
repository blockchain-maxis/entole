import type { Address } from 'viem';

import { decodePaymentCode, encodePaymentCode } from './payment-code';

/**
 * A checkout link: the one thing someone shares to be paid.
 *
 * `https://<app>/pay/PAY-XXXX-…?…` opens in any browser. It names who is being
 * paid (through their payment code — an address is inside it but is never
 * shown), and can carry an amount, a reference and a note, so the same link
 * works for "send me money" and for an invoice. The page it opens is where a
 * payer without the app can pay from a bank or card through a payment partner;
 * a payer *with* the app opens it there instead.
 *
 * There is no server behind a link: everything is in the URL. That is the same
 * trust as any payment link — someone who edits it just pays whoever the edited
 * link names. Amounts are integer minor units, and `currency` says which
 * currency they are in (ISO 4217).
 */
export type Checkout = {
  /** Canonical `PAY-XXXX-…`. */
  code: string;
  address: Address;
  kind: 'pay' | 'invoice';
  amountMinor?: number;
  currency?: string;
  /** Who is being paid, as they want to be shown — a name, never an address. */
  payee?: string;
  /** An invoice number or order reference. */
  reference?: string;
  note?: string;
  /** ISO date an invoice is due. */
  dueAt?: string;
};

export type CheckoutInput = Omit<Checkout, 'address' | 'code'> & { code: string };

const MAX_MINOR = 10_000_000_000_000; // a sanity ceiling, not a limit anyone will meet

function encode(value: string): string {
  return encodeURIComponent(value);
}

/** The shareable link for a payment code, or `null` if the code isn't valid. */
export function buildCheckoutLink(base: string, input: CheckoutInput): string | null {
  const address = decodePaymentCode(input.code);
  if (!address) return null;

  const params: string[] = [];
  if (input.kind === 'invoice') params.push('t=invoice');
  if (input.amountMinor !== undefined && Number.isInteger(input.amountMinor) && input.amountMinor > 0) {
    params.push(`a=${input.amountMinor}`);
    if (input.currency) params.push(`c=${encode(input.currency.toUpperCase())}`);
  }
  if (input.payee?.trim()) params.push(`n=${encode(input.payee.trim().slice(0, 60))}`);
  if (input.reference?.trim()) params.push(`r=${encode(input.reference.trim().slice(0, 40))}`);
  if (input.note?.trim()) params.push(`m=${encode(input.note.trim().slice(0, 140))}`);
  if (input.dueAt) params.push(`d=${encode(input.dueAt)}`);

  const path = `${base.replace(/\/$/, '')}/pay/${encodePaymentCode(address)}`;
  return params.length ? `${path}?${params.join('&')}` : path;
}

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return undefined;
  }
}

/**
 * Reads a checkout link — or a bare payment code — into what it names. Accepts a
 * full URL, a `/pay/…` path, or an `entole://pay/…` deep link, so a pasted link,
 * a scanned QR and a typed code all go through one door. Returns `null` for
 * anything that doesn't carry a valid code.
 */
export function parseCheckout(input: string): Checkout | null {
  const text = input.trim();
  if (!text) return null;

  const [beforeQuery = '', query = ''] = text.split('?', 2) as [string, string?];
  const marker = beforeQuery.toLowerCase().lastIndexOf('/pay/');
  const codePart = marker >= 0 ? beforeQuery.slice(marker + '/pay/'.length) : beforeQuery;
  const address = decodePaymentCode(decode(codePart.split('#')[0] ?? '') ?? codePart);
  if (!address) return null;

  const fields = new Map<string, string>();
  for (const pair of (query ?? '').split('#')[0]!.split('&')) {
    const [key, value] = pair.split('=', 2) as [string, string?];
    const decoded = value === undefined ? undefined : decode(value);
    if (key && decoded !== undefined) fields.set(key, decoded);
  }

  // Plain digits only: `Number()` alone would accept `1e3`, `0x10` and `1_0`.
  const rawAmount = fields.get('a');
  const amount = rawAmount !== undefined && /^\d{1,15}$/.test(rawAmount) ? Number(rawAmount) : NaN;
  const validAmount = Number.isInteger(amount) && amount > 0 && amount <= MAX_MINOR;
  const currency = fields.get('c')?.toUpperCase();

  return {
    code: encodePaymentCode(address),
    address,
    kind: fields.get('t') === 'invoice' ? 'invoice' : 'pay',
    ...(validAmount ? { amountMinor: amount } : {}),
    ...(validAmount && currency && /^[A-Z]{3}$/.test(currency) ? { currency } : {}),
    ...(fields.get('n') ? { payee: fields.get('n')!.slice(0, 60) } : {}),
    ...(fields.get('r') ? { reference: fields.get('r')!.slice(0, 40) } : {}),
    ...(fields.get('m') ? { note: fields.get('m')!.slice(0, 140) } : {}),
    ...(fields.get('d') ? { dueAt: fields.get('d')! } : {}),
  };
}
