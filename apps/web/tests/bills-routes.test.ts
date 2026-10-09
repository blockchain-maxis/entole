import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as pay } from '@/app/api/bills/pay/route';
import { POST as validate } from '@/app/api/bills/validate/route';
import { getServerRate } from '@/lib/server/bills';
import { getRouterAddress, getSponsor, resetRateLimits, type Sponsor } from '@/lib/server/sponsor';

/**
 * The bill routes with a fake sponsor, a stubbed biller (`fetch`) and a fixed
 * rate: no network, no keys. What matters most is the ORDER and the checks:
 * the biller is never called before the person's payment settles, never for a
 * payment that does not cover the bill or does not go to the bills account,
 * and never from the business's own balance.
 */
vi.mock('@/lib/server/sponsor', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/server/sponsor')>()),
  getSponsor: vi.fn(),
  getRouterAddress: vi.fn(),
}));
vi.mock('@/lib/server/bills', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/server/bills')>()),
  getServerRate: vi.fn(),
}));

const ROUTER = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';
const BILLS = '0x3333333333333333333333333333333333333333';
const WORD = `0x${'ab'.repeat(32)}`;
const HASH = `0x${'cd'.repeat(32)}`;
const RATE = { koboPerDollar: 150_000, quotedAt: '2026-10-01T00:00:00.000Z' };

const simulateContract = vi.fn();
const writeContract = vi.fn();
const getBalance = vi.fn();
const waitForTransactionReceipt = vi.fn();
const biller = vi.fn();

const fakeSponsor = {
  account: { address: '0x4444444444444444444444444444444444444444' },
  publicClient: { simulateContract, getBalance, waitForTransactionReceipt },
  walletClient: { writeContract },
} as unknown as Sponsor;

