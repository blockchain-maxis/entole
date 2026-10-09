import type { Invoice } from './schemas';

/**
 * Invoices as a CSV an accountant can open: one row per invoice, with the
 * exchange rate fixed at the moment the money was received. That rate is the
 * point of the export: the naira amount and its dollar value on the day it
 * landed are what a bookkeeper has to book.
 *
 * Pure and platform-free (core may not import a platform). Amounts are integer
 * minor units until the last step, where they are written as plain decimals
 * (`15000.00`, no currency symbol, no thousands separator) because a
 * spreadsheet must be able to add them up. Free text a person typed (a client's
 * name, a note) is neutralised against spreadsheet formula injection: a cell
 * that begins with `=`, `+`, `-`, `@`, a tab or a carriage return gets a
 * leading apostrophe, so opening the file can never run anything.
 */

export const INVOICE_CSV_COLUMNS = [
  'Reference',
  'Client',
  'Description',
  'Status',
  'Due date',
  'Paid at',
  'Amount (NGN)',
  'Rate at receipt (NGN per USD)',
  'Amount at receipt (USD)',
] as const;

/** Integer minor units as a plain two-decimal string. Never a float. */
export function minorToDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Dollar cents for a naira amount at a rate, the same rounding the receipt uses. */
function usdCents(amountKobo: number, koboPerDollar: number): number {
  return Math.round((amountKobo * 100) / koboPerDollar);
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula-safe, quoted only when it has to be. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function row(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

const STATUS_WORDS: Record<Invoice['status'], string> = {
  draft: 'Draft',
  sent: 'Sent',
  'pending-release': 'Held for release',
  paid: 'Paid',
};

/** The date part of an ISO timestamp, `YYYY-MM-DD`, as written (UTC). */
function day(iso: string): string {
  return iso.slice(0, 10);
}

export function invoicesToCsv(invoices: readonly Invoice[], options: { bom?: boolean } = {}): string {
  const lines = [row([...INVOICE_CSV_COLUMNS])];
  for (const invoice of invoices) {
    const received = invoice.status === 'paid' && invoice.koboPerDollar;
    lines.push(
      row([
        invoice.reference ?? '',
        invoice.clientName,
        invoice.note,
        STATUS_WORDS[invoice.status],
        day(invoice.dueAt),
        invoice.paidAt ? day(invoice.paidAt) : '',
        minorToDecimal(invoice.amountMinor),
        received ? minorToDecimal(invoice.koboPerDollar!) : '',
        received ? minorToDecimal(usdCents(invoice.amountMinor, invoice.koboPerDollar!)) : '',
      ]),
    );
  }
  // CRLF is what RFC 4180 and Excel expect. The BOM makes Excel read UTF-8.
  return `${options.bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}

/** `entole-invoices-2026-10-05.csv`, from the device's own date. */
export function invoiceCsvFilename(now: Date = new Date()): string {
  return `entole-invoices-${now.toISOString().slice(0, 10)}.csv`;
}
