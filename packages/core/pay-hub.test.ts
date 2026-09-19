import { describe, expect, it } from 'vitest';

import { SNAPSHOT } from './fixtures';
import { BILL_CATEGORIES, billCategory, corridorsFor } from './pay-hub';
import { snapshotSchema } from './schemas';

describe('pay-hub', () => {
  const { contacts } = snapshotSchema.parse(SNAPSHOT);

  it('offers exactly the four generic bill categories, each with an identifier label', () => {
    expect(BILL_CATEGORIES.map((category) => category.id)).toEqual([
      'electricity',
      'airtime-data',
      'cable-tv',
      'internet',
    ]);
    for (const category of BILL_CATEGORIES) expect(category.identifierLabel.length).toBeGreaterThan(0);
  });

  it('looks a category up by id and returns undefined for an unknown one', () => {
    expect(billCategory('cable-tv')?.label).toBe('Cable TV');
    expect(billCategory('nope')).toBeUndefined();
    expect(billCategory(undefined)).toBeUndefined();
  });

  it('lists only corridors a real fixture contact is on the other end of', () => {
    const corridors = corridorsFor(contacts);
    expect(corridors.map((corridor) => corridor.id)).toEqual(['uk']);
    expect(corridors[0]?.contacts.map((contact) => contact.id)).toEqual(['c-emeka']);
  });

  it('never lists a domestic contact as an abroad corridor', () => {
    const domestic = contacts.filter((contact) => contact.id !== 'c-emeka');
    expect(corridorsFor(domestic)).toEqual([]);
  });

  it('reads the city before the first separator of a place', () => {
    const contact = { ...contacts[0]!, id: 'c-x', place: 'London · Barclays' };
    expect(corridorsFor([contact]).map((corridor) => corridor.id)).toEqual(['uk']);
  });
});
