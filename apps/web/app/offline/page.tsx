'use client';

import { useSyncExternalStore } from 'react';

import { Header } from '@/components/Header';

/**
 * What the installed app shows when the phone has no signal.
 *
 * It is deliberately empty of numbers. A balance held over from the last time
 * the app was open is not a balance, and showing one would be the same lie as
 * showing a payment as settled before it is. So this page says only what is
 * true offline: nothing has moved, and nothing was lost.
 */
/** The connection is the browser's state, not React's, so it is read as one. */
function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export default function Offline() {
  const back = useSyncExternalStore(
    subscribe,
    () => window.navigator.onLine,
    () => false,
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header />

      <div className="flex flex-1 flex-col justify-center px-gutter pb-8">
        <span aria-hidden className="h-3 w-3 rounded-control bg-mist" />
        <h1 className="pt-5 font-display text-subhead text-ink">No connection</h1>
        <p className="max-w-[36ch] pt-3 font-body text-ui text-slate">
          Entole needs a connection to show you what is true right now. Nothing has moved and
          nothing was lost — this screen is just waiting with you.
        </p>
      </div>

      <div className="sticky bottom-0 border-t border-hairline bg-paper px-gutter pt-4 safe-bottom">
        <button
          type="button"
          onClick={() => window.location.replace('/')}
          className="flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85"
        >
          {back ? 'Back online — continue' : 'Try again'}
        </button>
      </div>
    </main>
  );
}
