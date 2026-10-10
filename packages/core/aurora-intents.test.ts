import { describe, expect, it, vi } from 'vitest';

import {
  AURORA_MONAD_USDC,
  AuroraError,
  auroraSource,
  isReturnAccount,
  readAuroraDeposit,
  requestAuroraDeposit,
} from './aurora-intents';

/**
 * The bodies below are cut down from what the live service answered on
 * 10 October 2026 (free price checks; no deposit was made). They pin the
 * shapes this code reads.
 */
const RECIPIENT = '0x8f0c2D4eB6aa368069b16D03708932731625F069';
const TRON_ACCOUNT = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
const SOLANA_ACCOUNT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const QUOTE = {
  quote: {
    depositAddress: 'TXdepositAddressGoodForOneDepositOnly1',
    deadline: '2026-10-10T23:03:00.000Z',
    amountIn: '150000000',
    minAmountIn: '148500000',
    amountOut: '149539746',
    minAmountOut: '148044348',
    timeEstimate: 82,
  },
};
const TOO_SMALL = { message: 'Temporary swap limits: minimum swap amount is $100', path: '/v0/quote' };

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const NOW = () => new Date('2026-10-10T22:03:00.000Z');
const request = { source: 'tron-usdt', amountUnits: 150_000_000n, recipient: RECIPIENT, returnAccount: TRON_ACCOUNT } as const;

function config(fetchImpl: ReturnType<typeof vi.fn>) {
  return { apiKey: 'key-1', fetch: fetchImpl as unknown as typeof fetch, now: NOW };
}

describe('what can be sent in', () => {
  it('knows an account on each sending network by its shape', () => {
    expect(isReturnAccount(auroraSource('tron-usdt')!, TRON_ACCOUNT)).toBe(true);
    expect(isReturnAccount(auroraSource('tron-usdt')!, ` ${TRON_ACCOUNT} `)).toBe(true);
    expect(isReturnAccount(auroraSource('tron-usdt')!, RECIPIENT)).toBe(false);
    expect(isReturnAccount(auroraSource('tron-usdt')!, SOLANA_ACCOUNT)).toBe(false);
    expect(isReturnAccount(auroraSource('solana-usdc')!, SOLANA_ACCOUNT)).toBe(true);
    expect(isReturnAccount(auroraSource('solana-usdc')!, RECIPIENT)).toBe(false);
  });
});

