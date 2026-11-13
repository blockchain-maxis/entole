'use client';

import { useRouter } from 'next/navigation';

import { ASSISTANT_NAME } from '@entole/core/assistant-persona';
import { useAyoNudges } from '@entole/core/ayo-hook';
import type { Nudge } from '@entole/core/ayo-nudges';

import { useAssistant } from '@/lib/assistant';
import { assistantRoute } from '@/lib/assistant-talk';

/**
 * The one thing Ayo thinks is worth saying today, on Home: pay that just
 * landed, a subscription about to renew, a week under the usual. Written in
 * the assistant's blue, because it is the assistant talking, with one thing
 * to do and a way to say not now.
 *
 * Every figure in it is the person's own (`ayo-nudges.ts`). Its button only
 * opens a screen with the amount filled in; the person still confirms. Shown
 * only once the assistant is turned on: it is a setting, never a default.
 * Mirrors `apps/mobile/components/ui/AyoCard.tsx`.
 */
export function AyoCard() {
  const router = useRouter();
  const { talking, enabled } = useAssistant();
  const { top, dismiss } = useAyoNudges();
  if (!(talking || enabled) || !top) return null;

  return (
    <section aria-label={`${ASSISTANT_NAME} says`} className="mt-5 rounded-control bg-indigo-wash px-4 pb-3 pt-3.5">
      <p className="font-strong text-note text-indigo">{ASSISTANT_NAME}</p>
      <p className="tabular mt-1 text-pretty font-display-plain text-prose text-indigo">{sentence(top)}</p>
      <div className="mt-3 flex items-center gap-4">
        {top.action ? (
          <button
            type="button"
            onClick={() => router.push(assistantRoute(top.action!.step))}
            className="tabular flex h-10 items-center rounded-control bg-ink px-4 font-strong text-ui text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
          >
            {top.action.label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void dismiss(top.id)}
          className="min-h-10 font-strong text-ui text-slate underline decoration-mist underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
        >
          {top.action ? 'Not now' : 'Got it'}
        </button>
      </div>
    </section>
  );
}

function sentence(nudge: Nudge): string {
  return nudge.ask ? `${nudge.text} ${nudge.ask}` : nudge.text;
}
