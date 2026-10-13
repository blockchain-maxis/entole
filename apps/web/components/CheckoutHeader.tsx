'use client';

import { useAccount } from '@/lib/account';

import { BrandGlyph } from './Header';
import { PauseControl } from './PauseControl';

/**
 * The header for the public checkout page. A payer who has no account has
 * nothing to pause, so the pause control is not drawn for them. Anyone who is
 * signed in gets it here exactly as on every other page — the rule is that a
 * person's own controls are never more than one tap away, and this page is
 * theirs too the moment they are signed in.
 *
 * `brand={false}` leaves the name off, for a page whose own content already
 * carries it: a receipt has the mark at its head, and saying it twice an inch
 * apart reads as a mistake. The pause control is drawn either way.
 */
export function CheckoutHeader({ brand = true }: { brand?: boolean }) {
  const { account } = useAccount();

  return (
    <header className="flex flex-none items-center justify-between pb-3.5 pt-4">
      {brand ? (
        <div className="flex items-center gap-2">
          <BrandGlyph size={24} />
          <span className="font-display text-subhead text-ink">Entole</span>
        </div>
      ) : (
        <span aria-hidden />
      )}
      {account ? (
        <div className="ml-3 flex-none">
          <PauseControl />
        </div>
      ) : null}
    </header>
  );
}
