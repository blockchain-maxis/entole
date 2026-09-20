import { describe, expect, it } from 'vitest';

import {
  calendarWeeks,
  dueDateLabel,
  dueInDays,
  invoiceDisplayStatus,
  localDay,
  monthLabel,
  nextInvoiceReference,
} from './invoices';
import type { Invoice } from './schemas';

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-1',
  clientName: 'Bello Foods',
  amountMinor: 5_000_000,
  note: 'Deliveries',
  dueAt: '2026-10-14T22:59:59.000Z',
  status: 'sent',
  link: 'https://x/pay/y',
  ...over,
});

describe('invoice numbers', () => {
  it('starts at INV-0001 and counts up', () => {
    expect(nextInvoiceReference([])).toBe('INV-0001');
    expect(nextInvoiceReference([{ reference: 'INV-0001' }, { reference: 'INV-0002' }])).toBe('INV-0003');
  });

  it('goes past the highest number, so a removed invoice never frees its number', () => {
    expect(nextInvoiceReference([{ reference: 'INV-0007' }, { reference: 'INV-0002' }])).toBe('INV-0008');
  });

  it('ignores anything that is not one of ours', () => {
    expect(nextInvoiceReference([{}, { reference: 'PO-9' }, { reference: 'INV-abc' }])).toBe('INV-0001');
    expect(nextInvoiceReference([{ reference: 'INV-12345' }])).toBe('INV-12346');
  });
});

describe('invoice status', () => {
  const now = new Date('2026-10-01T09:00:00.000Z');

  it('is Sent until the due date passes, then Overdue', () => {
    expect(invoiceDisplayStatus(invoice(), now)).toBe('sent');
    expect(invoiceDisplayStatus(invoice({ dueAt: '2026-09-30T22:59:59.000Z' }), now)).toBe('overdue');
  });

  it('a paid invoice is Paid however late it was', () => {
    expect(invoiceDisplayStatus(invoice({ status: 'paid', dueAt: '2020-01-01T00:00:00.000Z' }), now)).toBe('paid');
  });

  it('says Held for a release condition and Draft for a draft, never Overdue', () => {
    const late = '2020-01-01T00:00:00.000Z';
    expect(invoiceDisplayStatus(invoice({ status: 'pending-release', dueAt: late }), now)).toBe('held');
    expect(invoiceDisplayStatus(invoice({ status: 'draft', dueAt: late }), now)).toBe('draft');
  });
});

describe('due dates', () => {
  it('"in 14 days" falls due at the end of that local day', () => {
    const now = new Date(2026, 8, 20, 9, 30); // 20 Sep 2026, local
    const due = new Date(dueInDays(14, now));
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2026, 9, 4]);
    expect([due.getHours(), due.getMinutes()]).toEqual([23, 59]);
  });

  it('crosses month and year ends', () => {
    const due = new Date(dueInDays(30, new Date(2026, 11, 15, 12)));
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2027, 0, 14]);
  });

  it('writes the day for a link and for a person', () => {
    const iso = new Date(2026, 9, 4, 23, 59, 59).toISOString();
    expect(localDay(iso)).toBe('2026-10-04');
    expect(dueDateLabel(iso)).toBe('4 Oct 2026');
  });
});

describe('the date picker calendar', () => {
  it('lays out October 2026 Monday first: the 1st is a Thursday', () => {
    const weeks = calendarWeeks(2026, 9);
    expect(weeks[0]).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(weeks.at(-1)).toEqual([26, 27, 28, 29, 30, 31, null]);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it('knows a leap February and a month that starts on a Monday', () => {
    expect(calendarWeeks(2028, 1).flat().filter(Boolean)).toHaveLength(29);
    expect(calendarWeeks(2026, 5)[0]![0]).toBe(1); // 1 June 2026 is a Monday
  });

  it('names the month for the header', () => {
    expect(monthLabel(2026, 9)).toBe('October 2026');
  });
});
