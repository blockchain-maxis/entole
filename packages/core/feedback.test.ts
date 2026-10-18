import { describe, expect, it } from 'vitest';

import { FEEDBACK_MAX, feedbackEmail, feedbackSchema } from './feedback';

const base = { kind: 'idea' as const, message: 'Please add a dark mode toggle', from: { platform: 'android' as const } };

describe('what a person can send', () => {
  it('accepts a message with only a kind and where it came from', () => {
    expect(feedbackSchema.safeParse(base).success).toBe(true);
  });

  it('refuses nothing, a single word, and a wall of text', () => {
    expect(feedbackSchema.safeParse({ ...base, message: '   ' }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...base, message: 'hi' }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...base, message: 'x'.repeat(FEEDBACK_MAX + 1) }).success).toBe(false);
  });

  it('takes an email, or none, and refuses one that is not an email', () => {
    expect(feedbackSchema.safeParse({ ...base, email: '' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...base, email: 'ada@example.com' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...base, email: 'ada at example' }).success).toBe(false);
  });

  it('refuses a kind or a place it does not know', () => {
    expect(feedbackSchema.safeParse({ ...base, kind: 'spam' }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...base, from: { platform: 'fridge' } }).success).toBe(false);
  });
});

describe('the email', () => {
  const when = new Date('2026-10-18T12:00:00Z');

  it('says what was said, who said it, and how to answer', () => {
    const email = feedbackEmail(
      { ...base, email: 'ada@example.com', from: { platform: 'android', name: 'Ada Eze', username: 'ada', version: '0.1.0', screen: 'Me' } },
      when,
    );
    expect(email.subject).toBe('[Entole feedback] An idea: Please add a dark mode toggle');
    expect(email.text).toContain('Please add a dark mode toggle');
    expect(email.text).toContain('From: Ada Eze @ada');
    expect(email.text).toContain('Reply to: ada@example.com');
    expect(email.text).toContain('Where: android 0.1.0, on Me');
    expect(email.text).toContain('At: 2026-10-18T12:00:00.000Z');
    expect(email.replyTo).toBe('ada@example.com');
  });

  it('says so when they left no email or are not signed in', () => {
    const email = feedbackEmail(base, when);
    expect(email.text).toContain('From: not signed in');
    expect(email.text).toContain('they did not leave an email');
    expect(email.replyTo).toBeUndefined();
  });

  it('cannot be made to add headers through the subject', () => {
    const email = feedbackEmail({ ...base, message: 'hello there\r\nBcc: someone@else.com\nmore' }, when);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
