'use client';

import { useState } from 'react';

import { FEEDBACK_KINDS, FEEDBACK_MAX, FEEDBACK_MIN, type FeedbackKind } from '@entole/core/feedback';

import { sendFeedback, type FeedbackResult } from '@/lib/support';

import { GlassSheet } from './GlassSheet';
import { BrandGlyph } from './Header';
import { LogoLoader } from './LogoLoader';

const PROBLEMS: Record<Exclude<FeedbackResult, { ok: true }>['reason'], string> = {
  not_configured: 'Feedback can’t be sent from here just yet. You can email it to support@entole.pro instead.',
  busy: 'That’s a lot of messages at once. Wait a minute and send it again.',
  failed: 'It didn’t go through. Nothing was lost; check your connection and try again.',
};

/**
 * Send feedback: the web twin of the phone's `FeedbackSheet`, same words and
 * same states. It goes to the person who builds Entole, by email, through the
 * server. When it has gone the sheet says thank you, and only then.
 */
export function FeedbackDialog({
  person,
  onDismiss,
}: {
  person: { username: string; name: string } | null;
  onDismiss: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>('problem');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<'writing' | 'sending' | 'thanks'>('writing');
  const [problem, setProblem] = useState<Exclude<FeedbackResult, { ok: true }>['reason'] | null>(null);

  const ready = message.trim().length >= FEEDBACK_MIN;

  async function send() {
    if (!ready || phase !== 'writing') return;
    setPhase('sending');
    setProblem(null);
    const result = await sendFeedback({ kind, message: message.trim(), email, person, screen: 'Me' });
    if (result.ok) {
      setPhase('thanks');
      return;
    }
    setProblem(result.reason);
    setPhase('writing');
  }

  return (
    <GlassSheet label="Send feedback" onDismiss={onDismiss} locked={phase === 'sending'}>
      {phase === 'thanks' ? (
        <div className="flex flex-col items-center pb-2 pt-6 text-center">
          <BrandGlyph size={84} />
          <h2 className="landing-rise mt-6 font-display text-heading text-ink">Thank you for your feedback</h2>
          <p className="mt-2.5 text-pretty font-body text-ui text-slate">
            It has gone straight to the person who builds Entole.
            {email.trim() ? ' If it needs an answer, you’ll hear back by email.' : ' It helps us make this better for you.'}
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="mt-6 flex h-[53px] w-full items-center justify-center rounded-control bg-ink font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
          >
            Done
          </button>
        </div>
      ) : (
        <form
          className="pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <h2 className="font-display text-heading text-ink">Send feedback</h2>
          <p className="mt-2 text-pretty font-body text-ui text-slate">
            A person reads every message. Tell us what is working, what is not, or what you wish Entole did.
          </p>

          <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="What kind of message">
            {FEEDBACK_KINDS.map((option) => {
              const chosen = option.id === kind;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => setKind(option.id)}
                  className={`rounded-pill border px-4 py-2.5 font-strong text-note transition-colors ${
                    chosen ? 'border-ink bg-ink text-paper' : 'border-line bg-card/70 text-slate hover:text-ink'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <label htmlFor="feedback-message" className="sr-only">
            Your feedback
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setProblem(null);
            }}
            maxLength={FEEDBACK_MAX}
            rows={5}
            placeholder="What happened, or what would you like?"
            className="mt-4 w-full resize-none rounded-control border-[1.5px] border-line bg-card/70 px-4 py-3.5 font-body text-ui text-ink outline-none placeholder:text-mist focus:border-ink"
          />

          <label htmlFor="feedback-email" className="mt-4 flex items-baseline justify-between font-strong text-note text-slate">
            <span>Email, if you’d like a reply</span>
            <span className="font-body">Optional</span>
          </label>
          <input
            id="feedback-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={120}
            placeholder="you@example.com"
            className="mt-2 h-12 w-full rounded-control border-[1.5px] border-line bg-card px-4 font-body text-ui text-ink outline-none placeholder:text-mist focus:border-ink"
          />

          <p className="mt-3 font-body text-note text-slate">
            We see your name and username so we can find your account. Nothing else about it.
          </p>

          {problem ? (
            <div role="alert" className="mt-3">
              <p className="font-body text-note text-halt">{PROBLEMS[problem]}</p>
              {problem === 'not_configured' ? (
                <a
                  href="mailto:support@entole.pro?subject=Feedback"
                  className="mt-1.5 inline-block font-strong text-note text-ink underline"
                >
                  Email support@entole.pro
                </a>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!ready || phase === 'sending'}
            className="mt-5 flex h-[53px] w-full items-center justify-center rounded-control bg-ink font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-50"
          >
            {phase === 'sending' ? <LogoLoader size={21} mono label="Sending" /> : 'Send feedback'}
          </button>
        </form>
      )}
    </GlassSheet>
  );
}
