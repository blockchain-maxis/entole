import { hexToBytes, type Address, type Hex } from 'viem';
import { z } from 'zod';

/**
 * Money held for the person on NEAR Intents, and bringing it back.
 *
 * A deposit from Tron or Solana that Aurora cannot complete is returned into
 * the person's own Intents account, named by their Entole address
 * (`aurora-intents.ts`). It is theirs: only a signature from their own key
 * can move it. This file reads how much is there, and builds the one
 * signature that sends it on.
 *
 * Bringing it back goes through 1Click, NEAR Intents' own service: a quote
 * that takes the held tokens from the Intents account (`depositType:
 * 'INTENTS'`) and delivers USDC on Arbitrum to a holding address that turns
 * it into the account's own money on Monad (the same conversion partner as
 * "From another app"). 1Click writes the intent; the person's key signs it,
 * ERC-191, the way any Ethereum wallet signs a message; 1Click carries it
 * out. No fee money is needed anywhere.
 *
 * Checked against the documentation on 15 October 2026. The quote, generate
 * and submit calls need a 1Click partner key, so none of it runs without one.
 */

export const INTENTS_CONTRACT = 'intents.near';
export const NEAR_RPC = 'https://rpc.mainnet.near.org';
export const ONECLICK_API_BASE = 'https://1click.chaindefuser.com';
/** USDC on Arbitrum as NEAR Intents names it: where held money is sent on its way home. */
export const INTENTS_ARBITRUM_USDC = 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 (Bitcoin alphabet), as NEAR writes keys and signatures. */
export function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/**
 * An Ethereum signature (r ‖ s ‖ v, v 27 or 28) as the Intents verifier takes
 * it: the same 65 bytes with v as 0 or 1, base58, after `secp256k1:`.
 */
export function intentsSignature(signature: Hex): string {
  const bytes = hexToBytes(signature);
  if (bytes.length !== 65) throw new Error('A signature is 65 bytes.');
  const v = bytes[64]!;
  bytes[64] = v >= 27 ? v - 27 : v;
  if (bytes[64] !== 0 && bytes[64] !== 1) throw new Error('A signature ends in 0 or 1.');
  return `secp256k1:${base58(bytes)}`;
}

/** The Intents account a person's address names: the address itself, lower-case. */
export function intentsAccountOf(owner: Address): string {
  return owner.toLowerCase();
}

/**
 * How much of `tokenId` is held for `owner` on NEAR Intents, in the token's
 * smallest unit. A plain read of the contract's public balance; no key.
 */
export async function readHeldInIntents(options: {
  owner: Address;
  tokenId: string;
  rpc?: string;
  fetch?: typeof fetch;
}): Promise<bigint> {
  const args = JSON.stringify({ account_id: intentsAccountOf(options.owner), token_id: options.tokenId });
  const response = await (options.fetch ?? fetch)(options.rpc ?? NEAR_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'held',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: INTENTS_CONTRACT,
        method_name: 'mt_balance_of',
        args_base64: btoaOf(args),
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC ${response.status}`);
  const parsed = z
    .object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)) }) })
    .safeParse(await response.json());
  if (!parsed.success) throw new Error('NEAR RPC answered something else');
  const text = new TextDecoder().decode(new Uint8Array(parsed.data.result.result));
  const amount = z.string().regex(/^\d+$/).safeParse(JSON.parse(text));
  if (!amount.success) throw new Error('NEAR RPC answered something else');
  return BigInt(amount.data);
}

function btoaOf(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// 1Click, server side: it needs the partner key.
// ---------------------------------------------------------------------------

export type OneClickConfig = { apiKey: string; apiBase?: string; fetch?: typeof fetch; now?: () => Date };

/** The intent 1Click wrote, exactly as it wrote it: the payload is what is signed. */
export const generatedIntentSchema = z.object({
  standard: z.literal('erc191'),
  payload: z.string().min(1).max(20_000),
});

export type GeneratedIntent = z.infer<typeof generatedIntentSchema>;

async function oneClick<T>(config: OneClickConfig, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await (config.fetch ?? fetch)(`${(config.apiBase ?? ONECLICK_API_BASE).replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'X-API-Key': config.apiKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`1Click ${path} ${response.status}`);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`1Click ${path} answered something else`);
  return parsed.data;
}

/**
 * Prepares bringing `amount` of `tokenId` home: a quote that takes it from the
 * person's Intents account to a holding address on Arbitrum, then the intent
 * for them to sign. If the swap cannot be done, it stays where it is.
 */
export async function prepareBringBack(
  input: { owner: Address; tokenId: string; amount: bigint; holdingAddress: Address },
  config: OneClickConfig,
): Promise<{ depositAddress: string; intent: GeneratedIntent }> {
  const now = (config.now ?? (() => new Date()))();
  const { quote } = await oneClick(
    config,
    '/v0/quote',
    {
      dry: false,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      depositType: 'INTENTS',
      originAsset: input.tokenId,
      destinationAsset: INTENTS_ARBITRUM_USDC,
      amount: input.amount.toString(),
      refundTo: intentsAccountOf(input.owner),
      refundType: 'INTENTS',
      recipient: input.holdingAddress,
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    },
    z.object({ quote: z.object({ depositAddress: z.string().min(1) }) }),
  );
  const { intent } = await oneClick(
    config,
    '/v0/generate-intent',
    { type: 'swap_transfer', standard: 'erc191', signerId: intentsAccountOf(input.owner), depositAddress: quote.depositAddress },
    z.object({ intent: generatedIntentSchema }),
  );
  // The intent must be the person's own, moving only to this quote.
  const message = JSON.parse(intent.payload) as { signer_id?: unknown };
  if (typeof message.signer_id !== 'string' || message.signer_id.toLowerCase() !== intentsAccountOf(input.owner)) {
    throw new Error('1Click wrote an intent for someone else.');
  }
  return { depositAddress: quote.depositAddress, intent };
}

/** Hands 1Click the intent the person signed. Resolves with its hash. */
export async function submitBringBack(
  input: { intent: GeneratedIntent; signature: Hex },
  config: OneClickConfig,
): Promise<string> {
  const { intentHash } = await oneClick(
    config,
    '/v0/submit-intent',
    { type: 'swap_transfer', signedData: { ...input.intent, signature: intentsSignature(input.signature) } },
    z.object({ intentHash: z.string().min(1) }),
  );
  return intentHash;
}
