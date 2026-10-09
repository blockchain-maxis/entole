import { fetchCorridorFlows } from '@entole/core/nansen';

import { json, preflight } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * One plain line about how money is moving through the corridor, from Nansen.
 * Information beside a payment, never a gate in front of one. `NANSEN_API_KEY`
 * is a real secret and stays here; unset, the route answers 501 and the app
 * simply shows nothing. The answer is cached for a minute so a busy screen does
 * not spend the key's quota.
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 20;
const CACHE_SECONDS = 60;

export async function GET(request: Request) {
  const apiKey = process.env.NANSEN_API_KEY?.trim();
  if (!apiKey) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'nansen', LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  try {
    const apiBase = process.env.NANSEN_API_BASE?.trim();
    const netflowPath = process.env.NANSEN_NETFLOW_PATH?.trim();
    const summary = await fetchCorridorFlows({
      apiKey,
      ...(apiBase ? { apiBase } : {}),
      ...(netflowPath ? { netflowPath } : {}),
    });
    return json({ headline: summary.headline }, 200, { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` });
  } catch {
    return json({ error: 'unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
