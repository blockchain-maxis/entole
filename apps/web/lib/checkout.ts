import { buildCheckoutLink, parseCheckout, type Checkout } from '@entole/core/checkout-link';
import { formatNaira, kobo } from '@entole/core/money';

/**
 * Everything the public checkout page (`/pay/[code]`) needs, kept out of the
 * page so it can be tested without rendering anything.
 *
 * A checkout link is untrusted input from top to bottom: anyone can write one.
 * So the page never reads the URL directly — it hands the path and query to
 * `parseCheckout`, and then this file trims what came back to something safe to
 * put on a screen (no control or direction-override characters, no runaway
 * length, no date that isn't a date).
 */

/** Keeps the parse cheap and stops a pasted novel from becoming a "code". */
const MAX_CODE_LENGTH = 80;
const MAX_QUERY_VALUE_LENGTH = 400;

/** Control characters, zero-width and bidirectional overrides — none of them
 * belong in a name, and the overrides can make a name read backwards. */
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export function cleanText(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return cleaned || undefined;
}

export type QueryInput = Record<string, string | string[] | undefined>;

/**
 * Rebuilds the checkout from what the router hands the page. Returns `null`
 * for anything that does not carry a valid payment code — the caller shows a
 * calm "this link isn't valid" page and echoes nothing back.
 */
