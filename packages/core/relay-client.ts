import type { Address, Hex } from 'viem';
import { z } from 'zod';

/**
 * The client for Entole's sponsor server (`apps/web/app/api/*`). The server
 * pays the network fee and submits what the person signed; it can't change what
 * they signed. Every response is parsed before use, and every failure becomes
 * plain copy — the raw codes never reach a screen.
 */

export type RelayPayment = {
  from: Address;
  recipient: Address;
  amount: bigint;
  validAfter: bigint;
  validBefore: bigint;
  salt: Hex;
  v: number;
  r: Hex;
  s: Hex;
};

const MESSAGES: Record<string, string> = {
  not_configured: "This isn't available yet.",
  bad_request: 'Something was wrong with that request. Try again.',
  bad_window: 'That took too long. Try again.',
  expired: 'That took too long. Try again.',
  already_used: 'That payment was already sent.',
  amount_out_of_range: 'That amount is outside what can be sent right now.',
  insufficient_funds: "You don't have enough for this payment and its fee.",
  invalid_signature: "We couldn't confirm that it was you. Try again.",
  rejected: "That didn't go through. Try again.",
  sponsor_low: 'Payments are paused for a moment. Try again shortly.',
  rate_limited: 'Too many tries. Wait a moment and try again.',
  cooldown: 'Adding money is busy right now. Try again in a minute.',
  already_funded: 'You already have plenty of test money.',
};

export class RelayError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(MESSAGES[code] ?? 'Something went wrong. Try again.');
    this.name = 'RelayError';
    this.code = code;
  }
}

const hashSchema = z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });
const errorSchema = z.object({ error: z.string() });
const gasSchema = z.object({ funded: z.boolean(), hash: z.string().optional() });
const fundedSchema = hashSchema.extend({ amountMinor: z.string().regex(/^\d+$/).optional() });

export type RelayClient = ReturnType<typeof createRelayClient>;

export function createRelayClient(options: { baseUrl: string; fetch?: typeof fetch }) {
  const fetchImpl = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new RelayError('unreachable');
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new RelayError(response.status === 429 ? 'rate_limited' : 'unreachable');
    }
    if (!response.ok) {
      const failure = errorSchema.safeParse(json);
      throw new RelayError(failure.success ? failure.data.error : response.status === 429 ? 'rate_limited' : 'unreachable');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new RelayError('unreachable');
    return parsed.data;
  }

  return {
    /** Submits a signed payment; resolves with the transaction hash. */
    async submitPayment(payment: RelayPayment): Promise<Hex> {
      const { hash } = await post(
        '/api/relay',
        {
          from: payment.from,
          recipient: payment.recipient,
          amount: payment.amount.toString(),
          validAfter: payment.validAfter.toString(),
          validBefore: payment.validBefore.toString(),
          salt: payment.salt,
          v: payment.v,
          r: payment.r,
          s: payment.s,
        },
        hashSchema,
      );
      return hash as Hex;
    },
    /** Asks the server to cover the account's own network fees. Resolves once
     * the request is accepted; `funded: true` means nothing was needed. */
    async requestGas(address: Address): Promise<{ funded: boolean }> {
      const { funded } = await post('/api/gas', { address }, gasSchema);
      return { funded };
    },
    /** Asks the server to add test money to an account. */
    async requestFunds(address: Address): Promise<{ hash: Hex; amountMinor?: string }> {
      const funded = await post('/api/faucet', { address }, fundedSchema);
      return { hash: funded.hash as Hex, ...(funded.amountMinor ? { amountMinor: funded.amountMinor } : {}) };
    },
  };
}

/**
 * `ensureGas` for the gateway: before the person's own transaction, make sure
 * the account can pay the network fee. Checks the balance first so a funded
 * account costs one cheap read and no server call.
 */
export function createEnsureGas(options: {
  getBalance: (address: Address) => Promise<bigint>;
  relay: Pick<RelayClient, 'requestGas'>;
  /** Below this the account is topped up. */
  minimum?: bigint;
  sleep?: (ms: number) => Promise<void>;
}) {
  const minimum = options.minimum ?? 20_000_000_000_000_000n; // 0.02
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async function ensureGas(owner: Address): Promise<void> {
    if ((await options.getBalance(owner)) >= minimum) return;
    const { funded } = await options.relay.requestGas(owner);
    if (funded) return;
    // The top-up is a transaction; wait until it lands before the caller signs.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(500);
      if ((await options.getBalance(owner)) >= minimum) return;
    }
    throw new RelayError('unreachable');
  };
}
