/**
 * A way for the assistant to know the phone is about to ask for the person's
 * fingerprint, face or screen lock.
 *
 * The gate itself lives where the money moves (`confirmMovement` in
 * `lib/onchain.ts`); this only lets whoever is listening, the assistant's
 * voice, say that the next part is the person's. It carries no way to answer
 * the prompt, and the gate does not wait on it.
 */

type Listener = () => () => void;

const listeners = new Set<Listener>();

/** Called by the assistant: `announce` runs when a confirmation starts and returns what to run when it ends. */
export function onConfirmation(announce: Listener): () => void {
  listeners.add(announce);
  return () => {
    listeners.delete(announce);
  };
}

/** Called by the gate just before it asks. Returns what to call when the person has answered. */
export function confirmationStarting(): () => void {
  const ends: (() => void)[] = [];
  for (const listener of listeners) {
    try {
      ends.push(listener());
    } catch {
      // The voice failing must never stand in the way of the prompt.
    }
  }
  return () => {
    for (const end of ends) {
      try {
        end();
      } catch {
        // Same.
      }
    }
  };
}
