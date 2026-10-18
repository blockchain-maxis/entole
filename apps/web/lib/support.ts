import { feedbackSchema, type Feedback, type FeedbackKind } from '@entole/core/feedback';
import { helpAnswerSchema, type HelpAnswer, type HelpHistory } from '@entole/core/help';

/**
 * Asking for help and sending feedback from the browser: the same two calls the
 * phone makes (`apps/mobile/lib/support.ts`), to the same routes. Words in,
 * words out, and whatever comes back is parsed before it is used.
 */

const TIMEOUT_MS = 25_000;

async function post(path: string, body: unknown): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type FeedbackResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'busy' | 'failed' };

export async function sendFeedback(input: {
  kind: FeedbackKind;
  message: string;
  email: string;
  person: { username: string; name: string } | null;
  screen?: string;
}): Promise<FeedbackResult> {
  const body: Feedback = {
    kind: input.kind,
    message: input.message,
    ...(input.email.trim() ? { email: input.email.trim() } : {}),
    from: {
      platform: 'web',
      ...(input.person?.username ? { username: input.person.username } : {}),
      ...(input.person?.name ? { name: input.person.name } : {}),
      ...(input.screen ? { screen: input.screen } : {}),
    },
  };
  if (!feedbackSchema.safeParse(body).success) return { ok: false, reason: 'failed' };

  const response = await post('/api/feedback', body);
  if (!response) return { ok: false, reason: 'failed' };
  if (response.ok) return { ok: true };
  if (response.status === 501) return { ok: false, reason: 'not_configured' };
  if (response.status === 429) return { ok: false, reason: 'busy' };
  return { ok: false, reason: 'failed' };
}

/** An answer from the help bot, or `null` when it could not be reached. */
export async function askHelp(question: string, history: HelpHistory): Promise<HelpAnswer | null> {
  const response = await post('/api/help/ask', { question, ...(history.length ? { history } : {}) });
  if (!response?.ok) return null;
  try {
    const parsed = helpAnswerSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A thumbs-up or thumbs-down on an answer. Best-effort: the person already has their answer. */
export async function rateHelp(id: string, helpful: boolean): Promise<void> {
  await post('/api/help/rate', { id, helpful });
}
