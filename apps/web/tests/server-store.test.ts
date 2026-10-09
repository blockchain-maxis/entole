import type { Contact, Invoice, Proposal } from '@entole/core/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LINK_CODE_TTL_SECONDS,
  createRedisStore,
  getServerStore,
  resetServerStore,
  tryGetServerStore,
  type RedisLike,
} from '@/lib/server/store';

/**
 * The durable Upstash-backed adapter, driven by a fake Redis so no network or
 * provisioned instance is needed. Proves the same behaviour the in-memory
 * adapter gives the routes: one-time link codes, chat-to-account resolution,
 * a single pending proposal per account, and invoice lookup by id alone.
 */

/** A minimal in-process stand-in for the Upstash client, covering only the
 * calls the adapter makes. Values are held as-is; the real client round-trips
 * them through JSON, which these plain objects survive unchanged. */
const sets: { key: string; ex: number | undefined }[] = [];

function fakeRedis(): RedisLike {
  const map = new Map<string, unknown>();
  return {
    get: (async (k: string) => (map.has(k) ? map.get(k) : null)) as RedisLike['get'],
    set: (async (k: string, v: unknown, options?: { ex?: number }) => {
      map.set(k, v);
      sets.push({ key: k, ex: options?.ex });
      return 'OK';
    }) as unknown as RedisLike['set'],
    del: (async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (map.delete(k)) n += 1;
      return n;
    }) as unknown as RedisLike['del'],
    getdel: (async (k: string) => {
      const v = map.has(k) ? map.get(k) : null;
      map.delete(k);
      return v;
    }) as unknown as RedisLike['getdel'],
  };
}

const ACCOUNT = 'acct-1';
const MOM: Contact = { id: 'c-mom', name: 'Mom', initials: 'MO', tone: 1 };
const PROPOSAL: Proposal = {
  id: 'tg-1',
  allowanceId: 'allow-1',
  contactId: MOM.id,
  amountMinor: 500_000,
  note: 'rent',
  undoSeconds: 10,
};

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    clientName: 'Acme',
    amountMinor: 1_000_000,
    note: 'Design work',
    dueAt: '2026-10-01T00:00:00.000+01:00',
    status: 'pending-release',
    link: 'entole.to/inv-1',
    ...overrides,
  };
}

describe('createRedisStore', () => {
  it('redeems a link code once and resolves the chat afterwards', async () => {
    const store = createRedisStore(fakeRedis());
    await store.createLinkCode(ACCOUNT, 'ABC123');

    expect(await store.linkChat('ABC123', 555)).toBe(ACCOUNT);
    // Spent: a second redemption of the same code fails.
    expect(await store.linkChat('ABC123', 777)).toBeNull();
    expect(await store.accountForChat(555)).toBe(ACCOUNT);
    expect(await store.accountForChat(777)).toBeNull();
  });

  it('refuses an unknown link code', async () => {
    const store = createRedisStore(fakeRedis());
    expect(await store.linkChat('NOPE', 555)).toBeNull();
  });

  it('holds one pending proposal per account and clears it', async () => {
    const store = createRedisStore(fakeRedis());
    expect(await store.getProposal(ACCOUNT)).toBeNull();

    await store.putProposal(ACCOUNT, PROPOSAL);
    expect(await store.getProposal(ACCOUNT)).toEqual(PROPOSAL);

    await store.clearProposal(ACCOUNT);
    expect(await store.getProposal(ACCOUNT)).toBeNull();
  });

  it('stores contacts and the assistant allowance per account', async () => {
    const store = createRedisStore(fakeRedis());
    expect(await store.contactsFor(ACCOUNT)).toEqual([]);
    expect(await store.assistantAllowanceFor(ACCOUNT)).toBeNull();

    await store.setContacts(ACCOUNT, [MOM]);
    await store.setAssistantAllowance(ACCOUNT, 'allow-1');
    expect(await store.contactsFor(ACCOUNT)).toEqual([MOM]);
    expect(await store.assistantAllowanceFor(ACCOUNT)).toBe('allow-1');
  });

  it('finds a pending-release invoice by id alone and replaces it in place', async () => {
    const store = createRedisStore(fakeRedis());
    await store.putInvoice(ACCOUNT, invoice());

    const found = await store.findPendingReleaseInvoice('inv-1');
    expect(found).toMatchObject({ accountId: ACCOUNT, invoice: { id: 'inv-1' } });

    await store.replaceInvoice(ACCOUNT, invoice({ status: 'paid' }));
    // Once released, it is no longer a release candidate.
    expect(await store.findPendingReleaseInvoice('inv-1')).toBeNull();
  });

  it('does not find an invoice that was never stored', async () => {
    const store = createRedisStore(fakeRedis());
    expect(await store.findPendingReleaseInvoice('inv-nope')).toBeNull();
  });
});

describe('link codes expire', () => {
  it('writes the code with a time to live so an unused one does not live forever', async () => {
    sets.length = 0;
    const store = createRedisStore(fakeRedis());
    await store.createLinkCode(ACCOUNT, 'CODE1');
    expect(sets).toEqual([{ key: 'store:linkcode:CODE1', ex: LINK_CODE_TTL_SECONDS }]);
    expect(LINK_CODE_TTL_SECONDS).toBe(900);
  });
});

describe('the process-wide store in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetServerStore();
  });

  it('is unavailable, not silently in-memory, when Redis is not configured', () => {
    resetServerStore();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    expect(tryGetServerStore()).toBeNull();
    expect(() => getServerStore()).toThrow(/not configured/);
  });

  it('is available in dev and tests without Redis', () => {
    resetServerStore();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    expect(tryGetServerStore()).not.toBeNull();
  });
});
