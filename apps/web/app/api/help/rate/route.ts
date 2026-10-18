import { z } from 'zod';

import { recordHelpful } from '@/lib/server/help-log';
import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';

/** A thumbs-up or thumbs-down on a help answer, matched to the question that was kept. */
export const runtime = 'nodejs';

const requestSchema = z.object({ id: z.string().min(1).max(40), helpful: z.boolean() });

export async function POST(request: Request) {
  const limit = await rateLimit(request, 'help-rate', 30);
  if (!limit.ok) return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429);

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  await recordHelpful(parsed.data.id, parsed.data.helpful);
  // Said the same whether or not it could be kept: the person did their part.
  return json({ ok: true });
}

export function OPTIONS() {
  return preflight();
}
