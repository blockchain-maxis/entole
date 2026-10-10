import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as startCard } from '@/app/api/onramp/card/route';
import { POST as startDeposit } from '@/app/api/onramp/deposit/route';
import { POST as startOnramp } from '@/app/api/onramp/start/route';
import { resetRateLimits } from '@/lib/server/sponsor';

/**
 * Adding money by bank transfer, with both partners and the rate feed replaced
 * by a stubbed `fetch`: no network, no keys. The route stays off away from the
 * main network, never puts an address in its answer outside the link, and
 * turns a partner failure into a plain code.
 */

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const HOLDING = '0x2222222222222222222222222222222222222222';
const REFUND = '0x3333333333333333333333333333333333333333';
const SETTLEMENT = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a';
let ipCounter = 0;

function post(body: unknown, origin = 'https://entole.vercel.app') {
  return new Request(`${origin}/api/onramp/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${++ipCounter}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const RATE = { result: 'success', time_last_update_unix: 1_791_504_151, rates: { NGN: 1331.01 } };
const TERMS = {
  status: 1,
  data: {
    price: 1392.47171,
    gasFee: { withdrawalFee: '0.5', minimumWithdrawal: '2' },
    gatewayFee: { gatewayFee: 81, gatewayFeeFiat: 108.56 },
  },
};
const CONVERSION = {
  steps: [{ id: 'deposit', depositAddress: HOLDING }],
  details: { currencyOut: { amount: '13717000', currency: { chainId: 143, address: SETTLEMENT } } },
};

let partnerStatus = 200;
let conversionStatus = 200;
const upstream = vi.fn(async (url: string | URL | Request) => {
  const target = String(url);
  if (target.includes('er-api.com')) return reply(RATE);
  if (target.includes('onramp.money')) return reply(TERMS, partnerStatus);
  return reply(CONVERSION, conversionStatus);
});

beforeEach(() => {
  resetRateLimits();
  upstream.mockClear();
  partnerStatus = 200;
  conversionStatus = 200;
  vi.stubGlobal('fetch', upstream);
  process.env.NEXT_PUBLIC_CHAIN_ID = '143';
  process.env.NEXT_PUBLIC_ENTOLE_TOKEN_ADDRESS = SETTLEMENT;
  process.env.ONRAMP_REFUND_ADDRESS = REFUND;
  process.env.ONRAMP_MONEY_APP_ID = '4242';
  delete process.env.RELAY_API_KEY;
  delete process.env.ONRAMP_RETURN_ORIGIN;
});

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/onramp/start', () => {
  it('is off on the test network, and without a refund account, and calls nothing', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '10143';
    expect((await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }))).status).toBe(501);

    process.env.NEXT_PUBLIC_CHAIN_ID = '143';
    delete process.env.ONRAMP_REFUND_ADDRESS;
    expect((await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }))).status).toBe(501);

    process.env.ONRAMP_REFUND_ADDRESS = 'not-an-address';
    expect((await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }))).status).toBe(501);

    // The partner's public id ignores the address we pass in, so it does not count.
    process.env.ONRAMP_REFUND_ADDRESS = REFUND;
    process.env.ONRAMP_MONEY_APP_ID = '1';
    expect((await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }))).status).toBe(501);
    delete process.env.ONRAMP_MONEY_APP_ID;
    expect((await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }))).status).toBe(501);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    for (const body of [
      'not json',
      {},
      { address: 'nope', amountMinor: 2_000_000 },
      { address: ACCOUNT, amountMinor: 0 },
      { address: ACCOUNT, amountMinor: 20000.5 },
      { address: ACCOUNT, amountMinor: 600_000_000 },
    ]) {
      expect((await startOnramp(post(body))).status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('prices the transfer and answers with the partner link, the address only inside it', async () => {
    const response = await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string; payMinor: number; arrivesMinor: number; feeMinor: number };

    expect(Object.keys(body).sort()).toEqual(['arrivesMinor', 'feeMinor', 'payMinor', 'url']);
    expect(body.payMinor).toBe(2_000_000);
    expect(body.arrivesMinor).toBe(1_825_746);
    expect(body.feeMinor).toBe(174_254);

    const link = new URL(body.url);
    expect(link.host).toBe('onramp.money');
    expect(link.searchParams.get('walletAddress')).toBe(HOLDING);
    expect(link.searchParams.get('fiatAmount')).toBe('20000');
    expect(link.searchParams.get('appId')).toBe('4242');
    expect(link.searchParams.get('redirectUrl')).toBe('https://entole.vercel.app/add-money/return');
    expect(link.searchParams.get('merchantRecognitionId')).toMatch(/^add-[a-z0-9]+-[a-f0-9]{8}$/);
    // The account's own address is never handed to the partner.
    expect(body.url).not.toContain(ACCOUNT);
  });

  it('pays the conversion out to the account and sends failures to the refund account', async () => {
    await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }));
    const conversion = upstream.mock.calls.find(([url]) => String(url).includes('relay.link'))!;
    const sent = JSON.parse(String((conversion as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(sent.recipient).toBe(ACCOUNT);
    expect(sent.refundTo).toBe(REFUND);
    expect(sent.destinationCurrency).toBe(SETTLEMENT);
    expect(sent.useDepositAddress).toBe(true);
  });

  it('uses our own partner id, key and return origin when they are set', async () => {
    process.env.ONRAMP_MONEY_APP_ID = '9001';
    process.env.RELAY_API_KEY = 'relay-key';
    process.env.ONRAMP_RETURN_ORIGIN = 'https://entole.example/';
    const response = await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }, 'http://localhost:3000'));
    const body = (await response.json()) as { url: string };
    const link = new URL(body.url);
    expect(link.searchParams.get('appId')).toBe('9001');
    expect(link.searchParams.get('redirectUrl')).toBe('https://entole.example/add-money/return');
    const conversion = upstream.mock.calls.find(([url]) => String(url).includes('relay.link'))!;
    const headers = (conversion as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('relay-key');
    // The key goes to the partner, never back to the caller.
    expect(JSON.stringify(body)).not.toContain('relay-key');
  });

  it('answers 422 for an amount under the partner minimum', async () => {
    const response = await startOnramp(post({ address: ACCOUNT, amountMinor: 100_000 }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'amount_too_small' });
  });

  it('answers 502 when either partner fails', async () => {
    partnerStatus = 503;
    let response = await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'partner_unavailable' });

    partnerStatus = 200;
    conversionStatus = 500;
    response = await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }));
    expect(response.status).toBe(502);
  });

  it('limits how often one account can ask, whatever address it comes from', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await startOnramp(post({ address: ACCOUNT, amountMinor: 2_000_000 }))).status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});

describe('POST /api/onramp/deposit', () => {
  it('is off on the test network and calls nothing', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '10143';
    expect((await startDeposit(post({ address: ACCOUNT, source: 'base-usdc' }))).status).toBe(501);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects a malformed body or something we do not take', async () => {
    for (const body of ['not json', {}, { address: 'nope', source: 'base-usdc' }, { address: ACCOUNT, source: 'tron-usdt' }]) {
      expect((await startDeposit(post(body))).status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers with a scan code and nothing else, refunds going back to the sender', async () => {
    const response = await startDeposit(post({ address: ACCOUNT, source: 'base-usdc' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ qrPayload: HOLDING });

    const conversion = upstream.mock.calls.find(([url]) => String(url).includes('relay.link'))!;
    const sent = JSON.parse(String((conversion as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(sent.recipient).toBe(ACCOUNT);
    expect(sent.originChainId).toBe(8453);
    expect(sent.refundTo).toBe('0x0000000000000000000000000000000000000000');
    // No account of ours is needed for this route.
    delete process.env.ONRAMP_REFUND_ADDRESS;
    expect((await startDeposit(post({ address: ACCOUNT, source: 'monad-usdc' }))).status).toBe(200);
  });

  it('hands back the account itself for money that needs no converting', async () => {
    const response = await startDeposit(post({ address: ACCOUNT, source: 'monad-ausd' }));
    expect(await response.json()).toEqual({ qrPayload: ACCOUNT });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers 502 when the partner fails', async () => {
    conversionStatus = 500;
    const response = await startDeposit(post({ address: ACCOUNT, source: 'arbitrum-usdc' }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'partner_unavailable' });
  });
});

describe('POST /api/onramp/card', () => {
  it('is off on the test network', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '10143';
    expect((await startCard(post({ address: ACCOUNT }))).status).toBe(501);
  });

  it('rejects a malformed body', async () => {
    expect((await startCard(post({ address: 'nope' }))).status).toBe(400);
  });

  it('answers with the card page link, the account only inside it', async () => {
    const response = await startCard(post({ address: ACCOUNT }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string };
    expect(Object.keys(body)).toEqual(['url']);
    const link = new URL(body.url);
    expect(link.origin + link.pathname).toBe('https://relay.link/onramp/monad');
    expect(link.searchParams.get('toAddress')).toBe(ACCOUNT);
    expect(link.searchParams.get('toCurrency')).toBe(SETTLEMENT.toLowerCase());
    expect(upstream).not.toHaveBeenCalled();
  });
});
