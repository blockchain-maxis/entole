import { createSecp256k1SigningSession } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSETS } from '@entole/core/intents-pockets';
import { buildInvoicePaysMessage } from '@entole/core/invoice-pay';

import { GET as pockets } from '@/app/api/pockets/route';
import { POST as deposit } from '@/app/api/pockets/deposit/route';
import { GET as swapStatus, POST as swap } from '@/app/api/pockets/swap/route';
import { GET as payStatus, POST as invoicePay } from '@/app/api/invoice/pay/route';
import { resetInvoicePayments } from '@/lib/server/pockets';
import { resetRateLimits } from '@/lib/server/sponsor';

/**
 * Currency pockets and invoices paid from other networks. NEAR, 1Click, the
 * rate and the directory are stubbed: no network, no key, no money.
 */

const owner = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(32).fill(5) }));
const stranger = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(32).fill(6) }));
const account = owner.address.toLowerCase();
let ip = 0;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const balances = ['9000000', '0', '0', '0', '0', '0'];
const DEPOSIT = 'a'.repeat(64);

const intentFor = (units: string, receiver = DEPOSIT) => ({
  standard: 'erc191',
  payload: JSON.stringify({
    verifying_contract: 'intents.near',
    signer_id: account,
    deadline: '2099-01-01T00:00:00.000Z',
    nonce: 'n',
    intents: [{ intent: 'transfer', receiver_id: receiver, tokens: { [ASSETS.nearUsdc]: units } }],
  }),
});

let generated = intentFor('5000000');
const sent: { url: string; body: unknown }[] = [];
const upstream = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const target = String(url);
  sent.push({ url: target, body: init?.body ? JSON.parse(String(init.body)) : null });
  if (target.includes('near.org')) return reply({ result: { result: [...new TextEncoder().encode(JSON.stringify(balances))] } });
  if (target.endsWith('/v0/tokens')) return reply([{ assetId: ASSETS.nearUsdc, decimals: 6, price: 1 }, { assetId: ASSETS.gnosisEure, decimals: 18, price: 1.1 }]);
  if (target.endsWith('/v0/quote')) return reply({ correlationId: 'c1', quote: { depositAddress: DEPOSIT, amountIn: '5000000', amountOut: '4400000000000000000', timeEstimate: 20 } });
  if (target.endsWith('/v0/generate-intent')) return reply({ intent: generated });
  if (target.endsWith('/v0/submit-intent')) return reply({ intentHash: 'h1' });
  if (target.includes('/v0/status')) return reply({ status: 'SUCCESS', correlationId: 'c1', swapDetails: { amountOut: '6600000' } });
  if (target.includes('er-api')) return reply({ result: 'success', time_last_update_unix: 1_700_000_000, rates: { NGN: 1500 } });
  if (target.includes('upstash') || target.includes('redis')) return reply({ result: null });
  return reply({ message: 'unexpected' }, 500);
});

vi.mock('@/lib/server/directory', () => ({
  getUsernameOwner: async (username: string) => (username === 'ada.eze' ? owner.address : null),
}));

