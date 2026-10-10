import {
  AURORA_SOURCE_IDS,
  AuroraError,
  readAuroraDeposit,
  requestAuroraDeposit,
  type AuroraConfig,
} from '@entole/core/aurora-intents';
import { requestConversionAddress } from '@entole/core/onramp';
import { z } from 'zod';

import { json, preflight, readJson } from '@/lib/server/http';
import { accountAddress, readMoneyInConfig } from '@/lib/server/onramp';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Adding money from a network the usual route does not reach: USDT on Tron,
 * USDC on Solana. Through Aurora Intents.
 *
 * Two partners, one after the other, and neither holds the money for us:
 *
 * 1. A holding address on Monad that turns USDC into the account's own money
 *    and passes it to the account. If that cannot be done, the USDC goes to
 *    the person's own account, not to anyone else.
 * 2. Aurora, asked to deliver one deposit of the stated amount to that holding
 *    address. It answers with where to send on the other network. If Aurora
 *    cannot complete it, the money returns to the account the person named on
 *    that network.
 *
 * The answer is an address. No screen may print it (hard rule), so it is
 * returned as `qrPayload`: something to draw as a scan code or copy with a
 * button, never to show as text.
 *
 * `GET ?depositAddress=` says how far a deposit has got.
 *
 * Off (501) away from the main network or without `AURORA_INTENTS_API_KEY`:
 * Aurora has no test network, so there is nothing to offer there.
 */
export const runtime = 'nodejs';

const START_LIMIT_PER_MINUTE = 5;
const STATUS_LIMIT_PER_MINUTE = 30;

const bodySchema = z.object({
  address: accountAddress,
  source: z.enum(AURORA_SOURCE_IDS),
  /** What the person says they are sending, in the sent asset's smallest unit. */
  amountUnits: z
    .string()
    .regex(/^[1-9]\d{0,17}$/)
    .transform((value) => BigInt(value)),
  /** Their account on the sending network, for a deposit that cannot be completed. */
  returnAccount: z.string().trim().min(26).max(64),
});

function readAuroraConfig(): AuroraConfig | null {
  const apiKey = process.env.AURORA_INTENTS_API_KEY?.trim();
  if (!apiKey) return null;
  const apiBase = process.env.AURORA_INTENTS_API_BASE?.trim();
  return { apiKey, ...(apiBase ? { apiBase } : {}) };
}

function limited(retryAfterSeconds: number) {
  return json({ error: 'rate_limited', retryAfterSeconds }, 429, { 'Retry-After': String(retryAfterSeconds) });
}

export async function POST(request: Request) {
  const moneyIn = readMoneyInConfig();
  const aurora = readAuroraConfig();
  if (!moneyIn || !aurora) return json({ error: 'not_configured' }, 501);

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const { address, source, amountUnits, returnAccount } = parsed.data;

  const limit = await rateLimit(request, 'aurora-deposit', START_LIMIT_PER_MINUTE, address);
  if (!limit.ok) return limited(limit.retryAfterSeconds);

  try {
    // Both things sent this way are dollars with six decimals, as USDC is, so
    // the stated amount prices the conversion as it stands.
    const holding = await requestConversionAddress({ recipient: address, amountUnits }, { ...moneyIn, refundTo: address });
    const deposit = await requestAuroraDeposit(
      { source, amountUnits, recipient: holding.depositAddress, returnAccount },
      aurora,
    );
    if (!deposit.depositAddress) return json({ error: 'partner_unavailable' }, 502);
    return json({
      qrPayload: deposit.depositAddress,
      sendUnits: deposit.amountUnits.toString(),
      minimumUnits: deposit.minimumUnits.toString(),
      // The conversion was priced for the stated amount; a little less than
      // that reaches it, so what lands is scaled to match. An estimate.
      arrivesAboutUnits: ((holding.settlementUnits * deposit.arrivesUnits) / deposit.amountUnits).toString(),
      ...(deposit.deadline ? { deadline: deposit.deadline } : {}),
      etaSeconds: deposit.etaSeconds,
    });
  } catch (error) {
    if (error instanceof AuroraError && error.code === 'amount_too_small') {
      return json(
        { error: 'amount_too_small', ...(error.minimumDollars ? { minimumDollars: error.minimumDollars } : {}) },
        400,
      );
    }
    if (error instanceof AuroraError && error.code === 'bad_return_account') {
      return json({ error: 'bad_return_account' }, 400);
    }
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export async function GET(request: Request) {
  const aurora = readAuroraConfig();
  if (!readMoneyInConfig() || !aurora) return json({ error: 'not_configured' }, 501);

  const limit = await rateLimit(request, 'aurora-status', STATUS_LIMIT_PER_MINUTE);
  if (!limit.ok) return limited(limit.retryAfterSeconds);

  const depositAddress = new URL(request.url).searchParams.get('depositAddress')?.trim() ?? '';
  if (!/^[A-Za-z0-9]{26,64}$/.test(depositAddress)) return json({ error: 'bad_request' }, 400);

  try {
    return json({ state: await readAuroraDeposit(depositAddress, aurora) });
  } catch {
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
