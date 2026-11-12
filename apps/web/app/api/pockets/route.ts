import { POCKETS, pocketInUsdCents, readPocketPrices, readPockets } from '@entole/core/intents-pockets';

import { json, preflight } from '@/lib/server/http';
import { accountAddress } from '@/lib/server/onramp';
import { oneClickClient, pocketsEnabled } from '@/lib/server/pockets';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * GET ?address=  The person's currency pockets on NEAR Intents: how much is in
 * each, and what each is worth in dollars at 1Click's current price. A public
 * read; nothing here can move money.
 */
export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!pocketsEnabled()) return json({ error: 'not_configured' }, 501);
  const address = accountAddress.safeParse(new URL(request.url).searchParams.get('address'));
  if (!address.success) return json({ error: 'bad_request' }, 400);
  const limit = await rateLimit(request, 'pockets', 60, address.data);
  if (!limit.ok) return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429);

  try {
    const [pockets, prices] = await Promise.all([
      readPockets({ owner: address.data }),
      readPocketPrices(oneClickClient()).catch(() => ({ usd: null, eur: null, gbp: null })),
    ]);
    return json({
      pockets: pockets.map((pocket) => ({
        id: pocket.id,
        currency: pocket.currency,
        cents: pocket.cents,
        usdCents: pocketInUsdCents(pocket.cents, prices[pocket.id]),
        words: POCKETS.find((p) => p.id === pocket.id)!.words,
      })),
      prices,
    });
  } catch {
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
