import { describe, expect, it } from 'vitest';

import { beneficiaryAddress, chunkedStore, createRecords, toContact, type Beneficiary, type RecordStore } from './records';
import type { Activity, Allowance } from './schemas';

function memoryStore(): RecordStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
  };
}

const OWNER = '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80' as const;
const OTHER = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;

const activity = (id: string): Activity => ({
  id,
  contactId: 'b-1',
  note: 'Sent',
  at: '2026-09-20T10:00:00.000Z',
  amountMinor: 100_000,
  direction: 'out',
  initiatedBy: 'you',
  state: 'settled',
});

const beneficiary: Beneficiary = {
  id: 'b-1',
  name: 'Adaeze Okafor',
  nickname: 'Mom',
  country: 'NG',
  address: OTHER,
  bank: { bankName: 'Zenith Bank', accountNumber: '0123456789' },
  tone: 1,
  createdAt: '2026-09-20T10:00:00.000Z',
};

describe('chunked store', () => {
  it('splits a long value across small keys and puts it back together', async () => {
    const base = memoryStore();
    const store = chunkedStore(base);
    const long = 'x'.repeat(4_000);
    await store.set('k', long);
    expect([...base.data.values()].every((v) => v.length <= 1_500)).toBe(true);
    expect(await store.get('k')).toBe(long);
  });

  it('drops leftover chunks when a value shrinks', async () => {
    const base = memoryStore();
    const store = chunkedStore(base);
    await store.set('k', 'y'.repeat(4_000));
    await store.set('k', 'short');
    expect(await store.get('k')).toBe('short');
    expect(base.data.size).toBe(2); // one chunk + the count
  });

  it('reads null for a missing key or a broken chunk set', async () => {
    const base = memoryStore();
    const store = chunkedStore(base);
    expect(await store.get('nope')).toBeNull();
    await store.set('k', 'z'.repeat(4_000));
    base.data.delete('k.1');
    expect(await store.get('k')).toBeNull();
  });
});

describe('records', () => {
  it('starts empty — nothing is invented for a new account', async () => {
    const records = createRecords(memoryStore(), OWNER);
    expect(await records.activity.list()).toEqual([]);
    expect(await records.allowances.list()).toEqual([]);
    expect(await records.beneficiaries.list()).toEqual([]);
  });

  it('keeps activity newest first, without duplicates, and caps it', async () => {
    const records = createRecords(memoryStore(), OWNER);
    await records.activity.add(activity('a'));
    await records.activity.add(activity('b'));
    await records.activity.add(activity('a'));
    expect((await records.activity.list()).map((item) => item.id)).toEqual(['a', 'b']);
    for (let i = 0; i < 230; i += 1) await records.activity.add(activity(`n-${i}`));
    expect((await records.activity.list()).length).toBe(200);
  });

  it('keeps accounts apart on the same device', async () => {
    const store = memoryStore();
    await createRecords(store, OWNER).beneficiaries.upsert(beneficiary);
    expect(await createRecords(store, OTHER).beneficiaries.list()).toEqual([]);
    expect(await createRecords(store, OWNER).beneficiaries.list()).toHaveLength(1);
  });

  it('upserts and removes beneficiaries and allowances', async () => {
    const records = createRecords(memoryStore(), OWNER);
    await records.beneficiaries.upsert(beneficiary);
    await records.beneficiaries.upsert({ ...beneficiary, nickname: 'Mama' });
    expect((await records.beneficiaries.list()).map((b) => b.nickname)).toEqual(['Mama']);
    await records.beneficiaries.remove('b-1');
    expect(await records.beneficiaries.list()).toEqual([]);

    const allowance: Allowance = {
      id: 'a-1',
      name: 'Monthly',
      recipientId: 'b-1',
      limitMinor: 1,
      spentMinor: 0,
      perRunMinor: 1,
      cadence: 'monthly',
      resetsAt: '2026-10-01T00:00:00.000Z',
      paused: false,
    };
    await records.allowances.upsert(allowance);
    expect(await records.allowances.list()).toEqual([allowance]);
    await records.allowances.remove('a-1');
    expect(await records.allowances.list()).toEqual([]);
  });

  it('ignores corrupt stored data instead of crashing', async () => {
    const store = memoryStore();
    await chunkedStore(store).set(`entole.records.${OWNER.toLowerCase()}.activity`, '{not json');
    expect(await createRecords(store, OWNER).activity.list()).toEqual([]);
  });

  it('shows a beneficiary as a contact with no address in it', () => {
    const contact = toContact(beneficiary);
    expect(contact.name).toBe('Mom');
    expect(JSON.stringify(contact)).not.toContain('0x');
    expect(beneficiaryAddress(beneficiary)).toBe(OTHER);
  });
});
