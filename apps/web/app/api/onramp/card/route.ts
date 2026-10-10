import { buildCardUrl } from '@entole/core/onramp';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { accountAddress, readMoneyInConfig } from '@/lib/server/onramp';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Adding money by card. Answers with a link to the card partner's page, opened
 * with the account already set and its own money as what is bought, so nothing
 * needs converting afterwards. Nothing moves here.
 *
 * The account is inside `url` and nowhere else in the answer. Off (501) away
 * from the main network.
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 10;

const bodySchema = z.object({ address: accountAddress });

export async function POST(request: Request) {
  const config = readMoneyInConfig();
  if (!config) return json({ error: 'not_configured' }, 501);

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);

  const limit = await rateLimit(request, 'onramp-card', LIMIT_PER_MINUTE, parsed.data.address);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  return json({ url: buildCardUrl({ recipient: parsed.data.address, settlementToken: config.settlementToken }) });
}

export function OPTIONS() {
  return preflight();
}
