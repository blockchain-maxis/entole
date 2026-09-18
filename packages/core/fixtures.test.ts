import { describe, expect, it } from 'vitest';

import { SNAPSHOT } from './fixtures';
import { naira } from './money';
import { snapshotSchema } from './schemas';

/**
 * The demo data is the shape the gateway promises. If the schema and the
 * fixtures drift apart, the app fails here rather than on a judge's phone.
 */
describe('snapshot', () => {
  const snapshot = snapshotSchema.parse(SNAPSHOT);

  it('parses', () => {
    expect(snapshot.allowances).toHaveLength(3);
    expect(snapshot.contacts.length).toBeGreaterThan(0);
  });

  it('matches the balance in the design', () => {
    expect(snapshot.account.balanceMinor).toBe(naira(1_284_500));
  });

  it('points every allowance and activity entry at a real person', () => {
    const ids = new Set(snapshot.contacts.map((contact) => contact.id));
    for (const allowance of snapshot.allowances) expect(ids.has(allowance.recipientId)).toBe(true);
    for (const entry of snapshot.activity) expect(ids.has(entry.contactId)).toBe(true);
  });

  it('points every allowance-backed payment at an allowance that exists', () => {
    const ids = new Set(snapshot.allowances.map((allowance) => allowance.id));
    for (const entry of snapshot.activity) {
      if (entry.allowanceId) expect(ids.has(entry.allowanceId)).toBe(true);
    }
    expect(ids.has(snapshot.proposal.allowanceId)).toBe(true);
  });

  it('keeps every amount in whole minor units', () => {
    const amounts = [
      snapshot.account.balanceMinor,
      ...snapshot.allowances.flatMap((a) => [a.limitMinor, a.spentMinor, a.perRunMinor]),
      ...snapshot.activity.map((entry) => entry.amountMinor),
    ];
    for (const amount of amounts) expect(Number.isInteger(amount)).toBe(true);
  });

  it('never lets a pot collect more than its target', () => {
    for (const pot of snapshot.pots) {
      expect(pot.collectedMinor).toBeLessThanOrEqual(pot.targetMinor);
    }
  });

  it('points every seat at a real person', () => {
    const ids = new Set(snapshot.contacts.map((contact) => contact.id));
    for (const seat of snapshot.seats) expect(ids.has(seat.contactId)).toBe(true);
  });

  it('never lets a non-spending seat carry a cap', () => {
    for (const seat of snapshot.seats) {
      if (seat.role !== 'officer') {
        expect(seat.limitMinor).toBe(0);
        expect(seat.perRunMinor).toBe(0);
      }
    }
  });

  it('points every tax reserve at an invoice that exists', () => {
    const ids = new Set(snapshot.invoices.map((invoice) => invoice.id));
    for (const reserve of snapshot.taxReserves) {
      if (reserve.sourceInvoiceId) expect(ids.has(reserve.sourceInvoiceId)).toBe(true);
    }
  });

  it('never marks an invoice paid without a paid timestamp', () => {
    for (const invoice of snapshot.invoices) {
      if (invoice.status === 'paid') expect(invoice.paidAt).toBeDefined();
    }
  });
});
