import { requestDepositAddress } from '@entole/core/aurora-intents';
import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Funding from any other chain through Aurora Intents: asks Aurora for a
 * deposit target on the source chain that lands in the person's own account.
 * `AURORA_INTENTS_API_KEY` is a real secret and stays here.
 *
 * Aurora's endpoint path and field names are best-effort until checked against
 * a live key (see `packages/core/aurora-intents.ts`). They can be corrected
 * without a code change through `AURORA_INTENTS_API_BASE` and
 * `AURORA_INTENTS_DEPOSIT_PATH`.
 *
 * The answer is a deposit address on another chain. No screen may print it
 * (hard rule), so it is returned as `qrPayload`: something to encode in a QR
 * code or copy with a button, never to show as text.
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 5;

const bodySchema = z.object({
  sourceChain: z.string().regex(/^[a-z0-9-]{2,30}$/i),
  sourceAsset: z.string().regex(/^[a-z0-9.-]{2,30}$/i),
  address: z
    .string()
    .refine((value) => isAddress(value, { strict: false }))
    .transform((value): Address => getAddress(value)),
});

export async function POST(request: Request) {
  const apiKey = process.env.AURORA_INTENTS_API_KEY?.trim();
  if (!apiKey) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'aurora-deposit', LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { sourceChain, sourceAsset, address } = parsed.data;

  try {
    const apiBase = process.env.AURORA_INTENTS_API_BASE?.trim();
    const depositPath = process.env.AURORA_INTENTS_DEPOSIT_PATH?.trim();
    const result = await requestDepositAddress(
      { sourceChain, sourceAsset, destinationAddress: address },
      { apiKey, ...(apiBase ? { apiBase } : {}), ...(depositPath ? { depositPath } : {}) },
    );
    return json({ qrPayload: result.depositAddress, sourceChain: result.sourceChain, sourceAsset: result.sourceAsset });
  } catch {
    return json({ error: 'rejected' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
