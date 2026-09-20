/**
 * Routes that are for people who are not signed in — and often never will be.
 * They render without the account gate and without the tab bar: a payer who
 * opened a checkout link should see the checkout, not an onboarding prompt.
 *
 * Deliberately a short allow-list. Everything else stays behind the gate.
 */
const PUBLIC_PREFIXES = ['/pay/'];

export function isPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length);
}
