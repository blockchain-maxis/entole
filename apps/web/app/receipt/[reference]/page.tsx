import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import {
  receiptFileName,
  receiptImageLink,
  receiptImagePath,
  receiptLink,
  SLIP_ZONE_WORDS,
  slipFacts,
  slipSummary,
} from '@entole/core/receipt-slip';

import { CheckoutHeader } from '@/components/CheckoutHeader';
import { receiptPictureSize } from '@/components/ReceiptPicture';
import {
  ReceiptSlip,
  SlipFigure,
  SlipHead,
  SlipNote,
  SlipRow,
  SlipRows,
  SlipStatus,
} from '@/components/ReceiptSlip';
import { getByReference } from '@/lib/server/payments';
import { rateLimit, TOKEN_DECIMALS } from '@/lib/server/sponsor';
import { SITE_ORIGIN } from '@/lib/site';

/**
 * A receipt, for whoever is sent its link: the person paid as much as the
 * person who paid. No account is needed to open it.
 *
 * It is drawn from one thing: the payment the server kept under this
 * reference, which it read from the network when the payment settled. The
 * only thing taken from the address is the reference. Nothing else on the
 * page can be put there by a link, so a receipt cannot be made up by writing
 * one. A reference nothing is kept under gets a page that says so and repeats
 * nothing it was given.
 */
type Props = { params: Promise<{ reference: string }> };

const LIMIT_PER_MINUTE = 60;

// A receipt is for the two people on it. It has no business in a search index.
const PRIVATE: Metadata['robots'] = { index: false, follow: false };

/** Read once for the page and for its title. `null` when there is no such payment, or it cannot be read just now. */
const kept = cache(async (reference: string) => {
  const payment = await getByReference(reference).catch(() => null);
  return payment ? slipFacts(payment, { tokenDecimals: TOKEN_DECIMALS }) : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { reference } = await params;
  const facts = await kept(reference);
  if (!facts) return { title: 'Receipt · Entole', robots: PRIVATE };

  const title = 'Entole receipt';
  const description = slipSummary(facts);
  const page = receiptLink(SITE_ORIGIN, facts.reference);
  const image = receiptImageLink(SITE_ORIGIN, facts.reference);
  // The picture of this same receipt, so a link dropped in a chat shows the slip.
  const pictures = image
    ? [{ url: image, ...receiptPictureSize(facts), type: 'image/png', alt: `Receipt: ${description}` }]
    : [];
  return {
    title,
    description,
    robots: PRIVATE,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'Entole',
      ...(page ? { url: page } : {}),
      images: pictures,
    },
    twitter: { card: 'summary_large_image', title, description, images: pictures },
  };
}

export default async function ReceiptPage({ params }: Props) {
  const { reference } = await params;

  // Slowed the same way the picture is, and counted together with it.
  const limit = await rateLimit(new Request(SITE_ORIGIN, { headers: await headers() }), 'receipt', LIMIT_PER_MINUTE);
  if (!limit.ok) return <Busy />;

  const facts = await kept(reference);
  if (!facts) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-gutter pb-[max(24px,env(safe-area-inset-bottom))]">
      <CheckoutHeader brand={false} />

      <ReceiptSlip>
        <SlipHead level={1} />
        <SlipStatus>Delivered</SlipStatus>
        <SlipFigure symbol={facts.figure.symbol} digits={facts.figure.digits}>
          {facts.arrived ? (
            <p className="tabular mt-1.5 font-body text-ui text-slate">
              Arrived as <span className="font-strong text-ink">{facts.arrived}</span>
            </p>
          ) : null}
        </SlipFigure>

        <SlipRows>
          <SlipRow label="From" value={facts.from.name} under={facts.from.username} />
          <SlipRow label="To" value={facts.to.name} under={facts.to.username} />
          <SlipRow
            label="When"
            value={`${facts.delivered.date}, ${facts.delivered.time}`}
            under={SLIP_ZONE_WORDS}
          />
          {facts.note ? <SlipNote>{facts.note}</SlipNote> : null}
          <SlipRow label="Reference" value={facts.reference} spaced />
        </SlipRows>
      </ReceiptSlip>

      <p className="mt-5 max-w-[42ch] text-pretty font-body text-note text-slate">
        Entole wrote this receipt when the payment was delivered. Nobody can change what it says.
      </p>

      <div className="mt-auto flex gap-2.5 pt-8">
        <a
          href={receiptImagePath(facts.reference) ?? '#'}
          download={receiptFileName(facts.reference)}
          className="flex h-14 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist active:translate-y-px"
        >
          Save as a picture
        </a>
        <Link
          href="/"
          className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
        >
          Open Entole
        </Link>
      </div>
    </main>
  );
}

/** Too many receipts asked for from one place in a minute. Says so, and nothing about any receipt. */
function Busy() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-gutter pb-[max(24px,env(safe-area-inset-bottom))]">
      <CheckoutHeader />
      <section aria-labelledby="receipt-title" className="pt-16">
        <h1 id="receipt-title" className="font-display text-heading text-ink">
          Give it a moment
        </h1>
        <p className="mt-3 max-w-[34ch] text-pretty font-body text-prose text-slate">
          A lot of receipts were opened from here just now. Try this one again in a minute.
        </p>
      </section>
    </main>
  );
}
