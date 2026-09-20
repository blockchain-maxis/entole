'use client';

import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import Link from 'next/link';

import { useStore } from '@entole/core/store';

import { useAssistant } from '@/lib/assistant';

/**
 * The exit. One click from any header on any page — never inside a menu, never
 * inside settings. When the assistant is already paused it becomes Resume.
 *
 * It says what it controls and what state that is in. The assistant is a
 * setting the person turns on, so a new person sees "Assistant · Off" and the
 * chip leads to the page that explains it and offers to turn it on.
 */
export function PauseControl() {
  const { paused, setPaused } = useStore();
  const { enabled } = useAssistant();

  if (!enabled) {
    return (
      <Link
        href="/assistant"
        aria-label="The assistant is off. Learn what it does and turn it on."
        className="flex h-9 flex-none items-center gap-1.5 rounded-pill border border-line bg-card px-3 font-strong text-label-sm text-mist transition-colors hover:border-mist"
      >
        <ShieldOff size={15} strokeWidth={1.75} aria-hidden />
        Assistant · Off
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label={
        paused
          ? 'The assistant is paused. Resume it.'
          : 'The assistant is on. Pause it.'
      }
      onClick={() => void setPaused(!paused)}
      className={`flex h-9 flex-none items-center gap-1.5 rounded-pill border px-3 font-strong text-label-sm transition-colors ${
        paused
          ? 'border-halt bg-halt-wash text-halt hover:bg-halt-tint'
          : 'border-line bg-card text-slate hover:border-halt'
      }`}
    >
      {paused ? (
        <ShieldAlert size={15} strokeWidth={1.75} aria-hidden />
      ) : (
        <ShieldCheck size={15} strokeWidth={1.75} aria-hidden />
      )}
      {paused ? 'Assistant · Paused' : 'Assistant · On'}
    </button>
  );
}
