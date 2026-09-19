'use client';

import { Pause, Play } from 'lucide-react';

import { useStore } from '@entole/core/store';

/**
 * The exit. One click from any header on any page — never inside a menu, never
 * inside settings. When everything is already paused it becomes Resume.
 * Icon-only by design — a text label here reads as a loud header element on
 * every single page; the icon + tint carries the same one-tap affordance
 * without the visual weight.
 */
export function PauseControl() {
  const { paused, setPaused } = useStore();

  return (
    <button
      type="button"
      aria-label={
        paused ? 'Resume everything Entole does for you' : 'Pause everything Entole does for you'
      }
      onClick={() => void setPaused(!paused)}
      className={`flex h-9 w-9 items-center justify-center rounded-pill border transition-colors ${
        paused
          ? 'border-halt bg-halt-wash text-halt hover:bg-halt-tint'
          : 'border-line bg-card text-slate hover:border-halt'
      }`}
    >
      {paused ? <Play size={16} strokeWidth={1.5} /> : <Pause size={16} strokeWidth={1.5} />}
    </button>
  );
}
