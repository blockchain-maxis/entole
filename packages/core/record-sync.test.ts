import { createSecp256k1SigningSession } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { describe, expect, it } from 'vitest';

import type { RecordStore } from './records';
import { createRecords } from './records';
import {
  openRecord,
  recordsKeyFrom,
  RECORDS_KEY_MESSAGE,
  sealRecord,
  type RecordCollection,
  type RecordSync,
  type SyncedValue,
} from './record-sync';

const OWNER = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;

function memoryStore(): RecordStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
  };
}

/** A server that keeps whatever is newer, as the real route does, without the network. */
function fakeServer() {
  const kept = new Map<RecordCollection, SyncedValue>();
  const pushes: { collection: RecordCollection; at: number }[] = [];
  const sync: RecordSync = {
    async pull() {
      return Object.fromEntries(kept);
    },
    async push(collection, value, at) {
      pushes.push({ collection, at });
      const current = kept.get(collection);
      if (current && current.at >= at) return false;
      kept.set(collection, { value, at });
      return true;
    },
  };
  return { kept, pushes, sync };
}

const ADA = {
  id: 'b-ada',
  name: 'Ada Eze',
  address: '0x1111111111111111111111111111111111111111',
  tone: 1,
  createdAt: '2026-10-15T09:00:00.000Z',
} as const;

describe('sealing a collection', () => {
  const key = new Uint8Array(32).fill(3);

  it('opens with the same key, account and collection', () => {
    const sealed = sealRecord(key, OWNER, 'beneficiaries', '[{"id":"b-ada"}]');
    expect(sealed).not.toContain('b-ada');
    expect(openRecord(key, OWNER, 'beneficiaries', sealed)).toBe('[{"id":"b-ada"}]');
  });

  it('does not open as another collection, under another key, or once altered', () => {
    const sealed = sealRecord(key, OWNER, 'beneficiaries', '[]');
    expect(openRecord(key, OWNER, 'invoices', sealed)).toBeNull();
    expect(openRecord(new Uint8Array(32).fill(4), OWNER, 'beneficiaries', sealed)).toBeNull();
    const altered = `${sealed.slice(0, -2)}${sealed.endsWith('00') ? '01' : '00'}`;
    expect(openRecord(key, OWNER, 'beneficiaries', altered)).toBeNull();
  });

  it('is sealed under the same key on every device, because the owner signature repeats', async () => {
    // If the signing library ever starts adding randomness to signatures, a
    // second device could no longer open what the first one sealed. This fails first.
    const secret = new Uint8Array(32).fill(9);
    const one = toViemAccount(createSecp256k1SigningSession({ privateKey: secret.slice() }));
    const two = toViemAccount(createSecp256k1SigningSession({ privateKey: secret.slice() }));
    const keyOne = recordsKeyFrom(await one.signMessage({ message: RECORDS_KEY_MESSAGE }), one.address);
    const keyTwo = recordsKeyFrom(await two.signMessage({ message: RECORDS_KEY_MESSAGE }), two.address);
    expect(keyTwo).toEqual(keyOne);
  });
});

describe('records that follow the account', () => {
  it('a new device reads what another device saved', async () => {
    const server = fakeServer();
    const first = createRecords(memoryStore(), OWNER, server.sync);
    await first.beneficiaries.upsert(ADA);
    await Promise.resolve();

    const second = createRecords(memoryStore(), OWNER, server.sync);
    expect((await second.beneficiaries.list()).map((entry) => entry.id)).toEqual(['b-ada']);
  });

  it('sends what a device had before records were synced, dated now', async () => {
    const store = memoryStore();
    const before = createRecords(store, OWNER);
    await before.beneficiaries.upsert(ADA);

    const server = fakeServer();
    const after = createRecords(store, OWNER, server.sync);
    await after.beneficiaries.list();
    expect(server.kept.get('beneficiaries')?.value).toContain('b-ada');
  });

  it('the newer copy wins, whole', async () => {
    const server = fakeServer();
    server.kept.set('beneficiaries', { value: JSON.stringify([ADA]), at: Date.now() + 60_000 });
    const store = memoryStore();
    const old = createRecords(store, OWNER);
    await old.beneficiaries.upsert({ ...ADA, id: 'b-old' });

    const records = createRecords(store, OWNER, server.sync);
    expect((await records.beneficiaries.list()).map((entry) => entry.id)).toEqual(['b-ada']);
  });

  it('every write goes on, each later than the last', async () => {
    const server = fakeServer();
    const records = createRecords(memoryStore(), OWNER, server.sync);
    await records.beneficiaries.upsert(ADA);
    await records.beneficiaries.remove(ADA.id);
    const writes = server.pushes.filter((push) => push.collection === 'beneficiaries');
    expect(writes.length).toBe(2);
    expect(writes[1]!.at).toBeGreaterThan(writes[0]!.at);
    expect(server.kept.get('beneficiaries')?.value).toBe('[]');
  });

  it('takes in nothing that would not read back', async () => {
    const server = fakeServer();
    server.kept.set('beneficiaries', { value: 'not a list', at: Date.now() + 60_000 });
    server.kept.set('savings-principal', { value: '-5', at: Date.now() + 60_000 });
    const records = createRecords(memoryStore(), OWNER, server.sync);
    expect(await records.beneficiaries.list()).toEqual([]);
    expect(await records.savings.principal()).toBeNull();
  });

  it('carries on with the device copy when the server does not answer', async () => {
    const store = memoryStore();
    await createRecords(store, OWNER).beneficiaries.upsert(ADA);
    const silent: RecordSync = { pull: () => new Promise(() => undefined), push: async () => false };
    const records = createRecords(store, OWNER, silent);
    const started = Date.now();
    expect((await records.beneficiaries.list()).map((entry) => entry.id)).toEqual(['b-ada']);
    expect(Date.now() - started).toBeLessThan(6_000);
  }, 10_000);
});
