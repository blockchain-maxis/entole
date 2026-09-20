import { describe, expect, it } from 'vitest';

import { encodePaymentCode } from './payment-code';
import {
  beneficiaryAddress,
  chunkedStore,
  createRecords,
  toContact,
  type Beneficiary,
  type RecordStore,
  type Staff,
} from './records';
import type { Activity, Allowance, Invoice } from './schemas';

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

describe('staff and invoices', () => {
  const CODE = encodePaymentCode(OTHER);
  const person: Staff = {
    id: 's-1',
    name: 'Ada Okafor',
    code: CODE,
    payAmountMinor: 15_000_000,
    cadence: 'monthly',
    note: 'Cashier',
    createdAt: '2026-09-20T10:00:00.000Z',
  };
  const invoice: Invoice = {
    id: 'inv-1',
    reference: 'INV-0001',
    clientName: 'Bello Foods',
    amountMinor: 5_000_000,
    note: 'Deliveries',
    dueAt: '2026-10-14T22:59:59.000Z',
    status: 'sent',
    link: 'https://entole.vercel.app/pay/x',
  };

  it('start empty for a new account', async () => {
    const records = createRecords(memoryStore(), OWNER);
    expect(await records.staff.list()).toEqual([]);
    expect(await records.invoices.list()).toEqual([]);
  });

  it('save, replace and remove a person, with the code checked', async () => {
    const records = createRecords(memoryStore(), OWNER);
    await records.staff.upsert(person);
    await records.staff.upsert({ ...person, payAmountMinor: 20_000_000, cadence: null });
    expect(await records.staff.list()).toEqual([{ ...person, payAmountMinor: 20_000_000, cadence: null }]);
    await records.staff.remove('s-1');
    expect(await records.staff.list()).toEqual([]);
    await expect(records.staff.upsert({ ...person, code: 'PAY-NOPE' })).rejects.toThrow();
    expect(await records.staff.list()).toEqual([]);
  });

  it('merges an import in one write and refuses all of it if one row is bad', async () => {
    const store = memoryStore();
    const records = createRecords(store, OWNER);
    await records.staff.upsert(person);
    await records.staff.upsertMany([
      { ...person, payAmountMinor: 1_000_00 },
      { ...person, id: 's-2', name: 'Tunde', code: encodePaymentCode(OWNER) },
    ]);
    const list = await records.staff.list();
    expect(list.map((p) => [p.id, p.payAmountMinor])).toEqual([
      ['s-1', 1_000_00],
      ['s-2', 15_000_000],
    ]);
    await expect(
      records.staff.upsertMany([{ ...person, id: 's-3' }, { ...person, id: 's-4', name: '' }]),
    ).rejects.toThrow();
    expect((await records.staff.list()).map((p) => p.id)).toEqual(['s-1', 's-2']);
  });

  it('keeps invoices newest first and updates one in place', async () => {
    const records = createRecords(memoryStore(), OWNER);
    await records.invoices.upsert(invoice);
    await records.invoices.upsert({ ...invoice, id: 'inv-2', reference: 'INV-0002' });
    expect((await records.invoices.list()).map((i) => i.id)).toEqual(['inv-2', 'inv-1']);
    await records.invoices.upsert({ ...invoice, status: 'paid', paidAt: '2026-10-02T10:00:00.000Z' });
    const list = await records.invoices.list();
    expect(list.map((i) => [i.id, i.status])).toEqual([['inv-2', 'sent'], ['inv-1', 'paid']]);
    await records.invoices.remove('inv-2');
    expect((await records.invoices.list()).map((i) => i.id)).toEqual(['inv-1']);
  });

  it('reads an invoice saved before numbering existed', async () => {
    const store = memoryStore();
    const { reference: _reference, ...old } = invoice;
    await chunkedStore(store).set(`entole.records.${OWNER.toLowerCase()}.invoices`, JSON.stringify([old]));
    expect((await createRecords(store, OWNER).invoices.list())[0]!.id).toBe('inv-1');
  });

  it('keeps two accounts apart', async () => {
    const store = memoryStore();
    await createRecords(store, OWNER).staff.upsert(person);
    await createRecords(store, OWNER).invoices.upsert(invoice);
    expect(await createRecords(store, OTHER).staff.list()).toEqual([]);
    expect(await createRecords(store, OTHER).invoices.list()).toEqual([]);
  });
});
