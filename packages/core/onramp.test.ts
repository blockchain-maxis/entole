import type { Address } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { DEPOSIT_SOURCES, DEPOSIT_SOURCE_IDS, depositSource, depositSourceLabel } from './deposit-sources';
import {
  MONAD_USDC,
  OnrampError,
  buildBankTransferUrl,
  buildCardUrl,
  requestDepositCode,
  estimatePayoutUnits,
  fetchNairaPurchaseTerms,
  requestConversionAddress,
  startBankTransfer,
  wholeNairaKobo,
} from './onramp';

const ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
const HOLDING: Address = '0x2222222222222222222222222222222222222222';
const REFUND: Address = '0x3333333333333333333333333333333333333333';
const SETTLEMENT: Address = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a';

/** Onramp.money's live answer for ₦20,000 of USDC on Monad, 9 October 2026. */
const TERMS_BODY = {
  status: 1,
  code: 200,
  data: {
    price: 1392.47171,
    gasFee: { withdrawalFee: '0.5', minimumWithdrawal: '2', nodeInSync: 1, depositEnable: 1 },
    gatewayFee: { gatewayFee: 81, isGatewayFeeFlat: 1, gatewayFeeFiat: 108.56 },
    tdsFee: 0,
  },
};

const conversionBody = (overrides: { depositAddress?: string; out?: string; token?: string; chainId?: number } = {}) => ({
  steps: [{ id: 'deposit', depositAddress: overrides.depositAddress ?? HOLDING }],
  details: {
    currencyOut: {
      amount: overrides.out ?? '13717000',
      currency: { chainId: overrides.chainId ?? 143, address: overrides.token ?? SETTLEMENT.toLowerCase() },
    },
  },
});

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** One fetch standing in for both partners, told apart by host. */
function partners(options: { terms?: unknown; conversion?: unknown; termsStatus?: number; conversionStatus?: number } = {}) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
    String(url).includes('onramp.money')
      ? respond(options.terms ?? TERMS_BODY, options.termsStatus)
      : respond(options.conversion ?? conversionBody(), options.conversionStatus),
  );
}

const config = (fetchImpl: typeof fetch) => ({ settlementToken: SETTLEMENT, refundTo: REFUND, fetch: fetchImpl });

describe('wholeNairaKobo', () => {
  it('drops the kobo, because the partner takes whole naira only', () => {
    expect(wholeNairaKobo(2_000_099)).toBe(2_000_000);
    expect(wholeNairaKobo(99)).toBe(0);
  });
});

describe('fetchNairaPurchaseTerms', () => {
  it('asks for USDC on Monad in naira and reads the answer as integers', async () => {
    const fetchImpl = partners();
    const terms = await fetchNairaPurchaseTerms(2_000_000, { fetch: fetchImpl as unknown as typeof fetch });

    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe('https://api.onramp.money/onramp/api/v3/buy/public/coinDetails');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      coinCode: 'usdc',
      chainId: '10525',
      fiatAmount: '20000',
      fiatType: '6',
    });
    expect(terms).toEqual({
      koboPerUsdc: 139_247n,
      gatewayFeeKobo: 10_856n,
      payoutFeeUnits: 500_000n,
      minimumPayoutUnits: 2_000_000n,
    });
  });

  it('falls back to the flat gateway fee when no per-purchase figure is given', async () => {
    const body = { ...TERMS_BODY, data: { ...TERMS_BODY.data, gatewayFee: { gatewayFee: 81 } } };
    const terms = await fetchNairaPurchaseTerms(2_000_000, {
      fetch: partners({ terms: body }) as unknown as typeof fetch,
    });
    expect(terms.gatewayFeeKobo).toBe(8_100n);
  });

  it('refuses a bad status, a failed call and an answer of the wrong shape', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    for (const fetchImpl of [
      partners({ termsStatus: 503 }),
      partners({ terms: { status: 0 } }),
      partners({ terms: { ...TERMS_BODY, data: { ...TERMS_BODY.data, price: 0 } } }),
      failing,
    ]) {
      await expect(
        fetchNairaPurchaseTerms(2_000_000, { fetch: fetchImpl as unknown as typeof fetch }),
      ).rejects.toMatchObject({ code: 'partner_unavailable' });
    }
  });
});

