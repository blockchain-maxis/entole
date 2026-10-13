import Link from 'next/link';

import { CheckoutHeader } from '@/components/CheckoutHeader';

/**
 * A receipt link that leads to no payment. It is told nothing about what was
 * asked for, so it has nothing to repeat: whatever was typed after
 * `/receipt/` never reaches this page.
 */
export default function ReceiptNotHere() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-gutter pb-[max(24px,env(safe-area-inset-bottom))]">
      <CheckoutHeader />

      <section aria-labelledby="receipt-title" className="pt-16">
        <h1 id="receipt-title" className="font-display text-heading text-ink">
          This receipt isn&apos;t here
        </h1>
        <p className="mt-3 max-w-[34ch] text-pretty font-body text-prose text-slate">
          The link may have been cut short when it was copied, or the receipt may still be on its way. Ask the
          person who sent it to share it again.
        </p>
      </section>

      <div className="mt-auto flex pt-8">
        <Link
          href="/"
          className="flex h-14 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist active:translate-y-px"
        >
          Open Entole
        </Link>
      </div>
    </main>
  );
}
