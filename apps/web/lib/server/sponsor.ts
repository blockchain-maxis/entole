import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * The server-side "sponsor": one funded account that pays the network fee for
 * people who hold no MON. Server-only — `SPONSOR_PRIVATE_KEY` is deliberately
 * not prefixed NEXT_PUBLIC_, and nothing here may be imported from a client
 * component or returned from a route. (`server-only` is not installed in this
 * repo, so the boundary is this folder plus that rule.)
 */

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_CHAIN_ID) : 10143;

export const TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_ENTOLE_TOKEN_ADDRESS ??
  '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC') as Address;
/** Agora's testnet AUSD faucet. */
export const FAUCET_ADDRESS = '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C' as Address;

/** Below this the sponsor cannot be trusted to land a transaction. */
export const SPONSOR_MIN_BALANCE = parseEther('0.02');

const chain: Chain = {
  id: CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

function build(key: Hex) {
  const account = privateKeyToAccount(key);
  const transport = http(RPC_URL);
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

export type Sponsor = ReturnType<typeof build>;

let cached: { key: string; sponsor: Sponsor } | undefined;

/**
 * The sponsor, or `null` when `SPONSOR_PRIVATE_KEY` is unset, blank or not a
 * 32-byte hex key — routes answer 501. Read per call so the key is never
 * captured at build time; the key itself is never logged or returned.
 */
export function getSponsor(): Sponsor | null {
  const key = process.env.SPONSOR_PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  if (cached?.key !== key) cached = { key, sponsor: build(key as Hex) };
  return cached.sponsor;
}

/** The deployed `EntoleRouter`, or `null` when its address is not configured. */
export function getRouterAddress(): Address | null {
  const address = process.env.NEXT_PUBLIC_ENTOLE_ROUTER_ADDRESS?.trim();
  return address && /^0x[0-9a-fA-F]{40}$/.test(address) ? (address as Address) : null;
}

/** True when the sponsor's MON balance is too low to send. */
export async function sponsorIsLow(sponsor: Sponsor): Promise<boolean> {
  const balance = await sponsor.publicClient.getBalance({ address: sponsor.account.address });
  return balance < SPONSOR_MIN_BALANCE;
}

let queueTail: Promise<unknown> = Promise.resolve();

/**
 * Runs sends one at a time. The sponsor has a single nonce sequence, so two
 * concurrent sends would race for the same nonce.
 */
export function sendSerially<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(task, task);
  queueTail = run.catch(() => undefined);
  return run;
}

const WINDOW_MS = 60_000;
export const RELAY_LIMIT_PER_MINUTE = 10;
export const FAUCET_LIMIT_PER_MINUTE = 3;

const windows = new Map<string, { count: number; resetAt: number }>();

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Fixed-window, per-IP limiter held in this process's memory. Best-effort
 * only: on serverless every instance has its own map and cold starts reset
 * it, so this blunts a casual loop, not a determined caller. `bucket` keeps
 * each route's counts apart.
 */
export function rateLimit(
  request: Request,
  bucket: string,
  limit: number,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  if (windows.size > 5_000) {
    for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key);
  }
  const key = `${bucket}:${clientIp(request)}`;
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }
  if (entry.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { ok: true };
}

/** For tests. */
export function resetRateLimits(): void {
  windows.clear();
}
