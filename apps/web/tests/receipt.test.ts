import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeptPayment } from '@entole/core/payments-feed';
import { slipFacts } from '@entole/core/receipt-slip';
import { watermarkToken } from '@entole/tokens';

import { GET } from '@/app/api/receipt/[reference]/image/route';
import { generateMetadata } from '@/app/receipt/[reference]/page';
import letters from '@/assets/receipt/advances.json';
import stampWord from '@/assets/receipt/watermark-word.json';
import { receiptPictureSize } from '@/components/ReceiptPicture';
import { isPublicPath } from '@/lib/public-routes';
import { getByReference } from '@/lib/server/payments';
import { rateLimit } from '@/lib/server/sponsor';
import { SITE_ORIGIN } from '@/lib/site';

/**
 * A receipt, as a picture and as a page, against a fake store: no Redis, no
 * network. The picture is really drawn, so what is checked is a real file.
 *
 * The rule under test is the one that matters: a receipt is drawn from the
 * payment the server kept and from nothing else. Nothing in a request can put
 * an amount, a name or a note on one.
 */
vi.mock('@/lib/server/payments', () => ({ getByReference: vi.fn() }));
vi.mock('@/lib/server/sponsor', () => ({ rateLimit: vi.fn(), TOKEN_DECIMALS: 6 }));
// The page's own parts are not under test here, and they reach for a browser.
vi.mock('@/components/CheckoutHeader', () => ({ CheckoutHeader: () => null }));
vi.mock('@/components/ReceiptSlip', () => ({}));

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const REFERENCE = '3F9A2B7C1D4E';
const SENDER = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01';
const PAID = '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80';
const HASH = `0x3f9a2b7c1d4e${'ab'.repeat(26)}`;

const kept: KeptPayment = {
  hash: HASH,
  from: SENDER,
  fromName: 'Chidinma Okeke',
  fromUsername: 'chidinma',
  to: PAID,
  toName: 'Tunde Bello',
  toUsername: 'tunde.b',
  amountToken: '16210000',
  amountMinor: 2_500_000,
  at: '2026-10-12T14:42:07.000Z',
  note: 'For the generator repair',
};

const lookup = vi.mocked(getByReference);
const limiter = vi.mocked(rateLimit);

const ask = (reference: string, query = '') =>
  GET(new Request(`http://localhost/api/receipt/${reference}/image${query}`), {
    params: Promise.resolve({ reference }),
  });

