import type { Invoice } from './schemas';

/**
 * Small, pure helpers for the invoices a business sends: the running number,
 * how "due" is chosen, and what status to show. Nothing here touches storage.
 */

/** `INV-0001`, one past the highest number already used — never reused, even
 * after an invoice is removed from the middle. */
export function nextInvoiceReference(existing: readonly Pick<Invoice, 'reference'>[]): string {
  let highest = 0;
  for (const { reference } of existing) {
    const match = /^INV-(\d+)$/.exec(reference ?? '');
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `INV-${String(highest + 1).padStart(4, '0')}`;
}

export type InvoiceDisplayStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'held';

/**
 * What to call an invoice on screen. `overdue` is worked out from the due date
 * — it is never stored, so it can't go stale. An invoice held for a release
 * condition says so instead of pretending to be waiting on the client.
 */
export function invoiceDisplayStatus(invoice: Invoice, now: Date = new Date()): InvoiceDisplayStatus {
  if (invoice.status === 'paid') return 'paid';
  if (invoice.status === 'pending-release') return 'held';
  if (invoice.status === 'draft') return 'draft';
  return new Date(invoice.dueAt).getTime() < now.getTime() ? 'overdue' : 'sent';
}

export const INVOICE_STATUS_LABEL: Record<InvoiceDisplayStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  held: 'Held',
};

/** The end of a local day, as the ISO time an invoice falls due — so "due 14
 * Oct" is still open at 11pm on the 14th. */
export function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 0);
}

/** The due date for "in N days", counted from `now`, at the end of that day. */
export function dueInDays(days: number, now: Date = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return endOfLocalDay(day).toISOString();
}

/** `2026-10-14` — the local calendar day of a due date, for the link. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "14 Oct 2026" — a due date in the words people use. */
export function dueDateLabel(iso: string): string {
  const date = new Date(iso);
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(date);
  return `${date.getDate()} ${month} ${date.getFullYear()}`;
}

/**
 * The weeks of a month for a date picker, Monday first. `null` pads the days
 * that belong to the neighbouring months. `month` is 0-11, as in `Date`.
 */
export function calendarWeeks(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Monday = 0
  const cells: (number | null)[] = [
    ...Array<null>(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let start = 0; start < cells.length; start += 7) weeks.push(cells.slice(start, start + 7));
  return weeks;
}

/** "October 2026" */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}
