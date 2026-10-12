import { getAddress, isAddress, verifyMessage, type Address } from 'viem';
import { z } from 'zod';

import { ASSISTANT_SCREENS } from '@entole/core/assistant-actions';
import {
  buildTurnMessage,
  readWithModel,
  turnHistorySchema,
  TURN_MAX_AGE_SECONDS,
  TURN_TEXT_MAX,
} from '@entole/core/assistant-brain';

import { json, preflight, readJson } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * One thing said to the assistant, read by a language model.
 *
 * The request carries the words, the name of the screen the person is on and
 * the last few turns. It carries nothing about the account, and the model is
 * told nothing about it. What comes back is a short list of actions from a
 * fixed vocabulary (`packages/core/assistant-actions.ts`), checked here before
 * it is returned and again on the device before anything is done. The model
 * has no key and no account: it cannot move money, and it cannot confirm.
 *
 * Signed by the account, so the model is not open to the whole internet, and
 * limited per caller. With no key configured it answers 501 and the app falls
 * back to its plain grammar, which is the honest state of things.
 */
export const runtime = 'nodejs';

const TURN_LIMIT_PER_MINUTE = 30;

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const requestSchema = z.object({
  account: address,
  timestampSeconds: z.number().int().positive(),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .transform((value) => value as `0x${string}`),
  text: z.string().trim().min(1).max(TURN_TEXT_MAX),
  screen: z.enum(ASSISTANT_SCREENS).optional(),
  history: turnHistorySchema.optional(),
});

export async function POST(request: Request) {
  const apiKey = process.env.QWEN_API_KEY?.trim();
  if (!apiKey) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'assistant-turn', TURN_LIMIT_PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { account, timestampSeconds, signature, text, screen, history } = parsed.data;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > TURN_MAX_AGE_SECONDS) return json({ error: 'stale' }, 422);
  const valid = await verifyMessage({
    address: account,
    message: buildTurnMessage({ account, timestampSeconds }),
    signature,
  }).catch(() => false);
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  const reply = await readWithModel(
    text,
    {
      apiKey,
      model: process.env.ASSISTANT_MODEL?.trim() || undefined,
      apiUrl: process.env.ASSISTANT_API_URL?.trim() || undefined,
    },
    { screen, history },
  );
  if (!reply) return json({ error: 'not_understood' }, 502);
  return json({ reply });
}

export function OPTIONS() {
  return preflight();
}
