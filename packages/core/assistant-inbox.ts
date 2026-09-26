import type { Address } from 'viem';
import { z } from 'zod';

import { proposalSchema, type Proposal } from './schemas';

/**
 * The assistant's proposal inbox client — the server side lives in
 * `apps/web/app/api/assistant/proposal` over the store in
 * `apps/web/lib/server/store.ts`. A proposal parsed somewhere off the device
 * (the Telegram intake route) is written to that account's inbox; this reads
 * it back so it rides into the same snapshot the app already renders and runs
 * the existing undo window. Nothing here enforces anything — a read proposal
 * is not a payment, it still runs the undo window and the signed on-chain call
 * the allowance already permits.
 *
 * Reads and clears both carry a signature proving control of the account:
 * unlike the directory, a pending proposal is private (it names a recipient,
 * an amount and a note), so the inbox is never open the way directory reads
 * are. The account id is the owner address, lowercased.
 */

/**
 * The exact text an inbox request is signed over. Built the same way on the
 * client before signing and the server before verifying — the server never
 * trusts a client-supplied string, only one it rebuilds from the request's
 * own fields. `action` is inside the signature so a read signature can never
 * be replayed as a clear.
 */
export function buildInboxMessage(input: {
  account: Address;
  action: 'read' | 'clear' | 'link';
  timestampSeconds: number;
}): string {
  return [
    'Entole assistant inbox',
    `account: ${input.account.toLowerCase()}`,
    `action: ${input.action}`,
    `timestamp: ${input.timestampSeconds}`,
  ].join('\n');
}

/** A request signature older than this is refused — a staleness window, not a replay window. */
export const INBOX_MAX_AGE_SECONDS = 300;

export type AssistantInboxClient = ReturnType<typeof createAssistantInboxClient>;

export function createAssistantInboxClient(options: {
  baseUrl: string;
  /** The account whose inbox this client speaks for — the owner address. */
  account: Address;
  sign: (message: string) => Promise<`0x${string}`>;
  fetch?: typeof fetch;
}) {
  const fetchImpl = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  async function call(action: 'read' | 'clear' | 'link', extra?: Record<string, unknown>): Promise<unknown | null> {
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const message = buildInboxMessage({ account: options.account, action, timestampSeconds });
    let signature: `0x${string}`;
    try {
      signature = await options.sign(message);
    } catch {
      return null;
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}/api/assistant/proposal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account: options.account, action, timestampSeconds, signature, ...extra }),
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  return {
    /** The pending proposal for this account, or `null` — a down or
     * unconfigured server reads as an empty inbox, never an error the snapshot
     * has to surface. */
    async read(): Promise<Proposal | null> {
      const json = await call('read');
      const parsed = z.object({ proposal: proposalSchema.nullable() }).safeParse(json);
      return parsed.success ? parsed.data.proposal : null;
    },
    /** Drops the pending proposal once it has been run or cancelled, so the
     * next snapshot read does not surface it again. Best-effort. */
    async clear(): Promise<void> {
      await call('clear');
    },
    /** Registers a one-time code the user then sends to the bot as `/link CODE`,
     * tying that chat to this account. Resolves `true` when the server accepted it. */
    async registerLinkCode(code: string): Promise<boolean> {
      const json = await call('link', { code });
      const parsed = z.object({ ok: z.boolean() }).safeParse(json);
      return parsed.success ? parsed.data.ok : false;
    },
  };
}
