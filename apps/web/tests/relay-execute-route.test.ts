import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OPTIONS as executeOptions, POST as execute } from '@/app/api/relay/execute/route';
import { getPolicyAddress, getSponsor, resetRateLimits, type Sponsor } from '@/lib/server/sponsor';

/**
 * The assistant-run relay, called directly with a fake sponsor: no network, no
 * key. Only the two config readers are replaced.
 */
vi.mock('@/lib/server/sponsor', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/server/sponsor')>()),
  getSponsor: vi.fn(),
  getPolicyAddress: vi.fn(),
}));

const POLICY = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x3333333333333333333333333333333333333333';
const WORD = `0x${'ab'.repeat(32)}`;
const SIGNATURE = `0x${'cd'.repeat(65)}`;
const HASH = `0x${'ef'.repeat(32)}`;
const ENOUGH_MON = 10n ** 18n;

const simulateContract = vi.fn();
const writeContract = vi.fn();
const getBalance = vi.fn();

const fakeSponsor = {
  account: { address: '0x4444444444444444444444444444444444444444' },
  publicClient: { simulateContract, getBalance },
  walletClient: { writeContract },
} as unknown as Sponsor;

let ipCounter = 0;
function post(body: unknown, ip = `10.1.0.${++ipCounter}`) {
  return new Request('http://localhost/api/relay/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const now = () => Math.floor(Date.now() / 1000);

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: WORD,
    recipient: RECIPIENT,
    amount: '5000000',
    deadline: String(now() + 300),
    signature: SIGNATURE,
    ...overrides,
  };
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetAllMocks();
  resetRateLimits();
  vi.mocked(getSponsor).mockReturnValue(fakeSponsor);
  vi.mocked(getPolicyAddress).mockReturnValue(POLICY);
  simulateContract.mockResolvedValue({ request: { marker: 'request' } });
  getBalance.mockResolvedValue(ENOUGH_MON);
  writeContract.mockResolvedValue(HASH);
});

describe('POST /api/relay/execute', () => {
  it('answers 501 when no sponsor or policy is configured', async () => {
    vi.mocked(getSponsor).mockReturnValue(null);
    expect((await execute(post(run()))).status).toBe(501);
    vi.mocked(getSponsor).mockReturnValue(fakeSponsor);
    vi.mocked(getPolicyAddress).mockReturnValue(null);
    expect((await execute(post(run()))).status).toBe(501);
  });

  it('submits a valid signed run and returns the hash', async () => {
    const response = await execute(post(run()));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ hash: HASH });
    expect(simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: POLICY, functionName: 'executeFor' }),
    );
    expect(writeContract).toHaveBeenCalledWith({ marker: 'request' });
  });

  it('rejects malformed bodies without touching the chain', async () => {
    for (const bad of [
      'not json',
      run({ id: '0x12' }),
      run({ recipient: 'nope' }),
      run({ amount: '-1' }),
      run({ signature: '0x1234' }),
    ]) {
      expect((await execute(post(bad))).status).toBe(400);
    }
    expect(simulateContract).not.toHaveBeenCalled();
  });

  it('rejects an expired or too-far-future deadline', async () => {
    expect((await execute(post(run({ deadline: String(now() - 1) })))).status).toBe(422);
    expect((await execute(post(run({ deadline: String(now() + 100_000) })))).status).toBe(422);
    expect(simulateContract).not.toHaveBeenCalled();
  });

  it.each([
    ['execution reverted: OverPeriodCap()', 'over_limit'],
    ['execution reverted: RecipientNotAllowed()', 'over_limit'],
    ['execution reverted: AccountPaused()', 'over_limit'],
    ['execution reverted: SignatureExpired()', 'expired'],
    ['execution reverted: BadSignature()', 'invalid_signature'],
    ['execution reverted: TransferFailed()', 'insufficient_funds'],
    ['0xdeadbeef', 'rejected'],
  ])('maps the revert "%s" to %s and sends nothing', async (message, code) => {
    simulateContract.mockRejectedValue(new Error(message));
    const response = await execute(post(run()));
    expect(response.status).toBe(422);
    expect(await body(response)).toEqual({ error: code });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('refuses when the sponsor is low on fee balance', async () => {
    getBalance.mockResolvedValue(0n);
    const response = await execute(post(run()));
    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({ error: 'sponsor_low' });
  });

  it('rate limits per caller', async () => {
    const ip = '10.200.0.1';
    let last: Response | undefined;
    for (let i = 0; i < 11; i += 1) last = await execute(post(run(), ip));
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBeTruthy();
  });

  it('answers the CORS preflight', () => {
    expect(executeOptions().status).toBe(204);
  });
});