const req = (path: string, body?: unknown) =>
  new Request(`https://entole.pro${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.30.0.${++ip}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  resetRateLimits();
  resetInvoicePayments();
  upstream.mockClear();
  sent.length = 0;
  generated = intentFor('5000000');
  vi.stubGlobal('fetch', upstream);
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.POCKETS_ENABLED;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pockets', () => {
  it('reads each pocket and its dollar worth', async () => {
    const response = await pockets(req(`/api/pockets?address=${owner.address}`));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pockets[0]).toMatchObject({ id: 'usd', cents: 900, usdCents: 900, words: 'Dollars' });
  });

  it('can be switched off', async () => {
    process.env.POCKETS_ENABLED = 'false';
    expect((await pockets(req(`/api/pockets?address=${owner.address}`))).status).toBe(501);
  });

  it('gives a one-time code for adding money, never anything else about the account', async () => {
    const response = await deposit(req('/api/pockets/deposit', { address: owner.address, pocket: 'usd', source: 'tron-usdt', cents: 1000 }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['deadline', 'etaSeconds', 'qrPayload', 'receivesCents']);
    expect(sent.find((call) => call.url.endsWith('/v0/quote'))?.body).toMatchObject({ recipientType: 'INTENTS', recipient: account, refundType: 'INTENTS' });
  });
});

describe('swapping', () => {
  it('shows the rate for an empty pocket with a dry quote, and nothing that can be signed', async () => {
    balances[0] = '0';
    try {
      const response = await swap(req('/api/pockets/swap', { action: 'preview', address: owner.address, from: 'usd', to: 'eur', cents: 500 }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(Object.keys(body).sort()).toEqual(['etaSeconds', 'receivesAtLeastCents', 'receivesCents']);
      expect(body.receivesCents).toBe(440);
      expect(sent.find((call) => call.url.endsWith('/v0/quote'))?.body).toMatchObject({ dry: true });
      expect(sent.some((call) => call.url.endsWith('/v0/generate-intent'))).toBe(false);
    } finally {
      balances[0] = '9000000';
    }
  });

  it('prepares a swap whose intent moves exactly the amount, and hands on only the owner\'s signature', async () => {
    const prepared = await (await swap(req('/api/pockets/swap', { action: 'prepare', address: owner.address, from: 'usd', to: 'eur', cents: 500 }))).json();
    expect(prepared).toMatchObject({ followId: DEPOSIT, receivesCents: 440 });

    const bad = await swap(req('/api/pockets/swap', {
      action: 'submit', address: owner.address, intent: prepared.intent,
      signature: await stranger.signMessage({ message: prepared.intent.payload }),
    }));
    expect(bad.status).toBe(401);

    const good = await swap(req('/api/pockets/swap', {
      action: 'submit', address: owner.address, intent: prepared.intent,
      signature: await owner.signMessage({ message: prepared.intent.payload }),
    }));
    expect(await good.json()).toEqual({ submitted: true, reference: 'h1' });
    expect((await (await swapStatus(req(`/api/pockets/swap?followId=${DEPOSIT}`))).json()).state).toBe('done');
  });

  it('refuses an intent that does not match the quote', async () => {
    generated = intentFor('9999999');
    const response = await swap(req('/api/pockets/swap', { action: 'prepare', address: owner.address, from: 'usd', to: 'eur', cents: 500 }));
    expect(response.status).toBe(502);
  });

  it('refuses more than the pocket holds', async () => {
    const response = await swap(req('/api/pockets/swap', { action: 'prepare', address: owner.address, from: 'usd', to: 'eur', cents: 5000 }));
    expect(response.status).toBe(400);
  });
});

describe('an invoice paid from another network', () => {
  it('prices the invoice in dollars at the live rate, into the business\'s own account', async () => {
    const response = await invoicePay(req('/api/invoice/pay', { action: 'quote', username: 'ada.eze', reference: 'INV-0001', amountMinor: 1_500_000, source: 'solana-usdc' }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ qrPayload: DEPOSIT, invoiceCents: 1000, sendCents: 500 });
    expect(JSON.stringify(body)).not.toContain(account);
    expect(sent.find((call) => call.url.endsWith('/v0/quote'))?.body).toMatchObject({ swapType: 'EXACT_OUTPUT', amount: '10000000', recipient: account, recipientType: 'INTENTS' });
    expect((await (await payStatus(req(`/api/invoice/pay?depositAddress=${DEPOSIT}`))).json()).state).toBe('done');
  });

  it('does not know a business that is not in the directory', async () => {
    const response = await invoicePay(req('/api/invoice/pay', { action: 'quote', username: 'nobody.here', reference: 'INV-1', amountMinor: 1_500_000, source: 'solana-usdc' }));
    expect(response.status).toBe(404);
  });

  it('tells only the business, signed, what its invoices received', async () => {
    await invoicePay(req('/api/invoice/pay', { action: 'quote', username: 'ada.eze', reference: 'INV-0001', amountMinor: 1_500_000, source: 'solana-usdc' }));
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const references = ['INV-0001'];
    const message = buildInvoicePaysMessage({ account: owner.address, timestampSeconds, references });

    const forged = await invoicePay(req('/api/invoice/pay', { action: 'list', account: owner.address, timestampSeconds, references, signature: await stranger.signMessage({ message }) }));
    expect(forged.status).toBe(401);

    const listed = await (await invoicePay(req('/api/invoice/pay', { action: 'list', account: owner.address, timestampSeconds, references, signature: await owner.signMessage({ message }) }))).json();
    expect(listed.invoices[0]).toMatchObject({ reference: 'INV-0001', payments: [{ source: 'solana-usdc', state: 'done', cents: 660, reference: 'c1' }] });
  });
});
