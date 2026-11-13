import { after } from 'next/server';

import type { LanguageModelConfig, ModelAgent, ModelCall } from '@entole/core/language-model';

import { getRedis } from './redis';

/**
 * The one place the server decides which language model each reader asks,
 * and where every ask is written down. Server only: the keys never leave it.
 *
 * - `NEARAI_API_KEY`, when set, makes NEAR AI Cloud the first model:
 *   DeepSeek V4.1 Flash, which NEAR runs in its own sealed hardware
 *   (`NEARAI_ASSISTANT_MODEL`, `NEARAI_CHAT_URL` change it), with
 *   `KIMI_API_KEY` (Moonshot direct, thinking off) as its backup. Kimi through
 *   NEAR AI cannot have its thinking turned off there, and on 13 November 2026
 *   it spent 15 s thinking and answered nothing; DeepSeek answered the same
 *   turn in 2.5 to 4.4 s.
 * - Otherwise `KIMI_API_KEY` is the first model. `ASSISTANT_MODEL` and
 *   `ASSISTANT_API_URL` change which one.
 * - `ASSISTANT_FALLBACK_API_KEY` with `ASSISTANT_FALLBACK_API_URL` (and
 *   optionally `ASSISTANT_FALLBACK_MODEL`) is a second, OpenAI-compatible
 *   model asked only when the first is at its cap, too slow, down or refuses
 *   its key.
 *
 * Every ask leaves one log line (`[model] {...}`, no words, no account) and,
 * with Redis, a count per reader, day and outcome, so a model that has
 * started failing is seen in the numbers instead of in a person's "it
 * didn't understand me".
 */

const env = (name: string) => process.env[name]?.trim() || undefined;

/** Thirty days of counts, so a month can be looked back over. */
const KEEP_SECONDS = 30 * 24 * 60 * 60;

export const NEAR_AI_CHAT_URL = 'https://cloud-api.near.ai/v1/chat/completions';
/** Kimi as NEAR AI Cloud serves it. Not the default: it cannot be asked to skip its thinking there. */
export const NEAR_AI_KIMI = 'moonshotai/kimi-k2.6';
/** The assistant's default on NEAR AI Cloud: quick, no thinking step, run by NEAR in sealed hardware. The statement reader uses it too. */
export const NEAR_AI_ASSISTANT_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash-1017';

/**
 * Models NEAR operates inside its own sealed hardware (`owned_by: nearai` on
 * NEAR AI Cloud). Only an answer from one of these, at NEAR's own address, may
 * be described to the person as heard inside sealed hardware.
 */
const NEAR_SEALED_MODELS: readonly string[] = [NEAR_AI_ASSISTANT_MODEL];

/** Whether the model that answered is one NEAR runs in sealed hardware, at NEAR AI Cloud's address. */
export function answeredInSealedHardware(config: LanguageModelConfig, answeredBy: string): boolean {
  return config.apiUrl === NEAR_AI_CHAT_URL && config.model === answeredBy && NEAR_SEALED_MODELS.includes(answeredBy);
}

export function modelConfig(agent: ModelAgent): LanguageModelConfig | null {
  const nearKey = env('NEARAI_API_KEY');
  const kimiKey = env('KIMI_API_KEY');
  const fallbackKey = env('ASSISTANT_FALLBACK_API_KEY');
  const fallbackUrl = env('ASSISTANT_FALLBACK_API_URL');
  const configuredFallback =
    fallbackKey && fallbackUrl ? { apiKey: fallbackKey, apiUrl: fallbackUrl, model: env('ASSISTANT_FALLBACK_MODEL') } : undefined;

  // With a NEAR AI key, NEAR AI Cloud is asked first and Moonshot's own
  // service is the backup (decided 12 November 2026; the model changed to
  // DeepSeek on 13 November 2026).
  if (nearKey) {
    return {
      apiKey: nearKey,
      model: env('NEARAI_ASSISTANT_MODEL') ?? NEAR_AI_ASSISTANT_MODEL,
      apiUrl: env('NEARAI_CHAT_URL') ?? NEAR_AI_CHAT_URL,
      fallback: kimiKey ? { apiKey: kimiKey, apiUrl: env('ASSISTANT_API_URL'), model: env('ASSISTANT_MODEL') } : configuredFallback,
      agent,
      onCall: recordModelCall,
    };
  }
  if (!kimiKey) return null;
  return {
    apiKey: kimiKey,
    model: env('ASSISTANT_MODEL'),
    apiUrl: env('ASSISTANT_API_URL'),
    fallback: configuredFallback,
    agent,
    onCall: recordModelCall,
  };
}

/** The Redis keys one ask adds to: how many, by outcome, and the time they took. */
export function usageKeys(call: ModelCall, now = new Date()): { count: string; ms: string } {
  const day = now.toISOString().slice(0, 10);
  const base = `model:${day}:${call.agent ?? 'unknown'}`;
  return { count: `${base}:${call.outcome}`, ms: `${base}:ms` };
}

export function recordModelCall(call: ModelCall): void {
  const line = JSON.stringify(call);
  if (call.outcome === 'ok') console.info(`[model] ${line}`);
  else console.warn(`[model] ${line}`);

  const redis = getRedis();
  if (!redis) return;
  const keys = usageKeys(call);
  const count = async () => {
    try {
      await Promise.all([
        redis.incr(keys.count).then(() => redis.expire(keys.count, KEEP_SECONDS)),
        redis.incrby(keys.ms, Math.round(call.ms)).then(() => redis.expire(keys.ms, KEEP_SECONDS)),
      ]);
    } catch {
      // A count that could not be kept is not worth an error to the person.
    }
  };
  // After the answer has gone, so counting never slows anyone down. Outside a
  // request (a script, a test) there is no "after", and it just runs.
  try {
    after(count);
  } catch {
    void count();
  }
}
