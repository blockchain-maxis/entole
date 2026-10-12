import type { Address } from 'viem';

import { usernameHandleSchema } from './directory';
import { decodePaymentCode, encodePaymentCode } from './payment-code';

/**
 * A pay link: the one thing someone shares to be paid.
 *
 * `https://<app>/pay/@ada.eze?…` opens in any browser. It names who is being
 * paid by their username, which the directory turns into a person, and can
 * carry an amount, a reference and a note, so the same link works for "send me
 * money" and for an invoice. The page it opens is where a payer without the
 * app can pay from a bank or card through a payment partner; a payer *with*
 * the app opens it there instead.
 *
 * Nothing is stored behind a link: what it asks for is in the URL. That is the
 * same trust as any payment link: someone who edits it just pays whoever the
 * edited link names. Amounts are integer minor units, and `currency` says
 * which currency they are in (ISO 4217).
 *
 * Links made before usernames named the account by a long code in the path.
 * Those are still read (`parseCheckout`), so a link somebody already has keeps
 * working. Nothing makes one any more.
 */
export type Checkout = {
  /** The account, in the form records keep it. Never put on a screen. */
  code: string;
  address: Address;
  kind: 'pay' | 'invoice';
  amountMinor?: number;
  currency?: string;
  /** Who is being paid, as they want to be shown — a name, never an address. */
  payee?: string;
  /** Their username, when the link named them by it or the directory knows it. */
  username?: string;
  /** An invoice number or order reference. */
  reference?: string;
  note?: string;
  /** ISO date an invoice is due. */
  dueAt?: string;
};

export type CheckoutInput = Omit<Checkout, 'address' | 'code'> & { code: string };

/** What a link asks for, apart from who it is for. */
export type PayRequest = Pick<Checkout, 'kind' | 'amountMinor' | 'currency' | 'reference' | 'note' | 'dueAt'>;

/** A pay link, read: whose it is and what it asks for. */
export type PayLink = PayRequest & { username: string };

const MAX_MINOR = 10_000_000_000_000; // a sanity ceiling, not a limit anyone will meet

function encode(value: string): string {
  return encodeURIComponent(value);
}

/** The `?…` part of a link: what it asks for. A name rides along only when asked. */
function requestQuery(input: Partial<PayRequest>, payee?: string): string {
  const params: string[] = [];
  if (input.kind === 'invoice') params.push('t=invoice');
  if (input.amountMinor !== undefined && Number.isInteger(input.amountMinor) && input.amountMinor > 0) {
    params.push(`a=${input.amountMinor}`);
    if (input.currency) params.push(`c=${encode(input.currency.toUpperCase())}`);
  }
  if (payee?.trim()) params.push(`n=${encode(payee.trim().slice(0, 60))}`);
  if (input.reference?.trim()) params.push(`r=${encode(input.reference.trim().slice(0, 40))}`);
  if (input.note?.trim()) params.push(`m=${encode(input.note.trim().slice(0, 140))}`);
  if (input.dueAt) params.push(`d=${encode(input.dueAt)}`);
  return params.length ? `?${params.join('&')}` : '';
}

/**
 * The link someone shares to be paid: `<base>/pay/@<username>`, with whatever
 * it asks for after it. `null` when the username is not one. No name is put on
 * it: the page asks the directory whose username it is, so the name shown is
 * always the one its owner gave.
 */
export function buildPayLink(base: string, input: Partial<PayRequest> & { username: string }): string | null {
  const username = usernameHandleSchema.safeParse(input.username.trim().replace(/^@/, '').toLowerCase());
  if (!username.success) return null;
  return `${base.replace(/\/$/, '')}/pay/@${username.data}${requestQuery(input)}`;
}

/**
 * A checkout back into a link, for handing a payment on to the app or the send
 * screen. By username whenever one is known. Only a link that arrived in the
 * old form, for an account with no username, leaves in the old form.
 */
