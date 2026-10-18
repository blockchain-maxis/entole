import { z } from 'zod';

/**
 * What a person tells us from inside the app, and the email it becomes.
 *
 * It goes to one inbox (the owner's) through the server, never from the app
 * itself, so nothing secret is in a build. What is sent is what the person
 * typed, the kind of message it is, the way to reach them if they gave one,
 * and a few facts about where it came from. No account address and no balance.
 */

export const FEEDBACK_KINDS = [
  { id: 'problem', label: 'Something is wrong' },
  { id: 'idea', label: 'An idea' },
  { id: 'praise', label: 'Something I like' },
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]['id'];

export const FEEDBACK_MIN = 5;
export const FEEDBACK_MAX = 2000;

export const feedbackSchema = z.object({
  kind: z.enum(['problem', 'idea', 'praise']),
  message: z.string().trim().min(FEEDBACK_MIN).max(FEEDBACK_MAX),
  /** Where to answer, if the person wants an answer. */
  email: z
    .string()
    .trim()
    .max(120)
    .refine((value) => value === '' || z.email().safeParse(value).success, 'Enter a valid email')
    .optional(),
  from: z.object({
    platform: z.enum(['android', 'ios', 'web']),
    username: z.string().trim().max(40).optional(),
    name: z.string().trim().max(80).optional(),
    version: z.string().trim().max(24).optional(),
    screen: z.string().trim().max(60).optional(),
  }),
});

export type Feedback = z.infer<typeof feedbackSchema>;

/** The email the owner reads. Plain text, so nothing a person typed is ever interpreted as markup. */
export function feedbackEmail(feedback: Feedback, now = new Date()): { subject: string; text: string; replyTo?: string } {
  const kind = FEEDBACK_KINDS.find((entry) => entry.id === feedback.kind)?.label ?? feedback.kind;
  const firstLine = feedback.message.replace(/\s+/g, ' ').slice(0, 60);
  // A newline in a subject would let a message add headers of its own.
  const subject = `[Entole feedback] ${kind}: ${firstLine}`.replace(/[\r\n]+/g, ' ');
  const who = [feedback.from.name, feedback.from.username ? `@${feedback.from.username}` : null].filter(Boolean).join(' ');
  const email = feedback.email?.trim() || '';
  const lines = [
    feedback.message,
    '',
    '—',
    `Kind: ${kind}`,
    `From: ${who || 'not signed in'}`,
    `Reply to: ${email || 'they did not leave an email'}`,
    `Where: ${feedback.from.platform}${feedback.from.version ? ` ${feedback.from.version}` : ''}${feedback.from.screen ? `, on ${feedback.from.screen}` : ''}`,
    `At: ${now.toISOString()}`,
  ];
  return { subject, text: lines.join('\n'), ...(email ? { replyTo: email } : {}) };
}