/** A PNG says how big it is in its first chunk. */
function pngSize(file: ArrayBuffer): { width: number; height: number } {
  const view = new DataView(file);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

beforeEach(() => {
  lookup.mockReset();
  limiter.mockReset();
  limiter.mockResolvedValue({ ok: true });
});

describe('the receipt picture', () => {
  it('is not drawn for a payment the server has not kept: a plain 404', async () => {
    lookup.mockResolvedValue(null);
    const response = await ask(REFERENCE);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const words = await response.text();
    expect(words).toBe('Not found');
    // It repeats nothing it was given.
    expect(words).not.toContain(REFERENCE);
  });

  it('cannot be talked into one by anything in the request', async () => {
    lookup.mockResolvedValue(null);
    const response = await ask(REFERENCE, '?amount=999999999&amountMinor=999999999&to=Mallory&toName=Mallory&note=paid');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toMatch(/image/);
  });

  it('is drawn from the kept payment, as a PNG exactly the size of its slip', async () => {
    lookup.mockResolvedValue(kept);
    const response = await ask(REFERENCE);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe(`inline; filename="entole-receipt-${REFERENCE}.png"`);
    expect(response.headers.get('x-robots-tag')).toBe('noindex');

    const file = await response.arrayBuffer();
    expect([...new Uint8Array(file.slice(0, 8))]).toEqual(PNG_SIGNATURE);
    const size = receiptPictureSize(slipFacts(kept, { tokenDecimals: 6 }));
    expect(pngSize(file)).toEqual(size);
    // Portrait, a phone's width.
    expect(size.width).toBe(1080);
    expect(size.height).toBeGreaterThan(size.width);

    // The store was asked for this reference and nothing else was read.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(REFERENCE);
  }, 60_000);

  it('is the same picture whatever else the request says', async () => {
    lookup.mockResolvedValue(kept);
    const honest = Buffer.from(await (await ask(REFERENCE)).arrayBuffer());
    const dressed = Buffer.from(
      await (await ask(REFERENCE, '?amount=999999999&from=Mallory&to=Mallory&note=nothing')).arrayBuffer(),
    );
    expect(dressed.equals(honest)).toBe(true);
  }, 60_000);

  it('grows with what it has to say and never cuts it', async () => {
    const short = receiptPictureSize(slipFacts({ ...kept, note: undefined }, { tokenDecimals: 6 }));
    const one = receiptPictureSize(slipFacts(kept, { tokenDecimals: 6 }));
    const long = receiptPictureSize(
      slipFacts({ ...kept, note: 'School fees for the second term, plus the uniform and the bus. '.repeat(2).trim() }, { tokenDecimals: 6 }),
    );
    expect(one.height).toBeGreaterThan(short.height);
    expect(long.height).toBeGreaterThan(one.height);
  });

  it('says so plainly when the store cannot be read, and when it is asked too often', async () => {
    lookup.mockRejectedValue(new Error('down'));
    expect((await ask(REFERENCE)).status).toBe(503);

    limiter.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const limited = await ask(REFERENCE);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
  });

  it('reads the reference from the path and nothing else from the request', () => {
    const route = code('app/api/receipt/[reference]/image/route.tsx');
    expect(route).toMatch(/const \{ reference \} = await context\.params;/);
    expect(route).toMatch(/payment = await getByReference\(reference\);/);
    expect(route.match(/getByReference\(/g)).toHaveLength(1);
    // The request is handed to the limiter, which reads where it came from. Nothing else touches it.
    expect(route.match(/\brequest\b/g)).toHaveLength(2);
    expect(route).toMatch(/rateLimit\(request, 'receipt', LIMIT_PER_MINUTE\)/);
    expect(route).not.toMatch(/searchParams|nextUrl|\.url\b|\.json\(|formData|\.headers\b|cookies\(/);
    // What is drawn is what `slipFacts` makes of the kept payment.
    expect(route).toMatch(/const facts = slipFacts\(payment, \{ tokenDecimals: TOKEN_DECIMALS \}\);/);
    expect(route).toMatch(/if \(!payment\) return plain\('Not found', 404\);/);
  });

  it('draws the Entole mark from the app icon file, and never an account or the payment itself', () => {
    const route = code('app/api/receipt/[reference]/image/route.tsx');
    const picture = code('components/ReceiptPicture.tsx');
    expect(route).toMatch(/readFile\(join\(process\.cwd\(\), 'public\/icons\/icon\.svg'\), 'base64'\)/);
    expect(picture).toMatch(/<img src=\{mark\}/);
    // The mark is that file. Its shapes are not typed out again here, where they could drift.
    expect(picture).not.toMatch(/M50 16 A34 34|M4 50 H26|<circle/);
    // It is handed `SlipFacts`, which has no account and no payment hash in it to draw.
    expect(picture).not.toMatch(/\.hash\b|\bpayment\.|0x/);
    expect(picture).not.toMatch(/KeptPayment|amountToken/);
  });
});

describe('the watermark', () => {
  it('is the name, small, and laid so that it repeats on a square', () => {
    expect(watermarkToken.word).toBe('entole');
    // Smaller than the smallest words on the slip, and faint.
    expect(watermarkToken.size).toBeLessThan(11);
    expect(watermarkToken.opacity).toBeLessThanOrEqual(0.1);
    // The picture lays it from one stamp, which only works while these two hold.
    expect(watermarkToken.advance).toBe(2 * watermarkToken.row);
    expect(watermarkToken.angle).toBeCloseTo((-Math.atan(1 / 2) * 180) / Math.PI, 2);
  });

  it('is drawn from the outline of that same word, in every place a slip is drawn', () => {
    expect(stampWord.word).toBe(watermarkToken.word);
    expect(stampWord.path.startsWith('M')).toBe(true);
    for (const file of ['components/ReceiptPicture.tsx', 'components/ReceiptSlip.tsx', '../mobile/components/ui/ReceiptSlip.tsx']) {
      expect(code(file), file).toMatch(/const \{ [^}]*\bword\b[^}]*\} = watermarkToken;|= watermarkToken;/);
      expect(code(file), file).toMatch(/watermarkToken/);
    }
  });

  it('covers the whole picture, laid straight from a stamp of ten words', () => {
    const picture = code('components/ReceiptPicture.tsx');
    expect(picture).toMatch(/<Watermark width=\{width\} height=\{height\} \/>/);
    expect(picture).toMatch(/backgroundRepeat: 'repeat'/);
    // Laid over the slip and under its words.
    const slip = picture.indexOf('backgroundColor: colour.card');
    const paper = picture.indexOf('<Watermark width=');
    const words = picture.indexOf('<Block height={blocks.head}');
    expect(slip).toBeGreaterThan(-1);
    expect(slip).toBeLessThan(paper);
    expect(paper).toBeLessThan(words);
    // Nothing in the picture is clipped or blurred: both cost the renderer seconds.
    expect(picture).not.toMatch(/overflow: 'hidden'|boxShadow|filter:/);
  });
});

describe('the picture is set in the apps’ own two faces', () => {
  it('ships its fonts with the route, small enough to matter', () => {
    const route = code('app/api/receipt/[reference]/image/route.tsx');
    const files = ['SourceSerif4-SemiBold.ttf', 'PlusJakartaSans-Medium.ttf', 'PlusJakartaSans-SemiBold.ttf'];
    let total = 0;
    for (const file of files) {
      expect(route).toContain(`readFile(join(process.cwd(), 'assets/receipt/${file}'))`);
      total += readFileSync(join(ROOT, 'assets/receipt', file)).byteLength;
    }
    expect(total).toBeLessThan(500 * 1024);
    expect(route).toMatch(/name: 'Source Serif 4'/);
    expect(route).toMatch(/name: 'Plus Jakarta Sans'/);
  });

  it('measures words by the real width of their letters, the naira sign among them', () => {
    const widths: Record<string, number> = letters.widths;
    expect(widths[String('₦'.codePointAt(0))]).toBeGreaterThan(0);
    // Every figure is one width: amounts are tabular in the picture too.
    expect(new Set('0123456789'.split('').map((digit) => widths[String(digit.codePointAt(0))])).size).toBe(1);
    // Letters Yoruba and Igbo names are written with.
    for (const letter of 'ẹọṣịụṅẸỌṢ') expect(widths[String(letter.codePointAt(0))], letter).toBeGreaterThan(0);
  });
});

describe('the receipt page', () => {
  const page = code('app/receipt/[reference]/page.tsx');
  const missing = code('app/receipt/[reference]/not-found.tsx');

  it('is open to anyone sent the link, and to nothing beside a receipt', () => {
    expect(isPublicPath(`/receipt/${REFERENCE}`)).toBe(true);
    expect(isPublicPath(`/receipt/${REFERENCE}/`)).toBe(true);
    expect(isPublicPath('/receipt')).toBe(false);
    expect(isPublicPath('/receipt/')).toBe(false);
    expect(isPublicPath('/receipts')).toBe(false);
  });

  it('is drawn from the kept payment, and reads nothing from the address but the reference', () => {
    expect(page).toMatch(/getByReference\(reference\)/);
    expect(page.match(/getByReference\(/g)).toHaveLength(1);
    expect(page).toMatch(/type Props = \{ params: Promise<\{ reference: string \}> \};/);
    expect(page).not.toMatch(/searchParams|useSearchParams|nextUrl/);
    expect(page).toMatch(/if \(!facts\) notFound\(\);/);
    // Never an account or the payment itself: only what `slipFacts` gives it.
    expect(page).not.toMatch(/payment\.(hash|from|to)\b|0x/);
  });

  it('keeps out of search, and unfurls as the picture of the same receipt', async () => {
    lookup.mockResolvedValue(kept);
    const metadata = await generateMetadata({ params: Promise.resolve({ reference: REFERENCE }) });
    expect(metadata.robots).toEqual({ index: false, follow: false });

    const size = receiptPictureSize(slipFacts(kept, { tokenDecimals: 6 }));
    const picture = {
      url: `${SITE_ORIGIN}/api/receipt/${REFERENCE}/image`,
      ...size,
      type: 'image/png',
      alt: 'Receipt: ₦25,000 from Chidinma Okeke to Tunde Bello, delivered 12 Oct 2026',
    };
    expect(metadata.openGraph).toMatchObject({ url: `${SITE_ORIGIN}/receipt/${REFERENCE}`, images: [picture] });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [picture] });
    expect(SITE_ORIGIN).toBe('https://entole.pro');
  });

  it('for a reference nothing is kept under, says only that, and repeats nothing', async () => {
    lookup.mockResolvedValue(null);
    const metadata = await generateMetadata({ params: Promise.resolve({ reference: 'NOTAREFERENCE<script>' }) });
    expect(metadata).toEqual({ title: 'Receipt · Entole', robots: { index: false, follow: false } });

    // The page that is shown is told nothing about what was asked for.
    expect(missing).toMatch(/export default function ReceiptNotHere\(\) \{/);
    expect(missing).not.toMatch(/params|reference|usePathname|useParams|searchParams/);
    expect(missing).toMatch(/This receipt isn&apos;t here/);
  });

  it('carries the header that keeps the pause control one tap away for someone signed in', () => {
    expect(page).toMatch(/<CheckoutHeader brand=\{false\} \/>/);
    expect(missing).toMatch(/<CheckoutHeader \/>/);
    expect(code('components/CheckoutHeader.tsx')).toMatch(/\{account \? \(\s*<div className="ml-3 flex-none">\s*<PauseControl \/>/);
  });
});

describe('sharing a receipt from the browser shares its picture', () => {
  const share = code('lib/share-receipt.ts');
  const send = code('app/transfer/send/page.tsx');

  it('tells the server which payment it is, and waits, before asking for the picture', () => {
    const prepare = /export async function prepareReceiptPicture[\s\S]*?\n}\n/.exec(share)?.[0] ?? '';
    expect(prepare.indexOf('await tell()')).toBeGreaterThan(-1);
    expect(prepare.indexOf('await tell()')).toBeLessThan(prepare.indexOf('await fetchPicture(reference)'));
    expect(send).toMatch(/const report = reportForReceipt\(receipt, note\);/);
    expect(send).toMatch(/report \? backend\.payments\.record\(report\) : false/);
  });

  it('hands the picture over as a file, saves it where that cannot be done, and falls back to the link', () => {
    expect(share).toMatch(/navigator\.canShare\?\.\(\{ files: \[picture\] \}\) === true/);
    expect(share).toMatch(/navigator\.share\(\{ files: \[picture\], title: 'Entole receipt' \}\)/);
    expect(share).toMatch(/link\.download = picture\.name;/);
    expect(share).toMatch(/receiptLink\(window\.location\.origin, reference\)/);

    const press = /async function share\(\) \{[\s\S]*?\n  }\n/.exec(send)?.[0] ?? '';
    const order = ['canSharePicture(picture)', 'sharePicture(picture)', 'savePicture(picture)'].map((step) => press.indexOf(step));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(press).toMatch(/if \(!picture\) \{\s*await byLink\(receipt\.reference\);/);
  });

  it('never shares words it made up: the picture is fetched, not drawn in the browser', () => {
    expect(share).toMatch(/fetch\(path, \{ cache: 'no-store' \}\)/);
    expect(share).not.toMatch(/canvas|toDataURL|toBlob|html2canvas/i);
    expect(send).not.toMatch(/navigator\.share\(\{ text:/);
  });

  it('says what happened, and shows the mark while the picture is fetched', () => {
    expect(send).toMatch(/<p role="status"/);
    expect(send).toMatch(/Shared as a picture\./);
    expect(send).toMatch(/Saved as a picture\. Look in your downloads\./);
    expect(send).toMatch(/busy \? <LogoLoader size=\{22\} mono label="Share receipt, in progress" \/> : 'Share receipt'/);
  });
});
