import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { PauseControl } from './PauseControl';
import { ProfileChip } from './ProfileChip';

/** Monoline rounded arch — safe passage for money, nothing coin- or
 * chain-shaped. Mirrors `apps/mobile/components/ui/BrandMark.tsx`.
 * `currentColor` + the `text-ink` className (not a raw token value) is what
 * makes this repaint on theme change without needing a client component or
 * a theme hook — the CSS variable behind `text-ink` is what actually moves. */
export function BrandGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="text-ink"
    >
      <path
        d="M6 20V10a6 6 0 0 1 12 0v10"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The pause control rides in every header, so every page gets one of these.
 * With no `title` (Home) the leading slot is the signed-in person's profile
 * chip, not the logo — the logo only appears before sign-in.
 */
export function Header({ title, back }: { title?: string; back?: string }) {
  return (
    <header className="flex flex-none items-center justify-between px-gutter pb-3.5 pt-4">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        {back ? (
          <Link href={back} aria-label="Go back" className="flex text-slate hover:text-ink">
            <ArrowLeft size={22} strokeWidth={1.5} />
          </Link>
        ) : title ? null : (
          <ProfileChip />
        )}

        {title ? <h1 className="truncate font-strong text-body-lg text-ink">{title}</h1> : null}
      </div>

      <div className="ml-3 flex-none">
        <PauseControl />
      </div>
    </header>
  );
}
