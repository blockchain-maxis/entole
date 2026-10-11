import Link from 'next/link';

const VARIANTS = {
  primary: 'bg-ink text-paper hover:bg-ink/85',
  secondary: 'border border-line bg-card text-ink hover:border-mist',
} as const;

const SIZES = {
  regular: 'h-14 text-prose',
  /** For a row of several, where three full-height buttons read as blocks. */
  compact: 'h-12 text-ui',
} as const;

/**
 * Primary actions sit at the bottom of the page, the way they sit at the bottom
 * of a phone screen.
 */
export function ButtonLink({
  href,
  label,
  variant = 'primary',
  size = 'regular',
}: {
  href: string;
  label: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-1 items-center justify-center rounded-control font-strong transition-colors active:translate-y-px ${SIZES[size]} ${VARIANTS[variant]}`}
    >
      {label}
    </Link>
  );
}
