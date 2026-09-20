'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useAssistant } from '@/lib/assistant';
import { hasSeenPauseIntro, markPauseIntroSeen } from '@/lib/session';

/**
 * Shown once, at the top of Home, and only while the assistant is off. The
 * assistant is a setting, not a default: this says what it is and leads to the
 * page where it is explained and approved. "Not now" dismisses it for good —
 * the Assistant chip in every header still leads there.
 */
export function PauseIntro() {
  const assistant = useAssistant();
  // `null` until mounted: the flag lives in localStorage, which the server
  // render cannot read, so deciding during render would mismatch on hydrate.
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    function check() {
      setSeen(hasSeenPauseIntro());
    }
    check();
  }, []);

  if (seen !== false || assistant.loading || assistant.enabled) return null;

  return (
    <section className="mb-5 rounded-card border border-line bg-card p-4">
      <div className="flex items-center gap-2.5 text-slate">
        <ShieldCheck size={18} strokeWidth={1.75} aria-hidden />
        <h2 className="font-strong text-body text-ink">Your assistant, with limits</h2>
      </div>
      <p className="mt-2 font-body text-body-sm text-slate">
        Entole&apos;s assistant can pay for you inside the limits you set. It is off until you
        turn it on.
      </p>
      <div className="mt-3.5 flex gap-2.5">
        <Link
          href="/assistant"
          onClick={() => {
            setSeen(true);
            markPauseIntroSeen();
          }}
          className="flex h-12 items-center justify-center rounded-control bg-ink px-5 font-strong text-body text-paper transition-colors hover:bg-indigo-deep"
        >
          Get started
        </Link>
        <button
          type="button"
          onClick={() => {
            setSeen(true);
            markPauseIntroSeen();
          }}
          className="flex h-12 items-center justify-center rounded-control px-5 font-strong text-body text-slate"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
