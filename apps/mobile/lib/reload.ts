import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { useStore } from '@entole/core/store';

/**
 * Re-reads the account. A failed re-read is not an error to surface again —
 * the screen already says what failed — so it just settles and leaves the last
 * real numbers where they are.
 */
export function useReload() {
  const { refresh } = useStore();
  const [reloading, setReloading] = useState(false);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      await refresh();
    } catch {
      // Nothing new to show.
    } finally {
      setReloading(false);
    }
  }, [refresh]);

  return { reload, reloading };
}

/**
 * How often a focused screen re-reads on its own. There is no push channel yet,
 * so a client that wants an incoming payment to show up without a pull has to
 * ask; every twelve seconds keeps a feed current without leaning on the node.
 */
const LIVE_INTERVAL_MS = 12_000;

/**
 * Keeps the screen current while it is the one on top: it re-reads the account
 * the moment the screen is focused, whenever the app returns to the foreground,
 * and on a slow interval in between. A payment someone sends you lands in the
 * feed on its own, without a pull. Overlapping reads are dropped, and reads
 * stop the moment the screen is left.
 */
export function useLiveRefresh(intervalMs = LIVE_INTERVAL_MS) {
  const { refresh } = useStore();
  const inFlight = useRef(false);

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await refresh();
    } catch {
      // The screen keeps its last real numbers.
    } finally {
      inFlight.current = false;
    }
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void tick();
      const timer = setInterval(() => void tick(), intervalMs);
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void tick();
      });
      return () => {
        clearInterval(timer);
        subscription.remove();
      };
    }, [tick, intervalMs]),
  );
}

