import type { Address } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { createAssistantInboxClient } from './assistant-inbox';
import type { Proposal } from './schemas';

/**
 * The inbox client on its own, with a stand-in fetch and a stand-in signer.
 * The signed round trip and the route that answers it are proven elsewhere
 * (`apps/web/tests/assistant-proposal-route.test.ts`); here the concern is the
 * client's own contract — it parses a real proposal through, and it degrades to
 * an empty inbox on every failure rather than surfacing an error the snapshot
 * would have to handle.
 */

const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;

const PROPOSAL: Proposal = {
  id: 'tg-1',
  allowanceId: 'allow-1',
  contactId: 'c-mom',
  amountMinor: 500_000,
  note: 'rent',
  undoSeconds: 10,
};

function jsonResponse(body: unknown, ok = true) {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  });
}

function client(fetchImpl: typeof fetch, sign = async () => '0xsig' as `0x${string}`) {
  return createAssistantInboxClient({ baseUrl: 'https://api.test', account: ACCOUNT, sign, fetch: fetchImpl });
}

describe('createAssistantInboxClient', () => {
  it('reads back a proposal the server returns', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ proposal: PROPOSAL }));
    await expect(client(fetchImpl as unknown as typeof fetch).read()).resolves.toEqual(PROPOSAL);
  });

  it('signs the exact account, action and timestamp it sends', async () => {
    const sign = vi.fn(async () => '0xsig' as `0x${string}`);
    const fetchImpl = vi.fn(async () => jsonResponse({ proposal: null }));
    await client(fetchImpl as unknown as typeof fetch, sign).read();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/assistant/proposal');
    const body = JSON.parse(init.body as string);
    expect(body.account).toBe(ACCOUNT);
    expect(body.action).toBe('read');
    // The signed message must carry the same fields the body does.
    const message = (sign.mock.calls[0] as unknown as [string])[0];
    expect(message).toContain(`action: read`);
    expect(message).toContain(`timestamp: ${body.timestampSeconds}`);
  });

  it('reads null when the server refuses', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'invalid_signature' }, false));
    await expect(client(fetchImpl as unknown as typeof fetch).read()).resolves.toBeNull();
  });

  it('reads null when the body is not the expected shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ proposal: { bogus: true } }));
    await expect(client(fetchImpl as unknown as typeof fetch).read()).resolves.toBeNull();
  });

  it('reads null when the signer throws, without ever calling fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ proposal: PROPOSAL }));
    const sign = async () => {
      throw new Error('user cancelled');
    };
    await expect(client(fetchImpl as unknown as typeof fetch, sign).read()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads null when the network throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(client(fetchImpl as unknown as typeof fetch).read()).resolves.toBeNull();
  });

  it('sends a clear action', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    await client(fetchImpl as unknown as typeof fetch).clear();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).action).toBe('clear');
  });

  it('registers a link code and reports the server acceptance', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    await expect(client(fetchImpl as unknown as typeof fetch).registerLinkCode('ABC123')).resolves.toBe(true);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.action).toBe('link');
    expect(body.code).toBe('ABC123');
  });

  it('reports a failed link registration as false', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'bad_request' }, false));
    await expect(client(fetchImpl as unknown as typeof fetch).registerLinkCode('ABC123')).resolves.toBe(false);
  });
});
