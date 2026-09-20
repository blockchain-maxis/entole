import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as faucet, OPTIONS as faucetOptions } from '@/app/api/faucet/route';
import { POST as relay, OPTIONS as relayOptions } from '@/app/api/relay/route';
import { getRouterAddress, getSponsor, resetRateLimits, type Sponsor } from '@/lib/server/sponsor';

/**
 * The sponsored routes, called directly with a fake sponsor: no network, no
 * key. Only the two config readers are replaced — the rate limiter and the
 * low-balance check are the real ones, running against the fake clients.
 */
vi.mock('@/lib/server/sponsor', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/server/sponsor')>()),
  getSponsor: vi.fn(),
  getRouterAddress: vi.fn(),
}));

const ROUTER = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';
const RECIPIENT = '0x3333333333333333333333333333333333333333';
const WORD = `0x${'ab'.repeat(32)}`;
const HASH = `0x${'cd'.repeat(32)}`;
const ENOUGH_MON = 10n ** 18n;

const simulateContract = vi.fn();
const writeContract = vi.fn();
const getBalance = vi.fn();
const readContract = vi.fn();

const fakeSponsor = {
  account: { address: '0x4444444444444444444444444444444444444444' },
  publicClient: { simulateContract, getBalance, readContract },
  walletClient: { writeContract },
} as unknown as Sponsor;

let ipCounter = 0;
function post(body: unknown, ip = `10.0.0.${++ipCounter}`) {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.9.9.9` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const now = () => Math.floor(Date.now() / 1000);

function payment(overrides: Record<string, unknown> = {}) {
  return {
    from: PAYER,
    recipient: RECIPIENT,
    amount: '5000000',
    validAfter: '0',
    validBefore: String(now() + 600),
    salt: WORD,
    v: 27,
    r: WORD,
    s: WORD,
    ...overrides,
  };
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetAllMocks();
  resetRateLimits();
  delete process.env.RELAY_MAX_AMOUNT;
  vi.mocked(getSponsor).mockReturnValue(fakeSponsor);
  vi.mocked(getRouterAddress).mockReturnValue(ROUTER);
  simulateContract.mockResolvedValue({ request: { marker: 'request' } });
  getBalance.mockResolvedValue(ENOUGH_MON);
  writeContract.mockResolvedValue(HASH);
});

describe('POST /api/relay', () => {
  it('answers 501 when no sponsor is configured', async () => {
    vi.mocked(getSponsor).mockReturnValue(null);
    const response = await relay(post(payment()));
    expect(response.status).toBe(501);
    expect(await body(response)).toEqual({ error: 'not_configured' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 501 when the router is not configured', async () => {
    vi.mocked(getRouterAddress).mockReturnValue(null);
    expect((await relay(post(payment()))).status).toBe(501);
  });

  it.each([
    ['not json', 'nope'],
    ['a missing field', (() => { const { salt: _salt, ...rest } = payment(); return rest; })()],
    ['a bad address', payment({ recipient: '0x123' })],
    ['a non-decimal amount', payment({ amount: '1.5' })],
    ['a negative amount', payment({ amount: '-5' })],
    ['a bad v', payment({ v: 0 })],
    ['a short salt', payment({ salt: '0xabcd' })],
  ])('answers 400 for %s', async (_name, input) => {
    const response = await relay(post(input));
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: 'bad_request' });
    expect(simulateContract).not.toHaveBeenCalled();
  });

  it.each([
    ['below 1 AUSD', '999999'],
    ['zero', '0'],
    ['above the default cap', '10000000001'],
  ])('answers 422 when the amount is %s', async (_name, amount) => {
    const response = await relay(post(payment({ amount })));
    expect(response.status).toBe(422);
    expect(await body(response)).toEqual({ error: 'amount_out_of_range' });
  });

  it('honours RELAY_MAX_AMOUNT', async () => {
    process.env.RELAY_MAX_AMOUNT = '2000000';
    expect((await relay(post(payment({ amount: '2000001' })))).status).toBe(422);
    expect((await relay(post(payment({ amount: '2000000' })))).status).toBe(200);
  });

  it.each([
    ['already expired', String(now() - 1)],
    ['expiring now', String(now())],
    ['more than an hour ahead', String(now() + 3700)],
  ])('answers 422 when the authorization is %s', async (_name, validBefore) => {
    const response = await relay(post(payment({ validBefore })));
    expect(response.status).toBe(422);
    expect(await body(response)).toEqual({ error: 'bad_window' });
    expect(simulateContract).not.toHaveBeenCalled();
  });

  it.each([
    ['ERC20: transfer amount exceeds balance', 'insufficient_funds'],
    ['reverted with the following signature: 0xe450d38c', 'insufficient_funds'],
    ['FiatToken: authorization is expired', 'expired'],
    ['FiatToken: authorization is not yet valid', 'expired'],
    ['FiatToken: authorization is used or canceled', 'already_used'],
    ['FiatToken: invalid signature', 'invalid_signature'],
    ['bad signature', 'invalid_signature'],
    ['something the router did not expect', 'rejected'],
  ])('maps the revert "%s" to %s without leaking it', async (reason, code) => {
    simulateContract.mockRejectedValue(
      Object.assign(new Error(`RPC: ${reason} https://rpc.example`), { shortMessage: reason }),
    );
    const response = await relay(post(payment()));
    expect(response.status).toBe(422);
    const result = await body(response);
    expect(result).toEqual({ error: code });
    expect(JSON.stringify(result)).not.toContain('rpc.example');
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('answers 503 and sends nothing when the sponsor is low on MON', async () => {
    getBalance.mockResolvedValue(19_999_999_999_999_999n);
    const response = await relay(post(payment()));
    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({ error: 'sponsor_low' });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('simulates as the sponsor, sends the simulated request, and returns the hash', async () => {
    const response = await relay(post(payment()));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ hash: HASH });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');

    const call = simulateContract.mock.calls[0]?.[0];
    expect(call.account).toBe(fakeSponsor.account);
    expect(call.address).toBe(ROUTER);
    expect(call.functionName).toBe('pay');
    expect(call.args.slice(0, 6)).toEqual([PAYER, RECIPIENT, 5_000_000n, 0n, expect.any(BigInt), WORD]);
    expect(writeContract).toHaveBeenCalledWith({ marker: 'request' });
  });

  it('answers 502 when the send itself fails, without leaking why', async () => {
    writeContract.mockRejectedValue(new Error('nonce too low at https://rpc.example'));
    const response = await relay(post(payment()));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ error: 'send_failed' });
  });

  it('rate limits one IP after 10 requests a minute, and not another', async () => {
    for (let i = 0; i < 10; i += 1) expect((await relay(post(payment(), '9.9.9.9'))).status).toBe(200);
    const limited = await relay(post(payment(), '9.9.9.9'));
    expect(limited.status).toBe(429);
    expect((await body(limited)).error).toBe('rate_limited');
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await relay(post(payment(), '8.8.8.8'))).status).toBe(200);
  });

  it('answers the CORS preflight', () => {
    const response = relayOptions();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
  });
});

