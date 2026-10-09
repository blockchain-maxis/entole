import { validateCustomer } from '@entole/core/bill-payment';
import { z } from 'zod';

import { getBillsConfig } from '@/lib/server/bills';
import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Whose account a bill number belongs to, asked of the biller before any money
 * moves. Moves nothing itself. The biller's key stays on the server; with it
 * (or the item codes) missing the route answers 501 and nothing pretends to
 * have checked.
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 15;

const bodySchema = z.object({
  category: z.enum(['electricity', 'airtime-data', 'cable-tv', 'internet']),
  customerIdentifier: z.string().trim().min(3).max(40),
});

export async function POST(request: Request) {
  const config = getBillsConfig();
  if (!config) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'bills-validate', LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { category, customerIdentifier } = parsed.data;

  const itemCode = config.itemCodes[category];
  if (!itemCode) return json({ error: 'not_configured' }, 501);

  try {
    const found = await validateCustomer({ category, customerIdentifier, itemCode }, config.biller);
    return json({ customerName: found.customerName });
  } catch {
    return json({ error: 'invalid_customer' }, 422);
  }
}

export function OPTIONS() {
  return preflight();
}
