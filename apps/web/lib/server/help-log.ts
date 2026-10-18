import { redactQuestion, type HelpLogEntry } from '@entole/core/help';

import { getRedis } from './redis';

/**
 * What people asked the help bot, kept so the help can improve: the question's
 * words (with anything that looks like a person taken out), how it was
 * answered, and whether the person said the answer helped. No account, no
 * address, no way to tell who asked. Read with `pnpm --filter @entole/web
 * help-log`: the questions nothing answered, and the answers marked unhelpful,
 * are what to write a new article for.
 *
 * Best-effort: a log that cannot be written never stops an answer.
 */

const LOG = 'help:log';
const KEEP = 5_000;
const TTL_SECONDS = 90 * 24 * 60 * 60;

const entryKey = (id: string) => `help:q:${id}`;

export function newHelpId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function recordQuestion(entry: Omit<HelpLogEntry, 'question' | 'helpful' | 'at'> & { question: string }): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const kept: HelpLogEntry = {
    ...entry,
    question: redactQuestion(entry.question),
    at: new Date().toISOString(),
    helpful: null,
  };
  try {
    await redis.set(entryKey(entry.id), JSON.stringify(kept), { ex: TTL_SECONDS });
    await redis.lpush(LOG, entry.id);
    await redis.ltrim(LOG, 0, KEEP - 1);
  } catch {
    // Not kept. The person already has their answer.
  }
}

export async function recordHelpful(id: string, helpful: boolean): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const current = await redis.get<string | HelpLogEntry>(entryKey(id));
    if (!current) return false;
    const entry = (typeof current === 'string' ? JSON.parse(current) : current) as HelpLogEntry;
    await redis.set(entryKey(id), JSON.stringify({ ...entry, helpful }), { ex: TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}
