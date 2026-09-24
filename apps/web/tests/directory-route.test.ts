import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { buildClaimMessage } from '@entole/core/directory';

import { GET, POST } from '@/app/api/directory/route';
import { resetRateLimits } from '@/lib/server/sponsor';
import type { DirectoryRecord } from '@/lib/server/directory';

/**
 * The directory route against a fake in-memory store: no Redis, no network.
 * Signatures are real — a genuine key signs the exact message the route
 * reconstructs, so the verification path is exercised for real, not stubbed.
 */
vi.mock('@/lib/server/directory', () => {
  const byAddress = new Map<string, DirectoryRecord>();
  const byPhone = new Map<string, string>();
  return {
    directoryConfigured: vi.fn(() => true),
    getByAddress: vi.fn(async (address: string) => byAddress.get(address.toLowerCase()) ?? null),
    getPhoneOwner: vi.fn(async (country: string, number: string) => byPhone.get(`${country}:${number}`) ?? null),
    saveRecord: vi.fn(async (record: DirectoryRecord) => {
      byAddress.set(record.address.toLowerCase(), record);
      if (record.phone) byPhone.set(`${record.phone.country}:${record.phone.number}`, record.address);
    }),
    __reset: () => {
      byAddress.clear();
      byPhone.clear();
    },
  };
});

const OWNER = privateKeyToAccount(`0x${'11'.repeat(32)}` as `0x${string}`);
const OTHER = privateKeyToAccount(`0x${'22'.repeat(32)}` as `0x${string}`);

let ipCounter = 0;
function req(method: string, body?: unknown, query = '') {
  return new Request(`http://localhost/api/directory${query}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ipCounter}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function claimBody(overrides: Record<string, unknown> = {}) {
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const base = {
    address: OWNER.address,
    name: 'Ada Lovelace',
    initials: 'AL',
    tone: 1 as const,
    timestampSeconds,
    ...overrides,
  };
  const message = buildClaimMessage({
    address: base.address as `0x${string}`,
    name: base.name,
    timestampSeconds: base.timestampSeconds,
    ...('phone' in overrides && overrides.phone ? { phone: overrides.phone as never } : {}),
  });
  const signature =
    'signature' in overrides ? (overrides.signature as string) : await OWNER.signMessage({ message });
  return { ...base, signature };
}

beforeEach(async () => {
  resetRateLimits();
  const mod = (await import('@/lib/server/directory')) as unknown as { __reset: () => void };
  mod.__reset();
});

describe('POST /api/directory', () => {
  it('accepts a genuine signature and makes the address resolvable', async () => {
    const response = await POST(req('POST', await claimBody()));
    expect(response.status).toBe(200);

    const read = await GET(req('GET', undefined, `?address=${OWNER.address}`));
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ name: 'Ada Lovelace', initials: 'AL' });
  });

  it('rejects a signature from a different key', async () => {
    const body = await claimBody();
    const wrongSignature = await OTHER.signMessage({
      message: buildClaimMessage({
        address: body.address as `0x${string}`,
        name: body.name,
        timestampSeconds: body.timestampSeconds,
      }),
    });
    const response = await POST(req('POST', { ...body, signature: wrongSignature }));
    expect(response.status).toBe(401);
  });

  it('rejects a stale timestamp even with a genuine signature', async () => {
    const response = await POST(req('POST', await claimBody({ timestampSeconds: Math.floor(Date.now() / 1000) - 9999 })));
    expect(response.status).toBe(422);
  });

  it('claims a phone number and resolves it back to the address', async () => {
    const phone = { country: 'ng', number: '8012345678' };
    const response = await POST(req('POST', await claimBody({ phone })));
    expect(response.status).toBe(200);

    const read = await GET(req('GET', undefined, '?country=ng&number=8012345678'));
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ address: OWNER.address, name: 'Ada Lovelace' });
  });

  it('refuses to let a second address claim an already-claimed phone number', async () => {
    const phone = { country: 'ng', number: '8012345678' };
    await POST(req('POST', await claimBody({ phone })));

    const timestampSeconds = Math.floor(Date.now() / 1000);
    const message = buildClaimMessage({ address: OTHER.address, name: 'Someone Else', phone, timestampSeconds });
    const signature = await OTHER.signMessage({ message });
    const response = await POST(
      req('POST', {
        address: OTHER.address,
        name: 'Someone Else',
        initials: 'SE',
        tone: 2,
        phone,
        timestampSeconds,
        signature,
      }),
    );
    expect(response.status).toBe(409);
  });

  it('lets the same address that claimed a number update its own record', async () => {
    const phone = { country: 'ng', number: '8012345678' };
    await POST(req('POST', await claimBody({ phone })));
    const second = await POST(req('POST', await claimBody({ phone, name: 'Ada L.' })));
    expect(second.status).toBe(200);
  });

  it('keeps an already-claimed phone number when a later update omits it', async () => {
    const phone = { country: 'ng', number: '8012345678' };
    await POST(req('POST', await claimBody({ phone })));

    // A name-only update — the request never mentions the phone at all.
    const nameOnly = await POST(req('POST', await claimBody({ name: 'Ada L.' })));
    expect(nameOnly.status).toBe(200);

    const read = await GET(req('GET', undefined, '?country=ng&number=8012345678'));
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ address: OWNER.address, name: 'Ada L.' });
  });
});

describe('GET /api/directory', () => {
  it('answers 404, not an error, for an address with no entry', async () => {
    const response = await GET(req('GET', undefined, `?address=${OTHER.address}`));
    expect(response.status).toBe(404);
  });

  it('answers 400 for a request with neither an address nor a phone', async () => {
    const response = await GET(req('GET'));
    expect(response.status).toBe(400);
  });
});
