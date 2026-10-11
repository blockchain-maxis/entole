/**
 * The Entole mark, drawing itself. The blue ring goes round from the top and
 * stops where it meets the bar, rests there, then lets go and starts again:
 * a limit it cannot pass, which is the product, in one motion.
 *
 * It is the only thing in the app that turns. It is for the moments when
 * nothing about the screen is known yet (the app starting, a page arriving)
 * and for a button that is busy. Anything with a known shape still loads as a
 * skeleton in that shape.
 *
 * `mono` draws all of it in the surrounding text colour, for use on a button.
 * Someone who asked for less motion gets the mark, complete and still.
 */
export function LogoLoader({
  size = 44,
  label = 'Loading',
  mono = false,
}: {
  size?: number;
  label?: string;
  mono?: boolean;
}) {
  return (
    <span role="status" aria-label={label} className="inline-flex flex-none">
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden>
        <path
          d="M50 16 A34 34 0 1 1 16 50"
          pathLength={100}
          className={`logo-ring ${mono ? 'stroke-current' : 'stroke-indigo'}`}
          strokeWidth={9}
        />
        <path d="M4 50 H26" className={mono ? 'stroke-current' : 'stroke-ink'} strokeWidth={9} />
        <circle cx="50" cy="50" r="7" className={mono ? 'fill-current' : 'fill-ink'} />
      </svg>
    </span>
  );
}

/** A whole page that is not known yet: the mark, alone, in the middle. */
export function PageLoader() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <LogoLoader size={56} />
    </main>
  );
}
