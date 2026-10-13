/**
 * Routes that are for people who are not signed in — and often never will be.
 * They render without the account gate and without the tab bar: a payer who
 * opened a checkout link should see the checkout, not an onboarding prompt.
 *
 * A receipt (`/receipt/<reference>`) is the same: whoever is sent the link,
 * the person paid as much as anyone, opens it without an account.
 *
 * Deliberately a short allow-list. Everything else stays behind the gate.
 */
const PUBLIC_PREFIXES = ['/pay/', '/receipt/'];

/**
 * The Terms and the Privacy notice. Someone deciding whether to make an account
 * has to be able to read them first.
 */
const LEGAL_PAGES = ['/legal/terms', '/legal/privacy'];

/**
 * Where the payment partner sends a person back to after a bank transfer. They
 * may land in a browser that has never signed in (someone who uses the phone
 * app), so it cannot sit behind the gate. It shows no account and no balance.
 */
const PUBLIC_PAGES = ['/add-money/return'];

export function isPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const page = pathname.replace(/\/$/, '');
  if (PUBLIC_PAGES.includes(page) || LEGAL_PAGES.includes(page)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length);
}
