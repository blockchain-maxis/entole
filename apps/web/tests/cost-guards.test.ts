import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { buildTurnMessage } from '@entole/core/assistant-brain';

import { POST as turn } from '@/app/api/assistant/turn/route';
import { POST as gas } from '@/app/api/gas/route';
import { getSponsor, resetRateLimits, type Sponsor } from '@/lib/server/sponsor';

/**
 * The two routes that spend something on behalf of whoever calls: the fee
 * top-up spends the sponsor's balance, and the assistant's reader spends the
 * model. Neither can tell a real person from a script, so both are bounded by
 * counting, and these tests are about the counting. No network and no key: the
 * sponsor is a fake, and the model is a stubbed `fetch`.
 */
vi.mock('@/lib/server/sponsor', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/server/sponsor')>()),
  getSponsor: vi.fn(),
}));

const HASH = `0x${'cd'.repeat(32)}`;
const MON = 10n ** 18n;
const SPONSOR = '0x4444444444444444444444444444444444444444';

const getBalance = vi.fn();
const sendTransaction = vi.fn();
const fakeSponsor = {
  account: { address: SPONSOR },
  publicClient: { getBalance },
  walletClient: { sendTransaction },
} as unknown as Sponsor;

let ipCounter = 0;
function post(body: unknown) {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.4.${Math.floor(ipCounter / 250)}.${(ipCounter += 1) % 250}` },
    body: JSON.stringify(body),
  });
}

const account = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const chainBefore = process.env.NEXT_PUBLIC_CHAIN_ID;

beforeEach(() => {
  vi.resetAllMocks();
  resetRateLimits();
  vi.mocked(getSponsor).mockReturnValue(fakeSponsor);
  // The sponsor is well funded; everyone else has nothing.
  getBalance.mockImplementation(async ({ address }: { address: string }) => (address === SPONSOR ? 100n * MON : 0n));
  sendTransaction.mockResolvedValue(HASH);
  for (const key of ['SPONSOR_DAILY_TOP_UPS', 'ASSISTANT_DAILY_TURNS', 'QWEN_API_KEY']) delete process.env[key];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (chainBefore === undefined) delete process.env.NEXT_PUBLIC_CHAIN_ID;
  else process.env.NEXT_PUBLIC_CHAIN_ID = chainBefore;
});

describe('POST /api/gas', () => {
  it('tops up an account that has nothing', async () => {
    const response = await gas(post({ address: account(1) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ funded: false, hash: HASH });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('is not there at all off the test network', async () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '143';
    const response = await gas(post({ address: account(1) }));
    expect(response.status).toBe(404);
    expect(getBalance).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('tops one account up only a few times a day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));
    for (let i = 0; i < 3; i += 1) {
      expect((await gas(post({ address: account(2) }))).status).toBe(200);
      // Past the per-minute limit for one address, well inside the day.
      vi.advanceTimersByTime(61_000);
    }
    const fourth = await gas(post({ address: account(2) }));
    expect(fourth.status).toBe(429);
    // Until the day is over, not until the minute is.
    expect(Number(fourth.headers.get('retry-after'))).toBeGreaterThan(3_600);
    expect(sendTransaction).toHaveBeenCalledTimes(3);
  });

  it('has a daily ceiling across every account, so a script with many addresses cannot empty the sponsor', async () => {
    process.env.SPONSOR_DAILY_TOP_UPS = '2';
    expect((await gas(post({ address: account(3) }))).status).toBe(200);
    expect((await gas(post({ address: account(4) }))).status).toBe(200);
    expect((await gas(post({ address: account(5) }))).status).toBe(429);
    expect(sendTransaction).toHaveBeenCalledTimes(2);
  });

  it('does not count an account that needed nothing', async () => {
    process.env.SPONSOR_DAILY_TOP_UPS = '1';
    getBalance.mockImplementation(async () => 100n * MON);
    expect(await (await gas(post({ address: account(6) }))).json()).toEqual({ funded: true });
    getBalance.mockImplementation(async ({ address }: { address: string }) => (address === SPONSOR ? 100n * MON : 0n));
    expect((await gas(post({ address: account(7) }))).status).toBe(200);
  });
});

describe('POST /api/assistant/turn', () => {
  const model = vi.fn();
  const answer = () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ say: '', actions: [{ do: 'open', screen: 'receive' }] }) } }] }),
      { status: 200 },
    );

  const person = (n: number) => privateKeyToAccount(`0x${n.toString(16).padStart(64, '0')}` as `0x${string}`);

  async function said(by: ReturnType<typeof person>, overrides: Record<string, unknown> = {}) {
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const signature = await by.signMessage({ message: buildTurnMessage({ account: by.address, timestampSeconds }) });
    return post({ account: by.address, timestampSeconds, signature, text: 'show me how to get paid', ...overrides });
  }

  beforeEach(() => {
    process.env.QWEN_API_KEY = 'test-key';
    model.mockReset();
    model.mockImplementation(async () => answer());
    vi.stubGlobal('fetch', model);
  });

  it('answers a signed turn with what the model made of it', async () => {
    const response = await turn(await said(person(1)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reply: { actions: [{ do: 'open', screen: 'receive' }] } });
    expect(model).toHaveBeenCalledTimes(1);
  });

  it('limits one account, whichever address it calls from', async () => {
    const ada = person(2);
    for (let i = 0; i < 20; i += 1) expect((await turn(await said(ada))).status).toBe(200);
    const next = await turn(await said(ada));
    expect(next.status).toBe(429);
    expect(model).toHaveBeenCalledTimes(20);
    // Someone else is still answered.
    expect((await turn(await said(person(3)))).status).toBe(200);
  });

  it('has a daily ceiling across every account, because a new key costs nothing', async () => {
    process.env.ASSISTANT_DAILY_TURNS = '2';
    expect((await turn(await said(person(4)))).status).toBe(200);
    expect((await turn(await said(person(5)))).status).toBe(200);
    const third = await turn(await said(person(6)));
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: 'rate_limited' });
    expect(model).toHaveBeenCalledTimes(2);
  });

  it('does not spend the day on requests that were never signed', async () => {
    process.env.ASSISTANT_DAILY_TURNS = '1';
    for (let i = 0; i < 3; i += 1) {
      expect((await turn(await said(person(7), { signature: `0x${'11'.repeat(65)}` }))).status).toBe(401);
    }
    expect(model).not.toHaveBeenCalled();
    expect((await turn(await said(person(7)))).status).toBe(200);
  });
});
