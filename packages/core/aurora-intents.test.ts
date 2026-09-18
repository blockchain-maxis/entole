import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestDepositAddress } from './aurora-intents';

const ADDRESS = '0x1234567890123456789012345678901234567890' as const;

describe('aurora-intents', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws without an API key rather than fabricating a deposit address', async () => {
    await expect(
      requestDepositAddress({ sourceChain: 'bitcoin', sourceAsset: 'BTC', destinationAddress: ADDRESS }),
    ).rejects.toThrow('Aurora Intents is not configured');
  });

  it('requests a deposit address and validates the response when configured', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ depositAddress: 'bc1qxyz', sourceChain: 'bitcoin', sourceAsset: 'BTC' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await requestDepositAddress(
      { sourceChain: 'bitcoin', sourceAsset: 'BTC', destinationAddress: ADDRESS },
      { apiKey: 'key-1' },
    );

    expect(result).toEqual({ depositAddress: 'bc1qxyz', sourceChain: 'bitcoin', sourceAsset: 'BTC' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a response that fails Zod validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ depositAddress: '' }) }));

    await expect(
      requestDepositAddress(
        { sourceChain: 'bitcoin', sourceAsset: 'BTC', destinationAddress: ADDRESS },
        { apiKey: 'key-1' },
      ),
    ).rejects.toThrow();
  });
});
