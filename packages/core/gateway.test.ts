import { describe, expect, it } from 'vitest';

import { demoGateway } from './gateway';

/**
 * `demoGateway` is only ever reachable from this package's own tests — see
 * `docs/ARCHITECTURE.md` and `onchain-gateway.ts`'s doc comment. These tests
 * exist to keep its arithmetic honest for the unit tests that depend on it,
 * not because either shipped app can reach this code.
 */
describe('demoGateway.depositGrow', () => {
  it('adds the deposit to the growing balance', async () => {
    const before = await demoGateway.loadSnapshot();
    const after = await demoGateway.depositGrow(10_000_00);
    expect(after.balanceMinor).toBe(before.growPosition!.balanceMinor + 10_000_00);
  });
});

describe('demoGateway.withdrawGrow', () => {
  it('subtracts the withdrawal from the growing balance', async () => {
    const before = await demoGateway.loadSnapshot();
    const after = await demoGateway.withdrawGrow(5_000_00);
    expect(after.balanceMinor).toBe(before.growPosition!.balanceMinor - 5_000_00);
  });

  it('throws rather than let a withdrawal exceed the growing balance', async () => {
    const before = await demoGateway.loadSnapshot();
    await expect(demoGateway.withdrawGrow(before.growPosition!.balanceMinor + 1)).rejects.toThrow();
  });
});

describe('demoGateway.requestConditionalRelease', () => {
  it('releases and splits the tax reserve once the condition is met', async () => {
    const before = await demoGateway.loadSnapshot();
    const gated = before.invoices.find((invoice) => invoice.status === 'pending-release');
    if (!gated?.releaseCondition) throw new Error('fixtures must seed a pending-release invoice for this test');

    const result = await demoGateway.requestConditionalRelease(gated.id, {
      koboPerDollar: gated.releaseCondition.maxKoboPerDollar,
      quotedAt: '2026-09-19T00:00:00.000Z',
    });

    expect(result).not.toBeNull();
    expect(result!.invoice.status).toBe('paid');
    expect(result!.invoice.paidAt).toBeDefined();
    expect(result!.taxReserve.sourceInvoiceId).toBe(gated.id);
  });

  it('returns null and leaves the invoice untouched while the condition is unmet', async () => {
    const before = await demoGateway.loadSnapshot();
    const gated = before.invoices.find((invoice) => invoice.status === 'pending-release');
    if (!gated?.releaseCondition) throw new Error('fixtures must seed a pending-release invoice for this test');

    const result = await demoGateway.requestConditionalRelease(gated.id, {
      koboPerDollar: gated.releaseCondition.maxKoboPerDollar + 1,
      quotedAt: '2026-09-19T00:00:00.000Z',
    });

    expect(result).toBeNull();
  });

  it('throws for an invoice with no release condition to evaluate', async () => {
    const before = await demoGateway.loadSnapshot();
    const ungated = before.invoices.find((invoice) => !invoice.releaseCondition);
    if (!ungated) throw new Error('fixtures must seed at least one ungated invoice for this test');

    await expect(
      demoGateway.requestConditionalRelease(ungated.id, {
        koboPerDollar: before.account.koboPerDollar,
        quotedAt: '2026-09-19T00:00:00.000Z',
      }),
    ).rejects.toThrow();
  });
});

describe('demoGateway stocks', () => {
  it('reports itself available and finds symbols by name or ticker', async () => {
    expect(demoGateway.stocksAvailable).toBe(true);
    expect((await demoGateway.searchStocks('apple')).map((r) => r.symbol)).toEqual(['AAPL']);
    expect((await demoGateway.searchStocks('msft')).map((r) => r.symbol)).toEqual(['MSFT']);
    expect(await demoGateway.searchStocks('  ')).toEqual([]);
  });

  it('quotes a known symbol in whole minor units and rejects an unknown one', async () => {
    const quote = await demoGateway.getStockQuote('aapl');
    expect(quote.symbol).toBe('AAPL');
    expect(Number.isInteger(quote.priceMinor)).toBe(true);
    await expect(demoGateway.getStockQuote('NOPE')).rejects.toThrow();
  });

  it('opens a position on a buy', async () => {
    const positions = await demoGateway.buyStock('AAPL', 25_000);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ symbol: 'AAPL', quantityScaled: 25_000 });
  });

  it('cannot sell a stock that is not held', async () => {
    await expect(demoGateway.sellStock('AAPL', 1)).rejects.toThrow();
  });
});

