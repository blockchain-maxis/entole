import { ONRAMP_CHAIN_ID } from '@entole/core/onramp';

/**
 * Which kind of money this deployment adds. On the main network a person pays
 * naira by bank transfer; anywhere else there is only test money, and the
 * screen says so.
 */
export const REAL_MONEY = Number(process.env.NEXT_PUBLIC_CHAIN_ID) === ONRAMP_CHAIN_ID;

const BEFORE_KEY = 'entole.add-money.before';
/** A bank transfer started longer ago than this is not what the page is waiting on. */
const BEFORE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Paying by bank transfer means leaving for the partner's page and coming back
 * to a fresh load. The balance from before leaving is kept for this tab only,
 * so that on return "added" is the real difference and never a guess.
 */
export function rememberBalanceBeforeTransfer(balanceMinor: number): void {
  storage()?.setItem(BEFORE_KEY, JSON.stringify({ balanceMinor, at: Date.now() }));
}

export function balanceBeforeTransfer(now: number = Date.now()): number | null {
  const raw = storage()?.getItem(BEFORE_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { balanceMinor?: unknown; at?: unknown };
    if (typeof saved.balanceMinor !== 'number' || typeof saved.at !== 'number') return null;
    if (now - saved.at > BEFORE_MAX_AGE_MS) return null;
    return saved.balanceMinor;
  } catch {
    return null;
  }
}

export function forgetBalanceBeforeTransfer(): void {
  storage()?.removeItem(BEFORE_KEY);
}
