'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const LESS_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(LESS_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * The undo window. The bar drains continuously, never in steps, and the number
 * beside it says the whole seconds left. Time is measured against the clock,
 * not counted in ticks, so a busy tab cannot stretch the window. It runs only
 * while `running` is true, keeps what was used when paused, and calls
 * `onElapsed` exactly once at zero.
 *
 * A person who asks the browser for less motion gets the same number and a bar
 * that steps with it.
 */
export function Countdown({
  seconds,
  running,
  onElapsed,
}: {
  seconds: number;
  running: boolean;
  onElapsed: () => void;
}) {
  const total = seconds * 1000;
  const [left, setLeft] = useState(seconds);
  // Milliseconds used up in earlier stretches of running.
  const spent = useRef(0);
  const elapsed = useRef(onElapsed);
  const fired = useRef(false);
  const lessMotion = useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(LESS_MOTION).matches,
    () => false,
  );

  useEffect(() => {
    elapsed.current = onElapsed;
  }, [onElapsed]);

  useEffect(() => {
    if (!running) return;
    const startedAt = performance.now();
    const usedBefore = spent.current;
    const remaining = () => Math.max(0, total - usedBefore - (performance.now() - startedAt));

    const tick = setInterval(() => setLeft(Math.ceil(remaining() / 1000)), 200);
    const done = setTimeout(() => {
      setLeft(0);
      if (fired.current) return;
      fired.current = true;
      elapsed.current();
    }, remaining());

    return () => {
      clearInterval(tick);
      clearTimeout(done);
      spent.current = Math.min(total, usedBefore + (performance.now() - startedAt));
    };
  }, [running, total]);

  const percent = seconds > 0 ? Math.round((left / seconds) * 100) : 0;

  return (
    <div className="flex w-16 flex-none flex-col items-center gap-1.5">
      <span aria-live="off" className="tabular font-display text-subhead text-ink">
        {left}
      </span>
      <div
        role="timer"
        aria-label={`${left} seconds left to stop this payment`}
        className="h-1.5 w-full overflow-hidden rounded-pill bg-track"
      >
        {lessMotion ? (
          <div className="h-full rounded-pill bg-indigo" style={{ width: `${percent}%` }} />
        ) : (
          <div
            className="countdown-drain h-full w-full rounded-pill bg-indigo"
            style={{ animationDuration: `${seconds}s`, animationPlayState: running ? 'running' : 'paused' }}
          />
        )}
      </div>
    </div>
  );
}
