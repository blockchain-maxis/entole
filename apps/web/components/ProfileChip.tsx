'use client';

import Link from 'next/link';

import { useProfile } from '@/lib/profile';

import { Avatar } from './Avatar';
import { Skeleton } from './Skeleton';

/**
 * Who this is, in the header's leading slot — the person's own photo-or-initials,
 * full name, and "@username · ENT-XXXX-XXXX". Replaces the brand wordmark:
 * people know what app they opened. Links to Me.
 *
 * `min-w-0 flex-1` so a long name truncates instead of pushing the assistant
 * chip off screen; the chip in `Header`'s trailing slot stays `flex-none`.
 *
 * TODO(photo): `Avatar` shows initials until a picture exists. Uploading one
 * needs storage that does not exist yet.
 */
export function ProfileChip() {
  const profile = useProfile();

  if (!profile) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Skeleton className="h-10 w-10 flex-none rounded-pill" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-1.5 h-3 w-36" />
        </div>
      </div>
    );
  }

  const handle = [profile.username ? `@${profile.username}` : null, profile.code].filter(Boolean).join(' · ');

  return (
    <Link
      href="/me"
      aria-label={`${profile.fullName}, your profile`}
      className="flex min-w-0 flex-1 items-center gap-3"
    >
      <Avatar initials={profile.initials} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-strong text-body text-ink">{profile.fullName}</span>
        <span className="block truncate font-body text-caption text-slate">{handle}</span>
      </span>
    </Link>
  );
}
