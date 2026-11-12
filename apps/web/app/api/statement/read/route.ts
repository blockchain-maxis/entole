import { randomBytes, createHash } from 'node:crypto';

import { getAddress, isAddress, verifyMessage, type Address } from 'viem';
import { z } from 'zod';

import { buildStatementMessage, STATEMENT_MAX_AGE_SECONDS, STATEMENT_MAX_BYTES } from '@entole/core/statement';

import { json, preflight, readJson } from '@/lib/server/http';
import { nearAiConfig } from '@/lib/server/near-ai';
import { dailyBudget, rateLimit } from '@/lib/server/sponsor';
import { readStatement, StatementReadError } from '@/lib/server/statement-read';

/**
 * Reads a bank statement PDF in sealed hardware on NEAR AI Cloud and answers
 * with its lines, whether they balance, and the proof of where it was read.
 *
 * Keeps nothing. The file, its password and everything read from them exist
 * only for this request: no store, no records, no log line with any of it.
 * The lines go back to the person's device, which keeps them sealed with its
 * own key (`record-sync.ts`); this server cannot open them.
 *
 * Signed by the account over the file's digest, and counted per caller, per
 * account and per day, so the model is not an open door.
 */
export const runtime = 'nodejs';
export const maxDuration = 120;

const PER_MINUTE = 6;
const ACCOUNT_PER_MINUTE = 3;
const DEFAULT_READS_PER_DAY = 300;

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const requestSchema = z.object({
  account: address,
  timestampSeconds: z.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).transform((value) => value as `0x${string}`),
  pdf: z.string().min(8).max(Math.ceil((STATEMENT_MAX_BYTES * 4) / 3) + 4),
  password: z.string().max(128).optional(),
});

function readsPerDay(): number {
  const configured = process.env.STATEMENT_DAILY_READS?.trim();
  return configured && /^\d{1,7}$/.test(configured) ? Number(configured) : DEFAULT_READS_PER_DAY;
}

function tooMany(retryAfterSeconds: number) {
  return json({ error: 'rate_limited', retryAfterSeconds }, 429, { 'Retry-After': String(retryAfterSeconds) });
}

const FAILURE_STATUS: Record<string, number> = {
  needs_password: 422,
  wrong_password: 422,
  unreadable: 422,
  no_text: 422,
  too_long: 413,
  not_proven: 503,
  model_unavailable: 503,
};

export async function POST(request: Request) {
  const config = nearAiConfig();
  if (!config) return json({ error: 'not_configured' }, 501);

  const ip = await rateLimit(request, 'statement', PER_MINUTE);
  if (!ip.ok) return tooMany(ip.retryAfterSeconds);

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const body = parsed.data;

  const age = Math.abs(Date.now() / 1000 - body.timestampSeconds);
  if (age > STATEMENT_MAX_AGE_SECONDS) return json({ error: 'expired' }, 401);
  const digest = createHash('sha256').update(body.pdf).digest('hex');
  const message = buildStatementMessage({ account: body.account, timestampSeconds: body.timestampSeconds, digest });
  const signed = await verifyMessage({ address: body.account, message, signature: body.signature }).catch(() => false);
  if (!signed) return json({ error: 'invalid_signature' }, 401);

  const account = await rateLimit(request, 'statement-account', ACCOUNT_PER_MINUTE, body.account);
  if (!account.ok) return tooMany(account.retryAfterSeconds);
  const day = await dailyBudget('statement-reads', readsPerDay());
  if (!day.ok) return tooMany(day.retryAfterSeconds);

  const pdf = new Uint8Array(Buffer.from(body.pdf, 'base64'));
  if (pdf.length > STATEMENT_MAX_BYTES || pdf.length < 8) return json({ error: 'bad_request' }, 400);

  try {
    const reading = await readStatement({ pdf, password: body.password || undefined }, config, {
      random: (length) => new Uint8Array(randomBytes(length)),
      now: () => new Date(),
    });
    return json(reading);
  } catch (error) {
    const reason = error instanceof StatementReadError ? error.reason : 'model_unavailable';
    return json({ error: reason }, FAILURE_STATUS[reason] ?? 503);
  }
}

export function OPTIONS() {
  return preflight();
}
