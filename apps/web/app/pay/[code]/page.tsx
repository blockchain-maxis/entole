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
 * The public checkout page: what a shared pay link opens, in any browser, with
 * no account. It is rebuilt from the request every time — what the link asks
 * for is in the link, nothing is stored — and every field is read and cleaned
 * before it is used. `searchParams` makes it dynamic, which is also what lets
 * "overdue" be worked out at request time.
 */
type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<QueryInput>;
};

/**
 * The checkout a link names. A pay link is a username (`/pay/@ada.eze`): the
 * directory says whose it is, and the page shows them under the name its owner
 * gave. A username nobody holds says so, by name: the payer typed it or was
 * sent it, and "this link isn't valid" would send them looking for a fault in
 * the link instead of in the name.
 *
 * A link made before usernames names the account in the path instead. It
 * still opens. When that account has since taken a username, the page uses it,
 * so whatever is handed on from here is the short form.
 */
type Found = { checkout: Checkout } | { nobody: string } | null;

async function checkoutFor(code: string, query: QueryInput): Promise<Found> {
  const direct = checkoutFromRequest(code, query);
  if (direct) {
    const { address } = direct;
    const known = await getByAddress(address).catch(() => null);
    return { checkout: known?.username ? { ...direct, payee: known.name, username: known.username } : direct };
  }

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
  if (!owner) return { nobody: handle.username };
  const record = await getByAddress(owner);
  if (!record) return null;
  const checkout = checkoutFromRequest(encodePaymentCode(record.address), { ...query, n: record.name });
  return checkout ? { checkout: { ...checkout, username: handle.username } } : null;
}

// A payment link is for one person. It has no business in a search index.
const PRIVATE: Metadata['robots'] = { index: false, follow: false };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const found = await checkoutFor(code, query);
  const checkout = found && 'checkout' in found ? found.checkout : null;
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
  const found = await checkoutFor(code, query);
  const checkout = found && 'checkout' in found ? found.checkout : null;

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
        <InvalidCheckout {...(found && 'nobody' in found ? { username: found.nobody } : {})} />
      )}
    </main>
  );
}
