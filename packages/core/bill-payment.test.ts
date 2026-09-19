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
      json: async () => ({ responseCode: '00', responseMessage: 'Successful', customerName: 'Chidi Okafor' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await validateCustomer(
      { category: 'electricity', customerIdentifier: '04012345678', itemCode: 'ELEC-001' },
      { apiKey: 'key-1' },
    );

    expect(result.customerName).toBe('Chidi Okafor');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a response that fails Zod validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ responseCode: '00' }) }));

    await expect(
      validateCustomer(
        { category: 'electricity', customerIdentifier: '04012345678', itemCode: 'ELEC-001' },
        { apiKey: 'key-1' },
      ),
    ).rejects.toThrow();
  });

  it('pays a bill and parses the response when configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ reference: 'ref-1', billerReference: 'biller-ref-9', status: 'successful' }),
      }),
    );

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

    expect(result.status).toBe('successful');
  });
});
