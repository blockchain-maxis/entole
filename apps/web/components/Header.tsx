import Link from 'next/link';

import { PauseControl } from './PauseControl';

/**
 * The pause control rides in every header, so every page gets one of these.
 */
export function Header({ title, back }: { title?: string; back?: string }) {
  return (
    <header className="flex flex-none items-center justify-between px-gutter pb-3.5 pt-4">
      <div className="flex flex-1 items-center gap-3.5">
        {back ? (
          <Link
            href={back}
            aria-label="Go back"
            className="font-body text-title leading-none text-slate hover:text-ink"
          >
            ←
          </Link>
        ) : (
          <>
            <span
              aria-hidden
              className="flex h-[30px] w-[30px] items-center justify-center rounded-pip bg-ink font-heavy text-body text-paper"
            >
              E
            </span>
            <span className="font-heavy text-headline text-ink">Entole</span>
          </>
        )}

        {title ? <h1 className="font-strong text-body-lg text-ink">{title}</h1> : null}
      </div>

      <PauseControl />
    </header>
  );
}
