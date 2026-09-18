import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMintRoute, createRedeemRoute } from './settlement-asset';

const ADDRESS = '0x1234567890123456789012345678901234567890' as const;

describe('settlement-asset (Agora AUSD)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws for createMintRoute without an access key rather than faking a route', async () => {
    await expect(createMintRoute('USD', ADDRESS)).rejects.toThrow('Agora is not configured');
  });

  it('throws for createRedeemRoute without an access key rather than faking a route', async () => {
    await expect(createRedeemRoute('USD', 'acct-1')).rejects.toThrow('Agora is not configured');
  });

  it('exchanges the access key for a session token, then creates a real-shaped mint route', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sessionJwt: 'jwt-abc' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'route-1', instructions: { depositAddress: '0xabc' } }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    const route = await createMintRoute('USD', ADDRESS, { accessKey: 'key-1' });

    expect(route).toEqual({ id: 'route-1', instructions: { depositAddress: '0xabc' } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain('/auth/token');
    expect(fetchSpy.mock.calls[1]?.[0]).toContain('/routes');
  });

  it('rejects a route response that fails Zod validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sessionJwt: 'jwt-abc' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'route-1' }) }),
    );

    await expect(createMintRoute('USD', ADDRESS, { accessKey: 'key-1' })).rejects.toThrow();
  });
});
