import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { receiptCheckLine, receiptFileName, slipFacts } from '@entole/core/receipt-slip';

import { ReceiptPicture, receiptPictureSize } from '@/components/ReceiptPicture';
import { getByReference } from '@/lib/server/payments';
import { rateLimit, TOKEN_DECIMALS } from '@/lib/server/sponsor';
import { SITE_ORIGIN } from '@/lib/site';

/**
 * A receipt as a picture: what "Share receipt" sends, and what a shared
 * receipt link shows in a chat.
 *
 * It is drawn from one thing: the payment the server kept under this
 * reference, which it read from the network when the payment settled
 * (`getByReference`). The only thing taken from the request is the reference
 * in the path. No amount, name or note can be passed in, so there is no way
 * to have a receipt drawn for a payment that did not happen. With no such
 * payment there is no picture: a plain 404.
 */
export const runtime = 'nodejs';

const LIMIT_PER_MINUTE = 60;

/**
 * The fonts and the mark, read once: none of it depends on who is asking. The
 * paths are written out in full so the build can see which files to ship with
 * this route. The fonts are the apps' own two families, cut down for the
 * picture (`assets/receipt/make-fonts.py`); the mark is the app icon's file.
 */
const assets = Promise.all([
  readFile(join(process.cwd(), 'assets/receipt/SourceSerif4-SemiBold.ttf')),
  readFile(join(process.cwd(), 'assets/receipt/PlusJakartaSans-Medium.ttf')),
  readFile(join(process.cwd(), 'assets/receipt/PlusJakartaSans-SemiBold.ttf')),
  readFile(join(process.cwd(), 'public/icons/icon.svg'), 'base64'),
]).catch(() => null);

const plain = (words: string, status: number, more: Record<string, string> = {}) =>
  new Response(words, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...more },
  });

const bytes = (file: Buffer): ArrayBuffer => new Uint8Array(file).buffer;

export async function GET(request: Request, context: { params: Promise<{ reference: string }> }) {
  const limit = await rateLimit(request, 'receipt', LIMIT_PER_MINUTE);
  if (!limit.ok) return plain('Too many requests', 429, { 'Retry-After': String(limit.retryAfterSeconds) });

  const { reference } = await context.params;
  let payment;
  try {
    payment = await getByReference(reference);
  } catch {
    return plain('Try again in a moment', 503);
  }
  if (!payment) return plain('Not found', 404);

  const loaded = await assets;
  if (!loaded) return plain('The picture could not be drawn', 500);
  const [serif, sansMedium, sansSemiBold, mark] = loaded;

  const facts = slipFacts(payment, { tokenDecimals: TOKEN_DECIMALS });
  const size = receiptPictureSize(facts);

  try {
    // Drawn in full before anything is sent, so a picture that fails to draw
    // is an error and never half a file.
    const picture = await new ImageResponse(
      (
        <ReceiptPicture
          facts={facts}
          mark={`data:image/svg+xml;base64,${mark}`}
          checkLine={receiptCheckLine(SITE_ORIGIN, facts.reference) ?? ''}
        />
      ),
      {
        ...size,
        fonts: [
          { name: 'Source Serif 4', data: bytes(serif), weight: 600, style: 'normal' },
          { name: 'Plus Jakarta Sans', data: bytes(sansMedium), weight: 500, style: 'normal' },
          { name: 'Plus Jakarta Sans', data: bytes(sansSemiBold), weight: 600, style: 'normal' },
        ],
      },
    ).arrayBuffer();

    return new Response(picture, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="${receiptFileName(facts.reference)}"`,
        // A kept payment never changes, so neither does its picture.
        'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch {
    return plain('The picture could not be drawn', 500);
  }
}