describe('estimatePayoutUnits', () => {
  const terms = { koboPerUsdc: 139_247n, gatewayFeeKobo: 10_856n, payoutFeeUnits: 500_000n, minimumPayoutUnits: 2_000_000n };

  it('takes the gateway fee, the platform fee and the payout fee off, in that order', () => {
    // 2,000,000 − 10,856 − 5,000 = 1,984,144 kobo → 14.249096 USDC → less 0.5.
    expect(estimatePayoutUnits(2_000_000, terms)).toBe(13_749_096n);
  });

  it('comes in under what the partner showed for ₦50,000 (35.24), not over', () => {
    const at50k = { ...terms, koboPerUsdc: 139_240n, gatewayFeeKobo: 15_000n };
    const estimate = estimatePayoutUnits(5_000_000, at50k);
    expect(estimate).toBe(35_211_720n);
    expect(estimate).toBeLessThan(35_240_000n);
  });

  it('refuses an amount whose payout would fall under the partner minimum', () => {
    expect(() => estimatePayoutUnits(300_000, terms)).toThrow(OnrampError);
    expect(() => estimatePayoutUnits(5_000, terms)).toThrow(/amount_too_small/);
  });
});

describe('requestConversionAddress', () => {
  it('asks for an open holding address on Monad that pays the account in the settlement asset', async () => {
    const fetchImpl = partners();
    const result = await requestConversionAddress(
      { recipient: ACCOUNT, amountUnits: 13_749_096n },
      { ...config(fetchImpl as unknown as typeof fetch), apiKey: 'k' },
    );

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://api.relay.link/quote/v2');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(JSON.parse(String(init!.body))).toEqual({
      user: ACCOUNT,
      recipient: ACCOUNT,
      originChainId: 143,
      destinationChainId: 143,
      originCurrency: MONAD_USDC,
      destinationCurrency: SETTLEMENT,
      amount: '13749096',
      tradeType: 'EXACT_INPUT',
      useDepositAddress: true,
      refundTo: REFUND,
    });
    expect(result).toEqual({ depositAddress: HOLDING, settlementUnits: 13_717_000n });
  });

  it('sends no key header when there is no key', async () => {
    const fetchImpl = partners();
    await requestConversionAddress({ recipient: ACCOUNT, amountUnits: 1n }, config(fetchImpl as unknown as typeof fetch));
    expect(fetchImpl.mock.calls[0]![1]!.headers).not.toHaveProperty('x-api-key');
  });

  it('refuses an answer with no holding address, another asset, another network, or a bad status', async () => {
    const noAddress = { ...conversionBody(), steps: [{ id: 'deposit' }] };
    for (const fetchImpl of [
      partners({ conversion: noAddress }),
      partners({ conversion: conversionBody({ token: MONAD_USDC }) }),
      partners({ conversion: conversionBody({ chainId: 8453 }) }),
      partners({ conversion: conversionBody({ depositAddress: 'not-an-address' }) }),
      partners({ conversionStatus: 429 }),
    ]) {
      await expect(
        requestConversionAddress({ recipient: ACCOUNT, amountUnits: 1n }, config(fetchImpl as unknown as typeof fetch)),
      ).rejects.toMatchObject({ code: 'partner_unavailable' });
    }
  });
});

describe('buildBankTransferUrl', () => {
  const input = {
    depositAddress: HOLDING,
    payKobo: 2_000_050,
    reference: 'add-1728500000',
    returnUrl: 'https://entole.vercel.app/add-money/return',
  };

  it('fills in every field so the person lands on the payment step', () => {
    const url = new URL(buildBankTransferUrl(input));
    expect(url.origin + url.pathname).toBe('https://onramp.money/main/buy/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appId: '1',
      walletAddress: HOLDING,
      coinCode: 'usdc',
      network: 'monad',
      fiatType: '6',
      fiatAmount: '20000',
      paymentMethod: '2',
      merchantRecognitionId: 'add-1728500000',
      redirectUrl: 'https://entole.vercel.app/add-money/return',
    });
  });

  it('uses our own app id once there is one', () => {
    expect(new URL(buildBankTransferUrl({ ...input, appId: '4242' })).searchParams.get('appId')).toBe('4242');
  });

  it('refuses a return address that is not https', () => {
    expect(() => buildBankTransferUrl({ ...input, returnUrl: 'http://entole.vercel.app/x' })).toThrow(/https/);
  });
});

