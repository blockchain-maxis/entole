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
import type { Redis } from '@upstash/redis';

import { getRedis } from './redis';

/**
 * The server-side "sponsor": one funded account that pays the network fee for
 * people who hold no MON. Server-only — `SPONSOR_PRIVATE_KEY` is deliberately
 * not prefixed NEXT_PUBLIC_, and nothing here may be imported from a client
 * component or returned from a route. (`server-only` is not installed in this
 * repo, so the boundary is this folder plus that rule.)
 */

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
/** Monad's test network. */
export const TEST_CHAIN_ID = 10143;
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_CHAIN_ID) : TEST_CHAIN_ID;

/**
 * True on the test network only. Handing out test money has no meaning
 * anywhere else, so the route that does it answers 404 off it. Read per call,
 * so it follows the environment the server is actually running with.
 */
export function onTestNetwork(): boolean {
  const configured = process.env.NEXT_PUBLIC_CHAIN_ID?.trim();
  return (configured ? Number(configured) : TEST_CHAIN_ID) === TEST_CHAIN_ID;
}

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

/** The settlement asset's decimals: Agora AUSD has six. */
export const TOKEN_DECIMALS = 6;

let reader: ReturnType<typeof createPublicClient> | undefined;

/**
 * A client that only reads the network. It needs no key, so a route that only
 * has to check what happened (did this payment settle, and who was it for) can
 * use it whether or not a sponsor is configured.
 */
export function getChainReader() {
  reader ??= createPublicClient({ chain, transport: http(RPC_URL) });
  return reader;
}

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

/** The deployed `EntolePolicy`, or `null` when its address is not configured. */
export function getPolicyAddress(): Address | null {
  const address = process.env.NEXT_PUBLIC_ENTOLE_POLICY_ADDRESS?.trim();
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

export type RateResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Fixed window held in this process's memory: the dev and test fallback, and
 * the safety net if Redis is briefly unreachable. Per-instance, so on
 * serverless it only blunts a casual loop. */
function memoryLimit(key: string, limit: number): RateResult {
  const now = Date.now();
  if (windows.size > 5_000) {
    for (const [stale, entry] of windows) if (entry.resetAt <= now) windows.delete(stale);
  }
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

/** The slice of Redis the shared limiter touches. */
export type LimiterRedis = Pick<Redis, 'incr' | 'expire' | 'ttl'>;

/** Fixed window shared across every instance: INCR, and the first hit sets
 * the window's expiry, so a key can never outlive it. */
export async function sharedLimit(redis: LimiterRedis, key: string, limit: number): Promise<RateResult> {
  const windowSeconds = WINDOW_MS / 1000;
  const count = await redis.incr(`rl:${key}`);
  if (count === 1) await redis.expire(`rl:${key}`, windowSeconds);
  if (count <= limit) return { ok: true };
  const ttl = await redis.ttl(`rl:${key}`);
  return { ok: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
}

/**
 * Fixed-window limiter, per caller IP and, when `subject` is given, per
 * subject too (an account address, say), so rotating IPs does not lift a cap
 * on one account. Shared through Upstash Redis when it is configured, so every
 * serverless instance counts together; in memory otherwise, and also if Redis
 * errors, so a Redis blip never takes a route down. `bucket` keeps each
 * route's counts apart.
 */
export async function rateLimit(
  request: Request,
  bucket: string,
  limit: number,
  subject?: string,
): Promise<RateResult> {
  const keys = [`${bucket}:ip:${clientIp(request)}`];
  if (subject) keys.push(`${bucket}:subject:${subject.toLowerCase()}`);

  const redis = getRedis();
  for (const key of keys) {
    let result: RateResult;
    try {
      result = redis ? await sharedLimit(redis, key, limit) : memoryLimit(key, limit);
    } catch {
      result = memoryLimit(key, limit);
    }
    if (!result.ok) return result;
  }
  return { ok: true };
}

const DAY_SECONDS = 86_400;
const days = new Map<string, { day: string; count: number }>();

/** The slice of Redis a daily budget touches. */
export type BudgetRedis = Pick<Redis, 'incr' | 'expire'>;

function secondsLeftToday(now: Date): number {
  return Math.max(1, DAY_SECONDS - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()));
}

/**
 * A count per day (UTC) that may not pass `limit`: how much the sponsor will
 * pay for, or how many times the model will be asked, however many callers or
 * addresses the requests are spread across. A per-minute limit slows a loop
 * down; this is what bounds what a day of it can cost.
 *
 * Counted when asked, so call it only when the thing is about to be done.
 * Shared through Redis when it is configured; in memory otherwise and if Redis
 * errors, the same as `rateLimit`. With `subject`, the count is that subject's
 * own (one account, one allowance) and not everyone's.
 */
export async function dailyBudget(name: string, limit: number, subject?: string, now = new Date()): Promise<RateResult> {
  const day = now.toISOString().slice(0, 10);
  const key = subject ? `${name}:${subject.toLowerCase()}` : name;
  const over: RateResult = { ok: false, retryAfterSeconds: secondsLeftToday(now) };

  const redis: BudgetRedis | null = getRedis();
  if (redis) {
    try {
      const count = await redis.incr(`day:${day}:${key}`);
      // Two days, so a key set just before midnight never outlives the day after.
      if (count === 1) await redis.expire(`day:${day}:${key}`, DAY_SECONDS * 2);
      return count <= limit ? { ok: true } : over;
    } catch {
      // Fall through to this instance's own count.
    }
  }

  if (days.size > 5_000) {
    for (const [stale, entry] of days) if (entry.day !== day) days.delete(stale);
  }
  const entry = days.get(key);
  if (!entry || entry.day !== day) {
    days.set(key, { day, count: 1 });
    return limit >= 1 ? { ok: true } : over;
  }
  if (entry.count >= limit) return over;
  entry.count += 1;
  return { ok: true };
}

/** A whole number from the environment, or the default when it is unset or not one. */
function configuredCount(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  return value && /^\d{1,9}$/.test(value) ? Number(value) : fallback;
}

/** Everything the sponsor pays a fee for in a day, across every route and caller. */
export function sponsorDailySends(): number {
  return configuredCount('SPONSOR_DAILY_SENDS', 5_000);
}

/** Sponsored sends in a day for one payer, or one allowance. */
export function sponsorDailySendsEach(): number {
  return configuredCount('SPONSOR_DAILY_SENDS_EACH', 300);
}

/**
 * The checks every sponsored send passes just before it is sent: this payer
 * (or allowance) has not been sent for too often, in the last minute or
 * today, and the sponsor has not spent its day. `subject` is whatever the
 * signature names, so changing address does not lift it.
 */
export async function sponsoredSendAllowed(request: Request, bucket: string, subject: string): Promise<RateResult> {
  const minute = await rateLimit(request, `${bucket}-each`, RELAY_LIMIT_PER_MINUTE, subject);
  if (!minute.ok) return minute;
  const each = await dailyBudget(`${bucket}-each`, sponsorDailySendsEach(), subject);
  if (!each.ok) return each;
  return dailyBudget('sponsor-sends', sponsorDailySends());
}

/** For tests. */
export function resetRateLimits(): void {
  windows.clear();
  days.clear();
}
