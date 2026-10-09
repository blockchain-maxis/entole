import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as auroraDeposit } from '@/app/api/aurora/deposit/route';
import { POST as agoraMint } from '@/app/api/agora/mint/route';
import { POST as agoraRedeem } from '@/app/api/agora/redeem/route';
import { GET as nansen } from '@/app/api/nansen/route';
import { resetRateLimits } from '@/lib/server/sponsor';

/**
 * The gated integration routes, with the upstream APIs replaced by a stubbed
 * `fetch`: no network, no keys. Each answers 501 with its key unset, validates
 * its body, never leaks a secret or an on-chain address into a response, and
 * turns an upstream failure into a plain 502.
 */

const ADDRESS = '0x2222222222222222222222222222222222222222';
let ipCounter = 0;

function post(body: unknown) {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.7.0.${++ipCounter}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function get() {
  return new Request('http://localhost/api/nansen', { headers: { 'x-forwarded-for': `10.8.0.${++ipCounter}` } });
}

const upstream = vi.fn();
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetRateLimits();
  upstream.mockReset();
  vi.stubGlobal('fetch', upstream);
  for (const key of [
    'AGORA_ACCESS_KEY',
    'AURORA_INTENTS_API_KEY',
    'AURORA_INTENTS_API_BASE',
    'AURORA_INTENTS_DEPOSIT_PATH',
    'NANSEN_API_KEY',
  ]) {
    delete process.env[key];
  }
});

afterEach(() => vi.unstubAllGlobals());

describe('with no key configured', () => {
  it('every route answers 501 and calls nothing', async () => {
    expect((await agoraMint(post({ fromCurrency: 'USD', address: ADDRESS }))).status).toBe(501);
    expect((await agoraRedeem(post({ toCurrency: 'USD', destinationAccountId: 'a' }))).status).toBe(501);
    expect((await auroraDeposit(post({ sourceChain: 'bitcoin', sourceAsset: 'BTC', address: ADDRESS }))).status).toBe(501);
    expect((await nansen(get())).status).toBe(501);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('POST /api/agora/mint', () => {
  beforeEach(() => {
    process.env.AGORA_ACCESS_KEY = 'agora-key';
  });

  it('returns bank details for a bank route', async () => {
    upstream
      .mockResolvedValueOnce(reply({ sessionJwt: 'jwt' }))
      .mockResolvedValueOnce(
        reply({ id: 'route-1', instructions: { bankName: 'Acme Bank', accountNumber: '123', memo: 'REF1' } }),
      );
    const response = await agoraMint(post({ fromCurrency: 'usd', address: ADDRESS }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'route-1',
      kind: 'bank',
      bank: { bankName: 'Acme Bank', accountNumber: '123', memo: 'REF1' },
    });
  });

  it('never returns an on-chain deposit address, and never the key', async () => {
    upstream
      .mockResolvedValueOnce(reply({ sessionJwt: 'jwt' }))
      .mockResolvedValueOnce(reply({ id: 'route-2', instructions: { depositAddress: '0xabc' } }));
    const text = await (await agoraMint(post({ fromCurrency: 'USDC', address: ADDRESS }))).text();
    expect(JSON.parse(text)).toEqual({ id: 'route-2', kind: 'chain' });
    expect(text).not.toMatch(/0xabc|agora-key|jwt/);
  });

  it('rejects a bad body and turns an upstream failure into 502', async () => {
    expect((await agoraMint(post({ fromCurrency: 'U$D', address: ADDRESS }))).status).toBe(400);
    expect((await agoraMint(post({ fromCurrency: 'USD', address: 'nope' }))).status).toBe(400);
    expect((await agoraMint(post('not json'))).status).toBe(400);
    upstream.mockResolvedValueOnce(reply({}, 401));
    expect((await agoraMint(post({ fromCurrency: 'USD', address: ADDRESS }))).status).toBe(502);
  });
});

describe('POST /api/agora/redeem', () => {
  it('creates a redeem route', async () => {
    process.env.AGORA_ACCESS_KEY = 'agora-key';
    upstream
      .mockResolvedValueOnce(reply({ sessionJwt: 'jwt' }))
      .mockResolvedValueOnce(reply({ id: 'route-3', instructions: { memo: 'm' } }));
    const response = await agoraRedeem(post({ toCurrency: 'usd', destinationAccountId: 'acct-9' }));
    expect(await response.json()).toEqual({ id: 'route-3' });
    const body = JSON.parse((upstream.mock.calls[1]![1] as RequestInit).body as string);
    expect(body).toEqual({ from: { currency: 'AUSD' }, to: { accountId: 'acct-9', currency: 'USD' } });
  });

  it('validates its body', async () => {
    process.env.AGORA_ACCESS_KEY = 'agora-key';
    expect((await agoraRedeem(post({ toCurrency: 'USD', destinationAccountId: '' }))).status).toBe(400);
  });
});

describe('POST /api/aurora/deposit', () => {
  beforeEach(() => {
    process.env.AURORA_INTENTS_API_KEY = 'aurora-key';
  });

  it('returns the deposit target as a QR payload, never as an address field', async () => {
    upstream.mockResolvedValueOnce(
      reply({ depositAddress: 'bc1qexample', sourceChain: 'bitcoin', sourceAsset: 'BTC' }),
    );
    const response = await auroraDeposit(post({ sourceChain: 'bitcoin', sourceAsset: 'BTC', address: ADDRESS }));
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ qrPayload: 'bc1qexample', sourceChain: 'bitcoin', sourceAsset: 'BTC' });
    expect(body).not.toHaveProperty('depositAddress');
  });

  it('lets the endpoint be corrected from the environment', async () => {
    process.env.AURORA_INTENTS_API_BASE = 'https://aurora.test/v2';
    process.env.AURORA_INTENTS_DEPOSIT_PATH = '/intents/deposit';
    upstream.mockResolvedValueOnce(reply({ depositAddress: 'x', sourceChain: 'bitcoin', sourceAsset: 'BTC' }));
    await auroraDeposit(post({ sourceChain: 'bitcoin', sourceAsset: 'BTC', address: ADDRESS }));
    expect(upstream.mock.calls[0]![0]).toBe('https://aurora.test/v2/intents/deposit');
  });

  it('validates its body and survives an upstream failure', async () => {
    expect((await auroraDeposit(post({ sourceChain: '', sourceAsset: 'BTC', address: ADDRESS }))).status).toBe(400);
    upstream.mockResolvedValueOnce(reply({}, 500));
    expect((await auroraDeposit(post({ sourceChain: 'bitcoin', sourceAsset: 'BTC', address: ADDRESS }))).status).toBe(502);
  });
});

describe('GET /api/nansen', () => {
  beforeEach(() => {
    process.env.NANSEN_API_KEY = 'nansen-key';
  });

  it('answers with one plain headline and caches it briefly', async () => {
    upstream.mockResolvedValueOnce(reply({ data: [{ token_symbol: 'A', net_flow_24h_usd: 500 }] }));
    const response = await nansen(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ headline: 'More money has been moving into this route than out of it today.' });
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('answers 502 when Nansen is down or answers something unexpected', async () => {
    upstream.mockResolvedValueOnce(reply({}, 500));
    expect((await nansen(get())).status).toBe(502);
    upstream.mockResolvedValueOnce(reply({ nope: true }));
    expect((await nansen(get())).status).toBe(502);
  });
});