describe('startBankTransfer', () => {
  const input = {
    recipient: ACCOUNT,
    payKobo: 2_000_000,
    koboPerDollar: 133_101,
    reference: 'add-1',
    returnUrl: 'https://entole.vercel.app/add-money/return',
  };

  it('prices the transfer in the account’s own rate and points the payout at the holding address', async () => {
    const fetchImpl = partners();
    const offer = await startBankTransfer(input, config(fetchImpl as unknown as typeof fetch));

    // 13.717 dollars at ₦1,331.01 is ₦18,257.46; the rest of the ₦20,000 is the fee.
    expect(offer.payMinor).toBe(2_000_000);
    expect(offer.arrivesMinor).toBe(1_825_746);
    expect(offer.feeMinor).toBe(174_254);
    expect(offer.payMinor).toBe(offer.arrivesMinor + offer.feeMinor);

    const url = new URL(offer.url);
    expect(url.searchParams.get('walletAddress')).toBe(HOLDING);
    expect(url.searchParams.get('walletAddress')).not.toBe(ACCOUNT);
    expect(url.searchParams.get('fiatAmount')).toBe('20000');

    // The conversion is priced on what the partner is expected to pay out.
    const conversionCall = fetchImpl.mock.calls.find(([url]) => String(url).includes('relay.link'))!;
    expect(JSON.parse(String(conversionCall[1]!.body)).amount).toBe('13749096');
  });

  it('never asks for a holding address when the amount is too small', async () => {
    const fetchImpl = partners();
    await expect(
      startBankTransfer({ ...input, payKobo: 100_000 }, config(fetchImpl as unknown as typeof fetch)),
    ).rejects.toMatchObject({ code: 'amount_too_small' });
    await expect(
      startBankTransfer({ ...input, payKobo: 50 }, config(fetchImpl as unknown as typeof fetch)),
    ).rejects.toMatchObject({ code: 'amount_too_small' });
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('relay.link'))).toBe(false);
  });

  it('never shows a negative fee', async () => {
    const generous = partners({ conversion: conversionBody({ out: '99000000' }) });
    const offer = await startBankTransfer(input, config(generous as unknown as typeof fetch));
    expect(offer.feeMinor).toBe(0);
  });
});

describe('deposit sources', () => {
  it('names each one the way the other app does, with no repeats', () => {
    expect(DEPOSIT_SOURCES.map(depositSourceLabel)).toEqual([
      'AUSD on Monad',
      'USDC on Monad',
      'MON on Monad',
      'USDC on Base',
      'USDC on Arbitrum',
      'USDC on Ethereum',
    ]);
    expect(new Set(DEPOSIT_SOURCE_IDS).size).toBe(DEPOSIT_SOURCES.length);
    expect(depositSource('base-usdc')?.place).toBe('Base');
    expect(depositSource('tron-usdt')).toBeUndefined();
  });
});

describe('requestDepositCode', () => {
  const base = { settlementToken: SETTLEMENT };

  it('sends AUSD already on Monad straight to the account, asking nobody', async () => {
    const fetchImpl = partners();
    const result = await requestDepositCode(
      { recipient: ACCOUNT, source: 'monad-ausd' },
      { ...base, fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual({ code: ACCOUNT });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['monad-usdc', 143, MONAD_USDC, '5000000'],
    ['monad-mon', 143, '0x0000000000000000000000000000000000000000', '200000000000000000000'],
    ['base-usdc', 8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '5000000'],
    ['arbitrum-usdc', 42161, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', '5000000'],
    ['ethereum-usdc', 1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '5000000'],
  ] as const)('%s gets a holding address that pays the account and refunds the sender', async (source, chainId, currency, amount) => {
    const fetchImpl = partners();
    const result = await requestDepositCode(
      { recipient: ACCOUNT, source },
      { ...base, fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual({ code: HOLDING });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({
      user: ACCOUNT,
      recipient: ACCOUNT,
      originChainId: chainId,
      destinationChainId: 143,
      originCurrency: currency,
      destinationCurrency: SETTLEMENT,
      amount,
      tradeType: 'EXACT_INPUT',
      useDepositAddress: true,
      // The zero address is the partner's "back to whoever sent it".
      refundTo: '0x0000000000000000000000000000000000000000',
    });
  });

  it('refuses when the partner would deliver something other than the settlement asset', async () => {
    const wrong = partners({ conversion: conversionBody({ token: MONAD_USDC }) });
    await expect(
      requestDepositCode({ recipient: ACCOUNT, source: 'base-usdc' }, { ...base, fetch: wrong as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'partner_unavailable' });
  });
});

describe('buildCardUrl', () => {
  it('opens the card page on the settlement asset with the account set', () => {
    const url = new URL(buildCardUrl({ recipient: ACCOUNT, settlementToken: SETTLEMENT }));
    expect(url.origin + url.pathname).toBe('https://relay.link/onramp/monad');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      toCurrency: SETTLEMENT.toLowerCase(),
      toAddress: ACCOUNT,
    });
  });
});
