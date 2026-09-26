import type { Proposal } from '@entole/core/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { buildInboxMessage } from '@entole/core/assistant-inbox';

import { POST } from '@/app/api/assistant/proposal/route';
import { resetRateLimits } from '@/lib/server/sponsor';
import { getServerStore, resetServerStore } from '@/lib/server/store';

/**
 * The assistant inbox route against the in-memory server store: no Redis, no
 * network. Signatures are real — a genuine owner key signs the exact message
 * the route reconstructs, so control of the account is proven for real, not
 * stubbed. Proves the private read/clear/link path the app depends on to pick
 * up a proposal written by the Telegram intake route.
 */

const OWNER = privateKeyToAccount(`0x${'11'.repeat(32)}` as `0x${string}`);
const OTHER = privateKeyToAccount(`0x${'22'.repeat(32)}` as `0x${string}`);
const ACCOUNT = OWNER.address.toLowerCase();

const PROPOSAL: Proposal = {
  id: 'tg-1',
  allowanceId: 'allow-1',
  contactId: 'c-mom',
  amountMinor: 500_000,
  note: 'rent',
  undoSeconds: 10,
};

let ipCounter = 0;
function req(body: unknown) {
  return new Request('http://localhost/api/assistant/proposal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${++ipCounter}` },
    body: JSON.stringify(body),
  });
}

async function signed(action: 'read' | 'clear' | 'link', extra: Record<string, unknown> = {}, signer = OWNER) {
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const message = buildInboxMessage({ account: OWNER.address, action, timestampSeconds });
  const signature = await signer.signMessage({ message });
  return { account: OWNER.address, action, timestampSeconds, signature, ...extra };
}

beforeEach(() => {
  resetRateLimits();
  resetServerStore();
});

describe('POST /api/assistant/proposal', () => {
  it('reads back the pending proposal for a proven account', async () => {
    await getServerStore().putProposal(ACCOUNT, PROPOSAL);

    const response = await POST(req(await signed('read')));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ proposal: PROPOSAL });
  });

  it('reads null when the inbox is empty', async () => {
    const response = await POST(req(await signed('read')));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ proposal: null });
  });

  it('clears the pending proposal so a later read is empty', async () => {
    const store = getServerStore();
    await store.putProposal(ACCOUNT, PROPOSAL);

    const cleared = await POST(req(await signed('clear')));
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toEqual({ ok: true });
    expect(await store.getProposal(ACCOUNT)).toBeNull();
  });

  it('registers a link code the Telegram route can then redeem', async () => {
    const response = await POST(req(await signed('link', { code: 'ABC123' })));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    // The code now redeems to this account.
    expect(await getServerStore().linkChat('ABC123', 555)).toBe(ACCOUNT);
  });

  it('rejects a signature from a different key', async () => {
    await getServerStore().putProposal(ACCOUNT, PROPOSAL);
    const response = await POST(req(await signed('read', {}, OTHER)));
    expect(response.status).toBe(401);
  });

  it('rejects a read signature replayed as a clear', async () => {
    const store = getServerStore();
    await store.putProposal(ACCOUNT, PROPOSAL);

    // A genuine read signature, sent with action switched to clear.
    const body = await signed('read');
    const response = await POST(req({ ...body, action: 'clear' }));
    expect(response.status).toBe(401);
    // The proposal is untouched.
    expect(await store.getProposal(ACCOUNT)).toEqual(PROPOSAL);
  });

  it('rejects a stale timestamp even with a genuine signature', async () => {
    const stale = await signed('read');
    const response = await POST(req({ ...stale, timestampSeconds: Math.floor(Date.now() / 1000) - 9999 }));
    expect(response.status).toBe(422);
  });

  it('answers 400 for a link action with no code', async () => {
    const response = await POST(req(await signed('link')));
    expect(response.status).toBe(400);
  });
});
