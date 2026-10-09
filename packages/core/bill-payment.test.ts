import { afterEach, describe, expect, it, vi } from 'vitest';

import { payBill, validateCustomer } from './bill-payment';

describe('bill-payment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws without an API key rather than fabricating a validated customer', async () => {
    await expect(
      validateCustomer({ category: 'electricity', customerIdentifier: '04012345678', itemCode: 'ELEC-001' }),
    ).rejects.toThrow('Bill payment is not configured');
  });

  it('throws without an API key rather than fabricating a payment', async () => {
    await expect(
      payBill({
        category: 'electricity',
        customerIdentifier: '04012345678',
        itemCode: 'ELEC-001',
        amountMinor: 500_000,
        reference: 'ref-1',
      }),
    ).rejects.toThrow('Bill payment is not configured');
  });

  it('validates a customer and parses the response when configured', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        message: 'Item validated successfully',
        data: { response_code: '00', response_message: 'Successful', name: 'Chidi Okafor' },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await validateCustomer(
      { category: 'electricity', customerIdentifier: '04012345678', itemCode: 'ELEC-001' },
      { apiKey: 'key-1' },
    );

    expect(result.customerName).toBe('Chidi Okafor');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.flutterwave.com/v3/bill-items/validate');
    expect(JSON.parse(init.body as string)).toEqual({ item_code: 'ELEC-001', customer_id: '04012345678' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-1');
  });

  it('rejects a response that fails Zod validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: { response_code: '00' } }) }));

    await expect(
      validateCustomer(
        { category: 'electricity', customerIdentifier: '04012345678', itemCode: 'ELEC-001' },
        { apiKey: 'key-1' },
      ),
    ).rejects.toThrow();
  });

  it('pays a bill and parses the response when configured', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        message: 'Bill payment successful',
        data: { reference: 'ref-1', tx_ref: 'biller-ref-9' },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await payBill(
      {
        category: 'airtime-data',
        customerIdentifier: '08031112222',
        itemCode: 'AIRTIME-MTN',
        amountMinor: 100_000,
        reference: 'ref-1',
      },
      { apiKey: 'key-1' },
    );

    expect(result).toEqual({ reference: 'ref-1', billerReference: 'biller-ref-9', status: 'successful' });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    // Flutterwave takes naira; the codebase holds kobo.
    expect(JSON.parse(init.body as string)).toMatchObject({ amount: 1000, customer_id: '08031112222', country: 'NG' });
  });

  it('reads a non-success envelope as pending or failed, never as paid', async () => {
    for (const [status, expected] of [['pending', 'pending'], ['error', 'failed']] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status }) }));
      const result = await payBill(
        { category: 'cable-tv', customerIdentifier: '1', itemCode: 'x', amountMinor: 100, reference: 'r' },
        { apiKey: 'key-1' },
      );
      expect(result.status).toBe(expected);
    }
  });

  it('refuses an amount that is not a positive whole number of kobo', async () => {
    for (const amountMinor of [0, -5, 10.5]) {
      await expect(
        payBill(
          { category: 'cable-tv', customerIdentifier: '1', itemCode: 'x', amountMinor, reference: 'r' },
          { apiKey: 'key-1' },
        ),
      ).rejects.toThrow(/whole number of kobo/);
    }
  });
});