export function buildCheckoutLink(base: string, input: CheckoutInput): string | null {
  if (input.username) {
    const link = buildPayLink(base, { ...input, username: input.username });
    if (link) return link;
  }
  const address = decodePaymentCode(input.code);
  if (!address) return null;
  return `${base.replace(/\/$/, '')}/pay/${encodePaymentCode(address)}${requestQuery(input, input.payee)}`;
}

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return undefined;
  }
}

/** The `?…` part of a link, as written, into fields. */
function readQuery(query: string | undefined): Map<string, string> {
  const fields = new Map<string, string>();
  for (const pair of (query ?? '').split('#')[0]!.split('&')) {
    const [key, value] = pair.split('=', 2) as [string, string?];
    const decoded = value === undefined ? undefined : decode(value);
    if (key && decoded !== undefined) fields.set(key, decoded);
  }
  return fields;
}

/** What those fields ask for. Anything that does not read is left out, never guessed. */
function readRequest(fields: Map<string, string>): PayRequest {
  // Plain digits only: `Number()` alone would accept `1e3`, `0x10` and `1_0`.
  const rawAmount = fields.get('a');
  const amount = rawAmount !== undefined && /^\d{1,15}$/.test(rawAmount) ? Number(rawAmount) : NaN;
  const validAmount = Number.isInteger(amount) && amount > 0 && amount <= MAX_MINOR;
  const currency = fields.get('c')?.toUpperCase();

  return {
    kind: fields.get('t') === 'invoice' ? 'invoice' : 'pay',
    ...(validAmount ? { amountMinor: amount } : {}),
    ...(validAmount && currency && /^[A-Z]{3}$/.test(currency) ? { currency } : {}),
    ...(fields.get('r') ? { reference: fields.get('r')!.slice(0, 40) } : {}),
    ...(fields.get('m') ? { note: fields.get('m')!.slice(0, 140) } : {}),
    ...(fields.get('d') ? { dueAt: fields.get('d')! } : {}),
  };
}

/**
 * Reads a pay link into whose it is and what it asks for. Accepts a full URL,
 * a `/pay/@…` path, or an `entole://pay/@…` deep link, so a pasted link, a
 * scanned square and a link opened from another app all go through one door.
 * `null` for anything else. It cannot say whether anyone holds the username;
 * the directory answers that.
 */
export function parsePayLink(input: string): PayLink | null {
  const text = input.trim();
  if (!text || text.length > 2000) return null;

  const [beforeQuery = '', query = ''] = text.split('?', 2) as [string, string?];
  const named = /(?:^|\/)pay\/(?:@|%40)([a-z0-9_.]{3,20})\/?(?:#.*)?$/i.exec(beforeQuery);
  if (!named) return null;
  return { username: named[1]!.toLowerCase(), ...readRequest(readQuery(query)) };
}

/**
 * Reads a link in the old form, the account's code in the path, into what it
 * names. Kept so a link made before usernames still opens. Returns `null` for
 * anything that doesn't carry a valid code, a username link included.
 */
export function parseCheckout(input: string): Checkout | null {
  const text = input.trim();
  if (!text) return null;

  const [beforeQuery = '', query = ''] = text.split('?', 2) as [string, string?];
  const marker = beforeQuery.toLowerCase().lastIndexOf('/pay/');
  const codePart = marker >= 0 ? beforeQuery.slice(marker + '/pay/'.length) : beforeQuery;
  const address = decodePaymentCode(decode(codePart.split('#')[0] ?? '') ?? codePart);
  if (!address) return null;

  const fields = readQuery(query);
  const { kind, amountMinor, currency, ...rest } = readRequest(fields);

  return {
    code: encodePaymentCode(address),
    address,
    kind,
    ...(amountMinor !== undefined ? { amountMinor } : {}),
    ...(currency ? { currency } : {}),
    ...(fields.get('n') ? { payee: fields.get('n')!.slice(0, 60) } : {}),
    ...rest,
  };
}
