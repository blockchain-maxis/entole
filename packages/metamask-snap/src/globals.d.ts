/**
 * Minimal ambient declarations for the two globals a Snap runtime injects
 * (`snap`, for Snap-to-platform RPC like `snap_dialog`; `ethereum`, the
 * standard EIP-1193 provider for the connected account/chain). The real
 * shapes ship from `@metamask/snaps-sdk`/`@metamask/providers` — this file
 * is a narrow, self-written stand-in so `tsc --noEmit` is self-consistent
 * without a live `pnpm install` in this environment. Delete this file once
 * the real dependency is installed and its own ambient types take over; if
 * they conflict, the installed package's types win.
 */
declare const snap: {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
};

declare const ethereum: {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
};
