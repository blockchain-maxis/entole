/**
 * Runs once when a server starts, before it answers anything.
 *
 * What it sets up only exists on a Node server, so it lives in its own file
 * and is loaded only there. Written this way round, with the check wrapping
 * the import, so that a build for any other runtime leaves the file out.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
