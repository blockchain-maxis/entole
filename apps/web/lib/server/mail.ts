/**
 * Sending one email through Resend. Server-only: the key is read here and
 * never reaches a client bundle.
 *
 * With no key the answer is "not configured" and the caller says so. Resend's
 * shared test sender (`onboarding@resend.dev`) can only deliver to the address
 * the Resend account was made with, which is exactly the use here: mail to the
 * owner. A verified domain replaces it by setting `FEEDBACK_FROM_EMAIL`.
 */

export type MailResult = { ok: true } | { ok: false; reason: 'not_configured' | 'rejected' | 'unreachable' };

export const DEFAULT_FROM = 'Entole feedback <onboarding@resend.dev>';

export async function sendMail(
  message: { subject: string; text: string; replyTo?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.FEEDBACK_TO_EMAIL?.trim();
  if (!apiKey || !to) return { ok: false, reason: 'not_configured' };

  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: process.env.FEEDBACK_FROM_EMAIL?.trim() || DEFAULT_FROM,
        to: [to],
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });
    return response.ok ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
