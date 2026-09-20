/**
 * Whether the lock screen is on screen right now. A plain module flag rather
 * than a router hook, so the tabs' session guard can read it without depending
 * on navigation state — the guard only needs to know "is a lock screen already
 * showing?" to avoid stacking another one when the passkey sheet closes.
 */
export const lockScreen = { visible: false };
