'use client';

import { useEffect, useRef, useState } from 'react';

import type { MovementState } from '@entole/core/intents-pockets';

/** States after which nothing more will happen to a movement. */
export const FINAL_STATES: readonly MovementState[] = ['done', 'too_little', 'returned', 'failed'];

/**
 * Where a movement has got to, asked every few seconds until it is final.
 * Nothing is assumed: until the first answer the state is `waiting`, and
 * `done` is shown only once the service that moves it says so.
 */
export function useMovementState(
  read: ((id: string) => Promise<MovementState>) | null,
  id: string | null,
  options: { everyMs?: number; forMs?: number; onFinal?: (state: MovementState) => void } = {},
): MovementState {
  const [state, setState] = useState<{ id: string | null; value: MovementState }>({ id: null, value: 'waiting' });
  const { everyMs = 5000, forMs = 90 * 60 * 1000 } = options;
  // The latest callback, so a new one each render does not restart the asking.
  const onFinal = useRef(options.onFinal);
  useEffect(() => {
    onFinal.current = options.onFinal;
  });

  useEffect(() => {
    if (!read || !id) return;
    let live = true;
    const until = Date.now() + forMs;
    void (async () => {
      while (live && Date.now() < until) {
        try {
          const next = await read(id);
          if (!live) return;
          setState({ id, value: next });
          if (FINAL_STATES.includes(next)) {
            onFinal.current?.(next);
            return;
          }
        } catch {
          // A check that fails says nothing new; the next one may work.
        }
        await new Promise((resolve) => setTimeout(resolve, everyMs));
      }
    })();
    return () => {
      live = false;
    };
  }, [read, id, everyMs, forMs]);

  return state.id === id ? state.value : 'waiting';
}
