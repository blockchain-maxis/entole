'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The undo window, counted down in whole seconds. It runs only while `running`
 * is true, and calls `onElapsed` exactly once when it reaches zero. The bar
 * drains with the number so the time left reads at a glance. A person who asks
 * the browser for less motion gets the number and the bar, which only ever
 * step once a second.
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
  const [left, setLeft] = useState(seconds);
  const elapsed = useRef(onElapsed);
  const fired = useRef(false);

  useEffect(() => {
    elapsed.current = onElapsed;
  }, [onElapsed]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (left > 0 || !running || fired.current) return;
    fired.current = true;
    elapsed.current();
  }, [left, running]);

  const percent = seconds > 0 ? Math.round((left / seconds) * 100) : 0;

  return (
    <div className="flex w-16 flex-none flex-col items-center gap-1.5">
      <span aria-live="off" className="tabular font-strong text-title text-ink">
        {left}
      </span>
      <div
        role="timer"
        aria-label={`${left} seconds left to stop this payment`}
        className="h-1.5 w-full overflow-hidden rounded-pill bg-track"
      >
        <div className="h-full rounded-pill bg-indigo" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
