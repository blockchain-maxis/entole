import { createSecp256k1SigningSession } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { hexToBytes, recoverMessageAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { base58, intentsSignature, prepareBringBack, readHeldInIntents, submitBringBack } from './intents-held';

const OWNER = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01';
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('base58, as NEAR writes it', () => {
  it('matches known values, leading zeros included', () => {
    expect(base58(new Uint8Array([0, 0, 1]))).toBe('112');
    expect(base58(new TextEncoder().encode('hello world'))).toBe('StV1DL6CwTryKyV');
  });
});

describe('a signature as the Intents verifier takes it', () => {
  it('is the same 65 bytes with v as 0 or 1, and still recovers the signer', async () => {
    const account = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(32).fill(7) }));
    const payload = '{"signer_id":"x","verifying_contract":"intents.near"}';
    const signature = await account.signMessage({ message: payload });
    const encoded = intentsSignature(signature);
    expect(encoded).toMatch(/^secp256k1:[1-9A-HJ-NP-Za-km-z]+$/);
    const v = hexToBytes(signature)[64]!;
    expect(v === 27 || v === 28).toBe(true);
    // The ERC-191 signature over the payload string is what the verifier checks.
    expect(await recoverMessageAddress({ message: payload, signature })).toBe(account.address);
  });

  it('refuses something that is not a signature', () => {
    expect(() => intentsSignature('0x1234')).toThrow();
  });
});

describe('what is held for the person', () => {
  it('is read from the Intents contract, by their own address', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      reply({ result: { result: [...new TextEncoder().encode('"148500000"')] } }),
    );
    const held = await readHeldInIntents({ owner: OWNER, tokenId: 'nep141:t', fetch: fetchImpl as unknown as typeof fetch });
    expect(held).toBe(148_500_000n);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1].body)) as { params: { args_base64: string; method_name: string } };
    expect(body.params.method_name).toBe('mt_balance_of');
    expect(JSON.parse(atob(body.params.args_base64))).toEqual({ account_id: OWNER.toLowerCase(), token_id: 'nep141:t' });
  });
});

describe('bringing it back', () => {
  const HOLDING = '0x8f0c2D4eB6aa368069b16D03708932731625F069';

  it('quotes from the Intents account to the holding address, and asks for the person’s intent', async () => {
    const calls: { url: string; body: Record<string, unknown>; key: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), key: new Headers(init.headers).get('X-API-Key') });
      return url.endsWith('/v0/quote')
        ? reply({ quote: { depositAddress: 'deposit-1' } })
        : reply({ intent: { standard: 'erc191', payload: JSON.stringify({ signer_id: OWNER.toLowerCase() }) } });
    });
    const prepared = await prepareBringBack(
      { owner: OWNER, tokenId: 'nep141:t', amount: 148_500_000n, holdingAddress: HOLDING },
      { apiKey: 'k', fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(prepared.depositAddress).toBe('deposit-1');
    expect(calls[0]!.body).toMatchObject({ depositType: 'INTENTS', refundType: 'INTENTS', recipient: HOLDING, amount: '148500000' });
    expect(calls[1]!.body).toEqual({ type: 'swap_transfer', standard: 'erc191', signerId: OWNER.toLowerCase(), depositAddress: 'deposit-1' });
    expect(calls.every((call) => call.key === 'k')).toBe(true);
  });

  it('refuses an intent written for someone else', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/v0/quote')
        ? reply({ quote: { depositAddress: 'deposit-1' } })
        : reply({ intent: { standard: 'erc191', payload: JSON.stringify({ signer_id: '0xsomeoneelse' }) } }),
    );
    await expect(
      prepareBringBack(
        { owner: OWNER, tokenId: 'nep141:t', amount: 1n, holdingAddress: HOLDING },
        { apiKey: 'k', fetch: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/someone else/);
  });

  it('hands over the signed intent with the signature as the verifier takes it', async () => {
    const account = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(32).fill(7) }));
    const intent = { standard: 'erc191' as const, payload: '{"signer_id":"x"}' };
    const signature = await account.signMessage({ message: intent.payload });
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => reply({ intentHash: 'h1' }));
    expect(await submitBringBack({ intent, signature }, { apiKey: 'k', fetch: fetchImpl as unknown as typeof fetch })).toBe('h1');
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1].body)) as { signedData: Record<string, string> };
    expect(body.signedData).toEqual({ ...intent, signature: intentsSignature(signature) });
  });
});