describe('requestAuroraDeposit', () => {
  it('asks nothing without a key', async () => {
    const fetchImpl = vi.fn();
    await expect(requestAuroraDeposit(request)).rejects.toMatchObject({ code: 'not_configured' });
    await expect(
      requestAuroraDeposit(request, { apiKey: '', fetch: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(AuroraError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prices one deposit and answers with where to send it', async () => {
    const fetchImpl = vi.fn(async () => reply(QUOTE));
    const deposit = await requestAuroraDeposit(request, config(fetchImpl));
    expect(deposit).toEqual({
      depositAddress: QUOTE.quote.depositAddress,
      amountUnits: 150_000_000n,
      minimumUnits: 148_500_000n,
      arrivesUnits: 149_539_746n,
      arrivesAtLeastUnits: 148_044_348n,
      deadline: '2026-10-10T23:03:00.000Z',
      etaSeconds: 82,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://intents-api.aurora.dev/api/quote/key-1');
    expect(JSON.parse(String(init.body))).toEqual({
      dry: false,
      swapType: 'FLEX_INPUT',
      depositMode: 'SIMPLE',
      depositType: 'ORIGIN_CHAIN',
      slippageTolerance: 100,
      originAsset: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near',
      destinationAsset: AURORA_MONAD_USDC,
      amount: '150000000',
      refundTo: TRON_ACCOUNT,
      refundType: 'ORIGIN_CHAIN',
      recipient: RECIPIENT,
      recipientType: 'DESTINATION_CHAIN',
      deadline: '2026-10-10T23:03:00.000Z',
    });
  });

  it('a dry run prices and makes no address', async () => {
    const { depositAddress: _made, deadline: _until, ...priced } = QUOTE.quote;
    const fetchImpl = vi.fn(async () => reply({ quote: priced }));
    const deposit = await requestAuroraDeposit({ ...request, dry: true }, config(fetchImpl));
    expect(deposit.depositAddress).toBeUndefined();
    expect(deposit.arrivesUnits).toBe(149_539_746n);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).dry).toBe(true);
  });

  it('says how much is the least, when the service says an amount is too small', async () => {
    const fetchImpl = vi.fn(async () => reply(TOO_SMALL, 400));
    await expect(
      requestAuroraDeposit({ ...request, amountUnits: 20_000_000n }, config(fetchImpl)),
    ).rejects.toMatchObject({ code: 'amount_too_small', minimumDollars: 100 });
  });

  it('refuses a return account of the wrong shape before asking, and one the service refuses after', async () => {
    const fetchImpl = vi.fn(async () => reply({ message: 'refundTo is not valid' }, 400));
    await expect(
      requestAuroraDeposit({ ...request, returnAccount: RECIPIENT }, config(fetchImpl)),
    ).rejects.toMatchObject({ code: 'bad_return_account' });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(requestAuroraDeposit(request, config(fetchImpl))).rejects.toMatchObject({ code: 'bad_return_account' });
  });

  it('never offers an address it did not get, or one that needs a memo', async () => {
    const { depositAddress: _made, ...noAddress } = QUOTE.quote;
    await expect(
      requestAuroraDeposit(request, config(vi.fn(async () => reply({ quote: noAddress })))),
    ).rejects.toMatchObject({ code: 'partner_unavailable' });
    await expect(
      requestAuroraDeposit(request, config(vi.fn(async () => reply({ quote: { ...QUOTE.quote, depositMemo: '12345' } })))),
    ).rejects.toMatchObject({ code: 'partner_unavailable' });
  });

  it('reports the service being down, unreadable or unreachable as unavailable', async () => {
    await expect(requestAuroraDeposit(request, config(vi.fn(async () => reply({}, 503))))).rejects.toMatchObject({
      code: 'partner_unavailable',
    });
    await expect(requestAuroraDeposit(request, config(vi.fn(async () => reply({ quote: {} }))))).rejects.toMatchObject({
      code: 'partner_unavailable',
    });
    await expect(
      requestAuroraDeposit(
        request,
        config(
          vi.fn(async () => {
            throw new TypeError('fetch failed');
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'partner_unavailable' });
  });

  it('refuses a zero amount without asking', async () => {
    const fetchImpl = vi.fn();
    await expect(requestAuroraDeposit({ ...request, amountUnits: 0n }, config(fetchImpl))).rejects.toMatchObject({
      code: 'amount_too_small',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('readAuroraDeposit', () => {
  it('turns the service’s states into the ones a screen needs', async () => {
    const states: [string, string][] = [
      ['PENDING_DEPOSIT', 'waiting'],
      ['KNOWN_DEPOSIT_TX', 'on_its_way'],
      ['PROCESSING', 'on_its_way'],
      ['SUCCESS', 'arrived'],
      ['INCOMPLETE_DEPOSIT', 'too_little'],
      ['REFUNDED', 'returned'],
      ['FAILED', 'failed'],
    ];
    for (const [theirs, ours] of states) {
      const fetchImpl = vi.fn(async () => reply({ status: theirs, updatedAt: '2026-10-10T22:10:00.000Z' }));
      expect(await readAuroraDeposit('TXdeposit', config(fetchImpl))).toBe(ours);
      expect(String((fetchImpl.mock.calls[0] as unknown as [string])[0])).toBe(
        'https://intents-api.aurora.dev/api/status/key-1?depositAddress=TXdeposit',
      );
    }
  });

  it('does not guess at a state it does not know, or at no answer', async () => {
    await expect(
      readAuroraDeposit('TXdeposit', config(vi.fn(async () => reply({ status: 'SOMETHING_NEW' })))),
    ).rejects.toMatchObject({ code: 'partner_unavailable' });
    await expect(readAuroraDeposit('TXdeposit', config(vi.fn(async () => reply({}, 404))))).rejects.toMatchObject({
      code: 'partner_unavailable',
    });
    await expect(readAuroraDeposit('TXdeposit')).rejects.toMatchObject({ code: 'not_configured' });
  });
});
