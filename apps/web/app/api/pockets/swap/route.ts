import { verifyMessage } from 'viem';
import { z } from 'zod';

import {
  OneClickError,
  POCKET_IDS,
  generatedIntentSchema,
  prepareSwap,
  readMovement,
  readPockets,
  submitSwap,
} from '@entole/core/intents-pockets';

import { json, preflight, readJson } from '@/lib/server/http';
import { accountAddress } from '@/lib/server/onramp';
import { oneClickClient, pocketsEnabled } from '@/lib/server/pockets';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Swapping between the person's own pockets.
 *
 *   POST prepare  a 1Click quote from their Intents account to their Intents
 *                 account, and the intent that carries it out, checked to move
 *                 exactly that amount to exactly that quote (core
 *                 `checkSwapIntent`) before it is handed back to be confirmed.
 *   POST submit   the intent, signed by the person's own key, after checking
 *                 the signature is theirs over exactly that text.
 *   GET  ?followId=  where the swap has got to.
 *
 * The server never signs and holds no key: only the person can move a pocket.
 */
export const runtime = 'nodejs';

const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform((value) => value as `0x${string}`);

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('prepare'),
    address: accountAddress,
    from: z.enum(POCKET_IDS),
    to: z.enum(POCKET_IDS),
    cents: z.number().int().min(100).max(10_000_000),
  }),
  z.object({ action: z.literal('submit'), address: accountAddress, intent: generatedIntentSchema, signature }),
]);

export async function POST(request: Request) {
  if (!pocketsEnabled()) return json({ error: 'not_configured' }, 501);
  const parsed = postSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const body = parsed.data;
  const limit = await rateLimit(request, 'pocket-swap', 10, body.address);
  if (!limit.ok) return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  const client = oneClickClient();

  try {
    if (body.action === 'prepare') {
      if (body.from === body.to) return json({ error: 'bad_request' }, 400);
      const balance = (await readPockets({ owner: body.address })).find((pocket) => pocket.id === body.from)!;
      const swap = await prepareSwap({ owner: body.address, from: body.from, to: body.to, cents: body.cents, balance }, client);
      return json({
        intent: swap.intent,
        followId: swap.quote.depositAddress,
        receivesCents: swap.receivesCents,
        receivesAtLeastCents: swap.receivesAtLeastCents,
        etaSeconds: swap.quote.etaSeconds,
      });
    }
    const signed = await verifyMessage({ address: body.address, message: body.intent.payload, signature: body.signature }).catch(() => false);
    if (!signed) return json({ error: 'invalid_signature' }, 401);
    const intentHash = await submitSwap({ intent: body.intent, signature: body.signature }, client);
    return json({ submitted: true, reference: intentHash });
  } catch (error) {
    if (error instanceof OneClickError && error.status === 400) return json({ error: 'refused', message: error.reason }, 400);
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export async function GET(request: Request) {
  const followId = z.string().regex(/^[A-Za-z0-9]{20,90}$/).safeParse(new URL(request.url).searchParams.get('followId'));
  if (!followId.success) return json({ error: 'bad_request' }, 400);
  const limit = await rateLimit(request, 'pocket-status', 60);
  if (!limit.ok) return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  try {
    const status = await readMovement(followId.data, oneClickClient());
    return json({ state: status?.state ?? 'waiting' });
  } catch {
    return json({ error: 'partner_unavailable' }, 502);
  }
}


export function OPTIONS() {
  return preflight();
}
