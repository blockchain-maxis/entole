import { DEPOSIT_SOURCE_IDS } from '@entole/core/deposit-sources';
import { requestDepositCode } from '@entole/core/onramp';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { accountAddress, readMoneyInConfig } from '@/lib/server/onramp';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Adding money from an app the person already uses. They say what they are
 * sending; the answer is where to send it so that it lands in their account as
 * its own money.
 *
 * That answer is an address. No screen may print it (hard rule), so it is
 * returned as `qrPayload`: something to draw as a scan code or copy with a
 * button, never to show as text.
 *
 * If a conversion cannot be completed, the money goes back to whoever sent it.
 * Off (501) away from the main network.
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 10;

const bodySchema = z.object({
  address: accountAddress,
  source: z.enum(DEPOSIT_SOURCE_IDS),
});

export async function POST(request: Request) {
  const config = readMoneyInConfig();
  if (!config) return json({ error: 'not_configured' }, 501);

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { address, source } = parsed.data;

  const limit = await rateLimit(request, 'onramp-deposit', LIMIT_PER_MINUTE, address);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  try {
    const { code } = await requestDepositCode({ recipient: address, source }, config);
    return json({ qrPayload: code });
  } catch {
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
