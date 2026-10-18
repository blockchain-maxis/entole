import * as SecureStore from 'expo-secure-store';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether the balance is hidden. A person on a bus or at a counter hides it
 * with one tap, and it stays hidden the next time the app opens: the choice is
 * kept on the device (never sent anywhere), read once, and shared by every
 * screen that shows the figure through one small store, so hiding it in one
 * place hides it in all of them.
 *
 * Until the saved choice has been read nobody knows which it is, so `ready` is
 * false and the figure is not drawn: showing it for a moment to someone who
 * hid it would defeat the point.
 */

const KEY = 'entole.hide-balance';

type State = { hidden: boolean; ready: boolean };

let state: State = { hidden: false, ready: false };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

SecureStore.getItemAsync(KEY)
  .then((stored) => set({ hidden: stored === '1', ready: true }))
  .catch(() => set({ hidden: false, ready: true }));

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => state;

export function useBalanceHidden(): { hidden: boolean; ready: boolean; toggle: () => void } {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const toggle = useCallback(() => {
    const hidden = !state.hidden;
    set({ hidden, ready: true });
    SecureStore.setItemAsync(KEY, hidden ? '1' : '0').catch(() => undefined);
  }, []);
  return { hidden: current.hidden, ready: current.ready, toggle };
}
