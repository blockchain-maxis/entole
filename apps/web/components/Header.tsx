import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { AssistantLine } from './AssistantTalk';
import { PauseControl } from './PauseControl';
import { ProfileChip } from './ProfileChip';

/**
 * The Entole mark, as it is on the app icon and the browser tab: a blue ring
 * left open, a dot at its centre and a bar at nine o'clock. Drawn from
 * `public/icons/icon.svg`, in tokens, so it holds in both themes. It is the
 * one place blue is not the assistant's: it is the brand's own.
 */
export function BrandGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden>
      <path d="M50 16 A34 34 0 1 1 16 50" className="stroke-indigo" strokeWidth={9} />
      <path d="M4 50 H26" className="stroke-ink" strokeWidth={9} />
      <circle cx="50" cy="50" r="7" className="fill-ink" />
    </svg>
  );
}

/**
 * The pause control rides in every header, so every page gets one of these.
 * With no `title` (Home) the leading slot is the signed-in person's profile
 * chip, not the logo — the logo only appears before sign-in.
 *
 * Under it, for a moment after the assistant has taken the person somewhere,
 * is what the assistant said. It is part of the page, not laid over it.
 */
export function Header({ title, back }: { title?: string; back?: string }) {
  return (
    <>
      <HeaderRow title={title} back={back} />
      <AssistantLine />
    </>
  );
}

function HeaderRow({ title, back }: { title?: string | undefined; back?: string | undefined }) {
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

        {title ? <h1 className="truncate font-strong text-prose text-ink">{title}</h1> : null}
      </div>

      <div className="ml-3 flex-none">
        <PauseControl />
      </div>
    </header>
  );
}