export function checkoutFromRequest(code: string, query: QueryInput = {}): Checkout | null {
  if (!code || code.length > MAX_CODE_LENGTH) return null;

  const pairs = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string') pairs.set(key, value.slice(0, MAX_QUERY_VALUE_LENGTH));
  }
  const text = `/pay/${encodeURIComponent(code)}${pairs.size ? `?${pairs.toString()}` : ''}`;

  const parsed = parseCheckout(text);
  if (!parsed) return null;

  const payee = cleanText(parsed.payee, 60);
  const reference = cleanText(parsed.reference, 40);
  const note = cleanText(parsed.note, 140);
  const dueAt = parsed.dueAt && parseDue(parsed.dueAt) ? parsed.dueAt : undefined;

  // A currency that was given but is not one is not "naira by default": the
  // amount is dropped rather than read in a currency nobody named.
  const rawCurrency = Array.isArray(query.c) ? query.c[0] : query.c;
  const unreadableCurrency = Boolean(rawCurrency?.trim()) && !parsed.currency;
  // Plain digits only: the core parse goes through `Number`, which would also
  // accept "1e3" or "0x10" as amounts.
  const rawAmount = Array.isArray(query.a) ? query.a[0] : query.a;
  const plainDigits = typeof rawAmount === 'string' && /^\d{1,14}$/.test(rawAmount);
  const amountMinor = unreadableCurrency || !plainDigits ? undefined : parsed.amountMinor;

  return {
    code: parsed.code,
    address: parsed.address,
    kind: parsed.kind,
    ...(amountMinor !== undefined ? { amountMinor } : {}),
    // An amount with no currency at all is read in the account currency,
    // naira — the only currency the app builds links in.
    ...(amountMinor !== undefined ? { currency: parsed.currency ?? 'NGN' } : {}),
    ...(payee ? { payee } : {}),
    ...(reference ? { reference } : {}),
    ...(note ? { note } : {}),
    ...(dueAt ? { dueAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// Amounts. Integer minor units in, strings out; nothing here divides into a
// float. `Math.trunc(minor / 10**e)` and `minor % 10**e` are exact for any
// safe integer, and `parseCheckout` caps amounts far below 2**53.
// ---------------------------------------------------------------------------

const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** How many minor-unit digits an ISO 4217 currency has. */
export function currencyExponent(currency: string): 0 | 2 | 3 {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Minor units as a plain decimal string in major units — "1500.00", "0.05",
 * "1500" for a zero-decimal currency. No grouping, no symbol: this is the form
 * a payment partner's URL expects.
 */
export function minorToMajorString(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Money must be a whole number of minor units');
  const exponent = currencyExponent(currency);
  if (exponent === 0) return String(minor);
  const unit = 10 ** exponent;
  const whole = Math.trunc(minor / unit);
  const fraction = String(minor % unit).padStart(exponent, '0');
  return `${whole}.${fraction}`;
}

/** "₦15,000" for naira; "1,500.00 USD" for any other currency. */
export function formatCheckoutAmount(minor: number, currency: string): string {
  if (currency.toUpperCase() === 'NGN') return formatNaira(kobo(minor));
  const [whole = '0', fraction] = minorToMajorString(minor, currency).split('.');
  return `${groupThousands(whole)}${fraction ? `.${fraction}` : ''} ${currency.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Dates. An invoice's due date is a calendar day in Nigeria, so "today" is
// too — a visitor's own timezone must not turn a due invoice into an overdue
// one.
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since the epoch for a `YYYY-MM-DD` string, or `null` if it isn't a real date. */
function dayNumber(value: string): number | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return ms / 86_400_000;
}

/** The calendar day of a due value: a bare date stays as written; a full
 * timestamp is read as the Lagos day it falls on. */
function parseDue(value: string): { day: number; iso: string } | null {
  const bare = dayNumber(value);
  if (bare !== null) return { day: bare, iso: value };
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const iso = lagosDay(new Date(stamp));
  const day = dayNumber(iso);
  return day === null ? null : { day, iso };
}

function lagosDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(now);
}

const LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export type DueState = {
  /** "Due 1 October 2026", "Due today", "Overdue by 3 days". */
  label: string;
  /** The date itself, for a definition row: "1 October 2026". */
  date: string;
  overdue: boolean;
};

/** Where an invoice stands against the calendar, worked out at request time. */
export function dueState(dueAt: string | undefined, now: Date = new Date()): DueState | null {
  if (!dueAt) return null;
  const due = parseDue(dueAt);
  const today = dayNumber(lagosDay(now));
  if (!due || today === null) return null;

  const date = LONG_DATE.format(new Date(due.day * 86_400_000));
  const late = today - due.day;
  if (late > 0) {
    return { label: `Overdue by ${late} ${late === 1 ? 'day' : 'days'}`, date, overdue: true };
  }
  if (late === 0) return { label: 'Due today', date, overdue: false };
  return { label: `Due ${date}`, date, overdue: false };
}

// ---------------------------------------------------------------------------
// Links and copy.
// ---------------------------------------------------------------------------

const PLACEHOLDER_ORIGIN = 'https://entole.invalid';

/** `/pay/PAY-…?…` — the checkout rebuilt from what was parsed, never echoed. */
export function checkoutPath(checkout: Checkout): string {
  const link = buildCheckoutLink(PLACEHOLDER_ORIGIN, checkout);
  return link ? link.slice(PLACEHOLDER_ORIGIN.length) : `/pay/${checkout.code}`;
}

/** `entole://pay/PAY-…?…` — opens the phone app on this payment. */
export function appLinkFor(checkout: Checkout): string {
  return `entole:/${checkoutPath(checkout)}`;
}

/** The same payment, continued in the web app (`/transfer/send`). */
export function browserSendPathFor(checkout: Checkout): string {
  return `/transfer/send?to=${encodeURIComponent(checkoutPath(checkout))}`;
}

/** The last group of the code — a label, never enough to be anything else. */
export function codeLabel(checkout: Checkout): string {
  return checkout.code.split('-').slice(-1)[0] ?? checkout.code;
}

/** Who is being paid, as the page names them. */
export function payeeName(checkout: Checkout): string {
  return checkout.payee ?? 'this person';
}

export function checkoutTitle(checkout: Checkout): string {
  if (checkout.kind === 'invoice') {
    const from = checkout.payee ? ` from ${checkout.payee}` : '';
    return checkout.reference
      ? `Invoice ${checkout.reference}${from} — Entole`
      : `Invoice${from || ''} — Entole`;
  }
  return `Pay ${payeeName(checkout)} — Entole`;
}

export function checkoutDescription(checkout: Checkout): string {
  const amount =
    checkout.amountMinor !== undefined
      ? formatCheckoutAmount(checkout.amountMinor, checkout.currency ?? 'NGN')
      : null;
  if (checkout.kind === 'invoice') {
    return amount
      ? `${amount} due${checkout.payee ? ` to ${checkout.payee}` : ''}. Pay this invoice with Entole.`
      : 'Pay this invoice with Entole.';
  }
  return amount
    ? `Pay ${payeeName(checkout)} ${amount} with Entole.`
    : `Pay ${payeeName(checkout)} with Entole.`;
}

/** The amount a link asks for, in kobo — only when it is in naira, the one
 * currency the send flow can pre-fill. */
export function nairaAmountOf(checkout: Checkout): number | undefined {
  if (checkout.amountMinor === undefined) return undefined;
  return (checkout.currency ?? 'NGN') === 'NGN' ? checkout.amountMinor : undefined;
}
