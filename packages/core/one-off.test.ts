import { describe, expect, it } from 'vitest';

import { createAccountSource } from './account-snapshot';
import { isOneOffId, oneOffAddress, oneOffCode, oneOffContact, oneOffId } from './one-off';
import { encodePaymentCode } from './payment-code';
import { createRecords, type RecordStore } from './records';

const ADDRESS = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const memory = (): RecordStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
};

describe('one-off recipient', () => {
  const code = encodePaymentCode(ADDRESS);

  it('turns a payment code into an id and back to the same address', () => {
    const id = oneOffId(code.toLowerCase().replace(/-/g, ' '));
    expect(id).toBe(`code:${code}`);
    expect(isOneOffId(id!)).toBe(true);
    expect(oneOffAddress(id!)).toBe(ADDRESS);
    expect(oneOffCode(id!)).toBe(code);
  });

  it('refuses a code that does not check out', () => {
    expect(oneOffId('PAY-0000-0000')).toBeNull();
    expect(oneOffAddress('code:PAY-0000')).toBeNull();
    expect(oneOffContact('code:nonsense')).toBeUndefined();
    expect(oneOffAddress('b-mom')).toBeNull();
  });

  it('is shown by the end of its code, never an address', () => {
    const contact = oneOffContact(`code:${code}`)!;
    expect(contact.name).toMatch(/^Payment code · [0-9A-Z]{1,4}$/);
    expect(JSON.stringify(contact)).not.toMatch(/0x/i);
  });

  it('carries a link-supplied payee name and shows it', () => {
    const id = oneOffId(code, 'Ada Lovelace')!;
    expect(isOneOffId(id)).toBe(true);
    // The name rides alongside the code but never changes where money lands.
    expect(oneOffAddress(id)).toBe(ADDRESS);
    expect(oneOffCode(id)).toBe(code);
    const contact = oneOffContact(id)!;
    expect(contact.name).toBe('Ada Lovelace');
    expect(contact.initials).toBe('AL');
    expect(JSON.stringify(contact)).not.toMatch(/0x/i);
  });

  it('safely carries a name with separators or spaces', () => {
    const id = oneOffId(code, '  Corner Shop #2  ')!;
    expect(oneOffAddress(id)).toBe(ADDRESS);
    expect(oneOffContact(id)!.name).toBe('Corner Shop #2');
  });

  it('falls back to the code tail when no name is given', () => {
    const id = oneOffId(code, '   ')!;
    expect(id).toBe(`code:${code}`);
    expect(oneOffContact(id)!.name).toMatch(/^Payment code · /);
  });

  it('is payable through the account source without being saved', async () => {
    const source = createAccountSource({
      records: createRecords(memory(), '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80'),
      getRate: async () => ({ koboPerDollar: 153_000, quotedAt: '2026-09-20T10:00:00.000Z' }),
    });
    expect(source.resolveRecipient(`code:${code}`)).toBe(ADDRESS);
    expect((await source.loadSnapshot()).contacts).toEqual([]);
    expect(() => source.resolveRecipient('code:PAY-BAD')).toThrow("We couldn't find that beneficiary.");
  });
});
