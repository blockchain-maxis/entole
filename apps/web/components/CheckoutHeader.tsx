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
 */
export function CheckoutHeader() {
  const { account } = useAccount();

  return (
    <header className="flex flex-none items-center justify-between pb-3.5 pt-4">
      <div className="flex items-center gap-2">
        <BrandGlyph size={22} />
        <span className="font-heavy text-body-lg text-ink">Entole</span>
      </div>
      {account ? (
        <div className="ml-3 flex-none">
          <PauseControl />
        </div>
      ) : null}
    </header>
  );
}
