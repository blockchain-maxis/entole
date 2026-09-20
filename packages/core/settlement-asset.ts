import type { Address } from 'viem';
import { z } from 'zod';

/**
 * Agora AUSD — the settlement-asset bounty. `docs/ARCHITECTURE.md`: "Settlement
 * asset: Agora AUSD where the mint and redeem routes work, USDC as fallback...
 * Wrap it behind an interface so swapping to USDC is a one-file change."
 *
 * That promise is already mostly kept structurally — `onchain-gateway.ts`
 * takes `tokenAddress`/`tokenDecimals` as config. Both apps now point at
 * Agora's AUSD on Monad testnet (`0xa9012a…22dC`); mainnet AUSD is
 * `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` on chain 143 — a config change,
 * not a rewrite. What this file adds is the other half: actually minting AUSD
 * from fiat/another stablecoin and redeeming it back, via Agora's real API —
 * confirmed live against `docs.agora.finance` (not guessed):
 *
 *   POST https://api.agora.finance/v0/auth/token
 *     Authorization: Bearer <accessKey>  →  { sessionJwt }, valid 15 minutes
 *
 *   Routes are reusable mint/redeem paths, not one-off transfers — no amount
 *   in the request. Confirmed request/response shape:
 *     request:  { from: { currency }, to: { accountId, currency, chain? } }
 *     response: { id, instructions: { memo?, accountNumber?, bankName?,
 *                 routingNumber?, depositAddress?, supportedCurrencies? } }
 *
 * Gated off exactly like `GrowthVault`'s address or the indexer's URL: no
 * `AGORA_ACCESS_KEY` means every call here throws "not configured" rather
 * than fabricating a route. Nothing pretends to talk to Agora without one.
 */

const AGORA_API_BASE = 'https://api.agora.finance/v0';

export type AgoraConfig = {
  accessKey: string;
  apiBase?: string;
};

const sessionTokenSchema = z.object({ sessionJwt: z.string().min(1) });

const bankInstructionsSchema = z.object({
  memo: z.string().optional(),
  accountNumber: z.string().optional(),
  bankName: z.string().optional(),
  routingNumber: z.string().optional(),
});

const chainInstructionsSchema = z.object({
  depositAddress: z.string().min(1),
  supportedCurrencies: z.array(z.string()).optional(),
});

/** `chainInstructionsSchema` first — it has a required field, so Zod's
 * first-match union semantics would otherwise let the all-optional bank
 * schema swallow a chain response and silently strip `depositAddress`. */
const routeSchema = z.object({
  id: z.string().min(1),
  instructions: z.union([chainInstructionsSchema, bankInstructionsSchema]),
});

export type AgoraRoute = z.infer<typeof routeSchema>;

function requireAgoraConfig(config: AgoraConfig | undefined): AgoraConfig {
  if (!config?.accessKey) {
    throw new Error('Agora is not configured — set AGORA_ACCESS_KEY to mint/redeem AUSD for real.');
  }
  return config;
}

/** Exchanges the access key for a session JWT. Callers hold it for at most
 * 15 minutes per Agora's own docs — this file never caches one across
 * calls, since nothing here runs often enough for that to matter yet. */
async function getSessionToken(config: AgoraConfig): Promise<string> {
  const base = config.apiBase ?? AGORA_API_BASE;
  const response = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessKey}` },
  });
  if (!response.ok) throw new Error(`Agora session-token request failed: ${response.status}`);
  const body: unknown = await response.json();
  return sessionTokenSchema.parse(body).sessionJwt;
}

/**
 * Creates (or reuses) a mint route — fiat or another stablecoin in, AUSD
 * out, credited to `destinationAddress` on Monad. Every field the caller
 * gets back is Zod-validated before use, same rule as everywhere else an
 * external response crosses into this codebase.
 */
export async function createMintRoute(
  fromCurrency: string,
  destinationAddress: Address,
  config?: AgoraConfig,
): Promise<AgoraRoute> {
  const resolved = requireAgoraConfig(config);
  const sessionJwt = await getSessionToken(resolved);
  const base = resolved.apiBase ?? AGORA_API_BASE;

  const response = await fetch(`${base}/routes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { currency: fromCurrency },
      to: { accountId: destinationAddress, currency: 'AUSD', chain: 'monad' },
    }),
  });
  if (!response.ok) throw new Error(`Agora route creation failed: ${response.status}`);
  const body: unknown = await response.json();
  return routeSchema.parse(body);
}

/** The reverse of `createMintRoute` — AUSD out, `toCurrency` back to the
 * owner. Same gate, same validation. */
export async function createRedeemRoute(
  toCurrency: string,
  destinationAccountId: string,
  config?: AgoraConfig,
): Promise<AgoraRoute> {
  const resolved = requireAgoraConfig(config);
  const sessionJwt = await getSessionToken(resolved);
  const base = resolved.apiBase ?? AGORA_API_BASE;

  const response = await fetch(`${base}/routes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionJwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { currency: 'AUSD' },
      to: { accountId: destinationAccountId, currency: toCurrency },
    }),
  });
  if (!response.ok) throw new Error(`Agora route creation failed: ${response.status}`);
  const body: unknown = await response.json();
  return routeSchema.parse(body);
}
