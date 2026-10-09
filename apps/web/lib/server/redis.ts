import { Redis } from '@upstash/redis';

/**
 * The one Upstash Redis client for server code that needs shared state across
 * serverless instances: the durable store and the rate limiter. Read lazily so
 * a build with no Redis provisioned still boots. `null` means "not configured",
 * and each caller decides whether that is fine (dev and tests) or an error.
 * Server-only, same rule as `sponsor.ts`.
 */
let client: { key: string; redis: Redis } | null = null;

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const key = `${url}|${token}`;
  if (client?.key !== key) client = { key, redis: new Redis({ url, token }) };
  return client.redis;
}

/** In production the durable pieces must have Redis; everywhere else the
 * in-memory fallbacks are correct. */
export function requiresRedis(): boolean {
  return process.env.NODE_ENV === 'production';
}
