import { describe, expect, it } from 'vitest';

import { createAccountSource } from './account-snapshot';
import { createRecords, type Beneficiary, type RecordStore } from './records';

const memory = (): RecordStore => {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
};

const OWNER = '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80' as const;
const MOM = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const rate = { koboPerDollar: 153_000, quotedAt: '2026-09-20T10:00:00.000Z' };

const mom: Beneficiary = {
  id: 'b-mom',
  name: 'Adaeze Okafor',
  nickname: 'Mom',
  country: 'NG',
  address: MOM,
  tone: 2,
  createdAt: '2026-09-20T10:00:00.000Z',
};

function source() {
  return createAccountSource({ records: createRecords(memory(), OWNER), getRate: async () => rate });
}

describe('account source', () => {
  it('gives a new account an honestly empty snapshot', async () => {
    const snapshot = await source().loadSnapshot();
    expect(snapshot.contacts).toEqual([]);
    expect(snapshot.allowances).toEqual([]);
    expect(snapshot.activity).toEqual([]);
    expect(snapshot.seats).toEqual([]);
    expect(snapshot.invoices).toEqual([]);
    expect(snapshot.growPosition).toBeNull();
    expect(snapshot.request).toBeNull();
    expect(snapshot.proposal).toBeNull();
    expect(snapshot.account.koboPerDollar).toBe(153_000);
  });

  it('makes a saved beneficiary payable and never puts the address in the snapshot', async () => {
    const s = source();
    await s.saveBeneficiary(mom);
    expect(s.resolveRecipient('b-mom')).toBe(MOM);
    expect(s.resolveContactId(MOM)).toBe('b-mom');
    const snapshot = await s.loadSnapshot();
    expect(snapshot.contacts.map((c) => c.name)).toEqual(['Mom']);
    expect(JSON.stringify(snapshot)).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });

  it('refuses to pay someone it does not know', () => {
    expect(() => source().resolveRecipient('nobody')).toThrow("We couldn't find that beneficiary.");
  });

  it('forgets a removed beneficiary', async () => {
    const s = source();
    await s.saveBeneficiary(mom);
    await s.removeBeneficiary('b-mom');
    expect(() => s.resolveRecipient('b-mom')).toThrow();
  });

  it('fails the load when there is no rate, rather than inventing one', async () => {
    const s = createAccountSource({
      records: createRecords(memory(), OWNER),
      getRate: async () => {
        throw new Error('no rate');
      },
    });
    await expect(s.loadSnapshot()).rejects.toThrow('no rate');
  });
});
