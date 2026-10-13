import { cents, formatDollars, formatNaira, formatNairaDigits, kobo } from './money';
import { paymentReference, type KeptPayment, type SettledPaymentReport } from './payments-feed';
import type { Receipt } from './schemas';

/**
 * The receipt as a slip: one piece of paper for a payment that was delivered,
 * the same wherever it is drawn. As a picture (`/api/receipt/<reference>/image`),
 * as a page anyone sent the link can open (`/receipt/<reference>`), and inside
 * both apps.
 *
 * The picture and the page are drawn from one thing only: the payment the
 * server kept under that reference, which it read from the network when the
 * payment settled. Nothing here takes an amount or a name from anywhere else,
 * so a slip cannot be made for a payment that did not happen.
 */

/** The reference a receipt prints: twelve characters, as `paymentReference` makes them. */
const REFERENCE = /^[0-9A-Fa-f]{12}$/;

export function isReceiptReference(text: string): boolean {
  return REFERENCE.test(text);
}

/** `/receipt/3F9A2B7C1D4E`: the page for one receipt. `null` for anything that is not a reference. */
export function receiptPath(reference: string): string | null {
  return isReceiptReference(reference) ? `/receipt/${reference.toUpperCase()}` : null;
}

/** `/api/receipt/3F9A2B7C1D4E/image`: the same receipt as a picture. */
export function receiptImagePath(reference: string): string | null {
  return isReceiptReference(reference) ? `/api/receipt/${reference.toUpperCase()}/image` : null;
}

const join = (base: string, path: string | null) => (path ? `${base.replace(/\/$/, '')}${path}` : null);

/** The link that is shared: it opens the receipt's page, and unfurls as its picture. */
export function receiptLink(base: string, reference: string): string | null {
  return join(base, receiptPath(reference));
}

export function receiptImageLink(base: string, reference: string): string | null {
  return join(base, receiptImagePath(reference));
}

/** Where a slip says it can be checked, as words: `entole.pro/receipt/3F9A2B7C1D4E`. */
export function receiptCheckLine(base: string, reference: string): string | null {
  const link = receiptLink(base, reference);
  return link ? link.replace(/^https?:\/\//, '') : null;
}

/** What a file of the picture is called when it is saved or shared. */
export function receiptFileName(reference: string): string {
  return `entole-receipt-${reference.toUpperCase()}.png`;
}

/**
 * What is passed on when the picture itself cannot be: the receipt in words,
 * and under them its link, which opens the slip and shows as its picture in a
 * chat. The link only goes when the server is known to have kept this
 * payment. A link to a receipt that is not there would be worse than none,
 * and the words say what happened either way.
 */
export function receiptWords(input: { words: string; base: string; reference: string; kept: boolean }): string {
  const link = input.kept ? receiptLink(input.base, input.reference) : null;
  return link ? `${input.words}\n${link}` : input.words;
}

/** Someone on a slip. Never an account: a name, and a username when there is one. */
export type SlipParty = { name: string; username?: string };

/** Who a slip names when the directory had no name for them. */
export const UNNAMED_PARTY = 'Entole account';

export type SlipFacts = {
  reference: string;
  /** The figure the slip is about: naira when the server could put one on it, else dollars. */
  figure: { symbol: string; digits: string; words: string };
  /** What arrived, in dollars. `null` when dollars are already the figure. */
  arrived: string | null;
  from: SlipParty;
  to: SlipParty;
  /** When it was delivered, on a Lagos clock: "12 Oct 2026" and "5:00 PM". */
  delivered: { date: string; time: string };
  note?: string;
};

export const SLIP_ZONE = 'Africa/Lagos';
/** How the slip names that clock. */
export const SLIP_ZONE_WORDS = 'Lagos time';

// Times use en-US only because en-NG lower-cases the day period (see `format.ts`).
const SLIP_DATE = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: SLIP_ZONE,
});
const SLIP_TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: SLIP_ZONE,
});

function party(name: string | undefined, username: string | undefined): SlipParty {
  return { name: name?.trim() || UNNAMED_PARTY, ...(username ? { username: `@${username}` } : {}) };
}

/** The settlement asset's base units as cents, rounded to the nearest. */
function centsOf(amountToken: string, tokenDecimals: number): number {
  const units = BigInt(amountToken);
  if (tokenDecimals <= 2) return Number(units * 10n ** BigInt(2 - tokenDecimals));
  const perCent = 10n ** BigInt(tokenDecimals - 2);
  return Number((units + perCent / 2n) / perCent);
}

/**
 * Everything a slip says about a kept payment, as words ready to set. No
 * account and no payment hash is among them: there is nothing here to leak
 * onto a slip by mistake.
 */
export function slipFacts(payment: KeptPayment, options: { tokenDecimals: number }): SlipFacts {
  const dollars = formatDollars(cents(centsOf(payment.amountToken, options.tokenDecimals)));
  const at = new Date(payment.at);
  const naira = payment.amountMinor;

  return {
    reference: paymentReference(payment.hash),
    figure:
      naira !== undefined
        ? { symbol: '₦', digits: formatNairaDigits(kobo(naira)), words: formatNaira(kobo(naira)) }
        : { symbol: '$', digits: dollars.slice(1), words: dollars },
    arrived: naira !== undefined ? dollars : null,
    from: party(payment.fromName, payment.fromUsername),
    to: party(payment.toName, payment.toUsername),
    delivered: { date: SLIP_DATE.format(at), time: SLIP_TIME.format(at) },
    ...(payment.note ? { note: payment.note } : {}),
  };
}

/** "₦5,000 from Ada Eze to Tunde Bello, delivered 12 Oct 2026": a slip in one line, for a title or a picture's description. */
export function slipSummary(facts: SlipFacts): string {
  return `${facts.figure.words} from ${facts.from.name} to ${facts.to.name}, delivered ${facts.delivered.date}`;
}

/** The payment an in-app receipt is for. A receipt's id is `rc-<the payment>`. */
export function paymentOfReceipt(receiptId: string): `0x${string}` | null {
  const hash = receiptId.startsWith('rc-') ? receiptId.slice(3) : '';
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? (hash as `0x${string}`) : null;
}

/** The note an activity entry carries when the sender wrote none. */
const NO_NOTE = 'Sent';

/**
 * What the sender's app tells the server about a delivered payment, said
 * again. The app says it once when the payment settles, without waiting to
 * hear back, so the server may not have it yet when the receipt is shared.
 * Saying it twice is harmless: a payment is kept once. It carries the same
 * note and the same figure as the first telling, so whichever arrives first
 * keeps the same thing.
 */
export function reportForReceipt(receipt: Receipt, note?: string): SettledPaymentReport | null {
  const hash = paymentOfReceipt(receipt.id);
  if (!hash) return null;
  const words = note?.trim();
  return {
    hash,
    ...(words && words !== NO_NOTE ? { note: words } : {}),
    amountMinor: receipt.amountMinor,
    koboPerDollar: receipt.koboPerDollar,
  };
}
