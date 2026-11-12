import { describe, expect, it, vi } from 'vitest';

import {
  ASSETS,
  checkSwapIntent,
  centsToUnits,
  formatPocketAmount,
  payInSource,
  prepareSwap,
  readMovement,
  readPockets,
  requestPocketDeposit,
  unitsToCents,
  type PocketBalance,
} from './intents-pockets';

const owner = '0x8C1422e82d91b0a4609b78374e74a9DCb5e65df3' as const;
const account = owner.toLowerCase();
const now = new Date('2026-11-12T14:44:10Z');

/** The intent 1Click wrote for a USDC → EURe swap on 12 November 2026, unchanged. */
const realIntent = {
  standard: 'erc191' as const,
  payload: JSON.stringify({
    verifying_contract: 'intents.near',
    signer_id: account,
    deadline: '2026-11-15T15:14:10.000Z',
    nonce: 'Vij2xgAlKBKzABTgMMFA6Bje6LkPYBiFVmNVfQJJewU=',
    intents: [{
      intent: 'transfer',
      receiver_id: '2ca830b3d37b4f679ce46e4dacd99d89970158aa0f71b229da5dc6c7a1d83da7',
      tokens: { [ASSETS.nearUsdc]: '5000000' },
    }],
  }),
};
const expected = {
  owner,
  depositAddress: '2ca830b3d37b4f679ce46e4dacd99d89970158aa0f71b229da5dc6c7a1d83da7',
  assetId: ASSETS.nearUsdc,
  units: '5000000',
  now,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('amounts', () => {
  it('turns token units into cents, rounding down', () => {
    expect(unitsToCents(5_000_000n, 6)).toBe(500);
    expect(unitsToCents(4_487_500_585_139_287_848n, 18)).toBe(448);
    expect(centsToUnits(500, 18)).toBe(5_000_000_000_000_000_000n);
    expect(() => centsToUnits(1.5, 6)).toThrow();
  });

  it('writes each currency with its own sign', () => {
    expect(formatPocketAmount(120_450, 'EUR')).toBe('€1,204.50');
    expect(formatPocketAmount(5, 'GBP')).toBe('£0.05');
    expect(formatPocketAmount(100_000_000, 'USD')).toBe('$1,000,000.00');
  });
});

describe('reading the pockets', () => {
  it('reads every holding in one call and adds the dollar ones up', async () => {
    const answer = ['1000000', '250000', '0', '0', '2000000000000000000', '0'];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const args = JSON.parse(atob(body.params.args_base64));
      expect(body.params.method_name).toBe('mt_batch_balance_of');
      expect(args.account_id).toBe(account);
      expect(args.token_ids).toHaveLength(6);
      return json({ result: { result: [...new TextEncoder().encode(JSON.stringify(answer))] } });
    });
    const pockets = await readPockets({ owner, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(pockets.map((pocket) => [pocket.id, pocket.cents])).toEqual([['usd', 125], ['eur', 200], ['gbp', 0]]);
    expect(pockets[0]!.holdings).toHaveLength(2);
  });
});

describe('the intent the person is asked to confirm', () => {
  it('accepts the intent 1Click really wrote', () => {
    expect(() => checkSwapIntent(realIntent, expected)).not.toThrow();
  });

  it('refuses one that moves more, goes elsewhere, or is someone else\'s', () => {
    const altered = (change: (payload: Record<string, unknown> & { intents: Record<string, unknown>[] }) => void) => {
      const payload = JSON.parse(realIntent.payload);
      change(payload);
      return { ...realIntent, payload: JSON.stringify(payload) };
    };
    expect(() => checkSwapIntent(altered((p) => { p.intents[0]!.tokens = { [ASSETS.nearUsdc]: '5000001' }; }), expected)).toThrow(/amount/);
    expect(() => checkSwapIntent(altered((p) => { p.intents[0]!.receiver_id = 'someone.near'; }), expected)).toThrow(/somewhere else/);
    expect(() => checkSwapIntent(altered((p) => { p.signer_id = '0x' + '1'.repeat(40); }), expected)).toThrow(/someone else/);
    expect(() => checkSwapIntent(altered((p) => { p.intents.push({ intent: 'transfer' }); }), expected)).toThrow(/more than one/);
    expect(() => checkSwapIntent(altered((p) => { p.verifying_contract = 'evil.near'; }), expected)).toThrow(/contract/);
  });
});

describe('swapping', () => {
  it('quotes from the account to the account, then checks what it is asked to confirm', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url, body });
      if (url.endsWith('/v0/quote')) {
        return json({ correlationId: 'c-1', quote: { depositAddress: expected.depositAddress, amountIn: '5000000', amountOut: '4487500585139287848', minAmountOut: '4442625579287894969', deadline: '2026-11-15T15:14:10.000Z', timeEstimate: 10 } });
      }
      return json({ intent: realIntent });
    });
    const balance: PocketBalance = { id: 'usd', currency: 'USD', cents: 900, holdings: [{ assetId: ASSETS.nearUsdc, units: '9000000' }] };
    const swap = await prepareSwap({ owner, from: 'usd', to: 'eur', cents: 500, balance }, { fetch: fetch as unknown as typeof globalThis.fetch, now: () => now });
    expect(calls[0]!.body).toMatchObject({ depositType: 'INTENTS', recipientType: 'INTENTS', refundType: 'INTENTS', recipient: account, refundTo: account, originAsset: ASSETS.nearUsdc, destinationAsset: ASSETS.gnosisEure, amount: '5000000' });
    expect(swap).toMatchObject({ receivesCents: 448, receivesAtLeastCents: 444 });
  });

  it('does not quote what the pocket does not hold', async () => {
    const balance: PocketBalance = { id: 'usd', currency: 'USD', cents: 100, holdings: [{ assetId: ASSETS.nearUsdc, units: '1000000' }] };
    await expect(prepareSwap({ owner, from: 'usd', to: 'eur', cents: 500, balance }, { fetch: vi.fn() as unknown as typeof globalThis.fetch })).rejects.toThrow(/not enough/);
  });
});

