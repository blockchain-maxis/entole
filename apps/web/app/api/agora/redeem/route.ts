import { createRedeemRoute } from '@entole/core/settlement-asset';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Cashing out: creates an Agora redeem route that pays the person's own
 * destination account in `toCurrency`. Creating a route moves nothing; money
 * only moves when funds are sent to the route's instructions. Gated on
 * `AGORA_ACCESS_KEY` like the mint route.
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 5;

const bodySchema = z.object({
  toCurrency: z.string().regex(/^[A-Za-z]{2,10}$/).transform((value) => value.toUpperCase()),
  destinationAccountId: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  const accessKey = process.env.AGORA_ACCESS_KEY?.trim();
  if (!accessKey) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'agora-redeem', LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);

  try {
    const route = await createRedeemRoute(parsed.data.toCurrency, parsed.data.destinationAccountId, { accessKey });
    return json({ id: route.id });
  } catch {
    return json({ error: 'rejected' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
