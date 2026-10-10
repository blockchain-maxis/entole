import { json, preflight } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';
import { loadStockDetail } from '@/lib/server/stocks';

/**
 * One stock: its price and the day's change, how much was traded, what the
 * company is worth, its range over the year, a month of closes, a line about
 * the company, and whether its market is open. All from the exchange and the
 * issuer, read when asked (see `packages/core/stock-market.ts`).
 *
 * 404 for anything not on the list, 502 when it cannot be read. Read-only: it
 * can buy nothing.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

const LIMIT_PER_MINUTE = 60;
const SHARED_FOR = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' };

export async function GET(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const limit = await rateLimit(request, 'stock', LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const { symbol } = await params;
  if (!/^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(symbol)) return json({ error: 'bad_request' }, 400);

  try {
    const detail = await loadStockDetail(symbol);
    if (!detail) return json({ error: 'unknown_stock' }, 404);
    return json(detail, 200, SHARED_FOR);
  } catch {
    return json({ error: 'unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
