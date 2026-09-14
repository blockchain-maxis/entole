'use client';

import { useStore } from '@entole/core/store';

/**
 * The exit. One click from any header on any page — never inside a menu, never
 * inside settings. When everything is already paused it becomes Resume.
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
      className={`flex items-center gap-2 rounded-pill border py-2 pl-3 pr-3.5 font-strong text-label-sm transition-colors ${
        paused
          ? 'border-halt bg-halt-wash text-halt hover:bg-halt-tint'
          : 'border-line bg-card text-slate hover:border-halt'
      }`}
    >
      <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-halt" />
      {paused ? 'Paused' : 'Pause all'}
    </button>
  );
}