describe('paying into a pocket', () => {
  it('asks for the exact amount to arrive for an invoice, held for the receiver if it fails', async () => {
    let sent: Record<string, unknown> = {};
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return json({ quote: { depositAddress: 'TXYZ', amountIn: '10050000', amountOut: '10000000', timeEstimate: 60 } });
    });
    const quote = await requestPocketDeposit(
      { recipient: owner, source: payInSource('tron-usdt')!, pocket: 'usd', exact: 'receive', cents: 1_000 },
      { fetch: fetch as unknown as typeof globalThis.fetch, now: () => now },
    );
    expect(sent).toMatchObject({ swapType: 'EXACT_OUTPUT', depositType: 'ORIGIN_CHAIN', recipientType: 'INTENTS', refundType: 'INTENTS', amount: '10000000', originAsset: ASSETS.tronUsdt });
    expect(quote.receivesCents).toBe(1_000);
  });
});

describe('status', () => {
  it('reads 1Click\'s words as real states, and unknown addresses as nothing', async () => {
    const answer = (status: string) => vi.fn(async () => json({ status, swapDetails: { amountOut: '1' } })) as unknown as typeof globalThis.fetch;
    expect((await readMovement('x', { fetch: answer('SUCCESS') }))?.state).toBe('done');
    expect((await readMovement('x', { fetch: answer('PENDING_DEPOSIT') }))?.state).toBe('waiting');
    expect((await readMovement('x', { fetch: answer('REFUNDED') }))?.state).toBe('returned');
    expect((await readMovement('x', { fetch: answer('SOMETHING_NEW') }))?.state).toBe('on_its_way');
    expect(await readMovement('x', { fetch: vi.fn(async () => json({ message: 'not found' }, 404)) as unknown as typeof globalThis.fetch })).toBeNull();
  });
});