describe('POST /api/faucet', () => {
  const DRIP = 10_000_000_000n;
  const CAP = 100_000_000_000n;

  /** balanceOf, maxAmountToOwn, lastDripTimestamp, maxDripFrequency, faucetDripAmount. */
  function faucetState(state: { balance?: bigint; last?: number; frequency?: bigint } = {}) {
    const values: Record<string, bigint> = {
      balanceOf: state.balance ?? 0n,
      maxAmountToOwn: CAP,
      lastDripTimestamp: BigInt(state.last ?? now() - 3600),
      maxDripFrequency: state.frequency ?? 60n,
      faucetDripAmount: DRIP,
    };
    readContract.mockImplementation(async ({ functionName }: { functionName: string }) => values[functionName]);
  }

  beforeEach(() => faucetState());

  it('answers 501 when no sponsor is configured', async () => {
    vi.mocked(getSponsor).mockReturnValue(null);
    const response = await faucet(post({ address: RECIPIENT }));
    expect(response.status).toBe(501);
    expect(await body(response)).toEqual({ error: 'not_configured' });
  });

  it.each([['not json', 'nope'], ['no address', {}], ['a bad address', { address: '0xnope' }]])(
    'answers 400 for %s',
    async (_name, input) => {
      const response = await faucet(post(input));
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({ error: 'bad_request' });
    },
  );

  it('answers 422 already_funded at or over the cap', async () => {
    faucetState({ balance: CAP });
    const response = await faucet(post({ address: RECIPIENT }));
    expect(response.status).toBe(422);
    expect(await body(response)).toEqual({ error: 'already_funded' });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('answers 429 with the seconds left while the global cooldown runs', async () => {
    faucetState({ last: now() - 20, frequency: 60n });
    const response = await faucet(post({ address: RECIPIENT }));
    expect(response.status).toBe(429);
    const result = await body(response);
    expect(result.error).toBe('cooldown');
    expect(result.retryAfterSeconds as number).toBeGreaterThan(35);
    expect(result.retryAfterSeconds as number).toBeLessThanOrEqual(40);
    expect(response.headers.get('retry-after')).toBe(String(result.retryAfterSeconds));
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('answers 422 rejected when the simulation reverts', async () => {
    simulateContract.mockRejectedValue(new Error('execution reverted at https://rpc.example'));
    const response = await faucet(post({ address: RECIPIENT }));
    expect(response.status).toBe(422);
    expect(await body(response)).toEqual({ error: 'rejected' });
  });

  it('answers 502 when the faucet cannot be read', async () => {
    readContract.mockRejectedValue(new Error('network down'));
    const response = await faucet(post({ address: RECIPIENT }));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ error: 'upstream_failed' });
  });

  it('answers 503 when the sponsor is low on MON', async () => {
    getBalance.mockResolvedValue(0n);
    const response = await faucet(post({ address: RECIPIENT }));
    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({ error: 'sponsor_low' });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('sends the drip and returns the hash and amount in minor units', async () => {
    const response = await faucet(post({ address: RECIPIENT }));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ hash: HASH, amountMinor: '10000000000' });
    const call = simulateContract.mock.calls[0]?.[0];
    expect(call.functionName).toBe('requestFunds');
    expect(call.args).toEqual([RECIPIENT]);
    expect(writeContract).toHaveBeenCalledWith({ marker: 'request' });
  });

  it('rate limits one IP after 3 requests a minute', async () => {
    for (let i = 0; i < 3; i += 1) expect((await faucet(post({ address: RECIPIENT }, '7.7.7.7'))).status).toBe(200);
    expect((await faucet(post({ address: RECIPIENT }, '7.7.7.7'))).status).toBe(429);
  });

  it('answers the CORS preflight', () => {
    const response = faucetOptions();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
