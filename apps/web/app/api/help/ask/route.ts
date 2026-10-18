import { z } from 'zod';

import { answerHelpQuestion, HELP_QUESTION_MAX, helpHistorySchema } from '@entole/core/help';

import { newHelpId, recordQuestion } from '@/lib/server/help-log';
import { json, preflight, readJson } from '@/lib/server/http';
import { dailyBudget, rateLimit } from '@/lib/server/sponsor';

/**
 * A question put to the help bot. It is answered from the help articles
 * (`packages/core/help.ts`) and nothing else: with a model key it is a model
 * told to answer only from the few articles that fit, and without one the best
 * matching article answers for itself, so the bot works either way. It sees
 * no account and can do nothing but answer.
 *
 * Open to the app, so what it can cost is bounded by counting: per caller a
 * minute and for everyone a day. The question is kept, redacted and with no
 * account, so the help can be improved from what was not answered.
 */
export const runtime = 'nodejs';

const PER_MINUTE = 12;
const DEFAULT_PER_DAY = 3_000;

const requestSchema = z.object({
  question: z.string().trim().min(2).max(HELP_QUESTION_MAX),
  history: helpHistorySchema.optional(),
});

export async function POST(request: Request) {
  const limit = await rateLimit(request, 'help-ask', PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { question, history } = parsed.data;

  // A day's budget is only spent when the model is actually going to be asked.
  const apiKey = process.env.KIMI_API_KEY?.trim();
  const configured = Number(process.env.HELP_DAILY_QUESTIONS?.trim());
  const budget = apiKey
    ? await dailyBudget('help-asks', Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_PER_DAY)
    : { ok: false as const, retryAfterSeconds: 0 };

  const result = await answerHelpQuestion(
    question,
    apiKey && budget.ok
      ? {
          apiKey,
          model: process.env.ASSISTANT_MODEL?.trim() || undefined,
          apiUrl: process.env.ASSISTANT_API_URL?.trim() || undefined,
        }
      : null,
    history,
  );

  const id = newHelpId();
  await recordQuestion({ id, question, by: result.by, articles: result.articles });
  return json({ id, answer: result.answer, articles: result.articles, by: result.by });
}

export function OPTIONS() {
  return preflight();
}