let ipCounter = 0;
function post(body: unknown) {
  return new Request('http://localhost/api/bills', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${++ipCounter}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const now = () => Math.floor(Date.now() / 1000);

/** A ₦15,000 bill is $10 at 150,000 kobo to the dollar: 10 AUSD. */
const BILL = { category: 'electricity', customerIdentifier: '04012345678', amountMinor: 1_500_000 };
function request(overrides: { payment?: Record<string, unknown>; bill?: Record<string, unknown> } = {}) {
  return {
    payment: {
      from: PAYER,
      recipient: BILLS,
      amount: '10000000',
      validAfter: '0',
      validBefore: String(now() + 600),
      salt: WORD,
      v: 27,
      r: WORD,
      s: WORD,
      ...overrides.payment,
    },
    bill: { ...BILL, ...overrides.bill },
  };
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const billerPaid = () => reply({ status: 'success', data: { reference: 'ref-1', tx_ref: 'bill-ref-9' } });

beforeEach(() => {
  vi.resetAllMocks();
  resetRateLimits();
  process.env.BILL_PAYMENT_API_KEY = 'biller-key';
  process.env.NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS = BILLS;
  process.env.BILL_ITEM_CODES = JSON.stringify({ electricity: 'ELEC-1', 'airtime-data': 'AIR-1' });
  vi.mocked(getSponsor).mockReturnValue(fakeSponsor);
  vi.mocked(getRouterAddress).mockReturnValue(ROUTER);
  vi.mocked(getServerRate).mockResolvedValue(RATE);
  simulateContract.mockResolvedValue({ request: { marker: 'request' } });
  getBalance.mockResolvedValue(10n ** 18n);
  writeContract.mockResolvedValue(HASH);
  waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
  vi.stubGlobal('fetch', biller);
  biller.mockImplementation(async () => billerPaid());
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BILL_PAYMENT_API_KEY;
  delete process.env.NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS;
  delete process.env.BILL_ITEM_CODES;
});

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe('POST /api/bills/validate', () => {
  it('answers 501 until the biller and the bills account are configured', async () => {
    delete process.env.BILL_PAYMENT_API_KEY;
    expect((await validate(post({ category: 'electricity', customerIdentifier: '04012345678' }))).status).toBe(501);
  });

  it('answers 501 for a category with no item code', async () => {
    expect((await validate(post({ category: 'cable-tv', customerIdentifier: '1234567' }))).status).toBe(501);
  });

  it('returns only the name of the account holder', async () => {
    biller.mockResolvedValueOnce(
      reply({ status: 'success', data: { response_code: '00', response_message: 'ok', name: 'Chidi Okafor' } }),
    );
    const response = await validate(post({ category: 'electricity', customerIdentifier: '04012345678' }));
    expect(await body(response)).toEqual({ customerName: 'Chidi Okafor' });
    expect(JSON.stringify(biller.mock.calls[0])).toContain('Bearer biller-key');
  });

  it('answers 422 when the biller does not know the account, and 400 for a bad body', async () => {
    biller.mockResolvedValueOnce(reply({}, 404));
    expect((await validate(post({ category: 'electricity', customerIdentifier: '04012345678' }))).status).toBe(422);
    expect((await validate(post({ category: 'gold', customerIdentifier: '1' }))).status).toBe(400);
  });
});

describe('POST /api/bills/pay', () => {
  it('relays the payment, waits for it to settle, then pays the biller, in that order', async () => {
    const order: string[] = [];
    writeContract.mockImplementation(async () => {
      order.push('relay');
      return HASH;
    });
    waitForTransactionReceipt.mockImplementation(async () => {
      order.push('settled');
      return { status: 'success' };
    });
    biller.mockImplementation(async () => {
      order.push('biller');
      return billerPaid();
    });

    const response = await pay(post(request()));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ status: 'successful', reference: 'ref-1', hash: HASH });
    expect(order).toEqual(['relay', 'settled', 'biller']);

    // Flutterwave takes naira; the bill is 1,500,000 kobo.
    const sent = JSON.parse((biller.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent).toMatchObject({ amount: 15_000, customer_id: '04012345678' });
  });

  it('never calls the biller when the payment does not settle', async () => {
    waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' });
    expect((await pay(post(request()))).status).toBe(422);
    expect(biller).not.toHaveBeenCalled();
  });

  it('never calls the biller when the relay itself fails', async () => {
    simulateContract.mockRejectedValue(new Error('execution reverted: ERC20InsufficientBalance'));
    const response = await pay(post(request()));
    expect(await body(response)).toEqual({ error: 'insufficient_funds' });
    expect(biller).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('refuses a payment that does not go to the bills account', async () => {
    const response = await pay(post(request({ payment: { recipient: PAYER } })));
    expect(response.status).toBe(422);
    expect(simulateContract).not.toHaveBeenCalled();
    expect(biller).not.toHaveBeenCalled();
  });

  it('refuses a payment that does not cover the bill at the live rate, or that is far too large', async () => {
    for (const amount of ['5000000', '9800000', '10600000', '100000000']) {
      const response = await pay(post(request({ payment: { amount } })));
      expect(response.status, amount).toBe(422);
    }
    expect(simulateContract).not.toHaveBeenCalled();
    expect(biller).not.toHaveBeenCalled();
  });

  it('accepts a payment within the band for the rate moving while the person typed', async () => {
    for (const amount of ['9950000', '10100000', '10400000']) {
      resetRateLimits();
      expect((await pay(post(request({ payment: { amount } })))).status, amount).toBe(200);
    }
  });

  it('says so when it cannot price the bill', async () => {
    vi.mocked(getServerRate).mockRejectedValue(new Error('down'));
    expect((await pay(post(request()))).status).toBe(503);
    expect(simulateContract).not.toHaveBeenCalled();
  });

  it('keeps the payment hash and logs it when the biller refuses after the payment settled', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    biller.mockResolvedValueOnce(reply({}, 500));
    const response = await pay(post(request()));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ error: 'bill_failed', hash: HASH });
    expect(logged.mock.calls[0]![0]).toContain(HASH);
    logged.mockRestore();
  });

  it('treats a biller answer that is not a success as a failure, never as paid', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    biller.mockResolvedValueOnce(reply({ status: 'error' }));
    expect((await pay(post(request()))).status).toBe(502);
    logged.mockRestore();
  });

  it('rejects a stale or far-future authorization and a malformed body', async () => {
    expect((await pay(post(request({ payment: { validBefore: String(now() - 5) } })))).status).toBe(422);
    expect((await pay(post(request({ payment: { validBefore: String(now() + 100_000) } })))).status).toBe(422);
    expect((await pay(post('nope'))).status).toBe(400);
    expect((await pay(post(request({ bill: { amountMinor: -1 } })))).status).toBe(400);
    expect(biller).not.toHaveBeenCalled();
  });

  it('answers 501 with no sponsor, no bills account or no item code', async () => {
    vi.mocked(getSponsor).mockReturnValue(null);
    expect((await pay(post(request()))).status).toBe(501);
    vi.mocked(getSponsor).mockReturnValue(fakeSponsor);
    delete process.env.NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS;
    expect((await pay(post(request()))).status).toBe(501);
    process.env.NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS = BILLS;
    expect((await pay(post(request({ bill: { category: 'internet' } })))).status).toBe(501);
  });
});
