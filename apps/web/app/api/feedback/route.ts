import { feedbackEmail, feedbackSchema } from '@entole/core/feedback';

import { sendMail } from '@/lib/server/mail';
import { json, preflight, readJson } from '@/lib/server/http';
import { dailyBudget, rateLimit } from '@/lib/server/sponsor';

/**
 * Feedback from inside the app, mailed to the owner through Resend.
 *
 * Open to the app without an account (a person who cannot sign in may be the
 * one with something to say), so what it can cost is bounded by counting: a few
 * a minute per caller, and a few hundred a day for everyone together. Past
 * either it answers 429, and the app tells the person to try again later.
 */
export const runtime = 'nodejs';

const PER_MINUTE = 4;
const DEFAULT_PER_DAY = 300;

export async function POST(request: Request) {
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.FEEDBACK_TO_EMAIL?.trim()) {
    return json({ error: 'not_configured' }, 501);
  }

  const limit = await rateLimit(request, 'feedback', PER_MINUTE);
  if (!limit.ok) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const parsed = feedbackSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);

  const configured = Number(process.env.FEEDBACK_DAILY?.trim());
  const today = await dailyBudget('feedback', Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_PER_DAY);
  if (!today.ok) return json({ error: 'rate_limited', retryAfterSeconds: today.retryAfterSeconds }, 429);

  const sent = await sendMail(feedbackEmail(parsed.data));
  if (!sent.ok) return json({ error: sent.reason }, sent.reason === 'not_configured' ? 501 : 502);
  return json({ ok: true });
}

export function OPTIONS() {
  return preflight();
}
