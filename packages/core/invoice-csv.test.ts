import { describe, expect, it } from 'vitest';

import { csvCell, invoiceCsvFilename, invoicesToCsv, minorToDecimal } from './invoice-csv';
import type { Invoice } from './schemas';

const paid: Invoice = {
  id: 'inv-1',
  reference: 'INV-0001',
  clientName: 'Bello Foods',
  amountMinor: 1_500_000,
  note: 'September deliveries',
  dueAt: '2026-10-14T22:59:59.000Z',
  status: 'paid',
  link: 'https://entole.example/pay/x',
  koboPerDollar: 150_000,
  paidAt: '2026-10-02T09:15:00.000Z',
};
const open: Invoice = { ...paid, id: 'inv-2', reference: 'INV-0002', status: 'sent', koboPerDollar: undefined, paidAt: undefined };

describe('minorToDecimal', () => {
  it('writes integer minor units as plain decimals, with no float', () => {
    expect(minorToDecimal(1_500_000)).toBe('15000.00');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(minorToDecimal(0)).toBe('0.00');
    expect(minorToDecimal(-250)).toBe('-2.50');
    expect(minorToDecimal(150_000)).toBe('1500.00');
  });
});

describe('csvCell', () => {
  it('quotes only what needs it', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it.each(['=SUM(A1:A9)', '+1', '-1', '@cmd', '\tx', '\rx'])('neutralises the formula start %j', (value) => {
    expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/);
  });
});

describe('invoicesToCsv', () => {
  it('writes a header and one row per invoice, with the rate and the dollar value at receipt', () => {
    const lines = invoicesToCsv([paid, open]).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Reference,Client,Description,Status,Due date,Paid at,Amount (NGN),Rate at receipt (NGN per USD),Amount at receipt (USD)',
    );
    expect(lines[1]).toBe(
      'INV-0001,Bello Foods,September deliveries,Paid,2026-10-14,2026-10-02,15000.00,1500.00,10.00',
    );
  });

  it('leaves the receipt columns empty for an invoice that has not been paid', () => {
    const line = invoicesToCsv([open]).trimEnd().split('\r\n')[1];
    expect(line).toBe('INV-0002,Bello Foods,September deliveries,Sent,2026-10-14,,15000.00,,');
  });

  it('never lets what a person typed run as a formula', () => {
    const line = invoicesToCsv([{ ...open, clientName: '=HYPERLINK("http://x")', note: '@x' }]).split('\r\n')[1]!;
    expect(line).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(line).toContain(",'@x,");
  });

  it('ends with a line break, can start with a BOM for Excel, and is just the header when empty', () => {
    expect(invoicesToCsv([paid]).endsWith('\r\n')).toBe(true);
    expect(invoicesToCsv([paid], { bom: true }).startsWith('﻿')).toBe(true);
    expect(invoicesToCsv([]).trimEnd().split('\r\n')).toHaveLength(1);
  });

  it('reads an invoice from before numbering existed', () => {
    const { reference: _reference, ...old } = paid;
    expect(invoicesToCsv([old]).split('\r\n')[1]!.startsWith(',Bello Foods')).toBe(true);
  });
});

describe('invoiceCsvFilename', () => {
  it('is dated', () => {
    expect(invoiceCsvFilename(new Date('2026-10-05T12:00:00Z'))).toBe('entole-invoices-2026-10-05.csv');
  });
});
