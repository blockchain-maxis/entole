import { z } from 'zod';

import { OneClickError, PAY_IN_SOURCE_IDS, POCKET_IDS, payInSource, readMovement, requestPocketDeposit } from '@entole/core/intents-pockets';

import { json, preflight, readJson } from '@/lib/server/http';
import { accountAddress } from '@/lib/server/onramp';
import { oneClickClient, pocketsEnabled } from '@/lib/server/pockets';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * POST  Adding to one of the person's own pockets from an app they already
 *       use: a one-time address on that app's network, for a stated amount,
 *       that delivers into their NEAR Intents account. Anything that cannot
 *       be completed is held in that same account, so nobody is asked for an
 *       address anywhere else.
 * GET   ?depositAddress=  where that money has got to.
 *
 * The address only ever reaches a screen as a scan code with a copy button.
 */
export const runtime = 'nodejs';

const postSchema = z.object({
  address: accountAddress,
  pocket: z.enum(POCKET_IDS),
  source: z.enum(PAY_IN_SOURCE_IDS),
  /** What the person will send, in the source currency's cents. */
  cents: z.number().int().min(100).max(10_000_000),
});

export async function POST(request: Request) {
  if (!pocketsEnabled()) return json({ error: 'not_configured' }, 501);
  const parsed = postSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const body = parsed.data;
  const limit = await rateLimit(request, 'pocket-deposit', 6, body.address);
  if (!limit.ok) return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429);

  try {
    const quote = await requestPocketDeposit(
      { recipient: body.address, source: payInSource(body.source)!, pocket: body.pocket, exact: 'send', cents: body.cents },
      oneClickClient(),
    );
    return json({
      qrPayload: quote.depositAddress,
      receivesCents: quote.receivesCents,
      deadline: quote.deadline,
      etaSeconds: quote.etaSeconds,
    });
  } catch (error) {
    if (error instanceof OneClickError && error.status === 400) return json({ error: 'amount_refused', message: error.reason }, 400);
    return json({ error: 'partner_unavailable' }, 502);
  }
}

const depositAddress = z.string().regex(/^[A-Za-z0-9]{20,90}$/);

export async function GET(request: Request) {
  const address = depositAddress.safeParse(new URL(request.url).searchParams.get('depositAddress'));
  if (!address.success) return json({ error: 'bad_request' }, 400);
  const limit = await rateLimit(request, 'pocket-status', 60);
  if (!limit.ok) return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  try {
    const status = await readMovement(address.data, oneClickClient());
    return json({ state: status?.state ?? 'waiting' });
  } catch {
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
