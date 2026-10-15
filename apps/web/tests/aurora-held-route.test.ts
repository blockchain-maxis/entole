import { createSecp256k1SigningSession } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as held, POST as bringBack } from '@/app/api/aurora/held/route';
import { resetRateLimits } from '@/lib/server/sponsor';

/**
 * Money Aurora could not deliver, held for the person on NEAR Intents, read
 * and brought home. NEAR, 1Click and the conversion partner are a stubbed
 * `fetch`: no network, no key, no money.
 */

const owner = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(32).fill(5) }));
const stranger = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(32).fill(6) }));
const SETTLEMENT = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a';
const HOLDING = '0x2222222222222222222222222222222222222222';
let ip = 0;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const nearAmount = (amount: string) => reply({ result: { result: [...new TextEncoder().encode(JSON.stringify(amount))] } });

let heldUnits = '148500000';
const upstream = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
  const target = String(url);
  if (target.includes('near.org')) return nearAmount(heldUnits);
  if (target.endsWith('/v0/quote')) return reply({ quote: { depositAddress: 'deposit-1' } });
  if (target.endsWith('/v0/generate-intent')) {
    return reply({ intent: { standard: 'erc191', payload: JSON.stringify({ signer_id: owner.address.toLowerCase() }) } });
  }
  if (target.endsWith('/v0/submit-intent')) return reply({ intentHash: 'h1' });
  return reply({ steps: [{ id: 'deposit', depositAddress: HOLDING }], details: { currencyOut: { amount: '1', currency: { chainId: 143, address: SETTLEMENT } } } });
});

const get = (address: string) =>
  new Request(`https://entole.pro/api/aurora/held?address=${address}`, { headers: { 'x-forwarded-for': `10.20.0.${++ip}` } });
const post = (body: unknown) =>
  new Request('https://entole.pro/api/aurora/held', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.21.0.${++ip}` },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  resetRateLimits();
  upstream.mockClear();
  heldUnits = '148500000';
  vi.stubGlobal('fetch', upstream);
  process.env.NEXT_PUBLIC_CHAIN_ID = '143';
  process.env.NEXT_PUBLIC_ENTOLE_TOKEN_ADDRESS = SETTLEMENT;
  process.env.ONECLICK_API_KEY = 'oneclick-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ONECLICK_API_KEY;
});

describe('money held for the person', () => {
  it('is read for each thing that can be sent in, and nothing else is said', async () => {
    const answer = await (await held(get(owner.address))).json();
    expect(answer).toEqual({
      held: [
        { source: 'tron-usdt', units: '148500000' },
        { source: 'solana-usdc', units: '148500000' },
      ],
      canBringBack: true,
    });
    expect(JSON.stringify(answer)).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });

  it('is off away from the main network', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '10143';
    expect((await held(get(owner.address))).status).toBe(501);
  });
});

describe('bringing it home', () => {
  it('writes the intent for the person to sign, and hands on only their own signature over it', async () => {
    const prepared = (await (await bringBack(post({ action: 'prepare', address: owner.address, source: 'tron-usdt' }))).json()) as {
      intent: { standard: 'erc191'; payload: string };
    };
    expect(prepared.intent.standard).toBe('erc191');

    const forged = await stranger.signMessage({ message: prepared.intent.payload });
    expect((await bringBack(post({ action: 'submit', address: owner.address, intent: prepared.intent, signature: forged }))).status).toBe(401);

    const signature = await owner.signMessage({ message: prepared.intent.payload });
    const submitted = await bringBack(post({ action: 'submit', address: owner.address, intent: prepared.intent, signature }));
    expect(await submitted.json()).toEqual({ intentHash: 'h1' });
  });

  it('says so when nothing is held, and does nothing without the partner key', async () => {
    heldUnits = '0';
    expect((await bringBack(post({ action: 'prepare', address: owner.address, source: 'tron-usdt' }))).status).toBe(404);
    delete process.env.ONECLICK_API_KEY;
    expect((await bringBack(post({ action: 'prepare', address: owner.address, source: 'tron-usdt' }))).status).toBe(501);
  });
});
