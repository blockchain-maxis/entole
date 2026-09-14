import Link from 'next/link';

const VARIANTS = {
  primary: 'bg-ink text-paper hover:bg-indigo-deep',
  secondary: 'border border-line bg-card text-ink hover:border-mist',
} as const;

/**
 * Primary actions sit at the bottom of the page, the way they sit at the bottom
 * of a phone screen.
 */
export function ButtonLink({
  href,
  label,
  variant = 'primary',
}: {
  href: string;
  label: string;
  variant?: keyof typeof VARIANTS;
}) {
  return (
    <Link
      href={href}
      className={`flex h-14 flex-1 items-center justify-center rounded-control font-strong text-body-lg transition-colors ${VARIANTS[variant]}`}
    >
      {label}
    </Link>
  );
}
