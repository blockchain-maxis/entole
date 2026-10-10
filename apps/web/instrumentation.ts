/**
 * Runs once when a server starts, before it answers anything.
 *
 * Node gives each address of a host a quarter of a second to answer before it
 * moves on to the next. On a slow connection none answers in time, and every
 * request this server makes fails before it has begun: the rate, the network,
 * the stock sources. A few seconds per address costs nothing where the
 * connection is good, and is the difference between working and not where it
 * is not.
 */
const CONNECT_ATTEMPT_MS = 8000;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { setDefaultAutoSelectFamilyAttemptTimeout } = await import('node:net');
  setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_MS);
}
