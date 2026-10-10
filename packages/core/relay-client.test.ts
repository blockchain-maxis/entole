import { describe, expect, it, vi } from 'vitest';

import { createEnsureGas, createRelayClient, RelayError } from './relay-client';

const HASH = `0x${'cd'.repeat(32)}`;
const payment = {
  from: `0x${'11'.repeat(20)}` as const,
  recipient: `0x${'22'.repeat(20)}` as const,
  amount: 100_000_000n,
  validAfter: 0n,
  validBefore: 1_790_000_000n,
  salt: `0x${'33'.repeat(32)}` as const,
  v: 27,
  r: `0x${'44'.repeat(32)}` as const,
  s: `0x${'55'.repeat(32)}` as const,
};

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }) as unknown as typeof fetch;

describe('relay client', () => {
  it('posts the payment with bigints as strings and returns the hash', async () => {
    const fetchImpl = reply(200, { hash: HASH });
    const client = createRelayClient({ baseUrl: 'https://x.test/', fetch: fetchImpl });
    expect(await client.submitPayment(payment)).toBe(HASH);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://x.test/api/relay');
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({ amount: '100000000', validBefore: '1790000000' });
  });

  it('turns server codes into plain copy with no jargon', async () => {
    const client = createRelayClient({ baseUrl: 'https://x.test', fetch: reply(422, { error: 'insufficient_funds' }) });
    const error = await client.submitPayment(payment).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RelayError);
    expect((error as RelayError).code).toBe('insufficient_funds');
    expect((error as RelayError).message).toBe("You don't have enough for this payment and its fee.");
  });

  it('never surfaces the words we keep out of the interface', () => {
    for (const code of ['not_configured', 'sponsor_low', 'rejected', 'invalid_signature', 'cooldown', 'unreachable']) {
      expect(new RelayError(code).message).not.toMatch(/wallet|crypto|blockchain|chain|gas|token|signature|hash/i);
    }
  });

  it('treats a network failure and a garbled reply as unreachable', async () => {
    const down = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(createRelayClient({ baseUrl: 'https://x.test', fetch: down }).submitPayment(payment)).rejects.toMatchObject({
      code: 'unreachable',
    });
    const garbled = reply(200, { hash: 'nope' });
    await expect(createRelayClient({ baseUrl: 'https://x.test', fetch: garbled }).submitPayment(payment)).rejects.toMatchObject({
      code: 'unreachable',
    });
  });

  it('maps a 429 without a body to a rate-limit message', async () => {
    const limited = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => {
        throw new Error('no body');
      },
    }) as unknown as typeof fetch;
    await expect(createRelayClient({ baseUrl: 'https://x.test', fetch: limited }).requestFunds(payment.from)).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('asks for test money and reads the amount back', async () => {
    const client = createRelayClient({ baseUrl: 'https://x.test', fetch: reply(200, { hash: HASH, amountMinor: '10000000000' }) });
    expect(await client.requestFunds(payment.from)).toEqual({ hash: HASH, amountMinor: '10000000000' });
  });

  it('prices a bank transfer and hands back the partner link with the cost', async () => {
    const offer = { url: 'https://partner.test/buy?x=1', payMinor: 2_000_000, arrivesMinor: 1_825_746, feeMinor: 174_254 };
    const fetchImpl = reply(200, offer);
    const client = createRelayClient({ baseUrl: 'https://x.test', fetch: fetchImpl });
    expect(await client.startBankTransfer(payment.from, 2_000_000)).toEqual(offer);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://x.test/api/onramp/start');
    expect(JSON.parse((init as { body: string }).body)).toEqual({ address: payment.from, amountMinor: 2_000_000 });
  });

  it('refuses a bank-transfer answer whose link is not https', async () => {
    const insecure = { url: 'http://partner.test/buy', payMinor: 1, arrivesMinor: 1, feeMinor: 0 };
    const client = createRelayClient({ baseUrl: 'https://x.test', fetch: reply(200, insecure) });
    await expect(client.startBankTransfer(payment.from, 100)).rejects.toBeInstanceOf(RelayError);
  });

  it('asks for a scan code for what the person is sending, and for the card page', async () => {
    const code = `0x${'ab'.repeat(20)}`;
    const deposit = reply(200, { qrPayload: code });
    const client = createRelayClient({ baseUrl: 'https://x.test', fetch: deposit });
    expect(await client.startDeposit(payment.from, 'base-usdc')).toEqual({ qrPayload: code });
    const [url, init] = (deposit as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://x.test/api/onramp/deposit');
    expect(JSON.parse((init as { body: string }).body)).toEqual({ address: payment.from, source: 'base-usdc' });

    const card = createRelayClient({ baseUrl: 'https://x.test', fetch: reply(200, { url: 'https://partner.test/card?a=1' }) });
    expect(await card.startCardPayment(payment.from)).toEqual({ url: 'https://partner.test/card?a=1' });
  });

  it('refuses a scan code that is not plain letters and digits, and a card link that is not https', async () => {
    const odd = createRelayClient({ baseUrl: 'https://x.test', fetch: reply(200, { qrPayload: 'javascript:alert(1)' }) });
    await expect(odd.startDeposit(payment.from, 'base-usdc')).rejects.toBeInstanceOf(RelayError);
    const insecure = createRelayClient({ baseUrl: 'https://x.test', fetch: reply(200, { url: 'http://partner.test/card' }) });
    await expect(insecure.startCardPayment(payment.from)).rejects.toBeInstanceOf(RelayError);
  });

  it('says in plain words when an amount is too small or the partner is down', async () => {
    const small = createRelayClient({ baseUrl: 'https://x.test', fetch: reply(422, { error: 'amount_too_small' }) });
    await expect(small.startBankTransfer(payment.from, 100)).rejects.toThrow(/smallest amount you can add/);
    const down = createRelayClient({ baseUrl: 'https://x.test', fetch: reply(502, { error: 'partner_unavailable' }) });
    await expect(down.startBankTransfer(payment.from, 2_000_000)).rejects.toThrow(/Bank transfer isn't available/);
  });
});

describe('ensureGas', () => {
  const owner = `0x${'11'.repeat(20)}` as const;

  it('does nothing for an account that can already pay', async () => {
    const relay = { requestGas: vi.fn() };
    await createEnsureGas({ getBalance: async () => 10n ** 18n, relay })(owner);
    expect(relay.requestGas).not.toHaveBeenCalled();
  });

  it('asks once and waits for the top-up to land', async () => {
    let balance = 0n;
    const relay = { requestGas: vi.fn().mockResolvedValue({ funded: false }) };
    let polls = 0;
    await createEnsureGas({
      getBalance: async () => balance,
      relay,
      sleep: async () => {
        polls += 1;
        if (polls === 2) balance = 10n ** 17n;
      },
    })(owner);
    expect(relay.requestGas).toHaveBeenCalledTimes(1);
    expect(polls).toBe(2);
  });

  it('gives up with plain copy if the top-up never arrives', async () => {
    const relay = { requestGas: vi.fn().mockResolvedValue({ funded: false }) };
    await expect(
      createEnsureGas({ getBalance: async () => 0n, relay, sleep: async () => undefined })(owner),
    ).rejects.toBeInstanceOf(RelayError);
  });
});
