import type { Metadata } from 'next';
import Link from 'next/link';

import { CheckoutHeader } from '@/components/CheckoutHeader';

export const metadata: Metadata = {
  title: 'Add money',
  robots: { index: false, follow: false },
};

/**
 * Where the payment partner sends a person after a bank transfer. Public: the
 * person may be in a browser that has never signed in, because they use the
 * phone app. So it shows no account, and promises nothing: money is added only
 * when it has arrived, and the account's own screens are where that shows.
 */
export default async function AddMoneyReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { status } = await searchParams;
  const confirmed = status === 'success';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-gutter">
      <CheckoutHeader />

      <div className="flex flex-1 flex-col justify-center pb-10">
        <h1 className="text-pretty font-strong text-headline text-ink">
          {confirmed ? 'Your payment went through' : 'Your payment is being confirmed'}
        </h1>
        <p className="mt-3 text-pretty font-body text-body-sm text-slate">
          The money shows up once it has arrived. A bank transfer can take a few minutes.
        </p>
        <p className="mt-3 text-pretty font-body text-body-sm text-slate">
          If you use Entole on your phone, go back to the app to see it.
        </p>
      </div>

      <div className="flex pb-10">
        <Link
          href="/add-money?returned=1"
          className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px"
        >
          Back to Entole
        </Link>
      </div>
    </main>
  );
}
