import type { Invoice } from '@entole/core/schemas';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST as release } from '@/app/api/chainlink-cre/release/route';
import { getServerStore, resetServerStore } from '@/lib/server/store';

/**
 * The Chainlink CRE release route against the in-memory server store. Proves
 * the release half: a linked pending-release invoice transitions to paid only
 * when the observed rate satisfies the invoice's own stored condition, the
 * secret is checked, and the caller's rate claim is never trusted over the
 * arithmetic.
 */

const SECRET = 'cre-secret';
const ACCOUNT = 'acct-1';

const INVOICE: Invoice = {
  id: 'inv-1',
  clientName: 'Acme Ltd',
  amountMinor: 1_000_000,
  note: 'Consulting',
  dueAt: '2026-10-01T00:00:00.000+01:00',
  status: 'pending-release',
  link: 'entole.to/inv-1',
  releaseCondition: { type: 'fx-rate-at-or-below', maxKoboPerDollar: 160_000 },
};

function post(body: unknown, secret: string | null = SECRET) {
  return new Request('http://localhost/api/chainlink-cre/release', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-cre-webhook-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function payload(overrides: Record<string, unknown> = {}) {
  return { invoiceId: 'inv-1', observedKoboPerDollar: 150_000, maxKoboPerDollar: 160_000, ...overrides };
}

beforeEach(() => {
  resetServerStore();
  process.env.CHAINLINK_CRE_WEBHOOK_SECRET = SECRET;
});

describe('POST /api/chainlink-cre/release', () => {
  it('answers 501 when no secret is configured', async () => {
    delete process.env.CHAINLINK_CRE_WEBHOOK_SECRET;
    expect((await release(post(payload()))).status).toBe(501);
  });

  it('rejects a wrong or missing secret with 401', async () => {
    expect((await release(post(payload(), 'wrong'))).status).toBe(401);
    expect((await release(post(payload(), null))).status).toBe(401);
  });

  it('answers 404 when no pending-release invoice has that id', async () => {
    const response = await release(post(payload()));
    expect(response.status).toBe(404);
  });

  it('releases the invoice when the observed rate satisfies its stored condition', async () => {
    const store = getServerStore();
    await store.putInvoice(ACCOUNT, INVOICE);

    const response = await release(post(payload({ observedKoboPerDollar: 155_000 })));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, invoiceId: 'inv-1', conditionMet: true });

    const found = await store.findPendingReleaseInvoice('inv-1');
    expect(found).toBeNull(); // no longer pending-release
  });

  it('does not release when the observed rate is above the invoice condition', async () => {
    const store = getServerStore();
    await store.putInvoice(ACCOUNT, INVOICE);

    const response = await release(post(payload({ observedKoboPerDollar: 170_000 })));
    expect(await body(response)).toEqual({ ok: true, invoiceId: 'inv-1', conditionMet: false });
    expect(await store.findPendingReleaseInvoice('inv-1')).not.toBeNull(); // still pending
  });

  it('trusts the invoice’s own condition, not a caller who lies about the threshold', async () => {
    const store = getServerStore();
    await store.putInvoice(ACCOUNT, INVOICE);

    // Caller claims a generous threshold; the real rate is above the invoice's
    // stored 160000, so the release is refused regardless of the claim.
    const response = await release(post(payload({ observedKoboPerDollar: 170_000, maxKoboPerDollar: 999_000 })));
    expect(await body(response)).toMatchObject({ conditionMet: false });
    expect(await store.findPendingReleaseInvoice('inv-1')).not.toBeNull();
  });
});
