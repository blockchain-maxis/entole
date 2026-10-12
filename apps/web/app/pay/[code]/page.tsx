import type { Metadata } from 'next';

import type { Checkout } from '@entole/core/checkout-link';
import { parseHandle } from '@entole/core/handle';
import { encodePaymentCode } from '@entole/core/payment-code';

import { CheckoutHeader } from '@/components/CheckoutHeader';
import { InvalidCheckout, InvoiceDetails, PayDetails, PaymentOptions } from '@/components/Checkout';
import { checkoutDescription, checkoutFromRequest, checkoutTitle, type QueryInput } from '@/lib/checkout';
import { onrampUrlFor } from '@/lib/onramp';
import { getByAddress, getUsernameOwner } from '@/lib/server/directory';

/**
 * The public checkout page: what a shared payment link opens, in any browser,
 * with no account. It is rebuilt from the request every time — the link is the
 * whole record, nothing is stored — and every field goes through
 * `parseCheckout` before it is used. `searchParams` makes it dynamic, which is
 * also what lets "overdue" be worked out at request time.
 */
type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<QueryInput>;
};

/**
 * The checkout a link names. Usually the code in the path says it all. A link
 * made from a username (`/pay/@ada.eze`) is looked up in the directory instead
 * and becomes the same checkout, under the name its owner gave. A username
 * nobody holds is an invalid link like any other.
 */
async function checkoutFor(code: string, query: QueryInput): Promise<Checkout | null> {
  const direct = checkoutFromRequest(code, query);
  if (direct) return direct;

  let text = code;
  try {
    text = decodeURIComponent(code);
  } catch {
    return null;
  }
  if (!text.startsWith('@')) return null;
  const handle = parseHandle(text);
  if (handle?.kind !== 'username') return null;

  const owner = await getUsernameOwner(handle.username);
  const record = owner ? await getByAddress(owner) : null;
  if (!record) return null;
  return checkoutFromRequest(encodePaymentCode(record.address), { ...query, n: record.name });
}

// A payment link is for one person. It has no business in a search index.
const PRIVATE: Metadata['robots'] = { index: false, follow: false };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const checkout = await checkoutFor(code, query);
  if (!checkout) return { title: 'Payment link — Entole', robots: PRIVATE };

  const title = checkoutTitle(checkout);
  const description = checkoutDescription(checkout);
  return {
    title,
    description,
    robots: PRIVATE,
    openGraph: { title, description, type: 'website', siteName: 'Entole' },
  };
}

export default async function CheckoutPage({ params, searchParams }: Props) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const checkout = await checkoutFor(code, query);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-gutter pb-[max(24px,env(safe-area-inset-bottom))]">
      <CheckoutHeader />

      {checkout ? (
        <>
          {checkout.kind === 'invoice' ? (
            <InvoiceDetails checkout={checkout} now={new Date()} />
          ) : (
            <PayDetails checkout={checkout} />
          )}
          <PaymentOptions checkout={checkout} onrampUrl={onrampUrlFor(checkout)} />
        </>
      ) : (
        <InvalidCheckout />
      )}
    </main>
  );
}
