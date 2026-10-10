import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as depositStatus, POST as startDeposit } from '@/app/api/aurora/deposit/route';
import { resetRateLimits } from '@/lib/server/sponsor';

/**
 * Adding money from Tron or Solana through Aurora, with both partners replaced
 * by a stubbed `fetch`: no network, no key, no money. The route stays off away
 * from the main network, asks the conversion partner for a holding address
 * first and Aurora second, hands the answer back only as something to draw as
 * a scan code, and turns each refusal into a plain code.
 */

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const HOLDING = '0x2222222222222222222222222222222222222222';
const SETTLEMENT = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a';
const TRON_ACCOUNT = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
const TRON_DEPOSIT = 'TXdepositAddressGoodForOneDepositOnly1';
let ipCounter = 0;

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function post(body: unknown) {
  return new Request('https://entole.vercel.app/api/aurora/deposit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.12.0.${++ipCounter}` },
    body: JSON.stringify(body),
  });
}
const status = (depositAddress: string) =>
  new Request(`https://entole.vercel.app/api/aurora/deposit?depositAddress=${depositAddress}`, {
    headers: { 'x-forwarded-for': `10.13.0.${++ipCounter}` },
  });

/** 150 dollars in, priced by the conversion partner as 149.8 of the account's money. */
const CONVERSION = {
  steps: [{ id: 'deposit', depositAddress: HOLDING }],
  details: { currencyOut: { amount: '149800000', currency: { chainId: 143, address: SETTLEMENT } } },
};
const QUOTE = {
  quote: {
    depositAddress: TRON_DEPOSIT,
    deadline: '2026-10-10T23:03:00.000Z',
    amountIn: '150000000',
    minAmountIn: '148500000',
    amountOut: '149539746',
    minAmountOut: '148044348',
    timeEstimate: 82,
  },
};

let aurora: () => Response = () => reply(QUOTE);
let conversionStatus = 200;
const upstream = vi.fn(async (url: string | URL | Request) => {
  const target = String(url);
  if (target.includes('intents-api.aurora.dev')) return aurora();
  return reply(CONVERSION, conversionStatus);
});

const body = { address: ACCOUNT, source: 'tron-usdt', amountUnits: '150000000', returnAccount: TRON_ACCOUNT };

beforeEach(() => {
  resetRateLimits();
  upstream.mockClear();
  aurora = () => reply(QUOTE);
  conversionStatus = 200;
  vi.stubGlobal('fetch', upstream);
  process.env.NEXT_PUBLIC_CHAIN_ID = '143';
  process.env.NEXT_PUBLIC_ENTOLE_TOKEN_ADDRESS = SETTLEMENT;
  process.env.AURORA_INTENTS_API_KEY = 'aurora-key';
  delete process.env.AURORA_INTENTS_API_BASE;
  delete process.env.RELAY_API_KEY;
});

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/aurora/deposit', () => {
  it('is off away from the main network and without a key, and asks nobody', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '10143';
    expect((await startDeposit(post(body))).status).toBe(501);
    expect((await depositStatus(status(TRON_DEPOSIT))).status).toBe(501);
    process.env.NEXT_PUBLIC_CHAIN_ID = '143';
    delete process.env.AURORA_INTENTS_API_KEY;
    expect((await startDeposit(post(body))).status).toBe(501);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('gets a holding address first, then has Aurora deliver to it, and returns only a scan code', async () => {
    const response = await startDeposit(post(body));
    expect(response.status).toBe(200);
    const answer = (await response.json()) as Record<string, unknown>;
    expect(answer).toEqual({
      qrPayload: TRON_DEPOSIT,
      sendUnits: '150000000',
      minimumUnits: '148500000',
      // 149.8 priced for 150 in; 149.539746 reaches the conversion.
      arrivesAboutUnits: '149340359',
      deadline: '2026-10-10T23:03:00.000Z',
      etaSeconds: 82,
    });
    expect(answer).not.toHaveProperty('depositAddress');

    expect(upstream).toHaveBeenCalledTimes(2);
    const [conversionUrl, conversionInit] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    const [auroraUrl, auroraInit] = upstream.mock.calls[1] as unknown as [string, RequestInit];
    expect(conversionUrl).toContain('relay.link');
    // A conversion that cannot be completed leaves the money in the person's own account.
    expect(JSON.parse(String(conversionInit.body))).toMatchObject({ recipient: ACCOUNT, refundTo: ACCOUNT });
    expect(auroraUrl).toBe('https://intents-api.aurora.dev/api/quote/aurora-key');
    expect(JSON.parse(String(auroraInit.body))).toMatchObject({
      dry: false,
      recipient: HOLDING,
      refundTo: TRON_ACCOUNT,
      amount: '150000000',
    });
  });

  it('says how much is the least when the amount is too small', async () => {
    aurora = () => reply({ message: 'Temporary swap limits: minimum swap amount is $100' }, 400);
    const response = await startDeposit(post({ ...body, amountUnits: '20000000' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'amount_too_small', minimumDollars: 100 });
  });

  it('refuses a return account that is not one on the sending network', async () => {
    const response = await startDeposit(post({ ...body, returnAccount: 'T'.padEnd(34, '0') }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_return_account' });
    // An account of ours is not one on Tron either.
    expect((await startDeposit(post({ ...body, returnAccount: ACCOUNT }))).status).toBe(400);
  });

  it('rejects a body that makes no sense', async () => {
    expect((await startDeposit(post({ ...body, amountUnits: '0' }))).status).toBe(400);
    expect((await startDeposit(post({ ...body, amountUnits: '1.5' }))).status).toBe(400);
    expect((await startDeposit(post({ ...body, source: 'bitcoin' }))).status).toBe(400);
    expect((await startDeposit(post({ ...body, address: 'nope' }))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers 502 when either partner cannot do it, and never asks Aurora without a holding address', async () => {
    conversionStatus = 503;
    expect((await startDeposit(post(body))).status).toBe(502);
    expect(upstream.mock.calls.every(([url]) => !String(url).includes('aurora'))).toBe(true);
    conversionStatus = 200;
    aurora = () => reply({}, 500);
    expect((await startDeposit(post(body))).status).toBe(502);
  });
});

describe('GET /api/aurora/deposit', () => {
  it('says how far a deposit has got', async () => {
    aurora = () => reply({ status: 'PROCESSING' });
    const response = await depositStatus(status(TRON_DEPOSIT));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'on_its_way' });
    expect(String(upstream.mock.calls[0]![0])).toBe(
      `https://intents-api.aurora.dev/api/status/aurora-key?depositAddress=${TRON_DEPOSIT}`,
    );
  });

  it('rejects something that is not an address, and reports a state it does not know as unavailable', async () => {
    expect((await depositStatus(status('../etc'))).status).toBe(400);
    aurora = () => reply({ status: 'SOMETHING_NEW' });
    expect((await depositStatus(status(TRON_DEPOSIT))).status).toBe(502);
  });
});
