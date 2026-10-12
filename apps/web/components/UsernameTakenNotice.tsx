'use client';

import Link from 'next/link';

import { useAccount } from '@/lib/account';
import { useUsernameClaim } from '@/lib/username-claim';

/**
 * Shown when the username on this device turned out to be someone else's: two
 * people chose the same one before usernames were checked, and the other
 * claimed it first. Says so, and sends them to choose another.
 */
export function UsernameTakenNotice({ editHref = '/me?edit=1' }: { editHref?: string | null }) {
  const { account } = useAccount();
  const claim = useUsernameClaim();
  if (claim !== 'taken' || !account) return null;

  return (
    <div className="mb-2 mt-1 flex items-center gap-3 rounded-control bg-press px-4 py-3">
      <p className="flex-1 text-pretty font-body text-ui text-ink">
        Someone else already has @{account.username}. Choose another username so people can find and pay you.
      </p>
      {editHref ? (
        <Link
          href={editHref}
          className="flex-none font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
        >
          Change it
        </Link>
      ) : null}
    </div>
  );
}
