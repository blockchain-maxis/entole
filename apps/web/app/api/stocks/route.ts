import { pageStockList, stockKindSchema } from '@entole/core/stock-market';

import { json, preflight } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';
import { loadStocks, withLatestPrices } from '@/lib/server/stocks';

/**
 * The stocks people will be able to buy: every share the issuer has made
 * holdable on Monad that the exchange can price, largest company first.
 * `?kind=company|fund`, `?q=` to search, `?offset=` for the next page.
 *
 * Read-only and public. It prices nothing itself and can buy nothing: both the
 * list and every figure in it come from their live sources (see
 * `packages/core/stock-market.ts`). When a source cannot be reached the answer
 * is 502, not an older or invented list.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

const LIMIT_PER_MINUTE = 60;
const PAGE_SIZE = 30;
/** Answers are the same for everyone, so they may be shared for a few minutes. */
const SHARED_FOR = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' };

export async function GET(request: Request) {
  const limit = await rateLimit(request, 'stocks', LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const params = new URL(request.url).searchParams;
  const kind = stockKindSchema.safeParse(params.get('kind') ?? undefined);
  const query = (params.get('q') ?? '').slice(0, 40);
  const offset = Number(params.get('offset') ?? 0);
  if (params.has('kind') && !kind.success) return json({ error: 'bad_request' }, 400);
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000) return json({ error: 'bad_request' }, 400);

  try {
    const { items } = await loadStocks();
    const page = pageStockList(items, { ...(kind.success ? { kind: kind.data } : {}), query, offset, limit: PAGE_SIZE });
    return json({ ...page, items: await withLatestPrices(page.items) }, 200, SHARED_FOR);
  } catch {
    return json({ error: 'unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
