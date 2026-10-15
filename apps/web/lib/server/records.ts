import type { Address } from 'viem';

import { RECORD_COLLECTIONS, storedCollectionSchema, type RecordCollection, type StoredCollection } from '@entole/core/record-sync';

import { getRedis, requiresRedis } from './redis';

/**
 * Where an account's sealed records wait for its other devices. The server
 * cannot open them (`packages/core/record-sync.ts`); it keeps the newest copy
 * of each collection, and when it was written, and nothing else.
 *
 * Upstash Redis in production, a map in memory in development and tests.
 */

const key = (account: Address, collection: RecordCollection) => `records:${account.toLowerCase()}:${collection}`;

const memory = new Map<string, StoredCollection>();

export function recordsConfigured(): boolean {
  return getRedis() !== null || !requiresRedis();
}

export async function readCollections(account: Address): Promise<Partial<Record<RecordCollection, StoredCollection>>> {
  const redis = getRedis();
  const keys = RECORD_COLLECTIONS.map((collection) => key(account, collection));
  const raw = redis ? await redis.mget<unknown[]>(...keys) : keys.map((name) => memory.get(name) ?? null);
  const found: Partial<Record<RecordCollection, StoredCollection>> = {};
  RECORD_COLLECTIONS.forEach((collection, index) => {
    const value = raw[index];
    const parsed = storedCollectionSchema.safeParse(typeof value === 'string' ? safeJson(value) : value);
    if (parsed.success) found[collection] = parsed.data;
  });
  return found;
}

/**
 * Keeps a collection when it is newer than the copy already kept. A copy that
 * is not newer is refused, which is also what makes a request sent twice
 * change nothing the second time.
 */
export async function writeCollection(
  account: Address,
  collection: RecordCollection,
  stored: StoredCollection,
): Promise<'kept' | 'older'> {
  const name = key(account, collection);
  const redis = getRedis();
  if (!redis) {
    const current = memory.get(name);
    if (current && current.at >= stored.at) return 'older';
    memory.set(name, stored);
    return 'kept';
  }
  // Compare and set in one step, so two devices writing at once cannot step back in time.
  const kept = await redis.eval<[string, string], number>(
    `local current = redis.call('GET', KEYS[1])
     if current then
       local at = tonumber(cjson.decode(current)['at'])
       if at and at >= tonumber(ARGV[1]) then return 0 end
     end
     redis.call('SET', KEYS[1], ARGV[2])
     return 1`,
    [name],
    [String(stored.at), JSON.stringify(stored)],
  );
  return kept === 1 ? 'kept' : 'older';
}

/** For tests: forgets everything kept in memory. */
export function resetRecords(): void {
  memory.clear();
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
