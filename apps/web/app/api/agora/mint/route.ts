import { createMintRoute } from '@entole/core/settlement-asset';
import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Adding money from a bank or another stablecoin: creates (or reuses) an Agora
 * mint route that credits the person's own account, and hands back what they
 * need to send funds. `AGORA_ACCESS_KEY` is a real secret and stays here; with
 * it unset the route answers 501 and nothing pretends to talk to Agora.
 *
 * Only bank details are returned. A route that answers with an on-chain
 * deposit address is reported as `kind: 'chain'` with no address in it,
 * because no screen may show one (docs/DESIGN.md, hard rules).
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 5;

const bodySchema = z.object({
  fromCurrency: z.string().regex(/^[A-Za-z]{2,10}$/).transform((value) => value.toUpperCase()),
  address: z
    .string()
    .refine((value) => isAddress(value, { strict: false }))
    .transform((value): Address => getAddress(value)),
});

export async function POST(request: Request) {
  const accessKey = process.env.AGORA_ACCESS_KEY?.trim();
  if (!accessKey) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'agora-mint', LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);

  try {
    const route = await createMintRoute(parsed.data.fromCurrency, parsed.data.address, { accessKey });
    if ('depositAddress' in route.instructions) {
      return json({ id: route.id, kind: 'chain' });
    }
    const { memo, accountNumber, bankName, routingNumber } = route.instructions;
    return json({
      id: route.id,
      kind: 'bank',
      bank: {
        ...(bankName ? { bankName } : {}),
        ...(accountNumber ? { accountNumber } : {}),
        ...(routingNumber ? { routingNumber } : {}),
        ...(memo ? { memo } : {}),
      },
    });
  } catch {
    return json({ error: 'rejected' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
