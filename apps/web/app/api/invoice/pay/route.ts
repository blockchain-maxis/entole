import { getAddress, isAddress, verifyMessage, type Address } from 'viem';
import { z } from 'zod';

import { parseHandle } from '@entole/core/handle';
import {
  OneClickError,
  PAY_IN_SOURCE_IDS,
  payInSource,
  readMovement,
  requestPocketDeposit,
  unitsToCents,
} from '@entole/core/intents-pockets';
import { buildInvoicePaysMessage, INVOICE_PAYS_MAX_AGE_SECONDS, invoiceCents } from '@entole/core/invoice-pay';

import { getServerRate } from '@/lib/server/bills';
import { getUsernameOwner } from '@/lib/server/directory';
import { json, preflight, readJson } from '@/lib/server/http';
import {
  invoicePayment,
  invoicePaymentsFor,
  oneClickClient,
  pocketsEnabled,
  rememberInvoicePayment,
  StoreUnavailableError,
} from '@/lib/server/pockets';
import { rateLimit } from '@/lib/server/sponsor';

/**
 * Paying an invoice from another network (see `packages/core/invoice-pay.ts`).
 *
 *   POST {action:'quote'}    the payer: a one-time address on their network
 *                            that delivers the invoice's value in dollars into
 *                            the business's NEAR Intents account. The business
 *                            is found by username here, on the server; its
 *                            address never reaches the payer's screen except as
 *                            the scan code's destination, which is 1Click's.
 *   GET  ?depositAddress=    the payer: where their payment has got to.
 *   POST {action:'list'}     the business's own app, signed: the payments made
 *                            towards its invoices and where each has got to.
 */
export const runtime = 'nodejs';

const signature = z.string().regex(/^0x[0-9a-fA-F]+$/).transform((value) => value as `0x${string}`);
const reference = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9-]+$/);
const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('quote'),
    username: z.string().min(1).max(40),
    reference,
    amountMinor: z.number().int().min(10_000).max(10_000_000_000),
    source: z.enum(PAY_IN_SOURCE_IDS),
  }),
  z.object({
    action: z.literal('list'),
    account: address,
    timestampSeconds: z.number().int().positive(),
    signature,
    references: z.array(reference).min(1).max(30),
  }),
]);

const limited = (retryAfterSeconds: number) =>
  json({ error: 'rate_limited', retryAfterSeconds }, 429, { 'Retry-After': String(retryAfterSeconds) });

export async function POST(request: Request) {
  if (!pocketsEnabled()) return json({ error: 'not_configured' }, 501);
  const parsed = postSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad_request' }, 400);
  const body = parsed.data;
  const client = oneClickClient();

  if (body.action === 'list') {
    const limit = await rateLimit(request, 'invoice-pays', 30, body.account);
    if (!limit.ok) return limited(limit.retryAfterSeconds);
    if (Math.abs(Date.now() / 1000 - body.timestampSeconds) > INVOICE_PAYS_MAX_AGE_SECONDS) return json({ error: 'expired' }, 401);
    const message = buildInvoicePaysMessage({ account: body.account, timestampSeconds: body.timestampSeconds, references: body.references });
    const signed = await verifyMessage({ address: body.account, message, signature: body.signature }).catch(() => false);
    if (!signed) return json({ error: 'invalid_signature' }, 401);
    try {
      const invoices = await Promise.all(body.references.map(async (ref) => {
        const payments = await invoicePaymentsFor(body.account, ref);
        const states = await Promise.all(payments.map(async (payment) => {
          const status = await readMovement(payment.depositAddress, client).catch(() => null);
          return {
            source: payment.source,
            cents: status?.amountOutUnits ? unitsToCents(BigInt(status.amountOutUnits), 6) : payment.cents,
            state: status?.state ?? 'waiting',
            at: payment.at,
            reference: status?.correlationId ?? null,
          };
        }));
        return { reference: ref.toUpperCase(), payments: states };
      }));
      return json({ invoices });
    } catch {
      return json({ error: 'partner_unavailable' }, 502);
    }
  }

  const limit = await rateLimit(request, 'invoice-pay', 6);
  if (!limit.ok) return limited(limit.retryAfterSeconds);
  const handle = parseHandle(body.username.startsWith('@') ? body.username : `@${body.username}`);
  const owner = handle?.kind === 'username' ? await getUsernameOwner(handle.username) : null;
  if (!owner) return json({ error: 'unknown_business' }, 404);

  try {
    const rate = await getServerRate();
    const cents = invoiceCents(body.amountMinor, rate.koboPerDollar);
    const source = payInSource(body.source)!;
    const quote = await requestPocketDeposit({ recipient: owner, source, pocket: 'usd', exact: 'receive', cents }, client);
    await rememberInvoicePayment({
      account: owner.toLowerCase(),
      reference: body.reference.toUpperCase(),
      depositAddress: quote.depositAddress,
      source: body.source,
      cents,
      amountMinor: body.amountMinor,
      at: new Date().toISOString(),
    });
    return json({
      qrPayload: quote.depositAddress,
      sendCents: unitsToCents(BigInt(quote.amountInUnits), source.decimals),
      invoiceCents: cents,
      deadline: quote.deadline,
      etaSeconds: quote.etaSeconds,
    });
  } catch (error) {
    if (error instanceof StoreUnavailableError) return json({ error: 'not_configured' }, 501);
    if (error instanceof OneClickError && error.status === 400) return json({ error: 'amount_refused', message: error.reason }, 400);
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export async function GET(request: Request) {
  const depositAddress = z.string().regex(/^[A-Za-z0-9]{20,90}$/).safeParse(new URL(request.url).searchParams.get('depositAddress'));
  if (!depositAddress.success) return json({ error: 'bad_request' }, 400);
  const limit = await rateLimit(request, 'invoice-pay-status', 60);
  if (!limit.ok) return limited(limit.retryAfterSeconds);
  if (!(await invoicePayment(depositAddress.data))) return json({ error: 'unknown' }, 404);
  try {
    const status = await readMovement(depositAddress.data, oneClickClient());
    return json({ state: status?.state ?? 'waiting' });
  } catch {
    return json({ error: 'partner_unavailable' }, 502);
  }
}

export function OPTIONS() {
  return preflight();
}
