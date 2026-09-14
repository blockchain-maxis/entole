'use client';

import { useEffect } from 'react';

/**
 * Registers the worker that makes the web app installable and gives it an
 * honest offline screen. Mounted once, in the root layout.
 *
 * In development it does the opposite: any worker left over from a production
 * build is torn down, so the dev server is never answered from a cache.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.forEach((registration) => registration.unregister()));
      return;
    }

    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((registration) => {
        // A build that arrives while the app is open takes over on the next
        // navigation rather than waiting for every tab to close.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage('skip-waiting');
            }
          });
        });
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
